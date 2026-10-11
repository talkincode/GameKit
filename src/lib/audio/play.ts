/**
 * Pygame the child can copy. The file is a normal WAV or OGG in the project.
 * No GameKit import, and nothing is fetched when the game runs.
 */

function quote(path: string): string {
  return `"${path}"`;
}

/** A few lines for mixer.Sound. `loops` is -1 when the child asked for a loop. */
export function pygameSoundSnippet(path: string, loop: boolean): string {
  return [
    "import pygame",
    "",
    "pygame.mixer.init()",
    `sound = pygame.mixer.Sound(${quote(path)})`,
    loop ? "sound.play(-1)" : "sound.play()",
    "",
  ].join("\n");
}

/**
 * A whole main.py. Sound is loaded after a click, because the browser stays
 * quiet until someone taps the game. The print is the length pygame read.
 */
export function pygameSoundDemo(path: string, loop: boolean): string {
  const play = loop ? "sound.play(-1)" : "sound.play()";
  return `import asyncio
import pygame

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
                sound = pygame.mixer.Sound(${quote(path)})
                print("SOUND-OK", int(round(sound.get_length() * 1000)))
                ${play}
        screen.fill((46, 92, 74))
        pygame.display.flip()
        clock.tick(60)
        await asyncio.sleep(0)


asyncio.run(main())
`;
}
