/* A ward's official sorting dictionary (open data CSV) → {categories:[{label, bins}], items:[[name, category, note, keywords]]} */
import XLSX from "xlsx";
import { decode, csvObjects } from "./lib.mjs";

const NAME = ["ゴミの品目", "ごみの品目", "品名", "ごみ名"], CATEGORY = ["分別区分", "種別"];
const NOTES = ["注意点", "備考", "説明"], KEYWORDS = ["インデックス", "追加検索キーワード"];
const pick = (row, keys) => keys.map(key => {
  const suffixes = [`_${key}`, `_${key.replace(/^[ゴご]ミの/, "")}`];
  return row[key] ?? Object.entries(row).find(([name]) => suffixes.some(suffix => name.endsWith(suffix)))?.[1];
}).find(v => v !== undefined);
export const clean = s => (s ?? "").replace(/\r/g, "").replace(/[ \t　]+/g, " ").replace(/\n{2,}/g, "\n").trim();

/* keyword → candidate bin ids, first existing one wins. Curated wards use burn/non/res/pla/…, japan-gomi-data bins use its vocabulary */
const RULES = [
  [/粗大|大型ごみ/, ["big", "oversized"]],
  [/燃やさない|燃えない|燃やせない|不燃|陶器|陶磁器|水銀|発火/, ["non", "non_burnable"]],
  [/燃やす|燃える|燃やせる|可燃/, ["burn", "burnable"]],
  [/生ごみ/, ["kitchen", "burn", "burnable"]],
  [/プラ/, ["pla", "plastic"]],
  [/集団回収/, ["paper"]],
  [/スプレー|エアゾール/, ["spray_can"]],
  [/有害|電池|蛍光|危険/, ["hazardous", "haz"]],
  [/ペット/, ["pet_bottle", "res"]],
  [/びん|ビン|瓶/, ["glass_bottle", "res"]],
  [/缶|かん/, ["beverage_can", "res"]],
  [/金属/, ["metal", "non", "non_burnable"]],
  [/古布|古着|衣類|布/, ["cloth", "paper_cloth", "res"]],
  [/古紙|紙/, ["paper", "paper_cloth", "res"]],
  [/資源|トレイ|拠点/, ["res"]],
  [/収集しない|収集できない|収集不可|不可|家電リサイクル|パソコン|販売店|持込|持ち込み|問い合わせ|^その他$/, ["no"]],
];
/* exact bin label, else the longest bin label contained in it, else the keyword that appears first in the label
   (「びん・スプレー缶」 is a bottle category), ties going to the earlier rule */
function binFor(p, bins){
  const entries = Object.entries(bins);
  const exact = entries.find(([, b]) => b.label === p);
  if(exact) return exact[0];
  const contained = entries.filter(([, b]) => p.includes(b.label)).sort((a, b) => b[1].label.length - a[1].label.length)[0];
  if(contained) return contained[0];
  if(/集団回収/.test(p) && bins.paper) return "paper";
  let best;
  for(const [re, keys] of RULES){
    const at = p.search(re), key = keys.find(k => bins[k]);
    if(at >= 0 && key && (!best || at < best.at)) best = {at, key};
  }
  return best?.key;
}
/* a Japanese category label → this municipality's bins; compound labels ("不燃ごみ、粗大ごみ", with splitDot also
   "缶・びん・ペットボトル") give several bins */
export function binsFor(label, bins, {splitDot = false} = {}){
  const whole = binFor(label, bins);
  if(whole && Object.values(bins).some(b => b.label === label)) return [whole];
  const found = [];
  for(const piece of label.split(splitDot ? /[、,・]/ : /[、,]/)){
    const key = binFor(piece.replace(/（注釈）.*$/, "").trim(), bins);
    if(key && !found.includes(key)) found.push(key);
  }
  return found;
}

export async function importDictionary(rs, get){
  const {url, encoding, overrides = []} = rs.dictionary, data = await get(url);
  let rows;
  if(/\.xlsx?($|\?)/i.test(url)){
    const workbook = XLSX.read(data), sheet = workbook.Sheets[workbook.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(sheet, {defval:"", raw:false});
  } else rows = csvObjects(decode(data, encoding));
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
