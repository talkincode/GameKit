import playerUrl from "./samples/player.png";
import jumpUrl from "./samples/jump.ogg";
import type { Project } from "./project";

const MAIN = `import asyncio
import pygame

from game.player import Player

pygame.init()
pygame.display.set_caption("Signal Drift")

WIDTH, HEIGHT = 640, 360
screen = pygame.display.set_mode((WIDTH, HEIGHT))
clock = pygame.time.Clock()
font = pygame.font.Font(None, 22)
sprite = pygame.image.load("assets/player.png").convert_alpha()
player = Player(72, 200)
markers: list[tuple[int, int]] = []
sound = None
mixer_ready = False


def play_jump():
    global sound, mixer_ready
    if not mixer_ready:
        try:
            pygame.mixer.init()
            sound = pygame.mixer.Sound("assets/jump.ogg")
        except pygame.error:
            sound = None
        mixer_ready = True
    if sound:
        sound.play()


def handle_input():
    keys = pygame.key.get_pressed()
    player.vx = (-4 if keys[pygame.K_LEFT] or keys[pygame.K_a] else 0) + (
        4 if keys[pygame.K_RIGHT] or keys[pygame.K_d] else 0
    )
    if (keys[pygame.K_SPACE] or keys[pygame.K_UP] or keys[pygame.K_w]) and player.on_ground:
        player.vy = -8.5
        player.on_ground = False
        play_jump()


async def main():
    running = True
    while running:
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False
            elif event.type == pygame.MOUSEBUTTONDOWN and event.button == 1:
                markers.append(event.pos)

        handle_input()
        player.update()

        screen.fill((16, 20, 24))
        pygame.draw.rect(screen, (46, 92, 74), (0, 280, WIDTH, 80))
        screen.blit(sprite, player.rect)
        for point in markers[-16:]:
            pygame.draw.circle(screen, (214, 154, 74), point, 4)
        label = font.render("Arrows or WASD, space to jump, click to mark", True, (228, 224, 214))
        screen.blit(label, (16, 16))
        pygame.display.flip()
        clock.tick(60)
        await asyncio.sleep(0)


asyncio.run(main())
`;

const PLAYER = `import pygame


class Player:
    def __init__(self, x: int, y: int) -> None:
        self.rect = pygame.Rect(x, y, 32, 32)
        self.vx = 0
        self.vy = 0.0
        self.on_ground = False

    def update(self) -> None:
        self.vy += 0.35
        self.rect.x += int(self.vx)
        self.rect.y += int(self.vy)
        if self.rect.bottom >= 280:
            self.rect.bottom = 280
            self.vy = 0
            self.on_ground = True
        self.rect.left = max(0, self.rect.left)
        self.rect.right = min(640, self.rect.right)
`;

const BLANK = `import asyncio
import pygame

pygame.init()
screen = pygame.display.set_mode((640, 360))
clock = pygame.time.Clock()

async def main():
    running = True
    while running:
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False
        screen.fill((16, 20, 24))
        pygame.display.flip()
        clock.tick(60)
        await asyncio.sleep(0)

asyncio.run(main())
`;

async function readBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Could not load a sample asset.");
  return new Uint8Array(await response.arrayBuffer());
}

export async function createStarterProject(name = "my-cool-game"): Promise<Project> {
  const now = Date.now();
  const [player, jump] = await Promise.all([readBytes(playerUrl), readBytes(jumpUrl)]);
  return {
    id: crypto.randomUUID(),
    name,
    createdAt: now,
    updatedAt: now,
    design: {
      title: "信号漂流",
      hero: "一个小方块",
      goal: "在平台上左右奔跑、跳来跳去，点一下画面就留下一个记号",
      controls: ["←→ 或 A D 移动", "空格或 ↑ 跳跃", "点击画面留下记号"],
      look: "深色的夜晚，绿色地面，橙色记号",
    },
    files: [
      { path: "main.py", text: MAIN },
      { path: "game/__init__.py", text: "" },
      { path: "game/player.py", text: PLAYER },
      { path: "assets/player.png", bytes: player },
      { path: "assets/jump.ogg", bytes: jump },
    ],
  };
}

export function createBlankProject(name: string): Project {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    name,
    createdAt: now,
    updatedAt: now,
    files: [{ path: "main.py", text: BLANK }],
  };
}
