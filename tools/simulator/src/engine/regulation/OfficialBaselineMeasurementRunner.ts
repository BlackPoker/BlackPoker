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
  OFFICIAL_BASELINE_MEASUREMENT_VERSION,
  OfficialBaselineLogicalPayload,
  OfficialBaselineMeasurementConfig,
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
  ): Promise<{ payload: OfficialBaselineLogicalPayload; diagnosticErrorCount: number }> {
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

      for (const leg of expResult.legs) {
        for (const m of leg.matches) {
          if (m.failure) {
            if (m.failure.errorName === "OfficialSetupRuleUnspecifiedError") {
              setupRuleGaps++;
            } else {
              technicalFailures++;
            }
          }
        }
      }

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

    const matched = digestA === digestB;
    const jsonA = canonicalJsonStringify(runA.payload);
    const jsonB = canonicalJsonStringify(runB.payload);
    const exactLogicalEquality = jsonA === jsonB;

    if (!matched || !exactLogicalEquality) {
      throw new Error(
        `Deterministic Repeatability Violation: Run A digest (${digestA}) does not match Run B digest (${digestB})`
      );
    }

    const totalDiagnosticErrors = runA.diagnosticErrorCount + runB.diagnosticErrorCount;

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
    };
  }
}
