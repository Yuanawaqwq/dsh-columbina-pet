// 1.2.6 · 收尾三件套：
// ① 诊断日志开关能写进 main-config.jsonc（diagLog: true / 绝对路径 / 相对路径 / 关闭），环境变量仍优先；
// ② 桌面 helper 的「切换间隔」改成 <video loop> 无缝循环、到点摘 loop，不再每圈 seek 回 0 重播；
// ③ 天气：4 秒中间态、失败文案、旧数据标记、20 秒后台重试；
// ④ 网页端同一套口径（armDwell / stopDwell，不再靠 seek 重播）。
//
// 前两组是行为测试（把源码切出来注入假对象跑），后两组是结构断言。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HOST_SRC = fs.readFileSync(path.join(ROOT, 'lib/index.js'), 'utf8');
const VOICE_SRC = fs.readFileSync(path.join(ROOT, 'runtime/electron-helper/voice/voice.js'), 'utf8');
const WEB_SRC = fs.readFileSync(path.join(ROOT, 'lib/client.js'), 'utf8');

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

// ============================================================
// ① 诊断日志开关（lib/index.js 的 diag-helpers）
// ============================================================
{
  const body = `
    let DIAG_LOG_FROM_CONFIG = "";
    ${slice(HOST_SRC, 'function diagLogPath(env = process.env) {', '\n}')}
    ${slice(HOST_SRC, 'function applyDiagLogSetting(file) {', '\n}')}
    return { apply: applyDiagLogSetting, path: diagLogPath, config: () => DIAG_LOG_FROM_CONFIG };
  `;
  const make = new Function('readJsonc', 'dshHomeDir', 'join', 'process', body);

  function build(json, home) {
    const calls = { read: [] };
    const impl = make(
      (file) => {
        calls.read.push(file);
        return json;
      },
      () => home,
      (...parts) => parts.join('/').replace(/\/+/g, '/'),
      { env: {} },
    );
    return { impl, calls };
  }

  const HOME = 'C:/Users/xhy/.dsh';

  // diagLog: true → 默认路径
  {
    const { impl } = build({ diagLog: true }, HOME);
    const got = impl.apply(HOME + '/columbina-pet/main-config.jsonc');
    ok(got === HOME + '/columbina-pet/diag.log', '① true 应该落到默认 diag.log（实得 ' + got + '）');
    ok(impl.path({}) === HOME + '/columbina-pet/diag.log', '① 关掉环境变量后 diagLogPath 要读配置值');
  }

  // diagLog: 绝对路径原样
  {
    const { impl } = build({ diagLog: 'D:/logs/pet.log' }, HOME);
    ok(impl.apply('x') === 'D:/logs/pet.log', '① Windows 绝对路径应该原样使用');
  }
  {
    const { impl } = build({ diagLog: '/var/log/pet.log' }, HOME);
    ok(impl.apply('x') === '/var/log/pet.log', '① POSIX 绝对路径应该原样使用');
  }

  // diagLog: 相对路径并到 columbina-pet 下
  {
    const { impl } = build({ diagLog: 'logs/a.log' }, HOME);
    ok(impl.apply('x') === HOME + '/columbina-pet/logs/a.log', '① 相对路径应该并到 <dshHome>/columbina-pet/ 下');
  }

  // 关闭：false / 缺省 / 空串 / 读配置抛错
  {
    const { impl } = build({ diagLog: false }, HOME);
    ok(impl.apply('x') === '' && impl.config() === '', '① diagLog: false 应该是关闭');
  }
  {
    const { impl } = build({}, HOME);
    ok(impl.apply('x') === '', '① 缺省 diagLog 应该是关闭（不碰文件系统）');
  }
  {
    const { impl } = build({ diagLog: '   ' }, HOME);
    ok(impl.apply('x') === '', '① 空白字符串应该按关闭处理');
  }
  {
    // readJsonc 抛错时不能把整个插件拖垮
    const impl = make(
      () => {
        throw new Error('bad jsonc');
      },
      () => HOME,
      (...p) => p.join('/'),
      { env: {} },
    );
    ok(impl.apply('x') === '', '① 配置读失败要静默关闭，不能外抛');
  }

  // 环境变量优先
  {
    const { impl } = build({ diagLog: true }, HOME);
    impl.apply('x'); // 先把配置读进去，否则 DIAG_LOG_FROM_CONFIG 还是空串
    ok(impl.path({ DSH_PET_DIAG_LOG: 'E:/tmp/diag.log' }) === 'E:/tmp/diag.log', '① DSH_PET_DIAG_LOG 应该优先于配置');
    ok(impl.path({ DSH_PET_DIAG_LOG: '   ' }) === HOME + '/columbina-pet/diag.log', '① 空的环境变量应该让位给配置');
    ok(impl.path(undefined) === HOME + '/columbina-pet/diag.log', '① 没有 env 对象时应该退回配置值');
  }

  // 接线：apply() 里必须在 ensureVoicePack/startHelper 之前调它
  ok(/applyDiagLogSetting\(join\(userRoot, "main-config\.jsonc"\)\)/.test(HOST_SRC), '① apply() 要读 main-config.jsonc 的 diagLog');
  const atApply = HOST_SRC.indexOf('applyDiagLogSetting(join(userRoot, "main-config.jsonc"))');
  const atHelper = HOST_SRC.indexOf('startHelper(', atApply);
  ok(atApply > 0 && atHelper > atApply, '① 读配置要发生在拉起 helper 之前');
}

// ============================================================
// ② 桌面 helper 的切换间隔：loop 无缝循环
// ============================================================
{
  const body = `
    ${slice(VOICE_SRC, '  function installAnimPacing(sprite) {', '\n  }')}
    return installAnimPacing;
  `;

  let now = 1000;
  const DateStub = { now: () => now };
  const timers = [];
  const installAnimPacing = new Function(
    'animIntervalMs',
    'setInterval',
    'clearInterval',
    'Date',
    body,
  )(
    2000,
    (fn) => {
      timers.push(fn);
      return timers.length;
    },
    () => {},
    DateStub,
  );

  function makeSprite() {
    const proto = {
      handleEnded() {
        this.endedCount += 1;
      },
      playOnce() {
        this.gen += 1;
      },
    };
    const s = Object.create(proto);
    s.front = 0;
    s.gen = 0;
    s.endedCount = 0;
    s.playback = null;
    s.reportPlayback = () => {};
    const mk = () => ({
      loop: false,
      currentTime: 0,
      play() {
        this.played = (this.played || 0) + 1;
        return { catch() {} };
      },
    });
    s.videoA = mk();
    s.videoB = mk();
    return s;
  }

  // 挂上 loop：playOnce → 即将成为前台的缓冲（front===0 → videoB）loop=true
  {
    timers.length = 0;
    const s = makeSprite();
    installAnimPacing(s);
    s.playOnce();
    ok(s.gen === 1, '② playOnce 之后 gen 应该自增（playOnce 被包了一层）');
    ok(s.videoB.loop === true, '② 开播时应该给即将成为前台的缓冲挂上 loop');
    ok(s.videoA.loop === false, '② 后台缓冲不该被挂上 loop');
    ok(timers.length === 1, '② 应该起一个巡检定时器');
  }

  // 到点摘 loop，并标记这一代
  {
    timers.length = 0;
    const s = makeSprite();
    installAnimPacing(s);
    s.playOnce();
    now += 500;
    timers.forEach((fn) => fn());
    ok(s.videoB.loop === true, '② 没到点不能摘 loop');
    ok(!s.__columbinaPaceDone, '② 没到点不能标记');
    now += 1600;
    timers.forEach((fn) => fn());
    ok(s.videoB.loop === false, '② 到点应该摘掉 loop（让这一遍自然放完）');
    ok(s.__columbinaPaceDone === s.gen, '② 到点应该把这一代记成「已停够」');
  }

  // 到点之后的这一遍放完 → 直接切下一段（不经兜底重播）
  {
    timers.length = 0;
    const s = makeSprite();
    installAnimPacing(s);
    s.playOnce();
    now += 2500;
    timers.forEach((fn) => fn());
    s.handleEnded();
    ok(s.endedCount === 1, '② 停够后的 normal ended 应该走原逻辑切下一段');
    ok(s.__columbinaPaceDone === 0, '② 标记用完要清零，别影响下一段');
    ok((s.videoB.played || 0) === 0, '② 主路径不该再 seek 重播（played 保持 0）');
  }

  // 兜底：loop 被别处改回 false，中途 ended 仍按老办法重播
  {
    timers.length = 0;
    const s = makeSprite();
    installAnimPacing(s);
    s.playOnce();
    s.videoB.loop = false; // 模拟 loop 没挂住
    s.front = 1; // ended 时前台已经翻过去了（switchTo 的 onReady 做的）
    s.handleEnded();
    ok(s.videoB.currentTime === 0, '② 兜底路径要把 currentTime 拨回 0');
    ok((s.videoB.played || 0) === 1, '② 兜底路径要重新 play 一次');
    ok(s.endedCount === 0, '② 兜底路径不该切下一段');
  }

  // 换段之后旧定时器不能再动新缓冲
  {
    timers.length = 0;
    const s = makeSprite();
    installAnimPacing(s);
    s.playOnce();
    const firstTimer = timers[0];
    s.gen += 1; // 模拟又换了一段
    s.videoB.loop = true;
    now += 5000;
    firstTimer();
    ok(!s.__columbinaPaceDone, '② 换代之后旧定时器不该误标已完成');
    ok(s.__columbinaPaceEl === null, '② 换代之后旧定时器要把挂环引用清空');
  }

  // 间隔为 0 时完全不碰 loop
  {
    timers.length = 0;
    const s = makeSprite();
    const install0 = new Function('animIntervalMs', 'setInterval', 'clearInterval', 'Date', body)(
      0,
      (fn) => {
        timers.push(fn);
        return timers.length;
      },
      () => {},
      DateStub,
    );
    install0(s);
    s.playOnce();
    ok(s.videoB.loop === false, '② 间隔 0（立即切）不该挂 loop');
    ok(timers.length === 0, '② 间隔 0 不该起巡检定时器');
    s.handleEnded();
    ok(s.endedCount === 1, '② 间隔 0 时 ended 直接切下一段');
  }

  // 早退保护：重复 install 不能重复包一层
  {
    const s = makeSprite();
    installAnimPacing(s);
    installAnimPacing(s);
    ok(s.__columbinaPacingPatched === true, '② 安装标记要置上');
  }
}

// ============================================================
// ③ 天气：中间态 / 失败文案 / 旧数据 / 重试
// ============================================================
{
  // 4 秒「云有点厚」中间态，三语齐全
  const speakWeather = slice(VOICE_SRC, 'function speakWeather(opts)', '}, 4000);');
  ok(/lang === 'ja' \? '雲が少し厚いみたい、もう少し待ってね…'/.test(speakWeather), '③ 日文中间态文案');
  ok(/lang === 'en' \? 'The readings are slow to come\.\.\. give me a moment…'/.test(speakWeather), '③ 英文中间态文案');
  ok(/云有点厚，再等等…/.test(speakWeather), '③ 中文中间态文案');
  ok(/\}, 4000\);/.test(VOICE_SRC), '③ 中间态要挂 4 秒后出现');

  // 中间态必须在拿到结果时被清掉，不能残留到下一次
  ok(/clearTimeout\(reassure\)/.test(VOICE_SRC), '③ 拿到结果 / 失败时都要清掉中间态定时器');

  // 旧数据标记：只写 HH:MM 的话，昨天那份会看着像今早那份 —— 跨天必须带日期
  {
    const ageSrc = slice(VOICE_SRC, 'function weatherAgeText(w) {', '\n  }');
    const RealDate = Date;
    function makeAge(lang, fixedNow) {
      function FakeDate(a) {
        return a === undefined ? new RealDate(fixedNow) : new RealDate(a);
      }
      FakeDate.now = () => fixedNow;
      return new Function('normLang', 'subLang', 'Date', ageSrc + '\nreturn weatherAgeText;')(
        (v) => (v || 'zh'), lang, FakeDate,
      );
    }
    const NOW = new RealDate(2026, 10, 19, 21, 30, 0).getTime();
    const at = (m, d, h, mi) => new RealDate(2026, m - 1, d, h, mi, 0).getTime();

    ok(makeAge('zh', NOW)({ at: at(11, 19, 9, 5) }) === '（旧数据 · 09:05）', '③ 今天的旧数据只写时分');
    ok(makeAge('zh', NOW)({ at: at(11, 18, 19, 13) }) === '（旧数据 · 11-18 19:13）', '③ 跨天的旧数据要带月日');
    ok(makeAge('zh', NOW)({ at: new RealDate(2025, 10, 18, 19, 13, 0).getTime() }) === '（旧数据 · 2025-11-18 19:13）', '③ 跨年的旧数据要带年份');
    ok(makeAge('zh', NOW)({ at: at(11, 19, 21, 27) }) === '', '③ 5 分钟内的新数据不加注解');
    ok(makeAge('zh', NOW)({ at: 0 }) === '', '③ 没有时间就不加注解');
    ok(makeAge('en', NOW)({ at: at(11, 18, 19, 13) }) === ' (older reading, 11-18 19:13)', '③ 英文旧数据标记');
    ok(makeAge('ja', NOW)({ at: at(11, 18, 19, 13) }) === '（古い記録・11-18 19:13）', '③ 日文旧数据标记');
  }

  // 失败文案要带「还会再试」的承诺，且气泡停留加长到 5600ms
  ok(/today's weather|今天的天气…这会儿问不到呢/.test(VOICE_SRC), '③ 失败文案要说清「问不到」');
  ok(/showBubble\(weatherFailText\(\), 5600, true\)/.test(VOICE_SRC), '③ 失败气泡应该比原来久一点（5600ms）');

  // 失败后 20 秒后台重试，且不弹气泡打扰
  ok(/\}, 20000\);/.test(VOICE_SRC), '③ 失败要挂 20 秒后的后台重试');

  // 两次尝试的预算：8s 主 + 400ms 间隔 + 4s 重试
  ok(/fetchJson\(url, 8000\)/.test(VOICE_SRC), '③ 主请求预算 8 秒');
  ok(/fetchJson\(url, 4000\)/.test(VOICE_SRC), '③ 重试预算 4 秒');
  ok(/setTimeout\(resolve, 400\)|, 400\)/.test(VOICE_SRC), '③ 两次尝试之间留 400ms，别把用户的重复点击吞掉');
}

// ============================================================
// ④ 网页端：同一套 loop 口径
// ============================================================
{
  ok(/const stopDwell = \(\) => \{/.test(WEB_SRC), '④ 网页端要有 stopDwell');
  ok(/const armDwell = \(el, gen\) => \{/.test(WEB_SRC), '④ 网页端要有 armDwell');
  ok(/const dwellTimerRef = useRef\(null\)/.test(WEB_SRC), '④ 巡检定时器要放 ref 里');
  ok(/const dwellDoneRef = useRef\(0\)/.test(WEB_SRC), '④ 到点标记要放 ref 里');

  const armBody = slice(WEB_SRC, 'const armDwell = (el, gen) => {', '\n\t\t};');
  ok(/el\.loop = true/.test(armBody), '④ armDwell 要挂 loop');
  ok(/genRef\.current !== gen/.test(armBody), '④ 巡检要认代，换代就自停');
  ok(/dwellDoneRef\.current = gen/.test(armBody), '④ 到点要记下这一代');

  ok(/if \(nextOnce\) armDwell\(el, gen\);/.test(WEB_SRC), '④ onReady 里只给一次性动画挂环');

  // 到点标记必须比对 gen，不能只判非零（拖拽/锁定早退会残留）
  ok(
    /dwellDoneRef\.current !== 0 && dwellDoneRef\.current === genRef\.current/.test(WEB_SRC),
    '④ 到点标记要认代，避免残留标记吞掉下一段',
  );

  // 主路径不再 seek 重播：currentTime = 0 只应该留在 replayFront 兜底里
  const holdBody = slice(WEB_SRC, 'const holdForDwell = () => {', '\n\t\t};');
  ok(!/currentTime/.test(holdBody), '④ holdForDwell 主路径不该再动 currentTime');
  ok(/dwellDoneRef\.current = 0;/.test(holdBody), '④ holdForDwell 命中后要清标记');
  ok(/stopDwell\(\)/.test(holdBody), '④ holdForDwell 命中后要收掉巡检');

  // 换源 / 改档位 / 卸载三处都要收环
  ok(/const gen = \+\+genRef\.current;\n\t\t\tstopDwell\(\);/.test(WEB_SRC), '④ 真要换源时先停掉上一段的环');
  ok(/stopDwell\(\);\n\t\t\t\tdwellDoneRef\.current = 0;\n\t\t\t\tdwellUntilRef\.current/.test(WEB_SRC), '④ 改档位要放掉当前这一段的环');
  ok(/stopSquash\(\);\n\t\t\t\tstopDwell\(\);/.test(WEB_SRC), '④ 卸载时要收掉巡检定时器');

  // 注释不能再把 seek 说成桌面同款
  ok(!/桌面 installAnimPacing 里 el\.currentTime = 0 \+ play\(\) 的同一招/.test(WEB_SRC), '④ 旧的漂移注释要改掉');
  ok(/桌面 1\.2\.6 已不再用 seek 重播/.test(WEB_SRC), '④ replayFront 要标明它只是兜底');
}

// ============================================================
if (fails.length > 0) {
  console.log(fails.map((f) => '  ✗ ' + f).join('\n'));
  console.log(`[1.2.6-polish] ${passed}/${passed + fails.length} 通过`);
  process.exit(1);
}
console.log(`[1.2.6-polish] ${passed}/${passed} 通过`);
