/* Shared converter for municipality CSVs: one row per district/address with weekday rules per bin column
   (Fukui Pref portal, Towada/Aomori OD, etc.). Build-time only. */
import { download, decode, csvObjects, townRegistry, splitTown, kanaToRomaji, parseRule } from "../lib.mjs";

const DAYS = "日月火水木金土";
const CONTACT = /問い合わせ|確認して|収集しない|^-$|^なし$|^ー+$/;
const NO_MD = new Set(["01-01", "01-02", "01-03", "12-29", "12-30", "12-31"]);

const pad = n => String(n).padStart(2, "0");
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function nthWeekday(year, month, weekday, nth){
  let count = 0;
  for(let day = 1; day <= 31; day++){
    const d = new Date(year, month - 1, day);
    if(d.getMonth() !== month - 1) break;
    if(d.getDay() !== weekday) continue;
    if(++count === nth) return d;
  }
  return null;
}

function expandParityCell(cell, validFrom, validTo){
  const s = cell.normalize("NFKC").replace(/\s+/g, "");
  const parity = s.startsWith("奇数月") ? "odd" : s.startsWith("偶数月") ? "even" : null;
  if(!parity) return null;
  const body = s.replace(/^奇数月|^偶数月/, "").replace(/第/g, "").replace(/（[^）]*）/g, "");
  const dayChar = [...body].find(ch => DAYS.includes(ch));
  if(!dayChar) return null;
  const weekday = DAYS.indexOf(dayChar);
  const weeks = [...body.replace(/[日月火水木金土].*$/, "").matchAll(/\d/g)].map(m => +m[0]);
  if(!weeks.length) return null;
  const dates = [];
  const start = new Date(validFrom), end = new Date(validTo);
  for(let y = start.getFullYear(); y <= end.getFullYear(); y++){
    for(let m = 1; m <= 12; m++){
      const odd = m % 2 === 1;
      if(parity === "odd" ? !odd : odd) continue;
      for(const w of weeks){
        const d = nthWeekday(y, m, weekday, w);
        if(!d) continue;
        const day = iso(d);
        if(day >= validFrom && day <= validTo) dates.push(day);
      }
    }
  }
  const out = dates.length ? {dates:[...new Set(dates)].sort()} : null;
  return out ? stripOffDays(out) : null;
}

function lastWeekdayDates(weekday, validFrom, validTo){
  const dates = [];
  const start = new Date(validFrom), end = new Date(validTo);
  for(let y = start.getFullYear(); y <= end.getFullYear(); y++){
    for(let m = 1; m <= 12; m++){
      let last = null;
      for(let day = 1; day <= 31; day++){
        const d = new Date(y, m - 1, day);
        if(d.getMonth() !== m - 1) break;
        if(d.getDay() === weekday) last = d;
      }
      if(last){
        const day = iso(last);
        if(day >= validFrom && day <= validTo) dates.push(day);
      }
    }
  }
  const out = dates.length ? {dates:[...new Set(dates)].sort()} : null;
  return out ? stripOffDays(out) : null;
}

function normalizeCell(raw){
  let s = (raw ?? "").trim().normalize("NFKC").replace(/\s+/g, "").replace(/・/g, "･");
  if(!s || CONTACT.test(s)) return "";
  s = s.replace(/^毎週/, "").replace(/曜日?/g, "");
  if(/^最終([日月火水木金土])$/.test(s)) return s;
  if(/^[日月火水木金土]$/.test(s)) return s;
  return s.replace(/第/g, "");
}

export function stripOffDays(rule){
  if(!rule?.dates) return rule;
  const dates = rule.dates.filter(d => !NO_MD.has(d.slice(5)) && new Date(`${d}T00:00`).getDay() !== 0);
  return dates.length ? {...rule, dates} : null;
}

export function weeklyRule(cell, validFrom, validTo){
  const norm = normalizeCell(cell);
  if(!norm) return null;
  const last = norm.match(/^最終([日月火水木金土])$/);
  if(last) return stripOffDays(lastWeekdayDates(DAYS.indexOf(last[1]), validFrom, validTo));
  if(/奇数月|偶数月/.test(cell)){
    const parity = expandParityCell(cell, validFrom, validTo);
    if(parity) return parity;
  }
  try {
    const rule = parseRule(norm);
    return stripOffDays(rule) ?? (Array.isArray(rule) ? rule : rule?.dates ? null : rule);
  } catch { return null }
}

function districtColumn(headers){
  return headers.find(h => /地区名|住所|地域|町名等|町名/.test(h))
    ?? headers.find(h => h.includes("地区"))
    ?? "地区名";
}

function readingColumn(headers){
  return headers.find(h => /ふりがな|読み|ヨミ/.test(h));
}

function columnsByBin(headers, headerToBin){
  const map = {};
  for(const h of headers){
    for(const [re, bin] of headerToBin){
      if(re.test(h)){ (map[bin] ??= []).push(h); break }
    }
  }
  return map;
}

function decodeCsv(buf, hint){
  for(const enc of ["CP932", "UTF-8"]){
    const text = decode(buf, enc);
    const head = text.split("\n")[0] ?? "";
    if(hint?.test(head) || /地区名|住所/.test(head)) return csvObjects(text);
  }
  return csvObjects(decode(buf, "CP932"));
}

function scheduleKey(schedule){
  return JSON.stringify(schedule, Object.keys(schedule).sort());
}

/** @param {{cacheKey:string, source:object, pref:string, bins:object, headerToBin:[RegExp,string][], entry:object, loadRows:()=>Promise<object[]>, calendarNote?:string, contacts?:object[]}} opts */
export async function convertDistrictWeeklyCsv(opts, extractedAt){
  const {cacheKey, source, pref, bins, headerToBin, entry, loadRows, calendarNote, contacts = []} = opts;
  const towns = await townRegistry(entry.jp, {pref});
  const rows = await loadRows();
  if(!rows.length) throw new Error("CSV has no rows");
  const headers = Object.keys(rows[0]);
  const districtCol = districtColumn(headers);
  const readingCol = readingColumn(headers);
  const colsByBin = columnsByBin(headers, headerToBin);
  const patterns = {}, byKey = new Map(), areas = [];
  let skipped = 0;

  for(const row of rows){
    const district = row[districtCol]?.trim();
    if(!district) continue;
    const schedule = {};
    for(const [bin, cols] of Object.entries(colsByBin)){
      const rules = cols.map(col => weeklyRule(row[col], entry.validFrom, entry.validTo)).filter(Boolean);
      if(rules.length === 1) schedule[bin] = rules[0];
      else if(rules.length > 1) schedule[bin] = {any:rules};
    }
    if(!Object.keys(schedule).length){ skipped++; continue }

    let key = scheduleKey(schedule), id = byKey.get(key);
    if(!id){ id = String(byKey.size + 1); byKey.set(key, id); patterns[id] = schedule }

    const reading = readingCol ? row[readingCol] : "";
    const note = [row["備考"], row["キーワード"]].filter(Boolean).join(" · ") || undefined;
    let town = district;
    try { [town] = splitTown(district, towns) } catch { /* district label may span several chome */ }
    const reg = towns.get(town);
    const townEn = reg?.en || kanaToRomaji(reading || "") || town || district;
    const kana = reg?.kana ?? reading ?? "";
    areas.push({
      town:reg ? town : district, townEn, kana, chome:null, detail:reg && district !== town ? district : null,
      en:district, jp:district, pattern:id, ...(note ? {note} : {}),
    });
  }
  if(!areas.length) throw new Error(`no districts with parseable schedules (${skipped} rows skipped)`);

  areas.sort((a, b) => a.kana.localeCompare(b.kana, "ja") || (a.chome?.[0] ?? 0) - (b.chome?.[0] ?? 0));
  return {
    id:entry.id, code:entry.code, pref, jp:entry.jp, en:entry.en, verified:extractedAt.slice(0, 10),
    sources:[source.url, ...(entry.sourceUrls ?? [])],
    contacts, bins, plasticTest:null, sorting:{},
    calendar:{
      validFrom:entry.validFrom, validTo:entry.validTo,
      noCollection:{weekdays:[0], dates:["01-01", "01-02", "01-03", "12-29", "12-30", "12-31"]},
      note:calendarNote ?? "Collection days from open-data CSV (weekday rules). Confirm holidays and year-end changes on the city's official page.",
      patterns,
    },
    areas,
    attribution:{schedule:{name:source.name, url:source.url, license:source.license, commit:source.commit ?? "open-data"}},
    extractedAt, skippedRows:skipped,
  };
}
