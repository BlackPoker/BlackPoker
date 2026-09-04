/**
 * 決定論的 Logical Pattern Key を生成。
 * 各 LegalPattern の selection refs から意味論的な一意識別キーを算出します。
 */
export function generateLogicalPatternKey(pattern: {
  kind: string;
  actionSelectionRef?: number;
  keyCardSelectionRef?: number;
  keyUnitSelectionRef?: number;
  costPaymentRef?: number;
  targetSelectionRef?: number;
  effectSelectionRef?: number;
  orderSelectionRef?: number;
}): string {
  if (pattern.kind === "PASS") return "PASS";
  const parts = [pattern.kind];
  if (pattern.actionSelectionRef !== undefined) parts.push(`a=${pattern.actionSelectionRef}`);
  if (pattern.keyCardSelectionRef !== undefined) parts.push(`k=${pattern.keyCardSelectionRef}`);
  if (pattern.keyUnitSelectionRef !== undefined) parts.push(`ku=${pattern.keyUnitSelectionRef}`);
  if (pattern.costPaymentRef !== undefined) parts.push(`c=${pattern.costPaymentRef}`);
  if (pattern.targetSelectionRef !== undefined) parts.push(`t=${pattern.targetSelectionRef}`);
  if (pattern.effectSelectionRef !== undefined) parts.push(`e=${pattern.effectSelectionRef}`);
  if (pattern.orderSelectionRef !== undefined) parts.push(`o=${pattern.orderSelectionRef}`);
  return parts.join("|");
}
