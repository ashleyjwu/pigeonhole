/**
 * Content-based playlist scoring (pure functions).
 *
 * Given a candidate track and the precomputed profiles of a user's playlists,
 * rank the playlists by how well the track fits. Signals available under the
 * Feb-2026 Spotify API:
 *   - artist overlap (primary): the candidate's artists' prominence in the
 *     playlist
 *   - era proximity (secondary): how close the track's release year is to the
 *     playlist's release-year distribution
 *
 * Genre and popularity signals no longer exist. Track co-occurrence /
 * embeddings are a later, separately-evaluated experiment. Weights are
 * constants here and will be tuned against the eval harness.
 */

import type { TrackSummary } from "@/lib/spotify/client";

import type { PlaylistProfile, Suggestion } from "./types";

export interface ScoreWeights {
  artist: number;
  era: number;
}

export const DEFAULT_WEIGHTS: ScoreWeights = { artist: 0.85, era: 0.15 };

/** Floor on a playlist's era spread, so tight-era playlists aren't over-strict. */
const MIN_ERA_STD = 3;

export interface PlaylistScore {
  score: number;
  matchedArtistIds: string[];
  /** Whether the era component was available and contributed. */
  eraContributed: boolean;
}

/** Artist component in [0,1]: summed prominence of the candidate's artists. */
export function artistComponent(
  track: TrackSummary,
  profile: PlaylistProfile,
): { score: number; matched: string[] } {
  const matched: string[] = [];
  let sum = 0;
  for (const artistId of track.artistIds) {
    const weight = profile.artistWeights[artistId] ?? 0;
    if (weight > 0) {
      matched.push(artistId);
      sum += weight;
    }
  }
  return { score: Math.min(sum, 1), matched };
}

/** Era component in [0,1], or null when either side lacks year data. */
export function eraComponent(track: TrackSummary, profile: PlaylistProfile): number | null {
  if (track.releaseYear === null || profile.era === null || profile.era.count === 0) {
    return null;
  }
  const std = Math.max(profile.era.stdYear, MIN_ERA_STD);
  const z = (track.releaseYear - profile.era.meanYear) / std;
  return Math.exp(-0.5 * z * z);
}

export function scorePlaylist(
  track: TrackSummary,
  profile: PlaylistProfile,
  weights: ScoreWeights = DEFAULT_WEIGHTS,
): PlaylistScore {
  const artist = artistComponent(track, profile);
  const era = eraComponent(track, profile);

  // Normalize over whichever components are available so a missing era doesn't
  // deflate an otherwise strong artist match.
  let weightedSum = weights.artist * artist.score;
  let totalWeight = weights.artist;
  if (era !== null) {
    weightedSum += weights.era * era;
    totalWeight += weights.era;
  }

  return {
    score: totalWeight > 0 ? weightedSum / totalWeight : 0,
    matchedArtistIds: artist.matched,
    eraContributed: era !== null,
  };
}

function buildReason(track: TrackSummary, result: PlaylistScore): string {
  if (result.matchedArtistIds.length > 0) {
    const nameById = new Map<string, string>();
    track.artistIds.forEach((id, i) => nameById.set(id, track.artistNames[i] ?? id));
    const names = result.matchedArtistIds.map((id) => nameById.get(id) ?? id);
    return `Shares ${names.join(", ")}`;
  }
  if (result.eraContributed && track.releaseYear !== null) {
    return `Similar era (${track.releaseYear})`;
  }
  return "Similar library";
}

export interface SuggestOptions {
  limit?: number;
  weights?: ScoreWeights;
  /** Minimum score to include (exclusive). Defaults to 0 (drop non-matches). */
  minScore?: number;
}

/** Rank playlists for a candidate track; highest score first. */
export function suggestPlaylists(
  track: TrackSummary,
  profiles: PlaylistProfile[],
  options: SuggestOptions = {},
): Suggestion[] {
  const { limit = 3, weights = DEFAULT_WEIGHTS, minScore = 0 } = options;

  return profiles
    .map((profile) => {
      const result = scorePlaylist(track, profile, weights);
      return {
        playlistId: profile.playlistId,
        playlistName: profile.playlistName,
        score: result.score,
        matchedArtistIds: result.matchedArtistIds,
        reason: buildReason(track, result),
      } satisfies Suggestion;
    })
    .filter((s) => s.score > minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
