/* Schedule seeds from npm run discover:official → .cache/crawler/official-candidates.json.
   CSV / area_days URLs the crawler found on official sites; importers still validate before shipping. */
import fs from "node:fs";
import path from "node:path";
import { ROOT, readJSON } from "../lib.mjs";
import { convert5374 } from "../sources/5374-area-days.mjs";
import { load5374Catalog } from "./5374-catalog.mjs";

const REPORT = path.join(ROOT, ".cache/crawler/official-candidates.json");

const slug = en => String(en ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function pickScheduleCsv(muni){
  const cands = muni.candidates ?? [];
  return cands.find(c => c.format === "csv" && (
    /area_days\.csv/i.test(c.url)
    || /garbage_collection_calendar/i.test(c.url)
  ));
}

export function loadOfficialCandidatesReport(){
  if(!fs.existsSync(REPORT)) return null;
  return readJSON(REPORT);
}

export function catalogOfficialCandidateEntries(){
  const report = loadOfficialCandidatesReport();
  if(!report?.municipalities?.length) return [];
  const catalogCodes = new Set(load5374Catalog().map(row => row.code));
  const out = [];
  for(const muni of report.municipalities){
    if(catalogCodes.has(muni.code)) continue;
    const pick = pickScheduleCsv(muni);
    if(!pick) continue;
    const id = `${slug(muni.en)}-${muni.code}`;
    const source = {
      name: "Official schedule CSV (crawler)",
      url: pick.url,
      license: muni.openData?.license ?? "Confirm on municipality site",
    };
    out.push({
      id,
      code: muni.code,
      pref: muni.pref,
      source,
      convert: today => convert5374({
        id, code: muni.code, pref: muni.pref, jp: muni.jp, en: muni.en, url: pick.url, source,
      }, today),
    });
  }
  return out;
}
