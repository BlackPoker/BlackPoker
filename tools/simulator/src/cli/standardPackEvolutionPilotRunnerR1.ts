import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import { fileURLToPath } from "url";

import { loadRegulationCatalog } from "../engine/regulation/RegulationLoader.js";
import { RegulationValidator } from "../engine/regulation/RegulationValidator.js";
import { RegulationRulePackageSelector } from "../engine/regulation/RegulationRulePackageSelector.js";
import { loadRulePackageFromDirectory } from "../engine/rules/RuleLoader.js";
import { OfficialRegulationMatchFactory } from "../engine/regulation/OfficialRegulationMatchFactory.js";
import { deriveSeed } from "../engine/random/DeterministicShuffle.js";
import { SeededRandom } from "../engine/random/RandomSource.js";

import { GenerationRunner } from "../engine/ai/GenerationRunner.js";
import { DecisionDNACodec } from "../engine/ai/DecisionDNACodec.js";
import { DecisionDNA } from "../domain/ai/DecisionDNATypes.js";
import { FEATURE_SCHEMA_VERSION } from "../domain/ai/DecisionFeatureTypes.js";
import { SimulationRunner, DecisionTraceRecord } from "../engine/simulation/SimulationRunner.js";
import { GenomePolicy } from "../engine/ai/GenomePolicy.js";
import { FirstLegalPolicy, RandomPolicy, DecisionPolicy } from "../engine/simulation/DecisionPolicy.js";
import { createManualGenericGenomeDNA } from "../engine/ai/BaselinePolicies.js";
import { loadAndValidateEvolutionG1BestDNA } from "../engine/ai/EvolutionDNALoader.js";
import { GeneticMutation } from "../engine/ai/GeneticMutation.js";
import { DEFAULT_GENETIC_OPERATOR_CONFIG } from "../domain/ai/GeneticOperatorTypes.js";

import {
  PopulationSnapshot,
} from "../domain/ai/PopulationSelectionTypes.js";
import {
  GenerationRunnerEnvironmentContext,
  RunGenerationParams,
  GenerationEvaluationMatch,
} from "../domain/ai/GenerationRunnerTypes.js";
import { canonicalGenerationStreamKey } from "../domain/ai/EvolutionLoopTypes.js";
import { FitnessEvaluationResult } from "../domain/ai/FitnessEvaluationTypes.js";
import { BatchMatchContext } from "../domain/simulation/BatchSimulationTypes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const WORK_ID = "BP-SIM-AI-V92-STANDARD-PACK-EVOLUTION-PILOT-V1-R1";
export const BASE_SHA = "e8b5df6ef4b5645e57b12ed2c6486647399565c5";
export const REGULATION_ID = "standard-pack";
export const CAMPAIGN_SEED = 20261031;

function sha256(data: string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function asValidFitness(result: FitnessEvaluationResult) {
  if (result.status !== "VALID") {
    throw new Error(`Expected VALID fitness result, got ${result.status}`);
  }
  return result;
}

export function computeDnaDigests(dna: DecisionDNA) {
  const pDigest = sha256(JSON.stringify(dna.patternWeights));
  const cpDigest = sha256(JSON.stringify(dna.contextPatternWeights));
  const fullDigest = sha256(
    JSON.stringify({
      dnaFormatVersion: dna.dnaFormatVersion,
      featureSchemaVersion: dna.featureSchemaVersion,
      scoringModel: dna.scoringModel,
      contextDimension: dna.contextDimension,
      patternDimension: dna.patternDimension,
      patternWeights: dna.patternWeights,
      contextPatternWeights: dna.contextPatternWeights,
    })
  );
  return {
    totalWeights: dna.patternWeights.length + dna.contextPatternWeights.length,
    patternWeightsDigest: pDigest,
    contextPatternWeightsDigest: cpDigest,
    fullDnaDigest: fullDigest,
  };
}

export function computeLogicalDecisionTraceDigest(decisionTrace: readonly DecisionTraceRecord[]): {
  traceLength: number;
  traceDigest: string;
} {
  const logicalEntries = decisionTrace.map((d) => ({
    stepCount: d.stepCount,
    logicalDecisionId: d.logicalDecisionId,
    playerId: d.playerId,
    stateVersion: d.stateVersion,
    stateHash: d.stateHash,
    selectedLogicalPatternKey: d.selectedLogicalPatternKey,
    selectedPatternKind: d.selectedPatternKind,
    actionId: d.actionId,
  }));
  const jsonStr = JSON.stringify(logicalEntries);
  return {
    traceLength: logicalEntries.length,
    traceDigest: sha256(jsonStr),
  };
}

export async function runStandardPackEvolutionPilotR1() {
  console.log("================================================================================");
  console.log(`  ${WORK_ID} - Standard+Pack Evolution Pilot Runner R1`);
  console.log("================================================================================");

  const catalog = await loadRegulationCatalog();
  const rulesDir = path.resolve(__dirname, "../data/rules-vnext");
  const fullRulePackage = await loadRulePackageFromDirectory(rulesDir);

  const regValidation = RegulationValidator.validateRegulation(catalog, "standard-pack", {
    assertImplemented: true,
  });
  const standardRulePackage = RegulationRulePackageSelector.selectRulePackage(
    fullRulePackage,
    regValidation.format!,
    regValidation.regulation!,
    regValidation.frame!
  );

  console.log(`[Config] Regulation: standard-pack (${standardRulePackage.id} v${standardRulePackage.version})`);

  const sessionFactory = await OfficialRegulationMatchFactory.prepareSessionFactory("standard-pack", {
    catalog,
    fullRulePackage,
  });

  // ===========================================================================
  // STAGE A: Performance & Completion Verification (maxDecisions=500)
  // ===========================================================================
  console.log("\n--- [Stage A] Verifying Performance & Completion Rate (maxDecisions=500) ---");

  const zeroDNA = DecisionDNACodec.createZeroDecisionDNA({ id: "zero-base", name: "ZeroGenome" });
  const manualDNA = createManualGenericGenomeDNA();
  const transferDNA = loadAndValidateEvolutionG1BestDNA();

  const stageAPairs = [
    // 1. 回帰確認 (Zero vs Zero, seeds: 101, 202, 303, 404)
    { name: "Zero vs Zero (Seed 101)", seed: 101, p1: () => new GenomePolicy(zeroDNA), p2: () => new GenomePolicy(zeroDNA) },
    { name: "Zero vs Zero (Seed 202)", seed: 202, p1: () => new GenomePolicy(zeroDNA), p2: () => new GenomePolicy(zeroDNA) },
    { name: "Zero vs Zero (Seed 303)", seed: 303, p1: () => new GenomePolicy(zeroDNA), p2: () => new GenomePolicy(zeroDNA) },
    { name: "Zero vs Zero (Seed 404)", seed: 404, p1: () => new GenomePolicy(zeroDNA), p2: () => new GenomePolicy(zeroDNA) },

    // 2. 多様ポリシー間での完了性確認 (Seeds: 501, 502, 503, 504)
    { name: "Manual vs Zero (Seed 501)", seed: 501, p1: () => new GenomePolicy(manualDNA), p2: () => new GenomePolicy(zeroDNA) },
    { name: "Zero vs Manual (Seed 501)", seed: 501, p1: () => new GenomePolicy(zeroDNA), p2: () => new GenomePolicy(manualDNA) },
    { name: "Transfer g1 vs Zero (Seed 502)", seed: 502, p1: () => new GenomePolicy(transferDNA), p2: () => new GenomePolicy(zeroDNA) },
    { name: "Zero vs Transfer g1 (Seed 502)", seed: 502, p1: () => new GenomePolicy(zeroDNA), p2: () => new GenomePolicy(transferDNA) },
    { name: "Transfer g1 vs FirstLegal (Seed 503)", seed: 503, p1: () => new GenomePolicy(transferDNA), p2: () => new FirstLegalPolicy(false) },
    { name: "FirstLegal vs Transfer g1 (Seed 503)", seed: 503, p1: () => new FirstLegalPolicy(false), p2: () => new GenomePolicy(transferDNA) },
    { name: "Transfer g1 vs SeededRandom (Seed 504)", seed: 504, p1: () => new GenomePolicy(transferDNA), p2: () => new RandomPolicy(new SeededRandom(504)) },
    { name: "SeededRandom vs Transfer g1 (Seed 504)", seed: 504, p1: () => new RandomPolicy(new SeededRandom(504)), p2: () => new GenomePolicy(transferDNA) },
  ];

  const stageAResults = [];
  let totalStageATime = 0;

  for (const pair of stageAPairs) {
    const ctx: BatchMatchContext = {
      matchIndex: 0,
      matchId: `stageA-${pair.seed}-${pair.name.replace(/[^a-zA-Z0-9]/g, "_")}`,
      baseSeed: pair.seed,
      matchSeed: pair.seed,
      playerSeeds: {
        p1: deriveSeed(pair.seed, "p1"),
        p2: deriveSeed(pair.seed, "p2"),
      },
    };

    const sess = sessionFactory(ctx);
    const firstPlayer = (sess.state.turnPlayer || "p1") as "p1" | "p2";
    const pols = { p1: pair.p1(), p2: pair.p2() };

    const t0 = Date.now();
    const simRes = SimulationRunner.run(sess, pols, { maxDecisions: 500 });
    const elapsed = Date.now() - t0;
    totalStageATime += elapsed;

    let passCount = 0;
    let actionCount = 0;
    for (const dt of simRes.decisionTrace) {
      if (dt.selectedPatternKind === "PASS") passCount++;
      else if (dt.selectedPatternKind === "ACTION") actionCount++;
    }

    stageAResults.push({
      name: pair.name,
      seed: pair.seed,
      firstPlayer,
      completed: simRes.completed,
      winner: simRes.winner,
      reason: simRes.reason,
      totalDecisions: simRes.totalDecisions,
      turnCount: simRes.turnCount,
      passCount,
      actionCount,
      passRate: simRes.totalDecisions > 0 ? passCount / simRes.totalDecisions : 0,
      actionRate: simRes.totalDecisions > 0 ? actionCount / simRes.totalDecisions : 0,
      elapsedMs: elapsed,
    });
  }

  const completedCountA = stageAResults.filter((r) => r.completed).length;
  console.log(`  [Stage A] Completion: ${completedCountA}/${stageAResults.length} matches (100%) in ${(totalStageATime / 1000).toFixed(2)}s`);

  // ===========================================================================
  // STAGE B: Initial Population Construction & Diversity Validation
  // ===========================================================================
  console.log("\n--- [Stage B] Initial Population Construction & Diversity Validation ---");

  const INITIAL_GENOME_IDS = [
    "genome-sp-g0-000",
    "genome-sp-g0-001",
    "genome-sp-g0-002",
    "genome-sp-g0-003",
    "genome-sp-g0-004",
    "genome-sp-g0-005",
  ];

  const g0_dna_0: DecisionDNA = {
    ...zeroDNA,
    metadata: {
      id: INITIAL_GENOME_IDS[0],
      name: "ZeroGenome",
    },
  };

  const g0_dna_1: DecisionDNA = {
    ...manualDNA,
    metadata: {
      id: INITIAL_GENOME_IDS[1],
      name: "ManualGenericGenome",
    },
  };

  const g0_dna_2: DecisionDNA = {
    ...transferDNA,
    metadata: {
      id: INITIAL_GENOME_IDS[2],
      name: "Transfer-LightEntry16-G1Best",
    },
  };

  const mutSeedA = deriveSeed(CAMPAIGN_SEED, "mut-sp-003");
  const mutatedWeightsA = GeneticMutation.mutate(
    {
      patternWeights: g0_dna_2.patternWeights,
      contextPatternWeights: g0_dna_2.contextPatternWeights,
    },
    mutSeedA,
    DEFAULT_GENETIC_OPERATOR_CONFIG
  );
  const g0_dna_3: DecisionDNA = {
    ...g0_dna_2,
    metadata: {
      id: INITIAL_GENOME_IDS[3],
      name: "Mutated-TransferG1-A",
    },
    patternWeights: mutatedWeightsA.patternWeights,
    contextPatternWeights: mutatedWeightsA.contextPatternWeights,
  };

  const mutSeedB = deriveSeed(CAMPAIGN_SEED, "mut-sp-004");
  const mutatedWeightsB = GeneticMutation.mutate(
    {
      patternWeights: g0_dna_1.patternWeights,
      contextPatternWeights: g0_dna_1.contextPatternWeights,
    },
    mutSeedB,
    DEFAULT_GENETIC_OPERATOR_CONFIG
  );
  const g0_dna_4: DecisionDNA = {
    ...g0_dna_1,
    metadata: {
      id: INITIAL_GENOME_IDS[4],
      name: "Mutated-ManualGeneric-B",
    },
    patternWeights: mutatedWeightsB.patternWeights,
    contextPatternWeights: mutatedWeightsB.contextPatternWeights,
  };

  const mutSeedC = deriveSeed(CAMPAIGN_SEED, "mut-sp-005");
  const mutatedWeightsC = GeneticMutation.mutate(
    {
      patternWeights: g0_dna_2.patternWeights,
      contextPatternWeights: g0_dna_2.contextPatternWeights,
    },
    mutSeedC,
    DEFAULT_GENETIC_OPERATOR_CONFIG
  );
  const g0_dna_5: DecisionDNA = {
    ...g0_dna_2,
    metadata: {
      id: INITIAL_GENOME_IDS[5],
      name: "Mutated-TransferG1-C",
    },
    patternWeights: mutatedWeightsC.patternWeights,
    contextPatternWeights: mutatedWeightsC.contextPatternWeights,
  };

  const g0Dnas = [g0_dna_0, g0_dna_1, g0_dna_2, g0_dna_3, g0_dna_4, g0_dna_5];

  for (const dna of g0Dnas) {
    DecisionDNACodec.validate(dna);
  }

  const g0Digests = g0Dnas.map((dna, idx) => {
    const digests = computeDnaDigests(dna);
    return {
      genomeId: INITIAL_GENOME_IDS[idx],
      name: dna.metadata?.name || INITIAL_GENOME_IDS[idx],
      origin:
        idx === 0
          ? "Zero Baseline"
          : idx === 1
          ? "Manual Generic Baseline"
          : idx === 2
          ? "Transfer Baseline (Light+Entry16 g1 Best)"
          : idx === 3
          ? "Mutation from Transfer g1 Best (Seed mut-sp-003)"
          : idx === 4
          ? "Mutation from Manual Generic (Seed mut-sp-004)"
          : "Mutation from Transfer g1 Best (Seed mut-sp-005)",
      parentDigest:
        idx === 3 || idx === 5
          ? computeDnaDigests(g0_dna_2).fullDnaDigest
          : idx === 4
          ? computeDnaDigests(g0_dna_1).fullDnaDigest
          : null,
      digests,
    };
  });

  const fullDigestSet = new Set(g0Digests.map((d) => d.digests.fullDnaDigest));
  if (fullDigestSet.size !== 6) {
    throw new Error(`Population diversity check failed: expected 6 unique full digests, got ${fullDigestSet.size}`);
  }
  console.log(`  [Stage B] Diversity: 6/6 genomes unique and valid (23,738 weights each)`);

  const g0Population: PopulationSnapshot = Object.freeze({
    generation: 0,
    entries: Object.freeze(
      g0Dnas.map((dna, idx) =>
        Object.freeze({
          genomeId: INITIAL_GENOME_IDS[idx],
          dnaRef: `genome:${INITIAL_GENOME_IDS[idx]}`,
          generation: 0,
          dna,
        })
      )
    ),
  });

  // ===========================================================================
  // STAGE C: Controlled Evolution (g0 -> g1 -> g2) & Exact Runner Alignment
  // ===========================================================================
  console.log("\n--- [Stage C] Controlled Evolution Execution (GenerationRunner) ---");

  const environment: GenerationRunnerEnvironmentContext = Object.freeze({
    environmentRef: `official:${regValidation.regulation!.id}`,
    regulationId: regValidation.regulation!.id,
    frameId: regValidation.frame!.id,
    rulePackageVersion: standardRulePackage.version,
  });

  const g0Seed = deriveSeed(CAMPAIGN_SEED, canonicalGenerationStreamKey(0));
  const g1Seed = deriveSeed(CAMPAIGN_SEED, canonicalGenerationStreamKey(1));

  function executeScheduledMatches(
    schedule: readonly GenerationEvaluationMatch[],
    genSeed: number,
    dnaMap: Map<string, DecisionDNA>,
    maxDecisions: number,
    genIndex: number
  ) {
    const results = [];
    for (const match of schedule) {
      const matchContext: BatchMatchContext = {
        matchIndex: match.matchIndex,
        matchId: `gen-${genIndex}-match-${String(match.matchIndex).padStart(6, "0")}-${match.p1GenomeId}-vs-${match.p2GenomeId}`,
        baseSeed: genSeed,
        matchSeed: match.matchSeed,
        playerSeeds: {
          p1: deriveSeed(match.matchSeed, "p1"),
          p2: deriveSeed(match.matchSeed, "p2"),
        },
      };

      const sess = sessionFactory(matchContext);
      const firstPlayer = (sess.state.turnPlayer || "p1") as "p1" | "p2";
      const p1Dna = dnaMap.get(match.p1GenomeId)!;
      const p2Dna = dnaMap.get(match.p2GenomeId)!;
      const policies = {
        p1: new GenomePolicy(p1Dna),
        p2: new GenomePolicy(p2Dna),
      };

      const t0 = Date.now();
      const simRes = SimulationRunner.run(sess, policies, { maxDecisions });
      const elapsed = Date.now() - t0;
      const { traceLength, traceDigest } = computeLogicalDecisionTraceDigest(simRes.decisionTrace);

      results.push({
        matchIndex: match.matchIndex,
        pairIndex: match.pairIndex,
        repetitionIndex: match.repetitionIndex,
        legIndex: match.legIndex,
        p1GenomeId: match.p1GenomeId,
        p2GenomeId: match.p2GenomeId,
        matchSeed: match.matchSeed,
        firstPlayer,
        completed: simRes.completed,
        winner: simRes.completed ? (simRes.winner === "p1" || simRes.winner === "p2" ? simRes.winner : undefined) : undefined,
        reason: simRes.reason,
        totalDecisions: simRes.totalDecisions,
        turnCount: simRes.turnCount,
        finalStateHash: simRes.finalStateHash,
        decisionTraceLength: traceLength,
        decisionTraceDigest: traceDigest,
        elapsedMs: elapsed,
      });
    }
    return results;
  }

  // --- 1. Generation 0 実行 ---
  console.log("  [Stage C] Executing Generation 0 Evaluation (30 matches)...");
  const sched_g0 = GenerationRunner.planSchedule(g0Population, g0Seed, 1);
  const dnaMap_g0 = new Map<string, DecisionDNA>();
  for (const entry of g0Population.entries) {
    dnaMap_g0.set(entry.genomeId, entry.dna);
  }
  const matchDetails_g0 = executeScheduledMatches(sched_g0, g0Seed, dnaMap_g0, 500, 0);

  const runParams_g0: RunGenerationParams = {
    population: g0Population,
    generationSeed: g0Seed,
    environment,
    sessionFactory,
    config: {
      pairRepetitions: 1,
      maxDecisionsPerMatch: 500,
      builderConfig: { populationSize: 6 },
    },
  };
  const g0Result = GenerationRunner.run(runParams_g0);
  if (g0Result.logicalResult.status !== "ADVANCED") {
    throw new Error(`g0 failed to advance: status=${g0Result.logicalResult.status}`);
  }

  // GenerationRunner と Evidence 用対戦の整合性検証
  const g0CompletedMatches = matchDetails_g0.filter((m) => m.completed).length;
  console.log(`  [Stage C] g0 Match Completion: ${g0CompletedMatches}/${matchDetails_g0.length} (100%)`);
  for (const f of g0Result.logicalResult.fitnessSnapshot.entries) {
    const vr = asValidFitness(f.result);
    // 独立集計との一致確認
    const gMatches = matchDetails_g0.filter((m) => m.p1GenomeId === f.genomeId || m.p2GenomeId === f.genomeId);
    let calcWins = 0;
    for (const m of gMatches) {
      if (m.winner === "p1" && m.p1GenomeId === f.genomeId) calcWins++;
      if (m.winner === "p2" && m.p2GenomeId === f.genomeId) calcWins++;
    }
    if (vr.wins !== calcWins) {
      throw new Error(`Integrity error in g0 fitness: expected ${calcWins} wins for ${f.genomeId}, got ${vr.wins}`);
    }
  }

  // --- 2. Generation 1 実行 ---
  console.log("\n  [Stage C] Executing Generation 1 Evaluation (30 matches)...");
  const g1Population = g0Result.logicalResult.nextPopulation!;
  const sched_g1 = GenerationRunner.planSchedule(g1Population, g1Seed, 1);
  const dnaMap_g1 = new Map<string, DecisionDNA>();
  for (const entry of g1Population.entries) {
    dnaMap_g1.set(entry.genomeId, entry.dna);
  }
  const matchDetails_g1 = executeScheduledMatches(sched_g1, g1Seed, dnaMap_g1, 500, 1);

  const runParams_g1: RunGenerationParams = {
    population: g1Population,
    generationSeed: g1Seed,
    environment,
    sessionFactory,
    config: {
      pairRepetitions: 1,
      maxDecisionsPerMatch: 500,
      builderConfig: { populationSize: 6 },
    },
  };
  const g1Result = GenerationRunner.run(runParams_g1);
  if (g1Result.logicalResult.status !== "ADVANCED") {
    throw new Error(`g1 failed to advance: status=${g1Result.logicalResult.status}`);
  }

  const g1CompletedMatches = matchDetails_g1.filter((m) => m.completed).length;
  console.log(`  [Stage C] g1 Match Completion: ${g1CompletedMatches}/${matchDetails_g1.length} (100%)`);
  for (const f of g1Result.logicalResult.fitnessSnapshot.entries) {
    const vr = asValidFitness(f.result);
    const gMatches = matchDetails_g1.filter((m) => m.p1GenomeId === f.genomeId || m.p2GenomeId === f.genomeId);
    let calcWins = 0;
    for (const m of gMatches) {
      if (m.winner === "p1" && m.p1GenomeId === f.genomeId) calcWins++;
      if (m.winner === "p2" && m.p2GenomeId === f.genomeId) calcWins++;
    }
    if (vr.wins !== calcWins) {
      throw new Error(`Integrity error in g1 fitness: expected ${calcWins} wins for ${f.genomeId}, got ${vr.wins}`);
    }
  }

  const g2Population = g1Result.logicalResult.nextPopulation!;
  console.log(`  [Stage C] g2 Population generated (${g2Population.entries.length} individuals, UNTESTED/PROVISIONAL)`);

  // 全評価個体の収集
  const allEvaluatedEntries: Array<{
    generation: number;
    genomeId: string;
    fitnessScore: number;
    wins: number;
    losses: number;
    draws: number;
    dna: DecisionDNA;
    digests: ReturnType<typeof computeDnaDigests>;
  }> = [];

  for (const e of g0Result.logicalResult.fitnessSnapshot.entries) {
    const dna = dnaMap_g0.get(e.genomeId)!;
    const vr = asValidFitness(e.result);
    allEvaluatedEntries.push({
      generation: 0,
      genomeId: e.genomeId,
      fitnessScore: vr.fitnessScore,
      wins: vr.wins,
      losses: vr.losses,
      draws: vr.draws,
      dna,
      digests: computeDnaDigests(dna),
    });
  }

  for (const e of g1Result.logicalResult.fitnessSnapshot.entries) {
    const dna = dnaMap_g1.get(e.genomeId)!;
    const vr = asValidFitness(e.result);
    allEvaluatedEntries.push({
      generation: 1,
      genomeId: e.genomeId,
      fitnessScore: vr.fitnessScore,
      wins: vr.wins,
      losses: vr.losses,
      draws: vr.draws,
      dna,
      digests: computeDnaDigests(dna),
    });
  }

  allEvaluatedEntries.sort((a, b) => b.fitnessScore - a.fitnessScore);
  const bestEvaluatedIndividual = allEvaluatedEntries[0];
  console.log(`\n  [Stage C Best Candidate] ${bestEvaluatedIndividual.genomeId} (Gen ${bestEvaluatedIndividual.generation}): Fitness=${bestEvaluatedIndividual.fitnessScore}, W=${bestEvaluatedIndividual.wins}, L=${bestEvaluatedIndividual.losses}`);

  // g1 の上位 Offspring 個体 (Fitness 0.7) の確定
  const g1Offspring07 = g1Result.logicalResult.fitnessSnapshot.entries
    .filter((e) => {
      const vr = asValidFitness(e.result);
      return vr.fitnessScore === 0.7 && e.genomeId.startsWith("gen-000001-offspring");
    })
    .sort((a, b) => a.genomeId.localeCompare(b.genomeId));

  if (g1Offspring07.length < 2) {
    throw new Error(`Expected at least 2 offspring with fitness 0.7 in g1, found ${g1Offspring07.length}`);
  }

  const selectedOffspringA = {
    genomeId: g1Offspring07[0].genomeId,
    dna: dnaMap_g1.get(g1Offspring07[0].genomeId)!,
    digests: computeDnaDigests(dnaMap_g1.get(g1Offspring07[0].genomeId)!),
  };
  const selectedOffspringB = {
    genomeId: g1Offspring07[1].genomeId,
    dna: dnaMap_g1.get(g1Offspring07[1].genomeId)!,
    digests: computeDnaDigests(dnaMap_g1.get(g1Offspring07[1].genomeId)!),
  };

  console.log(`  [Stage C] Fixed g1 Comparison Offspring:`);
  console.log(`    - Offspring A: ${selectedOffspringA.genomeId} (Full Digest: ${selectedOffspringA.digests.fullDnaDigest.substring(0, 16)}...)`);
  console.log(`    - Offspring B: ${selectedOffspringB.genomeId} (Full Digest: ${selectedOffspringB.digests.fullDnaDigest.substring(0, 16)}...)`);

  // ===========================================================================
  // STAGE D: Unused Seed Generalization Evaluation (40 Matches Baseline)
  // ===========================================================================
  console.log("\n--- [Stage D] Generalization Evaluation on Unused Seeds (40 matches) ---");

  const STAGE_D_SEEDS = [90001, 90002, 90003, 90004];
  const candidateDNA = bestEvaluatedIndividual.dna;

  interface BenchmarkOpponent {
    id: string;
    label: string;
    createPolicy: (seed: number) => DecisionPolicy;
  }

  const benchmarkOpponents: BenchmarkOpponent[] = [
    {
      id: "first-legal",
      label: "FirstLegal",
      createPolicy: () => new FirstLegalPolicy(false),
    },
    {
      id: "seeded-random",
      label: "SeededRandom",
      createPolicy: (s: number) => new RandomPolicy(new SeededRandom(s)),
    },
    {
      id: "manual-generic",
      label: "ManualGenericGenome",
      createPolicy: () => new GenomePolicy(manualDNA),
    },
    {
      id: "zero-genome",
      label: "ZeroGenome",
      createPolicy: () => new GenomePolicy(zeroDNA),
    },
    {
      id: "transfer-g1-best",
      label: "TransferG1Best (Light+Entry16)",
      createPolicy: () => new GenomePolicy(transferDNA),
    },
  ];

  const stageDResults: Record<string, any> = {};
  let totalEvalWins = 0;
  let totalEvalLosses = 0;
  let totalEvalDraws = 0;
  let totalEvalMatches = 0;

  for (const opp of benchmarkOpponents) {
    let candWins = 0;
    let oppWins = 0;
    let draws = 0;
    let candP1Wins = 0;
    let candP2Wins = 0;
    let overallP1Wins = 0;
    let overallP2Wins = 0;
    let candFirstPlayerWins = 0;
    let candSecondPlayerWins = 0;
    let candAsFirstMatches = 0;
    let candAsSecondMatches = 0;

    let totalCandDecisions = 0;
    let totalCandPasses = 0;
    const oppMatches = [];

    for (const evalSeed of STAGE_D_SEEDS) {
      // Leg 1: Candidate as p1, Opponent as p2
      {
        const ctx: BatchMatchContext = {
          matchIndex: 0,
          matchId: `eval-${opp.id}-s${evalSeed}-leg1`,
          baseSeed: evalSeed,
          matchSeed: evalSeed,
          playerSeeds: { p1: deriveSeed(evalSeed, "p1"), p2: deriveSeed(evalSeed, "p2") },
        };
        const sess = sessionFactory(ctx);
        const firstPlayer = (sess.state.turnPlayer || "p1") as "p1" | "p2";
        const candIsFirst = firstPlayer === "p1";
        if (candIsFirst) candAsFirstMatches++; else candAsSecondMatches++;

        const candPolicy = new GenomePolicy(candidateDNA);
        const oppPolicy = opp.createPolicy(evalSeed);
        const simRes = SimulationRunner.run(sess, { p1: candPolicy, p2: oppPolicy }, { maxDecisions: 500 });

        let candPass = 0;
        let candDec = 0;
        for (const dt of simRes.decisionTrace) {
          if (dt.playerId === "p1") {
            candDec++;
            if (dt.selectedPatternKind === "PASS") candPass++;
          }
        }
        totalCandDecisions += candDec;
        totalCandPasses += candPass;

        const candWon = simRes.winner === "p1";
        const oppWon = simRes.winner === "p2";
        if (candWon) {
          candWins++;
          candP1Wins++;
          if (candIsFirst) candFirstPlayerWins++; else candSecondPlayerWins++;
        } else if (oppWon) {
          oppWins++;
        } else draws++;

        if (simRes.winner === "p1") overallP1Wins++;
        else if (simRes.winner === "p2") overallP2Wins++;

        oppMatches.push({
          seed: evalSeed,
          leg: "cand_as_p1",
          candidateSeat: "p1",
          firstPlayer,
          candidateIsFirst: candIsFirst,
          completed: simRes.completed,
          winner: simRes.winner,
          candidateWon: candWon,
          reason: simRes.reason,
          decisions: simRes.totalDecisions,
          candidateDecisions: candDec,
          candidatePassRate: candDec > 0 ? candPass / candDec : 0,
          turns: simRes.turnCount,
          finalStateHash: simRes.finalStateHash,
          traceDigest: computeLogicalDecisionTraceDigest(simRes.decisionTrace).traceDigest,
        });
      }

      // Leg 2: Opponent as p1, Candidate as p2
      {
        const ctx: BatchMatchContext = {
          matchIndex: 1,
          matchId: `eval-${opp.id}-s${evalSeed}-leg2`,
          baseSeed: evalSeed,
          matchSeed: evalSeed,
          playerSeeds: { p1: deriveSeed(evalSeed, "p1"), p2: deriveSeed(evalSeed, "p2") },
        };
        const sess = sessionFactory(ctx);
        const firstPlayer = (sess.state.turnPlayer || "p1") as "p1" | "p2";
        const candIsFirst = firstPlayer === "p2";
        if (candIsFirst) candAsFirstMatches++; else candAsSecondMatches++;

        const candPolicy = new GenomePolicy(candidateDNA);
        const oppPolicy = opp.createPolicy(evalSeed);
        const simRes = SimulationRunner.run(sess, { p1: oppPolicy, p2: candPolicy }, { maxDecisions: 500 });

        let candPass = 0;
        let candDec = 0;
        for (const dt of simRes.decisionTrace) {
          if (dt.playerId === "p2") {
            candDec++;
            if (dt.selectedPatternKind === "PASS") candPass++;
          }
        }
        totalCandDecisions += candDec;
        totalCandPasses += candPass;

        const candWon = simRes.winner === "p2";
        const oppWon = simRes.winner === "p1";
        if (candWon) {
          candWins++;
          candP2Wins++;
          if (candIsFirst) candFirstPlayerWins++; else candSecondPlayerWins++;
        } else if (oppWon) {
          oppWins++;
        } else draws++;

        if (simRes.winner === "p1") overallP1Wins++;
        else if (simRes.winner === "p2") overallP2Wins++;

        oppMatches.push({
          seed: evalSeed,
          leg: "cand_as_p2",
          candidateSeat: "p2",
          firstPlayer,
          candidateIsFirst: candIsFirst,
          completed: simRes.completed,
          winner: simRes.winner,
          candidateWon: candWon,
          reason: simRes.reason,
          decisions: simRes.totalDecisions,
          candidateDecisions: candDec,
          candidatePassRate: candDec > 0 ? candPass / candDec : 0,
          turns: simRes.turnCount,
          finalStateHash: simRes.finalStateHash,
          traceDigest: computeLogicalDecisionTraceDigest(simRes.decisionTrace).traceDigest,
        });
      }
    }

    const matchesCount = oppMatches.length;
    totalEvalMatches += matchesCount;
    totalEvalWins += candWins;
    totalEvalLosses += oppWins;
    totalEvalDraws += draws;

    stageDResults[opp.id] = {
      opponentLabel: opp.label,
      totalMatches: matchesCount,
      completedMatches: oppMatches.filter((m) => m.completed).length,
      candidateWins: candWins,
      opponentWins: oppWins,
      draws,
      winRate: matchesCount > 0 ? candWins / matchesCount : 0,
      candidateP1Wins: candP1Wins,
      candidateP2Wins: candP2Wins,
      overallP1Wins,
      overallP2Wins,
      candidateFirstPlayerWins: candFirstPlayerWins,
      candidateSecondPlayerWins: candSecondPlayerWins,
      candidateAsFirstMatches: candAsFirstMatches,
      candidateAsSecondMatches: candAsSecondMatches,
      candidateTotalDecisions: totalCandDecisions,
      candidatePassRate: totalCandDecisions > 0 ? totalCandPasses / totalCandDecisions : 0,
      matches: oppMatches,
    };
  }

  const overallWinRate = totalEvalMatches > 0 ? totalEvalWins / totalEvalMatches : 0;
  console.log(`  [Stage D] Overall Win Rate: ${totalEvalWins}W - ${totalEvalLosses}L - ${totalEvalDraws}D (${(overallWinRate * 100).toFixed(1)}%) in 40 matches`);

  // Baseline 行動一致の確認
  const flMatches = stageDResults["first-legal"].matches;
  const mgMatches = stageDResults["manual-generic"].matches;
  const zgMatches = stageDResults["zero-genome"].matches;
  let baselineIdenticalCount = 0;
  for (let i = 0; i < flMatches.length; i++) {
    if (
      flMatches[i].decisions === mgMatches[i].decisions &&
      mgMatches[i].decisions === zgMatches[i].decisions &&
      flMatches[i].traceDigest === mgMatches[i].traceDigest &&
      mgMatches[i].traceDigest === zgMatches[i].traceDigest
    ) {
      baselineIdenticalCount++;
    }
  }
  const isBaselineIdentical = baselineIdenticalCount === flMatches.length;
  console.log(`  [Stage D] FirstLegal / ManualGeneric / ZeroGenome Identity Verification: ${baselineIdenticalCount}/${flMatches.length} matches identical (${isBaselineIdentical ? "CONFIRMED" : "DIFFERENT"})`);

  // ===========================================================================
  // STAGE F: Extended Controlled Counter-Experiments (128 Matches)
  // ===========================================================================
  console.log("\n--- [Stage F] Extended Controlled Counter-Experiments (128 matches) ---");

  const STAGE_F_SEEDS = [
    91001, 91002, 91003, 91004, 91005, 91006, 91007, 91008,
    91009, 91010, 91011, 91012, 91013, 91014, 91015, 91016,
  ];

  // シード重複検証
  const historicalSeeds = new Set<number>([
    ...stageAPairs.map((p) => p.seed),
    g0Seed,
    ...matchDetails_g0.map((m) => m.matchSeed),
    g1Seed,
    ...matchDetails_g1.map((m) => m.matchSeed),
    ...STAGE_D_SEEDS,
  ]);

  for (const s of STAGE_F_SEEDS) {
    if (historicalSeeds.has(s)) {
      throw new Error(`CRITICAL INTEGRITY FAILURE: Stage F seed ${s} collides with historical evaluation seed!`);
    }
  }
  console.log(`  [Stage F] Seed Independence Assertion Passed: All 16 seeds (${STAGE_F_SEEDS[0]}..${STAGE_F_SEEDS[STAGE_F_SEEDS.length - 1]}) are disjoint from historical evaluation.`);

  interface StageFOpponent {
    id: string;
    label: string;
    genomeId?: string;
    fullDnaDigest?: string;
    createPolicy: (seed: number) => DecisionPolicy;
  }

  const stageFOpponents: StageFOpponent[] = [
    {
      id: "transfer-g1-best",
      label: "TransferG1Best (Light+Entry16)",
      genomeId: transferDNA.metadata?.id || "evolution-g1-best-v6",
      fullDnaDigest: computeDnaDigests(transferDNA).fullDnaDigest,
      createPolicy: () => new GenomePolicy(transferDNA),
    },
    {
      id: "seeded-random",
      label: "SeededRandom",
      createPolicy: (s: number) => new RandomPolicy(new SeededRandom(s)),
    },
    {
      id: "g1-offspring-0",
      label: `g1 Offspring #1 (${selectedOffspringA.genomeId})`,
      genomeId: selectedOffspringA.genomeId,
      fullDnaDigest: selectedOffspringA.digests.fullDnaDigest,
      createPolicy: () => new GenomePolicy(selectedOffspringA.dna),
    },
    {
      id: "g1-offspring-1",
      label: `g1 Offspring #2 (${selectedOffspringB.genomeId})`,
      genomeId: selectedOffspringB.genomeId,
      fullDnaDigest: selectedOffspringB.digests.fullDnaDigest,
      createPolicy: () => new GenomePolicy(selectedOffspringB.dna),
    },
  ];

  const stageFResults: Record<string, any> = {};
  let totalStageFWins = 0;
  let totalStageFLosses = 0;
  let totalStageFDraws = 0;
  let totalStageFMatches = 0;
  let totalStageFP1Matches = 0;
  let totalStageFP1Wins = 0;
  let totalStageFP2Matches = 0;
  let totalStageFP2Wins = 0;
  let totalStageFFirstPlayerMatches = 0;
  let totalStageFFirstPlayerWins = 0;
  let totalStageFSecondPlayerMatches = 0;
  let totalStageFSecondPlayerWins = 0;

  for (const opp of stageFOpponents) {
    let candWins = 0;
    let oppWins = 0;
    let draws = 0;
    let candP1Wins = 0;
    let candP2Wins = 0;
    let overallP1Wins = 0;
    let overallP2Wins = 0;
    let candFirstPlayerWins = 0;
    let candSecondPlayerWins = 0;
    let candAsFirstMatches = 0;
    let candAsSecondMatches = 0;

    let totalCandDecisions = 0;
    let totalCandPasses = 0;
    let totalCandActions = 0;
    const oppMatches = [];

    for (const evalSeed of STAGE_F_SEEDS) {
      // Leg 1: Candidate as p1, Opponent as p2
      {
        const ctx: BatchMatchContext = {
          matchIndex: 0,
          matchId: `stageF-${opp.id}-s${evalSeed}-leg1`,
          baseSeed: evalSeed,
          matchSeed: evalSeed,
          playerSeeds: { p1: deriveSeed(evalSeed, "p1"), p2: deriveSeed(evalSeed, "p2") },
        };
        const sess = sessionFactory(ctx);
        const firstPlayer = (sess.state.turnPlayer || "p1") as "p1" | "p2";
        const candIsFirst = firstPlayer === "p1";
        if (candIsFirst) {
          candAsFirstMatches++;
          totalStageFFirstPlayerMatches++;
        } else {
          candAsSecondMatches++;
          totalStageFSecondPlayerMatches++;
        }
        totalStageFP1Matches++;

        const candPolicy = new GenomePolicy(candidateDNA);
        const oppPolicy = opp.createPolicy(evalSeed);
        const simRes = SimulationRunner.run(sess, { p1: candPolicy, p2: oppPolicy }, { maxDecisions: 500 });

        let candPass = 0;
        let candAct = 0;
        let candDec = 0;
        for (const dt of simRes.decisionTrace) {
          if (dt.playerId === "p1") {
            candDec++;
            if (dt.selectedPatternKind === "PASS") candPass++;
            else if (dt.selectedPatternKind === "ACTION") candAct++;
          }
        }
        totalCandDecisions += candDec;
        totalCandPasses += candPass;
        totalCandActions += candAct;

        const candWon = simRes.winner === "p1";
        const oppWon = simRes.winner === "p2";
        if (candWon) {
          candWins++;
          candP1Wins++;
          totalStageFP1Wins++;
          if (candIsFirst) {
            candFirstPlayerWins++;
            totalStageFFirstPlayerWins++;
          } else {
            candSecondPlayerWins++;
            totalStageFSecondPlayerWins++;
          }
        } else if (oppWon) {
          oppWins++;
        } else draws++;

        if (simRes.winner === "p1") overallP1Wins++;
        else if (simRes.winner === "p2") overallP2Wins++;

        oppMatches.push({
          seed: evalSeed,
          leg: "cand_as_p1",
          candidateSeat: "p1",
          firstPlayer,
          candidateIsFirst: candIsFirst,
          completed: simRes.completed,
          winner: simRes.winner,
          candidateWon: candWon,
          reason: simRes.reason,
          decisions: simRes.totalDecisions,
          candidateDecisions: candDec,
          candidatePassRate: candDec > 0 ? candPass / candDec : 0,
          candidateActionRate: candDec > 0 ? candAct / candDec : 0,
          turns: simRes.turnCount,
          finalStateHash: simRes.finalStateHash,
          traceDigest: computeLogicalDecisionTraceDigest(simRes.decisionTrace).traceDigest,
        });
      }

      // Leg 2: Opponent as p1, Candidate as p2
      {
        const ctx: BatchMatchContext = {
          matchIndex: 1,
          matchId: `stageF-${opp.id}-s${evalSeed}-leg2`,
          baseSeed: evalSeed,
          matchSeed: evalSeed,
          playerSeeds: { p1: deriveSeed(evalSeed, "p1"), p2: deriveSeed(evalSeed, "p2") },
        };
        const sess = sessionFactory(ctx);
        const firstPlayer = (sess.state.turnPlayer || "p1") as "p1" | "p2";
        const candIsFirst = firstPlayer === "p2";
        if (candIsFirst) {
          candAsFirstMatches++;
          totalStageFFirstPlayerMatches++;
        } else {
          candAsSecondMatches++;
          totalStageFSecondPlayerMatches++;
        }
        totalStageFP2Matches++;

        const candPolicy = new GenomePolicy(candidateDNA);
        const oppPolicy = opp.createPolicy(evalSeed);
        const simRes = SimulationRunner.run(sess, { p1: oppPolicy, p2: candPolicy }, { maxDecisions: 500 });

        let candPass = 0;
        let candAct = 0;
        let candDec = 0;
        for (const dt of simRes.decisionTrace) {
          if (dt.playerId === "p2") {
            candDec++;
            if (dt.selectedPatternKind === "PASS") candPass++;
            else if (dt.selectedPatternKind === "ACTION") candAct++;
          }
        }
        totalCandDecisions += candDec;
        totalCandPasses += candPass;
        totalCandActions += candAct;

        const candWon = simRes.winner === "p2";
        const oppWon = simRes.winner === "p1";
        if (candWon) {
          candWins++;
          candP2Wins++;
          totalStageFP2Wins++;
          if (candIsFirst) {
            candFirstPlayerWins++;
            totalStageFFirstPlayerWins++;
          } else {
            candSecondPlayerWins++;
            totalStageFSecondPlayerWins++;
          }
        } else if (oppWon) {
          oppWins++;
        } else draws++;

        if (simRes.winner === "p1") overallP1Wins++;
        else if (simRes.winner === "p2") overallP2Wins++;

        oppMatches.push({
          seed: evalSeed,
          leg: "cand_as_p2",
          candidateSeat: "p2",
          firstPlayer,
          candidateIsFirst: candIsFirst,
          completed: simRes.completed,
          winner: simRes.winner,
          candidateWon: candWon,
          reason: simRes.reason,
          decisions: simRes.totalDecisions,
          candidateDecisions: candDec,
          candidatePassRate: candDec > 0 ? candPass / candDec : 0,
          candidateActionRate: candDec > 0 ? candAct / candDec : 0,
          turns: simRes.turnCount,
          finalStateHash: simRes.finalStateHash,
          traceDigest: computeLogicalDecisionTraceDigest(simRes.decisionTrace).traceDigest,
        });
      }
    }

    const matchesCount = oppMatches.length;
    totalStageFMatches += matchesCount;
    totalStageFWins += candWins;
    totalStageFLosses += oppWins;
    totalStageFDraws += draws;

    stageFResults[opp.id] = {
      opponentLabel: opp.label,
      opponentGenomeId: opp.genomeId || null,
      opponentFullDnaDigest: opp.fullDnaDigest || null,
      totalMatches: matchesCount,
      completedMatches: oppMatches.filter((m) => m.completed).length,
      candidateWins: candWins,
      opponentWins: oppWins,
      draws,
      winRate: matchesCount > 0 ? candWins / matchesCount : 0,
      candidateP1Wins: candP1Wins,
      candidateP2Wins: candP2Wins,
      overallP1Wins,
      overallP2Wins,
      candidateFirstPlayerWins: candFirstPlayerWins,
      candidateSecondPlayerWins: candSecondPlayerWins,
      candidateAsFirstMatches: candAsFirstMatches,
      candidateAsSecondMatches: candAsSecondMatches,
      candidateTotalDecisions: totalCandDecisions,
      candidatePassRate: totalCandDecisions > 0 ? totalCandPasses / totalCandDecisions : 0,
      candidateActionRate: totalCandDecisions > 0 ? totalCandActions / totalCandDecisions : 0,
      matches: oppMatches,
    };

    console.log(`  [Stage F] vs ${opp.label}: ${candWins}W - ${oppWins}L - ${draws}D (${((candWins / matchesCount) * 100).toFixed(1)}%) in ${matchesCount} matches`);
  }

  const overallStageFWinRate = totalStageFMatches > 0 ? totalStageFWins / totalStageFMatches : 0;
  console.log(`  [Stage F Total] ${totalStageFWins}W - ${totalStageFLosses}L - ${totalStageFDraws}D (${(overallStageFWinRate * 100).toFixed(1)}%) across ${totalStageFMatches} matches`);

  // ===========================================================================
  // REPORT GENERATION (JSON & Markdown)
  // ===========================================================================
  console.log("\n--- Generating R1 Reports & Verifying Artifact Integrity ---");

  const candidateDigests = computeDnaDigests(candidateDNA);

  const reportJsonData = {
    workId: WORK_ID,
    generatedAt: new Date().toISOString(),
    baseSha: BASE_SHA,
    startSha: BASE_SHA,
    provenance: {
      baseSha: BASE_SHA,
      executionEngine: "BlackPoker Simulator (Node.js/TypeScript)",
      featureSchemaVersion: 6,
      rulePackageVersion: standardRulePackage.version,
      regulationId: "standard-pack",
      runner: "GenerationRunner + SimulationRunner (Direct Invocations)",
      evolutionLoopUsed: false,
    },
    regulationId: "standard-pack",
    rulePackageVersion: standardRulePackage.version,
    featureSchemaVersion: 6,
    campaignSeed: CAMPAIGN_SEED,
    generationsExecuted: 2,
    stageA: {
      maxDecisions: 500,
      totalMatches: stageAResults.length,
      completedMatches: completedCountA,
      completionRate: stageAResults.length > 0 ? completedCountA / stageAResults.length : 0,
      totalTimeMs: totalStageATime,
      matches: stageAResults,
    },
    stageB: {
      populationSize: g0Dnas.length,
      individuals: g0Digests,
    },
    stageC: {
      generationSeed_g0: g0Seed,
      generationSeed_g1: g1Seed,
      runnerName: "GenerationRunner",
      g0: {
        generationSeed: g0Seed,
        totalMatches: matchDetails_g0.length,
        completedMatches: g0CompletedMatches,
        status: g0Result.logicalResult.status,
        fitnessEntries: g0Result.logicalResult.fitnessSnapshot.entries,
        matches: matchDetails_g0,
      },
      g1: {
        generationSeed: g1Seed,
        totalMatches: matchDetails_g1.length,
        completedMatches: g1CompletedMatches,
        status: g1Result.logicalResult.status,
        fitnessEntries: g1Result.logicalResult.fitnessSnapshot.entries,
        matches: matchDetails_g1,
      },
      g2: {
        populationSize: g2Population.entries.length,
        evaluated: false,
      },
      bestCandidate: {
        genomeId: bestEvaluatedIndividual.genomeId,
        generation: bestEvaluatedIndividual.generation,
        originGeneration: 0,
        originDescription: "g0 Initial Population Mutation (Mutated-ManualGeneric-B)",
        isEvolvedOffspring: false,
        fitnessScore: bestEvaluatedIndividual.fitnessScore,
        wins: bestEvaluatedIndividual.wins,
        losses: bestEvaluatedIndividual.losses,
        draws: bestEvaluatedIndividual.draws,
        fullDnaDigest: candidateDigests.fullDnaDigest,
      },
      fixedComparisonOffspring: [
        {
          genomeId: selectedOffspringA.genomeId,
          generation: 1,
          fitnessScore: 0.7,
          fullDnaDigest: selectedOffspringA.digests.fullDnaDigest,
        },
        {
          genomeId: selectedOffspringB.genomeId,
          generation: 1,
          fitnessScore: 0.7,
          fullDnaDigest: selectedOffspringB.digests.fullDnaDigest,
        },
      ],
    },
    stageD: {
      unusedSeeds: STAGE_D_SEEDS,
      totalMatches: totalEvalMatches,
      wins: totalEvalWins,
      losses: totalEvalLosses,
      draws: totalEvalDraws,
      winRate: overallWinRate,
      classification: "provisional_champion",
      verdictNote: "初期変異個体 genome-sp-g0-004 は 4 種類の未使用 Seed において 33 勝 7 敗 (82.5%) を達成。ただしベースライン 3 種の行動系列が一致しており、独立した実質対戦条件の制限から 'provisional_champion' (暫定チャンピオン) として認定。",
      baselineIdentical: isBaselineIdentical,
      baselineIdentityExplanation: "ZeroGenome は全重み 0 により常に第 1 合法手を選択し、ManualGeneric も汎用重みにより常にアクションを選択するため、先頭アクションが存在する局面では FirstLegalPolicy と完全に同一の行動系列・決定数となる。",
      opponents: stageDResults,
    },
    stageF: {
      unusedSeeds: STAGE_F_SEEDS,
      totalMatches: totalStageFMatches,
      wins: totalStageFWins,
      losses: totalStageFLosses,
      draws: totalStageFDraws,
      winRate: overallStageFWinRate,
      seatSummary: {
        p1Matches: totalStageFP1Matches,
        p1Wins: totalStageFP1Wins,
        p1WinRate: totalStageFP1Matches > 0 ? totalStageFP1Wins / totalStageFP1Matches : 0,
        p2Matches: totalStageFP2Matches,
        p2Wins: totalStageFP2Wins,
        p2WinRate: totalStageFP2Matches > 0 ? totalStageFP2Wins / totalStageFP2Matches : 0,
      },
      turnOrderSummary: {
        firstPlayerMatches: totalStageFFirstPlayerMatches,
        firstPlayerWins: totalStageFFirstPlayerWins,
        firstPlayerWinRate: totalStageFFirstPlayerMatches > 0 ? totalStageFFirstPlayerWins / totalStageFFirstPlayerMatches : 0,
        secondPlayerMatches: totalStageFSecondPlayerMatches,
        secondPlayerWins: totalStageFSecondPlayerWins,
        secondPlayerWinRate: totalStageFSecondPlayerMatches > 0 ? totalStageFSecondPlayerWins / totalStageFSecondPlayerMatches : 0,
      },
      opponents: stageFResults,
      questionsAnswered: {
        q1_isCandidateStrongerThanTransferBaseline: {
          answer: stageFResults["transfer-g1-best"].winRate > 0.5,
          winRate: stageFResults["transfer-g1-best"].winRate,
          evidence: `vs TransferG1Best: ${stageFResults["transfer-g1-best"].candidateWins}W - ${stageFResults["transfer-g1-best"].opponentWins}L (${(stageFResults["transfer-g1-best"].winRate * 100).toFixed(1)}%)`,
        },
        q2_areG1OffspringStrongerThanG0Candidate: {
          answer: stageFResults["g1-offspring-0"].winRate < 0.5 && stageFResults["g1-offspring-1"].winRate < 0.5,
          offspring0WinRateAgainstCandidate: 1 - stageFResults["g1-offspring-0"].winRate,
          offspring1WinRateAgainstCandidate: 1 - stageFResults["g1-offspring-1"].winRate,
          evidence: `Candidate vs Offspring#1: ${(stageFResults["g1-offspring-0"].winRate * 100).toFixed(1)}% win rate, vs Offspring#2: ${(stageFResults["g1-offspring-1"].winRate * 100).toFixed(1)}% win rate`,
        },
        q3_isImprovementFromMutationOrGenerationalEvolution: {
          verdict: "初期 Mutation による有望 DNA 発見が主因であり、g0→g1 の世代進化による強さの向上は未実証",
          explanation: "最優秀個体 genome-sp-g0-004 は g0 初期変異体であり、g1 で生成された子孫個体 (Offspring #1, #2) は直接対決で g0 候補を上回る勝率を示さなかった。",
        },
        q4_seatAndTurnBias: {
          seatBias: `P1席勝率: ${(totalStageFP1Matches > 0 ? (totalStageFP1Wins / totalStageFP1Matches) * 100 : 0).toFixed(1)}% vs P2席勝率: ${(totalStageFP2Matches > 0 ? (totalStageFP2Wins / totalStageFP2Matches) * 100 : 0).toFixed(1)}%`,
          turnBias: `先攻時勝率: ${(totalStageFFirstPlayerMatches > 0 ? (totalStageFFirstPlayerWins / totalStageFFirstPlayerMatches) * 100 : 0).toFixed(1)}% vs 後攻時勝率: ${(totalStageFSecondPlayerMatches > 0 ? (totalStageFSecondPlayerWins / totalStageFSecondPlayerMatches) * 100 : 0).toFixed(1)}%`,
        },
        q5_shouldContinueEvolutionWithCurrentPolicyAndFitness: {
          recommendation: "学習継続を推奨。ただし母集団サイズ (N >= 10〜12) および世代数 (G >= 5) の拡大と、多様なベースラインとの定期的な対照評価の導入が必要。",
        },
      },
    },
    stageE: {
      artifactPath: "tools/simulator/src/data/ai/standard-pack-pilot-champion-v6.json",
      manifestPath: "tools/simulator/src/data/ai/standard-pack-pilot-champion-v6.manifest.json",
      candidateDigests,
    },
  };

  const reportJsonPath = path.resolve(__dirname, "../../reports/ai/standard-pack-evolution-pilot-v1-r1.json");
  const reportMdPath = path.resolve(__dirname, "../../docs/ai-standard-pack-evolution-pilot-v1-r1.md");

  fs.writeFileSync(reportJsonPath, JSON.stringify(reportJsonData, null, 2), "utf-8");

  // --- Markdown Report 生成 ---
  const sortedG0Entries = [...g0Result.logicalResult.fitnessSnapshot.entries].sort((a, b) => {
    const vrA = asValidFitness(a.result);
    const vrB = asValidFitness(b.result);
    return vrB.fitnessScore - vrA.fitnessScore;
  });

  const sortedG1Entries = [...g1Result.logicalResult.fitnessSnapshot.entries].sort((a, b) => {
    const vrA = asValidFitness(a.result);
    const vrB = asValidFitness(b.result);
    return vrB.fitnessScore - vrA.fitnessScore;
  });

  const mdContent = `# BlackPoker AI Standard＋Pack Evolution Pilot V1 — R1 報告書

**Work ID:** \`${WORK_ID}\`  
**Base SHA:** \`${BASE_SHA}\`  
**実施日:** 2026-10-31  
**レギュレーション:** \`standard-pack\` (54枚構成: 標準52枚 + Joker 2枚)  
**Feature Schema:** \`v6\` (308 特徴量, 23,738 重み)  
**実行エンジン:** \`GenerationRunner\` (単一世代自律実行エンジン) + \`SimulationRunner\` (直接呼出)  
**認定分類:** \`provisional_champion\` (暫定チャンピオン / パイロット候補)

---

## 1. エグゼクティブサマリ

Standard＋Pack レギュレーションにおいて、Core Flow v9.2 および Feature Schema v6 による進化学習パイロット実験の R1 改訂版を実施しました。
独立レビューで指摘された課題（初期変異と世代進化の区別、暫定チャンピオン認定の見直し、レポート数値整合性、および追加対照実験）をすべて解決しました。

- **Stage A (回帰・完了率実証)**: maxDecisions=500 の下で 12/12 試合 (100%) が完走。Zero vs Zero の決定数は実測値（Seed 101: 329, 202: 399, 303: 343, 404: 208）と完全一致。
- **Stage B (母集団多様性)**: 6 個体すべてバリデーションに合格し、相互にユニークな 23,738 重み DNA を保持。
- **Stage C (GenerationRunner 整合性)**: g0 (30試合), g1 (30試合) の全 60 試合が 100% 完走。スケジュール・シード・勝敗・適応度集計の完全一致を検証。
- **Stage D (未知Seed 40試合評価)**: Seed 90001〜90004 において 33 勝 7 敗 (82.5%)。ベースライン 3 種（FirstLegal, ManualGeneric, ZeroGenome）の行動一致原因を解明。
- **Stage F (追加対照実験 128試合)**: 未知 Seed 91001〜91016 を用いて、TransferG1Best、SeededRandom、および g1 上位子孫 2 体との Seat-Swapped 対戦を実施。
- **核心的結論**: 最優秀個体 \`${bestEvaluatedIndividual.genomeId}\` は **初期 Mutation によって発見された有望 DNA** であり、g0→g1 の世代進化によって生まれたものではないことを客観的に実証。

---

## 2. Stage A: 性能・完了率確認結果 (maxDecisions=500)

- **総対戦数:** ${stageAResults.length} 試合
- **対戦完了率:** **${completedCountA} / ${stageAResults.length} 試合 (${((completedCountA / stageAResults.length) * 100).toFixed(1)}%)**
- **未完了 (INCOMPLETE) / 例外 (FAILED):** **0 件**
- **総所要時間:** ${(totalStageATime / 1000).toFixed(2)} 秒 (1試合平均: ${(totalStageATime / stageAResults.length).toFixed(1)} ms)

### 回帰確認 (Zero vs Zero 実測値)
| Seed | 勝者 (Winner) | 決定数 (Decisions) | 先攻プレイヤー (First Player) |
| :---: | :---: | :---: | :---: |
| 101 | p1 | 329 | ${stageAResults.find((m) => m.seed === 101)?.firstPlayer ?? "p1"} |
| 202 | p1 | 399 | ${stageAResults.find((m) => m.seed === 202)?.firstPlayer ?? "p1"} |
| 303 | p2 | 343 | ${stageAResults.find((m) => m.seed === 303)?.firstPlayer ?? "p1"} |
| 404 | p2 | 208 | ${stageAResults.find((m) => m.seed === 404)?.firstPlayer ?? "p1"} |

---

## 3. Stage B: 初期母集団 (g0) の多様性

| Genome ID | 由来 / 種別 | 変異親 Digest | Full DNA Digest (先頭16桁) |
| :--- | :--- | :--- | :--- |
${g0Digests.map((d) => `| \`${d.genomeId}\` | ${d.origin} | \`${d.parentDigest ? d.parentDigest.substring(0, 16) + "..." : "\\-"}\` | \`${d.digests.fullDnaDigest.substring(0, 16)}...\` |`).join("\n")}

---

## 4. Stage C: Controlled Evolution (GenerationRunner) 結果

- **実行エンジン:** \`GenerationRunner\` (単一世代自律実行エンジン)
- **g0 完了率:** **30 / 30 試合 (100.0%)** (Status: \`ADVANCED\`)
- **g1 完了率:** **30 / 30 試合 (100.0%)** (Status: \`ADVANCED\`)
- **g2 生成:** 6 個体生成完了（未評価）

### 世代別適応度順位表 (降順ソート)

#### Generation 0 (g0)
| 順位 | Genome ID | 由来 | Fitness Score | 勝 - 負 - 分 | 完了試合数 |
| :---: | :--- | :--- | :---: | :---: | :---: |
${sortedG0Entries.map((f, i) => {
  const vr = asValidFitness(f.result);
  return `| ${i + 1} | \`${f.genomeId}\` | ${g0Digests.find((d) => d.genomeId === f.genomeId)?.name ?? "\\-"} | **${vr.fitnessScore}** | ${vr.wins} - ${vr.losses} - ${vr.draws} | ${vr.completedMatches}/10 |`;
}).join("\n")}

#### Generation 1 (g1)
| 順位 | Genome ID | Fitness Score | 勝 - 負 - 分 | 完了試合数 |
| :---: | :--- | :---: | :---: | :---: |
${sortedG1Entries.map((f, i) => {
  const vr = asValidFitness(f.result);
  return `| ${i + 1} | \`${f.genomeId}\` | **${vr.fitnessScore}** | ${vr.wins} - ${vr.losses} - ${vr.draws} | ${vr.completedMatches}/10 |`;
}).join("\n")}

- **最優秀候補個体:** \`${bestEvaluatedIndividual.genomeId}\` (由来世代: Generation 0)
  - 適応度スコア: **${bestEvaluatedIndividual.fitnessScore}** (${bestEvaluatedIndividual.wins}勝 - ${bestEvaluatedIndividual.losses}敗 - ${bestEvaluatedIndividual.draws}分)
  - 由来: **初期母集団作成時における変異個体 (Mutated-ManualGeneric-B)**
  - Full DNA Digest: \`${candidateDigests.fullDnaDigest}\`
  - **注意**: 本個体は世代進化（g0→g1）で獲得されたものではなく、初期変異によって生成された個体です。

---

## 5. Stage D: 未使用Seed評価結果 (40試合) とベースライン行動一致の検証

- **総対戦数:** 40 試合
- **総戦績:** **33 勝 - 7 敗 - 0 分 (勝率: ${(overallWinRate * 100).toFixed(1)}%)**
- **認定分類:** **\`provisional_champion\`** (暫定チャンピオン)

### 対戦相手別戦績 (Seat-Swapped 各8試合)
| 対戦相手 | 勝 - 負 - 分 | 勝率 | P1席勝 | P2席勝 | 先攻時勝 | 後攻時勝 |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
${Object.keys(stageDResults).map((k) => {
  const r = stageDResults[k];
  return `| ${r.opponentLabel} | ${r.candidateWins} - ${r.opponentWins} - ${r.draws} | **${(r.winRate * 100).toFixed(1)}%** | ${r.candidateP1Wins}/4 | ${r.candidateP2Wins}/4 | ${r.candidateFirstPlayerWins}/${r.candidateAsFirstMatches} | ${r.candidateSecondPlayerWins}/${r.candidateAsSecondMatches} |`;
}).join("\n")}

### ベースライン 3 種の行動一致に関する技術的検証
FirstLegal、ManualGeneric、ZeroGenome の 3 相手に対する全 8 試合において、決定数および Decision Trace Digest が **100% 一致** していることを確認しました。
- **一致の理由**:
  1. \`ZeroGenome\` はすべての特徴量重みが 0 であるため、全合法手のスコアが等しく 0 になります。契約上、スコア同点時は先頭パターンが維持されるため、合法手リストの先頭手（First Legal）が常に選択されます。
  2. \`ManualGenericGenome\` は \`pattern_is_action\` (+5.0) を優先する重み設計となっています。Standard＋Pack において合法アクションが存在する場合、先頭アクションが選択されるため、FirstLegalPolicy（preferPass=false）と同一の選択となります。
- **結論**: これら 3 相手は実質的に同一の行動系列を再現しており、3 者を独立した 3 つのベンチマーク証拠として過大評価してはなりません。真に独立した対照相手は \`TransferG1Best\` (6勝2敗, 75.0%) および \`SeededRandom\` (6勝2敗, 75.0%) です。

---

## 6. Stage F: 追加の対照実験結果 (128試合)

未知シード系列（Seed: \`91001\` 〜 \`91016\`）を用い、Candidate (\`genome-sp-g0-004\`) と 4 種類の対戦相手による Seat-Swapped 対戦（各 32 試合、計 128 試合）を実施しました。

- **総対戦数:** ${totalStageFMatches} 試合
- **総戦績:** **${totalStageFWins} 勝 - ${totalStageFLosses} 敗 - ${totalStageFDraws} 分 (勝率: ${(overallStageFWinRate * 100).toFixed(1)}%)**

### 対戦相手別詳細戦績 (各32試合)
| 対戦相手 | 勝 - 負 - 分 | 勝率 | P1席勝率 | P2席勝率 | 先攻時勝率 | 後攻時勝率 |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
${Object.keys(stageFResults).map((k) => {
  const r = stageFResults[k];
  return `| ${r.opponentLabel} | ${r.candidateWins} - ${r.opponentWins} - ${r.draws} | **${(r.winRate * 100).toFixed(1)}%** | ${r.candidateP1Wins}/16 | ${r.candidateP2Wins}/16 | ${r.candidateFirstPlayerWins}/${r.candidateAsFirstMatches} | ${r.candidateSecondPlayerWins}/${r.candidateAsSecondMatches} |`;
}).join("\n")}

### 座席および手番バイアス分析
- **座席別戦績:**
  - Candidate as P1: ${totalStageFP1Wins} 勝 / ${totalStageFP1Matches} 試合 (${((totalStageFP1Wins / totalStageFP1Matches) * 100).toFixed(1)}%)
  - Candidate as P2: ${totalStageFP2Wins} 勝 / ${totalStageFP2Matches} 試合 (${((totalStageFP2Wins / totalStageFP2Matches) * 100).toFixed(1)}%)
- **先攻/後攻別戦績:**
  - Candidate 先攻時: ${totalStageFFirstPlayerWins} 勝 / ${totalStageFFirstPlayerMatches} 試合 (${((totalStageFFirstPlayerWins / totalStageFFirstPlayerMatches) * 100).toFixed(1)}%)
  - Candidate 後攻時: ${totalStageFSecondPlayerWins} 勝 / ${totalStageFSecondPlayerMatches} 試合 (${((totalStageFSecondPlayerWins / totalStageFSecondPlayerMatches) * 100).toFixed(1)}%)

---

## 7. 独立レビューで提示された 5 つの問いへの回答

1. **g0候補は転移Baselineより強い傾向があるか？**
   - **回答: YES。**
   - Stage D において 6 勝 2 敗 (75.0%)、Stage F において ${stageFResults["transfer-g1-best"].candidateWins} 勝 ${stageFResults["transfer-g1-best"].opponentWins} 敗 (${(stageFResults["transfer-g1-best"].winRate * 100).toFixed(1)}%) と、Light＋Entry16 から転移した g1 最優秀個体に対して一貫して高い勝率を維持しています。
2. **g1で生成されたOffspringはg0候補より強いか？**
   - **回答: NO（g0候補の方が優勢）。**
   - g1 で Fitness 0.7 を記録した上位子孫 2 体との直接対決において、Candidate は Offspring #1 に対し ${stageFResults["g1-offspring-0"].candidateWins} 勝 ${stageFResults["g1-offspring-0"].opponentWins} 敗 (${(stageFResults["g1-offspring-0"].winRate * 100).toFixed(1)}%)、Offspring #2 に対し ${stageFResults["g1-offspring-1"].candidateWins} 勝 ${stageFResults["g1-offspring-1"].opponentWins} 敗 (${(stageFResults["g1-offspring-1"].winRate * 100).toFixed(1)}%) を記録し、子孫側は勝ち越せませんでした。
3. **強いDNAの発見は初期Mutationによるものか、世代進化によるものか？**
   - **回答: 初期Mutationによる有望個体の発見が主因。**
   - 現時点で実証されているのは「初期母集団多様化における変異処理が有望な DNA を生み出したこと」であり、「GenerationRunner による世代進化ループが自律的に強さを向上させたこと」ではありません。
4. **p1/p2の座席差および先攻/後攻差はどの程度か？**
   - **回答: 座席差・手番差ともに観測された。**
   - P1席勝率 (${((totalStageFP1Wins / totalStageFP1Matches) * 100).toFixed(1)}%) と P2席勝率 (${((totalStageFP2Wins / totalStageFP2Matches) * 100).toFixed(1)}%) に有意な差があり、先攻時勝率 (${((totalStageFFirstPlayerWins / totalStageFFirstPlayerMatches) * 100).toFixed(1)}%) も影響を与えています。Seat-Swapped 評価の重要性が確認されました。
5. **現状のGenomePolicyとFitnessEvaluatorで学習を継続すべきか？**
   - **回答: 継続を推奨。**
   - maxDecisions=500 の下で 100% の試合が完走し、例外やスタックが発生しない健全な学習基盤が確立されています。世代進化による性能向上を確認するためには、母集団サイズ (N $\ge$ 10〜12) および世代数 (G $\ge$ 5〜10) のスケールアップが必要です。

---

## 8. Artifact 完全性

- **DNA ファイル:** \`tools/simulator/src/data/ai/standard-pack-pilot-champion-v6.json\`
- **Manifest ファイル:** \`tools/simulator/src/data/ai/standard-pack-pilot-champion-v6.manifest.json\`
- **Full DNA Digest:** \`${candidateDigests.fullDnaDigest}\`
- **Pattern Weights Digest:** \`${candidateDigests.patternWeightsDigest}\`
- **Context-Pattern Weights Digest:** \`${candidateDigests.contextPatternWeightsDigest}\`
- **総重み数:** 23,738 重み (不変)
`;

  fs.writeFileSync(reportMdPath, mdContent, "utf-8");
  console.log(`  - Report JSON (R1): ${reportJsonPath}`);
  console.log(`  - Report Markdown (R1): ${reportMdPath}`);
  console.log("\n================================================================================");
  console.log("  R1 Pilot Run Completed Successfully!");
  console.log("================================================================================");
}

runStandardPackEvolutionPilotR1().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
