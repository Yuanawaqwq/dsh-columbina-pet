// 1.2.7 · 天气链路：
// ① 手里的旧坐标过期了也先拿来用，不要每次点击都现场问 ipwho.is；
// ② 「重新定位」失败时退回旧坐标，不再让整句天气跟着塌；
// ③ 中文地名（geocoding）不挡天气请求：两边并行，地名最多再等 1.5s；
// ④ 手动点「今天的天气」先把手里那份端上气泡（带「哪一天的几点」），网络回来再换。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const VOICE_SRC = fs.readFileSync(path.join(ROOT, 'runtime/electron-helper/voice/voice.js'), 'utf8');

let passed = 0;
const fails = [];
function ok(cond, name) {
  if (cond) passed += 1;
  else fails.push(name);
}
function slice(src, startMarker, endMarker, from) {
  const start = src.indexOf(startMarker, from || 0);
  if (start < 0) throw new Error('missing start: ' + startMarker);
  const end = src.indexOf(endMarker, start);
  if (end < 0) throw new Error('missing end: ' + endMarker);
  return src.slice(start, end + endMarker.length);
}

const GEO_KEY = 'columbina-voice-geo-v1';
const CACHE_KEY = 'columbina-voice-weather-v1';
const DAY = 24 * 60 * 60 * 1000;

// 把整段天气取数逻辑切出来单独跑（从本地缓存键常量到 weatherWords 之前）
const REGION_START = VOICE_SRC.indexOf("  var WEATHER_GEO_KEY = 'columbina-voice-geo-v1';");
const REGION_END = VOICE_SRC.indexOf('  function weatherWords() {', REGION_START);
if (REGION_START < 0 || REGION_END < 0) throw new Error('weather region not found');
const REGION = VOICE_SRC.slice(REGION_START, REGION_END);

const WAIT = () => new Promise((r) => setTimeout(r, 0));

function build(fetchImpl) {
  const calls = { urls: [], store: {}, bubbles: [] };
  const window = {
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(calls.store, k) ? calls.store[k] : null),
      setItem: (k, v) => { calls.store[k] = v; },
    },
  };
  class FakeAbortController {
    constructor() { this.signal = {}; }
    abort() { /* ignore */ }
  }
  const make = new Function(
    'window', 'normLang', 'subLang', 'bank', 'fetch', 'AbortController', 'setTimeout', 'clearTimeout',
    REGION + '\nreturn { locate, readWeather, savedGeo, geoFresh, localizeCityWithin,' +
      ' K: { geo: WEATHER_GEO_KEY, cache: WEATHER_CACHE_KEY, ttl: WEATHER_TTL_MS, geoTTL: WEATHER_GEO_TTL_MS },' +
      ' setGeo: function (g) { weatherGeo = g; }, setCache: function (c) { weatherCache = c; } };',
  );
  const api = make(
    window,
    (v) => v || 'zh',
    'zh',
    { menu: [] },
    (url) => { calls.urls.push({ url, at: Date.now() }); return fetchImpl(url); },
    FakeAbortController,
    setTimeout,
    clearTimeout,
  );
  return { api, calls };
}

function geoData(city, lat, lon) {
  return {
    ok: true,
    json: () => Promise.resolve({
      success: true, city, region: '', country: 'China', country_code: 'CN', latitude: lat, longitude: lon,
    }),
  };
}

function weatherData() {
  return {
    ok: true,
    json: () => Promise.resolve({
      current: { temperature_2m: 21.4, relative_humidity_2m: 66, weather_code: 3, wind_speed_10m: 12.2 },
      daily: { temperature_2m_max: [25.1], temperature_2m_min: [17.2], weather_code: [3] },
      timezone: 'Asia/Shanghai',
    }),
  };
}

function cityData() {
  return {
    ok: true,
    json: () => Promise.resolve({ results: [{ name: '广州' }] }),
  };
}

function seedGeo(calls, at) {
  calls.store[GEO_KEY] = JSON.stringify({ city: 'Guangzhou', lat: 23.1291, lon: 113.2644, countryCode: 'CN', at });
}

(async function run() {
  const now = Date.now();

  // ① 旧坐标过期：照样先拿来用，别现场问 ipwho.is 再等一遍
  {
    const { api, calls } = build(() => new Promise(() => { /* 永不返回：走网络就会挂住 */ }));
    seedGeo(calls, now - 30 * DAY);
    const geo = await api.locate(false);
    ok(geo && geo.city === 'Guangzhou', '① 过期坐标仍然能用');
    ok(geo.at === now - 30 * DAY, '① 用的是存档里那份，不是新问来的');
    ok(api.geoFresh(geo) === false, '① 过期判定要准（24h）');
    ok(calls.store[GEO_KEY].indexOf('Guangzhou') >= 0, '① 存档没有被清掉');
  }

  // ② 重新定位失败：退回旧坐标，不抛错
  {
    const { api, calls } = build(() => Promise.reject(new Error('offline')));
    seedGeo(calls, now - 2 * DAY);
    const geo = await api.locate(true);
    ok(geo && geo.city === 'Guangzhou', '② 重新定位失败要退回旧坐标');
    ok(calls.urls.length >= 1 && calls.urls[0].url.indexOf('ipwho.is') >= 0, '② 确实试过网络');
    ok(calls.store[GEO_KEY].indexOf('Guangzhou') >= 0, '② 失败后存档还在');
  }

  // ③ 连旧坐标都没有：这次才真的报错
  {
    const { api } = build(() => Promise.reject(new Error('offline')));
    let err = null;
    try { await api.locate(true); } catch (e) { err = e; }
    ok(err && /offline/.test(err.message), '③ 一无所知时如实报错（交给上层兜底）');
  }

  // ④ 地名不挡天气：两个请求同时发出；地名再慢也最多等 2.5s，等不到就先按英文名播
  {
    const slowCity = new Promise((resolve) => setTimeout(() => resolve(cityData()), 4000));
    const { api, calls } = build((url) => {
      if (url.indexOf('ipwho.is') >= 0) return Promise.resolve(geoData('Guangzhou', 23.1291, 113.2644));
      if (url.indexOf('geocoding-api') >= 0) return slowCity;
      return Promise.resolve(weatherData());
    });
    const t0 = Date.now();
    const w = await api.readWeather({ fresh: true });
    const ms = Date.now() - t0;
    const weatherTry = calls.urls.find((u) => u.url.indexOf('open-meteo.com/v1/forecast') >= 0);
    const cityTry = calls.urls.find((u) => u.url.indexOf('geocoding-api') >= 0);
    ok(!!w && w.temp === 21, '④ 数据拿到了');
    ok(ms < 2800, '④ 地名卡住时最多等 2.5s 就走（实测 ' + ms + 'ms）');
    ok(!!weatherTry && !!cityTry && Math.abs(weatherTry.at - cityTry.at) < 200, '④ 两个请求是并行发出的');
    ok(w.city === 'Guangzhou', '④ 地名没等到就先用英文名播出去');
    slowCity.catch(() => {});
  }

  // ⑤ 地名够快就换成中文
  {
    const { api } = build((url) => {
      if (url.indexOf('ipwho.is') >= 0) return Promise.resolve(geoData('Guangzhou', 23.1291, 113.2644));
      if (url.indexOf('geocoding-api') >= 0) return Promise.resolve(cityData());
      return Promise.resolve(weatherData());
    });
    const w = await api.readWeather({ fresh: true });
    ok(w.city === '广州', '⑤ 地名回来了就播中文');
  }

  // ⑤.5 坐标过期刷新时，中文名不能丢（ipwho.is 只给英文，之前反查到的要接过来）
  {
    const { api, calls } = build((url) => {
      if (url.indexOf('ipwho.is') >= 0) return Promise.resolve(geoData('Guangzhou', 23.1291, 113.2644));
      return Promise.resolve(weatherData());
    });
    calls.store[GEO_KEY] = JSON.stringify({
      city: 'Guangzhou', lat: 23.1291, lon: 113.2644, countryCode: 'CN', cityZh: '广州', at: now - 2 * DAY,
    });
    const geo = await api.locate(true);
    ok(geo.city === 'Guangzhou', '⑤.5 重新定位拿到了新坐标');
    ok(geo.cityZh === '广州', '⑤.5 中文名跟着旧坐标一起接过来（别打回 Guangzhou）');
    const w = await api.readWeather({ fresh: true });
    ok(w.city === '广州', '⑤.5 播报里还是中文地名');
  }

  // ⑤.6 地名等超时了也不放弃：后台问到了会写进缓存，下一次就是中文
  {
    const { api, calls } = build((url) => {
      if (url.indexOf('geocoding-api') >= 0) return new Promise((r) => setTimeout(() => r(cityData()), 600));
      return Promise.resolve(geoData('Guangzhou', 23.1291, 113.2644));
    });
    calls.store[GEO_KEY] = JSON.stringify({ city: 'Guangzhou', lat: 23.1291, lon: 113.2644, countryCode: 'CN', at: now });
    const geo = await api.localizeCityWithin({ city: 'Guangzhou', lat: 23.1291, lon: 113.2644, countryCode: 'CN' }, 100);
    ok(geo && !geo.cityZh, '⑤.6 超时先按英文名走');
    await new Promise((r) => setTimeout(r, 900));
    ok(String(calls.store[GEO_KEY] || '').indexOf('广州') >= 0, '⑤.6 后台问到了要落进缓存，下次直接中文');
  }

  // ⑥ 20 分钟内：直接给缓存，不再动网络
  {
    const { api, calls } = build(() => new Promise(() => { /* 不该被调用 */ }));
    api.setCache({ at: now - 3 * 60 * 1000, temp: 19, tmin: 17, tmax: 25, kind: 'over', city: '广州', code: 3 });
    const w = await api.readWeather({ fresh: false });
    ok(w && w.temp === 19, '⑥ 缓存命中要立刻返回');
    ok(calls.urls.length === 0, '⑥ 缓存命中不该发请求');
    const forced = api.readWeather({ fresh: true });
    await WAIT();
    ok(calls.urls.length > 0, '⑥ fresh:true 才真的去问网络');
    forced.catch(() => {});
  }

  // ⑦ 手动点的入口都要带 manual:true（面板 / 菜单 / helper 命令）
  {
    const hits = VOICE_SRC.split('speakWeather({ geo: !weatherGeo, manual: true })').length - 1;
    ok(hits === 2, '⑦ 面板与右键菜单都走手动模式（实际 ' + hits + ' 处）');
    ok(/speakWeather\(\{ geo: force === 'geo', manual: true \}\)/.test(VOICE_SRC), '⑦ helper 命令 weather 也走手动模式');
  }

  // ⑧ 手动模式：先端旧数据、网络回来再换，且不再插「云有点厚」
  {
    ok(/var manual = opts\.manual === true;/.test(VOICE_SRC), '⑧ speakWeather 认 manual');
    ok(/earlyText = weatherSummary\(snap\);/.test(VOICE_SRC), '⑧ 先把手里的那份算成一句');
    ok(/snap\.stale = Date\.now\(\) - \(Number\(snap\.at\) \|\| 0\) >= 5 \* 60 \* 1000;/.test(VOICE_SRC), '⑧ 旧数据要标成 stale');
    ok(/var reassure = earlyText \? null : setTimeout/.test(VOICE_SRC), '⑧ 已经有旧数据就不再插中间态');
    ok(/if \(summary !== earlyText\) \{/.test(VOICE_SRC), '⑧ 新旧一样就别重复刷气泡');
    ok(/if \(earlyText && retractBubble\(\)\) \{/.test(VOICE_SRC), '⑧ 换新的先收回旧气泡，不原地换字');
    ok(/function retractBubble\(\)/.test(VOICE_SRC), '⑧ 有收气泡的小工具');
    ok(/唔……让我再看一眼。/.test(VOICE_SRC), '⑧ 收起来之前先垫一句过渡（不静默换字）');
    ok(/var bridgeMinMs = 2000;/.test(VOICE_SRC), '⑧ 过渡句至少留 2 秒读完（不能闪一下就没）');
    ok(/var bridgeMaxMs = 6000;/.test(VOICE_SRC), '⑧ 数据迟迟不回时过渡句也一直挂着');
    ok(/snap\.city = String\(g0\.cityZh\);/.test(VOICE_SRC), '⑧ 旧数据里的英文地名先换回中文');
    ok(/weatherCache\.city = geo\.cityZh;/.test(VOICE_SRC), '⑧ 反查到中文名后顺手改天气存档，下次先端旧数据也是中文');
    ok(/readWeather\(\{ fresh: manual, geo: opts\.geo === true \}\)/.test(VOICE_SRC), '⑧ 手动点强制刷新，自动轮转仍吃缓存');
  }

  if (fails.length) {
    for (const f of fails) console.log('  ✗ ' + f);
    console.log('[1.2.7-weather] ' + passed + '/' + (passed + fails.length) + ' 通过');
    process.exitCode = 1;
  } else {
    console.log('[1.2.7-weather] ' + passed + '/' + passed + ' 通过');
  }
})();
