/**
 * CostFeatureDiagnosticEngine.ts
 *
 * BlackPoker Simulator - Gen 9 コスト支払い特徴量の識別能力診断エンジン (Work 5-5C)
 *
 * 【目的】
 * 1. Stage A: 4つのコスト支払い特徴量 (t20〜t23) の特徴量衝突率・識別能力を測定
 * 2. Stage B: 固定診断重み適用時のスコア同点率・マージン・アブレーション評価を測定
 * 3. Stage C: Policy 全体における全合法手 Argmax の変動・副作用 (PASS逃避, Counter回避等) を診断
 * 4. 識別可能グループと構造的識別不能グループ (同ランク異スート等) の厳格分離集計
 */

import { DecisionRequest } from "../../domain/decision/DecisionRequest.js";
import { DecisionResponse } from "../../domain/decision/DecisionResponse.js";
import { LegalPattern } from "../../domain/decision/LegalPattern.js";
import { DecisionCatalog, CostPayment } from "../../domain/decision/DecisionCatalog.js";
import { CardView, KnownCardView, UnitView } from "../../domain/decision/PlayerObservation.js";
import {
  Gen9LearnableTacticalPolicy,
  encodeTacticalPatternFeatures,
  createCostTacticalContext,
  TacticalCostEvaluationContext,
  TacticalPatternEncodingResult,
  TACTICAL_FEATURE_ENCODER_VERSION_CURRENT,
} from "./Gen9LearnableTacticalPolicy.js";
import { GenericTacticalEvaluator } from "../rules/GenericTacticalEvaluator.js";
import {
  classifyDecisionPatterns,
  PureCostPaymentVarianceGroup,
  ResolvedPatternInfo,
} from "./CardSelectionDiagnosticEngine.js";

// =============================================================================
// 1. 定数定義・診断重み
// =============================================================================

export const COST_FEATURE_INDICES = {
  t20_discardValue: 20,
  t21_discardJoker: 21,
  t22_sacrificeSize: 22,
  t23_lifeRatio: 23,
} as const;

export const COST_DIAGNOSTIC_WEIGHTS: readonly [number, number, number, number] = Object.freeze([
  -0.5, // t20: 廃棄カード数値
  -1.0, // t21: 廃棄Joker枚数
  -0.5, // t22: 犠牲ユニットサイズ
  -0.5, // t23: ライフ支払い割合
]);

export const COST_FEATURE_NAMES: readonly [string, string, string, string] = Object.freeze([
  "t20:discard_rank_value_sum",
  "t21:discard_joker_count",
  "t22:sacrifice_unit_size_sum",
  "t23:life_payment_ratio",
]);

export type CostFeatureCollisionReason =
  | "SAME_RANK_DIFF_SUIT" // 捨て札が同一ランクでスートのみ異なる (表現限界)
  | "SAME_RANK_VALUE_SUM" // 捨て札のランク数値合計が同一
  | "SAME_JOKER_COUNT" // 捨て札の Joker 枚数が同一
  | "SAME_SACRIFICE_SIZE" // 犠牲ユニットサイズ合計が同一
  | "SAME_LIFE_RATIO" // ライフ支払い割合が同一
  | "BULWARK_DRIVE_DIFF_ONLY" // 防壁ドライブ対象のみ異なる (表現限界)
  | "ALL_COSTS_ZERO" // コストなし同士
  | "COMPLEX_MATCH" // 複数要素の組み合わせが偶然同一
  | "INVALID_OR_HIDDEN" // 非公開情報または不正参照
  | "UNKNOWN";

// =============================================================================
// 2. データ構造・型定義
// =============================================================================

export interface EvaluatedCostCandidate {
  readonly patternRef: number;
  readonly patternId: string;
  readonly costPaymentRef?: number;
  readonly costPayment?: CostPayment;
  readonly costSignature: string;
  readonly features: readonly [number, number, number, number]; // [t20, t21, t22, t23]
  readonly zeroScore: number;
  readonly diagScore: number;
  readonly ablationScores: {
    readonly t20_only: number;
    readonly t21_only: number;
    readonly t22_only: number;
    readonly t23_only: number;
  };
  readonly costTacticalDelta: number; // diagScore - zeroScore
  readonly expectedDelta: number; // Σ (features * DIAGNOSTIC_WEIGHTS)
  readonly isMathConsistent: boolean;
}

export interface CandidatePairCostComparison {
  readonly refA: number;
  readonly refB: number;
  readonly isFeatureColliding: boolean;
  readonly differingFeatures: readonly number[]; // 異なる特徴量のインデックス (20..23)
  readonly isZeroScoreTied: boolean;
  readonly isDiagScoreTied: boolean;
  readonly diagScoreMargin: number;
  readonly collisionReason?: CostFeatureCollisionReason;
}

export interface GroupCostDiagnostic {
  readonly groupId: string;
  readonly actionId: string;
  readonly candidateCount: number;
  readonly candidates: readonly EvaluatedCostCandidate[];
  readonly pairComparisons: readonly CandidatePairCostComparison[];
  // Stage A: 特徴量衝突判定
  readonly isFeatureDistinguishable: boolean; // 少なくとも1ペアで特徴量が異なる
  readonly isCompleteFeatureColliding: boolean; // 全候補の特徴量が完全一致
  readonly hasPartialFeatureCollision: boolean; // 一部のみ衝突
  readonly featureCollidingPairCount: number;
  readonly totalPairCount: number;
  readonly collisionReasons: readonly CostFeatureCollisionReason[];
  // Stage B: スコア同点判定 (Policy C: 診断非ゼロ重み)
  readonly isAllScoreTied: boolean;
  readonly isTopScoreTied: boolean;
  readonly topTieCount: number;
  readonly bestPatternRef: number;
  readonly secondBestPatternRef?: number;
  readonly bestScore: number;
  readonly secondBestScore?: number;
  readonly scoreMargin: number; // best - secondBest
  readonly scoreRange: number; // max - min
  // アブレーションごとの最高スコア同点判定
  readonly ablationTopTied: {
    readonly t20_only: boolean;
    readonly t21_only: boolean;
    readonly t22_only: boolean;
    readonly t23_only: boolean;
  };
}

export type ArgmaxChangeCategory =
  | "UNCHANGED" // 最善手変化なし
  | "COST_ONLY_CHANGED" // アクション・キーカード同一でコスト支払い方法のみ変更
  | "ACTION_CHANGED" // アクション種別またはキーカードが変更
  | "CHANGED_TO_PASS" // 他のアクションから PASS へ逃避
  | "CHANGED_FROM_PASS" // PASS から他のアクションへ変更
  | "COUNTER_TO_PASS" // Counter から PASS への重要危険局面
  | "SUMMON_TO_PASS" // 召喚から PASS への変更
  | "OTHER";

export interface DecisionArgmaxSideEffect {
  readonly decisionId: string;
  readonly zeroBestPatternRef: number;
  readonly diagBestPatternRef: number;
  readonly zeroActionId?: string;
  readonly diagActionId?: string;
  readonly zeroKind: string;
  readonly diagKind: string;
  readonly isArgmaxChanged: boolean;
  readonly category: ArgmaxChangeCategory;
  readonly note?: string;
}

export interface SingleDecisionCostDiagnosticResult {
  readonly decisionId: string;
  readonly groups: readonly GroupCostDiagnostic[];
  readonly argmaxEffect: DecisionArgmaxSideEffect;
  readonly invalidReferences: {
    readonly cardIds: readonly string[];
    readonly unitIds: readonly string[];
    readonly costRefs: readonly number[];
  };
}

// =============================================================================
// 3. 診断コア関数 (純粋関数)
// =============================================================================

/**
 * 2つのコスト支払い候補間の衝突原因を分類
 */
export function classifyCostPairCollisionReason(
  candA: EvaluatedCostCandidate,
  candB: EvaluatedCostCandidate,
  request: Readonly<DecisionRequest>
): CostFeatureCollisionReason {
  const featA = candA.features;
  const featB = candB.features;

  // 特徴量が異なっていれば衝突ではない
  if (
    Math.abs(featA[0] - featB[0]) > 1e-12 ||
    Math.abs(featA[1] - featB[1]) > 1e-12 ||
    Math.abs(featA[2] - featB[2]) > 1e-12 ||
    Math.abs(featA[3] - featB[3]) > 1e-12
  ) {
    return "UNKNOWN";
  }

  const cpA = candA.costPayment;
  const cpB = candB.costPayment;

  if (!cpA || !cpB) {
    return "ALL_COSTS_ZERO";
  }

  // 1. 捨て札がある場合の判定
  const cardsA = cpA.discardedCardIds ?? [];
  const cardsB = cpB.discardedCardIds ?? [];

  if (cardsA.length > 0 && cardsB.length > 0 && cardsA.length === cardsB.length) {
    // 観測情報からカード情報を解決
    const pView = request.observation.players.find((p) => p.playerId === request.playerId);
    const handCards = pView?.handCards ?? [];
    const getCard = (id: string) =>
      handCards.find((c): c is KnownCardView => c.visibility === "KNOWN" && (c as KnownCardView).cardInstanceId === id);

    const cA = cardsA.map(getCard).filter((c): c is KnownCardView => c !== undefined && c.visibility === "KNOWN");
    const cB = cardsB.map(getCard).filter((c): c is KnownCardView => c !== undefined && c.visibility === "KNOWN");

    if (cA.length === cardsA.length && cB.length === cardsB.length) {
      const ranksA = [...cA.map((c) => c.rank)].sort();
      const ranksB = [...cB.map((c) => c.rank)].sort();
      const suitsA = [...cA.map((c) => c.suit)].sort();
      const suitsB = [...cB.map((c) => c.suit)].sort();

      // ランク一致でスート不一致
      if (
        ranksA.join(",") === ranksB.join(",") &&
        suitsA.join(",") !== suitsB.join(",")
      ) {
        return "SAME_RANK_DIFF_SUIT";
      }

      // 数値合計一致
      const valSumA = cA.reduce((sum, c) => sum + (c.value ?? 0), 0);
      const valSumB = cB.reduce((sum, c) => sum + (c.value ?? 0), 0);
      if (valSumA === valSumB && ranksA.join(",") !== ranksB.join(",")) {
        return "SAME_RANK_VALUE_SUM";
      }
    }
  }

  // 2. 防壁ドライブ対象のみ異なる場合
  const bulwarksA = cpA.drivenBulwarkUnitIds ?? [];
  const bulwarksB = cpB.drivenBulwarkUnitIds ?? [];
  if (
    bulwarksA.length > 0 &&
    bulwarksB.length > 0 &&
    cardsA.length === cardsB.length &&
    cpA.lifeCount === cpB.lifeCount &&
    (cpA.sacrificedUnitIds ?? []).length === (cpB.sacrificedUnitIds ?? []).length
  ) {
    if ([...bulwarksA].sort().join(",") !== [...bulwarksB].sort().join(",")) {
      return "BULWARK_DRIVE_DIFF_ONLY";
    }
  }

  // 3. 犠牲ユニットサイズが同一
  const sacsA = cpA.sacrificedUnitIds ?? [];
  const sacsB = cpB.sacrificedUnitIds ?? [];
  if (sacsA.length > 0 && sacsB.length > 0 && [...sacsA].sort().join(",") !== [...sacsB].sort().join(",")) {
    return "SAME_SACRIFICE_SIZE";
  }

  // 4. ライフ支払い枚数が同一
  if (cpA.lifeCount > 0 && cpA.lifeCount === cpB.lifeCount) {
    return "SAME_LIFE_RATIO";
  }

  // 5. コストがゼロ同士
  if (
    cardsA.length === 0 &&
    cardsB.length === 0 &&
    bulwarksA.length === 0 &&
    bulwarksB.length === 0 &&
    sacsA.length === 0 &&
    sacsB.length === 0 &&
    cpA.lifeCount === 0 &&
    cpB.lifeCount === 0
  ) {
    return "ALL_COSTS_ZERO";
  }

  return "COMPLEX_MATCH";
}

/**
 * 単一の DecisionRequest を診断し、コスト差分グループおよび Argmax 変化を分析
 */
export function diagnoseDecisionCostFeatures(
  request: Readonly<DecisionRequest>,
  evaluator: GenericTacticalEvaluator,
  policyZero: Gen9LearnableTacticalPolicy,
  policyDiag: Gen9LearnableTacticalPolicy,
  ablationPolicies: {
    t20: Gen9LearnableTacticalPolicy;
    t21: Gen9LearnableTacticalPolicy;
    t22: Gen9LearnableTacticalPolicy;
    t23: Gen9LearnableTacticalPolicy;
  }
): SingleDecisionCostDiagnosticResult {
  const { pureCostGroups } = classifyDecisionPatterns(request);
  const costCtx = createCostTacticalContext(request);

  // 全パターンの評価結果を取得
  const zeroEval = policyZero.evaluatePatterns(request);
  const diagEval = policyDiag.evaluatePatterns(request);
  const ablEval20 = ablationPolicies.t20.evaluatePatterns(request);
  const ablEval21 = ablationPolicies.t21.evaluatePatterns(request);
  const ablEval22 = ablationPolicies.t22.evaluatePatterns(request);
  const ablEval23 = ablationPolicies.t23.evaluatePatterns(request);

  const zeroScoresMap = new Map(zeroEval.scoredPatterns.map((p) => [p.patternRef, p.finalScore]));
  const diagScoresMap = new Map(diagEval.scoredPatterns.map((p) => [p.patternRef, p.finalScore]));
  const abl20Map = new Map(ablEval20.scoredPatterns.map((p) => [p.patternRef, p.finalScore]));
  const abl21Map = new Map(ablEval21.scoredPatterns.map((p) => [p.patternRef, p.finalScore]));
  const abl22Map = new Map(ablEval22.scoredPatterns.map((p) => [p.patternRef, p.finalScore]));
  const abl23Map = new Map(ablEval23.scoredPatterns.map((p) => [p.patternRef, p.finalScore]));

  const catalog = request.catalog;
  const diagnosedGroups: GroupCostDiagnostic[] = [];

  for (const group of pureCostGroups) {
    const evaluatedCandidates: EvaluatedCostCandidate[] = [];

    for (const pRef of group.patternRefs) {
      const pat = request.patterns[pRef];
      const costPayment =
        pat.costPaymentRef !== undefined ? catalog.costPayments?.[pat.costPaymentRef] : undefined;

      const enc = encodeTacticalPatternFeatures(
        request,
        pat,
        evaluator,
        TACTICAL_FEATURE_ENCODER_VERSION_CURRENT,
        undefined,
        undefined,
        costCtx
      );

      const f20 = enc.features[20] ?? 0;
      const f21 = enc.features[21] ?? 0;
      const f22 = enc.features[22] ?? 0;
      const f23 = enc.features[23] ?? 0;

      const zScore = zeroScoresMap.get(pRef) ?? 0;
      const dScore = diagScoresMap.get(pRef) ?? 0;

      const costTacticalDelta = dScore - zScore;
      const expectedDelta =
        f20 * COST_DIAGNOSTIC_WEIGHTS[0] +
        f21 * COST_DIAGNOSTIC_WEIGHTS[1] +
        f22 * COST_DIAGNOSTIC_WEIGHTS[2] +
        f23 * COST_DIAGNOSTIC_WEIGHTS[3];

      const isMathConsistent = Math.abs(costTacticalDelta - expectedDelta) <= 1e-12;

      // コスト署名作成
      const costSig = costPayment
        ? `disc:[${(costPayment.discardedCardIds ?? []).join(",")}]|drive:[${(costPayment.drivenBulwarkUnitIds ?? []).join(",")}]|sac:[${(costPayment.sacrificedUnitIds ?? []).join(",")}]|life:${costPayment.lifeCount}`
        : "NONE";

      evaluatedCandidates.push({
        patternRef: pRef,
        patternId: pat.patternId,
        costPaymentRef: pat.costPaymentRef,
        costPayment,
        costSignature: costSig,
        features: [f20, f21, f22, f23],
        zeroScore: zScore,
        diagScore: dScore,
        ablationScores: {
          t20_only: abl20Map.get(pRef) ?? 0,
          t21_only: abl21Map.get(pRef) ?? 0,
          t22_only: abl22Map.get(pRef) ?? 0,
          t23_only: abl23Map.get(pRef) ?? 0,
        },
        costTacticalDelta,
        expectedDelta,
        isMathConsistent,
      });
    }

    // ペア単位の比較
    const pairComparisons: CandidatePairCostComparison[] = [];
    const collisionReasons: CostFeatureCollisionReason[] = [];

    for (let i = 0; i < evaluatedCandidates.length; i++) {
      for (let j = i + 1; j < evaluatedCandidates.length; j++) {
        const cA = evaluatedCandidates[i];
        const cB = evaluatedCandidates[j];

        const diffIndices: number[] = [];
        for (let idx = 0; idx < 4; idx++) {
          if (Math.abs(cA.features[idx] - cB.features[idx]) > 1e-12) {
            diffIndices.push(20 + idx);
          }
        }

        const isFeatureColliding = diffIndices.length === 0;
        const isZeroScoreTied = Math.abs(cA.zeroScore - cB.zeroScore) <= 1e-12;
        const isDiagScoreTied = Math.abs(cA.diagScore - cB.diagScore) <= 1e-12;
        const diagScoreMargin = Math.abs(cA.diagScore - cB.diagScore);

        let collisionReason: CostFeatureCollisionReason | undefined;
        if (isFeatureColliding) {
          collisionReason = classifyCostPairCollisionReason(cA, cB, request);
          collisionReasons.push(collisionReason);
        }

        pairComparisons.push({
          refA: cA.patternRef,
          refB: cB.patternRef,
          isFeatureColliding,
          differingFeatures: diffIndices,
          isZeroScoreTied,
          isDiagScoreTied,
          diagScoreMargin,
          collisionReason,
        });
      }
    }

    // グループ集計値の算出
    const collidingPairsCount = pairComparisons.filter((p) => p.isFeatureColliding).length;
    const totalPairsCount = pairComparisons.length;
    const isCompleteFeatureColliding = collidingPairsCount === totalPairsCount;
    const isFeatureDistinguishable = collidingPairsCount < totalPairsCount;
    const hasPartialFeatureCollision = collidingPairsCount > 0 && collidingPairsCount < totalPairsCount;

    // スコアソート (降順)
    const sortedByDiag = [...evaluatedCandidates].sort((a, b) => {
      if (b.diagScore !== a.diagScore) return b.diagScore - a.diagScore;
      return a.patternRef - b.patternRef; // 最小 patternRef 優先
    });

    const bestCand = sortedByDiag[0];
    const secondCand = sortedByDiag.length > 1 ? sortedByDiag[1] : undefined;
    const worstCand = sortedByDiag[sortedByDiag.length - 1];

    const bestScore = bestCand.diagScore;
    const secondBestScore = secondCand?.diagScore;
    const scoreMargin = secondCand ? bestScore - secondCand.diagScore : 0;
    const scoreRange = bestScore - worstCand.diagScore;

    const isAllScoreTied = scoreRange <= 1e-12;
    const isTopScoreTied = secondCand ? Math.abs(bestScore - secondCand.diagScore) <= 1e-12 : false;
    const topTieCount = sortedByDiag.filter((c) => Math.abs(c.diagScore - bestScore) <= 1e-12).length;

    // アブレーションごとの topTie 判定
    const checkAblTopTie = (key: keyof EvaluatedCostCandidate["ablationScores"]): boolean => {
      if (evaluatedCandidates.length < 2) return false;
      const sorted = [...evaluatedCandidates].sort((a, b) => b.ablationScores[key] - a.ablationScores[key]);
      return Math.abs(sorted[0].ablationScores[key] - sorted[1].ablationScores[key]) <= 1e-12;
    };

    diagnosedGroups.push({
      groupId: group.groupId,
      actionId: group.actionId,
      candidateCount: group.candidateCount,
      candidates: evaluatedCandidates,
      pairComparisons,
      isFeatureDistinguishable,
      isCompleteFeatureColliding,
      hasPartialFeatureCollision,
      featureCollidingPairCount: collidingPairsCount,
      totalPairCount: totalPairsCount,
      collisionReasons,
      isAllScoreTied,
      isTopScoreTied,
      topTieCount,
      bestPatternRef: bestCand.patternRef,
      secondBestPatternRef: secondCand?.patternRef,
      bestScore,
      secondBestScore,
      scoreMargin,
      scoreRange,
      ablationTopTied: {
        t20_only: checkAblTopTie("t20_only"),
        t21_only: checkAblTopTie("t21_only"),
        t22_only: checkAblTopTie("t22_only"),
        t23_only: checkAblTopTie("t23_only"),
      },
    });
  }

  // Stage C: 全合法手 Argmax の変動分析
  const zeroBestRef = zeroEval.bestPatternRef;
  const diagBestRef = diagEval.bestPatternRef;
  const isArgmaxChanged = zeroBestRef !== diagBestRef;

  const patZero = request.patterns[zeroBestRef];
  const patDiag = request.patterns[diagBestRef];

  const zeroActionId =
    patZero?.kind === "ACTION" && patZero.actionSelectionRef !== undefined
      ? catalog.actions[patZero.actionSelectionRef]?.actionId
      : undefined;
  const diagActionId =
    patDiag?.kind === "ACTION" && patDiag.actionSelectionRef !== undefined
      ? catalog.actions[patDiag.actionSelectionRef]?.actionId
      : undefined;

  let category: ArgmaxChangeCategory = "UNCHANGED";
  let note: string | undefined;

  if (isArgmaxChanged) {
    if (patZero?.kind === "ACTION" && patDiag?.kind === "PASS") {
      if (zeroActionId?.includes("counter") || zeroActionId?.includes("Counter")) {
        category = "COUNTER_TO_PASS";
        note = `Counter (${zeroActionId}) 回避 -> PASS へ逃避`;
      } else if (zeroActionId?.includes("summon") || zeroActionId?.includes("Summon")) {
        category = "SUMMON_TO_PASS";
        note = `召喚 (${zeroActionId}) 回避 -> PASS へ逃避`;
      } else {
        category = "CHANGED_TO_PASS";
        note = `${zeroActionId ?? patZero.kind} -> PASS へ逃避`;
      }
    } else if (patZero?.kind === "PASS" && patDiag?.kind !== "PASS") {
      category = "CHANGED_FROM_PASS";
      note = `PASS -> ${diagActionId ?? patDiag.kind} へ変更`;
    } else if (
      patZero?.kind === "ACTION" &&
      patDiag?.kind === "ACTION" &&
      patZero.actionSelectionRef === patDiag.actionSelectionRef &&
      patZero.keyCardSelectionRef === patDiag.keyCardSelectionRef &&
      patZero.keyUnitSelectionRef === patDiag.keyUnitSelectionRef &&
      patZero.costPaymentRef !== patDiag.costPaymentRef
    ) {
      category = "COST_ONLY_CHANGED";
      note = `アクション ${zeroActionId} は同一でコスト支払い方法のみ変更 (ref ${patZero.costPaymentRef} -> ${patDiag.costPaymentRef})`;
    } else {
      category = "ACTION_CHANGED";
      note = `${zeroActionId ?? patZero.kind} -> ${diagActionId ?? patDiag.kind} へ変更`;
    }
  }

  const argmaxEffect: DecisionArgmaxSideEffect = {
    decisionId: request.decisionId,
    zeroBestPatternRef: zeroBestRef,
    diagBestPatternRef: diagBestRef,
    zeroActionId,
    diagActionId,
    zeroKind: patZero?.kind ?? "UNKNOWN",
    diagKind: patDiag?.kind ?? "UNKNOWN",
    isArgmaxChanged,
    category,
    note,
  };

  return {
    decisionId: request.decisionId,
    groups: diagnosedGroups,
    argmaxEffect,
    invalidReferences: {
      cardIds: [...costCtx.invalidCardReferenceIds],
      unitIds: [...costCtx.invalidUnitReferenceIds],
      costRefs: [...costCtx.invalidCostPaymentRefs],
    },
  };
}

// =============================================================================
// 4. 全体集計データ構造と集計関数
// =============================================================================

export interface CostDiagnosticAggregateSummary {
  readonly totalMatches: number;
  readonly totalDecisionsCollected: number;
  readonly decisionsWithCostGroups: number;
  readonly totalCostGroups: number;
  readonly totalCandidates: number;
  readonly totalPairs: number;

  // Stage A: 特徴量衝突率集計
  readonly stageA: {
    readonly completeCollisionGroupCount: number;
    readonly completeCollisionGroupRate: number; // 完全衝突グループ率
    readonly distinguishableGroupCount: number;
    readonly distinguishableGroupRate: number; // 識別可能グループ率
    readonly collidingPairCount: number;
    readonly pairCollisionRate: number; // 候補ペア衝突率
    readonly featureDifferentiatingCounts: {
      readonly t20_discardValue: number;
      readonly t21_discardJoker: number;
      readonly t22_sacrificeSize: number;
      readonly t23_lifeRatio: number;
    };
    readonly collisionReasonCounts: Record<CostFeatureCollisionReason, number>;
  };

  // Stage B: スコア同点率集計
  readonly stageB: {
    readonly allGroups: {
      readonly allTiedCount: number;
      readonly allTiedRate: number;
      readonly topTiedCount: number;
      readonly topTiedRate: number;
      readonly averageMargin: number;
      readonly medianMargin: number;
    };
    readonly distinguishableGroups: {
      readonly groupCount: number;
      readonly allTiedCount: number;
      readonly allTiedRate: number;
      readonly topTiedCount: number;
      readonly topTiedRate: number;
      readonly averageMargin: number;
    };
    readonly structuralIndistinguishableGroups: {
      readonly groupCount: number;
      readonly allTiedRate: number; // 常に 100%
      readonly topTiedRate: number; // 常に 100%
    };
    readonly ablationTopTiedCounts: {
      readonly t20_only: number;
      readonly t21_only: number;
      readonly t22_only: number;
      readonly t23_only: number;
      readonly all_four: number;
    };
    readonly mathConsistencyViolations: number;
  };

  // Stage C: Argmax Side Effect 集計
  readonly stageC: {
    readonly totalDecisions: number;
    readonly argmaxChangedCount: number;
    readonly argmaxChangedRate: number;
    readonly breakdownByCategory: Record<ArgmaxChangeCategory, number>;
    readonly counterToPassDecisions: readonly DecisionArgmaxSideEffect[];
    readonly summonToPassDecisions: readonly DecisionArgmaxSideEffect[];
  };

  // 不正ID診断
  readonly invalidReferences: {
    readonly invalidCardIdCount: number;
    readonly invalidUnitIdCount: number;
    readonly invalidCostRefCount: number;
  };
}

export function aggregateCostDiagnosticResults(
  results: readonly SingleDecisionCostDiagnosticResult[],
  totalMatches: number,
  totalDecisionsCollected: number
): CostDiagnosticAggregateSummary {
  let decisionsWithCostGroups = 0;
  let totalCostGroups = 0;
  let totalCandidates = 0;
  let totalPairs = 0;

  let completeCollisionGroupCount = 0;
  let distinguishableGroupCount = 0;
  let collidingPairCount = 0;

  const diffCounts = {
    t20_discardValue: 0,
    t21_discardJoker: 0,
    t22_sacrificeSize: 0,
    t23_lifeRatio: 0,
  };

  const reasonCounts: Record<CostFeatureCollisionReason, number> = {
    SAME_RANK_DIFF_SUIT: 0,
    SAME_RANK_VALUE_SUM: 0,
    SAME_JOKER_COUNT: 0,
    SAME_SACRIFICE_SIZE: 0,
    SAME_LIFE_RATIO: 0,
    BULWARK_DRIVE_DIFF_ONLY: 0,
    ALL_COSTS_ZERO: 0,
    COMPLEX_MATCH: 0,
    INVALID_OR_HIDDEN: 0,
    UNKNOWN: 0,
  };

  // Stage B
  let allTiedCount = 0;
  let topTiedCount = 0;
  const margins: number[] = [];

  let distAllTiedCount = 0;
  let distTopTiedCount = 0;
  const distMargins: number[] = [];

  const ablTopCounts = {
    t20_only: 0,
    t21_only: 0,
    t22_only: 0,
    t23_only: 0,
    all_four: 0,
  };

  let mathViolations = 0;

  // Stage C
  let argmaxChangedCount = 0;
  const categoryBreakdown: Record<ArgmaxChangeCategory, number> = {
    UNCHANGED: 0,
    COST_ONLY_CHANGED: 0,
    ACTION_CHANGED: 0,
    CHANGED_TO_PASS: 0,
    CHANGED_FROM_PASS: 0,
    COUNTER_TO_PASS: 0,
    SUMMON_TO_PASS: 0,
    OTHER: 0,
  };

  const counterToPassList: DecisionArgmaxSideEffect[] = [];
  const summonToPassList: DecisionArgmaxSideEffect[] = [];

  let invalidCards = 0;
  let invalidUnits = 0;
  let invalidCosts = 0;

  for (const res of results) {
    if (res.groups.length > 0) {
      decisionsWithCostGroups++;
    }

    // 不正ID
    invalidCards += res.invalidReferences.cardIds.length;
    invalidUnits += res.invalidReferences.unitIds.length;
    invalidCosts += res.invalidReferences.costRefs.length;

    // Stage C
    if (res.argmaxEffect.isArgmaxChanged) {
      argmaxChangedCount++;
    }
    categoryBreakdown[res.argmaxEffect.category]++;

    if (res.argmaxEffect.category === "COUNTER_TO_PASS") {
      counterToPassList.push(res.argmaxEffect);
    }
    if (res.argmaxEffect.category === "SUMMON_TO_PASS") {
      summonToPassList.push(res.argmaxEffect);
    }

    // Groups
    for (const g of res.groups) {
      totalCostGroups++;
      totalCandidates += g.candidateCount;
      totalPairs += g.totalPairCount;

      if (g.isCompleteFeatureColliding) {
        completeCollisionGroupCount++;
      }
      if (g.isFeatureDistinguishable) {
        distinguishableGroupCount++;
      }
      collidingPairCount += g.featureCollidingPairCount;

      // 衝突理由
      for (const r of g.collisionReasons) {
        reasonCounts[r]++;
      }

      // 差分特徴量
      for (const p of g.pairComparisons) {
        for (const idx of p.differingFeatures) {
          if (idx === 20) diffCounts.t20_discardValue++;
          if (idx === 21) diffCounts.t21_discardJoker++;
          if (idx === 22) diffCounts.t22_sacrificeSize++;
          if (idx === 23) diffCounts.t23_lifeRatio++;
        }
      }

      // 数理整合性
      for (const c of g.candidates) {
        if (!c.isMathConsistent) mathViolations++;
      }

      // Stage B
      if (g.isAllScoreTied) allTiedCount++;
      if (g.isTopScoreTied) topTiedCount++;
      margins.push(g.scoreMargin);

      if (g.isFeatureDistinguishable) {
        if (g.isAllScoreTied) distAllTiedCount++;
        if (g.isTopScoreTied) distTopTiedCount++;
        distMargins.push(g.scoreMargin);
      }

      if (g.ablationTopTied.t20_only) ablTopCounts.t20_only++;
      if (g.ablationTopTied.t21_only) ablTopCounts.t21_only++;
      if (g.ablationTopTied.t22_only) ablTopCounts.t22_only++;
      if (g.ablationTopTied.t23_only) ablTopCounts.t23_only++;
      if (g.isTopScoreTied) ablTopCounts.all_four++;
    }
  }

  margins.sort((a, b) => a - b);
  const avgMargin = margins.length > 0 ? margins.reduce((a, b) => a + b, 0) / margins.length : 0;
  const medMargin = margins.length > 0 ? margins[Math.floor(margins.length / 2)] : 0;

  const avgDistMargin =
    distMargins.length > 0 ? distMargins.reduce((a, b) => a + b, 0) / distMargins.length : 0;

  const structIndistCount = totalCostGroups - distinguishableGroupCount;

  return {
    totalMatches,
    totalDecisionsCollected,
    decisionsWithCostGroups,
    totalCostGroups,
    totalCandidates,
    totalPairs,
    stageA: {
      completeCollisionGroupCount,
      completeCollisionGroupRate: totalCostGroups > 0 ? completeCollisionGroupCount / totalCostGroups : 0,
      distinguishableGroupCount,
      distinguishableGroupRate: totalCostGroups > 0 ? distinguishableGroupCount / totalCostGroups : 0,
      collidingPairCount,
      pairCollisionRate: totalPairs > 0 ? collidingPairCount / totalPairs : 0,
      featureDifferentiatingCounts: diffCounts,
      collisionReasonCounts: reasonCounts,
    },
    stageB: {
      allGroups: {
        allTiedCount,
        allTiedRate: totalCostGroups > 0 ? allTiedCount / totalCostGroups : 0,
        topTiedCount,
        topTiedRate: totalCostGroups > 0 ? topTiedCount / totalCostGroups : 0,
        averageMargin: avgMargin,
        medianMargin: medMargin,
      },
      distinguishableGroups: {
        groupCount: distinguishableGroupCount,
        allTiedCount: distAllTiedCount,
        allTiedRate: distinguishableGroupCount > 0 ? distAllTiedCount / distinguishableGroupCount : 0,
        topTiedCount: distTopTiedCount,
        topTiedRate: distinguishableGroupCount > 0 ? distTopTiedCount / distinguishableGroupCount : 0,
        averageMargin: avgDistMargin,
      },
      structuralIndistinguishableGroups: {
        groupCount: structIndistCount,
        allTiedRate: 1.0,
        topTiedRate: 1.0,
      },
      ablationTopTiedCounts: ablTopCounts,
      mathConsistencyViolations: mathViolations,
    },
    stageC: {
      totalDecisions: results.length,
      argmaxChangedCount,
      argmaxChangedRate: results.length > 0 ? argmaxChangedCount / results.length : 0,
      breakdownByCategory: categoryBreakdown,
      counterToPassDecisions: counterToPassList,
      summonToPassDecisions: summonToPassList,
    },
    invalidReferences: {
      invalidCardIdCount: invalidCards,
      invalidUnitIdCount: invalidUnits,
      invalidCostRefCount: invalidCosts,
    },
  };
}
