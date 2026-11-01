/* Probe *.5374.jp/data/area_days.csv for every city in the address master; write scripts/import/seeds/5374-catalog.json.
   Usage: node scripts/import/discover-5374.mjs [--refresh] [--limit N] [--concurrency N] */
import fs from "node:fs";
import path from "node:path";
import { ROOT, writeJSON, readJSON } from "./lib.mjs";
import { listCities, slugCandidates } from "./municipality-master.mjs";
import { SEEDS_5374 } from "./seeds/prefecture-seeds.mjs";
import { MAJOR_HUBS_5374 } from "./seeds/major-hubs.mjs";
import { CURATED_5374 } from "./seeds/5374-curated.mjs";
import { normalize5374Catalog } from "./seeds/catalog-normalize.mjs";

const OUT = path.join(ROOT, "scripts/import/seeds/5374-catalog.json");
const UA = "Mozilla/5.0 (Wakeru 5374 discover; +https://github.com/)";
const limit = +(process.argv.find((_, i, a) => a[i - 1] === "--limit") ?? 0) || Infinity;
const concurrency = +(process.argv.find((_, i, a) => a[i - 1] === "--concurrency") ?? 0) || 24;
const TIMEOUT_MS = 5000;

const looksLike5374 = text => {
  const head = (text.split("\n")[0] ?? "").trim();
  if(!head.includes(",") || head.length < 8) return false;
  return /地名|name|地区|町名|区名|コース名|燃|ごみ|ゴミ|プラ|不燃|資源|生活|もや/i.test(head);
};

async function probeUrl(url){
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {headers: {"User-Agent": UA}, signal: ctrl.signal});
    if(!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if(buf.length < 40) return null;
    const text = buf.toString("utf8");
    if(!looksLike5374(text) && !looksLike5374(new TextDecoder("shift_jis").decode(buf))) return null;
    return url;
  } catch { return null }
  finally { clearTimeout(t) }
}

async function probeCity(city){
  for(const slug of slugCandidates(city.cityRoma)){
    const url = `http://${slug}.5374.jp/data/area_days.csv`;
    const ok = await probeUrl(url);
    if(ok) return {slug, url};
  }
  return null;
}

async function pool(items, fn, n){
  const out = new Array(items.length);
  let i = 0;
  async function worker(){
    for(;;){
      const j = i++;
      if(j >= items.length) break;
      out[j] = await fn(items[j], j);
    }
  }
  await Promise.all(Array.from({length: Math.min(n, items.length)}, worker));
  return out;
}

const FY = {validFrom: "2026-04-01", validTo: "2027-03-31"};
const known = [...SEEDS_5374, ...MAJOR_HUBS_5374, ...CURATED_5374];
const byCode = new Map(known.map(s => [s.code, {...FY, ...s}]));
if(fs.existsSync(OUT)){
  for(const m of (readJSON(OUT).municipalities ?? []))
    if(!byCode.has(m.code)) byCode.set(m.code, m);
}

const cities = (await listCities()).slice(0, limit);
console.log(`probing up to ${cities.length} cities (${concurrency} concurrent)...`);

const found = await pool(cities, async city => {
  if(byCode.has(city.code)) return null;
  const hit = await probeCity(city);
  if(!hit) return null;
  const slug = hit.slug.replace(/[^a-z0-9-]/g, "") || "city";
  const id = `${slug}-${city.code}`;
  return {
    ...FY,
    id,
    code: city.code,
    pref: city.pref,
    jp: city.jp,
    en: city.en,
    url: hit.url,
  };
}, concurrency);

for(const row of found.filter(Boolean)){
  if(!byCode.has(row.code)) byCode.set(row.code, row);
}

const catalog = normalize5374Catalog([...byCode.values()], cities);
writeJSON(OUT, {_readme: "Auto-discovered + curated 5374 area_days.csv sources. Regenerate: node scripts/import/discover-5374.mjs", version: new Date().toISOString().slice(0, 10), municipalities: catalog});
console.log(`wrote ${catalog.length} entries → ${path.relative(ROOT, OUT)} (+${found.filter(Boolean).length} newly discovered)`);
