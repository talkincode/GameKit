/**
 * The agent loop, driven end to end with fake effects: no browser, no model, no
 * pygame runtime. These tests are the contract for what a round may do to the
 * child's project (nothing) and what counts as a reason to repair.
 */
import { describe, expect, it } from "vitest";
import { MAX_REPAIRS, candidateDiff, foldStep, runAgentTurn, type AgentEffects, type AgentEvent, type AgentStep, type RunOutcome } from "./agent";
import { diagnoseProject } from "./diagnostics";
import type { Project } from "./project";

const GOOD_MAIN = `import asyncio
import pygame

pygame.init()
screen = pygame.display.set_mode((640, 360))
clock = pygame.time.Clock()


async def main():
    running = True
    while running:
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False
        screen.fill((16, 20, 24))
        pygame.display.flip()
        clock.tick(60)
        await asyncio.sleep(0)


asyncio.run(main())
`;

// The static check rejects this: time.sleep blocks the browser tab.
const SLEEPY_MAIN = GOOD_MAIN.replace("        screen.fill", "        time.sleep(1)\n        screen.fill");

const DESIGN = JSON.stringify({
  say: "我打算做一个躲陨石的小游戏。",
  title: "太空小方块",
  hero: "小方块",
  goal: "躲开落下来的陨石",
  controls: ["← → 移动"],
  look: "深蓝色太空",
});

function filesAnswer(main: string, extra: Record<string, string> = {}): string {
  return JSON.stringify({
    say: "做好了，先试试看。",
    files: [
      { path: "main.py", content: main },
      ...Object.entries(extra).map(([path, content]) => ({ path, content })),
    ],
  });
}

const base: Project = {
  id: "p1",
  name: "demo",
  createdAt: 0,
  updatedAt: 0,
  files: [{ path: "main.py", text: "print('hi')\n" }],
};

type HarnessOptions = {
  answers: string[];
  run?: (candidate: Project) => RunOutcome | Promise<RunOutcome>;
  cancelWhen?: (event: AgentEvent) => boolean;
};

function harness(options: HarnessOptions) {
  const events: AgentEvent[] = [];
  const prompts: string[] = [];
  const candidates: Project[] = [];
  let answerAt = 0;
  let cancelled = false;
  const fx: AgentEffects = {
    model: async (messages) => {
      prompts.push(messages[1].content);
      const answer = options.answers[answerAt++];
      if (!answer) throw new Error("the loop asked for more answers than the test provides");
      return answer;
    },
    diagnose: diagnoseProject,
    run: async (candidate) => {
      candidates.push(candidate);
      return options.run ? await options.run(candidate) : { kind: "running" };
    },
    cancelled: () => cancelled,
    emit: (event) => {
      events.push(event);
      if (options.cancelWhen?.(event)) cancelled = true;
    },
  };
  const steps = (): AgentStep[] => events.flatMap((event) => (event.kind === "step" ? [event.step] : [])).reduce(foldStep, [] as AgentStep[]);
  const candidate = () => [...events].reverse().find((event) => event.kind === "candidate")?.candidate;
  return { fx, events, prompts, candidates, steps, candidate, kinds: () => steps().map((step) => step.kind) };
}

function turn(harnessed: ReturnType<typeof harness>) {
  return runAgentTurn({ id: "t1", request: "做一个在太空里躲陨石的游戏" }, base, harnessed.fx);
}

describe("a round of the agent loop", () => {
  it("designs, builds, verifies, and hands the candidate to the child", async () => {
    const h = harness({ answers: [DESIGN, filesAnswer(GOOD_MAIN)] });
    const outcome = await turn(h);
    expect(outcome).toEqual({ kind: "ready" });
    expect(h.kinds()).toEqual(["hear", "design", "build", "check", "finish"]);
    const design = h.events.find((event) => event.kind === "design");
    expect(design && design.kind === "design" && design.design.title).toBe("太空小方块");
    expect(h.candidate()?.project.files[0].path).toBe("main.py");
    expect(h.candidates).toHaveLength(1);
  });

  it("never touches the child's project", async () => {
    const h = harness({ answers: [DESIGN, filesAnswer(GOOD_MAIN)] });
    await turn(h);
    expect(base.files).toEqual([{ path: "main.py", text: "print('hi')\n" }]);
    expect(base.design).toBeUndefined();
  });

  it("repairs a candidate the static check rejects, then verifies again", async () => {
    const h = harness({ answers: [DESIGN, filesAnswer(SLEEPY_MAIN), filesAnswer(GOOD_MAIN)] });
    const outcome = await turn(h);
    expect(outcome).toEqual({ kind: "ready" });
    expect(h.kinds()).toEqual(["hear", "design", "build", "repair", "check", "finish"]);
    expect(h.candidate()?.repairs).toBe(1);
    expect(h.candidate()?.project.files.find((file) => file.path === "main.py")?.text).not.toContain("time.sleep");
    expect(h.prompts[2]).toContain("time.sleep");
    // The repair step says where the problem was; that fact is ours, not the model's.
    expect(h.steps().find((step) => step.kind === "repair")?.detail).toContain("main.py");
  });

  it("repairs after the runtime reports a traceback", async () => {
    const outcomes: RunOutcome[] = [
      { kind: "error", detail: 'Traceback (most recent call last):\nNameError: no such name' },
      { kind: "running" },
    ];
    const h = harness({ answers: [DESIGN, filesAnswer(GOOD_MAIN), filesAnswer(GOOD_MAIN)], run: () => outcomes.shift()! });
    const outcome = await turn(h);
    expect(outcome).toEqual({ kind: "ready" });
    expect(h.kinds()).toEqual(["hear", "design", "build", "check", "repair", "finish"]);
    expect(h.candidate()?.repairs).toBe(1);
    expect(h.prompts[2]).toContain("NameError");
  });

  it("does not repair when the preview could not start", async () => {
    const h = harness({ answers: [DESIGN, filesAnswer(GOOD_MAIN)], run: () => ({ kind: "unavailable", detail: "no service worker" }) });
    const outcome = await turn(h);
    expect(outcome).toEqual({ kind: "ready", unverified: "unavailable" });
    expect(h.prompts).toHaveLength(2);
    expect(h.candidate()).toBeDefined();
  });

  it("does not repair when the game simply did not report in time", async () => {
    const h = harness({ answers: [DESIGN, filesAnswer(GOOD_MAIN)], run: () => ({ kind: "quiet" }) });
    expect(await turn(h)).toEqual({ kind: "ready", unverified: "quiet" });
    expect(h.prompts).toHaveLength(2);
  });

  it("stops repairing after the budget and says so", async () => {
    const h = harness({ answers: [DESIGN, filesAnswer(SLEEPY_MAIN), filesAnswer(SLEEPY_MAIN), filesAnswer(SLEEPY_MAIN)] });
    const outcome = await turn(h);
    expect(outcome).toMatchObject({ kind: "blocked", reason: "static" });
    expect(h.prompts).toHaveLength(1 + MAX_REPAIRS + 1);
    expect(h.steps().at(-1)).toMatchObject({ kind: "stop", status: "failed" });
    expect(h.candidates).toHaveLength(0);
  });

  it("stops repairing when the runtime keeps failing", async () => {
    const h = harness({
      answers: [DESIGN, filesAnswer(GOOD_MAIN), filesAnswer(GOOD_MAIN), filesAnswer(GOOD_MAIN)],
      run: () => ({ kind: "error", detail: "NameError" }),
    });
    const outcome = await turn(h);
    expect(outcome).toMatchObject({ kind: "blocked", reason: "runtime" });
    expect(h.candidates).toHaveLength(MAX_REPAIRS + 1);
  });

  it("fails loudly when the model answer is unusable", async () => {
    const h = harness({ answers: [DESIGN, "this is not json"] });
    const outcome = await turn(h);
    expect(outcome).toMatchObject({ kind: "failed" });
    expect(h.steps().at(-1)).toMatchObject({ key: "build", status: "failed" });
    // The child's step list never carries model prose; only our own facts.
    expect(h.steps().at(-1)?.detail).toBeUndefined();
    expect(h.candidate()).toBeUndefined();
  });

  it("fails when the round never produces a main.py", async () => {
    const empty: Project = { ...base, files: [{ path: "game/enemy.py", text: "x = 1\n" }] };
    const h = harness({
      answers: [DESIGN, JSON.stringify({ say: "好了", files: [{ path: "game/enemy.py", content: "x = 1\n" }] })],
    });
    const outcome = await runAgentTurn({ id: "t1", request: "做一个游戏" }, empty, h.fx);
    expect(outcome).toMatchObject({ kind: "failed" });
    expect(h.candidate()).toBeUndefined();
  });

  it("stops before the first model call when the child cancels", async () => {
    const h = harness({ answers: [DESIGN, filesAnswer(GOOD_MAIN)], cancelWhen: () => true });
    expect(await turn(h)).toEqual({ kind: "cancelled" });
    expect(h.prompts).toHaveLength(1);
  });

  it("stops mid-round when the child cancels during the build", async () => {
    const h = harness({
      answers: [DESIGN, filesAnswer(GOOD_MAIN)],
      cancelWhen: (event) => event.kind === "candidate",
    });
    expect(await turn(h)).toEqual({ kind: "cancelled" });
    expect(h.candidates).toHaveLength(0);
  });

  it("stops when the preview reports that it was cancelled", async () => {
    const h = harness({ answers: [DESIGN, filesAnswer(GOOD_MAIN)], run: () => ({ kind: "cancelled" }) });
    expect(await turn(h)).toEqual({ kind: "cancelled" });
  });
});

describe("candidate diffs", () => {
  it("lists changed text files only", () => {
    const after: Project = {
      ...base,
      files: [
        { path: "main.py", text: "print('hello')\n" },
        { path: "assets/player.png", bytes: new Uint8Array([9]) },
      ],
    };
    expect(candidateDiff(base, after).map((file) => file.path)).toEqual(["main.py"]);
  });

  it("is empty when the candidate matches the project", () => {
    expect(candidateDiff(base, base)).toEqual([]);
  });
});
