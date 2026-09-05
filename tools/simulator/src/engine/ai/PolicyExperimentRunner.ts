import { BatchSimulationRunner } from "../simulation/BatchSimulationRunner";
import { BatchMatchResult, BatchSimulationResult } from "../../domain/simulation/BatchSimulationTypes";
import {
  POLICY_EXPERIMENT_RESULT_VERSION,
  PolicyBehaviorSummary,
  PolicyDecisionRecord,
  PolicyExperimentConfigurationError,
  PolicyExperimentDiagnosticFailure,
  PolicyExperimentLegResult,
  PolicyExperimentLegRuntimeMetrics,
  PolicyExperimentLogicalFailure,
  PolicyExperimentOptions,
  PolicyExperimentResult,
  PolicyExperimentRuntimeMetrics,
  PolicyParticipantOutcomeSummary,
  PolicyParticipantSeatSummary,
} from "../../domain/ai/PolicyExperimentTypes";
import { DecisionBehaviorObserverPolicy } from "./DecisionBehaviorObserverPolicy";

/**
 * 2つの Policy 間の公平・決定論的な対戦実験を実行する Experiment Harness。
 *
 * 【設計原則】
 * 1. 第二のシミュレーションループを作らない: 各 Leg は上位オーケストレータとして既存の BatchSimulationRunner.run() を再利用。
 * 2. Seat Swap: 先攻・後攻バイアスを排除するため、Leg 1 (A=p1, B=p2) と Leg 2 (B=p1, A=p2) を同一 baseSeed で実行。
 * 3. 論理結果と実行時メトリクスの分離:
 *    Logical Result には errorMessage や errorStack、タイムスタンプを一切含めず、決定論的一致を保証。
 * 4. 汎用 Behavior 計測:
 *    特定アクション名に依存せず、Pattern Kind (ACTION, PASS, EFFECT_SELECTION, OTHER) と Decision Source のみ集計。
 */
export class PolicyExperimentRunner {
  public static readonly VERSION = POLICY_EXPERIMENT_RESULT_VERSION;

  /**
   * 実験設定の検証 (開始前 fail-fast)
   * ※ 不正な設定の場合、sessionFactory や各 participant の policyFactory を 1 度も呼び出すことなく拒絶します。
   */
  public static validateOptions(options: PolicyExperimentOptions): void {
    if (!options || typeof options !== "object") {
      throw new PolicyExperimentConfigurationError("Experiment configuration error: options must be a valid object.");
    }

    if (typeof options.experimentId !== "string" || options.experimentId.trim() === "") {
      throw new PolicyExperimentConfigurationError("Experiment configuration error: experimentId must be a non-empty string.");
    }

    if (typeof options.environmentRef !== "string" || options.environmentRef.trim() === "") {
      throw new PolicyExperimentConfigurationError("Experiment configuration error: environmentRef must be a non-empty string.");
    }

    if (typeof options.baseSeed !== "number" || !Number.isFinite(options.baseSeed)) {
      throw new PolicyExperimentConfigurationError(
        `Experiment configuration error: baseSeed must be a finite number. Received: ${options.baseSeed}`
      );
    }

    if (
      typeof options.matchesPerSeat !== "number" ||
      !Number.isFinite(options.matchesPerSeat) ||
      !Number.isInteger(options.matchesPerSeat) ||
      options.matchesPerSeat < 1
    ) {
      throw new PolicyExperimentConfigurationError(
        `Experiment configuration error: matchesPerSeat must be a finite positive integer (>= 1). Received: ${options.matchesPerSeat}`
      );
    }

    if (options.maxDecisionsPerMatch !== undefined) {
      if (
        typeof options.maxDecisionsPerMatch !== "number" ||
        !Number.isFinite(options.maxDecisionsPerMatch) ||
        !Number.isInteger(options.maxDecisionsPerMatch) ||
        options.maxDecisionsPerMatch < 1
      ) {
        throw new PolicyExperimentConfigurationError(
          `Experiment configuration error: maxDecisionsPerMatch must be a finite positive integer (>= 1). Received: ${options.maxDecisionsPerMatch}`
        );
      }
    }

    if (!options.participantA || typeof options.participantA !== "object") {
      throw new PolicyExperimentConfigurationError("Experiment configuration error: participantA must be a valid object.");
    }
    if (typeof options.participantA.id !== "string" || options.participantA.id.trim() === "") {
      throw new PolicyExperimentConfigurationError("Experiment configuration error: participantA.id must be a non-empty string.");
    }
    if (typeof options.participantA.name !== "string" || options.participantA.name.trim() === "") {
      throw new PolicyExperimentConfigurationError("Experiment configuration error: participantA.name must be a non-empty string.");
    }
    if (typeof options.participantA.policyFactory !== "function") {
      throw new PolicyExperimentConfigurationError("Experiment configuration error: participantA.policyFactory must be a function.");
    }

    if (!options.participantB || typeof options.participantB !== "object") {
      throw new PolicyExperimentConfigurationError("Experiment configuration error: participantB must be a valid object.");
    }
    if (typeof options.participantB.id !== "string" || options.participantB.id.trim() === "") {
      throw new PolicyExperimentConfigurationError("Experiment configuration error: participantB.id must be a non-empty string.");
    }
    if (typeof options.participantB.name !== "string" || options.participantB.name.trim() === "") {
      throw new PolicyExperimentConfigurationError("Experiment configuration error: participantB.name must be a non-empty string.");
    }
    if (typeof options.participantB.policyFactory !== "function") {
      throw new PolicyExperimentConfigurationError("Experiment configuration error: participantB.policyFactory must be a function.");
    }

    if (options.participantA.id === options.participantB.id) {
      throw new PolicyExperimentConfigurationError(
        `Experiment configuration error: participantA.id and participantB.id must be distinct. Received duplicate ID: "${options.participantA.id}"`
      );
    }

    if (typeof options.sessionFactory !== "function") {
      throw new PolicyExperimentConfigurationError("Experiment configuration error: sessionFactory must be a function.");
    }
  }

  /**
   * Pairwise 実験を実行 (Seat-Swapped 2 Legs)
   */
  public static run(options: PolicyExperimentOptions): PolicyExperimentResult {
    // 0. 開始前検証 (fail-fast)
    this.validateOptions(options);

    const startTime = Date.now();
    const pA = options.participantA;
    const pB = options.participantB;
    const matchesPerSeat = options.matchesPerSeat;
    const baseSeed = options.baseSeed;
    const maxDecisionsPerMatch = options.maxDecisionsPerMatch ?? 500;

    // 外部 Accumulator: 全正常意思決定を記録
    const decisionRecords: PolicyDecisionRecord[] = [];
    const onDecision = (record: PolicyDecisionRecord) => {
      decisionRecords.push(record);
    };

    // 1. Leg 1: p1 = Participant A, p2 = Participant B
    const leg1Id = "leg-a-as-p1";
    const batchResult1 = BatchSimulationRunner.run({
      matchCount: matchesPerSeat,
      baseSeed,
      maxDecisionsPerMatch,
      sessionFactory: options.sessionFactory,
      policyFactory: (ctx) => {
        const rawP1 = pA.policyFactory(ctx, "p1");
        const rawP2 = pB.policyFactory(ctx, "p2");
        return {
          p1: new DecisionBehaviorObserverPolicy(rawP1, pA.id, leg1Id, ctx.matchIndex, "p1", onDecision),
          p2: new DecisionBehaviorObserverPolicy(rawP2, pB.id, leg1Id, ctx.matchIndex, "p2", onDecision),
        };
      },
      onMatchCompleted: options.onMatchCompleted
        ? (_m, prog) => {
            options.onMatchCompleted!({
              legId: leg1Id,
              completedMatches: prog.completedCount,
              totalMatches: prog.totalCount,
            });
          }
        : undefined,
    });

    // 2. Leg 2: p1 = Participant B, p2 = Participant A (同一 baseSeed で座席反転)
    const leg2Id = "leg-b-as-p1";
    const batchResult2 = BatchSimulationRunner.run({
      matchCount: matchesPerSeat,
      baseSeed,
      maxDecisionsPerMatch,
      sessionFactory: options.sessionFactory,
      policyFactory: (ctx) => {
        const rawP1 = pB.policyFactory(ctx, "p1");
        const rawP2 = pA.policyFactory(ctx, "p2");
        return {
          p1: new DecisionBehaviorObserverPolicy(rawP1, pB.id, leg2Id, ctx.matchIndex, "p1", onDecision),
          p2: new DecisionBehaviorObserverPolicy(rawP2, pA.id, leg2Id, ctx.matchIndex, "p2", onDecision),
        };
      },
      onMatchCompleted: options.onMatchCompleted
        ? (_m, prog) => {
            options.onMatchCompleted!({
              legId: leg2Id,
              completedMatches: prog.completedCount,
              totalMatches: prog.totalCount,
            });
          }
        : undefined,
    });

    // 3. Leg ごとの論理射影および診断情報抽出
    const leg1Projection = this.projectLegResult(leg1Id, { p1: pA.id, p2: pB.id }, baseSeed, matchesPerSeat, batchResult1);
    const leg2Projection = this.projectLegResult(leg2Id, { p1: pB.id, p2: pA.id }, baseSeed, matchesPerSeat, batchResult2);

    // 4. Outcome Summary 集計 (Participant ごとおよび座席別)
    const outcomeA = this.computeParticipantOutcome(pA.id, leg1Projection.legResult, leg2Projection.legResult);
    const outcomeB = this.computeParticipantOutcome(pB.id, leg1Projection.legResult, leg2Projection.legResult);

    const totalScheduledMatches = matchesPerSeat * 2;
    const totalCompletedMatches = batchResult1.summary.completedCount + batchResult2.summary.completedCount;
    const totalIncompleteMatches = batchResult1.summary.incompleteCount + batchResult2.summary.incompleteCount;
    const totalFailedMatches = batchResult1.summary.failedCount + batchResult2.summary.failedCount;

    // 5. Generic Behavior Summary 集計 (全ステータスの観測意思決定を母集団とする)
    const behaviorA = this.computeBehaviorSummary(pA.id, decisionRecords);
    const behaviorB = this.computeBehaviorSummary(pB.id, decisionRecords);

    // 6. 実行時・診断メトリクスの分離構築
    const runtimeMetrics: PolicyExperimentRuntimeMetrics = {
      totalExecutionTimeMs: Date.now() - startTime,
      legs: [
        leg1Projection.legRuntimeMetrics,
        leg2Projection.legRuntimeMetrics,
      ],
    };

    return {
      experimentResultVersion: POLICY_EXPERIMENT_RESULT_VERSION,
      experimentId: options.experimentId,
      environmentRef: options.environmentRef,
      baseSeed,
      matchesPerSeat,
      maxDecisionsPerMatch,
      participants: {
        a: {
          id: pA.id,
          name: pA.name,
          artifactRef: pA.artifactRef,
        },
        b: {
          id: pB.id,
          name: pB.name,
          artifactRef: pB.artifactRef,
        },
      },
      legs: [leg1Projection.legResult, leg2Projection.legResult],
      summary: {
        totalScheduledMatches,
        totalCompletedMatches,
        totalIncompleteMatches,
        totalFailedMatches,
        participants: {
          [pA.id]: outcomeA,
          [pB.id]: outcomeB,
        },
      },
      behavior: {
        [pA.id]: behaviorA,
        [pB.id]: behaviorB,
      },
      runtimeMetrics,
    };
  }

  /**
   * BatchSimulationResult から非決定論的要素（errorMessage, errorStack, runtimeMetrics）を
   * Logical Result から完全に排除して射影
   */
  private static projectLegResult(
    legId: string,
    seatAssignments: { p1: string; p2: string },
    baseSeed: number,
    matchesPerSeat: number,
    batchResult: BatchSimulationResult
  ): {
    legResult: PolicyExperimentLegResult;
    legRuntimeMetrics: PolicyExperimentLegRuntimeMetrics;
  } {
    const logicalFailures: PolicyExperimentLogicalFailure[] = [];
    const diagnosticFailures: PolicyExperimentDiagnosticFailure[] = [];

    for (const f of batchResult.failures) {
      logicalFailures.push({
        matchIndex: f.matchIndex,
        matchId: f.matchId,
        baseSeed: f.baseSeed,
        matchSeed: f.matchSeed,
        playerSeeds: { ...f.playerSeeds },
        phase: f.phase,
        errorName: f.errorName,
      });
      diagnosticFailures.push({
        matchIndex: f.matchIndex,
        matchId: f.matchId,
        phase: f.phase,
        errorName: f.errorName,
        errorMessage: f.errorMessage,
        errorStack: f.errorStack,
      });
    }

    // 各 match 内の failure からも errorMessage / errorStack を排除
    const cleanMatches: BatchMatchResult[] = batchResult.matches.map((m) => {
      if (!m.failure) return m;
      return {
        ...m,
        failure: {
          matchIndex: m.failure.matchIndex,
          matchId: m.failure.matchId,
          baseSeed: m.failure.baseSeed,
          matchSeed: m.failure.matchSeed,
          playerSeeds: { ...m.failure.playerSeeds },
          phase: m.failure.phase,
          errorName: m.failure.errorName,
        } as any,
      };
    });

    const legResult: PolicyExperimentLegResult = {
      legId,
      seatAssignments,
      baseSeed,
      matchesPerSeat,
      matches: cleanMatches,
      failures: logicalFailures,
      summary: batchResult.summary,
    };

    const legRuntimeMetrics: PolicyExperimentLegRuntimeMetrics = {
      legId,
      batchRuntimeMetrics: batchResult.runtimeMetrics,
      diagnosticFailures,
    };

    return { legResult, legRuntimeMetrics };
  }

  /**
   * 特定 Participant の戦績（総合および asP1 / asP2）を集計
   */
  private static computeParticipantOutcome(
    participantId: string,
    leg1: PolicyExperimentLegResult,
    leg2: PolicyExperimentLegResult
  ): PolicyParticipantOutcomeSummary {
    const summarizeSeat = (
      leg: PolicyExperimentLegResult,
      mySeat: "p1" | "p2"
    ): PolicyParticipantSeatSummary => {
      const scheduled = leg.matchesPerSeat;
      let completed = 0;
      let wins = 0;
      let losses = 0;
      let draws = 0;
      let incomplete = 0;
      let failed = 0;

      for (const m of leg.matches) {
        if (m.status === "COMPLETED") {
          completed++;
          if (m.winner === mySeat) {
            wins++;
          } else if (m.winner !== undefined && m.winner !== null) {
            losses++;
          } else {
            draws++;
          }
        } else if (m.status === "INCOMPLETE") {
          incomplete++;
        } else if (m.status === "FAILED") {
          failed++;
        }
      }

      const winRateOnCompleted = completed > 0 ? wins / completed : 0;
      return {
        scheduledMatches: scheduled,
        completedMatches: completed,
        wins,
        losses,
        draws,
        incompleteMatches: incomplete,
        failedMatches: failed,
        winRateOnCompleted,
      };
    };

    // Leg 1 では p1 = A, p2 = B
    // Leg 2 では p1 = B, p2 = A
    const isP1InLeg1 = leg1.seatAssignments.p1 === participantId;
    const asP1 = isP1InLeg1
      ? summarizeSeat(leg1, "p1")
      : summarizeSeat(leg2, "p1");
    const asP2 = isP1InLeg1
      ? summarizeSeat(leg2, "p2")
      : summarizeSeat(leg1, "p2");

    const scheduledMatches = asP1.scheduledMatches + asP2.scheduledMatches;
    const completedMatches = asP1.completedMatches + asP2.completedMatches;
    const wins = asP1.wins + asP2.wins;
    const losses = asP1.losses + asP2.losses;
    const draws = asP1.draws + asP2.draws;
    const incompleteMatches = asP1.incompleteMatches + asP2.incompleteMatches;
    const failedMatches = asP1.failedMatches + asP2.failedMatches;
    const winRateOnCompleted = completedMatches > 0 ? wins / completedMatches : 0;

    return {
      participantId,
      scheduledMatches,
      completedMatches,
      wins,
      losses,
      draws,
      incompleteMatches,
      failedMatches,
      winRateOnCompleted,
      asP1,
      asP2,
    };
  }

  /**
   * 特定 Participant の行動集計
   */
  private static computeBehaviorSummary(
    participantId: string,
    records: readonly PolicyDecisionRecord[]
  ): PolicyBehaviorSummary {
    const myRecords = records.filter((r) => r.participantId === participantId);
    const totalObservedDecisions = myRecords.length;

    let actionSelections = 0;
    let passSelections = 0;
    let effectSelections = 0;
    let otherSelections = 0;
    let actionRequestDecisions = 0;
    let effectResolutionDecisions = 0;
    let otherSourceDecisions = 0;

    for (const r of myRecords) {
      if (r.selectedPatternKind === "ACTION") {
        actionSelections++;
      } else if (r.selectedPatternKind === "PASS") {
        passSelections++;
      } else if (r.selectedPatternKind === "EFFECT_SELECTION") {
        effectSelections++;
      } else {
        otherSelections++;
      }

      if (r.decisionSource === "ACTION_REQUEST") {
        actionRequestDecisions++;
      } else if (r.decisionSource === "EFFECT_RESOLUTION") {
        effectResolutionDecisions++;
      } else {
        otherSourceDecisions++;
      }
    }

    const actionSelectionRate =
      totalObservedDecisions > 0 ? actionSelections / totalObservedDecisions : 0;
    const passSelectionRate =
      totalObservedDecisions > 0 ? passSelections / totalObservedDecisions : 0;
    const effectSelectionRate =
      totalObservedDecisions > 0 ? effectSelections / totalObservedDecisions : 0;

    return {
      participantId,
      totalObservedDecisions,
      actionSelections,
      passSelections,
      effectSelections,
      otherSelections,
      actionRequestDecisions,
      effectResolutionDecisions,
      otherSourceDecisions,
      actionSelectionRate,
      passSelectionRate,
      effectSelectionRate,
    };
  }
}
