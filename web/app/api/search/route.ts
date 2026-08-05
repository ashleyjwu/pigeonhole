import { NextRequest, NextResponse } from "next/server";

import { checkDemoSearchLimit, clientIpFrom } from "@/lib/rate-limit";
import { resolveSession } from "@/lib/session";
import { getAppAccessToken } from "@/lib/spotify/app-token";
import { SpotifyClient, SpotifyQuotaError, type TrackSummary } from "@/lib/spotify/client";
import { getValidAccessToken } from "@/lib/spotify/tokens";
import { getSuggestionsForTrack, type AnnotatedSuggestion } from "@/lib/suggest";

export interface SearchResultItem {
  track: TrackSummary;
  suggestions: AnnotatedSuggestion[];
}

export type SearchPayload =
  | { state: "unauthenticated" }
  | { state: "quota-exhausted" }
  | { state: "rate-limited" }
  | { state: "empty-query" }
  | { state: "results"; results: SearchResultItem[] };

const MAX_RESULTS = 5;

export async function GET(request: NextRequest): Promise<NextResponse<SearchPayload>> {
  const session = await resolveSession();
  if (!session) {
    return NextResponse.json({ state: "unauthenticated" }, { status: 401 });
  }

  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!query) {
    return NextResponse.json({ state: "empty-query" });
  }

  const userId = session.userId;
  try {
    // Demo search uses an app-only (Client Credentials) token — no user
    // login, not tied to the 5-user allowlist — but is rate-limited to
    // protect the shared dev-mode quota.
    let accessToken: string;
    if (session.isDemo) {
      const limit = checkDemoSearchLimit(clientIpFrom(request.headers));
      if (!limit.allowed) {
        return NextResponse.json({ state: "rate-limited" }, { status: 429 });
      }
      accessToken = await getAppAccessToken();
    } else {
      accessToken = await getValidAccessToken(userId);
    }

    const tracks = await new SpotifyClient(accessToken).searchTracks(query, MAX_RESULTS);
    const results = await Promise.all(
      tracks.map(async (track) => ({
        track,
        suggestions: await getSuggestionsForTrack(userId, track, { limit: 3 }),
      })),
    );
    return NextResponse.json({ state: "results", results });
  } catch (error) {
    if (error instanceof SpotifyQuotaError) {
      return NextResponse.json({ state: "quota-exhausted" }, { status: 503 });
    }
    throw error;
  }
}
