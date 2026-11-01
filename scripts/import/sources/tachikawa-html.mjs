/* Tachikawa City: four districts, dl weekday lists (毎週 + 隔週 nth weeks from FY2026 calendars). */
import { download, decode } from "../lib.mjs";
import { buildFromDistricts } from "./html-weekly-table.mjs";

const URL = "https://www.city.tachikawa.lg.jp/kurashi/gomi/1001712/1001741.html";

export const SOURCE = {
  name: "Tachikawa City district collection rules (official HTML)",
  url: URL,
  license: "Tachikawa City website",
};

const DAYS = "日月火水木金土";

const BINS = {
  burnable: {label: "燃やせるごみ", en: "Burnable", kind: "burn"},
  plastic: {label: "プラスチック", en: "Plastic", kind: "pla"},
  pet_bottle: {label: "ペットボトル", en: "PET bottles", kind: "res"},
  glass_bottle: {label: "びん", en: "Glass bottles", kind: "res"},
  beverage_can: {label: "缶", en: "Cans", kind: "res"},
  paper: {label: "古紙・雑がみ", en: "Paper", kind: "res"},
  non_burnable: {label: "燃やせないごみ", en: "Non-burnable", kind: "non"},
  hazardous: {label: "有害ごみ", en: "Hazardous", kind: "haz"},
  no: {label: "収集しないもの", en: "Not collected", kind: "no"},
};

/** Biweekly weekday → nth weeks in month (aligned to R8 district calendars). */
const BIWEEKLY_WEEKS = {
  "1": {3: [1, 3], 4: [2, 4], 5: [1, 3]},
  "2": {2: [1, 3], 3: [1, 3], 4: [2, 4]},
  "3": {3: [2, 4], 4: [1, 3], 5: [2, 4]},
  "4": {1: [1, 3], 3: [2, 4], 5: [2, 4]},
};

const ITEM_BIN = [
  [/燃やせるごみ/, "burnable"],
  [/プラスチック/, "plastic"],
  [/ペットボトル/, "pet_bottle"],
  [/びん/, "glass_bottle"],
  [/缶/, "beverage_can"],
  [/雑誌|雑がみ|段ボール|新聞|古布|紙パック/, "paper"],
  [/燃やせない/, "non_burnable"],
  [/有害|スプレー|電池|せん定枝/, "hazardous"],
];

function binsForLine(line){
  const out = new Set();
  for(const [re, bin] of ITEM_BIN) if(re.test(line)) out.add(bin);
  return [...out];
}

function parseDistrict(html, districtId){
  const head = new RegExp(`<h3[^>]*>\\s*${districtId}地区`, "i");
  const chunk = html.split(head)[1]?.split(/<h3/i)[0] ?? "";
  const schedule = {};
  for(const block of chunk.matchAll(/<dt>([日月火水木金土])曜日<\/dt>\s*<dd>([\s\S]*?)<\/dd>/gi)){
    const day = DAYS.indexOf(block[1]);
    const body = block[2].replace(/<[^>]+>/g, "\n");
    for(const line of body.split("\n").map(s => s.trim()).filter(Boolean)){
      const freq = line.startsWith("毎週") ? "weekly" : line.startsWith("隔週") ? "biweekly" : null;
      if(!freq) continue;
      const items = line.replace(/^毎週：|^隔週：/, "");
      for(const bin of binsForLine(items)){
        if(freq === "weekly"){
          const prev = schedule[bin];
          const arr = Array.isArray(prev) ? [...prev] : prev?.day !== undefined ? [prev.day] : [];
          if(!arr.includes(day)) arr.push(day);
          schedule[bin] = [...arr].sort((a, b) => a - b);
        } else {
          const weeks = BIWEEKLY_WEEKS[districtId]?.[day];
          if(!weeks) throw new Error(`district ${districtId}: missing biweekly weeks for weekday ${day}`);
          schedule[bin] = {day, weeks};
        }
      }
    }
  }
  if(!schedule.burnable) throw new Error(`district ${districtId}: no burnable rule`);
  return {jp: `${districtId}地区`, schedule};
}

function parse(html){
  if(!/各地区の収集日一覧/.test(html)) throw new Error("expected Tachikawa schedule page");
  return ["1", "2", "3", "4"].map(id => parseDistrict(html, id));
}

export async function convert(extractedAt){
  const html = decode(await download("tachikawa", URL));
  const districts = parse(html);
  const spec = {
    id: "tachikawa",
    code: "13202",
    pref: "13",
    jp: "立川市",
    en: "Tachikawa",
    url: URL,
    sourceName: SOURCE.name,
    validFrom: "2026-04-01",
    validTo: "2027-03-31",
    bins: BINS,
    note:
      "Four collection districts. Biweekly items use nth-weekday rules aligned to the city's R8 monthly calendars; confirm against the published PDF if a month looks off.",
    districts,
    minDistricts: 4,
  };
  return buildFromDistricts(spec, districts, extractedAt);
}
