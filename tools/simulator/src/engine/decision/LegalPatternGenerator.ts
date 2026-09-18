import { DecisionRequest } from "../../domain/decision/DecisionRequest";
import { DecisionCatalog, ActionSelection, CardSelection, UnitSelection, CostPayment, TargetSelection, EffectSelection, UnitAssignment, OrderSelection } from "../../domain/decision/DecisionCatalog";
import { LegalPattern } from "../../domain/decision/LegalPattern";
import { PlayerKey, DecisionSource } from "../../domain/decision/DecisionSource";
import { RulePackage, ActionDefinition, ComponentDefinition, ActionRequest } from "../../domain/rules/RulePackage";
import { ObservationFactory } from "./ObservationFactory";
import { CostPaymentEnumerator } from "./CostPaymentEnumerator";
import { TargetSelectionEnumerator } from "./TargetSelectionEnumerator";
import { ActionRequestValidator } from "../rules/ActionRequestValidator";
import { ActionActivationConditionEvaluator } from "../rules/ActionActivationConditionEvaluator";
import { ActionCostEvaluator, InvalidActionCostError } from "../rules/ActionCostEvaluator";
import { CommandContext } from "../rules/CommandRegistry";
import { isSoldierType } from "../rules/characterUtils";
import { formatSuitSymbol, matchesSuit, matchesRank, rankToValue, formatCardCodeShort, formatCardDisplay, normalizeSuit } from "../rules/cardUtils";
import { validateOptionSelectionDefinition } from "../rules/OptionSelectionValidator";


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
  private static costEvaluator = new ActionCostEvaluator();

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

      // Effective Cost の導出 (SSOT)
      let effectiveCost: string;
      try {
        effectiveCost = this.costEvaluator.resolveEffectiveCost(
          action,
          state,
          playerId,
          rulePackage.components
        );
      } catch (err) {
        if (err instanceof InvalidActionCostError) {
          // 不正なコスト定義を持つ Action は合法パターン生成からスキップ (fail-closed)
          continue;
        }
        throw err;
      }

      for (const keyCards of keyCardCombinations) {
        const keyCardSet = new Set<string>(keyCards.map((c) => c.id));

        // 3. コスト支払い候補の列挙（キーカードは除外）
        const costPayments = CostPaymentEnumerator.enumeratePayments(
          effectiveCost,
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
      const effectiveCost = LegalPatternGenerator.costEvaluator.resolveEffectiveCost(
        act,
        state,
        playerId,
        rulePackage.components
      );
      actionCatalog.push({
        actionId: act.id,
        actionName: act.name,
        timing: act.request?.timing,
        speed: act.request?.speed,
        cost: effectiveCost || undefined,
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
        displayCodes: cards.map((c) => `${formatSuitSymbol(c.suit)}${c.rank}`),
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

      // 使用回数制限 (usageLimit) の判定
      if (action.request?.usageLimit) {
        const { scope = "turn", max = 1 } = action.request.usageLimit;
        if (scope === "turn" && state.turnUsage) {
          const usedCount = state.turnUsage?.[playerId]?.[action.id] || 0;
          if (usedCount >= max) {
            return false;
          }
        }
      }

      // 起動条件 (activationCondition) の判定
      if (action.activationCondition) {
        const condResult = ActionActivationConditionEvaluator.evaluate(
          action.activationCondition,
          { state, playerKey: playerId }
        );
        if (!condResult.isLegal) {
          return false;
        }
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

    let results: any[][];
    if (keyDef.conditions && Array.isArray(keyDef.conditions)) {
      // 複数キーカード条件（投擲、防壁破壊など）
      results = this.enumerateMultiKeyConditions(keyDef.conditions, hand);
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
        results = validCards.map((c) => [c]);
      } else {
        results = this.getCombinations(validCards, expectedCount);
      }
    } else {
      return [[]];
    }

    if (keyDef.sameSuit) {
      const allowedSuits = new Set(["spade", "heart", "diamond", "club"]);
      results = results.filter((combo) => {
        if (combo.length <= 1) return true;
        const firstSuit = normalizeSuit(combo[0]?.suit);
        if (!allowedSuits.has(firstSuit)) return false;
        return combo.every((c) => normalizeSuit(c?.suit) === firstSuit);
      });
    }

    return results;
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

  /**
   * 効果解決時の選択（EFFECT_SELECTION）用 DecisionRequest を生成します。
   */
  static generateEffectSelectionDecision(
    state: any,
    playerId: PlayerKey,
    sourceRequest: any,
    effectStepId: string,
    candidates: any[],
    options?: { stateVersion?: number; matchId?: string; decisionId?: string; selectionId?: string }
  ): DecisionRequest {
    const stateVersion = options?.stateVersion ?? (state.stateVersion || 1);
    const matchId = options?.matchId ?? (state.matchId || "match-1");
    const decisionId = options?.decisionId ?? `dec-eff-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const observation = ObservationFactory.createObservation(state, playerId);

    // 候補ユニット群から空集合を含む 2^N 通りの組み合わせ（全部分集合）を列挙
    const powerSet = this.getPowerSet(candidates);

    const effectSelections: any[] = [];
    const patterns: LegalPattern[] = [];

    powerSet.forEach((subset, index) => {
      const selectedValues = subset.map((u) => u.unitId);
      const summary = subset.length === 0
        ? "アタッカーなし (0体)"
        : `アタッカー: ${subset.map((u) => u.kind || u.unitId).join(", ")}`;

      const effSel = {
        selectionType: "unit",
        selectedValues,
        summary,
      };
      effectSelections.push(effSel);

      const pattern: LegalPattern = {
        patternId: `effect-select-${index}-${selectedValues.join("_") || "none"}`,
        kind: "EFFECT_SELECTION",
        effectSelectionRef: index,
      };
      patterns.push(pattern);
    });

    const catalog: DecisionCatalog = {
      actions: [],
      cardSelections: [],
      unitSelections: [],
      costPayments: [],
      targetSelections: [],
      effectSelections,
      orderSelections: [],
    };

    const source: DecisionSource = {
      type: "EFFECT_RESOLUTION",
      sourceRequestRef: sourceRequest.id,
      effectStepId,
      playerId,
    };

    return {
      protocolVersion: "1.0.0",
      decisionId,
      stateVersion,
      matchId,
      playerId,
      source,
      catalog,
      patterns,
      observation,
    };
  }

  /**
   * カード選択（EFFECT_SELECTION - card / discardDownTo 等）用 DecisionRequest を生成します。
   */
  static generateCardSelectionDecision(
    state: any,
    playerId: PlayerKey,
    sourceRequest: any,
    effectStepId: string,
    candidates: any[],
    requiredCount: number = 1,
    options?: { stateVersion?: number; matchId?: string; decisionId?: string; selectionId?: string }
  ): DecisionRequest {
    const stateVersion = options?.stateVersion ?? (state.stateVersion || 1);
    const matchId = options?.matchId ?? (state.matchId || "match-1");
    const decisionId = options?.decisionId ?? `dec-card-eff-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const observation = ObservationFactory.createObservation(state, playerId);

    // candidates から requiredCount 枚の組み合わせ（k-combinations）を生成
    const combos = this.getCombinations(candidates, Math.min(requiredCount, candidates.length));

    const effectSelections: any[] = [];
    const patterns: LegalPattern[] = [];

    combos.forEach((combo, index) => {
      const selectedValues = combo.map((c) => c.id);
      const cardNames = combo.map((c) => formatCardDisplay(c)).join(", ");

      let summary = `カード選択 (${requiredCount}枚): [${cardNames}]`;
      if (options?.selectionId === "bulwarkCard" || sourceRequest?.actionId === "action.setBulwark" || sourceRequest?.action?.id === "action.setBulwark") {
        summary = `防壁カード選択: [${cardNames}]`;
      } else if (effectStepId === "discardDownTo" || options?.selectionId === "discardCards") {
        summary = `手札破棄 (${requiredCount}枚): [${cardNames}]`;
      }


      const effSel = {
        selectionType: "card",
        selectedValues,
        summary,
      };
      effectSelections.push(effSel);


      const pattern: LegalPattern = {
        patternId: `effect-card-select-${index}-${selectedValues.join("_") || "none"}`,
        kind: "EFFECT_SELECTION",
        effectSelectionRef: index,
      };
      patterns.push(pattern);
    });

    const catalog: DecisionCatalog = {
      actions: [],
      cardSelections: [],
      unitSelections: [],
      costPayments: [],
      targetSelections: [],
      effectSelections,
      orderSelections: [],
    };

    const source: DecisionSource = {
      type: "EFFECT_RESOLUTION",
      sourceRequestRef: sourceRequest.id,
      effectStepId,
      playerId,
    };

    return {
      protocolVersion: "1.0.0",
      decisionId,
      stateVersion,
      matchId,
      playerId,
      source,
      catalog,
      patterns,
      observation,
    };
  }

  /**
   * 汎用選択肢（EFFECT_SELECTION - option）用 DecisionRequest を生成します。
   * options 配列の順序（canonical presentation order）をそのまま維持してカタログおよびパターンを生成します。
   */
  static generateOptionSelectionDecision(
    state: any,
    playerId: PlayerKey,
    sourceRequest: any,
    effectStepId: string,
    options: Array<{ value: string; label?: string }>,
    extraOptions?: { stateVersion?: number; matchId?: string; decisionId?: string; selectionId?: string }
  ): DecisionRequest {
    const stateVersion = extraOptions?.stateVersion ?? (state.stateVersion || 1);
    const matchId = extraOptions?.matchId ?? (state.matchId || "match-1");
    const decisionId = extraOptions?.decisionId ?? `dec-opt-eff-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // 選択肢定義の厳格バリデーション (fail-closed)
    const selectionId = extraOptions?.selectionId || effectStepId || "option";
    const validated = validateOptionSelectionDefinition({ id: selectionId, options });

    const observation = ObservationFactory.createObservation(state, playerId);

    const effectSelections: any[] = [];
    const patterns: LegalPattern[] = [];

    validated.options.forEach((opt, index) => {
      const selectedValues = [opt.value];
      const summary = opt.label || `選択: ${opt.value}`;

      const effSel = {
        selectionType: "option",
        selectedValues,
        summary,
      };
      effectSelections.push(effSel);

      const pattern: LegalPattern = {
        patternId: `effect-option-${index}-${opt.value}`,
        kind: "EFFECT_SELECTION",
        effectSelectionRef: index,
      };
      patterns.push(pattern);
    });

    const catalog: DecisionCatalog = {
      actions: [],
      cardSelections: [],
      unitSelections: [],
      costPayments: [],
      targetSelections: [],
      effectSelections,
      orderSelections: [],
    };

    const source: DecisionSource = {
      type: "EFFECT_RESOLUTION",
      sourceRequestRef: sourceRequest.id,
      effectStepId,
      playerId,
    };

    return {
      protocolVersion: "1.0.0",
      decisionId,
      stateVersion,
      matchId,
      playerId,
      source,
      catalog,
      patterns,
      observation,
    };
  }

  /**
   * ユニット構成カードの順序選択時（EFFECT_RESOLUTION）の DecisionRequest を生成します。
   * 全順列 (N!) ではなく、未決定の残りカードから1枚ずつ選ぶ逐次決定 (最大 N-1 回) を採用します。
   */
  static generateOrderSelectionDecision(
    state: any,
    playerId: PlayerKey,
    sourceRequest: any,
    effectStepId: string,
    candidates: any[],
    options?: {
      stateVersion?: number;
      matchId?: string;
      decisionId?: string;
      selectionId?: string;
      currentSelections?: Record<string, any>;
    }
  ): DecisionRequest {
    const stateVersion = options?.stateVersion ?? (state.stateVersion || 1);
    const matchId = options?.matchId ?? (state.matchId || "match-1");
    const decisionId = options?.decisionId ?? `dec-ord-eff-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const selectionId = options?.selectionId || effectStepId || "order";
    const partialOrder: string[] = Array.isArray(options?.currentSelections?.[selectionId])
      ? options!.currentSelections![selectionId]
      : [];

    const observation = ObservationFactory.createObservation(state, playerId);

    // 未決定の候補カード群
    const remainingCards = candidates.filter((c) => !partialOrder.includes(c.id));

    const orderSelections: OrderSelection[] = [];
    const patterns: LegalPattern[] = [];

    remainingCards.forEach((card, index) => {
      const nextPartialIds = [...partialOrder, card.id];
      const orderedCards = nextPartialIds.map((id) => candidates.find((c) => c.id === id) || { id });
      const cardDisplays = orderedCards.map((c) => formatCardDisplay(c));
      const summary = `上から ${cardDisplays.join(" → ")}`;

      orderSelections.push({
        orderedIds: nextPartialIds,
        summary,
      });

      patterns.push({
        patternId: `effect-order-${index}-${card.id}`,
        kind: "EFFECT_SELECTION",
        orderSelectionRef: index,
      });
    });

    const catalog: DecisionCatalog = {
      actions: [],
      cardSelections: [],
      unitSelections: [],
      costPayments: [],
      targetSelections: [],
      effectSelections: [],
      orderSelections,
    };

    const source: DecisionSource = {
      type: "EFFECT_RESOLUTION",
      sourceRequestRef: sourceRequest.id,
      effectStepId,
      playerId,
    };

    return {
      protocolVersion: "1.0.0",
      decisionId,
      stateVersion,
      matchId,
      playerId,
      source,
      catalog,
      patterns,
      observation,
    };
  }

  /**
   * 最新のブロック割当て生成メトリクス
   */
  public static latestBlockAssignmentMetrics?: BlockAssignmentMetrics;

  /**
   * ブロック効果解決時（EFFECT_RESOLUTION）のアタッカー毎のブロッカー割当てDecisionRequestを生成
   * TODO: 将来、ActionDefinition を変更する能力や別アクションの assignment が追加された場合、
   * DSL 制約定義を直接解釈する汎用 assignment generator へ移行すること。
   */
  public static generateBlockAssignmentDecision(
    state: any,
    playerId: PlayerKey,
    sourceRequest: ActionRequest,
    effectStepId: string,
    attackers: any[],
    candidateBlockers: any[],
    components: readonly ComponentDefinition[] = []
  ): { request: DecisionRequest; metrics: BlockAssignmentMetrics } {
    const startTime = Date.now();
    const decisionId = `dec-eff-${sourceRequest.id}-${effectStepId}-${Date.now()}`;
    const stateVersion = state?.stateVersion ?? state?.version ?? 1;
    const matchId = state?.matchId ?? "match-local";
    const observation = ObservationFactory.createObservation(state, playerId);

    // アタッカー群に対するブロッカー割当ての全合法パターンをバックトラッキングで列挙
    const allAssignments: UnitAssignment[][] = [];

    const backtrack = (
      attackerIndex: number,
      currentAssignments: UnitAssignment[],
      usedBlockerIds: Set<string>
    ) => {
      if (attackerIndex === attackers.length) {
        allAssignments.push([...currentAssignments]);
        return;
      }

      const attacker = attackers[attackerIndex];
      const available = candidateBlockers.filter((b) => !usedBlockerIds.has(b.unitId));

      // 1. 0体ブロック (常に合法)
      currentAssignments.push({
        sourceUnitId: attacker.unitId,
        selectedUnitIds: [],
      });
      backtrack(attackerIndex + 1, currentAssignments, usedBlockerIds);
      currentAssignments.pop();

      // 2. 単一ブロッカー (任意の利用可能ブロッカー1体)
      for (const blocker of available) {
        currentAssignments.push({
          sourceUnitId: attacker.unitId,
          selectedUnitIds: [blocker.unitId],
        });
        usedBlockerIds.add(blocker.unitId);
        backtrack(attackerIndex + 1, currentAssignments, usedBlockerIds);
        usedBlockerIds.delete(blocker.unitId);
        currentAssignments.pop();
      }

      // 3. 複数兵士ブロッカー (利用可能な兵士ユニットのみから 2体以上の組み合わせ)
      const availableSoldiers = available.filter((b) => isSoldierType(b, components));
      if (availableSoldiers.length >= 2) {
        for (let k = 2; k <= availableSoldiers.length; k++) {
          const soldierCombos = this.getCombinations(availableSoldiers, k);
          for (const combo of soldierCombos) {
            const soldierIds = combo.map((s) => s.unitId);
            currentAssignments.push({
              sourceUnitId: attacker.unitId,
              selectedUnitIds: soldierIds,
            });
            for (const id of soldierIds) usedBlockerIds.add(id);
            backtrack(attackerIndex + 1, currentAssignments, usedBlockerIds);
            for (const id of soldierIds) usedBlockerIds.delete(id);
            currentAssignments.pop();
          }
        }
      }
    };

    if (attackers.length > 0) {
      backtrack(0, [], new Set());
    } else {
      allAssignments.push([]);
    }

    // カタログと LegalPattern を生成
    const effectSelections: EffectSelection[] = [];
    const patterns: LegalPattern[] = [];

    for (let i = 0; i < allAssignments.length; i++) {
      const assignments = allAssignments[i];
      const effectSelectionRef = i;

      // 概要サマリーの生成
      const summaryParts = assignments.map((a) => {
        const attackerUnit = attackers.find((u) => u.unitId === a.sourceUnitId);
        const attackerName = attackerUnit?.kind || a.sourceUnitId;
        if (a.selectedUnitIds.length === 0) {
          return `${attackerName} -> [ブロックなし]`;
        }
        const blockerNames = a.selectedUnitIds.map((bid) => {
          const u = candidateBlockers.find((b) => b.unitId === bid);
          return u?.kind || bid;
        });
        return `${attackerName} -> [${blockerNames.join(", ")}]`;
      });

      const summary = summaryParts.length > 0 ? summaryParts.join(" | ") : "全アタッカー ブロックなし";

      effectSelections.push({
        selectionType: "unitAssignment",
        assignments,
        summary,
      });

      patterns.push({
        patternId: `pat-block-${i}`,
        kind: "EFFECT_SELECTION",
        effectSelectionRef,
      });
    }

    const catalog: DecisionCatalog = {
      actions: [],
      cardSelections: [],
      unitSelections: [],
      costPayments: [],
      targetSelections: [],
      effectSelections,
      orderSelections: [],
    };

    const source: DecisionSource = {
      type: "EFFECT_RESOLUTION",
      sourceRequestRef: sourceRequest.id,
      effectStepId,
      playerId,
    };

    const elapsedMs = Date.now() - startTime;
    const metrics: BlockAssignmentMetrics = {
      attackersCount: attackers.length,
      blockersCount: candidateBlockers.length,
      patternCount: patterns.length,
      elapsedMs,
    };
    this.latestBlockAssignmentMetrics = metrics;

    const request: DecisionRequest = {
      protocolVersion: "1.0.0",
      decisionId,
      stateVersion,
      matchId,
      playerId,
      source,
      catalog,
      patterns,
      observation,
    };

    return { request, metrics };
  }

  /**
   * 配列の全部分集合（空集合を含む 2^N 通り）を生成
   */
  private static getPowerSet<T>(array: readonly T[]): T[][] {
    const result: T[][] = [[]];
    for (const elem of array) {
      const len = result.length;
      for (let i = 0; i < len; i++) {
        result.push([...result[i], elem]);
      }
    }
    // ソート: 要素数昇順、同要素数なら元の順序を維持
    return result.sort((a, b) => a.length - b.length);
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

export interface BlockAssignmentMetrics {
  readonly attackersCount: number;
  readonly blockersCount: number;
  readonly patternCount: number;
  readonly elapsedMs: number;
}
