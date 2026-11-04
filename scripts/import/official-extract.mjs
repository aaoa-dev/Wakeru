/* Crawl hit → parseable schedule (5374 CSV, district-weekly CSV, or HTML table). */
import { download, decode, csvObjects } from "./lib.mjs";
import { probe5374Buffer } from "./sources/5374-area-days.mjs";
import { probeDistrictWeeklyBuffer } from "./sources/district-weekly-csv.mjs";
import { probeHtmlWeeklyTable } from "./sources/html-weekly-table.mjs";
import { convert5374 } from "./sources/5374-area-days.mjs";
import { convertDistrictWeeklyCsv, GENERIC_HEADER_TO_BIN } from "./sources/district-weekly-csv.mjs";
import { convertHtmlWeekly } from "./sources/html-weekly-table.mjs";
import { GENERIC_HTML_PROBE_COLUMNS, GENERIC_HTML_PROBE_BINS } from "./seeds/html-probe-columns.mjs";
import { slugCandidates } from "./municipality-master.mjs";
import { convertSmartLgovTrash } from "./sources/smart-lgov-trash.mjs";

const MIN_AREAS = 3;
const SKIP_CSV = /分別表|分別一覧|bunbetsu|facility|施設一覧|処理場|lat|lon|wkt|geometry|statistics|統計|jigyosyo|事業所|メタデータ|metadata|boundary|シール|sticker|標高|人口/i;

export const slug = en => String(en ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function rowsMentionMunicipality(rows, muni){
  const keys = [muni.jp, muni.jp.replace(/[市区町村]$/, ""), muni.code].filter(Boolean);
  for(const row of rows.slice(0, Math.min(rows.length, 800))){
    for(const v of Object.values(row)){
      const s = String(v ?? "");
      if(keys.some(k => s.includes(k))) return true;
    }
  }
  return keys.some(k => JSON.stringify(rows.slice(0, 3)).includes(k));
}

export function urlMatchesMunicipality(url, muni){
  const u = decodeURIComponent(url).normalize("NFKC");
  if(u.includes(muni.code)) return true;
  const short = muni.jp.replace(/[市区町村]$/, "");
  if(short.length >= 2 && u.includes(short)) return true;
  const roma = slug(muni.en).replace(/-/g, "");
  return roma.length >= 4 && u.toLowerCase().includes(roma);
}

function csvRows(buf){
  for(const enc of ["UTF-8", "CP932"]){
    const rows = csvObjects(decode(buf, enc));
    if(rows.length) return rows;
  }
  return csvObjects(decode(buf, "CP932"));
}

function csvAllowed(muni, url, rows){
  return urlMatchesMunicipality(url, muni) || rowsMentionMunicipality(rows, muni);
}

const DISTRICT_BINS = {
  burnable: {label: "燃やすごみ", en: "Burnable", kind: "burn"},
  non_burnable: {label: "燃やさないごみ", en: "Non-burnable", kind: "non"},
  plastic: {label: "プラスチック", en: "Plastic", kind: "pla"},
  res: {label: "資源ごみ", en: "Recyclables", kind: "res"},
  hazardous: {label: "有害ごみ", en: "Hazardous", kind: "haz"},
  oversized: {label: "粗大ごみ", en: "Oversized", kind: "big"},
  no: {label: "収集しないもの", en: "Not collected", kind: "no"},
};

async function try5374Subdomain(city){
  if(!city.cityRoma) return null;
  for(const sub of slugCandidates(city.cityRoma)){
    const url = `http://${sub}.5374.jp/data/area_days.csv`;
    try {
      const buf = await download(`publish-${city.code}`, url);
      const probe = probe5374Buffer(buf);
      if(probe.ok && probe.areas >= MIN_AREAS) return {kind: "5374", url, score: 10};
    } catch { /* next slug */ }
  }
  return null;
}

async function trySmartLgovSearchPage(city, candidates, home){
  const urls = [...new Set([
    home,
    ...(candidates ?? []).filter(c => c.format === "html").slice(0, 12).map(c => c.url),
  ].filter(Boolean))];
  for(const url of urls){
    try {
      const html = decode(await download(`publish-${city.code}`, url));
      if(!/cms_api_token\s*=/.test(html) || !/cms_api_domain\s*=/.test(html)) continue;
      if(!/ごみ|ゴミ|gomi|trash|収集/i.test(html)) continue;
      return {kind: "smart-lgov", url, searchUrl: url, score: 9};
    } catch { /* next */ }
  }
  return null;
}

/** @returns {Promise<{kind:string, url:string, score:number, searchUrl?:string}|null>} */
export async function findExtractableSchedule(city, candidates, {home = null} = {}){
  const picks = [...(candidates ?? [])].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  for(const pick of picks){
    if(pick.format === "csv" && pick.url && !SKIP_CSV.test(pick.url)){
      try {
        const buf = await download(`publish-${city.code}`, pick.url);
        const rows = csvRows(buf);
        if(!csvAllowed(city, pick.url, rows)) continue;
        let probe = probe5374Buffer(buf);
        if(probe.ok && probe.areas >= MIN_AREAS) return {kind: "5374", url: pick.url, score: pick.score ?? 0};
        probe = probeDistrictWeeklyBuffer(buf);
        if(probe.ok && probe.areas >= MIN_AREAS) return {kind: "district-weekly", url: pick.url, score: pick.score ?? 0};
      } catch { /* try next */ }
    }
    if(pick.format === "html" && pick.url && (pick.score ?? 0) >= 7){
      try {
        const html = decode(await download(`publish-${city.code}`, pick.url));
        const probe = probeHtmlWeeklyTable(html, GENERIC_HTML_PROBE_COLUMNS);
        if(probe.ok && probe.areas >= MIN_AREAS) return {kind: "html", url: pick.url, score: pick.score ?? 0};
      } catch { /* try next */ }
    }
  }
  return (await try5374Subdomain(city))
    ?? (await trySmartLgovSearchPage(city, candidates, home));
}

/** @param {{code:string,pref:string,jp:string,en:string}} city */
export async function convertExtractedSchedule(city, hit, today){
  const id = `${slug(city.en)}-${city.code}`;
  const cacheKey = `publish-${city.code}`;
  const source = {
    name: "Official municipal website (crawl + extract)",
    url: hit.url,
    license: "Confirm on municipality site",
  };
  if(hit.kind === "5374"){
    return convert5374({id, code: city.code, pref: city.pref, jp: city.jp, en: city.en, url: hit.url, cacheKey, source}, today);
  }
  if(hit.kind === "district-weekly"){
    return convertDistrictWeeklyCsv({
      cacheKey,
      source,
      pref: city.pref,
      bins: DISTRICT_BINS,
      headerToBin: GENERIC_HEADER_TO_BIN,
      entry: {id, code: city.code, jp: city.jp, en: city.en, validFrom: "2026-04-01", validTo: "2027-03-31"},
      loadRows: async () => csvRows(await download(cacheKey, hit.url)),
      calendarNote: "Weekday rules extracted from the city's official open data (automated crawl). Confirm holidays on the city site.",
    }, today);
  }
  if(hit.kind === "html"){
    return convertHtmlWeekly({
      id, code: city.code, pref: city.pref, jp: city.jp, en: city.en,
      url: hit.url,
      validFrom: "2026-04-01",
      validTo: "2027-03-31",
      sourceName: source.name,
      columns: GENERIC_HTML_PROBE_COLUMNS,
      bins: GENERIC_HTML_PROBE_BINS,
      note: "Weekday rules extracted from the city's official HTML schedule table (automated crawl).",
    }, today);
  }
  return convertSmartLgovTrash({
    id,
    code: city.code,
    pref: city.pref,
    jp: city.jp,
    en: city.en,
    searchUrl: hit.searchUrl ?? hit.url,
    dataType: 2,
    validFrom: "2026-04-01",
    validTo: "2027-03-31",
    sourceName: source.name,
  }, today);
}
