/**
 * Plain pygame for the built-in recipes.
 *
 * Each file is a whole game: a frame loop that awaits asyncio.sleep(0), and a
 * picture under assets/. On-screen words stay in ASCII because the default
 * pygame font has no Chinese glyphs. Chinese lives in the design card and README.
 */

export const PLATFORM_MAIN = `import asyncio
import pygame

pygame.init()
pygame.display.set_caption("platform")
WIDTH, HEIGHT = 640, 360
screen = pygame.display.set_mode((WIDTH, HEIGHT))
clock = pygame.time.Clock()
font = pygame.font.Font(None, 28)
hero = pygame.image.load("assets/hero.png").convert_alpha()

# Upward speed. A smaller (more negative) number jumps higher.
JUMP = -9
GRAVITY = 0.4
GROUND = 300
rect = pygame.Rect(80, 220, 16, 16)
vx = 0
vy = 0.0
on_ground = False

print("RECIPE-OK", "platform")
print("RECIPE-JUMP", JUMP)


async def main():
    global vx, vy, on_ground
    running = True
    while running:
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False
        keys = pygame.key.get_pressed()
        vx = (-4 if keys[pygame.K_LEFT] or keys[pygame.K_a] else 0) + (
            4 if keys[pygame.K_RIGHT] or keys[pygame.K_d] else 0
        )
        if (keys[pygame.K_SPACE] or keys[pygame.K_UP] or keys[pygame.K_w]) and on_ground:
            vy = JUMP
            on_ground = False
        vy += GRAVITY
        rect.x += int(vx)
        rect.y += int(vy)
        if rect.bottom >= GROUND:
            rect.bottom = GROUND
            vy = 0
            on_ground = True
        rect.left = max(0, rect.left)
        rect.right = min(WIDTH, rect.right)
        screen.fill((24, 32, 48))
        pygame.draw.rect(screen, (70, 140, 90), (0, GROUND, WIDTH, HEIGHT - GROUND))
        screen.blit(hero, rect)
        screen.blit(font.render("Arrows move, space jumps", True, (240, 236, 220)), (16, 16))
        pygame.display.flip()
        clock.tick(60)
        await asyncio.sleep(0)


asyncio.run(main())
`;

export const CATCH_MAIN = `import asyncio
import pygame

pygame.init()
pygame.display.set_caption("catch")
WIDTH, HEIGHT = 640, 360
screen = pygame.display.set_mode((WIDTH, HEIGHT))
clock = pygame.time.Clock()
font = pygame.font.Font(None, 28)
ball_image = pygame.image.load("assets/ball.png").convert_alpha()

# How fast the paddle slides. A bigger number is easier to catch with.
PADDLE = 6
paddle = pygame.Rect(280, 320, 72, 12)
ball = pygame.Rect(200, 40, 16, 16)
ball_v = [3, 4]
score = 0

print("RECIPE-OK", "catch")
print("RECIPE-PADDLE", PADDLE)


async def main():
    global score
    running = True
    while running:
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False
        keys = pygame.key.get_pressed()
        if keys[pygame.K_LEFT] or keys[pygame.K_a]:
            paddle.x -= PADDLE
        if keys[pygame.K_RIGHT] or keys[pygame.K_d]:
            paddle.x += PADDLE
        paddle.left = max(0, paddle.left)
        paddle.right = min(WIDTH, paddle.right)
        ball.x += ball_v[0]
        ball.y += ball_v[1]
        if ball.left <= 0 or ball.right >= WIDTH:
            ball_v[0] = -ball_v[0]
        if ball.top <= 0:
            ball_v[1] = -ball_v[1]
        if ball.colliderect(paddle) and ball_v[1] > 0:
            ball_v[1] = -abs(ball_v[1])
            score += 1
        if ball.top > HEIGHT:
            ball.x, ball.y = 200, 40
            ball_v[1] = abs(ball_v[1])
        screen.fill((20, 28, 46))
        pygame.draw.rect(screen, (220, 220, 230), paddle)
        screen.blit(ball_image, ball)
        screen.blit(font.render(f"score {score}", True, (240, 236, 220)), (16, 16))
        pygame.display.flip()
        clock.tick(60)
        await asyncio.sleep(0)


asyncio.run(main())
`;

export const MAZE_MAIN = `import asyncio
import pygame

pygame.init()
pygame.display.set_caption("maze")
CELL = 48
COLS, ROWS = 12, 7
screen = pygame.display.set_mode((COLS * CELL, ROWS * CELL))
clock = pygame.time.Clock()

# 1 is a wall. The gate at column 2, row 2 opens when OPEN_GATE is True.
GRID = [
    "111111111111",
    "100000000001",
    "101111110101",
    "101000010101",
    "101011010101",
    "100011000001",
    "111111111111",
]
OPEN_GATE = False
player = [1, 1]
goal = (10, 5)

print("RECIPE-OK", "maze")
print("RECIPE-GATE", OPEN_GATE)


def solid(col: int, row: int) -> bool:
    if col < 0 or row < 0 or col >= COLS or row >= ROWS:
        return True
    if OPEN_GATE and (col, row) == (2, 2):
        return False
    return GRID[row][col] == "1"


def try_move(dx: int, dy: int) -> None:
    nxt = (player[0] + dx, player[1] + dy)
    if not solid(nxt[0], nxt[1]):
        player[0], player[1] = nxt


async def main():
    running = True
    won = False
    while running:
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False
            elif event.type == pygame.KEYDOWN and not won:
                if event.key in (pygame.K_LEFT, pygame.K_a):
                    try_move(-1, 0)
                elif event.key in (pygame.K_RIGHT, pygame.K_d):
                    try_move(1, 0)
                elif event.key in (pygame.K_UP, pygame.K_w):
                    try_move(0, -1)
                elif event.key in (pygame.K_DOWN, pygame.K_s):
                    try_move(0, 1)
                if (player[0], player[1]) == goal:
                    won = True
                    print("RECIPE-MAZE-WIN")
        screen.fill((24, 26, 32))
        for row, line in enumerate(GRID):
            for col, cell in enumerate(line):
                wall = solid(col, row)
                color = (70, 64, 80) if wall else (36, 40, 48)
                if OPEN_GATE and (col, row) == (2, 2):
                    color = (90, 140, 96)
                pygame.draw.rect(screen, color, (col * CELL, row * CELL, CELL - 1, CELL - 1))
        pygame.draw.rect(screen, (240, 196, 72), (goal[0] * CELL + 12, goal[1] * CELL + 12, 24, 24))
        pygame.draw.rect(screen, (239, 125, 87), (player[0] * CELL + 8, player[1] * CELL + 8, 32, 32))
        pygame.display.flip()
        clock.tick(60)
        await asyncio.sleep(0)


asyncio.run(main())
`;

export const SHOOTER_MAIN = `import asyncio
import pygame

pygame.init()
pygame.display.set_caption("shooter")
WIDTH, HEIGHT = 640, 360
screen = pygame.display.set_mode((WIDTH, HEIGHT))
clock = pygame.time.Clock()
font = pygame.font.Font(None, 28)
ship = pygame.image.load("assets/ship.png").convert_alpha()

# Frames to wait between shots. A smaller positive number shoots sooner.
COOLDOWN = 18
player = pygame.Rect(300, 310, 16, 16)
shots: list[pygame.Rect] = []
enemy = pygame.Rect(80, 64, 28, 18)
enemy_v = 3
cool = 0
score = 0

print("RECIPE-OK", "shooter")
print("RECIPE-COOLDOWN", COOLDOWN)


async def main():
    global cool, score, enemy_v
    running = True
    while running:
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False
        keys = pygame.key.get_pressed()
        if keys[pygame.K_LEFT] or keys[pygame.K_a]:
            player.x -= 5
        if keys[pygame.K_RIGHT] or keys[pygame.K_d]:
            player.x += 5
        player.left = max(0, player.left)
        player.right = min(WIDTH, player.right)
        if cool > 0:
            cool -= 1
        if (keys[pygame.K_SPACE] or keys[pygame.K_UP]) and cool == 0:
            shots.append(pygame.Rect(player.centerx - 2, player.top - 10, 4, 10))
            cool = COOLDOWN
        for shot in shots:
            shot.y -= 7
        hit = [shot for shot in shots if shot.colliderect(enemy)]
        if hit:
            score += 1
            enemy.x = 40
        shots[:] = [shot for shot in shots if shot.bottom > 0 and shot not in hit]
        enemy.x += enemy_v
        if enemy.left <= 0 or enemy.right >= WIDTH:
            enemy_v = -enemy_v
            enemy.y += 8
            if enemy.bottom >= player.top:
                enemy.y = 48
                score = max(0, score - 1)
        screen.fill((12, 16, 32))
        screen.blit(ship, player)
        pygame.draw.rect(screen, (240, 196, 72), enemy)
        for shot in shots:
            pygame.draw.rect(screen, (240, 236, 220), shot)
        screen.blit(font.render(f"score {score}", True, (240, 236, 220)), (16, 16))
        pygame.display.flip()
        clock.tick(60)
        await asyncio.sleep(0)


asyncio.run(main())
`;

export const SNAKE_MAIN = `import asyncio
import pygame

pygame.init()
pygame.display.set_caption("snake")
CELL = 20
COLS, ROWS = 32, 18
screen = pygame.display.set_mode((COLS * CELL, ROWS * CELL))
clock = pygame.time.Clock()
font = pygame.font.Font(None, 28)
apple = pygame.image.load("assets/apple.png").convert_alpha()

# Frames between steps. A smaller positive number moves the snake sooner.
STEP = 8
body = [(8, 9), (7, 9), (6, 9)]
direction = (1, 0)
pending = direction
food = (20, 9)
tick = 0
alive = True

print("RECIPE-OK", "snake")
print("RECIPE-STEP", STEP)


def place_food() -> None:
    global food
    for row in range(ROWS):
        for col in range(COLS):
            if (col, row) not in body:
                food = (col, row)
                return


async def main():
    global direction, pending, tick, alive
    running = True
    while running:
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False
            elif event.type == pygame.KEYDOWN and alive:
                if event.key in (pygame.K_LEFT, pygame.K_a) and direction[0] == 0:
                    pending = (-1, 0)
                elif event.key in (pygame.K_RIGHT, pygame.K_d) and direction[0] == 0:
                    pending = (1, 0)
                elif event.key in (pygame.K_UP, pygame.K_w) and direction[1] == 0:
                    pending = (0, -1)
                elif event.key in (pygame.K_DOWN, pygame.K_s) and direction[1] == 0:
                    pending = (0, 1)
        tick += 1
        if alive and tick >= STEP:
            tick = 0
            direction = pending
            head = (body[0][0] + direction[0], body[0][1] + direction[1])
            if head[0] < 0 or head[1] < 0 or head[0] >= COLS or head[1] >= ROWS or head in body:
                alive = False
                print("RECIPE-SNAKE-STOP", len(body))
            else:
                body.insert(0, head)
                if head == food:
                    place_food()
                    print("RECIPE-SNAKE-EAT", len(body))
                else:
                    body.pop()
        screen.fill((24, 32, 28))
        screen.blit(apple, (food[0] * CELL, food[1] * CELL))
        for index, (col, row) in enumerate(body):
            color = (239, 125, 87) if index == 0 else (56, 160, 96)
            pygame.draw.rect(screen, color, (col * CELL + 1, row * CELL + 1, CELL - 2, CELL - 2))
        if not alive:
            screen.blit(font.render("game over", True, (240, 236, 220)), (16, 16))
        pygame.display.flip()
        clock.tick(60)
        await asyncio.sleep(0)


asyncio.run(main())
`;
