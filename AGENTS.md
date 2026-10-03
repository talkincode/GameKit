# AGENTS.md — GameKit

GameKit 是给孩子用的 AI 辅助 pygame 游戏工作室：像 MakeCode Arcade 一样在浏览器里做游戏，但写的是真正的 Python + pygame-ce。

## 最高优先级

所有代码工作必须遵守 [docs/agent-coding-guidelines.md](docs/agent-coding-guidelines.md)（Agent 编码规范）。
它与本文件冲突时，以它为准；与用户的明确指示冲突时，以用户为准。

开始前先读：

- [docs/roadmap.md](docs/roadmap.md)：目标画像、已确定的技术边界、非目标、验收矩阵
- [docs/ai-rules.md](docs/ai-rules.md)：内置 AI 和 WebMCP 的行为规则
- [docs/runtime.md](docs/runtime.md)：pygbag 运行时、预览与导出、模板改动

新需求进入前，先对照 roadmap 的「非目标（铁律）」。违反铁律的改动必须先让用户确认修改边界。

## 项目不变量（破坏任何一条都视为 bug）

1. **孩子的作品不丢、不被静默覆盖。**
   - 本地数据只经过 `src/lib/storage.ts`。修改 IndexedDB 结构必须提升版本号并在 `onupgradeneeded` 里写迁移。
   - 写入走一条队列：文件树、设计卡、采用、撤销这类变动立即落盘，只有编辑器敲字用短防抖合并；
     关闭页面时再冲一次（`src/studio/store.tsx`）。
   - 删除文件先进回收站（先确认），可以恢复；彻底删除和清空回收站都要再问一次。
   - 加载示例/配方/教程、导入文件都新建项目。
   - 云同步冲突保留两份；同步失败不影响本地数据。
2. **真 pygame。** 不发明 GameKit 游戏 API；构建不改写用户源码；辅助代码必须是项目里可见、桌面可运行的 `.py` 文件。
3. **预览与导出共用 `runtime/player.tmpl`。** 调试钩子只在 `gamekit_debug = 1` 的预览构建里生效。
   改模板必须同步更新 [docs/runtime.md](docs/runtime.md) 的「模板改动」。
4. **密钥永远不进浏览器和仓库。** `.env`、`.dev.vars` 不提交；前端代码不读取、不保存、不让用户填写 AI 密钥或接口地址。
5. **所有需要身份的 `/api/*` 路由经过同一个身份门，默认拒绝。**
   - 身份门（`worker/identity.ts`）：校验 Cloudflare Access JWT（签名、aud、iss、过期），再核对 `ALLOW_GITHUB_USERS`。
   - 新增接口默认需要身份；匿名可访问的接口必须显式列出并写明理由。
   - 配置缺失时返回拒绝，不放行。生产代码里不存在绕过身份门的开关。
6. **未登录路径完整可用。** 新建、编辑、运行、导入、导出不依赖登录，也不发起需要身份的请求。
7. **项目只有一个写入入口。** 界面、内置小助手、WebMCP 都通过工作室的同一套动作（现在是 `src/studio/store.tsx`）改项目。
   小助手可以自己在**候选版本**里迭代（生成、试运行、修复），但候选不是作品：只有人点「采用这一版」才写入，且可撤销；
   换项目、新建、导入时正在跑的一轮立即作废。
8. **AI 规则只有一个文字来源：[docs/ai-rules.md](docs/ai-rules.md)。** 改系统提示词、一轮怎么跑（`src/lib/agent.ts`）、
   模型输出校验或工具权限时，先改它。
9. **工具定义只写一次。** 内置小助手和 WebMCP 共用同一份工具清单和权限等级。
10. **界面文案面向孩子。** 简体中文优先、短句、不责备；技术细节折叠；新增文案集中管理，不散落在组件里。

## 配置

本地配置放在仓库根目录的 `.env`（已被 `.gitignore` 忽略），生产环境用 `wrangler secret put`。
只引用变量名，不要把值写进代码、文档、测试快照或提交信息。

| 变量 | 放在哪 | 含义 |
| --- | --- | --- |
| `ALLOW_GITHUB_USERS` | secret / `.env` | 授权名单：GitHub 账号邮箱，逗号分隔（与 Access JWT 的 `email` 比对） |
| `OPENAI_API_URL` | secret / `.env` | OpenAI 兼容文本模型接口地址（不含 `/chat/completions`） |
| `OPENAI_API_KEY` | secret / `.env` | 上述接口的密钥 |
| `OPENAI_MODEL` | `wrangler.jsonc` vars | 文本模型名 |
| `ACCESS_TEAM_DOMAIN`、`ACCESS_AUD` | `wrangler.jsonc` vars | Zero Trust 团队域名与 GameKit Access 应用的 AUD，由 `scripts/setup-access.sh` 写入；为空时 `/api/*` 全部拒绝 |
| `LOCAL_DEV_AUTH` | 只在本地 `.env` | `1` 表示用本地替身登录表单代替 Access；只在 localhost 生效，其他主机上出现会让身份路由拒绝 |
| `GAMEKIT_NO_REMOTE` | 命令行环境 | `1` 表示本地运行不连 Cloudflare 远程绑定（E2E、没有 Cloudflare 登录时），生图会报未配置 |

上线步骤：`scripts/setup-access.sh`（创建 Access 应用并写入 `ACCESS_AUD`）→ `scripts/put-secrets.sh`（把 `.env` 里的 secret 写入 Worker）→ 推送 `main`。

## 常用命令

```bash
pnpm install
pnpm dev          # Vite + 本地 Workers 运行时，页面和 /api 都在本地
pnpm test         # vitest 单元测试（含 Worker 身份门）
pnpm typecheck    # 页面与 Worker 两套 tsconfig
pnpm build
pnpm test:e2e     # 构建后用 Playwright 跑 tests/e2e（替身登录 + 替身模型，不需要 Cloudflare 账号）
pnpm preview
```

完成一项改动前，至少跑一遍 `pnpm test`、`pnpm typecheck` 和 `pnpm test:e2e`。
涉及页面、运行时、身份或部署的改动，还要在浏览器里实际跑一遍受影响的路径。

## 验收矩阵（硬性规定）

完整矩阵只维护在 [docs/roadmap.md](docs/roadmap.md#验收矩阵业务能力覆盖矩阵)。以下为 MUST 级规定：

1. 每个一级功能 **MUST** 至少有一条 Happy Path E2E。
2. 每个高风险功能 **MUST** 至少覆盖一条失败路径。
3. 每个涉及权限的功能 **MUST** 至少验证两种角色（匿名 / 授权用户 / 已登录未授权）。
4. 每个会修改系统状态的操作 **MUST** 至少验证一次失败后的恢复或回滚。
5. 新增一级业务功能时，**MUST** 同步新增对应的 E2E，并更新 `docs/roadmap.md` 的验收矩阵，否则改动不完整。
   删除功能时同步移除矩阵行。

E2E 在 `tests/e2e/`（Playwright，配置 `playwright.config.ts`），CI 中失败会阻止部署。

## 目录速览

| 路径 | 内容 |
| --- | --- |
| `src/App.tsx`、`src/ui/` | 页面布局：两个视图（做游戏 / 看代码）、舞台、对话面板、头部菜单、弹层 |
| `src/studio/store.tsx` | 工作室状态与所有动作（项目读写、运行、登录状态、小助手一轮、导出） |
| `src/lib/agent.ts` | Agent 循环（可注入依赖的纯逻辑：设计 → 制作候选 → 检查修复） |
| `src/ui/DesignerPane.tsx`、`src/ui/Stage.tsx` | 对话面板与游戏舞台（作品和候选都在这里跑） |
| `src/lib/account.ts` | 页面侧登录状态与 `/api` 调用（处理 Access 重定向） |
| `src/ui/text.ts` | 面向孩子的文案 |
| `src/lib/project.ts`、`src/lib/storage.ts` | 项目模型与 IndexedDB |
| `src/lib/design.ts` | 设计卡（随项目保存，随候选一起采用） |
| `src/lib/build.ts`、`src/lib/session.ts`、`public/sw.js` | 打包 pygbag 构建、预览会话 |
| `src/lib/diagnostics.ts`、`src/lib/messages.ts` | 静态诊断、预览桥消息 |
| `src/lib/ai.ts` | 提示词与模型输出校验 |
| `src/lib/export.ts` | 各种导出包与源码导入 |
| `src/lib/starter.ts`、`src/lib/samples/` | 起始示例 |
| `runtime/` | pygbag player 模板（MIT，改动记录在 `docs/runtime.md`） |
| `worker/index.ts` | Cloudflare Worker 路由：`/api/login`、`/api/logout`、`/api/me`、`/api/ai` |
| `worker/identity.ts` | 唯一的身份门（Access JWT + 授权名单，本地替身登录） |
| `worker/ai.ts` | AI 网关（OpenAI 兼容文本、Workers AI 生图） |
| `scripts/` | `setup-access.sh`（创建 Access 应用）、`put-secrets.sh`（写入 Worker secret） |
| `tests/e2e/` | Playwright E2E、替身身份与替身模型 |
| `docs/` | 路线图、AI 规则、运行时记录、编码规范 |
