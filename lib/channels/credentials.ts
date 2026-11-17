import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function encryptionKey() {
  const raw = process.env.CHANNEL_CREDENTIALS_ENCRYPTION_KEY || "";
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("CHANNEL_CREDENTIALS_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  }
  return key;
}

/** AES-256-GCM envelope for provider tokens; plaintext tokens never enter SQL. */
export function encryptChannelCredential(value: string) {
  if (!value || value.length > 16_384) throw new Error("Invalid provider credential");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map(part => part.toString("base64url")).join(".");
}

export function decryptChannelCredential(value: string) {
  const parts = value.split(".");
  if (parts.length !== 3 || parts.some(part => !part)) throw new Error("Invalid encrypted provider credential");
  const [ivText, tagText, ciphertextText] = parts;
  const iv = Buffer.from(ivText, "base64url");
  const tag = Buffer.from(tagText, "base64url");
  const ciphertext = Buffer.from(ciphertextText, "base64url");
  if (iv.length !== 12 || tag.length !== 16 || !ciphertext.length) {
    throw new Error("Invalid encrypted provider credential");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
