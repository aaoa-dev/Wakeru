# Wakeru — handoff for repo setup (2026-10-29)

**Live proof of concept:** https://claude.ai/artifact/2osS2r2gU7zV1VuysZnB23

## Files
- `index.html`: the whole app (UI, search, schedule logic). It reads one data file.
- `data/wakeru.json`: all data.
  - `types`: material types (clean plastic packaging, dirty plastic, metal, battery…)
  - `items`: 72 shared everyday items, each tagged with material types (no bins)
  - `glossary`: bin vocabulary and what other cities call each bin
  - `rulesets.chiyoda`: bin names, the material type → bin table (`sorting`), and the pickup calendar (12 patterns, no-collection days, put-out times)
  - `locations`: `iwamotocho` (Iwamotocho 1–3, pattern E) and `chiyoda` (all 78 address groups)

## Iwamotocho schedule (pattern E)
Burnable Mon & Thu · Recyclables Tue (8:30) · Plastic Fri (8:30) · Non-burnable + hazardous 1st & 3rd Sat (10:00 / 12:30). No pickup on Sundays or Dec 31 – Jan 3.
Still to confirm on the 集積所 sign: the burnable put-out time (8:30, 9:30 or 12:30).

## Next steps
1. Create the repo; split `wakeru.json` into shared items plus one file per ward.
2. Write importers for wards' official open-data CSVs (standard open dataset, mostly CC BY 4.0). Run them in a GitHub Action, since this workspace can't download from ward sites.
   - Sorting dictionaries: at least 15 of 23 wards publish them.
   - Address schedules as data: few wards. Taito does. Most others need PDF transcription.
3. Start the importers with Taito (it publishes both datasets) and Chiyoda.

## Sources
- Chiyoda sorting page: https://www.city.chiyoda.lg.jp/koho/kurashi/gomi/wakekata/index.html
- Chiyoda pamphlet (FY2025): https://www.city.chiyoda.lg.jp/documents/1952/r701pamphlet.pdf
- Taito open data: https://www.city.taito.lg.jp/kusei/online/opendata/koutu/gomibunbetuitiran.html
- Setagaya open data: https://www.city.setagaya.lg.jp/opendata/22308.html
- Municipalities with sorting data: https://gomitochan.jp/available-list-of-garbageitems/
