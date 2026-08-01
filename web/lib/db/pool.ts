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
    const pool = new Pool({ connectionString, max: 5 });
    // REQUIRED: pg emits 'error' on the pool when an *idle* client's
    // connection dies (e.g. Neon's free tier suspends its compute after
    // inactivity and drops the socket — the EADDRNOTAVAIL/ECONNRESET this
    // guards against). With no listener, Node treats that as an uncaught
    // exception and kills the whole process. Logging and swallowing it lets
    // the pool quietly open a fresh connection on the next query instead.
    pool.on("error", (error) => {
      console.error("Postgres pool idle client error (recovering):", error.message);
    });
    globalForPool.pigeonholePool = pool;
  }
  return globalForPool.pigeonholePool;
}
