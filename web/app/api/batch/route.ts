import { NextResponse } from "next/server";

import { getTrackGenreTagsBatch } from "@/lib/db/genres";
import { findUnfiledSavedTracks } from "@/lib/db/library";
import { loadPlaylistProfiles } from "@/lib/db/profiles";
import { suggestPlaylists } from "@/lib/scoring/score";
import { resolveSession } from "@/lib/session";
import type { Suggestion } from "@/lib/scoring/types";
import type { TrackSummary } from "@/lib/spotify/client";

export interface BatchCard {
  track: TrackSummary;
  suggestions: Suggestion[];
}

export type BatchPayload =
  | { state: "unauthenticated" }
  | { state: "cards"; cards: BatchCard[] };

const MAX_CARDS = 100;

/**
 * The batch review queue: unfiled liked songs, each pre-scored against the
 * user's playlists. Pure Postgres — no Spotify calls, so this never touches
 * the API quota. (Membership is not annotated: these tracks are unfiled by
 * definition, so every suggestion is a genuine "not yet added" candidate.)
 */
export async function GET(): Promise<NextResponse<BatchPayload>> {
  const session = await resolveSession();
  if (!session) {
    return NextResponse.json({ state: "unauthenticated" }, { status: 401 });
  }

  const [unfiled, profiles] = await Promise.all([
    findUnfiledSavedTracks(session.userId, MAX_CARDS),
    loadPlaylistProfiles(session.userId),
  ]);

  const tagsByTrack = await getTrackGenreTagsBatch(
    new Map(unfiled.map((t) => [t.spotifyId, t.artistIds])),
  );

  const cards: BatchCard[] = unfiled.map((track) => {
    const summary: TrackSummary = {
      id: track.spotifyId,
      name: track.name,
      artistIds: track.artistIds,
      artistNames: track.artistNames,
      albumName: track.albumName,
      albumImageUrl: track.albumImageUrl,
      releaseYear: track.releaseYear,
      durationMs: track.durationMs,
      explicit: track.explicit,
    };
    const trackTags = tagsByTrack.get(track.spotifyId) ?? null;
    return {
      track: summary,
      suggestions: suggestPlaylists(summary, profiles, { limit: 3, trackTags }),
    };
  });

  return NextResponse.json({ state: "cards", cards });
}
