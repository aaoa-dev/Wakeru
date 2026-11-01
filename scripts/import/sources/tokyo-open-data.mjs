/* Official CC BY sorting dictionaries published through the Tokyo Open Data Catalog.
   These are preferred over PDF-derived third-party dictionaries when a municipality publishes a machine-readable list. */
import { importDictionary } from "../dictionary.mjs";

const LICENSE = "CC BY 4.0";
const SOURCES = {
  "13115": {
    url:"https://www.city.suginami.tokyo.jp/documents/713/a2.csv",
    updated:"2025-12-12",
  },
  "13119": {
    url:"https://www.opendata.metro.tokyo.lg.jp/itabashi/131199_itabashiku_garbage_separate.csv",
    encoding:"Shift_JIS",
    updated:"2025-12-12",
  },
  "13208": {
    url:"https://www.city.chofu.lg.jp/documents/13850/132080_garbage_separation.csv",
    updated:"2026-05-14",
  },
  "13205": {
    url:"https://www.opendata.metro.tokyo.lg.jp/ome/ods/132055_garbage_separation.xlsx",
    updated:"2025-12-12",
  },
};

export async function tokyoDictionary(code, bins, get){
  const dictionary = SOURCES[code];
  if(!dictionary) return null;
  const dict = await importDictionary({bins, dictionary}, get);
  dict.license = LICENSE;
  const entries = dict.items.map(([item, category, note]) => ({
    item,
    category:dict.categories[category].label,
    note,
    bins:dict.categories[category].bins,
  }));
  return {dict, entries};
}
