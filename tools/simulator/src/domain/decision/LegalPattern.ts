import {
  ActionSelectionRef,
  CardSelectionRef,
  UnitSelectionRef,
  CostPaymentRef,
  TargetSelectionRef,
  EffectSelectionRef,
  OrderSelectionRef,
} from "./DecisionCatalog";

/**
 * 1つの合法な完成パターン。
 * すべての選択要素が確定しており、各情報はカタログへのインデックス参照で保持される。
 */
export interface LegalPattern {
  /**
   * デバッグ、ログ、リプレイ用の安定識別子
   */
  readonly patternId: string;

  readonly actionSelectionRef?: ActionSelectionRef;
  readonly keyCardSelectionRef?: CardSelectionRef;
  readonly keyUnitSelectionRef?: UnitSelectionRef;
  readonly costPaymentRef?: CostPaymentRef;
  readonly targetSelectionRef?: TargetSelectionRef;

  readonly effectSelectionRef?: EffectSelectionRef;
  readonly orderSelectionRef?: OrderSelectionRef;
}
