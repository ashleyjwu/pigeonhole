import { randomBytes } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { decryptToken, encryptToken, keyFromEnv } from "./index";

const key = randomBytes(32);

describe("encryptToken / decryptToken", () => {
  it("round-trips a token", () => {
    const packed = encryptToken("BQDsomething-secret", key);
    expect(decryptToken(packed, key)).toBe("BQDsomething-secret");
  });

  it("round-trips unicode and long payloads", () => {
    const plaintext = "tökén-🎵-".repeat(500);
    expect(decryptToken(encryptToken(plaintext, key), key)).toBe(plaintext);
  });

  it("produces a different ciphertext each call (random IV)", () => {
    const a = encryptToken("same-input", key);
    const b = encryptToken("same-input", key);
    expect(a.equals(b)).toBe(false);
  });

  it("rejects tampered ciphertext", () => {
    const packed = encryptToken("secret", key);
    const lastIndex = packed.length - 1;
    const tampered = Buffer.from(packed);
    tampered[lastIndex] = (packed[lastIndex] ?? 0) ^ 0xff;
    expect(() => decryptToken(tampered, key)).toThrow();
  });

  it("rejects a tampered auth tag", () => {
    const packed = encryptToken("secret", key);
    const tampered = Buffer.from(packed);
    tampered[12] = (packed[12] ?? 0) ^ 0xff; // first byte of the tag
    expect(() => decryptToken(tampered, key)).toThrow();
  });

  it("rejects the wrong key", () => {
    const packed = encryptToken("secret", key);
    expect(() => decryptToken(packed, randomBytes(32))).toThrow();
  });

  it("rejects payloads shorter than iv+tag", () => {
    expect(() => decryptToken(Buffer.alloc(10), key)).toThrow(/too short/);
  });
});

describe("keyFromEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the decoded key when valid", () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    expect(keyFromEnv().length).toBe(32);
  });

  it("throws when unset", () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "");
    expect(() => keyFromEnv()).toThrow(/not set/);
  });

  it("throws when the wrong length", () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(16).toString("base64"));
    expect(() => keyFromEnv()).toThrow(/32 bytes/);
  });
});
