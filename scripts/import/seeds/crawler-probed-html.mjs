/* HTML schedule tables validated by probe-official-html.mjs */
import fs from "node:fs";
import path from "node:path";
import { ROOT, readJSON } from "../lib.mjs";
import { convertHtmlWeekly } from "../sources/html-weekly-table.mjs";
import { GENERIC_HTML_PROBE_COLUMNS, GENERIC_HTML_PROBE_BINS } from "./html-probe-columns.mjs";

const PROBED = path.join(ROOT, ".cache/crawler/probed-html-schedules.json");

export function loadProbedHtmlSchedules(){
  if(!fs.existsSync(PROBED)) return {entries: []};
  return readJSON(PROBED);
}

export function catalogProbedHtmlScheduleEntries(){
  const {entries = []} = loadProbedHtmlSchedules();
  return entries.map(row => ({
    id: row.id,
    code: row.code,
    source: {
      name: "Official HTML schedule table (crawler probe)",
      url: row.url,
      license: "Municipality website",
    },
    convert: today => convertHtmlWeekly({
      id: row.id,
      code: row.code,
      pref: row.pref,
      jp: row.jp,
      en: row.en,
      url: row.url,
      validFrom: "2026-04-01",
      validTo: "2027-03-31",
      sourceName: "Official HTML schedule table (crawler probe)",
      columns: GENERIC_HTML_PROBE_COLUMNS,
      bins: GENERIC_HTML_PROBE_BINS,
      note: "Weekday rules from official HTML table (crawler discovery + parse probe). Confirm holidays on the city site.",
    }, today),
  }));
}
