import { CommandContext } from "./CommandRegistry";
import { AbilityEvaluator } from "./AbilityEvaluator";

/**
 * 条件式判定やバインディング値の評価・解決を担当します。
 */
export class ExpressionEvaluator {
  /**
   * 条件判定を評価します。
   */
  evaluateCondition(
    conditionStr: string,
    context: CommandContext,
    abilityEvaluator: AbilityEvaluator
  ): boolean {
    if (conditionStr === "target.size <= 0") {
      const player = context.state.players[context.playerKey];
      const size = abilityEvaluator.calculateUnitSize(context.targetComponent, player);
      return size <= 0;
    }
    return false;
  }

  /**
   * バインディングされた値（文字列等）を解決します。
   */
  resolveBindingValue(value: any, context: CommandContext): any {
    if (typeof value === "string") {
      if (value === "key.rankValue" && context.keyCard) {
        return context.keyCard.value;
      }
      if (value === "-key.rankValue" && context.keyCard) {
        return -context.keyCard.value;
      }
      if (value === "target" && context.targetComponent) {
        return context.targetComponent.unitId;
      }
    }
    return value;
  }
}
