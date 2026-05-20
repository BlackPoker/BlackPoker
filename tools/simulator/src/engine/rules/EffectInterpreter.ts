import { CommandRegistry, CommandContext } from "./CommandRegistry";
import { ExpressionEvaluator } from "./ExpressionEvaluator";
import { AbilityEvaluator } from "./AbilityEvaluator";

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
   * ゲームイベントを発行し、合致する誘発アクションを実行します（即時解決）。
   */
  dispatchEvent(event: any, context: CommandContext) {
    if (!context.actions) return;

    for (const action of context.actions) {
      if (action.type === "triggered" && action.triggerCondition) {
        if (this.evaluateTrigger(action, event, context)) {
          // 誘発アクション用の新しいコンテキストを作成し、実行する
          const newContext: CommandContext = {
            ...context,
            keyCard: event.payload.card, // イベント対象のカードを keyCard にバインド
            targetComponent: null
          };
          if (action.effect) {
            this.executeEffects(action.effect, newContext);
          }
        }
      }
    }
  }

  /**
   * アクションの誘発条件とイベントがマッチするか判定します。
   */
  private evaluateTrigger(action: any, event: any, context: CommandContext): boolean {
    const cond = action.triggerCondition;
    if (!cond || cond.event !== event.type) return false;

    const payload = event.payload;
    if (cond.condition) {
      if (cond.condition.fromZone && cond.condition.fromZone !== payload.fromZone) {
        return false;
      }
      if (cond.condition.toZone && cond.condition.toZone !== payload.toZone) {
        return false;
      }

      if (cond.condition.card && payload.card) {
        const cardCond = cond.condition.card;

        // rank条件の評価 (文字列または配列)
        if (cardCond.rank) {
          const ranks = Array.isArray(cardCond.rank) ? cardCond.rank : [cardCond.rank];
          if (!ranks.includes(payload.card.rank)) {
            return false;
          }
        }

        // owner条件の評価
        if (cardCond.owner === "self") {
          // プレイヤーキーが一致することを確認
          if (payload.playerKey !== context.playerKey) {
            return false;
          }
        }
      }
    }
    return true;
  }
}
