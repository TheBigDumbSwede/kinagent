import CryptoJS from "crypto-js";
import { describe, expect, it } from "vitest";
import { captureValue } from "../src/capture/kinStateCapture.js";

describe("captureValue", () => {
  it("decrypts encrypted strings inside captured arrays", () => {
    const encryptedKeyphrase = `!enc:${CryptoJS.AES.encrypt("shared wonder", "firebase-uid").toString()}`;
    const captured = captureValue(["beauty", encryptedKeyphrase], "firebase-uid");

    expect(captured).toMatchObject({
      kind: "array",
      count: 2,
      encrypted: true,
      decrypted: true,
      value: ["beauty", "shared wonder"]
    });
    expect(captured).not.toHaveProperty("rawValue");
  });

  it("decrypts encrypted strings inside captured objects", () => {
    const encryptedLabel = `!enc:${CryptoJS.AES.encrypt("quiet attention", "firebase-uid").toString()}`;
    const captured = captureValue({ label: encryptedLabel, weight: 3 }, "firebase-uid");

    expect(captured).toMatchObject({
      kind: "object",
      encrypted: true,
      decrypted: true,
      value: {
        label: "quiet attention",
        weight: 3
      }
    });
    expect(captured).not.toHaveProperty("rawValue");
  });
});
