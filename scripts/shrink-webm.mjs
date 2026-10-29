#!/usr/bin/env node
/**
 * 缩小 assets/webm 体积（保持 500×500 与 VP9 alpha 通道，画面无损级）。
 *
 * 背景：换装用的 246 段 live webm 是 VP8 + alpha，码率约 4.7 Mb/s，合计 147 MB，
 * 占整包体积的 80%。同类素材在桌面上只显示约 160–400 px，用 VP9 alpha 重编码到
 * crf 38 后单文件 741 KB → 155 KB，肉眼在小尺寸下几乎无差。
 *
 * 用法：
 *   FFMPEG=/path/to/ffmpeg node scripts/shrink-webm.mjs
 *   FFMPEG=... node scripts/shrink-webm.mjs --crf 36 --jobs 2
 *   FFMPEG=... node scripts/shrink-webm.mjs --backup D:/backup/webm-orig
 *
 * 默认原地替换；加 --backup <dir> 会把原件先复制过去。任何失败的文件保持原样。
 *
 * ⚠️ 必须用能写 VP8/VP9 alpha 侧信道的 ffmpeg（≥ 4.4 / 2021 以后）。ffmpeg 4.1 及更早
 * 的构建会把透明通道丢掉，输出成不透明白底——脚本无法自动识别，请在正式替换前用
 * 「解码一帧看角点 alpha 是否为 0」验证一次。
 */
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webmDir = resolve(here, "..", "assets", "webm");

const args = process.argv.slice(2);
const opt = (name, fallback) => {
	const i = args.indexOf(name);
	return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const ffmpeg = process.env.FFMPEG || "ffmpeg";
const crf = opt("--crf", "38");
const jobs = Math.max(1, Number(opt("--jobs", "2")));
const backupDir = opt("--backup", "");
const tmpDir = opt("--tmp", join(tmpdir(), "columbina-webm"));
if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

function run(cmd, argv) {
	return new Promise((ok, bad) => {
		const p = spawn(cmd, argv, { stdio: ["ignore", "ignore", "pipe"] });
		let err = "";
		p.stderr.on("data", (d) => (err += d.toString()));
		p.on("error", bad);
		p.on("close", (code) => (code === 0 ? ok() : bad(new Error(err.slice(-400) || `exit ${code}`))));
	});
}

const files = readdirSync(webmDir).filter((f) => f.toLowerCase().endsWith(".webm"));
if (!files.length) {
	console.error(`no webm in ${webmDir}`);
	process.exit(1);
}
if (backupDir) mkdirSync(backupDir, { recursive: true });

let original = 0;
let shrunk = 0;
let failed = 0;
let cursor = 0;

async function worker() {
	while (cursor < files.length) {
		const name = files[cursor++];
		const src = join(webmDir, name);
		const tmp = join(tmpDir, `${basename(name)}.tmp.webm`);
		const before = statSync(src).size;
		try {
			await run(ffmpeg, [
				"-hide_banner",
				"-loglevel",
				"error",
				"-y",
				"-i",
				src,
				"-map",
				"0:v:0",
				"-an",
				"-c:v",
				"libvpx-vp9",
				"-b:v",
				"0",
				"-crf",
				crf,
				"-pix_fmt",
				"yuva420p",
				"-auto-alt-ref",
				"0",
				tmp
			]);
			const after = statSync(tmp).size;
			if (!after || after >= before) throw new Error(`not smaller (${before} -> ${after})`);
			if (backupDir) copyFileSync(src, join(backupDir, name));
			copyFileSync(tmp, src);
			rmSync(tmp, { force: true });
			original += before;
			shrunk += after;
			console.log(`ok  ${name}  ${(before / 1024) | 0} KB -> ${(after / 1024) | 0} KB`);
		} catch (e) {
			failed++;
			if (existsSync(tmp)) rmSync(tmp, { force: true });
			console.error(`skip ${name}: ${e.message}`);
		}
	}
}

await Promise.all(Array.from({ length: jobs }, worker));

const mb = (n) => (n / 1024 / 1024).toFixed(1);
console.log(`\n${files.length} files, ${files.length - failed} shrunk, ${failed} skipped`);
console.log(`total ${mb(original)} MB -> ${mb(shrunk)} MB`);
process.exit(failed ? 2 : 0);
