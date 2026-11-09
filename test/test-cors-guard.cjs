#!/usr/bin/env node
/* crossSiteWriteBlocked 判据矩阵测试 */
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "lib", "index.js"), "utf8");
const start = src.indexOf("function crossSiteWriteBlocked(");
const end = src.indexOf("\n}", start) + 2;
const { crossSiteWriteBlocked } = new Function(
  src.slice(start, end) + "\nreturn { crossSiteWriteBlocked };",
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

const blocked = (req) => crossSiteWriteBlocked(req) !== undefined;
const req = (method, headers = {}) => ({ method, headers });
const HOST = "127.0.0.1:56584";

console.log("跨站写");
ok(
  blocked(req("POST", { origin: "https://evil.example", "sec-fetch-site": "cross-site", host: HOST })),
  "跨站 POST /broadcast → 拦",
);
ok(
  blocked(req("PUT", { origin: "http://localhost:3000", "sec-fetch-site": "cross-site", host: HOST })),
  "跨站 PUT /config → 拦",
);
ok(
  blocked(req("DELETE", { origin: "https://evil.example", "sec-fetch-site": "cross-site", host: HOST })),
  "跨站 DELETE → 拦",
);
ok(
  blocked(req("POST", { origin: "https://evil.example", host: HOST })),
  "自称跨站但没 sec-fetch、Origin 不是本机 → 拦",
);

console.log("放行");
ok(!blocked(req("POST", { origin: `http://${HOST}`, "sec-fetch-site": "same-origin", host: HOST })), "同源页面 POST（网页端桌宠自己）→ 放行");
ok(!blocked(req("POST", { origin: `http://${HOST}`, host: HOST })), "同源但无 sec-fetch → 放行");
ok(!blocked(req("POST", { origin: "null", "sec-fetch-site": "cross-site", host: HOST })), "file:// 桌面 Helper（Origin: null）→ 放行");
ok(!blocked(req("POST", {})), "curl / node 脚本（无 Origin）→ 放行");
ok(
  !blocked(req("POST", { "sec-fetch-site": "cross-site", host: HOST })),
  "有 sec-fetch 但无 Origin（部分非浏览器客户端）→ 放行",
);

console.log("只读不拦");
ok(!blocked(req("GET", { origin: "https://evil.example", "sec-fetch-site": "cross-site" })), "跨站 GET /state → 不拦（CORS 挡读取）");
ok(!blocked(req("HEAD", { origin: "https://evil.example", "sec-fetch-site": "cross-site" })), "跨站 HEAD → 不拦");
ok(!blocked(req("OPTIONS", { origin: "https://evil.example", "sec-fetch-site": "cross-site" })), "跨站 OPTIONS → 不拦");

console.log("畸形输入");
ok(!blocked({}), "空对象 → 不拦（按 GET 处理）");
ok(!blocked({ method: "post", headers: {} }), "小写 method → 按写但无 Origin → 放行");
ok(!blocked({ method: "POST" }), "没有 headers → 不崩、放行");

const r = crossSiteWriteBlocked(req("POST", { origin: "https://evil.example", "sec-fetch-site": "cross-site" }));
ok(r !== undefined && r.reason === "cross-site-blocked", "返回结构带 reason", JSON.stringify(r));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
