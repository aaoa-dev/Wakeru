/* One municipality per prefecture (first onboarding map pass). Skipped when that pref already has coverage. */
import { convert5374 } from "../sources/5374-area-days.mjs";
import * as otsu from "../sources/otsu-weekly.mjs";
import * as shizuoka from "../sources/shizuoka-city.mjs";
import * as takamatsu from "../sources/takamatsu-fact.mjs";
import * as oita from "../sources/oita-schedule.mjs";
import * as nanbu from "../sources/nanbu-yamanashi.mjs";
import * as nagasaki from "../sources/nagasaki-xls.mjs";
import * as nagaoka from "../sources/nagaoka-matrix.mjs";
import * as saijo from "../sources/saijo-static.mjs";
import * as kochiCity from "../sources/kochi-city-static.mjs";
import * as arao from "../sources/arao-static.mjs";
import * as hyuga from "../sources/hyuga-static.mjs";
import * as izumi from "../sources/izumi-static.mjs";

const FY = {validFrom:"2026-04-01", validTo:"2027-03-31"};

/** @type {{id:string, code:string, pref:string, jp:string, en:string, url:string}[]} */
export const SEEDS_5374 = [
  {id:"oshu", code:"03215", pref:"03", jp:"奥州市", en:"Oshu", url:"http://linkdata.org/api/1/rdf1s4773i/area_days.csv"},
  {id:"akita", code:"05201", pref:"05", jp:"秋田市", en:"Akita", url:"http://linkdata.org/api/1/rdf1s4763i/area_days.csv"},
  {id:"yamagata", code:"06201", pref:"06", jp:"山形市", en:"Yamagata", url:"http://linkdata.org/api/1/rdf1s4783i/area_days.csv"},
  {id:"koriyama", code:"07203", pref:"07", jp:"郡山市", en:"Koriyama", url:"http://linkdata.org/api/1/rdf1s4770i/area_days.csv"},
  {id:"tsukuba", code:"08220", pref:"08", jp:"つくば市", en:"Tsukuba", url:"http://tsukuba.5374.jp/data/area_days.csv"},
  {id:"kanuma", code:"09205", pref:"09", jp:"鹿沼市", en:"Kanuma", url:"http://kanuma.5374.jp/data/area_days.csv"},
  {id:"funabashi", code:"12204", pref:"12", jp:"船橋市", en:"Funabashi", url:"http://funabashi.5374.jp/data/area_days.csv"},
  {id:"toyama-city", code:"16201", pref:"16", jp:"富山市", en:"Toyama", url:"http://toyama.5374.jp/data/area_days.csv"},
  {id:"shiojiri", code:"20215", pref:"20", jp:"塩尻市", en:"Shiojiri", url:"http://shiojiri.5374.jp/data/area_days.csv"},
  {id:"mitake", code:"21521", pref:"21", jp:"御嵩町", en:"Mitake", url:"http://mitake.5374.jp/data/area_days.csv"},
  {id:"handa", code:"23205", pref:"23", jp:"半田市", en:"Handa", url:"http://linkdata.org/api/1/rdf1s7640i/handa_gomi_area_days.csv"},
  {id:"iga", code:"24216", pref:"24", jp:"伊賀市", en:"Iga", url:"http://iga.5374.jp/data/area_days.csv"},
  {id:"fukuchiyama", code:"26201", pref:"26", jp:"福知山市", en:"Fukuchiyama", url:"http://fukuchiyama.5374.jp/data/area_days.csv"},
  {id:"amagasaki", code:"28202", pref:"28", jp:"尼崎市", en:"Amagasaki", url:"http://amagasaki.5374.jp/data/area_days.csv"},
  {id:"ikoma", code:"29209", pref:"29", jp:"生駒市", en:"Ikoma", url:"http://ikoma.5374.jp/data/area_days.csv"},
  {id:"wakayama-city", code:"30201", pref:"30", jp:"和歌山市", en:"Wakayama", url:"http://wakayama.5374.jp/data/area_days.csv"},
  {id:"tottori-city", code:"31201", pref:"31", jp:"鳥取市", en:"Tottori", url:"http://linkdata.org/api/1/rdf1s1265i/area_days.csv"},
  {id:"matsue", code:"32201", pref:"32", jp:"松江市", en:"Matsue", url:"http://matsue.5374.jp/data/area_days.csv"},
  {id:"hiroshima-city", code:"34100", pref:"34", jp:"広島市", en:"Hiroshima", url:"http://hiroshima.5374.jp/data/area_days.csv"},
  {id:"ube", code:"35202", pref:"35", jp:"宇部市", en:"Ube", url:"https://yamaguchi-opendata.jp/ckan/dataset/352021_garbage_collection/resource/d0a1471d-b117-46dd-bee1-17341799000c/download"},
  {id:"tokushima-city", code:"36201", pref:"36", jp:"徳島市", en:"Tokushima", url:"http://tokushima.5374.jp/data/area_days.csv"},
  {id:"fukuoka-city", code:"40130", pref:"40", jp:"福岡市", en:"Fukuoka", url:"http://fukuoka.5374.jp/data/area_days.csv"},
  {id:"saga-city", code:"41201", pref:"41", jp:"佐賀市", en:"Saga", url:"http://saga.5374.jp/data/area_days.csv"},
  {id:"naha", code:"47201", pref:"47", jp:"那覇市", en:"Naha", url:"http://naha.5374.jp/data/area_days.csv"},
].map(s => ({...FY, ...s}));

export const SEEDS_CUSTOM = [
  {id:"otsu", code:"25201", pref:"25", source:otsu.SOURCE, convert:otsu.convert},
  {id:"shizuoka", code:"22100", pref:"22", source:shizuoka.SOURCE, convert:shizuoka.convert},
  {id:"takamatsu", code:"37201", pref:"37", source:takamatsu.SOURCE, convert:takamatsu.convert},
  {id:"oita", code:"44201", pref:"44", source:oita.SOURCE, convert:oita.convert},
  {id:"nanbu", code:"19366", pref:"19", source:nanbu.SOURCE, convert:nanbu.convert},
  {id:"nagasaki", code:"42201", pref:"42", source:nagasaki.SOURCE, convert:nagasaki.convert},
  {id:"nagaoka", code:"15202", pref:"15", source:nagaoka.SOURCE, convert:nagaoka.convert},
  {id:"saijo", code:"38207", pref:"38", source:saijo.SOURCE, convert:saijo.convert},
  {id:"kochi-city", code:"39201", pref:"39", source:kochiCity.SOURCE, convert:kochiCity.convert},
  {id:"arao", code:"43204", pref:"43", source:arao.SOURCE, convert:arao.convert},
  {id:"hyuga", code:"45206", pref:"45", source:hyuga.SOURCE, convert:hyuga.convert},
  {id:"izumi", code:"46208", pref:"46", source:izumi.SOURCE, convert:izumi.convert},
];

export function seed5374Entries(){
  return SEEDS_5374.map(spec => ({
    id:spec.id, code:spec.code, pref:spec.pref,
    source:{name:"5374 area_days.csv", url:spec.url, license:"Municipality open data"},
    convert:today => convert5374(spec, today),
  }));
}
