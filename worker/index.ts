type AiEnv = { AI: Ai };

const TEXT_MODEL = "@cf/qwen/qwen2.5-coder-32b-instruct";
const IMAGE_MODEL = "@cf/black-forest-labs/flux-1-schnell";

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/api/ai") return new Response(null, { status: 404 });
    if (request.method !== "POST") return json({ error: "Use POST." }, 405);
    if (!env.AI) return json({ error: "Workers AI is not configured for this deployment." }, 503);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "The request body must be JSON." }, 400);
    }
    if (!body || typeof body !== "object") return json({ error: "The request body must be an object." }, 400);
    const record = body as { op?: unknown; messages?: unknown; prompt?: unknown };

    try {
      if (record.op === "complete") return await complete(env, record.messages);
      if (record.op === "image") return await image(env, record.prompt);
      return json({ error: "Unknown AI operation." }, 400);
    } catch (error) {
      const message = error instanceof Error ? error.message : "The AI request failed.";
      return json({ error: message }, 502);
    }
  },
} satisfies ExportedHandler<AiEnv>;

async function complete(env: AiEnv, messages: unknown): Promise<Response> {
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 8) {
    return json({ error: "A completion needs 1 to 8 messages." }, 400);
  }
  const clean = messages.map((message) => {
    if (!message || typeof message !== "object") throw new Error("Invalid message.");
    const entry = message as { role?: unknown; content?: unknown };
    if (entry.role !== "system" && entry.role !== "user") throw new Error("Unsupported message role.");
    if (typeof entry.content !== "string" || entry.content.length > 24_000) {
      throw new Error("A message is missing or too long.");
    }
    return { role: entry.role, content: entry.content };
  });
  const result = await env.AI.run(TEXT_MODEL, { messages: clean, max_tokens: 4096, temperature: 0.2 });
  const text = textOf(result);
  if (!text) return json({ error: "The model returned an empty response." }, 502);
  return json({ text });
}

async function image(env: AiEnv, prompt: unknown): Promise<Response> {
  if (typeof prompt !== "string" || prompt.trim().length < 3 || prompt.length > 1200) {
    return json({ error: "The image prompt must be between 3 and 1200 characters." }, 400);
  }
  const result = (await env.AI.run(IMAGE_MODEL, { prompt: prompt.trim(), steps: 4 })) as { image?: string };
  if (!result.image) return json({ error: "The image model returned no image." }, 502);
  return json({ image: result.image, mediaType: "image/jpeg" });
}

function textOf(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const record = result as { response?: unknown };
  return typeof record.response === "string" ? record.response : "";
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}
