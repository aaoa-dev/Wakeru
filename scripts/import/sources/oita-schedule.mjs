/* Oita City — dated schedule CSV keyed by カレンダーNo (district calendar id). */
import { download, decode, csvObjects } from "../lib.mjs";

export const SOURCE = {
  name: "Oita City garbage calendar open data",
  url: "https://www.city.oita.oita.jp/o150/kurashi/gomi/2026karenda/documents/2026schedule.csv",
  license: "Oita City open data",
};
const URL = SOURCE.url;
const BIN = {
  "可燃物":"burnable", "不燃物":"non_burnable", "ﾌﾟﾗｽﾁｯｸ製容器包装":"plastic",
  "缶・びん":"cans_bottles", "ペットボトル":"pet_bottle", "古紙・布類":"paper", "蛍光管等":"hazardous",
};

function parseDate(s){
  const m = (s ?? "").trim().match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if(!m) return null;
  return `${m[1]}-${String(+m[2]).padStart(2, "0")}-${String(+m[3]).padStart(2, "0")}`;
}

export async function convert(extractedAt){
  const rows = csvObjects(decode(await download("oita", URL), "CP932"));
  const patterns = {};
  for(const row of rows){
    const cal = String(row["カレンダーNo"] ?? row[" カレンダーNo"] ?? "").trim();
    const item = (row["収集品目名称"] ?? "").trim();
    const day = parseDate(row["収集日"] ?? row[" 収集日"]);
    const bin = BIN[item] ?? (item.includes("プラ") ? "plastic" : item.includes("燃") ? "burnable" : null);
    if(!cal || !bin || !day) continue;
    (patterns[cal] ??= {})[bin] ??= {dates:[]};
    patterns[cal][bin].dates.push(day);
  }
  for(const p of Object.values(patterns))
    for(const bin of Object.keys(p)) p[bin].dates = [...new Set(p[bin].dates)].sort();

  const areas = Object.keys(patterns).map(cal => ({
    town:`地区${cal}`, townEn:`Area ${cal}`, kana:cal, chome:null, detail:null,
    en:`Collection calendar ${cal}`, jp:`カレンダー${cal}`, pattern:cal,
    note:"Match your address to the city's calendar number (カレンダーNo) on the official map.",
  }));
  if(!areas.length) throw new Error("no calendar districts");
  const dates = areas.flatMap(a => Object.values(patterns[a.pattern]).flatMap(r => r.dates)).sort();
  const bins = {
    burnable:{label:"可燃物", en:"Burnable", kind:"burn"},
    non_burnable:{label:"不燃物", en:"Non-burnable", kind:"non"},
    res:{label:"資源物", en:"Recyclables", kind:"res"},
    plastic:{label:"プラスチック", en:"Plastic", kind:"pla"},
    pet_bottle:{label:"ペットボトル", en:"PET bottles", kind:"res"},
    cans_bottles:{label:"缶・びん", en:"Cans and bottles", kind:"res"},
    hazardous:{label:"蛍光管等", en:"Hazardous", kind:"haz"},
    paper:{label:"紙", en:"Paper", kind:"res"},
    oversized:{label:"粗大ごみ", en:"Oversized", kind:"big"},
    no:{label:"収集しないもの", en:"Not collected", kind:"no"},
  };
  return {
    id:"oita", code:"44201", pref:"44", jp:"大分市", en:"Oita", verified:extractedAt.slice(0, 10),
    sources:[URL], contacts:[],
    bins, plasticTest:null, sorting:{},
    calendar:{
      validFrom:dates[0] ?? "2026-04-01", validTo:dates.at(-1) ?? "2027-03-31",
      noCollection:{weekdays:[0], dates:[]},
      note:"Dates from Oita City's 2026 schedule CSV by calendar number. Use the city map to find your カレンダーNo.",
      patterns,
    },
    areas, attribution:{schedule:SOURCE}, updated:extractedAt.slice(0, 10),
  };
}
