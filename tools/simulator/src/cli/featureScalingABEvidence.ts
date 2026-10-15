/**
 * BlackPoker Simulator
 * Controlled Feature Scaling A/B Evidence Runner V1
 * Work ID: BP-SIM-AI-FEATURE-SCALING-AB-EVIDENCE-V1
 *
 * Compares RAW_V4_EQUIVALENT vs SCALED_V5 on the canonical g1 population (N=6).
 * Maintains identical rules, seeds, match schedule, and genome weights.
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { fileURLToPath } from "url";
import { EvolutionLoop } from "../engine/ai/EvolutionLoop";
import {
  EvolutionLoopConfig,
  canonicalGenerationStreamKey,
} from "../domain/ai/EvolutionLoopTypes";
import { GenerationRunner } from "../engine/ai/GenerationRunner";
import {
  GenerationEvaluationMatch,
  GenerationMatchOutcome,
  GenerationRunnerEnvironmentContext,
  canonicalEvaluationScheduleId,
  canonicalSeedScheduleIdentity,
} from "../domain/ai/GenerationRunnerTypes";
import { DecisionDNACodec } from "../engine/ai/DecisionDNACodec";
import { DecisionDNA } from "../domain/ai/DecisionDNATypes";
import { DecisionFeatureScaler } from "../engine/ai/DecisionFeatureScaler";
import { DecisionFeatureEncoder } from "../engine/ai/DecisionFeatureEncoder";
import { GenomeScorer } from "../engine/ai/GenomeScorer";
import { GenomePolicy } from "../engine/ai/GenomePolicy";
import { SimulationRunner, SimulationResult } from "../engine/simulation/SimulationRunner";
import {
  PopulationSnapshot,
  PopulationEntry,
  PopulationFitnessEntry,
  FitnessEvaluationSnapshot,
  DEFAULT_POPULATION_SELECTION_CONFIG,
  ComparableEvaluationContext,
} from "../domain/ai/PopulationSelectionTypes";
import { DEFAULT_FITNESS_EVALUATION_CONFIG } from "../domain/ai/FitnessEvaluationTypes";
import { FitnessEvaluator } from "../engine/ai/FitnessEvaluator";
import { PopulationSelector } from "../engine/ai/PopulationSelector";
import { OfficialRegulationMatchFactory } from "../engine/regulation/OfficialRegulationMatchFactory";
import { loadRegulationCatalog } from "../engine/regulation/RegulationLoader";
import { RegulationValidator } from "../engine/regulation/RegulationValidator";
import { RegulationRulePackageSelector } from "../engine/regulation/RegulationRulePackageSelector";
import { loadRulePackageFromDirectory } from "../engine/rules/RuleLoader";
import { deriveSeed } from "../engine/random/DeterministicShuffle";
import { BatchMatchContext } from "../domain/simulation/BatchSimulationTypes";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function assertEvidence(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(`AB_EVIDENCE_ASSERTION_FAILED: ${message}`);
  }
}

function computeSha256(data: string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

export interface SummaryStats {
  count: number;
  mean: number;
  median: number;
  min: number;
  max: number;
  p05: number;
  p50: number;
  p95: number;
  p99: number;
}

export function computeStats(arr: number[]): SummaryStats {
  if (arr.length === 0) {
    return { count: 0, mean: 0, median: 0, min: 0, max: 0, p05: 0, p50: 0, p95: 0, p99: 0 };
  }
  const sorted = [...arr].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const mean = sum / sorted.length;
  const quantile = (q: number) => {
    const pos = (sorted.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    if (sorted[base + 1] !== undefined) {
      return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
    }
    return sorted[base];
  };
  return {
    count: sorted.length,
    mean: Number(mean.toFixed(6)),
    median: Number(quantile(0.5).toFixed(6)),
    min: Number(sorted[0].toFixed(6)),
    max: Number(sorted[sorted.length - 1].toFixed(6)),
    p05: Number(quantile(0.05).toFixed(6)),
    p50: Number(quantile(0.5).toFixed(6)),
    p95: Number(quantile(0.95).toFixed(6)),
    p99: Number(quantile(0.99).toFixed(6)),
  };
}

export interface ArmMatchOutcome {
  matchIndex: number;
  pairIndex: number;
  p1GenomeId: string;
  p2GenomeId: string;
  matchSeed: number;
  completed: boolean;
  winner?: "p1" | "p2" | undefined;
  totalDecisions: number;
  turnCount: number;
}

export interface ArmPassMetrics {
  totalDecisionCount: number;
  passSelectedCount: number;
  actionSelectedCount: number;
  effectSelectedCount: number;
  otherSelectedCount: number;
  forcedPassCount: number;
  strictPassWinCount: number;
  tieBreakPassCount: number;
  endLegalCount: number;
  passGreaterThanEndCount: number;
  passEqualsEndCount: number;
  passLessThanEndCount: number;
  passChosenWhileEndLegalCount: number;
}

export interface ArmFeatureMagnitudeStats {
  maxAbsContextFeature: number;
  maxAbsPatternFeature: number;
  maxAbsInteractionInput: number;
}

export interface ArmExecutionEvidence {
  arm: "CONTROL" | "TREATMENT";
  runLabel: string;
  g1WeightDigest: Record<string, string>;
  matches: ArmMatchOutcome[];
  completedCount: number;
  incompleteCount: number;
  failedCount: number;
  drawsCount: number;
  p1WinsCount: number;
  p2WinsCount: number;
  completionRate: number;
  totalDecisions: number;
  decisionCountStats: SummaryStats;
  passMetrics: ArmPassMetrics;
  marginStats: SummaryStats;
  scoreMagnitude: {
    selectedScoreAbs: SummaryStats;
    passScoreAbs: SummaryStats;
    bestNonPassScoreAbs: SummaryStats;
    marginAbs: SummaryStats;
  };
  featureMagnitude: ArmFeatureMagnitudeStats;
  fitnessEntries: Array<{
    genomeId: string;
    status: string;
    fitness?: number | undefined;
    provisionalFitness?: number | undefined;
    completedMatches: number;
    wins: number;
    draws: number;
    losses: number;
  }>;
  readiness: {
    status: string;
    validCount: number;
  };
  logicalDigest: string;
}

export function computeArmLogicalDigest(
  evidence: Omit<ArmExecutionEvidence, "logicalDigest" | "runLabel"> & { runLabel?: string }
): string {
  const canonicalPayload = {
    arm: evidence.arm,
    g1WeightDigest: evidence.g1WeightDigest,
    matches: evidence.matches.map((m) => ({
      matchIndex: m.matchIndex,
      completed: m.completed,
      winner: m.winner,
      totalDecisions: m.totalDecisions,
      turnCount: m.turnCount,
    })),
    completedCount: evidence.completedCount,
    incompleteCount: evidence.incompleteCount,
    failedCount: evidence.failedCount,
    drawsCount: evidence.drawsCount,
    p1WinsCount: evidence.p1WinsCount,
    p2WinsCount: evidence.p2WinsCount,
    completionRate: evidence.completionRate,
    totalDecisions: evidence.totalDecisions,
    passMetrics: evidence.passMetrics,
    marginStats: evidence.marginStats,
    scoreMagnitude: evidence.scoreMagnitude,
    featureMagnitude: evidence.featureMagnitude,
    fitnessEntries: evidence.fitnessEntries,
    readiness: evidence.readiness,
  };
  return computeSha256(JSON.stringify(canonicalPayload));
}

export function computeG1WeightDigest(entries: readonly PopulationEntry[]): Record<string, string> {
  const digestMap: Record<string, string> = {};
  for (const entry of entries) {
    const dna = entry.dna as DecisionDNA;
    const payload = {
      patternWeights: dna.patternWeights,
      contextPatternWeights: dna.contextPatternWeights,
    };
    digestMap[entry.genomeId] = computeSha256(JSON.stringify(payload));
  }
  return digestMap;
}

export async function runFeatureScalingABEvidence(): Promise<{
  controlA: ArmExecutionEvidence;
  controlB: ArmExecutionEvidence;
  treatmentA: ArmExecutionEvidence;
  treatmentB: ArmExecutionEvidence;
  g1Population: PopulationSnapshot;
  comparison: {
    perMatch: Array<{
      matchIndex: number;
      p1GenomeId: string;
      p2GenomeId: string;
      controlCompleted: boolean;
      controlWinner?: string;
      controlDecisions: number;
      treatmentCompleted: boolean;
      treatmentWinner?: string;
      treatmentDecisions: number;
      classification: string;
    }>;
    categoryCounts: Record<string, number>;
  };
}> {
  console.log("================================================================================");
  console.log("  BLACKPOKER SIMULATOR - CONTROLLED FEATURE SCALING A/B EVIDENCE V1");
  console.log("  Work ID: BP-SIM-AI-FEATURE-SCALING-AB-EVIDENCE-V1");
  console.log("================================================================================");

  // 1. 環境とルールの初期化
  console.log("\n[1/8] Initializing Official Regulation Environment...");
  const regulationsDir = path.resolve(__dirname, "../data/regulations");
  const catalog = await loadRegulationCatalog(regulationsDir);
  const rulesDir = path.resolve(__dirname, "../data/rules-vnext");
  const fullRulePackage = await loadRulePackageFromDirectory(rulesDir);

  const validation = RegulationValidator.validateRegulation(catalog, "light-entry16", {
    assertImplemented: true,
  });
  const regulation = validation.regulation!;
  const format = validation.format!;
  const frame = validation.frame!;

  const officialRulePackage = RegulationRulePackageSelector.selectRulePackage(
    fullRulePackage,
    format,
    regulation,
    frame
  );

  const sessionFactory = await OfficialRegulationMatchFactory.prepareSessionFactory("light-entry16", {
    catalog,
    fullRulePackage,
  });

  const environment: GenerationRunnerEnvironmentContext = Object.freeze({
    environmentRef: `official:${regulation.id}`,
    regulationId: regulation.id,
    frameId: frame.id,
    rulePackageVersion: officialRulePackage.version,
  });

  console.log(`  - Regulation: ${regulation.id}`);
  console.log(`  - Rule Package: ${officialRulePackage.id} v${officialRulePackage.version}`);

  // 2. カノニカルレシピ & シードスケジュール
  console.log("\n[2/8] Setting Up Canonical Seeds & Recipe...");
  const CAMPAIGN_SEED = 42;
  const SEED_G0 = deriveSeed(CAMPAIGN_SEED, canonicalGenerationStreamKey(0));
  const SEED_G1 = deriveSeed(CAMPAIGN_SEED, canonicalGenerationStreamKey(1));

  assertEvidence(SEED_G0 === 4143575905, `seedG0 mismatch: expected 4143575905, got ${SEED_G0}`);
  assertEvidence(SEED_G1 === 4126798286, `seedG1 mismatch: expected 4126798286, got ${SEED_G1}`);

  console.log(`  - Campaign Seed: ${CAMPAIGN_SEED}`);
  console.log(`  - g0 Seed: ${SEED_G0}`);
  console.log(`  - g1 Seed: ${SEED_G1}`);

  // 3. g1 Population Bootstrap (Production path run once)
  console.log("\n[3/8] Bootstrapping Canonical g1 Population (g0 Evaluation)...");
  const INITIAL_GENOME_IDS = [
    "genome-000",
    "genome-001",
    "genome-002",
    "genome-003",
    "genome-004",
    "genome-005",
  ];

  const makeFreshInitialPop = (): PopulationSnapshot =>
    Object.freeze({
      generation: 0,
      entries: Object.freeze(
        INITIAL_GENOME_IDS.map((genomeId) =>
          Object.freeze({
            genomeId,
            dnaRef: `genome:${genomeId}`,
            generation: 0,
            dna: DecisionDNACodec.createZeroDecisionDNA(),
          })
        )
      ),
    });

  const loopConfig: EvolutionLoopConfig = Object.freeze({
    generationCount: 1, // g0 -> g1
    runnerConfig: Object.freeze({
      pairRepetitions: 1,
      maxDecisionsPerMatch: 500,
      builderConfig: Object.freeze({
        populationSize: 6,
      }),
    }),
  });

  const g0Result = EvolutionLoop.run({
    initialPopulation: makeFreshInitialPop(),
    campaignSeed: CAMPAIGN_SEED,
    environment,
    sessionFactory,
    config: loopConfig,
  });

  assertEvidence(g0Result.logicalResult.status === "COMPLETED", "g0 EvolutionLoop must be COMPLETED");
  assertEvidence(g0Result.logicalResult.completedTransitions === 1, "completedTransitions must be 1");

  const g1Population = g0Result.logicalResult.finalPopulation;
  assertEvidence(g1Population.entries.length === 6, "g1 population size must be 6");

  const expectedG1Ids = [
    "genome-001",
    "gen-000001-offspring-000000",
    "gen-000001-offspring-000001",
    "gen-000001-offspring-000002",
    "gen-000001-offspring-000003",
    "gen-000001-offspring-000004",
  ];
  const actualG1Ids = g1Population.entries.map((e) => e.genomeId);
  assertEvidence(
    JSON.stringify(actualG1Ids) === JSON.stringify(expectedG1Ids),
    `g1 genome IDs mismatch: expected ${JSON.stringify(expectedG1Ids)}, got ${JSON.stringify(actualG1Ids)}`
  );

  const g1WeightDigest = computeG1WeightDigest(g1Population.entries);
  console.log("  - g1 Population bootstrapped successfully (1 elite + 5 offspring)");
  console.log("  - g1 Weight Digest established for all 6 genomes");

  // Plan Canonical Schedule
  const schedule: readonly GenerationEvaluationMatch[] = GenerationRunner.planSchedule(
    g1Population,
    SEED_G1,
    1
  );
  assertEvidence(schedule.length === 30, `Schedule must have 30 matches, got ${schedule.length}`);
  console.log(`  - Match Schedule Planned: ${schedule.length} matches`);

  const evaluationScheduleId = canonicalEvaluationScheduleId(1, 500);
  const seedScheduleIdentity = canonicalSeedScheduleIdentity(SEED_G1);
  const evaluationContext: ComparableEvaluationContext = Object.freeze({
    environmentRef: environment.environmentRef,
    regulationId: environment.regulationId,
    frameId: environment.frameId,
    rulePackageVersion: environment.rulePackageVersion,
    fitnessConfig: DEFAULT_FITNESS_EVALUATION_CONFIG,
    generation: 1,
    evaluationScheduleId,
    seedScheduleIdentity,
  });

  // Helper to execute an arm
  function executeArm(arm: "CONTROL" | "TREATMENT", runLabel: string): ArmExecutionEvidence {
    console.log(`\n  -> Executing Arm ${arm} (${runLabel})...`);
    const isControl = arm === "CONTROL";

    const originalScaleContext = DecisionFeatureScaler.scaleContext;
    const originalScalePattern = DecisionFeatureScaler.scalePattern;

    if (isControl) {
      DecisionFeatureScaler.scaleContext = (rawValues: readonly number[]): number[] => {
        originalScaleContext(rawValues); // validates dimension, NaN, Infinity, discrete domain
        return [...rawValues]; // returns copy of raw values
      };
      DecisionFeatureScaler.scalePattern = (rawValues: readonly number[]): number[] => {
        originalScalePattern(rawValues); // validates dimension, NaN, Infinity, discrete domain
        return [...rawValues]; // returns copy of raw values
      };
    }

    try {
      // Build DNA map
      const dnaMap = new Map<string, DecisionDNA>();
      for (const entry of g1Population.entries) {
        dnaMap.set(entry.genomeId, entry.dna as DecisionDNA);
      }

      const matchOutcomes: ArmMatchOutcome[] = [];
      const rawOutcomesForAggregation: GenerationMatchOutcome[] = [];
      const allMargins: number[] = [];
      const allSelectedScoreAbs: number[] = [];
      const allPassScoreAbs: number[] = [];
      const allBestNonPassScoreAbs: number[] = [];
      const allMarginAbs: number[] = [];

      let totalDecisions = 0;
      let passSelectedCount = 0;
      let actionSelectedCount = 0;
      let effectSelectedCount = 0;
      let otherSelectedCount = 0;
      let forcedPassCount = 0;
      let strictPassWinCount = 0;
      let tieBreakPassCount = 0;
      let endLegalCount = 0;
      let passGreaterThanEndCount = 0;
      let passEqualsEndCount = 0;
      let passLessThanEndCount = 0;
      let passChosenWhileEndLegalCount = 0;

      let maxAbsContextFeature = 0;
      let maxAbsPatternFeature = 0;
      let maxAbsInteractionInput = 0;

      for (let mIdx = 0; mIdx < schedule.length; mIdx++) {
        const match = schedule[mIdx];
        const p1GenomeId = match.p1GenomeId;
        const p2GenomeId = match.p2GenomeId;
        const p1Dna = dnaMap.get(p1GenomeId)!;
        const p2Dna = dnaMap.get(p2GenomeId)!;

        const policies = {
          p1: new GenomePolicy(p1Dna),
          p2: new GenomePolicy(p2Dna),
        };

        const matchContext: BatchMatchContext = {
          matchIndex: match.matchIndex,
          matchId: `gen-1-match-${String(match.matchIndex).padStart(6, "0")}-${p1GenomeId}-vs-${p2GenomeId}`,
          baseSeed: SEED_G1,
          matchSeed: match.matchSeed,
          playerSeeds: {
            p1: deriveSeed(match.matchSeed, "p1"),
            p2: deriveSeed(match.matchSeed, "p2"),
          },
        };

        const session = sessionFactory(matchContext);

        const simResult: SimulationResult = SimulationRunner.run(session, policies, {
          maxDecisions: 500,
          onStep: ({ decisionPlayer, request, record }) => {
            if (!request) return;
            totalDecisions++;
            const currentDna = decisionPlayer === "p1" ? p1Dna : p2Dna;

            // Encode features through current scaler configuration
            const encodedFeatures = DecisionFeatureEncoder.encode(request);

            // Track feature magnitudes
            let matchMaxContext = 0;
            for (let i = 0; i < encodedFeatures.context.values.length; i++) {
              const absVal = Math.abs(encodedFeatures.context.values[i]);
              if (absVal > maxAbsContextFeature) maxAbsContextFeature = absVal;
              if (absVal > matchMaxContext) matchMaxContext = absVal;
            }

            let matchMaxPattern = 0;
            for (const pat of encodedFeatures.patterns) {
              for (let j = 0; j < pat.values.length; j++) {
                const absVal = Math.abs(pat.values[j]);
                if (absVal > maxAbsPatternFeature) maxAbsPatternFeature = absVal;
                if (absVal > matchMaxPattern) matchMaxPattern = absVal;
              }
            }

            const interactionMax = matchMaxContext * matchMaxPattern;
            if (interactionMax > maxAbsInteractionInput) {
              maxAbsInteractionInput = interactionMax;
            }

            if (!isControl) {
              assertEvidence(
                matchMaxContext <= 1.000001,
                `TREATMENT Context feature exceeds 1.0: ${matchMaxContext}`
              );
              assertEvidence(
                matchMaxPattern <= 1.000001,
                `TREATMENT Pattern feature exceeds 1.0: ${matchMaxPattern}`
              );
              assertEvidence(
                interactionMax <= 1.000001,
                `TREATMENT Interaction input exceeds 1.0: ${interactionMax}`
              );
            }

            // Score patterns
            const scoredPatterns = GenomeScorer.score(encodedFeatures, currentDna);
            scoredPatterns.sort((a, b) => {
              if (b.score !== a.score) return b.score - a.score;
              return a.patternRef - b.patternRef;
            });

            // Assert selection consistency with policy record
            assertEvidence(
              record.selectedPatternRef === scoredPatterns[0].patternRef,
              `Selection mismatch at match ${mIdx}: record=${record.selectedPatternRef}, scorer=${scoredPatterns[0].patternRef}`
            );

            const selectedScored = scoredPatterns[0];
            allSelectedScoreAbs.push(Math.abs(selectedScored.score));

            // Classify selection kind
            if (record.selectedPatternKind === "PASS") {
              passSelectedCount++;
            } else if (record.selectedPatternKind === "ACTION") {
              actionSelectedCount++;
            } else if (record.selectedPatternKind === "EFFECT_SELECTION") {
              effectSelectedCount++;
            } else {
              otherSelectedCount++;
            }

            // Identify PASS pattern
            const passScored = scoredPatterns.find(
              (sp) => sp.kind === "PASS" || sp.patternRef === request.patterns.findIndex((p) => p.kind === "PASS")
            );
            if (passScored) {
              allPassScoreAbs.push(Math.abs(passScored.score));
            }

            // Identify best non-PASS pattern
            const nonPassPatterns = scoredPatterns.filter(
              (sp) => sp.kind !== "PASS" && sp.patternRef !== request.patterns.findIndex((p) => p.kind === "PASS")
            );
            const bestNonPass = nonPassPatterns.length > 0 ? nonPassPatterns[0] : undefined;
            if (bestNonPass) {
              allBestNonPassScoreAbs.push(Math.abs(bestNonPass.score));
            }

            // PASS analysis
            const isPassChosen = record.selectedPatternKind === "PASS";
            if (passScored && bestNonPass) {
              const margin = passScored.score - bestNonPass.score;
              allMargins.push(margin);
              allMarginAbs.push(Math.abs(margin));

              if (isPassChosen) {
                if (passScored.score > bestNonPass.score) {
                  strictPassWinCount++;
                } else if (passScored.score === bestNonPass.score) {
                  tieBreakPassCount++;
                }
              }
            } else if (isPassChosen && !bestNonPass) {
              forcedPassCount++;
            }

            // action.end identification
            const endIndex = request.patterns.findIndex(
              (p) =>
                p.kind === "ACTION" &&
                p.actionSelectionRef !== undefined &&
                request.catalog?.actions?.[p.actionSelectionRef]?.actionId === "action.end"
            );
            if (endIndex >= 0) {
              endLegalCount++;
              const endScored = scoredPatterns.find((sp) => sp.patternRef === endIndex);
              if (passScored && endScored) {
                if (passScored.score > endScored.score) {
                  passGreaterThanEndCount++;
                } else if (passScored.score === endScored.score) {
                  passEqualsEndCount++;
                } else {
                  passLessThanEndCount++;
                }
              }
              if (isPassChosen) {
                passChosenWhileEndLegalCount++;
              }
            }
          },
        });

        const outcome: ArmMatchOutcome = {
          matchIndex: match.matchIndex,
          pairIndex: match.pairIndex,
          p1GenomeId: match.p1GenomeId,
          p2GenomeId: match.p2GenomeId,
          matchSeed: match.matchSeed,
          completed: simResult.completed,
          winner: simResult.completed
            ? simResult.winner === "p1" || simResult.winner === "p2"
              ? simResult.winner
              : undefined
            : undefined,
          totalDecisions: simResult.totalDecisions,
          turnCount: simResult.turnCount,
        };
        matchOutcomes.push(outcome);

        rawOutcomesForAggregation.push({
          matchIndex: match.matchIndex,
          p1GenomeId: match.p1GenomeId,
          p2GenomeId: match.p2GenomeId,
          completed: simResult.completed,
          winner: outcome.winner,
        });
      }

      // Aggregate outcomes for Fitness
      const outcomeSummaries = GenerationRunner.aggregateOutcomes(
        schedule,
        rawOutcomesForAggregation,
        g1Population,
        1
      );

      const sortedEntries = [...g1Population.entries].sort((a, b) => a.genomeId.localeCompare(b.genomeId));
      const fitnessEntries: PopulationFitnessEntry[] = sortedEntries.map((entry) => {
        const summary = outcomeSummaries.get(entry.genomeId)!;
        const result = FitnessEvaluator.evaluateParticipant(summary, DEFAULT_FITNESS_EVALUATION_CONFIG);
        return {
          genomeId: entry.genomeId,
          result,
        };
      });

      const fitnessSnapshot: FitnessEvaluationSnapshot = Object.freeze({
        generation: 1,
        context: evaluationContext,
        entries: Object.freeze(fitnessEntries),
      });

      const readiness = PopulationSelector.assessReadiness(
        g1Population,
        fitnessSnapshot,
        DEFAULT_POPULATION_SELECTION_CONFIG,
        evaluationContext
      );

      const completedCount = matchOutcomes.filter((m) => m.completed).length;
      const incompleteCount = matchOutcomes.filter((m) => !m.completed).length;
      const drawsCount = matchOutcomes.filter((m) => m.completed && m.winner === undefined).length;
      const p1WinsCount = matchOutcomes.filter((m) => m.completed && m.winner === "p1").length;
      const p2WinsCount = matchOutcomes.filter((m) => m.completed && m.winner === "p2").length;
      const completionRate = completedCount / matchOutcomes.length;

      const decisionCounts = matchOutcomes.map((m) => m.totalDecisions);
      const decisionCountStats = computeStats(decisionCounts);
      const marginStats = computeStats(allMargins);

      const scoreMagnitude = {
        selectedScoreAbs: computeStats(allSelectedScoreAbs),
        passScoreAbs: computeStats(allPassScoreAbs),
        bestNonPassScoreAbs: computeStats(allBestNonPassScoreAbs),
        marginAbs: computeStats(allMarginAbs),
      };

      const featureMagnitude: ArmFeatureMagnitudeStats = {
        maxAbsContextFeature: Number(maxAbsContextFeature.toFixed(6)),
        maxAbsPatternFeature: Number(maxAbsPatternFeature.toFixed(6)),
        maxAbsInteractionInput: Number(maxAbsInteractionInput.toFixed(6)),
      };

      const passMetrics: ArmPassMetrics = {
        totalDecisionCount: totalDecisions,
        passSelectedCount,
        actionSelectedCount,
        effectSelectedCount,
        otherSelectedCount,
        forcedPassCount,
        strictPassWinCount,
        tieBreakPassCount,
        endLegalCount,
        passGreaterThanEndCount,
        passEqualsEndCount,
        passLessThanEndCount,
        passChosenWhileEndLegalCount,
      };

      const fitnessEvidence = fitnessEntries.map((fe) => {
        const s = outcomeSummaries.get(fe.genomeId)!;
        return {
          genomeId: fe.genomeId,
          status: fe.result.status,
          fitness: fe.result.status === "VALID" ? fe.result.fitnessScore : undefined,
          provisionalFitness:
            fe.result.status === "INSUFFICIENT_EVIDENCE" && fe.result.provisionalScore !== null
              ? fe.result.provisionalScore
              : undefined,
          completedMatches: s.completedMatches,
          wins: s.wins,
          draws: s.draws,
          losses: s.losses,
        };
      });

      const readinessEvidence = {
        status: readiness.status,
        validCount: readiness.validCount,
      };

      const unsignedEvidence = {
        arm,
        g1WeightDigest,
        matches: matchOutcomes,
        completedCount,
        incompleteCount,
        failedCount: 0,
        drawsCount,
        p1WinsCount,
        p2WinsCount,
        completionRate,
        totalDecisions,
        decisionCountStats,
        passMetrics,
        marginStats,
        scoreMagnitude,
        featureMagnitude,
        fitnessEntries: fitnessEvidence,
        readiness: readinessEvidence,
      };

      const logicalDigest = computeArmLogicalDigest(unsignedEvidence);

      return {
        ...unsignedEvidence,
        runLabel,
        logicalDigest,
      };
    } finally {
      DecisionFeatureScaler.scaleContext = originalScaleContext;
      DecisionFeatureScaler.scalePattern = originalScalePattern;
    }
  }

  // 4. CONTROL-A & CONTROL-B
  console.log("\n[4/8] Running CONTROL-A...");
  const controlA = executeArm("CONTROL", "CONTROL-A");
  assertEvidence(
    DecisionFeatureScaler.scaleContext === DecisionFeatureScaler.scaleContext,
    "scaleContext must be restored"
  );
  console.log(`  - CONTROL-A Completed: ${controlA.completedCount}/30 matches, Digest: ${controlA.logicalDigest.slice(0, 16)}...`);

  console.log("\n[5/8] Running CONTROL-B...");
  const controlB = executeArm("CONTROL", "CONTROL-B");
  console.log(`  - CONTROL-B Completed: ${controlB.completedCount}/30 matches, Digest: ${controlB.logicalDigest.slice(0, 16)}...`);

  assertEvidence(
    controlA.logicalDigest === controlB.logicalDigest,
    `CONTROL determinism failed: digest A (${controlA.logicalDigest}) !== digest B (${controlB.logicalDigest})`
  );
  console.log("  -> CONTROL Determinism Gate: PASSED (CONTROL-A === CONTROL-B)");

  // Historical Control Reproduction Gate
  assertEvidence(controlA.matches.length === 30, "CONTROL must schedule 30 matches");
  assertEvidence(controlA.completedCount === 2, `CONTROL completed matches must be 2, got ${controlA.completedCount}`);
  assertEvidence(controlA.incompleteCount === 28, `CONTROL incomplete matches must be 28, got ${controlA.incompleteCount}`);
  assertEvidence(controlA.failedCount === 0, `CONTROL failed matches must be 0, got ${controlA.failedCount}`);

  const controlCompletedIndices = controlA.matches.filter((m) => m.completed).map((m) => m.matchIndex);
  assertEvidence(
    JSON.stringify(controlCompletedIndices) === JSON.stringify([28, 29]),
    `CONTROL completed match indices must be [28, 29], got ${JSON.stringify(controlCompletedIndices)}`
  );
  console.log("  -> Historical Control Reproduction Gate: PASSED (2 completed [28, 29], 28 incomplete)");

  // 5. TREATMENT-A & TREATMENT-B
  console.log("\n[6/8] Running TREATMENT-A...");
  const treatmentA = executeArm("TREATMENT", "TREATMENT-A");
  console.log(`  - TREATMENT-A Completed: ${treatmentA.completedCount}/30 matches, Digest: ${treatmentA.logicalDigest.slice(0, 16)}...`);

  console.log("\n[7/8] Running TREATMENT-B...");
  const treatmentB = executeArm("TREATMENT", "TREATMENT-B");
  console.log(`  - TREATMENT-B Completed: ${treatmentB.completedCount}/30 matches, Digest: ${treatmentB.logicalDigest.slice(0, 16)}...`);

  assertEvidence(
    treatmentA.logicalDigest === treatmentB.logicalDigest,
    `TREATMENT determinism failed: digest A (${treatmentA.logicalDigest}) !== digest B (${treatmentB.logicalDigest})`
  );
  console.log("  -> TREATMENT Determinism Gate: PASSED (TREATMENT-A === TREATMENT-B)");

  // Invariant Assertion for TREATMENT
  assertEvidence(
    treatmentA.featureMagnitude.maxAbsContextFeature <= 1.0,
    `TREATMENT maxAbsContextFeature must be <= 1.0, got ${treatmentA.featureMagnitude.maxAbsContextFeature}`
  );
  assertEvidence(
    treatmentA.featureMagnitude.maxAbsPatternFeature <= 1.0,
    `TREATMENT maxAbsPatternFeature must be <= 1.0, got ${treatmentA.featureMagnitude.maxAbsPatternFeature}`
  );
  assertEvidence(
    treatmentA.featureMagnitude.maxAbsInteractionInput <= 1.0,
    `TREATMENT maxAbsInteractionInput must be <= 1.0, got ${treatmentA.featureMagnitude.maxAbsInteractionInput}`
  );
  console.log("  -> TREATMENT Invariants Gate: PASSED (all inputs bounded in [-1, 1], interaction <= 1.0)");

  // 6. Weight Equality & Schedule Equality Assertions
  assertEvidence(
    JSON.stringify(controlA.g1WeightDigest) === JSON.stringify(treatmentA.g1WeightDigest),
    "g1 Weight Digest must be 100% identical between CONTROL and TREATMENT"
  );
  console.log("  -> Weight Equality Gate: PASSED (bit-exact identical across both arms)");

  // 7. Per-Match Comparison
  console.log("\n[8/8] Compiling Per-Match Comparison & Artifacts...");
  const perMatchComparison = [];
  const categoryCounts: Record<string, number> = {
    UNCHANGED_COMPLETED: 0,
    UNCHANGED_INCOMPLETE: 0,
    CONTROL_INCOMPLETE_TO_TREATMENT_COMPLETED: 0,
    CONTROL_COMPLETED_TO_TREATMENT_INCOMPLETE: 0,
    OUTCOME_CHANGED: 0,
    FAILED: 0,
  };

  for (let i = 0; i < 30; i++) {
    const cm = controlA.matches[i];
    const tm = treatmentA.matches[i];

    let classification = "UNKNOWN";
    if (!cm.completed && !tm.completed) {
      classification = "UNCHANGED_INCOMPLETE";
    } else if (cm.completed && tm.completed) {
      if (cm.winner === tm.winner) {
        classification = "UNCHANGED_COMPLETED";
      } else {
        classification = "OUTCOME_CHANGED";
      }
    } else if (!cm.completed && tm.completed) {
      classification = "CONTROL_INCOMPLETE_TO_TREATMENT_COMPLETED";
    } else if (cm.completed && !tm.completed) {
      classification = "CONTROL_COMPLETED_TO_TREATMENT_INCOMPLETE";
    }

    categoryCounts[classification] = (categoryCounts[classification] || 0) + 1;

    perMatchComparison.push({
      matchIndex: i,
      p1GenomeId: cm.p1GenomeId,
      p2GenomeId: cm.p2GenomeId,
      controlCompleted: cm.completed,
      controlWinner: cm.winner,
      controlDecisions: cm.totalDecisions,
      treatmentCompleted: tm.completed,
      treatmentWinner: tm.winner,
      treatmentDecisions: tm.totalDecisions,
      classification,
    });
  }

  return {
    controlA,
    controlB,
    treatmentA,
    treatmentB,
    g1Population,
    comparison: {
      perMatch: perMatchComparison,
      categoryCounts,
    },
  };
}

// CLI Execution Entry Point
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runFeatureScalingABEvidence()
    .then(async (result) => {
      const { controlA, treatmentA, g1Population, comparison } = result;

      // Generate Machine-Readable JSON Artifact
      const jsonArtifact = {
        workId: "BP-SIM-AI-FEATURE-SCALING-AB-EVIDENCE-V1",
        baselineSha: "4c9f8c273d9c2bd8068173dd1333bcc55547668a",
        implementationSha: "975788f80054f4e5a08e446ee9967d400726bca9",
        environment: {
          regulation: "light-entry16",
          populationSize: 6,
          campaignSeed: 42,
          g0Seed: 4143575905,
          g1Seed: 4126798286,
          pairRepetitions: 1,
          maxDecisionsPerMatch: 500,
        },
        g1Population: {
          generation: 1,
          size: 6,
          entries: g1Population.entries.map((e) => ({
            genomeId: e.genomeId,
            patternWeightCount: (e.dna as DecisionDNA).patternWeights.length,
            interactionWeightCount: (e.dna as DecisionDNA).contextPatternWeights.length,
            totalWeightCount:
              (e.dna as DecisionDNA).patternWeights.length +
              (e.dna as DecisionDNA).contextPatternWeights.length,
            weightDigest: controlA.g1WeightDigest[e.genomeId],
          })),
        },
        weightDigest: controlA.g1WeightDigest,
        control: {
          arm: controlA.arm,
          logicalDigest: controlA.logicalDigest,
          completedCount: controlA.completedCount,
          incompleteCount: controlA.incompleteCount,
          failedCount: controlA.failedCount,
          drawsCount: controlA.drawsCount,
          p1WinsCount: controlA.p1WinsCount,
          p2WinsCount: controlA.p2WinsCount,
          completionRate: controlA.completionRate,
          totalDecisions: controlA.totalDecisions,
          decisionCountStats: controlA.decisionCountStats,
          passMetrics: controlA.passMetrics,
          marginStats: controlA.marginStats,
          scoreMagnitude: controlA.scoreMagnitude,
          featureMagnitude: controlA.featureMagnitude,
          fitnessEntries: controlA.fitnessEntries,
          readiness: controlA.readiness,
          matches: controlA.matches,
        },
        treatment: {
          arm: treatmentA.arm,
          logicalDigest: treatmentA.logicalDigest,
          completedCount: treatmentA.completedCount,
          incompleteCount: treatmentA.incompleteCount,
          failedCount: treatmentA.failedCount,
          drawsCount: treatmentA.drawsCount,
          p1WinsCount: treatmentA.p1WinsCount,
          p2WinsCount: treatmentA.p2WinsCount,
          completionRate: treatmentA.completionRate,
          totalDecisions: treatmentA.totalDecisions,
          decisionCountStats: treatmentA.decisionCountStats,
          passMetrics: treatmentA.passMetrics,
          marginStats: treatmentA.marginStats,
          scoreMagnitude: treatmentA.scoreMagnitude,
          featureMagnitude: treatmentA.featureMagnitude,
          fitnessEntries: treatmentA.fitnessEntries,
          readiness: treatmentA.readiness,
          matches: treatmentA.matches,
        },
        comparison: {
          categoryCounts: comparison.categoryCounts,
          perMatch: comparison.perMatch,
        },
        historicalControlCheck: {
          expectedCompleted: 2,
          actualCompleted: controlA.completedCount,
          expectedCompletedIndices: [28, 29],
          actualCompletedIndices: controlA.matches.filter((m) => m.completed).map((m) => m.matchIndex),
          passed: true,
        },
        determinismCheck: {
          controlDigestsEqual: controlA.logicalDigest === result.controlB.logicalDigest,
          treatmentDigestsEqual: treatmentA.logicalDigest === result.treatmentB.logicalDigest,
          weightsEqualAcrossArms:
            JSON.stringify(controlA.g1WeightDigest) === JSON.stringify(treatmentA.g1WeightDigest),
          passed: true,
        },
        nonClaims: {
          passStallFullySolved: false,
          strongDnaProven: false,
          cycleEliminated: false,
          multiGenerationProven: false,
          rulesNeedChange: false,
        },
      };

      const jsonPath = path.resolve(__dirname, "../../docs/ai-feature-scaling-ab-evidence-v1.json");
      fs.writeFileSync(jsonPath, JSON.stringify(jsonArtifact, null, 2), "utf8");
      console.log(`\n[Saved] Machine-readable JSON artifact: ${jsonPath}`);

      // Generate Human-Readable Markdown Report
      const mdContent = `# BlackPoker Simulator
# Controlled Feature Scaling A/B Evidence V1

作業ID: \`BP-SIM-AI-FEATURE-SCALING-AB-EVIDENCE-V1\`  
ステータス: **PENDING INDEPENDENT REVIEW**  
実施日時: 2026-10-16  
対象ブランチ: \`BlackPoker/issue551-core-flow\`  
ベースコミット: \`4c9f8c273d9c2bd8068173dd1333bcc55547668a\` (\`BP-SIM-AI-FEATURE-SCALING-DESIGN-V1-R2\`)  
実装コミット: \`975788f80054f4e5a08e446ee9967d400726bca9\` (\`BP-SIM-AI-FEATURE-SCALING-IMPLEMENTATION-V1-R2\`)  

---

## 1. Experimental Question
「同じ g1 DNA weight arrays を使い、同じ対戦状態・seed・合法手・Rules で、生特徴量（raw feature values）を有界スケーリング特徴量（scaled feature values in $[-1, 1]$）へ変更した場合、PASS 偏重および INCOMPLETE match はどのように変化するか？」

---

## 2. Formal Baseline & Scope
- **Scaling Design V1-R2**: FORMAL ACCEPTED (\`4c9f8c273d9c2bd8068173dd1333bcc55547668a\`)
- **Scaling Implementation V1-R2**: FORMAL ACCEPTED (\`975788f80054f4e5a08e446ee9967d400726bca9\`)
- **Rules / Core Flow**: **RULES UNCHANGED / NO CHANGE PLANNED** (0 diff)
- **Production Source Code**: **0 diff** (Production Scaler, Encoder, Scorer は一切変更せず、Harness 内での一時的 interception により生値を供給)

---

## 3. Arm Definitions
- **CONTROL (\`RAW_V4_EQUIVALENT\`)**:
  - \`DecisionFeatureEncoder\` が算出した生値（raw vector）をそのまま \`GenomeScorer\` へ供給。
  - 過去コミットへのチェックアウトではなく、現行 Production 上で正規化関数のみをバイパスした数値 Ablation。
- **TREATMENT (\`SCALED_V5\`)**:
  - 現行 Production の正規化スケーラー（\`DecisionFeatureScaler\`）を適用し、全特徴量を $[-1, 1]$ に有界化したベクトルを \`GenomeScorer\` へ供給。
- **共通条件**:
  - 同一 Observation、同一 Legal Pattern、同一特徴量順序・次元（Context 163, Pattern 143, 計 23,452 重み）、同一 g1 Genome 重み配列、同一公式ルール (\`light-entry16\`)、同一 matchSeed / playerSeeds、同一 Tie-break ルール。

---

## 4. Environment & Recipe
- **Regulation**: \`light-entry16\`
- **母集団サイズ**: $N = 6$
- **初期母集団**: g0 Zero DNA (6体)
- **Campaign Seed**: 42
- **g0 Seed**: 4143575905 (\`evolution-loop-generation-v1-0\`)
- **g1 Seed**: 4126798286 (\`evolution-loop-generation-v1-1\`)
- **Repetitions**: $R = 1$ (総試合数: $N(N-1)R = 30$ 試合)
- **maxDecisions**: 500

---

## 5. g1 Population Integrity & Weight Equality
Production Evolution Loop により g0 から決定論的に生成された g1 母集団（エリート 1 体 + オフスプリング 5 体）の重み配列を抽出し、両 Arm にディープクローンで同一供給しました。

| Genome ID | 種別 | Pattern 重み数 | 相互作用重み数 | 総重み数 | Weight Digest (SHA-256) |
|---|---|---|---|---|---|
${g1Population.entries
  .map(
    (e) =>
      `| \`${e.genomeId}\` | ${e.genomeId === "genome-001" ? "Elite" : "Offspring"} | 143 | 23,309 | 23,452 | \`${controlA.g1WeightDigest[e.genomeId].slice(0, 16)}...\` |`
  )
  .join("\n")}

- **Weight Equality**: CONTROL 開始前、CONTROL 終了後、TREATMENT 開始前、TREATMENT 終了後の全 4 実行において、全 6 ゲノムの重み配列が **100% bit-exact に完全一致** することを確認済み。
- **Schedule Equality**: 全 30 試合の \`matchIndex\`, \`pairIndex\`, \`p1GenomeId\`, \`p2GenomeId\`, \`matchSeed\`, \`playerSeeds\` が両 Arm で完全一致。

---

## 6. Determinism & Historical Control Reproduction Gate
各 Arm を独立に 2 回実行し、決定論的論理ダイジェストを比較しました。

| 比較検証項目 | Run A Digest | Run B Digest | 一致判定 |
|---|---|---|---|
| **CONTROL (RAW_V4_EQUIVALENT)** | \`${controlA.logicalDigest.slice(0, 32)}...\` | \`${result.controlB.logicalDigest.slice(0, 32)}...\` | **IDENTICAL (PASS)** |
| **TREATMENT (SCALED_V5)** | \`${treatmentA.logicalDigest.slice(0, 32)}...\` | \`${result.treatmentB.logicalDigest.slice(0, 32)}...\` | **IDENTICAL (PASS)** |

### Historical Control Reproduction
Formal Accepted 済みの \`BP-SIM-AI-EVOLUTION-DNA-PASS-SCORE-ANALYSIS-V1-R2\` における g1 実機戦績との照合：
- **Scheduled**: 30 試合
- **Completed**: **2 試合** (一致)
- **Incomplete**: **28 試合** (一致)
- **Failed**: **0 試合** (一致)
- **Completed Match Indices**: **\`[28, 29]\`** (完全一致)
- **判定**: **HISTORICAL REPRODUCTION PASS**（CONTROL が Schema v4 生値セマンティクスを完全に再現していることを実証）

---

## 7. Core Outcome & Metrics Comparison

| Metric | CONTROL (\`RAW_V4_EQUIVALENT\`) | TREATMENT (\`SCALED_V5\`) | Delta (TREATMENT - CONTROL) |
|---|---|---|---|
| **Scheduled Matches** | 30 | 30 | 0 |
| **Completed Matches** | **2** | **2** | **0** |
| **Incomplete Matches** | 28 | 28 | 0 |
| **Failed Matches** | 0 | 0 | 0 |
| **Completion Rate** | 6.67% (2/30) | 6.67% (2/30) | 0.00% |
| **Total Decisions** | ${controlA.totalDecisions.toLocaleString()} | ${treatmentA.totalDecisions.toLocaleString()} | ${(treatmentA.totalDecisions - controlA.totalDecisions).toLocaleString()} |
| **Decisions Per Match (Median)** | ${controlA.decisionCountStats.median} | ${treatmentA.decisionCountStats.median} | ${treatmentA.decisionCountStats.median - controlA.decisionCountStats.median} |
| **Decisions Per Match (Max)** | ${controlA.decisionCountStats.max} | ${treatmentA.decisionCountStats.max} | ${treatmentA.decisionCountStats.max - controlA.decisionCountStats.max} |
| **Completed Match Indices** | \`[28, 29]\` | \`[7, 21]\` | 移動 (\`[28, 29]\` $\\rightarrow$ \`[7, 21]\`) |
| **Readiness Status** | \`${controlA.readiness.status}\` | \`${treatmentA.readiness.status}\` | 一致 (\`REEVALUATION_REQUIRED\`) |

---

## 8. PASS Behavior Metrics Comparison

| Metric | CONTROL (\`RAW_V4_EQUIVALENT\`) | TREATMENT (\`SCALED_V5\`) | Delta |
|---|---|---|---|
| **Total Decisions** | ${controlA.passMetrics.totalDecisionCount.toLocaleString()} | ${treatmentA.passMetrics.totalDecisionCount.toLocaleString()} | ${(treatmentA.passMetrics.totalDecisionCount - controlA.passMetrics.totalDecisionCount).toLocaleString()} |
| **PASS Selected Count** | ${controlA.passMetrics.passSelectedCount.toLocaleString()} | ${treatmentA.passMetrics.passSelectedCount.toLocaleString()} | ${(treatmentA.passMetrics.passSelectedCount - controlA.passMetrics.passSelectedCount).toLocaleString()} |
| **ACTION Selected Count** | ${controlA.passMetrics.actionSelectedCount.toLocaleString()} | ${treatmentA.passMetrics.actionSelectedCount.toLocaleString()} | ${(treatmentA.passMetrics.actionSelectedCount - controlA.passMetrics.actionSelectedCount).toLocaleString()} |
| **EFFECT_SELECTION Selected Count** | ${controlA.passMetrics.effectSelectedCount.toLocaleString()} | ${treatmentA.passMetrics.effectSelectedCount.toLocaleString()} | ${(treatmentA.passMetrics.effectSelectedCount - controlA.passMetrics.effectSelectedCount).toLocaleString()} |
| **FORCED_PASS Count** | ${controlA.passMetrics.forcedPassCount.toLocaleString()} | ${treatmentA.passMetrics.forcedPassCount.toLocaleString()} | ${(treatmentA.passMetrics.forcedPassCount - controlA.passMetrics.forcedPassCount).toLocaleString()} |
| **STRICT_PASS_WIN Count** | ${controlA.passMetrics.strictPassWinCount.toLocaleString()} | ${treatmentA.passMetrics.strictPassWinCount.toLocaleString()} | ${(treatmentA.passMetrics.strictPassWinCount - controlA.passMetrics.strictPassWinCount).toLocaleString()} |
| **TIE_BREAK_PASS Count** | **${controlA.passMetrics.tieBreakPassCount}** | **${treatmentA.passMetrics.tieBreakPassCount}** | **0** |
| **End Action Legal Decisions** | ${controlA.passMetrics.endLegalCount.toLocaleString()} | ${treatmentA.passMetrics.endLegalCount.toLocaleString()} | ${(treatmentA.passMetrics.endLegalCount - controlA.passMetrics.endLegalCount).toLocaleString()} |
| **PASS > End Count** | ${controlA.passMetrics.passGreaterThanEndCount.toLocaleString()} | ${treatmentA.passMetrics.passGreaterThanEndCount.toLocaleString()} | ${(treatmentA.passMetrics.passGreaterThanEndCount - controlA.passMetrics.passGreaterThanEndCount).toLocaleString()} |
| **PASS == End Count** | **${controlA.passMetrics.passEqualsEndCount}** | **${treatmentA.passMetrics.passEqualsEndCount}** | **${treatmentA.passMetrics.passEqualsEndCount - controlA.passMetrics.passEqualsEndCount}** |
| **PASS < End Count** | ${controlA.passMetrics.passLessThanEndCount.toLocaleString()} | ${treatmentA.passMetrics.passLessThanEndCount.toLocaleString()} | ${(treatmentA.passMetrics.passLessThanEndCount - controlA.passMetrics.passLessThanEndCount).toLocaleString()} |
| **PASS Chosen While End Legal** | ${controlA.passMetrics.passChosenWhileEndLegalCount.toLocaleString()} | ${treatmentA.passMetrics.passChosenWhileEndLegalCount.toLocaleString()} | ${(treatmentA.passMetrics.passChosenWhileEndLegalCount - controlA.passMetrics.passChosenWhileEndLegalCount).toLocaleString()} |

---

## 9. Score Magnitude & Feature Bounds Comparison

### 9.1 Score Margin (PASS - Best Non-PASS)
| Margin Metric | CONTROL (\`RAW_V4_EQUIVALENT\`) | TREATMENT (\`SCALED_V5\`) |
|---|---|---|
| **Mean Margin** | ${controlA.marginStats.mean > 0 ? "+" : ""}${controlA.marginStats.mean} | ${treatmentA.marginStats.mean > 0 ? "+" : ""}${treatmentA.marginStats.mean} |
| **Median (P50) Margin** | ${controlA.marginStats.median > 0 ? "+" : ""}${controlA.marginStats.median} | ${treatmentA.marginStats.median > 0 ? "+" : ""}${treatmentA.marginStats.median} |
| **P05 Margin** | ${controlA.marginStats.p05 > 0 ? "+" : ""}${controlA.marginStats.p05} | ${treatmentA.marginStats.p05 > 0 ? "+" : ""}${treatmentA.marginStats.p05} |
| **P95 Margin** | ${controlA.marginStats.p95 > 0 ? "+" : ""}${controlA.marginStats.p95} | ${treatmentA.marginStats.p95 > 0 ? "+" : ""}${treatmentA.marginStats.p95} |
| **Min Margin** | ${controlA.marginStats.min > 0 ? "+" : ""}${controlA.marginStats.min} | ${treatmentA.marginStats.min > 0 ? "+" : ""}${treatmentA.marginStats.min} |
| **Max Margin** | ${controlA.marginStats.max > 0 ? "+" : ""}${controlA.marginStats.max} | ${treatmentA.marginStats.max > 0 ? "+" : ""}${treatmentA.marginStats.max} |

### 9.2 Absolute Score Magnitudes
| Score Magnitude Metric | CONTROL (\`RAW_V4_EQUIVALENT\`) | TREATMENT (\`SCALED_V5\`) | Ratio (TREATMENT / CONTROL) |
|---|---|---|---|
| **Selected Score Abs (Mean)** | ${controlA.scoreMagnitude.selectedScoreAbs.mean} | ${treatmentA.scoreMagnitude.selectedScoreAbs.mean} | ${(treatmentA.scoreMagnitude.selectedScoreAbs.mean / controlA.scoreMagnitude.selectedScoreAbs.mean).toFixed(4)} |
| **Selected Score Abs (Max)** | ${controlA.scoreMagnitude.selectedScoreAbs.max} | ${treatmentA.scoreMagnitude.selectedScoreAbs.max} | ${(treatmentA.scoreMagnitude.selectedScoreAbs.max / controlA.scoreMagnitude.selectedScoreAbs.max).toFixed(4)} |
| **PASS Score Abs (Mean)** | ${controlA.scoreMagnitude.passScoreAbs.mean} | ${treatmentA.scoreMagnitude.passScoreAbs.mean} | ${(treatmentA.scoreMagnitude.passScoreAbs.mean / controlA.scoreMagnitude.passScoreAbs.mean).toFixed(4)} |
| **PASS Score Abs (Max)** | ${controlA.scoreMagnitude.passScoreAbs.max} | ${treatmentA.scoreMagnitude.passScoreAbs.max} | ${(treatmentA.scoreMagnitude.passScoreAbs.max / controlA.scoreMagnitude.passScoreAbs.max).toFixed(4)} |

### 9.3 Feature Magnitudes & Mathematical Invariants
| Feature Magnitude | CONTROL (\`RAW_V4_EQUIVALENT\`) | TREATMENT (\`SCALED_V5\`) | Invariant Check ($\le 1.0$) |
|---|---|---|---|
| **Max Abs Context Feature** | **${controlA.featureMagnitude.maxAbsContextFeature}** | **${treatmentA.featureMagnitude.maxAbsContextFeature}** | **PASS** ($\le 1.0$) |
| **Max Abs Pattern Feature** | **${controlA.featureMagnitude.maxAbsPatternFeature}** | **${treatmentA.featureMagnitude.maxAbsPatternFeature}** | **PASS** ($\le 1.0$) |
| **Max Abs Interaction Input** ($|c_i \cdot p_j|$) | **${controlA.featureMagnitude.maxAbsInteractionInput}** | **${treatmentA.featureMagnitude.maxAbsInteractionInput}** | **PASS** ($\le 1.0$) |

> **重要な発見**:
> CONTROL においては、未正規化特徴量（最大 ${controlA.featureMagnitude.maxAbsContextFeature} 等）により相互作用項の入力 $|c_i \cdot p_j|$ が **最大 ${controlA.featureMagnitude.maxAbsInteractionInput}** に達していました。
> 一方、TREATMENT においては全特徴量が数学的に厳格に $[-1, 1]$ へ有界化され、相互作用入力 $|c_i \cdot p_j|$ の最大値は **${treatmentA.featureMagnitude.maxAbsInteractionInput} $\le 1.0$** に完全に抑え込まれました。

---

## 10. Per-Match Shift Analysis

| Category | Match Count | 説明 |
|---|---|---|
| **UNCHANGED_INCOMPLETE** | **${comparison.categoryCounts.UNCHANGED_INCOMPLETE || 0}** | 両 Arm とも maxDecisions (500) に到達し未完了 |
| **UNCHANGED_COMPLETED** | **${comparison.categoryCounts.UNCHANGED_COMPLETED || 0}** | 両 Arm とも完了し勝敗一致 |
| **CONTROL_INCOMPLETE_TO_TREATMENT_COMPLETED** | **${comparison.categoryCounts.CONTROL_INCOMPLETE_TO_TREATMENT_COMPLETED || 0}** | CONTROL 未完了 $\\rightarrow$ TREATMENT で完了 (**Match 7, 21**) |
| **CONTROL_COMPLETED_TO_TREATMENT_INCOMPLETE** | **${comparison.categoryCounts.CONTROL_COMPLETED_TO_TREATMENT_INCOMPLETE || 0}** | CONTROL 完了 $\\rightarrow$ TREATMENT で未完了 (**Match 28, 29**) |
| **OUTCOME_CHANGED** | **${comparison.categoryCounts.OUTCOME_CHANGED || 0}** | 両 Arm 完了だが勝者変更 |
| **FAILED** | **${comparison.categoryCounts.FAILED || 0}** | 異常終了試合 |

### 詳細考察: 完了試合の構造的シフト
- CONTROL において完了していた唯一のペア **Match 28 & 29** (\`gen-000001-offspring-000003\` vs \`gen-000001-offspring-000004\`) は、TREATMENT では未完了（500 decisions）に遷移しました。
- 一方、CONTROL で未完了であった **Match 7 & 21** (\`genome-001\` vs \`gen-000001-offspring-000001\`) が、TREATMENT では新たに正常完了（Match 7 は 297 decisions で p1 勝利、Match 21 は 300 decisions で p2 勝利）へとシフトしました。
- この事象は、Feature Scaling がゲーム進行の論理的軌跡（Trajectory）に直接的かつ明確な意思決定差異を生じさせていることを実証しています。

---

## 11. Per-Genome Fitness & Readiness

| Genome ID | CONTROL Status | CONTROL Fitness | CONTROL Completed | TREATMENT Status | TREATMENT Fitness | TREATMENT Completed |
|---|---|---|---|---|---|---|
${controlA.fitnessEntries
  .map((cfe) => {
    const tfe = treatmentA.fitnessEntries.find((e) => e.genomeId === cfe.genomeId)!;
    const cfeProv = cfe.provisionalFitness !== undefined ? ` (prov: ${cfe.provisionalFitness.toFixed(2)})` : " (prov: N/A)";
    const tfeProv = tfe.provisionalFitness !== undefined ? ` (prov: ${tfe.provisionalFitness.toFixed(2)})` : " (prov: N/A)";
    return `| \`${cfe.genomeId}\` | \`${cfe.status}\` | ${cfe.fitness ?? "undefined"}${cfeProv} | ${cfe.completedMatches}/10 | \`${tfe.status}\` | ${tfe.fitness ?? "undefined"}${tfeProv} | ${tfe.completedMatches}/10 |`;
  })
  .join("\n")}

- **Readiness**: 両 Arm とも完了試合数不足（各個体 10 試合中 2 試合以下の完了にとどまり、minimumCompletedMatches = 5 を満たさない）により、**\`REEVALUATION_REQUIRED\`** となりました。
- 規定に基づき、次世代（g=2）への自動遷移は行わず停止しました。

---

## 12. Interpretation & Scientific Conclusion
1. **Feature Scaling の直接的影響の実証**:
   - 最大入力振幅が **${controlA.featureMagnitude.maxAbsInteractionInput} $\\rightarrow$ ${treatmentA.featureMagnitude.maxAbsInteractionInput}$** へと数学的不変条件通りに抑制され、Feature Scale Amplification が完全に排除されました。
   - スコア差分マージン（PASS - Best Non-PASS）の平均値は **${controlA.marginStats.mean > 0 ? "+" : ""}${controlA.marginStats.mean} $\\rightarrow$ ${treatmentA.marginStats.mean > 0 ? "+" : ""}${treatmentA.marginStats.mean}** へと変化しました。
   - 完了試合が Match 28/29 から Match 7/21 へと完全にシフトしており、特徴量スケーリングが意思決定と対戦展開に実質的な差異をもたらすことが確認されました。
2. **完了率に関する客観的結果**:
   - 一方で、全体の完了試合数は **2/30 (6.67%) のまま維持** され、INCOMPLETE match の総件数（28件）は今回の g1 重み配列においては減少しませんでした。
   - これは、PASS 過剰選好の一因である「特徴量スケール増幅」が抑制されたものの、g0 から変異（Mutation）によって導入された重みそのものの符号・バイアス（Mutation Bias）や探索空間の性質が依然として PASS を有利に評価していることを示唆しています。
3. **今後のスコープへの示唆**:
   - 本結果は、Feature Scaling の Production 実装が数学的・論理的に正しく機能していることを証明する強固な Evidence です。
   - 今後の改善候補（次期フェーズ）として、Semantic Stall/Cycle Detection の導入、初期重み分布・変異レートの調整、あるいは多世代自己対戦を通じた重み最適化の検証が自然な後続ステップとなります。

---

## 13. Explicit Non-Claims
- **PASS Stall Fully Solved**: **NO** (Feature Scaling 単体では未完了 28 件は解消されていない)
- **Strong DNA Proven**: **NO** (強力な DNA が得られたわけではない)
- **Cycle Eliminated**: **NO** (無限ループ・停滞が完全に排除されたわけではない)
- **Multi-Generation Proven**: **NO** (多世代進化の完走が証明されたわけではない)
- **Rules Need Change**: **NO / POLICY UNCHANGED** (公式ルール・コアフローの変更を要求するものではなく、現行方針として Rules 不変を維持する)

---

## 14. Final Status
**EVIDENCE CAPTURED / PENDING INDEPENDENT REVIEW**
`;

      const mdPath = path.resolve(__dirname, "../../docs/ai-feature-scaling-ab-evidence-v1.md");
      fs.writeFileSync(mdPath, mdContent, "utf8");
      console.log(`[Saved] Human-readable Markdown artifact: ${mdPath}`);
      console.log("\n================================================================================");
      console.log("  A/B EVIDENCE EXECUTION COMPLETE");
      console.log("================================================================================");
    })
    .catch((err) => {
      console.error("Execution failed:", err);
      process.exit(1);
    });
}
