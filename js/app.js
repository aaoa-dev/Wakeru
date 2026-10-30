/* Data: shared items tagged by material type (data/shared), one ruleset per ward that maps types to bins (data/wards), and locations that pick a ward (data/locations.json). */
const BIN_COLOR = {burn:"--c-burn",non:"--c-non",res:"--c-res",pla:"--c-pla",haz:"--c-haz",big:"--c-big",no:"--c-no"};
const $ = s => document.querySelector(s);
const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"], DOWJ = ["日","月","火","水","木","金","土"], ORD = ["","1st","2nd","3rd","4th","5th"];
const store = {get(k){try{return localStorage.getItem(k)}catch(e){return null}}, set(k,v){try{localStorage.setItem(k,v)}catch(e){}}};
const kataToHira = s => s.replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
const norm = s => kataToHira((s||"").toLowerCase().normalize("NFKC"));
let DATA, LOC, RS, ITEMS = [];

async function getJSON(path){
  const res = await fetch(path);
  if(!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}
/* ward rulesets load on first use and stay cached */
const WARDS = {};
const loadWard = id => WARDS[id] ??= getJSON(`data/wards/${id}.json`);
function showError(err){
  $("#homeWeek").innerHTML = `<div class="empty">Couldn't load the trash data (${err.message}). Reload the page to try again.</div>`;
}

const binOf = bin => RS.bins[bin] || {en:bin,label:"",kind:"no"};
function chip(bin){
  const b = binOf(bin);
  return `<span class="chip" style="--cc:var(${BIN_COLOR[b.kind]||"--c-no"})"><i></i>${b.en} <small>${b.label}</small></span>`;
}
/* turn an item's material types into this ruleset's bins */
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
function showResults(list, title){
  ["#home","#quickWrap","#catWrap"].forEach(s=>$(s).hidden=true);
  $("#resultsWrap").hidden = false; $("#resTitle").textContent = title;
  $("#results").innerHTML = list.length ? list.map(itemHTML).join("")
    : `<div class="empty">Nothing matched. Try a simpler word (e.g. "tray", "bag", "電池"), or run the plastic test above.</div>`;
}
function showHome(){ ["#home","#quickWrap","#catWrap"].forEach(s=>$(s).hidden=false); $("#resultsWrap").hidden = true; }
function search(q){
  const nq = norm(q).trim(); if(!nq){showHome();return}
  const words = nq.split(/\s+/);
  const hits = ITEMS.map(it => {
    const hay = norm([it.en,it.jp,it.keywords,...it.outs.map(o=>binOf(o.bin).en+" "+binOf(o.bin).label)].join(" "));
    let s = 0; for(const w of words){ if(!hay.includes(w)) return null; s += (norm(it.en)+norm(it.jp)).includes(w) ? 3 : 1 }
    return [s,it];
  }).filter(Boolean).sort((a,b)=>b[0]-a[0]).map(x=>x[1]);
  showResults(hits, `${hits.length} result${hits.length===1?"":"s"} for "${q.trim()}"`);
}

/* ---------- schedule ---------- */
function isOff(d){
  const nc = RS.calendar.noCollection, md = String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
  return nc.weekdays.includes(d.getDay()) || nc.dates.includes(md);
}
function pickupsOn(d, pattern){
  if(isOff(d)) return null;
  const dow = d.getDay(), nth = Math.ceil(d.getDate()/7), out = [];
  for(const [bin, rule] of Object.entries(pattern)){
    const hit = Array.isArray(rule) ? rule.includes(dow) : (rule.day===dow && rule.weeks.includes(nth));
    if(hit) out.push([bin, "by " + (RS.calendar.putOutBy[bin]||"8:30")]);
  }
  return out;
}
const patternText = p => Object.entries(p).map(([bin,r]) => `${binOf(bin).en} ${Array.isArray(r) ? r.map(d=>DOW[d]).join(" & ") : r.weeks.map(n=>ORD[n]).join(" & ")+" "+DOW[r.day]}`).join(" · ");
const dayRow = r => `<div class="day"><div class="d"><b>${r.label}</b>${r.d.getMonth()+1}/${r.d.getDate()} ${DOWJ[r.d.getDay()]}</div>
  <div class="cs">${r.ps===null?`<span class="none">No collection</span>`:r.ps.length?r.ps.map(([c])=>chip(c)).join(""):`<span class="none">Nothing</span>`}</div></div>`;
function renderDays(){
  const idx = +$("#addr").value || 0, area = LOC.areas[idx], pat = RS.calendar.patterns[area.pattern];
  store.set("wakeru-addr-"+LOC.id, String(idx));
  const now = new Date(); now.setHours(0,0,0,0);
  const at = i => { const d = new Date(now); d.setDate(now.getDate()+i); return d };
  const rows = [...Array(7)].map((_,i)=>{ const d = at(i); return {d, ps:pickupsOn(d,pat), label:i===0?"Today":i===1?"Tomorrow":DOW[d.getDay()]} });
  const list = r => r.ps===null ? `<span class="none">No collection (Sunday or New Year break)</span>`
    : r.ps.length ? `<div class="pickups">${r.ps.map(([c,by])=>`<div class="pickup">${chip(c)}<span class="by">${by}</span></div>`).join("")}</div>` : `<span class="none">Nothing collected</span>`;
  const [t, tm] = rows;
  $("#today").innerHTML = `<div class="date">Today<small>${t.d.getMonth()+1}/${t.d.getDate()} (${DOWJ[t.d.getDay()]})</small></div>${list(t)}
    <div class="date" style="font-size:16px;margin-top:4px">Tomorrow<small>${tm.d.getMonth()+1}/${tm.d.getDate()} (${DOWJ[tm.d.getDay()]})</small></div>${list(tm)}
    <p class="fine">${patternText(pat)}</p>`;
  $("#week").innerHTML = rows.map(dayRow).join("");
  let nextNon = null; for(let i=0;i<40 && !nextNon;i++){ const ps = pickupsOn(at(i),pat); if(ps && ps.some(x=>x[0]==="non")) nextNon = at(i) }
  $("#homeWeek").innerHTML = `<div class="today"><h2 style="margin:0">${area.en} · next 3 days</h2><div class="week">${rows.slice(0,3).map(dayRow).join("")}</div>
    ${nextNon?`<p class="fine">Next non-burnable day: <b>${nextNon.getMonth()+1}/${nextNon.getDate()} (${DOWJ[nextNon.getDay()]})</b>. ${patternText(pat)}</p>`:""}</div>`;
}

/* ---------- location ---------- */
async function setLocation(id){
  const loc = DATA.locations.find(l=>l.id===id) || DATA.locations[0];
  const rs = await loadWard(loc.ruleset);
  if($("#city").value !== loc.id) return; // the user picked another location while this ward was loading
  LOC = loc; RS = rs;
  store.set("wakeru-loc", LOC.id);
  ITEMS = DATA.items.map(resolve);
  $("#quick").innerHTML = ITEMS.map((i,n)=>i.quick?`<button type="button" data-i="${n}">${i.en.replace(/ \(.*\)/,"")}</button>`:"").join("");
  $("#cats").innerHTML = Object.keys(RS.bins).map(c=>`<button type="button" data-c="${c}">${RS.bins[c].en} · ${RS.bins[c].label}</button>`).join("");
  $("#plasticSummary").textContent = RS.plasticTest.summary;
  $("#verdict").innerHTML = `<span>Yes to all three →</span> ${chip("pla")} <span>Any no →</span> ${chip("burn")}`;
  $("#addrField").hidden = LOC.areas.length < 2;
  $("#addr").innerHTML = LOC.areas.map((a,i)=>`<option value="${i}">${a.en} · ${a.jp}</option>`).join("");
  const saved = store.get("wakeru-addr-"+LOC.id);
  $("#addr").value = (saved!==null && LOC.areas[+saved]) ? saved : "0";
  $("#schedNote").textContent = RS.calendar.note || "";
  $("#terms").innerHTML = DATA.glossary.map(t=>`<div class="term"><div class="jp">${t.jp}<small>${t.reading}</small></div>${chip(t.bin)}<p>${t.meaning}</p><div class="aka">Elsewhere: <b>${t.elsewhere}</b></div></div>`).join("");
  $("#footSrc").innerHTML = `Based on ${RS.jp}'s official guidance (data ${DATA.version}). Rules change, and the ward has the final word: <a href="${RS.sources[0]}" target="_blank" rel="noopener">official sorting page</a>. ` +
    RS.contacts.map(c=>`${c.en}: <span style="user-select:all">${c.tel}</span>`).join(" · ");
  renderDays(); search($("#q").value);
}
async function init(){
  const [items, glossary, index] = await Promise.all([
    getJSON("data/shared/items.json"), getJSON("data/shared/glossary.json"), getJSON("data/locations.json")
  ]);
  DATA = {items, glossary, version:index.version, locations:index.locations};
  $("#city").innerHTML = DATA.locations.map(l=>`<option value="${l.id}">${l.en} ${l.jp}</option>`).join("");
  const saved = store.get("wakeru-loc"), start = DATA.locations.some(l=>l.id===saved) ? saved : DATA.locations[0].id;
  $("#city").value = start; await setLocation(start);
}

/* ---------- events ---------- */
$("#city").addEventListener("change", e => setLocation(e.target.value).catch(showError));
$("#q").addEventListener("input", e => { switchView("sort"); if(RS) search(e.target.value) });
$("#quick").addEventListener("click", e => { const b = e.target.closest("button"); if(!b) return; const it = ITEMS[+b.dataset.i]; showResults([it], it.en); window.scrollTo({top:0}) });
$("#cats").addEventListener("click", e => { const b = e.target.closest("button"); if(!b) return; const c = b.dataset.c;
  showResults(ITEMS.filter(i=>i.outs.some(o=>o.bin===c)), `Things that can go in ${RS.bins[c].en} (${RS.bins[c].label})`); window.scrollTo({top:0}) });
$("#addr").addEventListener("change", renderDays);
function switchView(v){
  document.querySelectorAll("nav.tabs button").forEach(b=>b.setAttribute("aria-selected", b.dataset.v===v));
  ["sort","days","words"].forEach(x=>$("#v-"+x).hidden = x!==v);
}
document.querySelector("nav.tabs").addEventListener("click", e => { const b = e.target.closest("button"); if(!b) return; switchView(b.dataset.v); if(b.dataset.v==="sort" && !$("#q").value) showHome() });
init().catch(showError);
