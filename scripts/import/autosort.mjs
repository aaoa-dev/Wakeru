/* English guide for municipalities without a curated sorting table: each material type is matched to a few typical item
   names in the official dictionary. A type gets a bin only when every matching entry agrees on one bin; the note says it
   was auto-matched and quotes the entry. Types with no clear answer stay out, and the app hides items that need them. */

/* whole item names only. Exact names are used when the list has them; otherwise a name with one closing bracketed
   qualifier (「乾電池（アルカリ）」), never more words (「空き缶圧縮器」, 「DVD(ブルーレイ)レコーダー」) */
const NAMES = {
  food: "生ごみ|野菜くず|残飯|食べ残し|果物の皮",
  hygiene: "紙おむつ|ティッシュ|ティッシュペーパー|マスク",
  wood: "木の枝|枝|割りばし|割り箸|割箸",
  textile: "衣類|古着|古布",
  "leather-rubber": "革靴|ゴム手袋|ゴムホース|長靴",
  "paper-dirty": "感熱紙|レシート|写真",
  "paper-misc": "雑がみ|雑紙|包装紙|お菓子の箱|菓子箱",
  newspaper: "新聞|新聞紙",
  magazine: "雑誌|本|書籍",
  cardboard: "段ボール|ダンボール|段ボール箱",
  carton: "紙パック|牛乳パック",
  pet: "ペットボトル",
  can: "空き缶|空缶|飲料缶|アルミ缶|スチール缶",
  bottle: "空きびん|空きビン|空き瓶|飲料びん|ビールびん|一升びん",
  "glass-other": "化粧品のびん|化粧びん|陶磁器|割れたガラス",
  metal: "アルミホイル|なべ|鍋|フライパン|傘|かさ",
  blade: "包丁|ほうちょう|カミソリ|かみそり|はさみ|ハサミ",
  "plastic-pack": "プラスチック製容器包装|プラ容器包装|容器包装プラスチック",
  "plastic-product": "プラスチック製品|ポリバケツ|CD|DVD",
  "plastic-dirty": "汚れたプラスチック|汚れが落ちないプラスチック|汚れの落ちないプラスチック",
  "foam-tray": "食品トレイ|トレイ|トレー|発泡スチロールトレイ",
  battery: "乾電池",
  "battery-li": "リチウムイオン電池|モバイルバッテリー|充電式電池",
  spray: "スプレー缶|カセットボンベ|ガスボンベ|エアゾール缶",
  lighter: "使い捨てライター|ライター",
  fluorescent: "蛍光灯|蛍光管|水銀体温計",
  "appliance-small": "ドライヤー|ヘアドライヤー|電気ポット|トースター|携帯電話",
  oil: "食用油|てんぷら油|天ぷら油",
  oversized: "たんす|タンス|布団|ふとん|自転車|ソファ|ソファー",
  "appliance-law": "テレビ|冷蔵庫|洗濯機|エアコン",
  pc: "パソコン|ノートパソコン|デスクトップパソコン",
  "not-collected": "消火器",
};
const EXCLUDE = "(?!.*(キャップ|ラベル|ふた|フタ|以外|除く|フィルム|包装|木製|紙製|革|キーボード|マウス|周辺|スキャナー|プリンター|表示装置|ディスプレイ|モニター|部品|付属))";
/* the bin to pick when an entry's category spans several (「缶・びん・ペットボトル」) */
const PREFER = {pet:"pet_bottle", can:"beverage_can", bottle:"glass_bottle", spray:"spray_can", newspaper:"paper", magazine:"paper", cardboard:"paper", carton:"paper", textile:"cloth"};
const TYPES = Object.fromEntries(Object.entries(NAMES).map(([t, names]) =>
  [t, {exact:new RegExp(`^(${names})$`), qualified:new RegExp(`^${EXCLUDE}(${names})\\([^()]*\\)$`)}]));

/* entries: [{item, category, bins}] → {type: {bin, note, auto:true}} */
export function autoSorting(entries){
  const sorting = {};
  const named = entries.map(e => ({...e, name:e.item.normalize("NFKC")}));
  for(const [type, {exact, qualified}] of Object.entries(TYPES)){
    const exactHits = named.filter(e => exact.test(e.name));
    const matched = exactHits.length ? exactHits : named.filter(e => qualified.test(e.name));
    const picks = matched.map(e => e.bins.length === 1 ? e.bins[0] : e.bins.includes(PREFER[type]) ? PREFER[type] : null);
    if(!picks.length || picks.includes(null) || new Set(picks).size !== 1) continue;
    const e = matched[0];
    sorting[type] = {bin:picks[0], note:`Auto-matched: the official list puts 「${e.item}」 under 「${e.category}」.`, auto:true};
  }
  return sorting;
}

/* the plastic test, when the matched guide is clear enough to give one; null hides it */
export function autoPlasticTest(sorting, bins){
  const pack = sorting["plastic-pack"]?.bin, product = sorting["plastic-product"]?.bin, dirty = sorting["plastic-dirty"]?.bin;
  if(!pack || bins[pack].kind !== "pla" || !product || !dirty || dirty === pack) return null;
  const products = product === pack, to = bins[pack].en, other = bins[dirty].en;
  return {
    maxCm:null, products, bin:pack, otherwise:dirty,
    summary:products ? `Clean plastic packaging and clean plastic products go to ${to}. Dirty plastic goes to ${other}.`
      : `Only clean plastic packaging goes to ${to}. Plastic products go to ${bins[product].en}, dirty plastic to ${other}.`,
  };
}
