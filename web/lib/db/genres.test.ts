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

describe("mergeArtistTags", () => {
  it("takes the max weight per tag across artists", async () => {
    const { mergeArtistTags } = await import("./genres");
    const merged = mergeArtistTags([
      { emo: 0.4, "indie rock": 1.0 },
      { emo: 0.9, pop: 0.2 },
    ]);
    expect(merged).toEqual({ emo: 0.9, "indie rock": 1.0, pop: 0.2 });
  });

  it("returns {} for no tag maps or all-empty tag maps", async () => {
    const { mergeArtistTags } = await import("./genres");
    expect(mergeArtistTags([])).toEqual({});
    expect(mergeArtistTags([{}, {}])).toEqual({});
  });
});

describe("getTrackGenreTags", () => {
  it("returns null immediately when there are no artist ids (no query issued)", async () => {
    const query = mockPool(() => {
      throw new Error("should not be called");
    });
    const { getTrackGenreTags } = await import("./genres");
    expect(await getTrackGenreTags([])).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it("merges tags across the track's artists (max per tag)", async () => {
    mockPool(() => [
      { genre_tags: { emo: 0.4, "indie rock": 1.0 } },
      { genre_tags: { emo: 0.9 } },
    ]);
    const { getTrackGenreTags } = await import("./genres");
    expect(await getTrackGenreTags(["a1", "a2"])).toEqual({ emo: 0.9, "indie rock": 1.0 });
  });

  it("returns null when no artist has tag data", async () => {
    mockPool(() => []);
    const { getTrackGenreTags } = await import("./genres");
    expect(await getTrackGenreTags(["a1"])).toBeNull();
  });

  it("returns null when artists have tag rows but the merge is empty", async () => {
    mockPool(() => [{ genre_tags: {} }]);
    const { getTrackGenreTags } = await import("./genres");
    expect(await getTrackGenreTags(["a1"])).toBeNull();
  });
});

describe("getTrackGenreTagsBatch", () => {
  it("returns an empty map without querying when there are no artist ids", async () => {
    const query = mockPool(() => {
      throw new Error("should not be called");
    });
    const { getTrackGenreTagsBatch } = await import("./genres");
    const result = await getTrackGenreTagsBatch(new Map([["t1", []]]));
    expect(result.size).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  it("merges per track from a single batched artist lookup", async () => {
    const query = mockPool(() => [
      { spotify_id: "a1", genre_tags: { emo: 0.4 } },
      { spotify_id: "a2", genre_tags: { emo: 0.9, pop: 0.2 } },
      { spotify_id: "a3", genre_tags: { rock: 1.0 } },
    ]);
    const { getTrackGenreTagsBatch } = await import("./genres");

    const result = await getTrackGenreTagsBatch(
      new Map([
        ["t1", ["a1", "a2"]],
        ["t2", ["a3"]],
        ["t3", ["missing"]],
      ]),
    );

    expect(query).toHaveBeenCalledTimes(1);
    expect(result.get("t1")).toEqual({ emo: 0.9, pop: 0.2 });
    expect(result.get("t2")).toEqual({ rock: 1.0 });
    expect(result.has("t3")).toBe(false);
  });
});
