/**
 * generateGoldenParityFixture.ts
 *
 * BlackPoker Simulator - Work 5-5B R2: 独立パリティ検証用 Golden Fixture 生成スクリプト
 *
 * 【目的】
 * 新特徴量追加前基準コミット (efe071f65) の実装 (oldGen9_efe071f65.ts) を用いて、
 * 代表10局面の決定論的な期待値（ベーススコア、戦術調整値、最終スコア、最善手選択）を計算し、
 * 固定の Golden Fixture JSON (golden_parity_fixture_r2.json) を生成する。
 *
 * ※ このスクリプトは通常のテスト実行時には呼び出されず、独立して実行されるため、
 *    通常の CI や npm test 実行時に Golden Fixture が書き換わることはない。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader.js";
import { GenericTacticalEvaluator } from "../../engine/rules/GenericTacticalEvaluator.js";
import { createGen8ChampionCandidatePolicy } from "../../engine/ai/Gen8DNALoader.js";
import { DecisionDNACodec } from "../../engine/ai/DecisionDNACodec.js";
import { Gen9TacticalPrototypePolicy } from "../../engine/ai/Gen9TacticalPrototypePolicy.js";
import {
  Gen9LearnableTacticalPolicy as OldGen9Policy,
  fromV6DNA as oldFromV6DNA,
  R4_PRESET_TACTICAL_WEIGHTS as OLD_R4_WEIGHTS,
} from "./oldGen9_efe071f65.js";
import {
  buildAllScenarios,
  resolveChosenAssignments,
  ScenarioDefinition,
} from "./goldenParityScenarios.js";

function run() {
  console.log("Loading RulePackage...");
  const rulePkg = loadRulePackageForBrowser();
  const evaluator = new GenericTacticalEvaluator(rulePkg);
  Gen9TacticalPrototypePolicy.setDefaultEvaluator(evaluator);

  const gen8 = createGen8ChampionCandidatePolicy();
  const gen8DNA = DecisionDNACodec.clone((gen8 as any).dna);

  const scenarios = buildAllScenarios(rulePkg);
  console.log(`Building fixture for ${scenarios.length} scenarios...`);

  const fixtureScenarios: any[] = [];
  let totalCandidates = 0;

  for (const sc of scenarios) {
    const oldWeights = sc.customOldWeights ?? [...OLD_R4_WEIGHTS];
    const oldGenome = oldFromV6DNA(gen8DNA, oldWeights, {
      encoderVersion: "v7.2-unified-block-conditional-pass",
    });
    const oldPolicy = new OldGen9Policy(oldGenome, `OldPolicy-${sc.scenarioName}`, evaluator);

    const oldEval = oldPolicy.evaluatePatterns(sc.request);
    const oldChoice = oldPolicy.choose(sc.request);

    const patternDetails: any[] = [];
    for (const scPattern of oldEval.scoredPatterns) {
      totalCandidates++;
      const pat = sc.request.patterns[scPattern.patternRef];
      patternDetails.push({
        patternRef: scPattern.patternRef,
        patternId: pat?.patternId,
        kind: pat?.kind,
        baseScore: scPattern.baseScore,
        tacticalAdjustment: scPattern.tacticalAdjustment,
        finalScore: scPattern.finalScore,
        tacticalFeatures: [...scPattern.tacticalFeatures],
      });
    }

    const scEntry: any = {
      scenarioName: sc.scenarioName,
      candidateCount: oldEval.scoredPatterns.length,
      expectedBestPatternRef: oldEval.bestPatternRef,
      expectedChosenPatternRef: oldChoice.selectedPatternRef,
      selectedActionPatternId: sc.request.patterns[oldEval.bestPatternRef]?.patternId,
      topScore: oldEval.scoredPatterns.find((p) => p.patternRef === oldEval.bestPatternRef)?.finalScore,
      details: patternDetails,
    };

    // Scenario 7: ストリーミング評価の追加記録
    if (sc.extraStreamingRequest) {
      const streamReq = sc.extraStreamingRequest;
      const oldStreamChoice = oldPolicy.choose(streamReq);
      const streamDetails: any[] = [];
      let streamIdx = 0;
      for (const streamAssignments of streamReq.blockAssignmentStream!.iterateAssignments()) {
        const streamEval = oldPolicy.evaluateSingleBlockAssignment(
          streamReq,
          streamAssignments,
          streamIdx
        );
        streamDetails.push({
          streamIdx,
          assignments: streamAssignments,
          baseScore: streamEval.baseScore,
          tacticalAdjustment: streamEval.tacticalAdjustment,
          finalScore: streamEval.finalScore,
          tacticalFeatures: [...streamEval.tacticalFeatures],
        });
        streamIdx++;
      }
      scEntry.streamingEvaluation = {
        candidateCount: streamReq.blockAssignmentStream!.patternCount,
        expectedChosenPatternRef: oldStreamChoice.selectedPatternRef,
        expectedAssignments: resolveChosenAssignments(streamReq, oldStreamChoice.selectedPatternRef),
        details: streamDetails,
      };
    }

    fixtureScenarios.push(scEntry);
  }

  const payload = {
    benchmarkCommit: "efe071f65ef37ec2a5bd6670ec52aaa3cd4d33a8",
    description: "Golden parity reference expected values generated deterministically from oldGen9_efe071f65",
    totalScenarios: fixtureScenarios.length,
    totalCandidatesChecked: totalCandidates,
    scenarios: fixtureScenarios,
  };

  const evidenceDir = path.resolve(process.cwd(), "evidence/gen9-work5-5b");
  if (!fs.existsSync(evidenceDir)) {
    fs.mkdirSync(evidenceDir, { recursive: true });
  }

  const fixturePath = path.join(evidenceDir, "golden_parity_fixture_r2.json");
  fs.writeFileSync(fixturePath, JSON.stringify(payload, null, 2), "utf8");
  console.log(`Golden parity fixture saved to: ${fixturePath}`);
  console.log(`Total scenarios: ${scenarios.length}, Total candidates: ${totalCandidates}`);
}

run();
