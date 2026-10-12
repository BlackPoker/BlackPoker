import * as path from "path";
import { fileURLToPath } from "url";
import { loadRegulationCatalog } from "../engine/regulation/RegulationLoader";
import { loadRulePackageFromDirectory } from "../engine/rules/RuleLoader";
import { OfficialRegulationMatchSetup } from "../engine/regulation/OfficialRegulationMatchSetup";
import { GameSession } from "../engine/session/GameSession";
import { GenomeSensitivityEvaluator } from "../engine/ai/GenomeSensitivityEvaluator";
import { GenomeSensitivityDNAFactory } from "../engine/ai/GenomeSensitivityDNAFactory";
import { DecisionRequest } from "../domain/decision/DecisionRequest";
import { BatchMatchContext } from "../domain/simulation/BatchSimulationTypes";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface CliArgs {
  matchesPerSeat: number;
  baseSeed: number;
  maxDecisions: number;
  regulationId: string;
}

function parseArgs(args: string[]): CliArgs {
  let matchesPerSeat = 2;
  let baseSeed = 42;
  let maxDecisions = 500;
  let regulationId = "standard-pack";

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
    } else if (arg === "--regulation" && args[i + 1] !== undefined) {
      regulationId = args[++i];
    }
  }

  return { matchesPerSeat, baseSeed, maxDecisions, regulationId };
}

async function main() {
  const cliArgs = parseArgs(process.argv.slice(2));

  console.log("================================================================================");
  console.log("  BLACKPOKER GENOME SENSITIVITY & POLICY SEPARABILITY EVALUATION");
  console.log("================================================================================");
  console.log(`Environment:       official:${cliArgs.regulationId}`);
  console.log(`Base Seed:         ${cliArgs.baseSeed}`);
  console.log(`Matches Per Seat:  ${cliArgs.matchesPerSeat} (Total: ${cliArgs.matchesPerSeat * 2} with Seat Swap)`);
  console.log(`Max Decisions:     ${cliArgs.maxDecisions}`);
  console.log("--------------------------------------------------------------------------------\n");

  // 1. 公式レギュレーション & ルールパッケージのロード
  const catalog = await loadRegulationCatalog();
  const rulesDir = path.resolve(__dirname, "../data/rules-vnext");
  const rulePackage = await loadRulePackageFromDirectory(rulesDir);

  const reg = catalog.regulations.get(cliArgs.regulationId);
  if (!reg) {
    throw new Error(`Regulation '${cliArgs.regulationId}' が見つかりません。`);
  }
  const frame = catalog.frames.get(reg.frameId);
  if (!frame) {
    throw new Error(`Frame '${reg.frameId}' が見つかりません。`);
  }

  // 2. セッションファクトリ (各試合固有の context.matchSeed を伝搬)
  const sessionFactory = (context: BatchMatchContext) => {
    const outcome = OfficialRegulationMatchSetup.setupMatch(reg, frame, rulePackage, context.matchSeed, {
      playerNames: { p1: "Active Biased AI", p2: "Pass Biased AI" },
    });
    if (outcome.type !== "READY") {
      throw new Error(`セットアップ失敗: ${outcome.reason}`);
    }
    const session = new GameSession(outcome.state, rulePackage, { matchSeed: context.matchSeed });
    return session;
  };

  // サンプル意思決定リクエストの抽出 (Decision-level 比較用: baseSeed を使用)
  let sampleRequest: DecisionRequest | undefined;
  {
    const sampleOutcome = OfficialRegulationMatchSetup.setupMatch(reg, frame, rulePackage, cliArgs.baseSeed, {
      playerNames: { p1: "Active Biased AI", p2: "Pass Biased AI" },
    });
    if (sampleOutcome.type === "READY") {
      const sampleSession = new GameSession(sampleOutcome.state, rulePackage, { matchSeed: cliArgs.baseSeed });
      const step = sampleSession.advance();
      if (step.type === "WAITING_FOR_DECISION") {
        sampleRequest = step.request;
      }
    }
  }

  // 3. Contrast DNA の準備 (汎用特徴量のみ使用)
  const dnaActive = GenomeSensitivityDNAFactory.createActiveBiasedDNA();
  const dnaPass = GenomeSensitivityDNAFactory.createPassBiasedDNA();

  console.log(`Participant A:     ${dnaActive.metadata?.id} (${dnaActive.metadata?.name})`);
  console.log(`Participant B:     ${dnaPass.metadata?.id} (${dnaPass.metadata?.name})`);
  console.log("--------------------------------------------------------------------------------\n");

  // 4. 総合評価の実行 (Decision-level + Match-level + Determinism)
  const result = GenomeSensitivityEvaluator.runFullSensitivityEvaluation({
    experimentId: `genome-sensitivity-cli-${cliArgs.baseSeed}`,
    environmentRef: `official:${cliArgs.regulationId}`,
    baseSeed: cliArgs.baseSeed,
    matchesPerSeat: cliArgs.matchesPerSeat,
    maxDecisionsPerMatch: cliArgs.maxDecisions,
    dnaA: dnaActive,
    dnaB: dnaPass,
    sessionFactory,
    sampleRequest,
  });

  const lr = result.logicalResult;

  // 5. Decision-level 結果の表示
  console.log("--- [1] Decision-Level Sensitivity ---");
  if (lr.decisionComparison) {
    const dc = lr.decisionComparison;
    console.log(`Legal Patterns:    ${dc.patterns.length}`);
    console.log(`DNA A Selection:   patternRef ${dc.selectedPatternRefA} (${dc.selectedLogicalPatternKeyA ?? "N/A"})`);
    console.log(`DNA B Selection:   patternRef ${dc.selectedPatternRefB} (${dc.selectedLogicalPatternKeyB ?? "N/A"})`);
    console.log(`Selection Status:  ${dc.selectionSeparated ? "SEPARATED (Different Pattern Chosen)" : "IDENTICAL"}`);
    console.log(`Differing Scores:  ${dc.differingScoreCount} / ${dc.patterns.length} patterns`);
    console.log(`Max Absolute Delta: ${dc.maxAbsoluteScoreDelta.toFixed(4)}`);
    console.log(`Mean Absolute Delta: ${dc.meanAbsoluteScoreDelta.toFixed(4)}`);
  } else {
    console.log("Decision comparison: N/A");
  }
  console.log("");

  // 6. Match Behavior & Outcome 結果の表示
  console.log("--- [2] Match-Level Generic Behavior & Outcomes ---");
  const mb = lr.matchBehaviorSummary;
  console.log(`Participant A (${mb.participantAId}):`);
  console.log(`  Decisions:       ${mb.metricsA.totalObservedDecisions}`);
  console.log(`  Action Rate:     ${(mb.metricsA.actionSelectionRate * 100).toFixed(1)}% (${mb.metricsA.actionSelections})`);
  console.log(`  Pass Rate:       ${(mb.metricsA.passSelectionRate * 100).toFixed(1)}% (${mb.metricsA.passSelections})`);
  console.log(`  Effect Rate:     ${(mb.metricsA.effectSelectionRate * 100).toFixed(1)}% (${mb.metricsA.effectSelections})`);
  console.log(`  Other Rate:      ${(mb.metricsA.otherSelectionRate * 100).toFixed(1)}% (${mb.metricsA.otherSelections})`);

  console.log(`Participant B (${mb.participantBId}):`);
  console.log(`  Decisions:       ${mb.metricsB.totalObservedDecisions}`);
  console.log(`  Action Rate:     ${(mb.metricsB.actionSelectionRate * 100).toFixed(1)}% (${mb.metricsB.actionSelections})`);
  console.log(`  Pass Rate:       ${(mb.metricsB.passSelectionRate * 100).toFixed(1)}% (${mb.metricsB.passSelections})`);
  console.log(`  Effect Rate:     ${(mb.metricsB.effectSelectionRate * 100).toFixed(1)}% (${mb.metricsB.effectSelections})`);
  console.log(`  Other Rate:      ${(mb.metricsB.otherSelectionRate * 100).toFixed(1)}% (${mb.metricsB.otherSelections})`);

  console.log(`Rate Deltas (B - A):`);
  console.log(`  Action Delta:    ${(mb.actionRateDelta * 100).toFixed(1)}%`);
  console.log(`  Pass Delta:      ${(mb.passRateDelta * 100).toFixed(1)}%`);
  console.log(`  Behavior Status: ${mb.behaviorSeparated ? "SEPARATED (Behavior Difference Observed)" : "IDENTICAL"}`);
  console.log("");

  console.log(`Match Outcomes (Scheduled: ${lr.experimentSummary.totalScheduledMatches}, Completed: ${lr.experimentSummary.totalCompletedMatches}, Incomplete: ${lr.experimentSummary.totalIncompleteMatches}, Failed: ${lr.experimentSummary.totalFailedMatches}):`);
  console.log(`  Participant A (${lr.outcomeA.participantId}):`);
  console.log(`    Scheduled:     ${lr.outcomeA.scheduledMatches}`);
  console.log(`    Completed:     ${lr.outcomeA.completedMatches}`);
  console.log(`    Wins:          ${lr.outcomeA.wins}`);
  console.log(`    Losses:        ${lr.outcomeA.losses}`);
  console.log(`    Draws:         ${lr.outcomeA.draws}`);
  console.log(`    Incomplete:    ${lr.outcomeA.incompleteMatches}`);
  console.log(`    Failed:        ${lr.outcomeA.failedMatches}`);
  console.log(`    Win Rate:      ${lr.outcomeA.completedMatches > 0 ? (lr.outcomeA.winRateOnCompleted * 100).toFixed(1) + "%" : "N/A (No completed matches)"}`);

  console.log(`  Participant B (${lr.outcomeB.participantId}):`);
  console.log(`    Scheduled:     ${lr.outcomeB.scheduledMatches}`);
  console.log(`    Completed:     ${lr.outcomeB.completedMatches}`);
  console.log(`    Wins:          ${lr.outcomeB.wins}`);
  console.log(`    Losses:        ${lr.outcomeB.losses}`);
  console.log(`    Draws:         ${lr.outcomeB.draws}`);
  console.log(`    Incomplete:    ${lr.outcomeB.incompleteMatches}`);
  console.log(`    Failed:        ${lr.outcomeB.failedMatches}`);
  console.log(`    Win Rate:      ${lr.outcomeB.completedMatches > 0 ? (lr.outcomeB.winRateOnCompleted * 100).toFixed(1) + "%" : "N/A (No completed matches)"}`);
  console.log("");

  // 7. Determinism & Overall Status
  console.log("--- [3] Verification Summary ---");
  console.log(`Decision Level:    ${lr.decisionSeparated ? "SEPARATED" : "NOT_SEPARATED"}`);
  console.log(`Match Behavior:    ${lr.matchBehaviorSeparated ? "SEPARATED" : "NOT_SEPARATED"}`);
  console.log(`Determinism:       ${lr.deterministic ? "PASS (100% Identical on Repeat)" : "FAIL"}`);
  console.log(`Failed Matches:    ${lr.experimentSummary.totalFailedMatches}`);
  console.log(`Execution Time:    ${result.runtimeMetrics.executionDurationMs} ms`);
  console.log("--------------------------------------------------------------------------------");
  console.log(`OVERALL STATUS:    ${lr.overallStatus}`);
  console.log("================================================================================\n");

  if (lr.overallStatus !== "POLICY_SEPARABLE") {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("FATAL ERROR in Genome Sensitivity Runner:", err);
  process.exit(1);
});
