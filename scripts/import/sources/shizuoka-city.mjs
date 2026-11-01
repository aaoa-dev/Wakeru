/* Shizuoka City — sjis_shushubi CSV (ward + town + weekday columns). */
import { download, decode, csvObjects, townRegistry, kanaToRomaji } from "../lib.mjs";
import { weeklyRule } from "./district-weekly-csv.mjs";

export const SOURCE = {
  name: "Shizuoka City garbage collection weekdays open data",
  url: "https://www.city.shizuoka.lg.jp/kurashi/gomi/",
  license: "Shizuoka City open data",
};
const URL = "https://www.city.shizuoka.lg.jp/documents/11333/sjis_shushubi260313.csv";

export async function convert(extractedAt){
  const rows = csvObjects(decode(await download("shizuoka-city", URL), "CP932"));
  const validFrom = "2026-04-01", validTo = "2027-03-31";
  const towns = await townRegistry("静岡市", {pref:"22"});
  const cols = {kanen:"burnable", hunenSodai:"non_burnable", bin:"glass_bottle"};
  const patterns = {}, byKey = new Map(), areas = [];
  for(const row of rows){
    const ku = row.ku ?? row["区"] ?? "";
    const town = (row.townName ?? row["町名"] ?? "").trim();
    if(!town) continue;
    const label = `${ku}${town}${row.subTownName ?? ""}`.trim();
    const schedule = {};
    for(const [col, bin] of Object.entries(cols)){
      const cell = (row[col] ?? "").replace(/曜日/g, "");
      const rule = weeklyRule(cell, validFrom, validTo);
      if(rule) schedule[bin] = rule;
    }
    if(!Object.keys(schedule).length) continue;
    const key = JSON.stringify(schedule);
    let id = byKey.get(key);
    if(!id){ id = String(byKey.size + 1); byKey.set(key, id); patterns[id] = schedule }
    const reg = towns.get(town);
    areas.push({
      town, townEn:reg?.en || kanaToRomaji(row.syllabary ?? town) || town, kana:reg?.kana ?? row.syllabary ?? "",
      chome:null, detail:row.subTownName || null, en:label, jp:label, pattern:id,
    });
  }
  if(!areas.length) throw new Error("no areas");
  const bins = {
    burnable:{label:"可燃ごみ", en:"Burnable", kind:"burn"},
    non_burnable:{label:"不燃・粗大", en:"Non-burnable", kind:"non"},
    glass_bottle:{label:"びん", en:"Bottles", kind:"res"},
    plastic:{label:"プラ", en:"Plastic", kind:"pla"},
    oversized:{label:"粗大ごみ", en:"Oversized", kind:"big"},
    no:{label:"収集しないもの", en:"Not collected", kind:"no"},
  };
  return {
    id:"shizuoka", code:"22100", pref:"22", jp:"静岡市", en:"Shizuoka", verified:extractedAt.slice(0, 10),
    sources:[SOURCE.url, URL], contacts:[],
    bins, plasticTest:null, sorting:{},
    calendar:{validFrom, validTo, noCollection:{weekdays:[0], dates:[]},
      note:"Weekday rules from Shizuoka City open-data CSV.", patterns},
    areas, attribution:{schedule:SOURCE}, updated:extractedAt.slice(0, 10),
  };
}
