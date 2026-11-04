/* Crawl official site → extract schedule → write data/municipalities/…/municipality.json (incremental).
   Usage:
     node scripts/import/publish-official.mjs --pref 31
     node scripts/import/publish-official.mjs --code 05203 --include-covered
     node scripts/import/publish-official.mjs --all --limit 20 */
import fs from "node:fs";
import path from "node:path";
import { ROOT, readJSON, writeJSON } from "./lib.mjs";
import { listCities } from "./municipality-master.mjs";
import {
  crawlMunicipality,
  openDataDirectory,
  jlisOfficialHomes,
} from "./discover-official.mjs";
import { findExtractableSchedule, convertExtractedSchedule, slug } from "./official-extract.mjs";
import { naviDictionary } from "./sources/sodaigominavi.mjs";
import { autoSorting, autoPlasticTest } from "./autosort.mjs";
import { tokyoMetroEntries } from "./seeds/tokyo-metro.mjs";

const WARDS_DIR = path.join(ROOT, "scripts/import/wards");
function verifiedWardBlocksMetro(code){
  for(const id of fs.readdirSync(WARDS_DIR)){
    const rulesetPath = path.join(WARDS_DIR, id, "ruleset.json");
    if(!fs.existsSync(rulesetPath)) continue;
    const rs = readJSON(rulesetPath);
    if(rs.code === code && rs.status === "verified") return true;
  }
  return false;
}

const argv = process.argv.slice(2);
const flag = name => argv.includes(`--${name}`);
const option = (name, fallback = "") => argv.find((_, i) => argv[i - 1] === `--${name}`) ?? fallback;
const requestedLimit = +option("limit", 10);

const PREF_EN = ["", "Hokkaido", "Aomori", "Iwate", "Miyagi", "Akita", "Yamagata", "Fukushima", "Ibaraki", "Tochigi", "Gunma", "Saitama",
  "Chiba", "Tokyo", "Kanagawa", "Niigata", "Toyama", "Ishikawa", "Fukui", "Yamanashi", "Nagano", "Gifu", "Shizuoka", "Aichi", "Mie",
  "Shiga", "Kyoto", "Osaka", "Hyogo", "Nara", "Wakayama", "Tottori", "Shimane", "Okayama", "Hiroshima", "Yamaguchi", "Tokushima",
  "Kagawa", "Ehime", "Kochi", "Fukuoka", "Saga", "Nagasaki", "Kumamoto", "Oita", "Miyazaki", "Kagoshima", "Okinawa"];

const prefSlug = m => `${String(m.pref).padStart(2, "0")}-${slug(PREF_EN[+m.pref])}`;
const catalogPath = m => `${prefSlug(m)}/${m.code}-${slug(m.en)}`;
const OUT = path.join(ROOT, "data/municipalities");
const today = new Date().toISOString().slice(0, 10);

function coveredCodes(){
  const idx = path.join(ROOT, "data/municipalities.json");
  if(!fs.existsSync(idx)) return new Set();
  return new Set(readJSON(idx).municipalities.map(m => m.code));
}

function upsertIndex(m, hasDict){
  const indexPath = path.join(ROOT, "data/municipalities.json");
  const index = fs.existsSync(indexPath)
    ? readJSON(indexPath)
    : {_readme: "Municipalities shown in the app.", version: today, municipalities: []};
  const entry = {
    id: m.id, code: m.code, pref: m.pref, prefEn: PREF_EN[+m.pref], en: m.en, jp: m.jp,
    verified: m.verified, path: catalogPath(m), dictionary: hasDict,
    source: m.attribution?.schedule?.name ?? "Official municipal website (crawl + extract)",
  };
  index.version = today;
  index.municipalities = [...index.municipalities.filter(x => x.code !== m.code), entry]
    .sort((a, b) => a.pref.localeCompare(b.pref) || a.en.localeCompare(b.en));
  writeJSON(indexPath, index);

  const municipalitiesByPref = {};
  for(const row of index.municipalities){
    const pref = String(row.pref).padStart(2, "0");
    (municipalitiesByPref[pref] ??= []).push(row.code);
  }
  for(const pref of Object.keys(municipalitiesByPref)) municipalitiesByPref[pref].sort();
  writeJSON(path.join(ROOT, "data/coverage.json"), {
    _readme: "Prefectures lit on the onboarding Japan map. Updated by publish-official / import.",
    version: today,
    prefectures: Object.keys(municipalitiesByPref).sort(),
    municipalitiesByPref,
  });
}

function writeShipped(raw, dict){
  const m = {...raw, updated: today};
  const dir = path.join(OUT, catalogPath(m));
  fs.mkdirSync(dir, {recursive: true});
  writeJSON(path.join(dir, "municipality.json"), m);
  const dictPath = path.join(dir, "dictionary.json");
  if(dict) writeJSON(dictPath, dict);
  else if(fs.existsSync(dictPath)) fs.rmSync(dictPath);
  upsertIndex(m, Boolean(dict));
}

function tokyoMetroFallback(city){
  if(city.pref !== "13") return null;
  if(verifiedWardBlocksMetro(city.code)) return null;
  return tokyoMetroEntries().find(e => e.code === city.code) ?? null;
}

async function publishOne(city, home, openData){
  const crawl = await crawlMunicipality(city, home, openData);
  const hit = await findExtractableSchedule(city, crawl.candidates, {home});
  const metro = !hit ? tokyoMetroFallback(city) : null;
  if(!hit && !metro){
    console.log(`  skip ${city.code} ${city.jp}: no parseable schedule (${crawl.candidates.length} candidates, ${crawl.pagesVisited} pages)`);
    return false;
  }
  let raw = metro
    ? await metro.convert(today)
    : await convertExtractedSchedule(city, hit, today);
  const {skippedRows, extractedAt, ...mBody} = raw;
  raw = mBody;
  const navi = await naviDictionary(raw.code, raw.jp, raw.bins);
  if(navi?.dict){
    if(!Object.keys(raw.sorting ?? {}).length) raw.sorting = autoSorting(navi.entries);
    if(Object.keys(raw.sorting ?? {}).length) raw.plasticTest = autoPlasticTest(raw.sorting, raw.bins);
  }
  if(!raw.plasticTest && raw.bins?.plastic){
    const otherwise = raw.bins.non_burnable ? "non_burnable" : "burnable";
    raw.plasticTest = {
      products: true,
      summary: `Clean plastic packaging goes to ${raw.bins.plastic.en}. Other plastic or dirty items: check the city website.`,
      bin: "plastic",
      otherwise,
    };
  }
  writeShipped(raw, navi?.dict ?? null);
  const via = metro ? `tokyo-metro ${metro.id}` : `${hit.kind}`;
  const src = metro ? metro.source.url : hit.url;
  console.log(`  ✓ ${city.code} ${city.jp}: ${via} ${raw.areas.length} areas ← ${src.slice(0, 70)}…`);
  if(skippedRows) console.log(`    (${skippedRows} rows skipped)`);
  return true;
}

async function main(){
  const code = option("code");
  const pref = option("pref");
  const covered = coveredCodes();
  let cities = (await listCities())
    .filter(c => !code || c.code === code)
    .filter(c => !pref || c.pref === pref);
  if(!flag("include-covered")) cities = cities.filter(c => !covered.has(c.code));
  cities.sort((a, b) => a.pref.localeCompare(b.pref) || a.code.localeCompare(b.code));
  if(!flag("all")) cities = cities.slice(0, requestedLimit);
  if(!cities.length) throw new Error("no municipalities match (use --include-covered to refresh existing)");

  console.log(`publish-official: ${cities.length} municipalities (crawl → extract → JSON)`);
  const [directory, homes] = await Promise.all([
    openDataDirectory(),
    jlisOfficialHomes(cities).catch(err => {
      console.warn(`J-LIS directory unavailable: ${err.message}`);
      return new Map();
    }),
  ]);

  let published = 0, failed = 0;
  for(let i = 0; i < cities.length; i++){
    const city = cities[i];
    console.log(`[${i + 1}/${cities.length}] ${city.code} ${city.jp}`);
    const openData = directory.get(city.code);
    const derivedHome = openData?.urls?.find(url => /\.(?:lg|go)\.jp$|\.city\.|\.town\.|\.vill\./i.test(new URL(url).hostname));
    const home = homes.get(city.code) ?? (derivedHome ? `${new URL(derivedHome).origin}/` : null);
    try {
      if(await publishOne(city, home, openData)) published++;
    } catch(err) {
      failed++;
      console.error(`  FAILED ${city.code}: ${err.message}`);
    }
  }
  console.log(`\nDone: ${published} published, ${failed} errors, ${cities.length - published - failed} skipped`);
  process.exitCode = failed ? 1 : 0;
}

main().catch(err => { console.error(err.stack ?? err.message); process.exitCode = 1 });
