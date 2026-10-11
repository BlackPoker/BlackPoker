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

    return new GameSession(outcome.state, rulePackage);
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
    expect(encoded.context.values[tcIdx]).toBe(req.observation.turnCount);

    // Standard + Pack では両プレイヤーにパックが配備されている
    const selfPackCountIdx = CONTEXT_FEATURE_NAMES.indexOf("self_pack_count");
    const oppPackCountIdx = CONTEXT_FEATURE_NAMES.indexOf("opponent_pack_count");
    const selfPackOpenedIdx = CONTEXT_FEATURE_NAMES.indexOf("self_pack_opened");

    expect(encoded.context.values[selfPackCountIdx]).toBeGreaterThan(0);
    expect(encoded.context.values[oppPackCountIdx]).toBeGreaterThan(0);
    // 初期状態では未開封
    expect(encoded.context.values[selfPackOpenedIdx]).toBe(0);

    // 全パターンが 60 次元でエンコードされていること
    expect(encoded.patterns.length).toBe(req.patterns.length);
    for (const pat of encoded.patterns) {
      expect(pat.values.length).toBe(PATTERN_FEATURE_DIMENSION);
      for (const val of pat.values) {
        expect(Number.isFinite(val)).toBe(true);
      }
    }
  });

  it("2. GenomePolicy による判断・対戦進行と turnCount 進行の確認", () => {
    const session = setupStandardPackSession(100);

    // アタックおよび通常アクションを好む Genome
    const dnaA = DecisionDNACodec.createZeroDecisionDNA({ id: "dna-aggro-a" });
    const actIdx = PATTERN_FEATURE_NAMES.indexOf("pattern_is_action");
    const passIdx = PATTERN_FEATURE_NAMES.indexOf("pattern_is_pass");
    (dnaA.patternWeights as number[])[actIdx] = 2.0;
    (dnaA.patternWeights as number[])[passIdx] = 0.5;

    const dnaB = DecisionDNACodec.createZeroDecisionDNA({ id: "dna-pass-b" });
    (dnaB.patternWeights as number[])[passIdx] = 1.0;

    const policyA = new GenomePolicy(dnaA);
    const policyB = new GenomePolicy(dnaB);

    let steps = 0;
    const maxSteps = 20;
    let initialTurnCount = 1;
    let finalTurnCount = 1;

    while (steps < maxSteps) {
      const step = session.advance();
      if (step.type === "FINISHED") break;
      if (step.type !== "WAITING_FOR_DECISION") break;

      const req = step.request;
      if (steps === 0) {
        initialTurnCount = req.observation.turnCount ?? 1;
      }
      finalTurnCount = req.observation.turnCount ?? 1;

      const encoded = DecisionFeatureEncoder.encode(req);
      const tcIdx = CONTEXT_FEATURE_NAMES.indexOf("turn_count");
      expect(encoded.context.values[tcIdx]).toBe(req.observation.turnCount);

      const policy = req.playerId === "p1" ? policyA : policyB;
      const decision = policy.choose(req);

      expect(decision.selectedPatternRef).toBeGreaterThanOrEqual(0);
      expect(decision.selectedPatternRef).toBeLessThan(req.patterns.length);

      session.submitDecision(decision);
      steps++;
    }

    expect(steps).toBeGreaterThan(0);
    // 少なくとも数手進行したこと
    expect(finalTurnCount).toBeGreaterThanOrEqual(initialTurnCount);
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
