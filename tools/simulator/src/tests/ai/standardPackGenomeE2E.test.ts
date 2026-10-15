import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { fileURLToPath } from "url";
import { loadRegulationCatalog, RegulationCatalog } from "../../engine/regulation/RegulationLoader";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage } from "../../domain/rules/RulePackage";
import { OfficialRegulationMatchSetup } from "../../engine/regulation/OfficialRegulationMatchSetup";
import { GameSession } from "../../engine/session/GameSession";
import { DecisionDNACodec } from "../../engine/ai/DecisionDNACodec";
import { GenomePolicy } from "../../engine/ai/GenomePolicy";
import { DecisionFeatureEncoder } from "../../engine/ai/DecisionFeatureEncoder";
import {
  CONTEXT_FEATURE_NAMES,
  PATTERN_FEATURE_NAMES,
  CONTEXT_FEATURE_DIMENSION,
  PATTERN_FEATURE_DIMENSION,
  FEATURE_SCHEMA_VERSION,
} from "../../domain/ai/DecisionFeatureTypes";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Standard + Pack Genome E2E (BP-SIM-AI-FEATURE-SCHEMA-V2)", () => {
  let catalog: RegulationCatalog;
  let rulePackage: RulePackage;

  beforeAll(async () => {
    catalog = await loadRegulationCatalog();
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  const setupStandardPackSession = (seed: number): GameSession => {
    const reg = catalog.regulations.get("standard-pack");
    expect(reg).toBeDefined();
    if (!reg) throw new Error("Regulation standard-pack not found");
    const frame = catalog.frames.get(reg.frameId);
    expect(frame).toBeDefined();
    if (!frame) throw new Error(`Frame ${reg.frameId} not found`);

    const outcome = OfficialRegulationMatchSetup.setupMatch(reg, frame, rulePackage, seed, {
      playerNames: { p1: "Genome Player A", p2: "Genome Player B" },
    });

    expect(outcome.type).toBe("READY");
    if (outcome.type !== "READY") {
      throw new Error(`Failed to setup standard-pack match: ${outcome.reason}`);
    }

    return new GameSession(outcome.state, rulePackage, { matchSeed: seed });
  };

  it("1. official:standard-pack での初期盤面セットアップと Pack / turnCount 特徴量の合法観測", () => {
    const session = setupStandardPackSession(42);
    const step = session.advance();

    expect(step.type).toBe("WAITING_FOR_DECISION");
    if (step.type !== "WAITING_FOR_DECISION") return;

    const req = step.request;
    expect(req.observation.turnCount).toBeGreaterThanOrEqual(1);

    const encoded = DecisionFeatureEncoder.encode(req);
    expect(encoded.featureSchemaVersion).toBe(FEATURE_SCHEMA_VERSION);
    expect(encoded.context.values.length).toBe(CONTEXT_FEATURE_DIMENSION);

    const tcIdx = CONTEXT_FEATURE_NAMES.indexOf("turn_count");
    // Schema v5: turn_count is scaled via saturatingRational(tc, 10)
    expect(encoded.context.values[tcIdx]).toBeCloseTo(
      req.observation.turnCount / (req.observation.turnCount + 10),
      10
    );

    // Standard + Pack では両プレイヤーにパックが配備されている
    const selfPackCountIdx = CONTEXT_FEATURE_NAMES.indexOf("self_pack_count");
    const oppPackCountIdx = CONTEXT_FEATURE_NAMES.indexOf("opponent_pack_count");
    const selfPackOpenedIdx = CONTEXT_FEATURE_NAMES.indexOf("self_pack_opened");

    expect(encoded.context.values[selfPackCountIdx]).toBeGreaterThan(0);
    expect(encoded.context.values[oppPackCountIdx]).toBeGreaterThan(0);
    // 初期状態では未開封
    expect(encoded.context.values[selfPackOpenedIdx]).toBe(0);

    // Standard + Pack では Rare Card や Trump (切札) は存在しないため、特徴量は 0
    const selfRareIdx = CONTEXT_FEATURE_NAMES.indexOf("self_rare_count");
    const oppRareIdx = CONTEXT_FEATURE_NAMES.indexOf("opponent_rare_count");
    const selfTrumpIdx = CONTEXT_FEATURE_NAMES.indexOf("self_trump_count");
    const oppTrumpIdx = CONTEXT_FEATURE_NAMES.indexOf("opponent_trump_count");
    expect(selfRareIdx).toBeGreaterThanOrEqual(0);
    expect(oppRareIdx).toBeGreaterThanOrEqual(0);
    expect(selfTrumpIdx).toBeGreaterThanOrEqual(0);
    expect(oppTrumpIdx).toBeGreaterThanOrEqual(0);
    expect(encoded.context.values[selfRareIdx]).toBe(0);
    expect(encoded.context.values[oppRareIdx]).toBe(0);
    expect(encoded.context.values[selfTrumpIdx]).toBe(0);
    expect(encoded.context.values[oppTrumpIdx]).toBe(0);

    // 全パターンが 60 次元でエンコードされていること
    expect(encoded.patterns.length).toBe(req.patterns.length);
    for (const pat of encoded.patterns) {
      expect(pat.values.length).toBe(PATTERN_FEATURE_DIMENSION);
      for (const val of pat.values) {
        expect(Number.isFinite(val)).toBe(true);
      }
    }
  });

  it("2. GenomePolicy による判断・対戦進行と turnCount 進行の確認 (turnCount >= 2 実証)", () => {
    const session = setupStandardPackSession(100);

    // 汎用特徴量による意思決定:
    // Action ID ハードコードを行わず、汎用メタデータ（アクション、キーカード、コスト、パス、効果選択）のみで
    // エンドターンやパスを含む対戦フローが進行し turnCount が 2 以上へ進むことを実証
    const dnaA = DecisionDNACodec.createZeroDecisionDNA({ id: "dna-pass-a" });
    const dnaB = DecisionDNACodec.createZeroDecisionDNA({ id: "dna-active-b" });

    const actIdx = PATTERN_FEATURE_NAMES.indexOf("pattern_is_action");
    const passIdx = PATTERN_FEATURE_NAMES.indexOf("pattern_is_pass");
    const effIdx = PATTERN_FEATURE_NAMES.indexOf("pattern_is_effect_selection");
    const keyCardIdx = PATTERN_FEATURE_NAMES.indexOf("has_key_card");
    const costIdx = PATTERN_FEATURE_NAMES.indexOf("has_cost");

    // dnaB (先攻 p2) はアクションを好むが、キーカードやコストを要しないアクション (action.end 等) をより高く評価し、効果選択も解決する
    (dnaB.patternWeights as number[])[actIdx] = 2.0;
    (dnaB.patternWeights as number[])[keyCardIdx] = -1.0;
    (dnaB.patternWeights as number[])[costIdx] = -1.0;
    (dnaB.patternWeights as number[])[passIdx] = 0.5;
    (dnaB.patternWeights as number[])[effIdx] = 3.0;

    // dnaA (後攻 p1) はパス・効果選択を適切に行う
    (dnaA.patternWeights as number[])[passIdx] = 1.0;
    (dnaA.patternWeights as number[])[effIdx] = 2.0;

    const policyA = new GenomePolicy(dnaA);
    const policyB = new GenomePolicy(dnaB);

    let steps = 0;
    const maxSteps = 100;
    let initialTurnCount = 1;
    let maxObservedTurnCount = 1;

    while (steps < maxSteps) {
      const step = session.advance();
      if (step.type === "FINISHED") break;
      if (step.type !== "WAITING_FOR_DECISION") break;

      const req = step.request;
      const currentTurn = req.observation.turnCount ?? 1;
      if (steps === 0) {
        initialTurnCount = currentTurn;
      }
      if (currentTurn > maxObservedTurnCount) {
        maxObservedTurnCount = currentTurn;
      }

      const encoded = DecisionFeatureEncoder.encode(req);
      const tcIdx = CONTEXT_FEATURE_NAMES.indexOf("turn_count");
      // Schema v5: turn_count is scaled via saturatingRational(tc, 10)
      expect(encoded.context.values[tcIdx]).toBeCloseTo(
        req.observation.turnCount / (req.observation.turnCount + 10),
        10
      );

      // 対戦進行中も Standard + Pack では Rare / Trump は 0 であること
      const selfRareIdx = CONTEXT_FEATURE_NAMES.indexOf("self_rare_count");
      const oppRareIdx = CONTEXT_FEATURE_NAMES.indexOf("opponent_rare_count");
      const selfTrumpIdx = CONTEXT_FEATURE_NAMES.indexOf("self_trump_count");
      const oppTrumpIdx = CONTEXT_FEATURE_NAMES.indexOf("opponent_trump_count");
      expect(encoded.context.values[selfRareIdx]).toBe(0);
      expect(encoded.context.values[oppRareIdx]).toBe(0);
      expect(encoded.context.values[selfTrumpIdx]).toBe(0);
      expect(encoded.context.values[oppTrumpIdx]).toBe(0);

      const policy = req.playerId === "p1" ? policyA : policyB;
      const decision = policy.choose(req);

      expect(decision.selectedPatternRef).toBeGreaterThanOrEqual(0);
      expect(decision.selectedPatternRef).toBeLessThan(req.patterns.length);

      session.submitDecision(decision);
      steps++;

      // turnCount が 2 以上に進んだことを確認したら早期に十分な証拠が得られたとみなせる
      if (maxObservedTurnCount >= 2 && steps >= 10) {
        if (steps >= 15) break;
      }
    }

    expect(steps).toBeGreaterThan(0);
    expect(initialTurnCount).toBe(1);
    // turnCount が 1 から 2 以上へ進んだことを厳格に実証
    expect(maxObservedTurnCount).toBeGreaterThan(initialTurnCount);
    expect(maxObservedTurnCount).toBeGreaterThanOrEqual(2);
  });

  it("3. 同一シードにおける決定論的再現性 (Determinism): 特徴量と行動選択の 100% 一致", () => {
    const runMatch = (seed: number) => {
      const session = setupStandardPackSession(seed);
      const dna = DecisionDNACodec.createZeroDecisionDNA();
      const actIdx = PATTERN_FEATURE_NAMES.indexOf("pattern_is_action");
      (dna.patternWeights as number[])[actIdx] = 3.0;
      const policy = new GenomePolicy(dna);

      const history: Array<{
        turnCount: number;
        decisionId: string;
        selectedPatternRef: number;
        contextValues: readonly number[];
        patternValues: readonly (readonly number[])[];
      }> = [];

      let steps = 0;
      while (steps < 10) {
        const step = session.advance();
        if (step.type !== "WAITING_FOR_DECISION") break;

        const req = step.request;
        const encoded = DecisionFeatureEncoder.encode(req);
        const decision = policy.choose(req);

        history.push({
          turnCount: req.observation.turnCount ?? 1,
          decisionId: req.decisionId,
          selectedPatternRef: decision.selectedPatternRef,
          contextValues: encoded.context.values,
          patternValues: encoded.patterns.map((p) => p.values),
        });

        session.submitDecision(decision);
        steps++;
      }

      return history;
    };

    const run1 = runMatch(777);
    const run2 = runMatch(777);

    expect(run1.length).toBe(run2.length);
    expect(run1.length).toBeGreaterThan(0);

    for (let i = 0; i < run1.length; i++) {
      expect(run1[i].turnCount).toBe(run2[i].turnCount);
      expect(run1[i].selectedPatternRef).toBe(run2[i].selectedPatternRef);
      expect(run1[i].contextValues).toEqual(run2[i].contextValues);
      expect(run1[i].patternValues).toEqual(run2[i].patternValues);
    }
  });
});
