/** Align catalog rows with Digital Agency city codes (pref + jp) and dedupe by code. */
export function normalize5374Catalog(entries, cities){
  const byPrefJp = new Map(cities.map(c => [`${c.pref}:${c.jp}`, c]));
  const score = row => (row.url?.includes(".5374.jp") && !row.url.includes("linkdata") ? 2 : row.url?.includes("linkdata") ? 1 : 0);
  const merged = new Map();

  for(const m of entries){
    const city = byPrefJp.get(`${m.pref}:${m.jp}`);
    if(!city) continue;
    let row = {...m, code: city.code, en: city.en};
    if(/-\d{5}$/.test(row.id)) row.id = `${row.id.replace(/-\d{5}$/, "")}-${row.code}`;
    const prev = merged.get(row.code);
    if(!prev || score(row) >= score(prev)) merged.set(row.code, row);
  }

  return [...merged.values()].sort((a, b) => a.pref.localeCompare(b.pref) || a.code.localeCompare(b.code));
}
