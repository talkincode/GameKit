/**
 * 协作：页面把当前项目发布给会话，外部 Agent 通过 MCP 只读它、只能提候选。
 *
 * These routes are for the page, behind the same identity gate as every other
 * /api route; the MCP side has its own OAuth tokens (worker/oauth.ts).
 */
import type { CollabSession, CollabSnapshot } from "./collab";
import type { GameKitEnv } from "./env";
import { HttpError, json } from "./http";
import { collabName } from "./mcp";

function sessionFor(env: GameKitEnv, email: string): DurableObjectStub<CollabSession> {
  return env.COLLAB.get(env.COLLAB.idFromName(collabName(email))) as DurableObjectStub<CollabSession>;
}

function readSnapshot(value: unknown): CollabSnapshot {
  const record = (value ?? {}) as Record<string, unknown>;
  const files = Array.isArray(record.files) ? record.files : [];
  return {
    projectId: String(record.projectId ?? ""),
    name: String(record.name ?? "project").slice(0, 60),
    updatedAt: Date.now(),
    files: files.slice(0, 200).map((file) => {
      const entry = (file ?? {}) as Record<string, unknown>;
      const path = String(entry.path ?? "").slice(0, 180);
      if (typeof entry.bytes === "number") return { path, bytes: entry.bytes };
      return { path, text: String(entry.text ?? "").slice(0, 120_000) };
    }),
  };
}

export async function collabRoute(request: Request, env: GameKitEnv, email: string, action: string): Promise<Response> {
  const session = sessionFor(env, email);
  if (action === "start") {
    const body = (await request.json().catch(() => ({}))) as { snapshot?: unknown };
    await session.start({ email, sessionId: collabName(email), snapshot: readSnapshot(body.snapshot) });
    return json({ session: collabName(email) });
  }
  if (action === "sync") {
    const body = (await request.json().catch(() => ({}))) as { snapshot?: unknown; settled?: unknown };
    const settled = Array.isArray(body.settled) ? body.settled : [];
    for (const item of settled.slice(0, 20)) {
      const entry = (item ?? {}) as { candidateId?: unknown; adopted?: unknown };
      if (typeof entry.candidateId === "string") {
        await session.settle({ candidateId: entry.candidateId, adopted: entry.adopted === true });
      }
    }
    const answer = await session.sync(readSnapshot(body.snapshot));
    return json(answer);
  }
  if (action === "stop") {
    await session.stop();
    return json({ stopped: true });
  }
  throw new HttpError(404, "not_found", "Unknown collaboration action.");
}
