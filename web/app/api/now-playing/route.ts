import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { playlistsContainingTrack } from "@/lib/db/library";
import { loadPlaylistProfiles } from "@/lib/db/profiles";
import { SpotifyClient, SpotifyQuotaError, type TrackSummary } from "@/lib/spotify/client";
import { getValidAccessToken } from "@/lib/spotify/tokens";
import { suggestForTrack, type AnnotatedSuggestion } from "@/lib/suggest";

export type NowPlayingPayload =
  | { state: "unauthenticated" }
  | { state: "nothing-playing" }
  | { state: "quota-exhausted" }
  | { state: "playing"; track: TrackSummary; suggestions: AnnotatedSuggestion[] };

export async function GET(): Promise<NextResponse<NowPlayingPayload>> {
  const session = await auth();
  if (!session?.userId) {
    return NextResponse.json({ state: "unauthenticated" }, { status: 401 });
  }

  try {
    const accessToken = await getValidAccessToken(session.userId);
    const track = await new SpotifyClient(accessToken).getCurrentlyPlaying();
    if (!track) {
      return NextResponse.json({ state: "nothing-playing" });
    }

    const profiles = await loadPlaylistProfiles();
    const members = await playlistsContainingTrack(
      track.id,
      profiles.map((p) => p.playlistId),
    );
    const suggestions = suggestForTrack(track, profiles, members, { limit: 3 });
    return NextResponse.json({ state: "playing", track, suggestions });
  } catch (error) {
    if (error instanceof SpotifyQuotaError) {
      return NextResponse.json({ state: "quota-exhausted" }, { status: 503 });
    }
    throw error;
  }
}
