/**
 * 设置：存在本机的小偏好，不进项目、不上传。
 *
 * The only option today is how much the assistant remembers per project. The
 * budget must fit inside what the model can actually take, so "自动" follows the
 * deployment's declared context window instead of a hardcoded number.
 */
export type AgentBudget = "auto" | number;

export type Settings = {
  /** How many tokens one project's conversation may hold. */
  agentBudget: AgentBudget;
};

const KEY = "gamekit.settings";

/** Offered choices, in tokens. */
export const BUDGET_CHOICES = [64_000, 128_000, 256_000, 512_000] as const;

/** Used when the deployment does not declare a context window. */
export const ASSUMED_CONTEXT_TOKENS = 128_000;

/** Never fill the whole window with history: the answer needs room too. */
const FILL_RATIO = 0.75;

export const DEFAULT_SETTINGS: Settings = { agentBudget: "auto" };

export function loadSettings(): Settings {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Settings>;
    const budget = stored.agentBudget;
    if (budget === "auto" || (typeof budget === "number" && budget > 0)) return { agentBudget: budget };
  } catch {
    // A broken value is not worth a message; defaults are always usable.
  }
  return DEFAULT_SETTINGS;
}

export function saveSettings(settings: Settings): void {
  localStorage.setItem(KEY, JSON.stringify(settings));
}

export type BudgetPlan = { tokens: number; clamped: boolean; modelLimit: number };

/**
 * The budget a run should use: the child's choice, kept inside what the model can
 * take (with room for the answer), or the model's own window in 自动 mode.
 */
export function budgetFor(choice: AgentBudget, modelLimit: number | null): BudgetPlan {
  const limit = modelLimit && modelLimit > 0 ? modelLimit : ASSUMED_CONTEXT_TOKENS;
  const room = Math.floor(limit * FILL_RATIO);
  if (choice === "auto") return { tokens: room, clamped: false, modelLimit: limit };
  const wanted = Math.max(1000, Math.floor(choice));
  return { tokens: Math.min(wanted, room), clamped: wanted > room, modelLimit: limit };
}
