import { describe, expect, it } from "vitest";
import { ASSUMED_CONTEXT_TOKENS, budgetFor } from "./settings";

describe("assistant memory budget", () => {
  it("follows the model instead of a hardcoded number", () => {
    const plan = budgetFor("auto", 200_000);
    expect(plan.tokens).toBe(150_000);
    expect(plan.modelLimit).toBe(200_000);
  });

  it("assumes a window when the deployment does not declare one", () => {
    expect(budgetFor("auto", null).tokens).toBe(Math.floor(ASSUMED_CONTEXT_TOKENS * 0.75));
  });

  it("keeps a chosen budget inside what the model can take, and says so", () => {
    const small = budgetFor(64_000, 100_000);
    expect(small).toMatchObject({ tokens: 64_000, clamped: false });

    const tooBig = budgetFor(512_000, 100_000);
    expect(tooBig.tokens).toBe(75_000);
    expect(tooBig.clamped).toBe(true);
  });

  it("never returns a zero or negative budget", () => {
    expect(budgetFor(1, 1000).tokens).toBeGreaterThanOrEqual(750);
    expect(budgetFor("auto", -5).tokens).toBeGreaterThan(0);
  });
});
