/* SMART CMS (smart-lgov) trash general-purpose data API — weekday columns per town. */
import { download, decode, htmlText, townRegistry, splitTown, kanaToRomaji } from "../lib.mjs";
import { weeklyRule } from "./district-weekly-csv.mjs";

export const SOURCE = {
  name: "SMART CMS trash schedule API (smart-lgov)",
  license: "Municipality website (collection facts via city CMS API)",
};

const HEADER_TO_BIN = [
  [/燃える|可燃|もやす|もえる/i, "burnable"],
  [/燃えない|不燃|もやさない|もえない/i, "non_burnable"],
  [/粗大/i, "oversized"],
  [/有害|危険/i, "hazardous"],
  [/プラ|plastic/i, "plastic"],
  [/缶.*ビン|びん.*缶|缶・ビン|資源物.*缶/i, "res"],
  [/紙|布|古紙|繊維/i, "paper"],
  [/資源/i, "res"],
];

const DEFAULT_BINS = {
  burnable: {label: "燃えるごみ", en: "Burnable", kind: "burn"},
  non_burnable: {label: "燃えないごみ", en: "Non-burnable", kind: "non"},
  plastic: {label: "プラスチック", en: "Plastic", kind: "pla"},
  paper: {label: "紙・布類", en: "Paper & cloth", kind: "res"},
  res: {label: "資源ごみ", en: "Recyclables", kind: "res"},
  hazardous: {label: "有害ごみ", en: "Hazardous", kind: "haz"},
  oversized: {label: "粗大ごみ", en: "Oversized", kind: "big"},
  no: {label: "収集しないもの", en: "Not collected", kind: "no"},
};

export const SMART_LGOV_CITIES = [
  {
    id: "gyoda",
    code: "11206",
    pref: "11",
    jp: "行田市",
    en: "Gyoda",
    searchUrl: "https://www.city.gyoda.lg.jp/kurashi/gomi/gomi_search/chikubetsu/search.html",
    dataType: 2,
    validFrom: "2026-04-01",
    validTo: "2027-03-31",
    sourceName: "Gyoda City SMART CMS weekday schedule",
  },
  {
    id: "kitamoto",
    code: "11233",
    pref: "11",
    jp: "北本市",
    en: "Kitamoto",
    searchUrl: "https://www.city.kitamoto.lg.jp/mokutekikarasagasu/gomi/gomi_kensaku/index.html",
    dataType: 2,
    validFrom: "2026-04-01",
    validTo: "2027-03-31",
    sourceName: "Kitamoto City SMART CMS weekday schedule",
  },
  {
    id: "fujimino",
    code: "11245",
    pref: "11",
    jp: "ふじみ野市",
    en: "Fujimino",
    searchUrl: "https://www.city.fujimino.saitama.jp/kurashinojoho/gomi_recycle/1/01/10743.html",
    dataType: 2,
    validFrom: "2026-04-01",
    validTo: "2027-03-31",
    sourceName: "Fujimino City SMART CMS weekday schedule",
  },
];

function parseCmsConfig(html){
  const token = html.match(/cms_api_token="([^"]+)"/)?.[1];
  const domain = html.match(/cms_api_domain="([^"]+)"/)?.[1];
  if(!token || !domain) throw new Error("cms_api_token / cms_api_domain not found on search page");
  return {token, domain};
}

function cellRule(cell, validFrom, validTo){
  let s = (cell ?? "").replace(/\u00a0/g, " ").replace(/<br\s*\/?>/gi, " ").replace(/\s+/g, " ").trim();
  if(!s || /^[-－—―]$/.test(s)) return null;
  s = s.replace(/、/g, " ");
  const monthlyNth = s.match(/^毎月第(\d+(?:・\d+)*)([日月火水木金土])曜日?$/);
  if(monthlyNth){
    const weeks = [...monthlyNth[1].matchAll(/\d+/g)].map(m => +m[0]);
    const day = "日月火水木金土".indexOf(monthlyNth[2]);
    return weeks.length ? {day, weeks} : null;
  }
  const parts = s.split(/・/).map(p => p.trim()).filter(Boolean);
  if(parts.length > 1 && parts.every(p => /第/.test(p))){
    const rules = parts.map(p => weeklyRule(p, validFrom, validTo)).filter(Boolean);
    if(!rules.length) return null;
    return rules.length === 1 ? rules[0] : {any: rules};
  }
  return weeklyRule(s, validFrom, validTo);
}

function headerToBin(label){
  for(const [re, bin] of HEADER_TO_BIN){
    if(re.test(label)) return bin;
  }
  return null;
}

async function fetchTrashList({token, domain, dataType, searchUrl}){
  const api = `https://${domain}/v1/trash/get_general_purpose_data_list.json`;
  const cacheKey = `smart-lgov-${domain.replace(/\W+/g, "_")}-type${dataType}`;
  const headers = {
    Referer: searchUrl,
    Origin: new URL(searchUrl).origin,
    Accept: "application/json, text/javascript, */*; q=0.01",
    "X-Requested-With": "XMLHttpRequest",
  };
  const body = JSON.stringify({
    general_purpose_data_type: dataType,
    token,
    keyword: "",
    match: {},
  });
  let lastErr;
  for(let attempt = 0; attempt < 6; attempt++){
    try {
      const res = await fetch(api, {
        method: "POST",
        headers: {...headers, "Content-Type": "application/json"},
        body,
      });
      if(!res.ok){
        const qs = new URLSearchParams({general_purpose_data_type: String(dataType), token, keyword: ""});
        const getRes = await fetch(`${api}?${qs}`, {headers});
        if(!getRes.ok) throw new Error(`${api}: HTTP ${getRes.status}`);
        const json = JSON.parse(await getRes.text());
        if(!json.success) throw new Error(json.data?.message ?? "API success=false");
        return json.data;
      }
      const json = JSON.parse(await res.text());
      if(!json.success) throw new Error(json.data?.message ?? "API success=false");
      return json.data;
    } catch(err){
      lastErr = err;
      if(attempt < 5) await new Promise(r => setTimeout(r, 1200 * (attempt + 1)));
    }
  }
  throw lastErr;
}

function scheduleKey(schedule){
  return JSON.stringify(schedule, Object.keys(schedule).sort());
}

/** @param {typeof SMART_LGOV_CITIES[0]} spec */
export async function convertSmartLgovTrash(spec, extractedAt){
  const html = decode(await download(`${spec.id}-smart-lgov-page`, spec.searchUrl));
  const {token, domain} = parseCmsConfig(html);
  const data = await fetchTrashList({token, domain, dataType: spec.dataType, searchUrl: spec.searchUrl});

  const rows = data.general_purpose_data_list ?? [];
  if(rows.length < 10) throw new Error(`expected many schedule rows, got ${rows.length}`);

  const typeMeta = data.general_purpose_data_type?.[0] ?? {};
  const widthList = data.general_purpose_width_list ?? [];
  const columns = widthList
    .map(w => {
      const n = w.general_purpose_data_item_no;
      const header = typeMeta[`header${n}`]?.trim() ?? "";
      const bin = headerToBin(header);
      return bin ? {n, header, bin} : null;
    })
    .filter(Boolean);
  if(!columns.length) throw new Error("no mappable weekday columns in API headers");

  const nameCol = widthList.find(w => /町名|地区|地名|名称/.test(typeMeta[`header${w.general_purpose_data_item_no}`] ?? ""))
    ?? widthList.find(w => w.general_purpose_data_item_no === 1)
    ?? widthList[0];

  const validFrom = spec.validFrom ?? "2026-04-01";
  const validTo = spec.validTo ?? "2027-03-31";
  const towns = await townRegistry(spec.jp, {pref: spec.pref});
  const patterns = {}, byKey = new Map(), areas = [];

  for(const row of rows){
    const label = htmlText(row[`data${nameCol.general_purpose_data_item_no}`] ?? "").trim();
    if(!label) continue;
    const schedule = {};
    for(const {n, bin} of columns){
      if(n === nameCol.general_purpose_data_item_no) continue;
      const rule = cellRule(row[`data${n}`], validFrom, validTo);
      if(rule) schedule[bin] = rule;
    }
    if(!Object.keys(schedule).length) continue;

    let pid = byKey.get(scheduleKey(schedule));
    if(!pid){
      pid = String(byKey.size + 1);
      byKey.set(scheduleKey(schedule), pid);
      patterns[pid] = schedule;
    }

    let town = label;
    try { [town] = splitTown(label, towns) } catch { /* district label */ }
    const reg = towns.get(town);
    areas.push({
      town: reg ? town : label,
      townEn: reg?.en || kanaToRomaji(reg?.kana || town) || spec.en,
      kana: reg?.kana ?? "",
      chome: null,
      detail: reg && label !== town ? label : null,
      en: label,
      jp: label,
      pattern: pid,
    });
  }

  if(areas.length < 10) throw new Error(`too few areas parsed (${areas.length})`);
  areas.sort((a, b) => a.kana.localeCompare(b.kana, "ja") || a.jp.localeCompare(b.jp, "ja"));

  const apiUrl = `https://${domain}/v1/trash/get_general_purpose_data_list.json`;
  return {
    id: spec.id,
    code: spec.code,
    pref: spec.pref,
    jp: spec.jp,
    en: spec.en,
    verified: extractedAt.slice(0, 10),
    sources: [spec.searchUrl, apiUrl],
    contacts: [],
    bins: spec.bins ?? DEFAULT_BINS,
    plasticTest: null,
    sorting: {},
    calendar: {
      validFrom,
      validTo,
      noCollection: {weekdays: [0], dates: ["01-01", "01-02", "01-03", "12-29", "12-30", "12-31"]},
      note: "Weekday rules from the city's SMART CMS trash search API. Confirm holidays and year-end changes on the city's official page.",
      patterns,
    },
    areas,
    attribution: {schedule: {name: spec.sourceName, url: spec.searchUrl, license: SOURCE.license}},
    updated: extractedAt.slice(0, 10),
  };
}

export async function gyoda(today){
  return convertSmartLgovTrash(SMART_LGOV_CITIES[0], today);
}

export async function kitamoto(today){
  return convertSmartLgovTrash(SMART_LGOV_CITIES[1], today);
}

export async function fujimino(today){
  return convertSmartLgovTrash(SMART_LGOV_CITIES[2], today);
}
