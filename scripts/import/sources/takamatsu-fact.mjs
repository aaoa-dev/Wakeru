/* Takamatsu FACT open-data hub — property/area × weekday columns (quoted CSV). */
import { download, decode, csvObjects } from "../lib.mjs";
import { weeklyRule } from "./district-weekly-csv.mjs";

export const SOURCE = {
  name: "Takamatsu FACT garbage collection open data",
  url: "https://opendata.takamatsu-fact.com/garbage_collection_date/",
  license: "Takamatsu FACT open data",
};
const URL = "https://opendata.takamatsu-fact.com/garbage_collection_date/data.csv";
const COLS = {
  burnableGarbage:"burnable",
  crushableGarbage:"non_burnable",
  cansGlassPlastic:"res_mixed",
  paperAndCloth:"paper",
  plasticContainers:"plastic",
};

export async function convert(extractedAt){
  const rows = csvObjects(decode(await download("takamatsu", URL), "UTF-8"));
  const validFrom = "2026-04-01", validTo = "2027-03-31";
  const patterns = {}, areas = [];
  for(const row of rows){
    const id = String(row["#property"] ?? row.property ?? "").trim();
    const name = (row.name ?? "").trim();
    if(!id || !name) continue;
    const schedule = {};
    for(const [col, bin] of Object.entries(COLS)){
      const rule = weeklyRule((row[col] ?? "").replace(/毎週/g, ""), validFrom, validTo);
      if(rule) schedule[bin] = rule;
    }
    if(!Object.keys(schedule).length) continue;
    patterns[id] = schedule;
    areas.push({
      town:name, townEn:name, kana:name, chome:null, detail:null, en:name, jp:name, pattern:id,
    });
  }
  if(!areas.length) throw new Error("no areas");
  const bins = {
    burnable:{label:"可燃ごみ", en:"Burnable", kind:"burn"},
    non_burnable:{label:"燃やせないごみ", en:"Non-burnable", kind:"non"},
    res_mixed:{label:"かん・びん・プラ", en:"Cans, bottles and plastic", kind:"res"},
    paper:{label:"紙・布類", en:"Paper and cloth", kind:"res"},
    plastic:{label:"プラ容器", en:"Plastic containers", kind:"pla"},
    oversized:{label:"粗大ごみ", en:"Oversized", kind:"big"},
    no:{label:"収集しないもの", en:"Not collected", kind:"no"},
  };
  return {
    id:"takamatsu", code:"37201", pref:"37", jp:"高松市", en:"Takamatsu", verified:extractedAt.slice(0, 10),
    sources:[SOURCE.url, URL], contacts:[],
    bins, plasticTest:null, sorting:{},
    calendar:{validFrom, validTo, noCollection:{weekdays:[0], dates:[]},
      note:"Weekday rules from Takamatsu FACT open data. Confirm holidays on the city page.", patterns},
    areas, attribution:{schedule:SOURCE}, updated:extractedAt.slice(0, 10),
  };
}
