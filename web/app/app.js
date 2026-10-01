// 深渊挂机 · 现代 Web 宿主(web/app)
// 与 CLI/legacy 宿主共用 abyss 核心与存档键(abyss_save_v2)。
// 结构:Pyodide 装载 → app_bridge.py 桥 → rAF 主循环(0.1s 步进)
//      → state() 全量快照渲染 + events() 事件流(日志/飘字/toast/动画)。
"use strict";

const VENDOR = "../legacy/vendor/pyodide/";
const CDN = "https://unpkg.com/pyodide@0.26.4/";
let PYODIDE_URL = VENDOR + "pyodide.mjs";
let PYODIDE_INDEX = VENDOR;
const MODULES = ["__init__", "ansi", "data", "items", "skills",
                 "combat", "systems", "game"];

const $ = (id) => document.getElementById(id);
const loadingMsg = $("loading-msg");

// ---------------------------------------------------------------- 工具
function esc(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]));
}
function fmt(n) {  // 中文计数:万/亿/兆/京(与 ansi.fmt 一致)
  n = Number(n);
  if (!isFinite(n)) return "—";   // NaN/Infinity 防御(如 haste 极端时 dps 除零)
  const neg = n < 0; n = Math.abs(n);
  for (const [div, suf] of [[1e16, "京"], [1e12, "兆"], [1e8, "亿"], [1e4, "万"]]) {
    if (n >= div) return (neg ? "-" : "") + (n / div).toFixed(2) + suf;
  }
  return (neg ? "-" : "") + (n % 1 === 0 ? String(n) : n.toFixed(1));
}
function fmtTime(sec) {
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h) return h + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}
function pctTxt(v) {
  v = Number(v) || 0;
  return (v >= 100 ? v.toFixed(0) : v.toFixed(1).replace(/\.0$/, "")) + "%";
}
/** 定点加成值显示:最多 2 位小数去尾零(词缀求和的浮点残差不上屏) */
function numTxt(v, digits) {
  digits = digits || 2;
  return String(Math.round(v * Math.pow(10, digits)) / Math.pow(10, digits));
}
function toast(text) {
  const el = $("toast");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 1800);
}
function itemMainLine(it) {
  return it.main.name + " " + (it.main.pct ? pctTxt(it.main.val) : fmt(it.main.val));
}
function itemAffixLine(it) {
  const parts = it.affixes.map(a => a.name + (a.pct ? pctTxt(a.val) : "+" + fmt(a.val)));
  if (it.innate) parts.push(it.innate.name + " " + pctTxt(it.innate.val) + "(固有)");
  return parts.join(" / ");
}

// ---------------------------------------------------------------- 状态
let py = null;
let running = false;
let paused = false;
let dirty = true;
let ST = null;           // 最近一次快照
let curTab = "battle";
let offlineShown = false;

// ---------------------------------------------------------------- 启动
async function loadCore(pyodide) {
  pyodide.FS.mkdirTree("/abyss");
  for (const m of MODULES) {
    const src = await (await fetch("/abyss/" + m + ".py")).text();
    pyodide.FS.writeFile("/abyss/" + m + ".py", src, { encoding: "utf8" });
  }
  pyodide.runPython("import sys; sys.path.insert(0, '/')");
  const bridge = await (await fetch("app_bridge.py")).text();
  pyodide.runPython(bridge);
  py = {};
  for (const fn of ["boot", "tick", "state", "events", "cmd",
                    "save_now", "get_save", "import_save",
                    "resolve_gap", "debug_state"]) {
    py[fn] = pyodide.globals.get(fn);
  }
}

async function main() {
  try {
    const probe = await fetch(VENDOR + "pyodide.asm.wasm", { method: "HEAD" });
    if (!probe.ok) throw new Error("no vendor");
  } catch (e) {
    PYODIDE_URL = CDN + "pyodide.mjs";
    PYODIDE_INDEX = CDN;
  }
  loadingMsg.textContent = "正在加载 Python 运行时…";
  const { loadPyodide } = await import(PYODIDE_URL);
  loadingMsg.textContent = "正在编织深渊…";
  const pyodide = await loadPyodide({ indexURL: PYODIDE_INDEX });
  await loadCore(pyodide);
  loadingMsg.textContent = "正在读取存档…";
  py.boot();

  $("loading").classList.add("hide");
  running = true;
  renderNow();

  // 主循环:setInterval 驱动 0.1s 固定步进(与 CLI 一致)。
  // 页面隐藏时不步进(定时器本就被节流),回切时用 resolve() 懒结算补算。
  let last = performance.now();
  let hiddenAt = 0;
  setInterval(() => {
    if (!running || paused || document.hidden) { last = performance.now(); return; }
    const now = performance.now();
    let acc = (now - last) / 1000;
    last = now;
    if (acc > 1) acc = 1;                      // 挂起残余:丢弃,交给懒结算
    let steps = 0;
    while (acc >= 0.1 && steps < 10) {
      py.tick(0.1);
      acc -= 0.1;
      steps += 1;
    }
    drainEvents();
  }, 100);
  setInterval(() => { if (running && !paused) { renderNow(); } }, 200);
  setInterval(() => { if (running && !document.hidden) py.save_now(); }, 10000);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      py.save_now();
    } else if (hiddenAt) {
      const away = (Date.now() - hiddenAt) / 1000;
      hiddenAt = 0;
      last = performance.now();
      if (away >= 30) py.resolve_gap(away);
      py.save_now();
      renderNow();
    }
  });
  window.addEventListener("pagehide", () => py.save_now());
  window.__abyss = { state: () => py.debug_state() };
}

// ---------------------------------------------------------------- 音效
// 战斗音效(CC0,出处见 sfx/README.txt):普攻命中 + 技能按类型分音。
// WebAudio 解码一次缓存播放,音调微变防重复感,按 key 节流;
// 开关存 localStorage(abyss_sfx),与 src/web 宿主行为一致。
const SFX_KEY = "abyss_sfx";
const SFX_STYLE = {
  "attack-hit":    { gain: 0.5,  lo: 0.92, hi: 1.08, ms: 70 },
  "skill-heavy":   { gain: 0.55, lo: 0.97, hi: 1.03, ms: 90 },
  "skill-magic":   { gain: 0.5,  lo: 0.94, hi: 1.06, ms: 90 },
  "skill-arrow":   { gain: 0.5,  lo: 0.94, hi: 1.06, ms: 90 },
  "skill-burst":   { gain: 0.55, lo: 0.96, hi: 1.04, ms: 90 },
  "skill-buff":    { gain: 0.55, lo: 0.98, hi: 1.02, ms: 120 },
  "skill-shield":  { gain: 0.55, lo: 0.98, hi: 1.02, ms: 120 },
  "skill-execute": { gain: 0.6,  lo: 1.0,  hi: 1.0,  ms: 150 },
};
let sfxOn = localStorage.getItem(SFX_KEY) !== "0";
let sfxCtx = null;
const sfxBufs = {}, sfxLastMs = {}, sfxPlays = {};
// 技能 id → 类型(app.js 无核心数据表,用例外表;伤害类按职业前缀)
const SKILL_KIND = {
  w_warcry: "buff", w_fury: "buff", w_roar: "buff",
  m_surge: "buff", r_hawk: "buff", r_dash: "buff", r_god: "buff",
  w_wall: "shield", m_shield: "shield",
  w_exec: "execute",
  r_volley: "multi", r_rain: "multi", r_deadly: "multi",
};
function skillSfxKey(id) {
  const k = SKILL_KIND[id];
  if (k === "buff") return "skill-buff";
  if (k === "shield") return "skill-shield";
  if (k === "execute") return "skill-execute";
  if (k === "multi") return "skill-burst";
  if (id[0] === "w") return "skill-heavy";
  if (id[0] === "r") return "skill-arrow";
  return "skill-magic";
}

/** 页面加载即建 context 并预解码全部音效(suspended 态可解码),首次交互只需 resume */
function initSfx() {
  if (sfxCtx || !sfxOn) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  sfxCtx = new AC();
  for (const key of Object.keys(SFX_STYLE)) {
    fetch("sfx/" + key + ".wav")
      .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error("sfx " + r.status))))
      .then(b => sfxCtx.decodeAudioData(b))
      .then(buf => { sfxBufs[key] = buf; })
      .catch(() => {});   // 单个音效缺失静默降级
  }
}
function ensureSfx() {
  if (sfxOn && sfxCtx && sfxCtx.state === "suspended") sfxCtx.resume();
}
function playSfx(key) {
  if (!sfxOn) return;
  const buf = sfxBufs[key];
  if (!buf || !sfxCtx || sfxCtx.state !== "running") return;
  const st = SFX_STYLE[key];
  const now = performance.now();
  if (now - (sfxLastMs[key] || 0) < st.ms) return;
  sfxLastMs[key] = now;
  const src = sfxCtx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = st.lo + Math.random() * (st.hi - st.lo);
  const gain = sfxCtx.createGain();
  gain.gain.value = st.gain;
  src.connect(gain).connect(sfxCtx.destination);
  src.start();
  sfxPlays[key] = (sfxPlays[key] || 0) + 1;
}
function playAttackHit() { playSfx("attack-hit"); }
function playSkillCast(id) { playSfx(skillSfxKey(id)); }
initSfx();
// 自动播放策略:首次交互解锁(选职业点击必先于战斗)
["pointerdown", "keydown"].forEach(ev =>
  document.addEventListener(ev, ensureSfx, { once: true }));

// ---------------------------------------------------------------- 事件流
const LOG_CAP = 60;
function drainEvents() {
  let evs;
  try { evs = JSON.parse(py.events()); } catch (e) { return; }
  if (!evs.length) return;
  const logBody = $("log-body");
  let logs = [];
  for (const ev of evs) {
    if (ev.kind === "log") {
      logs.push('<div><span class="c-bright_black">' + fmtTime((ST ? ST.time : 0)) +
                "</span> " + spanColor(ev.text, ev.color) + "</div>");
    } else if (ev.kind === "floater") {
      spawnFloater(ev.text, ev.color);
    } else if (ev.kind === "toast") {
      toast(ev.text);
    } else if (ev.kind === "anim") {
      if (ev.text === "mob_flash") flashMon();
      else if (ev.text === "hero_attack") { bumpHero(); playAttackHit(); }
      else if (ev.text.slice(0, 5) === "cast:") playSkillCast(ev.text.slice(5));
      // skill_hit:技能伤害命中,普攻音不叠放(mob_flash 已覆盖闪白)
    }
  }
  if (logs.length) {
    logBody.insertAdjacentHTML("beforeend", logs.join(""));
    while (logBody.children.length > LOG_CAP) logBody.removeChild(logBody.firstChild);
  }
}
function spanColor(text, color) {
  return '<span class="c-' + esc(color || "white") + '">' + esc(text) + "</span>";
}
function spawnFloater(text, color) {
  const layer = $("floaters");
  if (layer.children.length > 10) layer.removeChild(layer.firstChild);
  const el = document.createElement("div");
  el.className = "floater" + (color === "bright_yellow" ? " crit" :
                    color === "bright_green" ? " heal" : "");
  if (color && !el.className.includes("crit") && !el.className.includes("heal"))
    el.classList.add("c-" + color);
  el.textContent = text;
  el.style.left = (20 + Math.random() * 50) + "%";
  el.style.top = (26 + Math.random() * 30) + "%";
  el.addEventListener("animationend", () => el.remove());
  layer.appendChild(el);
}
function flashMon() {
  const el = document.querySelector(".mon-art");
  if (!el) return;
  el.classList.add("flash");
  setTimeout(() => el.classList.remove("flash"), 70);
}
function bumpHero() { /* 预留:英雄卡受击动画 */ }

// ---------------------------------------------------------------- 渲染
function renderNow() {
  if (!running) return;
  let st;
  try { st = JSON.parse(py.state()); } catch (e) { return; }
  ST = st;
  renderTop(st);
  renderBattle(st);
  renderHeroPage(st);
  renderBag(st);
  renderForge(st);
  renderSkills(st);
  renderQuest(st);
  renderSettings(st);
  renderOverlays(st);
  dirty = false;
}

function renderTop(st) {
  const theme = st.zone_name + (st.zone_cycle ? "·深度" + st.zone_cycle : "");
  $("zone-chip").innerHTML =
    '<span>第' + st.zone + "区 · " + st.stage + "层</span>" +
    '<span style="color:var(--dim)">' + esc(theme) + "</span>";
  const modeBtn = $("mode-btn");
  modeBtn.textContent = st.mode === "push" ? "推进▶" : "挂机◎";
  $("res-lv").innerHTML = 'Lv.<span class="v">' + st.level + "</span>";
  $("res-gold").innerHTML = '◈ <span class="v">' + fmt(st.gold) + "</span>";
  $("res-stone").innerHTML = '✦ <span class="v">' + fmt(st.stones) + "</span>";
  $("res-time").textContent = "⏱ " + fmtTime(st.playtime);
  const xpPct = Math.min(100, st.xp / st.xp_req * 100);
  $("res-lv").title = "经验 " + fmt(st.xp) + " / " + fmt(st.xp_req) + " (" + xpPct.toFixed(1) + "%)";
}

// -------- 战斗页
function renderBattle(st) {
  if (!st.class_id) return;

  // 左列:英雄卡
  const h = st.hero;
  const hpPct = Math.max(0, Math.min(100, h.hp / h.max_hp * 100));
  let buffs = st.buffs.map(b =>
    '<span class="buff">' + esc(b.name) + " +" + pctTxt(b.pct) + " " + b.remain + "s</span>"
  ).join("");
  $("hero-card").innerHTML =
    '<h3><span class="dot"></span>英雄 · ' + esc(st.cls.name) + "</h3>" +
    '<div class="bar hero-hp lg"><div class="fill" style="width:' + hpPct + '%"></div>' +
    (h.shield > 0 ? '<i class="shield-mark" style="left:' + hpPct + "%;width:" +
      Math.min(100 - hpPct, h.shield / h.max_hp * 100) + '%"></i>' : "") +
    '<div class="num">' + fmt(h.hp) + " / " + fmt(h.max_hp) +
      (h.shield > 0 ? " (🛡" + fmt(h.shield) + ")" : "") + "</div></div>" +
    '<div class="stat-grid" style="margin-top:9px">' +
      kv("攻击", fmt(h.atk)) + kv("防御", fmt(h.def)) +
      kv("攻速", "+" + pctTxt(h.haste)) + kv("暴击", pctTxt(h.crit)) +
      kv("暴伤", "+" + pctTxt(h.crit_dmg)) + kv("吸血", pctTxt(h.lifesteal)) +
      kv("DPS", fmt(h.dps)) + kv("击杀均时", st.ema_kill ? st.ema_kill.toFixed(1) + "s" : "—") +
    "</div>" + (buffs ? '<div class="buff-row">' + buffs + "</div>" : "");

  // 左列:装备速览
  let eq = "";
  for (const s of ["weapon", "helmet", "armor", "boots", "amulet", "ring"]) {
    const it = st.equip[s];
    eq += '<div class="eq-row"><span class="eq-slot">' + slotName(s) + "</span>" +
      (it ? '<span class="eq-name c-' + it.rcolor + '">' + esc(it.name) + "</span>" +
           '<span class="eq-plus">+' + it.plus + "</span>"
         : '<span class="eq-name eq-empty">— 空 —</span>') + "</div>";
  }
  $("equip-mini").innerHTML = '<h3><span class="dot"></span>装备</h3>' + eq;

  // 中列:层进度
  let dots = "";
  for (let i = 1; i <= 10; i++) {
    const cls = i < st.stage ? "done" : i === st.stage ? "cur" : "";
    dots += '<div class="stage-dot ' + cls + (i === 10 ? " boss" : "") + '"></div>';
  }
  const killsTxt = st.stage === 10
    ? "头目战(1只)"
    : "本层击杀 " + st.stage_kills + " / " + st.kills_per_stage;
  $("stage-track").innerHTML =
    '<div class="stage-track">' + dots + "</div>" +
    '<div class="stage-lbl"><span>第 ' + st.stage + " / 10 层 · " + killsTxt + "</span>" +
    '<span class="act"><span>♛ ' + esc(st.zone_boss) + "</span>" +
    (st.mode === "farm"
      ? '<button class="btn mini" data-cmd="farm_stage" data-a="-1">−</button>' +
        '<span class="mono">' + st.farm_stage + "</span>" +
        '<button class="btn mini" data-cmd="farm_stage" data-a="1">+</button>'
      : "") + "</span></div>";

  // 中列:怪物舞台
  const mon = st.monster;
  let inner = "";
  if (st.respawn > 0) {
    inner = '<div class="respawn">☠ 你被击败了…' + st.respawn.toFixed(1) + " 秒后复活</div>";
  } else if (mon) {
    const tag = mon.boss ? '<span class="tag boss">头目</span>'
              : mon.elite ? '<span class="tag elite">精英</span>' : "";
    const hpPctM = Math.max(0, mon.hp / mon.max_hp * 100);
    // 立绘:mon/<id>.png(头目用 -boss 变体),加载失败回退 ASCII 小画(CSS 控制)
    const size = mon.boss ? " boss" : mon.elite ? " elite" : "";
    const artHtml = mon.id
      ? '<img src="mon/' + mon.id + (mon.boss ? "-boss" : "") + '.png" alt="' +
        esc(mon.name) + '" draggable="false" onerror="this.closest(\'.mon-art\').classList.add(\'imgfail\')">' +
        '<pre class="ascii">' + esc(mon.art.join("\n")) + "</pre>"
      : '<pre class="ascii">' + esc(mon.art.join("\n")) + "</pre>";
    inner =
      '<div class="mon-name c-' + mon.color + '">' + esc(mon.name) +
        tag + '<span class="tier">T' + mon.tier + "</span></div>" +
      '<div class="mon-art' + (mon.id ? " spr" : "") + size + '">' + artHtml + "</div>" +
      '<div style="width:320px"><div class="bar hp lg"><div class="fill" style="width:' +
        hpPctM + '%"></div><div class="num">' + fmt(Math.max(0, mon.hp)) + " / " +
        fmt(mon.max_hp) + "</div></div></div>";
  }
  $("stage-inner").innerHTML = inner;

  // 中列:技能栏(装配中的主动,含冷却)
  let sk = "";
  for (const sid of st.loadout.active) {
    const def = st.skills.active.find(s => s.id === sid);
    if (!def) continue;
    const cd = st.skill_cd[sid] || 0;
    const cdPct = cd > 0 ? Math.min(100, cd / def.cd * 100) : 0;
    sk += '<div class="skill ' + (cd > 0 ? "" : "ready") + '" title="' + esc(def.desc) +
      "｜冷却 " + def.cd + 's">' +
      '<span class="ic">' + def.icon + '</span><span class="nm">' + esc(def.name) + "</span>" +
      (cd > 0 ? '<div class="cdfill" style="height:' + cdPct + '%"></div>' +
        '<div class="cdov">' + Math.ceil(cd) + "</div>" : "") + "</div>";
  }
  $("skillbar-card").innerHTML =
    '<h3><span class="dot"></span>技能 · 自动施放中</h3>' +
    (sk ? '<div id="skillbar">' + sk + "</div>" : '<span style="color:var(--dim)">技能页装配主动技能</span>');

  // 右列:悬赏速览 + 日志(日志由事件流追加)
  let q = "";
  for (const quest of st.quests) {
    const p = Math.min(100, quest.progress / quest.target * 100);
    q += '<div class="q-row"><div class="t"><span>' + esc(quest.desc) + "</span>" +
      '<span class="rew">◈' + fmt(quest.gold) +
      (quest.stones ? ' <span class="st">✦' + quest.stones + "</span>" : "") +
      "</span></div>" +
      '<div class="bar q"><div class="fill" style="width:' + p + '%"></div>' +
      '<div class="num" style="font-size:10px">' + quest.progress + " / " + quest.target +
      "</div></div></div>";
  }
  $("quests-mini").innerHTML = '<h3><span class="dot"></span>悬赏任务</h3>' + q;
}
function kv(k, v) {
  return '<div class="kv"><span class="k">' + k + "</span><b>" + v + "</b></div>";
}
function slotName(s) {
  return { weapon: "武器", helmet: "头盔", armor: "护甲", boots: "鞋子",
           amulet: "项链", ring: "戒指" }[s] || s;
}

// -------- 角色页
function renderHeroPage(st) {
  if (!st.class_id) { $("hero-detail").innerHTML = ""; return; }
  const h = st.hero;
  let slots = "";
  for (const s of ["weapon", "helmet", "armor", "boots", "amulet", "ring"]) {
    const it = st.equip[s];
    if (!it) {
      slots += '<div class="slot-card"><div class="slot-l"><div class="sl">' +
        slotName(s) + '</div><div class="nm eq-empty">— 空 —</div></div>' +
        '<div class="slot-m" style="color:var(--dim)">尚未装备</div></div>';
      continue;
    }
    slots +=
      '<div class="slot-card"><div class="slot-l"><div class="sl">' + slotName(s) +
        " · 评分 " + fmt(it.score) + '</div><div class="nm c-' + it.rcolor + '">' +
        esc(it.name) + '</div><div class="sub">+' + it.plus + " · 全属性" + pctTxt(it.pb) +
        "</div></div>" +
      '<div class="slot-m"><div>' + itemMainLine(it) + "</div>" +
        '<div class="af">' + esc(itemAffixLine(it) || "无词缀") + "</div></div>" +
      '<div class="slot-r">' +
        '<button class="btn mini" data-cmd="enhance" data-a="' + s + '">强化 ◈' + fmt(it.ecost) + "</button>" +
        '<button class="btn mini" data-cmd="reforge" data-a="' + s + '">重铸 ✦' + st.reforge_stones + "</button>" +
        '<button class="btn mini" data-cmd="unequip" data-a="' + s + '">卸下</button>' +
      "</div></div>";
  }
  const xpPct = Math.min(100, st.xp / st.xp_req * 100);
  $("hero-detail").innerHTML =
    '<h3><span class="dot"></span>' + st.cls.icon + " " + esc(st.cls.name) + " · Lv." + st.level + "</h3>" +
    '<div style="color:var(--dim);font-size:12.5px;margin:-6px 0 10px">' + esc(st.cls.desc) + "</div>" +
    '<div class="bar xp lg" style="margin-bottom:12px"><div class="fill" style="width:' +
      xpPct + '%"></div><div class="num">经验 ' + fmt(st.xp) + " / " + fmt(st.xp_req) +
      "</div></div>" +
    '<div class="stat-grid wide" style="margin-bottom:14px">' +
      kv("生命", fmt(h.max_hp)) + kv("攻击", fmt(h.atk)) + kv("防御", fmt(h.def)) +
      kv("攻速", "+" + pctTxt(h.haste)) + kv("暴击率", pctTxt(h.crit)) +
      kv("暴击伤害", "+" + pctTxt(h.crit_dmg)) + kv("吸血", pctTxt(h.lifesteal)) +
      kv("金币加成", pctTxt(h.goldfind)) + kv("闪避", pctTxt(h.dodge)) +
      kv("无视防御", pctTxt(h.armor_pierce)) + kv("技能伤害", "+" + pctTxt(h.skill_dmg)) +
      kv("冷却缩减", pctTxt(h.cd_reduce)) + kv("经验加成", "+" + pctTxt(h.xp_pct)) +
      kv("全技能等级", "+" + numTxt(h.skill_lv)) + kv("理论 DPS", fmt(h.dps)) +
    "</div>" + slots;
}

// -------- 背包页
function renderBag(st) {
  if (!st.class_id) { $("bag-list").innerHTML = ""; return; }
  let cards = "";
  st.bag.forEach((it, i) => {
    cards +=
      '<div class="item r-' + it.rarity + '"><div class="gcd">◈' + fmt(it.sell) + "</div>" +
      '<div class="nm">' + esc(it.name) + (it.plus ? ' <span style="color:#5adfff">+' +
        it.plus + "</span>" : "") + "</div>" +
      '<div class="sub">' + it.slot_name + " · " + it.rname + " · " + it.affixes.length +
        "词缀 · T" + it.tier + "</div>" +
      '<div class="lines">' + esc(itemMainLine(it)) + "<br>" +
        esc(itemAffixLine(it) || "") + "</div>" +
      '<div class="ops">' +
        '<button class="btn mini" data-cmd="equip" data-a="' + i + '">装备</button>' +
        '<button class="btn mini" data-cmd="dismantle" data-a="' + i + '">分解◈' +
          fmt(it.dgold) + (it.dstones ? "✦" + it.dstones : "") + "</button>" +
        '<button class="btn mini" data-cmd="sell" data-a="' + i + '">出售</button>' +
      "</div></div>";
  });
  $("bag-list").innerHTML =
    '<h3><span class="dot"></span>背包 · ' + st.bag.length + " / " + st.bag_size +
    '<span class="rt"><button class="btn" data-cmd="sell_junk">一键出售 普通/精良</button></span></h3>' +
    (cards ? '<div class="bag-grid">' + cards + "</div>"
           : '<div style="color:var(--dim);padding:30px;text-align:center">背包空空如也</div>');
}

// -------- 锻造页
function renderForge(st) {
  if (!st.class_id) { $("forge-list").innerHTML = ""; return; }
  let rows = "";
  for (const s of ["weapon", "helmet", "armor", "boots", "amulet", "ring"]) {
    const it = st.equip[s];
    if (!it) {
      rows += '<div class="slot-card"><div class="slot-l"><div class="sl">' + slotName(s) +
        '</div><div class="nm eq-empty">— 空 —</div></div>' +
        '<div class="slot-m" style="color:var(--dim)">击败怪物以获取装备</div></div>';
      continue;
    }
    rows +=
      '<div class="slot-card"><div class="slot-l"><div class="sl">' + slotName(s) +
        " · 评分 " + fmt(it.score) + '</div><div class="nm c-' + it.rcolor + '">' +
        esc(it.name) + ' <span style="color:#5adfff">+' + it.plus + "</span></div>" +
        '<div class="sub">当前全属性 +' + pctTxt(it.pb) + ",下一级 +" + pctTxt(it.pb_next) +
        "</div></div>" +
      '<div class="slot-m"><div>' + itemMainLine(it) + "</div>" +
        '<div class="af">' + esc(itemAffixLine(it) || "无词缀") + "</div></div>" +
      '<div class="slot-r">' +
        '<div class="cost">◈' + fmt(it.ecost) + "</div>" +
        '<button class="btn" data-cmd="enhance" data-a="' + s + '">⚒ 强化</button>' +
        '<button class="btn" data-cmd="reforge" data-a="' + s + '">✦ 重铸(' +
          st.reforge_stones + "石)</button>" +
      "</div></div>";
  }
  $("forge-list").innerHTML =
    '<h3><span class="dot"></span>锻造 · 强化费用随层数与等级上涨(软上限)</h3>' + rows;
}

// -------- 技能页
function renderSkills(st) {
  if (!st.class_id) { $("loadout-card").innerHTML = ""; $("skill-pools").innerHTML = ""; return; }
  const nSlots = st.loadout_slots;
  let loAct = "", loPas = "";
  for (let i = 0; i < 4; i++) {
    const sid = st.loadout.active[i];
    const def = sid ? st.skills.active.find(s => s.id === sid) : null;
    if (i < nSlots) {
      loAct += '<div class="lo-slot' + (def ? "" : " locked") + '"' +
        (def ? ' data-cmd="unequip_skill" data-a="' + def.id + '" title="点击卸下"' : "") + ">" +
        (def ? '<span class="ic">' + def.icon + '</span><span class="nm">' + esc(def.name) + "</span>"
             : '<span class="ic" style="opacity:.3">+</span>') + "</div>";
    } else {
      loAct += '<div class="lo-slot locked" data-lv="' + st.loadout_unlock[i] + '"></div>';
    }
    const sid2 = st.loadout.passive[i];
    const def2 = sid2 ? st.skills.passive.find(s => s.id === sid2) : null;
    if (i < nSlots) {
      loPas += '<div class="lo-slot' + (def2 ? "" : " locked") + '"' +
        (def2 ? ' data-cmd="unequip_skill" data-a="' + def2.id + '" title="点击卸下"' : "") + ">" +
        (def2 ? '<span class="ic">' + def2.icon + '</span><span class="nm">' + esc(def2.name) + "</span>"
             : '<span class="ic" style="opacity:.3">+</span>') + "</div>";
    } else {
      loPas += '<div class="lo-slot locked" data-lv="' + st.loadout_unlock[i] + '"></div>';
    }
  }
  $("loadout-card").innerHTML =
    '<h3><span class="dot"></span>装配(主动与被动各 ' + nSlots + " 槽,点击已装配技能卸下)</h3>" +
    '<div class="loadout-row"><div class="lo-col"><div class="t">主动技能</div>' +
    '<div class="lo-slots">' + loAct + "</div></div>" +
    '<div class="lo-col"><div class="t">被动技能</div><div class="lo-slots">' + loPas +
    "</div></div></div>";

  // 装备/遗物等级加成叠在基础等级上生效(有效等级可超上限);金币升级上限只看基础等级。
  // 主标签展示基础等级,装备加成作后缀。桥不透出 BAL,常量与核心 skill_lv_max 一致。
  const SKILL_LV_MAX = 10;
  const pool = (list, which) => list.map(s => {
    const maxed = s.lv >= SKILL_LV_MAX;
    const lvTxt = "Lv." + s.lv + (maxed ? " 满" : "") +
      (s.eff > s.lv ? "(装+" + (s.eff - s.lv) + ")" : "");
    return '<div class="sk-card' + (s.unlocked ? "" : " locked") + '">' +
    '<div class="sk-ic">' + s.icon + "</div>" +
    '<div class="sk-body"><div class="nm">' + esc(s.name) +
      '<span class="lv">' + lvTxt + "</span>" +
      (s.equipped ? '<span class="eq">✓已装配</span>' : "") + "</div>" +
      '<div class="ds">' + esc(s.desc) + "</div>" +
      '<div class="cd">解锁 Lv.' + s.unlock + (s.cd ? " · 冷却 " + s.cd + "s" : "") +
      (s.unlocked ? "" : "(未解锁)") + "</div></div>" +
    (s.unlocked
      ? '<div class="sk-ops">' +
        (maxed
          ? '<div class="cost" style="color:var(--dim)">基础已满 Lv.' + SKILL_LV_MAX + "·装备加成仍生效</div>"
          : '<div class="cost">升级 ◈' + fmt(s.cost) + "</div>" +
            '<button class="btn mini" data-cmd="skill_up" data-a="' + s.id + '">升级</button>') +
        (s.equipped
          ? '<button class="btn mini" data-cmd="unequip_skill" data-a="' + s.id + '">卸下</button>'
          : '<button class="btn mini" data-cmd="equip_skill" data-a="' + s.id +
            '" data-b="' + which + '">装配</button>') + "</div>"
      : "") + "</div>";
  }).join("");
  $("skill-pools").innerHTML =
    '<div class="skill-pools"><div class="pool"><h4>✦ 主动技能池</h4>' +
    pool(st.skills.active, "active") + "</div>" +
    '<div class="pool"><h4>◈ 被动技能池</h4>' + pool(st.skills.passive, "passive") +
    "</div></div>";
}

// -------- 悬赏 / 成就页
function renderQuest(st) {
  if (!st.class_id) { $("quest-list").innerHTML = ""; $("ach-list").innerHTML = ""; return; }
  let qs = "";
  for (const q of st.quests) {
    const p = Math.min(100, q.progress / q.target * 100);
    qs += '<div class="q-row"><div class="t"><span>' + esc(q.desc) + "</span>" +
      '<span class="rew">◈' + fmt(q.gold) +
      (q.stones ? ' <span class="st">✦' + q.stones + "</span>" : "") + "</span></div>" +
      '<div class="bar q"><div class="fill" style="width:' + p + '%"></div>' +
      '<div class="num" style="font-size:10px">' + q.progress + " / " + q.target +
      "</div></div></div>";
  }
  $("quest-list").innerHTML = '<h3><span class="dot"></span>悬赏任务(完成后自动刷新)</h3>' + qs;

  let ach = "";
  for (const a of st.achievements) {
    let pips = "";
    for (let i = 0; i < a.total; i++) pips += '<i class="' + (i < a.tiers ? "on" : "") + '"></i>';
    ach += '<div class="ach-row"><div class="ach-info"><div class="nm">' + esc(a.name) +
      '</div><div class="pr">当前 ' + fmt(a.val) +
      (a.next !== null ? " · 下一档 " + fmt(a.next) : " · 已满档") + "</div></div>" +
      '<div class="ach-pips">' + pips + "</div>" +
      '<div class="ach-bonus">' + esc(a.stat) + " +" + (a.stat.includes("点") ? a.bonus : pctTxt(a.bonus)) +
      (a.next !== null ? ' <span class="nx">(每档+' + a.per + ")</span>" : "") + "</div></div>";
  }
  $("ach-list").innerHTML = '<h3><span class="dot"></span>成就(永久加成)</h3>' + ach;
}

// -------- 设置页
const AUTO_SELL_NAMES = ["关闭", "出售「普通」及以下", "出售「精良」及以下",
                         "出售「稀有」及以下", "出售「史诗」及以下", "出售「传说」及以下"];
function renderSettings(st) {
  if (!st.class_id) { $("settings-panel").innerHTML = ""; return; }
  const s = st.settings;
  let opts = "";
  for (let i = -1; i <= 4; i++)
    opts += '<option value="' + i + '"' + (s.auto_sell_idx === i ? " selected" : "") + ">" +
            AUTO_SELL_NAMES[i + 1] + "</option>";
  const stats = st.stats;
  $("settings-panel").innerHTML =
    '<h3><span class="dot"></span>设置</h3>' +
    '<div class="set-row"><div class="lbl">自动换装<div class="d">新掉落评分高于当前 5% 时自动穿上</div></div>' +
      '<div class="toggle' + (s.auto_equip ? " on" : "") + '" data-cmd="auto_equip"></div></div>' +
    '<div class="set-row"><div class="lbl">掉落自动出售<div class="d">低稀有度装备掉落即折现</div></div>' +
      '<select class="sel" data-sel="auto_sell">' + opts + "</select></div>" +
    '<div class="set-row"><div class="lbl">战斗模式<div class="d">推进:击败敌人深入;挂机:停留指定层</div></div>' +
      '<button class="btn" data-cmd="mode">' + (st.mode === "push" ? "切换为挂机" : "切换为推进") +
      "</button></div>" +
    (st.mode === "farm"
      ? '<div class="set-row"><div class="lbl">挂机层位<div class="d">当前 ' + st.farm_stage +
        " 层</div></div>" +
        '<div style="display:flex;gap:6px"><button class="btn" data-cmd="farm_stage" data-a="-1">− 1 层</button>' +
        '<button class="btn" data-cmd="farm_stage" data-a="1">+ 1 层</button></div></div>'
      : "") +
    '<div class="set-row"><div class="lbl">音效<div class="d">普通攻击命中音(复古 8-bit,CC0)</div></div>' +
    '<div class="toggle' + (sfxOn ? " on" : "") + '" data-local="sfx"></div></div>' +
    '<div class="set-row"><div class="lbl">存档<div class="d">自动存档于浏览器(localStorage),离线收益自动结算</div></div>' +
      '<div style="display:flex;gap:6px">' +
      '<button class="btn" data-local="save">手动存档</button>' +
      '<button class="btn" data-local="export">导出</button>' +
      '<button class="btn" data-local="import">导入</button>' +
      '<button class="btn danger" data-local="reset">重置</button></div></div>' +
    '<h3 style="margin-top:16px"><span class="dot"></span>统计</h3>' +
    '<div class="stats-grid">' +
      kv("总击杀", fmt(stats.kills)) + kv("头目击杀", fmt(stats.boss_kills)) +
      kv("死亡", fmt(stats.deaths)) + kv("最远区域", stats.max_zone) +
      kv("强化次数", fmt(stats.enhance_total)) + kv("重铸次数", fmt(stats.reforge_total)) +
      kv("累计金币", fmt(stats.gold_earned)) + kv("悬赏完成", fmt(stats.quest_done)) +
      kv("暴击次数", fmt(stats.crit_hits || 0)) + kv("游玩时长", fmtTime(st.playtime)) +
    "</div>" +
    '<p style="color:var(--dim);font-size:12px;margin-top:14px">快捷键:1-7 切页 · F 推进/挂机 · P 暂停 · S 存档</p>';
}

// -------- 弹窗
function renderOverlays(st) {
  // 职业选择
  const cs = $("class-select");
  if (!st.class_id && !cs.classList.contains("show")) {
    const cl = [
      ["warrior", "⚔", "战士", "钢铁与怒火:生存极强,越战越勇,斩杀收头", "生命×1.30 · 攻击×1.05 · 防御×1.35"],
      ["mage", "✦", "法师", "元素与毁灭:普攻平庸,技能伤害爆炸", "生命×1.05 · 攻击×1.10 · 防御×1.00"],
      ["ranger", "➤", "射手", "风与箭雨:攻速快、暴击高,连击风筝", "生命×0.95 · 攻击×0.95 · 防御×0.90 · 初始暴击5%"],
    ];
    $("cls-grid").innerHTML = cl.map(c =>
      '<div class="cls-card" data-cmd="choose_class" data-a="' + c[0] + '">' +
      '<div class="ic">' + c[1] + '</div><div class="nm">' + c[2] + "</div>" +
      '<div class="ds">' + c[3] + '</div><div class="bs">' + c[4] + "</div></div>").join("");
    cs.classList.add("show");
  } else if (st.class_id && cs.classList.contains("show")) {
    cs.classList.remove("show");
  }
  // 离线报告
  const om = $("offline-modal");
  if (st.pending_offline && !offlineShown) {
    const r = st.pending_offline;
    let items = r.items.map(it =>
      '<span class="c-' + it.rcolor + '">' + esc(it.name) + (it.plus ? " +" + it.plus : "") + "</span>"
    ).join("");
    $("offline-body").innerHTML =
      '<div class="off-row"><span>离开时长</span><b>' + fmtTime(r.sec) + "</b></div>" +
      '<div class="off-row"><span>击杀 / 死亡</span><b>' + r.kills + " / " + r.deaths + "</b></div>" +
      '<div class="off-row"><span>金币</span><b>+' + fmt(r.gold) + "</b></div>" +
      '<div class="off-row"><span>经验</span><b>+' + fmt(r.xp) + "</b></div>" +
      '<div class="off-row"><span>升级 / 推进区域</span><b>+' + r.levels + " / " + r.zones + "</b></div>" +
      (items ? '<div style="font-size:12px;color:var(--dim)">掉落(' + r.items.length + " 件)</div>" +
        '<div class="off-items">' + items + "</div>" : "");
    om.classList.add("show");
    offlineShown = true;
  } else if (!st.pending_offline && om.classList.contains("show")) {
    om.classList.remove("show");
    offlineShown = false;
  }
}

// ---------------------------------------------------------------- 交互
document.addEventListener("click", (e) => {
  const nav = e.target.closest(".nav-item");
  if (nav) {
    curTab = nav.dataset.tab;
    document.querySelectorAll(".nav-item").forEach(n => n.classList.toggle("on", n === nav));
    document.querySelectorAll(".page").forEach(p =>
      p.classList.toggle("on", p.id === "page-" + curTab));
    return;
  }
  const el = e.target.closest("[data-cmd]");
  if (el && running) {
    py.cmd(el.dataset.cmd, el.dataset.a || null, el.dataset.b || null);
    renderNow();
    return;
  }
  const loc = e.target.closest("[data-local]");
  if (loc && running) localCmd(loc.dataset.local);
});
function localCmd(name) {
  if (name === "save") { py.save_now(); toast("已存档到浏览器"); }
  else if (name === "pause") togglePause();
  else if (name === "export") {
    const blob = new Blob([py.get_save()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "abyss-idle-save.json";
    a.click();
    URL.revokeObjectURL(a.href);
    toast("存档已导出");
  } else if (name === "import") $("file-input").click();
  else if (name === "sfx") {
    sfxOn = !sfxOn;
    localStorage.setItem(SFX_KEY, sfxOn ? "1" : "0");
    if (sfxOn && !sfxCtx) initSfx();   // 趁点击手势建 context
    ensureSfx();
    toast(sfxOn ? "音效:开" : "音效:关");
    renderNow();
  } else if (name === "reset") {
    if (confirm("确定清空浏览器存档并重新开始?")) {
      py.cmd("reset");
      renderNow();
    }
  }
}
$("file-input").addEventListener("change", (e) => {
  const f = e.target.files[0];
  if (!f) return;
  f.text().then(txt => {
    const ok = py.import_save(txt);
    toast(ok ? "导入成功" : "导入失败,格式不正确");
    renderNow();
  });
  e.target.value = "";
});
document.addEventListener("change", (e) => {
  const sel = e.target.closest("[data-sel]");
  if (sel && running) { py.cmd("auto_sell", sel.value); renderNow(); }
});
function togglePause() {
  paused = !paused;
  document.body.classList.toggle("paused", paused);
  $("pause-btn").textContent = paused ? "继续" : "暂停";
  toast(paused ? "已暂停(游戏时钟冻结)" : "继续");
}
document.addEventListener("keydown", (e) => {
  if (!running || e.target.tagName === "SELECT" || e.target.tagName === "INPUT") return;
  const tabs = ["battle", "hero", "bag", "forge", "skill", "quest", "settings"];
  if (e.key >= "1" && e.key <= "7") {
    document.querySelector('.nav-item[data-tab="' + tabs[+e.key - 1] + '"]').click();
  } else if (e.key === "f" || e.key === "F") { py.cmd("mode"); renderNow(); }
  else if (e.key === "p" || e.key === "P") togglePause();
  else if (e.key === "s" || e.key === "S") localCmd("save");
});

// ---------------------------------------------------------------- go
main().catch((e) => {
  loadingMsg.textContent = "加载失败:" + e + "(需联网加载运行时,且通过 http:// 访问)";
  console.error(e);
});
