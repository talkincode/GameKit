# GameKit

在浏览器里开发并运行真正的 Pygame 项目。

`Create → Code → Play → Debug → Build → Export`

正式站点：https://gamekit.talkincode.net

## 本地开发

```bash
pnpm install
pnpm dev
```

`pnpm dev` 使用 Cloudflare Vite 插件，页面和 `/api/ai` 都跑在本地 Workers 运行时里。

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm preview
```

项目保存在浏览器的 IndexedDB 里。导出的网页包不依赖 GameKit 站点。

## 部署

推送到 `main` 后，GitHub Actions 会测试、构建并执行 `wrangler deploy`。

使用仓库已有的 Cloudflare 凭据，不把密钥写入源码：

- Secret：`CLOUDFLARE_API_TOKEN`
- Variable：`CLOUDFLARE_ACCOUNT_ID`

自定义域名写在 `wrangler.jsonc`：`gamekit.talkincode.net`。

AI 接口是 Worker 上的 Workers AI 绑定，模型名在 `worker/index.ts`。本地没有登录 Cloudflare 时，编辑器里的 AI 按钮会显示错误，其余功能仍然可用。

## 边界

- 编辑器不包含 pygame。预览和导出都使用 pygame-web 的 pygbag 0.9.3（pygame-ce / Python 3.12 WASM）。
- 构建只生成文件。没有 itch.io、GitHub Pages 或 Cloudflare Pages 的账号对接，也不托管成品游戏。
- AI 每次只处理一个明确操作，结果需要接受后才会写入项目。

运行时选择和限制见 [docs/runtime.md](docs/runtime.md)。
