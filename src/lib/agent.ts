/**
 * One round of the agent loop: 听懂想法 → 设计 → 制作 → 自动试运行 → 修复 → 等孩子试玩。
 *
 * The loop builds a *candidate version* and never touches the child's project:
 * the store applies the candidate only when the child presses 采用（见
 * docs/ai-rules.md 第 3 节）。Everything it needs from the outside world comes in
 * through `AgentEffects`, so the whole loop runs in unit tests without a browser,
 * a model, or a pygame runtime.
 */
import {
  buildMessages,
  designMessages,
  readCandidateFiles,
  readDesign,
  repairMessages,
  type ChatMessage,
  type TextChange,
} from "./ai";
import type { DesignCard } from "./design";
import type { Problem } from "./diagnostics";
import { diffLines, type DiffRow } from "./diff";
import { upsertFile, type Project } from "./project";

/** How many automatic fixes one round may spend before handing over to the child. */
export const MAX_REPAIRS = 2;

/** How long a candidate gets to show a running game before we call it unverified. */
export const RUN_EVIDENCE_MS = 8_000;

export type AgentStepKind = "hear" | "design" | "build" | "check" | "repair" | "finish" | "stop";
export type AgentStepStatus = "active" | "done" | "failed";
export type AgentStep = { key: string; kind: AgentStepKind; status: AgentStepStatus; detail?: string };

/** What running a candidate told us. Only code evidence may trigger a repair. */
export type RunOutcome =
  /** The game started and sent its first frame. */
  | { kind: "running" }
  /** The runtime reported a traceback: a real code problem. */
  | { kind: "error"; detail: string }
  /** The preview could not start at all (offline, no service worker): not a code problem. */
  | { kind: "unavailable"; detail: string }
  /** Nothing came back in time. Could still be loading; not a code problem. */
  | { kind: "quiet" }
  | { kind: "cancelled" };

export type AgentTurnOutcome =
  /** A candidate is ready to play. `unverified` says automatic checks saw no game. */
  | { kind: "ready"; unverified?: "quiet" | "unavailable" }
  /** Candidate still has a blocking problem after the repair budget. */
  | { kind: "blocked"; reason: "static" | "runtime" | "limit"; detail?: string }
  | { kind: "failed"; message: string }
  | { kind: "cancelled" };

export type FileDiff = { path: string; rows: DiffRow[] };

export type CandidateResult = {
  project: Project;
  design: DesignCard;
  say: string;
  repairs: number;
  diff: FileDiff[];
};

export type AgentEvent =
  | { kind: "step"; step: AgentStep }
  | { kind: "design"; design: DesignCard; say: string }
  | { kind: "candidate"; candidate: CandidateResult };

export type AgentTurnInput = { id: string; request: string };

export type AgentEffects = {
  /** One model call. Throws when the call or the answer is unusable. */
  model: (messages: ChatMessage[]) => Promise<string>;
  diagnose: (project: Project) => Problem[];
  run: (candidate: Project, turn: AgentTurnInput) => Promise<RunOutcome>;
  /** True once the child cancelled, or the project changed underneath. */
  cancelled: () => boolean;
  emit: (event: AgentEvent) => void;
};

function applyChanges(project: Project, files: TextChange[]): Project {
  let next = project;
  for (const file of files) next = upsertFile(next, { path: file.path, text: file.content });
  return next;
}

/** Text files whose content differs between the child's project and a candidate. */
export function candidateDiff(base: Project, candidate: Project): FileDiff[] {
  const diffs: FileDiff[] = [];
  for (const file of candidate.files) {
    const before = base.files.find((item) => item.path === file.path);
    if (before?.bytes || file.bytes) continue;
    const after = file.text ?? "";
    const was = before?.text ?? "";
    if (was === after) continue;
    diffs.push({ path: file.path, rows: diffLines(was, after) });
  }
  return diffs;
}

/** Latest state per step key: a step is reported when it starts and again when it ends. */
export function foldStep(steps: AgentStep[], step: AgentStep): AgentStep[] {
  const next = [...steps];
  const at = next.findIndex((item) => item.key === step.key);
  if (at >= 0) next[at] = step;
  else next.push(step);
  return next;
}

function blocking(problems: Problem[]): Problem[] {
  return problems.filter((item) => item.severity === "error");
}

function shortDetail(problems: Problem[]): string {
  const first = problems[0];
  if (!first) return "";
  return `${first.path ?? "main.py"}${first.line ? `:${first.line}` : ""} ${first.message}`.slice(0, 200);
}

/**
 * Step details are facts we produced ourselves (a file and line, a count).
 * Model errors are for the console, never for the child's step list: the round
 * outcome carries a kid-facing sentence instead.
 */
export async function runAgentTurn(
  input: AgentTurnInput,
  base: Project,
  fx: AgentEffects,
): Promise<AgentTurnOutcome> {
  const emitStep = (key: string, kind: AgentStepKind, status: AgentStepStatus, detail?: string) => {
    fx.emit({ kind: "step", step: { key, kind, status, detail } });
  };
  const finish = () => emitStep("finish", "finish", "done");

  emitStep("hear", "hear", "done", input.request.trim());

  // 1. Design: the child's words become a card the whole round is built from.
  emitStep("design", "design", "active");
  let design: DesignCard;
  let say = "";
  try {
    const answer = readDesign(await fx.model(designMessages({ request: input.request, base })));
    design = answer.card;
    say = answer.say;
  } catch (error) {
    const message = error instanceof Error ? error.message : "The model call failed.";
    emitStep("design", "design", "failed");
    return { kind: "failed", message };
  }
  emitStep("design", "design", "done", design.title);
  fx.emit({ kind: "design", design, say });
  if (fx.cancelled()) return { kind: "cancelled" };

  // 2. Build: one candidate version of the whole game.
  emitStep("build", "build", "active");
  let candidate: Project;
  try {
    const built = readCandidateFiles(await fx.model(buildMessages({ request: input.request, design, base })), base, "main.py");
    candidate = applyChanges(base, built.files);
    say = built.say || say;
  } catch (error) {
    const message = error instanceof Error ? error.message : "The model call failed.";
    emitStep("build", "build", "failed");
    return { kind: "failed", message };
  }
  if (!candidate.files.some((file) => file.path === "main.py" && file.text?.trim())) {
    emitStep("build", "build", "failed");
    return { kind: "failed", message: "The candidate has no main.py." };
  }
  emitStep("build", "build", "done");
  fx.emit({ kind: "candidate", candidate: { project: candidate, design, say, repairs: 0, diff: candidateDiff(base, candidate) } });

  // 3. Check and repair until the child gets something playable, or we run out.
  for (let repairs = 0; repairs <= MAX_REPAIRS; repairs += 1) {
    if (fx.cancelled()) return { kind: "cancelled" };

    const found = blocking(fx.diagnose(candidate));
    if (found.length) {
      const detail = shortDetail(found);
      if (repairs === MAX_REPAIRS) {
        emitStep(`repair-${repairs}`, "repair", "failed", detail);
        emitStep("give-up", "stop", "failed", detail);
        return { kind: "blocked", reason: "static", detail };
      }
      emitStep(`repair-${repairs + 1}`, "repair", "active", detail);
      try {
        const fixed = await fx.model(repairMessages({ request: input.request, design, files: candidate.files, problems: found, consoleTail: "" }));
        candidate = applyChanges(candidate, readCandidateFiles(fixed, candidate, "main.py").files);
      } catch (error) {
        const message = error instanceof Error ? error.message : "The model call failed.";
        emitStep(`repair-${repairs + 1}`, "repair", "failed", detail);
        return { kind: "failed", message };
      }
      emitStep(`repair-${repairs + 1}`, "repair", "done", detail);
      fx.emit({ kind: "candidate", candidate: { project: candidate, design, say, repairs: repairs + 1, diff: candidateDiff(base, candidate) } });
      continue;
    }

    emitStep("check", "check", "active");
    const outcome = await fx.run(candidate, input);
    if (outcome.kind === "cancelled") return { kind: "cancelled" };
    if (outcome.kind === "running") {
      emitStep("check", "check", "done");
      finish();
      return { kind: "ready" };
    }
    if (outcome.kind === "error") {
      if (repairs === MAX_REPAIRS) {
        const detail = outcome.detail.slice(0, 200);
        emitStep(`repair-${repairs}`, "repair", "failed", detail);
        emitStep("give-up", "stop", "failed", detail);
        return { kind: "blocked", reason: "runtime", detail };
      }
      emitStep(`repair-${repairs + 1}`, "repair", "active");
      try {
        const fixed = await fx.model(
          repairMessages({ request: input.request, design, files: candidate.files, problems: [], consoleTail: outcome.detail }),
        );
        candidate = applyChanges(candidate, readCandidateFiles(fixed, candidate, "main.py").files);
      } catch (error) {
        const message = error instanceof Error ? error.message : "The model call failed.";
        emitStep(`repair-${repairs + 1}`, "repair", "failed");
        return { kind: "failed", message };
      }
      emitStep(`repair-${repairs + 1}`, "repair", "done");
      fx.emit({ kind: "candidate", candidate: { project: candidate, design, say, repairs: repairs + 1, diff: candidateDiff(base, candidate) } });
      continue;
    }

    // No evidence either way: hand the candidate to the child instead of
    // guessing. Nothing here is proof of a code problem, so no repair.
    emitStep("check", "check", "done");
    finish();
    return { kind: "ready", unverified: outcome.kind };
  }

  emitStep("give-up", "stop", "failed");
  return { kind: "blocked", reason: "limit" };
}
