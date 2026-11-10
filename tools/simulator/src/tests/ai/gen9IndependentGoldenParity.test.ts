/**
 * gen9IndependentGoldenParity.test.ts
 *
 * BlackPoker Simulator - Work 5-5B R2: 旧コミット由来の Golden Fixture による独立パリティ検証
 *
 * 【検証対象基準コミット】
 * 旧コミット: efe071f65ef37ec2a5bd6670ec52aaa3cd4d33a8 (新特徴量追加直前の正本)
 * 現行 HEAD:  Work 5-5B R2 実装コード
 *
 * 【検証方針】
 * 1. CI型エラー13件の解消:
 *    CardSelection.displayCodes, UnitSelection.displayNames の正規設定、
 *    keyUnitSelectionRef の使用、正式な LegalPatternKind ("EFFECT_SELECTION") の遵守。
 * 2. Scenario 6:
 *    LegalPatternGenerator による正式な通常ブロック (Method A) の生成・評価。
 *    kind: "EFFECT_SELECTION", selectionType: "unitAssignment", EffectSelection.assignments の遵守。
 * 3. Scenario 7:
 *    同一局面からの通常列挙 (Method A: maxFullPatternLimit=Infinity) と
 *    本物のストリーミング列挙 (Method B: maxFullPatternLimit=0) の生成。
 *    旧通常、新通常、旧ストリーミング、新ストリーミングの4者完全一致を検証。
 * 4. Scenario 8:
 *    最高スコア同点候補が複数存在する局面でのタイブレーク (最小 patternRef 優先)、
 *    順序変更耐性、choose() と evaluatePatterns() の選択一致を検証。
 * 5. Scenario 10:
 *    G0_IND7 および G3_IND3 正本ベンチマーク重みによるパリティ検証。
 * 6. Golden Fixture の不変性:
 *    保存済み固定 Fixture (golden_parity_fixture_r2.json) を読み取り専用で検証し、
 *    テスト実行中に fs.writeFileSync で上書きしない。
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { DecisionRequest } from "../../domain/decision/DecisionRequest.js";
import { DecisionDNACodec } from "../../engine/ai/DecisionDNACodec.js";
import { GenericTacticalEvaluator } from "../../engine/rules/GenericTacticalEvaluator.js";
import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader.js";
import { createGen8ChampionCandidatePolicy } from "../../engine/ai/Gen8DNALoader.js";
import { Gen9TacticalPrototypePolicy } from "../../engine/ai/Gen9TacticalPrototypePolicy.js";
import { RulePackage } from "../../domain/rules/RulePackage.js";
import {
  G0_IND7_WEIGHTS,
  G3_IND3_WEIGHTS,
} from "../../engine/ai/Gen9BenchmarkWeights.js";
import {
  Gen9LearnableTacticalPolicy as OldGen9Policy,
  fromV6DNA as oldFromV6DNA,
  R4_PRESET_TACTICAL_WEIGHTS as OLD_R4_WEIGHTS,
} from "./oldGen9_efe071f65.js";
import {
  Gen9LearnableTacticalPolicy as NewGen9Policy,
  fromV6DNA as newFromV6DNA,
  R4_PRESET_TACTICAL_WEIGHTS as NEW_R4_WEIGHTS,
  TACTICAL_FEATURE_ENCODER_VERSION_CURRENT,
} from "../../engine/ai/Gen9LearnableTacticalPolicy.js";
import {
  buildAllScenarios,
  resolveChosenAssignments,
  createBaseRequest,
  ScenarioDefinition,
} from "./goldenParityScenarios.js";

describe("Work 5-5B R2: 旧コミット (efe071f65) 由来の Golden Fixture による独立パリティ検証", () => {
  let rulePkg: RulePackage;
  let evaluator: GenericTacticalEvaluator;
  let scenarios: ScenarioDefinition[];
  let fixtureData: any;

  const gen8 = createGen8ChampionCandidatePolicy();
  const gen8DNA = DecisionDNACodec.clone((gen8 as any).dna);

  const old20Weights = [...OLD_R4_WEIGHTS];
  const new24ZeroExtendedWeights = [...old20Weights, 0.0, 0.0, 0.0, 0.0];

  let totalMismatches = 0;
  let totalCandidatesChecked = 0;

  beforeAll(() => {
    rulePkg = loadRulePackageForBrowser();
    evaluator = new GenericTacticalEvaluator(rulePkg);
    Gen9TacticalPrototypePolicy.setDefaultEvaluator(evaluator);

    scenarios = buildAllScenarios(rulePkg);

    const fixturePath = path.resolve(
      process.cwd(),
      "evidence/gen9-work5-5b/golden_parity_fixture_r2.json"
    );
    if (!fs.existsSync(fixturePath)) {
      throw new Error(`Golden parity fixture not found: ${fixturePath}`);
    }
    fixtureData = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  });

  /**
   * 独立パリティ検証共通ヘルパー
   * 旧Policy、新Policy、および静的 Golden Fixture の3者を突き合わせる
   */
  const verifyScenarioParity = (scenarioIndex: number) => {
    const sc = scenarios[scenarioIndex];
    const expectedSc = fixtureData.scenarios[scenarioIndex];
    expect(sc.scenarioName).toBe(expectedSc.scenarioName);

    const oldWeights = sc.customOldWeights ?? old20Weights;
    const newWeights = sc.customNewWeights ?? new24ZeroExtendedWeights;

    const oldGenome = oldFromV6DNA(gen8DNA, oldWeights, {
      encoderVersion: "v7.2-unified-block-conditional-pass",
    });
    const oldPolicy = new OldGen9Policy(oldGenome, `OldPolicy-${sc.scenarioName}`, evaluator);

    const newGenome = newFromV6DNA(gen8DNA, newWeights, {
      encoderVersion: TACTICAL_FEATURE_ENCODER_VERSION_CURRENT,
    });
    const newPolicy = new NewGen9Policy(newGenome, `NewPolicy-${sc.scenarioName}`, evaluator);

    const oldEval = oldPolicy.evaluatePatterns(sc.request);
    const newEval = newPolicy.evaluatePatterns(sc.request);
    const newChoice = newPolicy.choose(sc.request);

    // 候補数の一致
    expect(oldEval.scoredPatterns.length).toBe(expectedSc.candidateCount);
    expect(newEval.scoredPatterns.length).toBe(expectedSc.candidateCount);

    for (let i = 0; i < oldEval.scoredPatterns.length; i++) {
      totalCandidatesChecked++;
      const oldSc = oldEval.scoredPatterns[i];
      const newSc = newEval.scoredPatterns[i];
      const expSc = expectedSc.details[i];

      expect(oldSc.patternRef).toBe(expSc.patternRef);
      expect(newSc.patternRef).toBe(expSc.patternRef);

      // 1. ベーススコア厳密一致
      const baseDiff = Math.abs(oldSc.baseScore - newSc.baseScore);
      expect(baseDiff).toBeLessThanOrEqual(1e-12);
      expect(Math.abs(newSc.baseScore - expSc.baseScore)).toBeLessThanOrEqual(1e-12);

      // 2. 戦術調整値厳密一致 (新特徴量t20〜t23の重みがゼロであるため完全一致)
      const adjDiff = Math.abs(oldSc.tacticalAdjustment - newSc.tacticalAdjustment);
      expect(adjDiff).toBeLessThanOrEqual(1e-12);
      expect(Math.abs(newSc.tacticalAdjustment - expSc.tacticalAdjustment)).toBeLessThanOrEqual(1e-12);

      // 3. 最終スコア厳密一致
      const finalDiff = Math.abs(oldSc.finalScore - newSc.finalScore);
      expect(finalDiff).toBeLessThanOrEqual(1e-12);
      expect(Math.abs(newSc.finalScore - expSc.finalScore)).toBeLessThanOrEqual(1e-12);

      if (baseDiff > 1e-12 || adjDiff > 1e-12 || finalDiff > 1e-12) {
        totalMismatches++;
      }
    }

    // 4. 最善手選択の完全一致
    expect(oldEval.bestPatternRef).toBe(expectedSc.expectedBestPatternRef);
    expect(newEval.bestPatternRef).toBe(expectedSc.expectedBestPatternRef);
    expect(newChoice.selectedPatternRef).toBe(expectedSc.expectedChosenPatternRef);

    if (newEval.bestPatternRef !== oldEval.bestPatternRef) {
      totalMismatches++;
    }

    return { oldEval, newEval, oldPolicy, newPolicy };
  };

  // ===========================================================================
  // 1. 通常アクション局面 (Normal Action)
  // ===========================================================================
  it("Scenario 1: 通常アクション局面 (Normal Action) のパリティ検証", () => {
    const { oldEval, newEval } = verifyScenarioParity(0);
    expect(newEval.scoredPatterns.length).toBe(3);
    expect(newEval.bestPatternRef).toBe(1); // Attack が選ばれること
  });

  // ===========================================================================
  // 2. コスト支払い局面 (Cost Payment)
  // ===========================================================================
  it("Scenario 2: コスト支払い局面 (Cost Payment) のパリティ検証", () => {
    const { oldEval, newEval } = verifyScenarioParity(1);
    expect(newEval.scoredPatterns.length).toBe(3);
    expect(newEval.bestPatternRef).toBe(oldEval.bestPatternRef);
  });

  // ===========================================================================
  // 3. キーカード選択局面 (Key Card Selection)
  // ===========================================================================
  it("Scenario 3: キーカード選択局面 (Key Card Selection) のパリティ検証", () => {
    const { oldEval, newEval } = verifyScenarioParity(2);
    expect(newEval.scoredPatterns.length).toBe(4);
    expect(newEval.bestPatternRef).toBe(oldEval.bestPatternRef);
  });

  // ===========================================================================
  // 4. Counter有効局面 (Effective Counter)
  // ===========================================================================
  it("Scenario 4: Counter有効局面 (Effective Counter) のパリティ検証", () => {
    const { oldEval, newEval } = verifyScenarioParity(3);
    expect(newEval.scoredPatterns.length).toBe(2);
    expect(newEval.bestPatternRef).toBe(1); // Counter (patternRef=1) が選ばれること
  });

  // ===========================================================================
  // 5. 受動PASS局面 (Passive PASS)
  // ===========================================================================
  it("Scenario 5: 受動PASS局面 (Passive PASS) のパリティ検証", () => {
    const { oldEval, newEval } = verifyScenarioParity(4);
    expect(newEval.scoredPatterns.length).toBe(2);
    // 有効対抗手段なしの場合、PASS減点が免除されてPASSが選択される
    expect(newEval.bestPatternRef).toBe(0);
  });

  // ===========================================================================
  // 6. 通常ブロック局面 (Normal Block - 正式 EFFECT_SELECTION)
  // ===========================================================================
  it("Scenario 6: 通常ブロック局面 (Normal Block) のパリティ検証", () => {
    const { oldEval, newEval, newPolicy } = verifyScenarioParity(5);
    const sc = scenarios[5];

    // 正本データモデルの検証
    expect(sc.request.patterns.length).toBeGreaterThan(0);
    for (const pat of sc.request.patterns) {
      expect(pat.kind).toBe("EFFECT_SELECTION");
      expect(pat.effectSelectionRef).toBeDefined();
      const eff = sc.request.catalog.effectSelections[pat.effectSelectionRef!];
      expect(eff).toBeDefined();
      expect(eff.selectionType).toBe("unitAssignment");
    }

    // ブロック割り当ての復元検証
    const chosenAssignments = resolveChosenAssignments(sc.request, newEval.bestPatternRef);
    expect(chosenAssignments).toBeDefined();

    // ブロック特徴量 (t14〜t16) の計算確認
    const bestDetail = newEval.scoredPatterns.find((p) => p.patternRef === newEval.bestPatternRef);
    expect(bestDetail).toBeDefined();
    // 実際に非ゼロの特徴量（ダメージ・トレード・致死等）が評価に含まれていること
    const hasActiveBlockFeature = newEval.scoredPatterns.some(
      (p) => p.tacticalFeatures[14] !== 0 || p.tacticalFeatures[15] !== 0 || p.tacticalFeatures[16] !== 0
    );
    expect(hasActiveBlockFeature).toBe(true);
  });

  // ===========================================================================
  // 7. ストリーミングブロック局面 (Streaming Block - Method A vs Method B)
  // ===========================================================================
  it("Scenario 7: ストリーミングブロック局面 (Streaming Block) の4経路完全パリティ検証", () => {
    const { oldEval, newEval, oldPolicy, newPolicy } = verifyScenarioParity(6);
    const sc = scenarios[6];
    const normalReq = sc.request;
    const streamReq = sc.extraStreamingRequest!;

    // 1. ストリーミングリクエスト構造の検証
    expect(normalReq.patterns.length).toBeGreaterThan(0);
    expect(streamReq.patterns.length).toBe(0);
    expect(streamReq.blockAssignmentStream).toBeDefined();
    expect(streamReq.blockAssignmentStream!.patternCount).toBe(normalReq.patterns.length);

    // 2. 4経路の選択結果取得
    // (1) 旧Policy: 通常列挙
    const oldNormalChoice = oldPolicy.choose(normalReq);
    // (2) 新Policy: 通常列挙
    const newNormalChoice = newPolicy.choose(normalReq);
    // (3) 旧Policy: ストリーミング
    const oldStreamChoice = oldPolicy.choose(streamReq);
    // (4) 新Policy: ストリーミング
    const newStreamChoice = newPolicy.choose(streamReq);

    // 選択 patternRef の4者完全一致
    expect(oldNormalChoice.selectedPatternRef).toBe(oldEval.bestPatternRef);
    expect(newNormalChoice.selectedPatternRef).toBe(oldEval.bestPatternRef);
    expect(oldStreamChoice.selectedPatternRef).toBe(oldEval.bestPatternRef);
    expect(newStreamChoice.selectedPatternRef).toBe(oldEval.bestPatternRef);

    // 選択された実際の UnitAssignment[] の4者完全一致
    const oldNormalAssignments = resolveChosenAssignments(normalReq, oldNormalChoice.selectedPatternRef);
    const newNormalAssignments = resolveChosenAssignments(normalReq, newNormalChoice.selectedPatternRef);
    const oldStreamAssignments = resolveChosenAssignments(streamReq, oldStreamChoice.selectedPatternRef);
    const newStreamAssignments = resolveChosenAssignments(streamReq, newStreamChoice.selectedPatternRef);

    expect(newNormalAssignments).toEqual(oldNormalAssignments);
    expect(oldStreamAssignments).toEqual(oldNormalAssignments);
    expect(newStreamAssignments).toEqual(oldNormalAssignments);

    // 3. 全候補の単体評価一致検証 (旧通常 = 新通常 = 旧ストリーミング = 新ストリーミング)
    let streamIdx = 0;
    for (const assignments of streamReq.blockAssignmentStream!.iterateAssignments()) {
      const normalDetail = newEval.scoredPatterns[streamIdx];
      const oldStreamDetail = oldPolicy.evaluateSingleBlockAssignment(streamReq, assignments, streamIdx);
      const newStreamDetail = newPolicy.evaluateSingleBlockAssignment(streamReq, assignments, streamIdx);

      // ベーススコア一致
      expect(Math.abs(normalDetail.baseScore - oldStreamDetail.baseScore)).toBeLessThanOrEqual(1e-12);
      expect(Math.abs(normalDetail.baseScore - newStreamDetail.baseScore)).toBeLessThanOrEqual(1e-12);
      expect(Math.abs(oldStreamDetail.baseScore - newStreamDetail.baseScore)).toBeLessThanOrEqual(1e-12);

      // 戦術調整値一致
      expect(Math.abs(normalDetail.tacticalAdjustment - oldStreamDetail.tacticalAdjustment)).toBeLessThanOrEqual(1e-12);
      expect(Math.abs(normalDetail.tacticalAdjustment - newStreamDetail.tacticalAdjustment)).toBeLessThanOrEqual(1e-12);
      expect(Math.abs(oldStreamDetail.tacticalAdjustment - newStreamDetail.tacticalAdjustment)).toBeLessThanOrEqual(1e-12);

      // 最終スコア一致
      expect(Math.abs(normalDetail.finalScore - oldStreamDetail.finalScore)).toBeLessThanOrEqual(1e-12);
      expect(Math.abs(normalDetail.finalScore - newStreamDetail.finalScore)).toBeLessThanOrEqual(1e-12);
      expect(Math.abs(oldStreamDetail.finalScore - newStreamDetail.finalScore)).toBeLessThanOrEqual(1e-12);

      // t14〜t16 特徴量一致
      for (let t = 14; t <= 16; t++) {
        expect(Math.abs(normalDetail.tacticalFeatures[t] - newStreamDetail.tacticalFeatures[t])).toBeLessThanOrEqual(1e-12);
        expect(Math.abs(oldStreamDetail.tacticalFeatures[t] - newStreamDetail.tacticalFeatures[t])).toBeLessThanOrEqual(1e-12);
      }

      streamIdx++;
    }
  });

  // ===========================================================================
  // 8. 最高スコア同点タイブレーク局面 (Tie-Break Determinism)
  // ===========================================================================
  it("Scenario 8: 最高スコア同点タイブレーク局面 (Tie-Break Determinism) の完全検証", () => {
    const { oldEval, newEval, oldPolicy, newPolicy } = verifyScenarioParity(7);
    const sc = scenarios[7];

    // 1. 最高スコアを持つ合法手が少なくとも2件存在することの検証
    expect(newEval.scoredPatterns.length).toBeGreaterThanOrEqual(2);
    const topScore = newEval.scoredPatterns[0].finalScore;
    const secondScore = newEval.scoredPatterns[1].finalScore;
    expect(topScore).toBeCloseTo(secondScore, 12);
    expect(topScore).toBeGreaterThan(newEval.scoredPatterns[2].finalScore);

    // 2. 最小 patternRef 優先のタイブレーク検証
    expect(newEval.bestPatternRef).toBe(0);
    expect(oldEval.bestPatternRef).toBe(0);

    const oldChoice = oldPolicy.choose(sc.request);
    const newChoice = newPolicy.choose(sc.request);
    expect(oldChoice.selectedPatternRef).toBe(0);
    expect(newChoice.selectedPatternRef).toBe(0);

    // 3. パターン列挙順序が反転した場合のタイブレーク検証
    const reversedReq: DecisionRequest = {
      ...sc.request,
      patterns: [
        sc.request.patterns[1],
        sc.request.patterns[0],
        sc.request.patterns[2],
      ],
    };
    const revOldChoice = oldPolicy.choose(reversedReq);
    const revNewChoice = newPolicy.choose(reversedReq);
    const revNewEval = newPolicy.evaluatePatterns(reversedReq);

    // 順序反転後も先頭インデックス (0) が選ばれること
    expect(revOldChoice.selectedPatternRef).toBe(0);
    expect(revNewChoice.selectedPatternRef).toBe(0);
    expect(revNewEval.bestPatternRef).toBe(0);
  });

  // ===========================================================================
  // 9. Joker含む局面 (Joker Presence)
  // ===========================================================================
  it("Scenario 9: Joker含む局面 (Joker Presence) のパリティ検証", () => {
    const { oldEval, newEval } = verifyScenarioParity(8);
    expect(newEval.scoredPatterns.length).toBe(3);
    expect(newEval.bestPatternRef).toBe(oldEval.bestPatternRef);
  });

  // ===========================================================================
  // 10. 正本ベンチマーク重み適用局面 (G0_IND7 / G3_IND3 Benchmark Weights)
  // ===========================================================================
  it("Scenario 10: 正本ベンチマーク重み (G0_IND7 / G3_IND3) 適用局面のパリティ検証", () => {
    // 1. G0_IND7 正本重みでの検証
    const { oldEval: g0OldEval, newEval: g0NewEval } = verifyScenarioParity(9);
    expect(g0NewEval.scoredPatterns.length).toBe(4);
    expect(g0NewEval.bestPatternRef).toBe(g0OldEval.bestPatternRef);

    // 2. G3_IND3 正本重みでの追加パリティ検証
    const sc10 = scenarios[9];
    const g3Ind3_20 = [...G3_IND3_WEIGHTS];
    const g3Ind3_24 = [...g3Ind3_20, 0.0, 0.0, 0.0, 0.0];

    const oldGenomeG3 = oldFromV6DNA(gen8DNA, g3Ind3_20, {
      encoderVersion: "v7.2-unified-block-conditional-pass",
    });
    const oldPolicyG3 = new OldGen9Policy(oldGenomeG3, "OldPolicy-G3_IND3", evaluator);

    const newGenomeG3 = newFromV6DNA(gen8DNA, g3Ind3_24, {
      encoderVersion: TACTICAL_FEATURE_ENCODER_VERSION_CURRENT,
    });
    const newPolicyG3 = new NewGen9Policy(newGenomeG3, "NewPolicy-G3_IND3", evaluator);

    const oldEvalG3 = oldPolicyG3.evaluatePatterns(sc10.request);
    const newEvalG3 = newPolicyG3.evaluatePatterns(sc10.request);

    expect(newEvalG3.bestPatternRef).toBe(oldEvalG3.bestPatternRef);
    for (let i = 0; i < oldEvalG3.scoredPatterns.length; i++) {
      expect(Math.abs(oldEvalG3.scoredPatterns[i].finalScore - newEvalG3.scoredPatterns[i].finalScore)).toBeLessThanOrEqual(1e-12);
    }
  });

  afterAll(() => {
    // ※ Golden Fixture の不変性遵守:
    // 通常のテスト実行において fs.writeFileSync による期待値の書き換えは一切行わない。
    expect(totalMismatches).toBe(0);
    expect(totalCandidatesChecked).toBeGreaterThan(0);
  });
});
