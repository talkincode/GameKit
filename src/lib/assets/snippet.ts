/** The fields a load example needs. The project file is a normal pygame path. */
export type SnippetAsset = {
  title: string;
  licenseName: string;
  licenseSpdx: string;
  author: string;
  source: string;
  attribution: string;
  frameWidth: number;
  frameHeight: number;
  media?: "image" | "audio";
  loop?: boolean;
};

/** Standard pygame the child can copy. No GameKit API, no network path. */
export function pygameSnippet(copy: SnippetAsset, path: string): string {
  if (copy.media === "audio") {
    return [
      "import pygame",
      "",
      `# ${copy.title}`,
      `# 许可：${copy.licenseName}（${copy.licenseSpdx}） · 作者：${copy.author}`,
      `# 来源：${copy.source}`,
      `# 署名：${copy.attribution}`,
      "pygame.mixer.init()",
      `sound = pygame.mixer.Sound("${path}")`,
      copy.loop ? "sound.play(-1)" : "sound.play()",
      "",
    ].join("\n");
  }
  const lines = [
    "import pygame",
    "",
    `# ${copy.title}`,
    `# 许可：${copy.licenseName}（${copy.licenseSpdx}） · 作者：${copy.author}`,
    `# 来源：${copy.source}`,
    `# 署名：${copy.attribution}`,
    `image = pygame.image.load("${path}").convert_alpha()`,
  ];
  if (copy.frameWidth > 0 && copy.frameHeight > 0) {
    lines.push(`frame = image.subsurface((0, 0, ${copy.frameWidth}, ${copy.frameHeight}))`);
    lines.push("screen.blit(frame, (0, 0))");
  } else {
    lines.push("screen.blit(image, (0, 0))");
  }
  lines.push("");
  return lines.join("\n");
}

/** A whole main.py that loads the copied file and prints a size the preview can show. */
export function pygameDemoMain(copy: SnippetAsset, path: string): string {
  if (copy.media === "audio") {
    const play = copy.loop ? "sound.play(-1)" : "sound.play()";
    return `import asyncio
import pygame

# ${copy.title} · ${copy.licenseSpdx} · ${copy.author}
pygame.init()
screen = pygame.display.set_mode((320, 240))
clock = pygame.time.Clock()
print("SOUND-WAIT")


async def main():
    sound = None
    while True:
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                return
            if event.type == pygame.MOUSEBUTTONDOWN and sound is None:
                pygame.mixer.init()
                sound = pygame.mixer.Sound("${path}")
                print("SOUND-OK", int(round(sound.get_length() * 1000)))
                ${play}
        screen.fill((46, 92, 74))
        pygame.display.flip()
        clock.tick(60)
        await asyncio.sleep(0)


asyncio.run(main())
`;
  }
  const frame =
    copy.frameWidth > 0 && copy.frameHeight > 0
      ? `frame = image.subsurface((0, 0, ${copy.frameWidth}, ${copy.frameHeight}))`
      : "frame = image";
  return `import asyncio
import pygame

# ${copy.title} · ${copy.licenseSpdx} · ${copy.author}
pygame.init()
screen = pygame.display.set_mode((320, 240))
clock = pygame.time.Clock()
image = pygame.image.load("${path}").convert_alpha()
${frame}
print("LIBRARY-OK", frame.get_size())


async def main():
    while True:
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                return
        screen.fill((88, 156, 96))
        screen.blit(frame, (144, 100))
        pygame.display.flip()
        clock.tick(60)
        await asyncio.sleep(0)


asyncio.run(main())
`;
}

/** A readable example module. The stage still runs main.py, so this file does not start the game. */
export function pygameExampleModule(copy: SnippetAsset, path: string): string {
  return `${pygameSnippet(copy, path)}
# 舞台运行的是 main.py。想在舞台里看到这张图，把上面的加载写进 main.py。
`;
}
