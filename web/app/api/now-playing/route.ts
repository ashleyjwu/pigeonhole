import { NextResponse } from "next/server";

import { pickRandomDemoTrack } from "@/lib/db/demo";
import { resolveSession } from "@/lib/session";
import { SpotifyClient, SpotifyQuotaError, type TrackSummary } from "@/lib/spotify/client";
import { getValidAccessToken } from "@/lib/spotify/tokens";
import { getSuggestionsForTrack, type AnnotatedSuggestion } from "@/lib/suggest";

export type NowPlayingPayload =
  | { state: "unauthenticated" }
  | { state: "nothing-playing" }
  | { state: "quota-exhausted" }
  | { state: "playing"; track: TrackSummary; suggestions: AnnotatedSuggestion[] };

export async function GET(): Promise<NextResponse<NowPlayingPayload>> {
  const session = await resolveSession();
  if (!session) {
    return NextResponse.json({ state: "unauthenticated" }, { status: 401 });
  }

  // Demo visitors have no live Spotify player: stand in a random track from
  // the demo library and score it against the demo playlists (pure Postgres,
  // no Spotify calls, no quota).
  if (session.isDemo) {
    const track = await pickRandomDemoTrack(session.userId);
    if (!track) {
      return NextResponse.json({ state: "nothing-playing" });
    }
    const suggestions = await getSuggestionsForTrack(session.userId, track, { limit: 3 });
    return NextResponse.json({ state: "playing", track, suggestions });
  }

  try {
    const accessToken = await getValidAccessToken(session.userId);
    const track = await new SpotifyClient(accessToken).getCurrentlyPlaying();
    if (!track) {
      return NextResponse.json({ state: "nothing-playing" });
    }

    const suggestions = await getSuggestionsForTrack(session.userId, track, { limit: 3 });
    return NextResponse.json({ state: "playing", track, suggestions });
  } catch (error) {
    if (error instanceof SpotifyQuotaError) {
      return NextResponse.json({ state: "quota-exhausted" }, { status: 503 });
    }
    throw error;
  }
}
