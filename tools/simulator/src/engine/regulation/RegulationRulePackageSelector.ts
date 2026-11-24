import { RulePackage, ActionDefinition, ComponentDefinition } from "../../domain/rules/RulePackage";
import { FormatDefinition, FrameDefinition, RegulationDefinition } from "../../domain/regulation/RegulationDefinition";

/**
 * 必須アクションまたはコンポーネントが fullRulePackage に存在しない場合にスローされるエラー。
 * 不完全な派生 RulePackage の暗黙的生成を防止し、Fail-Closed を保証します。
 */
export class RulePackageIntegrityError extends Error {
  constructor(
    public readonly formatId: string,
    public readonly missingActions: readonly string[],
    public readonly missingComponents: readonly string[]
  ) {
    const details: string[] = [];
    if (missingActions.length > 0) {
      details.push(`未定義アクション (${missingActions.length}件): [${missingActions.join(", ")}]`);
    }
    if (missingComponents.length > 0) {
      details.push(`未定義コンポーネント (${missingComponents.length}件): [${missingComponents.join(", ")}]`);
    }
    super(`RulePackage整合性エラー (format: ${formatId}): 必須定義がfullRulePackageに存在しません。\n${details.join("\n")}`);
    this.name = "RulePackageIntegrityError";
  }
}

/**
 * 公式レギュレーション / フォーマット定義に基づき、許可されたアクション・コンポーネントのみに
 * フィルタリングした派生 RulePackage を生成するセレクター。
 */
export class RegulationRulePackageSelector {
  /**
   * fullRulePackage から、指定フォーマットおよびフレームで利用可能な Actions および Components を選択した
   * 派生 RulePackage を生成します。
   * 必須定義が欠落している場合は暗黙的にスキップせず、RulePackageIntegrityError をスローします (Fail-Closed)。
   */
  public static selectRulePackage(
    fullRulePackage: RulePackage,
    format: FormatDefinition,
    regulation?: RegulationDefinition,
    frame?: FrameDefinition
  ): RulePackage {
    const actionMap = new Map(fullRulePackage.actions.map((a) => [a.id, a]));
    const combinedActionIds = Array.from(
      new Set([...format.actions, ...(frame?.actions || [])])
    );
    const missingActions = combinedActionIds.filter((id) => !actionMap.has(id));

    const componentMap = new Map(fullRulePackage.components.map((c) => [c.id, c]));
    const missingComponents = (format.components || []).filter((id) => !componentMap.has(id));

    if (missingActions.length > 0 || missingComponents.length > 0) {
      throw new RulePackageIntegrityError(
        format.id,
        missingActions,
        missingComponents
      );
    }

    const filteredActions = combinedActionIds.map((id) => actionMap.get(id)!);
    const filteredComponents = (format.components || []).map((id) => componentMap.get(id)!);

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
