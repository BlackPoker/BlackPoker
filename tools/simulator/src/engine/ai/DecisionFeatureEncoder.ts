import { DecisionRequest } from "../../domain/decision/DecisionRequest";
import { CardView, KnownCardView, UnitView } from "../../domain/decision/PlayerObservation";
import { generateLogicalPatternKey } from "../../domain/decision/LogicalPatternKey";
import {
  CONTEXT_FEATURE_NAMES,
  CONTEXT_FEATURE_DIMENSION,
  PATTERN_FEATURE_NAMES,
  PATTERN_FEATURE_DIMENSION,
  FEATURE_SCHEMA_VERSION,
  EncodedDecisionFeatures,
  DecisionPatternFeatures,
} from "../../domain/ai/DecisionFeatureTypes";

/**
 * DecisionRequest を合法的かつ決定論的な数値特徴量ベクトルへ変換する汎用エンコーダー (Version 1)。
 *
 * 【入力境界の原則】
 * 本エンコーダーの入力は合法的観測情報である Readonly<DecisionRequest> のみです。
 * 生の GameState、GameSession、Snapshot、RulePackage への直接アクセスは行いません。
 *
 * 【秘密情報保護・プライバシー】
 * 観測不能な相手手札、相手伏せ防壁、相手Life 10枚以上時の正確な枚数などは一切特徴量へ含めず、
 * 公開観測情報のみから安全にエンコードします。
 *
 * 【Master + Extra 互換原則】
 * 特定のアクション名 (action.attack 等) やコンポーネント ID をハードコードせず、
 * タイミング、スピード、コスト支払い、対象、カード/ユニット属性の汎用メタデータのみを特徴量化します。
 */
export class DecisionFeatureEncoder {
  public static readonly SCHEMA_VERSION = FEATURE_SCHEMA_VERSION;
  public static readonly CONTEXT_DIMENSION = CONTEXT_FEATURE_DIMENSION;
  public static readonly PATTERN_DIMENSION = PATTERN_FEATURE_DIMENSION;

  /**
   * DecisionRequest を数値特徴量ベクトル構造へエンコード
   */
  public static encode(request: Readonly<DecisionRequest>): EncodedDecisionFeatures {
    const contextValues = this.encodeContext(request);
    const patternFeatures = this.encodePatterns(request);

    return {
      featureSchemaVersion: this.SCHEMA_VERSION,
      context: {
        featureNames: CONTEXT_FEATURE_NAMES,
        values: contextValues,
      },
      patterns: patternFeatures,
    };
  }

  /**
   * 盤面・文脈特徴量 (Context Feature Vector) をエンコード
   */
  private static encodeContext(request: Readonly<DecisionRequest>): number[] {
    const obs = request.observation;
    const viewerId = request.playerId;

    const selfPlayer = obs.players?.find((p) => p.playerId === viewerId || p.isViewer);
    const opponentPlayer = obs.players?.find((p) => p.playerId !== viewerId && !p.isViewer);

    // 1. Decision Source
    const sourceIsAction = request.source?.type === "ACTION_REQUEST" ? 1 : 0;
    const sourceIsEffect = request.source?.type === "EFFECT_RESOLUTION" ? 1 : 0;

    // 2. Turn / Chance (Viewer Relative)
    const selfIsTurn = obs.turnPlayerId === viewerId ? 1 : 0;
    const selfIsChance = obs.chancePlayerId === viewerId ? 1 : 0;
    const oppIsTurn = obs.turnPlayerId && obs.turnPlayerId !== viewerId ? 1 : 0;
    const oppIsChance = obs.chancePlayerId && obs.chancePlayerId !== viewerId ? 1 : 0;

    // 3. Stage
    const stageDepth = obs.stageRequests
      ? obs.stageRequests.length
      : obs.stageRequestRefs
        ? obs.stageRequestRefs.length
        : 0;

    // 4. Legal Pattern Counts
    const patterns = request.patterns || [];
    const legalPatternCount = patterns.length;
    let legalActionCount = 0;
    let legalPassCount = 0;
    let legalEffectCount = 0;

    for (const p of patterns) {
      if (p.kind === "ACTION") legalActionCount++;
      else if (p.kind === "PASS") legalPassCount++;
      else if (p.kind === "EFFECT_SELECTION") legalEffectCount++;
    }

    // 5. Self (Viewer Relative)
    const selfLifeCount = selfPlayer?.lifeCount ?? 0;
    const selfHandCount = selfPlayer?.handCount ?? selfPlayer?.handCards?.length ?? 0;
    const selfFieldCount = selfPlayer?.field?.length ?? 0;
    const selfFogCount = selfPlayer?.fog?.length ?? 0;
    const selfTrumpCount = selfPlayer?.trumps?.length ?? 0;
    const selfGraveCount = selfPlayer?.graveCount ?? selfPlayer?.grave?.length ?? 0;

    // 6. Opponent (Viewer Relative - Secret-Safe)
    const oppLifeKnown = opponentPlayer?.lifeCount !== undefined ? 1 : 0;
    const oppLifeVisibleCount = opponentPlayer?.lifeCount ?? 0;
    const oppLifeIs10Plus = opponentPlayer && opponentPlayer.lifeCount === undefined ? 1 : 0;
    const oppHandCount = opponentPlayer?.handCount ?? opponentPlayer?.handCards?.length ?? 0;
    const oppFieldCount = opponentPlayer?.field?.length ?? 0;
    const oppFogCount = opponentPlayer?.fog?.length ?? 0;
    const oppTrumpCount = opponentPlayer?.trumps?.length ?? 0;
    const oppGraveCount = opponentPlayer?.graveCount ?? opponentPlayer?.grave?.length ?? 0;

    const values = [
      sourceIsAction,
      sourceIsEffect,
      selfIsTurn,
      selfIsChance,
      oppIsTurn,
      oppIsChance,
      stageDepth,
      legalPatternCount,
      legalActionCount,
      legalPassCount,
      legalEffectCount,
      selfLifeCount,
      selfHandCount,
      selfFieldCount,
      selfFogCount,
      selfTrumpCount,
      selfGraveCount,
      oppLifeKnown,
      oppLifeVisibleCount,
      oppLifeIs10Plus,
      oppHandCount,
      oppFieldCount,
      oppFogCount,
      oppTrumpCount,
      oppGraveCount,
    ];

    return values.map((v) => (Number.isFinite(v) ? v : 0));
  }

  /**
   * 合法パターン群 (Pattern Feature Vectors) をエンコード
   */
  private static encodePatterns(request: Readonly<DecisionRequest>): DecisionPatternFeatures[] {
    const catalog = request.catalog;
    const obs = request.observation;
    const viewerId = request.playerId;

    const selfPlayer = obs.players?.find((p) => p.playerId === viewerId || p.isViewer);
    const opponentPlayer = obs.players?.find((p) => p.playerId !== viewerId && !p.isViewer);

    // カード検索用マップ (Self Hand)
    const selfHandCardsMap = new Map<string, KnownCardView>();
    if (selfPlayer?.handCards) {
      for (const c of selfPlayer.handCards) {
        if (c.visibility === "KNOWN") {
          selfHandCardsMap.set(c.cardInstanceId, c);
        }
      }
    }

    // ユニット検索用マップ (Self & Opponent)
    const allUnitsMap = new Map<string, { unit: UnitView; owner: "self" | "opponent" }>();
    if (selfPlayer) {
      if (selfPlayer.field) {
        for (const u of selfPlayer.field) allUnitsMap.set(u.unitId, { unit: u, owner: "self" });
      }
      if (selfPlayer.trumps) {
        for (const u of selfPlayer.trumps) allUnitsMap.set(u.unitId, { unit: u, owner: "self" });
      }
    }
    if (opponentPlayer) {
      if (opponentPlayer.field) {
        for (const u of opponentPlayer.field) allUnitsMap.set(u.unitId, { unit: u, owner: "opponent" });
      }
      if (opponentPlayer.trumps) {
        for (const u of opponentPlayer.trumps) allUnitsMap.set(u.unitId, { unit: u, owner: "opponent" });
      }
    }

    const encodedPatterns: DecisionPatternFeatures[] = [];
    const patterns = request.patterns || [];

    for (let i = 0; i < patterns.length; i++) {
      const p = patterns[i];

      // 1. Pattern Kind
      const isAction = p.kind === "ACTION" ? 1 : 0;
      const isPass = p.kind === "PASS" ? 1 : 0;
      const isEffect = p.kind === "EFFECT_SELECTION" ? 1 : 0;
      const isOther = !isAction && !isPass && !isEffect ? 1 : 0;

      // 2. Action Metadata
      let hasAction = 0;
      let speedNormal = 0;
      let speedImmediate = 0;
      let speedOther = 0;
      let timingMain = 0;
      let timingQuick = 0;
      let timingBlock = 0;
      let timingDamageJudge = 0;
      let timingOther = 0;

      if (p.actionSelectionRef !== undefined && catalog?.actions) {
        const act = catalog.actions[p.actionSelectionRef];
        if (act) {
          hasAction = 1;
          const sp = act.speed?.toLowerCase();
          if (sp === "normal") speedNormal = 1;
          else if (sp === "immediate") speedImmediate = 1;
          else if (sp) speedOther = 1;

          const tm = act.timing?.toLowerCase();
          if (tm === "main") timingMain = 1;
          else if (tm === "quick") timingQuick = 1;
          else if (tm === "block") timingBlock = 1;
          else if (tm === "damagejudge" || tm === "damage_judge") timingDamageJudge = 1;
          else if (tm) timingOther = 1;
        }
      }

      // 3. Cost Payment
      let hasCost = 0;
      let costDiscardCount = 0;
      let costDrivenBulwarkCount = 0;
      let costSacrificedUnitCount = 0;
      let costLifeCount = 0;

      if (p.costPaymentRef !== undefined && catalog?.costPayments) {
        const cp = catalog.costPayments[p.costPaymentRef];
        if (cp) {
          hasCost = 1;
          costDiscardCount = cp.discardedCardIds?.length ?? 0;
          costDrivenBulwarkCount = cp.drivenBulwarkUnitIds?.length ?? 0;
          costSacrificedUnitCount = cp.sacrificedUnitIds?.length ?? 0;
          costLifeCount = cp.lifeCount ?? 0;
        }
      }

      // 4. Key Card Selection
      let hasKeyCard = 0;
      let keyCardCount = 0;
      let keyCardKnownCount = 0;
      let keyCardValueSum = 0;
      let keyCardValueMax = 0;
      let keyCardSpadeCount = 0;
      let keyCardHeartCount = 0;
      let keyCardDiamondCount = 0;
      let keyCardClubCount = 0;

      if (p.keyCardSelectionRef !== undefined && catalog?.cardSelections) {
        const cs = catalog.cardSelections[p.keyCardSelectionRef];
        if (cs && cs.cardIds) {
          hasKeyCard = 1;
          keyCardCount = cs.cardIds.length;
          for (const cid of cs.cardIds) {
            const card = selfHandCardsMap.get(cid);
            if (card) {
              keyCardKnownCount++;
              keyCardValueSum += card.value ?? 0;
              keyCardValueMax = Math.max(keyCardValueMax, card.value ?? 0);
              const suit = card.suit?.toLowerCase();
              if (suit === "spade" || suit === "spades" || suit === "s") keyCardSpadeCount++;
              else if (suit === "heart" || suit === "hearts" || suit === "h") keyCardHeartCount++;
              else if (suit === "diamond" || suit === "diamonds" || suit === "d") keyCardDiamondCount++;
              else if (suit === "club" || suit === "clubs" || suit === "c") keyCardClubCount++;
            }
          }
        }
      }

      // 5. Key Unit Selection
      let hasKeyUnit = 0;
      let keyUnitCount = 0;
      let selectedUnitSizeSum = 0;
      let selectedUnitSizeMax = 0;
      let selectedUnitChargeCount = 0;
      let selectedUnitDriveCount = 0;
      let selectedUnitFaceUpCount = 0;
      let selectedUnitFaceDownCount = 0;

      if (p.keyUnitSelectionRef !== undefined && catalog?.unitSelections) {
        const us = catalog.unitSelections[p.keyUnitSelectionRef];
        if (us && us.unitIds) {
          hasKeyUnit = 1;
          keyUnitCount = us.unitIds.length;
          for (const uid of us.unitIds) {
            const entry = allUnitsMap.get(uid);
            if (entry) {
              const u = entry.unit;
              const size = u.currentSize ?? 0;
              selectedUnitSizeSum += size;
              selectedUnitSizeMax = Math.max(selectedUnitSizeMax, size);
              if (u.state === "charge") selectedUnitChargeCount++;
              else if (u.state === "drive") selectedUnitDriveCount++;
              if (u.face === "up") selectedUnitFaceUpCount++;
              else if (u.face === "down") selectedUnitFaceDownCount++;
            }
          }
        }
      }

      // 6. Target Selection
      let hasTarget = 0;
      let targetIsPlayer = 0;
      let targetIsUnit = 0;
      let targetIsRequest = 0;
      let targetIsNone = 0;
      let targetIsOther = 0;
      let targetIsSelf = 0;
      let targetIsOpponent = 0;
      let targetUnitSize = 0;
      let targetUnitIsCharge = 0;
      let targetUnitIsDrive = 0;
      let targetUnitFaceUp = 0;
      let targetUnitFaceDown = 0;

      if (p.targetSelectionRef !== undefined && catalog?.targetSelections) {
        const ts = catalog.targetSelections[p.targetSelectionRef];
        if (ts) {
          hasTarget = 1;
          if (ts.targetType === "player") {
            targetIsPlayer = 1;
            if (ts.targetPlayerKey === viewerId) targetIsSelf = 1;
            else if (ts.targetPlayerKey) targetIsOpponent = 1;
          } else if (ts.targetType === "unit") {
            targetIsUnit = 1;
            if (ts.targetUnitId) {
              const entry = allUnitsMap.get(ts.targetUnitId);
              if (entry) {
                if (entry.owner === "self") targetIsSelf = 1;
                else targetIsOpponent = 1;
                const u = entry.unit;
                targetUnitSize = u.currentSize ?? 0;
                if (u.state === "charge") targetUnitIsCharge = 1;
                else if (u.state === "drive") targetUnitIsDrive = 1;
                if (u.face === "up") targetUnitFaceUp = 1;
                else if (u.face === "down") targetUnitFaceDown = 1;
              }
            }
          } else if (ts.targetType === "request") {
            targetIsRequest = 1;
          } else if (ts.targetType === "none") {
            targetIsNone = 1;
          } else {
            targetIsOther = 1;
          }
        }
      }

      // 7. Effect Selection
      let hasEffectSelection = 0;
      let effectTypeUnit = 0;
      let effectTypeUnitAssignment = 0;
      let effectTypeOther = 0;
      let effectSelectedValueCount = 0;
      let effectAssignmentCount = 0;
      let effectAssignedUnitTotal = 0;

      if (p.effectSelectionRef !== undefined && catalog?.effectSelections) {
        const es = catalog.effectSelections[p.effectSelectionRef];
        if (es) {
          hasEffectSelection = 1;
          if (es.selectionType === "unit") effectTypeUnit = 1;
          else if (es.selectionType === "unitAssignment") effectTypeUnitAssignment = 1;
          else effectTypeOther = 1;

          effectSelectedValueCount = es.selectedValues?.length ?? 0;
          effectAssignmentCount = es.assignments?.length ?? 0;
          if (es.assignments) {
            for (const a of es.assignments) {
              effectAssignedUnitTotal += a.selectedUnitIds?.length ?? 0;
            }
          }
        }
      }

      // 8. Order Selection
      let hasOrderSelection = 0;
      let orderedItemCount = 0;

      if (p.orderSelectionRef !== undefined && catalog?.orderSelections) {
        const os = catalog.orderSelections[p.orderSelectionRef];
        if (os) {
          hasOrderSelection = 1;
          orderedItemCount = os.orderedIds?.length ?? 0;
        }
      }

      const rawValues = [
        // 1. Kind
        isAction,
        isPass,
        isEffect,
        isOther,
        // 2. Action Metadata
        hasAction,
        speedNormal,
        speedImmediate,
        speedOther,
        timingMain,
        timingQuick,
        timingBlock,
        timingDamageJudge,
        timingOther,
        // 3. Cost
        hasCost,
        costDiscardCount,
        costDrivenBulwarkCount,
        costSacrificedUnitCount,
        costLifeCount,
        // 4. Key Card
        hasKeyCard,
        keyCardCount,
        keyCardKnownCount,
        keyCardValueSum,
        keyCardValueMax,
        keyCardSpadeCount,
        keyCardHeartCount,
        keyCardDiamondCount,
        keyCardClubCount,
        // 5. Key Unit
        hasKeyUnit,
        keyUnitCount,
        selectedUnitSizeSum,
        selectedUnitSizeMax,
        selectedUnitChargeCount,
        selectedUnitDriveCount,
        selectedUnitFaceUpCount,
        selectedUnitFaceDownCount,
        // 6. Target
        hasTarget,
        targetIsPlayer,
        targetIsUnit,
        targetIsRequest,
        targetIsNone,
        targetIsOther,
        targetIsSelf,
        targetIsOpponent,
        targetUnitSize,
        targetUnitIsCharge,
        targetUnitIsDrive,
        targetUnitFaceUp,
        targetUnitFaceDown,
        // 7. Effect Selection
        hasEffectSelection,
        effectTypeUnit,
        effectTypeUnitAssignment,
        effectTypeOther,
        effectSelectedValueCount,
        effectAssignmentCount,
        effectAssignedUnitTotal,
        // 8. Order Selection
        hasOrderSelection,
        orderedItemCount,
      ];

      const logicalKey = generateLogicalPatternKey({
        kind: p.kind || "UNKNOWN",
        actionSelectionRef: p.actionSelectionRef,
        keyCardSelectionRef: p.keyCardSelectionRef,
        keyUnitSelectionRef: p.keyUnitSelectionRef,
        costPaymentRef: p.costPaymentRef,
        targetSelectionRef: p.targetSelectionRef,
        effectSelectionRef: p.effectSelectionRef,
        orderSelectionRef: p.orderSelectionRef,
      });

      encodedPatterns.push({
        patternRef: i,
        kind: p.kind || "UNKNOWN",
        logicalPatternKey: logicalKey,
        values: rawValues.map((v) => (Number.isFinite(v) ? v : 0)),
      });
    }

    return encodedPatterns;
  }
}
