/**
 * Evolution Independent Evaluator (BP-SIM-AI-V92-WORK3-EVALUATOR-FOUNDATION)
 *
 * Standard＋Pack における Decision DNA の強さを客観的・統計的・決定論的に評価する独立評価エンジン。
 *
 * 設計原則:
 * 1. 2大評価軸の分離 (絶対的能力水準 vs 進化的向上度)
 * 2. 座席反転ペア対戦 (Leg 0: Candidate=P1, Leg 1: Candidate=P2) による先後手バイアスの相殺・緩和
 * 3. ペア単位スコアリング (Xi in {0.0, 0.25, 0.5, 0.75, 1.0})
 * 4. 2層ステータス判定 (Evidence Status と Improvement Status の分離)
 * 5. 小標本・分散ゼロに対応した厳格な統計検定 (Student t + Exact Binomial Test + Bonferroni 補正)
 * 6. 作業メモリ O(1) 設計 (生 DecisionTrace を破棄しペアサマリのみ保持)
 * 7. Fail-Closed な Seed 衝突検証 (Train / Val / Holdout の重複排除)
 */

import {
  EVALUATOR_VERSION,
  DEFAULT_SIGNIFICANCE_ALPHA,
  DEFAULT_MINIMUM_COMPLETED_PAIRS,
  EvaluationConfig,
  EvaluationConfigurationError,
  EvaluationIntegrityError,
  EvaluationOpponentDefinition,
  EvaluationSeedCategory,
  EvaluationSeedCollisionError,
  EvaluationSeedSet,
  EvidenceStatus,
  ImprovementStatus,
  IndependentEvaluationResult,
  OpponentEvaluationSummary,
  PairedLegOutcome,
  PairedMatchResult,
  StatisticalTestResult,
} from "../../domain/ai/EvolutionEvaluationTypes";
import { DecisionDNA } from "../../domain/ai/DecisionDNATypes";
import { DecisionDNACodec } from "./DecisionDNACodec";
import { GenomePolicy } from "./GenomePolicy";
import { SimulationRunner, SimulationResult } from "../simulation/SimulationRunner";
import { BatchMatchContext, BatchSimulationOptions } from "../../domain/simulation/BatchSimulationTypes";
import { SemanticSHA256 } from "./SemanticSHA256";
import { deriveSeed } from "../random/DeterministicShuffle";

// =============================================================================
// t 分布の臨界値テーブル (両側 95% = 片側 97.5%、alpha = 0.05)
// =============================================================================

const T_CRITICAL_95_TABLE: Record<number, number> = {
  1: 12.706,
  2: 4.303,
  3: 3.182,
  4: 2.776,
  5: 2.571,
  6: 2.447,
  7: 2.365,
  8: 2.306,
  9: 2.262,
  10: 2.228,
  11: 2.201,
  12: 2.179,
  13: 2.16,
  14: 2.145,
  15: 2.131,
  16: 2.12,
  17: 2.11,
  18: 2.101,
  19: 2.093,
  20: 2.086,
  21: 2.08,
  22: 2.074,
  23: 2.069,
  24: 2.064,
  25: 2.06,
  26: 2.056,
  27: 2.052,
  28: 2.048,
  29: 2.045,
  30: 2.042,
  40: 2.021,
  50: 2.009,
  60: 2.0,
  80: 1.99,
  100: 1.984,
  120: 1.98,
};

export function getStudentTCritical95(df: number): number {
  if (df <= 0) return Infinity;
  if (df in T_CRITICAL_95_TABLE) {
    return T_CRITICAL_95_TABLE[df];
  }
  if (df > 120) {
    return 1.96; // 大標本近似
  }
  // 最も近い定義値で保守的に補間 (小さい方の df の臨界値を使用 = より保守的)
  const keys = Object.keys(T_CRITICAL_95_TABLE)
    .map(Number)
    .sort((a, b) => a - b);
  for (let i = keys.length - 1; i >= 0; i--) {
    if (df >= keys[i]) {
      return T_CRITICAL_95_TABLE[keys[i]];
    }
  }
  return T_CRITICAL_95_TABLE[1];
}

/**
 * 組合せ数 nCk の正確な計算
 */
export function combination(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  const c = Math.min(k, n - k);
  let res = 1;
  for (let i = 1; i <= c; i++) {
    res = (res * (n - c + i)) / i;
  }
  return Math.round(res);
}

/**
 * 片側二項検定の p 値計算 (H0: p = 0.5, H1: p > 0.5)
 * @param successes 成功数 (ペア勝利数: Xi > 0.5)
 * @param trials 試行数 (ペア数)
 */
export function exactBinomialOneTailedPValue(successes: number, trials: number): number {
  if (trials <= 0) return 1.0;
  if (successes <= 0) return 1.0;
  if (successes > trials) return 0.0;

  let pSum = 0;
  const baseP = Math.pow(0.5, trials);
  for (let k = successes; k <= trials; k++) {
    pSum += combination(trials, k) * baseP;
  }
  return Math.min(1.0, Math.max(0.0, pSum));
}

export class EvolutionIndependentEvaluator {
  /**
   * Seed 空間の衝突検証 (Fail-Closed)
   *
   * @param seedSets 検証対象の Seed セット群
   * @throws EvaluationSeedCollisionError 重複が 1 件でも存在する場合
   */
  public static assertNoSeedCollision(seedSets: readonly EvaluationSeedSet[]): void {
    if (!seedSets || seedSets.length === 0) {
      return;
    }

    const seenSeeds = new Map<number, EvaluationSeedCategory>();
    const collisions: number[] = [];

    for (const set of seedSets) {
      if (!set || !Array.isArray(set.seeds)) {
        throw new EvaluationConfigurationError("Invalid EvaluationSeedSet: seeds must be an array");
      }

      for (const seed of set.seeds) {
        if (typeof seed !== "number" || !Number.isFinite(seed) || !Number.isInteger(seed)) {
          throw new EvaluationConfigurationError(`Invalid seed value: ${seed}`);
        }

        if (seenSeeds.has(seed)) {
          collisions.push(seed);
        } else {
          seenSeeds.set(seed, set.category);
        }
      }
    }

    if (collisions.length > 0) {
      const uniqueCollisions = Array.from(new Set(collisions));
      throw new EvaluationSeedCollisionError(
        `Seed collision detected: ${uniqueCollisions.length} duplicate seed(s) found across evaluation categories: [${uniqueCollisions.join(", ")}]`,
        uniqueCollisions
      );
    }
  }

  /**
   * 単一ペア対戦 (Seat-Swapped Leg 0 & Leg 1) を実行
   */
  public static runPairedMatch(params: {
    pairIndex: number;
    matchSeed: number;
    candidateDna: DecisionDNA;
    candidateGenomeId: string;
    candidateDnaDigest: string;
    opponent: EvaluationOpponentDefinition;
    sessionFactory: BatchSimulationOptions["sessionFactory"];
    maxDecisionsPerMatch: number;
  }): PairedMatchResult {
    const {
      pairIndex,
      matchSeed,
      candidateDna,
      candidateGenomeId,
      candidateDnaDigest,
      opponent,
      sessionFactory,
      maxDecisionsPerMatch,
    } = params;

    const p1Seed = deriveSeed(matchSeed, "p1");
    const p2Seed = deriveSeed(matchSeed, "p2");
    const playerSeeds = { p1: p1Seed, p2: p2Seed };

    // =========================================================================
    // Leg 0: Candidate = P1, Opponent = P2
    // =========================================================================
    let leg0Outcome: PairedLegOutcome;
    try {
      const matchContext0: BatchMatchContext = {
        matchIndex: pairIndex * 2,
        matchId: `pair-${pairIndex}-leg0-${matchSeed}-cand-vs-${opponent.opponentId}`,
        baseSeed: matchSeed,
        matchSeed,
        playerSeeds,
      };

      const session0 = sessionFactory(matchContext0);
      const candPolicy0 = new GenomePolicy(candidateDna, `Candidate-${candidateGenomeId}`);
      const oppPolicy0 = opponent.policyFactory("p2", matchSeed, playerSeeds);

      const simResult0 = SimulationRunner.run(session0, { p1: candPolicy0, p2: oppPolicy0 }, {
        maxDecisions: maxDecisionsPerMatch,
      });

      const candWon0 = simResult0.winner === "p1";
      const candDraw0 = simResult0.winner === "draw" || (!simResult0.winner && simResult0.completed);
      const candLost0 = simResult0.winner === "p2";

      leg0Outcome = {
        legIndex: 0,
        candidateSeat: "p1",
        opponentSeat: "p2",
        completed: simResult0.completed,
        winner: simResult0.winner as any,
        candidateWon: candWon0,
        candidateDraw: candDraw0,
        candidateLost: candLost0,
        totalDecisions: simResult0.totalDecisions,
        turnCount: simResult0.turnCount,
        reason: simResult0.reason,
        failed: false,
        incomplete: !simResult0.completed,
        finalStateHash: simResult0.finalStateHash,
      };
    } catch (err: any) {
      leg0Outcome = {
        legIndex: 0,
        candidateSeat: "p1",
        opponentSeat: "p2",
        completed: false,
        candidateWon: false,
        candidateDraw: false,
        candidateLost: false,
        totalDecisions: 0,
        turnCount: 0,
        reason: `Leg 0 exception: ${err?.message ?? String(err)}`,
        failed: true,
        incomplete: false,
      };
    }

    // =========================================================================
    // Leg 1: Opponent = P1, Candidate = P2 (座席反転)
    // =========================================================================
    let leg1Outcome: PairedLegOutcome;
    try {
      const matchContext1: BatchMatchContext = {
        matchIndex: pairIndex * 2 + 1,
        matchId: `pair-${pairIndex}-leg1-${matchSeed}-${opponent.opponentId}-vs-cand`,
        baseSeed: matchSeed,
        matchSeed,
        playerSeeds,
      };

      const session1 = sessionFactory(matchContext1);
      const oppPolicy1 = opponent.policyFactory("p1", matchSeed, playerSeeds);
      const candPolicy1 = new GenomePolicy(candidateDna, `Candidate-${candidateGenomeId}`);

      const simResult1 = SimulationRunner.run(session1, { p1: oppPolicy1, p2: candPolicy1 }, {
        maxDecisions: maxDecisionsPerMatch,
      });

      const candWon1 = simResult1.winner === "p2";
      const candDraw1 = simResult1.winner === "draw" || (!simResult1.winner && simResult1.completed);
      const candLost1 = simResult1.winner === "p1";

      leg1Outcome = {
        legIndex: 1,
        candidateSeat: "p2",
        opponentSeat: "p1",
        completed: simResult1.completed,
        winner: simResult1.winner as any,
        candidateWon: candWon1,
        candidateDraw: candDraw1,
        candidateLost: candLost1,
        totalDecisions: simResult1.totalDecisions,
        turnCount: simResult1.turnCount,
        reason: simResult1.reason,
        failed: false,
        incomplete: !simResult1.completed,
        finalStateHash: simResult1.finalStateHash,
      };
    } catch (err: any) {
      leg1Outcome = {
        legIndex: 1,
        candidateSeat: "p2",
        opponentSeat: "p1",
        completed: false,
        candidateWon: false,
        candidateDraw: false,
        candidateLost: false,
        totalDecisions: 0,
        turnCount: 0,
        reason: `Leg 1 exception: ${err?.message ?? String(err)}`,
        failed: true,
        incomplete: false,
      };
    }

    // =========================================================================
    // ペアスコア算出 (FAILED / INCOMPLETE は勝敗へ自動換算しない)
    // =========================================================================
    let pairScore = 0.0;
    let status: "COMPLETED" | "INCOMPLETE" | "FAILED" = "COMPLETED";

    if (leg0Outcome.failed || leg1Outcome.failed) {
      status = "FAILED";
      pairScore = 0.0;
    } else if (leg0Outcome.incomplete || leg1Outcome.incomplete) {
      status = "INCOMPLETE";
      pairScore = 0.0;
    } else {
      status = "COMPLETED";
      const score0 = leg0Outcome.candidateWon ? 1.0 : leg0Outcome.candidateDraw ? 0.5 : 0.0;
      const score1 = leg1Outcome.candidateWon ? 1.0 : leg1Outcome.candidateDraw ? 0.5 : 0.0;
      pairScore = (score0 + score1) / 2.0;
    }

    return {
      pairIndex,
      matchSeed,
      opponentId: opponent.opponentId,
      candidateGenomeId,
      candidateDnaDigest,
      leg0: leg0Outcome,
      leg1: leg1Outcome,
      pairScore,
      status,
    };
  }

  /**
   * ペアスコア配列から統計指標および検定を計算
   */
  public static computeStatistics(params: {
    pairScores: readonly number[];
    failedCount: number;
    incompleteCount: number;
    targetWinRate: number;
    alpha: number;
    minCompletedPairs: number;
  }): {
    meanPairScore: number;
    sampleVariance: number;
    standardError: number;
    confidenceInterval95: { lower: number; upper: number; confidenceLevel: number };
    statisticalTest: StatisticalTestResult;
    evidenceStatus: EvidenceStatus;
    improvementStatus: ImprovementStatus;
    targetMet: boolean;
  } {
    const { pairScores, failedCount, incompleteCount, targetWinRate, alpha, minCompletedPairs } = params;
    const n = pairScores.length;

    // 1. Evidence Status 判定
    let evidenceStatus: EvidenceStatus = "VALID";
    if (failedCount > 0) {
      evidenceStatus = "INVALID_EVIDENCE";
    } else if (incompleteCount > 0 || n < minCompletedPairs) {
      evidenceStatus = "INSUFFICIENT_EVIDENCE";
    }

    // 2. 標本平均と分散の計算
    if (n === 0) {
      return {
        meanPairScore: 0.0,
        sampleVariance: 0.0,
        standardError: 0.0,
        confidenceInterval95: { lower: 0.0, upper: 1.0, confidenceLevel: 0.95 },
        statisticalTest: {
          method: "UNDEFINED",
          pValue: 1.0,
          isStatisticallySignificant: false,
          testNotes: "n = 0: Insufficient data",
        },
        evidenceStatus,
        improvementStatus: "IMPROVEMENT_UNVERIFIED",
        targetMet: false,
      };
    }

    const sum = pairScores.reduce((acc, v) => acc + v, 0);
    const meanPairScore = sum / n;

    let sampleVariance = 0.0;
    if (n > 1) {
      const sumSqDiff = pairScores.reduce((acc, v) => acc + Math.pow(v - meanPairScore, 2), 0);
      sampleVariance = sumSqDiff / (n - 1);
    }
    const standardError = n > 0 ? Math.sqrt(sampleVariance / n) : 0.0;

    // 3. 信頼区間と検定の計算
    let lowerCI = 0.0;
    let upperCI = 1.0;
    let statisticalTest: StatisticalTestResult;

    const pairWins = pairScores.filter((s) => s > 0.5).length;
    const pairLosses = pairScores.filter((s) => s < 0.5).length;
    const exactPValue = exactBinomialOneTailedPValue(pairWins, n);

    if (n < 2) {
      // n=1: 分散定義不能
      lowerCI = 0.0;
      upperCI = 1.0;
      statisticalTest = {
        method: "UNDEFINED",
        pValue: exactPValue,
        isStatisticallySignificant: false,
        testNotes: "n < 2: Student-t undefined. Insufficient sample size for inference.",
      };
    } else if (sampleVariance === 0.0) {
      // 分散ゼロ (全勝、全敗、全同点など)
      // Student-t では分母が 0 になり 0/0 となるため、代替方式として Exact Binomial Test を適用
      lowerCI = meanPairScore;
      upperCI = meanPairScore;

      const isSignificant = exactPValue < alpha && meanPairScore > 0.5;
      statisticalTest = {
        method: "EXACT_BINOMIAL",
        pValue: exactPValue,
        isStatisticallySignificant: isSignificant,
        testNotes: `Zero variance (s^2=0). Exact Binomial test applied as alternative (p=${exactPValue.toFixed(4)} vs alpha=${alpha.toFixed(4)})`,
      };
    } else {
      // 通常時: 分散が存在する場合は分数ペアスコアの連続性を考慮できる Student-t 信頼区間を主検定として適用
      const df = n - 1;
      const tCrit = getStudentTCritical95(df);
      lowerCI = Math.max(0.0, meanPairScore - tCrit * standardError);
      upperCI = Math.min(1.0, meanPairScore + tCrit * standardError);

      const tStat = (meanPairScore - 0.5) / standardError;
      // 95% 信頼区間の下限が 0.5 を上回っていれば片側 2.5% (alpha <= 0.05) で統計的に有意
      const isSignificant = lowerCI > 0.5;

      statisticalTest = {
        method: "STUDENT_T",
        statistic: tStat,
        pValue: exactPValue,
        degreesOfFreedom: df,
        isStatisticallySignificant: isSignificant,
        testNotes: `Student-t applied: t-stat=${tStat.toFixed(3)}, df=${df}, 95% CI=[${lowerCI.toFixed(3)}, ${upperCI.toFixed(3)}]`,
      };
    }

    const targetMet = meanPairScore >= targetWinRate;

    // 4. Improvement Status 判定 (Evidence が VALID の場合のみ判定可能)
    let improvementStatus: ImprovementStatus = "IMPROVEMENT_UNVERIFIED";

    if (evidenceStatus === "VALID") {
      if (statisticalTest.isStatisticallySignificant && targetMet && lowerCI > 0.5) {
        improvementStatus = "IMPROVEMENT_VERIFIED";
      } else if (meanPairScore < 0.5 && upperCI < 0.5 && exactBinomialOneTailedPValue(pairLosses, n) < alpha) {
        improvementStatus = "CONFIRMED_REGRESSION";
      } else {
        improvementStatus = "IMPROVEMENT_UNVERIFIED";
      }
    }

    return {
      meanPairScore,
      sampleVariance,
      standardError,
      confidenceInterval95: { lower: lowerCI, upper: upperCI, confidenceLevel: 0.95 },
      statisticalTest,
      evidenceStatus,
      improvementStatus,
      targetMet,
    };
  }

  /**
   * 独立対戦評価 (Independent Evaluation) を実行
   */
  public static evaluate(config: EvaluationConfig): IndependentEvaluationResult {
    // 1. 設定の Fail-Fast 検証
    if (!config || typeof config !== "object") {
      throw new EvaluationConfigurationError("EvaluationConfig must be a non-null object");
    }

    const {
      candidateDNA,
      seeds,
      seedCategory,
      opponents,
      sessionFactory,
      maxDecisionsPerMatch = 500,
      significanceLevelAlpha = DEFAULT_SIGNIFICANCE_ALPHA,
      minimumCompletedPairs = DEFAULT_MINIMUM_COMPLETED_PAIRS,
      regulationId = "standard-pack",
      rulePackageVersion = "1.0.0",
      featureSchemaVersion = 6,
    } = config;

    // DNA 形式検証 (有限値・スキーマ整合)
    DecisionDNACodec.validate(candidateDNA);
    const candidateClone = DecisionDNACodec.clone(candidateDNA);

    // DNA Digest 算出
    const candidateDnaDigest = SemanticSHA256.hash(
      JSON.stringify({
        dnaFormatVersion: candidateClone.dnaFormatVersion,
        featureSchemaVersion: candidateClone.featureSchemaVersion,
        scoringModel: candidateClone.scoringModel,
        contextDimension: candidateClone.contextDimension,
        patternDimension: candidateClone.patternDimension,
        patternWeights: candidateClone.patternWeights,
        contextPatternWeights: candidateClone.contextPatternWeights,
      })
    );
    const candidateGenomeId = candidateClone.metadata?.id ?? "candidate-genome";

    if (!Array.isArray(seeds) || seeds.length === 0) {
      throw new EvaluationConfigurationError("seeds must be a non-empty array of numbers");
    }

    // 単一セット内での Seed 重複チェック
    this.assertNoSeedCollision([{ category: seedCategory, seeds }]);

    if (!Array.isArray(opponents) || opponents.length === 0) {
      throw new EvaluationConfigurationError("opponents must be a non-empty array");
    }

    if (typeof sessionFactory !== "function") {
      throw new EvaluationConfigurationError("sessionFactory must be a function");
    }

    // 2. 多重比較の Bonferroni 補正 alpha の算出
    const K = opponents.length;
    const bonferroniAdjustedAlpha = significanceLevelAlpha / K;

    // 3. 対戦相手ごとの座席反転ペア対戦実行 (作業メモリ O(1))
    const opponentSummaries: Record<string, OpponentEvaluationSummary> = {};
    const allPairs: PairedMatchResult[] = [];
    let pairCounter = 0;

    for (const opponent of opponents) {
      const opponentPairs: PairedMatchResult[] = [];
      const pairScores: number[] = [];
      let completedPairs = 0;
      let incompletePairs = 0;
      let failedPairs = 0;

      for (const matchSeed of seeds) {
        const pairResult = this.runPairedMatch({
          pairIndex: pairCounter++,
          matchSeed,
          candidateDna: candidateClone,
          candidateGenomeId,
          candidateDnaDigest,
          opponent,
          sessionFactory,
          maxDecisionsPerMatch,
        });

        opponentPairs.push(pairResult);
        allPairs.push(pairResult);

        if (pairResult.status === "COMPLETED") {
          completedPairs++;
          pairScores.push(pairResult.pairScore);
        } else if (pairResult.status === "INCOMPLETE") {
          incompletePairs++;
        } else if (pairResult.status === "FAILED") {
          failedPairs++;
        }
      }

      // 統計指標・検定の計算
      const stats = this.computeStatistics({
        pairScores,
        failedCount: failedPairs,
        incompleteCount: incompletePairs,
        targetWinRate: opponent.targetWinRate,
        alpha: bonferroniAdjustedAlpha,
        minCompletedPairs: minimumCompletedPairs,
      });

      opponentSummaries[opponent.opponentId] = {
        opponentId: opponent.opponentId,
        opponentName: opponent.name,
        totalPairs: opponentPairs.length,
        completedPairs,
        incompletePairs,
        failedPairs,
        pairScores: Object.freeze(pairScores),
        meanPairScore: stats.meanPairScore,
        sampleVariance: stats.sampleVariance,
        standardError: stats.standardError,
        confidenceInterval95: stats.confidenceInterval95,
        statisticalTest: stats.statisticalTest,
        targetWinRate: opponent.targetWinRate,
        targetMet: stats.targetMet,
        evidenceStatus: stats.evidenceStatus,
        improvementStatus: stats.improvementStatus,
      };
    }

    // 4. 総合ステータス集計
    let overallEvidenceStatus: EvidenceStatus = "VALID";
    let hasRegression = false;
    let allVerified = true;
    let allTargetsMet = true;

    for (const summary of Object.values(opponentSummaries)) {
      if (summary.evidenceStatus === "INVALID_EVIDENCE") {
        overallEvidenceStatus = "INVALID_EVIDENCE";
      } else if (summary.evidenceStatus === "INSUFFICIENT_EVIDENCE" && overallEvidenceStatus !== "INVALID_EVIDENCE") {
        overallEvidenceStatus = "INSUFFICIENT_EVIDENCE";
      }

      if (summary.improvementStatus === "CONFIRMED_REGRESSION") {
        hasRegression = true;
      }
      if (summary.improvementStatus !== "IMPROVEMENT_VERIFIED") {
        allVerified = false;
      }
      if (!summary.targetMet) {
        allTargetsMet = false;
      }
    }

    let overallImprovementStatus: ImprovementStatus = "IMPROVEMENT_UNVERIFIED";
    if (overallEvidenceStatus === "VALID") {
      if (hasRegression) {
        overallImprovementStatus = "CONFIRMED_REGRESSION";
      } else if (allVerified && allTargetsMet) {
        overallImprovementStatus = "IMPROVEMENT_VERIFIED";
      } else {
        overallImprovementStatus = "IMPROVEMENT_UNVERIFIED";
      }
    }

    const totalPairs = allPairs.length;
    const totalMatches = totalPairs * 2;

    const summaryText = `[Evaluation ${candidateGenomeId}] Evidence: ${overallEvidenceStatus}, Improvement: ${overallImprovementStatus}, Opponents: ${K}, Total Pairs: ${totalPairs} (${totalMatches} matches), All Targets Met: ${allTargetsMet}`;

    return {
      evaluatorVersion: EVALUATOR_VERSION,
      candidateGenomeId,
      candidateDnaDigest,
      rulePackageVersion,
      featureSchemaVersion,
      regulationId,
      seedCategory,
      significanceLevelAlpha,
      bonferroniAdjustedAlpha,
      opponents: Object.freeze(opponentSummaries),
      pairs: Object.freeze(allPairs),
      totalPairs,
      totalMatches,
      allTargetsMet,
      evidenceStatus: overallEvidenceStatus,
      improvementStatus: overallImprovementStatus,
      summaryText,
      timestamp: new Date().toISOString(),
    };
  }
}
