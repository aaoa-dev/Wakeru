/* Ishikawa Prefecture open data catalog — municipality garbage schedule CSVs
   (https://ckan.opendata.pref.ishikawa.lg.jp/) */
import { download, decode, csvObjects } from "../lib.mjs";
import { convertDistrictWeeklyCsv } from "./district-weekly-csv.mjs";

export const SOURCE = {
  name: "Ishikawa Prefecture open data (garbage collection schedules)",
  url: "https://ckan.opendata.pref.ishikawa.lg.jp/",
  license: "Ishikawa Prefecture / municipality open data (CC BY)",
};

const PREF = "17";
const KAGA_URL = "https://ckan.opendata.pref.ishikawa.lg.jp/dataset/e0d5e5e1-afbb-411a-a3cf-0d0a9ecd608e/resource/4a779e7c-944d-4cb7-83e3-c2e406aba079/download/172065_gomisyusyubi_202304.csv";

const HEADER_TO_BIN = [
  [/燃やす|もえる/, "burnable"],
  [/燃やさない|もえない/, "non_burnable"],
  [/プラスチック|プラ/, "plastic"],
  [/資源/, "resource"],
  [/有害/, "hazardous"],
  [/紙製|^紙$/, "paper"],
];

const BINS = {
  burnable:{label:"燃やすごみ", en:"Burnable", kind:"burn"},
  non_burnable:{label:"燃やさないごみ", en:"Non-burnable", kind:"non"},
  plastic:{label:"プラスチック製容器包装", en:"Plastic", kind:"pla"},
  resource:{label:"資源ごみ", en:"Recyclables", kind:"res"},
  paper:{label:"紙製容器包装", en:"Paper packs", kind:"res"},
  hazardous:{label:"有害ごみ", en:"Hazardous", kind:"haz"},
  oversized:{label:"粗大ごみ", en:"Oversized", kind:"big"},
  no:{label:"収集しないもの", en:"Not collected", kind:"no"},
};

/** Kaga CSV: 月2月4 → 第2・4月; semicolon-separated 毎週…曜日 → weekday list */
function kagaCell(cell){
  let s = (cell ?? "").trim().normalize("NFKC").replace(/\s+/g, "");
  if(!s) return s;
  const nth = s.match(/^([日月火水木金土])((?:\d+月)+)$/);
  if(nth){
    const weeks = [...nth[2].matchAll(/\d+/g)].map(m => +m[0]);
    return `第${weeks.join("・")}${nth[1]}`;
  }
  return s.split(";").map(part => part.replace(/^毎週/, "").replace(/曜日/g, "")).filter(Boolean).join("・");
}

function kagaRows(raw, aprilMonth){
  const pick = new Map();
  for(const row of raw){
    const months = row["適用月"]?.split(";").map(Number) ?? [];
    if(!months.includes(aprilMonth)) continue;
    pick.set(`${row["地区名称"]}|${row["区域名称"]}`, row);
  }
  return [...pick.values()].map(row => ({
    地区名:`${row["地区名称"]} ${row["区域名称"]}`.trim(),
    読み:row["区域名称_カナ"] ?? row["地区名称_カナ"] ?? "",
    燃やす:kagaCell(row["もえるごみ_収集曜日"]),
    燃やさない:kagaCell(row["もえないごみ_収集曜日"]),
    プラ:kagaCell(row["プラスチック製容器包装_収集曜日"]),
    資源:kagaCell(row["資源ごみ_収集曜日"]),
    有害:kagaCell(row["有害ごみ_収集曜日"]),
    紙:kagaCell(row["紙製容器包装_収集曜日"]),
    備考:row["備考"],
  }));
}

/** @type {{id:string, code:string, jp:string, en:string, url:string, validFrom:string, validTo:string, aprilMonth:number}[]} */
export const MUNICIPALITIES = [
  {
    id:"kaga", code:"17205", jp:"加賀市", en:"Kaga",
    url:KAGA_URL, validFrom:"2026-04-01", validTo:"2027-03-31", aprilMonth:4,
  },
];

export async function convert(entry, extractedAt){
  const buf = await download("ishikawa-pref", entry.url);
  const raw = csvObjects(decode(buf, "UTF-8"));
  return convertDistrictWeeklyCsv({
    cacheKey:`ishikawa-pref-${entry.id}`,
    source:{...SOURCE, commit:entry.url.split("/").pop()},
    pref:PREF, bins:BINS, headerToBin:HEADER_TO_BIN,
    entry:{
      id:entry.id, code:entry.code, jp:entry.jp, en:entry.en,
      validFrom:entry.validFrom, validTo:entry.validTo, sourceUrls:[entry.url],
    },
    calendarNote:"Weekday rules from Kaga's ごみ収集日一覧 on Ishikawa Prefecture open data (April-season row set). Confirm holidays on the city page.",
    contacts:[{en:"Kaga City Environment Division", tel:"0761-72-8111"}],
    loadRows: async () => kagaRows(raw, entry.aprilMonth),
  }, extractedAt);
}
