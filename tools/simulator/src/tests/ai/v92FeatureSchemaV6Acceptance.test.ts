import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import {
  CONTEXT_FEATURE_DIMENSION,
  PATTERN_FEATURE_DIMENSION,
  DECISION_FEATURE_TOTAL_DIMENSION,
  FEATURE_SCHEMA_VERSION,
  CONTEXT_FEATURE_NAMES,
  PATTERN_FEATURE_NAMES,
} from "../../domain/ai/DecisionFeatureTypes";
import {
  CONTEXT_SCALING_RULES,
  PATTERN_SCALING_RULES,
  FEATURE_SCALING_SCHEMA_VERSION,
} from "../../domain/ai/DecisionFeatureScalingRegistry";
import {
  DecisionDNA,
  DecisionDNAValidationError,
  DNA_FORMAT_VERSION,
  DNA_CONTEXT_DIMENSION,
  DNA_PATTERN_DIMENSION,
  DNA_INTERACTION_DIMENSION,
  DNA_TOTAL_WEIGHTS,
} from "../../domain/ai/DecisionDNATypes";
import { DecisionDNACodec } from "../../engine/ai/DecisionDNACodec";
import { DecisionDNALegacyValidator } from "../../engine/ai/DecisionDNALegacyValidator";
import { DecisionDNAMigration } from "../../engine/ai/DecisionDNAMigration";
import { DecisionFeatureEncoder } from "../../engine/ai/DecisionFeatureEncoder";
import { DecisionFeatureScaler } from "../../engine/ai/DecisionFeatureScaler";
import { GenomeScorer } from "../../engine/ai/GenomeScorer";
import { GenomePolicy } from "../../engine/ai/GenomePolicy";
import { SemanticFingerprintCalculator } from "../../engine/ai/SemanticFingerprintCalculator";
import { SimulationRunner } from "../../engine/simulation/SimulationRunner";
import { DecisionRequest } from "../../domain/decision/DecisionRequest";
import { PlayerObservation, PlayerObservationView } from "../../domain/decision/PlayerObservation";
import { DecisionCatalog } from "../../domain/decision/DecisionCatalog";
import { LegalPattern } from "../../domain/decision/LegalPattern";
import { loadRegulationCatalog } from "../../engine/regulation/RegulationLoader";
import { OfficialRegulationMatchFactory } from "../../engine/regulation/OfficialRegulationMatchFactory";
import { RegulationValidator } from "../../engine/regulation/RegulationValidator";
import { RegulationRulePackageSelector } from "../../engine/regulation/RegulationRulePackageSelector";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Feature Schema v6 & Semantic Diagnostic v2 Acceptance Suite (BP-SIM-AI-V92-FEATURE-SCHEMA-V6-IMPL-V1)", () => {
  let fullRulePackage: any;
  let lightSessionFactory: any;

  beforeAll(async () => {
    const catalog = await loadRegulationCatalog();
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    fullRulePackage = await loadRulePackageFromDirectory(rulesDir);

    const validation = RegulationValidator.validateRegulation(catalog, "light-entry16", { assertImplemented: true });
    lightSessionFactory = await OfficialRegulationMatchFactory.prepareSessionFactory("light-entry16", {
      catalog,
      fullRulePackage,
    });
  });

  const createSyntheticV5DNA = (): DecisionDNA => {
    const pWeights = new Array<number>(143).fill(0).map((_, i) => ((i * 0.05) % 1.0));
    const cpWeights = new Array<number>(163 * 143).fill(0).map((_, i) => ((i * 0.01) % 2.0) - 1.0);
    return {
      dnaFormatVersion: 1,
      featureSchemaVersion: 5,
      scoringModel: "linear-bilinear-v1",
      contextDimension: 163,
      patternDimension: 143,
      patternWeights: pWeights,
      contextPatternWeights: cpWeights,
      metadata: {
        id: "dna-v5-golden",
        name: "Golden V5 DNA",
        generation: 10,
        fitness: 42.5,
      },
    };
  };

  const createSyntheticPlayerView = (playerId: "p1" | "p2", isViewer: boolean): PlayerObservationView => ({
    playerId,
    name: playerId === "p1" ? "Player 1" : "Player 2",
    isViewer,
    lifeCount: 5,
    lifeDisplay: "5",
    handCount: 3,
    handCards: [],
    field: [],
    fog: [],
    trumps: [],
    graveCount: 0,
    grave: [],
    canViewFullGrave: isViewer,
  });

  const createSyntheticRequest = (focusPlayerId?: "p1" | "p2" | "invalid" | "system", viewerId: "p1" | "p2" = "p1"): DecisionRequest => {
    const p1View = createSyntheticPlayerView("p1", viewerId === "p1");
    const p2View = createSyntheticPlayerView("p2", viewerId === "p2");
    const observation: PlayerObservation = {
      viewerPlayerId: viewerId,
      turnPlayerId: "p1",
      chancePlayerId: "p1",
      focusPlayerId: (focusPlayerId as any),
      turnCount: 2,
      players: [p1View, p2View],
      stageRequestRefs: [],
      stageRequests: [],
      recentEvents: [],
    };
    const patterns: LegalPattern[] = [
      { patternId: "pat-act-0", kind: "ACTION", actionSelectionRef: 0 },
      { patternId: "pat-pass-1", kind: "PASS" },
    ];
    const catalog: DecisionCatalog = {
      actions: [{ actionId: "action.test", actionName: "Test Action", timing: "main", speed: "normal" }],
      cardSelections: [],
      unitSelections: [],
      costPayments: [],
      targetSelections: [],
      effectSelections: [],
      orderSelections: [],
    };
    return {
      matchId: "acc-m1",
      decisionId: "acc-d1",
      protocolVersion: "1",
      stateVersion: 1,
      playerId: viewerId,
      source: { type: "ACTION_REQUEST", playerId: viewerId },
      observation,
      patterns,
      catalog,
    };
  };

  // 1. v5 Legacy Validation
  it("Test 1: v5 Legacy Validation - DecisionDNALegacyValidator.validateV5 accepts valid v5 DNA", () => {
    const v5Dna = createSyntheticV5DNA();
    expect(() => DecisionDNALegacyValidator.validateV5(v5Dna)).not.toThrow();
  });

  // 2. v5 Direct Runtime Rejection
  it("Test 2: v5 Direct Runtime Rejection - DecisionDNACodec.validate immediately rejects v5 DNA in Schema v6 runtime", () => {
    const v5Dna = createSyntheticV5DNA();
    expect(() => DecisionDNACodec.validate(v5Dna)).toThrow(DecisionDNAValidationError);
    try {
      DecisionDNACodec.validate(v5Dna);
    } catch (err: any) {
      expect(err.message).toContain("featureSchemaVersion");
    }
  });

  // 3. v5 -> v6 Deterministic Migration
  it("Test 3: v5 -> v6 Deterministic Migration - identical v5 DNA migrated twice yields bit-exact matching objects and JSON", () => {
    const v5Dna = createSyntheticV5DNA();
    const v6A = DecisionDNAMigration.migrateV5toV6(v5Dna);
    const v6B = DecisionDNAMigration.migrateV5toV6(v5Dna);

    expect(v6A).toEqual(v6B);
    expect(JSON.stringify(v6A)).toBe(JSON.stringify(v6B));
    expect(() => DecisionDNACodec.validate(v6A)).not.toThrow();
  });

  // 4. DNA Metadata Preservation
  it("Test 4: DNA Metadata Preservation - retains existing metadata fields and attaches deterministic static provenance", () => {
    const v5Dna = createSyntheticV5DNA();
    const v6 = DecisionDNAMigration.migrateV5toV6(v5Dna);

    expect(v6.metadata?.id).toBe("dna-v5-golden");
    expect(v6.metadata?.name).toBe("Golden V5 DNA");
    expect(v6.metadata?.generation).toBe(10);
    expect(v6.metadata?.fitness).toBe(42.5);
    expect(v6.metadata?.migratedFromSchema).toBe(5);
    expect(v6.metadata?.migrationRule).toBe("v5-to-v6-zero-init-v1");
  });

  // 5. Full Weight Exact Equality
  it("Test 5: Full Weight Exact Equality - pattern weights and interaction weights for rows 0..162 are 100% equal to v5", () => {
    const v5Dna = createSyntheticV5DNA();
    const v6 = DecisionDNAMigration.migrateV5toV6(v5Dna);

    for (let j = 0; j < 143; j++) {
      expect(v6.patternWeights[j]).toBe(v5Dna.patternWeights[j]);
    }

    for (let i = 0; i < 163 * 143; i++) {
      expect(v6.contextPatternWeights[i]).toBe(v5Dna.contextPatternWeights[i]);
    }
  });

  // 6. Row-Major Mapping
  it("Test 6: Row-Major Mapping - weights for context feature i are placed at index i * 143 + p", () => {
    const v5Dna = createSyntheticV5DNA();
    const v6 = DecisionDNAMigration.migrateV5toV6(v5Dna);

    for (let c = 0; c < 163; c++) {
      const rowOffset = c * 143;
      for (let p = 0; p < 143; p++) {
        expect(v6.contextPatternWeights[rowOffset + p]).toBe(v5Dna.contextPatternWeights[rowOffset + p]);
      }
    }
  });

  // 7. Zero Initialized Rows
  it("Test 7: Zero Initialized Rows - rows 163 and 164 (286 weights) are strictly 0.0", () => {
    const v5Dna = createSyntheticV5DNA();
    const v6 = DecisionDNAMigration.migrateV5toV6(v5Dna);

    expect(v6.contextPatternWeights.length).toBe(165 * 143);
    for (let c = 163; c < 165; c++) {
      const rowOffset = c * 143;
      for (let p = 0; p < 143; p++) {
        expect(v6.contextPatternWeights[rowOffset + p]).toBe(0.0);
      }
    }
  });

  // 8. All-Pattern Scoring Parity
  it("Test 8: All-Pattern Scoring Parity - all patterns score bit-exact (=== in IEEE 754) between v5 and migrated v6", () => {
    const v5Dna = createSyntheticV5DNA();
    const v6Dna = DecisionDNAMigration.migrateV5toV6(v5Dna);

    const req = createSyntheticRequest("p1");
    const encodedV6 = DecisionFeatureEncoder.encode(req);

    // Compute score using GenomeScorer for v6
    const scoredV6 = GenomeScorer.score(encodedV6, v6Dna);

    // Compute expected score under v5 formula using first 163 context features
    const cValues = encodedV6.context.values;
    for (const pat of encodedV6.patterns) {
      let scoreV5 = 0;
      for (let j = 0; j < 143; j++) {
        scoreV5 += v5Dna.patternWeights[j] * pat.values[j];
      }
      for (let i = 0; i < 163; i++) {
        const c_i = cValues[i];
        if (c_i === 0) continue;
        const rowOffset = i * 143;
        for (let j = 0; j < 143; j++) {
          const p_j = pat.values[j];
          if (p_j === 0) continue;
          scoreV5 += v5Dna.contextPatternWeights[rowOffset + j] * c_i * p_j;
        }
      }

      const matchingV6 = scoredV6.find((s) => s.patternRef === pat.patternRef);
      expect(matchingV6).toBeDefined();
      expect(matchingV6!.score).toBe(scoreV5);
    }
  });

  // 9. Argmax / First-Encountered Tie-Break Parity
  it("Test 9: Argmax / First-Encountered Tie-Break Parity - strictly selects first encountered maximum pattern when scores tie", () => {
    const zeroDna = DecisionDNACodec.createZeroDecisionDNA();
    const policy = new GenomePolicy(zeroDna);
    const req = createSyntheticRequest("p1");

    // Case 9-A: Explicit patternRef candidate order [7, 2] with tie scores (0.0)
    // Verifies design requirement: candidate with patternRef = 7 appears first, selectedPatternRef === 7
    const tieReq72: DecisionRequest = {
      ...req,
      patterns: [
        { patternId: "pat-7", kind: "ACTION", actionSelectionRef: 0, patternRef: 7 } as any,
        { patternId: "pat-2", kind: "PASS", patternRef: 2 } as any,
      ],
    };
    const resp72 = policy.choose(tieReq72);
    expect(resp72.selectedPatternRef).toBe(7);

    // Case 9-B: Reversed candidate order [2, 7] with tie scores (0.0)
    // Verifies that it strictly selects first-encountered candidate (2), not minimum patternRef
    const tieReq27: DecisionRequest = {
      ...req,
      patterns: [
        { patternId: "pat-2", kind: "PASS", patternRef: 2 } as any,
        { patternId: "pat-7", kind: "ACTION", actionSelectionRef: 0, patternRef: 7 } as any,
      ],
    };
    const resp27 = policy.choose(tieReq27);
    expect(resp27.selectedPatternRef).toBe(2);

    // Case 9-C: Standard LegalPattern without explicit patternRef property (defaults to array index i)
    // Candidate order [patA, patB] -> index 0 (patA) is chosen
    const tieReqStandardAB: DecisionRequest = {
      ...req,
      patterns: [
        { patternId: "pat-act-A", kind: "ACTION", actionSelectionRef: 0 },
        { patternId: "pat-pass-B", kind: "PASS" },
      ],
    };
    const respStandardAB = policy.choose(tieReqStandardAB);
    expect(respStandardAB.selectedPatternRef).toBe(0);

    // Case 9-D: Reversed standard candidate order [patB, patA] -> index 0 (patB) is chosen
    const tieReqStandardBA: DecisionRequest = {
      ...req,
      patterns: [
        { patternId: "pat-pass-B", kind: "PASS" },
        { patternId: "pat-act-A", kind: "ACTION", actionSelectionRef: 0 },
      ],
    };
    const respStandardBA = policy.choose(tieReqStandardBA);
    expect(respStandardBA.selectedPatternRef).toBe(0);
  });

  // 10. Focus Self / Opponent / System Activation
  it("Test 10: Focus Self / Opponent / System Activation - encodes (1, 0) for self, (0, 1) for opponent under system chance", () => {
    // 10-A: focus = self
    const reqSelf = createSyntheticRequest("p1", "p1");
    const encSelf = DecisionFeatureEncoder.encode(reqSelf);
    expect(encSelf.context.values[163]).toBe(1);
    expect(encSelf.context.values[164]).toBe(0);

    // 10-B: focus = opponent
    const reqOpp = createSyntheticRequest("p2", "p1");
    const encOpp = DecisionFeatureEncoder.encode(reqOpp);
    expect(encOpp.context.values[163]).toBe(0);
    expect(encOpp.context.values[164]).toBe(1);

    // 10-C: chancePlayer === "system"
    const reqSystemChance: DecisionRequest = {
      ...reqSelf,
      observation: {
        ...reqSelf.observation,
        chancePlayerId: "system",
      },
    };
    const encSystem = DecisionFeatureEncoder.encode(reqSystemChance);
    expect(encSystem.context.values[163]).toBe(1);
    expect(encSystem.context.values[164]).toBe(0);
  });

  // 11. Focus Missing / Invalid Fail-Closed
  it("Test 11: Focus Missing / Invalid Fail-Closed - encodes (0, 0) for undefined, invalid, or system focus", () => {
    // 11-A: focus = undefined
    const reqUndef = createSyntheticRequest(undefined, "p1");
    const encUndef = DecisionFeatureEncoder.encode(reqUndef);
    expect(encUndef.context.values[163]).toBe(0);
    expect(encUndef.context.values[164]).toBe(0);

    // 11-B: focus = "invalid"
    const reqInvalid = createSyntheticRequest("invalid", "p1");
    const encInvalid = DecisionFeatureEncoder.encode(reqInvalid);
    expect(encInvalid.context.values[163]).toBe(0);
    expect(encInvalid.context.values[164]).toBe(0);

    // 11-C: focus = "system" (not a valid player)
    const reqSysFocus = createSyntheticRequest("system", "p1");
    const encSysFocus = DecisionFeatureEncoder.encode(reqSysFocus);
    expect(encSysFocus.context.values[163]).toBe(0);
    expect(encSysFocus.context.values[164]).toBe(0);
  });

  // 12. Seat Swap Symmetry
  it("Test 12: Seat Swap Symmetry - focus features mirror symmetrically between p1 and p2 viewpoints", () => {
    // When focus is p1:
    // p1 viewer sees self=1, opp=0
    const encP1 = DecisionFeatureEncoder.encode(createSyntheticRequest("p1", "p1"));
    expect(encP1.context.values[163]).toBe(1);
    expect(encP1.context.values[164]).toBe(0);

    // p2 viewer sees self=0, opp=1
    const encP2 = DecisionFeatureEncoder.encode(createSyntheticRequest("p1", "p2"));
    expect(encP2.context.values[163]).toBe(0);
    expect(encP2.context.values[164]).toBe(1);
  });

  // 13. Registry 308 Entries
  it("Test 13: Registry 308 Entries - canonical registry has exactly 165 context and 143 pattern features (total 308)", () => {
    const regPath = path.resolve(__dirname, "../../../docs/ai-v92-feature-schema-v6-registry-v1.json");
    const reg = JSON.parse(fs.readFileSync(regPath, "utf-8"));

    expect(reg.schemaVersion).toBe(6);
    expect(reg.summary.totalFeatures).toBe(308);
    expect(reg.contextFeatures.length).toBe(165);
    expect(reg.patternFeatures.length).toBe(143);
    expect(CONTEXT_FEATURE_DIMENSION).toBe(165);
    expect(PATTERN_FEATURE_DIMENSION).toBe(143);
    expect(DECISION_FEATURE_TOTAL_DIMENSION).toBe(308);
  });

  // 14. Registry Compatibility Fields
  it("Test 14: Registry Compatibility Fields - existing 306 features specify compatibility for Schema >= 5", () => {
    const regPath = path.resolve(__dirname, "../../../docs/ai-v92-feature-schema-v6-registry-v1.json");
    const reg = JSON.parse(fs.readFileSync(regPath, "utf-8"));

    for (let i = 0; i < 163; i++) {
      expect(reg.contextFeatures[i].schemaCompatibilityImpact).toContain("Valid for FEATURE_SCHEMA_VERSION >= 5 (including Schema v6)");
    }
    for (let i = 0; i < 143; i++) {
      expect(reg.patternFeatures[i].schemaCompatibilityImpact).toContain("Valid for FEATURE_SCHEMA_VERSION >= 5 (including Schema v6)");
    }
    expect(reg.contextFeatures[163].schemaCompatibilityImpact).toContain("Introduced in FEATURE_SCHEMA_VERSION = 6");
    expect(reg.contextFeatures[164].schemaCompatibilityImpact).toContain("Introduced in FEATURE_SCHEMA_VERSION = 6");
  });

  // 15. Identity Scaling
  it("Test 15: Identity Scaling - context features 163 and 164 perform identity scaling in [0, 1]", () => {
    expect(CONTEXT_SCALING_RULES[163].scalingClass).toBe("BOOLEAN");
    expect(CONTEXT_SCALING_RULES[163].scalingFunction).toBe("identity");
    expect(CONTEXT_SCALING_RULES[163].outputDomain).toBe("[0, 1]");

    expect(CONTEXT_SCALING_RULES[164].scalingClass).toBe("BOOLEAN");
    expect(CONTEXT_SCALING_RULES[164].scalingFunction).toBe("identity");
    expect(CONTEXT_SCALING_RULES[164].outputDomain).toBe("[0, 1]");

    const raw = new Array<number>(165).fill(0);
    raw[163] = 1;
    raw[164] = 0;
    const scaled = DecisionFeatureScaler.scaleContext(raw);
    expect(scaled[163]).toBe(1.0);
    expect(scaled[164]).toBe(0.0);
  });

  // 16. Old 306 Scaling Rules Unchanged
  it("Test 16: Old 306 Scaling Rules Unchanged - 163 context and 143 pattern rules remain identical to v5 registry", () => {
    const v5RegPath = path.resolve(__dirname, "../../../docs/ai-feature-scaling-registry-v1-r2.json");
    const v6RegPath = path.resolve(__dirname, "../../../docs/ai-v92-feature-schema-v6-registry-v1.json");

    const v5Reg = JSON.parse(fs.readFileSync(v5RegPath, "utf-8"));
    const v6Reg = JSON.parse(fs.readFileSync(v6RegPath, "utf-8"));

    for (let i = 0; i < 163; i++) {
      expect(v6Reg.contextFeatures[i].name).toBe(v5Reg.contextFeatures[i].name);
      expect(v6Reg.contextFeatures[i].scalingClass).toBe(v5Reg.contextFeatures[i].scalingClass);
      expect(v6Reg.contextFeatures[i].scalingFunction).toBe(v5Reg.contextFeatures[i].scalingFunction);
      expect(v6Reg.contextFeatures[i].outputDomain).toBe(v5Reg.contextFeatures[i].outputDomain);
      expect(v6Reg.contextFeatures[i].parameter).toEqual(v5Reg.contextFeatures[i].parameter);

      expect(CONTEXT_SCALING_RULES[i].scalingClass).toBe(v5Reg.contextFeatures[i].scalingClass);
      expect(CONTEXT_SCALING_RULES[i].scalingFunction).toBe(v5Reg.contextFeatures[i].scalingFunction);
      expect(CONTEXT_SCALING_RULES[i].outputDomain).toBe(v5Reg.contextFeatures[i].outputDomain);
    }

    for (let i = 0; i < 143; i++) {
      expect(v6Reg.patternFeatures[i].name).toBe(v5Reg.patternFeatures[i].name);
      expect(v6Reg.patternFeatures[i].scalingClass).toBe(v5Reg.patternFeatures[i].scalingClass);
      expect(v6Reg.patternFeatures[i].scalingFunction).toBe(v5Reg.patternFeatures[i].scalingFunction);
      expect(v6Reg.patternFeatures[i].outputDomain).toBe(v5Reg.patternFeatures[i].outputDomain);
      expect(v6Reg.patternFeatures[i].parameter).toEqual(v5Reg.patternFeatures[i].parameter);

      expect(PATTERN_SCALING_RULES[i].scalingClass).toBe(v5Reg.patternFeatures[i].scalingClass);
      expect(PATTERN_SCALING_RULES[i].scalingFunction).toBe(v5Reg.patternFeatures[i].scalingFunction);
      expect(PATTERN_SCALING_RULES[i].outputDomain).toBe(v5Reg.patternFeatures[i].outputDomain);
    }
  });

  // 17. pof2 / drsf2 / gpif2 Focus Sensitivity
  it("Test 17: pof2 / drsf2 / gpif2 Focus Sensitivity - pof2, drsf2, gpif2 change strictly when only focusPlayer changes", () => {
    const reqA = createSyntheticRequest("p1");
    const reqB = createSyntheticRequest("p2");

    const pof2_A = SemanticFingerprintCalculator.computePof2(reqA.observation);
    const pof2_B = SemanticFingerprintCalculator.computePof2(reqB.observation);
    expect(pof2_A).not.toBe(pof2_B);
    expect(pof2_A.startsWith("pof2-")).toBe(true);

    const drsf2_A = SemanticFingerprintCalculator.computeDrsf2(reqA);
    const drsf2_B = SemanticFingerprintCalculator.computeDrsf2(reqB);
    expect(drsf2_A).not.toBe(drsf2_B);
    expect(drsf2_A.startsWith("drsf2-")).toBe(true);

    const gpif2_A = SemanticFingerprintCalculator.computeGpif2(reqA);
    const gpif2_B = SemanticFingerprintCalculator.computeGpif2(reqB);
    expect(gpif2_A).not.toBe(gpif2_B);
    expect(gpif2_A.startsWith("gpif2-")).toBe(true);
  });

  // 18. Diagnostic Output Versioning
  it("Test 18: Diagnostic Output Versioning - reports semanticDiagnosticVersion: 2 with pof2, drsf2, gpif2 traces", () => {
    const zeroDna = DecisionDNACodec.createZeroDecisionDNA();
    const policy = new GenomePolicy(zeroDna);

    const session = lightSessionFactory({
      matchIndex: 0,
      matchId: "m-diag-v2",
      baseSeed: 42,
      matchSeed: 42,
      playerSeeds: { p1: 1, p2: 2 },
    });

    const result = SimulationRunner.run(
      session,
      { p1: policy, p2: policy },
      { maxDecisions: 20, enableSemanticDiagnostics: true }
    );

    expect(result.semanticDiagnostics).toBeDefined();
    const diag = result.semanticDiagnostics!;
    expect(diag.semanticDiagnosticVersion).toBe(2);
    expect(diag.traces.length).toBeGreaterThan(0);

    for (const record of diag.traces) {
      expect(record.fingerprints.observation.startsWith("pof2-")).toBe(true);
      expect(record.fingerprints.decisionRequest.startsWith("drsf2-")).toBe(true);
      expect(record.fingerprints.policyInput.startsWith("gpif2-")).toBe(true);
    }
  });

  // 19. Diagnostic OFF/ON Parity
  it("Test 19: Diagnostic OFF/ON Parity - simulation outcome is 100% byte-identical between OFF and ON", () => {
    const v5Dna = createSyntheticV5DNA();
    const v6Dna = DecisionDNAMigration.migrateV5toV6(v5Dna);
    const policy = new GenomePolicy(v6Dna);

    const matchConfig = {
      matchIndex: 1,
      matchId: "m-off-on-parity",
      baseSeed: 98765,
      matchSeed: 98765,
      playerSeeds: { p1: 1, p2: 2 },
    };

    const sessionOff = lightSessionFactory(matchConfig);
    const sessionOn = lightSessionFactory(matchConfig);

    const resOff = SimulationRunner.run(sessionOff, { p1: policy, p2: policy }, { maxDecisions: 50, enableSemanticDiagnostics: false });
    const resOn = SimulationRunner.run(sessionOn, { p1: policy, p2: policy }, { maxDecisions: 50, enableSemanticDiagnostics: true });

    // 1. High-level match outcomes
    expect(resOff.completed).toBe(resOn.completed);
    expect(resOff.winner).toBe(resOn.winner);
    expect(resOff.reason).toBe(resOn.reason);
    expect(resOff.totalDecisions).toBe(resOn.totalDecisions);
    expect(resOff.turnCount).toBe(resOn.turnCount);
    expect(resOff.finalStateHash).toBe(resOn.finalStateHash);

    // 2. Full Decision Trace logical sequence parity
    expect(resOff.decisionTrace.length).toBe(resOn.decisionTrace.length);
    for (let i = 0; i < resOff.decisionTrace.length; i++) {
      const recOff = resOff.decisionTrace[i];
      const recOn = resOn.decisionTrace[i];

      expect(recOff.stepCount).toBe(recOn.stepCount);
      expect(recOff.logicalDecisionId).toBe(recOn.logicalDecisionId);
      expect(recOff.playerId).toBe(recOn.playerId);
      expect(recOff.stateVersion).toBe(recOn.stateVersion);
      expect(recOff.stateHash).toBe(recOn.stateHash);
      expect(recOff.selectedPatternRef).toBe(recOn.selectedPatternRef);
      expect(recOff.selectedLogicalPatternKey).toBe(recOn.selectedLogicalPatternKey);
      expect(recOff.selectedPatternKind).toBe(recOn.selectedPatternKind);
      expect(recOff.actionId).toBe(recOn.actionId);
    }

    // 3. Match Log normalized logical comparison
    expect(resOff.matchLog).toBeDefined();
    expect(resOn.matchLog).toBeDefined();

    const normalizeLog = (log: any) => {
      if (!log) return undefined;
      const meta = {
        ...log.meta,
        startedAt: undefined,
        finishedAt: undefined,
      };
      const events = (log.events || []).map((ev: any) => {
        const copy = { ...ev };
        delete copy.timestamp;
        if ("decisionId" in copy) {
          copy.decisionId = "<normalized-decision-id>";
        }
        return copy;
      });
      return { meta, events };
    };

    expect(normalizeLog(resOff.matchLog)).toEqual(normalizeLog(resOn.matchLog));
  });

  // 20. Same-Seed Match Determinism
  it("Test 20: Same-Seed Match Determinism - identical seed matches produce identical decisions and hashes", () => {
    const v5Dna = createSyntheticV5DNA();
    const v6Dna = DecisionDNAMigration.migrateV5toV6(v5Dna);
    const policyA = new GenomePolicy(v6Dna);
    const policyB = new GenomePolicy(v6Dna);

    const session1 = lightSessionFactory({ matchIndex: 2, matchId: "m-seed-1", baseSeed: 54321, matchSeed: 54321, playerSeeds: { p1: 10, p2: 20 } });
    const session2 = lightSessionFactory({ matchIndex: 2, matchId: "m-seed-2", baseSeed: 54321, matchSeed: 54321, playerSeeds: { p1: 10, p2: 20 } });

    const res1 = SimulationRunner.run(session1, { p1: policyA, p2: policyA }, { maxDecisions: 50, enableSemanticDiagnostics: true });
    const res2 = SimulationRunner.run(session2, { p1: policyB, p2: policyB }, { maxDecisions: 50, enableSemanticDiagnostics: true });

    expect(res1.finalStateHash).toBe(res2.finalStateHash);
    expect(res1.totalDecisions).toBe(res2.totalDecisions);
    expect(res1.decisionTrace.length).toBe(res2.decisionTrace.length);
    for (let i = 0; i < res1.decisionTrace.length; i++) {
      const rec1 = res1.decisionTrace[i];
      const rec2 = res2.decisionTrace[i];
      expect(rec1.logicalDecisionId).toBe(rec2.logicalDecisionId);
      expect(rec1.selectedPatternRef).toBe(rec2.selectedPatternRef);
      expect(rec1.selectedLogicalPatternKey).toBe(rec2.selectedLogicalPatternKey);
      expect(rec1.stateHash).toBe(rec2.stateHash);
    }
    expect(res1.semanticDiagnostics!.traces.map((t) => t.fingerprints)).toEqual(
      res2.semanticDiagnostics!.traces.map((t) => t.fingerprints)
    );
  });
});
