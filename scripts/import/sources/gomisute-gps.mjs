/* Verified FY2026 schedules from gomisute-gps. Kanazawa rules were checked for all 71 districts × 365 days;
   Onagawa's PDF calendar was independently read twice, with all 324 monthly date cells agreeing. */
import { download, townRegistry, splitTown, parsePart, partEn, kanaToRomaji } from "../lib.mjs";

export const SOURCE = {
  name:"gomisute-gps",
  url:"https://github.com/firemio/gomisute-gps",
  license:"MIT",
  commit:"38b916294814",
};
const raw = path => `https://raw.githubusercontent.com/firemio/gomisute-gps/${SOURCE.commit}/${path}`;
const DAYS = {SU:0, MO:1, TU:2, WE:3, TH:4, FR:5, SA:6};
const isoUTC = date => date.toISOString().slice(0, 10);
const jpPart = part => `${part.chome ? `${part.chome.join("・")}丁目` : ""}${part.detail ?? ""}` || "全域";
const dateRule = dates => ({dates:[...new Set(dates)].sort()});

function rruleDates(row){
  if(row.rule_kind === "segments") return row.dates;
  const byday = row.rrule.match(/BYDAY=([^;]+)/)?.[1].split(",") ?? [];
  const wanted = byday.map(value => {
    const match = value.match(/^(\d)?([A-Z]{2})$/);
    if(!match) throw new Error(`unsupported RRULE day "${value}"`);
    return {week:match[1] ? +match[1] : null, day:DAYS[match[2]]};
  });
  const dates = [];
  for(let date = new Date(`${row.valid_from}T00:00:00Z`); isoUTC(date) <= row.valid_to; date.setUTCDate(date.getUTCDate() + 1)){
    const match = wanted.some(rule => date.getUTCDay() === rule.day && (!rule.week || Math.ceil(date.getUTCDate() / 7) === rule.week));
    if(match) dates.push(isoUTC(date));
  }
  const excluded = new Set(row.exdates ?? []);
  return [...dates.filter(date => !excluded.has(date)), ...(row.rdates ?? [])];
}

const KANAZAWA_BINS = {
  burnable:{label:"燃やすごみ", en:"Burnable", kind:"burn"},
  nonburnable:{label:"燃やさないごみ", en:"Non-burnable", kind:"non"},
  recyclable:{label:"資源", en:"Recyclables", kind:"res"},
  plastic:{label:"プラスチック資源", en:"Plastic", kind:"pla"},
  bottle:{label:"びん", en:"Glass bottles", kind:"res"},
  oversized:{label:"粗大ごみ", en:"Oversized", kind:"big"},
  no:{label:"市では収集しないもの", en:"Not collected", kind:"no"},
};

export async function kanazawa(today){
  const schedulePath = "out/kanazawa_schedules.json", areaPath = "out/kanazawa_town_parts.geojson";
  const schedules = JSON.parse((await download("gomisute-gps", raw(schedulePath))).toString());
  const townParts = JSON.parse((await download("gomisute-gps", raw(areaPath))).toString());
  const towns = await townRegistry("金沢市", {pref:"17"});
  const patterns = {};
  for(const row of schedules.schedules) (patterns[row.district] ??= {})[row.category] = dateRule(rruleDates(row));

  /* "chome" means the whole official town/chome polygon belongs to one district. Split-town Voronoi estimates are
     intentionally excluded because Wakeru has no banchi/geolocation picker with which to resolve them safely. */
  const pairs = new Map();
  for(const feature of townParts.features.filter(feature => feature.properties.method === "chome")){
    const {town:sourceTown, district} = feature.properties;
    pairs.set(`${sourceTown}|${district}`, {sourceTown, district});
  }
  const areas = [];
  let skippedTowns = 0;
  for(const {sourceTown, district} of pairs.values()){
    let town, rest;
    try { [town, rest] = splitTown(sourceTown, towns) } catch { skippedTowns++; continue }
    const registered = towns.get(town);
    for(const part of parsePart(rest)) areas.push({
      town, townEn:registered.en || kanaToRomaji(registered.kana) || town, kana:registered.kana || town, chome:part.chome, detail:part.detail,
      en:partEn(part), jp:jpPart(part), pattern:district,
    });
  }
  areas.sort((a, b) => a.kana.localeCompare(b.kana, "ja") || (a.chome?.[0] ?? 0) - (b.chome?.[0] ?? 0));
  return {
    id:"kanazawa", code:"17201", pref:"17", jp:"金沢市", en:"Kanazawa", verified:"2026-10-17",
    sources:[schedules.schedules[0].source.url], contacts:[{en:"Waste Reduction Promotion Division", tel:"076-220-2302"}],
    bins:KANAZAWA_BINS, plasticTest:null, sorting:{},
    calendar:{
      noCollection:{weekdays:[], dates:[]},
      note:`FY2026 schedule verified across all 71 districts. Towns split between districts are omitted because they require a banchi-level lookup; ${skippedTowns} historical town labels absent from the current official registry are also omitted.`,
      validFrom:"2026-04-01", validTo:"2027-03-31", patterns,
    },
    areas, attribution:{schedule:{...SOURCE, path:schedulePath, areaPath}}, updated:today,
  };
}

const ONAGAWA_BINS = {
  burnable:{label:"燃やすしかないごみ", en:"Burnable", kind:"burn"},
  containers:{label:"びん・缶・ペットボトル", en:"Bottles, cans and PET bottles", kind:"res"},
  resources:{label:"その他の資源ごみ・プラスチック", en:"Recyclables and plastic", kind:"pla"},
  nonburnable:{label:"燃やせないごみ", en:"Non-burnable", kind:"non"},
  oversized:{label:"粗大ごみ", en:"Oversized", kind:"big"},
  no:{label:"町では収集しないもの", en:"Not collected", kind:"no"},
};
const ONAGAWA_SORTING = {
  food:"burnable", hygiene:"burnable", wood:"resources", textile:"resources", "leather-rubber":"burnable",
  "paper-dirty":"burnable", "paper-misc":"resources", newspaper:"resources", magazine:"resources", cardboard:"resources",
  carton:"resources", pet:"containers", can:"containers", bottle:"containers", "glass-other":"nonburnable",
  metal:"containers", blade:"nonburnable", "plastic-pack":"resources", "plastic-product":"resources",
  "plastic-dirty":"burnable", "foam-tray":"resources", battery:"containers", "battery-li":"containers",
  fluorescent:"nonburnable", "appliance-small":"nonburnable", oil:"resources", oversized:"oversized",
  "appliance-law":"no", pc:"no", "not-collected":"no",
};

function onagawaNames(label){
  return label.replace(/（[^）]*）/g, "").split("・").map(name => name.trim()).filter(Boolean);
}

export async function onagawa(today){
  const path = "out/onagawa_data.json";
  const data = JSON.parse((await download("gomisute-gps", raw(path))).toString());
  const towns = await townRegistry("女川町", {pref:"04"}), districtPatterns = new Map();
  for(const row of data.resource.rows){
    const pattern = {
      containers:dateRule(row.by_column["缶・びん ペットボトル"]),
      resources:dateRule(row.by_column["ペットボトル以外のプラスチック容器・白色トレイ・紙・布・発泡スチロール・剪定枝・廃食油"]),
      nonburnable:dateRule(row.by_column["燃やせないごみ"]),
      oversized:dateRule(row.by_column["粗大ごみ"]),
    };
    for(const district of row.gyoseiku) districtPatterns.set(district, pattern);
  }
  for(const group of data.burnable.groups.filter(group => group.dates.length))
    for(const district of group.gyoseiku) districtPatterns.get(district).burnable = dateRule(group.dates);

  const patterns = {}, areas = [], seen = new Set();
  for(const mapping of data.place_to_gyoseiku.filter(mapping => mapping.gyoseiku.length)){
    const candidates = mapping.gyoseiku.map(district => districtPatterns.get(district)).filter(Boolean);
    if(!candidates.length || candidates.some(pattern => JSON.stringify(pattern) !== JSON.stringify(candidates[0]))) continue;
    const id = mapping.gyoseiku.join("+");
    patterns[id] = candidates[0];
    for(const sourceTown of onagawaNames(mapping.place)){
      const [town, rest] = splitTown(sourceTown, towns), registered = towns.get(town);
      for(const part of parsePart(rest)){
        const key = `${town}|${JSON.stringify(part)}|${id}`;
        if(seen.has(key)) continue;
        seen.add(key);
        areas.push({town, townEn:registered.en || kanaToRomaji(registered.kana) || town, kana:registered.kana || town, chome:part.chome, detail:part.detail,
          en:partEn(part), jp:jpPart(part), pattern:id});
      }
    }
  }
  areas.sort((a, b) => a.kana.localeCompare(b.kana, "ja") || (a.chome?.[0] ?? 0) - (b.chome?.[0] ?? 0));
  const currentNote = "Based on Onagawa's sorting rules effective from October 1, 2026.";
  const sorting = Object.fromEntries(Object.entries(ONAGAWA_SORTING).map(([type, bin]) => [type, {bin, note:currentNote}]));
  return {
    id:"onagawa-town", code:"04581", pref:"04", jp:"女川町", en:"Onagawa", verified:"2026-10-18",
    sources:data.sources.map(source => source.url), contacts:[{en:"Onagawa Clean Center", tel:"0225-53-3549"}],
    bins:ONAGAWA_BINS,
    plasticTest:{maxCm:50, products:true, bin:"resources", otherwise:"burnable",
      summary:"From October 2026, clean plastic packaging and 100% plastic products under 50 cm go to Recyclables and plastic; dirty plastic goes to Burnable."},
    sorting,
    calendar:{
      noCollection:{weekdays:[], dates:[]}, putOutBy:Object.fromEntries(Object.keys(ONAGAWA_BINS).filter(bin => bin !== "no").map(bin => [bin, "8:00"])),
      note:"FY2026 calendar independently read twice from the official PDF; all 324 monthly date cells agreed.",
      validFrom:data.valid_from, validTo:data.valid_to, patterns,
    },
    areas, attribution:{schedule:{...SOURCE, path}}, updated:today,
  };
}
