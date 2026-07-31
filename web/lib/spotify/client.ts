/**
 * Spotify Web API client for pigeonhole's online flows: what's playing now,
 * track search, and adding a track to a playlist.
 *
 * Mirrors the worker client's behavior: 429 responses honor Retry-After,
 * transient 5xx retry with an exponential floor, capped attempts. fetch and
 * sleep are injectable for network-free tests.
 */

const API_BASE = "https://api.spotify.com/v1";
const MAX_ATTEMPTS = 5;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503]);

/** A Retry-After beyond this means the dev-mode quota is exhausted; fail fast
 *  instead of sleeping inside a request handler. Mirrors the Python client. */
const MAX_RETRY_AFTER_MS = 120_000;

export class SpotifyApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(`Spotify API error ${status}: ${message}`);
  }
}

export class SpotifyQuotaError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super(
      `Spotify dev-mode API quota exhausted (asked to wait ${retryAfterSeconds}s). ` +
        "Try again after the quota window resets.",
    );
  }
}

export interface TrackSummary {
  id: string;
  name: string;
  artistIds: string[];
  artistNames: string[];
  albumName: string | null;
  albumImageUrl: string | null;
  releaseYear: number | null;
  durationMs: number | null;
  explicit: boolean;
}

interface RawArtist {
  id: string;
  name: string;
}

interface RawTrack {
  id: string;
  name: string;
  artists: RawArtist[];
  album?: {
    name?: string;
    images?: { url: string }[];
    release_date?: string;
  };
  duration_ms?: number;
  explicit?: boolean;
}

function toTrackSummary(raw: RawTrack): TrackSummary {
  const year = raw.album?.release_date?.slice(0, 4);
  return {
    id: raw.id,
    name: raw.name,
    artistIds: raw.artists.map((a) => a.id),
    artistNames: raw.artists.map((a) => a.name),
    albumName: raw.album?.name ?? null,
    albumImageUrl: raw.album?.images?.[0]?.url ?? null,
    releaseYear: year && /^\d{4}$/.test(year) ? Number(year) : null,
    durationMs: raw.duration_ms ?? null,
    explicit: raw.explicit ?? false,
  };
}

export interface SpotifyClientOptions {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class SpotifyClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly accessToken: string,
    options: SpotifyClientOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
  }

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const response = await this.fetchImpl(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          ...(init.body ? { "Content-Type": "application/json" } : {}),
        },
      });
      if (response.ok) {
        return response;
      }
      if (RETRYABLE_STATUSES.has(response.status) && attempt < MAX_ATTEMPTS) {
        const retryAfterSec = Number(response.headers.get("Retry-After") ?? 0);
        if (retryAfterSec * 1000 > MAX_RETRY_AFTER_MS) {
          throw new SpotifyQuotaError(retryAfterSec);
        }
        const backoffMs = Math.max(retryAfterSec * 1000, 2 ** (attempt - 1) * 1000);
        await this.sleep(backoffMs);
        continue;
      }
      throw new SpotifyApiError(response.status, await response.text());
    }
    throw new Error("unreachable");
  }

  /** The user's currently playing track, or null (nothing playing / podcast). */
  async getCurrentlyPlaying(): Promise<TrackSummary | null> {
    const response = await this.request(`${API_BASE}/me/player/currently-playing`);
    if (response.status === 204) {
      return null;
    }
    const payload = (await response.json()) as {
      currently_playing_type?: string;
      item?: RawTrack | null;
    };
    if (payload.currently_playing_type !== "track" || !payload.item) {
      return null;
    }
    return toTrackSummary(payload.item);
  }

  /** Search tracks by free-text query. */
  async searchTracks(query: string, limit = 10): Promise<TrackSummary[]> {
    const params = new URLSearchParams({
      q: query,
      type: "track",
      limit: String(limit),
    });
    const response = await this.request(`${API_BASE}/search?${params}`);
    const payload = (await response.json()) as { tracks?: { items?: RawTrack[] } };
    return (payload.tracks?.items ?? []).map(toTrackSummary);
  }

  /** Append a track to a playlist. Returns the new playlist snapshot id.
   *  NOTE: POST /playlists/{id}/tracks became /items in the Feb-2026 API. */
  async addTrackToPlaylist(playlistId: string, trackId: string): Promise<string> {
    const response = await this.request(`${API_BASE}/playlists/${playlistId}/items`, {
      method: "POST",
      body: JSON.stringify({ uris: [`spotify:track:${trackId}`] }),
    });
    const payload = (await response.json()) as { snapshot_id: string };
    return payload.snapshot_id;
  }
}
