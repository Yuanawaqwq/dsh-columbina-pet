// 假 DOM 里跑 voice.js，验证设置面板的「音量」「夜间勿扰」两节真的渲染出来了
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const REPO = require('path').join(__dirname, '..');
const SRC = path.join(REPO, 'runtime/electron-helper/voice/voice.js');
const src = fs.readFileSync(SRC, 'utf8');

function makeEl(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    id: '',
    _html: '',
    children: [],
    style: { setProperty() {}, getPropertyValue() { return ''; } },
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    attributes: {},
    value: '',
    textContent: '',
    scrollTop: 0,
    offsetTop: 0,
    offsetHeight: 0,
    offsetWidth: 0,
    isConnected: true,
    _on: {},
    addEventListener(type, fn) { (el._on[type] = el._on[type] || []).push(fn); },
    fire(type, ev) { (el._on[type] || []).forEach((fn) => fn(ev)); },
    removeEventListener() {},
    setAttribute(k, v) { el.attributes[k] = v; if (k === 'value') el.value = v; },
    getAttribute(k) { return el.attributes[k]; },
    removeChild() {},
    remove() {},
    appendChild(c) { el.children.push(c); return c; },
    insertAdjacentHTML() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 462, height: 600, bottom: 600, right: 462 }; },
    play() { return Promise.resolve(); },
    pause() {},
    load() {},
    cloneNode() { return makeEl(tag); },
    querySelector() { return makeEl('div'); },
    querySelectorAll() { return []; },
    closest() { return null; },
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._html; },
    set(v) { el._html = String(v); },
  });
  Object.defineProperty(el, 'className', {
    get() { return el._cls || ''; },
    set(v) { el._cls = String(v); },
  });
  return el;
}

const store = new Map();
const created = [];
const cvBody = makeEl('div'); // 假 DOM 不解析 innerHTML，单独给 #cv-body 一个稳定节点
const win = {};
const doc = {
  readyState: 'complete',
  hidden: false,
  currentScript: { src: 'file:///C:/pet/runtime/electron-helper/voice/voice.js' },
  documentElement: makeEl('html'),
  head: makeEl('head'),
  body: makeEl('body'),
  title: 'pet',
  createElement(tag) { const el = makeEl(tag); created.push(el); return el; },
  createTextNode(t) { return { nodeValue: String(t) }; },
  getElementById(id) {
    if (id === 'cv-body') return cvBody; // renderPanel 只往这个节点里写
    const hit = created.find((el) => el.id === id);
    if (hit) return hit;
    const el = makeEl('span'); // 面板里的小节点（#cv-int-val 等）：按 id 复用，便于断言
    el.id = id;
    created.push(el);
    return el;
  },
  querySelector() { return null; },
  querySelectorAll() { return []; },
  addEventListener() {},
  removeEventListener() {},
  execCommand() {},
};
const ctx = {
  window: win,
  document: doc,
  location: { search: '?configUrl=http://127.0.0.1:60087/dsh-columbina-pet-7340/config', href: 'file:///C:/pet/runtime/electron-helper/index.html' },
  navigator: { language: 'zh-CN', userAgent: 'node-test' },
  console: { log() {}, info() {}, warn() {}, error(...a) { console.error('[voice.js]', ...a); } },
  setTimeout() { return 0; },
  clearTimeout() {},
  setInterval() { return 0; },
  clearInterval() {},
  requestAnimationFrame() { return 0; },
  cancelAnimationFrame() {},
  fetch() { return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}), text: () => Promise.resolve('') }); },
  URL,
  URLSearchParams,
  Date,
  Math,
  JSON,
  Promise,
  Map,
  Set,
  Object,
  Array,
  String,
  Number,
  Boolean,
  RegExp,
  Error,
  isFinite,
  parseFloat,
  parseInt,
  encodeURIComponent,
  decodeURIComponent,
  Audio: function Audio() {
    return { play() { return Promise.resolve(); }, pause() {}, addEventListener() {}, load() {}, volume: 1, currentTime: 0, src: '' };
  },
  Image: function Image() { return makeEl('img'); },
  MutationObserver: function MutationObserver() { return { observe() {}, disconnect() {}, takeRecords() { return []; } }; },
  ResizeObserver: function ResizeObserver() { return { observe() {}, disconnect() {} }; },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  getComputedStyle: () => ({ getPropertyValue() { return ''; } }),
  localStorage: {
    getItem(k) { return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { store.set(k, String(v)); },
    removeItem(k) { store.delete(k); },
  },
  performance: { now: () => Date.now() },
  crypto: { randomUUID: () => 'x' },
  requestIdleCallback(cb) { return 0; },
  cancelIdleCallback() {},
};
ctx.window = win;
Object.assign(win, {
  document: doc,
  location: ctx.location,
  navigator: ctx.navigator,
  console: ctx.console,
  setTimeout: ctx.setTimeout,
  clearTimeout: ctx.clearTimeout,
  setInterval: ctx.setInterval,
  clearInterval: ctx.clearInterval,
  requestAnimationFrame: ctx.requestAnimationFrame,
  Audio: ctx.Audio,
  Image: ctx.Image,
  MutationObserver: ctx.MutationObserver,
  ResizeObserver: ctx.ResizeObserver,
  matchMedia: ctx.matchMedia,
  getComputedStyle: ctx.getComputedStyle,
  localStorage: ctx.localStorage,
  performance: ctx.performance,
  fetch: ctx.fetch,
  innerWidth: 2560,
  innerHeight: 1600,
  devicePixelRatio: 1.5,
  addEventListener() {},
  removeEventListener() {},
  __COLUMBINA_VOICE: {
    clips: [{ id: 'c1', file: 'official/a.ogg', text: '测试台词', scene: 'night', tags: [] }],
    menu: [],
    lines: [{
      label: '闲聊·歌',
      tab: '角色语音',
      t: { zh: '我的歌并不为谁而唱。', ja: '誰かのために歌うわけじゃない。', en: 'I do not sing for anyone in particular.' },
      f: { zh: 'zh/00.ogg', ja: 'ja/00.ogg', en: 'en/00.ogg' },
      labels: ['sing'],
    }],
    scenes: {},
  },
});

vm.createContext(ctx);
let loadErr = null;
try {
  vm.runInContext(src, ctx, { filename: 'voice.js' });
} catch (e) {
  loadErr = e;
}

const api = win.__columbinaVoice;
if (!api) {
  console.log('FAIL voice.js 没有挂上 window.__columbinaVoice' + (loadErr ? '：' + loadErr.message : ''));
  process.exit(1);
}

function panelHtml(section) {
  cvBody._html = '';
  api.openSettings(section);
  return cvBody._html;
}

const checks = [];
const vol = panelHtml('volume');
checks.push(['面板含 data-sec="volume"', /data-sec="volume"/.test(vol)]);
checks.push(['音量滑杆 0~100 step5', /type="range" min="0" max="100" step="5"[^>]*data-act="volume"/.test(vol)]);
checks.push(['滑杆默认值 90', /data-act="volume"[^>]*|value="90"/.test(vol) && /value="90"/.test(vol)]);
checks.push(['文本框 #cv-vol-val', /id="cv-vol-val"/.test(vol)]);
checks.push(['静音开关 data-act="mute"', /data-act="mute"/.test(vol)]);

const quiet = panelHtml('quiet');
checks.push(['面板含 data-sec="quiet"', /data-sec="quiet"/.test(quiet)]);
checks.push(['勿扰开关 data-act="quiet"', /data-act="quiet"/.test(quiet)]);
checks.push(['起点 input type=time', /type="time"[^>]*data-act="quiet-start"/.test(quiet)]);
checks.push(['终点 input type=time', /type="time"[^>]*data-act="quiet-end"/.test(quiet)]);
checks.push(['默认 23:00–08:00', /value="23:00"/.test(quiet) && /value="08:00"/.test(quiet)]);
checks.push(['时段摘要 #cv-quiet-val', /id="cv-quiet-val"/.test(quiet)]);

// ---- 交互：拖动滑杆 / 切换静音 / 改时段 ----
const panelEl = created.find((el) => el.id === 'columbina-voice-panel');
function fakeSlider(act, value) {
  return { id: '', value: String(value), getAttribute: (k) => (k === 'data-act' ? act : null) };
}
function fakeButton(act) {
  const el = { id: '', getAttribute: (k) => (k === 'data-act' ? act : null) };
  el.closest = (sel) => (/data-act/.test(sel) ? el : null);
  return el;
}
function volStore() {
  const raw = store.get('columbina-voice-volume-v1');
  return raw ? JSON.parse(raw) : null;
}
function quietStore() {
  const raw = store.get('columbina-voice-quiet-v1');
  return raw ? JSON.parse(raw) : null;
}

panelEl.fire('input', { target: fakeSlider('volume', 35) });
checks.push(['拖滑杆 → 存 0.35', (volStore() || {}).volume === 0.35]);

panelEl.fire('click', { target: fakeButton('mute') });
checks.push(['点静音 → 存 muted=true', (volStore() || {}).muted === true]);

panelEl.fire('input', { target: fakeSlider('volume', 70) });
checks.push(['拖到 70 → 自动解除静音', (volStore() || {}).muted === false && (volStore() || {}).volume === 0.7]);

panelEl.fire('change', { target: fakeSlider('quiet-start', '21:30') });
panelEl.fire('change', { target: fakeSlider('quiet-end', '07:15') });
checks.push(['改时段 21:30/07:15 → 存进偏好', (quietStore() || {}).start === 21 * 60 + 30 && (quietStore() || {}).end === 7 * 60 + 15]);

panelEl.fire('change', { target: fakeSlider('quiet-start', '25:99') });
checks.push(['非法时间被丢弃', (quietStore() || {}).start === 21 * 60 + 30]);

panelEl.fire('click', { target: fakeButton('quiet') });
checks.push(['点勿扰开关 → 存 on=true', (quietStore() || {}).on === true]);

// ---- 拖动间隔滑杆：即时生效、不重建面板、不跳滚动位置 ----
const localPrefs = () => {
  const raw = store.get('columbina-voice-local-v1');
  return raw ? JSON.parse(raw) : null;
};
cvBody.scrollTop = 120;
panelEl.fire('input', { target: fakeSlider('interval', 120) });
checks.push(['拖间隔滑杆 → 存 120 秒', (localPrefs() || {}).intervalSec === 120]);
checks.push(['拖间隔滑杆 → 文案跟着变', (created.find((el) => el.id === 'cv-int-val') || {}).textContent === '120 秒']);

const lenBefore = cvBody._html.length;
cvBody.scrollTop = 120;
panelEl.fire('click', { target: fakeButton('mute') });   // 这一步会重建面板
checks.push(['重渲染后滚动位置留在原地', cvBody.scrollTop === 120]);
checks.push(['重渲染确实发生了', cvBody._html.length > 0 && cvBody._html !== '']);

// ---- 面板语言：独立于菜单、可跟随、字典真的生效 ----
const langHtml = panelHtml('lang');
checks.push(['语言段有「面板」一行', /data-kind="panel"/.test(langHtml)]);
checks.push(['面板语言有「跟随菜单」选项（data-v 空串）', /data-act="lang" data-kind="panel" data-v=""/.test(langHtml)]);
checks.push(['面板语言默认跟随菜单（zh 下三个 chip 都不是当前）', !/data-kind="panel" data-v="ja">[^<]*<\/button>.*?class="cv-chip on"[^>]*data-kind="panel"/.test(langHtml)]);

api.setLang('panel', 'ja');
checks.push(['设置面板语言 → ja', api.lang.panel === 'ja']);
const jaPanel = panelHtml('voice');
checks.push(['日文面板文案生效', jaPanel.indexOf('つぶやき') >= 0 && jaPanel.indexOf('碎碎念') < 0]);
checks.push(['日文面板语言 chip 高亮在 日本語', /class="cv-chip on" data-act="lang" data-kind="panel" data-v="ja"/.test(jaPanel)]);

api.setLang('menu', 'en');
const enPanel = panelHtml('voice');
checks.push(['面板语言独立于菜单（菜单换 en 面板仍 ja）', enPanel.indexOf('つぶやき') >= 0 && enPanel.indexOf('Whisper') < 0]);

api.setLang('panel', '');
const followPanel = panelHtml('voice');
checks.push(['面板语言回到「跟随菜单」→ 用菜单语言', followPanel.indexOf('Whisper') >= 0]);
checks.push(['跟随菜单后 api.lang.panel 为空串', api.lang.panel === '']);

// ---- 台词列表：面板语言不是中文时显示该语言正文，不显示中文标题 ----
api.setLang('panel', 'ja');
const jaLines = panelHtml('lines');
checks.push(['日文面板台词列表显示日文标题（官方内文本「世間話・歌」）', jaLines.indexOf('世間話・歌') >= 0]);
checks.push(['日文面板台词列表不再出现中文标题', jaLines.indexOf('闲聊·歌') < 0]);
api.setLang('panel', 'zh');

let bad = 0;
for (const [name, ok] of checks) {
  if (!ok) bad += 1;
  console.log((ok ? 'ok   ' : 'FAIL ') + name);
}
console.log(bad === 0 ? `[voice-panel] ${checks.length}/${checks.length} 通过` : `[voice-panel] ${bad} 项失败`);
process.exit(bad === 0 ? 0 : 1);
