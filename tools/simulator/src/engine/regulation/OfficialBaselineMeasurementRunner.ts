import * as crypto from "crypto";
import { OfficialRegulationMatchFactory } from "./OfficialRegulationMatchFactory";
import { RegulationCatalog } from "./RegulationLoader";
import { RulePackage } from "../../domain/rules/RulePackage";
import { PolicyExperimentRunner } from "../ai/PolicyExperimentRunner";
import { BaselineParticipants } from "../ai/BaselinePolicies";
import {
  BaselineDiagnosticAccumulator,
  DecisionFeatureDiagnosticObserverPolicy,
} from "../ai/DecisionFeatureDiagnosticObserver";
import { OfficialSetupAuditor } from "./OfficialSetupAuditor";
import {
  BaselineMatchupSummary,
  MatchLengthMetrics,
  MatchLengthSummary,
  MatchOutcomeIndexEntry,
  OFFICIAL_BASELINE_MEASUREMENT_VERSION,
  OfficialBaselineLogicalPayload,
  OfficialBaselineMeasurementConfig,
  OfficialBaselineMeasurementMetadata,
  OfficialBaselineMeasurementResult,
  SetupAuditSummary,
} from "../../domain/ai/OfficialBaselineMeasurementTypes";
import { PolicyExperimentParticipant } from "../../domain/ai/PolicyExperimentTypes";

/**
 * オブジェクトキーを再帰的にアルファベット順ソートして完全決定論的 JSON 文字列を生成
 */
export function canonicalJsonStringify(obj: any): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return "[" + obj.map(canonicalJsonStringify).join(",") + "]";
  }
  const keys = Object.keys(obj).sort();
  const pairs = keys.map((key) => `${JSON.stringify(key)}:${canonicalJsonStringify(obj[key])}`);
  return "{" + pairs.join(",") + "}";
}

/**
 * 論理ペイロードから SHA-256 ダイジェストを算出
 */
export function computeLogicalDigest(payload: OfficialBaselineLogicalPayload): string {
  const json = canonicalJsonStringify(payload);
  return crypto.createHash("sha256").update(json, "utf8").digest("hex");
}

export function computeMetrics(values: number[]): MatchLengthMetrics {
  if (values.length === 0) {
    return { count: 0, mean: 0, median: 0, min: 0, max: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const mean = sum / sorted.length;
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { count: sorted.length, mean, median, min, max };
}

export class OfficialBaselineMeasurementRunner {
  public static readonly VERSION = OFFICIAL_BASELINE_MEASUREMENT_VERSION;

  /**
   * 準備済みコンテキストを用いてベースライン測定の単一実行（Run）を実行
   */
  public static async executeSingleRun(
    config: OfficialBaselineMeasurementConfig,
    catalog: RegulationCatalog,
    fullRulePackage: RulePackage,
    onProgress?: (msg: string) => void
  ): Promise<{
    payload: OfficialBaselineLogicalPayload;
    matchLengthSummary: MatchLengthSummary;
    matchOutcomeIndex: MatchOutcomeIndexEntry[];
    diagnosticErrorCount: number;
  }> {
    const reg = catalog.regulations.get(config.regulationId);
    if (!reg) throw new Error(`Regulation not found: ${config.regulationId}`);
    const frame = catalog.frames.get(reg.frameId);
    if (!frame) throw new Error(`Frame not found: ${reg.frameId}`);

    onProgress?.(`Starting Setup Audit (${config.setupAuditCount} seeds)...`);

    // 1. Setup Viability Audit (100 Seeds)
    const setupAudit: SetupAuditSummary = OfficialSetupAuditor.audit(
      reg,
      frame,
      fullRulePackage,
      {
        baseSeed: config.baseSeed,
        auditCount: config.setupAuditCount,
      }
    );

    onProgress?.(`Setup Audit completed. Ready: ${setupAudit.readySetups}, Rule Unspecified: ${setupAudit.ruleUnspecifiedSetups}, Terminal: ${setupAudit.terminalSetups}`);

    // 2. 4 Participants 定義
    const rawParticipants: PolicyExperimentParticipant[] = [
      BaselineParticipants.createFirstLegal("baseline-first-legal-v1", "FirstLegal", false),
      BaselineParticipants.createRandom("baseline-seeded-random-v1", "SeededRandom"),
      BaselineParticipants.createZeroGenome("baseline-zero-genome-v1", "ZeroGenome"),
      BaselineParticipants.createManualGenericGenome("baseline-manual-generic-v1", "ManualGenericGenome"),
    ];

    // 3. Central Diagnostic Accumulator
    const accumulator = new BaselineDiagnosticAccumulator();

    // 4. SessionFactory の準備
    const sessionFactory = await OfficialRegulationMatchFactory.prepareSessionFactory(
      config.regulationId,
      {
        catalog,
        fullRulePackage,
      }
    );

    // 5. 6 Matchup Pairings
    const pairs = [
      { a: rawParticipants[0], b: rawParticipants[1], pairId: "firstLegal-vs-seededRandom" },
      { a: rawParticipants[0], b: rawParticipants[2], pairId: "firstLegal-vs-zeroGenome" },
      { a: rawParticipants[0], b: rawParticipants[3], pairId: "firstLegal-vs-manualGeneric" },
      { a: rawParticipants[1], b: rawParticipants[2], pairId: "seededRandom-vs-zeroGenome" },
      { a: rawParticipants[1], b: rawParticipants[3], pairId: "seededRandom-vs-manualGeneric" },
      { a: rawParticipants[2], b: rawParticipants[3], pairId: "zeroGenome-vs-manualGeneric" },
    ];

    const matchupSummaries: BaselineMatchupSummary[] = [];
    const allDecisions: number[] = [];
    const allTurns: number[] = [];
    const completedDecisions: number[] = [];
    const completedTurns: number[] = [];
    let failedCount = 0;

    const perMatchupLength: Record<string, any> = {};
    const matchOutcomeIndex: MatchOutcomeIndexEntry[] = [];

    for (let i = 0; i < pairs.length; i++) {
      const { a, b, pairId } = pairs[i];
      onProgress?.(`[Matchup ${i + 1}/6] ${a.name} vs ${b.name} (${config.matchesPerSeat * 2} games)...`);

      // 透過的 Observer でラップ
      const wrappedA: PolicyExperimentParticipant = {
        id: a.id,
        name: a.name,
        artifactRef: a.artifactRef,
        policyFactory: (ctx, seat) => {
          const rawPolicy = a.policyFactory(ctx, seat);
          return new DecisionFeatureDiagnosticObserverPolicy(rawPolicy, a.id, accumulator);
        },
      };

      const wrappedB: PolicyExperimentParticipant = {
        id: b.id,
        name: b.name,
        artifactRef: b.artifactRef,
        policyFactory: (ctx, seat) => {
          const rawPolicy = b.policyFactory(ctx, seat);
          return new DecisionFeatureDiagnosticObserverPolicy(rawPolicy, b.id, accumulator);
        },
      };

      const expResult = PolicyExperimentRunner.run({
        experimentId: `exp-${pairId}-${config.baseSeed}`,
        environmentRef: config.environmentRef,
        baseSeed: config.baseSeed,
        matchesPerSeat: config.matchesPerSeat,
        maxDecisionsPerMatch: config.maxDecisionsPerMatch,
        participantA: wrappedA,
        participantB: wrappedB,
        sessionFactory,
      });

      // エラー分類 (SETUP_RULE_GAP vs TECHNICAL_FAILURE)
      let setupRuleGaps = 0;
      let technicalFailures = 0;

      const pairAllDecisions: number[] = [];
      const pairAllTurns: number[] = [];
      const pairCompletedDecisions: number[] = [];
      const pairCompletedTurns: number[] = [];

      for (const leg of expResult.legs) {
        for (const m of leg.matches) {
          const canonicalKey = `${pairId}:${leg.legId}:${m.matchIndex}`;
          matchOutcomeIndex.push({
            canonicalKey,
            pairId,
            legId: leg.legId,
            matchIndex: m.matchIndex,
            matchId: m.matchId,
            matchSeed: m.matchSeed,
            status: m.status,
            completed: m.completed,
            winner: m.winner,
            reason: m.reason,
            totalDecisions: m.totalDecisions,
            turnCount: m.turnCount,
          });

          allDecisions.push(m.totalDecisions);
          allTurns.push(m.turnCount);
          pairAllDecisions.push(m.totalDecisions);
          pairAllTurns.push(m.turnCount);

          if (m.completed) {
            completedDecisions.push(m.totalDecisions);
            completedTurns.push(m.turnCount);
            pairCompletedDecisions.push(m.totalDecisions);
            pairCompletedTurns.push(m.turnCount);
          }
          if (m.status === "FAILED") {
            failedCount++;
          }

          if (m.failure) {
            if (m.failure.errorName === "OfficialSetupRuleUnspecifiedError") {
              setupRuleGaps++;
            } else {
              technicalFailures++;
            }
          }
        }
      }

      perMatchupLength[pairId] = {
        allMatches: {
          count: pairAllDecisions.length,
          decisions: computeMetrics(pairAllDecisions),
          turns: computeMetrics(pairAllTurns),
        },
        completedMatches: {
          count: pairCompletedDecisions.length,
          decisions: computeMetrics(pairCompletedDecisions),
          turns: computeMetrics(pairCompletedTurns),
        },
      };

      const summaryA = expResult.summary.participants[a.id];
      const summaryB = expResult.summary.participants[b.id];

      const aWins = summaryA?.wins ?? 0;
      const bWins = summaryB?.wins ?? 0;
      const draws = summaryA?.draws ?? 0;
      const aAsP1 = summaryA?.asP1?.wins ?? 0;
      const aAsP2 = summaryA?.asP2?.wins ?? 0;
      const bAsP1 = summaryB?.asP1?.wins ?? 0;
      const bAsP2 = summaryB?.asP2?.wins ?? 0;

      const p1Wins = aAsP1 + bAsP1;
      const p2Wins = aAsP2 + bAsP2;
      const totalDecided = p1Wins + p2Wins;

      const summary: BaselineMatchupSummary = {
        pairId,
        participantA: { id: a.id, name: a.name },
        participantB: { id: b.id, name: b.name },
        scheduledMatches: expResult.summary.totalScheduledMatches,
        completedMatches: expResult.summary.totalCompletedMatches,
        incompleteMatches: expResult.summary.totalIncompleteMatches,
        setupRuleGapMatches: setupRuleGaps,
        technicalFailedMatches: technicalFailures,
        aWins,
        bWins,
        draws,
        aAsP1,
        aAsP2,
        bAsP1,
        bAsP2,
        p1Wins,
        p2Wins,
        p1WinRate: totalDecided > 0 ? p1Wins / totalDecided : 0,
        p2WinRate: totalDecided > 0 ? p2Wins / totalDecided : 0,
        winRateOnCompleted: summaryA?.winRateOnCompleted ?? 0,
      };

      matchupSummaries.push(summary);
    }

    const matchLengthSummary: MatchLengthSummary = {
      allMatches: {
        count: allDecisions.length,
        failedCount,
        decisions: computeMetrics(allDecisions),
        turns: computeMetrics(allTurns),
      },
      completedMatches: {
        count: completedDecisions.length,
        decisions: computeMetrics(completedDecisions),
        turns: computeMetrics(completedTurns),
      },
      perMatchup: perMatchupLength,
    };

    // 6. Logical Payload 構築
    const payload: OfficialBaselineLogicalPayload = {
      measurementResultVersion: this.VERSION,
      measurementId: config.measurementId,
      workId: config.workId,
      environmentRef: config.environmentRef,
      regulationId: config.regulationId,
      rulesVersion: "rules-vnext-9.1.2",
      featureSchemaVersion: "1.0.0",
      dnaFormatVersion: "1.0.0",
      baseSeed: config.baseSeed,
      setupAudit,
      matchups: matchupSummaries,
      participantBehavior: accumulator.getParticipantBehavior(),
      featureDiagnostics: {
        featureCollisions: accumulator.getFeatureCollisions(),
        activationCoverage: accumulator.getActivationCoverage(),
        genomeArgmaxTies: accumulator.getGenomeArgmaxTies(),
        counterfactualAgreements: accumulator.getCounterfactualAgreements(),
      },
      notes: [
        "Official Baseline Evidence Measurement without fitness scalar or evolution.",
        "Deterministic evaluation across 6 matchups x 100 matches (600 games total) using baseSeed 20260906.",
      ],
    };

    return {
      payload,
      matchLengthSummary,
      matchOutcomeIndex,
      diagnosticErrorCount: accumulator.diagnosticErrorCount,
    };
  }

  /**
   * Run A と Run B を実行し、完全決定論的一致（Repeatability）を確認した最終結果を生成
   */
  public static async run(
    config: OfficialBaselineMeasurementConfig,
    catalog: RegulationCatalog,
    fullRulePackage: RulePackage,
    onProgress?: (msg: string) => void
  ): Promise<OfficialBaselineMeasurementResult> {
    onProgress?.("=== Starting Primary Measurement: Run A ===");
    const runA = await this.executeSingleRun(config, catalog, fullRulePackage, onProgress);
    const digestA = computeLogicalDigest(runA.payload);

    onProgress?.(`Run A Digest: ${digestA}`);
    onProgress?.("=== Starting Repeatability Verification: Run B ===");
    const runB = await this.executeSingleRun(config, catalog, fullRulePackage, onProgress);
    const digestB = computeLogicalDigest(runB.payload);

    onProgress?.(`Run B Digest: ${digestB}`);

    // 1. Logical Payload Repeatability Verification
    const matched = digestA === digestB;
    const jsonA = canonicalJsonStringify(runA.payload);
    const jsonB = canonicalJsonStringify(runB.payload);
    const exactLogicalEquality = jsonA === jsonB;

    if (!matched || !exactLogicalEquality) {
      throw new Error(
        `Deterministic Repeatability Violation: Run A digest (${digestA}) does not match Run B digest (${digestB})`
      );
    }

    // 2. Match Length Summary Repeatability Verification
    const matchLengthJsonA = canonicalJsonStringify(runA.matchLengthSummary);
    const matchLengthJsonB = canonicalJsonStringify(runB.matchLengthSummary);
    if (matchLengthJsonA !== matchLengthJsonB) {
      throw new Error(
        `Deterministic Repeatability Violation: Run A matchLengthSummary does not match Run B matchLengthSummary`
      );
    }

    // 3. Match Outcome Index Repeatability & Uniqueness Verification
    const outcomeIndexJsonA = canonicalJsonStringify(runA.matchOutcomeIndex);
    const outcomeIndexJsonB = canonicalJsonStringify(runB.matchOutcomeIndex);
    if (outcomeIndexJsonA !== outcomeIndexJsonB) {
      throw new Error(
        `Deterministic Repeatability Violation: Run A matchOutcomeIndex does not match Run B matchOutcomeIndex`
      );
    }

    // 正準キーの全件・ユニーク性検証
    const expectedMatchCount = config.matchesPerSeat * 2 * 6;
    if (runA.matchOutcomeIndex.length !== expectedMatchCount) {
      throw new Error(
        `Match Outcome Index count mismatch: expected ${expectedMatchCount}, got ${runA.matchOutcomeIndex.length}`
      );
    }
    const keySet = new Set<string>();
    for (const entry of runA.matchOutcomeIndex) {
      if (keySet.has(entry.canonicalKey)) {
        throw new Error(`Duplicate canonical key in matchOutcomeIndex: ${entry.canonicalKey}`);
      }
      keySet.add(entry.canonicalKey);
    }

    const totalDiagnosticErrors = runA.diagnosticErrorCount + runB.diagnosticErrorCount;

    const reg = catalog.regulations.get(config.regulationId)!;
    const metadata: OfficialBaselineMeasurementMetadata = {
      sourceHead: config.sourceHead || "UNKNOWN",
      coreFlowRepairHead: config.coreFlowRepairHead || "783aa852c009a3801f5cca623c794cdbabda916f",
      sourceBaselineArtifact: config.sourceBaselineArtifact || "reports/ai/official-light-entry16-baseline-v1.json",
      sourceBaselineLogicalDigest: config.sourceBaselineLogicalDigest || "0f16b7d3f6193d58b016a5f5aeae9e5caef1c3faf5be2d5822027835c42ddaa4",
      formatId: reg.formatId,
      frameId: reg.frameId,
      experimentConfiguration: {
        matchCount: expectedMatchCount,
        matchesPerSeat: config.matchesPerSeat,
        maxDecisions: config.maxDecisionsPerMatch,
        baseSeed: config.baseSeed,
        setupAuditCount: config.setupAuditCount,
      },
      participantDefinitions: [
        { id: "baseline-first-legal-v1", name: "FirstLegal" },
        { id: "baseline-seeded-random-v1", name: "SeededRandom" },
        { id: "baseline-zero-genome-v1", name: "ZeroGenome" },
        { id: "baseline-manual-generic-v1", name: "ManualGenericGenome" },
      ],
      createdAt: new Date().toISOString(),
    };

    return {
      ...runA.payload,
      logicalDigest: digestA,
      repeatability: {
        runADigest: digestA,
        runBDigest: digestB,
        matched,
        exactLogicalEquality,
        diagnosticErrorCount: totalDiagnosticErrors,
      },
      metadata,
      matchLengthSummary: runA.matchLengthSummary,
      matchOutcomeIndex: runA.matchOutcomeIndex,
    };
  }
}

export const EXPECTED_V1_BASELINE_DIGEST = "0f16b7d3f6193d58b016a5f5aeae9e5caef1c3faf5be2d5822027835c42ddaa4";
export const EXPECTED_V1_DIAGNOSTICS_DIGEST = "0ee51e74dc28ab761123f58ff2d58a26757bc85445ff43428e745bdd42cceb20";

export function verifyHistoricalArtifactDigests(
  v1Baseline: { logicalDigest?: string },
  v1Diagnostics: { logicalDigest?: string; sourceBaselineDigest?: string }
): void {
  if (!v1Baseline || !v1Baseline.logicalDigest || v1Baseline.logicalDigest !== EXPECTED_V1_BASELINE_DIGEST) {
    throw new Error(
      `Source baseline logical digest mismatch: expected ${EXPECTED_V1_BASELINE_DIGEST}, got ${v1Baseline?.logicalDigest}`
    );
  }
  if (!v1Diagnostics || !v1Diagnostics.logicalDigest || v1Diagnostics.logicalDigest !== EXPECTED_V1_DIAGNOSTICS_DIGEST) {
    throw new Error(
      `Source diagnostics logical digest mismatch: expected ${EXPECTED_V1_DIAGNOSTICS_DIGEST}, got ${v1Diagnostics?.logicalDigest}`
    );
  }
  if (v1Diagnostics.sourceBaselineDigest !== EXPECTED_V1_BASELINE_DIGEST) {
    throw new Error(
      `Source diagnostics references unexpected baseline digest: ${v1Diagnostics.sourceBaselineDigest}`
    );
  }
}

