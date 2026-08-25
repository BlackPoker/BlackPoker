import { CommandContext } from "./CommandRegistry";
import { ActionDefinition, RequestBuffer, TriggeredActionRequest, TriggerMatch } from "../../domain/rules/RulePackage";
import { getOpponentPlayerKey } from "./playerUtils";

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
   * プレイヤー参照文字列（DSL）を実際のプレイヤーキーに解決します。
   */
  resolvePlayerRef(ref: string | undefined, defaultPlayer: string, state: any, event?: any): string {
    if (!ref) return defaultPlayer;
    if (ref === "turnPlayer") return state.turnPlayer || defaultPlayer;
    if (ref === "nonTurnPlayer") return state.nonTurnPlayer || (state.turnPlayer ? getOpponentPlayerKey(state.turnPlayer, state) : defaultPlayer);
    if (ref === "opponent") return getOpponentPlayerKey(state.turnPlayer || defaultPlayer, state);
    if (ref === "eventPlayer") return event?.payload?.playerKey ?? defaultPlayer;
    if (ref === "self") return defaultPlayer;
    return ref;
  }

  /**
   * イベント（またはアクション解決）を検知し、誘発条件に合うアクションを評価してリクエストバッファに積みます。
   */
  resolveTriggers(event: unknown, context: CommandContext): void {
    const state = context.state;
    this.initializeBuffer(state);

    if (!context.actions) return;
    if (!isEventLike(event)) return;

    // 今回の同一誘発処理（resolveTriggers 呼び出し内）で誘発したアクション候補（1アクションにつき0〜N件の一致）
    const newlyTriggered: TriggerMatch[] = [];

    for (const action of context.actions) {
      const cond = action.triggerCondition;
      if (!cond || cond.event !== event.type) continue;

      // 1. candidateController / definitionOwner を先行解決
      const candidateController = this.resolvePlayerRef(
        action.request?.controller,
        event.payload?.playerKey ?? context.playerKey,
        state,
        event
      );
      const candidateOwner = this.resolvePlayerRef(
        action.request?.definitionOwner,
        candidateController,
        state,
        event
      );

      // 2. triggerCondition 評価 (sourceController 含む)
      const matches = this.findTriggerMatches(action, event, context, candidateController);
      for (const m of matches) {
        newlyTriggered.push({
          ...m,
          resolvedController: candidateController,
          resolvedDefinitionOwner: candidateOwner,
        } as any);
      }
    }

    if (newlyTriggered.length === 0) return;

    // 6-D-9 ルール（同一誘発処理内でのメイン系アクション複数誘発時の排他）の適用
    let hasMainTriggered = false;
    const requestBuffer = state.requestBuffer as RequestBuffer;

    for (const match of newlyTriggered) {
      const action = match.action;
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
        const controller = (match as any).resolvedController ?? context.playerKey;
        const definitionOwner = (match as any).resolvedDefinitionOwner ?? context.playerKey;

        const req: TriggeredActionRequest = {
          id: `req-trg-${seq}`,
          actionId: action.id,
          controller,
          keyCards: event.payload?.card ? [event.payload.card] : [],
          status: "pending",
          sequence: seq,
          action,
          sourceEvent: event,
          definitionOwner,
          triggerBindings: match.bindings,
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
   * 単一アクション定義に対するイベント一致結果を検索します（0〜N件）。
   * forEach が設定されている場合は、配列要素ごとに条件一致した match を生成します。
   */
  findTriggerMatches(
    action: ActionDefinition,
    event: { type: string; payload?: any },
    context: CommandContext,
    candidateController?: string
  ): TriggerMatch[] {
    const cond = action.triggerCondition;
    if (!cond) return [];
    const payload = event.payload || {};

    const ctrl = candidateController ?? this.resolvePlayerRef(
      action.request?.controller,
      payload.playerKey ?? context.playerKey,
      context.state,
      event
    );

    if (!this.evaluateBaseCondition(cond, event, context, ctrl)) {
      return [];
    }

    if (cond.condition?.forEach) {
      const forEachDef = cond.condition.forEach;
      const path = forEachDef.path;
      const asKey = forEachDef.as || "item";
      const whereCond = forEachDef.where || {};

      const items = this.resolvePathValue(path, event);
      if (!Array.isArray(items) || items.length === 0) {
        return [];
      }

      const selfPlayerKey = payload.playerKey ?? context.playerKey;
      const matches: TriggerMatch[] = [];

      for (const item of items) {
        let isMatch = true;
        for (const [key, expectedVal] of Object.entries(whereCond)) {
          const actualVal = item[key];
          const resolvedExpected = expectedVal === "self" ? selfPlayerKey : expectedVal;
          if (actualVal !== resolvedExpected) {
            isMatch = false;
            break;
          }
        }

        if (isMatch) {
          matches.push({
            action,
            bindings: { [asKey]: item },
          });
        }
      }

      return matches;
    }

    return [{ action }];
  }

  private resolvePathValue(pathStr: string, rootObj: any): any {
    const path = pathStr.startsWith("payload.")
      ? pathStr.substring("payload.".length)
      : pathStr;
    const segments = path.split(".");

    let current = pathStr.startsWith("payload.") ? rootObj.payload : rootObj;
    for (const seg of segments) {
      if (current === undefined || current === null) return undefined;
      current = current[seg];
    }
    return current;
  }

  /**
   * 基本的な誘発条件の評価
   */
  private evaluateBaseCondition(
    cond: { event: string; condition?: any },
    event: { type: string; payload?: any },
    context: CommandContext,
    candidateController: string
  ): boolean {
    const payload = event.payload || {};
    const state = context.state;
    const selfPlayerKey = candidateController;

    if (event.type === "cardMoved") {
      if (cond.condition) {
        if (cond.condition.fromZone && cond.condition.fromZone !== payload.fromZone) return false;
        if (cond.condition.toZone && cond.condition.toZone !== payload.toZone) return false;
        if (cond.condition.characterType && cond.condition.characterType !== payload.characterType) return false;

        // cause 条件の評価
        if (cond.condition.cause) {
          if (cond.condition.cause.actionId && cond.condition.cause.actionId !== payload.cause?.actionId) return false;
          if (cond.condition.cause.command && cond.condition.cause.command !== payload.cause?.command) return false;
        }

        // combat 条件の評価
        if (cond.condition.combat) {
          if (cond.condition.combat.role && cond.condition.combat.role !== payload.combat?.role) return false;
        }

        // card 条件の評価
        if (cond.condition.card) {
          const cardCond = cond.condition.card;
          if (cardCond.rank && payload.card) {
            const ranks = Array.isArray(cardCond.rank) ? cardCond.rank : [cardCond.rank];
            if (!ranks.includes(payload.card.rank)) return false;
          }
          if (cardCond.owner === "self") {
            const cardOwner = payload.card?.owner || payload.playerKey;
            if (cardOwner !== selfPlayerKey) return false;
          }
        }

        // activeComponent 条件の評価
        if (cond.condition.activeComponent) {
          if (!this.evaluateActiveComponent(cond.condition.activeComponent, selfPlayerKey, context)) {
            return false;
          }
        }
      }
      return true;
    }

    if (event.type === "actionResolved") {
      const targetActionId = payload.actionId;

      if (cond.condition) {
        if (cond.condition.actionId && cond.condition.actionId !== targetActionId) return false;

        // sourceController (generic relation) の評価
        if (cond.condition.sourceController) {
          const sourcePlayerKey = payload.playerKey ?? payload.controller ?? context.playerKey;
          const expectedRelation = cond.condition.sourceController;
          let isSourceMatch = false;

          if (expectedRelation === "opponent") {
            isSourceMatch = sourcePlayerKey === getOpponentPlayerKey(candidateController, state);
          } else if (expectedRelation === "self") {
            isSourceMatch = sourcePlayerKey === candidateController;
          } else if (expectedRelation === "turnPlayer") {
            isSourceMatch = sourcePlayerKey === state.turnPlayer;
          } else if (expectedRelation === "nonTurnPlayer") {
            const ntp = state.nonTurnPlayer || getOpponentPlayerKey(state.turnPlayer, state);
            isSourceMatch = sourcePlayerKey === ntp;
          } else {
            isSourceMatch = sourcePlayerKey === expectedRelation;
          }

          if (!isSourceMatch) return false;
        }

        // activeComponent 条件の評価
        if (cond.condition.activeComponent) {
          if (!this.evaluateActiveComponent(cond.condition.activeComponent, selfPlayerKey, context)) {
            return false;
          }
        }

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

  private evaluateActiveComponent(
    actCond: any,
    selfPlayerKey: string,
    context: CommandContext
  ): boolean {
    const targetPlayerKey = actCond.relation === "self"
      ? selfPlayerKey
      : getOpponentPlayerKey(selfPlayerKey, context.state);
    const targetPlayer = context.state.players?.[targetPlayerKey];
    if (!targetPlayer) return false;

    const zoneName = actCond.zone || "trump";
    const componentList = targetPlayer[zoneName] || targetPlayer[`${zoneName}s`] || [];
    const targetCompId = actCond.component || actCond.componentId;
    const expectedFace = actCond.face || "up";

    return Array.isArray(componentList) && componentList.some((comp: any) => {
      const matchId = targetCompId ? comp.componentId === targetCompId || comp.id === targetCompId : true;
      const matchFace = expectedFace ? comp.face === expectedFace : true;
      return matchId && matchFace;
    });
  }
}
