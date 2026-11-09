#!/usr/bin/env node
/* sendFile Range 支持的真 HTTP 测试：切出实现，起本地 server，用 node:http 客户端验证 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { createReadStream } = require("fs");
const { fstatSync } = require("fs");

const src = fs.readFileSync(path.join(__dirname, "..", "lib", "index.js"), "utf8");
const start = src.indexOf("function parseRangeHeader(");
const end = src.indexOf("/** 该宠物是否参与桌面模式");
if (start < 0 || end < 0) throw new Error("切片失败");
const code = src.slice(start, end);

const { sendFile } = new Function(
  "createReadStream",
  "fstatSync",
  code + "\nreturn { sendFile };",
)(createReadStream, fstatSync);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pet-range-"));
const file = path.join(tmpDir, "sample.bin");
const BODY = Buffer.from("0123456789abcdefghij", "utf8"); // 20 字节
fs.writeFileSync(file, BODY);

const server = http.createServer((req, res) => {
  if (req.url === "/ok") sendFile(res, file, "application/octet-stream", req);
  else if (req.url === "/404") {
    res.writeHead(404);
    res.end();
  } else sendFile(res, path.join(tmpDir, "missing.bin"), "application/octet-stream", req);
});

function request(pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port: server.address().port, path: pathname, headers },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

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

server.listen(0, "127.0.0.1", async () => {
  try {
    console.log("sendFile");
    let r = await request("/ok");
    ok(r.status === 200, "无 Range → 200", r.status);
    ok(r.headers["accept-ranges"] === "bytes", "200 带 accept-ranges: bytes", r.headers["accept-ranges"]);
    ok(r.headers["content-length"] === String(BODY.length), "200 content-length = 20", r.headers["content-length"]);
    ok(r.body.equals(BODY), "200 返回完整 20 字节");

    r = await request("/ok", { Range: "bytes=0-9" });
    ok(r.status === 206, "Range 0-9 → 206", r.status);
    ok(r.headers["content-range"] === `bytes 0-9/${BODY.length}`, "206 content-range 正确", r.headers["content-range"]);
    ok(r.headers["content-length"] === "10", "206 content-length = 10", r.headers["content-length"]);
    ok(r.body.toString() === "0123456789", "206 前 10 字节正确", JSON.stringify(r.body.toString()));

    r = await request("/ok", { Range: "bytes=10-" });
    ok(r.status === 206, "开放式 Range 10- → 206", r.status);
    ok(r.body.toString() === "abcdefghij", "10- 返回后 10 字节", JSON.stringify(r.body.toString()));

    r = await request("/ok", { Range: "bytes=-5" });
    ok(r.status === 206, "后缀 Range -5 → 206", r.status);
    ok(r.headers["content-range"] === `bytes 15-19/${BODY.length}`, "后缀 content-range 正确", r.headers["content-range"]);
    ok(r.body.toString() === "fghij", "后缀返回末 5 字节", JSON.stringify(r.body.toString()));

    r = await request("/ok", { Range: "bytes=5-999" });
    ok(r.status === 206, "超出末端的 5-999 → 206", r.status);
    ok(r.headers["content-range"] === `bytes 5-19/${BODY.length}`, "末端被夹到 19", r.headers["content-range"]);
    ok(r.body.length === 15, "5-999 实际 15 字节", r.body.length);

    r = await request("/ok", { Range: "bytes=99-120" });
    ok(r.status === 416, "起点越界 → 416", r.status);
    ok(r.headers["content-range"] === `bytes */${BODY.length}`, "416 content-range */20", r.headers["content-range"]);

    r = await request("/ok", { Range: "items=0-9" });
    ok(r.status === 200, "非 bytes 单位 → 退 200", r.status);

    r = await request("/ok", { Range: "bytes=abc" });
    ok(r.status === 200, "畸形 Range → 退 200", r.status);

    r = await request("/ok", { Range: "bytes=0-9", "If-None-Match": '"x"' });
    ok(r.status === 206, "带 Range 时不走 304", r.status);

    const first = await request("/ok");
    const etag = first.headers["etag"];
    r = await request("/ok", { "If-None-Match": etag });
    ok(r.status === 304, "无 Range + 匹配 etag → 304", r.status);
    ok(r.body.length === 0, "304 无 body", r.body.length);

    let missingRejected = false;
    try {
      await request("/missing");
    } catch (e) {
      missingRejected = e.code === "ECONNRESET" || e.code === "ECONNABORTED";
    }
    ok(missingRejected, "缺失文件 → 连接被销毁（不挂、不长时间僵持）");
  } catch (e) {
    fail++;
    console.error("测试异常:", e);
  } finally {
    server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  }
});
