# GameKit 项目画像与方向

## 项目概述

GameKit 是给孩子用的 AI 驱动的 pygame 游戏设计器：孩子说出想做的游戏，小助手把它做成能玩的版本，
孩子在舞台上试玩、提意见，满意了才收下这一版。
可以把它理解成「写 Python 的 MakeCode Arcade」，但入口不是空编辑器，而是「我想做一个……」；
跑的是真正的 Python + pygame-ce，导出后在自己电脑上的 Python 里也能运行。

服务对象是已经会一点 Python、想做自己第一个游戏的孩子（约 10～15 岁），以及陪他们做的家长和老师。

运行方式：

- 游戏在孩子自己的浏览器里运行（pygbag：pygame-ce + CPython 3.12 WebAssembly，见 [runtime.md](runtime.md)）。
- 页面是本地优先的 PWA：不登录也能新建、编辑、运行、导出，作品存在本机。
- 授权用户用 Cloudflare 单点登录（GitHub 身份）登录后，额外获得 AI 生成和云端同步。
- 页面通过 WebMCP 把工作室的操作暴露给浏览器里的 AI Agent，让外部助手也能按同样的规则帮忙。

主界面分两个视图：**做游戏**（默认，舞台 + 小助手对话）和 **看代码**（文件树 + Monaco + 控制台）。
新手只需要第一个；想弄明白代码的孩子随时切到第二个，两边操作的是同一个项目。

- 架构图（目标状态）

```text
孩子的浏览器（PWA，可离线打开）
┌────────────────────────────────────────────────────────────┐
│ 做游戏：游戏舞台（中心）· 小助手对话 · 设计卡 · 采用按钮    │
│ 看代码：文件树 · Monaco 编辑器 · 控制台 · 舞台              │
│                           │                                │
│            Agent 循环（src/lib/agent.ts）                   │
│    听懂想法→设计→制作候选→自动试运行→修复→等孩子试玩       │
│                           │                                │
│    工作室工具层（唯一的项目读写与运行入口，store.tsx）       │
│      ┌────────────────────┼─────────────────────────┐       │
│  内置小助手         本地项目库              WebMCP 工具     │
│      │               （IndexedDB）    （document.modelContext）│
│      │                    │                         │       │
│      │    游戏舞台 iframe：pygbag（pygame-ce WASM）  ▼       │
│      │      候选版本和孩子的作品都在这里跑    浏览器里的外部  │
│      │                    │                 Agent（写入也要  │
│      │                    │                 走「采用」）     │
└──────┼────────────────────┼─────────────────────────────────┘
       │ 仅登录后           │ 仅登录后
       ▼                    ▼
Cloudflare Worker（gamekit.talkincode.net）
  ├─ 身份门：Cloudflare Access（GitHub 身份源）JWT 校验 + 授权名单，默认拒绝
  ├─ AI 网关：服务端持有密钥 → OpenAI 兼容文本模型；Gemini 生图；按人配额
  └─ 同步：项目元数据与文件 → Cloudflare 存储
静态资源（页面、Monaco、player 模板）  ·  pygbag 运行时来自 pygame-web CDN
```


## 项目画像（目标状态）

- **真 pygame。** 小助手和孩子写的都是标准 pygame-ce。没有隐藏的 GameKit 游戏 API，构建不偷偷改写源码；
  需要的辅助代码以普通 `.py` 文件放进项目，孩子看得见、改得动，桌面 Python 也能跑。
- **打开就能做游戏。** 首页就是舞台和一句话输入：说出想法 → 小助手做出第一版 → 在舞台上试玩。
  不登录、不安装、不配置。
- **孩子是作者，小助手是搭档。** 小助手负责设计、写代码、跑起来、修错；孩子负责创意和判断：
  试玩、说想改哪里、决定收下哪一版。
- **自动工作只发生在候选版本里。** 小助手可以自己迭代、自己修，但写进作品必须孩子点「采用这一版」，
  而且随时可以撤销。设计卡和代码一起被采用，不会出现「卡上写的是一个游戏、代码跑的是另一个」。
- **孩子看得懂、敢动手。** 中文优先，大按钮、少面板、短句子；进度只说行动
  （听懂想法、设计、做出来、自动试运行、修好了），不展示模型内部推理。
  报错先给孩子能懂的中文解释和下一步，再给 Python 原文。任何改动都能撤销，所以乱试不会闯祸。
- **代码随时可查。** 孩子说得出「看看改了什么」，也随时能切到「看代码」自己改、让人讲。
  「看代码」是同一个项目的另一面，不是另一个产品。
- **登录是门禁，不是门槛。** 只有授权名单里的用户能登录；登录只解锁 AI 和同步，
  不登录的孩子照样能完整地做游戏。
- **安全默认。** 密钥永远不进浏览器；身份或配置有任何不确定，一律拒绝；只收集运行所需的最少信息。
- **一套工具，多个入口。** 界面按钮、内置小助手、WebMCP 外部 Agent 操作项目时走同一套工具和同一套确认规则，
  不会因为入口不同而绕过规则。
- **可验证。** 核心路径由端到端测试守护；小助手一轮怎么跑、输出规则、权限边界都有自动化测试证明。

品质冲突时的优先级：
**孩子的作品不丢 > 安全与授权 > 与真 pygame 一致 > 孩子看得懂 > AI 能力 > 功能数量。**
例如：宁可让 AI 少做一步、多让孩子确认一次，也不能静默改动项目；
宁可让某个写法在浏览器里给出明确提示，也不能为了「能跑」偷偷改写孩子的代码。

## 已确定的技术边界

这些是项目或用户已经定下的选择。改动它们属于改边界，需要先确认。

| 领域 | 已确定 | 来源 |
| --- | --- | --- |
| 游戏运行时 | pygbag 0.9.3（pygame-ce + CPython 3.12 WASM）；预览和导出共用 `runtime/player.tmpl` | [runtime.md](runtime.md) |
| 托管 | 一个 Cloudflare Worker + 静态资源，域名 `gamekit.talkincode.net`，CI 通过后自动部署 | `wrangler.jsonc`、`.github/workflows/ci.yml` |
| 登录 | Cloudflare Access（Zero Trust）单点登录，身份源只开 GitHub；Access 应用只保护 `gamekit.talkincode.net/api`，页面和 PWA 外壳不进 Access。应用由 `scripts/setup-access.sh` 创建 | 用户要求 |
| 授权 | 授权名单 `ALLOW_GITHUB_USERS`：GitHub 账号邮箱，逗号分隔。Access 策略和 Worker 各校验一次 | 用户提供的 `.env`；Access JWT 只可靠地携带 `email` |
| 文本 AI | 服务端调用 OpenAI 兼容接口（`OPENAI_API_URL`、`OPENAI_API_KEY`），模型名 `OPENAI_MODEL` 在 `wrangler.jsonc` | 用户提供的 `.env` |
| 图像 AI | 服务端调用 Gemini Interactions API（`models/gemini-3.1-flash-lite-image`），密钥与模型名来自 `GEMINI_APIKEY`、`GEMINI_IMAGE_MODEL`（secret）。生图前先用文本模型把孩子的中文描述拐成英文提示词 | 用户要求（图片改用 Gemini） |
| 云存储 | Cloudflare 自家存储；具体用 D1、R2、KV 还是 Durable Objects 由实现者按同步规则选择 | 用户要求 |
| 外部 Agent | WebMCP：特性检测 `document.modelContext`，不支持的浏览器不注册、不报错 | 用户要求；[WebMCP 提案](https://github.com/webmachinelearning/webmcp) |

## 当前能力清单

以下是当前代码中已经存在的能力。界面分「做游戏」和「看代码」两个视图，文案在 `src/ui/text.ts`（中文优先）。

- 游戏设计器界面（默认）

左边（窄屏时在上面）是游戏舞台：你的作品和小助手做的候选版本都在这里跑，上面标着「正在试玩：……」；
右边是对话面板：每一轮一张卡，写着"你说"、行动步骤、设计卡、改了什么、以及「采用这一版 / 丢掉这一版」。
输入框会随文字长高，可以粘贴/选择/拖入图片（最多 4 张，浏览器先缩图再发），也能用麦克风说（Web Speech API，
浏览器不支持就不显示麦克风）。小助手在忙时，顶栏一个 chip、输入框上方一条状态，都在动。
入口 `src/ui/DesignerPane.tsx`、`src/ui/Stage.tsx`、`src/ui/AgentWorking.tsx`、`src/lib/images.ts`、`src/lib/speech.ts`、`src/App.tsx`。

- 我的项目（项目管理面板）

顶栏「项目」打开一个独立面板：搜索、新建、导入 zip、卡片列表（名字、当前、更新时间、文件数、设计卡标题）、
每张卡上可以改名/复制/导出源码/删除（删除就在卡内二次确认，不弹系统窗口），底部显示项目数与本机占用。
切项目、新建、导入、删除都会关掉面板并开新的一局对话；没在打开的项目只能先打开再改。
入口 `src/ui/ProjectsPanel.tsx`；面板只调 store 的动作，自己不碰存储。

- 看代码视图：面板可收拢

顶栏一组开关（文件栏 / 舞台 / 控制台）分别收放左侧文件栏、右侧舞台和底部控制台，选择存在本机；
舞台只是收窄到 0，不会被卸载，所以收起来时正在跑的游戏不会重启。「撤销」是图标 + 两个字，完整说明在 tooltip。
入口 `src/App.tsx`、`src/ui/Toolbar.tsx`（`--code-columns` / `--code-rows`）。

- Agent 循环（小助手的一轮）

听懂想法 → 设计（设计卡）→ 制作（候选版本文件）→ 静态检查 → 自动试运行 → 最多修两次 → 等孩子试玩。
一轮最多 4 次模型调用；只有代码证据（静态问题、traceback）触发修复，预览没起来就算「没能自动验证」。
候选在内存里，刷新就没了，从不碰作品；采用才写入并记快照。
孩子可以中途停下；换项目、新建、导入时正在跑的一轮立即作废。
会话（对话历史、token 用量、压缩）由 Google ADK 承担：每个项目一份 session 存在本机，打开项目接着聊，
超过记忆上限就把最早的对话压成摘要；上限在「设置」里可选，默认跟随模型能装多少。
入口 `src/lib/agent.ts`（步骤逻辑，可注入依赖）、`src/lib/adk/`（模型适配、会话、runner）、
`src/studio/store.tsx`（接运行与状态）、`src/ui/SettingsPanel.tsx`。

- 多文件项目与本地保存

项目存在浏览器 IndexedDB（库 `gamekit`，表 `projects`）。新建示例或空白项目、打开、改名、复制、删除，
新增/删除/改名文件，导入二进制素材，导入源码 zip。项目上带一张设计卡（`design` 字段）和一个回收站（`trash` 字段），
都随项目一起保存。
写法：结构性变动（文件树、设计卡、采用、撤销）立即写入，只有编辑器的敲字用 350ms 防抖合并；
写入串成一条队列，保证最后落盘的是最新一版；关闭页面时再冲一次。
入口 `src/studio/store.tsx`、`src/lib/storage.ts`、`src/lib/project.ts`、`src/lib/design.ts`。

- 起始示例

一个带精灵图和跳跃音效的可玩示例，自带设计卡（`src/lib/starter.ts`、`src/lib/samples/`）。

- 代码编辑

「看代码」视图里的 Monaco 编辑器，Python 高亮；左侧是文件与素材：新建/改名都是一次一个行内输入框，
可以取消（或按 Esc）；删除先进回收站（先问一句），回收站里能恢复、彻底删除或清空，文件不会一步就没。
「讲讲这段」把选中的代码发到对话面板里讲解，只读，不改项目
（`src/ui/CodePane.tsx`、`src/ui/Sidebar.tsx`、`src/lib/ai.ts` 的 `explainMessages`）。

- 浏览器内运行

用 pygbag 模板打包一个项目（作品或候选），页面 Service Worker 把本次构建放进 Cache，iframe 打开 `/play/<id>/` 运行；
「停下」结束会话。入口 `src/lib/build.ts`、`src/lib/session.ts`、`public/sw.js`、`runtime/player.tmpl`、`src/ui/Stage.tsx`。

- 诊断

静态检查帧循环是否 `await asyncio.sleep(0)`、阻塞式 sleep、非 OGG 音频；从控制台 traceback 定位出错行；
调试页显示运行状态、FPS、帧时间和输入事件。静态检查同时是小助手修复循环的判断依据。
入口 `src/lib/diagnostics.ts`、`src/ui/BottomPanel.tsx`。

- 登录与授权

工具栏「登录/退出」是整页跳转到 `/api/login`、`/api/logout`。生产环境由 Cloudflare Access（GitHub）登录，
Worker 对每个 `/api/*` 请求校验 Access JWT（签名、aud、iss、过期）并核对 `ALLOW_GITHUB_USERS`；配置缺失时拒绝。
页面只在本机登录过时才询问 `/api/me`，匿名访问不发任何身份请求。本地开发用 `LOCAL_DEV_AUTH=1` 的替身登录表单，
只在 localhost 生效。入口 `worker/identity.ts`、`worker/index.ts`、`src/lib/account.ts`、`src/ui/Toolbar.tsx`。
**线上状态：** Access 应用已创建、`ACCESS_AUD` 已写入、secret 已写入；新代码随 `main` 部署后生效。

- AI 游戏设计器（仅授权用户）

一轮：听懂想法 → 设计卡 → 制作候选版本 → 静态检查 → 自动试运行 → 修复（最多两次）→ 孩子试玩后采用。
候选在内存里，从不碰作品；采用时同时写入文件和设计卡并记快照，可撤销。模型结果先过 `readDesign` / `readCandidateFiles`
（只改文本文件、路径在项目内、不换二进制素材、单文件 ≤ 60,000 字符）。文本模型是服务端的 OpenAI 兼容接口。
入口 `src/lib/agent.ts`、`src/lib/ai.ts`、`src/lib/design.ts`、`src/studio/store.tsx`、`src/ui/DesignerPane.tsx`、`worker/ai.ts`。

- AI 讲解（仅授权用户）

「看代码」里「讲讲这段」把当前文件与选区发给模型，答案只回到对话面板，不允许返回文件，不改项目。

- 声音生成（仅授权用户）

音效与音乐两种。模型只挑参数（振荡器/包络/扫频，或 bpm/调式/和弦/三个声部），**不写采样**；
浏览器按同一份参数确定性地合成 PCM 并写成 16-bit 单声道 22.05 kHz WAV。不登录时用预设和滑杆做同一件事。
入口 `worker/ai.ts`（提示词与参数校验）、`src/lib/audio/`、`src/ui/SoundEditor.tsx`。编辑器见下一条。

- AI 素材生成（仅授权用户）

四种模板（角色/背景/瓦片/图标）。提示词全在服务端拼装：先用文本模型把孩子的中文描述改写成一句英文提示词，
再加上这一种素材的构图要求和儿童安全约束（不能用正向提示词写「不要…」，安全规则作为明确的禁止列表交给模型），
然后调 Gemini 生图（`GEMINI_APIKEY` + `GEMINI_IMAGE_MODEL`，密钥只在 Worker）。返回的是 1K 图片，
浏览器再把它变成真正的素材：角色与图标在纯色（magenta）背景上生成，用角落颜色泛洪法去背景、根据内容裁边、
最近邻缩放到 32/48/64 像素，存成背景透明的 PNG；背景与瓦片不切背景，直接 cover 到 640×360 / 尺寸。
预览里看到的就是最后存进 `assets/` 的那张图。入口 `worker/ai.ts`、`src/lib/sprite.ts`、`src/lib/sprite.test.ts`。

- 像素编辑器 / 新建图片（不依赖 AI，未登录可用）

「看代码」左侧的素材区与文件区有「新建图片」：孩子选名字（`assets/` 下的 PNG，同名不覆盖，自动加序号）、尺寸
（16/32/48/64 一键选，或自定义，宽高各 ≤ 256）、背景（透明/纯色），从空白画布开始画。任何 `assets/` 里的 PNG
（生成的、导入的、示例自带的）都能点「编辑像素」打开：素材卡片和文件行上的小按钮、图片预览里的按钮、
生成素材弹层里的「继续修改像素」。编辑器有铅笔、橡皮、油漆桶、吸管、清空，一组儿童友好调色板加自定义颜色和透明，
棋盘格透明、网格线开关、整数倍缩放（最近邻）、1:1 实际大小预览、撤销/重做（Ctrl/⌘+Z、Shift+Z），
鼠标、触控、笔都能画（Pointer Events，拖动补线不断点）。
保存写的是普通 PNG（canvas 像素原样编码，保留 alpha），保存后提示「在代码里这样用：pygame.image.load("assets/xxx.png")」。
新图保存 = 新建文件；对已有 PNG 的修改分「保存」（覆盖）和「另存为新图片」，覆盖在工作室的撤销里记一份快照，
一次撤销就回到原图。关闭时有未保存的画会先问一次（继续画 / 不保存 / 保存）；写入失败时画布留着、给一句短话、可重试
（先写、写成功才改内存，失败不留半成品）。像素编辑是「人」的动作：小助手和 WebMCP 没有改 `assets/` 的工具，
`runtime/player.tmpl` 与 IndexedDB 结构都没动。
入口 `src/ui/PixelEditor.tsx`、`src/ui/PixelNewDialog.tsx`、`src/ui/Sidebar.tsx`（入口按钮）、
`src/studio/store.tsx`（`startPixelNew`、`editPixelFile`、`editDraftPixels`、`closePixelEditor`、`savePixelImage`）；
纯逻辑都在 `src/lib/pixel/`（`buffer` 像素缓冲区/线段/填充、`png` 编解码、`rules` 尺寸与命名校验、
`session` 工具与撤销栈、`history`、`save` 保存计划、`load`、`palette`）；文案在 `src/ui/text.ts` 的 `pixel`。
还没做：笔刷粗细、键盘画点。多帧、精灵表、选区、移动和图层见下一条。瓦片地图见阶段 C。

- 精灵与动画编辑器（阶段 B，不登录可用）

同一张像素编辑器可以画多帧。时间轴能加一帧、复制这一帧、删掉这一帧（至少留一帧）。每一帧有自己的毫秒，也可以按每秒 4、8、12 帧一起改。洋葱皮把上一帧淡淡铺在下面。播放和暂停只在编辑器里预览，不写文件。透明还是棋盘格，alpha 原样进 PNG。撤销覆盖笔画、加帧、删帧、选区移动、图层和导入。

选区先拖出一个框，再在框里拖动，像素就挪走。图层最多四层，可以藏起来、上下移动。保存时把看得见的层合成进每一帧；重新打开是一帧一层。说明文件不记图层。

动作是 idle、walk、jump（界面上写「站着」「走路」「跳」），帧号写在说明里。导入精灵表按从左到右、再往下拆开，拆开之前的画面可以撤销回来。

保存写两份普通文件：精灵表 PNG，和旁边的 `名字.anim.json`（格式 `gamekit.sprite-anim`）。里面的 `animation` 和素材库清单相同：`frameWidth`、`frameHeight`、`frames`（`index`、`durationMs`）、可选的 `states`。`index` 就是数组位置，和 PNG 上从左到右、再往下的格子是同一顺序。单张静止图仍然只写 PNG。已经有说明文件时，保存会把它改成和当前画面一致。读不了的说明不会改文件，编辑器按整张图打开并告诉孩子。写入失败时 PNG 和说明都不留下。

播放是普通 pygame。编辑器里有一段可以复制的代码。「把播放代码放进项目」写入可见的 `sprite_anim.py`，项目里已有不同内容时不盖掉。「在舞台上试播」先确认，再把 `main.py` 换成一段带 `await asyncio.sleep(0)` 的播放代码，工作室撤销可以回到原来的代码。不引入 GameKit 运行库，`runtime/player.tmpl` 没有改。

小助手和 WebMCP 不能改写 `*.anim.json`。入口 `src/ui/PixelAnimPanel.tsx`、`src/lib/pixel/anim.ts`、`src/lib/pixel/film.ts`；保存仍走 `savePixelImage`。

还没做：让小助手按这段说明检索素材。音效编辑器已在阶段 D 交付。

- 瓦片地图编辑器（阶段 C，不登录可用）

「看代码」的文件栏和素材区都能「画地图」。先选关卡名、文件名（`maps/level-1.map.json`）、大小（10×8、20×12、32×18）和格子（8/16/32）。编辑器里有瓦片调色板、点绘、矩形、填充、擦除，最多四层，可以藏起来或上下移动。背景是天空、夜晚、洞穴或沙滩。碰撞是单独的一层标注（0 能走，1 不能走）。出生点只有一个。物件标记是金币、敌人、门或标记，点同一格再拿掉。画面上可以叠上碰撞和标记，当作简单预览。撤销和重做只在编辑器里，不写文件。

保存写一组普通文件，路径都由文件名算出来，说明里的路径不能指到别的文件：`maps/<名字>.map.json`（格式 `gamekit.map`）、每一层一个 CSV、`maps/<名字>.collision.csv`、`maps/<名字>.tileset.png`。新地图可以选纯色方块，也可以选素材库里格子是 8、16 或 32 像素、不超过 32 格的图块。选中的图会复制进项目里的瓦片图，不连到素材库。格子里的 0 是空的，1 是瓦片图上从左往右的第一格。孩子可以在「看代码」里改这些数字，再打开编辑器就是改过的样子。导出一份地图包（JSON，里面是同样的文件），再导入会回到同一张图，先不写入项目；存的时候才写，并且可以撤销。

读取是普通 pygame。「把读取代码放进项目」写入可见的 `map_loader.py`（`load_map`、`solid_at`、`draw_map`），项目里已有不同内容时不盖掉。「在舞台上看这一关」先确认，再把 `main.py` 换成一段带 `await asyncio.sleep(0)` 的代码，打出出生点像素、碰撞格数和瓦片图上的一个像素。工作室撤销可以回到原来的代码。不引入 GameKit 运行库，`runtime/player.tmpl` 没有改。

打不开的地图会说明原因，不改已经在项目里的文件。写入失败时 JSON、CSV 和 PNG 都不留下，画面还在，可以再试一次。小助手和 WebMCP 不能改写 `*.map.json`、`maps/*.csv` 和 `*.tileset.png`。

入口 `src/ui/MapEditor.tsx`、`src/ui/MapNewDialog.tsx`、`src/lib/map/`；写入走 `src/studio/store.tsx` 的 `saveMap`。

还没做：用项目里已有的 PNG 换瓦片图。

- 音效编辑器（阶段 D，不登录可用）

「看代码」的素材区能打开声音。预设有跳跃、轻跳、金币、碰到蘑菇和一段走路音乐，不登录也能用。滑杆改波形、音高、包络、音量，也能截取一头一尾。勾上循环时，首尾会接上，免得 `play(-1)` 爆音。音乐能改速度和小节，主旋律、低音、踩镲可以单独听。画面上的包络和波形就是正在听的那一份。点保存，写进项目的 WAV 和刚才试听的字节相同，可以撤销。写入失败时项目不变，声音还留在编辑器里。

「在舞台上听听」会先给看 `main.py` 变成什么样，确认后才写。那段代码是普通 pygame：点一下画面再 `mixer.init()` 和 `Sound.play`，并且 `await asyncio.sleep(0)`。官方音效在素材库里：GameKit 合成的「森林声音」，以及 Kenney CC0 的 OGG Vorbis。声音编辑器打开后可以试听这些声音，试听不写入项目；要放进游戏仍从素材库复制。森林的图和声音用同一套标签连着（跳跃对角色，金币对金币，蘑菇对蘑菇）。轻跳是跳跃的一种变体，改参数就行，不用重新画图。孩子收录的声音存在这台电脑上，清单字段和官方包一样（许可、作者、来源、署名、hash），格式不对的不会收。复制进项目之后，游戏读的是项目里的文件。

浏览器能播的是 16-bit PCM WAV，和通过检查的 OGG Vorbis。MP3、AIFF、坏 WAV、Opus 会在问题里说明。小助手和 WebMCP 不能改这些音频文件，也不能改素材库记录。

入口 `src/ui/SoundEditor.tsx`、`src/lib/audio/`、`src/lib/assets/sounds.ts`；写入走 `src/studio/store.tsx` 的 `saveSound`。

- 内置素材库（阶段 A，不登录可用）

顶栏和「看代码」的素材区都能打开素材库。包的说明是版本化的 `asset-pack` manifest（稳定 id、版本、路径、媒体类型、像素尺寸、动画帧、瓦片网格和碰撞、中文标签、主题、预览、许可/作者/来源/署名、内容 hash），语义不靠文件名猜。现在有 GameKit 原创、CC0 的「森林冒险」和「森林声音」，再加上 Kenney CC0 精选：平台跳跃、迷宫地牢、太空射击、竞速、益智、界面、音效。每个主题只收协调的一小套，不整包搬入。来源和许可写在 [docs/asset-credits.md](asset-credits.md)。缩略图和包说明在打开素材库、地图新建或声音编辑器之后才加载，不进首屏脚本。
带动画说明的角色可以「在动画里打开」：先按同样的规则复制进项目，再写下旁边的 `.anim.json`，然后打开动画编辑器。同名冲突时，保留原来的不会打开编辑器。
复制进项目的是文件本身，记在 `assets/library/<包>/…`，版本写在 `assets/library.json`。运行和导出用的是这份副本，不访问素材库，也不访问 kenney.nl。同名、重复、更新和替换都会先说明，不会静默盖掉；盖掉之后可以撤销。加载示例是普通的 `pygame.image.load`。小助手和 WebMCP 可以检索目录、把某一份点名为候选；采用时才按同一套复制规则写入。它们不能在文件里直接写二进制，也不能盖掉已经不一样的那一份，也不能改孩子手写的 `assets/library.json`。
入口 `src/ui/LibraryDialog.tsx`、`src/lib/assets/`、`public/asset-packs/`。还没做：孩子自己跨项目的图片。动画编辑器已在阶段 B 交付，地图编辑器已在阶段 C 交付。官方音效和孩子收录的声音已在阶段 D 放进同一套清单。配方和检索已在阶段 E 交付。平台跳跃、迷宫和卡通射击的说明里提到了可以用的 Kenney 包，检查仍只看原来的源码和舞台标记。

- 游戏配方与分步挑战（阶段 E，不登录可用）

顶栏「配方」列出五份能玩的 pygame：平台跳跃、接球、迷宫、卡通射击、贪吃蛇。每一份带代码、一张 PNG、设计卡、`README.txt` 里的知识点和 `recipe.json` 里的挑战说明。做成新项目永远是另一个 id，不改当前作品。
每个配方有一步挑战。先给目标和提示，讲原因，孩子要求时才把写好的那一行改动做成候选。检查只看源码和舞台打出的标记（例如 `RECIPE-JUMP`），不请模型判断对错。采用才写入，撤销能回到改之前。
四条路都在：自己写代码、看完整例子、做这一步、请小助手（登录后的对话，或挑战里那一版候选）。
入口 `src/ui/RecipesDialog.tsx`、`src/lib/recipes/`。模板没有改。

- 素材检索与提议（阶段 E）

页面上搜索素材目录不登录、不调用 `/api/`。点「做成候选」只在内存里准备复制和一段 `examples/load-….py`；丢掉则项目不变；采用后可以撤销。路径上已有不同字节时拒绝，不盖掉。
登录后的一轮会把目录名单放进制作提示。模型只能点名最多两个 id，不能交字节。复制进候选；冲突则这一轮失败，作品不动。
外部 MCP 的 `search_assets` 只读，`propose_asset` 只产生候选。没有令牌的调用被拒绝。工具名称和说明在 `shared/tools.ts`，页面和 Worker 用同一份。
常见 Python/pygame 报错在「问题」和控制台上方有一句孩子的话，原来的报错收在「原来的报错」里。

- 导出

网页 zip、静态目录 zip、itch.io zip、嵌入 zip、源码 zip。源码包不联网。网页包的游戏文件都在包里，不请求 GameKit，也不请求素材库；打开网页仍要加载 pygame-web 的运行时，导出菜单写了这一句。入口 `src/lib/export.ts`。见 [runtime.md](runtime.md) 的「离线导出」。

- 部署

推送 `main` 后 CI 单元测试、类型检查、构建、E2E，全部通过后 `wrangler deploy`（`.github/workflows/ci.yml`）。

尚不存在：云同步、PWA 清单与离线外壳、AI 按人配额、
对话历史持久化（一轮的对话刷新后就没了，设计卡和作品在）。教程与配方、素材检索已在阶段 E 交付。

## L0 分阶段（Issue #14）

[Issue #14](https://github.com/talkincode/GameKit/issues/14) 是完整工作室的总目标，不是一次提交。下面的阶段都还在目标里；做完一个就改这一节和验收矩阵，不把没做的从目标里删掉。

| 阶段 | 状态 | 范围 |
| --- | --- | --- |
| A. 统一内置资产库闭环 | 已交付 | 版本化 manifest、森林冒险，以及 Kenney CC0 的平台跳跃、迷宫地牢、太空射击、竞速、益智、界面和音效。匿名浏览/预览、复制进项目并固定版本、pygame 示例、离线导出。见上「内置素材库」 |
| B. 精灵与动画编辑器 | 已交付 | 帧时间轴、精灵表、多动作、选区与图层。产物是 PNG + 可读 JSON，播放是普通 pygame。见上「精灵与动画编辑器」 |
| C. 可视化瓦片地图 | 已交付 | 瓦片调色板、点绘/矩形/填充/擦除、图层、背景、出生点、物件标记、碰撞标注和预览。产物是 JSON + CSV + PNG，并附可读的 pygame 加载示例。见上「瓦片地图编辑器」 |
| D. 音效与音乐编辑 | 已交付 | 预设、包络和波形、裁剪、音量、循环、音乐的节奏和声部。官方音效与收录的声音走同一套清单。导出的 WAV 离线可播。见上「音效编辑器」 |
| E. 游戏配方与分步挑战 | 已交付 | 五份可玩 pygame 配方、一步挑战用源码和舞台标记判断，新建项目不覆盖旧的。见上「游戏配方与分步挑战」 |
| F. AI / WebMCP 资源检索 | 已交付 | 检索只读；提议产生候选；拒绝或冲突不改作品；采用后可撤销。见上「素材检索与提议」 |
| G. 离线与发布验证 | 已交付 | 配方、素材库副本、动画、地图和声音导出的源码包与网页包，hash 和项目里的副本一致，不请求站点和素材目录。网页运行时仍要 pygame-web，导出提示和 [runtime.md](runtime.md) 写明了。素材包的 schema、hash、许可和来源在 `pnpm build` 时检查，违规中止构建。见下「L0 验收」 |

阶段 A–G 是 L0 里可以机器复现的部分，已经交付。人工体验仍要产品/孩子试用，没有勾成完成。云同步和 PWA（断网打开工作室、缓存 pygbag 运行时）仍在目标里，没有从路线图删掉，也不是阶段 G 偷偷做掉的。

## L0 验收（Issue #14）

对照 [Issue #14](https://github.com/talkincode/GameKit/issues/14) 的验收清单。勾上的项都有可复现的测试。人工体验不勾。

- [x] **资源库**：匿名搜索、预览许可和来源、复制进项目、pygame 运行、源码包和网页包里都有这份文件，加入时没有 `/api/`。证据：`tests/e2e/library.spec.ts` 的 `an anonymous child can browse the library without loading it up front`、`the copied picture runs in pygame and is inside the offline export`；`tests/e2e/kenney.spec.ts` 的 `searching finds a Kenney tileset, and pygame plus the export use the copy`；`tests/e2e/offline.spec.ts` 的 `a recipe project with library, animation, map, and sound exports offline`。
- [x] **冲突与版本**：同名先问再保留或替换，重复复制不写第二份，删除进回收站可恢复，撤销能回到旧字节。素材库升到新版本时，已经导出的 zip 和项目里钉住的 hash 不变；选「保留」也不改。证据：`tests/e2e/library.spec.ts` 的 `copying pins a file, a second copy does nothing, and undo removes it`、`a same-path file is kept or replaced, and undo puts the old bytes back`、`trashing a copied picture can be restored from the trash`；`src/lib/assets/copy.test.ts` 的 `treats a newer pinned version as an update, and a hand-edited file as a conflict`；`src/lib/offline.test.ts` 的 `a newer catalog does not change an exported zip or a pinned copy`。
- [x] **完整性/版权**：每个 manifest 过 schema，文件 hash 必须对上，许可、作者、来源、署名不能空。违规时 `packGateFailure` 非空，`vite.config.ts` 的 `gamekit-asset-pack-gate` 在 `pnpm build` 里 `this.error`，CI 的构建步骤因此失败。证据：`src/lib/assets/validate.test.ts` 的 `blocks an empty license, author, source, or attribution`、`blocks a hash that does not match the file`、`a broken license or a bad hash stops the pack gate`；`src/lib/assets/kenney.test.ts` 的 `ships one pack for each theme and passes the ship gate`。CI：`.github/workflows/ci.yml` 的 `pnpm build`。
- [x] **动画**：多帧保存后再打开，PNG 和 JSON 的像素、时长、透明通道可比对，源码包里两份都在，pygame 打出 `ANIM-OK`。坏说明和失败写入不改作品。证据：`tests/e2e/anim.spec.ts` 的 `anonymous: frames are saved, reopened, exported, and played by pygame`、`a bad animation note and a failed write leave the picture untouched`。离线包里的动画文件见 `tests/e2e/offline.spec.ts`。
- [x] **地图**：画关、碰撞、出生点保存后能还原，地图包导入一致，源码包里有 JSON/CSV/PNG，pygame 打出 `MAP-OK`。非法地图和失败写入不改原文件。证据：`tests/e2e/map.spec.ts` 的 `anonymous: a painted map is saved, reopened, exported, and played by pygame`、`a bad map file and a failed write leave the project untouched`。
- [x] **声音**：试听和保存是同一份 WAV，官方音效进素材库后 pygame 打出 `SOUND-OK`，源码包和网页包里是这份文件。坏格式在问题里说明。证据：`tests/e2e/sounds.spec.ts` 的 `a preset is heard and saved as the same wav, without asking the model`、`an official sound plays in pygame and is inside the offline export`、`an mp3 is diagnosed, and a kept sound shows up in the library`。
- [x] **配方教程**：从完整配方新建项目，舞台打出 `RECIPE-OK`，旧项目还在。挑战在改之前失败，采用后通过，撤销后再失败。证据：`tests/e2e/recipes.spec.ts` 的 `an anonymous child starts a recipe without covering the old project, and the step is checked from the stage`；`src/lib/recipes/recipes.test.ts`。
- [x] **AI / WebMCP**：页面检索不调用 `/api/`。提议只产生候选，丢掉或冲突不改作品，采用后可撤销。没有令牌的 MCP 检索被拒绝。匿名、授权、已登录未授权都有用例。证据：`tests/e2e/recipes.spec.ts` 的 `proposing a catalog picture stays a candidate, and a different file is not replaced`、`an allowed account proposes a picture without writing the project first`、`a signed-in child who is not allowed can still start a recipe, and a tokenless search is refused`；`tests/e2e/collab.spec.ts`；`worker/mcp.test.ts` 的 `refuses search_assets without a token`。
- [x] **回归**：预览、源码 zip、网页 zip、像素、动画、地图、声音、配方、导入、撤销、项目保存、AI/WebMCP 权限都有 E2E。CI 跑 `pnpm test`、`pnpm typecheck`、`pnpm build`、`pnpm test:e2e`（`.github/workflows/ci.yml`）。证据见上表，以及 `tests/e2e/pixel.spec.ts`、`tests/e2e/agent.spec.ts`、`tests/e2e/account.spec.ts`、`tests/e2e/projects.spec.ts`、`tests/e2e/files.spec.ts`、`src/lib/offline.test.ts` 的 `a recipe with a library copy, animation, map, and sound exports without the catalog`。
- [ ] **人工体验**：需产品/孩子试用验收，这次没有勾成完成。要看一个不登录、不生图的孩子，能否从素材包或配方开始玩完一局，并自己找到素材、改角色动画、摆地图、看懂 Python。机器测试不能代替这一条。

## 非目标（铁律）

- **不做积木编辑器。** 不做 Blockly 式拖拽，也不做「积木转 Python」。GameKit 的价值就是让孩子直接写 Python。
- **不发明私有游戏 API，不改写 pygame。** 需要的辅助代码必须是项目里可见的 `.py` 文件，并能在桌面 pygame-ce 上运行。
  构建过程不改写孩子的源码。
- **不在服务器上运行孩子的代码。** 游戏只在浏览器里运行；服务器只做身份、AI 转发和数据存取。
- **浏览器里不出现任何 AI 密钥，不做「自带 API Key」。** AI 只经由 Worker 调用，只对授权用户开放；
  前端不能选择模型供应商或接口地址。
- **不做开放注册，不自建账号密码。** 身份只来自 Cloudflare Access（GitHub）；授权名单之外的人无法登录，
  也没有「登录了但降级使用」的中间状态。
- **生产环境没有任何绕过登录的开关。** 本地开发如需模拟身份，只能在本地运行时生效；
  这类配置出现在生产部署里应当导致请求被拒绝，而不是放行。
- **登录不是使用前提。** 未登录时，新建、编辑、运行、导入、导出都必须完整可用，且不发起需要身份的网络请求。
- **任何入口都不能静默改项目。** 内置小助手、WebMCP 外部 Agent、同步、导入，凡是会改变孩子作品的操作，
  都要么新建项目，要么先展示改动、由人确认，并且可撤销。小助手的自动迭代只发生在**候选版本**里，
  采用是唯一写入路径，还有「撤销上一次改动」兵底。允许 AI 自主执行的部分：写候选、跑预览、修候选；
  不允许的部分：改作品、换项目、动 `assets/` 里的素材。
- **同步不静默覆盖。** 两台设备改了同一个项目时保留两份，让人选择；不做「最后写入者赢」。
- **不做公开作品广场和社交功能。** 不做公开发布、评论、点赞、私信；它们带来的儿童内容审核和隐私责任超出本项目边界。
  分享只通过导出文件完成。
- **不接入第三方统计、广告或追踪 SDK。** 服务端日志只记录诊断所需的元数据（`requestId`、操作、耗时、用量、失败分类），不记录孩子的代码和提示词全文。本机「日志」同样不上传。
- **不托管成品游戏，不对接第三方发布平台账号。** 导出只生成文件（沿用现有边界）。

## 方向与意图

- 儿童友好的游戏设计器界面

两个视图：**做游戏**（默认：舞台 + 一句话输入 + 每轮一张的对话卡）和 **看代码**（文件树、Monaco、控制台、调试）。
中文优先（文案集中管理，便于以后加其他语言），大号可点目标、适配平板触控和键盘；进度只说行动，不展示模型内部推理。
报错、空状态、加载、失败都用鼓励式短句，技术细节折叠在「看代码」里。服务于「孩子看得懂、敢动手」。
小助手失败按原因换一句话（太忙、网络断了、请登录），旁边可以「查看详情」（分类、编号、时间、可公开的技术细节）。
工作室有「日志」，记在这台电脑上，不上传，不需要登录。编号和 Worker 的 `requestId` 是同一个，方便大人到 Cloudflare 日志里查。

- 游戏配方与分步教程

阶段 E 已交付：平台跳跃、接球、迷宫、卡通射击、贪吃蛇，都是完整可玩的 pygame 项目；
每份有一步可观察的目标，用源码和舞台标记判断，不请模型打分。从配方开始是新项目。
挑战里的修改先是候选，孩子采用才写入。打飞机没有单独再做一份，卡通射击是能落地的那一类。
服务于「打开就能做游戏」和「真 pygame」。

- 内置创作工具

像素精灵编辑器（单张图片的编辑与新建已完成；多帧、精灵表和动作说明已在阶段 B 交付）、瓦片地图编辑器（阶段 C 已交付）、音效编辑器（阶段 D 已交付，本地参数化生成 WAV）。产物是普通的
PNG/OGG/数据文件，代码用标准 pygame 读取。不依赖 AI，未登录也可用。服务于「打开就能做游戏」。

- 小助手覆盖全流程

已实现主体（Agent 循环）。还想要的：机器看得懂设计卡的「挑战模式」（给下一步小任务）、
风格一致的素材生成接进同一轮、必要时把舞台截图当作证据、把常见报错翻给孩子看。
助手看到的上下文（相关文件、静态问题、控制台 traceback）由工具层提供，改动一律只落候选，采用才写入作品。
行为规则只在 [ai-rules.md](ai-rules.md) 维护。服务于「孩子是作者，小助手是搭档」。

- 登录与授权

已实现（见「当前能力清单」）。还想要的：Access 拦截页改成孩子看得懂的文案；登录过期时不打断正在进行的编辑。
服务于「登录是门禁，不是门槛」和「安全默认」。

- 云端同步

登录后项目在设备之间同步。本地仍是第一份数据：离线照常编辑，联网后再同步。
首次登录时询问是否把本机未登录时的作品带进账号；退出登录时可选择清除本机上属于该账号的数据（照顾共用电脑）。
冲突保留两份。服务于「孩子的作品不丢」。

- PWA 与离线

可安装、可离线打开和编辑；运行游戏所需的 pygbag 运行时在首次使用后缓存，断网也能运行已缓存版本。
更新时提示刷新，而不是在孩子编辑时突然换版本。服务于「打开就能做游戏」。

- WebMCP

把工作室工具层注册为 WebMCP 工具，例如：列出和读取文件、读取诊断和控制台、运行/停止游戏、
提议修改（形成候选版本）、新建项目、读设计卡。只读和运行类工具未登录可用；
会消耗 GameKit AI 的工具要求登录；任何写入仍需页面上的人点「采用」。工具定义与内置小助手共用一份。
服务于「一套工具，多个入口」。

- 看得见的调试

补齐 [runtime.md](runtime.md) 里「还没做」的部分：碰撞盒、精灵边界、鼠标坐标叠加、音频通道状态，
以及把常见 pygame/Python 报错翻译成孩子能懂的中文。服务于「孩子看得懂」。

## 完成的样子

> 当一个没用过 GameKit 的孩子说出一句话就能玩到会动的游戏、说出「让它跳高一点」就能拿到新的一版、
> 自己决定收下哪一版、导出后在家里电脑的 Python 里照样能玩，而家长能确信只有授权的人能用 AI、作品不会丢时，
> 这个项目就达成了。

- 孩子的核心路径由端到端测试守护

说出想法 → 拿到候选 → 试玩 → 采用 → 看代码 → 撤销 → 导出，在生产构建上有自动化测试；回归会在 CI 中被挡下。

- 权限边界由测试证明

匿名、授权用户、已通过 Access 但不在名单内三种身份，对每个需要身份的接口都有测试证明结果正确；
配置缺失时接口拒绝服务。

- AI 规则可验证

模型输出的解析与拒绝规则（路径、文件类型、二进制素材、大小）有单元测试；
改动 AI 提示词或上下文时，有一组固定的样例请求用来比较改动前后的结果。

- 数据不丢可验证

本地保存、刷新后恢复、同步冲突保留两份、同步失败后本地不受影响，都有测试。

- 离线可用可验证

导出的源码包可以断网玩（阶段 G）。网页包仍要 pygame-web 运行时，导出菜单写明了。断网打开工作室页面、打开项目、跑已缓存的 pygbag 运行时，仍是下面的 PWA 项，还没做。

## 验收矩阵（业务能力覆盖矩阵）

> 覆盖底线（硬性规定）：
>
> 1. 每个一级功能至少有一条 Happy Path E2E。
> 2. 每个高风险功能至少覆盖一条失败路径。
> 3. 每个涉及权限的功能至少验证两种角色。
> 4. 每个会修改系统状态的操作至少验证一次失败后的恢复或回滚。
> 5. 每次新增一级业务功能，必须同步新增对应的 E2E 并更新本矩阵。

权限角色：**匿名**、**授权用户**、**已登录未授权**（通过了 Access 但不在 Worker 授权名单内，或 JWT 无效）。

| 一级功能 | 状态 | 风险级别 | Happy Path E2E | 失败路径 | 权限角色覆盖 | 失败恢复/回滚 | 证据（测试路径/用例） |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 本地项目管理 | 已有 | 高（作品丢失） | ✅（新建、改名、删除、恢复、搜索、刷新后仍在） | ❌ 缺口（IndexedDB 写失败时的界面提示） | 不适用 | ✅（删除先确认再进回收站，可恢复；项目面板删除二次确认；采用后可撤销；换项目取消失败中的一轮） | `tests/e2e/projects.spec.ts`（3 条）、`tests/e2e/files.spec.ts`（4 条）、`tests/e2e/agent.spec.ts`：`a round that is still running cannot write into another project`、`tests/e2e/issue-regressions.spec.ts`（换项目不串撤销、待写入先落盘、批量上传不丢文件）、`tests/e2e/dialog-buttons.spec.ts`（弹层主按钮不会被重置样式吞掉）、单元 `src/lib/project.test.ts` |
| 代码编辑 | 已有 | 低 | ✅（在「与代码」视图里看到项目内容；三块面板可收拢） | 不适用 | 不适用 | 不适用（持久化见上一行） | `tests/e2e/agent.spec.ts`：`an idea becomes a candidate, and the child adopts it`；`tests/e2e/layout.spec.ts` |
| 浏览器内运行 | 已有 | 中 | ✅（候选版本在舞台上跑起来，循环能拿到「在跑」证据） | ❌ 缺口（出错行定位） | 不适用 | 不适用（不改持久状态） | `tests/e2e/agent.spec.ts` 的每一条都要经过运行阶段；`src/lib/export.test.ts`（打包与模板）；`tests/e2e/issue-regressions.spec.ts`（停止/换项目取消启动中的预览、预览在独立来源的 iframe 里）、`src/lib/session.test.ts`（多标签页不清掉彼此的预览缓存）。画面本身与真实帧率仍需人工看 |
| 诊断与报错 | 已有 | 中 | ✅（小助手靠静态检查发现 time.sleep 并修好） | ✅ 单元 | 不适用 | 不适用（只读） | `src/lib/diagnostics.test.ts`（含没有 Traceback 抬头的语法错误）；`tests/e2e/agent.spec.ts`：`a candidate the checks reject is repaired before the child sees it`；`tests/e2e/issue-regressions.spec.ts`：`export build errors are reported in the Problems panel` |
| 本机日志与小助手错误详情 | 已有 | 中（看不懂失败、密钥进日志） | ✅（匿名打开「日志」，没有 `/api/` 请求；授权用户一轮结束后日志里有这一条） | ✅（上游 429：孩子看到「太忙」，点「查看详情」能看到 `requestId` 和状态码；页面和复制内容不含密钥） | ✅ 匿名可看日志 / 授权用户才会打到小助手 | ✅（清空前再问一次；失败不改作品，坏答案仍不写入） | `tests/e2e/logs.spec.ts`；`worker/index.test.ts`：`classifies a rate limit…`、`gives a refused sign-in a request id…`；`src/lib/log/journal.test.ts`；`src/lib/agent.test.ts`：`fails loudly when the model answer is unusable` |
| AI 游戏设计器（Agent 循环） | 已有 | 高（改动作品、消耗额度） | ✅（想法 → 候选 → 采用 → 撤销；第二轮在已采用的基础上继续改；图片输入） | ✅（坏答案不写入；静态问题先修；修复超限停下；中途取消；换项目不串写；越界路径、二进制素材、超大文件；图片类型/张数/大小） | ✅ 匿名 / 授权 / 已登录未授权 | ✅（采用后撤销；取消、失败、登录丢失后作品不变） | `tests/e2e/agent.spec.ts`（7 条）、`tests/e2e/attachments.spec.ts`（3 条）、`tests/e2e/ask.spec.ts`（3 条）、`tests/e2e/account.spec.ts`（6 条）、`src/lib/agent.test.ts`（15 条）、`src/lib/ai.test.ts`（12 条）；`worker/index.test.ts`：`ai gateway` |
| AI 讲解（只读） | 已有 | 低 | ✅（讲讲这段 → 对话面板里出现回答，项目不变） | ✅ 单元（模型没答好时显示「没想好」） | ✅ 匿名时不可用 / 授权可用 | 不适用（不写入） | `tests/e2e/account.spec.ts`：`allowed account: 讲讲这段 reads code and never rewrites the project`；`src/lib/ai.test.ts`：`asks for an explanation without allowing new files` |
| 声音生成 | 已有 | 中（消耗额度、噪音扰人） | ✅（音效与音乐生成 → 试听 → 保存到项目 → 撤销） | ✅ 单元（参数越界全部夹紧、非 JSON 拒绝、确定性渲染、循环长度与首尾无爆音、WAV 头） | ✅ 匿名不可用 / 授权可用 | ✅（接受前不写入，保存后可撤销） | `tests/e2e/sounds.spec.ts`（3 条）、`src/lib/audio/render.test.ts`（10 条） |
| AI 素材生成 | 已有 | 高（消耗额度、儿童内容） | ✅（生成 → 预览 → 放进项目 → 撤销） | ✅ 单元（未配置拒绝、上游失败不回显密钥、无图 502；去背景/裁剪/缩放像素级断言） | ✅ 匿名不可用 / 授权可用 | ✅（接受前不写入，接受后可撤销） | `tests/e2e/assets.spec.ts`（3 条）、`worker/index.test.ts`：`draws with Gemini…`、`tells the model what a sprite must not contain…`、`refuses to draw when the Gemini key is not configured`；`src/lib/sprite.test.ts` |
| 导入与导出 | 已有 | 中 | ✅（配方项目加上素材库副本、动画、地图、声音后，导出源码 zip 和网页 zip；文件在包里且 hash 与钉住的副本一致；不请求 GameKit 或素材目录。导入 zip 仍总是新建项目） | ✅（许可/来源为空或 hash 不符时构建中止。网页包断网打不开是已知限制，导出菜单写明了，没有假装离线能开） | 不适用 | ✅（素材库升级不改已导出的 zip，也不改项目里钉住的那一份；选保留后 zip 字节不变） | `tests/e2e/offline.spec.ts`：`a recipe project with library, animation, map, and sound exports offline`；`src/lib/offline.test.ts`；`src/lib/assets/validate.test.ts`：`a broken license or a bad hash stops the pack gate`；`src/lib/export.test.ts`。导入一份坏 zip 时的界面提示仍缺 |
| 部署 | 已有 | 高（线上不可用） | ❌ 缺口 | ✅（单元、类型、构建、E2E 任一失败则不部署） | 不适用 | ❌ 缺口 | `.github/workflows/ci.yml` |
| 登录与授权 | 已有（Access 应用已创建） | 高（权限） | ✅（本地替身登录） | ✅（错误签名/aud/iss/过期、配置缺失、本地替身出现在非 localhost） | ✅ 匿名 / 授权 / 已登录未授权 | 不适用（不改作品） | `tests/e2e/account.spec.ts`：`anonymous: …`、`signed in but not allowed: …`、`sign-out returns to the anonymous studio`；`worker/index.test.ts`：`identity gate`、`sign-in routes`。真实 Access + GitHub 登录 ❌ 待上线后人工验证 |
| 云端同步 | 未实现 | 高（作品丢失、权限） | ❌ 缺口 | ❌ 缺口 | ❌ 缺口 | ❌ 缺口 | 无 |
| PWA 与离线 | 未实现 | 中 | ❌ 缺口 | ❌ 缺口 | 不适用 | ❌ 缺口（更新失败回到旧版本） | 无 |
| MCP / WebMCP 外部协作 | 已有 | 高（外部写入、权限） | ✅（开启协作、显示状态与 MCP URL、外部提案生成候选、采用写入并支持撤销；授权用户检索素材目录、提议一份素材成为候选） | ✅（未登录拒绝开启、丢弃提案后项目不变、无效 Token 拒绝；没有令牌不能检索；不存在的素材 id 不产生候选；项目里已有同路径时不能盖掉） | ✅ 匿名页面可检索和做候选但不调 `/api/`；MCP 通道要令牌。已登录未授权沿用身份门拒绝 | ✅（丢弃提案项目不变；采用后可撤销；冲突的素材提议不写入） | `tests/e2e/collab.spec.ts`（4 条）、`tests/e2e/recipes.spec.ts`、`worker/mcp.test.ts` |
| 游戏配方与教程 | 已有（阶段 E） | 中（覆盖旧项目） | ✅（匿名从平台跳跃配方新建项目，舞台打出 `RECIPE-OK platform`；旧项目还在） | ✅（未改之前检查失败；改高了但控制台仍是旧标记也失败；`time.sleep` 失败） | ✅ 匿名可用，不发 `/api/`。已登录未授权仍可做配方。小助手对话仍要授权 | ✅（挑战候选在采用前不改 `JUMP`；丢掉后仍是 -9；采用后检查通过；撤销后再次失败） | `tests/e2e/recipes.spec.ts`；`src/lib/recipes/recipes.test.ts` |
| 内置素材库 | 已有（阶段 A：森林冒险，以及 Kenney CC0 的平台跳跃、迷宫地牢、太空射击、竞速、益智、界面、音效。跨项目个人图片未做；动画见阶段 B，地图见阶段 C，检索见阶段 E） | 高（覆盖作品、版权） | ✅（匿名浏览、筛选、预览许可与来源 → 复制进项目 → pygame 在舞台加载 → 源码包和网页包里都有这份文件；Kenney 地牢图块同样走这条路；加入时没有 `/api/` 请求；做成候选再采用也会复制；图块可开始画地图，角色帧可打开动画编辑器，音效可在声音编辑器试听） | ✅（同名先问再保留/另存/替换；重复复制不写第二份；hash 不符或许可/来源为空则校验失败，构建会被挡住；候选遇到不同字节则拒绝；瓦片网格对不上编辑器尺寸也不能构建） | ✅ 匿名可用。小助手和 WebMCP 不能在文件里写二进制，也不能改孩子手写的 `assets/library.json`；点名素材只进候选 | ✅（替换后撤销回到旧文件；复制后撤销去掉这份；删进回收站可以恢复；丢掉候选不留下文件） | `tests/e2e/library.spec.ts`；`tests/e2e/kenney.spec.ts`；`tests/e2e/recipes.spec.ts`；`src/lib/assets/*.test.ts`；构建时 `vite.config.ts` 的素材包检查 |
| 像素编辑器 / 新建图片 | 已有（单张图片的画笔、保存和撤销；多帧见下一行） | 高（覆盖孩子已有素材、作品丢失） | ✅（新建 → 画 → 保存 → 项目里出现 PNG、预览里 pygame 加载；打开已有 PNG → 改 → 保存 → 撤销还原；另存为新图片；触控与笔；导出包字节一致；生成素材继续改像素） | ✅（非法尺寸被拒；同名不覆盖、自动加序号；未保存关闭先问、继续画/不保存/保存；写入失败后画布保留、可重试；缓冲区/填充越界与死循环、PNG 往返逐字节、alpha 保持、解压体积受表头限制、撤销占用有上限的单元测试；生成素材里「保存并关闭」不会再弹出空的生成面板） | ✅ 匿名可用（不发任何 `/api/` 请求；不新增 AI 工具，小助手与 WebMCP 没有改 assets/ 的能力） | ✅（写入失败不留半成品，重试成功；覆盖可用工作室撤销还原；新图保存后可撤销） | `tests/e2e/pixel.spec.ts`（14 条）；`src/lib/pixel/*.test.ts`（单张图画笔仍由 `buffer`、`png`、`rules`、`history`、`session`、`save`、`export` 覆盖；多帧见下一行） |
| 精灵与动画编辑器 | 已有（阶段 B） | 高（覆盖已有素材、帧和说明对不上） | ✅（匿名：画多帧 → 设时长和动作 → 保存 → 重新打开后帧序和时长还在 → PNG 与 JSON 的像素、alpha、帧序可比对 → 源码包里两份文件都在 → pygame 在舞台打出 `ANIM-OK` 和 `ANIM-PIXEL`） | ✅（坏的动画说明按整张图打开且不改文件；写入失败时 PNG 和 JSON 都不留下，画布还在，重试成功；选区移动、图层显隐、洋葱皮、复制/删除帧、精灵表导入可撤销） | ✅ 匿名可用，不发 `/api/`。小助手和 WebMCP 不能改写 `*.anim.json` | ✅（失败写入不留半成品，重试成功；试播先确认，工作室撤销回到试播前的代码，精灵表还在） | `tests/e2e/anim.spec.ts`；`src/lib/pixel/anim.test.ts`、`film.test.ts`、`save.test.ts`；`src/lib/ai.test.ts`；`worker/mcp.test.ts` |
| 瓦片地图编辑器 | 已有（阶段 C） | 高（覆盖已有关卡、半截文件） | ✅（匿名：画关 → 碰撞、出生点、物件 → 保存 → 重新打开还原 → 导出地图包再导入一致 → 源码包里有 JSON/CSV/PNG → pygame 打出 `MAP-OK` 碰撞和出生点；加入时没有 `/api/` 请求） | ✅（非法地图说明原因且原文件不变；写入失败时不留半截文件，画面还在，重试成功） | ✅ 匿名可用，不发 `/api/`。小助手和 WebMCP 不能改写 `*.map.json`、`maps/*.csv`、`*.tileset.png` | ✅（失败写入不留半成品，重试成功；试玩先确认，工作室撤销回到试玩前的代码，地图文件还在） | `tests/e2e/map.spec.ts`；`src/lib/map/*.test.ts`；`src/lib/ai.test.ts`；`worker/mcp.test.ts` |
| 音效编辑器 | 已有（阶段 D） | 中（覆盖作品、噪音、格式播不出） | ✅（匿名：选预设 → 波形和包络 → 试听的 WAV 与保存的字节相同 → 撤销去掉；官方音效进素材库 → pygame 打出 `SOUND-OK` → 源码包和网页包里都是这份 WAV；收录进本机素材库） | ✅（坏 WAV / MP3 在问题里说明；写入失败时项目不变，再试能保存） | ✅ 匿名可用，不发 `/api/`。生成参数仍要登录。小助手和 WebMCP 不能改 `*.wav` / `*.ogg` / `*.mp3` / `*.aiff` | ✅（保存后可撤销；写入失败不改项目） | `tests/e2e/sounds.spec.ts`；`src/lib/audio/*.test.ts`；`src/lib/assets/validate.test.ts`；`src/lib/diagnostics.test.ts`；`src/lib/ai.test.ts`；`worker/mcp.test.ts` |

缺口的最低期望：

- **E2E 基础设施：** 已搭好（Playwright，`tests/e2e/`，生产构建 + `vite preview`，替身模型 `tests/e2e/mock-model.mjs`
  能按请求类型回答设计卡、文件、修复与讲解）。下一步是给「看到游戏画面」加一条断言（需要 pygame-web CDN）。
- **本地项目管理：** IndexedDB 写失败时界面提示且内存中的内容不丢（现在只把顶栏状态改成「没有保存成功」）；
  素材上传与导入的进度提示。
- **左栏：** 文件多到需要滚动的时的分组与搜索；长按/右键菜单。
- **浏览器内运行：** 运行起始示例、停下、再次运行；运行一个有语法错误的项目时出错行被定位。
- **小助手：** 模型回答很慢时的表现（现在的反馈只有“小助手正在忙…”）；
  同一轮里设计卡被孩子改过之后再制作的路径。常见报错已有一句孩子的话，原文收在「原来的报错」。
- **AI 素材：** 同一角色多张一致性的变体（现在每张都是独立的）；精灵表（多帧动画）导出。（生成结果已能在弹层里「继续修改像素」。）
- **登录与授权：** 上线后用真实 GitHub 账号走一遍登录、被拒、退出；Access 会话过期后的表现要与 E2E 一致。
- **云端同步：** 两台设备冲突保留两份；网络中断后本地不受影响、恢复后能续传；一个用户读不到另一个用户的项目。
- **WebMCP：** 未登录时只读工具可用、AI 类工具被拒绝；写入类工具在人点「采用」前不改项目，拒绝后项目不变。
- **部署回滚：** 写明出问题时如何回到上一个版本（例如 `wrangler rollback`）并演练一次。

「不适用」的理由已写在单元格里：只读功能不改持久状态；导入、配方、教程总是新建项目，不覆盖已有作品。
