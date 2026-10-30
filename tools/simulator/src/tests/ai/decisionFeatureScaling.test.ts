import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import {
  CONTEXT_SCALING_RULES,
  PATTERN_SCALING_RULES,
  FEATURE_SCALING_REGISTRY_VERSION,
  FEATURE_SCALING_SCHEMA_VERSION,
} from "../../domain/ai/DecisionFeatureScalingRegistry";
import {
  CONTEXT_FEATURE_DIMENSION,
  PATTERN_FEATURE_DIMENSION,
  FEATURE_SCHEMA_VERSION,
  CONTEXT_FEATURE_NAMES,
  PATTERN_FEATURE_NAMES,
} from "../../domain/ai/DecisionFeatureTypes";
import {
  DecisionFeatureScaler,
  DecisionFeatureScalingError,
  identity,
  linearBoundDivision,
  saturatingRational,
  signedSaturatingRational,
} from "../../engine/ai/DecisionFeatureScaler";
import { DecisionDNACodec } from "../../engine/ai/DecisionDNACodec";
import { GenomeScorer } from "../../engine/ai/GenomeScorer";
import { DecisionDNAValidationError } from "../../domain/ai/DecisionDNATypes";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Decision Feature Scaling (BP-SIM-AI-FEATURE-SCALING-IMPLEMENTATION-V1)", () => {
  describe("1. Pure Scaling Functions Golden Tests", () => {
    it("identity should preserve values in {0, 1} and [0, 1]", () => {
      expect(identity(0)).toBe(0);
      expect(identity(1)).toBe(1);
      expect(identity(0.5)).toBe(0.5);
      expect(identity(0.123456789)).toBe(0.123456789);
    });

    it("linearBoundDivision should divide by bound linearly", () => {
      expect(linearBoundDivision(0, 13)).toBe(0);
      expect(linearBoundDivision(13, 13)).toBe(1);
      expect(linearBoundDivision(7, 13)).toBeCloseTo(7 / 13, 10);
      expect(linearBoundDivision(1, 13)).toBeCloseTo(1 / 13, 10);

      expect(() => linearBoundDivision(5, 0)).toThrow(DecisionFeatureScalingError);
      expect(() => linearBoundDivision(5, -13)).toThrow(DecisionFeatureScalingError);
      expect(() => linearBoundDivision(5, NaN)).toThrow(DecisionFeatureScalingError);
    });

    it("saturatingRational should map [0, inf) to [0, 1) concavely", () => {
      // f(0) = 0
      expect(saturatingRational(0, 10)).toBe(0);
      // f(scale) = 0.5
      expect(saturatingRational(10, 10)).toBe(0.5);
      expect(saturatingRational(4, 4)).toBe(0.5);
      expect(saturatingRational(50, 50)).toBe(0.5);

      // Monotonically increasing
      const v1 = saturatingRational(1, 10);
      const v2 = saturatingRational(2, 10);
      const v3 = saturatingRational(10, 10);
      const v4 = saturatingRational(20, 10);
      const v5 = saturatingRational(100, 10);
      expect(v1).toBeLessThan(v2);
      expect(v2).toBeLessThan(v3);
      expect(v3).toBeLessThan(v4);
      expect(v4).toBeLessThan(v5);
      expect(v5).toBeLessThan(1.0);

      // Concavity: derivative is strictly decreasing
      // (f(10) - f(0)) / 10 = 0.05
      // (f(20) - f(10)) / 10 = (20/30 - 10/20) / 10 = (2/3 - 1/2) / 10 = (1/6) / 10 = 0.01666...
      const slope1 = (v3 - 0) / 10;
      const slope2 = (v4 - v3) / 10;
      expect(slope1).toBeGreaterThan(slope2);

      // Errors
      expect(() => saturatingRational(-1, 10)).toThrow(DecisionFeatureScalingError);
      expect(() => saturatingRational(5, 0)).toThrow(DecisionFeatureScalingError);
      expect(() => saturatingRational(5, -10)).toThrow(DecisionFeatureScalingError);
    });

    it("signedSaturatingRational should map (-inf, inf) to (-1, 1) with exact antisymmetry", () => {
      // f(0) = 0
      expect(signedSaturatingRational(0, 10)).toBe(0);

      // Symmetry: f(-x) = -f(x)
      const pos10 = signedSaturatingRational(10, 10);
      const neg10 = signedSaturatingRational(-10, 10);
      expect(pos10).toBe(0.5);
      expect(neg10).toBe(-0.5);
      expect(pos10 + neg10).toBe(0);

      const pos30 = signedSaturatingRational(30, 10);
      const neg30 = signedSaturatingRational(-30, 10);
      expect(pos30).toBe(0.75);
      expect(neg30).toBe(-0.75);
      expect(pos30 + neg30).toBe(0);

      expect(() => signedSaturatingRational(5, 0)).toThrow(DecisionFeatureScalingError);
      expect(() => signedSaturatingRational(5, -5)).toThrow(DecisionFeatureScalingError);
    });
  });

  describe("2. Canonical Scaling Registry Parity Test (docs parity)", () => {
    const registryPath = path.resolve(__dirname, "../../../docs/ai-v92-feature-schema-v6-registry-v1.json");
    const jsonContent = fs.readFileSync(registryPath, "utf-8");
    const canonicalDoc = JSON.parse(jsonContent);

    it("should match schema version and registry metadata", () => {
      expect(FEATURE_SCHEMA_VERSION).toBe(6);
      expect(FEATURE_SCALING_SCHEMA_VERSION).toBe(6);
      expect(canonicalDoc.schemaVersion).toBe(6);
      expect(FEATURE_SCALING_REGISTRY_VERSION).toBe("1.0.0-r2");
      expect(canonicalDoc.registryVersion).toBe("1.0.0-r2");
    });

    it("should have exactly 165 context rules and 143 pattern rules matching canonical dimensions", () => {
      expect(CONTEXT_SCALING_RULES.length).toBe(165);
      expect(CONTEXT_FEATURE_DIMENSION).toBe(165);
      expect(CONTEXT_FEATURE_NAMES.length).toBe(165);
      expect(canonicalDoc.contextFeatures.length).toBe(165);

      expect(PATTERN_SCALING_RULES.length).toBe(143);
      expect(PATTERN_FEATURE_DIMENSION).toBe(143);
      expect(PATTERN_FEATURE_NAMES.length).toBe(143);
      expect(canonicalDoc.patternFeatures.length).toBe(143);
    });

    it("should achieve 100% parity across all 165 Context scaling rules", () => {
      for (let i = 0; i < 165; i++) {
        const codeRule = CONTEXT_SCALING_RULES[i];
        const docRule = canonicalDoc.contextFeatures[i];

        expect(codeRule.domain).toBe("CONTEXT");
        expect(codeRule.index).toBe(i);
        expect(codeRule.name).toBe(CONTEXT_FEATURE_NAMES[i]);
        expect(codeRule.name).toBe(docRule.name);
        expect(codeRule.scalingClass).toBe(docRule.scalingClass);
        expect(codeRule.scalingFunction).toBe(docRule.scalingFunction);
        expect(codeRule.outputDomain).toBe(docRule.outputDomain);

        if (docRule.parameter.scale !== undefined) {
          expect(codeRule.parameter.scale).toBe(docRule.parameter.scale);
        }
        if (docRule.parameter.bound !== undefined) {
          expect(codeRule.parameter.bound).toBe(docRule.parameter.bound);
        }
      }
    });

    it("should achieve 100% parity across all 143 Pattern scaling rules", () => {
      for (let i = 0; i < 143; i++) {
        const codeRule = PATTERN_SCALING_RULES[i];
        const docRule = canonicalDoc.patternFeatures[i];

        expect(codeRule.domain).toBe("PATTERN");
        expect(codeRule.index).toBe(i);
        expect(codeRule.name).toBe(PATTERN_FEATURE_NAMES[i]);
        expect(codeRule.name).toBe(docRule.name);
        expect(codeRule.scalingClass).toBe(docRule.scalingClass);
        expect(codeRule.scalingFunction).toBe(docRule.scalingFunction);
        expect(codeRule.outputDomain).toBe(docRule.outputDomain);

        if (docRule.parameter.scale !== undefined) {
          expect(codeRule.parameter.scale).toBe(docRule.parameter.scale);
        }
        if (docRule.parameter.bound !== undefined) {
          expect(codeRule.parameter.bound).toBe(docRule.parameter.bound);
        }
      }
    });
  });

  describe("3. DecisionFeatureScaler Fail-Closed Safety Tests", () => {
    const validContext = new Array<number>(165).fill(0);
    const validPattern = new Array<number>(143).fill(0);

    it("should succeed and produce bounded values for valid all-zero inputs", () => {
      const scaledCtx = DecisionFeatureScaler.scaleContext(validContext);
      expect(scaledCtx.length).toBe(165);
      for (let i = 0; i < 165; i++) {
        expect(scaledCtx[i]).toBe(0);
      }

      const scaledPat = DecisionFeatureScaler.scalePattern(validPattern);
      expect(scaledPat.length).toBe(143);
      for (let i = 0; i < 143; i++) {
        expect(scaledPat[i]).toBe(0);
      }
    });

    it("should fail closed on dimension mismatch", () => {
      expect(() => DecisionFeatureScaler.scaleContext(new Array(162).fill(0))).toThrow(
        DecisionFeatureScalingError
      );
      expect(() => DecisionFeatureScaler.scaleContext(new Array(164).fill(0))).toThrow(
        DecisionFeatureScalingError
      );
      expect(() => DecisionFeatureScaler.scalePattern(new Array(142).fill(0))).toThrow(
        DecisionFeatureScalingError
      );
      expect(() => DecisionFeatureScaler.scalePattern(new Array(144).fill(0))).toThrow(
        DecisionFeatureScalingError
      );
    });

    it("should fail closed on NaN values", () => {
      const invalidCtx = [...validContext];
      invalidCtx[0] = NaN;
      expect(() => DecisionFeatureScaler.scaleContext(invalidCtx)).toThrow(
        DecisionFeatureScalingError
      );

      const invalidPat = [...validPattern];
      invalidPat[10] = NaN;
      expect(() => DecisionFeatureScaler.scalePattern(invalidPat)).toThrow(
        DecisionFeatureScalingError
      );
    });

    it("should fail closed on Infinity and -Infinity values", () => {
      const invalidCtx1 = [...validContext];
      invalidCtx1[7] = Infinity;
      expect(() => DecisionFeatureScaler.scaleContext(invalidCtx1)).toThrow(
        DecisionFeatureScalingError
      );

      const invalidCtx2 = [...validContext];
      invalidCtx2[7] = -Infinity;
      expect(() => DecisionFeatureScaler.scaleContext(invalidCtx2)).toThrow(
        DecisionFeatureScalingError
      );
    });

    it("should fail closed on invalid discrete binary values for BOOLEAN, ONE_HOT, HASH_BUCKET", () => {
      // index 0: source_is_action_request (BOOLEAN)
      const ctxBoolInvalid1 = [...validContext];
      ctxBoolInvalid1[0] = 2;
      expect(() => DecisionFeatureScaler.scaleContext(ctxBoolInvalid1)).toThrow(
        DecisionFeatureScalingError
      );

      const ctxBoolInvalid2 = [...validContext];
      ctxBoolInvalid2[0] = -1;
      expect(() => DecisionFeatureScaler.scaleContext(ctxBoolInvalid2)).toThrow(
        DecisionFeatureScalingError
      );

      const ctxBoolInvalid3 = [...validContext];
      ctxBoolInvalid3[0] = 0.5;
      expect(() => DecisionFeatureScaler.scaleContext(ctxBoolInvalid3)).toThrow(
        DecisionFeatureScalingError
      );
    });

    it("should fail closed on out-of-range card value for BOUNDED_CARD_VALUE", () => {
      // Context index 61: self_hand_value_max (BOUNDED_CARD_VALUE, bound 13)
      const maxIdx = CONTEXT_FEATURE_NAMES.indexOf("self_hand_value_max");
      expect(maxIdx).toBeGreaterThanOrEqual(0);

      const ctxCardInvalid1 = [...validContext];
      ctxCardInvalid1[maxIdx] = 14;
      expect(() => DecisionFeatureScaler.scaleContext(ctxCardInvalid1)).toThrow(
        DecisionFeatureScalingError
      );

      const ctxCardInvalid2 = [...validContext];
      ctxCardInvalid2[maxIdx] = -1;
      expect(() => DecisionFeatureScaler.scaleContext(ctxCardInvalid2)).toThrow(
        DecisionFeatureScalingError
      );
    });

    it("should fail closed on negative value for NONNEGATIVE_COUNT", () => {
      // Context index 6: turn_count (NONNEGATIVE_COUNT, scale 10)
      const turnIdx = CONTEXT_FEATURE_NAMES.indexOf("turn_count");
      const ctxNeg = [...validContext];
      ctxNeg[turnIdx] = -1;
      expect(() => DecisionFeatureScaler.scaleContext(ctxNeg)).toThrow(
        DecisionFeatureScalingError
      );
    });

    it("should fail closed on out-of-bounds ratio for RATIO_0_1", () => {
      // Pattern index 140: effect_selection_coverage_ratio (RATIO_0_1)
      const ratioIdx = PATTERN_FEATURE_NAMES.indexOf("effect_selection_coverage_ratio");
      expect(ratioIdx).toBeGreaterThanOrEqual(0);

      const patRatioInvalid1 = [...validPattern];
      patRatioInvalid1[ratioIdx] = 1.05;
      expect(() => DecisionFeatureScaler.scalePattern(patRatioInvalid1)).toThrow(
        DecisionFeatureScalingError
      );

      const patRatioInvalid2 = [...validPattern];
      patRatioInvalid2[ratioIdx] = -0.01;
      expect(() => DecisionFeatureScaler.scalePattern(patRatioInvalid2)).toThrow(
        DecisionFeatureScalingError
      );
    });
  });

  describe("4. Vector Domain Enforcement", () => {
    it("should scale realistic non-zero context vector strictly into [-1, 1]", () => {
      const sampleCtx = new Array<number>(165).fill(0);
      sampleCtx[0] = 1; // source_is_action_request (BOOLEAN)
      sampleCtx[6] = 5; // turn_count (NONNEGATIVE_COUNT scale 10 -> 5/15 = 0.333...)
      sampleCtx[7] = 2; // stage_depth (NONNEGATIVE_COUNT scale 4 -> 2/6 = 0.333...)
      const maxIdx = CONTEXT_FEATURE_NAMES.indexOf("self_hand_value_max");
      sampleCtx[maxIdx] = 13; // (BOUNDED_CARD_VALUE bound 13 -> 1.0)
      const deltaIdx = CONTEXT_FEATURE_NAMES.indexOf("relative_life_count");
      if (deltaIdx >= 0) {
        sampleCtx[deltaIdx] = -5; // (SIGNED_DELTA scale 10 -> -5/15 = -0.333...)
      }

      const scaled = DecisionFeatureScaler.scaleContext(sampleCtx);
      expect(scaled.length).toBe(165);

      expect(scaled[0]).toBe(1.0);
      expect(scaled[6]).toBeCloseTo(5 / 15, 10);
      expect(scaled[7]).toBeCloseTo(2 / 6, 10);
      expect(scaled[maxIdx]).toBe(1.0);
      if (deltaIdx >= 0) {
        expect(scaled[deltaIdx]).toBeCloseTo(-5 / 15, 10);
      }

      for (let i = 0; i < 163; i++) {
        const val = scaled[i];
        expect(Number.isFinite(val)).toBe(true);
        expect(val).toBeGreaterThanOrEqual(-1);
        expect(val).toBeLessThanOrEqual(1);
      }
    });

    it("should scale realistic non-zero pattern vector strictly into [-1, 1]", () => {
      const samplePat = new Array<number>(143).fill(0);
      samplePat[0] = 1; // pattern_is_action (BOOLEAN)
      const cardMaxIdx = PATTERN_FEATURE_NAMES.indexOf("key_card_value_max");
      if (cardMaxIdx >= 0) {
        samplePat[cardMaxIdx] = 10; // (BOUNDED_CARD_VALUE bound 13 -> 10/13)
      }
      const covIdx = PATTERN_FEATURE_NAMES.indexOf("effect_selection_coverage_ratio");
      if (covIdx >= 0) {
        samplePat[covIdx] = 0.75; // (RATIO_0_1 -> 0.75)
      }
      const deltaSumIdx = PATTERN_FEATURE_NAMES.indexOf("effect_assignment_size_delta_sum");
      if (deltaSumIdx >= 0) {
        samplePat[deltaSumIdx] = -6; // (SIGNED_DELTA scale 20 -> -6 / (6 + 20) = -6/26 = -3/13)
      }

      const scaled = DecisionFeatureScaler.scalePattern(samplePat);
      expect(scaled.length).toBe(143);

      expect(scaled[0]).toBe(1.0);
      if (cardMaxIdx >= 0) {
        expect(scaled[cardMaxIdx]).toBeCloseTo(10 / 13, 10);
      }
      if (covIdx >= 0) {
        expect(scaled[covIdx]).toBe(0.75);
      }
      if (deltaSumIdx >= 0) {
        expect(scaled[deltaSumIdx]).toBeCloseTo(-6 / 26, 10);
        expect(scaled[deltaSumIdx]).toBeLessThan(0);
      }

      for (let i = 0; i < 143; i++) {
        const val = scaled[i];
        expect(Number.isFinite(val)).toBe(true);
        expect(val).toBeGreaterThanOrEqual(-1);
        expect(val).toBeLessThanOrEqual(1);
      }
    });

    it("should scale negative Pattern SIGNED_DELTA (effect_assignment_size_delta_sum) into (-1, 0) matching canonical contract", () => {
      const featureName = "effect_assignment_size_delta_sum";
      const featureIndex = PATTERN_FEATURE_NAMES.indexOf(featureName);
      expect(featureIndex).toBeGreaterThanOrEqual(0);

      // Verify canonical registry rule for this feature
      const rule = PATTERN_SCALING_RULES[featureIndex];
      expect(rule.name).toBe(featureName);
      expect(rule.scalingClass).toBe("SIGNED_DELTA");
      expect(rule.scalingFunction).toBe("signed_saturating_rational");
      expect(rule.outputDomain).toBe("(-1, 1)");

      const scaleParam = rule.parameter.scale;
      expect(typeof scaleParam).toBe("number");
      expect(scaleParam).toBeGreaterThan(0);
      const s = scaleParam!;

      // 1. Negative raw value test (raw = -10, scale = 20 -> -10 / (10 + 20) = -10/30 = -1/3)
      const rawNeg = -10;
      const samplePatNeg = new Array<number>(PATTERN_FEATURE_DIMENSION).fill(0);
      samplePatNeg[featureIndex] = rawNeg;

      const scaledNeg = DecisionFeatureScaler.scalePattern(samplePatNeg);
      const valNeg = scaledNeg[featureIndex];

      // Must be negative and in (-1, 0)
      expect(valNeg).toBeLessThan(0);
      expect(valNeg).toBeGreaterThan(-1);

      // Must match canonical formula: x / (|x| + s)
      const expectedNeg = rawNeg / (Math.abs(rawNeg) + s);
      expect(valNeg).toBeCloseTo(expectedNeg, 10);

      // 2. Positive raw value & exact antisymmetry test: f(-x) = -f(x)
      const rawPos = 10;
      const samplePatPos = new Array<number>(PATTERN_FEATURE_DIMENSION).fill(0);
      samplePatPos[featureIndex] = rawPos;

      const scaledPos = DecisionFeatureScaler.scalePattern(samplePatPos);
      const valPos = scaledPos[featureIndex];

      expect(valPos).toBeGreaterThan(0);
      expect(valPos).toBeLessThan(1);
      const expectedPos = rawPos / (Math.abs(rawPos) + s);
      expect(valPos).toBeCloseTo(expectedPos, 10);
      expect(valNeg + valPos).toBeCloseTo(0, 10); // exact antisymmetry

      // 3. Multiplicative interaction bound check with full Context domain [-1, 1]
      // For any context feature value c_i in [-1, 1], |c_i * p_j| <= 1.0 must hold strictly
      for (const c_val of [-1.0, -0.75, -0.5, 0.0, 0.5, 0.75, 1.0]) {
        const interactionNeg = c_val * valNeg;
        expect(Math.abs(interactionNeg)).toBeLessThanOrEqual(1.0);

        const interactionPos = c_val * valPos;
        expect(Math.abs(interactionPos)).toBeLessThanOrEqual(1.0);
      }
    });
  });

  describe("5. DNA v5 Rejection & Schema v6 Scorer Compatibility", () => {
    it("should reject v5 DNA in DecisionDNACodec.validate", () => {
      const zeroDna = DecisionDNACodec.createZeroDecisionDNA();
      expect(zeroDna.featureSchemaVersion).toBe(6);

      const v5Dna = {
        ...zeroDna,
        featureSchemaVersion: 5,
      };

      expect(() => DecisionDNACodec.validate(v5Dna)).toThrow(DecisionDNAValidationError);
    });

    it("should fail closed in GenomeScorer when DNA schema version != feature schema version", () => {
      const zeroDna = DecisionDNACodec.createZeroDecisionDNA();
      const v5Dna = {
        ...zeroDna,
        featureSchemaVersion: 5,
      };

      const dummyFeatures = {
        featureSchemaVersion: 6,
        context: {
          featureNames: CONTEXT_FEATURE_NAMES,
          values: new Array(165).fill(0),
        },
        patterns: [
          {
            patternRef: 0,
            kind: "ACTION",
            values: new Array(143).fill(0),
          },
        ],
      };

      expect(() => GenomeScorer.score(dummyFeatures, v5Dna as any)).toThrow(
        /FeatureSchemaVersion 不一致/
      );
    });

    it("should successfully score Schema v6 features with Schema v6 Zero DNA", () => {
      const zeroDna = DecisionDNACodec.createZeroDecisionDNA();
      const dummyFeatures = {
        featureSchemaVersion: 6,
        context: {
          featureNames: CONTEXT_FEATURE_NAMES,
          values: DecisionFeatureScaler.scaleContext(new Array(165).fill(0)),
        },
        patterns: [
          {
            patternRef: 0,
            kind: "PASS",
            values: DecisionFeatureScaler.scalePattern(new Array(143).fill(0)),
          },
          {
            patternRef: 1,
            kind: "ACTION",
            values: DecisionFeatureScaler.scalePattern(new Array(143).fill(0)),
          },
        ],
      };

      const scored = GenomeScorer.score(dummyFeatures, zeroDna);
      expect(scored.length).toBe(2);
      expect(scored[0].score).toBe(0);
      expect(scored[1].score).toBe(0);
    });
  });
});
