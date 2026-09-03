import * as path from "path";
import { loadRulePackageFromDirectory } from "../engine/rules/RuleLoader";
import { getPlaytestRulePackage } from "../engine/rules/RulePackageSelector";
import { GameSession } from "../engine/session/GameSession";
import { createCoreBattlePresetState } from "../engine/session/playtest/createCoreBattlePlaytest";
import { MatchSetupCoordinator } from "../engine/session/setup/MatchSetupCoordinator";
import { SimulationRunner } from "../engine/simulation/SimulationRunner";
import { RandomPolicy } from "../engine/simulation/DecisionPolicy";
import { SeededRandom } from "../engine/random/RandomSource";
import { StateHasher } from "../engine/simulation/StateHasher";

async function main() {
  const seedArg = process.argv[2] ? parseInt(process.argv[2], 10) : 42;
  const seed = isNaN(seedArg) ? 42 : seedArg;

  console.log("================================================================================");
  console.log(`  BLACKPOKER HEADLESS SIMULATION (Seed: ${seed})`);
  console.log("================================================================================");

  const rulesDir = path.resolve(__dirname, "../data/rules-vnext");
  const fullPackage = await loadRulePackageFromDirectory(rulesDir);
  const rulePackage = getPlaytestRulePackage(fullPackage);

  const rawState = createCoreBattlePresetState();
  const setupResult = MatchSetupCoordinator.setupMatch(rawState);
  const session = new GameSession(setupResult.state, rulePackage);

  const rng = new SeededRandom(seed);
  const policies = {
    p1: new RandomPolicy(rng.fork(), "RandomAI-P1"),
    p2: new RandomPolicy(rng.fork(), "RandomAI-P2"),
  };

  const result = SimulationRunner.run(session, policies, {
    maxDecisions: 300,
    onStep: (info) => {
      if (info.stepCount <= 5 || info.stepCount % 20 === 0) {
        console.log(
          `[Decision #${info.stepCount}] Player: ${info.decisionPlayer} | Action: ${info.actionSummary} | Pattern: ${info.record.selectedPatternKind} | Hash: ${info.record.stateHash}`
        );
      }
    },
  });

  console.log("\n--------------------------------------------------------------------------------");
  console.log(`Simulation Result: ${result.completed ? "COMPLETED" : "INCOMPLETE"}`);
  console.log(`Decision Trace Version: ${result.decisionTraceVersion}`);
  console.log(`State Hash Version: ${StateHasher.VERSION}`);
  console.log(`Total Decisions: ${result.totalDecisions}`);
  console.log(`Turn Count: ${result.turnCount}`);
  console.log(`Winner: ${result.winner ?? "None"}`);
  console.log(`Reason: ${result.reason ?? "N/A"}`);
  console.log(`Decision Trace Count: ${result.decisionTrace.length}`);
  console.log(`Final State Hash: ${result.finalStateHash ?? "N/A"}`);
  console.log("================================================================================");

  if (!result.completed && result.totalDecisions >= 300) {
    console.log("Reached max decisions as expected for random play.");
  }
}

main().catch((err) => {
  console.error("Simulation failed:", err);
  process.exit(1);
});
