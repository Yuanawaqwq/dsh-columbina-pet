## 1.0.4 — 2026-10

与上游 `dsh-pet` 并存（命名空间彻底拆开）。

- **宿主路由**：`/dsh-pet-7340` → `/dsh-columbina-pet-7340`；旧前缀仍尝试注册（被上游占用则静默跳过），旧书签/旧客户端不会 404。
- **bridge**：自定义 scheme、管道前缀、`PET_ROUTE` 全部改为 `dsh-columbina-pet-bridge`（URL host 也改为 `dsh-columbina-pet`）。
- **用户目录**：`$DSH_HOME/dsh-pet` → `$DSH_HOME/columbina-pet`，首次启动自动迁移（新目录已存在则不动）。
- **会话身份**：`PET_CALL_IDENTITY` 由 `dsh-pet` 改为 `dsh-columbina-pet`，与上游的会话/通知互不串台。
- **本地素材通道**：voice sidecar 新增 `runtime://` → `blob:` 代理（仅当素材地址以该 scheme 下发时生效），避免外置素材下 `<video src>` 静默黑屏。

升级后请**完整退出 DSH 再打开**；若桌宠之前与上游装在一起，现在可以同时启用。

# 更新日志

## 1.1.12 — 2026-10

- **余额查询不再被 API Key 卡住**：默认模型挂在 API Key 版服务商（`deepseek-official`）而本机是账号登录时，宿主会先按 ref 取 `DEEPSEEK_API_KEY` → 直接 `credential-missing`（界面显示「缺少凭证 DEEPSEEK_API_KEY」）。现在缺凭证时自动退到账号余额（`deepseek-account`），账号那条失败信息（未登录 / 授权过期）比「缺少凭证」好懂；网页模式走同一个 `refreshBalance`，一并修好
- **待机动作可选**：右键「待机动作」切 精选 / 当前形象全部动作 / 自己选；「自己选…」打开设置面板里可搜索的勾选列表（去眼罩、带眼罩睁眼各 82 段，带眼罩闭眼 65 段，官方表情包 17 段），勾了哪几段就只轮播哪几段，立即生效
- **待机动作不再「卡」**：之前名字里带「待机」的片段被拉到 20 秒循环，2.4 秒的官方待机片段等于 0.12×（约 3.6 fps），看着一顿一顿。现在统一 0.6×，重复交给轮播节奏
- **精选待机池扩容**：从 2 段扩到 官方 9 / 去眼罩 12 / 睁眼 12 / 闭眼 10 段，90 秒一轮不再来回只切两个动作
- **省电模式真的会停**：旧实现只暂停 `loop` 的视频，而待机是 one-shot（`loop=false`）播放，等于什么都没停。现在鼠标 30 秒不动就暂停所有正在播的视频，并拦住宿主推来的新动作，动一下鼠标立刻恢复
- **夜间勿扰时段**：22:00–07:00 / 23:00–08:00 / 00:00–09:00 / 01:00–10:00 四档（支持跨零点），时段内碎碎念自动闭嘴，手动点台词不受影响
- **音量与一键静音**（桌面 + 网页）：静音开关 + 20/40/60/80/100 % 五档，和语音设置存在同一个 localStorage 键
- **语音包与素材检查 / 一键修复**：宿主新增 `GET /voice/health` 与 `POST /voice/repair`（返回语音包、webm、表情包的目录/数量/体积），网页面板多出「语音包与素材」区块，缺文件一键重下
- **网页天气城市名本地化**：ipwho.is 只给英文城市名，现在走 open-meteo geocoding（`language=zh`）并缓存 6 小时；定位结果带经纬度，二次查询不再重新定位
- 素材仍是 1.1.11 的原始 webm（147 MB），本版**没有**做有损压缩：`scripts/shrink-webm.mjs` 留作可选工具

## 1.1.11 — 2026-10

- `/healthz` 的 `version` 改为**请求时读磁盘** `package.json`，并新增 `activatedVersion`（插件激活那一刻读进内存的版本）与 `buildSha256`（磁盘 `lib/index.js` 的 sha256，按 `mtime:size` 缓存）——以后半装或换包没重启，一眼能看出来，不必再靠 `sha256sum` 手比
- `scripts/ensure-voice.mjs` 增加**总预算 + 停滞检测**：默认 120 s 总预算，另有 20 s 没有新字节就直接换下一个镜像（`DSH_COLUMBINA_VOICE_STALL_MS` 可调），失败不留半截文件
- 发布包去掉 `src/`（`files` 与 `exports` 里同一条移除）：npm 形态条目 607 → 465，tarball 148.56 MB → 148.11 MB；`src/` 只是 TS 参考，仓库里仍保留
- 路由路径解码改为容错：非 UTF-8 的百分号编码（例如 Windows 控制台 curl 按 GBK 送的 `晚安`）不再让整条路由 500，降级成 404
- 1.1.10 的 CHANGELOG 补了一句影响面：只影响网页模式面板，桌面端始终正常

## 1.1.10 — 2026-10

- 宿主 `GET /voice-prefs` 增加一次性迁移：读到没有 `prefsRev` 标记、且 `lines` 恰好是 `[0]` 的旧文件时，还原成 `null`（全选），并把标记补写进 `prefs.json`
- 宿主 `POST /voice-prefs` 落盘时带上 `prefsRev: 2`，此后不再重复迁移
- 背景：`1.1.9` 之前网页面板的「全不选」写的是 `lines: [0]`（= 只念第 0 句），凡是点过的人网页端都只剩第一句；桌面端因为先用 `localStorage` 里的 `lines` 并带 `localAt` 时间戳比较，看起来一直是好的
- 影响面：只影响网页模式的面板；桌面端始终正常。升级后打开一次网页端就自动修复（`prefs.json` 里出现 `"prefsRev": 2` 即已迁移），不需要手动改文件

## 1.1.9 — 2026-10

- 网页模式「碎碎念」不再连着说同一句：最近说过的 6 句进排除表，池子够大时必换
- 网页模式右键菜单补齐桌面版的两项：
  - **原声台词**：全选 / 全不选 / 逐句挑（写进 `prefs.json` 的 `lines`，与桌面面板共用）
  - **表情包时刻**：随机一张贴纸配一句，最近贴过的 6 张不重样
- 顺手：`lines` 为空数组表示「一句都不念」，全不选之后不会偷偷回落到全量

**网页模式菜单整体对齐桌面**

- 顺序与文案一致：查看余额 / 闲暇一下 · 娅娅的表情包时刻 / 对话 / 切换间隔 / 2D live 形象 / 语言 / 模型大小 / 天气 / 回到初始位置 / 显示位置 / 设置面板 / 动作 / 更多 / 原声台词 / 碎碎念设置
- 网页独有项收进合适位置：`显示位置` 紧跟「回到初始位置」，`设置面板` 排在它后面
- 三语表补齐到与桌面 `MENU_I18N` 同口径，`当前：` 前缀按词替换而不是整句匹配
- 新增「切换间隔」：0 秒 = 动图放完立即切，最长 60 秒；写 `localStorage`（宿主偏好白名单不接受新键）
- 天气补「重新定位」，hint 显示当前城市；设置面板里「重新定位」不再写一个宿主会丢掉的 `city` 字段

**修复**

- 干活中的工作气泡常驻，把说话气泡压在下面 —— 播原声台词 / 碎碎念时**有声音、没字幕**。说话气泡改为最高优先，与桌面同一套单槽规则
- `triggerWhisper` 在 `animations.events.whisper` 池缺失时直接 `return`，连文字都不写；改为只跳过动画
- 网页字幕只挂在 `loadedmetadata` 上，事件没来就永远不弹；加 `shown` 闸门与 2.6 秒兜底，丢弃时打 `[dsh-pet] 字幕丢弃 …`
- 面板「全不选」原本写 `lines: [0]`（= 只念第一句），改为 `[]`；「全选」写 `null`，宿主 `POST /voice-prefs` 现在接受并落盘
- 面板台词行显示「已选 N/76」，一眼看出当前勾了几句

**桌面**

- `showWhisper` 缺 whisper 动画池时同样改为只跳过动画、气泡照弹（与网页一致）

## 1.1.8 — 2026-10

网页模式（「显示位置 = 仅网页」）补齐到能用，顺手修掉三处会影响体验的缺陷。

**网页模式新增**
- 声音：右键菜单「声音」→ 播一句 / 天气 / 开关 / 间隔 / 配音 / 字幕；音频走宿主 `/voice/official/`（ETag 复用），字幕复用气泡
- 天气：先「让我看看今天的天气…」，再播摘要，再用官方原声念一句；城市按 IP 定位并提供「重新定位」
- 四套 2D live 形象：切换即换动画树，选择记进 `prefs.json`
- 菜单三语：中 / 日 / 英即时切换（只覆盖已知项，未登记的动作名保持中文）
- 设置面板：碎碎念开关与间隔、配音/字幕/菜单语言、模型大小 50–300%、四套形象、76 句台词勾选、天气城市与播报

**修复**
- 网页拖拽越界：拖拽目标、弹簧、提交、渲染全部与物理投掷同源夹取（`petDragBox()`），窗口外松手也有 `blur` / `pointercancel` 兜底
- 设置面板只剩遮罩不出卡：`react/jsx-runtime` 的 `jsx(type, props, key)` 第三个参数是 key，面板子树被当成 key 吞掉；改为 `props.children` 传递
- 台词勾成「一句都不选」后再播报会偷偷回落到全量，改为保持安静

**其它**
- `scripts/ensure-voice.mjs` 下载超时默认 15 分钟 → 120 秒（`DSH_COLUMBINA_VOICE_TIMEOUT_MS` 仍可覆盖）
- 40 处 `dsh-pet: ` 错误前缀与精简模式窗口标题改为本插件命名

已知：`src/client/pet.ts` 仍是参考源码，网页模式这批改动只落在 `lib/client.js`（仓库无构建步骤，运行即用）。


## 1.1.7 — 2026-10

1.1.6 的语音路由修了渲染端、漏了宿主端，两处拼错让原声继续 404。这一版按复现反馈逐行修掉。

- `lib/index.js` 的 `voice` 路由：`rest` 里已经带一层 `official`，后接的目录本身又以 `official` 结尾，拼成 `…/official/official/…` 必然 404；改为先剥掉重复段再解析
- 同一处原来直接 `return sendFile(voiceFile)`，函数签名是 `(res, file, contentType, req)`，等于把路径当响应对象；改为返回 `{ kind: "file", file, contentType }` 描述符，交给统一出口发
- `.ogg` 补进音频 MIME（`audio/ogg`），不再落到 `application/octet-stream`
- `scripts/ensure-voice.mjs`：`fetchTo()` 增加 `AbortSignal.timeout`（默认 15 分钟，可由 `DSH_COLUMBINA_VOICE_TIMEOUT_MS` 覆盖），连接卡死不会再永久 `downloading: true`
- 移除 `lib/standalone.js`：上游遗留的独立运行打包产物，本 fork 从未同步，也没有任何入口引用它；需要独立模式请用 `src/standalone` 重新构建

## 1.1.6 — 2026-10

修掉 1.1.5 在干净安装下的回归：语音包外置了，播放端却还在按包内相对路径找文件。

- 渲染端优先用宿主 HTTP 基准取官方原声（`/dsh-columbina-pet-7340/voice/official/`，与 `configUrl` 同源），包内相对路径仅作兜底
- 宿主新增 `voice` 路由，从 `~/.dsh/columbina-pet/voice/official` 读文件，复用 `sendFile` 的 ETag/304
- 加载失败时标记一次并回退包内切片，不再出现「气泡在、没声音」；`/healthz` 字段不变
- 兼容旧安装：包内还留着 `voice/official` 的照旧可用（迁移逻辑仍是单向 → 外置）

## 1.1.5 — 2026-10

语音包落到包外，面板几何跟着窗口走。

- **语音包装到外置目录**：`~/.dsh/columbina-pet/voice/official`，`dsh plugin add` 换包不再重下 33 MB；旧的包内目录启动时自动迁移一次
- **下载失败可见**：`/healthz.voicePack` 新增 `lastError` / `lastAttempt`，不再只有一句 `active:false`
- **镜像兜底**：`ensure-voice.mjs` 依次尝试 GitHub → `ghfast.top` → `gh-proxy.com`，仍用 `voicePack.sha256` 校验
- **面板跟随窗口移动**：桌宠被拖动/漫游后重算可见区，面板不会留在屏外；竖直方向保留可拖余量（不再只能左右拖）

## 1.1.4 — 2026-10

设置面板与右键菜单的边界问题收尾，语音包资产补发。

- **面板能关了**：打开时由主进程接管焦点（`showInactive` 窗口渲染端 `focus()` 无效），`Esc`、点面板外、切到别的窗口都会关闭。
- **面板能拖了**：拖标题栏可在屏幕可见区内移动卡片，不被宠物窗口边界钉死。
- **左右也夹取**：卡片横竖都按「窗口 ∩ 屏幕工作区」定位，宠物贴右边时不再被裁。
- **右键菜单**：列宽与首级面板都夹进可见矩形，窄窗或贴边时不再溢出屏幕。
- **语音包资产**：`voicePack.url` 指向 `v1.1.4` 的语音包附件（33 MB），修复 1.1.3 里「外置了但 release 没资产」的 404。

## 1.1.3 — 2026-10

面板跟随屏幕可见区。

- **贴底不裁切**：卡片按「桌宠窗口落在屏幕内的那段」定高并贴顶，宠物沉到任务栏附近时面板也不会下半截跑到屏幕外。
- 空间不足时卡片自动收缩，内容区可滚动，标题与关闭按钮始终可见。

## 1.1.2 — 2026-10

修复内置设置面板在真实桌宠窗口里的三处问题。

- **点击可用了**：面板打开期间，登记卡片矩形为鼠标可点区域；此前整窗处于点击穿透，面板上的按钮与滑块收不到点击。
- **不再挡桌面**：面板外区域继续穿透，鼠标滚轮与点击照常落到下层窗口（之前会整窗吃掉输入）。
- **不再出「黑框」**：去掉全窗半透明遮罩，只留悬浮卡片本身；此前遮罩会把下层文字透出来，看起来像一块黑框。
- **窄窗自适应**：卡片宽度改为 `min(392px, 100vw - 16px)`，桌宠缩放到 125% 及以上时不再左右裁切。

## 1.1.1 — 2026-10

设置面板不再依赖主题。

- **内置设置面板**：「打开设置」直接在桌宠窗口里弹出面板（碎碎念开关与间隔、配音/字幕/菜单三语、模型大小、2D live 形象、逐句勾选原声台词、天气定位与播报），改完即生效并记进本机偏好。
- **主题可关**：以前这条通道由 `dsh-columbina-theme` 提供，主题关掉或没装时点了没反应；现在不再向主题宿主转发。
- **台词勾选本地持久化**：勾选结果写进 `columbina-voice-local-v1`，重启后保留。

## 1.1.0 — 2026-10

包体瘦身与共存体验。

- **语音包外置**：`runtime/electron-helper/voice/official`（约 33 MB，76 句 × 3 语种）不再随包发布；首次启动检测缺失时后台自动下载到安装目录，失败则按「无原声」降级（切片兜底仍在包内）。手动补装：`node node_modules/dsh-columbina-pet/scripts/ensure-voice.mjs`，可用 `DSH_VOICE_PACK_FILE` 指定本地包。
- **旧前缀默认关闭**：`/dsh-pet-7340` 兼容路由改为显式开启（`DSH_PET_LEGACY_ROUTE=1`）。与上游 `dsh-pet` 同装时默认零冲突，也不再尝试抢占它的用户目录。
- **上游检测放宽**：除 `dsh-pet` 外，`dsh-pet-*`（如 `dsh-pet-live2d`）同装也按「共存模式」处理，避免别人的前缀注册被我们打断。
- `/healthz` 增加 `voicePack`（`active` / `dir` / `downloading`）。
- 附：`scripts/shrink-webm.mjs` 用于把换装 webm 重编码到更小体积；**本版本的 webm 不做改动**（本机 ffmpeg 构建无法写 alpha 侧信道，重编码会丢透明通道，故保留原件）。

## 1.0.3 — 2026-10

对 1.0.2 的修补（由第三方复现报告驱动）：

- `package.json#files` 改为收录整个 `scripts/`：此前 `scripts/migrate-assets.mjs` **没有进 tarball**，从 npm 包安装的用户拿不到素材迁移脚本。
- `lib/client.js` 内置 3 行幂等守卫（`__dshColumbinaClientBooted`）：DSH 启动期若把同一份 bundle 执行两次，不再重复注册而抛 `duplicate factory registration`。
- 静态素材响应加 `ETag` + `If-None-Match` / 304：替换外置素材后不会再被浏览器缓存卡旧文件。
- `/healthz` 增加 `assetRoots.externalActive` 与 `assetRoots.externalFileCount`，迁移是否生效一眼可见。
- 顺带说明：`lib/standalone.js` 仍停留在 1.0.1 的构建产物，本次未同步（该形态暂不维护）。

## 1.0.2 — 2026-10

启动与诊断加固（不改变桌宠行为）：

- Electron 准备改为幂等：可执行文件可用就直接复用，不重装、不联网；半截/空壳文件只删该文件后重新解压，避免把「损坏的 exe」当成已安装。
- 下载失败自动重试 2 次；最终失败写入 `~/.dsh/columbina-pet/launch-error.json`，方便用户把原因贴到 issue。
- 新增 `GET /dsh-pet-7340/healthz`：返回版本、Electron 路径、Helper 是否在跑、素材根、最近的启动错误。
- `resolveElectronPath()` 增加可用性校验与 `DSH_ELECTRON_PATH` 候选，避免拿到 0 字节文件后 spawn 失败。
- 新增可选的素材外置根 `~/.dsh/columbina-pet/assets`：存在同名文件时优先于包内 `assets/`（形象、表情包、字体、图片、config 均适用）。
- 新增 `node scripts/migrate-assets.mjs [--move]`：把包内素材搬到外置根，便于瘦身/备份。

## 1.0.1 — 2026-10

修复在 DSH 0.2.1-rc.3 上安装后无法启动的问题（`web boot: 1 entry did not activate` / `dsh-columbina-pet: import failed`）。

- **根因**：`lib/client.js` 沿用了上游的模块 id `dsh-pet`，与包名 `dsh-columbina-pet` 不一致。DSH 的 client-modules 以包名作为组合表 key，bundle 自报 id 对不上时 entry 无法激活；启动期同 bundle 被加载两次还会先撞 `duplicate factory registration`。
- **修复**：client bundle 的注册 id 改为 `dsh-columbina-pet`（`lib/client.js`、`src/client/index.ts` 同步）。
- `dsh.compatibility.dshReleases` 补 `0.2.1-rc.3: compatible`。
- README 增加警告：**不要与上游 `dsh-pet` 同时安装**（两者都注册桌宠窗口与 `/dsh-pet-7340` 路由）。

## 1.0.0 — 2026-10

首个开源版本，基于 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 0.3.8 的 2D 专用分支。

**本版内容**

- 四套 2D live 形象（官方表情包 / 去眼罩 / 带眼罩睁眼 / 带眼罩闭眼），共 246 个动作素材
- 76 句哥伦比娅官方语音，中 / 日 / 英三语、94 段切片，「有声音必有字幕」
- 按场景碎碎念：十组场景池，按时间与近期出镜率抽签，不与工作气泡抢位
- 天气播报：IP 定位 + open-meteo 预报，菜单「天气 → 今天的天气 / 重新定位」，断网有兜底
- 12 张时刻表情包，按台词标签触发
- 真实物理：拖拽甩动、重力下落、落地回弹、窗口贴边
- 菜单即设置：切换间隔、形象、语言、模型大小 0.5–3×、原声台词勾选、碎碎念开关
- 插件化安装：`cordis.patch.yml` + `dsh.profile.bundles`，完整退出 DSH 后生效

**相对上游的改动**

- 移除 3D 形象切换（含主进程 spawn、preload IPC、精灵菜单项与语音菜单改名）
- 新增天气播报模块与天气菜单
- 新增 `README.md`、`NOTICE.md`、`.gitignore`、`.gitattributes` 与包图标
- 包名改为 `dsh-columbina-pet`，版本从 1.0.0 起
