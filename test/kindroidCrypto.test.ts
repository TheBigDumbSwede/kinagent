import CryptoJS from "crypto-js";
import { describe, expect, it } from "vitest";
import { decryptKindroidValue } from "../src/kindroid/kindroidCrypto.js";

describe("decryptKindroidValue", () => {
  it("returns plaintext values unchanged", () => {
    expect(decryptKindroidValue("hello", "uid")).toEqual({
      encrypted: false,
      decrypted: false,
      value: "hello"
    });
  });

  it("decrypts Kindroid !enc values with the supplied UID passphrase", () => {
    const ciphertext = `!enc:${CryptoJS.AES.encrypt("private message", "firebase-uid").toString()}`;

    expect(decryptKindroidValue(ciphertext, "firebase-uid")).toEqual({
      encrypted: true,
      decrypted: true,
      value: "private message"
    });
  });

  it("leaves encrypted values intact when the passphrase does not decrypt to UTF-8 plaintext", () => {
    const ciphertext = `!enc:${CryptoJS.AES.encrypt("private message", "firebase-uid").toString()}`;
    const result = decryptKindroidValue(ciphertext, "wrong-uid");

    expect(result.encrypted).toBe(true);
    expect(result.decrypted).toBe(false);
    expect(result.value).toBe(ciphertext);
  });
});
