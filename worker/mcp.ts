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
import { findHit, libraryAssetPath, searchCatalog } from "../shared/catalog";
import { studioTool } from "../shared/tools";
import type { CollabSession, CollabState } from "./collab";
import type { GameKitEnv } from "./env";
import { officialCatalog } from "./official-catalog";

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

  const search = studioTool("search_assets");
  server.tool(
    search.name,
    search.description,
    { query: z.string().describe("words to look for, such as a Chinese title or a tag; empty lists the first assets") },
    async ({ query }) => {
      const hits = searchCatalog(officialCatalog(), query, 8);
      if (!hits.length) {
        return { content: [{ type: "text", text: "素材目录里没有找到这个。换一个词试试。" }] };
      }
      const lines = hits.map(
        (hit) => `${hit.packId}/${hit.assetId} ${hit.title}（${hit.category}）${hit.tags.join("、")} → ${libraryAssetPath(hit)}`,
      );
      return {
        content: [
          {
            type: "text",
            text: `只读检索，没有改项目：\n${lines.join("\n")}`,
          },
        ],
      };
    },
  );

  const proposeAsset = studioTool("propose_asset");
  server.tool(
    proposeAsset.name,
    proposeAsset.description,
    {
      packId: z.string().describe("catalog pack id, such as forest-adventure"),
      assetId: z.string().describe("catalog asset id, such as coin"),
      say: z.string().describe("one short sentence in Simplified Chinese for the child"),
    },
    async ({ packId, assetId, say }) => {
      const state = await loadOwned();
      const hit = findHit(officialCatalog(), packId, assetId);
      if (!hit) {
        return { content: [{ type: "text", text: "素材目录里没有这个。先用 search_assets 查，再提议。" }], isError: true };
      }
      const dest = libraryAssetPath(hit);
      if (state.session.files.some((file) => file.path === dest)) {
        return {
          content: [{ type: "text", text: `${dest} 已经在项目里。助手不能盖掉它，请孩子自己在素材库里选择。` }],
          isError: true,
        };
      }
      const examplePath = `examples/load-${hit.assetId}.py`;
      const load =
        hit.mediaType.startsWith("audio/")
          ? `sound = pygame.mixer.Sound("${dest}")\nsound.play()\n`
          : `image = pygame.image.load("${dest}").convert_alpha()\n`;
      const example =
        `import pygame\n\n# ${hit.title}\n# 许可：${hit.license} · 作者：${hit.author}\n` +
        (hit.mediaType.startsWith("audio/") ? "pygame.mixer.init()\n" : "") +
        load;
      const { candidateId } = await sessionFor(env, email).propose({
        tool: proposeAsset.name,
        say,
        files: [{ path: examplePath, text: example }],
        assets: [{ packId: hit.packId, assetId: hit.assetId }],
      });
      return {
        content: [
          {
            type: "text",
            text: `已交给孩子确认（候选 ${candidateId}）。素材要等他说「采用这一版」才会复制进项目，不会直接改掉已有文件。`,
          },
        ],
      };
    },
  );

  server.tool(
    "list_files",
    studioTool("list_files").description,
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
    studioTool("read_file").description,
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
    studioTool("propose_files").description,
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
        if (file.path === "assets/library.json") {
          return { content: [{ type: "text", text: "素材库的版本记录要孩子自己在素材库里改，助手不能改写。" }], isError: true };
        }
        if (file.path.endsWith(".anim.json")) {
          return { content: [{ type: "text", text: "动画说明要孩子自己在像素编辑器里改，助手不能改写。" }], isError: true };
        }
        if (file.path.endsWith(".map.json") || file.path.endsWith(".tileset.png") || (file.path.startsWith("maps/") && file.path.endsWith(".csv"))) {
          return { content: [{ type: "text", text: "地图要孩子自己在地图编辑器里改，助手不能改写。" }], isError: true };
        }
        if (/\.(wav|ogg|mp3|aiff)$/i.test(file.path)) {
          return { content: [{ type: "text", text: "声音文件要孩子自己在声音编辑器里改，助手不能改写。" }], isError: true };
        }
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
    studioTool("read_activity").description,
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
