import type { ComponentDefinition } from "../../domain/rules/RulePackage";
import { isCharacterComponent, getCharacterType } from "./characterUtils";
import { normalizeSuit } from "./cardUtils";

export type TargetConditionEvaluationResult = {
  readonly isValid: boolean;
  readonly reason?: string;
  readonly detail?: string;
};

/**
 * ActionDefinition.targets[].condition に記述されたユニット対象条件を評価します。
 */
export function evaluateUnitTargetCondition(
  unit: any,
  condition: Record<string, any> | undefined,
  context: {
    components?: readonly ComponentDefinition[];
    keyCard?: any;
    keyCards?: readonly any[];
    playerKey?: string;
    unitOwnerKey?: string;
  } = {}
): TargetConditionEvaluationResult {
  if (!unit) {
    return { isValid: false, reason: "TARGET_MISSING", detail: "対象ユニットが存在しません。" };
  }

  if (!condition) {
    return { isValid: true };
  }

  // 1. component: 特定のコンポーネントID一致 (例: character.soldier, character.bulwark)
  if (condition.component) {
    if (unit.componentId !== condition.component) {
      return {
        isValid: false,
        reason: "TARGET_CONDITION_UNMET",
        detail: `ターゲットコンポーネントが条件を満たしていません。要求: ${condition.component}, 実際: ${unit.componentId}`,
      };
    }
  }

  // 2. componentType: "character" 等の一致
  if (condition.componentType === "character") {
    if (!isCharacterComponent(unit, context.components)) {
      return {
        isValid: false,
        reason: "TARGET_CONDITION_UNMET",
        detail: "ターゲットがキャラクターではありません。",
      };
    }

    // キャラクターの基本状態（charge または drive）
    if (unit.state !== "charge" && unit.state !== "drive") {
      return {
        isValid: false,
        reason: "TARGET_CONDITION_UNMET",
        detail: `ターゲットユニットの状態が不適合です。期待: charge または drive, 実際: ${unit.state}`,
      };
    }
  }

  // 3. characterType: "soldier", "bulwark" 等の一致
  if (condition.characterType) {
    const charType = getCharacterType(unit, context.components);
    if (charType !== condition.characterType) {
      return {
        isValid: false,
        reason: "TARGET_CONDITION_UNMET",
        detail: `ターゲットのキャラクタータイプが不適合です。要求: ${condition.characterType}, 実際: ${charType}`,
      };
    }
  }

  // 4. state: YAMLで明示的に状態条件（例: charge / drive）が指定されている場合のみ検証
  if (condition.state) {
    const expectedStates = Array.isArray(condition.state) ? condition.state : [condition.state];
    if (!expectedStates.includes(unit.state)) {
      return {
        isValid: false,
        reason: "TARGET_CONDITION_UNMET",
        detail: `ターゲットユニットの状態が不適合です。期待: ${expectedStates.join(", ")}, 実際: ${unit.state}`,
      };
    }
  }

  // 5. relation: "self" (自軍) / "opponent" (敵軍)
  if (condition.relation && context.playerKey && context.unitOwnerKey) {
    if (condition.relation === "self" && context.unitOwnerKey !== context.playerKey) {
      return {
        isValid: false,
        reason: "TARGET_CONDITION_UNMET",
        detail: "ターゲットユニットは自分のフィールドに存在する必要があります。",
      };
    }
    if (condition.relation === "opponent" && context.unitOwnerKey === context.playerKey) {
      return {
        isValid: false,
        reason: "TARGET_CONDITION_UNMET",
        detail: "ターゲットユニットは対戦相手のフィールドに存在する必要があります。",
      };
    }
  }

  // 6. matchSuitWithKey: キーカードとのスート一致 (例: 装備)
  if (condition.matchSuitWithKey) {
    const keyCard = context.keyCard || (context.keyCards && context.keyCards[0]);
    const targetCard = unit.cards?.[0];
    const targetSuit = unit.suit || targetCard?.suit;
    if (keyCard && targetSuit) {
      if (normalizeSuit(keyCard.suit) !== normalizeSuit(targetSuit)) {
        return {
          isValid: false,
          reason: "TARGET_CONDITION_UNMET",
          detail: `キーカードとターゲットのスートが一致しません。キー: ${keyCard.suit}, ターゲット: ${targetSuit}`,
        };
      }
    }
  }

  return { isValid: true };
}

/**
 * ActionDefinition.targets[].condition に記述されたリクエスト対象条件を評価します。
 */
export function evaluateRequestTargetCondition(
  targetRequest: any,
  condition: Record<string, any> | undefined,
  context: {
    currentRequestId?: string;
  } = {}
): TargetConditionEvaluationResult {
  if (!targetRequest) {
    return { isValid: false, reason: "TARGET_MISSING", detail: "ターゲットとなるリクエストが指定されていません。" };
  }

  // 自分自身のリクエストは対象不可
  if (context.currentRequestId && targetRequest.id === context.currentRequestId) {
    return { isValid: false, reason: "TARGET_INVALID", detail: "自分自身のリクエストを対象にすることはできません。" };
  }

  if (!condition) {
    return { isValid: true };
  }

  // 1. status: "pending" 等の一致
  if (condition.status && targetRequest.status !== condition.status) {
    return {
      isValid: false,
      reason: "TARGET_CONDITION_UNMET",
      detail: `ターゲットリクエストのステータスが不適合です。期待: ${condition.status}, 実際: ${targetRequest.status}`,
    };
  }

  // 2. keyCards: キーカード枚数条件 (例: count: [1, 2])
  if (condition.keyCards && condition.keyCards.count !== undefined) {
    const reqKeyCards = Array.isArray(targetRequest.keyCards)
      ? targetRequest.keyCards
      : ((targetRequest as any).keyCard ? [(targetRequest as any).keyCard] : []);
    const expectedCounts = Array.isArray(condition.keyCards.count)
      ? condition.keyCards.count
      : [condition.keyCards.count];
    if (!expectedCounts.includes(reqKeyCards.length)) {
      return {
        isValid: false,
        reason: "TARGET_CONDITION_UNMET",
        detail: `ターゲットリクエストのキーカード枚数が不適合です。期待: ${expectedCounts.join(", ")}, 実際: ${reqKeyCards.length}`,
      };
    }
  }

  // 3. hasTarget: 対象リクエストが変更可能なターゲットを持っているか
  if (condition.hasTarget) {
    if (!targetRequest.targets || targetRequest.targets.length === 0) {
      return {
        isValid: false,
        reason: "TARGET_CONDITION_UNMET",
        detail: `ターゲットリクエスト ${targetRequest.id} は変更可能なターゲットを持っていません。`,
      };
    }
  }

  return { isValid: true };
}

/**
 * ActionDefinition.targets[].condition に記述されたプレイヤー対象条件を評価します。
 */
export function evaluatePlayerTargetCondition(
  targetPlayerKey: string | undefined,
  condition: Record<string, any> | undefined,
  context: {
    requesterPlayerKey?: string;
  } = {}
): TargetConditionEvaluationResult {
  if (!targetPlayerKey) {
    return { isValid: false, reason: "TARGET_MISSING", detail: "ターゲットとなるプレイヤーが指定されていません。" };
  }

  if (!condition) {
    return { isValid: true };
  }

  // 1. relation: "opponent" / "self"
  if (condition.relation === "opponent" && context.requesterPlayerKey) {
    if (context.requesterPlayerKey === targetPlayerKey) {
      return {
        isValid: false,
        reason: "TARGET_CONDITION_UNMET",
        detail: "ターゲットプレイヤーは対戦相手である必要があります。",
      };
    }
  }
  if (condition.relation === "self" && context.requesterPlayerKey) {
    if (context.requesterPlayerKey !== targetPlayerKey) {
      return {
        isValid: false,
        reason: "TARGET_CONDITION_UNMET",
        detail: "ターゲットプレイヤーは自分自身である必要があります。",
      };
    }
  }

  return { isValid: true };
}
