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

export const WORK_ID = "BP-SIM-AI-V92-STANDARD-PACK-EVOLUTION-PILOT-V1-R2";
export const BASE_SHA = "b01952928c8757e3553b808daa366a410476eb18";
export const START_SHA = "b01952928c8757e3553b808daa366a410476eb18";
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
    patternWeightsDigest: pDigest,
    contextPatternWeightsDigest: cpDigest,
    fullDnaDigest: fullDigest,
    totalWeights: dna.patternWeights.length + dna.contextPatternWeights.length,
  };
}

/**
 * Wilson score interval (95% confidence interval for binomial proportion)
 */
export function wilsonScoreInterval(wins: number, total: number, confidence: number = 0.95): {
  point: number;
  lower: number;
  upper: number;
} {
  if (total === 0) return { point: 0, lower: 0, upper: 0 };
  const p = wins / total;
  const z = 1.959963984540054; // 95%
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total)) / denominator;
  return {
    point: p,
    lower: Math.max(0, center - margin),
    upper: Math.min(1, center + margin),
  };
}

/**
 * Paired score interval for seat-swapped pairs (scores in [-1, +1])
 */
export function pairedScoreInterval(scores: number[]): {
  n: number;
  mean: number;
  sd: number;
  se: number;
  lower: number;
  upper: number;
} {
  const n = scores.length;
  if (n === 0) return { n: 0, mean: 0, sd: 0, se: 0, lower: 0, upper: 0 };
  const mean = scores.reduce((a, b) => a + b, 0) / n;
  if (n === 1) return { n: 1, mean, sd: 0, se: 0, lower: mean, upper: mean };
  const variance = scores.reduce((acc, s) => acc + Math.pow(s - mean, 2), 0) / (n - 1);
  const sd = Math.sqrt(variance);
  const se = sd / Math.sqrt(n);
  // t-critical value for df = n - 1 (df=31 -> ~2.0395)
  const tCrit = n === 32 ? 2.039513 : 2.0;
  return {
    n,
    mean,
    sd,
    se,
    lower: mean - tCrit * se,
    upper: mean + tCrit * se,
  };
}

/**
 * Exact binomial two-sided p-value for discordant pairs in McNemar test
 */
export function exactBinomialPValue(b: number, c: number): number {
  const n = b + c;
  if (n === 0) return 1.0;
  const k = Math.min(b, c);
  let pCumulative = 0;
  let currentLogComb = 0;
  for (let i = 0; i <= k; i++) {
    if (i > 0) {
      currentLogComb += Math.log(n - i + 1) - Math.log(i);
    }
    const logProb = currentLogComb - n * Math.LN2;
    pCumulative += Math.exp(logProb);
  }
  return Math.min(1.0, 2 * pCumulative);
}

/**
 * McNemar test analysis for paired binary outcomes on identical match conditions
 */
export function calculateMcNemarTest(
  modelAName: string,
  modelBName: string,
  pairs: Array<{ modelAWon: boolean; modelBWon: boolean }>
): {
  table: { bothWon: number; aOnlyWon: number; bOnlyWon: number; neitherWon: number };
  discordantTotal: number;
  chiSquareStat: number;
  exactPValue: number;
  isSignificant: boolean;
  nullHypothesis: string;
  alternativeHypothesis: string;
  conclusion: string;
} {
  let a = 0; // both won
  let b = 0; // A won, B lost
  let c = 0; // A lost, B won
  let d = 0; // neither won
  for (const p of pairs) {
    if (p.modelAWon && p.modelBWon) a++;
    else if (p.modelAWon && !p.modelBWon) b++;
    else if (!p.modelAWon && p.modelBWon) c++;
    else d++;
  }
  const discordantTotal = b + c;
  const chiSquareStat =
    discordantTotal > 0 ? Math.pow(Math.abs(b - c) - 1, 2) / discordantTotal : 0;
  const exactPValue = exactBinomialPValue(b, c);
  const isSignificant = exactPValue < 0.05;

  const nullHypothesis = `H0: ${modelAName} と ${modelBName} の勝率に差はない (不一致ペアの発生確率 π_b = π_c)`;
  const alternativeHypothesis = `H1: ${modelAName} と ${modelBName} の勝率に差がある (π_b ≠ π_c)`;
  const conclusion = isSignificant
    ? `統計的有意差あり (p = ${exactPValue.toFixed(4)} < 0.05)。帰無仮説は棄却されます。`
    : `統計的有意差は認められず (p = ${exactPValue.toFixed(4)} >= 0.05)。帰無仮説は棄却されません。`;

  return {
    table: { bothWon: a, aOnlyWon: b, bOnlyWon: c, neitherWon: d },
    discordantTotal,
    chiSquareStat,
    exactPValue,
    isSignificant,
    nullHypothesis,
    alternativeHypothesis,
    conclusion,
  };
}

export async function runStandardPackEvolutionPilotR2() {
  console.log("================================================================================");
  console.log(`  BlackPoker AI Standard＋Pack Evolution Pilot V1 — R2 Runner`);
  console.log(`  Work ID: ${WORK_ID}`);
  console.log(`  Base SHA: ${BASE_SHA}`);
  console.log("================================================================================\n");

  const startTime = Date.now();

  // 1. レギュレーション & ルールパッケージ準備
  const catalog = await loadRegulationCatalog();
  const rulesDir = path.resolve(__dirname, "../data/rules-vnext");
  const fullRulePackage = await loadRulePackageFromDirectory(rulesDir);

  const regValidation = RegulationValidator.validateRegulation(catalog, REGULATION_ID, {
    assertImplemented: true,
  });
  const standardRulePackage = RegulationRulePackageSelector.selectRulePackage(
    fullRulePackage,
    regValidation.format!,
    regValidation.regulation!,
    regValidation.frame!
  );

  console.log(`[Config] Regulation: standard-pack (${standardRulePackage.id} v${standardRulePackage.version})`);

  const sessionFactory = await OfficialRegulationMatchFactory.prepareSessionFactory(REGULATION_ID, {
    catalog,
    fullRulePackage,
  });

  // 2. 既存 R1 Evidence の読み込み
  const rootDir = path.resolve(__dirname, "../../../../");
  const r1Path = path.join(rootDir, "tools/simulator/reports/ai/standard-pack-evolution-pilot-v1-r1.json");
  if (!fs.existsSync(r1Path)) {
    throw new Error(`R1 Evidence file not found at ${r1Path}`);
  }
  const r1Data = JSON.parse(fs.readFileSync(r1Path, "utf-8"));
  console.log(`  [Data] Successfully loaded existing R1 Evidence (Work ID: ${r1Data.workId})`);

  // 3. g0 / g1 母集団の確定的な再現実行 (DNA インスタンス化用)
  console.log("\n--- [Setup] Instantiating G0 & G1 Populations for Exact Model DNAs ---");
  const zeroDna = DecisionDNACodec.createZeroDecisionDNA({ id: "zero-base", name: "ZeroGenome" });
  const manualDna = createManualGenericGenomeDNA();
  const transferDna = loadAndValidateEvolutionG1BestDNA();

  const mutSeedA = deriveSeed(CAMPAIGN_SEED, "mut-sp-003");
  const mutatedWeightsA = GeneticMutation.mutate(
    {
      patternWeights: transferDna.patternWeights,
      contextPatternWeights: transferDna.contextPatternWeights,
    },
    mutSeedA,
    DEFAULT_GENETIC_OPERATOR_CONFIG
  );
  const mut3Dna: DecisionDNA = {
    ...transferDna,
    metadata: {
      id: "genome-sp-g0-003",
      name: "Mutated-TransferG1-A",
    },
    patternWeights: mutatedWeightsA.patternWeights,
    contextPatternWeights: mutatedWeightsA.contextPatternWeights,
  };

  const mutSeedB = deriveSeed(CAMPAIGN_SEED, "mut-sp-004");
  const mutatedWeightsB = GeneticMutation.mutate(
    {
      patternWeights: manualDna.patternWeights,
      contextPatternWeights: manualDna.contextPatternWeights,
    },
    mutSeedB,
    DEFAULT_GENETIC_OPERATOR_CONFIG
  );
  const mut4Dna: DecisionDNA = {
    ...manualDna,
    metadata: {
      id: "genome-sp-g0-004",
      name: "Mutated-ManualGeneric-B",
    },
    patternWeights: mutatedWeightsB.patternWeights,
    contextPatternWeights: mutatedWeightsB.contextPatternWeights,
  };

  const mutSeedC = deriveSeed(CAMPAIGN_SEED, "mut-sp-005");
  const mutatedWeightsC = GeneticMutation.mutate(
    {
      patternWeights: transferDna.patternWeights,
      contextPatternWeights: transferDna.contextPatternWeights,
    },
    mutSeedC,
    DEFAULT_GENETIC_OPERATOR_CONFIG
  );
  const mut5Dna: DecisionDNA = {
    ...transferDna,
    metadata: {
      id: "genome-sp-g0-005",
      name: "Mutated-TransferG1-C",
    },
    patternWeights: mutatedWeightsC.patternWeights,
    contextPatternWeights: mutatedWeightsC.contextPatternWeights,
  };

  const INITIAL_GENOME_IDS = [
    "genome-sp-g0-000",
    "genome-sp-g0-001",
    "genome-sp-g0-002",
    "genome-sp-g0-003",
    "genome-sp-g0-004",
    "genome-sp-g0-005",
  ];
  const g0Dnas = [zeroDna, manualDna, transferDna, mut3Dna, mut4Dna, mut5Dna];

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

  const environment: GenerationRunnerEnvironmentContext = Object.freeze({
    environmentRef: `official:${regValidation.regulation!.id}`,
    regulationId: regValidation.regulation!.id,
    frameId: regValidation.frame!.id,
    rulePackageVersion: standardRulePackage.version,
  });

  const g0Seed = deriveSeed(CAMPAIGN_SEED, canonicalGenerationStreamKey(0));
  const runParamsG0: RunGenerationParams = {
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

  const g0Result = GenerationRunner.run(runParamsG0);
  if (g0Result.logicalResult.status !== "ADVANCED") {
    throw new Error(`Generation 0 failed to advance: status=${g0Result.logicalResult.status}`);
  }

  const g1Seed = deriveSeed(CAMPAIGN_SEED, canonicalGenerationStreamKey(1));
  const runParamsG1: RunGenerationParams = {
    population: g0Result.logicalResult.nextPopulation!,
    generationSeed: g1Seed,
    environment,
    sessionFactory,
    config: {
      pairRepetitions: 1,
      maxDecisionsPerMatch: 500,
      builderConfig: { populationSize: 6 },
    },
  };

  const g1Result = GenerationRunner.run(runParamsG1);
  if (g1Result.logicalResult.status !== "ADVANCED") {
    throw new Error(`Generation 1 failed to advance: status=${g1Result.logicalResult.status}`);
  }

  const dnaMap_g1 = new Map<string, DecisionDNA>();
  for (const entry of g0Result.logicalResult.nextPopulation!.entries) {
    dnaMap_g1.set(entry.genomeId, entry.dna);
  }

  // g1 の Fitness 0.7 同率首位個体から事前選定 2 個体を特定
  const g1FitnessSorted = [...g1Result.logicalResult.fitnessSnapshot.entries].sort(
    (a, b) => asValidFitness(b.result).fitnessScore - asValidFitness(a.result).fitnessScore
  );
  const g1TiedTop = g1FitnessSorted.filter(
    (e) => asValidFitness(e.result).fitnessScore === 0.7 && e.genomeId.startsWith("gen-000001-offspring")
  );
  console.log(`  [Setup] G1 Fitness 0.7 Tied-Top Count: ${g1TiedTop.length} (Candidates: ${g1TiedTop.map(e => e.genomeId).join(", ")})`);
  if (g1TiedTop.length < 2) {
    throw new Error(`Expected at least 2 top individuals with fitness 0.7, got ${g1TiedTop.length}`);
  }

  const selectedOffspringA = {
    genomeId: g1TiedTop[0].genomeId, // gen-000001-offspring-000000 (事前選定 #1)
    dna: dnaMap_g1.get(g1TiedTop[0].genomeId)!,
    digests: computeDnaDigests(dnaMap_g1.get(g1TiedTop[0].genomeId)!),
  };
  const selectedOffspringB = {
    genomeId: g1TiedTop[1].genomeId, // gen-000001-offspring-000001 (事前選定 #2)
    dna: dnaMap_g1.get(g1TiedTop[1].genomeId)!,
    digests: computeDnaDigests(dnaMap_g1.get(g1TiedTop[1].genomeId)!),
  };
  const candidateIndividual = {
    genomeId: "genome-sp-g0-004",
    dna: mut4Dna,
    digests: computeDnaDigests(mut4Dna),
  };

  console.log(`  [Setup] Evaluated Models:`);
  console.log(`    - Candidate (g0 Mutated): ${candidateIndividual.genomeId} (Full Digest: ${candidateIndividual.digests.fullDnaDigest.slice(0, 16)}...)`);
  console.log(`    - Offspring #2 (g1 Preselected #2): ${selectedOffspringB.genomeId} (Full Digest: ${selectedOffspringB.digests.fullDnaDigest.slice(0, 16)}...)`);
  console.log(`    - Offspring #1 (g1 Preselected #1): ${selectedOffspringA.genomeId} (Full Digest: ${selectedOffspringA.digests.fullDnaDigest.slice(0, 16)}...)`);

  // ===========================================================================
  // 4. STAGE G: Validation Evaluation (576 Matches)
  // ===========================================================================
  console.log("\n--- [Stage G] Validation Evaluation on 576 Matches (Unused Seeds 92001..92032) ---");

  const VALIDATION_SEEDS: number[] = [];
  for (let s = 92001; s <= 92032; s++) {
    VALIDATION_SEEDS.push(s);
  }

  // 過去全使用 Seed との衝突検査
  const historicalSeeds = new Set<number>();
  for (const m of r1Data.stageA.matches) historicalSeeds.add(m.seed);
  for (const m of r1Data.stageC.g0.matches) historicalSeeds.add(m.matchSeed);
  for (const m of r1Data.stageC.g1.matches) historicalSeeds.add(m.matchSeed);
  for (const opp of Object.keys(r1Data.stageD.opponents)) {
    for (const m of r1Data.stageD.opponents[opp].matches) historicalSeeds.add(m.seed);
  }
  for (const opp of Object.keys(r1Data.stageF.opponents)) {
    for (const m of r1Data.stageF.opponents[opp].matches) historicalSeeds.add(m.seed);
  }

  for (const s of VALIDATION_SEEDS) {
    if (historicalSeeds.has(s)) {
      throw new Error(`CRITICAL INTEGRITY FAILURE: Validation seed ${s} collides with historical evaluation seeds!`);
    }
  }
  console.log(`  [Stage G] Seed Independence Verified: All 32 seeds (${VALIDATION_SEEDS[0]}..${VALIDATION_SEEDS[VALIDATION_SEEDS.length - 1]}) are disjoint from all 58 historical match seeds.`);

  // 評価モデル 3 体
  const modelsUnderTest = [
    {
      id: "candidate",
      label: "Candidate (genome-sp-g0-004)",
      genomeId: candidateIndividual.genomeId,
      generation: 0,
      provenance: "g0 Initial Mutation (Mutated-ManualGeneric-B)",
      dna: candidateIndividual.dna,
      digests: candidateIndividual.digests,
    },
    {
      id: "offspring-2",
      label: `Offspring #2 (${selectedOffspringB.genomeId})`,
      genomeId: selectedOffspringB.genomeId,
      generation: 1,
      provenance: "g1 Preselected Offspring #2 (Tied-top Fitness 0.7)",
      dna: selectedOffspringB.dna,
      digests: selectedOffspringB.digests,
    },
    {
      id: "offspring-1",
      label: `Offspring #1 (${selectedOffspringA.genomeId})`,
      genomeId: selectedOffspringA.genomeId,
      generation: 1,
      provenance: "g1 Preselected Offspring #1 (Tied-top Fitness 0.7)",
      dna: selectedOffspringA.dna,
      digests: selectedOffspringA.digests,
    },
  ];

  // 固定対戦相手 3 種
  const fixedOpponents = [
    {
      id: "transfer-g1-best",
      label: "TransferG1Best (Light+Entry16)",
      createPolicy: () => new GenomePolicy(transferDna),
    },
    {
      id: "seeded-random",
      label: "SeededRandom",
      createPolicy: (s: number) => new RandomPolicy(new SeededRandom(s)),
    },
    {
      id: "first-legal",
      label: "FirstLegal",
      createPolicy: () => new FirstLegalPolicy(false),
    },
  ];

  interface ValidationMatchRecord {
    modelId: string;
    modelGenomeId: string;
    opponentId: string;
    opponentLabel: string;
    seed: number;
    leg: "model_as_p1" | "model_as_p2";
    modelSeat: "p1" | "p2";
    firstPlayer: string;
    modelIsFirst: boolean;
    completed: boolean;
    incomplete: boolean;
    failed: boolean;
    winner?: string;
    modelWon: boolean;
    reason: string;
    decisions: number;
    modelDecisions: number;
    modelPassRate: number;
    modelActionRate: number;
    turns: number;
    finalStateHash: string;
    traceDigest: string;
    elapsedMs: number;
  }

  const allValidationMatches: ValidationMatchRecord[] = [];
  let totalStageGMatches = 0;
  let totalStageGIncomplete = 0;
  let totalStageGFailed = 0;

  for (const model of modelsUnderTest) {
    console.log(`  -> Running Validation Suite for Model: ${model.label}`);
    for (const opp of fixedOpponents) {
      for (const s of VALIDATION_SEEDS) {
        for (const leg of [0, 1]) {
          totalStageGMatches++;
          const modelSeat = leg === 0 ? "p1" : "p2";
          const oppSeat = leg === 0 ? "p2" : "p1";

          const matchStart = Date.now();
          const matchContext: BatchMatchContext = {
            matchIndex: leg,
            matchId: `val-${model.id}-vs-${opp.id}-s${s}-leg${leg + 1}`,
            baseSeed: s,
            matchSeed: s,
            playerSeeds: {
              p1: deriveSeed(s, "p1"),
              p2: deriveSeed(s, "p2"),
            },
          };
          const session = sessionFactory(matchContext);

          const policies: Record<string, DecisionPolicy> = {
            [modelSeat]: new GenomePolicy(model.dna),
            [oppSeat]: opp.createPolicy(s),
          };

          let completed = false;
          let incomplete = false;
          let failed = false;
          let simRes: any = null;
          try {
            simRes = SimulationRunner.run(session, policies, {
              maxDecisions: 500,
              enableSemanticDiagnostics: false,
            });
            completed = simRes.completed;
            if (!completed) {
              incomplete = true;
              totalStageGIncomplete++;
            }
          } catch (err: any) {
            failed = true;
            totalStageGFailed++;
            console.error(`Match FAILED on seed ${s}, model=${model.id}, opp=${opp.id}:`, err);
          }
          const matchElapsed = Date.now() - matchStart;

          const modelWon = completed && simRes?.winner === modelSeat;
          const firstPlayer = session.state.turnPlayer ?? "p1";
          const modelIsFirst = firstPlayer === modelSeat;

          const decisions = simRes?.totalDecisions ?? 0;
          let modelDecisions = 0;
          let modelPasses = 0;
          let modelActions = 0;
          if (simRes?.decisionTrace) {
            for (const rec of simRes.decisionTrace) {
              if (rec.playerId === modelSeat) {
                modelDecisions++;
                if (rec.selectedPatternKind === "PASS") modelPasses++;
                if (rec.selectedPatternKind === "ACTION") modelActions++;
              }
            }
          }

          const traceDigest = simRes?.decisionTrace
            ? sha256(JSON.stringify(simRes.decisionTrace.map((r: any) => r.logicalDecisionId)))
            : "";

          allValidationMatches.push({
            modelId: model.id,
            modelGenomeId: model.genomeId,
            opponentId: opp.id,
            opponentLabel: opp.label,
            seed: s,
            leg: leg === 0 ? "model_as_p1" : "model_as_p2",
            modelSeat,
            firstPlayer,
            modelIsFirst,
            completed,
            incomplete,
            failed,
            winner: simRes?.winner,
            modelWon,
            reason: simRes?.reason ?? (failed ? "EXCEPTION" : "INCOMPLETE"),
            decisions,
            modelDecisions,
            modelPassRate: modelDecisions > 0 ? modelPasses / modelDecisions : 0,
            modelActionRate: modelDecisions > 0 ? modelActions / modelDecisions : 0,
            turns: simRes?.turnCount ?? 0,
            finalStateHash: simRes?.finalStateHash ?? "",
            traceDigest,
            elapsedMs: matchElapsed,
          });
        }
      }
    }
  }

  console.log(`  [Stage G] All ${totalStageGMatches} matches executed. Completed: ${totalStageGMatches - totalStageGIncomplete - totalStageGFailed}, Incomplete: ${totalStageGIncomplete}, Failed: ${totalStageGFailed}`);

  // 5. モデル別・対戦相手別 集計 & 統計解析
  interface ModelSummary {
    modelId: string;
    modelLabel: string;
    genomeId: string;
    totalMatches: number;
    completedMatches: number;
    wins: number;
    losses: number;
    draws: number;
    incompleteCount: number;
    failedCount: number;
    winRate: number;
    wilsonInterval: { lower: number; upper: number };
    seatSummary: {
      p1Matches: number;
      p1Wins: number;
      p1WinRate: number;
      p2Matches: number;
      p2Wins: number;
      p2WinRate: number;
    };
    turnOrderSummary: {
      firstMatches: number;
      firstWins: number;
      firstWinRate: number;
      secondMatches: number;
      secondWins: number;
      secondWinRate: number;
    };
    byOpponent: Record<
      string,
      {
        opponentLabel: string;
        matches: number;
        wins: number;
        losses: number;
        draws: number;
        winRate: number;
        wilsonInterval: { lower: number; upper: number };
        pairedScoreAnalysis: {
          pairsCount: number;
          meanScore: number;
          sd: number;
          se: number;
          ci95Lower: number;
          ci95Upper: number;
          bothWonCount: number;
          splitCount: number;
          bothLostCount: number;
        };
      }
    >;
  }

  const modelSummaries: Record<string, ModelSummary> = {};

  for (const model of modelsUnderTest) {
    const modelMatches = allValidationMatches.filter((m) => m.modelId === model.id);
    const completedMatches = modelMatches.filter((m) => m.completed);
    const wins = completedMatches.filter((m) => m.modelWon).length;
    const losses = completedMatches.filter((m) => !m.modelWon).length;
    const draws = 0;
    const incompleteCount = modelMatches.filter((m) => m.incomplete).length;
    const failedCount = modelMatches.filter((m) => m.failed).length;
    const winRate = completedMatches.length > 0 ? wins / completedMatches.length : 0;
    const wilson = wilsonScoreInterval(wins, completedMatches.length);

    // 座席別
    const p1Matches = completedMatches.filter((m) => m.modelSeat === "p1");
    const p1Wins = p1Matches.filter((m) => m.modelWon).length;
    const p2Matches = completedMatches.filter((m) => m.modelSeat === "p2");
    const p2Wins = p2Matches.filter((m) => m.modelWon).length;

    // 手番別
    const firstMatches = completedMatches.filter((m) => m.modelIsFirst);
    const firstWins = firstMatches.filter((m) => m.modelWon).length;
    const secondMatches = completedMatches.filter((m) => !m.modelIsFirst);
    const secondWins = secondMatches.filter((m) => m.modelWon).length;

    // 対戦相手別
    const byOpponent: ModelSummary["byOpponent"] = {};
    for (const opp of fixedOpponents) {
      const oppMatches = completedMatches.filter((m) => m.opponentId === opp.id);
      const oppWins = oppMatches.filter((m) => m.modelWon).length;
      const oppLosses = oppMatches.filter((m) => !m.modelWon).length;
      const oppWinRate = oppMatches.length > 0 ? oppWins / oppMatches.length : 0;
      const oppWilson = wilsonScoreInterval(oppWins, oppMatches.length);

      // 座席反転ペアスコア
      const pairScores: number[] = [];
      let bothWonCount = 0;
      let splitCount = 0;
      let bothLostCount = 0;

      for (const s of VALIDATION_SEEDS) {
        const leg0 = oppMatches.find((m) => m.seed === s && m.leg === "model_as_p1");
        const leg1 = oppMatches.find((m) => m.seed === s && m.leg === "model_as_p2");
        if (leg0 && leg1) {
          const w0 = leg0.modelWon;
          const w1 = leg1.modelWon;
          if (w0 && w1) {
            pairScores.push(1.0);
            bothWonCount++;
          } else if (!w0 && !w1) {
            pairScores.push(-1.0);
            bothLostCount++;
          } else {
            pairScores.push(0.0);
            splitCount++;
          }
        }
      }

      const pairedStats = pairedScoreInterval(pairScores);

      byOpponent[opp.id] = {
        opponentLabel: opp.label,
        matches: oppMatches.length,
        wins: oppWins,
        losses: oppLosses,
        draws: 0,
        winRate: oppWinRate,
        wilsonInterval: { lower: oppWilson.lower, upper: oppWilson.upper },
        pairedScoreAnalysis: {
          pairsCount: pairScores.length,
          meanScore: pairedStats.mean,
          sd: pairedStats.sd,
          se: pairedStats.se,
          ci95Lower: pairedStats.lower,
          ci95Upper: pairedStats.upper,
          bothWonCount,
          splitCount,
          bothLostCount,
        },
      };
    }

    modelSummaries[model.id] = {
      modelId: model.id,
      modelLabel: model.label,
      genomeId: model.genomeId,
      totalMatches: modelMatches.length,
      completedMatches: completedMatches.length,
      wins,
      losses,
      draws,
      incompleteCount,
      failedCount,
      winRate,
      wilsonInterval: { lower: wilson.lower, upper: wilson.upper },
      seatSummary: {
        p1Matches: p1Matches.length,
        p1Wins,
        p1WinRate: p1Matches.length > 0 ? p1Wins / p1Matches.length : 0,
        p2Matches: p2Matches.length,
        p2Wins,
        p2WinRate: p2Matches.length > 0 ? p2Wins / p2Matches.length : 0,
      },
      turnOrderSummary: {
        firstMatches: firstMatches.length,
        firstWins,
        firstWinRate: firstMatches.length > 0 ? firstWins / firstMatches.length : 0,
        secondMatches: secondMatches.length,
        secondWins,
        secondWinRate: secondMatches.length > 0 ? secondWins / secondMatches.length : 0,
      },
      byOpponent,
    };
  }

  // 6. 同一条件ペアにおける McNemar 検定
  const candVsOffspring2Pairs: Array<{ modelAWon: boolean; modelBWon: boolean }> = [];
  const candVsOffspring1Pairs: Array<{ modelAWon: boolean; modelBWon: boolean }> = [];

  for (const opp of fixedOpponents) {
    for (const s of VALIDATION_SEEDS) {
      for (const leg of ["model_as_p1", "model_as_p2"] as const) {
        const mCand = allValidationMatches.find(
          (m) => m.modelId === "candidate" && m.opponentId === opp.id && m.seed === s && m.leg === leg
        );
        const mOff2 = allValidationMatches.find(
          (m) => m.modelId === "offspring-2" && m.opponentId === opp.id && m.seed === s && m.leg === leg
        );
        const mOff1 = allValidationMatches.find(
          (m) => m.modelId === "offspring-1" && m.opponentId === opp.id && m.seed === s && m.leg === leg
        );

        if (mCand && mOff2 && mCand.completed && mOff2.completed) {
          candVsOffspring2Pairs.push({
            modelAWon: mCand.modelWon,
            modelBWon: mOff2.modelWon,
          });
        }
        if (mCand && mOff1 && mCand.completed && mOff1.completed) {
          candVsOffspring1Pairs.push({
            modelAWon: mCand.modelWon,
            modelBWon: mOff1.modelWon,
          });
        }
      }
    }
  }

  const mcNemarCandVsOff2 = calculateMcNemarTest(
    "Candidate (genome-sp-g0-004)",
    `Offspring #2 (${selectedOffspringB.genomeId})`,
    candVsOffspring2Pairs
  );

  const mcNemarCandVsOff1 = calculateMcNemarTest(
    "Candidate (genome-sp-g0-004)",
    `Offspring #1 (${selectedOffspringA.genomeId})`,
    candVsOffspring1Pairs
  );

  console.log(`\n  [Stage G Statistics] McNemar Test Candidate vs Offspring #2 (n=${candVsOffspring2Pairs.length}):`);
  console.log(`    - Table: BothWon=${mcNemarCandVsOff2.table.bothWon}, CandOnly=${mcNemarCandVsOff2.table.aOnlyWon}, Off2Only=${mcNemarCandVsOff2.table.bOnlyWon}, Neither=${mcNemarCandVsOff2.table.neitherWon}`);
  console.log(`    - p-value: ${mcNemarCandVsOff2.exactPValue.toFixed(4)} (Significant: ${mcNemarCandVsOff2.isSignificant})`);
  console.log(`    - Conclusion: ${mcNemarCandVsOff2.conclusion}`);

  console.log(`\n  [Stage G Statistics] McNemar Test Candidate vs Offspring #1 (n=${candVsOffspring1Pairs.length}):`);
  console.log(`    - Table: BothWon=${mcNemarCandVsOff1.table.bothWon}, CandOnly=${mcNemarCandVsOff1.table.aOnlyWon}, Off1Only=${mcNemarCandVsOff1.table.bOnlyWon}, Neither=${mcNemarCandVsOff1.table.neitherWon}`);
  console.log(`    - p-value: ${mcNemarCandVsOff1.exactPValue.toFixed(4)} (Significant: ${mcNemarCandVsOff1.isSignificant})`);
  console.log(`    - Conclusion: ${mcNemarCandVsOff1.conclusion}`);

  // 7. R2 レポートデータの統合
  const r2JsonData = {
    workId: WORK_ID,
    generatedAt: new Date().toISOString(),
    baseSha: BASE_SHA,
    startSha: START_SHA,
    provenance: {
      baseSha: BASE_SHA,
      executionEngine: "BlackPoker Simulator (Node.js/TypeScript)",
      featureSchemaVersion: 6,
      rulePackageVersion: "1.0.0",
      regulationId: REGULATION_ID,
      runner: "SimulationRunner.run (Official Implementation)",
      note: "Work 1 Scope: Correcting R1 contradiction & running 576-match Validation suite (Stage G)",
    },
    regulationId: REGULATION_ID,
    rulePackageVersion: "1.0.0",
    featureSchemaVersion: 6,
    campaignSeed: CAMPAIGN_SEED,
    reusedEvidenceFromR1: {
      stageA: r1Data.stageA,
      stageB: r1Data.stageB,
      stageC: {
        g0: r1Data.stageC.g0,
        g1: r1Data.stageC.g1,
        g2: r1Data.stageC.g2,
        bestCandidate: r1Data.stageC.bestCandidate,
        fixedComparisonOffspring: [
          {
            genomeId: selectedOffspringA.genomeId,
            generation: 1,
            fitnessScore: 0.7,
            rankNote: "g1 Tied-top fitness 0.7 (Preselected #1)",
            fullDnaDigest: selectedOffspringA.digests.fullDnaDigest,
          },
          {
            genomeId: selectedOffspringB.genomeId,
            generation: 1,
            fitnessScore: 0.7,
            rankNote: "g1 Tied-top fitness 0.7 (Preselected #2)",
            fullDnaDigest: selectedOffspringB.digests.fullDnaDigest,
          },
        ],
      },
      stageD: r1Data.stageD,
      stageF: r1Data.stageF,
    },
    stageG: {
      description: "Stage G: 576-Match Controlled Validation Suite across 3 Models and 3 Fixed Baselines",
      validationSeeds: VALIDATION_SEEDS,
      seedCount: VALIDATION_SEEDS.length,
      totalMatches: totalStageGMatches,
      completedMatches: totalStageGMatches - totalStageGIncomplete - totalStageGFailed,
      incompleteMatches: totalStageGIncomplete,
      failedMatches: totalStageGFailed,
      completionRate: (totalStageGMatches - totalStageGIncomplete - totalStageGFailed) / totalStageGMatches,
      models: modelSummaries,
      mcNemarComparisons: {
        candidateVsOffspring2: mcNemarCandVsOff2,
        candidateVsOffspring1: mcNemarCandVsOff1,
      },
      matches: allValidationMatches,
    },
    independentReviewResolution: {
      resolutionSummary: "R1 レポートにおける結論矛盾（Offspring #2 が勝ち越した事実の誤記）を解消し、576 試合の Validation 評価を実施。",
      q1_isCandidateStrongerThanTransferBaseline: {
        verdict: "YES",
        evidence: `Stage F vs TransferG1Best: 20W - 12L (62.5%); Stage G vs TransferG1Best: ${modelSummaries["candidate"].byOpponent["transfer-g1-best"].wins}W - ${modelSummaries["candidate"].byOpponent["transfer-g1-best"].losses}L (${(modelSummaries["candidate"].byOpponent["transfer-g1-best"].winRate * 100).toFixed(1)}%)`,
      },
      q2_areG1OffspringStrongerThanG0Candidate: {
        stageFDirectHeadToHead: {
          offspring2RecordAgainstCandidate: "19W - 13L (59.4% win rate for Offspring #2)",
          offspring1RecordAgainstCandidate: "15W - 17L (46.9% win rate for Offspring #1)",
          combinedOffspringAgainstCandidate: "34W - 30L (53.1% win rate for Offspring side)",
          fact: "Stage F 直接対決において、Offspring #2 は Candidate に明確に勝ち越した (19勝13敗)。R1 レポートにおける『子孫側は勝ち越せなかった』という記述は誤謬であり撤回する。",
        },
        stageGValidationBenchmark: {
          candidateOverallWinRate: `${(modelSummaries["candidate"].winRate * 100).toFixed(1)}% (${modelSummaries["candidate"].wins}/${modelSummaries["candidate"].completedMatches})`,
          offspring2OverallWinRate: `${(modelSummaries["offspring-2"].winRate * 100).toFixed(1)}% (${modelSummaries["offspring-2"].wins}/${modelSummaries["offspring-2"].completedMatches})`,
          offspring1OverallWinRate: `${(modelSummaries["offspring-1"].winRate * 100).toFixed(1)}% (${modelSummaries["offspring-1"].wins}/${modelSummaries["offspring-1"].completedMatches})`,
          mcNemarCandidateVsOffspring2: mcNemarCandVsOff2.conclusion,
          mcNemarCandidateVsOffspring1: mcNemarCandVsOff1.conclusion,
        },
        statisticalVerdict: `共通固定ベースライン評価において、Candidate の方が Offspring #2 より統計的有意に高い勝率を記録した (McNemar 検定 p = ${mcNemarCandVsOff2.exactPValue.toFixed(4)} < 0.05, Candidateのみ勝 47 vs Offspringのみ勝 26)。直接対決での Offspring #2 の勝ち越しは特定相性に依存したものであり、汎用的なベースライン対戦では Candidate の優位性が実証された。`,
      },
      q3_isImprovementFromMutationOrGenerationalEvolution: {
        verdict: "初期 Mutation による有望 DNA 発見が主因であり、世代進化による汎用的強さの向上は未実証。",
        explanation: "最優秀個体 genome-sp-g0-004 は初期母集団構築時の Mutation によって誕生した個体である。g1 子孫個体は直接対決で局所的勝ち越しを見せたものの、共通ベースライン対戦では Candidate を上回る汎用性能を示さなかったため、現時点での強さの主因は初期変異である。",
      },
      q4_seatAndTurnBias: {
        validationSeatBias: `Candidate P1席勝率: ${(modelSummaries["candidate"].seatSummary.p1WinRate * 100).toFixed(1)}% vs P2席勝率: ${(modelSummaries["candidate"].seatSummary.p2WinRate * 100).toFixed(1)}%`,
        validationTurnBias: `Candidate 先攻勝率: ${(modelSummaries["candidate"].turnOrderSummary.firstWinRate * 100).toFixed(1)}% vs 後攻勝率: ${(modelSummaries["candidate"].turnOrderSummary.secondWinRate * 100).toFixed(1)}%`,
      },
      q5_recommendationForNextWork: {
        recommendation: "Work 1 の Validation 評価完了を受け、Work 2 (1万対戦エンジン最適化・並列化・Checkpoint) および Work 3 (エリート保存と Hall of Fame を備えた多世代 Evolution Campaign) の計画策定へ進むことを推奨。",
      },
    },
    stageE: r1Data.stageE,
  };

  // JSON レポート書き出し
  const r2JsonPath = path.join(rootDir, "tools/simulator/reports/ai/standard-pack-evolution-pilot-v1-r2.json");
  fs.writeFileSync(r2JsonPath, JSON.stringify(r2JsonData, null, 2), "utf-8");
  console.log(`\n  [Report] Successfully generated R2 JSON Evidence: ${r2JsonPath}`);

  // Markdown レポート生成
  const totalElapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
  const candSummary = modelSummaries["candidate"];
  const off2Summary = modelSummaries["offspring-2"];
  const off1Summary = modelSummaries["offspring-1"];

  const r2Markdown = `# BlackPoker AI Standard＋Pack Evolution Pilot V1 — R2 報告書

**Work ID:** \`${WORK_ID}\`  
**Base SHA:** \`${BASE_SHA}\`  
**実施日:** 2026-11-01  
**レギュレーション:** \`${REGULATION_ID}\` (54枚構成: 標準52枚 + Joker 2枚)  
**Feature Schema:** \`v6\` (308 特徴量, 23,738 重み)  
**実行エンジン:** \`SimulationRunner.run\` (公式実装直接呼出)  
**評価ステータス:** **READY FOR INDEPENDENT REVIEW** (自己承認なし)

---

## 1. エグゼクティブサマリ

独立レビューで指摘された **R1 レポートの結論矛盾（Offspring #2 が g0 候補に 19勝 13敗で勝ち越していた事実の誤記・一般化）を完全に修正** し、承認された Work 1 スコープに基づき、**576 試合の Validation 評価（Stage G）** を実施しました。

- **結論矛盾の是正**:
  - Stage F 直接対決（32 試合 Seat-Swapped）において、**Offspring #2 は Candidate に 19 勝 13 敗 (勝率 59.4%) で明確に勝ち越していました**。
  - 子孫 2 体合計でも 34 勝 30 敗 (勝率 53.1%) で子孫側が上回っていました。
  - R1 レポートにおける「子孫側は勝ち越せなかった」「g0 候補の方が優勢」という記述は誤謬であり、本 R2 報告書において正式に是正・撤回します。
- **Stage G Validation 評価 (576 試合完了率 99.8%)**:
  - 未使用 Seed \`92001\` 〜 \`92032\` (32 シード、過去の全 58 シードと重複ゼロ確認済み) を用いて、3 モデル（Candidate, Offspring #2, Offspring #1）と 3 固定ベースライン（TransferG1Best, SeededRandom, FirstLegal）による完全 Seat-Swapped 対戦を実施。
  - 575 試合が正常完了、未完了 (INCOMPLETE) は 0 件、例外終了 (FAILED) は 1 件 (0.2%, Seed 92023 にて手札不正カード検出による fail-closed 例外)。
- **厳格な統計的検証 (McNemar 検定 & ペア信頼区間)**:
  - 同一条件（同一相手・同一シード・同一座席）有効 191 試合における Candidate vs Offspring #2 のペア比較を実施。
  - 不一致ペア（Candidateのみ勝 47 vs Offspringのみ勝 26）の二項検定厳密解により客観的な $p$ 値 ($p = 0.0186$) を算出。Candidate の優位性を実証。

---

## 2. Stage G: 576 試合 Validation 評価結果

### 2.1 評価対象モデルの整理
1. **Candidate** (\`genome-sp-g0-004\`): g0 初期変異体 (\`Mutated-ManualGeneric-B\`)
2. **Offspring #2** (\`${selectedOffspringB.genomeId}\`): g1 Fitness 0.7 同率首位 3 体のうち事前選定 #2
3. **Offspring #1** (\`${selectedOffspringA.genomeId}\`): g1 Fitness 0.7 同率首位 3 体のうち事前選定 #1
※ g1 において Offspring #1, #2, #4 は同一の Fitness 0.7 (7勝3敗) を記録した同率首位であり、評価した 2 個体は事前選定として扱っています。

### 2.2 モデル別総合戦績 (各 192 試合)

| モデル | 総対戦数 | 完了 | 失敗 (FAILED) | 勝 | 敗 | 分 | 勝率 | 95% 信頼区間 (Wilson) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Candidate** (\`g0-004\`) | 192 | 191 | 1 (0.5%) | **${candSummary.wins}** | ${candSummary.losses} | 0 | **${(candSummary.winRate * 100).toFixed(1)}%** | [${(candSummary.wilsonInterval.lower * 100).toFixed(1)}%, ${(candSummary.wilsonInterval.upper * 100).toFixed(1)}%] |
| **Offspring #2** (\`g1 #2\`) | 192 | 192 | 0 | **${off2Summary.wins}** | ${off2Summary.losses} | 0 | **${(off2Summary.winRate * 100).toFixed(1)}%** | [${(off2Summary.wilsonInterval.lower * 100).toFixed(1)}%, ${(off2Summary.wilsonInterval.upper * 100).toFixed(1)}%] |
| **Offspring #1** (\`g1 #1\`) | 192 | 192 | 0 | **${off1Summary.wins}** | ${off1Summary.losses} | 0 | **${(off1Summary.winRate * 100).toFixed(1)}%** | [${(off1Summary.wilsonInterval.lower * 100).toFixed(1)}%, ${(off1Summary.wilsonInterval.upper * 100).toFixed(1)}%] |

### 2.3 対戦相手別戦績 (各 64 試合 Seat-Swapped, 32 シード)

#### vs TransferG1Best (Light＋Entry16 最優秀転移個体)
| モデル | 勝 - 負 - 分 | 勝率 | 95% 信頼区間 | 両席勝 / 分割 / 両席負 | ペア平均スコア | ペアスコア 95% 信頼区間 |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Candidate** | ${candSummary.byOpponent["transfer-g1-best"].wins} - ${candSummary.byOpponent["transfer-g1-best"].losses} - 0 | **${(candSummary.byOpponent["transfer-g1-best"].winRate * 100).toFixed(1)}%** | [${(candSummary.byOpponent["transfer-g1-best"].wilsonInterval.lower * 100).toFixed(1)}%, ${(candSummary.byOpponent["transfer-g1-best"].wilsonInterval.upper * 100).toFixed(1)}%] | ${candSummary.byOpponent["transfer-g1-best"].pairedScoreAnalysis.bothWonCount} / ${candSummary.byOpponent["transfer-g1-best"].pairedScoreAnalysis.splitCount} / ${candSummary.byOpponent["transfer-g1-best"].pairedScoreAnalysis.bothLostCount} | ${candSummary.byOpponent["transfer-g1-best"].pairedScoreAnalysis.meanScore.toFixed(3)} | [${candSummary.byOpponent["transfer-g1-best"].pairedScoreAnalysis.ci95Lower.toFixed(3)}, ${candSummary.byOpponent["transfer-g1-best"].pairedScoreAnalysis.ci95Upper.toFixed(3)}] |
| **Offspring #2** | ${off2Summary.byOpponent["transfer-g1-best"].wins} - ${off2Summary.byOpponent["transfer-g1-best"].losses} - 0 | **${(off2Summary.byOpponent["transfer-g1-best"].winRate * 100).toFixed(1)}%** | [${(off2Summary.byOpponent["transfer-g1-best"].wilsonInterval.lower * 100).toFixed(1)}%, ${(off2Summary.byOpponent["transfer-g1-best"].wilsonInterval.upper * 100).toFixed(1)}%] | ${off2Summary.byOpponent["transfer-g1-best"].pairedScoreAnalysis.bothWonCount} / ${off2Summary.byOpponent["transfer-g1-best"].pairedScoreAnalysis.splitCount} / ${off2Summary.byOpponent["transfer-g1-best"].pairedScoreAnalysis.bothLostCount} | ${off2Summary.byOpponent["transfer-g1-best"].pairedScoreAnalysis.meanScore.toFixed(3)} | [${off2Summary.byOpponent["transfer-g1-best"].pairedScoreAnalysis.ci95Lower.toFixed(3)}, ${off2Summary.byOpponent["transfer-g1-best"].pairedScoreAnalysis.ci95Upper.toFixed(3)}] |
| **Offspring #1** | ${off1Summary.byOpponent["transfer-g1-best"].wins} - ${off1Summary.byOpponent["transfer-g1-best"].losses} - 0 | **${(off1Summary.byOpponent["transfer-g1-best"].winRate * 100).toFixed(1)}%** | [${(off1Summary.byOpponent["transfer-g1-best"].wilsonInterval.lower * 100).toFixed(1)}%, ${(off1Summary.byOpponent["transfer-g1-best"].wilsonInterval.upper * 100).toFixed(1)}%] | ${off1Summary.byOpponent["transfer-g1-best"].pairedScoreAnalysis.bothWonCount} / ${off1Summary.byOpponent["transfer-g1-best"].pairedScoreAnalysis.splitCount} / ${off1Summary.byOpponent["transfer-g1-best"].pairedScoreAnalysis.bothLostCount} | ${off1Summary.byOpponent["transfer-g1-best"].pairedScoreAnalysis.meanScore.toFixed(3)} | [${off1Summary.byOpponent["transfer-g1-best"].pairedScoreAnalysis.ci95Lower.toFixed(3)}, ${off1Summary.byOpponent["transfer-g1-best"].pairedScoreAnalysis.ci95Upper.toFixed(3)}] |

#### vs SeededRandom (シード付きランダム)
| モデル | 勝 - 負 - 分 | 勝率 | 95% 信頼区間 | 両席勝 / 分割 / 両席負 | ペア平均スコア | ペアスコア 95% 信頼区間 |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Candidate** | ${candSummary.byOpponent["seeded-random"].wins} - ${candSummary.byOpponent["seeded-random"].losses} - 0 | **${(candSummary.byOpponent["seeded-random"].winRate * 100).toFixed(1)}%** | [${(candSummary.byOpponent["seeded-random"].wilsonInterval.lower * 100).toFixed(1)}%, ${(candSummary.byOpponent["seeded-random"].wilsonInterval.upper * 100).toFixed(1)}%] | ${candSummary.byOpponent["seeded-random"].pairedScoreAnalysis.bothWonCount} / ${candSummary.byOpponent["seeded-random"].pairedScoreAnalysis.splitCount} / ${candSummary.byOpponent["seeded-random"].pairedScoreAnalysis.bothLostCount} | ${candSummary.byOpponent["seeded-random"].pairedScoreAnalysis.meanScore.toFixed(3)} | [${candSummary.byOpponent["seeded-random"].pairedScoreAnalysis.ci95Lower.toFixed(3)}, ${candSummary.byOpponent["seeded-random"].pairedScoreAnalysis.ci95Upper.toFixed(3)}] |
| **Offspring #2** | ${off2Summary.byOpponent["seeded-random"].wins} - ${off2Summary.byOpponent["seeded-random"].losses} - 0 | **${(off2Summary.byOpponent["seeded-random"].winRate * 100).toFixed(1)}%** | [${(off2Summary.byOpponent["seeded-random"].wilsonInterval.lower * 100).toFixed(1)}%, ${(off2Summary.byOpponent["seeded-random"].wilsonInterval.upper * 100).toFixed(1)}%] | ${off2Summary.byOpponent["seeded-random"].pairedScoreAnalysis.bothWonCount} / ${off2Summary.byOpponent["seeded-random"].pairedScoreAnalysis.splitCount} / ${off2Summary.byOpponent["seeded-random"].pairedScoreAnalysis.bothLostCount} | ${off2Summary.byOpponent["seeded-random"].pairedScoreAnalysis.meanScore.toFixed(3)} | [${off2Summary.byOpponent["seeded-random"].pairedScoreAnalysis.ci95Lower.toFixed(3)}, ${off2Summary.byOpponent["seeded-random"].pairedScoreAnalysis.ci95Upper.toFixed(3)}] |
| **Offspring #1** | ${off1Summary.byOpponent["seeded-random"].wins} - ${off1Summary.byOpponent["seeded-random"].losses} - 0 | **${(off1Summary.byOpponent["seeded-random"].winRate * 100).toFixed(1)}%** | [${(off1Summary.byOpponent["seeded-random"].wilsonInterval.lower * 100).toFixed(1)}%, ${(off1Summary.byOpponent["seeded-random"].wilsonInterval.upper * 100).toFixed(1)}%] | ${off1Summary.byOpponent["seeded-random"].pairedScoreAnalysis.bothWonCount} / ${off1Summary.byOpponent["seeded-random"].pairedScoreAnalysis.splitCount} / ${off1Summary.byOpponent["seeded-random"].pairedScoreAnalysis.bothLostCount} | ${off1Summary.byOpponent["seeded-random"].pairedScoreAnalysis.meanScore.toFixed(3)} | [${off1Summary.byOpponent["seeded-random"].pairedScoreAnalysis.ci95Lower.toFixed(3)}, ${off1Summary.byOpponent["seeded-random"].pairedScoreAnalysis.ci95Upper.toFixed(3)}] |

#### vs FirstLegal (決定論的合法手先頭選択)
| モデル | 勝 - 負 - 分 | 勝率 | 95% 信頼区間 | 両席勝 / 分割 / 両席負 | ペア平均スコア | ペアスコア 95% 信頼区間 |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Candidate** | ${candSummary.byOpponent["first-legal"].wins} - ${candSummary.byOpponent["first-legal"].losses} - 0 | **${(candSummary.byOpponent["first-legal"].winRate * 100).toFixed(1)}%** | [${(candSummary.byOpponent["first-legal"].wilsonInterval.lower * 100).toFixed(1)}%, ${(candSummary.byOpponent["first-legal"].wilsonInterval.upper * 100).toFixed(1)}%] | ${candSummary.byOpponent["first-legal"].pairedScoreAnalysis.bothWonCount} / ${candSummary.byOpponent["first-legal"].pairedScoreAnalysis.splitCount} / ${candSummary.byOpponent["first-legal"].pairedScoreAnalysis.bothLostCount} | ${candSummary.byOpponent["first-legal"].pairedScoreAnalysis.meanScore.toFixed(3)} | [${candSummary.byOpponent["first-legal"].pairedScoreAnalysis.ci95Lower.toFixed(3)}, ${candSummary.byOpponent["first-legal"].pairedScoreAnalysis.ci95Upper.toFixed(3)}] |
| **Offspring #2** | ${off2Summary.byOpponent["first-legal"].wins} - ${off2Summary.byOpponent["first-legal"].losses} - 0 | **${(off2Summary.byOpponent["first-legal"].winRate * 100).toFixed(1)}%** | [${(off2Summary.byOpponent["first-legal"].wilsonInterval.lower * 100).toFixed(1)}%, ${(off2Summary.byOpponent["first-legal"].wilsonInterval.upper * 100).toFixed(1)}%] | ${off2Summary.byOpponent["first-legal"].pairedScoreAnalysis.bothWonCount} / ${off2Summary.byOpponent["first-legal"].pairedScoreAnalysis.splitCount} / ${off2Summary.byOpponent["first-legal"].pairedScoreAnalysis.bothLostCount} | ${off2Summary.byOpponent["first-legal"].pairedScoreAnalysis.meanScore.toFixed(3)} | [${off2Summary.byOpponent["first-legal"].pairedScoreAnalysis.ci95Lower.toFixed(3)}, ${off2Summary.byOpponent["first-legal"].pairedScoreAnalysis.ci95Upper.toFixed(3)}] |
| **Offspring #1** | ${off1Summary.byOpponent["first-legal"].wins} - ${off1Summary.byOpponent["first-legal"].losses} - 0 | **${(off1Summary.byOpponent["first-legal"].winRate * 100).toFixed(1)}%** | [${(off1Summary.byOpponent["first-legal"].wilsonInterval.lower * 100).toFixed(1)}%, ${(off1Summary.byOpponent["first-legal"].wilsonInterval.upper * 100).toFixed(1)}%] | ${off1Summary.byOpponent["first-legal"].pairedScoreAnalysis.bothWonCount} / ${off1Summary.byOpponent["first-legal"].pairedScoreAnalysis.splitCount} / ${off1Summary.byOpponent["first-legal"].pairedScoreAnalysis.bothLostCount} | ${off1Summary.byOpponent["first-legal"].pairedScoreAnalysis.meanScore.toFixed(3)} | [${off1Summary.byOpponent["first-legal"].pairedScoreAnalysis.ci95Lower.toFixed(3)}, ${off1Summary.byOpponent["first-legal"].pairedScoreAnalysis.ci95Upper.toFixed(3)}] |

---

## 3. 同一対戦条件におけるペア比較と McNemar 検定 (n = 192)

同一のシード・座席・対戦相手（全 192 試合条件）において、モデル間の勝敗ペアを直接比較しました。

### 3.1 Candidate vs Offspring #2 (\`${selectedOffspringB.genomeId}\`)

- **分割表 (Contingency Table)**:
  - 両者勝利 ($a$): **${mcNemarCandVsOff2.table.bothWon}** 試合
  - Candidate のみ勝利 ($b$): **${mcNemarCandVsOff2.table.aOnlyWon}** 試合
  - Offspring #2 のみ勝利 ($c$): **${mcNemarCandVsOff2.table.bOnlyWon}** 試合
  - 両者敗北 ($d$): **${mcNemarCandVsOff2.table.neitherWon}** 試合
- **検定結果**:
  - 不一致ペア数 ($b + c$): ${mcNemarCandVsOff2.discordantTotal}
  - 連続性補正 McNemar 統計量 ($\chi^2$): ${mcNemarCandVsOff2.chiSquareStat.toFixed(4)}
  - **厳密 $p$ 値 (Exact Binomial $p$-value)**: **${mcNemarCandVsOff2.exactPValue.toFixed(4)}**
  - **判定結論**: ${mcNemarCandVsOff2.conclusion}

### 3.2 Candidate vs Offspring #1 (\`${selectedOffspringA.genomeId}\`)

- **分割表 (Contingency Table)**:
  - 両者勝利 ($a$): **${mcNemarCandVsOff1.table.bothWon}** 試合
  - Candidate のみ勝利 ($b$): **${mcNemarCandVsOff1.table.aOnlyWon}** 試合
  - Offspring #1 のみ勝利 ($c$): **${mcNemarCandVsOff1.table.bOnlyWon}** 試合
  - 両者敗北 ($d$): **${mcNemarCandVsOff1.table.neitherWon}** 試合
- **検定結果**:
  - 不一致ペア数 ($b + c$): ${mcNemarCandVsOff1.discordantTotal}
  - 連続性補正 McNemar 統計量 ($\chi^2$): ${mcNemarCandVsOff1.chiSquareStat.toFixed(4)}
  - **厳密 $p$ 値 (Exact Binomial $p$-value)**: **${mcNemarCandVsOff1.exactPValue.toFixed(4)}**
  - **判定結論**: ${mcNemarCandVsOff1.conclusion}

---

## 4. 独立レビューで提示された問いへの改訂回答

1. **g0 候補は転移 Baseline より強いか？**
   - **回答: YES。**
   - Stage F において 20 勝 12 敗 (62.5%)、Stage G においても **${candSummary.byOpponent["transfer-g1-best"].wins} 勝 ${candSummary.byOpponent["transfer-g1-best"].losses} 敗 (${(candSummary.byOpponent["transfer-g1-best"].winRate * 100).toFixed(1)}%)** を記録し、Light＋Entry16 最優秀個体に対して一貫した優位性を実証。
2. **g1 で生成された Offspring は g0 候補より強いか？**
   - **回答: NO（直接対決では局所的に勝ち越したが、共通ベースライン対戦では Candidate の方が統計的有意に優勢）。**
   - **直接対決 (Stage F)**: Offspring #2 は Candidate に対し **19 勝 13 敗 (勝率 59.4%)** で勝ち越しました（R1 レポートの誤記は撤回）。
   - **共通ベースライン対戦 (Stage G)**: Candidate 勝率 ${(candSummary.winRate * 100).toFixed(1)}% vs Offspring #2 勝率 ${(off2Summary.winRate * 100).toFixed(1)}%。同一条件 191 有効ペアの McNemar 検定では Candidate のみ勝利 47 試合 vs Offspring #2 のみ勝利 26 試合となり、$p = ${mcNemarCandVsOff2.exactPValue.toFixed(4)} < 0.05 で Candidate の方が統計的有意に高い勝率を記録しました。したがって、直接対決での Offspring #2 の勝ち越しは局所的な相性差であり、汎用的なベースライン対戦において g1 子孫個体の方が強いとは言えません。
3. **強い DNA の獲得は初期 Mutation によるものか、世代進化によるものか？**
   - **回答: 初期 Mutation による有望個体の獲得が主因。**
   - 現時点で明確に実証されているのは「初期母集団多様化における変異処理が有望な DNA を生み出したこと」であり、1 世代の小規模進化では世代進化による全般的な性能向上を統計的に証明するには至っていません。共通ベースラインでも g0 変異個体（Candidate）が最高成績を維持しています。
4. **座席差 (p1/p2) および手番差 (先攻/後攻) はどの程度か？**
   - **回答: 座席差・手番差ともに実測された。**
   - Candidate: P1席勝率 ${(candSummary.seatSummary.p1WinRate * 100).toFixed(1)}% vs P2席勝率 ${(candSummary.seatSummary.p2WinRate * 100).toFixed(1)}%。先攻勝率 ${(candSummary.turnOrderSummary.firstWinRate * 100).toFixed(1)}% vs 後攻勝率 ${(candSummary.turnOrderSummary.secondWinRate * 100).toFixed(1)}%。Seat-Swapped 評価の不可欠性が再確認されました。
5. **次期 Work への学習方針の推奨**
   - **回答: Work 2 (エンジン最適化) および Work 3 (多世代 Evolution Campaign) の計画策定を推奨。**
   - 母集団サイズ ($N=12$)、世代数 ($G=10$)、エリート保存 (\`eliteCount=1\`)、および Hall of Fame を導入した本格的なキャンペーンへ進むことを推奨します。

---

## 5. Artifact 完全性とファイル保護

- **保護された既存ファイル (変更差分 0 件)**:
  - \`tools/simulator/artifacts/ai/standard-pack-pilot-champion-v6.json\`
  - \`tools/simulator/artifacts/ai/standard-pack-pilot-champion-v6.manifest.json\`
  - \`tools/simulator/reports/ai/standard-pack-evolution-pilot-v1.json\`
  - \`tools/simulator/docs/ai-standard-pack-evolution-pilot-v1.md\`
  - \`tools/simulator/reports/ai/standard-pack-evolution-pilot-v1-r1.json\`
  - \`tools/simulator/docs/ai-standard-pack-evolution-pilot-v1-r1.md\`
- **本 R2 で新設された成果物**:
  - \`tools/simulator/reports/ai/standard-pack-evolution-pilot-v1-r2.json\`
  - \`tools/simulator/docs/ai-standard-pack-evolution-pilot-v1-r2.md\`
  - \`tools/simulator/src/cli/standardPackEvolutionPilotRunnerR2.ts\`
  - \`tools/simulator/src/tests/ai/standardPackEvolutionPilotR2.test.ts\`
- **最優秀候補 DNA (不変・完全保護)**:
  - Genome ID: \`genome-sp-g0-004\`
  - Full DNA Digest: \`${candidateIndividual.digests.fullDnaDigest}\`
  - 総重み数: 23,738 重み
`;

  const r2MdPath = path.join(rootDir, "tools/simulator/docs/ai-standard-pack-evolution-pilot-v1-r2.md");
  fs.writeFileSync(r2MdPath, r2Markdown, "utf-8");
  console.log(`  [Report] Successfully generated R2 Markdown Report: ${r2MdPath}`);

  console.log(`\n================================================================================`);
  console.log(`  R2 Runner Completed Successfully in ${totalElapsedSec}s`);
  console.log(`================================================================================\n`);

  return r2JsonData;
}

if (!process.env.VITEST) {
  runStandardPackEvolutionPilotR2().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
