import { ruleCatalog as sourceCatalog } from "../generated/ruleCatalog";

// 正規YAML・生成データ・canonical IDは変えず、Web上のスート表記だけを統一する。
export const ruleCatalog: typeof sourceCatalog = JSON.parse(
  JSON.stringify(sourceCatalog).replace(/♡/g, "♥").replace(/♢/g, "♦"),
);
