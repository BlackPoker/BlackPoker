import { CommandContext, CommandRegistry } from "./CommandRegistry";
import { ActionRequest, RequestBuffer, RulePackage, TriggeredActionRequest } from "../../domain/rules/RulePackage";
import { ActionRequestValidator } from "./ActionRequestValidator";
import { EffectInterpreter } from "./EffectInterpreter";
import { CostResolver } from "./CostResolver";
import { PlayerKey } from "../../domain/decision/DecisionSource";

export interface TriggerProcessingResult {
  readonly immediateResolvedCount: number;
  readonly normalQueuedCount: number;
  readonly stagedRequests: readonly ActionRequest[];
}

/**
 * 公式ルール9.4.1に従い、リクエストバッファ内の誘発リクエストを優先度順に処理するコーディネーター。
 * 
 * 処理順序（公式ルール9.4.1）:
 * 1. speed: "immediate" (即時) → speed: "normal" (通常)
 * 2. controller: turnPlayer からターン順
 * 3. timing: "main" (メイン) → "quick" (クイック)
 */
export class TriggerProcessingCoordinator {
  private validator = new ActionRequestValidator();
  private costResolver = new CostResolver();

  /**
   * ターン順における各プレイヤーの優先度インデックスを計算
   */
  private static getPlayerPriorityIndex(playerId: PlayerKey, turnPlayer: PlayerKey, allPlayerIds: PlayerKey[]): number {
    const turnIndex = allPlayerIds.indexOf(turnPlayer);
    const playerIndex = allPlayerIds.indexOf(playerId);
    if (turnIndex === -1 || playerIndex === -1) return 0;
    return (playerIndex - turnIndex + allPlayerIds.length) % allPlayerIds.length;
  }

  /**
   * 公式ルール9.4.1に基づく誘発リクエストの比較・ソート関数
   */
  static compareRequests(
    a: TriggeredActionRequest,
    b: TriggeredActionRequest,
    turnPlayer: PlayerKey,
    allPlayerIds: PlayerKey[]
  ): number {
    // 1. スピード: immediate (0) < normal (1)
    const speedA = a.action.request?.speed === "immediate" ? 0 : 1;
    const speedB = b.action.request?.speed === "immediate" ? 0 : 1;
    if (speedA !== speedB) return speedA - speedB;

    // 2. プレイヤー順: turnPlayer からターン順
    const pA = this.getPlayerPriorityIndex(a.controller as PlayerKey, turnPlayer, allPlayerIds);
    const pB = this.getPlayerPriorityIndex(b.controller as PlayerKey, turnPlayer, allPlayerIds);
    if (pA !== pB) return pA - pB;

    // 3. タイミング: main (0) < quick (1) < others (2)
    const getTimingPriority = (timing?: string) => {
      if (timing === "main" || timing === "block" || timing === "damageJudge") return 0;
      if (timing === "quick") return 1;
      return 2;
    };
    const timingA = getTimingPriority(a.action.request?.timing);
    const timingB = getTimingPriority(b.action.request?.timing);
    if (timingA !== timingB) return timingA - timingB;

    // 4. 連番 / 登録順 (FIFO安定性)
    return (a.sequence || 0) - (b.sequence || 0);
  }

  /**
   * バッファ内の次の最優先リクエストを1件取り出します。
   */
  /**
   * バッファ内の次の最優先リクエストを非破壊で参照します（取り出しません）。
   */
  peekNextRequest(state: any): TriggeredActionRequest | undefined {
    if (!state || !state.requestBuffer) return undefined;
    const requestBuffer = state.requestBuffer as RequestBuffer;
    if (!requestBuffer.requests || requestBuffer.requests.length === 0) return undefined;

    const turnPlayer: PlayerKey = state.turnPlayer || "p1";
    const allPlayerIds: PlayerKey[] = Object.keys(state.players || {}) as PlayerKey[];

    // 優先度順でソート
    requestBuffer.requests.sort((a, b) =>
      TriggerProcessingCoordinator.compareRequests(a, b, turnPlayer, allPlayerIds)
    );

    return requestBuffer.requests[0];
  }

  /**
   * バッファ内の次の最優先リクエストを1件取り出します。
   */
  takeNextRequest(state: any): TriggeredActionRequest | undefined {
    if (!state || !state.requestBuffer) return undefined;
    const requestBuffer = state.requestBuffer as RequestBuffer;
    if (!requestBuffer.requests || requestBuffer.requests.length === 0) return undefined;

    const turnPlayer: PlayerKey = state.turnPlayer || "p1";
    const allPlayerIds: PlayerKey[] = Object.keys(state.players || {}) as PlayerKey[];

    // 優先度順でソート
    requestBuffer.requests.sort((a, b) =>
      TriggerProcessingCoordinator.compareRequests(a, b, turnPlayer, allPlayerIds)
    );

    return requestBuffer.requests.shift();
  }

  /**
   * リクエストバッファ内の全誘発リクエストを公式ルール9.4.1順序で処理します。
   * validation 成功確認後に buffer 削除 & sequence 確定 & stage 積載/即時解決を行い、
   * validation 失敗時は buffer や sequence を破壊しません。
   * - immediate: stage を経由せず直接解決
   * - normal: stage へ積載 (未解決)
   */
  processPendingTriggers(
    state: any,
    rulePackage: RulePackage,
    registry: CommandRegistry
  ): TriggerProcessingResult {
    let immediateResolvedCount = 0;
    let normalQueuedCount = 0;
    const stagedRequests: ActionRequest[] = [];

    while (state.requestBuffer && state.requestBuffer.requests && state.requestBuffer.requests.length > 0) {
      // 1. 最優先候補を peek（バッファはまだ破壊しない）
      const triggeredReq = this.peekNextRequest(state);
      if (!triggeredReq) break;

      const isImmediate = triggeredReq.action.request?.speed === "immediate";

      // 2. validation 用の仮 context
      const tempContext: CommandContext = {
        state,
        playerKey: triggeredReq.controller,
        keyCards: triggeredReq.keyCards,
        actions: rulePackage.actions,
        components: rulePackage.components,
        triggered: true,
      };

      // 3. validation（失敗時はここで例外がスローされ、buffer/sequence/stage は一切変更されない）
      this.validator.validateActionRequest(triggeredReq.action, tempContext);

      // 4. validation 成功後、正式に buffer から取り出し sequence を確定
      this.takeNextRequest(state);
      state.nextRequestSeq = (state.nextRequestSeq || 0) + 1;
      const seq = state.nextRequestSeq;
      const actionRequestId = `req-${seq}`;

      const actionReq: ActionRequest = {
        id: actionRequestId,
        actionId: triggeredReq.actionId,
        controller: triggeredReq.controller,
        keyCards: triggeredReq.keyCards,
        status: isImmediate ? "resolving" : "pending",
        sequence: seq,
        action: triggeredReq.action,
        triggered: true,
        source: "requestBuffer",
        sourceEvent: triggeredReq.sourceEvent,
        definitionOwner: triggeredReq.definitionOwner,
      };

      const context: CommandContext = {
        ...tempContext,
        currentRequest: actionReq,
      };

      if (isImmediate) {
        // 即時誘発: stage を経由せず直接解決
        if (triggeredReq.action.cost) {
          this.costResolver.pay(triggeredReq.action.cost, context, registry.getEffectInterpreter());
        }
        if (triggeredReq.action.effect) {
          registry.executeEffects(triggeredReq.action.effect, context);
        }

        actionReq.status = "resolved";
        if (!state.stage) state.stage = { requests: [], history: [] };
        if (!state.stage.history) state.stage.history = [];
        state.stage.history.push(actionReq);

        state.requestBuffer.history.push({
          actionId: triggeredReq.actionId,
          status: "resolvedImmediately",
          reason: `immediate triggered action resolved directly as ${actionRequestId}`,
          sourceEvent: triggeredReq.sourceEvent,
        });

        const resolveEvent = {
          type: "actionResolved",
          payload: {
            actionId: actionReq.actionId,
            playerKey: actionReq.controller,
          },
        };
        registry.dispatchEvent(resolveEvent, context);

        immediateResolvedCount++;
        console.log(`[BUFFER-IMMEDIATE-RESOLVE] 即時誘発アクションを直接解決: ${triggeredReq.actionId} (ID: ${actionReq.id})`);
      } else {
        // 通常誘発: stage へ積載（未解決）
        if (!state.stage) state.stage = { requests: [], history: [] };
        if (!state.stage.requests) state.stage.requests = [];
        state.stage.requests.push(actionReq);

        state.requestBuffer.history.push({
          actionId: triggeredReq.actionId,
          status: "movedToStage",
          reason: `requestBuffer item moved to stage as ${actionRequestId}`,
          sourceEvent: triggeredReq.sourceEvent,
        });

        normalQueuedCount++;
        stagedRequests.push(actionReq);
        console.log(`[BUFFER-MOVE] 通常誘発アクションをステージへ積載: ${triggeredReq.actionId} (ID: ${actionReq.id}, controller: ${actionReq.controller}, definitionOwner: ${actionReq.definitionOwner})`);
      }
    }

    return {
      immediateResolvedCount,
      normalQueuedCount,
      stagedRequests,
    };
  }
}
