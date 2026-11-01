/* Niiza City: recyclable + burnable weekday table (official HTML). Non-burnable schedules are PDF-only — not included. */
import { download, decode } from "../lib.mjs";
import { buildStaticWeekly } from "./static-weekly.mjs";

const URL = "https://www.city.niiza.lg.jp/site/gominodasikata/gomirecycleshushunittei.html";

export const SOURCE = {
  name: "Niiza City recyclable & burnable collection weekday table",
  url: URL,
  license: "Niiza City website (collection facts)",
};

function stripTags(html){
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function weekdayCell(text){
  const days = [...text.matchAll(/([日月火水木金土])曜日/g)].map(m => m[1]);
  return days.length ? days.join(" ") : null;
}

function parseRows(html){
  const districts = [];
  for(const block of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)){
    const cells = [...block[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => stripTags(c[1]));
    if(cells.length < 3) continue;
    const [region, resCell, burnCell] = cells;
    if(!region || region === "地域" || /収集日/.test(region)) continue;
    const res = weekdayCell(resCell);
    const burnable = weekdayCell(burnCell);
    if(!res && !burnable) continue;
    districts.push({
      jp: region,
      schedule: {...(res ? {res} : {}), ...(burnable ? {burnable} : {})},
    });
  }
  if(districts.length < 10) throw new Error(`expected ~38 districts, got ${districts.length}`);
  return districts;
}

export async function convert(extractedAt){
  const html = decode(await download("niiza", URL));
  return buildStaticWeekly({
    id: "niiza",
    code: "11230",
    pref: "11",
    jp: "新座市",
    en: "Niiza",
    source: SOURCE,
    bins: {
      burnable: {label: "可燃ごみ", en: "Burnable", kind: "burn"},
      res: {label: "リサイクル資源", en: "Recyclables", kind: "res"},
      no: {label: "収集しないもの", en: "Not collected", kind: "no"},
    },
    note: "Weekday rules from the city's official recyclable & burnable table. Non-burnable collection days are not in this table — see the city PDF calendar for those bins.",
    districts: parseRows(html),
  }, extractedAt);
}
