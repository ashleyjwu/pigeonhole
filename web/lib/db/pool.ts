import { Pool } from "pg";

// Cached on globalThis so Next.js dev-server hot reloads reuse one pool
// instead of leaking connections (Neon free tier has a low connection cap).
const globalForPool = globalThis as unknown as { pigeonholePool?: Pool };

export function getPool(): Pool {
  if (!globalForPool.pigeonholePool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set (see web/.env.example)");
    }
    globalForPool.pigeonholePool = new Pool({ connectionString, max: 5 });
  }
  return globalForPool.pigeonholePool;
}
