/**
 * The design card: what the child is making, written so a kid can read it back.
 *
 * A card belongs to a candidate version and is adopted together with that
 * version's files, so the card and the code never describe different games.
 * `designFromRecord` is the one place that decides what counts as a card, and
 * it is shared by model output (§4 of docs/ai-rules.md) and stored projects.
 */
export type DesignCard = {
  /** Game name. */
  title: string;
  /** Who the child plays as. */
  hero: string;
  /** What you do and how you win or lose. */
  goal: string;
  /** Controls, one short line each. */
  controls: string[];
  /** Art direction in a few words. */
  look: string;
};

export function emptyDesign(): DesignCard {
  return { title: "", hero: "", goal: "", controls: [], look: "" };
}

export function hasDesign(card: DesignCard | undefined): card is DesignCard {
  return !!card && (card.title.length > 0 || card.goal.length > 0);
}

/** Kid-facing lines, also used as compact context for the model. */
export function designLines(card: DesignCard): string[] {
  const lines: string[] = [];
  if (card.title) lines.push(`游戏名：${card.title}`);
  if (card.hero) lines.push(`主角：${card.hero}`);
  if (card.goal) lines.push(`玩法：${card.goal}`);
  if (card.controls.length) lines.push(`操作：${card.controls.join("；")}`);
  if (card.look) lines.push(`画面：${card.look}`);
  return lines;
}

export function designText(card: DesignCard): string {
  return designLines(card).join("\n");
}

function shortText(value: unknown, max = 200): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/**
 * Reads a design card from model output or from stored data. Returns null when
 * there is nothing usable, so callers never show a half-empty card.
 */
export function designFromRecord(value: unknown): DesignCard | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const controls = Array.isArray(record.controls)
    ? record.controls.filter((item): item is string => typeof item === "string").map((item) => shortText(item, 60)).filter(Boolean).slice(0, 6)
    : [];
  const card: DesignCard = {
    title: shortText(record.title, 60),
    hero: shortText(record.hero),
    goal: shortText(record.goal, 300),
    controls,
    look: shortText(record.look),
  };
  return hasDesign(card) ? card : null;
}
