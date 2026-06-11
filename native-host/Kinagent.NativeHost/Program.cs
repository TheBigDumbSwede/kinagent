using System.Buffers.Binary;
using System.IO.Pipes;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

const string PipeName = "kinagent-browser-bridge";
const int BrowserBridgeProtocolVersion = 1;

var stdin = Console.OpenStandardInput();
var stdout = Console.OpenStandardOutput();
var launchContext = NativeHostLaunchContext.FromArgs(args);

try
{
    while (true)
    {
        var input = await NativeMessage.ReadAsync(stdin, CancellationToken.None);
        if (input is null)
        {
            return 0;
        }

        JsonObject response;
        try
        {
            response = await HandleMessageAsync(input, launchContext, CancellationToken.None);
        }
        catch (Exception error)
        {
            response = ErrorResponse(input, "native_host_error", error.Message);
        }

        await NativeMessage.WriteAsync(stdout, response, CancellationToken.None);
    }
}
catch (EndOfStreamException)
{
    return 0;
}
catch (Exception error)
{
    Console.Error.WriteLine($"Kinagent native host failed: {error}");
    return 1;
}

static async Task<JsonObject> HandleMessageAsync(
    JsonObject input,
    NativeHostLaunchContext launchContext,
    CancellationToken cancellationToken)
{
    var type = GetStringProperty(input, "type");
    if (string.IsNullOrWhiteSpace(type))
    {
        return ErrorResponse(input, "invalid_message", "Message type is required.");
    }

    if (type == "status")
    {
        return new JsonObject
        {
            ["id"] = CloneProperty(input, "id"),
            ["type"] = "status",
            ["connected"] = await CanConnectToKinagentAsync(cancellationToken)
        };
    }

    return await ForwardToKinagentAsync(input, launchContext, cancellationToken);
}

static async Task<bool> CanConnectToKinagentAsync(CancellationToken cancellationToken)
{
    try
    {
        using var pipe = new NamedPipeClientStream(".", PipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
        await pipe.ConnectAsync(250, cancellationToken);
        return true;
    }
    catch
    {
        return false;
    }
}

static async Task<JsonObject> ForwardToKinagentAsync(
    JsonObject input,
    NativeHostLaunchContext launchContext,
    CancellationToken cancellationToken)
{
    var id = CloneProperty(input, "id");

    try
    {
        var bridgeMessage = PrepareBridgeMessage(input, launchContext);
        using var pipe = new NamedPipeClientStream(".", PipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
        await pipe.ConnectAsync(1000, cancellationToken);

        await using var writer = new StreamWriter(pipe, new UTF8Encoding(false), leaveOpen: true)
        {
            AutoFlush = true
        };
        using var reader = new StreamReader(pipe, Encoding.UTF8, leaveOpen: true);

        await writer.WriteLineAsync(bridgeMessage.ToJsonString());
        var line = await reader.ReadLineAsync(cancellationToken);
        if (string.IsNullOrWhiteSpace(line))
        {
            return ErrorResponse(input, "empty_bridge_response", "Kinagent returned an empty bridge response.");
        }

        if (JsonNode.Parse(line) is JsonObject response)
        {
            if (response["id"] is null && id is not null)
            {
                response["id"] = id;
            }

            return response;
        }

        return ErrorResponse(input, "invalid_bridge_response", "Kinagent returned a non-object bridge response.");
    }
    catch (TimeoutException)
    {
        return ErrorResponse(input, "kinagent_unavailable", "Kinagent is not running or did not accept the bridge connection.");
    }
    catch (IOException error)
    {
        return ErrorResponse(input, "kinagent_bridge_error", error.Message);
    }
}

static JsonObject PrepareBridgeMessage(JsonObject input, NativeHostLaunchContext launchContext)
{
    var message = input.DeepClone().AsObject();
    var type = GetStringProperty(input, "type");
    if (type != "hello")
    {
        return message;
    }

    var protocolVersion = GetIntProperty(input, "protocolVersion") ?? BrowserBridgeProtocolVersion;
    var extensionId = GetStringProperty(input, "extensionId") ?? "";
    var nativeHostOrigin = string.IsNullOrWhiteSpace(launchContext.ExtensionOrigin)
        ? extensionId
        : launchContext.ExtensionOrigin;
    var nativeHostNonce = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
    var secret = BrowserBridgeAuth.LoadSecret();

    message["protocolVersion"] = protocolVersion;
    message["nativeHostOrigin"] = nativeHostOrigin;
    message["nativeHostNonce"] = nativeHostNonce;
    message["nativeHostPid"] = Environment.ProcessId;
    message["nativeHostSignature"] = SignBrowserBridgeHandshake(
        secret,
        protocolVersion,
        extensionId,
        nativeHostOrigin,
        nativeHostNonce);

    return message;
}

static string SignBrowserBridgeHandshake(
    string secret,
    int protocolVersion,
    string extensionId,
    string nativeHostOrigin,
    string nativeHostNonce)
{
    var payload = string.Join(
        "\n",
        $"protocolVersion={protocolVersion}",
        $"extensionId={extensionId}",
        $"nativeHostOrigin={nativeHostOrigin}",
        $"nativeHostNonce={nativeHostNonce}");
    using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
    return Convert.ToHexString(hmac.ComputeHash(Encoding.UTF8.GetBytes(payload))).ToLowerInvariant();
}

static JsonObject ErrorResponse(JsonObject input, string code, string message)
{
    return new JsonObject
    {
        ["id"] = CloneProperty(input, "id"),
        ["type"] = "error",
        ["code"] = code,
        ["message"] = message
    };
}

static string? GetStringProperty(JsonObject input, string name)
{
    return input[name] is JsonValue value && value.TryGetValue<string>(out var text) ? text : null;
}

static int? GetIntProperty(JsonObject input, string name)
{
    return input[name] is JsonValue value && value.TryGetValue<int>(out var number) ? number : null;
}

static JsonNode? CloneProperty(JsonObject input, string name)
{
    return input[name]?.DeepClone();
}

sealed class NativeHostLaunchContext
{
    public NativeHostLaunchContext(string? extensionOrigin)
    {
        ExtensionOrigin = extensionOrigin;
    }

    public string? ExtensionOrigin { get; }

    public static NativeHostLaunchContext FromArgs(string[] args)
    {
        foreach (var arg in args)
        {
            if (arg.StartsWith("chrome-extension://", StringComparison.OrdinalIgnoreCase) ||
                arg.StartsWith("moz-extension://", StringComparison.OrdinalIgnoreCase))
            {
                return new NativeHostLaunchContext(arg);
            }
        }

        return new NativeHostLaunchContext(null);
    }
}

static class BrowserBridgeAuth
{
    public static string LoadSecret()
    {
        var authPath = Environment.GetEnvironmentVariable("KINAGENT_BROWSER_BRIDGE_AUTH_PATH");
        if (string.IsNullOrWhiteSpace(authPath))
        {
            var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            authPath = Path.Combine(appData, "Kinagent", "browser-bridge-auth.json");
        }

        if (JsonNode.Parse(File.ReadAllText(authPath)) is not JsonObject auth ||
            auth["secret"] is not JsonValue secretValue ||
            !secretValue.TryGetValue<string>(out var secret) ||
            string.IsNullOrWhiteSpace(secret))
        {
            throw new InvalidDataException("Kinagent browser bridge auth file does not contain a secret.");
        }

        return secret;
    }
}

static class NativeMessage
{
    private const int MaxMessageBytes = 1024 * 1024;

    public static async Task<JsonObject?> ReadAsync(Stream stream, CancellationToken cancellationToken)
    {
        var lengthBytes = new byte[4];
        var read = await ReadExactOrEndAsync(stream, lengthBytes, cancellationToken);
        if (!read)
        {
            return null;
        }

        var length = BinaryPrimitives.ReadUInt32LittleEndian(lengthBytes);
        if (length == 0 || length > MaxMessageBytes)
        {
            throw new InvalidDataException($"Native message length {length} is outside the allowed range.");
        }

        var body = new byte[length];
        await stream.ReadExactlyAsync(body, cancellationToken);

        var node = JsonNode.Parse(body);
        if (node is not JsonObject message)
        {
            throw new InvalidDataException("Native message body must be a JSON object.");
        }

        return message;
    }

    public static async Task WriteAsync(Stream stream, JsonObject message, CancellationToken cancellationToken)
    {
        var body = Encoding.UTF8.GetBytes(message.ToJsonString());
        var lengthBytes = new byte[4];
        BinaryPrimitives.WriteUInt32LittleEndian(lengthBytes, (uint)body.Length);

        await stream.WriteAsync(lengthBytes, cancellationToken);
        await stream.WriteAsync(body, cancellationToken);
        await stream.FlushAsync(cancellationToken);
    }

    private static async Task<bool> ReadExactOrEndAsync(Stream stream, byte[] buffer, CancellationToken cancellationToken)
    {
        var offset = 0;
        while (offset < buffer.Length)
        {
            var read = await stream.ReadAsync(buffer.AsMemory(offset), cancellationToken);
            if (read == 0)
            {
                return offset != 0 ? throw new EndOfStreamException("Unexpected end of native message header.") : false;
            }

            offset += read;
        }

        return true;
    }
}
