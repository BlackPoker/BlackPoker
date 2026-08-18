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
   * ゲームイベントを発行し、TriggerResolver に伝達してリクエストバッファへ蓄積します。
   */
  dispatchEvent(event: any, context: CommandContext) {
    if (this.registry.triggerResolver) {
      this.registry.triggerResolver.resolveTriggers(event, context);
    }
  }
}
