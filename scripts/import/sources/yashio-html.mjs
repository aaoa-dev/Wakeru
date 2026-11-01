/* Yashio City: per-neighborhood HTML tables linked from the collection-day index. */
import { download, decode } from "../lib.mjs";
import { convertHtmlWeekly } from "./html-weekly-table.mjs";

const INDEX = "https://www.city.yashio.lg.jp/kurashi/gomi_kankyo/shushubi/ichiran/index.html";
const BASE = "https://www.city.yashio.lg.jp";

export const SOURCE = {
  name: "Yashio City neighborhood collection schedule tables",
  url: INDEX,
  license: "Yashio City website (collection facts)",
};

const SPEC = {
  validFrom: "2026-04-01",
  validTo: "2027-03-31",
  columns: [
    {header: /^地名$/},
    {header: /^燃えるごみ$/, bins: ["burnable"]},
    {header: /^資源燃えないごみ$/, bins: ["non_burnable"]},
    {header: /^ペットボトル$/, bins: ["pet_bottle"]},
  ],
  bins: {
    burnable: {label: "燃えるごみ", en: "Burnable", kind: "burn"},
    non_burnable: {label: "資源燃えないごみ", en: "Non-burnable recyclables", kind: "non"},
    pet_bottle: {label: "ペットボトル", en: "PET bottles", kind: "res"},
    no: {label: "収集しないもの", en: "Not collected", kind: "no"},
  },
  note: "Weekday rules merged from each neighborhood page on the city's collection-day index. Other recyclables use the linked PDF calendar for your カレンダー番号.",
};

function stripTags(html){
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function areaLinks(html){
  return [...html.matchAll(/href="(\/kurashi\/gomi_kankyo\/shushubi\/ichiran\/[^"]+\.html)"/gi)]
    .map(m => BASE + m[1]);
}

function parseAreaPage(html, areaSlug){
  const districts = [];
  for(const block of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)){
    const cells = [...block[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => stripTags(c[1]));
    if(cells.length < 4) continue;
    if(cells[0] === "地名" || /地番/.test(cells[0])) continue;
    const place = cells[0];
    const blockLabel = cells[1] && cells[1] !== "全域" ? cells[1] : "";
    const jp = blockLabel ? `${place} ${blockLabel}` : place;
    districts.push({
      jp,
      schedule: {
        burnable: cells[2],
        non_burnable: cells[3],
        pet_bottle: cells[4],
      },
    });
  }
  if(!districts.length) throw new Error(`no rows in ${areaSlug}`);
  return districts;
}

export async function convert(extractedAt){
  const indexHtml = decode(await download("yashio-index", INDEX));
  const links = [...new Set(areaLinks(indexHtml))];
  const all = [];
  for(const url of links){
    const slug = url.split("/").pop().replace(".html", "");
    const html = decode(await download("yashio", url));
    all.push(...parseAreaPage(html, slug));
  }
  if(all.length < 10) throw new Error(`expected many Yashio districts, got ${all.length}`);
  return convertHtmlWeekly({
    id: "yashio",
    code: "11234",
    pref: "11",
    jp: "八潮市",
    en: "Yashio",
    url: INDEX,
    sourceName: SOURCE.name,
    ...SPEC,
    districts: all,
  }, extractedAt);
}
