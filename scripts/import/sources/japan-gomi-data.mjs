/* japan-gomi-data (https://github.com/tecolicom/japan-gomi-data, CC BY 4.0): collection schedules that its maintainers
   converted from official sources and checked against official calendars. Converts one municipality into Wakeru's
   calendar + areas model. Their verification records are free text in meta.yaml notes, so "verified" is read from them. */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import YAML from "yaml";
import { ROOT, REFRESH, download, abrRows, townRegistry, splitTown, parsePart, partEn, kanaToRomaji } from "../lib.mjs";

export const REPO = {name:"japan-gomi-data", url:"https://github.com/tecolicom/japan-gomi-data", license:"CC BY 4.0"};
const TARBALL = "https://api.github.com/repos/tecolicom/japan-gomi-data/tarball/main";
const DIR = path.join(ROOT, ".cache/sources/japan-gomi-data");

/* their category vocabulary (schema/categories.yaml) → Wakeru bin colour kind and English name */
const CATEGORY = {
  burnable:["burn", "Burnable"], kitchen:["burn", "Food waste"], non_burnable:["non", "Non-burnable"], plastic:["pla", "Plastic"],
  pet_bottle:["res", "PET bottles"], beverage_can:["res", "Cans"], glass_bottle:["res", "Glass bottles"], paper_cloth:["res", "Paper & cloth"],
  cloth:["res", "Clothes & fabric"], paper:["res", "Paper"], hazardous:["haz", "Hazardous"], spray_can:["haz", "Spray cans"],
  oversized:["big", "Oversized"], metal:["res", "Metal"],
};
const DAY = {SU:0, MO:1, TU:2, WE:3, TH:4, FR:5, SA:6};

/* download the repo tarball once (cached; --refresh re-downloads) and return its directory and commit */
export async function loadRepo(){
  const repo = path.join(DIR, "repo");
  if(REFRESH || !fs.existsSync(repo)){
    const tgz = await download("japan-gomi-data", TARBALL);
    fs.rmSync(repo, {recursive:true, force:true});
    fs.mkdirSync(repo, {recursive:true});
    const file = path.join(DIR, "main.tgz"); fs.writeFileSync(file, tgz);
    execFileSync("tar", ["-xzf", file, "-C", repo, "--strip-components=1"]);
    const top = execFileSync("tar", ["-tzf", file]).toString().split("\n")[0];
    fs.writeFileSync(path.join(repo, ".commit"), top.replace(/\/$/, "").split("-").pop());
  }
  return {dir:repo, commit:fs.readFileSync(path.join(repo, ".commit"), "utf8").trim()};
}
const readYAML = file => YAML.parse(fs.readFileSync(file, "utf8"));

/* municipalities that have at least one schedule period */
export function listMunicipalities({dir}){
  const root = path.join(dir, "municipalities"), out = [];
  for(const pref of fs.readdirSync(root)) for(const handle of fs.readdirSync(path.join(root, pref))){
    const mdir = path.join(root, pref, handle);
    const periods = fs.readdirSync(mdir).filter(d => /^\d{4}-\d{2}--\d{4}-\d{2}$/.test(d)).sort();
    if(periods.length) out.push({handle, dir:mdir, periods, meta:readYAML(path.join(mdir, "meta.yaml"))});
  }
  return out;
}

/* their own records decide: no verification note, or a note that calls (part of) the data 未検証, means hidden */
export function verification(meta){
  const notes = (meta.notes ?? []).join("\n");
  if(/未検証/.test(notes)) return {ok:false, reason:"their records mark part of the data 未検証 (unverified)", tier:"partial"};
  if(!/照合|検証\(/.test(notes)) return {ok:false, reason:"no verification record", tier:"no-note"};
  return {ok:true, tier:"verified"};
}

const monthEnd = ym => { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
/* the period that covers today, else the next one to start, else the latest */
function pickPeriod(periods, today){
  const span = p => { const [a, b] = p.split("--"); return [`${a}-01`, monthEnd(b)] };
  return periods.find(p => { const [a, b] = span(p); return a <= today && today <= b })
    ?? periods.find(p => span(p)[0] > today) ?? periods[periods.length - 1];
}

function convertRule(r){
  if(r.pattern === "weekly") return r.days.map(d => DAY[d]).sort((a, b) => a - b);
  if(r.pattern === "monthly_nth"){
    if(r.days.length !== 1) throw new Error(`monthly_nth with several days (${r.days}) is not supported`);
    return {day:DAY[r.days[0]], weeks:[...r.occurrences].sort()};
  }
  if(r.pattern === "monthly_specific") return {dates:[...r.dates].sort()};
  throw new Error(`unknown rule pattern "${r.pattern}"`);
}
/* per-date cancellations / extra collections become except / add lists on the rule itself */
function withOverride(rule, key, date){
  const obj = Array.isArray(rule) ? {days:rule} : {...rule};
  obj[key] = [...new Set([...(obj[key] ?? []), date])].sort();
  return obj;
}
/* a category with several rules (飯能: oversized on the 3rd Mon and the 1st Wed) becomes {any:[rule, rule]} */
function coursePattern(course){
  const pattern = {};
  for(const r of course.rules){
    if(r.pattern === "monthly_specific" && !r.dates?.length) continue; // e.g. 日高市 paper: left to community collection
    const rule = convertRule(r), prev = pattern[r.category];
    pattern[r.category] = !prev ? rule : {any:[...(prev.any ?? [prev]), rule]};
  }
  for(const o of course.overrides ?? []){
    const cats = o.category ? [o.category] : Object.keys(pattern);
    for(const c of cats){
      if(!pattern[c]){ if(o.cancelled) continue; throw new Error(`override adds ${c} on ${o.date}, which course ${course.metadata.course} doesn't collect`) }
      pattern[c] = withOverride(pattern[c], o.cancelled ? "except" : "add", o.date);
    }
  }
  return pattern;
}

const stripEn = s => (s ?? "").replace(/-(shi|ku|machi|cho|mura|son)$/i, "");
const hiraToKata = s => s.replace(/[ぁ-ゖ]/g, ch => String.fromCharCode(ch.charCodeAt(0) + 0x60));

/* one area name ("井草1～3丁目", "梶ヶ谷（宮前区）") → Wakeru areas, using the official town list for names and romaji */
function parseArea(a, towns, wardPrefix){
  const name = a.name.normalize("NFKC").replace(/[(（][^()（）]*区[)）]$/, "").trim();
  let town, rest;
  try { [town, rest] = splitTown(name, towns) } catch { town = name.replace(/[0-9０-９(（〔].*$/, "").trim() || name; rest = name.slice(town.length) }
  const reg = towns.get(town);
  const kana = reg?.kana || hiraToKata((a.yomi ?? "").replace(/[0-9\-・,、～〜]/g, ""));
  const townEn = reg?.en || kanaToRomaji(kana) || town;
  let parts;
  try { parts = parsePart(rest) } catch { parts = [{chome:null, detail:rest.trim() || null}] }
  return parts.map(p => ({
    town:wardPrefix.jp + town, townEn:wardPrefix.en ? `${wardPrefix.en}, ${townEn}` : townEn, kana:wardPrefix.kana + kana,
    chome:p.chome, detail:p.detail, en:partEn(p), jp:parts.length > 1 ? `${p.chome?.join("・") ?? ""}${p.chome ? "丁目" : ""}${p.detail ?? ""}` : (rest.trim() || "全域"),
    ...(a.note ? {note:a.note} : {}), known:!!reg,
  }));
}

/* one municipality → {id, code, pref, jp, en, bins, calendar, areas, sources, attribution, extractedAt, period} */
export async function convert(m, repo, today){
  const {meta, dir} = m;
  const period = pickPeriod(m.periods, today);
  const taxonomy = readYAML(path.join(dir, "taxonomy.yaml"));
  const vocab = readYAML(path.join(repo.dir, "schema/categories.yaml")).categories;
  const pref = meta.code.slice(0, 2);
  const rows = (await abrRows(pref)).filter(r => r.city === meta.name_ja);
  if(!rows.length) throw new Error(`${meta.name_ja} is not in the official town list for prefecture ${pref}`);
  const wards = new Map(rows.filter(r => r.ward).map(r => [r.ward, {jp:r.ward, en:r.ward_roma, kana:r.ward_kana}]));
  /* town rows of designated cities carry ward codes (横浜市鶴見区 14101), so only plain municipalities can be checked */
  const code = wards.size ? meta.code : rows[0].lg_code.slice(0, 5);
  const codeNote = code !== meta.code ? [`meta.yaml code ${meta.code} differs from the official town list (${code}); using ${code}`] : [];

  const bins = {};
  for(const c of taxonomy.categories){
    if(!CATEGORY[c]) throw new Error(`unknown category "${c}"`);
    bins[c] = {label:taxonomy.overrides?.[c]?.label ?? vocab[c].label, en:CATEGORY[c][1], kind:CATEGORY[c][0]};
  }
  bins.oversized ??= {label:"粗大ごみ", en:"Oversized", kind:"big"};
  bins.no = {label:"収集しないもの", en:"Not collected", kind:"no"};

  const files = fs.readdirSync(path.join(dir, period)).filter(f => /^course-.*\.yaml$/.test(f)).sort((a, b) => a.localeCompare(b, "en", {numeric:true}));
  const patterns = {}, areas = [], unknown = new Map(), registries = new Map();
  let extractedAt = "";
  for(const f of files){
    const course = readYAML(path.join(dir, period, f));
    const id = course.metadata.course;
    patterns[id] = coursePattern(course);
    for(const u of course.unknown_periods ?? []) unknown.set(`${u.from}|${u.to}`, {from:u.from, to:u.to});
    if(course.metadata.source.extracted_at > extractedAt) extractedAt = course.metadata.source.extracted_at;
    /* designated cities name courses by ward ("aoba-1"); otherwise the whole city's town list is used */
    const slug = id.replace(/-\d+[a-z]?$/i, "").toLowerCase();
    const ward = [...wards.values()].find(w => w.en.toLowerCase().replace(/-ku$/, "") === slug);
    const wardPrefix = ward ?? {jp:"", en:"", kana:""}, wardJp = ward?.jp ?? "";
    if(!registries.has(wardJp)) registries.set(wardJp, await townRegistry(meta.name_ja, {pref, ward:wardJp}));
    for(const a of course.metadata.areas ?? []) for(const area of parseArea(a, registries.get(wardJp), wardPrefix)) areas.push({...area, pattern:id});
  }
  const [from, to] = period.split("--");
  const unknownTowns = new Set(areas.filter(a => !a.known).map(a => a.town));
  for(const a of areas) delete a.known;
  areas.sort((x, y) => x.kana.localeCompare(y.kana, "ja") || (x.chome?.[0] ?? 0) - (y.chome?.[0] ?? 0));
  return {
    id:m.handle, code, pref, jp:meta.name_ja, en:stripEn(rows[0].city_roma), period, extractedAt, unknownTowns:[...unknownTowns], codeNote,
    sources:[meta.source?.index_url, meta.source?.schedule_url, meta.source?.yearend_url].filter(Boolean),
    bins,
    calendar:{
      noCollection:{weekdays:[], dates:[]},
      note:`Schedule converted by japan-gomi-data from ${meta.name_ja}'s official sources and checked against the official calendar.`,
      validFrom:`${from}-01`, validTo:monthEnd(to), ...(unknown.size ? {unknown:[...unknown.values()]} : {}), patterns,
    },
    areas,
    attribution:{schedule:{...REPO, commit:repo.commit, path:`municipalities/${path.basename(path.dirname(dir))}/${m.handle}`}},
  };
}
