/* Koto: FY2026 districts and non-burnable dates transcribed from the official calendars (fy2026.json),
   cross-checked against the ward's open-data CSV, which predates the FY2026 changes for 豊洲 and 塩浜. */
import fs from "node:fs";
import path from "node:path";
import { parseRule, parsePart } from "../../lib.mjs";

const CSV = "https://www.opendata.metro.tokyo.lg.jp/koto/131083_201_kotocity_waste_recycle_collectionday.csv";
const CHANGED_IN_FY2026 = ["豊洲", "塩浜"];
const DAYS = "日月火水木金土";

export async function areas({download, decode, csvObjects, dir}){
  const fy = JSON.parse(fs.readFileSync(path.join(dir, "fy2026.json"), "utf8"));
  const today = new Date().toISOString().slice(0, 10);
  if(today > fy.validTo) throw new Error(`fy2026.json expired on ${fy.validTo}; transcribe the new fiscal year's calendars`);

  for(const r of csvObjects(decode(await download(CSV), "CP932"))){
    const address = r["住所"].trim(), town = CHANGED_IN_FY2026.find(t => address.startsWith(t));
    if(town) continue;
    const d = fy.districts[r["地区番号"]];
    const same = (rule, cell) => JSON.stringify(rule) === JSON.stringify(parseRule(cell));
    const nonDay = DAYS.indexOf(r["燃やさないごみ"].replace(/（隔週）/, ""));
    if(!same(d.res, r["資源"]) || !same(d.pla, r["プラスチック"]) || !same(d.burn, r["燃やすごみ"]) || new Date(d.non.dates[0]).getDay() !== nonDay)
      throw new Error(`open-data CSV disagrees with fy2026.json for ${address} (district ${r["地区番号"]})`);
    const [, name, part] = address.match(/^(\D+?)(\d.*)?$/);
    const chome = parsePart(part ?? "")[0].chome;
    const listed = fy.areas.filter(a => a.town === name && a.district === +r["地区番号"]);
    if(!listed.some(a => !a.chome || !chome || chome.every(n => a.chome.includes(n))))
      throw new Error(`open-data CSV puts ${address} in district ${r["地区番号"]} but fy2026.json doesn't`);
  }

  const patterns = Object.fromEntries(Object.entries(fy.districts).map(([id, d]) => [id, d]));
  const rows = fy.areas.map(a => ({
    town:a.town, pattern:String(a.district),
    parts:[{chome:a.chome, detail:null}], label:a.chome ? `${a.chome.join("・")}丁目` : "全域",
  }));
  return {areas:rows, patterns, validTo:fy.validTo};
}
