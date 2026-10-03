# 运行时记录

GameKit 没有自己实现 Pygame。预览和导出使用同一套 [pygbag 0.9.3](https://github.com/pygame-web/pygbag) 模板，运行时来自 `https://pygame-web.github.io/cdn/0.9.3/`。这是 pygame-ce 和 CPython 3.12 的官方 WebAssembly 构建。

## 选择

| 问题 | 原因 | 方案 | 代价 |
| --- | --- | --- | --- |
| 浏览器里要跑 `import pygame` | 自己重写 pygame 会变成另一套 API | 使用 pygame-web / pygbag | 游戏循环必须对浏览器让出一次，见下文 |
| 预览要加载任意项目文件 | 相对地址的 `.apk` 不能放在 blob iframe 里 | 页面 Service Worker 把本次构建放进 Cache，iframe 打开 `/play/<id>/` | 浏览器必须支持 Service Worker。第一次安装后如果没有接管页面，需要刷新再按 Run |
| 导出后不依赖 GameKit | 成品必须能单独打开 | ZIP 里只有 `index.html`、`favicon.png` 和 `gamekit.apk` | 运行时脚本仍从 pygame-web CDN 加载。GameKit 下线不影响；pygame-web CDN 下线会影响。把整份 CPython/pygame WASM 打进每个 ZIP 大约几十 MB，而且要自己跟上游版本，所以没有内置 |
| 桌面项目直接拷进来 | pygbag 不能在一个同步死循环里刷新页面 | 模板诊断 `await asyncio.sleep(0)`、`time.sleep` 和 `pygame.time.wait` | 这不是私有 API。同一份 async 循环也能在安装了 pygame 的桌面 Python 上运行。GameKit 不会在构建时偷偷改写用户源码 |
| 音频 | 浏览器需要用户手势，且 pygame-web 支持的是 OGG Vorbis | 示例把 `mixer.init()` 放在第一次跳跃；WAV/MP3 只给出警告 | 打开预览后要点一下画面，声音才会响。桌面 WAV 文件不会被自动转码 |
| 停止游戏 | WASM 进程活在 iframe 里 | Stop 把 iframe 设为 `about:blank`，重新 Run 使用新的会话 | 没有进程级调试器，也不能在任意行暂停 |
| 离开页面 | pygbag 运行时在 `can_close` 为假时会注册 `window.onbeforeunload`（`pythons.js`: `if (!vm.config.can_close)`），浏览器就会弹「Leave site? Changes you made may not be saved.」 | 构建时渲染 `can_close = 1`（`src/lib/build.ts`），预览与导出都不再出现这个弹窗 | 游戏自己不再拦住关闭页面。游戏里没有未保存的数据，工作室的保存由 store 负责，所以这是想要的 |
| AI | 不能让模型自己改项目、构建或发布 | Worker 只提供补全和生图两个接口，只对授权用户开放（见 [ai-rules.md](ai-rules.md)）。产品逻辑在编辑器里，生成结果要先看 diff 再接受 | 系统提示词仍在浏览器里拼装，授权用户可以改写它；还没有按人配额 |
| 按键 | 编辑器焦点在 Monaco 上 | 要点预览画布，画布才会吃键盘 | Run 按钮的点击发生在父页面，不会替 iframe 完成自动播放授权 |

## 帧循环

`main.py` 是入口。浏览器构建要求主循环里有一次：

```python
pygame.display.flip()
clock.tick(60)
await asyncio.sleep(0)
```

文件可以是多个，例如 `from game.player import Player`。资源用普通路径，例如 `assets/player.png`，相对项目根目录。

## 模板改动

`runtime/player.tmpl` 来自 pygbag 0.9.3 的 `default.tmpl`（MIT，见 `runtime/LICENSE-pygbag.txt`），只改了三件事：

1. 所有主机都解压 zip `.apk`，不再按 itch.io 域名改用 tar.gz。这样 Web ZIP、静态目录和 itch.io 包是同一套文件。
2. 只有预览构建（`gamekit_debug = 1`）才把 stdout、帧时间和输入发回编辑器。浏览器里的 `pygame.time.Clock` 不能被继承，所以预览用一个包装对象替换 `Clock`，内部仍调用原来的 `tick`。导出的游戏不替换 `Clock`，也不向父页面发这些消息。
3. 画面铺满 iframe，调试控制台不盖住游戏。

## 还没做

完整调试器、碰撞盒、精灵边界、鼠标坐标叠加和音频通道状态都不在这一版里。诊断面板只显示运行状态、FPS、帧时间和输入事件。
