/* Data: shared items tagged by material type (data/shared), and one generated file per ward (data/wards/<id>.json) that maps
   types to bins and lists every town/chome area with its collection pattern, plus the ward's own Japanese sorting list (<id>.dict.json). */
const BIN_COLOR = {burn:"--c-burn",non:"--c-non",res:"--c-res",pla:"--c-pla",haz:"--c-haz",big:"--c-big",no:"--c-no"};
const DEFAULT_WARD = "chiyoda", DICT_LIMIT = 40;
const $ = s => document.querySelector(s);
const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"], DOWJ = ["日","月","火","水","木","金","土"], ORD = ["","1st","2nd","3rd","4th","5th"];
const store = {get(k){try{return localStorage.getItem(k)}catch(e){return null}}, set(k,v){try{localStorage.setItem(k,v)}catch(e){}}};
const kataToHira = s => s.replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
const norm = s => kataToHira((s||"").toLowerCase().normalize("NFKC"));
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
const pad = n => String(n).padStart(2,"0");
const iso = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const shortDate = d => `${d.getMonth()+1}/${d.getDate()}`;
let DATA, RS, DICT, AREA, ITEMS = [];

async function getJSON(path){
  const res = await fetch(path);
  if(!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}
/* a ward and its dictionary load on first use and stay cached (a failed load is retried next time) */
const WARDS = {};
function loadWard(entry){
  return WARDS[entry.id] ??= Promise.all([
    getJSON(`data/wards/${entry.id}.json`),
    entry.dictionary ? getJSON(`data/wards/${entry.id}.dict.json`) : null,
  ]).then(([rs, dict]) => {
    if(dict) dict.index = dict.items.map(([name,,,keywords]) => [norm(name), norm(keywords)]);
    return [rs, dict];
  }).catch(err => { delete WARDS[entry.id]; throw err });
}
function showError(err){
  $("#homeWeek").innerHTML = `<div class="empty">Couldn't load the trash data (${esc(err.message)}). Reload the page to try again.</div>`;
}

const binOf = bin => RS.bins[bin] || {en:bin,label:"",kind:"no"};
const chipHTML = (kind, en, label) => `<span class="chip" style="--cc:var(${BIN_COLOR[kind]||"--c-no"})"><i></i>${esc(en)} <small>${esc(label)}</small></span>`;
const chip = bin => { const b = binOf(bin); return chipHTML(b.kind, b.en, b.label) };
/* turn an item's material types into this ward's bins */
function resolve(it){
  const outs = [];
  for(const o of it.outcomes){
    const r = RS.sorting[o.type]; if(!r) continue;
    const bin = typeof r === "string" ? r : r.bin, note = typeof r === "string" ? "" : r.note;
    const same = outs.find(x => x.bin === bin);
    if(same){ same.when = ""; continue }
    outs.push({bin, when:o.when||"", note});
  }
  return {...it, outs};
}

/* ---------- sort view ---------- */
function itemHTML(it){
  const outs = it.outs.map(o => `<div class="outcome">${chip(o.bin)}<span class="when">${o.when}</span></div>`).join("");
  const notes = [it.how, ...it.outs.map(o=>o.note)].filter(Boolean).join(" ");
  return `<article class="item"><div class="item-name"><b>${it.en}</b><span>${it.jp}</span></div><div class="outcomes">${outs}</div>${notes?`<p class="how">${notes}</p>`:""}</article>`;
}
function dictItemHTML([name, cat, note]){
  const c = DICT.categories[cat];
  return `<article class="item"><div class="item-name"><b lang="ja">${esc(name)}</b></div>
    <div class="outcomes"><div class="outcome">${c.bins.map(chip).join("")}<span class="when" lang="ja">${esc(c.label)}</span></div></div>
    ${note?`<p class="how" lang="ja">${esc(note)}</p>`:""}</article>`;
}
function showResults(list, title, dictHits = []){
  ["#home","#quickWrap","#catWrap"].forEach(s=>$(s).hidden=true);
  $("#resultsWrap").hidden = false; $("#resTitle").textContent = title;
  $("#results").innerHTML = list.length ? list.map(itemHTML).join("")
    : dictHits.length ? `<div class="empty">No English guide entry for this. The ward's own list below has a match.</div>`
    : `<div class="empty">Nothing matched. Try a simpler word (e.g. "tray", "bag", "電池"), or run the plastic test.</div>`;
  $("#dictWrap").hidden = !dictHits.length;
  if(!dictHits.length) return;
  $("#dictTitle").textContent = `${RS.en}'s official list (${dictHits.length === DICT_LIMIT ? `top ${DICT_LIMIT}` : dictHits.length})`;
  $("#dictNote").textContent = `Item names and notes in Japanese, from ${RS.jp}'s sorting list (updated ${DICT.updated.split(" ")[0]}). The bin is the ward's own category.`;
  $("#dict").innerHTML = dictHits.map(dictItemHTML).join("");
}
function showHome(){ ["#home","#quickWrap","#catWrap"].forEach(s=>$(s).hidden=false); ["#resultsWrap","#dictWrap"].forEach(s=>$(s).hidden=true) }
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
  const steps = [
    pt.products ? ["Is it 100% plastic?", "No metal, paper or rubber parts attached. Pump tops and wrap boxes with a cutter fail this."]
      : ["Is it packaging with the プラマーク?", `${RS.en} only takes plastic packaging. Plastic products like hangers, toys or cutlery fail this, even if they're 100% plastic.`],
    ["Is it empty and clean?", "Give it a quick rinse or wipe. Curry stains, oil or stuck rice that won't come off fail this."],
    ...(pt.maxCm ? [[`Is it under ${pt.maxCm} cm?`, "Bigger than that is oversized garbage (粗大ごみ)."]] : []),
  ];
  $("#plasticSteps").innerHTML = steps.map(([q, no]) => `<li><div><b>${q}</b><span class="no">${no}</span></div></li>`).join("");
  $("#plasticSummary").textContent = pt.summary;
  $("#verdict").innerHTML = `<span>Yes to all ${steps.length === 3 ? "three" : "two"} →</span> ${chip("pla")} <span>Any no →</span> ${chip("burn")}`;
}

/* ---------- schedule ---------- */
const monthDay = d => iso(d).slice(5);
const dayOff = d => { const nc = RS.calendar.noCollection; return nc.weekdays.includes(d.getDay()) || nc.dates.includes(monthDay(d)) };
const binOff = (d, bin) => (RS.calendar.noCollection.bins?.[bin] ?? []).includes(monthDay(d));
const unpublished = d => RS.calendar.validTo && iso(d) > RS.calendar.validTo;
function hits(rule, d){
  if(Array.isArray(rule)) return rule.includes(d.getDay());
  if(rule.dates) return rule.dates.includes(iso(d));
  return rule.day === d.getDay() && rule.weeks.includes(Math.ceil(d.getDate()/7));
}
/* [[bin, "by 8:00"]] for a day; null = no collection that day; undefined = the ward hasn't published dates that far ahead */
function pickupsOn(d, pattern){
  if(unpublished(d)) return undefined;
  if(dayOff(d)) return null;
  return Object.entries(pattern).filter(([bin, rule]) => rule && hits(rule, d) && !binOff(d, bin))
    .map(([bin]) => [bin, "by " + (RS.calendar.putOutBy?.[bin] || "8:00")]);
}
function ruleText(r){
  if(Array.isArray(r)) return r.map(d=>DOW[d]).join(" & ");
  if(r.dates){
    const count = [0,0,0,0,0,0,0]; r.dates.forEach(s => count[new Date(s+"T00:00").getDay()]++);
    return `every other ${DOW[count.indexOf(Math.max(...count))]}`;
  }
  return r.weeks.map(n=>ORD[n]).join(" & ") + " " + DOW[r.day];
}
const patternText = p => Object.entries(p).filter(([,r]) => r).map(([bin,r]) => `${binOf(bin).en} ${ruleText(r)}`).join(" · ");
const none = text => `<span class="none">${text}</span>`;
const dayText = ps => ps === undefined ? "Not published yet" : ps === null ? "No collection" : "Nothing";
const dayRow = r => `<div class="day"><div class="d"><b>${r.label}</b>${shortDate(r.d)} ${DOWJ[r.d.getDay()]}</div>
  <div class="cs">${r.ps?.length ? r.ps.map(([c])=>chip(c)).join("") : none(dayText(r.ps))}</div></div>`;
const areaName = a => a.en === "All" ? a.townEn : `${a.townEn} ${a.en}`;

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
  const pat = RS.calendar.patterns[AREA.pattern];
  const now = new Date(); now.setHours(0,0,0,0);
  const at = i => { const d = new Date(now); d.setDate(now.getDate()+i); return d };
  const rows = [...Array(7)].map((_,i)=>{ const d = at(i); return {d, ps:pickupsOn(d,pat), label:i===0?"Today":i===1?"Tomorrow":DOW[d.getDay()]} });
  const list = r => r.ps?.length ? `<div class="pickups">${r.ps.map(([c,by])=>`<div class="pickup">${chip(c)}<span class="by">${esc(by)}</span></div>`).join("")}</div>`
    : none(r.ps === null ? "No collection (Sunday or New Year break)" : r.ps === undefined ? "The ward hasn't published this date yet" : "Nothing collected");
  const [t, tm] = rows;
  $("#areaNote").hidden = !AREA.note; $("#areaNote").textContent = AREA.note || "";
  $("#today").innerHTML = `<div class="date">Today<small>${shortDate(t.d)} (${DOWJ[t.d.getDay()]})</small></div>${list(t)}
    <div class="date" style="font-size:16px;margin-top:4px">Tomorrow<small>${shortDate(tm.d)} (${DOWJ[tm.d.getDay()]})</small></div>${list(tm)}
    <p class="fine">${esc(patternText(pat))}</p>`;
  $("#week").innerHTML = rows.map(dayRow).join("");
  let nextNon = null;
  for(let i=0;i<40 && !nextNon;i++){ const ps = pickupsOn(at(i),pat); if(ps === undefined) break; if(ps?.some(x=>x[0]==="non")) nextNon = at(i) }
  $("#homeWeek").innerHTML = `<div class="today"><h2 style="margin:0">${esc(areaName(AREA))} · next 3 days</h2><div class="week">${rows.slice(0,3).map(dayRow).join("")}</div>
    ${nextNon?`<p class="fine">Next non-burnable day: <b>${shortDate(nextNon)} (${DOWJ[nextNon.getDay()]})</b>. ${esc(patternText(pat))}</p>`:""}</div>`;
}

/* ---------- ward ---------- */
async function setWard(id){
  const entry = DATA.wards.find(w=>w.id===id) || DATA.wards[0];
  const [rs, dict] = await loadWard(entry);
  if($("#city").value !== entry.id) return; // the user picked another ward while this one was loading
  RS = rs; DICT = dict;
  store.set("wakeru-ward", RS.id);
  ITEMS = DATA.items.map(resolve);
  $("#quick").innerHTML = ITEMS.map((i,n)=>i.quick?`<button type="button" data-i="${n}">${i.en.replace(/ \(.*\)/,"")}</button>`:"").join("");
  $("#cats").innerHTML = Object.keys(RS.bins).map(c=>`<button type="button" data-c="${c}">${esc(RS.bins[c].en)} · ${esc(RS.bins[c].label)}</button>`).join("");
  renderPlasticTest();
  fillTowns(); restoreArea();
  const validTo = RS.calendar.validTo ? ` Dates are published through ${RS.calendar.validTo}.` : "";
  $("#schedNote").textContent = `${RS.calendar.note || ""}${validTo} Your collection point's sign has the final word.`;
  $("#terms").innerHTML = DATA.glossary.map(t=>`<div class="term"><div class="jp">${t.jp}<small>${t.reading}</small></div>${chipHTML(t.bin, t.en, "")}<p>${t.meaning}</p><div class="aka">Elsewhere: <b>${t.elsewhere}</b></div></div>`).join("");
  const links = [`<a href="${esc(RS.sources[0])}" target="_blank" rel="noopener">official sorting page</a>`,
    ...(DICT ? [`<a href="${esc(DICT.source)}" target="_blank" rel="noopener">sorting list</a>`] : [])];
  $("#footSrc").innerHTML = `Based on ${RS.jp}'s official guidance, checked on ${RS.verified}. Rules change, and the ward has the final word: ${links.join(" · ")}. ` +
    RS.contacts.map(c=>`${esc(c.en)}: <span style="user-select:all">${esc(c.tel)}</span>`).join(" · ");
  renderDays(); search($("#q").value);
}
async function init(){
  const [items, glossary, index] = await Promise.all([
    getJSON("data/shared/items.json"), getJSON("data/shared/glossary.json"), getJSON("data/wards.json")
  ]);
  DATA = {items, glossary, wards:index.wards};
  $("#city").innerHTML = DATA.wards.map(w=>`<option value="${w.id}">${w.en} ${w.jp}</option>`).join("");
  const saved = store.get("wakeru-ward"), ids = DATA.wards.map(w=>w.id);
  const start = ids.includes(saved) ? saved : ids.includes(DEFAULT_WARD) ? DEFAULT_WARD : ids[0];
  $("#city").value = start; await setWard(start);
}

/* ---------- events ---------- */
$("#city").addEventListener("change", e => setWard(e.target.value).catch(showError));
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
