/**
 * Playlist preview data for the hover/focus popover: cover art,
 * description, and the first few tracks. Pure Postgres reads — no Spotify
 * calls, so hovering never touches API quota.
 */

import { getPool } from "@/lib/db/pool";

export interface PlaylistPreviewTrack {
  name: string;
  artistNames: string[];
  /** Real per-track album art, or null when not yet synced (older tracks
   *  synced before this field existed) — falls back to a generated swatch
   *  in the UI when null. */
  albumImageUrl: string | null;
}

export interface PlaylistPreview {
  playlistId: string;
  playlistName: string;
  description: string | null;
  imageUrl: string | null;
  trackCount: number;
  /** First few tracks by playlist position (up to the requested limit). */
  tracks: PlaylistPreviewTrack[];
}

const DEFAULT_TRACK_LIMIT = 5;

/**
 * Preview for one playlist, or null if it doesn't exist or isn't owned by
 * `userId` — scoped by owner so a hover can never leak another user's
 * library in dev mode's multi-user setup.
 */
export async function getPlaylistPreview(
  userId: string,
  playlistId: string,
  trackLimit = DEFAULT_TRACK_LIMIT,
): Promise<PlaylistPreview | null> {
  const playlistResult = await getPool().query<{
    spotify_id: string;
    name: string;
    description: string | null;
    image_url: string | null;
    track_count: number;
  }>(
    `SELECT spotify_id, name, description, image_url, track_count
     FROM playlists
     WHERE spotify_id = $1 AND owner_user_id = $2`,
    [playlistId, userId],
  );
  const playlist = playlistResult.rows[0];
  if (!playlist) {
    return null;
  }

  const trackResult = await getPool().query<{
    name: string;
    artist_ids: string[];
    album_image_url: string | null;
  }>(
    `SELECT t.name, t.artist_ids, t.album_image_url
     FROM playlist_tracks pt
     JOIN tracks t ON t.spotify_id = pt.track_id
     WHERE pt.playlist_id = $1
     ORDER BY pt.position ASC
     LIMIT $2`,
    [playlistId, trackLimit],
  );

  const allArtistIds = [...new Set(trackResult.rows.flatMap((r) => r.artist_ids))];
  const nameByArtistId = new Map<string, string>();
  if (allArtistIds.length > 0) {
    const artistResult = await getPool().query<{ spotify_id: string; name: string }>(
      `SELECT spotify_id, name FROM artists WHERE spotify_id = ANY($1)`,
      [allArtistIds],
    );
    for (const row of artistResult.rows) {
      nameByArtistId.set(row.spotify_id, row.name);
    }
  }

  return {
    playlistId: playlist.spotify_id,
    playlistName: playlist.name,
    description: playlist.description?.trim() || null,
    imageUrl: playlist.image_url,
    trackCount: playlist.track_count,
    tracks: trackResult.rows.map((row) => ({
      name: row.name,
      artistNames: row.artist_ids.map((id) => nameByArtistId.get(id) ?? id),
      albumImageUrl: row.album_image_url,
    })),
  };
}
