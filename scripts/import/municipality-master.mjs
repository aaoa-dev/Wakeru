/* Digital Agency city master (same source as scripts/import/map.mjs). */
import { download, decode, unzipFirst, csvObjects } from "./lib.mjs";

const CITY_MASTER = "https://data.address-br.digital.go.jp/mt_city/mt_city_all.csv.zip";
const stripEn = s => (s ?? "").replace(/-(shi|ku|machi|cho|mura|son)$/i, "");

let cache;

/** @returns {{code:string, pref:string, jp:string, en:string, cityRoma:string}[]} */
export async function listCities(){
  if(cache) return cache;
  const rows = csvObjects(decode(unzipFirst(await download("map", CITY_MASTER)))).filter(r => !r.ablt_date && !r.ward);
  cache = rows.map(r => ({
    code: r.lg_code.slice(0, 5),
    pref: r.lg_code.slice(0, 2),
    jp: r.city,
    en: stripEn(r.city_roma),
    cityRoma: r.city_roma,
  }));
  return cache;
}

export function slugCandidates(cityRoma){
  const base = cityRoma.toLowerCase();
  const stripped = base.replace(/-(shi|ku|machi|cho|mura|son)$/i, "");
  const out = new Set([
    stripped.replace(/-/g, ""),
    stripped,
    base.replace(/-/g, ""),
  ]);
  const head = base.split("-")[0];
  if(head.length > 2) out.add(head);
  return [...out].filter(Boolean);
}
