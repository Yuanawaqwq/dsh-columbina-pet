# 更新日志

## 1.2.6 — 2026-11-18

- **切换间隔改无缝循环（`runtime/electron-helper/voice/voice.js`，`installAnimPacing`）**：旧实现是 `handleEnded` 里 `el.currentTime = 0; el.play()` 从头重播——每圈都要 seek、重开解码，环点就是「卡一下/黑一下」。现在 `armPace(self, wait)` 在 `playOnce` 之后（`sprite.js:597` → `switchTo`）给**即将成为前台**的缓冲挂 `el.loop = true`，`setInterval(...,120)` 巡检 `__columbinaPaceUntil`，到点 `stopPace()` 摘 loop 并置 `__columbinaPaceDone = gen`；`handleEnded` 首行 `if (self.__columbinaPaceDone === self.gen) { self.__columbinaPaceDone = 0; return orig.call(self); }` 让这一遍自然走原逻辑切下一段。原 `__columbinaDwellGen/__columbinaDwellUntil` 分支保留为兜底（loop 没挂上时仍 seek 重播）。`gen` 初值 0、`switchTo` 里 `++this.gen`（`sprite.js:511`），`armPace` 看到的恒 ≥1，`__columbinaPaceDone = 0` 不会误命中
- **停留语义变化（设计取舍，未做补偿）**：旧 = `1 + ceil(wait/dur)` 圈（从**第一遍播完**起算 wait），新 = `floor(wait/dur) + 1` 圈（从**开播**起算、到点摘 loop）。wait=2000、待机 0.6×（素材 2–3 s → 实际 3.3–5 s）时旧约 2 圈 6.6–10 s、新约 1 圈 3.3–5 s。**判断是保留新语义**：设置项字面就是「间隔」，旧语义下 wait=0 与 wait=2000 几乎无差别、设置基本无效；新语义下用户能真正调速，想要旧观感把间隔调到 3000–5000 即可。若日后要精确找平：`need = dur * Math.ceil(wait / dur)`（`dur` 要在 `armPace` 时可读，注意双缓冲复用时 `el.duration` 可能是上一个素材的）
- **网页端对齐同一套（`lib/client.js` 的 `PetCard`）**：新增 `dwellTimerRef / dwellElRef / dwellDoneRef` 与 `stopDwell()` / `armDwell(el, gen)`；`onReady` 里 `el.play()` 之后 `if (nextOnce) armDwell(el, gen)`（只能用 `el` 本身，不能按 `frontRef` 反查——翻前台就发生在 `onReady` 里）；`switchTo` 的 `++genRef.current` 之后 `stopDwell()`；改档位（`web-anim-interval`）与卸载 cleanup 也收环。`holdForDwell()` 首段加 `if (dwellDoneRef.current !== 0 && dwellDoneRef.current === genRef.current)`（**必须比对 gen**：拖拽/锁定期间 `handleEnded` 会提前 return，只判非零会让残留标记吞掉下一段），老的 seek 重播降级为 `replayFront()` 兜底
- **天气（`voice.js`）**：`fetchWeatherJson` 改 `fetchJson(url,8000)` → 400 ms → `fetchJson(url,4000)`；`speakWeather` 挂 `setTimeout(...,4000)` 中间态（zh「云有点厚，再等等…」/ en "The readings are slow to come... give me a moment…" / ja「雲が少し厚いみたい、もう少し待ってね…」），`.then` / `.catch` 首行 `clearTimeout(reassure)`；失败气泡 4200 → **5600 ms**，并挂 20 s 后台重试；`weatherAgeText` 改「（旧数据 · HH:MM）」/ " (older reading, HH:MM)" / 「（古い記録・HH:MM）」；stale 时 8 s 后台 `readWeather({fresh:true})`
- **诊断日志开关进配置（`lib/index.js`，`diag-helpers`）**：新增 `let DIAG_LOG_FROM_CONFIG = ""`，`diagLogPath(env)` 先读 `DSH_PET_DIAG_LOG`、再退回它；`applyDiagLogSetting(file)` 把 `diagLog` 解析成路径——`true` → `join(dshHomeDir(),"columbina-pet","diag.log")`；字符串按 `^([A-Za-z]:[\\/]|/)` 判断绝对/相对（相对落在 `columbina-pet/` 下）；其它/读失败 → `""`（关闭）。`apply()` 里紧跟 `userRoot` 计算后调用，早于 `startHelper()`。`saveUserConfig` 保留顶层未知键，`PUT /config` 不会抹掉 `diagLog`
- **网页端碎碎念配图回归修复（`lib/client.js`，`//#region src/shared/whisper.ts` 段）**：1.2.5 把碎碎念改成独立字幕浮层（`showWhisperSubtitle`）后只写了 `textContent`，`image` / `url` 不再有人画，`WhisperBubble` 组件也从渲染树里删掉了（`lib/client.js:8019` 的注释），于是只有网页模式丢图（桌面 `voice.js` 的 `showBubble` 自己拼图文）。新增 `whisperSubtitleImage(image, url, assetRoot)`（`url` 非空优先，否则 `memeImageUrl(key, "/dsh-columbina-pet-7340", assetRoot)`，都空返回 `null`）；`showWhisperSubtitle(text, ms, image, url, assetRoot)` 在有图时 `document.createElement("img")`（`className = MEME_IMG_CLASS` 即 `pet-bub-img`）并 `insertBefore(img, whisperSubtitleEl.firstChild ?? null)`——图在上、字在下；气泡加 `MEME_BUBBLE_CLASS`（`has-img`）。调用点 `triggerWhisper` 把 `image` / `url` / `cfg.assetRoot` 透传
- **测试**：新增 `test/test-126-polish.cjs`（65 条断言：`applyDiagLogSetting` 四取值 + env 优先 + 读失败的静默降级 + 接线顺序；`installAnimPacing` 用假 sprite/假定时器跑 loop 挂上、到点摘除、停够后自然 ended 走原逻辑、loop 挂不上时的兜底重播、换代自停、间隔 0 完全不碰 loop、重复安装幂等；天气三语文案与 4 s/20 s/5600 ms；网页端 `armDwell`/`stopDwell` 结构与 gen 比对）。`test/test-whisper.cjs` 另补 10 条网页端字幕配图回归断言（图节点在前、`pet-bub-img`、`encodeURIComponent` 后的 `/pic/memes/…`、显式 `url` 优先、无图时不挂 `has-img`）。两处 DOM 桩的 `textContent` 改成 setter 并清 `children`，与真实 DOM 一致。总数 **15 文件 / 333 断言**
- **实测**：部署三个文件（`lib/index.js` 5cbad6be、`lib/client.js` 84d58c8f、`voice.js` a511eac0）到 `~/.dsh/profiles/desktop/node_modules/dsh-columbina-pet/`，逐字节 `cmp` 一致；`/healthz` 报 `buildSha256=5cbad6be`、`activatedBuildSha256=8fde0bde`、`clientBuildSha=84d58c8f`、`needsRestart=true`
- **README（三语同步）**：新增 1.2.6 公告；「诊断日志」补配置文件写法；「切换间隔」表格行改为「至少放多久」

## 1.2.5 — 2026-11-18

- **菜单列宽预算（`runtime/electron-helper/shared-core.js`，32 行）**：`mountContextMenu` 按菜单树深度算 `columnMax = Math.min(300, Math.max(120, Math.floor((c.w - 8 - columnGap * (menuDepth - 1)) / menuDepth)))`（`columnGap = 4`），根列与子列的 `maxWidth` 全部改用它（原为 `Math.max(120, c.x + c.w - 8)` / `Math.max(120, c.w - 8)`），翻折间距改用 `columnGap`；`tightMenu = columnMax < 230` 时给列加 `dsh-pet-menu-tight`（`.dsh-pet-menu-hint{display:none}` + 收紧内边距）。配合标题 `flex:0 1 auto;min-width:0;text-overflow:ellipsis` 与摘要 `flex:0 100 auto;max-width:45%;overflow:hidden`，保证标题优先、摘要让位。真机 924×744 窗口贴右缘（可用宽 602）下三列约 150 px、标题完整、摘要收起、互不压
- **原声台词标题回归（`voice.js`）**：`label: titleText === pair[0] ? truncateText(lineTextOf(line, menuBodyLang), 16) : titleText` → `label: titleText`。中文下 `trText` 原样返回使判断恒真、label 退化成正文（1.2.3 `ccbeee0` 引入）；日/英菜单凡缺译名处同样退化，一并修好
- **天气健壮性（`voice.js`）**：新增 `fetchWeatherJson()`（12 s 超时，失败 800 ms 后重试一次）；`readWeather` 失败时回退旧缓存并标 `stale: true`；`loadWeatherCache` 不再因超过 20 分钟丢弃，只要带 `temp` 就装入；新增 `weatherAgeText()` 用本地 `HH:MM` 标注缓存时刻（<5 分钟不加注，zh「（21:38 记下的）」/ en " (21:38 reading)" / ja「（21:38 に測った記録）」）；菜单「重新定位」先出「让我看看你在哪…」气泡，`locate(true)` → `localizeCity` 后立刻报城市，天气转后台预热
- **天气缓存优先 + 闲聊不重样（`voice.js`）**：`speakWeather()` 改 `readWeather({fresh:false, geo: opts.geo === true})`，缓存超过 4 分钟再后台静默刷新（`WEATHER_TTL_MS` 仍是 20 分钟）；晴天等无专用天气台词时退回闲聊池会跳过刚念过的那句（`fresh` 过滤，空则回退原池）
- **`/healthz` 新增两字段（复核报告 P3-1 / P3-6）**：`helperDisabled: helperDisabledByEnv()` 区分「主动关掉 helper」与「本来就在网页模式」；`clientBuildSha: readPackageFileSha("lib/client.js")`（新增按 `mtime+size` 缓存的通用文件哈希）让「只换了 `lib/index.js` 的半装」可见
- **测试**：新增 `test/test-healthz-fields.cjs`（7 条断言：两处字段出现在 healthz 载荷里、`readPackageFileSha` 有定义且被调用、算出的哈希与直接计算一致、文件变化后缓存失效、缺失文件返回 `null`），总数 **13 文件 / 246 断言**
- **实测**：天气直连 5 次 0.846 / 1.061 / 1.001 / 0.999 / 0.958 s，定位 3 次 0.92 / 1.01 / 1.03 s；晴天播报后接「闲聊·月亮」而非「闲聊·歌」；真机重启后 `/healthz` 报 `version=activatedVersion=1.2.4`→（本版）`1.2.5`、`helperDisabled:false`、`clientBuildSha` 有值
- **README（三语同步）**：新增 1.2.5 公告；用例数改 13 文件 / 246 断言；npm 安装示例改 `dsh-columbina-pet@1.2.5`
- **兼容声明**不变（仍是 `0.2.2-rc.3` 实测兼容）

## 1.2.4 — 2026-11-16

- **诊断被宿主吞掉的根因**：`ctx.logger` 在 DSH 0.2.2-rc.3 里是 pino 风格的采集器——`info / warn / error` 方法都在，但消息只进它自己的 buffer，**不进终端 stdout / stderr**（探针实测：`loggerKeys=bufferSize,buffer,ctx,_snMessage,_snExporter,exporters`）。桌面 App 又把宿主 stdout 直接 pipe 给 GUI 进程、没有接收方，于是「桌面宠物起不来」在宿主里是零痕迹：没日志、没 `launch-error.json`、没 electron 进程。新增 `diag(logger, level, message)`：先 `console[level]` 直出，再把同一句转给宿主 logger，两侧各自 try/catch；19 处 `this.logger.xx?.()` / `ctx.logger?.xx?.()` 全部改走它
- **可选诊断日志文件 `DSH_PET_DIAG_LOG`**：设了路径才落盘（`ISO 时间 [级别] 消息`，超 2 MB 轮转成 `.1`），默认完全不碰文件系统；给没有终端的桌面宿主留证据
- **Electron 二进制加头部校验**：`electronBinaryUsable()` 从「是文件且 > 1 MB」升级为再验 PE 头（`MZ`、`e_lfanew`(0x3C) → `PE\0\0`、`Characteristics`(peOff+22) 不含 `0x2000` IMAGE_FILE_DLL；非 win32 直接放行，异常一律放行不误杀）。被改名的大文件 / 残缺 exe 不再被当成可用 Electron，转而走下载或明确报错
- **启动失败写 `launch-error.json`**：helper `spawn` 失败时在 diag 之外再落 `{stage: "helper-spawn", command, message}`，与已有的 `electron-download` 那份同目录同格式
- **逃生开关 `DSH_PET_NO_HELPER=1`**：设了就在 `startHelper()` 首行返回，跳过 Electron 探测与下载（浏览器内宠物不受影响），只打一行 info
- **`src/` 同步**：`diag` / `diagLogPath` / `appendDiagLog` / `binaryHeaderAcceptable` / `electronBinaryUsable` / `writeLaunchError` / `helperDisabledByEnv` 与 `startHelper` 守卫补进 TS 参考；`resolveElectronPath` 的文档改成「每个候选都要过 `electronBinaryUsable()`」
- **测试**：新增 `test/test-diag-helpers.cjs`（27 条断言：diag 的 console 回退、PE 头校验、非 win32 放行、日志文件开关与 2 MB 轮转），总数 **12 文件 / 239 断言**；`src/host/helper-process.test.ts` 同步新增 `helperDisabledByEnv`、假 Electron 写入器与日志落盘用例
- **实测**：真 Electron（225,441,792 B）仍判可用；6 MB 改名 DLL 从「可用」变「不可用」；桌面 App 带 `DSH_PET_DIAG_LOG` 重启后，`activated`、`helper started`、helper 子进程的 `displays` / `bridge callback` 四行都进了文件
- **README（三语同步）**：新增「诊断日志（可选，1.2.4+）」一节与 1.2.4 更新公告；排障「桌宠没出现 → 桌面模式」补 `launch-error.json` 与 `DSH_PET_DIAG_LOG`；用例数改成 12 文件 / 239 断言；npm 安装示例版本改成 1.2.4。三份文档结构保持一致（45 个三级标题 / 706 行 / 75 行表格）
- **兼容声明**不变（仍是 `0.2.2-rc.3` 实测兼容）

## 1.2.3 — 2026-11-16

- **菜单与译文的细活（同日补做）**：①日英菜单的 76 句原声台词改成「标题 + 正文摘要」，两端共用 `TITLE_I18N` / `WEB_MENU_EXTRA_I18N`；②日文词典整体校订——删掉 17 条同键重复（英文值覆盖日文值，动作切片别名显示成 `Snack / Humming / Idle`）、17 条 `コロンビア` 改回官方 `コロンビーナ`，另修 20 条措辞（`表示先` / `元の位置に戻す` / `オリジナルボイス` / `元素スキルと元素爆発` / `おやすみモード` 等）；③省电模式、语音包与素材、待机动作、2D live、音量、夜间勿扰、碎碎念开关与单位等小项全部过 `trText` / `webTr`，网页端同步；④新增 `test-menu-i18n.cjs`（en 树不得含 CJK、ja 树不得有未翻译中文键，5 条断言），总测试数 10 个文件（另含 `run.mjs`）。

- **「显示位置 → 都不」单向门（根因 + 两处兜底）**：`display: none` 时网页半 `visiblePets` 过滤为空（`lib/client.js:105` `isWebVisible`）、宿主 `hasDesktopPet=false` 不 spawn helper（`lib/index.js` 的 `isDesktopVisible`）、托盘也不建——屏幕上没有任何可点入口，只能靠用户记得去「设置 → 哥伦比娅」改回来。现场：2026-11-16 13:33:01 配置被写成 `none`，用户只看到「桌宠不见了」；配置文件只有 `pets`+`physics` 两键，可定位到是 `POST /pet-display`（设置面板保存会写 11 个键），但无请求日志、无法进一步定性是谁点的。修法：①设置页在「所有宠物都是 none」时渲染警示条 + 「恢复为仅桌面」按钮（`hiddenPets`/`allHidden`/`restoreHidden`，对每只 none 宠物 POST `/pet-display` 后 `applyConfig`+`petBridge.reload`）；②托盘从「一个复选框翻转」改四项平铺子菜单（仅网页 / 仅桌面 / 两者 / 都不（隐藏），radio 打勾）——旧 `toggleDisplay` 在 desktop 上一点就跳 none，是最容易误触的一条路径
- **显示位置改动的审计留痕**：宿主新增 `DISPLAY_CHANGE_LOG = ~/.dsh/columbina-pet/display-changes.ndjson`（每行 `{at,id,from,to,source}`，来源枚举 `web-menu/desktop-menu/tray/settings-panel/api`，未知一律归 `api`）+ 进程内环形缓冲 30 条；`PUT /config` 与 `POST /pet-display` 写盘成功后各记一条；`/healthz` 增 `displayLog` 与 `displayChanges`（最近 10 条，进程刚起时回落到磁盘尾部）。三个菜单入口都补 `source`：网页菜单 `web-menu`、桌面宠物菜单 `desktop-menu`（`sprite.js` 的 `setPetDisplay`）、托盘 `tray`（`main.js` 的 `traySetPetDisplay`）、设置面板保存 `settings-panel`
- **音量 0–100 % 任意值**：桌面宠物内置面板（`voice.js`「哥伦比娅 · 设置」）新增「音量」段：0–100 % 滑杆（每 5 % 一格，`data-act="volume"`，`input` 事件里即时 `applyVolume()`，重建面板会打断拖拽所以只更新数值文本）+ 静音开关；右键「音量 → 自定义音量…」跳该段（`__columbinaOpenSettings: 'volume'`，与「待机动作 → 自己选」同一机制）。存储仍用 helper 自己的 `columbina-voice-volume-v1`
- **夜间勿扰自定义时段**：同一面板新增「夜间勿扰」段：开关 + 两个 `<input type="time" step="60">`（开始 / 结束），`parseHhmm()` 校验 `HH:MM` → 分钟数，跨零点标「（跨午夜）」；`panelInput` 同时挂 `input` 与 `change`（type=time 在部分路径下只发 change）；右键「夜间勿扰 → 自定义时段…」跳该段。存储仍用 `columbina-voice-quiet-v1`
- **拖间隔滑杆后设置面板往下跳（根因）**：`voice.js` 的 `renderPanel()` 每次重建 `#cv-body` 的 `innerHTML` 后都无条件 `body.scrollTop = sec.offsetTop - 6`（把滚动拉回当前段段首），而间隔滑杆的 `panelClick` 分支是「存值 + `renderPanel()`」——松手必然跳。修法：新增 `panelJumpSection` 门闩（默认 false），重渲染时先记 `keepScroll = target.scrollTop`，只在 `openSettingsOverlay/openSettingsPanel` 点名某段时置 true 才滚过去，其余情况还原 `keepScroll`；间隔拖动改走 `panelInput`（即时 `intervalSec` + 只更新 `#cv-int-val` 文本，不重建面板），`panelClick` 里同值直接 return
- **网页端与桌面端功能对齐（音量 / 夜间勿扰）**：`lib/client.js` 的 `webQuietBranch()` 文案对齐桌面（`开 · HH:MM–HH:MM`、`关闭勿扰/开启勿扰`、预设项标「当前」）并追加「自定义时段…」叶子；`webVolumeBranch()` 的静音项补 `hint: "点一下切换"`、档位标「当前」并追加「自定义音量…」叶子；设置面板（`makeWebSettingsPanel`）新增「音量」段（0–100 滑杆 step 5 + 静音开关）与「夜间勿扰」段（开关 + 两个 `<input type="time">` + 跨午夜提示），新增 `webParseHm()` 校验时分；`web-panel` action 现在读叶子的 `value` 跳段（`setPanelSection`），面板 body 加 `data-wsec` 锚点 + `bodyRef`，各「打开设置 / 选择动作 / 选择台词」叶子分别指向 `lang/scale/idle/voice/assets`
- **网页半「禁用/热更新后整块消失」的根因（启动守卫）**：`lib/client.js` 开头原有 `if (globalThis.__dshColumbinaClientBooted === true) return;`（当年为了挡「启动期同一份 bundle 被排队两次 → duplicate module id」）。但 DSH 在插件被禁用再启用、或客户端代码热更新时会以 **live 模式**重新执行同一份 bundle：守卫直接 `return`，`window.__ModuleLoader__.load()` 不再被调用 → 工厂没注册 → `entry.fiber === undefined`，`shell.overlay` 的 `pet` 与 `settings.section` 的 `pet-config` 一起消失（用户看到的就是「切网页端后宠物不见了、设置里也找不到她」）。修法：守卫只在排队阶段生效（`window.__ModuleLoader__.mode === "queue"` 才去重，live 阶段一律重新注册），并把 `load()` 包一层——只有 `duplicate` 类错误吞掉并告警，其它错误照旧抛出。新增 `test/test-client-boot.cjs`（9 条断言，vm + 假 DOM 真跑 bundle：排队阶段两次执行只注册一次、live 首次执行就注册、排队→live 再执行必须第二次注册、duplicate 被吞、非 duplicate 抛出）。实测：禁用 → 启用后两个插槽 occupant 立刻回来，无需刷新页面
- **设置面板语言（`panelLang`）**：以前面板文案写死中文、网页面板只跟 `menuLang`，面板语言无法独立。现在 helper 与网页面板都新增「面板」一行（中文 / 日本語 / English / 跟随菜单），偏好键 `panelLang`（`""` = 跟随菜单）走宿主 `POST /voice-prefs` 白名单（新增 `normalizePanelLang`）落到 `~/.dsh/columbina-pet/voice/prefs.json`，helper 侧走 `writeLocalPrefs/readLangPrefs/applySettings` + `window.__columbinaVoice.lang.panel` 与 `setLang('panel', …)`。helper 的 `trText(text, lang)` 接受显式语言并合并 `PANEL_I18N`，面板全部文案过 `panelTr()`
- **菜单语言切换后残留中文**：`MENU_I18N`（helper，64 键）与 `WEB_MENU_I18N`（网页，91 键）都缺条目，于是 `省电模式 / 语音包与素材 / 设置面板段标题 / 台词分类名（关于我、关于同伴、突破的感受、战斗中的低语、元素战技与爆发 等）` 在 ja・en 下仍是中文。两边各补 68 条同源字典（helper `PANEL_I18N`、网页 `WEB_MENU_EXTRA_I18N`，`webTr` 合并查表），新增 `test/test-i18n-coverage.cjs` 扫描源码里所有中文 `label/hint/children/placeholder` 字面量，未进字典即失败（桌面 / 网页各一遍 + 字典规模 + 台词分类兜底）
- **「显示位置 = 两者」时网页菜单退回最初始七项**：`handleContextMenu` 里 `const isWeb = cfg.display === "web";` → 改 `isWebVisible(cfg.display)`，`both` 下语音 / 台词 / 碎碎念分支与「仅网页」一致；顺带给 `wvPrefsRef.current` 为空（首屏偏好未到）时补 `|| WEB_VOICE_DEFAULT` 兜底，避免菜单构建抛错
- **日英菜单台词摘要跟随菜单语言**：`buildMenuBranch()` 原来把 hint 固定取 `lineTextOf(line, subLang)`，所以「字幕＝中文、菜单＝日本語/English」时标题翻了、摘要仍是中文（用户截图里日英两处都中招）。现在 `menuBodyLang = menuLang === 'zh' ? subLang : menuLang`，label 与 hint 都用它；网页端 `webLinesBranch()` 本来就用 `menuLang`，无需改。`test/test-menu-i18n.cjs` 额外把 `sub` 固定成 `zh`（真实配置）跑菜单树，用语料比对断言 en / ja 的 76 条摘要都不是中文前缀（原先该测试把 `sub` 也设成同语言，正是漏掉这个 bug 的原因；断言数 5 → 7）。
- **台词标题改用游戏内官方文本**：76 条标题不再自译，改照官方语音条目重写——英文 `Chat: Singing` / `About Columbina: Eye Mask` / `About the "Tri-Lunar Convergence"` / `Feelings About Ascension: Climax`，日文 `世間話・歌` / `コロンビーナ自身について・アイマスク` / `「三相月臨」について` / `「雄鶏」について`（官方术语 `コロンビーナ`、`元素爆発`）。官方把同组多句并为一条时（`Elemental Skill` / `元素スキル`、`Low HP` / `HP低下`）写成「组名 + 行号」（`Elemental Skill · 1` / `元素スキル・1`）。数据来源 Fandom `Columbina/Voice-Overs` 与 `コロンビーナ/ボイス`（story + combat 两节），落库脚本 `_tmp/apply-official-titles.cjs`，映射 `_tmp/official-titles.json`；复核两端 `TITLE_I18N` 与 `WEB_MENU_EXTRA_I18N` 各 76/321 键、与官方映射 mismatch 0。动作切片名（`坐牢 1`、`通知_提示 星星_收藏`、`转向`）官方无对应文本，保留语义译；`test/test-voice-panel.cjs` 的日文断言同步改为 `世間話・歌`。
- **台词标题随语言切换（已被下一条取代）**：第一版做法是「用该语言的台词正文截断充当标题」，能区分但不好认，随后改为官方内文本（见「台词标题改用游戏内官方文本」）。保留当时的过程记录：语音索引里每句台词只有中文标题（`闲聊·歌` 这类），所以菜单语言切到日文 / 英文时菜单里的台词项、以及设置面板的台词勾选列表仍是中文标题；当时两端都用「该语言的台词正文（截断）」代替标题——helper `truncateText()` + `buildMenuBranch()`（menuLang 非 zh 时 label 取 `lineTextOf(line, menuLang)` 截 16 字、hint 置空）与 `linesBlock()`（按 `panelLangNow()` 取正文截 22 字），网页 `webLinesBranch()` 的 `lineLabel()` 与面板台词列表同规则；`test/test-voice-panel.cjs` 加两条断言（日文面板显示日文正文、不出现中文标题）
- **README 三语**：新增 `README.en.md`（English）与 `README.ja.md`（日本語），与中文 `README.md` 逐节对应——同样的 68 个标题、75 行表格、15 个代码块，代码块与路径/命令/URL 一律原样照抄；三个文件顶部各有一行 `中文 | English | 日本語` 互链（居中块内，标语与徽章之间）。`package.json` 的 `files` 补列两个新文件，npm 包里也会带上
- **动作切片名三语**：右键「动作」子菜单与面板待机动作列表的条目都是素材文件名（`喝(饮料杯)`、`打字(恼怒)`、`通知_提示 Bits`…），ja・en 下此前仍是中文。现在 99 个切片名（四套形象池子的并集，另加官方形象去掉 `哥伦比娅-` 前缀后的 17 个短名）进字典；测试 `test-i18n-coverage.cjs` 按 `assets/webm` + `voice-index.js` 的 `skins[].pool` 实时比对，缺一条即失败；桌面 `idleListHTML()` 与网页 `idleShown` 列表都过 `panelTr`/`webTr`
- **碎碎念改为官方原声优先**：`voice.js` 的 `whisper()` 里「整句 / 片段」比例从 55/45 改成 **78/22**（用户反馈碎碎念被早期 B 站切片污染、官方原声变少：`clips` 94 条来自 `bilibili:BV1C5s6zaE3P,BV1wt2jBwE4p,BV1fQzSBMEbs`，`lines` 76 条来自 wiki）；`pickWhisper()` 的候选过滤从 ≥3 字提到 ≥4 字（「钱」「问号」这类不再单独出现）。网页端本来只念官方台词，无需改动
- **issue 报告（P1 / P2 / P3）修完**：①设置面板拖间隔后单位回落中文——桌面 `panelInput` 里改成 `intervalSec + ' ' + panelTr('秒')`，网页改成 `(prefs.intervalSec || 90) + " " + webTr("秒", plang)`；②网页三个开关（碎碎念 / 静音 / 勿扰）与素材按钮（修复中… / 一键修复）此前直接写中文字面量，现全部 `webTr(..., plang)`；③网页间隔滑杆与调度从 15–300 秒收敛到 **60–180 秒**（`min/max`、`webWhisperBranch()` 的当前值、调度夹取三处），与桌面 `clampInterval()` 和 README 一致；④`var panelJumpSection = false;`——此前初值 true 与「默认留在原地」的注释/README 相反；⑤托盘 `DISPLAY_CHOICES` 与 tooltip 恒中文，改为 `TRAY_I18N` 三语表 + `displayChoices(lang)`，主进程每 4s 读一次 `prefs.json` 的 `menuLang`，变了就 `applyTrayMenu()` 原地重建（托盘菜单无法远程打开，快照里也记 `menuLang`）；⑥`display-changes.ndjson` 只追加不轮转、冷启动整文件读——新增 `DISPLAY_CHANGE_LOG_MAX_BYTES = 256 * 1024` / `DISPLAY_CHANGE_LOG_KEEP_LINES = 200`，每 50 次写入检查一次体积、超限就保留最后 200 行重写；`recentDisplayChanges()` 冷启动只 `open/read` 尾部 64 KB。新增 `test/test-panel-i18n.cjs`（21 条断言：按 `makeWebSettingsPanel`/`PetCard` 与 `linesBlock`/`panelClick` 划区域扫 `label/hint/placeholder/children` 的中文字面量，未包 `webTr/panelTr/webFmt/panelFmtArgs` 即失败；另含间隔范围、`panelJumpSection` 初值、托盘三语、审计轮转四组定向断言）。文档同步：README 环境要求补 0.2.2-rc.3、用例数字改成 11 文件 / 206 断言、`src/`/`docs/`/`.github/` 在 npm 包内不存在这一点写清；CHANGELOG 里「台词标题随语言」旧条目标注为已被官方内文本取代。
- **复核后的三条收尾**：①桌宠右键菜单改语言后，helper 渲染端经 `PetShared.postAction` 把 `menuLang / panelLang / voiceLang / subLang` 推到宿主 `POST /voice-prefs` —— 托盘每 4 秒读的是 `prefs.json`，此前只有网页端改语言才会写，桌面菜单改了托盘不跟；②宿主 `POST /voice-prefs` 的 `intervalSec` 夹取从 15–3600 收到 **60–180**，与 UI、README、`clampInterval()` 一致；③`test/test-panel-i18n.cjs` 扩到 27 条断言（推送链路、宿主夹取、字典尾部不再有 `",},"` 的仓促排版），用例总数 11 文件 / 212 断言。修这轮时一度把 `readVolumePrefs()` 的函数头误改，触发 `ReferenceError: readVolumePrefs is not defined`，已恢复并跑回全绿。④英文 / 日文 README 的「开发与测试」段同步中文版：用例数改成 11 文件 / 212 断言并列出分项、环境表补 0.2.2-rc.3、目录树注明 `src/` 与 `.github/workflows/ci.yml` 只在仓库内（不随 npm 包发布），树注释也一并翻译。⑤三份 README 的「更新公告」加了一条「三语文档也补齐了」，「功能介绍」里过时的两处改成现状：台词条目在日英菜单里显示官方台词标题加摘要（不再说「标题只存中文一份」）、网页与桌面的音量 / 勿扰是「入口一致、各存各的一份」（不再写「共用一套设置」），并补上「条目形态」「面板语言可单独选」两条。
- **兼容声明**：`dsh.compatibility.dshReleases` 增 `0.2.2-rc.3: compatible`
- **README**：新增 1.2.3 公告；「音量与一键静音」「夜间勿扰」两节补自定义入口与 0–100 %；右键菜单表两行补新项；排障「桌宠没出现」补「先查 displayChanges + 设置页警示条」

## 1.2.2 — 2026-11

- **测试搬进仓库**：`_tmp/test-*.cjs` → `test/`（5 个文件、93 条断言），新增 `test/run.mjs` 汇总执行（`spawnSync` 逐个跑、按退出码判定、打印 PASS/FAIL 与耗时）；`package.json` 增 `test` / `check` 脚本，`files` 增列 `test`，装好的包里也能自己跑一遍
- **CI**：`.github/workflows/ci.yml`，push / PR / 手动触发，Node 22 与 24 矩阵，跑 `npm run check`（`node --check` 两个 lib 文件）与 `npm test`；无第三方依赖，因此不需要 install
- **兼容面**：`dsh.compatibility.dshReleases` 增 `0.2.2-rc.1: compatible`；12 个 `@deepseek-ai/*` peer 从 `^0.2.0-rc.1` 放宽到 `>=0.2.0-rc.1 <0.3.0`（实测 0.2.2-rc.1 下 6 个命名导入、7 个服务成员、`shell.overlay` 占位、`settings.section` 槽位都正常）
- **`src/` 定性**：新增 `src/README.md`，写明发布产物是 `lib/`、没有构建步骤、`src/` 仅作参考且会漂移
- **README**：安装段补「tarball 约 148 MB、首次安装需等待」；环境表补 0.2.2-rc.1 实测；新增「开发与测试」「关于后续」两节（后者写明：功能面冻结、只做兼容与优化、想法走 B 站私信、bug 优先修）；`从 npm 安装` 示例改 1.2.2
- **仓库卫生**：`.gitignore` 加 `_tmp/`
- **排障文档**：README 新增「遇到问题怎么办」（四个自检数、11 类症状的处理、报 bug 清单），并订正配置目录说明（旧 `~/.dsh/dsh-pet/` 会一次性迁移到 `~/.dsh/columbina-pet/`）
- **可检索性**：`package.json` 的 `description` 与 `keywords`、README 标题与首段补上《原神》/ genshin 字样（以前全文 0 次「原神」，按这个词搜不到）
- **文档体检**：README 对齐当前实现（镜像变量名 `DSH_PET_ELECTRON_MIRROR`、语音包镜像示例版本 v1.1.4、右键菜单完整表、目录结构）并在开头补作者署名；纯文档改动
- 无运行时行为变化

## 1.2.1 — 2026-10

- **碎碎念字幕比声音先消失（根因 + 兜底）**：宿主 `sendFile()` 只回 `200 + content-length`，不返回 `accept-ranges`，也不处理 `Range` 请求（实测带 `Range: bytes=0-100` 仍回 200 全量）。Chromium 对不可 seek 的 Ogg 常把 `audio.duration` 报成 `Infinity`，旧逻辑 `Math.round((audio.duration || 4) * 1000) + 1200` 于是得到 `Infinity`，`armWhisperSubtitleHide()` 判为非法 hold 退回 3600 ms——声音还在读，字幕先没了。新增 `trackWhisperSubtitleAudio(audio, text)`：在 `triggerWhisper()` 之后绑定真实音频，每次 `timeupdate` 重排收起时刻（duration 有限用 `left + 600`，Infinity/NaN 用 1500 ms 心跳顶着），`ended` 立即收，`paused` 后不再有心跳、1.5 秒内自然收；用 `textContent` 比对保证旧音频不会误伤新句
- **碎碎念字幕被子孙容器裁掉**：字幕改为挂在 `document.body` 的独立浮层（`[data-dsh-pet-subtitle]`，`position: fixed`，`z-index: 2147482000`），不再寄生在 `.dsh-pet-root` 里；祖先的 `transform` / `contain` / `overflow: hidden` 再也裁不到长句
- **拖动宠物时字幕不跟随**：显示期间用 `requestAnimationFrame` 逐帧把浮层的 `left/top/width/height` 同步到 `.dsh-pet-root` 的实时矩形（`syncWhisperSubtitleBox()` + `whisperSubtitleFollow/start/stop`），`--dsh-pet-size` / `--dsh-pet-font-bubble` 只在换根节点或宽度变化 > 0.5 px 时重取；`hideWhisperSubtitle()` 与定时器回调都会 `cancelAnimationFrame`
- **碎碎念间隔被任务状态拖长**：whisper effect 的依赖曾是 `[cfg.display, wvReady, workStatus?.state]`，任务状态每变一次就 `clearInterval` 重排，实测 90 秒被拖成 12 分钟以上。改为组件顶部维护 `workStatusRef`，`busy()` 读 ref，依赖只剩 `[cfg.display, wvReady]`
- **桌面端补上「语音包与素材」面板**：此前只有网页端有。桌面 helper 的 `voice.js` 新增 `assets` 段（检查素材 / 一键修复 + 状态行），`API_BASE = new URL('../..', OFFICIAL_BASE).href`；`openSettingsOverlay/openSettingsPanel` 白名单加 `'assets'`
- **宿主 `/voice/health` 与 `/voice/repair` 加 CORS 头**：桌面 helper 页面是 `file://` 源，取同源数据会被浏览器拦；两个响应补 `access-control-allow-origin: *`
- **网页右键菜单与桌面端对齐**：`webPhysicsBranch()`（「真实物理：开 / 关」，键 `columbina-physics-web-v1`，关掉时 `throwPower: 0 / restitution: 0 / ceilingBounce: false / groundFriction: 40 / petCollision: false`）插在「回到初始位置」之后；末尾分支顺序改为 `音量 → 夜间勿扰 → 省电模式 → 语音包与素材 → 设置面板 → 待机动作`；设置面板分区顺序统一为 碎碎念 / 语言 / 模型大小 / 2D live 形象 / 待机动作 / 语音包与素材 / 原声台词 / 天气；新增菜单项的日 / 英文案一并补齐
- **天气播报文案统一**：温度带 `℃`，中 / 日 / 英各自成句（`今天小雨，21℃，17~24℃ · 广州` / `今日は…` / `Today …, 21℃ (17–24℃) · Guangzhou`）
- **自动碎碎念不再掐断长句**：`playWebLine()` 一开场就 `pause()` 掉上一句音频，而热身（12 s 后）、间隔、手势补播、天气接话这些来源互相不知道对方在播什么——实测 11 秒内念了两句长台词，前一句只播了一半。新增 `webVoiceBusy()` / `webAutoVoice(source, scene, label)`：自动来源发现上一句还在播就让路并打 `[dsh-pet] 碎碎念让路 来源=…`，只有手动点桌宠或「原声台词」点播才会强制换句；热身改为 `wvWarmedRef` 每会话只排一次（`wvReady` 变化会让 effect 重挂，原来会补第二句）
- **已知未尽事项**：webm 素材尚未支持范围请求的快速 seek（视频用的是 `preload="auto"` 全量加载，不影响播放）；`src/` 与 bundle 已漂移，重新从 TS 构建前需补齐
- **碎碎念气泡整串乱码 / 豆腐块（根因：请求体按 UTF-8 硬解）**：`readBody()` 直接 `Buffer.concat(chunks).toString("utf8")`，没有任何编码校验。Windows 控制台的 curl / PowerShell 发中文时按 GBK 出字节，非法序列被换成 U+FFFD 后照样写进 say，气泡里就是一串菱形问号加零散怪字（现场：`\ufffdԲ飺\ufffdܿ…`），切模式重挂时会原样重放。复现：python 把 GBK 编的 JSON 体 POST 到 `/broadcast` → `/state` 里立刻出现同一族乱码。修法：新增 `decodeBodyBuffer()`（严格 UTF-8 → 失败按 GB18030 重解并 warn → 再失败退回有损 UTF-8）、`looksMojibake()`（含 U+FFFD 或 `锟斤拷/烫烫烫/屯屯屯` 判乱码）；`/broadcast` 与 `publishWhisper` 的模型输出现乱码一律拒绝写入
- **素材路由支持 `Range` / 206 / 416**：`sendFile()` 新增 `parseRangeHeader()`，200 响应补 `accept-ranges: bytes`；带范围时用独立 fd 按区间读（`createReadStream(file,{start,end})`），`If-None-Match` 命中仍给 304，起点越界给 416 + `content-range: bytes */size`。至此 `audio.duration` 能拿真值，客户端 `timeupdate` 兜底仍保留（上面那条「已知未尽事项」已由本项解决）
- **本地接口挡住浏览器跨站写**：新增 `crossSiteWriteBlocked(req)`，非 GET/HEAD/OPTIONS 且 `sec-fetch-site: cross-site` + `Origin` 是 http(s) 他站时返回 `403 {"reason":"cross-site-blocked"}`；此前 24 条路由全无来源校验，任意网页都能跨站 POST `/broadcast` 往气泡里塞字、`/whisper` 烧 token。同源页面（`same-origin`）、桌面 Helper（`file://` 的 `Origin: null`）、本机脚本（不带 Origin）都不受影响
- **切回网页模式后不再空转 Helper**：`syncDesktop()` 改为「有桌面宠物才 `startHelper()`」，否则打一行日志后不再拉起；`desktopModeEverActive` 的粘性只保留给「从未有过桌面宠物」的纯浏览器用户。旧实现切回 `web` 后仍留着 3 个无窗口进程（约 178 MB）
- **`voice-pack.json` 的 `version` 随启动刷新**：新增 `refreshVoicePackMarker()`，语音包已就绪时按 `PACKAGE_VERSION` 重写 marker（旧实现只在迁移那一次写，marker 常年停在 1.1.5）

## 1.2.0 — 2026-10

- **余额查询不再被 API Key 卡住**：默认模型挂在 API Key 版服务商（`deepseek-official`）而本机是账号登录时，宿主会先按 ref 取 `DEEPSEEK_API_KEY` → 直接 `credential-missing`（界面显示「缺少凭证 DEEPSEEK_API_KEY」）。现在缺凭证时自动退到账号余额（`deepseek-account`），账号那条失败信息（未登录 / 授权过期）比「缺少凭证」好懂；网页模式走同一个 `refreshBalance`，一并修好
- **待机动作可选**：右键「待机动作」切 精选 / 当前形象全部动作 / 自己选；「自己选…」打开设置面板里可搜索的勾选列表（去眼罩、带眼罩睁眼各 82 段，带眼罩闭眼 65 段，官方表情包 17 段），勾了哪几段就只轮播哪几段，立即生效
- **待机动作不再「卡」**：之前名字里带「待机」的片段被拉到 20 秒循环，2.4 秒的官方待机片段等于 0.12×（约 3.6 fps），看着一顿一顿。现在统一 0.6×，重复交给轮播节奏
- **精选待机池扩容**：从 2 段扩到 官方 9 / 去眼罩 12 / 睁眼 12 / 闭眼 10 段，90 秒一轮不再来回只切两个动作
- **省电模式真的会停**：旧实现只暂停 `loop` 的视频，而待机是 one-shot（`loop=false`）播放，等于什么都没停。现在鼠标 30 秒不动就暂停所有正在播的视频，并拦住宿主推来的新动作，动一下鼠标立刻恢复
- **夜间勿扰时段**：22:00–07:00 / 23:00–08:00 / 00:00–09:00 / 01:00–10:00 四档（支持跨零点），时段内碎碎念自动闭嘴，手动点台词不受影响
- **音量与一键静音**（桌面 + 网页）：静音开关 + 20/40/60/80/100 % 五档，和语音设置存在同一个 localStorage 键
- **语音包与素材检查 / 一键修复**：宿主新增 `GET /voice/health` 与 `POST /voice/repair`（返回语音包、webm、表情包的目录/数量/体积），网页面板多出「语音包与素材」区块，缺文件一键重下
- **网页天气城市名本地化**：ipwho.is 只给英文城市名，现在走 open-meteo geocoding（`language=zh`）并缓存 6 小时；定位结果带经纬度，二次查询不再重新定位
- **`/healthz` 新增 `activatedBuildSha256` 与 `needsRestart`**：`buildSha256` 是请求时读磁盘，同一个版本号重打包时它必然等于新盘，看不出内存里跑的是旧代码；现在把**激活那一刻**的 sha 定格在内存里，两者不同即 `needsRestart: true`。`activation.json` 同步补 `activatedBuildSha256`
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

## 1.0.4 — 2026-10

与上游 `dsh-pet` 并存（命名空间彻底拆开）。

- **宿主路由**：`/dsh-pet-7340` → `/dsh-columbina-pet-7340`；旧前缀仍尝试注册（被上游占用则静默跳过），旧书签/旧客户端不会 404。
- **bridge**：自定义 scheme、管道前缀、`PET_ROUTE` 全部改为 `dsh-columbina-pet-bridge`（URL host 也改为 `dsh-columbina-pet`）。
- **用户目录**：`$DSH_HOME/dsh-pet` → `$DSH_HOME/columbina-pet`，首次启动自动迁移（新目录已存在则不动）。
- **会话身份**：`PET_CALL_IDENTITY` 由 `dsh-pet` 改为 `dsh-columbina-pet`，与上游的会话/通知互不串台。
- **本地素材通道**：voice sidecar 新增 `runtime://` → `blob:` 代理（仅当素材地址以该 scheme 下发时生效），避免外置素材下 `<video src>` 静默黑屏。

升级后请**完整退出 DSH 再打开**；若桌宠之前与上游装在一起，现在可以同时启用。

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
