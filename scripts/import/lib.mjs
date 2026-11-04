import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

export const ROOT = path.resolve(import.meta.dirname, "../..");
const CACHE = path.join(ROOT, ".cache/sources");
const CRAWLER_HTTP = path.join(ROOT, ".cache/crawler/http");
const UA = "Mozilla/5.0 (Wakeru data importer; +https://github.com/)";
export const REFRESH = process.argv.includes("--refresh");

/* ---------- files and network ---------- */
export const readJSON = file => JSON.parse(fs.readFileSync(file, "utf8"));
export function writeJSON(file, data){
  fs.mkdirSync(path.dirname(file), {recursive:true});
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}
function readCrawlerHttpCache(url){
  try {
    const href = new URL(url).href;
    const body = path.join(CRAWLER_HTTP, `${crypto.createHash("sha256").update(href).digest("hex")}.body`);
    return fs.existsSync(body) ? fs.readFileSync(body) : null;
  } catch { return null }
}

/* downloads are cached in .cache/sources; bodies from npm run discover:official are reused from .cache/crawler/http */
export async function download(group, url, {headers: extra = {}} = {}){
  const file = path.join(CACHE, group, decodeURIComponent(new URL(url).pathname.split("/").pop()) || "index.html");
  if(!REFRESH && fs.existsSync(file)) return fs.readFileSync(file);
  if(!REFRESH){
    const crawled = readCrawlerHttpCache(url);
    if(crawled){
      fs.mkdirSync(path.dirname(file), {recursive:true});
      fs.writeFileSync(file, crawled);
      return crawled;
    }
  }
  const res = await fetch(url, {headers:{"User-Agent":UA, ...extra}});
  if(!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(file), {recursive:true});
  fs.writeFileSync(file, buf);
  return buf;
}
export function decode(buf, encoding = "UTF-8"){
  const label = /932|sjis|shift/i.test(encoding) ? "shift_jis" : "utf-8";
  return new TextDecoder(label).decode(buf).replace(/^\uFEFF/, "");
}
export const unzipFirst = buf => {
  const tmp = path.join(CACHE, `abr-${process.pid}-${Date.now()}.zip`);
  fs.mkdirSync(CACHE, {recursive:true});
  fs.writeFileSync(tmp, buf);
  try { return execFileSync("unzip", ["-p", tmp], {maxBuffer:64 << 20}) }
  finally { fs.rmSync(tmp, {force:true}) }
};

/* ---------- CSV and HTML tables ---------- */
export function parseCSV(text){
  const rows = []; let row = [], cell = "", q = false;
  for(let i = 0; i < text.length; i++){
    const c = text[i];
    if(q){ if(c === '"'){ if(text[i+1] === '"'){ cell += '"'; i++ } else q = false } else cell += c; continue }
    if(c === '"') q = true;
    else if(c === ",") { row.push(cell); cell = "" }
    else if(c === "\n" || c === "\r"){ if(c === "\r" && text[i+1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = "" }
    else cell += c;
  }
  if(cell || row.length){ row.push(cell); rows.push(row) }
  return rows.filter(r => r.some(c => c.trim()));
}
/* rows of objects keyed by the header row */
export function csvObjects(text){
  const [head, ...rows] = parseCSV(text);
  const keys = head.map(h => h.trim());
  return rows.map(r => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}
const ENTITIES = {amp:"&", lt:"<", gt:">", quot:'"', nbsp:" ", "#39":"'"};
export const htmlText = s => s.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")
  .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => e[0] === "#" ? String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENTITIES[e] ?? m)
  .replace(/[ \t]+/g, " ").trim();
/* every <table> as a grid of cell texts, with rowspan/colspan expanded */
export function htmlTables(html){
  return [...html.matchAll(/<table[\s\S]*?<\/table>/gi)].map(([t]) => {
    const grid = [];
    [...t.matchAll(/<tr[\s\S]*?<\/tr>/gi)].forEach(([tr], r) => {
      grid[r] ??= [];
      let c = 0;
      for(const [, attrs, inner] of tr.matchAll(/<t[dh]([^>]*)>([\s\S]*?)<\/t[dh]>/gi)){
        while(grid[r][c] !== undefined) c++;
        const rs = +(attrs.match(/rowspan="?(\d+)/i)?.[1] ?? 1), cs = +(attrs.match(/colspan="?(\d+)/i)?.[1] ?? 1), text = htmlText(inner);
        for(let i = 0; i < rs; i++) for(let j = 0; j < cs; j++) (grid[r+i] ??= [])[c+j] = text;
        c += cs;
      }
    });
    return grid.map(row => [...row].map(x => x ?? ""));
  });
}

/* ---------- Japanese text ---------- */
const KANJI_DIGIT = {〇:0, 一:1, 二:2, 三:3, 四:4, 五:5, 六:6, 七:7, 八:8, 九:9};
/* kanji numbers up to 99 → digits ("二十三" → "23"); leaves words like 一部 alone */
export function kanjiToDigits(s){
  return s.replace(/(?<![一二三四五六七八九十])([一二三四五六七八九]?十[一二三四五六七八九]?|[〇一二三四五六七八九])(?=丁目|番|号|[・、〜～から]|$)/g, m => {
    if(!m.includes("十")) return String(KANJI_DIGIT[m]);
    const [a, b] = m.split("十");
    return String((a ? KANJI_DIGIT[a] : 1) * 10 + (b ? KANJI_DIGIT[b] : 0));
  });
}
export const norm = s => kanjiToDigits((s ?? "").normalize("NFKC").replace(/[〜~]/g, "～").replace(/\s+/g, " ").trim());

const DAYS = "日月火水木金土";
/* one schedule cell → a rule: [weekdays] weekly, {day, weeks} for nth weekdays */
export function parseRule(cell){
  const s = (cell ?? "").normalize("NFKC").replace(/\s+/g, "").replace(/^その月の/, "").replace(/曜日?/g, "");
  if(!s) return null;
  const days = [...s].filter(ch => DAYS.includes(ch)).map(ch => DAYS.indexOf(ch));
  if(!days.length) throw new Error(`no weekday in "${cell}"`);
  if(/第|回目|^\d/.test(s)){
    const weeks = [...s.replace(/[日月火水木金土].*$/, "").matchAll(/\d/g)].map(m => +m[0]);
    if(!weeks.length || days.length !== 1) throw new Error(`can't read nth-weekday rule "${cell}"`);
    return {day:days[0], weeks};
  }
  const range = s.match(/([日月火水木金土])[~〜\-ー]([日月火水木金土])/);
  if(range){ const a = DAYS.indexOf(range[1]), b = DAYS.indexOf(range[2]); return Array.from({length:b-a+1}, (_, i) => a + i) }
  return [...new Set(days)].sort((a, b) => a - b);
}

/* ---------- official town list (Digital Agency Address Base Registry, CC BY 4.0) ---------- */
const ABR = {};
/* active town rows of one prefecture ("13" = Tokyo) */
export async function abrRows(pref){
  const url = `https://data.address-br.digital.go.jp/mt_town/pref/mt_town_pref${pref}.csv.zip`;
  return ABR[pref] ??= csvObjects(decode(unzipFirst(await download("shared", url)))).filter(r => !r.ablt_date);
}
/* official towns of a municipality (or of one ward of a designated city): Map town → {jp, kana, en, chome:[]} */
export async function townRegistry(cityJp, {pref = "13", ward = ""} = {}){
  const towns = new Map();
  for(const r of (await abrRows(pref)).filter(r => r.city === cityJp && (!ward || r.ward === ward))){
    const t = towns.get(r.oaza_cho) ?? {jp:r.oaza_cho, kana:r.oaza_cho_kana, en:townEn(r), chome:[]};
    if(r.chome_number) t.chome.push(+r.chome_number);
    towns.set(r.oaza_cho, t);
  }
  for(const t of towns.values()) t.chome.sort((a, b) => a - b);
  return towns;
}
/* registry romaji runs compound names together (Nihombashiningyocho); split the two big historic prefixes so they read like street signs */
const PREFIXES = [["日本橋", "Nihombashi"], ["神田", "Kanda"]];
function townEn(r){
  const en = r.oaza_cho_roma || kanaToRomaji(r.oaza_cho_kana);
  const [jp, roma] = PREFIXES.find(([jp, roma]) => r.oaza_cho.startsWith(jp) && r.oaza_cho !== jp && en.startsWith(roma)) ?? [];
  return jp ? `${roma} ${en.charAt(roma.length).toUpperCase()}${en.slice(roma.length + 1)}` : en;
}
/* longest official town name at the start of an address string */
export function splitTown(address, towns){
  const s = address.normalize("NFKC").trim();
  const town = [...towns.keys()].filter(t => s.startsWith(t)).sort((a, b) => b.length - a.length)[0];
  if(!town) throw new Error(`unknown town in "${address}"`);
  return [town, s.slice(town.length)];
}

const KANA = {ア:"a",イ:"i",ウ:"u",エ:"e",オ:"o",カ:"ka",キ:"ki",ク:"ku",ケ:"ke",コ:"ko",サ:"sa",シ:"shi",ス:"su",セ:"se",ソ:"so",タ:"ta",チ:"chi",ツ:"tsu",テ:"te",ト:"to",ナ:"na",ニ:"ni",ヌ:"nu",ネ:"ne",ノ:"no",ハ:"ha",ヒ:"hi",フ:"fu",ヘ:"he",ホ:"ho",マ:"ma",ミ:"mi",ム:"mu",メ:"me",モ:"mo",ヤ:"ya",ユ:"yu",ヨ:"yo",ラ:"ra",リ:"ri",ル:"ru",レ:"re",ロ:"ro",ワ:"wa",ヲ:"o",ン:"n",ガ:"ga",ギ:"gi",グ:"gu",ゲ:"ge",ゴ:"go",ザ:"za",ジ:"ji",ズ:"zu",ゼ:"ze",ゾ:"zo",ダ:"da",ヂ:"ji",ヅ:"zu",デ:"de",ド:"do",バ:"ba",ビ:"bi",ブ:"bu",ベ:"be",ボ:"bo",パ:"pa",ピ:"pi",プ:"pu",ペ:"pe",ポ:"po",ヴ:"vu"};
const SMALL = {ャ:"ya",ュ:"yu",ョ:"yo"};
/* Hepburn without macrons, the way Tokyo street signs write town names (トヨス → Toyosu, キタシナガワ → Kitashinagawa) */
export function kanaToRomaji(kana){
  let out = "";
  const k = [...(kana || "")];
  for(let i = 0; i < k.length; i++){
    const ch = k[i], next = k[i+1];
    if(ch === "ッ"){ out += (KANA[next] ?? "")[0] ?? ""; continue }
    if(ch === "ー") continue;
    let r = KANA[ch] ?? "";
    if(SMALL[next]){ r = (r.endsWith("i") ? r.slice(0, -1) : r) + (/^(sh|ch|j)/.test(r) ? SMALL[next].slice(1) : SMALL[next]); i++ }
    out += r;
  }
  out = out.replace(/o[ou]/g, "o").replace(/uu/g, "u").replace(/n(?=[bmp])/g, "m");
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/* ---------- areas ---------- */
const nums = spec => spec.split(/[・,、]/).filter(Boolean).flatMap(p => {
  const r = p.match(/^(\d+)(?:丁目)?(?:～|から|-)(\d+)$/);
  if(r) return Array.from({length:+r[2]-+r[1]+1}, (_, i) => +r[1] + i);
  if(/^\d+$/.test(p)) return [+p];
  throw new Error(`can't read chome "${spec}"`);
});
/* pull top-level bracket groups out as §n§ so their 、・ don't split chome; line breaks outside brackets separate chome groups */
const OPEN = "（〔[(", CLOSE = "）〕])";
function protectBrackets(s, blocks){
  let out = "", depth = 0, cur = "";
  for(const ch of s){
    if(OPEN.includes(ch)){ if(depth++) cur += ch; continue }
    if(CLOSE.includes(ch) && depth){ if(--depth) cur += ch; else { out += `§${blocks.push(norm(cur.replace(/\n/g, ""))) - 1}§`; cur = "" } continue }
    if(depth) cur += ch; else out += ch === "\n" ? "・" : ch;
  }
  return out.replace(/・{2,}/g, "・").replace(/^・|・$/g, "");
}
/* the part of an address after the town name → [{chome:[..]|null, detail}]. A bracketed banchi list belongs to the chome right
   before it ("3丁目・5丁目〔1～22番〕" = all of 3-chome + part of 5-chome); text after the last 丁目 belongs to that group ("1～3丁目の奇数番地"). */
export function parsePart(part){
  const blocks = [];
  const s = norm(protectBrackets((part ?? "").normalize("NFKC"), blocks)).replace(/^\s*の/, "");
  const restore = t => t.replace(/§(\d+)§/g, (_, i) => blocks[i]).replace(/^の/, "").trim() || null;
  if(!s || s === "全域") return [{chome:null, detail:null}];
  const segments = [];
  for(const seg of s.split(/[、,]\s*/)){
    if(/丁目/.test(seg) || !segments.length) segments.push(seg);
    else segments[segments.length-1] += "、" + seg;
  }
  return segments.flatMap(seg => {
    if(!seg.includes("丁目")) return [{chome:null, detail:restore(seg.replace(/^全域/, ""))}];
    const groups = [];
    for(const token of seg.replace(/\s/g, "").split(/(?<=丁目|§)・/)){
      const at = token.lastIndexOf("丁目");
      if(at < 0) throw new Error(`can't read chome "${token}" in "${part}"`);
      const chome = nums(token.slice(0, at).replace(/丁目/g, "")), detail = restore(token.slice(at + 2));
      const last = groups[groups.length - 1];
      if(last && !last.detail && !detail) last.chome.push(...chome);
      else groups.push({chome, detail});
    }
    return groups;
  });
}
const listEn = n => n.length > 1 && n.every((x, i) => !i || x === n[i-1] + 1) ? `${n[0]}–${n[n.length-1]}` : n.join(", ");
export function partEn({chome, detail}){
  const c = chome ? `${listEn(chome)} chome` : "";
  if(!detail) return c || "All";
  const d = detail.replace(/(\d+)番[（(]([^）)]*)[）)]/g, "$1 ($2)").replace(/（|）/g, "").replace(/奇数番地?/, "odd banchi").replace(/偶数番地?/, "even banchi")
    .replace(/(\d+)～(\d+)/g, "$1–$2").replace(/番地?/g, "").replace(/・/g, ", ").replace(/、/g, ", ").replace(/号/g, " gō")
    .replace(/を除く|は除く|除く/g, " excluded").replace(/^(.*?)\s*の?(odd|even) banchi/, "$2 banchi $1").trim();
  const en = /[\u3040-\u30ff\u4e00-\u9fff]/.test(d) ? detail : `${/^\d/.test(d) ? "banchi " : ""}${d}`;
  return c ? `${c}, ${en}` : en.charAt(0).toUpperCase() + en.slice(1);
}
const partJp = ({chome, detail}) => `${chome ? `${chome.join("・")}丁目` : ""}${detail ?? ""}` || "全域";

/* ---------- output ---------- */
const ruleKey = rule => JSON.stringify(rule);
/* raw areas [{town, part|chome/detail, schedule}] → ward file with deduplicated patterns, plus a coverage report against the official town list */
export function buildAreas(raw, towns, {patternIds} = {}){
  const patterns = {}, byKey = new Map(), areas = [];
  for(const a of raw){
    let id = a.pattern;
    if(!id){
      const key = ruleKey(a.schedule);
      id = byKey.get(key);
      if(!id){ id = patternIds?.(a) ?? String(byKey.size + 1); byKey.set(key, id); patterns[id] = a.schedule }
    }
    const t = towns.get(a.town);
    if(!t) throw new Error(`town "${a.town}" is not in the official town list`);
    const parts = a.parts ?? parsePart(a.part ?? "");
    const label = a.label ?? (a.part || "全域");
    for(const p of parts){
      for(const n of p.chome ?? []) if(t.chome.length && !t.chome.includes(n)) throw new Error(`${a.town} has no ${n}-chome (from "${a.part}")`);
      areas.push({town:a.town, townEn:t.en, kana:t.kana, chome:p.chome, detail:p.detail, en:partEn(p), jp:parts.length > 1 ? partJp(p) : label, pattern:id, ...(a.note ? {note:a.note} : {})});
    }
  }
  areas.sort((x, y) => x.kana.localeCompare(y.kana, "ja") || (x.chome?.[0] ?? 0) - (y.chome?.[0] ?? 0));
  return {patterns, areas, coverage:coverage(areas, towns)};
}
function coverage(areas, towns){
  const missing = [];
  for(const t of towns.values()){
    const own = areas.filter(a => a.town === t.jp);
    if(!own.length){ missing.push(t.jp); continue }
    if(own.some(a => !a.chome)) continue;
    for(const n of t.chome) if(!own.some(a => a.chome.includes(n))) missing.push(`${t.jp}${n}丁目`);
  }
  return missing;
}
