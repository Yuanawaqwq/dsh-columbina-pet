#!/usr/bin/env node
/**
 * 发版前置检查：确认 package.json `voicePack.url` 指向的语音包资产仍然可取、大小对得上。
 *
 * 为什么需要：语音包（约 33 MB）不在 npm 包体里，新装用户靠 `ensure-voice.mjs`
 * 从 GitHub Release 下载。它钉在 **v1.1.4 的不可变资产**上，是全世界新装用户的
 * 唯一语音来源；那个资产被删或被替换后，新装用户只会静默降级成「无原声」，
 * `/voice/repair` 也修不回来，而且没有任何信号。所以发版前跑一次这里。
 *
 * 用法：
 *   node scripts/check-voice-asset.mjs          # HEAD 一次，秒级
 *   node scripts/check-voice-asset.mjs --sha    # 完整下载并校验 sha256（约 33 MB，慢）
 *   node scripts/check-voice-asset.mjs --strict # 网络不可达也算失败（默认只算警告）
 *
 * 退出码：
 *   0  资产在、大小对（带 --sha 时 sha256 也对）
 *   1  资产没了 / 大小不对 / sha256 不对
 *   2  package.json 里 voicePack 配置不完整
 *   3  网络不可达，无法判定（默认不算失败；加 --strict 时会变成 1）
 *
 * 判定逻辑：直连失败时再试镜像前缀。镜像能取到、大小一致 ⇒ 资产还在，只是本机
 * 到 github.com 不通，报 3 而不是 1 —— 免得把网络问题当成资产丢失。
 * 传输层用 node:https（不用 fetch/undici）：Windows 上 fetch + AbortController
 * 在退出时偶发 libuv 断言崩溃（UV_HANDLE_CLOSING），也会污染退出码。
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import https from "node:https";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const pack = pkg.voicePack || {};
// 三个环境变量只为测试/临时指向用，正常发版不需要设置。
const url = String(process.env.DSH_VOICE_CHECK_URL || pack.url || "").trim();
const expectSha = String(process.env.DSH_VOICE_CHECK_SHA256 || pack.sha256 || "").toLowerCase();
const expectBytes = Number(process.env.DSH_VOICE_CHECK_BYTES || pack.bytes) || 0;
const wantSha = process.argv.includes("--sha");
const strict = process.argv.includes("--strict") || process.env.DSH_VOICE_CHECK_STRICT === "1";
const MIRRORS = ["https://gh-proxy.com/", "https://ghfast.top/"];
const TIMEOUT_MS = Number(process.env.DSH_VOICE_CHECK_TIMEOUT_MS) || 20000;

const say = (mark, text) => console.log(`${mark} ${text}`);
const fmt = (n) => n.toLocaleString("en-US");

/** 发一个请求，自动跟最多 5 跳重定向；body=false 时只取头部。 */
function request(target, { method = "HEAD", timeout = TIMEOUT_MS, onChunk } = {}) {
	return new Promise((ok) => {
		let hops = 0;
		const go = (current) => {
			const req = https.request(current, { method, timeout, headers: { "user-agent": "dsh-voice-check" } }, (res) => {
				const status = res.statusCode || 0;
				const location = res.headers.location;
				if (status >= 300 && status < 400 && location && hops < 5) {
					hops += 1;
					res.resume();
					go(new URL(location, current).href);
					return;
				}
				const bytes = Number(res.headers["content-length"]) || 0;
				if (!onChunk || method === "HEAD") {
					res.resume();
					res.on("end", () => ok({ status, bytes }));
					return;
				}
				const hash = createHash("sha256");
				let got = 0;
				res.on("data", (chunk) => {
					got += chunk.length;
					hash.update(chunk);
					onChunk(chunk);
				});
				res.on("end", () => ok({ status, bytes: got, sha: hash.digest("hex") }));
			});
			req.on("timeout", () => req.destroy(new Error(`超时 ${timeout} ms`)));
			req.on("error", (error) => ok({ status: 0, bytes: 0, error: error.message }));
			req.end();
		};
		go(target);
	});
}

function missing() {
	say("✗", "package.json 的 voicePack 需要 url + sha256（可选 bytes）");
	process.exitCode = 2;
}

async function main() {
	if (!url || !expectSha) return missing();

	say("·", `检查语音包资产：${url}`);
	if (expectBytes) say("·", `期望大小：${fmt(expectBytes)} B`);

	let direct = await request(url);
	let base = url;
	let viaMirror = false;

	if (direct.status === 200) {
		if (expectBytes && direct.bytes && direct.bytes !== expectBytes) {
			say("✗", `大小不符：拿到 ${fmt(direct.bytes)} B，package.json 写 ${fmt(expectBytes)} B`);
			return (process.exitCode = 1);
		}
		say("✓", `直连可取：200，${fmt(direct.bytes)} B`);
	} else {
		const verdict = direct.status === 0 ? `直连不可用（${direct.error || "网络错误"}）` : `直连返回 HTTP ${direct.status}`;
		say("⚠", `${verdict}，改试镜像…`);
		for (const mirror of MIRRORS) {
			const probe = await request(mirror + url);
			if (probe.status === 200) {
				if (expectBytes && probe.bytes && probe.bytes !== expectBytes) {
					say("✗", `${mirror} 取到的大小 ${fmt(probe.bytes)} B 与 package.json 不符`);
					return (process.exitCode = 1);
				}
				say("✓", `镜像可取：${mirror}（${fmt(probe.bytes)} B）⇒ 资产还在，是本机到 github.com 不通`);
				base = mirror + url;
				viaMirror = true;
				break;
			}
			say("·", `${mirror} → ${probe.status || probe.error}`);
		}
		if (!viaMirror) {
			if (direct.status === 404 || direct.status === 410) {
				say("✗", `资产不存在（HTTP ${direct.status}）——这个 Release 资产被删了，所有新装用户都下不到语音包`);
				return (process.exitCode = 1);
			}
			say("⚠", "无法判定：直连与镜像都取不到（大概率是本机网络，不是资产问题）");
			return (process.exitCode = strict ? 1 : 3);
		}
	}

	if (wantSha) {
		say("·", "下载并校验 sha256（约 33 MB）…");
		let last = 0;
		const got = await request(base, {
			method: "GET",
			timeout: 300000,
			onChunk: () => {
				last += 1;
				if (last % 4096 === 0) process.stdout.write(".");
			},
		});
		process.stdout.write("\n");
		if (got.status !== 200 || !got.sha) {
			say("⚠", `下载失败：${got.status || got.error}`);
			return (process.exitCode = strict ? 1 : 3);
		}
		if (expectBytes && got.bytes !== expectBytes) {
			say("✗", `下载大小不符：${fmt(got.bytes)} B`);
			return (process.exitCode = 1);
		}
		if (got.sha !== expectSha) {
			say("✗", `sha256 不符：拿到 ${got.sha}，package.json 写 ${expectSha}`);
			return (process.exitCode = 1);
		}
		say("✓", `sha256 一致：${got.sha.slice(0, 16)}…`);
	}

	if (viaMirror) {
		say("⚠", "结论：资产完好，但本机到 github.com 不通；发版本身不受影响（用户侧走官方地址）");
	} else {
		say("✓", "语音包资产自检通过");
	}
	process.exitCode = 0;
}

await main();
