import { describe, it, expect, beforeAll } from "vitest";
import {
  BATCH_RUNTIME_TELEMETRY_VERSION,
  BatchMatchRuntimeMetrics,
  BatchSimulationOptions,
} from "../../domain/simulation/BatchSimulationTypes";
import { BatchSimulationRunner } from "../../engine/simulation/BatchSimulationRunner";
import { createCoreBattlePresetState } from "../../engine/session/playtest/createCoreBattlePlaytest";
import { MatchSetupCoordinator } from "../../engine/session/setup/MatchSetupCoordinator";
import { GameSession } from "../../engine/session/GameSession";
import { RandomPolicy } from "../../engine/simulation/DecisionPolicy";
import { SeededRandom } from "../../engine/random/RandomSource";
import { getPlaytestRulePackage } from "../../engine/rules/RulePackageSelector";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Runtime Match Telemetry V1 (BP-SIM-AI-RUNTIME-TELEMETRY-V1)", () => {
  describe("A. 統計指標アルゴリズム (calculateRuntimeMetrics)", () => {
    it("A1. 実行試合数 0 の場合、全指標が 0 で安全に初期化されること", () => {
      const metrics = BatchSimulationRunner.calculateRuntimeMetrics([], 100);
      expect(metrics.runtimeTelemetryVersion).toBe(BATCH_RUNTIME_TELEMETRY_VERSION);
      expect(metrics.executedMatchCount).toBe(0);
      expect(metrics.concurrency).toBe(1);
      expect(metrics.batchWallClockElapsedMs).toBe(100);
      expect(metrics.totalExecutionTimeMs).toBe(100);
      expect(metrics.sumMatchTotalElapsedMs).toBe(0);
      expect(metrics.meanMatchTotalElapsedMs).toBe(0);
      expect(metrics.medianMatchTotalElapsedMs).toBe(0);
      expect(metrics.p95MatchTotalElapsedMs).toBe(0);
      expect(metrics.minMatchTotalElapsedMs).toBe(0);
      expect(metrics.maxMatchTotalElapsedMs).toBe(0);
      expect(metrics.matchesPerSecond).toBe(0);
      expect(metrics.totalDecisionCount).toBe(0);
      expect(metrics.meanMsPerDecision).toBe(0);
      expect(metrics.matchMetrics).toEqual([]);
    });

    it("A2. 奇数サンプルの中央値（Median）が正しく中央要素となること", () => {
      const mockMetrics: BatchMatchRuntimeMetrics[] = [10, 50, 20, 40, 30].map((lat, idx) => ({
        matchIndex: idx,
        matchId: `m-${idx}`,
        status: "COMPLETED",
        matchTotalElapsedMs: lat,
        setupElapsedMs: 1,
        simulationElapsedMs: lat - 1,
        totalDecisions: 10,
        durationMs: lat,
      }));

      const res = BatchSimulationRunner.calculateRuntimeMetrics(mockMetrics, 1000);
      // ソート後: [10, 20, 30, 40, 50] -> 中央 (idx 2) は 30
      expect(res.medianMatchTotalElapsedMs).toBe(30);
      expect(res.minMatchTotalElapsedMs).toBe(10);
      expect(res.maxMatchTotalElapsedMs).toBe(50);
      expect(res.meanMatchTotalElapsedMs).toBe(30);
    });

    it("A3. 偶数サンプル（Case P: [10, 20, 30, 40]）の中央値が算術平均 25.0 となること", () => {
      const mockMetrics: BatchMatchRuntimeMetrics[] = [10, 20, 30, 40].map((lat, idx) => ({
        matchIndex: idx,
        matchId: `m-${idx}`,
        status: "COMPLETED",
        matchTotalElapsedMs: lat,
        setupElapsedMs: 1,
        simulationElapsedMs: lat - 1,
        totalDecisions: 10,
        durationMs: lat,
      }));

      const res = BatchSimulationRunner.calculateRuntimeMetrics(mockMetrics, 1000);
      // (20 + 30) / 2 = 25.0
      expect(res.medianMatchTotalElapsedMs).toBe(25.0);
    });

    it("A4. 95パーセンタイル（P95 Nearest-Rank法）の完全一致検証", () => {
      // Case P: 4サンプル [10, 20, 30, 40]
      // rank = ceil(0.95 * 4) = 4, index = 3 -> 40.0
      const mock4: BatchMatchRuntimeMetrics[] = [10, 20, 30, 40].map((lat, idx) => ({
        matchIndex: idx,
        matchId: `m-${idx}`,
        status: "COMPLETED",
        matchTotalElapsedMs: lat,
        setupElapsedMs: 1,
        simulationElapsedMs: lat - 1,
        totalDecisions: 10,
        durationMs: lat,
      }));
      expect(BatchSimulationRunner.calculateRuntimeMetrics(mock4, 1000).p95MatchTotalElapsedMs).toBe(40.0);

      // 20サンプル [1..20]
      // rank = ceil(0.95 * 20) = 19, index = 18 -> 19
      const mock20: BatchMatchRuntimeMetrics[] = Array.from({ length: 20 }, (_, i) => ({
        matchIndex: i,
        matchId: `m-${i}`,
        status: "COMPLETED",
        matchTotalElapsedMs: i + 1,
        setupElapsedMs: 0.1,
        simulationElapsedMs: i + 0.9,
        totalDecisions: 5,
        durationMs: i + 1,
      }));
      expect(BatchSimulationRunner.calculateRuntimeMetrics(mock20, 1000).p95MatchTotalElapsedMs).toBe(19);

      // 100サンプル [1..100]
      // rank = ceil(0.95 * 100) = 95, index = 94 -> 95
      const mock100: BatchMatchRuntimeMetrics[] = Array.from({ length: 100 }, (_, i) => ({
        matchIndex: i,
        matchId: `m-${i}`,
        status: "COMPLETED",
        matchTotalElapsedMs: i + 1,
        setupElapsedMs: 0.1,
        simulationElapsedMs: i + 0.9,
        totalDecisions: 5,
        durationMs: i + 1,
      }));
      expect(BatchSimulationRunner.calculateRuntimeMetrics(mock100, 1000).p95MatchTotalElapsedMs).toBe(95);
    });

    it("A5. スループット (matchesPerSecond) の正確性とゼロ除算防止", () => {
      const mock: BatchMatchRuntimeMetrics[] = [1, 2, 3, 4].map((lat, idx) => ({
        matchIndex: idx,
        matchId: `m-${idx}`,
        status: "COMPLETED",
        matchTotalElapsedMs: lat,
        setupElapsedMs: 0.1,
        simulationElapsedMs: lat - 0.1,
        totalDecisions: 10,
        durationMs: lat,
      }));

      // 4 matches in 2000 ms -> 4 / 2.0 = 2.0 matches/sec
      const res = BatchSimulationRunner.calculateRuntimeMetrics(mock, 2000);
      expect(res.matchesPerSecond).toBe(2.0);

      // 0 ms の場合は 0
      const resZero = BatchSimulationRunner.calculateRuntimeMetrics(mock, 0);
      expect(resZero.matchesPerSecond).toBe(0);
    });

    it("A6. meanMsPerDecision の算出 (decisions > 0 と decisions = 0)", () => {
      const mockWithDecisions: BatchMatchRuntimeMetrics[] = [
        {
          matchIndex: 0,
          matchId: "m-0",
          status: "COMPLETED",
          matchTotalElapsedMs: 50,
          setupElapsedMs: 10,
          simulationElapsedMs: 40,
          totalDecisions: 20,
          durationMs: 50,
        },
        {
          matchIndex: 1,
          matchId: "m-1",
          status: "COMPLETED",
          matchTotalElapsedMs: 70,
          setupElapsedMs: 10,
          simulationElapsedMs: 60,
          totalDecisions: 30,
          durationMs: 70,
        },
      ];
      // totalDecisions = 50, sumSimulationElapsedMs = 100 -> 100 / 50 = 2.0 ms/decision
      const res = BatchSimulationRunner.calculateRuntimeMetrics(mockWithDecisions, 1000);
      expect(res.totalDecisionCount).toBe(50);
      expect(res.meanMsPerDecision).toBe(2.0);

      const mockZeroDecisions: BatchMatchRuntimeMetrics[] = [
        {
          matchIndex: 0,
          matchId: "m-0",
          status: "FAILED",
          matchTotalElapsedMs: 10,
          setupElapsedMs: 10,
          simulationElapsedMs: 0,
          totalDecisions: 0,
          durationMs: 10,
        },
      ];
      const resZero = BatchSimulationRunner.calculateRuntimeMetrics(mockZeroDecisions, 1000);
      expect(resZero.totalDecisionCount).toBe(0);
      expect(resZero.meanMsPerDecision).toBe(0);
    });

    it("A7. 後方互換性エイリアス (durationMs === matchTotalElapsedMs, totalExecutionTimeMs === batchWallClockElapsedMs)", () => {
      const mock: BatchMatchRuntimeMetrics[] = [
        {
          matchIndex: 0,
          matchId: "m-0",
          status: "COMPLETED",
          matchTotalElapsedMs: 12.34,
          setupElapsedMs: 1.0,
          simulationElapsedMs: 11.34,
          totalDecisions: 15,
          durationMs: 12.34,
        },
      ];
      const res = BatchSimulationRunner.calculateRuntimeMetrics(mock, 56.78);
      expect(res.totalExecutionTimeMs).toBe(res.batchWallClockElapsedMs);
      expect(res.matchMetrics[0].durationMs).toBe(res.matchMetrics[0].matchTotalElapsedMs);
    });
  });

  describe("B. 実シミュレーション実行時の計測境界・例外隔離", () => {
    let rulePackage: any;

    beforeAll(async () => {
      const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
      const fullPackage = await loadRulePackageFromDirectory(rulesDir);
      rulePackage = getPlaytestRulePackage(fullPackage);
    });

    const createOptions = (count: number = 3, overrides: Partial<BatchSimulationOptions> = {}): BatchSimulationOptions => ({
      matchCount: count,
      baseSeed: 12345,
      maxDecisionsPerMatch: 500,
      sessionFactory: (_ctx) => {
        const rawState = createCoreBattlePresetState();
        const setupResult = MatchSetupCoordinator.setupMatch(rawState);
        return new GameSession(setupResult.state, rulePackage);
      },
      policyFactory: (ctx) => ({
        p1: new RandomPolicy(new SeededRandom(ctx.playerSeeds.p1), "RandomAI-P1"),
        p2: new RandomPolicy(new SeededRandom(ctx.playerSeeds.p2), "RandomAI-P2"),
      }),
      ...overrides,
    });

    it("B1. 1試合の計測境界 (matchTotalElapsedMs >= setupElapsedMs + simulationElapsedMs)", () => {
      const result = BatchSimulationRunner.run(createOptions(2));
      const rm = result.runtimeMetrics;
      expect(rm).toBeDefined();
      expect(rm!.executedMatchCount).toBe(2);
      expect(rm!.matchMetrics.length).toBe(2);

      for (const m of rm!.matchMetrics) {
        expect(m.matchTotalElapsedMs).toBeGreaterThan(0);
        expect(m.setupElapsedMs).toBeGreaterThan(0);
        expect(m.simulationElapsedMs).toBeGreaterThan(0);
        // フレームワークの微小オーバーヘッドを含むため >= となる
        expect(m.matchTotalElapsedMs).toBeGreaterThanOrEqual(m.setupElapsedMs + m.simulationElapsedMs);
        expect(m.durationMs).toBe(m.matchTotalElapsedMs);
      }

      expect(rm!.sumMatchTotalElapsedMs).toBeGreaterThan(0);
      expect(rm!.batchWallClockElapsedMs).toBeGreaterThan(0);
      expect(rm!.matchesPerSecond).toBeGreaterThan(0);
    });

    it("B2. 例外発生時 (FAILED) でも matchTotalElapsedMs が欠落せず記録され、simulationElapsedMs は 0 となること", () => {
      let callCount = 0;
      const result = BatchSimulationRunner.run(
        createOptions(2, {
          policyFactory: (ctx) => {
            callCount++;
            if (callCount === 1) {
              throw new Error("Simulated policy init failure");
            }
            return {
              p1: new RandomPolicy(new SeededRandom(ctx.playerSeeds.p1), "RandomAI-P1"),
              p2: new RandomPolicy(new SeededRandom(ctx.playerSeeds.p2), "RandomAI-P2"),
            };
          },
        })
      );

      expect(result.failures.length).toBe(1);
      const rm = result.runtimeMetrics;
      expect(rm).toBeDefined();
      expect(rm!.matchMetrics.length).toBe(2);

      const failedMetric = rm!.matchMetrics[0];
      expect(failedMetric.status).toBe("FAILED");
      expect(failedMetric.matchTotalElapsedMs).toBeGreaterThan(0);
      expect(failedMetric.setupElapsedMs).toBeGreaterThan(0);
      expect(failedMetric.simulationElapsedMs).toBe(0); // RUNNER未到達のため 0
      expect(failedMetric.totalDecisions).toBe(0);

      const successMetric = rm!.matchMetrics[1];
      expect(successMetric.status).toBe("COMPLETED");
      expect(successMetric.simulationElapsedMs).toBeGreaterThan(0);
    });

    it("B3. stopOnError = true でエラー中断した場合、executedMatchCount が中断時点の実行数となること", () => {
      let callCount = 0;
      const result = BatchSimulationRunner.run(
        createOptions(5, {
          stopOnError: true,
          policyFactory: (ctx) => {
            callCount++;
            if (callCount === 2) {
              throw new Error("Early stop error");
            }
            return {
              p1: new RandomPolicy(new SeededRandom(ctx.playerSeeds.p1), "RandomAI-P1"),
              p2: new RandomPolicy(new SeededRandom(ctx.playerSeeds.p2), "RandomAI-P2"),
            };
          },
        })
      );

      expect(result.matches.length).toBe(2);
      expect(result.failures.length).toBe(1);
      const rm = result.runtimeMetrics;
      expect(rm).toBeDefined();
      expect(rm!.executedMatchCount).toBe(2);
      expect(rm!.matchMetrics.length).toBe(2);
    });

    it("B4. onMatchCompleted の第3引数にメトリクスが渡されること", () => {
      const receivedMetrics: BatchMatchRuntimeMetrics[] = [];
      BatchSimulationRunner.run(
        createOptions(2, {
          onMatchCompleted: (_match, _prog, metrics) => {
            if (metrics) {
              receivedMetrics.push(metrics);
            }
          },
        })
      );

      expect(receivedMetrics.length).toBe(2);
      expect(receivedMetrics[0].matchIndex).toBe(0);
      expect(receivedMetrics[1].matchIndex).toBe(1);
    });
  });
});
