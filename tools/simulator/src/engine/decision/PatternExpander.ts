import { DecisionCatalog } from "../../domain/decision/DecisionCatalog";
import { LegalPattern } from "../../domain/decision/LegalPattern";

export interface PatternView {
  readonly patternRef: number;
  readonly patternId: string;

  readonly actionId?: string;
  readonly actionName?: string;
  readonly keyCardText?: string;
  readonly keyUnitText?: string;
  readonly costText?: string;
  readonly targetText?: string;
  readonly effectSelectionText?: string;

  readonly summary: string;
}

/**
 * LegalPattern と DecisionCatalog を結合して、人間向け表示用モデル PatternView を生成するクラス。
 */
export class PatternExpander {
  static expandPattern(
    pattern: LegalPattern,
    catalog: DecisionCatalog,
    patternRef: number
  ): PatternView {
    const action = pattern.actionSelectionRef !== undefined ? catalog.actions[pattern.actionSelectionRef] : undefined;
    const keyCards = pattern.keyCardSelectionRef !== undefined ? catalog.cardSelections[pattern.keyCardSelectionRef] : undefined;
    const keyUnits = pattern.keyUnitSelectionRef !== undefined ? catalog.unitSelections[pattern.keyUnitSelectionRef] : undefined;
    const cost = pattern.costPaymentRef !== undefined ? catalog.costPayments[pattern.costPaymentRef] : undefined;
    const target = pattern.targetSelectionRef !== undefined ? catalog.targetSelections[pattern.targetSelectionRef] : undefined;

    const actionName = action?.actionName || action?.actionId || "アクション";
    const keyCardText = keyCards ? keyCards.displayCodes.join("+") : undefined;
    const keyUnitText = keyUnits ? keyUnits.displayNames.join(", ") : undefined;
    const costText = cost?.summary;
    const targetText = target?.displayName;

    const summaryParts: string[] = [actionName];
    if (keyCardText) summaryParts.push(`Key: [${keyCardText}]`);
    if (costText && costText !== "コストなし") summaryParts.push(`Cost: [${costText}]`);
    if (targetText && targetText !== "対象なし") summaryParts.push(`Target: [${targetText}]`);

    return {
      patternRef,
      patternId: pattern.patternId,
      actionId: action?.actionId,
      actionName,
      keyCardText,
      keyUnitText,
      costText,
      targetText,
      summary: summaryParts.join(" / "),
    };
  }

  static expandAll(patterns: readonly LegalPattern[], catalog: DecisionCatalog): PatternView[] {
    return patterns.map((p, index) => this.expandPattern(p, catalog, index));
  }
}
