/**
 * 协作会话：外部 Agent 与孩子的项目之间的中转站。
 *
 * The child's project stays in their browser. When they start 协作, the page
 * publishes a snapshot here, an MCP tool reads it, and anything the tool proposes
 * is held as a *candidate* — the page polls, shows it, and only the child's 采用
 * writes it into their project (docs/ai-rules.md §7.1, AGENTS.md 不变量 7).
 *
 * One Durable Object per session: the session id is the object name.
 */
import { DurableObject } from "cloudflare:workers";
import type { GameKitEnv } from "./env";

export type CollabFile = { path: string; text?: string; bytes?: number };

export type CollabSnapshot = {
  projectId: string;
  name: string;
  files: CollabFile[];
  updatedAt: number;
};

/** A change an external agent proposed; the child decides what happens to it. */
export type CollabCandidate = {
  id: string;
  tool: string;
  say: string;
  files: { path: string; text: string }[];
  createdAt: number;
  adopted?: boolean;
  discarded?: boolean;
};

export type CollabActivity = { at: number; tool: string; summary: string };

export type CollabState = {
  email: string;
  session: CollabSnapshot;
  candidates: CollabCandidate[];
  activity: CollabActivity[];
  startedAt: number;
};

/** How long a session lives without the page touching it. */
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_ACTIVITY = 40;
const MAX_CANDIDATES = 20;

export class CollabSession extends DurableObject<GameKitEnv> {
  private state: CollabState | null = null;

  private async load(): Promise<CollabState | null> {
    if (!this.state) {
      this.state = (await this.ctx.storage.get<CollabState>("state")) ?? null;
    }
    if (this.state && Date.now() - this.state.session.updatedAt > SESSION_TTL_MS) {
      this.state = null;
      await this.ctx.storage.deleteAll();
    }
    return this.state;
  }

  private async save(): Promise<void> {
    if (this.state) await this.ctx.storage.put("state", this.state);
  }

  /** Called by the page when 协作 starts: this is the snapshot tools read. */
  async start(input: { email: string; snapshot: CollabSnapshot; sessionId: string }): Promise<{ sessionId: string }> {
    this.state = {
      email: input.email,
      session: input.snapshot,
      candidates: [],
      activity: [{ at: Date.now(), tool: "start", summary: "协作开始" }],
      startedAt: Date.now(),
    };
    await this.save();
    return { sessionId: input.sessionId };
  }

  /** The page's poll: it pushes the latest files and takes away new candidates. */
  async sync(snapshot: CollabSnapshot): Promise<{ candidates: CollabCandidate[]; activity: CollabActivity[] }> {
    const state = await this.load();
    if (!state) return { candidates: [], activity: [] };
    state.session = snapshot;
    await this.save();
    return {
      candidates: state.candidates.filter((candidate) => !candidate.adopted && !candidate.discarded),
      activity: state.activity.slice(-10),
    };
  }

  /** The child took it (or threw it away); the session stops offering it. */
  async settle(input: { candidateId: string; adopted: boolean }): Promise<void> {
    const state = await this.load();
    if (!state) return;
    const candidate = state.candidates.find((item) => item.id === input.candidateId);
    if (!candidate) return;
    candidate.adopted = input.adopted;
    candidate.discarded = !input.adopted;
    state.activity.push({
      at: Date.now(),
      tool: "settle",
      summary: input.adopted ? `孩子采用了 ${candidate.id}` : `孩子丢掉了 ${candidate.id}`,
    });
    await this.save();
  }

  async stop(): Promise<void> {
    this.state = null;
    await this.ctx.storage.deleteAll();
  }

  /** What MCP tools see: the snapshot as it was last published. */
  async read(): Promise<CollabState | null> {
    return await this.load();
  }

  /** A tool proposed something: keep it as a candidate and note it as activity. */
  async propose(input: {
    tool: string;
    say: string;
    files: { path: string; text: string }[];
  }): Promise<{ candidateId: string }> {
    const state = await this.load();
    if (!state) throw new Error("No collaboration session is open for this project.");
    const candidate: CollabCandidate = {
      id: crypto.randomUUID().slice(0, 8),
      tool: input.tool,
      say: input.say,
      files: input.files,
      createdAt: Date.now(),
    };
    state.candidates = [...state.candidates, candidate].slice(-MAX_CANDIDATES);
    state.activity = [...state.activity, { at: Date.now(), tool: input.tool, summary: input.say }].slice(-MAX_ACTIVITY);
    await this.save();
    return { candidateId: candidate.id };
  }

  async describe(): Promise<{ projectId: string; name: string; files: number; openCandidates: number } | null> {
    const state = await this.load();
    if (!state) return null;
    return {
      projectId: state.session.projectId,
      name: state.session.name,
      files: state.session.files.length,
      openCandidates: state.candidates.filter((candidate) => !candidate.adopted && !candidate.discarded).length,
    };
  }

  /** Sessions are looked up by id; the DO itself is addressed by the page. */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/read")) return Response.json(await this.read());
    return new Response("Not found", { status: 404 });
  }
}
