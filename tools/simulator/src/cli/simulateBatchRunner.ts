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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const matchCountArg = process.argv[2] ? parseInt(process.argv[2], 10) : 20;
  const matchCount = isNaN(matchCountArg) || matchCountArg <= 0 ? 20 : matchCountArg;

  const baseSeedArg = process.argv[3] ? parseInt(process.argv[3], 10) : 42;
  const baseSeed = isNaN(baseSeedArg) ? 42 : baseSeedArg;

  console.log("================================================================================");
  console.log(`  BLACKPOKER BATCH SIMULATION (BaseSeed: ${baseSeed}, Matches: ${matchCount})`);
  console.log("================================================================================");

  const rulesDir = path.resolve(__dirname, "../data/rules-vnext");
  const fullPackage = await loadRulePackageFromDirectory(rulesDir);
  const rulePackage = getPlaytestRulePackage(fullPackage);

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
    onMatchCompleted: (match, progress) => {
      if (progress.completedCount <= 5 || progress.completedCount % 5 === 0 || progress.completedCount === progress.totalCount) {
        const statusLabel = match.status.padEnd(10, " ");
        const winnerLabel = (match.winner ?? "None").padEnd(6, " ");
        const turnsLabel = `Turns: ${String(match.turnCount).padStart(2, " ")}`;
        const decisionsLabel = `Decisions: ${String(match.totalDecisions).padStart(3, " ")}`;
        const hashLabel = match.finalStateHash ? match.finalStateHash.slice(0, 16) : "N/A";
        console.log(
          `[Match ${String(progress.completedCount).padStart(3, " ")}/${progress.totalCount}] ${match.matchId} | ${statusLabel} | Winner: ${winnerLabel} | ${turnsLabel} | ${decisionsLabel} | Hash: ${hashLabel}`
        );
      }
    },
  });

  console.log("\n--------------------------------------------------------------------------------");
  console.log("  BATCH SIMULATION SUMMARY");
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
  console.log(`Total Execution Time: ${result.summary.totalExecutionTimeMs} ms`);
  console.log("================================================================================");

  if (result.failures.length > 0) {
    console.error(`\n[WARNING] ${result.failures.length} match(es) failed with exceptions:`);
    for (const f of result.failures) {
      console.error(`  - Match #${f.matchIndex} (${f.matchId}) in phase ${f.phase}: ${f.errorName}: ${f.errorMessage}`);
    }
  }
}

main().catch((err) => {
  console.error("Batch simulation CLI failed:", err);
  process.exit(1);
});
