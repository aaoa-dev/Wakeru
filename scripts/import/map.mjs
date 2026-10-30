/* Builds the onboarding map: data/map/japan.json (prefecture outlines) and data/map/<pref>.json (municipality outlines,
   designated cities merged from their wards) as SVG path strings in one shared projection, so the app can zoom from
   Japan to a city by animating the viewBox.
   Boundaries: 国土数値情報（行政区域データ）（国土交通省）, simplified by smartnews-smri/japan-topography.
   Names: Digital Agency Address Base Registry city master. Usage: node scripts/import/map.mjs [--refresh] */
import path from "node:path";
import { ROOT, writeJSON, download, decode, unzipFirst, csvObjects } from "./lib.mjs";

const TOPO = "https://raw.githubusercontent.com/smartnews-smri/japan-topography/main/data/municipality/topojson";
const CITY_MASTER = "https://data.address-br.digital.go.jp/mt_city/mt_city_all.csv.zip";
const OUT = path.join(ROOT, "data/map");

/* equirectangular, scaled for latitude 36°; 1 unit ≈ 90 m */
const K = 1000, COS = Math.cos(36 * Math.PI / 180);
const project = ([lon, lat]) => [(lon - 122) * COS * K, (46 - lat) * K];
const r1 = n => Math.round(n * 10) / 10;

/* TopoJSON → rings of projected points, per geometry */
function decodeTopology(topo){
  const [sx, sy] = topo.transform.scale, [tx, ty] = topo.transform.translate;
  const arcs = topo.arcs.map(arc => { let x = 0, y = 0; return arc.map(([dx, dy]) => (x += dx, y += dy, project([x * sx + tx, y * sy + ty]))) });
  const ring = ids => ids.flatMap((i, n) => { const a = i < 0 ? [...arcs[~i]].reverse() : arcs[i]; return n ? a.slice(1) : a });
  const polygons = g => g.type === "Polygon" ? [g.arcs.map(ring)] : g.type === "MultiPolygon" ? g.arcs.map(p => p.map(ring)) : [];
  return Object.values(topo.objects)[0].geometries.map(g => ({props:g.properties, polygons:polygons(g)}));
}
const area = pts => Math.abs(pts.reduce((s, [x, y], i) => { const [x2, y2] = pts[(i + 1) % pts.length]; return s + x * y2 - x2 * y }, 0)) / 2;
/* path with relative moves, one decimal */
function pathOf(polygons){
  let d = "";
  for(const poly of polygons) for(const pts of poly){
    let [px, py] = pts[0].map(r1); d += `M${px} ${py}l`;
    d += pts.slice(1).map(([x, y]) => { const nx = r1(x), ny = r1(y), s = `${r1(nx - px)} ${r1(ny - py)}`; px = nx; py = ny; return s }).join(" ") + "z";
  }
  return d;
}
/* the bbox to zoom to: the biggest polygons making up 80% of the area, so far-off islands don't shrink the view */
function focusBox(polygons){
  const outer = polygons.map(p => p[0]).map(pts => ({pts, a:area(pts)})).sort((a, b) => b.a - a.a);
  const total = outer.reduce((s, o) => s + o.a, 0);
  let sum = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for(const o of outer){
    for(const [x, y] of o.pts){ x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
    if((sum += o.a) >= total * 0.8) break;
  }
  return [x0, y0, x1 - x0, y1 - y0].map(Math.round);
}
const stripEn = s => (s ?? "").replace(/-(shi|ku|machi|cho|mura|son)$/i, "");

/* the 2021 boundaries still have 浜松市's old wards (reorganised 2024): unknown ward codes fall back to the city by name */
const cities = csvObjects(decode(unzipFirst(await download("map", CITY_MASTER)))).filter(r => !r.ablt_date);
const byCode = new Map(cities.map(r => [r.lg_code.slice(0, 5), r]));
/* a designated city's own row (no ward), found from one of its wards */
const cityOf = ward => cities.find(r => r.pref === ward.pref && r.city === ward.city && !r.ward);
/* its current wards, for matching the reverse geocoder's ward codes */
const wardsOf = city => cities.filter(r => r.pref === city.pref && r.city === city.city && r.ward).map(r => ({code:r.lg_code.slice(0, 5), jp:r.ward, en:r.ward_roma}));

/* Japan */
const prefTopo = JSON.parse((await download("map", `${TOPO}/s0001/prefectures.json`)).toString());
const prefNames = [...new Map(cities.map(r => [r.pref, {code:r.lg_code.slice(0, 2), en:r.pref_roma}])).entries()];
const prefs = decodeTopology(prefTopo).map(({props, polygons}) => {
  const [jp, p] = prefNames.find(([jp]) => jp === props.N03_001);
  return {code:p.code, jp, en:p.en, d:pathOf(polygons), box:focusBox(polygons)};
}).sort((a, b) => a.code.localeCompare(b.code));
const VIEW = [project([127.5, 45.6]), project([146.2, 26])];
writeJSON(path.join(OUT, "japan.json"), {
  _source:"出典：国土数値情報（行政区域データ）（国土交通省）を加工して作成 (simplified by smartnews-smri/japan-topography); names: Address Base Registry (Digital Agency)",
  view:[...VIEW[0], VIEW[1][0] - VIEW[0][0], VIEW[1][1] - VIEW[0][1]].map(Math.round), prefs,
});

/* prefectures */
let total = 0;
for(const pref of prefs){
  const topo = JSON.parse((await download("map", `${TOPO}/s0010/N03-21_${pref.code}_210101.json`)).toString());
  const groups = new Map();
  for(const {props, polygons} of decodeTopology(topo)){
    if(!props.N03_007) continue; // 所属未定地 (disputed areas without a municipality)
    const row = byCode.get(props.N03_007) ?? (props.N03_003?.endsWith("市") && {...cityOf({pref:props.N03_001, city:props.N03_003}), ward:props.N03_004});
    if(!row?.lg_code) throw new Error(`${props.N03_001}${props.N03_004} (${props.N03_007}) is not in the city master`);
    const city = row.ward ? cityOf(row) : row, code = city.lg_code.slice(0, 5);
    const g = groups.get(code) ?? {code, jp:city.city, en:stripEn(city.city_roma), polygons:[], wards:row.ward ? wardsOf(city) : []};
    g.polygons.push(...polygons);
    groups.set(code, g);
  }
  const munis = [...groups.values()].map(g => ({code:g.code, jp:g.jp, en:g.en, d:pathOf(g.polygons), box:focusBox(g.polygons), ...(g.wards.length ? {wards:g.wards} : {})}))
    .sort((a, b) => a.code.localeCompare(b.code));
  const file = path.join(OUT, `${pref.code}.json`);
  writeJSON(file, {munis});
  total += munis.length;
}
console.log(`map: ${prefs.length} prefectures, ${total} municipalities → ${path.relative(ROOT, OUT)}`);
