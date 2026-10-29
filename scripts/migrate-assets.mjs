#!/usr/bin/env node
/**
 * 把包内 `assets/` 素材搬到外置根 `$DSH_HOME/columbina-pet/assets`（1.0.2+ 支持，宿主优先读外置根）。
 *
 * 用途：让插件目录保持在几十 MB、素材单独存放/备份；仓库瘦身或把素材挂到别处时也用它。
 *
 * 用法：
 *   node scripts/migrate-assets.mjs           # 复制（保留包内原文件）
 *   node scripts/migrate-assets.mjs --move    # 复制校验后删除包内原文件
 *   node scripts/migrate-assets.mjs --force   # 覆盖已存在的外置素材
 *
 * 注意：`voice/` 与 `runtime/` 不在本脚本范围内（1.0.2 仍随包发布），只处理 `assets/`。
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");
const srcRoot = join(pkgRoot, "assets");
const dshHome = process.env.DSH_HOME || join(process.env.USERPROFILE || process.env.HOME || "", ".dsh");
const dstRoot = join(dshHome, "columbina-pet", "assets");

const args = new Set(process.argv.slice(2));
const move = args.has("--move");
const force = args.has("--force");

const ITEMS = ["webm", "memes", "fonts", "pic", "config.jsonc", "logo.png", "preview"];

function sizeOf(path) {
  try {
    const st = statSync(path);
    if (st.isFile()) return st.size;
    let total = 0;
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      total += sizeOf(join(path, entry.name));
    }
    return total;
  } catch {
    return 0;
  }
}

function countFiles(path) {
  try {
    const st = statSync(path);
    if (st.isFile()) return 1;
    return readdirSync(path, { withFileTypes: true }).reduce(
      (n, e) => n + countFiles(join(path, e.name)),
      0,
    );
  } catch {
    return 0;
  }
}

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1) + " MB";

console.log(`包内素材: ${srcRoot}`);
console.log(`外置根  : ${dstRoot}${move ? "（迁移后删除原文件）" : ""}`);

if (!existsSync(srcRoot)) {
  console.error("包内 assets/ 不存在，没什么可搬的。");
  process.exit(1);
}

mkdirSync(dstRoot, { recursive: true });

let copied = 0;
let skipped = 0;
let srcBytes = 0;

for (const item of ITEMS) {
  const from = join(srcRoot, item);
  const to = join(dstRoot, item);
  if (!existsSync(from)) continue;
  if (existsSync(to) && !force) {
    console.log(`跳过 ${item}（外置已存在；加 --force 覆盖）`);
    skipped += 1;
    continue;
  }
  if (existsSync(to) && force) rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
  const bytes = sizeOf(from);
  srcBytes += bytes;
  copied += 1;
  console.log(`复制 ${item}  ${mb(bytes)}`);
}

const dstBytes = sizeOf(dstRoot);
console.log(`\n完成：复制 ${copied} 项、跳过 ${skipped} 项；外置根共 ${countFiles(dstRoot)} 个文件 / ${mb(dstBytes)}`);

if (move) {
  if (dstBytes <= 0) {
    console.error("外置根为空，已放弃删除包内素材。");
    process.exit(1);
  }
  for (const item of ITEMS) {
    const from = join(srcRoot, item);
    if (existsSync(from)) rmSync(from, { recursive: true, force: true });
  }
  console.log("已删除包内 assets/ 下的素材（voice 与 runtime 未动）。");
}

console.log("\n验证：重启 DSH 后访问  http://127.0.0.1:<端口>/dsh-pet-7340/healthz  ，assetRoots.external 应指向上面这个目录。");
