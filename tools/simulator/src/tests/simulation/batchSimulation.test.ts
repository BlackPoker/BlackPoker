import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { fileURLToPath } from "url";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { getPlaytestRulePackage } from "../../engine/rules/RulePackageSelector";
import { RulePackage } from "../../domain/rules/RulePackage";
import { GameSession } from "../../engine/session/GameSession";
import { createCoreBattlePresetState } from "../../engine/session/playtest/createCoreBattlePlaytest";
import { MatchSetupCoordinator } from "../../engine/session/setup/MatchSetupCoordinator";
import { BatchSimulationRunner } from "../../engine/simulation/BatchSimulationRunner";
import { DecisionPolicy, RandomPolicy } from "../../engine/simulation/DecisionPolicy";
import { SeededRandom } from "../../engine/random/RandomSource";
import { SimulationRunner } from "../../engine/simulation/SimulationRunner";
import {
  BATCH_SIMULATION_RESULT_VERSION,
  BatchSimulationConfigurationError,
} from "../../domain/simulation/BatchSimulationTypes";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Batch Simulation & Failure Isolation 基盤 (Phase 1.3.1 最終補修)", () => {
  let rulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    const fullPackage = await loadRulePackageFromDirectory(rulesDir);
    rulePackage = getPlaytestRulePackage(fullPackage);
  });

  const createTestSessionFactory = () => {
    return () => {
      const rawState = createCoreBattlePresetState();
      const setupResult = MatchSetupCoordinator.setupMatch(rawState);
      return new GameSession(setupResult.state, rulePackage);
    };
  };

  const createTestPolicyFactory = () => {
    return (ctx: { playerSeeds: Record<string, number> }) => {
      return {
        p1: new RandomPolicy(new SeededRandom(ctx.playerSeeds.p1), "RandomAI-P1"),
        p2: new RandomPolicy(new SeededRandom(ctx.playerSeeds.p2), "RandomAI-P2"),
      };
    };
  };

  it("A. 10試合のバッチシミュレーションを実行し、サマリーの保存則を満たすこと", () => {
    const result = BatchSimulationRunner.run({
      matchCount: 10,
      baseSeed: 12345,
      maxDecisionsPerMatch: 500,
      sessionFactory: createTestSessionFactory(),
      policyFactory: createTestPolicyFactory(),
    });

    expect(result.batchResultVersion).toBe(BATCH_SIMULATION_RESULT_VERSION);
    expect(result.baseSeed).toBe(12345);
    expect(result.matchCount).toBe(10);
    expect(result.matches).toHaveLength(10);
    expect(result.summary.totalMatches).toBe(10);
    expect(
      result.summary.completedCount + result.summary.incompleteCount + result.summary.failedCount
    ).toBe(10);
    expect(result.failures).toHaveLength(0);
    expect(result.runtimeMetrics).toBeDefined();
    expect(result.runtimeMetrics?.totalExecutionTimeMs).toBeGreaterThan(0);

    for (let i = 0; i < 10; i++) {
      const m = result.matches[i];
      expect(m.matchIndex).toBe(i);
      expect(m.matchId).toBe(`batch-12345-match-${String(i).padStart(6, "0")}`);
      expect(["COMPLETED", "INCOMPLETE"]).toContain(m.status);
      expect(typeof m.totalDecisions).toBe("number");
      expect(typeof m.turnCount).toBe("number");
      expect(m.finalStateHash?.startsWith("sh2-")).toBe(true);
    }
  });

  it("B. 各試合で生成される GameSession, p1 Policy, p2 Policy が独立した別インスタンスであり、同一試合内でも p1 !== p2 であること", () => {
    const sessionInstances: GameSession[] = [];
    const p1Instances: DecisionPolicy[] = [];
    const p2Instances: DecisionPolicy[] = [];
    const matchCount = 4;

    BatchSimulationRunner.run({
      matchCount,
      baseSeed: 100,
      maxDecisionsPerMatch: 500,
      sessionFactory: (_ctx) => {
        const rawState = createCoreBattlePresetState();
        const setupResult = MatchSetupCoordinator.setupMatch(rawState);
        const session = new GameSession(setupResult.state, rulePackage);
        sessionInstances.push(session);
        return session;
      },
      policyFactory: (ctx) => {
        const p1 = new RandomPolicy(new SeededRandom(ctx.playerSeeds.p1), "RandomAI-P1");
        const p2 = new RandomPolicy(new SeededRandom(ctx.playerSeeds.p2), "RandomAI-P2");
        p1Instances.push(p1);
        p2Instances.push(p2);
        return { p1, p2 };
      },
    });

    // 1. 生成回数の検証
    expect(sessionInstances).toHaveLength(matchCount);
    expect(p1Instances).toHaveLength(matchCount);
    expect(p2Instances).toHaveLength(matchCount);

    // 2. オブジェクト同一性 (参照) の独立性検証
    expect(new Set(sessionInstances).size).toBe(matchCount);
    expect(new Set(p1Instances).size).toBe(matchCount);
    expect(new Set(p2Instances).size).toBe(matchCount);

    // 3. 同一試合内の p1 / p2 参照独立性検証
    for (let i = 0; i < matchCount; i++) {
      expect(p1Instances[i]).not.toBe(p2Instances[i]);
    }
  });

  it("C. 同一の baseSeed でバッチを実行した場合、Logical Batch Result の JSON 文字列が 100% 完全一致すること", () => {
    const resultA = BatchSimulationRunner.run({
      matchCount: 5,
      baseSeed: 9999,
      maxDecisionsPerMatch: 500,
      sessionFactory: createTestSessionFactory(),
      policyFactory: createTestPolicyFactory(),
    });

    const resultB = BatchSimulationRunner.run({
      matchCount: 5,
      baseSeed: 9999,
      maxDecisionsPerMatch: 500,
      sessionFactory: createTestSessionFactory(),
      policyFactory: createTestPolicyFactory(),
    });

    // runtimeMetrics を除外した論理結果の完全一致を検証
    const { runtimeMetrics: _rA, ...logicalA } = resultA;
    const { runtimeMetrics: _rB, ...logicalB } = resultB;

    expect(JSON.stringify(logicalA)).toBe(JSON.stringify(logicalB));
  });

  it("D. 異なる baseSeed で実行した場合、異なる試合結果が生成されること", () => {
    const resultA = BatchSimulationRunner.run({
      matchCount: 5,
      baseSeed: 1111,
      maxDecisionsPerMatch: 500,
      sessionFactory: createTestSessionFactory(),
      policyFactory: createTestPolicyFactory(),
    });

    const resultB = BatchSimulationRunner.run({
      matchCount: 5,
      baseSeed: 2222,
      maxDecisionsPerMatch: 500,
      sessionFactory: createTestSessionFactory(),
      policyFactory: createTestPolicyFactory(),
    });

    const hashesA = resultA.matches.map((m) => m.finalStateHash);
    const hashesB = resultB.matches.map((m) => m.finalStateHash);
    expect(hashesA).not.toEqual(hashesB);
  });

  it("E. Match Plan とシード導出が純粋関数であり、実行順序に依存しないこと", () => {
    const planDirect = BatchSimulationRunner.planMatch(8888, 7);
    const seedDirectP1 = BatchSimulationRunner.deriveSeed(8888, 7, "p1");
    const seedDirectP2 = BatchSimulationRunner.deriveSeed(8888, 7, "p2");
    const seedDirectMatch = BatchSimulationRunner.deriveSeed(8888, 7, "match");

    expect(planDirect.matchIndex).toBe(7);
    expect(planDirect.matchId).toBe("batch-8888-match-000007");
    expect(planDirect.playerSeeds.p1).toBe(seedDirectP1);
    expect(planDirect.playerSeeds.p2).toBe(seedDirectP2);
    expect(planDirect.matchSeed).toBe(seedDirectMatch);
  });

  it("F. バッチ内の特定の1試合を単独実行した場合、バッチ実行時と完全に同一の State Hash / ログが再現されること", () => {
    const baseSeed = 54321;
    const targetMatchIndex = 3;

    // 1. バッチ実行
    const batchResult = BatchSimulationRunner.run({
      matchCount: 5,
      baseSeed,
      maxDecisionsPerMatch: 500,
      sessionFactory: createTestSessionFactory(),
      policyFactory: createTestPolicyFactory(),
    });
    const batchTargetMatch = batchResult.matches[targetMatchIndex];

    // 2. 単独再現実行 (BatchRunner の導出シードを使用)
    const plan = BatchSimulationRunner.planMatch(baseSeed, targetMatchIndex);
    const rawState = createCoreBattlePresetState();
    const setupResult = MatchSetupCoordinator.setupMatch(rawState);
    const singleSession = new GameSession(setupResult.state, rulePackage);
    const singlePolicies = {
      p1: new RandomPolicy(new SeededRandom(plan.playerSeeds.p1), "RandomAI-P1"),
      p2: new RandomPolicy(new SeededRandom(plan.playerSeeds.p2), "RandomAI-P2"),
    };

    const singleResult = SimulationRunner.run(singleSession, singlePolicies, {
      maxDecisions: 500,
    });

    expect(batchTargetMatch.winner).toBe(singleResult.winner);
    expect(batchTargetMatch.turnCount).toBe(singleResult.turnCount);
    expect(batchTargetMatch.totalDecisions).toBe(singleResult.totalDecisions);
    expect(batchTargetMatch.finalStateHash).toBe(singleResult.finalStateHash);
  });

  it("G. 単一試合で例外が発生しても他の試合が隔離（Failure Isolation）され、バッチ全体が完走すること", () => {
    const errorMatchIndex = 2;

    const result = BatchSimulationRunner.run({
      matchCount: 5,
      baseSeed: 7777,
      maxDecisionsPerMatch: 500,
      sessionFactory: (ctx) => {
        if (ctx.matchIndex === errorMatchIndex) {
          throw new Error("Intentional session failure for test");
        }
        const rawState = createCoreBattlePresetState();
        const setupResult = MatchSetupCoordinator.setupMatch(rawState);
        return new GameSession(setupResult.state, rulePackage);
      },
      policyFactory: createTestPolicyFactory(),
    });

    expect(result.matches).toHaveLength(5);
    expect(result.summary.totalMatches).toBe(5);
    expect(result.summary.failedCount).toBe(1);
    expect(result.summary.completedCount + result.summary.incompleteCount).toBe(4);

    // 失敗した試合の検証
    const failedMatch = result.matches[errorMatchIndex];
    expect(failedMatch.status).toBe("FAILED");
    expect(failedMatch.completed).toBe(false);
    expect(failedMatch.failure).toBeDefined();
    expect(failedMatch.failure?.errorMessage).toBe("Intentional session failure for test");
    expect(failedMatch.failure?.phase).toBe("SESSION_FACTORY");

    // 成功した他の試合の検証
    expect(result.matches[0].status).not.toBe("FAILED");
    expect(result.matches[1].status).not.toBe("FAILED");
    expect(result.matches[3].status).not.toBe("FAILED");
    expect(result.matches[4].status).not.toBe("FAILED");

    // failures 配列
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].matchIndex).toBe(errorMatchIndex);
  });

  it("H. FailureRecordが単独再現に必要なMatch Plan情報を保持し、planMatchから同一プランを再構築できること", () => {
    const baseSeed = 3333;
    const errorMatchIndex = 1;

    const result = BatchSimulationRunner.run({
      matchCount: 3,
      baseSeed,
      maxDecisionsPerMatch: 500,
      sessionFactory: createTestSessionFactory(),
      policyFactory: (ctx) => {
        if (ctx.matchIndex === errorMatchIndex) {
          throw new TypeError("Policy initialization error");
        }
        return {
          p1: new RandomPolicy(new SeededRandom(ctx.playerSeeds.p1), "RandomAI-P1"),
          p2: new RandomPolicy(new SeededRandom(ctx.playerSeeds.p2), "RandomAI-P2"),
        };
      },
    });

    expect(result.failures).toHaveLength(1);
    const failure = result.failures[0];
    expect(failure.matchIndex).toBe(errorMatchIndex);
    expect(failure.errorName).toBe("TypeError");
    expect(failure.errorMessage).toBe("Policy initialization error");
    expect(failure.phase).toBe("POLICY_FACTORY");

    // Failure Record の情報から Match Plan を再構築
    const reconstructedPlan = BatchSimulationRunner.planMatch(failure.baseSeed, failure.matchIndex);
    expect(reconstructedPlan.matchId).toBe(failure.matchId);
    expect(reconstructedPlan.matchSeed).toBe(failure.matchSeed);
    expect(reconstructedPlan.playerSeeds).toEqual(failure.playerSeeds);
  });

  it("I. maxDecisions 到達時は INCOMPLETE となり、FAILED (例外) と明確に区別されること", () => {
    const result = BatchSimulationRunner.run({
      matchCount: 3,
      baseSeed: 5555,
      maxDecisionsPerMatch: 2, // 2手で即終了
      sessionFactory: createTestSessionFactory(),
      policyFactory: createTestPolicyFactory(),
    });

    expect(result.summary.incompleteCount).toBe(3);
    expect(result.summary.failedCount).toBe(0);
    expect(result.failures).toHaveLength(0);

    for (const m of result.matches) {
      expect(m.status).toBe("INCOMPLETE");
      expect(m.completed).toBe(false);
      expect(m.totalDecisions).toBe(2);
      expect(m.reason).toContain("最大判断回数");
    }
  });

  it("J. 設定不備 (matchCount <= 0, 不正 maxDecisions, 不正 baseSeed) を開始前 fail-fast してファクトリを呼ばないこと", () => {
    let factoryCallCount = 0;
    const trackingSessionFactory = () => {
      factoryCallCount++;
      return createTestSessionFactory()();
    };
    const trackingPolicyFactory = (ctx: any) => {
      factoryCallCount++;
      return createTestPolicyFactory()(ctx);
    };

    // 1. matchCount = 0
    expect(() => {
      BatchSimulationRunner.run({
        matchCount: 0,
        baseSeed: 42,
        sessionFactory: trackingSessionFactory,
        policyFactory: trackingPolicyFactory,
      });
    }).toThrow(BatchSimulationConfigurationError);

    // 2. matchCount < 0
    expect(() => {
      BatchSimulationRunner.run({
        matchCount: -5,
        baseSeed: 42,
        sessionFactory: trackingSessionFactory,
        policyFactory: trackingPolicyFactory,
      });
    }).toThrow(BatchSimulationConfigurationError);

    // 3. maxDecisionsPerMatch = 0
    expect(() => {
      BatchSimulationRunner.run({
        matchCount: 5,
        baseSeed: 42,
        maxDecisionsPerMatch: 0,
        sessionFactory: trackingSessionFactory,
        policyFactory: trackingPolicyFactory,
      });
    }).toThrow(BatchSimulationConfigurationError);

    // 4. baseSeed = NaN
    expect(() => {
      BatchSimulationRunner.run({
        matchCount: 5,
        baseSeed: NaN,
        sessionFactory: trackingSessionFactory,
        policyFactory: trackingPolicyFactory,
      });
    }).toThrow(BatchSimulationConfigurationError);

    // 設定不備時はファクトリが一度も呼び出されていないことを確認
    expect(factoryCallCount).toBe(0);
  });

  it("K. コンパクトな結果構造（メモリ保護）であり、生 GameState や DecisionTrace を保持しないこと", () => {
    const result = BatchSimulationRunner.run({
      matchCount: 3,
      baseSeed: 6666,
      maxDecisionsPerMatch: 500,
      sessionFactory: createTestSessionFactory(),
      policyFactory: createTestPolicyFactory(),
    });

    for (const m of result.matches) {
      expect((m as any).finalState).toBeUndefined();
      expect((m as any).decisionTrace).toBeUndefined();
      expect((m as any).matchLog).toBeUndefined();
    }
  });

  it("L. BatchSimulationResult が JSON-safe であり、シリアライズ / デシリアライズで情報損失がないこと", () => {
    const result = BatchSimulationRunner.run({
      matchCount: 3,
      baseSeed: 7777,
      maxDecisionsPerMatch: 500,
      sessionFactory: createTestSessionFactory(),
      policyFactory: createTestPolicyFactory(),
    });

    const jsonStr = JSON.stringify(result);
    const parsed = JSON.parse(jsonStr);

    expect(parsed.batchResultVersion).toBe(result.batchResultVersion);
    expect(parsed.baseSeed).toBe(result.baseSeed);
    expect(parsed.summary).toEqual(result.summary);
    expect(parsed.matches).toHaveLength(3);
    expect(parsed.matches[0].finalStateHash).toBe(result.matches[0].finalStateHash);
    expect(parsed.runtimeMetrics?.totalExecutionTimeMs).toBe(result.runtimeMetrics?.totalExecutionTimeMs);
  });
});
