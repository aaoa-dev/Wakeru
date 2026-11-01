/* Nagasaki City — collection schedule XLS (multi-sheet, area × weekday matrix). */
import XLSX from "xlsx";
import { download } from "../lib.mjs";
import { weeklyRule } from "./district-weekly-csv.mjs";

export const SOURCE = {
  name: "Nagasaki City garbage schedule open data",
  url: "https://www.city.nagasaki.lg.jp/uploaded/attachment/55258.xls",
  license: "Nagasaki City open data",
};
const URL = SOURCE.url;
const SKIP_SHEETS = /^香焼|琴海|わ\s*$|Sheet/i;

function rulesFromCell(cell, validFrom, validTo){
  const raw = String(cell ?? "").trim();
  if(!raw) return [];
  const parts = raw.split(/[/／]/).map(s => s.trim()).filter(Boolean);
  const rules = [];
  for(const part of parts.length ? parts : [raw]){
    const r = weeklyRule(part, validFrom, validTo);
    if(r) rules.push(r);
  }
  return rules;
}

function parseSheet(sheet, validFrom, validTo){
  const grid = XLSX.utils.sheet_to_json(sheet, {header:1, defval:""});
  const headerIdx = grid.findIndex(r => r.some(c => /町[\s　]*名/.test(String(c))));
  if(headerIdx < 0) return [];
  const headers = grid[headerIdx].map(c => String(c).trim());
  const areaIdx = headers.findIndex(h => /町[\s　]*名/.test(h));
  const colArea = areaIdx >= 0 ? areaIdx : 1;
  const out = [];
  for(const row of grid.slice(headerIdx + 1)){
    const district = String(row[colArea] ?? "").trim();
    if(!district || /^(町名|【)/.test(district)) continue;
    const schedule = {};
    for(let c = 0; c < headers.length; c++){
      if(c === colArea) continue;
      const h = headers[c];
      if(!h || /備考|センター|所管/.test(h)) continue;
      let bin = "burnable";
      if(/不燃|燃やさない/.test(h)) bin = "non_burnable";
      else if(/プラ/.test(h)) bin = "plastic";
      else if(/缶|びん|ペット|資源/.test(h)) bin = "res";
      const rules = rulesFromCell(row[c], validFrom, validTo);
      if(!rules.length) continue;
      schedule[bin] = rules.length === 1 ? rules[0] : {any:rules};
    }
    if(Object.keys(schedule).length) out.push({district, schedule});
  }
  return out;
}

export async function convert(extractedAt){
  const buf = await download("nagasaki", URL);
  const wb = XLSX.read(buf, {type:"buffer"});
  const validFrom = "2026-04-01", validTo = "2027-03-31";
  const patterns = {}, byKey = new Map(), areas = [];
  for(const name of wb.SheetNames){
    if(SKIP_SHEETS.test(name.trim())) continue;
    for(const {district, schedule} of parseSheet(wb.Sheets[name], validFrom, validTo)){
      const key = JSON.stringify(schedule, Object.keys(schedule).sort());
      let id = byKey.get(key);
      if(!id){ id = String(byKey.size + 1); byKey.set(key, id); patterns[id] = schedule }
      areas.push({
        town:district, townEn:district, kana:district, chome:null, detail:null,
        en:district, jp:district, pattern:id,
      });
    }
  }
  if(!areas.length) throw new Error("no areas from XLS");
  const bins = {
    burnable:{label:"可燃ごみ", en:"Burnable", kind:"burn"},
    non_burnable:{label:"不燃ごみ", en:"Non-burnable", kind:"non"},
    plastic:{label:"プラ", en:"Plastic", kind:"pla"},
    res:{label:"資源", en:"Recyclables", kind:"res"},
    oversized:{label:"粗大ごみ", en:"Oversized", kind:"big"},
    no:{label:"収集しないもの", en:"Not collected", kind:"no"},
  };
  return {
    id:"nagasaki", code:"42201", pref:"42", jp:"長崎市", en:"Nagasaki", verified:extractedAt.slice(0, 10),
    sources:[URL], contacts:[],
    bins, plasticTest:null, sorting:{},
    calendar:{validFrom, validTo, noCollection:{weekdays:[0], dates:[]},
      note:"Weekday rules from Nagasaki City open-data XLS (all kana sheets). Confirm island areas on the city site.", patterns},
    areas, attribution:{schedule:SOURCE}, updated:extractedAt.slice(0, 10),
  };
}
