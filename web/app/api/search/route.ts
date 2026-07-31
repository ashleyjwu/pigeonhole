import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
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
  | { state: "empty-query" }
  | { state: "results"; results: SearchResultItem[] };

const MAX_RESULTS = 5;

export async function GET(request: NextRequest): Promise<NextResponse<SearchPayload>> {
  const session = await auth();
  if (!session?.userId) {
    return NextResponse.json({ state: "unauthenticated" }, { status: 401 });
  }

  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!query) {
    return NextResponse.json({ state: "empty-query" });
  }

  const userId = session.userId;
  try {
    const accessToken = await getValidAccessToken(userId);
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
