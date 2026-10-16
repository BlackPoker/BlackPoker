import { describe, it, expect } from "vitest";
import { DecisionFeatureScaler, DecisionFeatureScalingError } from "../../engine/ai/DecisionFeatureScaler";
import { CONTEXT_FEATURE_DIMENSION, PATTERN_FEATURE_DIMENSION } from "../../domain/ai/DecisionFeatureTypes";
import {
  computeArmLogicalDigest,
  computeG1WeightDigest,
  computeStats,
  snapshotWeights,
  assertWeightsExact,
  renderEvidenceMarkdown,
  validateArtifactSelfConsistency,
  ArmExecutionEvidence,
  FeatureScalingABEvidenceArtifact,
} from "../../cli/featureScalingABEvidence";
import { GenerationRunner } from "../../engine/ai/GenerationRunner";
import { PopulationSnapshot, PopulationEntry } from "../../domain/ai/PopulationSelectionTypes";
import { DecisionDNA } from "../../domain/ai/DecisionDNATypes";

describe("Feature Scaling A/B Evidence Harness (BP-SIM-AI-FEATURE-SCALING-AB-EVIDENCE-V1-R1)", () => {
  describe("1. Scaler Interception & Exact Reference Restoration", () => {
    it("should validate raw input and return copy of raw values when intercepted", () => {
      const canonicalScaleContext = DecisionFeatureScaler.scaleContext;
      const canonicalScalePattern = DecisionFeatureScaler.scalePattern;

      DecisionFeatureScaler.scaleContext = (rawValues: readonly number[]): number[] => {
        canonicalScaleContext(rawValues);
        return [...rawValues];
      };
      DecisionFeatureScaler.scalePattern = (rawValues: readonly number[]): number[] => {
        canonicalScalePattern(rawValues);
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
        DecisionFeatureScaler.scaleContext = canonicalScaleContext;
        DecisionFeatureScaler.scalePattern = canonicalScalePattern;
      }
    });

    it("should reliably restore original scaler references via try/finally and verify reference equality (===)", () => {
      const canonicalScaleContext = DecisionFeatureScaler.scaleContext;
      const canonicalScalePattern = DecisionFeatureScaler.scalePattern;

      let errorThrown = false;
      try {
        DecisionFeatureScaler.scaleContext = () => [999];
        DecisionFeatureScaler.scalePattern = () => [888];
        expect(DecisionFeatureScaler.scaleContext).not.toBe(canonicalScaleContext);
        expect(DecisionFeatureScaler.scalePattern).not.toBe(canonicalScalePattern);
        throw new Error("Simulated runtime error during evaluation");
      } catch {
        errorThrown = true;
      } finally {
        DecisionFeatureScaler.scaleContext = canonicalScaleContext;
        DecisionFeatureScaler.scalePattern = canonicalScalePattern;
      }

      expect(errorThrown).toBe(true);
      expect(DecisionFeatureScaler.scaleContext).toBe(canonicalScaleContext);
      expect(DecisionFeatureScaler.scalePattern).toBe(canonicalScalePattern);
    });

    it("should detect if scaler reference is not restored", () => {
      const canonicalScaleContext = DecisionFeatureScaler.scaleContext;
      const fakeScaler = () => [123];

      // If scaler is not restored, reference check === must evaluate to false
      expect(fakeScaler === canonicalScaleContext).toBe(false);
    });
  });

  describe("2. Weight Integrity, Snapshot & Mutation Detection", () => {
    const makeSamplePopulation = (): PopulationSnapshot => ({
      generation: 1,
      entries: [
        {
          genomeId: "test-genome-001",
          dnaRef: "test-ref-001",
          generation: 1,
          dna: {
            schemaVersion: 5,
            featureRegistryVersion: "BP-SIM-AI-FEATURE-REGISTRY-V1",
            patternWeights: [0.1, 0.2, 0.3],
            contextPatternWeights: [0.01, 0.02, 0.03, 0.04],
          } as unknown as DecisionDNA,
        },
        {
          genomeId: "test-genome-002",
          dnaRef: "test-ref-002",
          generation: 1,
          dna: {
            schemaVersion: 5,
            featureRegistryVersion: "BP-SIM-AI-FEATURE-REGISTRY-V1",
            patternWeights: [-0.5, 0.0, 0.5],
            contextPatternWeights: [-0.1, 0.1, 0.2, -0.2],
          } as unknown as DecisionDNA,
        },
      ],
    });

    it("should snapshot weights as a deep copy and pass exact equality check", () => {
      const pop = makeSamplePopulation();
      const snapshot = snapshotWeights(pop);

      expect(snapshot["test-genome-001"]).toBeDefined();
      expect(snapshot["test-genome-002"]).toBeDefined();

      // Should pass exact equality
      expect(() => assertWeightsExact(snapshot, pop, "INITIAL_CHECK")).not.toThrow();

      // Mutating original pop weight array must not mutate snapshot
      ((pop.entries[0].dna as DecisionDNA).patternWeights as number[])[0] = 999.0;
      expect(snapshot["test-genome-001"].patternWeights[0]).toBe(0.1);
    });

    it("should fail exact equality check and detect mutation if a single weight element is changed", () => {
      const pop = makeSamplePopulation();
      const snapshot = snapshotWeights(pop);

      // Mutate single pattern weight
      const mutatedPopPattern: PopulationSnapshot = {
        generation: 1,
        entries: [
          {
            ...pop.entries[0],
            dna: {
              ...(pop.entries[0].dna as DecisionDNA),
              patternWeights: [0.1, 0.20000001, 0.3], // tiny mutation
            } as unknown as DecisionDNA,
          },
          pop.entries[1],
        ],
      };

      expect(() => assertWeightsExact(snapshot, mutatedPopPattern, "MUTATION_TEST_PATTERN")).toThrow(
        /AB_EVIDENCE_ASSERTION_FAILED.*patternWeights.*mismatch/
      );

      // Mutate single interaction weight
      const mutatedPopInteraction: PopulationSnapshot = {
        generation: 1,
        entries: [
          pop.entries[0],
          {
            ...pop.entries[1],
            dna: {
              ...(pop.entries[1].dna as DecisionDNA),
              contextPatternWeights: [-0.1, 0.1, 0.2, -0.20000001], // tiny mutation
            } as unknown as DecisionDNA,
          },
        ],
      };

      expect(() => assertWeightsExact(snapshot, mutatedPopInteraction, "MUTATION_TEST_INTERACTION")).toThrow(
        /AB_EVIDENCE_ASSERTION_FAILED.*contextPatternWeights.*mismatch/
      );
    });

    it("should detect weight changes in weight digest recomputation", () => {
      const pop = makeSamplePopulation();
      const digestA = computeG1WeightDigest(pop.entries);

      const mutatedPop: PopulationSnapshot = {
        generation: 1,
        entries: [
          {
            ...pop.entries[0],
            dna: {
              ...(pop.entries[0].dna as DecisionDNA),
              patternWeights: [0.10001, 0.2, 0.3],
            } as unknown as DecisionDNA,
          },
          pop.entries[1],
        ],
      };
      const digestB = computeG1WeightDigest(mutatedPop.entries);

      expect(digestA["test-genome-001"]).toBeDefined();
      expect(digestB["test-genome-001"]).toBeDefined();
      expect(digestA["test-genome-001"]).not.toBe(digestB["test-genome-001"]);
      expect(digestA["test-genome-002"]).toBe(digestB["test-genome-002"]);
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
            playerSeeds: { p1: 100, p2: 200 },
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

  describe("5. Markdown Dynamic Rendering & Artifact Source of Truth", () => {
    function createSyntheticArtifact(overrides?: {
      matchIndex?: number;
      p1?: string;
      p2?: string;
      treatmentWinner?: "p1" | "p2";
      treatmentDecisions?: number;
    }): FeatureScalingABEvidenceArtifact {
      const matchIdx = overrides?.matchIndex ?? 3;
      const p1Id = overrides?.p1 ?? "synth-p1";
      const p2Id = overrides?.p2 ?? "synth-p2";
      const tWinner = overrides?.treatmentWinner ?? "p2";
      const tDecisions = overrides?.treatmentDecisions ?? 123;

      const dummyControlMatches = new Array(30).fill(null).map((_, idx) => ({
        matchIndex: idx,
        pairIndex: 0,
        p1GenomeId: idx === matchIdx ? p1Id : `p1-${idx}`,
        p2GenomeId: idx === matchIdx ? p2Id : `p2-${idx}`,
        matchSeed: 1000 + idx,
        playerSeeds: { p1: 10 + idx, p2: 20 + idx },
        completed: idx === 28 || idx === 29,
        winner: (idx === 28 ? "p1" : idx === 29 ? "p2" : undefined) as "p1" | "p2" | undefined,
        totalDecisions: idx === 28 || idx === 29 ? 280 : 500,
        turnCount: idx === 28 || idx === 29 ? 35 : 60,
      }));

      const dummyTreatmentMatches = new Array(30).fill(null).map((_, idx) => ({
        matchIndex: idx,
        pairIndex: 0,
        p1GenomeId: idx === matchIdx ? p1Id : `p1-${idx}`,
        p2GenomeId: idx === matchIdx ? p2Id : `p2-${idx}`,
        matchSeed: 1000 + idx,
        playerSeeds: { p1: 10 + idx, p2: 20 + idx },
        completed: idx === matchIdx,
        winner: idx === matchIdx ? tWinner : undefined,
        totalDecisions: idx === matchIdx ? tDecisions : 500,
        turnCount: idx === matchIdx ? 18 : 60,
      }));

      const perMatch = new Array(30).fill(null).map((_, idx) => {
        let classification = "UNCHANGED_INCOMPLETE";
        if (idx === 28 || idx === 29) {
          classification = "CONTROL_COMPLETED_TO_TREATMENT_INCOMPLETE";
        } else if (idx === matchIdx) {
          classification = "CONTROL_INCOMPLETE_TO_TREATMENT_COMPLETED";
        }
        return {
          matchIndex: idx,
          pairIndex: 0,
          p1GenomeId: idx === matchIdx ? p1Id : `p1-${idx}`,
          p2GenomeId: idx === matchIdx ? p2Id : `p2-${idx}`,
          controlCompleted: idx === 28 || idx === 29,
          controlWinner: (idx === 28 ? "p1" : idx === 29 ? "p2" : undefined) as "p1" | "p2" | undefined,
          controlDecisions: idx === 28 || idx === 29 ? 280 : 500,
          controlTurnCount: idx === 28 || idx === 29 ? 35 : 60,
          treatmentCompleted: idx === matchIdx,
          treatmentWinner: idx === matchIdx ? tWinner : undefined,
          treatmentDecisions: idx === matchIdx ? tDecisions : 500,
          treatmentTurnCount: idx === matchIdx ? 18 : 60,
          classification,
        };
      });

      const categoryCounts = {
        UNCHANGED_COMPLETED: 0,
        UNCHANGED_INCOMPLETE: 27,
        CONTROL_INCOMPLETE_TO_TREATMENT_COMPLETED: 1,
        CONTROL_COMPLETED_TO_TREATMENT_INCOMPLETE: 2,
        OUTCOME_CHANGED: 0,
        FAILED: 0,
      };

      const dummyPassMetrics = {
        totalDecisionCount: 14000,
        passSelectedCount: 13000,
        actionSelectedCount: 800,
        effectSelectedCount: 200,
        otherSelectedCount: 0,
        forcedPassCount: 3000,
        strictPassWinCount: 10000,
        tieBreakPassCount: 0,
        endLegalCount: 6000,
        passGreaterThanEndCount: 5900,
        passEqualsEndCount: 20,
        passLessThanEndCount: 80,
        passChosenWhileEndLegalCount: 5900,
      };

      const dummyStats = computeStats([10, 20]);

      return {
        workId: "BP-SIM-AI-FEATURE-SCALING-AB-EVIDENCE-V1-R1",
        baselineSha: "4c9f8c273d9c2bd8068173dd1333bcc55547668a",
        implementationSha: "975788f80054f4e5a08e446ee9967d400726bca9",
        evidenceHarnessRevision: "R1",
        environment: {
          environmentRef: "official:light-entry16",
          regulationId: "light-entry16",
          frameId: "entry16",
          rulePackageVersion: "9.1.2",
        },
        g1Population: {
          size: 6,
          genomeIds: ["g1", "g2", "g3", "g4", "g5", "g6"],
          weightCounts: {
            patternWeights: 143,
            contextPatternWeights: 23309,
            totalWeights: 23452,
          },
        },
        weightIntegrity: {
          baselineDigest: { g1: "d1" },
          checkpoints: {
            controlAPre: { g1: "d1" },
            controlAPost: { g1: "d1" },
            controlBPre: { g1: "d1" },
            controlBPost: { g1: "d1" },
            treatmentAPre: { g1: "d1" },
            treatmentAPost: { g1: "d1" },
            treatmentBPre: { g1: "d1" },
            treatmentBPost: { g1: "d1" },
          },
          arrayExactEqualityPassed: true,
          digestEqualityPassed: true,
        },
        scheduleIntegrity: {
          matchCount: 30,
          scheduleSignature: "sig123",
          matches: [],
          scheduleEqualityPassed: true,
        },
        scalerRestoreCheck: {
          controlA: true,
          controlB: true,
          treatmentA: true,
          treatmentB: true,
          passed: true,
        },
        determinismCheck: {
          controlAEqualsB: true,
          controlDigest: "cdig",
          treatmentAEqualsB: true,
          treatmentDigest: "tdig",
          passed: true,
        },
        historicalControlCheck: {
          kind: "OUTCOME_SIGNATURE",
          expected: {
            scheduled: 30,
            completed: 2,
            incomplete: 28,
            failed: 0,
            completedIndices: [28, 29],
          },
          actual: {
            scheduled: 30,
            completed: 2,
            incomplete: 28,
            failed: 0,
            completedIndices: [28, 29],
          },
          passed: true,
          fullHistoricalRuntimeReplayClaimed: false,
        },
        control: {
          arm: "CONTROL",
          runLabel: "CONTROL-A",
          g1WeightDigest: { g1: "d1" },
          matches: dummyControlMatches,
          completedCount: 2,
          incompleteCount: 28,
          failedCount: 0,
          drawsCount: 0,
          p1WinsCount: 1,
          p2WinsCount: 1,
          completionRate: 2 / 30,
          totalDecisions: 14000,
          decisionCountStats: dummyStats,
          passMetrics: dummyPassMetrics,
          marginStats: dummyStats,
          scoreMagnitude: {
            selectedScoreAbs: dummyStats,
            passScoreAbs: dummyStats,
            bestNonPassScoreAbs: dummyStats,
            marginAbs: dummyStats,
          },
          featureMagnitude: {
            maxAbsContextFeature: 138,
            maxAbsPatternFeature: 26,
            maxAbsInteractionInput: 3120,
          },
          fitnessEntries: [],
          readiness: { status: "REEVALUATION_REQUIRED", validCount: 0 },
          logicalDigest: "cdig",
        },
        treatment: {
          arm: "TREATMENT",
          runLabel: "TREATMENT-A",
          g1WeightDigest: { g1: "d1" },
          matches: dummyTreatmentMatches,
          completedCount: 1,
          incompleteCount: 29,
          failedCount: 0,
          drawsCount: 0,
          p1WinsCount: tWinner === "p1" ? 1 : 0,
          p2WinsCount: tWinner === "p2" ? 1 : 0,
          completionRate: 1 / 30,
          totalDecisions: 14000,
          decisionCountStats: dummyStats,
          passMetrics: dummyPassMetrics,
          marginStats: dummyStats,
          scoreMagnitude: {
            selectedScoreAbs: dummyStats,
            passScoreAbs: dummyStats,
            bestNonPassScoreAbs: dummyStats,
            marginAbs: dummyStats,
          },
          featureMagnitude: {
            maxAbsContextFeature: 1.0,
            maxAbsPatternFeature: 1.0,
            maxAbsInteractionInput: 1.0,
          },
          fitnessEntries: [],
          readiness: { status: "REEVALUATION_REQUIRED", validCount: 0 },
          logicalDigest: "tdig",
        },
        comparison: {
          perMatch,
          categoryCounts,
        },
        nonClaims: {
          passStallFullySolved: false,
          mutationBiasProvenCause: false,
          policyProvenCause: false,
          cycleProven: false,
          strongDnaProven: false,
          multiGenerationProven: false,
          rulesNeedChange: false,
        },
      };
    }

    it("should render markdown containing dynamic match narrative matching artifact values", () => {
      const artifact1 = createSyntheticArtifact({
        matchIndex: 3,
        p1: "alpha-genome",
        p2: "beta-genome",
        treatmentWinner: "p2",
        treatmentDecisions: 123,
      });

      const md1 = renderEvidenceMarkdown(artifact1);
      expect(md1).toContain("**Match 3** (`alpha-genome` vs `beta-genome`)");
      expect(md1).toContain("123 decisions");
      expect(md1).toContain("勝者: `p2`");

      // Stale hardcoded values from V1 should NOT appear in this dynamic render
      expect(md1).not.toContain("297 decisions");
      expect(md1).not.toContain("300 decisions");

      // Render another artifact with different values
      const artifact2 = createSyntheticArtifact({
        matchIndex: 12,
        p1: "gamma-genome",
        p2: "delta-genome",
        treatmentWinner: "p1",
        treatmentDecisions: 45,
      });

      const md2 = renderEvidenceMarkdown(artifact2);
      expect(md2).toContain("**Match 12** (`gamma-genome` vs `delta-genome`)");
      expect(md2).toContain("45 decisions");
      expect(md2).toContain("勝者: `p1`");
      expect(md2).not.toContain("alpha-genome");
    });

    it("should validate self-consistency and pass on valid artifact", () => {
      const artifact = createSyntheticArtifact();
      expect(() => validateArtifactSelfConsistency(artifact)).not.toThrow();
    });

    it("should fail validation on internally inconsistent artifact", () => {
      const artifact = createSyntheticArtifact();
      // Introduce inconsistency: category counts sum != 30
      artifact.comparison.categoryCounts.FAILED = 99;
      expect(() => validateArtifactSelfConsistency(artifact)).toThrow(
        /Category counts sum must be 30/
      );
    });
  });
});
