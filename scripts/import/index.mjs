/* Builds data/municipalities/<id>.json (+ .dict.json) and data/municipalities.json from
   1. curated wards (scripts/import/wards/<id>: ruleset + importer reading the ward's official sources), and
   2. japan-gomi-data schedules for every other municipality its maintainers checked against official calendars,
   with sorting dictionaries from 粗大ごみナビ. A curated ward wins over japan-gomi-data for the same municipality code,
   and the two are cross-checked date by date.
   Usage: node scripts/import/index.mjs [id ...] [--refresh]   (no id = all) */
import fs from "node:fs";
import path from "node:path";
import { ROOT, readJSON, writeJSON, download, decode, csvObjects, townRegistry, buildAreas } from "./lib.mjs";
import { importDictionary } from "./dictionary.mjs";
import { autoSorting, autoPlasticTest } from "./autosort.mjs";
import { naviDictionary } from "./sources/sodaigominavi.mjs";
import * as jgd from "./sources/japan-gomi-data.mjs";
import { dayState, binsOn, iso } from "../../js/schedule.js";

const WARDS_DIR = path.join(ROOT, "scripts/import/wards"), OUT = path.join(ROOT, "data/municipalities");
const today = new Date().toISOString().slice(0, 10);
const picked = process.argv.slice(2).filter(a => !a.startsWith("--"));
const wanted = id => !picked.length || picked.includes(id);

/* japan-gomi-data municipalities we keep hidden although their records count them as checked */
const HOLD = {taito:"holidays and Dec 31 are unconfirmed in both the official calendar and our own research"};
const PREF_EN = ["", "Hokkaido", "Aomori", "Iwate", "Miyagi", "Akita", "Yamagata", "Fukushima", "Ibaraki", "Tochigi", "Gunma", "Saitama",
  "Chiba", "Tokyo", "Kanagawa", "Niigata", "Toyama", "Ishikawa", "Fukui", "Yamanashi", "Nagano", "Gifu", "Shizuoka", "Aichi", "Mie",
  "Shiga", "Kyoto", "Osaka", "Hyogo", "Nara", "Wakayama", "Tottori", "Shimane", "Okayama", "Hiroshima", "Yamaguchi", "Tokushima",
  "Kagawa", "Ehime", "Kochi", "Fukuoka", "Saga", "Nagasaki", "Kumamoto", "Oita", "Miyazaki", "Kagoshima", "Okinawa"];

/* strip research-only fields (evidence, open questions) before shipping */
const RESEARCH_ONLY = key => key === "evidence" || key.endsWith("Evidence") || key === "holidays";
const stripResearch = v => Array.isArray(v) ? v.map(stripResearch)
  : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([k]) => !RESEARCH_ONLY(k)).map(([k, x]) => [k, stripResearch(x)])) : v;
function shippedRuleset(rs){
  const sorting = Object.fromEntries(Object.entries(rs.sorting).map(([t, v]) => [t, v.note ? {bin:v.bin, note:v.note} : v.bin]));
  const plasticTest = {...rs.plasticTest, bin:"pla", otherwise:rs.sorting["plastic-dirty"].bin};
  return stripResearch({id:rs.id, code:rs.code, pref:"13", jp:rs.jp, en:rs.en, verified:rs.verified, sources:rs.sources, contacts:rs.contacts,
    bins:rs.bins, plasticTest, sorting, calendar:rs.calendar});
}
function checkPatterns(m, patterns){
  for(const [id, p] of Object.entries(patterns)) for(const bin of Object.keys(p))
    if(!m.bins[bin]) throw new Error(`${m.id}: pattern ${id} uses bin "${bin}" that isn't defined`);
}
const naviFallback = async (code, jp, bins) => (await naviDictionary(code, jp, bins))?.dict ?? null;

/* ---------- 1. curated wards ---------- */
async function curated(id){
  const rs = readJSON(path.join(WARDS_DIR, id, "ruleset.json"));
  const mod = await import(path.join(WARDS_DIR, id, "import.mjs"));
  const towns = await townRegistry(rs.jp);
  for(const [jp, en] of Object.entries(rs.townNames ?? {})){
    if(!towns.has(jp)) throw new Error(`townNames: "${jp}" is not an official town`);
    towns.get(jp).en = en;
  }
  const raw = await mod.areas({rs, towns, download:url => download(id, url), decode, csvObjects, dir:path.join(WARDS_DIR, id)});
  const {patterns, areas, coverage} = buildAreas(raw.areas ?? raw, towns, {patternIds:mod.patternId});
  Object.assign(patterns, raw.patterns ?? {});
  checkPatterns(rs, patterns);
  const orphan = areas.find(a => !patterns[a.pattern]);
  if(orphan) throw new Error(`area ${orphan.town} ${orphan.jp} uses missing pattern "${orphan.pattern}"`);
  const m = shippedRuleset(rs);
  m.updated = today;
  m.calendar = {...m.calendar, ...(raw.validTo ? {validTo:raw.validTo} : {}), patterns};
  m.areas = areas;
  const dict = rs.dictionary ? await importDictionary(rs, url => download(id, url)) : await naviFallback(rs.code, rs.jp, rs.bins);
  const notes = coverage.length ? [`not covered by any area (${coverage.length}): ${coverage.join(" ")}`] : [];
  return {m, dict, status:rs.status, notes};
}

/* ---------- 2. japan-gomi-data ---------- */
async function fromJapanGomiData(entry, repo){
  const c = await jgd.convert(entry, repo, today);
  const navi = await naviDictionary(c.code, c.jp, c.bins);
  const sorting = navi ? autoSorting(navi.entries) : {};
  const m = {
    id:c.id, code:c.code, pref:c.pref, jp:c.jp, en:c.en, verified:c.extractedAt.slice(0, 10), sources:c.sources, contacts:[],
    bins:c.bins, plasticTest:autoPlasticTest(sorting, c.bins), sorting, calendar:c.calendar, areas:c.areas, attribution:c.attribution, updated:today,
  };
  checkPatterns(m, c.calendar.patterns);
  const notes = [...c.codeNote, ...(navi?.notes ?? [])];
  if(c.unknownTowns.length) notes.push(`${c.unknownTowns.length} area names aren't official town names (shown as written): ${c.unknownTowns.slice(0, 8).join(" ")}${c.unknownTowns.length > 8 ? " …" : ""}`);
  return {m, dict:navi?.dict ?? null, sortedTypes:Object.keys(sorting).length, notes};
}

/* curated vs japan-gomi-data: same town and chome, next 90 days, compared by bin kind */
function crossCheck(cur, other){
  const kinds = (m, pattern, d) => { const s = dayState(m.calendar, d); return s ? s : [...new Set(binsOn(m.calendar, pattern, d).map(b => m.bins[b].kind))].filter(k => ["burn", "non", "pla", "res"].includes(k)).sort().join("+") };
  const start = new Date(); start.setHours(0, 0, 0, 0);
  let pairs = 0; const diffs = [];
  for(const a of cur.areas){
    const b = other.areas.find(b => b.town === a.town && (!b.chome || !a.chome || a.chome.some(n => b.chome.includes(n))) && !b.detail && !a.detail);
    if(!b) continue;
    pairs++;
    for(let i = 0; i < 90; i++){
      const d = new Date(start); d.setDate(start.getDate() + i);
      const x = kinds(cur, cur.calendar.patterns[a.pattern], d), y = kinds(other, other.calendar.patterns[b.pattern], d);
      if(x === y || [x, y].some(v => ["unpublished", "unconfirmed", "off"].includes(v))) continue;
      diffs.push(`${a.town} ${a.en} ${iso(d)}: ours ${x || "nothing"}, japan-gomi-data ${y || "nothing"}`);
      break;
    }
  }
  console.log(`  cross-check with japan-gomi-data: ${pairs} matching areas, ${diffs.length} differ${diffs.length ? `\n    ${diffs.slice(0, 6).join("\n    ")}` : ""}`);
}

const write = (m, dict) => {
  writeJSON(path.join(OUT, `${m.id}.json`), m);
  const dictFile = path.join(OUT, `${m.id}.dict.json`);
  if(dict) writeJSON(dictFile, dict); else fs.rmSync(dictFile, {force:true});
};

let failed = false;
const shown = new Map(), curatedByCode = new Map();
for(const id of fs.readdirSync(WARDS_DIR).filter(d => fs.existsSync(path.join(WARDS_DIR, d, "ruleset.json"))).sort()){
  const rs = readJSON(path.join(WARDS_DIR, id, "ruleset.json"));
  curatedByCode.set(rs.code, id);
  if(rs.status === "verified") shown.set(id, rs.code);
  if(!wanted(id)) continue;
  try {
    const {m, dict, status, notes} = await curated(id);
    if(status === "verified") write(m, dict);
    else writeJSON(path.join(ROOT, ".cache/preview", `${id}.json`), m);
    console.log(`${id}: curated, ${status}, ${m.areas.length} areas, ${Object.keys(m.calendar.patterns).length} patterns${dict ? `, ${dict.items.length} dictionary items${dict.provider ? " (粗大ごみナビ)" : ""}` : ""}`);
    for(const n of notes) console.log(`  ${n}`);
  } catch(err) { failed = true; console.error(`${id}: FAILED: ${err.message}`) }
}

const repo = await jgd.loadRepo();
console.log(`japan-gomi-data @ ${repo.commit}`);
const hidden = [];
for(const entry of jgd.listMunicipalities(repo)){
  const {handle, meta} = entry, v = jgd.verification(meta);
  if(curatedByCode.has(meta.code)){
    if(!wanted(handle) && !wanted(curatedByCode.get(meta.code))) continue;
    const id = curatedByCode.get(meta.code), file = path.join(OUT, `${id}.json`);
    if(!fs.existsSync(file)){ hidden.push(`${handle} (${meta.name_ja}): curated ward "${id}" is pending${HOLD[handle] ? `; ${HOLD[handle]}` : ""}`); continue }
    console.log(`${id}: overlaps japan-gomi-data ${handle}`);
    try { crossCheck(readJSON(file), (await jgd.convert(entry, repo, today))) } catch(err) { console.log(`  cross-check failed: ${err.message}`) }
    continue;
  }
  if(!v.ok || HOLD[handle]){ hidden.push(`${handle} (${meta.name_ja}): ${HOLD[handle] ?? v.reason}`); continue }
  shown.set(handle, meta.code);
  if(!wanted(handle)) continue;
  try {
    const {m, dict, sortedTypes, notes} = await fromJapanGomiData(entry, repo);
    write(m, dict);
    console.log(`${handle}: japan-gomi-data ${m.calendar.validFrom}–${m.calendar.validTo}, ${m.areas.length} areas, ${Object.keys(m.calendar.patterns).length} courses, ` +
      (dict ? `${dict.items.length} dictionary items, ${sortedTypes}/33 types auto-matched` : "no sorting dictionary"));
    for(const n of notes) console.log(`  ${n}`);
  } catch(err) { failed = true; shown.delete(handle); console.error(`${handle}: FAILED: ${err.message}`) }
}
if(hidden.length) console.log(`hidden:\n  ${hidden.join("\n  ")}`);

/* index of shipped municipalities; files of anything no longer shown are removed */
for(const f of fs.readdirSync(OUT)){
  const id = f.replace(/(\.dict)?\.json$/, "");
  if(!shown.has(id)) fs.rmSync(path.join(OUT, f));
}
const list = [...shown.keys()].filter(id => fs.existsSync(path.join(OUT, `${id}.json`))).map(id => readJSON(path.join(OUT, `${id}.json`)));
list.sort((a, b) => a.pref.localeCompare(b.pref) || a.en.localeCompare(b.en));
writeJSON(path.join(ROOT, "data/municipalities.json"), {
  _readme:"Municipalities shown in the app. Generated by scripts/import: curated wards checked against official sources, plus japan-gomi-data schedules its maintainers checked against official calendars.",
  version:today,
  municipalities:list.map(m => ({
    id:m.id, code:m.code, pref:m.pref, prefEn:PREF_EN[+m.pref], en:m.en, jp:m.jp, verified:m.verified,
    dictionary:fs.existsSync(path.join(OUT, `${m.id}.dict.json`)), source:m.attribution ? "japan-gomi-data" : "curated",
  })),
});
process.exitCode = failed ? 1 : 0;
