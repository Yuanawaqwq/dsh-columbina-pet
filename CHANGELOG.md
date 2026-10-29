# 更新日志

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
