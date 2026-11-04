/*
 * Roll for Initiative (plugin id: roll-initiative)
 * Copyright (c) 2026 Majsnic - MIT License, see LICENSE.
 *
 * Built on the ideas and plain-text block format of Quick Initiative by
 * walkertbrown (Bananafest Destiny), MIT License:
 *   https://github.com/walkertbrown/quick-initiative
 * Encounter syntax and creature view follow Initiative Tracker by
 * Jeremy Valentine (javalent): https://github.com/valentine195/obsidian-initiative-tracker
 * Full credits: CREDITS.md
 *
 * An initiative tracker for Obsidian that talks to the
 * One DnD Character Sheet plugin.
 *
 * - The encounter lives as plain text in a ```roll-initiative``` code block
 *   (Quick Initiative style), so it is readable, syncs with the vault and
 *   works on mobile.
 * - The same encounter can be run from a sidebar view (Initiative Tracker
 *   style). Both views edit the same block.
 * - Monsters get AC / HP / initiative / CR / image from the ```statblock```
 *   block in their note (falls back to frontmatter, then to the Fantasy
 *   Statblocks bestiary).
 * - Player characters built with the character sheet are LIVE: HP, temp HP,
 *   AC, initiative modifier, conditions, exhaustion and death saves are
 *   read from the sheet's own files and every change made in the tracker is
 *   written straight back to the sheet (and vice versa).
 *
 * Plain JavaScript, no build step.
 */

"use strict";

const obsidian = require("obsidian");
const {
  Plugin,
  ItemView,
  MarkdownRenderChild,
  Modal,
  FuzzySuggestModal,
  SuggestModal,
  Notice,
  PluginSettingTab,
  Setting,
  TFile,
  Menu,
  setIcon,
  parseYaml,
  MarkdownRenderer,
} = obsidian;

const BLOCK = "roll-initiative";
const VIEW_TYPE = "roll-initiative-view";
const SHEET_ID = "onednd-character-sheet";
const STATBLOCKS_ID = "obsidian-5e-statblocks";
const DEFAULT_DATA_FOLDER = "Kompendium/Character Sheet Data";

const DEFAULT_CONDITIONS = [
  "Blinded", "Charmed", "Concentrating", "Deafened", "Frightened", "Grappled",
  "Incapacitated", "Invisible", "Paralyzed", "Petrified", "Poisoned", "Prone",
  "Restrained", "Stunned", "Unconscious",
];
const QUICK_CONDITIONS = ["Prone", "Poisoned", "Frightened", "Restrained", "Concentrating"];

const DEFAULT_SETTINGS = {
  system: "dnd5e",
  playersFolder: "",
  npcFolder: "",
  monsterFolder: "",
  rollHp: false,
  skipDown: true,
  autoRollPlayers: false,
  askPlayerInitiative: false,
  groupInitiative: false,
  syncPlayers: true,
  showDifficulty: true,
  concentrationReminder: true,
  openSidebarOnStart: true,
  autoEnd: true,
  atlasSync: true,
  atlasStartsRoll: true,
  atlasFolder: "atlas-vtt",
  combatNote: "Roll Initiative.md",
  openCombatNote: true,
  encounterFolder: "",
  defaultGroupSize: 0, // 0 = the whole count in one group
  autoGroupFrom: 0, // 0 = off; otherwise counts this big start as a group
  showCasualties: true,
  playerScreenBars: "all", // "all" | "players" | "none"
  party: "",
  active: null, // { path, id }
};

// ---------------------------------------------------------------------------
// Pure helpers (no Obsidian API) - unit tested in test/run_tests.js
// ---------------------------------------------------------------------------

const toInt = (v) => {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
  if (typeof v === "string") {
    const m = /-?\d+/.exec(v);
    return m ? parseInt(m[0], 10) : undefined;
  }
  return undefined;
};
const signed = (n) => (n >= 0 ? `+${n}` : String(n));
const isIntToken = (t) => t !== undefined && /^[+-]?\d+$/.test(t);
const abilityMod = (score) => Math.floor((score - 10) / 2);
const linkBasename = (link) => link.split("#")[0].split("^")[0].split("/").pop().replace(/\.md$/i, "");
const randomId = () => Math.random().toString(36).slice(2, 8);
/** Folder setting -> vault path: Windows backslashes become "/", no leading/trailing slash. */
const folderPath = (v) => String(v || "").trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
const capitalize = (s) => s.replace(/\b\w/g, (ch) => ch.toUpperCase());

function parseCondition(raw) {
  const m = /^(.+?)\s*:\s*(\d+)$/.exec(raw.trim());
  if (m) return { name: normalizeCondition(m[1]), dur: parseInt(m[2], 10) };
  return { name: normalizeCondition(raw.trim()) };
}
function normalizeCondition(name) {
  const hit = [...DEFAULT_CONDITIONS, "Seriously Wounded", "Mortally Wounded", "On Fire", "Critical Injury", "Damaged Eye", "Damaged Ear", "Dead"].find((c) => c.toLowerCase() === name.toLowerCase());
  return hit || name;
}
const conditionText = (c) => (c.dur !== undefined ? `${c.name}:${c.dur}` : c.name);

/** Parse one combatant line. Returns an array (a "3x" line expands). */
function parseCombatantLine(line) {
  let text = line.trim().replace(/^[-*+]\s+/, "");
  let current = false;
  if (text.startsWith(">")) {
    current = true;
    text = text.slice(1).trim();
  }
  if (!text) return [];
  let link;
  let alias;
  text = text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/, (_m, l, a) => {
    link = l.trim();
    alias = a ? a.trim() : undefined;
    return " ";
  });
  let conditions = [];
  text = text.replace(/\(([^)]*)\)/, (_m, inner) => {
    conditions = inner.split(",").map((s) => s.trim()).filter(Boolean).map(parseCondition);
    return " ";
  });
  const tokens = text.split(/\s+/).filter(Boolean);
  const nameParts = [];
  let count = 1;
  let groupFlag = false;
  let hpPool = false;
  const c = { name: "", player: false, hidden: false, off: false, conditions, current };
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const low = tok.toLowerCase();
    const next = tokens[i + 1];
    let m;
    if ((m = /^(?:(\d+)x|x(\d+))$/i.exec(tok))) count = parseInt(m[1] || m[2], 10);
    else if (i === 0 && /^\d+$/.test(tok) && (tokens.length > 1 || link)) count = parseInt(tok, 10);
    else if (low === "player" || low === "pc") c.player = true;
    else if (low === "ally" || low === "friendly") c.disp = "ally";
    else if (low === "neutral") c.disp = "neutral";
    else if (low === "enemy" || low === "hostile") c.disp = "enemy";
    else if (low === "hidden") c.hidden = true;
    else if (low === "off" || low === "disabled") c.off = true;
    else if (GROUP_WORDS.includes(low)) {
      groupFlag = true;
      if (next !== undefined && /^\d+$/.test(next)) { c.group = parseInt(next, 10); i++; }
    } else if (low === "each" && next !== undefined && /^\d+$/.test(next)) { c.each = parseInt(next, 10); i++; }
    else if (low === "init" && isIntToken(next)) {
      if (/^[+-]/.test(next)) c.mod = parseInt(next, 10);
      else c.init = parseInt(next, 10);
      i++;
    } else if (low === "mod" && isIntToken(next)) { c.mod = parseInt(next, 10); i++; }
    else if (low === "hp" && next !== undefined && (m = /^(\d+)(?:\/(\d+))?$/.exec(next))) {
      c.hp = parseInt(m[1], 10);
      c.maxHp = m[2] !== undefined ? parseInt(m[2], 10) : c.hp;
      hpPool = m[2] !== undefined;
      i++;
    } else if (low === "temp" && next !== undefined && /^\d+$/.test(next)) { c.temp = parseInt(next, 10); i++; }
    else if (low === "ac" && next !== undefined && /^\d+$/.test(next)) { c.ac = parseInt(next, 10); i++; }
    else if (low === "xp" && next !== undefined && /^\d+$/.test(next)) { c.xp = parseInt(next, 10); i++; }
    else if (low === "lvl" && next !== undefined && /^\d+$/.test(next)) { c.level = parseInt(next, 10); i++; }
    else if (low === "dex" && next !== undefined && /^\d+$/.test(next)) { c.dex = parseInt(next, 10); i++; }
    else if (low === "sp" && next !== undefined && (m = /^(\d+)(?:\/(\d+))?$/.exec(next))) {
      c.sp = { head: parseInt(m[1], 10), body: m[2] !== undefined ? parseInt(m[2], 10) : parseInt(m[1], 10) };
      i++;
    } else if (low === "body" && next !== undefined && /^\d+$/.test(next)) { c.body = parseInt(next, 10); i++; }
    else if (low === "dsp" && next !== undefined && /^\d+$/.test(next)) { c.dsp = parseInt(next, 10); i++; }
    else nameParts.push(tok);
  }
  c.name = nameParts.join(" ") || alias || (link ? linkBasename(link) : "");
  if (link) c.link = link;
  if (alias) c.alias = alias;
  if (!c.name) return [];
  if (groupFlag) {
    // one row for the whole group: `20x [[Goblin]] group` or `[[Goblin]] group 20`
    c.group = Math.max(1, Math.min(c.group || count, 999));
    if (c.each === undefined && c.hp !== undefined && hpPool) {
      // `hp 155/200` on a group is the pool: work out HP each
      c.each = Math.max(1, Math.round(c.maxHp / c.group));
    } else if (c.each === undefined && c.hp !== undefined) {
      // hand-typed `hp 7` on a group means each member's HP
      c.each = c.maxHp ?? c.hp;
      delete c.hp;
      delete c.maxHp;
    }
    return [c];
  }
  count = Math.max(1, Math.min(count, 50));
  if (count === 1) return [c];
  return Array.from({ length: count }, (_v, i) => ({
    ...c,
    name: `${c.name} ${i + 1}`,
    conditions: c.conditions.map((x) => ({ ...x })),
    current: false,
  }));
}

/** Parse a whole block body into an encounter. `party` lines are returned
 *  as markers so the plugin can expand them (needs vault access). */
function parseBlock(source) {
  const enc = { name: "", id: "", round: 0, ended: false, combatants: [], partyRequests: [] };
  for (const raw of source.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("%%") || line.startsWith("//")) continue;
    let m;
    if ((m = /^round\s+(\d+)$/i.exec(line))) { enc.round = parseInt(m[1], 10); continue; }
    if (/^ended$/i.test(line)) { enc.ended = true; continue; }
    if ((m = /^id\s+([A-Za-z0-9_-]+)$/i.exec(line))) { enc.id = m[1]; continue; }
    if ((m = /^name\s+(.+)$/i.exec(line)) && !/\[\[/.test(line)) { enc.name = m[1].trim(); continue; }
    if ((m = /^party(?:\s+(.+))?$/i.exec(line))) {
      enc.partyRequests.push({ group: m[1] ? m[1].trim() : "", index: enc.combatants.length });
      continue;
    }
    enc.combatants.push(...parseCombatantLine(line));
  }
  let seen = false;
  for (const c of enc.combatants) {
    if (c.current && seen) c.current = false;
    if (c.current) seen = true;
  }
  return enc;
}

/** `live` = combatant whose HP/AC/conditions live on a character sheet. */
function serializeCombatant(c, live) {
  const out = [];
  if (c.current) out.push(">");
  const base = c.link ? (c.alias || linkBasename(c.link)) : "";
  if (!c.link || c.name !== base) out.push(c.name);
  if (c.link) out.push(c.alias ? `[[${c.link}|${c.alias}]]` : `[[${c.link}]]`);
  if (c.player) out.push("player");
  if (c.disp) out.push(c.disp);
  if (c.hidden) out.push("hidden");
  if (c.off) out.push("off");
  if (c.group) out.push(`group ${c.group}`);
  if (c.group && c.each !== undefined) out.push(`each ${c.each}`);
  if (c.init !== undefined) out.push(`init ${c.init}`);
  if (!live) {
    if (c.mod !== undefined) out.push(`mod ${signed(c.mod)}`);
    if (c.hp !== undefined) out.push(`hp ${c.hp}/${c.maxHp ?? c.hp}`);
    if (c.temp) out.push(`temp ${c.temp}`);
    if (c.ac !== undefined) out.push(`ac ${c.ac}`);
    if (c.sp) out.push(`sp ${c.sp.head}/${c.sp.body}`);
    if (c.body !== undefined) out.push(`body ${c.body}`);
    if (c.dsp) out.push(`dsp ${c.dsp}`);
    if (c.xp !== undefined) out.push(`xp ${c.xp}`);
    if (c.level !== undefined) out.push(`lvl ${c.level}`);
    if (c.conditions.length) out.push(`(${c.conditions.map(conditionText).join(", ")})`);
  }
  return out.join(" ");
}

function serializeBlock(enc, isLive = () => false) {
  const lines = [];
  if (enc.name) lines.push(`name ${enc.name}`);
  if (enc.id) lines.push(`id ${enc.id}`);
  if (enc.round > 0) lines.push(`round ${enc.round}`);
  if (enc.ended) lines.push("ended");
  for (const c of enc.combatants) lines.push(serializeCombatant(c, isLive(c)));
  return lines.join("\n");
}

/** Sort by initiative, then initiative modifier, then Dex score, then
 *  original order. `stat(c)` returns the effective {mod, dex}. */
function sortCombatants(enc, stat = (c) => c) {
  const order = new Map(enc.combatants.map((c, i) => [c, i]));
  enc.combatants.sort((a, b) => {
    const ia = a.init ?? -Infinity;
    const ib = b.init ?? -Infinity;
    if (ia !== ib) return ib - ia;
    const sa = stat(a);
    const sb = stat(b);
    const ma = sa.mod ?? 0;
    const mb = sb.mod ?? 0;
    if (ma !== mb) return mb - ma;
    const da = sa.dex ?? 10;
    const db = sb.dex ?? 10;
    if (da !== db) return db - da;
    return order.get(a) - order.get(b);
  });
}

function sortKeepCurrent(enc, stat) {
  const cur = enc.combatants.find((c) => c.current);
  sortCombatants(enc, stat);
  for (const c of enc.combatants) c.current = c === cur;
}

const currentIndex = (enc) => enc.combatants.findIndex((c) => c.current);

/** Advance (dir = 1) or rewind (dir = -1) the turn. `canAct(c)` decides who
 *  is skipped. Returns {from, to, newRound} for duration bookkeeping. */
function stepTurn(enc, dir, canAct = () => true) {
  const list = enc.combatants;
  if (!list.length || !list.some(canAct)) return null;
  let idx = currentIndex(enc);
  const from = idx >= 0 ? list[idx] : null;
  let newRound = false;
  if (idx < 0) {
    idx = dir === 1 ? list.findIndex(canAct) : list.length - 1 - [...list].reverse().findIndex(canAct);
    list[idx].current = true;
    enc.round = Math.max(1, enc.round);
    return { from: null, to: list[idx], newRound: false };
  }
  list[idx].current = false;
  do {
    idx += dir;
    if (idx >= list.length) { idx = 0; enc.round++; newRound = true; }
    else if (idx < 0) { idx = list.length - 1; enc.round = Math.max(1, enc.round - 1); }
  } while (!canAct(list[idx]));
  list[idx].current = true;
  return { from, to: list[idx], newRound };
}

/** Tick condition durations on the combatant whose turn just ended. */
function tickDurations(c) {
  const expired = [];
  c.conditions = c.conditions.filter((x) => {
    if (x.dur === undefined) return true;
    x.dur -= 1;
    if (x.dur <= 0) { expired.push(x.name); return false; }
    return true;
  });
  return expired;
}

function rollDice(expr, rng = Math.random) {
  const m = /^\s*(\d+)\s*d\s*(\d+)\s*(?:([+-])\s*(\d+))?\s*$/i.exec(String(expr || ""));
  if (!m) return undefined;
  const n = Math.min(parseInt(m[1], 10), 200);
  const sides = parseInt(m[2], 10);
  let total = 0;
  for (let i = 0; i < n; i++) total += Math.floor(rng() * sides) + 1;
  if (m[3]) total += (m[3] === "-" ? -1 : 1) * parseInt(m[4], 10);
  return Math.max(1, total);
}
const d20 = (rng = Math.random) => Math.floor(rng() * 20) + 1;

/** Find the ```statblock``` block in a note (also inside callouts) and
 *  return its YAML body with callout prefixes stripped. */
function extractStatblock(text) {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^((?:\s*>)*\s*)(`{3,}|~{3,})\s*statblock\b/.exec(lines[i]);
    if (!m) continue;
    const prefixRe = new RegExp("^" + m[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const fence = m[2];
    const body = [];
    for (let j = i + 1; j < lines.length; j++) {
      const stripped = lines[j].replace(prefixRe, "");
      if (stripped.trim().startsWith(fence)) return body.join("\n");
      body.push(stripped);
    }
    return body.join("\n");
  }
  return null;
}

/** Regex fallback for statblocks whose YAML doesn't parse. */
function looseYaml(body) {
  const out = {};
  for (const line of body.split("\n")) {
    const m = /^([A-Za-z_]+):\s*(.*)$/.exec(line);
    if (!m || out[m[1]] !== undefined) continue;
    let v = m[2].trim().replace(/^["']|["']$/g, "");
    if (m[1] === "stats") {
      const nums = (v.match(/-?\d+/g) || []).map(Number);
      out.stats = nums;
      continue;
    }
    out[m[1]] = v;
  }
  return out;
}

const CR_XP = {
  "0": 10, "1/8": 25, "1/4": 50, "1/2": 100, "1": 200, "2": 450, "3": 700, "4": 1100,
  "5": 1800, "6": 2300, "7": 2900, "8": 3900, "9": 5000, "10": 5900, "11": 7200,
  "12": 8400, "13": 10000, "14": 11500, "15": 13000, "16": 15000, "17": 18000,
  "18": 20000, "19": 22000, "20": 25000, "21": 33000, "22": 41000, "23": 50000,
  "24": 62000, "25": 75000, "26": 90000, "27": 105000, "28": 120000, "29": 135000, "30": 155000,
};
function normalizeCr(cr) {
  if (cr === undefined || cr === null || cr === "") return undefined;
  const s = String(cr).trim();
  if (CR_XP[s] !== undefined) return s;
  const n = Number(s);
  if (n === 0.125) return "1/8";
  if (n === 0.25) return "1/4";
  if (n === 0.5) return "1/2";
  if (Number.isFinite(n) && CR_XP[String(n)] !== undefined) return String(n);
  return undefined;
}
const xpForCr = (cr) => {
  const k = normalizeCr(cr);
  return k === undefined ? undefined : CR_XP[k];
};

/** Turn a parsed statblock / bestiary / frontmatter object into the stats
 *  the tracker needs. */
function statsFromCreature(obj) {
  if (!obj || typeof obj !== "object") return {};
  const out = {};
  out.hp = toInt(obj.hp);
  out.ac = toInt(obj.ac);
  if (obj.ac !== undefined && String(obj.ac).trim() !== String(out.ac)) out.acText = String(obj.ac);
  if (typeof obj.hit_dice === "string") out.hitDice = obj.hit_dice;
  else if (typeof obj.hp === "string") {
    const hd = /\(([^)]*d[^)]*)\)/.exec(obj.hp);
    if (hd) out.hitDice = hd[1];
  }
  let stats = obj.stats;
  if (typeof stats === "string") stats = (stats.match(/-?\d+/g) || []).map(Number);
  if (Array.isArray(stats) && stats.length > 1) out.dex = toInt(stats[1]);
  const explicit = toInt(obj.modifier) ?? toInt(obj.initiative);
  out.mod = explicit ?? (out.dex !== undefined ? abilityMod(out.dex) : undefined);
  out.cr = normalizeCr(obj.cr) ?? normalizeCr(obj.CR);
  out.xp = toInt(obj.xp) ?? xpForCr(out.cr);
  if (typeof obj.image === "string") out.image = obj.image;
  if (typeof obj.name === "string") out.name = obj.name;
  return out;
}

// 2024 DMG XP budget per character: [Low, Moderate, High]
const XP_BUDGET = [
  null, [50, 75, 100], [100, 150, 200], [150, 225, 400], [250, 375, 500], [500, 750, 1100],
  [600, 1000, 1400], [750, 1300, 1700], [1000, 1700, 2100], [1300, 2000, 2600], [1600, 2300, 3100],
  [1900, 2900, 4100], [2200, 3700, 4700], [2600, 4200, 5400], [2900, 4900, 6200], [3300, 5400, 7800],
  [3800, 6100, 9800], [4500, 7200, 11700], [5000, 8700, 14200], [5500, 10700, 17200], [6400, 13200, 22000],
];
function difficulty(partyLevels, monsterXp) {
  const levels = partyLevels.filter((l) => l >= 1).map((l) => Math.min(20, l));
  const total = monsterXp.reduce((a, b) => a + (b || 0), 0);
  if (!levels.length) return { xp: total, label: null };
  const budget = [0, 0, 0];
  for (const l of levels) for (let i = 0; i < 3; i++) budget[i] += XP_BUDGET[l][i];
  let label = "Trivial";
  if (total >= budget[0]) label = "Low";
  if (total >= budget[1]) label = "Moderate";
  if (total >= budget[2]) label = "High";
  if (total > budget[2] * 1.5) label = "Beyond High";
  return { xp: total, label, budget };
}

// ---- Character-sheet rules (mirrors the One DnD Character Sheet's own
// HpTracker so a hit from the tracker behaves exactly like one from the
// sheet). They mutate a frontmatter object and report what changed. ----

function sheetApplyDamage(fm, amount) {
  const amt = Math.abs(Number(amount) || 0);
  const tempHp = Number(fm.temp_hp || 0);
  const overflow = Math.max(0, amt - tempHp);
  const before = Number(fm.hp_current || 0);
  fm.hp_current = Math.max(0, before - overflow);
  fm.temp_hp = Math.max(0, tempHp - amt);
  const classes = new Set(fm.cssclasses || ["dnd-sheet"]);
  let becameDying = false;
  if (fm.hp_current <= 0) {
    classes.add("dying");
    becameDying = true;
  }
  fm.cssclasses = Array.from(classes);
  // Damage while already at 0 HP = a failed death save (two on a crit -
  // the GM can tick the second one by hand).
  let deathFail = false;
  if (before <= 0 && amt > 0 && !classes.has("dead")) {
    for (let i = 1; i <= 3; i++) {
      if (!fm[`death_save_fail_${i}`]) { fm[`death_save_fail_${i}`] = true; deathFail = true; break; }
    }
    if ([1, 2, 3].every((i) => fm[`death_save_fail_${i}`])) {
      classes.add("dead");
      classes.delete("dying");
      fm.cssclasses = Array.from(classes);
    }
  }
  return { becameDying, deathFail, hpLost: before - fm.hp_current };
}

function sheetApplyHeal(fm, amount) {
  const amt = Math.abs(Number(amount) || 0);
  fm.hp_current = Math.min(Number(fm.hp_max || 0), Number(fm.hp_current || 0) + amt);
  let recovered = false;
  if (fm.hp_current > 0) {
    recovered = true;
    const classes = new Set(fm.cssclasses || ["dnd-sheet"]);
    classes.delete("dying");
    classes.delete("dead");
    fm.cssclasses = Array.from(classes);
    for (let i = 1; i <= 3; i++) {
      fm[`death_save_success_${i}`] = false;
      fm[`death_save_fail_${i}`] = false;
    }
  }
  return { recovered };
}

/** kind = "success" | "fail", i = 1..3 */
function sheetDeathSave(fm, kind, i, checked, exhausted = false) {
  fm[`death_save_${kind}_${i}`] = checked;
  let stabilized = false;
  const classes = new Set(fm.cssclasses || ["dnd-sheet"]);
  if (kind === "fail") {
    const fails = [1, 2, 3].filter((n) => fm[`death_save_fail_${n}`]).length;
    if ((fails >= 3 || exhausted) && !classes.has("dead")) {
      classes.add("dead");
      classes.delete("dying");
      fm.cssclasses = Array.from(classes);
    }
  } else {
    const succ = [1, 2, 3].filter((n) => fm[`death_save_success_${n}`]).length;
    if (succ >= 3) {
      stabilized = true;
      fm.hp_current = 1;
      classes.delete("dying");
      classes.delete("dead");
      fm.cssclasses = Array.from(classes);
      for (let n = 1; n <= 3; n++) {
        fm[`death_save_success_${n}`] = false;
        fm[`death_save_fail_${n}`] = false;
      }
    }
  }
  return { stabilized };
}

function swapCondition(fm, from, to) {
  fm.conditions_active = fm.conditions_active || [];
  const idx = fm.conditions_active.indexOf(from);
  if (idx === -1) return;
  if (fm.conditions_active.includes(to)) fm.conditions_active.splice(idx, 1);
  else fm.conditions_active[idx] = to;
}
function addConditionIfMissing(fm, name) {
  fm.conditions_active = fm.conditions_active || [];
  if (!fm.conditions_active.includes(name)) fm.conditions_active.push(name);
}

function damageMonster(c, amount) {
  if (c.hp === undefined) return 0;
  const amt = Math.abs(amount);
  const temp = c.temp || 0;
  const overflow = Math.max(0, amt - temp);
  c.temp = Math.max(0, temp - amt);
  const before = c.hp;
  c.hp = Math.max(0, c.hp - overflow);
  return before - c.hp;
}
// ---- groups (minions / mobs): N identical creatures in one row, one HP pool ----
const GROUP_WORDS = ["group", "mob", "minions", "horde"];
const GROUP_FLAG = /^(group|mob|minions|horde)(?:\s+(?:of\s+)?(\d+))?$/;
const SINGLE_WORDS = ["single", "individual", "individuals", "one by one"];

/** Add one typed add-box line ("3x [[Goblin]]", "[[Dexar]] player",
 *  "20 [[Orc]] group") to a roll-encounter spec. Returns "player",
 *  "creature" or null. */
function specAddText(spec, text) {
  const parsed = parseCombatantLine(text);
  if (!parsed.length) return null;
  const first = parsed[0];
  if (first.player) {
    spec.playersMode = "list";
    const p = first.link ? { name: first.name, link: first.link, isLink: true } : { name: first.name, isLink: false };
    if (!spec.players.some((x) => (x.link || x.name) === (p.link || p.name))) spec.players.push(p);
    return "player";
  }
  const name = first.name.replace(/\s+\d+$/, "");
  const entry = first.link ? { name: linkBasename(first.link), link: first.link, isLink: true } : { name, isLink: false };
  entry.count = first.group || parsed.length;
  if (first.group) entry.group = true;
  for (const k of ["hp", "ac", "mod", "xp"]) if (first[k] !== undefined) entry[k] = first[k];
  if (first.group && first.each !== undefined && entry.hp === undefined) entry.hp = first.each;
  if (first.hidden) entry.hidden = true;
  if (first.disp) entry.disp = first.disp;
  const same = spec.creatures.find((x) => (x.link || x.name) === (entry.link || entry.name) && !x.hp && !entry.hp);
  if (same) {
    same.count = Math.min(999, (same.count || 1) + entry.count);
    if (entry.group && same.group === undefined) same.group = true;
  } else spec.creatures.push(entry);
  return "creature";
}

/** Split `n` creatures into groups of `size` (the last one takes the rest). */
function groupChunks(n, size) {
  if (!size || size >= n) return [n];
  const out = [];
  for (let left = n; left > 0; left -= size) out.push(Math.min(size, left));
  return out;
}

/** How many members are still standing: the pool divided by HP each, rounded up. */
function groupAlive(hp, each, size) {
  if (hp === undefined || !each) return size;
  if (hp <= 0) return 0;
  return Math.min(size, Math.ceil(hp / each));
}

/** Area damage: `amount` to each of `targets` standing members (all of them
 *  if targets is empty). One member can't lose more than its own HP. */
function groupAreaHp(hp, each, size, amount, targets) {
  const alive = groupAlive(hp, each, size);
  const n = Math.min(alive, targets === undefined || targets === null || !Number.isFinite(targets) ? alive : Math.max(0, targets));
  return Math.max(0, hp - n * Math.min(Math.max(0, amount), each));
}

function healMonster(c, amount) {
  if (c.hp === undefined) return;
  c.hp = Math.min(c.maxHp ?? Infinity, c.hp + Math.abs(amount));
}

const concentrationDc = (damage) => Math.min(30, Math.max(10, Math.floor(damage / 2)));

// ---------------------------------------------------------------------------
// Vault access: finding / writing blocks, resolving creatures and sheets
// ---------------------------------------------------------------------------

/** Locate a roll-initiative block in the file's lines, by id or by line range. */
function findBlock(lines, locator) {
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const m = new RegExp("^((?:\\s*>)*\\s*)(`{3,}|~{3,})\\s*" + BLOCK + "\\b").exec(lines[i]);
    if (!m) continue;
    let end = -1;
    for (let j = i + 1; j < lines.length; j++) {
      const stripped = lines[j].slice(m[1].length).trim();
      if (stripped.startsWith(m[2]) && stripped.replace(/[`~]/g, "") === "") { end = j; break; }
    }
    if (end < 0) continue;
    const body = lines.slice(i + 1, end).map((l) => l.slice(m[1].length));
    blocks.push({ start: i, end, prefix: m[1], body });
    i = end;
  }
  if (locator.id) {
    const hit = blocks.find((b) => b.body.some((l) => l.trim() === `id ${locator.id}`));
    if (hit) return hit;
  }
  if (locator.lineStart !== undefined) {
    const hit = blocks.find((b) => b.start === locator.lineStart);
    if (hit) return hit;
  }
  if (locator.first) return blocks[0] || null;
  return null;
}

/** Set CSS custom properties without inline style assignment. */
function setCssVars(el, vars) {
  if (!el) return;
  if (typeof el.setCssProps === "function") el.setCssProps(vars);
  else if (el.style && typeof el.style.setProperty === "function") for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
}

/** Encounter card lists: make each column (stepper, HP, AC, CR, class) as
 *  wide as its widest cell, so values line up row to row. */
function alignCardColumns(list) {
  if (!list || typeof list.querySelectorAll !== "function") return;
  const kinds = { stepper: ".ri-enc-stepper", hp: ".ri-enc-stat.is-hp", ac: ".ri-enc-stat.is-ac", cr: ".ri-enc-stat.is-cr", who: ".ri-enc-stat.is-who" };
  const measure = () => {
    const reset = {};
    for (const k of Object.keys(kinds)) reset[`--ri-w-${k}`] = "auto";
    setCssVars(list, reset);
    const out = {};
    for (const [k, sel] of Object.entries(kinds)) {
      let w = 0;
      for (const cell of Array.from(list.querySelectorAll(sel))) w = Math.max(w, Math.ceil(cell.getBoundingClientRect().width));
      if (w > 0) out[`--ri-w-${k}`] = `${w}px`;
    }
    setCssVars(list, out);
  };
  const win = list.win || (typeof window !== "undefined" ? window : null);
  if (win && typeof win.requestAnimationFrame === "function") win.requestAnimationFrame(measure);
  else measure();
}

// ---------------------------------------------------------------------------
// Game systems
// ---------------------------------------------------------------------------

const CPRED_CONDITIONS = [
  "Seriously Wounded", "Mortally Wounded", "Unconscious", "Prone", "Grappled",
  "On Fire", "Critical Injury", "Poisoned", "Drugged", "Obscured", "Dead",
];
const CPRED_CRIT_BONUS = 5;
const CPRED_STATS = ["int", "ref", "dex", "tech", "cool", "will", "luck", "move", "body", "emp"];

const SYSTEMS = {
  dnd5e: {
    id: "dnd5e",
    name: "D&D 5e (2024)",
    initDie: 20,
    conditions: DEFAULT_CONDITIONS,
    quick: QUICK_CONDITIONS,
    difficulty: true,
    concentration: true,
    rollHp: true,
    atlasPrefix: "dnd5e-",
  },
  cpred: {
    id: "cpred",
    name: "Cyberpunk RED",
    initDie: 10,
    conditions: CPRED_CONDITIONS,
    quick: ["Prone", "Grappled", "On Fire", "Unconscious", "Critical Injury"],
    difficulty: false,
    concentration: false,
    rollHp: false,
    atlasPrefix: "cyberpunkred-",
  },
};

// ---- Cyberpunk RED rules (pure, unit tested) ----

/** One hit against armor. loc = "body" | "head" | "direct".
 *  Damage that beats SP goes through and ablates that SP by 1; head hits
 *  double what got through; direct damage ignores armor. */
function cpredHit({ hp, sp }, raw, loc) {
  const amount = Math.max(0, Math.round(Number(raw) || 0));
  const armor = { head: (sp && sp.head) || 0, body: (sp && sp.body) || 0 };
  let through = amount;
  let ablated = false;
  let spBefore = null;
  if (loc === "head" || loc === "body") {
    spBefore = armor[loc];
    if (amount > spBefore) {
      through = amount - spBefore;
      if (spBefore > 0) { armor[loc] = spBefore - 1; ablated = true; }
    } else through = 0;
    if (loc === "head") through *= 2;
  }
  return { hp: Math.max(0, (Number(hp) || 0) - through), sp: armor, through, ablated, spBefore };
}

/** Seriously Wounded below half HP, Mortally Wounded below 1 HP. */
function cpredWoundConditions(hp, maxHp, names) {
  const set = new Set((names || []).filter((n) => n !== "Seriously Wounded" && n !== "Mortally Wounded"));
  if (hp <= 0) set.add("Mortally Wounded");
  else if (maxHp && hp < Math.ceil(maxHp / 2)) set.add("Seriously Wounded");
  return [...set];
}

/** Death Save: 1d10 + penalty must come in under BODY; a natural 10 always
 *  fails. Each success makes the next one harder (+1 penalty). */
function cpredDeathSave(body, penalty, roll) {
  const total = roll + (penalty || 0);
  const success = roll !== 10 && total < (Number(body) || 0);
  return { success, total, roll, penalty: success ? (penalty || 0) + 1 : penalty || 0 };
}

/** Stats from a Cyberpunk note's properties or ```statblock``` YAML. */
function statsFromCyberpunk(obj) {
  if (!obj || typeof obj !== "object") return {};
  const out = {};
  const statOf = (k) => {
    const v = toInt(obj[k] ?? obj[k.toUpperCase()]);
    if (v !== undefined) return v;
    // statblock layout: stats: [INT, REF, DEX, TECH, COOL, WILL, LUCK, MOVE, BODY, EMP]
    if (Array.isArray(obj.stats) && obj.stats.length >= 9) return toInt(obj.stats[CPRED_STATS.indexOf(k)]);
    return undefined;
  };
  out.ref = statOf("ref");
  out.dex = statOf("dex");
  out.body = statOf("body");
  const will = statOf("will");
  out.hp = toInt(obj.hp_max ?? obj.hp ?? obj.HP);
  if (out.hp === undefined && out.body !== undefined && will !== undefined) out.hp = 10 + 5 * Math.ceil((out.body + will) / 2);
  const spAll = toInt(obj.sp ?? obj.SP);
  const head = toInt(obj.sp_head ?? obj.head_sp) ?? spAll;
  const body = toInt(obj.sp_body ?? obj.body_sp) ?? spAll;
  if (head !== undefined || body !== undefined) out.sp = { head: head ?? 0, body: body ?? 0 };
  out.mod = cpredInitMod(obj, out.ref);
  if (typeof obj.image === "string" && obj.image) out.image = obj.image;
  else if (typeof obj.portrait === "string" && obj.portrait) out.image = obj.portrait;
  if (obj.threat) out.threat = String(obj.threat);
  if (obj.role) out.role = String(obj.role);
  return out;
}

/** Initiative modifier: `initiative: "1d10 + 6"` (statblocks), a plain
 *  number, or REF + any bonus (`init_bonus`, or "+4 to every Initiative"
 *  in a role ability such as Combat Awareness). */
function cpredInitMod(obj, ref) {
  const ini = obj.initiative ?? obj.init;
  if (typeof ini === "number" && Number.isFinite(ini)) return Math.round(ini);
  if (typeof ini === "string" && ini.trim()) {
    const t = ini.replace(/\s+/g, "");
    const m = /^(?:\d*d\d+)?([+-]\d+)?$/i.exec(t);
    if (m && m[1]) return parseInt(m[1], 10);
  }
  if (ref === undefined) return undefined;
  return ref + cpredInitBonus(obj);
}
function cpredInitBonus(obj) {
  const b = toInt(obj.init_bonus ?? obj.initiative_bonus);
  if (b !== undefined) return b;
  let best = 0;
  for (const key of ["role_ability", "abilities"]) {
    const list = Array.isArray(obj[key]) ? obj[key] : obj[key] ? [obj[key]] : [];
    for (const a of list) {
      const text = typeof a === "string" ? a : a && typeof a === "object" ? `${a.name || ""} ${a.desc || ""}` : "";
      const m = /\+\s*(\d+)\s+(?:to\s+(?:every\s+|all\s+|your\s+)?)?initiative/i.exec(text);
      if (m) best = Math.max(best, parseInt(m[1], 10));
    }
  }
  return best;
}

/** Cyberpunk RED player notes: properties are the "sheet". */
class CyberBridge {
  constructor(plugin) {
    this.plugin = plugin;
    this.app = plugin.app;
  }
  get sheetPlugin() { return null; }
  get dataFolder() { return ""; }
  playersFolder() { return folderPath(this.plugin.settings.playersFolder); }
  isSheet(fm, file) {
    if (!fm) return false;
    const type = String(fm.type || "").toLowerCase();
    const folder = this.playersFolder();
    const inFolder = !!(file && folder && file.path.startsWith(folder + "/"));
    if (!(type === "player" || fm.player === true || inFolder)) return false;
    if (type && type !== "player" && fm.player !== true) return false; // a monster/npc note dropped in the folder
    return fm.hp !== undefined || fm.hp_max !== undefined || fm.body !== undefined || fm.ref !== undefined;
  }
  fm(file) {
    return ((this.app.metadataCache.getFileCache(file) || {}).frontmatter) || {};
  }
  read(file) {
    const fm = this.fm(file);
    const st = statsFromCyberpunk(fm);
    const maxHp = st.hp ?? 0;
    const hp = toInt(fm.hp_current) ?? maxHp;
    const conds = Array.isArray(fm.conditions) ? fm.conditions.map(String) : [];
    return {
      kind: "sheet",
      system: "cpred",
      file,
      path: file.path,
      watch: [file.path],
      name: fm.name || fm.handle || file.basename,
      hp, maxHp, temp: 0,
      sp: st.sp || { head: 0, body: 0 },
      mod: st.mod, dex: st.dex, body: st.body,
      level: toInt(fm.rank), cls: fm.role ? String(fm.role) : undefined,
      image: st.image,
      conditions: conds.map((n) => ({ name: n })),
      dead: conds.includes("Dead"),
      dying: hp <= 0,
      deathPenalty: toInt(fm.death_save_penalty) || 0,
      deathSaves: { success: [], fail: [] },
    };
  }
  maxOf(fm) { return statsFromCyberpunk(fm).hp ?? 0; }
  async write(file, mutate) {
    let snap = null;
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm.conditions = Array.isArray(fm.conditions) ? fm.conditions : [];
      mutate(fm);
      const max = this.maxOf(fm);
      fm.conditions = cpredWoundConditions(toInt(fm.hp_current) ?? max, max, fm.conditions);
      try { snap = JSON.parse(JSON.stringify(fm)); } catch (e) { snap = null; }
    });
    this.app.workspace.trigger("roll-initiative:sheet-written", file.path);
    // Cyberpunk RED Character Sheet redraws its blocks on this event
    if (snap) this.app.workspace.trigger("cpr-sheet:refresh", file.path, snap);
  }
  async applyHit(file, result, extraPenalty = 0) {
    await this.write(file, (fm) => {
      fm.hp_current = result.hp;
      fm.sp_head = result.sp.head;
      fm.sp_body = result.sp.body;
      if (extraPenalty) fm.death_save_penalty = (toInt(fm.death_save_penalty) || 0) + extraPenalty;
    });
  }
  /** A Critical Injury: add it, 5 bonus damage straight to HP, and raise the
   *  Death Save penalty to the injury's base penalty if it has one. */
  async criticalInjury(file, name, base) {
    await this.write(file, (fm) => {
      if (!fm.conditions.includes(name)) fm.conditions.push(name);
      const max = this.maxOf(fm);
      fm.hp_current = Math.max(0, (toInt(fm.hp_current) ?? max) - CPRED_CRIT_BONUS);
      if (base) fm.death_save_penalty = Math.max(toInt(fm.death_save_penalty) || 0, base);
    });
  }
  async damage(file, amount) {
    const r = this.read(file);
    await this.applyHit(file, cpredHit(r, amount, "direct"));
    return {};
  }
  async heal(file, amount) {
    await this.write(file, (fm) => {
      const max = this.maxOf(fm);
      const cur = toInt(fm.hp_current) ?? max;
      fm.hp_current = Math.min(max, cur + Math.abs(Number(amount) || 0));
      if (fm.hp_current > 0) fm.death_save_penalty = 0;
    });
    return {};
  }
  async setHp(file, value, max) {
    await this.write(file, (fm) => {
      if (max !== undefined && Number.isFinite(max)) { if (fm.hp_max !== undefined) fm.hp_max = max; else fm.hp = max; }
      fm.hp_current = Math.max(0, Math.round(value));
      if (fm.hp_current > 0) fm.death_save_penalty = 0;
    });
  }
  async setTemp() { /* no temp HP in RED */ }
  async deathSaveRoll(file, roll) {
    const r = this.read(file);
    const res = cpredDeathSave(r.body, r.deathPenalty, roll);
    await this.write(file, (fm) => {
      fm.death_save_penalty = res.penalty;
      if (!res.success && !fm.conditions.includes("Dead")) fm.conditions.push("Dead");
    });
    return res;
  }
  async deathSave() { /* D&D-style pips aren't used in RED */ }
  async addCondition(file, name) {
    await this.write(file, (fm) => { if (!fm.conditions.includes(name)) fm.conditions.push(name); });
  }
  async removeCondition(file, name) {
    await this.write(file, (fm) => { fm.conditions = fm.conditions.filter((n) => n !== name); });
  }
  /** The crew: every player note (players folder or type: player). */
  partyGroups() {
    const members = [];
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (this.isSheet(this.fm(f), f)) members.push(f.basename);
    }
    return members.length ? [{ name: "Crew", members: members.sort() }] : [];
  }
  monsterFolder() { return this.plugin.settings.monsterFolder || ""; }
}

class SheetBridge {
  constructor(plugin) {
    this.plugin = plugin;
    this.app = plugin.app;
  }
  get sheetPlugin() {
    return (this.app.plugins && this.app.plugins.plugins && this.app.plugins.plugins[SHEET_ID]) || null;
  }
  get dataFolder() {
    const s = this.sheetPlugin && this.sheetPlugin.settings;
    return (s && s.dataFolder) || DEFAULT_DATA_FOLDER;
  }
  isSheet(fm) {
    if (!fm) return false;
    return !!(fm.data_id || (fm.hp_max !== undefined && fm.armor_class !== undefined && fm.character_name !== undefined));
  }
  companionPath(fm, file, kind) {
    const id = fm.data_id || file.basename;
    return `${this.dataFolder}/${id}/${kind}.md`;
  }
  companionFm(path) {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) return {};
    const cache = this.app.metadataCache.getFileCache(f);
    return (cache && cache.frontmatter) || {};
  }
  read(file) {
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = (cache && cache.frontmatter) || {};
    const abPath = this.companionPath(fm, file, "Abilities");
    const condPath = this.companionPath(fm, file, "Conditions");
    const ab = this.companionFm(abPath);
    const cond = this.companionFm(condPath);
    const classes = fm.cssclasses || [];
    const initMod = toInt(ab.initiative);
    const dex = toInt(ab.dex_score);
    return {
      kind: "sheet",
      file,
      path: file.path,
      watch: [file.path, abPath, condPath],
      name: fm.character_name || file.basename,
      hp: Number(fm.hp_current ?? 0),
      maxHp: Number(fm.hp_max ?? 0),
      temp: Number(fm.temp_hp ?? 0),
      ac: toInt(fm.armor_class),
      mod: initMod ?? (dex !== undefined ? abilityMod(dex) : toInt(fm.modifier)),
      dex,
      level: toInt(fm.level),
      cls: typeof fm.class === "string" ? fm.class.trim() : undefined,
      image: typeof fm.cover === "string" ? fm.cover : undefined,
      conditions: (Array.isArray(cond.conditions_active) ? cond.conditions_active : []).map((n) => ({ name: String(n) })),
      exhaustion: Number(cond.exhaustion_level || 0),
      dying: classes.includes("dying"),
      dead: classes.includes("dead"),
      deathSaves: {
        success: [1, 2, 3].map((i) => !!fm[`death_save_success_${i}`]),
        fail: [1, 2, 3].map((i) => !!fm[`death_save_fail_${i}`]),
      },
    };
  }
  notifyMain(file, fm) {
    this.app.workspace.trigger("dnd-sheet:main-file-changed", file.path, fm);
  }
  notifyConditions(file, condFm) {
    this.app.workspace.trigger("dnd-sheet:conditions-changed", file.path, condFm);
  }
  async conditionsFile(file) {
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = (cache && cache.frontmatter) || {};
    const path = this.companionPath(fm, file, "Conditions");
    let f = this.app.vault.getAbstractFileByPath(path);
    if (f instanceof TFile) return f;
    const folder = path.slice(0, path.lastIndexOf("/"));
    if (!this.app.vault.getAbstractFileByPath(folder)) {
      try { await this.app.vault.createFolder(folder); } catch (e) { /* exists */ }
    }
    try {
      f = await this.app.vault.create(path, "---\ncssclasses:\n  - dnd-sheet\nconditions_active: []\nexhaustion_level: 0\n---\n");
    } catch (e) {
      f = this.app.vault.getAbstractFileByPath(path);
    }
    return f instanceof TFile ? f : null;
  }
  async editConditions(file, mutate) {
    const cf = await this.conditionsFile(file);
    if (!cf) return;
    let out;
    await this.app.fileManager.processFrontMatter(cf, (fm) => {
      fm.conditions_active = fm.conditions_active || [];
      mutate(fm);
      out = fm;
    });
    this.notifyConditions(file, out);
  }
  async damage(file, amount) {
    let res;
    let out;
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      res = sheetApplyDamage(fm, amount);
      fm.dmg_amount = 0;
      out = fm;
    });
    this.notifyMain(file, out);
    if (res.becameDying) {
      await this.editConditions(file, (fm) => {
        swapCondition(fm, "Prone", "Unconscious");
        addConditionIfMissing(fm, "Unconscious");
      });
    }
    return res;
  }
  async heal(file, amount) {
    let res;
    let out;
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      res = sheetApplyHeal(fm, amount);
      fm.dmg_amount = 0;
      out = fm;
    });
    this.notifyMain(file, out);
    if (res.recovered) await this.editConditions(file, (fm) => swapCondition(fm, "Unconscious", "Prone"));
    return res;
  }
  /** Set current HP to an exact value (from the Atlas map), applying the
   *  sheet's dying / recovery rules like Damage and Heal do. */
  async setHp(file, value, max) {
    let before = 0;
    let out;
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      before = Number(fm.hp_current || 0);
      if (max !== undefined && Number.isFinite(max)) fm.hp_max = max;
      const v = Math.max(0, Math.min(Number(fm.hp_max || value), Math.round(value)));
      fm.hp_current = v;
      const classes = new Set(fm.cssclasses || ["dnd-sheet"]);
      if (v <= 0) classes.add("dying");
      else {
        classes.delete("dying");
        classes.delete("dead");
        if (before <= 0) for (let i = 1; i <= 3; i++) { fm[`death_save_success_${i}`] = false; fm[`death_save_fail_${i}`] = false; }
      }
      fm.cssclasses = Array.from(classes);
      out = fm;
    });
    this.notifyMain(file, out);
    if (before > 0 && value <= 0) {
      await this.editConditions(file, (fm) => { swapCondition(fm, "Prone", "Unconscious"); addConditionIfMissing(fm, "Unconscious"); });
    } else if (before <= 0 && value > 0) {
      await this.editConditions(file, (fm) => swapCondition(fm, "Unconscious", "Prone"));
    }
  }

  async setTemp(file, value) {
    let out;
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm.temp_hp = Math.max(0, Math.abs(Number(value) || 0));
      fm.temp_hp_input = 0;
      out = fm;
    });
    this.notifyMain(file, out);
  }
  async deathSave(file, kind, i, checked) {
    const cache = this.app.metadataCache.getFileCache(file);
    const mfm = (cache && cache.frontmatter) || {};
    const exhausted = Number(this.companionFm(this.companionPath(mfm, file, "Conditions")).exhaustion_level || 0) >= 6;
    let res;
    let out;
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      res = sheetDeathSave(fm, kind, i, checked, exhausted);
      out = fm;
    });
    this.notifyMain(file, out);
    if (res.stabilized) await this.editConditions(file, (fm) => swapCondition(fm, "Unconscious", "Prone"));
  }
  async addCondition(file, name) {
    await this.editConditions(file, (fm) => addConditionIfMissing(fm, name));
  }
  async removeCondition(file, name) {
    await this.editConditions(file, (fm) => {
      fm.conditions_active = fm.conditions_active.filter((n) => n !== name);
    });
  }
  /** Party groups from the sheet's settings (members are [[links]]). */
  partyGroups() {
    const s = this.sheetPlugin && this.sheetPlugin.settings;
    const groups = (s && Array.isArray(s.partyGroups) && s.partyGroups) || [];
    return groups.map((g) => ({
      name: g.name || "Party",
      members: (g.members || []).map((m) => {
        const mm = /^\[\[(.+?)(?:\|.*)?\]\]$/.exec(String(m || "").trim());
        return mm ? mm[1] : String(m || "").trim();
      }).filter(Boolean),
    }));
  }
  monsterFolder() {
    const s = this.sheetPlugin && this.sheetPlugin.settings;
    return (s && s.monsterLibraryFolder) || "";
  }
}

class CreatureResolver {
  constructor(plugin) {
    this.plugin = plugin;
    this.app = plugin.app;
    this.cache = new Map(); // path -> { mtime, stats }
  }
  bestiary(name) {
    try {
      const api = window.FantasyStatblocks;
      if (api && typeof api.getCreatureFromBestiary === "function") {
        const c = api.getCreatureFromBestiary(name);
        if (c) return c;
      }
      const p = this.app.plugins.plugins[STATBLOCKS_ID];
      if (p && p.api && typeof p.api.getCreatureFromBestiary === "function") return p.api.getCreatureFromBestiary(name) || null;
      if (p && p.bestiary && typeof p.bestiary.get === "function") return p.bestiary.get(name) || null;
    } catch (e) {
      /* plugin missing or API changed */
    }
    return null;
  }
  async fromFile(file) {
    const hit = this.cache.get(file.path);
    if (hit && hit.mtime === file.stat.mtime) return hit.stats;
    let stats = {};
    try {
      const text = await this.app.vault.cachedRead(file);
      const body = extractStatblock(text);
      const statsOf = this.plugin.sys.id === "cpred" ? statsFromCyberpunk : statsFromCreature;
      if (body !== null) {
        let obj;
        try { obj = parseYaml(body); } catch (e) { obj = null; }
        if (!obj || typeof obj !== "object") obj = looseYaml(body);
        stats = statsOf(obj);
        const ref = obj.monster || obj.creature;
        if (typeof ref === "string" && (stats.hp === undefined || stats.ac === undefined)) {
          const base = statsFromCreature(this.bestiary(ref));
          stats = { ...base, ...Object.fromEntries(Object.entries(stats).filter(([, v]) => v !== undefined)) };
        }
      }
      if ((stats.hp === undefined && stats.ac === undefined) || this.plugin.sys.id === "cpred") {
        // Cyberpunk statblocks often skip REF/BODY (they live in `stats` or the properties): fill the gaps
        const fm = (this.app.metadataCache.getFileCache(file) || {}).frontmatter;
        const fromFm = statsOf(fm);
        stats = { ...fromFm, ...Object.fromEntries(Object.entries(stats).filter(([, v]) => v !== undefined)) };
      }
    } catch (e) {
      console.error("Roll Initiative: couldn't read creature", file.path, e);
    }
    stats.kind = "creature";
    stats.file = file;
    stats.path = file.path;
    stats.watch = [file.path];
    this.cache.set(file.path, { mtime: file.stat.mtime, stats });
    return stats;
  }
  fromBestiary(name) {
    const c = this.bestiary(name) || this.bestiary(name.replace(/\s+\d+$/, ""));
    if (!c) return null;
    return { ...statsFromCreature(c), kind: "bestiary", watch: [] };
  }
}

/** NPC notes (type: npc or tagged NPC) start out neutral instead of hostile. */
function isNpcNote(app, file) {
  const cache = app.metadataCache.getFileCache(file) || {};
  const fm = cache.frontmatter || {};
  if (String(fm.type || "").toLowerCase() === "npc") return true;
  const tags = [].concat(fm.tags || [], fm.tag || []).map((t) => String(t).replace(/^#/, "").toLowerCase());
  if (tags.includes("npc")) return true;
  const inline = (cache.tags || []).map((t) => t.tag.replace(/^#/, "").toLowerCase());
  return inline.includes("npc");
}

// ---------------------------------------------------------------------------
// Session: one encounter (block) + its resolved creatures
// ---------------------------------------------------------------------------

class Session {
  constructor(plugin, sourcePath, locator) {
    this.plugin = plugin;
    this.app = plugin.app;
    this.sourcePath = sourcePath;
    this.locator = locator; // { id?, getSection? }
    this.enc = { name: "", id: "", round: 0, combatants: [], partyRequests: [] };
    this.res = new Map(); // combatant -> resolved stats
    this.saved = true;
    this.listeners = new Set();
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit() {
    for (const fn of this.listeners) fn();
  }

  async loadSource(source) {
    this.enc = parseBlock(source);
    if (this.enc.id) this.locator.id = this.enc.id;
    this.expandParties();
    await this.resolveAll();
  }

  async loadFromFile() {
    const file = this.app.vault.getAbstractFileByPath(this.sourcePath);
    if (!(file instanceof TFile)) return false;
    const text = await this.app.vault.read(file);
    const block = findBlock(text.split("\n"), this.locator);
    if (!block) return false;
    await this.loadSource(block.body.join("\n"));
    return true;
  }

  expandParties() {
    const reqs = this.enc.partyRequests || [];
    if (!reqs.length) return;
    let offset = 0;
    for (const req of reqs) {
      const members = this.plugin.partyMembers(req.group, this.sourcePath);
      const have = new Set(this.enc.combatants.map((c) => c.link || c.name));
      const add = [];
      for (const m of members) {
        const key = m.link || m.name;
        if (have.has(key)) continue;
        have.add(key);
        add.push(m);
      }
      this.enc.combatants.splice(req.index + offset, 0, ...add);
      offset += add.length;
    }
    this.enc.partyRequests = [];
    this.dirty = true; // party line should be replaced by real lines on next save
  }

  async resolveOne(c) {
    let r = null;
    if (c.link) {
      const file = this.app.metadataCache.getFirstLinkpathDest(c.link.split("#")[0], this.sourcePath);
      if (file instanceof TFile) {
        const fm = (this.app.metadataCache.getFileCache(file) || {}).frontmatter;
        if (this.plugin.settings.syncPlayers && this.plugin.bridge.isSheet(fm, file)) {
          r = this.plugin.bridge.read(file);
          c.player = true;
        } else {
          r = { ...(await this.plugin.resolver.fromFile(file)), npc: this.plugin.isNpc(file) };
        }
      }
    } else if (!c.player) {
      r = this.plugin.resolver.fromBestiary(c.name);
    }
    r = r || { kind: "plain", watch: [] };
    this.res.set(c, r);
    if (r.kind !== "sheet") this.fill(c, r);
    return r;
  }

  /** Copy note stats into the block's own values (first time only). */
  fill(c, r) {
    if (c.group) {
      if (c.each === undefined && r.hp !== undefined) { c.each = r.hp; this.dirty = true; }
      if (c.hp === undefined && c.each !== undefined) { c.maxHp = c.each * c.group; c.hp = c.maxHp; this.dirty = true; }
    } else if (c.hp === undefined) {
      const rolled = this.plugin.settings.rollHp && r.hitDice ? rollDice(r.hitDice) : undefined;
      const hp = rolled ?? r.hp;
      if (hp !== undefined) { c.hp = hp; c.maxHp = hp; this.dirty = true; }
    }
    if (c.ac === undefined && r.ac !== undefined) { c.ac = r.ac; this.dirty = true; }
    if (c.mod === undefined && r.mod !== undefined) { c.mod = r.mod; this.dirty = true; }
    if (c.sp === undefined && r.sp) { c.sp = { ...r.sp }; this.dirty = true; }
    if (c.body === undefined && r.body !== undefined && this.plugin.sys.id === "cpred") { c.body = r.body; this.dirty = true; }
  }

  async resolveAll() {
    this.res = new Map();
    await Promise.all(this.enc.combatants.map((c) => this.resolveOne(c)));
  }

  refreshSheets() {
    for (const c of this.enc.combatants) {
      const r = this.res.get(c);
      if (r && r.kind === "sheet") this.res.set(c, this.plugin.bridge.read(r.file));
    }
  }

  watchedPaths() {
    const s = new Set();
    for (const r of this.res.values()) for (const p of r.watch || []) s.add(p);
    return s;
  }

  r(c) {
    return this.res.get(c) || { kind: "plain", watch: [] };
  }
  isLive(c) {
    return this.r(c).kind === "sheet";
  }
  /** Effective, display-ready stats for a combatant. */
  stat(c) {
    const r = this.r(c);
    if (r.kind === "sheet") {
      return {
        hp: r.hp, maxHp: r.maxHp, temp: r.temp, ac: r.ac, mod: c.mod ?? r.mod, dex: r.dex,
        conditions: r.conditions, exhaustion: r.exhaustion, dying: r.dying, dead: r.dead,
        deathSaves: r.deathSaves, level: r.level, image: r.image, live: true,
        sp: r.sp, body: r.body, deathPenalty: r.deathPenalty, system: r.system, cls: r.cls,
      };
    }
    return {
      hp: c.hp, maxHp: c.maxHp, temp: c.temp || 0, ac: c.ac, acText: r.acText, mod: c.mod ?? r.mod,
      dex: c.dex ?? r.dex, conditions: c.conditions, cr: r.cr, xp: c.xp ?? r.xp, level: c.level,
      image: r.image, live: false,
      sp: c.sp, body: c.body ?? r.body, deathPenalty: c.dsp || 0, threat: r.threat,
      dead: (c.conditions || []).some((x) => x.name === "Dead"),
      ...this.groupStat(c, r),
    };
  }
  /** Group rows: size, HP each and how many are still standing. */
  groupStat(c, r) {
    if (!c.group || c.player) return {};
    const each = c.each ?? r.hp ?? (c.maxHp ? Math.max(1, Math.round(c.maxHp / c.group)) : undefined);
    return { group: c.group, each, alive: groupAlive(c.hp, each, c.group) };
  }
  isGroup(c) {
    return !!c.group && !c.player && !this.isLive(c);
  }
  /** "pc" | "enemy" | "neutral" | "ally" - NPC notes default to neutral. */
  disp(c) {
    if (c.player) return "pc";
    if (c.disp) return c.disp;
    return this.r(c).npc ? "neutral" : "enemy";
  }
  isCharmed(c) {
    return (this.stat(c).conditions || []).some((x) => x.name.toLowerCase() === "charmed");
  }
  /** Token rim colour: charmed creatures flip sides. */
  colour(c) {
    const d = this.disp(c);
    if (!this.isCharmed(c)) return d;
    return d === "pc" || d === "ally" ? "enemy" : "ally";
  }
  isRunning() {
    return this.enc.round > 0 && !this.enc.ended;
  }
  enemiesDefeated() {
    const enemies = this.enc.combatants.filter((c) => !c.off && this.disp(c) === "enemy");
    return enemies.length > 0 && enemies.every((c) => this.isDown(c));
  }
  /** Ends combat (keeps the round number) when every enemy is down. */
  checkAutoEnd() {
    if (!this.plugin.settings.autoEnd || !this.isRunning() || !this.enemiesDefeated()) return false;
    this.enc.ended = true;
    for (const c of this.enc.combatants) c.current = false;
    new Notice("All enemies are down - combat ended.");
    return true;
  }

  isDown(c) {
    const s = this.stat(c);
    if (c.player) return !!s.dead;
    return s.hp !== undefined && s.hp <= 0;
  }
  canAct(c) {
    if (c.off) return false;
    if (this.plugin.settings.skipDown && !c.player && this.isDown(c)) return false;
    if (c.player && this.stat(c).dead) return false;
    return true;
  }

  difficulty() {
    if (!this.plugin.sys.difficulty) return null;
    const levels = [];
    const xp = [];
    for (const c of this.enc.combatants) {
      if (c.off) continue;
      const s = this.stat(c);
      if (c.player) { if (s.level) levels.push(s.level); }
      else if (this.disp(c) === "enemy" && s.xp) for (let i = 0; i < (s.group || 1); i++) xp.push(s.xp);
    }
    if (!xp.length) return null;
    return difficulty(levels, xp);
  }

  // ---- encounter actions (all end with commit()) ----

  async commit() {
    if (!this.enc.id) this.enc.id = randomId();
    this.locator.id = this.enc.id;
    const body = serializeBlock(this.enc, (c) => this.isLive(c));
    this.saved = await this.plugin.writeBlock(this.sourcePath, this.locator, body);
    this.dirty = false;
    this.plugin.announce(this);
    this.emit();
    return this.saved;
  }

  async rollInitiative(pcValues) {
    const groupRolls = new Map();
    for (const c of this.enc.combatants) {
      const s = this.stat(c);
      if (c.player) {
        if (pcValues && pcValues.has(c)) c.init = pcValues.get(c);
        else if (this.plugin.settings.autoRollPlayers || c.init === undefined && !pcValues) c.init = this.plugin.initRoll() + (s.mod ?? 0);
      } else {
        const key = c.link || c.name.replace(/\s+\d+$/, "");
        if (this.plugin.settings.groupInitiative && groupRolls.has(key)) c.init = groupRolls.get(key);
        else {
          c.init = this.plugin.initRoll() + (s.mod ?? 0);
          groupRolls.set(key, c.init);
        }
      }
      c.current = false;
    }
    sortCombatants(this.enc, (c) => this.stat(c));
    this.enc.round = 1;
    this.enc.ended = false;
    const first = this.enc.combatants.find((c) => this.canAct(c));
    if (first) first.current = true;
    await this.commit();
  }

  async step(dir) {
    if (this.enc.ended) return;
    const res = stepTurn(this.enc, dir, (c) => this.canAct(c));
    if (!res) return;
    if (dir === 1 && res.from) {
      const expired = tickDurations(res.from);
      if (expired.length) new Notice(`${res.from.name}: ${expired.join(", ")} ended`);
    }
    await this.commit();
    if (res.to) {
      const s = this.stat(res.to);
      if (res.to.player && s.hp <= 0 && !s.dead) new Notice(`${res.to.name} is at 0 HP - roll a death saving throw`);
    }
  }

  async endCombat() {
    if (this.enc.round > 0) this.enc.ended = true;
    for (const c of this.enc.combatants) c.current = false;
    await this.commit();
  }

  async setInit(c, value) {
    c.init = value;
    if (this.enc.round > 0) sortKeepCurrent(this.enc, (x) => this.stat(x));
    await this.commit();
  }

  async remove(c) {
    const i = this.enc.combatants.indexOf(c);
    if (i < 0) return;
    const wasCurrent = c.current;
    this.enc.combatants.splice(i, 1);
    if (wasCurrent && this.enc.combatants.length) this.enc.combatants[Math.min(i, this.enc.combatants.length - 1)].current = true;
    if (!this.enc.combatants.length) this.enc.round = 0;
    this.checkAutoEnd();
    await this.commit();
  }

  async clearDefeated() {
    this.enc.combatants = this.enc.combatants.filter((c) => c.player || !this.isDown(c) || c.current);
    await this.commit();
  }

  async addFromText(text) {
    const added = parseCombatantLine(text).map((c) => ({ ...c, current: false }));
    await this.addCombatants(added);
    return added.length;
  }

  async addCombatants(list) {
    for (const c of list) {
      const names = new Set(this.enc.combatants.map((x) => x.name));
      if (names.has(c.name)) {
        const base = c.name.replace(/\s+\d+$/, "");
        let n = 2;
        while (names.has(`${base} ${n}`)) n++;
        c.name = `${base} ${n}`;
      }
      await this.resolveOne(c);
      if (this.enc.round > 0 && c.init === undefined && !c.player) c.init = this.plugin.initRoll() + (this.stat(c).mod ?? 0);
      this.enc.combatants.push(c);
    }
    if (this.enc.round > 0) sortKeepCurrent(this.enc, (x) => this.stat(x));
    await this.commit();
  }

  async addParty(group) {
    const members = this.plugin.partyMembers(group, this.sourcePath);
    const have = new Set(this.enc.combatants.map((c) => c.link || c.name));
    await this.addCombatants(members.filter((m) => !have.has(m.link || m.name)));
  }

  /** Damage / heal a group's shared HP pool.
   *  mode: "damage" (off the pool), "area" (amount to each of `targets`
   *  standing members; empty = all), "drop" (that many members fall),
   *  "heal" (back into the pool). */
  async groupHit(c, amount, mode = "damage", targets) {
    const s = this.stat(c);
    if (c.hp === undefined || !s.each) { new Notice(`${c.name}: set the group's HP first (HP each).`); return; }
    const before = s.alive;
    if (mode === "heal") c.hp = Math.min(c.maxHp ?? s.each * s.group, c.hp + amount);
    else if (mode === "drop") c.hp = Math.max(0, (before - Math.max(1, amount || 1)) * s.each);
    else if (mode === "area") c.hp = groupAreaHp(c.hp, s.each, s.group, amount, targets);
    else c.hp = Math.max(0, c.hp - amount);
    const after = groupAlive(c.hp, s.each, s.group);
    if (after !== before) this.plugin.flashCasualties(this, c, after - before);
    this.checkAutoEnd();
    await this.commit();
    const fell = before - after;
    if (mode === "heal") new Notice(`${c.name}: ${after}/${s.group} standing`);
    else new Notice(`${c.name}: ${fell > 0 ? `${fell} down` : "no one down"} · ${after}/${s.group} standing`);
  }

  /** Set HP each for a group (resets the pool to full). */
  async groupSetEach(c, each) {
    if (!each) return;
    c.each = each;
    c.maxHp = each * c.group;
    c.hp = c.maxHp;
    await this.commit();
  }

  /** Split a group: one row per standing member, or (size > 1) smaller
   *  groups of `size`. The last row carries the damage the pool has taken. */
  async splitGroup(c, size = 1) {
    const s = this.stat(c);
    const i = this.enc.combatants.indexOf(c);
    if (i < 0 || !this.isGroup(c)) return;
    const base = c.name.replace(/\s+\d+$/, "");
    if (size > 1 && s.each && c.hp !== undefined) {
      const chunks = groupChunks(s.alive || 0, size);
      if (chunks.length < 2) return;
      let missing = Math.max(0, (s.alive || 0) * s.each - c.hp);
      const rows = chunks.map((k, idx) => {
        const g = { ...c, name: `${base} ${idx + 1}`, conditions: c.conditions.map((x) => ({ ...x })), current: c.current && idx === 0, group: k, each: s.each };
        g.maxHp = k * s.each;
        g.hp = g.maxHp;
        if (k === 1) { delete g.group; delete g.each; }
        return g;
      });
      for (let k = rows.length - 1; k >= 0 && missing > 0; k--) {
        const take = Math.min(missing, rows[k].hp - 1);
        rows[k].hp -= take;
        missing -= take;
      }
      this.enc.combatants.splice(i, 1, ...rows);
      await this.resolveAll();
      await this.commit();
      return;
    }
    const n = s.alive || 0;
    const members = [];
    for (let k = 1; k <= n; k++) {
      const m = { ...c, name: n > 1 ? `${base} ${k}` : base, conditions: c.conditions.map((x) => ({ ...x })), current: c.current && k === 1 };
      delete m.group;
      delete m.each;
      if (s.each && c.hp !== undefined) {
        // the last one carries the damage the pool has taken
        const hp = k < n ? s.each : c.hp - (n - 1) * s.each;
        m.hp = Math.max(1, hp);
        m.maxHp = s.each;
      }
      members.push(m);
    }
    this.enc.combatants.splice(i, 1, ...members);
    if (c.current && !members.length && this.enc.combatants.length) this.enc.combatants[Math.min(i, this.enc.combatants.length - 1)].current = true;
    await this.resolveAll();
    await this.commit();
  }

  /** Creatures that can be merged with `c` into one group (same statblock). */
  mergeCandidates(c) {
    if (c.player || c.group || this.isLive(c)) return [];
    const key = (x) => (x.link ? linkBasename(x.link).toLowerCase() : x.name.replace(/\s+\d+$/, "").toLowerCase());
    const k = key(c);
    return this.enc.combatants.filter((x) => !x.player && !x.group && !this.isLive(x) && key(x) === k);
  }

  /** Merge every creature like `c` into one group row sharing an HP pool. */
  async mergeGroup(c) {
    const list = this.mergeCandidates(c);
    if (list.length < 2) return;
    const r = this.r(c);
    const each = r.hp ?? Math.max(...list.map((x) => x.maxHp ?? x.hp ?? 0)) ?? undefined;
    const g = {
      ...c,
      name: c.name.replace(/\s+\d+$/, ""),
      group: list.length,
      each: each || undefined,
      conditions: c.conditions.map((x) => ({ ...x })),
      current: list.some((x) => x.current),
    };
    if (each) {
      g.maxHp = each * list.length;
      g.hp = Math.min(g.maxHp, list.reduce((sum, x) => sum + Math.max(0, x.hp ?? each), 0));
    }
    const first = Math.min(...list.map((x) => this.enc.combatants.indexOf(x)));
    this.enc.combatants = this.enc.combatants.filter((x) => !list.includes(x));
    this.enc.combatants.splice(first, 0, g);
    await this.resolveAll();
    await this.commit();
  }

  /** Cyberpunk RED: one hit to body / head / direct, through armor. */
  async cpHit(c, amount, loc = "body", targets) {
    const s = this.stat(c);
    if (this.isGroup(c)) {
      // a group shares one armor value; no ablation tracking per member
      const sp = loc === "direct" ? 0 : ((s.sp && s.sp[loc === "head" ? "head" : "body"]) || 0);
      let through = Math.max(0, Math.round(amount) - sp);
      if (loc === "head") through *= 2;
      return this.groupHit(c, through, targets === undefined ? "damage" : "area", targets);
    }
    const res = cpredHit({ hp: s.hp, sp: s.sp }, amount, loc);
    // already Mortally Wounded: every hit adds +1 to the Death Save penalty
    const mwHit = (s.hp ?? 1) <= 0 && !s.dead;
    if (this.isLive(c)) {
      await this.plugin.bridge.applyHit(this.r(c).file, res, mwHit ? 1 : 0);
      this.refreshSheets();
      this.plugin.announce(this);
      this.emit();
    } else {
      c.hp = res.hp;
      if (c.sp || res.ablated) c.sp = res.sp;
      this.cpWounds(c);
      if (mwHit) c.dsp = (c.dsp || 0) + 1;
      this.checkAutoEnd();
      await this.commit();
    }
    const where = loc === "head" ? "head" : loc === "body" ? "body" : "direct";
    let msg = `${c.name}: ${Math.round(amount)} ${where} → ${res.through} damage`;
    if (res.ablated) msg += ` · SP ${res.spBefore}→${res.spBefore - 1}`;
    if (res.through === 0 && loc !== "direct") msg += " (stopped by armor)";
    if (mwHit) msg += " · Death Save penalty +1 (and a Critical Injury)";
    new Notice(msg);
    return res;
  }

  /** Keep Seriously / Mortally Wounded in step with HP (block creatures). */
  cpWounds(c) {
    if (this.plugin.sys.id !== "cpred" || c.hp === undefined || c.group) return;
    const names = cpredWoundConditions(c.hp, c.maxHp, c.conditions.map((x) => x.name));
    const keep = c.conditions.filter((x) => names.includes(x.name));
    for (const n of names) if (!keep.some((x) => x.name === n)) keep.push({ name: n });
    c.conditions = keep;
    if (c.hp > 0) c.dsp = 0;
  }

  /** Cyberpunk RED Death Save for a Mortally Wounded combatant. */
  async cpDeathSave(c) {
    const roll = Math.floor(Math.random() * 10) + 1;
    let res;
    if (this.isLive(c)) {
      res = await this.plugin.bridge.deathSaveRoll(this.r(c).file, roll);
      this.refreshSheets();
      this.emit();
    } else {
      const s = this.stat(c);
      res = cpredDeathSave(s.body, c.dsp || 0, roll);
      c.dsp = res.penalty;
      if (!res.success && !c.conditions.some((x) => x.name === "Dead")) c.conditions.push({ name: "Dead" });
      this.checkAutoEnd();
      await this.commit();
    }
    new Notice(`${c.name} - Death Save: rolled ${res.roll}${res.total !== res.roll ? ` (${res.total} with penalty)` : ""} → ${res.success ? "survives" : "DIES"}`, 8000);
    return res;
  }

  /** amount > 0 damages, < 0 heals */
  async changeHp(c, amount, mode = amount >= 0 ? "damage" : "heal") {
    if (this.isGroup(c) && mode !== "temp" && !(this.plugin.sys.id === "cpred" && (mode === "body" || mode === "head" || mode === "direct"))) {
      if (mode === "max") return this.groupSetEach(c, Math.abs(amount));
      if (mode === "damage" && this.plugin.sys.id === "cpred") return this.cpHit(c, Math.abs(amount), "body");
      return this.groupHit(c, Math.abs(amount), mode === "heal" ? "heal" : "damage");
    }
    if (this.plugin.sys.id === "cpred" && (mode === "damage" || mode === "body" || mode === "head" || mode === "direct")) {
      return this.cpHit(c, Math.abs(amount), mode === "damage" ? "body" : mode);
    }
    const amt = Math.abs(amount);
    const s = this.stat(c);
    const concentrating = (s.conditions || []).some((x) => x.name.toLowerCase().startsWith("concentrat"));
    if (this.isLive(c)) {
      const file = this.r(c).file;
      if (mode === "damage") {
        const res = await this.plugin.bridge.damage(file, amt);
        if (res.deathFail) new Notice(`${c.name} took damage at 0 HP: death save failure`);
      } else if (mode === "heal") await this.plugin.bridge.heal(file, amt);
      else if (mode === "temp") await this.plugin.bridge.setTemp(file, amt);
      this.refreshSheets();
      this.plugin.announce(this);
      this.emit();
    } else {
      if (mode === "damage") damageMonster(c, amt);
      else if (mode === "heal") healMonster(c, amt);
      else if (mode === "temp") c.temp = amt;
      else if (mode === "max") { c.hp = amt; c.maxHp = amt; }
      this.cpWounds(c);
      this.checkAutoEnd();
      await this.commit();
    }
    if (mode === "damage" && amt > 0 && concentrating && this.plugin.sys.concentration && this.plugin.settings.concentrationReminder) {
      new Notice(`${c.name}: Constitution save DC ${concentrationDc(amt)} to keep concentration`, 8000);
    }
  }

  /** HP set on the Atlas map. */
  async setHpFromMap(c, value, max) {
    if (this.isLive(c)) {
      await this.plugin.bridge.setHp(this.r(c).file, value, max);
      this.refreshSheets();
      this.plugin.announce(this);
      this.emit();
      return;
    }
    if (c.hp === value && (max === undefined || c.maxHp === max)) return;
    c.hp = Math.max(0, value);
    if (max !== undefined) c.maxHp = max;
    this.cpWounds(c);
    this.checkAutoEnd();
    await this.commit();
  }

  async addCondition(c, name, dur) {
    name = normalizeCondition(name);
    if (this.plugin.sys.id === "cpred") {
      const crit = this.plugin.criticalInjuryInfo(name);
      const already = (this.stat(c).conditions || []).some((x) => x.name.toLowerCase() === name.toLowerCase());
      if (crit && !already) return this.cpCritical(c, crit);
    }
    if (this.isLive(c)) {
      await this.plugin.bridge.addCondition(this.r(c).file, name);
      this.refreshSheets();
      this.emit();
      return;
    }
    const hit = c.conditions.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (hit) { if (dur !== undefined) hit.dur = dur; }
    else c.conditions.push(dur !== undefined ? { name, dur } : { name });
    await this.commit();
  }

  /** Cyberpunk RED Critical Injury: the injury + 5 bonus damage to HP. */
  async cpCritical(c, crit) {
    if (this.isLive(c)) {
      await this.plugin.bridge.criticalInjury(this.r(c).file, crit.name, crit.base);
      this.refreshSheets();
      this.plugin.announce(this);
      this.emit();
    } else {
      if (!c.conditions.some((x) => x.name === crit.name)) c.conditions.push({ name: crit.name });
      if (c.hp !== undefined) c.hp = Math.max(0, c.hp - CPRED_CRIT_BONUS);
      if (crit.base) c.dsp = Math.max(c.dsp || 0, crit.base);
      this.cpWounds(c);
      this.checkAutoEnd();
      await this.commit();
    }
    new Notice(`${c.name}: ${crit.name} · ${CPRED_CRIT_BONUS} bonus damage to HP${crit.base ? ` · Base Death Save Penalty ${crit.base}` : ""}`, 7000);
  }

  async removeCondition(c, name) {
    if (this.isLive(c)) {
      await this.plugin.bridge.removeCondition(this.r(c).file, name);
      this.refreshSheets();
      this.emit();
      return;
    }
    c.conditions = c.conditions.filter((x) => x.name !== name);
    await this.commit();
  }

  async deathSave(c, kind, i, checked) {
    if (!this.isLive(c)) return;
    await this.plugin.bridge.deathSave(this.r(c).file, kind, i, checked);
    this.refreshSheets();
    this.emit();
  }

  async toggle(c, flag) {
    c[flag] = !c[flag];
    await this.commit();
  }

  async setDisposition(c, disp) {
    c.disp = disp;
    this.checkAutoEnd();
    await this.commit();
  }

  async duplicate(c) {
    const copy = { ...c, conditions: c.conditions.map((x) => ({ ...x })), current: false };
    if (!c.player && c.maxHp !== undefined) copy.hp = c.maxHp;
    copy.init = undefined;
    await this.addCombatants([copy]);
  }

  async rename(c, name) {
    c.name = name;
    await this.commit();
  }
}

// ---------------------------------------------------------------------------
// UI - shared by the code block and the sidebar view
// ---------------------------------------------------------------------------

class EncounterUI {
  constructor(plugin, host, session, opts = {}) {
    this.plugin = plugin;
    this.app = plugin.app;
    this.host = host; // Component (MarkdownRenderChild / ItemView) used as hover parent
    this.session = session;
    this.opts = opts;
    this.el = null;
    this.openEditor = null; // { c, kind }
  }

  mount(el) {
    this.el = el;
    this.draw();
  }

  // Same button shape as Quick Initiative's: icon + optional label.
  button(parent, icon, label, cls, onClick, tip) {
    const b = parent.createEl("button", { cls: `ri-btn ${cls || ""}` });
    if (icon) setIcon(b.createSpan({ cls: "ri-btn-icon" }), icon);
    if (label) b.createSpan({ text: label });
    b.setAttr("aria-label", tip || label || "");
    b.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick(e);
    };
    return b;
  }

  linkEl(parent, text, linktext, cls) {
    const a = parent.createEl("a", { cls: `internal-link ${cls || ""}`, text });
    a.setAttr("data-href", linktext);
    a.setAttr("href", linktext);
    a.onclick = (e) => {
      e.preventDefault();
      this.app.workspace.openLinkText(linktext, this.session.sourcePath, e.ctrlKey || e.metaKey);
    };
    a.addEventListener("mouseover", (event) => {
      this.app.workspace.trigger("hover-link", {
        event,
        source: VIEW_TYPE,
        hoverParent: this.host,
        targetEl: a,
        linktext,
        sourcePath: this.session.sourcePath,
      });
    });
    return a;
  }

  imageSrc(image) {
    if (!image) return null;
    const s = String(image).trim();
    const mdImg = /!\[[^\]]*\]\(([^)]+)\)/.exec(s);
    if (mdImg) return mdImg[1];
    if (/^https?:\/\//.test(s)) return s;
    const wiki = /!?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/.exec(s);
    const target = wiki ? wiki[1] : s;
    const f = this.app.metadataCache.getFirstLinkpathDest(target, this.session.sourcePath);
    return f instanceof TFile ? this.app.vault.getResourcePath(f) : null;
  }

  /** Creatures that share one statblock get a little number on their token.
   *  Returns Map(combatant -> number) only for groups with 2+ members. */
  tokenNumbers() {
    const groups = new Map();
    for (const c of this.session.enc.combatants) {
      if (c.player || c.group) continue;
      const r = this.session.r(c);
      const key = r.path || (c.link ? linkBasename(c.link).toLowerCase() : r.kind === "bestiary" ? c.name.replace(/\s+\d+$/, "").toLowerCase() : null);
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(c);
    }
    const out = new Map();
    for (const members of groups.values()) {
      if (members.length < 2) continue;
      // Prefer the number already in the name ("Kuo-toa 2"), so a token keeps
      // its number when the order changes; otherwise number by block order.
      const used = new Set();
      const pending = [];
      for (const c of members) {
        const m = /\s(\d+)$/.exec(c.name);
        const n = m ? parseInt(m[1], 10) : NaN;
        if (Number.isFinite(n) && !used.has(n)) { used.add(n); out.set(c, n); }
        else pending.push(c);
      }
      let next = 1;
      for (const c of pending) {
        while (used.has(next)) next++;
        used.add(next);
        out.set(c, next);
      }
    }
    return out;
  }

  draw() {
    const { el, session } = this;
    if (!el) return;
    const enc = session.enc;
    el.empty();
    const root = el.createDiv({ cls: "ri" });
    if (session.isRunning()) root.addClass("ri-live");
    if (enc.ended) root.addClass("ri-ended");
    if (this.opts.sidebar) root.addClass("ri-sidebar");

    // ---- header: round badge + controls (Quick Initiative layout) ----
    const head = root.createDiv({ cls: "ri-head" });
    const left = head.createDiv({ cls: "ri-head-left" });
    const round = left.createDiv({ cls: "ri-round" });
    if (enc.ended) {
      round.createSpan({ cls: "ri-round-label", text: "Ended" });
      round.createSpan({ cls: "ri-round-num", text: String(enc.round) });
      round.title = `Combat ended in round ${enc.round}`;
    } else if (enc.round > 0) {
      round.createSpan({ cls: "ri-round-label", text: "Round" });
      round.createSpan({ cls: "ri-round-num", text: String(enc.round) });
    } else {
      round.createSpan({ cls: "ri-round-label", text: enc.combatants.length ? "Ready" : "Empty" });
    }
    const info = left.createDiv({ cls: "ri-info" });
    if (enc.name) info.createSpan({ cls: "ri-enc-name", text: enc.name });
    if (this.opts.sidebar) {
      this.linkEl(info, session.sourcePath.split("/").pop().replace(/\.md$/, ""), session.sourcePath, "ri-source");
    }
    if (this.plugin.settings.showDifficulty) {
      const d = session.difficulty();
      if (d) {
        const word = difficultyWord(d);
        const dd = info.createSpan({ cls: `ri-diff ri-diff-${(d.label || "none").toLowerCase().replace(/\s+/g, "-")}` });
        if (word) dd.setText(`${word} encounter`);
      }
    }

    const tools = head.createDiv({ cls: "ri-tools" });
    this.button(tools, "dices", session.isRunning() ? "Reroll" : "Roll initiative", "ri-roll", () => this.plugin.startRoll(session));
    if (session.isRunning()) {
      this.button(tools, "chevron-left", "", "ri-prev", () => session.step(-1), "Previous turn");
      this.button(tools, "chevron-right", "Next", "ri-next", () => session.step(1), "Next turn");
      this.button(tools, "square", "", "ri-end", () => session.endCombat(), "End combat");
    }
    if (!this.opts.sidebar) this.button(tools, "panel-right", "", "ri-side", () => this.plugin.openInSidebar(session), "Run in sidebar");
    if (this.plugin.screenPlugin) this.button(tools, "monitor-up", "", "ri-screen", () => this.plugin.showOnPlayerScreen(session), "Show on player screen (no HP or AC)");
    this.button(tools, "more-vertical", "", "ri-menu", (e) => this.encounterMenu(e), "Encounter options");

    // A block that isn't the fight running in the sidebar says so - its
    // monsters are separate copies, so changes here won't show there.
    const active = this.plugin.settings.active;
    if (!this.opts.sidebar && active && !(active.path === session.sourcePath && active.id === enc.id)) {
      const other = root.createDiv({ cls: "ri-other" });
      setIcon(other.createSpan({ cls: "ri-other-icon" }), "info");
      other.createSpan({ text: `This is a separate fight - the sidebar is running ${active.path.split("/").pop().replace(/\.md$/, "")}. Changes here won't show there.` });
      this.button(other, "panel-right", "Run this one in sidebar", "ri-other-btn", () => this.plugin.openInSidebar(session));
    }

    // ---- rows ----
    const list = root.createDiv({ cls: "ri-list" });
    const numbers = this.tokenNumbers();
    enc.combatants.forEach((c) => this.row(list, c, numbers.get(c)));
    if (!enc.combatants.length) {
      list.createDiv({ cls: "ri-empty", text: "Add a creature or player below, or write one per line in the block." });
    }

    // ---- add box ----
    const add = root.createDiv({ cls: "ri-add" });
    const input = add.createEl("input", { type: "text", cls: "ri-add-input", attr: { placeholder: this.plugin.sys.id === "cpred" ? "Add: type a name… (3 gang = 3 gangers · 20 gang group)" : "Add: type a name… (3 gob = 3 goblins · 20 gob group)" } });
    input.setAttr("aria-label", "Add combatants");
    const doAdd = async () => {
      const v = input.value.trim();
      if (!v) return;
      if (!(await session.addFromText(v))) new Notice("Nothing to add");
    };
    const remember = () => { this.plugin.lastAdd = { id: session.enc.id, path: session.sourcePath, at: Date.now() }; };
    if (typeof obsidian.AbstractInputSuggest === "function") {
      new CombatantSuggest(this.plugin, input, async (text) => {
        input.value = "";
        remember();
        if (!(await session.addFromText(text))) new Notice("Nothing to add");
      });
    } else {
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); remember(); doAdd(); }
      });
    }
    this.button(add, "plus", "Add", "ri-add-go", () => { remember(); doAdd(); });
    // Keep typing after an add re-rendered the block.
    const la = this.plugin.lastAdd;
    if (la && la.path === session.sourcePath && la.id === enc.id && Date.now() - la.at < 4000) setTimeout(() => input.focus(), 30);
    this.button(add, "search", "", "ri-browse", () => {
      new CreatureSuggestModal(this.plugin, (file, isPc) => {
        const link = this.app.metadataCache.fileToLinktext(file, session.sourcePath, true);
        session.addFromText(`[[${link}]]${isPc ? " player" : ""}`);
      }).open();
    }, "Browse monsters and characters");
    this.button(add, "users", "", "ri-party", () => {
      const groups = this.plugin.partyGroupNames();
      if (groups.length <= 1) session.addParty(groups[0] || "");
      else new ListPickModal(this.app, groups, "Add which party?", (g) => session.addParty(g)).open();
    }, "Add party");

    if (!session.saved) root.createDiv({ cls: "ri-unsaved", text: "Not saved: open the note itself to keep changes." });
  }

  token(parent, c, s, number) {
    const tok = parent.createDiv({ cls: "ri-token", attr: { role: "button", tabindex: "0" } });
    tok.addClass(`is-${this.session.colour(c)}`);
    if (this.session.isCharmed(c)) {
      tok.addClass("is-charmed");
      tok.title = c.player ? "Charmed - acting against the party" : "Charmed - on the party's side";
    }
    tok.setAttr("aria-label", `${c.name} options`);
    const src = this.imageSrc(s.image);
    const face = tok.createDiv({ cls: "ri-token-face" });
    const initials = () => {
      face.empty();
      face.addClass("is-initials");
      face.setText(c.name.replace(/\s+\d+$/, "").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase());
    };
    if (src) {
      const img = face.createEl("img");
      img.src = src;
      img.alt = "";
      img.draggable = false;
      img.onerror = initials;
    } else initials();
    if (number !== undefined) tok.createSpan({ cls: "ri-token-num", text: String(number) });
    tok.onclick = (e) => {
      e.preventDefault();
      this.rowMenu(e, c);
    };
    return tok;
  }

  row(list, c, number) {
    const s = this.session.stat(c);
    const row = list.createDiv({ cls: "ri-row" });
    if (c.current) row.addClass("is-current");
    if (c.player) row.addClass("is-player");
    row.addClass(`is-${this.session.disp(c)}`);
    if (c.hidden) row.addClass("is-hidden");
    if (c.off) row.addClass("is-off");
    if (s.dead || this.session.isDown(c)) row.addClass("is-down");
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.rowMenu(e, c);
    });

    // token
    this.token(row, c, s, number);

    // initiative circle
    const init = row.createEl("button", { cls: "ri-init", text: c.init === undefined ? "–" : String(c.init) });
    init.setAttr("aria-label", `Initiative for ${c.name}`);
    if (s.mod !== undefined) init.title = `Modifier ${signed(s.mod)}`;
    init.onclick = () => this.toggleEditor(c, "init");


    // name, tags, AC, HP bar, conditions
    const main = row.createDiv({ cls: "ri-main" });
    const top = main.createDiv({ cls: "ri-top" });
    const rr = this.session.r(c);
    if (rr.kind === "creature" || rr.kind === "bestiary") {
      // Monsters: show the statblock in the right sidebar (like Initiative
      // Tracker). Ctrl/Cmd-click still opens the note itself.
      const a = top.createEl("a", { cls: "ri-name ri-statblock-link", text: c.name });
      a.setAttr("aria-label", `Show statblock of ${c.name}`);
      a.onclick = (e) => {
        e.preventDefault();
        if ((e.ctrlKey || e.metaKey) && c.link) this.app.workspace.openLinkText(c.link, this.session.sourcePath, true);
        else this.plugin.showStatblock(this.session, c);
      };
    } else if (c.link) this.linkEl(top, c.name, c.link, "ri-name");
    else top.createSpan({ cls: "ri-name", text: c.name });
    if (c.player) {
      const tag = top.createSpan({ cls: "ri-tag", text: "PC" });
      if (s.live) { tag.addClass("is-live"); tag.title = "Synced with the character sheet"; }
    }
    const disp = this.session.disp(c);
    if (disp === "ally") top.createSpan({ cls: "ri-tag is-ally", text: "ALLY" });
    else if (disp === "neutral") top.createSpan({ cls: "ri-tag is-neutral", text: "NEUTRAL" });
    if (c.hidden) setIcon(top.createSpan({ cls: "ri-tag is-icon" }), "eye-off");
    if (s.group) {
      const g = top.createSpan({ cls: "ri-tag is-group" });
      setIcon(g.createSpan({ cls: "ri-tag-icon" }), "users");
      g.createSpan({ text: `${s.alive}/${s.group}` });
      g.title = `Group of ${s.group}${s.each ? `, ${s.each} HP each` : ""}: ${s.alive} still standing`;
      // "-3" floats up from the count when members go down
      const fl = this.plugin.casualtyFor(this.session, c);
      if (fl) {
        g.addClass(fl.delta < 0 ? "is-hit" : "is-healed");
        const tag = g.createSpan({ cls: `ri-casualty ${fl.delta < 0 ? "is-loss" : "is-gain"}`, text: fl.delta < 0 ? `−${-fl.delta}` : `+${fl.delta}` });
        tag.title = fl.delta < 0 ? `${-fl.delta} down` : `${fl.delta} back up`;
      }
    }
    if (s.sp) {
      const sp = top.createSpan({ cls: "ri-ac ri-sp" });
      setIcon(sp.createSpan({ cls: "ri-ac-icon" }), "shield");
      sp.createSpan({ text: `${s.sp.head}/${s.sp.body}` });
      sp.title = `Stopping Power - head ${s.sp.head} / body ${s.sp.body}`;
    } else if (s.ac !== undefined) {
      const ac = top.createSpan({ cls: "ri-ac" });
      setIcon(ac.createSpan({ cls: "ri-ac-icon" }), "shield");
      ac.createSpan({ text: String(s.ac) });
      ac.title = s.acText ? `Armor class ${s.acText}` : "Armor class";
    }

    if (s.hp !== undefined) {
      const max = Math.max(1, s.maxHp ?? s.hp);
      const ratio = Math.max(0, Math.min(1, s.hp / max));
      const bar = main.createDiv({ cls: "ri-bar" });
      const fill = bar.createDiv({ cls: "ri-bar-fill" });
      setCssVars(fill, { "--ri-pct": `${Math.round(ratio * 100)}%` });
      fill.addClass(ratio > 0.5 ? "ri-ok" : ratio > 0.25 ? "ri-hurt" : "ri-bad");
      if (s.temp) {
        const t = bar.createDiv({ cls: "ri-bar-temp" });
        setCssVars(t, { "--ri-temp-pct": `${Math.round(Math.min(1, s.temp / max) * 100)}%` });
      }
    }

    // Cyberpunk RED death save (Mortally Wounded, any combatant)
    if (this.plugin.sys.id === "cpred" && s.hp !== undefined && s.hp <= 0 && !s.dead && !s.group) {
      const ds = main.createDiv({ cls: "ri-ds" });
      const b = ds.createEl("button", { cls: "ri-btn ri-cp-ds" });
      setIcon(b.createSpan({ cls: "ri-btn-icon" }), "skull");
      b.createSpan({ text: `Death Save · under BODY ${s.body ?? "?"}${s.deathPenalty ? ` · +${s.deathPenalty}` : ""}` });
      b.onclick = (e) => { e.preventDefault(); this.session.cpDeathSave(c); };
    }
    // death saves (D&D sheet PCs at 0 HP)
    if (s.live && s.system !== "cpred" && s.hp <= 0 && !s.dead) {
      const ds = main.createDiv({ cls: "ri-ds" });
      for (const kind of ["success", "fail"]) {
        const grp = ds.createDiv({ cls: `ri-ds-group is-${kind}` });
        grp.createSpan({ cls: "ri-ds-label", text: kind === "success" ? "Saves" : "Fails" });
        [1, 2, 3].forEach((i) => {
          const on = s.deathSaves[kind][i - 1];
          const pip = grp.createEl("button", { cls: `ri-ds-pip${on ? " is-on" : ""}` });
          pip.setAttr("aria-label", `Death save ${kind} ${i}`);
          pip.onclick = () => this.session.deathSave(c, kind, i, !on);
        });
      }
    }

    const conds = main.createDiv({ cls: "ri-conds" });
    if (s.dead && !(s.conditions || []).some((x) => x.name === "Dead")) conds.createSpan({ cls: "ri-cond is-dead", text: "Dead" });
    if (s.exhaustion) conds.createSpan({ cls: "ri-cond is-exhaustion", text: `Exhaustion ${s.exhaustion}` });
    for (const cond of s.conditions || []) {
      const chip = conds.createEl("button", { cls: "ri-cond", text: cond.dur !== undefined ? `${cond.name} ${cond.dur}` : cond.name });
      chip.setAttr("aria-label", `Remove ${cond.name}`);
      chip.title = cond.dur !== undefined ? `${cond.dur} more turn(s) - click to remove` : "Click to remove";
      chip.onclick = () => this.session.removeCondition(c, cond.name);
    }
    const addCond = conds.createEl("button", { cls: "ri-cond ri-cond-add", text: "+ condition" });
    addCond.onclick = () => this.toggleEditor(c, "cond");

    // HP box
    const hp = row.createEl("button", { cls: "ri-hp" });
    hp.setAttr("aria-label", `Hit points for ${c.name}`);
    if (s.hp === undefined) {
      hp.setText("HP");
      hp.addClass("ri-hp-none");
    } else {
      hp.createSpan({ cls: "ri-hp-now", text: String(s.hp) });
      hp.createSpan({ cls: "ri-hp-max", text: `/${s.maxHp ?? s.hp}` });
      if (s.temp) hp.createSpan({ cls: "ri-hp-temp", text: `+${s.temp}` });
    }
    hp.onclick = () => this.toggleEditor(c, "hp");

    // remove
    const del = row.createEl("button", { cls: "ri-del" });
    setIcon(del, "x");
    del.setAttr("aria-label", `Remove ${c.name}`);
    del.onclick = () => this.session.remove(c);

    if (this.openEditor && this.openEditor.c === c) this.editor(list, c, this.openEditor.kind);
  }

  toggleEditor(c, kind) {
    const same = this.openEditor && this.openEditor.c === c && this.openEditor.kind === kind;
    this.openEditor = same ? null : { c, kind };
    this.draw();
    const inp = this.el.querySelector(".ri-edit input");
    if (inp) inp.focus();
  }

  editor(list, c, kind) {
    const s = this.session.stat(c);
    const ed = list.createDiv({ cls: "ri-edit" });
    const input = ed.createEl("input", { type: kind === "cond" ? "text" : "number" });
    const val = () => Math.abs(parseInt(input.value, 10));
    const run = (fn) => async () => {
      this.openEditor = null;
      await fn();
      this.draw();
    };
    if (kind === "hp") {
      input.setAttr("placeholder", s.hp === undefined ? "Max HP" : "Amount");
      input.setAttr("inputmode", "numeric");
      if (s.hp === undefined) {
        if (s.group) input.setAttr("placeholder", "HP each");
        this.button(ed, "check", "Set HP", "ri-set", run(() => Number.isFinite(val()) && this.session.changeHp(c, val(), "max")));
      } else if (s.group) {
        // a whole group in one row: damage comes off the shared pool
        const tgt = ed.createEl("input", { type: "number", cls: "ri-targets" });
        tgt.setAttr("placeholder", `× all ${s.alive}`);
        tgt.setAttr("aria-label", "How many members the area attack hits (empty = all standing)");
        tgt.setAttr("inputmode", "numeric");
        const targets = () => { const n = parseInt(tgt.value, 10); return Number.isFinite(n) && n > 0 ? n : undefined; };
        if (this.plugin.sys.id === "cpred") {
          this.button(ed, "shield", "Body", "ri-damage", run(() => Number.isFinite(val()) && this.session.cpHit(c, val(), "body")), "One body hit: damage over SP comes off the pool");
          this.button(ed, "crosshair", "Head", "ri-damage ri-head", run(() => Number.isFinite(val()) && this.session.cpHit(c, val(), "head")), "One head hit: (damage - SP) × 2 off the pool");
          this.button(ed, "zap", "Direct", "ri-damage ri-direct", run(() => Number.isFinite(val()) && this.session.cpHit(c, val(), "direct")), "Direct damage off the pool");
          this.button(ed, "flame", "Area", "ri-area", run(() => Number.isFinite(val()) && this.session.cpHit(c, val(), "body", targets() ?? s.alive)), "Each target takes the damage (minus body SP)");
        } else {
          this.button(ed, "sword", "Damage", "ri-damage", run(() => Number.isFinite(val()) && this.session.groupHit(c, val(), "damage")), "Damage off the group's shared HP pool");
          this.button(ed, "flame", "Area", "ri-area", run(() => Number.isFinite(val()) && this.session.groupHit(c, val(), "area", targets())), "Each target takes the full amount (Fireball, Cone of Cold…)");
        }
        this.button(ed, "user-minus", "−1", "ri-drop", run(() => this.session.groupHit(c, Number.isFinite(val()) && val() > 0 ? val() : 1, "drop")), "Members fall: type how many (empty = 1)");
        this.button(ed, "heart", "Heal", "ri-heal", run(() => Number.isFinite(val()) && this.session.groupHit(c, val(), "heal")));
        this.button(ed, "pencil", "Each", "ri-max", run(() => Number.isFinite(val()) && this.session.groupSetEach(c, val())), "Set HP each (refills the group)");
      } else if (this.plugin.sys.id === "cpred") {
        // Cyberpunk RED: enter the rolled damage, pick where it hit
        this.button(ed, "shield", "Body", "ri-damage", run(() => Number.isFinite(val()) && this.session.cpHit(c, val(), "body")), "Body hit (SP body, ablates)");
        this.button(ed, "crosshair", "Head", "ri-damage ri-head", run(() => Number.isFinite(val()) && this.session.cpHit(c, val(), "head")), "Head hit (SP head, ablates, ×2)");
        this.button(ed, "zap", "Direct", "ri-damage ri-direct", run(() => Number.isFinite(val()) && this.session.cpHit(c, val(), "direct")), "Direct damage (ignores armor)");
        this.button(ed, "heart", "Heal", "ri-heal", run(() => Number.isFinite(val()) && this.session.changeHp(c, val(), "heal")));
      } else {
        this.button(ed, "sword", "Damage", "ri-damage", run(() => Number.isFinite(val()) && this.session.changeHp(c, val(), "damage")));
        this.button(ed, "heart", "Heal", "ri-heal", run(() => Number.isFinite(val()) && this.session.changeHp(c, val(), "heal")));
        this.button(ed, "shield-plus", "Temp", "ri-temp", run(() => Number.isFinite(val()) && this.session.changeHp(c, val(), "temp")));
        if (!s.live) this.button(ed, "pencil", "Max", "ri-max", run(() => Number.isFinite(val()) && this.session.changeHp(c, val(), "max")), "Set current and max HP");
      }
      input.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        const raw = input.value.trim();
        const pick = s.hp === undefined ? ".ri-set" : raw.startsWith("+") ? ".ri-heal" : ".ri-damage";
        const b = ed.querySelector(pick);
        if (b) b.click();
      });
      if (s.group && s.hp !== undefined) ed.createDiv({ cls: "ri-hint", text: `Group of ${s.group} · ${s.each ?? "?"} HP each · ${s.alive} standing. Damage comes off the shared pool; Area deals the amount to each of × targets (empty = everyone standing); −1 drops members.` });
      else if (this.plugin.sys.id === "cpred") ed.createDiv({ cls: "ri-hint", text: `Type the rolled damage. SP ${s.sp ? `${s.sp.head} head / ${s.sp.body} body` : "0"} is subtracted and ablates; head hits ×2. Enter = body hit, +N = heal.${s.live ? " Saved to the player's note." : ""}` });
      else if (s.live) ed.createDiv({ cls: "ri-hint", text: "Saved to the character sheet." });
    } else if (kind === "init") {
      input.setAttr("placeholder", "Initiative");
      input.setAttr("inputmode", "numeric");
      const set = run(() => {
        const v = parseInt(input.value, 10);
        return Number.isFinite(v) && this.session.setInit(c, v);
      });
      this.button(ed, "check", "Set", "ri-set", set);
      this.button(ed, "dices", `Roll ${signed(s.mod ?? 0)}`, "ri-rollone", run(() => this.session.setInit(c, this.plugin.initRoll() + (s.mod ?? 0))));
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); set(); }
      });
    } else {
      input.setAttr("placeholder", s.live ? "Poisoned, Prone…" : "Poisoned, Prone:2…");
      const id = `ri-conds-${Math.floor(Math.random() * 1e9)}`;
      input.setAttr("list", id);
      const dl = ed.createEl("datalist");
      dl.id = id;
      for (const name of this.plugin.conditionNames()) dl.createEl("option").setAttr("value", name);
      const add = run(async () => {
        for (const p of input.value.split(",").map((x) => x.trim()).filter(Boolean)) {
          const pc = parseCondition(p);
          await this.session.addCondition(c, pc.name, s.live ? undefined : pc.dur);
        }
      });
      this.button(ed, "plus", "Add", "ri-set", add);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); add(); }
      });
      const quick = ed.createDiv({ cls: "ri-quick" });
      const have = new Set((s.conditions || []).map((x) => x.name.toLowerCase()));
      for (const q of this.plugin.sys.quick) {
        if (have.has(q.toLowerCase())) continue;
        const b = quick.createEl("button", { cls: "ri-cond", text: q });
        b.onclick = run(() => this.session.addCondition(c, q));
      }
    }
  }

  rowMenu(e, c) {
    const menu = new Menu();
    const r = this.session.r(c);
    if (r.kind === "creature" || r.kind === "bestiary") {
      menu.addItem((i) => i.setTitle("Show statblock").setIcon("scroll-text").onClick(() => this.plugin.showStatblock(this.session, c)));
    }
    if (c.link) menu.addItem((i) => i.setTitle(r.kind === "sheet" ? "Open character sheet" : "Open note").setIcon("file-text").onClick(() => this.app.workspace.openLinkText(c.link, this.session.sourcePath, true)));
    menu.addSeparator();
    menu.addItem((i) => i.setTitle(c.hidden ? "Reveal" : "Hide from players").setIcon(c.hidden ? "eye" : "eye-off").onClick(() => this.session.toggle(c, "hidden")));
    if (!c.player) {
      const cur = this.session.disp(c);
      menu.addSeparator();
      for (const [d, label, icon] of [["enemy", "Enemy (red)", "swords"], ["neutral", "Neutral (yellow)", "circle-help"], ["ally", "Ally (green)", "heart-handshake"]]) {
        menu.addItem((i) => i.setTitle(label).setIcon(icon).setChecked(cur === d).onClick(() => this.session.setDisposition(c, d)));
      }
      menu.addSeparator();
    }
    menu.addItem((i) => i.setTitle(c.off ? "Enable (takes turns)" : "Disable (skip turns)").setIcon("power").onClick(() => this.session.toggle(c, "off")));
    menu.addItem((i) => i.setTitle("Rename").setIcon("pencil").onClick(() => {
      new TextPromptModal(this.app, "Rename combatant", c.name, (v) => v && this.session.rename(c, v)).open();
    }));
    if (!c.player) menu.addItem((i) => i.setTitle("Duplicate").setIcon("copy").onClick(() => this.session.duplicate(c)));
    if (this.session.isGroup(c)) {
      menu.addItem((i) => i.setTitle("Split into smaller groups…").setIcon("layout-grid").onClick(() => {
        new TextPromptModal(this.app, `${c.name}: creatures per group`, "", (v) => {
          const x = parseInt(v, 10);
          if (Number.isFinite(x) && x >= 1) this.session.splitGroup(c, x);
        }).open();
      }));
      menu.addItem((i) => i.setTitle("Split into individual creatures").setIcon("users").onClick(() => this.session.splitGroup(c)));
    } else {
      const same = this.session.mergeCandidates(c);
      if (same.length > 1) menu.addItem((i) => i.setTitle(`Fight as one group (${same.length})`).setIcon("users").onClick(() => this.session.mergeGroup(c)));
    }
    menu.addSeparator();
    menu.addItem((i) => i.setTitle("Remove").setIcon("trash").onClick(() => this.session.remove(c)));
    menu.showAtMouseEvent(e);
  }

  encounterMenu(e) {
    const s = this.session;
    const menu = new Menu();
    menu.addItem((i) => i.setTitle("Rename encounter").setIcon("pencil").onClick(() => {
      new TextPromptModal(this.app, "Encounter name", s.enc.name, (v) => { s.enc.name = v || ""; s.commit(); }).open();
    }));
    menu.addItem((i) => i.setTitle("Ask players for initiative").setIcon("dices").onClick(() => new PlayerInitModal(this.plugin, s, (v) => s.rollInitiative(v)).open()));
    menu.addItem((i) => i.setTitle("Remove defeated monsters").setIcon("skull").onClick(() => s.clearDefeated()));
    menu.addItem((i) => i.setTitle("Sort by initiative").setIcon("arrow-down-wide-narrow").onClick(() => { sortKeepCurrent(s.enc, (c) => s.stat(c)); s.commit(); }));
    menu.addItem((i) => i.setTitle("Show on player screen").setIcon("monitor-up").onClick(() => this.plugin.showOnPlayerScreen(s)));
    menu.addItem((i) => i.setTitle("New combat…").setIcon("file-plus").onClick(() => new CombatWizardModal(this.plugin).open()));
    menu.addItem((i) => i.setTitle("Reload stats from notes").setIcon("refresh-cw").onClick(async () => {
      this.plugin.resolver.cache.clear();
      await s.resolveAll();
      this.draw();
    }));
    if (this.opts.sidebar) {
      menu.addSeparator();
      menu.addItem((i) => i.setTitle("Open encounter note").setIcon("file-text").onClick(() => this.app.workspace.openLinkText(s.sourcePath, "", false)));
      menu.addItem((i) => i.setTitle("Close in sidebar").setIcon("x").onClick(() => this.plugin.setActive(null)));
    }
    menu.showAtMouseEvent(e);
  }
}

// ---------------------------------------------------------------------------
// Hosts: code block + sidebar view
// ---------------------------------------------------------------------------

/** Keeps a session's PCs live: re-reads sheets when their files change. */
function watchSession(component, plugin, session, redraw) {
  let timer = null;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      session.refreshSheets();
      redraw();
    }, 120);
  };
  component.registerEvent(plugin.app.metadataCache.on("changed", (file) => {
    if (session.watchedPaths().has(file.path)) schedule();
  }));
  component.registerEvent(plugin.app.workspace.on("dnd-sheet:main-file-changed", (path) => {
    if (session.watchedPaths().has(path)) schedule();
  }));
  component.registerEvent(plugin.app.workspace.on("roll-initiative:sheet-written", (path) => {
    if (session.watchedPaths().has(path)) schedule();
  }));
}

class BlockChild extends MarkdownRenderChild {
  constructor(plugin, el, ctx, source) {
    super(el);
    this.plugin = plugin;
    this.ctx = ctx;
    this.source = source;
  }
  async onload() {
    const locator = { getSection: () => this.ctx.getSectionInfo(this.containerEl) };
    this.session = new Session(this.plugin, this.ctx.sourcePath, locator);
    this.ui = new EncounterUI(this.plugin, this, this.session);
    this.session.onChange(() => this.ui.draw());
    await this.session.loadSource(this.source);
    this.ui.mount(this.containerEl);
    watchSession(this, this.plugin, this.session, () => this.ui.draw());
    this.registerEvent(this.plugin.app.workspace.on("roll-initiative:active-changed", () => this.ui.draw()));
  }
}

class InitiativeView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.session = null;
    this.ui = null;
  }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return "Roll Initiative"; }
  getIcon() { return "swords"; }

  async onOpen() {
    this.contentEl.addClass("ri-view");
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (this.session && file.path === this.session.sourcePath && !this.writing) this.scheduleReload();
    }));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      const a = this.plugin.settings.active;
      if (a && a.path === oldPath) {
        a.path = file.path;
        this.plugin.saveSettings();
        if (this.session) this.session.sourcePath = file.path;
      }
    }));
    watchSession(this, this.plugin, { watchedPaths: () => (this.session ? this.session.watchedPaths() : new Set()), refreshSheets: () => this.session && this.session.refreshSheets() }, () => this.ui && this.ui.draw());
    await this.load();
  }

  scheduleReload() {
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => this.load(), 150);
  }

  async load() {
    const active = this.plugin.settings.active;
    const el = this.contentEl;
    if (!active) {
      this.session = null;
      el.empty();
      const empty = el.createDiv({ cls: "ri-view-empty" });
      empty.createEl("p", { text: "No combat is running in the sidebar." });
      empty.createEl("p", { text: "Click the sidebar button on a roll-initiative block, or run the command “Run combat from current note”." });
      return;
    }
    const session = new Session(this.plugin, active.path, { id: active.id });
    const ok = await session.loadFromFile();
    if (!ok) {
      el.empty();
      el.createDiv({ cls: "ri-view-empty", text: `Couldn't find the combat block in ${active.path}.` });
      return;
    }
    // Keep an open editor across reloads when it's the same combatant name.
    const prev = this.ui && this.ui.openEditor;
    this.session = session;
    this.ui = new EncounterUI(this.plugin, this, session, { sidebar: true });
    if (prev) {
      const same = session.enc.combatants.find((c) => c.name === prev.c.name);
      if (same) this.ui.openEditor = { c: same, kind: prev.kind };
    }
    session.onChange(() => this.ui.draw());
    const commit = session.commit.bind(session);
    session.commit = async () => {
      this.writing = true;
      try { return await commit(); } finally { setTimeout(() => (this.writing = false), 300); }
    };
    this.ui.mount(el);
  }
}

// ---------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------

class CreatureSuggestModal extends FuzzySuggestModal {
  constructor(plugin, onPick) {
    super(plugin.app);
    this.plugin = plugin;
    this.onPick = onPick;
    this.setPlaceholder("Monster or character…");
    const folder = folderPath(plugin.settings.monsterFolder || plugin.bridge.monsterFolder());
    this.items = [];
    for (const f of this.app.vault.getMarkdownFiles()) {
      const fm = (this.app.metadataCache.getFileCache(f) || {}).frontmatter;
      if (plugin.bridge.isSheet(fm, f)) this.items.push({ file: f, pc: true });
      else if (folder && (f.path === folder || f.path.startsWith(folder + "/")) && !/^\d+\./.test(f.basename)) this.items.push({ file: f, pc: false });
    }
  }
  getItems() { return this.items; }
  getItemText(item) { return (item.pc ? "PC · " : "") + item.file.basename; }
  onChooseItem(item) { this.onPick(item.file, item.pc); }
}

class ListPickModal extends SuggestModal {
  constructor(app, items, placeholder, onPick) {
    super(app);
    this.items = items;
    this.onPick = onPick;
    this.setPlaceholder(placeholder);
  }
  getSuggestions(q) {
    const s = q.toLowerCase();
    return this.items.filter((i) => i.toLowerCase().includes(s));
  }
  renderSuggestion(item, el) { el.setText(item); }
  onChooseSuggestion(item) { this.onPick(item); }
}

class TextPromptModal extends Modal {
  constructor(app, title, value, onSubmit) {
    super(app);
    this.titleText = title;
    this.value = value || "";
    this.onSubmit = onSubmit;
  }
  onOpen() {
    this.titleEl.setText(this.titleText);
    const input = this.contentEl.createEl("input", { type: "text", cls: "ri-prompt" });
    input.value = this.value;
    const ok = () => { this.close(); this.onSubmit(input.value.trim()); };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); ok(); } });
    new Setting(this.contentEl).addButton((b) => b.setButtonText("Save").setCta().onClick(ok));
    setTimeout(() => input.focus(), 10);
  }
  onClose() { this.contentEl.empty(); }
}

/** Ask the table for player initiatives (or roll them) before combat. */
class PlayerInitModal extends Modal {
  constructor(plugin, session, onSubmit) {
    super(plugin.app);
    this.session = session;
    this.onSubmit = onSubmit;
  }
  onOpen() {
    const { contentEl } = this;
    this.titleEl.setText("Player initiative");
    contentEl.addClass("ri-pc-modal");
    contentEl.createEl("p", { cls: "ri-hint", text: "Type what each player rolled, or leave it empty to roll for them." });
    const inputs = new Map();
    const pcs = this.session.enc.combatants.filter((c) => c.player);
    for (const c of pcs) {
      const s = this.session.stat(c);
      const row = contentEl.createDiv({ cls: "ri-pc-row" });
      row.createSpan({ cls: "ri-pc-name", text: c.name });
      row.createSpan({ cls: "ri-pc-mod", text: signed(s.mod ?? 0) });
      const inp = row.createEl("input", { type: "number" });
      inp.setAttr("inputmode", "numeric");
      inp.placeholder = "roll";
      const dice = row.createEl("button", { cls: "ri-btn" });
      setIcon(dice, "dices");
      dice.onclick = () => { inp.value = String(this.session.plugin.initRoll() + (s.mod ?? 0)); };
      inputs.set(c, inp);
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } });
    }
    const submit = () => {
      const values = new Map();
      for (const [c, inp] of inputs) {
        const v = parseInt(inp.value, 10);
        values.set(c, Number.isFinite(v) ? v : this.session.plugin.initRoll() + (this.session.stat(c).mod ?? 0));
      }
      this.close();
      this.onSubmit(values);
    };
    new Setting(contentEl).addButton((b) => b.setButtonText("Start combat").setCta().onClick(submit));
    const first = contentEl.querySelector("input");
    if (first) setTimeout(() => first.focus(), 10);
  }
  onClose() { this.contentEl.empty(); }
}

class StatblockModal extends Modal {
  constructor(plugin, file, sourcePath) {
    super(plugin.app);
    this.plugin = plugin;
    this.file = file;
    this.sourcePath = sourcePath;
    this.component = new obsidian.Component();
  }
  async onOpen() {
    this.modalEl.addClass("ri-statblock-modal");
    this.titleEl.setText(this.file.basename);
    const text = await this.app.vault.cachedRead(this.file);
    const body = extractStatblock(text);
    this.component.load();
    const md = body !== null ? "```statblock\n" + body + "\n```" : text;
    await MarkdownRenderer.render(this.app, md, this.contentEl, this.file.path, this.component);
  }
  onClose() {
    this.component.unload();
    this.contentEl.empty();
  }
}

// ---------------------------------------------------------------------------
// Add-box autocomplete
// ---------------------------------------------------------------------------

const BaseInputSuggest = obsidian.AbstractInputSuggest || class {};
const SYNTAX_HINT = /\[\[|\b(?:hp|ac|init|mod|temp|player|pc|ally|neutral|hidden)\b/i;

/** Suggests character sheets, monsters and NPCs while typing in the add
 *  box. "3 gob" -> 3x Goblin. The last item always adds the text as typed. */
class CombatantSuggest extends BaseInputSuggest {
  /** only: "pc" (character sheets), "creature" (monsters + NPCs) or null (all) */
  constructor(plugin, inputEl, onAdd, only = null) {
    super(plugin.app, inputEl);
    this.plugin = plugin;
    this.inputEl = inputEl;
    this.onAdd = onAdd;
    this.only = only;
    this.limit = 12;
  }
  getSuggestions(raw) {
    const q = raw.trim();
    if (!q) return [];
    const gm = /^(.*\S)\s+(group|mob|minions|horde)$/i.exec(q);
    const asGroup = !!gm;
    const qq = gm ? gm[1] : q;
    const m = /^(\d+)\s*x?\s+(.+)$/i.exec(qq) || /^x(\d+)\s+(.+)$/i.exec(qq);
    const count = m ? Math.max(1, Math.min(asGroup ? 999 : 50, parseInt(m[1], 10))) : 1;
    const term = (m ? m[2] : qq).replace(/^\[\[/, "").replace(/\]\]$/, "").trim();
    const typed = { asTyped: true, text: q };
    if (!term) return [typed];
    if (SYNTAX_HINT.test(term)) return this.only === "pc" ? [] : [typed];
    const fuzzy = obsidian.prepareFuzzySearch(term);
    const scored = [];
    for (const it of this.plugin.combatantIndex()) {
      if (this.only === "pc" && !it.pc) continue;
      if (this.only === "creature" && it.pc) continue;
      const r = fuzzy(it.name);
      if (r) scored.push({ ...it, count, asGroup: asGroup && !it.pc, score: r.score });
    }
    scored.sort((a, b) => b.score - a.score || a.name.length - b.name.length);
    return this.only === "pc" ? scored.slice(0, this.limit) : [...scored.slice(0, this.limit), typed];
  }
  renderSuggestion(it, el) {
    el.addClass("ri-suggest");
    if (it.asTyped) {
      el.createSpan({ cls: "ri-suggest-name", text: `Add “${it.text}”` });
      el.createSpan({ cls: "ri-suggest-kind", text: "as typed" });
      return;
    }
    el.createSpan({ cls: "ri-suggest-name", text: (it.count > 1 && !it.pc ? `${it.count}× ` : "") + it.name + (it.asGroup ? " (one group)" : "") });
    el.createSpan({ cls: `ri-suggest-kind is-${it.kind.toLowerCase()}`, text: it.label });
  }
  selectSuggestion(it) {
    this.close();
    if (it.asTyped) return this.onAdd(it.text);
    const link = this.app.metadataCache.fileToLinktext(it.file, "", true);
    if (it.pc) return this.onAdd(`[[${link}]] player`);
    return this.onAdd(`${it.count > 1 ? `${it.count}x ` : ""}[[${link}]]${it.asGroup ? " group" : ""}`);
  }
}

// ---------------------------------------------------------------------------
// Statblock pane (right sidebar) - like Initiative Tracker's creature view
// ---------------------------------------------------------------------------

const STATBLOCK_VIEW = "roll-initiative-statblock";

class StatblockView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.title = "Statblock";
    this.child = null;
  }
  getViewType() { return STATBLOCK_VIEW; }
  getDisplayText() { return this.title; }
  getIcon() { return "scroll-text"; }
  async onOpen() {
    this.contentEl.addClass("ri-statblock-view");
    this.contentEl.createDiv({ cls: "ri-view-empty", text: "Click a monster's name in Roll Initiative to see its statblock here." });
  }
  async show({ file, bestiaryName, name, sourcePath }) {
    this.title = name || (file && file.basename) || bestiaryName || "Statblock";
    if (this.leaf.updateHeader) this.leaf.updateHeader();
    if (this.child) this.removeChild(this.child);
    this.child = new obsidian.Component();
    this.addChild(this.child);
    const el = this.contentEl;
    el.empty();
    let md;
    if (file) {
      const text = await this.app.vault.cachedRead(file);
      const body = extractStatblock(text);
      md = body !== null ? "```statblock\n" + body + "\n```" : text;
    } else {
      md = "```statblock\nmonster: " + bestiaryName + "\n```";
    }
    const wrap = el.createDiv({ cls: "ri-statblock-wrap" });
    await MarkdownRenderer.render(this.app, md, wrap, file ? file.path : sourcePath || "", this.child);
  }
}

// ---------------------------------------------------------------------------
// Encounter card: ```roll-encounter``` (Initiative Tracker's encounter syntax)
// ---------------------------------------------------------------------------

const ENCOUNTER_BLOCK = "roll-encounter";

const stripLink = (v) => {
  if (Array.isArray(v)) {
    const target = String(v.flat(Infinity)[0] ?? "");
    return { name: linkBasename(target), link: target, isLink: true };
  }
  const s = String(v ?? "").trim();
  const m = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/.exec(s);
  return m ? { name: m[2] || linkBasename(m[1]), link: m[1], isLink: true } : { name: s, isLink: false };
};

/** One creature entry, in any of Initiative Tracker's formats:
 *  "Goblin", "3: Goblin", {3: "Goblin, 7, 15, 2, hidden"}, {2: [[Kuo-toa]]},
 *  {2: ["Kuo-toa", "Boss"]}, {creature: Goblin, count: 2, hp: 7, ...}. */
function parseEncounterCreature(entry) {
  if (entry === null || entry === undefined) return null;
  let count = 1;
  let val = entry;
  if (typeof entry === "string") {
    const m = /^\s*(\d+)?\s*:?\s*(.+)$/.exec(entry);
    if (m && m[1] && /:|\s/.test(entry.slice(m[1].length, m[1].length + 2))) { count = parseInt(m[1], 10); val = m[2]; }
  } else if (typeof entry === "object" && !Array.isArray(entry) && !("creature" in entry)) {
    const [k, v] = Object.entries(entry)[0] || [];
    count = k;
    val = v;
  }
  const out = { count: 1, name: "", hidden: false };
  if (typeof count === "string" && /\d+d\d+/.test(count)) out.countDice = count;
  else out.count = Math.max(0, parseInt(count, 10) || 1);
  const nums = (arr) => {
    const n = arr.filter((x) => x !== "" && !isNaN(Number(x))).map(Number);
    [out.hp, out.ac, out.mod, out.xp] = n;
  };
  const flags = (arr) => {
    const low = arr.map((x) => String(x).trim().toLowerCase());
    if (low.includes("hidden")) out.hidden = true;
    if (low.some((x) => x === "ally" || x === "friend" || x === "friendly")) out.disp = "ally";
    if (low.includes("neutral")) out.disp = "neutral";
    for (const x of low) {
      const gm = GROUP_FLAG.exec(x);
      if (gm) out.group = gm[2] ? Math.max(1, parseInt(gm[2], 10)) : true;
      if (SINGLE_WORDS.includes(x)) out.group = false;
    }
    return arr.filter((x) => {
      const t = String(x).trim().toLowerCase();
      return !["hidden", "ally", "friend", "friendly", "neutral", ...SINGLE_WORDS].includes(t) && !GROUP_FLAG.test(t);
    });
  };
  if (typeof val === "string") {
    const parts = flags(val.split(/,\s*/));
    Object.assign(out, stripLink(parts[0]));
    nums(parts.slice(1));
  } else if (Array.isArray(val)) {
    // YAML reads [[Kuo-toa]] as a nested list: [["Kuo-toa"]] - that's a link.
    const head = val[0];
    if (Array.isArray(head)) {
      const target = String(head.flat(Infinity)[0] ?? "");
      Object.assign(out, { name: linkBasename(target), link: target, isLink: true });
    } else Object.assign(out, stripLink(head));
    const rest = flags(val.slice(1));
    if (typeof rest[0] === "string" && isNaN(Number(rest[0]))) out.display = rest.shift();
    nums(rest);
  } else if (typeof val === "object") {
    Object.assign(out, stripLink(val.creature));
    if (val.name) out.display = String(val.name);
    out.count = Math.max(0, parseInt(val.count ?? count, 10) || 1);
    for (const k of ["hp", "ac", "mod", "xp"]) if (val[k] !== undefined && !isNaN(Number(val[k]))) out[k] = Number(val[k]);
    if (val.hidden) out.hidden = true;
    if (val.ally || val.friend || val.friendly) out.disp = "ally";
    if (val.neutral) out.disp = "neutral";
    const gv = val.group ?? val.mob ?? val.minions;
    if (gv === false) out.group = false;
    else if (typeof gv === "number" && gv > 0) out.group = Math.round(gv);
    else if (gv) out.group = true;
  }
  if (out.display) out.name = out.display;
  if (!out.name && !out.link) return null;
  return out;
}

/** Unquoted [[links]] break YAML ("- 1: [[Wolf]], ally"), so quote any
 *  value that starts with [[ before parsing. */
function quoteLinks(doc) {
  return doc.split("\n").map((line) => {
    const m = /^(\s*(?:-\s+)?(?:[^\s:"'\[][^:"'\n]*:\s+)?)(\[\[.*?)\s*$/.exec(line);
    if (!m) return line;
    return `${m[1]}"${m[2].replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }).join("\n");
}

/** Parse one YAML document of a roll-encounter block (no vault access). */
function parseEncounterSpec(obj) {
  if (!obj || typeof obj !== "object") return null;
  const spec = { name: obj.name ? String(obj.name) : "", party: obj.party ? stripLink(obj.party).name : "", playersMode: "default", players: [], creatures: [], rollHP: obj.rollHP === true || obj.rollhp === true };
  const p = obj.players;
  if (p === false || p === "none") spec.playersMode = "none";
  else if (p === true) spec.playersMode = "default";
  else if (typeof p === "string") { spec.playersMode = "list"; spec.players.push(stripLink(p)); }
  else if (Array.isArray(p)) { spec.playersMode = "list"; for (const x of p) spec.players.push(stripLink(x)); }
  if (spec.party && spec.playersMode === "default") spec.playersMode = "party";
  for (const e of Array.isArray(obj.creatures) ? obj.creatures : []) {
    const c = parseEncounterCreature(e);
    if (c) spec.creatures.push(c);
  }
  return spec;
}

/** 2024 budget band -> the word shown to the table (no XP). */
const DIFFICULTY_WORDS = { Trivial: "Trivial", Low: "Easy", Moderate: "Medium", High: "Hard", "Beyond High": "Deadly" };
function difficultyWord(d) {
  return d && d.label ? DIFFICULTY_WORDS[d.label] || d.label : null;
}

const yamlStr = (s) => (/^[\w][\w '’().-]*$/.test(s) && !/^(true|false|null|yes|no|on|off|none)$/i.test(s) ? s : JSON.stringify(s));

/** Write a roll-encounter spec back as YAML (the format the card reads). */
function serializeEncounterSpec(spec) {
  const out = [];
  if (spec.name) out.push(`name: ${yamlStr(spec.name)}`);
  if (spec.playersMode === "party" && spec.party) out.push(`party: ${yamlStr(spec.party)}`);
  else if (spec.playersMode === "none") out.push("players: none");
  else if (spec.playersMode === "list") {
    if (!spec.players.length) out.push("players: none");
    else {
      out.push("players:");
      for (const p of spec.players) out.push(`  - ${p.isLink ? `[[${p.link}]]` : yamlStr(p.name)}`);
    }
  }
  if (spec.rollHP) out.push("rollHP: true");
  if (spec.creatures.length) {
    out.push("creatures:");
    for (const c of spec.creatures) {
      const base = c.isLink ? `[[${c.link}]]` : c.name;
      if (c.isLink && c.name && c.name !== linkBasename(c.link)) {
        out.push(`  - creature: ${base}`, `    name: ${yamlStr(c.name)}`, `    count: ${c.countDice || c.count}`);
        for (const k of ["hp", "ac", "mod", "xp"]) if (c[k] !== undefined) out.push(`    ${k}: ${c[k]}`);
        if (c.hidden) out.push("    hidden: true");
        if (c.disp === "ally") out.push("    ally: true");
        if (c.disp === "neutral") out.push("    neutral: true");
        if (c.group === false) out.push("    group: false");
        else if (c.group) out.push(`    group: ${c.group === true ? "true" : c.group}`);
        continue;
      }
      const extra = [];
      const nums = [c.hp, c.ac, c.mod, c.xp];
      while (nums.length && nums[nums.length - 1] === undefined) nums.pop();
      for (const n of nums) extra.push(n === undefined ? "" : String(n));
      if (c.hidden) extra.push("hidden");
      if (c.disp === "ally" || c.disp === "neutral") extra.push(c.disp);
      if (c.group === false) extra.push("single");
      else if (c.group) extra.push(c.group === true ? "group" : `group ${c.group}`);
      out.push(`  - ${c.countDice || c.count}: ${[base, ...extra].join(", ")}`);
    }
  }
  return out.join("\n");
}

class EncounterCard extends MarkdownRenderChild {
  constructor(plugin, el, ctx, source) {
    super(el);
    this.plugin = plugin;
    this.app = plugin.app;
    this.ctx = ctx;
    this.source = source;
  }

  async onload() {
    const root = this.containerEl.createDiv({ cls: "ri-encounter-container" });
    // Several encounters can share a block, separated by ---. An empty
    // block is one empty encounter, ready to be filled in.
    const docs = this.source.split(/^---\s*$/m);
    const nonEmpty = docs.map((d, i) => [d, i]).filter(([d]) => d.trim());
    const list = nonEmpty.length ? nonEmpty : [["", 0]];
    for (const [doc, index] of list) {
      let obj = {};
      if (doc.trim()) {
        try { obj = parseYaml(quoteLinks(doc)); } catch (e) { obj = null; }
      }
      const spec = obj === null ? null : parseEncounterSpec(obj || {});
      const el = root.createDiv({ cls: "ri ri-encounter" });
      if (!spec) {
        el.createDiv({ cls: "ri-empty", text: "This encounter's YAML couldn't be read - check name, party and creatures." });
        continue;
      }
      await this.renderSpec(el, spec, index);
    }
  }

  /** Save one encounter (doc) back into the block. */
  async save(spec, index) {
    const info = this.ctx.getSectionInfo(this.containerEl);
    const file = this.app.vault.getAbstractFileByPath(this.ctx.sourcePath);
    if (!info || !(file instanceof TFile)) {
      new Notice("Open the note itself to edit this encounter.");
      return;
    }
    this.plugin.lastCardEdit = { field: (this.plugin.lastCardEdit || {}).field, path: this.ctx.sourcePath, line: info.lineStart, at: Date.now() };
    await this.app.vault.process(file, (data) => {
      const lines = data.split("\n");
      const m = new RegExp("^((?:\\s*>)*\\s*)(`{3,}|~{3,})\\s*" + ENCOUNTER_BLOCK + "\\b").exec(lines[info.lineStart] || "");
      if (!m) return data;
      const prefix = m[1];
      let end = -1;
      for (let j = info.lineStart + 1; j < lines.length; j++) {
        const t = lines[j].slice(prefix.length).trim();
        if (t.startsWith(m[2]) && t.replace(/[`~]/g, "") === "") { end = j; break; }
      }
      if (end < 0) return data;
      const body = lines.slice(info.lineStart + 1, end).map((l) => l.slice(prefix.length)).join("\n");
      const docs = body.split(/^---\s*$/m).map((d) => d.replace(/^\n+|\n+$/g, ""));
      while (docs.length <= index) docs.push("");
      docs[index] = serializeEncounterSpec(spec);
      const text = docs.join("\n---\n").replace(/^\n+|\n+$/g, "");
      const newBody = text ? text.split("\n").map((l) => prefix + l) : [];
      lines.splice(info.lineStart + 1, end - info.lineStart - 1, ...newBody);
      return lines.join("\n");
    });
  }

  /** Fixed-width HP / AC cells so the numbers line up in columns. */
  stat(parent, kind, icon, text, title) {
    const cell = parent.createSpan({ cls: `ri-enc-stat is-${kind}` });
    if (text === undefined || text === null || text === "") { cell.addClass("is-empty"); return cell; }
    setIcon(cell.createSpan({ cls: "ri-enc-stat-icon" }), icon);
    cell.createSpan({ cls: "ri-enc-stat-val", text: String(text) });
    if (title) cell.title = title;
    return cell;
  }

  mini(parent, image, name, colour) {
    const ui = { app: this.app, session: { sourcePath: this.ctx.sourcePath } };
    const t = parent.createDiv({ cls: `ri-token ri-token-mini is-${colour}` });
    const face = t.createDiv({ cls: "ri-token-face" });
    const src = EncounterUI.prototype.imageSrc.call(ui, image);
    const initials = () => { face.empty(); face.addClass("is-initials"); face.setText(name.slice(0, 1).toUpperCase()); };
    if (src) { const img = face.createEl("img"); img.src = src; img.alt = ""; img.onerror = initials; }
    else initials();
  }

  async renderSpec(el, spec, index) {
    const plan = await this.plugin.resolveEncounter(spec, this.ctx.sourcePath);
    const save = () => this.save(spec, index);

    // ---- header: name + difficulty badge ----
    const head = el.createDiv({ cls: "ri-enc-head" });
    const title = head.createEl("h3", { cls: "ri-enc-title", text: spec.name || "New encounter" });
    title.title = "Click to rename";
    title.onclick = () => new TextPromptModal(this.app, "Encounter name", spec.name, (v) => { spec.name = v; save(); }).open();
    if (this.plugin.atlas && this.plugin.atlas.installed) {
      const fromAtlas = head.createEl("button", { cls: "ri-btn ri-enc-atlas" });
      setIcon(fromAtlas.createSpan({ cls: "ri-btn-icon" }), "map");
      fromAtlas.createSpan({ text: "From Atlas" });
      fromAtlas.setAttr("aria-label", "Fill this encounter from an Atlas VTT encounter");
      fromAtlas.onclick = (e) => {
        e.preventDefault();
        this.plugin.atlas.pickEncounter((enc) => {
          const from = this.plugin.atlas.specFromEncounter(enc);
          spec.name = spec.name || from.name;
          spec.playersMode = from.players.length ? "list" : spec.playersMode;
          if (from.players.length) spec.players = from.players;
          spec.creatures = from.creatures;
          save();
        });
      };
    }
    const word = difficultyWord(plan.difficulty);
    if (word) {
      const badge = head.createSpan({ cls: `ri-enc-badge ri-diff-${plan.difficulty.label.toLowerCase().replace(/\s+/g, "-")}`, text: `${word} encounter` });
      badge.title = "Difficulty for this party (2024 rules)";
    }

    // ---- players: party picker or single characters ----
    const groups = this.plugin.bridge.partyGroups();
    const cols = el.createDiv({ cls: "ri-enc-columns" });
    const psec = cols.createDiv({ cls: "ri-enc-section ri-enc-players" });
    const phead = psec.createDiv({ cls: "ri-enc-section-head" });
    phead.createEl("h4", { text: "Players" });
    const select = phead.createEl("select", { cls: "dropdown ri-enc-party" });
    const current = spec.playersMode === "party" ? `party:${spec.party}`
      : spec.playersMode === "default" ? (groups[0] ? `party:${groups[0].name}` : "list")
      : "list"; // custom list (also an empty one)
    for (const g of groups) select.createEl("option", { text: g.name, value: `party:${g.name}` });
    select.createEl("option", { text: "Custom characters", value: "list" });
    select.value = current;
    select.onchange = () => {
      const v = select.value;
      if (v.startsWith("party:")) { spec.playersMode = "party"; spec.party = v.slice(6); }
      else if (v === "list") {
        spec.playersMode = "list";
        // start from whoever is in the fight now
        spec.players = plan.players.map((p) => (p.link ? { name: p.name, link: p.link, isLink: true } : { name: p.name, isLink: false }));
      }
      save();
    };

    // Players in this fight. × takes one out (a party becomes a custom
    // list), and the input below adds character sheets by name.
    const asList = () => plan.players.map((p) => (p.link ? { name: p.name, link: p.link, isLink: true } : { name: p.name, isLink: false }));
    const ul = psec.createEl("ul", { cls: "ri-enc-list" });
    this.alignLists = [ul];
    if (!plan.players.length) ul.createEl("li", { cls: "ri-empty", text: spec.playersMode === "none" ? "No players - monsters only." : "No characters yet - type a name below." });
    plan.players.forEach((p, i) => {
      const li = ul.createEl("li");
      this.mini(li, p.image, p.name, "pc");
      if (p.link) {
        const a = li.createEl("a", { cls: "internal-link", text: p.name });
        a.setAttr("data-href", p.link);
        a.onclick = (e) => { e.preventDefault(); this.app.workspace.openLinkText(p.link, this.ctx.sourcePath, e.ctrlKey || e.metaKey); };
      } else li.createSpan({ text: p.name });
      // name · HP · AC · class + level (right)
      const pst = li.createSpan({ cls: "ri-enc-stats is-first" });
      this.stat(pst, "hp", "heart", p.hp !== undefined ? `${p.hp}/${p.maxHp ?? p.hp}` : "", "Hit points (from the character sheet)");
      if (p.sp) this.stat(pst, "ac", "shield", `${p.sp.head}/${p.sp.body}`, "Stopping Power head / body");
      else this.stat(pst, "ac", "shield", p.ac, "Armor class (from the character sheet)");
      const who = [p.cls, p.level ? (p.cls ? String(p.level) : `Level ${p.level}`) : null].filter(Boolean).join(" ");
      const whoEl = pst.createSpan({ cls: "ri-enc-stat is-who", text: who });
      if (p.cls) whoEl.title = `${p.cls}, level ${p.level ?? "?"}`;
      const del = li.createEl("button", { cls: "ri-del" });
      setIcon(del, "x");
      del.setAttr("aria-label", `Remove ${p.name}`);

      del.onclick = (e) => {
        e.preventDefault();
        const list = asList();
        list.splice(i, 1);
        spec.playersMode = "list";
        spec.players = list;
        save();
      };
    });
    const padd = psec.createDiv({ cls: "ri-add" });
    const pinput = padd.createEl("input", { type: "text", cls: "ri-add-input", attr: { placeholder: "Add character… (type a name)" } });
    const addPlayer = (text) => {
      const parsed = parseCombatantLine(text)[0];
      if (!parsed) return;
      const list = spec.playersMode === "none" ? [] : asList();
      const key = (parsed.link || parsed.name).toLowerCase();
      if (!list.some((p) => (p.link || p.name).toLowerCase() === key)) {
        list.push(parsed.link ? { name: parsed.name, link: parsed.link, isLink: true } : { name: parsed.name, isLink: false });
      }
      spec.playersMode = "list";
      spec.players = list;
      pinput.value = "";
      this.plugin.lastCardEdit = { ...(this.plugin.lastCardEdit || {}), field: "players" };
      save();
    };
    if (typeof obsidian.AbstractInputSuggest === "function") new CombatantSuggest(this.plugin, pinput, addPlayer, "pc");
    else pinput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addPlayer(`${pinput.value.trim()} player`); } });

    // ---- creatures with - / + ----
    const csec = cols.createDiv({ cls: "ri-enc-section ri-enc-creatures" });
    const chead = csec.createDiv({ cls: "ri-enc-section-head" });
    chead.createEl("h4", { text: "Creatures" });
    const rollLbl = chead.createEl("label", { cls: "ri-enc-rollhp" });
    if (!this.plugin.sys.rollHp) rollLbl.addClass("ri-hidden");
    const rollCb = rollLbl.createEl("input", { type: "checkbox" });
    rollCb.checked = !!spec.rollHP;
    rollLbl.createSpan({ text: "Roll for HP" });
    rollLbl.title = "On: each creature's HP is rolled from its hit dice when you press Roll Initiative. Off: the statblock's average HP.";
    rollCb.onchange = () => { spec.rollHP = rollCb.checked; save(); };
    const cul = csec.createEl("ul", { cls: "ri-enc-list" });
    (this.alignLists = this.alignLists || []).push(cul);
    if (!plan.creatures.length) cul.createEl("li", { cls: "ri-empty", text: "No creatures yet - add some below." });
    plan.creatures.forEach((c, i) => {
      const li = cul.createEl("li");
      const stepper = li.createDiv({ cls: "ri-enc-stepper" });
      const minus = stepper.createEl("button", { cls: "ri-enc-step", text: "−" });
      minus.setAttr("aria-label", `One less ${c.name}`);
      stepper.createSpan({ cls: "ri-enc-count", text: c.countDice || String(c.count) });
      const plus = stepper.createEl("button", { cls: "ri-enc-step", text: "+" });
      plus.setAttr("aria-label", `One more ${c.name}`);
      const sc = spec.creatures[i];
      minus.onclick = (e) => {
        e.preventDefault();
        if (sc.countDice) { delete sc.countDice; sc.count = 1; }
        else if (sc.count <= 1) spec.creatures.splice(i, 1);
        else sc.count -= 1;
        save();
      };
      plus.onclick = (e) => {
        e.preventDefault();
        if (sc.countDice) { delete sc.countDice; sc.count = 1; }
        sc.count = Math.min(50, (sc.count || 0) + 1);
        save();
      };
      this.mini(li, c.stats.image, c.name, c.disp === "ally" ? "ally" : c.disp === "neutral" ? "neutral" : "enemy");
      const a = li.createEl("a", { cls: "ri-statblock-link", text: c.name });
      a.onclick = (e) => {
        e.preventDefault();
        if ((e.ctrlKey || e.metaKey) && c.link) this.app.workspace.openLinkText(c.link, this.ctx.sourcePath, true);
        else this.plugin.showStatblockFor({ file: c.file, bestiaryName: c.file ? null : c.name, name: c.name, sourcePath: this.ctx.sourcePath });
      };
      if (c.hidden) setIcon(a.createSpan({ cls: "ri-tag is-icon ri-enc-hidden" }), "eye-off");
      // ally / neutral is shown by the token's rim colour (keeps rows compact)
      a.title = c.disp === "ally" ? `${c.name} (ally)` : c.disp === "neutral" ? `${c.name} (neutral)` : c.name;
      if ((c.count || 0) > 1 || c.countDice) {
        // armies / minions: one row per group with a shared HP pool
        const n = c.count || 2;
        const size = this.plugin.groupingOf(c, n);
        const g = li.createEl("button", { cls: `ri-enc-group${size ? " is-on" : ""}` });
        setIcon(g.createSpan({ cls: "ri-enc-group-icon" }), "users");
        if (size && size < n) { g.addClass("has-size"); g.createSpan({ cls: "ri-enc-group-size", text: String(size) }); }
        const chunks = size ? groupChunks(n, size) : [];
        const what = !size ? "one by one" : chunks.length === 1 ? `one group of ${n}` : `${chunks.length} groups of ${size}${chunks[chunks.length - 1] !== size ? ` (last ${chunks[chunks.length - 1]})` : ""}`;
        g.setAttr("aria-label", `${c.name}: ${what}`);
        g.title = `${c.name}: ${what}. Click to change.`;
        g.onclick = (e) => {
          e.preventDefault();
          const set = (v) => { sc.group = v; save(); };
          const menu = new Menu();
          menu.addItem((i) => i.setTitle("One by one (a row each)").setIcon("user").setChecked(!size).onClick(() => set(false)));
          menu.addItem((i) => i.setTitle(`One group of ${n}`).setIcon("users").setChecked(size === n).onClick(() => set(true)));
          const sizes = [5, 10, 20, 25, 50].filter((x) => x < n && x >= 2);
          for (const x of sizes) {
            const k = groupChunks(n, x).length;
            menu.addItem((i) => i.setTitle(`Groups of ${x} (${k} groups)`).setIcon("layout-grid").setChecked(size === x && x < n).onClick(() => set(x)));
          }
          menu.addItem((i) => i.setTitle("Groups of… (custom size)").setIcon("pencil").onClick(() => {
            new TextPromptModal(this.app, `${c.name}: creatures per group`, size && size < n ? String(size) : "", (v) => {
              const x = parseInt(v, 10);
              if (Number.isFinite(x) && x >= 1) set(x >= n ? true : x);
            }).open();
          }));
          menu.showAtMouseEvent(e);
        };
      }
      // HP / AC straight from the statblock (typed numbers only for
      // creatures that have no statblock) + CR, in fixed-width columns.
      const meta = li.createSpan({ cls: "ri-enc-stats is-first" });
      const hp = c.stats.hp ?? c.hp;
      const ac = c.stats.ac ?? c.ac;
      if (spec.rollHP && c.stats.hitDice) {
        this.stat(meta, "hp", "dices", c.stats.hitDice.replace(/\s+/g, ""), `HP rolled from ${c.stats.hitDice} for each creature (average ${hp ?? "?"})`).addClass("is-rolled");
      } else {
        this.stat(meta, "hp", "heart", hp, c.stats.hitDice ? `Hit points ${hp} (${c.stats.hitDice})` : `Hit points ${hp}`);
      }
      if (c.stats.sp) this.stat(meta, "ac", "shield", `${c.stats.sp.head}/${c.stats.sp.body}`, "Stopping Power head / body");
      else this.stat(meta, "ac", "shield", ac, c.stats.acText ? `Armor class ${c.stats.acText}` : `Armor class ${ac}`);
      const cr = meta.createSpan({ cls: "ri-enc-stat is-cr" });
      if (c.stats.cr !== undefined) cr.createSpan({ cls: "ri-enc-cr", text: `CR ${c.stats.cr}` });
      else if (c.stats.threat) cr.createSpan({ cls: "ri-enc-cr", text: c.stats.threat });
    });

    for (const l of this.alignLists) alignCardColumns(l);

    // add box (same autocomplete as the tracker)
    const add = csec.createDiv({ cls: "ri-add" });
    const input = add.createEl("input", { type: "text", cls: "ri-add-input", attr: { placeholder: this.plugin.sys.id === "cpred" ? "Add enemy… (3 gang = 3 gangers)" : "Add creature… (3 gob = 3 goblins)" } });
    const addText = (text) => {
      const parsed = parseCombatantLine(text);
      if (!parsed.length) return;
      const first = parsed[0];
      if (first.player) {
        // a character typed here goes into the player list
        spec.playersMode = "list";
        if (!spec.players.length) spec.players = plan.players.map((p) => (p.link ? { name: p.name, link: p.link, isLink: true } : { name: p.name, isLink: false }));
        spec.players.push(first.link ? { name: first.name, link: first.link, isLink: true } : { name: first.name, isLink: false });
      } else {
        const name = first.name.replace(/\s+\d+$/, "");
        const entry = first.link ? { name: linkBasename(first.link), link: first.link, isLink: true } : { name, isLink: false };
        entry.count = parsed.length;
        for (const k of ["hp", "ac", "mod", "xp"]) if (first[k] !== undefined) entry[k] = first[k];
        if (first.hidden) entry.hidden = true;
        if (first.disp) entry.disp = first.disp;
        const same = spec.creatures.find((x) => (x.link || x.name) === (entry.link || entry.name) && !x.hp && !entry.hp);
        if (same) same.count = Math.min(50, (same.count || 1) + entry.count);
        else spec.creatures.push(entry);
      }
      input.value = "";
      this.plugin.lastCardEdit = { ...(this.plugin.lastCardEdit || {}), field: "creatures" };
      save();
    };
    if (typeof obsidian.AbstractInputSuggest === "function") new CombatantSuggest(this.plugin, input, addText, "creature");
    else input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addText(input.value.trim()); } });
    const le = this.plugin.lastCardEdit;
    const info = this.ctx.getSectionInfo && this.ctx.getSectionInfo(this.containerEl);
    if (le && info && le.path === this.ctx.sourcePath && le.line === info.lineStart && Date.now() - le.at < 4000) {
      setTimeout(() => (le.field === "players" ? pinput : input).focus(), 30);
    }

    // ---- start ----
    const btn = el.createEl("button", { cls: "ri-btn ri-roll ri-enc-roll" });
    setIcon(btn.createSpan({ cls: "ri-btn-icon" }), "dices");
    btn.createSpan({ text: "Roll Initiative" });
    if (!plan.creatures.length && !plan.players.length) btn.disabled = true;
    btn.onclick = (e) => {
      e.preventDefault();
      this.plugin.startEncounter(spec, this.ctx.sourcePath);
    };
  }
}

// ---------------------------------------------------------------------------
// New combat wizard (left ribbon): encounter note or initiative text
// ---------------------------------------------------------------------------

const WIZARD_KINDS = {
  encounter: {
    title: "Combat encounter",
    icon: "swords",
    desc: "A full encounter note in your encounters folder. It shows the whole initiative order: every player and creature on its own row, with HP, conditions and turns. Use it for a fight you're about to run.",
    button: "Create encounter note",
  },
  initiative: {
    title: "Initiative tracker",
    icon: "dices",
    desc: "A compact, prepared encounter (players and creatures) with a Roll Initiative button, as text you paste into any note: your adventure, a location, a session plan. Press the button when the fight starts.",
    button: "Create initiative text",
  },
};

class CombatWizardModal extends Modal {
  constructor(plugin, kind = null) {
    super(plugin.app);
    this.plugin = plugin;
    this.kind = kind;
    const first = plugin.partyGroupNames()[0];
    this.spec = { name: "", party: first || "", playersMode: first ? "party" : "none", players: [], creatures: [], rollHP: false };
  }
  onOpen() {
    this.modalEl.addClass("ri-wizard-modal");
    this.draw();
  }
  onClose() { this.contentEl.empty(); }

  drawChoice(el) {
    this.titleEl.setText("New combat");
    el.createEl("p", { cls: "ri-wiz-lead", text: "What do you want to prepare?" });
    const opts = el.createDiv({ cls: "ri-wiz-options" });
    for (const [key, k] of Object.entries(WIZARD_KINDS)) {
      const b = opts.createEl("button", { cls: `ri-wiz-option is-${key}` });
      setIcon(b.createDiv({ cls: "ri-wiz-option-icon" }), k.icon);
      const t = b.createDiv({ cls: "ri-wiz-option-text" });
      t.createDiv({ cls: "ri-wiz-option-title", text: k.title });
      t.createDiv({ cls: "ri-wiz-option-desc", text: k.desc });
      b.onclick = (e) => { e.preventDefault(); this.kind = key; this.draw(); };
    }
    const foot = el.createDiv({ cls: "ri-wiz-foot" });
    const side = foot.createEl("button", { cls: "ri-wiz-link", text: "Open the initiative sidebar instead" });
    side.onclick = (e) => { e.preventDefault(); this.close(); this.plugin.revealView(); };
  }

  drawSetup(el) {
    const k = WIZARD_KINDS[this.kind];
    const spec = this.spec;
    this.titleEl.setText(k.title);
    el.createEl("p", { cls: "ri-wiz-lead", text: k.desc });

    // name
    const nameRow = el.createDiv({ cls: "ri-wiz-row" });
    nameRow.createEl("label", { cls: "ri-wiz-label", text: "Name" });
    const name = nameRow.createEl("input", { type: "text", cls: "ri-wiz-name", attr: { placeholder: "Ambush at the old mill" } });
    name.value = spec.name;
    name.addEventListener("input", () => { spec.name = name.value.trim(); });

    // players
    const pRow = el.createDiv({ cls: "ri-wiz-row" });
    pRow.createEl("label", { cls: "ri-wiz-label", text: "Players" });
    const pBox = pRow.createDiv({ cls: "ri-wiz-field" });
    const sel = pBox.createEl("select", { cls: "dropdown" });
    for (const g of this.plugin.partyGroupNames()) sel.createEl("option", { text: g, value: `party:${g}` });
    sel.createEl("option", { text: "Choose characters…", value: "list" });
    sel.createEl("option", { text: "No players", value: "none" });
    sel.value = spec.playersMode === "party" ? `party:${spec.party}` : spec.playersMode === "list" ? "list" : "none";
    sel.onchange = () => {
      const v = sel.value;
      if (v.startsWith("party:")) { spec.playersMode = "party"; spec.party = v.slice(6); }
      else { spec.playersMode = v; spec.party = ""; }
      this.draw();
    };
    if (spec.playersMode === "list") {
      const chips = pBox.createDiv({ cls: "ri-wiz-chips" });
      spec.players.forEach((p, i) => {
        const chip = chips.createSpan({ cls: "ri-wiz-chip", text: p.name });
        const x = chip.createEl("button", { cls: "ri-wiz-chip-x", text: "×" });
        x.setAttr("aria-label", `Remove ${p.name}`);
        x.onclick = (e) => { e.preventDefault(); spec.players.splice(i, 1); this.draw(); };
      });
      const pin = pBox.createEl("input", { type: "text", cls: "ri-wiz-add", attr: { placeholder: "Add character… (type a name)" } });
      const addP = (text) => { if (specAddText(spec, /\bplayer\b|\bpc\b/i.test(text) ? text : `${text} player`)) this.draw(true); };
      if (typeof obsidian.AbstractInputSuggest === "function") new CombatantSuggest(this.plugin, pin, addP, "pc");
      else pin.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addP(pin.value.trim()); } });
    }

    // creatures
    const cRow = el.createDiv({ cls: "ri-wiz-row is-creatures" });
    cRow.createEl("label", { cls: "ri-wiz-label", text: this.plugin.sys.id === "cpred" ? "Enemies" : "Creatures" });
    const cBox = cRow.createDiv({ cls: "ri-wiz-field" });
    const list = cBox.createDiv({ cls: "ri-wiz-list" });
    if (!spec.creatures.length) list.createDiv({ cls: "ri-wiz-empty", text: "Nothing yet - type below. 3 gob = 3 goblins, 40 gob group = an army." });
    spec.creatures.forEach((c, i) => {
      const row = list.createDiv({ cls: "ri-wiz-crow" });
      const minus = row.createEl("button", { cls: "ri-wiz-step", text: "−" });
      row.createSpan({ cls: "ri-wiz-count", text: String(c.count || 1) });
      const plus = row.createEl("button", { cls: "ri-wiz-step", text: "+" });
      minus.setAttr("aria-label", `One less ${c.name}`);
      plus.setAttr("aria-label", `One more ${c.name}`);
      minus.onclick = (e) => { e.preventDefault(); if ((c.count || 1) <= 1) spec.creatures.splice(i, 1); else c.count -= 1; this.draw(); };
      plus.onclick = (e) => { e.preventDefault(); c.count = Math.min(999, (c.count || 1) + 1); this.draw(); };
      row.createSpan({ cls: "ri-wiz-cname", text: c.name });
      if ((c.count || 1) > 1) {
        // armies: one by one, one group, or groups of N
        const n = c.count;
        const size = this.plugin.groupingOf(c, n);
        const gs = row.createEl("select", { cls: "dropdown ri-wiz-group" });
        gs.setAttr("aria-label", `How to run ${c.name}`);
        gs.createEl("option", { text: "One by one", value: "single" });
        gs.createEl("option", { text: `One group of ${n}`, value: "all" });
        for (const x of [5, 10, 20, 25, 50].filter((v) => v < n && v >= 2)) gs.createEl("option", { text: `Groups of ${x} (${groupChunks(n, x).length})`, value: String(x) });
        if (size && size < n && ![5, 10, 20, 25, 50].includes(size)) gs.createEl("option", { text: `Groups of ${size} (${groupChunks(n, size).length})`, value: String(size) });
        gs.value = !size ? "single" : size >= n ? "all" : String(size);
        gs.onchange = () => {
          const v = gs.value;
          c.group = v === "single" ? false : v === "all" ? true : parseInt(v, 10);
          this.draw();
        };
      }
      const x = row.createEl("button", { cls: "ri-wiz-x", text: "×" });
      x.setAttr("aria-label", `Remove ${c.name}`);
      x.onclick = (e) => { e.preventDefault(); spec.creatures.splice(i, 1); this.draw(); };
    });
    const cin = cBox.createEl("input", { type: "text", cls: "ri-wiz-add", attr: { placeholder: this.plugin.sys.id === "cpred" ? "Add enemy… (3 gang = 3 gangers)" : "Add creature… (3 gob = 3 goblins · 40 gob group)" } });
    const addC = (text) => { if (specAddText(spec, text)) this.draw(true); };
    if (typeof obsidian.AbstractInputSuggest === "function") new CombatantSuggest(this.plugin, cin, addC, "creature");
    else cin.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addC(cin.value.trim()); } });
    if (this.refocus) { setTimeout(() => cin.focus(), 10); this.refocus = false; }

    // options + difficulty
    const opt = el.createDiv({ cls: "ri-wiz-opts" });
    if (this.plugin.sys.rollHp) {
      const lbl = opt.createEl("label", { cls: "ri-wiz-check" });
      const cb = lbl.createEl("input", { type: "checkbox" });
      cb.checked = !!spec.rollHP;
      lbl.createSpan({ text: "Roll for HP" });
      cb.onchange = () => { spec.rollHP = cb.checked; };
    }
    const diff = opt.createSpan({ cls: "ri-wiz-diff" });
    this.updateDifficulty(diff);

    // buttons
    const foot = el.createDiv({ cls: "ri-wiz-foot" });
    const back = foot.createEl("button", { text: "‹ Back" });
    back.onclick = (e) => { e.preventDefault(); this.kind = null; this.draw(); };
    const go = foot.createEl("button", { cls: "mod-cta", text: k.button });
    go.onclick = async (e) => {
      e.preventDefault();
      go.disabled = true;
      try { await this.finish(); } finally { go.disabled = false; }
    };
  }

  async updateDifficulty(span) {
    if (!this.plugin.sys.difficulty || !this.spec.creatures.length) return;
    try {
      const plan = await this.plugin.resolveEncounter(this.spec, "");
      const w = difficultyWord(plan.difficulty);
      if (w) { span.setText(`${w} encounter`); span.addClass(`is-${String(plan.difficulty.label).toLowerCase().replace(/\s+/g, "-")}`); }
    } catch (e) { /* no difficulty */ }
  }

  draw(refocus = false) {
    if (refocus) this.refocus = true;
    const el = this.contentEl;
    el.empty();
    el.addClass("ri-wizard");
    if (!this.kind) this.drawChoice(el);
    else this.drawSetup(el);
  }

  async finish() {
    const spec = this.spec;
    if (!spec.creatures.length && spec.playersMode === "none") { new Notice("Add some creatures first."); return; }
    if (this.kind === "encounter") {
      const title = spec.name || `Encounter ${new Date().toISOString().slice(0, 10)}`;
      const body = await this.plugin.encounterNoteBody({ ...spec, name: title });
      this.close();
      const file = await this.plugin.newEncounterNote(title, body);
      new Notice(`Encounter note created: ${file.path}`);
    } else {
      const text = this.plugin.initiativeCardText(spec);
      this.close();
      new CopyTextModal(this.app, "Initiative tracker", "Copy this into the note where the fight happens. It shows as a prepared encounter with a Roll Initiative button.", text).open();
    }
  }
}

/** Shows prepared text with a "Copy and Close" button. */
class CopyTextModal extends Modal {
  constructor(app, title, hint, text) {
    super(app);
    this.titleText = title;
    this.hint = hint;
    this.text = text;
  }
  onOpen() {
    this.titleEl.setText(this.titleText);
    this.modalEl.addClass("ri-wizard-modal");
    const el = this.contentEl;
    el.addClass("ri-wizard");
    el.createEl("p", { cls: "ri-wiz-lead", text: this.hint });
    const ta = el.createEl("textarea", { cls: "ri-wiz-code" });
    ta.value = this.text;
    ta.readOnly = true;
    ta.rows = Math.min(16, this.text.split("\n").length + 1);
    const foot = el.createDiv({ cls: "ri-wiz-foot" });
    const cancel = foot.createEl("button", { text: "Close" });
    cancel.onclick = () => this.close();
    const copy = foot.createEl("button", { cls: "mod-cta", text: "Copy and Close" });
    copy.onclick = async () => {
      let ok = false;
      try { await navigator.clipboard.writeText(this.text); ok = true; } catch (e) {
        try { ta.select(); ok = document.execCommand("copy"); } catch (e2) { ok = false; }
      }
      new Notice(ok ? "Copied - paste it into your note." : "Couldn't copy - select the text and copy it yourself.");
      if (ok) this.close();
    };
    setTimeout(() => { ta.focus(); ta.select(); }, 10);
  }
  onClose() { this.contentEl.empty(); }
}

// ---------------------------------------------------------------------------
// Player screen (TTRPG Tools - Player Screen): a live, read-only view of the
// running fight without HP numbers or AC.
// ---------------------------------------------------------------------------

const PLAYER_BLOCK = "roll-initiative-players";
const SCREEN_PLUGIN_ID = "ttrpg-tools-screen";

/** Draw the players' view of a session into `el`. Pure DOM, no controls. */
function renderPlayerView(el, plugin, session) {
  el.empty();
  const root = el.createDiv({ cls: "ri ri-player-view" });
  if (!session) {
    root.createDiv({ cls: "ri-empty", text: "No fight is running." });
    return root;
  }
  const enc = session.enc;
  if (session.isRunning()) root.addClass("ri-live");
  if (enc.ended) root.addClass("ri-ended");
  const head = root.createDiv({ cls: "ri-head" });
  const left = head.createDiv({ cls: "ri-head-left" });
  const round = left.createDiv({ cls: "ri-round" });
  if (enc.ended) {
    round.createSpan({ cls: "ri-round-label", text: "Ended" });
    round.createSpan({ cls: "ri-round-num", text: String(enc.round) });
  } else if (enc.round > 0) {
    round.createSpan({ cls: "ri-round-label", text: "Round" });
    round.createSpan({ cls: "ri-round-num", text: String(enc.round) });
  } else {
    round.createSpan({ cls: "ri-round-label", text: "Ready" });
  }
  const info = left.createDiv({ cls: "ri-info" });
  if (enc.name) info.createSpan({ cls: "ri-enc-name", text: enc.name });

  const ui = { app: plugin.app, session };
  const numbers = EncounterUI.prototype.tokenNumbers.call(ui);
  const bars = plugin.settings.playerScreenBars || "all";
  const list = root.createDiv({ cls: "ri-list" });
  let shown = 0;
  for (const c of enc.combatants) {
    if (c.hidden) continue;
    shown++;
    const s = session.stat(c);
    const row = list.createDiv({ cls: "ri-row" });
    if (c.current) row.addClass("is-current");
    if (c.player) row.addClass("is-player");
    row.addClass(`is-${session.disp(c)}`);
    if (c.off) row.addClass("is-off");
    if (s.dead || session.isDown(c)) row.addClass("is-down");

    // token (no menu on the player screen)
    const tok = row.createDiv({ cls: `ri-token is-${session.colour(c)}` });
    if (session.isCharmed(c)) tok.addClass("is-charmed");
    const face = tok.createDiv({ cls: "ri-token-face" });
    const initials = () => {
      face.empty();
      face.addClass("is-initials");
      face.setText(c.name.replace(/\s+\d+$/, "").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase());
    };
    const src = EncounterUI.prototype.imageSrc.call(ui, s.image);
    if (src) {
      const img = face.createEl("img");
      img.src = src;
      img.alt = "";
      img.onerror = initials;
    } else initials();
    if (numbers.get(c) !== undefined) tok.createSpan({ cls: "ri-token-num", text: String(numbers.get(c)) });

    row.createDiv({ cls: "ri-init", text: c.init === undefined ? "–" : String(c.init) });

    const main = row.createDiv({ cls: "ri-main" });
    const top = main.createDiv({ cls: "ri-top" });
    top.createSpan({ cls: "ri-name", text: c.name });
    if (c.player) top.createSpan({ cls: "ri-tag is-live", text: "PC" });
    const disp = session.disp(c);
    if (disp === "ally") top.createSpan({ cls: "ri-tag is-ally", text: "ALLY" });
    else if (disp === "neutral") top.createSpan({ cls: "ri-tag is-neutral", text: "NEUTRAL" });
    if (s.group) {
      const g = top.createSpan({ cls: "ri-tag is-group" });
      setIcon(g.createSpan({ cls: "ri-tag-icon" }), "users");
      g.createSpan({ text: `${s.alive}/${s.group}` });
      const fl = plugin.casualtyFor(session, c);
      if (fl) {
        g.addClass(fl.delta < 0 ? "is-hit" : "is-healed");
        g.createSpan({ cls: `ri-casualty ${fl.delta < 0 ? "is-loss" : "is-gain"}`, text: fl.delta < 0 ? `−${-fl.delta}` : `+${fl.delta}` });
      }
    }

    const showBar = bars === "all" || (bars === "players" && c.player);
    if (showBar && s.hp !== undefined) {
      const max = Math.max(1, s.maxHp ?? s.hp);
      const ratio = Math.max(0, Math.min(1, s.hp / max));
      const bar = main.createDiv({ cls: "ri-bar" });
      const fill = bar.createDiv({ cls: "ri-bar-fill" });
      setCssVars(fill, { "--ri-pct": `${Math.round(ratio * 100)}%` });
      fill.addClass(ratio > 0.5 ? "ri-ok" : ratio > 0.25 ? "ri-hurt" : "ri-bad");
    }

    // death saves (read-only)
    if (s.live && s.system !== "cpred" && s.hp <= 0 && !s.dead && s.deathSaves) {
      const ds = main.createDiv({ cls: "ri-ds" });
      for (const kind of ["success", "fail"]) {
        const grp = ds.createDiv({ cls: `ri-ds-group is-${kind}` });
        grp.createSpan({ cls: "ri-ds-label", text: kind === "success" ? "Saves" : "Fails" });
        [0, 1, 2].forEach((i) => grp.createSpan({ cls: `ri-ds-pip${s.deathSaves[kind][i] ? " is-on" : ""}` }));
      }
    }

    const conds = main.createDiv({ cls: "ri-conds" });
    if (s.dead && !(s.conditions || []).some((x) => x.name === "Dead")) conds.createSpan({ cls: "ri-cond is-dead", text: "Dead" });
    if (s.exhaustion) conds.createSpan({ cls: "ri-cond is-exhaustion", text: `Exhaustion ${s.exhaustion}` });
    for (const cond of s.conditions || []) conds.createSpan({ cls: "ri-cond", text: cond.dur !== undefined ? `${cond.name} ${cond.dur}` : cond.name });
  }
  if (!shown) list.createDiv({ cls: "ri-empty", text: "Waiting for the fight to start…" });
  return root;
}

/** The block the player screen renders: follows the running fight live. */
class PlayerScreenChild extends MarkdownRenderChild {
  constructor(plugin, el) {
    super(el);
    this.plugin = plugin;
    this.timer = null;
  }
  onload() {
    this.refresh();
    const later = () => {
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => { this.timer = null; this.refresh(); }, 80);
    };
    const ws = this.plugin.app.workspace;
    this.registerEvent(ws.on("roll-initiative:change", later));
    this.registerEvent(ws.on("roll-initiative:sheet-written", later));
    this.registerEvent(ws.on("dnd-sheet:main-file-changed", later));
    this.registerEvent(ws.on("dnd-sheet:conditions-changed", later));
    this.registerEvent(ws.on("cpr-sheet:refresh", later));
    this.registerEvent(this.plugin.app.metadataCache.on("changed", (file) => {
      const s = this.session;
      if (s && s.watchedPaths().has(file.path)) later();
    }));
  }
  onunload() { if (this.timer) clearTimeout(this.timer); }
  async refresh() {
    try {
      this.session = await this.plugin.playerScreenSession();
      if (this.session) this.session.refreshSheets();
      renderPlayerView(this.containerEl, this.plugin, this.session);
    } catch (e) {
      console.error("Roll for Initiative: player screen", e);
    }
  }
}

class ConfirmModal extends Modal {
  constructor(app, title, message, buttons) {
    super(app);
    this.titleText = title;
    this.message = message;
    this.buttons = buttons; // [{ text, value, cta, warning }]
    this.result = null;
    this.promise = new Promise((res) => (this.resolve = res));
  }
  onOpen() {
    this.titleEl.setText(this.titleText);
    this.contentEl.createEl("p", { text: this.message });
    const row = new Setting(this.contentEl);
    for (const b of this.buttons) {
      row.addButton((btn) => {
        btn.setButtonText(b.text).onClick(() => { this.result = b.value; this.close(); });
        if (b.cta) btn.setCta();
        if (b.warning) btn.setWarning();
      });
    }
  }
  onClose() {
    this.contentEl.empty();
    this.resolve(this.result);
  }
  ask() {
    this.open();
    return this.promise;
  }
}

// ---------------------------------------------------------------------------
// Atlas VTT link
//  - reads Atlas encounters (atlas-vtt/collections/*/encounters/*.json)
//  - live-syncs the running fight with open Atlas maps: initiative order,
//    current turn, round, HP and conditions go onto the map tokens; HP and
//    conditions changed on the map come back. Atlas has no public API yet, so
//    this talks to an open map's own store (the same one "Connect for Atlas
//    VTT" uses). Everything is wrapped so an Atlas change can't break combat.
// ---------------------------------------------------------------------------

const ATLAS_ID = "atlas-vtt";

const imageBaseName = (p) => {
  const file = String(p || "").split("/").pop().replace(/\.[a-z0-9]+$/i, "");
  return file.replace(/_\d{10,}_[a-z0-9]+$/i, "").replace(/_/g, " ").trim();
};

/** Find the character sheet a token stands for (by name, first name or the
 *  token image's file name). `sheets` = combatantIndex() PC items. */
function matchSheet(sheets, candidates) {
  const norm = (s) => String(s || "").trim().toLowerCase();
  const cands = candidates.map(norm).filter((s) => s && s !== "token");
  for (const c of cands) {
    const hit = sheets.find((s) => norm(s.name) === c || norm(s.file.basename) === c);
    if (hit) return hit;
  }
  for (const c of cands) {
    const first = c.split(/\s+/)[0];
    const hit = sheets.find((s) => norm(s.name).split(/\s+/)[0] === first || norm(s.file.basename).split(/\s+/)[0] === first);
    if (hit) return hit;
  }
  return null;
}

/** Atlas encounter JSON -> roll-encounter spec (pure, testable). */
function atlasEncounterToSpec(json, { sheets, fileFor, isSheetFile, linkFor }) {
  const rec = json.atlasRecord || {};
  const spec = { name: rec.name || "Atlas encounter", party: "", playersMode: "list", players: [], creatures: [], rollHP: false, atlas: { id: rec.id, collection: rec.collection } };
  const seenPlayers = new Set();
  const byKey = new Map();
  for (const t of Array.isArray(json.tokens) ? json.tokens : []) {
    const st = t.state || {};
    const name = st.name || t.name || "";
    const sbPath = t.statblockPath || st.statblockPath || null;
    const file = sbPath ? fileFor(sbPath) : null;
    let sheet = null;
    if (file && isSheetFile(file)) sheet = sheets.find((s) => s.file.path === file.path) || { file, name: file.basename };
    if (!sheet && !file) sheet = matchSheet(sheets, [name, t.name, imageBaseName(st.imagePath || t.imagePath)]);
    if (sheet) {
      if (seenPlayers.has(sheet.file.path)) continue;
      seenPlayers.add(sheet.file.path);
      spec.players.push({ name: sheet.name, link: linkFor(sheet.file), isLink: true });
      continue;
    }
    if (file) {
      const key = file.path;
      if (byKey.has(key)) byKey.get(key).count++;
      else {
        const c = { count: 1, name: file.basename, link: linkFor(file), isLink: true };
        byKey.set(key, c);
        spec.creatures.push(c);
      }
      continue;
    }
    if (!name || name === "Token") continue;
    const base = name.replace(/\s+\d+$/, "");
    const key = "name:" + base.toLowerCase();
    if (byKey.has(key)) byKey.get(key).count++;
    else {
      const c = { count: 1, name: base, isLink: false };
      byKey.set(key, c);
      spec.creatures.push(c);
    }
  }
  return spec;
}

class AtlasLink {
  constructor(plugin) {
    this.plugin = plugin;
    this.app = plugin.app;
    this.views = new Map(); // view -> { unsub, viewId }
    this.maps = new Map(); // `${viewId}|${fightKey}` -> Map(combatantName -> tokenId)
    this.pushed = new Map(); // tokenId -> { hp, max, conds: Set }
    this.pushing = false;
    this.conditionIds = null; // name(lower) -> id
    this.pullTimer = null;
  }

  get root() {
    return (this.plugin.settings.atlasFolder || "atlas-vtt").replace(/\/+$/, "");
  }
  get installed() {
    const p = this.app.plugins && this.app.plugins.plugins;
    return !!(p && p[ATLAS_ID]);
  }

  // ---- encounters (files) ----

  async listEncounters() {
    const out = [];
    const adapter = this.app.vault.adapter;
    const base = `${this.root}/collections`;
    try {
      if (!(await adapter.exists(base))) return out;
      const cols = await adapter.list(base);
      for (const col of cols.folders) {
        const encDir = `${col}/encounters`;
        if (!(await adapter.exists(encDir))) continue;
        const files = await adapter.list(encDir);
        for (const f of files.files.filter((x) => x.endsWith(".json"))) {
          try {
            const json = JSON.parse(await adapter.read(f));
            const rec = json.atlasRecord || {};
            out.push({
              path: f,
              json,
              id: rec.id || f,
              name: rec.name || f.split("/").pop(),
              collection: rec.collection || col.split("/").pop(),
              count: Array.isArray(json.tokens) ? json.tokens.length : 0,
              modifiedAt: rec.modifiedAt || 0,
              difficulty: json.difficulty,
            });
          } catch (e) {
            console.warn("Roll for Initiative: couldn't read Atlas encounter", f, e);
          }
        }
      }
    } catch (e) {
      console.warn("Roll for Initiative: couldn't list Atlas encounters", e);
    }
    return out.sort((a, b) => b.modifiedAt - a.modifiedAt);
  }

  specFromEncounter(enc) {
    const mc = this.app.metadataCache;
    const sheets = this.plugin.combatantIndex().filter((x) => x.pc);
    return atlasEncounterToSpec(enc.json, {
      sheets,
      fileFor: (p) => {
        const f = this.app.vault.getAbstractFileByPath(obsidian.normalizePath ? obsidian.normalizePath(p) : p);
        return f instanceof TFile ? f : null;
      },
      isSheetFile: (f) => this.plugin.bridge.isSheet((mc.getFileCache(f) || {}).frontmatter, f),
      linkFor: (f) => mc.fileToLinktext(f, "", true),
    });
  }

  pickEncounter(onPick) {
    this.listEncounters().then((list) => {
      if (!list.length) {
        new Notice(this.installed ? "No Atlas encounters found yet - save one in Atlas first." : "Atlas VTT isn't installed.");
        return;
      }
      new AtlasEncounterModal(this.app, list, onPick).open();
    });
  }

  // ---- live sync with open maps ----

  start() {
    const p = this.plugin;
    p.registerInterval(window.setInterval(() => this.tick(), 1500));
    p.registerEvent(this.app.workspace.on("layout-change", () => this.tick()));
    p.registerEvent(this.app.workspace.on("roll-initiative:change", () => this.tick()));
    p.register(() => this.detachAll());
  }

  mapViews() {
    const out = [];
    this.app.workspace.iterateAllLeaves((leaf) => {
      const v = leaf.view;
      const store = v && v.atlasStore;
      if (!store || typeof store.getState !== "function" || typeof store.subscribe !== "function") return;
      try {
        const st = store.getState();
        if (st.remoteView != null || !st.objects || !st.objects.tokens) return;
        out.push(v);
      } catch (e) { /* not ready */ }
    });
    return out;
  }

  detachAll() {
    for (const [, rec] of this.views) { try { rec.unsub(); } catch (e) { /* gone */ } }
    this.views.clear();
  }

  attach(view) {
    const have = this.views.get(view);
    if (have && have.store === view.atlasStore) return;
    if (have) { try { have.unsub(); } catch (e) { /* old store */ } this.views.delete(view); }
    const entryIds = () => {
      try { return new Set((view.atlasStore.getState().initiative.entries || []).map((e) => e.tokenId)); } catch (e) { return new Set(); }
    };
    const rec = { viewId: view.viewId || Math.random().toString(36).slice(2), store: view.atlasStore, entries: entryIds(), added: [], addTimer: null };
    rec.unsub = view.atlasStore.subscribe(() => {
      const now = entryIds();
      if (this.pushing) { rec.entries = now; return; }
      // Atlas's "Start fight" / "add to initiative" put new tokens into its
      // tracker: start (or join) the fight in Roll for Initiative too.
      const added = [...now].filter((id) => !rec.entries.has(id));
      rec.entries = now;
      if (added.length && this.plugin.settings.atlasStartsRoll) {
        rec.added.push(...added);
        if (rec.addTimer) clearTimeout(rec.addTimer);
        rec.addTimer = setTimeout(() => {
          const ids = rec.added.splice(0);
          rec.addTimer = null;
          this.onAtlasAdded(view, ids).catch((e) => console.warn("Roll for Initiative: couldn't start from Atlas", e));
        }, 500);
      }
      if (this.pullTimer) clearTimeout(this.pullTimer);
      this.pullTimer = setTimeout(() => this.pull(view), 200);
    });
    this.views.set(view, rec);
  }

  /** Tokens Atlas just added to its own initiative tracker. */
  async onAtlasAdded(view, tokenIds) {
    const st = view.atlasStore.getState();
    const tokens = st.objects.tokens || {};
    const toJson = (ids) => ids.map((id) => tokens[id]).filter(Boolean).map((t) => ({
      name: t.name, imagePath: t.imagePath, statblockPath: t.statblockPath,
      state: { name: t.name, imagePath: t.imagePath, statblockPath: t.statblockPath },
    }));
    const session = await this.plugin.syncSession();
    const running = session && session.isRunning();
    if (running) {
      const map = this.mapping(view, session);
      const mapped = new Set(map.values());
      const fresh = tokenIds.filter((id) => !mapped.has(id));
      if (!fresh.length) return;
      if (fresh.length === 1) {
        // one token joins the running fight
        const spec = this.specFromTokens(toJson(fresh), "");
        const lines = this.plugin.encounterLines(await this.plugin.resolveEncounter(spec, session.sourcePath));
        for (const l of lines) await session.addFromText(l);
        new Notice(`Added ${spec.players[0] ? spec.players[0].name : (spec.creatures[0] || {}).name || "a token"} from Atlas to the fight`);
        return;
      }
    }
    // a new fight: everyone in Atlas's tracker
    const all = (st.initiative.entries || []).map((e) => e.tokenId);
    const mapName = String(st.mapPath || "").split("/").pop().replace(/\.[a-z0-9]+$/i, "");
    const spec = this.specFromTokens(toJson(all), mapName ? `Fight - ${mapName}` : "Atlas fight");
    if (!spec.players.length && !spec.creatures.length) return;
    await this.plugin.startEncounter(spec, "");
  }

  specFromTokens(tokens, name) {
    const spec = this.specFromEncounter({ json: { atlasRecord: { name }, tokens } });
    spec.name = name;
    return spec;
  }

  async loadConditionIds() {
    if (this.conditionIds) return this.conditionIds;
    const ids = new Map();
    const pre = this.plugin.sys.atlasPrefix;
    for (const n of this.plugin.sys.conditions) ids.set(n.toLowerCase(), `${pre}${n.toLowerCase().replace(/\s+/g, "-")}`);
    if (this.plugin.sys.id === "dnd5e") ids.set("exhaustion", "dnd5e-exhaustion");
    try {
      const adapter = this.app.vault.adapter;
      const base = `${this.root}/collections`;
      if (await adapter.exists(base)) {
        for (const col of (await adapter.list(base)).folders) {
          const f = `${col}/collection.json`;
          if (!(await adapter.exists(f))) continue;
          const json = JSON.parse(await adapter.read(f));
          for (const c of ((json.settings || {}).conditions || [])) if (c && c.name && c.id) ids.set(String(c.name).toLowerCase(), c.id);
        }
      }
    } catch (e) { /* defaults are fine */ }
    this.conditionIds = ids;
    return ids;
  }

  fightKey(session) {
    return `${session.sourcePath}#${session.enc.id}`;
  }

  /** Pair combatants with tokens on this map (kept stable once paired). */
  mapping(view, session) {
    const rec = this.views.get(view);
    const key = `${rec ? rec.viewId : "v"}|${this.fightKey(session)}`;
    if (!this.maps.has(key)) this.maps.set(key, new Map());
    const map = this.maps.get(key);
    const tokens = view.atlasStore.getState().objects.tokens || {};
    const live = (id) => tokens[id] && tokens[id].offMap !== true;
    const names = new Set(session.enc.combatants.map((c) => c.name));
    for (const [n, id] of [...map]) if (!names.has(n) || !live(id)) map.delete(n);
    const used = new Set(map.values());
    const free = Object.values(tokens).filter((t) => t && t.offMap !== true && t.kind === "character" && !used.has(t.id));
    const take = (t) => { used.add(t.id); free.splice(free.indexOf(t), 1); return t.id; };
    const norm = (s) => String(s || "").trim().toLowerCase();
    const samePath = (a, b) => !!a && !!b && norm(decodeURIComponent(a)) === norm(decodeURIComponent(b));
    const sheets = this.plugin.combatantIndex().filter((x) => x.pc);
    for (const c of session.enc.combatants) {
      if (map.has(c.name)) continue;
      if (c.group) continue; // a group row has no single token on the map
      const r = session.r(c);
      let tok = null;
      if (r.kind === "creature" && r.path) {
        const cands = free.filter((t) => samePath(t.statblockPath, r.path));
        tok = cands.find((t) => norm(t.name) === norm(c.name)) || cands[0] || null;
      } else if (r.kind === "sheet") {
        tok = free.find((t) => {
          const m = matchSheet(sheets.filter((s) => s.file.path === r.path), [t.name, imageBaseName(t.imagePath)]);
          return !!m;
        }) || null;
      } else {
        tok = free.find((t) => norm(t.name) === norm(c.name)) || free.find((t) => norm(t.name) === norm(c.name.replace(/\s+\d+$/, ""))) || null;
      }
      if (tok) map.set(c.name, take(tok));
    }
    return map;
  }

  async tick() {
    if (this.busy) return;
    if (!this.plugin.settings.atlasSync || !this.installed) return;
    const views = this.mapViews();
    for (const v of [...this.views.keys()]) if (!views.includes(v)) { try { this.views.get(v).unsub(); } catch (e) { /* */ } this.views.delete(v); }
    if (!views.length) return;
    // Watch every open map even when no fight is running, so Atlas's own
    // "Start fight" can start one here.
    for (const v of views) this.attach(v);
    this.busy = true;
    try {
      const session = await this.plugin.syncSession();
      if (!session) return;
      const ids = await this.loadConditionIds();
      for (const v of views) this.push(v, session, ids);
    } catch (e) {
      console.warn("Roll for Initiative: Atlas sync failed", e);
    } finally {
      this.busy = false;
    }
  }

  push(view, session, ids) {
    const store = view.atlasStore;
    const map = this.mapping(view, session);
    if (!map.size) return;
    this.pushing = true;
    try {
      const S = () => store.getState();
      // HP + conditions
      for (const c of session.enc.combatants) {
        const id = map.get(c.name);
        if (!id) continue;
        const tok = S().objects.tokens[id];
        if (!tok) continue;
        const s = session.stat(c);
        const res = tok.resources || {};
        const hp = res.hp || {};
        if (s.hp !== undefined && (hp.current !== s.hp || (s.maxHp !== undefined && hp.max !== s.maxHp))) {
          S().updateToken(id, { resources: { ...res, hp: { ...hp, current: s.hp, max: s.maxHp ?? hp.max ?? s.hp } } });
        }
        const want = new Set();
        for (const cond of s.conditions || []) {
          const cid = ids.get(String(cond.name).toLowerCase());
          if (cid) want.add(cid);
        }
        const exhId = ids.get("exhaustion");
        const have = new Set(tok.conditions || []);
        for (const cid of want) if (!have.has(cid) && typeof S().setTokensCondition === "function") S().setTokensCondition([id], cid, true);
        for (const cid of have) {
          if (cid === exhId) continue;
          const known = [...ids.values()].includes(cid);
          if (known && !want.has(cid) && typeof S().setTokensCondition === "function") S().setTokensCondition([id], cid, false);
        }
        if (exhId && typeof S().setTokensConditionValue === "function") {
          const lvl = s.exhaustion || 0;
          const on = (S().objects.tokens[id].conditions || []).includes(exhId);
          if (lvl > 0 && (!on || ((S().objects.tokens[id].conditionValues || {})[exhId] !== lvl))) S().setTokensConditionValue([id], exhId, lvl);
          else if (!lvl && on && typeof S().setTokensCondition === "function") S().setTokensCondition([id], exhId, false);
        }
        const after = S().objects.tokens[id];
        this.pushed.set(id, { hp: ((after.resources || {}).hp || {}).current, max: ((after.resources || {}).hp || {}).max, conds: new Set(after.conditions || []) });
      }
      // initiative order / turn / round
      const enc = session.enc;
      const ini = S().initiative;
      if (!ini || !Array.isArray(ini.entries)) return;
      if (session.isRunning()) {
        const ordered = enc.combatants.filter((c) => map.has(c.name) && !c.off);
        for (const c of ordered) {
          const id = map.get(c.name);
          const entry = S().initiative.entries.find((e) => e.tokenId === id);
          const s = session.stat(c);
          if (!entry) {
            const tok = S().objects.tokens[id];
            S().addToInitiative({
              tokenId: id,
              name: c.name,
              initiative: c.init ?? 0,
              awaitingInitiative: c.init === undefined,
              initiativeModifier: s.mod ?? 0,
              imagePath: tok && tok.imagePath,
              isNPC: !c.player,
              ...(tok && tok.statblockPath ? { statblockPath: tok.statblockPath } : {}),
            });
          } else if (c.init !== undefined && entry.initiative !== c.init) {
            S().updateInitiativeEntry(entry.id, { initiative: c.init, awaitingInitiative: false });
          }
        }
        // same order as ours
        ordered.forEach((c, i) => {
          const entries = S().initiative.entries;
          const from = entries.findIndex((e) => e.tokenId === map.get(c.name));
          if (from >= 0 && from !== i && typeof S().reorderInitiative === "function") S().reorderInitiative(from, i);
        });
        const cur = enc.combatants.find((c) => c.current);
        const curIdx = cur ? S().initiative.entries.findIndex((e) => e.tokenId === map.get(cur.name)) : -1;
        const i2 = S().initiative;
        if (!i2.isActive || i2.round !== enc.round || i2.currentIndex !== curIdx) {
          try {
            store.setState((d) => {
              d.initiative.isActive = true;
              d.initiative.round = enc.round;
              d.initiative.currentIndex = curIdx;
              d.initiative.entries.forEach((e, j) => { e.isActive = j === curIdx; });
            });
          } catch (e) {
            // Fallback without setState: flag the active entry only.
            for (const e2 of S().initiative.entries) S().updateInitiativeEntry(e2.id, { isActive: e2.tokenId === (cur && map.get(cur.name)) });
          }
        }
      } else if (ini.isActive && typeof S().endCombat === "function") {
        S().endCombat();
      }
    } finally {
      this.pushing = false;
    }
  }

  /** Something changed on the map: bring HP / conditions the GM changed
   *  there back into the fight (and onto character sheets). */
  async pull(view) {
    if (!this.plugin.settings.atlasSync) return;
    const session = await this.plugin.syncSession();
    if (!session || !this.views.has(view)) return;
    const ids = await this.loadConditionIds();
    const byId = new Map([...ids].map(([n, id]) => [id, n]));
    const map = this.mapping(view, session);
    const tokens = view.atlasStore.getState().objects.tokens;
    for (const c of session.enc.combatants) {
      const id = map.get(c.name);
      const tok = id && tokens[id];
      const last = id && this.pushed.get(id);
      if (!tok || !last) continue;
      const hp = (tok.resources || {}).hp || {};
      if (hp.current !== undefined && hp.current !== last.hp) {
        last.hp = hp.current;
        await session.setHpFromMap(c, hp.current, hp.max !== last.max ? hp.max : undefined);
        last.max = hp.max;
      }
      const now = new Set(tok.conditions || []);
      const added = [...now].filter((x) => !last.conds.has(x));
      const removed = [...last.conds].filter((x) => !now.has(x));
      last.conds = now;
      for (const cid of added) { const n = byId.get(cid); if (n && n !== "exhaustion") await session.addCondition(c, capitalize(n)); }
      for (const cid of removed) { const n = byId.get(cid); if (n && n !== "exhaustion") await session.removeCondition(c, capitalize(n)); }
    }
  }
}

class AtlasEncounterModal extends SuggestModal {
  constructor(app, list, onPick) {
    super(app);
    this.list = list;
    this.onPick = onPick;
    this.setPlaceholder("Atlas encounter…");
  }
  getSuggestions(q) {
    const s = q.toLowerCase();
    return this.list.filter((e) => `${e.name} ${e.collection}`.toLowerCase().includes(s));
  }
  renderSuggestion(e, el) {
    el.addClass("ri-suggest");
    el.createSpan({ cls: "ri-suggest-name", text: e.name });
    el.createSpan({ cls: "ri-suggest-kind", text: `${e.collection} · ${e.count} token${e.count === 1 ? "" : "s"}` });
  }
  onChooseSuggestion(e) {
    this.onPick(e);
  }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

class InitiativeSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    const p = this.plugin;
    const toggle = (name, desc, key) =>
      new Setting(containerEl).setName(name).setDesc(desc).addToggle((t) =>
        t.setValue(!!p.settings[key]).onChange(async (v) => { p.settings[key] = v; await p.saveSettings(); }));

    new Setting(containerEl)
      .setName("Game system")
      .setDesc("Which rules the tracker uses in this vault: initiative die, armor, conditions, wounds, death saves and difficulty.")
      .addDropdown((d) => {
        for (const sys of Object.values(SYSTEMS)) d.addOption(sys.id, sys.name);
        d.setValue(p.sys.id).onChange(async (v) => {
          p.settings.system = v;
          p.resetCaches();
          await p.saveSettings();
          this.display();
        });
      });

    if (p.sys.id === "cpred") {
      new Setting(containerEl).setName("Cyberpunk RED notes").setHeading();
      containerEl.createEl("p", {
        cls: "setting-item-description",
        text: "Initiative 1d10 + REF · armor as SP head / body (ablates on penetrating hits, head hits ×2) · Seriously / Mortally Wounded applied from HP · Death Saves under BODY. Players and NPCs keep their stats in note properties: hp, ref, body, dex, sp_head, sp_body (players also hp_current, role, rank).",
      });
      const folder = (name, desc, key, ph) => new Setting(containerEl).setName(name).setDesc(desc).addText((t) =>
        t.setPlaceholder(ph).setValue(p.settings[key] || "").onChange(async (v) => { p.settings[key] = v.trim(); p.resetCaches(); await p.saveSettings(); }));
      folder("Players folder", "Notes here are player characters: live-synced (HP, SP, conditions, death saves are written back). Notes with type: player work anywhere.", "playersFolder", "Players");
      folder("NPC folder", "Notes here start out neutral (yellow). Notes with type: npc work anywhere.", "npcFolder", "4. NPC");
      toggle("Live-sync player characters", "Read and write HP, SP, conditions and death saves on player notes.", "syncPlayers");
    } else {
      new Setting(containerEl).setName("Character sheet").setHeading();
      const sheet = p.bridge.sheetPlugin;
      containerEl.createEl("p", {
        cls: "setting-item-description",
        text: sheet
          ? `Connected to One DnD Character Sheet. Party groups and the monster library come from its settings (data folder: ${p.bridge.dataFolder}).`
          : "One DnD Character Sheet isn't enabled - player characters will be tracked inside the block instead of live.",
      });
      toggle("Live-sync player characters", "HP, temp HP, AC, conditions and death saves are read from and written to the character sheet.", "syncPlayers");
    }

    new Setting(containerEl).setName("Combat").setHeading();
    if (p.sys.id === "dnd5e") toggle("Roll monster HP", "Roll hit points from the statblock's hit dice instead of using the average.", "rollHp");
    toggle("Group initiative", "Creatures added together (2x [[Goblin]]) share one initiative roll.", "groupInitiative");
    toggle("Ask players for initiative", "Roll opens a window to type each player's roll. Off: players keep the initiative already in the block, anyone without one is rolled (like Quick Initiative).", "askPlayerInitiative");
    toggle("Always reroll players", "Roll ignores players' existing initiative and rolls for them too.", "autoRollPlayers");
    toggle("Skip monsters at 0 HP", "Next turn skips monsters that are down. Players are never skipped (death saves).", "skipDown");
    if (p.sys.id === "dnd5e") toggle("Concentration reminder", "Show the Constitution save DC when a concentrating creature takes damage.", "concentrationReminder");
    if (p.sys.id === "dnd5e") toggle("Show encounter difficulty", "2024 XP budget from party levels and monster CR.", "showDifficulty");
    toggle("Open sidebar when combat starts", "Rolling initiative in a note also shows it in the sidebar.", "openSidebarOnStart");
    toggle("End combat when all enemies are down", "Marks the initiative as ended as soon as every enemy (red) is at 0 HP. Off: end it yourself with the ■ button.", "autoEnd");

    new Setting(containerEl).setName("Armies & minions (groups)").setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "A group is one initiative row for many identical creatures with a shared HP pool (HP each × how many). Make one with the 👥 button on an encounter card (creatures with a count above 1), by typing \"40 gob group\" in the add box, or by right-clicking creatures in a fight → Fight as one group. Damage comes off the pool; Area hits several members at once.",
    });
    const numSetting = (name, desc, key, ph) => new Setting(containerEl).setName(name).setDesc(desc).addText((t) => {
      t.inputEl.type = "number";
      t.setPlaceholder(ph).setValue(p.settings[key] ? String(p.settings[key]) : "").onChange(async (v) => {
        const n = parseInt(v, 10);
        p.settings[key] = Number.isFinite(n) && n > 1 ? n : 0;
        await p.saveSettings();
      });
    });
    numSetting("Group size", "When a creature is run as a group, split it into groups of this many (50 goblins with 10 = 5 groups of 10). Empty = everyone in one group. Each card can still pick its own size from the 👥 button.", "defaultGroupSize", "everyone");
    numSetting("Group automatically from", "Creatures with at least this count start as a group on encounter cards (e.g. 8). Empty = never; turn it on per creature with the 👥 button.", "autoGroupFrom", "off");
    toggle("Show casualties", "Float a −1 / −3 over a group's HP bar when members go down (and +N when they get back up).", "showCasualties");

    new Setting(containerEl).setName("Player screen").setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: p.screenPlugin
        ? "TTRPG Tools - Player Screen is enabled. Use the monitor button in the tracker (or the \"Show initiative on player screen\" command): your players see the order, turns, conditions and groups live - never HP numbers or AC, and nothing you've hidden."
        : "Install and enable \"TTRPG Tools - Player Screen\" to show the initiative to your players on a second screen.",
    });
    new Setting(containerEl)
      .setName("Health bars on the player screen")
      .setDesc("The coloured bar under each name (it shows how hurt someone is, never the numbers).")
      .addDropdown((d) => {
        d.addOption("all", "Everyone");
        d.addOption("players", "Player characters only");
        d.addOption("none", "Nobody");
        d.setValue(p.settings.playerScreenBars || "all").onChange(async (v) => { p.settings.playerScreenBars = v; await p.saveSettings(); });
      });

    new Setting(containerEl).setName("Encounters").setHeading();
    new Setting(containerEl)
      .setName("Encounters folder")
      .setDesc("Where new combat encounter notes go (the swords icon in the left ribbon, or the \"New encounter note\" command). Empty = the vault root.")
      .addText((t) => t.setPlaceholder("Encounters").setValue(p.settings.encounterFolder || "").onChange(async (v) => {
        p.settings.encounterFolder = v.trim();
        await p.saveSettings();
      }))
      .addButton((b) => b.setButtonText("New combat").onClick(() => new CombatWizardModal(p).open()));

    new Setting(containerEl).setName("Atlas VTT").setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: p.atlas && p.atlas.installed
        ? "Atlas VTT is installed. Encounter cards can import Atlas encounters, and a running fight can mirror onto open Atlas maps."
        : "Atlas VTT isn't enabled - these options do nothing until it is.",
    });
    toggle("Live-sync with open Atlas maps", "While a fight runs: initiative order, current turn, round, HP and conditions go onto the matching map tokens, and HP / conditions changed on the map come back (to character sheets too). Uses Atlas internals - if an Atlas update changes them, turn this off.", "atlasSync");
    toggle("Atlas \"Start fight\" starts Roll for Initiative", "When Atlas adds an encounter to its initiative tracker (Start fight / Add to initiative), the same fight starts here: rolled, in the sidebar and the Roll Initiative note. A single token added mid-fight joins the running fight.", "atlasStartsRoll");
    new Setting(containerEl)
      .setName("Atlas folder")
      .setDesc("Where Atlas keeps its library in this vault.")
      .addText((t) => t.setPlaceholder("atlas-vtt").setValue(p.settings.atlasFolder).onChange(async (v) => {
        p.settings.atlasFolder = v.trim() || "atlas-vtt";
        p.atlas.conditionIds = null;
        await p.saveSettings();
      }));

    new Setting(containerEl).setName("Roll Initiative note").setHeading();
    toggle("Open the Roll Initiative note", "On: Roll Initiative on an encounter opens the combat note (with the tracker in it) next to the sidebar. Off: only the sidebar opens - the note is still kept in the background.", "openCombatNote");
    new Setting(containerEl)
      .setName("Note path")
      .setDesc("The single note every encounter's Roll Initiative writes the combat into.")
      .addText((t) => t.setPlaceholder("Roll Initiative.md").setValue(p.settings.combatNote).onChange(async (v) => {
        p.settings.combatNote = v.trim() || "Roll Initiative.md";
        await p.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Monster folder")
      .setDesc("Used by the Browse button. Empty = the character sheet's monster library folder.")
      .addText((t) => t.setPlaceholder(p.bridge.monsterFolder() || "Bestiary").setValue(p.settings.monsterFolder).onChange(async (v) => {
        p.settings.monsterFolder = v.trim();
        await p.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Fallback party")
      .setDesc("Used by a bare 'party' line when the character sheet has no party groups. One per line: [[Dexar]] or 'Aria player hp 31 ac 16 init +3'.")
      .addTextArea((t) => {
        t.setValue(p.settings.party).onChange(async (v) => { p.settings.party = v; await p.saveSettings(); });
        t.inputEl.rows = 5;
      });
  }
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const TEMPLATE = "```" + BLOCK + "\nname New encounter\nparty\n2x [[Goblin Warrior]]\n```\n";
const ENCOUNTER_TEMPLATE = "```" + ENCOUNTER_BLOCK + "\n```\n";

class RollInitiativePlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.resolver = new CreatureResolver(this);
    this.atlas = new AtlasLink(this);
    this.app.workspace.onLayoutReady(() => this.atlas.start());

    this.registerView(VIEW_TYPE, (leaf) => new InitiativeView(leaf, this));
    this.registerView(STATBLOCK_VIEW, (leaf) => new StatblockView(leaf, this));
    this.registerHoverLinkSource(VIEW_TYPE, { display: "Roll Initiative", defaultMod: true });

    this.registerMarkdownCodeBlockProcessor(BLOCK, (source, el, ctx) => {
      ctx.addChild(new BlockChild(this, el, ctx, source));
    });
    this.registerMarkdownCodeBlockProcessor(ENCOUNTER_BLOCK, (source, el, ctx) => {
      ctx.addChild(new EncounterCard(this, el, ctx, source));
    });
    this.registerMarkdownCodeBlockProcessor(PLAYER_BLOCK, (_source, el, ctx) => {
      ctx.addChild(new PlayerScreenChild(this, el));
    });

    this.addRibbonIcon("swords", "New combat: encounter or initiative", () => new CombatWizardModal(this).open());

    this.addCommand({ id: "insert-combat-block", name: "Insert combat block", editorCallback: (editor) => editor.replaceSelection(TEMPLATE) });
    this.addCommand({ id: "insert-encounter-block", name: "Insert encounter block", editorCallback: (editor) => editor.replaceSelection(ENCOUNTER_TEMPLATE) });
    this.addCommand({ id: "new-combat", name: "New combat (encounter or initiative)", callback: () => new CombatWizardModal(this).open() });
    this.addCommand({ id: "show-on-player-screen", name: "Show initiative on player screen", callback: () => this.showOnPlayerScreen() });
    this.addCommand({ id: "new-encounter-note", name: "New encounter note", callback: () => new CombatWizardModal(this, "encounter").open() });
    this.addCommand({ id: "new-initiative-text", name: "New initiative (text to paste)", callback: () => new CombatWizardModal(this, "initiative").open() });
    this.addCommand({
      id: "open-combat-note",
      name: "Open Roll Initiative note",
      callback: async () => {
        const f = this.app.vault.getAbstractFileByPath(this.combatNotePath());
        if (f instanceof TFile) await this.openNote(f);
        else new Notice("No combat yet - press Roll Initiative on an encounter.");
      },
    });
    this.addCommand({ id: "open-sidebar", name: "Open initiative sidebar", callback: () => this.revealView() });
    this.addCommand({
      id: "run-current-note",
      name: "Run combat from current note in sidebar",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        if (checking) return true;
        this.runFirstBlockOf(file);
        return true;
      },
    });
    this.addCommand({
      id: "start-atlas-encounter",
      name: "Roll initiative for an Atlas encounter",
      callback: () => this.atlas.pickEncounter((enc) => this.startEncounter(this.atlas.specFromEncounter(enc), "")),
    });
    this.addCommand({
      id: "atlas-status",
      name: "Atlas VTT connection status",
      callback: () => {
        const views = this.atlas.mapViews();
        const lines = [
          `Atlas VTT: ${this.atlas.installed ? "installed" : "not found"}`,
          `Live sync: ${this.settings.atlasSync ? "on" : "off"} · Start fight → Roll: ${this.settings.atlasStartsRoll ? "on" : "off"}`,
          `Open Atlas maps: ${views.length} (watching ${this.atlas.views.size})`,
          ...views.map((v) => {
            const st = v.atlasStore.getState();
            return `· ${String(st.mapPath || "map").split("/").pop()}: ${Object.keys(st.objects.tokens || {}).length} tokens, ${(st.initiative.entries || []).length} in Atlas initiative`;
          }),
        ];
        new Notice(lines.join("\n"), 12000);
      },
    });
    this.addCommand({ id: "next-turn", name: "Next turn", callback: () => this.withActive((s) => s.step(1)) });
    this.addCommand({ id: "previous-turn", name: "Previous turn", callback: () => this.withActive((s) => s.step(-1)) });
    this.addCommand({ id: "end-combat", name: "End combat", callback: () => this.withActive((s) => s.endCombat()) });

    // Cache invalidation when notes change.
    this.registerEvent(this.app.metadataCache.on("changed", (file) => { this.resolver.cache.delete(file.path); this._index = null; }));
    this.registerEvent(this.app.vault.on("rename", () => { this._index = null; }));
    this.registerEvent(this.app.vault.on("delete", () => { this._index = null; }));

    this.addSettingTab(new InitiativeSettingTab(this.app, this));

    // Small public API for other plugins / scripts.
    this.api = {
      getActive: () => this.settings.active,
      next: () => this.withActive((s) => s.step(1)),
      previous: () => this.withActive((s) => s.step(-1)),
    };
  }

  onunload() {}

  /** The selected game system (Settings → Game system). */
  get sys() {
    return SYSTEMS[(this.settings && this.settings.system) || "dnd5e"] || SYSTEMS.dnd5e;
  }
  get bridge() {
    if (this._bridgeOverride) return this._bridgeOverride;
    if (this.sys.id === "cpred") return this._cyber || (this._cyber = new CyberBridge(this));
    return this._sheet || (this._sheet = new SheetBridge(this));
  }
  set bridge(b) {
    this._bridgeOverride = b;
  }
  initRoll() {
    return Math.floor(Math.random() * this.sys.initDie) + 1;
  }
  isNpc(file) {
    const folder = folderPath(this.settings.npcFolder);
    return isNpcNote(this.app, file) || !!(folder && file.path.startsWith(folder + "/"));
  }
  /** Settings changed in a way that changes how notes are read. */
  resetCaches() {
    this._index = null;
    if (this.resolver) this.resolver.cache.clear();
    if (this.atlas) this.atlas.conditionIds = null;
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) || {});
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }

  /** Replace the body of a roll-initiative block. */
  async writeBlock(path, locator, body) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return false;
    let ok = false;
    await this.app.vault.process(file, (data) => {
      const lines = data.split("\n");
      const loc = { id: locator.id };
      if (locator.getSection) {
        const info = locator.getSection();
        if (info) loc.lineStart = info.lineStart;
      }
      const block = findBlock(lines, loc);
      if (!block) return data;
      const newLines = body.split("\n").filter((l) => l.length).map((l) => block.prefix + l);
      lines.splice(block.start + 1, block.end - block.start - 1, ...newLines);
      ok = true;
      return lines.join("\n");
    });
    return ok;
  }

  announce(session) {
    this.lastSession = session;
    const cur = session.enc.combatants.find((c) => c.current);
    this.app.workspace.trigger("roll-initiative:change", {
      sourcePath: session.sourcePath,
      id: session.enc.id,
      name: session.enc.name,
      round: session.enc.round,
      current: cur ? cur.name : null,
      combatants: session.enc.combatants.map((c) => {
        const s = session.stat(c);
        return { name: c.name, link: c.link, init: c.init, hp: s.hp, maxHp: s.maxHp, ac: s.ac, player: c.player, live: s.live, conditions: (s.conditions || []).map((x) => x.name) };
      }),
    });
  }

  /** Cyberpunk RED: vault notes with `type: condition` (1. Pravidla/Stavy). */
  cpredConditionNotes() {
    const out = [];
    for (const f of this.app.vault.getMarkdownFiles()) {
      const fm = (this.app.metadataCache.getFileCache(f) || {}).frontmatter;
      if (fm && String(fm.type || "").toLowerCase() === "condition") out.push({ file: f, fm });
    }
    return out;
  }
  /** Is this condition a Critical Injury note (quality "Critical Injury (Head/Body)")? */
  criticalInjuryInfo(name) {
    if (this.sys.id !== "cpred") return null;
    const want = String(name || "").toLowerCase();
    const hit = this.cpredConditionNotes().find((n) => n.file.basename.toLowerCase() === want);
    if (!hit || !/^critical injury\b.+/i.test(String(hit.fm.quality || ""))) return null;
    return { name: hit.file.basename, base: toInt(hit.fm.death_save_penalty_base) || 0 };
  }
  conditionNames() {
    const names = new Set(this.sys.conditions);
    if (this.sys.id === "cpred") {
      for (const n of this.cpredConditionNotes()) names.add(n.file.basename);
      return [...names].sort();
    }
    if (this.sys.id !== "dnd5e") return [...names];
    for (const f of this.app.vault.getMarkdownFiles()) {
      const cache = this.app.metadataCache.getFileCache(f);
      if (!cache) continue;
      const tags = (obsidian.getAllTags && obsidian.getAllTags(cache)) || [];
      if (tags.includes("#Condition") && f.basename !== "Exhaustion" && f.basename !== "Stavy (Conditions)") names.add(f.basename);
    }
    return [...names].sort();
  }

  partyGroupNames() {
    const names = this.bridge.partyGroups().map((g) => g.name);
    if (!names.length && this.settings.party.trim()) names.push("Party");
    return names;
  }

  /** Combatants for a `party` line / Party button. */
  partyMembers(group, sourcePath) {
    const groups = this.bridge.partyGroups();
    let g = null;
    if (group) g = groups.find((x) => x.name.toLowerCase() === group.toLowerCase());
    else g = groups[0] || null;
    if (g) return g.members.map((m) => ({ name: m.split("/").pop(), link: m, player: true, hidden: false, off: false, conditions: [], current: false }));
    return this.settings.party.split("\n").flatMap((l) => parseCombatantLine(l)).map((c) => ({ ...c, player: true, current: false }));
  }

  async startRoll(session) {
    const pcs = session.enc.combatants.filter((c) => c.player);
    const go = async (values) => {
      await session.rollInitiative(values);
      if (this.settings.openSidebarOnStart && !this.isActive(session)) await this.openInSidebar(session, false);
    };
    if (pcs.length && this.settings.askPlayerInitiative && !this.settings.autoRollPlayers) new PlayerInitModal(this, session, go).open();
    else await go(null);
  }

  isActive(session) {
    const a = this.settings.active;
    return !!a && a.path === session.sourcePath && a.id === session.enc.id;
  }

  async setActive(ref) {
    this.settings.active = ref;
    await this.saveSettings();
    this.app.workspace.trigger("roll-initiative:active-changed", ref);
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof InitiativeView) await leaf.view.load();
    }
  }

  async openInSidebar(session, focus = true) {
    if (!session.enc.id || session.dirty) await session.commit();
    if (!session.saved) {
      new Notice("Open the note itself so the combat block can be saved first.");
      return;
    }
    await this.setActive({ path: session.sourcePath, id: session.enc.id });
    await this.revealView(focus);
  }

  async revealView(focus = true) {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false);
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    if (focus) this.app.workspace.revealLeaf(leaf);
    return leaf;
  }

  async runFirstBlockOf(file) {
    const text = await this.app.vault.read(file);
    const block = findBlock(text.split("\n"), { first: true });
    if (!block) {
      new Notice("This note has no roll-initiative block.");
      return;
    }
    const session = new Session(this, file.path, { lineStart: block.start, getSection: () => ({ lineStart: block.start }) });
    await session.loadSource(block.body.join("\n"));
    await this.openInSidebar(session);
  }

  combatNotePath() {
    let p = (this.settings.combatNote || "Roll Initiative.md").trim();
    if (!p.toLowerCase().endsWith(".md")) p += ".md";
    return obsidian.normalizePath ? obsidian.normalizePath(p) : p;
  }

  /** Everything the add box can suggest: sheets, monster library, NPCs. */
  combatantIndex() {
    if (this._index) return this._index;
    const folder = folderPath(this.settings.monsterFolder || this.bridge.monsterFolder());
    const out = [];
    for (const f of this.app.vault.getMarkdownFiles()) {
      const fm = (this.app.metadataCache.getFileCache(f) || {}).frontmatter || {};
      if (this.bridge.isSheet(fm, f)) {
        const sub = this.sys.id === "cpred" ? [fm.role, fm.rank].filter(Boolean).join(" ") : fm.level ? `Lv ${fm.level}` : "";
        out.push({ file: f, name: fm.character_name || fm.name || f.basename, pc: true, kind: "PC", label: `PC${sub ? ` · ${sub}` : ""}` });
      } else if (folder && f.path.startsWith(folder + "/") && !/^\d+\.\s/.test(f.basename)) {
        const cr = normalizeCr(fm.CR ?? fm.cr);
        const label = this.sys.id === "cpred" ? (fm.threat ? String(fm.threat) : "Enemy") : cr !== undefined ? `CR ${cr}` : "Monster";
        out.push({ file: f, name: f.basename, pc: false, kind: "Monster", label });
      } else if (this.isNpc(f)) {
        out.push({ file: f, name: f.basename, pc: false, kind: "NPC", label: "NPC" });
      }
    }
    this._index = out;
    return out;
  }

  async showStatblockFor(spec) {
    const ws = this.app.workspace;
    let leaf = ws.getLeavesOfType(STATBLOCK_VIEW)[0];
    if (!leaf) {
      const tracker = ws.getLeavesOfType(VIEW_TYPE)[0];
      leaf = tracker && ws.createLeafBySplit ? ws.createLeafBySplit(tracker, "horizontal") : ws.getRightLeaf(false);
      await leaf.setViewState({ type: STATBLOCK_VIEW, active: false });
    }
    await ws.revealLeaf(leaf);
    if (leaf.loadIfDeferred) await leaf.loadIfDeferred();
    if (leaf.view instanceof StatblockView) await leaf.view.show(spec);
  }

  showStatblock(session, c) {
    const r = session.r(c);
    return this.showStatblockFor({
      file: r.kind === "creature" ? r.file : null,
      bestiaryName: r.kind === "bestiary" ? c.name.replace(/\s+\d+$/, "") : null,
      name: c.name,
      sourcePath: session.sourcePath,
    });
  }

  /** Resolve a roll-encounter spec against the vault (players, creature
   *  stats, difficulty) - used by the card and by Roll Initiative. */
  async resolveEncounter(spec, sourcePath) {
    const mc = this.app.metadataCache;
    const plan = { party: "", players: [], creatures: [], difficulty: null, rollHP: !!spec.rollHP };
    let members = [];
    if (spec.playersMode === "party") { members = this.partyMembers(spec.party, sourcePath); plan.party = spec.party; }
    else if (spec.playersMode === "default") {
      members = this.partyMembers("", sourcePath);
      const g = this.bridge.partyGroups()[0];
      plan.party = g ? g.name : "";
    } else if (spec.playersMode === "list") members = spec.players.map((p) => ({ name: p.name, link: p.isLink ? p.link : p.name, player: true }));
    for (const m of members) {
      const file = m.link ? mc.getFirstLinkpathDest(m.link.split("#")[0], sourcePath) : null;
      const fm = file ? (mc.getFileCache(file) || {}).frontmatter : null;
      if (file && this.bridge.isSheet(fm, file)) {
        const r = this.bridge.read(file);
        plan.players.push({ name: r.name, link: mc.fileToLinktext(file, sourcePath, true), file, level: r.level, cls: r.cls, image: r.image, hp: r.hp, maxHp: r.maxHp, ac: r.ac, sp: r.sp });
      } else plan.players.push({ name: m.name, link: file ? mc.fileToLinktext(file, sourcePath, true) : null, file, level: m.level });
    }
    for (const c of spec.creatures) {
      let file = null;
      if (c.link) file = mc.getFirstLinkpathDest(c.link.split("#")[0], sourcePath);
      else {
        const f = mc.getFirstLinkpathDest(c.name, sourcePath);
        if (f instanceof TFile) file = f;
      }
      let stats = {};
      if (file instanceof TFile) stats = await this.resolver.fromFile(file);
      else stats = this.resolver.fromBestiary(c.name) || {};
      const disp = c.disp || (file instanceof TFile && isNpcNote(this.app, file) ? "neutral" : "enemy");
      plan.creatures.push({ ...c, file: file instanceof TFile ? file : null, link: file instanceof TFile ? mc.fileToLinktext(file, sourcePath, true) : null, stats, disp });
    }
    const xp = [];
    for (const c of plan.creatures) {
      const each = c.xp ?? c.stats.xp;
      if (c.disp === "enemy" && each) for (let i = 0; i < (c.count || 1); i++) xp.push(each);
    }
    if (xp.length && this.sys.difficulty) plan.difficulty = difficulty(plan.players.map((p) => p.level).filter(Boolean), xp);
    return plan;
  }

  /** The fight the player screen shows: the active one (the GM's live copy if open). */
  async playerScreenSession() {
    const a = this.settings.active;
    const last = this.lastSession;
    if (last && (!a || (last.sourcePath === a.path && last.enc.id === a.id))) return last;
    return this.syncSession();
  }

  get screenPlugin() {
    return (this.app.plugins && this.app.plugins.plugins && this.app.plugins.plugins[SCREEN_PLUGIN_ID]) || null;
  }

  /** Send the live player view to TTRPG Tools - Player Screen. */
  async showOnPlayerScreen(session) {
    const sp = this.screenPlugin;
    const send = sp && (typeof sp.sendMarkdown === "function" ? sp.sendMarkdown.bind(sp) : sp.api && typeof sp.api.sendMarkdown === "function" ? sp.api.sendMarkdown.bind(sp.api) : null);
    if (!send) {
      new Notice("Install and enable \"TTRPG Tools - Player Screen\" to show the initiative to your players.", 6000);
      return false;
    }
    if (session) this.lastSession = session;
    const s = session || (await this.playerScreenSession());
    await send("```" + PLAYER_BLOCK + "\n```", s ? s.sourcePath : "");
    return true;
  }

  /** Remember a "-2" / "+1" to float over a group's HP bar for a moment. */
  flashCasualties(session, c, delta) {
    if (!this.settings.showCasualties || !delta) return;
    this.casualties = this.casualties || new Map();
    this.casualties.set(`${session.sourcePath}|${c.name}`, { delta, until: Date.now() + 2600 });
  }
  casualtyFor(session, c) {
    const k = `${session.sourcePath}|${c.name}`;
    const f = this.casualties && this.casualties.get(k);
    if (!f) return null;
    if (f.until < Date.now()) { this.casualties.delete(k); return null; }
    return f;
  }

  /** Is this card creature run as group(s)? Returns the group size
   *  (n = everyone in one group), or 0 for one row per creature. */
  groupingOf(c, n = c.count || 1) {
    if (n < 2) return 0;
    let g = c.group;
    if (g === undefined) g = this.settings.autoGroupFrom > 1 && n >= this.settings.autoGroupFrom;
    if (!g) return 0;
    if (typeof g === "number") return Math.min(g, n);
    const def = Number(this.settings.defaultGroupSize) || 0;
    return def > 1 ? Math.min(def, n) : n;
  }

  /** Full combat note text: the whole fight as a roll-initiative tracker
   *  (every player and creature on its own row, ready to roll). */
  async encounterNoteBody(spec, sourcePath = "") {
    const plan = await this.resolveEncounter(spec, sourcePath);
    const lines = [];
    if (spec.name) lines.push(`name ${spec.name}`);
    lines.push(...this.encounterLines(plan));
    return "```" + BLOCK + "\n" + lines.join("\n") + "\n```\n";
  }

  /** Compact prepared card (roll-encounter) to paste into any note. */
  initiativeCardText(spec) {
    const yaml = serializeEncounterSpec(spec);
    return "```" + ENCOUNTER_BLOCK + "\n" + (yaml ? yaml + "\n" : "") + "```\n";
  }

  /** New note in the encounters folder. `body` defaults to an empty encounter card. */
  async newEncounterNote(name, body) {
    const raw = folderPath(this.settings.encounterFolder);
    const norm = (x) => (obsidian.normalizePath ? obsidian.normalizePath(x) : x);
    const folder = raw ? norm(raw) : "";
    const clean = String(name || "").replace(/[\\/:*?"<>|#^[\]]/g, "").trim() || `Encounter ${new Date().toISOString().slice(0, 10)}`;
    if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
      try { await this.app.vault.createFolder(folder); } catch (e) { /* exists */ }
    }
    let path = norm(`${folder ? folder + "/" : ""}${clean}.md`);
    for (let i = 2; this.app.vault.getAbstractFileByPath(path); i++) path = norm(`${folder ? folder + "/" : ""}${clean} ${i}.md`);
    const file = await this.app.vault.create(path, `# ${clean}\n\n${body || `\`\`\`${ENCOUNTER_BLOCK}\nname: ${yamlStr(clean)}\n\`\`\`\n`}`);
    await this.app.workspace.getLeaf("tab").openFile(file, { active: true });
    return file;
  }

  /** Block lines (without header) for a resolved encounter. */
  encounterLines(plan) {
    const lines = [];
    for (const p of plan.players) lines.push(p.link ? `[[${p.link}]] player` : `${p.name} player`);
    for (const c of plan.creatures) {
      const n = c.countDice ? rollDice(c.countDice) || 1 : c.count;
      if (!n) continue;
      const base = c.link ? linkBasename(c.link) : "";
      const grouping = this.groupingOf(c, n);
      if (grouping) {
        // groups with a shared HP pool: one row each (50 goblins in groups of 10 = 5 rows)
        const chunks = groupChunks(n, grouping);
        const sb = c.stats || {};
        chunks.forEach((size, idx) => {
          const name = chunks.length > 1 ? `${c.name} ${idx + 1}` : c.name;
          const parts = [];
          if (!c.link || name !== base) parts.push(name);
          if (c.link) parts.push(`[[${c.link}]]`);
          if (size > 1) parts.push(`group ${size}`);
          if (c.hp !== undefined && sb.hp === undefined) parts.push(size > 1 ? `each ${c.hp}` : `hp ${c.hp}`);
          if (c.ac !== undefined && sb.ac === undefined) parts.push(`ac ${c.ac}`);
          if (c.mod !== undefined && sb.mod === undefined) parts.push(`mod ${signed(c.mod)}`);
          if (c.xp !== undefined) parts.push(`xp ${c.xp}`);
          if (c.hidden) parts.push("hidden");
          if (c.disp && c.disp !== "enemy") parts.push(c.disp);
          lines.push(parts.join(" "));
        });
        continue;
      }
      const hd = c.stats && c.stats.hitDice;
      if (plan.rollHP && hd && rollDice(hd) !== undefined) {
        // one line per creature, each with its own rolled HP
        for (let i = 1; i <= n; i++) {
          const name = n > 1 ? `${c.name} ${i}` : c.name;
          const parts = [];
          if (!c.link || name !== base) parts.push(name);
          if (c.link) parts.push(`[[${c.link}]]`);
          parts.push(`hp ${rollDice(hd)}`);
          if (c.xp !== undefined) parts.push(`xp ${c.xp}`);
          if (c.hidden) parts.push("hidden");
          if (c.disp && c.disp !== "enemy") parts.push(c.disp);
          lines.push(parts.join(" "));
        }
        continue;
      }
      const parts = [];
      if (n > 1) parts.push(`${n}x`);
      if (!c.link || c.name !== base) parts.push(c.name);
      if (c.link) parts.push(`[[${c.link}]]`);
      // A statblock's own numbers always win; typed hp/ac/mod are only for
      // creatures without one.
      const sb = c.stats || {};
      if (c.hp !== undefined && sb.hp === undefined) parts.push(`hp ${c.hp}`);
      if (c.ac !== undefined && sb.ac === undefined) parts.push(`ac ${c.ac}`);
      if (c.mod !== undefined && sb.mod === undefined) parts.push(`mod ${signed(c.mod)}`);
      if (c.xp !== undefined) parts.push(`xp ${c.xp}`);
      if (c.hidden) parts.push("hidden");
      if (c.disp && c.disp !== "enemy") parts.push(c.disp);
      lines.push(parts.join(" "));
    }
    return lines;
  }

  async openNote(file) {
    const ws = this.app.workspace;
    const open = ws.getLeavesOfType("markdown").find((l) => l.view && l.view.file && l.view.file.path === file.path);
    if (open) { ws.setActiveLeaf(open, { focus: true }); return; }
    await ws.getLeaf("tab").openFile(file, { active: true });
  }

  /** Roll Initiative from an encounter card: writes the single Roll
   *  Initiative note, asks before replacing a running combat, rolls, and
   *  opens the sidebar (+ the note, if enabled). */
  async startEncounter(spec, sourcePath) {
    const vault = this.app.vault;
    const path = this.combatNotePath();
    let file = vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      const block = findBlock((await vault.read(file)).split("\n"), { first: true });
      if (block) {
        const cur = parseBlock(block.body.join("\n"));
        if (cur.round > 0 && !cur.ended && cur.combatants.length) {
          const choice = await this.confirmOverwrite(cur);
          if (choice === "show") { await this.setActive({ path, id: cur.id }); await this.revealView(true); return; }
          if (choice !== "overwrite") return;
        }
      }
    }
    const plan = await this.resolveEncounter(spec, sourcePath);
    const id = randomId();
    const header = [spec.name ? `name ${spec.name}` : "name Encounter", `id ${id}`];
    const content = `# Roll Initiative\n\n\`\`\`${BLOCK}\n${[...header, ...this.encounterLines(plan)].join("\n")}\n\`\`\`\n`;
    if (file instanceof TFile) await vault.modify(file, content);
    else {
      const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      if (folder && !vault.getAbstractFileByPath(folder)) { try { await vault.createFolder(folder); } catch (e) { /* exists */ } }
      file = await vault.create(path, content);
    }
    await this.setActive({ path, id });
    if (this.settings.openCombatNote) await this.openNote(file);
    await this.revealView(true);
    const session = new Session(this, path, { id });
    if (await session.loadFromFile()) await this.startRoll(session);
  }

  /** The running fight (sidebar's session if open, else loaded from file). */
  async syncSession() {
    const a = this.settings.active;
    if (!a) return null;
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      const v = leaf.view;
      if (v instanceof InitiativeView && v.session && v.session.sourcePath === a.path && v.session.enc.id === a.id) return v.session;
    }
    const f = this.app.vault.getAbstractFileByPath(a.path);
    if (!(f instanceof TFile)) return null;
    const c = this._syncCache;
    if (c && c.path === a.path && c.id === a.id && c.mtime === f.stat.mtime) return c.session;
    const s = new Session(this, a.path, { id: a.id });
    if (!(await s.loadFromFile())) return null;
    this._syncCache = { path: a.path, id: a.id, mtime: f.stat.mtime, session: s };
    return s;
  }

  /** "overwrite" | "show" | null */
  confirmOverwrite(cur) {
    return new ConfirmModal(this.app, "Active initiative", `There is an active initiative already${cur.name ? ` (${cur.name}, round ${cur.round})` : ` (round ${cur.round})`}. Do you want to overwrite it?`, [
      { text: "Show current", value: "show" },
      { text: "Cancel", value: null },
      { text: "Overwrite", value: "overwrite", warning: true },
    ]).ask();
  }

  async withActive(fn) {
    const a = this.settings.active;
    if (!a) {
      new Notice("No combat is running in the sidebar.");
      return;
    }
    const view = this.app.workspace.getLeavesOfType(VIEW_TYPE).map((l) => l.view).find((v) => v instanceof InitiativeView && v.session);
    if (view) {
      await fn(view.session);
      return;
    }
    const session = new Session(this, a.path, { id: a.id });
    if (await session.loadFromFile()) await fn(session);
  }
}

module.exports = RollInitiativePlugin;
module.exports.default = RollInitiativePlugin;
module.exports._internals = {
  parseCombatantLine, parseBlock, serializeBlock, serializeCombatant, sortCombatants, stepTurn,
  tickDurations, rollDice, extractStatblock, looseYaml, statsFromCreature, xpForCr, normalizeCr,
  difficulty, sheetApplyDamage, sheetApplyHeal, sheetDeathSave, damageMonster, healMonster,
  findBlock, concentrationDc, Session, SheetBridge, CreatureResolver,
  parseEncounterCreature, parseEncounterSpec, isNpcNote, quoteLinks, serializeEncounterSpec, difficultyWord,
  atlasEncounterToSpec, matchSheet, imageBaseName, AtlasLink,
  SYSTEMS, CyberBridge, cpredHit, cpredWoundConditions, cpredDeathSave, statsFromCyberpunk, cpredInitMod,
  groupAlive, groupAreaHp, groupChunks, specAddText, folderPath, renderPlayerView, PlayerScreenChild,
};
