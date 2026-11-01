/* Toyonaka FY2026 schedule extracted from the city's 60 official calendar PDFs by toyonaka-gomidashi.
   The upstream JSON stores every actual collection date, so holidays and year-end exceptions remain exact. */
import { download, townRegistry, splitTown, parsePart, partEn } from "../lib.mjs";

export const SOURCE = {
  name:"toyonaka-gomidashi",
  url:"https://github.com/ogatomo21/toyonaka-gomidashi",
  license:"MIT",
  commit:"167c2c960974",
  path:"src/data/schedule_2026.json",
};
const URL = `https://raw.githubusercontent.com/ogatomo21/toyonaka-gomidashi/${SOURCE.commit}/${SOURCE.path}`;
const CATEGORY = {
  burnable:["Burnable", "burn"],
  plastic:["Plastic packaging", "pla"],
  bottles:["Glass bottles", "res"],
  cans:["Cans and small appliances", "res"],
  small_appliances:["Small appliances", "res"],
  nonburnable:["Non-burnable", "non"],
  paper_cloth:["Paper and cloth", "res"],
  pet_bottles:["PET bottles", "res"],
};
const TOWN_ALIASES = {"蛍池":"螢池"};

export async function convert(today){
  const data = JSON.parse((await download("toyonaka-gomidashi", URL)).toString());
  const towns = await townRegistry("豊中市", {pref:"27"});
  const bins = Object.fromEntries(Object.entries(CATEGORY).map(([id, [en, kind]]) => [id, {
    label:{burnable:"可燃ごみ", plastic:"プラスチック製容器包装", bottles:"ガラスびん", cans:"空き缶・危険ごみ",
      small_appliances:"小型家電", nonburnable:"不燃ごみ", paper_cloth:"紙・布", pet_bottles:"ペットボトル"}[id],
    en, kind,
  }]));
  bins.oversized = {label:"粗大ごみ", en:"Oversized", kind:"big"};
  bins.no = {label:"市では収集しないもの", en:"Not collected", kind:"no"};

  const patterns = {}, areas = [];
  for(const sourceArea of data.areas){
    const dates = {};
    for(const [date, categories] of Object.entries(sourceArea.days))
      for(const category of categories) (dates[category] ??= []).push(date);
    dates.oversized = sourceArea.bulky_days;
    patterns[String(sourceArea.id)] = Object.fromEntries(Object.entries(dates).filter(([, list]) => list.length).map(([bin, list]) => [bin, {dates:[...list].sort()}]));

    for(const sourceName of sourceArea.towns){
      const normalized = Object.entries(TOWN_ALIASES).reduce((name, [from, to]) => name.replace(from, to), sourceName);
      const [town, rest] = splitTown(normalized, towns), registered = towns.get(town);
      for(const part of parsePart(rest)) areas.push({
        town,
        townEn:registered.en,
        kana:registered.kana,
        chome:part.chome,
        detail:part.detail,
        en:partEn(part),
        jp:part.chome || part.detail ? `${part.chome ? `${part.chome.join("・")}丁目` : ""}${part.detail ?? ""}` : "全域",
        pattern:String(sourceArea.id),
      });
    }
  }
  areas.sort((a, b) => a.kana.localeCompare(b.kana, "ja") || (a.chome?.[0] ?? 0) - (b.chome?.[0] ?? 0));
  return {
    id:"toyonaka", code:"27203", pref:"27", jp:"豊中市", en:"Toyonaka", verified:"2026-08-18",
    sources:[data.source], contacts:[], bins, plasticTest:null, sorting:{},
    calendar:{
      noCollection:{weekdays:[], dates:[]},
      note:"FY2026 collection dates extracted from Toyonaka's 60 official area calendars.",
      validFrom:"2026-04-01", validTo:"2027-03-31", patterns,
    },
    areas,
    attribution:{schedule:{...SOURCE}},
    updated:today,
  };
}
