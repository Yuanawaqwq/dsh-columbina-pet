// 静态检查：网页端（lib/client.js）的语音菜单 / 设置面板要和桌面端（runtime/electron-helper/voice/voice.js）对齐。
// 只读源码做断言——不启动 React，也不需要浏览器。
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const client = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8');
const voice = fs.readFileSync(path.join(root, 'runtime', 'electron-helper', 'voice', 'voice.js'), 'utf8');

const results = [];
function check(name, ok) {
	results.push({ name, ok: !!ok });
	if (!ok) console.log('  FAIL ' + name);
}

// ---- 1. 两个自定义入口都从菜单进了设置面板（桌面靠 __columbinaOpenSettings，网页靠 action+value）----
check('网页菜单有「自定义音量…」', client.includes('label: "自定义音量…"'));
check('自定义音量跳 volume 段', /label: "自定义音量…"[\s\S]{0,160}?action: "web-panel"[\s\S]{0,40}?value: "volume"/.test(client));
check('网页菜单有「自定义时段…」', client.includes('label: "自定义时段…"'));
check('自定义时段跳 quiet 段', /label: "自定义时段…"[\s\S]{0,160}?action: "web-panel"[\s\S]{0,40}?value: "quiet"/.test(client));
check('桌面端同样两个入口（对拍基线）',
	voice.includes("label: '自定义音量…'") && voice.includes("label: '自定义时段…'"));

// ---- 2. 面板里有音量 / 夜间勿扰两段，且带 data-wsec 供跳段用 ----
check('面板有 volume 段', client.includes('"data-wsec": "volume"'));
check('面板有 quiet 段', client.includes('"data-wsec": "quiet"'));
check('音量滑杆是 0~100（步进 5）', /min: "0",\s*\n\s*max: "100",\s*\n\s*step: "5"/.test(client));
check('夜间勿扰有两个 time 输入', (client.match(/type: "time"/g) || []).length >= 2);
check('时间输入走 webParseHm 校验', client.includes('const mins = webParseHm(e.target.value);'));
check('非法时间直接忽略（不写坏值）', /if \(mins === null\) return;/.test(client));

// ---- 3. 跳段链路：web-panel 读 value → state → 面板滚动 ----
check('web-panel 认 value', /action === "web-panel"[\s\S]{0,120}?setPanelSection\(String\(leaf\$1\.value \|\| "voice"\)\)/.test(client));
check('panelSection state 存在', client.includes('const [panelSection, setPanelSection] = useState("voice");'));
check('面板收到 section', client.includes('section: panelSection,'));
check('跳段用 data-wsec 定位', client.includes("body.querySelector('[data-wsec=\"' + section + '\"]')"));
check('各「打开设置」叶子都带跳段目标',
	['lang', 'scale', 'idle', 'voice', 'assets'].every((k) => new RegExp('action: "web-panel",\\s*\\n?\\s*value: "' + k + '"').test(client)));
check('素材页叶子本来就是 assets', /label: "打开面板"[\s\S]{0,80}?value: "assets"/.test(client));

// ---- 4. 音量 / 勿扰真的落到播放与开口判断上 ----
check('播放时应用网页音量', client.includes('audio.volume = webEffectiveVolume();'));
check('勿扰时不自发开口', (client.match(/if \(webInQuiet\(\)\) return;/g) || []).length >= 2);
check('音量与勿扰各自一份 localStorage（不抢宿主设置）',
	client.includes('const WEB_QUIET_KEY = "columbina-voice-quiet-v1";') && client.includes('WEB_VOLUME_KEY'));

// ---- 5. 显示位置=两者时，网页端菜单不能退回最初始那套精简版 ----
check('网页菜单按 isWebVisible 判定而不是只认 web', client.includes('const isWeb = isWebVisible(cfg.display);'));

// ---- 6. 面板语言：独立于菜单，可跟随 ----
check('网页偏好默认 panelLang 空串（跟随菜单）', client.includes('panelLang: "",'));
check('面板按 plang 翻译', client.includes('const plang = prefs.panelLang || prefs.menuLang;') && client.includes('webTr(label, plang)'));
check('面板有「面板」语言行', client.includes('children: webTr("面板", plang)'));
check('面板语言有「跟随菜单」选项', client.includes('onClick: () => apply({ panelLang: "" })'));
check('面板语言四个 chip 都写同一字段', (client.match(/langChip\("panelLang", "/g) || []).length === 3);
check('宿主的 /voice-prefs 认 panelLang', /panelLang: normalizePanelLang\(payload\.panelLang\)/.test(require('fs').readFileSync(path.join(root, 'lib', 'index.js'), 'utf8')));
check('helper 也接受空串面板语言', voice.includes('function normPanelLang(v, fallback)') && voice.includes("if (v === '') return '';"));
check('helper 面板文案过 panelTr', voice.includes('function panelTr(text) { return trText(text, panelLangNow()); }') && voice.includes("'<div class=\"cv-sec\" data-sec=\"lang\">' + panelTr('语言') + '</div>'"));

// ---- 7. 两端补充字典同源（ja/en 条目数一致，防止只改一边） ----
const helperDict = voice.match(/var PANEL_I18N = \{([\s\S]*?)\n  \};/);
const webDict = client.match(/const WEB_MENU_EXTRA_I18N = \{([\s\S]*?)\n\};/);
const countKeys = (block, lang) => {
	if (!block) return -1;
	const seg = block.split(lang + ': {')[1];
	if (!seg) return -1;
	const body = seg.split('},')[0];
	return (body.match(/^\s+(['"]).*?\1\s*:/gm) || []).length;
};
check('helper 补充字典 ja 条目数 > 60', countKeys(helperDict && helperDict[1], 'ja') > 60);
const keySet = (block, lang) => {
	if (!block) return null;
	const seg = block.split(lang + ': {')[1];
	if (!seg) return null;
	const body = seg.split('},')[0];
	const out = new Set();
	const re = /^\s+(['"])(.*?)\1\s*:/gm;
	let m;
	while ((m = re.exec(body))) out.add(m[2]);
	return out;
};
function helperKeysCoveredByWeb(lang) {
	const a = keySet(helperDict && helperDict[1], lang);
	const b = keySet(webDict && webDict[1], lang);
	if (!a || !b) return false;
	for (const k of a) if (!b.has(k)) return false;
	return true;
}
check('网页补充字典覆盖 helper ja 的全部键', helperKeysCoveredByWeb('ja'));
check('网页补充字典覆盖 helper en 的全部键', helperKeysCoveredByWeb('en'));
check('webTr 合并补充字典', client.includes('Object.assign({}, WEB_MENU_EXTRA_I18N[lang] || {}, WEB_MENU_I18N[lang] || {})'));

// ---- 8. 桌面端这一轮修的两处，别回退 ----
check('桌面面板重渲染留在原地', voice.includes('var keepScroll = target.scrollTop;') && voice.includes('body.scrollTop = keepScroll;'));
check('桌面只有菜单点名才跳段', voice.includes("var panelJumpSection = false;") && voice.includes("panelJumpSection = true; renderPanel();"));
check('桌面拖间隔不重建面板', /act === 'interval'/.test(voice) && voice.includes("document.getElementById('cv-int-val')"));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
