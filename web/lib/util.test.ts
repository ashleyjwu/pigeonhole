import { describe, expect, it } from "vitest";

import { clamp } from "./util";

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
