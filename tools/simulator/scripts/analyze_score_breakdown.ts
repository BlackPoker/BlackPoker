/**
 * analyze_score_breakdown.ts
 *
 * 正本対戦ログにおける AI (Gen 8 Candidate) の重要局面のスコア詳細内訳を
 * GenomeScorer.explainScore を用いて特徴量レベルで分解・出力する。
 */

import * as fs from "fs";
import * as path from "path";
import { loadRulePackageFromDirectory } from "../src/engine/rules/RuleLoader.js";
import { loadRegulationCatalog } from "../src/engine/regulation/RegulationLoader.js";
import { createReplayPlanFromDiagnosticBundleV1 } from "../src/ui/playtest/DiagnosticReplayAdapter.js";
import { reconstructMatch } from "../src/engine/replay/ReplayReconstructionService.js";
import { createGen8ChampionCandidatePolicy } from "../src/engine/ai/Gen8DNALoader.js";
import { DecisionFeatureEncoder } from "../src/engine/ai/DecisionFeatureEncoder.js";
import { GenomeScorer } from "../src/engine/ai/GenomeScorer.js";

async function main() {
  const targetFile = path.resolve(
    process.cwd(),
    ".artifacts/blackpoker-diagnostic-v1-_________________-seed4127992094-2026-11-07T13-56-23-633Z.json"
  );
  if (!fs.existsSync(targetFile)) {
    console.error("Diagnostic file not found:", targetFile);
    process.exit(1);
  }

  const bundle = JSON.parse(fs.readFileSync(targetFile, "utf-8"));
  const planResult = createReplayPlanFromDiagnosticBundleV1(bundle, {
    currentBuildSha: bundle.build?.sha,
  });
  if (planResult.type === "INCOMPATIBLE") {
    console.error("Incompatible bundle:", planResult);
    process.exit(1);
  }

  const rulesDir = path.resolve("src/data/rules-vnext");
  const regulationsDir = path.resolve("src/data/regulations");
  const fullRulePackage = await loadRulePackageFromDirectory(rulesDir);
  const catalog = await loadRegulationCatalog(regulationsDir);

  const recon = reconstructMatch({
    environmentId: planResult.plan.environmentId,
    seed: planResult.plan.seed,
    rareCardSelections: planResult.plan.rareCardSelections,
    scenarioHandSelections: planResult.plan.scenarioHandSelections,
    transcript: planResult.plan.decisions,
    decisionCount: planResult.plan.decisions.length,
    trailingNormalization: "EXTERNAL_DECISION_BOUNDARY",
    catalog,
    fullRulePackage,
    expectedRulePackage: planResult.plan.sourceRulePackage,
  });

  const aiPolicy = createGen8ChampionCandidatePolicy();
  const dna = (aiPolicy as any).dna;

  console.log("================================================================================");
  console.log(" BlackPoker — Gen 8 特徴量スコア詳細分解レポート (Work 5-1)");
  console.log("================================================================================");

  for (let i = 0; i < recon.replayedDecisions.length; i++) {
    const rd = recon.replayedDecisions[i];
    const req = rd.request;
    const entry = rd.entry;

    // 1. Turn 2: Seq 20 (最初の死の槍対応)
    if (entry.seq === 20) {
      console.log("\n================================================================================");
      console.log(`[ANALYSIS 1] Turn 2 死の槍への対応 (Seq: 20, Step: ${i}, 合法手: ${req.patterns.length})`);
      console.log("================================================================================");
      const features = DecisionFeatureEncoder.encode(req);
      const explanations = GenomeScorer.explainScore(features, dna);

      // PASS (#68)
      const passExp = explanations.find(e => e.patternRef === 68);
      printExplanation("PASS (Pattern #68)", passExp);

      // Counter (#0)
      const counterExp = explanations.find(e => e.patternRef === 0);
      printExplanation("Counter (Pattern #0: ♣8 + Joker)", counterExp);

      // 差分比較
      if (passExp && counterExp) {
        console.log("\n--- [PASS vs Counter 差分要因] ---");
        console.log(`Total Score 差: PASS(${passExp.totalScore.toFixed(4)}) - Counter(${counterExp.totalScore.toFixed(4)}) = +${(passExp.totalScore - counterExp.totalScore).toFixed(4)} (PASS優位)`);
        console.log(`Linear Score 差: PASS(${passExp.linearScore.toFixed(4)}) - Counter(${counterExp.linearScore.toFixed(4)}) = ${(passExp.linearScore - counterExp.linearScore).toFixed(4)}`);
        console.log(`Interaction Score 差: PASS(${passExp.interactionScore.toFixed(4)}) - Counter(${counterExp.interactionScore.toFixed(4)}) = ${(passExp.interactionScore - counterExp.interactionScore).toFixed(4)}`);
      }
    }

    // 2. Turn 3: Seq 32 (攻撃判断)
    if (entry.seq === 32) {
      console.log("\n================================================================================");
      console.log(`[ANALYSIS 2] Turn 3 攻撃判断 (Seq: 32, Step: ${i}, 合法手: ${req.patterns.length})`);
      console.log("================================================================================");
      const features = DecisionFeatureEncoder.encode(req);
      const explanations = GenomeScorer.explainScore(features, dna);

      // Attack (#0)
      const attackExp = explanations.find(e => e.patternRef === 0);
      printExplanation("Attack (Pattern #0: action.attack)", attackExp);

      // Summon Soldier (#85: ♣8)
      const summonExp = explanations.find(e => e.patternRef === 85);
      printExplanation("Summon Soldier (Pattern #85: ♣8)", summonExp);

      // 差分比較
      if (attackExp && summonExp) {
        console.log("\n--- [Attack vs Summon Soldier 差分要因] ---");
        console.log(`Total Score 差: Attack(${attackExp.totalScore.toFixed(4)}) - Summon(${summonExp.totalScore.toFixed(4)}) = +${(attackExp.totalScore - summonExp.totalScore).toFixed(4)} (Attack優位)`);
        console.log(`Linear Score 差: Attack(${attackExp.linearScore.toFixed(4)}) - Summon(${summonExp.linearScore.toFixed(4)}) = ${(attackExp.linearScore - summonExp.linearScore).toFixed(4)}`);
        console.log(`Interaction Score 差: Attack(${attackExp.interactionScore.toFixed(4)}) - Summon(${summonExp.interactionScore.toFixed(4)}) = ${(attackExp.interactionScore - summonExp.interactionScore).toFixed(4)}`);
      }
    }

    // 3. Turn 4: Seq 60 (2回目の死の槍対応)
    if (entry.seq === 60) {
      console.log("\n================================================================================");
      console.log(`[ANALYSIS 3] Turn 4 2回目の死の槍対応 (Seq: 60, Step: ${i}, 合法手: ${req.patterns.length})`);
      console.log("================================================================================");
      const features = DecisionFeatureEncoder.encode(req);
      const explanations = GenomeScorer.explainScore(features, dna);

      // PASS (#56)
      const passExp = explanations.find(e => e.patternRef === 56);
      printExplanation("PASS (Pattern #56)", passExp);

      // Twist (#27)
      const twistExp = explanations.find(e => e.patternRef === 27);
      printExplanation("Twist (Pattern #27)", twistExp);
    }
  }
}

function printExplanation(title: string, exp: any) {
  if (!exp) return;
  console.log(`\n>>> [${title}] Total Score: ${exp.totalScore.toFixed(4)} (Linear: ${exp.linearScore.toFixed(4)}, Interaction: ${exp.interactionScore.toFixed(4)})`);
  console.log("  Top Linear Contributions:");
  for (let k = 0; k < Math.min(6, exp.linearContributions.length); k++) {
    const c = exp.linearContributions[k];
    console.log(`    #${k+1} ${c.name} [idx: ${c.index}]: val=${c.value.toFixed(2)}, w=${c.weight.toFixed(4)} -> contrib=${c.contribution >= 0 ? "+" : ""}${c.contribution.toFixed(4)}`);
  }
  console.log("  Top Interaction Contributions:");
  for (let k = 0; k < Math.min(6, exp.interactionContributions.length); k++) {
    const c = exp.interactionContributions[k];
    console.log(`    #${k+1} ${c.contextName} x ${c.patternName}: cVal=${c.contextValue.toFixed(2)}, pVal=${c.patternValue.toFixed(2)}, w=${c.weight.toFixed(4)} -> contrib=${c.contribution >= 0 ? "+" : ""}${c.contribution.toFixed(4)}`);
  }
}

main().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
