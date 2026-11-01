/* Official municipal HTML tables → weekday rules (build-time fetch). */
import { download, decode } from "../lib.mjs";
import { weeklyRule } from "./district-weekly-csv.mjs";

function stripTags(html){
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function cellRule(cell, validFrom, validTo){
  let s = (cell ?? "").replace(/\u00a0/g, " ").trim();
  if(!s || /^[-－—]$/.test(s)) return null;
  s = s.replace(/、/g, " ").replace(/午前.+$/, "").replace(/^毎週/, "").replace(/^毎月/, "");
  if(/年\d+回|5月・11月/.test(s)) return null;
  const nthMonth = s.match(/^第(\d+(?:・\d+)*)([日月火水木金土])曜日/);
  if(nthMonth){
    const weeks = [...nthMonth[1].matchAll(/\d+/g)].map(m => +m[0]);
    const day = "日月火水木金土".indexOf(nthMonth[2]);
    return weeks.length ? {day, weeks} : null;
  }
  const nthWeek = s.match(/^(\d+(?:・\d+)*)週目の([日月火水木金土])曜日$/);
  if(nthWeek){
    const weeks = [...nthWeek[1].matchAll(/\d+/g)].map(m => +m[0]);
    const day = "日月火水木金土".indexOf(nthWeek[2]);
    return weeks.length ? {day, weeks} : null;
  }
  if(/原則的に毎月|指定した日|回指定/.test(s)) return null;
  if(/、/.test(s) && /第/.test(s)){
    const parts = s.split(/、/).map(p => p.trim()).filter(Boolean);
    if(parts.length > 1 && parts.every(p => /第/.test(p))){
      const rules = parts.map(p => cellRule(p, validFrom, validTo)).filter(Boolean);
      if(rules.length) return rules.length === 1 ? rules[0] : {any: rules};
    }
  }
  const parts = s.split(/・/).map(p => p.trim()).filter(Boolean);
  if(parts.length > 1 && parts.every(p => /第/.test(p))){
    const rules = parts.map(p => weeklyRule(p, validFrom, validTo)).filter(Boolean);
    if(!rules.length) return null;
    return rules.length === 1 ? rules[0] : {any: rules};
  }
  return weeklyRule(s, validFrom, validTo);
}

function parseRows(html, columnDefs, validFrom, validTo, minDistricts = 3){
  const rows = [];
  for(const block of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)){
    const cells = [...block[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => stripTags(c[1]));
    if(cells.length) rows.push(cells);
  }
  if(!rows.length) throw new Error("no table rows found");

  let headerIdx = -1;
  let colMap = [];
  for(let i = 0; i < Math.min(rows.length, 8); i++){
    const map = columnDefs.map(def => {
      const idx = rows[i].findIndex(text => def.header.test(text.replace(/\u00a0/g, "")));
      return idx >= 0 ? idx : -1;
    });
    if(map[0] >= 0 && map.slice(1).every(x => x >= 0)){
      headerIdx = i;
      colMap = map;
      break;
    }
  }
  if(headerIdx < 0) throw new Error("could not match schedule table header row");

  const districts = [];
  for(let r = headerIdx + 1; r < rows.length; r++){
    const cells = rows[r];
    const name = cells[colMap[0]]?.trim();
    if(!name || /^(地域|収集地区|地区|大字名)$/.test(name)) continue;
    if(/ごみ分別|カレンダー|リンク|辞典|アプリ/.test(name)) continue;
    if(!/コース|全域|丁目|町|字|地区|〜|～/.test(name) && name.length > 40) continue;
    const schedule = {};
    for(let c = 1; c < columnDefs.length; c++){
      const def = columnDefs[c];
      const text = cells[colMap[c]]?.trim();
      if(!text) continue;
      for(const bin of def.bins) schedule[bin] = text;
    }
    if(Object.keys(schedule).length) districts.push({jp: name, schedule});
  }
  if(districts.length < minDistricts) throw new Error(`too few districts (${districts.length})`);
  return districts;
}

export function buildFromDistricts(spec, districts, extractedAt){
  const validFrom = spec.validFrom ?? "2026-04-01";
  const validTo = spec.validTo ?? "2027-03-31";
  const patterns = {}, byKey = new Map(), areas = [];
  for(const d of districts){
    const schedule = {};
    for(const [bin, cell] of Object.entries(d.schedule)){
      const r = typeof cell === "string"
        ? cellRule(cell, validFrom, validTo)
        : cell;
      if(r) schedule[bin] = r;
    }
    if(!Object.keys(schedule).length) continue;
    const key = JSON.stringify(schedule, Object.keys(schedule).sort());
    let pid = byKey.get(key);
    if(!pid){ pid = String(byKey.size + 1); byKey.set(key, pid); patterns[pid] = schedule }
    areas.push({
      town: d.jp, townEn: d.en ?? d.jp, kana: d.jp, chome: null, detail: null,
      en: d.en ?? d.jp, jp: d.jp, pattern: pid,
    });
  }
  if(!areas.length) throw new Error("no districts with schedules");
  return {
    id: spec.id, code: spec.code, pref: spec.pref, jp: spec.jp, en: spec.en, verified: extractedAt.slice(0, 10),
    sources: [spec.url], contacts: [],
    bins: spec.bins, plasticTest: null, sorting: {},
    calendar: {
      validFrom, validTo,
      noCollection: {weekdays: [0], dates: ["01-01", "01-02", "01-03", "12-29", "12-30", "12-31"]},
      note: spec.note ?? "Weekday rules from the municipality's official HTML schedule table.",
      patterns,
    },
    areas,
    attribution: {schedule: {name: spec.sourceName, url: spec.url, license: spec.license ?? "Municipality website"}},
    updated: extractedAt.slice(0, 10),
  };
}

/** @param {object} spec — see seeds/html-weekly.mjs */
export async function convertHtmlWeekly(spec, extractedAt){
  const validFrom = spec.validFrom ?? "2026-04-01";
  const validTo = spec.validTo ?? "2027-03-31";
  let districts = spec.districts;
  if(!districts?.length){
    const html = decode(await download(spec.id, spec.url));
    districts = parseRows(html, spec.columns, validFrom, validTo, spec.minDistricts ?? 3);
  }
  return buildFromDistricts(spec, districts, extractedAt);
}
