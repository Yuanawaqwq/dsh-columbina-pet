/**
 * 哥伦比娅原声语音 · 桌宠旁挂脚本（v2）
 *
 * 放在 dsh-pet 的 runtime/electron-helper/voice/ 下，由 index.html 在 renderer.js 之后加载。
 * 不修改 dsh-pet 的任何源码：只读它的气泡 DOM，必要时借它的 PetSprite.showWhisper() 弹气泡。
 *
 * 三条发声路径：
 *   1) 对话回复：宿主把 AI 回复写进头顶气泡 → 本脚本按文字检索最贴的 1–2 段切片念出来。
 *   2) 碎碎念（v2 新增）：按「时段 + 场景标签」从 1325 段里挑一段，先把这句话显示成气泡，
 *      再播同一段切片 —— 于是字幕与语音永远是同一句。
 *   3) 手动：window.__columbinaVoice.whisper('night') / speak('谢谢你') 供排障与右键菜单使用。
 *
 * 所有命中都要过 technical() 与低置信度阈值：代码、命令、路径、报错一律不出声，只留文字。
 */
(function () {
  'use strict';
  if (window.__columbinaVoice) return;

  var bank = window.__COLUMBINA_VOICE;
  if (!bank || !bank.clips || !bank.clips.length) {
    console.warn('[columbina-voice] 没有找到语音索引 voice-index.js，语音功能关闭');
    return;
  }

  var SELF_SRC = (function () {
    return (document.currentScript && document.currentScript.src) || location.href;
  })();
  var CLIP_BASE = (function () {
    try {
      return new URL('clips/', SELF_SRC).href;
    } catch (e) {
      return 'clips/';
    }
  })();
  // 1.1.4 起官方语音外置到 ~/.dsh/columbina-pet/voice/official，包内不再带这个目录，
  // 所以优先用宿主提供的 HTTP 基准（与 configUrl 同源，走 /voice/official/ 路由）；
  // 旧版包内相对路径只作为兜底。
  var OFFICIAL_BASE = (function () {
    try {
      var cfgUrl = new URLSearchParams(location.search).get('configUrl');
      if (cfgUrl) return new URL('voice/official/', cfgUrl).href;
    } catch (e) { /* 走兜底 */ }
    try {
      return new URL('official/', SELF_SRC).href;
    } catch (e) {
      return 'official/';
    }
  })();
  var officialUnavailable = false;
  // 宿主的同源 HTTP 基准（/voice/health、/voice/repair 都挂在这个前缀下）；
  // OFFICIAL_BASE 已经是 <前缀>/voice/official/，往上退两级回到前缀根。
  var API_BASE = (function () {
    try {
      return new URL('../..', OFFICIAL_BASE).href;
    } catch (e) {
      return '';
    }
  })();

  var VOLUME = 0.9;
  // 音量 / 静音：桌宠自己记一份（localStorage），右键菜单里改，不占用宿主设置面板的键位。
  var VOLUME_KEY = 'columbina-voice-volume-v1';
  var volumePref = VOLUME;
  var mutedPref = false;   // true = 静音（音量归零，不改 volumePref）
  var MAX_CLIPS = bank.maxClips || 2;
  var STABLE_MS = 550;        // 气泡文字稳定多久才认为「说完了」
  var COOLDOWN_MS = 1200;     // 两次念之间至少隔这么久
  var WHISPER_MIN_MS = 75000; // 碎碎念间隔（下界）
  var WHISPER_MAX_MS = 150000;// 碎碎念间隔（上界）
  var ANIM_INTERVAL_KEY = 'columbina-voice-anim-interval';
  // 「动图放完之后再停多久才切下一段」：0 = 放完立即切，60000 = 放完后停满一分钟
  var ANIM_INTERVAL_CHOICES = [0, 1000, 2000, 3000, 5000, 8000, 12000, 20000, 30000, 45000, 60000];
  var animIntervalMs = 2000;
  var RECENT_MAX = 140;       // 记住最近念过哪些，避免重复

  // ---------- 三语（配音 / 字幕 / 菜单）与模型大小 ----------
  var LANGS = ['zh', 'ja', 'en'];
  var LANG_NAME = { zh: '中文', ja: '日本語', en: 'English' };
  var voiceLang = 'zh';
  var subLang = 'zh';
  var menuLang = 'zh';
  var SCALE_MIN = 0.5;
  var SCALE_MAX = 3;
  var SCALE_CHOICES = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];
  var scalePref = 1;

  function normLang(v, fallback) {
    return (v === 'zh' || v === 'ja' || v === 'en') ? v : (fallback || 'zh');
  }

  function clampScale(v) {
    var n = Number(v);
    if (!isFinite(n)) return 1;
    return Math.round(Math.min(SCALE_MAX, Math.max(SCALE_MIN, n)) * 100) / 100;
  }

  // ---------- 索引视图 ----------
  var byId = new Map();
  var byLabel = new Map();
  var recent = [];
  var POOL_MIN_MS = 600;
  var POOL_MAX_MS = 4600;

  for (var i = 0; i < bank.clips.length; i++) {
    var row = bank.clips[i];
    var clip = {
      id: row[0],
      text: row[1],
      duration: row[2] || 0,
      labels: row[3] ? String(row[3]).split(',') : ['musing'],
      tones: row[4] ? String(row[4]).split(',') : [],
    };
    byId.set(clip.id, clip);
    for (var j = 0; j < clip.labels.length; j++) {
      var key = clip.labels[j];
      if (!byLabel.has(key)) byLabel.set(key, []);
      byLabel.get(key).push(clip);
    }
  }

  // 拼合句：字幕对齐后拼回的一整句（几段切片连着念，字幕是那句完整的话）
  var lineList = [];
  var lineByLabel = new Map();
  var rawLines = bank.lines || [];
  for (var li = 0; li < rawLines.length; li++) {
    var lrow = rawLines[li];
    if (!lrow) continue;
    var line = null;
    if (Array.isArray(lrow)) {
      // 旧格式：[ids, text, dur, labels, segments, file]（只有中文一条音频）
      if (!Array.isArray(lrow[0])) continue;
      var legacyFile = typeof lrow[5] === 'string' ? lrow[5] : '';
      if (!lrow[0].length && !legacyFile) continue;
      var legacyText = String(lrow[1] || '');
      if (!legacyText) continue;
      var legacyDur = lrow[2] || 0;
      var legacySegs = Array.isArray(lrow[4]) ? lrow[4] : null;
      line = {
        index: lineList.length,
        ids: lrow[0],
        label: '',
        tab: '',
        t: { zh: legacyText, ja: legacyText, en: legacyText },
        d: { zh: legacyDur, ja: legacyDur, en: legacyDur },
        f: { zh: legacyFile, ja: legacyFile, en: legacyFile },
        s: { zh: legacySegs, ja: legacySegs, en: legacySegs },
        labels: lrow[3] ? String(lrow[3]).split(',') : ['musing'],
      };
    } else {
      // v10：{ label, tab, t, d, f, s, labels }
      if (!lrow.t || !lrow.t.zh) continue;
      line = {
        index: lineList.length,
        ids: [],
        label: String(lrow.label || ''),
        tab: String(lrow.tab || ''),
        t: {
          zh: String(lrow.t.zh || ''),
          ja: String(lrow.t.ja || lrow.t.zh || ''),
          en: String(lrow.t.en || lrow.t.zh || ''),
        },
        d: {
          zh: Number(lrow.d && lrow.d.zh) || 0,
          ja: Number(lrow.d && lrow.d.ja) || 0,
          en: Number(lrow.d && lrow.d.en) || 0,
        },
        f: {
          zh: String((lrow.f && lrow.f.zh) || ''),
          ja: String((lrow.f && lrow.f.ja) || ''),
          en: String((lrow.f && lrow.f.en) || ''),
        },
        s: {
          zh: (lrow.s && lrow.s.zh) || null,
          ja: (lrow.s && lrow.s.ja) || null,
          en: (lrow.s && lrow.s.en) || null,
        },
        labels: lrow.labels ? String(lrow.labels).split(',') : ['musing'],
      };
    }
    lineList.push(line);
    for (var lj = 0; lj < line.labels.length; lj++) {
      var lk = line.labels[lj];
      if (!lineByLabel.has(lk)) lineByLabel.set(lk, []);
      lineByLabel.get(lk).push(line);
    }
  }

  function lineTextOf(line, lang) {
    if (!line || !line.t) return '';
    var L = normLang(lang, 'zh');
    return line.t[L] || line.t.zh || '';
  }

  function lineFileOf(line, lang) {
    if (!line || !line.f) return '';
    var L = normLang(lang, 'zh');
    return line.f[L] || line.f.zh || '';
  }

  function lineDurOf(line, lang) {
    if (!line || !line.d) return 0;
    var L = normLang(lang, 'zh');
    return line.d[L] || line.d.zh || 0;
  }

  function lineSegsOf(line, lang) {
    var L = normLang(lang, 'zh');
    var segs = line.s && (line.s[L] || line.s.zh);
    if (Array.isArray(segs) && segs.length) return segs;
    return [[[], lineTextOf(line, L)]];
  }

  function subtitleOf(line) {
    return lineTextOf(line, subLang) || lineTextOf(line, voiceLang);
  }

  // 场景 → 标签池（按优先级列；前面的池子不够用时自动并入后面的）
  var SCENE_POOLS = {
    greet: ['greet', 'thanks', 'friend'],
    goodnight: ['sleepy', 'dream', 'night', 'moon'],
    night: ['night', 'moon', 'dream', 'sleepy'],
    comfort: ['comfort', 'thanks'],
    cheer: ['cheer', 'thanks'],
    thanks: ['thanks', 'friend'],
    ask: ['ask'],
    play: ['play'],
    friend: ['friend', 'thanks'],
    memory: ['memory', 'moon'],
    musing: ['musing', 'self', 'lore', 'sing', 'food', 'memory'],
  };

  // ---------- 文本工具 ----------
  var TECH_RE = /```|`[^`]+`|https?:\/\/|[A-Za-z]:\\|\/(?:[\w.-]+\/)+|(?:^|\s)(?:cd|npm|pnpm|git|curl|powershell|python|node|ffmpeg|dsh)\s|\{|\}|=>|function\s|<\w+[^>]*>|文件|路径|命令|代码|报错|终端|目录|配置|缓存|删除|安装|运行|执行|端口|进程/i;

  function technical(text) {
    return TECH_RE.test(text);
  }

  function normalize(text) {
    return String(text || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`[^`]*`/g, ' ')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/[^\p{Script=Han}a-zA-Z0-9]+/gu, '')
      .toLowerCase();
  }

  function bigrams(s) {
    var out = new Set();
    if (!s) return out;
    if (s.length <= 1) {
      out.add(s);
      return out;
    }
    for (var i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
    return out;
  }

  function similarity(a, b) {
    var A = bigrams(a);
    var B = bigrams(b);
    if (!A.size || !B.size) return 0;
    var hit = 0;
    A.forEach(function (g) {
      if (B.has(g)) hit++;
    });
    var dice = (2 * hit) / (A.size + B.size);
    var cover = hit / Math.min(A.size, B.size);
    return 0.55 * dice + 0.45 * cover;
  }

  // ---------- 意图（与上游同一套规则；命中则走模板，更稳） ----------
  var INTENTS = [
    ['code', /代码|命令|路径|URL|http|pwsh|cmd|netstat|npm|pip|git |配置文件|\.ps1|\.yml|\.json/i],
    ['greeting', /^(你好|早安|早上好|午安|晚上好)/],
    ['farewell', /再见|拜拜|后来见|告辞/],
    ['thanks', /谢谢|感谢/],
    ['apology', /抱歉|对不起|是我弄错|我的错/],
    ['error', /失败|报错|错误|无法|不能|做不到|糟糕/],
    ['affirm', /^(好的|可以|没问题|行|当然|是的|没错)/],
    ['deny', /^(不行|不能|不可以|没有|不要)/],
    ['followup', /呢$|\?$|？$/],
    ['refuse', /拒绝|不能说|不方便|做不到/],
    ['unsure', /不确定|也许|可能|大概/],
    ['waiting', /稍等|处理中|正在|马上|等一下/],
    ['done', /完成|好了|搞定|做完了/],
    ['comfort', /别急|没事|没关系|慢慢|别担心/],
    ['goodnight', /晚安|睡了/],
    ['traveler', /旅行者/],
    ['identity', /我是谁|你叫什么|哥伦比娅/],
    ['off_topic', /月亮|做梦|歌/],
    ['praise', /厉害|漂亮|聪明|好棒/],
    ['criticize', /批评|不满|太差/],
    ['fact', /数字|日期/],
  ];
  var SILENT_INTENTS = { code: 1, fact: 1 };

  function intentOf(text) {
    var t = String(text || '').trim();
    if (!t || t.length > 60) return '';
    for (var i = 0; i < INTENTS.length; i++) {
      if (INTENTS[i][1].test(t)) return INTENTS[i][0];
    }
    return '';
  }

  function resolveTemplate(intent, want) {
    var ids = (bank.templates && bank.templates[intent]) || [];
    var out = [];
    for (var i = 0; i < ids.length && out.length < want; i++) {
      var c = byId.get(ids[i]);
      if (c) out.push(c);
    }
    return out;
  }

  function pickRetrieval(text, threshold) {
    var q = normalize(text);
    if (!q) return null;
    var best = null;
    var bestScore = 0;
    byId.forEach(function (clip) {
      var score = similarity(q, normalize(clip.text));
      if (score > bestScore) {
        bestScore = score;
        best = clip;
      }
    });
    if (!best || bestScore < threshold) return null;
    return best;
  }

  /** 一句回复 → 0–2 段切片（对话回复用） */
  function selectClips(text) {
    var clean = String(text || '').slice(0, 280);
    if (!clean.trim()) return [];
    if (technical(clean)) return [];
    var sentences = clean.split(/[。！？!?；;\n]+/).map(function (s) { return s.trim(); }).filter(function (s) { return s.length >= 2; });
    var out = [];
    for (var i = 0; i < sentences.length && i < 4 && out.length < MAX_CLIPS; i++) {
      var s = sentences[i];
      if (technical(s)) continue;
      var intent = intentOf(s);
      if (intent && SILENT_INTENTS[intent]) continue;
      if (intent) {
        var tpl = resolveTemplate(intent, MAX_CLIPS - out.length);
        if (tpl.length) {
          out = out.concat(tpl);
          continue;
        }
      }
      var threshold = s.length <= 12 ? (bank.thresholds ? bank.thresholds.short : 0.45) : (bank.thresholds ? bank.thresholds.long : 0.42);
      var hit = pickRetrieval(s, threshold);
      if (hit && !out.some(function (x) { return x.id === hit.id; })) out.push(hit);
    }
    return out.slice(0, MAX_CLIPS);
  }

  // ---------- 播放 ----------
  var current = null;
  var playToken = 0;
  var speaking = false;
  var enabled = true;
  var lastText = '';
  var lastAt = 0;
  var ownBubbleText = '';   // 自己弹的气泡文字（避免被气泡监听当成对话回复再念一遍）

  var lineLockUntil = 0;   // 正在念一句整句/原声台词时，别的通路别插嘴
  function lineLocked() { return Date.now() < lineLockUntil; }
  function lockLine(ms) { lineLockUntil = Date.now() + Math.max(0, ms || 0); }

  var fileTimers = [];
  function clearFileTimers() {
    for (var i = 0; i < fileTimers.length; i++) clearTimeout(fileTimers[i]);
    fileTimers = [];
  }

  function unlockLineIfIdle() {
    if (!speaking) lineLockUntil = Math.min(lineLockUntil, Date.now());
  }

  function stopAudio() {
    playToken++;
    clearFileTimers();
    if (current) {
      try {
        current.pause();
      } catch (e) { /* ignore */ }
      current = null;
    }
    speaking = false;
  }

  function effectiveVolume() {
    return mutedPref ? 0 : volumePref;
  }

  function playClip(clip) {
    return new Promise(function (resolve) {
      var audio = new Audio(CLIP_BASE + clip.id + '.ogg');
      audio.volume = effectiveVolume();
      var token = ++playToken;
      current = audio;
      speaking = true;
      var done = function () {
        if (token === playToken) {
          speaking = false;
          current = null;
        }
        resolve();
      };
      audio.addEventListener('ended', done, { once: true });
      audio.addEventListener('error', done, { once: true });
      audio.addEventListener('pause', done, { once: true });
      var p = audio.play();
      if (p && typeof p.catch === 'function') {
        p.catch(function (error) {
          console.warn('[columbina-voice] 播放失败：' + clip.id, error && error.message ? error.message : error);
          done();
        });
      }
    });
  }

  var queue = Promise.resolve();
  function enqueue(fn) {
    queue = queue.then(fn).catch(function (e) {
      console.warn('[columbina-voice] 任务异常', e);
    });
    return queue;
  }

  function markRecent(clip) {
    recent.push(clip.id);
    if (recent.length > RECENT_MAX) recent.shift();
    lastText = clip.text;
    lastAt = Date.now();
  }

  function playClips(clips) {
    if (!clips || !clips.length) return;
    enqueue(function () {
      stopAudio();
      var stride = clips.slice();
      return stride.reduce(function (chain, clip) {
        return chain.then(function () {
          markRecent(clip);
          return playClip(clip);
        });
      }, Promise.resolve());
    });
  }

  function normChars(s) {
    return String(s || '').replace(/[\s\p{P}]/gu, '').length;
  }

  /**
   * 播官方原声文件（一句一个文件，音源完整、干净）。
   * 字幕按字数比例切成几段，随播放进度一段一段换，长台词也不会撑爆气泡。
   */
  function playFileLine(line, withBubble) {
    var file = lineFileOf(line, voiceLang);
    if (!file) return null;
    if (speaking) stopAudio();          // 用户点了菜单项：立刻接管，不等上一句念完
    var audioDur = lineDurOf(line, voiceLang) || 0;
    var subText = subtitleOf(line);
    var segs = lineSegsOf(line, subLang);
    lastText = subText;
    lastAt = Date.now();
    lockLine(audioDur * 1000 + 2600);
    enqueue(function () {
      stopAudio();
      return new Promise(function (resolve) {
        var audio = new Audio(OFFICIAL_BASE + file);
        audio.preload = 'auto';
        audio.volume = effectiveVolume();
        var token = ++playToken;
        current = audio;
        speaking = true;
        var done = function () {
          if (token === playToken) {
            speaking = false;
            current = null;
          }
          clearFileTimers();
          resolve();
        };
        audio.addEventListener('ended', done, { once: true });
        audio.addEventListener('error', function () {
          // 官方原声取不到（外置目录缺失/未下载/路由 404）：标记一次，后续回退包内切片，
          // 至少不会出现「气泡在、嘴巴在动、就是没声音」。
          officialUnavailable = true;
          console.warn('[columbina-voice] 官方原声加载失败，回退切片：' + (OFFICIAL_BASE + file));
          done();
        }, { once: true });
        audio.addEventListener('pause', done, { once: true });

        if (withBubble !== false) {
          var weights = segs.map(function (seg) { return Math.max(1, normChars(seg[1])); });
          var total = weights.reduce(function (a, b) { return a + b; }, 0) || 1;
          var durMs = audioDur * 1000;
          var acc = 0;
          segs.forEach(function (seg, i) {
            var startMs = (acc / total) * durMs;
            var lenMs = (weights[i] / total) * durMs;
            acc += weights[i];
            var timer = setTimeout(function () {
              if (token !== playToken) return;
              showBubble(seg[1], Math.max(1800, Math.round(lenMs) + 800), true);
            }, Math.round(startMs));
            fileTimers.push(timer);
          });
        }

        var p = audio.play();
        if (p && typeof p.catch === 'function') {
          p.catch(function (error) {
            console.warn('[columbina-voice] 官方原声播放失败：' + file, error && error.message ? error.message : error);
            done();
          });
        }
      });
    });
    return line;
  }

  /**
   * 念一整句：几段切片连着放。
   * 有 segments 时**逐段换字幕**（字幕始终只显示正在念的那一小段，长台词也不会撑爆气泡）；
   * 没有 segments 就退回「整句一次显示」。
   */
  function playLine(line, withBubble) {
    if (!line) return null;
    if (!officialUnavailable && (lineFileOf(line, voiceLang) || lineFileOf(line, 'zh'))) return playFileLine(line, withBubble);
    if (speaking) stopAudio();          // 同上：用户意图优先
    var segments = Array.isArray(line.s && line.s.zh) && line.s.zh.length ? line.s.zh : null;
    lastText = lineTextOf(line, 'zh');
    lastAt = Date.now();
    var approxMs = (line.d && line.d.zh || 0) * 1000;
    if (!approxMs && line.ids) {
      for (var qi = 0; qi < line.ids.length; qi++) {
        var qc = byId.get(line.ids[qi]);
        if (qc) approxMs += (qc.duration || 0) * 1000;
      }
    }
    lockLine(approxMs + 2600);
    enqueue(function () {
      stopAudio();
      if (!segments) {
        if (withBubble !== false) showBubble(lineTextOf(line, 'zh'), Math.max(2400, Math.round((line.d && line.d.zh || 0) * 1000) + 700));
        return line.ids.reduce(function (chain, id) {
          return chain.then(function () {
            var clip = byId.get(id);
            if (!clip) return null;
            recent.push(id);
            if (recent.length > RECENT_MAX) recent.shift();
            return playClip(clip);
          });
        }, Promise.resolve());
      }
      return segments.reduce(function (chain, seg) {
        return chain.then(function () {
          var ids = seg[0] || [];
          var text = seg[1] || '';
          var secs = 0;
          for (var i = 0; i < ids.length; i++) {
            var c = byId.get(ids[i]);
            if (c) secs += c.duration || 0;
          }
          if (withBubble !== false && text) {
            // 停留时间按「这段音频 + 一点余量」算，最短 2.2s，保证够读完
            showBubble(text, Math.max(2200, Math.round(secs * 1000) + 900), true);
          }
          return ids.reduce(function (chain2, id) {
            return chain2.then(function () {
              var clip = byId.get(id);
              if (!clip) return null;
              recent.push(id);
              if (recent.length > RECENT_MAX) recent.shift();
              return playClip(clip);
            });
          }, Promise.resolve());
        });
      }, Promise.resolve());
    });
    return line;
  }

  // ---------- 借用 dsh-pet 的气泡 ----------
  function getSprite() {
    try {
      // constants.js 里的 `let sprites` 是脚本级全局词法绑定，后续 classic script 可直接读
      var list = typeof sprites !== 'undefined' ? sprites : null;
      if (!list && typeof window.__columbinaSprites === 'function') list = window.__columbinaSprites();
      if (Array.isArray(list) && list.length) return list[0];
    } catch (e) { /* ignore */ }
    return null;
  }

  function bubbleVisible() {
    var el = document.querySelector('.pet-bubble');
    return !!(el && el.classList.contains('is-on'));
  }

  /**
   * 弹一句字幕气泡。
   * 配置里有 animations.events.whisper 就顺带演一个（哼歌/打瞌睡…），
   * 没有就 anim=false 只弹气泡——那条路 upstream 保证能走通（events.js:166-176）。
   */
  /**
   * 弹字幕期间把工作状态气泡「借走」：
   * dsh-pet 的 renderBubble 优先级是「终态任务 > 碎碎念 > 余额 > 非终态任务」——工作途中任务一进
   * success/error，工作气泡就会顶掉正在显示的碎碎念字幕。字幕是我们借气泡说的，所以弹之前先把
   * workOn 摘掉（工作文案留着），字幕收起后再按当前 workState 还回去：
   * 还在干活就恢复原样，已经干完就让工作气泡自然消失。
   */
  var workHoldToken = 0;
  var subtitleUntil = 0;      // 我们借气泡说话的截止时间（这期间工作气泡不许抢）

  function holdWorkBubble(sprite, ms) {
    if (!sprite) return;
    try {
      if (!sprite.workOn && !sprite.workText) return;
      sprite.__columbinaWorkHold = { on: !!sprite.workOn, text: sprite.workText || null };
      sprite.workOn = false;
      if (typeof sprite.renderBubble === 'function') sprite.renderBubble();
      var token = ++workHoldToken;
      var wait = Math.max(1200, Number(ms) || 6000) + 260;
      subtitleUntil = Date.now() + wait;
      setTimeout(function () { releaseWorkBubble(token); }, wait);
    } catch (e) { /* 摘不动就算了，字幕照弹 */ }
  }

  function releaseWorkBubble(token) {
    if (token !== workHoldToken) return;      // 又弹了新的字幕：这一次的释放作废
    subtitleUntil = 0;
    var sprite = getSprite();
    if (!sprite) return;
    var hold = sprite.__columbinaWorkHold;
    if (!hold) return;
    delete sprite.__columbinaWorkHold;
    try {
      var working = typeof sprite.workState === 'string' && sprite.workState;
      sprite.workOn = working ? !!hold.on : false;
      // 不还原 workText：这期间任务可能已经推进/结束，现在的文案才是对的
      if (typeof sprite.renderBubble === 'function') sprite.renderBubble();
    } catch (e) { /* 还回去失败无伤大雅 */ }
  }

  /**
   * 盯着 onWorkTick：工作状态每来一拍都会把 workOn 置真，任务进终态时 renderBubble 的优先级是
   * 「终态工作 > 碎碎念」，字幕就会被「做完了。」顶掉。我们借气泡说话期间（subtitleUntil / 正在念）
   * 每次 tick 之后把 workOn 再压回去，保证字幕是我们的；字幕收完 releaseWorkBubble 再还给它。
   */
  function installWorkGuard(sprite) {
    if (!sprite || sprite.__columbinaWorkTick || typeof sprite.onWorkTick !== 'function') return;
    var orig = sprite.onWorkTick;
    sprite.__columbinaWorkTick = orig;
    sprite.onWorkTick = function (snapshot, tick) {
      var r = orig.call(this, snapshot, tick);
      try {
        if (subtitleUntil > Date.now() || speaking) {
          if (this.workOn) {
            this.workOn = false;
            if (typeof this.renderBubble === 'function') this.renderBubble();
          }
        }
      } catch (e) { /* 压不回去也不影响字幕本体 */ }
      return r;
    };
  }

  function showBubble(text, ms, noAnim) {
    var sprite = getSprite();
    if (!sprite || typeof sprite.showWhisper !== 'function') return false;
    installWorkGuard(sprite);
    holdWorkBubble(sprite, ms);
    var anim = false;
    if (!noAnim) {
      try {
        var pool = sprite.animations && sprite.animations.events && sprite.animations.events.whisper;
        if (Array.isArray(pool) && pool.length) anim = undefined; // undefined = 走动画分支
      } catch (e) { /* 拿不到动画池就只弹气泡 */ }
    }
    try {
      sprite.showWhisper(text, '', '', ms || 6000, anim);
      ownBubbleText = text;
      return true;
    } catch (e) {
      // 动画那条路出岔子（缺素材/池子坏了）就退回纯气泡，字幕不能丢
      console.warn('[columbina-voice] 弹气泡失败，改走纯气泡', e);
      try {
        sprite.showWhisper(text, '', '', ms || 6000, false);
        ownBubbleText = text;
        return true;
      } catch (e2) {
        console.warn('[columbina-voice] 纯气泡也失败', e2);
        return false;
      }
    }
  }

  // ---------- 设置：来自 DSH 设置页（宿主写成 voice-settings.js，这里轮询读） ----------
  //
  // 真相文件在宿主侧（$DSH_HOME/dsh-pet/columbina-voice.json），宿主顺手镜像成
  // 同目录的 voice-settings.js。桌宠窗口是 file://、打不通宿主 HTTP，但同目录的
  // 普通 script 可以动态插入，所以每 15 秒拉一次最新设置，改完不用重启。
  var SETTINGS_POLL_MS = 15000;
  var SETTINGS_SCRIPT = './voice/voice-settings.js';
  var LOCAL_KEY = 'columbina-voice-local-v1';
  var intervalSec = 90;
  var allowedLines = null;      // null = 全部台词
  var LOCAL_LANG_KEY = 'columbina-voice-lang-v1';
  var settingsAt = '';          // 远端设置的时间戳
  var localAt = '';             // 菜单里临时改过的时间戳（比远端新时优先）
  var settingsLoading = false;

  function readLocalPrefs() {
    try {
      var raw = window.localStorage && window.localStorage.getItem(LOCAL_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function writeLocalPrefs() {
    localAt = new Date().toISOString();
    try {
      if (window.localStorage) {
        window.localStorage.setItem(LOCAL_KEY, JSON.stringify({
          enabled: enabled,
          intervalSec: intervalSec,
          voiceLang: voiceLang,
          subLang: subLang,
          menuLang: menuLang,
          scale: scalePref,
          lines: allowedLines === null ? null : Object.keys(allowedLines).filter(function (k) {
            return allowedLines[k] === true;
          }).map(Number),
          at: localAt,
        }));
      }
    } catch (e) { /* ignore */ }
  }

  function readVolumePrefs() {
    try {
      var raw = window.localStorage && window.localStorage.getItem(VOLUME_KEY);
      if (!raw) return;
      var prefs = JSON.parse(raw);
      if (typeof prefs.volume === 'number' && isFinite(prefs.volume)) {
        volumePref = Math.min(1, Math.max(0, prefs.volume));
      }
      if (typeof prefs.muted === 'boolean') mutedPref = prefs.muted;
    } catch (e) { /* ignore */ }
  }

  function saveVolumePrefs() {
    try {
      if (window.localStorage) {
        window.localStorage.setItem(VOLUME_KEY, JSON.stringify({ volume: volumePref, muted: mutedPref }));
      }
    } catch (e) { /* ignore */ }
  }

  /** 音量改动立刻生效：正在放的那句也跟着变。 */
  function applyVolume() {
    try {
      if (current) current.volume = effectiveVolume();
    } catch (e) { /* ignore */ }
  }

  // ---------- 夜间勿扰：这段时间里不主动开口（手动点台词照常播） ----------
  var QUIET_KEY = 'columbina-voice-quiet-v1';
  var quietPref = { on: false, start: 23 * 60, end: 8 * 60 };

  function readQuietPrefs() {
    try {
      var raw = window.localStorage && window.localStorage.getItem(QUIET_KEY);
      if (!raw) return;
      var prefs = JSON.parse(raw);
      if (typeof prefs.on === 'boolean') quietPref.on = prefs.on;
      if (typeof prefs.start === 'number' && prefs.start >= 0 && prefs.start < 1440) quietPref.start = prefs.start;
      if (typeof prefs.end === 'number' && prefs.end >= 0 && prefs.end < 1440) quietPref.end = prefs.end;
    } catch (e) { /* ignore */ }
  }

  function saveQuietPrefs() {
    try {
      if (window.localStorage) {
        window.localStorage.setItem(QUIET_KEY, JSON.stringify(quietPref));
      }
    } catch (e) { /* ignore */ }
  }

  function quietText() {
    return hhmmText(quietPref.start) + '–' + hhmmText(quietPref.end);
  }

  function hhmmText(minutes) {
    var h = Math.floor(minutes / 60) % 24;
    var m = minutes % 60;
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }

  /** 现在是不是落在勿扰时段里（支持跨午夜，比如 23:00–08:00）。 */
  function inQuietWindow(now) {
    if (!quietPref.on) return false;
    var at = now instanceof Date ? now : new Date();
    var minutes = at.getHours() * 60 + at.getMinutes();
    var start = quietPref.start;
    var end = quietPref.end;
    if (start === end) return false;
    if (start < end) return minutes >= start && minutes < end;
    return minutes >= start || minutes < end;
  }

  // ---------- 省电模式：闲着的时候把循环播放的 idle 视频按暂停（画面定格，几乎看不出） ----------
  var POWER_KEY = 'columbina-voice-power-v1';
  var powerPref = false;
  var powerTimer = null;
  var powerPaused = [];
  var powerHold = false;

  // ---------- 待机动作池 ----------
  // curated：每套形象自带的中性待机（voice-index.js 的 tree.idle，不会随机哭/坐牢）
  // all：这套形象的全部动作（含剧情动作，随机出现）
  // custom：右键菜单里逐个勾，picks[skinId]，一个都没勾就退回 curated
  var IDLE_KEY = 'columbina-voice-idle-v1';
  var idlePref = { mode: 'curated', picks: {} };
  function readIdlePrefs() {
    try {
      var raw = localStorage.getItem(IDLE_KEY);
      if (!raw) return idlePref;
      var saved = JSON.parse(raw);
      if (saved && (saved.mode === 'curated' || saved.mode === 'all' || saved.mode === 'custom')) idlePref.mode = saved.mode;
      if (saved && saved.picks && typeof saved.picks === 'object') idlePref.picks = saved.picks;
    } catch (e) { /* ignore */ }
    return idlePref;
  }
  function saveIdlePrefs() {
    try {
      localStorage.setItem(IDLE_KEY, JSON.stringify({ mode: idlePref.mode, picks: idlePref.picks, at: Date.now() }));
    } catch (e) { /* ignore */ }
  }
  /** 这套形象的全部动作（voice-index.js 里烘焙的 skin.pool） */
  function skinPool(skin) {
    if (!skin) return [];
    if (skin.pool && skin.pool.length) return skin.pool;
    return (skin.tree && skin.tree.idle) ? skin.tree.idle : [];
  }
  function idlePicksOf(skin) {
    if (!skin) return [];
    var arr = idlePref.picks && idlePref.picks[skin.id];
    return Array.isArray(arr) ? arr : [];
  }
  /** 按当前模式算出真正要用的待机池 */
  function resolveIdlePool(skin) {
    if (!skin) return [];
    var curated = (skin.tree && skin.tree.idle) ? skin.tree.idle.slice() : [];
    if (idlePref.mode === 'all') return skinPool(skin).slice();
    if (idlePref.mode === 'custom') {
      var all = skinPool(skin);
      var picked = idlePicksOf(skin).filter(function (n) { return all.indexOf(n) >= 0; });
      if (picked.length) return picked;
    }
    return curated;
  }
  function idleModeText() {
    var skin = currentSkin();
    if (idlePref.mode === 'all') return '全部动作 · ' + skinPool(skin).length + ' 段';
    if (idlePref.mode === 'custom') {
      var n = idlePicksOf(skin).length;
      return n ? ('自己选 · ' + n + ' 段') : '自己选（还没勾，暂用精选）';
    }
    return '精选 · ' + ((skin && skin.tree && skin.tree.idle) ? skin.tree.idle.length : 0) + ' 段';
  }
  function stripAnimPrefix(name, skin) {
    var p = (skin && (skin.poolPrefix || skin.prefix)) || '';
    var s = String(name || '');
    return (p && s.indexOf(p) === 0) ? s.slice(p.length) : s;
  }
  /** 把算出来的池子套到正在跑的 sprite 上（换形象会走 applySkin，那条路自己算） */
  function applyIdlePool(opts) {
    var skin = currentSkin();
    var sprite = getSprite();
    if (!skin || !sprite || !sprite.animations) return false;
    var pool = resolveIdlePool(skin);
    if (!pool.length) return false;
    sprite.animations.idle = pool;
    if (opts && opts.replay && typeof sprite.playOnce === 'function' && pool.indexOf(sprite.anim) < 0) {
      try { sprite.playOnce(pool[0]); } catch (e) { /* ignore */ }
    }
    return true;
  }

  function readPowerPrefs() {
    try {
      var raw = window.localStorage && window.localStorage.getItem(POWER_KEY);
      if (raw === '1') powerPref = true;
    } catch (e) { /* ignore */ }
  }

  function savePowerPrefs() {
    try {
      if (window.localStorage) window.localStorage.setItem(POWER_KEY, powerPref ? '1' : '0');
    } catch (e) { /* ignore */ }
  }

  function pauseIdleVideos() {
    powerTimer = null;
    if (!powerPref) return;
    powerHold = true;
    // 待机动画走的是 playOnce（loop=false，播完由 handleEnded 重新起一段），
    // 所以**不能**再按 video.loop 过滤，否则一段也停不住（省电模式最早就是这么失效的）。
    var list = document.querySelectorAll('video');
    for (var i = 0; i < list.length; i++) {
      var video = list[i];
      if (video.paused || video.ended) continue;
      try {
        video.pause();
        powerPaused.push(video);
      } catch (e) { /* ignore */ }
    }
    // 定格期间任何试图开播的视频都按回去（宿主 /anim 点播、平衡刷新、碎碎念都会换源播放）
    try { document.addEventListener('play', holdPlayingVideo, true); } catch (e) { /* ignore */ }
  }

  /** 定格期间：谁想播就按回去。鼠标一动 kickPowerTimer 会先摘掉这个监听。 */
  function holdPlayingVideo(e) {
    if (!powerHold || !powerPref) return;
    var v = e && e.target;
    if (!v || v.tagName !== 'VIDEO') return;
    try {
      v.pause();
      if (powerPaused.indexOf(v) < 0) powerPaused.push(v);
    } catch (err) { /* ignore */ }
  }

  function resumeIdleVideos() {
    powerHold = false;
    try { document.removeEventListener('play', holdPlayingVideo, true); } catch (e) { /* ignore */ }
    for (var i = 0; i < powerPaused.length; i++) {
      try { powerPaused[i].play(); } catch (e) { /* ignore */ }
    }
    powerPaused.length = 0;
  }

  /** 有动静就重新计时；省电模式关着就什么都不做。 */
  function kickPowerTimer() {
    if (!powerPref) return;
    if (powerTimer) clearTimeout(powerTimer);
    resumeIdleVideos();
    powerTimer = setTimeout(pauseIdleVideos, 30000);
  }

  function readLangPrefs() {
    try {
      var raw = window.localStorage && window.localStorage.getItem(LOCAL_KEY);
      if (!raw) return;
      var prefs = JSON.parse(raw);
      voiceLang = normLang(prefs.voiceLang, voiceLang);
      subLang = normLang(prefs.subLang, subLang);
      menuLang = normLang(prefs.menuLang, menuLang);
      if (typeof prefs.scale === 'number') scalePref = clampScale(prefs.scale);
      if (Array.isArray(prefs.lines)) {
        allowedLines = {};
        for (var i = 0; i < prefs.lines.length; i++) {
          var idx = Number(prefs.lines[i]);
          if (isFinite(idx)) allowedLines[idx] = true;
        }
      }
      if (typeof prefs.at === 'string') localAt = prefs.at;
    } catch (e) { /* ignore */ }
  }

  function clampInterval(value) {
    var sec = Number(value);
    if (!isFinite(sec)) return 90;
    return Math.min(180, Math.max(60, Math.round(sec)));
  }

  function applySettings(remote) {
    if (!remote) return;
    if (localAt && remote.at && localAt > remote.at) return; // 菜单里刚改过，比远端新
    settingsAt = typeof remote.at === 'string' ? remote.at : settingsAt;
    enabled = remote.enabled !== false;
    intervalSec = clampInterval(remote.intervalSec);
    if (remote.voiceLang !== undefined) voiceLang = normLang(remote.voiceLang, voiceLang);
    if (remote.subLang !== undefined) subLang = normLang(remote.subLang, subLang);
    if (remote.menuLang !== undefined) menuLang = normLang(remote.menuLang, menuLang);
    if (typeof remote.scale === 'number') {
      var nextScale = clampScale(remote.scale);
      if (Math.abs(nextScale - scalePref) > 0.001) {
        scalePref = nextScale;
        applyScale(nextScale);
      }
    }
    allowedLines = Array.isArray(remote.lines) && remote.lines.length
      ? {}
      : null;
    if (allowedLines !== null) {
      for (var i = 0; i < remote.lines.length; i++) {
        var idx = Number(remote.lines[i]);
        if (isFinite(idx)) allowedLines[idx] = true;
      }
    }
  }

  function loadSettings() {
    if (settingsLoading) return;
    settingsLoading = true;
    var script = document.createElement('script');
    script.src = SETTINGS_SCRIPT + '?t=' + Date.now();
    script.async = true;
    var done = function () {
      settingsLoading = false;
      if (script.parentNode) script.parentNode.removeChild(script);
      var remote = window.__COLUMBINA_VOICE_SETTINGS;
      if (remote) {
        applySettings(remote);
        if (whisperTimer === null) scheduleWhisper();
      } else if (whisperTimer === null) {
        scheduleWhisper();
      }
      window.setTimeout(loadSettings, SETTINGS_POLL_MS);
    };
    script.onload = done;
    script.onerror = done;
    document.head.appendChild(script);
  }

  /** 允许被念到的台词（设置里没勾 = 全部）。 */
  function lineAllowed(line) {
    return allowedLines === null || allowedLines[line.index] === true;
  }

  var recentLines = [];
  function markLine(line) {
    if (!line) return;
    recentLines.push(line.index);
    if (recentLines.length > 12) recentLines.shift();
    lastText = subtitleOf(line);
    lastAt = Date.now();
  }

  /** 碎碎念优先念一整句官方台词：按当前场合挑，避开刚念过的。 */
  function pickWhisperLine(scene) {
    var labels = SCENE_POOLS[scene] || SCENE_POOLS.musing;
    var preferred = [];
    var rest = [];
    for (var i = 0; i < lineList.length; i++) {
      var line = lineList[i];
      if (!lineAllowed(line)) continue;
      if (recentLines.indexOf(line.index) >= 0) continue;
      var hit = false;
      for (var k = 0; k < labels.length && !hit; k++) {
        if (line.labels && line.labels.indexOf(labels[k]) >= 0) hit = true;
      }
      (hit ? preferred : rest).push(line);
    }
    var pool = preferred.length ? preferred : rest;
    if (!pool.length) {
      // 勾的台词太少、都刚念过：退一步，允许重复，别让碎碎念哑掉
      pool = lineList.filter(function (l) { return lineAllowed(l); });
    }
    if (!pool.length) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // ---------- 今天的天气（网络定位 + open-meteo，公开接口，不需要 key） ----------
  // 菜单点「天气 → 今天的天气」：先弹一行今天的数据，再念一句对得上的官方原声台词。
  // 定位按 IP 猜城市，猜错了在菜单里点「重新定位」；取不到就只留一句软话，不弹报错。
  var WEATHER_GEO_KEY = 'columbina-voice-geo-v1';
  var WEATHER_CACHE_KEY = 'columbina-voice-weather-v1';
  var WEATHER_TTL_MS = 20 * 60 * 1000;
  var WEATHER_GEO_TTL_MS = 24 * 60 * 60 * 1000;
  var WEATHER_API = 'https://api.open-meteo.com/v1/forecast';
  var weatherGeo = null;
  var weatherCache = null;
  var weatherPending = null;

  // 官方台词里跟天气对得上的几行：用菜单标签找下标，索引重排也不会错位
  var WEATHER_LINE_LABELS = {
    rain: '下雨的时候', drizzle: '下雨的时候', shower: '下雨的时候',
    thunder: '打雷的时候', snow: '下雪的时候', wind: '刮大风了',
  };

  var WEATHER_WORDS = {
    zh: {
      clear: '晴', partly: '晴间多云', cloud: '多云', over: '阴',
      fog: '有雾', drizzle: '毛毛雨', rain: '下雨', shower: '阵雨',
      snow: '下雪', thunder: '雷阵雨', wind: '风大',
    },
    ja: {
      clear: '晴れ', partly: '晴れ時々曇り', cloud: '曇り時々晴れ', over: '曇り',
      fog: '霧', drizzle: '小雨', rain: '雨', shower: 'にわか雨',
      snow: '雪', thunder: '雷雨', wind: '風が強い',
    },
    en: {
      clear: 'clear', partly: 'mostly clear', cloud: 'partly cloudy', over: 'overcast',
      fog: 'foggy', drizzle: 'drizzle', rain: 'rain', shower: 'showers',
      snow: 'snow', thunder: 'thunderstorm', wind: 'windy',
    },
  };

  var menuLineByLabel = {};
  var menuGroupLines = {};
  (function indexVoiceMenu() {
    var spec = bank.menu || [];
    for (var i = 0; i < spec.length; i++) {
      var group = spec[i] || [];
      var pairs = group[1] || [];
      var idxs = [];
      for (var k = 0; k < pairs.length; k++) {
        var pair = pairs[k] || [];
        if (menuLineByLabel[pair[0]] === undefined && typeof pair[1] === 'number') {
          menuLineByLabel[pair[0]] = pair[1];
        }
        if (typeof pair[1] === 'number') idxs.push(pair[1]);
      }
      menuGroupLines[group[0]] = idxs;
    }
  })();

  function readStore(key) {
    try {
      var raw = window.localStorage && window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function writeStore(key, value) {
    try {
      if (window.localStorage) window.localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* localStorage 不可用就只留内存 */ }
  }

  /** 带超时的 fetch：断网时不能把桌宠卡住 */
  function fetchJson(url, ms) {
    return new Promise(function (resolve, reject) {
      var ctl = typeof AbortController === 'function' ? new AbortController() : null;
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        if (ctl) { try { ctl.abort(); } catch (e) { /* ignore */ } }
        reject(new Error('timeout'));
      }, ms || 9000);
      fetch(url, { cache: 'no-store', signal: ctl ? ctl.signal : undefined })
        .then(function (res) {
          if (!res.ok) throw new Error('http ' + res.status);
          return res.json();
        })
        .then(function (data) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(data);
        })
        .catch(function (err) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  function freshGeo() {
    var geo = weatherGeo || readStore(WEATHER_GEO_KEY);
    if (geo && geo.lat && Date.now() - (geo.at || 0) < WEATHER_GEO_TTL_MS) {
      weatherGeo = geo;
      return geo;
    }
    return null;
  }

  function locate(force) {
    if (!force) {
      var cached = freshGeo();
      if (cached) return Promise.resolve(cached);
    } else {
      weatherGeo = null;
    }
    // ipwho.is 免 key、回 CORS 头；只取需要的字段，省流量
    var url = 'https://ipwho.is/?fields=success,city,region,country,country_code,latitude,longitude';
    return fetchJson(url, 9000).then(function (data) {
      if (!data || data.success === false || !isFinite(data.latitude) || !isFinite(data.longitude)) {
        throw new Error('geo failed');
      }
      var geo = {
        city: String(data.city || data.region || ''),
        region: String(data.region || ''),
        country: String(data.country || ''),
        countryCode: String(data.country_code || ''),
        lat: Number(data.latitude),
        lon: Number(data.longitude),
        at: Date.now(),
      };
      weatherGeo = geo;
      writeStore(WEATHER_GEO_KEY, geo);
      return geo;
    });
  }

  /** 中文界面里「Guangzhou」不好看：再问一次地名库，失败也不挡播报 */
  function localizeCity(geo) {
    if (!geo || !geo.city || geo.cityZh) return Promise.resolve(geo);
    if (normLang(subLang, 'zh') !== 'zh' || geo.countryCode !== 'CN') return Promise.resolve(geo);
    var url = 'https://geocoding-api.open-meteo.com/v1/search?name=' +
      encodeURIComponent(geo.city) + '&count=1&language=zh&format=json';
    return fetchJson(url, 7000).then(function (data) {
      var hit = data && data.results && data.results[0];
      if (hit && hit.name) {
        geo.cityZh = String(hit.name);
        writeStore(WEATHER_GEO_KEY, geo);
      }
      return geo;
    }).catch(function () { return geo; });
  }

  // WMO weather code → 我们自己认的天气类别
  function kindOf(code) {
    var c = Number(code) || 0;
    if (c === 0) return 'clear';
    if (c === 1) return 'partly';
    if (c === 2) return 'cloud';
    if (c === 3) return 'over';
    if (c === 45 || c === 48) return 'fog';
    if (c >= 51 && c <= 57) return 'drizzle';
    if (c >= 61 && c <= 67) return 'rain';
    if (c >= 71 && c <= 77) return 'snow';
    if (c >= 80 && c <= 82) return 'shower';
    if (c >= 85 && c <= 86) return 'snow';
    if (c >= 95) return 'thunder';
    return 'cloud';
  }

  function readWeather(opts) {
    opts = opts || {};
    if (!opts.fresh && weatherCache && Date.now() - (weatherCache.at || 0) < WEATHER_TTL_MS) {
      return Promise.resolve(weatherCache);
    }
    var geoP = opts.geo ? locate(true) : locate(false);
    return geoP.then(function (geo) {
      return localizeCity(geo);
    }).then(function (g) {
      var url = WEATHER_API +
        '?latitude=' + g.lat.toFixed(4) + '&longitude=' + g.lon.toFixed(4) +
        '&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m' +
        '&daily=temperature_2m_max,temperature_2m_min,weather_code' +
        '&timezone=auto&forecast_days=1';
      return fetchJson(url, 10000).then(function (data) {
        var cur = data && data.current;
        var daily = data && data.daily;
        if (!cur || !daily || !Array.isArray(daily.temperature_2m_max)) throw new Error('weather shape');
        var wind = Number(cur.wind_speed_10m) || 0;
        var kind = kindOf(cur.weather_code);
        var w = {
          at: Date.now(),
          code: Number(cur.weather_code) || 0,
          temp: Math.round(Number(cur.temperature_2m)),
          humidity: Math.round(Number(cur.relative_humidity_2m)),
          wind: Math.round(wind),
          tmin: Math.round(Number(daily.temperature_2m_min[0])),
          tmax: Math.round(Number(daily.temperature_2m_max[0])),
          kind: kind,
          mood: (wind >= 26 && (kind === 'clear' || kind === 'partly' || kind === 'cloud' || kind === 'over')) ? 'wind' : kind,
          city: g.cityZh || g.city || '',
          tz: String(data.timezone || ''),
        };
        weatherCache = w;
        writeStore(WEATHER_CACHE_KEY, w);
        return w;
      });
    });
  }

  function weatherWords() {
    return WEATHER_WORDS[normLang(subLang, 'zh')] || WEATHER_WORDS.zh;
  }

  function weatherSummary(w) {
    var lang = normLang(subLang, 'zh');
    var cond = weatherWords()[w.kind] || weatherWords().cloud;
    var city = w.city ? ' · ' + w.city : '';
    if (lang === 'ja') return '今日は' + cond + '、' + w.temp + '℃（' + w.tmin + '〜' + w.tmax + '℃）' + city;
    if (lang === 'en') return 'Today ' + cond + ', ' + w.temp + '℃ (' + w.tmin + '–' + w.tmax + '℃)' + city;
    return '今天' + cond + '，' + w.temp + '℃，' + w.tmin + '~' + w.tmax + '℃' + city;
  }

  function weatherFailText() {
    var lang = normLang(subLang, 'zh');
    if (lang === 'ja') return '今日の天気は…いま聞けないみたい。';
    if (lang === 'en') return 'The weather... I cannot reach it right now.';
    return '今天的天气…这会儿问不到呢。';
  }

  function weatherLocText(w) {
    var lang = normLang(subLang, 'zh');
    var city = (w && w.city) || '？';
    if (lang === 'ja') return 'あなたは' + city + 'にいるのね。';
    if (lang === 'en') return 'I think you are in ' + city + '.';
    return '我看到你在' + city + '呢。';
  }

  function chatLinePool() {
    var idxs = menuGroupLines['闲聊'] || [];
    var pool = [];
    for (var i = 0; i < idxs.length; i++) {
      var line = lineList[idxs[i]];
      if (line && lineFileOf(line, voiceLang)) pool.push(line);
    }
    return pool;
  }

  function weatherLine(w) {
    var label = WEATHER_LINE_LABELS[w.mood];
    var idx = label === undefined ? undefined : menuLineByLabel[label];
    if (typeof idx === 'number' && lineList[idx]) return lineList[idx];
    var pool = chatLinePool();
    if (!pool.length) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  /** 主流程：先垫一句「让我看看」，数据回来先上字幕，念完再让台词接上；两句都带自己的字幕 */
  function speakWeather(opts) {
    opts = opts || {};
    if (weatherPending) return weatherPending;
    stopAudio();
    var lang = normLang(subLang, 'zh');
    var thinking = lang === 'ja' ? '今日の天気を見てみるね…'
      : lang === 'en' ? 'Let me check the weather…'
        : '让我看看今天的天气…';
    showBubble(thinking, 20000, true);
    weatherPending = readWeather({ fresh: true, geo: opts.geo === true })
      .then(function (w) {
        var summary = weatherSummary(w);
        var ms = Math.max(3600, Math.min(9200, 1500 + summary.length * 130));
        showBubble(summary, ms, true);
        var line = weatherLine(w);
        if (!line) return w;
        var wait = Math.min(4200, Math.max(1400, ms - 900));
        return new Promise(function (resolve) { setTimeout(resolve, wait); }).then(function () {
          playLine(line, true);
          scheduleWhisper();
          return w;
        });
      })
      .catch(function (err) {
        console.warn('[columbina-voice] 天气取不到：' + (err && err.message ? err.message : err));
        showBubble(weatherFailText(), 4200, true);
        scheduleWhisper();
        return null;
      });
    weatherPending.then(function () { weatherPending = null; }, function () { weatherPending = null; });
    return weatherPending;
  }

  function buildWeatherBranch() {
    var city = (weatherCache && weatherCache.city) ||
      (weatherGeo && (weatherGeo.cityZh || weatherGeo.city)) || '';
    return {
      label: '天气',
      hint: city || trText('播报一次'),
      children: [
        {
          label: '今天的天气',
          hint: city || trText('播报一次'),
          action: 'columbina-weather',
          __columbinaWeather: 'today',
        },
        {
          label: '重新定位',
          hint: trText('按网络重新认城市'),
          action: 'columbina-weather-loc',
          __columbinaWeather: 'relocate',
        },
      ],
    };
  }

  (function loadWeatherCache() {
    var saved = readStore(WEATHER_CACHE_KEY);
    if (saved && saved.at && Date.now() - saved.at < WEATHER_TTL_MS) weatherCache = saved;
  })();

  // ---------- 2D live 形象（四套，随索引里的 skins 下发） ----------
  var skins = bank.skins || [];
  var SKIN_KEY = 'columbina-voice-skin';
  var skinId = 'official';

  function findBySkin(id) {
    for (var i = 0; i < skins.length; i++) if (skins[i].id === id) return skins[i];
    return null;
  }

  function currentSkin() {
    return findBySkin(skinId) || skins[0] || null;
  }

  function skinPrefix() {
    var skin = currentSkin();
    return (skin && skin.prefix) || '';
  }

  readAnimInterval();

  function readSkinPref() {
    try {
      var saved = localStorage.getItem(SKIN_KEY);
      if (saved && findBySkin(saved)) skinId = saved;
    } catch (e) { /* localStorage 不可用就保持默认 */ }
    return skinId;
  }

  /** 2D 动图都只有一两秒：播完立刻换下一段会显得「闪」。
   *  这里把动画链按住——同一条动图原地循环，等「切换间隔」到了再放行。
   *  间隔 0 = 放完立即切（就是 dsh-pet 原本的行为）。 */
  function animIntervalLabel(ms) {
    if (!(ms > 0)) return '动图放完立即切';
    var sec = ms / 1000;
    return '动图放完后 ' + (sec % 1 === 0 ? String(sec) : sec.toFixed(1)) + ' 秒切';
  }

  // ---------- 菜单文案（中 / 日 / 英） ----------
  var MENU_I18N = {
    ja: {
      '打开网站': 'サイトを開く', '打开软件': 'アプリを開く', '查看余额': '残高を見る',
      '对话': '会話', '回到初始位置': '元の位置へ', '重载配置': '設定を再読込',
      '真实物理：开': '物理挙動：オン', '真实物理：关': '物理挙動：オフ', '点一下切换': 'クリックで切替',      '设置面板': '設定パネル', '检查、勾选、修复都在这里': 'チェック・選択・修復はここで',
      '显示位置': '表示位置', '仅网页': 'ウェブのみ', '仅桌面': 'デスクトップのみ', '两者': '両方', '都不': 'どちらも表示しない',
      '动作': 'アクション', '待机': '待機', '转向': '振り向き', '拖拽': 'ドラッグ', '点击回应': 'クリック反応', '移动': '移動',
      '亲昵': 'なかよし', '俏皮': 'おちゃめ', '小动作': 'しぐさ', '心情': '気分',
      '余额档位': '残高レベル', '碎碎念表情': 'ひとりごと表情', '工作状态': '作業状態',
      '切换间隔': '切替間隔', '2D live 形象': '2D live モデル', '原声台词': '原語セリフ',
      '碎碎念设置': 'ひとりごと設定', '语言': '言語', '模型大小': 'モデルサイズ',
      '配音': '音声', '字幕': '字幕', '菜单': 'メニュー',
      '中文': '中国語', '日本語': '日本語', 'English': 'English',
      '当前': '現在', '更多': 'その他', '表情': 'スタンプ',
      '打开设置': '設定を開く', '在 DSH 设置里改': 'DSH 設定で変更', 'Ctrl+左键': 'Ctrl+左クリック',
      '闲暇一下 · 娅娅的表情包时刻': 'ひととき · コロンビーナのスタンプ',
      '发一张 Q 版表情': 'Q 版スタンプを一枚',
      '天气': '天気', '今天的天气': '今日の天気', '重新定位': '位置を更新',
      '音量': '音量', '静音：开': 'ミュート：オン', '静音：关': 'ミュート：オフ',
      '夜间勿扰': 'おやすみモード', '开启勿扰': 'オンにする', '关闭勿扰': 'オフにする',
      '播报一次': 'いま聞いてみる', '按网络重新认城市': 'ネットから位置を更新',
      '待机动作': '待機モーション', '精选（推荐）': 'おすすめ', '当前形象全部动作': 'このモデルの全動作', '自己选…': '自分で選ぶ', '选择动作…': 'モーションを選ぶ',
    },
    en: {
      '打开网站': 'Open site', '打开软件': 'Open app', '查看余额': 'Check balance',
      '对话': 'Chat', '回到初始位置': 'Back to start', '重载配置': 'Reload config',
      '真实物理：开': 'Physics: on', '真实物理：关': 'Physics: off', '点一下切换': 'Click to toggle',      '设置面板': 'Settings panel', '检查、勾选、修复都在这里': 'Check, pick and repair live here',
      '显示位置': 'Show on', '仅网页': 'Web only', '仅桌面': 'Desktop only', '两者': 'Both', '都不': 'None',
      '动作': 'Actions', '待机': 'Idle', '转向': 'Turn', '拖拽': 'Drag', '点击回应': 'Click reply', '移动': 'Walk',
      '亲昵': 'Affection', '俏皮': 'Playful', '小动作': 'Gestures', '心情': 'Mood',
      '余额档位': 'Balance tiers', '碎碎念表情': 'Whisper faces', '工作状态': 'Work status',
      '切换间隔': 'Switch interval', '2D live 形象': '2D live model', '原声台词': 'Voice lines',
      '碎碎念设置': 'Whisper settings', '语言': 'Language', '模型大小': 'Model size',
      '配音': 'Voice', '字幕': 'Subtitles', '菜单': 'Menu',
      '中文': 'Chinese', '日本語': 'Japanese', 'English': 'English',
      '当前': 'Now', '更多': 'More', '表情': 'Sticker',
      '打开设置': 'Open settings', '在 DSH 设置里改': 'Change in DSH settings', 'Ctrl+左键': 'Ctrl+Click',
      '闲暇一下 · 娅娅的表情包时刻': 'A quiet moment · sticker time',
      '发一张 Q 版表情': 'Send a chibi sticker',
      '天气': 'Weather', '今天的天气': "Today's weather", '重新定位': 'Refresh location',
      '音量': 'Volume', '静音：开': 'Mute: on', '静音：关': 'Mute: off',
      '夜间勿扰': 'Quiet hours', '开启勿扰': 'Turn on', '关闭勿扰': 'Turn off',
      '播报一次': 'Ask now', '按网络重新认城市': 'Re-detect from network',
      '待机动作': 'Idle actions', '精选（推荐）': 'Curated', '当前形象全部动作': 'All actions', '自己选…': 'Pick my own…', '选择动作…': 'Choose actions…',
    },
  };

  function trText(text) {
    if (!text) return text;
    if (menuLang === 'zh') return text;
    var table = MENU_I18N[menuLang] || {};
    if (table[text] !== undefined) return table[text];
    // 「当前：XXX」/「动图放完后 N 秒切」这类带前缀的，逐段替换
    if (text.indexOf('当前：') === 0) return (table['当前'] || '当前') + '：' + text.slice(3);
    return text;
  }

  function intervalText(ms, lang) {
    if (lang === 'zh') return animIntervalLabel(ms);
    var L = MENU_I18N[lang] || {};
    if (!(ms > 0)) return lang === 'ja' ? 'アニメ終了で即切替' : 'Switch when finished';
    var sec = ms / 1000;
    var n = sec % 1 === 0 ? String(sec) : sec.toFixed(1);
    return lang === 'ja' ? 'アニメ終了後 ' + n + ' 秒' : 'Switch ' + n + 's after';
  }

  function scaleText(k, lang) {
    var n = (k % 1 === 0 ? String(k) : String(k));
    return 'x' + n;
  }

  function translateTree(node) {
    if (!node || typeof node !== 'object') return node;
    if (typeof node.label === 'string') node.label = trText(node.label);
    if (typeof node.hint === 'string') node.hint = trText(node.hint);
    if (node.__columbinaAnimInterval !== undefined) node.label = intervalText(node.__columbinaAnimInterval, menuLang);
    if (Array.isArray(node.children)) {
      for (var i = 0; i < node.children.length; i++) translateTree(node.children[i]);
    }
    return node;
  }

  // ---------- 模型大小（就地缩放，不用重启桌宠） ----------
  function windowMarginRatio() {
    try {
      if (typeof WINDOW_MARGIN_RATIO === 'number' && isFinite(WINDOW_MARGIN_RATIO)) return WINDOW_MARGIN_RATIO;
    } catch (e) { /* 常量没暴露就用兜底 */ }
    return 0.07;
  }

  function getBaseSize(sprite) {
    if (!sprite) return 0;
    if (!sprite.__columbinaBaseSize) {
      var host = bank && bank.baseSize ? bank.baseSize : 0;
      sprite.__columbinaBaseSize = host || sprite.size;
    }
    return sprite.__columbinaBaseSize;
  }

  function applyScale(k) {
    var sprite = getSprite();
    if (!sprite) return false;
    var base = getBaseSize(sprite);
    if (!base) return false;
    var S = window.PetShared || {};
    var next = Math.max(80, Math.round(base * clampScale(k)));
    if (next === sprite.size) return true;
    try {
      sprite.size = next;
      sprite.height = (next * 9) / 16;
      sprite.halfW = next / 2;
      sprite.halfH = sprite.height / 2;
      var canvasH = S.CANVAS_H || 360;
      var feetY = S.FEET_Y || 320;
      sprite.bottomPad = (next * (9 / 16) * (canvasH - feetY)) / canvasH;
      sprite.winH = sprite.height + sprite.bottomPad;
      var box = S.HIT_BOX || { x0: 0, x1: 640, y0: 0, y1: 360 };
      sprite.hitRect = {
        x: (box.x0 / 640) * next,
        y: sprite.bottomPad + (box.y0 / 360) * sprite.height,
        w: ((box.x1 - box.x0) / 640) * next,
        h: ((box.y1 - box.y0) / 360) * sprite.height,
      };
      sprite.sideAllow = (box.x0 / 640) * next;
      var ratio = windowMarginRatio();
      var margin = next * ratio;
      var top = margin;
      try {
        if (typeof S.bubbleTopMarginPx === 'function') top = Math.max(margin, S.bubbleTopMarginPx(sprite.font || {}, next));
      } catch (e2) { /* 兜底用 margin */ }
      // 窗口不能超过工作区：v10 一开始直接照搬 0.5×size 的四周透明余量，3× 时窗口会被撑到
      // 2772x2230（比屏幕还大），顶到任务栏上之后 Windows 会反复重画任务栏——表现就是状态栏
      // 疯狂闪烁。透明余量只是为了气泡和身体贴边，按可用空间收窄完全无损，所以这里按
      // window.screen.availWidth/availHeight 夹一遍：左右对称收窄，纵向优先保气泡上边距。
      var side = margin;
      var topKeep = top;
      var availW = 0;
      var availH = 0;
      try {
        if (window.screen && window.screen.availWidth) availW = window.screen.availWidth;
        if (window.screen && window.screen.availHeight) availH = window.screen.availHeight;
      } catch (e4) { /* 拿不到就按原余量 */ }
      if (availW > 0 && availH > 0) {
        var maxSide = Math.max(0, Math.floor((availW - next) / 2));
        if (side > maxSide) side = maxSide;
        var vertBudget = Math.max(0, Math.floor(availH - sprite.winH));
        var bottom = Math.min(side, Math.max(0, vertBudget - Math.min(topKeep, Math.floor(vertBudget * 0.65))));
        topKeep = Math.min(topKeep, Math.max(0, vertBudget - bottom));
        sprite.margin = { t: topKeep, r: side, b: bottom, l: side };
      } else {
        sprite.margin = { t: topKeep, r: side, b: side, l: side };
      }
      if (sprite.el && sprite.el.style) {
        sprite.el.style.left = side + 'px';
        sprite.el.style.top = topKeep + 'px';
        sprite.el.style.setProperty('--pet-size', next + 'px');
        try {
          if (typeof S.resolveFontPx === 'function') {
            var fp = S.resolveFontPx(sprite.font || {}, next);
            if (fp) {
              sprite.el.style.setProperty('--dsh-pet-font-bubble', fp.bubble + 'px');
              sprite.el.style.setProperty('--dsh-pet-font-tip', fp.tip + 'px');
            }
          }
        } catch (e3) { /* 字号跟不动无伤大雅 */ }
      }
      if (sprite.stage && sprite.stage.style) {
        sprite.stage.style.transform = 'translateY(' + sprite.bottomPad + 'px)';
      }
      sprite.space = null;
      if (typeof sprite.position === 'function') sprite.position();
      return true;
    } catch (e) {
      console.warn('[columbina-voice] 调整模型大小失败', e);
      return false;
    }
  }

  function readAnimInterval() {
    try {
      var raw = localStorage.getItem(ANIM_INTERVAL_KEY);
      if (raw !== null) {
        var n = Number(raw);
        if (isFinite(n) && n >= 0) animIntervalMs = Math.min(60000, Math.round(n));
      }
    } catch (e) { /* localStorage 不可用就保持默认 */ }
    return animIntervalMs;
  }

  function writeAnimInterval(ms) {
    animIntervalMs = Math.max(0, Math.min(60000, Math.round(ms)));
    try { localStorage.setItem(ANIM_INTERVAL_KEY, String(animIntervalMs)); } catch (e) { /* ignore */ }
    return animIntervalMs;
  }

  function installAnimPacing(sprite) {
    if (!sprite) return;
    var proto = Object.getPrototypeOf(sprite);
    if (!proto || typeof proto.handleEnded !== 'function' || proto.__columbinaPacingPatched) return;
    var orig = proto.handleEnded;
    proto.handleEnded = function () {
      var self = this;
      var wait = Math.max(0, Math.round(animIntervalMs));
      if (wait <= 0) return orig.call(self);          // 立即切：原样交给 dsh-pet
      var now = Date.now();
      var gen = self.gen;
      if (self.__columbinaDwellGen !== gen) {         // 这一段第一次播完：开始计它的停留时间
        self.__columbinaDwellGen = gen;
        self.__columbinaDwellUntil = now + wait;
      }
      if (now >= self.__columbinaDwellUntil) return orig.call(self);   // 停够了，切下一段
      // 还没停够：这一遍确实播完了，先把回执给宿主，再从头上循环同一条
      if (self.playback) {
        var pb = self.playback;
        self.playback = null;
        try { self.reportPlayback(pb, 'ended'); } catch (e) { /* ignore */ }
      }
      var el = self.front === 0 ? self.videoA : self.videoB;
      if (!el) return orig.call(self);
      try {
        el.currentTime = 0;
        var p = el.play();
        if (p && typeof p.catch === 'function') p.catch(function () { });
        return undefined;
      } catch (e) {
        return orig.call(self);
      }
    };
    proto.__columbinaPacingPatched = true;
  }

  /** 换形象：把 sprite.animations 换成这套的树，再从头播一下待机（素材是懒加载的，不用重启桌宠） */
  function applySkin(id, opts) {
    var skin = findBySkin(id);
    if (!skin) return false;
    skinId = skin.id;
    if (!opts || opts.persist !== false) {
      try { localStorage.setItem(SKIN_KEY, skinId); } catch (e) { /* ignore */ }
    }
    var sprite = getSprite();
    // 桌宠还没起来：返回 false 让调用方继续重试（以前这里返回 true，
    // 启动时那一次恢复就"成功"了，结果一直挂着空动画树）
    if (!sprite) return false;
    try {
      var tree = JSON.parse(JSON.stringify(skin.tree || {}));
      if (!tree.moves || !Array.isArray(tree.moves.actions)) {
        tree.moves = tree.moves || {};
        tree.moves.actions = tree.moves.actions || [];
      }
      var idlePool = resolveIdlePool(skin);
      if (idlePool.length) tree.idle = idlePool;
      installAnimPacing(sprite);
      sprite.animations = tree;
      if (Array.isArray(tree.idle) && tree.idle.length && typeof sprite.playOnce === 'function') {
        try { sprite.playOnce(tree.idle[0]); } catch (e) { /* 素材缺失就只是不播 */ }
      }
      return true;
    } catch (e) {
      console.warn('[columbina-voice] 换形象失败', e);
      return false;
    }
  }

  /** 菜单里的动作名去掉「去眼罩·」这类前缀 */
  function polishNode(node, prefix) {
    if (!node || typeof node !== 'object') return node;
    if (typeof node.label === 'string') {
      if (prefix && node.label.indexOf(prefix) === 0) node.label = node.label.slice(prefix.length);
    }
    // 菜单里的「碎碎念」有两层意思：动作树那一组是表情动画，顶栏那个是设置入口。
    // 给表情那组改名加注，免得跟「碎碎念设置」混在一起。
    if (node.label === '碎碎念' && Array.isArray(node.children) && node.children.length) {
      var allAnim = true;
      for (var c = 0; c < node.children.length; c++) {
        if (!node.children[c] || typeof node.children[c].anim !== 'string') { allAnim = false; break; }
      }
      if (allAnim) {
        node.label = '碎碎念表情';
        if (!node.hint) node.hint = '表情动画';
        for (var k = 0; k < node.children.length; k++) {
          if (node.children[k] && !node.children[k].hint) node.children[k].hint = '表情';
        }
      }
    }
    if (node.action === 'whisper') {
      node.label = '闲暇一下 · 娅娅的表情包时刻';
      delete node.hint; // 名字够长，hint 会把标签挤成省略号
      node.action = 'columbina-idle';
      node.__columbinaIdle = true;
      delete node.anim;
    }
    if (Array.isArray(node.children)) {
      for (var i = 0; i < node.children.length; i++) polishNode(node.children[i], prefix);
    }
    return node;
  }

  /** 「切换间隔」分支：动图放完之后再停多久才切下一段 */
  function buildAnimIntervalBranch() {
    var items = [];
    for (var i = 0; i < ANIM_INTERVAL_CHOICES.length; i++) {
      var ms = ANIM_INTERVAL_CHOICES[i];
      var item = { label: animIntervalLabel(ms), __columbinaAnimInterval: ms };
      if (Math.abs(ms - animIntervalMs) < 1) item.hint = '当前';
      items.push(item);
    }
    return { label: '切换间隔', hint: animIntervalLabel(animIntervalMs), children: items };
  }

  /** 「语言」：配音 / 字幕 / 菜单 三件事各选一次，允许混搭 */
  function buildLangBranch() {
    function langItems(kind) {
      return LANGS.map(function (lang) {
        var cur = kind === 'voice' ? voiceLang : kind === 'sub' ? subLang : menuLang;
        return {
          label: LANG_NAME[lang],
          hint: lang === cur ? trText('当前') : '',
          __columbinaLangKind: kind,
          __columbinaLang: lang,
        };
      });
    }
    return {
      label: '语言',
      hint: LANG_NAME[voiceLang] + ' / ' + LANG_NAME[subLang] + ' / ' + LANG_NAME[menuLang],
      children: [
        { label: '配音', hint: LANG_NAME[voiceLang], children: langItems('voice') },
        { label: '字幕', hint: LANG_NAME[subLang], children: langItems('sub') },
        { label: '菜单', hint: LANG_NAME[menuLang], children: langItems('menu') },
        {
          label: '打开设置',
          hint: '在 DSH 里打开面板',
          __columbinaOpenSettings: 'lang',
        },
      ],
    };
  }

  /** 「模型大小」：几个常用档位 + 跳转设置里自由调 */
  function buildScaleBranch() {
    var items = SCALE_CHOICES.map(function (k) {
      return {
        label: scaleText(k, menuLang),
        hint: Math.abs(k - scalePref) < 0.001 ? trText('当前') : '',
        __columbinaScale: k,
      };
    });
    items.push({ label: trText('打开设置'), hint: trText('在 DSH 里打开面板'), __columbinaOpenSettings: 'scale' });
    return {
      label: '模型大小',
      hint: scaleText(scalePref, menuLang),
      children: items,
    };
  }

  function buildSkinBranch() {
    if (skins.length < 2) return null;
    var active = currentSkin();
    return {
      label: '2D live 形象',
      hint: active ? '当前：' + active.name : '',
      children: skins.map(function (skin) {
        return {
          label: skin.name,
          hint: skin.id === skinId ? '当前' : '',
          action: 'columbina-skin',
          __columbinaSkin: skin.id,
        };
      }),
    };
  }

  // ---------- 闲暇一下 · 娅娅的表情包时刻 ----------
  // 246 段动图一个池子（四套形象的动作 + 官方动作），随机抽；配图用 12 张共用 memes。
  // 只要求：气泡是我们自己弹的（登记 ownBubbleText），别让它被当成对话回复去念语音。
  var stickerList = bank.stickers || [];

  // ---------- 内置设置面板 ----------
  // 主题（dsh-columbina-theme）关掉之后，右建设置那条通道就断了；
  // 这里在桌宠页面里直接渲染一个面板，改完写本地偏好，不依赖任何宿主。
  var PANEL_ID = 'columbina-voice-panel';
  var panelEl = null;
  var panelSection = 'voice';
  var panelBusy = false;

  function panelStyles() {
    return [
      '#' + PANEL_ID + '{position:fixed;inset:0;z-index:2147483000;',
      'background:transparent;pointer-events:none;font-family:"Microsoft YaHei","PingFang SC","Segoe UI",sans-serif;color:#EFE8FF;',
      'animation:cv-in .16s ease-out}',
      '@keyframes cv-in{from{opacity:0}to{opacity:1}}',
      '#' + PANEL_ID + ' .cv-card{pointer-events:auto;position:absolute;left:8px;top:8px;width:392px;max-height:calc(100vh - 16px);display:flex;flex-direction:column;border-radius:18px;',
      'background:rgba(24,18,36,.97);border:1px solid rgba(160,132,230,.30);',
      'box-shadow:0 26px 70px rgba(0,0,0,.52),inset 0 1px 0 rgba(255,255,255,.05);overflow:hidden}',
      '#' + PANEL_ID + ' .cv-head{display:flex;align-items:center;gap:8px;padding:11px 14px 8px;',
      'border-bottom:1px solid rgba(160,132,230,.16)}',
      '#' + PANEL_ID + ' .cv-title{font-size:13.5px;letter-spacing:.04em;color:#F4EEFF;flex:1}',
      '#' + PANEL_ID + ' .cv-title i{font-style:normal;font-size:10.5px;color:#9C8BC0;margin-left:6px;letter-spacing:0}',
      '#' + PANEL_ID + ' .cv-x{width:24px;height:24px;border:0;border-radius:8px;background:transparent;color:#B9A9DE;',
      'font-size:17px;line-height:1;cursor:pointer}',
      '#' + PANEL_ID + ' .cv-x:hover{background:rgba(255,255,255,.07);color:#fff}',
      '#' + PANEL_ID + ' .cv-body{padding:2px 14px 8px;overflow-y:auto;overflow-x:hidden;scrollbar-width:thin}',
      '#' + PANEL_ID + ' .cv-body::-webkit-scrollbar{width:8px}',
      '#' + PANEL_ID + ' .cv-body::-webkit-scrollbar-thumb{background:rgba(150,124,214,.35);border-radius:8px}',
      '#' + PANEL_ID + ' .cv-sec{font-size:11px;letter-spacing:.14em;color:#9C8BC0;margin:10px 0 6px}',
      '#' + PANEL_ID + ' .cv-row{display:flex;align-items:center;gap:8px;padding:5px 0;font-size:12.5px;color:#DCD2F2}',
      '#' + PANEL_ID + ' .cv-row .cv-lab{flex:1;min-width:74px;color:#CFC3EA}',
      '#' + PANEL_ID + ' .cv-chips{display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end}',
      '#' + PANEL_ID + ' .cv-chip{border:1px solid rgba(160,132,230,.30);background:rgba(255,255,255,.03);',
      'color:#CBBDEA;border-radius:999px;padding:3.5px 10px;font-size:11px;cursor:pointer;transition:all .12s}',
      '#' + PANEL_ID + ' .cv-chip:hover{border-color:rgba(201,175,245,.7);color:#fff}',
      '#' + PANEL_ID + ' .cv-chip.on{background:#C9AFF5;border-color:#C9AFF5;color:#1A1226;font-weight:600}',
      '#' + PANEL_ID + ' .cv-switch{width:38px;height:21px;border-radius:999px;background:rgba(255,255,255,.12);',
      'position:relative;cursor:pointer;border:0;transition:background .16s}',
      '#' + PANEL_ID + ' .cv-switch.on{background:#C9AFF5}',
      '#' + PANEL_ID + ' .cv-switch span{position:absolute;top:2px;left:2px;width:17px;height:17px;border-radius:50%;',
      'background:#EFE8FF;transition:transform .16s}',
      '#' + PANEL_ID + ' .cv-switch.on span{transform:translateX(17px);background:#1A1226}',
      '#' + PANEL_ID + ' input[type=range]{-webkit-appearance:none;width:132px;height:4px;border-radius:4px;',
      'background:rgba(201,175,245,.28);outline:0}',
      '#' + PANEL_ID + ' input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:13px;height:13px;',
      'border-radius:50%;background:#C9AFF5;cursor:pointer}',
      '#' + PANEL_ID + ' .cv-val{font-size:11.5px;color:#9C8BC0;min-width:44px;text-align:right}',
      '#' + PANEL_ID + ' .cv-lines{max-height:150px;overflow-y:auto;border:1px solid rgba(160,132,230,.18);',
      'border-radius:10px;padding:2px 8px;background:rgba(0,0,0,.16)}',
      '#' + PANEL_ID + ' .cv-grp{font-size:11px;color:#9C8BC0;padding:6px 0 2px}',
      '#' + PANEL_ID + ' .cv-line{display:flex;gap:7px;align-items:flex-start;padding:2.5px 0;font-size:12px;',
      'color:#C9BCE4;cursor:pointer;line-height:1.45}',
      '#' + PANEL_ID + ' .cv-line input{margin:1px 0 0;accent-color:#C9AFF5;cursor:pointer;flex:0 0 auto}',
      '#' + PANEL_ID + ' .cv-mini{border:0;background:transparent;color:#9C8BC0;font-size:11px;cursor:pointer;padding:2px 4px}',
      '#' + PANEL_ID + ' .cv-mini:hover{color:#C9AFF5}',
      '#' + PANEL_ID + ' .cv-search{width:100%;box-sizing:border-box;margin:6px 0 5px;padding:5px 9px;border-radius:9px;',
      'border:1px solid rgba(160,132,230,.28);background:rgba(0,0,0,.22);color:#E8DEFF;font-size:11.5px;outline:0}',
      '#' + PANEL_ID + ' .cv-search:focus{border-color:rgba(201,175,245,.72)}',
      '#' + PANEL_ID + ' .cv-lines.tall{max-height:210px}',
      '#' + PANEL_ID + ' .cv-empty{font-size:11px;color:#8E7FB4;padding:6px 2px}',
      '#' + PANEL_ID + ' .cv-foot{padding:7px 14px 9px;border-top:1px solid rgba(160,132,230,.14);',
      'font-size:11px;color:#8E7FB4;letter-spacing:.02em}',
    ].join('');
  }

  function ensurePanelStyles() {
    if (document.getElementById('columbina-voice-panel-style')) return;
    var style = document.createElement('style');
    style.id = 'columbina-voice-panel-style';
    style.textContent = panelStyles();
    document.head.appendChild(style);
  }

  function langChips(kind) {
    var cur = kind === 'voice' ? voiceLang : (kind === 'sub' ? subLang : menuLang);
    return LANGS.map(function (code) {
      return '<button class="cv-chip' + (code === cur ? ' on' : '') + '" data-act="lang" data-kind="' +
        kind + '" data-v="' + code + '">' + LANG_NAME[code] + '</button>';
    }).join('');
  }

  function scaleChips() {
    return SCALE_CHOICES.map(function (k) {
      var pct = Math.round(k * 100) + '%';
      return '<button class="cv-chip' + (Math.abs(k - scalePref) < 0.001 ? ' on' : '') +
        '" data-act="scale" data-v="' + k + '">' + pct + '</button>';
    }).join('');
  }

  function skinChips() {
    if (!skins || skins.length < 2) return '<span class="cv-val">只有一套形象</span>';
    return skins.map(function (s) {
      return '<button class="cv-chip' + (s.id === skinId ? ' on' : '') + '" data-act="skin" data-v="' +
        s.id + '">' + s.name + '</button>';
    }).join('');
  }

  function linesBlock() {
    var groups = [];
    var byTab = {};
    for (var i = 0; i < lineList.length; i++) {
      var line = lineList[i];
      var tab = line.tab || '其他';
      if (!byTab[tab]) { byTab[tab] = []; groups.push(tab); }
      byTab[tab].push(line);
    }
    var html = ['<div class="cv-row" style="padding-top:2px"><span class="cv-lab">只念勾选的句子</span>',
      '<button class="cv-mini" data-act="lines-all">全选</button>',
      '<button class="cv-mini" data-act="lines-none">全不选</button></div>',
      '<div class="cv-lines">'];
    for (var g = 0; g < groups.length; g++) {
      html.push('<div class="cv-grp">' + groups[g] + '</div>');
      var arr = byTab[groups[g]];
      for (var k = 0; k < arr.length; k++) {
        var l = arr[k];
        var text = (l.t && (l.t[subLang] || l.t.zh)) || l.label || '';
        var name = String(l.label || text).replace(/</g, '&lt;');
        html.push('<label class="cv-line" title="' + String(text).replace(/"/g, '&quot;').replace(/</g, '&lt;') +
          '"><input type="checkbox" data-act="line" data-idx="' + l.index + '"' +
          (lineAllowed(l) ? ' checked' : '') + '><span>' + name + '</span></label>');
      }
    }
    html.push('</div>');
    return html.join('');
  }

  function cityLabel() {
    var g = weatherGeo || readStore(WEATHER_GEO_KEY);
    if (!g) return '还没认出城市';
    return g.cityZh || g.city || '';
  }

  // ---------- 设置面板：待机动作（可搜索勾选） ----------
  var idleFilter = '';
  function cvEscape(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }
  function idleModeRow() {
    var modes = [['curated', '精选'], ['all', '全部动作'], ['custom', '自己选']];
    return '<div class="cv-row"><span class="cv-lab">模式</span><div class="cv-chips">' +
      modes.map(function (m) {
        return '<button class="cv-chip' + (idlePref.mode === m[0] ? ' on' : '') + '" data-act="idle-mode" data-v="' +
          m[0] + '">' + m[1] + '</button>';
      }).join('') + '</div></div>';
  }
  function idleListHTML() {
    var skin = currentSkin();
    var pool = skinPool(skin);
    var picks = idlePicksOf(skin);
    var q = idleFilter.toLowerCase();
    var rows = [];
    for (var i = 0; i < pool.length; i++) {
      var name = pool[i];
      var label = stripAnimPrefix(name, skin);
      if (q && label.toLowerCase().indexOf(q) < 0 && name.toLowerCase().indexOf(q) < 0) continue;
      var on = picks.indexOf(name) >= 0;
      rows.push('<label class="cv-line" title="' + cvEscape(name) + '"><input type="checkbox" data-act="idle-pick" data-v="' +
        cvEscape(name) + '"' + (on ? ' checked' : '') + '><span>' + cvEscape(label) + '</span></label>');
    }
    if (!rows.length) return '<div class="cv-empty">没有匹配「' + cvEscape(idleFilter) + '」的动作</div>';
    return rows.join('');
  }
  function idleCountText() {
    return idleModeText() + '（这套共 ' + skinPool(currentSkin()).length + ' 段）';
  }
  function refreshIdleList() {
    var list = document.getElementById('cv-idle-list');
    if (list) list.innerHTML = idleListHTML();
    var count = document.getElementById('cv-idle-count');
    if (count) count.textContent = idleCountText();
  }

  // 素材自检：桌宠自己看不见目录，只能问宿主（/voice/health、/voice/repair）。
  var assetsInfo = null;
  var assetsBusy = '';
  var assetsNote = '';

  function assetsMb(bytes) {
    var n = Number(bytes) || 0;
    return n > 0 ? (n / 1048576).toFixed(1) + ' MB' : '0 MB';
  }

  function assetsRows() {
    if (!assetsInfo) {
      var hint = assetsBusy ? assetsBusy + '…' : '还没检查';
      return '<div class="cv-row"><span class="cv-lab">状态</span>' +
        '<span class="cv-val" style="flex:1;text-align:left">' + cvEscape(hint) + '</span></div>';
    }
    var voice = assetsInfo.voice || {};
    var webm = assetsInfo.webm || {};
    var memes = assetsInfo.memes || {};
    var rows = [
      '<div class="cv-row"><span class="cv-lab">语音包</span>' +
        '<span class="cv-val" style="flex:1;text-align:left">' + (voice.ready ? '已就绪' : '缺失') +
        ' · ' + (voice.files || 0) + ' 段 · ' + assetsMb(voice.bytes) + '</span></div>',
      '<div class="cv-row"><span class="cv-lab">动作切片</span>' +
        '<span class="cv-val" style="flex:1;text-align:left">' + (webm.count || 0) + ' 段 · ' + assetsMb(webm.bytes) + '</span></div>',
      '<div class="cv-row"><span class="cv-lab">表情包</span>' +
        '<span class="cv-val" style="flex:1;text-align:left">' + (memes.count || 0) + ' 张 · ' + assetsMb(memes.bytes) + '</span></div>'
    ];
    return rows.join('');
  }

  function refreshAssets() {
    var box = document.getElementById('cv-assets');
    if (box) box.innerHTML = assetsRows();
    var note = document.getElementById('cv-assets-note');
    if (note) note.textContent = assetsNote || (assetsBusy ? assetsBusy + '…' : '还没检查过');
    var chk = document.getElementById('cv-assets-check');
    if (chk) {
      chk.textContent = assetsBusy === '检查中' ? '检查中…' : '检查素材';
      chk.disabled = Boolean(assetsBusy);
    }
    var rep = document.getElementById('cv-assets-repair');
    if (rep) {
      rep.textContent = assetsBusy === '修复中' ? '修复中…' : '一键修复';
      rep.disabled = Boolean(assetsBusy);
    }
  }

  function sayQuiet(text) {
    try {
      showBubble(text, 2200, true);
    } catch (e) { /* 气泡失败不影响结果 */ }
  }

  function assetsFetch(repair) {
    if (assetsBusy) return;
    assetsBusy = repair ? '修复中' : '检查中';
    assetsNote = '';
    refreshAssets();
    var url = API_BASE + (repair ? 'voice/repair' : 'voice/health');
    var init = repair ? { method: 'POST', cache: 'no-store' } : { cache: 'no-store' };
    console.log('[columbina-voice] 素材自检 ->', url);
    fetch(url, init).then(function (r) {
      return r.json();
    }).then(function (data) {
      assetsInfo = data || null;
      assetsBusy = '';
      var v = (assetsInfo && assetsInfo.voice) || {};
      var w = (assetsInfo && assetsInfo.webm) || {};
      var m = (assetsInfo && assetsInfo.memes) || {};
      var stamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
      if (repair) {
        assetsNote = (data && data.repaired ? '已重新下载语音包' : '没有缺失（或修复失败，宿主日志有细节）') + ' · ' + stamp;
        sayQuiet(data && data.repaired ? '语音包修好了' : '都齐着呢，不用修');
      } else {
        assetsNote = '已检查 ' + stamp + ' · 语音包 ' + (v.files || 0) + ' 段 / 动作 ' +
          (w.count || 0) + ' 段 / 表情 ' + (m.count || 0) + ' 张';
        sayQuiet('素材自检完成：语音包 ' + (v.files || 0) + ' 段');
      }
      console.log('[columbina-voice] 素材自检完成', assetsNote);
      refreshAssets();
    }).catch(function (err) {
      assetsBusy = '';
      assetsNote = '请求失败：' + (err && err.message ? err.message : String(err));
      console.log('[columbina-voice] 素材自检失败', err);
      sayQuiet('素材自检没连上宿主');
      refreshAssets();
    });
  }

  function renderPanel() {
    if (!panelEl) return;
    var target = document.getElementById('cv-body');
    if (!target) return;
    target.innerHTML = [
      '<div class="cv-sec" data-sec="voice">碎碎念</div>',
      '<div class="cv-row"><span class="cv-lab">开口说话</span>',
      '<button class="cv-switch' + (enabled ? ' on' : '') + '" data-act="enabled" aria-label="切换"><span></span></button></div>',
      '<div class="cv-row"><span class="cv-lab">间隔</span>',
      '<input type="range" min="60" max="180" step="15" value="' + intervalSec + '" data-act="interval">',
      '<span class="cv-val">' + intervalSec + ' 秒</span></div>',
      '<div class="cv-sec" data-sec="lang">语言</div>',
      '<div class="cv-row"><span class="cv-lab">配音</span><div class="cv-chips">' + langChips('voice') + '</div></div>',
      '<div class="cv-row"><span class="cv-lab">字幕</span><div class="cv-chips">' + langChips('sub') + '</div></div>',
      '<div class="cv-row"><span class="cv-lab">菜单</span><div class="cv-chips">' + langChips('menu') + '</div></div>',
      '<div class="cv-sec" data-sec="scale">模型大小</div>',
      '<div class="cv-row"><div class="cv-chips" style="flex:1;justify-content:flex-start">' + scaleChips() + '</div></div>',
      '<div class="cv-sec">2D live 形象</div>',
      '<div class="cv-row"><div class="cv-chips" style="flex:1;justify-content:flex-start">' + skinChips() + '</div></div>',
      '<div class="cv-sec" data-sec="idle">待机动作</div>',
      idleModeRow(),
      '<div class="cv-row"><span class="cv-lab">当前</span><span class="cv-val" id="cv-idle-count" style="flex:1;text-align:left">' +
        cvEscape(idleCountText()) + '</span></div>',
      '<div class="cv-row"><span class="cv-lab">批量</span>',
      '<button class="cv-mini" data-act="idle-all">全选</button>',
      '<button class="cv-mini" data-act="idle-none">全不选</button>',
      '<button class="cv-mini" data-act="idle-curated">还原精选</button></div>',
      '<input class="cv-search" id="cv-idle-search" type="text" placeholder="搜索动作名（呆 / 哭 / 睡觉 …）" value="' + cvEscape(idleFilter) + '">',
      '<div class="cv-lines tall" id="cv-idle-list">' + idleListHTML() + '</div>',
      '<div class="cv-sec" data-sec="assets">语音包与素材</div>',
      '<div id="cv-assets">' + assetsRows() + '</div>',
      '<div class="cv-row"><button class="cv-mini" id="cv-assets-check" data-act="assets-check">检查素材</button>',
      '<button class="cv-mini" id="cv-assets-repair" data-act="assets-repair">一键修复</button></div>',
      '<div class="cv-row"><span class="cv-lab">结果</span>' +
        '<span class="cv-val" id="cv-assets-note" style="flex:1;text-align:left">还没检查过</span></div>',
      '<div class="cv-sec" data-sec="lines">原声台词</div>',
      linesBlock(),
      '<div class="cv-sec" data-sec="weather">天气</div>',
      '<div class="cv-row"><span class="cv-lab">城市</span><span class="cv-val" style="flex:1;text-align:left">' +
        cityLabel() + '</span></div>',
      '<div class="cv-row"><button class="cv-chip" data-act="weather-loc">重新定位</button>',
      '<button class="cv-chip" data-act="weather-today">播报一次</button></div>',
    ].join('');
    var body = document.getElementById('cv-body');
    if (body) {
      var sec = body.querySelector('.cv-sec[data-sec="' + panelSection + '"]');
      var top = sec ? Math.max(0, sec.offsetTop - 6) : 0;
      body.scrollTop = top;
    }
    if (panelSection === 'assets' && !assetsInfo && !assetsBusy) assetsFetch(false);
  }

  function panelPickLine(idx, on) {
    if (allowedLines === null) {
      allowedLines = {};
      for (var i = 0; i < lineList.length; i++) allowedLines[lineList[i].index] = true;
    }
    allowedLines[idx] = on;
    var all = true;
    for (var j = 0; j < lineList.length; j++) {
      if (allowedLines[lineList[j].index] !== true) { all = false; break; }
    }
    if (all) allowedLines = null;
    writeLocalPrefs();
  }

  function panelInput(event) {
    var el = event.target;
    if (!el || el.id !== 'cv-idle-search') return;
    idleFilter = String(el.value || '').trim();
    var list = document.getElementById('cv-idle-list');
    if (list) list.innerHTML = idleListHTML();
  }

  function panelClick(event) {
    var el = event.target && event.target.closest ? event.target.closest('[data-act]') : null;
    if (!el) return;
    var act = el.getAttribute('data-act');
    if (act === 'close') { closeSettingsOverlay(); return; }
    if (act === 'enabled') {
      enabled = !enabled;
      writeLocalPrefs();
      if (!enabled) {
        if (whisperTimer) clearTimeout(whisperTimer);
        whisperTimer = null;
        nextWhisperAt = 0;
      } else {
        scheduleWhisper(intervalMs());
      }
      renderPanel();
      return;
    }
    if (act === 'interval') {
      intervalSec = clampInterval(el.value);
      writeLocalPrefs();
      scheduleWhisper(intervalMs());
      renderPanel();
      return;
    }
    if (act === 'lang') {
      var kind = el.getAttribute('data-kind');
      var code = normLang(el.getAttribute('data-v'), 'zh');
      if (kind === 'voice') voiceLang = code;
      else if (kind === 'sub') subLang = code;
      else menuLang = code;
      writeLocalPrefs();
      renderPanel();
      return;
    }
    if (act === 'scale') {
      scalePref = clampScale(Number(el.getAttribute('data-v')));
      writeLocalPrefs();
      applyScale(scalePref);
      renderPanel();
      return;
    }
    if (act === 'skin') {
      applySkin(el.getAttribute('data-v'));
      renderPanel();
      return;
    }
    if (act === 'idle-mode') {
      idlePref.mode = el.getAttribute('data-v');
      saveIdlePrefs();
      applyIdlePool({ replay: true });
      renderPanel();
      return;
    }
    if (act === 'idle-pick') {
      var pickSkin = currentSkin();
      var pickName = el.getAttribute('data-v');
      if (pickSkin) {
        if (!idlePref.picks) idlePref.picks = {};
        var head = (idlePref.picks[pickSkin.id] || []).slice();
        var at = head.indexOf(pickName);
        if (at >= 0) head.splice(at, 1); else head.push(pickName);
        idlePref.picks[pickSkin.id] = head;
        idlePref.mode = 'custom';
        saveIdlePrefs();
        applyIdlePool({ replay: true });
        refreshIdleList();
      }
      return;
    }
    if (act === 'idle-all' || act === 'idle-none') {
      var bulkSkin = currentSkin();
      if (bulkSkin) {
        if (!idlePref.picks) idlePref.picks = {};
        idlePref.picks[bulkSkin.id] = act === 'idle-all' ? skinPool(bulkSkin).slice() : [];
        idlePref.mode = 'custom';
        saveIdlePrefs();
        applyIdlePool({ replay: true });
        renderPanel();
      }
      return;
    }
    if (act === 'idle-curated') {
      var backSkin = currentSkin();
      if (backSkin && idlePref.picks) idlePref.picks[backSkin.id] = [];
      idlePref.mode = 'curated';
      saveIdlePrefs();
      applyIdlePool({ replay: true });
      renderPanel();
      return;
    }
    if (act === 'assets-check') {
      assetsFetch(false);
      return;
    }
    if (act === 'assets-repair') {
      assetsFetch(true);
      return;
    }
    if (act === 'line') {
      panelPickLine(Number(el.getAttribute('data-idx')), !!el.checked);
      return;
    }
    if (act === 'lines-all' || act === 'lines-none') {
      if (act === 'lines-all') allowedLines = null;
      else {
        allowedLines = {};
        for (var n = 0; n < lineList.length; n++) allowedLines[lineList[n].index] = false;
      }
      writeLocalPrefs();
      renderPanel();
      return;
    }
    if (act === 'weather-loc') {
      if (panelBusy) return;
      panelBusy = true;
      readWeather({ fresh: true, geo: true }).then(function () {
        panelBusy = false;
        renderPanel();
      }).catch(function () {
        panelBusy = false;
        renderPanel();
      });
      return;
    }
    if (act === 'weather-today') {
      speakWeather({ geo: !weatherGeo });
      return;
    }
  }


  // 面板打开期间把卡片矩形登记成可点区域：其余透明区继续穿透，不挡桌面/主界面滚动
  function setPanelBusy(on) {
    try {
      var sprite = getSprite();
      if (!sprite) return;
      sprite.settingsPanelOpen = !!on;
      if (typeof sprite.syncInputBusy === 'function') sprite.syncInputBusy();
      else if (typeof sprite.syncInputRegions === 'function') sprite.syncInputRegions();
    } catch (error) {
      console.warn('[columbina-voice] 面板交互区登记失败', error);
    }
  }


  // 桌宠窗口可能有一截落在屏幕外（宠物贴底时最明显）：卡片按"窗口在屏上的可见部分"定高，
  // 并把顶部对齐到可见区顶端，避免面板下半截跑到屏幕外面。
  // 桌宠窗口可能有一截落在屏幕外（宠物贴边时最明显）：卡片按"窗口在屏上的可见矩形"落位，
  // 横竖都夹在可见区内，避免面板跑到屏幕外被裁掉。
  function panelVisibleBox() {
    var inner = Number(window.innerHeight) || 0;
    var innerW = Number(window.innerWidth) || 0;
    var sy = Number(window.screenY) || 0;
    var sx = Number(window.screenX) || 0;
    var outerH = Number(window.outerHeight) || inner;
    var outerW = Number(window.outerWidth) || innerW;
    var scr = window.screen || {};
    var availH = Number(scr.availHeight) || (sy + outerH);
    var availW = Number(scr.availWidth) || (sx + outerW);
    var availTop = Number(scr.availTop) || 0;
    var availLeft = Number(scr.availLeft) || 0;
    var chromeH = Math.max(0, outerH - inner);
    var chromeW = Math.max(0, outerW - innerW);
    var top0 = Math.max(availTop, sy + chromeH / 2);
    var bottom1 = Math.min(availTop + availH, sy + outerH - chromeH / 2);
    var left0 = Math.max(availLeft, sx + chromeW / 2);
    var right1 = Math.min(availLeft + availW, sx + outerW - chromeW / 2);
    // 转成窗口内容区局部坐标
    var localTop = Math.max(4, top0 - sy - chromeH / 2);
    var localLeft = Math.max(4, left0 - sx - chromeW / 2);
    var localBottom = Math.min(inner, bottom1 - sy - chromeH / 2);
    var localRight = Math.min(innerW, right1 - sx - chromeW / 2);
    return {
      left: localLeft + 6,
      top: localTop + 6,
      width: Math.max(220, localRight - localLeft - 12),
      height: Math.max(96, localBottom - localTop - 12),
    };
  }

  function fitPanelCard() {
    if (!panelEl) return;
    var card = panelEl.querySelector('.cv-card');
    if (!card) return;
    var box = panelVisibleBox();
    card.style.left = Math.round(box.left) + 'px';
    card.style.top = Math.round(box.top) + 'px';
    card.style.width = Math.round(Math.min(392, box.width)) + 'px';
    card.style.maxHeight = Math.round(box.height) + 'px';
  }

  // 窗口被拖动/漫游移动后：只把卡片夹回可见区，不重置用户自己拖好的位置
  function reclampPanelCard() {
    if (!panelEl) return;
    var card = panelEl.querySelector('.cv-card');
    if (!card) return;
    var box = panelVisibleBox();
    var left = parseFloat(card.style.left);
    var top = parseFloat(card.style.top);
    if (!isFinite(left)) left = box.left;
    if (!isFinite(top)) top = box.top;
    card.style.width = Math.round(Math.min(392, box.width)) + 'px';
    card.style.maxHeight = Math.round(box.height) + 'px';
    var maxLeft = box.left + box.width - card.offsetWidth;
    var room = Math.max(0, box.height - card.offsetHeight);
    var slack = room >= 24 ? room : Math.min(Math.round(card.offsetHeight / 3), Math.max(24, Math.round(box.height * 0.25)));
    card.style.left = Math.round(Math.max(box.left, Math.min(left, Math.max(box.left, maxLeft)))) + 'px';
    card.style.top = Math.round(Math.max(box.top, Math.min(top, box.top + slack))) + 'px';
  }

  // 标题栏拖拽：在可见区内移动卡片（不改窗口位置）
  function makeCardDraggable(card) {
    var head = card.querySelector('.cv-head');
    if (!head || head.__cvDragBound) return;
    head.__cvDragBound = true;
    var drag = null;
    head.addEventListener('pointerdown', function (event) {
      if (event.button !== 0) return;
      if (event.target && event.target.closest && event.target.closest('.cv-x')) return;
      var rect = card.getBoundingClientRect();
      drag = { px: event.clientX, py: event.clientY, left: rect.left, top: rect.top };
      head.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    head.addEventListener('pointermove', function (event) {
      if (!drag) return;
      var box = panelVisibleBox();
      var maxLeft = box.left + box.width - card.offsetWidth;
      // 竖直方向：卡片常常和可见区一样高（内容多时），按"整卡平移"算会一格都拖不动。
      // 这里保证至少 24px 的可拖余量（最多放宽到卡高的 1/3），拖出去的部分由卡片自身滚动兜底。
      var room = Math.max(0, box.height - card.offsetHeight);
      var slack = room >= 24 ? room : Math.min(Math.round(card.offsetHeight / 3), Math.max(24, Math.round(box.height * 0.25)));
      var maxTop = box.top + slack;
      var nx = Math.max(box.left, Math.min(drag.left + event.clientX - drag.px, Math.max(box.left, maxLeft)));
      var ny = Math.max(box.top, Math.min(drag.top + event.clientY - drag.py, Math.max(box.top, maxTop)));
      card.style.left = Math.round(nx) + 'px';
      card.style.top = Math.round(ny) + 'px';
    });
    var stop = function () { drag = null; };
    head.addEventListener('pointerup', stop);
    head.addEventListener('pointercancel', stop);
  }
  window.__columbinaPanelFit = fitPanelCard;

  function closeSettingsOverlay() {
    if (panelEl && panelEl.__cvCleanup) { try { panelEl.__cvCleanup(); } catch (error) {} }
    if (panelEl && panelEl.parentNode) panelEl.parentNode.removeChild(panelEl);
    panelEl = null;
    setPanelBusy(false);
  }

  function openSettingsOverlay(section) {
    panelSection = section === 'lang' || section === 'scale' || section === 'idle' || section === 'assets' ? section : 'voice';
    ensurePanelStyles();
    if (panelEl) { renderPanel(); return; }
    panelEl = document.createElement('div');
    panelEl.id = PANEL_ID;
    panelEl.addEventListener('mousedown', function (event) {
      if (event.target === panelEl) closeSettingsOverlay();
    });
    panelEl.innerHTML = [
      '<div class="cv-card">',
      '<div class="cv-head"><span class="cv-title">哥伦比娅 · 设置<i>右键桌宠可再次打开</i></span>',
      '<button class="cv-x" data-act="close" aria-label="关闭">×</button></div>',
      '<div class="cv-body" id="cv-body"></div>',
      '<div class="cv-foot">改动即时生效 · 只记在本机偏好里</div>',
      '</div>',
    ].join('');
    panelEl.addEventListener('click', panelClick);
    panelEl.addEventListener('input', panelInput);
    document.body.appendChild(panelEl);
    renderPanel();
    function onKey(ev) {
      if (ev.key === 'Escape') { document.removeEventListener('keydown', onKey); closeSettingsOverlay(); }
    }
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', fitPanelCard);
    var moveTimer = null;
    window.addEventListener('move', function () {
      if (moveTimer) clearTimeout(moveTimer);
      moveTimer = setTimeout(reclampPanelCard, 120);
    });
    var cardEl = panelEl.querySelector('.cv-card');
    if (cardEl) makeCardDraggable(cardEl);
    setPanelBusy(true);
    fitPanelCard();
    // 键盘关闭 + 点面板外关闭：桌宠窗口平时不抢焦点，这里只在面板打开期间临时抢一次
    try {
      var bridge = window.petBridge;
      if (bridge && typeof bridge.focusWindow === 'function') bridge.focusWindow();
      window.focus();
    } catch (error) { /* 拿不到焦点也不影响鼠标操作 */ }
    var outside = function (event) {
      if (!panelEl) return;
      if (panelEl.contains(event.target)) return;
      closeSettingsOverlay();
    };
    document.addEventListener('pointerdown', outside, true);
    var onBlur = function () { closeSettingsOverlay(); };
    window.addEventListener('blur', onBlur);
    panelEl.__cvCleanup = function () {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('resize', fitPanelCard);
    };
    if (section === 'scale') {
      var body = panelEl.querySelector('#cv-body');
      var scaleSec = body && body.querySelector('[data-sec="scale"]');
      if (scaleSec) scaleSec.scrollIntoView({ block: 'start' });
    }
  }

  /**
   * 菜单里的「打开设置」：直接用桌宠内置面板。
   * 以前把请求转给主题宿主再弹主题的面板，主题关掉/没装时这条路就断了；
   * 内置面板不依赖任何宿主，主题装没装都能开。
   */
  function openSettingsPanel(section) {
    var target = section === 'lang' || section === 'scale' || section === 'whisper' || section === 'idle' || section === 'assets' ? section : 'voice';
    try {
      openSettingsOverlay(target);
      return true;
    } catch (error) {
      console.warn('[columbina-voice] 打开设置面板失败', error);
      return false;
    }
  }

  function idleTime() {
    var sprite = getSprite();
    installWorkGuard(sprite);
    if (!sprite || !stickerList.length) return false;
    var pick = stickerList[Math.floor(Math.random() * stickerList.length)];
    var text = String(pick.text || '');
    var ms = Math.min(6500, 3600 + text.length * 110);
    // 这段气泡是我们自己弹的：登记成「自己的」，否则气泡监听会把它当成对话回复再念一遍语音
    ownBubbleText = text;
    lastText = text;
    subtitleUntil = Date.now() + ms + 260;   // 表情包配文也占着气泡，工作提示别来抢
    holdWorkBubble(sprite, ms);
    try {
      if (typeof sprite.showWhisper === 'function') {
        // anim=false：气泡自己配图（12 张共用 memes 的键），动作由下面 playOnce 负责
        sprite.showWhisper(text, pick.meme || '', '', ms, false);
      }
    } catch (e) {
      console.warn('[columbina-voice] 表情包时刻气泡失败', e);
    }
    try {
      if (typeof sprite.playOnce === 'function') sprite.playOnce(pick.clip);
    } catch (e) {
      /* 素材缺了就只留气泡 */
    }
    return true;
  }

  // ---------- 右键菜单：原声台词 ----------
  /** 把索引里的 menu 变成 dsh-pet 的菜单树：原声台词 → 组 → 其一/其二…（叶子带 __columbinaLine） */
  function buildMenuBranch() {
    var spec = bank.menu || [];
    var groups = [];
    for (var i = 0; i < spec.length; i++) {
      var group = spec[i];
      var items = [];
      for (var k = 0; k < group[1].length; k++) {
        var pair = group[1][k];
        var line = lineList[pair[1]];
        if (!line) continue;
        items.push({
          label: pair[0],
          hint: (function (t) { return t.length > 11 ? t.slice(0, 11) + '…' : t; })(lineTextOf(line, subLang)),
          action: 'columbina-line',
          __columbinaLine: pair[1],
        });
      }
      if (items.length) groups.push({ label: group[0], children: items });
    }
    if (!groups.length) return null;
    return { label: '原声台词', children: groups };
  }

  /** 右键菜单里的省电模式：闲着 30 秒后暂停循环播放的待机动图。 */
  function buildPowerBranch() {
    return {
      label: '省电模式',
      hint: powerPref ? '开 · 闲着 30 秒后暂停待机动图' : '关 · 一直播',
      children: [
        {
          label: powerPref ? '关闭省电' : '开启省电',
          hint: powerPref ? '动画照常播' : '定格待机动图，省 CPU / 电量',
          action: 'columbina-power',
          __columbinaPowerToggle: true,
        },
      ],
    };
  }

  /** 右键菜单里的待机动作：精选 / 全部 / 自己勾。 */
  /** 「语音包与素材」：直接开设置面板的那一段（面板打开时会自动查一次）。 */
  function buildAssetsBranch() {
    return {
      label: '语音包与素材',
      hint: '自检 / 修复',
      children: [
        { label: '打开面板', hint: '检查素材、缺了一键修复', __columbinaOpenSettings: 'assets' },
      ],
    };
  }

  function buildIdleBranch() {
    var skin = currentSkin();
    var pool = skinPool(skin);
    var picks = idlePicksOf(skin);
    var modes = [
      ['curated', '精选（推荐）', '中性待机，不会随机哭/坐牢'],
      ['all', '当前形象全部动作', '共 ' + pool.length + ' 段，剧情动作也会出现'],
      ['custom', '自己选…', picks.length ? ('已选 ' + picks.length + ' 段') : '在下面逐个勾'],
    ];
    var children = modes.map(function (m) {
      return {
        label: m[1],
        hint: (idlePref.mode === m[0] ? '当前 · ' : '') + m[2],
        action: 'columbina-idle',
        __columbinaIdleMode: m[0],
      };
    });
    if (idlePref.mode === 'custom' && pool.length) {
      children.push({
        label: '选择动作…',
        hint: '打开设置面板，可搜索勾选',
        __columbinaOpenSettings: 'idle',
      });
    }
    return { label: '待机动作', hint: idleModeText(), children: children };
  }

  /** 右键菜单里的夜间勿扰：开关 + 几个常用时段。 */
  function buildQuietBranch() {
    var presets = [
      [22 * 60, 7 * 60],
      [23 * 60, 8 * 60],
      [0, 9 * 60],
      [1 * 60, 10 * 60],
    ];
    return {
      label: '夜间勿扰',
      hint: quietPref.on ? '开 · ' + quietText() : '关',
      children: [
        {
          label: quietPref.on ? '关闭勿扰' : '开启勿扰',
          hint: quietPref.on ? '现在会说话' : '这段时间不主动开口',
          action: 'columbina-quiet',
          __columbinaQuietToggle: true,
        },
      ].concat(presets.map(function (range) {
        var current = quietPref.start === range[0] && quietPref.end === range[1];
        return {
          label: hhmmText(range[0]) + '–' + hhmmText(range[1]),
          hint: current ? '当前' : '',
          action: 'columbina-quiet',
          __columbinaQuietStart: range[0],
          __columbinaQuietEnd: range[1],
        };
      })),
    };
  }

  /** 右键菜单里的音量：静音开关 + 五档音量。 */
  function buildVolumeBranch() {
    var choices = [0.2, 0.4, 0.6, 0.8, 1];
    return {
      label: '音量',
      hint: mutedPref ? '静音' : Math.round(volumePref * 100) + '%',
      children: [
        {
          label: mutedPref ? '静音：开' : '静音：关',
          hint: '点一下切换',
          action: 'columbina-volume',
          __columbinaMute: true,
        },
      ].concat(choices.map(function (value) {
        return {
          label: Math.round(value * 100) + '%',
          hint: (!mutedPref && Math.abs(value - volumePref) < 0.001) ? '当前' : '',
          action: 'columbina-volume',
          __columbinaVolume: value,
        };
      })),
    };
  }

  /** 右键菜单里的碎碎念快捷设置（长期设置仍在 设置 → 哥伦比娅 · 语音）。 */
  function buildWhisperBranch() {
    var intervals = [60, 75, 90, 105, 120, 150, 180];
    if (intervals.indexOf(clampInterval(intervalSec)) < 0) intervals.push(clampInterval(intervalSec));
    intervals.sort(function (a, b) { return a - b; });
    return {
      label: '碎碎念设置',
      hint: '开关 / 间隔 / 选台词',
      children: [
        {
          label: enabled ? '碎碎念：开' : '碎碎念：关',
          hint: '点一下切换',
          action: 'columbina-whisper-toggle',
          __columbinaWhisperToggle: true,
        },
        {
          label: '间隔',
          hint: clampInterval(intervalSec) + ' 秒',
          children: intervals.map(function (sec) {
            return {
              label: sec + ' 秒',
              hint: sec === clampInterval(intervalSec) ? '当前' : '',
              action: 'columbina-whisper-interval',
              __columbinaInterval: sec,
            };
          }),
        },
        {
          label: '选择台词…',
          hint: '打开设置面板',
          __columbinaOpenSettings: 'whisper',
        },
      ],
    };
  }

  /**
   * 包住 PetShared.mountContextMenu：往树末追加「原声台词」分支，
   * 并在 onAction 里截住带 __columbinaLine 的叶子（菜单已经在 onAction 之前自己关掉了，
   * 见 shared-core.js:1049 `close(); onAction(node);`），其余叶子原样交给 sprite.onMenuAction。
   */
  function installMenu() {
    var S = window.PetShared;
    if (!S || typeof S.mountContextMenu !== 'function') return false;
    if (S.__columbinaMenuPatched) return true;
    var orig = S.mountContextMenu;
    S.mountContextMenu = function (opts) {
      try {
        if (opts && Array.isArray(opts.tree)) {
          var skinBranch = buildSkinBranch();
          var animBranch = buildAnimIntervalBranch();
          var branch = buildMenuBranch();
          var whisperBranch = buildWhisperBranch();
          opts.tree = opts.tree.map(function (n) { return polishNode(n, skinPrefix()); });
          // 顺序：对话 → 切换间隔 → 2D live 形象。
          // 原来形象挤在「显示位置 / 重载配置」后面，连着三个带箭头的项既容易误点、又显得拥挤。
          var extras = [];
          if (animBranch) extras.push(animBranch);
          if (skinBranch) extras.push(skinBranch);
          extras.push(buildLangBranch());
          extras.push(buildScaleBranch());
          extras.push(buildWeatherBranch());
          extras.push(buildVolumeBranch());
          extras.push(buildQuietBranch());
          extras.push(buildPowerBranch());
          extras.push(buildAssetsBranch());
          extras.push({ label: trText('设置面板'), hint: trText('检查、勾选、修复都在这里'), __columbinaOpenSettings: 'voice' });
          extras.push(buildIdleBranch());
          if (extras.length) {
            var chatAt = -1;
            for (var s = 0; s < opts.tree.length; s++) {
              if (opts.tree[s] && opts.tree[s].action === 'chat') { chatAt = s; break; }
            }
            if (chatAt >= 0) opts.tree.splice.apply(opts.tree, [chatAt + 1, 0].concat(extras));
            else opts.tree = opts.tree.concat(extras);
          }
          var tail = [];
          if (branch) tail.push(branch);
          if (whisperBranch) tail.push(whisperBranch);
          if (tail.length) opts.tree = opts.tree.concat(tail);
          // 菜单文案随「菜单语言」翻译（动作/分类/事件组、我们自己的分支都在这里过一遍）
          for (var t = 0; t < opts.tree.length; t++) translateTree(opts.tree[t]);
        }
        if (opts && typeof opts.onAction === 'function') {
          var inner = opts.onAction;
          opts.onAction = function (node) {
            if (node && typeof node.__columbinaOpenSettings === 'string') {
              openSettingsPanel(node.__columbinaOpenSettings);
              return undefined;
            }
            if (node && node.__columbinaIdle) {
              idleTime();
              return undefined;
            }
            if (node && typeof node.__columbinaLine === 'number') {
              playLine(lineList[node.__columbinaLine], true);
              return undefined;
            }
            if (node && node.__columbinaPowerToggle) {
              powerPref = !powerPref;
              savePowerPrefs();
              if (powerPref) {
                document.addEventListener('mousemove', kickPowerTimer, { passive: true });
                document.addEventListener('mousedown', kickPowerTimer, { passive: true });
                kickPowerTimer();
              } else {
                if (powerTimer) { clearTimeout(powerTimer); powerTimer = null; }
                resumeIdleVideos();
              }
              showBubble(powerPref ? '省电模式：开' : '省电模式：关', 2200, true);
              return undefined;
            }
            if (node && typeof node.__columbinaIdleMode === 'string') {
              idlePref.mode = node.__columbinaIdleMode;
              saveIdlePrefs();
              applyIdlePool({ replay: true });
              showBubble('待机动作：' + idleModeText(), 2200, true);
              return undefined;
            }
            if (node && typeof node.__columbinaIdlePick === 'string') {
              var idleSkin = currentSkin();
              var pickName = node.__columbinaIdlePick;
              if (idleSkin) {
                if (!idlePref.picks) idlePref.picks = {};
                var pickedArr = (idlePref.picks[idleSkin.id] || []).slice();
                var pickAt = pickedArr.indexOf(pickName);
                if (pickAt >= 0) pickedArr.splice(pickAt, 1); else pickedArr.push(pickName);
                idlePref.picks[idleSkin.id] = pickedArr;
                idlePref.mode = 'custom';
                saveIdlePrefs();
                applyIdlePool();
                showBubble(pickedArr.length ? ('待机动作勾选 ' + pickedArr.length + ' 段') : '一段都没选，先用精选', 1500, true);
              }
              return undefined;
            }
            if (node && node.__columbinaQuietToggle) {
              quietPref.on = !quietPref.on;
              saveQuietPrefs();
              showBubble(quietPref.on ? '夜间勿扰：开 · ' + quietText() : '夜间勿扰：关', 2600, true);
              return undefined;
            }
            if (node && typeof node.__columbinaQuietStart === 'number' && typeof node.__columbinaQuietEnd === 'number') {
              quietPref.start = node.__columbinaQuietStart;
              quietPref.end = node.__columbinaQuietEnd;
              quietPref.on = true;
              saveQuietPrefs();
              showBubble('夜间勿扰：' + quietText(), 2600, true);
              return undefined;
            }
            if (node && node.__columbinaMute) {
              mutedPref = !mutedPref;
              saveVolumePrefs();
              applyVolume();
              showBubble(mutedPref ? '已静音' : '声音回来了', 2200, true);
              return undefined;
            }
            if (node && typeof node.__columbinaVolume === 'number') {
              volumePref = Math.min(1, Math.max(0, node.__columbinaVolume));
              mutedPref = false;
              saveVolumePrefs();
              applyVolume();
              showBubble('音量 ' + Math.round(volumePref * 100) + '%', 1800, true);
              return undefined;
            }
            if (node && node.__columbinaWhisperToggle) {
              enabled = !enabled;
              writeLocalPrefs();
              if (!enabled) {
                if (whisperTimer) clearTimeout(whisperTimer);
                whisperTimer = null;
                nextWhisperAt = 0;
              } else {
                scheduleWhisper(intervalMs());
              }
              return undefined;
            }
            if (node && typeof node.__columbinaSkin === 'string') {
              applySkin(node.__columbinaSkin);
              return undefined;
            }
            if (node && typeof node.__columbinaLangKind === 'string' && typeof node.__columbinaLang === 'string') {
              var kind = node.__columbinaLangKind;
              var lang = normLang(node.__columbinaLang, 'zh');
              if (kind === 'voice') voiceLang = lang;
              else if (kind === 'sub') subLang = lang;
              else menuLang = lang;
              writeLocalPrefs();
              return undefined;
            }
            if (node && typeof node.__columbinaScale === 'number') {
              scalePref = clampScale(node.__columbinaScale);
              writeLocalPrefs();
              applyScale(scalePref);
              return undefined;
            }
            if (node && node.__columbinaWeather === 'relocate') {
              readWeather({ fresh: true, geo: true }).then(function (w) {
                showBubble(weatherLocText(w), 3600, true);
              }).catch(function () {
                showBubble(weatherFailText(), 3600, true);
              });
              return undefined;
            }
            if (node && node.__columbinaWeather === 'today') {
              speakWeather({ geo: !weatherGeo });
              return undefined;
            }
            if (node && typeof node.__columbinaAnimInterval === 'number') {
              writeAnimInterval(node.__columbinaAnimInterval);
              var sp0 = getSprite();
              if (sp0) { sp0.__columbinaDwellGen = null; }
              return undefined;
            }
            if (node && typeof node.__columbinaInterval === 'number') {
              intervalSec = clampInterval(node.__columbinaInterval);
              writeLocalPrefs();
              scheduleWhisper(intervalMs());
              return undefined;
            }
            return inner.apply(this, arguments);
          };
        }
      } catch (e) {
        console.warn('[columbina-voice] 菜单注入失败', e);
      }
      return orig.call(S, opts);
    };
    S.__columbinaMenuPatched = true;
    return true;
  }

  // ---------- 碎碎念：按场合挑一段，字幕与语音同源 ----------
  function scenePool(scene) {
    var labels = SCENE_POOLS[scene] || SCENE_POOLS.musing;
    var out = [];
    var seen = new Set();
    for (var i = 0; i < labels.length; i++) {
      var list = byLabel.get(labels[i]) || [];
      for (var k = 0; k < list.length; k++) {
        var c = list[k];
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        if (c.duration < POOL_MIN_MS / 1000 || c.duration > POOL_MAX_MS / 1000) continue;
        out.push(c);
      }
    }
    return out;
  }

  function recentSet() {
    var s = {};
    for (var i = 0; i < recent.length; i++) s[recent[i]] = 1;
    return s;
  }

  function pickFrom(pool, seen) {
    var fresh = pool.filter(function (c) { return !seen[c.id]; });
    var base = fresh.length ? fresh : pool;
    if (!base.length) return null;
    return base[Math.floor(Math.random() * base.length)];
  }

  /** 场景里挑一段：靠前的标签权重更高（3/2/1），标签内仍然随机，避开最近念过的 */
  function pickWhisper(scene) {
    var labels = SCENE_POOLS[scene] || SCENE_POOLS.musing;
    var bag = [];
    for (var i = 0; i < labels.length; i++) {
      var weight = i === 0 ? 3 : i === 1 ? 2 : 1;
      for (var k = 0; k < weight; k++) bag.push(labels[i]);
    }
    var seen = recentSet();
    for (var attempt = 0; attempt < 6 && bag.length; attempt++) {
      var idx = Math.floor(Math.random() * bag.length);
      var label = bag[idx];
      var list = (byLabel.get(label) || []).filter(function (c) {
        return c.duration >= POOL_MIN_MS / 1000 && c.duration <= POOL_MAX_MS / 1000;
      });
      var nice = list.filter(function (c) { return c.text.length >= 3 && c.text.length <= 26; });
      var hit = pickFrom(nice.length ? nice : list, seen);
      if (hit && hit.text !== lastText) return hit;
      bag.splice(idx, 1); // 这个标签不合适，换下一个
    }
    return null;
  }

  function sceneByClock() {
    var d = new Date();
    var h = d.getHours();
    var r = Math.random();
    if (h >= 23 || h < 5) {
      if (r < 0.45) return 'goodnight';
      if (r < 0.8) return 'night';
      return 'musing';
    }
    if (h >= 5 && h < 9) {
      if (r < 0.35) return 'greet';
      if (r < 0.55) return 'musing';
      return 'memory';
    }
    if (r < 0.06) return 'night';
    if (r < 0.16) return 'ask';
    if (r < 0.26) return 'friend';
    if (r < 0.34) return 'memory';
    if (r < 0.42) return 'play';
    return 'musing';
  }

  var whisperTimer = null;
  var nextWhisperAt = 0;

  var lastWhisperMs = 0;

  /** 一轮碎碎念之间的等待：设置里的间隔 + 一点抖动（60–180 秒）。 */
  function intervalMs() {
    return clampInterval(intervalSec) * 1000;
  }

  function scheduleWhisper(delay) {
    if (whisperTimer) clearTimeout(whisperTimer);
    var ms = typeof delay === 'number' ? delay : intervalMs() + Math.random() * 15000;
    nextWhisperAt = Date.now() + ms;
    whisperTimer = setTimeout(runWhisper, ms);
  }

  /** 桌宠正在播「工作状态」动画 = 主人正在干活，这时候先别说话 */
  function inWorkStatus() {
    var sprite = getSprite();
    if (!sprite) return false;
    // dsh-pet 在 onWorkTick 里写 sprite.workState（thinking / working / result / waiting / success / error），
    // 空闲时为 null —— 这个才是「主人正在干活」的真信号。
    if (typeof sprite.workState === 'string' && sprite.workState) return true;
    var pool = (sprite.animations && sprite.animations.events && sprite.animations.events.workStatus) || [];
    if (!pool.length) return false;
    return pool.indexOf(sprite.anim) >= 0;
  }

  function runWhisper() {
    whisperTimer = null;
    if (!enabled) { nextWhisperAt = 0; return; }
    // 干活途中也让碎碎念照常冒出来：工作气泡常驻，但它只是被临时借走一会儿（见 holdWorkBubble），
    // 所以这里只挡「我们的整句台词 / 正在播音」和「别人正在显示的对话回复」。
    if (lineLocked() || speaking) return scheduleWhisper(6000 + Math.random() * 8000);
    if (bubbleVisible() && !inWorkStatus()) return scheduleWhisper(6000 + Math.random() * 8000);
    var scene = sceneByClock();
    lastWhisperMs = 0;
    whisper(scene);
    // 念完之后再开始等：长台词不会刚读完就接下一轮
    scheduleWhisper(intervalMs() + lastWhisperMs + Math.round(Math.random() * 12000));
  }

  /** 场景里挑一整句（拼合句优先过：台词完整、更像她自己在说话） */
  function pickSentence(scene) {
    var labels = SCENE_POOLS[scene] || SCENE_POOLS.musing;
    var pool = [];
    var seen = new Set();
    for (var i = 0; i < labels.length; i++) {
      var list = lineByLabel.get(labels[i]) || [];
      for (var k = 0; k < list.length; k++) {
        var line = list[k];
        if (seen.has(line.index)) continue;
        seen.add(line.index);
        var lineDur = lineDurOf(line, voiceLang);
        var lineTxt = subtitleOf(line);
        if (lineDur < 1.2 || lineDur > 9) continue;
        if (lineTxt.length < 4 || lineTxt.length > 34) continue;
        pool.push(line);
      }
    }
    if (!pool.length) return null;
    var fresh = pool.filter(function (l) { return l.text !== lastText; });
    var base = fresh.length ? fresh : pool;
    return base[Math.floor(Math.random() * base.length)];
  }

  /** 说一句：四成机会念一整句，其余按场合挑一段碎片；先弹字幕再出声 */
  function whisper(scene, force) {
    if (!force && inQuietWindow()) return null;   // 夜间勿扰：不主动说话
    if (!force && inWorkStatus()) return null;
    if (!force && (lineLocked() || speaking)) return null;   // 整句/原声台词优先，碎碎念让路
    var key = scene || 'musing';
    // 非中文配音：碎片池是中文的，不能搬过来——只念这个语言的官方原声台词
    if (normLang(voiceLang, 'zh') !== 'zh') {
      var poolAny = [];
      for (var ai = 0; ai < lineList.length; ai++) {
        if (lineFileOf(lineList[ai], voiceLang)) poolAny.push(lineList[ai]);
      }
      if (!poolAny.length) return null;
      var anyLine = poolAny[Math.floor(Math.random() * poolAny.length)];
      lastWhisperMs = Math.round(lineDurOf(anyLine, voiceLang) * 1000);
      markLine(anyLine);
      return playLine(anyLine, true);
    }
    // 设置里勾了「只念选中的台词」时，碎片一律不念（否则勾选就没意义）
    var onlySelected = allowedLines !== null;
    // 五成半念一整句台词（默认全部台词都可能被念到），其余按场合挑一段碎片
    if (onlySelected || Math.random() < 0.55) {
      var line = pickWhisperLine(key);
      if (line) {
        lastWhisperMs = Math.round((lineDurOf(line, voiceLang) || 3) * 1000);
        markLine(line);
        return playLine(line, true);
      }
    }
    if (onlySelected) return null;          // 只念选中的台词，碎片不掺
    var clip = pickWhisper(key);
    // 没有文字的碎片不念 —— 出声却没字幕，是最难解释给用户看的那种"莫名其妙"
    if (!clip || !String(clip.text || '').trim()) return null;
    var ms = Math.max(2800, Math.round(clip.duration * 1000) + 900);
    lastWhisperMs = ms;
    var shown = showBubble(clip.text, ms);
    if (!shown && !getSprite()) {
      // 拿不到 sprite 时只出声（例如排障环境），至少别静默失败
      console.warn('[columbina-voice] 拿不到 PetSprite，只播声音不弹字幕');
    }
    markRecent(clip);
    enqueue(function () {
      stopAudio();
      return playClip(clip);
    });
    return clip;
  }

  // ---------- 对话回复 → 说话 ----------
  var watchTimer = null;
  function checkBubble() {
    if (lineLocked()) return;                     // 正在念整句/原声台词，别把气泡当成对话回复
    var el = document.querySelector('.pet-bubble');
    if (!el || !el.classList.contains('is-on')) {
      lastText = '';
      if (el && !lineLocked()) ownBubbleText = '';
      return;
    }
    var text = (el.textContent || '').trim();
    if (!text) return;
    // 干活中：这条气泡是 dsh-pet 的工作状态提示（「正在处理任务呢」…），不是对话回复，
    // 记成自己的文本，既不配音也不会在之后被当成新回复补念。
    var sprite = getSprite();
    var workText = sprite && sprite.workText ? String(sprite.workText).trim() : '';
    if (inWorkStatus() || (workText && text === workText)) {
      ownBubbleText = text;
      lastText = text;
      return;
    }
    if (speaking) {
      // 自己正在念（碎碎念/台词）：这期间气泡里换的字是工作文案或自己的字幕，别当成新回复去配音，
      // 否则 playClips 会 stopAudio，把正在念的碎碎念当场掐掉。
      ownBubbleText = text;
      lastText = text;
      return;
    }
    if (text === ownBubbleText) return;            // 自己弹的碎碎念，已经配过音了
    if (text === lastText) return;
    if (Date.now() - lastAt < COOLDOWN_MS) return;
    lastText = text;
    lastAt = Date.now();
    var clips = selectClips(text);
    if (!clips.length) return;
    playClips(clips);
    scheduleWhisper(); // 刚说过话，碎碎念往后推
  }

  function onBubbleChange() {
    if (watchTimer) clearTimeout(watchTimer);
    watchTimer = setTimeout(checkBubble, STABLE_MS);
  }

  // ---------- 对外接口 ----------
  window.__columbinaVoice = {
    get enabled() { return enabled; },
    get skin() { return skinId; },
    get skins() { return skins.map(function (s) { return s.id + ':' + s.name; }); },
    setSkin: function (id) { return applySkin(id); },
    idleTime: function () { return idleTime(); },
    openSettings: function (section) { return openSettingsPanel(section); },
    get lang() { return { voice: voiceLang, sub: subLang, menu: menuLang }; },
    setLang: function (kind, lang) {
      var L = normLang(lang, 'zh');
      if (kind === 'voice') voiceLang = L;
      else if (kind === 'sub') subLang = L;
      else if (kind === 'menu') menuLang = L;
      else return window.__columbinaVoice.lang;
      writeLocalPrefs();
      return window.__columbinaVoice.lang;
    },
    get scale() { return scalePref; },
    setScale: function (k) {
      scalePref = clampScale(k);
      writeLocalPrefs();
      applyScale(scalePref);
      return scalePref;
    },
    scaleChoices: SCALE_CHOICES.slice(),
    langs: LANGS.slice(),
    stickers: stickerList.length,
    stickerPool: function () { return stickerList.length; },
    animInterval: function (ms) {
      if (typeof ms === 'number') return writeAnimInterval(ms);
      return animIntervalMs;
    },
    animIntervalChoices: ANIM_INTERVAL_CHOICES.slice(),
    get speaking() { return speaking; },
    get clips() { return bank.clips.length; },
    get lines() { return lineList.length; },
    get last() { return lastText; },
    get current() {
      return current
        ? { t: current.currentTime, dur: current.duration, paused: current.paused, src: current.currentSrc || current.src }
        : null;
    },
    get nextInMs() { return Math.max(0, nextWhisperAt - Date.now()); },
    setEnabled: function (on) {
      enabled = !!on;
      if (!enabled) {
        stopAudio();
        if (whisperTimer) clearTimeout(whisperTimer);
        whisperTimer = null;
        nextWhisperAt = 0;
      } else {
        scheduleWhisper();
      }
      return enabled;
    },
    speak: function (text) {
      var clips = selectClips(text);
      playClips(clips);
      return clips.map(function (c) { return c.id; });
    },
    whisper: function (scene, force) {
      var item = whisper(scene, force);
      if (!item) return null;
      return item.ids ? 'line:' + item.index : item.id;
    },
    weather: function (force) {
      return speakWeather({ fresh: true, geo: force === 'geo' });
    },
    weatherInfo: function (force) {
      return readWeather({ fresh: !!force, geo: force === 'geo' });
    },
    holdWork: function (ms) { var sp = getSprite(); if (!sp) return false; holdWorkBubble(sp, ms); return true; },
    playLine: function (idx) {
      var line = lineList[idx];
      if (!line) return null;
      playLine(line, true);
      return subtitleOf(line);
    },
    menu: function () {
      return (bank.menu || []).map(function (group) {
        return group[0] + '：' + group[1].map(function (pair) {
          var line = lineList[pair[1]];
          return pair[0] + '=' + (line ? subtitleOf(line) : '（缺）');
        }).join('／');
      });
    },
    plan: function (text) {
      return selectClips(text).map(function (c) { return c.id; });
    },
    pool: function (scene) {
      return scenePool(scene).map(function (c) { return c.id + '|' + c.text; });
    },
    stop: function () {
      stopAudio();
    },
    state: function () {
      return {
        enabled: enabled,
        speaking: speaking,
        clips: bank.clips.length,
        lines: lineList.length,
        menu: !!(window.PetShared && window.PetShared.__columbinaMenuPatched),
        last: lastText,
        recent: recent.slice(-10),
        skin: skinId,
        skinName: (currentSkin() && currentSkin().name) || '',
        lang: { voice: voiceLang, sub: subLang, menu: menuLang },
        scale: scalePref,
        scene: sceneByClock(),
        nextInMs: Math.max(0, nextWhisperAt - Date.now()),
        settings: {
          enabled: enabled,
          intervalSec: clampInterval(intervalSec),
          lines: allowedLines === null ? null : Object.keys(allowedLines).length,
          settingsAt: settingsAt,
          localAt: localAt,
        },
        sprite: !!getSprite(),
        bubble: bubbleVisible(),
      };
    },
  };

  // ---------- 启动 ----------
  var observer = new MutationObserver(onBubbleChange);
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['class'],
  });

  // 菜单补丁：PetShared 已就绪（shared-core.js 比本脚本先加载）；万一没挂上再补几次
  if (!installMenu()) {
    var menuTries = 0;
    var menuTimer = setInterval(function () {
      if (installMenu() || ++menuTries > 20) clearInterval(menuTimer);
    }, 500);
  }

  // 恢复上次选的形象 / 语言 / 模型大小（桌宠 sprite 可能比本脚本晚初始化，失败就重试几轮）
  readSkinPref();
  readLangPrefs();
  readVolumePrefs();
  readQuietPrefs();
  readPowerPrefs();
  readIdlePrefs();
  if (powerPref) {
    document.addEventListener('mousemove', kickPowerTimer, { passive: true });
    document.addEventListener('mousedown', kickPowerTimer, { passive: true });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) resumeIdleVideos();
      else kickPowerTimer();
    });
    kickPowerTimer();
  }
  (function restoreSkin(tries) {
    var ready = applySkin(skinId, { persist: false });
    if (ready) {
      try { applyScale(scalePref); } catch (e) { /* 缩放失败不影响其余功能 */ }
      return;
    }
    if (tries >= 20) return;
    setTimeout(function () { restoreSkin(tries + 1); }, 500);
  })(0);

  // 先读一次设置（宿主镜像的 voice-settings.js），读完再排第一句；读不到就用默认值
  scheduleWhisper(12000 + Math.random() * 10000); // 启动后先安静一会儿再说第一句
  loadSettings();
  console.info(
    '[columbina-voice] 就绪：' + bank.clips.length + ' 段切片，' + lineList.length + ' 句台词，' +
    (bank.menu || []).length + ' 类原声台词，' + Object.keys(SCENE_POOLS).length + ' 个场合'
  );
})();
