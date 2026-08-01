import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("pg", async () => {
  const { EventEmitter } = await import("node:events");
  class FakePool extends EventEmitter {
    constructor(public options: unknown) {
      super();
    }
  }
  return { Pool: FakePool };
});

describe("getPool", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "postgresql://user:pass@host/db");
    delete (globalThis as Record<string, unknown>).pigeonholePool;
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete (globalThis as Record<string, unknown>).pigeonholePool;
  });

  it("registers an 'error' listener so an idle-client error cannot crash the process", async () => {
    const { getPool } = await import("./pool");
    const pool = getPool();

    // Simulating exactly what pg does when a pooled idle connection drops
    // (e.g. Neon suspending its compute). Without a listener, EventEmitter
    // would rethrow this as an uncaught exception.
    expect(() => pool.emit("error", new Error("read EADDRNOTAVAIL"))).not.toThrow();
  });

  it("reuses the same pool across calls (no connection leak on hot reload)", async () => {
    const { getPool } = await import("./pool");
    expect(getPool()).toBe(getPool());
  });

  it("throws a clear error when DATABASE_URL is unset", async () => {
    vi.unstubAllEnvs();
    const { getPool } = await import("./pool");
    expect(() => getPool()).toThrow(/DATABASE_URL/);
  });
});
