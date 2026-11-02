/* First-run (and "Change location") flow: Japan → prefecture → city → ward (designated cities) → town → chome/banchi.
   The map is one SVG in a shared projection (data/map, built by scripts/import/map.mjs); each step animates the viewBox
   to the chosen area. "Locate me" sends the browser position to GSI's reverse geocoder (city code + town/chome). */
const GSI = "https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress";
const LIST_LIMIT = 60;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
const kataToHira = s => s.replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
const norm = s => kataToHira((s || "").toLowerCase().normalize("NFKC"));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const normPref = c => String(c ?? "").padStart(2, "0");
const K = 1000, COS = Math.cos(36 * Math.PI / 180);
const project = (lon, lat) => [(lon - 122) * COS * K, (46 - lat) * K];
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const NUM = {一:1, 二:2, 三:3, 四:4, 五:5, 六:6, 七:7, 八:8, 九:9};
const kanjiNumber = s => { const [a, b] = s.split("十"); return s.includes("十") ? (NUM[a] ?? 1) * 10 + (NUM[b] ?? 0) : NUM[s] };

let JAPAN, PREFS = {}, view, anim;
const mapFile = code => PREFS[code] ??= fetch(`data/map/${code}.json`).then(r => { if(!r.ok) throw new Error(`map ${code}: HTTP ${r.status}`); return r.json() })
  .catch(err => { delete PREFS[code]; throw err });

/* ---------- map ---------- */
function fit([x, y, w, h], pad = 0.12){
  const svg = $("#obMap"), ratio = svg.clientWidth / Math.max(svg.clientHeight, 1);
  w *= 1 + pad * 2; h *= 1 + pad * 2; x -= (w / (1 + pad * 2)) * pad; y -= (h / (1 + pad * 2)) * pad;
  if(w / h < ratio){ const nw = h * ratio; x -= (nw - w) / 2; w = nw } else { const nh = w / ratio; y -= (nh - h) / 2; h = nh }
  return [x, y, w, h];
}
const ease = t => t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
function zoomTo(box, ms = 750){
  const to = fit(box), from = view ?? to;
  cancelAnimationFrame(anim);
  return new Promise(done => {
    const start = performance.now(), dur = reducedMotion() ? 0 : ms;
    const frame = now => {
      const t = dur ? Math.min((now - start) / dur, 1) : 1, k = ease(t);
      view = from.map((v, i) => v + (to[i] - v) * k);
      $("#obMap").setAttribute("viewBox", view.join(" "));
      sizePin();
      if(t < 1) anim = requestAnimationFrame(frame); else done();
    };
    anim = requestAnimationFrame(frame);
  });
}
const pause = ms => new Promise(r => setTimeout(r, reducedMotion() ? 0 : ms));
function sizePin(){
  const pin = $("#obPin circle:not(.halo)"); if(!pin) return;
  const unit = view[2] / Math.max($("#obMap").clientWidth, 1);
  pin.setAttribute("r", 7 * unit);
  $("#obPin .halo")?.setAttribute("r", 18 * unit);
}
function setPin(lon, lat){
  const [x, y] = project(lon, lat);
  $("#obPin").innerHTML = `<circle class="halo" cx="${x}" cy="${y}"/><circle cx="${x}" cy="${y}"/>`;
  sizePin();
}
const mark = (sel, attr, value) => document.querySelectorAll(sel).forEach(p => p.classList.toggle("active", p.dataset[attr] === value));

let mapTipKey = "", obState = null;

function mapTipPayload(target){
  const S = obState; if(!S) return null;
  const p = target.closest?.("path");
  if(!p || p.closest("#obPin")) return null;
  const step = S.step;

  if(step === "japan" && p.dataset.pref && p.closest("#obPrefs")){
    const pref = JAPAN.prefs.find(x => x.code === p.dataset.pref);
    return pref ? {en: pref.en, jp: pref.jp} : null;
  }
  if(step === "pref"){
    if(p.dataset.code && p.closest("#obMunis")){
      const m = S.munisList?.find(x => x.code === p.dataset.code);
      return m ? {en: m.en, jp: m.jp} : null;
    }
    if(p.dataset.pref && p.closest("#obPrefs") && p.classList.contains("context")){
      const pref = JAPAN.prefs.find(x => x.code === p.dataset.pref);
      return pref ? {en: pref.en, jp: pref.jp} : null;
    }
  }
  if((step === "ward" || step === "town" || step === "area") && p.dataset.code && p.closest("#obMunis")){
    const m = S.munisList?.find(x => x.code === p.dataset.code);
    if(!m) return null;
    if(S.muni && m.code === S.muni.code && S.ward && (step === "town" || step === "area"))
      return {en: S.ward.en, jp: S.ward.jp};
    return {en: m.en, jp: m.jp};
  }
  if(p.dataset.tipEn) return {en: p.dataset.tipEn, jp: p.dataset.tipJp};
  return null;
}

function positionMapTip(clientX, clientY){
  const tip = $("#obMapTip"), map = $(".ob-map"), rect = map.getBoundingClientRect();
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const pad = 0.5 * rem, offset = 0.75 * rem;
  let x = clientX - rect.left + offset, y = clientY - rect.top + offset;
  x = Math.max(pad, Math.min(x, rect.width - tip.offsetWidth - pad));
  y = Math.max(pad, Math.min(y, rect.height - tip.offsetHeight - pad));
  tip.style.transform = `translate(${x / rem}rem,${y / rem}rem)`;
}

function showMapTip(payload, clientX, clientY){
  const tip = $("#obMapTip");
  if(!payload){ tip.hidden = true; mapTipKey = ""; return }
  const key = `${payload.en}\0${payload.jp}`;
  if(key !== mapTipKey){
    mapTipKey = key;
    tip.innerHTML = `<b>${esc(payload.en)}</b><span lang="ja">${esc(payload.jp)}</span>`;
  }
  tip.hidden = false;
  positionMapTip(clientX, clientY);
}
function hideMapTip(){ mapTipKey = ""; $("#obMapTip").hidden = true }

/* ---------- flow ---------- */
export function runOnboarding({cities, loadCity, describe, current}){
  const covered = new Map(cities.map(c => [c.code, c]));
  const coveredPrefs = new Set(cities.map(c => normPref(c.pref)));
  const S = {step:"japan"}; obState = S;
  let finish;

  const paintPrefCoverage = () => {
    document.querySelectorAll("#obPrefs path").forEach(p => {
      p.classList.toggle("on", coveredPrefs.has(normPref(p.dataset.pref)));
      p.classList.toggle("off", !coveredPrefs.has(normPref(p.dataset.pref)));
    });
  };

  const panel = (title, lede, body) => {
    $("#obTitle").textContent = title;
    $("#obLede").innerHTML = lede;
    $("#obBody").innerHTML = body;
    $("#obBack").hidden = S.step === "japan";
    $("#obMsg").hidden = true;
    document.querySelectorAll("#obSteps i").forEach((d, i) => d.classList.toggle("on", i <= ["japan","pref","town","area","done"].indexOf(S.step === "ward" ? "town" : S.step)));
  };
  const message = text => { $("#obMsg").hidden = !text; $("#obMsg").textContent = text || "" };
  const option = (data, name, sub, meta = "", off = false) =>
    `<button type="button" class="ob-opt${off ? " off" : ""}" ${data}><span><b>${esc(name)}</b> <small>${esc(sub)}</small></span>${meta ? `<em>${esc(meta)}</em>` : ""}</button>`;
  const searchBox = (placeholder, value = "") => `<input id="obSearch" type="search" autocomplete="off" placeholder="${esc(placeholder)}" value="${esc(value)}">`;
  const filterList = (render) => { const input = $("#obSearch"); if(!input) return; input.addEventListener("input", () => $("#obList").innerHTML = render(input.value)); $("#obList").innerHTML = render(input.value) };

  /* Japan */
  async function showJapan(){
    S.step = "japan"; S.pref = S.muni = null; S.munisList = null;
    $("#obMunis").innerHTML = ""; $("#obPin").innerHTML = "";
    document.querySelectorAll("#obPrefs path").forEach(p => p.classList.remove("active", "context"));
    paintPrefCoverage();
    const prefs = JAPAN.prefs.filter(p => coveredPrefs.has(normPref(p.code)));
    const perPref = cities.reduce((m, c) => m.set(normPref(c.pref), (m.get(normPref(c.pref)) ?? 0) + 1), new Map());
    /* typing matches prefectures and, across all of Japan, covered cities (which jump straight to that city) */
    const render = q => {
      const nq = norm(q).trim(), hit = x => !nq || norm(x.en + x.jp).includes(nq);
      const prefHits = prefs.filter(hit).map(p => option(`data-pref="${p.code}"`, p.en, p.jp, plural(perPref.get(normPref(p.code)) ?? 0, "city", "cities")));
      const cityHits = nq ? cities.filter(hit).slice(0, 20).map(c => option(`data-city="${c.code}" data-city-pref="${c.pref}"`, c.en, c.jp, c.prefEn)) : [];
      return [...prefHits, ...cityHits].join("") || `<p class="fine">Nothing covered matches. Try the kanji (e.g. 大阪) or tap the map.</p>`;
    };
    panel("Where do you live?", "Wakeru shows your pickup days and sorting rules for your exact area. It's saved on this device only.",
      `<button type="button" class="ob-locate" data-locate><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="8"/></svg>Locate me</button>
       <p class="fine">Or search, or tap your prefecture on the map. Darker areas are covered so far.</p>
       ${searchBox("Prefecture or city, e.g. Osaka or 大阪")}<div class="ob-list" id="obList"></div>`);
    filterList(render);
    await zoomTo(JAPAN.view);
  }

  /* prefecture */
  async function showPref(code, {zoom = true} = {}){
    const pref = JAPAN.prefs.find(p => p.code === code);
    const {munis} = await mapFile(code);
    S.step = "pref"; S.pref = pref; S.muni = null; S.munisList = munis;
    document.querySelectorAll("#obPrefs path").forEach(p => { p.classList.toggle("context", p.dataset.pref !== code); p.classList.remove("active") });
    $("#obMunis").innerHTML = munis.map(m => `<path d="${m.d}" data-code="${m.code}" data-tip-en="${esc(m.en)}" data-tip-jp="${esc(m.jp)}" class="${covered.has(m.code) ? "on" : "off"}"></path>`).join("");
    const render = q => {
      const nq = norm(q).trim(), hit = m => !nq || norm(m.en + m.jp).includes(nq);
      const on = munis.filter(m => covered.has(m.code) && hit(m)), off = munis.filter(m => !covered.has(m.code) && hit(m));
      return on.map(m => option(`data-code="${m.code}"`, m.en, m.jp)).join("") +
        (nq ? off.slice(0, 20).map(m => option(`data-code="${m.code}"`, m.en, m.jp, "Not yet", true)).join("") : "") ||
        `<p class="fine">No covered city matches. ${off.length ? "Cities shown in grey on the map aren't covered yet." : ""}</p>`;
    };
    const count = munis.filter(m => covered.has(m.code)).length;
    panel(`${pref.en} · your city or ward`, count ? `${count} of ${munis.length} covered so far. Tap yours on the map or pick it below.`
      : `${pref.en} isn't covered yet. We're adding cities over time; for now you can pick a covered prefecture.`,
      (count ? searchBox("Search, e.g. Chiyoda or 千代田") : "") + `<div class="ob-list" id="obList"></div>`);
    if(count) filterList(render); else $("#obList").innerHTML = "";
    if(zoom) await zoomTo(pref.box);
    return munis;
  }

  /* city: uncovered ones only get a message */
  async function pickMuni(code, {zoom = true} = {}){
    const {munis} = await mapFile(S.pref.code);
    const muni = munis.find(m => m.code === code);
    mark("#obMunis path", "code", code);
    if(zoom) zoomTo(muni.box, 650);
    if(!covered.has(code)){ message(`${muni.en} (${muni.jp}) isn't covered yet. We're adding cities over time; pick a covered one (shaded) for now.`); return null }
    S.muni = muni; S.entry = covered.get(code);
    const [rs] = await loadCity(S.entry);
    S.rs = rs;
    return rs;
  }

  /* designated cities: towns are stored as 区 + town, so the ward is its own step */
  const wardsWithTowns = () => (S.muni.wards ?? []).filter(w => S.rs.areas.some(a => a.town.startsWith(w.jp)));
  function showWards(){
    S.step = "ward"; S.ward = null;
    panel(`${S.muni.en} · your ward (区)`, "Pick your ward to narrow down the town list.",
      `<div class="ob-list">${wardsWithTowns().map(w => option(`data-ward="${esc(w.jp)}"`, w.en, w.jp)).join("")}</div>`);
  }

  function showTowns(prefill = ""){
    S.step = "town";
    const ward = S.ward;
    const towns = [...new Map(S.rs.areas.filter(a => !ward || a.town.startsWith(ward.jp)).map(a => [a.town, a])).values()]
      .sort((a, b) => a.townEn.localeCompare(b.townEn));
    const label = a => ward ? a.townEn.replace(/^[^,]+, /, "") : a.townEn, jp = a => ward ? a.town.slice(ward.jp.length) : a.town;
    const render = q => {
      const nq = norm(q).trim(), list = towns.filter(a => !nq || norm(a.townEn + a.town + a.kana).includes(nq));
      return list.slice(0, LIST_LIMIT).map(a => option(`data-town="${esc(a.town)}"`, label(a), jp(a))).join("") +
        (list.length > LIST_LIMIT ? `<p class="fine">${list.length - LIST_LIMIT} more: type to narrow down.</p>` : "") ||
        `<p class="fine">No town matches. Try the kanji (e.g. 岩本町) or the reading.</p>`;
    };
    panel(`${ward ? `${ward.en}, ` : ""}${S.muni.en} · your town (町名)`, "The town name is in your address, right after the city or ward.",
      searchBox("Search your town, e.g. Iwamotocho or 岩本町", prefill) + `<div class="ob-list" id="obList"></div>`);
    filterList(render);
  }

  function showAreas(town, nearIndex = -1){
    const areas = S.rs.areas.filter(a => a.town === town);
    if(areas.length === 1) return showDone(town, 0);
    S.step = "area"; S.town = town;
    panel(`${areas[0].townEn} · chome / banchi`, "Different parts of this town have different pickup days. The chome (丁目) and banchi (番地) are the numbers after the town name.",
      `<div class="ob-list">${areas.map((a, i) => option(`data-area="${i}"`, a.en, a.jp, i === nearIndex ? "Near you" : "")).join("")}</div>`);
  }

  function showDone(town, index){
    S.step = "done"; S.town = town; S.index = index;
    const area = S.rs.areas.filter(a => a.town === town)[index];
    panel("You're all set", "Saved on this device. You can change it any time from the top of the page.",
      `<div class="ob-done">${describe(S.rs, area)}</div><button type="button" class="ob-go" data-save>Save and start</button>`);
  }

  async function back(){
    if(S.step === "done") return S.town && S.rs.areas.filter(a => a.town === S.town).length > 1 ? showAreas(S.town) : showTowns();
    if(S.step === "area") return showTowns();
    if(S.step === "town" && S.ward) return showWards();
    if(S.step === "town" || S.step === "ward"){ await showPref(S.pref.code); return }
    if(S.step === "pref") return showJapan();
  }

  async function chooseMuni(code){
    const rs = await pickMuni(code);
    if(!rs) return;
    if(wardsWithTowns().length) showWards(); else { S.ward = null; showTowns() }
  }

  async function locate(){
    if(!navigator.geolocation) return message("This browser can't share its location. Tap your prefecture instead.");
    const btn = $("[data-locate]"); if(btn){ btn.disabled = true; btn.lastChild.textContent = "Finding you…" }
    try {
      const pos = await new Promise((ok, fail) => navigator.geolocation.getCurrentPosition(ok, fail, {timeout:15000, maximumAge:600000}));
      const {latitude:lat, longitude:lon} = pos.coords;
      const res = await fetch(`${GSI}?lat=${lat}&lon=${lon}`).then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)));
      const code = res.results?.muniCd?.padStart(5, "0");
      if(!code) return message("That location doesn't look like it's in Japan. Tap your prefecture instead.");
      setPin(lon, lat);
      const munis = await showPref(code.slice(0, 2));
      const muni = munis.find(m => m.code === code || m.wards?.some(w => w.code === code));
      if(!muni) return message("Couldn't find your city on the map. Pick it from the list.");
      await pause(250);
      const rs = await pickMuni(muni.code);
      if(!rs) return;
      const ward = muni.wards?.find(w => w.code === code);
      S.ward = ward && rs.areas.some(a => a.town.startsWith(ward.jp)) ? ward : null;
      const m = (res.results.lv01Nm ?? "").match(/^(.+?)(?:([一二三四五六七八九十]+)丁目)?$/);
      const town = m && (S.ward ? S.ward.jp : "") + m[1], chome = m?.[2] ? kanjiNumber(m[2]) : null;
      const areas = rs.areas.filter(a => a.town === town);
      if(!areas.length) return showTowns(m?.[1] && m[1] !== "－" ? m[1] : "");
      /* GSI knows the chome but not the banchi, so banchi-split areas still need the user's pick */
      const fits = a => !a.chome || !chome || a.chome.includes(chome);
      const near = areas.findIndex(fits);
      if(areas.filter(fits).length === 1 && areas.every(a => !a.detail)) return showDone(town, near);
      showAreas(town, near);
    } catch(err) {
      message(err.code === 1 ? "Location is turned off for this site. Tap your prefecture instead."
        : `Couldn't get your location (${err.message || "timeout"}). Tap your prefecture instead.`);
    } finally {
      if(btn?.isConnected){ btn.disabled = false; btn.lastChild.textContent = "Locate me" }
    }
  }

  /* events: map taps and panel buttons */
  const onMap = e => {
    const p = e.target.closest("path"); if(!p) return;
    if(p.dataset.pref && (S.step === "japan" || p.classList.contains("context"))) return showPref(p.dataset.pref).catch(fail);
    if(p.dataset.code) chooseMuni(p.dataset.code).catch(fail);
  };
  const onMapOver = e => showMapTip(mapTipPayload(e.target), e.clientX, e.clientY);
  const onMapMove = e => {
    const payload = mapTipPayload(e.target);
    if(payload) showMapTip(payload, e.clientX, e.clientY); else hideMapTip();
  };
  const onMapLeave = () => hideMapTip();
  const onPanel = e => {
    const b = e.target.closest("button"); if(!b) return;
    if(b.hasAttribute("data-locate")) return locate();
    if(b.dataset.pref) return showPref(b.dataset.pref).catch(fail);
    if(b.dataset.code) return chooseMuni(b.dataset.code).catch(fail);
    if(b.dataset.city) return showPref(b.dataset.cityPref).then(() => chooseMuni(b.dataset.city)).catch(fail);
    if(b.dataset.ward){ S.ward = S.muni.wards.find(w => w.jp === b.dataset.ward); return showTowns() }
    if(b.dataset.town) return showAreas(b.dataset.town);
    if(b.dataset.area) return showDone(S.town, +b.dataset.area);
    if(b.hasAttribute("data-save")){ const area = S.rs.areas.filter(a => a.town === S.town)[S.index]; close({id:S.entry.id, town:area.town, en:area.en}) }
  };
  const onBack = () => back().catch(fail);
  const onClose = () => close(null);
  const onResize = () => { if(view) zoomTo(S.muni?.box ?? S.pref?.box ?? JAPAN.view, 0) };
  const fail = err => message(`Something went wrong (${err.message}). Please try again.`);
  function close(result){
    $("#obMap").removeEventListener("click", onMap);
    $("#obMap").removeEventListener("pointerover", onMapOver); $("#obMap").removeEventListener("pointermove", onMapMove);
    $("#obMap").removeEventListener("pointerleave", onMapLeave);
    $("#obBody").removeEventListener("click", onPanel);
    $("#obBack").removeEventListener("click", onBack); $("#obClose").removeEventListener("click", onClose);
    removeEventListener("resize", onResize);
    hideMapTip(); obState = null;
    $("#onboard").hidden = true; document.body.classList.remove("ob-open");
    finish(result);
  }

  return new Promise(async (resolve, reject) => {
    finish = resolve;
    try {
      JAPAN ??= await fetch("data/map/japan.json").then(r => r.json());
      $("#onboard").hidden = false; document.body.classList.add("ob-open");
      $("#obClose").hidden = !current;
      $("#obPrefs").innerHTML = JAPAN.prefs.map(p => `<path d="${p.d}" data-pref="${p.code}" data-tip-en="${esc(p.en)}" data-tip-jp="${esc(p.jp)}" class="${coveredPrefs.has(normPref(p.code)) ? "on" : "off"}"></path>`).join("");
      paintPrefCoverage();
      $("#obMap").addEventListener("click", onMap);
      $("#obMap").addEventListener("pointerover", onMapOver); $("#obMap").addEventListener("pointermove", onMapMove);
      $("#obMap").addEventListener("pointerleave", onMapLeave);
      $("#obBody").addEventListener("click", onPanel);
      $("#obBack").addEventListener("click", onBack); $("#obClose").addEventListener("click", onClose);
      addEventListener("resize", onResize);
      view = null; await zoomTo(JAPAN.view, 0);
      if(current){
        /* "Change location": open on the current city, one step up from where the user is */
        const entry = cities.find(c => c.id === current.id);
        await showPref(entry.pref, {zoom:false});
        await zoomTo(JAPAN.prefs.find(p => p.code === entry.pref).box, 500);
        await pickMuni(entry.code);
        const ward = S.muni.wards?.find(w => current.town.startsWith(w.jp));
        S.ward = ward && wardsWithTowns().includes(ward) ? ward : null;
        showTowns();
      } else await showJapan();
    } catch(err) { reject(err) }
  });
}
