/* Warabi City: district × weekday × bin-type lists on the official collection-day page. */
import { download, decode } from "../lib.mjs";
import { buildFromDistricts } from "./html-weekly-table.mjs";

const URL = "https://www.city.warabi.saitama.jp/kurashi/gomi/shushubi/1001322.html";

export const SOURCE = {
  name: "Warabi City garbage collection day page",
  url: URL,
  license: "Warabi City website (collection facts)",
};

const DAYS = "日月火水木金土";
const BIN_MAP = [
  [/もやすごみ/, "burnable"],
  [/もえないごみ/, "non_burnable"],
  [/プラスチック/, "plastic"],
  [/ペットボトル/, "pet_bottle"],
  [/古紙|その他の紙|布類/, "paper"],
  [/金属|びん/, "res"],
];

function binForItem(text){
  for(const [re, bin] of BIN_MAP) if(re.test(text)) return bin;
  return null;
}

function parseWarabi(html){
  const chunks = html.split(/<h2[^>]*>/i).slice(1);
  const districts = [];
  for(const chunk of chunks){
    const title = chunk.match(/^([\s\S]*?)<\/h2>/i)?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "";
    if(!title || !/全域|丁目/.test(title)) continue;
    if(/関連|便利|いざ|消火|粗大ごみ$/.test(title)) continue;
    const schedule = {};
    const sub = chunk.split(/<h3[^>]*>/i).slice(1);
    for(const part of sub){
      const head = part.match(/^([\s\S]*?)<\/h3>/i)?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "";
      if(head === "粗大ごみ" || head === "乾電池") continue;
      const dayMatch = head.match(/^([日月火水木金土])曜日$/);
      if(!dayMatch) continue;
      const day = DAYS.indexOf(dayMatch[1]);
      const items = [...part.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map(m => m[1].replace(/<[^>]+>/g, "").trim());
      for(const item of items){
        const bin = binForItem(item);
        if(!bin) continue;
        const prev = schedule[bin];
        const add = Array.isArray(prev) ? prev : prev ? [prev] : [];
        if(!add.includes(day)) add.push(day);
        schedule[bin] = add.length === 1 ? add : [...add].sort((a, b) => a - b);
      }
    }
    const stringSchedule = {};
    for(const [bin, days] of Object.entries(schedule)){
      const arr = Array.isArray(days) ? days : [days];
      stringSchedule[bin] = arr.map(d => DAYS[d] + "曜日").join(" ");
    }
    if(Object.keys(stringSchedule).length) districts.push({jp: title, schedule: stringSchedule});
  }
  if(districts.length < 3) throw new Error(`expected several Warabi districts, got ${districts.length}`);
  return districts;
}

export async function convert(extractedAt){
  const html = decode(await download("warabi", URL));
  const districts = parseWarabi(html);
  const spec = {
    id: "warabi",
    code: "11223",
    pref: "11",
    jp: "蕨市",
    en: "Warabi",
    url: URL,
    sourceName: SOURCE.name,
    validFrom: "2026-04-01",
    validTo: "2027-03-31",
    bins: {
      burnable: {label: "もやすごみ", en: "Burnable", kind: "burn"},
      plastic: {label: "プラスチック", en: "Plastic", kind: "pla"},
      res: {label: "資源ごみ", en: "Recyclables", kind: "res"},
      paper: {label: "古紙・布類", en: "Paper & cloth", kind: "res"},
      non_burnable: {label: "もえないごみ", en: "Non-burnable", kind: "non"},
      pet_bottle: {label: "ペットボトル", en: "PET bottles", kind: "res"},
      no: {label: "収集しないもの", en: "Not collected", kind: "no"},
    },
    note: "Weekday rules derived from the city's district × weekday × bin lists. Dry-cell batteries and oversized waste are not included.",
    districts,
  };
  return buildFromDistricts(spec, districts, extractedAt);
}
