/* gomisuke (admin.gomisuke.jp) JSONP calendars — area × month grid → collection dates per bin. */
import { download, decode, townRegistry, splitTown, parsePart, partEn, kanaToRomaji } from "../lib.mjs";
import { weeklyRule } from "./district-weekly-csv.mjs";

const REFERER = "https://www.city.saitama.lg.jp/";
const FETCH = {headers: {Referer: REFERER}};

export const SOURCE = {
  name: "gomisuke (Saitama City embedded calendar API)",
  url: "https://admin.gomisuke.jp/app/0017/api/jsonp.php",
  license: "Third-party service embedded on city website (proprietary)",
};

/** typeID → Wakeru bin (types 10–14 rarely appear on the calendar grid) */
const TYPE_TO_BIN = {
  1: "burnable",
  2: "non_burnable",
  3: "hazardous",
  4: "paper",
  5: "paper",
  6: "glass_bottle",
  7: "beverage_can",
  8: "pet_bottle",
  9: "plastic",
};

const DEFAULT_BINS = {
  burnable: {label: "もえるごみ", en: "Burnable", kind: "burn"},
  non_burnable: {label: "もえないごみ", en: "Non-burnable", kind: "non"},
  plastic: {label: "プラスチック資源", en: "Plastic", kind: "pla"},
  pet_bottle: {label: "ペットボトル", en: "PET bottles", kind: "res"},
  beverage_can: {label: "かん", en: "Cans", kind: "res"},
  glass_bottle: {label: "びん", en: "Glass bottles", kind: "res"},
  paper: {label: "古紙・繊維", en: "Paper & cloth", kind: "res"},
  hazardous: {label: "有害危険ごみ", en: "Hazardous", kind: "haz"},
  res: {label: "資源ごみ", en: "Recyclables", kind: "res"},
  no: {label: "収集しないもの", en: "Not collected", kind: "no"},
};

export const GOMISUKE_CITIES = [
  {
    app: "0017",
    id: "saitama-city",
    code: "11100",
    pref: "11",
    jp: "さいたま市",
    en: "Saitama",
    validFrom: "2026-04-01",
    validTo: "2027-03-31",
  },
];

export function parseGomisukeJsonp(text){
  const m = text.match(/^gomisukeGetData\('(\w+)',(.+)\);?\s*$/s);
  if(!m) throw new Error("unexpected gomisuke JSONP wrapper");
  return {file: m[1], data: JSON.parse(m[2])};
}

function dictTable(json){
  const dict = json?.array?.dict;
  if(!dict?.length) return [];
  return dict.map(row => {
    const obj = {};
    const keys = row.key ?? [];
    const values = row.string ?? [];
    if(Array.isArray(values)){
      keys.forEach((k, i) => { obj[k] = values[i] });
    } else {
      keys.forEach(k => { obj[k] = values });
    }
    return obj;
  });
}

async function fetchGomisukeFile(app, file){
  const url = `https://admin.gomisuke.jp/app/${app}/api/jsonp.php?file=${file}`;
  const buf = await download(`gomisuke-${app}-${file}`, url, FETCH);
  return parseGomisukeJsonp(decode(buf)).data;
}

function parseCalendar(json){
  const months = {};
  for(const row of json?.array?.dict ?? []){
    const ym = typeof row.string === "string" && /^\d{6}$/.test(row.string)
      ? row.string
      : row.key?.includes("yearMonth") ? row.string?.[row.key.indexOf("yearMonth")] : null;
    if(!ym) continue;
    const byArea = {};
    for(const areaRow of row.array?.dict ?? []){
      const keys = areaRow.key ?? [];
      let areaID = areaRow.string;
      if(keys.includes("areaID") && Array.isArray(areaRow.string)){
        areaID = areaRow.string[keys.indexOf("areaID")];
      }
      const dd = areaRow.dict;
      if(!areaID || !dd?.key) continue;
      const days = {};
      dd.key.forEach((day, i) => { days[String(day)] = dd.string[i] });
      byArea[String(areaID)] = days;
    }
    months[ym] = byArea;
  }
  return months;
}

function isoFromYmDay(ym, day){
  const y = +ym.slice(0, 4), m = +ym.slice(4, 6), d = +day;
  if(!y || !m || !d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function addTypesToDates(map, iso, typeField){
  for(const raw of String(typeField ?? "").split(",")){
    const typeID = +raw.trim();
    if(!typeID || typeID === 15) continue;
    const bin = TYPE_TO_BIN[typeID];
    if(!bin) continue;
    if(!map[bin]) map[bin] = new Set();
    map[bin].add(iso);
  }
}

/** Prefer a compact weekly rule when the FY dates match; otherwise keep explicit dates. */
export function ruleFromDates(dates, validFrom, validTo){
  const sorted = [...new Set(dates)].sort();
  if(!sorted.length) return null;
  const inRange = sorted.filter(d => d >= validFrom && d <= validTo);
  if(!inRange.length) return null;

  const byWd = new Map();
  for(const d of inRange){
    const wd = new Date(`${d}T12:00:00+09:00`).getDay();
    if(!byWd.has(wd)) byWd.set(wd, []);
    byWd.get(wd).push(d);
  }
  const weekdays = [...byWd.keys()].sort((a, b) => a - b);
  if(weekdays.length === 1){
    const [[wd, list]] = [...byWd.entries()];
    const nth = new Set();
    for(const d of list){
      const dt = new Date(`${d}T12:00:00+09:00`);
      nth.add(Math.ceil(dt.getDate() / 7));
    }
    if(nth.size <= 4 && list.length >= 3){
      const weeks = [...nth].sort((a, b) => a - b);
      if(weeks.length > 1) return {day: wd, weeks};
    }
    if(list.length >= 8) return [wd];
  }
  if(weekdays.length > 1 && weekdays.length <= 3){
    const counts = weekdays.map(wd => byWd.get(wd).length);
    if(counts.every(c => c >= 6)) return weekdays;
  }
  return {dates: inRange};
}

function parseAreaTowns(name){
  const cleaned = name.replace(/★/g, "").trim();
  const m = cleaned.match(/^【(.+?)】::(.*)$/s);
  const ward = m?.[1]?.trim() ?? "";
  const body = (m?.[2] ?? cleaned).trim();
  const towns = body.split(/[、,]/).map(t => t.trim()).filter(Boolean);
  return {ward, towns};
}

function scheduleKey(schedule){
  return JSON.stringify(schedule, Object.keys(schedule).sort());
}

/** @param {typeof GOMISUKE_CITIES[0]} spec */
export async function convertGomisuke(spec, extractedAt){
  const [areaJson, , calendarJson] = await Promise.all([
    fetchGomisukeFile(spec.app, "area"),
    fetchGomisukeFile(spec.app, "type"),
    fetchGomisukeFile(spec.app, "calendar"),
  ]);
  const areasRaw = dictTable(areaJson);
  if(areasRaw.length < 10) throw new Error(`expected many gomisuke areas, got ${areasRaw.length}`);
  const calendar = parseCalendar(calendarJson);
  const validFrom = spec.validFrom ?? "2026-04-01";
  const validTo = spec.validTo ?? "2027-03-31";

  const patterns = {}, byKey = new Map(), areas = [];
  const registryByWard = new Map();
  async function townsFor(ward){
    const key = ward || "";
    if(!registryByWard.has(key)){
      registryByWard.set(key, await townRegistry(spec.jp, {pref: spec.pref, ward: ward || ""}));
    }
    return registryByWard.get(key);
  }

  for(const area of areasRaw){
    const areaID = String(area.areaID);
    const dateSets = {};
    for(const [ym, byArea] of Object.entries(calendar)){
      const grid = byArea[areaID];
      if(!grid) continue;
      for(const [day, types] of Object.entries(grid)){
        const iso = isoFromYmDay(ym, day);
        if(!iso || iso < validFrom || iso > validTo) continue;
        addTypesToDates(dateSets, iso, types);
      }
    }
    const schedule = {};
    for(const [bin, set] of Object.entries(dateSets)){
      const rule = ruleFromDates([...set], validFrom, validTo);
      if(rule) schedule[bin] = rule;
    }
    if(!Object.keys(schedule).length) continue;

    let pid = byKey.get(scheduleKey(schedule));
    if(!pid){
      pid = String(byKey.size + 1);
      byKey.set(scheduleKey(schedule), pid);
      patterns[pid] = schedule;
    }

    const {ward, towns: townNames} = parseAreaTowns(area.name ?? "");
    const towns = await townsFor(ward);
    for(const sourceName of townNames){
      const normalized = sourceName.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
      let town = normalized, rest = "";
      try { [town, rest] = splitTown(normalized, towns) } catch { /* district label */ }
      const reg = towns.get(town);
      const townEn = reg?.en || kanaToRomaji(reg?.kana || town) || kanaToRomaji(town) || sourceName;
      for(const part of parsePart(rest)){
        areas.push({
          town: reg ? town : sourceName,
          townEn,
          kana: reg?.kana || town,
          chome: part.chome,
          detail: part.detail ?? (ward && !rest ? ward : null),
          en: partEn(part),
          jp: part.chome || part.detail ? `${part.chome ? `${part.chome.join("・")}丁目` : ""}${part.detail ?? ""}` : (reg ? town : sourceName),
          pattern: pid,
        });
      }
    }
  }

  if(!areas.length) throw new Error("no gomisuke areas with schedules");
  areas.sort((a, b) => a.kana.localeCompare(b.kana, "ja") || a.jp.localeCompare(b.jp, "ja"));

  const sourceUrl = `https://admin.gomisuke.jp/app/${spec.app}/api/jsonp.php`;
  return {
    id: spec.id,
    code: spec.code,
    pref: spec.pref,
    jp: spec.jp,
    en: spec.en,
    verified: extractedAt.slice(0, 10),
    sources: [spec.embedUrl ?? "https://www.city.saitama.lg.jp/001/006/010/003/p042612.html", sourceUrl],
    contacts: [],
    bins: spec.bins ?? DEFAULT_BINS,
    plasticTest: null,
    sorting: {},
    calendar: {
      validFrom,
      validTo,
      noCollection: {weekdays: [0], dates: ["01-01", "01-02", "01-03", "12-29", "12-30", "12-31"]},
      note: "Collection dates derived from the city's embedded gomisuke calendar grid (area × month). Year-end and holiday changes follow the published calendar data.",
      patterns,
    },
    areas,
    attribution: {schedule: {...SOURCE, url: sourceUrl}},
    updated: extractedAt.slice(0, 10),
  };
}

export async function saitamaCity(today){
  return convertGomisuke(GOMISUKE_CITIES[0], today);
}
