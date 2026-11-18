// 1.2.5.1 · 天气节奏与闲聊兜底：
// ① fetchWeatherJson 两次尝试的预算必须是 8000ms + 400ms 间隔 + 4000ms，不能长到把用户的重复点击吞掉；
// ② weatherLine 在退回闲聊时，既要避开刚念过的那句，也要避开上一次天气闲聊用过的那句；
// ③ 用旧数据回答时要挂一个延迟后台刷新，而不是让旧数据一直躺在缓存里。
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'runtime/electron-helper/voice/voice.js');
const src = fs.readFileSync(SRC, 'utf8');

let passed = 0;
const fails = [];
function ok(cond, name) {
  if (cond) passed += 1;
  else fails.push(name);
}
function slice(startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  if (start < 0) throw new Error('missing start: ' + startMarker);
  const end = src.indexOf(endMarker, start);
  if (end < 0) throw new Error('missing end: ' + endMarker);
  return src.slice(start, end + endMarker.length);
}

// ---------- ① fetchWeatherJson 预算 ----------
const fetchSlice = slice('  function fetchWeatherJson(url) {', '\n  }');
const buildFetchWeatherJson = new Function(
  'fetchJson',
  'setTimeout',
  fetchSlice + '\nreturn fetchWeatherJson;'
);

async function budgetsFirstFail() {
  const calls = [];
  const fetchJson = function (url, ms) {
    calls.push(ms);
    return Promise.reject(new Error('net'));
  };
  const timers = [];
  const setTimeoutStub = function (fn, ms) {
    timers.push(ms);
    fn();
    return 1;
  };
  const fn = buildFetchWeatherJson(fetchJson, setTimeoutStub);
  let err = null;
  try {
    await fn('u');
  } catch (e) {
    err = e;
  }
  return { calls, timers, err };
}

async function budgetsFirstOk() {
  const calls = [];
  const fetchJson = function (url, ms) {
    calls.push(ms);
    return Promise.resolve({ ok: true });
  };
  const fn = buildFetchWeatherJson(fetchJson, function (f) { f(); return 1; });
  const value = await fn('u');
  return { calls, value };
}

// ---------- ② weatherLine 避重 ----------
function buildWeatherLine() {
  const body = slice('  function weatherLine(w) {', '\n  }');
  const wrapper =
    'var lastText = arguments[5];\n' +
    'var lastWeatherChatterText = "";\n' +
    body +
    '\nreturn { pick: weatherLine, get lastChatter() { return lastWeatherChatterText; } };';
  return new Function('WEATHER_LINE_LABELS', 'menuLineByLabel', 'lineList', 'chatLinePool', 'subtitleOf', 'LAST', wrapper);
}

function runWeatherLine(seedPool, lastText) {
  const pool = seedPool.map(function (t) { return { text: t }; });
  const factory = buildWeatherLine();
  const api = factory(
    {}, {},
    pool,
    function () { return pool; },
    function (line) { return line.text; },
    lastText
  );
  return api;
}

// ---------- ③ 旧数据要挂后台刷新 ----------
function staleRefreshWired() {
  return /端的是旧数据/.test(src) && /\},\s*8000\)/.test(src);
}

(async function main() {
  const a = await budgetsFirstFail();
  ok(JSON.stringify(a.calls) === JSON.stringify([8000, 4000]), 'fetchWeatherJson 先 8000 再 4000（实际 ' + JSON.stringify(a.calls) + '）');
  ok(a.timers.length === 1 && a.timers[0] === 400, '两次尝试之间只歇一次 400ms（实际 ' + JSON.stringify(a.timers) + '）');
  ok(!!a.err, '两次都失败时把错误抛给上层，交给旧缓存兜底');

  const b = await budgetsFirstOk();
  ok(JSON.stringify(b.calls) === JSON.stringify([8000]), '第一次成功就不再重试（实际 ' + JSON.stringify(b.calls) + '）');
  ok(b.value && b.value.ok === true, '成功时原样返回接口数据');

  const pool = ['闲聊·歌', '闲聊·月亮', '闲聊·漫步'];
  const w1 = runWeatherLine(pool, '别的台词');
  const pick1 = w1.pick({ mood: 'clear' });
  ok(pool.indexOf(pick1.text) >= 0, '晴天没有专属台词时退回闲聊（实际 ' + (pick1 && pick1.text) + '）');
  ok(w1.lastChatter === pick1.text, '选过之后记下这次用的闲聊句');
  const pick2 = w1.pick({ mood: 'clear' });
  ok(pick2.text !== pick1.text, '连续两次天气闲聊不会用同一句（' + pick1.text + ' → ' + pick2.text + '）');
  ok(pick2.text !== '别的台词', '也不会重复刚念过的那句');

  const w2 = runWeatherLine(pool, '闲聊·歌');
  const pick3 = w2.pick({ mood: 'clear' });
  ok(pick3.text !== '闲聊·歌', '刚念过的那句被排除（实际 ' + pick3.text + '）');

  const w3 = runWeatherLine(pool, '不相干');
  w3.pick({ mood: 'clear' });
  const afterFirst = w3.lastChatter;
  const w4 = runWeatherLine(pool, '不相干');
  w4.pick({ mood: 'clear' });
  ok(typeof afterFirst === 'string' && afterFirst.length > 0, '每一次天气闲聊都会更新避重记录');

  ok(staleRefreshWired(), '旧数据兜底时挂了延迟后台刷新（8s 后重试）');

  if (fails.length) {
    console.error('FAIL weather-pacing: ' + fails.join(' | '));
    process.exit(1);
  }
  console.log('PASS  test-weather-pacing.cjs        ' + passed + '/' + passed + ' passed');
})();
