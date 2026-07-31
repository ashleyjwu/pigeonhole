/**
 * Compose the suggestion payload shared by the hero (now-playing) and search
 * flows: score a track against a user's profiles, then annotate with
 * membership so the UI can show "already in playlist" instead of "Add".
 */

import { loadPlaylistProfiles } from "@/lib/db/profiles";
import { playlistsContainingTrack } from "@/lib/db/library";
import { suggestPlaylists, type SuggestOptions } from "@/lib/scoring/score";
import type { Suggestion } from "@/lib/scoring/types";
import type { TrackSummary } from "@/lib/spotify/client";

export interface AnnotatedSuggestion extends Suggestion {
  /** True when the playlist already contains the candidate track. */
  isMember: boolean;
}

export function annotateSuggestions(
  suggestions: Suggestion[],
  memberPlaylistIds: ReadonlySet<string>,
): AnnotatedSuggestion[] {
  return suggestions.map((s) => ({
    ...s,
    isMember: memberPlaylistIds.has(s.playlistId),
  }));
}

/** Load this user's profiles, score, and annotate — the one call both
 *  /api/now-playing and /api/search need. */
export async function getSuggestionsForTrack(
  userId: string,
  track: TrackSummary,
  options: SuggestOptions = {},
): Promise<AnnotatedSuggestion[]> {
  const profiles = await loadPlaylistProfiles(userId);
  const members = await playlistsContainingTrack(
    track.id,
    profiles.map((p) => p.playlistId),
  );
  return annotateSuggestions(suggestPlaylists(track, profiles, options), members);
}
