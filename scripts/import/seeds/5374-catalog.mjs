/* All known 5374-style area_days.csv endpoints (discovered + curated). */
import fs from "node:fs";
import path from "node:path";
import { ROOT, readJSON } from "../lib.mjs";
import { convert5374 } from "../sources/5374-area-days.mjs";

const CATALOG = path.join(ROOT, "scripts/import/seeds/5374-catalog.json");

export function load5374Catalog(){
  if(!fs.existsSync(CATALOG)) return [];
  const data = readJSON(CATALOG);
  return data.municipalities ?? data;
}

export function catalog5374Entries(){
  return load5374Catalog().map(spec => ({
    id: spec.id,
    code: spec.code,
    pref: spec.pref,
    source: {name: "5374 area_days.csv", url: spec.url, license: "Municipality open data"},
    convert: today => convert5374(spec, today),
  }));
}
