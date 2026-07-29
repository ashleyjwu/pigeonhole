/**
 * Clamp a number to the inclusive range [min, max].
 *
 * A tiny seed utility so the verification toolchain (typecheck + lint + test)
 * has real code to exercise from day one. Replace/extend as the app grows.
 */
export function clamp(value: number, min: number, max: number): number {
  if (min > max) {
    throw new Error("clamp: min must be <= max");
  }
  return Math.min(Math.max(value, min), max);
}
