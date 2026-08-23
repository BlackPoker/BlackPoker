import { ExpressionEvaluator } from "./ExpressionEvaluator";
import { AbilityEvaluator } from "./AbilityEvaluator";
import { EffectInterpreter, EffectInterruption } from "./EffectInterpreter";
import { ActionRequestValidator } from "./ActionRequestValidator";
import {
  createFogHandler,
  summonUnitHandler,
  removeFogHandler,
  moveToGraveyardHandler,
  takeUntilLegacyCardHandler,
  dealDamageHandler,
  cancelRequestHandler,
  toggleUnitStateHandler,
  cleanupFogsHandler,
  endTurnHandler,
  startAttackHandler,
  declareBlockHandler,
  judgeDamageHandler,
  drawFromLifeHandler,
} from "./commandHandlers";
import { ComponentDefinition, ActionDefinition, EffectCommand, ActionRequest, ActionRequestTarget } from "../../domain/rules/RulePackage";
import { CostResolver } from "./CostResolver";
import { TriggerResolver } from "./TriggerResolver";
import { RequestBufferProcessor } from "./RequestBufferProcessor";
import { CostPayment } from "../../domain/decision/DecisionCatalog";
import { EffectContinuation } from "../session/GameSession";
import { LegalPatternGenerator } from "../decision/LegalPatternGenerator";

export interface CreateRequestOptions {
  readonly selectedCostPayment?: CostPayment;
  readonly sourcePatternId?: string;
  readonly placement?: "stage" | "none";
}

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
  triggered?: boolean; // 新規追加：誘発リクエスト判定
  source?: string; // 新規追加：移送ソース
  sourceEvent?: any; // 誘発元イベント
  selections?: Record<string, any>; // 効果解決時の選択結果マップ
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
  public triggerResolver = new TriggerResolver();
  public requestBufferProcessor = new RequestBufferProcessor();

  constructor() {
    this.effectInterpreter = new EffectInterpreter(
      this,
      this.expressionEvaluator,
      this.abilityEvaluator
    );
    this.registerDefaults();
  }

  getEffectInterpreter(): EffectInterpreter {
    return this.effectInterpreter;
  }

  getAbilityEvaluator(): AbilityEvaluator {
    return this.abilityEvaluator;
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
   * アクションの事前検証を行い、コストを支払った上でリクエストオブジェクトを作成します。
   * 通常アクションはステージ（LIFO）に積まれ、即時アクション（placement === "none"）はステージに積まれません。
   */
  createRequest(
    action: ActionDefinition,
    context: CommandContext,
    options?: CreateRequestOptions
  ): ActionRequest {
    // 1. 事前検証
    this.validateAction(action, context);

    // 2. コスト支払い（リクエスト成立時に即時消費）
    const costResolver = new CostResolver();
    if (options?.selectedCostPayment) {
      if (!costResolver.canPaySelection(options.selectedCostPayment, context)) {
        throw new Error(
          `選択されたコスト [${options.selectedCostPayment.summary || "payment"}] を支払うことができません。`
        );
      }
      costResolver.paySelection(options.selectedCostPayment, context, this.effectInterpreter);
    } else if (action.cost) {
      if (!costResolver.canPay(action.cost, context)) {
        throw new Error(`コスト [${action.cost}] を支払うことができません。`);
      }
      costResolver.pay(action.cost, context, this.effectInterpreter);
    }

    // 3. Stageおよび連番Seqの初期化・インクリメント
    if (!context.state.stage) {
      context.state.stage = { requests: [], history: [] };
    }
    context.state.nextRequestSeq = (context.state.nextRequestSeq || 0) + 1;
    const seq = context.state.nextRequestSeq;

    // 4. 投入カードのリスト化
    const actualCards =
      context.keyCards && context.keyCards.length > 0
        ? context.keyCards
        : context.keyCard
        ? [context.keyCard]
        : [];

    // 5. 型安全なターゲット情報の構築
    let targets: ActionRequestTarget[] | undefined = undefined;
    if (context.targetRequest || context.targetComponent || context.targetPlayerKey) {
      targets = [];
      if (action.targets && Array.isArray(action.targets)) {
        for (const tDef of action.targets) {
          const tType = tDef.type || (tDef.condition ? tDef.condition.type : undefined);
          if (tType === "request" && context.targetRequest) {
            targets.push({
              type: "request",
              requestId: context.targetRequest.id,
              actionId: context.targetRequest.actionId,
            });
          } else if (tType === "player" && context.targetPlayerKey) {
            targets.push({
              type: "player",
              targetPlayerKey: context.targetPlayerKey,
              name: context.state.players?.[context.targetPlayerKey]?.name || context.targetPlayerKey,
            } as any);
          } else if (
            (tType === "unit" ||
              tDef.condition?.component ||
              tDef.condition?.componentType ||
              tDef.type === "unit") &&
            context.targetComponent
          ) {
            targets.push({
              type: "unit",
              unitId: context.targetComponent.unitId,
              kind: context.targetComponent.kind || "ユニット",
              componentId: context.targetComponent.componentId,
            });
          }
        }
      } else {
        if (context.targetComponent) {
          targets.push({
            type: "unit",
            unitId: context.targetComponent.unitId,
            kind: context.targetComponent.kind || "ユニット",
            componentId: context.targetComponent.componentId,
          });
        } else if (context.targetPlayerKey) {
          targets.push({
            type: "player",
            targetPlayerKey: context.targetPlayerKey,
            name: context.state.players?.[context.targetPlayerKey]?.name || context.targetPlayerKey,
          } as any);
        } else if (context.targetRequest) {
          targets.push({
            type: "request",
            requestId: context.targetRequest.id,
            actionId: context.targetRequest.actionId,
          });
        }
      }
      if (targets.length === 0) {
        targets = undefined;
      }
    }

    // 6. リクエストの構築
    const isImmediate = action.request?.speed === "immediate";
    const request: ActionRequest = {
      id: `req-${seq}`,
      actionId: action.id,
      controller: context.playerKey,
      keyCards: actualCards,
      targets,
      cost: action.cost,
      selectedCostPayment: options?.selectedCostPayment,
      sourcePatternId: options?.sourcePatternId,
      status: "pending",
      sequence: seq,
      action,
    };

    // 7. ステージに積載（即時アクションまたは明示的 none の場合は積載しない）
    const shouldPlaceOnStage = options?.placement !== "none" && !isImmediate;
    if (shouldPlaceOnStage) {
      if (!context.state.stage.requests) context.state.stage.requests = [];
      context.state.stage.requests.push(request);
    }

    return request;
  }

  /**
   * 単一のアクションリクエストを解決する共通プリミティブ。
   * stage 上の通常アクション・直接即時アクションの双方から共通利用されます。
   */
  resolveRequest(
    request: ActionRequest,
    context: CommandContext
  ): {
    type: "COMPLETED" | "WAITING_FOR_DECISION";
    request: ActionRequest;
    decisionRequest?: any;
    continuation?: EffectContinuation;
    context?: CommandContext;
  } {
    if (!context.state.stage) {
      context.state.stage = { requests: [], history: [] };
    }
    if (!context.state.stage.history) {
      context.state.stage.history = [];
    }

    // キャンセル済みリクエストのスキップ
    if (request.status === "cancelled") {
      context.state.stage.history.push(request);
      return {
        type: "COMPLETED",
        request,
      };
    }

    request.status = "resolving";

    // アクション定義の逆引き
    let action = context.actions?.find((a) => a.id === request.actionId) || request.action;
    if (!action) {
      throw new Error(`アクションIDに対する定義が見つかりません: ${request.actionId}`);
    }

    // リクエスト実行時のコンテキスト復元
    const player = context.state.players?.[request.controller];
    let targetComponent = context.targetComponent;
    let targetRequest = context.targetRequest;
    let targetPlayerKey = context.targetPlayerKey;

    if (request.targets && request.targets.length > 0) {
      for (const t of request.targets) {
        if (t.type === "unit") {
          if (!targetComponent) {
            targetComponent = (player?.field ? player.field.find((u: any) => u.unitId === t.unitId) : undefined) || t;
          }
        } else if (t.type === "player") {
          if (!targetPlayerKey) {
            targetPlayerKey = (t as any).targetPlayerKey || (t as any).playerId || (t as any).playerKey;
          }
        } else if (t.type === "request") {
          if (!targetRequest) {
            const allReqs = [
              ...(context.state.stage.requests || []),
              ...(context.state.stage.history || []),
            ];
            targetRequest = allReqs.find((r: any) => r.id === t.requestId);
          }
        }
      }
    }

    const resolveContext: CommandContext = {
      ...context,
      playerKey: request.controller,
      keyCards: request.keyCards,
      keyCard: request.keyCards && request.keyCards.length === 1 ? request.keyCards[0] : undefined,
      targetComponent,
      targetRequest,
      targetPlayerKey,
      currentAction: action,
      currentRequest: request,
      sourceEvent: request.sourceEvent,
    };

    // コストはリクエスト成立時に支払い済みのため、解決時には支払わない

    // 効果（effect）の解決（中断対応）
    if (action.effect) {
      const execResult = this.effectInterpreter.executeEffectsWithInterruption(
        action.effect,
        resolveContext,
        0
      );

      if ("interrupted" in execResult && execResult.interrupted) {
        const continuation: EffectContinuation = {
          sourceRequestId: request.id,
          effectPath: [execResult.effectIndex],
          effectStepId: execResult.effectStepId,
          selectionId: execResult.selectionId,
        };

        const decisionRequest = this.createEffectDecisionRequest(
          execResult,
          request,
          context
        );

        return {
          type: "WAITING_FOR_DECISION",
          request,
          decisionRequest,
          continuation,
          context: resolveContext,
        };
      }
    }

    request.status = "resolved";
    context.state.stage.history.push(request);

    // アクション解決イベントの発行
    const resolveEvent = {
      type: "actionResolved",
      payload: {
        actionId: request.actionId,
        playerKey: request.controller,
        requestId: request.id,
        result: request.result,
      },
    };
    this.dispatchEvent(resolveEvent, context);

    return {
      type: "COMPLETED",
      request,
    };
  }

  /**
   * ステージの一番上（最新）のリクエストを取り出し、効果を解決します。
   */
  resolveTopRequest(
    context: CommandContext
  ): {
    type: "COMPLETED" | "WAITING_FOR_DECISION";
    request: ActionRequest;
    decisionRequest?: any;
    continuation?: EffectContinuation;
    context?: CommandContext;
  } | undefined {
    if (!context.state.stage || !context.state.stage.requests || context.state.stage.requests.length === 0) {
      return undefined;
    }

    // LIFO スタックから最新のリクエストを取り出す
    const request = context.state.stage.requests.pop()!;
    return this.resolveRequest(request, context);
  }

  /**
   * 中断されたアクションリクエストの効果解決を再開します。
   */
  resumeRequest(
    request: ActionRequest,
    continuation: EffectContinuation,
    selectedValues: readonly string[] | undefined,
    context: CommandContext,
    assignments?: readonly any[]
  ): {
    type: "COMPLETED" | "WAITING_FOR_DECISION";
    request: ActionRequest;
    decisionRequest?: any;
    continuation?: EffectContinuation;
    context?: CommandContext;
  } {
    const action = request.action;
    if (!action || !action.effect) {
      request.status = "resolved";
      context.state.stage.history.push(request);
      return { type: "COMPLETED", request };
    }

    // continuation.selectionId を正として汎用バインド
    const selectionKey = continuation.selectionId || continuation.effectStepId;
    const valueToStore: any = assignments !== undefined ? assignments : selectedValues;

    if (!context.selections) {
      context.selections = {};
    }
    context.selections[selectionKey] = valueToStore;

    const selections = {
      ...context.selections,
      [selectionKey]: valueToStore,
    };

    const player = context.state.players?.[request.controller];
    let targetComponent = context.targetComponent;
    let targetRequest = context.targetRequest;
    let targetPlayerKey = context.targetPlayerKey;

    if (request.targets && request.targets.length > 0) {
      for (const t of request.targets) {
        if (t.type === "unit") {
          if (!targetComponent) {
            targetComponent = (player?.field ? player.field.find((u: any) => u.unitId === t.unitId) : undefined) || t;
          }
        } else if (t.type === "player") {
          if (!targetPlayerKey) {
            targetPlayerKey = (t as any).targetPlayerKey || (t as any).playerId || (t as any).playerKey;
          }
        } else if (t.type === "request") {
          if (!targetRequest) {
            const allReqs = [
              ...(context.state.stage?.requests || []),
              ...(context.state.stage?.history || []),
            ];
            targetRequest = allReqs.find((r: any) => r.id === t.requestId);
          }
        }
      }
    }

    const resolveContext: CommandContext = {
      ...context,
      playerKey: request.controller,
      keyCards: request.keyCards,
      keyCard: request.keyCards && request.keyCards.length === 1 ? request.keyCards[0] : undefined,
      targetComponent,
      targetRequest,
      targetPlayerKey,
      currentAction: action,
      currentRequest: request,
      sourceEvent: request.sourceEvent,
      selections,
    };

    const startIndex = (continuation.effectPath[0] ?? 0) + 1;
    const execResult = this.effectInterpreter.executeEffectsWithInterruption(
      action.effect,
      resolveContext,
      startIndex
    );

    if ("interrupted" in execResult && execResult.interrupted) {
      const nextContinuation: EffectContinuation = {
        sourceRequestId: request.id,
        effectPath: [execResult.effectIndex],
        effectStepId: execResult.effectStepId,
        selectionId: execResult.selectionId,
      };

      const decisionRequest = this.createEffectDecisionRequest(
        execResult,
        request,
        context
      );

      return {
        type: "WAITING_FOR_DECISION",
        request,
        decisionRequest,
        continuation: nextContinuation,
        context: resolveContext,
      };
    }

    request.status = "resolved";
    context.state.stage.history.push(request);

    // アクション解決イベントの発行
    const resolveEvent = {
      type: "actionResolved",
      payload: {
        actionId: request.actionId,
        playerKey: request.controller,
        requestId: request.id,
        result: request.result,
      },
    };
    this.dispatchEvent(resolveEvent, context);

    return {
      type: "COMPLETED",
      request,
    };
  }

  /**
   * リクエストバッファから次のリクエストを1件取り出し、ステージ（state.stage.requests）へ移送します。
   */
  moveNextBufferedRequestToStage(context: CommandContext): ActionRequest | undefined {
    return this.requestBufferProcessor.moveNextToStage(context);
  }

  /**
   * アクションを検証した上で、効果を実行します。
   * 後方互換ブリッジとして、事前検証・リクエスト作成 -> 解決を連続して実行します。
   */
  executeAction(action: ActionDefinition, context: CommandContext) {
    const isImmediate = action.request?.speed === "immediate";
    const req = this.createRequest(action, context);
    if (isImmediate) {
      this.resolveRequest(req, context);
    } else {
      this.resolveTopRequest(context);
    }
  }

  /**
   * 中断（EffectInterruption）から種別に応じたDecisionRequestを生成する共通関数
   */
  private createEffectDecisionRequest(
    execResult: EffectInterruption,
    request: ActionRequest,
    context: CommandContext
  ): any {
    if (execResult.selectionType === "unitAssignment") {
      const res = LegalPatternGenerator.generateBlockAssignmentDecision(
        context.state,
        request.controller,
        request,
        execResult.effectStepId,
        execResult.attackers || [],
        execResult.candidates || [],
        context.components || []
      );
      return res.request;
    } else {
      return LegalPatternGenerator.generateEffectSelectionDecision(
        context.state,
        request.controller,
        request,
        execResult.effectStepId,
        execResult.candidates,
        {
          selectionId: execResult.selectionId,
          stateVersion: context.state.stateVersion ?? context.state.version ?? 1,
          matchId: context.state.matchId,
        }
      );
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
    // 既存のイベント解決を優先して走らせる
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
    this.register("toggleUnitState", toggleUnitStateHandler(this.expressionEvaluator, this.effectInterpreter));
    this.register("cleanupFogs", cleanupFogsHandler(this.effectInterpreter));
    this.register("endTurn", endTurnHandler());
    this.register("startAttack", startAttackHandler(this.expressionEvaluator, this.effectInterpreter));
    this.register("declareBlock", declareBlockHandler(this.expressionEvaluator, this.effectInterpreter));
    this.register("judgeDamage", judgeDamageHandler(this.abilityEvaluator, this.effectInterpreter));
    this.register("drawFromLife", drawFromLifeHandler(this.expressionEvaluator, this.effectInterpreter));
    this.register("drawCards", drawFromLifeHandler(this.expressionEvaluator, this.effectInterpreter));
  }
}
