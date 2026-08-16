import { DecisionRequest } from "../../domain/decision/DecisionRequest";
import { DecisionCatalog, ActionSelection, CardSelection, UnitSelection, CostPayment, TargetSelection } from "../../domain/decision/DecisionCatalog";
import { LegalPattern } from "../../domain/decision/LegalPattern";
import { PlayerKey, DecisionSource } from "../../domain/decision/DecisionSource";
import { RulePackage, ActionDefinition } from "../../domain/rules/RulePackage";
import { ObservationFactory } from "./ObservationFactory";
import { CostPaymentEnumerator } from "./CostPaymentEnumerator";
import { TargetSelectionEnumerator } from "./TargetSelectionEnumerator";
import { ActionRequestValidator } from "../rules/ActionRequestValidator";
import { CommandContext } from "../rules/CommandRegistry";

/**
 * ランクを数値にマッピング
 */
function rankToValue(rank: string): number {
  const r = rank.toUpperCase();
  if (r === "A") return 1;
  if (r === "J") return 11;
  if (r === "Q") return 12;
  if (r === "K") return 13;
  if (r === "JOKER") return 0;
  const num = parseInt(r, 10);
  if (!isNaN(num)) return num;
  return 0;
}

/**
 * スートが一致するかどうかを検証
 */
function matchesSuit(cardSuit: string, expectedSuit: string): boolean {
  if (!expectedSuit) return true;
  const cs = cardSuit.toLowerCase();
  const es = expectedSuit.toLowerCase();
  if (cs === es) return true;
  if (es === "spade" && (cs === "s" || cs === "♠")) return true;
  if (es === "club" && (cs === "c" || cs === "♣")) return true;
  if (es === "heart" && (cs === "h" || cs === "♡" || cs === "♥")) return true;
  if (es === "diamond" && (cs === "d" || cs === "♢" || cs === "♦")) return true;
  if (es === "joker" && (cs === "j" || cs === "x")) return true;
  return false;
}

/**
 * ランクが一致するかどうかを検証 (範囲指定 "A..K", "A..10" 等に対応)
 */
function matchesRank(cardRank: string, cardValue: number, expectedRank: any): boolean {
  if (!expectedRank) return true;

  if (Array.isArray(expectedRank)) {
    return expectedRank.some((r) => r.toLowerCase() === cardRank.toLowerCase());
  }

  if (typeof expectedRank === "string") {
    if (expectedRank.includes("..")) {
      const [start, end] = expectedRank.split("..");
      const startVal = rankToValue(start);
      const endVal = rankToValue(end);
      return cardValue >= startVal && cardValue <= endVal;
    } else {
      return cardRank.toLowerCase() === expectedRank.toLowerCase();
    }
  }

  return false;
}

export interface DecisionGenerationMetrics {
  actionCount: number;
  keyCardCount: number;
  costCount: number;
  targetCount: number;
  finalPatternCount: number;
  elapsedMs: number;
}

/**
 * 全合法完成パターンの生成と DecisionRequest の構築を行うエンジン。
 */
export class LegalPatternGenerator {
  private static validator = new ActionRequestValidator();

  /**
   * 現在の盤面から、指定プレイヤー向けの合法な完成パターン全件を含む DecisionRequest を生成します。
   */
  static generateActionRequestDecision(
    state: any,
    playerId: PlayerKey,
    rulePackage: RulePackage,
    options?: { stateVersion?: number; matchId?: string; decisionId?: string; includePass?: boolean }
  ): { request: DecisionRequest; metrics: DecisionGenerationMetrics } {
    const startTime = typeof performance !== "undefined" ? performance.now() : Date.now();

    const stateVersion = options?.stateVersion ?? (state.stateVersion || 1);
    const matchId = options?.matchId ?? (state.matchId || "match-1");
    const decisionId = options?.decisionId ?? `dec-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const observation = ObservationFactory.createObservation(state, playerId);

    // 1. タイミングとチャンスに基づく候補アクションの抽出
    const player = state.players?.[playerId];
    const candidateActions = this.filterCandidateActions(rulePackage.actions, state, playerId);

    let totalKeyCards = 0;
    let totalCosts = 0;
    let totalTargets = 0;

    const rawPatterns: Array<{
      action: ActionDefinition;
      keyCards: any[];
      costPayment: CostPayment;
      targetSelection: TargetSelection;
    }> = [];

    for (const action of candidateActions) {
      // 2. キーカード候補の列挙
      const keyCardCombinations = this.enumerateKeyCardCombinations(action, player?.hand || []);
      totalKeyCards += keyCardCombinations.length;

      for (const keyCards of keyCardCombinations) {
        const keyCardSet = new Set<string>(keyCards.map((c) => c.id));

        // 3. コスト支払い候補の列挙（キーカードは除外）
        const costPayments = CostPaymentEnumerator.enumeratePayments(
          action.cost,
          player,
          keyCardSet
        );
        totalCosts += costPayments.length;

        // 4. 対象候補の列挙
        const targetSelections = TargetSelectionEnumerator.enumerateTargets(
          action,
          state,
          playerId,
          rulePackage.components
        );
        totalTargets += targetSelections.length;

        // 5. 直積の生成とバリデーション
        for (const costPayment of costPayments) {
          for (const targetSel of targetSelections) {
            // 対象コンポーネント/プレイヤー/リクエストの解決
            let targetComponent: any = undefined;
            let targetPlayerKey: string | undefined = targetSel.targetPlayerKey;
            let targetRequest: any = undefined;

            if (targetSel.targetType === "unit" && targetSel.targetUnitId) {
              for (const p of Object.values<any>(state.players || {})) {
                const u = p.field?.find((unit: any) => unit.unitId === targetSel.targetUnitId);
                if (u) {
                  targetComponent = u;
                  break;
                }
              }
            } else if (targetSel.targetType === "request" && targetSel.targetRequestId) {
              targetRequest = state.stage?.requests?.find(
                (r: any) => r.id === targetSel.targetRequestId
              );
            }

            const validateContext: CommandContext = {
              state,
              playerKey: playerId,
              keyCards,
              keyCard: keyCards.length === 1 ? keyCards[0] : undefined,
              targetComponent,
              targetPlayerKey,
              targetRequest,
              actions: rulePackage.actions,
              components: rulePackage.components,
            };

            try {
              this.validator.validateActionRequest(action, validateContext);
              rawPatterns.push({
                action,
                keyCards,
                costPayment,
                targetSelection: targetSel,
              });
            } catch {
              // バリデーション不合格の組み合わせは安全に除外
            }
          }
        }
      }
    }

    // 6. 共有カタログの作成（重複排除）
    const actionCatalog: ActionSelection[] = [];
    const cardSelectionCatalog: CardSelection[] = [];
    const unitSelectionCatalog: UnitSelection[] = [];
    const costPaymentCatalog: CostPayment[] = [];
    const targetSelectionCatalog: TargetSelection[] = [];

    const actionMap = new Map<string, number>();
    const cardMap = new Map<string, number>();
    const costMap = new Map<string, number>();
    const targetMap = new Map<string, number>();

    const getActionRef = (act: ActionDefinition): number => {
      if (actionMap.has(act.id)) return actionMap.get(act.id)!;
      const ref = actionCatalog.length;
      actionCatalog.push({
        actionId: act.id,
        actionName: act.name,
        timing: act.request?.timing,
        speed: act.request?.speed,
        cost: act.cost,
      });
      actionMap.set(act.id, ref);
      return ref;
    };

    const getCardSelectionRef = (cards: any[]): number => {
      const ids = cards.map((c) => c.id).sort();
      const key = ids.join(",");
      if (cardMap.has(key)) return cardMap.get(key)!;
      const ref = cardSelectionCatalog.length;
      cardSelectionCatalog.push({
        cardIds: cards.map((c) => c.id),
        displayCodes: cards.map((c) => c.code || `${c.suit}${c.rank}`),
      });
      cardMap.set(key, ref);
      return ref;
    };

    const getCostPaymentRef = (cost: CostPayment): number => {
      const key = `${cost.discardedCardIds.join(",")}|${cost.drivenBulwarkUnitIds.join(",")}|${cost.lifeCount}`;
      if (costMap.has(key)) return costMap.get(key)!;
      const ref = costPaymentCatalog.length;
      costPaymentCatalog.push(cost);
      costMap.set(key, ref);
      return ref;
    };

    const getTargetSelectionRef = (target: TargetSelection): number => {
      const key = `${target.targetType}:${target.targetPlayerKey || ""}:${target.targetUnitId || ""}:${target.targetRequestId || ""}`;
      if (targetMap.has(key)) return targetMap.get(key)!;
      const ref = targetSelectionCatalog.length;
      targetSelectionCatalog.push(target);
      targetMap.set(key, ref);
      return ref;
    };

    // 7. パターン一覧の構築と安定ソート
    const patterns: LegalPattern[] = rawPatterns.map((rp, index) => {
      const actionRef = getActionRef(rp.action);
      const keyCardRef = rp.keyCards.length > 0 ? getCardSelectionRef(rp.keyCards) : undefined;
      const costRef = getCostPaymentRef(rp.costPayment);
      const targetRef = getTargetSelectionRef(rp.targetSelection);

      const keyStr = rp.keyCards.map((c) => c.id).join(",");
      const costStr = `${rp.costPayment.discardedCardIds.join(",")}-${rp.costPayment.drivenBulwarkUnitIds.join(",")}-${rp.costPayment.lifeCount}`;
      const targetStr = rp.targetSelection.targetUnitId || rp.targetSelection.targetPlayerKey || rp.targetSelection.targetRequestId || "none";
      const patternId = `pat-${rp.action.id}-${keyStr || "nokey"}-${costStr}-${targetStr}`;

      return {
        patternId,
        kind: "ACTION" as const,
        actionSelectionRef: actionRef,
        keyCardSelectionRef: keyCardRef,
        costPaymentRef: costRef,
        targetSelectionRef: targetRef,
      };
    });

    // 安定ソート（AI・リプレイ・テスト再現性確保）
    patterns.sort((a, b) => {
      const actA = actionCatalog[a.actionSelectionRef!]?.actionId || "";
      const actB = actionCatalog[b.actionSelectionRef!]?.actionId || "";
      if (actA !== actB) return actA.localeCompare(actB);

      const keyA = a.keyCardSelectionRef !== undefined ? cardSelectionCatalog[a.keyCardSelectionRef]?.cardIds.join(",") : "";
      const keyB = b.keyCardSelectionRef !== undefined ? cardSelectionCatalog[b.keyCardSelectionRef]?.cardIds.join(",") : "";
      if (keyA !== keyB) return keyA.localeCompare(keyB);

      const costA = a.costPaymentRef !== undefined ? costPaymentCatalog[a.costPaymentRef]?.summary || "" : "";
      const costB = b.costPaymentRef !== undefined ? costPaymentCatalog[b.costPaymentRef]?.summary || "" : "";
      if (costA !== costB) return costA.localeCompare(costB);

      const tgtA = a.targetSelectionRef !== undefined ? targetSelectionCatalog[a.targetSelectionRef]?.displayName || "" : "";
      const tgtB = b.targetSelectionRef !== undefined ? targetSelectionCatalog[b.targetSelectionRef]?.displayName || "" : "";
      if (tgtA !== tgtB) return tgtA.localeCompare(tgtB);

      return a.patternId.localeCompare(b.patternId);
    });

    // PASS パターンの付与（Decision でのパス選択肢）
    if (options?.includePass !== false) {
      patterns.push({
        patternId: "pat-pass",
        kind: "PASS",
      });
    }

    const catalog: DecisionCatalog = {
      actions: Object.freeze(actionCatalog),
      cardSelections: Object.freeze(cardSelectionCatalog),
      unitSelections: Object.freeze(unitSelectionCatalog),
      costPayments: Object.freeze(costPaymentCatalog),
      targetSelections: Object.freeze(targetSelectionCatalog),
      effectSelections: Object.freeze([]),
      orderSelections: Object.freeze([]),
    };

    const source: DecisionSource = {
      type: "ACTION_REQUEST",
      playerId,
    };

    const endTime = typeof performance !== "undefined" ? performance.now() : Date.now();
    const elapsedMs = endTime - startTime;

    const request: DecisionRequest = {
      protocolVersion: "1.0.0",
      matchId,
      decisionId,
      stateVersion,
      playerId,
      source,
      observation,
      catalog,
      patterns: Object.freeze(patterns),
    };

    const metrics: DecisionGenerationMetrics = {
      actionCount: candidateActions.length,
      keyCardCount: totalKeyCards,
      costCount: totalCosts,
      targetCount: totalTargets,
      finalPatternCount: patterns.length,
      elapsedMs,
    };

    return { request, metrics };
  }

  /**
   * 現在のタイミングとチャンスから候補となり得るアクションを抽出
   */
  private static filterCandidateActions(actions: ActionDefinition[], state: any, playerId: PlayerKey): ActionDefinition[] {
    const isTurnPlayer = state.turnPlayer === playerId;
    const isChancePlayer = state.chancePlayer === playerId;
    const stageRequests = state.stage?.requests || [];
    const isStageEmpty = stageRequests.length === 0;

    return actions.filter((action) => {
      // triggered アクションは直接リクエストできないため除外
      if (action.type === "triggered" || action.request?.trigger === "triggered") {
        return false;
      }

      const timing = action.request?.timing || "main";

      if (timing === "main") {
        return isTurnPlayer && isChancePlayer && isStageEmpty;
      } else if (timing === "quick") {
        return isChancePlayer;
      } else if (timing === "block") {
        return isChancePlayer && isStageEmpty;
      } else if (timing === "damageJudge") {
        return isTurnPlayer && isChancePlayer && isStageEmpty;
      } else if (timing === "always") {
        return isChancePlayer;
      }
      return false;
    });
  }

  /**
   * アクション定義のキーカード条件を満たす手札カードの組み合わせを列挙
   */
  private static enumerateKeyCardCombinations(action: ActionDefinition, hand: any[]): any[][] {
    if (!action.key) {
      return [[]]; // キーカード不要
    }

    const keyDef = action.key;
    const expectedCount = keyDef.count !== undefined ? keyDef.count : 1;

    if (keyDef.conditions && Array.isArray(keyDef.conditions)) {
      // 複数キーカード条件（投擲、防壁破壊など）
      return this.enumerateMultiKeyConditions(keyDef.conditions, hand);
    } else if (keyDef.condition) {
      // 単一キーカード条件（アップ、ダウン、ツイストなど）
      const cond = keyDef.condition.card;
      const validCards = hand.filter((card) => {
        if (!cond) return true;
        return (
          matchesSuit(card.suit, cond.suit) &&
          matchesRank(card.rank, card.value || 0, cond.rank)
        );
      });

      if (expectedCount === 1) {
        return validCards.map((c) => [c]);
      } else {
        return this.getCombinations(validCards, expectedCount);
      }
    }

    return [[]];
  }

  /**
   * 複数キーカード条件の組み合わせ列挙
   */
  private static enumerateMultiKeyConditions(conditions: any[], hand: any[]): any[][] {
    if (hand.length < conditions.length) return [];

    const combinations = this.getCombinations(hand, conditions.length);
    const results: any[][] = [];

    for (const combo of combinations) {
      // 二部マッチング全順列判定
      const perms = this.getPermutations(combo);
      for (const p of perms) {
        let allMatch = true;
        for (let i = 0; i < conditions.length; i++) {
          const card = p[i];
          const cond = conditions[i].card;
          if (!cond) continue;
          if (!matchesSuit(card.suit, cond.suit) || !matchesRank(card.rank, card.value || 0, cond.rank)) {
            allMatch = false;
            break;
          }
        }
        if (allMatch) {
          results.push(combo);
          break;
        }
      }
    }

    return results;
  }

  private static getCombinations<T>(array: readonly T[], k: number): T[][] {
    if (k === 0) return [[]];
    if (array.length < k) return [];
    const result: T[][] = [];
    const helper = (start: number, current: T[]) => {
      if (current.length === k) {
        result.push([...current]);
        return;
      }
      for (let i = start; i < array.length; i++) {
        current.push(array[i]);
        helper(i + 1, current);
        current.pop();
      }
    };
    helper(0, []);
    return result;
  }

  private static getPermutations<T>(arr: T[]): T[][] {
    if (arr.length <= 1) return [arr];
    const result: T[][] = [];
    for (let i = 0; i < arr.length; i++) {
      const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
      const subPerms = this.getPermutations(rest);
      for (const p of subPerms) {
        result.push([arr[i], ...p]);
      }
    }
    return result;
  }
}
