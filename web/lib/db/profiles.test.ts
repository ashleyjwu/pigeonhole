import { describe, expect, it } from "vitest";

import { mapProfileRow } from "./profiles";

describe("mapProfileRow", () => {
  it("maps a full row", () => {
    const profile = mapProfileRow({
      spotify_id: "p1",
      name: "Mix",
      artist_weights: { a1: 0.5 },
      era_stats: { mean: 2016.2, std: 6.1, count: 60 },
      track_count: "60",
      oldest_track_added_at: "2021-01-01T00:00:00.000Z",
      newest_track_added_at: "2023-06-15T00:00:00.000Z",
      genre_dist: { indie: 1.0 },
    });
    expect(profile).toEqual({
      playlistId: "p1",
      playlistName: "Mix",
      trackCount: 60,
      artistWeights: { a1: 0.5 },
      era: { meanYear: 2016.2, stdYear: 6.1, count: 60 },
      oldestTrackAddedAt: new Date("2021-01-01T00:00:00.000Z"),
      newestTrackAddedAt: new Date("2023-06-15T00:00:00.000Z"),
      genreDist: { indie: 1.0 },
    });
  });

  it("handles null jsonb columns, zero-count era, and null dates", () => {
    const profile = mapProfileRow({
      spotify_id: "p2",
      name: "gym",
      artist_weights: null,
      era_stats: null,
      track_count: 0,
      oldest_track_added_at: null,
      newest_track_added_at: null,
      genre_dist: null,
    });
    expect(profile.artistWeights).toEqual({});
    expect(profile.era).toBeNull();
    expect(profile.oldestTrackAddedAt).toBeNull();
    expect(profile.newestTrackAddedAt).toBeNull();
    expect(profile.genreDist).toBeNull();

    const zeroEra = mapProfileRow({
      spotify_id: "p3",
      name: "x",
      artist_weights: {},
      era_stats: { mean: 0, std: 0, count: 0 },
      track_count: 1,
      oldest_track_added_at: null,
      newest_track_added_at: null,
      genre_dist: null,
    });
    expect(zeroEra.era).toBeNull();
  });

  it("accepts a real Date object (not just a string) for dates", () => {
    const date = new Date("2024-01-01T00:00:00.000Z");
    const profile = mapProfileRow({
      spotify_id: "p4",
      name: "x",
      artist_weights: {},
      era_stats: null,
      track_count: 1,
      oldest_track_added_at: date,
      newest_track_added_at: date,
      genre_dist: null,
    });
    expect(profile.oldestTrackAddedAt).toEqual(date);
  });

  it("treats an empty genre_dist object as null (no genre signal)", () => {
    const profile = mapProfileRow({
      spotify_id: "p5",
      name: "x",
      artist_weights: {},
      era_stats: null,
      track_count: 1,
      oldest_track_added_at: null,
      newest_track_added_at: null,
      genre_dist: {},
    });
    expect(profile.genreDist).toBeNull();
  });
});
