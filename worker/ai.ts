import type { GameKitEnv } from "./env";
import { HttpError } from "./http";

/**
 * AI gateway. Callers must already have passed the identity gate.
 * Rules: docs/ai-rules.md. Keys and model choice stay on the server.
 */

/**
 * Image model: Gemini's Interactions API. It draws from one prompt (the child's
 * words, refined by the text model first) and takes the image size, so a sprite
 * can be square and a background wide.
 *
 * The key lives in a Worker secret. Nothing here ever reaches the browser.
 */
const GEMINI_INTERACTIONS = "https://generativelanguage.googleapis.com/v1beta/interactions";
/** Used only when GEMINI_IMAGE_MODEL is not set; the .env / secret value wins. */
const DEFAULT_IMAGE_MODEL = "models/gemini-3.1-flash-lite-image";
// 1K is the smallest size this model accepts; the browser resizes from there.
const IMAGE_SIZE = "1K";
// Reasoning models spend part of this budget thinking before they answer.
const MAX_TOKENS = 16_000;

export type AssetKind = "sprite" | "background" | "tile" | "icon";

const ASSET_KINDS: AssetKind[] = ["sprite", "background", "tile", "icon"];

/**
 * Output per asset kind. The size is what the model draws; the browser resizes
 * and, for sprites and icons, cuts the background out.
 */
const IMAGE_SIZES: Record<AssetKind, string> = {
  sprite: IMAGE_SIZE,
  icon: IMAGE_SIZE,
  tile: IMAGE_SIZE,
  background: IMAGE_SIZE,
};

/**
 * The rules of docs/ai-rules.md section 6, as negative instructions the model
 * itself is told to avoid. They stay server-side: a child's words only ever
 * become the subject.
 */
const IMAGE_AVOID =
  "Do not draw: weapons, swords, knives, guns, blood, gore, injuries, violence, horror, scary things, " +
  "text, letters, words, captions, signatures, watermarks, logos, frames, borders, " +
  "real people, photos, 3D renders, crowds, or more than one character.";

const IMAGE_STYLE = "bright flat cartoon game art for children, thick clean outlines, simple shapes";

/**
 * Sprites and icons are cut out in the browser, so they are drawn on one flat
 * colour that never appears in a children's cartoon: magenta.
 */
const CUTOUT_BACKGROUND = "on a solid flat magenta background (#FF00FF) with nothing else in the picture";

/** What each kind of asset has to look like on its own. */
const IMAGE_SHOT: Record<AssetKind, string> = {
  sprite: `a single friendly cartoon character, whole body, front view, centered with space around it, ${CUTOUT_BACKGROUND}`,
  icon: `a single simple cartoon symbol, centered with space around it, ${CUTOUT_BACKGROUND}`,
  tile: "a seamless repeating square texture of this material, seen from directly above, evenly lit, filling the whole picture, no single object",
  background: "a wide game background of this place, scenery only, no characters, filling the whole picture",
};

export type ImageRequest = { kind: AssetKind; subject: string; variation: number };

/** Reads and limits the child's request. Unknown kinds are refused, not guessed. */
export function readImageRequest(record: { kind?: unknown; prompt?: unknown; variation?: unknown }): ImageRequest {
  const kind = ASSET_KINDS.find((item) => item === record.kind);
  if (!kind) throw new HttpError(400, "bad_request", "Unknown asset kind.");
  const subject = typeof record.prompt === "string" ? record.prompt.trim() : "";
  if (subject.length < 2 || subject.length > 300) {
    throw new HttpError(400, "bad_request", "Describe the asset in 2 to 300 characters.");
  }
  const raw = typeof record.variation === "number" && Number.isFinite(record.variation) ? Math.floor(record.variation) : 1;
  return { kind, subject, variation: Math.min(Math.max(raw, 1), 12) };
}

/**
 * The child describes assets in Chinese; diffusion models are trained on
 * English. Without this step "小狐狸" is noise to the model and it falls back to
 * whatever the English words around it say.
 */
async function subjectInEnglish(env: GameKitEnv, subject: string): Promise<string> {
  try {
    const answer = await complete(env, [
      {
        role: "system",
        content:
          "You turn a child's description of a game asset into one short English image prompt. " +
          "Concrete and simple: subject, colours, shape. No sentences, no violence, no weapons, no text, no people. " +
          'Reply as JSON: {"prompt":"..."}',
      },
      { role: "user", content: subject },
    ]);
    const parsed = JSON.parse(answer.text.slice(answer.text.indexOf("{"), answer.text.lastIndexOf("}") + 1)) as { prompt?: unknown };
    const prompt = typeof parsed.prompt === "string" ? parsed.prompt.trim() : "";
    if (prompt.length >= 3) return prompt.slice(0, 300);
  } catch {
    // No text model, or it answered badly: draw the child's own words instead.
  }
  return subject;
}

export function imagePromptFor(kind: AssetKind, subject: string): string {
  return `${IMAGE_SHOT[kind]}. Subject: ${subject}. Style: ${IMAGE_STYLE}. ${IMAGE_AVOID}`;
}

/** A message is text, or text plus pictures the child attached to this round. */
export type ChatPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };
export type ChatMessage = { role: "system" | "user" | "assistant"; content: string | ChatPart[] };
export type ChatAnswer = { text: string; usage?: { promptTokens: number; completionTokens: number } };

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_IMAGES_PER_REQUEST = 4;
// A whole agent conversation may travel in one request now, so the message
// budget is generous while each message keeps its own size cap.
const MAX_MESSAGES = 60;
// The browser downscales before sending; this is the upper bound we accept.
const MAX_IMAGE_CHARS = 900_000;

export function readMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_MESSAGES) {
    throw new HttpError(400, "bad_request", `A completion needs 1 to ${MAX_MESSAGES} messages.`);
  }
  let images = 0;
  return value.map((message) => {
    if (!message || typeof message !== "object") throw new HttpError(400, "bad_request", "Invalid message.");
    const entry = message as { role?: unknown; content?: unknown };
    if (entry.role !== "system" && entry.role !== "user" && entry.role !== "assistant") {
      throw new HttpError(400, "bad_request", "Unsupported message role.");
    }
    if (typeof entry.content === "string") {
      if (entry.content.length > 24_000) throw new HttpError(400, "bad_request", "A message is missing or too long.");
      return { role: entry.role, content: entry.content };
    }
    if (!Array.isArray(entry.content) || !entry.content.length || entry.content.length > 8) {
      throw new HttpError(400, "bad_request", "Invalid message content.");
    }
    const parts: ChatPart[] = entry.content.map((part) => {
      const item = part as { type?: unknown; text?: unknown; image_url?: { url?: unknown } } | null;
      if (item?.type === "text") {
        const text = typeof item.text === "string" ? item.text : "";
        if (text.length > 24_000) throw new HttpError(400, "bad_request", "A message is too long.");
        return { type: "text", text };
      }
      if (item?.type === "image_url") {
        const url = typeof item.image_url?.url === "string" ? item.image_url.url : "";
        const header = /^data:(image\/[a-z0-9.+-]+);base64,/.exec(url)?.[1] ?? "";
        if (!IMAGE_TYPES.includes(header)) {
          throw new HttpError(400, "bad_request", "Only PNG, JPEG or WebP pictures can be attached.");
        }
        if (url.length > MAX_IMAGE_CHARS) throw new HttpError(400, "bad_request", "That picture is too big.");
        images += 1;
        if (images > MAX_IMAGES_PER_REQUEST) {
          throw new HttpError(400, "bad_request", "At most four pictures per request.");
        }
        return { type: "image_url", image_url: { url } };
      }
      throw new HttpError(400, "bad_request", "Unsupported message content.");
    });
    return { role: entry.role, content: parts };
  });
}

/**
 * What this deployment's text model can take. The window is a deployment fact, so
 * it comes from configuration; the client sizes the agent's memory with it
 * instead of guessing (see src/lib/settings.ts).
 */
export function modelInfo(env: GameKitEnv): { model: string; contextTokens: number } {
  const declared = Number(env.OPENAI_CONTEXT_TOKENS ?? "");
  return {
    model: env.OPENAI_MODEL?.trim() ?? "",
    contextTokens: Number.isFinite(declared) && declared > 0 ? Math.floor(declared) : 128_000,
  };
}

export async function complete(env: GameKitEnv, messages: ChatMessage[]): Promise<ChatAnswer> {
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
  const body = (await response.json()) as {
    choices?: { message?: { content?: unknown } }[];
    usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
  };
  const text = body.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) {
    throw new HttpError(502, "upstream_failed", "The text model returned an empty response.");
  }
  // Usage travels back: ADK measures a project session against its token budget with it.
  const promptTokens = Number(body.usage?.prompt_tokens ?? 0);
  const completionTokens = Number(body.usage?.completion_tokens ?? 0);
  return {
    text,
    usage:
      Number.isFinite(promptTokens) && Number.isFinite(completionTokens)
        ? { promptTokens, completionTokens }
        : undefined,
  };
}

export async function image(env: GameKitEnv, request: ImageRequest): Promise<{ image: string; mediaType: string }> {
  const key = env.GEMINI_APIKEY?.trim() ?? "";
  if (!key) throw new HttpError(503, "not_configured", "The image model is not configured for this deployment.");
  const model = env.GEMINI_IMAGE_MODEL?.trim() || DEFAULT_IMAGE_MODEL;
  // One model call improves the child's words; then one draws them.
  const subject = await subjectInEnglish(env, request.subject);
  const response = await fetch(GEMINI_INTERACTIONS, {
    method: "POST",
    headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      input: imagePromptFor(request.kind, subject),
      generation_config: {
        temperature: 1,
        top_p: 0.95,
        max_output_tokens: 65_536,
        thinking_level: "minimal",
        image_config: { image_size: IMAGE_SIZES[request.kind] },
      },
      response_modalities: ["image"],
    }),
  });
  if (!response.ok) {
    // The provider's body may echo the request or our key; keep only the status.
    throw new HttpError(502, "upstream_failed", `The image model returned HTTP ${response.status}.`);
  }
  return readInteractionImage(await response.json());
}

/**
 * An interaction answers with steps; the picture is an `image` part in the
 * model's output step. Its `data` is base64 and `mime_type` says what it is.
 */
export function readInteractionImage(payload: unknown): { image: string; mediaType: string } {
  const steps = (payload as { steps?: unknown } | null)?.steps;
  if (Array.isArray(steps)) {
    for (const step of steps) {
      const content = (step as { content?: unknown } | null)?.content;
      if (!Array.isArray(content)) continue;
      for (const part of content) {
        const entry = part as { type?: unknown; data?: unknown; mime_type?: unknown } | null;
        if (!entry || entry.type !== "image") continue;
        const data = typeof entry.data === "string" ? entry.data : "";
        const mime = typeof entry.mime_type === "string" && entry.mime_type ? entry.mime_type : "image/jpeg";
        if (data) return { image: data, mediaType: mime };
      }
    }
  }
  throw new HttpError(502, "upstream_failed", "The image model returned no image.");
}
