import { CommandContext } from "./CommandRegistry";
import { ActionRequest, RequestBuffer, TriggeredActionRequest } from "../../domain/rules/RulePackage";
import { ActionRequestValidator } from "./ActionRequestValidator";
import { TriggerProcessingCoordinator } from "./TriggerProcessingCoordinator";
import { PlayerKey } from "../../domain/decision/DecisionSource";

export class RequestBufferProcessor {
  private validator = new ActionRequestValidator();

  /**
   * リクエストバッファから次の最優先リクエストを1件取り出し、ステージ（state.stage.requests）へ移送します。
   * バリデーション失敗時はバッファや連番を変更しません。
   */
  moveNextToStage(context: CommandContext): ActionRequest | undefined {
    const state = context.state;
    if (!state || !state.requestBuffer) return undefined;

    const requestBuffer = state.requestBuffer as RequestBuffer;
    if (!requestBuffer.requests || requestBuffer.requests.length === 0) {
      return undefined;
    }

    // 1. 公式ルール9.4.1優先度順で最優先のリクエストを peek
    const turnPlayer: PlayerKey = state.turnPlayer || "p1";
    const allPlayerIds: PlayerKey[] = Object.keys(state.players || {}) as PlayerKey[];
    requestBuffer.requests.sort((a, b) =>
      TriggerProcessingCoordinator.compareRequests(a, b, turnPlayer, allPlayerIds)
    );

    const triggeredReq = requestBuffer.requests[0];
    if (!triggeredReq) return undefined;

    // 2. 移送先の検証用 context の構築とバリデーション（非破壊で検証）
    const validateContext: CommandContext = {
      ...context,
      playerKey: triggeredReq.controller,
      keyCards: triggeredReq.keyCards,
      triggered: true,
    };

    this.validator.validateActionRequest(triggeredReq.action, validateContext);

    // 3. バリデーション成功後に初めてバッファから取り出し、IDと連番を発行
    requestBuffer.requests.shift();
    state.nextRequestSeq = (state.nextRequestSeq || 0) + 1;
    const seq = state.nextRequestSeq;
    const actionRequestId = `req-${seq}`;

    // 4. TriggeredActionRequest から ActionRequest へのマッピング・変換
    const actionReq: ActionRequest = {
      id: actionRequestId,
      actionId: triggeredReq.actionId,
      controller: triggeredReq.controller,
      keyCards: triggeredReq.keyCards,
      status: "pending",
      sequence: seq,
      action: triggeredReq.action,
      triggered: true,
      source: "requestBuffer",
      sourceEvent: triggeredReq.sourceEvent,
      definitionOwner: triggeredReq.definitionOwner,
    };

    // 5. ステージへの積載
    if (!state.stage) {
      state.stage = { requests: [], history: [] };
    }
    if (!state.stage.requests) {
      state.stage.requests = [];
    }
    state.stage.requests.push(actionReq);

    // 6. history への移動履歴の記録
    if (!requestBuffer.history) {
      requestBuffer.history = [];
    }
    requestBuffer.history.push({
      actionId: triggeredReq.actionId,
      status: "movedToStage",
      reason: `requestBuffer item moved to stage as ${actionRequestId}`,
      sourceEvent: triggeredReq.sourceEvent,
    });

    console.log(
      `[BUFFER-MOVE] リクエストをバッファからステージへ移動: ${triggeredReq.actionId} (ID: ${actionReq.id}, controller: ${actionReq.controller}, definitionOwner: ${actionReq.definitionOwner})`
    );

    return actionReq;
  }
}
