/* Higashikurume City: east/west weekday rules (official HTML lists, no table). */
import { download, decode } from "../lib.mjs";
import { buildFromDistricts } from "./html-weekly-table.mjs";

const URL = "https://www.city.higashikurume.lg.jp/kurashi/kankyo/shigen/1018874/1000817.html";

export const SOURCE = {
  name: "Higashikurume City collection weekday rules (official HTML)",
  url: URL,
  license: "Higashikurume City website",
};

const BINS = {
  burnable: {label: "燃やせるごみ", en: "Burnable", kind: "burn"},
  plastic: {label: "容器包装プラスチック", en: "Plastic packaging", kind: "pla"},
  pet_bottle: {label: "PETボトル", en: "PET bottles", kind: "res"},
  glass_bottle: {label: "びん", en: "Glass bottles", kind: "res"},
  non_burnable: {label: "燃やせないごみ", en: "Non-burnable", kind: "non"},
  hazardous: {label: "有害ごみ", en: "Hazardous", kind: "haz"},
  beverage_can: {label: "缶", en: "Cans", kind: "res"},
  paper: {label: "紙類", en: "Paper", kind: "res"},
  cloth: {label: "布類", en: "Cloth", kind: "res"},
  no: {label: "収集しないもの", en: "Not collected", kind: "no"},
};

function addDay(schedule, bin, dayChar){
  const key = dayChar + "曜日";
  const prev = schedule[bin];
  if(!prev) schedule[bin] = key;
  else if(prev !== key && !prev.includes(dayChar)) schedule[bin] = `${prev.replace(/曜日/g, "")} ${dayChar}曜日`.replace(/\s+/g, " ").trim();
}

function parseRegion(text, name){
  const schedule = {};
  for(const line of text.split("\n")){
    const m = line.match(/^([日月火水木金土])曜日：(.+)$/);
    if(!m) continue;
    const day = m[1];
    const items = m[2];
    if(/容器包装プラスチック|PET/.test(items)){
      addDay(schedule, "plastic", day);
      addDay(schedule, "pet_bottle", day);
    }
    if(/燃やせるごみ/.test(items)) addDay(schedule, "burnable", day);
    if(/びん/.test(items)) addDay(schedule, "glass_bottle", day);
    if(/燃やせない/.test(items)) addDay(schedule, "non_burnable", day);
    if(/有害/.test(items)) addDay(schedule, "hazardous", day);
    if(/缶/.test(items)) addDay(schedule, "beverage_can", day);
    if(/紙類/.test(items)) addDay(schedule, "paper", day);
    if(/布類/.test(items)) addDay(schedule, "cloth", day);
  }
  if(!schedule.burnable) throw new Error(`${name}: missing burnable rule`);
  return {jp: name, schedule};
}

function parse(html){
  const plain = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, "\n").replace(/\u00a0/g, " ");
  const east = plain.match(/東地区（[\s\S]*?）([\s\S]*?)(?=西地区|$)/)?.[0] ?? "";
  const west = plain.match(/西地区（[\s\S]*?）([\s\S]*?)(?=下記の添付|$)/)?.[0] ?? "";
  if(!east || !west) throw new Error("expected east/west region blocks");
  return [
    parseRegion(east, "東地区"),
    parseRegion(west, "西地区"),
  ];
}

export async function convert(extractedAt){
  const html = decode(await download("higashikurume", URL));
  const districts = parse(html);
  const spec = {
    id: "higashikurume",
    code: "13222",
    pref: "13",
    jp: "東久留米市",
    en: "Higashikurume",
    url: URL,
    sourceName: SOURCE.name,
    validFrom: "2026-04-01",
    validTo: "2027-03-31",
    bins: BINS,
    note:
      "Two collection regions (east and west) with different weekday assignments. Public-holiday rules are on a separate city page — confirm before year-end.",
    districts,
    minDistricts: 2,
  };
  return buildFromDistricts(spec, districts, extractedAt);
}
