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
 * 5. 小標本・分散ゼロに対応した厳格な統計検定 (Student t + Hoeffding / Exact Binomial + Bonferroni 補正)
 * 6. 事前 Fail-Fast 入力検証 (パラメータ、DNAスキーマ、対戦相手ID一意性)
 * 7. 横断的 Seed 衝突検証 (Train / Val / Holdout の厳格分離)
 * 8. 決定論的論理結果 (logicalResult) と実行時メトリクス (runtimeMetrics) の Sidecar 分離
 * 9. 作業メモリ有界性 (戻り値から生 DecisionTrace を破棄しペアサマリのみ保持)
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
  IndependentEvaluationLogicalResult,
  IndependentEvaluationResult,
  IndependentEvaluationRuntimeMetrics,
  OpponentEvaluationSummary,
  PairedLegOutcome,
  PairedMatchResult,
  StatisticalTestResult,
} from "../../domain/ai/EvolutionEvaluationTypes";
import { DecisionDNA } from "../../domain/ai/DecisionDNATypes";
import { DecisionDNACodec } from "./DecisionDNACodec";
import { GenomePolicy } from "./GenomePolicy";
import { SimulationRunner } from "../simulation/SimulationRunner";
import { BatchMatchContext, BatchSimulationOptions } from "../../domain/simulation/BatchSimulationTypes";
import { SemanticSHA256 } from "./SemanticSHA256";
import { deriveSeed } from "../random/DeterministicShuffle";

// =============================================================================
// 数理統計ユーティリティ (純粋 TypeScript 実装)
// =============================================================================

/**
 * ガンマ関数の自然対数 ln(Gamma(z)) の高精度近似 (Lanczos 近似法, g=7, N=9)
 * 誤差 < 1e-14
 */
export function logGamma(z: number): number {
  const p = [
    0.99999999999980993,
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.138571095857209,
    9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];

  if (z < 0.5) {
    // 反射公式: Gamma(z) * Gamma(1-z) = pi / sin(pi * z)
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  }

  z -= 1;
  let x = p[0];
  for (let i = 1; i < p.length; i++) {
    x += p[i] / (z + i);
  }
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/**
 * 正則化不完全ベータ関数 I_x(a, b) = B(x; a, b) / B(a, b)
 * Lentz の連分数展開アルゴリズムにより高精度に計算
 */
export function regularizedIncompleteBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0.0;
  if (x >= 1) return 1.0;

  // 連分数展開の収束安定性のため対称性を利用
  if (x > (a + 1) / (a + b + 2)) {
    return 1.0 - regularizedIncompleteBeta(b, a, 1.0 - x);
  }

  const factor = Math.exp(
    a * Math.log(x) + b * Math.log(1.0 - x) - logGamma(a) - logGamma(b) + logGamma(a + b)
  ) / a;

  const maxIter = 200;
  const eps = 1e-15;
  const tiny = 1e-30;

  let c = 1.0;
  let d = 1.0 - ((a + b) * x) / (a + 1.0);
  if (Math.abs(d) < tiny) d = tiny;
  d = 1.0 / d;
  let h = d;

  for (let m = 1; m <= maxIter; m++) {
    // 偶数ステップ 2m
    const numEven = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m));
    d = 1.0 + numEven * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1.0 + numEven / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1.0 / d;
    h *= d * c;

    // 奇数ステップ 2m+1
    const numOdd = -((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1));
    d = 1.0 + numOdd * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1.0 + numOdd / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1.0 / d;
    const delta = d * c;
    h *= delta;

    if (Math.abs(delta - 1.0) < eps) {
      break;
    }
  }

  return Math.min(1.0, Math.max(0.0, factor * h));
}

/**
 * Student-t 分布の片側 p 値 (One-tailed p-value: P(T_df >= t))
 * H0: mu <= 0.5, H1: mu > 0.5
 */
export function studentTOneTailedPValue(t: number, df: number): number {
  if (df <= 0 || !Number.isFinite(df)) return 1.0;
  if (!Number.isFinite(t)) return t > 0 ? 0.0 : 1.0;
  if (t === 0) return 0.5;

  const x = df / (df + t * t);
  const ibeta = regularizedIncompleteBeta(df / 2, 0.5, x);

  if (t > 0) {
    return 0.5 * ibeta;
  } else {
    return 1.0 - 0.5 * ibeta;
  }
}

/**
 * Student-t 分布の片側臨界値 t_{alpha, df} (P(T_df >= t) = alpha となる t)
 * 二分探索 (Bisection) により高精度に逆算
 */
export function studentTOneTailedCritical(alpha: number, df: number): number {
  if (df <= 0 || !Number.isFinite(df)) return Infinity;
  if (alpha <= 0 || alpha >= 1 || !Number.isFinite(alpha)) return Infinity;
  if (alpha === 0.5) return 0.0;

  // alpha < 0.5 なら t > 0
  let low = 0.0;
  let high = 1000.0; // 自由度1でも alpha=1e-6 で t ~ 636 なので 1000 で十分

  // high が不足している場合の安全策
  while (studentTOneTailedPValue(high, df) > alpha && high < 1e8) {
    high *= 2;
  }

  for (let iter = 0; iter < 80; iter++) {
    const mid = (low + high) / 2.0;
    const p = studentTOneTailedPValue(mid, df);
    if (p > alpha) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return (low + high) / 2.0;
}

/**
 * 後方互換用: 両側 95% (片側 alpha = 0.025) の Student-t 臨界値を返す
 */
export function getStudentTCritical95(df: number): number {
  return studentTOneTailedCritical(0.025, df);
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

// =============================================================================
// Evaluator 本体
// =============================================================================

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

      // winner と completed 状態の整合性検証
      const validWinners = new Set(["p1", "p2", "draw", undefined]);
      if (!validWinners.has(simResult0.winner as any)) {
        throw new Error(`Unexpected simulation winner state: ${simResult0.winner}`);
      }

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

      // winner と completed 状態の整合性検証
      const validWinners = new Set(["p1", "p2", "draw", undefined]);
      if (!validWinners.has(simResult1.winner as any)) {
        throw new Error(`Unexpected simulation winner state: ${simResult1.winner}`);
      }

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
    // ペアスコア算出 (FAILED / INCOMPLETE は勝敗へ自動換算せず null とする)
    // =========================================================================
    let pairScore: number | null = null;
    let status: "COMPLETED" | "INCOMPLETE" | "FAILED" = "COMPLETED";

    if (leg0Outcome.failed || leg1Outcome.failed) {
      status = "FAILED";
      pairScore = null;
    } else if (leg0Outcome.incomplete || leg1Outcome.incomplete) {
      status = "INCOMPLETE";
      pairScore = null;
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
   *
   * @param params.pairScores COMPLETED なペアのスコア配列 (無効ペアは含まない)
   * @param params.failedCount 失敗ペア数
   * @param params.incompleteCount 未完了ペア数
   * @param params.targetWinRate 目標勝率
   * @param params.alpha 有意水準 (多重比較時は Bonferroni 補正後の有意水準)
   * @param params.minCompletedPairs 最小完了ペア数
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
        confidenceInterval95: { lower: 0.0, upper: 1.0, confidenceLevel: 1.0 - alpha },
        statisticalTest: {
          method: "UNDEFINED",
          pValue: null,
          alphaUsed: alpha,
          isStatisticallySignificant: false,
          testNotes: "n = 0: No completed pairs",
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
      // n=1: Student-t 分散定義不能
      lowerCI = 0.0;
      upperCI = 1.0;
      statisticalTest = {
        method: "UNDEFINED",
        pValue: null,
        alphaUsed: alpha,
        isStatisticallySignificant: false,
        testNotes: "n < 2: Student-t undefined. Insufficient sample size for statistical inference.",
      };
    } else if (sampleVariance === 0.0) {
      // =======================================================================
      // 分散ゼロ (全勝、全敗、全同点など)
      // =======================================================================
      if (meanPairScore === 1.0) {
        // 全勝: 厳密二項片側 (1 - alpha) 信頼下限 L = alpha^(1/n)
        // 数学的に L > 0.5 <=> alpha^(1/n) > 0.5 <=> (0.5)^n < alpha <=> exactPValue < alpha が完全一致
        const binomialLower = Math.pow(alpha, 1.0 / n);
        lowerCI = Math.max(0.0, binomialLower);
        upperCI = 1.0;

        const isSignificant = exactPValue < alpha && lowerCI > 0.5;
        statisticalTest = {
          method: "EXACT_BINOMIAL",
          pValue: exactPValue,
          alphaUsed: alpha,
          isStatisticallySignificant: isSignificant,
          testNotes: `Zero variance (All Wins, mean=1.0). Exact Binomial p=${exactPValue.toFixed(6)}, Exact Lower Bound=${lowerCI.toFixed(4)}, alpha=${alpha.toFixed(6)}`,
        };
      } else if (meanPairScore === 0.0) {
        // 全敗: 厳密二項片側 (1 - alpha) 信頼上限 U = 1 - alpha^(1/n)
        const binomialUpper = 1.0 - Math.pow(alpha, 1.0 / n);
        lowerCI = 0.0;
        upperCI = Math.min(1.0, binomialUpper);

        const isSignificant = exactPValue < alpha; // pValue for pairWins=0 is 1.0, for pairLosses is (0.5)^n
        const regressionP = exactBinomialOneTailedPValue(pairLosses, n);

        statisticalTest = {
          method: "EXACT_BINOMIAL",
          pValue: 1.0, // H1: mean > 0.5 の検定としては p = 1.0
          alphaUsed: alpha,
          isStatisticallySignificant: false,
          testNotes: `Zero variance (All Losses, mean=0.0). Exact Binomial Upper Bound=${upperCI.toFixed(4)}, regressionP=${regressionP.toFixed(6)}, alpha=${alpha.toFixed(6)}`,
        };
      } else {
        // 全同点 (mean=0.5) や全勝分 (mean=0.75) 等: 有界変数に対する Hoeffding 保守的信頼限界
        const hoeffdingMargin = Math.sqrt(Math.log(1.0 / alpha) / (2.0 * n));
        lowerCI = Math.max(0.0, meanPairScore - hoeffdingMargin);
        upperCI = Math.min(1.0, meanPairScore + hoeffdingMargin);

        if (meanPairScore <= 0.5) {
          statisticalTest = {
            method: "EXACT_BINOMIAL",
            pValue: 1.0,
            alphaUsed: alpha,
            isStatisticallySignificant: false,
            testNotes: `Zero variance (s^2=0, mean=${meanPairScore.toFixed(3)} <= 0.5). No statistical improvement.`,
          };
        } else {
          const isSignificant = exactPValue < alpha && lowerCI > 0.5;
          statisticalTest = {
            method: "EXACT_BINOMIAL",
            pValue: exactPValue,
            alphaUsed: alpha,
            isStatisticallySignificant: isSignificant,
            testNotes: `Zero variance (s^2=0). Exact Binomial p=${exactPValue.toFixed(6)}, Hoeffding CI=[${lowerCI.toFixed(3)}, ${upperCI.toFixed(3)}], alpha=${alpha.toFixed(6)}`,
          };
        }
      }
    } else {
      // =======================================================================
      // 通常時 (s^2 > 0): Student-t 検定と信頼下限の厳格適用
      // =======================================================================
      const df = n - 1;
      const tStat = (meanPairScore - 0.5) / standardError;
      const pT = studentTOneTailedPValue(tStat, df);
      const tCrit = studentTOneTailedCritical(alpha, df);

      // 片側 (1 - alpha) 信頼下限: L = mean - tCrit * SE
      // 数学的に L > 0.5 <=> tStat > tCrit <=> pT < alpha が完全に成立する
      lowerCI = Math.max(0.0, meanPairScore - tCrit * standardError);
      upperCI = Math.min(1.0, meanPairScore + tCrit * standardError);

      const isSignificant = pT < alpha && meanPairScore > 0.5;

      statisticalTest = {
        method: "STUDENT_T",
        statistic: tStat,
        pValue: pT,
        degreesOfFreedom: df,
        criticalValue: tCrit,
        alphaUsed: alpha,
        isStatisticallySignificant: isSignificant,
        testNotes: `One-tailed Student-t: t=${tStat.toFixed(4)}, df=${df}, p=${pT.toFixed(6)}, critical_t=${tCrit.toFixed(4)}, alpha=${alpha.toFixed(6)}`,
      };
    }

    const targetMet = meanPairScore >= targetWinRate;

    // 4. Improvement Status 判定 (Evidence が VALID の場合のみ判定可能)
    let improvementStatus: ImprovementStatus = "IMPROVEMENT_UNVERIFIED";

    if (evidenceStatus === "VALID") {
      if (statisticalTest.isStatisticallySignificant && targetMet && lowerCI > 0.5) {
        improvementStatus = "IMPROVEMENT_VERIFIED";
      } else if (meanPairScore < 0.5 && upperCI < 0.5) {
        // 明確な性能低下 (Regression) の判定
        if (sampleVariance > 0.0) {
          const df = n - 1;
          const tStat = (meanPairScore - 0.5) / standardError;
          const tCrit = studentTOneTailedCritical(alpha, df);
          if (tStat < -tCrit) {
            improvementStatus = "CONFIRMED_REGRESSION";
          } else {
            improvementStatus = "IMPROVEMENT_UNVERIFIED";
          }
        } else {
          const regressionP = exactBinomialOneTailedPValue(pairLosses, n);
          if (regressionP < alpha) {
            improvementStatus = "CONFIRMED_REGRESSION";
          } else {
            improvementStatus = "IMPROVEMENT_UNVERIFIED";
          }
        }
      } else {
        improvementStatus = "IMPROVEMENT_UNVERIFIED";
      }
    }

    return {
      meanPairScore,
      sampleVariance,
      standardError,
      confidenceInterval95: { lower: lowerCI, upper: upperCI, confidenceLevel: 1.0 - alpha },
      statisticalTest,
      evidenceStatus,
      improvementStatus,
      targetMet,
    };
  }

  /**
   * 設定の Fail-Fast 事前検証
   */
  public static validateConfig(config: EvaluationConfig): void {
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

    // 有意水準 alpha の検証 (0 < alpha < 1, 有限数)
    if (
      typeof significanceLevelAlpha !== "number" ||
      !Number.isFinite(significanceLevelAlpha) ||
      significanceLevelAlpha <= 0 ||
      significanceLevelAlpha >= 1
    ) {
      throw new EvaluationConfigurationError(
        `Invalid significanceLevelAlpha: must be a finite number between 0 and 1, got ${significanceLevelAlpha}`
      );
    }

    // minimumCompletedPairs の検証 (正の整数)
    if (
      typeof minimumCompletedPairs !== "number" ||
      !Number.isFinite(minimumCompletedPairs) ||
      !Number.isInteger(minimumCompletedPairs) ||
      minimumCompletedPairs < 1
    ) {
      throw new EvaluationConfigurationError(
        `Invalid minimumCompletedPairs: must be a positive integer >= 1, got ${minimumCompletedPairs}`
      );
    }

    // maxDecisionsPerMatch の検証 (正の整数)
    if (
      typeof maxDecisionsPerMatch !== "number" ||
      !Number.isFinite(maxDecisionsPerMatch) ||
      !Number.isInteger(maxDecisionsPerMatch) ||
      maxDecisionsPerMatch < 1
    ) {
      throw new EvaluationConfigurationError(
        `Invalid maxDecisionsPerMatch: must be a positive integer >= 1, got ${maxDecisionsPerMatch}`
      );
    }

    // seeds の検証
    if (!Array.isArray(seeds) || seeds.length === 0) {
      throw new EvaluationConfigurationError("seeds must be a non-empty array of numbers");
    }
    for (const seed of seeds) {
      if (typeof seed !== "number" || !Number.isFinite(seed) || !Number.isInteger(seed)) {
        throw new EvaluationConfigurationError(`Invalid seed in seeds array: ${seed}`);
      }
    }

    // seedCategory の検証
    const validCategories: Set<EvaluationSeedCategory> = new Set(["TRAINING", "VALIDATION", "HOLDOUT"]);
    if (!validCategories.has(seedCategory)) {
      throw new EvaluationConfigurationError(`Invalid seedCategory: ${seedCategory}`);
    }

    // opponents の検証 (非空、ID一意性、targetWinRate 0..1)
    if (!Array.isArray(opponents) || opponents.length === 0) {
      throw new EvaluationConfigurationError("opponents must be a non-empty array");
    }

    const seenOpponentIds = new Set<string>();
    for (const opp of opponents) {
      if (!opp || typeof opp !== "object") {
        throw new EvaluationConfigurationError("Each opponent in opponents array must be a valid object");
      }
      if (!opp.opponentId || typeof opp.opponentId !== "string" || opp.opponentId.trim() === "") {
        throw new EvaluationConfigurationError(`Opponent missing valid opponentId: ${JSON.stringify(opp)}`);
      }
      if (seenOpponentIds.has(opp.opponentId)) {
        throw new EvaluationConfigurationError(`Duplicate opponentId found: "${opp.opponentId}"`);
      }
      seenOpponentIds.add(opp.opponentId);

      if (
        typeof opp.targetWinRate !== "number" ||
        !Number.isFinite(opp.targetWinRate) ||
        opp.targetWinRate < 0 ||
        opp.targetWinRate > 1
      ) {
        throw new EvaluationConfigurationError(
          `Invalid targetWinRate for opponent "${opp.opponentId}": must be a finite number between 0 and 1, got ${opp.targetWinRate}`
        );
      }

      if (typeof opp.policyFactory !== "function") {
        throw new EvaluationConfigurationError(
          `Opponent "${opp.opponentId}" missing required policyFactory function`
        );
      }
    }

    // sessionFactory の検証
    if (typeof sessionFactory !== "function") {
      throw new EvaluationConfigurationError("sessionFactory must be a function");
    }

    // regulationId, rulePackageVersion の検証
    if (typeof regulationId !== "string" || regulationId.trim() === "") {
      throw new EvaluationConfigurationError("regulationId must be a non-empty string");
    }
    if (typeof rulePackageVersion !== "string" || rulePackageVersion.trim() === "") {
      throw new EvaluationConfigurationError("rulePackageVersion must be a non-empty string");
    }

    // DNA 形式検証 (有限値・スキーマ整合)
    DecisionDNACodec.validate(candidateDNA);
    if (candidateDNA.featureSchemaVersion !== featureSchemaVersion) {
      throw new EvaluationConfigurationError(
        `Feature schema mismatch: candidate DNA schemaVersion=${candidateDNA.featureSchemaVersion} does not match config featureSchemaVersion=${featureSchemaVersion}`
      );
    }
  }

  /**
   * 独立対戦評価 (Independent Evaluation) を実行
   */
  public static evaluate(config: EvaluationConfig): IndependentEvaluationResult {
    const startTime = performance.now();

    // 1. 設定の Fail-Fast 検証
    this.validateConfig(config);

    const {
      candidateDNA,
      seeds,
      seedCategory,
      seedRegistry,
      opponents,
      sessionFactory,
      maxDecisionsPerMatch = 500,
      significanceLevelAlpha = DEFAULT_SIGNIFICANCE_ALPHA,
      minimumCompletedPairs = DEFAULT_MINIMUM_COMPLETED_PAIRS,
      regulationId = "standard-pack",
      rulePackageVersion = "1.0.0",
      featureSchemaVersion = 6,
    } = config;

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

    // 2. Seed 衝突の横断的検証
    const seedSetsToVerify: EvaluationSeedSet[] = [];
    if (seedRegistry && Array.isArray(seedRegistry)) {
      seedSetsToVerify.push(...seedRegistry);
    }
    // 現在の評価セットも含める
    seedSetsToVerify.push({ category: seedCategory, seeds });
    this.assertNoSeedCollision(seedSetsToVerify);

    // 3. 多重比較の Bonferroni 補正 alpha の算出
    const K = opponents.length;
    const bonferroniAdjustedAlpha = significanceLevelAlpha / K;

    // 4. 対戦相手ごとの座席反転ペア対戦実行 (作業メモリ O(1) に配慮)
    const opponentSummaries: Record<string, OpponentEvaluationSummary> = {};
    const allPairs: PairedMatchResult[] = [];
    let pairCounter = 0;

    for (const opponent of opponents) {
      const opponentPairs: PairedMatchResult[] = [];
      const completedPairScores: number[] = [];
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

        if (pairResult.status === "COMPLETED" && pairResult.pairScore !== null) {
          completedPairs++;
          completedPairScores.push(pairResult.pairScore);
        } else if (pairResult.status === "INCOMPLETE") {
          incompletePairs++;
        } else if (pairResult.status === "FAILED") {
          failedPairs++;
        }
      }

      // 統計指標・検定の計算 (完了ペアのみのスコアを渡す)
      const stats = this.computeStatistics({
        pairScores: completedPairScores,
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
        pairScores: Object.freeze(completedPairScores),
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

    // 5. 総合ステータス集計
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

    const endTime = performance.now();
    const timestamp = new Date().toISOString();

    const logicalResult: IndependentEvaluationLogicalResult = {
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
    };

    const runtimeMetrics: IndependentEvaluationRuntimeMetrics = {
      timestamp,
      totalExecutionTimeMs: endTime - startTime,
    };

    return {
      ...logicalResult,
      logicalResult,
      runtimeMetrics,
      timestamp,
    };
  }
}
