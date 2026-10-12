import { GameSession } from "../session/GameSession";
import { SimulationRunner, SimulationResult } from "./SimulationRunner";
import { DecisionPolicy } from "./DecisionPolicy";
import {
  BATCH_RUNTIME_TELEMETRY_VERSION,
  BATCH_SIMULATION_RESULT_VERSION,
  BatchFailureRecord,
  BatchMatchContext,
  BatchMatchPlan,
  BatchMatchResult,
  BatchMatchRuntimeMetrics,
  BatchMatchStatus,
  BatchSimulationConfigurationError,
  BatchSimulationOptions,
  BatchSimulationResult,
  BatchSimulationRuntimeMetrics,
  BatchSimulationSummary,
} from "../../domain/simulation/BatchSimulationTypes";

/**
 * 複数の試合を決定論的・安全・独立に実行するバッチシミュレーションランナー。
 * 各試合で fresh な GameSession / DecisionPolicy を生成し、エラー発生時も分離（Failure Isolation）してバッチを継続します。
 *
 * 【ファクトリ契約】
 * sessionFactory および policyFactory は、各試合（BatchMatchContext）ごとに
 * 完全に独立した fresh なインスタンス（別オブジェクト参照）を生成して返す必要があります。
 *
 * 【Master + Extra 互換原則】
 * 本ランナーは特定のアクションIDやコンポーネント定義（action.attack 等）を直接解釈しません。
 * RulePackage, GameSession, SimulationRunner, DecisionPolicy の抽象境界のみを利用するため、
 * 既存DSL/Coreで表現可能なアクション・コンポーネント追加に伴うBatchRunnerの改修は原則不要です。
 */
export class BatchSimulationRunner {
  public static readonly VERSION = BATCH_SIMULATION_RESULT_VERSION;
  public static readonly TELEMETRY_VERSION = BATCH_RUNTIME_TELEMETRY_VERSION;

  /**
   * バッチ実行オプションを検証 (開始前 fail-fast)
   */
  public static validateOptions(options: BatchSimulationOptions): void {
    if (!options || typeof options !== "object") {
      throw new BatchSimulationConfigurationError("Batch configuration error: options must be a valid object.");
    }

    if (
      typeof options.matchCount !== "number" ||
      !Number.isFinite(options.matchCount) ||
      !Number.isInteger(options.matchCount) ||
      options.matchCount < 1
    ) {
      throw new BatchSimulationConfigurationError(
        `Batch configuration error: matchCount must be a finite positive integer (>= 1). Received: ${options.matchCount}`
      );
    }

    if (typeof options.baseSeed !== "number" || !Number.isFinite(options.baseSeed)) {
      throw new BatchSimulationConfigurationError(
        `Batch configuration error: baseSeed must be a finite number. Received: ${options.baseSeed}`
      );
    }

    if (options.maxDecisionsPerMatch !== undefined) {
      if (
        typeof options.maxDecisionsPerMatch !== "number" ||
        !Number.isFinite(options.maxDecisionsPerMatch) ||
        !Number.isInteger(options.maxDecisionsPerMatch) ||
        options.maxDecisionsPerMatch < 1
      ) {
        throw new BatchSimulationConfigurationError(
          `Batch configuration error: maxDecisionsPerMatch must be a finite positive integer (>= 1). Received: ${options.maxDecisionsPerMatch}`
        );
      }
    }

    if (typeof options.sessionFactory !== "function") {
      throw new BatchSimulationConfigurationError(
        "Batch configuration error: sessionFactory must be a function."
      );
    }

    if (typeof options.policyFactory !== "function") {
      throw new BatchSimulationConfigurationError(
        "Batch configuration error: policyFactory must be a function."
      );
    }
  }

  /**
   * 32-bit FNV-1a を用いて baseSeed, matchIndex, streamKey から純粋関数で決定論的シードを導出。
   * 他の試合の実行有無や実行順序に一切依存しません。
   */
  public static deriveSeed(baseSeed: number, matchIndex: number, streamKey: string): number {
    const str = `${baseSeed}:${matchIndex}:${streamKey}`;
    let hash = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash >>> 0;
  }

  /**
   * 決定論的な matchId を生成
   */
  public static generateMatchId(baseSeed: number, matchIndex: number): string {
    const pad = String(matchIndex).padStart(6, "0");
    return `batch-${baseSeed}-match-${pad}`;
  }

  /**
   * 試合事前計画（実行順序に依存しない決定論的プラン）を算出
   */
  public static planMatch(
    baseSeed: number,
    matchIndex: number,
    playerKeys: readonly string[] = ["p1", "p2"]
  ): BatchMatchPlan {
    const matchSeed = this.deriveSeed(baseSeed, matchIndex, "match");
    const playerSeeds: Record<string, number> = {};
    for (const pKey of playerKeys) {
      playerSeeds[pKey] = this.deriveSeed(baseSeed, matchIndex, pKey);
    }
    return {
      matchIndex,
      matchId: this.generateMatchId(baseSeed, matchIndex),
      baseSeed,
      matchSeed,
      playerSeeds,
    };
  }

  /**
   * 試合ごとのメトリクスとバッチ全体の経過時間から、テレメトリ統計サマリーを算出
   */
  public static calculateRuntimeMetrics(
    matchMetrics: readonly BatchMatchRuntimeMetrics[],
    batchWallClockElapsedMs: number,
    concurrency: number = 1
  ): BatchSimulationRuntimeMetrics {
    const executedMatchCount = matchMetrics.length;
    if (executedMatchCount === 0) {
      return {
        runtimeTelemetryVersion: BATCH_RUNTIME_TELEMETRY_VERSION,
        executedMatchCount: 0,
        concurrency,
        batchWallClockElapsedMs,
        sumMatchTotalElapsedMs: 0,
        meanMatchTotalElapsedMs: 0,
        medianMatchTotalElapsedMs: 0,
        p95MatchTotalElapsedMs: 0,
        minMatchTotalElapsedMs: 0,
        maxMatchTotalElapsedMs: 0,
        matchesPerSecond: 0,
        totalDecisionCount: 0,
        meanMsPerDecision: 0,
        matchMetrics,
        totalExecutionTimeMs: batchWallClockElapsedMs,
      };
    }

    const sortedLatencies = matchMetrics
      .map((m) => m.matchTotalElapsedMs)
      .slice()
      .sort((a, b) => a - b);

    const sumMatchTotalElapsedMs = matchMetrics.reduce((acc, m) => acc + m.matchTotalElapsedMs, 0);
    const meanMatchTotalElapsedMs = sumMatchTotalElapsedMs / executedMatchCount;
    const minMatchTotalElapsedMs = sortedLatencies[0];
    const maxMatchTotalElapsedMs = sortedLatencies[sortedLatencies.length - 1];

    // Median (奇数なら中央、偶数なら中央2要素の算術平均)
    const n = sortedLatencies.length;
    let medianMatchTotalElapsedMs: number;
    if (n % 2 === 1) {
      medianMatchTotalElapsedMs = sortedLatencies[Math.floor(n / 2)];
    } else {
      medianMatchTotalElapsedMs = (sortedLatencies[n / 2 - 1] + sortedLatencies[n / 2]) / 2;
    }

    // P95 Nearest-Rank Method: rank = ceil(0.95 * n), index = max(0, rank - 1)
    const rank = Math.ceil(0.95 * n);
    const index = Math.max(0, rank - 1);
    const p95MatchTotalElapsedMs = sortedLatencies[index];

    // Throughput: matchesPerSecond = executedMatchCount / (batchWallClockElapsedMs / 1000)
    const matchesPerSecond =
      batchWallClockElapsedMs > 0
        ? executedMatchCount / (batchWallClockElapsedMs / 1000)
        : 0;

    // Total Decisions & Mean Ms Per Decision
    const totalDecisionCount = matchMetrics.reduce((acc, m) => acc + m.totalDecisions, 0);
    const sumSimulationElapsedMs = matchMetrics.reduce((acc, m) => acc + (m.simulationElapsedMs ?? 0), 0);
    const meanMsPerDecision =
      totalDecisionCount > 0
        ? (sumSimulationElapsedMs > 0 ? sumSimulationElapsedMs : sumMatchTotalElapsedMs) / totalDecisionCount
        : 0;

    return {
      runtimeTelemetryVersion: BATCH_RUNTIME_TELEMETRY_VERSION,
      executedMatchCount,
      concurrency,
      batchWallClockElapsedMs,
      sumMatchTotalElapsedMs,
      meanMatchTotalElapsedMs,
      medianMatchTotalElapsedMs,
      p95MatchTotalElapsedMs,
      minMatchTotalElapsedMs,
      maxMatchTotalElapsedMs,
      matchesPerSecond,
      totalDecisionCount,
      meanMsPerDecision,
      matchMetrics,
      totalExecutionTimeMs: batchWallClockElapsedMs,
    };
  }

  /**
   * 複数の試合を決定論的・安全・独立に実行
   */
  public static run(options: BatchSimulationOptions): BatchSimulationResult {
    // 0. 開始前検証 (fail-fast)
    this.validateOptions(options);

    const batchStartTime = globalThis.performance.now();
    const matchCount = options.matchCount;
    const baseSeed = options.baseSeed;
    const maxDecisions = options.maxDecisionsPerMatch ?? 500;
    const stopOnError = options.stopOnError ?? false;

    const matches: BatchMatchResult[] = [];
    const matchMetrics: BatchMatchRuntimeMetrics[] = [];
    const failures: BatchFailureRecord[] = [];

    for (let i = 0; i < matchCount; i++) {
      const matchStartTime = globalThis.performance.now();
      const plan = this.planMatch(baseSeed, i);
      const context: BatchMatchContext = {
        matchIndex: plan.matchIndex,
        matchId: plan.matchId,
        baseSeed: plan.baseSeed,
        matchSeed: plan.matchSeed,
        playerSeeds: plan.playerSeeds,
      };

      let session: GameSession | undefined;
      let policies: Record<string, DecisionPolicy> | undefined;
      let simResult: SimulationResult | undefined;
      let failureRecord: BatchFailureRecord | undefined;
      let setupElapsedMs = 0;
      let simulationElapsedMs = 0;

      try {
        // 1. Session 生成 & 2. Policy 生成 (Setup Phase)
        let phase: "SESSION_FACTORY" | "POLICY_FACTORY" | "RUNNER" = "SESSION_FACTORY";
        const setupStartTime = globalThis.performance.now();
        try {
          session = options.sessionFactory(context);
        } catch (err: any) {
          setupElapsedMs = globalThis.performance.now() - setupStartTime;
          throw { phase, error: err };
        }

        phase = "POLICY_FACTORY";
        try {
          policies = options.policyFactory(context);
        } catch (err: any) {
          setupElapsedMs = globalThis.performance.now() - setupStartTime;
          throw { phase, error: err };
        }
        setupElapsedMs = globalThis.performance.now() - setupStartTime;

        // 3. 実行 (Simulation Phase)
        phase = "RUNNER";
        const simStartTime = globalThis.performance.now();
        try {
          simResult = SimulationRunner.run(session, policies, {
            maxDecisions,
          });
          simulationElapsedMs = globalThis.performance.now() - simStartTime;
        } catch (err: any) {
          simulationElapsedMs = globalThis.performance.now() - simStartTime;
          throw { phase, error: err };
        }
      } catch (wrapper: any) {
        const err = wrapper?.error ?? wrapper;
        const phase = wrapper?.phase ?? "UNKNOWN";
        const errorName = err?.name || (typeof err === "string" ? "Error" : err?.constructor?.name || "Error");
        const errorMessage = err?.message || String(err);
        const errorStack = err?.stack;

        failureRecord = {
          matchIndex: i,
          matchId: plan.matchId,
          baseSeed,
          matchSeed: plan.matchSeed,
          playerSeeds: plan.playerSeeds,
          errorName,
          errorMessage,
          errorStack,
          phase,
        };
        failures.push(failureRecord);
      }

      const matchEndTime = globalThis.performance.now();
      const matchTotalElapsedMs = matchEndTime - matchStartTime;

      const matchStatus: BatchMatchStatus = failureRecord
        ? "FAILED"
        : simResult?.completed
        ? "COMPLETED"
        : "INCOMPLETE";

      const totalDecisions = simResult ? simResult.totalDecisions : 0;
      const turnCount = simResult ? simResult.turnCount : 0;

      const matchMetric: BatchMatchRuntimeMetrics = {
        matchIndex: i,
        matchId: plan.matchId,
        status: matchStatus,
        matchTotalElapsedMs,
        setupElapsedMs,
        simulationElapsedMs,
        totalDecisions,
        durationMs: matchTotalElapsedMs,
      };
      matchMetrics.push(matchMetric);

      let matchResult: BatchMatchResult;
      if (failureRecord) {
        matchResult = {
          matchIndex: i,
          matchId: plan.matchId,
          status: "FAILED",
          completed: false,
          totalDecisions: 0,
          turnCount: 0,
          matchSeed: plan.matchSeed,
          playerSeeds: plan.playerSeeds,
          failure: failureRecord,
        };
      } else if (simResult) {
        matchResult = {
          matchIndex: i,
          matchId: plan.matchId,
          status: matchStatus,
          completed: simResult.completed,
          winner: simResult.winner,
          reason: simResult.reason,
          totalDecisions,
          turnCount,
          finalStateHash: simResult.finalStateHash,
          matchSeed: plan.matchSeed,
          playerSeeds: plan.playerSeeds,
        };
      } else {
        // フォールバック
        matchResult = {
          matchIndex: i,
          matchId: plan.matchId,
          status: "FAILED",
          completed: false,
          totalDecisions: 0,
          turnCount: 0,
          matchSeed: plan.matchSeed,
          playerSeeds: plan.playerSeeds,
        };
      }

      matches.push(matchResult);

      if (options.onMatchCompleted) {
        options.onMatchCompleted(
          matchResult,
          {
            completedCount: matches.length,
            totalCount: matchCount,
          },
          matchMetric
        );
      }

      if (failureRecord && stopOnError) {
        break;
      }
    }

    const summary = this.calculateSummary(matches);
    const batchEndTime = globalThis.performance.now();
    const batchWallClockElapsedMs = batchEndTime - batchStartTime;
    const runtimeMetrics = this.calculateRuntimeMetrics(matchMetrics, batchWallClockElapsedMs);

    return {
      batchResultVersion: this.VERSION,
      baseSeed,
      matchCount,
      matches,
      summary,
      failures,
      runtimeMetrics,
    };
  }

  /**
   * 論理統計サマリーを算出
   */
  public static calculateSummary(matches: readonly BatchMatchResult[]): BatchSimulationSummary {
    let completedCount = 0;
    let incompleteCount = 0;
    let failedCount = 0;
    let drawCount = 0;
    const winsByPlayer: Record<string, number> = {};
    let totalCompletedDecisions = 0;
    let totalCompletedTurns = 0;

    for (const m of matches) {
      if (m.status === "COMPLETED") {
        completedCount++;
        totalCompletedDecisions += m.totalDecisions;
        totalCompletedTurns += m.turnCount;
        if (m.winner) {
          winsByPlayer[m.winner] = (winsByPlayer[m.winner] || 0) + 1;
        } else {
          drawCount++;
        }
      } else if (m.status === "INCOMPLETE") {
        incompleteCount++;
      } else if (m.status === "FAILED") {
        failedCount++;
      }
    }

    const winRates: Record<string, number> = {};
    const validMatchesForWinRate = completedCount;
    if (validMatchesForWinRate > 0) {
      for (const [p, wins] of Object.entries(winsByPlayer)) {
        winRates[p] = Number((wins / validMatchesForWinRate).toFixed(4));
      }
    }

    const averageDecisionsPerCompletedMatch =
      completedCount > 0 ? Number((totalCompletedDecisions / completedCount).toFixed(2)) : 0;
    const averageTurnsPerCompletedMatch =
      completedCount > 0 ? Number((totalCompletedTurns / completedCount).toFixed(2)) : 0;

    return {
      totalMatches: matches.length,
      completedCount,
      incompleteCount,
      failedCount,
      winsByPlayer,
      drawCount,
      winRates,
      averageDecisionsPerCompletedMatch,
      averageTurnsPerCompletedMatch,
    };
  }
}
