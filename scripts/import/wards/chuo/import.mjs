/* Chuo: official open-data CSV, one row per town or chome/banchi group. The 粗大ごみ column is the pickup weekday for booked oversized items, so it isn't a collection rule. */
import { parseRule } from "../../lib.mjs";

const COLUMNS = {burn:"燃やすごみ", non:"燃やさないごみ", pla:"プラマーク", res:"資源"};

export async function areas({rs, towns, download, decode, csvObjects}){
  const rows = csvObjects(decode(await download(rs.schedule.source), "CP932"));
  return rows.map(r => {
    /* rows under the 日本橋 region drop the 日本橋 prefix (人形町 is officially 日本橋人形町) */
    const town = [r["町名"], r["地域"] + r["町名"]].find(t => towns.has(t));
    if(!town) throw new Error(`unknown town ${r["地域"]} ${r["町名"]}`);
    const schedule = Object.fromEntries(Object.entries(COLUMNS).map(([bin, col]) => [bin, parseRule(r[col])]));
    return {town, part:r["丁目"], schedule};
  });
}
