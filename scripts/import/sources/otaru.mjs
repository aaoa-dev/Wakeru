/* Otaru — 令和8年ごみ収集カレンダー + ごみ収集地区データ (city open data, CC BY 2.1 JP) */
import { download, decode, csvObjects, kanaToRomaji } from "../lib.mjs";

export const SOURCE = {
  name: "Otaru City garbage open data",
  url: "https://www.city.otaru.lg.jp/docs/2022070700107/",
  license: "Creative Commons Attribution 2.1 Japan",
};
const BASE = "https://www.city.otaru.lg.jp/docs/2022070700107/file_contents/";
const CALENDAR = BASE + "2026gomicalendar.csv";
const DISTRICTS = BASE + "chikudata.csv";
const PREF = "01";

const BIN_MARKERS = [
  [/可燃/, "burnable"],
  [/不燃/, "non_burnable"],
  [/紙/, "paper"],
  [/かん|缶/, "beverage_can"],
  [/びん|ビン/, "glass_bottle"],
  [/プラ/, "plastic"],
];

function parseJpDate(s){
  const m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if(!m) return null;
  return `${m[1]}-${String(+m[2]).padStart(2, "0")}-${String(+m[3]).padStart(2, "0")}`;
}

function cellBin(cell){
  const s = (cell ?? "").replace(/\s+/g, "");
  if(!s || s === "　") return null;
  for(const [re, bin] of BIN_MARKERS) if(re.test(s)) return bin;
  return null;
}

export async function convert(extractedAt){
  const calText = decode(await download("otaru", CALENDAR), "CP932");
  const distText = decode(await download("otaru", DISTRICTS), "CP932");
  const calRows = csvObjects(calText);
  const distRows = csvObjects(distText);
  if(!calRows.length || !distRows.length) throw new Error("empty CSV");

  const districtIds = [...new Set(distRows.map(r => r["№"] || r["No"] || r["Ｎｏ"]).filter(Boolean))];
  const patterns = Object.fromEntries(districtIds.map(id => [id, {}]));

  for(const row of calRows){
    const day = parseJpDate(row["年月日"]);
    if(!day) continue;
    for(const id of districtIds){
      const mark = cellBin(row[id]);
      if(!mark) continue;
      const pat = patterns[id];
      (pat[mark] ??= {dates:[]}).dates.push(day);
    }
  }
  for(const id of districtIds){
    for(const bin of Object.keys(patterns[id]))
      patterns[id][bin].dates = [...new Set(patterns[id][bin].dates)].sort();
  }

  const areas = distRows.map(row => {
    const jp = row["地区名"]?.trim();
    const pattern = row["№"] || row["No"];
    const kana = jp.replace(/[0-9０-９(（].*$/, "");
    return {
      town:jp, townEn:kanaToRomaji(kana) || jp, kana, chome:null, detail:null,
      en:jp, jp, pattern,
    };
  }).filter(a => a.pattern && patterns[a.pattern] && Object.keys(patterns[a.pattern]).length);

  if(!areas.length) throw new Error("no areas with collection data");

  const bins = {
    burnable:{label:"可燃ごみ", en:"Burnable", kind:"burn"},
    non_burnable:{label:"不燃ごみ", en:"Non-burnable", kind:"non"},
    paper:{label:"紙類", en:"Paper", kind:"res"},
    beverage_can:{label:"かん等", en:"Cans", kind:"res"},
    glass_bottle:{label:"びん", en:"Bottles", kind:"res"},
    plastic:{label:"プラ類", en:"Plastic", kind:"pla"},
    oversized:{label:"粗大ごみ", en:"Oversized", kind:"big"},
    no:{label:"収集しないもの", en:"Not collected", kind:"no"},
  };

  return {
    id:"otaru", code:"01203", pref:PREF, jp:"小樽市", en:"Otaru", verified:extractedAt.slice(0, 10),
    sources:[SOURCE.url, CALENDAR, DISTRICTS],
    contacts:[{en:"Otaru City Environment Division", tel:"0134-33-4111"}],
    bins, plasticTest:null, sorting:{},
    calendar:{
      validFrom:"2026-01-01", validTo:"2026-12-31",
      noCollection:{weekdays:[0], dates:[]},
      note:"Dates from Otaru City's published 2026 collection calendar CSV. District numbers link address ranges in chikudata.csv — match your 地区 on the city's map if unsure.",
      patterns,
    },
    areas,
    attribution:{schedule:{...SOURCE, path:"2026gomicalendar.csv"}},
    updated:extractedAt.slice(0, 10),
  };
}
