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

  describe("AC. Metadata JSON Artifact Contract & Deep Isolation (Phase 3.1.1)", () => {
    it("1. valid な nested metadata が正常に validate されること (Section V 準拠)", () => {
      const validMetadata = {
        id: "dna-001",
        name: "Genome A",
        generation: 3,
        fitness: 0.75,
        tags: ["baseline", "test"],
        experiment: {
          seed: 42,
          active: true,
          note: null,
        },
      };

      const dna = DecisionDNACodec.createZeroDecisionDNA(validMetadata as any);
      expect(() => DecisionDNACodec.validate(dna)).not.toThrow();
      expect(dna.metadata?.id).toBe("dna-001");
      expect(dna.metadata?.fitness).toBe(0.75);
    });

    it("2. nested metadata を含む DNA の JSON シリアライズ / デシリアライズ round-trip で deepEqual になること", () => {
      const dna = DecisionDNACodec.createZeroDecisionDNA({
        id: "dna-nested",
        generation: 5,
        experiment: {
          tags: ["alpha", "beta"],
          params: { learningRate: 0.01, active: true, score: null },
        },
      } as any);

      const json = DecisionDNACodec.serialize(dna);
      const deserialized = DecisionDNACodec.deserialize(json);

      expect(deserialized).toEqual(dna);
      expect((deserialized.metadata as any).experiment.params.learningRate).toBe(0.01);
    });

    it("3. nested metadata のディープクローンで参照共有が完全に残らないこと (Clone Isolation)", () => {
      const original = DecisionDNACodec.createZeroDecisionDNA({
        experiment: {
          tags: ["baseline", "v1"],
          params: { alpha: 0.5 },
        },
      } as any);

      const cloned = DecisionDNACodec.clone(original);

      // clone 側の配列・オブジェクトを変更
      (cloned.metadata as any).experiment.tags.push("v2");
      (cloned.metadata as any).experiment.tags[0] = "mutated";
      (cloned.metadata as any).experiment.params.alpha = 0.99;
      (cloned.metadata as any).experiment.params.newField = "added";

      // original は一切影響を受けないこと
      expect((original.metadata as any).experiment.tags).toEqual(["baseline", "v1"]);
      expect((original.metadata as any).experiment.params).toEqual({ alpha: 0.5 });
    });

    it("4. metadata 内の不正な型を厳格に reject すること (Section U: 10条件 + α)", () => {
      const base = DecisionDNACodec.createZeroDecisionDNA();

      // 1. NaN
      expect(() =>
        DecisionDNACodec.validate({ ...base, metadata: { foo: NaN } })
      ).toThrow(DecisionDNAValidationError);

      // 2. Infinity
      expect(() =>
        DecisionDNACodec.validate({ ...base, metadata: { foo: Infinity } })
      ).toThrow(DecisionDNAValidationError);

      // 3. -Infinity
      expect(() =>
        DecisionDNACodec.validate({ ...base, metadata: { foo: -Infinity } })
      ).toThrow(DecisionDNAValidationError);

      // 4. 1n (BigInt)
      expect(() =>
        DecisionDNACodec.validate({ ...base, metadata: { foo: 1n as any } })
      ).toThrow(DecisionDNAValidationError);

      // 5. () => {} (function)
      expect(() =>
        DecisionDNACodec.validate({ ...base, metadata: { foo: (() => {}) as any } })
      ).toThrow(DecisionDNAValidationError);

      // 6. Symbol("x")
      expect(() =>
        DecisionDNACodec.validate({ ...base, metadata: { foo: Symbol("x") as any } })
      ).toThrow(DecisionDNAValidationError);

      // 7. new Date()
      expect(() =>
        DecisionDNACodec.validate({ ...base, metadata: { foo: new Date() as any } })
      ).toThrow(DecisionDNAValidationError);

      // 8. new Map()
      expect(() =>
        DecisionDNACodec.validate({ ...base, metadata: { foo: new Map() as any } })
      ).toThrow(DecisionDNAValidationError);

      // 9. new Set()
      expect(() =>
        DecisionDNACodec.validate({ ...base, metadata: { foo: new Set() as any } })
      ).toThrow(DecisionDNAValidationError);

      // 10. cyclic metadata (循環参照)
      const cyclic: any = { a: 1 };
      cyclic.self = cyclic;
      expect(() =>
        DecisionDNACodec.validate({ ...base, metadata: cyclic })
      ).toThrow(DecisionDNAValidationError);

      // 11. nested cyclic metadata
      const parent: any = { child: {} };
      parent.child.back = parent;
      expect(() =>
        DecisionDNACodec.validate({ ...base, metadata: parent })
      ).toThrow(DecisionDNAValidationError);

      // 12. undefined 値 (プロパティ値としての undefined は拒絶)
      expect(() =>
        DecisionDNACodec.validate({ ...base, metadata: { foo: undefined } as any })
      ).toThrow(DecisionDNAValidationError);

      // 13. RegExp
      expect(() =>
        DecisionDNACodec.validate({ ...base, metadata: { regex: /test/ } as any })
      ).toThrow(DecisionDNAValidationError);

      // 14. Custom class instance
      class CustomMeta {
        name = "custom";
      }
      expect(() =>
        DecisionDNACodec.validate({ ...base, metadata: new CustomMeta() as any })
      ).toThrow(DecisionDNAValidationError);
    });

    it("5. validate が成功した任意の DecisionDNA は serialize が必ず成功すること", () => {
      const dna = DecisionDNACodec.createZeroDecisionDNA({
        id: "valid-serialized",
        tags: ["a", "b", "c"],
        nested: { count: 10, valid: true, empty: null },
      } as any);

      expect(() => DecisionDNACodec.validate(dna)).not.toThrow();
      expect(() => {
        const json = DecisionDNACodec.serialize(dna);
        expect(typeof json).toBe("string");
      }).not.toThrow();
    });

    it("6. metadata を変更・追加しても GenomeScorer のスコア計算結果は 100% 不変であること", () => {
      const baseDna = DecisionDNACodec.createZeroDecisionDNA();
      const metaDna = DecisionDNACodec.createZeroDecisionDNA({
        id: "meta-test",
        name: "Complex Meta",
        generation: 99,
        fitness: 0.999,
        nested: { tags: ["t1", "t2"] },
      } as any);

      // 双方に同じ重みを設定
      const passIdx = PATTERN_FEATURE_NAMES.indexOf("pattern_is_pass");
      (baseDna.patternWeights as number[])[passIdx] = 1.23;
      (metaDna.patternWeights as number[])[passIdx] = 1.23;

      const features = createSyntheticFeatures({ self_life_count: 10 });
      const scoredBase = GenomeScorer.score(features, baseDna);
      const scoredMeta = GenomeScorer.score(features, metaDna);

      expect(scoredBase).toEqual(scoredMeta);
    });
  });

  describe("AD. Decision DNA Factory Entry Validation (Phase 3.1.2)", () => {
    it("1. Factory 入口 (createZeroDecisionDNA) に valid nested metadata を渡して正常生成できること", () => {
      const validMetadata = {
        id: "dna-factory-001",
        name: "Factory Agent",
        generation: 4,
        fitness: 0.82,
        tags: ["factory", "v1"],
        experiment: {
          seed: 123,
          active: true,
          note: null,
        },
      };

      const dna = DecisionDNACodec.createZeroDecisionDNA(validMetadata as any);
      expect(dna.metadata?.id).toBe("dna-factory-001");
      expect(dna.metadata?.fitness).toBe(0.82);
      expect((dna.metadata as any).experiment.seed).toBe(123);
      expect(() => DecisionDNACodec.validate(dna)).not.toThrow();
    });

    it("2. Factory 生成後に caller 側の metadata を変更しても生成済み DNA が完全に不変であること (Factory Clone Isolation)", () => {
      const metadata = {
        tags: ["init"],
        experiment: {
          params: { lr: 0.05 },
        },
      };

      const dna = DecisionDNACodec.createZeroDecisionDNA(metadata as any);

      // caller 側変更
      metadata.tags.push("mutated");
      metadata.experiment.params.lr = 0.99;

      expect((dna.metadata as any).tags).toEqual(["init"]);
      expect((dna.metadata as any).experiment.params.lr).toBe(0.05);
    });

    it("3. Factory 入口に直接 null を渡した場合、DecisionDNAValidationError として安全に reject すること", () => {
      expect(() => DecisionDNACodec.createZeroDecisionDNA(null as any)).toThrow(
        DecisionDNAValidationError
      );
    });

    it("4. Factory 入口に直接 array を渡した場合、DecisionDNAValidationError として安全に reject すること", () => {
      expect(() => DecisionDNACodec.createZeroDecisionDNA([] as any)).toThrow(
        DecisionDNAValidationError
      );
      expect(() => DecisionDNACodec.createZeroDecisionDNA(["tag1", "tag2"] as any)).toThrow(
        DecisionDNAValidationError
      );
    });

    it("5. Factory 入口に非有限数 (NaN, Infinity, -Infinity) を含む metadata を渡した場合に reject すること", () => {
      expect(() => DecisionDNACodec.createZeroDecisionDNA({ foo: NaN } as any)).toThrow(
        DecisionDNAValidationError
      );
      expect(() => DecisionDNACodec.createZeroDecisionDNA({ foo: Infinity } as any)).toThrow(
        DecisionDNAValidationError
      );
      expect(() => DecisionDNACodec.createZeroDecisionDNA({ foo: -Infinity } as any)).toThrow(
        DecisionDNAValidationError
      );
    });

    it("6. Factory 入口に BigInt, function, Symbol を含む metadata を渡した場合に reject すること", () => {
      expect(() => DecisionDNACodec.createZeroDecisionDNA({ foo: 1n as any } as any)).toThrow(
        DecisionDNAValidationError
      );
      expect(() => DecisionDNACodec.createZeroDecisionDNA({ foo: (() => {}) as any } as any)).toThrow(
        DecisionDNAValidationError
      );
      expect(() => DecisionDNACodec.createZeroDecisionDNA({ foo: Symbol("test") as any } as any)).toThrow(
        DecisionDNAValidationError
      );
    });

    it("7. Factory 入口に Date, RegExp, Map, Set, custom class instance を直接渡した場合、{} へ変換せず元入力で reject すること", () => {
      expect(() => DecisionDNACodec.createZeroDecisionDNA(new Date() as any)).toThrow(
        DecisionDNAValidationError
      );
      expect(() => DecisionDNACodec.createZeroDecisionDNA(/regex/ as any)).toThrow(
        DecisionDNAValidationError
      );
      expect(() => DecisionDNACodec.createZeroDecisionDNA(new Map() as any)).toThrow(
        DecisionDNAValidationError
      );
      expect(() => DecisionDNACodec.createZeroDecisionDNA(new Set() as any)).toThrow(
        DecisionDNAValidationError
      );

      class CustomClass {
        prop = "val";
      }
      expect(() => DecisionDNACodec.createZeroDecisionDNA(new CustomClass() as any)).toThrow(
        DecisionDNAValidationError
      );

      // object のプロパティ値として含まれている場合も同様に reject
      expect(() => DecisionDNACodec.createZeroDecisionDNA({ d: new Date() } as any)).toThrow(
        DecisionDNAValidationError
      );
      expect(() => DecisionDNACodec.createZeroDecisionDNA({ m: new Map() } as any)).toThrow(
        DecisionDNAValidationError
      );
      expect(() => DecisionDNACodec.createZeroDecisionDNA({ s: new Set() } as any)).toThrow(
        DecisionDNAValidationError
      );
      expect(() => DecisionDNACodec.createZeroDecisionDNA({ r: /pattern/ } as any)).toThrow(
        DecisionDNAValidationError
      );
      expect(() => DecisionDNACodec.createZeroDecisionDNA({ c: new CustomClass() } as any)).toThrow(
        DecisionDNAValidationError
      );
    });

    it("8. Factory 入口に explicit undefined property ({ foo: undefined }) を渡した場合に reject すること", () => {
      expect(() =>
        DecisionDNACodec.createZeroDecisionDNA({ foo: undefined } as any)
      ).toThrow(DecisionDNAValidationError);
    });

    it("9. Factory 入口に cyclic metadata を渡した場合、RangeError や stack overflow にならず DecisionDNAValidationError として安全に reject すること", () => {
      const cyclic: any = { name: "cycle" };
      cyclic.self = cyclic;

      expect(() => DecisionDNACodec.createZeroDecisionDNA(cyclic)).toThrow(
        DecisionDNAValidationError
      );

      // ネストされた循環参照
      const parent: any = { child: {} };
      parent.child.parent = parent;
      expect(() => DecisionDNACodec.createZeroDecisionDNA(parent)).toThrow(
        DecisionDNAValidationError
      );
    });
  });
});
