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

describe("findUnfiledSavedTracks", () => {
  it("maps rows and resolves artist names via a second lookup", async () => {
    const query = mockPool((sql) => {
      if (sql.includes("FROM saved_tracks")) {
        return [
          {
            spotify_id: "t1",
            name: "Song",
            artist_ids: ["a1", "a2"],
            album_name: "Album",
            album_image_url: "https://example.com/t1.jpg",
            release_year: 2020,
            duration_ms: 200_000,
            explicit: false,
          },
        ];
      }
      if (sql.includes("FROM artists")) {
        return [
          { spotify_id: "a1", name: "Artist One" },
          { spotify_id: "a2", name: "Artist Two" },
        ];
      }
      throw new Error(`unexpected query: ${sql}`);
    });

    const { findUnfiledSavedTracks } = await import("./library");
    const tracks = await findUnfiledSavedTracks("user-1");

    expect(tracks).toEqual([
      {
        spotifyId: "t1",
        name: "Song",
        artistIds: ["a1", "a2"],
        artistNames: ["Artist One", "Artist Two"],
        albumName: "Album",
        albumImageUrl: "https://example.com/t1.jpg",
        releaseYear: 2020,
        durationMs: 200_000,
        explicit: false,
      },
    ]);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("passes through a null album_image_url for tracks synced before it was tracked", async () => {
    mockPool((sql) => {
      if (sql.includes("FROM saved_tracks")) {
        return [
          {
            spotify_id: "t1",
            name: "Song",
            artist_ids: ["a1"],
            album_name: "Album",
            album_image_url: null,
            release_year: 2020,
            duration_ms: 200_000,
            explicit: false,
          },
        ];
      }
      return [{ spotify_id: "a1", name: "Artist" }];
    });

    const { findUnfiledSavedTracks } = await import("./library");
    const tracks = await findUnfiledSavedTracks("user-1");
    expect(tracks[0]?.albumImageUrl).toBeNull();
  });

  it("skips the artist lookup entirely when there are no candidate tracks", async () => {
    const query = mockPool((sql) => {
      if (sql.includes("FROM saved_tracks")) return [];
      throw new Error(`unexpected query: ${sql}`);
    });

    const { findUnfiledSavedTracks } = await import("./library");
    expect(await findUnfiledSavedTracks("user-1")).toEqual([]);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("falls back to the artist id when a name is unresolved", async () => {
    mockPool((sql) => {
      if (sql.includes("FROM saved_tracks")) {
        return [
          {
            spotify_id: "t1",
            name: "Song",
            artist_ids: ["missing"],
            album_name: null,
            album_image_url: null,
            release_year: null,
            duration_ms: null,
            explicit: false,
          },
        ];
      }
      return []; // artist lookup finds nothing
    });

    const { findUnfiledSavedTracks } = await import("./library");
    const tracks = await findUnfiledSavedTracks("user-1");
    expect(tracks[0]?.artistNames).toEqual(["missing"]);
  });
});
