// 菜单树三语审计：en 树不得残留中文；ja 树不得出现「没翻译的中文键」。
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


// ---- 审计：构建右键菜单树，找仍然含中文的 label/hint ----
function makeElFixed(tag){ return makeEl(tag); }
const CJK = /[\u3400-\u9FFF\u3000-\u303F\uFF00-\uFFEF]/;
function buildOnce(lang){
  const captured = { opts: null };
  // 重新装载一份 voice.js，但先放一个 PetShared 桩
  const w2 = {};
  const store2 = new (require('vm').runInNewContext('Map'))();
  const created2 = [];
  const cvBody2 = makeEl('div');
  const d2 = {
    readyState: 'complete', hidden: false,
    currentScript: { src: 'file:///C:/pet/runtime/electron-helper/voice/voice.js' },
    documentElement: makeEl('html'), head: makeEl('head'), body: makeEl('body'), title: 'pet',
    createElement(tag){ const el = makeEl(tag); created2.push(el); return el; },
    createTextNode(t){ return { nodeValue: String(t) }; },
    getElementById(id){ if (id === 'cv-body') return cvBody2; const hit = created2.find(e => e.id === id); if (hit) return hit; const el = makeEl('span'); el.id = id; created2.push(el); return el; },
    querySelector(){ return null; }, querySelectorAll(){ return []; },
    addEventListener(){}, removeEventListener(){}, execCommand(){},
  };
  const c2 = Object.assign({}, ctx, { window: w2, document: d2 });
  w2.document = d2;
  w2.location = ctx.location; w2.navigator = ctx.navigator; w2.console = ctx.console;
  w2.setTimeout = ctx.setTimeout; w2.clearTimeout = ctx.clearTimeout; w2.setInterval = ctx.setInterval; w2.clearInterval = ctx.clearInterval;
  w2.requestAnimationFrame = ctx.requestAnimationFrame; w2.Audio = ctx.Audio; w2.Image = ctx.Image;
  w2.MutationObserver = ctx.MutationObserver; w2.ResizeObserver = ctx.ResizeObserver; w2.matchMedia = ctx.matchMedia;
  w2.getComputedStyle = ctx.getComputedStyle; w2.localStorage = ctx.localStorage; w2.performance = ctx.performance; w2.fetch = ctx.fetch;
  w2.innerWidth = 2560; w2.innerHeight = 1600; w2.devicePixelRatio = 1.5;
  w2.addEventListener = function(){}; w2.removeEventListener = function(){};
  w2.__COLUMBINA_VOICE_STATE = {};
  w2.PetShared = { mountContextMenu: function(opts){ captured.opts = opts; } };
  require('vm').createContext(c2);
  require('vm').runInContext(require('fs').readFileSync(require('path').join(REPO,'runtime/electron-helper/voice/voice-index.js'),'utf8'), c2, { filename: 'voice-index.js' });
  require('vm').runInContext(src, c2, { filename: 'voice.js' });
  const api2 = w2.__columbinaVoice;
  if (!api2) throw new Error('api missing');
  api2.setLang('menu', lang);
  // 字幕语言保持中文：这是用户的真实配置。摘要必须跟随菜单语言；
  // 以前这里连 sub 也设成同语言，才把「日英菜单里摘要仍是中文」掩盖住了。
  api2.setLang('sub', 'zh');
  w2.PetShared.mountContextMenu({ tree: [ { label: '对话', action: 'chat' }, { label: '回到初始位置', action: 'park' } ], onAction: function(){} });
  return captured.opts ? captured.opts.tree : [];
}
function walk(nodes, out, p){
  (nodes || []).forEach(function(n, i){
    if (!n || typeof n !== 'object') return;
    var here = p + '/' + (typeof n.label === 'string' ? n.label : ('#' + i));
    ['label','hint'].forEach(function(f){
      if (typeof n[f] === 'string' && CJK.test(n[f])) out.push((n.__columbinaLine !== undefined ? '[台词] ' : '') + f + ' @' + here + ' :: ' + n[f]);
    });
    if (Array.isArray(n.children)) walk(n.children, out, here);
  });
}

// ---- 词典里的中文源串：节点文本等于其中任何一个，说明该处没翻 ----
function zhKeys() {
  const out = new Set();
  const jaValue = {};
  ['var MENU_I18N = ', 'var PANEL_I18N = ', 'var TITLE_I18N = '].forEach(function (prefix) {
    const at = src.indexOf(prefix);
    if (at < 0) return;
    let i = src.indexOf('{', at), depth = 0, quote = null, end = -1;
    for (let j = i; j < src.length; j++) {
      const c = src[j];
      if (quote) { if (c === '\\') j++; else if (c === quote) quote = null; continue; }
      if (c === '"' || c === "'" || c === '\'') { quote = c; continue; }
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { end = j + 1; break; } }
    }
    const obj = new Function('return (' + src.slice(i, end) + ');')();
    Object.keys(obj.ja || {}).forEach(function (k) { out.add(k); jaValue[k] = obj.ja[k]; });
  });
  // 语言名 / 素材名这类本来就不该翻的键
  ['English', '中文', '日本語', '2D Live モデル'].forEach(function (k) { out.delete(k); });
  // 日文里写法本就相同的键（字幕 / 音量 / 音声 之类）不算没翻
  Object.keys(jaValue).forEach(function (k) { if (jaValue[k] === k) out.delete(k); });
  return out;
}

const ZH = zhKeys();
function collect(tree) {
  const labels = [];
  (function walk(nodes) {
    (nodes || []).forEach(function (n) {
      if (!n || typeof n !== 'object') return;
      ['label', 'hint'].forEach(function (f) {
        if (typeof n[f] === 'string' && n[f]) labels.push({ field: f, text: n[f] });
      });
      if (Array.isArray(n.children)) walk(n.children);
    });
  })(tree);
  return labels;
}

let pass = 0;
let fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass += 1; console.log('ok   ' + name); }
  else { fail += 1; console.log('FAIL ' + name + (detail ? ' :: ' + detail : '')); }
}

// 台词摘要必须跟随菜单语言：hint 不能还是字幕语言（中文）的正文
const LINES = (function () {
  const w = {};
  const c = require('vm').createContext(Object.assign({}, ctx, { window: w }));
  w.document = ctx.document;
  require('vm').runInContext(fs.readFileSync(require('path').join(REPO, 'runtime/electron-helper/voice/voice-index.js'), 'utf8'), c, { filename: 'voice-index.js' });
  return (w.__COLUMBINA_VOICE && w.__COLUMBINA_VOICE.lines) || [];
})();
function zhHints(tree, lang) {
  const out = [];
  (function walk(nodes) {
    (nodes || []).forEach(function (n) {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n.children)) walk(n.children);
      if (typeof n.hint === 'string' && typeof n.__columbinaLine === 'number') {
        const line = LINES[n.__columbinaLine];
        if (line && line.t) {
          const hint = n.hint.replace(/…$/, '');
          const target = String(line.t[lang] || '');
          const zh = String(line.t.zh || '');
          if (hint && zh.indexOf(hint) === 0 && target.indexOf(hint) !== 0) out.push(String(n.label) + ' | ' + n.hint);
        }
      }
    });
  })(tree);
  return out;
}
const enZhHints = zhHints(buildOnce('en'), 'en');
ok(enZhHints.length === 0, '英文菜单的台词摘要不是中文', enZhHints.slice(0, 3).join(' | '));
const jaZhHints = zhHints(buildOnce('ja'), 'ja');
ok(jaZhHints.length === 0, '日文菜单的台词摘要不是中文', jaZhHints.slice(0, 3).join(' | '));

const en = collect(buildOnce('en'));
const ja = collect(buildOnce('ja'));

const enCjk = en.filter(function (n) { return CJK.test(n.text); });
ok(enCjk.length === 0, '英文菜单树不含中文', enCjk.slice(0, 4).map(function (n) { return n.text; }).join(' | '));

const jaRaw = ja.filter(function (n) { return ZH.has(n.text); });
ok(jaRaw.length === 0, '日文菜单树没有未翻译的中文键', jaRaw.slice(0, 4).map(function (n) { return n.text; }).join(' | '));

ok(en.length > 60 && ja.length > 60, '两棵菜单树都拿到了足够多的节点', 'en=' + en.length + ' ja=' + ja.length);

const enVoice = en.filter(function (n) { return n.text === 'Voice lines' || n.text === 'Whisper settings'; });
ok(enVoice.length >= 2, '英文菜单里有 Voice lines / Whisper settings', String(enVoice.length));

const jaVoice = ja.filter(function (n) { return n.text === 'オリジナルボイス' || n.text === 'つぶやき設定'; });
ok(jaVoice.length >= 2, '日文菜单里有 オリジナルボイス / つぶやき設定', String(jaVoice.length));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
