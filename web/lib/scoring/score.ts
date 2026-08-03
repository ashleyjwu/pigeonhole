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
 *   - recency (multiplicative boost): playlists proxy-"created" or updated
 *     within the last 2 years get a small/larger score boost, respectively
 *   - genre (optional): cosine similarity between the track's Last.fm tags
 *     and the playlist's merged genre distribution
 *
 * Popularity no longer exists. Track co-occurrence / embeddings are a later,
 * separately-evaluated experiment. Weights are constants here and are tuned
 * against the eval harness (worker/src/pigeonhole_worker/evaluate.py) before
 * being changed from their defaults.
 *
 * Genre: Spotify removed artist genres for dev-mode apps, so genre comes
 * from Last.fm tags attached to artists and merged per playlist by the
 * worker (profiles.py). Weight validated against the eval harness
 * (worker/src/pigeonhole_worker/evaluate.py --genre-weight) before shipping:
 * on live data, weight 0.2 lifted hit@3 from 0.198->0.257 (full library) and
 * 0.317->0.382 (playlists <=3y old), with MRR gains of similar size. 0.1-0.4
 * were all within noise of each other, so 0.2 was picked as the middle of
 * that plateau rather than the single best point, to avoid overfitting.
 *
 * Recency: Spotify's API exposes no playlist creation date, so "created" is
 * proxied by the playlist's OLDEST track add (a playlist can't be older than
 * its oldest addition) and "updated" is the exact newest track add. Both
 * apply as MULTIPLICATIVE boosts on the final artist+era score rather than
 * as additive weighted components — an additive term would let a
 * zero-relevance playlist surface just for being recently active, which is
 * not the goal; multiplying preserves score=0 for irrelevant playlists while
 * nudging up relevant, active ones among otherwise-close candidates.
 */

import type { TrackSummary } from "@/lib/spotify/client";

import type { PlaylistProfile, Suggestion } from "./types";

export interface ScoreWeights {
  artist: number;
  era: number;
  genre: number;
  /** Multiplicative boosts, applied only when the respective proxy date is
   *  within RECENCY_WINDOW_MS of `now`. 1.0 = no boost. */
  createdBoost: number;
  updatedBoost: number;
}

export const DEFAULT_WEIGHTS: ScoreWeights = {
  artist: 0.85,
  era: 0.15,
  genre: 0.2,
  createdBoost: 1.05,
  updatedBoost: 1.15,
};

/** Floor on a playlist's era spread, so tight-era playlists aren't over-strict. */
const MIN_ERA_STD = 3;

export const RECENCY_WINDOW_MS = 1000 * 60 * 60 * 24 * 365 * 2; // 2 years

export interface PlaylistScore {
  score: number;
  matchedArtistIds: string[];
  /** Whether the era component was available and contributed. */
  eraContributed: boolean;
  /** Genre tags shared between the track and the playlist, if any. */
  matchedGenreTags: string[];
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

/**
 * Cosine similarity between the track's genre tags and the playlist's
 * genreDist, in [0,1]. Returns null (not 0) when EITHER side has no tag data
 * at all — mirrors eraComponent's "no signal -> excluded from the weighted
 * average" behavior, rather than being scored as a hard zero. A real
 * zero-overlap case (both sides have tags, none in common) still returns
 * 0, which does count against the score.
 */
export function genreComponent(
  trackTags: Record<string, number> | null | undefined,
  profile: PlaylistProfile,
): { score: number | null; matched: string[] } {
  const playlistTags = profile.genreDist;
  if (!trackTags || Object.keys(trackTags).length === 0 || !playlistTags) {
    return { score: null, matched: [] };
  }
  const matched = Object.keys(trackTags).filter((tag) => tag in playlistTags);
  const dot = matched.reduce((sum, tag) => sum + trackTags[tag]! * playlistTags[tag]!, 0);
  const trackNorm = Math.sqrt(
    Object.values(trackTags).reduce((sum, w) => sum + w * w, 0),
  );
  const playlistNorm = Math.sqrt(
    Object.values(playlistTags).reduce((sum, w) => sum + w * w, 0),
  );
  if (trackNorm === 0 || playlistNorm === 0) {
    return { score: null, matched: [] };
  }
  return { score: dot / (trackNorm * playlistNorm), matched };
}

/**
 * 1.0, or boosted if the playlist was proxy-created/updated within 2 years
 * of `now`. Both boosts can stack: since newest >= oldest always, a
 * playlist proxy-"created" recently is also proxy-"updated" recently — that
 * is correct (a brand-new playlist is definitionally recently active too),
 * not double-counting the same evidence twice by mistake.
 */
export function recencyMultiplier(
  profile: PlaylistProfile,
  weights: ScoreWeights,
  now: Date,
): number {
  let multiplier = 1;
  const cutoff = now.getTime() - RECENCY_WINDOW_MS;
  if (profile.oldestTrackAddedAt !== null && profile.oldestTrackAddedAt.getTime() >= cutoff) {
    multiplier *= weights.createdBoost;
  }
  if (profile.newestTrackAddedAt !== null && profile.newestTrackAddedAt.getTime() >= cutoff) {
    multiplier *= weights.updatedBoost;
  }
  return multiplier;
}

export function scorePlaylist(
  track: TrackSummary,
  profile: PlaylistProfile,
  weights: ScoreWeights = DEFAULT_WEIGHTS,
  now: Date = new Date(),
  trackTags?: Record<string, number> | null,
): PlaylistScore {
  const artist = artistComponent(track, profile);
  const era = eraComponent(track, profile);
  const genre = genreComponent(trackTags, profile);

  // Normalize over whichever components are available so a missing
  // era/genre doesn't deflate an otherwise strong artist match.
  let weightedSum = weights.artist * artist.score;
  let totalWeight = weights.artist;
  if (era !== null) {
    weightedSum += weights.era * era;
    totalWeight += weights.era;
  }
  if (genre.score !== null) {
    weightedSum += weights.genre * genre.score;
    totalWeight += weights.genre;
  }
  const base = totalWeight > 0 ? weightedSum / totalWeight : 0;

  return {
    score: base * recencyMultiplier(profile, weights, now),
    matchedArtistIds: artist.matched,
    eraContributed: era !== null,
    matchedGenreTags: genre.matched,
  };
}

function buildReason(track: TrackSummary, result: PlaylistScore): string {
  if (result.matchedArtistIds.length > 0) {
    const nameById = new Map<string, string>();
    track.artistIds.forEach((id, i) => nameById.set(id, track.artistNames[i] ?? id));
    const names = result.matchedArtistIds.map((id) => nameById.get(id) ?? id);
    return `Shares ${names.join(", ")}`;
  }
  if (result.matchedGenreTags.length > 0) {
    return `Similar genre (${result.matchedGenreTags.slice(0, 2).join(", ")})`;
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
  /** Anchors the recency window; defaults to the real current time. Tests
   *  pass a fixed value for determinism. */
  now?: Date;
  /** The candidate track's merged artist genre tags, if known. Omitted ->
   *  genre simply doesn't contribute, same as a missing era. */
  trackTags?: Record<string, number> | null;
}

/** Rank playlists for a candidate track; highest score first. */
export function suggestPlaylists(
  track: TrackSummary,
  profiles: PlaylistProfile[],
  options: SuggestOptions = {},
): Suggestion[] {
  const {
    limit = 3,
    weights = DEFAULT_WEIGHTS,
    minScore = 0,
    now = new Date(),
    trackTags = null,
  } = options;

  return profiles
    .map((profile) => {
      const result = scorePlaylist(track, profile, weights, now, trackTags);
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
