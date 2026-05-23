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
  cancelRequestHandler,
} from "./commandHandlers";
import { ComponentDefinition, ActionDefinition, EffectCommand, ActionRequest, ActionRequestTarget } from "../../domain/rules/RulePackage";
import { CostResolver } from "./CostResolver";

export interface CommandContext {
  state: any; // シミュレーターのゲーム状態
  playerKey: string; // 実行するプレイヤー ("p1" | "p2")
  keyCard?: any; // キーカード情報
  keyCards?: any[]; // 複数キーカード情報
  targetComponent?: any; // 対象となったコンポーネント/ユニット
  targetPlayerKey?: string; // 対象となったプレイヤー情報
  targetRequest?: ActionRequest; // 対象となったリクエスト情報
  actions?: ActionDefinition[]; // アクションの全定義（誘発アクションの検索用）
  components?: ComponentDefinition[]; // コンポーネントの全定義（常在能力の検索用）
  currentAction?: ActionDefinition; // 現在実行中のアクション定義
  currentRequest?: ActionRequest; // 現在解決中のリクエスト情報
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
  validateAction(action: ActionDefinition, context: CommandContext) {
    this.actionRequestValidator.validateActionRequest(action, context);
  }

  /**
   * アクションの事前検証を行い、リクエストオブジェクトを作成してステージ（LIFO）に積みます。
   * ※この時点ではコストの支払いは行われません。
   */
  createRequest(action: ActionDefinition, context: CommandContext): ActionRequest {
    // 1. 事前検証 (支払い可能チェック canPay を含む)
    this.validateAction(action, context);

    // 2. Stageおよび連番Seqの初期化・インクリメント
    if (!context.state.stage) {
      context.state.stage = { requests: [] };
    }
    context.state.nextRequestSeq = (context.state.nextRequestSeq || 0) + 1;
    const seq = context.state.nextRequestSeq;

    // 3. 投入カードのリスト化
    const actualCards = context.keyCards && context.keyCards.length > 0
      ? context.keyCards
      : context.keyCard ? [context.keyCard] : [];

    // 4. 型安全なターゲット情報の構築
    let targets: ActionRequestTarget[] | undefined = undefined;
    if (context.targetComponent) {
      targets = [{
        type: "unit",
        unitId: context.targetComponent.unitId,
        kind: context.targetComponent.kind || "ユニット",
        componentId: context.targetComponent.componentId,
      }];
    } else if (context.targetRequest) {
      targets = [{
        type: "request",
        requestId: context.targetRequest.id,
        actionId: context.targetRequest.actionId,
      }];
    }

    // 5. リクエストの構築
    const request: ActionRequest = {
      id: `req-${seq}`,
      actionId: action.id,
      controller: context.playerKey,
      keyCards: actualCards,
      targets,
      cost: action.cost,
      status: "pending",
      sequence: seq,
      action,
    };

    // 6. ステージに積載
    context.state.stage.requests.push(request);
    return request;
  }

  /**
   * ステージの一番上（最新）のリクエストを取り出し、実際にコストを支払った上で効果を解決します。
   */
  resolveTopRequest(context: CommandContext): void {
    if (!context.state.stage || context.state.stage.requests.length === 0) {
      return;
    }

    // 1. LIFO スタックから最新のリクエストを取り出す
    const request = context.state.stage.requests.pop()!;

    // ステージ履歴 (history) の初期化
    if (!context.state.stage.history) {
      context.state.stage.history = [];
    }

    // キャンセル済みリクエストのスキップ
    if (request.status === "cancelled") {
      context.state.stage.history.push(request);
      return;
    }

    request.status = "resolving";

    // アクション定義の逆引き
    let action = context.actions?.find((a) => a.id === request.actionId);
    if (!action) {
      action = request.action;
    }
    if (!action) {
      throw new Error(`アクションIDに対する定義が見つかりません: ${request.actionId}`);
    }

    // 2. リクエスト実行時のコンテキスト復元
    const player = context.state.players[request.controller];
    let targetComponent = undefined;
    let targetRequest = undefined;

    if (request.targets && request.targets.length > 0) {
      const firstTarget = request.targets[0];
      if (firstTarget.type === "unit") {
        targetComponent = (player.field ? player.field.find((u: any) => u.unitId === firstTarget.unitId) : undefined) || firstTarget;
      } else if (firstTarget.type === "request") {
        const allReqs = [
          ...(context.state.stage.requests || []),
          ...(context.state.stage.history || [])
        ];
        targetRequest = allReqs.find((r: any) => r.id === firstTarget.requestId);
      }
    }

    const resolveContext: CommandContext = {
      ...context,
      playerKey: request.controller,
      keyCards: request.keyCards,
      keyCard: request.keyCards.length === 1 ? request.keyCards[0] : undefined,
      targetComponent,
      targetRequest,
      currentAction: action,
      currentRequest: request,
    };

    // 3. 解決時におけるコストの2重チェック検証
    if (request.cost) {
      const costResolver = new CostResolver();
      if (!costResolver.canPay(request.cost, resolveContext)) {
        request.status = "cancelled";
        context.state.stage.history.push(request);
        throw new Error(`解決時にコスト [${request.cost}] を支払うリソースが不足しているため、解決できません。`);
      }
      // 実際の支払い実行
      costResolver.pay(request.cost, resolveContext, this.effectInterpreter);
    }

    // 4. 効果（effect）の解決
    if (action.effect) {
      this.executeEffects(action.effect, resolveContext);
    }

    request.status = "resolved";
    context.state.stage.history.push(request);
  }

  /**
   * アクションを検証した上で、効果を実行します。
   * 後方互換ブリッジとして、事前検証・リクエスト作成 -> 即時ステージ解決を連続して実行します。
   */
  executeAction(action: ActionDefinition, context: CommandContext) {
    this.createRequest(action, context);
    this.resolveTopRequest(context);
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
  executeEffect(effect: EffectCommand, context: CommandContext) {
    this.effectInterpreter.executeEffect(effect, context);
  }

  /**
   * [後方互換ブリッジ] 効果コマンドのリストを順次実行します。
   */
  executeEffects(effects: EffectCommand[], context: CommandContext) {
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
    this.register("dealDamage", dealDamageHandler(this.expressionEvaluator, this.abilityEvaluator, this.effectInterpreter));
    this.register("cancelRequest", cancelRequestHandler(this.expressionEvaluator));
  }
}
