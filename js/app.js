/* Data: static JSON under data/ (built by npm run import). At runtime we fetch the index, shared guides, then only the
   user's municipality JSON; sorting dictionaries load when you search. GSI reverse geocoding is optional for "Locate me". */
import { dayState, binsOn } from "./schedule.js";
import { runOnboarding } from "./onboarding.js";

const BIN_COLOR = {burn:"--c-burn",non:"--c-non",res:"--c-res",pla:"--c-pla",haz:"--c-haz",big:"--c-big",no:"--c-no"};
const DEFAULT_CITY = "chiyoda", DICT_LIMIT = 40;
const $ = s => document.querySelector(s);
const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"], DOWJ = ["日","月","火","水","木","金","土"], ORD = ["","1st","2nd","3rd","4th","5th"];
const store = {get(k){try{return localStorage.getItem(k)}catch(e){return null}}, set(k,v){try{localStorage.setItem(k,v)}catch(e){}}};
const kataToHira = s => s.replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
const norm = s => kataToHira((s||"").toLowerCase().normalize("NFKC"));
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
const shortDate = d => `${d.getMonth()+1}/${d.getDate()}`;
const link = (url, text) => `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(text)}</a>`;
let DATA, RS, DICT, AREA, ITEMS = [], LOADING = 0, SEARCHING = 0;

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
    cache.rsPromise = getJSON(`data/municipalities/${entry.id}.json`)
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
    cache.dictPromise = getJSON(`data/municipalities/${entry.id}.dict.json`)
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
  const outs = it.outs.map(o => `<div class="outcome">${chip(o.bin)}<span class="when">${o.when}</span></div>`).join("");
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

function itemsForKind(kind, limit = 5){
  const keys = new Set(binKeysForKind(kind));
  return ITEMS.map((it, i) => [it, i]).filter(([it]) => it.outs.some(o => keys.has(o.bin))).slice(0, limit);
}

function nextPickupInfo(rs = RS, area = AREA){
  if(!rs || !area) return null;
  const pat = rs.calendar.patterns[area.pattern];
  const now = new Date(); now.setHours(0, 0, 0, 0);
  for(let i = 0; i < 40; i++){
    const d = new Date(now); d.setDate(now.getDate() + i);
    const ps = pickupsOn(d, pat, rs);
    if(typeof ps === "string" || !Array.isArray(ps) || !ps.length) continue;
    const label = i === 0 ? "Today" : i === 1 ? "Tomorrow" : `${shortDate(d)} (${DOWJ[d.getDay()]})`;
    const by = ps.map(([, t]) => t).filter((v, j, a) => v && a.indexOf(v) === j).join("; ");
    return {label, bins: ps.map(([b]) => b), by: by || null};
  }
  return null;
}

function guideStepsHTML(steps){
  return `<ol>${steps.map(([q, no]) => `<li><div><b>${esc(q)}</b><span class="no">${esc(no)}</span></div></li>`).join("")}</ol>`;
}

function guideQuickHTML(kind){
  const picks = itemsForKind(kind);
  if(!picks.length) return "";
  const label = kind === "pla" ? "Common packaging" : "Examples in the guide";
  return `<p class="fine guide-examples">${esc(label)}</p><div class="quick">${picks.map(([it, i]) =>
    `<button type="button" data-guide-i="${i}"><span class="pill-text">${esc(it.en.replace(/ \(.*\)/, ""))}</span></button>`).join("")}</div>`;
}

function guideCardHTML(kind, isNext){
  const color = BIN_COLOR[kind] || "--c-no";
  const ribbon = isNext ? `<p class="guide-ribbon">Next on your schedule</p>` : "";
  if(kind === "pla"){
    const {steps, pla, dirty, summary} = plasticGuideSteps(RS.plasticTest);
    const n = steps.length;
    return `<article class="guide-card card test${isNext ? " next" : ""}" style="--guide-accent:var(${color})">${ribbon}
      <h2>The plastic test ${chip(pla)}</h2>
      <p class="lede">Most takeout and konbini packaging comes down to a few questions. ${esc(summary)}</p>
      ${guideStepsHTML(steps)}
      <div class="verdict"><span>Yes to all ${n === 3 ? "three" : n === 4 ? "four" : "two"} →</span> ${chip(pla)} <span>Any no →</span> ${chip(dirty)}</div>
      ${guideQuickHTML(kind)}</article>`;
  }
  const g = SORT_GUIDES[kind]; if(!g) return "";
  const bin = firstBin(kind); if(!bin) return "";
  return `<article class="guide-card card test${isNext ? " next" : ""}" style="--guide-accent:var(${color})">${ribbon}
    <h2>${esc(g.title)} ${chip(bin)}</h2>
    <p class="lede">${esc(g.lede)}</p>
    ${guideStepsHTML(g.steps)}
    ${guideQuickHTML(kind)}</article>`;
}

let GUIDE_ORDER = [], guideSlide = 0, guideDrag = null;

function applyGuideSlide(){
  const track = $("#sortGuides"); if(!track || !GUIDE_ORDER.length) return;
  guideSlide = ((guideSlide % GUIDE_ORDER.length) + GUIDE_ORDER.length) % GUIDE_ORDER.length;
  track.style.transform = `translate3d(-${guideSlide * 100}%,0,0)`;
  $("#guideDots")?.querySelectorAll(".guide-dot").forEach((b, i) => b.setAttribute("aria-current", i === guideSlide ? "true" : "false"));
}

function renderSortGuides(){
  const wrap = $("#sortGuidesWrap");
  if(!RS){ wrap.hidden = true; return }
  const kinds = GUIDE_KINDS.filter(k => binKeysForKind(k).length);
  if(!kinds.length){ wrap.hidden = true; return }
  const next = nextPickupInfo();
  const nextKinds = new Set(next ? next.bins.map(b => binOf(b).kind) : []);
  const lede = $("#sortGuidesLede");
  if(next){
    const names = next.bins.map(b => binOf(b).en).join(", ");
    lede.textContent = `Next pickup: ${next.label} · ${names}${next.by ? ` · ${next.by}` : ""}`;
    lede.hidden = false;
  } else lede.hidden = true;
  GUIDE_ORDER = [...kinds].sort((a, b) => Number(nextKinds.has(b)) - Number(nextKinds.has(a)) || GUIDE_KINDS.indexOf(a) - GUIDE_KINDS.indexOf(b));
  guideSlide = 0;
  $("#sortGuides").innerHTML = GUIDE_ORDER.map(k => guideCardHTML(k, nextKinds.has(k))).join("");
  const nav = $("#guideNav");
  if(GUIDE_ORDER.length <= 1) nav.hidden = true;
  else {
    nav.hidden = false;
    $("#guideDots").innerHTML = GUIDE_ORDER.map((k, i) => {
      const b = binOf(firstBin(k));
      return `<button type="button" class="guide-dot" data-guide-dot="${i}" style="--guide-accent:var(${BIN_COLOR[k]})" aria-label="${esc(b.en)}" aria-current="${i === 0 ? "true" : "false"}"></button>`;
    }).join("");
  }
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
const patternText = (p, rs = RS) => Object.entries(p).filter(([,r]) => r).map(([bin,r]) => `${binOf(bin, rs).en} ${ruleText(r)}`).join(" · ");
const none = text => `<span class="none">${text}</span>`;
const SHORT = {off:"No collection", unconfirmed:"Not confirmed yet", unpublished:"Not published yet"};
const LONG = {off:"No collection (Sunday or New Year break)", unconfirmed:"Not confirmed yet: watch for the city's New Year notice", unpublished:"The city hasn't published this date yet"};
const dayRow = (r, rs = RS) => `<div class="day"><div class="d"><b>${r.label}</b>${shortDate(r.d)} ${DOWJ[r.d.getDay()]}</div>
  <div class="cs">${Array.isArray(r.ps) && r.ps.length ? r.ps.map(([c])=>chip(c, rs)).join("") : none(SHORT[r.ps] ?? "Nothing")}</div></div>`;
const areaName = a => a.en === "All" ? a.townEn : `${a.townEn} ${a.en}`;
/* the next days for an area, as {d, ps, label} rows */
function nextDays(rs, area, count){
  const now = new Date(); now.setHours(0,0,0,0);
  return [...Array(count)].map((_, i) => { const d = new Date(now); d.setDate(now.getDate()+i);
    return {d, ps:pickupsOn(d, rs.calendar.patterns[area.pattern], rs), label:i===0?"Today":i===1?"Tomorrow":DOW[d.getDay()]} });
}
/* onboarding's last step: where the user is and what's coming up */
const describe = (rs, area) => `<div class="place">${esc(areaName(area))}<small lang="ja">${esc(area.town + (area.jp === "全域" ? "" : area.jp))} · ${esc(rs.jp)}</small></div>
  <div class="week">${nextDays(rs, area, 3).map(r => dayRow(r, rs)).join("")}</div>
  <p class="fine">${esc(patternText(rs.calendar.patterns[area.pattern], rs))}</p>`;

/* the area picked in the onboarding ("town|en"); the city's first area if it's missing or no longer exists */
function restoreArea(){
  const [town, en] = (store.get("wakeru-area-"+RS.id) || "").split("|");
  const list = RS.areas.filter(a => a.town === town);
  AREA = list.find(a => a.en === en) ?? list[0] ?? RS.areas[0];
}
function renderDays(){
  $("#whereText").textContent = `${areaName(AREA)}, ${RS.en}`;
  const pat = RS.calendar.patterns[AREA.pattern];
  const rows = nextDays(RS, AREA, 7);
  const list = r => Array.isArray(r.ps) && r.ps.length ? `<div class="pickups">${r.ps.map(([c,by])=>`<div class="pickup">${chip(c)}<span class="by">${esc(by)}</span></div>`).join("")}</div>`
    : none(LONG[r.ps] ?? "Nothing collected");
  const [t, tm] = rows;
  $("#areaNote").hidden = !AREA.note; $("#areaNote").textContent = AREA.note || "";
  $("#today").innerHTML = `<div class="date">Today<small>${shortDate(t.d)} (${DOWJ[t.d.getDay()]})</small></div>${list(t)}
    <div class="date date--tomorrow">Tomorrow<small>${shortDate(tm.d)} (${DOWJ[tm.d.getDay()]})</small></div>${list(tm)}
    <p class="fine">${esc(patternText(pat))}</p>`;
  $("#week").innerHTML = rows.map(r => dayRow(r)).join("");
  renderSortGuides();
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
  parts.push(RS.contacts.map(c=>`${esc(c.en)}: <span style="user-select:all">${esc(c.tel)}</span>`).join(" · "));
  parts.push(`Map: 出典：国土数値情報（行政区域データ）（国土交通省）を加工して作成. "Locate me" sends your position only to the ${link("https://maps.gsi.go.jp/development/api.html", "GSI reverse geocoder")}.`);
  return parts.filter(Boolean).join(" ");
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
  $("#quick").innerHTML = ITEMS.map((i,n)=>i.quick?`<button type="button" data-i="${n}"><span class="pill-text">${esc(i.en.replace(/ \(.*\)/,""))}</span></button>`:"").join("");
  $("#cats").innerHTML = Object.keys(RS.bins).map(c=>`<button type="button" data-c="${c}"><span class="pill-text">${esc(RS.bins[c].en)} · ${esc(RS.bins[c].label)}</span></button>`).join("");
  restoreArea();
  const validTo = RS.calendar.validTo ? ` Dates are published through ${RS.calendar.validTo}.` : "";
  $("#schedNote").textContent = `${RS.calendar.note || ""}${validTo} Your collection point's sign has the final word.`;
  $("#terms").innerHTML = DATA.glossary.map(t=>`<div class="term"><div class="jp">${t.jp}<small>${t.reading}</small></div>${chipHTML(t.bin, t.en, "")}<p>${t.meaning}</p><div class="aka">Elsewhere: <b>${t.elsewhere}</b></div></div>`).join("");
  $("#footSrc").innerHTML = footerHTML();
  renderDays(); search($("#q").value);
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
/* presets get a history entry so the browser/phone back gesture returns to the sort home instead of leaving the site */
function openPreset(list, title){
  showResults(list, title); window.scrollTo({top:0});
  if(!history.state?.results) history.pushState({results:true}, "");
}
function closeResults(){ $("#q").value = ""; showHome(); window.scrollTo({top:0}) }
$("#quick").addEventListener("click", e => { const b = e.target.closest("button"); if(!b) return; const it = ITEMS[+b.dataset.i]; openPreset([it], it.en) });
$("#sortGuidesWrap").addEventListener("click", e => {
  if(e.target.closest("[data-guide-prev]")){ guideSlide--; applyGuideSlide(); return }
  if(e.target.closest("[data-guide-next]")){ guideSlide++; applyGuideSlide(); return }
  const dot = e.target.closest("[data-guide-dot]");
  if(dot){ guideSlide = +dot.dataset.guideDot; applyGuideSlide(); return }
  const b = e.target.closest("button[data-guide-i]"); if(!b) return;
  const it = ITEMS[+b.dataset.guideI]; if(it) openPreset([it], it.en);
});
const guideViewport = $("#guideViewport");
guideViewport.addEventListener("pointerdown", e => {
  if(GUIDE_ORDER.length <= 1 || e.target.closest("button")) return;
  guideDrag = {x: e.clientX, id: e.pointerId};
  guideViewport.setPointerCapture(e.pointerId);
});
guideViewport.addEventListener("pointerup", e => {
  if(!guideDrag || guideDrag.id !== e.pointerId) return;
  const dx = e.clientX - guideDrag.x;
  guideDrag = null;
  if(Math.abs(dx) < 48) return;
  guideSlide += dx < 0 ? 1 : -1;
  applyGuideSlide();
});
guideViewport.addEventListener("pointercancel", () => { guideDrag = null });
guideViewport.addEventListener("keydown", e => {
  if(e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  e.preventDefault(); guideSlide += e.key === "ArrowRight" ? 1 : -1; applyGuideSlide();
});
$("#cats").addEventListener("click", e => { const b = e.target.closest("button"); if(!b) return; const c = b.dataset.c;
  openPreset(ITEMS.filter(i=>i.outs.some(o=>o.bin===c)), `Things that can go in ${RS.bins[c].en} (${RS.bins[c].label})`) });
$("#resBack").addEventListener("click", () => history.state?.results ? history.back() : closeResults());
window.addEventListener("popstate", closeResults);
function switchView(v){
  document.querySelectorAll("nav.tabs button").forEach(b=>b.setAttribute("aria-selected", b.dataset.v===v));
  ["sort","days","words"].forEach(x=>$("#v-"+x).hidden = x!==v);
}
document.querySelector("nav.tabs").addEventListener("click", e => { const b = e.target.closest("button"); if(!b) return; switchView(b.dataset.v); if(b.dataset.v==="sort" && !$("#q").value) showHome() });
init().catch(showError);
