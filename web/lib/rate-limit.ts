/**
 * Best-effort in-process rate limiting for the public demo's real Spotify
 * search, to protect the shared dev-mode API quota from casual abuse.
 *
 * Two limits: a per-IP sliding window (default 10/min) and a global daily
 * cap across all demo visitors. Both are in-memory, so on multi-instance
 * serverless each instance counts independently — fine for a low-traffic
 * portfolio demo, but a shared store (Upstash/DB) would be the upgrade for
 * strict global enforcement. Kept dependency-free for now.
 */

const PER_IP_LIMIT = 10;
const PER_IP_WINDOW_MS = 60_000;
const GLOBAL_DAILY_LIMIT = 2_000;

const ipHits = new Map<string, number[]>();
let globalDay = "";
let globalCount = 0;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface RateLimitResult {
  allowed: boolean;
  reason?: "per-ip" | "global";
}

/**
 * Record and check one demo-search attempt from `ip`. Returns whether it is
 * allowed; when blocked, `reason` says which limit was hit.
 */
export function checkDemoSearchLimit(ip: string): RateLimitResult {
  const now = Date.now();

  // Global daily cap (resets at UTC midnight).
  const day = today();
  if (day !== globalDay) {
    globalDay = day;
    globalCount = 0;
  }
  if (globalCount >= GLOBAL_DAILY_LIMIT) {
    return { allowed: false, reason: "global" };
  }

  // Per-IP sliding window.
  const windowStart = now - PER_IP_WINDOW_MS;
  const hits = (ipHits.get(ip) ?? []).filter((t) => t > windowStart);
  if (hits.length >= PER_IP_LIMIT) {
    ipHits.set(ip, hits);
    return { allowed: false, reason: "per-ip" };
  }

  hits.push(now);
  ipHits.set(ip, hits);
  globalCount += 1;
  return { allowed: true };
}

/** Extract a client IP from request headers (Vercel sets x-forwarded-for). */
export function clientIpFrom(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]!.trim();
  }
  return headers.get("x-real-ip") ?? "unknown";
}

const ACCESS_REQUEST_LIMIT = 3;
const ACCESS_REQUEST_WINDOW_MS = 10 * 60_000;

const accessRequestHits = new Map<string, number[]>();

/** Throttle the public access-request form (default 3 per 10 min per IP). */
export function checkAccessRequestLimit(ip: string): boolean {
  const now = Date.now();
  const windowStart = now - ACCESS_REQUEST_WINDOW_MS;
  const hits = (accessRequestHits.get(ip) ?? []).filter((t) => t > windowStart);
  if (hits.length >= ACCESS_REQUEST_LIMIT) {
    accessRequestHits.set(ip, hits);
    return false;
  }
  hits.push(now);
  accessRequestHits.set(ip, hits);
  return true;
}
