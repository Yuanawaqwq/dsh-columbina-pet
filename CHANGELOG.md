## 1.0.4 — 2026-10

与上游 `dsh-pet` 并存（命名空间彻底拆开）。

- **宿主路由**：`/dsh-pet-7340` → `/dsh-columbina-pet-7340`；旧前缀仍尝试注册（被上游占用则静默跳过），旧书签/旧客户端不会 404。
- **bridge**：自定义 scheme、管道前缀、`PET_ROUTE` 全部改为 `dsh-columbina-pet-bridge`（URL host 也改为 `dsh-columbina-pet`）。
- **用户目录**：`$DSH_HOME/dsh-pet` → `$DSH_HOME/columbina-pet`，首次启动自动迁移（新目录已存在则不动）。
- **会话身份**：`PET_CALL_IDENTITY` 由 `dsh-pet` 改为 `dsh-columbina-pet`，与上游的会话/通知互不串台。
- **本地素材通道**：voice sidecar 新增 `runtime://` → `blob:` 代理（仅当素材地址以该 scheme 下发时生效），避免外置素材下 `<video src>` 静默黑屏。

升级后请**完整退出 DSH 再打开**；若桌宠之前与上游装在一起，现在可以同时启用。

# 更新日志

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
