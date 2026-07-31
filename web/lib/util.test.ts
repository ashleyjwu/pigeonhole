import { describe, expect, it } from "vitest";

import { chunk, clamp } from "./util";

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
