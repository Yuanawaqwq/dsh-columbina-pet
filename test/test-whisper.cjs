// 用假 DOM 跑 lib/client.js 里的 whisper 模块，验证：跟随 / 续命 / 收尾
const fs = require('fs');
const SRC = require('path').join(__dirname, '..', 'lib', 'client.js');
const src = fs.readFileSync(SRC, 'utf8');
const start = src.indexOf('//#region src/shared/whisper.ts');
const end = src.indexOf('//#endregion', start);
if (start < 0 || end < 0) throw new Error('whisper region not found');
const code = src.slice(start, end);

// ---- 假 DOM ----
function makeStyle() {
  const vars = new Map();
  return {
    cssText: '',
    left: '', top: '', width: '', height: '',
    setProperty(k, v) { vars.set(k, v); },
    getPropertyValue(k) { return vars.get(k) || ''; },
  };
}
function makeClassList() {
  const set = new Set();
  return {
    add(c) { set.add(c); },
    remove(c) { set.delete(c); },
    contains(c) { return set.has(c); },
    _set: set,
  };
}
function makeEl(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    style: makeStyle(),
    classList: makeClassList(),
    attributes: {},
    isConnected: false,
    textContent: '',
    _rect: { left: 0, top: 0, width: 0, height: 0 },
    appendChild(c) { c.isConnected = true; el.children.push(c); return c; },
    setAttribute(k, v) { el.attributes[k] = v; },
    getBoundingClientRect() { return el._rect; },
  };
  // 真实 DOM 里 className 赋值会同步 classList，测试桩也要跟上
  let cname = "";
  Object.defineProperty(el, "className", {
    get() { return cname; },
    set(v) {
      cname = String(v);
      el.classList._set.clear();
      for (const c of cname.split(/\s+/).filter(Boolean)) el.classList._set.add(c);
    },
  });
  return el;
}

const rootRect = { left: 10, top: 20, width: 462, height: 600 };
const root = makeEl('div');
root.isConnected = true;
root._rect = { ...rootRect };
root.style.setProperty('--dsh-pet-size', '462px');
root.style.setProperty('--dsh-pet-font-bubble', '21px');

const body = makeEl('body');
body.isConnected = true;
const doc = {
  body,
  createElement: (t) => makeEl(t),
  querySelector: (sel) => (sel === '.dsh-pet-root' ? root : null),
};

// ---- 假时钟 + rAF ----
let now = 0;
let tseq = 1;
const timers = new Map();
const rafs = new Map();
let rseq = 1;
const win = {
  setTimeout(fn, ms) { const id = tseq++; timers.set(id, { fn, at: now + ms }); return id; },
  clearTimeout(id) { timers.delete(id); },
  requestAnimationFrame(cb) { const id = rseq++; rafs.set(id, cb); return id; },
  cancelAnimationFrame(id) { rafs.delete(id); },
  getComputedStyle: (el) => ({ getPropertyValue: (k) => el.style.getPropertyValue(k) }),
};
function tick() { const cbs = [...rafs.values()]; rafs.clear(); for (const cb of cbs) cb(now); }
function advance(ms) { now += ms; for (const [id, t] of [...timers]) if (t.at <= now) { timers.delete(id); t.fn(); } }

const api = new Function('document', 'window', code +
  '\nreturn { showWhisperSubtitle, hideWhisperSubtitle, extendWhisperSubtitle };')(doc, win);

const results = [];
function check(name, cond, extra) {
  results.push({ name, ok: !!cond, extra });
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
}

// 1. 显示：浮层挂到 body，方框 = 宠物根节点矩形
check('show returns true', api.showWhisperSubtitle('今晚的月亮真好看', 5000) === true);
const host = body.children.find((c) => c.attributes['data-dsh-pet-subtitle'] === '1');
check('host mounted on body', !!host);
const sub = host && host.children[0];
check('subtitle text', sub && sub.textContent === '今晚的月亮真好看');
check('host box = root rect', host.style.left === '10px' && host.style.width === '462px',
  `left=${host.style.left} width=${host.style.width}`);
check('host inherits size vars', host.style.getPropertyValue('--dsh-pet-size') === '462px' &&
  host.style.getPropertyValue('--dsh-pet-font-bubble') === '21px');
check('is-on initially', sub.classList.contains('is-on'));

// 2. 跟随：宠物被拖到别处，下一帧浮层跟上
root._rect = { left: 305, top: 128, width: 462, height: 600 };
tick();
check('follows drag x', host.style.left === '305px', `left=${host.style.left}`);
check('follows drag y', host.style.top === '128px', `top=${host.style.top}`);

// 3. 缩放（换 2D 形象 / 模型大小）：宽度变化时重取字号变量
root._rect = { left: 305, top: 128, width: 320, height: 420 };
root.style.setProperty('--dsh-pet-size', '320px');
tick();
check('follows resize width', host.style.width === '320px', `width=${host.style.width}`);
check('refreshes size var on resize', host.style.getPropertyValue('--dsh-pet-size') === '320px');

// 4. 续命：同一句 → 接上；换了句 → 不接
check('extend same text', api.extendWhisperSubtitle('今晚的月亮真好看', 7300) === true);
check('extend other text rejected', api.extendWhisperSubtitle('另一句完全不同的台词', 7300) === false);

// 5. 到点自动淡出 + 停掉跟随循环
advance(7400);
check('auto fade removes is-on', !sub.classList.contains('is-on'));
const rafBefore = rafs.size;
tick();
check('follow loop stopped after fade', rafs.size === 0, `pending raf=${rafBefore}->${rafs.size}`);

// 6. 续命能把已淡出的同一句接回来（音频 metadata 迟到时就是这个场景）
api.showWhisperSubtitle('长句子测试', 3000);
advance(3100);
check('faded before extend', !sub.classList.contains('is-on'));
api.extendWhisperSubtitle('长句子测试', 6000);
check('extend resurrects same line', sub.classList.contains('is-on'));
advance(6100);
check('second fade works', !sub.classList.contains('is-on'));

// 7. 手动收起
api.showWhisperSubtitle('收起来', 9000);
api.hideWhisperSubtitle();
check('hide removes is-on', !sub.classList.contains('is-on'));
tick();
check('hide stops loop', rafs.size === 0);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
