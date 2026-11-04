/** Shared column patterns for automated HTML schedule probing (matches html-weekly.mjs). */
export const GENERIC_HTML_PROBE_COLUMNS = [
  {header: /^(地域|収集地区|地区|地域名|収集区域|町名|大字名)$/},
  {header: /リサイクル資源|資源ごみ|資源物|びん・缶|缶・びん/, bins: ["res"]},
  {header: /プラスチック|^プラ$|容器包装/, bins: ["plastic"]},
  {header: /可燃|燃やす|燃える/, bins: ["burnable"]},
  {header: /不燃|燃やさない|燃やせない/, bins: ["non_burnable"]},
];

export const GENERIC_HTML_PROBE_BINS = {
  burnable: {label: "可燃ごみ", en: "Burnable", kind: "burn"},
  plastic: {label: "プラスチック", en: "Plastic", kind: "pla"},
  res: {label: "資源ごみ", en: "Recyclables", kind: "res"},
  non_burnable: {label: "燃やさないごみ", en: "Non-burnable", kind: "non"},
  no: {label: "収集しないもの", en: "Not collected", kind: "no"},
};
