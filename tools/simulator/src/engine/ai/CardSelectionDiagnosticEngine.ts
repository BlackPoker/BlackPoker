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
import { GenomePolicy } from "./GenomePolicy.js";
import { DecisionFeatureEncoder } from "./DecisionFeatureEncoder.js";
import { GenomeScorer } from "./GenomeScorer.js";

// =============================================================================
// 1. データ構造・インターフェース
// =============================================================================

export interface ResolvedPatternInfo {
  readonly patternRef: number;
  readonly patternId: string;
  readonly kind: string;
  readonly actionId?: string;
  readonly actionName?: string;
  readonly keyCardIds: readonly string[];
  readonly keyCardDisplayCodes: readonly string[];
  readonly costPayment: {
    readonly discardedCardIds: readonly string[];
    readonly drivenBulwarkUnitIds: readonly string[];
    readonly sacrificedUnitIds: readonly string[];
    readonly lifeCount: number;
    readonly summary?: string;
  };
  readonly targetSignature: string;
  readonly effectSignature: string;
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
  readonly patternRefs: readonly number[];
  readonly candidateCount: number;
}

export interface PureCostPaymentVarianceGroup {
  readonly groupId: string;
  readonly actionId: string;
  readonly keyCardSignature: string;
  readonly targetSignature: string;
  readonly effectSignature: string;
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

export interface PolicyGroupEvaluation {
  readonly policyName: string;
  readonly groupId: string;
  readonly candidateScores: readonly EvaluatedCandidateScore[];
  readonly bestPatternRef: number;
  readonly bestScore: number;
  readonly secondBestScore: number;
  readonly scoreMargin: number;
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
        readonly scoreMargin: number;
        readonly isScoreTie: boolean;
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
        readonly scoreMargin: number;
        readonly isScoreTie: boolean;
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
        readonly scoreMargin: number;
        readonly isScoreTie: boolean;
      }>;
    }[];
  };
}

// =============================================================================
// 2. 合法手の精密分類ロジック (診断A)
// =============================================================================

export function resolvePatternInfo(
  pattern: LegalPattern,
  patternRef: number,
  catalog: DecisionCatalog
): ResolvedPatternInfo {
  const act = pattern.actionSelectionRef !== undefined ? catalog.actions[pattern.actionSelectionRef] : undefined;
  const cardSel = pattern.keyCardSelectionRef !== undefined ? catalog.cardSelections[pattern.keyCardSelectionRef] : undefined;
  const cost = pattern.costPaymentRef !== undefined ? catalog.costPayments[pattern.costPaymentRef] : undefined;
  const target = pattern.targetSelectionRef !== undefined ? catalog.targetSelections[pattern.targetSelectionRef] : undefined;
  const effect = pattern.effectSelectionRef !== undefined ? catalog.effectSelections[pattern.effectSelectionRef] : undefined;

  const keyCardIds = Object.freeze([...(cardSel?.cardIds ?? [])]);
  const keyCardDisplayCodes = Object.freeze([...(cardSel?.displayCodes ?? [])]);

  const discardedCardIds = Object.freeze([...(cost?.discardedCardIds ?? [])].sort());
  const drivenBulwarkUnitIds = Object.freeze([...(cost?.drivenBulwarkUnitIds ?? [])].sort());
  const sacrificedUnitIds = Object.freeze([...(cost?.sacrificedUnitIds ?? [])].sort());
  const lifeCount = cost?.lifeCount ?? 0;

  const actionId = act?.actionId ?? (pattern.kind === "PASS" ? "PASS" : "UNKNOWN_ACTION");
  const targetSignature = target
    ? `${target.targetType}:${target.targetPlayerKey || ""}:${target.targetUnitId || ""}:${target.targetRequestId || ""}`
    : "none";
  const effectSignature = effect ? (effect.summary || effect.selectionType || "effect") : "none";
  const costSignature = `D:[${discardedCardIds.join(",")}]_B:[${drivenBulwarkUnitIds.join(",")}]_S:[${sacrificedUnitIds.join(",")}]_L:${lifeCount}`;
  const keyCardSignature = `K:[${[...keyCardIds].sort().join(",")}]`;

  // キーカードだけが異なるグループ化用シグネチャ (アクション + 対象 + コスト + 効果)
  const conditionSignatureWithoutKeyCard = `ACT:${actionId}|TGT:${targetSignature}|CST:${costSignature}|EFF:${effectSignature}`;

  // コストだけが異なるグループ化用シグネチャ (アクション + キーカード + 対象 + 効果)
  const conditionSignatureWithoutCost = `ACT:${actionId}|KEY:${keyCardSignature}|TGT:${targetSignature}|EFF:${effectSignature}`;

  return {
    patternRef,
    patternId: pattern.patternId,
    kind: pattern.kind,
    actionId: act?.actionId,
    actionName: act?.actionName,
    keyCardIds,
    keyCardDisplayCodes,
    costPayment: {
      discardedCardIds,
      drivenBulwarkUnitIds,
      sacrificedUnitIds,
      lifeCount,
      summary: cost?.summary,
    },
    targetSignature,
    effectSignature,
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
        keyCardSignature: `K:[${first.keyCardIds.slice().sort().join(",")}]`,
        targetSignature: first.targetSignature,
        effectSignature: first.effectSignature,
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
// 3. 特徴量・スコア識別能力の評価 (診断B)
// =============================================================================

export function evaluatePolicyOnDecisionRequest(
  policy: DecisionPolicy,
  policyName: string,
  request: Readonly<DecisionRequest>,
  resolvedPatterns: readonly ResolvedPatternInfo[]
): {
  candidateScores: readonly EvaluatedCandidateScore[];
  bestPatternRef: number;
} {
  const patterns = request.patterns;
  const encoded = DecisionFeatureEncoder.encode(request);

  if (policy instanceof Gen9LearnableTacticalPolicy) {
    const evalRes = policy.evaluatePatterns(request);
    const candidateScores: EvaluatedCandidateScore[] = evalRes.scoredPatterns.map((d, i) => ({
      patternRef: d.patternRef,
      baseScore: d.baseScore,
      tacticalAdjustment: d.tacticalAdjustment,
      finalScore: d.finalScore,
      tacticalFeatures: d.tacticalFeatures ? Object.freeze(Array.from(d.tacticalFeatures)) : undefined,
      baseFeatures: encoded.patterns[i] ? Object.freeze(Array.from(encoded.patterns[i].values)) : undefined,
    }));
    return { candidateScores: Object.freeze(candidateScores), bestPatternRef: evalRes.bestPatternRef };
  }

  if (policy instanceof GenomePolicy) {
    // Gen 8 (GenomePolicy)
    const scored = GenomeScorer.score(encoded, (policy as any).dna);
    let bestScore = -Infinity;
    let bestPatternRef = scored.length > 0 ? scored[0].patternRef : 0;
    for (const p of scored) {
      if (p.score > bestScore) {
        bestScore = p.score;
        bestPatternRef = p.patternRef;
      }
    }
    const candidateScores: EvaluatedCandidateScore[] = scored.map((s, i) => ({
      patternRef: s.patternRef,
      baseScore: s.score,
      tacticalAdjustment: 0,
      finalScore: s.score,
      baseFeatures: encoded.patterns[i] ? Object.freeze(Array.from(encoded.patterns[i].values)) : undefined,
    }));
    return { candidateScores: Object.freeze(candidateScores), bestPatternRef };
  }

  // 汎用 Policy (choose を呼んで選択手のみ取得)
  const choice = policy.choose(request);
  const candidateScores: EvaluatedCandidateScore[] = patterns.map((_, i) => ({
    patternRef: i,
    baseScore: 0,
    tacticalAdjustment: 0,
    finalScore: i === choice.selectedPatternRef ? 1 : 0,
  }));
  return { candidateScores: Object.freeze(candidateScores), bestPatternRef: choice.selectedPatternRef };
}

export function evaluateGroupDistinguishability(
  policyName: string,
  group: { groupId: string; patternRefs: readonly number[] },
  candidateScores: readonly EvaluatedCandidateScore[]
): PolicyGroupEvaluation {
  const groupScores = group.patternRefs.map((ref) => candidateScores[ref]);

  // 最高スコアと次点スコアの探索
  let sortedScores = [...groupScores].sort((a, b) => b.finalScore - a.finalScore);
  const bestScore = sortedScores[0].finalScore;
  const secondBestScore = sortedScores.length > 1 ? sortedScores[1].finalScore : bestScore;
  const scoreMargin = Number((bestScore - secondBestScore).toFixed(6));

  // 同点候補の検出 (誤差 1e-9 以内)
  const EPSILON = 1e-9;
  const tieCandidates = groupScores.filter((s) => Math.abs(s.finalScore - bestScore) < EPSILON);
  const hasScoreTie = tieCandidates.length > 1;

  // 最高スコア候補の中から最小 index が選ばれているか (タイブレーク列挙順依存)
  const minIndexAmongTies = Math.min(...tieCandidates.map((c) => c.patternRef));
  // グループ内で最良と判定された候補
  const bestRef = sortedScores[0].patternRef;
  const isTieBreakChosen = hasScoreTie && (bestRef === minIndexAmongTies);

  // 特徴量衝突の検証 (候補ペア間でベース特徴量・戦術特徴量が完全一致するか)
  let isBaseFeatureColliding = false;
  let isTacticalFeatureColliding = false;
  let isCompleteFeatureColliding = false;

  for (let i = 0; i < groupScores.length; i++) {
    for (let j = i + 1; j < groupScores.length; j++) {
      const a = groupScores[i];
      const b = groupScores[j];

      // ベース特徴量の比較
      if (a.baseFeatures && b.baseFeatures && a.baseFeatures.length === b.baseFeatures.length) {
        let baseMaxDiff = 0;
        for (let k = 0; k < a.baseFeatures.length; k++) {
          const diff = Math.abs(a.baseFeatures[k] - b.baseFeatures[k]);
          if (diff > baseMaxDiff) baseMaxDiff = diff;
        }
        if (baseMaxDiff < EPSILON) {
          isBaseFeatureColliding = true;
        }
      }

      // 戦術特徴量の比較
      if (a.tacticalFeatures && b.tacticalFeatures && a.tacticalFeatures.length === b.tacticalFeatures.length) {
        let tacMaxDiff = 0;
        for (let k = 0; k < a.tacticalFeatures.length; k++) {
          const diff = Math.abs(a.tacticalFeatures[k] - b.tacticalFeatures[k]);
          if (diff > tacMaxDiff) tacMaxDiff = diff;
        }
        if (tacMaxDiff < EPSILON) {
          isTacticalFeatureColliding = true;
        }
      }

      if (isBaseFeatureColliding && isTacticalFeatureColliding) {
        isCompleteFeatureColliding = true;
        break;
      }
    }
    if (isCompleteFeatureColliding) break;
  }

  return {
    policyName,
    groupId: group.groupId,
    candidateScores: Object.freeze(groupScores),
    bestPatternRef: bestRef,
    bestScore,
    secondBestScore,
    scoreMargin,
    hasScoreTie,
    tieCandidatesCount: tieCandidates.length,
    isTieBreakChosen,
    isBaseFeatureColliding,
    isTacticalFeatureColliding,
    isCompleteFeatureColliding,
  };
}

// =============================================================================
// 4. 透過的観測ラッパー Policy (元Policyの選択を一切変えずにログ収集)
// =============================================================================

export class DiagnosticTransparentWrapperPolicy implements DecisionPolicy {
  public readonly descriptor: PolicyDescriptor;
  private readonly targetPolicy: DecisionPolicy;
  public readonly recordedDecisions: DecisionRequest[] = [];

  constructor(targetPolicy: DecisionPolicy) {
    this.targetPolicy = targetPolicy;
    this.descriptor = targetPolicy.descriptor;
  }

  public choose(request: Readonly<DecisionRequest>): DecisionResponse {
    // 診断用に DecisionRequest をクローン保存 (非公開情報混入なし、観測のみ)
    this.recordedDecisions.push(request);
    // 元 Policy にそのまま委譲
    return this.targetPolicy.choose(request);
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
  policies: Record<string, DecisionPolicy>
): DecisionDiagnosticRecord | null {
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
    const { candidateScores, bestPatternRef } = evaluatePolicyOnDecisionRequest(
      policy,
      pName,
      request,
      resolvedPatterns
    );

    const keyCardGroupEvaluations = pureKeyCardGroups.map((g) =>
      evaluateGroupDistinguishability(pName, g, candidateScores)
    );
    const costGroupEvaluations = pureCostGroups.map((g) =>
      evaluateGroupDistinguishability(pName, g, candidateScores)
    );

    policyEvaluations[pName] = {
      selectedPatternRef: bestPatternRef,
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
            scoreMargin: grpEval ? grpEval.scoreMargin : 0,
            isScoreTie: grpEval ? grpEval.hasScoreTie : false,
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
            scoreMargin: grpEval ? grpEval.scoreMargin : 0,
            isScoreTie: grpEval ? grpEval.hasScoreTie : false,
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
            scoreMargin: grpEval ? grpEval.scoreMargin : 0,
            isScoreTie: grpEval ? grpEval.hasScoreTie : false,
          };
        }
        return { patternRefs, costs, policyChoices };
      }),
    };
  }

  return {
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
// 7. 全体統計集計ロジック
// =============================================================================

export interface PolicyAggregateMetrics {
  readonly policyName: string;
  readonly totalKeyCardGroupsEvaluated: number;
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
  readonly keyCardAvgScoreMargin: number;

  readonly totalCostGroupsEvaluated: number;
  readonly costScoreTieCount: number;
  readonly costScoreTieRate: number;
  readonly costTieBreakCount: number;
  readonly costTieBreakRate: number;
  readonly costBaseFeatureCollisionCount: number;
  readonly costBaseFeatureCollisionRate: number;
  readonly costAvgScoreMargin: number;
}

export function computePolicyAggregateMetrics(
  policyName: string,
  records: readonly DecisionDiagnosticRecord[]
): PolicyAggregateMetrics {
  let totalKeyCardGroups = 0;
  let keyCardScoreTieCount = 0;
  let keyCardTieBreakCount = 0;
  let keyCardBaseCollisionCount = 0;
  let keyCardTacCollisionCount = 0;
  let keyCardCompleteCollisionCount = 0;
  let keyCardScoreMarginSum = 0;

  let totalCostGroups = 0;
  let costScoreTieCount = 0;
  let costTieBreakCount = 0;
  let costBaseCollisionCount = 0;
  let costScoreMarginSum = 0;

  for (const rec of records) {
    const ev = rec.policyEvaluations[policyName];
    if (!ev) continue;

    for (const g of ev.keyCardGroupEvaluations) {
      totalKeyCardGroups++;
      if (g.hasScoreTie) keyCardScoreTieCount++;
      if (g.isTieBreakChosen) keyCardTieBreakCount++;
      if (g.isBaseFeatureColliding) keyCardBaseCollisionCount++;
      if (g.isTacticalFeatureColliding) keyCardTacCollisionCount++;
      if (g.isCompleteFeatureColliding) keyCardCompleteCollisionCount++;
      keyCardScoreMarginSum += g.scoreMargin;
    }

    for (const g of ev.costGroupEvaluations) {
      totalCostGroups++;
      if (g.hasScoreTie) costScoreTieCount++;
      if (g.isTieBreakChosen) costTieBreakCount++;
      if (g.isBaseFeatureColliding) costBaseCollisionCount++;
      costScoreMarginSum += g.scoreMargin;
    }
  }

  const calcRate = (cnt: number, total: number) => (total > 0 ? Number((cnt / total).toFixed(4)) : 0);

  return {
    policyName,
    totalKeyCardGroupsEvaluated: totalKeyCardGroups,
    keyCardScoreTieCount,
    keyCardScoreTieRate: calcRate(keyCardScoreTieCount, totalKeyCardGroups),
    keyCardTieBreakCount,
    keyCardTieBreakRate: calcRate(keyCardTieBreakCount, totalKeyCardGroups),
    keyCardBaseFeatureCollisionCount: keyCardBaseCollisionCount,
    keyCardBaseFeatureCollisionRate: calcRate(keyCardBaseCollisionCount, totalKeyCardGroups),
    keyCardTacticalFeatureCollisionCount: keyCardTacCollisionCount,
    keyCardTacticalFeatureCollisionRate: calcRate(keyCardTacCollisionCount, totalKeyCardGroups),
    keyCardCompleteCollisionCount: keyCardCompleteCollisionCount,
    keyCardCompleteCollisionRate: calcRate(keyCardCompleteCollisionCount, totalKeyCardGroups),
    keyCardAvgScoreMargin: totalKeyCardGroups > 0 ? Number((keyCardScoreMarginSum / totalKeyCardGroups).toFixed(4)) : 0,

    totalCostGroupsEvaluated: totalCostGroups,
    costScoreTieCount,
    costScoreTieRate: calcRate(costScoreTieCount, totalCostGroups),
    costTieBreakCount,
    costTieBreakRate: calcRate(costTieBreakCount, totalCostGroups),
    costBaseFeatureCollisionCount: costBaseCollisionCount,
    costBaseFeatureCollisionRate: calcRate(costBaseCollisionCount, totalCostGroups),
    costAvgScoreMargin: totalCostGroups > 0 ? Number((costScoreMarginSum / totalCostGroups).toFixed(4)) : 0,
  };
}
