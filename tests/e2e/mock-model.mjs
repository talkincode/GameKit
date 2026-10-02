// A stand-in for the OpenAI-compatible text model, used only by E2E tests.
// POST /chat/completions answers according to the current mode, which the test
// picks with POST /__next. The mode also decides whether the first build answer
// contains a problem the static check must catch.
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_MODEL_PORT ?? 4199);
const MARKER = "# 小助手加的注释";

// A complete, honest pygame loop: no static problems, so the agent loop can
// finish without a real pygame runtime.
const CLEAN_MAIN = `import asyncio
import pygame

pygame.init()
pygame.display.set_caption("太空小方块")
screen = pygame.display.set_mode((480, 320))
clock = pygame.time.Clock()


async def main():
    running = True
    while running:
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False
        screen.fill((12, 16, 34))
        pygame.display.flip()
        clock.tick(60)
        await asyncio.sleep(0)


asyncio.run(main())
`;

// The static check rejects time.sleep in the browser; a repair request must
// come back clean. This is how the loop's repair path is exercised for real.
const SLEEPY_MAIN = CLEAN_MAIN.replace("        pygame.display.flip()", "        time.sleep(1)\n        pygame.display.flip()");

const DESIGN = {
  say: "我打算做一个在太空里躲陨石的小游戏。",
  title: "太空小方块",
  hero: "一个小方块",
  goal: "躲开落下来的陨石",
  controls: ["← → 移动"],
  look: "深蓝色的太空",
};

let mode = "clean";
let builds = 0;

function read(request) {
  return new Promise((resolve) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => resolve(body));
  });
}

function replyFor(messages) {
  if (mode === "broken") return "this is not json";
  const user = messages.find((message) => message.role === "user")?.content ?? "";
  // The design request is the one that asks for a design card.
  if (user.includes('"hero"')) return JSON.stringify(DESIGN);
  // Explain requests must never return files.
  if (user.includes("不要给出新代码")) return JSON.stringify({ say: "这段代码让角色跳起来。" });
  // A repair request quotes what was wrong; answer with the clean file.
  if (user.includes("修好这些问题")) {
    return JSON.stringify({ say: "修好了，再试一次。", files: [{ path: "main.py", content: `${MARKER}\n${CLEAN_MAIN}` }] });
  }
  builds += 1;
  const main = mode === "sleepy" && builds === 1 ? SLEEPY_MAIN : CLEAN_MAIN;
  // A second build adds a line, so a round that continues an adopted game has a
  // real change to show.
  const stamp = builds > 1 ? `${MARKER}\n# 第 ${builds} 版` : MARKER;
  return JSON.stringify({ say: "做好了，先试试看。", files: [{ path: "main.py", content: `${stamp}\n${main}` }] });
}

createServer(async (request, response) => {
  const body = await read(request);
  if (request.method === "POST" && request.url === "/__next") {
    const payload = JSON.parse(body);
    mode = payload.mode;
    builds = 0;
    response.end("ok");
    return;
  }
  if (request.method === "GET" && request.url === "/__health") {
    response.end("ok");
    return;
  }
  if (request.method === "POST" && request.url === "/chat/completions") {
    if (request.headers.authorization !== "Bearer e2e-key") {
      response.writeHead(401).end("bad key");
      return;
    }
    const { messages } = JSON.parse(body);
    const content = replyFor(messages);
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }));
    return;
  }
  response.writeHead(404).end();
}).listen(PORT, "127.0.0.1");
