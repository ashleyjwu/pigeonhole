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

/**
 * A fixed palette of Tailwind background classes. Kept as literal strings
 * (not template-built) so Tailwind's static class scanner picks them all up
 * — a dynamically-built class name would get purged from the build.
 */
const SWATCH_COLORS = [
  "bg-rose-500",
  "bg-orange-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-teal-500",
  "bg-cyan-500",
  "bg-blue-500",
  "bg-indigo-500",
  "bg-violet-500",
  "bg-pink-500",
] as const;

/**
 * A deterministic Tailwind background color class for a given string —
 * used as a stand-in "cover" swatch for things with no real art (e.g. a
 * per-track thumbnail in the playlist preview popover). Same input always
 * maps to the same color, so a track's swatch doesn't change between
 * renders or sessions.
 */
export function swatchColorForSeed(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return SWATCH_COLORS[Math.abs(hash) % SWATCH_COLORS.length] ?? SWATCH_COLORS[0];
}
