// 跑 test/ 下所有 test-*.cjs：零依赖、纯 node 内置模块、假 DOM。
// 用法：node test/run.mjs           全部
//       node test/run.mjs whisper   只跑名字含 whisper 的
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const filter = process.argv[2] || '';
const files = readdirSync(here)
  .filter((f) => /^test-.*\.cjs$/.test(f))
  .filter((f) => !filter || f.includes(filter))
  .sort();

if (files.length === 0) {
  console.error(`[test] 没有匹配的测试文件（filter=${filter || '无'}）`);
  process.exit(1);
}

let failed = 0;
const rows = [];
for (const f of files) {
  const started = Date.now();
  const r = spawnSync(process.execPath, [join(here, f)], { encoding: 'utf8' });
  const ms = Date.now() - started;
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const line = out.trim().split(/\r?\n/).filter(Boolean).pop() || '';
  const ok = r.status === 0;
  if (!ok) failed += 1;
  rows.push({ file: f, ok, ms, line });
  if (!ok) console.log(out.trim());
}

console.log('');
for (const row of rows) {
  console.log(`${row.ok ? 'PASS' : 'FAIL'}  ${row.file.padEnd(28)} ${String(row.ms).padStart(5)} ms  ${row.line}`);
}
console.log(`\n[test] ${rows.length - failed}/${rows.length} 个测试文件通过`);
process.exit(failed === 0 ? 0 : 1);
