import { ExpressionEvaluator } from "./ExpressionEvaluator";
import { AbilityEvaluator } from "./AbilityEvaluator";
import { EffectInterpreter } from "./EffectInterpreter";
import { ActionRequestValidator } from "./ActionRequestValidator";
import {
  createFogHandler,
  summonUnitHandler,
  removeFogHandler,
  moveToGraveyardHandler,
  takeUntilLegacyCardHandler,
  dealDamageHandler,
} from "./commandHandlers";

export interface CommandContext {
  state: any; // シミュレーターのゲーム状態
  playerKey: string; // 実行するプレイヤー ("p1" | "p2")
  keyCard?: any; // キーカード情報
  keyCards?: any[]; // 複数キーカード情報
  targetComponent?: any; // 対象となったコンポーネント/ユニット
  targetPlayerKey?: string; // 対象となったプレイヤー情報
  actions?: any[]; // アクションの全定義（誘発アクションの検索用）
}

export type CommandHandler = (args: Record<string, any>, context: CommandContext) => void;

/**
 * 高レベル命令（createFog, summonUnit 等）を登録・解釈・実行するレジストリ。
 * 将来的に低レベルIRへ展開する入口となる。
 */
export class CommandRegistry {
  private handlers = new Map<string, CommandHandler>();
  private expressionEvaluator = new ExpressionEvaluator();
  private abilityEvaluator = new AbilityEvaluator();
  private actionRequestValidator = new ActionRequestValidator();
  private effectInterpreter: EffectInterpreter;

  constructor() {
    this.effectInterpreter = new EffectInterpreter(
      this,
      this.expressionEvaluator,
      this.abilityEvaluator
    );
    this.registerDefaults();
  }

  /**
   * 新しい高レベル命令ハンドラーを登録する
   */
  register(name: string, handler: CommandHandler) {
    this.handlers.set(name, handler);
  }

  /**
   * 命令を実行する
   */
  execute(name: string, args: Record<string, any>, context: CommandContext) {
    const handler = this.handlers.get(name);
    if (!handler) {
      throw new Error(`未定義の高レベル命令です: ${name}`);
    }
    handler(args, context);
  }

  /**
   * アクションのリクエスト妥当性を検証します。
   */
  validateAction(action: any, context: CommandContext) {
    this.actionRequestValidator.validateActionRequest(action, context);
  }

  /**
   * アクションを検証した上で、効果を実行します。
   */
  executeAction(action: any, context: CommandContext) {
    this.validateAction(action, context);
    if (action.effect) {
      this.executeEffects(action.effect, context);
    }
  }

  /**
   * [後方互換ブリッジ] ユニットに適用されているすべてのフォグの amount 累積値を反映したサイズ計算を行います。
   */
  calculateUnitSize(unit: any, player: any): number {
    return this.abilityEvaluator.calculateUnitSize(unit, player);
  }

  /**
   * [後方互換ブリッジ] 単一の効果コマンドを実行します（if分岐対応）。
   */
  executeEffect(effect: any, context: CommandContext) {
    this.effectInterpreter.executeEffect(effect, context);
  }

  /**
   * [後方互換ブリッジ] 効果コマンドのリストを順次実行します。
   */
  executeEffects(effects: any[], context: CommandContext) {
    this.effectInterpreter.executeEffects(effects, context);
  }

  /**
   * [イベント配信ブリッジ] ゲームイベントを発行し、誘発アクションをチェック・実行します。
   */
  dispatchEvent(event: any, context: CommandContext) {
    this.effectInterpreter.dispatchEvent(event, context);
  }

  /**
   * デフォルトの検証用命令ハンドラーを登録
   */
  private registerDefaults() {
    this.register("createFog", createFogHandler(this.expressionEvaluator));
    this.register("summonUnit", summonUnitHandler());
    this.register("removeFog", removeFogHandler());
    this.register("moveToGraveyard", moveToGraveyardHandler(this.effectInterpreter));
    this.register("takeUntilLegacyCard", takeUntilLegacyCardHandler());
    this.register("dealDamage", dealDamageHandler(this.expressionEvaluator, this.effectInterpreter));
  }
}
