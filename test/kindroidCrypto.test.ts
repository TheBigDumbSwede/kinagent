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

  it("decrypts encrypted empty values to empty strings", () => {
    const ciphertext = `!enc:${CryptoJS.AES.encrypt("", "firebase-uid").toString()}`;

    expect(decryptKindroidValue(ciphertext, "firebase-uid")).toEqual({
      encrypted: true,
      decrypted: true,
      value: ""
    });
  });

  it("leaves encrypted values intact when the passphrase does not decrypt to UTF-8 plaintext", () => {
    const deterministicSalt = CryptoJS.enc.Hex.parse("0001020304050607");
    const ciphertext = `!enc:${CryptoJS.AES.encrypt("private message", "firebase-uid", {
      salt: deterministicSalt
    }).toString()}`;
    const result = decryptKindroidValue(ciphertext, "wrong-uid");

    expect(result.encrypted).toBe(true);
    expect(result.decrypted).toBe(false);
    expect(result.value).toBe(ciphertext);
  });

  it("leaves encrypted values intact when decrypted text contains suspicious control characters", () => {
    const ciphertext = `!enc:${CryptoJS.AES.encrypt("private\u0000message", "firebase-uid").toString()}`;
    const result = decryptKindroidValue(ciphertext, "firebase-uid");

    expect(result.encrypted).toBe(true);
    expect(result.decrypted).toBe(false);
    expect(result.value).toBe(ciphertext);
    expect(result.error).toContain("sanity checks");
  });

  it("allows ordinary multiline decrypted text", () => {
    const ciphertext = `!enc:${CryptoJS.AES.encrypt("line one\nline two\tindented", "firebase-uid").toString()}`;

    expect(decryptKindroidValue(ciphertext, "firebase-uid")).toEqual({
      encrypted: true,
      decrypted: true,
      value: "line one\nline two\tindented"
    });
  });
});
