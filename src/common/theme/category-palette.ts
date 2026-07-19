/**
 * A warm, mid-dark categorical palette that sits with the "Lit Workbench" neutrals but never
 * borrows the amber signal hue (~75) — so a category accent can't be mistaken for the one primary
 * signal (the One Signal Rule holds). Kept as hex, not theme tokens, because these are applied as
 * inline style values on elements colored dynamically at runtime (POS menu-tile edges, the
 * cross-store comparison bars) where a static utility class can't reach.
 */
export const CATEGORY_COLORS: readonly string[] = [
  '#3f8f5f', // green
  '#4a6fb0', // blue
  '#b0553a', // brick
  '#7d9b4e', // olive
  '#5f8f8f', // teal
  '#9b6f4e', // brown
  '#8a5a8f', // plum
  '#5a7d9b', // steel
];

/**
 * Stable palette color for a key (a category name, a store id): the same key always maps to the
 * same color across reloads, so a menu section — or a store's comparison bar — keeps its identity.
 * A simple rolling hash; collisions are harmless (two categories may share a color).
 */
export function categoryColor(key: string): string {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  }
  return CATEGORY_COLORS[hash % CATEGORY_COLORS.length];
}
