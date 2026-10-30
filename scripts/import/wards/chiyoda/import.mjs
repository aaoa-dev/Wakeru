/* Chiyoda: the address → calendar No. table on the sorting page; the 12 calendars themselves are curated in calendars.json (from the official calendar PDFs). */
import fs from "node:fs";
import path from "node:path";
import { htmlTables, splitTown } from "../../lib.mjs";

export async function areas({rs, towns, download, decode, dir}){
  const {calendars} = JSON.parse(fs.readFileSync(path.join(dir, "calendars.json"), "utf8"));
  const table = htmlTables(decode(await download(rs.schedule.source))).find(t => t[0]?.[0] === "住所" && /カレンダー/.test(t[0][1]));
  if(!table) throw new Error("address table not found on the sorting page");
  const rows = table.slice(1).map(([address, no]) => {
    const [town, part] = splitTown(address, towns);
    const pattern = no.match(/^\d+/)?.[0];
    if(!calendars[pattern]) throw new Error(`"${address}" points to unknown calendar "${no}"`);
    return {town, part, label:part || "全域", pattern};
  });
  return {areas:rows, patterns:calendars};
}
