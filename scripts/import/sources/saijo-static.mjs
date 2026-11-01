import { buildStaticWeekly } from "./static-weekly.mjs";

export const SOURCE = {
  name:"Saijo City garbage separation guide (district weekday table)",
  url:"https://www.city.saijo.ehime.jp/uploaded/attachment/62453.pdf",
  license:"Saijo City (CC BY)",
};

/** District burnable / non-burnable weekday pairs from Saijo City's published table (FY2023 table; verify on city site). */
const ROWS = [
  ["玉津・飯岡", "月 木", "火"],
  ["西条", "火 金", "月"],
  ["神拝", "火 金", "木"],
  ["大町", "月 木", "金"],
  ["神戸", "月 木", "金"],
  ["舟形・津越・長瀬", "火 金", "水"],
  ["兎之山・中寺", "月 木", "火2 火4"],
  ["大久保", "月 木", "水"],
  ["禎瑞", "火 金", "木"],
  ["橘", "月 木", "火"],
  ["氷見", "火 金", "月"],
  ["加茂", "火 金", "火1 火3"],
  ["大保木・市之川", "月 木", "火2 火4"],
  ["吉井・多賀", "火 金", "水"],
  ["国安", "月 木", "水"],
  ["吉岡", "月 木", "火"],
  ["周布・壬生川", "火 金", "月"],
  ["三芳・楠河・庄内", "月 木", "金"],
  ["黒谷", "木", "木"],
  ["久妙寺・徳田", "火 金", "月"],
  ["田野・田滝", "火 金", "金"],
  ["丹原・古田新出", "月 木", "月"],
  ["中川・桜樹", "火 金", "水"],
  ["相之谷", "金", "金"],
  ["小松・石根", "火 金", "木"],
];

export async function convert(extractedAt){
  return buildStaticWeekly({
    id:"saijo", code:"38207", pref:"38", jp:"西条市", en:"Saijo",
    source:SOURCE,
    note:"Weekday rules from Saijo City's district table (burnable + non-burnable columns). Paper/resources use nth-week rules — see the city's FY2026 district PDF calendar.",
    districts:ROWS.map(([jp, burn, non]) => ({
      jp, en:jp, schedule:{burnable:burn, non_burnable:non},
    })),
  }, extractedAt);
}
