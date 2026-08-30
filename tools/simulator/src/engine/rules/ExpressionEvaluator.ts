import { CommandContext } from "./CommandRegistry";
import { AbilityEvaluator } from "./AbilityEvaluator";
import { rankToValue } from "./cardUtils";

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
    abilityEvaluator?: AbilityEvaluator
  ): boolean {
    if (!conditionStr || typeof conditionStr !== "string") return false;

    // || で分割
    const orParts = conditionStr.split("||").map((s) => s.trim());
    if (orParts.length > 1) {
      return orParts.some((part) => this.evaluateCondition(part, context, abilityEvaluator));
    }

    // && で分割
    const andParts = conditionStr.split("&&").map((s) => s.trim());
    if (andParts.length > 1) {
      return andParts.every((part) => this.evaluateCondition(part, context, abilityEvaluator));
    }

    // 比較演算子の検出 (>=, <=, ==, !=, >, <)
    const opMatch = conditionStr.match(/(>=|<=|==|!=|>|<)/);
    if (!opMatch) {
      const val = this.resolveNumericValue(conditionStr.trim(), context, abilityEvaluator);
      return Boolean(val);
    }

    const op = opMatch[1];
    const leftStr = conditionStr.substring(0, opMatch.index!).trim();
    const rightStr = conditionStr.substring(opMatch.index! + op.length).trim();

    const leftVal = this.evaluateArithmetic(leftStr, context, abilityEvaluator);
    const rightVal = this.evaluateArithmetic(rightStr, context, abilityEvaluator);

    switch (op) {
      case "==": return leftVal === rightVal;
      case "!=": return leftVal !== rightVal;
      case ">=": return leftVal >= rightVal;
      case "<=": return leftVal <= rightVal;
      case ">": return leftVal > rightVal;
      case "<": return leftVal < rightVal;
      default: return false;
    }
  }

  private evaluateArithmetic(
    expr: string,
    context: CommandContext,
    abilityEvaluator?: AbilityEvaluator
  ): number {
    expr = expr.trim();
    const tokens = expr.split(/\s*([+-])\s*/).filter(Boolean);
    if (tokens.length <= 1) {
      return this.resolveNumericValue(tokens[0] || expr, context, abilityEvaluator);
    }

    let result = this.resolveNumericValue(tokens[0], context, abilityEvaluator);
    for (let i = 1; i < tokens.length; i += 2) {
      const op = tokens[i];
      const nextVal = this.resolveNumericValue(tokens[i + 1], context, abilityEvaluator);
      if (op === "+") result += nextVal;
      if (op === "-") result -= nextVal;
    }
    return result;
  }

  private resolveNumericValue(
    token: string,
    context: CommandContext,
    abilityEvaluator?: AbilityEvaluator
  ): number {
    token = token.trim();
    const num = Number(token);
    if (!isNaN(num)) return num;

    if (token === "target.size" && context.targetComponent) {
      return abilityEvaluator ? abilityEvaluator.calculateUnitSize(context.targetComponent, context.state) : 0;
    }

    if (token === "key.rankValue") {
      const card = context.keyCard || context.keyCards?.[0];
      if (!card) return 0;
      return card.value !== undefined ? card.value : rankToValue(card.rank);
    }

    if (token === "targetRequest.keyCards.count") {
      return Array.isArray(context.targetRequest?.keyCards) ? context.targetRequest.keyCards.length : 0;
    }

    if (
      token === "targetRequest.keyCards.first.rankValue" ||
      token === "targetRequest.keyCard.rankValue"
    ) {
      const card = context.targetRequest?.keyCards?.[0];
      if (!card) return 0;
      return card.value !== undefined ? card.value : rankToValue(card.rank);
    }

    return 0;
  }

  /**
   * バインディングされた値（文字列等）を解決します。
   */
  resolveBindingValue(value: any, context: CommandContext): any {
    if (typeof value === "string") {
      if (value === "key.rankValue" && context.keyCard) {
        return context.keyCard.value !== undefined ? context.keyCard.value : rankToValue(context.keyCard.rank);
      }
      if (value === "-key.rankValue" && context.keyCard) {
        const val = context.keyCard.value !== undefined ? context.keyCard.value : rankToValue(context.keyCard.rank);
        return -val;
      }
      if (value === "keyCards.spade.rankValue" && context.keyCards) {
        const spadeCard = context.keyCards.find(
          (c: any) => c.suit === "S" || c.suit === "spade" || c.suit?.toLowerCase() === "spade"
        );
        return spadeCard ? (spadeCard.value !== undefined ? spadeCard.value : rankToValue(spadeCard.rank)) : 0;
      }
      if (value === "target" && context.targetComponent) {
        return context.targetComponent.unitId;
      }
      if (value === "targetRequest" && context.targetRequest) {
        return context.targetRequest.id;
      }
      if (value.startsWith("selection.")) {
        const selectionId = value.substring("selection.".length);
        return context.selections?.[selectionId];
      }
      if (value.startsWith("sourceEvent.")) {
        const path = value.substring("sourceEvent.".length).split(".");
        let current: any = context.sourceEvent;
        for (const segment of path) {
          if (current === undefined || current === null) return undefined;
          current = current[segment];
        }
        return current;
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

