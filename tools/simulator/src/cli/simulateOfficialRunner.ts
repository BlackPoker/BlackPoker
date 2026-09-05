import * as path from "path";
import { fileURLToPath } from "url";
import { OfficialRegulationMatchFactory } from "../engine/regulation/OfficialRegulationMatchFactory";
import { loadRegulationCatalog } from "../engine/regulation/RegulationLoader";
import { RegulationValidator } from "../engine/regulation/RegulationValidator";
import { loadRulePackageFromDirectory } from "../engine/rules/RuleLoader";
import { SimulationRunner } from "../engine/simulation/SimulationRunner";
import { RandomPolicy } from "../engine/simulation/DecisionPolicy";
import { SeededRandom } from "../engine/random/RandomSource";
import { StateHasher } from "../engine/simulation/StateHasher";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs(args: string[]): { regulationId: string; seed: number; maxDecisions: number } {
  let regulationId = "light-entry16";
  let seed = 42;
  let maxDecisions = 300;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--regulation" || arg === "-r") {
      if (args[i + 1]) {
        regulationId = args[++i];
      }
    } else if (arg === "--seed" || arg === "-s") {
      if (args[i + 1]) {
        const parsed = parseInt(args[++i], 10);
        if (!isNaN(parsed)) seed = parsed;
      }
    } else if (arg === "--maxDecisions" || arg === "-m") {
      if (args[i + 1]) {
        const parsed = parseInt(args[++i], 10);
        if (!isNaN(parsed)) maxDecisions = parsed;
      }
    } else if (!arg.startsWith("-")) {
      const parsed = parseInt(arg, 10);
      if (!isNaN(parsed)) {
        seed = parsed;
      } else {
        regulationId = arg;
      }
    }
  }

  return { regulationId, seed, maxDecisions };
}

async function main() {
  const { regulationId, seed, maxDecisions } = parseArgs(process.argv.slice(2));

  console.log("================================================================================");
  console.log(`  BLACKPOKER OFFICIAL REGULATION SIMULATION`);
  console.log("================================================================================");

  const catalog = await loadRegulationCatalog();
  const validation = RegulationValidator.validateRegulation(catalog, regulationId, {
    assertImplemented: true,
  });

  const reg = validation.regulation!;
  const fmt = validation.format!;
  const frm = validation.frame!;

  console.log(`Regulation:    ${reg.name} (${reg.id})`);
  console.log(`Format:        ${fmt.name} (${fmt.id})`);
  console.log(`Frame:         ${frm.name} (${frm.id})`);
  console.log(`Rules Version: ${reg.sourceRulesVersion}`);
  console.log(`Seed:          ${seed}`);
  console.log("--------------------------------------------------------------------------------");

  const rulesDir = path.resolve(__dirname, "../data/rules-vnext");
  const fullRulePackage = await loadRulePackageFromDirectory(rulesDir);

  const session = await OfficialRegulationMatchFactory.createSession(reg.id, seed, {
    catalog,
    fullRulePackage,
    matchId: `match-official-${seed}`,
  });

  const state = session.state;
  const p1 = state.players?.p1;
  const p2 = state.players?.p2;

  console.log(`Initial Setup Summary:`);
  console.log(`  First Player: ${state.turnPlayer} (${state.turnPlayer === "p1" ? p1?.name : p2?.name})`);
  console.log(`  P1 (${p1?.name}): Hand ${p1?.hand?.length ?? 0}, Life ${p1?.life?.length ?? 0}, Field ${p1?.field?.length ?? 0}, Grave ${p1?.grave?.length ?? 0}`);
  console.log(`  P2 (${p2?.name}): Hand ${p2?.hand?.length ?? 0}, Life ${p2?.life?.length ?? 0}, Field ${p2?.field?.length ?? 0}, Grave ${p2?.grave?.length ?? 0}`);
  console.log("--------------------------------------------------------------------------------");

  const policyRng = new SeededRandom(seed ^ 0x5a5a5a5a);
  const policies = {
    p1: new RandomPolicy(policyRng.fork(), "RandomAI-P1"),
    p2: new RandomPolicy(policyRng.fork(), "RandomAI-P2"),
  };

  const result = SimulationRunner.run(session, policies, {
    maxDecisions,
    onStep: (info) => {
      if (info.stepCount <= 5 || info.stepCount % 20 === 0) {
        console.log(
          `[Decision #${info.stepCount}] Player: ${info.decisionPlayer} | Action: ${info.actionSummary} | Pattern: ${info.record.selectedPatternKind} | Hash: ${info.record.stateHash}`
        );
      }
    },
  });

  console.log("\n--------------------------------------------------------------------------------");
  console.log(`Simulation Status: ${result.completed ? "COMPLETED" : "INCOMPLETE"}`);
  console.log(`Winner:            ${result.winner ?? "None"}`);
  console.log(`Reason:            ${result.reason ?? "N/A"}`);
  console.log(`Total Decisions:   ${result.totalDecisions}`);
  console.log(`Turns:             ${result.turnCount}`);
  console.log(`Decision Trace:    ${result.decisionTrace.length} records (v${result.decisionTraceVersion})`);
  console.log(`Final State Hash:  ${result.finalStateHash ?? "N/A"} (v${StateHasher.VERSION})`);
  console.log("================================================================================");
}

main().catch((err) => {
  console.error("[Fatal Error]:", err);
  process.exit(1);
});
