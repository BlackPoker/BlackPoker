import * as path from "path";
import { fileURLToPath } from "url";
import { loadRulePackageFromDirectory } from "../engine/rules/RuleLoader";
import { getPlaytestRulePackage } from "../engine/rules/RulePackageSelector";
import { GameSession } from "../engine/session/GameSession";
import { createCoreBattlePresetState } from "../engine/session/playtest/createCoreBattlePlaytest";
import { MatchSetupCoordinator } from "../engine/session/setup/MatchSetupCoordinator";
import { BatchSimulationRunner } from "../engine/simulation/BatchSimulationRunner";
import { RandomPolicy } from "../engine/simulation/DecisionPolicy";
import { SeededRandom } from "../engine/random/RandomSource";
import { StateHasher } from "../engine/simulation/StateHasher";
import { RuntimeArtifactWriter } from "./support/RuntimeArtifactWriter";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const args = process.argv.slice(2);
  let quiet = false;
  let saveArtifacts = true;
  const positionalArgs: string[] = [];

  for (const arg of args) {
    if (arg === "--quiet") {
      quiet = true;
    } else if (arg === "--no-artifacts") {
      saveArtifacts = false;
    } else if (arg.startsWith("-")) {
      console.warn(`[Warning] 未知のオプションです: "${arg}" (無視されます)`);
    } else {
      positionalArgs.push(arg);
    }
  }

  let matchCount = 20;
  if (positionalArgs[0] !== undefined) {
    const parsed = Number(positionalArgs[0]);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
      console.error(`[Error] 不正な matchCount 引数が指定されました: "${positionalArgs[0]}" (1以上の整数を指定してください)`);
      process.exit(1);
    }
    matchCount = parsed;
  }

  let baseSeed = 42;
  if (positionalArgs[1] !== undefined) {
    const parsed = Number(positionalArgs[1]);
    if (!Number.isFinite(parsed)) {
      console.error(`[Error] 不正な baseSeed 引数が指定されました: "${positionalArgs[1]}" (有限の数値を指定してください)`);
      process.exit(1);
    }
    baseSeed = parsed;
  }

  if (!quiet) {
    console.log("================================================================================");
    console.log(`  BLACKPOKER BATCH SIMULATION (BaseSeed: ${baseSeed}, Matches: ${matchCount})`);
    console.log("================================================================================");
  }

  const rulesDir = path.resolve(__dirname, "../data/rules-vnext");
  const fullPackage = await loadRulePackageFromDirectory(rulesDir);
  const rulePackage = getPlaytestRulePackage(fullPackage);

  const startedAt = new Date().toISOString();

  const result = BatchSimulationRunner.run({
    matchCount,
    baseSeed,
    maxDecisionsPerMatch: 500,
    sessionFactory: (_ctx) => {
      const rawState = createCoreBattlePresetState();
      const setupResult = MatchSetupCoordinator.setupMatch(rawState);
      return new GameSession(setupResult.state, rulePackage);
    },
    policyFactory: (ctx) => {
      return {
        p1: new RandomPolicy(new SeededRandom(ctx.playerSeeds.p1), "RandomAI-P1"),
        p2: new RandomPolicy(new SeededRandom(ctx.playerSeeds.p2), "RandomAI-P2"),
      };
    },
    onMatchCompleted: (match, progress, metrics) => {
      if (quiet) {
        return;
      }
      if (
        progress.completedCount <= 5 ||
        progress.completedCount % 5 === 0 ||
        progress.completedCount === progress.totalCount
      ) {
        const statusLabel = match.status.padEnd(10, " ");
        const winnerLabel = (match.winner ?? "None").padEnd(6, " ");
        const turnsLabel = `Turns: ${String(match.turnCount).padStart(2, " ")}`;
        const decisionsLabel = `Decisions: ${String(match.totalDecisions).padStart(3, " ")}`;
        const hashLabel = match.finalStateHash ? match.finalStateHash.slice(0, 16) : "N/A";
        const elapsedLabel = metrics
          ? `Elapsed: ${metrics.matchTotalElapsedMs.toFixed(2)} ms`
          : "N/A";
        console.log(
          `[Match ${String(progress.completedCount).padStart(3, " ")}/${progress.totalCount}] ${match.matchId} | ${statusLabel} | Winner: ${winnerLabel} | ${turnsLabel} | ${decisionsLabel} | Hash: ${hashLabel} | ${elapsedLabel}`
        );
      }
    },
  });

  const finishedAt = new Date().toISOString();

  console.log("\n--------------------------------------------------------------------------------");
  console.log("  BATCH SIMULATION SUMMARY (Logical Results)");
  console.log("--------------------------------------------------------------------------------");
  console.log(`Batch Result Version: ${result.batchResultVersion}`);
  console.log(`State Hash Version:   ${StateHasher.VERSION}`);
  console.log(`Base Seed:            ${result.baseSeed}`);
  console.log(`Total Matches:        ${result.summary.totalMatches}`);
  console.log(`Completed Matches:    ${result.summary.completedCount}`);
  console.log(`Incomplete Matches:   ${result.summary.incompleteCount}`);
  console.log(`Failed Matches:       ${result.summary.failedCount}`);
  console.log(`Wins by Player:       ${JSON.stringify(result.summary.winsByPlayer)}`);
  console.log(`Draws:                ${result.summary.drawCount}`);
  console.log(`Win Rates:            ${JSON.stringify(result.summary.winRates)}`);
  console.log(`Avg Decisions/Match:  ${result.summary.averageDecisionsPerCompletedMatch}`);
  console.log(`Avg Turns/Match:      ${result.summary.averageTurnsPerCompletedMatch}`);

  const rm = result.runtimeMetrics;
  console.log("\n--------------------------------------------------------------------------------");
  console.log("  RUNTIME TELEMETRY & PERFORMANCE METRICS");
  console.log("--------------------------------------------------------------------------------");
  console.log(`Telemetry Version:     ${rm?.runtimeTelemetryVersion ?? "N/A"}`);
  console.log(`Executed Matches:      ${rm?.executedMatchCount ?? result.matches.length}`);
  console.log(`Concurrency:           ${rm?.concurrency ?? 1}`);
  console.log(`Batch Wall-Clock Time: ${rm ? rm.batchWallClockElapsedMs.toFixed(2) : "N/A"} ms`);
  console.log(`Aggregate Match Lat:   ${rm ? rm.sumMatchTotalElapsedMs.toFixed(2) : "N/A"} ms (Sum of Per-Match Wall-Clock Latencies)`);
  console.log(`Throughput:            ${rm ? rm.matchesPerSecond.toFixed(2) : "N/A"} matches/sec`);
  console.log(`Mean Latency / Match:  ${rm ? rm.meanMatchTotalElapsedMs.toFixed(2) : "N/A"} ms`);
  console.log(`Median Latency / Match:${rm ? rm.medianMatchTotalElapsedMs.toFixed(2) : "N/A"} ms`);
  console.log(`P95 Latency / Match:   ${rm ? rm.p95MatchTotalElapsedMs.toFixed(2) : "N/A"} ms (Nearest-Rank Method)`);
  console.log(`Min / Max Latency:     ${rm ? `${rm.minMatchTotalElapsedMs.toFixed(2)} ms / ${rm.maxMatchTotalElapsedMs.toFixed(2)} ms` : "N/A"}`);
  console.log(`Total Decisions:       ${rm?.totalDecisionCount ?? "N/A"}`);
  console.log(`Mean Time / Decision:  ${rm ? rm.meanMsPerDecision.toFixed(4) : "N/A"} ms`);

  if (saveArtifacts) {
    const artifactRes = RuntimeArtifactWriter.write(result, {
      startedAt,
      finishedAt,
    });
    console.log("\n--------------------------------------------------------------------------------");
    console.log("  RUNTIME ARTIFACT PERSISTENCE");
    console.log("--------------------------------------------------------------------------------");
    console.log(`Artifact Root:  ${artifactRes.runDir}`);
    console.log(`Run ID:         ${artifactRes.runId}`);
    console.log(`Summary JSON:   ${artifactRes.summaryPath}`);
    console.log(`Matches JSONL:  ${artifactRes.matchesPath}`);
    console.log(`Timing JSONL:   ${artifactRes.timingPath}`);
    console.log(`Errors JSONL:   ${artifactRes.errorsPath}`);
  } else {
    console.log("\n[INFO] Artifact persistence is disabled (--no-artifacts specified).");
  }
  console.log("================================================================================");

  if (result.failures.length > 0) {
    console.error(`\n[WARNING] ${result.failures.length} match(es) failed with exceptions:`);
    for (const f of result.failures) {
      console.error(
        `  - Match #${f.matchIndex} (${f.matchId}) in phase ${f.phase}: ${f.errorName}: ${f.errorMessage}`
      );
    }
  }
}

main().catch((err) => {
  console.error("Batch simulation CLI failed:", err);
  process.exit(1);
});
