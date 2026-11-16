// 面板文案三语静态扫描（issue 1.2.3 P1 的回归点）：
// 面板区域内所有 label / hint / placeholder / children 出现中文字面量时，必须包在
// webTr()/panelTr()/webFmt()/panelFmtArgs() 里——1.2.3 的「开/关」「秒」就是三元/拼接漏网。
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const CLIENT = path.join(REPO, 'lib/client.js');
const VOICE = path.join(REPO, 'runtime/electron-helper/voice/voice.js');
const MAIN = path.join(REPO, 'runtime/electron-helper/main.js');
const INDEX = path.join(REPO, 'lib/index.js');

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) {
    pass += 1;
    console.log('  ok  ' + name);
  } else {
    fail += 1;
    console.log('  FAIL ' + name + (detail ? ' — ' + detail : ''));
  }
}

const CJK = /[\u3400-\u9fff\u3040-\u30ff]/;
const WRAPPED = /webTr\(|panelTr\(|webFmt\(|panelFmtArgs\(/;
const KEY_FIELD = /(label|hint|placeholder|children):\s*([^,\n]*)/g;

/** 抽 [start, end) 之间的源码，按行找未包翻译函数的中文字面量。 */
function scanRegion(src, startMarker, endMarker) {
  const from = src.indexOf(startMarker);
  const to = src.indexOf(endMarker, from + startMarker.length);
  if (from < 0 || to < 0) throw new Error('找不到区域：' + startMarker + ' … ' + endMarker);
  const region = src.slice(from, to);
  const hits = [];
  region.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(KEY_FIELD)) {
      const expr = m[2];
      if (!CJK.test(expr) || WRAPPED.test(expr)) continue;
      hits.push(startMarker + ':' + (i + 1) + ' ' + line.trim().slice(0, 100));
    }
  });
  return hits;
}

const clientSrc = fs.readFileSync(CLIENT, 'utf8');
const voiceSrc = fs.readFileSync(VOICE, 'utf8');
const mainSrc = fs.readFileSync(MAIN, 'utf8');
const indexSrc = fs.readFileSync(INDEX, 'utf8');

// 1) 网页设置面板：makeWebSettingsPanel 到 PetCard 之间不得有裸中文文案
const webHits = scanRegion(clientSrc, 'function makeWebSettingsPanel', 'function PetCard(');
check('网页设置面板无未翻译的中文文案', webHits.length === 0, webHits.slice(0, 8).join(' | '));

// 2) helper 设置面板：linesBlock 到 panelClick 之间同样
const helperHits = scanRegion(voiceSrc, 'function linesBlock(', 'function panelClick(');
check('桌面设置面板无未翻译的中文文案', helperHits.length === 0, helperHits.slice(0, 8).join(' | '));

// 3) 定向回归：三处开关与间隔单位必须走 webTr / panelTr
check(
  '网页开关走 webTr（碎碎念）',
  clientSrc.includes('children: webTr(prefs.enabled ? "开" : "关", plang)'),
);
check(
  '网页开关走 webTr（静音 / 勿扰）',
  clientSrc.includes('children: webTr(volNow.muted ? "开" : "关", plang)') &&
    clientSrc.includes('children: webTr(quietNow.on ? "开" : "关", plang)'),
);
check(
  '网页间隔单位走 webTr',
  clientSrc.includes('+ " " + webTr("秒", plang)'),
);
check(
  '桌面间隔单位走 panelTr',
  voiceSrc.includes("intVal.textContent = intervalSec + ' ' + panelTr('秒');"),
);

// 4) 间隔范围两端一致：60–180
const intervalBlock = (() => {
  const at = clientSrc.indexOf('h(\"span\", { children: webTr(\"间隔\", plang) })');
  return at < 0 ? '' : clientSrc.slice(at, at + 520);
})();
const sliderMin = /min:\s*"(\d+)"/.exec(intervalBlock);
const sliderMax = /max:\s*"(\d+)"/.exec(intervalBlock);
check(
  '网页间隔滑杆为 60–180',
  Boolean(sliderMin && sliderMax && sliderMin[1] === '60' && sliderMax[1] === '180'),
  `min=${sliderMin && sliderMin[1]} max=${sliderMax && sliderMax[1]}`,
);
check('网页调度夹取 60–180', clientSrc.includes('Math.max(60, Math.min(180, Math.round(wvPrefsRef.current.intervalSec || 90)))'));
check('网页调度不再放行 15 秒', !clientSrc.includes('Math.max(15,'));
check(
  '桌面夹取函数为 60–180',
  /function clampInterval\(value\)\s*\{[\s\S]{0,200}?Math\.min\(180, Math\.max\(60/.test(voiceSrc),
);

// 5) panelJumpSection 默认不跳段
check('panelJumpSection 默认 false', /var panelJumpSection = false;/.test(voiceSrc));
check(
  '菜单点名时才跳段',
  /panelJumpSection = true; renderPanel\(\); return;/.test(voiceSrc),
);

// 6) 托盘三语
check('托盘有三语表', /TRAY_I18N = \{/.test(mainSrc) && /ja:\s*\{[^}]*デスクトップのみ/.test(mainSrc));
check('托盘 label 走 displayChoices()', /label: choice\.label/.test(mainSrc) && /displayChoices\(trayLang\)/.test(mainSrc));
check('托盘 tooltip 走三语', /tray\.setToolTip\(table\.tooltip\)/.test(mainSrc));
check(
  '托盘不再写死中文 label',
  !/label: '仅网页'/.test(mainSrc) && !/label: '都不（隐藏）'/.test(mainSrc),
);
check('托盘读 prefs.json 的 menuLang', /prefs\.menuLang/.test(mainSrc) && /\.dsh', 'columbina-pet', 'voice', 'prefs\.json'/.test(mainSrc));
check('托盘语言变化会重建菜单', /watchTrayLang\(\)/.test(mainSrc) && /applyTrayMenu\(\);/.test(mainSrc));

// 8) helper 改语言后把偏好推给宿主（托盘与网页端才能读到同一次改动）
check('helper 有 pushPrefsToHost', /function pushPrefsToHost\(\)/.test(voiceSrc));
check(
  "helper 推送到 /voice-prefs",
  /postAction\(BASE \+ '\/voice-prefs'/.test(voiceSrc),
);
check(
  '推送带上 menuLang 与 panelLang',
  /menuLang: menuLang,\s*\n\s*panelLang: panelLang,/.test(voiceSrc),
);
check('writeLocalPrefs 末尾会推送', /\n\s*pushPrefsToHost\(\);/.test(voiceSrc));

// 9) 宿主 /voice-prefs 的 intervalSec 夹取与 UI 对齐 60–180
check(
  '宿主夹取 intervalSec 60–180',
  /Math\.min\(180, Math\.max\(60, Math\.round\(payload\.intervalSec\)\)\)/.test(indexSrc),
);

// 10) 字典尾部没有 ',},' 的仓促排版
check('字典尾部排版整齐', !clientSrc.includes('",},') && !voiceSrc.includes('",},'));
// 7) display-changes.ndjson 有轮转 + 冷启动只读尾部
check('审计日志有体积上限常量', /DISPLAY_CHANGE_LOG_MAX_BYTES/.test(indexSrc));
check('审计日志轮转函数存在', /function rotateDisplayChangeLog|const rotateDisplayChangeLog = /.test(indexSrc));
check('冷启动只读尾部', /stat2\.size - 64 \* 1024|64 \* 1024/.test(indexSrc));

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
