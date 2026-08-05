/**
 * Unified session resolution for real (Spotify OAuth) and demo visitors.
 *
 * A real signed-in user always takes precedence. Otherwise, a visitor
 * holding the demo cookie resolves to the shared, read-only demo user
 * (its id is looked up server-side, never carried in the cookie, so the
 * cookie can't be forged to point at a real account). The demo user has
 * only fabricated playlists and its writes are no-ops, so this is safe.
 */

import { cookies } from "next/headers";

import { auth } from "@/auth";
import { getDemoUserId } from "@/lib/db/demo";

export const DEMO_COOKIE = "pigeonhole_demo";

export interface ResolvedSession {
  userId: string;
  isDemo: boolean;
}

export async function resolveSession(): Promise<ResolvedSession | null> {
  const session = await auth();
  if (session?.userId) {
    return { userId: session.userId, isDemo: false };
  }
  const store = await cookies();
  if (store.get(DEMO_COOKIE)?.value === "1") {
    const demoUserId = await getDemoUserId();
    if (demoUserId) {
      return { userId: demoUserId, isDemo: true };
    }
  }
  return null;
}
