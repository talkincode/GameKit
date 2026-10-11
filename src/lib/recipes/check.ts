/**
 * Deterministic checks for one lesson step.
 *
 * A step passes or fails from the file text and, when the game has printed a
 * marker, from that console line. The model is not asked whether the child
 * succeeded.
 */
import { CATCH_MAIN, MAZE_MAIN, PLATFORM_MAIN, SHOOTER_MAIN, SNAKE_MAIN } from "./source";

export type StepVerdict = {
  ok: boolean;
  /** One sentence for the child. */
  say: string;
  /** The line and marker the check actually used. */
  evidence: string;
};

export type LessonStep = {
  id: string;
  goal: string;
  hint: string;
  explain: string;
  path: string;
  assert: (source: string, consoleText: string) => StepVerdict;
  suggestion: { path: string; content: string; say: string };
};

function assignment(source: string, name: string): string | null {
  const match = source.match(new RegExp(`^${name}\\s*=\\s*([^#\\n]+)`, "m"));
  return match ? match[1].trim() : null;
}

function readNumber(source: string, name: string): number | null {
  const raw = assignment(source, name);
  if (!raw || !/^-?\d+(?:\.\d+)?$/.test(raw)) return null;
  return Number(raw);
}

function frameProblem(source: string): string | null {
  if (/\btime\.sleep\s*\(/.test(source) || /pygame\.time\.(wait|delay)\s*\(/.test(source)) {
    return "这里用了会卡住页面的等待。要改成 await asyncio.sleep(0)。";
  }
  if (!/await\s+asyncio\.sleep\s*\(/.test(source)) {
    return "帧循环里还要有 await asyncio.sleep(0)，不然浏览器里跑不起来。";
  }
  return null;
}

function markerNumber(consoleText: string, marker: string): number | null {
  const matches = [...consoleText.matchAll(new RegExp(`${marker}\\s+(-?\\d+(?:\\.\\d+)?)`, "g"))];
  const last = matches.at(-1);
  return last ? Number(last[1]) : null;
}

function replaceNumber(source: string, name: string, value: string): string {
  const pattern = new RegExp(`^(${name}\\s*=\\s*)(-?\\d+(?:\\.\\d+)?)`, "m");
  if (!pattern.test(source)) throw new Error(`Recipe step could not find ${name}.`);
  return source.replace(pattern, `$1${value}`);
}

function numberStep(input: {
  id: string;
  name: string;
  marker: string;
  source: string;
  suggested: string;
  goal: string;
  hint: string;
  explain: string;
  say: string;
  missing: string;
  notYet: string;
  passed: string;
  ok: (value: number) => boolean;
}): LessonStep {
  return {
    id: input.id,
    goal: input.goal,
    hint: input.hint,
    explain: input.explain,
    path: "main.py",
    suggestion: { path: "main.py", content: replaceNumber(input.source, input.name, input.suggested), say: input.say },
    assert: (source, consoleText) => {
      const stuck = frameProblem(source);
      const value = readNumber(source, input.name);
      const printed = markerNumber(consoleText, input.marker);
      const evidence = [
        `${input.name} = ${assignment(source, input.name) ?? "（没有这一行）"}`,
        printed === null ? `控制台还没有 ${input.marker}` : `控制台 ${input.marker} ${printed}`,
      ].join("\n");
      if (stuck) return { ok: false, say: stuck, evidence };
      if (value === null) return { ok: false, say: input.missing, evidence };
      if (!input.ok(value)) return { ok: false, say: input.notYet, evidence };
      if (printed !== null && printed !== value) {
        return { ok: false, say: "代码和舞台对不上。保存后再试玩一次，然后检查。", evidence };
      }
      if (printed !== null && !input.ok(printed)) return { ok: false, say: input.notYet, evidence };
      return { ok: true, say: input.passed, evidence };
    },
  };
}

const platformStep: LessonStep = numberStep({
  id: "higher-jump",
  name: "JUMP",
  marker: "RECIPE-JUMP",
  source: PLATFORM_MAIN,
  suggested: "-13",
  goal: "让角色跳得更高：JUMP 要比 -9 更小。",
  hint: "打开 main.py，找到 JUMP = -9。把 -9 改成更小的数，比如 -13。",
  explain: "往上跳的速度是负数。数字越小，离地面越远，所以跳得更高。改完要留着 await asyncio.sleep(0)。",
  say: "我把 JUMP 改成了 -13。这只是可以试的一版，采用之后才写进你的项目。",
  missing: "没有找到 JUMP 这一行。它要写成 JUMP = 一个数字。",
  notYet: "跳跃还没有变高。JUMP 需要比 -9 更小。",
  passed: "跳得更高了。可以去舞台上试一试。",
  ok: (value) => value < -9,
});

const catchStep: LessonStep = numberStep({
  id: "faster-paddle",
  name: "PADDLE",
  marker: "RECIPE-PADDLE",
  source: CATCH_MAIN,
  suggested: "10",
  goal: "让接球板滑得更快：PADDLE 要比 6 大。",
  hint: "找到 PADDLE = 6，把 6 改成更大的整数，比如 10。",
  explain: "每一帧板子移动的像素就是 PADDLE。数字越大，越容易接到球。",
  say: "我把 PADDLE 改成了 10。采用之后，接球板才会变快。",
  missing: "没有找到 PADDLE 这一行。它要写成 PADDLE = 一个数字。",
  notYet: "接球板还是原来的速度。PADDLE 需要比 6 大。",
  passed: "接球板更快了。",
  ok: (value) => value > 6,
});

const shooterStep: LessonStep = numberStep({
  id: "faster-shot",
  name: "COOLDOWN",
  marker: "RECIPE-COOLDOWN",
  source: SHOOTER_MAIN,
  suggested: "8",
  goal: "让射击间隔变短：COOLDOWN 要是比 18 小的正数。",
  hint: "找到 COOLDOWN = 18，改成 1 到 17 之间的整数，比如 8。",
  explain: "COOLDOWN 是两发之间要等的帧数。变小就会射得更勤。写成 0 或负数会每一帧都发射，所以要留成正数。",
  say: "我把 COOLDOWN 改成了 8。采用之后才会射得更勤。",
  missing: "没有找到 COOLDOWN 这一行。",
  notYet: "射击间隔还没变短。COOLDOWN 需要是比 18 小的正数。",
  passed: "射击更勤了。",
  ok: (value) => value > 0 && value < 18,
});

const snakeStep: LessonStep = numberStep({
  id: "faster-snake",
  name: "STEP",
  marker: "RECIPE-STEP",
  source: SNAKE_MAIN,
  suggested: "4",
  goal: "让蛇走得更快：STEP 要是比 8 小的正数。",
  hint: "找到 STEP = 8，改成 1 到 7 之间的整数，比如 4。",
  explain: "STEP 是走一格之前要等的帧数。数字越小，蛇越快。",
  say: "我把 STEP 改成了 4。采用之后蛇才会变快。",
  missing: "没有找到 STEP 这一行。",
  notYet: "蛇还是原来的速度。STEP 需要是比 8 小的正数。",
  passed: "蛇走得更快了。",
  ok: (value) => value > 0 && value < 8,
});

const mazeStep: LessonStep = {
  id: "open-gate",
  goal: "把门打开：OPEN_GATE 要写成 True。",
  hint: "找到 OPEN_GATE = False，把 False 改成 True。大小写要一样。",
  explain: "OPEN_GATE 是一个开关。False 是关着，True 是开着。开着的时候，(2, 2) 那一格就不再是墙。",
  path: "main.py",
  suggestion: {
    path: "main.py",
    content: MAZE_MAIN.replace("OPEN_GATE = False", "OPEN_GATE = True"),
    say: "我把 OPEN_GATE 改成了 True。采用之后，那一格墙才会打开。",
  },
  assert: (source, consoleText) => {
    const stuck = frameProblem(source);
    const raw = assignment(source, "OPEN_GATE");
    const evidence = `OPEN_GATE = ${raw ?? "（没有这一行）"}\n${consoleText.includes("RECIPE-GATE") ? "控制台有 RECIPE-GATE" : "控制台还没有 RECIPE-GATE"}`;
    if (stuck) return { ok: false, say: stuck, evidence };
    if (raw !== "True" && raw !== "False") return { ok: false, say: "没有找到 OPEN_GATE = True 或 False。", evidence };
    if (raw !== "True") return { ok: false, say: "门还关着。把 OPEN_GATE 写成 True。", evidence };
    if (/RECIPE-GATE\s+False/.test(consoleText)) {
      return { ok: false, say: "代码写了 True，舞台上还是关着的。再试玩一次，然后检查。", evidence };
    }
    return { ok: true, say: "门打开了。走到那一格看看。", evidence };
  },
};

export const LESSONS: Record<string, LessonStep> = {
  platform: platformStep,
  catch: catchStep,
  maze: mazeStep,
  shooter: shooterStep,
  snake: snakeStep,
};

export function lessonFor(recipeId: string): LessonStep | null {
  return LESSONS[recipeId] ?? null;
}

export function checkLesson(recipeId: string, source: string, consoleText: string): StepVerdict | null {
  const lesson = lessonFor(recipeId);
  if (!lesson) return null;
  return lesson.assert(source, consoleText);
}
