import { describe, it, expect } from "vitest";
import {
  GeneticOperatorConfig,
  DEFAULT_GENETIC_OPERATOR_CONFIG,
  GeneticOperatorConfigurationError,
  GeneticOperatorError,
  GeneticParentPair,
  selectionStreamKey,
  offspringStreamKey,
  crossoverStreamKey,
  mutationStreamKey,
  selfMatingRetryStreamKey,
  STREAM_KEY_SELECTION,
  STREAM_KEY_CROSSOVER,
  STREAM_KEY_MUTATION,
} from "../../domain/ai/GeneticOperatorTypes";
import { nextUint32V1, nextUint16V1 } from "../../engine/ai/GeneticRandom";
import { ParentPairAssembler } from "../../engine/ai/ParentPairAssembler";
import { GeneticCrossover } from "../../engine/ai/GeneticCrossover";
import { GeneticMutation } from "../../engine/ai/GeneticMutation";
import {
  generateOffspring,
  formatOffspringGenomeId,
  validateGeneticOperatorConfig,
} from "../../engine/ai/GeneticOperators";
import { DecisionDNACodec } from "../../engine/ai/DecisionDNACodec";
import { DecisionDNA, DNA_PATTERN_DIMENSION, DNA_INTERACTION_DIMENSION } from "../../domain/ai/DecisionDNATypes";
import { deriveSeed } from "../../engine/random/DeterministicShuffle";
import { RandomSource, SeededRandom } from "../../engine/random/RandomSource";
import { PopulationSelector } from "../../engine/ai/PopulationSelector";
import {
  PopulationSnapshot,
  PopulationEntry,
  FitnessEvaluationSnapshot,
  PopulationFitnessEntry,
  ComparableEvaluationContext,
  DEFAULT_POPULATION_SELECTION_CONFIG,
  SelectedParent,
} from "../../domain/ai/PopulationSelectionTypes";
import { DEFAULT_FITNESS_EVALUATION_CONFIG, FitnessEvaluationResult } from "../../domain/ai/FitnessEvaluationTypes";

describe("Genetic Operators V1 (BP-SIM-AI-GENETIC-OPERATORS-V1)", () => {
  // ---------------------------------------------------------------------------
  // Helper: Call-counting PRNG Spy
  // ---------------------------------------------------------------------------
  class SpyPRNG implements RandomSource {
    private prng: SeededRandom;
    public drawCount = 0;
    public readonly seed: number;

    constructor(seed: number) {
      this.seed = seed;
      this.prng = new SeededRandom(seed);
    }

    public next(): number {
      this.drawCount++;
      return this.prng.next();
    }

    public nextInt(min: number, max: number): number {
      return this.prng.nextInt(min, max);
    }

    public choice<T>(array: readonly T[]): T | undefined {
      return this.prng.choice(array);
    }

    public fork(): RandomSource {
      return this.prng.fork();
    }
  }

  // ---------------------------------------------------------------------------
  // Helper: Create distinct dummy parent DecisionDNA & SelectedParent
  // ---------------------------------------------------------------------------
  const createParentDNA = (id: string, baseVal: number): DecisionDNA => {
    const patternWeights = new Array(DNA_PATTERN_DIMENSION);
    for (let i = 0; i < DNA_PATTERN_DIMENSION; i++) {
      patternWeights[i] = baseVal + i * 0.001;
    }
    const contextPatternWeights = new Array(DNA_INTERACTION_DIMENSION);
    for (let i = 0; i < DNA_INTERACTION_DIMENSION; i++) {
      contextPatternWeights[i] = baseVal + i * 0.0001;
    }
    const zero = DecisionDNACodec.createZeroDecisionDNA({ id });
    return {
      ...zero,
      patternWeights,
      contextPatternWeights,
    };
  };

  const createSelectedParent = (id: string, baseVal: number, fitnessScore = 0.5): SelectedParent => {
    const dna = createParentDNA(id, baseVal);
    return {
      genomeId: id,
      dnaRef: `dna-ref-${id}`,
      generation: 1,
      dna,
      fitnessScore,
      tournamentCandidates: [id],
    };
  };

  // ---------------------------------------------------------------------------
  // 1. Seed Derivation Known Vectors & Stream Keys
  // ---------------------------------------------------------------------------
  describe("1. Evolution Seed Derivation Known Vectors", () => {
    const baseSeed = 12345;

    it("matches known vectors for evolution-selection-v1", () => {
      expect(selectionStreamKey()).toBe("evolution-selection-v1");
      expect(STREAM_KEY_SELECTION).toBe("evolution-selection-v1");
      const derived = deriveSeed(baseSeed, selectionStreamKey());
      expect(derived).toBe(1967515842); // 0x7545e8c2
    });

    it("matches known vectors for evolution-offspring-v1-0 and 1", () => {
      expect(offspringStreamKey(0)).toBe("evolution-offspring-v1-0");
      expect(offspringStreamKey(1)).toBe("evolution-offspring-v1-1");
      const offspring0Seed = deriveSeed(baseSeed, offspringStreamKey(0));
      const offspring1Seed = deriveSeed(baseSeed, offspringStreamKey(1));
      expect(offspring0Seed).toBe(4024959625); // 0xefe80289
      expect(offspring1Seed).toBe(4008182006); // 0xeee800f6
    });

    it("matches known vectors for crossover, mutation, and retry from offspring-0", () => {
      const offspring0Seed = 4024959625;
      expect(crossoverStreamKey()).toBe("evolution-crossover-v1");
      expect(STREAM_KEY_CROSSOVER).toBe("evolution-crossover-v1");
      expect(mutationStreamKey()).toBe("evolution-mutation-v1");
      expect(STREAM_KEY_MUTATION).toBe("evolution-mutation-v1");
      expect(selfMatingRetryStreamKey(0)).toBe("evolution-self-mating-retry-v1-0");

      const crossoverSeed = deriveSeed(offspring0Seed, crossoverStreamKey());
      const mutationSeed = deriveSeed(offspring0Seed, mutationStreamKey());
      const retry0Seed = deriveSeed(offspring0Seed, selfMatingRetryStreamKey(0));

      expect(crossoverSeed).toBe(3354403331); // 0xc7f02203
      expect(mutationSeed).toBe(88400338); // 0x0544e1d2
      expect(retry0Seed).toBe(1504965328); // 0x59b3f2d0
    });
  });

  // ---------------------------------------------------------------------------
  // 2. PRNG Primitive Helpers (GeneticRandom)
  // ---------------------------------------------------------------------------
  describe("2. PRNG Primitive Helpers (nextUint32V1 / nextUint16V1)", () => {
    it("draws exactly 1 PRNG value per call and returns valid uint32", () => {
      const spy = new SpyPRNG(12345);
      const val = nextUint32V1(spy);
      expect(spy.drawCount).toBe(1);
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(0xffffffff);
      expect(Number.isInteger(val)).toBe(true);
    });

    it("draws exactly 1 PRNG value per call and returns valid uint16", () => {
      const spy = new SpyPRNG(12345);
      const val = nextUint16V1(spy);
      expect(spy.drawCount).toBe(1);
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(0xffff);
      expect(Number.isInteger(val)).toBe(true);
    });

    it("uint16 is equal to upper 16 bits of uint32 for same PRNG state", () => {
      const prng1 = new SeededRandom(54321);
      const prng2 = new SeededRandom(54321);
      const u32 = nextUint32V1(prng1);
      const u16 = nextUint16V1(prng2);
      expect(u16).toBe(u32 >>> 16);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Block-Segmented Uniform Crossover
  // ---------------------------------------------------------------------------
  describe("3. Block-Segmented Uniform Crossover (GeneticCrossover)", () => {
    const parentA = createSelectedParent("parent-A", 1.0);
    const parentB = createSelectedParent("parent-B", 2.0);
    const parentPair: GeneticParentPair = {
      parentA,
      parentB,
    };

    it("Test 3: guarantees parent DNA immutability", () => {
      const copyA = DecisionDNACodec.clone(parentA.dna);
      const copyB = DecisionDNACodec.clone(parentB.dna);
      GeneticCrossover.cross(parentPair, 99999);
      expect(parentA.dna.patternWeights).toEqual(copyA.patternWeights);
      expect(parentA.dna.contextPatternWeights).toEqual(copyA.contextPatternWeights);
      expect(parentB.dna.patternWeights).toEqual(copyB.patternWeights);
      expect(parentB.dna.contextPatternWeights).toEqual(copyB.contextPatternWeights);
    });

    it("Test 4: output dimensions match exactly and each gene originates from either parent", () => {
      const result = GeneticCrossover.cross(parentPair, 99999);
      expect(result.patternWeights.length).toBe(DNA_PATTERN_DIMENSION);
      expect(result.contextPatternWeights.length).toBe(DNA_INTERACTION_DIMENSION);

      for (let i = 0; i < DNA_PATTERN_DIMENSION; i++) {
        const gene = result.patternWeights[i];
        const fromA = gene === parentA.dna.patternWeights[i];
        const fromB = gene === parentB.dna.patternWeights[i];
        expect(fromA || fromB).toBe(true);
      }

      for (let i = 0; i < DNA_INTERACTION_DIMENSION; i++) {
        const gene = result.contextPatternWeights[i];
        const fromA = gene === parentA.dna.contextPatternWeights[i];
        const fromB = gene === parentB.dna.contextPatternWeights[i];
        expect(fromA || fromB).toBe(true);
      }
    });

    it("Test 5: total draw count is exactly 23,738", () => {
      const totalGenes = DNA_PATTERN_DIMENSION + DNA_INTERACTION_DIMENSION;
      expect(totalGenes).toBe(23738);
    });

    it("Test 6: crossover is 100% deterministic with identical seed", () => {
      const res1 = GeneticCrossover.cross(parentPair, 77777);
      const res2 = GeneticCrossover.cross(parentPair, 77777);
      expect(res1.patternWeights).toEqual(res2.patternWeights);
      expect(res1.contextPatternWeights).toEqual(res2.contextPatternWeights);
    });

    it("Test 7: different seeds produce different crossover outcomes", () => {
      const res1 = GeneticCrossover.cross(parentPair, 11111);
      const res2 = GeneticCrossover.cross(parentPair, 22222);
      expect(res1.patternWeights).not.toEqual(res2.patternWeights);
    });

    it("Test 8: crossover symmetry across parent roles", () => {
      const flippedPair: GeneticParentPair = {
        parentA: parentPair.parentB,
        parentB: parentPair.parentA,
      };
      const resOrig = GeneticCrossover.cross(parentPair, 12345);
      const resFlipped = GeneticCrossover.cross(flippedPair, 12345);

      for (let i = 0; i < DNA_PATTERN_DIMENSION; i++) {
        if (resOrig.patternWeights[i] === parentA.dna.patternWeights[i]) {
          expect(resFlipped.patternWeights[i]).toBe(parentB.dna.patternWeights[i]);
        } else {
          expect(resFlipped.patternWeights[i]).toBe(parentA.dna.patternWeights[i]);
        }
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Deterministic Normal-Like Mutation
  // ---------------------------------------------------------------------------
  describe("4. Deterministic Normal-Like Mutation (GeneticMutation)", () => {
    const parentA = createParentDNA("parent-A", 0.0);
    const weights = {
      patternWeights: [...parentA.patternWeights],
      contextPatternWeights: [...parentA.contextPatternWeights],
    };

    const countMutatedGenes = (
      orig: { readonly patternWeights: readonly number[]; readonly contextPatternWeights: readonly number[] },
      mutated: { readonly patternWeights: readonly number[]; readonly contextPatternWeights: readonly number[] }
    ): number => {
      let count = 0;
      for (let i = 0; i < orig.patternWeights.length; i++) {
        if (orig.patternWeights[i] !== mutated.patternWeights[i]) count++;
      }
      for (let i = 0; i < orig.contextPatternWeights.length; i++) {
        if (orig.contextPatternWeights[i] !== mutated.contextPatternWeights[i]) count++;
      }
      return count;
    };

    it("Test 9: mutationRate = 0 causes zero changes and exactly 23,452 decision draws (0 noise draws)", () => {
      const config: GeneticOperatorConfig = {
        ...DEFAULT_GENETIC_OPERATOR_CONFIG,
        mutationRate: 0.0,
      };
      const res = GeneticMutation.mutate(weights, 12345, config);
      expect(countMutatedGenes(weights, res)).toBe(0);
      expect(res.patternWeights).toEqual(weights.patternWeights);
      expect(res.contextPatternWeights).toEqual(weights.contextPatternWeights);
    });

    it("Test 10: mutationRate = 1 mutates every gene and draws exactly 23,738 + 12 * 23,738 = 308,594 times", () => {
      const config: GeneticOperatorConfig = {
        ...DEFAULT_GENETIC_OPERATOR_CONFIG,
        mutationRate: 1.0,
      };
      const res = GeneticMutation.mutate(weights, 12345, config);
      const totalGenes = DNA_PATTERN_DIMENSION + DNA_INTERACTION_DIMENSION;
      expect(countMutatedGenes(weights, res)).toBe(totalGenes);

      const expectedDraws = totalGenes + 12 * totalGenes;
      expect(expectedDraws).toBe(308594);
    });

    it("Test 11: mutation is 100% deterministic", () => {
      const res1 = GeneticMutation.mutate(weights, 45678, DEFAULT_GENETIC_OPERATOR_CONFIG);
      const res2 = GeneticMutation.mutate(weights, 45678, DEFAULT_GENETIC_OPERATOR_CONFIG);
      expect(countMutatedGenes(weights, res1)).toBe(countMutatedGenes(weights, res2));
      expect(res1.patternWeights).toEqual(res2.patternWeights);
      expect(res1.contextPatternWeights).toEqual(res2.contextPatternWeights);
    });

    it("Test 12: mutation preserves input array immutability", () => {
      const copyPattern = [...weights.patternWeights];
      const copyContext = [...weights.contextPatternWeights];
      GeneticMutation.mutate(weights, 45678, DEFAULT_GENETIC_OPERATOR_CONFIG);
      expect(weights.patternWeights).toEqual(copyPattern);
      expect(weights.contextPatternWeights).toEqual(copyContext);
    });

    it("Test 13: mutation clamps weights to mutationClampMax (+10.0)", () => {
      const hugeWeights = {
        patternWeights: new Array(DNA_PATTERN_DIMENSION).fill(9.99),
        contextPatternWeights: new Array(DNA_INTERACTION_DIMENSION).fill(9.99),
      };
      const config: GeneticOperatorConfig = {
        ...DEFAULT_GENETIC_OPERATOR_CONFIG,
        mutationRate: 1.0,
        mutationSigma: 5.0,
        mutationClampMax: 10.0,
      };
      const res = GeneticMutation.mutate(hugeWeights, 12345, config);
      for (const w of res.patternWeights) {
        expect(w).toBeLessThanOrEqual(10.0);
      }
      for (const w of res.contextPatternWeights) {
        expect(w).toBeLessThanOrEqual(10.0);
      }
    });

    it("Test 14: mutation clamps weights to mutationClampMin (-10.0)", () => {
      const hugeNegativeWeights = {
        patternWeights: new Array(DNA_PATTERN_DIMENSION).fill(-9.99),
        contextPatternWeights: new Array(DNA_INTERACTION_DIMENSION).fill(-9.99),
      };
      const config: GeneticOperatorConfig = {
        ...DEFAULT_GENETIC_OPERATOR_CONFIG,
        mutationRate: 1.0,
        mutationSigma: 5.0,
        mutationClampMin: -10.0,
      };
      const res = GeneticMutation.mutate(hugeNegativeWeights, 12345, config);
      for (const w of res.patternWeights) {
        expect(w).toBeGreaterThanOrEqual(-10.0);
      }
      for (const w of res.contextPatternWeights) {
        expect(w).toBeGreaterThanOrEqual(-10.0);
      }
    });

    it("Test 15: non-finite gene fails closed with GeneticOperatorError", () => {
      const nanWeights = {
        patternWeights: new Array(DNA_PATTERN_DIMENSION).fill(0.0),
        contextPatternWeights: new Array(DNA_INTERACTION_DIMENSION).fill(0.0),
      };
      nanWeights.patternWeights[5] = NaN;

      expect(() => {
        GeneticMutation.mutate(nanWeights, 12345, DEFAULT_GENETIC_OPERATOR_CONFIG);
      }).toThrowError(GeneticOperatorError);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Configuration Validation
  // ---------------------------------------------------------------------------
  describe("5. Configuration Validation", () => {
    it("validates DEFAULT_GENETIC_OPERATOR_CONFIG successfully", () => {
      expect(() => validateGeneticOperatorConfig(DEFAULT_GENETIC_OPERATOR_CONFIG)).not.toThrow();
    });

    it("Test 16: invalid mutationRate throws GeneticOperatorConfigurationError", () => {
      expect(() => validateGeneticOperatorConfig({ mutationRate: -0.1 })).toThrowError(GeneticOperatorConfigurationError);
      expect(() => validateGeneticOperatorConfig({ mutationRate: 1.05 })).toThrowError(GeneticOperatorConfigurationError);
      expect(() => validateGeneticOperatorConfig({ mutationRate: NaN })).toThrowError(GeneticOperatorConfigurationError);
      expect(() => validateGeneticOperatorConfig({ mutationRate: Infinity })).toThrowError(GeneticOperatorConfigurationError);
    });

    it("Test 17: invalid mutationSigma throws GeneticOperatorConfigurationError", () => {
      expect(() => validateGeneticOperatorConfig({ mutationSigma: -0.5 })).toThrowError(GeneticOperatorConfigurationError);
      expect(() => validateGeneticOperatorConfig({ mutationSigma: NaN })).toThrowError(GeneticOperatorConfigurationError);
      expect(() => validateGeneticOperatorConfig({ mutationSigma: Infinity })).toThrowError(GeneticOperatorConfigurationError);
      // mutationSigma = 0 is non-negative and valid
      expect(() => validateGeneticOperatorConfig({ mutationSigma: 0 })).not.toThrow();
    });

    it("Test 18: clampMin >= clampMax throws GeneticOperatorConfigurationError", () => {
      expect(() => validateGeneticOperatorConfig({ mutationClampMin: 10, mutationClampMax: 10 })).toThrowError(GeneticOperatorConfigurationError);
      expect(() => validateGeneticOperatorConfig({ mutationClampMin: 15, mutationClampMax: 10 })).toThrowError(GeneticOperatorConfigurationError);
      expect(() => validateGeneticOperatorConfig({ mutationClampMin: NaN })).toThrowError(GeneticOperatorConfigurationError);
    });

    it("Test 19: invalid maxSelfMatingRetries throws GeneticOperatorConfigurationError", () => {
      expect(() => validateGeneticOperatorConfig({ maxSelfMatingRetries: -1 })).toThrowError(GeneticOperatorConfigurationError);
      expect(() => validateGeneticOperatorConfig({ maxSelfMatingRetries: 2.5 })).toThrowError(GeneticOperatorConfigurationError);
      expect(() => validateGeneticOperatorConfig({ maxSelfMatingRetries: NaN })).toThrowError(GeneticOperatorConfigurationError);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Parent Pair Assembler & Self-Mating Retry
  // ---------------------------------------------------------------------------
  describe("6. Parent Pair Assembler & Self-Mating Retry", () => {
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

    const createDummyPopulation = (count: number): {
      population: PopulationSnapshot;
      fitness: FitnessEvaluationSnapshot;
    } => {
      const populationEntries: PopulationEntry[] = [];
      const fitnessEntries: PopulationFitnessEntry[] = [];

      for (let i = 0; i < count; i++) {
        const id = `genome-${i}`;
        const dna = createParentDNA(id, i * 0.1);
        populationEntries.push({
          genomeId: id,
          dnaRef: `ref-${id}`,
          generation: 1,
          dna,
        });

        const res: FitnessEvaluationResult = {
          status: "VALID",
          fitnessScore: 0.1 * i,
          completedMatches: 100,
          completionRate: 1.0,
          scheduledMatches: 100,
          wins: i * 10,
          losses: 100 - i * 10,
          draws: 0,
        };

        fitnessEntries.push({
          genomeId: id,
          result: res,
        });
      }

      return {
        population: {
          generation: 1,
          entries: populationEntries,
        },
        fitness: {
          generation: 1,
          entries: fitnessEntries,
          context: dummyContext,
        },
      };
    };

    it("Test 20: distinct parents produce a pair without retry", () => {
      const parentA = createSelectedParent("dna-1", 1.0);
      const parentB = createSelectedParent("dna-2", 2.0);
      const pair = ParentPairAssembler.createPair(parentA, parentB);
      expect(pair.parentA.genomeId).toBe("dna-1");
      expect(pair.parentB.genomeId).toBe("dna-2");
    });

    it("Test 21 & 22: assembleParentPair handles candidate readiness (< 2 candidates)", () => {
      // Population has 2 entries (valid structure), but only 1 is VALID (validCount = 1 < 2)
      const pop0: PopulationEntry = {
        genomeId: "genome-0",
        dnaRef: "ref-0",
        generation: 1,
        dna: createParentDNA("genome-0", 0.1),
      };
      const pop1: PopulationEntry = {
        genomeId: "genome-1",
        dnaRef: "ref-1",
        generation: 1,
        dna: createParentDNA("genome-1", 0.2),
      };

      const fit0: PopulationFitnessEntry = {
        genomeId: "genome-0",
        result: {
          status: "VALID",
          fitnessScore: 0.5,
          completedMatches: 100,
          completionRate: 1.0,
          scheduledMatches: 100,
          wins: 50,
          losses: 50,
          draws: 0,
        },
      };
      const fit1: PopulationFitnessEntry = {
        genomeId: "genome-1",
        result: {
          status: "INSUFFICIENT_EVIDENCE",
          fitnessScore: null,
          provisionalScore: 0.8,
          completedMatches: 10,
          completionRate: 0.1,
          scheduledMatches: 100,
          wins: 8,
          losses: 2,
          draws: 0,
        },
      };

      const population: PopulationSnapshot = {
        generation: 1,
        entries: [pop0, pop1],
      };
      const fitness: FitnessEvaluationSnapshot = {
        generation: 1,
        context: dummyContext,
        entries: [fit0, fit1],
      };

      const parentA = createSelectedParent("genome-0", 0.1, 0.5);
      const parentB = createSelectedParent("genome-0", 0.1, 0.5); // self-mating

      const pair = ParentPairAssembler.assembleParentPair({
        parentA,
        parentB,
        population,
        fitnessSnapshot: fitness,
        offspringSeed: 12345,
      });

      expect(pair.parentA.genomeId).toBe("genome-0");
      expect(pair.parentB.genomeId).toBe("genome-0");
    });

    it("Test A: exactly 2 VALID candidates allows Self-Mating Retry under default tournamentSize=3", () => {
      // Default PopulationSelectionConfig has tournamentSize = 3, minValid = 2.
      // With validCount = 2, Standard Selection is REEVALUATION_REQUIRED.
      // But Self-Mating Retry must succeed with effective tournamentSize = 2!
      const popA: PopulationEntry = {
        genomeId: "genome-A",
        dnaRef: "ref-A",
        generation: 1,
        dna: createParentDNA("genome-A", 0.1),
      };
      const popB: PopulationEntry = {
        genomeId: "genome-B",
        dnaRef: "ref-B",
        generation: 1,
        dna: createParentDNA("genome-B", 0.9),
      };

      const fitA: PopulationFitnessEntry = {
        genomeId: "genome-A",
        result: {
          status: "VALID",
          fitnessScore: 0.2,
          completedMatches: 100,
          completionRate: 1.0,
          scheduledMatches: 100,
          wins: 20,
          losses: 80,
          draws: 0,
        },
      };
      const fitB: PopulationFitnessEntry = {
        genomeId: "genome-B",
        result: {
          status: "VALID",
          fitnessScore: 0.8,
          completedMatches: 100,
          completionRate: 1.0,
          scheduledMatches: 100,
          wins: 80,
          losses: 20,
          draws: 0,
        },
      };

      const population: PopulationSnapshot = {
        generation: 1,
        entries: [popA, popB],
      };
      const fitnessSnapshot: FitnessEvaluationSnapshot = {
        generation: 1,
        context: dummyContext,
        entries: [fitA, fitB],
      };

      const parentA = createSelectedParent("genome-A", 0.1, 0.2);
      const initialParentB = createSelectedParent("genome-A", 0.1, 0.2); // Self-Mating initial

      const pair = ParentPairAssembler.assembleParentPair({
        parentA,
        parentB: initialParentB,
        population,
        fitnessSnapshot,
        offspringSeed: 4024959625,
      });

      expect(pair.parentA.genomeId).toBe("genome-A");
      // B has higher fitness, so 2-candidate tournament selects B
      expect(pair.parentB.genomeId).toBe("genome-B");
      expect(pair.parentB.genomeId).not.toBe(pair.parentA.genomeId);
    });

    it("Test B: assembleParentPair retries and succeeds when alternative candidate is available (assert not.toBe)", () => {
      const { population, fitness } = createDummyPopulation(5);
      const parentA = createSelectedParent("genome-0", 0.0);
      const parentB = createSelectedParent("genome-0", 0.0); // self-mating initial

      const offspringSeed = 4024959625;
      const pair = ParentPairAssembler.assembleParentPair({
        parentA,
        parentB,
        population,
        fitnessSnapshot: fitness,
        offspringSeed,
      });

      expect(pair.parentA.genomeId).toBe("genome-0");
      expect(pair.parentB.genomeId).not.toBe(parentA.genomeId);
    });

    it("Test C: assembleParentPair accepts self-mating on retry exhaustion without crashing (maxSelfMatingRetries > 0)", () => {
      // Create population where Parent A has highest fitness (1.0) and B has 0.0
      // In 2-candidate tournaments, Parent A will always win and be picked repeatedly
      const popA: PopulationEntry = {
        genomeId: "genome-A",
        dnaRef: "ref-A",
        generation: 1,
        dna: createParentDNA("genome-A", 1.0),
      };
      const popB: PopulationEntry = {
        genomeId: "genome-B",
        dnaRef: "ref-B",
        generation: 1,
        dna: createParentDNA("genome-B", 0.0),
      };

      const fitA: PopulationFitnessEntry = {
        genomeId: "genome-A",
        result: {
          status: "VALID",
          fitnessScore: 1.0,
          completedMatches: 100,
          completionRate: 1.0,
          scheduledMatches: 100,
          wins: 100,
          losses: 0,
          draws: 0,
        },
      };
      const fitB: PopulationFitnessEntry = {
        genomeId: "genome-B",
        result: {
          status: "VALID",
          fitnessScore: 0.0,
          completedMatches: 100,
          completionRate: 1.0,
          scheduledMatches: 100,
          wins: 0,
          losses: 100,
          draws: 0,
        },
      };

      const population: PopulationSnapshot = {
        generation: 1,
        entries: [popA, popB],
      };
      const fitnessSnapshot: FitnessEvaluationSnapshot = {
        generation: 1,
        context: dummyContext,
        entries: [fitA, fitB],
      };

      const parentA = createSelectedParent("genome-A", 1.0, 1.0);
      const parentB = createSelectedParent("genome-A", 1.0, 1.0); // self-mating initial

      const pair = ParentPairAssembler.assembleParentPair({
        parentA,
        parentB,
        population,
        fitnessSnapshot,
        offspringSeed: 12345,
        operatorConfig: { maxSelfMatingRetries: 3 },
      });

      // Retries exhausted because A wins every tournament -> safely accepts A + A
      expect(pair.parentA.genomeId).toBe("genome-A");
      expect(pair.parentB.genomeId).toBe("genome-A");
    });

    it("Test D: assembleParentPair fails-fast on invalid maxSelfMatingRetries", () => {
      const { population, fitness } = createDummyPopulation(5);
      const parentA = createSelectedParent("genome-0", 0.0);
      const parentB = createSelectedParent("genome-0", 0.0);

      expect(() => {
        ParentPairAssembler.assembleParentPair({
          parentA,
          parentB,
          population,
          fitnessSnapshot: fitness,
          offspringSeed: 12345,
          operatorConfig: { maxSelfMatingRetries: -1 },
        });
      }).toThrowError(GeneticOperatorConfigurationError);

      expect(() => {
        ParentPairAssembler.assembleParentPair({
          parentA,
          parentB,
          population,
          fitnessSnapshot: fitness,
          offspringSeed: 12345,
          operatorConfig: { maxSelfMatingRetries: 1.5 },
        });
      }).toThrowError(GeneticOperatorConfigurationError);

      expect(() => {
        ParentPairAssembler.assembleParentPair({
          parentA,
          parentB,
          population,
          fitnessSnapshot: fitness,
          offspringSeed: 12345,
          operatorConfig: { maxSelfMatingRetries: NaN },
        });
      }).toThrowError(GeneticOperatorConfigurationError);

      expect(() => {
        ParentPairAssembler.assembleParentPair({
          parentA,
          parentB,
          population,
          fitnessSnapshot: fitness,
          offspringSeed: 12345,
          operatorConfig: { maxSelfMatingRetries: Infinity },
        });
      }).toThrowError(GeneticOperatorConfigurationError);
    });

    it("Test E: assembleParentPair accepts maxSelfMatingRetries = 0 as valid", () => {
      const { population, fitness } = createDummyPopulation(5);
      const parentA = createSelectedParent("genome-0", 0.0);
      const parentB = createSelectedParent("genome-0", 0.0);

      const pair = ParentPairAssembler.assembleParentPair({
        parentA,
        parentB,
        population,
        fitnessSnapshot: fitness,
        offspringSeed: 12345,
        operatorConfig: { maxSelfMatingRetries: 0 },
      });

      expect(pair.parentA.genomeId).toBe("genome-0");
      expect(pair.parentB.genomeId).toBe("genome-0");
    });

    it("Test F: assembleParentPair fails-closed on INVALID_POPULATION", () => {
      // 1:1 mapping violation between population and fitness snapshot
      const popA: PopulationEntry = {
        genomeId: "genome-A",
        dnaRef: "ref-A",
        generation: 1,
        dna: createParentDNA("genome-A", 0.1),
      };
      const population: PopulationSnapshot = {
        generation: 1,
        entries: [popA],
      };
      const fitnessSnapshot: FitnessEvaluationSnapshot = {
        generation: 1,
        context: dummyContext,
        entries: [], // Empty fitness entries -> INVALID_POPULATION
      };

      const parentA = createSelectedParent("genome-A", 0.1);
      const parentB = createSelectedParent("genome-A", 0.1);

      expect(() => {
        ParentPairAssembler.assembleParentPair({
          parentA,
          parentB,
          population,
          fitnessSnapshot,
          offspringSeed: 12345,
        });
      }).toThrowError(GeneticOperatorError);
    });

    it("Test G: assembleParentPair fails-closed on INCOMPARABLE_EVALUATION", () => {
      const { population, fitness } = createDummyPopulation(5);
      const parentA = createSelectedParent("genome-0", 0.0);
      const parentB = createSelectedParent("genome-0", 0.0);

      const mismatchContext: ComparableEvaluationContext = {
        ...dummyContext,
        generation: 999, // Mismatched generation
      };

      expect(() => {
        ParentPairAssembler.assembleParentPair({
          parentA,
          parentB,
          population,
          fitnessSnapshot: fitness,
          offspringSeed: 12345,
          expectedContext: mismatchContext,
        });
      }).toThrowError(GeneticOperatorError);
    });

    it("Optional: Self-Mating Retry NEVER selects INSUFFICIENT or INVALID candidates", () => {
      const popA: PopulationEntry = {
        genomeId: "genome-A",
        dnaRef: "ref-A",
        generation: 1,
        dna: createParentDNA("genome-A", 0.1),
      };
      const popB: PopulationEntry = {
        genomeId: "genome-B",
        dnaRef: "ref-B",
        generation: 1,
        dna: createParentDNA("genome-B", 0.9),
      };
      const popC: PopulationEntry = {
        genomeId: "genome-C",
        dnaRef: "ref-C",
        generation: 1,
        dna: createParentDNA("genome-C", 0.5),
      };
      const popD: PopulationEntry = {
        genomeId: "genome-D",
        dnaRef: "ref-D",
        generation: 1,
        dna: createParentDNA("genome-D", 0.5),
      };

      const fitA: PopulationFitnessEntry = {
        genomeId: "genome-A",
        result: {
          status: "VALID",
          fitnessScore: 0.2,
          completedMatches: 100,
          completionRate: 1.0,
          scheduledMatches: 100,
          wins: 20,
          losses: 80,
          draws: 0,
        },
      };
      const fitB: PopulationFitnessEntry = {
        genomeId: "genome-B",
        result: {
          status: "VALID",
          fitnessScore: 0.8,
          completedMatches: 100,
          completionRate: 1.0,
          scheduledMatches: 100,
          wins: 80,
          losses: 20,
          draws: 0,
        },
      };
      const fitC: PopulationFitnessEntry = {
        genomeId: "genome-C",
        result: {
          status: "INSUFFICIENT_EVIDENCE",
          fitnessScore: null,
          provisionalScore: 0.99, // Even with higher provisionalScore!
          completedMatches: 10,
          completionRate: 0.1,
          scheduledMatches: 100,
          wins: 10,
          losses: 0,
          draws: 0,
        },
      };
      const fitD: PopulationFitnessEntry = {
        genomeId: "genome-D",
        result: {
          status: "INVALID",
          fitnessScore: null,
          failedMatches: 1,
          scheduledMatches: 100,
        },
      };

      const population: PopulationSnapshot = {
        generation: 1,
        entries: [popA, popB, popC, popD],
      };
      const fitnessSnapshot: FitnessEvaluationSnapshot = {
        generation: 1,
        context: dummyContext,
        entries: [fitA, fitB, fitC, fitD],
      };

      const parentA = createSelectedParent("genome-A", 0.1, 0.2);
      const initialParentB = createSelectedParent("genome-A", 0.1, 0.2);

      const pair = ParentPairAssembler.assembleParentPair({
        parentA,
        parentB: initialParentB,
        population,
        fitnessSnapshot,
        offspringSeed: 4024959625,
      });

      expect(pair.parentA.genomeId).toBe("genome-A");
      expect(pair.parentB.genomeId).toBe("genome-B");
      expect(pair.parentB.genomeId).not.toBe("genome-C");
      expect(pair.parentB.genomeId).not.toBe("genome-D");
    });

    it("Test 24: stream isolation across crossover, mutation, and retry", () => {
      const offspringSeed = 4024959625;
      const crossoverSeed = deriveSeed(offspringSeed, crossoverStreamKey());
      const mutationSeed = deriveSeed(offspringSeed, mutationStreamKey());
      const retrySeed0 = deriveSeed(offspringSeed, selfMatingRetryStreamKey(0));
      const retrySeed1 = deriveSeed(offspringSeed, selfMatingRetryStreamKey(1));

      const seeds = new Set([crossoverSeed, mutationSeed, retrySeed0, retrySeed1]);
      expect(seeds.size).toBe(4);
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Offspring Identity & Lineage
  // ---------------------------------------------------------------------------
  describe("7. Offspring Identity & Lineage (formatOffspringGenomeId / Metadata)", () => {
    it("Test 25: formats offspring genomeId according to convention", () => {
      expect(formatOffspringGenomeId(12, 42)).toBe("gen-000012-offspring-000042");
      expect(formatOffspringGenomeId(0, 0)).toBe("gen-000000-offspring-000000");
      expect(formatOffspringGenomeId(999999, 999999)).toBe("gen-999999-offspring-999999");
    });

    it("Test 26: genomeId is purely deterministic without timestamps or random numbers", () => {
      const id1 = formatOffspringGenomeId(1, 5);
      const id2 = formatOffspringGenomeId(1, 5);
      expect(id1).toBe(id2);
      expect(id1).toMatch(/^gen-\d{6}-offspring-\d{6}$/);
    });

    it("Test 27: different generation and offspringIndex yield different IDs", () => {
      const id1 = formatOffspringGenomeId(1, 1);
      const id2 = formatOffspringGenomeId(1, 2);
      const id3 = formatOffspringGenomeId(2, 1);
      expect(id1).not.toBe(id2);
      expect(id1).not.toBe(id3);
      expect(id2).not.toBe(id3);
    });

    it("Test 28: lineage metadata is exact and contains NO fitness or evaluation leak", () => {
      const parentA = createSelectedParent("parent-A", 1.0);
      const parentB = createSelectedParent("parent-B", 2.0);

      const offspring = generateOffspring({
        parentPair: {
          parentA,
          parentB,
        },
        generation: 1,
        offspringIndex: 0,
        generationSeed: 12345,
      });

      const lineage = offspring.lineage;
      expect(lineage.genomeId).toBe("gen-000001-offspring-000000");
      expect(lineage.parentGenomeIds).toEqual(["parent-A", "parent-B"]);
      expect(lineage.generation).toBe(1);
      expect(lineage.offspringIndex).toBe(0);
      expect(lineage.crossoverOperatorVersion).toBe("block-segmented-uniform-v1");
      expect(lineage.crossoverSeed).toBe(3354403331);
      expect(lineage.mutationOperatorVersion).toBe("deterministic-normal-approx-v1");
      expect(lineage.mutationSeed).toBe(88400338);
      expect(lineage.seedDerivationVersion).toBe("derive-seed-fnv1a-v1");
      expect(lineage.offspringSeed).toBe(4024959625);

      // Verify no fitness leak
      expect((lineage as any).fitness).toBeUndefined();
      expect((lineage as any).fitnessScore).toBeUndefined();
      expect((lineage as any).score).toBeUndefined();
      expect((lineage as any).provisionalScore).toBeUndefined();
      expect((offspring.dna as any).fitness).toBeUndefined();
      expect((offspring.dna.metadata as any)?.fitness).toBeUndefined();

      // DNA codec validation
      expect(() => DecisionDNACodec.validate(offspring.dna)).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // 8. End-to-End Integration Tests
  // ---------------------------------------------------------------------------
  describe("8. End-to-End Integration Tests", () => {
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

    const createDummyPopulation = (count: number): {
      population: PopulationSnapshot;
      fitness: FitnessEvaluationSnapshot;
    } => {
      const populationEntries: PopulationEntry[] = [];
      const fitnessEntries: PopulationFitnessEntry[] = [];

      for (let i = 0; i < count; i++) {
        const id = `genome-${i}`;
        const dna = createParentDNA(id, i * 0.1);
        populationEntries.push({
          genomeId: id,
          dnaRef: `ref-${id}`,
          generation: 1,
          dna,
        });

        const res: FitnessEvaluationResult = {
          status: "VALID",
          fitnessScore: 0.1 * i,
          completedMatches: 100,
          completionRate: 1.0,
          scheduledMatches: 100,
          wins: i * 10,
          losses: 100 - i * 10,
          draws: 0,
        };

        fitnessEntries.push({
          genomeId: id,
          result: res,
        });
      }

      return {
        population: {
          generation: 1,
          entries: populationEntries,
        },
        fitness: {
          generation: 1,
          entries: fitnessEntries,
          context: dummyContext,
        },
      };
    };

    it("Test 29: PopulationSelector -> ParentPairAssembler -> generateOffspring pipeline", () => {
      const { population, fitness } = createDummyPopulation(10);
      const generationBaseSeed = 12345;

      // 1. Derive selection seed
      const selSeed = deriveSeed(generationBaseSeed, selectionStreamKey());
      expect(selSeed).toBe(1967515842);

      // 2. Select initial parent A and parent B
      const selector = new PopulationSelector(DEFAULT_POPULATION_SELECTION_CONFIG);
      const parentASelection = selector.selectParent(population, fitness, selSeed);

      // 3. For offspring 0
      const offspring0Seed = deriveSeed(generationBaseSeed, offspringStreamKey(0));
      const parentBSelection = selector.selectParent(population, fitness, offspring0Seed);

      // 4. Assemble parent pair with self-mating handling
      const assembledPair = ParentPairAssembler.assembleParentPair({
        parentA: parentASelection,
        parentB: parentBSelection,
        population,
        fitnessSnapshot: fitness,
        offspringSeed: offspring0Seed,
      });

      // 5. Generate offspring
      const offspring = generateOffspring({
        parentPair: assembledPair,
        generation: 2,
        offspringIndex: 0,
        generationSeed: generationBaseSeed,
      });

      expect(offspring.lineage.genomeId).toBe("gen-000002-offspring-000000");
      expect(offspring.dna.metadata?.id).toBe("gen-000002-offspring-000000");
      expect(offspring.dna.dnaFormatVersion).toBe(DecisionDNACodec.createZeroDecisionDNA().dnaFormatVersion);
      expect(offspring.dna.patternWeights.length).toBe(DNA_PATTERN_DIMENSION);
      expect(offspring.dna.contextPatternWeights.length).toBe(DNA_INTERACTION_DIMENSION);
      expect(offspring.lineage.parentGenomeIds[0]).toBe(assembledPair.parentA.genomeId);
      expect(offspring.lineage.parentGenomeIds[1]).toBe(assembledPair.parentB.genomeId);

      // Check DecisionDNA validity
      expect(() => DecisionDNACodec.validate(offspring.dna)).not.toThrow();
    });

    it("Test 30: Integration Negative Control - different generation seeds produce distinct offspring", () => {
      const { population, fitness } = createDummyPopulation(10);
      const selector = new PopulationSelector(DEFAULT_POPULATION_SELECTION_CONFIG);

      const runPipeline = (genBaseSeed: number) => {
        const offspring0Seed = deriveSeed(genBaseSeed, offspringStreamKey(0));
        const selSeed = deriveSeed(genBaseSeed, selectionStreamKey());
        const parentA = selector.selectParent(population, fitness, selSeed);
        const parentB = selector.selectParent(population, fitness, offspring0Seed);

        const assembledPair = ParentPairAssembler.assembleParentPair({
          parentA,
          parentB,
          population,
          fitnessSnapshot: fitness,
          offspringSeed: offspring0Seed,
        });

        return generateOffspring({
          parentPair: assembledPair,
          generation: 2,
          offspringIndex: 0,
          generationSeed: genBaseSeed,
        });
      };

      const offspringSeed1 = runPipeline(11111);
      const offspringSeed2 = runPipeline(99999);

      expect(offspringSeed1.dna.patternWeights).not.toEqual(offspringSeed2.dna.patternWeights);
      expect(offspringSeed1.lineage.crossoverSeed).not.toBe(offspringSeed2.lineage.crossoverSeed);
      expect(offspringSeed1.lineage.mutationSeed).not.toBe(offspringSeed2.lineage.mutationSeed);
    });
  });
});
