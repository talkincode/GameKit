# 运行时记录

GameKit 没有自己实现 Pygame。预览和导出使用同一套 [pygbag 0.9.3](https://github.com/pygame-web/pygbag) 模板，运行时来自 `https://pygame-web.github.io/cdn/0.9.3/`。这是 pygame-ce 和 CPython 3.12 的官方 WebAssembly 构建。

## 选择

| 问题 | 原因 | 方案 | 代价 |
| --- | --- | --- | --- |
| 浏览器里要跑 `import pygame` | 自己重写 pygame 会变成另一套 API | 使用 pygame-web / pygbag | 游戏循环必须对浏览器让出一次，见下文 |
| 预览要加载任意项目文件 | 相对地址的 `.apk` 不能放在 blob iframe 里 | 页面 Service Worker 缓存本次构建；隔离的 `srcdoc` iframe 通过 `postMessage` 接收当前构建的 `.apk` | 浏览器必须支持 Service Worker。第一次安装后如果没有接管页面，需要刷新再按 Run |
| 导出后不依赖 GameKit | 成品必须能单独打开 | ZIP 里只有 `index.html`、`favicon.png` 和 `gamekit.apk` | 运行时脚本仍从 pygame-web CDN 加载。GameKit 下线不影响；pygame-web CDN 下线会影响。把整份 CPython/pygame WASM 打进每个 ZIP 大约几十 MB，而且要自己跟上游版本，所以没有内置 |
| 桌面项目直接拷进来 | pygbag 不能在一个同步死循环里刷新页面 | 模板诊断 `await asyncio.sleep(0)`、`time.sleep` 和 `pygame.time.wait` | 这不是私有 API。同一份 async 循环也能在安装了 pygame 的桌面 Python 上运行。GameKit 不会在构建时偷偷改写用户源码 |
| 音频格式 | 项目里生成的声音是 WAV（浏览器里合成，无需服务端） | 实测 pygame-web 运行时能 `pygame.mixer.Sound("assets/probe.wav")` 并读到正确时长（0.3 秒），所以 WAV 可用；OGG 仍是体积上更好的选择 | MP3/AIFF 仍给警告。声音要等孩子点一下画面才会响 |
| 音频 | 浏览器需要用户手势。pygame-web 能播 8/16-bit PCM WAV 和 OGG Vorbis | 声音编辑器存 WAV；OGG 要过文件头检查才当能播。MP3、AIFF、坏 WAV、Opus 在问题里说明 | 打开预览后要点一下画面，声音才会响。桌面文件不会被自动转码 |
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

## 配方

配方是项目里的普通文件：`main.py`、一张 PNG、`README.txt`、`recipe.json`。`recipe.json` 只给工作室认出这是哪一份配方，游戏不要读它。预览和导出把这些文件和其他项目文件一起打包。舞台上的 `print("RECIPE-OK", ...)` 是给检查看的普通输出。模板没有为配方改过。

## 素材库

内置素材放在站点的 `public/asset-packs/`，打开素材库、新建地图或声音编辑器才请求说明文件和缩略图，不打进页面脚本。除了 GameKit 画的森林，还有 Kenney 的 CC0 精选（见 [docs/asset-credits.md](asset-credits.md)）。复制进项目的是文件字节，路径像 `assets/library/forest-adventure/characters/hero.png`，用普通 `pygame.image.load`。地图如果从素材库的图块开始，瓦片图也会存进项目里的 `maps/*.tileset.png`。`assets/library.json` 只记下复制时的包版本、hash 和许可来源，游戏不要读它。

预览和导出都打包项目里的这份副本（和别的 `assets/` 文件一样）。成品不请求素材库目录，也不请求 GameKit 站点。素材库以后升级，不会改掉已经复制进项目、或已经导出的那一份。模板本身没有为素材库改过。

素材库里听声音时，能播 OGG 的浏览器播 Kenney 原来的文件。Safari 播不了 OGG，所以每个 OGG 旁边有一份 `*.preview.wav`，只给素材库播放器当预览。复制进项目的仍是清单里的那份 OGG 或 WAV。预览 wav 不进项目，也不进导出包。模板没有为这个预览改过。

## 离线导出

阶段 G 核对的是导出的游戏，不是把整个工作室变成断网应用。

源码 zip 里就是项目文件：配方、从素材库复制的图和声音、动画的 PNG 和 `.anim.json`、地图的 JSON/CSV/PNG、声音编辑器存下的 WAV。这些文件的内容和复制时的 hash 一致。包里没有 GameKit 的地址，也没有 `/asset-packs/`。装了 pygame-ce 的桌面 Python 不联网就能跑。

网页 zip、静态目录、itch.io 包和嵌入包里的游戏文件都在 `gamekit.apk` 里，和源码包是同一份。`index.html` 唯一的在线地址是上面的 pygame-web CDN。断网时网页版打不开，因为没有把几十 MB 的 CPython/pygame WASM 打进每个包。导出菜单和「我的项目」里的源码说明写的是同一件事。嵌入包的 `README.txt` 也写了：没有这份运行时，网页包不会启动。

素材库以后升级，已经导出的 zip 和项目里钉住的那一份都不变。要换新版本，得在素材库里再选一次替换。模板没有为这一阶段改过。

## 声音

声音编辑器把参数合成成 16-bit 单声道 22.05 kHz WAV。试听播放的字节和保存进 `assets/` 的字节是同一份，所以导出的游戏不调用生成接口。pygame-web 能播这种 PCM WAV，也能播通过文件头检查的 OGG Vorbis。MP3、AIFF、坏掉的 WAV、以及 Ogg 里的 Opus 会在问题面板里说明，不会假装能播。官方音效在素材库里，包括 Kenney 原来的 OGG Vorbis。复制进项目之后和别的 `assets/` 文件一样打包。播放用普通 `pygame.mixer.Sound`。模板没有为声音改过。声音要等孩子点一下画面才会响。

## 精灵动画

精灵动画是项目里的两份普通文件：一张 PNG 精灵表，和旁边的 `.anim.json`。说明里的 `animation` 字段和素材库清单相同（帧宽高、帧序号、毫秒、动作）。预览和导出把它们和其他 `assets/` 文件一起打包。播放用普通 pygame（`image.load`、`subsurface`、`json`），可以是孩子复制的片段，或项目里可见的 `sprite_anim.py`。模板没有为动画改过。

## 瓦片地图

瓦片地图是项目里的普通文件：`maps/<名字>.map.json`、每一层一个 CSV、一份碰撞 CSV、一张瓦片 PNG。说明里的路径必须就是这些文件，不能指到项目里的其他路径。预览和导出把它们和其他项目文件一起打包。加载用普通 pygame（`json`、`csv`、`image.load`），可以是孩子照着编辑器里的片段写的，或项目里可见的 `map_loader.py`。模板没有为地图改过。

## 模板改动

`runtime/player.tmpl` 来自 pygbag 0.9.3 的 `default.tmpl`（MIT，见 `runtime/LICENSE-pygbag.txt`），只改了四件事：

1. 所有主机都解压 zip `.apk`，不再按 itch.io 域名改用 tar.gz。这样 Web ZIP、静态目录和 itch.io 包是同一套文件。
2. 只有预览构建（`gamekit_debug = 1`）才把 stdout、帧时间和输入发回编辑器。浏览器里的 `pygame.time.Clock` 不能被继承，所以预览用一个包装对象替换 `Clock`，内部仍调用原来的 `tick`。导出的游戏不替换 `Clock`，也不向父页面发这些消息。
3. 画面铺满 iframe，调试控制台不盖住游戏。
4. 预览放在 opaque origin 的 `srcdoc` iframe 中。父页面只向当前 iframe 发送本次构建的 `.apk` 字节，运行时在 iframe 内创建 Blob URL；游戏因此不依赖 iframe 读取 Service Worker 缓存，也不能访问工作室页面。

## 还没做

完整调试器、碰撞盒、精灵边界、鼠标坐标叠加和音频通道状态都不在这一版里。诊断面板只显示运行状态、FPS、帧时间和输入事件。
