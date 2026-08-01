export const VALID_COST_SYMBOLS = ["B", "L", "D"] as const;
export type CostSymbol = typeof VALID_COST_SYMBOLS[number];

/**
 * コスト文字列（例: "BL", "BBL"）をパースし、CostSymbolの配列に正規化します。
 * 単なる1文字分割ではなく、キーワードマッチングによる簡易字句解析方式を採用し、将来の拡張性を担保します。
 */
export function parseCost(costStr: string): CostSymbol[] {
  const symbols: CostSymbol[] = [];
  const normalized = costStr.trim().toUpperCase();
  let i = 0;
  while (i < normalized.length) {
    let matched = false;
    for (const sym of VALID_COST_SYMBOLS) {
      if (normalized.startsWith(sym, i)) {
        symbols.push(sym);
        i += sym.length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      throw new Error(`未知のコストシンボルです: ${normalized.substring(i)}`);
    }
  }
  return symbols;
}
