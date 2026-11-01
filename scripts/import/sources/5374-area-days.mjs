/* 5374.jp-style area_days.csv (area × weekday columns). Used by many municipalities + LinkData mirrors. */
import { download, decode, csvObjects, townRegistry, splitTown, kanaToRomaji } from "../lib.mjs";
import { weeklyRule } from "./district-weekly-csv.mjs";

const DAYS = "日月火水木金土";
const SKIP_HEADERS = /^(センター|center|センター名|地区コード|code|備考)$/i;
const AREA_HEADER = /^(地名|地区|区域|町名|地域|名称|name|#property|property)$/i;
const AREA_HEADER_COL = /^(地名|地区|区域|町名|地域|名称|name|#property|property|handa_gomi_area_days)$/i;

const HEADER_TO_BIN = [
  [/燃やす|燃やせ|燃える|燃やせる|燃やして|可燃|もやす|もやせ|もえる|moyaseru|生活ごみ|家庭/i, "burnable"],
  [/燃えない|燃やさない|不燃|もやせない|埋立|埋め立て|moyasenai|不燃ごみ/i, "non_burnable"],
  [/プラ|plastic|容器プラ|プラ容器/i, "plastic"],
  [/缶・びん|缶・ビン|びん・缶/i, "res"],
  [/ペット|petbottle/i, "pet_bottle"],
  [/空き缶|^缶$|かん|cans/i, "beverage_can"],
  [/びん|ビン|glass/i, "glass_bottle"],
  [/古紙|紙類|資源古紙|paper|cloth|kami|紙製/, "paper"],
  [/衣類|古布|cloth/i, "paper"],
  [/紙(?!類)|雑誌/, "paper"],
  [/小型金属|金属/, "res"],
  [/有害|spray|hazardous|われもの/, "hazardous"],
  [/資源|リサイクル|資源物/, "res"],
  [/大型|粗大/, "oversized"],
];

function decodeCsv(buf){
  for(const enc of ["UTF-8", "CP932"]){
    const text = decode(buf, enc);
    const head = text.split("\n")[0] ?? "";
    if(!head.includes(",") && !head.includes("地名")) continue;
    return csvObjects(text);
  }
  return csvObjects(decode(buf, "CP932"));
}

/** "水1 水3" / "月 木" / "第1・第3 木" → rule */
function parseDateListCell(cell, validFrom, validTo){
  const s = (cell ?? "").trim().replace(/\*\d+$/, "").trim();
  if(!/\d{8}/.test(s)) return null;
  const dates = [...s.matchAll(/\d{8}/g)].map(m => {
    const d = m[0];
    return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  }).filter(d => (!validFrom || d >= validFrom) && (!validTo || d <= validTo));
  return dates.length ? {dates:[...new Set(dates)].sort()} : null;
}

export function parse5374Cell(cell, validFrom, validTo){
  const raw = (cell ?? "").trim();
  if(!raw || /^(\*|なし|－|ー|-+|―)$/.test(raw)) return null;
  if(/^\*/.test(raw) && !/\d{8}/.test(raw)) return null;
  const asDates = parseDateListCell(raw, validFrom, validTo);
  if(asDates) return asDates;
  if(/第/.test(raw) || /曜/.test(raw)) return weeklyRule(raw, validFrom, validTo);
  const tokens = raw.normalize("NFKC").split(/\s+/).filter(Boolean);
  const byDay = new Map();
  const weeklies = [];
  for(const tok of tokens){
    const m = tok.match(/^([日月火水木金土])(\d+)?$/);
    if(!m) continue;
    const day = DAYS.indexOf(m[1]);
    if(m[2]){ if(!byDay.has(day)) byDay.set(day, new Set()); byDay.get(day).add(+m[2]) }
    else weeklies.push(day);
  }
  if(weeklies.length && !byDay.size) return [...new Set(weeklies)].sort((a, b) => a - b);
  if(byDay.size === 1){
    const [[day, weeks]] = [...byDay.entries()];
    return weeks.size ? {day, weeks:[...weeks].sort()} : [day];
  }
  if(byDay.size > 1){
    const rules = [...byDay.entries()].map(([day, weeks]) =>
      weeks.size ? {day, weeks:[...weeks].sort()} : [day]);
    return rules.length === 1 ? rules[0] : {any:rules};
  }
  try { return weeklyRule(raw, validFrom, validTo) } catch { return null }
}

function columnsByBin(headers){
  const map = {};
  for(const h of headers){
    if(SKIP_HEADERS.test(h.trim()) || AREA_HEADER.test(h.trim())) continue;
    if(h.startsWith("#")) continue;
    for(const [re, bin] of HEADER_TO_BIN){
      if(re.test(h)){ (map[bin] ??= []).push(h); break }
    }
  }
  return map;
}

function districtLabel(row, headers){
  const ku = headers.find(h => h.trim() === "区名");
  const chiku = headers.find(h => h.trim() === "地区名");
  const chi = headers.find(h => /^(地名|町名|コース名)$/.test(h.trim()));
  if(chiku && chi){
    const label = [row[chiku], row[chi]].filter(Boolean).join(" ").trim();
    if(label) return label;
  }
  if(chi){
    const part = (row[chi] ?? "").trim();
    if(ku){
      const label = [row[ku], part].filter(Boolean).join(" ").trim();
      if(label) return label;
    } else if(part) return part;
  }
  const areaCol = headers.find(h => /^name$/i.test(h.trim()))
    ?? headers.find(h => /^(地名|地区|区域|町名|地域|名称)$/i.test(h.trim()))
    ?? headers.find(h => /name|地名|地区/.test(h))
    ?? headers[1]
    ?? headers[0];
  return (row[areaCol] ?? row.name ?? "").trim().replace(/^"|"$/g, "");
}

function scheduleKey(schedule){
  return JSON.stringify(schedule, Object.keys(schedule).sort());
}

const DEFAULT_BINS = {
  burnable:{label:"燃やすごみ", en:"Burnable", kind:"burn"},
  non_burnable:{label:"燃やさないごみ", en:"Non-burnable", kind:"non"},
  plastic:{label:"プラスチック", en:"Plastic", kind:"pla"},
  pet_bottle:{label:"ペットボトル", en:"PET bottles", kind:"res"},
  beverage_can:{label:"空き缶", en:"Cans", kind:"res"},
  glass_bottle:{label:"空きびん", en:"Glass bottles", kind:"res"},
  paper:{label:"紙・古紙", en:"Paper", kind:"res"},
  hazardous:{label:"有害ごみ", en:"Hazardous", kind:"haz"},
  res:{label:"資源ごみ", en:"Recyclables", kind:"res"},
  oversized:{label:"粗大ごみ", en:"Oversized", kind:"big"},
  no:{label:"収集しないもの", en:"Not collected", kind:"no"},
};

/** @param {{id:string, code:string, pref:string, jp:string, en:string, url:string, cacheKey?:string, validFrom?:string, validTo?:string, source?:object}} spec */
export async function convert5374(spec, extractedAt){
  const cacheKey = spec.cacheKey ?? spec.id;
  const fetchOpts = spec.bodik ? {headers:{Referer:"https://data.bodik.jp/"}} : {};
  const buf = await download(cacheKey, spec.url, fetchOpts);
  const rows = decodeCsv(buf);
  if(!rows.length) throw new Error("empty area_days CSV");
  const headers = Object.keys(rows[0]);
  const colsByBin = columnsByBin(headers);
  if(!Object.keys(colsByBin).length) throw new Error(`no bin columns in ${headers.join("|")}`);

  const validFrom = spec.validFrom ?? "2026-04-01";
  const validTo = spec.validTo ?? "2027-03-31";
  const towns = await townRegistry(spec.jp, {pref:spec.pref});
  const patterns = {}, byKey = new Map(), areas = [];
  let skipped = 0;

  for(const row of rows){
    const district = districtLabel(row, headers);
    if(!district || /^#/.test(district) || /^(地名|name|地区名)$/i.test(district)) continue;
    const schedule = {};
    for(const [bin, cols] of Object.entries(colsByBin)){
      const rules = cols.map(col => parse5374Cell(row[col], validFrom, validTo)).filter(Boolean);
      if(rules.length === 1) schedule[bin] = rules[0];
      else if(rules.length > 1) schedule[bin] = {any:rules};
    }
    if(!Object.keys(schedule).length){ skipped++; continue }

    let key = scheduleKey(schedule), id = byKey.get(key);
    if(!id){ id = String(byKey.size + 1); byKey.set(key, id); patterns[id] = schedule }

    let town = district.split(/[、,]/)[0].trim();
    try { [town] = splitTown(town, towns) } catch { /* district label */ }
    const reg = towns.get(town);
    const townEn = reg?.en || kanaToRomaji(town) || spec.en;
    areas.push({
      town:reg ? town : district, townEn, kana:reg?.kana ?? "", chome:null, detail:reg && district !== town ? district : null,
      en:district, jp:district, pattern:id,
    });
  }
  if(!areas.length) throw new Error(`no parseable areas (${skipped} skipped)`);

  areas.sort((a, b) => a.kana.localeCompare(b.kana, "ja") || a.jp.localeCompare(b.jp, "ja"));
  const source = spec.source ?? {name:"5374.jp area_days.csv", url:spec.url, license:"Municipality open data (5374 format)"};
  return {
    id:spec.id, code:spec.code, pref:spec.pref, jp:spec.jp, en:spec.en, verified:extractedAt.slice(0, 10),
    sources:[source.url, spec.url],
    contacts:spec.contacts ?? [],
    bins:spec.bins ?? DEFAULT_BINS, plasticTest:null, sorting:{},
    calendar:{
      validFrom, validTo,
      noCollection:{weekdays:[0], dates:["01-01", "01-02", "01-03", "12-29", "12-30", "12-31"]},
      note:"Weekday rules from 5374-style area_days.csv. Confirm holidays and year-end changes on the city's official page.",
      patterns,
    },
    areas,
    attribution:{schedule:{name:source.name, url:source.url, license:source.license ?? "Open data"}},
    updated:extractedAt.slice(0, 10),
    skippedRows:skipped,
  };
}
