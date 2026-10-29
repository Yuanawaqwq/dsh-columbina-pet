#!/usr/bin/env node
/**
 * 下载语音包（约 33 MB 官方语音切片）到 runtime/electron-helper/voice/official。
 *
 * 为什么外置：语音占整包约 18%，但只在「原声台词」开启且命中对应台词时才用到；
 * 把它从仓库里摘出去，安装体积能小一大截，需要时再拉一次即可（与 Electron 同一思路）。
 *
 * 用法：
 *   node scripts/ensure-voice.mjs
 *   DSH_VOICE_PACK_FILE=D:/packs/voice.tar.gz node scripts/ensure-voice.mjs   # 本地包
 *   DSH_VOICE_PACK_URL=https://... node scripts/ensure-voice.mjs              # 自定义地址
 *
 * 已有完整语音时直接退出（0）；下载失败时保持原状并退出（1），宿主侧按「无原声」降级。
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const voiceDir = join(root, "runtime", "electron-helper", "voice");
const zhDir = join(voiceDir, "official", "zh");
const markerDir = join(process.env.USERPROFILE || process.env.HOME || tmpdir(), ".dsh", "columbina-pet");
const markerFile = join(markerDir, "voice-pack.json");

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = pkg.version || "0.0.0";
const pack = pkg.voicePack || {};
const url = process.env.DSH_VOICE_PACK_URL || pack.url ||
	`https://github.com/Yuanawaqwq/dsh-columbina-pet/releases/download/v${version}/dsh-columbina-pet-voice-${version}.tar.gz`;
const expectSha = (process.env.DSH_VOICE_PACK_SHA256 || pack.sha256 || "").toLowerCase();

/** 统计中文语音文件数（0 表示未安装）。 */
function countOgg(dir = zhDir) {
	if (!existsSync(dir)) return 0;
	try {
		return readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".ogg")).length;
	} catch {
		return 0;
	}
}

const already = countOgg();
if (already >= 70) {
	console.log(`[voice] 已存在 ${already} 个中文语音，跳过下载`);
	process.exit(0);
}

function run(cmd, argv) {
	return new Promise((ok, bad) => {
		const p = spawn(cmd, argv, { stdio: ["ignore", "inherit", "inherit"] });
		p.on("error", bad);
		p.on("close", (code) => (code === 0 ? ok() : bad(new Error(`${cmd} exit ${code}`))));
	});
}

const tmp = join(tmpdir(), `dsh-columbina-voice-${version}.tar.gz`);

async function download() {
	if (process.env.DSH_VOICE_PACK_FILE) {
		copyFileSync(process.env.DSH_VOICE_PACK_FILE, tmp);
		return;
	}
	console.log(`[voice] 下载语音包 ${url}`);
	const res = await fetch(url, { redirect: "follow" });
	if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
	const total = Number(res.headers.get("content-length")) || 0;
	const chunks = [];
	let got = 0;
	for await (const chunk of res.body) {
		chunks.push(chunk);
		got += chunk.length;
		if (total && got % (4 * 1024 * 1024) < chunk.length) {
			process.stdout.write(`\r[voice] ${(got / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB`);
		}
	}
	process.stdout.write("\n");
	const buf = Buffer.concat(chunks);
	if (expectSha) {
		const sha = createHash("sha256").update(buf).digest("hex");
		if (sha !== expectSha) throw new Error(`sha256 不匹配：${sha}`);
	}
	writeFileSync(tmp, buf);
}

try {
	await download();
	mkdirSync(voiceDir, { recursive: true });
	await run(process.env.TAR_BIN || "tar", ["-xzf", tmp, "-C", voiceDir]);
	const n = countOgg();
	if (n < 70) throw new Error(`解包后中文语音只有 ${n} 个`);
	mkdirSync(markerDir, { recursive: true });
	writeFileSync(markerFile, JSON.stringify({ version, at: new Date().toISOString(), files: n }, null, 2));
	console.log(`[voice] 完成：${n} 个中文语音`);
	process.exit(0);
} catch (e) {
	console.error(`[voice] 下载失败：${e instanceof Error ? e.message : String(e)}`);
	console.error("[voice] 需要原声时请重跑 node node_modules/dsh-columbina-pet/scripts/ensure-voice.mjs");
	process.exit(1);
} finally {
	try {
		if (existsSync(tmp) && statSync(tmp).size > 0) rmSync(tmp, { force: true });
	} catch {}
}
