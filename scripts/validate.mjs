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

/* shared */
const types = read("data/shared/types.json");
for(const it of read("data/shared/items.json")){
  check(it.en && it.jp && it.outcomes?.length, `items.json "${it.en}"`, "needs en, jp and at least one outcome");
  for(const o of it.outcomes ?? []) check(types[o.type], `items.json "${it.en}"`, `unknown type "${o.type}"`);
}
for(const g of read("data/shared/glossary.json")) check(KINDS.includes(g.bin), `glossary.json "${g.jp}"`, `unknown bin kind "${g.bin}"`);

function checkRule(rule, where){
  if(Array.isArray(rule)) return check(rule.length && rule.every(d => Number.isInteger(d) && d >= 0 && d <= 6), where, "weekly rule needs weekdays 0–6");
  if(rule?.dates) return check(rule.dates.length && rule.dates.every(d => ISO.test(d)) && rule.dates.every((d, i) => !i || d > rule.dates[i-1]), where, "dates must be sorted ISO dates");
  check(Number.isInteger(rule?.day) && rule.day >= 0 && rule.day <= 6 && rule.weeks?.length && rule.weeks.every(w => w >= 1 && w <= 5), where, "nth-weekday rule needs day 0–6 and weeks 1–5");
}

/* wards */
const index = read("data/wards.json");
check(new Set(index.wards.map(w => w.id)).size === index.wards.length, "wards.json", "duplicate ward ids");
for(const entry of index.wards){
  const file = `data/wards/${entry.id}.json`;
  if(!fs.existsSync(path.join(ROOT, file))){ check(false, "wards.json", `${file} is missing`); continue }
  const w = read(file), bins = Object.keys(w.bins);
  check(w.id === entry.id && w.en === entry.en && w.jp === entry.jp, file, "id/en/jp differ from wards.json");
  check(ISO.test(w.verified ?? ""), file, "needs a verified date");
  check(w.sources?.length, file, "needs official sources");
  for(const [id, b] of Object.entries(w.bins)) check(KINDS.includes(b.kind) && b.en && b.label, `${file} bin ${id}`, "needs label, en and a known kind");
  for(const t of Object.keys(types)){
    const s = w.sorting[t], bin = typeof s === "string" ? s : s?.bin;
    check(bin && w.bins[bin], `${file} sorting`, `type "${t}" ${bin ? `uses unknown bin "${bin}"` : "has no bin"}`);
  }
  check(w.plasticTest && typeof w.plasticTest.products === "boolean" && w.plasticTest.summary, file, "plasticTest needs products and summary");
  check(w.bins.pla && w.bins.burn, file, "the plastic test needs pla and burn bins");
  const nc = w.calendar.noCollection;
  check(Array.isArray(nc?.weekdays) && Array.isArray(nc?.dates) && nc.dates.every(d => MONTH_DAY.test(d)), file, "noCollection needs weekdays and MM-DD dates");
  for(const [bin, dates] of Object.entries(nc?.bins ?? {})) check(w.bins[bin] && dates.every(d => MONTH_DAY.test(d)), file, `noCollection.bins.${bin} is invalid`);
  for(const bin of Object.keys(w.calendar.putOutBy ?? {})) check(w.bins[bin], file, `putOutBy uses unknown bin "${bin}"`);
  if(w.calendar.validTo) check(ISO.test(w.calendar.validTo), file, "validTo must be an ISO date");
  for(const [id, p] of Object.entries(w.calendar.patterns)) for(const [bin, rule] of Object.entries(p)){
    check(bins.includes(bin), `${file} pattern ${id}`, `unknown bin "${bin}"`);
    checkRule(rule, `${file} pattern ${id} ${bin}`);
    for(const d of rule?.dates ?? []){
      const off = nc.weekdays.includes(new Date(d + "T00:00").getDay()) || nc.dates.includes(d.slice(5)) || nc.bins?.[bin]?.includes(d.slice(5));
      check(!off, `${file} pattern ${id} ${bin}`, `${d} falls on a no-collection day, so the app would hide it`);
    }
  }
  check(w.areas.length, file, "has no areas");
  for(const a of w.areas){
    check(a.town && a.townEn && a.kana && a.en && a.jp, `${file} area ${a.town} ${a.jp}`, "missing names");
    check(w.calendar.patterns[a.pattern], `${file} area ${a.town} ${a.jp}`, `unknown pattern "${a.pattern}"`);
  }
  const dictFile = `data/wards/${entry.id}.dict.json`;
  check(entry.dictionary === fs.existsSync(path.join(ROOT, dictFile)), "wards.json", `${entry.id} dictionary flag doesn't match ${dictFile}`);
  if(entry.dictionary){
    const d = read(dictFile);
    d.categories.forEach((c, i) => check(c.bins.length && c.bins.every(b => w.bins[b]), `${dictFile} category ${i} "${c.label}"`, "needs known bins"));
    d.items.forEach(([name, cat]) => check(name && d.categories[cat], `${dictFile} "${name}"`, `unknown category ${cat}`));
  }
}

if(errors.length){ console.error(errors.join("\n")); console.error(`\n${errors.length} problem(s)`); process.exitCode = 1 }
else console.log(`ok: ${index.wards.length} wards, ${Object.keys(types).length} types`);
