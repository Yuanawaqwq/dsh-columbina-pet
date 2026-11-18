#!/usr/bin/env node
/* 1.2.5 · 复核报告 P3-1 / P3-6：healthz 要能区分「逃生开关」和「半装」 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const src = fs.readFileSync(path.join(__dirname, "..", "lib", "index.js"), "utf8");

let pass = 0;
let fail = 0;
function ok(cond, label, extra) {
  if (cond) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label}${extra === undefined ? "" : "  -> " + extra}`);
  }
}

/* P3-1：设了 DSH_PET_NO_HELPER=1 时，healthz 得说清「helper 是被我关掉的」，
 * 而不是让调用方以为「本来就跑在网页模式」。 */
ok(
  (src.match(/helperDisabled: helperDisabledByEnv\(\),/g) || []).length === 1,
  "healthz 载荷里有 helperDisabled（且只有一处）",
);

/* P3-6：只换 lib/index.js 的半装，靠 buildSha256 看不出来（前后都是新盘哈希），
 * 加一份 client 的哈希后，两边是不是同一批发布才可见。 */
ok(
  (src.match(/clientBuildSha: readPackageFileSha\("lib\/client\.js"\),/g) || []).length === 1,
  "healthz 载荷里有 clientBuildSha（指向 lib/client.js）",
);
ok(src.includes("function readPackageFileSha(rel)"), "readPackageFileSha 已定义");
ok(
  (src.match(/readPackageFileSha\(/g) || []).length >= 2,
  "readPackageFileSha 有定义 + 至少一处调用",
);

/* 行为：切片出来实跑——按 mtime+size 缓存、文件不存在回 null。 */
const start = src.indexOf("const PACKAGE_FILE_SHA = new Map();");
const fnStart = src.indexOf("function readPackageFileSha(", start);
const end = src.indexOf("\n}\n", fnStart) + 3;
if (start < 0 || fnStart < 0 || end <= 3) {
  console.log("  FAIL 找不到 readPackageFileSha 切片");
  fail++;
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-pet-healthz-"));
  fs.mkdirSync(path.join(tmp, "lib"), { recursive: true });
  const file = path.join(tmp, "lib", "client.js");
  fs.writeFileSync(file, "abc");
  const { readPackageFileSha } = new Function(
    "join",
    "statSync",
    "readFileSync",
    "createHash",
    "PACKAGE_ROOT",
    src.slice(start, end) + "\nreturn { readPackageFileSha };",
  )(path.join, fs.statSync, fs.readFileSync, crypto.createHash, tmp);

  const sha = crypto.createHash("sha256").update("abc").digest("hex");
  ok(readPackageFileSha("lib/client.js") === sha, "算出的 sha256 与直接哈希一致");

  fs.writeFileSync(file, "abcd"); // 体积变了 -> 缓存键失效
  const sha2 = crypto.createHash("sha256").update("abcd").digest("hex");
  ok(readPackageFileSha("lib/client.js") === sha2, "文件变化后重新计算（缓存会失效）");
  ok(readPackageFileSha("lib/missing.js") === null, "文件不存在时返回 null 而不是抛错");

  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
