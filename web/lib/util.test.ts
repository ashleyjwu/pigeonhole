import { describe, expect, it } from "vitest";

import { chunk, clamp, shuffle, swatchColorForSeed } from "./util";

describe("clamp", () => {
  it("returns the value when within range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it("clamps values below the minimum", () => {
    expect(clamp(-1, 0, 10)).toBe(0);
  });

  it("clamps values above the maximum", () => {
    expect(clamp(11, 0, 10)).toBe(10);
  });

  it("throws when min > max", () => {
    expect(() => clamp(1, 10, 0)).toThrow();
  });
});

describe("chunk", () => {
  it("splits evenly", () => {
    expect(chunk([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it("handles a remainder", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns [] for an empty array", () => {
    expect(chunk([], 3)).toEqual([]);
  });

  it("rejects a non-positive size", () => {
    expect(() => chunk([1, 2, 3], 0)).toThrow();
  });
});

describe("shuffle", () => {
  it("returns a new array, never mutating the input", () => {
    const input = [1, 2, 3, 4, 5];
    const result = shuffle(input);
    expect(result).not.toBe(input);
    expect(input).toEqual([1, 2, 3, 4, 5]);
  });

  it("preserves every element (same multiset, possibly reordered)", () => {
    const input = ["a", "b", "c", "d", "e"];
    const result = shuffle(input);
    expect([...result].sort()).toEqual([...input].sort());
    expect(result).toHaveLength(input.length);
  });

  it("handles empty and single-element arrays without throwing", () => {
    expect(shuffle([])).toEqual([]);
    expect(shuffle([1])).toEqual([1]);
  });

  it("is deterministic given a fixed random source", () => {
    const input = [1, 2, 3, 4, 5];
    let seed = 0;
    const seeded = () => {
      seed += 1;
      // Simple deterministic sequence in [0, 1).
      return (seed * 0.37) % 1;
    };
    const a = shuffle(input, seeded);
    seed = 0;
    const b = shuffle(input, seeded);
    expect(a).toEqual(b);
  });

  it("actually reorders elements given a non-identity random source", () => {
    const input = Array.from({ length: 20 }, (_, i) => i);
    // A fixed source that isn't the identity permutation.
    let seed = 0;
    const result = shuffle(input, () => {
      seed += 1;
      return (seed * 0.61803398875) % 1;
    });
    expect(result).not.toEqual(input);
  });
});

describe("swatchColorForSeed", () => {
  it("is deterministic for the same seed", () => {
    expect(swatchColorForSeed("Airbag")).toBe(swatchColorForSeed("Airbag"));
  });

  it("returns a bg- Tailwind class", () => {
    expect(swatchColorForSeed("Silverfuck")).toMatch(/^bg-\w+-500$/);
  });

  it("varies across different seeds", () => {
    const colors = new Set(
      ["a", "b", "c", "d", "e", "f", "g", "h"].map((s) => swatchColorForSeed(s)),
    );
    expect(colors.size).toBeGreaterThan(1);
  });

  it("handles an empty string without throwing", () => {
    expect(() => swatchColorForSeed("")).not.toThrow();
  });
});
