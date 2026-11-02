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
      role: "BASELINE",
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
  // Test 5: 統計計算の既知値との完全一致 (両側 95% CI と片側信頼下限の分離)
  // ===========================================================================
  it("Test 5: 両側 95% 信頼区間と片側信頼下限、標本平均、分散、SE が既知理論値と一致すること", () => {
    // スコア: [1.0, 0.75, 0.5, 0.75, 1.0] (n=5)
    // 和 = 4.0, 平均 = 0.8
    // 不偏分散 = 0.175 / 4 = 0.04375
    // 標準誤差 SE = sqrt(0.04375 / 5) = sqrt(0.00875) ≈ 0.0935414
    // t 統計量 = (0.8 - 0.5) / 0.0935414 ≈ 3.207135
    // df = 4
    // 片側 p 値 = studentTOneTailedPValue(3.207135, 4) ≈ 0.016339
    // 片側 alpha=0.05 臨界値: t_{0.05, 4} ≈ 2.131847
    // 片側 95% 信頼下限: 0.8 - 2.131847 * 0.0935414 ≈ 0.600585 > 0.5
    // 両側 95% 信頼区間 (各側 0.025): t_{0.025, 4} ≈ 2.776445
    // 両側 95% CI: [0.8 - 2.776445 * 0.0935414, 0.8 + ...] = [0.54029, 1.0]
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

    // 片側信頼下限の検証
    expect(stats.statisticalTest.oneSidedLowerBound).toBeCloseTo(0.600585, 3);
    expect(stats.statisticalTest.oneSidedLowerBound).toBeGreaterThan(0.5);

    // 両側 95% 信頼区間の検証
    expect(stats.confidenceInterval95.confidenceLevel).toBe(0.95);
    expect(stats.confidenceInterval95.lower).toBeCloseTo(0.54029, 3);
    expect(stats.confidenceInterval95.lower).toBeGreaterThan(0.5);

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
    // EXACT_BINOMIAL: p = (0.5)^2 = 0.25 > 0.05, oneSidedLowerBound = 0.05^(1/2) = 0.2236 <= 0.5
    const stats2ZeroVar = EvolutionIndependentEvaluator.computeStatistics({
      pairScores: [1.0, 1.0],
      failedCount: 0,
      incompleteCount: 0,
      targetWinRate: 0.55,
      alpha: 0.05,
      minCompletedPairs: 5,
    });
    expect(stats2ZeroVar.sampleVariance).toBe(0.0);
    expect(stats2ZeroVar.statisticalTest.method).toBe("EXACT_BINOMIAL");
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
      role: "BASELINE",
      policyFactory: () => new FirstLegalPolicy(false),
      targetWinRate: 0.5,
    };
    const opponentB: EvaluationOpponentDefinition = {
      opponentId: "opp-b",
      name: "Opponent B",
      role: "BASELINE",
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
      role: "BASELINE",
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

    // logicalResult が JSON 文字列レベルで完全一致すること
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
      role: "BASELINE",
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
      role: "BASELINE",
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
      // 生 DecisionTrace が含まれていないこと
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
      role: "BASELINE",
      policyFactory: () => new FirstLegalPolicy(false),
      targetWinRate: 0.5,
    };
    const opponent2: EvaluationOpponentDefinition = {
      opponentId: "opp-bonf-2",
      name: "Opponent 2",
      role: "BASELINE",
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

    // 2. 分散ゼロ全勝 (EXACT_BINOMIAL)
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

    // p 値は標本統計量にのみ依存
    expect(stats05.statisticalTest.pValue).toBeCloseTo(0.016339, 4);
    expect(stats02.statisticalTest.pValue).toBeCloseTo(0.016339, 4);
    expect(stats01.statisticalTest.pValue).toBeCloseTo(0.016339, 4);
    expect(stats001.statisticalTest.pValue).toBeCloseTo(0.016339, 4);

    // 有意判定の単調性
    expect(stats05.statisticalTest.isStatisticallySignificant).toBe(true);
    expect(stats02.statisticalTest.isStatisticallySignificant).toBe(true);
    expect(stats01.statisticalTest.isStatisticallySignificant).toBe(false);
    expect(stats001.statisticalTest.isStatisticallySignificant).toBe(false);
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
    // 片側下限が 0.5 以下であること
    expect(stats.statisticalTest.oneSidedLowerBound).toBeLessThanOrEqual(0.5);
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
      role: "BASELINE",
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
    expect(pairResult.pairScore).toBeNull();
  });

  // ===========================================================================
  // Test 17: 不正入力の Fail-Fast 事前検証
  // ===========================================================================
  it("Test 17: 不正な設定値 (alpha, 非整数, 負数, スキーマ不整合) が対戦開始前に拒絶されること", () => {
    const validDna = createManualGenericGenomeDNA();
    const opponent: EvaluationOpponentDefinition = {
      opponentId: "opp-valid",
      name: "Opponent",
      role: "BASELINE",
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
        featureSchemaVersion: 999,
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
      role: "BASELINE",
      policyFactory: () => new FirstLegalPolicy(false),
      targetWinRate: 0.5,
    };
    const opponent2: EvaluationOpponentDefinition = {
      opponentId: "duplicate-id", // 重複
      name: "Opponent 2",
      role: "BASELINE",
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
      role: "BASELINE",
      policyFactory: () => new FirstLegalPolicy(false),
      targetWinRate: 0.5,
    };

    const mockSeedRegistry = [
      { category: "TRAINING" as const, seeds: [80001, 80002] },
      { category: "HOLDOUT" as const, seeds: [80099, 80100] },
    ];

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
      role: "BASELINE",
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

  // ===========================================================================
  // Test 21 (R2): Student-t 臨界値と外部独立既知値 (NIST/R 参照値) の厳密照合
  // ===========================================================================
  it("Test 21 (R2): Student-t 臨界値が独立した外部理論値 (NIST/R 参照値) と高精度に一致すること", () => {
    // 外部独立参照値:
    // alpha = 0.05 (片側 5%):
    // df = 4  -> 2.131847
    // df = 10 -> 1.812461
    // df = 30 -> 1.697261
    expect(studentTOneTailedCritical(0.05, 4)).toBeCloseTo(2.131847, 4);
    expect(studentTOneTailedCritical(0.05, 10)).toBeCloseTo(1.812461, 4);
    expect(studentTOneTailedCritical(0.05, 30)).toBeCloseTo(1.697261, 4);

    // alpha = 0.01 (片側 1%):
    // df = 4  -> 3.746947
    // df = 10 -> 2.763769
    // df = 30 -> 2.457262
    expect(studentTOneTailedCritical(0.01, 4)).toBeCloseTo(3.746947, 4);
    expect(studentTOneTailedCritical(0.01, 10)).toBeCloseTo(2.763769, 4);
    expect(studentTOneTailedCritical(0.01, 30)).toBeCloseTo(2.457262, 4);

    // alpha = 0.025 (両側 95% = 片側 2.5%):
    // df = 4  -> 2.776445
    // df = 10 -> 2.228139
    // df = 30 -> 2.042272
    expect(getStudentTCritical95(4)).toBeCloseTo(2.776445, 4);
    expect(getStudentTCritical95(10)).toBeCloseTo(2.228139, 4);
    expect(getStudentTCritical95(30)).toBeCloseTo(2.042272, 4);
  });

  // ===========================================================================
  // Test 22 (R2): 分散ゼロ (全ペア 0.75) における HOEFFDING_BOUND 統計契約
  // ===========================================================================
  it("Test 22 (R2): 全ペア 0.75 の分散ゼロ時、二項符号検定を混在させず HOEFFDING_BOUND (pValue: null) として仮説と下限を完全整合させること", () => {
    // 5ペアすべて 0.75 (1勝1分のみ)
    // 帰無仮説 H0: mu <= 0.5 vs H1: mu > 0.5
    // Hoeffding 片側 (1 - 0.05) 信頼下限:
    // L = 0.75 - sqrt(ln(20) / 10) = 0.75 - 0.54733 = 0.20267 <= 0.5
    const stats = EvolutionIndependentEvaluator.computeStatistics({
      pairScores: [0.75, 0.75, 0.75, 0.75, 0.75],
      failedCount: 0,
      incompleteCount: 0,
      targetWinRate: 0.5,
      alpha: 0.05,
      minCompletedPairs: 5,
    });

    expect(stats.sampleVariance).toBe(0.0);
    expect(stats.meanPairScore).toBe(0.75);
    expect(stats.statisticalTest.method).toBe("HOEFFDING_BOUND");
    expect(stats.statisticalTest.pValue).toBeNull(); // 二項検定 p 値は別仮説のため混在させず null
    expect(stats.statisticalTest.oneSidedLowerBound).toBeCloseTo(0.20267, 3);
    // n=5 では保守的下限が 0.5 以下であるため、誤って有意認定されないこと
    expect(stats.statisticalTest.isStatisticallySignificant).toBe(false);
    expect(stats.improvementStatus).toBe("IMPROVEMENT_UNVERIFIED");

    // n=15 ペアすべて 0.75 の場合:
    // L = 0.75 - sqrt(ln(20) / 30) = 0.75 - sqrt(2.9957 / 30) = 0.75 - 0.3160 = 0.434 <= 0.5 (まだ未達)
    // n=30 ペアすべて 0.75 の場合:
    // L = 0.75 - sqrt(ln(20) / 60) = 0.75 - sqrt(0.0499) = 0.75 - 0.2234 = 0.5266 > 0.5 (有意)
    const stats30 = EvolutionIndependentEvaluator.computeStatistics({
      pairScores: new Array(30).fill(0.75),
      failedCount: 0,
      incompleteCount: 0,
      targetWinRate: 0.5,
      alpha: 0.05,
      minCompletedPairs: 5,
    });
    expect(stats30.statisticalTest.method).toBe("HOEFFDING_BOUND");
    expect(stats30.statisticalTest.pValue).toBeNull();
    expect(stats30.statisticalTest.oneSidedLowerBound).toBeCloseTo(0.5266, 3);
    expect(stats30.statisticalTest.isStatisticallySignificant).toBe(true);
    expect(stats30.improvementStatus).toBe("IMPROVEMENT_VERIFIED");
  });

  // ===========================================================================
  // Test 23 (R2): Baseline 優位性と進化的改善の分離
  // ===========================================================================
  it("Test 23 (R2): Baseline のみとの対戦では進化的改善 (IMPROVEMENT_VERIFIED) と認定せず、REFERENCE_CHAMPION との対戦比較が存在して初めて認定すること", () => {
    const candidateDna = createManualGenericGenomeDNA();

    const baselineOpponent: EvaluationOpponentDefinition = {
      opponentId: "baseline-first-legal",
      name: "FirstLegal Baseline",
      role: "BASELINE",
      policyFactory: () => new FirstLegalPolicy(false),
      targetWinRate: 0.5,
    };

    // 1. BASELINE のみでの評価: たとえ全勝しても進化的改善 (IMPROVEMENT_VERIFIED) は未認定
    const baselineOnlyResult = EvolutionIndependentEvaluator.evaluate({
      candidateDNA: candidateDna,
      seeds: [92080, 92081],
      seedCategory: "VALIDATION",
      opponents: [baselineOpponent],
      sessionFactory: testSessionFactory,
      maxDecisionsPerMatch: 500,
      minimumCompletedPairs: 2,
    });

    expect(baselineOnlyResult.evidenceStatus).toBe("VALID");
    // Baseline 優位性は true になり得るが、進化的改善は未認定 (UNVERIFIED)
    expect(baselineOnlyResult.improvementStatus).toBe("IMPROVEMENT_UNVERIFIED");
    expect(baselineOnlyResult.championImproved).toBe(false);

    // 2. REFERENCE_CHAMPION を含めた評価
    const championOpponent: EvaluationOpponentDefinition = {
      opponentId: "reference-champion-gen0",
      name: "Initial Champion",
      role: "REFERENCE_CHAMPION",
      policyFactory: () => new FirstLegalPolicy(false),
      targetWinRate: 0.5,
    };

    const championResult = EvolutionIndependentEvaluator.evaluate({
      candidateDNA: candidateDna,
      seeds: [92082, 92083],
      seedCategory: "VALIDATION",
      opponents: [baselineOpponent, championOpponent],
      sessionFactory: testSessionFactory,
      maxDecisionsPerMatch: 500,
      minimumCompletedPairs: 2,
    });

    expect(championResult.evidenceStatus).toBe("VALID");
    expect(championResult.opponents["reference-champion-gen0"].role).toBe("REFERENCE_CHAMPION");
  });

  // ===========================================================================
  // Test 24 (R2): Holdout 評価における seedRegistry 必須 Fail-Closed 契約
  // ===========================================================================
  it("Test 24 (R2): seedCategory が HOLDOUT の場合、seedRegistry が未指定または過去セットを含まない場合は Fail-Closed で拒絶されること", () => {
    const candidateDna = createManualGenericGenomeDNA();
    const opponent: EvaluationOpponentDefinition = {
      opponentId: "test-opp",
      name: "Opponent",
      role: "BASELINE",
      policyFactory: () => new FirstLegalPolicy(false),
      targetWinRate: 0.5,
    };

    // 1. seedRegistry 省略時
    expect(() => {
      EvolutionIndependentEvaluator.validateConfig({
        candidateDNA: candidateDna,
        seeds: [99901, 99902],
        seedCategory: "HOLDOUT",
        opponents: [opponent],
        sessionFactory: testSessionFactory,
      });
    }).toThrow(EvaluationConfigurationError);

    // 2. seedRegistry が空配列時
    expect(() => {
      EvolutionIndependentEvaluator.validateConfig({
        candidateDNA: candidateDna,
        seeds: [99901, 99902],
        seedCategory: "HOLDOUT",
        seedRegistry: [],
        opponents: [opponent],
        sessionFactory: testSessionFactory,
      });
    }).toThrow(EvaluationConfigurationError);

    // 3. seedRegistry に TRAINING または VALIDATION が含まれていない時
    expect(() => {
      EvolutionIndependentEvaluator.validateConfig({
        candidateDNA: candidateDna,
        seeds: [99901, 99902],
        seedCategory: "HOLDOUT",
        seedRegistry: [{ category: "HOLDOUT", seeds: [99900] }],
        opponents: [opponent],
        sessionFactory: testSessionFactory,
      });
    }).toThrow(EvaluationConfigurationError);

    // 4. 正当な seedRegistry が存在する場合は通過すること
    expect(() => {
      EvolutionIndependentEvaluator.validateConfig({
        candidateDNA: candidateDna,
        seeds: [99901, 99902],
        seedCategory: "HOLDOUT",
        seedRegistry: [
          { category: "TRAINING", seeds: [88001, 88002] },
          { category: "VALIDATION", seeds: [88003, 88004] },
        ],
        opponents: [opponent],
        sessionFactory: testSessionFactory,
      });
    }).not.toThrow();
  });
});
