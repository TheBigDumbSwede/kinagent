import * as grpc from "@grpc/grpc-js";
import protobuf from "protobufjs";
import type { AppConfig } from "../config/types.js";
import { extractFirebaseAppCheckState, loadBrowserSession, loadFreshFirebaseAuth } from "../auth/firebaseSession.js";
import type { Logger } from "../util/logger.js";
import type { FirestoreDocumentLike } from "./types.js";

interface ListenChatMessagesOptions {
  kinId: string;
  limit: number;
  signal?: AbortSignal;
  onDocument: (document: FirestoreDocumentLike) => void | Promise<void>;
}

interface ListenSessionState {
  seen: Set<string>;
  startupSnapshotComplete: boolean;
  lastCurrentAt: number | null;
  currentGeneration: number;
}

interface OpenStreamOptions extends ListenChatMessagesOptions {
  state: ListenSessionState;
  forceRefreshAuth: boolean;
}

interface ListenRequest {
  database: string;
  addTarget?: {
    query: {
      parent: string;
      structuredQuery: {
        from: Array<{ collectionId: string }>;
        orderBy: Array<{ field: { fieldPath: string }; direction: "DESCENDING" }>;
        limit: { value: number };
      };
    };
    targetId: number;
  };
}

interface ListenResponse {
  targetChange?: {
    targetChangeType?: string;
    cause?: { code?: number; message?: string };
  };
  documentChange?: {
    document?: FirestoreListenDocument;
  };
}

interface FirestoreListenDocument {
  name?: string;
  fields?: Record<string, FirestoreListenValue>;
  createTime?: TimestampLike;
  updateTime?: TimestampLike;
}

type TimestampLike = string | { seconds?: string | number; nanos?: number };

type FirestoreListenValue =
  | { nullValue: unknown }
  | { booleanValue: boolean }
  | { integerValue: string | number }
  | { doubleValue: number }
  | { timestampValue: TimestampLike }
  | { stringValue: string }
  | { bytesValue: Buffer | Uint8Array | string }
  | { referenceValue: string }
  | { geoPointValue: { latitude?: number; longitude?: number } }
  | { arrayValue: { values?: FirestoreListenValue[] } }
  | { mapValue: { fields?: Record<string, FirestoreListenValue> } };

type FirestoreGrpcClient = grpc.Client & {
  listen(metadata: grpc.Metadata): grpc.ClientDuplexStream<ListenRequest, ListenResponse>;
};

let firestoreClientConstructor: grpc.ServiceClientConstructor | null = null;
let firestoreTypes: FirestoreTypes | null = null;

const targetId = 1;
const initialReconnectBackoffMs = 1_000;
const maxReconnectBackoffMs = 30_000;
const stableStreamResetMs = 60_000;
const retryableStatusCodes = new Set<number>([
  grpc.status.CANCELLED,
  grpc.status.UNKNOWN,
  grpc.status.DEADLINE_EXCEEDED,
  grpc.status.RESOURCE_EXHAUSTED,
  grpc.status.ABORTED,
  grpc.status.INTERNAL,
  grpc.status.UNAVAILABLE,
  grpc.status.DATA_LOSS
]);
const grpcKeepaliveOptions: grpc.ChannelOptions = {
  "grpc.keepalive_time_ms": 60_000,
  "grpc.keepalive_timeout_ms": 20_000,
  "grpc.keepalive_permit_without_calls": 1,
  "grpc.http2.min_time_between_pings_ms": 30_000,
  "grpc.http2.max_pings_without_data": 0
};

class FirestoreListenTargetError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number
  ) {
    super(`Firestore listen target failed: ${message}`);
  }
}

export class FirestoreListenClient {
  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger
  ) {}

  async listenChatMessages(options: ListenChatMessagesOptions): Promise<void> {
    const state: ListenSessionState = {
      seen: new Set<string>(),
      startupSnapshotComplete: false,
      lastCurrentAt: null,
      currentGeneration: 0
    };
    let reconnectAttempt = 0;
    let forceRefreshAuth = false;
    let authRetryUsed = false;
    let authRetryCurrentGeneration = 0;

    while (!options.signal?.aborted) {
      try {
        await this.openChatMessagesStream({ ...options, state, forceRefreshAuth });
        if (options.signal?.aborted) {
          return;
        }

        reconnectAttempt = reconnectAttemptAfterStream(reconnectAttempt, state.lastCurrentAt);
        forceRefreshAuth = false;
        authRetryUsed = false;
        const backoffMs = reconnectBackoffMs(reconnectAttempt++);
        this.logger.warn("Firestore listen stream ended; reconnecting.", {
          kinId: options.kinId,
          backoffMs
        });
        await delay(backoffMs, options.signal);
      } catch (error) {
        if (options.signal?.aborted) {
          return;
        }

        const statusCode = grpcStatusCode(error);
        if (authRetryUsed && state.currentGeneration > authRetryCurrentGeneration) {
          authRetryUsed = false;
        }

        const authError = isAuthStatus(statusCode);
        if (authError && authRetryUsed) {
          throw new Error(
            `Firestore listen authentication failed after token refresh. Save a fresh Kindroid session. ${errorMessage(
              error
            )}`,
            { cause: error }
          );
        }

        if (!authError && !isRetryableStatus(statusCode)) {
          throw error;
        }

        reconnectAttempt = reconnectAttemptAfterStream(reconnectAttempt, state.lastCurrentAt);
        forceRefreshAuth = authError;
        authRetryUsed = authError;
        if (authError) {
          authRetryCurrentGeneration = state.currentGeneration;
        }

        const backoffMs = authError ? 0 : reconnectBackoffMs(reconnectAttempt++);
        this.logger.warn("Firestore listen stream disconnected; reconnecting.", {
          kinId: options.kinId,
          statusCode,
          forceRefreshAuth,
          backoffMs,
          error: errorMessage(error)
        });
        await delay(backoffMs, options.signal);
      }
    }
  }

  private async openChatMessagesStream(options: OpenStreamOptions): Promise<void> {
    const auth = await loadFreshFirebaseAuth(this.config.bridge.sessionDir, { forceRefresh: options.forceRefreshAuth });
    const session = loadBrowserSession(this.config.bridge.sessionDir);
    const appCheck = extractFirebaseAppCheckState(session.storageState);
    const uid = this.config.kindroid.uid || auth.uid;
    const database = firestoreDatabase(this.config.kindroid.firebaseProjectId);
    const parent = `${database}/documents/Users/${uid}/AIs/${options.kinId}`;
    const client = createFirestoreClient();
    const metadata = new grpc.Metadata();
    let initialized = false;
    const startupDocuments: FirestoreDocumentLike[] = [];
    const startupDocumentIds = new Set<string>();
    let initialDocumentCount = 0;
    let pending = Promise.resolve();

    metadata.set("authorization", `Bearer ${auth.accessToken}`);
    metadata.set("google-cloud-resource-prefix", database);
    metadata.set("x-goog-request-params", `database=${encodeURIComponent(database)}`);

    if (appCheck?.token) {
      metadata.set("x-firebase-appcheck", appCheck.token);
    }

    this.logger.info("Starting Firestore listen stream.", {
      projectId: this.config.kindroid.firebaseProjectId,
      kinId: options.kinId,
      pageSize: options.limit,
      reconnect: options.state.startupSnapshotComplete,
      forceRefreshAuth: options.forceRefreshAuth
    });

    await new Promise<void>((resolve, reject) => {
      const call = client.listen(metadata);
      let settled = false;
      const abort = () => {
        if (settled) {
          return;
        }

        settled = true;
        call.cancel();
        client.close();
        resolve();
      };

      if (options.signal?.aborted) {
        abort();
        return;
      }

      options.signal?.addEventListener("abort", abort, { once: true });

      const settleReject = (error: unknown) => {
        if (settled) {
          return;
        }

        settled = true;
        options.signal?.removeEventListener("abort", abort);
        client.close();
        reject(error);
      };

      const settleResolve = () => {
        if (settled) {
          return;
        }

        settled = true;
        options.signal?.removeEventListener("abort", abort);
        client.close();
        resolve();
      };

      call.on("data", (response: ListenResponse) => {
        pending = pending
          .then(async () => {
            const targetChange = response.targetChange;
            if (targetChange?.cause?.message) {
              throw new FirestoreListenTargetError(targetChange.cause.message, targetChange.cause.code);
            }

            if (targetChange?.targetChangeType === "CURRENT") {
              initialized = true;
              options.state.lastCurrentAt = Date.now();
              options.state.currentGeneration += 1;
              if (!options.state.startupSnapshotComplete) {
                options.state.startupSnapshotComplete = true;
              } else {
                for (const document of startupDocuments.reverse()) {
                  options.state.seen.add(document.id);
                  await options.onDocument(document);
                }
              }

              this.logger.info("Firestore listen stream is current.", {
                kinId: options.kinId,
                initialDocuments: initialDocumentCount,
                catchupDocuments: startupDocuments.length
              });
              return;
            }

            const listenDocument = response.documentChange?.document;
            if (!listenDocument?.name) {
              return;
            }

            const document = firestoreDocumentLike(listenDocument);
            if (options.state.seen.has(document.id) || startupDocumentIds.has(document.id)) {
              return;
            }

            if (initialized) {
              options.state.seen.add(document.id);
              await options.onDocument(document);
              return;
            }

            initialDocumentCount += 1;
            if (options.state.startupSnapshotComplete) {
              startupDocumentIds.add(document.id);
              startupDocuments.push(document);
              return;
            }

            options.state.seen.add(document.id);
          })
          .catch((error: unknown) => {
            settleReject(error instanceof Error ? error : new Error(String(error)));
            call.cancel();
          });
      });

      call.on("error", (error: grpc.ServiceError) => {
        if (options.signal?.aborted || error.code === grpc.status.CANCELLED) {
          settleResolve();
          return;
        }

        settleReject(error);
      });

      call.on("end", () => {
        if (options.signal?.aborted) {
          settleResolve();
          return;
        }

        pending.then(settleResolve, settleReject);
      });

      call.write(buildListenRequest(database, parent, options.limit));
    });
  }
}

function createFirestoreClient(): FirestoreGrpcClient {
  const Firestore = loadFirestoreClientConstructor();
  return new Firestore(
    "firestore.googleapis.com:443",
    grpc.credentials.createSsl(),
    grpcKeepaliveOptions
  ) as unknown as FirestoreGrpcClient;
}

function reconnectBackoffMs(attempt: number): number {
  const base = Math.min(maxReconnectBackoffMs, initialReconnectBackoffMs * 2 ** Math.min(attempt, 6));
  return Math.floor(base * (0.75 + Math.random() * 0.5));
}

function reconnectAttemptAfterStream(attempt: number, lastCurrentAt: number | null): number {
  if (lastCurrentAt && Date.now() - lastCurrentAt >= stableStreamResetMs) {
    return 0;
  }

  return attempt;
}

function isRetryableStatus(statusCode: number | undefined): boolean {
  return statusCode === undefined || retryableStatusCodes.has(statusCode);
}

function isAuthStatus(statusCode: number | undefined): boolean {
  return statusCode === grpc.status.UNAUTHENTICATED;
}

function grpcStatusCode(error: unknown): number | undefined {
  if (error instanceof FirestoreListenTargetError) {
    return error.statusCode;
  }

  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "number" ? code : undefined;
  }

  return undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (ms <= 0 || signal?.aborted) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const finish = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    const abort = () => {
      clearTimeout(timer);
      finish();
    };

    signal?.addEventListener("abort", abort, { once: true });
  });
}

function loadFirestoreClientConstructor(): grpc.ServiceClientConstructor {
  if (firestoreClientConstructor) {
    return firestoreClientConstructor;
  }

  const serviceDefinition = {
    listen: {
      path: "/google.firestore.v1.Firestore/Listen",
      requestStream: true,
      responseStream: true,
      requestSerialize: serializeListenRequest,
      requestDeserialize: deserializeListenRequest,
      responseSerialize: serializeListenResponse,
      responseDeserialize: deserializeListenResponse
    }
  };
  const Firestore = grpc.makeGenericClientConstructor(serviceDefinition, "Firestore");
  firestoreClientConstructor = Firestore;
  return Firestore;
}

interface FirestoreTypes {
  listenRequest: protobuf.Type;
  listenResponse: protobuf.Type;
}

function loadFirestoreTypes(): FirestoreTypes {
  if (firestoreTypes) {
    return firestoreTypes;
  }

  const root = new protobuf.Root();
  for (const schema of protobufCommonSchemas) {
    protobuf.parse(schema, root);
  }
  protobuf.parse(firestoreListenSchema, root);
  root.resolveAll();

  firestoreTypes = {
    listenRequest: root.lookupType("google.firestore.v1.ListenRequest"),
    listenResponse: root.lookupType("google.firestore.v1.ListenResponse")
  };
  return firestoreTypes;
}

function serializeListenRequest(value: ListenRequest): Buffer {
  const type = loadFirestoreTypes().listenRequest;
  return Buffer.from(type.encode(type.fromObject(value)).finish());
}

function deserializeListenRequest(buffer: Buffer): ListenRequest {
  const type = loadFirestoreTypes().listenRequest;
  return type.toObject(type.decode(buffer), protobufConversionOptions) as ListenRequest;
}

function serializeListenResponse(value: ListenResponse): Buffer {
  const type = loadFirestoreTypes().listenResponse;
  return Buffer.from(type.encode(type.fromObject(value)).finish());
}

function deserializeListenResponse(buffer: Buffer): ListenResponse {
  const type = loadFirestoreTypes().listenResponse;
  return type.toObject(type.decode(buffer), protobufConversionOptions) as ListenResponse;
}

const protobufConversionOptions: protobuf.IConversionOptions = {
  bytes: Buffer,
  defaults: false,
  enums: String,
  longs: String,
  oneofs: true
};

const protobufCommonSchemas = [
  `
syntax = "proto3";

package google.protobuf;

message Any {
  string type_url = 1;
  bytes value = 2;
}

message Int32Value {
  int32 value = 1;
}

message Timestamp {
  int64 seconds = 1;
  int32 nanos = 2;
}

enum NullValue {
  NULL_VALUE = 0;
}
`,
  `
syntax = "proto3";

package google.rpc;

message Status {
  int32 code = 1;
  string message = 2;
  repeated google.protobuf.Any details = 3;
}
`,
  `
syntax = "proto3";

package google.type;

message LatLng {
  double latitude = 1;
  double longitude = 2;
}
`
];

const firestoreListenSchema = `
syntax = "proto3";

package google.firestore.v1;

service Firestore {
  rpc Listen(stream ListenRequest) returns (stream ListenResponse);
}

message ListenRequest {
  string database = 1;
  oneof target_change {
    Target add_target = 2;
    int32 remove_target = 3;
  }
  map<string, string> labels = 4;
}

message ListenResponse {
  oneof response_type {
    TargetChange target_change = 2;
    DocumentChange document_change = 3;
    DocumentDelete document_delete = 4;
    ExistenceFilter filter = 5;
    DocumentRemove document_remove = 6;
  }
}

message Target {
  message DocumentsTarget {
    repeated string documents = 2;
  }

  message QueryTarget {
    string parent = 1;
    oneof query_type {
      StructuredQuery structured_query = 2;
    }
  }

  oneof target_type {
    QueryTarget query = 2;
    DocumentsTarget documents = 3;
  }
  bytes resume_token = 4;
  int32 target_id = 5;
  bool once = 6;
  google.protobuf.Timestamp read_time = 11;
}

message TargetChange {
  enum TargetChangeType {
    NO_CHANGE = 0;
    ADD = 1;
    REMOVE = 2;
    CURRENT = 3;
    RESET = 4;
  }

  TargetChangeType target_change_type = 1;
  repeated int32 target_ids = 2;
  google.rpc.Status cause = 3;
  bytes resume_token = 4;
  google.protobuf.Timestamp read_time = 6;
}

message StructuredQuery {
  message CollectionSelector {
    string collection_id = 2;
    bool all_descendants = 3;
  }

  message Order {
    FieldReference field = 1;
    Direction direction = 2;
  }

  enum Direction {
    DIRECTION_UNSPECIFIED = 0;
    ASCENDING = 1;
    DESCENDING = 2;
  }

  message FieldReference {
    string field_path = 2;
  }

  repeated CollectionSelector from = 2;
  repeated Order order_by = 4;
  google.protobuf.Int32Value limit = 5;
}

message DocumentChange {
  Document document = 1;
  repeated int32 target_ids = 5;
  repeated int32 removed_target_ids = 6;
}

message DocumentDelete {
  string document = 1;
  repeated int32 removed_target_ids = 6;
  google.protobuf.Timestamp read_time = 4;
}

message DocumentRemove {
  string document = 1;
  repeated int32 removed_target_ids = 2;
  google.protobuf.Timestamp read_time = 4;
}

message ExistenceFilter {
  int32 target_id = 1;
  int32 count = 2;
}

message Document {
  string name = 1;
  map<string, Value> fields = 2;
  google.protobuf.Timestamp create_time = 3;
  google.protobuf.Timestamp update_time = 4;
}

message Value {
  oneof value_type {
    bool boolean_value = 1;
    int64 integer_value = 2;
    double double_value = 3;
    string reference_value = 5;
    MapValue map_value = 6;
    google.type.LatLng geo_point_value = 8;
    ArrayValue array_value = 9;
    google.protobuf.Timestamp timestamp_value = 10;
    google.protobuf.NullValue null_value = 11;
    string string_value = 17;
    bytes bytes_value = 18;
  }
}

message ArrayValue {
  repeated Value values = 1;
}

message MapValue {
  map<string, Value> fields = 1;
}
`;

function buildListenRequest(database: string, parent: string, limit: number): ListenRequest {
  return {
    database,
    addTarget: {
      query: {
        parent,
        structuredQuery: {
          from: [{ collectionId: "ChatMessages" }],
          orderBy: [{ field: { fieldPath: "timestamp" }, direction: "DESCENDING" }],
          limit: { value: limit }
        }
      },
      targetId
    }
  };
}

function firestoreDatabase(projectId: string): string {
  return `projects/${projectId}/databases/(default)`;
}

function firestoreDocumentLike(document: FirestoreListenDocument): FirestoreDocumentLike {
  const name = document.name ?? "";
  return {
    id: name.split("/").pop() ?? name,
    data: () => ({
      ...decodeFields(document.fields ?? {}),
      _firestoreName: name,
      _createTime: timestampIso(document.createTime),
      _updateTime: timestampIso(document.updateTime)
    })
  };
}

function decodeFields(fields: Record<string, FirestoreListenValue>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]));
}

function decodeValue(value: FirestoreListenValue): unknown {
  if ("nullValue" in value) {
    return null;
  }

  if ("booleanValue" in value) {
    return value.booleanValue;
  }

  if ("integerValue" in value) {
    return Number(value.integerValue);
  }

  if ("doubleValue" in value) {
    return value.doubleValue;
  }

  if ("timestampValue" in value) {
    return timestampIso(value.timestampValue);
  }

  if ("stringValue" in value) {
    return value.stringValue;
  }

  if ("bytesValue" in value) {
    return Buffer.isBuffer(value.bytesValue) ? value.bytesValue.toString("base64") : String(value.bytesValue);
  }

  if ("referenceValue" in value) {
    return value.referenceValue;
  }

  if ("geoPointValue" in value) {
    return value.geoPointValue;
  }

  if ("arrayValue" in value) {
    return (value.arrayValue.values ?? []).map(decodeValue);
  }

  if ("mapValue" in value) {
    return decodeFields(value.mapValue.fields ?? {});
  }

  return value;
}

function timestampIso(value: TimestampLike | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  if (typeof value === "string") {
    return value;
  }

  const seconds = Number(value.seconds ?? 0);
  const nanos = Number(value.nanos ?? 0);
  return new Date(seconds * 1000 + Math.floor(nanos / 1_000_000)).toISOString();
}
