# 素材来源

内置素材库里的官方精选，除了 GameKit 自己画的森林，都来自 [Kenney](https://kenney.nl/assets)。Kenney 这些包以 [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/legalcode) 贡献到公共领域。使用时不要求署名。GameKit 仍然记下作者、原包链接和内容 hash，缺了许可或来源就不能构建。

每个主题只收了原包里风格协调的一小部分：角色、地形或瓦片、道具、特效、短音效。没有整包搬进来，也没有热链接到 kenney.nl。复制进项目的是文件本身，运行和导出都不访问外网。

| 包 | 主题 | 文件数 | 原包 |
| --- | --- | --- | --- |
| `kenney-platform` | 平台跳跃 | 11 | [Pixel Platformer](https://kenney.nl/assets/pixel-platformer) |
| `kenney-dungeon` | 迷宫地牢 | 7 | [Tiny Dungeon](https://kenney.nl/assets/tiny-dungeon) |
| `kenney-space` | 太空射击 | 9 | [Pixel Shmup](https://kenney.nl/assets/pixel-shmup) |
| `kenney-racing` | 竞速 | 11 | [Pixel Vehicle Pack](https://kenney.nl/assets/pixel-vehicle-pack) |
| `kenney-puzzle` | 益智 | 4 | [Sokoban](https://kenney.nl/assets/sokoban) |
| `kenney-ui` | 界面 | 13 | [UI Pack](https://kenney.nl/assets/ui-pack)（只要蓝色默认样式） |
| `kenney-sfx` | 音效 | 15 | [Kenney 素材](https://kenney.nl/assets) 里的短声音。每条声音的来源指向它自己的原包：Digital Audio、Impact Sounds、Interface Sounds、RPG Audio、Sci-fi Sounds |

音效是原来的 OGG Vorbis，没有转码。文件头里要能认出 Vorbis，构建才会通过。

有三处为了接上现有编辑器，动过像素，说明写在包的署名里：

- 平台跳跃的地形是原来的 18 像素单张图。地图编辑器只收 8、16、32 像素的方格，所以这些地形不进地图调色板。
- 迷宫地牢和太空射击的图块是原来的 16 像素，排成 4×4，地图编辑器可以直接用。地牢包没有单独的角色图。
- 益智图块从 Sokoban 的 64 像素用最近邻缩到 32 像素。推箱子的人仍是 64 像素，四帧排成精灵表。
- 竞速的人原来每帧宽窄不一样，这里放进同样的 16×16 透明格子，脚对齐到底边，动画编辑器才能打开。车还是原来的大小。

GameKit 自己的「森林冒险」和「森林声音」不是 Kenney 的图，作者是 GameKit，许可同样是 CC0。
