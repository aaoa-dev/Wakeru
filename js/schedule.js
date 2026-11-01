/* Collection-day rules, shared by the app and the importer's cross-check.
   A rule is [weekdays] (weekly), {days:[weekdays]}, {day, weeks} (nth weekday of the month), {dates:[ISO]} or {any:[rule…]};
   object rules can carry except:[ISO] (cancelled) and add:[ISO] (extra collection). */
export const pad = n => String(n).padStart(2, "0");
export const iso = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

export function hits(rule, d){
  const day = iso(d);
  if(rule.except?.includes(day)) return false;
  if(rule.add?.includes(day)) return true;
  if(Array.isArray(rule)) return rule.includes(d.getDay());
  if(rule.any) return rule.any.some(r => hits(r, d));
  if(rule.days) return rule.days.includes(d.getDay());
  if(rule.dates) return rule.dates.includes(day);
  return rule.day === d.getDay() && rule.weeks.includes(Math.ceil(d.getDate()/7));
}

/* An explicit date from an official calendar wins over a broad recurring closure.
   This matters at year-end, when some districts still have a final pickup on a day
   that a generic importer otherwise marks as part of the holiday closure. */
export function explicitlyIncludes(rule, d){
  const day = iso(d);
  if(rule?.except?.includes(day)) return false;
  if(rule?.add?.includes(day) || rule?.dates?.includes(day)) return true;
  return rule?.any?.some(r => explicitlyIncludes(r, d)) ?? false;
}

/* "unpublished" = outside the published period, "unconfirmed" = a window the source couldn't confirm (New Year),
   "off" = no collection at all that day, "" = a normal day */
export function dayState(cal, d){
  const day = iso(d), md = day.slice(5), nc = cal.noCollection;
  if((cal.validTo && day > cal.validTo) || (cal.validFrom && day < cal.validFrom)) return "unpublished";
  if(cal.unknown?.some(u => u.from <= day && day <= u.to)) return "unconfirmed";
  if(nc.weekdays.includes(d.getDay()) || nc.dates.includes(md)) return "off";
  return "";
}

/* bins collected on a normal day */
export function binsOn(cal, pattern, d){
  const md = iso(d).slice(5);
  const globallyOff = cal.noCollection.weekdays.includes(d.getDay()) || cal.noCollection.dates.includes(md);
  return Object.entries(pattern).filter(([bin, rule]) => rule && hits(rule, d)
    && (!globallyOff || explicitlyIncludes(rule, d))
    && !(cal.noCollection.bins?.[bin] ?? []).includes(md)).map(([bin]) => bin);
}
