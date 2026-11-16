// 静态检查：菜单 / 面板里的中文文案必须在 ja・en 字典里有条目。
// 背景：menuLang 切到 日本语 / English 后仍出现中文（2026-11-16 用户反馈，图二）。
// 只读源码，两端各扫一遍 label / hint / children / placeholder 的字面量。
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const voice = fs.readFileSync(path.join(root, 'runtime', 'electron-helper', 'voice', 'voice.js'), 'utf8');
const client = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8');

const CJK = /[\u4e00-\u9fff]/;

function region(src, start, end, name) {
	const i = src.indexOf(start);
	if (i < 0) throw new Error('找不到字典起点：' + name);
	const j = src.indexOf(end, i);
	if (j < 0) throw new Error('找不到字典终点：' + name);
	return src.slice(i, j + end.length);
}

/** 抽字典里的键（单双引号都认，一行多条也认） */
function keysOf(block) {
	const out = new Set();
	for (const m of block.matchAll(/['"]([^'"\n]{1,40})['"]\s*:/g)) out.add(m[1]);
	return out;
}

/** 扫源码里 label/hint/children/placeholder 的中文字面量，返回没进字典的 */
function missing(src, dict) {
	const miss = new Map();
	for (const m of src.matchAll(/(label|hint|children|placeholder):\s*['"]([^'"\n]{1,60})['"]/g)) {
		const text = m[2];
		if (!CJK.test(text) || dict.has(text)) continue;
		miss.set(text, (miss.get(text) || 0) + 1);
	}
	return miss;
}

const helperDict = new Set([
	...keysOf(region(voice, 'var MENU_I18N = {', '\n  };\n', 'MENU_I18N')),
	...keysOf(region(voice, 'var PANEL_I18N = {', '\n  };\n', 'PANEL_I18N'))
]);
const webDict = new Set([
	...keysOf(region(client, 'const WEB_MENU_I18N = {', '\n};\n', 'WEB_MENU_I18N')),
	...keysOf(region(client, 'const WEB_MENU_EXTRA_I18N = {', '\n};\n', 'WEB_MENU_EXTRA_I18N'))
]);

const results = [];
const helperMiss = missing(voice, helperDict);
const webMiss = missing(client, webDict);
results.push(['桌面端菜单/面板中文文案全部有 ja・en 条目', helperMiss.size === 0]);
results.push(['网页端菜单/面板中文文案全部有 ja・en 条目', webMiss.size === 0]);
// 字典本身要够大，避免「空字典也算通过」
results.push(['桌面端字典 ≥ 120 条', helperDict.size >= 120]);
results.push(['网页端字典 ≥ 120 条', webDict.size >= 120]);
// 台词分类名（来自 voice-index.js 的 menu 分组）也必须在字典里
const groups = ['闲聊', '问候', '关于我', '关于我们', '想要了解哥伦比娅', '关于同伴', '突破的感受', '战斗中的低语', '元素战技与爆发'];
results.push(['台词分类名都翻译了（桌面）', groups.every((g) => helperDict.has(g))]);
results.push(['台词分类名都翻译了（网页）', groups.every((g) => webDict.has(g))]);

// 动作切片名（素材文件名去掉当前形象前缀后显示在「动作」子菜单与面板待机列表里）也要翻译。
// 名字来自 assets/webm + voice-index 的 skins[].pool，所以按文件系统实时算，新增素材会立刻被这条测试拦住。
const webmDir = path.join(root, 'assets', 'webm');
const indexSrc = fs.readFileSync(path.join(root, 'runtime', 'electron-helper', 'voice', 'voice-index.js'), 'utf8');
const indexMatch = indexSrc.match(/window\.__COLUMBINA_VOICE\s*=\s*([\s\S]*?);\s*$/);
const bank = indexMatch ? JSON.parse(indexMatch[1]) : { skins: [] };
const actionNames = new Set();
for (const skin of bank.skins || []) {
	const prefix = skin.poolPrefix || skin.prefix || '';
	for (const name of skin.pool || []) {
		const label = prefix && String(name).indexOf(prefix) === 0 ? String(name).slice(prefix.length) : String(name);
		actionNames.add(label);
	}
}
if (!actionNames.size) {
	// 兜底：索引里没有 pool 时，直接按文件名去重（去掉第一个 · 之前的前缀）
	for (const file of fs.readdirSync(webmDir)) {
		if (!file.endsWith('.webm')) continue;
		const base = file.slice(0, -5);
		const cut = base.indexOf('·');
		actionNames.add(cut >= 0 ? base.slice(cut + 1) : base);
	}
}
const actionMissHelper = [...actionNames].filter((n) => !helperDict.has(n));
const actionMissWeb = [...actionNames].filter((n) => !webDict.has(n));
results.push(['动作切片名都翻译了（桌面，共 ' + actionNames.size + ' 个）', actionMissHelper.length === 0]);
results.push(['动作切片名都翻译了（网页，共 ' + actionNames.size + ' 个）', actionMissWeb.length === 0]);
if (actionMissHelper.length) console.log('  桌面缺：' + actionMissHelper.slice(0, 12).join(' / '));
if (actionMissWeb.length) console.log('  网页缺：' + actionMissWeb.slice(0, 12).join(' / '));

for (const [name, ok] of results) if (!ok) console.log('  FAIL ' + name);
if (helperMiss.size) console.log('  桌面端缺条目：' + [...helperMiss.keys()].join(' / '));
if (webMiss.size) console.log('  网页端缺条目：' + [...webMiss.keys()].join(' / '));
const failed = results.filter((r) => !r[1]).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
