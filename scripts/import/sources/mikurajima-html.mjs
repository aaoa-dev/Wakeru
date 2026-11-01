/* Mikurajima Village: island-wide bin schedule table (one area). */
import { download, decode } from "../lib.mjs";
import { buildFromDistricts } from "./html-weekly-table.mjs";

const URL = "https://www.vill.mikurasima.tokyo.jp/section/jumin/gomi.html";

export const SOURCE = {
  name: "Mikurajima Village garbage collection schedule",
  url: URL,
  license: "Mikurajima Village website",
};

const BIN_MAP = [
  [/可燃/, "burnable"],
  [/不燃/, "non_burnable"],
  [/リサイクル|缶/, "res"],
  [/ペット|ビン/, "pet_bottle"],
];

function parse(html){
  const schedule = {};
  for(const block of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)){
    const cells = [...block[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map(c => c[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    const label = cells[1] ?? "";
    const when = cells[3] ?? cells[2] ?? "";
    if(!label || !when || /ごみの種類/.test(label)) continue;
    const bin = BIN_MAP.find(([re]) => re.test(label))?.[1];
    if(bin) schedule[bin] = when.replace(/、/g, " ");
  }
  if(!schedule.burnable) throw new Error("missing burnable row");
  return [{jp: "御蔵島村", schedule}];
}

export async function convert(extractedAt){
  const html = decode(await download("mikurajima", URL));
  const districts = parse(html);
  const spec = {
    id: "mikurajima-vill",
    code: "13382",
    pref: "13",
    jp: "御蔵島村",
    en: "Mikurajima",
    url: URL,
    sourceName: SOURCE.name,
    validFrom: "2026-04-01",
    validTo: "2027-03-31",
    bins: {
      burnable: {label: "可燃ごみ", en: "Burnable", kind: "burn"},
      non_burnable: {label: "不燃ごみ", en: "Non-burnable", kind: "non"},
      res: {label: "リサイクルごみ", en: "Recyclables", kind: "res"},
      pet_bottle: {label: "ペットボトル・ビン", en: "PET & glass", kind: "res"},
      no: {label: "収集しないもの", en: "Not collected", kind: "no"},
    },
    note: "Village-wide rules from the official table (single collection area).",
    districts,
  };
  return buildFromDistricts(spec, districts, extractedAt);
}
