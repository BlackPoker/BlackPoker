import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { fileURLToPath } from "url";
import { EvolutionLoop } from "../engine/ai/EvolutionLoop";
import {
  EvolutionLoopConfig,
  RunEvolutionLoopParams,
  canonicalGenerationStreamKey,
} from "../domain/ai/EvolutionLoopTypes";
import { GenerationRunner } from "../engine/ai/GenerationRunner";
import { DecisionDNACodec } from "../engine/ai/DecisionDNACodec";
import { DecisionDNA } from "../domain/ai/DecisionDNATypes";
import { GenerationRunnerEnvironmentContext } from "../domain/ai/GenerationRunnerTypes";
import { PopulationSnapshot } from "../domain/ai/PopulationSelectionTypes";
import { OfficialRegulationMatchFactory } from "../engine/regulation/OfficialRegulationMatchFactory";
import { loadRegulationCatalog } from "../engine/regulation/RegulationLoader";
import { RegulationValidator } from "../engine/regulation/RegulationValidator";
import { RegulationRulePackageSelector } from "../engine/regulation/RegulationRulePackageSelector";
import { loadRulePackageFromDirectory } from "../engine/rules/RuleLoader";
import { deriveSeed } from "../engine/random/DeterministicShuffle";
import { GenomePolicy } from "../engine/ai/GenomePolicy";
import { SimulationRunner, SimulationResult } from "../engine/simulation/SimulationRunner";
import { DecisionRequest } from "../domain/decision/DecisionRequest";
import { DecisionFeatureEncoder } from "../engine/ai/DecisionFeatureEncoder";
import { GenomeScorer, ScoredPattern } from "../engine/ai/GenomeScorer";
import {
  CONTEXT_FEATURE_NAMES,
  PATTERN_FEATURE_NAMES,
} from "../domain/ai/DecisionFeatureTypes";
import {
  DNA_CONTEXT_DIMENSION,
  DNA_PATTERN_DIMENSION,
  DNA_INTERACTION_DIMENSION,
  DNA_TOTAL_WEIGHTS,
} from "../domain/ai/DecisionDNATypes";
import { BatchMatchContext } from "../domain/simulation/BatchSimulationTypes";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function assertAnalysis(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ANALYSIS_ASSERTION_FAILED: ${message}`);
  }
}

// -----------------------------------------------------------------------------
// Behavioral DNA Digest & Inventory
// -----------------------------------------------------------------------------

export function computeBehavioralDnaDigest(dna: DecisionDNA): string {
  const behavioralTarget = {
    dnaFormatVersion: dna.dnaFormatVersion,
    featureSchemaVersion: dna.featureSchemaVersion,
    scoringModel: dna.scoringModel,
    contextDimension: dna.contextDimension,
    patternDimension: dna.patternDimension,
    patternWeights: dna.patternWeights,
    contextPatternWeights: dna.contextPatternWeights,
  };
  return crypto.createHash("sha256").update(JSON.stringify(behavioralTarget)).digest("hex");
}

export interface DnaGeneCoordinate {
  id: string;
  coordinate: string;
  type: "PATTERN" | "INTERACTION";
  index?: number;
  flatIndex?: number;
  contextIndex?: number;
  patternIndex: number;
  contextFeatureName?: string;
  patternFeatureName: string;
  weight: number;
}

export interface BehavioralDnaRecord {
  genomeId: string;
  behavioralDnaDigest: string;
  isZeroDNA: boolean;
  totalWeights: number;
  nonZeroCount: number;
  nonZeroPatternCount: number;
  nonZeroInteractionCount: number;
  minWeight: number;
  maxWeight: number;
  meanAbsNonZeroWeight: number;
  genes: DnaGeneCoordinate[];
}

function extractBehavioralDnaRecord(dna: DecisionDNA, genomeId: string): BehavioralDnaRecord {
  const pWeights = dna.patternWeights ?? [];
  const cpWeights = dna.contextPatternWeights ?? [];

  const genes: DnaGeneCoordinate[] = [];
  let nonZeroPattern = 0;
  let nonZeroInteraction = 0;
  const nonZeroWeights: number[] = [];

  // 1. Pattern linear weights
  for (let j = 0; j < pWeights.length; j++) {
    const w = pWeights[j];
    if (w !== 0) {
      nonZeroPattern++;
      nonZeroWeights.push(w);
      genes.push({
        id: `P[${j}]:${PATTERN_FEATURE_NAMES[j]}`,
        coordinate: `P[${j}]`,
        type: "PATTERN",
        index: j,
        patternIndex: j,
        patternFeatureName: PATTERN_FEATURE_NAMES[j],
        weight: w,
      });
    }
  }

  // 2. Context-Pattern interaction weights
  for (let k = 0; k < cpWeights.length; k++) {
    const w = cpWeights[k];
    if (w !== 0) {
      nonZeroInteraction++;
      nonZeroWeights.push(w);
      const cIdx = Math.floor(k / DNA_PATTERN_DIMENSION);
      const pIdx = k % DNA_PATTERN_DIMENSION;
      genes.push({
        id: `I[${cIdx},${pIdx}]:${CONTEXT_FEATURE_NAMES[cIdx]}x${PATTERN_FEATURE_NAMES[pIdx]}`,
        coordinate: `I[${cIdx},${pIdx}]`,
        type: "INTERACTION",
        flatIndex: k,
        contextIndex: cIdx,
        patternIndex: pIdx,
        contextFeatureName: CONTEXT_FEATURE_NAMES[cIdx],
        patternFeatureName: PATTERN_FEATURE_NAMES[pIdx],
        weight: w,
      });
    }
  }

  const minWeight = nonZeroWeights.length > 0 ? Math.min(...nonZeroWeights) : 0;
  const maxWeight = nonZeroWeights.length > 0 ? Math.max(...nonZeroWeights) : 0;
  const meanAbsNonZeroWeight =
    nonZeroWeights.length > 0
      ? nonZeroWeights.reduce((acc, w) => acc + Math.abs(w), 0) / nonZeroWeights.length
      : 0;

  return {
    genomeId,
    behavioralDnaDigest: computeBehavioralDnaDigest(dna),
    isZeroDNA: genes.length === 0,
    totalWeights: pWeights.length + cpWeights.length,
    nonZeroCount: genes.length,
    nonZeroPatternCount: nonZeroPattern,
    nonZeroInteractionCount: nonZeroInteraction,
    minWeight,
    maxWeight,
    meanAbsNonZeroWeight,
    genes,
  };
}

// -----------------------------------------------------------------------------
// Score Delta Decomposition Types & Logic (with Exact Mathematical Identity)
// -----------------------------------------------------------------------------

export interface GeneDeltaContribution {
  geneId: string;
  coordinate: string;
  type: "PATTERN" | "INTERACTION";
  weight: number;
  contextIndex?: number;
  patternIndex: number;
  contextFeatureName?: string;
  patternFeatureName: string;
  contextValue: number;
  patternDiff: number; // p_A - p_B
  termA: number;
  termB: number;
  deltaContrib: number; // termA - termB
  positivePassUplift: number; // max(termA, 0)
  positiveAlternativeSuppression: number; // max(-termB, 0)
  counteractingPassPenalty: number; // max(-termA, 0)
  counteractingAlternativeUplift: number; // max(termB, 0)
}

export interface ScoreDeltaDecompositionResult {
  scoreA: number;
  scoreB: number;
  deltaScore: number;
  contributions: GeneDeltaContribution[];
  conservationVerified: boolean;
  conservationMaxDiff: number;
  totalPositivePassUplift: number;
  totalPositiveAlternativeSuppression: number;
  totalCounteractingPassPenalty: number;
  totalCounteractingAlternativeUplift: number;
}

function decomposeScoreDelta(
  contextValues: readonly number[],
  patternValuesA: readonly number[],
  patternValuesB: readonly number[],
  dna: DecisionDNA
): ScoreDeltaDecompositionResult {
  const pWeights = dna.patternWeights;
  const cpWeights = dna.contextPatternWeights;
  const pDim = dna.patternDimension;
  const cDim = dna.contextDimension;

  const contributions: GeneDeltaContribution[] = [];
  let totalContribSum = 0;
  let totalPositivePassUplift = 0;
  let totalPositiveAlternativeSuppression = 0;
  let totalCounteractingPassPenalty = 0;
  let totalCounteractingAlternativeUplift = 0;

  // 1. Pattern Linear Weights
  for (let j = 0; j < pDim; j++) {
    const w = pWeights[j] ?? 0;
    if (w === 0) continue;

    const pA = patternValuesA[j] ?? 0;
    const pB = patternValuesB[j] ?? 0;
    const diff = pA - pB;
    if (diff === 0) continue;

    const termA = w * pA;
    const termB = w * pB;
    const contrib = termA - termB;
    totalContribSum += contrib;

    const positivePassUplift = Math.max(termA, 0);
    const positiveAlternativeSuppression = Math.max(-termB, 0);
    const counteractingPassPenalty = Math.max(-termA, 0);
    const counteractingAlternativeUplift = Math.max(termB, 0);

    // Exact identity assert
    const identityCheck =
      positivePassUplift +
      positiveAlternativeSuppression -
      counteractingPassPenalty -
      counteractingAlternativeUplift;
    assertAnalysis(
      Math.abs(contrib - identityCheck) < 1e-12,
      `Exact identity violated for linear gene P[${j}]`
    );

    totalPositivePassUplift += positivePassUplift;
    totalPositiveAlternativeSuppression += positiveAlternativeSuppression;
    totalCounteractingPassPenalty += counteractingPassPenalty;
    totalCounteractingAlternativeUplift += counteractingAlternativeUplift;

    contributions.push({
      geneId: `P[${j}]:${PATTERN_FEATURE_NAMES[j]}`,
      coordinate: `P[${j}]`,
      type: "PATTERN",
      weight: w,
      patternIndex: j,
      patternFeatureName: PATTERN_FEATURE_NAMES[j],
      contextValue: 1,
      patternDiff: diff,
      termA,
      termB,
      deltaContrib: contrib,
      positivePassUplift,
      positiveAlternativeSuppression,
      counteractingPassPenalty,
      counteractingAlternativeUplift,
    });
  }

  // 2. Context-Pattern Interaction Weights
  for (let i = 0; i < cDim; i++) {
    const cVal = contextValues[i] ?? 0;
    if (cVal === 0) continue;

    const rowOffset = i * pDim;
    for (let j = 0; j < pDim; j++) {
      const mVal = cpWeights[rowOffset + j] ?? 0;
      if (mVal === 0) continue;

      const pA = patternValuesA[j] ?? 0;
      const pB = patternValuesB[j] ?? 0;
      const diff = pA - pB;
      if (diff === 0) continue;

      const termA = mVal * cVal * pA;
      const termB = mVal * cVal * pB;
      const contrib = termA - termB;
      totalContribSum += contrib;

      const positivePassUplift = Math.max(termA, 0);
      const positiveAlternativeSuppression = Math.max(-termB, 0);
      const counteractingPassPenalty = Math.max(-termA, 0);
      const counteractingAlternativeUplift = Math.max(termB, 0);

      // Exact identity assert
      const identityCheck =
        positivePassUplift +
        positiveAlternativeSuppression -
        counteractingPassPenalty -
        counteractingAlternativeUplift;
      assertAnalysis(
        Math.abs(contrib - identityCheck) < 1e-12,
        `Exact identity violated for interaction gene I[${i},${j}]`
      );

      totalPositivePassUplift += positivePassUplift;
      totalPositiveAlternativeSuppression += positiveAlternativeSuppression;
      totalCounteractingPassPenalty += counteractingPassPenalty;
      totalCounteractingAlternativeUplift += counteractingAlternativeUplift;

      contributions.push({
        geneId: `I[${i},${j}]:${CONTEXT_FEATURE_NAMES[i]}x${PATTERN_FEATURE_NAMES[j]}`,
        coordinate: `I[${i},${j}]`,
        type: "INTERACTION",
        weight: mVal,
        contextIndex: i,
        patternIndex: j,
        contextFeatureName: CONTEXT_FEATURE_NAMES[i],
        patternFeatureName: PATTERN_FEATURE_NAMES[j],
        contextValue: cVal,
        patternDiff: diff,
        termA,
        termB,
        deltaContrib: contrib,
        positivePassUplift,
        positiveAlternativeSuppression,
        counteractingPassPenalty,
        counteractingAlternativeUplift,
      });
    }
  }

  // Calculate full scores for A and B directly
  let scoreA = 0;
  let scoreB = 0;
  for (let j = 0; j < pDim; j++) {
    scoreA += (pWeights[j] ?? 0) * (patternValuesA[j] ?? 0);
    scoreB += (pWeights[j] ?? 0) * (patternValuesB[j] ?? 0);
  }
  for (let i = 0; i < cDim; i++) {
    const cVal = contextValues[i] ?? 0;
    if (cVal === 0) continue;
    const rowOffset = i * pDim;
    for (let j = 0; j < pDim; j++) {
      const mVal = cpWeights[rowOffset + j] ?? 0;
      if (mVal === 0) continue;
      scoreA += mVal * cVal * (patternValuesA[j] ?? 0);
      scoreB += mVal * cVal * (patternValuesB[j] ?? 0);
    }
  }

  const deltaScore = scoreA - scoreB;
  const conservationDiff = Math.abs(totalContribSum - deltaScore);
  const conservationVerified = conservationDiff < 1e-6;

  // Sort contributions descending by deltaContrib
  contributions.sort((a, b) => b.deltaContrib - a.deltaContrib);

  return {
    scoreA,
    scoreB,
    deltaScore,
    contributions,
    conservationVerified,
    conservationMaxDiff: conservationDiff,
    totalPositivePassUplift,
    totalPositiveAlternativeSuppression,
    totalCounteractingPassPenalty,
    totalCounteractingAlternativeUplift,
  };
}

// -----------------------------------------------------------------------------
// Score Sign Quadrants (Neutral, Descriptive)
// -----------------------------------------------------------------------------

export type ScoreSignQuadrant =
  | "PASS_POS_ALT_NONPOS"
  | "PASS_NONPOS_ALT_NEG"
  | "BOTH_POS"
  | "BOTH_NEG"
  | "OTHER";

export function classifyScoreSignQuadrant(passScore: number, altScore: number): ScoreSignQuadrant {
  if (passScore > 0 && altScore <= 0) return "PASS_POS_ALT_NONPOS";
  if (passScore <= 0 && altScore < 0) return "PASS_NONPOS_ALT_NEG";
  if (passScore > 0 && altScore > 0) return "BOTH_POS";
  if (passScore < 0 && altScore < 0) return "BOTH_NEG";
  return "OTHER";
}

// -----------------------------------------------------------------------------
// Per-Genome Contributor Record
// -----------------------------------------------------------------------------

export interface PerGenomeContributorRecord {
  genomeId: string;
  geneId: string;
  coordinate: string;
  type: "PATTERN" | "INTERACTION";
  weight: number;
  contextIndex?: number;
  patternIndex: number;
  contextFeatureName?: string;
  patternFeatureName: string;
  cumulativeDelta: number;
  decisionCoverage: number;
  meanDelta: number;
  maxDelta: number;
  passTermSum: number;
  alternativeTermSum: number;
  positivePassUpliftSum: number;
  positiveAlternativeSuppressionSum: number;
  counteractingPassPenaltySum: number;
  counteractingAlternativeUpliftSum: number;
}

export interface CrossGenomeCoordinateAggregate {
  geneId: string;
  coordinate: string;
  type: "PATTERN" | "INTERACTION";
  contextFeatureName?: string;
  patternFeatureName: string;
  contributingGenomeCount: number;
  contributingGenomeIds: string[];
  weightByGenome: Record<string, number>;
  weightMin: number;
  weightMax: number;
  weightMean: number;
  cumulativeDeltaAllGenomes: number;
  decisionCoverageAllGenomes: number;
  meanDeltaAllGenomes: number;
  maxDeltaAllGenomes: number;
}

// -----------------------------------------------------------------------------
// Decision Analysis Record
// -----------------------------------------------------------------------------

export interface DecisionAnalysisRecord {
  matchIndex: number;
  pairIndex: number;
  legIndex: number;
  stepCount: number;
  playerId: string;
  genomeId: string;
  isElite: boolean;
  legalPatternCount: number;
  selectedPatternRef: number;
  selectedKind: string;
  selectedActionId?: string;
  isPassChosen: boolean;

  // PASS classification
  passCategory?: "FORCED_PASS" | "STRICT_PASS_WIN" | "TIE_BREAK_PASS";
  passScore?: number;

  // action.end comparison
  hasEndAction: boolean;
  endPatternRef?: number;
  endScore?: number;
  marginEnd?: number;
  endQuadrant?: ScoreSignQuadrant;

  // bestNonPass comparison
  hasNonPass: boolean;
  bestNonPassPatternRef?: number;
  bestNonPassKind?: string;
  bestNonPassActionId?: string;
  bestNonPassScore?: number;
  marginBestNonPass?: number;
  bestNonPassQuadrant?: ScoreSignQuadrant;

  // Context features sample
  contextValues: {
    turnCount: number;
    stageDepth: number;
    selfIsTurnPlayer: number;
    sourceIsActionRequest: number;
    legalPatternCount: number;
    legalActionTimingQuickCount: number;
    legalNonPassPatternCount: number;
    selfHandValueSum: number;
    selfHandCount: number;
    selfLifeCount: number;
  };
}

// -----------------------------------------------------------------------------
// Ablation Types
// -----------------------------------------------------------------------------

export interface LocalAblationResult {
  genomeId: string;
  matchIndex: number;
  stallingPassDecisionCount: number;
  top1Genes: Array<{ geneId: string; coordinate: string; weight: number }>;
  top3Genes: Array<{ geneId: string; coordinate: string; weight: number }>;
  top5Genes: Array<{ geneId: string; coordinate: string; weight: number }>;
  flipsTop1: number;
  flipsTop1Ratio: number;
  flipsTop3: number;
  flipsTop3Ratio: number;
  flipsTop5: number;
  flipsTop5Ratio: number;
  flippedActionDistributionTop1: Record<string, number>;
  flippedActionDistributionTop3: Record<string, number>;
  flippedActionDistributionTop5: Record<string, number>;
}

export interface TrajectoryAblationResult {
  genomeId: string;
  matchIndex: number;
  ablationLevel: "BASELINE_TOP0" | "TOP1_ZEROED" | "TOP3_ZEROED" | "TOP5_ZEROED";
  ablatedGenes: Array<{ geneId: string; coordinate: string; weight: number }>;
  completed: boolean;
  totalDecisions: number;
  turnCount: number;
  escapedTurn1: boolean;
  winner?: string;
  reason?: string;
  offspringPassCount: number;
  offspringNonPassCount: number;
  offspringPassRatio: number;
}

// -----------------------------------------------------------------------------
// Helper: Create Ablated DNA
// -----------------------------------------------------------------------------

function createAblatedDna(dna: DecisionDNA, genesToZero: Array<{ type: string; index?: number; flatIndex?: number }>): DecisionDNA {
  const newPWeights = [...dna.patternWeights];
  const newCPWeights = [...dna.contextPatternWeights];

  for (const g of genesToZero) {
    if (g.type === "PATTERN" && g.index !== undefined) {
      newPWeights[g.index] = 0;
    } else if (g.type === "INTERACTION" && g.flatIndex !== undefined) {
      newCPWeights[g.flatIndex] = 0;
    }
  }

  const ablated: DecisionDNA = {
    dnaFormatVersion: dna.dnaFormatVersion,
    featureSchemaVersion: dna.featureSchemaVersion,
    scoringModel: dna.scoringModel,
    contextDimension: dna.contextDimension,
    patternDimension: dna.patternDimension,
    patternWeights: Object.freeze(newPWeights),
    contextPatternWeights: Object.freeze(newCPWeights),
    metadata: {
      ...dna.metadata,
      name: `${dna.metadata?.name ?? "Genome"}-ablated`,
    },
  };

  DecisionDNACodec.validate(ablated);
  return ablated;
}

// -----------------------------------------------------------------------------
// Main Analysis Runner
// -----------------------------------------------------------------------------

async function runPassScoreAnalysisR1() {
  const startTime = Date.now();
  console.log("================================================================================");
  console.log("  BLACKPOKER SIMULATOR - DECISION DNA PASS SCORE ROOT CAUSE ANALYSIS V1-R1");
  console.log("  Work ID: BP-SIM-AI-DNA-PASS-SCORE-ANALYSIS-V1-R1");
  console.log("================================================================================");

  // 1. 環境とルールの初期化
  console.log("\n[1/8] Loading Official Regulation Catalog & Rules...");
  const catalog = await loadRegulationCatalog();
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

  // 2. カノニカルレシピ & シードスケジュール
  const CAMPAIGN_SEED = 42;
  const STREAM_KEY_G0 = canonicalGenerationStreamKey(0);
  const STREAM_KEY_G1 = canonicalGenerationStreamKey(1);
  const SEED_G0 = deriveSeed(CAMPAIGN_SEED, STREAM_KEY_G0);
  const SEED_G1 = deriveSeed(CAMPAIGN_SEED, STREAM_KEY_G1);

  assertAnalysis(STREAM_KEY_G0 === "evolution-loop-generation-v1-0", `g0 stream key mismatch: ${STREAM_KEY_G0}`);
  assertAnalysis(STREAM_KEY_G1 === "evolution-loop-generation-v1-1", `g1 stream key mismatch: ${STREAM_KEY_G1}`);
  assertAnalysis(SEED_G0 === 4143575905, `g0 seed mismatch: ${SEED_G0}`);
  assertAnalysis(SEED_G1 === 4126798286, `g1 seed mismatch: ${SEED_G1}`);

  console.log(`  - Recipe: regulation=light-entry16, N=6, campaignSeed=${CAMPAIGN_SEED}`);
  console.log(`  - Stream Keys: g0=${STREAM_KEY_G0} (seed=${SEED_G0}), g1=${STREAM_KEY_G1} (seed=${SEED_G1})`);

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

  // 3. Double Reconstruction Inside R1 (Section 17, 18, 19)
  console.log("\n[2/8] Executing Double Reconstruction (Reconstruction A & B)...");

  console.log("  -> Running Reconstruction A...");
  const resultA = EvolutionLoop.run({
    initialPopulation: makeFreshInitialPop(),
    campaignSeed: CAMPAIGN_SEED,
    environment,
    sessionFactory,
    config: loopConfig,
  });

  console.log("  -> Running Reconstruction B...");
  const resultB = EvolutionLoop.run({
    initialPopulation: makeFreshInitialPop(),
    campaignSeed: CAMPAIGN_SEED,
    environment,
    sessionFactory,
    config: loopConfig,
  });

  assertAnalysis(resultA.logicalResult.status === "COMPLETED", "Reconstruction A must be COMPLETED");
  assertAnalysis(resultB.logicalResult.status === "COMPLETED", "Reconstruction B must be COMPLETED");
  assertAnalysis(resultA.logicalResult.completedTransitions === 1, "A completedTransitions must be 1");
  assertAnalysis(resultB.logicalResult.completedTransitions === 1, "B completedTransitions must be 1");

  const popA = resultA.logicalResult.finalPopulation;
  const popB = resultB.logicalResult.finalPopulation;

  assertAnalysis(popA.entries.length === 6, "popA entries length must be 6");
  assertAnalysis(popB.entries.length === 6, "popB entries length must be 6");

  // Verify ID sets and exact weights
  const idsA = popA.entries.map((e) => e.genomeId);
  const idsB = popB.entries.map((e) => e.genomeId);
  assertAnalysis(JSON.stringify(idsA) === JSON.stringify(idsB), "Genome ID sets must be identical between A and B");

  const digestsA: Record<string, string> = {};
  const digestsB: Record<string, string> = {};

  for (let i = 0; i < popA.entries.length; i++) {
    const entryA = popA.entries[i];
    const entryB = popB.entries[i];
    const dnaA = entryA.dna as DecisionDNA;
    const dnaB = entryB.dna as DecisionDNA;

    const digestA = computeBehavioralDnaDigest(dnaA);
    const digestB = computeBehavioralDnaDigest(dnaB);
    digestsA[entryA.genomeId] = digestA;
    digestsB[entryB.genomeId] = digestB;

    assertAnalysis(digestA === digestB, `Behavioral digest mismatch for ${entryA.genomeId}`);
    assertAnalysis(
      dnaA.patternWeights.length === dnaB.patternWeights.length &&
        dnaA.patternWeights.every((w, idx) => w === dnaB.patternWeights[idx]),
      `patternWeights mismatch for ${entryA.genomeId}`
    );
    assertAnalysis(
      dnaA.contextPatternWeights.length === dnaB.contextPatternWeights.length &&
        dnaA.contextPatternWeights.every((w, idx) => w === dnaB.contextPatternWeights[idx]),
      `contextPatternWeights mismatch for ${entryA.genomeId}`
    );
  }

  // Logical result deep equality (excluding runtime metrics)
  const logicalAJson = JSON.stringify(resultA.logicalResult);
  const logicalBJson = JSON.stringify(resultB.logicalResult);
  assertAnalysis(logicalAJson === logicalBJson, "Logical results of A and B must be strictly Deep Equal");
  console.log("  -> Double Reconstruction Determinism Gate: PASSED (Digests, Weights, Logical Deep Equal verified)");

  // 4. Per-Genome Behavioral DNA Digest & Inventory
  console.log("\n[3/8] Compiling Canonical Behavioral DNA Digests & Inventory...");
  const behavioralRecords: BehavioralDnaRecord[] = [];
  const dnaMap = new Map<string, DecisionDNA>();
  const inventoryMap = new Map<string, BehavioralDnaRecord>();

  for (const entry of popA.entries) {
    const dna = entry.dna as DecisionDNA;
    dnaMap.set(entry.genomeId, dna);
    const rec = extractBehavioralDnaRecord(dna, entry.genomeId);
    behavioralRecords.push(rec);
    inventoryMap.set(entry.genomeId, rec);
    console.log(
      `  - ${entry.genomeId.padEnd(28)} | nonZero=${String(rec.nonZeroCount).padStart(3)}/${rec.totalWeights} | digest=${rec.behavioralDnaDigest.slice(0, 16)}... | weightRange=[${rec.minWeight.toFixed(4)}, ${rec.maxWeight.toFixed(4)}]`
    );
  }

  // Compare against historical V1 JSON
  let v1JsonComparison: {
    matched: boolean;
    v1NonZeroCounts: Record<string, number>;
    r1NonZeroCounts: Record<string, number>;
    note: string;
  } = {
    matched: true,
    v1NonZeroCounts: {
      "genome-001": 0,
      "gen-000001-offspring-000000": 250,
      "gen-000001-offspring-000001": 216,
      "gen-000001-offspring-000002": 240,
      "gen-000001-offspring-000003": 244,
      "gen-000001-offspring-000004": 211,
    },
    r1NonZeroCounts: {},
    note: "V1 JSON lacked full DNA digest; count comparison only.",
  };

  for (const rec of behavioralRecords) {
    v1JsonComparison.r1NonZeroCounts[rec.genomeId] = rec.nonZeroCount;
    const expected = v1JsonComparison.v1NonZeroCounts[rec.genomeId];
    assertAnalysis(
      expected !== undefined && expected === rec.nonZeroCount,
      `V1 JSON count mismatch for ${rec.genomeId}: expected ${expected}, got ${rec.nonZeroCount}`
    );
  }
  console.log("  -> V1 JSON Non-Zero Count Comparison: PASSED (Exact match with V1 JSON: 250, 216, 240, 244, 211)");

  const historicalIncompleteCounts = {
    "gen-000001-offspring-000000": 238,
    "gen-000001-offspring-000001": 241,
    "gen-000001-offspring-000002": 236,
    "gen-000001-offspring-000003": 241,
    "gen-000001-offspring-000004": 234,
  };

  // 5. Run All 30 Matches & Decompose Decision Scores
  console.log("\n[4/8] Running All 30 Matches & Performing Full Score Decomposition...");
  const schedule = GenerationRunner.planSchedule(popA, SEED_G1, 1);
  assertAnalysis(schedule.length === 30, `Expected 30 matches, got ${schedule.length}`);

  const allDecisionRecords: DecisionAnalysisRecord[] = [];
  const incompleteMatchIndices: number[] = [];
  const completedMatchIndices: number[] = [];
  const matchResults: SimulationResult[] = [];

  // Recorded requests for Local Ablation: matchIndex -> array
  const recordedMatchRequests = new Map<
    number,
    Array<{
      stepCount: number;
      playerId: string;
      genomeId: string;
      request: DecisionRequest;
      selectedPatternRef: number;
      isPassChosen: boolean;
      hasNonPass: boolean;
    }>
  >();

  // Context Feature Range Tracking
  const contextFeatureStats = new Map<
    number,
    { name: string; min: number; max: number; sum: number; count: number; absMax: number }
  >();
  for (let cIdx = 0; cIdx < DNA_CONTEXT_DIMENSION; cIdx++) {
    contextFeatureStats.set(cIdx, {
      name: CONTEXT_FEATURE_NAMES[cIdx],
      min: Infinity,
      max: -Infinity,
      sum: 0,
      count: 0,
      absMax: 0,
    });
  }

  // Authoritative Per-Genome Contributor Map (NO TOP-5 TRUNCATION!)
  // Key: `${genomeId}|${geneId}`
  const perGenomeContributorMap = new Map<string, PerGenomeContributorRecord>();

  // Global mechanism mass accumulators
  let globalPositivePassUpliftMass = 0;
  let globalPositiveAlternativeSuppressionMass = 0;
  let globalCounteractingPassPenaltyMass = 0;
  let globalCounteractingAlternativeUpliftMass = 0;

  // Global mechanism mass for PASS vs End
  let endPositivePassUpliftMass = 0;
  let endPositiveAlternativeSuppressionMass = 0;
  let endCounteractingPassPenaltyMass = 0;
  let endCounteractingAlternativeUpliftMass = 0;

  let maxObservedConservationError = 0;

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

    const matchId = `gen-1-match-${String(match.matchIndex).padStart(6, "0")}-${match.p1GenomeId}-vs-${match.p2GenomeId}`;
    const p1Seed = deriveSeed(match.matchSeed, "p1");
    const p2Seed = deriveSeed(match.matchSeed, "p2");

    const matchContext: BatchMatchContext = {
      matchIndex: match.matchIndex,
      matchId,
      baseSeed: SEED_G1,
      matchSeed: match.matchSeed,
      playerSeeds: { p1: p1Seed, p2: p2Seed },
    };

    const session = sessionFactory(matchContext);

    let stepCount = 0;
    const recordedRequestsForThisMatch: Array<{
      stepCount: number;
      playerId: string;
      genomeId: string;
      request: DecisionRequest;
      selectedPatternRef: number;
      isPassChosen: boolean;
      hasNonPass: boolean;
    }> = [];

    const simResult = SimulationRunner.run(session, policies, {
      maxDecisions: 500,
      onStep: ({ decisionPlayer, request, record }) => {
        stepCount++;
        const currentGenomeId = decisionPlayer === "p1" ? p1GenomeId : p2GenomeId;
        const currentDna = decisionPlayer === "p1" ? p1Dna : p2Dna;
        const isElite = currentGenomeId === "genome-001";

        // Selection Consistency Assertion (Section 24)
        const encodedFeatures = DecisionFeatureEncoder.encode(request);
        const scoredPatterns = GenomeScorer.score(encodedFeatures, currentDna);
        scoredPatterns.sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return a.patternRef - b.patternRef;
        });
        assertAnalysis(
          record.selectedPatternRef === scoredPatterns[0].patternRef,
          `Selection mismatch at match ${mIdx} step ${stepCount}: record=${record.selectedPatternRef}, scorer=${scoredPatterns[0].patternRef}`
        );

        // Track Context Feature ranges across all decisions
        for (let cIdx = 0; cIdx < DNA_CONTEXT_DIMENSION; cIdx++) {
          const val = encodedFeatures.context.values[cIdx] ?? 0;
          const stat = contextFeatureStats.get(cIdx)!;
          if (val < stat.min) stat.min = val;
          if (val > stat.max) stat.max = val;
          if (Math.abs(val) > stat.absMax) stat.absMax = Math.abs(val);
          stat.sum += val;
          stat.count++;
        }

        const isPassChosen = record.selectedPatternKind === "PASS";
        const passIndex = request.patterns.findIndex((p) => p.kind === "PASS");
        const hasPass = passIndex >= 0;
        const passScore = hasPass ? scoredPatterns.find((sp) => sp.patternRef === passIndex)?.score : undefined;

        // action.end pattern identification
        const endIndex = request.patterns.findIndex(
          (p) =>
            p.kind === "ACTION" &&
            p.actionSelectionRef !== undefined &&
            request.catalog?.actions?.[p.actionSelectionRef]?.actionId === "action.end"
        );
        const hasEndAction = endIndex >= 0;
        const endScore = hasEndAction
          ? scoredPatterns.find((sp) => sp.patternRef === endIndex)?.score
          : undefined;

        // bestNonPass pattern identification
        const nonPassScored = scoredPatterns.filter((sp) => sp.kind !== "PASS");
        const hasNonPass = nonPassScored.length > 0;
        let bestNonPass: ScoredPattern | undefined;
        let bestNonPassActionId: string | undefined;

        if (hasNonPass) {
          let maxNonPassScore = -Infinity;
          for (const sp of nonPassScored) {
            if (sp.score > maxNonPassScore) {
              maxNonPassScore = sp.score;
              bestNonPass = sp;
            }
          }
          if (bestNonPass) {
            const patObj = request.patterns[bestNonPass.patternRef];
            if (patObj?.actionSelectionRef !== undefined) {
              bestNonPassActionId = request.catalog?.actions?.[patObj.actionSelectionRef]?.actionId;
            }
          }
        }

        // Record request for Local Ablation
        recordedRequestsForThisMatch.push({
          stepCount,
          playerId: decisionPlayer,
          genomeId: currentGenomeId,
          request,
          selectedPatternRef: record.selectedPatternRef,
          isPassChosen,
          hasNonPass,
        });

        // Exact PASS category classification (Section 25)
        let passCategory: "FORCED_PASS" | "STRICT_PASS_WIN" | "TIE_BREAK_PASS" | undefined;
        if (isPassChosen) {
          if (!hasNonPass) {
            passCategory = "FORCED_PASS";
          } else if (bestNonPass && passScore !== undefined) {
            if (passScore > bestNonPass.score) {
              passCategory = "STRICT_PASS_WIN";
            } else if (passScore === bestNonPass.score) {
              passCategory = "TIE_BREAK_PASS";
            }
          }
        }

        // Decompose PASS vs bestNonPass
        let marginBestNonPass: number | undefined;
        let bestNonPassQuadrant: ScoreSignQuadrant | undefined;

        if (hasPass && bestNonPass && passScore !== undefined) {
          marginBestNonPass = passScore - bestNonPass.score;
          bestNonPassQuadrant = classifyScoreSignQuadrant(passScore, bestNonPass.score);

          if (!isElite && currentDna.patternWeights.length > 0) {
            const decomp = decomposeScoreDelta(
              encodedFeatures.context.values,
              encodedFeatures.patterns[passIndex].values,
              encodedFeatures.patterns[bestNonPass.patternRef].values,
              currentDna
            );
            assertAnalysis(decomp.conservationVerified, "Conservation violated in pass vs bestNonPass");
            if (decomp.conservationMaxDiff > maxObservedConservationError) {
              maxObservedConservationError = decomp.conservationMaxDiff;
            }

            // Accumulate global mechanism masses
            globalPositivePassUpliftMass += decomp.totalPositivePassUplift;
            globalPositiveAlternativeSuppressionMass += decomp.totalPositiveAlternativeSuppression;
            globalCounteractingPassPenaltyMass += decomp.totalCounteractingPassPenalty;
            globalCounteractingAlternativeUpliftMass += decomp.totalCounteractingAlternativeUplift;

            // Authoritative Per-Genome Contributor Tracking (FULL contributions, Section 28 & 30)
            for (const c of decomp.contributions) {
              if (c.deltaContrib <= 0) continue;
              const key = `${currentGenomeId}|${c.geneId}`;
              let existing = perGenomeContributorMap.get(key);
              if (!existing) {
                existing = {
                  genomeId: currentGenomeId,
                  geneId: c.geneId,
                  coordinate: c.coordinate,
                  type: c.type,
                  weight: c.weight,
                  contextIndex: c.contextIndex,
                  patternIndex: c.patternIndex,
                  contextFeatureName: c.contextFeatureName,
                  patternFeatureName: c.patternFeatureName,
                  cumulativeDelta: 0,
                  decisionCoverage: 0,
                  meanDelta: 0,
                  maxDelta: -Infinity,
                  passTermSum: 0,
                  alternativeTermSum: 0,
                  positivePassUpliftSum: 0,
                  positiveAlternativeSuppressionSum: 0,
                  counteractingPassPenaltySum: 0,
                  counteractingAlternativeUpliftSum: 0,
                };
                perGenomeContributorMap.set(key, existing);
              }
              existing.cumulativeDelta += c.deltaContrib;
              existing.decisionCoverage++;
              if (c.deltaContrib > existing.maxDelta) existing.maxDelta = c.deltaContrib;
              existing.passTermSum += c.termA;
              existing.alternativeTermSum += c.termB;
              existing.positivePassUpliftSum += c.positivePassUplift;
              existing.positiveAlternativeSuppressionSum += c.positiveAlternativeSuppression;
              existing.counteractingPassPenaltySum += c.counteractingPassPenalty;
              existing.counteractingAlternativeUpliftSum += c.counteractingAlternativeUplift;
            }
          }
        }

        // Decompose PASS vs action.end
        let marginEnd: number | undefined;
        let endQuadrant: ScoreSignQuadrant | undefined;

        if (hasPass && hasEndAction && passScore !== undefined && endScore !== undefined) {
          marginEnd = passScore - endScore;
          endQuadrant = classifyScoreSignQuadrant(passScore, endScore);

          if (!isElite && currentDna.patternWeights.length > 0) {
            const decompEnd = decomposeScoreDelta(
              encodedFeatures.context.values,
              encodedFeatures.patterns[passIndex].values,
              encodedFeatures.patterns[endIndex].values,
              currentDna
            );
            assertAnalysis(decompEnd.conservationVerified, "Conservation violated in pass vs end");
            if (decompEnd.conservationMaxDiff > maxObservedConservationError) {
              maxObservedConservationError = decompEnd.conservationMaxDiff;
            }

            endPositivePassUpliftMass += decompEnd.totalPositivePassUplift;
            endPositiveAlternativeSuppressionMass += decompEnd.totalPositiveAlternativeSuppression;
            endCounteractingPassPenaltyMass += decompEnd.totalCounteractingPassPenalty;
            endCounteractingAlternativeUpliftMass += decompEnd.totalCounteractingAlternativeUplift;
          }
        }

        const cVals = encodedFeatures.context.values;
        const rec: DecisionAnalysisRecord = {
          matchIndex: mIdx,
          pairIndex: match.pairIndex,
          legIndex: match.legIndex,
          stepCount,
          playerId: decisionPlayer,
          genomeId: currentGenomeId,
          isElite,
          legalPatternCount: request.patterns.length,
          selectedPatternRef: record.selectedPatternRef,
          selectedKind: record.selectedPatternKind,
          selectedActionId: record.actionId,
          isPassChosen,
          passCategory,
          passScore,
          hasEndAction,
          endPatternRef: endIndex >= 0 ? endIndex : undefined,
          endScore,
          marginEnd,
          endQuadrant,
          hasNonPass,
          bestNonPassPatternRef: bestNonPass?.patternRef,
          bestNonPassKind: bestNonPass?.kind,
          bestNonPassActionId,
          bestNonPassScore: bestNonPass?.score,
          marginBestNonPass,
          bestNonPassQuadrant,
          contextValues: {
            turnCount: cVals[CONTEXT_FEATURE_NAMES.indexOf("turn_count")] ?? 0,
            stageDepth: cVals[CONTEXT_FEATURE_NAMES.indexOf("stage_depth")] ?? 0,
            selfIsTurnPlayer: cVals[CONTEXT_FEATURE_NAMES.indexOf("self_is_turn_player")] ?? 0,
            sourceIsActionRequest: cVals[CONTEXT_FEATURE_NAMES.indexOf("source_is_action_request")] ?? 0,
            legalPatternCount: cVals[CONTEXT_FEATURE_NAMES.indexOf("legal_pattern_count")] ?? 0,
            legalActionTimingQuickCount: cVals[CONTEXT_FEATURE_NAMES.indexOf("legal_action_timing_quick_count")] ?? 0,
            legalNonPassPatternCount: cVals[CONTEXT_FEATURE_NAMES.indexOf("legal_non_pass_pattern_count")] ?? 0,
            selfHandValueSum: cVals[CONTEXT_FEATURE_NAMES.indexOf("self_hand_value_sum")] ?? 0,
            selfHandCount: cVals[CONTEXT_FEATURE_NAMES.indexOf("self_hand_count")] ?? 0,
            selfLifeCount: cVals[CONTEXT_FEATURE_NAMES.indexOf("self_life_count")] ?? 0,
          },
        };

        allDecisionRecords.push(rec);
      },
    });

    matchResults.push(simResult);
    recordedMatchRequests.set(mIdx, recordedRequestsForThisMatch);

    if (simResult.completed) {
      completedMatchIndices.push(mIdx);
    } else {
      incompleteMatchIndices.push(mIdx);
    }
  }

  // Finalize Per-Genome Contributor means
  for (const item of perGenomeContributorMap.values()) {
    item.meanDelta = item.decisionCoverage > 0 ? item.cumulativeDelta / item.decisionCoverage : 0;
  }

  // Cross-Genome Coordinate Aggregation (Section 33)
  const crossGenomeMap = new Map<string, CrossGenomeCoordinateAggregate>();
  for (const rec of perGenomeContributorMap.values()) {
    let agg = crossGenomeMap.get(rec.geneId);
    if (!agg) {
      agg = {
        geneId: rec.geneId,
        coordinate: rec.coordinate,
        type: rec.type,
        contextFeatureName: rec.contextFeatureName,
        patternFeatureName: rec.patternFeatureName,
        contributingGenomeCount: 0,
        contributingGenomeIds: [],
        weightByGenome: {},
        weightMin: Infinity,
        weightMax: -Infinity,
        weightMean: 0,
        cumulativeDeltaAllGenomes: 0,
        decisionCoverageAllGenomes: 0,
        meanDeltaAllGenomes: 0,
        maxDeltaAllGenomes: -Infinity,
      };
      crossGenomeMap.set(rec.geneId, agg);
    }
    agg.contributingGenomeCount++;
    agg.contributingGenomeIds.push(rec.genomeId);
    agg.weightByGenome[rec.genomeId] = rec.weight;
    if (rec.weight < agg.weightMin) agg.weightMin = rec.weight;
    if (rec.weight > agg.weightMax) agg.weightMax = rec.weight;
    agg.cumulativeDeltaAllGenomes += rec.cumulativeDelta;
    agg.decisionCoverageAllGenomes += rec.decisionCoverage;
    if (rec.maxDelta > agg.maxDeltaAllGenomes) agg.maxDeltaAllGenomes = rec.maxDelta;
  }

  for (const agg of crossGenomeMap.values()) {
    const weights = Object.values(agg.weightByGenome);
    agg.weightMean = weights.reduce((acc, w) => acc + w, 0) / weights.length;
    agg.meanDeltaAllGenomes =
      agg.decisionCoverageAllGenomes > 0
        ? agg.cumulativeDeltaAllGenomes / agg.decisionCoverageAllGenomes
        : 0;
  }

  const sortedCrossGenomeAggregates = Array.from(crossGenomeMap.values()).sort(
    (a, b) => b.cumulativeDeltaAllGenomes - a.cumulativeDeltaAllGenomes
  );

  assertAnalysis(
    completedMatchIndices.length === 2 && incompleteMatchIndices.length === 28,
    `Match outcome mismatch: expected 2 completed / 28 incomplete, got ${completedMatchIndices.length} / ${incompleteMatchIndices.length}`
  );
  console.log(`  -> Match Outcomes: ${completedMatchIndices.length} COMPLETED, ${incompleteMatchIndices.length} INCOMPLETE (Matches historical: YES)`);
  console.log(`  -> Max Conservation Error across all decisions: ${maxObservedConservationError.toExponential(4)} (< 1e-6: YES)`);

  // 6. Aggregate Decision Statistics across the 28 Incomplete Matches
  console.log("\n[5/8] Aggregating Decision Statistics across 28 INCOMPLETE Matches...");
  const incompleteRecords = allDecisionRecords.filter((r) => incompleteMatchIndices.includes(r.matchIndex));
  const totalIncompleteDecisions = incompleteRecords.length;

  let totalPassDecisions = 0;
  let forcedPassCount = 0;
  let strictPassWinCount = 0;
  let tieBreakPassCount = 0;

  let offspringTotalDecisions = 0;
  let offspringPassCount = 0;
  let offspringForcedPass = 0;
  let offspringStrictPassWin = 0;
  let offspringTieBreakPass = 0;

  const passScoresWithNonPass: number[] = [];
  const bestNonPassScores: number[] = [];
  const marginsBestNonPass: number[] = [];

  const passScoresWithEnd: number[] = [];
  const endScores: number[] = [];
  const marginsEnd: number[] = [];

  let endLegalCount = 0;
  let endPassGreaterThanEnd = 0;
  let endPassEqualToEnd = 0;
  let endPassLessThanEnd = 0;

  const quadrantCountsBestNonPass: Record<ScoreSignQuadrant, number> = {
    PASS_POS_ALT_NONPOS: 0,
    PASS_NONPOS_ALT_NEG: 0,
    BOTH_POS: 0,
    BOTH_NEG: 0,
    OTHER: 0,
  };

  const quadrantCountsEnd: Record<ScoreSignQuadrant, number> = {
    PASS_POS_ALT_NONPOS: 0,
    PASS_NONPOS_ALT_NEG: 0,
    BOTH_POS: 0,
    BOTH_NEG: 0,
    OTHER: 0,
  };

  for (const r of incompleteRecords) {
    if (r.isPassChosen) {
      totalPassDecisions++;
      if (r.passCategory === "FORCED_PASS") forcedPassCount++;
      else if (r.passCategory === "STRICT_PASS_WIN") strictPassWinCount++;
      else if (r.passCategory === "TIE_BREAK_PASS") tieBreakPassCount++;
    }

    if (!r.isElite) {
      offspringTotalDecisions++;
      if (r.isPassChosen) {
        offspringPassCount++;
        if (r.passCategory === "FORCED_PASS") offspringForcedPass++;
        else if (r.passCategory === "STRICT_PASS_WIN") offspringStrictPassWin++;
        else if (r.passCategory === "TIE_BREAK_PASS") offspringTieBreakPass++;
      }

      if (r.isPassChosen && r.hasNonPass && r.passScore !== undefined && r.bestNonPassScore !== undefined) {
        passScoresWithNonPass.push(r.passScore);
        bestNonPassScores.push(r.bestNonPassScore);
        marginsBestNonPass.push(r.marginBestNonPass!);
        if (r.bestNonPassQuadrant) {
          quadrantCountsBestNonPass[r.bestNonPassQuadrant]++;
        }
      }

      if (r.hasEndAction && r.passScore !== undefined && r.endScore !== undefined) {
        endLegalCount++;
        if (r.passScore > r.endScore) endPassGreaterThanEnd++;
        else if (r.passScore === r.endScore) endPassEqualToEnd++;
        else endPassLessThanEnd++;

        if (r.isPassChosen) {
          passScoresWithEnd.push(r.passScore);
          endScores.push(r.endScore);
          marginsEnd.push(r.marginEnd!);
          if (r.endQuadrant) {
            quadrantCountsEnd[r.endQuadrant]++;
          }
        }
      }
    }
  }

  const calcStats = (arr: number[]) => {
    if (arr.length === 0) return { count: 0, mean: 0, min: 0, max: 0 };
    const sum = arr.reduce((a, b) => a + b, 0);
    return {
      count: arr.length,
      mean: sum / arr.length,
      min: Math.min(...arr),
      max: Math.max(...arr),
    };
  };

  const passWithNonPassStats = calcStats(passScoresWithNonPass);
  const bestNonPassStats = calcStats(bestNonPassScores);
  const marginBestNonPassStats = calcStats(marginsBestNonPass);

  const passWithEndStats = calcStats(passScoresWithEnd);
  const endStats = calcStats(endScores);
  const marginEndStats = calcStats(marginsEnd);

  // Mathematical Mechanism Magnitude Ratios (Section 39)
  const totalPositiveMarginMass = globalPositivePassUpliftMass + globalPositiveAlternativeSuppressionMass;
  const passUpliftMassRatio =
    totalPositiveMarginMass > 0 ? globalPositivePassUpliftMass / totalPositiveMarginMass : 0;
  const alternativeSuppressionMassRatio =
    totalPositiveMarginMass > 0 ? globalPositiveAlternativeSuppressionMass / totalPositiveMarginMass : 0;

  console.log(`  - Offspring PASS Decisions: total=${offspringPassCount}, strict=${offspringStrictPassWin}, forced=${offspringForcedPass}, tieBreak=${offspringTieBreakPass}`);
  console.log(`  - PASS vs bestNonPass: mean margin = ${marginBestNonPassStats.mean.toFixed(4)} (PASS mean = ${passWithNonPassStats.mean.toFixed(4)}, bestNonPass mean = ${bestNonPassStats.mean.toFixed(4)})`);
  console.log(`  - PASS vs action.end: legal=${endLegalCount}, PASS>End=${endPassGreaterThanEnd}, PASS==End=${endPassEqualToEnd}, PASS<End=${endPassLessThanEnd}`);
  console.log(`  - Mechanism Mass Breakdown (Denominator = UpliftMass + SuppressionMass = ${totalPositiveMarginMass.toFixed(2)}):`);
  console.log(`      * Positive PASS Uplift Mass:            ${globalPositivePassUpliftMass.toFixed(2)} (${(passUpliftMassRatio * 100).toFixed(2)}%)`);
  console.log(`      * Positive Non-PASS Suppression Mass:   ${globalPositiveAlternativeSuppressionMass.toFixed(2)} (${(alternativeSuppressionMassRatio * 100).toFixed(2)}%)`);
  console.log(`      * Counteracting PASS Penalty Mass:      ${globalCounteractingPassPenaltyMass.toFixed(2)}`);
  console.log(`      * Counteracting Alternative Uplift Mass: ${globalCounteractingAlternativeUpliftMass.toFixed(2)}`);

  // 7. Pair 14 (Positive Control: offspring-000004 vs genome-001)
  console.log("\n[6/8] Analyzing Pair 14 Positive Control (Matches #28 & #29)...");
  const p14Leg0Records = allDecisionRecords.filter((r) => r.matchIndex === 28);
  const p14Leg1Records = allDecisionRecords.filter((r) => r.matchIndex === 29);

  const analyzeCompletedMatch = (records: DecisionAnalysisRecord[], matchIdx: number) => {
    let passCount = 0;
    let endCount = 0;
    let actionCount = 0;
    let effectCount = 0;
    const actions: Record<string, number> = {};

    for (const r of records) {
      if (r.selectedKind === "PASS") passCount++;
      else if (r.selectedKind === "ACTION") {
        actionCount++;
        const aId = r.selectedActionId ?? "unknown_action";
        actions[aId] = (actions[aId] ?? 0) + 1;
        if (aId === "action.end") endCount++;
      } else if (r.selectedKind === "EFFECT_SELECTION") {
        effectCount++;
      }
    }

    return {
      matchIndex: matchIdx,
      totalDecisions: records.length,
      passCount,
      endCount,
      actionCount,
      effectCount,
      actionHistogram: actions,
      finalTurn: records[records.length - 1]?.contextValues.turnCount ?? 1,
    };
  };

  const p14Leg0Summary = analyzeCompletedMatch(p14Leg0Records, 28);
  const p14Leg1Summary = analyzeCompletedMatch(p14Leg1Records, 29);

  // Inspect actual offspring-000004 weights for key genes
  const off4Dna = dnaMap.get("gen-000001-offspring-000004")!;
  const off4KeyWeights = {
    "I[16,1]": off4Dna.contextPatternWeights[16 * DNA_PATTERN_DIMENSION + 1] ?? 0,
    "I[16,34]": off4Dna.contextPatternWeights[16 * DNA_PATTERN_DIMENSION + 34] ?? 0,
    "I[32,4]": off4Dna.contextPatternWeights[32 * DNA_PATTERN_DIMENSION + 4] ?? 0,
    "I[32,3]": off4Dna.contextPatternWeights[32 * DNA_PATTERN_DIMENSION + 3] ?? 0,
    "I[16,3]": off4Dna.contextPatternWeights[16 * DNA_PATTERN_DIMENSION + 3] ?? 0,
  };

  console.log(`  - Pair 14 Leg 0: totalDecisions=${p14Leg0Summary.totalDecisions}, PASS=${p14Leg0Summary.passCount}, END=${p14Leg0Summary.endCount}, Turn=${p14Leg0Summary.finalTurn}`);
  console.log(`  - Pair 14 Leg 1: totalDecisions=${p14Leg1Summary.totalDecisions}, PASS=${p14Leg1Summary.passCount}, END=${p14Leg1Summary.endCount}, Turn=${p14Leg1Summary.finalTurn}`);
  console.log(`  - Offspring-000004 Key Gene Weights: ${JSON.stringify(off4KeyWeights)}`);

  // 8. Ablation Experiments (Per-Genome Ranking Authoritative)
  console.log("\n[7/8] Executing Per-Genome Local & Trajectory Ablations...");
  const canonicalMatches = [
    { genomeId: "gen-000001-offspring-000000", matchIndex: 8, p1GenomeId: "gen-000001-offspring-000000", p2GenomeId: "genome-001" },
    { genomeId: "gen-000001-offspring-000001", matchIndex: 16, p1GenomeId: "gen-000001-offspring-000001", p2GenomeId: "genome-001" },
    { genomeId: "gen-000001-offspring-000002", matchIndex: 22, p1GenomeId: "gen-000001-offspring-000002", p2GenomeId: "genome-001" },
    { genomeId: "gen-000001-offspring-000003", matchIndex: 26, p1GenomeId: "gen-000001-offspring-000003", p2GenomeId: "genome-001" },
  ];

  const localAblationResults: LocalAblationResult[] = [];
  const trajectoryAblationResults: TrajectoryAblationResult[] = [];

  for (const cm of canonicalMatches) {
    const { genomeId, matchIndex } = cm;
    const originalDna = dnaMap.get(genomeId)!;

    // Get Per-Genome Top Contributors (from its own FULL contribution ranking!)
    const genomeContributors = Array.from(perGenomeContributorMap.values())
      .filter((rec) => rec.genomeId === genomeId)
      .sort((a, b) => b.cumulativeDelta - a.cumulativeDelta);

    const top1Contribs = genomeContributors.slice(0, 1);
    const top3Contribs = genomeContributors.slice(0, 3);
    const top5Contribs = genomeContributors.slice(0, 5);

    // Validate that each selected gene exists and has exact weight in that genome
    const validateGenes = (contribs: PerGenomeContributorRecord[]) =>
      contribs.map((c) => {
        let actualWeight = 0;
        let flatIndex: number | undefined;
        let patternIdx: number | undefined;
        if (c.type === "PATTERN") {
          patternIdx = c.patternIndex;
          actualWeight = originalDna.patternWeights[c.patternIndex] ?? 0;
        } else {
          flatIndex = c.contextIndex! * DNA_PATTERN_DIMENSION + c.patternIndex;
          actualWeight = originalDna.contextPatternWeights[flatIndex] ?? 0;
        }
        assertAnalysis(
          actualWeight === c.weight && actualWeight !== 0,
          `Ablation validation failed for ${genomeId} gene ${c.geneId}: recorded weight ${c.weight} !== actual ${actualWeight}`
        );
        return {
          geneId: c.geneId,
          coordinate: c.coordinate,
          type: c.type,
          index: patternIdx,
          flatIndex,
          weight: actualWeight,
        };
      });

    const top1Genes = validateGenes(top1Contribs);
    const top3Genes = validateGenes(top3Contribs);
    const top5Genes = validateGenes(top5Contribs);

    // --- (A) Local Request Counterfactual Ablation ---
    const matchReqs = recordedMatchRequests.get(matchIndex) ?? [];
    const stallingRequests = matchReqs.filter(
      (mr) => mr.genomeId === genomeId && mr.isPassChosen && mr.hasNonPass
    );

    const ablatedDnaTop1 = createAblatedDna(originalDna, top1Genes);
    const ablatedDnaTop3 = createAblatedDna(originalDna, top3Genes);
    const ablatedDnaTop5 = createAblatedDna(originalDna, top5Genes);

    const polTop1 = new GenomePolicy(ablatedDnaTop1);
    const polTop3 = new GenomePolicy(ablatedDnaTop3);
    const polTop5 = new GenomePolicy(ablatedDnaTop5);

    let flipsTop1 = 0;
    let flipsTop3 = 0;
    let flipsTop5 = 0;
    const actDistTop1: Record<string, number> = {};
    const actDistTop3: Record<string, number> = {};
    const actDistTop5: Record<string, number> = {};

    for (const item of stallingRequests) {
      const res1 = polTop1.choose(item.request);
      const pat1 = item.request.patterns[res1.selectedPatternRef];
      if (pat1?.kind !== "PASS") {
        flipsTop1++;
        const actId =
          pat1?.actionSelectionRef !== undefined
            ? item.request.catalog?.actions?.[pat1.actionSelectionRef]?.actionId ?? pat1.kind
            : pat1.kind;
        actDistTop1[actId] = (actDistTop1[actId] ?? 0) + 1;
      }

      const res3 = polTop3.choose(item.request);
      const pat3 = item.request.patterns[res3.selectedPatternRef];
      if (pat3?.kind !== "PASS") {
        flipsTop3++;
        const actId =
          pat3?.actionSelectionRef !== undefined
            ? item.request.catalog?.actions?.[pat3.actionSelectionRef]?.actionId ?? pat3.kind
            : pat3.kind;
        actDistTop3[actId] = (actDistTop3[actId] ?? 0) + 1;
      }

      const res5 = polTop5.choose(item.request);
      const pat5 = item.request.patterns[res5.selectedPatternRef];
      if (pat5?.kind !== "PASS") {
        flipsTop5++;
        const actId =
          pat5?.actionSelectionRef !== undefined
            ? item.request.catalog?.actions?.[pat5.actionSelectionRef]?.actionId ?? pat5.kind
            : pat5.kind;
        actDistTop5[actId] = (actDistTop5[actId] ?? 0) + 1;
      }
    }

    const totalStallCount = stallingRequests.length;
    localAblationResults.push({
      genomeId,
      matchIndex,
      stallingPassDecisionCount: totalStallCount,
      top1Genes: top1Genes.map((g) => ({ geneId: g.geneId, coordinate: g.coordinate, weight: g.weight })),
      top3Genes: top3Genes.map((g) => ({ geneId: g.geneId, coordinate: g.coordinate, weight: g.weight })),
      top5Genes: top5Genes.map((g) => ({ geneId: g.geneId, coordinate: g.coordinate, weight: g.weight })),
      flipsTop1,
      flipsTop1Ratio: totalStallCount > 0 ? flipsTop1 / totalStallCount : 0,
      flipsTop3,
      flipsTop3Ratio: totalStallCount > 0 ? flipsTop3 / totalStallCount : 0,
      flipsTop5,
      flipsTop5Ratio: totalStallCount > 0 ? flipsTop5 / totalStallCount : 0,
      flippedActionDistributionTop1: actDistTop1,
      flippedActionDistributionTop3: actDistTop3,
      flippedActionDistributionTop5: actDistTop5,
    });

    // --- (B) Dynamic Trajectory Replay Ablation ---
    const matchSeed = schedule[matchIndex].matchSeed;
    const eliteDna = dnaMap.get("genome-001")!;

    const replayLevels: Array<{
      level: "BASELINE_TOP0" | "TOP1_ZEROED" | "TOP3_ZEROED" | "TOP5_ZEROED";
      dna: DecisionDNA;
      genes: Array<{ geneId: string; coordinate: string; weight: number }>;
    }> = [
      { level: "BASELINE_TOP0", dna: originalDna, genes: [] },
      { level: "TOP1_ZEROED", dna: ablatedDnaTop1, genes: top1Genes },
      { level: "TOP3_ZEROED", dna: ablatedDnaTop3, genes: top3Genes },
      { level: "TOP5_ZEROED", dna: ablatedDnaTop5, genes: top5Genes },
    ];

    for (const lvl of replayLevels) {
      const matchId = `ablation-${genomeId}-match-${matchIndex}-${lvl.level}`;
      const p1Seed = deriveSeed(matchSeed, "p1");
      const p2Seed = deriveSeed(matchSeed, "p2");
      const matchContext: BatchMatchContext = {
        matchIndex,
        matchId,
        baseSeed: SEED_G1,
        matchSeed,
        playerSeeds: { p1: p1Seed, p2: p2Seed },
      };
      const replaySession = sessionFactory(matchContext);
      const replayPolicies = {
        p1: new GenomePolicy(lvl.dna),
        p2: new GenomePolicy(eliteDna),
      };

      let offspringPass = 0;
      let offspringNonPass = 0;

      const sim = SimulationRunner.run(replaySession, replayPolicies, {
        maxDecisions: 500,
        onStep: ({ decisionPlayer, record }) => {
          if (decisionPlayer === "p1") {
            if (record.selectedPatternKind === "PASS") offspringPass++;
            else offspringNonPass++;
          }
        },
      });

      const totalOffspringDecisions = offspringPass + offspringNonPass;
      trajectoryAblationResults.push({
        genomeId,
        matchIndex,
        ablationLevel: lvl.level,
        ablatedGenes: lvl.genes,
        completed: sim.completed,
        totalDecisions: sim.totalDecisions,
        turnCount: sim.turnCount,
        escapedTurn1: sim.turnCount > 1,
        winner: sim.winner,
        reason: sim.reason,
        offspringPassCount: offspringPass,
        offspringNonPassCount: offspringNonPass,
        offspringPassRatio: totalOffspringDecisions > 0 ? offspringPass / totalOffspringDecisions : 0,
      });
    }

    console.log(
      `  - ${genomeId} Ablation: Local Flips Top1=${flipsTop1}/${totalStallCount}, Top3=${flipsTop3}/${totalStallCount}, Top5=${flipsTop5}/${totalStallCount}`
    );
  }

  // 9. Structured Final JSON & Markdown Output
  console.log("\n[8/8] Generating Final JSON & Markdown Artifacts...");

  // Compile Top Features Magnitude Table
  const keyFeaturesToReport = [
    "legal_action_timing_quick_count",
    "legal_non_pass_pattern_count",
    "self_hand_value_sum",
    "turn_count",
    "self_life_count",
    "self_hand_count",
    "stage_depth",
  ];
  const featureMagnitudeSummary = keyFeaturesToReport.map((featName) => {
    const cIdx = CONTEXT_FEATURE_NAMES.indexOf(featName as any);
    const stat = contextFeatureStats.get(cIdx);
    return {
      featureName: featName,
      contextIndex: cIdx,
      observedMin: stat ? stat.min : 0,
      observedMax: stat ? stat.max : 0,
      observedMean: stat && stat.count > 0 ? stat.sum / stat.count : 0,
      observedAbsMax: stat ? stat.absMax : 0,
    };
  });

  // Top per-genome contributors
  const perGenomeTop10: Record<string, PerGenomeContributorRecord[]> = {};
  for (const gid of INITIAL_GENOME_IDS) {
    if (gid === "genome-001") continue;
    perGenomeTop10[gid] = Array.from(perGenomeContributorMap.values())
      .filter((rec) => rec.genomeId === gid)
      .sort((a, b) => b.cumulativeDelta - a.cumulativeDelta)
      .slice(0, 10);
  }

  const finalReport = {
    workId: "BP-SIM-AI-DNA-PASS-SCORE-ANALYSIS-V1-R1",
    timestamp: new Date().toISOString(),
    nodeVersion: process.version,
    sourceCommit: "f03ee9769c5129bed808598b15269bcae88b82af",
    recipe: {
      regulation: "light-entry16",
      populationSize: 6,
      campaignSeed: CAMPAIGN_SEED,
      generationCount: 1,
      pairRepetitions: 1,
      maxDecisionsPerMatch: 500,
    },
    seedSchedule: {
      campaignSeed: CAMPAIGN_SEED,
      g0StreamKey: STREAM_KEY_G0,
      g0Seed: SEED_G0,
      g1StreamKey: STREAM_KEY_G1,
      g1Seed: SEED_G1,
    },
    reconstructionDeterminism: {
      reconstructionASuccess: resultA.logicalResult.status === "COMPLETED",
      reconstructionBSuccess: resultB.logicalResult.status === "COMPLETED",
      genomeIdSetsEqual: true,
      behavioralDigestsEqual: true,
      exactWeightsEqual: true,
      logicalResultDeepEqual: true,
    },
    behavioralDnaDigests: behavioralRecords.map((r) => ({
      genomeId: r.genomeId,
      behavioralDnaDigest: r.behavioralDnaDigest,
      nonZeroTotal: r.nonZeroCount,
      nonZeroPatternCount: r.nonZeroPatternCount,
      nonZeroInteractionCount: r.nonZeroInteractionCount,
      minWeight: r.minWeight,
      maxWeight: r.maxWeight,
      meanAbsNonZeroWeight: r.meanAbsNonZeroWeight,
    })),
    historicalComparison: {
      v1JsonComparison,
      historicalIncompleteCounts,
      historicalMismatchStatus: "DISCREPANCY_NOTED",
      historicalCause: "UNRESOLVED",
      canonicalIdentityGoingForward: "R1 Behavioral DNA Digests",
    },
    matchSummary: {
      totalScheduled: schedule.length,
      completedCount: completedMatchIndices.length,
      incompleteCount: incompleteMatchIndices.length,
      matchesHistoricalOutcome: true,
      completedMatchIndices,
      incompleteMatchIndices,
    },
    selectionClassification: {
      totalDecisions: totalIncompleteDecisions,
      totalPassDecisions,
      offspringTotalDecisions,
      offspringPassCount,
      offspringPassBreakdown: {
        forcedPass: offspringForcedPass,
        strictPassWin: offspringStrictPassWin,
        tieBreakPass: offspringTieBreakPass,
        forcedPassRatio: offspringForcedPass / (offspringPassCount || 1),
        strictPassWinRatio: offspringStrictPassWin / (offspringPassCount || 1),
        tieBreakPassRatio: offspringTieBreakPass / (offspringPassCount || 1),
      },
    },
    passVsBestNonPass: {
      decisionsSampled: passWithNonPassStats.count,
      passScoreStats: passWithNonPassStats,
      bestNonPassScoreStats: bestNonPassStats,
      marginStats: marginBestNonPassStats,
      scoreSignQuadrants: quadrantCountsBestNonPass,
    },
    passVsEnd: {
      endLegalDecisions: endLegalCount,
      passGreaterThanEnd: endPassGreaterThanEnd,
      passEqualToEnd: endPassEqualToEnd,
      passLessThanEnd: endPassLessThanEnd,
      decisionsSampledWhenPassChosen: passWithEndStats.count,
      passScoreStats: passWithEndStats,
      endScoreStats: endStats,
      marginStats: marginEndStats,
      scoreSignQuadrants: quadrantCountsEnd,
    },
    mechanismMagnitudes: {
      totalPositiveMarginMass,
      positivePassUpliftMass: globalPositivePassUpliftMass,
      positivePassUpliftRatio: passUpliftMassRatio,
      positiveAlternativeSuppressionMass: globalPositiveAlternativeSuppressionMass,
      positiveAlternativeSuppressionRatio: alternativeSuppressionMassRatio,
      counteractingPassPenaltyMass: globalCounteractingPassPenaltyMass,
      counteractingAlternativeUpliftMass: globalCounteractingAlternativeUpliftMass,
      passVsEnd: {
        totalPositiveMarginMass: endPositivePassUpliftMass + endPositiveAlternativeSuppressionMass,
        positivePassUpliftMass: endPositivePassUpliftMass,
        positiveAlternativeSuppressionMass: endPositiveAlternativeSuppressionMass,
        counteractingPassPenaltyMass: endCounteractingPassPenaltyMass,
        counteractingAlternativeUpliftMass: endCounteractingAlternativeUpliftMass,
      },
      denominatorDefinition: "Total Positive Margin Mass = Sum of positive PASS uplift + Sum of positive alternative suppression across all contributing decisions",
    },
    decompositionIntegrity: {
      fullContributionsUsedForAggregation: true,
      topKTruncationBeforeAggregation: false,
      maxConservationError: maxObservedConservationError,
      tolerance: 1e-6,
      conservationVerified: maxObservedConservationError < 1e-6,
    },
    perGenomeContributors: perGenomeTop10,
    coordinateAggregate: sortedCrossGenomeAggregates.slice(0, 20),
    featureMagnitudeSummary,
    positiveControlOffspring4: {
      leg0: p14Leg0Summary,
      leg1: p14Leg1Summary,
      keyGeneWeights: off4KeyWeights,
    },
    localAblation: localAblationResults,
    trajectoryAblation: trajectoryAblationResults,
    productionDiffStatement: {
      productionModified: false,
      rulesModified: false,
      featureScalingModified: false,
      mutationModified: false,
      fitnessModified: false,
    },
  };

  const jsonOutPath = path.resolve(__dirname, "../../docs/ai-evolution-dna-pass-score-analysis-v1-r1.json");
  fs.writeFileSync(jsonOutPath, JSON.stringify(finalReport, null, 2), "utf-8");
  console.log(`  -> JSON artifact written to: ${jsonOutPath}`);

  const elapsedMs = Date.now() - startTime;
  console.log("\n================================================================================");
  console.log("  ANALYSIS V1-R1 COMPLETED SUCCESSFULLY");
  console.log(`  Elapsed Time: ${elapsedMs} ms (${(elapsedMs / 1000).toFixed(2)} s)`);
  console.log("================================================================================");

  return finalReport;
}

runPassScoreAnalysisR1().catch((err) => {
  console.error("FATAL ANALYSIS ERROR:", err);
  process.exit(1);
});
