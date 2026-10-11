/**
 * Built-in pygame recipes.
 *
 * Starting one always returns a new project. Callers prepend it; they never
 * copy files onto the project that is already open.
 */
import type { DesignCard } from "../design";
import type { Project, ProjectFile } from "../project";
import { lessonFor, type LessonStep } from "./check";
import { appleSprite, ballSprite, heroSprite, shipSprite } from "./pixels";
import { CATCH_MAIN, MAZE_MAIN, PLATFORM_MAIN, SHOOTER_MAIN, SNAKE_MAIN } from "./source";

export const RECIPE_FORMAT = "gamekit.recipe";

export type RecipeInfo = {
  id: string;
  title: string;
  summary: string;
  knowledge: string[];
  design: DesignCard;
  /** What the child should notice in this step. */
  goal: string;
};

type Recipe = RecipeInfo & {
  files: () => ProjectFile[];
};

function readme(title: string, lines: string[]): string {
  return [`${title}`, "", ...lines, "", "这是普通的 Python + pygame。舞台运行 main.py。", ""].join("\n");
}

function recipeNote(info: RecipeInfo, lesson: LessonStep): string {
  return `${JSON.stringify(
    {
      format: RECIPE_FORMAT,
      id: info.id,
      title: info.title,
      summary: info.summary,
      knowledge: info.knowledge,
      challenge: { id: lesson.id, goal: lesson.goal },
    },
    null,
    2,
  )}\n`;
}

function bundle(info: RecipeInfo, main: string, png: { path: string; bytes: Uint8Array }, lesson: LessonStep): ProjectFile[] {
  return [
    { path: "main.py", text: main },
    { path: png.path, bytes: png.bytes },
    { path: "recipe.json", text: recipeNote(info, lesson) },
    { path: "README.txt", text: readme(info.title, [info.summary, ...info.knowledge.map((line) => `· ${line}`)]) },
  ];
}

const platform: Recipe = {
  id: "platform",
  title: "平台跳跃",
  summary: "一个小人在地面上跑和跳。",
  knowledge: [
    "角色是一个矩形，每帧加上速度",
    "重力是往下加一点速度",
    "往上跳的速度是负数",
    "素材库的「平台跳跃」里有小人、草地和跳跃声，可以复制进来",
  ],
  design: {
    title: "平台跳跃",
    hero: "一个小探险家",
    goal: "用方向键跑，用空格跳，不要掉出去",
    controls: ["← → 或 A D 移动", "空格跳跃"],
    look: "深蓝的天，绿色的地面",
  },
  goal: "",
  files: () =>
    bundle(platform, PLATFORM_MAIN, { path: "assets/hero.png", bytes: heroSprite() }, lessonFor("platform")!),
};

const catchBall: Recipe = {
  id: "catch",
  title: "接球",
  summary: "左右移动板子，接住掉下来的球。",
  knowledge: ["球每帧改一次坐标", "碰到左右边就反过来", "矩形重叠就是接到了"],
  design: {
    title: "接球",
    hero: "一块接球板",
    goal: "接住球就加一分，漏掉就重新落下",
    controls: ["← → 或 A D 移动板子"],
    look: "深色场地，金色的球",
  },
  goal: "",
  files: () => bundle(catchBall, CATCH_MAIN, { path: "assets/ball.png", bytes: ballSprite() }, lessonFor("catch")!),
};

const maze: Recipe = {
  id: "maze",
  title: "迷宫",
  summary: "一格一格走到金色的终点，有一扇可以打开的门。",
  knowledge: [
    "地图是几行文字，1 是墙",
    "人一次只走一格",
    "开关 OPEN_GATE 决定那一格能不能走",
    "素材库的「迷宫地牢」里有地砖、门和箱子，可以放进地图",
  ],
  design: {
    title: "迷宫",
    hero: "一个橙色方块",
    goal: "走到金色方块。门打开之后，近处的墙可以穿过去",
    controls: ["方向键或 W A S D，一次走一格"],
    look: "暗色格子，金色终点",
  },
  goal: "",
  files: () => bundle(maze, MAZE_MAIN, { path: "assets/hero.png", bytes: heroSprite() }, lessonFor("maze")!),
};

const shooter: Recipe = {
  id: "shooter",
  title: "卡通射击",
  summary: "左右移动飞船，向一块会飘的方块发射。没有受伤的画面。",
  knowledge: [
    "飞船的位置每帧跟着按键变",
    "子弹是一组矩形，往上飞",
    "两发之间要等 COOLDOWN 帧",
    "素材库的「太空射击」里有飞船、地面图块和激光声，可以复制进来",
  ],
  design: {
    title: "卡通射击",
    hero: "一艘小飞船",
    goal: "躲开往下靠的方块，打中它就加一分",
    controls: ["← → 或 A D 移动", "空格或 ↑ 发射"],
    look: "深色星空，浅色飞船",
  },
  goal: "",
  files: () => bundle(shooter, SHOOTER_MAIN, { path: "assets/ship.png", bytes: shipSprite() }, lessonFor("shooter")!),
};

const snake: Recipe = {
  id: "snake",
  title: "贪吃蛇",
  summary: "蛇在格子里走，吃到苹果就变长。",
  knowledge: ["蛇是一串格子，头插到前面", "没吃到就把尾巴拿掉", "STEP 是走一格要等的帧数"],
  design: {
    title: "贪吃蛇",
    hero: "一条绿色的蛇",
    goal: "吃苹果变长，不要撞墙或撞到自己",
    controls: ["方向键或 W A S D 转向"],
    look: "深绿色地面，红色苹果",
  },
  goal: "",
  files: () => bundle(snake, SNAKE_MAIN, { path: "assets/apple.png", bytes: appleSprite() }, lessonFor("snake")!),
};

const RECIPES: Recipe[] = [platform, catchBall, maze, shooter, snake];

export function listRecipes(): RecipeInfo[] {
  return RECIPES.map((recipe) => {
    const lesson = lessonFor(recipe.id);
    return {
      id: recipe.id,
      title: recipe.title,
      summary: recipe.summary,
      knowledge: recipe.knowledge,
      design: recipe.design,
      goal: lesson?.goal ?? "",
    };
  });
}

export function createRecipeProject(id: string): Project | null {
  const recipe = RECIPES.find((item) => item.id === id);
  if (!recipe) return null;
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    name: recipe.title,
    createdAt: now,
    updatedAt: now,
    design: recipe.design,
    files: recipe.files(),
  };
}

/** The recipe note stored in the project, or null when this is not one. */
export function recipeIdOf(files: { path: string; text?: string }[]): string | null {
  const file = files.find((item) => item.path === "recipe.json");
  if (!file?.text) return null;
  try {
    const value = JSON.parse(file.text) as { format?: unknown; id?: unknown };
    if (value.format !== RECIPE_FORMAT || typeof value.id !== "string") return null;
    return RECIPES.some((recipe) => recipe.id === value.id) ? value.id : null;
  } catch {
    return null;
  }
}
