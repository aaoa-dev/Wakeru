/* A ward's official sorting dictionary (open data CSV) → {categories:[{label, bins}], items:[[name, category, note, keywords]]} */
import { decode, csvObjects } from "./lib.mjs";

const NAME = ["ゴミの品目", "ごみの品目", "品名", "ごみ名"], CATEGORY = ["分別区分", "種別"];
const NOTES = ["注意点", "備考", "説明"], KEYWORDS = ["インデックス", "追加検索キーワード"];
const pick = (row, keys) => keys.map(k => row[k]).find(v => v !== undefined);
const clean = s => (s ?? "").replace(/\r/g, "").replace(/[ \t　]+/g, " ").replace(/\n{2,}/g, "\n").trim();

/* map a Japanese category label to this ward's bins; compound labels ("不燃ごみ、粗大ごみ") give several bins */
const RULES = [
  [/粗大/, "big"], [/燃やさない|不燃|陶器|金属|水銀|発火/, "non"], [/燃やす|可燃/, "burn"], [/プラ/, "pla"],
  [/集団回収/, "paper"], [/資源|古紙|びん|缶|かん|ペット|古着|古布|トレイ|拠点/, "res"],
  [/収集しない|収集できない|収集不可|不可|家電リサイクル|パソコン|販売店|持込|問い合わせ|その他/, "no"],
];
/* exact bin label, else the longest bin label contained in it, else keyword rules */
function binFor(p, bins){
  const entries = Object.entries(bins);
  const exact = entries.find(([, b]) => b.label === p);
  if(exact) return exact[0];
  const contained = entries.filter(([, b]) => p.includes(b.label)).sort((a, b) => b[1].label.length - a[1].label.length)[0];
  return contained?.[0] ?? RULES.find(([re, k]) => re.test(p) && bins[k])?.[1];
}
function binsFor(label, bins){
  const whole = binFor(label, bins);
  if(whole && Object.values(bins).some(b => b.label === label)) return [whole];
  const found = [];
  for(const piece of label.split(/[、,]/)){
    const key = binFor(piece.replace(/（注釈）.*$/, "").trim(), bins);
    if(key && !found.includes(key)) found.push(key);
  }
  return found;
}

export async function importDictionary(rs, get){
  const {url, encoding, overrides = []} = rs.dictionary;
  const rows = csvObjects(decode(await get(url), encoding));
  const categories = [], catIndex = new Map(), unmapped = new Set();
  const items = rows.map(row => {
    const name = clean(pick(row, NAME));
    const fix = overrides.find(o => clean(o.name) === name);
    const label = clean(fix?.category ?? pick(row, CATEGORY)).replace(/について$/, "");
    if(!name || !label) return null;
    if(!catIndex.has(label)){
      const bins = binsFor(label, rs.bins);
      if(!bins.length) unmapped.add(label);
      catIndex.set(label, categories.length); categories.push({label, bins});
    }
    const fee = /^\d+$/.test(row["料金"] ?? "") ? `手数料 ${row["料金"]}円` : "";
    const note = fix ? fix.note : [...NOTES.map(k => clean(row[k])), fee].filter(Boolean).join("\n");
    return [name, catIndex.get(label), note, clean(pick(row, KEYWORDS))];
  }).filter(Boolean);
  const missing = overrides.filter(o => !items.some(i => i[0] === clean(o.name)));
  if(missing.length) throw new Error(`dictionary overrides match no row: ${missing.map(o => o.name).join(", ")}`);
  if(unmapped.size) console.log(`  dictionary categories with no bin: ${[...unmapped].join(" / ")}`);
  return {source:url, updated:rs.dictionary.updated, categories, items};
}
