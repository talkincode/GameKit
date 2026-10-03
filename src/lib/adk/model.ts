/**
 * Google ADK drives the conversation; our Worker still makes the model call.
 *
 * Keys never reach the browser (docs/ai-rules.md 第 2 节), so ADK's LLM is a
 * `BaseLlm` that forwards to `/api/ai` and maps the answer back into ADK's shape.
 * Usage comes along, because ADK's token budget and compactor are built on it.
 */
import { BaseLlm, type LlmRequest, type LlmResponse } from "@google/adk";

type Part = { text?: string; inlineData?: { mimeType?: string; data?: string } };
type Content = { role?: string; parts?: Part[] };
type GatewayPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
type GatewayMessage =
  | { role: "system" | "user" | "assistant"; content: string }
  | { role: "user"; content: GatewayPart[] };

export type GatewayProblem = "sign-in" | "denied" | "unavailable" | "offline" | "failed";

/** A gateway failure that the studio knows how to explain to the child. */
export class GatewayError extends Error {
  constructor(readonly problem: GatewayProblem) {
    super(problem);
  }
}

export type GatewayAnswer = {
  text: string;
  promptTokens?: number;
  completionTokens?: number;
};

/** The one place that knows how to talk to the GameKit gateway. */
export async function askGateway(messages: GatewayMessage[]): Promise<GatewayAnswer> {
  let response: Response;
  try {
    response = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "complete", messages }),
      credentials: "same-origin",
      redirect: "manual",
    });
  } catch {
    throw new GatewayError("offline");
  }
  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
    throw new GatewayError("sign-in");
  }
  const payload = (await response.json().catch(() => ({}))) as {
    text?: string;
    usage?: { promptTokens?: number; completionTokens?: number };
    code?: string;
  };
  if (!response.ok) {
    if (response.status === 401) throw new GatewayError("sign-in");
    if (response.status === 403) throw new GatewayError("denied");
    if (response.status === 503) throw new GatewayError("unavailable");
    throw new GatewayError("failed");
  }
  if (typeof payload.text !== "string" || !payload.text.trim()) throw new GatewayError("failed");
  return { text: payload.text, promptTokens: payload.usage?.promptTokens, completionTokens: payload.usage?.completionTokens };
}

function gatewayContent(content: Content, withImages: boolean): string | GatewayPart[] {
  const parts = content.parts ?? [];
  // Pictures belong to the message the child just sent; older ones stay in the
  // session (so the assistant remembers) but are not re-sent every time.
  const images = withImages ? parts.filter((part) => part.inlineData?.data) : [];
  const text = parts.map((part) => part.text ?? "").join("");
  if (!images.length) return text;
  const out: GatewayPart[] = [{ type: "text", text }];
  for (const image of images) {
    out.push({
      type: "image_url",
      image_url: { url: `data:${image.inlineData?.mimeType ?? "image/png"};base64,${image.inlineData?.data}` },
    });
  }
  return out;
}

export function toGatewayMessages(contents: Content[], system?: string): GatewayMessage[] {
  const messages: GatewayMessage[] = [];
  if (system) messages.push({ role: "system", content: system });
  contents.forEach((content, index) => {
    const body = gatewayContent(content, index === contents.length - 1);
    if (typeof body === "string") {
      messages.push({ role: content.role === "model" ? "assistant" : "user", content: body });
    } else {
      // Pictures only ever travel with what the child sent.
      messages.push({ role: "user", content: body });
    }
  });
  return messages;
}

/**
 * ADK's model, pointed at the GameKit gateway. `instruction` (the system prompt)
 * is applied by the agent, so requests arrive with contents only.
 */
export class GatewayLlm extends BaseLlm {
  static readonly supportedModels: (string | RegExp)[] = [/.*/];
  /** Why the last call failed, for the runner to rethrow as a GatewayError. */
  lastProblem: GatewayProblem | null = null;

  constructor(readonly instruction = "") {
    super({ model: "gamekit-gateway" });
  }

  /**
   * Live streaming is not offered: the gateway answers in one piece, which is all
   * the product needs (a step either produces JSON or it does not).
   */
  async connect(): Promise<never> {
    throw new Error("The GameKit gateway does not stream.");
  }

  async *generateContentAsync(llmRequest: LlmRequest): AsyncGenerator<LlmResponse, void> {
    const contents = (llmRequest.contents ?? []) as Content[];
    let answer: GatewayAnswer;
    try {
      answer = await askGateway(toGatewayMessages(contents, this.instruction));
      this.lastProblem = null;
    } catch (error) {
      // ADK turns a thrown error into an event, so remember the reason here.
      this.lastProblem = error instanceof GatewayError ? error.problem : "failed";
      throw error;
    }
    yield {
      content: { role: "model", parts: [{ text: answer.text }] },
      usageMetadata: {
        promptTokenCount: answer.promptTokens ?? 0,
        candidatesTokenCount: answer.completionTokens ?? 0,
        totalTokenCount: (answer.promptTokens ?? 0) + (answer.completionTokens ?? 0),
      },
      turnComplete: true,
    } as LlmResponse;
  }
}
