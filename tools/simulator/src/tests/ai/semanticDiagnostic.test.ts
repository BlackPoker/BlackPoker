import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import * as crypto from "crypto";
import { fileURLToPath } from "url";
import { loadRegulationCatalog, RegulationCatalog } from "../../engine/regulation/RegulationLoader";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage } from "../../domain/rules/RulePackage";
import { OfficialRegulationMatchSetup } from "../../engine/regulation/OfficialRegulationMatchSetup";
import { GameSession } from "../../engine/session/GameSession";
import { SimulationRunner } from "../../engine/simulation/SimulationRunner";
import { FirstLegalPolicy, RandomPolicy } from "../../engine/simulation/DecisionPolicy";
import { SeededRandom } from "../../engine/random/RandomSource";
import { createCoreBattlePresetState } from "../../engine/session/playtest/createCoreBattlePlaytest";
import { getCoreBattlePlaytestRulePackage } from "../../engine/rules/RulePackageSelector";
import { DecisionDNACodec } from "../../engine/ai/DecisionDNACodec";
import { GenomePolicy } from "../../engine/ai/GenomePolicy";
import { StateHasher } from "../../engine/simulation/StateHasher";
import {
  SemanticCanonicalSerializer,
  SemanticCanonicalSerializationError,
} from "../../engine/ai/SemanticCanonicalSerializer";
import { SemanticSHA256 } from "../../engine/ai/SemanticSHA256";
import { SemanticDynamicIdCanonicalizer } from "../../engine/ai/SemanticDynamicIdCanonicalizer";
import { SemanticFingerprintCalculator } from "../../engine/ai/SemanticFingerprintCalculator";
import { SemanticStallCycleDetector } from "../../engine/ai/SemanticStallCycleDetector";
import { GameSessionSideState } from "../../domain/ai/SemanticDiagnosticTypes";
import { DecisionRequest } from "../../domain/decision/DecisionRequest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Semantic Stall / Cycle Diagnostic V1 Production Suite (BP-SIM-AI-SEMANTIC-STALL-CYCLE-IMPL-V1)", () => {
  let catalog: RegulationCatalog;
  let rulePackage: RulePackage;

  beforeAll(async () => {
    catalog = await loadRegulationCatalog();
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  const setupLightEntry16Session = (seed: number): GameSession => {
    const reg = catalog.regulations.get("light-entry16");
    if (!reg) throw new Error("Regulation light-entry16 not found");
    const frame = catalog.frames.get(reg.frameId);
    if (!frame) throw new Error(`Frame ${reg.frameId} not found`);

    const outcome = OfficialRegulationMatchSetup.setupMatch(reg, frame, rulePackage, seed, {
      playerNames: { p1: "Diagnostic Player 1", p2: "Diagnostic Player 2" },
    });
    if (outcome.type !== "READY") {
      throw new Error(`Failed to setup match: ${outcome.reason}`);
    }

    return new GameSession(outcome.state, rulePackage, { matchSeed: seed });
  };

  // =========================================================================
  // 1. SemanticCanonicalSerializer & SemanticSHA256 Tests
  // =========================================================================
  describe("1. Canonical Serializer & SHA-256", () => {
    it("should sort object keys in ascending Unicode order and preserve array order", () => {
      const obj1 = { z: 1, a: [3, 1, 2], m: { k2: "foo", k1: "bar" } };
      const obj2 = { m: { k1: "bar", k2: "foo" }, a: [3, 1, 2], z: 1 };

      const json1 = SemanticCanonicalSerializer.serialize(obj1);
      const json2 = SemanticCanonicalSerializer.serialize(obj2);

      expect(json1).toBe(json2);
      expect(json1).toBe('{"a":[3,1,2],"m":{"k1":"bar","k2":"foo"},"z":1}');
    });

    it("should normalize -0 to 0 and serialize IEEE 754 floats with full precision", () => {
      const obj = { negZero: -0, floatVal: 0.1234567890123456, zero: 0 };
      const json = SemanticCanonicalSerializer.serialize(obj);

      expect(json).toBe('{"floatVal":0.1234567890123456,"negZero":0,"zero":0}');
    });

    it("should fail-closed on non-finite numbers (NaN, Infinity, -Infinity)", () => {
      expect(() => SemanticCanonicalSerializer.serialize({ v: NaN })).toThrow(
        SemanticCanonicalSerializationError
      );
      expect(() => SemanticCanonicalSerializer.serialize({ v: Infinity })).toThrow(
        SemanticCanonicalSerializationError
      );
      expect(() => SemanticCanonicalSerializer.serialize({ v: -Infinity })).toThrow(
        SemanticCanonicalSerializationError
      );
    });

    it("should match node crypto SHA-256 across multiple test vectors", () => {
      const testCases = [
        "",
        "hello world",
        '{"a":[1,2,3],"b":"日本語テスト","c":{"nested":true}}',
        "The quick brown fox jumps over the lazy dog",
        "Deterministic-Random-Seed-42-Long-String-Padding-Test-Vector-ABCDEFGHIJKLMN",
      ];

      for (const tc of testCases) {
        const expected = crypto.createHash("sha256").update(tc, "utf8").digest("hex");
        const actual = SemanticSHA256.hash(tc);
        expect(actual).toBe(expected);
        expect(actual).toHaveLength(64);
        expect(actual).toMatch(/^[0-9a-f]{64}$/);
      }
    });
  });

  // =========================================================================
  // 2. Dynamic ID Canonicalization & Topology Preservation Tests
  // =========================================================================
  describe("2. Dynamic ID Canonicalizer", () => {
    it("should map dynamic runtime IDs to sequential canonical IDs and preserve topology", () => {
      const ctx = SemanticDynamicIdCanonicalizer.createMappingContext();
      const rawUnitA = "unit-cost-17882348234123";
      const rawUnitB = "unit-cost-17882348234999";
      const rawReq = "req-trg-17882348234000";

      ctx.registerId(rawUnitA, "unit");
      ctx.registerId(rawUnitB, "unit");
      ctx.registerId(rawReq, "req");

      expect(ctx.resolveId(rawUnitA)).toBe("unit-cost#1");
      expect(ctx.resolveId(rawUnitB)).toBe("unit-cost#2");
      expect(ctx.resolveId(rawReq)).toBe("req-trg#1");

      // Distinct IDs are never collapsed (topology preservation)
      expect(ctx.resolveId(rawUnitA)).not.toBe(ctx.resolveId(rawUnitB));

      // Canonicalize nested structure with references
      const structure = {
        battle: {
          attackerUnitId: rawUnitA,
          blockerUnitId: rawUnitB,
        },
        originRequest: rawReq,
        staticId: "card.standard.spade_a",
      };

      const canonicalized = ctx.canonicalizeValue(structure);
      expect(canonicalized).toEqual({
        battle: {
          attackerUnitId: "unit-cost#1",
          blockerUnitId: "unit-cost#2",
        },
        originRequest: "req-trg#1",
        staticId: "card.standard.spade_a",
      });
    });
  });

  // =========================================================================
  // 3. 5 Canonical Fingerprints Format & Determinism Tests
  // =========================================================================
  describe("3. 5 Canonical Fingerprints Format", () => {
    it("should compute all 5 fingerprints with correct prefixes, lengths, and determinism", () => {
      const session = setupLightEntry16Session(42);
      const step = session.advance();
      expect(step.type).toBe("WAITING_FOR_DECISION");
      if (step.type !== "WAITING_FOR_DECISION") return;

      const sideState: GameSessionSideState = {
        consecutivePassCount: session.passTracker.consecutivePassCount,
        continuation: session.continuation,
        resolvingRequest: session.resolvingRequest,
        resolvingContext: session.resolvingContext,
      };

      const fps = SemanticFingerprintCalculator.computeAll(session.state, sideState, step.request);

      expect(fps.structural.startsWith("sgf1-")).toBe(true);
      expect(fps.structural).toHaveLength(69);

      expect(fps.structuralTurnInvariant.startsWith("sgf1-ti-")).toBe(true);
      expect(fps.structuralTurnInvariant).toHaveLength(72);

      expect(fps.observation.startsWith("pof1-")).toBe(true);
      expect(fps.observation).toHaveLength(69);

      expect(fps.decisionRequest.startsWith("drsf1-")).toBe(true);
      expect(fps.decisionRequest).toHaveLength(70);

      expect(fps.policyInput.startsWith("gpif1-")).toBe(true);
      expect(fps.policyInput).toHaveLength(70);

      // Re-computation on identical state produces byte-identical hashes
      const fps2 = SemanticFingerprintCalculator.computeAll(session.state, sideState, step.request);
      expect(fps2.structural).toBe(fps.structural);
      expect(fps2.structuralTurnInvariant).toBe(fps.structuralTurnInvariant);
      expect(fps2.observation).toBe(fps.observation);
      expect(fps2.decisionRequest).toBe(fps.decisionRequest);
      expect(fps2.policyInput).toBe(fps.policyInput);
    });
  });

  // =========================================================================
  // 4. Decision Request Semantic Fingerprint (drsf1) Sensitivity & Transparency
  // =========================================================================
  describe("4. drsf1 Semantic & Transparency Tests", () => {
    it("should produce identical drsf1 when only presentation labels change", () => {
      const session = setupLightEntry16Session(42);
      const step = session.advance();
      if (step.type !== "WAITING_FOR_DECISION") return;

      const originalRequest = step.request;
      const originalDrsf = SemanticFingerprintCalculator.computeDrsf1(originalRequest);

      // Deep clone request and mutate presentation labels
      const mutatedRequest: DecisionRequest = JSON.parse(JSON.stringify(originalRequest));
      if (mutatedRequest.catalog.actions?.length > 0) {
        (mutatedRequest.catalog.actions as any)[0].actionName = "MUTATED_DISPLAY_NAME";
      }
      if (mutatedRequest.catalog.targetSelections?.length > 0) {
        (mutatedRequest.catalog.targetSelections as any)[0].displayName = "MUTATED_TARGET_LABEL";
        (mutatedRequest.catalog.targetSelections as any)[0].primaryLabel = "MUTATED_PRIMARY";
        (mutatedRequest.catalog.targetSelections as any)[0].secondaryLabel = "MUTATED_SECONDARY";
      }
      if (mutatedRequest.catalog.cardSelections?.length > 0) {
        (mutatedRequest.catalog.cardSelections as any)[0].displayCodes = ["MUTATED_CODE"];
      }

      const mutatedDrsf = SemanticFingerprintCalculator.computeDrsf1(mutatedRequest);
      expect(mutatedDrsf).toBe(originalDrsf);
    });

    it("should produce different drsf1 when semantic action or speed changes", () => {
      const session = setupLightEntry16Session(42);
      const step = session.advance();
      if (step.type !== "WAITING_FOR_DECISION") return;

      const originalRequest = step.request;
      const originalDrsf = SemanticFingerprintCalculator.computeDrsf1(originalRequest);

      const mutatedRequest: DecisionRequest = JSON.parse(JSON.stringify(originalRequest));
      if (mutatedRequest.catalog.actions?.length > 0) {
        (mutatedRequest.catalog.actions as any)[0].actionId = "action.different_action";
      }

      const mutatedDrsf = SemanticFingerprintCalculator.computeDrsf1(mutatedRequest);
      expect(mutatedDrsf).not.toBe(originalDrsf);
    });
  });

  // =========================================================================
  // 5. Genome Policy Input Fingerprint (gpif1) Projection & Policy State Separation
  // =========================================================================
  describe("5. gpif1 Projection & Policy Independence", () => {
    it("should produce identical gpif1 regardless of DecisionDNA weights or metadata.id", () => {
      const session = setupLightEntry16Session(42);
      const step = session.advance();
      if (step.type !== "WAITING_FOR_DECISION") return;

      const gpif1 = SemanticFingerprintCalculator.computeGpif1(step.request);

      // Create two GenomePolicies with completely different DNA weights and metadata.id
      const dnaA = DecisionDNACodec.createZeroDecisionDNA({ id: "dna-alpha", author: "Author A" });
      const dnaB = DecisionDNACodec.createZeroDecisionDNA({ id: "dna-beta", author: "Author B" });
      (dnaB.patternWeights as number[])[0] = 0.999;
      (dnaB.contextPatternWeights as number[])[10] = -0.555;

      const policyA = new GenomePolicy(dnaA);
      const policyB = new GenomePolicy(dnaB);

      // Choosing with either policy does not alter the input fingerprint
      const respA = policyA.choose(step.request);
      const respB = policyB.choose(step.request);
      expect(respA).toBeDefined();
      expect(respB).toBeDefined();

      const gpifAfter = SemanticFingerprintCalculator.computeGpif1(step.request);
      expect(gpifAfter).toBe(gpif1);
    });

    it("should alter gpif1 if pattern ordering changes (order sensitivity for tie-break)", () => {
      const session = setupLightEntry16Session(42);
      const step = session.advance();
      if (step.type !== "WAITING_FOR_DECISION") return;

      if (step.request.patterns.length >= 2) {
        const originalGpif = SemanticFingerprintCalculator.computeGpif1(step.request);

        const reversedRequest: DecisionRequest = {
          ...step.request,
          patterns: [...step.request.patterns].reverse(),
        };

        const reversedGpif = SemanticFingerprintCalculator.computeGpif1(reversedRequest);
        expect(reversedGpif).not.toBe(originalGpif);
      }
    });
  });

  // =========================================================================
  // 6. Stage-Empty PASS Recurrence Canonical Example Test (Section 36.5)
  // =========================================================================
  describe("6. Stage-Empty PASS Recurrence Canonical Example Test", () => {
    it("should show sgf1(Snapshot 0) === sgf1(Snapshot 2) after 2-PASS in empty stage", () => {
      const session = setupLightEntry16Session(100);

      // Advance to first decision
      const step0 = session.advance();
      expect(step0.type).toBe("WAITING_FOR_DECISION");
      if (step0.type !== "WAITING_FOR_DECISION") return;

      expect(session.state.stage.requests).toHaveLength(0);
      expect(session.passTracker.consecutivePassCount).toBe(0);
      const turnPlayer0 = session.state.turnPlayer;
      const chancePlayer0 = session.state.chancePlayer;
      expect(turnPlayer0).toBe(chancePlayer0);

      // Snapshot 0
      const sideState0: GameSessionSideState = {
        consecutivePassCount: session.passTracker.consecutivePassCount,
        continuation: session.continuation,
        resolvingRequest: session.resolvingRequest,
        resolvingContext: session.resolvingContext,
      };
      const sgf1_0 = SemanticFingerprintCalculator.computeSgf1(session.state, sideState0);

      // Find PASS pattern for P1
      const p1PassIdx = step0.request.patterns.findIndex((p) => p.kind === "PASS");
      expect(p1PassIdx).toBeGreaterThanOrEqual(0);

      // P1 PASS
      const step1 = session.submitDecision({
        decisionId: step0.request.decisionId,
        stateVersion: step0.request.stateVersion,
        selectedPatternRef: p1PassIdx,
      });

      expect(step1.type).toBe("WAITING_FOR_DECISION");
      if (step1.type !== "WAITING_FOR_DECISION") return;

      // Snapshot 1 (P2 chance, passCount = 1)
      expect(session.passTracker.consecutivePassCount).toBe(1);
      const sideState1: GameSessionSideState = {
        consecutivePassCount: session.passTracker.consecutivePassCount,
        continuation: session.continuation,
        resolvingRequest: session.resolvingRequest,
        resolvingContext: session.resolvingContext,
      };
      const sgf1_1 = SemanticFingerprintCalculator.computeSgf1(session.state, sideState1);
      expect(sgf1_1).not.toBe(sgf1_0);

      // Find PASS pattern for P2
      const p2PassIdx = step1.request.patterns.findIndex((p) => p.kind === "PASS");
      expect(p2PassIdx).toBeGreaterThanOrEqual(0);

      // P2 PASS -> 2-PASS resolves empty stage -> passTracker resets -> chance returns to turnPlayer (P1)
      const step2 = session.submitDecision({
        decisionId: step1.request.decisionId,
        stateVersion: step1.request.stateVersion,
        selectedPatternRef: p2PassIdx,
      });

      expect(step2.type).toBe("WAITING_FOR_DECISION");
      if (step2.type !== "WAITING_FOR_DECISION") return;

      expect(session.passTracker.consecutivePassCount).toBe(0);
      expect(session.state.chancePlayer).toBe(turnPlayer0);

      // Snapshot 2
      const sideState2: GameSessionSideState = {
        consecutivePassCount: session.passTracker.consecutivePassCount,
        continuation: session.continuation,
        resolvingRequest: session.resolvingRequest,
        resolvingContext: session.resolvingContext,
      };
      const sgf1_2 = SemanticFingerprintCalculator.computeSgf1(session.state, sideState2);

      // Crucial verification: Snapshot 0 and Snapshot 2 have identical structural fingerprint!
      expect(sgf1_2).toBe(sgf1_0);
    });
  });

  // =========================================================================
  // 7. Full End Lifecycle Test (Section 36.6)
  // =========================================================================
  describe("7. Full End Lifecycle Test", () => {
    it("should show sgf1-ti updates properly as End, Charge, and Draw resolve", () => {
      // 36.6節設計に準拠した制御フィクスチャ (endChargeDrawChance.test.ts 整合)
      const soldierA = {
        unitId: "soldier-p1",
        componentId: "character.soldier",
        kind: "一般兵",
        state: "drive",
        cards: [{ id: "c1", suit: "S", rank: "5", value: 5 }],
        labels: ["攻撃", "防御"],
      };
      const soldierB = {
        unitId: "soldier-p2",
        componentId: "character.soldier",
        kind: "一般兵",
        state: "drive",
        cards: [{ id: "c2", suit: "H", rank: "5", value: 5 }],
        labels: ["攻撃", "防御"],
      };
      const fogA = {
        fogId: "fog-p1",
        componentId: "fog.up",
        card: { id: "up-c1", suit: "S", rank: "4", value: 4 },
      };
      const fogB = {
        fogId: "fog-p2",
        componentId: "fog.down",
        card: { id: "down-c2", suit: "H", rank: "3", value: 3 },
      };

      const controlledState: any = {
        matchId: "test-end-lifecycle",
        stateVersion: 1,
        turnCount: 1,
        turnPlayer: "p1",
        chancePlayer: "p1",
        players: {
          p1: {
            name: "Player A",
            life: [
              { id: "l1-1", suit: "S", rank: "2", value: 2 },
              { id: "l1-2", suit: "S", rank: "3", value: 3 },
            ],
            hand: [],
            field: [soldierA],
            fog: [fogA],
            grave: [],
          },
          p2: {
            name: "Player B",
            life: [
              { id: "l2-1", suit: "H", rank: "2", value: 2 },
              { id: "l2-2", suit: "H", rank: "3", value: 3 },
              { id: "l2-3", suit: "H", rank: "4", value: 4 },
            ],
            hand: [],
            field: [soldierB],
            fog: [fogB],
            grave: [],
          },
        },
        stage: { requests: [], history: [] },
        requestBuffer: { requests: [], history: [] },
      };

      const session = new GameSession(controlledState, rulePackage);

      // Snapshot 0: Initial state before action.end
      const step0 = session.advance();
      expect(step0.type).toBe("WAITING_FOR_DECISION");
      if (step0.type !== "WAITING_FOR_DECISION") return;

      const sideState0: GameSessionSideState = {
        consecutivePassCount: session.passTracker.consecutivePassCount,
      };
      const initialSgf1Ti = SemanticFingerprintCalculator.computeSgf1Ti(session.state, sideState0);

      // A. P1 requests action.end
      const endPatternIdx = step0.request.patterns.findIndex(
        (p) => p.kind === "ACTION" && step0.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.end"
      );
      expect(endPatternIdx).toBeGreaterThanOrEqual(0);

      const afterEndReq = session.submitDecision({
        decisionId: step0.request.decisionId,
        stateVersion: step0.request.stateVersion,
        selectedPatternRef: endPatternIdx,
      });
      expect(afterEndReq.type).toBe("WAITING_FOR_DECISION");
      if (afterEndReq.type !== "WAITING_FOR_DECISION") return;

      // B. P1 PASS -> chance goes to P2
      const p1PassIdx = afterEndReq.request.patterns.findIndex((p) => p.kind === "PASS");
      expect(p1PassIdx).toBeGreaterThanOrEqual(0);
      const afterP1Pass = session.submitDecision({
        decisionId: afterEndReq.request.decisionId,
        stateVersion: afterEndReq.request.stateVersion,
        selectedPatternRef: p1PassIdx,
      });
      expect(afterP1Pass.type).toBe("WAITING_FOR_DECISION");
      if (afterP1Pass.type !== "WAITING_FOR_DECISION") return;
      expect(afterP1Pass.request.playerId).toBe("p2");

      // C, D, E, F: P2 PASS -> 2-PASS resolves action.end -> Turn increments -> Charge resolves -> Draw staged!
      const p2PassIdx = afterP1Pass.request.patterns.findIndex((p) => p.kind === "PASS");
      expect(p2PassIdx).toBeGreaterThanOrEqual(0);
      const afterEndResolved = session.submitDecision({
        decisionId: afterP1Pass.request.decisionId,
        stateVersion: afterP1Pass.request.stateVersion,
        selectedPatternRef: p2PassIdx,
      });
      expect(afterEndResolved.type).toBe("WAITING_FOR_DECISION");
      if (afterEndResolved.type !== "WAITING_FOR_DECISION") return;

      // D. Turn changed to 2, turnPlayer is p2
      expect(session.state.turnCount).toBe(2);
      expect(session.state.turnPlayer).toBe("p2");

      // C. Fogs moved to graves
      expect(session.state.players.p1.fog).toHaveLength(0);
      expect(session.state.players.p1.grave).toHaveLength(1);
      expect(session.state.players.p2.fog).toHaveLength(0);
      expect(session.state.players.p2.grave).toHaveLength(1);

      // E. Charge immediate resolved -> p2 unit charged
      expect(session.state.players.p2.field[0].state).toBe("charge");

      // F. Draw staged on Stage
      expect(session.state.stage.requests[0]?.actionId).toBe("action.draw");

      // S2 fingerprint has changed due to fog, charge, stage mutations
      const sideStateAfterEnd: GameSessionSideState = {
        consecutivePassCount: session.passTracker.consecutivePassCount,
      };
      const afterEndSgf1Ti = SemanticFingerprintCalculator.computeSgf1Ti(session.state, sideStateAfterEnd);
      expect(afterEndSgf1Ti).not.toBe(initialSgf1Ti);

      // G. Resolve Draw via 2-PASS (P2 PASS -> P1 PASS)
      const p2DrawPassIdx = afterEndResolved.request.patterns.findIndex((p) => p.kind === "PASS");
      const afterP2DrawPass = session.submitDecision({
        decisionId: afterEndResolved.request.decisionId,
        stateVersion: afterEndResolved.request.stateVersion,
        selectedPatternRef: p2DrawPassIdx,
      });
      expect(afterP2DrawPass.type).toBe("WAITING_FOR_DECISION");
      if (afterP2DrawPass.type !== "WAITING_FOR_DECISION") return;

      const p1DrawPassIdx = afterP2DrawPass.request.patterns.findIndex((p) => p.kind === "PASS");
      const afterDrawResolved = session.submitDecision({
        decisionId: afterP2DrawPass.request.decisionId,
        stateVersion: afterP2DrawPass.request.stateVersion,
        selectedPatternRef: p1DrawPassIdx,
      });
      expect(afterDrawResolved.type).toBe("WAITING_FOR_DECISION");

      // Cards moved from life to hand for P2
      expect(session.state.players.p2.hand).toHaveLength(2);
      expect(session.state.players.p2.life).toHaveLength(1);

      const sideStateAfterDraw: GameSessionSideState = {
        consecutivePassCount: session.passTracker.consecutivePassCount,
      };
      const afterDrawSgf1Ti = SemanticFingerprintCalculator.computeSgf1Ti(session.state, sideStateAfterDraw);
      expect(afterDrawSgf1Ti).not.toBe(afterEndSgf1Ti);
      expect(afterDrawSgf1Ti).not.toBe(initialSgf1Ti);
    });
  });

  // =========================================================================
  // 8. Turn-Invariant Recurrence Controlled Fixture Test (Section 36.7)
  // =========================================================================
  describe("8. Turn-Invariant Recurrence Controlled Fixture Test", () => {
    it("should show sgf1 differs but sgf1-ti matches when only turnCount differs", () => {
      const session = setupLightEntry16Session(42);
      session.advance();

      const stateTurn1 = JSON.parse(JSON.stringify(session.state));
      stateTurn1.turnCount = 1;

      const stateTurn2 = JSON.parse(JSON.stringify(session.state));
      stateTurn2.turnCount = 2;

      const sideState: GameSessionSideState = { consecutivePassCount: 0 };

      const s1_turn1 = SemanticFingerprintCalculator.computeSgf1(stateTurn1, sideState);
      const s1_turn2 = SemanticFingerprintCalculator.computeSgf1(stateTurn2, sideState);

      const s2_turn1 = SemanticFingerprintCalculator.computeSgf1Ti(stateTurn1, sideState);
      const s2_turn2 = SemanticFingerprintCalculator.computeSgf1Ti(stateTurn2, sideState);

      // S1 (Turn-Aware) must differ
      expect(s1_turn1).not.toBe(s1_turn2);

      // S2 (Turn-Invariant) must match 100%!
      expect(s2_turn1).toBe(s2_turn2);
    });
  });

  // =========================================================================
  // 9. PRE_DECISION Sampling & Trace Record Completeness Tests
  // =========================================================================
  describe("9. PRE_DECISION Simultaneous Sampling", () => {
    it("should capture all 5 fingerprints simultaneously at PRE_DECISION boundary", () => {
      const session = setupLightEntry16Session(42);
      const policies = {
        p1: new FirstLegalPolicy(false),
        p2: new FirstLegalPolicy(false),
      };

      const result = SimulationRunner.run(session, policies, {
        maxDecisions: 10,
        enableSemanticDiagnostics: true,
      });

      expect(result.semanticDiagnostics).toBeDefined();
      const diag = result.semanticDiagnostics!;
      expect(diag.traces.length).toBeGreaterThan(0);

      for (const record of diag.traces) {
        expect(record.boundary).toBe("PRE_DECISION");
        expect(record.fingerprints.structural.startsWith("sgf1-")).toBe(true);
        expect(record.fingerprints.structuralTurnInvariant.startsWith("sgf1-ti-")).toBe(true);
        expect(record.fingerprints.observation.startsWith("pof1-")).toBe(true);
        expect(record.fingerprints.decisionRequest.startsWith("drsf1-")).toBe(true);
        expect(record.fingerprints.policyInput.startsWith("gpif1-")).toBe(true);

        expect(record.selectedDecision.selectedPatternRef).toBeGreaterThanOrEqual(0);
        expect(record.selectedDecision.selectedLogicalPatternKey).toBeDefined();
        expect(record.diagnostics.signal).toBeDefined();
      }
    });
  });

  // =========================================================================
  // 10. Passive Observer 100% Deterministic Parity Test
  // =========================================================================
  describe("10. Passive Observer Parity Contract", () => {
    it("should produce 100% byte-identical simulation outcomes when diagnostic is OFF vs ON", () => {
      const playtestRulePackage = getCoreBattlePlaytestRulePackage(rulePackage);
      const SEED_P1 = 1001;
      const SEED_P2 = 2002;

      // Run A: Diagnostic OFF
      const stateA = createCoreBattlePresetState();
      const sessionA = new GameSession(stateA, playtestRulePackage);
      const policiesA = {
        p1: new RandomPolicy(new SeededRandom(SEED_P1)),
        p2: new RandomPolicy(new SeededRandom(SEED_P2)),
      };
      const resultOff = SimulationRunner.run(sessionA, policiesA, {
        maxDecisions: 100,
        enableSemanticDiagnostics: false,
      });

      // Run B: Diagnostic ON
      const stateB = createCoreBattlePresetState();
      const sessionB = new GameSession(stateB, playtestRulePackage);
      const policiesB = {
        p1: new RandomPolicy(new SeededRandom(SEED_P1)),
        p2: new RandomPolicy(new SeededRandom(SEED_P2)),
      };
      const resultOn = SimulationRunner.run(sessionB, policiesB, {
        maxDecisions: 100,
        enableSemanticDiagnostics: true,
      });

      expect(resultOff.semanticDiagnostics).toBeUndefined();
      expect(resultOn.semanticDiagnostics).toBeDefined();

      // Core outcome parity
      expect(resultOn.completed).toBe(resultOff.completed);
      expect(resultOn.winner).toBe(resultOff.winner);
      expect(resultOn.reason).toBe(resultOff.reason);
      expect(resultOn.totalDecisions).toBe(resultOff.totalDecisions);
      expect(resultOn.turnCount).toBe(resultOff.turnCount);
      expect(resultOn.finalStateHash).toBe(resultOff.finalStateHash);

      // Decision trace logical parity (matching seededDeterminism test pattern)
      expect(resultOn.decisionTrace.length).toBe(resultOff.decisionTrace.length);
      for (let i = 0; i < resultOff.decisionTrace.length; i++) {
        const traceOff = resultOff.decisionTrace[i];
        const traceOn = resultOn.decisionTrace[i];

        expect(traceOn.stepCount).toBe(traceOff.stepCount);
        expect(traceOn.playerId).toBe(traceOff.playerId);
        expect(traceOn.stateVersion).toBe(traceOff.stateVersion);
        expect(traceOn.logicalDecisionId).toBe(traceOff.logicalDecisionId);
        expect(traceOn.stateHash).toBe(traceOff.stateHash);
        expect(traceOn.selectedPatternRef).toBe(traceOff.selectedPatternRef);
        expect(traceOn.selectedLogicalPatternKey).toBe(traceOff.selectedLogicalPatternKey);
        expect(traceOn.selectedPatternKind).toBe(traceOff.selectedPatternKind);
      }
    });

    it("should preserve completed: false (INCOMPLETE) when maxDecisions is reached", () => {
      const session = setupLightEntry16Session(12345);
      const policies = {
        p1: new FirstLegalPolicy(false),
        p2: new FirstLegalPolicy(false),
      };

      const result = SimulationRunner.run(session, policies, {
        maxDecisions: 5,
        enableSemanticDiagnostics: true,
      });

      expect(result.completed).toBe(false);
      expect(result.totalDecisions).toBe(5);
      expect(result.reason).toContain("最大判断回数 (5) に到達しました。");
      expect(result.semanticDiagnostics).toBeDefined();
    });
  });
});
