/**
 * MCP 服务：外部 Agent 用 OAuth 登录后，通过这几个工具参与同一个项目。
 *
 * Read tools see the snapshot the child's page published; write tools can only
 * produce a candidate, which the page shows and the child adopts. The tool list
 * is deliberately small and mirrors what the built-in assistant can do
 * (docs/ai-rules.md §8: 一套工具，多个入口).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { DurableObject } from "cloudflare:workers";
import { z } from "zod";
import type { CollabSession, CollabState } from "./collab";
import type { GameKitEnv } from "./env";

/** One collaboration session per person, so a token only needs the email. */
export function collabName(email: string): string {
  return `user:${email.trim().toLowerCase()}`;
}

export function sessionFor(env: GameKitEnv, email: string): DurableObjectStub<CollabSession> {
  return env.COLLAB.get(env.COLLAB.idFromName(collabName(email))) as DurableObjectStub<CollabSession>;
}

export function createGameKitMcpServer(env: GameKitEnv, email: string): McpServer {
  const server = new McpServer({ name: "gamekit", version: "1.0.0" });

  async function loadOwned(): Promise<CollabState> {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) throw new Error("This token carries no account.");
    const state = await sessionFor(env, trimmed).read();
    if (!state) {
      throw new Error("孩子还没有开始协作，或者已经停掉了。请让他在设置里点「开始协作」。");
    }
    return state;
  }

  server.tool(
    "list_files",
    "List the files of the project the child shared for collaboration (paths only).",
    {},
    async () => {
      const state = await loadOwned();
      const lines = state.session.files.map((file) =>
        file.bytes ? `${file.path}（二进制素材，${file.bytes} 字节）` : file.path,
      );
      return { content: [{ type: "text", text: `${state.session.name}:\n${lines.join("\n")}` }] };
    },
  );

  server.tool(
    "read_file",
    "Read one text file of the shared project.",
    { path: z.string().describe("project-relative path, e.g. main.py") },
    async ({ path }) => {
      const state = await loadOwned();
      const file = state.session.files.find((item) => item.path === path);
      if (!file) return { content: [{ type: "text", text: `没有 ${path} 这个文件。` }], isError: true };
      if (file.bytes || file.text === undefined) {
        return { content: [{ type: "text", text: `${path} 是二进制素材，不能当代码读。` }], isError: true };
      }
      return { content: [{ type: "text", text: file.text }] };
    },
  );

  server.tool(
    "propose_files",
    "Propose text files for the project. This only creates a candidate the child sees and adopts; it never writes the project directly. Send whole files, up to 6.",
    {
      say: z.string().describe("one short sentence in Simplified Chinese for the child"),
      files: z
        .array(z.object({ path: z.string(), text: z.string() }))
        .min(1)
        .max(6)
        .describe("whole files; paths must stay inside the project and be text (.py, .txt, .json, .toml, .md)"),
    },
    async ({ say, files }) => {
      const state = await loadOwned();
      const binary = state.session.files.filter((file) => file.bytes).map((file) => file.path);
      for (const file of files) {
        if (![".py", ".txt", ".json", ".toml", ".md"].some((ext) => file.path.endsWith(ext))) {
          return { content: [{ type: "text", text: `只能改文本文件，${file.path} 不行。` }], isError: true };
        }
        if (binary.includes(file.path)) {
          return { content: [{ type: "text", text: `${file.path} 是孩子的素材，不能替换。` }], isError: true };
        }
        if (file.text.length > 60_000) {
          return { content: [{ type: "text", text: `${file.path} 太长了（上限 60000 字符）。` }], isError: true };
        }
      }
      const { candidateId } = await sessionFor(env, email).propose({
        tool: "propose_files",
        say,
        files,
      });
      return {
        content: [
          {
            type: "text",
            text: `已交给孩子确认（候选 ${candidateId}）。他说「采用这一版」之后才会写进项目。`,
          },
        ],
      };
    },
  );

  server.tool(
    "read_activity",
    "Read what has happened in this collaboration session so far.",
    {},
    async () => {
      const state = await loadOwned();
      return {
        content: [
          {
            type: "text",
            text: state.activity.map((item) => `${new Date(item.at).toISOString()} ${item.summary}`).join("\n"),
          },
        ],
      };
    },
  );

  return server;
}

/** Handles an incoming MCP request over Streamable HTTP transport. */
export async function handleMcpRequest(request: Request, env: GameKitEnv, email: string): Promise<Response> {
  const server = createGameKitMcpServer(env, email);
  const transport = new WebStandardStreamableHTTPServerTransport();
  await server.connect(transport);
  return await transport.handleRequest(request);
}

/** Durable Object export matching wrangler.jsonc bindings. */
export class GameKitMcp extends DurableObject<GameKitEnv> {
  async fetch(): Promise<Response> {
    return new Response("GameKit MCP DO", { status: 200 });
  }
}
