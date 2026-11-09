# src/：参考源码，不参与构建、不随包发布

**发布产物是 `lib/`。** 仓库里没有构建步骤：`lib/index.js`（宿主半）和 `lib/client.js`（网页半）是手写产物，改行为直接改它们，`node scripts/ensure-*.mjs` 之外的脚本都不碰源码。

`src/` 是一片**半同步的 TypeScript 参考**，用途只有两个：

1. 看命名、看职责划分、看类型形状（比读 7000 行的 bundle 快）；
2. 留一部分单元测试原型。

它会和 `lib/` 漂移——比如碎碎念浮层的 `showWhisperSubtitle` / `rescueStickerImage`、`data-dsh-pet-subtitle` 宿主这些后加的东西只活在 `lib/` 里，`src/shared/whisper.ts` 里没有。**判断真实行为请看 `lib/`，不要看 `src/`。**

如果你想把 `src/` 恢复成真源，那需要先补一套构建（打包 + 补齐缺口），这是一件比修 bug 大得多的事；在那之前，把 `src/` 当文档读就好。

测试在 `test/`，跑法见仓库根 `README.md` 的「开发与测试」一节。
