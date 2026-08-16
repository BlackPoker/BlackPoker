export type ActionSelectionRef = number;
export type CardSelectionRef = number;
export type UnitSelectionRef = number;
export type CostPaymentRef = number;
export type TargetSelectionRef = number;
export type EffectSelectionRef = number;
export type OrderSelectionRef = number;
export type PatternRef = number;

/**
 * アクション選択要素
 */
export interface ActionSelection {
  readonly actionId: string;
  readonly actionName: string;
  readonly timing?: string;
  readonly speed?: string;
  readonly cost?: string;
}

/**
 * カード選択要素（キーカードなど）
 */
export interface CardSelection {
  readonly cardIds: readonly string[];
  readonly displayCodes: readonly string[];
}

/**
 * ユニット選択要素
 */
export interface UnitSelection {
  readonly unitIds: readonly string[];
  readonly displayNames: readonly string[];
}

/**
 * コスト支払い要素
 * どのカードを捨てるか、どの防壁をドライブするか、支払うライフ枚数を具体的に指定
 */
export interface CostPayment {
  readonly discardedCardIds: readonly string[];
  readonly drivenBulwarkUnitIds: readonly string[];
  readonly sacrificedUnitIds: readonly string[];
  readonly lifeCount: number;
  readonly summary?: string;
}

/**
 * 対象選択要素
 */
export interface TargetSelection {
  readonly targetType: "unit" | "player" | "request" | "none";
  readonly targetPlayerKey?: string;
  readonly targetUnitId?: string;
  readonly targetRequestId?: string;
  readonly displayName?: string;
}

/**
 * 効果解決時選択要素（将来拡張用）
 */
export interface EffectSelection {
  readonly selectionType: string;
  readonly selectedValues: readonly string[];
  readonly summary?: string;
}

/**
 * 順序選択要素（将来拡張用）
 */
export interface OrderSelection {
  readonly orderedIds: readonly string[];
  readonly summary?: string;
}

/**
 * パターンから共有参照するカタログ
 */
export interface DecisionCatalog {
  readonly actions: readonly ActionSelection[];
  readonly cardSelections: readonly CardSelection[];
  readonly unitSelections: readonly UnitSelection[];
  readonly costPayments: readonly CostPayment[];
  readonly targetSelections: readonly TargetSelection[];
  readonly effectSelections: readonly EffectSelection[];
  readonly orderSelections: readonly OrderSelection[];
}
