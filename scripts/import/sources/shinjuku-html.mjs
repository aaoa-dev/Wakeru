/* Shinjuku Ward: town × weekday HTML table (resources, burnable, bulky non-burnable). */
import { download, decode } from "../lib.mjs";
import { buildFromDistricts, cellRule } from "./html-weekly-table.mjs";

const URL = "https://www.city.shinjuku.lg.jp/seikatsu/file09_01_00001.html";

export const SOURCE = {
  name: "Shinjuku Ward collection weekday table (official HTML)",
  url: URL,
  license: "Shinjuku City website (proprietary-site)",
};

const BINS = {
  burnable: {label: "燃やすごみ", en: "Burnable", kind: "burn"},
  res: {label: "資源", en: "Recyclables", kind: "res"},
  non_burnable: {label: "金属・陶器・ガラスごみ", en: "Metal, ceramic & glass", kind: "non"},
  no: {label: "収集しないもの", en: "Not collected", kind: "no"},
};

function stripTags(html){
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function parse(html, validFrom, validTo){
  const rows = [];
  for(const block of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)){
    const cells = [...block[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => stripTags(c[1]));
    if(cells.length >= 5) rows.push(cells);
  }
  if(rows.length < 10) throw new Error("expected Shinjuku schedule table");
  const districts = [];
  for(const cells of rows.slice(1)){
    const name = cells[1]?.trim();
    if(!name || name === "集積所の住所" || /^[あ-ん]$/.test(name) && cells[1] === name && cells.length < 6) continue;
    if(/町名の頭文字|資源の回収日/.test(cells.join(""))) continue;
    const res = cells[2]?.trim();
    const burn = cells[3]?.trim();
    const non = cells[4]?.trim();
    if(!res || !burn || !non || /カレンダー/.test(non)) continue;
    const schedule = {};
    const rRes = cellRule(res, validFrom, validTo);
    const rBurn = cellRule(burn, validFrom, validTo);
    const rNon = cellRule(non, validFrom, validTo);
    if(rRes) schedule.res = rRes;
    if(rBurn) schedule.burnable = rBurn;
    if(rNon) schedule.non_burnable = rNon;
    if(Object.keys(schedule).length) districts.push({jp: name, schedule});
  }
  if(districts.length < 50) throw new Error(`too few Shinjuku rows (${districts.length})`);
  return districts;
}

export async function convert(extractedAt){
  const validFrom = "2026-04-01";
  const validTo = "2027-03-31";
  const html = decode(await download("shinjuku", URL));
  const districts = parse(html, validFrom, validTo);
  const spec = {
    id: "shinjuku",
    code: "13104",
    pref: "13",
    jp: "新宿区",
    en: "Shinjuku",
    url: URL,
    sourceName: SOURCE.name,
    validFrom,
    validTo,
    bins: BINS,
    note:
      "One pattern per table row (collection block / address group). Metal/ceramic/glass uses nth-weekday rules from the ward table; see linked PDF calendars for year-end dates.",
    districts,
    minDistricts: 50,
  };
  return buildFromDistricts(spec, districts, extractedAt);
}
