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
    if (conditionStr === "target.size - key.rankValue <= 0") {
      const player = context.state.players[context.playerKey];
      const size = abilityEvaluator.calculateUnitSize(context.targetComponent, player);
      const keyVal = context.keyCard ? context.keyCard.value : 0;
      return size - keyVal <= 0;
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
      if (value === "keyCards.spade.rankValue" && context.keyCards) {
        const spadeCard = context.keyCards.find(
          (c: any) => c.suit === "S" || c.suit === "spade" || c.suit?.toLowerCase() === "spade"
        );
        return spadeCard ? spadeCard.value : 0;
      }
      if (value === "target" && context.targetComponent) {
        return context.targetComponent.unitId;
      }
    }
    return value;
  }

  /**
   * ユニットがターゲット条件を満たしているかを評価します。
   */
  evaluateTargetCondition(target: any, condition: Record<string, any>): boolean {
    if (!target) return false;
    if (condition.component) {
      return target.componentId === condition.component;
    }
    return true;
  }
}
