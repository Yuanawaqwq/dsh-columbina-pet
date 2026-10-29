# 素材与版权声明（NOTICE）

本仓库包含三类内容，适用不同的许可：

## 1. 代码 —— MIT

插件骨架、runtime、构建脚本与文档以 MIT 许可发布，见 [LICENSE](LICENSE)。

- Copyright © 2026 PC2005-cloud（上游 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet)）
- Copyright © 2026 Yuanawaqwq（dsh-columbina-pet：2D 专用分支、语音与天气扩展）

## 2. 《原神》角色相关素材 —— 权利归米哈游

以下内容基于米哈游（miHoYo / HoYoverse）《原神》的角色形象与官方语音二次加工，其角色、名称、美术与语音的版权归米哈游所有，**不属于本仓库的 MIT 许可范围**：

| 路径 | 内容 | 来源 |
| --- | --- | --- |
| `assets/webm/` | 四套 2D live 形象动作（246 个 webm） | 官方立绘 / 表情包素材二次处理 |
| `assets/memes/` | 12 张时刻表情包 | 社区二创 / 官方表情包 |
| `runtime/electron-helper/voice/official/` | 76 句官方语音（中 / 日 / 英） | 游戏内官方语音切片 |
| `runtime/electron-helper/voice/clips/` | 语音索引所用的音频切片 | 同上，按台词分段 |
| `assets/logo.png`、`assets/preview/` | 插件图标与预览图 | 基于角色形象制作 |

其中「去眼罩 / 睁眼 / 闭眼」三套形象素材由 B站 UP 主 **@渲琳**（uid 39497551）使用 EmoteLab 制作，原作视频：[【EmoteLab】捏了哥伦比娅和桑多涅！](https://www.bilibili.com/video/BV1gSczzjEub)。作者已公开分享，本仓库仅作个人非商用收录并以署名致谢；如作者希望下架，请联系移除。

本仓库对这些素材**不提供任何形式的授权**，仅作为个人学习与非商业展示的同人作品分享。如果你是权利人并希望删除相关内容，请开 Issue，我们会尽快移除。

**如果你要二次分发或商用**：请把上述目录替换为你自己拥有权利的素材（可以保留目录结构与文件名），并删除本仓库中的角色素材。

## 3. 字体 —— 上首软糖体

`assets/fonts/上首软糖体.ttf` 是「上首字体」出品的商业字体，版权归其作者所有，本仓库不附带其授权。

- 仅随插件用于本地渲染气泡文字；
- 如需公开分发或商用，请自行向上首字体购买授权，或替换成你有权使用的字体（同时修改 `assets/config.jsonc` 中的字体名）。

## 4. 第三方依赖

运行时依赖 Electron、OpenAI / Anthropic SDK、open-meteo、ipwho.is 等第三方服务与库，各自遵循其许可与服务条款。本插件不收集、不上传任何 DSH 数据；天气功能仅向上述两个公开接口发起地理位置与天气预报查询。
