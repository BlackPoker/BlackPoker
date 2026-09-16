import { ActionDefinition } from "../../domain/rules/RulePackage";
import { CostSymbol, parseCost } from "./CostParser";
import { AbilityEvaluator } from "./AbilityEvaluator";

export interface CostModifierDefinition {
  filter?: {
    actionType?: string;
    timing?: string;
    [key: string]: any;
  };
  remove?: {
    symbol?: CostSymbol | string;
    [key: string]: any;
  };
  [key: string]: any;
}

/**
 * アクションの実行時実効コスト (Effective Cost) を導出する単一責任クラス (SSOT)。
 * ActionDefinition の base cost を不変に保ち、現在の GameState、コントローラーの Field 上の
 * 有効なコンポーネント能力 (costModifier) から決定論的かつ冪等に実効コストを導出します。
 */
export class ActionCostEvaluator {
  constructor(private abilityEvaluator: AbilityEvaluator = new AbilityEvaluator()) {}

  /**
   * 正規化された実効コスト文字列を返します（例: "", "B", "BL", "L"）。
   * コストが完全に不要となった場合は空文字 "" を返します。
   */
  resolveEffectiveCost(
    action: ActionDefinition,
    state: any,
    playerKey: string,
    components: readonly any[] = []
  ): string {
    const symbols = this.resolveEffectiveCostSymbols(action, state, playerKey, components);
    return symbols.join("");
  }

  /**
   * 実効コストシンボル配列を返します。
   * base cost のシンボル相対順序を厳格に維持します（ソートによる順序破壊を行いません）。
   */
  resolveEffectiveCostSymbols(
    action: ActionDefinition,
    state: any,
    playerKey: string,
    components: readonly any[] = []
  ): CostSymbol[] {
    if (!action.cost || action.cost.trim() === "") {
      return [];
    }

    let currentSymbols: CostSymbol[];
    try {
      currentSymbols = parseCost(action.cost);
    } catch {
      return [];
    }

    if (!state || !playerKey) {
      return currentSymbols;
    }

    // コントローラー自身の Field 上に存在する表向きコンポーネントから costModifier 能力を収集
    const activeModifiers = this.abilityEvaluator.findActiveAbilities<CostModifierDefinition>(
      "costModifier",
      state,
      components,
      playerKey,
      { zones: ["field"] }
    );

    if (activeModifiers.length === 0) {
      return currentSymbols;
    }

    for (const { ability } of activeModifiers) {
      if (!ability) continue;

      // 1. アクション種別・タイミング等のフィルタ検証
      if (ability.filter) {
        if (
          ability.filter.actionType &&
          String(action.type || "").toLowerCase() !== String(ability.filter.actionType).toLowerCase()
        ) {
          continue;
        }
        if (
          ability.filter.timing &&
          String(action.request?.timing || "").toLowerCase() !== String(ability.filter.timing).toLowerCase()
        ) {
          continue;
        }
      }

      // 2. シンボルの完全除去 (例: symbol: "D")
      if (ability.remove?.symbol) {
        const symToRemove = String(ability.remove.symbol).toUpperCase();
        // 相対順序を保持しながら対象シンボルをすべて除去
        currentSymbols = currentSymbols.filter((s) => s !== symToRemove);
      }
    }

    return currentSymbols;
  }
}
