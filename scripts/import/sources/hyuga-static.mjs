import { buildStaticWeekly } from "./static-weekly.mjs";

export const SOURCE = {
  name:"Hyuga City garbage handling plan / FY2026 guide",
  url:"https://www.hyugacity.jp/display.php?cont=210319104646",
  license:"Hyuga City open data",
};

export async function convert(extractedAt){
  return buildStaticWeekly({
    id:"hyuga", code:"45206", pref:"45", jp:"日向市", en:"Hyuga",
    source:SOURCE,
    note:"Burnable and plastic weekdays from Hyuga City published schedules (two main burnable zones). Non-burnable uses nth-Wednesday rules — see city calendar PDFs for your district number.",
    districts:[
      {jp:"月・木燃やせるごみ区域", en:"Mon & Thu burnable zone",
        schedule:{burnable:"月 木", plastic:"火"}},
      {jp:"火・金燃やせるごみ区域", en:"Tue & Fri burnable zone",
        schedule:{burnable:"火 金", plastic:"月"}},
    ],
  }, extractedAt);
}
