import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { GenerationBuilder } from "../../engine/ai/GenerationBuilder.js";
import {
  BuildNextGenerationParams,
  canonicalOffspringDnaRef,
  DEFAULT_GENERATION_BUILDER_CONFIG,
  GenerationBuilderConfig,
  GenerationBuilderConfigurationError,
  GenerationBuilderExecutionError,
  GenerationBuilderIntegrityError,
  GenerationBuildResult,
} from "../../domain/ai/GenerationBuilderTypes.js";
import {
  ComparableEvaluationContext,
  DEFAULT_POPULATION_SELECTION_CONFIG,
  FitnessEvaluationSnapshot,
  PopulationEntry,
  PopulationFitnessEntry,
  PopulationSnapshot,
} from "../../domain/ai/PopulationSelectionTypes.js";
import { DecisionDNACodec } from "../../engine/ai/DecisionDNACodec.js";
import {
  DEFAULT_FITNESS_EVALUATION_CONFIG,
  FitnessEvaluationResult,
} from "../../domain/ai/FitnessEvaluationTypes.js";
import {
  DNA_CONTEXT_DIMENSION,
  DNA_FORMAT_VERSION,
  DNA_PATTERN_DIMENSION,
  SCORING_MODEL_V1,
} from "../../domain/ai/DecisionDNATypes.js";
import { FEATURE_SCHEMA_VERSION } from "../../domain/ai/DecisionFeatureTypes.js";
import { deriveSeed } from "../../engine/random/DeterministicShuffle.js";
import {
  DEFAULT_GENETIC_OPERATOR_CONFIG,
  EVOLUTION_SELECTION_STREAM_KEY,
} from "../../domain/ai/GeneticOperatorTypes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Generation Builder V1 (BP-SIM-AI-GENERATION-BUILDER-V1)", () => {
  const dummyContext: ComparableEvaluationContext = Object.freeze({
    environmentRef: "rules-vnext:playtest",
    regulationId: "light",
    frameId: "entry16",
    rulePackageVersion: "9.1.2",
    fitnessConfig: DEFAULT_FITNESS_EVALUATION_CONFIG,
    generation: 1,
    evaluationScheduleId: "round-robin-v1",
    seedScheduleIdentity: "seed-gen1-fixed",
  });

  const createDummyEntry = (genomeId: string, generation = 1): PopulationEntry => ({
    genomeId,
    dnaRef: `dna-ref-${genomeId}`,
    generation,
    dna: DecisionDNACodec.createZeroDecisionDNA({ id: genomeId, generation }),
  });

  const createFitnessEntry = (
    genomeId: string,
    status: "VALID" | "INSUFFICIENT_EVIDENCE" | "INVALID",
    fitnessScore: number | null,
    context?: ComparableEvaluationContext
  ): PopulationFitnessEntry => {
    let result: FitnessEvaluationResult;
    if (status === "VALID") {
      result = {
        status: "VALID",
        fitnessScore: fitnessScore ?? 0.0,
        completedMatches: 100,
        completionRate: 1.0,
        scheduledMatches: 100,
        wins: Math.round((fitnessScore ?? 0.0) * 100),
        losses: 100 - Math.round((fitnessScore ?? 0.0) * 100),
        draws: 0,
      };
    } else if (status === "INSUFFICIENT_EVIDENCE") {
      result = {
        status: "INSUFFICIENT_EVIDENCE",
        fitnessScore: null,
        provisionalScore: 0.5,
        completedMatches: 50,
        completionRate: 0.5,
        scheduledMatches: 100,
        wins: 25,
        losses: 25,
        draws: 0,
      };
    } else {
      result = {
        status: "INVALID",
        fitnessScore: null,
        failedMatches: 1,
        scheduledMatches: 100,
      };
    }

    return {
      genomeId,
      result,
      context,
    };
  };

  const createValidPopulationAndFitness = (
    count: number,
    generation = 1,
    context = dummyContext
  ) => {
    const entries: PopulationEntry[] = [];
    const fitnessEntries: PopulationFitnessEntry[] = [];

    for (let i = 0; i < count; i++) {
      const genomeId = `GENOME_${String(i).padStart(4, "0")}`;
      entries.push(createDummyEntry(genomeId, generation));
      // 適応度スコアをバリエーション持たせる
      const score = (i + 1) / (count + 1);
      fitnessEntries.push(createFitnessEntry(genomeId, "VALID", score, context));
    }

    const population: PopulationSnapshot = Object.freeze({
      generation,
      entries: Object.freeze(entries),
    });

    const fitnessSnapshot: FitnessEvaluationSnapshot = Object.freeze({
      generation,
      context,
      entries: Object.freeze(fitnessEntries),
    });

    return { population, fitnessSnapshot };
  };

  // ===========================================================================
  // Tests 1-10: Config & Input Validation (Fail-Fast)
  // ===========================================================================
  describe("1. Configuration and Input Validation", () => {
    it("Test 1: Default configuration applies correctly (populationSize=100, eliteCount=1)", () => {
      const { population, fitnessSnapshot } = createValidPopulationAndFitness(100, 1);
      const result = GenerationBuilder.buildNextGeneration({
        population,
        fitnessSnapshot,
        targetGeneration: 2,
        generationSeed: 12345,
      });

      expect(result.populationSize).toBe(100);
      expect(result.eliteCount).toBe(1);
      expect(result.offspringCount).toBe(99);
      expect(result.population.entries.length).toBe(100);
      expect(result.eliteGenomeIds.length).toBe(1);
      expect(result.offspringLineages.length).toBe(99);
    });

    it("Test 2: Partial configuration override works correctly", () => {
      const { population, fitnessSnapshot } = createValidPopulationAndFitness(10, 1);
      const result = GenerationBuilder.buildNextGeneration({
        population,
        fitnessSnapshot,
        targetGeneration: 2,
        generationSeed: 12345,
        config: {
          populationSize: 8,
          selectionConfig: {
            eliteCount: 2,
          },
        },
      });

      expect(result.populationSize).toBe(8);
      expect(result.eliteCount).toBe(2);
      expect(result.offspringCount).toBe(6);
      expect(result.population.entries.length).toBe(8);
      expect(result.eliteGenomeIds.length).toBe(2);
      expect(result.offspringLineages.length).toBe(6);
    });

    it("Test 3: Invalid populationSize (< 2, non-integer, NaN) throws GenerationBuilderConfigurationError", () => {
      const { population, fitnessSnapshot } = createValidPopulationAndFitness(10, 1);
      const invalidSizes = [1, 0, -1, 1.5, NaN, Infinity, -Infinity];

      for (const size of invalidSizes) {
        expect(() => {
          GenerationBuilder.buildNextGeneration({
            population,
            fitnessSnapshot,
            targetGeneration: 2,
            generationSeed: 12345,
            config: { populationSize: size },
          });
        }).toThrow(GenerationBuilderConfigurationError);
      }
    });

    it("Test 4: eliteCount === 0 functions normally (all offspring)", () => {
      const { population, fitnessSnapshot } = createValidPopulationAndFitness(6, 1);
      const result = GenerationBuilder.buildNextGeneration({
        population,
        fitnessSnapshot,
        targetGeneration: 2,
        generationSeed: 12345,
        config: {
          populationSize: 6,
          selectionConfig: { eliteCount: 0 },
        },
      });

      expect(result.eliteCount).toBe(0);
      expect(result.offspringCount).toBe(6);
      expect(result.eliteGenomeIds).toEqual([]);
      expect(result.offspringLineages.length).toBe(6);
      expect(result.population.entries.length).toBe(6);
    });

    it("Test 5: eliteCount === 1 functions normally (1 elite, remaining offspring)", () => {
      const { population, fitnessSnapshot } = createValidPopulationAndFitness(6, 1);
      const result = GenerationBuilder.buildNextGeneration({
        population,
        fitnessSnapshot,
        targetGeneration: 2,
        generationSeed: 12345,
        config: {
          populationSize: 6,
          selectionConfig: { eliteCount: 1 },
        },
      });

      expect(result.eliteCount).toBe(1);
      expect(result.offspringCount).toBe(5);
      expect(result.eliteGenomeIds.length).toBe(1);
      expect(result.offspringLineages.length).toBe(5);
    });

    it("Test 6: eliteCount >= populationSize throws GenerationBuilderConfigurationError", () => {
      const { population, fitnessSnapshot } = createValidPopulationAndFitness(6, 1);
      expect(() => {
        GenerationBuilder.buildNextGeneration({
          population,
          fitnessSnapshot,
          targetGeneration: 2,
          generationSeed: 12345,
          config: {
            populationSize: 6,
            selectionConfig: { eliteCount: 6 },
          },
        });
      }).toThrow(GenerationBuilderConfigurationError);

      expect(() => {
        GenerationBuilder.buildNextGeneration({
          population,
          fitnessSnapshot,
          targetGeneration: 2,
          generationSeed: 12345,
          config: {
            populationSize: 6,
            selectionConfig: { eliteCount: 10 },
          },
        });
      }).toThrow(GenerationBuilderConfigurationError);
    });

    it("Test 7: Invalid eliteCount (negative, float, NaN) throws GenerationBuilderConfigurationError", () => {
      const { population, fitnessSnapshot } = createValidPopulationAndFitness(6, 1);
      const invalidEliteCounts = [-1, -5, 1.5, 0.5, NaN, Infinity, -Infinity];

      for (const eliteCount of invalidEliteCounts) {
        expect(() => {
          GenerationBuilder.buildNextGeneration({
            population,
            fitnessSnapshot,
            targetGeneration: 2,
            generationSeed: 12345,
            config: {
              populationSize: 6,
              selectionConfig: { eliteCount },
            },
          });
        }).toThrow(GenerationBuilderConfigurationError);
      }
    });

    it("Test 8: Generation and context alignment mismatch throws GenerationBuilderConfigurationError", () => {
      const { population, fitnessSnapshot } = createValidPopulationAndFitness(6, 1);
      const invalidTargetGens = [1, 0, 3, 10];

      for (const targetGen of invalidTargetGens) {
        expect(() => {
          GenerationBuilder.buildNextGeneration({
            population,
            fitnessSnapshot,
            targetGeneration: targetGen,
            generationSeed: 12345,
            config: { populationSize: 6 },
          });
        }).toThrow(GenerationBuilderConfigurationError);
      }

      const mismatchedFitnessSnapshot: FitnessEvaluationSnapshot = {
        ...fitnessSnapshot,
        generation: 2,
      };

      expect(() => {
        GenerationBuilder.buildNextGeneration({
          population,
          fitnessSnapshot: mismatchedFitnessSnapshot,
          targetGeneration: 2,
          generationSeed: 12345,
          config: { populationSize: 6 },
        });
      }).toThrow(GenerationBuilderConfigurationError);

      const mismatchedContextSnapshot: FitnessEvaluationSnapshot = {
        ...fitnessSnapshot,
        context: { ...dummyContext, generation: 99 },
      };

      expect(() => {
        GenerationBuilder.buildNextGeneration({
          population,
          fitnessSnapshot: mismatchedContextSnapshot,
          targetGeneration: 2,
          generationSeed: 12345,
          config: { populationSize: 6 },
        });
      }).toThrow(GenerationBuilderConfigurationError);
    });

    it("Test 9: Invalid generationSeed (NaN, Infinity, float) throws GenerationBuilderConfigurationError", () => {
      const { population, fitnessSnapshot } = createValidPopulationAndFitness(6, 1);
      const invalidSeeds = [NaN, Infinity, -Infinity, 12.34];

      for (const seed of invalidSeeds) {
        expect(() => {
          GenerationBuilder.buildNextGeneration({
            population,
            fitnessSnapshot,
            targetGeneration: 2,
            generationSeed: seed,
            config: { populationSize: 6 },
          });
        }).toThrow(GenerationBuilderConfigurationError);
      }
    });

    it("Test 10: GenerationBuilderConfig contains no custom resolver and rejects dynamic injection", () => {
      // 1. Compile-time evidence: GenerationBuilderConfig 型に offspringDnaRefResolver は存在しない
      const validConfig: GenerationBuilderConfig = {
        populationSize: 6,
        selectionConfig: DEFAULT_POPULATION_SELECTION_CONFIG,
        geneticOperatorConfig: DEFAULT_GENETIC_OPERATOR_CONFIG,
      };
      expect(validConfig).toBeDefined();

      type ConfigHasResolver = "offspringDnaRefResolver" extends keyof GenerationBuilderConfig ? true : false;
      const hasResolver: ConfigHasResolver = false;
      expect(hasResolver).toBe(false);

      const _invalidConfigWithResolver: GenerationBuilderConfig = {
        populationSize: 6,
        selectionConfig: DEFAULT_POPULATION_SELECTION_CONFIG,
        geneticOperatorConfig: DEFAULT_GENETIC_OPERATOR_CONFIG,
        // @ts-expect-error offspringDnaRefResolver does not exist on GenerationBuilderConfig
        offspringDnaRefResolver: () => "custom",
      };
      expect(_invalidConfigWithResolver).toBeDefined();

      // 2. Runtime dynamic injection evidence: params.config 内部へ注入されても無視され canonical dnaRef のみ使用される
      const { population, fitnessSnapshot } = createValidPopulationAndFitness(6, 1);
      const paramsWithInjectedConfig: any = {
        population,
        fitnessSnapshot,
        targetGeneration: 2,
        generationSeed: 12345,
        config: {
          populationSize: 6,
          selectionConfig: { eliteCount: 1 },
          offspringDnaRefResolver: () => "custom-injected-ref",
        },
      };

      const result = GenerationBuilder.buildNextGeneration(paramsWithInjectedConfig);
      // 子個体の dnaRef は custom ではなく必ず canonicalOffspringDnaRef ("genome:...") となる
      const offspringEntries = result.population.entries.slice(1);
      for (const entry of offspringEntries) {
        expect(entry.dnaRef).toBe(`genome:${entry.genomeId}`);
        expect(entry.dnaRef).not.toBe("custom-injected-ref");
      }
    });
  });

  // ===========================================================================
  // Tests 11-19: Readiness & Fail-Closed Gate
  // ===========================================================================
  describe("2. Readiness Assessment and Fail-Closed Gate", () => {
    it("Test 11: REEVALUATION_REQUIRED status throws GenerationBuilderExecutionError with readinessStatus", () => {
      // 4個体のうち 1個体のみ VALID、残り 3個体 INSUFFICIENT (minimumValidPopulationCount=2 未満)
      const entries = [
        createDummyEntry("G0"),
        createDummyEntry("G1"),
        createDummyEntry("G2"),
        createDummyEntry("G3"),
      ];
      const fitnessEntries = [
        createFitnessEntry("G0", "VALID", 0.9, dummyContext),
        createFitnessEntry("G1", "INSUFFICIENT_EVIDENCE", null, dummyContext),
        createFitnessEntry("G2", "INSUFFICIENT_EVIDENCE", null, dummyContext),
        createFitnessEntry("G3", "INSUFFICIENT_EVIDENCE", null, dummyContext),
      ];

      const population: PopulationSnapshot = { generation: 1, entries };
      const fitnessSnapshot: FitnessEvaluationSnapshot = {
        generation: 1,
        context: dummyContext,
        entries: fitnessEntries,
      };

      try {
        GenerationBuilder.buildNextGeneration({
          population,
          fitnessSnapshot,
          targetGeneration: 2,
          generationSeed: 12345,
          config: { populationSize: 4 },
        });
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(GenerationBuilderExecutionError);
        const execErr = err as GenerationBuilderExecutionError;
        expect(execErr.readinessStatus).toBe("REEVALUATION_REQUIRED");
      }
    });

    it("Test 12: INVALID_POPULATION status throws GenerationBuilderIntegrityError", () => {
      // fitnessSnapshot の entries が population と不一致
      const entries = [createDummyEntry("G0"), createDummyEntry("G1")];
      const fitnessEntries = [
        createFitnessEntry("DIFFERENT_ID_0", "VALID", 0.9, dummyContext),
        createFitnessEntry("DIFFERENT_ID_1", "VALID", 0.8, dummyContext),
      ];

      const population: PopulationSnapshot = { generation: 1, entries };
      const fitnessSnapshot: FitnessEvaluationSnapshot = {
        generation: 1,
        context: dummyContext,
        entries: fitnessEntries,
      };

      expect(() => {
        GenerationBuilder.buildNextGeneration({
          population,
          fitnessSnapshot,
          targetGeneration: 2,
          generationSeed: 12345,
          config: { populationSize: 4 },
        });
      }).toThrow(GenerationBuilderIntegrityError);
    });

    it("Test 13: INCOMPARABLE_EVALUATION status throws GenerationBuilderExecutionError", () => {
      const entries = [createDummyEntry("G0"), createDummyEntry("G1")];
      const differentContext = { ...dummyContext, rulePackageVersion: "10.0.0" };
      const fitnessEntries = [
        createFitnessEntry("G0", "VALID", 0.9, dummyContext),
        createFitnessEntry("G1", "VALID", 0.8, differentContext),
      ];

      const population: PopulationSnapshot = { generation: 1, entries };
      const fitnessSnapshot: FitnessEvaluationSnapshot = {
        generation: 1,
        context: dummyContext,
        entries: fitnessEntries,
      };

      try {
        GenerationBuilder.buildNextGeneration({
          population,
          fitnessSnapshot,
          targetGeneration: 2,
          generationSeed: 12345,
          config: { populationSize: 4 },
        });
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(GenerationBuilderExecutionError);
        const execErr = err as GenerationBuilderExecutionError;
        expect(execErr.readinessStatus).toBe("INCOMPARABLE_EVALUATION");
      }
    });

    it("Test 14: Effective Readiness failure (validCount < eliteCount) throws GenerationBuilderExecutionError (REEVALUATION_REQUIRED)", () => {
      // VALID 3体, INSUFFICIENT 2体, eliteCount 4
      // assessReadiness では minValid 2 <= validCount 3 なので READY だが、
      // eliteCount 4 > validCount 3 により Effective Readiness が失敗する
      const entries = [
        createDummyEntry("G0"),
        createDummyEntry("G1"),
        createDummyEntry("G2"),
        createDummyEntry("G3"),
        createDummyEntry("G4"),
      ];
      const fitnessEntries = [
        createFitnessEntry("G0", "VALID", 0.9, dummyContext),
        createFitnessEntry("G1", "VALID", 0.8, dummyContext),
        createFitnessEntry("G2", "VALID", 0.7, dummyContext),
        createFitnessEntry("G3", "INSUFFICIENT_EVIDENCE", null, dummyContext),
        createFitnessEntry("G4", "INSUFFICIENT_EVIDENCE", null, dummyContext),
      ];

      const population: PopulationSnapshot = { generation: 1, entries };
      const fitnessSnapshot: FitnessEvaluationSnapshot = {
        generation: 1,
        context: dummyContext,
        entries: fitnessEntries,
      };

      try {
        GenerationBuilder.buildNextGeneration({
          population,
          fitnessSnapshot,
          targetGeneration: 2,
          generationSeed: 12345,
          config: {
            populationSize: 6,
            selectionConfig: {
              minimumValidPopulationCount: 2,
              tournamentSize: 2,
              eliteCount: 4,
            },
          },
        });
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(GenerationBuilderExecutionError);
        const execErr = err as GenerationBuilderExecutionError;
        expect(execErr.readinessStatus).toBe("REEVALUATION_REQUIRED");
      }
    });

    it("Test 15: Effective Readiness exact match (validCount === eliteCount) succeeds", () => {
      // VALID 3体, INSUFFICIENT 1体, eliteCount 3
      const entries = [
        createDummyEntry("G0"),
        createDummyEntry("G1"),
        createDummyEntry("G2"),
        createDummyEntry("G3"),
      ];
      const fitnessEntries = [
        createFitnessEntry("G0", "VALID", 0.9, dummyContext),
        createFitnessEntry("G1", "VALID", 0.8, dummyContext),
        createFitnessEntry("G2", "VALID", 0.7, dummyContext),
        createFitnessEntry("G3", "INSUFFICIENT_EVIDENCE", null, dummyContext),
      ];

      const population: PopulationSnapshot = { generation: 1, entries };
      const fitnessSnapshot: FitnessEvaluationSnapshot = {
        generation: 1,
        context: dummyContext,
        entries: fitnessEntries,
      };

      const result = GenerationBuilder.buildNextGeneration({
        population,
        fitnessSnapshot,
        targetGeneration: 2,
        generationSeed: 12345,
        config: {
          populationSize: 5,
          selectionConfig: {
            minimumValidPopulationCount: 2,
            tournamentSize: 2,
            eliteCount: 3,
          },
        },
      });

      expect(result.eliteCount).toBe(3);
      expect(result.offspringCount).toBe(2);
      expect(result.eliteGenomeIds).toEqual(["G0", "G1", "G2"]);
    });

    it("Test 16: Never auto-reduces eliteCount when valid candidates are insufficient", () => {
      // Test 14 と同様の状況で、eliteCount を自動で 3 に削減せず必ず例外終了することを確認
      const entries = [
        createDummyEntry("G0"),
        createDummyEntry("G1"),
        createDummyEntry("G2"),
      ];
      const fitnessEntries = [
        createFitnessEntry("G0", "VALID", 0.9, dummyContext),
        createFitnessEntry("G1", "VALID", 0.8, dummyContext),
        createFitnessEntry("G2", "INSUFFICIENT_EVIDENCE", null, dummyContext),
      ];

      const population: PopulationSnapshot = { generation: 1, entries };
      const fitnessSnapshot: FitnessEvaluationSnapshot = {
        generation: 1,
        context: dummyContext,
        entries: fitnessEntries,
      };

      expect(() => {
        GenerationBuilder.buildNextGeneration({
          population,
          fitnessSnapshot,
          targetGeneration: 2,
          generationSeed: 12345,
          config: {
            populationSize: 4,
            selectionConfig: {
              minimumValidPopulationCount: 2,
              eliteCount: 3, // validCount is 2
            },
          },
        });
      }).toThrow(GenerationBuilderExecutionError);
    });

    it("Test 17: Candidate with 0.0 fitness is eligible for selection and elite", () => {
      const entries = [createDummyEntry("G0"), createDummyEntry("G1")];
      const fitnessEntries = [
        createFitnessEntry("G0", "VALID", 0.0, dummyContext),
        createFitnessEntry("G1", "VALID", 0.0, dummyContext),
      ];

      const population: PopulationSnapshot = { generation: 1, entries };
      const fitnessSnapshot: FitnessEvaluationSnapshot = {
        generation: 1,
        context: dummyContext,
        entries: fitnessEntries,
      };

      const result = GenerationBuilder.buildNextGeneration({
        population,
        fitnessSnapshot,
        targetGeneration: 2,
        generationSeed: 12345,
        config: {
          populationSize: 4,
          selectionConfig: {
            minimumValidPopulationCount: 2,
            tournamentSize: 2,
            eliteCount: 1,
          },
        },
      });

      expect(result.eliteCount).toBe(1);
      expect(result.population.entries.length).toBe(4);
    });

    it("Test 18: INSUFFICIENT_EVIDENCE candidates are never selected as elite or parents", () => {
      const entries = [
        createDummyEntry("V0"),
        createDummyEntry("V1"),
        createDummyEntry("V2"),
        createDummyEntry("INSUF_A"),
        createDummyEntry("INSUF_B"),
      ];
      const fitnessEntries = [
        createFitnessEntry("V0", "VALID", 0.9, dummyContext),
        createFitnessEntry("V1", "VALID", 0.8, dummyContext),
        createFitnessEntry("V2", "VALID", 0.7, dummyContext),
        createFitnessEntry("INSUF_A", "INSUFFICIENT_EVIDENCE", null, dummyContext),
        createFitnessEntry("INSUF_B", "INSUFFICIENT_EVIDENCE", null, dummyContext),
      ];

      const population: PopulationSnapshot = { generation: 1, entries };
      const fitnessSnapshot: FitnessEvaluationSnapshot = {
        generation: 1,
        context: dummyContext,
        entries: fitnessEntries,
      };

      const result = GenerationBuilder.buildNextGeneration({
        population,
        fitnessSnapshot,
        targetGeneration: 2,
        generationSeed: 12345,
        config: {
          populationSize: 6,
          selectionConfig: {
            minimumValidPopulationCount: 2,
            tournamentSize: 2,
            eliteCount: 2,
          },
        },
      });

      expect(result.eliteGenomeIds).not.toContain("INSUF_A");
      expect(result.eliteGenomeIds).not.toContain("INSUF_B");

      for (const lineage of result.offspringLineages) {
        expect(lineage.parentGenomeIds).not.toContain("INSUF_A");
        expect(lineage.parentGenomeIds).not.toContain("INSUF_B");
      }
    });

    it("Test 19: INVALID candidates are never selected as elite or parents", () => {
      const entries = [
        createDummyEntry("V0"),
        createDummyEntry("V1"),
        createDummyEntry("V2"),
        createDummyEntry("INV_A"),
      ];
      const fitnessEntries = [
        createFitnessEntry("V0", "VALID", 0.9, dummyContext),
        createFitnessEntry("V1", "VALID", 0.8, dummyContext),
        createFitnessEntry("V2", "VALID", 0.7, dummyContext),
        createFitnessEntry("INV_A", "INVALID", null, dummyContext),
      ];

      const population: PopulationSnapshot = { generation: 1, entries };
      const fitnessSnapshot: FitnessEvaluationSnapshot = {
        generation: 1,
        context: dummyContext,
        entries: fitnessEntries,
      };

      const result = GenerationBuilder.buildNextGeneration({
        population,
        fitnessSnapshot,
        targetGeneration: 2,
        generationSeed: 12345,
        config: {
          populationSize: 6,
          selectionConfig: {
            minimumValidPopulationCount: 2,
            tournamentSize: 2,
            eliteCount: 2,
          },
        },
      });

      expect(result.eliteGenomeIds).not.toContain("INV_A");
      for (const lineage of result.offspringLineages) {
        expect(lineage.parentGenomeIds).not.toContain("INV_A");
      }
    });
  });

  // ===========================================================================
  // Tests 20-25: Elite Preservation & Isolation Contract
  // ===========================================================================
  describe("3. Elite Preservation and Isolation Contract", () => {
    it("Test 20: Elite genomeId and dnaRef are preserved exactly", () => {
      const { population, fitnessSnapshot } = createValidPopulationAndFitness(6, 1);
      const result = GenerationBuilder.buildNextGeneration({
        population,
        fitnessSnapshot,
        targetGeneration: 2,
        generationSeed: 12345,
        config: {
          populationSize: 6,
          selectionConfig: { eliteCount: 2 },
        },
      });

      // 最高適応度は G0005, 次点が G0004
      expect(result.eliteGenomeIds).toEqual(["GENOME_0005", "GENOME_0004"]);
      const elite0 = result.population.entries[0];
      const elite1 = result.population.entries[1];

      expect(elite0.genomeId).toBe("GENOME_0005");
      expect(elite0.dnaRef).toBe("dna-ref-GENOME_0005");
      expect(elite1.genomeId).toBe("GENOME_0004");
      expect(elite1.dnaRef).toBe("dna-ref-GENOME_0004");
    });

    it("Test 21: Elite DNA weights match bit-for-bit", () => {
      const { population, fitnessSnapshot } = createValidPopulationAndFitness(6, 1);
      const originalEliteEntry = population.entries.find(e => e.genomeId === "GENOME_0005")!;

      const result = GenerationBuilder.buildNextGeneration({
        population,
        fitnessSnapshot,
        targetGeneration: 2,
        generationSeed: 12345,
        config: {
          populationSize: 6,
          selectionConfig: { eliteCount: 1 },
        },
      });

      const nextEliteEntry = result.population.entries[0];
      expect(nextEliteEntry.dna.patternWeights).toEqual(originalEliteEntry.dna.patternWeights);
      expect(nextEliteEntry.dna.contextPatternWeights).toEqual(
        originalEliteEntry.dna.contextPatternWeights
      );
    });

    it("Test 22: Elite DNA is deep-cloned and reference-isolated (Clone Isolation)", () => {
      const { population, fitnessSnapshot } = createValidPopulationAndFitness(6, 1);
      const originalEliteEntry = population.entries.find(e => e.genomeId === "GENOME_0005")!;

      const result = GenerationBuilder.buildNextGeneration({
        population,
        fitnessSnapshot,
        targetGeneration: 2,
        generationSeed: 12345,
        config: {
          populationSize: 6,
          selectionConfig: { eliteCount: 1 },
        },
      });

      const nextEliteEntry = result.population.entries[0];
      expect(nextEliteEntry.dna).not.toBe(originalEliteEntry.dna);
      expect(nextEliteEntry.dna.patternWeights).not.toBe(originalEliteEntry.dna.patternWeights);
      expect(nextEliteEntry.dna.contextPatternWeights).not.toBe(
        originalEliteEntry.dna.contextPatternWeights
      );
      expect(nextEliteEntry.dna.metadata).not.toBe(originalEliteEntry.dna.metadata);
    });

    it("Test 23: Elite DNA metadata preserves original id and generation", () => {
      const { population, fitnessSnapshot } = createValidPopulationAndFitness(6, 1);
      const originalEliteEntry = population.entries.find(e => e.genomeId === "GENOME_0005")!;

      const result = GenerationBuilder.buildNextGeneration({
        population,
        fitnessSnapshot,
        targetGeneration: 2,
        generationSeed: 12345,
        config: {
          populationSize: 6,
          selectionConfig: { eliteCount: 1 },
        },
      });

      const nextEliteEntry = result.population.entries[0];
      expect(nextEliteEntry.dna.metadata.id).toBe(originalEliteEntry.dna.metadata.id);
      expect(nextEliteEntry.dna.metadata.generation).toBe(originalEliteEntry.dna.metadata.generation);
      expect(nextEliteEntry.dna.metadata.generation).toBe(1);
    });

    it("Test 24: Elite entry generation in snapshot is updated to targetGeneration", () => {
      const { population, fitnessSnapshot } = createValidPopulationAndFitness(6, 1);
      const result = GenerationBuilder.buildNextGeneration({
        population,
        fitnessSnapshot,
        targetGeneration: 2,
        generationSeed: 12345,
        config: {
          populationSize: 6,
          selectionConfig: { eliteCount: 1 },
        },
      });

      const nextEliteEntry = result.population.entries[0];
      expect(nextEliteEntry.generation).toBe(2);
    });

    it("Test 25: Elite entry has no fitness score contamination", () => {
      const { population, fitnessSnapshot } = createValidPopulationAndFitness(6, 1);
      const result = GenerationBuilder.buildNextGeneration({
        population,
        fitnessSnapshot,
        targetGeneration: 2,
        generationSeed: 12345,
        config: {
          populationSize: 6,
          selectionConfig: { eliteCount: 1 },
        },
      });

      const nextEliteEntry = result.population.entries[0];
      expect((nextEliteEntry as any).fitnessScore).toBeUndefined();
      expect((nextEliteEntry.dna as any).fitnessScore).toBeUndefined();
    });
  });

  // ===========================================================================
  // Tests 26-32: Offspring & Assembly Contract
  // ===========================================================================
  describe("4. Offspring and Assembly Contract", () => {
    it("Test 26: Offspring count exactly equals populationSize - eliteCount", () => {
      const { population, fitnessSnapshot } = createValidPopulationAndFitness(10, 1);
      const result = GenerationBuilder.buildNextGeneration({
        population,
        fitnessSnapshot,
        targetGeneration: 2,
        generationSeed: 12345,
        config: {
          populationSize: 10,
          selectionConfig: { eliteCount: 3 },
        },
      });

      expect(result.offspringCount).toBe(7);
      expect(result.offspringLineages.length).toBe(7);
      const offspringEntries = result.population.entries.slice(3);
      expect(offspringEntries.length).toBe(7);
    });

    it("Test 27: Offspring genomeId matches canonical format gen-{gen:06d}-offspring-{index:06d}", () => {
      const gen4Context: ComparableEvaluationContext = {
        ...dummyContext,
        generation: 4,
      };
      const { population, fitnessSnapshot } = createValidPopulationAndFitness(6, 4, gen4Context);
      const result = GenerationBuilder.buildNextGeneration({
        population,
        fitnessSnapshot,
        targetGeneration: 5,
        generationSeed: 12345,
        config: {
          populationSize: 6,
          selectionConfig: { eliteCount: 1 },
        },
      });

      const offspringEntries = result.population.entries.slice(1);
      expect(offspringEntries[0].genomeId).toBe("gen-000005-offspring-000000");
      expect(offspringEntries[1].genomeId).toBe("gen-000005-offspring-000001");
      expect(offspringEntries[2].genomeId).toBe("gen-000005-offspring-000002");
      expect(offspringEntries[3].genomeId).toBe("gen-000005-offspring-000003");
      expect(offspringEntries[4].genomeId).toBe("gen-000005-offspring-000004");
    });

    it("Test 28: Offspring lineages assign offspringIndex sequentially from 0 to M-1", () => {
      const { population, fitnessSnapshot } = createValidPopulationAndFitness(6, 1);
      const result = GenerationBuilder.buildNextGeneration({
        population,
        fitnessSnapshot,
        targetGeneration: 2,
        generationSeed: 12345,
        config: {
          populationSize: 6,
          selectionConfig: { eliteCount: 1 },
        },
      });

      for (let i = 0; i < result.offspringLineages.length; i++) {
        expect(result.offspringLineages[i].offspringIndex).toBe(i);
      }
    });

    it("Test 29: Offspring dnaRef matches canonical format genome:{genomeId}", () => {
      const { population, fitnessSnapshot } = createValidPopulationAndFitness(6, 1);
      const result = GenerationBuilder.buildNextGeneration({
        population,
        fitnessSnapshot,
        targetGeneration: 2,
        generationSeed: 12345,
        config: {
          populationSize: 6,
          selectionConfig: { eliteCount: 1 },
        },
      });

      const offspringEntries = result.population.entries.slice(1);
      for (const entry of offspringEntries) {
        expect(entry.dnaRef).toBe(canonicalOffspringDnaRef(entry.genomeId));
        expect(entry.dnaRef).toBe(`genome:${entry.genomeId}`);
      }
    });

    it("Test 30: Offspring generation in snapshot equals targetGeneration", () => {
      const { population, fitnessSnapshot } = createValidPopulationAndFitness(6, 1);
      const result = GenerationBuilder.buildNextGeneration({
        population,
        fitnessSnapshot,
        targetGeneration: 2,
        generationSeed: 12345,
        config: {
          populationSize: 6,
          selectionConfig: { eliteCount: 1 },
        },
      });

      const offspringEntries = result.population.entries.slice(1);
      for (const entry of offspringEntries) {
        expect(entry.generation).toBe(2);
      }
    });

    it("Test 31: All offspring genomeIds are strictly unique", () => {
      const { population, fitnessSnapshot } = createValidPopulationAndFitness(20, 1);
      const result = GenerationBuilder.buildNextGeneration({
        population,
        fitnessSnapshot,
        targetGeneration: 2,
        generationSeed: 12345,
        config: {
          populationSize: 20,
          selectionConfig: { eliteCount: 2 },
        },
      });

      const offspringIds = result.offspringLineages.map(l => l.genomeId);
      const uniqueIds = new Set(offspringIds);
      expect(uniqueIds.size).toBe(offspringIds.length);
    });

    it("Test 32: Assembled population array maintains canonical order [Elites (0..E-1), Offspring (0..M-1)]", () => {
      const { population, fitnessSnapshot } = createValidPopulationAndFitness(6, 1);
      const result = GenerationBuilder.buildNextGeneration({
        population,
        fitnessSnapshot,
        targetGeneration: 2,
        generationSeed: 12345,
        config: {
          populationSize: 6,
          selectionConfig: { eliteCount: 2 },
        },
      });

      const entries = result.population.entries;
      expect(entries.length).toBe(6);
      expect(entries[0].genomeId).toBe(result.eliteGenomeIds[0]);
      expect(entries[1].genomeId).toBe(result.eliteGenomeIds[1]);
      expect(entries[2].genomeId).toBe(result.offspringLineages[0].genomeId);
      expect(entries[3].genomeId).toBe(result.offspringLineages[1].genomeId);
      expect(entries[4].genomeId).toBe(result.offspringLineages[2].genomeId);
      expect(entries[5].genomeId).toBe(result.offspringLineages[3].genomeId);
    });
  });

  // ===========================================================================
  // Tests 33-36: Supported Deterministic Runtime & Determinism Contract
  // ===========================================================================
  describe("5. Supported Deterministic Runtime and Determinism Contract", () => {
    it("Test 33: targetGeneration and Canonical Evolution Stream Key Contract determinism (bit-exact & deep-equal across runs)", () => {
      const { population, fitnessSnapshot } = createValidPopulationAndFitness(10, 1);
      const params: BuildNextGenerationParams = {
        population,
        fitnessSnapshot,
        targetGeneration: 2,
        generationSeed: 77777,
        config: {
          populationSize: 8,
          selectionConfig: { eliteCount: 2 },
        },
      };

      const run1 = GenerationBuilder.buildNextGeneration(params);
      const run2 = GenerationBuilder.buildNextGeneration(params);

      expect(run1).toStrictEqual(run2);
      expect(run1.population).toStrictEqual(run2.population);
      for (let i = 0; i < run1.population.entries.length; i++) {
        expect(run1.population.entries[i].dna.patternWeights).toEqual(
          run2.population.entries[i].dna.patternWeights
        );
        expect(run1.population.entries[i].dna.contextPatternWeights).toEqual(
          run2.population.entries[i].dna.contextPatternWeights
        );
      }
    });

    it("Test 34: Input ordering independence (same output regardless of input entry order)", () => {
      const { population, fitnessSnapshot } = createValidPopulationAndFitness(10, 1);
      const reversedPopulation: PopulationSnapshot = {
        generation: 1,
        entries: Object.freeze([...population.entries].reverse()),
      };
      const reversedFitnessSnapshot: FitnessEvaluationSnapshot = {
        generation: 1,
        context: dummyContext,
        entries: Object.freeze([...fitnessSnapshot.entries].reverse()),
      };

      const resultOriginal = GenerationBuilder.buildNextGeneration({
        population,
        fitnessSnapshot,
        targetGeneration: 2,
        generationSeed: 99999,
        config: {
          populationSize: 8,
          selectionConfig: { eliteCount: 2 },
        },
      });

      const resultReversed = GenerationBuilder.buildNextGeneration({
        population: reversedPopulation,
        fitnessSnapshot: reversedFitnessSnapshot,
        targetGeneration: 2,
        generationSeed: 99999,
        config: {
          populationSize: 8,
          selectionConfig: { eliteCount: 2 },
        },
      });

      expect(resultOriginal).toStrictEqual(resultReversed);
    });

    it("Test 35: Negative Control: changing generationSeed produces different offspring weights in this fixed fixture (Seed Sensitivity)", () => {
      const { population, fitnessSnapshot } = createValidPopulationAndFitness(10, 1);
      const resultSeedA = GenerationBuilder.buildNextGeneration({
        population,
        fitnessSnapshot,
        targetGeneration: 2,
        generationSeed: 10001,
        config: {
          populationSize: 8,
          selectionConfig: { eliteCount: 2 },
        },
      });

      const resultSeedB = GenerationBuilder.buildNextGeneration({
        population,
        fitnessSnapshot,
        targetGeneration: 2,
        generationSeed: 10002,
        config: {
          populationSize: 8,
          selectionConfig: { eliteCount: 2 },
        },
      });

      expect(resultSeedA.selectionSeed).not.toBe(resultSeedB.selectionSeed);
      // この固定 fixture において世代シードの変更により親選択・重みに差が生じることを Negative Control として確認
      expect(resultSeedA.offspringLineages).not.toEqual(resultSeedB.offspringLineages);
      expect(resultSeedA.population.entries[2].dna.patternWeights).not.toEqual(
        resultSeedB.population.entries[2].dna.patternWeights
      );
    });

    it("Test 36: Supported Deterministic Runtime boundary specification verification", () => {
      // Determinism Contract は Supported Deterministic Runtime 上で保証され、
      // 異なる JavaScript エンジンやプラットフォーム間の絶対一致（Cross-Platform）は Conformance Target であり
      // Universal Contract として要求しない境界仕様を確認する
      expect(typeof process.versions.node).toBe("string");
      expect(typeof process.versions.v8).toBe("string");
      const { population, fitnessSnapshot } = createValidPopulationAndFitness(4, 1);
      const res = GenerationBuilder.buildNextGeneration({
        population,
        fitnessSnapshot,
        targetGeneration: 2,
        generationSeed: 54321,
        config: { populationSize: 4, selectionConfig: { eliteCount: 1 } },
      });
      expect(res.generationSeed).toBe(54321);
    });
  });

  // ===========================================================================
  // Tests 37-45: Implementation Guard Tests
  // ===========================================================================
  describe("6. Implementation Guard Tests", () => {
    it("Test 37: generationSeed = 0 is valid and operates normally", () => {
      const { population, fitnessSnapshot } = createValidPopulationAndFitness(6, 1);
      const result = GenerationBuilder.buildNextGeneration({
        population,
        fitnessSnapshot,
        targetGeneration: 2,
        generationSeed: 0,
        config: { populationSize: 6, selectionConfig: { eliteCount: 1 } },
      });

      expect(result.generationSeed).toBe(0);
      expect(result.selectionSeed).toBe(deriveSeed(0, EVOLUTION_SELECTION_STREAM_KEY));
      expect(result.population.entries.length).toBe(6);
    });

    it("Test 38: Seed Derivation Vector verification (generationSeed = 12345 yields selectionSeed = 1967515842)", () => {
      const { population, fitnessSnapshot } = createValidPopulationAndFitness(6, 1);
      const result = GenerationBuilder.buildNextGeneration({
        population,
        fitnessSnapshot,
        targetGeneration: 2,
        generationSeed: 12345,
        config: { populationSize: 6, selectionConfig: { eliteCount: 1 } },
      });

      const expectedSelectionSeed = deriveSeed(12345, EVOLUTION_SELECTION_STREAM_KEY);
      expect(result.selectionSeed).toBe(expectedSelectionSeed);
      expect(result.selectionSeed).toBe(1967515842);
    });

    it("Test 39: Elite and Offspring ID collision throws GenerationBuilderIntegrityError", () => {
      // エリート候補の genomeId が子個体のフォーマット gen-000002-offspring-000000 と衝突する場合
      const collidingId = "gen-000002-offspring-000000";
      const entries = [
        createDummyEntry(collidingId, 1),
        createDummyEntry("OTHER_0", 1),
        createDummyEntry("OTHER_1", 1),
      ];
      const fitnessEntries = [
        createFitnessEntry(collidingId, "VALID", 0.99, dummyContext),
        createFitnessEntry("OTHER_0", "VALID", 0.5, dummyContext),
        createFitnessEntry("OTHER_1", "VALID", 0.4, dummyContext),
      ];

      const population: PopulationSnapshot = { generation: 1, entries };
      const fitnessSnapshot: FitnessEvaluationSnapshot = {
        generation: 1,
        context: dummyContext,
        entries: fitnessEntries,
      };

      expect(() => {
        GenerationBuilder.buildNextGeneration({
          population,
          fitnessSnapshot,
          targetGeneration: 2,
          generationSeed: 12345,
          config: {
            populationSize: 4,
            selectionConfig: {
              minimumValidPopulationCount: 2,
              tournamentSize: 2,
              eliteCount: 1, // collidingId becomes elite
            },
          },
        });
      }).toThrow(GenerationBuilderIntegrityError);
    });

    it("Test 40: Immutability (freeze) verification on result, population, and entries", () => {
      const { population, fitnessSnapshot } = createValidPopulationAndFitness(6, 1);
      const result = GenerationBuilder.buildNextGeneration({
        population,
        fitnessSnapshot,
        targetGeneration: 2,
        generationSeed: 12345,
        config: { populationSize: 6, selectionConfig: { eliteCount: 1 } },
      });

      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.population)).toBe(true);
      expect(Object.isFrozen(result.population.entries)).toBe(true);
      expect(Object.isFrozen(result.eliteGenomeIds)).toBe(true);
      expect(Object.isFrozen(result.offspringLineages)).toBe(true);
      for (const entry of result.population.entries) {
        expect(Object.isFrozen(entry)).toBe(true);
      }
    });

    it("Test 41: Input snapshot and parent DNA immutability verification", () => {
      const { population, fitnessSnapshot } = createValidPopulationAndFitness(6, 1);
      const initialSnapshotJson = JSON.stringify(population);
      const initialFitnessJson = JSON.stringify(fitnessSnapshot);

      GenerationBuilder.buildNextGeneration({
        population,
        fitnessSnapshot,
        targetGeneration: 2,
        generationSeed: 12345,
        config: { populationSize: 6, selectionConfig: { eliteCount: 1 } },
      });

      expect(JSON.stringify(population)).toBe(initialSnapshotJson);
      expect(JSON.stringify(fitnessSnapshot)).toBe(initialFitnessJson);
    });

    it("Test 42: Single-Series parent selection contract ensures parents vary across offspring without PRNG reset", () => {
      const { population, fitnessSnapshot } = createValidPopulationAndFitness(20, 1);
      const result = GenerationBuilder.buildNextGeneration({
        population,
        fitnessSnapshot,
        targetGeneration: 2,
        generationSeed: 55555,
        config: {
          populationSize: 10,
          selectionConfig: { eliteCount: 0, tournamentSize: 2 },
        },
      });

      // 1. Lineage evidence: 10 個の子個体に対して 20 回の親選出が行われ、すべてのペアが同一ではないこと
      const pairs = result.offspringLineages.map(
        l => l.parentGenomeIds.join("-")
      );
      const uniquePairs = new Set(pairs);
      expect(uniquePairs.size).toBeGreaterThan(1);

      // 2. Production Source inspection: PopulationSelector.selectParents が 1 回のみ呼び出される構造であることを確認
      const enginePath = path.resolve(__dirname, "../../engine/ai/GenerationBuilder.ts");
      const engineSource = fs.readFileSync(enginePath, "utf-8");
      const selectParentsCalls = engineSource.match(/PopulationSelector\.selectParents/g);
      expect(selectParentsCalls).not.toBeNull();
      expect(selectParentsCalls!.length).toBe(1);
    });

    it("Test 43: Self-mating integration test (integration path operates deterministically)", () => {
      // 有効候補が 2 個体のみの構成で ParentPairAssembler への委譲パイプラインが正常に完走することを確認
      const entries = [createDummyEntry("G0"), createDummyEntry("G1")];
      const fitnessEntries = [
        createFitnessEntry("G0", "VALID", 0.9, dummyContext),
        createFitnessEntry("G1", "VALID", 0.1, dummyContext),
      ];

      const population: PopulationSnapshot = { generation: 1, entries };
      const fitnessSnapshot: FitnessEvaluationSnapshot = {
        generation: 1,
        context: dummyContext,
        entries: fitnessEntries,
      };

      const result = GenerationBuilder.buildNextGeneration({
        population,
        fitnessSnapshot,
        targetGeneration: 2,
        generationSeed: 88888,
        config: {
          populationSize: 4,
          selectionConfig: {
            minimumValidPopulationCount: 2,
            tournamentSize: 2,
            eliteCount: 0,
          },
        },
      });

      expect(result.offspringLineages.length).toBe(4);
    });

    it("Test 44: Static architecture verification: forbidden modules and APIs are absent", () => {
      const enginePath = path.resolve(__dirname, "../../engine/ai/GenerationBuilder.ts");
      const typesPath = path.resolve(__dirname, "../../domain/ai/GenerationBuilderTypes.ts");

      const engineSource = fs.readFileSync(enginePath, "utf-8");
      const typesSource = fs.readFileSync(typesPath, "utf-8");
      const combined = `${engineSource}\n${typesSource}`;

      expect(combined).not.toContain("Date.now");
      expect(combined).not.toContain("Math.random");
      expect(combined).not.toContain("GameSession");
      expect(combined).not.toContain("RuntimeTelemetry");
      expect(combined).not.toContain("from \"node:fs\"");
      expect(combined).not.toContain("from 'node:fs'");
      expect(combined).not.toContain("from \"fs\"");
      expect(combined).not.toContain("from 'fs'");
      expect(combined).not.toContain("from \"node:path\"");
      expect(combined).not.toContain("from 'node:path'");
      expect(combined).not.toContain("from \"path\"");
      expect(combined).not.toContain("from 'path'");
    });

    it("Test 45: Finding 1 Regression: undefined nested selectionConfig fields resolve to authoritative defaults without NaN", () => {
      const { population, fitnessSnapshot } = createValidPopulationAndFitness(10, 1);
      // eliteCount: undefined を明示的に渡した場合、Authoritative Validator により default eliteCount=1 に解決される
      const result = GenerationBuilder.buildNextGeneration({
        population,
        fitnessSnapshot,
        targetGeneration: 2,
        generationSeed: 12345,
        config: {
          populationSize: 8,
          selectionConfig: {
            eliteCount: undefined,
            tournamentSize: undefined,
            minimumValidPopulationCount: undefined,
          },
        },
      });

      expect(result.eliteCount).toBe(1);
      expect(result.offspringCount).toBe(7);
      expect(Number.isNaN(result.offspringCount)).toBe(false);
      expect(result.population.entries.length).toBe(8);
      expect(result.eliteGenomeIds.length).toBe(1);
      expect(result.offspringLineages.length).toBe(7);
    });
  });
});
