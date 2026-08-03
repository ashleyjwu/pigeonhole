/**
 * Look up a candidate track's genre tags for online scoring.
 *
 * Mirrors the worker's per-track merge in profiles.py / evaluate.py: a
 * track's tags are the max-per-tag merge across its artists (not sum — a
 * multi-artist track shouldn't double-count a tag two artists share).
 */

import { getPool } from "@/lib/db/pool";

/** Merge multiple artists' tag maps by taking the max weight per tag. */
export function mergeArtistTags(tagMaps: Array<Record<string, number>>): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const tags of tagMaps) {
    for (const [tag, weight] of Object.entries(tags)) {
      merged[tag] = Math.max(merged[tag] ?? 0, weight);
    }
  }
  return merged;
}

/** Merged genre tags for a track given its artist ids, or null if none of
 *  its artists have tag data (distinct from an artist having zero tags). */
export async function getTrackGenreTags(
  artistIds: string[],
): Promise<Record<string, number> | null> {
  if (artistIds.length === 0) {
    return null;
  }
  const result = await getPool().query<{ genre_tags: Record<string, number> | null }>(
    `SELECT genre_tags FROM artists WHERE spotify_id = ANY($1) AND genre_tags IS NOT NULL`,
    [artistIds],
  );
  const tagMaps = result.rows.map((r) => r.genre_tags).filter((t): t is Record<string, number> => t !== null);
  if (tagMaps.length === 0) {
    return null;
  }
  const merged = mergeArtistTags(tagMaps);
  return Object.keys(merged).length > 0 ? merged : null;
}

/** Batch version: merged genre tags per track id, for scoring many
 *  candidates at once (used by the batch review flow). */
export async function getTrackGenreTagsBatch(
  tracksArtistIds: Map<string, string[]>,
): Promise<Map<string, Record<string, number>>> {
  const allArtistIds = [...new Set([...tracksArtistIds.values()].flat())];
  if (allArtistIds.length === 0) {
    return new Map();
  }
  const result = await getPool().query<{ spotify_id: string; genre_tags: Record<string, number> | null }>(
    `SELECT spotify_id, genre_tags FROM artists WHERE spotify_id = ANY($1) AND genre_tags IS NOT NULL`,
    [allArtistIds],
  );
  const tagsByArtist = new Map<string, Record<string, number>>();
  for (const row of result.rows) {
    if (row.genre_tags) {
      tagsByArtist.set(row.spotify_id, row.genre_tags);
    }
  }

  const tagsByTrack = new Map<string, Record<string, number>>();
  for (const [trackId, artistIds] of tracksArtistIds) {
    const tagMaps = artistIds.map((id) => tagsByArtist.get(id)).filter((t): t is Record<string, number> => t !== undefined);
    if (tagMaps.length > 0) {
      const merged = mergeArtistTags(tagMaps);
      if (Object.keys(merged).length > 0) {
        tagsByTrack.set(trackId, merged);
      }
    }
  }
  return tagsByTrack;
}
