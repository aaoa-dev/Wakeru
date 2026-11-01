/* Fukui Prefecture ごみ収集日一覧 (https://www.pref.fukui.lg.jp/doc/dx-suishin/list_ct_gomisyusyubi.html)
   CC BY–style prefecture open data: weekday rules per district, converted at build time only. */
import { download, decode, csvObjects, townRegistry, splitTown, kanaToRomaji, parseRule } from "../lib.mjs";

export const SOURCE = {
  name: "Fukui Prefecture garbage collection schedule open data",
  url: "https://www.pref.fukui.lg.jp/doc/dx-suishin/list_ct_gomisyusyubi.html",
  license: "Fukui Prefecture open data (attribution required)",
};
const BASE = "https://www.pref.fukui.lg.jp/doc/dx-suishin/list_ct_gomisyusyubi_d/fil/";
const PREF = "18";
const DAYS = "日月火水木金土";
const CONTACT = /問い合わせ|確認して|収集しない|^-$|^なし$|^ー+$/;
/** header substring → bin (first match wins per bin) */
const HEADER_TO_BIN = [
  [/燃やす|燃やせる|燃える/, "burnable"],
  [/燃えない|燃やせない|埋立|金物/, "non_burnable"],
  [/プラスチック/, "plastic"],
  [/ペット/, "pet_bottle"],
  [/カン|空き缶|^缶$/, "beverage_can"],
  [/ビン|空きびん/, "glass_bottle"],
  [/蛍光|有害/, "hazardous"],
  [/段ボール|紙製|紙パック|新聞|雑誌|その他紙|古紙/, "paper"],
];

/** @type {{id:string, code:string, jp:string, en:string, files:string[], validFrom:string, validTo:string}[]} */
export const MUNICIPALITIES = [
  {id:"fukui", code:"18201", jp:"福井市", en:"Fukui", files:["fukuishisyusyubi.csv"], validFrom:"2026-04-01", validTo:"2027-03-31"},
  {id:"tsuruga", code:"18202", jp:"敦賀市", en:"Tsuruga", files:["turugashisyusyubi.csv"], validFrom:"2026-04-01", validTo:"2027-03-31"},
  {id:"obama", code:"18204", jp:"小浜市", en:"Obama", files:["obamashisyusyubi.csv"], validFrom:"2026-04-01", validTo:"2027-03-31"},
  {id:"ono", code:"18205", jp:"大野市", en:"Ono", files:["oonoshisyusyubi.csv"], validFrom:"2026-04-01", validTo:"2027-03-31"},
  {id:"katsuyama", code:"18206", jp:"勝山市", en:"Katsuyama", files:["katuyamashisyusyubi.csv"], validFrom:"2026-04-01", validTo:"2027-03-31"},
  {id:"sabae", code:"18207", jp:"鯖江市", en:"Sabae", files:["sabaeshisyusyubi.csv"], validFrom:"2026-04-01", validTo:"2027-03-31"},
  {id:"awara", code:"18208", jp:"あわら市", en:"Awara", files:["awarashisyusyubi.csv"], validFrom:"2026-04-01", validTo:"2027-03-31"},
  {id:"echizen", code:"18209", jp:"越前市", en:"Echizen", files:["etizenshisyusyubi.csv"], validFrom:"2026-04-01", validTo:"2027-03-31"},
  {id:"sakai-fukui", code:"18210", jp:"坂井市", en:"Sakai", files:["sakaishisyusyubi.csv"], validFrom:"2026-04-01", validTo:"2027-03-31"},
  {id:"eiheiji", code:"18322", jp:"永平寺町", en:"Eiheiji", files:["eiheizityousyusyubi.csv"], validFrom:"2026-04-01", validTo:"2027-03-31"},
  {id:"ikeda-fukui", code:"18382", jp:"池田町", en:"Ikeda", files:["ikedatyousyusyubi.csv"], validFrom:"2026-04-01", validTo:"2027-03-31"},
  {id:"minamiechizen", code:"18404", jp:"南越前町", en:"Minamiechizen", files:["minamietizentyousyusyubi.csv"], validFrom:"2026-04-01", validTo:"2027-03-31"},
  {id:"echizen-town", code:"18423", jp:"越前町", en:"Echizen", files:["etizentyousyusyubi.csv"], validFrom:"2026-04-01", validTo:"2027-03-31"},
  {id:"mihama-fukui", code:"18442", jp:"美浜町", en:"Mihama", files:["mihamatyousyusyubi.csv"], validFrom:"2026-04-01", validTo:"2027-03-31"},
  {id:"takahama", code:"18481", jp:"高浜町", en:"Takahama", files:["takahamatyousyusyubi.csv"], validFrom:"2026-04-01", validTo:"2027-03-31"},
  {id:"oi", code:"18483", jp:"おおい町", en:"Oi", files:["ooityousyusyubi.csv"], validFrom:"2026-04-01", validTo:"2027-03-31"},
  {id:"wakasa", code:"18501", jp:"若狭町", en:"Wakasa", files:["wakasasyusyubi_mikata.csv", "wakasasyusyubi_kaminaka.csv"], validFrom:"2026-04-01", validTo:"2027-03-31"},
];

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

function fukuiRule(cell, validFrom, validTo){
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
  return headers.find(h => /地区名/.test(h)) ?? headers.find(h => h.includes("地区")) ?? "地区名";
}

function columnsByBin(headers){
  const map = {};
  for(const h of headers){
    for(const [re, bin] of HEADER_TO_BIN){
      if(re.test(h)){ (map[bin] ??= []).push(h); break }
    }
  }
  return map;
}

function decodeCsv(buf){
  for(const enc of ["CP932", "UTF-8"]){
    const text = decode(buf, enc);
    if(text.includes("地区名") || /地区/.test(text.split("\n")[0] ?? "")) return csvObjects(text);
  }
  return csvObjects(decode(buf, "CP932"));
}

function scheduleKey(schedule){
  return JSON.stringify(schedule, Object.keys(schedule).sort());
}

const NO_MD = new Set(["01-01", "01-02", "01-03", "12-29", "12-30", "12-31"]);
function stripOffDays(rule){
  if(!rule?.dates) return rule;
  const dates = rule.dates.filter(d => !NO_MD.has(d.slice(5)) && new Date(`${d}T00:00`).getDay() !== 0);
  return dates.length ? {...rule, dates} : null;
}

async function loadRows(entry){
  const rows = [];
  for(const file of entry.files){
    const buf = await download("fukui-pref", BASE + file);
    rows.push(...decodeCsv(buf));
  }
  return rows;
}

export async function convert(entry, extractedAt){
  const towns = await townRegistry(entry.jp, {pref:PREF});
  const rows = await loadRows(entry);
  if(!rows.length) throw new Error("CSV has no rows");
  const districtCol = districtColumn(Object.keys(rows[0]));
  const colsByBin = columnsByBin(Object.keys(rows[0]));
  const patterns = {}, byKey = new Map(), areas = [];
  let skipped = 0;

  for(const row of rows){
    const district = row[districtCol]?.trim();
    if(!district) continue;
    const schedule = {};
    for(const [bin, cols] of Object.entries(colsByBin)){
      const rules = cols.map(col => fukuiRule(row[col], entry.validFrom, entry.validTo)).filter(Boolean);
      if(rules.length === 1) schedule[bin] = rules[0];
      else if(rules.length > 1) schedule[bin] = {any:rules};
    }
    if(!Object.keys(schedule).length){ skipped++; continue }

    let key = scheduleKey(schedule), id = byKey.get(key);
    if(!id){ id = String(byKey.size + 1); byKey.set(key, id); patterns[id] = schedule }

    const note = [row["備考"], row["キーワード"]].filter(Boolean).join(" · ") || undefined;
    let town = district;
    try { [town] = splitTown(district, towns) } catch { /* district label may span several chome */ }
    const reg = towns.get(town);
    const townEn = reg?.en || kanaToRomaji(row["読み"] || "") || town || district;
    const kana = reg?.kana ?? row["読み"] ?? "";
    areas.push({
      town:reg ? town : district, townEn, kana, chome:null, detail:reg && district !== town ? district : null,
      en:district, jp:district, pattern:id, ...(note ? {note} : {}),
    });
  }
  if(!areas.length) throw new Error(`no districts with parseable schedules (${skipped} rows skipped)`);

  areas.sort((a, b) => a.kana.localeCompare(b.kana, "ja") || (a.chome?.[0] ?? 0) - (b.chome?.[0] ?? 0));
  const bins = {
    burnable:{label:"燃やせるごみ", en:"Burnable", kind:"burn"},
    non_burnable:{label:"燃やせないごみ", en:"Non-burnable", kind:"non"},
    plastic:{label:"プラスチック資源", en:"Plastic", kind:"pla"},
    pet_bottle:{label:"ペットボトル類", en:"PET bottles", kind:"res"},
    beverage_can:{label:"空き缶", en:"Cans", kind:"res"},
    glass_bottle:{label:"空きびん・電池類", en:"Glass bottles", kind:"res"},
    paper:{label:"ダンボール・紙製容器・紙パック", en:"Paper", kind:"res"},
    hazardous:{label:"蛍光灯", en:"Hazardous", kind:"haz"},
    oversized:{label:"粗大ごみ", en:"Oversized", kind:"big"},
    no:{label:"収集しないもの", en:"Not collected", kind:"no"},
  };

  return {
    id:entry.id, code:entry.code, pref:PREF, jp:entry.jp, en:entry.en, verified:extractedAt.slice(0, 10),
    sources:[SOURCE.url, ...entry.files.map(f => BASE + f)],
    contacts:[{en:"Fukui Prefecture DX Promotion Division", tel:"0776-20-0270"}],
    bins, plasticTest:null, sorting:{},
    calendar:{
      validFrom:entry.validFrom, validTo:entry.validTo,
      noCollection:{weekdays:[0], dates:["01-01", "01-02", "01-03", "12-29", "12-30", "12-31"]},
      note:"Collection days from Fukui Prefecture's open-data CSV (weekday rules). Confirm holidays and year-end changes on the city's official page.",
      patterns,
    },
    areas,
    attribution:{schedule:{name:SOURCE.name, url:SOURCE.url, license:SOURCE.license, commit:"pref-portal"}},
    extractedAt, skippedRows:skipped,
  };
}
