/* Taito: the ward-wide HTML table (町丁名 | 資源 | 燃やすごみ | 燃やさないごみ). Plastic goes out on the 資源 day. */
import { parseRule, htmlTables, splitTown } from "../../lib.mjs";

export async function areas({rs, towns, download, decode}){
  const table = htmlTables(decode(await download(rs.schedule.source))).find(t => t[0]?.includes("町丁名"));
  if(!table) throw new Error("collection-day table not found");
  const col = name => table[0].indexOf(name);
  const [res, burn, non] = ["資源", "燃やすごみ", "燃やさないごみ"].map(col);
  return table.slice(1).map(r => {
    const [town, part] = splitTown(r[col("町丁名")], towns);
    return {town, part, schedule:{res:parseRule(r[res]), pla:parseRule(r[res]), burn:parseRule(r[burn]), non:parseRule(r[non])}};
  });
}
