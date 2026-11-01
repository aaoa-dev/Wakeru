/* Build municipality JSON from official weekday rules (no remote CSV). */
import { weeklyRule } from "./district-weekly-csv.mjs";

const DEFAULT_BINS = {
  burnable:{label:"燃やすごみ", en:"Burnable", kind:"burn"},
  non_burnable:{label:"燃やさないごみ", en:"Non-burnable", kind:"non"},
  plastic:{label:"プラスチック", en:"Plastic", kind:"pla"},
  res:{label:"資源ごみ", en:"Recyclables", kind:"res"},
  oversized:{label:"粗大ごみ", en:"Oversized", kind:"big"},
  no:{label:"収集しないもの", en:"Not collected", kind:"no"},
};

function rule(cell, validFrom, validTo){
  return weeklyRule(cell, validFrom, validTo);
}

/** @param {{id:string, code:string, pref:string, jp:string, en:string, source:{name:string, url:string, license?:string}, validFrom?:string, validTo?:string, bins?:object, note?:string, districts:{id:string, jp:string, en?:string, schedule:Record<string,string>}[]}} spec */
export function buildStaticWeekly(spec, extractedAt){
  const validFrom = spec.validFrom ?? "2026-04-01";
  const validTo = spec.validTo ?? "2027-03-31";
  const patterns = {}, byKey = new Map(), areas = [];
  for(const d of spec.districts){
    const schedule = {};
    for(const [bin, cell] of Object.entries(d.schedule)){
      const r = rule(cell, validFrom, validTo);
      if(r) schedule[bin] = r;
    }
    if(!Object.keys(schedule).length) continue;
    const key = JSON.stringify(schedule, Object.keys(schedule).sort());
    let pid = byKey.get(key);
    if(!pid){ pid = String(byKey.size + 1); byKey.set(key, pid); patterns[pid] = schedule }
    areas.push({
      town:d.jp, townEn:d.en ?? d.jp, kana:d.jp, chome:null, detail:null,
      en:d.en ?? d.jp, jp:d.jp, pattern:pid,
    });
  }
  if(!areas.length) throw new Error("no districts with schedules");
  return {
    id:spec.id, code:spec.code, pref:spec.pref, jp:spec.jp, en:spec.en, verified:extractedAt.slice(0, 10),
    sources:[spec.source.url], contacts:[],
    bins:spec.bins ?? DEFAULT_BINS, plasticTest:null, sorting:{},
    calendar:{
      validFrom, validTo,
      noCollection:{weekdays:[0], dates:["01-01", "01-02", "01-03", "12-29", "12-30", "12-31"]},
      note:spec.note ?? "Weekday rules from the municipality's official collection schedule page. Confirm holidays on the city website.",
      patterns,
    },
    areas,
    attribution:{schedule:spec.source}, updated:extractedAt.slice(0, 10),
  };
}
