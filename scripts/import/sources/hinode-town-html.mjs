/* Hinode Town (Tokyo): town-wide bin rules + A/B contractor districts (official HTML). */
import { download, decode } from "../lib.mjs";
import { buildFromDistricts, cellRule } from "./html-weekly-table.mjs";

const URL = "https://www.town.hinode.tokyo.jp/0000000162.html";

export const SOURCE = {
  name: "Hinode Town garbage separation and collection days",
  url: URL,
  license: "Hinode Town website (collection facts)",
};

const BINS = {
  burnable: {label: "可燃ごみ", en: "Burnable", kind: "burn"},
  non_burnable: {label: "不燃ごみ", en: "Non-burnable", kind: "non"},
  res_a: {label: "資源A", en: "Recyclables A", kind: "res"},
  res_b: {label: "資源B", en: "Recyclables B", kind: "res"},
  pet_bottle: {label: "ペットボトル・白色トレイ", en: "PET & white trays", kind: "res"},
  hazardous: {label: "有害ごみ", en: "Hazardous", kind: "haz"},
  no: {label: "収集しないもの", en: "Not collected", kind: "no"},
};

function stripTags(html){
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** @returns {Record<string, unknown>} */
function parseTownSchedule(html){
  if(!/ごみの出し方/.test(html) && !/可燃ごみ/.test(html)) throw new Error("expected Hinode schedule page");
  const validFrom = "2026-04-01";
  const validTo = "2027-03-31";
  const schedule = {};
  for(const block of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)){
    const cells = [...block[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => stripTags(c[1]));
    if(cells.length !== 2 || cells[0] === "分別区分") continue;
    const binKey = {
      "可燃ごみ": "burnable",
      "不燃ごみ": "non_burnable",
      "資源A": "res_a",
      "資源B": "res_b",
      "ペットボトル・白色トレイ": "pet_bottle",
      "有害ごみ": "hazardous",
    }[cells[0]];
    if(!binKey) continue;
    let rule = cellRule(cells[1], validFrom, validTo);
    if(cells[1].includes("毎月2回") && rule?.weeks?.length === 1){
      rule = {...rule, weeks: [2, 4]};
    }
    if(rule) schedule[binKey] = rule;
  }
  if(!schedule.burnable || !schedule.non_burnable) throw new Error("incomplete Hinode schedule table");
  return schedule;
}

export async function convert(extractedAt){
  const html = decode(await download("hinode-town", URL));
  const schedule = parseTownSchedule(html);
  const districts = [
    {jp: "A地区（大久野・平井の一部）", schedule},
    {jp: "B地区（平井の一部）", schedule},
  ];
  return buildFromDistricts({
    id: "hinode-town",
    code: "13305",
    pref: "13",
    jp: "日の出町",
    en: "Hinode",
    url: URL,
    sourceName: SOURCE.name,
    validFrom: "2026-04-01",
    validTo: "2027-03-31",
    bins: BINS,
    note:
      "Same collection weekdays town-wide; A/B districts differ only by hauler (see the town's 地番 table). " +
      "資源A/B and PET use twice-monthly collection (2nd and 4th week of the month on the listed weekday).",
  }, districts, extractedAt);
}
