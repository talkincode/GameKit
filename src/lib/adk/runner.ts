/**
 * One ADK agent + runner per project session.
 *
 * ADK keeps the conversation (events), the token budget and the compaction; our
 * loop keeps the product steps — design, build, check, repair — each of which is
 * one ADK run whose answer we parse exactly as before.
 */
import { InMemorySessionService, LlmAgent, LlmSummarizer, Runner, TokenBasedContextCompactor } from "@google/adk";
import { GatewayError, GatewayLlm } from "./model";
import { ProjectSessionService } from "./session";

/** How many recent events stay verbatim when compaction runs. */
const KEEP_RECENT_EVENTS = 10;

export type ProjectRunner = {
  sessionId: string;
  run: (parts: { text?: string; inlineData?: { mimeType: string; data: string } }[]) => Promise<string>;
};

/** The only user of a project's conversation is the child who owns it. */
const USER = "child";

const runners = new Map<string, ProjectRunner>();

/**
 * The runner for one project. Created on first use (the project id is the session
 * id) and reused after that, so the conversation carries across rounds and views.
 */
export function projectRunner(input: { system: string; sessionId: string; budgetTokens: number }): ProjectRunner {
  // The budget is part of the identity: changing it in 设置 builds a fresh runner,
  // otherwise the compactor would keep the old threshold.
  const key = `${input.sessionId}:${input.budgetTokens}`;
  const existing = runners.get(key);
  if (existing) return existing;

  const llm = new GatewayLlm(input.system);
  const sessions = new ProjectSessionService();
  const agent = new LlmAgent({
    name: "gamekit_designer",
    model: llm,
    instruction: input.system,
    contextCompactors: [
      new TokenBasedContextCompactor({
        tokenThreshold: input.budgetTokens,
        eventRetentionSize: KEEP_RECENT_EVENTS,
        summarizer: new LlmSummarizer({
          llm: new GatewayLlm(
            "You compress a game-making conversation for a child. Keep every decision, file name, and request that still matters; drop small talk. Write Simplified Chinese, short and concrete.",
          ),
        }),
      }),
    ],
  });
  const runner = new Runner({
    appName: "gamekit",
    agent,
    sessionService: sessions,
  });

  // ADK refuses to run without a session, so a project's conversation is created
  // on its first round and loaded from IndexedDB on every later one.
  let ready: Promise<void> | null = null;
  const ensureSession = () => {
    ready ??= (async () => {
      const existing = await sessions.getSession({ appName: "gamekit", userId: USER, sessionId: input.sessionId });
      if (existing) return;
      await sessions.createSession({ appName: "gamekit", userId: USER, sessionId: input.sessionId });
    })();
    return ready;
  };

  const created: ProjectRunner = {
    sessionId: input.sessionId,
    async run(parts) {
      await ensureSession();
      const events = runner.runAsync({
        userId: USER,
        sessionId: input.sessionId,
        newMessage: { role: "user", parts },
      });
      let answer = "";
      for await (const event of events) {
        for (const part of event.content?.parts ?? []) {
          if (typeof part.text === "string" && !part.thought) answer += part.text;
        }
      }
      if (!answer.trim()) {
        // A refused sign-in or an offline gateway must reach the studio, not
        // disappear inside the event stream.
        throw new GatewayError(llm.lastProblem ?? "failed");
      }
      return answer;
    },
  };
  runners.set(key, created);
  return created;
}

/** True when this project already has a conversation on disk. */
export async function projectHasSession(sessionId: string): Promise<boolean> {
  const service = new ProjectSessionService();
  const session = await service.getSession({ appName: "gamekit", userId: USER, sessionId });
  return !!session && session.events.length > 0;
}

/** Forgets a project's runner (its session stays on disk until the project goes). */
export function forgetProjectRunner(sessionId: string): void {
  for (const key of [...runners.keys()]) {
    if (key.startsWith(`${sessionId}:`)) runners.delete(key);
  }
}

/** Forgets every runner: the next round picks up new settings. */
export function forgetAllRunners(): void {
  runners.clear();
}

export { InMemorySessionService };
