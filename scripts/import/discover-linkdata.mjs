/* Scan LinkData rdf1s####i/area_days.csv and merge into 5374-catalog.json.
   Usage: node scripts/import/discover-linkdata.mjs [--from N] [--to N] [--concurrency N] */
import fs from "node:fs";
import path from "node:path";
import { ROOT, writeJSON, readJSON } from "./lib.mjs";
import { listCities } from "./municipality-master.mjs";
import { normalize5374Catalog } from "./seeds/catalog-normalize.mjs";

const OUT = path.join(ROOT, "scripts/import/seeds/5374-catalog.json");
const UA = "Mozilla/5.0 (Wakeru linkdata discover)";
const fromId = +(process.argv.find((_, i, a) => a[i - 1] === "--from") ?? 4500);
const toId = +(process.argv.find((_, i, a) => a[i - 1] === "--to") ?? 5200);
const concurrency = +(process.argv.find((_, i, a) => a[i - 1] === "--concurrency") ?? 12);
const TIMEOUT_MS = 6000;
const FY = {validFrom: "2026-04-01", validTo: "2027-03-31"};

/** Overrides when title matching is ambiguous. */
const LINKDATA_CODE = {
  4762: "06203", 4763: "05201", 4765: "04100", 4766: "02205", 4767: "04323", 4768: "02206",
  4769: "04202", 4770: "07203", 4772: "07364", 4773: "03215", 4774: "07204", 4775: "06204",
  4777: "02207", 4778: "04209", 4779: "02445", 4780: "04100", 4781: "06210", 4782: "04203",
  4783: "06201", 4784: "08220", 4785: "04505", 4862: "04341", 1265: "31201", 7640: "23206",
  4245: "22206", 5470: "03205", 9153: "22208", 8227: "22208", 8653: "22208",
  5469: "05215",
  4776: "04341", 4786: "04205", 4764: "14207",
};

const looksLike5374 = text => {
  const head = (text.split("\n")[0] ?? "").replace(/^\uFEFF/, "").trim();
  if(!head.includes(",") || head.startsWith("<!")) return false;
  return /area_days|地名|燃|ごみ|プラ|もや/i.test(head);
};

async function fetchText(url, ms = TIMEOUT_MS){
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {headers: {"User-Agent": UA}, signal: ctrl.signal});
    if(!res.ok) return null;
    return await res.text();
  } catch { return null }
  finally { clearTimeout(t) }
}

async function probeId(id){
  const url = `http://linkdata.org/api/1/rdf1s${id}i/area_days.csv`;
  const text = await fetchText(url);
  if(!text || !looksLike5374(text)) return null;
  const lines = text.split("\n").filter(l => l.trim());
  if(lines.length < 2) return null;
  return {id, url};
}

async function workTitle(id){
  for (const base of [`https://si.linkdata.org/work/rdf1s${id}i`, `http://linkdata.org/work/rdf1s${id}i`]) {
    const html = await fetchText(base, 8000);
    if(!html) continue;
    const m = html.match(/<title[^>]*>([^<]+)/i);
    const t = (m?.[1] ?? "").replace(/Link and Publish.*$/i, "").trim();
    if(t && !/can not be accessed/i.test(t)) return t;
  }
  return "";
}

function inferCityFromCsv(text, cities){
  const sample = text.slice(0, 12000);
  const hits = cities.filter(c => sample.includes(c.jp));
  if(hits.length === 1) return hits[0];
  if(hits.length > 1){
    const cityish = hits.filter(c => c.jp.endsWith("市") || c.jp.endsWith("町"));
    if(cityish.length === 1) return cityish[0];
    hits.sort((a, b) => b.jp.length - a.jp.length);
    return hits[0];
  }
  if(/丸森町/.test(sample)) return cities.find(c => c.code === "04341") ?? null;
  if(/気仙沼/.test(sample)) return cities.find(c => c.code === "04205") ?? null;
  if(/湊浜/.test(sample)) return cities.find(c => c.code === "14207") ?? null;
  if(/仙北市/.test(sample)) return cities.find(c => c.code === "05215") ?? null;
  return null;
}

function matchCity(title, cities){
  const t = title.normalize("NFKC");
  if(!t || /can not be accessed/i.test(t)) return null;
  const hits = cities.filter(c => t.includes(c.jp) || t.includes(c.jp.replace(/[市区町村]$/, "")));
  if(hits.length === 1) return hits[0];
  if(hits.length > 1){
    const cityish = hits.filter(c => c.jp.endsWith("市"));
    if(cityish.length === 1) return cityish[0];
    hits.sort((a, b) => b.jp.length - a.jp.length);
    return hits[0];
  }
  if(/伊東市/.test(t)) return cities.find(c => c.code === "22208") ?? null;
  const roma = t.match(/5374\.jp[^(（]*[(\（]?([^)）]+)/i)?.[1];
  if(roma){
    const en = roma.trim();
    const byEn = cities.filter(c => c.en && en.includes(c.en));
    if(byEn.length === 1) return byEn[0];
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
      out[j] = await fn(items[j]);
    }
  }
  await Promise.all(Array.from({length: Math.min(n, items.length)}, worker));
  return out;
}

const cities = await listCities();
const byCode = new Map(cities.map(c => [c.code, c]));
const catalog = fs.existsSync(OUT) ? readJSON(OUT) : {municipalities: []};
const merged = new Map((catalog.municipalities ?? []).map(m => [m.code, m]));

const ids = [];
for(let id = fromId; id <= toId; id++) ids.push(id);
console.log(`scanning linkdata ${fromId}–${toId}...`);
const hits = (await pool(ids, probeId, concurrency)).filter(Boolean);
console.log(`found ${hits.length} area_days endpoints`);

let added = 0;
for(const hit of hits){
  let code = LINKDATA_CODE[hit.id];
  let city = code ? byCode.get(code) : null;
  if(!city){
    const title = await workTitle(hit.id);
    city = matchCity(title, cities);
    if(!city){
      const csv = await fetchText(hit.url);
      if(csv) city = inferCityFromCsv(csv, cities);
    }
    code = city?.code;
    if(!code) console.log(`  rdf1s${hit.id}i: unmapped — ${title.slice(0, 60)}`);
  }
  if(!code || !city) continue;
  if(merged.has(code)){
    const existing = merged.get(code);
    if(existing.url.includes("linkdata.org") && existing.linkdata !== hit.id) continue;
    if(!existing.url.includes("linkdata.org")) continue;
  }
  const id = `linkdata-${hit.id}-${code}`;
  merged.set(code, {...FY, id, code, pref: city.pref, jp: city.jp, en: city.en, url: hit.url, linkdata: hit.id});
  added++;
}

const municipalities = normalize5374Catalog([...merged.values()], cities);
writeJSON(OUT, {
  _readme: "5374 + LinkData area_days.csv. npm run discover:5374 && npm run discover:linkdata",
  version: new Date().toISOString().slice(0, 10),
  municipalities,
});
console.log(`catalog ${municipalities.length} entries (+${added} linkdata)`);
