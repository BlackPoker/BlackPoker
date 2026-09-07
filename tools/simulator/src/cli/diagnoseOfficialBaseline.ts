import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import { loadRegulationCatalog } from "../engine/regulation/RegulationLoader";
import { RegulationValidator } from "../engine/regulation/RegulationValidator";
import { loadRulePackageFromDirectory } from "../engine/rules/RuleLoader";
import { OfficialBaselineDiagnosticsRunner } from "../engine/diagnostics/OfficialBaselineDiagnosticsRunner";
import {
  OfficialBaselineDiagnosticsConfig,
  OFFICIAL_BASELINE_DIAGNOSTICS_VERSION_1_1,
} from "../domain/ai/OfficialBaselineDiagnosticsTypes";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface CliArgs {
  regulationId: string;
  baseSeed: number;
  matchesPerSeat: number;
  primaryMaxDecisions: number;
  secondaryMaxDecisions: number;
  tertiaryMaxDecisions: number;
  outFile: string;
}

function parseArgs(args: string[]): CliArgs {
  let regulationId = "light-entry16";
  let baseSeed = 20260906;
  let matchesPerSeat = 50;
  let primaryMaxDecisions = 500;
  let secondaryMaxDecisions = 1000;
  let tertiaryMaxDecisions = 2000;
  let outFile = "reports/ai/official-light-entry16-diagnostics-v1.1.json";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--regulation" || arg === "-r") {
      if (args[i + 1]) regulationId = args[++i];
    } else if (arg === "--base-seed" || arg === "--baseSeed" || arg === "-s") {
      if (args[i + 1]) {
        const val = parseInt(args[++i], 10);
        if (!isNaN(val)) baseSeed = val;
      }
    } else if (arg === "--matches-per-seat" || arg === "--matchesPerSeat") {
      if (args[i + 1]) {
        const val = parseInt(args[++i], 10);
        if (!isNaN(val)) matchesPerSeat = val;
      }
    } else if (arg === "--primary-max-decisions" || arg === "--primaryMaxDecisions") {
      if (args[i + 1]) {
        const val = parseInt(args[++i], 10);
        if (!isNaN(val)) primaryMaxDecisions = val;
      }
    } else if (arg === "--secondary-max-decisions" || arg === "--secondaryMaxDecisions") {
      if (args[i + 1]) {
        const val = parseInt(args[++i], 10);
        if (!isNaN(val)) secondaryMaxDecisions = val;
      }
    } else if (arg === "--tertiary-max-decisions" || arg === "--tertiaryMaxDecisions") {
      if (args[i + 1]) {
        const val = parseInt(args[++i], 10);
        if (!isNaN(val)) tertiaryMaxDecisions = val;
      }
    } else if (arg === "--out" || arg === "-o") {
      if (args[i + 1]) outFile = args[++i];
    }
  }

  return {
    regulationId,
    baseSeed,
    matchesPerSeat,
    primaryMaxDecisions,
    secondaryMaxDecisions,
    tertiaryMaxDecisions,
    outFile,
  };
}

async function main() {
  const cliArgs = parseArgs(process.argv.slice(2));

  console.log("================================================================================");
  console.log("  BlackPoker Official Baseline Diagnostics Runner (Phase 3.4.1)");
  console.log("================================================================================");
  console.log(`Regulation:              ${cliArgs.regulationId}`);
  console.log(`Base Seed:               ${cliArgs.baseSeed}`);
  console.log(`Matches Per Seat:        ${cliArgs.matchesPerSeat} (Total: ${cliArgs.matchesPerSeat * 2 * 6} matches)`);
  console.log(`Step Budgets:            Primary=${cliArgs.primaryMaxDecisions}, Secondary=${cliArgs.secondaryMaxDecisions}, Tertiary=${cliArgs.tertiaryMaxDecisions}`);
  console.log(`Output File:             ${cliArgs.outFile}`);
  console.log("--------------------------------------------------------------------------------");

  const catalog = await loadRegulationCatalog();
  const reg = catalog.regulations.get(cliArgs.regulationId);
  if (!reg) {
    throw new Error(`Regulation not found: ${cliArgs.regulationId}`);
  }

  const valResult = RegulationValidator.validateRegulation(catalog, cliArgs.regulationId, { assertImplemented: true });
  if (!valResult.simulatorImplemented) {
    throw new Error(`Regulation not implemented in simulator: ${cliArgs.regulationId}`);
  }

  const rulesDir = path.resolve(__dirname, "../data/rules-vnext");
  const fullRulePackage = await loadRulePackageFromDirectory(rulesDir);

  const config: OfficialBaselineDiagnosticsConfig = {
    diagnosticsVersion: OFFICIAL_BASELINE_DIAGNOSTICS_VERSION_1_1,
    workId: "BP-SIM-AI-3.4.1-20260906-1841",
    sourceBaselineDigest: "0f16b7d3f6193d58b016a5f5aeae9e5caef1c3faf5be2d5822027835c42ddaa4",
    regulationId: cliArgs.regulationId,
    baseSeed: cliArgs.baseSeed,
    primaryMaxDecisions: cliArgs.primaryMaxDecisions,
    secondaryMaxDecisions: cliArgs.secondaryMaxDecisions,
    tertiaryMaxDecisions: cliArgs.tertiaryMaxDecisions,
    matchesPerSeat: cliArgs.matchesPerSeat,
  };

  const result = await OfficialBaselineDiagnosticsRunner.run(
    config,
    catalog,
    fullRulePackage,
    (msg) => console.log(`[INFO] ${msg}`)
  );

  console.log("================================================================================");
  console.log("  DIAGNOSTICS SUMMARY");
  console.log("================================================================================");
  console.log(`Total Primary Matches:               ${result.totalPrimaryMatches}`);
  console.log(`Primary Incomplete Count:            ${result.totalIncompleteCases} (Matches Phase 3.3: ${result.matchedPhase33BaselineIncompleteCount})`);
  console.log(`  - Finished by 1000:                ${result.incompleteOutcomeCounts.finishedBy1000}`);
  console.log(`  - Finished by 2000:                ${result.incompleteOutcomeCounts.finishedBy2000}`);
  console.log(`  - Still Incomplete (Recurrence):   ${result.incompleteOutcomeCounts.stillIncompleteWithRecurrence}`);
  console.log(`  - Still Incomplete (No Recurrence):${result.incompleteOutcomeCounts.stillIncompleteWithoutRecurrence}`);
  console.log(`  - Deterministic Cycle Candidates:  ${result.incompleteOutcomeCounts.deterministicCycleCandidates}`);

  console.log("\n[State Hash v2 Recurrence Summary]");
  console.log(`  Cases with State Recurrence:       ${result.stateRecurrenceSummary.casesWithRecurrence}/${result.totalIncompleteCases}`);
  console.log(`  Max Visits per State Hash:         ${result.stateRecurrenceSummary.maxVisitsObserved}`);
  console.log(`  Shortest Repeat Distance:          ${result.stateRecurrenceSummary.minRepeatDistanceObserved ?? "N/A"}`);

  if (result.cycleFingerprintRecurrenceSummary) {
    console.log("\n[Cycle State Fingerprint v1 Recurrence Summary]");
    console.log(`  Cases with Cycle Recurrence:       ${result.cycleFingerprintRecurrenceSummary.casesWithRecurrence}/${result.totalIncompleteCases}`);
    console.log(`  Max Visits per Fingerprint:        ${result.cycleFingerprintRecurrenceSummary.maxVisitsObserved}`);
    console.log(`  Shortest Repeat Distance:          ${result.cycleFingerprintRecurrenceSummary.minRepeatDistanceObserved ?? "N/A"}`);
  }

  if (result.requestBufferSummary) {
    console.log("\n[Request Buffer Depth Summary]");
    console.log(`  Max Observed Buffer Depth:         ${result.requestBufferSummary.maxObservedBufferDepth}`);
    console.log(`  Average Final Buffer Depth:        ${result.requestBufferSummary.averageFinalBufferDepth}`);
  }

  if (result.divergenceSummary) {
    console.log("\n[Divergence Summary]");
    console.log(`  All Turn 1 Cases:                  ${result.divergenceSummary.allTurn1Cases}/${result.totalIncompleteCases}`);
    console.log(`  Turn Stalled with Cycle Recurrence:${result.divergenceSummary.turnStalledWithCycleRecurrenceCases}/${result.totalIncompleteCases}`);
  }

  console.log("\n[Core Flow: Stage-Empty PASS Summary]");
  console.log(`  Cases with Stage-Empty PASS:       ${result.stageEmptyPassSummary.totalCasesWithStageEmptyPass}/${result.totalIncompleteCases}`);
  console.log(`  Max Consecutive Stage-Empty PASS:  ${result.stageEmptyPassSummary.maxConsecutiveObserved}`);
  console.log(`  Co-occurrence with Recurrence:     ${result.stageEmptyPassSummary.cooccurrenceWithRecurrenceCases}`);
  console.log(`  Co-occurrence with Cycle Candidate:${result.stageEmptyPassSummary.cooccurrenceWithCycleCandidates}`);

  console.log("\n[Policy Distinguishability Summary]");
  console.log(`  Comparable Requests:               ${result.policyDistinguishability.comparableRequests}`);
  console.log(`  Single Logical Choice:             ${result.policyDistinguishability.requestsWithOneLogicalChoice} (${((result.policyDistinguishability.requestsWithOneLogicalChoice / result.policyDistinguishability.comparableRequests) * 100).toFixed(1)}%)`);
  console.log(`  Multiple Logical Choices:          ${result.policyDistinguishability.requestsWithMultipleLogicalChoices} (${((result.policyDistinguishability.requestsWithMultipleLogicalChoices / result.policyDistinguishability.comparableRequests) * 100).toFixed(1)}%)`);
  console.log(`  FirstLegal vs Zero Agreement:      ${result.policyDistinguishability.choiceDiversity.firstLegalVsZeroAgreementRate}% (Diff: ${result.policyDistinguishability.choiceDiversity.firstLegalVsZeroDifferent})`);
  console.log(`  FirstLegal vs Manual Agreement:    ${result.policyDistinguishability.choiceDiversity.firstLegalVsManualAgreementRate}% (Diff: ${result.policyDistinguishability.choiceDiversity.firstLegalVsManualDifferent})`);
  console.log(`  Zero vs Manual Agreement:          ${result.policyDistinguishability.choiceDiversity.zeroVsManualAgreementRate}% (Diff: ${result.policyDistinguishability.choiceDiversity.zeroVsManualDifferent})`);

  console.log("\n[ZeroGenome & ManualGeneric Diagnostics]");
  console.log(`  Zero All Legal Scores Equal:       ${result.policyDistinguishability.zeroGenome.allLegalScoresEqualRequests}/${result.policyDistinguishability.zeroGenome.scoredRequests}`);
  console.log(`  Zero Argmax Tie Requests:          ${result.policyDistinguishability.zeroGenome.argmaxTieRequests}/${result.policyDistinguishability.zeroGenome.scoredRequests}`);
  console.log(`  Manual Unique Argmax Requests:     ${result.policyDistinguishability.manualGenericGenome.uniqueArgmaxRequests}/${result.policyDistinguishability.manualGenericGenome.scoredRequests}`);
  console.log(`  Manual Argmax Tie Requests:        ${result.policyDistinguishability.manualGenericGenome.argmaxTieRequests}/${result.policyDistinguishability.manualGenericGenome.scoredRequests}`);
  console.log(`  Manual Score Margin Summary:       min=${result.policyDistinguishability.manualGenericGenome.marginSummary.min}, mean=${result.policyDistinguishability.manualGenericGenome.marginSummary.mean}, median=${result.policyDistinguishability.manualGenericGenome.marginSummary.median}, p90=${result.policyDistinguishability.manualGenericGenome.marginSummary.p90}, max=${result.policyDistinguishability.manualGenericGenome.marginSummary.max}`);
  console.log(`  Collision + Tie Co-occurrence:     ${result.policyDistinguishability.featureRelationship.argmaxTieWithCollisionCooccurrenceCount} (${result.policyDistinguishability.featureRelationship.cooccurrenceRateOnTies}%)`);

  console.log("\n[Repeatability Gate]");
  console.log(`  Run A Digest:                      ${result.repeatability.runADigest}`);
  console.log(`  Run B Digest:                      ${result.repeatability.runBDigest}`);
  console.log(`  Matched:                           ${result.repeatability.matched}`);
  console.log(`  Exact Logical Equality:            ${result.repeatability.exactLogicalEquality}`);

  const resolvedOut = path.isAbsolute(cliArgs.outFile)
    ? cliArgs.outFile
    : path.resolve(process.cwd(), cliArgs.outFile);

  fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
  fs.writeFileSync(resolvedOut, JSON.stringify(result, null, 2), "utf8");
  console.log(`\n[SUCCESS] Diagnostics artifact saved to: ${resolvedOut}`);
}

main().catch((err) => {
  console.error("FATAL ERROR in diagnoseOfficialBaseline:", err);
  process.exit(1);
});
