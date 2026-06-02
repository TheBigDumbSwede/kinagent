import CryptoJS from "crypto-js";

const encryptedPrefix = "!enc:";

export interface KindroidDecryptionResult {
  encrypted: boolean;
  decrypted: boolean;
  value: string;
  error?: string;
}

export function decryptKindroidValue(value: string, key: string): KindroidDecryptionResult {
  if (!value.startsWith(encryptedPrefix)) {
    return {
      encrypted: false,
      decrypted: false,
      value
    };
  }

  try {
    const bytes = CryptoJS.AES.decrypt(value.slice(encryptedPrefix.length), key);
    const plaintext = bytes.toString(CryptoJS.enc.Utf8);
    const decrypted = bytes.sigBytes >= 0 && isPlausiblePlaintext(plaintext, bytes.sigBytes);

    return {
      encrypted: true,
      decrypted,
      value: decrypted ? plaintext : value,
      ...(decrypted ? {} : { error: "Decrypted plaintext failed sanity checks." })
    };
  } catch (error) {
    return {
      encrypted: true,
      decrypted: false,
      value,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function isPlausiblePlaintext(value: string, byteLength: number): boolean {
  if (value.length === 0) {
    return byteLength === 0;
  }

  if (!isWellFormedString(value) || value.includes("\uFFFD")) {
    return false;
  }

  for (const char of value) {
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined) {
      return false;
    }

    const allowedWhitespace = codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d;
    const c0Control = codePoint < 0x20;
    const c1Control = codePoint >= 0x7f && codePoint <= 0x9f;
    if ((c0Control && !allowedWhitespace) || c1Control) {
      return false;
    }
  }

  return true;
}

function isWellFormedString(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        return false;
      }
      index += 1;
      continue;
    }

    if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }

  return true;
}
