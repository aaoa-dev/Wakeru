import { buildStaticWeekly } from "./static-weekly.mjs";

export const SOURCE = {
  name:"Izumi City household waste district schedule tables",
  url:"https://www.city.kagoshima-izumi.lg.jp/page/page_20007.html",
  license:"Izumi City open data",
};

export async function convert(extractedAt){
  return buildStaticWeekly({
    id:"izumi", code:"46208", pref:"46", jp:"出水市", en:"Izumi",
    source:SOURCE,
    note:"Burnable weekdays from Izumi City FY2026 district tables (Izumi / Takao / Noda areas). Recycling and non-burnable use monthly rules — see the city's district calendar for your neighborhood association.",
    districts:[
      {jp:"出水・高尾野（月・木）", en:"Mon & Thu burnable",
        schedule:{burnable:"月 木"}},
      {jp:"出水・高尾野（火・金）", en:"Tue & Fri burnable",
        schedule:{burnable:"火 金"}},
      {jp:"野田地域（月・金）", en:"Mon & Fri burnable (Noda)",
        schedule:{burnable:"月 金"}},
    ],
  }, extractedAt);
}
