import { GameSession } from "../session/GameSession";
import { SimulationRunner, SimulationResult } from "./SimulationRunner";
import { DecisionPolicy } from "./DecisionPolicy";
import {
  BATCH_SIMULATION_RESULT_VERSION,
  BatchFailureRecord,
  BatchMatchContext,
  BatchMatchPlan,
  BatchMatchResult,
  BatchMatchStatus,
  BatchSimulationOptions,
  BatchSimulationResult,
  BatchSimulationSummary,
} from "../../domain/simulation/BatchSimulationTypes";

/**
 * 複数の試合を決定論的・安全・独立に実行するバッチシミュレーションランナー。
 * 各試合で fresh な GameSession / DecisionPolicy を生成し、エラー発生時も分離（Failure Isolation）してバッチを継続します。
 */
export class BatchSimulationRunner {
  public static readonly VERSION = BATCH_SIMULATION_RESULT_VERSION;

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
   * 複数の試合を決定論的・安全・独立に実行
   */
  public static run(options: BatchSimulationOptions): BatchSimulationResult {
    const startTime = Date.now();
    const matchCount = Math.max(0, Math.floor(options.matchCount));
    const baseSeed = options.baseSeed;
    const maxDecisions = options.maxDecisionsPerMatch ?? 500;
    const stopOnError = options.stopOnError ?? false;

    const matches: BatchMatchResult[] = [];
    const failures: BatchFailureRecord[] = [];

    for (let i = 0; i < matchCount; i++) {
      const matchStartTime = Date.now();
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

      try {
        // 1. Session 生成
        let phase: "SESSION_FACTORY" | "POLICY_FACTORY" | "RUNNER" = "SESSION_FACTORY";
        try {
          session = options.sessionFactory(context);
        } catch (err: any) {
          throw { phase, error: err };
        }

        // 2. Policy 生成
        phase = "POLICY_FACTORY";
        try {
          policies = options.policyFactory(context);
        } catch (err: any) {
          throw { phase, error: err };
        }

        // 3. 実行
        phase = "RUNNER";
        try {
          simResult = SimulationRunner.run(session, policies, {
            maxDecisions,
          });
        } catch (err: any) {
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

      const matchDuration = Date.now() - matchStartTime;

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
          durationMs: matchDuration,
        };
      } else if (simResult) {
        const status: BatchMatchStatus = simResult.completed ? "COMPLETED" : "INCOMPLETE";
        matchResult = {
          matchIndex: i,
          matchId: plan.matchId,
          status,
          completed: simResult.completed,
          winner: simResult.winner,
          reason: simResult.reason,
          totalDecisions: simResult.totalDecisions,
          turnCount: simResult.turnCount,
          finalStateHash: simResult.finalStateHash,
          matchSeed: plan.matchSeed,
          playerSeeds: plan.playerSeeds,
          durationMs: matchDuration,
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
          durationMs: matchDuration,
        };
      }

      matches.push(matchResult);

      if (options.onMatchCompleted) {
        options.onMatchCompleted(matchResult, {
          completedCount: matches.length,
          totalCount: matchCount,
        });
      }

      if (failureRecord && stopOnError) {
        break;
      }
    }

    const totalExecutionTimeMs = Date.now() - startTime;
    const summary = this.calculateSummary(matches, totalExecutionTimeMs);

    return {
      batchResultVersion: this.VERSION,
      baseSeed,
      matchCount,
      matches,
      summary,
      failures,
    };
  }

  /**
   * 統計サマリーを算出
   */
  public static calculateSummary(
    matches: readonly BatchMatchResult[],
    totalExecutionTimeMs: number
  ): BatchSimulationSummary {
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
      totalExecutionTimeMs,
    };
  }
}
