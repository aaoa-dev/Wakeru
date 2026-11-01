/* Miyake Village: burnable zones + island-wide recyclables (official HTML). */
import { download, decode } from "../lib.mjs";
import { buildFromDistricts } from "./html-weekly-table.mjs";

const URL = "https://www.vill.miyake.tokyo.jp/kurashi/seikatsu_kankyou/kankyou_gomi_recycle/gomi.html";

export const SOURCE = {
  name: "Miyake Village garbage collection rules (official HTML)",
  url: URL,
  license: "Miyake Village website",
};

const BINS = {
  burnable: {label: "燃えるごみ", en: "Burnable", kind: "burn"},
  non_burnable: {label: "不燃ごみ", en: "Non-burnable", kind: "non"},
  res: {label: "資源ごみ", en: "Recyclables", kind: "res"},
  no: {label: "収集しないもの", en: "Not collected", kind: "no"},
};

function parse(html){
  if(!/阿古・伊ヶ谷・伊豆地区/.test(html)) throw new Error("expected Miyake schedule page");
  return [
    {
      jp: "阿古・伊ヶ谷・伊豆地区",
      schedule: {
        burnable: [1, 4],
        non_burnable: [3],
        res: [3],
      },
    },
    {
      jp: "坪田・神着地区",
      schedule: {
        burnable: [2, 5],
        non_burnable: [3],
        res: [3],
      },
    },
  ];
}

export async function convert(extractedAt){
  const html = decode(await download("miyake-vill", URL));
  const districts = parse(html);
  const spec = {
    id: "miyake-vill",
    code: "13381",
    pref: "13",
    jp: "三宅村",
    en: "Miyake",
    url: URL,
    sourceName: SOURCE.name,
    validFrom: "2026-04-01",
    validTo: "2027-03-31",
    bins: BINS,
    note:
      "Burnable collection days differ by settlement group; non-burnable and recyclables are collected island-wide on Wednesdays. " +
      "Clean-center drop-off and hazardous waste use other weekdays — see the village website.",
    districts,
    minDistricts: 2,
  };
  return buildFromDistricts(spec, districts, extractedAt);
}
