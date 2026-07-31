/**
 * Local library bookkeeping around the add-to-playlist write-back.
 *
 * After a track is added on Spotify, we mirror the change locally in the same
 * transaction style as ingestion (idempotent upserts) so membership checks
 * stay accurate without re-syncing, store the new snapshot_id (the next
 * incremental sync then skips the playlist — we already have its state), and
 * record the accepted suggestion as a feedback event for the future
 * re-ranker.
 */

import { getPool } from "@/lib/db/pool";
import type { TrackSummary } from "@/lib/spotify/client";

/** Which of the given playlists already contain the track. */
export async function playlistsContainingTrack(
  trackId: string,
  playlistIds: string[],
): Promise<Set<string>> {
  if (playlistIds.length === 0) {
    return new Set();
  }
  const result = await getPool().query<{ playlist_id: string }>(
    `SELECT playlist_id FROM playlist_tracks
     WHERE track_id = $1 AND playlist_id = ANY($2)`,
    [trackId, playlistIds],
  );
  return new Set(result.rows.map((r) => r.playlist_id));
}

export async function recordAddition(
  userId: string,
  playlistId: string,
  track: TrackSummary,
  newSnapshotId: string,
): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO tracks
         (spotify_id, name, artist_ids, album_name, release_year, explicit, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (spotify_id) DO NOTHING`,
      [
        track.id,
        track.name,
        track.artistIds,
        track.albumName,
        track.releaseYear,
        track.explicit,
        track.durationMs,
      ],
    );
    await client.query(
      `INSERT INTO playlist_tracks (playlist_id, track_id, position, added_at)
       VALUES ($1, $2,
               (SELECT coalesce(max(position) + 1, 0) FROM playlist_tracks
                 WHERE playlist_id = $1),
               now())
       ON CONFLICT (playlist_id, track_id) DO NOTHING`,
      [playlistId, track.id],
    );
    await client.query(
      `UPDATE playlists SET snapshot_id = $2, track_count = track_count + 1
       WHERE spotify_id = $1`,
      [playlistId, newSnapshotId],
    );
    await client.query(
      `INSERT INTO feedback_events (user_id, track_id, playlist_id, action)
       VALUES ($1, $2, $3, 'accepted')`,
      [userId, track.id, playlistId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
