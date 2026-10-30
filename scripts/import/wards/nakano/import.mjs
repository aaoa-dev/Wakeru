/* Nakano: the ward-wide HTML table (repeated header rows between blocks). Paper and clothes go to community group collection and have no ward schedule. */
import { parseRule, htmlTables } from "../../lib.mjs";

const COLUMNS = {pla:/^資源プラ/, res:/^びん/, burn:/^燃やす/, non:/^陶器/};
const DAILY = "（毎日収集地域は除く）";

export async function areas({rs, download, decode}){
  const [table] = htmlTables(decode(await download(rs.schedule.source)));
  const header = table[0].map(h => h.replace(/\s/g, ""));
  const col = Object.fromEntries(Object.entries(COLUMNS).map(([bin, re]) => [bin, header.findIndex(h => re.test(h))]));
  return table.filter(r => r[0] !== table[0][0]).map(r => {
    const part = r[1].replace(/\s/g, "");
    return {
      town:r[0], part:part.replace(DAILY, ""), label:part,
      ...(part.includes(DAILY) ? {note:"Excludes the daily-collection zone around Nakano Station; check the sign at your collection point."} : {}),
      schedule:Object.fromEntries(Object.entries(col).map(([bin, i]) => [bin, parseRule(r[i])])),
    };
  });
}
