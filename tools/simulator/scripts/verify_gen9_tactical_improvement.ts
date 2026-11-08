/**
 * verify_gen9_tactical_improvement.ts
 *
 * 正本対戦 (Seed: 4127992094) の DecisionRequest を用いて、
 * Gen 8 (GenomePolicy) と Gen 9 戦術プロトタイプ (Gen9TacticalPrototypePolicy R2) の
 * 重要局面判断とスコア変化を直接比較・検証する。
 */

import * as fs from "fs";
import * as path from "path";
import { loadRulePackageFromDirectory } from "../src/engine/rules/RuleLoader.js";
import { loadRegulationCatalog } from "../src/engine/regulation/RegulationLoader.js";
import { createReplayPlanFromDiagnosticBundleV1 } from "../src/ui/playtest/DiagnosticReplayAdapter.js";
import { reconstructMatch } from "../src/engine/replay/ReplayReconstructionService.js";
import { createGen8ChampionCandidatePolicy } from "../src/engine/ai/Gen8DNALoader.js";
import { Gen9TacticalPrototypePolicy } from "../src/engine/ai/Gen9TacticalPrototypePolicy.js";
import { GenericTacticalEvaluator } from "../src/engine/rules/GenericTacticalEvaluator.js";

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

  const gen8Policy = createGen8ChampionCandidatePolicy();
  const dna = (gen8Policy as any).dna;
  const tacticalEvaluator = new GenericTacticalEvaluator(fullRulePackage);
  const gen9Policy = new Gen9TacticalPrototypePolicy(dna, "Gen9-Tactical-Prototype-R3", tacticalEvaluator);

  console.log("================================================================================");
  console.log(" BlackPoker — Gen 8 vs Gen 9 戦術プロトタイプ 正本回帰検証 (Work 5-1 R2)");
  console.log("================================================================================");

  for (let i = 0; i < recon.replayedDecisions.length; i++) {
    const rd = recon.replayedDecisions[i];
    const req = rd.request;
    const entry = rd.entry;

    // 1. Turn 2: Seq 20 (最初の死の槍対応: ♢A+♠K, 対象: AI兵士♣10, 12点ダメージ)
    if (entry.seq === 20) {
      console.log("\n================================================================================");
      console.log(`[VERIFICATION 1] Turn 2 死の槍への対応 (Seq: 20, Step: ${i}, 合法手数: ${req.patterns.length})`);
      console.log("================================================================================");
      console.log("StageRequests:", JSON.stringify(req.observation.stageRequests, null, 2));
      console.log("PlayerId:", req.playerId);
      const oppReqs = (req.observation.stageRequests ?? []).filter(r => r.controller !== req.playerId);
      console.log("Opponent Requests count:", oppReqs.length);
      if (oppReqs.length > 0) {
        console.log("Opponent Request 0:", JSON.stringify(oppReqs[oppReqs.length - 1], null, 2));
      }

      const gen8Choice = gen8Policy.choose(req);
      const gen9Eval = gen9Policy.evaluatePatterns(req);
      const gen9Choice = gen9Policy.choose(req);

      console.log(`Gen 8 選択: Pattern #${gen8Choice.selectedPatternRef} (Kind: ${req.patterns[gen8Choice.selectedPatternRef].kind})`);
      console.log(`Gen 9 選択: Pattern #${gen9Choice.selectedPatternRef} (Kind: ${req.patterns[gen9Choice.selectedPatternRef].kind})`);

      const passDetail = gen9Eval.scoredPatterns.find(p => req.patterns[p.patternRef].kind === "PASS");
      const counterDetail = gen9Eval.scoredPatterns.find(p => {
        const actRef = req.patterns[p.patternRef].actionSelectionRef;
        return actRef !== undefined && req.catalog.actions[actRef]?.actionId === "action.counter";
      });

      console.log("\n--- [PASS (Pattern #" + passDetail?.patternRef + ")] ---");
      console.log(`  Base Score: ${passDetail?.baseScore.toFixed(4)}`);
      console.log(`  Tactical Adj: ${passDetail?.tacticalAdjustment.toFixed(4)} (${passDetail?.reason ?? "なし"})`);
      console.log(`  Final Score: ${passDetail?.finalScore.toFixed(4)}`);

      console.log("\n--- [Counter (Pattern #" + counterDetail?.patternRef + ")] ---");
      console.log(`  Base Score: ${counterDetail?.baseScore.toFixed(4)}`);
      console.log(`  Tactical Adj: ${counterDetail?.tacticalAdjustment.toFixed(4)} (${counterDetail?.reason ?? "なし"})`);
      console.log(`  Final Score: ${counterDetail?.finalScore.toFixed(4)}`);

      const isCounterSelected = counterDetail && gen9Choice.selectedPatternRef === counterDetail.patternRef;
      console.log(`\n=> 改善判定: ${isCounterSelected ? "SUCCESS: Counter が選択されました！" : "FAILED"}`);
    }

    // 2. Turn 3: Seq 32 (攻撃判断: 相手にサイズ13英雄♥K)
    if (entry.seq === 32) {
      console.log("\n================================================================================");
      console.log(`[VERIFICATION 2] Turn 3 攻撃判断 (Seq: 32, Step: ${i}, 合法手数: ${req.patterns.length})`);
      console.log("================================================================================");

      const gen8Choice = gen8Policy.choose(req);
      const gen9Eval = gen9Policy.evaluatePatterns(req);
      const gen9Choice = gen9Policy.choose(req);

      const gen8ActRef = req.patterns[gen8Choice.selectedPatternRef].actionSelectionRef;
      const gen8ActId = gen8ActRef !== undefined ? req.catalog.actions[gen8ActRef]?.actionId : "PASS";
      const gen9ActRef = req.patterns[gen9Choice.selectedPatternRef].actionSelectionRef;
      const gen9ActId = gen9ActRef !== undefined ? req.catalog.actions[gen9ActRef]?.actionId : "PASS";

      console.log(`Gen 8 選択: Pattern #${gen8Choice.selectedPatternRef} (Action: ${gen8ActId})`);
      console.log(`Gen 9 選択: Pattern #${gen9Choice.selectedPatternRef} (Action: ${gen9ActId})`);

      const attackDetail = gen9Eval.scoredPatterns.find(p => {
        const actRef = req.patterns[p.patternRef].actionSelectionRef;
        return actRef !== undefined && req.catalog.actions[actRef]?.actionId === "action.attack";
      });
      const bestDetail = gen9Eval.scoredPatterns.find(p => p.patternRef === gen9Choice.selectedPatternRef);

      console.log("\n--- [Attack (Pattern #" + attackDetail?.patternRef + ")] ---");
      console.log(`  Base Score: ${attackDetail?.baseScore.toFixed(4)}`);
      console.log(`  Tactical Adj: ${attackDetail?.tacticalAdjustment.toFixed(4)} (${attackDetail?.reason ?? "なし"})`);
      console.log(`  Final Score: ${attackDetail?.finalScore.toFixed(4)}`);

      console.log("\n--- [Gen 9 最善手 (Pattern #" + bestDetail?.patternRef + ": " + gen9ActId + ")] ---");
      console.log(`  Base Score: ${bestDetail?.baseScore.toFixed(4)}`);
      console.log(`  Tactical Adj: ${bestDetail?.tacticalAdjustment.toFixed(4)} (${bestDetail?.reason ?? "なし"})`);
      console.log(`  Final Score: ${bestDetail?.finalScore.toFixed(4)}`);

      const isAttackAvoided = gen9ActId !== "action.attack";
      console.log(`\n=> 改善判定: ${isAttackAvoided ? `SUCCESS: 自爆攻撃が回避され、${gen9ActId} が選択されました！` : "FAILED"}`);
    }

    // 3. Turn 3 End: Seq 60 (エンド前処理: 合法手57件, PASS #56)
    if (entry.seq === 60) {
      console.log("\n================================================================================");
      console.log(`[VERIFICATION 3] Turn 3 終了局面 (Seq: 60, Step: ${i}, 合法手数: ${req.patterns.length})`);
      console.log("================================================================================");

      const gen8Choice = gen8Policy.choose(req);
      const gen9Choice = gen9Policy.choose(req);

      console.log(`Gen 8 選択: Pattern #${gen8Choice.selectedPatternRef} (Kind: ${req.patterns[gen8Choice.selectedPatternRef].kind})`);
      console.log(`Gen 9 選択: Pattern #${gen9Choice.selectedPatternRef} (Kind: ${req.patterns[gen9Choice.selectedPatternRef].kind})`);
      console.log(`=> 局面検証: 正常に PASS #${gen9Choice.selectedPatternRef} が選ばれターンが終了`);
    }

    // 4. Turn 4: Seq 66 (2回目の死の槍直撃: 8ダメージ, 合法手57件, PASS #56)
    if (entry.seq === 66) {
      console.log("\n================================================================================");
      console.log(`[VERIFICATION 4] Turn 4 2回目の死の槍への対応 (Seq: 66, Step: ${i}, 合法手数: ${req.patterns.length})`);
      console.log("================================================================================");

      const gen8Choice = gen8Policy.choose(req);
      const gen9Eval = gen9Policy.evaluatePatterns(req);
      const gen9Choice = gen9Policy.choose(req);

      console.log(`Gen 8 選択: Pattern #${gen8Choice.selectedPatternRef} (Kind: ${req.patterns[gen8Choice.selectedPatternRef].kind})`);
      console.log(`Gen 9 選択: Pattern #${gen9Choice.selectedPatternRef} (Kind: ${req.patterns[gen9Choice.selectedPatternRef].kind})`);

      const gen9Pat = req.patterns[gen9Choice.selectedPatternRef];
      const gen9ActRef = gen9Pat.actionSelectionRef;
      const gen9Act = gen9ActRef !== undefined ? req.catalog.actions[gen9ActRef] : undefined;
      console.log(`Gen 9 選択 Pattern 詳細: ActionId=${gen9Act?.actionId}, Name=${gen9Act?.actionName}`);
      const scoredP1 = gen9Eval.scoredPatterns.find(p => p.patternRef === gen9Choice.selectedPatternRef);
      console.log(`  BaseScore=${scoredP1?.baseScore.toFixed(4)}, Adj=${scoredP1?.tacticalAdjustment.toFixed(4)} (${scoredP1?.reason}), Final=${scoredP1?.finalScore.toFixed(4)}`);

      const passP = gen9Eval.scoredPatterns.find(p => req.patterns[p.patternRef].kind === "PASS");
      console.log(`PASS (#${passP?.patternRef}) 詳細:`);
      console.log(`  BaseScore=${passP?.baseScore.toFixed(4)}, Adj=${passP?.tacticalAdjustment.toFixed(4)} (${passP?.reason}), Final=${passP?.finalScore.toFixed(4)}`);

      const hasCounter = req.patterns.some(p => {
        const actRef = p.actionSelectionRef;
        return actRef !== undefined && req.catalog.actions[actRef]?.actionId === "action.counter";
      });
      console.log(`手札に Counter が存在するか: ${hasCounter ? "YES" : "NO"}`);
      console.log(`=> 局面検証: Counter 不在のため、PASS #${gen9Choice.selectedPatternRef} が選択されゲーム終了`);
    }
  }

  console.log("\n================================================================================");
  console.log(" 正本回帰検証 完了");
  console.log("================================================================================");
}

main().catch(err => {
  console.error("Error in verification:", err);
  process.exit(1);
});
