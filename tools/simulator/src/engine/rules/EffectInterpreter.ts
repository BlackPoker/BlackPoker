import { CommandRegistry, CommandContext } from "./CommandRegistry";
import { ExpressionEvaluator } from "./ExpressionEvaluator";
import { AbilityEvaluator } from "./AbilityEvaluator";
import { getOpponentPlayerKey } from "./playerUtils";
import { hasUnitLabel, isCharacterComponent } from "./characterUtils";
import { PlayerKey } from "../../domain/decision/DecisionSource";

export interface EffectInterruption {
  readonly interrupted: true;
  readonly effectIndex: number;
  readonly effectStepId: string;
  readonly selectionId: string;
  readonly selectionType?: "unit" | "unitAssignment";
  readonly candidates: any[];
  readonly attackers?: any[];
  readonly decisionPlayerKey?: PlayerKey;
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
   * DSL に基づいて判断権を持つプレイヤー（DecisionPlayer）を解決します。
   */
  private resolveDecisionPlayerKey(spec: string | undefined, context: CommandContext): PlayerKey {
    if (!spec || spec === "controller" || spec === "self") {
      return context.playerKey;
    }
    if (spec === "opponent") {
      return getOpponentPlayerKey(context.playerKey, context.state);
    }
    if (spec === "turnPlayer") {
      return context.state.turnPlayer || context.playerKey;
    }
    if (spec === "nonTurnPlayer") {
      return context.state.nonTurnPlayer || getOpponentPlayerKey(context.state.turnPlayer || context.playerKey, context.state);
    }
    return context.playerKey;
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

        const decisionPlayerKey = this.resolveDecisionPlayerKey(args.decisionPlayer || args.chooser, context);

        // テスト等で targetComponent が明示されている場合は自動束縛
        if (context.targetComponent) {
          if (!context.selections) context.selections = {};
          context.selections[selectionId] = [context.targetComponent.unitId || context.targetComponent];
          continue;
        }

        const candidates = this.findSelectableUnits(args, context, decisionPlayerKey);
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
          decisionPlayerKey,
        };
      }

      if (name === "selectBlockAssignments" || name === "selectUnitAssignments") {
        const selectionId = args.id || "blocks";
        if (context.selections && context.selections[selectionId] !== undefined) {
          continue;
        }

        const decisionPlayerKey = args.decisionPlayer || args.chooser
          ? this.resolveDecisionPlayerKey(args.decisionPlayer || args.chooser, context)
          : (context.state.nonTurnPlayer || (context.state.turnPlayer ? getOpponentPlayerKey(context.state.turnPlayer, context.state) : context.playerKey));

        // アタッカー群の特定（ディフェンダー側から見た攻撃側のユニット）
        const state = context.state;
        const defenderKey = decisionPlayerKey;
        const attackerPlayerKey = getOpponentPlayerKey(defenderKey, state);
        const attackerPlayer = state.players?.[attackerPlayerKey];
        const attackers: any[] = (attackerPlayer?.field || []).filter(
          (u: any) => u.battle?.role === "attacker" && (u.battle?.targetPlayerKey === defenderKey || !u.battle?.targetPlayerKey)
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

        // ブロッカー候補群の抽出 (relation: "decisionPlayer" は防御側プレイヤーの自陣)
        const candidates = this.findSelectableUnits(args, context, decisionPlayerKey);

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
          decisionPlayerKey,
        };
      }

      this.executeEffect(effect, context);
    }

    return { completed: true };
  }

  /**
   * 盤面から選択可能なユニット群を抽出します。
   */
  findSelectableUnits(args: any, context: CommandContext, decisionPlayerKey?: PlayerKey): any[] {
    const relation = args.relation || "self";
    const condition = args.condition || {};

    let playerKey: PlayerKey = context.playerKey;
    if (relation === "decisionPlayer") {
      playerKey = decisionPlayerKey || context.playerKey;
    } else if (relation === "opponent") {
      playerKey = getOpponentPlayerKey(context.playerKey, context.state);
    } else if (relation === "self") {
      playerKey = context.playerKey;
    }

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
    this.registry.emitEvent(event);
    if (this.registry.triggerResolver) {
      this.registry.triggerResolver.resolveTriggers(event, context);
    }
  }
}
