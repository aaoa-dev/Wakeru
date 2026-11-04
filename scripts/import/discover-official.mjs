/* Discover garbage schedule/sorting sources from official municipality websites.
   This is deliberately a candidate generator, not a publisher: crawler output is written to
   .cache/crawler/official-candidates.json and must be reviewed before an importer is registered.

   Usage:
     node scripts/import/discover-official.mjs --pref 20 --limit 10
     node scripts/import/discover-official.mjs --code 20207 --max-pages 30 --refresh
     node scripts/import/discover-official.mjs --all --include-covered
*/
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {ROOT, csvObjects, htmlText, readJSON, writeJSON} from "./lib.mjs";
import {listCities} from "./municipality-master.mjs";

export const SOURCES = {
  roster: "https://data.address-br.digital.go.jp/mt_city/mt_city_all.csv.zip",
  officialSites: "https://www.j-lis.go.jp/spd/map-search/cms_1069.html",
  openDataDirectory: "https://www.digital.go.jp/assets/contents/node/basic_page/field_ref_resources/2b1128e2-c699-4aa0-9206-37169a6697c8/3d2142af/20260630_resources_opendata_lg_list_02.csv",
};

const CACHE = path.join(ROOT, ".cache/crawler/http");
const OUT = path.join(ROOT, ".cache/crawler/official-candidates.json");
const UA = "Mozilla/5.0 (compatible; WakeruOfficialDataCrawler/0.1; +https://github.com/; official municipal waste-data discovery)";
const argv = process.argv.slice(2);
const flag = name => argv.includes(`--${name}`);
const option = (name, fallback = "") => argv.find((_, i) => argv[i - 1] === `--${name}`) ?? fallback;
const refresh = flag("refresh");
const maxPages = Math.max(1, +option("max-pages", 24));
const concurrency = Math.max(1, Math.min(8, +option("concurrency", 3)));
const requestedLimit = +option("limit", 10);
const requestDelayMs = Math.max(250, +option("delay-ms", 1200));
const MAX_HTML_BYTES = 4 * 1024 * 1024;

const PREFS = JSON.parse(fs.readFileSync(path.join(ROOT, "data/map/japan.json"), "utf8")).prefs;
const prefByJp = new Map(PREFS.map(p => [p.jp, p.code]));
const covered = new Set(JSON.parse(fs.readFileSync(path.join(ROOT, "data/municipalities.json"), "utf8")).municipalities.map(m => m.code));

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
const safeUrl = value => {
  try {
    const url = new URL(value);
    url.hash = "";
    if(!["http:", "https:"].includes(url.protocol)) return null;
    return url.href;
  } catch { return null }
};
const crawlKey = value => {
  const url = new URL(value);
  url.search = ""; url.hash = "";
  return url.href;
};
const cacheFiles = url => {
  const key = sha256(url);
  return {body:path.join(CACHE, `${key}.body`), meta:path.join(CACHE, `${key}.json`)};
};

const hostReadyAt = new Map(), hostQueues = new Map();
async function hostRequest(url, task){
  const host = new URL(url).host;
  const previous = hostQueues.get(host) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(async () => {
    const wait = Math.max(0, (hostReadyAt.get(host) ?? 0) - Date.now());
    if(wait) await sleep(wait);
    try { return await task() }
    finally { hostReadyAt.set(host, Date.now() + requestDelayMs) }
  });
  hostQueues.set(host, current.then(() => {}, () => {}));
  return current;
}

async function get(url, {maxBytes = MAX_HTML_BYTES, accept = "text/html,application/xhtml+xml,text/plain,application/xml,text/xml;q=0.9,*/*;q=0.2"} = {}){
  const normalized = safeUrl(url);
  if(!normalized) throw new Error(`invalid URL: ${url}`);
  const files = cacheFiles(normalized);
  if(!refresh && fs.existsSync(files.body) && fs.existsSync(files.meta)){
    return {body:fs.readFileSync(files.body), ...JSON.parse(fs.readFileSync(files.meta, "utf8")), cached:true};
  }
  return hostRequest(normalized, async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      const res = await fetch(normalized, {headers:{"User-Agent":UA, Accept:accept}, redirect:"follow", signal:ctrl.signal});
      const length = +(res.headers.get("content-length") ?? 0);
      if(length > maxBytes) throw new Error(`response too large (${length} bytes)`);
      const body = Buffer.from(await res.arrayBuffer());
      if(body.length > maxBytes) throw new Error(`response too large (${body.length} bytes)`);
      const meta = {
        requestedUrl:normalized,
        finalUrl:res.url,
        status:res.status,
        contentType:res.headers.get("content-type") ?? "",
        etag:res.headers.get("etag") ?? null,
        lastModified:res.headers.get("last-modified") ?? null,
        retrievedAt:new Date().toISOString(),
        bytes:body.length,
        sha256:sha256(body),
      };
      fs.mkdirSync(CACHE, {recursive:true});
      fs.writeFileSync(files.body, body);
      fs.writeFileSync(files.meta, JSON.stringify(meta, null, 2) + "\n");
      return {body, ...meta, cached:false};
    } finally { clearTimeout(timer) }
  });
}

function textOf(response){
  const charset = response.contentType.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1] ?? "utf-8";
  const encoding = /shift|sjis|932/i.test(charset) ? "shift_jis" : "utf-8";
  return new TextDecoder(encoding).decode(response.body).replace(/^\uFEFF/, "");
}

const decodeEntity = value => htmlText(value.replace(/</g, "&lt;").replace(/>/g, "&gt;"));
export function parseLinks(html, base){
  const links = [];
  for(const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)){
    const href = match[1].match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const raw = href?.[1] ?? href?.[2] ?? href?.[3];
    if(!raw) continue;
    try {
      const url = safeUrl(new URL(decodeEntity(raw), base).href);
      if(url) links.push({url, text:htmlText(match[2]).replace(/\s+/g, " ").trim()});
    } catch { /* malformed link */ }
  }
  return links;
}

function pageTitle(html){
  return htmlText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim();
}

const visibleText = html => htmlText(String(html ?? "")
  .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, " "))
  .replace(/\s+/g, " ").trim();

const SIGNALS = [
  [/ごみ収集|ゴミ収集|ごみの日|収集日|収集曜日|収集地区|地区別収集|地域別収集/g, 7, "collection schedule"],
  [/ごみカレンダー|ゴミカレンダー|収集カレンダー|ごみ収集カレンダー/g, 7, "calendar"],
  [/ごみ分別|ゴミ分別|分別一覧|分別辞典|分別検索|品目別/g, 6, "sorting"],
  [/ごみ|ゴミ|廃棄物|資源回収|リサイクル/g, 2, "waste"],
  [/(?:^|[\/_-])(gomi|garbage|trash|waste|recycl(?:e|ing)|haikibutsu)(?:[\/_-]|$)/gi, 5, "waste path"],
  [/(?:^|[\/_-])(shushubi|shushu|calendar|bunbetsu)(?:[\/_-]|$)/gi, 5, "schedule/sorting path"],
  [/オープンデータ|open\s*data/gi, 2, "open data"],
  [/令和8|2026|令和9|2027/g, 2, "current fiscal year"],
  [/事業系|産業廃棄物|入札|採用|キッズ/g, -4, "negative context"],
];

export function scoreCandidate(value){
  const text = String(value ?? "").normalize("NFKC");
  let score = 0;
  const reasons = [];
  for(const [pattern, points, reason] of SIGNALS){
    pattern.lastIndex = 0;
    if(pattern.test(text)){ score += points; reasons.push(reason) }
  }
  const ext = new URL(safeUrl(text.match(/https?:\/\/\S+/)?.[0] ?? "https://invalid.example/")).pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if(["csv", "json", "xml"].includes(ext)){ score += 4; reasons.push("machine-readable file") }
  else if(["xls", "xlsx"].includes(ext)){ score += 3; reasons.push("spreadsheet") }
  else if(ext === "pdf"){ score += 1; reasons.push("PDF") }
  return {score, reasons:[...new Set(reasons)]};
}

const relevant = scored => scored.reasons.some(reason => ["collection schedule", "calendar", "sorting", "waste", "waste path", "schedule/sorting path"].includes(reason));

function classify(value, url){
  const s = String(value ?? "");
  const schedule = /収集日|収集曜日|収集地区|地区別|地域別|カレンダー|calendar/i.test(s);
  const sorting = /分別|品目|辞典|dictionary/i.test(s);
  const ext = new URL(url).pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  return {
    kind:schedule && sorting ? "schedule-and-sorting" : schedule ? "schedule" : sorting ? "sorting" : "waste-general",
    format:["csv", "json", "xml", "xls", "xlsx", "pdf"].includes(ext) ? ext : "html",
  };
}

export function parseRobots(text){
  const groups = [];
  let agents = [], rules = [];
  const flush = () => { if(agents.length) groups.push({agents, rules}); agents = []; rules = [] };
  for(const raw of String(text ?? "").split(/\r?\n/)){
    const line = raw.replace(/#.*$/, "").trim();
    if(!line) continue;
    const [key, ...rest] = line.split(":");
    const value = rest.join(":").trim();
    if(/^user-agent$/i.test(key)){
      if(rules.length) flush();
      agents.push(value.toLowerCase());
    } else if(/^(allow|disallow)$/i.test(key) && agents.length){
      rules.push({allow:/^allow$/i.test(key), path:value});
    }
  }
  flush();
  return groups;
}

export function robotsAllows(groups, url){
  const pathname = new URL(url).pathname;
  const ua = UA.toLowerCase();
  const matching = groups.filter(g => g.agents.some(a => a === "*" || ua.includes(a)));
  const rules = matching.flatMap(g => g.rules).filter(r => r.path && pathname.startsWith(r.path));
  rules.sort((a, b) => b.path.length - a.path.length || Number(b.allow) - Number(a.allow));
  return rules[0]?.allow ?? true;
}

const robotsCache = new Map();
async function robotPolicy(url){
  const origin = new URL(url).origin;
  if(robotsCache.has(origin)) return robotsCache.get(origin);
  const robotsUrl = `${origin}/robots.txt`;
  try {
    const response = await get(robotsUrl, {maxBytes:512 * 1024, accept:"text/plain,*/*;q=0.1"});
    if(response.status === 404){
      const policy = {available:false, allowAll:true, groups:[], sitemaps:[], url:robotsUrl};
      robotsCache.set(origin, policy); return policy;
    }
    if(response.status >= 400) throw new Error(`HTTP ${response.status}`);
    const text = textOf(response);
    const policy = {
      available:true,
      allowAll:false,
      groups:parseRobots(text),
      sitemaps:[...text.matchAll(/^sitemap:\s*(\S+)/gim)].map(m => safeUrl(m[1])).filter(Boolean),
      url:robotsUrl,
    };
    robotsCache.set(origin, policy); return policy;
  } catch(err){
    const policy = {available:false, allowAll:false, groups:[], sitemaps:[], url:robotsUrl, error:err.message};
    robotsCache.set(origin, policy); return policy;
  }
}

async function mayFetch(url){
  const policy = await robotPolicy(url);
  return {allowed:policy.allowAll || robotsAllows(policy.groups, url), policy};
}

function directoryRows(text){
  return csvObjects(text.replace(/^\uFEFF/, "")).map(row => ({
    code:(row["団体コード"] ?? "").slice(0, 5),
    jp:row["団体名"],
    urls:[
      row["自治体サイトのオープンデータページURL"],
      row["オープンデータ掲載サイトのURL1"],
      row["オープンデータ掲載サイトのURL2"],
      row["オープンデータ掲載サイトのURL3"],
    ].map(safeUrl).filter(Boolean),
    api:row["API有無"] === "有",
    license:row["ライセンス"] || null,
  })).filter(row => /^\d{5}$/.test(row.code));
}

export async function openDataDirectory(){
  const response = await get(SOURCES.openDataDirectory, {maxBytes:2 * 1024 * 1024, accept:"text/csv,*/*;q=0.1"});
  if(!response.status || response.status >= 400) throw new Error(`Digital Agency directory: HTTP ${response.status}`);
  return new Map(directoryRows(textOf(response)).map(row => [row.code, row]));
}

async function jlisPrefPages(){
  const response = await get(SOURCES.officialSites);
  const links = parseLinks(textOf(response), response.finalUrl);
  const out = new Map();
  for(const link of links){
    const pref = prefByJp.get(link.text.trim());
    if(pref && new URL(link.url).host.endsWith("j-lis.go.jp")) out.set(pref, link.url);
  }
  return out;
}

export async function jlisOfficialHomes(cities){
  const pages = await jlisPrefPages();
  const wantedPrefs = [...new Set(cities.map(city => city.pref))];
  const homes = new Map();
  for(const pref of wantedPrefs){
    const page = pages.get(pref);
    if(!page) continue;
    try {
      const response = await get(page);
      const links = parseLinks(textOf(response), response.finalUrl);
      const byName = new Map(links.map(link => [link.text.replace(/\s+/g, "").trim(), link.url]));
      for(const city of cities.filter(c => c.pref === pref)){
        const url = byName.get(city.jp.replace(/\s+/g, ""));
        if(url && !new URL(url).host.endsWith("j-lis.go.jp")) homes.set(city.code, url);
      }
    } catch(err){ console.warn(`J-LIS prefecture ${pref}: ${err.message}`) }
  }
  return homes;
}

async function sitemapUrls(seed, robots){
  const roots = [...robots.sitemaps];
  if(!roots.length) roots.push(`${new URL(seed).origin}/sitemap.xml`);
  const queue = roots.map(url => ({url, depth:0}));
  const seen = new Set(), found = [];
  while(queue.length && seen.size < 40){
    const {url:sitemap, depth} = queue.shift();
    if(seen.has(sitemap)) continue;
    seen.add(sitemap);
    try {
      if(!(await mayFetch(sitemap)).allowed) continue;
      const response = await get(sitemap, {maxBytes:3 * 1024 * 1024, accept:"application/xml,text/xml,text/plain,*/*;q=0.1"});
      if(response.status >= 400) continue;
      for(const match of textOf(response).matchAll(/<loc[^>]*>([\s\S]*?)<\/loc>/gi)){
        const url = safeUrl(htmlText(match[1]));
        if(!url) continue;
        const isSitemap = /(?:sitemap[^/]*\.xml)(?:$|\?)/i.test(url);
        const scored = scoreCandidate(decodeURIComponent(url));
        if(isSitemap && depth < 2 && (depth === 0 ? relevant(scored) : scored.score >= 2)) queue.push({url, depth:depth + 1});
        else if(!isSitemap) found.push(url);
      }
    } catch { /* sitemap is an optional accelerator */ }
  }
  return [...new Set(found)];
}

function candidateRecord({url, label, from, officialOrigins, response = null}){
  const scored = scoreCandidate(`${label} ${decodeURIComponent(url)}`);
  const external = !officialOrigins.has(new URL(url).origin);
  return {
    url,
    title:label || null,
    ...classify(`${label} ${url}`, url),
    score:scored.score,
    reasons:scored.reasons,
    discoveredFrom:from,
    officiality:external ? "linked-from-official-source" : "official-origin",
    ...(response ? {
      finalUrl:response.finalUrl,
      contentType:response.contentType,
      retrievedAt:response.retrievedAt,
      bytes:response.bytes,
      sha256:response.sha256,
      etag:response.etag,
      lastModified:response.lastModified,
      evidenceExcerpt:visibleText(textOf(response)).slice(0, 500),
    } : {}),
    reviewStatus:"candidate",
  };
}

export async function crawlMunicipality(city, home, openData){
  const seeds = [...new Set([home, ...(openData?.urls ?? [])].filter(Boolean))];
  const errors = [];
  if(!seeds.length) return {code:city.code, pref:city.pref, jp:city.jp, en:city.en, seeds:[], pagesVisited:0, candidates:[], errors:["no authoritative website seed"]};

  const officialOrigins = new Set(seeds.map(url => new URL(url).origin));
  const queue = seeds.map(url => ({url, depth:0, from:"authoritative directory"}));
  const queued = new Set(queue.map(item => crawlKey(item.url)));
  const visited = new Set(), visitedKeys = new Set();
  const candidates = new Map();
  const robots = [];

  for(const seed of seeds){
    const policy = await robotPolicy(seed);
    robots.push({origin:new URL(seed).origin, url:policy.url, available:policy.available, allowAll:policy.allowAll, error:policy.error ?? null});
    for(const url of (await sitemapUrls(seed, policy)).map(safeUrl).filter(Boolean)){
      if(new URL(url).origin !== new URL(seed).origin) continue;
      const scored = scoreCandidate(decodeURIComponent(url));
      if(scored.score >= 4 && relevant(scored) && !queued.has(crawlKey(url))){
        queue.push({url, depth:1, from:policy.url}); queued.add(crawlKey(url));
      }
    }
  }

  queue.sort((a, b) => scoreCandidate(decodeURIComponent(b.url)).score - scoreCandidate(decodeURIComponent(a.url)).score);
  while(queue.length && visited.size < maxPages){
    const item = queue.shift();
    if(visitedKeys.has(crawlKey(item.url))) continue;
    const decision = await mayFetch(item.url);
    if(!decision.allowed){ errors.push(`robots disallowed ${item.url}`); continue }
    visited.add(item.url); visitedKeys.add(crawlKey(item.url));
    let response;
    try { response = await get(item.url) }
    catch(err){ errors.push(`${item.url}: ${err.message}`); continue }
    if(response.status >= 400){ errors.push(`${item.url}: HTTP ${response.status}`); continue }
    if(!/html|xml|text\//i.test(response.contentType)) continue;
    const html = textOf(response), title = pageTitle(html);
    const pageScore = scoreCandidate(`${title} ${visibleText(html).slice(0, 12000)} ${response.finalUrl}`);
    if(pageScore.score >= 5 && relevant(pageScore)){
      const record = candidateRecord({url:item.url, label:title, from:item.from, officialOrigins, response});
      record.score = Math.max(record.score, pageScore.score);
      record.reasons = [...new Set([...record.reasons, ...pageScore.reasons])];
      candidates.set(record.url, record);
    }

    for(const link of parseLinks(html, response.finalUrl)){
      const combined = `${link.text} ${decodeURIComponent(link.url)}`;
      const scored = scoreCandidate(combined);
      const file = /\.(csv|json|xml|xlsx?|pdf)(?:$|\?)/i.test(link.url);
      if((scored.score >= 5 && relevant(scored)) || (file && scored.score >= 2 && relevant(scored))){
        const record = candidateRecord({url:link.url, label:link.text, from:response.finalUrl, officialOrigins});
        const old = candidates.get(record.url);
        if(!old || record.score > old.score) candidates.set(record.url, record);
      }
      if(item.depth >= 2 || queued.has(crawlKey(link.url))) continue;
      const sameOrigin = officialOrigins.has(new URL(link.url).origin);
      const navigation = /くらし|生活|環境|清掃|オープンデータ|open\s*data/i.test(link.text);
      if(sameOrigin && !file && ((scored.score >= 3 && relevant(scored)) || (item.depth === 0 && navigation))){
        queue.push({url:link.url, depth:item.depth + 1, from:response.finalUrl});
        queued.add(crawlKey(link.url));
      }
    }
    queue.sort((a, b) => scoreCandidate(decodeURIComponent(b.url)).score - scoreCandidate(decodeURIComponent(a.url)).score);
  }

  const sorted = [...candidates.values()].sort((a, b) => b.score - a.score || a.url.localeCompare(b.url));
  const fingerprints = new Set();
  const unique = sorted.filter(candidate => {
    const fingerprint = candidate.sha256 ? `content:${candidate.sha256}` : `url:${candidate.url}`;
    if(fingerprints.has(fingerprint)) return false;
    fingerprints.add(fingerprint); return true;
  });
  return {
    code:city.code, pref:city.pref, jp:city.jp, en:city.en,
    officialHomepage:home ?? null,
    openData:openData ? {urls:openData.urls, api:openData.api, license:openData.license} : null,
    seeds,
    crawledAt:new Date().toISOString(),
    crawler:{userAgent:UA, delayMs:requestDelayMs, maxPages, robots},
    pagesVisited:visited.size,
    candidates:unique.slice(0, 30),
    errors:[...new Set(errors)].slice(0, 30),
  };
}

async function pool(items, fn, n){
  const out = new Array(items.length); let next = 0;
  async function worker(){
    for(;;){ const i = next++; if(i >= items.length) return; out[i] = await fn(items[i], i) }
  }
  await Promise.all(Array.from({length:Math.min(n, items.length)}, worker));
  return out;
}

export async function main(){
  const code = option("code");
  const pref = option("pref");
  const allCities = await listCities();
  let cities = allCities.filter(city => !code || city.code === code).filter(city => !pref || city.pref === pref);
  if(!flag("include-covered")) cities = cities.filter(city => !covered.has(city.code));
  cities.sort((a, b) => a.pref.localeCompare(b.pref) || a.code.localeCompare(b.code));
  if(!flag("all")) cities = cities.slice(0, requestedLimit);
  if(!cities.length) throw new Error("no municipalities match (covered municipalities are skipped unless --include-covered is set)");

  console.log(`resolving authoritative URLs for ${cities.length} municipalities...`);
  const [directory, homes] = await Promise.all([
    openDataDirectory(),
    jlisOfficialHomes(cities).catch(err => {
      console.warn(`J-LIS official-site directory unavailable: ${err.message}`);
      return new Map();
    }),
  ]);
  const results = await pool(cities, async (city, i) => {
    console.log(`[${i + 1}/${cities.length}] ${city.code} ${city.jp}`);
    const openData = directory.get(city.code);
    const derivedHome = openData?.urls.find(url => /\.(?:lg|go)\.jp$|\.city\.|\.town\.|\.vill\./i.test(new URL(url).hostname));
    const home = homes.get(city.code) ?? (derivedHome ? `${new URL(derivedHome).origin}/` : null);
    try { return await crawlMunicipality(city, home, openData) }
    catch(err){ return {code:city.code, pref:city.pref, jp:city.jp, en:city.en, seeds:[], pagesVisited:0, candidates:[], errors:[err.message]} }
  }, concurrency);

  const crawledCodes = new Set(results.map(row => row.code));
  const kept = fs.existsSync(OUT) && !refresh
    ? (readJSON(OUT).municipalities ?? []).filter(row => !crawledCodes.has(row.code))
    : [];
  const municipalities = [...kept, ...results]
    .sort((a, b) => a.pref.localeCompare(b.pref) || a.code.localeCompare(b.code));
  const report = {
    _readme:"Discovery candidates from authoritative municipality websites/catalogs. This file is review input, never a shipping source.",
    version:new Date().toISOString().slice(0, 10),
    generatedAt:new Date().toISOString(),
    sources:SOURCES,
    filters:{code:code || null, pref:pref || null, includeCovered:flag("include-covered"), all:flag("all"), limit:flag("all") ? null : requestedLimit},
    municipalities,
  };
  writeJSON(OUT, report);
  const candidateCount = results.reduce((sum, row) => sum + row.candidates.length, 0);
  console.log(`wrote ${candidateCount} candidates for ${results.length} municipalities → ${path.relative(ROOT, OUT)}`);
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if(invoked) main().catch(err => { console.error(err.stack ?? err.message); process.exitCode = 1 });
