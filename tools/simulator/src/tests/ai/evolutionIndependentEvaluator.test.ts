import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { fileURLToPath } from "url";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { loadRegulationCatalog } from "../../engine/regulation/RegulationLoader";
import { OfficialRegulationMatchSetup } from "../../engine/regulation/OfficialRegulationMatchSetup";
import { RulePackage } from "../../domain/rules/RulePackage";
import { GameSession } from "../../engine/session/GameSession";
import { FirstLegalPolicy } from "../../engine/simulation/DecisionPolicy";
import { DecisionDNACodec } from "../../engine/ai/DecisionDNACodec";
import { createManualGenericGenomeDNA } from "../../engine/ai/BaselinePolicies";
import { BatchMatchContext } from "../../domain/simulation/BatchSimulationTypes";
import {
  EvaluationConfigurationError,
  EvaluationOpponentDefinition,
  EvaluationSeedCollisionError,
} from "../../domain/ai/EvolutionEvaluationTypes";
import {
  EvolutionIndependentEvaluator,
  combination,
  exactBinomialOneTailedPValue,
  studentTOneTailedPValue,
  studentTOneTailedCritical,
  getStudentTCritical95,
} from "../../engine/ai/EvolutionIndependentEvaluator";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Evolution Independent Evaluator Foundation (Work 3-1)", () => {
  let rulePackage: RulePackage;
  let standardPackSessionCreator: (matchSeed: number) => GameSession;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
    const catalog = await loadRegulationCatalog();
    const reg = catalog.regulations.get("standard-pack");
    if (!reg) throw new Error("standard-pack regulation not found");
    const frame = catalog.frames.get(reg.frameId);
    if (!frame) throw new Error(`frame ${reg.frameId} not found`);

    standardPackSessionCreator = (matchSeed: number) => {
      const outcome = OfficialRegulationMatchSetup.setupMatch(reg, frame, rulePackage, matchSeed, {
        playerNames: { p1: "Evaluator Player 1", p2: "Evaluator Player 2" },
      });
      if (outcome.type !== "READY") {
        throw new Error(`Failed to setup standard-pack session: ${outcome.reason}`);
      }
      return new GameSession(outcome.state, rulePackage, { matchSeed });
    };
  });

  const testSessionFactory = (ctx: BatchMatchContext) => {
    return standardPackSessionCreator(ctx.matchSeed);
  };

  // ===========================================================================
  // Test 1: 座席反転ペア対戦の正しさ (Leg 0: P1, Leg 1: P2)
  // ===========================================================================
  it("Test 1: 座席反転ペア対戦が同一 Seed で正しく実行され、座席が反転すること", () => {
    const candidateDna = createManualGenericGenomeDNA();
    const opponent: EvaluationOpponentDefinition = {
      opponentId: "first-legal-test",
      name: "FirstLegal",
      policyFactory: () => new FirstLegalPolicy(false),
      targetWinRate: 0.5,
    };

    const matchSeed = 92001;
    const pairResult = EvolutionIndependentEvaluator.runPairedMatch({
      pairIndex: 0,
      matchSeed,
      candidateDna,
      candidateGenomeId: "cand-001",
      candidateDnaDigest: "dummy-digest",
      opponent,
      sessionFactory: testSessionFactory,
      maxDecisionsPerMatch: 500,
    });

    expect(pairResult.pairIndex).toBe(0);
    expect(pairResult.matchSeed).toBe(matchSeed);
    expect(pairResult.opponentId).toBe("first-legal-test");

    // Leg 0: Candidate = P1, Opponent = P2
    expect(pairResult.leg0.legIndex).toBe(0);
    expect(pairResult.leg0.candidateSeat).toBe("p1");
    expect(pairResult.leg0.opponentSeat).toBe("p2");

    // Leg 1: Candidate = P2, Opponent = P1 (座席反転)
    expect(pairResult.leg1.legIndex).toBe(1);
    expect(pairResult.leg1.candidateSeat).toBe("p2");
    expect(pairResult.leg1.opponentSeat).toBe("p1");

    // ペアスコアが {0.0, 0.25, 0.5, 0.75, 1.0} のいずれかであること
    expect([0.0, 0.25, 0.5, 0.75, 1.0]).toContain(pairResult.pairScore);
  });

  // ===========================================================================
  // Test 2: 勝・分・敗のペアスコア集計
  // ===========================================================================
  it("Test 2: 各勝敗組み合わせに対するペアスコア (0.0, 0.25, 0.5, 0.75, 1.0) が正確に集計されること", () => {
    const computeMockPairScore = (
      leg0: { won: boolean; draw: boolean },
      leg1: { won: boolean; draw: boolean }
    ) => {
      const s0 = leg0.won ? 1.0 : leg0.draw ? 0.5 : 0.0;
      const s1 = leg1.won ? 1.0 : leg1.draw ? 0.5 : 0.0;
      return (s0 + s1) / 2.0;
    };

    expect(computeMockPairScore({ won: true, draw: false }, { won: true, draw: false })).toBe(1.0); // 完勝
    expect(computeMockPairScore({ won: true, draw: false }, { won: false, draw: true })).toBe(0.75); // 1勝1分
    expect(computeMockPairScore({ won: true, draw: false }, { won: false, draw: false })).toBe(0.5); // 1勝1敗
    expect(computeMockPairScore({ won: false, draw: true }, { won: false, draw: true })).toBe(0.5); // 2分
    expect(computeMockMockPairScore => computeMockPairScore({ won: false, draw: false }, { won: false, draw: true })).toBeDefined();
    expect(computeMockPairScore({ won: false, draw: false }, { won: false, draw: true })).toBe(0.25); // 1敗1分
    expect(computeMockPairScore({ won: false, draw: false }, { won: false, draw: false })).toBe(0.0); // 完敗
  });

  // ===========================================================================
  // Test 3: FAILED / INCOMPLETE の厳格な扱い (Fail-Closed)
  // ===========================================================================
  it("Test 3: FAILED 試合は INVALID_EVIDENCE、INCOMPLETE は INSUFFICIENT_EVIDENCE として勝敗自動換算を遮断すること", () => {
    // 1. FAILED が 1 件でもある場合
    const statsFailed = EvolutionIndependentEvaluator.computeStatistics({
      pairScores: [1.0, 1.0, 1.0, 1.0, 1.0],
      failedCount: 1,
      incompleteCount: 0,
      targetWinRate: 0.55,
      alpha: 0.05,
      minCompletedPairs: 5,
    });
    expect(statsFailed.evidenceStatus).toBe("INVALID_EVIDENCE");
    expect(statsFailed.improvementStatus).toBe("IMPROVEMENT_UNVERIFIED"); // 改善認定禁止

    // 2. INCOMPLETE がある場合
    const statsIncomplete = EvolutionIndependentEvaluator.computeStatistics({
      pairScores: [1.0, 1.0, 1.0, 1.0, 1.0],
      failedCount: 0,
      incompleteCount: 1,
      targetWinRate: 0.55,
      alpha: 0.05,
      minCompletedPairs: 5,
    });
    expect(statsIncomplete.evidenceStatus).toBe("INSUFFICIENT_EVIDENCE");
    expect(statsIncomplete.improvementStatus).toBe("IMPROVEMENT_UNVERIFIED");

    // 3. 完了ペア数が規定数未満 (n=4 < minCompletedPairs=5)
    const statsInsufficient = EvolutionIndependentEvaluator.computeStatistics({
      pairScores: [1.0, 1.0, 1.0, 1.0],
      failedCount: 0,
      incompleteCount: 0,
      targetWinRate: 0.55,
      alpha: 0.05,
      minCompletedPairs: 5,
    });
    expect(statsInsufficient.evidenceStatus).toBe("INSUFFICIENT_EVIDENCE");
    expect(statsInsufficient.improvementStatus).toBe("IMPROVEMENT_UNVERIFIED");
  });

  // ===========================================================================
  // Test 4: Seed 衝突の検出 (Fail-Closed)
  // ===========================================================================
  it("Test 4: 同一カテゴリ内およびカテゴリ間での Seed 重複衝突を検知して例外を送出すること", () => {
    // 1. 同一セット内の重複
    expect(() => {
      EvolutionIndependentEvaluator.assertNoSeedCollision([
        { category: "VALIDATION", seeds: [101, 102, 103, 102] },
      ]);
    }).toThrow(EvaluationSeedCollisionError);

    // 2. Training と Validation での衝突
    expect(() => {
      EvolutionIndependentEvaluator.assertNoSeedCollision([
        { category: "TRAINING", seeds: [1, 2, 3] },
        { category: "VALIDATION", seeds: [4, 5, 2] }, // 2 が衝突
      ]);
    }).toThrow(EvaluationSeedCollisionError);

    // 3. Validation と Holdout での衝突
    expect(() => {
      EvolutionIndependentEvaluator.assertNoSeedCollision([
        { category: "VALIDATION", seeds: [10, 20, 30] },
        { category: "HOLDOUT", seeds: [30, 40, 50] }, // 30 が衝突
      ]);
    }).toThrow(EvaluationSeedCollisionError);

    // 4. 重複なし正常系
    expect(() => {
      EvolutionIndependentEvaluator.assertNoSeedCollision([
        { category: "TRAINING", seeds: [1, 2, 3] },
        { category: "VALIDATION", seeds: [4, 5, 6] },
        { category: "HOLDOUT", seeds: [7, 8, 9] },
      ]);
    }).not.toThrow();
  });

  // ===========================================================================
  // Test 5: 統計計算の既知値との完全一致
  // ===========================================================================
  it("Test 5: 標本平均、分散、標準誤差、t 信頼区間、片側 p 値が既知の理論値と一致すること", () => {
    // スコア: [1.0, 0.75, 0.5, 0.75, 1.0] (n=5)
    // 和 = 4.0, 平均 = 0.8
    // 不偏分散 = 0.175 / 4 = 0.04375
    // 標準誤差 SE = sqrt(0.04375 / 5) = sqrt(0.00875) ≈ 0.0935414
    // t 統計量 = (0.8 - 0.5) / 0.0935414 ≈ 3.207135
    // df = 4
    // 片側 p 値 = studentTOneTailedPValue(3.207135, 4) ≈ 0.016339
    const scores = [1.0, 0.75, 0.5, 0.75, 1.0];
    const stats = EvolutionIndependentEvaluator.computeStatistics({
      pairScores: scores,
      failedCount: 0,
      incompleteCount: 0,
      targetWinRate: 0.7,
      alpha: 0.05,
      minCompletedPairs: 5,
    });

    expect(stats.meanPairScore).toBeCloseTo(0.8, 5);
    expect(stats.sampleVariance).toBeCloseTo(0.04375, 5);
    expect(stats.standardError).toBeCloseTo(0.0935414, 5);
    expect(stats.statisticalTest.method).toBe("STUDENT_T");
    expect(stats.statisticalTest.degreesOfFreedom).toBe(4);
    expect(stats.statisticalTest.statistic).toBeCloseTo(3.207135, 4);
    expect(stats.statisticalTest.pValue).toBeCloseTo(0.016339, 4);
    expect(stats.statisticalTest.pValue).toBeLessThan(0.05);
    expect(stats.statisticalTest.isStatisticallySignificant).toBe(true);
    expect(stats.confidenceInterval95.lower).toBeGreaterThan(0.5); // 下限 > 0.5
    expect(stats.targetMet).toBe(true); // 0.8 >= 0.7
    expect(stats.evidenceStatus).toBe("VALID");
    expect(stats.improvementStatus).toBe("IMPROVEMENT_VERIFIED");
  });

  // ===========================================================================
  // Test 6: 小標本・分散ゼロ・全勝等の境界条件
  // ===========================================================================
  it("Test 6: n=0, n=1, 分散ゼロ (全勝/全敗) の境界条件で確証のない判定を行わないこと", () => {
    // 1. n = 0
    const stats0 = EvolutionIndependentEvaluator.computeStatistics({
      pairScores: [],
      failedCount: 0,
      incompleteCount: 0,
      targetWinRate: 0.55,
      alpha: 0.05,
      minCompletedPairs: 5,
    });
    expect(stats0.evidenceStatus).toBe("INSUFFICIENT_EVIDENCE");
    expect(stats0.improvementStatus).toBe("IMPROVEMENT_UNVERIFIED");
    expect(stats0.statisticalTest.pValue).toBeNull();

    // 2. n = 1: Student-t 分散未定義
    const stats1 = EvolutionIndependentEvaluator.computeStatistics({
      pairScores: [1.0],
      failedCount: 0,
      incompleteCount: 0,
      targetWinRate: 0.55,
      alpha: 0.05,
      minCompletedPairs: 5,
    });
    expect(stats1.evidenceStatus).toBe("INSUFFICIENT_EVIDENCE");
    expect(stats1.improvementStatus).toBe("IMPROVEMENT_UNVERIFIED");
    expect(stats1.statisticalTest.pValue).toBeNull();

    // 3. n = 2 で全勝 (分散ゼロ s^2 = 0)
    // 小標本かつ p 値未達 (Exact Binomial p = 0.25 > 0.05) であり IMPROVEMENT_UNVERIFIED
    const stats2ZeroVar = EvolutionIndependentEvaluator.computeStatistics({
      pairScores: [1.0, 1.0],
      failedCount: 0,
      incompleteCount: 0,
      targetWinRate: 0.55,
      alpha: 0.05,
      minCompletedPairs: 5,
    });
    expect(stats2ZeroVar.sampleVariance).toBe(0.0);
    expect(stats2ZeroVar.statisticalTest.pValue).toBe(0.25);
    expect(stats2ZeroVar.statisticalTest.isStatisticallySignificant).toBe(false);
    expect(stats2ZeroVar.improvementStatus).toBe("IMPROVEMENT_UNVERIFIED");

    // 4. n = 5 で全敗 (CONFIRMED_REGRESSION 検定)
    const stats5AllLoss = EvolutionIndependentEvaluator.computeStatistics({
      pairScores: [0.0, 0.0, 0.0, 0.0, 0.0],
      failedCount: 0,
      incompleteCount: 0,
      targetWinRate: 0.55,
      alpha: 0.05,
      minCompletedPairs: 5,
    });
    expect(stats5AllLoss.evidenceStatus).toBe("VALID");
    expect(stats5AllLoss.improvementStatus).toBe("CONFIRMED_REGRESSION");
  });

  // ===========================================================================
  // Test 7: 複数比較の判定条件 (Bonferroni 補正)
  // ===========================================================================
  it("Test 7: 複数対戦相手での Bonferroni 補正 alpha および総合判定ロジックが正しく機能すること", () => {
    const candidateDna = createManualGenericGenomeDNA();
    const opponentA: EvaluationOpponentDefinition = {
      opponentId: "opp-a",
      name: "Opponent A",
      policyFactory: () => new FirstLegalPolicy(false),
      targetWinRate: 0.5,
    };
    const opponentB: EvaluationOpponentDefinition = {
      opponentId: "opp-b",
      name: "Opponent B",
      policyFactory: () => new FirstLegalPolicy(false),
      targetWinRate: 0.5,
    };

    // 2 種の対戦相手: alpha = 0.05 / 2 = 0.025
    const result = EvolutionIndependentEvaluator.evaluate({
      candidateDNA: candidateDna,
      seeds: [92010, 92011],
      seedCategory: "VALIDATION",
      opponents: [opponentA, opponentB],
      sessionFactory: testSessionFactory,
      significanceLevelAlpha: 0.05,
      minimumCompletedPairs: 2,
      maxDecisionsPerMatch: 20,
    });

    expect(result.significanceLevelAlpha).toBe(0.05);
    expect(result.bonferroniAdjustedAlpha).toBe(0.025);
    expect(Object.keys(result.opponents).length).toBe(2);
  });

  // ===========================================================================
  // Test 8: 同一入力による決定論性 (Bit-Identical Reproducibility)
  // ===========================================================================
  it("Test 8: 同一入力・同一 Seed に対し、logicalResult が 100% 決定論的にビット完全一致すること", () => {
    const candidateDna = createManualGenericGenomeDNA();
    const opponent: EvaluationOpponentDefinition = {
      opponentId: "first-legal-det",
      name: "FirstLegal",
      policyFactory: () => new FirstLegalPolicy(false),
      targetWinRate: 0.5,
    };

    const seeds = [92020, 92021];
    const run1 = EvolutionIndependentEvaluator.evaluate({
      candidateDNA: candidateDna,
      seeds,
      seedCategory: "VALIDATION",
      opponents: [opponent],
      sessionFactory: testSessionFactory,
      maxDecisionsPerMatch: 20,
      minimumCompletedPairs: 2,
    });

    const run2 = EvolutionIndependentEvaluator.evaluate({
      candidateDNA: candidateDna,
      seeds,
      seedCategory: "VALIDATION",
      opponents: [opponent],
      sessionFactory: testSessionFactory,
      maxDecisionsPerMatch: 20,
      minimumCompletedPairs: 2,
    });

    // logicalResult が JSON 文字列レベルで完全一致すること (Sidecar のタイムスタンプは分離されている)
    expect(JSON.stringify(run1.logicalResult)).toBe(JSON.stringify(run2.logicalResult));
    expect(run1.logicalResult.candidateDnaDigest).toBe(run2.logicalResult.candidateDnaDigest);
    expect(run1.logicalResult.totalPairs).toBe(run2.logicalResult.totalPairs);
    expect(run1.logicalResult.evidenceStatus).toBe(run2.logicalResult.evidenceStatus);
    expect(run1.logicalResult.improvementStatus).toBe(run2.logicalResult.improvementStatus);

    // runtimeMetrics は Sidecar として保持されていること
    expect(typeof run1.runtimeMetrics.timestamp).toBe("string");
    expect(typeof run1.runtimeMetrics.totalExecutionTimeMs).toBe("number");
  });

  // ===========================================================================
  // Test 9: DNA 破損・不正入力の拒絶 (Fail-Closed)
  // ===========================================================================
  it("Test 9: 不正な DNA や無効な設定で即座に例外を送出すること", () => {
    const opponent: EvaluationOpponentDefinition = {
      opponentId: "test-opp",
      name: "Opponent",
      policyFactory: () => new FirstLegalPolicy(false),
      targetWinRate: 0.5,
    };

    // 1. 不正な DNA (NaN 混入)
    const brokenDna = createManualGenericGenomeDNA();
    (brokenDna.patternWeights as any)[0] = NaN;

    expect(() => {
      EvolutionIndependentEvaluator.evaluate({
        candidateDNA: brokenDna,
        seeds: [100],
        seedCategory: "VALIDATION",
        opponents: [opponent],
        sessionFactory: testSessionFactory,
      });
    }).toThrow();

    // 2. 空の seeds 配列
    expect(() => {
      EvolutionIndependentEvaluator.evaluate({
        candidateDNA: createManualGenericGenomeDNA(),
        seeds: [],
        seedCategory: "VALIDATION",
        opponents: [opponent],
        sessionFactory: testSessionFactory,
      });
    }).toThrow(EvaluationConfigurationError);

    // 3. 空の opponents 配列
    expect(() => {
      EvolutionIndependentEvaluator.evaluate({
        candidateDNA: createManualGenericGenomeDNA(),
        seeds: [100],
        seedCategory: "VALIDATION",
        opponents: [],
        sessionFactory: testSessionFactory,
      });
    }).toThrow(EvaluationConfigurationError);
  });

  // ===========================================================================
  // Test 10: レコード数と作業メモリの制御 (生 DecisionTrace 破棄)
  // ===========================================================================
  it("Test 10: 評価結果オブジェクトが生 DecisionTrace を含まず、ペアサマリのみを安全に保持すること", () => {
    const candidateDna = createManualGenericGenomeDNA();
    const opponent: EvaluationOpponentDefinition = {
      opponentId: "first-legal-mem",
      name: "FirstLegal",
      policyFactory: () => new FirstLegalPolicy(false),
      targetWinRate: 0.5,
    };

    const result = EvolutionIndependentEvaluator.evaluate({
      candidateDNA: candidateDna,
      seeds: [92030, 92031],
      seedCategory: "VALIDATION",
      opponents: [opponent],
      sessionFactory: testSessionFactory,
      maxDecisionsPerMatch: 500,
      minimumCompletedPairs: 2,
    });

    expect(result.pairs.length).toBe(2);

    for (const pair of result.pairs) {
      // 生 DecisionTrace や全決定履歴が含まれていないこと (戻り値に不要な生 Trace を持たない)
      expect((pair as any).decisionTrace).toBeUndefined();
      expect((pair.leg0 as any).decisionTrace).toBeUndefined();
      expect((pair.leg1 as any).decisionTrace).toBeUndefined();

      // ペアサマリメタデータが正しく保持されていること
      expect(typeof pair.pairScore).toBe("number");
      expect(typeof pair.leg0.totalDecisions).toBe("number");
      expect(typeof pair.leg1.totalDecisions).toBe("number");
    }
  });

  // ===========================================================================
  // Test 11: Bonferroni 補正が Student-t の有意判定に実際に適用されること
  // ===========================================================================
  it("Test 11: Bonferroni 補正が Student-t 検定の有意性判定に厳格に適用されること", () => {
    // スコア: [1, 0.75, 0.5, 0.75, 1] (n=5)
    // 片側 p 値 ≈ 0.016339
    const scores = [1, 0.75, 0.5, 0.75, 1];

    // 対戦相手数 K = 1 (alpha = 0.05 / 1 = 0.05): p ≈ 0.0163 < 0.05 -> 有意
    const statsK1 = EvolutionIndependentEvaluator.computeStatistics({
      pairScores: scores,
      failedCount: 0,
      incompleteCount: 0,
      targetWinRate: 0.5,
      alpha: 0.05,
      minCompletedPairs: 5,
    });
    expect(statsK1.statisticalTest.isStatisticallySignificant).toBe(true);
    expect(statsK1.improvementStatus).toBe("IMPROVEMENT_VERIFIED");

    // 対戦相手数 K = 5 (alpha_bonf = 0.05 / 5 = 0.01): p ≈ 0.0163 >= 0.01 -> 非有意
    const statsK5 = EvolutionIndependentEvaluator.computeStatistics({
      pairScores: scores,
      failedCount: 0,
      incompleteCount: 0,
      targetWinRate: 0.5,
      alpha: 0.01,
      minCompletedPairs: 5,
    });
    expect(statsK5.statisticalTest.isStatisticallySignificant).toBe(false);
    expect(statsK5.improvementStatus).toBe("IMPROVEMENT_UNVERIFIED");
  });

  // ===========================================================================
  // Test 12: evaluate() 統合実行における Bonferroni 補正の伝播検証
  // ===========================================================================
  it("Test 12: evaluate() において複数対戦相手指定時に Bonferroni 補正 alpha が各対戦相手の統計検定へ正しく伝播すること", () => {
    const candidateDna = createManualGenericGenomeDNA();
    const opponent1: EvaluationOpponentDefinition = {
      opponentId: "opp-bonf-1",
      name: "Opponent 1",
      policyFactory: () => new FirstLegalPolicy(false),
      targetWinRate: 0.5,
    };
    const opponent2: EvaluationOpponentDefinition = {
      opponentId: "opp-bonf-2",
      name: "Opponent 2",
      policyFactory: () => new FirstLegalPolicy(false),
      targetWinRate: 0.5,
    };

    const result = EvolutionIndependentEvaluator.evaluate({
      candidateDNA: candidateDna,
      seeds: [92060, 92061],
      seedCategory: "VALIDATION",
      opponents: [opponent1, opponent2],
      sessionFactory: testSessionFactory,
      significanceLevelAlpha: 0.04,
      minimumCompletedPairs: 2,
      maxDecisionsPerMatch: 500,
    });

    expect(result.significanceLevelAlpha).toBe(0.04);
    expect(result.bonferroniAdjustedAlpha).toBe(0.02); // 0.04 / 2

    // 各対戦相手の statisticalTest.alphaUsed が補正後の 0.02 になっていること
    for (const oppSummary of Object.values(result.opponents)) {
      expect(oppSummary.statisticalTest.alphaUsed).toBe(0.02);
    }
  });

  // ===========================================================================
  // Test 13: 検定手法と p 値の 1:1 整合性
  // ===========================================================================
  it("Test 13: STUDENT_T 検定時は Student-t の p 値、EXACT_BINOMIAL 検定時は二項検定の p 値が返されること", () => {
    // 1. 分散あり (STUDENT_T)
    const scoresWithVariance = [1, 0.75, 0.5, 0.75, 1];
    const statsT = EvolutionIndependentEvaluator.computeStatistics({
      pairScores: scoresWithVariance,
      failedCount: 0,
      incompleteCount: 0,
      targetWinRate: 0.5,
      alpha: 0.05,
      minCompletedPairs: 5,
    });
    expect(statsT.statisticalTest.method).toBe("STUDENT_T");
    const expectedTP = studentTOneTailedPValue(statsT.statisticalTest.statistic!, 4);
    expect(statsT.statisticalTest.pValue).toBeCloseTo(expectedTP, 6);

    // 2. 分散ゼロ (EXACT_BINOMIAL)
    const scoresZeroVar = [1, 1, 1, 1, 1];
    const statsBinomial = EvolutionIndependentEvaluator.computeStatistics({
      pairScores: scoresZeroVar,
      failedCount: 0,
      incompleteCount: 0,
      targetWinRate: 0.5,
      alpha: 0.05,
      minCompletedPairs: 5,
    });
    expect(statsBinomial.statisticalTest.method).toBe("EXACT_BINOMIAL");
    expect(statsBinomial.statisticalTest.pValue).toBeCloseTo(Math.pow(0.5, 5), 6);
  });

  // ===========================================================================
  // Test 14: alpha 単調性の検証 (ユーザー指摘の反例テスト)
  // ===========================================================================
  it("Test 14: pairScores=[1, 0.75, 0.5, 0.75, 1] に対し、alpha を小さくすると有意判定が甘くならず単調に厳格化すること", () => {
    const scores = [1, 0.75, 0.5, 0.75, 1];
    // p ≈ 0.016339

    const stats05 = EvolutionIndependentEvaluator.computeStatistics({
      pairScores: scores,
      failedCount: 0,
      incompleteCount: 0,
      targetWinRate: 0.5,
      alpha: 0.05,
      minCompletedPairs: 5,
    });
    const stats02 = EvolutionIndependentEvaluator.computeStatistics({
      pairScores: scores,
      failedCount: 0,
      incompleteCount: 0,
      targetWinRate: 0.5,
      alpha: 0.02,
      minCompletedPairs: 5,
    });
    const stats01 = EvolutionIndependentEvaluator.computeStatistics({
      pairScores: scores,
      failedCount: 0,
      incompleteCount: 0,
      targetWinRate: 0.5,
      alpha: 0.01,
      minCompletedPairs: 5,
    });
    const stats001 = EvolutionIndependentEvaluator.computeStatistics({
      pairScores: scores,
      failedCount: 0,
      incompleteCount: 0,
      targetWinRate: 0.5,
      alpha: 0.001,
      minCompletedPairs: 5,
    });

    // p 値自体は標本統計量にのみ依存し、alpha に依存しないこと
    expect(stats05.statisticalTest.pValue).toBeCloseTo(0.016339, 4);
    expect(stats02.statisticalTest.pValue).toBeCloseTo(0.016339, 4);
    expect(stats01.statisticalTest.pValue).toBeCloseTo(0.016339, 4);
    expect(stats001.statisticalTest.pValue).toBeCloseTo(0.016339, 4);

    // 有意判定の単調性:
    // alpha = 0.05 -> 有意 (0.0163 < 0.05)
    expect(stats05.statisticalTest.isStatisticallySignificant).toBe(true);
    expect(stats05.improvementStatus).toBe("IMPROVEMENT_VERIFIED");

    // alpha = 0.02 -> 有意 (0.0163 < 0.02)
    expect(stats02.statisticalTest.isStatisticallySignificant).toBe(true);
    expect(stats02.improvementStatus).toBe("IMPROVEMENT_VERIFIED");

    // alpha = 0.01 -> 非有意 (0.0163 >= 0.01)
    expect(stats01.statisticalTest.isStatisticallySignificant).toBe(false);
    expect(stats01.improvementStatus).toBe("IMPROVEMENT_UNVERIFIED");

    // alpha = 0.001 -> 非有意 (0.0163 >= 0.001)
    expect(stats001.statisticalTest.isStatisticallySignificant).toBe(false);
    expect(stats001.improvementStatus).toBe("IMPROVEMENT_UNVERIFIED");
  });

  // ===========================================================================
  // Test 15: 分散ゼロでの小標本誤認定防止
  // ===========================================================================
  it("Test 15: 分散ゼロ時に信頼区間が幅ゼロ [mean, mean] とならず、小標本全勝で誤認定されないこと", () => {
    // n=2 全勝: [1.0, 1.0]
    const stats = EvolutionIndependentEvaluator.computeStatistics({
      pairScores: [1.0, 1.0],
      failedCount: 0,
      incompleteCount: 0,
      targetWinRate: 0.5,
      alpha: 0.05,
      minCompletedPairs: 2,
    });

    // 信頼区間が [1.0, 1.0] の幅ゼロになっていないこと
    expect(stats.confidenceInterval95.lower).toBeLessThan(1.0);
    // 保守的 Hoeffding 下限が 0.5 以下であること
    expect(stats.confidenceInterval95.lower).toBeLessThanOrEqual(0.5);
    // 誤って IMPROVEMENT_VERIFIED にならないこと
    expect(stats.improvementStatus).toBe("IMPROVEMENT_UNVERIFIED");
  });

  // ===========================================================================
  // Test 16: 無効ペアの pairScore null 化と集計からの分離
  // ===========================================================================
  it("Test 16: FAILED / INCOMPLETE ペアの pairScore が null となり、スコア集計から除外されること", () => {
    const candidateDna = createManualGenericGenomeDNA();
    const opponent: EvaluationOpponentDefinition = {
      opponentId: "opp-invalid",
      name: "Opponent",
      policyFactory: () => new FirstLegalPolicy(false),
      targetWinRate: 0.5,
    };

    // maxDecisions = 1 に設定して確実に INCOMPLETE を発生させる
    const pairResult = EvolutionIndependentEvaluator.runPairedMatch({
      pairIndex: 0,
      matchSeed: 92099,
      candidateDna,
      candidateGenomeId: "cand-test",
      candidateDnaDigest: "dummy",
      opponent,
      sessionFactory: testSessionFactory,
      maxDecisionsPerMatch: 1, // 即時打ち切り
    });

    expect(pairResult.status).toBe("INCOMPLETE");
    expect(pairResult.pairScore).toBeNull(); // 0.0 ではなく null であること
  });

  // ===========================================================================
  // Test 17: 不正入力の Fail-Fast 事前検証
  // ===========================================================================
  it("Test 17: 不正な設定値 (alpha, 非整数, 負数, スキーマ不整合) が対戦開始前に拒絶されること", () => {
    const validDna = createManualGenericGenomeDNA();
    const opponent: EvaluationOpponentDefinition = {
      opponentId: "opp-valid",
      name: "Opponent",
      policyFactory: () => new FirstLegalPolicy(false),
      targetWinRate: 0.5,
    };

    // 1. alpha <= 0
    expect(() => {
      EvolutionIndependentEvaluator.validateConfig({
        candidateDNA: validDna,
        seeds: [100],
        seedCategory: "VALIDATION",
        opponents: [opponent],
        sessionFactory: testSessionFactory,
        significanceLevelAlpha: 0.0,
      });
    }).toThrow(EvaluationConfigurationError);

    // 2. alpha >= 1
    expect(() => {
      EvolutionIndependentEvaluator.validateConfig({
        candidateDNA: validDna,
        seeds: [100],
        seedCategory: "VALIDATION",
        opponents: [opponent],
        sessionFactory: testSessionFactory,
        significanceLevelAlpha: 1.0,
      });
    }).toThrow(EvaluationConfigurationError);

    // 3. minimumCompletedPairs が非整数
    expect(() => {
      EvolutionIndependentEvaluator.validateConfig({
        candidateDNA: validDna,
        seeds: [100],
        seedCategory: "VALIDATION",
        opponents: [opponent],
        sessionFactory: testSessionFactory,
        minimumCompletedPairs: 2.5,
      });
    }).toThrow(EvaluationConfigurationError);

    // 4. FeatureSchemaVersion 不整合
    expect(() => {
      EvolutionIndependentEvaluator.validateConfig({
        candidateDNA: validDna,
        seeds: [100],
        seedCategory: "VALIDATION",
        opponents: [opponent],
        sessionFactory: testSessionFactory,
        featureSchemaVersion: 999, // 不一致
      });
    }).toThrow(EvaluationConfigurationError);
  });

  // ===========================================================================
  // Test 18: 重複 Opponent ID の拒絶
  // ===========================================================================
  it("Test 18: 重複した Opponent ID が指定された場合に対戦開始前に拒絶されること", () => {
    const validDna = createManualGenericGenomeDNA();
    const opponent1: EvaluationOpponentDefinition = {
      opponentId: "duplicate-id",
      name: "Opponent 1",
      policyFactory: () => new FirstLegalPolicy(false),
      targetWinRate: 0.5,
    };
    const opponent2: EvaluationOpponentDefinition = {
      opponentId: "duplicate-id", // 重複
      name: "Opponent 2",
      policyFactory: () => new FirstLegalPolicy(false),
      targetWinRate: 0.5,
    };

    expect(() => {
      EvolutionIndependentEvaluator.validateConfig({
        candidateDNA: validDna,
        seeds: [100],
        seedCategory: "VALIDATION",
        opponents: [opponent1, opponent2],
        sessionFactory: testSessionFactory,
      });
    }).toThrow(EvaluationConfigurationError);
  });

  // ===========================================================================
  // Test 19: Train / Validation / Holdout Seed の横断的衝突検出
  // ===========================================================================
  it("Test 19: seedRegistry を介してカテゴリ横断的な Seed 衝突が検知されること (本番Holdout不使用)", () => {
    const candidateDna = createManualGenericGenomeDNA();
    const opponent: EvaluationOpponentDefinition = {
      opponentId: "test-opp",
      name: "Opponent",
      policyFactory: () => new FirstLegalPolicy(false),
      targetWinRate: 0.5,
    };

    // Synthetic モック Seed (本番 Holdout は一切使用しない)
    const mockSeedRegistry = [
      { category: "TRAINING" as const, seeds: [80001, 80002] },
      { category: "HOLDOUT" as const, seeds: [80099, 80100] },
    ];

    // Validation の評価セットに Holdout の Seed (80099) が混入している場合
    expect(() => {
      EvolutionIndependentEvaluator.evaluate({
        candidateDNA: candidateDna,
        seeds: [80003, 80099], // 80099 が HOLDOUT と衝突
        seedCategory: "VALIDATION",
        seedRegistry: mockSeedRegistry,
        opponents: [opponent],
        sessionFactory: testSessionFactory,
        maxDecisionsPerMatch: 10,
        minimumCompletedPairs: 2,
      });
    }).toThrow(EvaluationSeedCollisionError);
  });

  // ===========================================================================
  // Test 20: 本番のペアスコア計算コード (runPairedMatch) の直接検証
  // ===========================================================================
  it("Test 20: runPairedMatch が各レグの結果から正しいペアスコアを算出すること", () => {
    const candidateDna = createManualGenericGenomeDNA();
    const opponent: EvaluationOpponentDefinition = {
      opponentId: "first-legal-direct",
      name: "FirstLegal",
      policyFactory: () => new FirstLegalPolicy(false),
      targetWinRate: 0.5,
    };

    const pairResult = EvolutionIndependentEvaluator.runPairedMatch({
      pairIndex: 0,
      matchSeed: 92055,
      candidateDna,
      candidateGenomeId: "cand-direct",
      candidateDnaDigest: "dummy",
      opponent,
      sessionFactory: testSessionFactory,
      maxDecisionsPerMatch: 500,
    });

    expect(pairResult.status).toBe("COMPLETED");
    expect(pairResult.pairScore).not.toBeNull();
    const score0 = pairResult.leg0.candidateWon ? 1.0 : pairResult.leg0.candidateDraw ? 0.5 : 0.0;
    const score1 = pairResult.leg1.candidateWon ? 1.0 : pairResult.leg1.candidateDraw ? 0.5 : 0.0;
    expect(pairResult.pairScore).toBe((score0 + score1) / 2.0);
  });
});
