# GameKit

给孩子用的 AI 驱动 pygame 游戏设计器：说出想做的游戏，小助手做成能试玩的版本，孩子试完决定收下哪一版。
写出来的是真正的 Python + pygame-ce 代码，导出后在桌面 Python 里也能运行。

`说想法 → 小助手做出候选版本 → 试玩 → 采用 → （随时）看代码 / 再改一句 → 导出`

主界面分两个视图：**做游戏**（默认，舞台 + 小助手对话）和 **看代码**（文件树 + Monaco + 控制台）。
小助手的自动迭代只发生在候选版本里；采用才写进作品，而且可以撤销。

正式站点：https://gamekit.talkincode.net

- 目标画像、非目标、验收矩阵：[docs/roadmap.md](docs/roadmap.md)
- AI 使用规则：[docs/ai-rules.md](docs/ai-rules.md)
- 运行时记录：[docs/runtime.md](docs/runtime.md)
- Agent 规约：[AGENTS.md](AGENTS.md)

目标形态：不登录也能完整地做游戏（作品存在本机）；授权用户通过 Cloudflare Access（GitHub 登录）登录后，
可以使用 AI 生成和云端同步；页面通过 WebMCP 向浏览器里的 AI Agent 提供工具。
这些能力的当前进度见 roadmap 的「当前能力清单」。

## 本地开发

```bash
pnpm install
pnpm dev
```

`pnpm dev` 使用 Cloudflare Vite 插件，页面和 `/api/*` 都跑在本地 Workers 运行时里。它会读仓库根目录的 `.env`。
文本模型与生图都走服务端密钥，没有需要 Cloudflare 登录的远程绑定。

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm test:e2e     # Playwright，替身登录 + 替身模型，不需要 Cloudflare 账号
pnpm preview
```

项目保存在浏览器的 IndexedDB 里。导出的网页包不依赖 GameKit 站点。

本地配置放在仓库根目录的 `.env`（已被 Git 忽略）。只写变量名，不要把值提交进仓库：

- `ALLOW_GITHUB_USERS`：授权名单，GitHub 账号邮箱，逗号分隔
- `OPENAI_API_URL`、`OPENAI_API_KEY`：服务端使用的 OpenAI 兼容文本模型（模型名 `OPENAI_MODEL` 在 `wrangler.jsonc`）
- `GEMINI_APIKEY`、`GEMINI_IMAGE_MODEL`：生图用的 Gemini 密钥与模型名（游戏图片；只在 Worker 里使用）
- `LOCAL_DEV_AUTH=1`：本地没有 Cloudflare Access，加上它后「登录」会打开一个本地替身表单，
  填授权名单里的邮箱即可。只在 localhost 生效，不要写进生产配置。

完整变量表见 [AGENTS.md](AGENTS.md#配置)。

## 质量与验收

每个一级功能都必须有 Happy Path E2E，高风险功能要覆盖失败路径，涉及权限的功能要验证至少两种角色，
会修改状态的操作要验证失败后的恢复。新增一级功能时同步新增 E2E 并更新
[验收矩阵](docs/roadmap.md#验收矩阵业务能力覆盖矩阵)。

## 部署

推送到 `main` 后，GitHub Actions 会跑单元测试、类型检查、构建和 E2E，全部通过后执行 `wrangler deploy`。

使用仓库已有的 Cloudflare 凭据，不把密钥写入源码：

- Secret：`CLOUDFLARE_API_TOKEN`
- Variable：`CLOUDFLARE_ACCOUNT_ID`

自定义域名写在 `wrangler.jsonc`：`gamekit.talkincode.net`。

### 登录与 AI 上线（只需做一次）

登录用 Cloudflare Access（Zero Trust），只开 GitHub 身份源，只保护 `gamekit.talkincode.net/api`。
在 `ACCESS_AUD` 还是空的时候，线上所有 `/api/*` 都拒绝，页面其余功能照常可用。

1. 准备一个有 Access 权限的凭据。任选其一：
   - 在 https://dash.cloudflare.com/profile/api-tokens 建 API token，权限：
     Account → Access: Apps and Policies → Edit；Account → Access: Organizations, Identity Providers, and Groups → Read。
   - 已用 `cf auth login` 登录过 `cf` CLI 时，它的 OAuth 令牌就有这些权限（令牌约一小时过期，先跑一次 `cf auth whoami`）：
     `export CLOUDFLARE_API_TOKEN="$(python3 -c 'import json,os;print(json.load(open(os.path.expanduser("~/Library/Preferences/cloudflare/config/default.json")))["oauth_token"])')"`
2. `CLOUDFLARE_API_TOKEN=... ./scripts/setup-access.sh`
   - 创建或更新 Access 应用 `GameKit`，放行 `.env` 里 `ALLOW_GITHUB_USERS` 的邮箱；
   - 把 `ACCESS_TEAM_DOMAIN`、`ACCESS_AUD` 写进 `wrangler.jsonc`。
   - 如果 Zero Trust 里还没有 GitHub 身份源，脚本会停下来并列出要在 GitHub 和 Cloudflare 里填的两处地址。
3. `./scripts/put-secrets.sh`：把 `ALLOW_GITHUB_USERS`、`OPENAI_API_URL`、`OPENAI_API_KEY` 写入 Worker secret。
4. 提交 `wrangler.jsonc` 并推送 `main`。

增减授权用户：改 `.env` 的 `ALLOW_GITHUB_USERS`，再跑一遍第 2、3 步。两个脚本都支持 `ENV_FILE=/path/to/.env`。

当前状态：Access 应用 `GameKit` 已创建（身份源只有 GitHub，会话 7 天），AUD 已写入 `wrangler.jsonc`，三个 secret 已写入 Worker。

## 边界

- 编辑器不包含 pygame。预览和导出都使用 pygame-web 的 pygbag 0.9.3（pygame-ce / Python 3.12 WASM）。
- 构建只生成文件。没有 itch.io、GitHub Pages 或 Cloudflare Pages 的账号对接，也不托管成品游戏。
- 游戏图片由服务端调用 Gemini 生成（密钥只在 Worker），提示词与儿童安全约束也由服务端拼装；
  生成结果在浏览器里去背景、裁边、缩放到像素尺寸后存成 PNG。
- 小助手一轮最多修两次；只有代码证据（静态问题、traceback）才触发修复，改不动就停下来交给孩子。
  候选改动只在内存里，采用才写入项目，而且可撤销。
- 不做积木编辑器、不做公开作品广场，完整非目标见 [docs/roadmap.md](docs/roadmap.md#非目标铁律)。

运行时选择和限制见 [docs/runtime.md](docs/runtime.md)。
