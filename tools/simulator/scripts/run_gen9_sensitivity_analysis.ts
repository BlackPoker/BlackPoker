/**
 * run_gen9_sensitivity_analysis.ts
 *
 * BlackPoker Simulator - Gen 9 意思決定差分・特徴量感度分析スクリプト (Work 5-3)
 *
 * 【目的】
 * Work 5-2 R2 において G1〜G3 の進化個体が G0 人手設計個体を超えなかった原因を、
 * 意思決定 (DecisionRequest) 単位および特徴量 (20次元) 単位の実測データから解明する。
 *
 * 【比較対象 Policy】
 * 1. GEN8    : Gen 8 Champion Candidate (ZERO_TACTICAL_WEIGHTS)
 * 2. R4      : Work 5-1 R4 (R4_PRESET_TACTICAL_WEIGHTS)
 * 3. G0_IND2 : Gen 9 G0 人手設計最良個体 (gen9-g0-ind2-counter-selective)
 * 4. G0_IND7 : Gen 9 G0 人手設計同率最良・G3親個体 (gen9-g0-ind7-survival-trade)
 * 5. G3_IND3 : Gen 9 G3 進化最良個体 (gen9-evolved-g3-ind3)
 *
 * 【分析内容】
 * - 未使用の診断専用 Seed (760001〜760030, 30ペア = 60試合, 座席反転) を使用。
 * - Part 1 (同一 DecisionRequest シャドウ評価):
 *   全意思決定ステップで同一の Readonly<DecisionRequest> を全 Policy に入力し、
 *   合法手数、選択手一致率/不一致率、1位と2位のスコア差 (Margin)、20次元特徴量別の活性率・寄与度、
 *   UNKNOWN / ESTIMATED 発生率、アクション種別選択傾向を計測。
 * - Part 2 (プラトー仮説の検証と原因分類):
 *   G0 と G3 の重み差が意思決定に与える影響を計測し、プラトーを仮定せず実測から各局面・各特徴量を分類。
 * - Part 3 (実対戦ロールアウトによる判断分岐と勝敗反転の追跡):
 *   同一 Seed (760001〜760030) で各 Policy を実対戦させ、判断が変わった局面と勝敗への影響を特定。
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { performance } from "perf_hooks";
import { loadRegulationCatalog } from "../src/engine/regulation/RegulationLoader.js";
import { loadRulePackageFromDirectory } from "../src/engine/rules/RuleLoader.js";
import { OfficialRegulationMatchSetup } from "../src/engine/regulation/OfficialRegulationMatchSetup.js";
import { GameSession } from "../src/engine/session/GameSession.js";
import { SimulationRunner } from "../src/engine/simulation/SimulationRunner.js";
import { DecisionPolicy, PolicyDescriptor } from "../src/engine/simulation/DecisionPolicy.js";
import { GenomePolicy } from "../src/engine/ai/GenomePolicy.js";
import { Gen9TacticalPrototypePolicy } from "../src/engine/ai/Gen9TacticalPrototypePolicy.js";
import {
  Gen9LearnableTacticalPolicy,
  TACTICAL_FEATURE_DIMENSION,
  TACTICAL_FEATURE_NAMES,
  TACTICAL_FEATURE_CATEGORY_MAP,
  ZERO_TACTICAL_WEIGHTS,
  R4_PRESET_TACTICAL_WEIGHTS,
  fromV6DNA,
  encodeTacticalPatternFeatures,
  computeStreamingBlockTacticalScore,
} from "../src/engine/ai/Gen9LearnableTacticalPolicy.js";
import { GenericTacticalEvaluator } from "../src/engine/rules/GenericTacticalEvaluator.js";
import { createGen8ChampionCandidatePolicy } from "../src/engine/ai/Gen8DNALoader.js";
import { DecisionRequest } from "../src/domain/decision/DecisionRequest.js";
import { DecisionResponse } from "../src/domain/decision/DecisionResponse.js";
import { DecisionDNA } from "../src/domain/ai/DecisionDNATypes.js";
import { DecisionDNACodec } from "../src/engine/ai/DecisionDNACodec.js";
import { DecisionFeatureEncoder } from "../src/engine/ai/DecisionFeatureEncoder.js";
import { GenomeScorer } from "../src/engine/ai/GenomeScorer.js";
import { LegalPattern } from "../src/domain/decision/LegalPattern.js";
import { UnitView } from "../src/domain/decision/PlayerObservation.js";
import { TacticalEvaluator } from "../src/domain/decision/TacticalEvaluationTypes.js";

// =============================================================================
// 1. 禁止 Seed 範囲の厳格保護
// =============================================================================
export const WORK53_FORBIDDEN_SEED_RANGES: readonly { name: string; start: number; end: number }[] = [
  { name: "Official Holdout v1", start: 95001, end: 95030 },
  { name: "Official Holdout v2", start: 250001, end: 250120 },
  { name: "Future Final Holdout", start: 350001, end: 350300 },
  { name: "Work 5-1 Benchmark Seeds", start: 500001, end: 500030 },
  { name: "Work 5-1 R2/R3 Validation Seeds", start: 600001, end: 600030 },
  { name: "Work 5-2 Baseline Seeds", start: 700001, end: 700050 },
  { name: "Work 5-2 R1 Training Seeds", start: 710001, end: 710400 },
  { name: "Work 5-2 R1 Validation Seeds", start: 720001, end: 720050 },
  { name: "Work 5-2 R2 Training Seeds", start: 730001, end: 730400 },
  { name: "Work 5-2 R2 Selection Arena Seeds", start: 740001, end: 740100 },
  { name: "Work 5-2 R2 Final Comparison Seeds", start: 750001, end: 750100 },
  { name: "Original Human Diagnostic Seed", start: 4127992094, end: 4127992094 },
];

export function assertWork53SafeSeedRange(label: string, start: number, count: number): void {
  const end = start + count - 1;
  for (const forbidden of WORK53_FORBIDDEN_SEED_RANGES) {
    const overlaps = Math.max(start, forbidden.start) <= Math.min(end, forbidden.end);
    if (overlaps) {
      throw new Error(
        `[SEED_VIOLATION] ${label} (${start}..${end}) が禁止領域 ${forbidden.name} (${forbidden.start}..${forbidden.end}) と重複しています`
      );
    }
  }
}

// =============================================================================
// 2. 比較対象 Policy の重み定義 (Work 5-2 R2 確定値)
// =============================================================================
export type PolicyKey = "GEN8" | "R4" | "G0_IND2" | "G0_IND7" | "G3_IND3";

export const POLICY_KEYS: readonly PolicyKey[] = [
  "GEN8",
  "R4",
  "G0_IND2",
  "G0_IND7",
  "G3_IND3",
];

export const G0_IND2_WEIGHTS: readonly number[] = Object.freeze([
  0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
  +2.6, +2.0, +1.1, +0.15,
  0.0, 0.0, 0.0, -0.30, 0.0, -2.5, 0.0,
  0.0, +2.0, +2.5,
]);

export const G0_IND7_WEIGHTS: readonly number[] = Object.freeze([
  -0.20, -0.05, 0.0, -0.15, 0.0, 0.0,
  +2.6, +2.0, +1.1, +0.15,
  +0.10, +0.20, +0.05, -0.38, +0.22, -3.0, -0.40,
  +0.15, +2.0, +2.5,
]);

export const G3_IND3_WEIGHTS: readonly number[] = Object.freeze([
  0.0, 0.0, 0.0, -0.0756, 0.0, -0.0132,
  +2.7222, +1.7719, +1.1, +0.0319,
  +0.10, +0.154, +0.05, -0.3243, +0.22, -3.0, -0.40,
  +0.15, +1.8984, +2.5,
]);

export const POLICY_WEIGHTS_MAP: Readonly<Record<PolicyKey, readonly number[]>> = {
  GEN8: ZERO_TACTICAL_WEIGHTS,
  R4: R4_PRESET_TACTICAL_WEIGHTS,
  G0_IND2: G0_IND2_WEIGHTS,
  G0_IND7: G0_IND7_WEIGHTS,
  G3_IND3: G3_IND3_WEIGHTS,
};

export const POLICY_DESCRIPTIONS: Readonly<Record<PolicyKey, string>> = {
  GEN8: "Gen 8 Champion Candidate (Schema v6, ZERO_TACTICAL_WEIGHTS)",
  R4: "Work 5-1 R4 (GenericTacticalEvaluator + R4_PRESET_TACTICAL_WEIGHTS)",
  G0_IND2: "Gen 9 G0人手設計最良個体 (gen9-g0-ind2-counter-selective)",
  G0_IND7: "Gen 9 G0人手設計同率最良・G3親個体 (gen9-g0-ind7-survival-trade)",
  G3_IND3: "Gen 9 G3進化最良個体 (gen9-evolved-g3-ind3)",
};

// =============================================================================
// 3. 単一 DecisionRequest に対する多 Policy 同時評価・原因分類アナライザ
// =============================================================================
export type DecisionDiffCauseCategory =
  | "INACTIVE_ALL_ZERO"
  | "ACTIVE_ZERO_WEIGHT_DELTA"
  | "SAME_CHOICE_BASE_MARGIN_DOMINATED"
  | "SAME_CHOICE_THRESHOLD_SATURATED"
  | "SAME_CHOICE_GROUP_UNIFORM_SHIFT"
  | "DECISION_CHANGED";

export interface PolicyChoiceSummary {
  readonly selectedPatternRef: number;
  readonly actionCategory: string;
  readonly top1FinalScore: number;
  readonly top2FinalScore: number;
  readonly scoreMarginTop1Top2: number;
  readonly selectedBaseScore: number;
  readonly selectedTacticalAdj: number;
}

export interface SingleDecisionSnapshot {
  readonly matchSeed: number;
  readonly seat: "p1" | "p2";
  readonly decisionIndex: number;
  readonly decisionId: string;
  readonly sourceType: string;
  readonly isStreamingBlock: boolean;
  readonly legalCount: number;
  readonly hasOppStageRequest: boolean;
  readonly oppRequestActionId?: string;
  readonly oppRequestCertainty?: "CERTAIN" | "ESTIMATED" | "UNKNOWN";
  readonly oppRequestIsGuardedOut?: boolean;
  readonly counterCancelStatusPresent?: string;
  readonly anyTacticalFeatureActive: boolean;
  readonly activeFeatureIndices: readonly number[];
  readonly groupUniformFeatureIndices: readonly number[];
  readonly baseTop1Score: number;
  readonly baseTop2Score: number;
  readonly baseScoreMargin: number;
  readonly choices: Readonly<Record<PolicyKey, PolicyChoiceSummary>>;
  readonly causeG0Ind2VsG3Ind3: DecisionDiffCauseCategory;
  readonly causeG0Ind7VsG3Ind3: DecisionDiffCauseCategory;
  readonly causeR4VsG3Ind3: DecisionDiffCauseCategory;
  readonly causeGen8VsG3Ind3: DecisionDiffCauseCategory;
}

/**
 * パターンからアクション種別ラベルを抽出（合法観測のみ使用）
 */
export function classifyPatternActionCategory(
  request: Readonly<DecisionRequest>,
  pattern: Readonly<LegalPattern> | undefined,
  isStreamingBlock: boolean,
  selectedBlockCount?: number
): string {
  if (isStreamingBlock) {
    return (selectedBlockCount ?? 0) > 0 ? "block.assign" : "block.pass";
  }
  if (!pattern) return "unknown";
  if (pattern.kind === "PASS") {
    const oppReqs = (request.observation.stageRequests ?? []).filter(
      (r) => r.controller !== request.playerId
    );
    if (oppReqs.length > 0) return "PASS(vs_opp_request)";
    return "PASS(normal)";
  }
  if (pattern.actionSelectionRef !== undefined) {
    const act = request.catalog.actions[pattern.actionSelectionRef];
    if (act?.actionId) return act.actionId;
  }
  if (pattern.keyUnitSelectionRef !== undefined) {
    const uSel = request.catalog.unitSelections[pattern.keyUnitSelectionRef];
    const items = (uSel as any)?.items ?? [];
    const hasBlocker = items.some((it: any) => (it.selectedUnitIds?.length ?? 0) > 0);
    return hasBlocker ? "block.assign" : "block.pass";
  }
  return `PATTERN_${pattern.kind}`;
}

/**
 * 2つの重みベクトル wA, wB 間で選択手が変化したか、変化しなかった原因が何かを厳密分類
 */
export function classifyPairwiseDecisionBehavior(params: {
  anyTacticalFeatureActive: boolean;
  patternFeatures: readonly Float64Array[];
  baseScores: readonly number[];
  weightsA: readonly number[];
  weightsB: readonly number[];
  choiceA: PolicyChoiceSummary;
  choiceB: PolicyChoiceSummary;
  groupUniformSet: ReadonlySet<number>;
}): DecisionDiffCauseCategory {
  const {
    anyTacticalFeatureActive,
    patternFeatures,
    baseScores,
    weightsA,
    weightsB,
    choiceA,
    choiceB,
    groupUniformSet,
  } = params;

  if (choiceA.selectedPatternRef !== choiceB.selectedPatternRef) {
    return "DECISION_CHANGED";
  }

  if (!anyTacticalFeatureActive) {
    return "INACTIVE_ALL_ZERO";
  }

  // 各パターンにおける (wB - wA) · f の差分を計算
  let maxAbsDelta = 0;
  const activeDiffIndices = new Set<number>();
  for (let i = 0; i < patternFeatures.length; i++) {
    const f = patternFeatures[i];
    let delta = 0;
    for (let k = 0; k < TACTICAL_FEATURE_DIMENSION; k++) {
      if (f[k] !== 0) {
        const dw = weightsB[k] - weightsA[k];
        if (Math.abs(dw) > 1e-9) {
          activeDiffIndices.add(k);
          delta += dw * f[k];
        }
      }
    }
    if (Math.abs(delta) > maxAbsDelta) {
      maxAbsDelta = Math.abs(delta);
    }
  }

  if (maxAbsDelta <= 1e-9) {
    return "ACTIVE_ZERO_WEIGHT_DELTA";
  }

  // 差分が発生した特徴量がすべて同一アクション内一律シフト (groupUniform) であり、かつ選択手が変わらなかった場合
  const allDiffAreGroupUniform =
    activeDiffIndices.size > 0 &&
    Array.from(activeDiffIndices).every((idx) => groupUniformSet.has(idx));

  // baseScore の 1位と choiceA(=choiceB) が一致しているか確認
  let baseBestRef = 0;
  let baseBestScore = -Infinity;
  for (let i = 0; i < baseScores.length; i++) {
    if (baseScores[i] > baseBestScore) {
      baseBestScore = baseScores[i];
      baseBestRef = i;
    }
  }

  // もし戦術重みによって baseBestRef 以外の手 (例: Counter) に既に両方とも切り替わっているなら「閾値飽和 (THRESHOLD_SATURATED)」
  if (choiceA.selectedPatternRef !== baseBestRef) {
    return "SAME_CHOICE_THRESHOLD_SATURATED";
  }

  // 両方とも baseBestRef のままであり、かつ両方とも選択手に正の戦術加点を与えてさらにリードを広げている場合も「閾値飽和」
  if (choiceA.selectedTacticalAdj > 0 && choiceB.selectedTacticalAdj > 0) {
    return "SAME_CHOICE_THRESHOLD_SATURATED";
  }

  if (allDiffAreGroupUniform) {
    return "SAME_CHOICE_GROUP_UNIFORM_SHIFT";
  }

  // 戦術重み差 maxAbsDelta が baseScore のマージンに届かず baseScore 順位が維持された場合
  return "SAME_CHOICE_BASE_MARGIN_DOMINATED";
}

/**
 * 単一の DecisionRequest (非自明: legalCount >= 2) を5つの Policy で同時解析
 */
export function analyzeSingleDecisionRequest(params: {
  request: Readonly<DecisionRequest>;
  gen8DNA: Readonly<DecisionDNA>;
  tacticalEvaluator: TacticalEvaluator;
  matchSeed: number;
  seat: "p1" | "p2";
  decisionIndex: number;
  perFeatureStats?: FeatureSensitivityAccumulator[];
}): SingleDecisionSnapshot {
  const {
    request,
    gen8DNA,
    tacticalEvaluator,
    matchSeed,
    seat,
    decisionIndex,
    perFeatureStats,
  } = params;

  const obs = request.observation;
  const selfKey = request.playerId;
  const stageRequests = obs.stageRequests ?? [];
  const oppRequests = stageRequests.filter((r) => r.controller !== selfKey);
  const hasOppStageRequest = oppRequests.length > 0;

  let oppRequestActionId: string | undefined;
  let oppRequestCertainty: "CERTAIN" | "ESTIMATED" | "UNKNOWN" | undefined;
  let oppRequestIsGuardedOut: boolean | undefined;
  let counterCancelStatusPresent: string | undefined;

  if (hasOppStageRequest) {
    const primaryOppReq = oppRequests[oppRequests.length - 1];
    oppRequestActionId = primaryOppReq.actionId;
    const reqOutcome = tacticalEvaluator.evaluateRequestOutcome(primaryOppReq, selfKey, obs);
    oppRequestCertainty = reqOutcome.certainty;
    oppRequestIsGuardedOut = reqOutcome.isGuardedOut;

    const statuses = new Set<string>();
    for (const pat of request.patterns ?? []) {
      const cOut = tacticalEvaluator.evaluateCounterOutcome(pat, primaryOppReq, request, reqOutcome);
      if (cOut.cancelStatus !== "CANNOT_CANCEL") {
        statuses.add(cOut.cancelStatus);
      }
    }
    counterCancelStatusPresent = statuses.size > 0 ? Array.from(statuses).join(",") : "CANNOT_CANCEL";
  }

  // ストリーミングブロックの場合
  if (
    request.blockAssignmentStream &&
    (request.patterns.length === 0 || request.blockAssignmentStream.patternCount > 256)
  ) {
    const stream = request.blockAssignmentStream;
    const selfView = obs.players.find((p) => p.playerId === selfKey) ?? obs.players.find((p) => p.isViewer);
    const oppView = obs.players.find((p) => p.playerId !== selfKey) ?? obs.players.find((p) => !p.isViewer);
    const selfLife = selfView?.lifeCount ?? 15;

    const myUnitsMap = new Map<string, UnitView>();
    for (const u of selfView?.field ?? []) myUnitsMap.set(u.unitId, u);
    for (const u of selfView?.trumps ?? []) myUnitsMap.set(u.unitId, u);

    const oppAttackersMap = new Map<string, UnitView>();
    for (const u of oppView?.field ?? []) {
      if (u.battle?.role === "attacker") oppAttackersMap.set(u.unitId, u);
    }

    const contextValues = DecisionFeatureEncoder.encodeContextOnly(request);
    const encoderContext = DecisionFeatureEncoder.createBlockAssignmentEncoderContext(request);

    const baseScores: number[] = [];
    const patternFeatures: Float64Array[] = [];
    const blockCounts: number[] = [];

    for (const assignments of stream.iterateAssignments()) {
      const pValues = DecisionFeatureEncoder.encodeBlockAssignmentValues(
        assignments,
        stream.candidateCount,
        encoderContext
      );
      const bScore = GenomeScorer.scoreSinglePattern(contextValues, pValues, gen8DNA);
      baseScores.push(bScore);

      const fVec = new Float64Array(TACTICAL_FEATURE_DIMENSION);
      let tradeAdv = 0;
      const blockedIds = new Set<string>();
      let blkCount = 0;

      for (const assign of assignments) {
        const attackerUnitId = assign.sourceUnitId;
        const blockerUnitIds = assign.selectedUnitIds ?? [];
        if (!attackerUnitId || blockerUnitIds.length === 0) continue;
        blkCount += blockerUnitIds.length;
        blockedIds.add(attackerUnitId);
        const atkSize = oppAttackersMap.get(attackerUnitId)?.currentSize ?? 0;
        for (const bid of blockerUnitIds) {
          const blkSize = myUnitsMap.get(bid)?.currentSize ?? 0;
          if (blkSize > atkSize) tradeAdv += 1.0;
          else if (blkSize === atkSize && blkSize > 0) tradeAdv += 0.5;
          else if (blkSize < atkSize && selfLife > 8 && blkSize >= 5) tradeAdv -= 0.75;
        }
      }

      let unblockedDmg = 0;
      for (const [atkId, atk] of oppAttackersMap.entries()) {
        if (!blockedIds.has(atkId)) unblockedDmg += atk.currentSize ?? 0;
      }

      fVec[14] = tradeAdv;
      if (unblockedDmg >= selfLife && selfLife > 0) {
        fVec[15] = 1.0;
      } else if (selfLife - unblockedDmg <= 3) {
        fVec[16] = unblockedDmg / Math.max(1, selfLife);
      }

      patternFeatures.push(fVec);
      blockCounts.push(blkCount);
    }

    return finalizeDecisionSnapshot({
      request,
      matchSeed,
      seat,
      decisionIndex,
      isStreamingBlock: true,
      legalCount: baseScores.length,
      hasOppStageRequest,
      oppRequestActionId,
      oppRequestCertainty,
      oppRequestIsGuardedOut,
      counterCancelStatusPresent,
      baseScores,
      patternFeatures,
      blockCounts,
      perFeatureStats,
    });
  }

  // 通常パターンの場合
  const encodedFeatures = DecisionFeatureEncoder.encode(request);
  const baseScored = GenomeScorer.score(encodedFeatures, gen8DNA);
  const patterns = request.patterns;
  const baseScores: number[] = new Array(patterns.length);
  const patternFeatures: Float64Array[] = new Array(patterns.length);

  for (let i = 0; i < baseScored.length; i++) {
    const sp = baseScored[i];
    baseScores[sp.patternRef] = sp.score;
    const { features } = encodeTacticalPatternFeatures(
      request,
      patterns[sp.patternRef],
      tacticalEvaluator
    );
    patternFeatures[sp.patternRef] = features;
  }

  return finalizeDecisionSnapshot({
    request,
    matchSeed,
    seat,
    decisionIndex,
    isStreamingBlock: false,
    legalCount: patterns.length,
    hasOppStageRequest,
    oppRequestActionId,
    oppRequestCertainty,
    oppRequestIsGuardedOut,
    counterCancelStatusPresent,
    baseScores,
    patternFeatures,
    perFeatureStats,
  });
}

export interface FeatureSensitivityAccumulator {
  readonly index: number;
  readonly featureName: string;
  readonly category: string;
  requestsActiveCount: number;
  patternsActiveCount: number;
  groupUniformRequestsCount: number;
  sumAbsValueWhenActive: number;
  maxAbsValue: number;
  singleFeatureFlipCountVsGen8: number;
  singleFeatureFlipCountG0Ind2VsG3: number;
  singleFeatureFlipCountG0Ind7VsG3: number;
}

export function createFeatureSensitivityAccumulators(): FeatureSensitivityAccumulator[] {
  return TACTICAL_FEATURE_NAMES.map((name, i) => ({
    index: i,
    featureName: name,
    category: TACTICAL_FEATURE_CATEGORY_MAP[name],
    requestsActiveCount: 0,
    patternsActiveCount: 0,
    groupUniformRequestsCount: 0,
    sumAbsValueWhenActive: 0,
    maxAbsValue: 0,
    singleFeatureFlipCountVsGen8: 0,
    singleFeatureFlipCountG0Ind2VsG3: 0,
    singleFeatureFlipCountG0Ind7VsG3: 0,
  }));
}

function finalizeDecisionSnapshot(params: {
  request: Readonly<DecisionRequest>;
  matchSeed: number;
  seat: "p1" | "p2";
  decisionIndex: number;
  isStreamingBlock: boolean;
  legalCount: number;
  hasOppStageRequest: boolean;
  oppRequestActionId?: string;
  oppRequestCertainty?: "CERTAIN" | "ESTIMATED" | "UNKNOWN";
  oppRequestIsGuardedOut?: boolean;
  counterCancelStatusPresent?: string;
  baseScores: readonly number[];
  patternFeatures: readonly Float64Array[];
  blockCounts?: readonly number[];
  perFeatureStats?: FeatureSensitivityAccumulator[];
}): SingleDecisionSnapshot {
  const {
    request,
    matchSeed,
    seat,
    decisionIndex,
    isStreamingBlock,
    legalCount,
    hasOppStageRequest,
    oppRequestActionId,
    oppRequestCertainty,
    oppRequestIsGuardedOut,
    counterCancelStatusPresent,
    baseScores,
    patternFeatures,
    blockCounts,
    perFeatureStats,
  } = params;

  const activeFeatureSet = new Set<number>();
  const groupUniformSet = new Set<number>();

  // 特徴量ごとの活性チェックと同一アクショングループ内の一律性チェック
  for (let k = 0; k < TACTICAL_FEATURE_DIMENSION; k++) {
    let activePatternsForK = 0;
    const nonZeroVals = new Set<number>();
    for (let i = 0; i < legalCount; i++) {
      const v = patternFeatures[i][k];
      if (v !== 0) {
        activePatternsForK++;
        nonZeroVals.add(Number(v.toFixed(6)));
        if (perFeatureStats) {
          perFeatureStats[k].patternsActiveCount++;
          perFeatureStats[k].sumAbsValueWhenActive += Math.abs(v);
          if (Math.abs(v) > perFeatureStats[k].maxAbsValue) {
            perFeatureStats[k].maxAbsValue = Math.abs(v);
          }
        }
      }
    }
    if (activePatternsForK > 0) {
      activeFeatureSet.add(k);
      if (perFeatureStats) {
        perFeatureStats[k].requestsActiveCount++;
      }
      // 複数パターンで活性かつ全ての活性パターンで同一値 (例: 全attackパターンが同じ値、全summonパターンが同じ値)
      if (activePatternsForK >= 2 && nonZeroVals.size === 1) {
        groupUniformSet.add(k);
        if (perFeatureStats) {
          perFeatureStats[k].groupUniformRequestsCount++;
        }
      }
    }
  }

  // BaseScore の Top1 / Top2 マージン算出
  const sortedBase = [...baseScores].sort((a, b) => b - a);
  const baseTop1Score = sortedBase[0] ?? 0;
  const baseTop2Score = sortedBase[1] ?? sortedBase[0] ?? 0;
  const baseScoreMargin = baseTop1Score - baseTop2Score;

  // 各 Policy の選択手とスコア算出
  const choices: Record<string, PolicyChoiceSummary> = {};
  for (const pKey of POLICY_KEYS) {
    const weights = POLICY_WEIGHTS_MAP[pKey];
    let bestRef = 0;
    let top1 = -Infinity;
    let top2 = -Infinity;

    for (let i = 0; i < legalCount; i++) {
      const f = patternFeatures[i];
      let tac = 0;
      for (let k = 0; k < TACTICAL_FEATURE_DIMENSION; k++) {
        if (f[k] !== 0 && weights[k] !== 0) {
          tac += weights[k] * f[k];
        }
      }
      const fin = baseScores[i] + tac;
      if (fin > top1) {
        top2 = top1;
        top1 = fin;
        bestRef = i;
      } else if (fin > top2) {
        top2 = fin;
      }
    }

    const bestTac = top1 - baseScores[bestRef];
    const pat = !isStreamingBlock ? request.patterns[bestRef] : undefined;
    const blkCount = isStreamingBlock && blockCounts ? blockCounts[bestRef] : undefined;

    choices[pKey] = {
      selectedPatternRef: bestRef,
      actionCategory: classifyPatternActionCategory(request, pat, isStreamingBlock, blkCount),
      top1FinalScore: Number(top1.toFixed(6)),
      top2FinalScore: Number((Number.isFinite(top2) ? top2 : top1).toFixed(6)),
      scoreMarginTop1Top2: Number((Number.isFinite(top2) ? top1 - top2 : 0).toFixed(6)),
      selectedBaseScore: Number(baseScores[bestRef].toFixed(6)),
      selectedTacticalAdj: Number(bestTac.toFixed(6)),
    };
  }

  // 単一特徴量のみを有効化/変更した際の Argmax 反転カウント (感度計測)
  if (perFeatureStats && activeFeatureSet.size > 0) {
    const gen8Choice = choices.GEN8.selectedPatternRef;
    const g0Ind2Choice = choices.G0_IND2.selectedPatternRef;
    const g0Ind7Choice = choices.G0_IND7.selectedPatternRef;

    for (const k of activeFeatureSet) {
      // 1. Gen8 (0) に G3_IND3[k] のみを単独適用したときに選択手が変わるか
      if (G3_IND3_WEIGHTS[k] !== 0) {
        let bestRefSingle = 0;
        let bestScoreSingle = -Infinity;
        for (let i = 0; i < legalCount; i++) {
          const s = baseScores[i] + G3_IND3_WEIGHTS[k] * patternFeatures[i][k];
          if (s > bestScoreSingle) {
            bestScoreSingle = s;
            bestRefSingle = i;
          }
        }
        if (bestRefSingle !== gen8Choice) {
          perFeatureStats[k].singleFeatureFlipCountVsGen8++;
        }
      }

      // 2. G0_IND2 の重みのうち k 番目だけを G3_IND3[k] に置き換えたときに選択手が変わるか
      if (G0_IND2_WEIGHTS[k] !== G3_IND3_WEIGHTS[k]) {
        let bestRefSwap2 = 0;
        let bestScoreSwap2 = -Infinity;
        for (let i = 0; i < legalCount; i++) {
          const f = patternFeatures[i];
          let tac = 0;
          for (let j = 0; j < TACTICAL_FEATURE_DIMENSION; j++) {
            const w = j === k ? G3_IND3_WEIGHTS[j] : G0_IND2_WEIGHTS[j];
            if (f[j] !== 0 && w !== 0) tac += w * f[j];
          }
          const s = baseScores[i] + tac;
          if (s > bestScoreSwap2) {
            bestScoreSwap2 = s;
            bestRefSwap2 = i;
          }
        }
        if (bestRefSwap2 !== g0Ind2Choice) {
          perFeatureStats[k].singleFeatureFlipCountG0Ind2VsG3++;
        }
      }

      // 3. G0_IND7 の重みのうち k 番目だけを G3_IND3[k] に置き換えたときに選択手が変わるか
      if (G0_IND7_WEIGHTS[k] !== G3_IND3_WEIGHTS[k]) {
        let bestRefSwap7 = 0;
        let bestScoreSwap7 = -Infinity;
        for (let i = 0; i < legalCount; i++) {
          const f = patternFeatures[i];
          let tac = 0;
          for (let j = 0; j < TACTICAL_FEATURE_DIMENSION; j++) {
            const w = j === k ? G3_IND3_WEIGHTS[j] : G0_IND7_WEIGHTS[j];
            if (f[j] !== 0 && w !== 0) tac += w * f[j];
          }
          const s = baseScores[i] + tac;
          if (s > bestScoreSwap7) {
            bestScoreSwap7 = s;
            bestRefSwap7 = i;
          }
        }
        if (bestRefSwap7 !== g0Ind7Choice) {
          perFeatureStats[k].singleFeatureFlipCountG0Ind7VsG3++;
        }
      }
    }
  }

  const anyTacticalFeatureActive = activeFeatureSet.size > 0;

  const causeG0Ind2VsG3Ind3 = classifyPairwiseDecisionBehavior({
    anyTacticalFeatureActive,
    patternFeatures,
    baseScores,
    weightsA: G0_IND2_WEIGHTS,
    weightsB: G3_IND3_WEIGHTS,
    choiceA: choices.G0_IND2,
    choiceB: choices.G3_IND3,
    groupUniformSet,
  });

  const causeG0Ind7VsG3Ind3 = classifyPairwiseDecisionBehavior({
    anyTacticalFeatureActive,
    patternFeatures,
    baseScores,
    weightsA: G0_IND7_WEIGHTS,
    weightsB: G3_IND3_WEIGHTS,
    choiceA: choices.G0_IND7,
    choiceB: choices.G3_IND3,
    groupUniformSet,
  });

  const causeR4VsG3Ind3 = classifyPairwiseDecisionBehavior({
    anyTacticalFeatureActive,
    patternFeatures,
    baseScores,
    weightsA: R4_PRESET_TACTICAL_WEIGHTS,
    weightsB: G3_IND3_WEIGHTS,
    choiceA: choices.R4,
    choiceB: choices.G3_IND3,
    groupUniformSet,
  });

  const causeGen8VsG3Ind3 = classifyPairwiseDecisionBehavior({
    anyTacticalFeatureActive,
    patternFeatures,
    baseScores,
    weightsA: ZERO_TACTICAL_WEIGHTS,
    weightsB: G3_IND3_WEIGHTS,
    choiceA: choices.GEN8,
    choiceB: choices.G3_IND3,
    groupUniformSet,
  });

  return {
    matchSeed,
    seat,
    decisionIndex,
    decisionId: request.decisionId,
    sourceType: request.source.type,
    isStreamingBlock,
    legalCount,
    hasOppStageRequest,
    oppRequestActionId,
    oppRequestCertainty,
    oppRequestIsGuardedOut,
    counterCancelStatusPresent,
    anyTacticalFeatureActive,
    activeFeatureIndices: Array.from(activeFeatureSet).sort((a, b) => a - b),
    groupUniformFeatureIndices: Array.from(groupUniformSet).sort((a, b) => a - b),
    baseTop1Score: Number(baseTop1Score.toFixed(6)),
    baseTop2Score: Number(baseTop2Score.toFixed(6)),
    baseScoreMargin: Number(baseScoreMargin.toFixed(6)),
    choices: choices as Record<PolicyKey, PolicyChoiceSummary>,
    causeG0Ind2VsG3Ind3,
    causeG0Ind7VsG3Ind3,
    causeR4VsG3Ind3,
    causeGen8VsG3Ind3,
  };
}

// =============================================================================
// 4. 分位数・統計ヘルパー
// =============================================================================
function computeQuantiles(values: readonly number[]): {
  count: number;
  mean: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  max: number;
} {
  if (values.length === 0) {
    return { count: 0, mean: 0, p10: 0, p25: 0, p50: 0, p75: 0, p90: 0, max: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const q = (p: number) => sorted[Math.min(n - 1, Math.floor(p * (n - 1)))];
  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  return {
    count: n,
    mean: Number(mean.toFixed(4)),
    p10: Number(q(0.1).toFixed(4)),
    p25: Number(q(0.25).toFixed(4)),
    p50: Number(q(0.5).toFixed(4)),
    p75: Number(q(0.75).toFixed(4)),
    p90: Number(q(0.9).toFixed(4)),
    max: Number(sorted[n - 1].toFixed(4)),
  };
}

// =============================================================================
// 5. シャドウプローブ Policy (実試合を進行させながら全 DecisionRequest を解析)
// =============================================================================
class DifferentialShadowProbePolicy implements DecisionPolicy {
  public readonly descriptor: PolicyDescriptor;
  public decisionCounter = 0;
  public trivialDecisionCount = 0;

  constructor(
    private readonly drivingPolicy: DecisionPolicy,
    private readonly gen8DNA: Readonly<DecisionDNA>,
    private readonly tacticalEvaluator: TacticalEvaluator,
    private readonly matchSeed: number,
    private readonly seat: "p1" | "p2",
    private readonly snapshots: SingleDecisionSnapshot[],
    private readonly perFeatureStats: FeatureSensitivityAccumulator[]
  ) {
    this.descriptor = drivingPolicy.descriptor;
  }

  public choose(request: Readonly<DecisionRequest>): DecisionResponse {
    this.decisionCounter++;
    const legalCount =
      request.blockAssignmentStream &&
      (request.patterns.length === 0 || request.blockAssignmentStream.patternCount > 256)
        ? request.blockAssignmentStream.patternCount
        : request.patterns.length;

    if (legalCount <= 1) {
      this.trivialDecisionCount++;
      return this.drivingPolicy.choose(request);
    }

    const snap = analyzeSingleDecisionRequest({
      request,
      gen8DNA: this.gen8DNA,
      tacticalEvaluator: this.tacticalEvaluator,
      matchSeed: this.matchSeed,
      seat: this.seat,
      decisionIndex: this.decisionCounter,
      perFeatureStats: this.perFeatureStats,
    });
    this.snapshots.push(snap);

    return this.drivingPolicy.choose(request);
  }
}

// =============================================================================
// 6. 実対戦ロールアウト軌跡記録 Policy (勝敗反転局面の特定用)
// =============================================================================
interface TrajectoryStepRecord {
  readonly stepIndex: number;
  readonly decisionId: string;
  readonly stateVersion: number;
  readonly legalCount: number;
  readonly selectedPatternRef: number;
  readonly actionCategory: string;
}

class TrajectoryRecordingPolicy implements DecisionPolicy {
  public readonly descriptor: PolicyDescriptor;
  public readonly steps: TrajectoryStepRecord[] = [];

  constructor(private readonly inner: DecisionPolicy) {
    this.descriptor = inner.descriptor;
  }

  public choose(request: Readonly<DecisionRequest>): DecisionResponse {
    const res = this.inner.choose(request);
    const isStream =
      Boolean(request.blockAssignmentStream) &&
      (request.patterns.length === 0 || request.blockAssignmentStream!.patternCount > 256);
    const legalCount = isStream
      ? request.blockAssignmentStream!.patternCount
      : request.patterns.length;
    const pat = !isStream ? request.patterns[res.selectedPatternRef] : undefined;
    this.steps.push({
      stepIndex: this.steps.length,
      decisionId: request.decisionId,
      stateVersion: request.stateVersion,
      legalCount,
      selectedPatternRef: res.selectedPatternRef,
      actionCategory: classifyPatternActionCategory(request, pat, isStream),
    });
    return res;
  }
}

// =============================================================================
// 7. メイン実行処理
// =============================================================================
async function main() {
  const args = process.argv.slice(1);
  const pairsArg =
    process.env.GEN9_DIAG_PAIRS ??
    args.find((a) => a.startsWith("--pairs="))?.split("=")[1];
  const pairsCount = pairsArg ? parseInt(pairsArg, 10) : 30; // Default: 30 pairs = 60 matches
  const timeoutSec = 900;

  const overallStartMs = performance.now();
  const checkTimeout = () => {
    const elapsedSec = (performance.now() - overallStartMs) / 1000;
    if (elapsedSec > timeoutSec) {
      throw new Error(`[TIMEOUT] 診断実行時間が上限 (${timeoutSec}秒) を超過しました`);
    }
  };

  let currentHeadSha = "b9e60d1f94cdec8b0568d7a6e5b056886646e9d5";
  try {
    currentHeadSha = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
  } catch {
    // ignore
  }

  const diagSeedStart = 760001;
  assertWork53SafeSeedRange("Work 5-3 Diagnostic Seeds", diagSeedStart, pairsCount);

  const rulesDir = path.resolve("src/data/rules-vnext");
  const regulationsDir = path.resolve("src/data/regulations");
  const catalog = await loadRegulationCatalog(regulationsDir);
  const rulePackage = await loadRulePackageFromDirectory(rulesDir);

  const reg = catalog.regulations.get("standard-pack")!;
  const frame = catalog.frames.get("pack")!;

  const gen8Candidate = createGen8ChampionCandidatePolicy();
  const gen8DNA = DecisionDNACodec.clone((gen8Candidate as any).dna);

  const tacticalEvaluator = new GenericTacticalEvaluator(rulePackage);
  Gen9TacticalPrototypePolicy.setDefaultEvaluator(tacticalEvaluator);

  console.log("================================================================================");
  console.log(
    ` BlackPoker Work 5-3 — Gen 9 意思決定差分・特徴量感度分析 (Seeds: ${diagSeedStart}〜${diagSeedStart + pairsCount - 1}, ${pairsCount}ペア=${pairsCount * 2}試合)`
  );
  console.log(` Base SHA: ${currentHeadSha}`);
  console.log("================================================================================");

  // ---------------------------------------------------------------------------
  // PART 1: シャドウ評価による同一 DecisionRequest 意思決定差分・特徴量感度計測
  // ---------------------------------------------------------------------------
  const snapshots: SingleDecisionSnapshot[] = [];
  const perFeatureStats = createFeatureSensitivityAccumulators();
  let totalTrivialDecisions = 0;
  let totalEvaluatedPatterns = 0;

  const g3Genome = fromV6DNA(gen8DNA, G3_IND3_WEIGHTS, {
    id: "gen9-evolved-g3-ind3",
    name: "Evolved-G3-Ind3",
    generation: 3,
    createdGeneration: 3,
    originType: "EVOLVED_OFFSPRING",
    parentIds: ["gen9-g0-ind7-survival-trade"],
  });

  for (let i = 0; i < pairsCount; i++) {
    checkTimeout();
    const matchSeed = diagSeedStart + i;
    const origLog = console.log;

    try {
      console.log = () => {};

      // Leg 0: P1 = Probe(G3_IND3), P2 = Gen 8
      const probe0 = new DifferentialShadowProbePolicy(
        new Gen9LearnableTacticalPolicy(g3Genome, "G3-p1", tacticalEvaluator),
        gen8DNA,
        tacticalEvaluator,
        matchSeed,
        "p1",
        snapshots,
        perFeatureStats
      );
      const opp0 = new GenomePolicy(gen8DNA, "Gen8-p2");
      const setup0 = OfficialRegulationMatchSetup.setupMatch(reg, frame, rulePackage, matchSeed, {
        playerNames: { p1: "Probe-G3", p2: "Gen8" },
      });
      const session0 = new GameSession((setup0 as any).state, rulePackage, { matchSeed });
      SimulationRunner.run(session0, { p1: probe0, p2: opp0 }, { maxDecisions: 1000 });
      totalTrivialDecisions += probe0.trivialDecisionCount;

      // Leg 1: P1 = Gen 8, P2 = Probe(G3_IND3) (座席反転)
      const opp1 = new GenomePolicy(gen8DNA, "Gen8-p1");
      const probe1 = new DifferentialShadowProbePolicy(
        new Gen9LearnableTacticalPolicy(g3Genome, "G3-p2", tacticalEvaluator),
        gen8DNA,
        tacticalEvaluator,
        matchSeed,
        "p2",
        snapshots,
        perFeatureStats
      );
      const setup1 = OfficialRegulationMatchSetup.setupMatch(reg, frame, rulePackage, matchSeed, {
        playerNames: { p1: "Gen8", p2: "Probe-G3" },
      });
      const session1 = new GameSession((setup1 as any).state, rulePackage, { matchSeed });
      SimulationRunner.run(session1, { p1: opp1, p2: probe1 }, { maxDecisions: 1000 });
      totalTrivialDecisions += probe1.trivialDecisionCount;
    } finally {
      console.log = origLog;
    }
  }

  const totalNonTrivialDecisions = snapshots.length;
  const totalAllDecisions = totalNonTrivialDecisions + totalTrivialDecisions;
  for (const s of snapshots) {
    totalEvaluatedPatterns += s.legalCount;
  }

  // 1-A. 合法手数の統計とマージン統計
  const legalCounts = snapshots.map((s) => s.legalCount);
  const baseMargins = snapshots.map((s) => s.baseScoreMargin);
  const activeSnapshots = snapshots.filter((s) => s.anyTacticalFeatureActive);
  const activeBaseMargins = activeSnapshots.map((s) => s.baseScoreMargin);

  // 1-B. Policy 間の選択手一致率・不一致率マトリクス
  const pairwiseAgreement: Record<
    string,
    {
      allNonTrivialCount: number;
      sameChoiceCount: number;
      diffChoiceCount: number;
      sameChoicePct: number;
      diffChoicePct: number;
      tacticalActiveCount: number;
      tacticalSameCount: number;
      tacticalDiffCount: number;
      tacticalSamePct: number;
      tacticalDiffPct: number;
    }
  > = {};

  for (let a = 0; a < POLICY_KEYS.length; a++) {
    for (let b = a + 1; b < POLICY_KEYS.length; b++) {
      const kA = POLICY_KEYS[a];
      const kB = POLICY_KEYS[b];
      const pairKey = `${kA}_vs_${kB}`;

      let sameAll = 0;
      let diffAll = 0;
      let sameAct = 0;
      let diffAct = 0;

      for (const s of snapshots) {
        const eq = s.choices[kA].selectedPatternRef === s.choices[kB].selectedPatternRef;
        if (eq) sameAll++;
        else diffAll++;

        if (s.anyTacticalFeatureActive) {
          if (eq) sameAct++;
          else diffAct++;
        }
      }

      pairwiseAgreement[pairKey] = {
        allNonTrivialCount: totalNonTrivialDecisions,
        sameChoiceCount: sameAll,
        diffChoiceCount: diffAll,
        sameChoicePct: Number(((sameAll / Math.max(1, totalNonTrivialDecisions)) * 100).toFixed(2)),
        diffChoicePct: Number(((diffAll / Math.max(1, totalNonTrivialDecisions)) * 100).toFixed(2)),
        tacticalActiveCount: activeSnapshots.length,
        tacticalSameCount: sameAct,
        tacticalDiffCount: diffAct,
        tacticalSamePct: Number(((sameAct / Math.max(1, activeSnapshots.length)) * 100).toFixed(2)),
        tacticalDiffPct: Number(((diffAct / Math.max(1, activeSnapshots.length)) * 100).toFixed(2)),
      };
    }
  }

  // 1-C. ステージ上の相手リクエストにおける CERTAIN / ESTIMATED / UNKNOWN / GuardedOut 発生率
  const oppReqSnapshots = snapshots.filter((s) => s.hasOppStageRequest);
  const oppReqStats = {
    totalDecisionsWithOppRequest: oppReqSnapshots.length,
    pctOfNonTrivialDecisions: Number(
      ((oppReqSnapshots.length / Math.max(1, totalNonTrivialDecisions)) * 100).toFixed(2)
    ),
    certainCount: oppReqSnapshots.filter((s) => s.oppRequestCertainty === "CERTAIN" && !s.oppRequestIsGuardedOut).length,
    estimatedCount: oppReqSnapshots.filter((s) => s.oppRequestCertainty === "ESTIMATED" && !s.oppRequestIsGuardedOut).length,
    unknownCount: oppReqSnapshots.filter((s) => s.oppRequestCertainty === "UNKNOWN" && !s.oppRequestIsGuardedOut).length,
    guardedOutCount: oppReqSnapshots.filter((s) => s.oppRequestIsGuardedOut === true).length,
    byRequestActionId: {} as Record<string, { total: number; certain: number; estimated: number; unknown: number; guardedOut: number }>,
    counterAvailableCount: oppReqSnapshots.filter((s) => s.counterCancelStatusPresent && s.counterCancelStatusPresent !== "CANNOT_CANCEL").length,
  };

  for (const s of oppReqSnapshots) {
    const aid = s.oppRequestActionId ?? "unknown";
    if (!oppReqStats.byRequestActionId[aid]) {
      oppReqStats.byRequestActionId[aid] = { total: 0, certain: 0, estimated: 0, unknown: 0, guardedOut: 0 };
    }
    oppReqStats.byRequestActionId[aid].total++;
    if (s.oppRequestIsGuardedOut) oppReqStats.byRequestActionId[aid].guardedOut++;
    else if (s.oppRequestCertainty === "CERTAIN") oppReqStats.byRequestActionId[aid].certain++;
    else if (s.oppRequestCertainty === "ESTIMATED") oppReqStats.byRequestActionId[aid].estimated++;
    else oppReqStats.byRequestActionId[aid].unknown++;
  }

  // 1-D. アクション種別ごとの選択傾向 (5 Policy 比較)
  const actionTendencies: Record<PolicyKey, Record<string, number>> = {
    GEN8: {},
    R4: {},
    G0_IND2: {},
    G0_IND7: {},
    G3_IND3: {},
  };

  for (const s of snapshots) {
    for (const pKey of POLICY_KEYS) {
      const cat = s.choices[pKey].actionCategory;
      actionTendencies[pKey][cat] = (actionTendencies[pKey][cat] ?? 0) + 1;
    }
  }

  // 1-E. プラトー・原因分類集計
  const countCauses = (getter: (s: SingleDecisionSnapshot) => DecisionDiffCauseCategory) => {
    const counts: Record<DecisionDiffCauseCategory, number> = {
      INACTIVE_ALL_ZERO: 0,
      ACTIVE_ZERO_WEIGHT_DELTA: 0,
      SAME_CHOICE_BASE_MARGIN_DOMINATED: 0,
      SAME_CHOICE_THRESHOLD_SATURATED: 0,
      SAME_CHOICE_GROUP_UNIFORM_SHIFT: 0,
      DECISION_CHANGED: 0,
    };
    for (const s of snapshots) {
      counts[getter(s)]++;
    }
    const pcts: Record<string, string> = {};
    for (const [k, v] of Object.entries(counts)) {
      pcts[k] = `${v} (${((v / Math.max(1, totalNonTrivialDecisions)) * 100).toFixed(2)}%)`;
    }
    return { counts, pcts };
  };

  const causeBreakdown = {
    G0Ind2_vs_G3Ind3: countCauses((s) => s.causeG0Ind2VsG3Ind3),
    G0Ind7_vs_G3Ind3: countCauses((s) => s.causeG0Ind7VsG3Ind3),
    R4_vs_G3Ind3: countCauses((s) => s.causeR4VsG3Ind3),
    Gen8_vs_G3Ind3: countCauses((s) => s.causeGen8VsG3Ind3),
  };

  // 1-F. 20次元特徴量別の感度・活性率・寄与度テーブル
  const featureSensitivityTable = perFeatureStats.map((st, k) => {
    const meanValWhenActive =
      st.patternsActiveCount > 0 ? st.sumAbsValueWhenActive / st.patternsActiveCount : 0;
    const reqActivePct = (st.requestsActiveCount / Math.max(1, totalNonTrivialDecisions)) * 100;
    const groupUniformPctOfActive =
      st.requestsActiveCount > 0
        ? (st.groupUniformRequestsCount / st.requestsActiveCount) * 100
        : 0;

    const wR4 = R4_PRESET_TACTICAL_WEIGHTS[k];
    const wG0_2 = G0_IND2_WEIGHTS[k];
    const wG0_7 = G0_IND7_WEIGHTS[k];
    const wG3 = G3_IND3_WEIGHTS[k];

    let classification = "ACTIVE_EFFECTIVE";
    if (st.requestsActiveCount === 0) {
      classification = "NEVER_ACTIVATED_IN_SAMPLE";
    } else if (reqActivePct < 0.5) {
      classification = "RARE_EXTREME_EVENT (<0.5% requests)";
    } else if (
      Math.abs(wG3 - wG0_2) >= 0.1 &&
      st.singleFeatureFlipCountG0Ind2VsG3 === 0 &&
      groupUniformPctOfActive >= 80
    ) {
      classification = "GROUP_UNIFORM_BASE_DOMINATED";
    } else if (
      Math.abs(wG3 - wG0_7) >= 0.05 &&
      st.singleFeatureFlipCountG0Ind7VsG3 === 0
    ) {
      classification = "THRESHOLD_SATURATED_OR_SUB_MARGIN";
    }

    return {
      index: k,
      featureName: st.featureName,
      category: st.category,
      requestsActiveCount: st.requestsActiveCount,
      requestsActivePct: Number(reqActivePct.toFixed(2)),
      patternsActiveCount: st.patternsActiveCount,
      groupUniformRequestsCount: st.groupUniformRequestsCount,
      groupUniformPctOfActive: Number(groupUniformPctOfActive.toFixed(1)),
      meanAbsFeatureValueWhenActive: Number(meanValWhenActive.toFixed(4)),
      weights: {
        R4: wR4,
        G0_IND2: wG0_2,
        G0_IND7: wG0_7,
        G3_IND3: wG3,
        deltaG3MinusG0Ind2: Number((wG3 - wG0_2).toFixed(4)),
        deltaG3MinusG0Ind7: Number((wG3 - wG0_7).toFixed(4)),
      },
      meanContributionWhenActive: {
        R4: Number((wR4 * meanValWhenActive).toFixed(4)),
        G0_IND2: Number((wG0_2 * meanValWhenActive).toFixed(4)),
        G0_IND7: Number((wG0_7 * meanValWhenActive).toFixed(4)),
        G3_IND3: Number((wG3 * meanValWhenActive).toFixed(4)),
      },
      singleFeatureFlipCountVsGen8: st.singleFeatureFlipCountVsGen8,
      singleFeatureFlipCountG0Ind2VsG3: st.singleFeatureFlipCountG0Ind2VsG3,
      singleFeatureFlipCountG0Ind7VsG3: st.singleFeatureFlipCountG0Ind7VsG3,
      empiricalClassification: classification,
    };
  });

  // ---------------------------------------------------------------------------
  // PART 2: 実対戦ロールアウトによる判断分岐と勝敗反転の追跡 (Seeds: 760001〜760030)
  // ---------------------------------------------------------------------------
  interface RolloutMatchTrace {
    matchSeed: number;
    seat: "p1" | "p2";
    outcomes: Record<PolicyKey, "WIN" | "LOSS" | "DRAW">;
    turns: Record<PolicyKey, number>;
    trajectories: Record<PolicyKey, TrajectoryStepRecord[]>;
  }

  const rolloutTraces: RolloutMatchTrace[] = [];
  const winCountsVsGen8: Record<PolicyKey, number> = {
    GEN8: 0,
    R4: 0,
    G0_IND2: 0,
    G0_IND7: 0,
    G3_IND3: 0,
  };

  for (let i = 0; i < pairsCount; i++) {
    checkTimeout();
    const matchSeed = diagSeedStart + i;

    for (const seat of ["p1", "p2"] as const) {
      const outcomes: Record<string, "WIN" | "LOSS" | "DRAW"> = {};
      const turns: Record<string, number> = {};
      const trajectories: Record<string, TrajectoryStepRecord[]> = {};

      for (const pKey of POLICY_KEYS) {
        const w = POLICY_WEIGHTS_MAP[pKey];
        const genome = fromV6DNA(gen8DNA, w, { id: pKey, name: pKey });
        const recPolicy = new TrajectoryRecordingPolicy(
          new Gen9LearnableTacticalPolicy(genome, pKey, tacticalEvaluator)
        );
        const oppPolicy = new GenomePolicy(gen8DNA, "Gen8-Opp");

        const origLog = console.log;
        let simRes: ReturnType<typeof SimulationRunner.run>;
        try {
          console.log = () => {};
          const setup = OfficialRegulationMatchSetup.setupMatch(reg, frame, rulePackage, matchSeed, {
            playerNames: seat === "p1" ? { p1: pKey, p2: "Gen8" } : { p1: "Gen8", p2: pKey },
          });
          const session = new GameSession((setup as any).state, rulePackage, { matchSeed });
          simRes = SimulationRunner.run(
            session,
            seat === "p1" ? { p1: recPolicy, p2: oppPolicy } : { p1: oppPolicy, p2: recPolicy },
            { maxDecisions: 1000 }
          );
        } finally {
          console.log = origLog;
        }

        const won = simRes.winner === seat;
        const lost = simRes.winner !== undefined && simRes.winner !== "draw" && simRes.winner !== seat;
        outcomes[pKey] = won ? "WIN" : lost ? "LOSS" : "DRAW";
        if (won) winCountsVsGen8[pKey]++;
        turns[pKey] = simRes.turnCount;
        trajectories[pKey] = recPolicy.steps;
      }

      rolloutTraces.push({
        matchSeed,
        seat,
        outcomes: outcomes as Record<PolicyKey, "WIN" | "LOSS" | "DRAW">,
        turns: turns as Record<PolicyKey, number>,
        trajectories: trajectories as Record<PolicyKey, TrajectoryStepRecord[]>,
      });
    }
  }

  // 2-A. 2つの Policy 間の実対戦ロールアウト分岐・勝敗影響の集計
  function analyzeRolloutDivergence(keyA: PolicyKey, keyB: PolicyKey) {
    let identicalTrajectoryMatches = 0;
    let divergedSameOutcomeMatches = 0;
    let divergedFlippedToBWin = 0;
    let divergedFlippedToBLoss = 0;
    const flippedExamples: {
      matchSeed: number;
      seat: "p1" | "p2";
      outcomeA: string;
      outcomeB: string;
      firstDivergenceStep: number;
      decisionId: string;
      legalCount: number;
      choiceA: string;
      choiceB: string;
    }[] = [];

    for (const tr of rolloutTraces) {
      const stepsA = tr.trajectories[keyA];
      const stepsB = tr.trajectories[keyB];
      const minLen = Math.min(stepsA.length, stepsB.length);
      let firstDivIdx = -1;

      for (let sIdx = 0; sIdx < minLen; sIdx++) {
        if (stepsA[sIdx].selectedPatternRef !== stepsB[sIdx].selectedPatternRef) {
          firstDivIdx = sIdx;
          break;
        }
      }

      if (firstDivIdx === -1 && stepsA.length === stepsB.length) {
        identicalTrajectoryMatches++;
      } else {
        const outA = tr.outcomes[keyA];
        const outB = tr.outcomes[keyB];
        if (outA === outB) {
          divergedSameOutcomeMatches++;
        } else {
          if (outB === "WIN" && outA === "LOSS") divergedFlippedToBWin++;
          if (outB === "LOSS" && outA === "WIN") divergedFlippedToBLoss++;
          const divStepA = stepsA[Math.max(0, firstDivIdx)];
          const divStepB = stepsB[Math.max(0, firstDivIdx)];
          flippedExamples.push({
            matchSeed: tr.matchSeed,
            seat: tr.seat,
            outcomeA: outA,
            outcomeB: outB,
            firstDivergenceStep: firstDivIdx,
            decisionId: divStepA?.decisionId ?? "unknown",
            legalCount: divStepA?.legalCount ?? 0,
            choiceA: `${divStepA?.actionCategory}#${divStepA?.selectedPatternRef}`,
            choiceB: `${divStepB?.actionCategory}#${divStepB?.selectedPatternRef}`,
          });
        }
      }
    }

    return {
      comparison: `${keyA}_vs_${keyB}`,
      totalMatches: rolloutTraces.length,
      winsA: winCountsVsGen8[keyA],
      winsB: winCountsVsGen8[keyB],
      identicalTrajectoryMatches,
      divergedSameOutcomeMatches,
      divergedFlippedToBWin,
      divergedFlippedToBLoss,
      flippedExamples,
    };
  }

  const rolloutComparisons = {
    G0Ind2_vs_G3Ind3: analyzeRolloutDivergence("G0_IND2", "G3_IND3"),
    G0Ind7_vs_G3Ind3: analyzeRolloutDivergence("G0_IND7", "G3_IND3"),
    R4_vs_G3Ind3: analyzeRolloutDivergence("R4", "G3_IND3"),
    Gen8_vs_G3Ind3: analyzeRolloutDivergence("GEN8", "G3_IND3"),
    Gen8_vs_R4: analyzeRolloutDivergence("GEN8", "R4"),
  };

  // 代表的な選択手差分スナップショットの抽出 (G0_IND2 vs G3_IND3, G0_IND7 vs G3_IND3, R4 vs G3_IND3)
  const changedSnapshotsG0Ind2VsG3 = snapshots
    .filter((s) => s.causeG0Ind2VsG3Ind3 === "DECISION_CHANGED")
    .slice(0, 15);
  const changedSnapshotsG0Ind7VsG3 = snapshots
    .filter((s) => s.causeG0Ind7VsG3Ind3 === "DECISION_CHANGED")
    .slice(0, 15);
  const changedSnapshotsR4VsG3 = snapshots
    .filter((s) => s.causeR4VsG3Ind3 === "DECISION_CHANGED")
    .slice(0, 15);

  const overallWallTimeMs = Number((performance.now() - overallStartMs).toFixed(1));

  // コンソールサマリ出力
  console.log(`\n[1] 意思決定収集サマリ (Seeds: ${diagSeedStart}〜${diagSeedStart + pairsCount - 1}, ${pairsCount * 2}試合)`);
  console.log(
    `  * 総意思決定数: ${totalAllDecisions} (非自明 [legal>=2]: ${totalNonTrivialDecisions}, 自明 [legal=1]: ${totalTrivialDecisions})`
  );
  console.log(
    `  * 戦術特徴量が1つ以上活性化した非自明意思決定数: ${activeSnapshots.length} / ${totalNonTrivialDecisions} (${((activeSnapshots.length / totalNonTrivialDecisions) * 100).toFixed(2)}%)`
  );
  console.log(
    `  * 全特徴量ゼロ (INACTIVE_ALL_ZERO) の非自明意思決定数: ${totalNonTrivialDecisions - activeSnapshots.length} / ${totalNonTrivialDecisions} (${(((totalNonTrivialDecisions - activeSnapshots.length) / totalNonTrivialDecisions) * 100).toFixed(2)}%)`
  );
  console.log(`  * 合法手数分位数: ${JSON.stringify(computeQuantiles(legalCounts))}`);
  console.log(`  * BaseScore Top1-Top2 マージン分位数 (全体): ${JSON.stringify(computeQuantiles(baseMargins))}`);
  console.log(`  * BaseScore Top1-Top2 マージン分位数 (戦術活性時): ${JSON.stringify(computeQuantiles(activeBaseMargins))}`);

  console.log(`\n[2] Policy 間の選択手一致率 / 不一致率`);
  for (const [pairKey, stat] of Object.entries(pairwiseAgreement)) {
    console.log(
      `  * ${pairKey.padEnd(18)}: 全体一致=${stat.sameChoicePct.toFixed(2)}% (不一致=${stat.diffChoiceCount}/${stat.allNonTrivialCount} [${stat.diffChoicePct.toFixed(2)}%]) | 戦術活性時一致=${stat.tacticalSamePct.toFixed(2)}% (不一致=${stat.tacticalDiffCount}/${stat.tacticalActiveCount} [${stat.tacticalDiffPct.toFixed(2)}%])`
    );
  }

  console.log(`\n[3] プラトー・非変化原因の分類内訳`);
  console.log(`  * G0_IND2 vs G3_IND3: ${JSON.stringify(causeBreakdown.G0Ind2_vs_G3Ind3.pcts)}`);
  console.log(`  * G0_IND7 vs G3_IND3: ${JSON.stringify(causeBreakdown.G0Ind7_vs_G3Ind3.pcts)}`);
  console.log(`  * R4      vs G3_IND3: ${JSON.stringify(causeBreakdown.R4_vs_G3Ind3.pcts)}`);
  console.log(`  * GEN8    vs G3_IND3: ${JSON.stringify(causeBreakdown.Gen8_vs_G3Ind3.pcts)}`);

  console.log(`\n[4] 20次元特徴量別の活性率・一律シフト率・単独反転数`);
  for (const f of featureSensitivityTable) {
    console.log(
      `  * [${String(f.index).padStart(2, "0")}] ${f.featureName.padEnd(38)} | Active=${String(f.requestsActiveCount).padStart(4)} (${f.requestsActivePct.toFixed(2).padStart(5)}%) | GroupUniform=${f.groupUniformPctOfActive.toFixed(1).padStart(5)}% | w(R4/G0_2/G0_7/G3)=(${f.weights.R4}/${f.weights.G0_IND2}/${f.weights.G0_IND7}/${f.weights.G3_IND3}) | Flips(vsGen8/G0_2/G0_7)=(${f.singleFeatureFlipCountVsGen8}/${f.singleFeatureFlipCountG0Ind2VsG3}/${f.singleFeatureFlipCountG0Ind7VsG3}) | ${f.empiricalClassification}`
    );
  }

  console.log(`\n[5] Stage相手リクエスト時の CERTAIN / ESTIMATED / UNKNOWN / GuardedOut 発生率`);
  console.log(`  * ${JSON.stringify(oppReqStats)}`);

  console.log(`\n[6] 実対戦ロールアウト (対 Gen 8, ${pairsCount * 2}試合) における軌跡分岐と勝敗反転`);
  for (const [k, rc] of Object.entries(rolloutComparisons)) {
    console.log(
      `  * ${k.padEnd(18)}: Wins(${rc.winsA} vs ${rc.winsB}) | 完全同一試合=${rc.identicalTrajectoryMatches}/${pairsCount * 2} | 分岐・勝敗不変=${rc.divergedSameOutcomeMatches}/${pairsCount * 2} | 分岐・勝敗反転=+${rc.divergedFlippedToBWin}/-${rc.divergedFlippedToBLoss}`
    );
  }

  const report = {
    workId: "BP-SIM-AI-GEN9-DECISION-SENSITIVITY-WORK5-3",
    baseCommitSha: currentHeadSha,
    generatedAt: new Date().toISOString(),
    overallWallTimeMs,
    diagnosticSeedRange: `${diagSeedStart}-${diagSeedStart + pairsCount - 1}`,
    pairsCount,
    totalMatchesPerPass: pairsCount * 2,
    policies: POLICY_DESCRIPTIONS,
    policyWeights: POLICY_WEIGHTS_MAP,
    summaryMetrics: {
      totalAllDecisions,
      totalTrivialDecisions,
      totalNonTrivialDecisions,
      totalEvaluatedPatterns,
      tacticalActiveDecisionsCount: activeSnapshots.length,
      tacticalActiveDecisionsPct: Number(
        ((activeSnapshots.length / Math.max(1, totalNonTrivialDecisions)) * 100).toFixed(2)
      ),
      inactiveAllZeroDecisionsCount: totalNonTrivialDecisions - activeSnapshots.length,
      inactiveAllZeroDecisionsPct: Number(
        (((totalNonTrivialDecisions - activeSnapshots.length) / Math.max(1, totalNonTrivialDecisions)) * 100).toFixed(2)
      ),
      legalCountQuantiles: computeQuantiles(legalCounts),
      baseScoreMarginQuantilesAll: computeQuantiles(baseMargins),
      baseScoreMarginQuantilesTacticalActive: computeQuantiles(activeBaseMargins),
      baseScoreMarginThresholdsTacticalActive: {
        gt0_10Pct: Number(
          ((activeBaseMargins.filter((m) => m > 0.1).length / Math.max(1, activeBaseMargins.length)) * 100).toFixed(2)
        ),
        gt0_25Pct: Number(
          ((activeBaseMargins.filter((m) => m > 0.25).length / Math.max(1, activeBaseMargins.length)) * 100).toFixed(2)
        ),
        gt0_50Pct: Number(
          ((activeBaseMargins.filter((m) => m > 0.5).length / Math.max(1, activeBaseMargins.length)) * 100).toFixed(2)
        ),
        gt1_00Pct: Number(
          ((activeBaseMargins.filter((m) => m > 1.0).length / Math.max(1, activeBaseMargins.length)) * 100).toFixed(2)
        ),
      },
    },
    pairwiseAgreement,
    causeBreakdown,
    featureSensitivityTable,
    oppReqStats,
    actionTendencies,
    rolloutComparisons,
    representativeChangedDecisions: {
      G0Ind2_vs_G3Ind3: changedSnapshotsG0Ind2VsG3,
      G0Ind7_vs_G3Ind3: changedSnapshotsG0Ind7VsG3,
      R4_vs_G3Ind3: changedSnapshotsR4VsG3,
    },
  };

  const outPath = path.resolve(".artifacts/gen9-work5-3-sensitivity-analysis.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf-8");
  console.log(`\n=> Work 5-3 意思決定差分・特徴量感度分析結果JSON保存完了: ${outPath} (${(overallWallTimeMs / 1000).toFixed(1)}s)`);
}

if (!process.env.VITEST) {
  main().catch((err) => {
    console.error("Sensitivity analysis failed:", err);
    process.exit(1);
  });
}
