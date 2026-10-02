import { TargetSelection } from "../../domain/decision/DecisionCatalog";
import { ActionDefinition, ComponentDefinition } from "../../domain/rules/RulePackage";
import { ActionTargetService } from "../rules/ActionTargetService";

/**
 * アクション定義と盤面状態から、合法なターゲット候補を列挙するクラス。
 * 汎用ターゲット基盤 (ActionTargetService) に委譲します。
 */
export class TargetSelectionEnumerator {
  /**
   * アクション定義と盤面状態から、選択可能なターゲットの候補を列挙します。
   */
  static enumerateTargets(
    action: ActionDefinition,
    state: any,
    requesterPlayerKey: string,
    components: ComponentDefinition[] = []
  ): TargetSelection[] {
    return ActionTargetService.enumerateTargets(action, state, requesterPlayerKey, components);
  }
}
