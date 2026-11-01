/* Kamikawa Town: A/B/C districts with weekday rules in official HTML (no table rows). */
import { download, decode } from "../lib.mjs";
import { buildFromDistricts } from "./html-weekly-table.mjs";

const URL = "https://www.town.kamikawa.saitama.jp/soshiki/bosaikankyou/gomi_kankyou/477.html";

export const SOURCE = {
  name: "Kamikawa Town garbage collection rules (official HTML)",
  url: URL,
  license: "Kamikawa Town website",
};

const BINS = {
  burnable: {label: "可燃ごみ", en: "Burnable", kind: "burn"},
  non_burnable: {label: "不燃ごみ", en: "Non-burnable", kind: "non"},
  res: {label: "資源ごみ", en: "Recyclables", kind: "res"},
  no: {label: "収集しないもの", en: "Not collected", kind: "no"},
};

function parse(html){
  if(!/A・C地区→月曜日・木曜日/.test(html)) throw new Error("expected Kamikawa schedule page");
  return [
    {
      jp: "A地区",
      schedule: {
        burnable: [1, 4],
        non_burnable: {day: 1, weeks: [1, 3]},
        res: {day: 3, weeks: [1, 3]},
      },
    },
    {
      jp: "B地区",
      schedule: {
        burnable: [2, 5],
        non_burnable: {day: 2, weeks: [1, 3]},
        res: {day: 3, weeks: [1, 3]},
      },
    },
    {
      jp: "C地区",
      schedule: {
        burnable: [1, 4],
        non_burnable: {day: 2, weeks: [2]},
        res: {day: 2, weeks: [4]},
      },
    },
  ];
}

export async function convert(extractedAt){
  const html = decode(await download("kamikawa-town", URL));
  const districts = parse(html);
  const spec = {
    id: "kamikawa-town",
    code: "11383",
    pref: "11",
    jp: "神川町",
    en: "Kamikawa",
    url: URL,
    sourceName: SOURCE.name,
    validFrom: "2026-04-01",
    validTo: "2027-03-31",
    bins: BINS,
    note: "Three collection districts (A/B/C). Burnable is twice weekly; non-burnable and recyclables use nth-weekday rules.",
    districts,
    minDistricts: 3,
  };
  return buildFromDistricts(spec, districts, extractedAt);
}
