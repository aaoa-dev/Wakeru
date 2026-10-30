/* Data: shared items tagged by material type (data/shared), and one generated file per municipality (data/municipalities/<id>.json)
   that maps types to bins and lists every town/chome area with its collection pattern, plus the official Japanese sorting list
   (<id>.dict.json). Collection-day rules live in schedule.js, shared with the importer's cross-check. */
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
let DATA, RS, DICT, AREA, ITEMS = [], LOADING = 0;

async function getJSON(path){
  const res = await fetch(path);
  if(!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}
/* a municipality and its dictionary load on first use and stay cached (a failed load is retried next time) */
const CITIES = {};
function loadCity(entry){
  return CITIES[entry.id] ??= Promise.all([
    getJSON(`data/municipalities/${entry.id}.json`),
    entry.dictionary ? getJSON(`data/municipalities/${entry.id}.dict.json`) : null,
  ]).then(([rs, dict]) => {
    if(dict) dict.index = dict.items.map(([name,,,keywords]) => [norm(name), norm(keywords)]);
    return [rs, dict];
  }).catch(err => { delete CITIES[entry.id]; throw err });
}
function showError(err){
  $("#homeWeek").innerHTML = `<div class="empty">Couldn't load the trash data (${esc(err.message)}). Reload the page to try again.</div>`;
}

const binOf = (bin, rs = RS) => rs.bins[bin] || {en:bin,label:"",kind:"no"};
const chipHTML = (kind, en, label) => `<span class="chip" style="--cc:var(${BIN_COLOR[kind]||"--c-no"})"><i></i>${esc(en)} <small>${esc(label)}</small></span>`;
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
function search(q){
  const nq = norm(q).trim(); if(!nq){showHome();return}
  const words = nq.split(/\s+/);
  const hits = ITEMS.map(it => {
    const hay = norm([it.en,it.jp,it.keywords,...it.outs.map(o=>binOf(o.bin).en+" "+binOf(o.bin).label)].join(" "));
    let s = 0; for(const w of words){ if(!hay.includes(w)) return null; s += (norm(it.en)+norm(it.jp)).includes(w) ? 3 : 1 }
    return [s,it];
  }).filter(Boolean).sort((a,b)=>b[0]-a[0]).map(x=>x[1]);
  showResults(hits, `${hits.length} result${hits.length===1?"":"s"} for "${q.trim()}"`, searchDict(words));
}
function renderPlasticTest(){
  const pt = RS.plasticTest;
  $(".test").hidden = !pt;
  if(!pt) return;
  const steps = [
    pt.products ? ["Is it 100% plastic?", "No metal, paper or rubber parts attached. Pump tops and wrap boxes with a cutter fail this."]
      : ["Is it packaging with the プラマーク?", `${RS.en} only takes plastic packaging. Plastic products like hangers, toys or cutlery fail this, even if they're 100% plastic.`],
    ["Is it empty and clean?", "Give it a quick rinse or wipe. Curry stains, oil or stuck rice that won't come off fail this."],
    ...(pt.maxCm ? [[`Is it under ${pt.maxCm} cm?`, "Bigger than that is oversized garbage (粗大ごみ)."]] : []),
  ];
  $("#plasticSteps").innerHTML = steps.map(([q, no]) => `<li><div><b>${q}</b><span class="no">${no}</span></div></li>`).join("");
  $("#plasticSummary").textContent = pt.summary;
  $("#verdict").innerHTML = `<span>Yes to all ${steps.length === 3 ? "three" : "two"} →</span> ${chip(pt.bin)} <span>Any no →</span> ${chip(pt.otherwise)}`;
}

/* ---------- schedule ---------- */
/* [[bin, "by 8:00"]] for a day, or a dayState string ("off", "unconfirmed", "unpublished") */
function pickupsOn(d, pattern, rs = RS){
  const state = dayState(rs.calendar, d);
  if(state) return state;
  const by = rs.calendar.putOutBy;
  return binsOn(rs.calendar, pattern, d).map(bin => [bin, by ? "by " + (by[bin] || "8:00") : ""]);
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

const areasOf = town => RS.areas.filter(a => a.town === town);
function fillTowns(){
  const towns = [...new Map(RS.areas.map(a => [a.town, a])).values()].sort((a,b) => a.townEn.localeCompare(b.townEn));
  $("#town").innerHTML = towns.map(a => `<option value="${esc(a.town)}">${esc(a.townEn)} · ${esc(a.town)}</option>`).join("");
}
function fillAreas(town){
  const list = areasOf(town);
  $("#addrField").hidden = list.length < 2;
  $("#addr").innerHTML = list.map((a,i) => `<option value="${i}">${esc(a.en)} · ${esc(a.jp)}</option>`).join("");
}
function restoreArea(){
  const [town, en] = (store.get("wakeru-area-"+RS.id) || "").split("|");
  const t = RS.areas.some(a => a.town === town) ? town : $("#town").options[0].value;
  $("#town").value = t; fillAreas(t);
  $("#addr").value = String(Math.max(areasOf(t).findIndex(a => a.en === en), 0));
}
function renderDays(){
  AREA = areasOf($("#town").value)[+$("#addr").value || 0];
  store.set("wakeru-area-"+RS.id, `${AREA.town}|${AREA.en}`);
  $("#whereText").textContent = `${areaName(AREA)}, ${RS.en}`;
  const pat = RS.calendar.patterns[AREA.pattern];
  const now = new Date(); now.setHours(0,0,0,0);
  const at = i => { const d = new Date(now); d.setDate(now.getDate()+i); return d };
  const rows = nextDays(RS, AREA, 7);
  const list = r => Array.isArray(r.ps) && r.ps.length ? `<div class="pickups">${r.ps.map(([c,by])=>`<div class="pickup">${chip(c)}<span class="by">${esc(by)}</span></div>`).join("")}</div>`
    : none(LONG[r.ps] ?? "Nothing collected");
  const [t, tm] = rows;
  $("#areaNote").hidden = !AREA.note; $("#areaNote").textContent = AREA.note || "";
  $("#today").innerHTML = `<div class="date">Today<small>${shortDate(t.d)} (${DOWJ[t.d.getDay()]})</small></div>${list(t)}
    <div class="date" style="font-size:16px;margin-top:4px">Tomorrow<small>${shortDate(tm.d)} (${DOWJ[tm.d.getDay()]})</small></div>${list(tm)}
    <p class="fine">${esc(patternText(pat))}</p>`;
  $("#week").innerHTML = rows.map(r => dayRow(r)).join("");
  let nextNon = null;
  for(let i=0;i<40 && !nextNon;i++){ const ps = pickupsOn(at(i),pat); if(ps === "unpublished") break; if(Array.isArray(ps) && ps.some(([b])=>binOf(b).kind==="non")) nextNon = at(i) }
  $("#homeWeek").innerHTML = `<div class="today"><h2 style="margin:0">${esc(areaName(AREA))} · next 3 days</h2><div class="week">${rows.slice(0,3).map(r => dayRow(r)).join("")}</div>
    ${nextNon?`<p class="fine">Next non-burnable day: <b>${shortDate(nextNon)} (${DOWJ[nextNon.getDay()]})</b>. ${esc(patternText(pat))}</p>`:""}</div>`;
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
  RS = rs; DICT = dict;
  store.set("wakeru-city", RS.id);
  ITEMS = DATA.items.map(resolve).filter(Boolean);
  $("#quick").innerHTML = ITEMS.map((i,n)=>i.quick?`<button type="button" data-i="${n}">${i.en.replace(/ \(.*\)/,"")}</button>`:"").join("");
  $("#cats").innerHTML = Object.keys(RS.bins).map(c=>`<button type="button" data-c="${c}">${esc(RS.bins[c].en)} · ${esc(RS.bins[c].label)}</button>`).join("");
  renderPlasticTest();
  fillTowns(); restoreArea();
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
$("#q").addEventListener("input", e => { switchView("sort"); if(RS) search(e.target.value) });
$("#quick").addEventListener("click", e => { const b = e.target.closest("button"); if(!b) return; const it = ITEMS[+b.dataset.i]; showResults([it], it.en); window.scrollTo({top:0}) });
$("#cats").addEventListener("click", e => { const b = e.target.closest("button"); if(!b) return; const c = b.dataset.c;
  showResults(ITEMS.filter(i=>i.outs.some(o=>o.bin===c)), `Things that can go in ${RS.bins[c].en} (${RS.bins[c].label})`); window.scrollTo({top:0}) });
$("#town").addEventListener("change", e => { fillAreas(e.target.value); $("#addr").value = "0"; renderDays() });
$("#addr").addEventListener("change", renderDays);
function switchView(v){
  document.querySelectorAll("nav.tabs button").forEach(b=>b.setAttribute("aria-selected", b.dataset.v===v));
  ["sort","days","words"].forEach(x=>$("#v-"+x).hidden = x!==v);
}
document.querySelector("nav.tabs").addEventListener("click", e => { const b = e.target.closest("button"); if(!b) return; switchView(b.dataset.v); if(b.dataset.v==="sort" && !$("#q").value) showHome() });
init().catch(showError);
