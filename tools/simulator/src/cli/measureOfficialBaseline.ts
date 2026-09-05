import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import { loadRegulationCatalog } from "../engine/regulation/RegulationLoader";
import { RegulationValidator } from "../engine/regulation/RegulationValidator";
import { loadRulePackageFromDirectory } from "../engine/rules/RuleLoader";
import { OfficialBaselineMeasurementRunner } from "../engine/regulation/OfficialBaselineMeasurementRunner";
import { OfficialBaselineMeasurementConfig } from "../domain/ai/OfficialBaselineMeasurementTypes";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface CliArgs {
  regulationId: string;
  baseSeed: number;
  setupAuditCount: number;
  matchesPerSeat: number;
  maxDecisions: number;
  outFile: string;
}

function parseArgs(args: string[]): CliArgs {
  let regulationId = "light-entry16";
  let baseSeed = 20260906;
  let setupAuditCount = 100;
  let matchesPerSeat = 50;
  let maxDecisions = 500;
  let outFile = "reports/ai/official-light-entry16-baseline-v1.json";

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
    } else if (arg === "--out" || arg === "-o") {
      if (args[i + 1]) outFile = args[++i];
    }
  }

  return { regulationId, baseSeed, setupAuditCount, matchesPerSeat, maxDecisions, outFile };
}

async function main() {
  const cliArgs = parseArgs(process.argv.slice(2));

  console.log("================================================================================");
  console.log("  BLACKPOKER OFFICIAL BASELINE MEASUREMENT (AI PHASE 3.3)");
  console.log("================================================================================");
  console.log(`Regulation:      ${cliArgs.regulationId}`);
  console.log(`Base Seed:       ${cliArgs.baseSeed}`);
  console.log(`Setup Audit:     ${cliArgs.setupAuditCount} unique seeds`);
  console.log(`Matches/Seat:    ${cliArgs.matchesPerSeat} (100 games/matchup x 6 = 600 total)`);
  console.log(`Max Decisions:   ${cliArgs.maxDecisions}`);
  console.log(`Output File:     ${cliArgs.outFile}`);
  console.log("--------------------------------------------------------------------------------");

  const catalog = await loadRegulationCatalog();
  RegulationValidator.validateRegulation(catalog, cliArgs.regulationId, {
    assertImplemented: true,
  });

  const rulesDir = path.resolve(__dirname, "../data/rules-vnext");
  const fullRulePackage = await loadRulePackageFromDirectory(rulesDir);

  const config: OfficialBaselineMeasurementConfig = {
    measurementId: `baseline-${cliArgs.regulationId}-${cliArgs.baseSeed}`,
    workId: "BP-SIM-AI-3.3-20260906-0041",
    environmentRef: `official:${cliArgs.regulationId}`,
    regulationId: cliArgs.regulationId,
    baseSeed: cliArgs.baseSeed,
    setupAuditCount: cliArgs.setupAuditCount,
    matchesPerSeat: cliArgs.matchesPerSeat,
    maxDecisionsPerMatch: cliArgs.maxDecisions,
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
  console.log(`[Setup Audit] Planned: ${result.setupAudit.plannedSetups}, READY: ${result.setupAudit.readySetups}, RULE_UNSPECIFIED: ${result.setupAudit.ruleUnspecifiedSetups}, TERMINAL: ${result.setupAudit.terminalSetups}`);
  if (result.setupAudit.ruleUnspecifiedSetups > 0) {
    console.log(`  - 3.9.2 First Player Exhaustion: ${result.setupAudit.reasonBreakdown.FIRST_PLAYER_DETERMINATION_LIFE_EXHAUSTED}`);
    console.log(`  - 3.9.3 Game Start Draw Exhaustion: ${result.setupAudit.reasonBreakdown.GAME_START_DRAW_LIFE_EXHAUSTED}`);
  }

  console.log("\n[Matchup Results (6 Pairs)]");
  for (const m of result.matchups) {
    console.log(`  ${m.pairId}:`);
    console.log(`    Scheduled: ${m.scheduledMatches}, Completed: ${m.completedMatches}, Incomplete: ${m.incompleteMatches}, Setup Gap: ${m.setupRuleGapMatches}, Tech Failure: ${m.technicalFailedMatches}`);
    console.log(`    Wins: ${m.participantA.name} ${m.aWins} - ${m.bWins} ${m.participantB.name} (Draws: ${m.draws})`);
    console.log(`    Seat Split: P1 Wins: ${m.p1Wins} (${(m.p1WinRate * 100).toFixed(1)}%), P2 Wins: ${m.p2Wins} (${(m.p2WinRate * 100).toFixed(1)}%)`);
  }

  console.log("\n[Feature Diagnostics]");
  console.log(`  Context Coverage: ${result.featureDiagnostics.activationCoverage.context.activatedFeatures}/${result.featureDiagnostics.activationCoverage.context.totalFeatures} (${(result.featureDiagnostics.activationCoverage.context.coverageRate * 100).toFixed(1)}%)`);
  console.log(`  Pattern Coverage: ${result.featureDiagnostics.activationCoverage.pattern.activatedFeatures}/${result.featureDiagnostics.activationCoverage.pattern.totalFeatures} (${(result.featureDiagnostics.activationCoverage.pattern.coverageRate * 100).toFixed(1)}%)`);

  for (const c of result.featureDiagnostics.featureCollisions) {
    console.log(`  Collision [${c.participantId}]: ${c.decisionsWithPatternCollision}/${c.encodedDecisions} decisions (${(c.collisionDecisionRate * 100).toFixed(1)}%), Colliding Patterns: ${c.collidingPatterns}, Max Group: ${c.maxCollisionGroupSize}`);
  }

  console.log("\n[Genome Argmax Ties]");
  for (const t of result.featureDiagnostics.genomeArgmaxTies) {
    console.log(`  Tie [${t.participantId}]: ${t.decisionsWithArgmaxTie}/${t.scoredDecisions} (${(t.argmaxTieRate * 100).toFixed(1)}%), Max Tied Patterns: ${t.maxTopTieCount}`);
  }

  console.log("\n[Counterfactual Agreement]");
  for (const a of result.featureDiagnostics.counterfactualAgreements) {
    console.log(`  Agreement [${a.participantId}]: same-as-FirstLegal: ${(a.sameAsFirstLegalRate * 100).toFixed(1)}%, same-as-Zero: ${(a.sameAsZeroGenomeRate * 100).toFixed(1)}%`);
  }

  console.log("\n[Repeatability Gate]");
  console.log(`  Run A Digest:          ${result.repeatability.runADigest}`);
  console.log(`  Run B Digest:          ${result.repeatability.runBDigest}`);
  console.log(`  Matched:               ${result.repeatability.matched}`);
  console.log(`  Exact Logical Equality:${result.repeatability.exactLogicalEquality}`);
  console.log(`  Diagnostic Errors:     ${result.repeatability.diagnosticErrorCount}`);

  // 保存先パス解決と出力
  const resolvedOut = path.isAbsolute(cliArgs.outFile)
    ? cliArgs.outFile
    : path.resolve(process.cwd(), cliArgs.outFile);

  fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
  fs.writeFileSync(resolvedOut, JSON.stringify(result, null, 2), "utf8");
  console.log(`\n[SUCCESS] Baseline artifact saved to: ${resolvedOut}`);
}

main().catch((err) => {
  console.error("[FATAL ERROR]", err);
  process.exit(1);
});
