#!/usr/bin/env node
/* A+B 新增助手：diag 兜底 / DSH_PET_NO_HELPER / Electron 头部校验 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "lib", "index.js"), "utf8");
const start = src.indexOf("//#region diag-helpers");
if (start < 0) {
  console.log("FAIL 找不到 //#region diag-helpers 切片标记");
  process.exit(1);
}
const end = src.indexOf("//#endregion", start) + "//#endregion".length;
const { binaryHeaderAcceptable, electronBinaryUsable, diag, helperDisabledByEnv, diagLogPath } = new Function(
  "openSync",
  "readSync",
  "closeSync",
  "statSync",
  "appendFileSync",
  "renameSync",
  "unlinkSync",
  "Buffer",
  "PLAT",
  src.slice(start, end) +
    "\nreturn { binaryHeaderAcceptable, electronBinaryUsable, diag, helperDisabledByEnv, diagLogPath };",
)(fs.openSync, fs.readSync, fs.closeSync, fs.statSync, fs.appendFileSync, fs.renameSync, fs.unlinkSync, Buffer, process.platform);

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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-pet-diag-"));
const file = (name, buf) => {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, buf);
  return p;
};
/** 临时接管某个 console 方法，跑完后还原 */
const spy = (level, body) => {
  const original = console[level];
  const seen = [];
  console[level] = (m) => seen.push(m);
  try {
    body();
  } finally {
    console[level] = original;
  }
  return seen;
};

console.log("diag 兜底");
{
  const logged = [];
  const withWarn = { warn(m) { logged.push([m, this === withWarn]); } };
  const printed = spy("warn", () => {
    diag(withWarn, "warn", "打包日志");
    diag({}, "warn", "方法缺失");
    diag({ warn() { throw new Error("boom"); } }, "warn", "方法抛错");
    diag(null, "warn", "logger 为 null");
  });
  ok(printed.length === 4, "任何情况下都先打到 console（宿主终端可见）", JSON.stringify(printed));
  ok(printed[0] === "打包日志" && printed[3] === "logger 为 null", "console 上的消息原文不变");
  ok(logged.length === 1, "有该方法时才转给 logger，抛错的不算", String(logged.length));
  ok(logged[0] && logged[0][0] === "打包日志" && logged[0][1] === true, "转给 logger 时 this 仍绑定在 logger 上");
}
{
  const logged = spy("log", () => diag({}, "nope", "未知级别"));
  ok(logged[0] === "未知级别", "未知级别回退到 console.log");
}
{
  const printed = spy("error", () => {
    const logger = { error: () => { throw new Error("sink 崩了"); } };
    diag(logger, "error", "logger 抛错不吞消息");
  });
  ok(printed[0] === "logger 抛错不吞消息", "logger 侧抛错时 console 仍完整输出");
}

console.log("helperDisabledByEnv");
ok(helperDisabledByEnv({ DSH_PET_NO_HELPER: "1" }) === true, "=1 → 跳过");
ok(helperDisabledByEnv({ DSH_PET_NO_HELPER: "0" }) === false, "=0 → 不跳过");
ok(helperDisabledByEnv({}) === false, "未设置 → 不跳过");
ok(helperDisabledByEnv({ DSH_PET_NO_HELPER: "true" }) === false, "只认字面 1");

console.log("诊断日志文件（DSH_PET_DIAG_LOG）");
{
  const logFile = path.join(tmp, "diag.log");
  const saved = process.env.DSH_PET_DIAG_LOG;
  try {
    delete process.env.DSH_PET_DIAG_LOG;
    ok(diagLogPath() === undefined, "未设置时没有日志路径");
    spy("warn", () => diag({}, "warn", "不落盘"));
    ok(!fs.existsSync(logFile), "未设置时不碰文件系统");

    process.env.DSH_PET_DIAG_LOG = logFile;
    ok(diagLogPath() === logFile, "设置后取到路径");
    ok(diagLogPath({ DSH_PET_DIAG_LOG: "   " }) === undefined, "空白值不算设置");
    spy("warn", () => diag({}, "warn", "落盘一"));
    spy("error", () => diag({}, "error", "落盘二"));
    const text = fs.readFileSync(logFile, "utf8");
    ok(text.includes("[warn] 落盘一") && text.includes("[error] 落盘二"), "级别与原文都写进文件", JSON.stringify(text));
    ok(text.split("\n").filter(Boolean).length === 2, "两条各占一行");

    fs.writeFileSync(logFile, "x".repeat(2 * 1024 * 1024 + 10));
    spy("warn", () => diag({}, "warn", "轮转后"));
    ok(fs.existsSync(`${logFile}.1`), "超过 2MB 时旧文件轮转成 .1");
    ok(fs.readFileSync(logFile, "utf8").includes("轮转后"), "轮转后新消息进新文件");
    ok(fs.statSync(logFile).size < 1024, "轮转后当前文件很小", String(fs.statSync(logFile).size));
  } finally {
    if (saved === undefined) delete process.env.DSH_PET_DIAG_LOG;
    else process.env.DSH_PET_DIAG_LOG = saved;
  }
}

console.log("Electron 头部校验");
const pe = ({ dll = false, mz = true } = {}) => {
  const buf = Buffer.alloc(1536);
  if (mz) {
    buf[0] = 0x4d;
    buf[1] = 0x5a;
  }
  const peOff = 0x80;
  buf.writeUInt32LE(peOff, 60);
  buf.write("PE\0\0", peOff, "binary");
  let ch = 0x0102 | 0x0020; // 可执行 + LARGE_ADDRESS_AWARE
  if (dll) ch |= 0x2000;
  buf.writeUInt16LE(ch, peOff + 22);
  return buf;
};
const big = (buf) => Buffer.concat([buf, Buffer.alloc(6e6)]);

if (process.platform === "win32") {
  ok(binaryHeaderAcceptable(file("ok.exe", pe())) === true, "正常 PE 可执行 → 接受");
  ok(binaryHeaderAcceptable(file("lib.exe", pe({ dll: true }))) === false, "改了名的 DLL → 拒绝");
  ok(binaryHeaderAcceptable(file("text.exe", Buffer.from("#!/bin/sh\necho hi\n"))) === false, "纯文本 → 拒绝");
  ok(binaryHeaderAcceptable(path.join(tmp, "missing.exe")) === true, "读不到 → 不误杀");
  ok(electronBinaryUsable(file("big-ok.exe", big(pe()))) === true, "6MB 真 PE → 可用");
  ok(electronBinaryUsable(file("big-dll.exe", big(pe({ dll: true })))) === false, "6MB 改名 DLL → 不可用");
  ok(electronBinaryUsable(file("small-ok.exe", pe())) === false, "PE 但不足 1MB → 不可用");
} else {
  console.log(`  skip 非 Windows（PLAT=${process.platform}）：头部校验按设计不生效`);
  ok(binaryHeaderAcceptable(file("anything.bin", Buffer.from("whatever"))) === true, "非 win32 一律接受");
}
ok(electronBinaryUsable(path.join(tmp, "nope.exe")) === false, "文件不存在 → 不可用");

try {
  fs.rmSync(tmp, { recursive: true, force: true });
} catch {}

console.log(`\n[diag-helpers] ${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
