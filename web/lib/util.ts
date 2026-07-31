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

/**
 * Split an array into chunks of at most `size`. Used to batch Spotify writes
 * (e.g. adding up to 100 track URIs per playlist-items call).
 */
export function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0) {
    throw new Error("chunk: size must be positive");
  }
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
