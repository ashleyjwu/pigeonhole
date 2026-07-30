/**
 * AES-256-GCM encryption for Spotify tokens at rest.
 *
 * Packed format: iv (12 bytes) || auth tag (16 bytes) || ciphertext.
 * GCM authenticates the payload, so any tampering fails decryption loudly.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

/** Read and validate the 32-byte base64 key from TOKEN_ENCRYPTION_KEY. */
export function keyFromEnv(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("TOKEN_ENCRYPTION_KEY is not set (generate with: openssl rand -base64 32)");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_LENGTH) {
    throw new Error("TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes");
  }
  return key;
}

export function encryptToken(plaintext: string, key: Buffer = keyFromEnv()): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptToken(packed: Buffer, key: Buffer = keyFromEnv()): string {
  if (packed.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error("Encrypted payload is too short to be valid");
  }
  const iv = packed.subarray(0, IV_LENGTH);
  const tag = packed.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = packed.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
