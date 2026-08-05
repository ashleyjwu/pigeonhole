/**
 * Demo-user lookup. The public demo runs as a dedicated, pre-seeded user
 * (see worker/src/pigeonhole_worker/seed_demo.py) marked with users.is_demo.
 * Its id is stable, so it's cached in-process after the first lookup.
 */

import { getPool } from "@/lib/db/pool";
import type { TrackSummary } from "@/lib/spotify/client";

let cachedDemoUserId: string | null | undefined;

/** The demo user's internal id, or null if the demo hasn't been seeded. */
export async function getDemoUserId(): Promise<string | null> {
  if (cachedDemoUserId !== undefined) {
    return cachedDemoUserId;
  }
  const result = await getPool().query<{ id: string }>(
    "SELECT id FROM users WHERE is_demo = true ORDER BY created_at LIMIT 1",
  );
  cachedDemoUserId = result.rows[0]?.id ?? null;
  return cachedDemoUserId;
}

/**
 * A random saved track for the demo user, as a TrackSummary — stands in for
 * "now playing" since a demo visitor has no live Spotify player. Returns
 * null if the demo has no saved tracks.
 */
export async function pickRandomDemoTrack(userId: string): Promise<TrackSummary | null> {
  const result = await getPool().query<{
    spotify_id: string;
    name: string;
    artist_ids: string[];
    album_name: string | null;
    album_image_url: string | null;
    release_year: number | null;
    duration_ms: number | null;
    explicit: boolean;
  }>(
    `SELECT t.spotify_id, t.name, t.artist_ids, t.album_name, t.album_image_url,
            t.release_year, t.duration_ms, t.explicit
     FROM saved_tracks st
     JOIN tracks t ON t.spotify_id = st.track_id
     WHERE st.user_id = $1
     ORDER BY random()
     LIMIT 1`,
    [userId],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }

  const nameByArtistId = new Map<string, string>();
  if (row.artist_ids.length > 0) {
    const artistRows = await getPool().query<{ spotify_id: string; name: string }>(
      "SELECT spotify_id, name FROM artists WHERE spotify_id = ANY($1)",
      [row.artist_ids],
    );
    for (const a of artistRows.rows) {
      nameByArtistId.set(a.spotify_id, a.name);
    }
  }

  return {
    id: row.spotify_id,
    name: row.name,
    artistIds: row.artist_ids,
    artistNames: row.artist_ids.map((id) => nameByArtistId.get(id) ?? id),
    albumName: row.album_name,
    albumImageUrl: row.album_image_url,
    releaseYear: row.release_year,
    durationMs: row.duration_ms,
    explicit: row.explicit,
  };
}
