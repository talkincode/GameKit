/**
 * The assistant's visible conversation for one project.
 *
 * A round still does not write the child's project until they adopt. The
 * transcript is what makes the next sentence the same game: the words already
 * said, and the candidate still on screen. It lives in IndexedDB beside the
 * project, so a refresh is not a new conversation.
 */
import { isAssistantCode, type PublicFailure } from "../../shared/assistant-error";
import type { AgentStep, AgentTurnOutcome, CandidateResult, FileDiff } from "./agent";
import type { EarlierRound } from "./ai";
import { designFromRecord, type DesignCard } from "./design";
import { fromStored, toStored, type Project } from "./project";

/** How many rounds stay on the card list. Older ones remain in the agent session. */
const KEEP_TURNS = 40;

const STEP_KINDS = new Set(["hear", "design", "build", "check", "repair", "finish", "stop"]);
const STEP_STATUS = new Set(["active", "done", "failed"]);

export type ConversationTurn = {
  id: string;
  kind: "design" | "explain";
  request: string;
  images?: string[];
  steps: AgentStep[];
  design?: DesignCard;
  say: string;
  candidate?: CandidateResult;
  outcome?: AgentTurnOutcome;
  adopted: boolean;
  discarded: boolean;
  answer?: string;
};

type RoundSource = {
  kind: string;
  request: string;
  say?: string;
  answer?: string;
  design?: { title?: string };
  adopted: boolean;
  discarded: boolean;
  candidate?: { project: Project; design: DesignCard };
};

/** Short lines for the next model request. The latest sentence is not one of them. */
export function earlierRounds(turns: RoundSource[]): EarlierRound[] {
  return turns
    .map((turn) => ({
      request: turn.request.trim(),
      say: (turn.kind === "explain" ? turn.answer : turn.say)?.trim() ?? "",
      title: turn.design?.title?.trim() || undefined,
    }))
    .filter((round) => round.request || round.say);
}

/**
 * The game the next sentence edits. An unadopted candidate is what the child
 * is looking at; adopting or discarding returns to the saved project.
 * A sentence that has not produced a version yet is skipped, so the round
 * currently being sent cannot hide the candidate still on screen.
 */
export function projectForNextRound(saved: Project, turns: RoundSource[]): Project {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn?.kind !== "design" || !turn.candidate) continue;
    if (turn.adopted || turn.discarded) return saved;
    return {
      ...turn.candidate.project,
      id: saved.id,
      name: saved.name,
      createdAt: saved.createdAt,
      design: turn.candidate.design,
      trash: saved.trash,
    };
  }
  return saved;
}

/** Plain JSON for IndexedDB. Candidate bytes go through the same encoding as projects. */
export function packConversation(turns: ConversationTurn[]): unknown[] {
  return turns.slice(-KEEP_TURNS).map((turn) => ({
    id: turn.id,
    kind: turn.kind,
    request: turn.request,
    say: turn.say,
    adopted: turn.adopted,
    discarded: turn.discarded,
    images: turn.images,
    steps: turn.steps,
    design: turn.design,
    answer: turn.answer,
    outcome: turn.outcome,
    candidate: turn.candidate
      ? {
          project: toStored(turn.candidate.project),
          design: turn.candidate.design,
          say: turn.candidate.say,
          repairs: turn.candidate.repairs,
          diff: turn.candidate.diff,
        }
      : undefined,
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function readSteps(value: unknown): AgentStep[] {
  if (!Array.isArray(value)) return [];
  const steps: AgentStep[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const kind = item.kind;
    const status = item.status;
    if (typeof kind !== "string" || !STEP_KINDS.has(kind)) continue;
    if (typeof status !== "string" || !STEP_STATUS.has(status)) continue;
    if (typeof item.key !== "string" || !item.key) continue;
    const detail = typeof item.detail === "string" ? item.detail : undefined;
    steps.push({ key: item.key, kind: kind as AgentStep["kind"], status: status as AgentStep["status"], detail });
  }
  return steps;
}

function readDiff(value: unknown): FileDiff[] {
  if (!Array.isArray(value)) return [];
  const diffs: FileDiff[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.path !== "string") continue;
    if (!Array.isArray(item.rows)) continue;
    const rows: FileDiff["rows"] = [];
    for (const row of item.rows) {
      if (!isRecord(row) || (row.kind !== "same" && row.kind !== "add" && row.kind !== "del")) continue;
      if (typeof row.text !== "string") continue;
      rows.push({ kind: row.kind, text: row.text });
    }
    diffs.push({ path: item.path, rows });
  }
  return diffs;
}

function readOutcome(value: unknown): AgentTurnOutcome | undefined {
  if (!isRecord(value) || typeof value.kind !== "string") return undefined;
  const requestId = typeof value.requestId === "string" ? value.requestId : undefined;
  if (value.kind === "cancelled") return { kind: "cancelled", requestId };
  if (value.kind === "ready") {
    const unverified = value.unverified === "quiet" || value.unverified === "unavailable" ? value.unverified : undefined;
    return { kind: "ready", unverified, requestId };
  }
  if (value.kind === "blocked" && (value.reason === "static" || value.reason === "runtime" || value.reason === "limit")) {
    return {
      kind: "blocked",
      reason: value.reason,
      detail: typeof value.detail === "string" ? value.detail : undefined,
      requestId,
    };
  }
  if (value.kind === "failed" && isRecord(value.failure) && typeof value.message === "string") {
    const failure = value.failure;
    if (!isAssistantCode(failure.code) || typeof failure.message !== "string") return { kind: "cancelled" };
    const parsed: PublicFailure = {
      requestId: typeof failure.requestId === "string" ? failure.requestId : "",
      code: failure.code,
      message: failure.message,
      detail: typeof failure.detail === "string" ? failure.detail : "",
      at: typeof failure.at === "string" ? failure.at : "",
    };
    return { kind: "failed", message: value.message, failure: parsed };
  }
  return undefined;
}

function readImages(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const images = value.filter((item): item is string => typeof item === "string" && item.startsWith("data:image/")).slice(0, 4);
  return images.length ? images : undefined;
}

function readCandidate(value: unknown): CandidateResult | undefined {
  if (!isRecord(value) || !isRecord(value.project)) return undefined;
  const design = designFromRecord(value.design);
  if (!design) return undefined;
  const stored = value.project as { id?: unknown; files?: unknown };
  if (typeof stored.id !== "string" || !Array.isArray(stored.files)) return undefined;
  try {
    return {
      project: fromStored(value.project as Parameters<typeof fromStored>[0]),
      design,
      say: typeof value.say === "string" ? value.say : "",
      repairs: typeof value.repairs === "number" && value.repairs >= 0 ? Math.floor(value.repairs) : 0,
      diff: readDiff(value.diff),
    };
  } catch {
    return undefined;
  }
}

/** Reads a saved transcript. A broken row is an empty conversation, not a crash. */
export function restoreConversation(raw: unknown): ConversationTurn[] {
  if (!Array.isArray(raw)) return [];
  const turns: ConversationTurn[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    if ((item.kind !== "design" && item.kind !== "explain") || typeof item.id !== "string" || typeof item.request !== "string") continue;
    const design = designFromRecord(item.design) ?? undefined;
    let outcome = readOutcome(item.outcome);
    const candidate = item.kind === "design" ? readCandidate(item.candidate) : undefined;
    if (item.kind === "design" && !outcome) outcome = { kind: "cancelled" };
    turns.push({
      id: item.id,
      kind: item.kind,
      request: item.request,
      say: typeof item.say === "string" ? item.say : "",
      adopted: item.adopted === true,
      discarded: item.discarded === true,
      images: readImages(item.images),
      steps: readSteps(item.steps),
      design,
      answer: typeof item.answer === "string" ? item.answer : undefined,
      outcome,
      candidate,
    });
  }
  return turns.slice(-KEEP_TURNS);
}
