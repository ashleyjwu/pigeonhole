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
    });
    expect(profile).toEqual({
      playlistId: "p1",
      playlistName: "Mix",
      trackCount: 60,
      artistWeights: { a1: 0.5 },
      era: { meanYear: 2016.2, stdYear: 6.1, count: 60 },
    });
  });

  it("handles null jsonb columns and zero-count era", () => {
    const profile = mapProfileRow({
      spotify_id: "p2",
      name: "gym",
      artist_weights: null,
      era_stats: null,
      track_count: 0,
    });
    expect(profile.artistWeights).toEqual({});
    expect(profile.era).toBeNull();

    const zeroEra = mapProfileRow({
      spotify_id: "p3",
      name: "x",
      artist_weights: {},
      era_stats: { mean: 0, std: 0, count: 0 },
      track_count: 1,
    });
    expect(zeroEra.era).toBeNull();
  });
});
