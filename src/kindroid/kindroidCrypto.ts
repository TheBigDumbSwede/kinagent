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
    const decrypted = bytes.sigBytes >= 0 && (plaintext.length > 0 || bytes.sigBytes === 0);

    return {
      encrypted: true,
      decrypted,
      value: decrypted ? plaintext : value
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
