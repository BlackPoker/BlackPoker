import { CommandRegistry, CommandContext } from "./CommandRegistry";
import { ExpressionEvaluator } from "./ExpressionEvaluator";
import { AbilityEvaluator } from "./AbilityEvaluator";

export interface EffectInterruption {
  readonly interrupted: true;
  readonly effectIndex: number;
  readonly effectStepId: string;
  readonly selectionId: string;
  readonly candidates: any[];
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
   * 効果リストを実行し、途中でユーザー判断が必要なステップ（selectUnits等）に到達した場合は中断します。
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
          candidates,
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
    const playerKey = relation === "self" ? context.playerKey : context.playerKey === "p1" ? "p2" : "p1";
    const player = context.state.players?.[playerKey];
    if (!player || !player.field) return [];

    return player.field.filter((unit: any) => {
      // 状態チェック (例: charge)
      if (condition.state && unit.state !== condition.state) return false;

      // ラベルチェック (例: 攻撃 / attack)
      if (condition.label) {
        const expectedLabels = Array.isArray(condition.label) ? condition.label : [condition.label];
        const unitLabels = unit.labels || [];
        const hasLabel = expectedLabels.some((l: string) => {
          if (l === "攻撃" || l === "attack") {
            return unitLabels.includes("攻撃") || unitLabels.includes("attack");
          }
          if (l === "防御" || l === "defense") {
            return unitLabels.includes("防御") || unitLabels.includes("defense");
          }
          return unitLabels.includes(l);
        });
        if (!hasLabel) return false;
      }

      // componentType チェック (例: character)
      if (condition.componentType) {
        const compId = unit.componentId || "";
        const compDef = context.components?.find((c: any) => c.id === compId);
        const isCharacter = compDef ? compDef.type === condition.componentType : compId.startsWith("character.");
        if (!isCharacter) return false;
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
