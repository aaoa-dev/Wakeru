/* Probe HTML schedule table URLs from official-candidates.json.
   Usage: node scripts/import/probe-official-html.mjs [--limit N] [--min-score 8] [--refresh] */
import fs from "node:fs";
import path from "node:path";
import { ROOT, download, decode, writeJSON, readJSON } from "./lib.mjs";
import { loadOfficialCandidatesReport } from "./seeds/official-candidates.mjs";
import { probeHtmlWeeklyTable } from "./sources/html-weekly-table.mjs";
import { GENERIC_HTML_PROBE_COLUMNS } from "./seeds/html-probe-columns.mjs";

const OUT = path.join(ROOT, ".cache/crawler/probed-html-schedules.json");
const MIN_AREAS = 3;

const argv = process.argv.slice(2);
const flag = name => argv.includes(`--${name}`);
const option = (name, fallback = "") => argv.find((_, i) => argv[i - 1] === `--${name}`) ?? fallback;
const limit = +option("limit", 0);
const minScore = +option("min-score", 8);
const refresh = flag("refresh");

const slug = en => String(en ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function shippedCodes(){
  const idx = path.join(ROOT, "data/municipalities.json");
  if(!fs.existsSync(idx)) return new Set();
  return new Set(readJSON(idx).municipalities.map(m => m.code));
}

function scheduleHtmlCandidate(c){
  if(c.format !== "html" && c.format !== "pdf") return false;
  if((c.score ?? 0) < minScore) return false;
  const blob = `${c.url}${c.label ?? ""}${c.title ?? ""}`;
  return /ごみ|ゴミ|gomi|garbage|収集|分別|リサイクル|廃棄/i.test(blob);
}

async function main(){
  const report = loadOfficialCandidatesReport();
  if(!report?.municipalities?.length){
    console.error("No official-candidates.json — run npm run discover first.");
    process.exit(1);
  }
  const shipped = shippedCodes();
  const prior = !refresh && fs.existsSync(OUT) ? readJSON(OUT) : {entries: []};
  const byCode = new Map(prior.entries.map(e => [e.code, e]));

  let tried = 0, found = 0;
  const munis = report.municipalities
    .filter(m => !shipped.has(m.code))
    .sort((a, b) => a.code.localeCompare(b.code));

  for(const muni of munis){
    if(limit && tried >= limit) break;
    if(byCode.has(muni.code) && !refresh) continue;
    const picks = (muni.candidates ?? [])
      .filter(scheduleHtmlCandidate)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    if(!picks.length) continue;
    tried++;
    let hit = null;
    for(const pick of picks.slice(0, 5)){
      try {
        const html = decode(await download(`crawler-html-probe-${muni.code}`, pick.url));
        const probe = probeHtmlWeeklyTable(html, GENERIC_HTML_PROBE_COLUMNS);
        if(probe.ok && probe.areas >= MIN_AREAS){
          hit = {
            code: muni.code, pref: muni.pref, jp: muni.jp, en: muni.en,
            url: pick.url, areas: probe.areas, candidateScore: pick.score ?? null,
            id: `${slug(muni.en)}-${muni.code}`,
            probedAt: new Date().toISOString(),
          };
          break;
        }
      } catch(err) {
        console.warn(`  ${muni.code} ${err.message}`);
      }
    }
    if(hit){
      byCode.set(muni.code, hit);
      found++;
      console.log(`✓ ${muni.code} ${muni.jp} ${hit.areas} districts ← ${hit.url.slice(0, 72)}…`);
    }
  }

  const entries = [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
  writeJSON(OUT, {generatedAt: new Date().toISOString(), minScore, entries});
  console.log(`\nWrote ${OUT}: ${entries.length} municipalities (${found} new, ${tried} tried)`);
}

main().catch(err => { console.error(err); process.exit(1) });
