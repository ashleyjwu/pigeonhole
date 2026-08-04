import { describe, expect, it, vi } from "vitest";

import { getPool } from "@/lib/db/pool";

vi.mock("@/lib/db/pool", () => ({ getPool: vi.fn() }));

function mockPool(queryImpl: (sql: string, params?: unknown[]) => unknown) {
  const query = vi.fn(async (sql: string, params?: unknown[]) => ({
    rows: queryImpl(sql, params),
  }));
  vi.mocked(getPool).mockReturnValue({ query } as never);
  return query;
}

describe("getPlaylistPreview", () => {
  it("returns null when the playlist doesn't exist or isn't owned by the user", async () => {
    const query = mockPool((sql) => {
      if (sql.includes("FROM playlists")) return [];
      throw new Error(`unexpected query: ${sql}`);
    });

    const { getPlaylistPreview } = await import("./playlists");
    expect(await getPlaylistPreview("user-1", "missing")).toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("scopes the playlist lookup to the given owner", async () => {
    const query = mockPool((sql) => {
      if (sql.includes("FROM playlists")) return [];
      throw new Error(`unexpected query: ${sql}`);
    });

    const { getPlaylistPreview } = await import("./playlists");
    await getPlaylistPreview("user-1", "p1");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("owner_user_id"), [
      "p1",
      "user-1",
    ]);
  });

  it("maps a full preview with tracks and resolved artist names", async () => {
    const query = mockPool((sql) => {
      if (sql.includes("FROM playlists")) {
        return [
          {
            spotify_id: "p1",
            name: "Mix",
            description: "hazy guitars for grey mornings",
            image_url: "https://example.com/p1.jpg",
            track_count: 42,
          },
        ];
      }
      if (sql.includes("FROM playlist_tracks")) {
        return [
          { name: "Souvlaki Space Station", artist_ids: ["a1"] },
          { name: "Airbag", artist_ids: ["a2", "a3"] },
        ];
      }
      if (sql.includes("FROM artists")) {
        return [
          { spotify_id: "a1", name: "Slowdive" },
          { spotify_id: "a2", name: "Radiohead" },
          { spotify_id: "a3", name: "Jonny Greenwood" },
        ];
      }
      throw new Error(`unexpected query: ${sql}`);
    });

    const { getPlaylistPreview } = await import("./playlists");
    const preview = await getPlaylistPreview("user-1", "p1");

    expect(preview).toEqual({
      playlistId: "p1",
      playlistName: "Mix",
      description: "hazy guitars for grey mornings",
      imageUrl: "https://example.com/p1.jpg",
      trackCount: 42,
      tracks: [
        { name: "Souvlaki Space Station", artistNames: ["Slowdive"] },
        { name: "Airbag", artistNames: ["Radiohead", "Jonny Greenwood"] },
      ],
    });
    expect(query).toHaveBeenCalledTimes(3);
  });

  it("normalizes a blank or whitespace-only description to null", async () => {
    mockPool((sql) => {
      if (sql.includes("FROM playlists")) {
        return [
          {
            spotify_id: "p1",
            name: "Mix",
            description: "   ",
            image_url: null,
            track_count: 0,
          },
        ];
      }
      return [];
    });

    const { getPlaylistPreview } = await import("./playlists");
    const preview = await getPlaylistPreview("user-1", "p1");
    expect(preview?.description).toBeNull();
  });

  it("skips the artist lookup entirely when the playlist has no tracks", async () => {
    const query = mockPool((sql) => {
      if (sql.includes("FROM playlists")) {
        return [
          { spotify_id: "p1", name: "Empty", description: null, image_url: null, track_count: 0 },
        ];
      }
      if (sql.includes("FROM playlist_tracks")) return [];
      throw new Error(`unexpected query: ${sql}`);
    });

    const { getPlaylistPreview } = await import("./playlists");
    const preview = await getPlaylistPreview("user-1", "p1");
    expect(preview?.tracks).toEqual([]);
    expect(query).toHaveBeenCalledTimes(2); // playlist + tracks, no artist lookup
  });

  it("falls back to the artist id when a name is unresolved", async () => {
    mockPool((sql) => {
      if (sql.includes("FROM playlists")) {
        return [
          { spotify_id: "p1", name: "Mix", description: null, image_url: null, track_count: 1 },
        ];
      }
      if (sql.includes("FROM playlist_tracks")) {
        return [{ name: "Song", artist_ids: ["missing"] }];
      }
      return []; // artist lookup finds nothing
    });

    const { getPlaylistPreview } = await import("./playlists");
    const preview = await getPlaylistPreview("user-1", "p1");
    expect(preview?.tracks[0]?.artistNames).toEqual(["missing"]);
  });

  it("passes a custom track limit through to the tracks query", async () => {
    const query = mockPool((sql) => {
      if (sql.includes("FROM playlists")) {
        return [
          { spotify_id: "p1", name: "Mix", description: null, image_url: null, track_count: 10 },
        ];
      }
      return [];
    });

    const { getPlaylistPreview } = await import("./playlists");
    await getPlaylistPreview("user-1", "p1", 5);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("FROM playlist_tracks"), [
      "p1",
      5,
    ]);
  });
});
