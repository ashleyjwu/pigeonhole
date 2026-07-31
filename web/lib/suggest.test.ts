import { describe, expect, it } from "vitest";

import type { PlaylistProfile } from "@/lib/scoring/types";
import type { TrackSummary } from "@/lib/spotify/client";

import { annotateSuggestions, suggestForTrack } from "./suggest";

const track: TrackSummary = {
  id: "t1",
  name: "Song",
  artistIds: ["a1"],
  artistNames: ["Artist"],
  albumName: null,
  albumImageUrl: null,
  releaseYear: 2020,
  durationMs: null,
  explicit: false,
};

function profile(id: string, weights: Record<string, number>): PlaylistProfile {
  return {
    playlistId: id,
    playlistName: id,
    trackCount: 10,
    artistWeights: weights,
    era: null,
  };
}

describe("annotateSuggestions", () => {
  it("flags membership", () => {
    const annotated = annotateSuggestions(
      [
        { playlistId: "in", playlistName: "in", score: 1, matchedArtistIds: [], reason: "" },
        { playlistId: "out", playlistName: "out", score: 0.5, matchedArtistIds: [], reason: "" },
      ],
      new Set(["in"]),
    );
    expect(annotated.map((s) => s.isMember)).toEqual([true, false]);
  });
});

describe("suggestForTrack", () => {
  it("ranks, limits, and annotates in one pass", () => {
    const suggestions = suggestForTrack(
      track,
      [profile("weak", { a1: 0.1 }), profile("strong", { a1: 0.9 }), profile("none", {})],
      new Set(["strong"]),
      { limit: 2 },
    );
    expect(suggestions.map((s) => s.playlistId)).toEqual(["strong", "weak"]);
    expect(suggestions[0]?.isMember).toBe(true);
    expect(suggestions[1]?.isMember).toBe(false);
  });
});
