import { buildStaticWeekly } from "./static-weekly.mjs";

export const SOURCE = {
  name:"Arao City garbage and recycling calendar (FY2026)",
  url:"https://www.city.arao.lg.jp/kurashi/gomi/12382.html",
  license:"Arao City open data",
};

export async function convert(extractedAt){
  return buildStaticWeekly({
    id:"arao", code:"43204", pref:"43", jp:"荒尾市", en:"Arao",
    source:SOURCE,
    note:"Burnable weekdays from Arao City FY2026 district calendars (two recycle zones). Other bins follow the city's PDF calendar.",
    districts:[
      {jp:"荒尾・万田・井手川・有明・平井・緑ケ丘地区", en:"Arao zone A",
        schedule:{burnable:"月 木"}},
      {jp:"中央・八幡・万田中央・清里・府本・桜山地区", en:"Arao zone B",
        schedule:{burnable:"火 金"}},
    ],
  }, extractedAt);
}
