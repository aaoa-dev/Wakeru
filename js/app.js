/* Data: static JSON under data/ (built by npm run import). At runtime we fetch the index, shared guides, then only the
   user's municipality JSON; sorting dictionaries load when you search. GSI reverse geocoding is optional for "Locate me". */
import { dayState, binsOn, iso } from "./schedule.js";
import { runOnboarding } from "./onboarding.js";

const BIN_COLOR = {burn:"--c-burn",non:"--c-non",res:"--c-res",pla:"--c-pla",haz:"--c-haz",big:"--c-big",no:"--c-no"};
const DEFAULT_CITY = "chiyoda", DICT_LIMIT = 40, QUICK_LIMIT = 10;
const $ = s => document.querySelector(s);
const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"], DOWJ = ["日","月","火","水","木","金","土"], ORD = ["","1st","2nd","3rd","4th","5th"];
const store = {get(k){try{return localStorage.getItem(k)}catch(e){return null}}, set(k,v){try{localStorage.setItem(k,v)}catch(e){}}};
const kataToHira = s => s.replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
const norm = s => kataToHira((s||"").toLowerCase().normalize("NFKC"));
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
const shortDate = d => `${d.getMonth()+1}/${d.getDate()}`;
const link = (url, text) => `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(text)}</a>`;
let DATA, RS, DICT, AREA, ITEMS = [], LOADING = 0, SEARCHING = 0, NEXT_BY_BIN = {}, RENDERED_DAY = "";
const icon = d => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const CLOCK = icon(`<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>`);
const CHEVRON = icon(`<path d="M9 5l7 7-7 7"/>`);

async function getJSON(path){
  const res = await fetch(path);
  if(!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}
/* Per-city cache: schedule JSON always; sorting dict loaded on demand (can be 100KB+). */
const CITIES = {};
const cityCache = entry => CITIES[entry.id] ??= {rs:null, dict:null, rsPromise:null, dictPromise:null};
async function loadCity(entry){
  const cache = cityCache(entry);
  if(!cache.rsPromise){
    cache.rsPromise = getJSON(`data/municipalities/${entry.path}/municipality.json`)
      .then(rs => cache.rs = rs)
      .catch(err => { cache.rsPromise = null; throw err });
  }
  const rs = cache.rs ?? await cache.rsPromise;
  return [rs, cache.dict];
}
async function ensureDict(){
  if(DICT || !RS || !DATA) return DICT;
  const entry = DATA.cities.find(c => c.id === RS.id);
  if(!entry?.dictionary) return null;
  const cache = cityCache(entry);
  if(!cache.dictPromise){
    cache.dictPromise = getJSON(`data/municipalities/${entry.path}/dictionary.json`)
      .then(dict => {
        dict.index = dict.items.map(([name,,,keywords]) => [norm(name), norm(keywords)]);
        return cache.dict = dict;
      })
      .catch(err => { cache.dictPromise = null; throw err });
  }
  const dict = cache.dict ?? await cache.dictPromise;
  if(RS?.id !== entry.id) return null;
  DICT = dict;
  $("#footSrc").innerHTML = footerHTML();
  return DICT;
}
function showError(err){
  const html = `<div class="empty">Couldn't load the trash data (${esc(err.message)}). Reload the page to try again.</div>`;
  $("#today").innerHTML = html;
}

const binOf = (bin, rs = RS) => rs.bins[bin] || {en:bin,label:"",kind:"no"};
const chipHTML = (kind, en, label) => `<span class="chip" style="--cc:var(${BIN_COLOR[kind]||"--c-no"})"><i></i><span class="chip-text">${esc(en)}${label ? ` <small>${esc(label)}</small>` : ""}</span></span>`;
const chip = (bin, rs = RS) => { const b = binOf(bin, rs); return chipHTML(b.kind, b.en, b.label) };
/* Schedule chips open the matching sorting guide. Keep unsupported kinds as plain labels. */
function scheduleChip(bin, rs = RS){
  const b = binOf(bin, rs);
  if(!GUIDE_KINDS.includes(b.kind)) return chip(bin, rs);
  return `<button type="button" class="chip schedule-chip" data-sort-kind="${esc(b.kind)}" aria-label="View ${esc(b.en)} sorting details" style="--cc:var(${BIN_COLOR[b.kind]||"--c-no"})"><i></i><span class="chip-text">${esc(b.en)}${b.label ? ` <small>${esc(b.label)}</small>` : ""}</span></button>`;
}
/* turn an item's material types into this city's bins; null when the city's guide doesn't cover one of its types */
function resolve(it){
  const outs = [];
  for(const o of it.outcomes){
    const r = RS.sorting[o.type]; if(!r) return null;
    const bin = typeof r === "string" ? r : r.bin, note = typeof r === "string" ? "" : r.note;
    const same = outs.find(x => x.bin === bin);
    if(same){ same.when = ""; continue }
    outs.push({bin, when:o.when||"", note, auto:!!r.auto});
  }
  return {...it, outs};
}

/* ---------- sort view ---------- */
function itemHTML(it){
  const outs = it.outs.map(o => { const next = NEXT_BY_BIN[o.bin];
    return `<div class="outcome">${chip(o.bin)}${next ? `<span class="next">Next: <b>${esc(whenLabel(next))}</b></span>` : ""}<span class="when">${o.when}</span></div>` }).join("");
  const notes = [it.how, ...it.outs.map(o=>o.note)].filter(Boolean).join(" ");
  const auto = it.outs.some(o => o.auto) ? `<p class="fine">Auto-matched from ${esc(RS.jp)}'s list. Check the official list below.</p>` : "";
  return `<article class="item"><div class="item-name"><b>${it.en}</b><span>${it.jp}</span></div><div class="outcomes">${outs}</div>${notes?`<p class="how">${esc(notes)}</p>`:""}${auto}</article>`;
}
function dictItemHTML([name, cat, note]){
  const c = DICT.categories[cat];
  return `<article class="item"><div class="item-name"><b lang="ja">${esc(name)}</b></div>
    <div class="outcomes"><div class="outcome">${c.bins.map(b => chip(b)).join("")}<span class="when" lang="ja">${esc(c.label)}</span></div></div>
    ${note?`<p class="how" lang="ja">${esc(note)}</p>`:""}</article>`;
}
function showResults(list, title, dictHits = []){
  ["#home","#quickWrap","#catWrap"].forEach(s=>$(s).hidden=true);
  $("#resultsWrap").hidden = false; $("#resTitle").textContent = title;
  $("#results").innerHTML = list.length ? list.map(itemHTML).join("")
    : dictHits.length ? `<div class="empty">No English guide entry for this. ${esc(RS.en)}'s own list below has a match.</div>`
    : `<div class="empty">Nothing matched. Try a simpler word (e.g. "tray", "bag", "電池")${DICT ? "" : `, or check ${esc(RS.jp)}'s official sorting page linked at the bottom`}.</div>`;
  $("#dictWrap").hidden = !dictHits.length;
  if(!dictHits.length) return;
  const via = DICT.provider ? ` via ${DICT.provider.name}` : "";
  $("#dictTitle").textContent = `${RS.en}'s official list (${dictHits.length === DICT_LIMIT ? `top ${DICT_LIMIT}` : dictHits.length})`;
  $("#dictNote").textContent = `Item names and notes in Japanese, from ${RS.jp}'s sorting list${via} (updated ${DICT.updated.split(" ")[0]}). The category is the city's own; a colour is shown only where it matches one of the city's bins.`;
  $("#dict").innerHTML = dictHits.map(dictItemHTML).join("");
}
function showHome(){
  ["#home","#catWrap"].forEach(s=>$(s).hidden=false); ["#resultsWrap","#dictWrap"].forEach(s=>$(s).hidden=true);
  $("#quickWrap").hidden = !ITEMS.some(i => i.quick);
}
function searchDict(words){
  if(!DICT) return [];
  return DICT.index.map(([name, keywords], i) => {
    let s = 0; for(const w of words){ if(name.includes(w)) s += 3; else if(keywords.includes(w)) s += 1; else return null }
    return [s - name.length/100, i];
  }).filter(Boolean).sort((a,b)=>b[0]-a[0]).slice(0, DICT_LIMIT).map(([,i]) => DICT.items[i]);
}
async function search(q){
  const token = ++SEARCHING, city = RS?.id;
  const nq = norm(q).trim(); if(!nq){showHome();return}
  const words = nq.split(/\s+/);
  const hits = ITEMS.map(it => {
    const hay = norm([it.en,it.jp,it.keywords,...it.outs.map(o=>binOf(o.bin).en+" "+binOf(o.bin).label)].join(" "));
    let s = 0; for(const w of words){ if(!hay.includes(w)) return null; s += (norm(it.en)+norm(it.jp)).includes(w) ? 3 : 1 }
    return [s,it];
  }).filter(Boolean).sort((a,b)=>b[0]-a[0]).map(x=>x[1]);
  const title = `${hits.length} result${hits.length===1?"":"s"} for "${q.trim()}"`;
  showResults(hits, title);
  try { await ensureDict() } catch(err) { console.warn("Official sorting dictionary unavailable", err); return }
  if(token !== SEARCHING || city !== RS?.id || norm($("#q").value).trim() !== nq) return;
  showResults(hits, title, searchDict(words));
}
const GUIDE_KINDS = ["burn", "pla", "res", "non", "haz"];
const binKeysForKind = (kind, rs = RS) => Object.keys(rs.bins).filter(k => rs.bins[k].kind === kind);
const firstBin = kind => binKeysForKind(kind)[0];

const SORT_GUIDES = {
  burn: {
    title: "Burnable check",
    lede: "Food, soiled paper, cloth and dirty plastic usually go here.",
    steps: [
      ["Drain or wipe off liquids", "Soggy messes leak in the truck. A quick squeeze or paper towel helps."],
      ["No batteries, spray cans or bulbs", "Those are hazardous or non-burnable, even if they're small."],
      ["Cut long items to about 50 cm", "Branches, hoses and fabric sheets over ~50 cm need cutting or oversized booking."],
    ],
  },
  res: {
    title: "Recyclables check",
    lede: "Bottles, cans and paper each have their own bundle or box.",
    steps: [
      ["Rinse drink bottles and cans", "A quick rinse is enough. Heavily oily or smelly ones go to burnable."],
      ["Sort paper by type", "Newspaper, magazines, cardboard and cartons don't go in the same bundle."],
      ["PET bottle bodies only", "Caps and labels often go to plastic; the clear bottle body goes to PET recycling."],
    ],
  },
  non: {
    title: "Non-burnable check",
    lede: "Metal, ceramics and small hard things — usually twice a month.",
    steps: [
      ["Metal, ceramic or hard glass?", "Pots, plates, mirrors and foil trays belong here, not burnable."],
      ["Small enough to fit in a bag?", "Larger items may need oversized garbage (粗大ごみ) with a sticker."],
      ["Remove batteries first", "Built-in or loose batteries go to hazardous collection, not this bag."],
    ],
  },
  haz: {
    title: "Hazardous check",
    lede: "Separate bag, often on non-burnable day, with キケン written on it.",
    steps: [
      ["Tape battery terminals", "Use clear tape on +/− ends. Swollen or damaged cells: call the city first."],
      ["Mark the bag キケン", "Blades, broken glass and thermometers need a visible danger label."],
      ["Never mix with plastic or burnable", "Even one battery in the wrong bag can stop the whole collection."],
    ],
  },
};

function plasticGuideSteps(pt){
  const pla = pt?.bin ?? firstBin("pla"), dirty = pt?.otherwise ?? firstBin("burn");
  const steps = [
    pt?.products !== false ? ["Is it 100% plastic?", "No metal, paper or rubber parts attached. Pump tops and wrap boxes with a cutter fail this."]
      : ["Is it packaging with the プラマーク?", `${RS.en} only takes plastic packaging. Plastic products like hangers, toys or cutlery fail this, even if they're 100% plastic.`],
    ["Is it empty and clean?", "Give it a quick rinse or wipe. Curry stains, oil or stuck rice that won't come off fail this."],
    ...(pt?.maxCm ? [[`Is it under ${pt.maxCm} cm?`, "Bigger than that is oversized garbage (粗大ごみ)."]] : []),
  ];
  return {steps, pla, dirty, summary: pt?.summary ?? "Clean, empty plastic packaging in a clear bag. Anything dirty or mixed goes to burnable."};
}

/* pill label: the name without its "(…)" detail, unless another item would then read the same (Egg carton (paper) / (plastic)) */
const shortName = it => it.en.replace(/ \(.*\)/, "");
let SHORT_COUNT = new Map();
const pillName = it => SHORT_COUNT.get(shortName(it)) > 1 ? it.en : shortName(it);

/* the coming days that have a pickup, as {i, d, ps} (i = days from today, ps = [[bin, "by 8:00"]…]) */
function upcoming(rs = RS, area = AREA, horizon = 60){
  const pat = rs.calendar.patterns[area.pattern], now = new Date(); now.setHours(0, 0, 0, 0);
  const out = [];
  for(let i = 0; i < horizon; i++){
    const d = new Date(now); d.setDate(now.getDate() + i);
    const ps = pickupsOn(d, pat, rs);
    if(Array.isArray(ps) && ps.length) out.push({i, d, ps});
  }
  return out;
}
const dayLabel = ({i, d}) => i === 0 ? "Today" : i === 1 ? "Tomorrow" : DOW[d.getDay()];
const whenLabel = u => u.i < 2 ? dayLabel(u) : `${DOW[u.d.getDay()]} ${shortDate(u.d)}`;
const dateTag = d => `<small>${shortDate(d)} (${DOWJ[d.getDay()]})</small>`;

function guideStepsHTML(steps){
  return `<ol>${steps.map(([q, no]) => `<li><div><b>${esc(q)}</b><span class="no">${esc(no)}</span></div></li>`).join("")}</ol>`;
}

/* every card is a tabpanel; the "next on your schedule" marker lives on its tab, so no card gets an extra line */
const guidePanel = (kind, isNext) => `class="guide-card card test${isNext ? " next" : ""}" id="gpanel-${kind}" role="tabpanel" aria-labelledby="gtab-${kind}" style="--guide-accent:var(${BIN_COLOR[kind] || "--c-no"})"`;
function guideCardHTML(kind, isNext){
  if(kind === "pla"){
    const {steps, pla, dirty, summary} = plasticGuideSteps(RS.plasticTest);
    const n = steps.length;
    return `<article ${guidePanel(kind, isNext)}>
      <h2>The plastic test ${chip(pla)}</h2>
      <p class="lede">Most takeout and konbini packaging comes down to a few questions. ${esc(summary)}</p>
      ${guideStepsHTML(steps)}
      <div class="verdict"><span>Yes to all ${n === 3 ? "three" : n === 4 ? "four" : "two"} →</span> ${chip(pla)} <span>Any no →</span> ${chip(dirty)}</div></article>`;
  }
  const g = SORT_GUIDES[kind]; if(!g) return "";
  const bin = firstBin(kind); if(!bin) return "";
  return `<article ${guidePanel(kind, isNext)}>
    <h2>${esc(g.title)} ${chip(bin)}</h2>
    <p class="lede">${esc(g.lede)}</p>
    ${guideStepsHTML(g.steps)}</article>`;
}

let GUIDE_ORDER = [], guideSlide = 0, guideDrag = null;

/* cards share one grid cell, so the area is always as tall as the tallest card and switching never moves the page */
function applyGuideSlide(focusTab = false){
  if(!GUIDE_ORDER.length) return;
  guideSlide = ((guideSlide % GUIDE_ORDER.length) + GUIDE_ORDER.length) % GUIDE_ORDER.length;
  [...$("#sortGuides").children].forEach((c, i) => c.classList.toggle("active", i === guideSlide));
  const tabs = [...$("#guideTabs").children];
  tabs.forEach((t, i) => { const on = i === guideSlide; t.setAttribute("aria-selected", on); t.tabIndex = on ? 0 : -1 });
  const tab = tabs[guideSlide], row = $("#guideTabs");
  if(tab && row.scrollWidth > row.clientWidth) /* keep the selected tab in view on narrow screens, without scrolling the page */
    row.scrollTo({left:tab.offsetLeft - (row.clientWidth - tab.offsetWidth) / 2, behavior:"smooth"});
  if(focusTab) tab?.focus();
}

function renderSortGuides(){
  const wrap = $("#sortGuidesWrap");
  if(!RS){ wrap.hidden = true; return }
  const kinds = GUIDE_KINDS.filter(k => binKeysForKind(k).length);
  if(!kinds.length){ wrap.hidden = true; return }
  const [next] = upcoming(RS, AREA, 40);
  const nextKinds = new Set(next ? next.ps.map(([b]) => binOf(b).kind) : []);
  const banner = $("#nextBanner");
  banner.hidden = !next;
  if(next) banner.innerHTML = `<span class="nb-when">${next.i === 0 ? "Pickup today" : "Next pickup"}<b>${esc(whenLabel(next))}</b></span>
    <span class="cs">${next.ps.map(([b]) => chip(b)).join("")}</span><span class="nb-go">${CHEVRON}<span class="sr">See pickup days</span></span>`;
  GUIDE_ORDER = [...kinds].sort((a, b) => Number(nextKinds.has(b)) - Number(nextKinds.has(a)) || GUIDE_KINDS.indexOf(a) - GUIDE_KINDS.indexOf(b));
  guideSlide = 0;
  $("#sortGuides").innerHTML = GUIDE_ORDER.map(k => guideCardHTML(k, nextKinds.has(k))).join("");
  $("#guideTabs").hidden = GUIDE_ORDER.length <= 1;
  $("#guideTabs").innerHTML = GUIDE_ORDER.map((k, i) =>
    `<button type="button" role="tab" class="guide-tab" id="gtab-${k}" aria-controls="gpanel-${k}" data-guide-tab="${i}" style="--cc:var(${BIN_COLOR[k]})"><i aria-hidden="true"></i><span class="guide-tab-text">${esc(binOf(firstBin(k)).en)}${nextKinds.has(k) ? `<small>Next</small>` : ""}</span></button>`).join("");
  applyGuideSlide();
  wrap.hidden = false;
}

/* ---------- schedule ---------- */
/* [[bin, "by 8:00"]] for a day, or a dayState string ("off", "unconfirmed", "unpublished") */
function pickupsOn(d, pattern, rs = RS){
  const by = rs.calendar.putOutBy;
  const bins = binsOn(rs.calendar, pattern, d);
  if(bins.length) return bins.map(bin => [bin, by ? "by " + (by[bin] || "8:00") : ""]);
  return dayState(rs.calendar, d) || [];
}
function ruleText(r){
  if(Array.isArray(r)) return r.map(d=>DOW[d]).join(" & ");
  if(r.any) return r.any.map(ruleText).join(" + ");
  if(r.days) return r.days.map(d=>DOW[d]).join(" & ");
  if(r.dates){
    const count = [0,0,0,0,0,0,0]; r.dates.forEach(s => count[new Date(s+"T00:00").getDay()]++);
    const gaps = r.dates.slice(1).map((s, i) => (new Date(s) - new Date(r.dates[i])) / 864e5);
    return gaps.filter(g => g === 14).length >= gaps.length * 0.7 ? `every other ${DOW[count.indexOf(Math.max(...count))]}` : "on set dates";
  }
  return r.weeks.map(n=>ORD[n]).join(" & ") + " " + DOW[r.day];
}
/* one row per bin: chip + its regular days */
const legendHTML = (rs, area, interactive = false) => Object.entries(rs.calendar.patterns[area.pattern]).filter(([, r]) => r)
  .map(([bin, r]) => `<div class="legend-row">${interactive ? scheduleChip(bin, rs) : chip(bin, rs)}<span>${esc(ruleText(r))}</span></div>`).join("");
/* "Out by 8:30" when the bins share a time, otherwise one time per bin; "(see your sign)"-style asides stay unbolded */
const timeHTML = t => esc(t.replace(/^by /, "")).replace(/^(.*?)(\s*\(.*\))?$/, (_, a, b = "") => `<b>${a}</b>${b}`);
function byLine(ps, rs = RS){
  const timed = ps.filter(([, t]) => t);
  if(!timed.length) return "";
  const same = timed.length === ps.length && timed.every(([, t]) => t === timed[0][1]);
  const body = same ? `Out by ${timeHTML(timed[0][1])}` : timed.map(([b, t]) => `${esc(binOf(b, rs).en)} by ${timeHTML(t)}`).join(" · ");
  return `<p class="by-line">${CLOCK}<span>${body}</span></p>`;
}
const none = text => `<span class="none">${text}</span>`;
const SHORT = {off:"No collection", unconfirmed:"Not confirmed yet", unpublished:"Not published yet"};
const LONG = {off:"No collection (Sunday or New Year break)", unconfirmed:"Not confirmed yet: watch for the city's New Year notice", unpublished:"The city hasn't published this date yet"};
const dayRow = (r, rs = RS, nextI = -1, interactive = false) => `<div class="day${r.i === 0 ? " is-today" : ""}${r.i === nextI ? " is-next" : ""}"><div class="d"><b>${r.label}</b>${shortDate(r.d)} ${DOWJ[r.d.getDay()]}</div>
  <div class="cs">${Array.isArray(r.ps) && r.ps.length ? r.ps.map(([c])=>interactive ? scheduleChip(c, rs) : chip(c, rs)).join("") : none(SHORT[r.ps] ?? "Nothing")}</div></div>`;
const areaName = a => a.en === "All" ? a.townEn : `${a.townEn} ${a.en}`;
const areaNameJP = a => a.jp === "全域" ? a.town : `${a.town}${a.jp}`;
/* the next days for an area, as {d, ps, label} rows */
function nextDays(rs, area, count){
  const now = new Date(); now.setHours(0,0,0,0);
  return [...Array(count)].map((_, i) => { const d = new Date(now); d.setDate(now.getDate()+i);
    return {i, d, ps:pickupsOn(d, rs.calendar.patterns[area.pattern], rs), label:dayLabel({i, d})} });
}
/* onboarding's last step: where the user is and what's coming up */
const describe = (rs, area) => `<div class="place">${esc(areaName(area))}<small lang="ja">${esc(area.town + (area.jp === "全域" ? "" : area.jp))} · ${esc(rs.jp)}</small></div>
  <div class="week">${nextDays(rs, area, 3).map(r => dayRow(r, rs)).join("")}</div>
  <div class="legend">${legendHTML(rs, area)}</div>`;

/* the area picked in the onboarding ("town|en"); the city's first area if it's missing or no longer exists */
function restoreArea(){
  const [town, en] = (store.get("wakeru-area-"+RS.id) || "").split("|");
  const list = RS.areas.filter(a => a.town === town);
  AREA = list.find(a => a.en === en) ?? list[0] ?? RS.areas[0];
}
/* the card leads with the next pickup; today's own status is a line under it when today has none */
function renderDays(){
  const whereEn = `${areaName(AREA)}, ${RS.en}`, whereJp = areaNameJP(AREA);
  $("#whereText").textContent = whereEn;
  $("#whereTextJp").textContent = whereJp;
  $("#where").setAttribute("aria-label", `Change location from ${whereEn}`);
  const rows = nextDays(RS, AREA, 7), coming = upcoming(), [next, then] = coming, [today] = rows;
  NEXT_BY_BIN = {}; for(const u of coming) for(const [b] of u.ps) NEXT_BY_BIN[b] ??= u;
  RENDERED_DAY = iso(today.d);
  $("#areaNote").hidden = !AREA.note; $("#areaNote").textContent = AREA.note || "";
  const cs = ps => `<div class="cs">${ps.map(([c]) => scheduleChip(c)).join("")}</div>`;
  const status = text => `<p class="today-status">${text}</p>`;
  let html;
  if(!next) html = `<p class="eyebrow">Next pickup</p><div class="date">None published yet</div>
    ${status(`The city hasn't published upcoming dates for ${esc(areaName(AREA))}. Check the official page linked at the bottom.`)}`;
  else {
    html = `<p class="eyebrow">${next.i === 0 ? "Pickup today" : "Next pickup"}</p>
      <div class="date">${dayLabel(next)}${dateTag(next.d)}</div>${cs(next.ps)}${byLine(next.ps)}`;
    if(next.i > 0) html += status(`Today: ${esc(LONG[today.ps] ?? "nothing collected")}`);
    else if(then) html += status(`Then ${esc(whenLabel(then))}: ${then.ps.map(([b]) => esc(binOf(b).en)).join(", ")}`);
  }
  $("#today").innerHTML = html;
  $("#week").innerHTML = rows.map(r => dayRow(r, RS, next?.i ?? -1, true)).join("");
  $("#legend").innerHTML = legendHTML(RS, AREA, true);
  $("#icsBtn").closest(".cal-export").hidden = !next;
  renderSortGuides();
}

/* ---------- calendar export (.ics, all-day events for every published pickup in the next year) ---------- */
const enc = new TextEncoder();
function fold(line){ /* RFC 5545: lines over 75 octets continue on the next line after a space */
  let out = "", cur = "", n = 0;
  for(const ch of line){ const b = enc.encode(ch).length; if(n + b > 74){ out += cur + "\r\n "; cur = ""; n = 1 } cur += ch; n += b }
  return out + cur;
}
function icsText(){
  const pat = RS.calendar.patterns[AREA.pattern], now = new Date(); now.setHours(0, 0, 0, 0);
  const text = v => String(v).replace(/[\\;,]/g, m => "\\" + m).replace(/\n/g, "\\n");
  const ymd = d => iso(d).replace(/-/g, ""), stamp = new Date().toISOString().replace(/[-:]|\.\d+/g, "");
  const place = `${areaName(AREA)}, ${RS.en}`;
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Wakeru//Gomi calendar//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${text(`Gomi · ${place}`)}`];
  for(let i = 0; i < 366; i++){
    const d = new Date(now); d.setDate(now.getDate() + i);
    const ps = pickupsOn(d, pat);
    if(!Array.isArray(ps) || !ps.length) continue;
    const end = new Date(d); end.setDate(d.getDate() + 1);
    const by = ps.filter(([, t]) => t).map(([b, t]) => `${binOf(b).en} ${t}`).join("; ");
    lines.push("BEGIN:VEVENT", `UID:${ymd(d)}-${RS.id}-${AREA.pattern}@wakeru`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${ymd(d)}`, `DTEND;VALUE=DATE:${ymd(end)}`,
      `SUMMARY:${text(`Gomi: ${ps.map(([b]) => binOf(b).en).join(", ")}`)}`,
      `DESCRIPTION:${text(`${by ? by + ". " : ""}${place}. Your collection point's sign has the final word.`)}`, "TRANSP:TRANSPARENT", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
function downloadICS(){
  const url = URL.createObjectURL(new Blob([icsText()], {type:"text/calendar;charset=utf-8"}));
  const a = Object.assign(document.createElement("a"), {href:url, download:`wakeru-${RS.id}.ics`});
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- municipality ---------- */
function footerHTML(){
  const s = RS.attribution?.schedule;
  const links = [link(RS.sources[0], "official page"), ...(DICT ? [link(DICT.source, "sorting list")] : [])];
  const parts = [s
    ? `Collection days from ${link(s.url, s.name)} (${esc(s.license)}, ${esc(s.commit)}), converted from ${esc(RS.jp)}'s official calendar and checked by its maintainers; extracted ${esc(RS.verified)}.`
    : `Based on ${esc(RS.jp)}'s official guidance, checked on ${esc(RS.verified)}.`];
  if(DICT?.provider) parts.push(`Sorting list: ${esc(RS.jp)} (${link(DICT.source, "official page")}), via ${link(DICT.provider.page, DICT.provider.name)}.`);
  if(Object.values(RS.sorting).some(r => r.auto)) parts.push("English guide entries are auto-matched from that list.");
  parts.push(`Rules change, and the city has the final word: ${links.join(" · ")}.`);
  parts.push(RS.contacts.filter(c => c.tel).map(c => `${esc(c.en)}: <a href="tel:${esc(c.tel.replace(/[^\d+]/g, ""))}">${esc(c.tel)}</a>`).join(" · "));
  parts.push(`"Locate me" sends your position only to the ${link("https://maps.gsi.go.jp/development/api.html", "GSI reverse geocoder")}. Your area is saved on this device only.`);
  return parts.filter(Boolean).map(p => `<p>${p}</p>`).join("");
}
async function setCity(id){
  const entry = DATA.cities.find(w=>w.id===id) || DATA.cities[0];
  const token = ++LOADING;
  const [rs, dict] = await loadCity(entry);
  if(token !== LOADING) return; // another city was picked while this one was loading
  SEARCHING++;
  RS = rs; DICT = dict ?? null;
  store.set("wakeru-city", RS.id);
  ITEMS = DATA.items.map(resolve).filter(Boolean);
  SHORT_COUNT = ITEMS.reduce((m, it) => m.set(shortName(it), (m.get(shortName(it)) ?? 0) + 1), new Map());
  renderQuick(false);
  $("#cats").innerHTML = Object.keys(RS.bins).map(c => `<button type="button" class="bin-pill" data-c="${c}" style="--cc:var(${BIN_COLOR[RS.bins[c].kind] || "--c-no"})"><i aria-hidden="true"></i><span class="pill-text">${esc(RS.bins[c].en)} <small>${esc(RS.bins[c].label)}</small></span></button>`).join("");
  restoreArea();
  const validTo = RS.calendar.validTo ? ` Dates are published through ${RS.calendar.validTo}.` : "";
  $("#schedNote").textContent = `${RS.calendar.note || ""}${validTo} Your collection point's sign has the final word.`;
  $("#terms").innerHTML = DATA.glossary.map(t=>`<div class="term"><div class="jp">${t.jp}<small>${t.reading}</small></div>${chipHTML(t.bin, t.en, "")}<p>${t.meaning}</p><div class="aka">Elsewhere: <b>${t.elsewhere}</b></div></div>`).join("");
  $("#footSrc").innerHTML = footerHTML();
  renderDays(); search($("#q").value);
}
/* konbini presets: first QUICK_LIMIT shown until "Show all" */
function renderQuick(expanded){
  const quick = ITEMS.map((it, n) => [it, n]).filter(([it]) => it.quick);
  $("#quick").innerHTML = quick.map(([it, n], k) =>
    `<button type="button" data-i="${n}"${!expanded && k >= QUICK_LIMIT ? " hidden" : ""}><span class="pill-text">${esc(pillName(it))}</span></button>`).join("");
  const more = $("#quickMore");
  more.hidden = quick.length <= QUICK_LIMIT;
  more.textContent = expanded ? "Show fewer" : `Show all ${quick.length}`;
  more.setAttribute("aria-expanded", expanded);
}
/* the onboarding saves city + area; without a saved city it opens on first visit, and "Change" reopens it */
async function chooseLocation(){
  const current = RS && AREA ? {id:RS.id, town:AREA.town} : null;
  const picked = await runOnboarding({cities:DATA.cities, loadCity, describe, current});
  if(!picked) return RS ? undefined : setCity(DEFAULT_CITY);
  store.set("wakeru-city", picked.id);
  store.set("wakeru-area-"+picked.id, `${picked.town}|${picked.en}`);
  await setCity(picked.id);
}
async function init(){
  const [items, glossary, index] = await Promise.all([
    getJSON("data/shared/items.json"), getJSON("data/shared/glossary.json"), getJSON("data/municipalities.json")
  ]);
  DATA = {items, glossary, cities:index.municipalities};
  const saved = store.get("wakeru-city") ?? store.get("wakeru-ward");
  if(DATA.cities.some(c => c.id === saved)) await setCity(saved);
  else await chooseLocation();
}

/* ---------- events ---------- */
$("#where").addEventListener("click", () => chooseLocation().catch(showError));
$("#q").addEventListener("input", e => { switchView("sort"); if(RS) search(e.target.value).catch(showError) });
$("#v-days").addEventListener("click", e => {
  const type = e.target.closest("[data-sort-kind]");
  if(!type) return;
  const selected = GUIDE_ORDER.indexOf(type.dataset.sortKind);
  if(selected < 0) return;
  $("#q").value = "";
  showHome();
  switchView("sort");
  guideSlide = selected;
  applyGuideSlide();
  window.scrollTo({top:0});
});
/* presets get a history entry so the browser/phone back gesture returns to the sort home instead of leaving the site */
function openPreset(list, title){
  showResults(list, title); window.scrollTo({top:0});
  if(!history.state?.results) history.pushState({results:true}, "");
}
function closeResults(){ $("#q").value = ""; showHome(); window.scrollTo({top:0}) }
$("#quick").addEventListener("click", e => { const b = e.target.closest("button"); if(!b) return; const it = ITEMS[+b.dataset.i]; openPreset([it], it.en) });
$("#sortGuidesWrap").addEventListener("click", e => {
  const tab = e.target.closest("[data-guide-tab]");
  if(tab){ guideSlide = +tab.dataset.guideTab; applyGuideSlide(); return }
  if(e.target.closest("#nextBanner")){ switchView("days"); window.scrollTo({top:0}) }
});
$("#quickMore").addEventListener("click", e => renderQuick(e.currentTarget.getAttribute("aria-expanded") !== "true"));
$("#icsBtn").addEventListener("click", () => { if(RS && AREA) downloadICS() });
/* the date moves on while a tab sits open: re-render when coming back on a new day */
document.addEventListener("visibilitychange", () => { if(document.visibilityState === "visible" && RS && AREA && iso(new Date()) !== RENDERED_DAY){ renderDays(); search($("#q").value) } });
/* swipe a card to move between bins (touch only, so text in the cards stays selectable with a mouse) */
const guideStack = $("#sortGuides");
guideStack.addEventListener("pointerdown", e => {
  if(GUIDE_ORDER.length <= 1 || e.pointerType === "mouse" || e.target.closest("button")) return;
  guideDrag = {x: e.clientX, id: e.pointerId};
});
guideStack.addEventListener("pointerup", e => {
  if(!guideDrag || guideDrag.id !== e.pointerId) return;
  const dx = e.clientX - guideDrag.x;
  guideDrag = null;
  if(Math.abs(dx) < 48) return;
  guideSlide += dx < 0 ? 1 : -1;
  applyGuideSlide();
});
guideStack.addEventListener("pointercancel", () => { guideDrag = null });
$("#guideTabs").addEventListener("keydown", e => {
  const to = {ArrowRight:guideSlide + 1, ArrowLeft:guideSlide - 1, Home:0, End:GUIDE_ORDER.length - 1}[e.key];
  if(to === undefined) return;
  e.preventDefault(); guideSlide = to; applyGuideSlide(true);
});
$("#cats").addEventListener("click", e => { const b = e.target.closest("button"); if(!b) return; const c = b.dataset.c;
  openPreset(ITEMS.filter(i=>i.outs.some(o=>o.bin===c)), `Things that can go in ${RS.bins[c].en} (${RS.bins[c].label})`) });
$("#resBack").addEventListener("click", () => history.state?.results ? history.back() : closeResults());
window.addEventListener("popstate", closeResults);
function switchView(v){
  document.querySelectorAll("nav.tabs button").forEach(b => { const on = b.dataset.v === v; b.setAttribute("aria-selected", on); b.tabIndex = on ? 0 : -1 });
  ["sort","days","words"].forEach(x=>$("#v-"+x).hidden = x!==v);
}
const openTab = b => { switchView(b.dataset.v); if(b.dataset.v === "sort" && !$("#q").value) showHome() };
document.querySelector("nav.tabs").addEventListener("click", e => { const b = e.target.closest("button"); if(b) openTab(b) });
/* WAI-ARIA tabs: arrows / Home / End move between tabs */
document.querySelector("nav.tabs").addEventListener("keydown", e => {
  const tabs = [...document.querySelectorAll("nav.tabs button")], i = tabs.indexOf(document.activeElement);
  const to = {ArrowRight:i + 1, ArrowLeft:i - 1, Home:0, End:tabs.length - 1}[e.key];
  if(i < 0 || to === undefined) return;
  e.preventDefault();
  const b = tabs[(to + tabs.length) % tabs.length]; openTab(b); b.focus();
});

/* ---------- theme: system → light → dark ---------- */
const THEMES = {
  system:{label:"match system", bg:null, svg:`<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>`},
  light:{label:"light", bg:"#f6f6f4", svg:`<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>`},
  dark:{label:"dark", bg:"#111111", svg:`<path d="M19.5 14.5A8 8 0 1 1 9.5 4.5a6.5 6.5 0 0 0 10 10z"/>`},
};
function applyTheme(t){
  if(!THEMES[t]) t = "system";
  if(t === "system") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.content = THEMES[t].bg ?? (m.media.includes("dark") ? THEMES.dark.bg : THEMES.light.bg));
  const btn = $("#theme"); btn.querySelector("svg").innerHTML = THEMES[t].svg;
  btn.dataset.t = t; btn.setAttribute("aria-label", `Theme: ${THEMES[t].label}`); btn.title = `Theme: ${THEMES[t].label}`;
}
applyTheme(store.get("wakeru-theme"));
$("#theme").addEventListener("click", e => {
  const keys = Object.keys(THEMES), t = keys[(keys.indexOf(e.currentTarget.dataset.t) + 1) % keys.length];
  store.set("wakeru-theme", t); applyTheme(t);
});
init().catch(showError);
/* offline + installable: the service worker keeps the app shell and the data you've opened */
if("serviceWorker" in navigator) addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(err => console.warn("Offline support unavailable", err)));
