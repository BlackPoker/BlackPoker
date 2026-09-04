import { describe, it, expect } from "vitest";
import {
  DNA_FORMAT_VERSION,
  DNA_CONTEXT_DIMENSION,
  DNA_PATTERN_DIMENSION,
  DNA_INTERACTION_DIMENSION,
  DNA_TOTAL_WEIGHTS,
  SCORING_MODEL_V1,
  DecisionDNA,
  DecisionDNAValidationError,
  DecisionDNAExecutionError,
} from "../../domain/ai/DecisionDNATypes";
import {
  FEATURE_SCHEMA_VERSION,
  CONTEXT_FEATURE_NAMES,
  PATTERN_FEATURE_NAMES,
  EncodedDecisionFeatures,
} from "../../domain/ai/DecisionFeatureTypes";
import { DecisionDNACodec } from "../../engine/ai/DecisionDNACodec";
import { GenomeScorer } from "../../engine/ai/GenomeScorer";

describe("Decision DNA Format v1 & Genome Scorer v1 (Phase 3.1)", () => {
  const createSyntheticFeatures = (
    contextOverrides: Partial<Record<string, number>> = {},
    patternsConfig: Array<{ kind: string; overrides?: Partial<Record<string, number>> }> = [
      { kind: "PASS" },
      { kind: "ACTION", overrides: { pattern_is_action: 1, action_speed_normal: 1 } },
      { kind: "EFFECT_SELECTION", overrides: { pattern_is_effect_selection: 1 } },
    ]
  ): EncodedDecisionFeatures => {
    const contextValues = new Array(DNA_CONTEXT_DIMENSION).fill(0);
    for (const [name, val] of Object.entries(contextOverrides)) {
      const idx = CONTEXT_FEATURE_NAMES.indexOf(name as any);
      if (idx !== -1) contextValues[idx] = val;
    }

    const patterns = patternsConfig.map((cfg, idx) => {
      const pValues = new Array(DNA_PATTERN_DIMENSION).fill(0);
      if (cfg.kind === "PASS") {
        const pIdx = PATTERN_FEATURE_NAMES.indexOf("pattern_is_pass");
        if (pIdx !== -1) pValues[pIdx] = 1;
      } else if (cfg.kind === "ACTION") {
        const aIdx = PATTERN_FEATURE_NAMES.indexOf("pattern_is_action");
        if (aIdx !== -1) pValues[aIdx] = 1;
      } else if (cfg.kind === "EFFECT_SELECTION") {
        const eIdx = PATTERN_FEATURE_NAMES.indexOf("pattern_is_effect_selection");
        if (eIdx !== -1) pValues[eIdx] = 1;
      }

      if (cfg.overrides) {
        for (const [k, v] of Object.entries(cfg.overrides)) {
          const fIdx = PATTERN_FEATURE_NAMES.indexOf(k as any);
          if (fIdx !== -1) pValues[fIdx] = v;
        }
      }

      return {
        patternRef: idx,
        kind: cfg.kind,
        logicalPatternKey: `key-${cfg.kind}-${idx}`,
        values: pValues,
      };
    });

    return {
      featureSchemaVersion: FEATURE_SCHEMA_VERSION,
      context: {
        featureNames: CONTEXT_FEATURE_NAMES,
        values: contextValues,
      },
      patterns,
    };
  };

  describe("AA. Decision DNA Format & Validation", () => {
    it("1. 定数と次元数が正しく定義されていること (25, 57, 1425, 1482)", () => {
      expect(DNA_FORMAT_VERSION).toBe(1);
      expect(DNA_CONTEXT_DIMENSION).toBe(25);
      expect(DNA_PATTERN_DIMENSION).toBe(57);
      expect(DNA_INTERACTION_DIMENSION).toBe(25 * 57);
      expect(DNA_INTERACTION_DIMENSION).toBe(1425);
      expect(DNA_TOTAL_WEIGHTS).toBe(57 + 1425);
      expect(DNA_TOTAL_WEIGHTS).toBe(1482);
      expect(SCORING_MODEL_V1).toBe("linear-bilinear-v1");
    });

    it("2. createZeroDecisionDNA が正当な DecisionDNA を生成すること", () => {
      const zeroDna = DecisionDNACodec.createZeroDecisionDNA({ id: "zero-001", name: "Zero Agent" });

      expect(zeroDna.dnaFormatVersion).toBe(1);
      expect(zeroDna.featureSchemaVersion).toBe(1);
      expect(zeroDna.scoringModel).toBe("linear-bilinear-v1");
      expect(zeroDna.contextDimension).toBe(25);
      expect(zeroDna.patternDimension).toBe(57);
      expect(zeroDna.patternWeights.length).toBe(57);
      expect(zeroDna.contextPatternWeights.length).toBe(1425);
      expect(zeroDna.patternWeights.every((w) => w === 0)).toBe(true);
      expect(zeroDna.contextPatternWeights.every((w) => w === 0)).toBe(true);
      expect(zeroDna.metadata?.name).toBe("Zero Agent");

      expect(() => DecisionDNACodec.validate(zeroDna)).not.toThrow();
    });

    it("3. JSON シリアライズ / デシリアライズの round-trip が完全一致すること", () => {
      const dna = DecisionDNACodec.createZeroDecisionDNA({ id: "dna-test", name: "Test DNA" });
      (dna.patternWeights as number[])[0] = 1.5;
      (dna.contextPatternWeights as number[])[10] = -0.75;

      const json = DecisionDNACodec.serialize(dna);
      expect(typeof json).toBe("string");

      const deserialized = DecisionDNACodec.deserialize(json);
      expect(deserialized).toEqual(dna);
      expect(deserialized.patternWeights[0]).toBe(1.5);
      expect(deserialized.contextPatternWeights[10]).toBe(-0.75);
      expect(deserialized.metadata?.name).toBe("Test DNA");
    });

    it("4. 不正な DNA 形式を厳格に拒絶すること (バージョン、次元、長さ、非有限数)", () => {
      const valid = DecisionDNACodec.createZeroDecisionDNA();

      expect(() => DecisionDNACodec.validate({ ...valid, dnaFormatVersion: 2 })).toThrow(
        DecisionDNAValidationError
      );
      expect(() => DecisionDNACodec.validate({ ...valid, featureSchemaVersion: 99 })).toThrow(
        DecisionDNAValidationError
      );
      expect(() => DecisionDNACodec.validate({ ...valid, scoringModel: "unknown-nn-v1" })).toThrow(
        DecisionDNAValidationError
      );
      expect(() => DecisionDNACodec.validate({ ...valid, contextDimension: 24 })).toThrow(
        DecisionDNAValidationError
      );
      expect(() => DecisionDNACodec.validate({ ...valid, patternDimension: 58 })).toThrow(
        DecisionDNAValidationError
      );
      expect(() => DecisionDNACodec.validate({ ...valid, patternWeights: new Array(56).fill(0) })).toThrow(
        DecisionDNAValidationError
      );
      expect(() =>
        DecisionDNACodec.validate({ ...valid, contextPatternWeights: new Array(1424).fill(0) })
      ).toThrow(DecisionDNAValidationError);

      const nanWeights = [...valid.patternWeights];
      nanWeights[5] = NaN;
      expect(() => DecisionDNACodec.validate({ ...valid, patternWeights: nanWeights })).toThrow(
        DecisionDNAValidationError
      );

      const infWeights = [...valid.contextPatternWeights];
      infWeights[100] = Infinity;
      expect(() => DecisionDNACodec.validate({ ...valid, contextPatternWeights: infWeights })).toThrow(
        DecisionDNAValidationError
      );

      const negInfWeights = [...valid.contextPatternWeights];
      negInfWeights[200] = -Infinity;
      expect(() => DecisionDNACodec.validate({ ...valid, contextPatternWeights: negInfWeights })).toThrow(
        DecisionDNAValidationError
      );
    });
  });

  describe("AB. Genome Scoring Formula v1", () => {
    it("1. Zero DNA ではすべての合法パターンのスコアが 0 になること", () => {
      const dna = DecisionDNACodec.createZeroDecisionDNA();
      const features = createSyntheticFeatures({ self_is_turn_player: 1 });

      const scored = GenomeScorer.score(features, dna);

      expect(scored.length).toBe(features.patterns.length);
      for (const sp of scored) {
        expect(sp.score).toBe(0);
      }
    });

    it("2. PASS 線形重み (pattern_is_pass = +1.0) で PASS パターンが高スコアになること", () => {
      const dna = DecisionDNACodec.createZeroDecisionDNA();
      const passIdx = PATTERN_FEATURE_NAMES.indexOf("pattern_is_pass");
      (dna.patternWeights as number[])[passIdx] = 1.0;

      const features = createSyntheticFeatures();
      const scored = GenomeScorer.score(features, dna);

      expect(scored[0].score).toBe(1.0);
      expect(scored[1].score).toBe(0.0);
      expect(scored[2].score).toBe(0.0);
    });

    it("3. ACTION 線形重み (pattern_is_action = +2.5) で ACTION パターンが高スコアになること", () => {
      const dna = DecisionDNACodec.createZeroDecisionDNA();
      const actIdx = PATTERN_FEATURE_NAMES.indexOf("pattern_is_action");
      (dna.patternWeights as number[])[actIdx] = 2.5;

      const features = createSyntheticFeatures();
      const scored = GenomeScorer.score(features, dna);

      expect(scored[0].score).toBe(0.0);
      expect(scored[1].score).toBe(2.5);
      expect(scored[2].score).toBe(0.0);
    });

    it("4. Context-Pattern 相互作用 (self_is_turn_player × pattern_is_action = +3.0) により文脈依存でスコアが変化すること", () => {
      const dna = DecisionDNACodec.createZeroDecisionDNA();
      const turnIdx = CONTEXT_FEATURE_NAMES.indexOf("self_is_turn_player");
      const actIdx = PATTERN_FEATURE_NAMES.indexOf("pattern_is_action");
      const interIdx = DecisionDNACodec.getContextPatternWeightIndex(turnIdx, actIdx);
      (dna.contextPatternWeights as number[])[interIdx] = 3.0;

      const featTurn = createSyntheticFeatures({ self_is_turn_player: 1 });
      const scoredTurn = GenomeScorer.score(featTurn, dna);
      expect(scoredTurn[0].score).toBe(0.0);
      expect(scoredTurn[1].score).toBe(3.0);

      const featOppTurn = createSyntheticFeatures({ opponent_is_turn_player: 1 });
      const scoredOppTurn = GenomeScorer.score(featOppTurn, dna);
      expect(scoredOppTurn[0].score).toBe(0.0);
      expect(scoredOppTurn[1].score).toBe(0.0);
    });

    it("5. 手計算による厳密なスコア計算値との完全一致検証 (線形 + 相互作用)", () => {
      const dna = DecisionDNACodec.createZeroDecisionDNA();
      const idxAct = PATTERN_FEATURE_NAMES.indexOf("pattern_is_action");
      const idxSpeed = PATTERN_FEATURE_NAMES.indexOf("action_speed_normal");
      const idxLife = CONTEXT_FEATURE_NAMES.indexOf("self_life_count");

      (dna.patternWeights as number[])[idxAct] = 2.0;
      (dna.patternWeights as number[])[idxSpeed] = 0.5;

      const interIdx = DecisionDNACodec.getContextPatternWeightIndex(idxLife, idxSpeed);
      (dna.contextPatternWeights as number[])[interIdx] = 0.1;

      const features = createSyntheticFeatures(
        { self_life_count: 15 },
        [
          { kind: "PASS" },
          { kind: "ACTION", overrides: { pattern_is_action: 1, action_speed_normal: 1 } },
        ]
      );

      const scored = GenomeScorer.score(features, dna);
      expect(scored[0].score).toBe(0.0);
      expect(scored[1].score).toBe(4.0);
    });

    it("6. Row-major インデックス計算が i * 57 + j と厳密に一致すること", () => {
      for (let i = 0; i < DNA_CONTEXT_DIMENSION; i++) {
        for (let j = 0; j < DNA_PATTERN_DIMENSION; j++) {
          const expected = i * DNA_PATTERN_DIMENSION + j;
          const actual = DecisionDNACodec.getContextPatternWeightIndex(i, j);
          expect(actual).toBe(expected);
        }
      }
    });

    it("7. スコア計算結果が非有限数 (Infinity) になった場合、サイレントクランプせず明確に例外をスローすること", () => {
      const dna = DecisionDNACodec.createZeroDecisionDNA();
      const idxAct = PATTERN_FEATURE_NAMES.indexOf("pattern_is_action");
      (dna.patternWeights as number[])[idxAct] = Number.MAX_VALUE;

      const features = createSyntheticFeatures({}, [
        { kind: "ACTION", overrides: { pattern_is_action: 2 } },
      ]);

      expect(() => GenomeScorer.score(features, dna)).toThrow(DecisionDNAExecutionError);
    });

    it("8. DNA と Feature の featureSchemaVersion が不一致の場合は実行時例外をスローすること", () => {
      const dna = DecisionDNACodec.createZeroDecisionDNA();
      const features = createSyntheticFeatures();
      (features as any).featureSchemaVersion = 2;

      expect(() => GenomeScorer.score(features, dna)).toThrow(DecisionDNAExecutionError);
    });
  });
});
