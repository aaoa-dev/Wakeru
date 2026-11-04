/* Tokyo Metropolitan Government Open Data Catalog — weekday schedule XLSX/CSV
   (Ota shigengomiyoubi.xlsx, Chuo gomitoshigen.csv, Bunkyo syusyubi, Taito tiiki CSV, etc.). */
import XLSX from "xlsx";
import { download, decode, csvObjects, townRegistry, buildAreas, parseRule, splitTown } from "../lib.mjs";
import { convertDistrictWeeklyCsv, weeklyRule } from "./district-weekly-csv.mjs";

export const SOURCE = {
  name: "Tokyo Metropolitan Government Open Data Catalog",
  url: "https://catalog.data.metro.tokyo.lg.jp/",
  license: "CC BY 4.0",
};

const FY = {validFrom: "2026-04-01", validTo: "2027-03-31"};

const DEFAULT_BINS = {
  burnable: {label: "燃やすごみ", en: "Burnable", kind: "burn"},
  burn: {label: "可燃ごみ", en: "Burnable", kind: "burn"},
  non_burnable: {label: "燃やさないごみ", en: "Non-burnable", kind: "non"},
  non: {label: "不燃ごみ", en: "Non-burnable", kind: "non"},
  res: {label: "資源", en: "Recyclables", kind: "res"},
  plastic: {label: "プラスチック", en: "Plastic", kind: "pla"},
  pla: {label: "プラ", en: "Plastic", kind: "pla"},
  paper: {label: "古紙", en: "Paper", kind: "res"},
  pet_bottle: {label: "ペットボトル", en: "PET bottles", kind: "res"},
  glass_bottle: {label: "びん", en: "Glass bottles", kind: "res"},
  beverage_can: {label: "缶", en: "Cans", kind: "res"},
  oversized: {label: "粗大ごみ", en: "Oversized", kind: "big"},
  no: {label: "収集しないもの", en: "Not collected", kind: "no"},
};

const OTA_COLUMNS = {pla: 3, res: 4, burn: 5, non: 6};
const OTA_FILL = [1, 3, 4, 5, 6, 7];

function gridFromSheet(sheet){
  return XLSX.utils.sheet_to_json(sheet, {header: 1, defval: ""}).map(r => r.map(c => String(c).trim()));
}

function detectFormat(url, grid, headers){
  if(/shigengomiyoubi/i.test(url)) return "ota-shigen";
  const h0 = grid?.[0]?.join("") ?? "";
  const hdr = headers?.join("") ?? "";
  if(/町丁目名/.test(h0)) return "ota-shigen";
  if(/町名/.test(hdr) && /丁目/.test(hdr) && /可燃/.test(hdr)) return "town-chome";
  if(/地域/.test(hdr) && /町名/.test(hdr) && /燃やす/.test(hdr)) return "chuo-csv";
  if(/町丁名/.test(hdr) && /燃やすごみ/.test(hdr)) return "tiiki-csv";
  if(/市区町村コード/.test(hdr) && /町名/.test(hdr) && /丁目/.test(hdr)) return "wagmap-csv";
  if(/年月日/.test(hdr) && /地区/.test(hdr)) return "date-matrix-csv";
  return "district-weekly-csv";
}

function parseOtaShigen(grid){
  if(!/町丁目/.test(grid[0][0])) throw new Error("unexpected Ota-style header row");
  let prev = [];
  return grid.slice(1).filter(r => r[2]).map(r => {
    const row = r.map((c, i) => c || (OTA_FILL.includes(i) ? prev[i] ?? "" : c));
    prev = row;
    return {
      town: row[1],
      part: row[2],
      label: row[2].replace(/\s+/g, ""),
      schedule: Object.fromEntries(Object.entries(OTA_COLUMNS).map(([bin, i]) => [bin, parseRule(row[i])])),
    };
  });
}

function parseTownChome(rows, validFrom, validTo){
  const out = [];
  for(const row of rows){
    const town = row["町名"]?.trim();
    const chome = row["丁目"]?.trim();
    if(!town || !chome) continue;
    const schedule = {};
    for(const [col, bin] of [
      [/可燃/, "burnable"],
      [/不燃/, "non_burnable"],
      [/プラ/, "plastic"],
      [/新聞|雑誌|段ボール|びん|缶|ペット|資源（新/, "paper"],
    ]){
      const key = Object.keys(row).find(h => col.test(h));
      if(!key) continue;
      const rule = weeklyRule(row[key], validFrom, validTo);
      if(rule) schedule[bin] = rule;
    }
    if(Object.keys(schedule).length) out.push({town, part: chome, label: `${town}${chome}`, schedule});
  }
  if(!out.length) throw new Error("town-chome sheet has no rows");
  return out;
}

function parseChuoCsv(rows, validFrom, validTo){
  const out = [];
  for(const row of rows){
    const region = row["地域"]?.trim() ?? "";
    const townShort = row["町名"]?.trim();
    if(!townShort) continue;
    const partRaw = row["丁目"]?.trim();
    const part = !partRaw || partRaw === "全域" ? "全域" : partRaw;
    const schedule = {};
    const res = weeklyRule(row["資源"], validFrom, validTo);
    const burn = weeklyRule(row["燃やすごみ"], validFrom, validTo);
    const non = weeklyRule(row["燃やさないごみ"], validFrom, validTo);
    const pla = weeklyRule(row["プラマーク"], validFrom, validTo);
    if(res) schedule.res = res;
    if(burn) schedule.burnable = burn;
    if(non) schedule.non_burnable = non;
    if(pla) schedule.plastic = pla;
    if(!Object.keys(schedule).length) continue;
    out.push({region, townShort, part, schedule});
  }
  if(!out.length) throw new Error("chuo-style CSV has no rows");
  return out;
}

function resolveChuoRows(rows, towns){
  return rows.map(r => {
    const town = [r.townShort, r.region + r.townShort].find(t => towns.has(t));
    if(!town) throw new Error(`unknown town ${r.region} ${r.townShort}`);
    const label = r.part === "全域" ? town : `${town}${r.part}`;
    return {town, part: r.part, label, schedule: r.schedule};
  });
}

function parseTiikiCsv(rows, validFrom, validTo){
  const out = [];
  for(const row of rows){
    const district = row["町丁名"]?.trim();
    if(!district || district === "町丁名") continue;
    const schedule = {};
    const res = weeklyRule(row["資源"], validFrom, validTo);
    const burn = weeklyRule(row["燃やすごみ"], validFrom, validTo);
    const non = weeklyRule(row["燃やさないごみ"] ?? row["燃やすないごみ"], validFrom, validTo);
    if(res){ schedule.res = res; schedule.pla = res }
    if(burn) schedule.burnable = burn;
    if(non) schedule.non_burnable = non;
    if(!Object.keys(schedule).length) continue;
    out.push({district, schedule});
  }
  if(!out.length) throw new Error("tiiki-style CSV has no rows");
  return out;
}

function expandTiikiRows(rows, towns){
  const out = [];
  for(const {district, schedule} of rows){
    const normalized = district.replace(/、/g, "・");
    for(const frag of normalized.split(/・/).map(s => s.trim()).filter(Boolean)){
      const [town, rest] = splitTown(frag, towns);
      out.push({town, part: rest || "全域", label: frag, schedule});
    }
  }
  return out;
}

function parseWagmapCsv(rows, validFrom, validTo){
  const out = [];
  for(const row of rows){
    const town = row["町名"]?.trim();
    const chomeSpec = row["丁目"]?.trim();
    if(!town || !chomeSpec) continue;
    const schedule = {};
    for(const [col, bin] of [
      ["資源プラスチック", "plastic"],
      ["びん,ペットボトル", "pet_bottle"],
      ["燃やすごみ", "burnable"],
      ["陶器,ガラス,金属ごみ", "non_burnable"],
    ]){
      const cell = row[col];
      if(!cell) continue;
      const parts = cell.split(/[;；]/).map(s => s.trim()).filter(Boolean);
      const rules = parts.map(p => weeklyRule(p, validFrom, validTo)).filter(Boolean);
      if(rules.length === 1) schedule[bin] = rules[0];
      else if(rules.length > 1) schedule[bin] = {any: rules};
    }
    if(!Object.keys(schedule).length) continue;
    const chomeParts = chomeSpec.split(/[;；]/).map(s => s.trim()).filter(Boolean);
    const part = chomeParts.every(p => /^\d+$/.test(p))
      ? chomeParts.map(n => `${n}丁目`).join("・")
      : chomeSpec;
    out.push({town, part, label: `${town}${part}`, schedule});
  }
  if(!out.length) throw new Error("wagmap-style CSV has no rows");
  return out;
}

async function loadGrid(spec){
  const buf = await download(spec.id, spec.url);
  const url = spec.url;
  if(/\.xlsx?($|\?)/i.test(url)){
    const wb = XLSX.read(buf);
    const sheet = wb.Sheets[spec.sheetName ?? wb.SheetNames[0]];
    return {kind: "grid", grid: gridFromSheet(sheet), sheetName: spec.sheetName ?? wb.SheetNames[0]};
  }
  const text = decode(buf, spec.encoding ?? "CP932");
  if(/^\s*</.test(text)) throw new Error("URL returned HTML, not CSV/XLSX");
  const rows = csvObjects(text);
  return {kind: "csv", rows, headers: Object.keys(rows[0] ?? {})};
}

function binsForSpec(spec){
  const bins = {...DEFAULT_BINS, ...(spec.bins ?? {})};
  for(const key of Object.keys(bins)) if(!bins[key].kind) bins[key] = DEFAULT_BINS[key] ?? bins[key];
  return bins;
}

function prepareMeguroRows(rows){
  const inheritedColumns = ["燃やすごみ", "燃やさないごみ", "水銀を含む製品", "資源"];
  let previousTown = "";
  let inherited = {};
  return rows.map(row => {
    const town = row["町名"]?.trim() ?? "";
    if(town !== previousTown){
      inherited = {};
      previousTown = town;
    }
    for(const column of inheritedColumns){
      if(row[column]?.trim()) inherited[column] = row[column];
    }
    const detail = row["番地・号"]?.trim();
    return {
      "地区名": [town, detail].filter(Boolean).join(" "),
      ...inherited,
      "古紙回収": row["古紙回収"]?.trim() ?? "",
    };
  });
}

function prepareSumidaRows(rows){
  return rows.map(row => {
    const town = row["町名"]?.trim() ?? "";
    const chome = row["丁目"]?.trim() ?? "";
    return {
      "地区名": chome && chome !== "全域" ? `${town}${chome}` : town,
      ...Object.fromEntries(Object.entries(row).filter(([key]) => key !== "町名" && key !== "丁目")),
    };
  });
}

/** @param {import("../seeds/tokyo-metro.mjs").TokyoMetroSeed} spec */
export async function convert(spec, extractedAt){
  const validFrom = spec.validFrom ?? FY.validFrom;
  const validTo = spec.validTo ?? FY.validTo;
  const loaded = await loadGrid(spec);
  const format = spec.format ?? (loaded.kind === "grid"
    ? detectFormat(spec.url, loaded.grid, [])
    : detectFormat(spec.url, [], loaded.headers));

  const bins = binsForSpec(spec);
  const sources = [SOURCE.url, spec.url];

  if(format === "district-weekly-csv" || format === "date-matrix-csv" || format === "meguro-csv" || format === "sumida-csv"){
    const headerToBin = spec.headerToBin ?? [
      [/燃やす|可燃/, "burnable"],
      [/燃やさない|不燃|陶器|ガラス|金属/, "non_burnable"],
      [/プラ/, "plastic"],
      [/資源|びん|缶|ペット|古紙|紙/, "res"],
    ];
    return convertDistrictWeeklyCsv({
      cacheKey: spec.id,
      source: {...SOURCE, url: spec.url},
      pref: "13",
      bins,
      headerToBin,
      entry: {
        id: spec.id, code: spec.code, jp: spec.jp, en: spec.en,
        validFrom, validTo, sourceUrls: [spec.url],
      },
      loadRows: async () => format === "meguro-csv"
        ? prepareMeguroRows(loaded.rows)
        : format === "sumida-csv" ? prepareSumidaRows(loaded.rows) : loaded.rows,
      calendarNote: spec.note ?? "Collection days from Tokyo Metro Open Data Catalog (weekday rules). Confirm holidays on the city's official calendar.",
    }, extractedAt);
  }

  const towns = await townRegistry(spec.jp, {pref: "13", ward: spec.ward ?? ""});
  let raw;
  if(format === "ota-shigen"){
    raw = parseOtaShigen(loaded.grid);
  } else if(format === "town-chome"){
    raw = parseTownChome(loaded.kind === "csv" ? loaded.rows : csvObjectsFromGrid(loaded.grid), validFrom, validTo);
  } else if(format === "chuo-csv"){
    raw = resolveChuoRows(parseChuoCsv(loaded.rows, validFrom, validTo), towns);
  } else if(format === "tiiki-csv"){
    raw = expandTiikiRows(parseTiikiCsv(loaded.rows, validFrom, validTo), towns);
  } else if(format === "wagmap-csv"){
    raw = parseWagmapCsv(loaded.rows, validFrom, validTo);
  } else {
    throw new Error(`unsupported format "${format}" for ${spec.url}`);
  }
  const {patterns, areas, coverage} = buildAreas(raw, towns);
  if(!areas.length) throw new Error("no areas after town matching");
  const plasticTest = bins.pla || bins.plastic
    ? {bin: bins.pla ? "pla" : "plastic", otherwise: bins.res ? "res" : "paper"}
    : null;

  return {
    id: spec.id,
    code: spec.code,
    pref: "13",
    jp: spec.jp,
    en: spec.en,
    verified: extractedAt.slice(0, 10),
    sources,
    contacts: [],
    bins,
    plasticTest,
    sorting: {},
    calendar: {
      validFrom,
      validTo,
      noCollection: {weekdays: [0], dates: ["01-01", "01-02", "01-03", "12-29", "12-30", "12-31"]},
      note: spec.note ?? "Weekday rules from Tokyo Metro Open Data Catalog (CC BY 4.0). Confirm holidays and collection-point signs on the city's official page.",
      patterns,
    },
    areas,
    attribution: {schedule: {...SOURCE, url: spec.url, commit: "open-data"}},
    updated: extractedAt.slice(0, 10),
    ...(coverage.length ? {_coverageNote: coverage} : {}),
  };
}

function csvObjectsFromGrid(grid){
  const [head, ...rows] = grid;
  const keys = head.map(h => String(h).trim());
  return rows.map(r => Object.fromEntries(keys.map((k, i) => [k, String(r[i] ?? "").trim()])));
}
