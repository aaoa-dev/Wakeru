/* Import queue built by probe-official-csv.mjs (parsed schedule CSVs from the crawler cache). */
import fs from "node:fs";
import path from "node:path";
import { ROOT, readJSON, download, decode, csvObjects } from "../lib.mjs";
import { convert5374 } from "../sources/5374-area-days.mjs";
import { convertDistrictWeeklyCsv, GENERIC_HEADER_TO_BIN } from "../sources/district-weekly-csv.mjs";
import { load5374Catalog } from "./5374-catalog.mjs";

const PROBED = path.join(ROOT, ".cache/crawler/probed-schedules.json");

const DEFAULT_BINS = {
  burnable: {label: "燃やすごみ", en: "Burnable", kind: "burn"},
  non_burnable: {label: "燃やさないごみ", en: "Non-burnable", kind: "non"},
  plastic: {label: "プラスチック", en: "Plastic", kind: "pla"},
  res: {label: "資源ごみ", en: "Recyclables", kind: "res"},
  hazardous: {label: "有害ごみ", en: "Hazardous", kind: "haz"},
  oversized: {label: "粗大ごみ", en: "Oversized", kind: "big"},
  no: {label: "収集しないもの", en: "Not collected", kind: "no"},
};

export function loadProbedSchedules(){
  if(!fs.existsSync(PROBED)) return {entries: []};
  return readJSON(PROBED);
}

export function catalogProbedScheduleEntries(){
  const {entries = []} = loadProbedSchedules();
  if(!entries.length) return [];
  const catalogCodes = new Set(load5374Catalog().map(r => r.code));
  const out = [];
  for(const row of entries){
    if(catalogCodes.has(row.code)) continue;
    const source = {
      name: row.kind === "5374"
        ? "Official schedule CSV (crawler probe, 5374-style)"
        : "Official schedule CSV (crawler probe, district weekly)",
      url: row.url,
      license: "Confirm on municipality site",
    };
    const base = {
      id: row.id,
      code: row.code,
      pref: row.pref,
      source,
      convert: today => {
        if(row.kind === "district-weekly"){
          return convertDistrictWeeklyCsv({
            cacheKey: `crawler-probe-${row.code}`,
            source,
            pref: row.pref,
            bins: DEFAULT_BINS,
            headerToBin: GENERIC_HEADER_TO_BIN,
            entry: {
              id: row.id,
              code: row.code,
              jp: row.jp,
              en: row.en,
              validFrom: "2026-04-01",
              validTo: "2027-03-31",
            },
            loadRows: async () => {
              const buf = await download(`crawler-probe-${row.code}`, row.url);
              for(const enc of ["CP932", "UTF-8"]){
                const rows = csvObjects(decode(buf, enc));
                if(rows.length && Object.keys(rows[0]).some(h => /地区|住所|地域|町名/.test(h))) return rows;
              }
              return csvObjects(decode(buf, "CP932"));
            },
            calendarNote: "Weekday rules from official open-data CSV (crawler discovery + parse probe). Confirm holidays on the city site.",
          }, today);
        }
        return convert5374({
          id: row.id,
          code: row.code,
          pref: row.pref,
          jp: row.jp,
          en: row.en,
          url: row.url,
          cacheKey: `crawler-probe-${row.code}`,
          source,
        }, today);
      },
    };
    out.push(base);
  }
  return out;
}
