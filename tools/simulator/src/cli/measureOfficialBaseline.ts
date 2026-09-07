import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import { loadRegulationCatalog } from "../engine/regulation/RegulationLoader";
import { RegulationValidator } from "../engine/regulation/RegulationValidator";
import { loadRulePackageFromDirectory } from "../engine/rules/RuleLoader";
import {
  OfficialBaselineMeasurementRunner,
  EXPECTED_V1_BASELINE_DIGEST,
  EXPECTED_V1_DIAGNOSTICS_DIGEST,
  verifyHistoricalArtifactDigests,
} from "../engine/regulation/OfficialBaselineMeasurementRunner";
import {
  OfficialBaselineMeasurementConfig,
  OfficialBaselineMeasurementResult,
  MatchLengthMetrics,
} from "../domain/ai/OfficialBaselineMeasurementTypes";

export { EXPECTED_V1_BASELINE_DIGEST, EXPECTED_V1_DIAGNOSTICS_DIGEST, verifyHistoricalArtifactDigests };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface CliArgs {
  regulationId: string;
  baseSeed: number;
  setupAuditCount: number;
  matchesPerSeat: number;
  maxDecisions: number;
  workId: string;
  sourceHead: string;
  coreFlowRepairHead: string;
  outFile: string;
  deltaOutFile: string;
  sourceBaseline: string;
  sourceDiagnostics: string;
}

const PROTECTED_HISTORICAL_FILES = [
  "reports/ai/official-light-entry16-baseline-v1.json",
  "reports/ai/official-light-entry16-diagnostics-v1.1.json",
  "reports/coreflow/stage-top-cycle-case-m001-before-fix.json",
  "reports/coreflow/stage-top-cycle-case-m001-before-fix.txt",
];

function assertNotProtectedArtifact(filePath: string, role: string): void {
  const resolved = path.resolve(process.cwd(), filePath);
  for (const protectedRel of PROTECTED_HISTORICAL_FILES) {
    const protectedAbs = path.resolve(process.cwd(), protectedRel);
    if (path.normalize(resolved).toLowerCase() === path.normalize(protectedAbs).toLowerCase()) {
      throw new Error(
        `[SECURITY VIOLATION] Refusing to overwrite protected historical artifact for ${role}: ${filePath}`
      );
    }
  }
}

function computeMetrics(values: readonly number[]): MatchLengthMetrics {
  if (values.length === 0) {
    return { count: 0, mean: 0, median: 0, min: 0, max: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const count = sorted.length;
  const min = sorted[0];
  const max = sorted[count - 1];
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const mean = sum / count;
  const mid = Math.floor(count / 2);
  const median = count % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { count, mean, median, min, max };
}

function parseArgs(args: string[]): CliArgs {
  let regulationId = "light-entry16";
  let baseSeed = 20260906;
  let setupAuditCount = 100;
  let matchesPerSeat = 50;
  let maxDecisions = 500;
  let workId = "BP-SIM-AI-3.5-20260907-1750";
  let sourceHead = "UNKNOWN";
  let coreFlowRepairHead = "783aa852c009a3801f5cca623c794cdbabda916f";
  let outFile = "reports/ai/official-light-entry16-baseline-v2.json";
  let deltaOutFile = "reports/ai/official-light-entry16-baseline-v1-v2-delta.json";
  let sourceBaseline = "reports/ai/official-light-entry16-baseline-v1.json";
  let sourceDiagnostics = "reports/ai/official-light-entry16-diagnostics-v1.1.json";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--regulation" || arg === "-r") {
      if (args[i + 1]) regulationId = args[++i];
    } else if (arg === "--base-seed" || arg === "--baseSeed" || arg === "-s") {
      if (args[i + 1]) {
        const val = parseInt(args[++i], 10);
        if (!isNaN(val)) baseSeed = val;
      }
    } else if (arg === "--setup-audit-count" || arg === "--setupAuditCount") {
      if (args[i + 1]) {
        const val = parseInt(args[++i], 10);
        if (!isNaN(val)) setupAuditCount = val;
      }
    } else if (arg === "--matches-per-seat" || arg === "--matchesPerSeat") {
      if (args[i + 1]) {
        const val = parseInt(args[++i], 10);
        if (!isNaN(val)) matchesPerSeat = val;
      }
    } else if (arg === "--max-decisions" || arg === "--maxDecisions" || arg === "-m") {
      if (args[i + 1]) {
        const val = parseInt(args[++i], 10);
        if (!isNaN(val)) maxDecisions = val;
      }
    } else if (arg === "--work-id" || arg === "--workId") {
      if (args[i + 1]) workId = args[++i];
    } else if (arg === "--source-head" || arg === "--sourceHead") {
      if (args[i + 1]) sourceHead = args[++i];
    } else if (arg === "--core-flow-repair-head" || arg === "--coreFlowRepairHead") {
      if (args[i + 1]) coreFlowRepairHead = args[++i];
    } else if (arg === "--out" || arg === "-o") {
      if (args[i + 1]) outFile = args[++i];
    } else if (arg === "--delta-out" || arg === "--deltaOut") {
      if (args[i + 1]) deltaOutFile = args[++i];
    } else if (arg === "--source-baseline" || arg === "--sourceBaseline") {
      if (args[i + 1]) sourceBaseline = args[++i];
    } else if (arg === "--source-diagnostics" || arg === "--sourceDiagnostics") {
      if (args[i + 1]) sourceDiagnostics = args[++i];
    }
  }

  return {
    regulationId,
    baseSeed,
    setupAuditCount,
    matchesPerSeat,
    maxDecisions,
    workId,
    sourceHead,
    coreFlowRepairHead,
    outFile,
    deltaOutFile,
    sourceBaseline,
    sourceDiagnostics,
  };
}

async function main() {
  const cliArgs = parseArgs(process.argv.slice(2));

  // 1. 歴史的アーティファクト上書き保護チェック
  assertNotProtectedArtifact(cliArgs.outFile, "output file");
  assertNotProtectedArtifact(cliArgs.deltaOutFile, "delta output file");

  console.log("================================================================================");
  console.log("  BLACKPOKER OFFICIAL BASELINE MEASUREMENT (PHASE 3.5)");
  console.log("================================================================================");
  console.log(`Work ID:               ${cliArgs.workId}`);
  console.log(`Source HEAD:           ${cliArgs.sourceHead}`);
  console.log(`Core Flow Repair HEAD: ${cliArgs.coreFlowRepairHead}`);
  console.log(`Regulation:            ${cliArgs.regulationId}`);
  console.log(`Base Seed:             ${cliArgs.baseSeed}`);
  console.log(`Setup Audit:           ${cliArgs.setupAuditCount} unique seeds`);
  console.log(`Matches/Seat:          ${cliArgs.matchesPerSeat} (100 games/matchup x 6 = 600 total)`);
  console.log(`Max Decisions:         ${cliArgs.maxDecisions}`);
  console.log(`Output File:           ${cliArgs.outFile}`);
  console.log(`Delta Output File:     ${cliArgs.deltaOutFile}`);
  console.log(`Source Baseline:       ${cliArgs.sourceBaseline}`);
  console.log(`Source Diagnostics:    ${cliArgs.sourceDiagnostics}`);
  console.log("--------------------------------------------------------------------------------");

  // 2. 事前検証: 参照元歴史的アーティファクトの存在と整合性チェック
  const resolvedSourceBaseline = path.resolve(process.cwd(), cliArgs.sourceBaseline);
  if (!fs.existsSync(resolvedSourceBaseline)) {
    throw new Error(`Source baseline artifact not found: ${resolvedSourceBaseline}`);
  }
  const v1Baseline: OfficialBaselineMeasurementResult = JSON.parse(
    fs.readFileSync(resolvedSourceBaseline, "utf8")
  );

  const resolvedSourceDiagnostics = path.resolve(process.cwd(), cliArgs.sourceDiagnostics);
  if (!fs.existsSync(resolvedSourceDiagnostics)) {
    throw new Error(`Source diagnostics artifact not found: ${resolvedSourceDiagnostics}`);
  }
  const v1Diagnostics: any = JSON.parse(fs.readFileSync(resolvedSourceDiagnostics, "utf8"));

  verifyHistoricalArtifactDigests(v1Baseline, v1Diagnostics);
  console.log(`[PRE-CHECK] Source baseline verified. Logical Digest: ${v1Baseline.logicalDigest}`);
  console.log(`[PRE-CHECK] Source diagnostics verified. Logical Digest: ${v1Diagnostics.logicalDigest}, matches 111 incomplete cases.`);

  const catalog = await loadRegulationCatalog();
  RegulationValidator.validateRegulation(catalog, cliArgs.regulationId, {
    assertImplemented: true,
  });

  const rulesDir = path.resolve(__dirname, "../data/rules-vnext");
  const fullRulePackage = await loadRulePackageFromDirectory(rulesDir);

  const config: OfficialBaselineMeasurementConfig = {
    measurementId: `baseline-${cliArgs.regulationId}-${cliArgs.baseSeed}`,
    workId: cliArgs.workId,
    environmentRef: `official:${cliArgs.regulationId}`,
    regulationId: cliArgs.regulationId,
    baseSeed: cliArgs.baseSeed,
    setupAuditCount: cliArgs.setupAuditCount,
    matchesPerSeat: cliArgs.matchesPerSeat,
    maxDecisionsPerMatch: cliArgs.maxDecisions,
    sourceHead: cliArgs.sourceHead,
    coreFlowRepairHead: cliArgs.coreFlowRepairHead,
    sourceBaselineArtifact: cliArgs.sourceBaseline,
    sourceBaselineLogicalDigest: v1Baseline.logicalDigest,
  };

  const result = await OfficialBaselineMeasurementRunner.run(
    config,
    catalog,
    fullRulePackage,
    (msg) => console.log(`[INFO] ${msg}`)
  );

  console.log("================================================================================");
  console.log("  MEASUREMENT SUMMARY");
  console.log("================================================================================");
  console.log(
    `[Setup Audit] Planned: ${result.setupAudit.plannedSetups}, READY: ${result.setupAudit.readySetups}, RULE_UNSPECIFIED: ${result.setupAudit.ruleUnspecifiedSetups}, TERMINAL: ${result.setupAudit.terminalSetups}`
  );
  if (result.setupAudit.ruleUnspecifiedSetups > 0) {
    console.log(
      `  - 3.9.2 First Player Exhaustion: ${result.setupAudit.reasonBreakdown.FIRST_PLAYER_DETERMINATION_LIFE_EXHAUSTED}`
    );
    console.log(
      `  - 3.9.3 Game Start Draw Exhaustion: ${result.setupAudit.reasonBreakdown.GAME_START_DRAW_LIFE_EXHAUSTED}`
    );
  }

  let totalScheduled = 0;
  let totalCompleted = 0;
  let totalIncomplete = 0;

  console.log("\n[Matchup Results (6 Pairs)]");
  for (const m of result.matchups) {
    totalScheduled += m.scheduledMatches;
    totalCompleted += m.completedMatches;
    totalIncomplete += m.incompleteMatches;
    console.log(`  ${m.pairId}:`);
    console.log(
      `    Scheduled: ${m.scheduledMatches}, Completed: ${m.completedMatches}, Incomplete: ${m.incompleteMatches}, Setup Gap: ${m.setupRuleGapMatches}, Tech Failure: ${m.technicalFailedMatches}`
    );
    console.log(
      `    Wins: ${m.participantA.name} ${m.aWins} - ${m.bWins} ${m.participantB.name} (Draws: ${m.draws})`
    );
    console.log(
      `    Seat Split: P1 Wins: ${m.p1Wins} (${(m.p1WinRate * 100).toFixed(1)}%), P2 Wins: ${m.p2Wins} (${(m.p2WinRate * 100).toFixed(1)}%)`
    );
  }

  console.log("\n[Completion Rate]");
  console.log(
    `  Total: ${totalScheduled}, Completed: ${totalCompleted} (${((totalCompleted / totalScheduled) * 100).toFixed(1)}%), Incomplete: ${totalIncomplete}`
  );

  if (result.matchLengthSummary) {
    console.log("\n[Match Length (Decisions & Turns)]");
    console.log(
      `  All Matches (${result.matchLengthSummary.allMatches.count}): Decisions [mean: ${result.matchLengthSummary.allMatches.decisions.mean.toFixed(1)}, median: ${result.matchLengthSummary.allMatches.decisions.median}, min: ${result.matchLengthSummary.allMatches.decisions.min}, max: ${result.matchLengthSummary.allMatches.decisions.max}], Turns [mean: ${result.matchLengthSummary.allMatches.turns.mean.toFixed(1)}, median: ${result.matchLengthSummary.allMatches.turns.median}, min: ${result.matchLengthSummary.allMatches.turns.min}, max: ${result.matchLengthSummary.allMatches.turns.max}]`
    );
    console.log(
      `  Completed Matches (${result.matchLengthSummary.completedMatches.count}): Decisions [mean: ${result.matchLengthSummary.completedMatches.decisions.mean.toFixed(1)}, median: ${result.matchLengthSummary.completedMatches.decisions.median}, min: ${result.matchLengthSummary.completedMatches.decisions.min}, max: ${result.matchLengthSummary.completedMatches.decisions.max}], Turns [mean: ${result.matchLengthSummary.completedMatches.turns.mean.toFixed(1)}, median: ${result.matchLengthSummary.completedMatches.turns.median}, min: ${result.matchLengthSummary.completedMatches.turns.min}, max: ${result.matchLengthSummary.completedMatches.turns.max}]`
    );
  }

  console.log("\n[Feature Diagnostics]");
  console.log(
    `  Context Coverage: ${result.featureDiagnostics.activationCoverage.context.activatedFeatures}/${result.featureDiagnostics.activationCoverage.context.totalFeatures} (${(result.featureDiagnostics.activationCoverage.context.coverageRate * 100).toFixed(1)}%)`
  );
  console.log(
    `  Pattern Coverage: ${result.featureDiagnostics.activationCoverage.pattern.activatedFeatures}/${result.featureDiagnostics.activationCoverage.pattern.totalFeatures} (${(result.featureDiagnostics.activationCoverage.pattern.coverageRate * 100).toFixed(1)}%)`
  );

  for (const c of result.featureDiagnostics.featureCollisions) {
    console.log(
      `  Collision [${c.participantId}]: ${c.decisionsWithPatternCollision}/${c.encodedDecisions} decisions (${(c.collisionDecisionRate * 100).toFixed(1)}%), Colliding Patterns: ${c.collidingPatterns}, Max Group: ${c.maxCollisionGroupSize}`
    );
  }

  console.log("\n[Genome Argmax Ties]");
  for (const t of result.featureDiagnostics.genomeArgmaxTies) {
    console.log(
      `  Tie [${t.participantId}]: ${t.decisionsWithArgmaxTie}/${t.scoredDecisions} (${(t.argmaxTieRate * 100).toFixed(1)}%), Max Tied Patterns: ${t.maxTopTieCount}`
    );
  }

  console.log("\n[Counterfactual Agreement]");
  for (const a of result.featureDiagnostics.counterfactualAgreements) {
    console.log(
      `  Agreement [${a.participantId}]: same-as-FirstLegal: ${(a.sameAsFirstLegalRate * 100).toFixed(1)}%, same-as-Zero: ${(a.sameAsZeroGenomeRate * 100).toFixed(1)}%`
    );
  }

  console.log("\n[Repeatability Gate]");
  console.log(`  Run A Digest:          ${result.repeatability.runADigest}`);
  console.log(`  Run B Digest:          ${result.repeatability.runBDigest}`);
  console.log(`  Matched:               ${result.repeatability.matched}`);
  console.log(`  Exact Logical Equality:${result.repeatability.exactLogicalEquality}`);
  console.log(`  Diagnostic Errors:     ${result.repeatability.diagnosticErrorCount}`);

  // 3. Baseline v2 保存
  const resolvedOut = path.isAbsolute(cliArgs.outFile)
    ? cliArgs.outFile
    : path.resolve(process.cwd(), cliArgs.outFile);

  fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
  fs.writeFileSync(resolvedOut, JSON.stringify(result, null, 2), "utf8");
  console.log(`\n[SUCCESS] Baseline v2 artifact saved to: ${resolvedOut}`);

  // 4. 旧111件の照合と Delta Artifact の生成
  const outcomeMap = new Map<string, any>();
  if (result.matchOutcomeIndex) {
    for (const entry of result.matchOutcomeIndex) {
      outcomeMap.set(entry.canonicalKey, entry);
    }
  }

  const oldIncompleteCases: any[] = v1Diagnostics.incompleteCases || [];
  const trackedOldCases: any[] = [];
  const oldCaseDecisions: number[] = [];
  const oldCaseTurns: number[] = [];
  let oldCompletedCount = 0;
  let oldStillIncompleteCount = 0;
  let unmatchedCount = 0;

  for (const oldCase of oldIncompleteCases) {
    const canonicalKey = `${oldCase.pairId}:${oldCase.legId}:${oldCase.matchIndex}`;
    const v2Outcome = outcomeMap.get(canonicalKey);
    if (!v2Outcome) {
      unmatchedCount++;
      console.warn(`[WARN] Old incomplete case not found in v2 outcomes: ${canonicalKey}`);
      continue;
    }

    if (v2Outcome.completed) {
      oldCompletedCount++;
    } else {
      oldStillIncompleteCount++;
    }
    oldCaseDecisions.push(v2Outcome.totalDecisions);
    oldCaseTurns.push(v2Outcome.turnCount);

    trackedOldCases.push({
      caseId: oldCase.caseId,
      canonicalKey,
      pairId: oldCase.pairId,
      legId: oldCase.legId,
      matchIndex: oldCase.matchIndex,
      matchSeed: oldCase.matchSeed,
      v1Status: "INCOMPLETE",
      v1Primary500Decisions: 500,
      v2Status: v2Outcome.status,
      v2Completed: v2Outcome.completed,
      v2Winner: v2Outcome.winner,
      v2Reason: v2Outcome.reason,
      v2TotalDecisions: v2Outcome.totalDecisions,
      v2TurnCount: v2Outcome.turnCount,
    });
  }

  if (oldIncompleteCases.length > 0 && unmatchedCount > 0) {
    throw new Error(
      `Deterministic Tracking Failure: ${unmatchedCount}/${oldIncompleteCases.length} old cases could not be matched in v2 outcomes`
    );
  }

  // 全体完走率比較
  let v1TotalScheduled = 0;
  let v1TotalCompleted = 0;
  let v1TotalIncomplete = 0;
  for (const m of v1Baseline.matchups) {
    v1TotalScheduled += m.scheduledMatches;
    v1TotalCompleted += m.completedMatches;
    v1TotalIncomplete += m.incompleteMatches;
  }

  const matchupDeltas = result.matchups.map((v2M) => {
    const v1M = v1Baseline.matchups.find((m) => m.pairId === v2M.pairId);
    return {
      pairId: v2M.pairId,
      participantA: v2M.participantA,
      participantB: v2M.participantB,
      v1: {
        scheduled: v1M?.scheduledMatches ?? 0,
        completed: v1M?.completedMatches ?? 0,
        incomplete: v1M?.incompleteMatches ?? 0,
        aWins: v1M?.aWins ?? 0,
        bWins: v1M?.bWins ?? 0,
        draws: v1M?.draws ?? 0,
        winRateOnCompleted: v1M?.winRateOnCompleted ?? 0,
        p1WinRate: v1M?.p1WinRate ?? 0,
        p2WinRate: v1M?.p2WinRate ?? 0,
      },
      v2: {
        scheduled: v2M.scheduledMatches,
        completed: v2M.completedMatches,
        incomplete: v2M.incompleteMatches,
        aWins: v2M.aWins,
        bWins: v2M.bWins,
        draws: v2M.draws,
        winRateOnCompleted: v2M.winRateOnCompleted,
        p1Wins: v2M.p1Wins,
        p2Wins: v2M.p2Wins,
        p1WinRate: v2M.p1WinRate,
        p2WinRate: v2M.p2WinRate,
      },
      delta: {
        completed: v2M.completedMatches - (v1M?.completedMatches ?? 0),
        incomplete: v2M.incompleteMatches - (v1M?.incompleteMatches ?? 0),
        aWins: v2M.aWins - (v1M?.aWins ?? 0),
        bWins: v2M.bWins - (v1M?.bWins ?? 0),
        winRateOnCompleted: v2M.winRateOnCompleted - (v1M?.winRateOnCompleted ?? 0),
      },
    };
  });

  const deltaArtifact = {
    deltaArtifactVersion: "1.0.0",
    workId: cliArgs.workId,
    createdAt: new Date().toISOString(),
    baseHead: cliArgs.coreFlowRepairHead,
    coreFlowRepairHead: cliArgs.coreFlowRepairHead,
    sourceHead: cliArgs.sourceHead,
    sourceBaseline: {
      artifactPath: cliArgs.sourceBaseline,
      logicalDigest: v1Baseline.logicalDigest,
      workId: v1Baseline.workId,
    },
    targetBaseline: {
      artifactPath: cliArgs.outFile,
      logicalDigest: result.logicalDigest,
      workId: result.workId,
      exactLogicalEquality: result.repeatability.exactLogicalEquality,
    },
    sourceDiagnostics: {
      artifactPath: cliArgs.sourceDiagnostics,
      diagnosticsDigest: v1Diagnostics.logicalDigest,
      sourceBaselineDigest: v1Diagnostics.sourceBaselineDigest,
    },
    comparison: {
      completion: {
        v1: {
          total: v1TotalScheduled,
          completed: v1TotalCompleted,
          incomplete: v1TotalIncomplete,
          completionRate: v1TotalScheduled > 0 ? v1TotalCompleted / v1TotalScheduled : 0,
        },
        v2: {
          total: totalScheduled,
          completed: totalCompleted,
          incomplete: totalIncomplete,
          completionRate: totalScheduled > 0 ? totalCompleted / totalScheduled : 0,
        },
        delta: {
          completed: totalCompleted - v1TotalCompleted,
          incomplete: totalIncomplete - v1TotalIncomplete,
          completionRate:
            (totalScheduled > 0 ? totalCompleted / totalScheduled : 0) -
            (v1TotalScheduled > 0 ? v1TotalCompleted / v1TotalScheduled : 0),
        },
      },
      matchups: matchupDeltas,
      matchLength: result.matchLengthSummary,
      featureCoverage: {
        v1: {
          contextActive: v1Baseline.featureDiagnostics.activationCoverage.context.activatedFeatures,
          contextTotal: v1Baseline.featureDiagnostics.activationCoverage.context.totalFeatures,
          patternActive: v1Baseline.featureDiagnostics.activationCoverage.pattern.activatedFeatures,
          patternTotal: v1Baseline.featureDiagnostics.activationCoverage.pattern.totalFeatures,
        },
        v2: {
          contextActive: result.featureDiagnostics.activationCoverage.context.activatedFeatures,
          contextTotal: result.featureDiagnostics.activationCoverage.context.totalFeatures,
          patternActive: result.featureDiagnostics.activationCoverage.pattern.activatedFeatures,
          patternTotal: result.featureDiagnostics.activationCoverage.pattern.totalFeatures,
        },
      },
      featureCollisions: {
        v1: v1Baseline.featureDiagnostics.featureCollisions,
        v2: result.featureDiagnostics.featureCollisions,
      },
      genomeArgmaxTies: {
        v1: v1Baseline.featureDiagnostics.genomeArgmaxTies,
        v2: result.featureDiagnostics.genomeArgmaxTies,
      },
      counterfactualAgreements: {
        v1: v1Baseline.featureDiagnostics.counterfactualAgreements,
        v2: result.featureDiagnostics.counterfactualAgreements,
      },
    },
    oldIncompleteTracking: {
      totalOldIncompleteCases: oldIncompleteCases.length,
      matchedInV2Count: trackedOldCases.length,
      unmatchedCount,
      duplicateCount: 0,
      v2CompletedCount: oldCompletedCount,
      v2StillIncompleteCount: oldStillIncompleteCount,
      v2Decisions: computeMetrics(oldCaseDecisions),
      v2Turns: computeMetrics(oldCaseTurns),
      cases: trackedOldCases,
    },
  };

  const resolvedDeltaOut = path.isAbsolute(cliArgs.deltaOutFile)
    ? cliArgs.deltaOutFile
    : path.resolve(process.cwd(), cliArgs.deltaOutFile);

  fs.mkdirSync(path.dirname(resolvedDeltaOut), { recursive: true });
  fs.writeFileSync(resolvedDeltaOut, JSON.stringify(deltaArtifact, null, 2), "utf8");
  console.log(`[SUCCESS] Delta artifact saved to: ${resolvedDeltaOut}`);
  console.log(
    `[OLD 111 TRACKING] Matched: ${trackedOldCases.length}/${oldIncompleteCases.length}, Completed: ${oldCompletedCount}, Still Incomplete: ${oldStillIncompleteCount}`
  );
}

main().catch((err) => {
  console.error("[FATAL ERROR]", err);
  process.exit(1);
});
