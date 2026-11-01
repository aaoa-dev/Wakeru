/* Extra municipalities beyond the one-per-prefecture map pass. National goal: all 1,747 cities on data/map/*.json
   (see npm run discover:5374 + scripts/import/seeds/5374-catalog.json). */
import { convert5374 } from "../sources/5374-area-days.mjs";
import * as sapporo from "../sources/sapporo-calendar.mjs";

const FY = {validFrom: "2026-04-01", validTo: "2027-03-31"};

/** @type {{id:string, code:string, pref:string, jp:string, en:string, url:string}[]} */
export const MAJOR_HUBS_5374 = [
  {id: "sakai", code: "27140", pref: "27", jp: "堺市", en: "Sakai", url: "http://sakai.5374.jp/data/area_days.csv", ...FY},
  {id: "urasoe", code: "47208", pref: "47", jp: "浦添市", en: "Urasoe", url: "http://urasoe.5374.jp/data/area_days.csv", ...FY},
];

export const MAJOR_HUBS_CUSTOM = [
  {id: "sapporo", code: "01100", pref: "01", source: sapporo.SOURCE, convert: sapporo.convert},
];

export function majorHub5374Entries(){
  return MAJOR_HUBS_5374.map(spec => ({
    id: spec.id, code: spec.code, pref: spec.pref,
    source: {name: "5374 area_days.csv", url: spec.url, license: "Municipality open data"},
    convert: today => convert5374(spec, today),
  }));
}
