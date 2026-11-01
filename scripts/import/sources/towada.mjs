/* Towada (Aomori) — ごみ地域別収集曜日一覧 from Aomori Prefecture open data catalog #1481 */
import { download, decode, csvObjects } from "../lib.mjs";
import { convertDistrictWeeklyCsv } from "./district-weekly-csv.mjs";

export const SOURCE = {
  name: "Aomori Prefecture open data (Towada collection weekdays)",
  url: "https://opendata.pref.aomori.lg.jp/dataset/1481.html",
  license: "Aomori Prefecture open data (CC BY)",
  commit: "022063_gomishushuyobi",
};
const SCHEDULE_URL = "https://opendata.pref.aomori.lg.jp/fs/2/7/5/7/1/_/022063_gomishushuyobi.csv";
const PREF = "02";

const HEADER_TO_BIN = [
  [/燃える|燃やす|燃やせる/, "burnable"],
  [/燃えない|燃やせない/, "non_burnable"],
  [/プラスチック/, "plastic"],
  [/^缶$|カン/, "beverage_can"],
  [/びん|ビン/, "glass_bottle"],
  [/^紙$|紙類|古紙/, "paper"],
];

const BINS = {
  burnable:{label:"燃えるごみ", en:"Burnable", kind:"burn"},
  non_burnable:{label:"燃えないごみ", en:"Non-burnable", kind:"non"},
  plastic:{label:"プラスチック", en:"Plastic", kind:"pla"},
  beverage_can:{label:"缶", en:"Cans", kind:"res"},
  glass_bottle:{label:"びん", en:"Glass bottles", kind:"res"},
  paper:{label:"紙", en:"Paper", kind:"res"},
  oversized:{label:"粗大ごみ", en:"Oversized", kind:"big"},
  no:{label:"収集しないもの", en:"Not collected", kind:"no"},
};

export const ENTRY = {
  id:"towada", code:"02203", jp:"十和田市", en:"Towada",
  validFrom:"2026-04-01", validTo:"2027-03-31",
  sourceUrls:[SCHEDULE_URL],
};

export async function convert(extractedAt){
  return convertDistrictWeeklyCsv({
    cacheKey:"towada", source:SOURCE, pref:PREF, bins:BINS, headerToBin:HEADER_TO_BIN, entry:ENTRY,
    calendarNote:"Weekday rules from Towada's ごみ地域別収集曜日一覧 (Aomori Prefecture open data). Confirm holidays on the city page.",
    contacts:[{en:"Towada City Environment Division", tel:"0176-51-1111"}],
    loadRows: async () => {
      const buf = await download("towada", SCHEDULE_URL);
      return csvObjects(decode(buf, "CP932"));
    },
  }, extractedAt);
}
