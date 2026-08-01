/**
 * Cross-language contract test: the TS scorer must produce byte-identical
 * results to the Python scorer (worker/src/pigeonhole_worker/scoring.py) on
 * the shared vectors. If this fails after an intentional algorithm change,
 * regenerate shared/scoring-vectors.json from the Python side and make both
 * suites green.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { TrackSummary } from "@/lib/spotify/client";

import { artistComponent, eraComponent, scorePlaylist } from "./score";
import type { PlaylistProfile } from "./types";

interface Vector {
  name: string;
  now: string;
  track: { artistIds: string[]; releaseYear: number | null };
  profile: {
    artistWeights: Record<string, number>;
    eraMean: number | null;
    eraStd: number | null;
    eraCount: number;
    oldestTrackAddedAt: string | null;
    newestTrackAddedAt: string | null;
  };
  expected: {
    artist: number;
    matched: string[];
    era: number | null;
    score: number;
  };
}

const vectors = JSON.parse(
  readFileSync(join(__dirname, "../../../shared/scoring-vectors.json"), "utf8"),
) as { cases: Vector[] };

function toTrack(v: Vector): TrackSummary {
  return {
    id: "t",
    name: "t",
    artistIds: v.track.artistIds,
    artistNames: v.track.artistIds,
    albumName: null,
    albumImageUrl: null,
    releaseYear: v.track.releaseYear,
    durationMs: null,
    explicit: false,
  };
}

function toProfile(v: Vector): PlaylistProfile {
  return {
    playlistId: "p",
    playlistName: "p",
    trackCount: 1,
    artistWeights: v.profile.artistWeights,
    era:
      v.profile.eraMean !== null && v.profile.eraCount > 0
        ? {
            meanYear: v.profile.eraMean,
            stdYear: v.profile.eraStd ?? 0,
            count: v.profile.eraCount,
          }
        : null,
    oldestTrackAddedAt: v.profile.oldestTrackAddedAt ? new Date(v.profile.oldestTrackAddedAt) : null,
    newestTrackAddedAt: v.profile.newestTrackAddedAt ? new Date(v.profile.newestTrackAddedAt) : null,
  };
}

describe("shared scoring vectors (parity with Python)", () => {
  for (const vector of vectors.cases) {
    it(vector.name, () => {
      const track = toTrack(vector);
      const profile = toProfile(vector);

      const artist = artistComponent(track, profile);
      expect(artist.score).toBeCloseTo(vector.expected.artist, 12);
      expect(artist.matched).toEqual(vector.expected.matched);

      const era = eraComponent(track, profile);
      if (vector.expected.era === null) {
        expect(era).toBeNull();
      } else {
        expect(era).toBeCloseTo(vector.expected.era, 12);
      }

      const now = new Date(vector.now);
      expect(scorePlaylist(track, profile, undefined, now).score).toBeCloseTo(
        vector.expected.score,
        12,
      );
    });
  }
});
