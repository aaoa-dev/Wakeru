/* Otsu City — od_listgomiyoubi.csv (region × weekday columns). */
import { download, decode, csvObjects } from "../lib.mjs";
import { convertDistrictWeeklyCsv } from "./district-weekly-csv.mjs";

export const SOURCE = {
  name: "Otsu City garbage collection weekdays open data",
  url: "https://www.city.otsu.lg.jp/kurashi/gomi/",
  license: "Otsu City open data",
};
const URL = "https://www.city.otsu.lg.jp/material/files/group/41/od_listgomiyoubi.csv";
const HEADER_TO_BIN = [
  [/燃やせ|可燃/, "burnable"],
  [/燃やさない|不燃/, "non_burnable"],
  [/プラ/, "plastic"],
  [/ペット/, "pet_bottle"],
  [/かん|缶/, "beverage_can"],
  [/びん/, "glass_bottle"],
  [/紙/, "paper"],
];

const BINS = {
  burnable:{label:"燃やすごみ", en:"Burnable", kind:"burn"},
  non_burnable:{label:"燃やさないごみ", en:"Non-burnable", kind:"non"},
  plastic:{label:"プラ", en:"Plastic", kind:"pla"},
  pet_bottle:{label:"ペットボトル", en:"PET bottles", kind:"res"},
  beverage_can:{label:"缶", en:"Cans", kind:"res"},
  glass_bottle:{label:"びん", en:"Glass bottles", kind:"res"},
  paper:{label:"紙", en:"Paper", kind:"res"},
  oversized:{label:"粗大ごみ", en:"Oversized", kind:"big"},
  no:{label:"収集しないもの", en:"Not collected", kind:"no"},
};

export async function convert(extractedAt){
  return convertDistrictWeeklyCsv({
    cacheKey:"otsu", source:SOURCE, pref:"25", bins:BINS, headerToBin:HEADER_TO_BIN,
    entry:{id:"otsu", code:"25201", jp:"大津市", en:"Otsu", validFrom:"2026-04-01", validTo:"2027-03-31", sourceUrls:[URL]},
    loadRows: async () => csvObjects(decode(await download("otsu", URL), "CP932")).map(row => ({
      ...row, 地区名:[row["地域"], row["町名等"]].filter(Boolean).join(" "),
    })),
  }, extractedAt);
}
