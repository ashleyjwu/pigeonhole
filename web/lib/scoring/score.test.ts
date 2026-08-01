import { describe, expect, it } from "vitest";

import type { TrackSummary } from "@/lib/spotify/client";

import {
  artistComponent,
  DEFAULT_WEIGHTS,
  eraComponent,
  recencyMultiplier,
  scorePlaylist,
  suggestPlaylists,
} from "./score";
import type { PlaylistProfile } from "./types";

const NOW = new Date("2026-07-31T00:00:00.000Z");
const RECENT = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000);
const OLD = new Date(NOW.getTime() - 5 * 365 * 24 * 60 * 60 * 1000);

function track(overrides: Partial<TrackSummary> = {}): TrackSummary {
  return {
    id: "cand",
    name: "Candidate",
    artistIds: ["a1"],
    artistNames: ["Alvvays"],
    albumName: "Album",
    albumImageUrl: null,
    releaseYear: 2018,
    durationMs: 200_000,
    explicit: false,
    ...overrides,
  };
}

function profile(overrides: Partial<PlaylistProfile> = {}): PlaylistProfile {
  return {
    playlistId: "p",
    playlistName: "Playlist",
    trackCount: 10,
    artistWeights: {},
    era: null,
    oldestTrackAddedAt: null,
    newestTrackAddedAt: null,
    ...overrides,
  };
}

describe("artistComponent", () => {
  it("sums prominence of matched artists and reports them", () => {
    const t = track({ artistIds: ["a1", "a2"], artistNames: ["A1", "A2"] });
    const p = profile({ artistWeights: { a1: 0.3, a2: 0.2, other: 0.5 } });
    const { score, matched } = artistComponent(t, p);
    expect(score).toBeCloseTo(0.5);
    expect(matched).toEqual(["a1", "a2"]);
  });

  it("clamps to 1 and ignores unmatched artists", () => {
    const p = profile({ artistWeights: { a1: 0.9, a1_dup: 0.9 } });
    expect(artistComponent(track({ artistIds: ["a1"] }), p).score).toBe(0.9);
  });

  it("is zero when no artist matches", () => {
    expect(artistComponent(track(), profile({ artistWeights: { z: 1 } })).score).toBe(0);
  });
});

describe("eraComponent", () => {
  it("is 1 at the playlist's mean year", () => {
    const p = profile({ era: { meanYear: 2018, stdYear: 5, count: 8 } });
    expect(eraComponent(track({ releaseYear: 2018 }), p)).toBeCloseTo(1);
  });

  it("decays with distance", () => {
    const p = profile({ era: { meanYear: 2000, stdYear: 5, count: 8 } });
    expect(eraComponent(track({ releaseYear: 2018 }), p)).toBeLessThan(0.2);
  });

  it("is null when the track has no year or the playlist has no era", () => {
    expect(eraComponent(track({ releaseYear: null }), profile({ era: { meanYear: 2018, stdYear: 5, count: 8 } }))).toBeNull();
    expect(eraComponent(track(), profile({ era: null }))).toBeNull();
  });
});

describe("scorePlaylist", () => {
  it("uses only the artist component when era is unavailable", () => {
    const p = profile({ artistWeights: { a1: 0.5 } });
    const result = scorePlaylist(track(), p);
    expect(result.score).toBeCloseTo(0.5); // not deflated by missing era
    expect(result.eraContributed).toBe(false);
  });

  it("blends artist and era when both are present", () => {
    const p = profile({
      artistWeights: { a1: 1 },
      era: { meanYear: 2018, stdYear: 5, count: 8 },
    });
    // artist=1 (w .85), era=1 (w .15) -> 1.0
    expect(scorePlaylist(track({ releaseYear: 2018 }), p).score).toBeCloseTo(1);
  });
});

describe("recencyMultiplier", () => {
  it("is neutral when no dates are set", () => {
    expect(recencyMultiplier(profile(), DEFAULT_WEIGHTS, NOW)).toBe(1);
  });

  it("applies the created boost for a recent oldest-track date", () => {
    const p = profile({ oldestTrackAddedAt: RECENT });
    expect(recencyMultiplier(p, DEFAULT_WEIGHTS, NOW)).toBe(DEFAULT_WEIGHTS.createdBoost);
  });

  it("applies the updated boost for a recent newest-track date", () => {
    const p = profile({ newestTrackAddedAt: RECENT });
    expect(recencyMultiplier(p, DEFAULT_WEIGHTS, NOW)).toBe(DEFAULT_WEIGHTS.updatedBoost);
  });

  it("stacks both boosts when both dates are recent", () => {
    const p = profile({ oldestTrackAddedAt: RECENT, newestTrackAddedAt: RECENT });
    expect(recencyMultiplier(p, DEFAULT_WEIGHTS, NOW)).toBeCloseTo(
      DEFAULT_WEIGHTS.createdBoost * DEFAULT_WEIGHTS.updatedBoost,
    );
  });

  it("ignores dates outside the 2-year window", () => {
    const p = profile({ oldestTrackAddedAt: OLD, newestTrackAddedAt: OLD });
    expect(recencyMultiplier(p, DEFAULT_WEIGHTS, NOW)).toBe(1);
  });
});

describe("scorePlaylist recency", () => {
  it("scales the base score by the recency multiplier", () => {
    const base = scorePlaylist(track(), profile({ artistWeights: { a1: 1 } }), DEFAULT_WEIGHTS, NOW);
    const boosted = scorePlaylist(
      track(),
      profile({ artistWeights: { a1: 1 }, newestTrackAddedAt: RECENT }),
      DEFAULT_WEIGHTS,
      NOW,
    );
    expect(boosted.score).toBeCloseTo(base.score * DEFAULT_WEIGHTS.updatedBoost);
  });

  it("cannot rescue a zero-relevance playlist (multiplicative, not additive)", () => {
    const p = profile({ artistWeights: { someoneElse: 1 }, newestTrackAddedAt: RECENT });
    expect(scorePlaylist(track(), p, DEFAULT_WEIGHTS, NOW).score).toBe(0);
  });
});

describe("suggestPlaylists", () => {
  const t = track({ artistIds: ["a1"], artistNames: ["Alvvays"], releaseYear: 2018 });

  it("ranks the playlist sharing the artist highest", () => {
    const profiles = [
      profile({ playlistId: "no-match", artistWeights: { other: 1 } }),
      profile({ playlistId: "shares-artist", artistWeights: { a1: 0.4 } }),
    ];
    const suggestions = suggestPlaylists(t, profiles);
    expect(suggestions[0]?.playlistId).toBe("shares-artist");
    expect(suggestions[0]?.reason).toBe("Shares Alvvays");
  });

  it("breaks ties by era when no artist matches", () => {
    const profiles = [
      profile({ playlistId: "far", era: { meanYear: 1990, stdYear: 4, count: 8 } }),
      profile({ playlistId: "near", era: { meanYear: 2018, stdYear: 4, count: 8 } }),
    ];
    const suggestions = suggestPlaylists(t, profiles, { minScore: -1 });
    expect(suggestions[0]?.playlistId).toBe("near");
    expect(suggestions[0]?.reason).toContain("Similar era");
  });

  it("respects the limit and sorts descending", () => {
    const profiles = [
      profile({ playlistId: "p1", artistWeights: { a1: 0.1 } }),
      profile({ playlistId: "p2", artistWeights: { a1: 0.9 } }),
      profile({ playlistId: "p3", artistWeights: { a1: 0.5 } }),
    ];
    const suggestions = suggestPlaylists(t, profiles, { limit: 2 });
    expect(suggestions.map((s) => s.playlistId)).toEqual(["p2", "p3"]);
  });

  it("drops non-matching playlists by default", () => {
    const profiles = [profile({ playlistId: "none", artistWeights: { z: 1 }, era: null })];
    expect(suggestPlaylists(t, profiles)).toEqual([]);
  });

  it("breaks a content tie in favor of the more recently active playlist", () => {
    const profiles = [
      profile({ playlistId: "stale", artistWeights: { a1: 0.5 }, newestTrackAddedAt: OLD }),
      profile({ playlistId: "active", artistWeights: { a1: 0.5 }, newestTrackAddedAt: RECENT }),
    ];
    const suggestions = suggestPlaylists(t, profiles, { now: NOW });
    expect(suggestions[0]?.playlistId).toBe("active");
  });
});
