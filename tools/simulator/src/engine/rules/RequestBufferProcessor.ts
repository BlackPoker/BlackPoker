import { CommandContext } from "./CommandRegistry";
import { ActionRequest, RequestBuffer, TriggeredActionRequest } from "../../domain/rules/RulePackage";
import { ActionRequestValidator } from "./ActionRequestValidator";

export class RequestBufferProcessor {
  private validator = new ActionRequestValidator();

  /**
   * リクエストバッファから次のリクエストを1件取り出し、ステージ（state.stage.requests）へ移送します。
   */
  moveNextToStage(context: CommandContext): ActionRequest | undefined {
    const state = context.state;
    if (!state || !state.requestBuffer) return undefined;

    const requestBuffer = state.requestBuffer as RequestBuffer;
    if (!requestBuffer.requests || requestBuffer.requests.length === 0) {
      return undefined;
    }

    // 1. 先頭のリクエストを取り出す (FIFO)
    const triggeredReq = requestBuffer.requests.shift()!;

    // 2. IDと連番の発行
    state.nextRequestSeq = (state.nextRequestSeq || 0) + 1;
    const seq = state.nextRequestSeq;
    const actionRequestId = `req-${seq}`;

    // 3. TriggeredActionRequest から ActionRequest へのマッピング・変換
    // definitionOwner と controller を確実に引き継ぎます
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
      definitionOwner: triggeredReq.definitionOwner
    };

    // 4. 移送先の検証用 context の構築とバリデーション
    const validateContext: CommandContext = {
      ...context,
      playerKey: actionReq.controller,
      keyCards: actionReq.keyCards,
      triggered: true,
      currentRequest: actionReq
    };

    this.validator.validateActionRequest(triggeredReq.action, validateContext);

    // 5. ステージへの積載
    if (!state.stage) {
      state.stage = { requests: [] };
    }
    state.stage.requests.push(actionReq);

    // 6. history への移動履歴の記録
    requestBuffer.history.push({
      actionId: triggeredReq.actionId,
      status: "movedToStage",
      reason: `requestBuffer item moved to stage as ${actionRequestId}`,
      sourceEvent: triggeredReq.sourceEvent
    });

    console.log(`[BUFFER-MOVE] リクエストをバッファからステージへ移動: ${triggeredReq.actionId} (ID: ${actionReq.id}, controller: ${actionReq.controller}, definitionOwner: ${actionReq.definitionOwner})`);

    return actionReq;
  }
}
