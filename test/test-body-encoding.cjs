#!/usr/bin/env node
/* decodeBodyBuffer / looksMojibake 单元测试：切出 lib/index.js 里的两段实现，在 Node 里直接跑 */
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "lib", "index.js"), "utf8");

function grab(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`找不到函数 ${name}`);
  const end = src.indexOf("\n}", start);
  return src.slice(start, end + 2);
}

const code = [
  grab("decodeBodyBuffer"),
  grab("looksMojibake"),
  src.slice(src.indexOf("const MOJIBAKE_MARKS ="), src.indexOf("\n", src.indexOf("const MOJIBAKE_MARKS ="))),
].join("\n");
const { decodeBodyBuffer, looksMojibake } = new Function(
  code + "\nreturn { decodeBodyBuffer, looksMojibake };",
)();

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

const warn = console.warn;
const quiet = () => {
  console.warn = () => {};
};
const loud = () => {
  console.warn = warn;
};

console.log("decodeBodyBuffer");
const zh = "月亮困了……我们也散了吧。";
const utf8 = Buffer.from(JSON.stringify({ text: zh, image: "晚安" }), "utf8");
/* Node 的 Buffer 不能往 gb18030 编码，这里用 Python 预生成的固定字节：
   `{"text": "月亮困了……我们也散了吧。", "image": "晚安"}` 的 GB18030 形态 */
const GBK_HEX =
  "7b2274657874223a2022d4c2c1c1c0a7c1cba1ada1adced2c3c7d2b2c9a2c1cbb0c9a1a3222c2022696d616765223a2022cdedb0b2227d";
const gbk = Buffer.from(GBK_HEX, "hex");
const mojiAsUtf8 = (() => {
  // 模拟「GBK 字节被当作 UTF-8 硬解」的产物：含 U+FFFD
  const lossy = gbk.toString("utf8");
  return lossy;
})();

ok(decodeBodyBuffer(utf8) === utf8.toString("utf8"), "UTF-8 原样通过");
ok(!decodeBodyBuffer(utf8).includes("\uFFFD"), "UTF-8 结果无 U+FFFD");

quiet();
const fixed = decodeBodyBuffer(gbk);
loud();
ok(fixed === '{"text": "月亮困了……我们也散了吧。", "image": "晚安"}', "GBK 体按 GB18030 正确还原", JSON.stringify(fixed));
ok(JSON.parse(fixed).text === zh, "GBK 体还原后文本一致", JSON.stringify(JSON.parse(fixed).text));
ok(JSON.parse(fixed).image === "晚安", "GBK 体还原后配图名一致");

ok(mojiAsUtf8.includes("\uFFFD"), "前提：GBK 硬解确实产生 U+FFFD");

const ascii = Buffer.from("{\"text\":\"hi\"}", "utf8");
ok(decodeBodyBuffer(ascii) === "{\"text\":\"hi\"}", "纯 ASCII 不变");

const empty = Buffer.alloc(0);
ok(decodeBodyBuffer(empty) === "", "空体返回空串");

const latin = Buffer.from([0xff, 0xfe, 0x00, 0x41]);
quiet();
const lossy = decodeBodyBuffer(latin);
loud();
ok(typeof lossy === "string" && lossy.length > 0, "双失败时退回有损 UTF-8 不抛错", JSON.stringify(lossy));

console.log("looksMojibake");
ok(looksMojibake("月亮困了") === false, "正常中文不算乱码");
ok(looksMojibake("") === false, "空串不算乱码");
ok(looksMojibake(null) === false, "null 不算乱码");
ok(looksMojibake(undefined) === false, "undefined 不算乱码");
ok(looksMojibake(123) === false, "数字不算乱码");
ok(looksMojibake("\uFFFD") === true, "单个 U+FFFD 算乱码");
ok(looksMojibake("���?Բ飺?ܿ") === true, "用户报障样例算乱码");
ok(looksMojibake("锟斤拷") === true, "锟斤拷（双重转换痕迹）算乱码");
ok(looksMojibake("烫烫烫屯屯屯") === true, "烫烫烫/屯屯屯 也算乱码");
ok(looksMojibake("锟斤拷是常见的乱码梗，但台词里不会出现") === true, "含锟斤拷的整句仍算乱码");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
