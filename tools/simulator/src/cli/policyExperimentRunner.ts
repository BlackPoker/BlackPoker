import * as path from "path";
import { fileURLToPath } from "url";
import { loadRulePackageFromDirectory } from "../engine/rules/RuleLoader";
import { getPlaytestRulePackage } from "../engine/rules/RulePackageSelector";
import { GameSession } from "../engine/session/GameSession";
import { createCoreBattlePresetState } from "../engine/session/playtest/createCoreBattlePlaytest";
import { MatchSetupCoordinator } from "../engine/session/setup/MatchSetupCoordinator";
import { PolicyExperimentRunner } from "../engine/ai/PolicyExperimentRunner";
import { BaselineParticipants } from "../engine/ai/BaselinePolicies";
import { PolicyExperimentParticipant } from "../domain/ai/PolicyExperimentTypes";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface CliArgs {
  matchesPerSeat: number;
  baseSeed: number;
  maxDecisions: number;
  matchup: string;
}

function parseArgs(args: string[]): CliArgs {
  let matchesPerSeat = 10;
  let baseSeed = 42;
  let maxDecisions = 500;
  let matchup = "all";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--matches-per-seat" && args[i + 1] !== undefined) {
      const parsed = Number(args[++i]);
      if (Number.isFinite(parsed) && Number.isInteger(parsed) && parsed >= 1) {
        matchesPerSeat = parsed;
      }
    } else if (arg === "--base-seed" && args[i + 1] !== undefined) {
      const parsed = Number(args[++i]);
      if (Number.isFinite(parsed)) {
        baseSeed = parsed;
      }
    } else if (arg === "--max-decisions" && args[i + 1] !== undefined) {
      const parsed = Number(args[++i]);
      if (Number.isFinite(parsed) && Number.isInteger(parsed) && parsed >= 1) {
        maxDecisions = parsed;
      }
    } else if (arg === "--matchup" && args[i + 1] !== undefined) {
      matchup = args[++i];
    }
  }

  return { matchesPerSeat, baseSeed, maxDecisions, matchup };
}

async function main() {
  const cliArgs = parseArgs(process.argv.slice(2));

  console.log("================================================================================");
  console.log("  BLACKPOKER POLICY EXPERIMENT & BASELINE EVALUATION HARNESS");
  console.log("================================================================================");
  console.log(`Base Seed:         ${cliArgs.baseSeed}`);
  console.log(`Matches Per Seat:  ${cliArgs.matchesPerSeat} (Total: ${cliArgs.matchesPerSeat * 2} per pair)`);
  console.log(`Max Decisions:     ${cliArgs.maxDecisions}`);
  console.log(`Matchup Filter:    ${cliArgs.matchup}`);
  console.log("--------------------------------------------------------------------------------\n");

  const rulesDir = path.resolve(__dirname, "../data/rules-vnext");
  const fullPackage = await loadRulePackageFromDirectory(rulesDir);
  const rulePackage = getPlaytestRulePackage(fullPackage);

  const sessionFactory = () => {
    const rawState = createCoreBattlePresetState();
    const setupResult = MatchSetupCoordinator.setupMatch(rawState);
    return new GameSession(setupResult.state, rulePackage);
  };

  const firstLegal = BaselineParticipants.createFirstLegal();
  const randomAI = BaselineParticipants.createRandom();
  const zeroGenome = BaselineParticipants.createZeroGenome();
  const manualGenome = BaselineParticipants.createManualGenericGenome();

  const pairs: Array<{
    id: string;
    pA: PolicyExperimentParticipant;
    pB: PolicyExperimentParticipant;
  }> = [
    {
      id: "manual-genome-vs-random",
      pA: manualGenome,
      pB: randomAI,
    },
    {
      id: "zero-genome-vs-random",
      pA: zeroGenome,
      pB: randomAI,
    },
    {
      id: "firstlegal-vs-random",
      pA: firstLegal,
      pB: randomAI,
    },
    {
      id: "manual-genome-vs-firstlegal",
      pA: manualGenome,
      pB: firstLegal,
    },
  ];

  const filteredPairs =
    cliArgs.matchup === "all"
      ? pairs
      : pairs.filter((p) => p.id === cliArgs.matchup || p.id.includes(cliArgs.matchup));

  if (filteredPairs.length === 0) {
    console.warn(`[WARNING] 指定された matchup "${cliArgs.matchup}" に一致する実験が見つかりません。`);
    console.log(`利用可能な matchups: ${pairs.map((p) => p.id).join(", ")}`);
    return;
  }

  for (const pair of filteredPairs) {
    console.log(`\n================================================================================`);
    console.log(`  EXPERIMENT: ${pair.id}`);
    console.log(`  Participant A: ${pair.pA.id} (${pair.pA.name})`);
    console.log(`  Participant B: ${pair.pB.id} (${pair.pB.name})`);
    console.log(`================================================================================`);

    const result = PolicyExperimentRunner.run({
      experimentId: pair.id,
      environmentRef: "rules-vnext:playtest:core-battle",
      baseSeed: cliArgs.baseSeed,
      matchesPerSeat: cliArgs.matchesPerSeat,
      maxDecisionsPerMatch: cliArgs.maxDecisions,
      participantA: pair.pA,
      participantB: pair.pB,
      sessionFactory,
    });

    const sumA = result.summary.participants[pair.pA.id];
    const sumB = result.summary.participants[pair.pB.id];
    const behA = result.behavior[pair.pA.id];
    const behB = result.behavior[pair.pB.id];

    console.log("\n[Outcome Summary]");
    console.log(`  Total Scheduled: ${result.summary.totalScheduledMatches}`);
    console.log(`  Total Completed: ${result.summary.totalCompletedMatches}`);
    console.log(`  Total Incomplete: ${result.summary.totalIncompleteMatches}`);
    console.log(`  Total Failed:     ${result.summary.totalFailedMatches}`);

    console.log(`\n  Participant A (${pair.pA.name}):`);
    console.log(`    Wins: ${sumA.wins} | Losses: ${sumA.losses} | Draws: ${sumA.draws}`);
    console.log(`    WinRate (Completed): ${(sumA.winRateOnCompleted * 100).toFixed(1)}%`);
    console.log(
      `    as P1: Wins: ${sumA.asP1.wins}/${sumA.asP1.completedMatches} (${(sumA.asP1.winRateOnCompleted * 100).toFixed(1)}%) | Incomplete: ${sumA.asP1.incompleteMatches} | Failed: ${sumA.asP1.failedMatches}`
    );
    console.log(
      `    as P2: Wins: ${sumA.asP2.wins}/${sumA.asP2.completedMatches} (${(sumA.asP2.winRateOnCompleted * 100).toFixed(1)}%) | Incomplete: ${sumA.asP2.incompleteMatches} | Failed: ${sumA.asP2.failedMatches}`
    );

    console.log(`\n  Participant B (${pair.pB.name}):`);
    console.log(`    Wins: ${sumB.wins} | Losses: ${sumB.losses} | Draws: ${sumB.draws}`);
    console.log(`    WinRate (Completed): ${(sumB.winRateOnCompleted * 100).toFixed(1)}%`);
    console.log(
      `    as P1: Wins: ${sumB.asP1.wins}/${sumB.asP1.completedMatches} (${(sumB.asP1.winRateOnCompleted * 100).toFixed(1)}%) | Incomplete: ${sumB.asP1.incompleteMatches} | Failed: ${sumB.asP1.failedMatches}`
    );
    console.log(
      `    as P2: Wins: ${sumB.asP2.wins}/${sumB.asP2.completedMatches} (${(sumB.asP2.winRateOnCompleted * 100).toFixed(1)}%) | Incomplete: ${sumB.asP2.incompleteMatches} | Failed: ${sumB.asP2.failedMatches}`
    );

    console.log("\n[Behavior Summary]");
    console.log(`  Participant A (${pair.pA.name}):`);
    console.log(`    Total Observed Decisions: ${behA.totalObservedDecisions}`);
    console.log(
      `    Actions: ${behA.actionSelections} (${(behA.actionSelectionRate * 100).toFixed(1)}%) | Pass: ${behA.passSelections} (${(behA.passSelectionRate * 100).toFixed(1)}%) | Effect: ${behA.effectSelections} (${(behA.effectSelectionRate * 100).toFixed(1)}%)`
    );
    console.log(
      `    Source: ActionReq: ${behA.actionRequestDecisions} | EffectRes: ${behA.effectResolutionDecisions}`
    );

    console.log(`  Participant B (${pair.pB.name}):`);
    console.log(`    Total Observed Decisions: ${behB.totalObservedDecisions}`);
    console.log(
      `    Actions: ${behB.actionSelections} (${(behB.actionSelectionRate * 100).toFixed(1)}%) | Pass: ${behB.passSelections} (${(behB.passSelectionRate * 100).toFixed(1)}%) | Effect: ${behB.effectSelections} (${(behB.effectSelectionRate * 100).toFixed(1)}%)`
    );
    console.log(
      `    Source: ActionReq: ${behB.actionRequestDecisions} | EffectRes: ${behB.effectResolutionDecisions}`
    );

    console.log(`\n  Runtime: ${result.runtimeMetrics?.totalExecutionTimeMs ?? 0} ms`);
  }

  console.log("\n================================================================================");
  console.log("  ALL POLICY EXPERIMENTS COMPLETED");
  console.log("================================================================================");
}

main().catch((err) => {
  console.error("Experiment failed with unhandled error:", err);
  process.exit(1);
});
