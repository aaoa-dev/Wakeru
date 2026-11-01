/* Fukaya City: two postal districts share most bins; non-burnable differs (official HTML table). */
import { download, decode } from "../lib.mjs";
import { buildFromDistricts } from "./html-weekly-table.mjs";

const URL = "https://www.city.fukaya.saitama.jp/soshiki/kankyosuido/kankyoeisei/tanto/gomi/1391428524402.html";

export const SOURCE = {
  name: "Fukaya City garbage collection rules (official HTML)",
  url: URL,
  license: "Fukaya City website (collection facts; license not stated as open data)",
};

const BINS = {
  burnable: {label: "燃やせるごみ", en: "Burnable", kind: "burn"},
  res: {label: "資源物", en: "Recyclables", kind: "res"},
  non_burnable: {label: "燃やせないごみ", en: "Non-burnable", kind: "non"},
  oversized: {label: "粗大ごみ", en: "Oversized", kind: "big"},
  no: {label: "収集しないもの", en: "Not collected", kind: "no"},
};

/** @returns {{jp:string, schedule:Record<string, unknown>}[]} */
function parse(html){
  const shared = {
    burnable: [1, 2, 3, 5],
    res: [4],
    oversized: [2],
  };
  if(!/燃やせるごみ/.test(html) || !/366/.test(html)) throw new Error("expected Fukaya schedule page");
  return [
    {
      jp: "深谷地区（郵便番号366〜）",
      schedule: {
        ...shared,
        non_burnable: {day: 3, weeks: [1, 3, 4, 5]},
      },
    },
    {
      jp: "岡部・川本・花園地区",
      schedule: {
        ...shared,
        non_burnable: {day: 5, weeks: [1, 3, 4, 5]},
      },
    },
  ];
}

export async function convert(extractedAt){
  const html = decode(await download("fukaya", URL));
  const districts = parse(html);
  const spec = {
    id: "fukaya",
    code: "11218",
    pref: "11",
    jp: "深谷市",
    en: "Fukaya",
    url: URL,
    sourceName: SOURCE.name,
    validFrom: "2026-04-01",
    validTo: "2027-03-31",
    bins: BINS,
    note:
      "Two collection groups by postal code (366 vs other). Non-burnable skips the 2nd Wednesday or Friday each month. " +
      "Monthly items (small appliances, hazardous waste) are on the city leaflet — not in this pattern set.",
    districts,
    minDistricts: 2,
  };
  return buildFromDistricts(spec, districts, extractedAt);
}
