// A stand-in for the OpenAI-compatible text model, used only by E2E tests.
// POST /chat/completions answers with the reply chosen by POST /__next.
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_MODEL_PORT ?? 4199);
export const MARKER = "# 小助手加的注释";

let next = "files";

function read(request) {
  return new Promise((resolve) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => resolve(body));
  });
}

function replyFor(mode, messages) {
  if (mode === "broken") return "this is not json";
  if (mode === "explain") return JSON.stringify({ explanation: "这段代码让角色跳起来。" });
  const user = messages.find((message) => message.role === "user")?.content ?? "";
  const source = user.match(/Current file:\n([\s\S]*?)\n(?:Selection:|Error:|Fix this error)/)?.[1] ?? "";
  return JSON.stringify({
    explanation: "我在最上面加了一行注释。",
    files: [{ path: "main.py", content: `${MARKER}\n${source}` }],
  });
}

createServer(async (request, response) => {
  const body = await read(request);
  if (request.method === "POST" && request.url === "/__next") {
    next = JSON.parse(body).mode;
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
    const content = replyFor(next, messages);
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }));
    return;
  }
  response.writeHead(404).end();
}).listen(PORT, "127.0.0.1");
