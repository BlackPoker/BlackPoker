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
// DNA Gene Coordinate & Inventory Types
// -----------------------------------------------------------------------------

export interface DnaGeneCoordinate {
  id: string;
  type: "PATTERN" | "INTERACTION";
  index?: number;
  flatIndex?: number;
  contextIndex?: number;
  patternIndex: number;
  contextFeatureName?: string;
  patternFeatureName: string;
  weight: number;
}

export interface DnaInventory {
  genomeId: string;
  isZeroDNA: boolean;
  totalWeights: number;
  nonZeroCount: number;
  nonZeroPatternCount: number;
  nonZeroInteractionCount: number;
  genes: DnaGeneCoordinate[];
}

// -----------------------------------------------------------------------------
// Score Delta Decomposition Types
// -----------------------------------------------------------------------------

export interface GeneDeltaContribution {
  geneId: string;
  type: "PATTERN" | "INTERACTION";
  weight: number;
  contextFeatureName?: string;
  patternFeatureName: string;
  contextValue: number;
  patternDiff: number; // p_A - p_B
  termA: number;
  termB: number;
  deltaContrib: number; // termA - termB
  direction: "PASS_UPLIFT" | "NONPASS_SUPPRESSION" | "MIXED_EFFECT";
}

export interface ScoreDeltaDecompositionResult {
  scoreA: number;
  scoreB: number;
  deltaScore: number;
  contributions: GeneDeltaContribution[];
  conservationVerified: boolean;
  conservationMaxDiff: number;
}

// -----------------------------------------------------------------------------
// Per-Decision Analysis Record
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

  // PASS 選択時の分類
  passCategory?: "FORCED_PASS" | "STRICT_PASS_WIN" | "TIE_BREAK_PASS";
  passScore?: number;

  // action.end との比較
  hasEndAction: boolean;
  endPatternRef?: number;
  endScore?: number;
  marginEnd?: number; // passScore - endScore
  endMarginCause?: "PASS_UPLIFT" | "NONPASS_SUPPRESSION" | "MIXED_EFFECT" | "TIE_BREAK";
  topContributorsToEnd?: GeneDeltaContribution[];

  // bestNonPass との比較
  hasNonPass: boolean;
  bestNonPassPatternRef?: number;
  bestNonPassKind?: string;
  bestNonPassActionId?: string;
  bestNonPassScore?: number;
  marginBestNonPass?: number; // passScore - bestNonPassScore
  bestNonPassMarginCause?: "PASS_UPLIFT" | "NONPASS_SUPPRESSION" | "MIXED_EFFECT" | "TIE_BREAK";
  topContributorsToBestNonPass?: GeneDeltaContribution[];

  // Context 特徴量の注目値
  contextValuesSample: {
    turnCount: number;
    stageDepth: number;
    selfIsTurnPlayer: number;
    sourceIsActionRequest: number;
    legalPatternCount: number;
    selfHandCount: number;
    selfLifeCount: number;
  };
}

// -----------------------------------------------------------------------------
// Cumulative Gene Contribution Tracker
// -----------------------------------------------------------------------------

export interface CumulativeGeneStat {
  geneId: string;
  type: "PATTERN" | "INTERACTION";
  weight: number;
  contextFeatureName?: string;
  patternFeatureName: string;
  cumulativeDelta: number;
  decisionCount: number;
  maxSingleDelta: number;
  meanDelta: number;
  typicalContextVal: number;
  typicalPatternDiff: number;
  primaryDirection: "PASS_UPLIFT" | "NONPASS_SUPPRESSION" | "MIXED_EFFECT";
}

// -----------------------------------------------------------------------------
// Ablation Experiment Types
// -----------------------------------------------------------------------------

export interface LocalAblationResult {
  genomeId: string;
  matchIndex: number;
  stallingPassDecisionCount: number;
  top1Genes: string[];
  top3Genes: string[];
  top5Genes: string[];
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
  ablatedGenes: string[];
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
// Helper: DNA Non-Zero Gene Extraction
// -----------------------------------------------------------------------------

function extractNonZeroGenes(dna: DecisionDNA, genomeId: string): DnaInventory {
  const pWeights = dna.patternWeights ?? [];
  const cpWeights = dna.contextPatternWeights ?? [];

  const genes: DnaGeneCoordinate[] = [];
  let nonZeroPattern = 0;
  let nonZeroInteraction = 0;

  // 1. Pattern linear weights
  for (let j = 0; j < pWeights.length; j++) {
    const w = pWeights[j];
    if (w !== 0) {
      nonZeroPattern++;
      genes.push({
        id: `P[${j}]:${PATTERN_FEATURE_NAMES[j]}`,
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
      const cIdx = Math.floor(k / DNA_PATTERN_DIMENSION);
      const pIdx = k % DNA_PATTERN_DIMENSION;
      genes.push({
        id: `I[${cIdx},${pIdx}]:${CONTEXT_FEATURE_NAMES[cIdx]}x${PATTERN_FEATURE_NAMES[pIdx]}`,
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

  return {
    genomeId,
    isZeroDNA: genes.length === 0,
    totalWeights: pWeights.length + cpWeights.length,
    nonZeroCount: genes.length,
    nonZeroPatternCount: nonZeroPattern,
    nonZeroInteractionCount: nonZeroInteraction,
    genes,
  };
}

// -----------------------------------------------------------------------------
// Helper: Delta Score Decomposition with Conservation Check
// -----------------------------------------------------------------------------

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

    let direction: "PASS_UPLIFT" | "NONPASS_SUPPRESSION" | "MIXED_EFFECT";
    if (termA > 0 && termB <= 0) {
      direction = "PASS_UPLIFT";
    } else if (termA <= 0 && termB < 0) {
      direction = "NONPASS_SUPPRESSION";
    } else {
      direction = "MIXED_EFFECT";
    }

    contributions.push({
      geneId: `P[${j}]:${PATTERN_FEATURE_NAMES[j]}`,
      type: "PATTERN",
      weight: w,
      patternFeatureName: PATTERN_FEATURE_NAMES[j],
      contextValue: 1, // Linear weights implicitly have context multiplier = 1
      patternDiff: diff,
      termA,
      termB,
      deltaContrib: contrib,
      direction,
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

      let direction: "PASS_UPLIFT" | "NONPASS_SUPPRESSION" | "MIXED_EFFECT";
      if (termA > 0 && termB <= 0) {
        direction = "PASS_UPLIFT";
      } else if (termA <= 0 && termB < 0) {
        direction = "NONPASS_SUPPRESSION";
      } else {
        direction = "MIXED_EFFECT";
      }

      contributions.push({
        geneId: `I[${i},${j}]:${CONTEXT_FEATURE_NAMES[i]}x${PATTERN_FEATURE_NAMES[j]}`,
        type: "INTERACTION",
        weight: mVal,
        contextFeatureName: CONTEXT_FEATURE_NAMES[i],
        patternFeatureName: PATTERN_FEATURE_NAMES[j],
        contextValue: cVal,
        patternDiff: diff,
        termA,
        termB,
        deltaContrib: contrib,
        direction,
      });
    }
  }

  // Calculate full scores for A and B
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

  // Sort contributions descending by deltaContrib (highest positive contributors first)
  contributions.sort((a, b) => b.deltaContrib - a.deltaContrib);

  return {
    scoreA,
    scoreB,
    deltaScore,
    contributions,
    conservationVerified,
    conservationMaxDiff: conservationDiff,
  };
}

// -----------------------------------------------------------------------------
// Helper: Create Ablated DNA
// -----------------------------------------------------------------------------

function createAblatedDna(dna: DecisionDNA, genesToZero: DnaGeneCoordinate[]): DecisionDNA {
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

async function runPassScoreAnalysis() {
  const startTime = Date.now();
  console.log("================================================================================");
  console.log("  BLACKPOKER SIMULATOR - DECISION DNA PASS SCORE ROOT CAUSE ANALYSIS V1");
  console.log("  Work ID: BP-SIM-AI-DNA-PASS-SCORE-ANALYSIS-V1");
  console.log("================================================================================");

  // 1. 環境とルールの初期化
  console.log("\n[1/7] Loading Official Regulation Catalog & Rules...");
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
  const SEED_G0 = deriveSeed(CAMPAIGN_SEED, canonicalGenerationStreamKey(0));
  const SEED_G1 = deriveSeed(CAMPAIGN_SEED, canonicalGenerationStreamKey(1));

  assertAnalysis(SEED_G0 === 4143575905, `g0 seed mismatch: ${SEED_G0}`);
  assertAnalysis(SEED_G1 === 4126798286, `g1 seed mismatch: ${SEED_G1}`);

  const INITIAL_GENOME_IDS = [
    "genome-000",
    "genome-001",
    "genome-002",
    "genome-003",
    "genome-004",
    "genome-005",
  ];

  const initialPop: PopulationSnapshot = Object.freeze({
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
    generationCount: 1, // g0 -> g1 再構築用
    runnerConfig: Object.freeze({
      pairRepetitions: 1,
      maxDecisionsPerMatch: 500,
      builderConfig: Object.freeze({
        populationSize: 6,
      }),
    }),
  });

  // 3. g0 から g1 母集団を決定論的に再構築
  console.log("\n[2/7] Reconstructing Population(g1) from g0...");
  const params: RunEvolutionLoopParams = {
    initialPopulation: initialPop,
    campaignSeed: CAMPAIGN_SEED,
    environment,
    sessionFactory,
    config: loopConfig,
  };

  const g0Result = EvolutionLoop.run(params);
  const { logicalResult: g0Logical } = g0Result;
  assertAnalysis(g0Logical.status === "COMPLETED", "g0 must complete");
  assertAnalysis(g0Logical.completedTransitions === 1, "completedTransitions must be 1");

  const g1Population = g0Logical.finalPopulation;
  console.log(`  - g1 Reconstructed Genomes: ${g1Population.entries.map((e) => e.genomeId).join(", ")}`);

  // 4. DNA 非ゼロ遺伝子のインベントリ化
  console.log("\n[3/7] Inventorying Non-Zero DNA Mutation Genes...");
  const dnaMap = new Map<string, DecisionDNA>();
  const inventoryMap = new Map<string, DnaInventory>();

  for (const entry of g1Population.entries) {
    const dna = entry.dna as DecisionDNA;
    dnaMap.set(entry.genomeId, dna);
    const inv = extractNonZeroGenes(dna, entry.genomeId);
    inventoryMap.set(entry.genomeId, inv);
    console.log(
      `  - ${entry.genomeId.padEnd(28)}: nonZero=${inv.nonZeroCount}/${inv.totalWeights} (P:${inv.nonZeroPatternCount}, I:${inv.nonZeroInteractionCount})`
    );
  }

  // 5. 全30試合のシミュレーション実行およびスコア差分分解トレース
  console.log("\n[4/7] Running All 30 Matches & Decomposing Decision Scores...");
  const schedule = GenerationRunner.planSchedule(g1Population, SEED_G1, 1);
  assertAnalysis(schedule.length === 30, `Expected 30 matches, got ${schedule.length}`);

  const allDecisionRecords: DecisionAnalysisRecord[] = [];
  const incompleteMatchIndices: number[] = [];
  const completedMatchIndices: number[] = [];
  const matchResults: SimulationResult[] = [];

  // 凍結リクエスト保持用 (Local Ablation 用: matchIndex -> array of requests)
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
    const matchRequestsList: Array<{
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
      onStep: ({ stepCount, decisionPlayer, record, request }) => {
        if (!request) return;

        const currentGenomeId = decisionPlayer === "p1" ? p1GenomeId : p2GenomeId;
        const currentDna = decisionPlayer === "p1" ? p1Dna : p2Dna;
        const isElite = currentGenomeId === "genome-001";

        // 特徴量エンコードとスコアリング
        const encodedFeatures = DecisionFeatureEncoder.encode(request);
        const scoredPatterns = GenomeScorer.score(encodedFeatures, currentDna);

        // Argmax 整合性チェック (GenomePolicy と完全一致すること)
        let bestScore = -Infinity;
        let expectedRef = scoredPatterns[0].patternRef;
        for (const sp of scoredPatterns) {
          if (sp.score > bestScore) {
            bestScore = sp.score;
            expectedRef = sp.patternRef;
          }
        }
        assertAnalysis(
          expectedRef === record.selectedPatternRef,
          `Argmax mismatch at match ${mIdx} step ${stepCount}: expected ${expectedRef}, got ${record.selectedPatternRef}`
        );

        const selectedPat = request.patterns[record.selectedPatternRef];
        const isPassChosen = record.selectedPatternKind === "PASS";

        // PASS パターンの特定
        const passIndex = request.patterns.findIndex((p) => p.kind === "PASS");
        const hasPass = passIndex >= 0;
        const passScore = hasPass ? scoredPatterns[passIndex].score : undefined;

        // action.end パターンの特定
        const endIndex = request.patterns.findIndex(
          (p) =>
            p.kind === "ACTION" &&
            p.actionSelectionRef !== undefined &&
            request.catalog?.actions?.[p.actionSelectionRef]?.actionId === "action.end"
        );
        const hasEndAction = endIndex >= 0;
        const endScore = hasEndAction ? scoredPatterns[endIndex].score : undefined;

        // 非PASS最善手の特定
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

        // PASS 選択時の分類
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

        // 差分分解: PASS vs bestNonPass
        let marginBestNonPass: number | undefined;
        let bestNonPassMarginCause: "PASS_UPLIFT" | "NONPASS_SUPPRESSION" | "MIXED_EFFECT" | "TIE_BREAK" | undefined;
        let topContributorsToBestNonPass: GeneDeltaContribution[] | undefined;

        if (hasPass && bestNonPass && passScore !== undefined) {
          marginBestNonPass = passScore - bestNonPass.score;
          if (Math.abs(marginBestNonPass) < 1e-9) {
            bestNonPassMarginCause = "TIE_BREAK";
          } else if (passScore > 0 && bestNonPass.score <= 0) {
            bestNonPassMarginCause = "PASS_UPLIFT";
          } else if (passScore <= 0 && bestNonPass.score < 0) {
            bestNonPassMarginCause = "NONPASS_SUPPRESSION";
          } else {
            bestNonPassMarginCause = "MIXED_EFFECT";
          }

          if (!isElite && currentDna.patternWeights.length > 0) {
            const decomp = decomposeScoreDelta(
              encodedFeatures.context.values,
              encodedFeatures.patterns[passIndex].values,
              encodedFeatures.patterns[bestNonPass.patternRef].values,
              currentDna
            );
            assertAnalysis(decomp.conservationVerified, "Conservation violated in pass vs bestNonPass");
            topContributorsToBestNonPass = decomp.contributions.slice(0, 5);
          }
        }

        // 差分分解: PASS vs action.end
        let marginEnd: number | undefined;
        let endMarginCause: "PASS_UPLIFT" | "NONPASS_SUPPRESSION" | "MIXED_EFFECT" | "TIE_BREAK" | undefined;
        let topContributorsToEnd: GeneDeltaContribution[] | undefined;

        if (hasPass && hasEndAction && passScore !== undefined && endScore !== undefined) {
          marginEnd = passScore - endScore;
          if (Math.abs(marginEnd) < 1e-9) {
            endMarginCause = "TIE_BREAK";
          } else if (passScore > 0 && endScore <= 0) {
            endMarginCause = "PASS_UPLIFT";
          } else if (passScore <= 0 && endScore < 0) {
            endMarginCause = "NONPASS_SUPPRESSION";
          } else {
            endMarginCause = "MIXED_EFFECT";
          }

          if (!isElite && currentDna.patternWeights.length > 0) {
            const decomp = decomposeScoreDelta(
              encodedFeatures.context.values,
              encodedFeatures.patterns[passIndex].values,
              encodedFeatures.patterns[endIndex].values,
              currentDna
            );
            assertAnalysis(decomp.conservationVerified, "Conservation violated in pass vs end");
            topContributorsToEnd = decomp.contributions.slice(0, 5);
          }
        }

        // Context 特徴量の注目値サンプル
        const cVals = encodedFeatures.context.values;
        const contextValuesSample = {
          turnCount: cVals[CONTEXT_FEATURE_NAMES.indexOf("turn_count")] ?? 0,
          stageDepth: cVals[CONTEXT_FEATURE_NAMES.indexOf("stage_depth")] ?? 0,
          selfIsTurnPlayer: cVals[CONTEXT_FEATURE_NAMES.indexOf("self_is_turn_player")] ?? 0,
          sourceIsActionRequest: cVals[CONTEXT_FEATURE_NAMES.indexOf("source_is_action_request")] ?? 0,
          legalPatternCount: cVals[CONTEXT_FEATURE_NAMES.indexOf("legal_pattern_count")] ?? 0,
          selfHandCount: cVals[CONTEXT_FEATURE_NAMES.indexOf("self_hand_count")] ?? 0,
          selfLifeCount: cVals[CONTEXT_FEATURE_NAMES.indexOf("self_life_count")] ?? 0,
        };

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
          endMarginCause,
          topContributorsToEnd,
          hasNonPass,
          bestNonPassPatternRef: bestNonPass?.patternRef,
          bestNonPassKind: bestNonPass?.kind,
          bestNonPassActionId,
          bestNonPassScore: bestNonPass?.score,
          marginBestNonPass,
          bestNonPassMarginCause,
          topContributorsToBestNonPass,
          contextValuesSample,
        };

        allDecisionRecords.push(rec);

        // 凍結リクエストの記録 (個体がPASSを選び、かつ非PASSが存在した手)
        matchRequestsList.push({
          stepCount,
          playerId: decisionPlayer,
          genomeId: currentGenomeId,
          request,
          selectedPatternRef: record.selectedPatternRef,
          isPassChosen,
          hasNonPass,
        });
      },
    });

    matchResults.push(simResult);
    recordedMatchRequests.set(mIdx, matchRequestsList);

    if (simResult.completed) {
      completedMatchIndices.push(mIdx);
    } else {
      incompleteMatchIndices.push(mIdx);
    }
  }

  assertAnalysis(completedMatchIndices.length === 2, `Expected 2 completed matches, got ${completedMatchIndices.length}`);
  assertAnalysis(incompleteMatchIndices.length === 28, `Expected 28 incomplete matches, got ${incompleteMatchIndices.length}`);
  console.log(`  - 30 Matches Finished: 2 COMPLETED (Indices: ${completedMatchIndices.join(", ")}), 28 INCOMPLETE`);

  // 6. 28未完了対戦の集計と原因分析
  console.log("\n[5/7] Aggregating Scores & Identifying Top Contributor Genes...");

  const incompleteRecords = allDecisionRecords.filter((r) => incompleteMatchIndices.includes(r.matchIndex));
  const offspringIncompleteRecords = incompleteRecords.filter((r) => !r.isElite);

  // PASS 決定内訳
  let totalIncompleteDecisions = incompleteRecords.length;
  let totalPassDecisions = 0;
  let forcedPassCount = 0;
  let strictPassWinCount = 0;
  let tieBreakPassCount = 0;

  // Offspring に限定した集計
  let offspringTotalDecisions = offspringIncompleteRecords.length;
  let offspringPassCount = 0;
  let offspringForcedPass = 0;
  let offspringStrictPassWin = 0;
  let offspringTieBreakPass = 0;

  // スコア統計用配列
  const passScoresWithNonPass: number[] = [];
  const bestNonPassScores: number[] = [];
  const marginsBestNonPass: number[] = [];

  const passScoresWithEnd: number[] = [];
  const endScores: number[] = [];
  const marginsEnd: number[] = [];

  const marginCauseCounts: Record<string, number> = {
    PASS_UPLIFT: 0,
    NONPASS_SUPPRESSION: 0,
    MIXED_EFFECT: 0,
    TIE_BREAK: 0,
  };

  const endMarginCauseCounts: Record<string, number> = {
    PASS_UPLIFT: 0,
    NONPASS_SUPPRESSION: 0,
    MIXED_EFFECT: 0,
    TIE_BREAK: 0,
  };

  // 全体累積遺伝子寄与度マップ (Offspring の非ゼロ遺伝子のみ)
  const cumulativeDeltaBestNonPass = new Map<
    string,
    {
      gene: DnaGeneCoordinate;
      cumulativeDelta: number;
      decisionCount: number;
      maxSingleDelta: number;
      deltas: number[];
      contextVals: number[];
      patternDiffs: number[];
      directionCounts: Record<string, number>;
    }
  >();

  const cumulativeDeltaEnd = new Map<
    string,
    {
      gene: DnaGeneCoordinate;
      cumulativeDelta: number;
      decisionCount: number;
      maxSingleDelta: number;
      deltas: number[];
      contextVals: number[];
      patternDiffs: number[];
      directionCounts: Record<string, number>;
    }
  >();

  for (const r of incompleteRecords) {
    if (r.isPassChosen) {
      totalPassDecisions++;
      if (r.passCategory === "FORCED_PASS") forcedPassCount++;
      else if (r.passCategory === "STRICT_PASS_WIN") strictPassWinCount++;
      else if (r.passCategory === "TIE_BREAK_PASS") tieBreakPassCount++;
    }

    if (!r.isElite) {
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
        if (r.bestNonPassMarginCause) {
          marginCauseCounts[r.bestNonPassMarginCause] = (marginCauseCounts[r.bestNonPassMarginCause] ?? 0) + 1;
        }

        // 差分分解寄与度の累積 (PASS vs bestNonPass)
        if (r.topContributorsToBestNonPass) {
          for (const c of r.topContributorsToBestNonPass) {
            if (c.deltaContrib <= 0) continue; // 正の寄与（PASSを優位にした寄与）のみ追跡
            const existing = cumulativeDeltaBestNonPass.get(c.geneId) ?? {
              gene: {
                id: c.geneId,
                type: c.type,
                patternIndex: PATTERN_FEATURE_NAMES.indexOf(c.patternFeatureName as any),
                patternFeatureName: c.patternFeatureName,
                contextFeatureName: c.contextFeatureName,
                weight: c.weight,
              },
              cumulativeDelta: 0,
              decisionCount: 0,
              maxSingleDelta: -Infinity,
              deltas: [],
              contextVals: [],
              patternDiffs: [],
              directionCounts: {},
            };
            existing.cumulativeDelta += c.deltaContrib;
            existing.decisionCount++;
            if (c.deltaContrib > existing.maxSingleDelta) existing.maxSingleDelta = c.deltaContrib;
            existing.deltas.push(c.deltaContrib);
            existing.contextVals.push(c.contextValue);
            existing.patternDiffs.push(c.patternDiff);
            existing.directionCounts[c.direction] = (existing.directionCounts[c.direction] ?? 0) + 1;
            cumulativeDeltaBestNonPass.set(c.geneId, existing);
          }
        }
      }

      if (r.isPassChosen && r.hasEndAction && r.passScore !== undefined && r.endScore !== undefined) {
        passScoresWithEnd.push(r.passScore);
        endScores.push(r.endScore);
        marginsEnd.push(r.marginEnd!);
        if (r.endMarginCause) {
          endMarginCauseCounts[r.endMarginCause] = (endMarginCauseCounts[r.endMarginCause] ?? 0) + 1;
        }

        // 差分分解寄与度の累積 (PASS vs action.end)
        if (r.topContributorsToEnd) {
          for (const c of r.topContributorsToEnd) {
            if (c.deltaContrib <= 0) continue;
            const existing = cumulativeDeltaEnd.get(c.geneId) ?? {
              gene: {
                id: c.geneId,
                type: c.type,
                patternIndex: PATTERN_FEATURE_NAMES.indexOf(c.patternFeatureName as any),
                patternFeatureName: c.patternFeatureName,
                contextFeatureName: c.contextFeatureName,
                weight: c.weight,
              },
              cumulativeDelta: 0,
              decisionCount: 0,
              maxSingleDelta: -Infinity,
              deltas: [],
              contextVals: [],
              patternDiffs: [],
              directionCounts: {},
            };
            existing.cumulativeDelta += c.deltaContrib;
            existing.decisionCount++;
            if (c.deltaContrib > existing.maxSingleDelta) existing.maxSingleDelta = c.deltaContrib;
            existing.deltas.push(c.deltaContrib);
            existing.contextVals.push(c.contextValue);
            existing.patternDiffs.push(c.patternDiff);
            existing.directionCounts[c.direction] = (existing.directionCounts[c.direction] ?? 0) + 1;
            cumulativeDeltaEnd.set(c.geneId, existing);
          }
        }
      }
    }
  }

  // 平均・最小・最大ヘルパー
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

  // Top Contributor 遺伝子ランキング作成
  const sortedTopGenesBestNonPass: CumulativeGeneStat[] = Array.from(cumulativeDeltaBestNonPass.values())
    .sort((a, b) => b.cumulativeDelta - a.cumulativeDelta)
    .map((item) => {
      const dirCounts = item.directionCounts;
      let primaryDir: "PASS_UPLIFT" | "NONPASS_SUPPRESSION" | "MIXED_EFFECT" = "MIXED_EFFECT";
      let maxDCount = -1;
      for (const [dir, cnt] of Object.entries(dirCounts)) {
        if (cnt > maxDCount) {
          maxDCount = cnt;
          primaryDir = dir as any;
        }
      }
      const meanC = item.contextVals.reduce((a, b) => a + b, 0) / item.contextVals.length;
      const meanP = item.patternDiffs.reduce((a, b) => a + b, 0) / item.patternDiffs.length;

      return {
        geneId: item.gene.id,
        type: item.gene.type,
        weight: item.gene.weight,
        contextFeatureName: item.gene.contextFeatureName,
        patternFeatureName: item.gene.patternFeatureName,
        cumulativeDelta: item.cumulativeDelta,
        decisionCount: item.decisionCount,
        maxSingleDelta: item.maxSingleDelta,
        meanDelta: item.cumulativeDelta / item.decisionCount,
        typicalContextVal: meanC,
        typicalPatternDiff: meanP,
        primaryDirection: primaryDir,
      };
    });

  const sortedTopGenesEnd: CumulativeGeneStat[] = Array.from(cumulativeDeltaEnd.values())
    .sort((a, b) => b.cumulativeDelta - a.cumulativeDelta)
    .map((item) => {
      const dirCounts = item.directionCounts;
      let primaryDir: "PASS_UPLIFT" | "NONPASS_SUPPRESSION" | "MIXED_EFFECT" = "MIXED_EFFECT";
      let maxDCount = -1;
      for (const [dir, cnt] of Object.entries(dirCounts)) {
        if (cnt > maxDCount) {
          maxDCount = cnt;
          primaryDir = dir as any;
        }
      }
      const meanC = item.contextVals.reduce((a, b) => a + b, 0) / item.contextVals.length;
      const meanP = item.patternDiffs.reduce((a, b) => a + b, 0) / item.patternDiffs.length;

      return {
        geneId: item.gene.id,
        type: item.gene.type,
        weight: item.gene.weight,
        contextFeatureName: item.gene.contextFeatureName,
        patternFeatureName: item.gene.patternFeatureName,
        cumulativeDelta: item.cumulativeDelta,
        decisionCount: item.decisionCount,
        maxSingleDelta: item.maxSingleDelta,
        meanDelta: item.cumulativeDelta / item.decisionCount,
        typicalContextVal: meanC,
        typicalPatternDiff: meanP,
        primaryDirection: primaryDir,
      };
    });

  console.log(`  - Overall Stalling PASS decisions: ${offspringPassCount} (Strict Win: ${offspringStrictPassWin}, Tie-break: ${offspringTieBreakPass}, Forced: ${offspringForcedPass})`);
  console.log(`  - PASS vs bestNonPass: Mean margin = ${marginBestNonPassStats.mean.toFixed(4)} (PASS mean = ${passWithNonPassStats.mean.toFixed(4)}, bestNonPass mean = ${bestNonPassStats.mean.toFixed(4)})`);
  console.log(`  - PASS vs action.end:  Mean margin = ${marginEndStats.mean.toFixed(4)} (PASS mean = ${passWithEndStats.mean.toFixed(4)}, end mean = ${endStats.mean.toFixed(4)})`);
  console.log(`  - Margin Causes for bestNonPass: UPLIFT=${marginCauseCounts.PASS_UPLIFT}, SUPPRESSION=${marginCauseCounts.NONPASS_SUPPRESSION}, MIXED=${marginCauseCounts.MIXED_EFFECT}, TIE=${marginCauseCounts.TIE_BREAK}`);

  // 7. Pair 14 (Positive Control: offspring-000004 vs genome-001) の詳細分析
  console.log("\n[6/7] Analyzing Pair 14 Positive Control (Matches #28 & #29)...");
  const p14Leg0 = matchResults[28];
  const p14Leg1 = matchResults[29];

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
      finalTurn: records[records.length - 1]?.contextValuesSample.turnCount ?? 1,
    };
  };

  const p14Leg0Summary = analyzeCompletedMatch(p14Leg0Records, 28);
  const p14Leg1Summary = analyzeCompletedMatch(p14Leg1Records, 29);

  console.log(`  - Pair 14 Leg 0 (#28): totalDecisions=${p14Leg0Summary.totalDecisions}, PASS=${p14Leg0Summary.passCount}, END=${p14Leg0Summary.endCount}, finalTurn=${p14Leg0Summary.finalTurn}`);
  console.log(`  - Pair 14 Leg 1 (#29): totalDecisions=${p14Leg1Summary.totalDecisions}, PASS=${p14Leg1Summary.passCount}, END=${p14Leg1Summary.endCount}, finalTurn=${p14Leg1Summary.finalTurn}`);

  // 8. 個体別 Ablation 実験 (Offspring 0..3 vs genome-001 カノニカル対戦)
  console.log("\n[7/7] Executing Local & Trajectory Ablation Experiments...");

  // カノニカル対戦の対応関係 (Offspring 0..3 vs genome-001 Leg 0)
  const canonicalMatches = [
    { genomeId: "gen-000001-offspring-000000", matchIndex: 8, p1GenomeId: "gen-000001-offspring-000000", p2GenomeId: "genome-001" },
    { genomeId: "gen-000001-offspring-000001", matchIndex: 16, p1GenomeId: "gen-000001-offspring-000001", p2GenomeId: "genome-001" },
    { genomeId: "gen-000001-offspring-000002", matchIndex: 22, p1GenomeId: "gen-000001-offspring-000002", p2GenomeId: "genome-001" },
    { genomeId: "gen-000001-offspring-000003", matchIndex: 26, p1GenomeId: "gen-000001-offspring-000003", p2GenomeId: "genome-001" },
  ];

  const localAblationResults: LocalAblationResult[] = [];
  const trajectoryAblationResults: TrajectoryAblationResult[] = [];

  for (const cm of canonicalMatches) {
    const { genomeId, matchIndex, p1GenomeId, p2GenomeId } = cm;
    const originalDna = dnaMap.get(genomeId)!;
    const inv = inventoryMap.get(genomeId)!;

    // この対戦における該当代行リクエストの抽出 (個体がPASSを選び非PASSが合法的だった手)
    const matchReqs = recordedMatchRequests.get(matchIndex) ?? [];
    const stallingRequests = matchReqs.filter(
      (mr) => mr.genomeId === genomeId && mr.isPassChosen && mr.hasNonPass
    );

    // この対戦における累積差分寄与度を計算し、Top-1, Top-3, Top-5 遺伝子を決定
    const matchGeneDeltas = new Map<string, { gene: DnaGeneCoordinate; cumulativeDelta: number }>();
    const matchRecords = allDecisionRecords.filter((r) => r.matchIndex === matchIndex && r.genomeId === genomeId);

    for (const mr of matchRecords) {
      if (mr.isPassChosen && mr.topContributorsToBestNonPass) {
        for (const c of mr.topContributorsToBestNonPass) {
          if (c.deltaContrib <= 0) continue;
          const found = inv.genes.find((g) => g.id === c.geneId);
          if (found) {
            const cur = matchGeneDeltas.get(c.geneId) ?? { gene: found, cumulativeDelta: 0 };
            cur.cumulativeDelta += c.deltaContrib;
            matchGeneDeltas.set(c.geneId, cur);
          }
        }
      }
    }

    const sortedMatchGenes = Array.from(matchGeneDeltas.values())
      .sort((a, b) => b.cumulativeDelta - a.cumulativeDelta)
      .map((item) => item.gene);

    const top1 = sortedMatchGenes.slice(0, 1);
    const top3 = sortedMatchGenes.slice(0, 3);
    const top5 = sortedMatchGenes.slice(0, 5);

    // --- (A) Local Request Counterfactual Ablation ---
    const ablatedDnaTop1 = createAblatedDna(originalDna, top1);
    const ablatedDnaTop3 = createAblatedDna(originalDna, top3);
    const ablatedDnaTop5 = createAblatedDna(originalDna, top5);

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
      // Top 1
      const res1 = polTop1.choose(item.request);
      const pat1 = item.request.patterns[res1.selectedPatternRef];
      if (pat1?.kind !== "PASS") {
        flipsTop1++;
        const actId = pat1?.actionSelectionRef !== undefined
          ? item.request.catalog?.actions?.[pat1.actionSelectionRef]?.actionId ?? pat1.kind
          : pat1.kind;
        actDistTop1[actId] = (actDistTop1[actId] ?? 0) + 1;
      }

      // Top 3
      const res3 = polTop3.choose(item.request);
      const pat3 = item.request.patterns[res3.selectedPatternRef];
      if (pat3?.kind !== "PASS") {
        flipsTop3++;
        const actId = pat3?.actionSelectionRef !== undefined
          ? item.request.catalog?.actions?.[pat3.actionSelectionRef]?.actionId ?? pat3.kind
          : pat3.kind;
        actDistTop3[actId] = (actDistTop3[actId] ?? 0) + 1;
      }

      // Top 5
      const res5 = polTop5.choose(item.request);
      const pat5 = item.request.patterns[res5.selectedPatternRef];
      if (pat5?.kind !== "PASS") {
        flipsTop5++;
        const actId = pat5?.actionSelectionRef !== undefined
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
      top1Genes: top1.map((g) => g.id),
      top3Genes: top3.map((g) => g.id),
      top5Genes: top5.map((g) => g.id),
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
      genes: DnaGeneCoordinate[];
    }> = [
      { level: "BASELINE_TOP0", dna: originalDna, genes: [] },
      { level: "TOP1_ZEROED", dna: ablatedDnaTop1, genes: top1 },
      { level: "TOP3_ZEROED", dna: ablatedDnaTop3, genes: top3 },
      { level: "TOP5_ZEROED", dna: ablatedDnaTop5, genes: top5 },
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
        ablatedGenes: lvl.genes.map((g) => g.id),
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

  // 9. 構造化レポートの構築
  const finalReport = {
    workId: "BP-SIM-AI-DNA-PASS-SCORE-ANALYSIS-V1",
    timestamp: new Date().toISOString(),
    nodeVersion: process.version,
    dimensions: {
      contextDimension: DNA_CONTEXT_DIMENSION,
      patternDimension: DNA_PATTERN_DIMENSION,
      interactionDimension: DNA_INTERACTION_DIMENSION,
      totalWeights: DNA_TOTAL_WEIGHTS,
    },
    dnaInventory: Array.from(inventoryMap.values()).map((inv) => ({
      genomeId: inv.genomeId,
      isZeroDNA: inv.isZeroDNA,
      totalWeights: inv.totalWeights,
      nonZeroCount: inv.nonZeroCount,
      nonZeroPatternCount: inv.nonZeroPatternCount,
      nonZeroInteractionCount: inv.nonZeroInteractionCount,
      topSampleGenes: inv.genes.slice(0, 5),
    })),
    incompleteMatchSummary: {
      totalIncompleteMatches: incompleteMatchIndices.length,
      totalIncompleteDecisions,
      totalPassDecisions,
      passRatioOverall: totalPassDecisions / totalIncompleteDecisions,
      passCategoryBreakdownOverall: {
        forcedPassCount,
        strictPassWinCount,
        tieBreakPassCount,
        strictPassWinRatio: strictPassWinCount / totalPassDecisions,
        tieBreakPassRatio: tieBreakPassCount / totalPassDecisions,
        forcedPassRatio: forcedPassCount / totalPassDecisions,
      },
      offspringOnly: {
        totalDecisions: offspringTotalDecisions,
        passCount: offspringPassCount,
        passRatio: offspringPassCount / offspringTotalDecisions,
        forcedPass: offspringForcedPass,
        strictPassWin: offspringStrictPassWin,
        tieBreakPass: offspringTieBreakPass,
        strictPassWinRatio: offspringStrictPassWin / offspringPassCount,
        tieBreakPassRatio: offspringTieBreakPass / offspringPassCount,
        forcedPassRatio: offspringForcedPass / offspringPassCount,
      },
    },
    scoreStatistics: {
      passVsBestNonPass: {
        passStats: passWithNonPassStats,
        bestNonPassStats,
        marginStats: marginBestNonPassStats,
        causeDistribution: marginCauseCounts,
        causeRatios: {
          passUpliftRatio: marginCauseCounts.PASS_UPLIFT / (passWithNonPassStats.count || 1),
          nonPassSuppressionRatio: marginCauseCounts.NONPASS_SUPPRESSION / (passWithNonPassStats.count || 1),
          mixedEffectRatio: marginCauseCounts.MIXED_EFFECT / (passWithNonPassStats.count || 1),
          tieBreakRatio: marginCauseCounts.TIE_BREAK / (passWithNonPassStats.count || 1),
        },
      },
      passVsActionEnd: {
        passStats: passWithEndStats,
        endStats,
        marginStats: marginEndStats,
        causeDistribution: endMarginCauseCounts,
        causeRatios: {
          passUpliftRatio: endMarginCauseCounts.PASS_UPLIFT / (passWithEndStats.count || 1),
          nonPassSuppressionRatio: endMarginCauseCounts.NONPASS_SUPPRESSION / (passWithEndStats.count || 1),
          mixedEffectRatio: endMarginCauseCounts.MIXED_EFFECT / (passWithEndStats.count || 1),
          tieBreakRatio: endMarginCauseCounts.TIE_BREAK / (passWithEndStats.count || 1),
        },
      },
    },
    topContributorsOverall: {
      toBestNonPass: sortedTopGenesBestNonPass.slice(0, 15),
      toActionEnd: sortedTopGenesEnd.slice(0, 15),
    },
    pair14PositiveControl: {
      leg0: p14Leg0Summary,
      leg1: p14Leg1Summary,
    },
    ablationExperiments: {
      localAblation: localAblationResults,
      trajectoryAblation: trajectoryAblationResults,
    },
  };

  const elapsedMs = Date.now() - startTime;
  console.log("\n================================================================================");
  console.log("  ANALYSIS COMPLETED SUCCESSFULLY");
  console.log(`  Elapsed Time: ${elapsedMs} ms (${(elapsedMs / 1000).toFixed(2)} s)`);
  console.log("================================================================================");

  console.log("\n--- STRUCTURED ANALYSIS JSON ---");
  console.log(JSON.stringify(finalReport, null, 2));
  console.log("--- END STRUCTURED ANALYSIS JSON ---");

  const outPath = path.resolve(__dirname, "../../docs/ai-evolution-dna-pass-score-analysis-v1.json");
  fs.writeFileSync(outPath, JSON.stringify(finalReport, null, 2), "utf-8");
  console.log(`\n  Report artifact written to: ${outPath}`);

  return finalReport;
}

runPassScoreAnalysis().catch((err) => {
  console.error("FATAL ANALYSIS ERROR:", err);
  process.exit(1);
});
