/* Ota: open-data XLSX (sheet R07全域, matches the FY2026 pamphlet pp.17-18). Blank cells are vertical merges, so values fill down. */
import XLSX from "xlsx";
import { parseRule } from "../../lib.mjs";

const COLUMNS = {pla:3, res:4, burn:5, non:6};
const FILL = [1, 3, 4, 5, 6, 7];

export async function areas({rs, download}){
  const wb = XLSX.read(await download(rs.schedule.source));
  const grid = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {header:1, defval:""}).map(r => r.map(c => String(c).trim()));
  if(!/町丁目/.test(grid[0][0])) throw new Error(`unexpected header in sheet ${wb.SheetNames[0]}`);
  let prev = [];
  return grid.slice(1).filter(r => r[2]).map(r => {
    const row = r.map((c, i) => c || (FILL.includes(i) ? prev[i] ?? "" : c));
    prev = row;
    return {town:row[1], part:row[2], label:row[2].replace(/\s+/g, ""),
      schedule:Object.fromEntries(Object.entries(COLUMNS).map(([bin, i]) => [bin, parseRule(row[i])]))};
  });
}
