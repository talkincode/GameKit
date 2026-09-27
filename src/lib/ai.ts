import { normalizePath, type Project } from "./project";

export type ChatMessage = { role: "system" | "user"; content: string };

export type TextChange = { path: string; content: string };

export type FileProposal = {
  kind: "files";
  explanation: string;
  files: TextChange[];
};

export type ExplainResult = { kind: "explain"; explanation: string };

const SYSTEM = `You assist inside GameKit, a browser Pygame editor.
Rules:
- The user owns the project. Change only the requested scope.
- Write ordinary pygame. Never invent a GameKit game API.
- The browser runtime is pygame-ce via pygbag. A frame loop must include await asyncio.sleep(0), usually right after pygame.display.flip(). That form also runs on desktop Python.
- Do not use time.sleep, pygame.time.wait, or pygame.time.delay.
- Prefer pygame.font.Font(None, size) or a project .ttf over SysFont.
- Audio for the web build should be OGG Vorbis.
- Return JSON only. No markdown fences. No extra commentary.`;

export function messagesFor(
  action: "initialize" | "generate" | "complete" | "refactor" | "explain" | "fix",
  input: {
    prompt: string;
    path?: string;
    source?: string;
    selection?: string;
    error?: string;
  },
): ChatMessage[] {
  const file = input.path ? `File: ${input.path}\n` : "";
  const source = input.source ? `Current file:\n${input.source}\n` : "";
  const selection = input.selection ? `Selection:\n${input.selection}\n` : "";
  const error = input.error ? `Error:\n${input.error}\n` : "";
  const ask: Record<typeof action, string> = {
    initialize: `${input.prompt}\nReturn {"explanation":"...","files":[{"path":"main.py","content":"..."}]}. Include main.py. At most 6 files. Do not include binary assets.`,
    generate: `${file}${input.prompt}\nReturn {"explanation":"...","files":[{"path":"...","content":"..."}]} with exactly one file.`,
    complete: `${file}${source}${selection}Complete only the selection. Return {"explanation":"...","files":[{"path":"${input.path ?? "main.py"}","content":"<entire file after the edit>"}]}.`,
    refactor: `${file}${source}${selection}Refactor only the selection. Keep behavior. Return {"explanation":"...","files":[{"path":"${input.path ?? "main.py"}","content":"<entire file after the edit>"}]}.`,
    explain: `${file}${source}${selection}Explain the selection or file. Return {"explanation":"..."} and do not rewrite code.`,
    fix: `${file}${source}${error}Fix this error in the file. Return {"explanation":"...","files":[{"path":"${input.path ?? "main.py"}","content":"<entire file after the fix>"}]}.`,
  };
  return [
    { role: "system", content: SYSTEM },
    { role: "user", content: ask[action] },
  ];
}

export function assetPrompt(kind: "sprite" | "background" | "tile" | "icon", prompt: string, variation: number): string {
  const hint = {
    sprite: "A single game sprite, centered, simple readable shapes, no text, no scenery.",
    background: "A wide game background with no characters, no text, and no interface.",
    tile: "A seamless square game tile texture, no text.",
    icon: "A simple centered game icon, no text.",
  }[kind];
  const extra = variation > 1 ? ` Variation ${variation}.` : "";
  return `${hint} ${prompt.trim()}.${extra}`.slice(0, 900);
}

export function parseModelJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced?.[1] ?? raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The model did not return JSON.");
  return JSON.parse(body.slice(start, end + 1)) as unknown;
}

export function readModelResult(raw: string, project: Project, fallbackPath: string): FileProposal | ExplainResult {
  const value = parseModelJson(raw);
  if (!value || typeof value !== "object") throw new Error("The model response was empty.");
  const record = value as { explanation?: unknown; files?: unknown };
  const explanation = typeof record.explanation === "string" ? record.explanation.trim() : "";
  if (!Array.isArray(record.files)) {
    if (!explanation) throw new Error("The model did not explain anything.");
    return { kind: "explain", explanation };
  }
  const files: TextChange[] = [];
  for (const item of record.files.slice(0, 6)) {
    if (!item || typeof item !== "object") continue;
    const entry = item as { path?: unknown; content?: unknown };
    const path = normalizePath(typeof entry.path === "string" ? entry.path : fallbackPath);
    const allowed = !!path && [".py", ".txt", ".toml", ".json", ".md"].some((ext) => path.endsWith(ext));
    if (!path || !allowed) throw new Error(`Rejected a file outside the text-edit scope: ${String(entry.path)}`);
    if (project.files.some((file) => file.path === path && file.bytes)) {
      throw new Error(`AI cannot replace the binary asset ${path}.`);
    }
    if (typeof entry.content !== "string" || entry.content.length > 60_000) {
      throw new Error(`Rejected the contents of ${path}.`);
    }
    files.push({ path, content: entry.content });
  }
  if (!files.length) throw new Error("The model did not propose a file.");
  return { kind: "files", explanation, files };
}
