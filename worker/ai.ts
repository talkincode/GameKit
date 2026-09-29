import type { GameKitEnv } from "./env";
import { HttpError } from "./http";

/**
 * AI gateway. Callers must already have passed the identity gate.
 * Rules: docs/ai-rules.md. Keys and model choice stay on the server.
 */

const IMAGE_MODEL = "@cf/black-forest-labs/flux-1-schnell";
// Reasoning models spend part of this budget thinking before they answer.
const MAX_TOKENS = 16_000;
const IMAGE_SAFETY =
  "Child-friendly cartoon style for a kids' game. No violence, blood, weapons pointed at people, " +
  "horror, nudity, real people, text, watermarks, or brand logos.";

export type ChatMessage = { role: "system" | "user"; content: string };

export function readMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) {
    throw new HttpError(400, "bad_request", "A completion needs 1 to 8 messages.");
  }
  return value.map((message) => {
    if (!message || typeof message !== "object") throw new HttpError(400, "bad_request", "Invalid message.");
    const entry = message as { role?: unknown; content?: unknown };
    if (entry.role !== "system" && entry.role !== "user") {
      throw new HttpError(400, "bad_request", "Unsupported message role.");
    }
    if (typeof entry.content !== "string" || entry.content.length > 24_000) {
      throw new HttpError(400, "bad_request", "A message is missing or too long.");
    }
    return { role: entry.role, content: entry.content };
  });
}

export async function complete(env: GameKitEnv, messages: ChatMessage[]): Promise<string> {
  const base = env.OPENAI_API_URL?.trim().replace(/\/+$/, "") ?? "";
  const key = env.OPENAI_API_KEY?.trim() ?? "";
  const model = env.OPENAI_MODEL?.trim() ?? "";
  if (!base || !key || !model) throw new HttpError(503, "not_configured", "The text model is not configured.");

  const response = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: MAX_TOKENS,
      temperature: 0.2,
      response_format: { type: "json_object" },
    }),
  });
  if (!response.ok) {
    // The provider's body may echo request details; keep only the status.
    throw new HttpError(502, "upstream_failed", `The text model returned HTTP ${response.status}.`);
  }
  const body = (await response.json()) as { choices?: { message?: { content?: unknown } }[] };
  const text = body.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) {
    throw new HttpError(502, "upstream_failed", "The text model returned an empty response.");
  }
  return text;
}

export async function image(env: GameKitEnv, prompt: unknown): Promise<{ image: string; mediaType: string }> {
  if (typeof prompt !== "string" || prompt.trim().length < 3 || prompt.length > 1200) {
    throw new HttpError(400, "bad_request", "The image prompt must be between 3 and 1200 characters.");
  }
  if (!env.AI) throw new HttpError(503, "not_configured", "Workers AI is not configured for this deployment.");
  const result = (await env.AI.run(IMAGE_MODEL, { prompt: `${prompt.trim()} ${IMAGE_SAFETY}`, steps: 4 })) as {
    image?: string;
  };
  if (!result.image) throw new HttpError(502, "upstream_failed", "The image model returned no image.");
  return { image: result.image, mediaType: "image/jpeg" };
}
