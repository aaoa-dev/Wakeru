/* Nagaoka City — dated matrix CSV (area × date × bin with ○ marks). */
import { download, decode, csvObjects } from "../lib.mjs";

export const SOURCE = {
  name: "Nagaoka City garbage schedule open data",
  url: "https://www.city.nagaoka.niigata.jp/shisei/cate10/kankyo/file/19-01u.csv",
  license: "Nagaoka City open data",
};
const URL = SOURCE.url;
const BIN_COLS = {
  "生ごみ":"burnable", "燃やすごみ":"burnable", "燃やさないごみ":"non_burnable",
  "びん・缶・ペットボトル":"res_mixed", "新聞、雑誌・チラシ、段ボール":"paper",
  "プラスチック容器包装材":"plastic", "スプレー缶・発火物・有害物":"hazardous",
};

function parseDate(s){
  const m = (s ?? "").match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if(!m) return null;
  return `${m[1]}-${String(+m[2]).padStart(2, "0")}-${String(+m[3]).padStart(2, "0")}`;
}

export async function convert(extractedAt){
  const rows = csvObjects(decode(await download("nagaoka", URL), "UTF-8"));
  const byArea = {};
  for(const row of rows){
    const area = row["地区"]?.trim();
    const day = parseDate(row["年月日"]);
    if(!area || !day) continue;
    const id = area.replace(/\s+/g, "");
    for(const [col, bin] of Object.entries(BIN_COLS)){
      const mark = (row[col] ?? "").trim();
      if(mark !== "○" && mark !== "◯" && mark !== "〇") continue;
      (byArea[id] ??= {})[bin] ??= {dates:[]};
      byArea[id][bin].dates.push(day);
    }
  }
  const patterns = {}, byKey = new Map(), areas = [];
  for(const [areaId, sched] of Object.entries(byArea)){
    for(const b of Object.keys(sched)) sched[b].dates = [...new Set(sched[b].dates)].sort();
    const key = JSON.stringify(sched, Object.keys(sched).sort());
    let pid = byKey.get(key);
    if(!pid){ pid = String(byKey.size + 1); byKey.set(key, pid); patterns[pid] = sched }
    areas.push({
      town:areaId, townEn:areaId, kana:areaId, chome:null, detail:null,
      en:areaId, jp:areaId, pattern:pid,
    });
  }
  if(!areas.length) throw new Error("no matrix rows");
  const allDates = Object.values(patterns).flatMap(p => Object.values(p).flatMap(r => r.dates)).sort();
  const bins = {
    burnable:{label:"燃やすごみ", en:"Burnable", kind:"burn"},
    non_burnable:{label:"燃やさないごみ", en:"Non-burnable", kind:"non"},
    res_mixed:{label:"びん・缶・PET", en:"Cans, bottles and PET", kind:"res"},
    paper:{label:"紙類", en:"Paper", kind:"res"},
    plastic:{label:"プラ容器", en:"Plastic", kind:"pla"},
    hazardous:{label:"有害ごみ", en:"Hazardous", kind:"haz"},
    oversized:{label:"粗大ごみ", en:"Oversized", kind:"big"},
    no:{label:"収集しないもの", en:"Not collected", kind:"no"},
  };
  return {
    id:"nagaoka", code:"15202", pref:"15", jp:"長岡市", en:"Nagaoka", verified:extractedAt.slice(0, 10),
    sources:[URL], contacts:[],
    bins, plasticTest:null, sorting:{},
    calendar:{
      validFrom:allDates[0] ?? "2026-04-01", validTo:allDates.at(-1) ?? "2027-03-31",
      noCollection:{weekdays:[0], dates:[]},
      note:"Dates from Nagaoka City open-data matrix CSV (○ = collection).",
      patterns,
    },
    areas, attribution:{schedule:SOURCE}, updated:extractedAt.slice(0, 10),
  };
}
