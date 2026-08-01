import { CommandContext } from "./CommandRegistry";
import { ActionDefinition, RequestBuffer, TriggeredActionRequest } from "../../domain/rules/RulePackage";

function isEventLike(event: unknown): event is { type: string; payload?: any } {
  return (
    typeof event === "object" &&
    event !== null &&
    "type" in event &&
    typeof (event as any).type === "string"
  );
}

export class TriggerResolver {
  /**
   * ゲーム状態にリクエストバッファを初期化します。
   */
  private initializeBuffer(state: any): void {
    if (!state.requestBuffer) {
      state.requestBuffer = {
        requests: [],
        history: []
      };
    }
  }

  /**
   * メイン系アクションかどうかを判定します。
   * block / damageJudge はフェーズではなく、メインアクションの起動条件を表す内部タイミング種別です。
   */
  isMainTriggeredRequest(action: ActionDefinition): boolean {
    const timing = action.request?.timing;
    return timing === "main" || timing === "block" || timing === "damageJudge";
  }

  /**
   * イベント（またはアクション解決）を検知し、誘発条件に合うアクションを評価してリクエストバッファに積みます。
   */
  resolveTriggers(event: unknown, context: CommandContext): void {
    const state = context.state;
    this.initializeBuffer(state);

    if (!context.actions) return;
    if (!isEventLike(event)) return;

    // 今回の同一誘発処理（resolveTriggers 呼び出し内）で誘発したアクション候補
    const newlyTriggered: ActionDefinition[] = [];

    for (const action of context.actions) {
      const cond = action.triggerCondition;
      if (!cond || cond.event !== event.type) continue;

      if (this.evaluateTriggerCondition(action, event, context)) {
        newlyTriggered.push(action);
      }
    }

    if (newlyTriggered.length === 0) return;

    // 6-D-9 ルール（同一誘発処理内でのメイン系アクション複数誘発時の排他）の適用
    let hasMainTriggered = false;
    const requestBuffer = state.requestBuffer as RequestBuffer;

    for (const action of newlyTriggered) {
      const isMain = this.isMainTriggeredRequest(action);

      if (isMain && hasMainTriggered) {
        // 6-D-9 に基づき後発メイン系アクションを破棄
        const discardReason = `6-D-9: later triggered main action discarded (actionId: ${action.id})`;
        requestBuffer.history.push({
          actionId: action.id,
          status: "discarded",
          reason: discardReason,
          sourceEvent: event
        });
        console.log(`[TRIGGER-DISCARD] 後発メインアクションのため破棄: ${action.id} (理由: ${discardReason})`);
      } else {
        // リクエストバッファへ積む
        state.nextRequestSeq = (state.nextRequestSeq || 0) + 1;
        const seq = state.nextRequestSeq;

        // リクエスト実行者の初期解決（デフォルトはイベント発生源のプレイヤー）
        let controller = context.playerKey;
        let definitionOwner = context.playerKey;

        // アタッカー・ブロッカー等の整合
        if (action.id === "action.block") {
          // ブロックは防御側プレイヤー（アタックを受けた側）がコントローラーとなる
          controller = context.playerKey === "p1" ? "p2" : "p1";
          definitionOwner = state.turnPlayer;
        } else if (action.id === "action.damageJudge") {
          // ダメージ判定はターンプレイヤー
          controller = state.turnPlayer;
          definitionOwner = state.turnPlayer;
        }

        const req: TriggeredActionRequest = {
          id: `req-trg-${seq}`,
          actionId: action.id,
          controller,
          keyCards: event.payload?.card ? [event.payload.card] : [],
          status: "pending",
          sequence: seq,
          action,
          sourceEvent: event,
          definitionOwner
        };

        requestBuffer.requests.push(req);
        requestBuffer.history.push({
          actionId: action.id,
          status: "triggered",
          sourceEvent: event
        });

        console.log(`[TRIGGER] ${action.name || action.id} が誘発しました (ID: ${req.id}, コントローラー: ${controller}, 所有者: ${definitionOwner})`);

        if (isMain) {
          hasMainTriggered = true;
        }
      }
    }
  }

  /**
   * 誘発条件の評価
   */
  private evaluateTriggerCondition(action: ActionDefinition, event: { type: string; payload?: any }, context: CommandContext): boolean {
    const cond = action.triggerCondition;
    if (!cond) return false;
    const payload = event.payload;

    if (event.type === "cardMoved") {
      if (cond.condition) {
        if (cond.condition.fromZone && cond.condition.fromZone !== payload.fromZone) return false;
        if (cond.condition.toZone && cond.condition.toZone !== payload.toZone) return false;

        if (cond.condition.card && payload.card) {
          const cardCond = cond.condition.card;
          if (cardCond.rank) {
            const ranks = Array.isArray(cardCond.rank) ? cardCond.rank : [cardCond.rank];
            if (!ranks.includes(payload.card.rank)) return false;
          }
          if (cardCond.owner === "self") {
            if (payload.playerKey !== context.playerKey) return false;
          }
        }
      }
      return true;
    }

    if (event.type === "actionResolved") {
      const state = context.state;
      const targetActionId = payload.actionId;

      if (cond.condition) {
        if (cond.condition.actionId && cond.condition.actionId !== targetActionId) return false;

        // hasAttacker の検証
        if (cond.condition.hasAttacker) {
          let hasAttacker = false;
          for (const player of Object.values<any>(state.players)) {
            if (player.field?.some((u: any) => u.battle?.role === "attacker")) {
              hasAttacker = true;
              break;
            }
          }
          if (!hasAttacker) return false;
        }

        // hasAttackerAndBlocker の検証
        if (cond.condition.hasAttackerAndBlocker) {
          let hasAttacker = false;
          let attackerUnitId = "";
          for (const player of Object.values<any>(state.players)) {
            const attacker = player.field?.find((u: any) => u.battle?.role === "attacker");
            if (attacker) {
              hasAttacker = true;
              attackerUnitId = attacker.unitId;
              break;
            }
          }

          if (!hasAttacker || !attackerUnitId) return false;

          let hasBlocker = false;
          for (const player of Object.values<any>(state.players)) {
            const blocker = player.field?.find(
              (u: any) => u.battle?.role === "blocker" && u.battle?.blocksUnitId === attackerUnitId
            );
            if (blocker) {
              hasBlocker = true;
              break;
            }
          }
          if (!hasBlocker) return false;
        }
      }
      return true;
    }

    // その他の未知のイベントやテスト用イベントに対するデフォルト評価
    if (cond.condition) {
      return Object.keys(cond.condition).length === 0;
    }
    return true;
  }
}
