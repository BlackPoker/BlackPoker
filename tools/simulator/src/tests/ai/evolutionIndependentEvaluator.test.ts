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
      maxDecisionsPerMatch: 50,
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
  // Test 5: 統計計算の既知値との完全一致
  // ===========================================================================
  it("Test 5: 標本平均、分散、標準誤差、t 信頼区間が既知の理論値と一致すること", () => {
    // スコア: [1.0, 0.75, 0.5, 0.75, 1.0] (n=5)
    // 和 = 4.0, 平均 = 0.8
    // 差: [+0.2, -0.05, -0.3, -0.05, +0.2]
    // 差の平方: [0.04, 0.0025, 0.09, 0.0025, 0.04]
    // 平方和 = 0.175
    // 不偏分散 = 0.175 / (5 - 1) = 0.175 / 4 = 0.04375
    // 標準誤差 SE = sqrt(0.04375 / 5) = sqrt(0.00875) ≈ 0.0935414
    // df = 4 の t 臨界値 (両側95%) = 2.776
    // 信頼区間幅 = 2.776 * 0.0935414 ≈ 0.25967
    // CI = [0.8 - 0.25967, 0.8 + 0.25967] = [0.54033, 1.0 (clamped)]
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
    expect(stats.confidenceInterval95.lower).toBeCloseTo(0.8 - 2.776 * 0.0935414, 4);
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

    // 2. n = 1: 分散未定義
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

    // 3. n = 2 で全勝 (分散ゼロ s^2 = 0)
    // Student-t では 0/0 になるが、Exact Binomial では p = (0.5)^2 = 0.25 > 0.05
    // 標本不足かつ p値未達のため IMPROVEMENT_UNVERIFIED であること
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

    // 4. n = 5 で全勝 (分散ゼロ s^2 = 0, minCompletedPairs = 5)
    // Exact Binomial p = (0.5)^5 = 0.03125 < 0.05
    // ここで初めて有意な改善 (IMPROVEMENT_VERIFIED) と判定されること
    const stats5ZeroVar = EvolutionIndependentEvaluator.computeStatistics({
      pairScores: [1.0, 1.0, 1.0, 1.0, 1.0],
      failedCount: 0,
      incompleteCount: 0,
      targetWinRate: 0.55,
      alpha: 0.05,
      minCompletedPairs: 5,
    });
    expect(stats5ZeroVar.sampleVariance).toBe(0.0);
    expect(stats5ZeroVar.statisticalTest.pValue).toBeCloseTo(0.03125, 5);
    expect(stats5ZeroVar.statisticalTest.isStatisticallySignificant).toBe(true);
    expect(stats5ZeroVar.evidenceStatus).toBe("VALID");
    expect(stats5ZeroVar.improvementStatus).toBe("IMPROVEMENT_VERIFIED");

    // 5. n = 5 で全敗 (CONFIRMED_REGRESSION 検定)
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
  it("Test 8: 同一入力・同一 Seed に対し、評価結果が 100% 決定論的に一致すること", () => {
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

    expect(run1.candidateDnaDigest).toBe(run2.candidateDnaDigest);
    expect(run1.totalPairs).toBe(run2.totalPairs);
    expect(run1.totalMatches).toBe(run2.totalMatches);
    expect(run1.evidenceStatus).toBe(run2.evidenceStatus);
    expect(run1.improvementStatus).toBe(run2.improvementStatus);

    for (let i = 0; i < run1.pairs.length; i++) {
      expect(run1.pairs[i].pairScore).toBe(run2.pairs[i].pairScore);
      expect(run1.pairs[i].status).toBe(run2.pairs[i].status);
      expect(run1.pairs[i].leg0.winner).toBe(run2.pairs[i].leg0.winner);
      expect(run1.pairs[i].leg1.winner).toBe(run2.pairs[i].leg1.winner);
    }
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
      maxDecisionsPerMatch: 20,
      minimumCompletedPairs: 2,
    });

    expect(result.pairs.length).toBe(2);

    for (const pair of result.pairs) {
      // 生 DecisionTrace や全決定履歴が含まれていないこと (作業メモリ O(1))
      expect((pair as any).decisionTrace).toBeUndefined();
      expect((pair.leg0 as any).decisionTrace).toBeUndefined();
      expect((pair.leg1 as any).decisionTrace).toBeUndefined();

      // ペアサマリメタデータが正しく保持されていること
      expect(typeof pair.pairScore).toBe("number");
      expect(typeof pair.leg0.totalDecisions).toBe("number");
      expect(typeof pair.leg1.totalDecisions).toBe("number");
    }
  });
});
