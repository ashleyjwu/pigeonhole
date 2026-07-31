/**
 * Compose the hero-flow payload: suggestions for a track, annotated with
 * whether each suggested playlist already contains it.
 */

import { suggestPlaylists, type SuggestOptions } from "@/lib/scoring/score";
import type { PlaylistProfile, Suggestion } from "@/lib/scoring/types";
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

export function suggestForTrack(
  track: TrackSummary,
  profiles: PlaylistProfile[],
  memberPlaylistIds: ReadonlySet<string>,
  options: SuggestOptions = {},
): AnnotatedSuggestion[] {
  return annotateSuggestions(suggestPlaylists(track, profiles, options), memberPlaylistIds);
}
