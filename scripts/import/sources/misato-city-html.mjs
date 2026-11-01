/* Misato City (Saitama, 11237): district × bin table on the official collection page. */
import { download, decode } from "../lib.mjs";
import { buildFromDistricts, cellRule } from "./html-weekly-table.mjs";

const URL = "https://www.city.misato.lg.jp/soshiki/shiminseikatsu/kurinraifu/2/9739.html";

export const SOURCE = {
  name: "Misato City (Saitama) district collection schedule table",
  url: URL,
  license: "Misato City website (collection facts; license not stated as open data)",
};

const BINS = {
  burnable: {label: "もえるごみ", en: "Burnable", kind: "burn"},
  res: {label: "びん・かん", en: "Bottles & cans", kind: "res"},
  non_burnable: {label: "燃やせない資源", en: "Non-burnable recyclables", kind: "non"},
  pet_bottle: {label: "ペットボトル", en: "PET bottles", kind: "res"},
  no: {label: "収集しないもの", en: "Not collected", kind: "no"},
};

function stripTags(html){
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function cleanDistrictName(raw){
  return raw
    .replace(/\(PDFファイル:[^)]+\)/g, "")
    .replace(/（注釈）/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** @returns {{jp:string, schedule:Record<string, unknown>}[]} */
function parse(html){
  if(!/もえる[\s\S]{0,48}?ごみ/.test(html) || !/地区名/.test(html)) {
    throw new Error("expected Misato City schedule table");
  }
  const validFrom = "2026-04-01";
  const validTo = "2027-03-31";
  const districts = [];
  for(const block of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)){
    const cells = [...block[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => stripTags(c[1]));
    if(cells.length < 5) continue;
    const name = cleanDistrictName(cells[0]);
    if(!name || name === "地区名" || /^収集区$/.test(name)) continue;
    const burnCell = cells[2];
    const resCell = cells[3];
    const petCell = cells[4];
    const burnable = cellRule(burnCell, validFrom, validTo);
    const pet_bottle = cellRule(petCell, validFrom, validTo);
    const resDayRule = cellRule(resCell, validFrom, validTo);
    let res;
    let non_burnable;
    if(resDayRule && typeof resDayRule === "object" && !Array.isArray(resDayRule) && resDayRule.weeks){
      res = resDayRule;
      non_burnable = {day: resDayRule.day, weeks: [2, 4]};
    } else {
      const day = Array.isArray(resDayRule) ? resDayRule[0] : resDayRule?.day;
      if(day == null) continue;
      res = {day, weeks: [1, 3]};
      non_burnable = {day, weeks: [2, 4]};
    }
    if(!burnable || !pet_bottle) continue;
    districts.push({
      jp: name,
      schedule: {burnable, res, non_burnable, pet_bottle},
    });
  }
  if(districts.length < 40) throw new Error(`expected many Misato districts, got ${districts.length}`);
  return districts;
}

export async function convert(extractedAt){
  const html = decode(await download("misato-city", URL));
  const districts = parse(html);
  return buildFromDistricts({
    id: "misato-city",
    code: "11237",
    pref: "11",
    jp: "三郷市",
    en: "Misato",
    url: URL,
    sourceName: SOURCE.name,
    validFrom: "2026-04-01",
    validTo: "2027-03-31",
    bins: BINS,
    note:
      "Weekday rules from the city's official 地区別収集日 table. Bottles/cans are weeks 1 and 3; " +
      "non-burnable recyclables weeks 2 and 4 on the same weekday column. PET collection uses the 月2回 column.",
  }, districts, extractedAt);
}
