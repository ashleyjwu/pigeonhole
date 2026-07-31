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

export interface UnfiledTrack {
  spotifyId: string;
  name: string;
  artistIds: string[];
  artistNames: string[];
  albumName: string | null;
  albumImageUrl: string | null;
  releaseYear: number | null;
  durationMs: number | null;
  explicit: boolean;
}

/**
 * Liked songs that are not in any of the user's playlists yet — the batch
 * flow's candidate set. Backed by the tracks/artists already ingested by the
 * worker sync, so this is a pure Postgres read with no Spotify calls.
 */
export async function findUnfiledSavedTracks(
  userId: string,
  limit = 200,
): Promise<UnfiledTrack[]> {
  const result = await getPool().query<{
    spotify_id: string;
    name: string;
    artist_ids: string[];
    album_name: string | null;
    release_year: number | null;
    duration_ms: number | null;
    explicit: boolean;
  }>(
    `SELECT t.spotify_id, t.name, t.artist_ids, t.album_name, t.release_year,
            t.duration_ms, t.explicit
     FROM saved_tracks st
     JOIN tracks t ON t.spotify_id = st.track_id
     WHERE st.user_id = $1
       AND NOT EXISTS (
         SELECT 1 FROM playlist_tracks pt WHERE pt.track_id = t.spotify_id
       )
     ORDER BY st.added_at DESC
     LIMIT $2`,
    [userId, limit],
  );

  const allArtistIds = [...new Set(result.rows.flatMap((r) => r.artist_ids))];
  const nameByArtistId = new Map<string, string>();
  if (allArtistIds.length > 0) {
    const artistRows = await getPool().query<{ spotify_id: string; name: string }>(
      `SELECT spotify_id, name FROM artists WHERE spotify_id = ANY($1)`,
      [allArtistIds],
    );
    for (const row of artistRows.rows) {
      nameByArtistId.set(row.spotify_id, row.name);
    }
  }

  return result.rows.map((row) => ({
    spotifyId: row.spotify_id,
    name: row.name,
    artistIds: row.artist_ids,
    artistNames: row.artist_ids.map((id) => nameByArtistId.get(id) ?? id),
    albumName: row.album_name,
    albumImageUrl: null, // not stored locally; only fetched live for hero/search
    releaseYear: row.release_year,
    durationMs: row.duration_ms,
    explicit: row.explicit,
  }));
}

export interface BatchPlacement {
  track: TrackSummary;
  playlistId: string;
}

/**
 * Mirror a batch of accepted placements locally in one transaction, grouped
 * by playlist so each playlist's snapshot_id and track_count update once
 * regardless of how many tracks landed in it — matching the single bulk
 * Spotify write the caller already made per playlist.
 */
export async function recordBatchAdditions(
  userId: string,
  placements: BatchPlacement[],
  newSnapshotIds: Record<string, string>,
): Promise<void> {
  if (placements.length === 0) {
    return;
  }
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    for (const { track, playlistId } of placements) {
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
        `INSERT INTO feedback_events (user_id, track_id, playlist_id, action)
         VALUES ($1, $2, $3, 'accepted')`,
        [userId, track.id, playlistId],
      );
    }
    for (const [playlistId, snapshotId] of Object.entries(newSnapshotIds)) {
      const count = placements.filter((p) => p.playlistId === playlistId).length;
      await client.query(
        `UPDATE playlists SET snapshot_id = $2, track_count = track_count + $3
         WHERE spotify_id = $1`,
        [playlistId, snapshotId, count],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
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
