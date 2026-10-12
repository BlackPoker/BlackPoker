/**
 * DecisionFeatureEncoder.ts
 *
 * BlackPoker Simulator - AI Feature Schema v4
 *
 * DecisionRequest を合法的かつ決定論的な数値特徴量ベクトルへ変換する汎用エンコーダー (Version 4)。
 *
 * 【入力境界の原則】
 * 本エンコーダーの入力は合法的観測情報である Readonly<DecisionRequest> のみです。
 * 生の GameState、GameSession、Snapshot、RulePackage への直接アクセスは行いません。
 *
 * 【秘密情報保護・プライバシー】
 * 観測不能な相手手札中身、相手伏せ防壁/切札、未開封パック中身、相手 Life 10枚以上時の正確な枚数などは
 * 一切特徴量へ含めず、公開観測情報のみから安全にエンコードします。
 *
 * 【Master + Extra 汎用原則】
 * 特定のアクション名 (action.attack 等) に対する手動ルールや個別 one-hot カラムをハードコードせず、
 * 固定長 multi-bucket hashing (StableIdentityEncoder) および汎用メタデータによって表現します。
 */

import { DecisionRequest } from "../../domain/decision/DecisionRequest";
import { CardView, KnownCardView, UnitView, RequestView } from "../../domain/decision/PlayerObservation";
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
import {
  KnownCardAggregateEncoder,
  EMPTY_KNOWN_CARD_AGGREGATE,
} from "./KnownCardAggregateEncoder";
import { StableIdentityEncoder } from "./StableIdentityEncoder";

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
   * 盤面・文脈特徴量 (Context Feature Vector: 163次元) をエンコード
   */
  private static encodeContext(request: Readonly<DecisionRequest>): number[] {
    const obs = request.observation;
    const viewerId = request.playerId;

    const selfPlayer = obs.players?.find((p) => p.playerId === viewerId || p.isViewer);
    const opponentPlayer = obs.players?.find((p) => p.playerId !== viewerId && !p.isViewer);

    // 1. Decision Context (8)
    const sourceIsAction = request.source?.type === "ACTION_REQUEST" ? 1 : 0;
    const sourceIsEffect = request.source?.type === "EFFECT_RESOLUTION" ? 1 : 0;
    const selfIsTurn = obs.turnPlayerId === viewerId ? 1 : 0;
    const selfIsChance = obs.chancePlayerId === viewerId ? 1 : 0;
    const oppIsTurn = obs.turnPlayerId && obs.turnPlayerId !== viewerId ? 1 : 0;
    const oppIsChance = obs.chancePlayerId && obs.chancePlayerId !== viewerId ? 1 : 0;
    const turnCount = typeof obs.turnCount === "number" && Number.isFinite(obs.turnCount) ? obs.turnCount : 0;
    const stageDepth = obs.stageRequests
      ? obs.stageRequests.length
      : obs.stageRequestRefs
        ? obs.stageRequestRefs.length
        : 0;

    // 2. Legal Pattern Counts & Actionability (11)
    const catalog = request.catalog;
    const patterns = request.patterns || [];
    const legalPatternCount = patterns.length;
    let legalActionCount = 0;
    let legalPassCount = 0;
    let legalEffectCount = 0;
    let legalNonPassCount = 0;
    let legalSpeedNormalCount = 0;
    let legalSpeedImmediateCount = 0;
    let legalTimingMainCount = 0;
    let legalTimingQuickCount = 0;
    let legalTimingBlockCount = 0;
    let legalTimingDamageJudgeCount = 0;

    for (let i = 0; i < patterns.length; i++) {
      const p = patterns[i];
      if (p.kind === "ACTION") {
        legalActionCount++;
        legalNonPassCount++;
        if (p.actionSelectionRef !== undefined && catalog?.actions) {
          const act = catalog.actions[p.actionSelectionRef];
          if (act) {
            const sp = act.speed?.toLowerCase();
            if (sp === "normal") legalSpeedNormalCount++;
            else if (sp === "immediate") legalSpeedImmediateCount++;

            const tm = act.timing?.toLowerCase();
            if (tm === "main") legalTimingMainCount++;
            else if (tm === "quick") legalTimingQuickCount++;
            else if (tm === "block") legalTimingBlockCount++;
            else if (tm === "damagejudge" || tm === "damage_judge") legalTimingDamageJudgeCount++;
          }
        }
      } else if (p.kind === "PASS") {
        legalPassCount++;
      } else if (p.kind === "EFFECT_SELECTION") {
        legalEffectCount++;
        legalNonPassCount++;
      } else {
        legalNonPassCount++;
      }
    }

    // 3. Self - Life & Hand (18)
    const selfLifeCount = selfPlayer?.lifeCount ?? 0;
    const selfHandCount = selfPlayer?.handCount ?? selfPlayer?.handCards?.length ?? 0;
    const selfHandAggregate = KnownCardAggregateEncoder.encode(selfPlayer?.handCards);
    const selfHandKnownCount = selfHandAggregate.count;
    const selfHandSpadeCount = selfHandAggregate.spadeCount;
    const selfHandHeartCount = selfHandAggregate.heartCount;
    const selfHandDiamondCount = selfHandAggregate.diamondCount;
    const selfHandClubCount = selfHandAggregate.clubCount;
    const selfHandJokerCount = selfHandAggregate.jokerCount;
    const selfHandNumericCount = selfHandAggregate.numericCount;
    const selfHandAceCount = selfHandAggregate.aceCount;
    const selfHandJackCount = selfHandAggregate.jackCount;
    const selfHandQueenCount = selfHandAggregate.queenCount;
    const selfHandKingCount = selfHandAggregate.kingCount;
    const selfHandValueSum = selfHandAggregate.valueSum;
    const selfHandValueMax = selfHandAggregate.valueMax;
    const selfHandValueMin = selfHandAggregate.valueMin;
    const selfHandPairRankCount = selfHandAggregate.pairRankCount;
    const selfHandMaxRankMultiplicity = selfHandAggregate.maxRankMultiplicity;

    // 4. Self - Field & Components (9)
    const selfField = selfPlayer?.field || [];
    const selfFieldCount = selfField.length;
    let selfFieldChargeCount = 0;
    let selfFieldDriveCount = 0;
    let selfFieldFaceUpCount = 0;
    let selfFieldFaceDownCount = 0;
    let selfFieldSizeSum = 0;
    let selfFieldSizeMax = 0;
    let selfFieldAttackerCount = 0;
    let selfFieldBlockerCount = 0;

    for (let i = 0; i < selfField.length; i++) {
      const u = selfField[i];
      if (u.state === "charge") selfFieldChargeCount++;
      else if (u.state === "drive") selfFieldDriveCount++;

      if (u.face === "up") selfFieldFaceUpCount++;
      else if (u.face === "down") selfFieldFaceDownCount++;

      const sz = typeof u.currentSize === "number" && Number.isFinite(u.currentSize) ? u.currentSize : 0;
      selfFieldSizeSum += sz;
      if (sz > selfFieldSizeMax) selfFieldSizeMax = sz;

      if (u.battle?.role === "attacker") selfFieldAttackerCount++;
      else if (u.battle?.role === "blocker") selfFieldBlockerCount++;
    }

    // 5. Self - Fog, Trump, Grave, Pack, Rare (18)
    const selfFog = selfPlayer?.fog || [];
    const selfFogCount = selfFog.length;
    let selfFogCardKnownCount = 0;
    for (let i = 0; i < selfFog.length; i++) {
      if (selfFog[i].card && selfFog[i].card?.visibility === "KNOWN") {
        selfFogCardKnownCount++;
      }
    }

    const selfTrumps = selfPlayer?.trumps || [];
    const selfTrumpCount = selfTrumps.length;
    let selfTrumpChargeCount = 0;
    let selfTrumpDriveCount = 0;
    let selfTrumpSizeSum = 0;
    for (let i = 0; i < selfTrumps.length; i++) {
      const t = selfTrumps[i];
      if (t.state === "charge") selfTrumpChargeCount++;
      else if (t.state === "drive") selfTrumpDriveCount++;
      const sz = typeof t.currentSize === "number" && Number.isFinite(t.currentSize) ? t.currentSize : 0;
      selfTrumpSizeSum += sz;
    }

    const selfGraveCount = selfPlayer?.graveCount ?? selfPlayer?.grave?.length ?? 0;
    const selfGraveTopKnown = selfPlayer?.graveTopCard && selfPlayer.graveTopCard.visibility === "KNOWN" ? 1 : 0;
    const selfGraveTopValue = selfGraveTopKnown && selfPlayer?.graveTopCard && "value" in selfPlayer.graveTopCard
      ? (selfPlayer.graveTopCard as any).value ?? 0
      : 0;
    const selfGraveTopIsJoker = selfGraveTopKnown && selfPlayer?.graveTopCard && "suit" in selfPlayer.graveTopCard
      ? ((selfPlayer.graveTopCard as any).suit === "J" || (selfPlayer.graveTopCard as any).rank === "Joker" ? 1 : 0)
      : 0;

    const selfPack = selfPlayer?.pack;
    const selfPackCount = selfPack?.count ?? 0;
    const selfPackOpened = selfPack?.opened ? 1 : 0;
    const selfPackCanViewCards = selfPack?.canViewCards ? 1 : 0;
    const selfPackAggregate = selfPack?.canViewCards ? KnownCardAggregateEncoder.encode(selfPack.cards) : EMPTY_KNOWN_CARD_AGGREGATE;
    const selfPackKnownCardCount = selfPackAggregate.count;
    const selfPackKnownValueSum = selfPackAggregate.valueSum;

    const selfRare = selfPlayer?.rareCards;
    const selfRareCount = selfRare?.count ?? 0;
    const selfRareCanViewCards = selfRare?.canViewCards ? 1 : 0;
    const selfRareAggregate = selfRare?.canViewCards ? KnownCardAggregateEncoder.encode(selfRare.cards) : EMPTY_KNOWN_CARD_AGGREGATE;
    const selfRareKnownCardCount = selfRareAggregate.count;

    // 6. Opponent - Observable Information (Secret-Safe) (26)
    const oppLifeKnown = opponentPlayer?.lifeCount !== undefined ? 1 : 0;
    const oppLifeVisibleCount = opponentPlayer?.lifeCount ?? 0;
    const oppLifeIs10Plus = opponentPlayer && opponentPlayer.lifeCount === undefined ? 1 : 0;
    const oppHandCount = opponentPlayer?.handCount ?? opponentPlayer?.handCards?.length ?? 0;

    const oppField = opponentPlayer?.field || [];
    const oppFieldCount = oppField.length;
    let oppFieldChargeCount = 0;
    let oppFieldDriveCount = 0;
    let oppFieldFaceUpCount = 0;
    let oppFieldFaceDownCount = 0;
    let oppFieldSizeSum = 0;
    let oppFieldSizeMax = 0;
    let oppFieldAttackerCount = 0;
    let oppFieldBlockerCount = 0;

    for (let i = 0; i < oppField.length; i++) {
      const u = oppField[i];
      if (u.state === "charge") oppFieldChargeCount++;
      else if (u.state === "drive") oppFieldDriveCount++;

      if (u.face === "up") oppFieldFaceUpCount++;
      else if (u.face === "down") oppFieldFaceDownCount++;

      const sz = typeof u.currentSize === "number" && Number.isFinite(u.currentSize) ? u.currentSize : 0;
      oppFieldSizeSum += sz;
      if (sz > oppFieldSizeMax) oppFieldSizeMax = sz;

      if (u.battle?.role === "attacker") oppFieldAttackerCount++;
      else if (u.battle?.role === "blocker") oppFieldBlockerCount++;
    }

    const oppFog = opponentPlayer?.fog || [];
    const oppFogCount = oppFog.length;
    let oppFogCardKnownCount = 0;
    for (let i = 0; i < oppFog.length; i++) {
      if (oppFog[i].card && oppFog[i].card?.visibility === "KNOWN") {
        oppFogCardKnownCount++;
      }
    }

    const oppTrumps = opponentPlayer?.trumps || [];
    const oppTrumpCount = oppTrumps.length;
    let oppTrumpChargeCount = 0;
    let oppTrumpDriveCount = 0;
    let oppTrumpSizeSum = 0;
    for (let i = 0; i < oppTrumps.length; i++) {
      const t = oppTrumps[i];
      if (t.state === "charge") oppTrumpChargeCount++;
      else if (t.state === "drive") oppTrumpDriveCount++;
      const sz = typeof t.currentSize === "number" && Number.isFinite(t.currentSize) ? t.currentSize : 0;
      oppTrumpSizeSum += sz;
    }

    const oppGraveCount = opponentPlayer?.graveCount ?? opponentPlayer?.grave?.length ?? 0;
    const oppGraveTopKnown = opponentPlayer?.graveTopCard && opponentPlayer.graveTopCard.visibility === "KNOWN" ? 1 : 0;
    const oppGraveTopValue = oppGraveTopKnown && opponentPlayer?.graveTopCard && "value" in opponentPlayer.graveTopCard
      ? (opponentPlayer.graveTopCard as any).value ?? 0
      : 0;
    const oppGraveTopIsJoker = oppGraveTopKnown && opponentPlayer?.graveTopCard && "suit" in opponentPlayer.graveTopCard
      ? ((opponentPlayer.graveTopCard as any).suit === "J" || (opponentPlayer.graveTopCard as any).rank === "Joker" ? 1 : 0)
      : 0;

    const oppPack = opponentPlayer?.pack;
    const oppPackCount = oppPack?.count ?? 0;
    const oppPackOpened = oppPack?.opened ? 1 : 0;
    const oppRare = opponentPlayer?.rareCards;
    const oppRareCount = oppRare?.count ?? 0;

    // 7. Relative State (Viewer Relative Deltas) (10)
    const relativeHandCount = selfHandCount - oppHandCount;
    const relativeFieldCount = selfFieldCount - oppFieldCount;
    const relativeFieldSizeSum = selfFieldSizeSum - oppFieldSizeSum;
    const relativeFogCount = selfFogCount - oppFogCount;
    const relativeGraveCount = selfGraveCount - oppGraveCount;
    const relativePackCount = selfPackCount - oppPackCount;
    const relativeRareCount = selfRareCount - oppRareCount;
    const relativeTrumpCount = selfTrumpCount - oppTrumpCount;

    // Life 差分: 相手のライフが正確に分かる (oppLifeKnown === 1) かつ 自分も分かる場合のみ
    const relativeLifeKnown = oppLifeKnown === 1 && typeof selfPlayer?.lifeCount === "number" ? 1 : 0;
    const relativeLifeCount = relativeLifeKnown === 1 ? selfLifeCount - oppLifeVisibleCount : 0;

    // 8. Request Context (Viewer Relative) (63)
    const requestHasSource = request.source !== undefined ? 1 : 0;
    const requestSourceIsAction = request.source?.type === "ACTION_REQUEST" ? 1 : 0;
    const requestSourceIsEffect = request.source?.type === "EFFECT_RESOLUTION" ? 1 : 0;
    const requestSourceIsZoneTop = request.source?.type === "ZONE_TOP_SELECTION" ? 1 : 0;

    let sourceActionId: string | undefined = undefined;
    let sourceEffectStepId: string | undefined = undefined;
    let sourceController: string | undefined = undefined;
    let sourceSpeed: string | undefined = undefined;
    let sourceTiming: string | undefined = undefined;
    let sourceKeyCards: readonly CardView[] = [];
    let sourceTargetSelection: any = undefined;

    if (request.source?.type === "EFFECT_RESOLUTION") {
      sourceEffectStepId = request.source.effectStepId;
      const ref = request.source.sourceRequestRef;

      // 1. Stage 上のリクエストから解決
      let reqView = obs.stageRequests?.find((r) => r.requestId === ref);

      // 2. 一致しなければ Stage 外 Source Request (effectSourceRequest) から解決
      if (!reqView && obs.effectSourceRequest && obs.effectSourceRequest.requestId === ref) {
        reqView = obs.effectSourceRequest;
      }

      if (reqView) {
        sourceActionId = reqView.actionId;
        sourceController = reqView.controller;
        if (reqView.keyCards) {
          sourceKeyCards = reqView.keyCards;
        }
        if (reqView.target) {
          sourceTargetSelection = reqView.target;
        }
        if (reqView.actionSpeed) {
          sourceSpeed = reqView.actionSpeed;
        }
        if (reqView.actionTiming) {
          sourceTiming = reqView.actionTiming;
        }
      }
      // Stage外（即時解決等）フォールバック
      if (!sourceActionId && request.source.sourceActionId) {
        sourceActionId = request.source.sourceActionId;
      }
      if (request.source.playerId) {
        sourceController = sourceController ?? request.source.playerId;
      }
    } else if (request.source?.type === "ACTION_REQUEST") {
      sourceController = request.source.playerId;
    } else if (request.source?.type === "ZONE_TOP_SELECTION") {
      sourceController = request.source.playerId;
    }

    // カタログから Action メタデータ (speed, timing) を補完
    if (sourceActionId && catalog?.actions) {
      const catAct = catalog.actions.find((a) => a.actionId === sourceActionId);
      if (catAct) {
        sourceSpeed = catAct.speed;
        sourceTiming = catAct.timing;
      }
    }

    const requestSourceControllerIsSelf = sourceController === viewerId ? 1 : 0;
    const requestSourceControllerIsOpponent = sourceController && sourceController !== viewerId ? 1 : 0;

    // 8.2 Action Stable Identity (16 buckets)
    const actionBuckets = StableIdentityEncoder.encodeActionIdentity(sourceActionId);

    // 8.3 Effect Step Stable Identity (16 buckets)
    const effectStepBuckets = StableIdentityEncoder.encodeEffectStepIdentity(sourceEffectStepId);

    // 8.4 Action Metadata (8)
    let reqSpeedNormal = 0;
    let reqSpeedImmediate = 0;
    let reqSpeedOther = 0;
    if (sourceSpeed) {
      const sp = sourceSpeed.toLowerCase();
      if (sp === "normal") reqSpeedNormal = 1;
      else if (sp === "immediate") reqSpeedImmediate = 1;
      else reqSpeedOther = 1;
    }

    let reqTimingMain = 0;
    let reqTimingQuick = 0;
    let reqTimingBlock = 0;
    let reqTimingDamageJudge = 0;
    let reqTimingOther = 0;
    if (sourceTiming) {
      const tm = sourceTiming.toLowerCase();
      if (tm === "main") reqTimingMain = 1;
      else if (tm === "quick") reqTimingQuick = 1;
      else if (tm === "block") reqTimingBlock = 1;
      else if (tm === "damagejudge" || tm === "damage_judge") reqTimingDamageJudge = 1;
      else reqTimingOther = 1;
    }

    // 8.5 Source Request Visible Key Card Aggregate (5)
    let reqKeyCardCount = sourceKeyCards.length;
    let reqKeyCardKnownCount = 0;
    let reqKeyCardValueSum = 0;
    let reqKeyCardValueMax = 0;
    let reqKeyCardValueMin = 0;
    let reqMinVal = Infinity;

    for (let i = 0; i < sourceKeyCards.length; i++) {
      const c = sourceKeyCards[i];
      if (c && c.visibility === "KNOWN") {
        reqKeyCardKnownCount++;
        const val = (c as KnownCardView).value ?? 0;
        reqKeyCardValueSum += val;
        if (val > reqKeyCardValueMax) reqKeyCardValueMax = val;
        if (val < reqMinVal) reqMinVal = val;
      }
    }
    if (reqMinVal !== Infinity) {
      reqKeyCardValueMin = reqMinVal;
    }

    // 8.6 Source Request Target Semantics (12)
    let reqTargetIsPlayer = 0;
    let reqTargetIsUnit = 0;
    let reqTargetIsRequest = 0;
    let reqTargetIsNone = 0;
    let reqTargetIsOther = 0;
    let reqTargetIsSelf = 0;
    let reqTargetIsOpponent = 0;
    let reqTargetUnitSize = 0;
    let reqTargetUnitIsCharge = 0;
    let reqTargetUnitIsDrive = 0;
    let reqTargetUnitFaceUp = 0;
    let reqTargetUnitFaceDown = 0;

    if (sourceTargetSelection) {
      const k = ((sourceTargetSelection as any).kind || sourceTargetSelection.targetType || "").toLowerCase();
      const pKey = sourceTargetSelection.targetPlayerKey;
      const uId = sourceTargetSelection.targetUnitId;

      if (k === "player") {
        reqTargetIsPlayer = 1;
        if (pKey === viewerId) reqTargetIsSelf = 1;
        else if (pKey) reqTargetIsOpponent = 1;
      } else if (k === "unit") {
        reqTargetIsUnit = 1;
        // ターゲットユニットが合法的観測にあるか確認
        const u = selfField.find((unit) => unit.unitId === uId) || oppField.find((unit) => unit.unitId === uId);
        if (u) {
          if (selfField.some((unit) => unit.unitId === uId)) reqTargetIsSelf = 1;
          else reqTargetIsOpponent = 1;

          reqTargetUnitSize = u.currentSize ?? 0;
          if (u.state === "charge") reqTargetUnitIsCharge = 1;
          else if (u.state === "drive") reqTargetUnitIsDrive = 1;
          if (u.face === "up") reqTargetUnitFaceUp = 1;
          else if (u.face === "down") reqTargetUnitFaceDown = 1;
        }
      } else if (k === "request") {
        reqTargetIsRequest = 1;
      } else if (k === "none") {
        reqTargetIsNone = 1;
      } else {
        reqTargetIsOther = 1;
      }
    }

    const values = [
      // 1. Decision Context (8)
      sourceIsAction,
      sourceIsEffect,
      selfIsTurn,
      selfIsChance,
      oppIsTurn,
      oppIsChance,
      turnCount,
      stageDepth,

      // 2. Legal Pattern Counts & Actionability (11)
      legalPatternCount,
      legalActionCount,
      legalPassCount,
      legalEffectCount,
      legalNonPassCount,
      legalSpeedNormalCount,
      legalSpeedImmediateCount,
      legalTimingMainCount,
      legalTimingQuickCount,
      legalTimingBlockCount,
      legalTimingDamageJudgeCount,

      // 3. Self - Life & Hand (18)
      selfLifeCount,
      selfHandCount,
      selfHandKnownCount,
      selfHandSpadeCount,
      selfHandHeartCount,
      selfHandDiamondCount,
      selfHandClubCount,
      selfHandJokerCount,
      selfHandNumericCount,
      selfHandAceCount,
      selfHandJackCount,
      selfHandQueenCount,
      selfHandKingCount,
      selfHandValueSum,
      selfHandValueMax,
      selfHandValueMin,
      selfHandPairRankCount,
      selfHandMaxRankMultiplicity,

      // 4. Self - Field & Components (9)
      selfFieldCount,
      selfFieldChargeCount,
      selfFieldDriveCount,
      selfFieldFaceUpCount,
      selfFieldFaceDownCount,
      selfFieldSizeSum,
      selfFieldSizeMax,
      selfFieldAttackerCount,
      selfFieldBlockerCount,

      // 5. Self - Fog, Trump, Grave, Pack, Rare (18)
      selfFogCount,
      selfFogCardKnownCount,
      selfTrumpCount,
      selfTrumpChargeCount,
      selfTrumpDriveCount,
      selfTrumpSizeSum,
      selfGraveCount,
      selfGraveTopKnown,
      selfGraveTopValue,
      selfGraveTopIsJoker,
      selfPackCount,
      selfPackOpened,
      selfPackCanViewCards,
      selfPackKnownCardCount,
      selfPackKnownValueSum,
      selfRareCount,
      selfRareCanViewCards,
      selfRareKnownCardCount,

      // 6. Opponent - Observable Information (Secret-Safe) (26)
      oppLifeKnown,
      oppLifeVisibleCount,
      oppLifeIs10Plus,
      oppHandCount,
      oppFieldCount,
      oppFieldChargeCount,
      oppFieldDriveCount,
      oppFieldFaceUpCount,
      oppFieldFaceDownCount,
      oppFieldSizeSum,
      oppFieldSizeMax,
      oppFieldAttackerCount,
      oppFieldBlockerCount,
      oppFogCount,
      oppFogCardKnownCount,
      oppTrumpCount,
      oppTrumpChargeCount,
      oppTrumpDriveCount,
      oppTrumpSizeSum,
      oppGraveCount,
      oppGraveTopKnown,
      oppGraveTopValue,
      oppGraveTopIsJoker,
      oppPackCount,
      oppPackOpened,
      oppRareCount,

      // 7. Relative State (Viewer Relative Deltas) (10)
      relativeHandCount,
      relativeFieldCount,
      relativeFieldSizeSum,
      relativeFogCount,
      relativeGraveCount,
      relativePackCount,
      relativeRareCount,
      relativeTrumpCount,
      relativeLifeKnown,
      relativeLifeCount,

      // 8. Request Context (Viewer Relative) (63)
      requestHasSource,
      requestSourceIsAction,
      requestSourceIsEffect,
      requestSourceIsZoneTop,
      requestSourceControllerIsSelf,
      requestSourceControllerIsOpponent,

      // 8.2 Action buckets (16)
      ...actionBuckets,

      // 8.3 Effect Step buckets (16)
      ...effectStepBuckets,

      // 8.4 Action Metadata (8)
      reqSpeedNormal,
      reqSpeedImmediate,
      reqSpeedOther,
      reqTimingMain,
      reqTimingQuick,
      reqTimingBlock,
      reqTimingDamageJudge,
      reqTimingOther,

      // 8.5 Source Key Cards (5)
      reqKeyCardCount,
      reqKeyCardKnownCount,
      reqKeyCardValueSum,
      reqKeyCardValueMax,
      reqKeyCardValueMin,

      // 8.6 Source Target (12)
      reqTargetIsPlayer,
      reqTargetIsUnit,
      reqTargetIsRequest,
      reqTargetIsNone,
      reqTargetIsOther,
      reqTargetIsSelf,
      reqTargetIsOpponent,
      reqTargetUnitSize,
      reqTargetUnitIsCharge,
      reqTargetUnitIsDrive,
      reqTargetUnitFaceUp,
      reqTargetUnitFaceDown,
    ];

    return values.map((v) => (Number.isFinite(v) ? v : 0));
  }

  /**
   * 合法パターン群 (Pattern Feature Vectors: 111次元) をエンコード
   */
  private static encodePatterns(request: Readonly<DecisionRequest>): DecisionPatternFeatures[] {
    const catalog = request.catalog;
    const obs = request.observation;
    const viewerId = request.playerId;

    const selfPlayer = obs.players?.find((p) => p.playerId === viewerId || p.isViewer);
    const opponentPlayer = obs.players?.find((p) => p.playerId !== viewerId && !p.isViewer);

    // 1. カード検索用マップ (合法的観測内の KNOWN カード全件)
    const allKnownCardsMap = new Map<string, KnownCardView>();
    if (selfPlayer?.handCards) {
      for (const c of selfPlayer.handCards) {
        if (c.visibility === "KNOWN") allKnownCardsMap.set(c.cardInstanceId, c);
      }
    }
    // Field / Trumps cards
    const registerUnitCards = (units?: readonly UnitView[]) => {
      if (!units) return;
      for (const u of units) {
        if (u.cards) {
          for (const c of u.cards) {
            if (c.visibility === "KNOWN") allKnownCardsMap.set(c.cardInstanceId, c);
          }
        }
      }
    };
    registerUnitCards(selfPlayer?.field);
    registerUnitCards(selfPlayer?.trumps);
    registerUnitCards(opponentPlayer?.field);
    registerUnitCards(opponentPlayer?.trumps);

    // Fog cards
    for (const p of obs.players || []) {
      if (p.fog) {
        for (const f of p.fog) {
          if (f.card && f.card.visibility === "KNOWN") {
            allKnownCardsMap.set(f.card.cardInstanceId, f.card);
          }
        }
      }
    }
    // Grave cards
    for (const p of obs.players || []) {
      if (p.graveTopCard && p.graveTopCard.visibility === "KNOWN") {
        allKnownCardsMap.set(p.graveTopCard.cardInstanceId, p.graveTopCard);
      }
      if (p.isViewer && p.grave) {
        for (const g of p.grave) {
          if ("visibility" in g && g.visibility === "KNOWN") {
            allKnownCardsMap.set(g.cardInstanceId, g as KnownCardView);
          }
        }
      }
    }
    // Pack & Rare cards
    for (const p of obs.players || []) {
      if (p.pack?.canViewCards && p.pack.cards) {
        for (const c of p.pack.cards) {
          if (c.visibility === "KNOWN") allKnownCardsMap.set(c.cardInstanceId, c);
        }
      }
      if (p.rareCards?.canViewCards && p.rareCards.cards) {
        for (const c of p.rareCards.cards) {
          if (c.visibility === "KNOWN") allKnownCardsMap.set(c.cardInstanceId, c);
        }
      }
    }
    // StageRequests KeyCards
    if (obs.stageRequests) {
      for (const reqView of obs.stageRequests) {
        if (reqView.keyCards) {
          for (const c of reqView.keyCards) {
            if (c.visibility === "KNOWN") allKnownCardsMap.set(c.cardInstanceId, c);
          }
        }
      }
    }

    // 2. ユニット検索用マップ (Self & Opponent)
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

      // 1. Pattern Kind (4)
      const isAction = p.kind === "ACTION" ? 1 : 0;
      const isPass = p.kind === "PASS" ? 1 : 0;
      const isEffect = p.kind === "EFFECT_SELECTION" ? 1 : 0;
      const isOther = !isAction && !isPass && !isEffect ? 1 : 0;

      // 2. Action Metadata (9)
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

      // 3. Candidate Action Stable Identity (16 buckets)
      let candidateActionBuckets: readonly number[] = new Array(16).fill(0);
      if (isAction && p.actionSelectionRef !== undefined && catalog?.actions) {
        const act = catalog.actions[p.actionSelectionRef];
        if (act && act.actionId) {
          candidateActionBuckets = StableIdentityEncoder.encodeActionIdentity(act.actionId);
        }
      }

      // 3. Cost Payment (6)
      let hasCost = 0;
      let costDiscardCount = 0;
      let costDrivenBulwarkCount = 0;
      let costSacrificedUnitCount = 0;
      let costLifeCount = 0;
      let costTotalItemCount = 0;

      if (p.costPaymentRef !== undefined && catalog?.costPayments) {
        const cp = catalog.costPayments[p.costPaymentRef];
        if (cp) {
          hasCost = 1;
          costDiscardCount = cp.discardedCardIds?.length ?? 0;
          costDrivenBulwarkCount = cp.drivenBulwarkUnitIds?.length ?? 0;
          costSacrificedUnitCount = cp.sacrificedUnitIds?.length ?? 0;
          costLifeCount = cp.lifeCount ?? 0;
          costTotalItemCount = costDiscardCount + costDrivenBulwarkCount + costSacrificedUnitCount + costLifeCount;
        }
      }

      // 4. Key Card Selection (11)
      let hasKeyCard = 0;
      let keyCardCount = 0;
      let keyCardKnownCount = 0;
      let keyCardValueSum = 0;
      let keyCardValueMax = 0;
      let keyCardValueMin = 0;
      let keyCardSpadeCount = 0;
      let keyCardHeartCount = 0;
      let keyCardDiamondCount = 0;
      let keyCardClubCount = 0;
      let keyCardJokerCount = 0;

      if (p.keyCardSelectionRef !== undefined && catalog?.cardSelections) {
        const cs = catalog.cardSelections[p.keyCardSelectionRef];
        const cardList: any[] = cs?.cardIds ?? (cs as any)?.cards ?? [];
        if (cs && cardList.length > 0) {
          hasKeyCard = 1;
          keyCardCount = cardList.length;

          let minVal = Infinity;
          for (const cardRef of cardList) {
            const instanceId = typeof cardRef === "string" ? cardRef : (cardRef.cardInstanceId || cardRef.id);
            const knownCard = instanceId ? allKnownCardsMap.get(instanceId) : undefined;
            if (knownCard) {
              keyCardKnownCount++;
              const val = knownCard.value ?? 0;
              keyCardValueSum += val;
              if (val > keyCardValueMax) keyCardValueMax = val;
              if (val < minVal) minVal = val;

              const suit = (knownCard.suit || "").toUpperCase();
              const rank = (knownCard.rank || "").toUpperCase();
              if (suit === "J" || suit === "JOKER" || rank === "JOKER") {
                keyCardJokerCount++;
              } else if (suit === "S" || suit === "SPADE") {
                keyCardSpadeCount++;
              } else if (suit === "H" || suit === "HEART") {
                keyCardHeartCount++;
              } else if (suit === "D" || suit === "DIAMOND") {
                keyCardDiamondCount++;
              } else if (suit === "C" || suit === "CLUB") {
                keyCardClubCount++;
              }
            }
          }
          if (minVal !== Infinity) {
            keyCardValueMin = minVal;
          }
        }
      }

      // 5. Key Unit Selection (8)
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
        const unitList: any[] = us?.unitIds ?? (us as any)?.units ?? [];
        if (us && unitList.length > 0) {
          hasKeyUnit = 1;
          keyUnitCount = unitList.length;

          for (const uRef of unitList) {
            const uId = typeof uRef === "string" ? uRef : (uRef.unitId || uRef.id);
            const entry = uId ? allUnitsMap.get(uId) : undefined;
            if (entry) {
              const u = entry.unit;
              const sz = u.currentSize ?? 0;
              selectedUnitSizeSum += sz;
              if (sz > selectedUnitSizeMax) selectedUnitSizeMax = sz;

              if (u.state === "charge") selectedUnitChargeCount++;
              else if (u.state === "drive") selectedUnitDriveCount++;

              if (u.face === "up") selectedUnitFaceUpCount++;
              else if (u.face === "down") selectedUnitFaceDownCount++;
            }
          }
        }
      }

      // 6. Target Selection (13)
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
          const k = ((ts as any).kind || ts.targetType || "").toLowerCase();
          const pKey = ts.targetPlayerKey || (ts as any).playerKey;
          const uId = ts.targetUnitId || (ts as any).unitId;

          if (k === "player") {
            targetIsPlayer = 1;
            if (pKey === viewerId) targetIsSelf = 1;
            else if (pKey) targetIsOpponent = 1;
          } else if (k === "unit") {
            targetIsUnit = 1;
            const entry = uId ? allUnitsMap.get(uId) : undefined;
            if (entry) {
              if (entry.owner === "self") targetIsSelf = 1;
              else if (entry.owner === "opponent") targetIsOpponent = 1;

              const u = entry.unit;
              targetUnitSize = u.currentSize ?? 0;
              if (u.state === "charge") targetUnitIsCharge = 1;
              else if (u.state === "drive") targetUnitIsDrive = 1;

              if (u.face === "up") targetUnitFaceUp = 1;
              else if (u.face === "down") targetUnitFaceDown = 1;
            }
          } else if (k === "request") {
            targetIsRequest = 1;
          } else if (k === "none") {
            targetIsNone = 1;
          } else {
            targetIsOther = 1;
          }
        }
      }

      // 7. Effect Selection - Base Metadata (7)
      let hasEffectSelection = 0;
      let effectTypeUnit = 0;
      let effectTypeUnitAssignment = 0;
      let effectTypeOther = 0;
      let effectSelectedValueCount = 0;
      let effectAssignmentCount = 0;
      let effectAssignedUnitTotal = 0;

      // 8. Generic Effect Selection - Unit Aggregate (12)
      let effUnitCount = 0;
      let effSelfUnitCount = 0;
      let effOppUnitCount = 0;
      let effUnitChargeCount = 0;
      let effUnitDriveCount = 0;
      let effUnitFaceUpCount = 0;
      let effUnitFaceDownCount = 0;
      let effUnitSizeSum = 0;
      let effUnitSizeMax = 0;
      let effUnitSizeMin = 0;
      let effUnitAttackerCount = 0;
      let effUnitBlockerCount = 0;

      // 9. Generic Effect Selection - Card Aggregate (17)
      const selectedKnownCards: KnownCardView[] = [];
      let effCardCount = 0;

      // 10. Generic Effect Selection - Player / Request Semantics (6)
      let effPlayerCount = 0;
      let effPlayerIsSelf = 0;
      let effPlayerIsOpponent = 0;
      let effRequestCount = 0;
      let effRequestIsSelf = 0;
      let effRequestIsOpponent = 0;

      // 11. Generic Effect Selection - Unit Assignment Semantics (13)
      let effAssignSourceCount = 0;
      let effAssignSelectedCount = 0;
      let effAssignSourceSizeSum = 0;
      let effAssignSourceSizeMax = 0;
      let effAssignSourceSizeMin = 0;
      let effAssignSelectedSizeSum = 0;
      let effAssignSelectedSizeMax = 0;
      let effAssignSelectedSizeMin = 0;
      let effAssignSizeDeltaSum = 0;
      let effAssignPositiveDeltaCount = 0;
      let effAssignNegativeDeltaCount = 0;
      let effAssignSelfToOppCount = 0;
      let effAssignOppToSelfCount = 0;

      // 10.5 Generic Effect Selection - Option Stable Identity (16 buckets)
      let effectOptionBuckets: readonly number[] = new Array(16).fill(0);

      // 12. Generic Effect Selection - Coverage Ratio (3)
      let effCandidateCount = 0;
      let effSelectedCount = 0;
      let effCoverageRatio = 0;

      if (p.effectSelectionRef !== undefined && catalog?.effectSelections) {
        const es = catalog.effectSelections[p.effectSelectionRef];
        if (es) {
          hasEffectSelection = 1;
          effCandidateCount = es.candidateCount ?? 0;

          const selType = ((es as any).kind || es.selectionType || "").toLowerCase();
          if (selType === "unit") effectTypeUnit = 1;
          else if (selType === "unit_assignment" || selType === "unitassignment" || selType === "assignment") effectTypeUnitAssignment = 1;
          else effectTypeOther = 1;

          if (selType === "option" && es.selectedValues) {
            effectOptionBuckets = StableIdentityEncoder.encodeOptionIdentities(es.selectedValues);
          }

          if (es.selectedValues) {
            effectSelectedValueCount = es.selectedValues.length;
            effSelectedCount = es.selectedValues.length;

            // ユニット選択またはカード選択の検査
            let minUnitSize = Infinity;

            for (const val of es.selectedValues) {
              // ユニットとしてマッチするか判定
              const uEntry = allUnitsMap.get(val);
              if (uEntry || selType === "unit") {
                effUnitCount++;
                if (uEntry) {
                  if (uEntry.owner === "self") effSelfUnitCount++;
                  else effOppUnitCount++;

                  const u = uEntry.unit;
                  const sz = u.currentSize ?? 0;
                  effUnitSizeSum += sz;
                  if (sz > effUnitSizeMax) effUnitSizeMax = sz;
                  if (sz < minUnitSize) minUnitSize = sz;

                  if (u.state === "charge") effUnitChargeCount++;
                  else if (u.state === "drive") effUnitDriveCount++;

                  if (u.face === "up") effUnitFaceUpCount++;
                  else if (u.face === "down") effUnitFaceDownCount++;

                  if (u.battle?.role === "attacker") effUnitAttackerCount++;
                  else if (u.battle?.role === "blocker") effUnitBlockerCount++;
                }
              }

              // カードとしてマッチするか判定
              const c = allKnownCardsMap.get(val) || (es as any).cards?.find((card: any) => card.cardInstanceId === val);
              if (c || selType === "card") {
                effCardCount++;
                if (c && c.visibility === "KNOWN") {
                  selectedKnownCards.push(c);
                }
              }

              // プレイヤーとしてマッチするか判定
              if (val === viewerId) {
                effPlayerCount++;
                effPlayerIsSelf = 1;
              } else if (obs.players?.some((pl) => pl.playerId === val)) {
                effPlayerCount++;
                effPlayerIsOpponent = 1;
              }

              // リクエストとしてマッチするか判定
              const reqMatch = obs.stageRequests?.find((sr) => sr.requestId === val);
              if (reqMatch) {
                effRequestCount++;
                if (reqMatch.controller === viewerId) effRequestIsSelf = 1;
                else effRequestIsOpponent = 1;
              }
            }

            if (minUnitSize !== Infinity) {
              effUnitSizeMin = minUnitSize;
            }
          }

          // Assignment の詳細集計
          if (es.assignments) {
            effectAssignmentCount = es.assignments.length;
            effAssignSourceCount = es.assignments.length;

            let minSourceSize = Infinity;
            let minSelectedSize = Infinity;

            for (const a of es.assignments) {
              const assignedUnits = a.selectedUnitIds || (a as any).unitIds || [];
              effectAssignedUnitTotal += assignedUnits.length;
              effAssignSelectedCount += assignedUnits.length;

              // Source ユニットのサイズ集計
              const srcEntry = allUnitsMap.get(a.sourceUnitId);
              let srcSize = 0;
              let srcOwner: "self" | "opponent" | undefined = undefined;
              if (srcEntry) {
                srcSize = srcEntry.unit.currentSize ?? 0;
                srcOwner = srcEntry.owner;
                effAssignSourceSizeSum += srcSize;
                if (srcSize > effAssignSourceSizeMax) effAssignSourceSizeMax = srcSize;
                if (srcSize < minSourceSize) minSourceSize = srcSize;
              }

              // Selected ユニット群のサイズ集計
              let targetGroupSize = 0;
              for (const uId of assignedUnits) {
                const tgtEntry = allUnitsMap.get(uId);
                if (tgtEntry) {
                  const tgtSize = tgtEntry.unit.currentSize ?? 0;
                  targetGroupSize += tgtSize;
                  effAssignSelectedSizeSum += tgtSize;
                  if (tgtSize > effAssignSelectedSizeMax) effAssignSelectedSizeMax = tgtSize;
                  if (tgtSize < minSelectedSize) minSelectedSize = tgtSize;

                  if (tgtEntry.owner === "self" && srcOwner === "opponent") {
                    effAssignOppToSelfCount++;
                  } else if (tgtEntry.owner === "opponent" && srcOwner === "self") {
                    effAssignSelfToOppCount++;
                  }
                }
              }

              // Delta 集計 (Selected - Source)
              if (assignedUnits.length > 0) {
                const delta = targetGroupSize - srcSize;
                effAssignSizeDeltaSum += delta;
                if (delta > 0) effAssignPositiveDeltaCount++;
                else if (delta < 0) effAssignNegativeDeltaCount++;
              }
            }

            if (minSourceSize !== Infinity) effAssignSourceSizeMin = minSourceSize;
            if (minSelectedSize !== Infinity) effAssignSelectedSizeMin = minSelectedSize;

            if (effSelectedCount === 0) {
              effSelectedCount = effAssignSelectedCount;
            }
          }

          if (effCandidateCount > 0) {
            effCoverageRatio = effSelectedCount / effCandidateCount;
          }
        }
      }

      // カード集計のエンコード (KnownCardAggregateEncoder を再利用)
      const effCardAggregate = selectedKnownCards.length > 0
        ? KnownCardAggregateEncoder.encode(selectedKnownCards)
        : EMPTY_KNOWN_CARD_AGGREGATE;

      const effCardKnownCount = effCardAggregate.count;
      const effCardSpadeCount = effCardAggregate.spadeCount;
      const effCardHeartCount = effCardAggregate.heartCount;
      const effCardDiamondCount = effCardAggregate.diamondCount;
      const effCardClubCount = effCardAggregate.clubCount;
      const effCardJokerCount = effCardAggregate.jokerCount;
      const effCardNumericCount = effCardAggregate.numericCount;
      const effCardAceCount = effCardAggregate.aceCount;
      const effCardJackCount = effCardAggregate.jackCount;
      const effCardQueenCount = effCardAggregate.queenCount;
      const effCardKingCount = effCardAggregate.kingCount;
      const effCardValueSum = effCardAggregate.valueSum;
      const effCardValueMax = effCardAggregate.valueMax;
      const effCardValueMin = effCardAggregate.valueMin;
      const effCardPairRankCount = effCardAggregate.pairRankCount;
      const effCardMaxRankMultiplicity = effCardAggregate.maxRankMultiplicity;

      // 13. Order Selection (2)
      let hasOrderSelection = 0;
      let orderedItemCount = 0;

      if (p.orderSelectionRef !== undefined && catalog?.orderSelections) {
        const os = catalog.orderSelections[p.orderSelectionRef];
        if (os) {
          hasOrderSelection = 1;
          const ordered = os.orderedIds || (os as any).orderedItemIds;
          if (ordered) orderedItemCount = ordered.length;
        }
      }

      const patternValues = [
        // 1. Pattern Kind (4)
        isAction,
        isPass,
        isEffect,
        isOther,

        // 2. Action Metadata (9)
        hasAction,
        speedNormal,
        speedImmediate,
        speedOther,
        timingMain,
        timingQuick,
        timingBlock,
        timingDamageJudge,
        timingOther,

        // 3. Candidate Action Stable Identity (16 buckets)
        ...candidateActionBuckets,

        // 4. Cost Payment (6)
        hasCost,
        costDiscardCount,
        costDrivenBulwarkCount,
        costSacrificedUnitCount,
        costLifeCount,
        costTotalItemCount,

        // 5. Key Card Selection (11)
        hasKeyCard,
        keyCardCount,
        keyCardKnownCount,
        keyCardValueSum,
        keyCardValueMax,
        keyCardValueMin,
        keyCardSpadeCount,
        keyCardHeartCount,
        keyCardDiamondCount,
        keyCardClubCount,
        keyCardJokerCount,

        // 6. Key Unit Selection (8)
        hasKeyUnit,
        keyUnitCount,
        selectedUnitSizeSum,
        selectedUnitSizeMax,
        selectedUnitChargeCount,
        selectedUnitDriveCount,
        selectedUnitFaceUpCount,
        selectedUnitFaceDownCount,

        // 7. Target Selection (13)
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

        // 8. Effect Selection - Base Metadata (7)
        hasEffectSelection,
        effectTypeUnit,
        effectTypeUnitAssignment,
        effectTypeOther,
        effectSelectedValueCount,
        effectAssignmentCount,
        effectAssignedUnitTotal,

        // 9. Generic Effect Selection - Unit Aggregate (12)
        effUnitCount,
        effSelfUnitCount,
        effOppUnitCount,
        effUnitChargeCount,
        effUnitDriveCount,
        effUnitFaceUpCount,
        effUnitFaceDownCount,
        effUnitSizeSum,
        effUnitSizeMax,
        effUnitSizeMin,
        effUnitAttackerCount,
        effUnitBlockerCount,

        // 10. Generic Effect Selection - Card Aggregate (17)
        effCardCount,
        effCardKnownCount,
        effCardSpadeCount,
        effCardHeartCount,
        effCardDiamondCount,
        effCardClubCount,
        effCardJokerCount,
        effCardNumericCount,
        effCardAceCount,
        effCardJackCount,
        effCardQueenCount,
        effCardKingCount,
        effCardValueSum,
        effCardValueMax,
        effCardValueMin,
        effCardPairRankCount,
        effCardMaxRankMultiplicity,

        // 11. Generic Effect Selection - Option Stable Identity (16 buckets)
        ...effectOptionBuckets,

        // 12. Generic Effect Selection - Player / Request Semantics (6)
        effPlayerCount,
        effPlayerIsSelf,
        effPlayerIsOpponent,
        effRequestCount,
        effRequestIsSelf,
        effRequestIsOpponent,

        // 13. Generic Effect Selection - Unit Assignment Semantics (13)
        effAssignSourceCount,
        effAssignSelectedCount,
        effAssignSourceSizeSum,
        effAssignSourceSizeMax,
        effAssignSourceSizeMin,
        effAssignSelectedSizeSum,
        effAssignSelectedSizeMax,
        effAssignSelectedSizeMin,
        effAssignSizeDeltaSum,
        effAssignPositiveDeltaCount,
        effAssignNegativeDeltaCount,
        effAssignSelfToOppCount,
        effAssignOppToSelfCount,

        // 14. Generic Effect Selection - Coverage Ratio (3)
        effCandidateCount,
        effSelectedCount,
        effCoverageRatio,

        // 15. Order Selection (2)
        hasOrderSelection,
        orderedItemCount,
      ];

      const sanitizedValues = patternValues.map((v) => (Number.isFinite(v) ? v : 0));
      const logicalKey = generateLogicalPatternKey(p);

      encodedPatterns.push({
        patternRef: (p as any).patternRef ?? i,
        kind: p.kind,
        logicalPatternKey: logicalKey,
        values: sanitizedValues,
      });
    }

    return encodedPatterns;
  }
}
