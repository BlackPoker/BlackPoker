import { describe, it, expect } from "vitest";
import { PopulationSelector } from "../../engine/ai/PopulationSelector";
import {
  PopulationSnapshot,
  PopulationEntry,
  FitnessEvaluationSnapshot,
  PopulationFitnessEntry,
  ComparableEvaluationContext,
  PopulationSelectionConfig,
  DEFAULT_POPULATION_SELECTION_CONFIG,
  PopulationSelectionIntegrityError,
  PopulationSelectionConfigurationError,
  PopulationSelectionExecutionError,
} from "../../domain/ai/PopulationSelectionTypes";
import { DecisionDNACodec } from "../../engine/ai/DecisionDNACodec";
import {
  DEFAULT_FITNESS_EVALUATION_CONFIG,
  FitnessEvaluationResult,
} from "../../domain/ai/FitnessEvaluationTypes";
import { FitnessEvaluator } from "../../engine/ai/FitnessEvaluator";
import {
  PolicyParticipantOutcomeSummary,
  PolicyParticipantSeatSummary,
} from "../../domain/ai/PolicyExperimentTypes";

describe("Population & Tournament Selection Core V1 (BP-SIM-AI-POPULATION-SELECTION-V1)", () => {
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
    dna: DecisionDNACodec.createZeroDecisionDNA({ id: genomeId }),
  });

  const createFitnessEntry = (
    genomeId: string,
    status: "VALID" | "INSUFFICIENT_EVIDENCE" | "INVALID",
    fitnessScore: number | null,
    provisionalScore: number | null = null,
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
        provisionalScore,
        completedMatches: 50,
        completionRate: 0.5,
        scheduledMatches: 100,
        wins: provisionalScore !== null ? Math.round(provisionalScore * 50) : 0,
        losses: provisionalScore !== null ? 50 - Math.round(provisionalScore * 50) : 50,
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

  describe("A. Unit Tests (Specification Conformance)", () => {
    it("Test 1: Mixed pool (VALID, INSUFFICIENT, INVALID) -> only VALID enters Standard Selection Pool", () => {
      const population: PopulationSnapshot = {
        generation: 1,
        entries: [
          createDummyEntry("DNA_A"),
          createDummyEntry("DNA_B"),
          createDummyEntry("DNA_C"),
          createDummyEntry("DNA_D"),
          createDummyEntry("DNA_E"),
        ],
      };

      const fitnessSnapshot: FitnessEvaluationSnapshot = {
        generation: 1,
        context: dummyContext,
        entries: [
          createFitnessEntry("DNA_A", "VALID", 0.8),
          createFitnessEntry("DNA_B", "VALID", 0.6),
          createFitnessEntry("DNA_C", "VALID", 0.0),
          createFitnessEntry("DNA_D", "INSUFFICIENT_EVIDENCE", null, 1.0),
          createFitnessEntry("DNA_E", "INVALID", null),
        ],
      };

      const pool = PopulationSelector.getStandardSelectionPool(population, fitnessSnapshot);

      expect(pool).toHaveLength(3);
      expect(pool.map((c) => c.genomeId)).toEqual(["DNA_A", "DNA_B", "DNA_C"]);
      expect(pool.map((c) => c.fitnessScore)).toEqual([0.8, 0.6, 0.0]);
    });

    it("Test 2: VALID 0.0 individual is retained in Standard Selection Pool", () => {
      const population: PopulationSnapshot = {
        generation: 1,
        entries: [
          createDummyEntry("DNA_01"),
          createDummyEntry("DNA_02"),
          createDummyEntry("DNA_03"),
        ],
      };

      const fitnessSnapshot: FitnessEvaluationSnapshot = {
        generation: 1,
        context: dummyContext,
        entries: [
          createFitnessEntry("DNA_01", "VALID", 0.5),
          createFitnessEntry("DNA_02", "VALID", 0.0), // 0勝100敗
          createFitnessEntry("DNA_03", "VALID", 0.7),
        ],
      };

      const pool = PopulationSelector.getStandardSelectionPool(population, fitnessSnapshot);
      const zeroCandidate = pool.find((c) => c.genomeId === "DNA_02");

      expect(zeroCandidate).toBeDefined();
      expect(zeroCandidate?.fitnessScore).toBe(0.0);
    });

    it("Test 3: validCount = 0 -> REEVALUATION_REQUIRED", () => {
      const population: PopulationSnapshot = {
        generation: 1,
        entries: [createDummyEntry("DNA_01"), createDummyEntry("DNA_02")],
      };

      const fitnessSnapshot: FitnessEvaluationSnapshot = {
        generation: 1,
        context: dummyContext,
        entries: [
          createFitnessEntry("DNA_01", "INSUFFICIENT_EVIDENCE", null, 0.9),
          createFitnessEntry("DNA_02", "INVALID", null),
        ],
      };

      const readiness = PopulationSelector.assessReadiness(population, fitnessSnapshot);
      expect(readiness.status).toBe("REEVALUATION_REQUIRED");
      expect(readiness.validCount).toBe(0);
      expect(readiness.requiredCount).toBe(3); // default max(minValid=2, tournamentSize=3)
    });

    it("Test 4: validCount = 1 -> REEVALUATION_REQUIRED", () => {
      const population: PopulationSnapshot = {
        generation: 1,
        entries: [createDummyEntry("DNA_01"), createDummyEntry("DNA_02")],
      };

      const fitnessSnapshot: FitnessEvaluationSnapshot = {
        generation: 1,
        context: dummyContext,
        entries: [
          createFitnessEntry("DNA_01", "VALID", 0.7),
          createFitnessEntry("DNA_02", "INSUFFICIENT_EVIDENCE", null, 0.8),
        ],
      };

      const readiness = PopulationSelector.assessReadiness(population, fitnessSnapshot);
      expect(readiness.status).toBe("REEVALUATION_REQUIRED");
      expect(readiness.validCount).toBe(1);
    });

    it("Test 5: validCount = 2 with tournamentSize = 3 -> REEVALUATION_REQUIRED", () => {
      const population: PopulationSnapshot = {
        generation: 1,
        entries: [
          createDummyEntry("DNA_01"),
          createDummyEntry("DNA_02"),
          createDummyEntry("DNA_03"),
        ],
      };

      const fitnessSnapshot: FitnessEvaluationSnapshot = {
        generation: 1,
        context: dummyContext,
        entries: [
          createFitnessEntry("DNA_01", "VALID", 0.7),
          createFitnessEntry("DNA_02", "VALID", 0.6),
          createFitnessEntry("DNA_03", "INSUFFICIENT_EVIDENCE", null),
        ],
      };

      const readiness = PopulationSelector.assessReadiness(population, fitnessSnapshot);
      expect(readiness.status).toBe("REEVALUATION_REQUIRED");
      expect(readiness.validCount).toBe(2);
      expect(readiness.requiredCount).toBe(3);
    });

    it("Test 6: validCount = 3 with tournamentSize = 3 -> READY", () => {
      const population: PopulationSnapshot = {
        generation: 1,
        entries: [
          createDummyEntry("DNA_01"),
          createDummyEntry("DNA_02"),
          createDummyEntry("DNA_03"),
        ],
      };

      const fitnessSnapshot: FitnessEvaluationSnapshot = {
        generation: 1,
        context: dummyContext,
        entries: [
          createFitnessEntry("DNA_01", "VALID", 0.7),
          createFitnessEntry("DNA_02", "VALID", 0.6),
          createFitnessEntry("DNA_03", "VALID", 0.5),
        ],
      };

      const readiness = PopulationSelector.assessReadiness(population, fitnessSnapshot);
      expect(readiness.status).toBe("READY");
      expect(readiness.validCount).toBe(3);
    });

    it("Test 7: All 0.0 scores tournament runs without error and tie-breaks cleanly", () => {
      const population: PopulationSnapshot = {
        generation: 1,
        entries: [
          createDummyEntry("DNA_01"),
          createDummyEntry("DNA_02"),
          createDummyEntry("DNA_03"),
          createDummyEntry("DNA_04"),
        ],
      };

      const fitnessSnapshot: FitnessEvaluationSnapshot = {
        generation: 1,
        context: dummyContext,
        entries: [
          createFitnessEntry("DNA_01", "VALID", 0.0),
          createFitnessEntry("DNA_02", "VALID", 0.0),
          createFitnessEntry("DNA_03", "VALID", 0.0),
          createFitnessEntry("DNA_04", "VALID", 0.0),
        ],
      };

      const parents = PopulationSelector.selectParents(
        10,
        population,
        fitnessSnapshot,
        undefined,
        42
      );

      expect(parents).toHaveLength(10);
      for (const parent of parents) {
        expect(parent.fitnessScore).toBe(0.0);
        expect(parent.tournamentCandidates).toHaveLength(3);
      }
    });

    it("Test 8: Within-tournament uniqueness (k distinct candidates sampled without replacement)", () => {
      const population: PopulationSnapshot = {
        generation: 1,
        entries: [
          createDummyEntry("DNA_01"),
          createDummyEntry("DNA_02"),
          createDummyEntry("DNA_03"),
          createDummyEntry("DNA_04"),
          createDummyEntry("DNA_05"),
        ],
      };

      const fitnessSnapshot: FitnessEvaluationSnapshot = {
        generation: 1,
        context: dummyContext,
        entries: [
          createFitnessEntry("DNA_01", "VALID", 0.1),
          createFitnessEntry("DNA_02", "VALID", 0.2),
          createFitnessEntry("DNA_03", "VALID", 0.3),
          createFitnessEntry("DNA_04", "VALID", 0.4),
          createFitnessEntry("DNA_05", "VALID", 0.5),
        ],
      };

      const parents = PopulationSelector.selectParents(
        50,
        population,
        fitnessSnapshot,
        undefined,
        99
      );

      for (const parent of parents) {
        const candidates = parent.tournamentCandidates!;
        expect(candidates).toHaveLength(3);
        const uniqueSet = new Set(candidates);
        expect(uniqueSet.size).toBe(3); // 1トーナメント内非復元
      }
    });

    it("Test 9: Across-tournament candidate reuse allowed (top individual can win multiple tournaments)", () => {
      const population: PopulationSnapshot = {
        generation: 1,
        entries: [
          createDummyEntry("DNA_WEAK1"),
          createDummyEntry("DNA_WEAK2"),
          createDummyEntry("DNA_STRONG"),
        ],
      };

      const fitnessSnapshot: FitnessEvaluationSnapshot = {
        generation: 1,
        context: dummyContext,
        entries: [
          createFitnessEntry("DNA_WEAK1", "VALID", 0.1),
          createFitnessEntry("DNA_WEAK2", "VALID", 0.2),
          createFitnessEntry("DNA_STRONG", "VALID", 0.9),
        ],
      };

      const parents = PopulationSelector.selectParents(
        10,
        population,
        fitnessSnapshot,
        undefined,
        123
      );

      expect(parents).toHaveLength(10);
      const strongCount = parents.filter((p) => p.genomeId === "DNA_STRONG").length;
      expect(strongCount).toBe(10); // STRONG は参加した全トーナメントで勝利
    });

    it("Test 10: Determinism (same seed produces identical sequence)", () => {
      const population: PopulationSnapshot = {
        generation: 1,
        entries: [
          createDummyEntry("DNA_01"),
          createDummyEntry("DNA_02"),
          createDummyEntry("DNA_03"),
          createDummyEntry("DNA_04"),
          createDummyEntry("DNA_05"),
        ],
      };

      const fitnessSnapshot: FitnessEvaluationSnapshot = {
        generation: 1,
        context: dummyContext,
        entries: [
          createFitnessEntry("DNA_01", "VALID", 0.4),
          createFitnessEntry("DNA_02", "VALID", 0.8),
          createFitnessEntry("DNA_03", "VALID", 0.2),
          createFitnessEntry("DNA_04", "VALID", 0.7),
          createFitnessEntry("DNA_05", "VALID", 0.5),
        ],
      };

      const run1 = PopulationSelector.selectParents(20, population, fitnessSnapshot, undefined, 42);
      const run2 = PopulationSelector.selectParents(20, population, fitnessSnapshot, undefined, 42);

      expect(run1).toEqual(run2);
    });

    it("Test 11: Input array order independence (canonical sort eliminates entry order bias)", () => {
      const popEntriesA = [
        createDummyEntry("DNA_01"),
        createDummyEntry("DNA_02"),
        createDummyEntry("DNA_03"),
        createDummyEntry("DNA_04"),
      ];
      const fitEntriesA = [
        createFitnessEntry("DNA_01", "VALID", 0.5),
        createFitnessEntry("DNA_02", "VALID", 0.5),
        createFitnessEntry("DNA_03", "VALID", 0.5),
        createFitnessEntry("DNA_04", "VALID", 0.5),
      ];

      // 逆順
      const popEntriesB = [...popEntriesA].reverse();
      const fitEntriesB = [...fitEntriesA].reverse();

      const popA: PopulationSnapshot = { generation: 1, entries: popEntriesA };
      const fitA: FitnessEvaluationSnapshot = { generation: 1, context: dummyContext, entries: fitEntriesA };

      const popB: PopulationSnapshot = { generation: 1, entries: popEntriesB };
      const fitB: FitnessEvaluationSnapshot = { generation: 1, context: dummyContext, entries: fitEntriesB };

      const runA = PopulationSelector.selectParents(15, popA, fitA, undefined, 555);
      const runB = PopulationSelector.selectParents(15, popB, fitB, undefined, 555);

      expect(runA).toEqual(runB);
    });

    it("Test 12: Tie determinism (uniform PRNG tie-breaking without ID or array bias)", () => {
      const population: PopulationSnapshot = {
        generation: 1,
        entries: [
          createDummyEntry("DNA_A"),
          createDummyEntry("DNA_B"),
          createDummyEntry("DNA_C"),
        ],
      };

      const fitnessSnapshot: FitnessEvaluationSnapshot = {
        generation: 1,
        context: dummyContext,
        entries: [
          createFitnessEntry("DNA_A", "VALID", 0.5),
          createFitnessEntry("DNA_B", "VALID", 0.5),
          createFitnessEntry("DNA_C", "VALID", 0.5),
        ],
      };

      // 100回の選択を行い、A, B, C いずれも選出されることを確認
      const parents = PopulationSelector.selectParents(
        100,
        population,
        fitnessSnapshot,
        undefined,
        777
      );

      const counts = new Map<string, number>();
      for (const p of parents) {
        counts.set(p.genomeId, (counts.get(p.genomeId) ?? 0) + 1);
      }

      expect(counts.get("DNA_A")).toBeGreaterThan(15);
      expect(counts.get("DNA_B")).toBeGreaterThan(15);
      expect(counts.get("DNA_C")).toBeGreaterThan(15);
    });

    it("Test 13: Provisional score negative control (INSUFFICIENT with provisionalScore 1.0 never selected)", () => {
      const population: PopulationSnapshot = {
        generation: 1,
        entries: [
          createDummyEntry("DNA_VALID1"),
          createDummyEntry("DNA_VALID2"),
          createDummyEntry("DNA_VALID3"),
          createDummyEntry("DNA_INSUFFICIENT"),
        ],
      };

      const fitnessSnapshot: FitnessEvaluationSnapshot = {
        generation: 1,
        context: dummyContext,
        entries: [
          createFitnessEntry("DNA_VALID1", "VALID", 0.1),
          createFitnessEntry("DNA_VALID2", "VALID", 0.1),
          createFitnessEntry("DNA_VALID3", "VALID", 0.1),
          // 見かけ上 1.00 だが INSUFFICIENT
          createFitnessEntry("DNA_INSUFFICIENT", "INSUFFICIENT_EVIDENCE", null, 1.0),
        ],
      };

      const parents = PopulationSelector.selectParents(
        50,
        population,
        fitnessSnapshot,
        undefined,
        42
      );

      const insufficientCount = parents.filter((p) => p.genomeId === "DNA_INSUFFICIENT").length;
      expect(insufficientCount).toBe(0);
    });

    it("Test 14: Invalid exclusion (INVALID with failedMatches never selected)", () => {
      const population: PopulationSnapshot = {
        generation: 1,
        entries: [
          createDummyEntry("DNA_VALID1"),
          createDummyEntry("DNA_VALID2"),
          createDummyEntry("DNA_VALID3"),
          createDummyEntry("DNA_CRASHED"),
        ],
      };

      const fitnessSnapshot: FitnessEvaluationSnapshot = {
        generation: 1,
        context: dummyContext,
        entries: [
          createFitnessEntry("DNA_VALID1", "VALID", 0.2),
          createFitnessEntry("DNA_VALID2", "VALID", 0.3),
          createFitnessEntry("DNA_VALID3", "VALID", 0.4),
          createFitnessEntry("DNA_CRASHED", "INVALID", null),
        ],
      };

      const parents = PopulationSelector.selectParents(
        50,
        population,
        fitnessSnapshot,
        undefined,
        42
      );

      const invalidCount = parents.filter((p) => p.genomeId === "DNA_CRASHED").length;
      expect(invalidCount).toBe(0);
    });

    it("Test 15: Comparable context mismatch -> INCOMPARABLE_EVALUATION", () => {
      const population: PopulationSnapshot = {
        generation: 1,
        entries: [
          createDummyEntry("DNA_01"),
          createDummyEntry("DNA_02"),
          createDummyEntry("DNA_03"),
        ],
      };

      const differentContext: ComparableEvaluationContext = {
        ...dummyContext,
        environmentRef: "rules-vnext:different-env",
      };

      const fitnessSnapshot: FitnessEvaluationSnapshot = {
        generation: 1,
        context: differentContext,
        entries: [
          createFitnessEntry("DNA_01", "VALID", 0.7),
          createFitnessEntry("DNA_02", "VALID", 0.6),
          createFitnessEntry("DNA_03", "VALID", 0.5),
        ],
      };

      // expectedContext と異なる場合
      const readiness = PopulationSelector.assessReadiness(
        population,
        fitnessSnapshot,
        undefined,
        dummyContext
      );

      expect(readiness.status).toBe("INCOMPARABLE_EVALUATION");

      expect(() =>
        PopulationSelector.selectParents(
          2,
          population,
          fitnessSnapshot,
          undefined,
          42,
          dummyContext
        )
      ).toThrow(PopulationSelectionExecutionError);
    });

    it("Test 16: Missing fitness entry throws PopulationSelectionIntegrityError", () => {
      const population: PopulationSnapshot = {
        generation: 1,
        entries: [
          createDummyEntry("DNA_01"),
          createDummyEntry("DNA_02"),
          createDummyEntry("DNA_03"),
        ],
      };

      const fitnessSnapshot: FitnessEvaluationSnapshot = {
        generation: 1,
        context: dummyContext,
        entries: [
          createFitnessEntry("DNA_01", "VALID", 0.7),
          createFitnessEntry("DNA_02", "VALID", 0.6),
          // DNA_03 の結果が欠損
        ],
      };

      expect(() =>
        PopulationSelector.validateIntegrity(population, fitnessSnapshot)
      ).toThrow(PopulationSelectionIntegrityError);

      const readiness = PopulationSelector.assessReadiness(population, fitnessSnapshot);
      expect(readiness.status).toBe("INVALID_POPULATION");
    });

    it("Test 17: Extra fitness entry throws PopulationSelectionIntegrityError", () => {
      const population: PopulationSnapshot = {
        generation: 1,
        entries: [createDummyEntry("DNA_01"), createDummyEntry("DNA_02")],
      };

      const fitnessSnapshot: FitnessEvaluationSnapshot = {
        generation: 1,
        context: dummyContext,
        entries: [
          createFitnessEntry("DNA_01", "VALID", 0.7),
          createFitnessEntry("DNA_02", "VALID", 0.6),
          createFitnessEntry("DNA_EXTRA", "VALID", 0.5),
        ],
      };

      expect(() =>
        PopulationSelector.validateIntegrity(population, fitnessSnapshot)
      ).toThrow(PopulationSelectionIntegrityError);
    });

    it("Test 18: Duplicate genomeId in population throws PopulationSelectionIntegrityError", () => {
      const population: PopulationSnapshot = {
        generation: 1,
        entries: [createDummyEntry("DNA_01"), createDummyEntry("DNA_01")],
      };

      const fitnessSnapshot: FitnessEvaluationSnapshot = {
        generation: 1,
        context: dummyContext,
        entries: [
          createFitnessEntry("DNA_01", "VALID", 0.7),
          createFitnessEntry("DNA_01", "VALID", 0.6),
        ],
      };

      expect(() =>
        PopulationSelector.validateIntegrity(population, fitnessSnapshot)
      ).toThrow(PopulationSelectionIntegrityError);
    });

    it("Test 19: Generation mismatch throws PopulationSelectionIntegrityError", () => {
      const population: PopulationSnapshot = {
        generation: 1,
        entries: [createDummyEntry("DNA_01", 1), createDummyEntry("DNA_02", 1)],
      };

      const fitnessSnapshot: FitnessEvaluationSnapshot = {
        generation: 2, // 世代不一致
        context: dummyContext,
        entries: [
          createFitnessEntry("DNA_01", "VALID", 0.7),
          createFitnessEntry("DNA_02", "VALID", 0.6),
        ],
      };

      expect(() =>
        PopulationSelector.validateIntegrity(population, fitnessSnapshot)
      ).toThrow(PopulationSelectionIntegrityError);
    });

    it("Test 20: Config validation checks boundaries (minValid < 2, tournamentSize < 2, eliteCount < 0)", () => {
      expect(() =>
        PopulationSelector.validateConfig({ minimumValidPopulationCount: 1 })
      ).toThrow(PopulationSelectionConfigurationError);

      expect(() =>
        PopulationSelector.validateConfig({ tournamentSize: 1 })
      ).toThrow(PopulationSelectionConfigurationError);

      expect(() =>
        PopulationSelector.validateConfig({ eliteCount: -1 })
      ).toThrow(PopulationSelectionConfigurationError);

      const valid = PopulationSelector.validateConfig({
        minimumValidPopulationCount: 4,
        tournamentSize: 4,
        eliteCount: 2,
      });
      expect(valid.minimumValidPopulationCount).toBe(4);
      expect(valid.tournamentSize).toBe(4);
      expect(valid.eliteCount).toBe(2);
    });

    it("Test 21: Elitism (preserves top E genotypes without mutation)", () => {
      const population: PopulationSnapshot = {
        generation: 1,
        entries: [
          createDummyEntry("DNA_LOW"),
          createDummyEntry("DNA_MID"),
          createDummyEntry("DNA_HIGH"),
        ],
      };

      const fitnessSnapshot: FitnessEvaluationSnapshot = {
        generation: 1,
        context: dummyContext,
        entries: [
          createFitnessEntry("DNA_LOW", "VALID", 0.2),
          createFitnessEntry("DNA_MID", "VALID", 0.5),
          createFitnessEntry("DNA_HIGH", "VALID", 0.9),
        ],
      };

      const elites = PopulationSelector.selectElites(
        population,
        fitnessSnapshot,
        { eliteCount: 1 },
        42
      );

      expect(elites).toHaveLength(1);
      expect(elites[0].genomeId).toBe("DNA_HIGH");
      expect(elites[0].fitnessScore).toBe(0.9);

      // eliteCount = 2
      const elites2 = PopulationSelector.selectElites(
        population,
        fitnessSnapshot,
        { eliteCount: 2 },
        42
      );

      expect(elites2).toHaveLength(2);
      expect(elites2.map((e) => e.genomeId)).toEqual(["DNA_HIGH", "DNA_MID"]);
    });

    it("Test 22: Elite ties (tie-breaks deterministically across tied individuals at boundary)", () => {
      const population: PopulationSnapshot = {
        generation: 1,
        entries: [
          createDummyEntry("DNA_A"),
          createDummyEntry("DNA_B"),
          createDummyEntry("DNA_C"),
        ],
      };

      const fitnessSnapshot: FitnessEvaluationSnapshot = {
        generation: 1,
        context: dummyContext,
        entries: [
          createFitnessEntry("DNA_A", "VALID", 0.85),
          createFitnessEntry("DNA_B", "VALID", 0.85),
          createFitnessEntry("DNA_C", "VALID", 0.85),
        ],
      };

      // eliteCount = 1: 3名同点首位から1名を決定論的に選択
      const run1 = PopulationSelector.selectElites(
        population,
        fitnessSnapshot,
        { eliteCount: 1 },
        123
      );
      const run2 = PopulationSelector.selectElites(
        population,
        fitnessSnapshot,
        { eliteCount: 1 },
        123
      );

      expect(run1).toEqual(run2);
      expect(run1).toHaveLength(1);
      expect(run1[0].fitnessScore).toBe(0.85);
    });
  });

  describe("B. Integration Test (Connecting Real FitnessEvaluator to Selection)", () => {
    it("Test 23: Complete flow from Participant Outcome Summaries -> FitnessEvaluator -> PopulationSelector", () => {
      const dummySeat: PolicyParticipantSeatSummary = {
        scheduledMatches: 50,
        completedMatches: 50,
        wins: 25,
        losses: 25,
        draws: 0,
        incompleteMatches: 0,
        failedMatches: 0,
        winRateOnCompleted: 0.5,
      };

      // 4名の参加者 Outcome Summary
      const summaryA: PolicyParticipantOutcomeSummary = {
        participantId: "genome-001",
        scheduledMatches: 100,
        completedMatches: 100,
        wins: 80,
        losses: 20,
        draws: 0,
        incompleteMatches: 0,
        failedMatches: 0,
        winRateOnCompleted: 0.8,
        asP1: dummySeat,
        asP2: dummySeat,
      };

      const summaryB: PolicyParticipantOutcomeSummary = {
        participantId: "genome-002",
        scheduledMatches: 100,
        completedMatches: 100,
        wins: 50,
        losses: 50,
        draws: 0,
        incompleteMatches: 0,
        failedMatches: 0,
        winRateOnCompleted: 0.5,
        asP1: dummySeat,
        asP2: dummySeat,
      };

      const summaryC: PolicyParticipantOutcomeSummary = {
        participantId: "genome-003",
        scheduledMatches: 100,
        completedMatches: 100,
        wins: 0,
        losses: 100,
        draws: 0,
        incompleteMatches: 0,
        failedMatches: 0,
        winRateOnCompleted: 0.0,
        asP1: dummySeat,
        asP2: dummySeat,
      };

      const summaryD: PolicyParticipantOutcomeSummary = {
        participantId: "genome-004",
        scheduledMatches: 100,
        completedMatches: 30, // 完了不足 (INSUFFICIENT)
        wins: 30,
        losses: 0,
        draws: 0,
        incompleteMatches: 70,
        failedMatches: 0,
        winRateOnCompleted: 1.0,
        asP1: dummySeat,
        asP2: dummySeat,
      };

      // 1. FitnessEvaluator による評価実行
      const fitResA = FitnessEvaluator.evaluateParticipant(summaryA);
      const fitResB = FitnessEvaluator.evaluateParticipant(summaryB);
      const fitResC = FitnessEvaluator.evaluateParticipant(summaryC);
      const fitResD = FitnessEvaluator.evaluateParticipant(summaryD);

      expect(fitResA.status).toBe("VALID");
      expect(fitResB.status).toBe("VALID");
      expect(fitResC.status).toBe("VALID");
      expect(fitResD.status).toBe("INSUFFICIENT_EVIDENCE");

      // 2. PopulationSnapshot と FitnessEvaluationSnapshot を構成
      const population: PopulationSnapshot = {
        generation: 1,
        entries: [
          createDummyEntry("genome-001"),
          createDummyEntry("genome-002"),
          createDummyEntry("genome-003"),
          createDummyEntry("genome-004"),
        ],
      };

      const fitnessSnapshot: FitnessEvaluationSnapshot = {
        generation: 1,
        context: dummyContext,
        entries: [
          { genomeId: "genome-001", result: fitResA },
          { genomeId: "genome-002", result: fitResB },
          { genomeId: "genome-003", result: fitResC },
          { genomeId: "genome-004", result: fitResD },
        ],
      };

      // 3. Selection Readiness 評価
      const readiness = PopulationSelector.assessReadiness(population, fitnessSnapshot);
      expect(readiness.status).toBe("READY");
      expect(readiness.validCount).toBe(3); // 001, 002, 003

      // 4. Standard Selection Pool 抽出
      const pool = PopulationSelector.getStandardSelectionPool(population, fitnessSnapshot);
      expect(pool.map((c) => c.genomeId)).toEqual(["genome-001", "genome-002", "genome-003"]);
      expect(pool.find((c) => c.genomeId === "genome-004")).toBeUndefined(); // INSUFFICIENT 完全除外

      // 5. Parent Tournament Selection
      const selector = new PopulationSelector();
      const parents = selector.selectParents(10, population, fitnessSnapshot, 42);
      expect(parents).toHaveLength(10);
      for (const parent of parents) {
        expect(["genome-001", "genome-002", "genome-003"]).toContain(parent.genomeId);
      }

      // 6. Elite Selection
      const elites = selector.selectElites(population, fitnessSnapshot, 42);
      expect(elites).toHaveLength(1);
      expect(elites[0].genomeId).toBe("genome-001"); // 最高勝率個体が無変更で保存
      expect(elites[0].fitnessScore).toBeCloseTo(0.8, 6);
    });
  });
});
