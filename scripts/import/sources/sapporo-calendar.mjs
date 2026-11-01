/* Sapporo City — ごみ収集カレンダー (numeric type codes per district column) + ごみ種記号表 */
import { download, decode, csvObjects, kanaToRomaji } from "../lib.mjs";

export const SOURCE = {
  name: "Sapporo City garbage collection calendar open data",
  url: "https://ckan.pf-sapporo.jp/dataset/281fc9c2-7ca5-4aed-a728-0b588e509686",
  license: "Sapporo City open data",
};

const TYPE_URL = "https://ckan.pf-sapporo.jp/dataset/281fc9c2-7ca5-4aed-a728-0b588e509686/resource/f13f6d71-1fde-433d-b5c5-c38631fde7ca/download/gomitypenumber.csv";
const CALENDAR_URL = "https://ckan.pf-sapporo.jp/dataset/281fc9c2-7ca5-4aed-a728-0b588e509686/resource/94fe64f0-42b8-4748-a258-feb05ecb3491/download/garvagecollectioncalendar202610.csv";

const VALID_FROM = "2026-10-01";
const VALID_TO = "2027-09-30";

/** @type {Record<string, string>} */
const CODE_TO_BIN = {
  "1": "burnable",
  "2": "non_burnable",
  "8": "res_mixed",
  "9": "plastic",
  "10": "paper",
  "11": "yard_waste",
};

function decodeCsv(buf){
  for(const enc of ["UTF-8", "CP932"]){
    const text = decode(buf, enc);
    if(text.includes("日付") || text.includes("記号")) return csvObjects(text);
  }
  return csvObjects(decode(buf, "UTF-8"));
}

function districtColumns(headers){
  return headers.filter(h => h !== "日付" && h !== "曜" && !/^#/.test(h));
}

export async function convert(extractedAt){
  const calRows = decodeCsv(await download("sapporo", CALENDAR_URL));
  if(!calRows.length) throw new Error("empty calendar CSV");
  const headers = Object.keys(calRows[0]);
  const districts = districtColumns(headers);
  if(!districts.length) throw new Error("no district columns");

  const patterns = Object.fromEntries(districts.map(d => [d, {}]));

  for(const row of calRows){
    const day = (row["日付"] ?? "").trim();
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < VALID_FROM || day > VALID_TO) continue;
    for(const col of districts){
      const raw = (row[col] ?? "").trim();
      if(!raw) continue;
      const bin = CODE_TO_BIN[raw];
      if(!bin) continue;
      (patterns[col][bin] ??= {dates:[]}).dates.push(day);
    }
  }

  for(const col of districts){
    for(const bin of Object.keys(patterns[col]))
      patterns[col][bin].dates = [...new Set(patterns[col][bin].dates)].sort();
  }

  const areas = districts.map(jp => {
    const pattern = jp;
    const kana = jp.replace(/[0-9０-９]/g, "");
    return {
      town: jp, townEn: kanaToRomaji(kana) || jp, kana, chome: null, detail: null,
      en: jp, jp, pattern,
    };
  }).filter(a => patterns[a.pattern] && Object.keys(patterns[a.pattern]).length);

  if(!areas.length) throw new Error("no areas with collection data");

  const bins = {
    burnable: {label: "燃やせるごみ", en: "Burnable", kind: "burn"},
    non_burnable: {label: "燃やせないごみ", en: "Non-burnable", kind: "non"},
    res_mixed: {label: "びん・缶・ペット", en: "Bottles, cans, PET", kind: "res"},
    plastic: {label: "容器プラ", en: "Plastic containers", kind: "pla"},
    paper: {label: "雑がみ", en: "Paper", kind: "res"},
    yard_waste: {label: "枝・葉・草", en: "Yard waste", kind: "burn"},
    oversized: {label: "粗大ごみ", en: "Oversized", kind: "big"},
  };

  return {
    id: "sapporo", code: "01100", pref: "01", jp: "札幌市", en: "Sapporo", verified: extractedAt.slice(0, 10),
    sources: [SOURCE.url, CALENDAR_URL, TYPE_URL],
    contacts: [{en: "Sapporo City Environmental Bureau", tel: "011-211-2111"}],
    bins, plasticTest: null, sorting: {},
    calendar: {
      validFrom: VALID_FROM, validTo: VALID_TO,
      noCollection: {weekdays: [0], dates: ["01-01", "01-02", "01-03", "12-29", "12-30", "12-31"]},
      note: "Daily collection types from Sapporo open-data calendar (type codes 1–11). Confirm holidays and paid-bag rules on the city's official page.",
      patterns,
    },
    areas,
    attribution: {schedule: SOURCE},
    updated: extractedAt.slice(0, 10),
  };
}
