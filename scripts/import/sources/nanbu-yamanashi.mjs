/* Nanbu (Yamanashi) — FY2026 Google Calendar export CSV (dated collection by area label). */
import { download, decode, csvObjects } from "../lib.mjs";

export const SOURCE = {
  name: "Nanbu Town garbage calendar open data",
  url: "https://www.town.nanbu.yamanashi.jp/opendata/files/Gomi-GoogleMut2026.csv",
  license: "Nanbu Town open data",
};
const URL = SOURCE.url;

function parseDate(s){
  const m = (s ?? "").match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if(!m) return null;
  return `${m[1]}-${String(+m[2]).padStart(2, "0")}-${String(+m[3]).padStart(2, "0")}`;
}

function binFromSummary(s){
  const t = (s ?? "").normalize("NFKC");
  if(/不燃|燃やさない/.test(t)) return "non_burnable";
  if(/プラ/.test(t)) return "plastic";
  if(/ペット/.test(t)) return "pet_bottle";
  if(/缶|びん|資源/.test(t)) return "res";
  if(/可燃|燃やす/.test(t)) return "burnable";
  return null;
}

export async function convert(extractedAt){
  const text = decode(await download("nanbu", URL), "CP932");
  const rows = csvObjects(text);
  const patterns = {};
  for(const row of rows){
    const day = parseDate(row["Start Date"] ?? row["開始日"]);
    const title = row.Subject ?? row["タイトル"] ?? "";
    const area = (title.split(/[：:]/)[0] ?? "全域").trim() || "全域";
    const bin = binFromSummary(title);
    if(!day || !bin) continue;
    const id = area.replace(/\s+/g, "");
    (patterns[id] ??= {})[bin] ??= {dates:[]};
    patterns[id][bin].dates.push(day);
  }
  for(const p of Object.values(patterns))
    for(const b of Object.keys(p)) p[b].dates = [...new Set(p[b].dates)].sort();
  const areas = Object.keys(patterns).map(id => ({
    town:id, townEn:id, kana:id, chome:null, detail:null, en:id, jp:id, pattern:id,
  }));
  if(!areas.length) throw new Error("no calendar rows parsed");
  const allDates = areas.flatMap(a => Object.values(patterns[a.pattern]).flatMap(r => r.dates)).sort();
  const bins = {
    burnable:{label:"可燃ごみ", en:"Burnable", kind:"burn"},
    non_burnable:{label:"不燃ごみ", en:"Non-burnable", kind:"non"},
    plastic:{label:"プラ", en:"Plastic", kind:"pla"},
    pet_bottle:{label:"ペットボトル", en:"PET bottles", kind:"res"},
    res:{label:"資源ごみ", en:"Recyclables", kind:"res"},
    oversized:{label:"粗大ごみ", en:"Oversized", kind:"big"},
    no:{label:"収集しないもの", en:"Not collected", kind:"no"},
  };
  return {
    id:"nanbu", code:"19366", pref:"19", jp:"南部町", en:"Nanbu", verified:extractedAt.slice(0, 10),
    sources:[URL], contacts:[],
    bins, plasticTest:null, sorting:{},
    calendar:{
      validFrom:allDates[0] ?? "2026-04-01", validTo:allDates.at(-1) ?? "2027-03-31",
      noCollection:{weekdays:[0], dates:[]},
      note:"Dates from Nanbu Town open-data calendar CSV. Confirm on the town website.",
      patterns,
    },
    areas, attribution:{schedule:SOURCE}, updated:extractedAt.slice(0, 10),
  };
}
