import { describe, it, expect, beforeAll } from "vitest";
import {
  BATCH_RUNTIME_TELEMETRY_VERSION,
  BatchMatchRuntimeMetrics,
  BatchSimulationOptions,
  RuntimeTelemetryValidationError,
} from "../../domain/simulation/BatchSimulationTypes";
import { BatchSimulationRunner } from "../../engine/simulation/BatchSimulationRunner";
import { createCoreBattlePresetState } from "../../engine/session/playtest/createCoreBattlePlaytest";
import { MatchSetupCoordinator } from "../../engine/session/setup/MatchSetupCoordinator";
import { GameSession } from "../../engine/session/GameSession";
import { DecisionPolicy, RandomPolicy } from "../../engine/simulation/DecisionPolicy";
import { SeededRandom } from "../../engine/random/RandomSource";
import { getPlaytestRulePackage } from "../../engine/rules/RulePackageSelector";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Runtime Match Telemetry V1-R1 (BP-SIM-AI-RUNTIME-TELEMETRY-V1-R1)", () => {
  describe("A. 統計指標アルゴリズム & Fail-Closed 検証", () => {
    it("Test A. 実行試合数 0 の場合、RuntimeTelemetryValidationError が送出されること (Fail-Closed)", () => {
      expect(() => {
        BatchSimulationRunner.calculateRuntimeMetrics([], 100);
      }).toThrow(RuntimeTelemetryValidationError);
    });

    it("Test B. 不正な batchWallClockElapsedMs (NaN, Infinity, -1, 0) を reject すること", () => {
      const validMetric: BatchMatchRuntimeMetrics = {
        matchIndex: 0,
        matchId: "m-0",
        status: "COMPLETED",
        matchTotalElapsedMs: 10,
        setupElapsedMs: 1,
        simulationElapsedMs: 9,
        totalDecisions: 5,
        durationMs: 10,
      };

      for (const invalidTime of [NaN, Infinity, -Infinity, -1, 0]) {
        expect(() => {
          BatchSimulationRunner.calculateRuntimeMetrics([validMetric], invalidTime);
        }).toThrow(RuntimeTelemetryValidationError);
      }
    });

    it("Test C. 不正な matchTotalElapsedMs (NaN, Infinity, -1) を reject すること", () => {
      for (const invalidLat of [NaN, Infinity, -Infinity, -1]) {
        const metric: BatchMatchRuntimeMetrics = {
          matchIndex: 0,
          matchId: "m-0",
          status: "COMPLETED",
          matchTotalElapsedMs: invalidLat,
          setupElapsedMs: 1,
          simulationElapsedMs: 5,
          totalDecisions: 5,
          durationMs: invalidLat,
        };
        expect(() => {
          BatchSimulationRunner.calculateRuntimeMetrics([metric], 100);
        }).toThrow(RuntimeTelemetryValidationError);
      }
    });

    it("Test D. 不正な内訳時間 (setupElapsedMs, simulationElapsedMs が NaN または負値) を reject すること", () => {
      for (const invalidSetup of [NaN, -1]) {
        const metric: BatchMatchRuntimeMetrics = {
          matchIndex: 0,
          matchId: "m-0",
          status: "COMPLETED",
          matchTotalElapsedMs: 10,
          setupElapsedMs: invalidSetup,
          simulationElapsedMs: 5,
          totalDecisions: 5,
          durationMs: 10,
        };
        expect(() => {
          BatchSimulationRunner.calculateRuntimeMetrics([metric], 100);
        }).toThrow(RuntimeTelemetryValidationError);
      }

      for (const invalidSim of [NaN, -1]) {
        const metric: BatchMatchRuntimeMetrics = {
          matchIndex: 0,
          matchId: "m-0",
          status: "COMPLETED",
          matchTotalElapsedMs: 10,
          setupElapsedMs: 1,
          simulationElapsedMs: invalidSim,
          totalDecisions: 5,
          durationMs: 10,
        };
        expect(() => {
          BatchSimulationRunner.calculateRuntimeMetrics([metric], 100);
        }).toThrow(RuntimeTelemetryValidationError);
      }
    });

    it("Test E. 内訳合計が matchTotalElapsedMs を超過する場合 (Breakdown > Total) を reject すること", () => {
      const metric: BatchMatchRuntimeMetrics = {
        matchIndex: 0,
        matchId: "m-0",
        status: "COMPLETED",
        matchTotalElapsedMs: 10,
        setupElapsedMs: 6,
        simulationElapsedMs: 6, // 6 + 6 = 12 > 10
        totalDecisions: 5,
        durationMs: 10,
      };
      expect(() => {
        BatchSimulationRunner.calculateRuntimeMetrics([metric], 100);
      }).toThrow(RuntimeTelemetryValidationError);
    });

    it("Test F. meanMsPerDecision が End-to-End Match Latency (sumMatchTotal / totalDecisions) で算出されること", () => {
      const mockMetrics: BatchMatchRuntimeMetrics[] = [
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
      // sumMatchTotalElapsedMs = 50 + 70 = 120
      // totalDecisionCount = 20 + 30 = 50
      // meanMsPerDecision = 120 / 50 = 2.4 (End-to-End Match Latency 平均)
      const res = BatchSimulationRunner.calculateRuntimeMetrics(mockMetrics, 1000);
      expect(res.totalDecisionCount).toBe(50);
      expect(res.meanMsPerDecision).toBe(2.4);
    });

    it("Test G. totalDecisionCount === 0 の場合、meanMsPerDecision は null となること", () => {
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
      const res = BatchSimulationRunner.calculateRuntimeMetrics(mockZeroDecisions, 1000);
      expect(res.totalDecisionCount).toBe(0);
      expect(res.meanMsPerDecision).toBeNull();
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
      expect(res.medianMatchTotalElapsedMs).toBe(25.0);
    });

    it("A4. 95パーセンタイル（P95 Nearest-Rank法）の完全一致検証", () => {
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
    });

    it("A5. スループット (matchesPerSecond) の算出", () => {
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

      const res = BatchSimulationRunner.calculateRuntimeMetrics(mock, 2000);
      expect(res.matchesPerSecond).toBe(2.0);
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

  describe("B. 実シミュレーション実行時の計測境界・フェーズ別例外隔離", () => {
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

    it("Test H. SESSION_FACTORY Failure 時の Timing 保持", () => {
      let callCount = 0;
      const result = BatchSimulationRunner.run(
        createOptions(2, {
          sessionFactory: (ctx) => {
            callCount++;
            if (callCount === 1) {
              throw new Error("Simulated sessionFactory init failure");
            }
            const rawState = createCoreBattlePresetState();
            const setupResult = MatchSetupCoordinator.setupMatch(rawState);
            return new GameSession(setupResult.state, rulePackage);
          },
        })
      );

      expect(result.failures.length).toBe(1);
      expect(result.failures[0].phase).toBe("SESSION_FACTORY");

      const rm = result.runtimeMetrics;
      expect(rm).toBeDefined();
      expect(rm!.matchMetrics.length).toBe(2);

      const failedMetric = rm!.matchMetrics[0];
      expect(failedMetric.status).toBe("FAILED");
      expect(failedMetric.matchTotalElapsedMs).toBeGreaterThan(0);
      expect(failedMetric.setupElapsedMs).toBeGreaterThan(0);
      expect(failedMetric.simulationElapsedMs).toBe(0); // 未到達
      expect(failedMetric.totalDecisions).toBe(0);

      const successMetric = rm!.matchMetrics[1];
      expect(successMetric.status).toBe("COMPLETED");
      expect(successMetric.simulationElapsedMs).toBeGreaterThan(0);
    });

    it("Test I. POLICY_FACTORY Failure 時の Timing 保持", () => {
      let callCount = 0;
      const result = BatchSimulationRunner.run(
        createOptions(2, {
          policyFactory: (ctx) => {
            callCount++;
            if (callCount === 1) {
              throw new Error("Simulated policyFactory init failure");
            }
            return {
              p1: new RandomPolicy(new SeededRandom(ctx.playerSeeds.p1), "RandomAI-P1"),
              p2: new RandomPolicy(new SeededRandom(ctx.playerSeeds.p2), "RandomAI-P2"),
            };
          },
        })
      );

      expect(result.failures.length).toBe(1);
      expect(result.failures[0].phase).toBe("POLICY_FACTORY");

      const rm = result.runtimeMetrics;
      expect(rm).toBeDefined();
      expect(rm!.matchMetrics.length).toBe(2);

      const failedMetric = rm!.matchMetrics[0];
      expect(failedMetric.status).toBe("FAILED");
      expect(failedMetric.matchTotalElapsedMs).toBeGreaterThan(0);
      expect(failedMetric.setupElapsedMs).toBeGreaterThan(0);
      expect(failedMetric.simulationElapsedMs).toBe(0); // 未到達
      expect(failedMetric.totalDecisions).toBe(0);
    });

    it("Test J. RUNNER Failure 時の Timing 保持 (DecisionPolicy 内部例外 fixture)", () => {
      class ThrowingDecisionPolicy implements DecisionPolicy {
        readonly descriptor = {
          kind: "throwing",
          policyVersion: 1,
          name: "ThrowingDecisionPolicy",
        };
        choose(): never {
          throw new Error("Simulated decision execution failure during simulation runner phase");
        }
      }

      let callCount = 0;
      const result = BatchSimulationRunner.run(
        createOptions(2, {
          policyFactory: (ctx) => {
            callCount++;
            if (callCount === 1) {
              return {
                p1: new ThrowingDecisionPolicy(),
                p2: new RandomPolicy(new SeededRandom(ctx.playerSeeds.p2), "RandomAI-P2"),
              };
            }
            return {
              p1: new RandomPolicy(new SeededRandom(ctx.playerSeeds.p1), "RandomAI-P1"),
              p2: new RandomPolicy(new SeededRandom(ctx.playerSeeds.p2), "RandomAI-P2"),
            };
          },
        })
      );

      expect(result.failures.length).toBe(1);
      expect(result.failures[0].phase).toBe("RUNNER");

      const rm = result.runtimeMetrics;
      expect(rm).toBeDefined();
      expect(rm!.matchMetrics.length).toBe(2);

      const failedMetric = rm!.matchMetrics[0];
      expect(failedMetric.status).toBe("FAILED");
      expect(failedMetric.matchTotalElapsedMs).toBeGreaterThan(0);
      expect(failedMetric.setupElapsedMs).toBeGreaterThan(0);
      expect(failedMetric.simulationElapsedMs).toBeGreaterThanOrEqual(0); // RUNNERフェーズに入ってから失敗
    });

    it("Test K. INCOMPLETE 時の Timing 保持", () => {
      const result = BatchSimulationRunner.run(
        createOptions(1, {
          maxDecisionsPerMatch: 1, // 1手で決着がつかず中断
        })
      );

      expect(result.matches[0].status).toBe("INCOMPLETE");
      const rm = result.runtimeMetrics;
      expect(rm).toBeDefined();
      const metric = rm!.matchMetrics[0];
      expect(metric.status).toBe("INCOMPLETE");
      expect(metric.matchTotalElapsedMs).toBeGreaterThan(0);
      expect(metric.setupElapsedMs).toBeGreaterThan(0);
      expect(metric.simulationElapsedMs).toBeGreaterThan(0);
      expect(metric.totalDecisions).toBeGreaterThanOrEqual(1);
    });

    it("Test L. onMatchCompleted コールバックへ渡された metric.status と matchResult.status が全ステータスで一致すること", () => {
      const statusesSeen: Array<{ logicalStatus: string; metricStatus: string }> = [];

      // COMPLETED, INCOMPLETE, FAILED を混在させるバッチ
      let matchIdx = 0;
      BatchSimulationRunner.run(
        createOptions(3, {
          maxDecisionsPerMatch: 500,
          policyFactory: (ctx) => {
            matchIdx++;
            if (matchIdx === 2) {
              throw new Error("Simulated failure for status check");
            }
            return {
              p1: new RandomPolicy(new SeededRandom(ctx.playerSeeds.p1), "RandomAI-P1"),
              p2: new RandomPolicy(new SeededRandom(ctx.playerSeeds.p2), "RandomAI-P2"),
            };
          },
          onMatchCompleted: (match, _prog, metric) => {
            statusesSeen.push({
              logicalStatus: match.status,
              metricStatus: metric!.status,
            });
          },
        })
      );

      expect(statusesSeen.length).toBe(3);
      for (const pair of statusesSeen) {
        expect(pair.metricStatus).toBe(pair.logicalStatus);
      }
    });
  });
});
