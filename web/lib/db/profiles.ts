/**
 * Load playlist profiles (computed by the worker) for online scoring.
 */

import { getPool } from "@/lib/db/pool";
import type { PlaylistProfile } from "@/lib/scoring/types";

export interface ProfileRow {
  spotify_id: string;
  name: string;
  artist_weights: Record<string, number> | null;
  era_stats: { mean: number; std: number; count: number } | null;
  track_count: string | number;
}

/** Pure row -> profile mapping (unit-tested without a database). */
export function mapProfileRow(row: ProfileRow): PlaylistProfile {
  return {
    playlistId: row.spotify_id,
    playlistName: row.name,
    trackCount: Number(row.track_count),
    artistWeights: row.artist_weights ?? {},
    era:
      row.era_stats && row.era_stats.count > 0
        ? {
            meanYear: row.era_stats.mean,
            stdYear: row.era_stats.std,
            count: row.era_stats.count,
          }
        : null,
  };
}

/** Profiles for one user's playlists. Scoped by owner_user_id — required now
 *  that dev mode allows multiple signed-in users, so one user's suggestions
 *  never leak another's library. */
export async function loadPlaylistProfiles(userId: string): Promise<PlaylistProfile[]> {
  const result = await getPool().query<ProfileRow>(
    `SELECT p.spotify_id, p.name, pr.artist_weights, pr.era_stats,
            (SELECT count(*) FROM playlist_tracks pt
              WHERE pt.playlist_id = p.spotify_id) AS track_count
     FROM playlists p
     JOIN playlist_profiles pr ON pr.playlist_id = p.spotify_id
     WHERE p.owner_user_id = $1`,
    [userId],
  );
  return result.rows.map(mapProfileRow);
}
