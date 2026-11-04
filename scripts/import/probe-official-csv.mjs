/* Probe CSV URLs from official-candidates.json and record those that parse as schedules.
   Usage: node scripts/import/probe-official-csv.mjs [--limit N] [--code XXXXX] [--refresh] */
import fs from "node:fs";
import path from "node:path";
import { ROOT, download, writeJSON, readJSON, decode, csvObjects } from "./lib.mjs";
import { loadOfficialCandidatesReport } from "./seeds/official-candidates.mjs";
import { load5374Catalog } from "./seeds/5374-catalog.mjs";
import { probe5374Buffer } from "./sources/5374-area-days.mjs";
import { probeDistrictWeeklyBuffer } from "./sources/district-weekly-csv.mjs";

const OUT = path.join(ROOT, ".cache/crawler/probed-schedules.json");
const MIN_AREAS = 3;
const SKIP_URL = /分別表|分別一覧|bunbetsu|facility|施設一覧|処理場|lat|lon|wkt|geometry|statistics|統計|jigyosyo|事業所|メタデータ|metadata|boundary|シール|sticker|標高|人口/i;

const argv = process.argv.slice(2);
const flag = name => argv.includes(`--${name}`);
const option = (name, fallback = "") => argv.find((_, i) => argv[i - 1] === `--${name}`) ?? fallback;
const limit = +option("limit", 0);
const onlyCode = option("code", "");
const refresh = flag("refresh");

const slug = en => String(en ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function rowsMentionMunicipality(rows, muni){
  const keys = [muni.jp, muni.jp.replace(/[市区町村]$/, ""), muni.code].filter(Boolean);
  for(const row of rows.slice(0, Math.min(rows.length, 800))){
    for(const v of Object.values(row)){
      const s = String(v ?? "");
      if(keys.some(k => s.includes(k))) return true;
    }
  }
  const blob = JSON.stringify(rows.slice(0, 3));
  return keys.some(k => blob.includes(k));
}

function urlMatchesMunicipality(url, muni){
  const u = decodeURIComponent(url).normalize("NFKC");
  if(u.includes(muni.code)) return true;
  const short = muni.jp.replace(/[市区町村]$/, "");
  if(short.length >= 2 && u.includes(short)) return true;
  const roma = slug(muni.en).replace(/-/g, "");
  return roma.length >= 4 && u.toLowerCase().includes(roma);
}

function shippedCodes(){
  const idx = path.join(ROOT, "data/municipalities.json");
  if(!fs.existsSync(idx)) return new Set();
  return new Set(readJSON(idx).municipalities.map(m => m.code));
}

async function probeOne(muni, pick, {urlOwner}){
  const buf = await download(`crawler-probe-${muni.code}`, pick.url);
  let kind = "5374", probe = probe5374Buffer(buf);
  if(!probe.ok){
    probe = probeDistrictWeeklyBuffer(buf);
    kind = "district-weekly";
  }
  if(!probe.ok || probe.areas < MIN_AREAS) return null;
  let rows = [];
  for(const enc of ["UTF-8", "CP932"]){
    rows = csvObjects(decode(buf, enc));
    if(rows.length) break;
  }
  const owner = urlOwner.get(pick.url);
  const mentioned = rowsMentionMunicipality(rows, muni);
  const urlOk = urlMatchesMunicipality(pick.url, muni);
  if(owner && owner !== muni.code && !mentioned) return null;
  if(!mentioned && !urlOk) return null;
  if(!owner && !mentioned && !urlOk) return null;
  if(!owner) urlOwner.set(pick.url, muni.code);
  return {
    code: muni.code,
    pref: muni.pref,
    jp: muni.jp,
    en: muni.en,
    url: pick.url,
    kind,
    areas: probe.areas,
    bins: probe.bins,
    candidateScore: pick.score ?? null,
  };
}

async function main(){
  const report = loadOfficialCandidatesReport();
  if(!report?.municipalities?.length){
    console.error("No official-candidates.json — run npm run discover first.");
    process.exit(1);
  }
  const shipped = shippedCodes();
  const catalog = new Set(load5374Catalog().map(r => r.code));
  const prior = !refresh && fs.existsSync(OUT) ? readJSON(OUT) : {entries: []};
  const byCode = new Map(prior.entries.map(e => [e.code, e]));

  let tried = 0, found = 0, skipped = 0;
  const urlOwner = new Map(prior.entries.map(e => [e.url, e.code]));
  const munis = report.municipalities
    .filter(m => !onlyCode || m.code === onlyCode)
    .filter(m => !shipped.has(m.code))
    .sort((a, b) => a.code.localeCompare(b.code));

  for(const muni of munis){
    if(limit && tried >= limit) break;
    if(catalog.has(muni.code) && byCode.has(muni.code)) continue;
    const csvs = (muni.candidates ?? [])
      .filter(c => c.format === "csv" && c.url && !SKIP_URL.test(c.url))
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    if(!csvs.length){ skipped++; continue }
    if(byCode.has(muni.code) && !refresh) continue;

    tried++;
    let hit = null;
    for(const pick of csvs){
      try {
        hit = await probeOne(muni, pick, {urlOwner});
        if(hit) break;
      } catch(err) {
        console.warn(`  ${muni.code} ${pick.url.slice(0, 60)}… ${err.message}`);
      }
    }
    if(hit){
      byCode.set(muni.code, {...hit, id: `${slug(muni.en)}-${muni.code}`, probedAt: new Date().toISOString()});
      found++;
      console.log(`✓ ${muni.code} ${muni.jp} ${hit.kind} ${hit.areas} areas ← ${hit.url.slice(0, 72)}…`);
    } else {
      console.log(`· ${muni.code} ${muni.jp} (${csvs.length} CSVs, none parsed)`);
    }
  }

  const entries = [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
  writeJSON(OUT, {generatedAt: new Date().toISOString(), minAreas: MIN_AREAS, entries});
  console.log(`\nWrote ${OUT}: ${entries.length} municipalities (${found} new this run, ${tried} probed, ${skipped} without CSV)`);
}

main().catch(err => { console.error(err); process.exit(1) });
