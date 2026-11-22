import { afterEach, describe, expect, it } from "@/lib/test-runtime";
import { decryptChannelCredential, encryptChannelCredential } from "@/lib/channels/credentials";

const originalKey = process.env.CHANNEL_CREDENTIALS_ENCRYPTION_KEY;

afterEach(() => {
  if (originalKey === undefined) delete process.env.CHANNEL_CREDENTIALS_ENCRYPTION_KEY;
  else process.env.CHANNEL_CREDENTIALS_ENCRYPTION_KEY = originalKey;
});

describe("Meta channel credential vault", () => {
  it("encrypts and decrypts provider tokens with authenticated encryption", () => {
    process.env.CHANNEL_CREDENTIALS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    const encrypted = encryptChannelCredential("provider-access-token");
    expect(encrypted).not.toContain("provider-access-token");
    expect(decryptChannelCredential(encrypted)).toBe("provider-access-token");
  });

  it("rejects tampering and malformed ciphertext", () => {
    process.env.CHANNEL_CREDENTIALS_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
    const encrypted = encryptChannelCredential("secret-token");
    const [iv, tag, cipher] = encrypted.split(".");
    const tampered = [iv, tag, cipher.slice(0, -1) + "A"].join(".");
    expect(() => decryptChannelCredential(tampered)).toThrow();
    expect(() => decryptChannelCredential("not-a-ciphertext")).toThrow();
  });

  it("fails closed without a 32-byte key", () => {
    delete process.env.CHANNEL_CREDENTIALS_ENCRYPTION_KEY;
    expect(() => encryptChannelCredential("secret")).toThrow(/32-byte key/);
  });
});
