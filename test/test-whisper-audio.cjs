// 碎碎念字幕「跟音频同寿」专项测试：假 DOM + 假音频元素 + 假时钟
const fs = require('fs');
const SRC = require('path').join(__dirname, '..', 'lib', 'client.js');
const src = fs.readFileSync(SRC, 'utf8');
const start = src.indexOf('//#region src/shared/whisper.ts');
const end = src.indexOf('//#endregion', start);
if (start < 0 || end < 0) throw new Error('whisper region not found');
const code = src.slice(start, end);
if (!/function trackWhisperSubtitleAudio\(/.test(code)) throw new Error('trackWhisperSubtitleAudio 不在 whisper region 里');

// ---- 假 DOM ----
function makeStyle() {
  const vars = new Map();
  return {
    cssText: '', left: '', top: '', width: '', height: '',
    setProperty(k, v) { vars.set(k, v); },
    getPropertyValue(k) { return vars.get(k) || ''; },
  };
}
function makeClassList() {
  const set = new Set();
  return { add(c) { set.add(c); }, remove(c) { set.delete(c); }, contains(c) { return set.has(c); }, _set: set };
}
function makeEl(tag) {
  const el = {
    tagName: String(tag).toUpperCase(), children: [], style: makeStyle(), classList: makeClassList(),
    attributes: {}, isConnected: false, textContent: '',
    _rect: { left: 0, top: 0, width: 0, height: 0 },
    appendChild(c) { c.isConnected = true; el.children.push(c); return c; },
    setAttribute(k, v) { el.attributes[k] = v; },
    getBoundingClientRect() { return el._rect; },
  };
  let cname = '';
  Object.defineProperty(el, 'className', {
    get() { return cname; },
    set(v) {
      cname = String(v);
      el.classList._set.clear();
      for (const c of cname.split(/\s+/).filter(Boolean)) el.classList._set.add(c);
    },
  });
  return el;
}
const root = makeEl('div');
root.isConnected = true;
root._rect = { left: 10, top: 20, width: 462, height: 600 };
root.style.setProperty('--dsh-pet-size', '462px');
root.style.setProperty('--dsh-pet-font-bubble', '21px');
const body = makeEl('body');
body.isConnected = true;
const doc = { body, createElement: (t) => makeEl(t), querySelector: (sel) => (sel === '.dsh-pet-root' ? root : null) };

// ---- 假时钟 + rAF ----
let now = 0, tseq = 1, rseq = 1;
const timers = new Map();
const rafs = new Map();
const win = {
  setTimeout(fn, ms) { const id = tseq++; timers.set(id, { fn, at: now + ms }); return id; },
  clearTimeout(id) { timers.delete(id); },
  requestAnimationFrame(cb) { const id = rseq++; rafs.set(id, cb); return id; },
  cancelAnimationFrame(id) { rafs.delete(id); },
  getComputedStyle: (el) => ({ getPropertyValue: (k) => el.style.getPropertyValue(k) }),
};
function tick() { const cbs = [...rafs.values()]; rafs.clear(); for (const cb of cbs) cb(now); }
function advance(ms) {
  now += ms;
  for (const [id, t] of [...timers]) if (t.at <= now) { timers.delete(id); t.fn(); }
}

const api = new Function('document', 'window', code +
  '\nreturn { showWhisperSubtitle, hideWhisperSubtitle, extendWhisperSubtitle, trackWhisperSubtitleAudio };')(doc, win);

// ---- 假音频元素 ----
function makeAudio() {
  const listeners = new Map();
  const a = {
    paused: true, ended: false, duration: NaN, currentTime: 0,
    addEventListener(type, fn, opts) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push({ fn, once: !!(opts && opts.once) });
    },
    fire(type) {
      const list = listeners.get(type) || [];
      listeners.set(type, list.filter((l) => !l.once));
      for (const l of list) l.fn();
    },
  };
  return a;
}

const results = [];
function check(name, cond, extra) {
  results.push({ name, ok: !!cond, extra });
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
}
const host = () => body.children.find((c) => c.attributes['data-dsh-pet-subtitle'] === '1');
const sub = () => host().children[0];

// 1. track 传入非音频 / 空文本时安全返回 false
check('track rejects empty text', api.trackWhisperSubtitleAudio(makeAudio(), '') === false);
check('track rejects non-audio', api.trackWhisperSubtitleAudio(null, '句子') === false);

// 2. 主场景：兜底 3600 先上字幕，随后音频真正开播（loadedmetadata 那一路已经错过）
api.showWhisperSubtitle('今晚的月色，比昨天更亮一点', 3600);
const a1 = makeAudio();
check('track accepts matching text', api.trackWhisperSubtitleAudio(a1, '今晚的月色，比昨天更亮一点') === true);
a1.duration = 9.2;
a1.paused = false;
a1.currentTime = 0.25;
a1.fire('timeupdate');                       // 第一跳校准：9.2 - 0.25 + 0.6 ≈ 9.55s
advance(3700);                               // 原先 3600 的兜底早该到点了
check('still on after fallback would have expired', sub().classList.contains('is-on'));
check('subtitle text intact', sub().textContent === '今晚的月色，比昨天更亮一点');

// 3. 播到 8.0s 时字幕还在，音频结束后立刻收
for (let t = 0.5; t <= 8.0; t += 0.25) {
  a1.currentTime = t;
  a1.fire('timeupdate');
  advance(250);
}
check('still on near end of audio', sub().classList.contains('is-on'));
a1.currentTime = 9.2;
a1.paused = true;
a1.ended = true;
a1.fire('ended');
check('hidden right after audio ended', !sub().classList.contains('is-on'));

// 4. 复活：字幕已经淡出、但音频还在读 —— 下一跳 timeupdate 把它接回来
api.showWhisperSubtitle('这一句会比较长一些', 3600);
advance(3700);
check('faded early (baseline)', !sub().classList.contains('is-on'));
const a2 = makeAudio();
a2.duration = 12;
a2.paused = false;
a2.currentTime = 3.75;
api.trackWhisperSubtitleAudio(a2, '这一句会比较长一些');   // 绑定时立即校准一次
check('bind revives the faded line', sub().classList.contains('is-on'));

// 5. 文案对不上就撒手：旧音频不能收掉 / 复活新一句
api.showWhisperSubtitle('新的一句台词', 3600);
a2.currentTime = 5.0;
a2.fire('timeupdate');
check('stale audio does not re-arm new text', sub().textContent === '新的一句台词' && sub().classList.contains('is-on'));
advance(3700);
check('new text fades on its own schedule', !sub().classList.contains('is-on'));
a2.ended = true;
a2.paused = true;
a2.fire('ended');
check('stale ended does not touch new text', sub().textContent === '新的一句台词');
a2.fire('timeupdate');
check('stale timeupdate does not revive new text', !sub().classList.contains('is-on'));

// 6. duration 拿不到（Infinity，Ogg 流常见）：靠 timeupdate 顶着，停播后自己收
const longText = '很长很长的一句话，长到如果按 3600ms 收尾的话，声音一定还在读，字幕却已经没了。';
api.showWhisperSubtitle(longText, 3600);
const a3 = makeAudio();
a3.duration = Infinity;
a3.paused = false;
a3.currentTime = 0;
api.trackWhisperSubtitleAudio(a3, longText);
for (let t = 0.25; t <= 8.0; t += 0.25) {
  a3.currentTime = t;
  a3.fire('timeupdate');
  advance(250);
}
check('unknown duration still on at 8s', sub().classList.contains('is-on'));
// 音频停了（暂停 / 被 stopWebVoice 掐掉）：不再有 timeupdate，1.5s 内自己收
a3.paused = true;
advance(1600);
check('unknown duration fades after playback stops', !sub().classList.contains('is-on'));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
