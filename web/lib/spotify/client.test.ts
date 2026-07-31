import { describe, expect, it, vi } from "vitest";

import { SpotifyApiError, SpotifyClient, SpotifyQuotaError } from "./client";

const noSleep = async () => {};

function clientWith(responses: Response[]) {
  const fetchImpl = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error("no more mocked responses");
    return next;
  }) as unknown as typeof fetch;
  return { client: new SpotifyClient("token", { fetchImpl, sleep: noSleep }), fetchImpl };
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

const rawTrack = {
  id: "t1",
  name: "Song",
  artists: [{ id: "a1", name: "Artist One" }],
  album: {
    name: "Album",
    images: [{ url: "https://img/1.jpg" }],
    release_date: "2019-05-01",
  },
  duration_ms: 201_000,
  explicit: false,
};

describe("getCurrentlyPlaying", () => {
  it("maps a playing track to a TrackSummary", async () => {
    const { client } = clientWith([
      jsonResponse(200, { currently_playing_type: "track", item: rawTrack }),
    ]);
    const track = await client.getCurrentlyPlaying();
    expect(track).toMatchObject({
      id: "t1",
      artistIds: ["a1"],
      albumImageUrl: "https://img/1.jpg",
      releaseYear: 2019,
    });
  });

  it("returns null when nothing is playing (204)", async () => {
    const { client } = clientWith([new Response(null, { status: 204 })]);
    expect(await client.getCurrentlyPlaying()).toBeNull();
  });

  it("returns null for podcast episodes", async () => {
    const { client } = clientWith([
      jsonResponse(200, { currently_playing_type: "episode", item: null }),
    ]);
    expect(await client.getCurrentlyPlaying()).toBeNull();
  });
});

describe("searchTracks", () => {
  it("sends the query and maps results", async () => {
    const { client, fetchImpl } = clientWith([
      jsonResponse(200, { tracks: { items: [rawTrack] } }),
    ]);
    const results = await client.searchTracks("song", 5);
    expect(results).toHaveLength(1);
    const url = String(vi.mocked(fetchImpl).mock.calls[0]?.[0]);
    expect(url).toContain("q=song");
    expect(url).toContain("type=track");
    expect(url).toContain("limit=5");
  });

  it("returns [] when the payload has no items", async () => {
    const { client } = clientWith([jsonResponse(200, {})]);
    expect(await client.searchTracks("nothing")).toEqual([]);
  });
});

describe("addTrackToPlaylist", () => {
  it("POSTs the track uri and returns the snapshot id", async () => {
    const { client, fetchImpl } = clientWith([jsonResponse(201, { snapshot_id: "snap2" })]);
    const snapshot = await client.addTrackToPlaylist("pl1", "t1");
    expect(snapshot).toBe("snap2");

    const [url, init] = vi.mocked(fetchImpl).mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/playlists/pl1/items");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ uris: ["spotify:track:t1"] });
  });
});

describe("retry behavior", () => {
  it("retries 429 honoring Retry-After, then succeeds", async () => {
    const sleeps: number[] = [];
    const responses = [
      jsonResponse(429, {}, { "Retry-After": "2" }),
      jsonResponse(200, { tracks: { items: [] } }),
    ];
    const fetchImpl = vi.fn(async () => responses.shift()!) as unknown as typeof fetch;
    const client = new SpotifyClient("token", {
      fetchImpl,
      sleep: async (ms) => void sleeps.push(ms),
    });
    await client.searchTracks("x");
    expect(sleeps).toEqual([2000]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws SpotifyApiError on non-retryable status", async () => {
    const { client } = clientWith([jsonResponse(403, { error: "forbidden" })]);
    await expect(client.searchTracks("x")).rejects.toThrow(SpotifyApiError);
  });

  it("throws SpotifyQuotaError immediately on a huge Retry-After", async () => {
    const sleeps: number[] = [];
    const fetchImpl = vi.fn(async () =>
      jsonResponse(429, {}, { "Retry-After": "82000" }),
    ) as unknown as typeof fetch;
    const client = new SpotifyClient("token", {
      fetchImpl,
      sleep: async (ms) => void sleeps.push(ms),
    });
    await expect(client.searchTracks("x")).rejects.toThrow(SpotifyQuotaError);
    expect(sleeps).toEqual([]); // fail fast, never sleep
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("gives up after max attempts", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(503, {}),
    ) as unknown as typeof fetch;
    const client = new SpotifyClient("token", { fetchImpl, sleep: noSleep });
    await expect(client.searchTracks("x")).rejects.toThrow(/503/);
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });
});
