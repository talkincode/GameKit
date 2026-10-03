/**
 * The colours the editor starts with: bright, friendly, easy to tell apart. The
 * first sixteen are the public-domain Sweetie 16 palette; the last four add black,
 * pink, brown and a skin tone so characters need no custom colour.
 * Names for the screen reader live in src/ui/text.ts, keyed by these values.
 */
export const PALETTE = [
  "#1a1c2c",
  "#5d275d",
  "#b13e53",
  "#ef7d57",
  "#ffcd75",
  "#a7f070",
  "#38b764",
  "#257179",
  "#29366f",
  "#3b5dc9",
  "#41a6f6",
  "#73eff7",
  "#f4f4f4",
  "#94b0c2",
  "#566c86",
  "#333c57",
  "#000000",
  "#ff77a8",
  "#8b5a2b",
  "#f2c9a0",
] as const;
