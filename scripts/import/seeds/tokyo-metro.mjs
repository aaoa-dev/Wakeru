/* Tokyo Metro Open Data Catalog — garbage collection weekday XLSX/CSV seeds.
   Discovered via catalog.data.metro.tokyo.lg.jp (package_search) for titles matching
   収集曜日 / ごみ収集日 / ごみと資源の収集日 / shigengomiyoubi / 地域別収集曜日.
   Importer skips municipalities already shipped and scripts/import/wards/* rulesets.
   Broken catalog mirrors (Sumida CSV → HTML, Shinagawa CSV → 404) are omitted. */
import fs from "node:fs";
import path from "node:path";
import { ROOT, readJSON } from "../lib.mjs";
import * as tokyoMetro from "../sources/tokyo-metro-xlsx.mjs";

const FY = {validFrom: "2026-04-01", validTo: "2027-03-31"};

/** @typedef {typeof FY & {
 *   id:string, code:string, jp:string, en:string, url:string,
 *   format?:string, encoding?:string, sheetName?:string, ward?:string, note?:string,
 *   bins?:Record<string,{label:string,en:string,kind:string}>,
 *   headerToBin?:[RegExp,string][],
 *   catalogTitle?:string,
 * }} TokyoMetroSeed */

/** Curated schedule resources (catalog + opendata.metro.tokyo.lg.jp / city mirrors). */
export const TOKYO_METRO_SEEDS = [
  {
    ...FY,
    id: "chuo-metro",
    code: "13102",
    jp: "中央区",
    en: "Chuo",
    catalogTitle: "ごみと資源の収集曜日",
    url: "https://www.city.chuo.lg.jp/documents/984/gomitoshigen.csv",
    format: "chuo-csv",
    encoding: "CP932",
  },
  {
    ...FY,
    id: "taito-metro",
    code: "13106",
    jp: "台東区",
    en: "Taito",
    catalogTitle: "地域別収集曜日一覧",
    url: "https://www.city.taito.lg.jp/kusei/online/opendata/koutu/gomibunbetuitiran.files/tiikibetusyuusyuuyoubiitiran.csv",
    format: "tiiki-csv",
    encoding: "CP932",
  },
  {
    ...FY,
    id: "bunkyo-metro",
    code: "13105",
    jp: "文京区",
    en: "Bunkyo",
    catalogTitle: "ごみと資源の収集日",
    url: "https://www.city.bunkyo.lg.jp/documents/6059/syusyubi.xlsx",
    format: "town-chome",
  },
  {
    ...FY,
    id: "nakano-metro",
    code: "13114",
    jp: "中野区",
    en: "Nakano",
    catalogTitle: "資源とごみの収集曜日一覧",
    url: "https://www2.wagmap.jp/nakanodatamap/nakanodatamap/opendatafile/map_1/CSV/opendata_550239.csv",
    format: "wagmap-csv",
    encoding: "UTF-8",
  },
  {
    ...FY,
    id: "koto-metro",
    code: "13108",
    jp: "江東区",
    en: "Koto",
    catalogTitle: "資源回収・ごみ収集日一覧",
    url: "https://www.opendata.metro.tokyo.lg.jp/koto/131083_201_kotocity_waste_recycle_collectionday.csv",
    format: "district-weekly-csv",
    encoding: "CP932",
    headerToBin: [
      [/燃やす/, "burnable"],
      [/燃やさない|不燃/, "non_burnable"],
      [/プラ/, "plastic"],
      [/資源/, "res"],
    ],
  },
  {
    ...FY,
    id: "ota-metro",
    code: "13111",
    jp: "大田区",
    en: "Ota",
    catalogTitle: "資源・ごみ収集曜日、清掃事業所管轄一覧",
    url: "https://www.opendata.metro.tokyo.lg.jp/ootaku/131113_shigengomiyoubi.xlsx",
    format: "ota-shigen",
  },
];

export function wardCodesWithRulesets(){
  const dir = path.join(ROOT, "scripts/import/wards");
  return new Set(
    fs.readdirSync(dir)
      .filter(d => fs.existsSync(path.join(dir, d, "ruleset.json")))
      .map(d => readJSON(path.join(dir, d, "ruleset.json")).code),
  );
}

/** Map munis from data/map/13.json that are not in curated wards. */
export function unshippedTokyoMapCodes(shippedCodes){
  const map = readJSON(path.join(ROOT, "data/map/13.json"));
  const wards = wardCodesWithRulesets();
  return map.munis
    .filter(m => !shippedCodes.has(m.code) && !wards.has(m.code))
    .map(m => m.code);
}

export function tokyoMetroEntries(){
  return TOKYO_METRO_SEEDS.map(spec => ({
    id: spec.id,
    code: spec.code,
    pref: "13",
    source: {
      name: tokyoMetro.SOURCE.name,
      url: spec.url,
      license: tokyoMetro.SOURCE.license,
    },
    convert: today => tokyoMetro.convert(spec, today),
    spec,
  }));
}
