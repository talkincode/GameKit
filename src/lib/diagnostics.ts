import type { Project } from "./project";

export type Problem = {
  id: string;
  severity: "error" | "warning";
  path?: string;
  line?: number;
  message: string;
};

export function diagnoseProject(project: Project): Problem[] {
  const problems: Problem[] = [];
  const main = project.files.find((file) => file.path === "main.py");
  if (!main?.text?.trim()) {
    problems.push({
      id: "entry",
      severity: "error",
      path: "main.py",
      message: "The web runtime starts at main.py.",
    });
  }

  const source = main?.text ?? "";
  source.split("\n").forEach((line, index) => {
    const lineNumber = index + 1;
    if (/\btime\.sleep\s*\(/.test(line)) {
      problems.push({
        id: `sleep-${lineNumber}`,
        severity: "error",
        path: "main.py",
        line: lineNumber,
        message: "time.sleep blocks the browser tab. Use await asyncio.sleep(...). It still runs on desktop Python.",
      });
    }
    if (/pygame\.time\.(wait|delay)\s*\(/.test(line)) {
      problems.push({
        id: `wait-${lineNumber}`,
        severity: "error",
        path: "main.py",
        line: lineNumber,
        message: "pygame.time.wait and pygame.time.delay do not yield to the browser. Use await asyncio.sleep(...).",
      });
    }
    if (/SysFont\s*\(/.test(line)) {
      problems.push({
        id: `sysfont-${lineNumber}`,
        severity: "warning",
        path: "main.py",
        line: lineNumber,
        message: "SysFont needs a font installed on the host. Use pygame.font.Font(None, size) or ship a .ttf file.",
      });
    }
  });

  const draws = /pygame\.display\.(flip|update)\s*\(/.test(source);
  const yields = /await\s+asyncio\.sleep\s*\(/.test(source);
  if (source && draws && !yields) {
    problems.push({
      id: "yield",
      severity: "error",
      path: "main.py",
      message:
        "Add await asyncio.sleep(0) once per frame, usually right after display.flip(). Without it the browser runtime cannot repaint or read input.",
    });
  }

  for (const file of project.files) {
    const ext = file.path.split(".").pop()?.toLowerCase();
    if (ext && ["wav", "mp3", "aiff"].includes(ext)) {
      problems.push({
        id: `audio-${file.path}`,
        severity: "warning",
        path: file.path,
        message: "The browser runtime plays OGG Vorbis. This file stays in the project for desktop Pygame, and may stay silent on the web.",
      });
    }
  }

  return problems;
}

export function problemsFromConsole(text: string): Problem[] {
  const marker = "Traceback (most recent call last):";
  const start = text.lastIndexOf(marker);
  if (start < 0) return [];
  const tail = text.slice(start + marker.length);
  const files = [...tail.matchAll(/File "([^"]+)", line (\d+)/g)];
  const errorLine = tail
    .split("\n")
    .map((line) => line.trim())
    .find((line) => /^(?:[A-Za-z_][\w.]*)?(?:Error|Exception):/.test(line));
  if (!files.length && !errorLine) return [];
  const last = files.at(-1);
  const raw = last?.[1] ?? "main.py";
  const path = raw.includes("/assets/") ? raw.split("/assets/").pop() || "main.py" : raw.split("/").pop() || "main.py";
  return [
    {
      id: `runtime-${path}-${last?.[2] ?? "0"}-${errorLine ?? "error"}`,
      severity: "error",
      path,
      line: last ? Number(last[2]) : undefined,
      message: errorLine || "The game raised an exception. See the console.",
    },
  ];
}
