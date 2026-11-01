import { buildStaticWeekly } from "./static-weekly.mjs";

export const SOURCE = {
  name:"Kochi City official garbage collection schedule",
  url:"https://www.city.kochi.kochi.jp/soshiki/64/collection-kochi2.html",
  license:"Kochi City (CC BY 4.0 open data terms)",
};

export async function convert(extractedAt){
  return buildStaticWeekly({
    id:"kochi-city", code:"39201", pref:"39", jp:"高知市", en:"Kochi",
    source:SOURCE,
    note:"Burnable weekdays from Kochi City's published district table; plastic is citywide Wednesday. Resource/non-burnable dates are not fully published — confirm on the city site.",
    districts:[
      {id:"a", jp:"月・木曜地区（朝倉・高知街など）", en:"Mon & Thu burnable zone",
        schedule:{burnable:"月 木", plastic:"水"}},
      {id:"b", jp:"火・金曜地区（小高坂・一宮など）", en:"Tue & Fri burnable zone",
        schedule:{burnable:"火 金", plastic:"水"}},
    ],
  }, extractedAt);
}
