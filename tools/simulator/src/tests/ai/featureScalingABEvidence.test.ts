import { describe, it, expect } from "vitest";
import { DecisionFeatureScaler, DecisionFeatureScalingError } from "../../engine/ai/DecisionFeatureScaler";
import { CONTEXT_FEATURE_DIMENSION, PATTERN_FEATURE_DIMENSION } from "../../domain/ai/DecisionFeatureTypes";
import {
  computeArmLogicalDigest,
  computeG1WeightDigest,
  computeStats,
  ArmExecutionEvidence,
} from "../../cli/featureScalingABEvidence";
import { GenerationRunner } from "../../engine/ai/GenerationRunner";
import { PopulationSnapshot, PopulationEntry } from "../../domain/ai/PopulationSelectionTypes";
import { DecisionDNA } from "../../domain/ai/DecisionDNATypes";

describe("Feature Scaling A/B Evidence Harness (BP-SIM-AI-FEATURE-SCALING-AB-EVIDENCE-V1)", () => {
  describe("1. Scaler Interception Mechanism", () => {
    it("should validate raw input and return copy of raw values when intercepted", () => {
      const originalScaleContext = DecisionFeatureScaler.scaleContext;
      const originalScalePattern = DecisionFeatureScaler.scalePattern;

      DecisionFeatureScaler.scaleContext = (rawValues: readonly number[]): number[] => {
        originalScaleContext(rawValues);
        return [...rawValues];
      };
      DecisionFeatureScaler.scalePattern = (rawValues: readonly number[]): number[] => {
        originalScalePattern(rawValues);
        return [...rawValues];
      };

      try {
        const validContext = new Array(CONTEXT_FEATURE_DIMENSION).fill(0);
        validContext[24] = 42; // turn_count is valid positive number
        const resultContext = DecisionFeatureScaler.scaleContext(validContext);
        expect(resultContext).toEqual(validContext);
        expect(resultContext).not.toBe(validContext); // must be a distinct copy

        // Mutation of copy does not affect input
        resultContext[24] = 999;
        expect(validContext[24]).toBe(42);

        // Throws on dimension mismatch
        expect(() => DecisionFeatureScaler.scaleContext([1, 2, 3])).toThrow(DecisionFeatureScalingError);

        // Throws on NaN
        const nanContext = new Array(CONTEXT_FEATURE_DIMENSION).fill(0);
        nanContext[0] = NaN;
        expect(() => DecisionFeatureScaler.scaleContext(nanContext)).toThrow(DecisionFeatureScalingError);

        // Valid pattern
        const validPattern = new Array(PATTERN_FEATURE_DIMENSION).fill(0);
        validPattern[0] = 1; // legal is binary
        const resultPattern = DecisionFeatureScaler.scalePattern(validPattern);
        expect(resultPattern).toEqual(validPattern);
        expect(resultPattern).not.toBe(validPattern);
      } finally {
        DecisionFeatureScaler.scaleContext = originalScaleContext;
        DecisionFeatureScaler.scalePattern = originalScalePattern;
      }
    });

    it("should reliably restore original scalers via try/finally even if an error is thrown", () => {
      const originalScaleContext = DecisionFeatureScaler.scaleContext;
      const originalScalePattern = DecisionFeatureScaler.scalePattern;

      let errorThrown = false;
      try {
        DecisionFeatureScaler.scaleContext = () => [999];
        DecisionFeatureScaler.scalePattern = () => [888];
        throw new Error("Simulated runtime error during evaluation");
      } catch (err: unknown) {
        errorThrown = true;
      } finally {
        DecisionFeatureScaler.scaleContext = originalScaleContext;
        DecisionFeatureScaler.scalePattern = originalScalePattern;
      }

      expect(errorThrown).toBe(true);
      expect(DecisionFeatureScaler.scaleContext).toBe(originalScaleContext);
      expect(DecisionFeatureScaler.scalePattern).toBe(originalScalePattern);
    });
  });

  describe("2. Genome Weight Equality & Digest Invariance", () => {
    it("should compute identical weight digests for identical genome weights across arms", () => {
      const sampleEntry: PopulationEntry = {
        genomeId: "test-genome-001",
        dnaRef: "test-ref-001",
        generation: 1,
        dna: {
          schemaVersion: 5,
          featureRegistryVersion: "BP-SIM-AI-FEATURE-REGISTRY-V1",
          patternWeights: [0.1, 0.2, 0.3],
          contextPatternWeights: [[0.01, 0.02]],
        } as unknown as DecisionDNA,
      };

      const digestA = computeG1WeightDigest([sampleEntry]);
      const digestB = computeG1WeightDigest([{ ...sampleEntry }]);

      expect(digestA["test-genome-001"]).toBeDefined();
      expect(digestA["test-genome-001"]).toBe(digestB["test-genome-001"]);

      // Mutating weights changes digest
      const sampleEntryMutated: PopulationEntry = {
        genomeId: "test-genome-001",
        dnaRef: "test-ref-001",
        generation: 1,
        dna: {
          schemaVersion: 5,
          featureRegistryVersion: "BP-SIM-AI-FEATURE-REGISTRY-V1",
          patternWeights: [0.1, 0.2, 0.30001],
          contextPatternWeights: [[0.01, 0.02]],
        } as unknown as DecisionDNA,
      };
      const digestMutated = computeG1WeightDigest([sampleEntryMutated]);
      expect(digestMutated["test-genome-001"]).not.toBe(digestA["test-genome-001"]);
    });
  });

  describe("3. Match Schedule Equality Across Arms", () => {
    it("should generate bit-exact identical schedules for identical seed and population", () => {
      const mockPopulation: PopulationSnapshot = {
        generation: 1,
        entries: [
          { genomeId: "g1", dnaRef: "ref-1", generation: 1, dna: {} as unknown as DecisionDNA },
          { genomeId: "g2", dnaRef: "ref-2", generation: 1, dna: {} as unknown as DecisionDNA },
          { genomeId: "g3", dnaRef: "ref-3", generation: 1, dna: {} as unknown as DecisionDNA },
          { genomeId: "g4", dnaRef: "ref-4", generation: 1, dna: {} as unknown as DecisionDNA },
          { genomeId: "g5", dnaRef: "ref-5", generation: 1, dna: {} as unknown as DecisionDNA },
          { genomeId: "g6", dnaRef: "ref-6", generation: 1, dna: {} as unknown as DecisionDNA },
        ],
      };

      const seed = 4126798286;
      const scheduleA = GenerationRunner.planSchedule(mockPopulation, seed, 1);
      const scheduleB = GenerationRunner.planSchedule(mockPopulation, seed, 1);

      expect(scheduleA.length).toBe(30);
      expect(scheduleB.length).toBe(30);
      expect(scheduleA).toEqual(scheduleB);
    });
  });

  describe("4. Logical Determinism Digest Properties", () => {
    it("should produce identical logical digests regardless of runLabel and non-logical runtime sidecars", () => {
      const baseEvidence: Omit<ArmExecutionEvidence, "logicalDigest"> = {
        arm: "TREATMENT",
        runLabel: "TREATMENT-A",
        g1WeightDigest: { "genome-001": "hash1" },
        matches: [
          {
            matchIndex: 0,
            pairIndex: 0,
            p1GenomeId: "g1",
            p2GenomeId: "g2",
            matchSeed: 12345,
            completed: true,
            winner: "p1",
            totalDecisions: 150,
            turnCount: 20,
          },
        ],
        completedCount: 1,
        incompleteCount: 0,
        failedCount: 0,
        drawsCount: 0,
        p1WinsCount: 1,
        p2WinsCount: 0,
        completionRate: 1.0,
        totalDecisions: 150,
        decisionCountStats: computeStats([150]),
        passMetrics: {
          totalDecisionCount: 150,
          passSelectedCount: 20,
          actionSelectedCount: 100,
          effectSelectedCount: 30,
          otherSelectedCount: 0,
          forcedPassCount: 5,
          strictPassWinCount: 15,
          tieBreakPassCount: 0,
          endLegalCount: 40,
          passGreaterThanEndCount: 10,
          passEqualsEndCount: 0,
          passLessThanEndCount: 30,
          passChosenWhileEndLegalCount: 10,
        },
        marginStats: computeStats([-0.5, 0.2]),
        scoreMagnitude: {
          selectedScoreAbs: computeStats([1.2]),
          passScoreAbs: computeStats([0.8]),
          bestNonPassScoreAbs: computeStats([1.0]),
          marginAbs: computeStats([0.2]),
        },
        featureMagnitude: {
          maxAbsContextFeature: 0.85,
          maxAbsPatternFeature: 0.9,
          maxAbsInteractionInput: 0.765,
        },
        fitnessEntries: [
          {
            genomeId: "g1",
            status: "REEVALUATION_REQUIRED",
            provisionalFitness: 1.0,
            completedMatches: 1,
            wins: 1,
            draws: 0,
            losses: 0,
          },
        ],
        readiness: {
          status: "REEVALUATION_REQUIRED",
          validCount: 0,
        },
      };

      const digestA = computeArmLogicalDigest({ ...baseEvidence, runLabel: "TREATMENT-A" });
      const digestB = computeArmLogicalDigest({ ...baseEvidence, runLabel: "TREATMENT-B" });

      expect(digestA).toBe(digestB);

      // Logical difference alters digest
      const alteredEvidence = {
        ...baseEvidence,
        completedCount: 2,
      };
      const digestC = computeArmLogicalDigest(alteredEvidence);
      expect(digestC).not.toBe(digestA);
    });
  });
});
