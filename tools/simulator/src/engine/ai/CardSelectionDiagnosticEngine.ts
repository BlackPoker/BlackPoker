/**
 * CardSelectionDiagnosticEngine.ts
 *
 * BlackPoker Simulator - Gen 9 カード選択品質・特徴量識別能力診断エンジン (Work 5-4C)
 *
 * 【目的】
 * 1. 同一 DecisionRequest 内における合法手 (LegalPattern) を精密に分類:
 *    - 純粋キーカード選択差分 (Pure Key Card Variance): アクション・対象・コスト・効果が同一でキーカードのみ異なる
 *    - 純粋コスト支払い差分 (Pure Cost Payment Variance): アクション・キーカード・対象が同一でコスト支払いのみ異なる
 *    - 複合選択差分 (Compound Variance): キーカードとコストが同時に異なる等
 * 2. 各 Policy (Gen 8, Gen 9 R4, G0 IND7, G3 IND3) における特徴量衝突率・スコア同点率・列挙順依存率 (タイブレーク率) の計測
 * 3. 兵士召喚 (action.summonSoldier)、Counter系アクション、コスト支払い方法の識別能力の定量的診断
 * 4. 非公開情報 (相手手札、未開封パック等) を一切参照しない情報公開境界の厳格遵守
 */

import { DecisionRequest } from "../../domain/decision/DecisionRequest.js";
import { DecisionResponse } from "../../domain/decision/DecisionResponse.js";
import { LegalPattern } from "../../domain/decision/LegalPattern.js";
import { DecisionCatalog, CostPayment } from "../../domain/decision/DecisionCatalog.js";
import { KnownCardView, CardView } from "../../domain/decision/PlayerObservation.js";
import { DecisionPolicy, PolicyDescriptor } from "../simulation/DecisionPolicy.js";
import {
  Gen9LearnableTacticalPolicy,
  LearnableTacticalEvaluationResult,
} from "./Gen9LearnableTacticalPolicy.js";
import { Gen9TacticalPrototypePolicy } from "./Gen9TacticalPrototypePolicy.js";
import { GenomePolicy } from "./GenomePolicy.js";
import { DecisionFeatureEncoder } from "./DecisionFeatureEncoder.js";
import { GenomeScorer } from "./GenomeScorer.js";
import {
  CONTEXT_FEATURE_NAMES,
  PATTERN_FEATURE_NAMES,
} from "../../domain/ai/DecisionFeatureTypes.js";

// =============================================================================
// 1. データ構造・インターフェース
// =============================================================================

export interface ObservedMatchDecision {
  readonly observationId: string;
  readonly matchSeed: number;
  readonly matchLeg: "FORWARD" | "REVERSE";
  readonly decisionOrdinal: number;
  readonly actingPlayerId: string;
  readonly policyName: string;
  readonly request: Readonly<DecisionRequest>;
  readonly response: Readonly<DecisionResponse>;
}

export type ChoiceOrigin = "ACTUAL_MATCH_CHOICE" | "SHADOW_POLICY_CHOICE";

export interface ResolvedPatternInfo {
  readonly patternRef: number;
  readonly patternId: string;
  readonly kind: string;
  readonly actionId?: string;
  readonly actionName?: string;
  readonly keyCardIds: readonly string[];
  readonly keyCardDisplayCodes: readonly string[];
  readonly keyUnitIds: readonly string[];
  readonly costPayment: {
    readonly discardedCardIds: readonly string[];
    readonly drivenBulwarkUnitIds: readonly string[];
    readonly sacrificedUnitIds: readonly string[];
    readonly lifeCount: number;
    readonly summary?: string;
  };
  readonly targetSignature: string;
  readonly effectSignature: string;
  readonly orderSignature: string;
  readonly keyUnitSignature: string;
  readonly keyCardSignature: string;
  readonly costSignature: string;
  readonly conditionSignatureWithoutKeyCard: string;
  readonly conditionSignatureWithoutCost: string;
}

export interface PureKeyCardVarianceGroup {
  readonly groupId: string;
  readonly actionId: string;
  readonly costSignature: string;
  readonly targetSignature: string;
  readonly effectSignature: string;
  readonly orderSignature: string;
  readonly keyUnitSignature: string;
  readonly patternRefs: readonly number[];
  readonly candidateCount: number;
}

export interface PureCostPaymentVarianceGroup {
  readonly groupId: string;
  readonly actionId: string;
  readonly keyCardSignature: string;
  readonly targetSignature: string;
  readonly effectSignature: string;
  readonly orderSignature: string;
  readonly keyUnitSignature: string;
  readonly patternRefs: readonly number[];
  readonly candidateCount: number;
}

export interface EvaluatedCandidateScore {
  readonly patternRef: number;
  readonly baseScore: number;
  readonly tacticalAdjustment: number;
  readonly finalScore: number;
  readonly tacticalFeatures?: readonly number[];
  readonly baseFeatures?: readonly number[];
}

export interface CandidatePairFeatureComparison {
  readonly candidateRefA: number;
  readonly candidateRefB: number;
  readonly baseEqual?: boolean; // undefined = NOT_AVAILABLE
  readonly tacticalEqual?: boolean; // undefined = NOT_AVAILABLE
  readonly completeEqual?: boolean; // undefined = NOT_AVAILABLE
}

export interface TieAnalysisResult {
  readonly hasTopScoreTie: boolean;
  readonly allCandidatesTied: boolean;
  readonly hasPartialTie: boolean;
  readonly topTieCandidateCount: number;
}

export interface GroupScoreTieAnalysis {
  readonly exact: TieAnalysisResult;
  readonly approx: TieAnalysisResult;
  readonly bestScore: number;
  readonly secondBestScore: number;
  readonly minScore: number;
  readonly scoreMargin: number;
  readonly scoreRange: number;
}

export interface ActualPolicyChoice {
  readonly choiceOrigin?: ChoiceOrigin;
  readonly choiceType?: "ACTUAL_MATCH_CHOICE" | "SHADOW_POLICY_CHOICE"; // 後方互換用
  readonly selectedPatternRef: number;
  readonly selectedActionId?: string;
  readonly selectedKeyCardIds: readonly string[];
  readonly selectedCostSignature: string;
  readonly finalScore: number;
  readonly isGlobalTopScoreTie: boolean;
  readonly isGlobalTieBreakChosen: boolean;
  readonly isArgmaxMismatch?: boolean;
}

export interface PolicyGroupEvaluation {
  readonly policyName: string;
  readonly groupId: string;
  readonly candidateScores: readonly EvaluatedCandidateScore[];
  readonly bestPatternRef: number;
  readonly bestScore: number;
  readonly secondBestScore: number;
  readonly minScore: number;
  readonly scoreMargin: number;
  readonly scoreRange: number;
  readonly tieAnalysis: GroupScoreTieAnalysis;
  // 実選択との分離
  readonly isGroupChosen: boolean;
  readonly isGroupTieBreakChosen: boolean;
  // 特徴量衝突（ペア単位＆グループ判定）
  readonly pairComparisons: readonly CandidatePairFeatureComparison[];
  readonly hasPairBaseCollision?: boolean;
  readonly hasPairTacticalCollision?: boolean;
  readonly hasPairCompleteCollision?: boolean;
  readonly allPairsCompleteColliding?: boolean;
  // 互換用プロパティ（旧集計との比較用）
  readonly hasScoreTie: boolean;
  readonly tieCandidatesCount: number;
  readonly isTieBreakChosen: boolean;
  readonly isBaseFeatureColliding: boolean;
  readonly isTacticalFeatureColliding: boolean;
  readonly isCompleteFeatureColliding: boolean;
}

export interface CardDetailsView {
  readonly cardId: string;
  readonly suit?: string;
  readonly rank?: string;
  readonly value?: number;
  readonly displayCode?: string;
}

export interface DecisionDiagnosticRecord {
  readonly observationId?: string;
  readonly matchSeed?: number;
  readonly matchLeg?: "FORWARD" | "REVERSE";
  readonly decisionOrdinal?: number;
  readonly actualActingPolicyName?: string;
  readonly actualMatchResponse?: Readonly<DecisionResponse>;
  readonly decisionId: string;
  readonly stateVersion: number;
  readonly turnNumber?: number;
  readonly stageActionId?: string;
  readonly activePlayerId: string;
  readonly totalPatternsCount: number;
  readonly pureKeyCardGroups: readonly PureKeyCardVarianceGroup[];
  readonly pureCostGroups: readonly PureCostPaymentVarianceGroup[];
  readonly hasKeyCardVariance: boolean;
  readonly hasCostVariance: boolean;
  readonly hasSummonSoldierVariance: boolean;
  readonly hasCounterVariance: boolean;
  readonly policyEvaluations: Record<string, {
    readonly selectedPatternRef: number;
    readonly actualChoice: ActualPolicyChoice;
    readonly keyCardGroupEvaluations: readonly PolicyGroupEvaluation[];
    readonly costGroupEvaluations: readonly PolicyGroupEvaluation[];
  }>;
  readonly summonSoldierDetails?: {
    readonly groups: readonly {
      readonly patternRefs: readonly number[];
      readonly cards: readonly CardDetailsView[];
      readonly policyChoices: Record<string, {
        readonly chosenPatternRef: number;
        readonly chosenCardId: string;
        readonly isGroupChosen: boolean;
        readonly isTieBreakChosen: boolean;
        readonly scoreMargin: number;
        readonly scoreRange: number;
        readonly isScoreTie: boolean;
        readonly allCandidatesTied: boolean;
        readonly hasPartialTie: boolean;
      }>;
    }[];
  };
  readonly counterDetails?: {
    readonly targetRequestId?: string;
    readonly targetActionId?: string;
    readonly groups: readonly {
      readonly patternRefs: readonly number[];
      readonly cards: readonly CardDetailsView[];
      readonly policyChoices: Record<string, {
        readonly chosenPatternRef: number;
        readonly chosenCardId: string;
        readonly isGroupChosen: boolean;
        readonly isTieBreakChosen: boolean;
        readonly scoreMargin: number;
        readonly scoreRange: number;
        readonly isScoreTie: boolean;
        readonly allCandidatesTied: boolean;
        readonly hasPartialTie: boolean;
      }>;
    }[];
  };
  readonly costPaymentDetails?: {
    readonly groups: readonly {
      readonly patternRefs: readonly number[];
      readonly costs: readonly {
        readonly discardedCardIds: readonly string[];
        readonly drivenBulwarkUnitIds: readonly string[];
        readonly lifeCount: number;
      }[];
      readonly policyChoices: Record<string, {
        readonly chosenPatternRef: number;
        readonly isGroupChosen: boolean;
        readonly isTieBreakChosen: boolean;
        readonly scoreMargin: number;
        readonly scoreRange: number;
        readonly isScoreTie: boolean;
        readonly allCandidatesTied: boolean;
        readonly hasPartialTie: boolean;
      }>;
    }[];
  };
}

// =============================================================================
// 2. 合法手の精密分類ロジック (診断A・修正D)
// =============================================================================

export function normalizeTargetSignature(target?: DecisionCatalog["targetSelections"][number]): string {
  if (!target) return "none";
  return `${target.targetType}:${target.targetPlayerKey || ""}:${target.targetUnitId || ""}:${target.targetRequestId || ""}:${target.targetDefinitionId || ""}`;
}

export function normalizeEffectSignature(effect?: DecisionCatalog["effectSelections"][number]): string {
  if (!effect) return "none";
  const st = effect.selectionType || "none";
  const sv = effect.selectedValues ? [...effect.selectedValues].sort().join(",") : "";
  const as = effect.assignments
    ? [...effect.assignments]
        .slice()
        .sort((a, b) => (a.sourceUnitId || "").localeCompare(b.sourceUnitId || ""))
        .map((a) => `${a.sourceUnitId}:[${[...(a.selectedUnitIds || [])].slice().sort().join(",")}]`)
        .join(";")
    : "";
  const ts = effect.targetSelection ? normalizeTargetSignature(effect.targetSelection) : "none";
  const cd = effect.cards
    ? [...effect.cards.map((c: any) => c.cardInstanceId || c.cardId || "")].slice().sort().join(",")
    : "";
  return `ST:${st}|SV:[${sv}]|AS:[${as}]|TS:${ts}|CD:[${cd}]`;
}

export function normalizeOrderSignature(order?: DecisionCatalog["orderSelections"][number]): string {
  if (!order) return "none";
  // 順序自体が意味を持つためソートせず配列順序を保持
  return (order.orderedIds ?? []).join("->");
}

export function resolvePatternInfo(
  pattern: LegalPattern,
  patternRef: number,
  catalog: DecisionCatalog
): ResolvedPatternInfo {
  const act = pattern.actionSelectionRef !== undefined ? catalog.actions[pattern.actionSelectionRef] : undefined;
  const cardSel = pattern.keyCardSelectionRef !== undefined ? catalog.cardSelections[pattern.keyCardSelectionRef] : undefined;
  const unitSel = pattern.keyUnitSelectionRef !== undefined ? catalog.unitSelections[pattern.keyUnitSelectionRef] : undefined;
  const cost = pattern.costPaymentRef !== undefined ? catalog.costPayments[pattern.costPaymentRef] : undefined;
  const target = pattern.targetSelectionRef !== undefined ? catalog.targetSelections[pattern.targetSelectionRef] : undefined;
  const effect = pattern.effectSelectionRef !== undefined ? catalog.effectSelections[pattern.effectSelectionRef] : undefined;
  const order = pattern.orderSelectionRef !== undefined ? catalog.orderSelections[pattern.orderSelectionRef] : undefined;

  const keyCardIds = Object.freeze([...(cardSel?.cardIds ?? [])]);
  const keyCardDisplayCodes = Object.freeze([...(cardSel?.displayCodes ?? [])]);
  const keyUnitIds = Object.freeze([...(unitSel?.unitIds ?? [])].sort());

  const discardedCardIds = Object.freeze([...(cost?.discardedCardIds ?? [])].sort());
  const drivenBulwarkUnitIds = Object.freeze([...(cost?.drivenBulwarkUnitIds ?? [])].sort());
  const sacrificedUnitIds = Object.freeze([...(cost?.sacrificedUnitIds ?? [])].sort());
  const lifeCount = cost?.lifeCount ?? 0;

  const actionId = act?.actionId ?? (pattern.kind === "PASS" ? "PASS" : "UNKNOWN_ACTION");
  const targetSignature = normalizeTargetSignature(target);
  const effectSignature = normalizeEffectSignature(effect);
  const orderSignature = normalizeOrderSignature(order);
  const keyUnitSignature = `U:[${keyUnitIds.join(",")}]`;
  const costSignature = `D:[${discardedCardIds.join(",")}]_B:[${drivenBulwarkUnitIds.join(",")}]_S:[${sacrificedUnitIds.join(",")}]_L:${lifeCount}`;
  const keyCardSignature = `K:[${[...keyCardIds].sort().join(",")}]`;

  // キーカードだけが異なるグループ化用シグネチャ (アクション + ユニット + 対象 + コスト + 効果 + 順序)
  const conditionSignatureWithoutKeyCard = `ACT:${actionId}|UNIT:${keyUnitSignature}|TGT:${targetSignature}|CST:${costSignature}|EFF:${effectSignature}|ORD:${orderSignature}`;

  // コストだけが異なるグループ化用シグネチャ (アクション + キーカード + ユニット + 対象 + 効果 + 順序)
  const conditionSignatureWithoutCost = `ACT:${actionId}|KEY:${keyCardSignature}|UNIT:${keyUnitSignature}|TGT:${targetSignature}|EFF:${effectSignature}|ORD:${orderSignature}`;

  return {
    patternRef,
    patternId: pattern.patternId,
    kind: pattern.kind,
    actionId: act?.actionId,
    actionName: act?.actionName,
    keyCardIds,
    keyCardDisplayCodes,
    keyUnitIds,
    costPayment: {
      discardedCardIds,
      drivenBulwarkUnitIds,
      sacrificedUnitIds,
      lifeCount,
      summary: cost?.summary,
    },
    targetSignature,
    effectSignature,
    orderSignature,
    keyUnitSignature,
    keyCardSignature,
    costSignature,
    conditionSignatureWithoutKeyCard,
    conditionSignatureWithoutCost,
  };
}

export function classifyDecisionPatterns(
  request: Readonly<DecisionRequest>
): {
  resolvedPatterns: readonly ResolvedPatternInfo[];
  pureKeyCardGroups: readonly PureKeyCardVarianceGroup[];
  pureCostGroups: readonly PureCostPaymentVarianceGroup[];
} {
  const catalog = request.catalog;
  const patterns = request.patterns;
  const resolvedPatterns = patterns.map((p, idx) => resolvePatternInfo(p, idx, catalog));

  // 1. 純粋キーカード選択差分グループの抽出
  const keyCardMap = new Map<string, number[]>();
  for (const rp of resolvedPatterns) {
    if (rp.kind !== "ACTION" || rp.keyCardIds.length === 0) continue;
    const sig = rp.conditionSignatureWithoutKeyCard;
    const list = keyCardMap.get(sig) ?? [];
    list.push(rp.patternRef);
    keyCardMap.set(sig, list);
  }

  const pureKeyCardGroups: PureKeyCardVarianceGroup[] = [];
  let keyGroupIdCounter = 1;
  for (const [sig, refs] of keyCardMap.entries()) {
    if (refs.length < 2) continue;
    // 実際にキーカードが異なることを確認 (同一キーカードの重複を除外)
    const distinctKeys = new Set(refs.map((r) => resolvedPatterns[r].keyCardIds.slice().sort().join(",")));
    if (distinctKeys.size >= 2) {
      const first = resolvedPatterns[refs[0]];
      pureKeyCardGroups.push({
        groupId: `KEY-GRP-${keyGroupIdCounter++}`,
        actionId: first.actionId || "UNKNOWN",
        costSignature: first.costSignature,
        targetSignature: first.targetSignature,
        effectSignature: first.effectSignature,
        orderSignature: first.orderSignature,
        keyUnitSignature: first.keyUnitSignature,
        patternRefs: Object.freeze([...refs]),
        candidateCount: refs.length,
      });
    }
  }

  // 2. 純粋コスト支払い差分グループの抽出
  const costMap = new Map<string, number[]>();
  for (const rp of resolvedPatterns) {
    if (rp.kind !== "ACTION") continue;
    const sig = rp.conditionSignatureWithoutCost;
    const list = costMap.get(sig) ?? [];
    list.push(rp.patternRef);
    costMap.set(sig, list);
  }

  const pureCostGroups: PureCostPaymentVarianceGroup[] = [];
  let costGroupIdCounter = 1;
  for (const [sig, refs] of costMap.entries()) {
    if (refs.length < 2) continue;
    // 実際にコスト支払いが異なることを確認
    const distinctCosts = new Set(refs.map((r) => resolvedPatterns[r].costSignature));
    if (distinctCosts.size >= 2) {
      const first = resolvedPatterns[refs[0]];
      pureCostGroups.push({
        groupId: `COST-GRP-${costGroupIdCounter++}`,
        actionId: first.actionId || "UNKNOWN",
        keyCardSignature: first.keyCardSignature,
        targetSignature: first.targetSignature,
        effectSignature: first.effectSignature,
        orderSignature: first.orderSignature,
        keyUnitSignature: first.keyUnitSignature,
        patternRefs: Object.freeze([...refs]),
        candidateCount: refs.length,
      });
    }
  }

  return {
    resolvedPatterns: Object.freeze(resolvedPatterns),
    pureKeyCardGroups: Object.freeze(pureKeyCardGroups),
    pureCostGroups: Object.freeze(pureCostGroups),
  };
}

// =============================================================================
// 3. 特徴量・スコア識別能力の評価 (診断B・修正A・修正B・修正C)
// =============================================================================

export function analyzeScoresTie(scores: readonly number[]): GroupScoreTieAnalysis {
  if (scores.length === 0) {
    const emptyTie: TieAnalysisResult = {
      hasTopScoreTie: false,
      allCandidatesTied: false,
      hasPartialTie: false,
      topTieCandidateCount: 0,
    };
    return {
      exact: emptyTie,
      approx: emptyTie,
      bestScore: 0,
      secondBestScore: 0,
      minScore: 0,
      scoreMargin: 0,
      scoreRange: 0,
    };
  }

  // 降順ソート
  const sorted = [...scores].sort((a, b) => b - a);
  const bestScore = sorted[0];
  const secondBestScore = sorted.length > 1 ? sorted[1] : bestScore;
  const minScore = sorted[sorted.length - 1];
  // 修正D: 未丸めの生の浮動小数点値で保持 (表示・レポート出力時のみ丸め適用)
  const scoreMargin = bestScore - secondBestScore;
  const scoreRange = bestScore - minScore;

  const EPSILON = 1e-9;

  // exact (===)
  const exactTies = scores.filter((s) => s === bestScore);
  const exactCount = exactTies.length;
  const exactHasTopScoreTie = exactCount > 1;
  const exactAllCandidatesTied = exactCount === scores.length && scores.length > 1;
  const exactHasPartialTie = exactHasTopScoreTie && !exactAllCandidatesTied;

  // approx (Math.abs(s - bestScore) < EPSILON)
  const approxTies = scores.filter((s) => Math.abs(s - bestScore) < EPSILON);
  const approxCount = approxTies.length;
  const approxHasTopScoreTie = approxCount > 1;
  const approxAllCandidatesTied = approxCount === scores.length && scores.length > 1;
  const approxHasPartialTie = approxHasTopScoreTie && !approxAllCandidatesTied;

  return {
    exact: {
      hasTopScoreTie: exactHasTopScoreTie,
      allCandidatesTied: exactAllCandidatesTied,
      hasPartialTie: exactHasPartialTie,
      topTieCandidateCount: exactCount,
    },
    approx: {
      hasTopScoreTie: approxHasTopScoreTie,
      allCandidatesTied: approxAllCandidatesTied,
      hasPartialTie: approxHasPartialTie,
      topTieCandidateCount: approxCount,
    },
    bestScore,
    secondBestScore,
    minScore,
    scoreMargin,
    scoreRange,
  };
}

export function compareCandidatePairs(
  candidateScores: readonly EvaluatedCandidateScore[]
): {
  pairComparisons: readonly CandidatePairFeatureComparison[];
  hasPairBaseCollision?: boolean;
  hasPairTacticalCollision?: boolean;
  hasPairCompleteCollision?: boolean;
  allPairsCompleteColliding?: boolean;
} {
  const EPSILON = 1e-9;
  const pairComparisons: CandidatePairFeatureComparison[] = [];

  let baseAvailCount = 0;
  let tacAvailCount = 0;
  let baseEqualCount = 0;
  let tacEqualCount = 0;
  let completeEqualCount = 0;
  let totalPairs = 0;

  for (let i = 0; i < candidateScores.length; i++) {
    for (let j = i + 1; j < candidateScores.length; j++) {
      totalPairs++;
      const a = candidateScores[i];
      const b = candidateScores[j];

      let baseEqual: boolean | undefined = undefined;
      if (a.baseFeatures && b.baseFeatures && a.baseFeatures.length === b.baseFeatures.length) {
        baseAvailCount++;
        let maxDiff = 0;
        for (let k = 0; k < a.baseFeatures.length; k++) {
          const diff = Math.abs(a.baseFeatures[k] - b.baseFeatures[k]);
          if (diff > maxDiff) maxDiff = diff;
        }
        baseEqual = maxDiff < EPSILON;
        if (baseEqual) baseEqualCount++;
      }

      let tacticalEqual: boolean | undefined = undefined;
      if (a.tacticalFeatures && b.tacticalFeatures && a.tacticalFeatures.length === b.tacticalFeatures.length) {
        tacAvailCount++;
        let maxDiff = 0;
        for (let k = 0; k < a.tacticalFeatures.length; k++) {
          const diff = Math.abs(a.tacticalFeatures[k] - b.tacticalFeatures[k]);
          if (diff > maxDiff) maxDiff = diff;
        }
        tacticalEqual = maxDiff < EPSILON;
        if (tacticalEqual) tacEqualCount++;
      }

      let completeEqual: boolean | undefined = undefined;
      if (baseEqual === true && tacticalEqual === true) {
        completeEqual = true;
        completeEqualCount++;
      } else if (baseEqual === false || tacticalEqual === false) {
        completeEqual = false;
      } else {
        // どちらか一方でも undefined の場合、完全一致は判定不能 (undefined)
        completeEqual = undefined;
      }

      pairComparisons.push({
        candidateRefA: a.patternRef,
        candidateRefB: b.patternRef,
        baseEqual,
        tacticalEqual,
        completeEqual,
      });
    }
  }

  const hasPairBaseCollision = baseAvailCount > 0 ? baseEqualCount > 0 : undefined;
  const hasPairTacticalCollision = tacAvailCount > 0 ? tacEqualCount > 0 : undefined;
  const bothAvailCount = pairComparisons.filter(
    (p) => p.baseEqual !== undefined && p.tacticalEqual !== undefined
  ).length;
  const hasPairCompleteCollision = bothAvailCount > 0 ? completeEqualCount > 0 : undefined;
  const allPairsCompleteColliding = bothAvailCount > 0 && totalPairs > 0 ? completeEqualCount === totalPairs : undefined;

  return {
    pairComparisons: Object.freeze(pairComparisons),
    hasPairBaseCollision,
    hasPairTacticalCollision,
    hasPairCompleteCollision,
    allPairsCompleteColliding,
  };
}

export function evaluatePolicyOnDecisionRequest(
  policy: DecisionPolicy,
  policyName: string,
  request: Readonly<DecisionRequest>,
  resolvedPatterns: readonly ResolvedPatternInfo[],
  options?: {
    actualResponse?: Readonly<DecisionResponse>;
    choiceOrigin?: ChoiceOrigin;
    choiceType?: "ACTUAL_MATCH_CHOICE" | "SHADOW_POLICY_CHOICE";
  }
): {
  candidateScores: readonly EvaluatedCandidateScore[];
  bestPatternRef: number;
  actualChoice: ActualPolicyChoice;
} {
  const patterns = request.patterns;
  const encoded = DecisionFeatureEncoder.encode(request);

  let candidateScores: EvaluatedCandidateScore[];
  let bestPatternRef: number;

  if (policy instanceof Gen9LearnableTacticalPolicy) {
    const evalRes = policy.evaluatePatterns(request);
    candidateScores = evalRes.scoredPatterns.map((d, i) => ({
      patternRef: d.patternRef,
      baseScore: d.baseScore,
      tacticalAdjustment: d.tacticalAdjustment,
      finalScore: d.finalScore,
      tacticalFeatures: d.tacticalFeatures ? Object.freeze(Array.from(d.tacticalFeatures)) : undefined,
      baseFeatures: encoded.patterns[i] ? Object.freeze(Array.from(encoded.patterns[i].values)) : undefined,
    }));
    bestPatternRef = evalRes.bestPatternRef;
  } else if (policy instanceof Gen9TacticalPrototypePolicy) {
    const evalRes = policy.evaluatePatterns(request);
    candidateScores = evalRes.scoredPatterns.map((d, i) => ({
      patternRef: d.patternRef,
      baseScore: d.baseScore,
      tacticalAdjustment: d.tacticalAdjustment,
      finalScore: d.finalScore,
      baseFeatures: encoded.patterns[i] ? Object.freeze(Array.from(encoded.patterns[i].values)) : undefined,
    }));
    bestPatternRef = evalRes.bestPatternRef;
  } else if (policy instanceof GenomePolicy) {
    // Gen 8 (GenomePolicy)
    const scored = GenomeScorer.score(encoded, (policy as any).dna);
    let bestScore = -Infinity;
    let bRef = scored.length > 0 ? scored[0].patternRef : 0;
    for (const p of scored) {
      if (p.score > bestScore) {
        bestScore = p.score;
        bRef = p.patternRef;
      }
    }
    candidateScores = scored.map((s, i) => ({
      patternRef: s.patternRef,
      baseScore: s.score,
      tacticalAdjustment: 0,
      finalScore: s.score,
      baseFeatures: encoded.patterns[i] ? Object.freeze(Array.from(encoded.patterns[i].values)) : undefined,
    }));
    bestPatternRef = bRef;
  } else {
    // 汎用 Policy (choose を呼んで選択手のみ取得)
    const choice = policy.choose(request);
    candidateScores = patterns.map((_, i) => ({
      patternRef: i,
      baseScore: 0,
      tacticalAdjustment: 0,
      finalScore: i === choice.selectedPatternRef ? 1 : 0,
    }));
    bestPatternRef = choice.selectedPatternRef;
  }

  // 全合法手の中での最高スコアとタイブレーク判定 (修正D: 厳密同点 exact === に基づくタイブレーク)
  let globalBestScore = -Infinity;
  for (const s of candidateScores) {
    if (s.finalScore > globalBestScore) {
      globalBestScore = s.finalScore;
    }
  }

  const chosenRef = options?.actualResponse ? options.actualResponse.selectedPatternRef : bestPatternRef;
  const exactGlobalTopTies = candidateScores.filter((s) => s.finalScore === globalBestScore);
  const minGlobalTieRef =
    exactGlobalTopTies.length > 0
      ? Math.min(...exactGlobalTopTies.map((s) => s.patternRef))
      : chosenRef;

  const isArgmaxMismatch = options?.actualResponse ? chosenRef !== bestPatternRef : false;
  const choiceOrigin: ChoiceOrigin =
    options?.choiceOrigin ?? (options?.actualResponse ? "ACTUAL_MATCH_CHOICE" : "SHADOW_POLICY_CHOICE");

  const chosenPattern = resolvedPatterns.find((p) => p.patternRef === chosenRef);
  const actualChoice: ActualPolicyChoice = {
    choiceOrigin,
    choiceType: choiceOrigin,
    selectedPatternRef: chosenRef,
    selectedActionId: chosenPattern?.actionId,
    selectedKeyCardIds: chosenPattern?.keyCardIds ?? [],
    selectedCostSignature: chosenPattern?.costSignature ?? "",
    finalScore: candidateScores.find((s) => s.patternRef === chosenRef)?.finalScore ?? 0,
    isGlobalTopScoreTie: exactGlobalTopTies.length > 1,
    isGlobalTieBreakChosen: exactGlobalTopTies.length > 1 && chosenRef === minGlobalTieRef,
    isArgmaxMismatch,
  };

  return {
    candidateScores: Object.freeze(candidateScores),
    bestPatternRef,
    actualChoice,
  };
}

export function evaluateGroupDistinguishability(
  policyName: string,
  group: { groupId: string; patternRefs: readonly number[] },
  candidateScores: readonly EvaluatedCandidateScore[],
  actualChoice?: ActualPolicyChoice
): PolicyGroupEvaluation {
  // 修正D: patternRef による明示的対応付け (インデックス暗黙仮定の排除)
  const groupScores = group.patternRefs.map((ref) => {
    const found = candidateScores.find((s) => s.patternRef === ref);
    if (!found) {
      throw new Error(`[PATTERN_REF_NOT_FOUND] candidateScores 内に patternRef=${ref} が見つかりません`);
    }
    return found;
  });
  const scoresOnly = groupScores.map((s) => s.finalScore);

  // 修正A & 修正D: 同点判定 (未丸めスコア保持)
  const tieAnalysis = analyzeScoresTie(scoresOnly);
  const bestScore = tieAnalysis.bestScore;
  const secondBestScore = tieAnalysis.secondBestScore;
  const minScore = tieAnalysis.minScore;
  const scoreMargin = tieAnalysis.scoreMargin;
  const scoreRange = tieAnalysis.scoreRange;

  // グループ内での最良候補 (スコア降順、同点は最小 patternRef) - R3.1: 厳密比較
  const sortedScores = [...groupScores].sort((a, b) => {
    if (b.finalScore !== a.finalScore) {
      return b.finalScore - a.finalScore;
    }
    return a.patternRef - b.patternRef;
  });
  const bestPatternRef = sortedScores[0]?.patternRef ?? group.patternRefs[0];

  // グループ最高スコア同点候補リスト (修正D: 厳密一致 exact ===)
  const topExactTieCandidates = groupScores.filter((s) => s.finalScore === bestScore);
  const minIndexAmongGroupExactTies =
    topExactTieCandidates.length > 0
      ? Math.min(...topExactTieCandidates.map((c) => c.patternRef))
      : bestPatternRef;

  // 近似同点候補リスト (approx 1e-9)
  const EPSILON = 1e-9;
  const topApproxTieCandidates = groupScores.filter((s) => Math.abs(s.finalScore - bestScore) < EPSILON);

  // 修正B: Policy実選択との分離 (未指定時は内部最良選択を使用)
  const actual: ActualPolicyChoice = actualChoice ?? {
    choiceOrigin: "SHADOW_POLICY_CHOICE",
    choiceType: "SHADOW_POLICY_CHOICE",
    selectedPatternRef: bestPatternRef,
    selectedActionId: undefined,
    selectedKeyCardIds: [],
    selectedCostSignature: "",
    finalScore: bestScore,
    isGlobalTopScoreTie: topExactTieCandidates.length > 1,
    isGlobalTieBreakChosen: topExactTieCandidates.length > 1 && bestPatternRef === minIndexAmongGroupExactTies,
  };

  // 1. Policyが実際にこのグループ内の候補を選んだか
  const isGroupChosen = group.patternRefs.includes(actual.selectedPatternRef);
  // 2. Policyがこのグループ内の候補を実際に選択し、かつその選択が厳密同点タイブレークによるものか (修正D)
  const isGroupTieBreakChosen =
    isGroupChosen &&
    topExactTieCandidates.some((c) => c.patternRef === actual.selectedPatternRef) &&
    actual.selectedPatternRef === minIndexAmongGroupExactTies &&
    topExactTieCandidates.length > 1;

  // 修正C: 候補ペア単位の特徴量比較
  const pairCompResult = compareCandidatePairs(groupScores);

  return {
    policyName,
    groupId: group.groupId,
    candidateScores: Object.freeze(groupScores),
    bestPatternRef,
    bestScore,
    secondBestScore,
    minScore,
    scoreMargin,
    scoreRange,
    tieAnalysis,
    isGroupChosen,
    isGroupTieBreakChosen,
    pairComparisons: pairCompResult.pairComparisons,
    hasPairBaseCollision: pairCompResult.hasPairBaseCollision,
    hasPairTacticalCollision: pairCompResult.hasPairTacticalCollision,
    hasPairCompleteCollision: pairCompResult.hasPairCompleteCollision,
    allPairsCompleteColliding: pairCompResult.allPairsCompleteColliding,
    // 互換用プロパティ（旧集計との比較用）
    hasScoreTie: tieAnalysis.exact.hasTopScoreTie,
    tieCandidatesCount: tieAnalysis.exact.topTieCandidateCount,
    isTieBreakChosen: tieAnalysis.exact.hasTopScoreTie && bestPatternRef === minIndexAmongGroupExactTies,
    isBaseFeatureColliding: pairCompResult.hasPairBaseCollision ?? false,
    isTacticalFeatureColliding: pairCompResult.hasPairTacticalCollision ?? false,
    isCompleteFeatureColliding: pairCompResult.hasPairCompleteCollision ?? false,
  };
}

// =============================================================================
// 4. 透過的観測ラッパー Policy (元Policyの選択を一切変えずにログ収集)
// =============================================================================

export class DiagnosticTransparentWrapperPolicy implements DecisionPolicy {
  public readonly descriptor: PolicyDescriptor;
  private readonly targetPolicy: DecisionPolicy;
  public readonly recordedDecisions: DecisionRequest[] = [];
  public totalDecisionsObserved = 0;
  private readonly onDecisionCallback?: (
    request: Readonly<DecisionRequest>,
    response: Readonly<DecisionResponse>
  ) => void;
  private readonly recordAll: boolean;

  constructor(
    targetPolicy: DecisionPolicy,
    options?: {
      onDecision?: (
        request: Readonly<DecisionRequest>,
        response: Readonly<DecisionResponse>
      ) => void;
      recordAllDecisions?: boolean;
    }
  ) {
    this.targetPolicy = targetPolicy;
    this.descriptor = targetPolicy.descriptor;
    this.onDecisionCallback = options?.onDecision;
    this.recordAll = options?.recordAllDecisions ?? (options?.onDecision ? false : true);
  }

  public choose(request: Readonly<DecisionRequest>): DecisionResponse {
    this.totalDecisionsObserved++;
    if (this.recordAll) {
      this.recordedDecisions.push(request as DecisionRequest);
    }
    // 修正C: 元 Policy に委譲してレスポンスを取得 (二重実行防止 & 実選択の直接記録)
    const response = this.targetPolicy.choose(request);
    if (this.onDecisionCallback) {
      try {
        this.onDecisionCallback(request, response);
      } catch (err) {
        // 非干渉性: 診断コールバックの例外でシミュレーションを中断させない
        console.error("Diagnostic callback error:", err);
      }
    }
    // 元 Policy の選択を一切変更せずそのまま返却
    return response;
  }
}

// =============================================================================
// 5. カード情報抽出ヘルパー (公開情報のみ)
// =============================================================================

export function extractKnownCardDetails(
  cardId: string,
  request: Readonly<DecisionRequest>
): CardDetailsView {
  const obs = request.observation;
  let card: KnownCardView | undefined;

  for (const p of obs.players ?? []) {
    // 手札
    if (p.handCards) {
      const found = p.handCards.find(
        (c) => c.visibility === "KNOWN" && (c as KnownCardView).cardInstanceId === cardId
      );
      if (found && found.visibility === "KNOWN") {
        card = found as KnownCardView;
        break;
      }
    }
    // 墓地
    if (p.grave) {
      for (const item of p.grave) {
        if ("cardInstanceId" in item && item.visibility === "KNOWN" && (item as KnownCardView).cardInstanceId === cardId) {
          card = item as KnownCardView;
          break;
        }
        if ("cards" in item && Array.isArray((item as any).cards)) {
          const found = ((item as any).cards as readonly CardView[]).find(
            (c) => c.visibility === "KNOWN" && (c as KnownCardView).cardInstanceId === cardId
          );
          if (found && found.visibility === "KNOWN") {
            card = found as KnownCardView;
            break;
          }
        }
      }
      if (card) break;
    }
    // フィールド
    if (p.field) {
      for (const u of p.field) {
        if (u.cards) {
          const found = u.cards.find(
            (c) => c.visibility === "KNOWN" && (c as KnownCardView).cardInstanceId === cardId
          );
          if (found && found.visibility === "KNOWN") {
            card = found as KnownCardView;
            break;
          }
        }
      }
      if (card) break;
    }
    // トランプ
    if (p.trumps) {
      for (const u of p.trumps) {
        if (u.cards) {
          const found = u.cards.find(
            (c) => c.visibility === "KNOWN" && (c as KnownCardView).cardInstanceId === cardId
          );
          if (found && found.visibility === "KNOWN") {
            card = found as KnownCardView;
            break;
          }
        }
      }
      if (card) break;
    }
  }

  let catalogCode: string | undefined;
  for (const cs of request.catalog.cardSelections ?? []) {
    const idx = cs.cardIds.indexOf(cardId);
    if (idx !== -1 && cs.displayCodes && cs.displayCodes[idx]) {
      catalogCode = cs.displayCodes[idx];
      break;
    }
  }

  return {
    cardId,
    suit: card?.suit,
    rank: card?.rank,
    value: card?.value,
    displayCode: card ? (card.code || `${card.suit || ""}${card.rank || ""}`) : catalogCode || cardId,
  };
}

// =============================================================================
// 6. 1 DecisionRequest に対する総合診断実行器
// =============================================================================

export function diagnoseDecisionRequest(
  request: Readonly<DecisionRequest>,
  policies: Record<string, DecisionPolicy>,
  actualMatchResponsesOrObserved?:
    | Record<string, Readonly<DecisionResponse>>
    | Readonly<ObservedMatchDecision>
): DecisionDiagnosticRecord | null {
  // ストリーミング判断または合法手が存在しない場合は安全にスキップ
  if ((request as any).isStreaming || !request.patterns || request.patterns.length === 0) {
    return null;
  }

  const observedDecision: Readonly<ObservedMatchDecision> | undefined =
    actualMatchResponsesOrObserved && "observationId" in actualMatchResponsesOrObserved
      ? (actualMatchResponsesOrObserved as Readonly<ObservedMatchDecision>)
      : undefined;

  const legacyActualResponses: Record<string, Readonly<DecisionResponse>> | undefined =
    actualMatchResponsesOrObserved && !("observationId" in actualMatchResponsesOrObserved)
      ? (actualMatchResponsesOrObserved as Record<string, Readonly<DecisionResponse>>)
      : undefined;

  const { resolvedPatterns, pureKeyCardGroups, pureCostGroups } = classifyDecisionPatterns(request);

  const hasKeyCardVariance = pureKeyCardGroups.length > 0;
  const hasCostVariance = pureCostGroups.length > 0;

  // カード選択またはコスト選択の差分が一切ない局面は診断対象外 (スキップ可能)
  if (!hasKeyCardVariance && !hasCostVariance) {
    return null;
  }

  const stageReqs = request.observation.stageRequests ?? [];
  const topStageReq = stageReqs.length > 0 ? stageReqs[stageReqs.length - 1] : undefined;

  const hasSummonSoldierVariance = pureKeyCardGroups.some((g) => g.actionId === "action.summonSoldier");
  const hasCounterVariance = pureKeyCardGroups.some(
    (g) => g.actionId === "action.counter" || g.actionId.toLowerCase().includes("counter")
  );

  const policyEvaluations: DecisionDiagnosticRecord["policyEvaluations"] = {};

  for (const [pName, policy] of Object.entries(policies)) {
    let actualResp: Readonly<DecisionResponse> | undefined;
    let choiceOrigin: ChoiceOrigin;

    if (observedDecision) {
      // 一体型観測レコードの場合: 手番を担当した当事者Policyのみが実選択
      if (pName === observedDecision.policyName) {
        actualResp = observedDecision.response;
        choiceOrigin = "ACTUAL_MATCH_CHOICE";
      } else {
        actualResp = undefined;
        choiceOrigin = "SHADOW_POLICY_CHOICE";
      }
    } else if (legacyActualResponses) {
      actualResp = legacyActualResponses[pName];
      choiceOrigin = actualResp ? "ACTUAL_MATCH_CHOICE" : "SHADOW_POLICY_CHOICE";
    } else {
      actualResp = undefined;
      choiceOrigin = "SHADOW_POLICY_CHOICE";
    }

    const { candidateScores, bestPatternRef, actualChoice } = evaluatePolicyOnDecisionRequest(
      policy,
      pName,
      request,
      resolvedPatterns,
      {
        actualResponse: actualResp,
        choiceOrigin,
        choiceType: choiceOrigin,
      }
    );

    const keyCardGroupEvaluations = pureKeyCardGroups.map((g) =>
      evaluateGroupDistinguishability(pName, g, candidateScores, actualChoice)
    );
    const costGroupEvaluations = pureCostGroups.map((g) =>
      evaluateGroupDistinguishability(pName, g, candidateScores, actualChoice)
    );

    policyEvaluations[pName] = {
      selectedPatternRef: bestPatternRef,
      actualChoice,
      keyCardGroupEvaluations: Object.freeze(keyCardGroupEvaluations),
      costGroupEvaluations: Object.freeze(costGroupEvaluations),
    };
  }

  // 兵士召喚詳細
  let summonSoldierDetails: DecisionDiagnosticRecord["summonSoldierDetails"];
  if (hasSummonSoldierVariance) {
    const summonGroups = pureKeyCardGroups.filter((g) => g.actionId === "action.summonSoldier");
    summonSoldierDetails = {
      groups: summonGroups.map((g) => {
        const patternRefs = g.patternRefs;
        const cards = patternRefs.map((ref) => {
          const rp = resolvedPatterns[ref];
          const cid = rp.keyCardIds[0] || "unknown";
          return extractKnownCardDetails(cid, request);
        });
        const policyChoices: Record<string, any> = {};
        for (const [pName, evals] of Object.entries(policyEvaluations)) {
          const grpEval = evals.keyCardGroupEvaluations.find((e) => e.groupId === g.groupId);
          const chosenRef = grpEval ? grpEval.bestPatternRef : evals.selectedPatternRef;
          const chosenCid = resolvedPatterns[chosenRef]?.keyCardIds[0] || "unknown";
          policyChoices[pName] = {
            chosenPatternRef: chosenRef,
            chosenCardId: chosenCid,
            isGroupChosen: grpEval ? grpEval.isGroupChosen : false,
            isTieBreakChosen: grpEval ? grpEval.isGroupTieBreakChosen : false,
            scoreMargin: grpEval ? grpEval.scoreMargin : 0,
            scoreRange: grpEval ? grpEval.scoreRange : 0,
            isScoreTie: grpEval ? grpEval.tieAnalysis.approx.hasTopScoreTie : false,
            allCandidatesTied: grpEval ? grpEval.tieAnalysis.approx.allCandidatesTied : false,
            hasPartialTie: grpEval ? grpEval.tieAnalysis.approx.hasPartialTie : false,
          };
        }
        return { patternRefs, cards, policyChoices };
      }),
    };
  }

  // Counter 詳細
  let counterDetails: DecisionDiagnosticRecord["counterDetails"];
  if (hasCounterVariance) {
    const counterGroups = pureKeyCardGroups.filter(
      (g) => g.actionId === "action.counter" || g.actionId.toLowerCase().includes("counter")
    );
    counterDetails = {
      targetRequestId: topStageReq?.requestId,
      targetActionId: topStageReq?.actionId,
      groups: counterGroups.map((g) => {
        const patternRefs = g.patternRefs;
        const cards = patternRefs.map((ref) => {
          const rp = resolvedPatterns[ref];
          const cid = rp.keyCardIds[0] || "unknown";
          return extractKnownCardDetails(cid, request);
        });
        const policyChoices: Record<string, any> = {};
        for (const [pName, evals] of Object.entries(policyEvaluations)) {
          const grpEval = evals.keyCardGroupEvaluations.find((e) => e.groupId === g.groupId);
          const chosenRef = grpEval ? grpEval.bestPatternRef : evals.selectedPatternRef;
          const chosenCid = resolvedPatterns[chosenRef]?.keyCardIds[0] || "unknown";
          policyChoices[pName] = {
            chosenPatternRef: chosenRef,
            chosenCardId: chosenCid,
            isGroupChosen: grpEval ? grpEval.isGroupChosen : false,
            isTieBreakChosen: grpEval ? grpEval.isGroupTieBreakChosen : false,
            scoreMargin: grpEval ? grpEval.scoreMargin : 0,
            scoreRange: grpEval ? grpEval.scoreRange : 0,
            isScoreTie: grpEval ? grpEval.tieAnalysis.approx.hasTopScoreTie : false,
            allCandidatesTied: grpEval ? grpEval.tieAnalysis.approx.allCandidatesTied : false,
            hasPartialTie: grpEval ? grpEval.tieAnalysis.approx.hasPartialTie : false,
          };
        }
        return { patternRefs, cards, policyChoices };
      }),
    };
  }

  // コスト支払い詳細
  let costPaymentDetails: DecisionDiagnosticRecord["costPaymentDetails"];
  if (hasCostVariance) {
    costPaymentDetails = {
      groups: pureCostGroups.map((g) => {
        const patternRefs = g.patternRefs;
        const costs = patternRefs.map((ref) => {
          const rp = resolvedPatterns[ref];
          return {
            discardedCardIds: rp.costPayment.discardedCardIds,
            drivenBulwarkUnitIds: rp.costPayment.drivenBulwarkUnitIds,
            lifeCount: rp.costPayment.lifeCount,
          };
        });
        const policyChoices: Record<string, any> = {};
        for (const [pName, evals] of Object.entries(policyEvaluations)) {
          const grpEval = evals.costGroupEvaluations.find((e) => e.groupId === g.groupId);
          const chosenRef = grpEval ? grpEval.bestPatternRef : evals.selectedPatternRef;
          policyChoices[pName] = {
            chosenPatternRef: chosenRef,
            isGroupChosen: grpEval ? grpEval.isGroupChosen : false,
            isTieBreakChosen: grpEval ? grpEval.isGroupTieBreakChosen : false,
            scoreMargin: grpEval ? grpEval.scoreMargin : 0,
            scoreRange: grpEval ? grpEval.scoreRange : 0,
            isScoreTie: grpEval ? grpEval.tieAnalysis.approx.hasTopScoreTie : false,
            allCandidatesTied: grpEval ? grpEval.tieAnalysis.approx.allCandidatesTied : false,
            hasPartialTie: grpEval ? grpEval.tieAnalysis.approx.hasPartialTie : false,
          };
        }
        return { patternRefs, costs, policyChoices };
      }),
    };
  }

  return {
    observationId: observedDecision?.observationId,
    matchSeed: observedDecision?.matchSeed,
    matchLeg: observedDecision?.matchLeg,
    decisionOrdinal: observedDecision?.decisionOrdinal,
    actualActingPolicyName: observedDecision?.policyName,
    actualMatchResponse: observedDecision?.response,
    decisionId: request.decisionId,
    stateVersion: request.stateVersion,
    turnNumber: request.observation.turnCount ?? 0,
    stageActionId: topStageReq?.actionId,
    activePlayerId: request.playerId,
    totalPatternsCount: request.patterns.length,
    pureKeyCardGroups,
    pureCostGroups,
    hasKeyCardVariance,
    hasCostVariance,
    hasSummonSoldierVariance,
    hasCounterVariance,
    policyEvaluations,
    summonSoldierDetails,
    counterDetails,
    costPaymentDetails,
  };
}

// =============================================================================
// 7. 全体統計集計ロジック (診断C・修正A・修正B・修正C・R3.1分離集計)
// =============================================================================

export interface PolicyCategoryMetrics {
  readonly evaluatedGroupsCount: number;
  readonly topTieExactCount: number;
  readonly topTieExactRate: number;
  readonly allTiedExactCount: number;
  readonly allTiedExactRate: number;
  readonly partialTieExactCount: number;
  readonly partialTieExactRate: number;
  readonly topTieApproxCount: number;
  readonly topTieApproxRate: number;
  readonly allTiedApproxCount: number;
  readonly allTiedApproxRate: number;
  readonly partialTieApproxCount: number;
  readonly partialTieApproxRate: number;
  readonly tieBreakChosenCount: number;
  readonly tieBreakChosenRate: number;
  readonly totalPairsEvaluated: number;
  readonly pairCompleteCollisionCount: number;
  readonly pairCompleteCollisionRate?: number;
  readonly allPairsCompleteCollidingGroupCount: number;
  readonly allPairsCompleteCollidingGroupRate?: number;
  readonly avgScoreMargin: number;
  readonly avgScoreRange: number;
}

export interface ActualMatchPolicyMetrics {
  readonly decisionsCount: number;
  readonly keyCard: {
    readonly evaluatedGroupsCount: number;
    readonly chosenGroupCount: number;
    readonly chosenGroupRate: number;
    readonly chosenTieBreakCount: number;
    readonly chosenTieBreakRate: number;
  };
  readonly cost: {
    readonly evaluatedGroupsCount: number;
    readonly chosenGroupCount: number;
    readonly chosenGroupRate: number;
    readonly chosenTieBreakCount: number;
    readonly chosenTieBreakRate: number;
  };
}

export interface ShadowEvaluationPolicyMetrics {
  readonly decisionsCount: number;
  readonly keyCard: PolicyCategoryMetrics;
  readonly cost: PolicyCategoryMetrics;
}

export interface PolicyAggregateMetrics {
  readonly policyName: string;

  // --- Work 5-4C R3.1 完全分離集計 ---
  readonly actualMatch?: ActualMatchPolicyMetrics;
  readonly shadowEvaluation?: ShadowEvaluationPolicyMetrics;

  // --- キーカード群 (後方互換用フラットプロパティ) ---
  readonly totalKeyCardGroupsEvaluated: number;
  // 同点判定 (Exact)
  readonly keyCardTopTieExactCount: number;
  readonly keyCardTopTieExactRate: number;
  readonly keyCardAllTiedExactCount: number;
  readonly keyCardAllTiedExactRate: number;
  readonly keyCardPartialTieExactCount: number;
  readonly keyCardPartialTieExactRate: number;
  // 同点判定 (Approx: 1e-9)
  readonly keyCardTopTieApproxCount: number;
  readonly keyCardTopTieApproxRate: number;
  readonly keyCardAllTiedApproxCount: number;
  readonly keyCardAllTiedApproxRate: number;
  readonly keyCardPartialTieApproxCount: number;
  readonly keyCardPartialTieApproxRate: number;
  // 実選択との結合
  readonly keyCardActualChosenGroupCount: number;
  readonly keyCardActualChosenGroupRate: number;
  readonly keyCardActualChosenTieBreakCount: number;
  readonly keyCardActualChosenTieBreakRate: number;
  // ペア単位特徴量衝突
  readonly keyCardTotalPairsEvaluated: number;
  readonly keyCardPairBaseCollisionCount: number;
  readonly keyCardPairBaseCollisionRate?: number;
  readonly keyCardPairTacticalCollisionCount: number;
  readonly keyCardPairTacticalCollisionRate?: number;
  readonly keyCardPairCompleteCollisionCount: number;
  readonly keyCardPairCompleteCollisionRate?: number;
  readonly keyCardAllPairsCompleteCollidingGroupCount: number;
  readonly keyCardAllPairsCompleteCollidingGroupRate?: number;
  // スコア指標
  readonly keyCardAvgScoreMargin: number;
  readonly keyCardAvgScoreRange: number;

  // --- コスト群 ---
  readonly totalCostGroupsEvaluated: number;
  // 同点判定 (Exact)
  readonly costTopTieExactCount: number;
  readonly costTopTieExactRate: number;
  readonly costAllTiedExactCount: number;
  readonly costAllTiedExactRate: number;
  readonly costPartialTieExactCount: number;
  readonly costPartialTieExactRate: number;
  // 同点判定 (Approx: 1e-9)
  readonly costTopTieApproxCount: number;
  readonly costTopTieApproxRate: number;
  readonly costAllTiedApproxCount: number;
  readonly costAllTiedApproxRate: number;
  readonly costPartialTieApproxCount: number;
  readonly costPartialTieApproxRate: number;
  // 実選択との結合
  readonly costActualChosenGroupCount: number;
  readonly costActualChosenGroupRate: number;
  readonly costActualChosenTieBreakCount: number;
  readonly costActualChosenTieBreakRate: number;
  // ペア単位特徴量衝突
  readonly costTotalPairsEvaluated: number;
  readonly costPairBaseCollisionCount: number;
  readonly costPairBaseCollisionRate?: number;
  readonly costPairTacticalCollisionCount: number;
  readonly costPairTacticalCollisionRate?: number;
  readonly costPairCompleteCollisionCount: number;
  readonly costPairCompleteCollisionRate?: number;
  readonly costAllPairsCompleteCollidingGroupCount: number;
  readonly costAllPairsCompleteCollidingGroupRate?: number;
  // スコア指標
  readonly costAvgScoreMargin: number;
  readonly costAvgScoreRange: number;

  // --- 互換用旧指標（Work 5-4C 初版との比較用） ---
  readonly keyCardScoreTieCount: number;
  readonly keyCardScoreTieRate: number;
  readonly keyCardTieBreakCount: number;
  readonly keyCardTieBreakRate: number;
  readonly keyCardBaseFeatureCollisionCount: number;
  readonly keyCardBaseFeatureCollisionRate: number;
  readonly keyCardTacticalFeatureCollisionCount: number;
  readonly keyCardTacticalFeatureCollisionRate: number;
  readonly keyCardCompleteCollisionCount: number;
  readonly keyCardCompleteCollisionRate: number;

  readonly costScoreTieCount: number;
  readonly costScoreTieRate: number;
  readonly costTieBreakCount: number;
  readonly costTieBreakRate: number;
  readonly costBaseFeatureCollisionCount: number;
  readonly costBaseFeatureCollisionRate: number;
}

export function computePolicyAggregateMetrics(
  policyName: string,
  records: readonly DecisionDiagnosticRecord[]
): PolicyAggregateMetrics {
  // キーカード
  let totalKeyCardGroups = 0;
  let keyCardTopTieExactCount = 0;
  let keyCardAllTiedExactCount = 0;
  let keyCardPartialTieExactCount = 0;
  let keyCardTopTieApproxCount = 0;
  let keyCardAllTiedApproxCount = 0;
  let keyCardPartialTieApproxCount = 0;
  let keyCardActualChosenGroupCount = 0;
  let keyCardActualChosenTieBreakCount = 0;

  let keyCardTotalPairs = 0;
  let keyCardPairBaseAvailCount = 0;
  let keyCardPairBaseEqualCount = 0;
  let keyCardPairTacAvailCount = 0;
  let keyCardPairTacEqualCount = 0;
  let keyCardPairBothAvailCount = 0;
  let keyCardPairCompleteEqualCount = 0;
  let keyCardAllPairsCompleteCollidingGroups = 0;
  let keyCardCompleteGroupsEvaluated = 0;

  let keyCardScoreMarginSum = 0;
  let keyCardScoreRangeSum = 0;

  // 互換旧指標用
  let keyCardScoreTieCountOld = 0;
  let keyCardTieBreakCountOld = 0;
  let keyCardBaseCollisionCountOld = 0;
  let keyCardTacCollisionCountOld = 0;
  let keyCardCompleteCollisionCountOld = 0;

  // コスト
  let totalCostGroups = 0;
  let costTopTieExactCount = 0;
  let costAllTiedExactCount = 0;
  let costPartialTieExactCount = 0;
  let costTopTieApproxCount = 0;
  let costAllTiedApproxCount = 0;
  let costPartialTieApproxCount = 0;
  let costActualChosenGroupCount = 0;
  let costActualChosenTieBreakCount = 0;

  let costTotalPairs = 0;
  let costPairBaseAvailCount = 0;
  let costPairBaseEqualCount = 0;
  let costPairTacAvailCount = 0;
  let costPairTacEqualCount = 0;
  let costPairBothAvailCount = 0;
  let costPairCompleteEqualCount = 0;
  let costAllPairsCompleteCollidingGroups = 0;
  let costCompleteGroupsEvaluated = 0;

  let costScoreMarginSum = 0;
  let costScoreRangeSum = 0;

  // 互換旧指標用
  let costScoreTieCountOld = 0;
  let costTieBreakCountOld = 0;
  let costBaseCollisionCountOld = 0;

  for (const rec of records) {
    const ev = rec.policyEvaluations[policyName];
    if (!ev) continue;

    for (const g of ev.keyCardGroupEvaluations) {
      totalKeyCardGroups++;
      // 同点
      if (g.tieAnalysis.exact.hasTopScoreTie) keyCardTopTieExactCount++;
      if (g.tieAnalysis.exact.allCandidatesTied) keyCardAllTiedExactCount++;
      if (g.tieAnalysis.exact.hasPartialTie) keyCardPartialTieExactCount++;

      if (g.tieAnalysis.approx.hasTopScoreTie) keyCardTopTieApproxCount++;
      if (g.tieAnalysis.approx.allCandidatesTied) keyCardAllTiedApproxCount++;
      if (g.tieAnalysis.approx.hasPartialTie) keyCardPartialTieApproxCount++;

      // 実選択結合
      if (g.isGroupChosen) {
        keyCardActualChosenGroupCount++;
        if (g.isGroupTieBreakChosen) keyCardActualChosenTieBreakCount++;
      }

      // ペア特徴量
      for (const p of g.pairComparisons) {
        keyCardTotalPairs++;
        if (p.baseEqual !== undefined) {
          keyCardPairBaseAvailCount++;
          if (p.baseEqual) keyCardPairBaseEqualCount++;
        }
        if (p.tacticalEqual !== undefined) {
          keyCardPairTacAvailCount++;
          if (p.tacticalEqual) keyCardPairTacEqualCount++;
        }
        if (p.baseEqual !== undefined && p.tacticalEqual !== undefined) {
          keyCardPairBothAvailCount++;
          if (p.completeEqual) keyCardPairCompleteEqualCount++;
        }
      }
      if (g.allPairsCompleteColliding !== undefined) {
        keyCardCompleteGroupsEvaluated++;
        if (g.allPairsCompleteColliding) keyCardAllPairsCompleteCollidingGroups++;
      }

      keyCardScoreMarginSum += g.scoreMargin;
      keyCardScoreRangeSum += g.scoreRange;

      // 互換用
      if (g.hasScoreTie) keyCardScoreTieCountOld++;
      if (g.isTieBreakChosen) keyCardTieBreakCountOld++;
      if (g.isBaseFeatureColliding) keyCardBaseCollisionCountOld++;
      if (g.isTacticalFeatureColliding) keyCardTacCollisionCountOld++;
      if (g.isCompleteFeatureColliding) keyCardCompleteCollisionCountOld++;
    }

    for (const g of ev.costGroupEvaluations) {
      totalCostGroups++;
      // 同点
      if (g.tieAnalysis.exact.hasTopScoreTie) costTopTieExactCount++;
      if (g.tieAnalysis.exact.allCandidatesTied) costAllTiedExactCount++;
      if (g.tieAnalysis.exact.hasPartialTie) costPartialTieExactCount++;

      if (g.tieAnalysis.approx.hasTopScoreTie) costTopTieApproxCount++;
      if (g.tieAnalysis.approx.allCandidatesTied) costAllTiedApproxCount++;
      if (g.tieAnalysis.approx.hasPartialTie) costPartialTieApproxCount++;

      // 実選択結合
      if (g.isGroupChosen) {
        costActualChosenGroupCount++;
        if (g.isGroupTieBreakChosen) costActualChosenTieBreakCount++;
      }

      // ペア特徴量
      for (const p of g.pairComparisons) {
        costTotalPairs++;
        if (p.baseEqual !== undefined) {
          costPairBaseAvailCount++;
          if (p.baseEqual) costPairBaseEqualCount++;
        }
        if (p.tacticalEqual !== undefined) {
          costPairTacAvailCount++;
          if (p.tacticalEqual) costPairTacEqualCount++;
        }
        if (p.baseEqual !== undefined && p.tacticalEqual !== undefined) {
          costPairBothAvailCount++;
          if (p.completeEqual) costPairCompleteEqualCount++;
        }
      }
      if (g.allPairsCompleteColliding !== undefined) {
        costCompleteGroupsEvaluated++;
        if (g.allPairsCompleteColliding) costAllPairsCompleteCollidingGroups++;
      }

      costScoreMarginSum += g.scoreMargin;
      costScoreRangeSum += g.scoreRange;

      // 互換用
      if (g.hasScoreTie) costScoreTieCountOld++;
      if (g.isTieBreakChosen) costTieBreakCountOld++;
      if (g.isBaseFeatureColliding) costBaseCollisionCountOld++;
    }
  }

  const calcRate = (cnt: number, total: number) => (total > 0 ? Number((cnt / total).toFixed(4)) : 0);
  const calcOptionalRate = (cnt: number, availTotal: number) =>
    availTotal > 0 ? Number((cnt / availTotal).toFixed(4)) : undefined;

  // --- Work 5-4C R3.1 実対戦選択のみの集計 ---
  // 当事者Policyとして実対戦の意思決定を行ったレコードのみを対象
  const actualMatchRecords = records.filter(
    (r) =>
      r.actualActingPolicyName === policyName ||
      r.policyEvaluations[policyName]?.actualChoice?.choiceOrigin === "ACTUAL_MATCH_CHOICE"
  );
  const actualDecisionsCount = actualMatchRecords.length;

  let actualKeyCardEvaluatedGroups = 0;
  let actualKeyCardChosenGroupCount = 0;
  let actualKeyCardChosenTieBreakCount = 0;

  let actualCostEvaluatedGroups = 0;
  let actualCostChosenGroupCount = 0;
  let actualCostChosenTieBreakCount = 0;

  for (const rec of actualMatchRecords) {
    const ev = rec.policyEvaluations[policyName];
    if (!ev) continue;

    for (const g of ev.keyCardGroupEvaluations) {
      actualKeyCardEvaluatedGroups++;
      if (g.isGroupChosen) {
        actualKeyCardChosenGroupCount++;
        if (g.isGroupTieBreakChosen) actualKeyCardChosenTieBreakCount++;
      }
    }

    for (const g of ev.costGroupEvaluations) {
      actualCostEvaluatedGroups++;
      if (g.isGroupChosen) {
        actualCostChosenGroupCount++;
        if (g.isGroupTieBreakChosen) actualCostChosenTieBreakCount++;
      }
    }
  }

  const actualMatch: ActualMatchPolicyMetrics = {
    decisionsCount: actualDecisionsCount,
    keyCard: {
      evaluatedGroupsCount: actualKeyCardEvaluatedGroups,
      chosenGroupCount: actualKeyCardChosenGroupCount,
      chosenGroupRate: calcRate(actualKeyCardChosenGroupCount, actualKeyCardEvaluatedGroups),
      chosenTieBreakCount: actualKeyCardChosenTieBreakCount,
      chosenTieBreakRate: calcRate(actualKeyCardChosenTieBreakCount, actualKeyCardChosenGroupCount),
    },
    cost: {
      evaluatedGroupsCount: actualCostEvaluatedGroups,
      chosenGroupCount: actualCostChosenGroupCount,
      chosenGroupRate: calcRate(actualCostChosenGroupCount, actualCostEvaluatedGroups),
      chosenTieBreakCount: actualCostChosenTieBreakCount,
      chosenTieBreakRate: calcRate(actualCostChosenTieBreakCount, actualCostChosenGroupCount),
    },
  };

  const shadowEvaluation: ShadowEvaluationPolicyMetrics = {
    decisionsCount: records.length,
    keyCard: {
      evaluatedGroupsCount: totalKeyCardGroups,
      topTieExactCount: keyCardTopTieExactCount,
      topTieExactRate: calcRate(keyCardTopTieExactCount, totalKeyCardGroups),
      allTiedExactCount: keyCardAllTiedExactCount,
      allTiedExactRate: calcRate(keyCardAllTiedExactCount, totalKeyCardGroups),
      partialTieExactCount: keyCardPartialTieExactCount,
      partialTieExactRate: calcRate(keyCardPartialTieExactCount, totalKeyCardGroups),
      topTieApproxCount: keyCardTopTieApproxCount,
      topTieApproxRate: calcRate(keyCardTopTieApproxCount, totalKeyCardGroups),
      allTiedApproxCount: keyCardAllTiedApproxCount,
      allTiedApproxRate: calcRate(keyCardAllTiedApproxCount, totalKeyCardGroups),
      partialTieApproxCount: keyCardPartialTieApproxCount,
      partialTieApproxRate: calcRate(keyCardPartialTieApproxCount, totalKeyCardGroups),
      tieBreakChosenCount: keyCardActualChosenTieBreakCount,
      tieBreakChosenRate: calcRate(keyCardActualChosenTieBreakCount, keyCardActualChosenGroupCount),
      totalPairsEvaluated: keyCardTotalPairs,
      pairCompleteCollisionCount: keyCardPairCompleteEqualCount,
      pairCompleteCollisionRate: calcOptionalRate(keyCardPairCompleteEqualCount, keyCardPairBothAvailCount),
      allPairsCompleteCollidingGroupCount: keyCardAllPairsCompleteCollidingGroups,
      allPairsCompleteCollidingGroupRate: calcOptionalRate(
        keyCardAllPairsCompleteCollidingGroups,
        keyCardCompleteGroupsEvaluated
      ),
      avgScoreMargin: totalKeyCardGroups > 0 ? Number((keyCardScoreMarginSum / totalKeyCardGroups).toFixed(4)) : 0,
      avgScoreRange: totalKeyCardGroups > 0 ? Number((keyCardScoreRangeSum / totalKeyCardGroups).toFixed(4)) : 0,
    },
    cost: {
      evaluatedGroupsCount: totalCostGroups,
      topTieExactCount: costTopTieExactCount,
      topTieExactRate: calcRate(costTopTieExactCount, totalCostGroups),
      allTiedExactCount: costAllTiedExactCount,
      allTiedExactRate: calcRate(costAllTiedExactCount, totalCostGroups),
      partialTieExactCount: costPartialTieExactCount,
      partialTieExactRate: calcRate(costPartialTieExactCount, totalCostGroups),
      topTieApproxCount: costTopTieApproxCount,
      topTieApproxRate: calcRate(costTopTieApproxCount, totalCostGroups),
      allTiedApproxCount: costAllTiedApproxCount,
      allTiedApproxRate: calcRate(costAllTiedApproxCount, totalCostGroups),
      partialTieApproxCount: costPartialTieApproxCount,
      partialTieApproxRate: calcRate(costPartialTieApproxCount, totalCostGroups),
      tieBreakChosenCount: costActualChosenTieBreakCount,
      tieBreakChosenRate: calcRate(costActualChosenTieBreakCount, costActualChosenGroupCount),
      totalPairsEvaluated: costTotalPairs,
      pairCompleteCollisionCount: costPairCompleteEqualCount,
      pairCompleteCollisionRate: calcOptionalRate(costPairCompleteEqualCount, costPairBothAvailCount),
      allPairsCompleteCollidingGroupCount: costAllPairsCompleteCollidingGroups,
      allPairsCompleteCollidingGroupRate: calcOptionalRate(
        costAllPairsCompleteCollidingGroups,
        costCompleteGroupsEvaluated
      ),
      avgScoreMargin: totalCostGroups > 0 ? Number((costScoreMarginSum / totalCostGroups).toFixed(4)) : 0,
      avgScoreRange: totalCostGroups > 0 ? Number((costScoreRangeSum / totalCostGroups).toFixed(4)) : 0,
    },
  };

  return {
    policyName,

    // R3.1 完全分離集計
    actualMatch,
    shadowEvaluation,

    // キーカード群
    totalKeyCardGroupsEvaluated: totalKeyCardGroups,
    keyCardTopTieExactCount,
    keyCardTopTieExactRate: calcRate(keyCardTopTieExactCount, totalKeyCardGroups),
    keyCardAllTiedExactCount,
    keyCardAllTiedExactRate: calcRate(keyCardAllTiedExactCount, totalKeyCardGroups),
    keyCardPartialTieExactCount,
    keyCardPartialTieExactRate: calcRate(keyCardPartialTieExactCount, totalKeyCardGroups),

    keyCardTopTieApproxCount,
    keyCardTopTieApproxRate: calcRate(keyCardTopTieApproxCount, totalKeyCardGroups),
    keyCardAllTiedApproxCount,
    keyCardAllTiedApproxRate: calcRate(keyCardAllTiedApproxCount, totalKeyCardGroups),
    keyCardPartialTieApproxCount,
    keyCardPartialTieApproxRate: calcRate(keyCardPartialTieApproxCount, totalKeyCardGroups),

    keyCardActualChosenGroupCount,
    keyCardActualChosenGroupRate: calcRate(keyCardActualChosenGroupCount, totalKeyCardGroups),
    keyCardActualChosenTieBreakCount,
    keyCardActualChosenTieBreakRate: calcRate(keyCardActualChosenTieBreakCount, keyCardActualChosenGroupCount),

    keyCardTotalPairsEvaluated: keyCardTotalPairs,
    keyCardPairBaseCollisionCount: keyCardPairBaseEqualCount,
    keyCardPairBaseCollisionRate: calcOptionalRate(keyCardPairBaseEqualCount, keyCardPairBaseAvailCount),
    keyCardPairTacticalCollisionCount: keyCardPairTacEqualCount,
    keyCardPairTacticalCollisionRate: calcOptionalRate(keyCardPairTacEqualCount, keyCardPairTacAvailCount),
    keyCardPairCompleteCollisionCount: keyCardPairCompleteEqualCount,
    keyCardPairCompleteCollisionRate: calcOptionalRate(keyCardPairCompleteEqualCount, keyCardPairBothAvailCount),
    keyCardAllPairsCompleteCollidingGroupCount: keyCardAllPairsCompleteCollidingGroups,
    keyCardAllPairsCompleteCollidingGroupRate: calcOptionalRate(
      keyCardAllPairsCompleteCollidingGroups,
      keyCardCompleteGroupsEvaluated
    ),

    keyCardAvgScoreMargin: totalKeyCardGroups > 0 ? Number((keyCardScoreMarginSum / totalKeyCardGroups).toFixed(4)) : 0,
    keyCardAvgScoreRange: totalKeyCardGroups > 0 ? Number((keyCardScoreRangeSum / totalKeyCardGroups).toFixed(4)) : 0,

    // コスト群
    totalCostGroupsEvaluated: totalCostGroups,
    costTopTieExactCount,
    costTopTieExactRate: calcRate(costTopTieExactCount, totalCostGroups),
    costAllTiedExactCount,
    costAllTiedExactRate: calcRate(costAllTiedExactCount, totalCostGroups),
    costPartialTieExactCount,
    costPartialTieExactRate: calcRate(costPartialTieExactCount, totalCostGroups),

    costTopTieApproxCount,
    costTopTieApproxRate: calcRate(costTopTieApproxCount, totalCostGroups),
    costAllTiedApproxCount,
    costAllTiedApproxRate: calcRate(costAllTiedApproxCount, totalCostGroups),
    costPartialTieApproxCount,
    costPartialTieApproxRate: calcRate(costPartialTieApproxCount, totalCostGroups),

    costActualChosenGroupCount,
    costActualChosenGroupRate: calcRate(costActualChosenGroupCount, totalCostGroups),
    costActualChosenTieBreakCount,
    costActualChosenTieBreakRate: calcRate(costActualChosenTieBreakCount, costActualChosenGroupCount),

    costTotalPairsEvaluated: costTotalPairs,
    costPairBaseCollisionCount: costPairBaseEqualCount,
    costPairBaseCollisionRate: calcOptionalRate(costPairBaseEqualCount, costPairBaseAvailCount),
    costPairTacticalCollisionCount: costPairTacEqualCount,
    costPairTacticalCollisionRate: calcOptionalRate(costPairTacEqualCount, costPairTacAvailCount),
    costPairCompleteCollisionCount: costPairCompleteEqualCount,
    costPairCompleteCollisionRate: calcOptionalRate(costPairCompleteEqualCount, costPairBothAvailCount),
    costAllPairsCompleteCollidingGroupCount: costAllPairsCompleteCollidingGroups,
    costAllPairsCompleteCollidingGroupRate: calcOptionalRate(
      costAllPairsCompleteCollidingGroups,
      costCompleteGroupsEvaluated
    ),

    costAvgScoreMargin: totalCostGroups > 0 ? Number((costScoreMarginSum / totalCostGroups).toFixed(4)) : 0,
    costAvgScoreRange: totalCostGroups > 0 ? Number((costScoreRangeSum / totalCostGroups).toFixed(4)) : 0,

    // 互換旧指標
    keyCardScoreTieCount: keyCardScoreTieCountOld,
    keyCardScoreTieRate: calcRate(keyCardScoreTieCountOld, totalKeyCardGroups),
    keyCardTieBreakCount: keyCardTieBreakCountOld,
    keyCardTieBreakRate: calcRate(keyCardTieBreakCountOld, totalKeyCardGroups),
    keyCardBaseFeatureCollisionCount: keyCardBaseCollisionCountOld,
    keyCardBaseFeatureCollisionRate: calcRate(keyCardBaseCollisionCountOld, totalKeyCardGroups),
    keyCardTacticalFeatureCollisionCount: keyCardTacCollisionCountOld,
    keyCardTacticalFeatureCollisionRate: calcRate(keyCardTacCollisionCountOld, totalKeyCardGroups),
    keyCardCompleteCollisionCount: keyCardCompleteCollisionCountOld,
    keyCardCompleteCollisionRate: calcRate(keyCardCompleteCollisionCountOld, totalKeyCardGroups),

    costScoreTieCount: costScoreTieCountOld,
    costScoreTieRate: calcRate(costScoreTieCountOld, totalCostGroups),
    costTieBreakCount: costTieBreakCountOld,
    costTieBreakRate: calcRate(costTieBreakCountOld, totalCostGroups),
    costBaseFeatureCollisionCount: costBaseCollisionCountOld,
    costBaseFeatureCollisionRate: calcRate(costBaseCollisionCountOld, totalCostGroups),
  };
}

// =============================================================================
// 8. スコア寄与度分解ヘルパー (修正A・修正B)
// =============================================================================

export interface FeatureDiffExplanation {
  readonly featureKey: string;
  readonly featureName: string;
  readonly featureType: "linear" | "interaction";
  readonly weight: number;
  readonly valueA: number;
  readonly valueB: number;
  readonly valueDiff: number;
  readonly contributionA: number;
  readonly contributionB: number;
  readonly contributionDiff: number;
}

export interface ScoreDifferenceExplanationResult {
  readonly patternRefA: number;
  readonly patternRefB: number;
  readonly scoreA: number;
  readonly scoreB: number;
  readonly scoreDiff: number;
  readonly sumContributionDiff: number;
  readonly isMathematicallyConsistent: boolean;
  readonly topContributingFeatureDiffs: readonly FeatureDiffExplanation[];
  readonly allFeatureDiffs: readonly FeatureDiffExplanation[];
}

export function explainScoreDifferenceBetweenPatterns(
  request: Readonly<DecisionRequest>,
  dna: any,
  patternRefA: number,
  patternRefB: number
): ScoreDifferenceExplanationResult {
  const encoded = DecisionFeatureEncoder.encode(request);

  // 1. パターンの存在検証 (修正A: パターンが存在しない場合は例外送出)
  const patA = encoded.patterns.find((p) => p.patternRef === patternRefA);
  const patB = encoded.patterns.find((p) => p.patternRef === patternRefB);

  if (!patA || !patB) {
    throw new Error(
      `[PATTERN_NOT_FOUND] 指定された patternRef が存在しません: patternRefA=${patternRefA} (${
        patA ? "存在" : "不在"
      }), patternRefB=${patternRefB} (${patB ? "存在" : "不在"})`
    );
  }

  // 2. GenomeScorer による詳細説明の生成 (各 patternRef を指定)
  const explanationsA = GenomeScorer.explainScore(encoded, dna, patternRefA);
  const explanationsB = GenomeScorer.explainScore(encoded, dna, patternRefB);
  const expA = explanationsA.find((e) => e.patternRef === patternRefA);
  const expB = explanationsB.find((e) => e.patternRef === patternRefB);

  if (!expA || !expB) {
    throw new Error(
      `[EXPLANATION_FAILED] patternRefA (${patternRefA}) または patternRefB (${patternRefB}) のスコア説明生成に失敗しました`
    );
  }

  // 3. 非有限スコア検証 (修正A: NaN / Infinity 等の異常値を拒絶)
  if (!Number.isFinite(expA.totalScore) || !Number.isFinite(expB.totalScore)) {
    throw new Error(
      `[NON_FINITE_SCORE] 非有限スコアが検出されました: scoreA=${expA.totalScore}, scoreB=${expB.totalScore}`
    );
  }

  // 4. 正規IDによる特徴量マップ構築 (修正A: 配列インデックスではなく正規IDで突合)
  const linearKey = (idx: number) => `lin:${idx}`;
  const interactionKey = (cIdx: number, pIdx: number) => `int:${cIdx}:${pIdx}`;

  const mapA = new Map<string, { type: "linear" | "interaction"; name: string; weight: number; val: number; contrib: number }>();
  const mapB = new Map<string, { type: "linear" | "interaction"; name: string; weight: number; val: number; contrib: number }>();

  // patternRefA の登録と重複キー検証
  for (const l of expA.linearContributions) {
    const k = linearKey(l.index);
    if (mapA.has(k)) {
      throw new Error(`[DUPLICATE_FEATURE_KEY] patternRefA (${patternRefA}) 内で重複キーを検出しました: ${k}`);
    }
    mapA.set(k, { type: "linear", name: l.name, weight: l.weight, val: l.value, contrib: l.contribution });
  }
  for (const i of expA.interactionContributions) {
    const k = interactionKey(i.contextIndex, i.patternIndex);
    if (mapA.has(k)) {
      throw new Error(`[DUPLICATE_FEATURE_KEY] patternRefA (${patternRefA}) 内で重複キーを検出しました: ${k}`);
    }
    mapA.set(k, { type: "interaction", name: `${i.contextName} x ${i.patternName}`, weight: i.weight, val: i.patternValue, contrib: i.contribution });
  }

  // patternRefB の登録と重複キー検証
  for (const l of expB.linearContributions) {
    const k = linearKey(l.index);
    if (mapB.has(k)) {
      throw new Error(`[DUPLICATE_FEATURE_KEY] patternRefB (${patternRefB}) 内で重複キーを検出しました: ${k}`);
    }
    mapB.set(k, { type: "linear", name: l.name, weight: l.weight, val: l.value, contrib: l.contribution });
  }
  for (const i of expB.interactionContributions) {
    const k = interactionKey(i.contextIndex, i.patternIndex);
    if (mapB.has(k)) {
      throw new Error(`[DUPLICATE_FEATURE_KEY] patternRefB (${patternRefB}) 内で重複キーを検出しました: ${k}`);
    }
    mapB.set(k, { type: "interaction", name: `${i.contextName} x ${i.patternName}`, weight: i.weight, val: i.patternValue, contrib: i.contribution });
  }

  // 5. 元の入力特徴量ベクトルから生値を参照 (修正A: 片側未登録でも正しい特徴量値を反映)
  const contextValues = encoded.context.values;
  const pDim = dna.patternDimension;
  const pWeights = dna.patternWeights;
  const cpWeights = dna.contextPatternWeights;

  const allKeys = new Set<string>([...mapA.keys(), ...mapB.keys()]);
  const diffs: FeatureDiffExplanation[] = [];
  let sumContribDiff = 0;

  for (const k of allKeys) {
    let featureName: string;
    let featureType: "linear" | "interaction";
    let weight: number;
    let valA: number;
    let valB: number;
    let contribA: number;
    let contribB: number;

    if (k.startsWith("lin:")) {
      const j = Number(k.split(":")[1]);
      featureType = "linear";
      featureName = PATTERN_FEATURE_NAMES[j] ?? `pat_${j}`;
      weight = pWeights[j] ?? 0;
      valA = patA.values[j] ?? 0;
      valB = patB.values[j] ?? 0;
      contribA = mapA.get(k)?.contrib ?? (weight * valA);
      contribB = mapB.get(k)?.contrib ?? (weight * valB);
    } else {
      const [, cStr, pStr] = k.split(":");
      const cIdx = Number(cStr);
      const pIdx = Number(pStr);
      featureType = "interaction";
      const cName = CONTEXT_FEATURE_NAMES[cIdx] ?? `ctx_${cIdx}`;
      const pName = PATTERN_FEATURE_NAMES[pIdx] ?? `pat_${pIdx}`;
      featureName = `${cName} x ${pName}`;
      weight = cpWeights[cIdx * pDim + pIdx] ?? 0;
      const cVal = contextValues[cIdx] ?? 0;
      valA = patA.values[pIdx] ?? 0;
      valB = patB.values[pIdx] ?? 0;
      contribA = mapA.get(k)?.contrib ?? (weight * cVal * valA);
      contribB = mapB.get(k)?.contrib ?? (weight * cVal * valB);
    }

    // 修正B: スコア差の符号整合性 (scoreDiff = scoreA - scoreB, contribDiff = contribA - contribB)
    const contribDiff = contribA - contribB;
    const valDiff = valA - valB;

    sumContribDiff += contribDiff;

    if (Math.abs(contribDiff) > 1e-9 || Math.abs(valDiff) > 1e-9) {
      diffs.push({
        featureKey: k,
        featureName,
        featureType,
        weight,
        valueA: valA,
        valueB: valB,
        valueDiff: valDiff,
        contributionA: contribA,
        contributionB: contribB,
        contributionDiff: contribDiff,
      });
    }
  }

  // 6. 数理的一致性の検証 (修正A: |scoreDiff - sumContribDiff| < 1e-9)
  const scoreDiff = expA.totalScore - expB.totalScore;
  const EPSILON = 1e-9;
  const isMathematicallyConsistent = Math.abs(scoreDiff - sumContribDiff) < EPSILON;

  if (!isMathematicallyConsistent) {
    throw new Error(
      `[MATH_INCONSISTENCY] scoreDiff (${scoreDiff}) と sumContribDiff (${sumContribDiff}) の差が許容誤差 1e-9 を超えています: 差=${Math.abs(
        scoreDiff - sumContribDiff
      )}`
    );
  }

  // 寄与度差分の絶対値降順ソート
  diffs.sort((a, b) => Math.abs(b.contributionDiff) - Math.abs(a.contributionDiff));

  return {
    patternRefA,
    patternRefB,
    scoreA: expA.totalScore,
    scoreB: expB.totalScore,
    scoreDiff,
    sumContributionDiff: sumContribDiff,
    isMathematicallyConsistent,
    topContributingFeatureDiffs: Object.freeze(diffs.slice(0, 10)),
    allFeatureDiffs: Object.freeze(diffs),
  };
}
