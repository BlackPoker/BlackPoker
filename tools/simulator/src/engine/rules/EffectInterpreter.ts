import { CommandRegistry, CommandContext } from "./CommandRegistry";
import { ExpressionEvaluator } from "./ExpressionEvaluator";
import { AbilityEvaluator } from "./AbilityEvaluator";
import { getOpponentPlayerKey } from "./playerUtils";
import { hasUnitLabel, isCharacterComponent } from "./characterUtils";

export interface EffectInterruption {
  readonly interrupted: true;
  readonly effectIndex: number;
  readonly effectStepId: string;
  readonly selectionId: string;
  readonly selectionType?: "unit" | "unitAssignment";
  readonly candidates: any[];
  readonly attackers?: any[];
}

export type EffectInterpreterResult =
  | { readonly completed: true }
  | EffectInterruption;

/**
 * 効果（エフェクトリスト）の解釈と、制御フロー（if-then-else）の実行管理を行います。
 */
export class EffectInterpreter {
  constructor(
    private registry: CommandRegistry,
    private expressionEvaluator: ExpressionEvaluator,
    private abilityEvaluator: AbilityEvaluator
  ) {}

  /**
   * 単一の効果コマンドを実行します（if分岐対応）。
   */
  executeEffect(effect: any, context: CommandContext) {
    const keys = Object.keys(effect);
    if (keys.length === 0) return;
    const name = keys[0];
    const args = effect[name];

    if (name === "if") {
      if (this.expressionEvaluator.evaluateCondition(args.condition, context, this.abilityEvaluator)) {
        if (args.then && Array.isArray(args.then)) {
          this.executeEffects(args.then, context);
        }
      } else if (args.else && Array.isArray(args.else)) {
        this.executeEffects(args.else, context);
      }
    } else {
      this.registry.execute(name, args, context);
    }
  }

  /**
   * 効果コマンドのリストを順次実行します。
   */
  executeEffects(effects: any[], context: CommandContext) {
    for (const effect of effects) {
      this.executeEffect(effect, context);
    }
  }

  /**
   * 効果リストを実行し、途中でユーザー判断が必要なステップ（selectUnits, selectBlockAssignments等）に到達した場合は中断します。
   */
  executeEffectsWithInterruption(
    effects: any[],
    context: CommandContext,
    startIndex: number = 0
  ): EffectInterpreterResult {
    for (let i = startIndex; i < effects.length; i++) {
      const effect = effects[i];
      const keys = Object.keys(effect);
      if (keys.length === 0) continue;
      const name = keys[0];
      const args = effect[name];

      if (name === "selectUnits") {
        const selectionId = args.id || "attackers";
        // 既に selections に値がセットされている場合はスキップ
        if (context.selections && context.selections[selectionId] !== undefined) {
          continue;
        }

        // テスト等で targetComponent が明示されている場合は自動束縛
        if (context.targetComponent) {
          if (!context.selections) context.selections = {};
          context.selections[selectionId] = [context.targetComponent.unitId || context.targetComponent];
          continue;
        }

        const candidates = this.findSelectableUnits(args, context);
        if (candidates.length === 0) {
          // 候補0体の場合はDecisionを発生させず、空配列をバインドして継続
          if (!context.selections) context.selections = {};
          context.selections[selectionId] = [];
          continue;
        }

        // 候補1体以上が存在する場合は中断してDecisionを要求
        return {
          interrupted: true,
          effectIndex: i,
          effectStepId: name,
          selectionId,
          selectionType: "unit",
          candidates,
        };
      }

      if (name === "selectBlockAssignments" || name === "selectUnitAssignments") {
        const selectionId = args.id || "blocks";
        if (context.selections && context.selections[selectionId] !== undefined) {
          continue;
        }

        // アタッカー群の特定
        // 相手フィールド上の battle.role === "attacker" かつ targetPlayerKey が自分であるユニット
        const state = context.state;
        const opponentKey = getOpponentPlayerKey(context.playerKey, state);
        const opponent = state.players?.[opponentKey];
        const attackers: any[] = (opponent?.field || []).filter(
          (u: any) => u.battle?.role === "attacker" && (u.battle?.targetPlayerKey === context.playerKey || !u.battle?.targetPlayerKey)
        );

        // テスト等で targetComponent が明示されている場合は自動束縛
        if (context.targetComponent) {
          if (!context.selections) context.selections = {};
          if (attackers.length > 0) {
            context.selections[selectionId] = [
              {
                sourceUnitId: attackers[0].unitId,
                selectedUnitIds: [context.targetComponent.unitId || context.targetComponent],
              },
            ];
          }
          continue;
        }

        // ブロッカー候補群の抽出 (relation: "self" は context.playerKey / controller の自陣)
        const candidates = this.findSelectableUnits(args, context);

        if (candidates.length === 0 || attackers.length === 0) {
          // ブロッカー候補0体またはアタッカー0体の場合はDecisionを発生させず、全アタッカー空配列の割当てをバインドして継続
          if (!context.selections) context.selections = {};
          context.selections[selectionId] = attackers.map((a) => ({
            sourceUnitId: a.unitId,
            selectedUnitIds: [],
          }));
          continue;
        }

        return {
          interrupted: true,
          effectIndex: i,
          effectStepId: name,
          selectionId,
          selectionType: "unitAssignment",
          candidates,
          attackers,
        };
      }

      this.executeEffect(effect, context);
    }

    return { completed: true };
  }

  /**
   * 盤面から選択可能なユニット群を抽出します。
   */
  findSelectableUnits(args: any, context: CommandContext): any[] {
    const relation = args.relation || "self";
    const condition = args.condition || {};
    const playerKey = relation === "self" ? context.playerKey : getOpponentPlayerKey(context.playerKey, context.state);
    const player = context.state.players?.[playerKey];
    if (!player || !player.field) return [];

    return player.field.filter((unit: any) => {
      // 状態チェック (例: charge)
      if (condition.state && unit.state !== condition.state) return false;

      // ラベルチェック (例: 攻撃 / attack, 防御 / defense)
      if (condition.label) {
        const expectedLabels = Array.isArray(condition.label) ? condition.label : [condition.label];
        const hasLabel = expectedLabels.some((l: string) =>
          hasUnitLabel(unit, l, context.components)
        );
        if (!hasLabel) return false;
      }

      // componentType チェック (例: character)
      if (condition.componentType === "character") {
        if (!isCharacterComponent(unit, context.components)) {
          return false;
        }
      } else if (condition.componentType) {
        const compId = unit.componentId || "";
        const compDef = context.components?.find((c: any) => c.id === compId);
        const matchType = compDef ? compDef.type === condition.componentType : compId.startsWith(`${condition.componentType}.`);
        if (!matchType) return false;
      }

      return true;
    });
  }

  /**
   * ゲームイベントを発行し、TriggerResolver に伝達してリクエストバッファへ蓄積します。
   */
  dispatchEvent(event: any, context: CommandContext) {
    if (this.registry.triggerResolver) {
      this.registry.triggerResolver.resolveTriggers(event, context);
    }
  }
}
