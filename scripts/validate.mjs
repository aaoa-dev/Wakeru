/* Checks everything the app loads from data/. Usage: node scripts/validate.mjs (exit code 1 on any problem) */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = rel => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
const KINDS = ["burn", "non", "res", "pla", "haz", "big", "no"];
const ISO = /^\d{4}-\d{2}-\d{2}$/, MONTH_DAY = /^\d{2}-\d{2}$/;
const errors = [];
const check = (ok, where, msg) => { if(!ok) errors.push(`${where}: ${msg}`) };
const isoList = (list, where, what) => check(Array.isArray(list) && list.every(d => ISO.test(d)) && list.every((d, i) => !i || d > list[i-1]), where, `${what} must be sorted ISO dates`);
const weekdays = list => Array.isArray(list) && list.length && list.every(d => Number.isInteger(d) && d >= 0 && d <= 6);

/* shared */
const types = read("data/shared/types.json");
const items = read("data/shared/items.json");
check(new Set(items.map(it => it.en)).size === items.length, "items.json", "duplicate English item names");
check(new Set(items.map(it => it.jp)).size === items.length, "items.json", "duplicate Japanese item names");
for(const it of items){
  check(it.en && it.jp && it.outcomes?.length, `items.json "${it.en}"`, "needs en, jp and at least one outcome");
  for(const o of it.outcomes ?? []) check(types[o.type], `items.json "${it.en}"`, `unknown type "${o.type}"`);
}
for(const g of read("data/shared/glossary.json")) check(KINDS.includes(g.bin), `glossary.json "${g.jp}"`, `unknown bin kind "${g.bin}"`);

function checkRule(rule, where){
  if(Array.isArray(rule)) return check(weekdays(rule), where, "weekly rule needs weekdays 0–6");
  if(rule?.except) isoList(rule.except, where, "except");
  if(rule?.add) isoList(rule.add, where, "add");
  if(rule?.any) return rule.any.forEach(r => checkRule(r, where));
  if(rule?.days) return check(weekdays(rule.days), where, "days needs weekdays 0–6");
  if(rule?.dates) return check(rule.dates.length, where, "dates is empty"), isoList(rule.dates, where, "dates");
  check(Number.isInteger(rule?.day) && rule.day >= 0 && rule.day <= 6 && rule.weeks?.length && rule.weeks.every(w => w >= 1 && w <= 5), where, "nth-weekday rule needs day 0–6 and weeks 1–5");
}

/* municipalities */
const index = read("data/municipalities.json");
check(new Set(index.municipalities.map(m => m.id)).size === index.municipalities.length, "municipalities.json", "duplicate ids");
check(new Set(index.municipalities.map(m => m.code)).size === index.municipalities.length, "municipalities.json", "duplicate municipality codes");
check(new Set(index.municipalities.map(m => m.path)).size === index.municipalities.length, "municipalities.json", "duplicate municipality paths");
for(const entry of index.municipalities){
  const file = `data/municipalities/${entry.path}/municipality.json`;
  check(/^\d{2}-[a-z0-9-]+\/\d{5}-[a-z0-9-]+$/.test(entry.path ?? ""), "municipalities.json", `${entry.id} has an invalid hierarchy path`);
  if(!fs.existsSync(path.join(ROOT, file))){ check(false, "municipalities.json", `${file} is missing`); continue }
  const m = read(file), bins = Object.keys(m.bins);
  check(m.id === entry.id && m.en === entry.en && m.jp === entry.jp && m.code === entry.code && m.pref === entry.pref, file, "id/code/pref/en/jp differ from municipalities.json");
  check(/^\d{5}$/.test(m.code ?? "") && m.code.startsWith(m.pref), file, "needs a 5-digit municipality code in its prefecture");
  check(entry.prefEn, "municipalities.json", `${entry.id} needs prefEn`);
  check(ISO.test(m.verified ?? ""), file, "needs a verified date");
  check(m.sources?.length, file, "needs official sources");
  check(Array.isArray(m.contacts), file, "contacts must be a list");
  if(entry.source === "japan-gomi-data") check(m.attribution?.schedule?.license && m.attribution.schedule.commit, file, "japan-gomi-data needs attribution with license and commit");
  for(const [id, b] of Object.entries(m.bins)) check(KINDS.includes(b.kind) && b.en && b.label, `${file} bin ${id}`, "needs label, en and a known kind");
  for(const [t, s] of Object.entries(m.sorting)){
    const bin = typeof s === "string" ? s : s?.bin;
    check(types[t], `${file} sorting`, `unknown type "${t}"`);
    check(bin && m.bins[bin], `${file} sorting`, `type "${t}" ${bin ? `uses unknown bin "${bin}"` : "has no bin"}`);
  }
  if(entry.source === "curated") for(const t of Object.keys(types)) check(m.sorting[t], `${file} sorting`, `curated ward misses type "${t}"`);
  const pt = m.plasticTest;
  if(pt) check(typeof pt.products === "boolean" && pt.summary && m.bins[pt.bin] && m.bins[pt.otherwise], file, "plasticTest needs products, summary, and known bin / otherwise bins");
  const cal = m.calendar, nc = cal.noCollection;
  check(Array.isArray(nc?.weekdays) && Array.isArray(nc?.dates) && nc.dates.every(d => MONTH_DAY.test(d)), file, "noCollection needs weekdays and MM-DD dates");
  for(const [bin, dates] of Object.entries(nc?.bins ?? {})) check(m.bins[bin] && dates.every(d => MONTH_DAY.test(d)), file, `noCollection.bins.${bin} is invalid`);
  for(const bin of Object.keys(cal.putOutBy ?? {})) check(m.bins[bin], file, `putOutBy uses unknown bin "${bin}"`);
  for(const k of ["validFrom", "validTo"]) if(cal[k]) check(ISO.test(cal[k]), file, `${k} must be an ISO date`);
  for(const u of cal.unknown ?? []) check(ISO.test(u.from) && ISO.test(u.to) && u.from <= u.to, file, "unknown periods need ISO from ≤ to");
  for(const [id, p] of Object.entries(cal.patterns)) for(const [bin, rule] of Object.entries(p)){
    check(bins.includes(bin), `${file} pattern ${id}`, `unknown bin "${bin}"`);
    checkRule(rule, `${file} pattern ${id} ${bin}`);
    for(const d of [...(rule?.dates ?? []), ...(rule?.add ?? [])])
      check(!nc.bins?.[bin]?.includes(d.slice(5)), `${file} pattern ${id} ${bin}`, `${d} is both an explicit pickup and a bin-specific no-collection day`);
  }
  check(m.areas.length, file, "has no areas");
  for(const a of m.areas){
    check(a.town && a.townEn && a.en && a.jp, `${file} area ${a.town} ${a.jp}`, "missing names");
    check(cal.patterns[a.pattern], `${file} area ${a.town} ${a.jp}`, `unknown pattern "${a.pattern}"`);
  }
  const dictFile = `data/municipalities/${entry.path}/dictionary.json`;
  check(entry.dictionary === fs.existsSync(path.join(ROOT, dictFile)), "municipalities.json", `${entry.id} dictionary flag doesn't match ${dictFile}`);
  if(entry.dictionary){
    const d = read(dictFile);
    check(d.source && d.updated && d.items.length, dictFile, "needs source, updated and items");
    if(d.provider) check(d.provider.name && d.provider.page, dictFile, "provider needs name and page");
    d.categories.forEach((c, i) => check(c.label && c.bins.every(b => m.bins[b]), `${dictFile} category ${i} "${c.label}"`, "needs a label and known bins"));
    d.items.forEach(([name, cat]) => check(name && d.categories[cat], `${dictFile} "${name}"`, `unknown category ${cat}`));
  }
}

/* onboarding map: every shipped pref is shaded and each city code has an SVG path */
const coverage = read("data/coverage.json");
const japan = read("data/map/japan.json");
const indexPrefs = [...new Set(index.municipalities.map(m => String(m.pref).padStart(2, "0")))].sort();
check(JSON.stringify(coverage.prefectures) === JSON.stringify(indexPrefs), "coverage.json", "prefectures must match municipalities.json");
for(const pref of coverage.prefectures){
  check(japan.prefs.some(p => p.code === pref), "data/map/japan.json", `missing prefecture outline for ${pref}`);
  const mapFile = `data/map/${pref}.json`;
  check(fs.existsSync(path.join(ROOT, mapFile)), "coverage.json", `${mapFile} is missing`);
  const mapCodes = new Set(read(mapFile).munis.map(m => m.code));
  for(const code of coverage.municipalitiesByPref[pref] ?? [])
    check(mapCodes.has(code), mapFile, `no map path for municipality ${code}`);
}

let mapMunis = 0;
for(const pref of coverage.prefectures){
  const mapFile = `data/map/${pref}.json`;
  if(fs.existsSync(path.join(ROOT, mapFile))) mapMunis += read(mapFile).munis.length;
}
const pct = mapMunis ? (100 * index.municipalities.length / mapMunis).toFixed(1) : "?";
if(errors.length){ console.error(errors.slice(0, 50).join("\n")); console.error(`\n${errors.length} problem(s)`) }
console.log(`coverage: ${index.municipalities.length}/${mapMunis} municipalities (${pct}%), ${coverage.prefectures.length}/47 prefectures`);
if(!errors.length) console.log(`ok: ${Object.keys(types).length} item types`);
else process.exitCode = 1;
