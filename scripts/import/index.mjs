/* Builds data/municipalities/<prefecture>/<municipality>/{municipality,dictionary}.json and data/municipalities.json from
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
import { tokyoDictionary } from "./sources/tokyo-open-data.mjs";
import * as jgd from "./sources/japan-gomi-data.mjs";
import * as toyonakaSource from "./sources/toyonaka-gomidashi.mjs";
import * as gomisuke from "./sources/gomisuke.mjs";
import * as smartLgovTrash from "./sources/smart-lgov-trash.mjs";
import * as gomisuteGps from "./sources/gomisute-gps.mjs";
import * as fukuiPref from "./sources/fukui-pref.mjs";
import * as ishikawaPref from "./sources/ishikawa-pref.mjs";
import {tokyoMetroEntries, wardCodesWithRulesets} from "./seeds/tokyo-metro.mjs";
import * as niizaHtml from "./sources/niiza-html.mjs";
import {convertHtmlWeekly} from "./sources/html-weekly-table.mjs";
import {htmlWeeklyEntries} from "./seeds/html-weekly.mjs";
import * as warabiHtml from "./sources/warabi-html.mjs";
import * as yashioHtml from "./sources/yashio-html.mjs";
import * as mikurajimaHtml from "./sources/mikurajima-html.mjs";
import * as fukayaHtml from "./sources/fukaya-html.mjs";
import * as kamikawaTownHtml from "./sources/kamikawa-town-html.mjs";
import * as miyakeVillHtml from "./sources/miyake-vill-html.mjs";
import * as higashikurumeHtml from "./sources/higashikurume-html.mjs";
import * as tachikawaHtml from "./sources/tachikawa-html.mjs";
import * as shinjukuHtml from "./sources/shinjuku-html.mjs";
import * as misatoCityHtml from "./sources/misato-city-html.mjs";
import * as hinodeTownHtml from "./sources/hinode-town-html.mjs";
import * as towada from "./sources/towada.mjs";
import * as otaru from "./sources/otaru.mjs";
import {SEEDS_CUSTOM, seed5374Entries} from "./seeds/prefecture-seeds.mjs";
import {MAJOR_HUBS_CUSTOM, majorHub5374Entries} from "./seeds/major-hubs.mjs";
import {catalog5374Entries} from "./seeds/5374-catalog.mjs";
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
const slug = value => String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const catalogPath = m => `${String(m.pref).padStart(2, "0")}-${slug(PREF_EN[+m.pref])}/${m.code}-${slug(m.en)}`;
const catalogFiles = m => {
  const dir = path.join(OUT, catalogPath(m));
  return {dir, municipality:path.join(dir, "municipality.json"), dictionary:path.join(dir, "dictionary.json")};
};
const currentIndexFile = path.join(ROOT, "data/municipalities.json");
const currentById = new Map((fs.existsSync(currentIndexFile) ? readJSON(currentIndexFile).municipalities : []).map(m => [m.id, m]));
const written = new Map();
function filesForId(id){
  if(written.has(id)) return written.get(id);
  const entry = currentById.get(id);
  if(entry?.path){
    const dir = path.join(OUT, entry.path);
    return {dir, municipality:path.join(dir, "municipality.json"), dictionary:path.join(dir, "dictionary.json")};
  }
  return {dir:OUT, municipality:path.join(OUT, `${id}.json`), dictionary:path.join(OUT, `${id}.dict.json`)};
}

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
  const official = await tokyoDictionary(c.code, c.bins, url => download(c.id, url));
  const navi = official ? null : await naviDictionary(c.code, c.jp, c.bins);
  const dictionary = official ?? navi;
  const sorting = dictionary ? autoSorting(dictionary.entries) : {};
  const m = {
    id:c.id, code:c.code, pref:c.pref, jp:c.jp, en:c.en, verified:c.extractedAt.slice(0, 10), sources:c.sources, contacts:[],
    bins:c.bins, plasticTest:autoPlasticTest(sorting, c.bins), sorting, calendar:c.calendar, areas:c.areas, attribution:c.attribution, updated:today,
  };
  checkPatterns(m, c.calendar.patterns);
  const notes = [...c.codeNote, ...(navi?.notes ?? [])];
  if(c.unknownTowns.length) notes.push(`${c.unknownTowns.length} area names aren't official town names (shown as written): ${c.unknownTowns.slice(0, 8).join(" ")}${c.unknownTowns.length > 8 ? " …" : ""}`);
  return {m, dict:dictionary?.dict ?? null, sortedTypes:Object.keys(sorting).length, notes};
}

/* curated vs japan-gomi-data: same town and chome, next 90 days, compared by bin kind */
function crossCheck(cur, other){
  const kinds = (m, pattern, d) => {
    const bins = [...new Set(binsOn(m.calendar, pattern, d).map(b => m.bins[b].kind))]
      .filter(k => ["burn", "non", "pla", "res"].includes(k)).sort().join("+");
    return bins || dayState(m.calendar, d);
  };
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
  const files = catalogFiles(m);
  writeJSON(files.municipality, m);
  if(dict) writeJSON(files.dictionary, dict); else fs.rmSync(files.dictionary, {force:true});
  written.set(m.id, files);
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
    const id = curatedByCode.get(meta.code), file = filesForId(id).municipality;
    if(!fs.existsSync(file)){ hidden.push(`${handle} (${meta.name_ja}): curated ward "${id}" is pending${HOLD[handle] ? `; ${HOLD[handle]}` : ""}`); continue }
    console.log(`${id}: overlaps japan-gomi-data ${handle}`);
    try { crossCheck(readJSON(file), (await jgd.convert(entry, repo, today))) } catch(err) { console.log(`  cross-check failed: ${err.message}`) }
    continue;
  }
  const shipJgd = v.ok || ((v.tier === "no-note" || v.tier === "partial") && !HOLD[handle]);
  if(!shipJgd || HOLD[handle]){ hidden.push(`${handle} (${meta.name_ja}): ${HOLD[handle] ?? v.reason}`); continue }
  shown.set(handle, meta.code);
  if(!wanted(handle)) continue;
  try {
    const {m, dict, sortedTypes, notes} = await fromJapanGomiData(entry, repo);
    if(v.tier === "no-note"){
      m.calendar.note = `${m.calendar.note ?? ""} japan-gomi-data ships this municipality but meta.yaml has no verification note yet — treat the city's official calendar as final.`.trim();
    }
    if(v.tier === "partial"){
      m.calendar.note = `${m.calendar.note ?? ""} japan-gomi-data marks part of this data 未検証 — confirm against the city's official calendar.`.trim();
    }
    write(m, dict);
    console.log(`${handle}: japan-gomi-data ${m.calendar.validFrom}–${m.calendar.validTo}, ${m.areas.length} areas, ${Object.keys(m.calendar.patterns).length} courses, ` +
      (dict ? `${dict.items.length} dictionary items, ${sortedTypes}/33 types auto-matched` : "no sorting dictionary") +
      (v.tier === "no-note" ? " (no verification note in japan-gomi-data)" : ""));
    for(const n of notes) console.log(`  ${n}`);
  } catch(err) { failed = true; shown.delete(handle); console.error(`${handle}: FAILED: ${err.message}`) }
}
if(hidden.length) console.log(`hidden:\n  ${hidden.join("\n  ")}`);

/* ---------- 3. other verified community datasets ---------- */
async function shipCommunity(entry){
  if([...shown.values()].includes(entry.code)) return;
  shown.set(entry.id, entry.code);
  if(!wanted(entry.id)) return;
  try {
    const m = await entry.convert(today);
    const navi = await naviDictionary(m.code, m.jp, m.bins);
    if(navi?.dict){
      if(!Object.keys(m.sorting).length) m.sorting = autoSorting(navi.entries);
      m.plasticTest ??= autoPlasticTest(m.sorting, m.bins);
    }
    write(m, navi?.dict ?? null);
    console.log(`${entry.id}: ${entry.source.name} ${m.calendar.validFrom}–${m.calendar.validTo}, ${m.areas.length} areas, ${Object.keys(m.calendar.patterns).length} courses` +
      (navi?.dict ? `, ${navi.dict.items.length} dictionary items, ${Object.keys(m.sorting).length}/33 types auto-matched` : ", no sorting dictionary"));
    for(const note of navi?.notes ?? []) console.log(`  ${note}`);
  } catch(err) {
    if(entry.skipIfUnavailable && /HTTP (502|503|504)/.test(err.message)){
      shown.delete(entry.id);
      console.warn(`${entry.id}: skipped (upstream API unavailable): ${err.message}`);
      return;
    }
    failed = true;
    shown.delete(entry.id);
    console.error(`${entry.id}: FAILED: ${err.message}`);
  }
}

const community = [
  {id:"toyonaka", code:"27203", source:toyonakaSource.SOURCE, convert:toyonakaSource.convert},
  {id:"kanazawa", code:"17201", source:gomisuteGps.SOURCE, convert:gomisuteGps.kanazawa},
  {id:"onagawa-town", code:"04581", source:gomisuteGps.SOURCE, convert:gomisuteGps.onagawa},
  {id:"niiza", code:"11230", source:niizaHtml.SOURCE, convert:niizaHtml.convert},
  {id:"saitama-city", code:"11100", source:gomisuke.SOURCE, convert:gomisuke.saitamaCity},
  {id:"gyoda", code:"11206", source:smartLgovTrash.SOURCE, convert:smartLgovTrash.gyoda, skipIfUnavailable: true},
  {id:"kitamoto", code:"11233", source:smartLgovTrash.SOURCE, convert:smartLgovTrash.kitamoto, skipIfUnavailable: true},
  {id:"fujimino", code:"11245", source:smartLgovTrash.SOURCE, convert:smartLgovTrash.fujimino, skipIfUnavailable: true},
];
for(const entry of community) await shipCommunity(entry);

for(const spec of htmlWeeklyEntries()){
  await shipCommunity({
    id: spec.id,
    code: spec.code,
    source: {name: spec.sourceName, url: spec.url, license: spec.license ?? "Municipality website"},
    convert: today => convertHtmlWeekly(spec, today),
  });
}
for(const entry of [
  {id: "warabi", code: "11223", source: warabiHtml.SOURCE, convert: warabiHtml.convert},
  {id: "yashio", code: "11234", source: yashioHtml.SOURCE, convert: yashioHtml.convert},
  {id: "mikurajima-vill", code: "13382", source: mikurajimaHtml.SOURCE, convert: mikurajimaHtml.convert},
  {id: "fukaya", code: "11218", source: fukayaHtml.SOURCE, convert: fukayaHtml.convert},
  {id: "kamikawa-town", code: "11383", source: kamikawaTownHtml.SOURCE, convert: kamikawaTownHtml.convert},
  {id: "miyake-vill", code: "13381", source: miyakeVillHtml.SOURCE, convert: miyakeVillHtml.convert},
  {id: "higashikurume", code: "13222", source: higashikurumeHtml.SOURCE, convert: higashikurumeHtml.convert},
  {id: "tachikawa", code: "13202", source: tachikawaHtml.SOURCE, convert: tachikawaHtml.convert},
  {id: "shinjuku", code: "13104", source: shinjukuHtml.SOURCE, convert: shinjukuHtml.convert},
  {id: "misato-city", code: "11237", source: misatoCityHtml.SOURCE, convert: misatoCityHtml.convert},
  {id: "hinode-town", code: "13305", source: hinodeTownHtml.SOURCE, convert: hinodeTownHtml.convert},
]) await shipCommunity(entry);

/* ---------- 4. single-city open data (district CSV or date calendar) ---------- */
const cityOpenData = [
  {id:"towada", code:"02203", source:towada.SOURCE, convert:towada.convert},
  {id:"otaru", code:"01203", source:otaru.SOURCE, convert:otaru.convert},
];
for(const entry of cityOpenData) await shipCommunity({...entry, source:entry.source});

/* ---------- 5. one municipality per prefecture (onboarding Japan map) ---------- */
function prefsLit(){
  const out = new Set();
  for(const id of shown.keys()){
    const file = filesForId(id).municipality;
    if(fs.existsSync(file)) out.add(readJSON(file).pref.padStart(2, "0"));
  }
  return out;
}
async function shipPrefectureSeed(entry){
  if(prefsLit().has(entry.pref.padStart(2, "0"))) return;
  if([...shown.values()].includes(entry.code)) return;
  await shipCommunity(entry);
}
for(const entry of seed5374Entries()) await shipPrefectureSeed(entry);
for(const entry of SEEDS_CUSTOM) await shipPrefectureSeed(entry);

/* ---------- 6. major hubs — extra municipalities in Tokyo / Kyoto / Osaka / Hokkaido / Hiroshima / Okinawa ---------- */
async function shipMajorHub(entry){
  if(shown.has(entry.id) || [...shown.values()].includes(entry.code)) return;
  await shipCommunity(entry);
}
for(const entry of majorHub5374Entries()) await shipMajorHub(entry);
for(const entry of MAJOR_HUBS_CUSTOM) await shipMajorHub(entry);

/* ---------- 7. full 5374 catalog (discovered + curated area_days.csv) ---------- */
for(const entry of catalog5374Entries()) await shipMajorHub(entry);

/* ---------- 8. Fukui Prefecture open-data (17 municipalities, one pref) ---------- */
for(const spec of fukuiPref.MUNICIPALITIES){
  if(shown.has(spec.id) || [...shown.values()].includes(spec.code)) continue;
  shown.set(spec.id, spec.code);
  if(!wanted(spec.id)) continue;
  try {
    const raw = await fukuiPref.convert(spec, today);
    const {skippedRows, ...m} = raw;
    m.updated = today;
    const navi = await naviDictionary(m.code, m.jp, m.bins);
    if(navi?.dict){
      m.sorting = autoSorting(navi.entries);
      m.plasticTest = autoPlasticTest(m.sorting, m.bins);
    }
    write(m, navi?.dict ?? null);
    console.log(`${spec.id}: ${fukuiPref.SOURCE.name} ${m.calendar.validFrom}–${m.calendar.validTo}, ${m.areas.length} areas, ${Object.keys(m.calendar.patterns).length} patterns` +
      (skippedRows ? ` (${skippedRows} districts skipped: no parseable schedule)` : "") +
      (navi?.dict ? `, ${navi.dict.items.length} dictionary items` : ", no sorting dictionary"));
    for(const note of navi?.notes ?? []) console.log(`  ${note}`);
  } catch(err) { failed = true; shown.delete(spec.id); console.error(`${spec.id}: FAILED: ${err.message}`) }
}

/* ---------- 9. Ishikawa Prefecture open-data catalog (schedule CSVs) ---------- */
for(const spec of ishikawaPref.MUNICIPALITIES){
  if(shown.has(spec.id) || [...shown.values()].includes(spec.code)) continue;
  shown.set(spec.id, spec.code);
  if(!wanted(spec.id)) continue;
  try {
    const raw = await ishikawaPref.convert(spec, today);
    const {skippedRows, ...m} = raw;
    m.updated = today;
    const navi = await naviDictionary(m.code, m.jp, m.bins);
    if(navi?.dict){
      m.sorting = autoSorting(navi.entries);
      m.plasticTest = autoPlasticTest(m.sorting, m.bins);
    }
    write(m, navi?.dict ?? null);
    console.log(`${spec.id}: ${ishikawaPref.SOURCE.name} ${m.calendar.validFrom}–${m.calendar.validTo}, ${m.areas.length} areas, ${Object.keys(m.calendar.patterns).length} patterns` +
      (skippedRows ? ` (${skippedRows} districts skipped: no parseable schedule)` : "") +
      (navi?.dict ? `, ${navi.dict.items.length} dictionary items` : ", no sorting dictionary"));
    for(const note of navi?.notes ?? []) console.log(`  ${note}`);
  } catch(err) { failed = true; shown.delete(spec.id); console.error(`${spec.id}: FAILED: ${err.message}`) }
}

/* ---------- 10. Tokyo Metro Open Data Catalog (weekday XLSX/CSV; all seeds, skip curated wards) ---------- */
const tokyoMetroWardCodes = wardCodesWithRulesets();
for(const entry of tokyoMetroEntries()){
  if(tokyoMetroWardCodes.has(entry.code)) continue;
  if(shown.has(entry.id) || [...shown.values()].includes(entry.code)) continue;
  shown.set(entry.id, entry.code);
  if(!wanted(entry.id)) continue;
  try {
    const raw = await entry.convert(today);
    const {skippedRows, ...m} = raw;
    m.updated = today;
    const navi = await naviDictionary(m.code, m.jp, m.bins);
    if(navi?.dict){
      m.sorting = autoSorting(navi.entries);
      m.plasticTest = autoPlasticTest(m.sorting, m.bins);
    }
    write(m, navi?.dict ?? null);
    console.log(`${entry.id}: ${entry.source.name} ${m.calendar.validFrom}–${m.calendar.validTo}, ${m.areas.length} areas, ${Object.keys(m.calendar.patterns).length} patterns` +
      (skippedRows ? ` (${skippedRows} districts skipped: no parseable schedule)` : "") +
      (navi?.dict ? `, ${navi.dict.items.length} dictionary items` : ", no sorting dictionary"));
    for(const note of navi?.notes ?? []) console.log(`  ${note}`);
  } catch(err) { failed = true; shown.delete(entry.id); console.error(`${entry.id}: FAILED: ${err.message}`) }
}

/* Place every shipped municipality in the prefecture → municipality tree, then remove stale generated files. */
const placed = [];
for(const id of shown.keys()){
  const from = filesForId(id);
  if(!fs.existsSync(from.municipality)) continue;
  const m = readJSON(from.municipality), to = catalogFiles(m);
  fs.mkdirSync(to.dir, {recursive:true});
  if(path.resolve(from.municipality) !== path.resolve(to.municipality)) fs.renameSync(from.municipality, to.municipality);
  if(fs.existsSync(from.dictionary) && path.resolve(from.dictionary) !== path.resolve(to.dictionary)) fs.renameSync(from.dictionary, to.dictionary);
  written.set(id, to);
  placed.push({m, files:to});
}
placed.sort((a, b) => a.m.pref.localeCompare(b.m.pref) || a.m.en.localeCompare(b.m.en));
const municipalities = placed.map(({m, files}) => ({
  id:m.id, code:m.code, pref:m.pref, prefEn:PREF_EN[+m.pref], en:m.en, jp:m.jp, verified:m.verified,
  path:catalogPath(m), dictionary:fs.existsSync(files.dictionary), source:m.attribution?.schedule?.name ?? "curated",
}));
const keep = new Set(placed.flatMap(({files}) => [files.municipality, ...(fs.existsSync(files.dictionary) ? [files.dictionary] : [])].map(path.resolve)));
function generatedFiles(dir){
  if(!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, {withFileTypes:true}).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? generatedFiles(file) : entry.name.endsWith(".json") ? [file] : [];
  });
}
for(const file of generatedFiles(OUT)) if(!keep.has(path.resolve(file))) fs.rmSync(file);
function pruneEmpty(dir){
  for(const entry of fs.readdirSync(dir, {withFileTypes:true})) if(entry.isDirectory()) pruneEmpty(path.join(dir, entry.name));
  if(dir !== OUT && !fs.readdirSync(dir).length) fs.rmdirSync(dir);
}
pruneEmpty(OUT);
writeJSON(path.join(ROOT, "data/municipalities.json"), {
  _readme:"Municipalities shown in the app. Payloads follow prefecture/municipality/{municipality,dictionary}.json and are generated offline by npm run import; the browser never calls importer APIs.",
  version:today,
  municipalities,
});
const municipalitiesByPref = {};
for(const m of municipalities){
  const pref = String(m.pref).padStart(2, "0");
  (municipalitiesByPref[pref] ??= []).push(m.code);
}
for(const pref of Object.keys(municipalitiesByPref)) municipalitiesByPref[pref].sort();
writeJSON(path.join(ROOT, "data/coverage.json"), {
  _readme:"Prefectures lit on the onboarding Japan map. Generated with municipalities.json by npm run import.",
  version:today,
  prefectures:Object.keys(municipalitiesByPref).sort(),
  municipalitiesByPref,
});
const missingPrefs = Array.from({length:47}, (_, i) => String(i + 1).padStart(2, "0"))
  .filter(p => !municipalitiesByPref[p]?.length);
if(missingPrefs.length) console.warn(`prefecture map: ${47 - missingPrefs.length}/47 prefs have ≥1 municipality; still missing: ${missingPrefs.join(", ")}`);
process.exitCode = failed ? 1 : 0;
