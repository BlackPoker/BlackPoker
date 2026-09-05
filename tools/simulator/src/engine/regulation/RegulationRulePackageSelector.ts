import { RulePackage, ActionDefinition, ComponentDefinition } from "../../domain/rules/RulePackage";
import { FormatDefinition, RegulationDefinition } from "../../domain/regulation/RegulationDefinition";

/**
 * 公式レギュレーション / フォーマット定義に基づき、許可されたアクション・コンポーネントのみに
 * フィルタリングした派生 RulePackage を生成するセレクター。
 */
export class RegulationRulePackageSelector {
  /**
   * fullRulePackage から、指定フォーマットで利用可能な Actions および Components を選択した
   * 派生 RulePackage を生成します。
   */
  public static selectRulePackage(
    fullRulePackage: RulePackage,
    format: FormatDefinition,
    regulation?: RegulationDefinition
  ): RulePackage {
    const actionMap = new Map(fullRulePackage.actions.map((a) => [a.id, a]));
    const filteredActions = format.actions
      .map((id) => actionMap.get(id))
      .filter((a): a is ActionDefinition => a !== undefined);

    const componentMap = new Map(fullRulePackage.components.map((c) => [c.id, c]));
    const filteredComponents = format.components
      .map((id) => componentMap.get(id))
      .filter((c): c is ComponentDefinition => c !== undefined);

    const packageId = regulation ? `official-${regulation.id}` : `official-${format.id}`;

    return {
      id: packageId,
      version: fullRulePackage.version,
      description: regulation ? `${regulation.name} 公式ルールパッケージ` : `${format.name} フォーマット公式ルールパッケージ`,
      actions: filteredActions,
      components: filteredComponents,
    };
  }
}
