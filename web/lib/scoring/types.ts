/**
 * The scoring data contract between the worker (which computes these and
 * writes them to playlist_profiles) and the web scorer (which reads and ranks
 * against them). Kept in sync with worker/src/pigeonhole_worker/profiles.py.
 */
export interface PlaylistProfile {
  playlistId: string;
  playlistName: string;
  trackCount: number;
  /** artist_id -> fraction of the playlist's tracks featuring that artist. */
  artistWeights: Record<string, number>;
  /** Release-year distribution, or null when no track in the playlist has a year. */
  era: { meanYear: number; stdYear: number; count: number } | null;
  /** Proxy for "playlist created": the oldest track add (Spotify exposes no
   *  playlist creation date). Null when the playlist has no tracks. */
  oldestTrackAddedAt: Date | null;
  /** Exact "playlist last updated": the newest track add. */
  newestTrackAddedAt: Date | null;
}

export interface Suggestion {
  playlistId: string;
  playlistName: string;
  score: number;
  matchedArtistIds: string[];
  /** Human-readable explanation, e.g. "Shares Alvvays, Beach House". */
  reason: string;
}
