/* 粗大ごみナビ (https://sodaigominavi.com/about): official sorting dictionaries of ~1,000 municipalities as JSON.
   Terms: credit the municipality, its official URL and 粗大ごみナビ, and don't alter the values (names, categories and
   notes are shipped verbatim; only the bin colour is ours). Some lists are scraped from PDF layouts: entries that look like
   layout debris (table symbols, sentences, ※ notes, fragments) are left out, and a list with more than 5% debris or 30%
   entries that fit no bin is not used at all. */
import { download } from "../lib.mjs";
import { binsFor, clean } from "../dictionary.mjs";

export const PROVIDER = {name:"粗大ごみナビ", url:"https://sodaigominavi.com/bunbetsu"};
const API = "https://sodaigominavi.com/api/bunbetsu";
const SYMBOL = /[◎○〇△☆]|^該当(する|しない)/;
const DEBRIS = /[。！!※●■《》]|ください|^[・（(／/、,」』)）]|[／/・]$|^\d+$|^[①-⑳]/;
const debris = e => DEBRIS.test(e.item) || DEBRIS.test(e.category) || e.category.length > 20 || /(で|して|に|を)$/.test(e.category);
const MAX_DEBRIS = 0.05, MAX_UNPLACED = 0.3;
let INDEX;

/* JIS code ("13101") → index entry, or undefined when the municipality isn't covered */
export async function naviEntry(code){
  INDEX ??= JSON.parse((await download("sodaigominavi", `${API}/index`)).toString());
  return INDEX.municipalities.find(m => m.code === code);
}

/* {dict, entries, notes} for a municipality (checked by name), or null */
export async function naviDictionary(code, jp, bins){
  const entry = await naviEntry(code);
  if(!entry) return null;
  if(entry.name !== jp) return {dict:null, entries:[], notes:[`粗大ごみナビ code ${code} is ${entry.name}, not ${jp}; its dictionary is not used`]};
  const data = JSON.parse((await download("sodaigominavi", entry.json)).toString());
  const all = (data.entries ?? []).map(e => ({item:clean(e.item), category:clean(e.category), note:clean(e.note)})).filter(e => e.item && e.category);
  const share = n => n / (all.length || 1), pct = x => `${Math.round(x * 100)}%`;
  const junk = all.filter(debris).length;
  if(!all.length || share(junk) > MAX_DEBRIS) return {dict:null, entries:[], notes:[`粗大ごみナビ dictionary not used: ${pct(share(junk))} of its entries are PDF layout debris`]};
  const entries = all.filter(e => !debris(e) && !SYMBOL.test(e.category));
  const categories = [], catIndex = new Map();
  const items = entries.map(e => {
    if(!catIndex.has(e.category)){ catIndex.set(e.category, categories.length); categories.push({label:e.category, bins:binsFor(e.category, bins, {splitDot:true})}) }
    return [e.item, catIndex.get(e.category), e.note, ""];
  });
  const dropped = all.length - entries.length, unplaced = share(items.filter(i => !categories[i[1]].bins.length).length + dropped);
  const notes = dropped ? [`粗大ごみナビ: left out ${dropped} debris or table-symbol entries`] : [];
  if(!items.length || unplaced > MAX_UNPLACED) return {dict:null, entries:[], notes:[...notes, `粗大ごみナビ dictionary not used: ${pct(unplaced)} of its entries fit no bin`]};
  return {
    dict:{
      source:data.municipality?.officialUrl ?? data.source?.url ?? entry.sourceUrl, updated:(data.source?.fetchedAt ?? entry.fetchedAt).slice(0, 10), categories, items,
      provider:{...PROVIDER, page:data.page ?? entry.page},
    },
    entries:entries.map((e, i) => ({...e, bins:categories[items[i][1]].bins})),
    notes,
  };
}
