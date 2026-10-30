/* Bunkyo: official open-data CSV (same content as the HTML table on the collection-day page), one row per chome group or banchi range. */
import { parseRule } from "../../lib.mjs";

const COLUMNS = {burn:/^可燃/, non:/^不燃/, res:/^資源（新聞/, pla:/^資源（プラスチック/};

export async function areas({rs, download, decode, csvObjects}){
  const rows = csvObjects(decode(await download(rs.schedule.source), "CP932"));
  const keys = Object.keys(rows[0]);
  const col = Object.fromEntries(Object.entries(COLUMNS).map(([bin, re]) => [bin, keys.find(k => re.test(k))]));
  return rows.map(r => ({
    town:r["町名"], part:r["丁目"],
    schedule:Object.fromEntries(Object.entries(col).map(([bin, k]) => [bin, parseRule(r[k])])),
  }));
}
