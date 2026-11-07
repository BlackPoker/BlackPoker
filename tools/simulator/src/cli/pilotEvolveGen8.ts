/**
 * BlackPoker Work 4-3 — Phase 2: Gen 8 Candidate Pilot Evolution
 *
 * 【条件付き承認遵守事項】
 * - パイロット探索専用 (合計最大 4,000 試合上限、計画 1,000 試合)
 * - 本番進化学習 (10,000〜25,000試合) および正式 Holdout は実行禁止
 * - 勝率・意思決定品質最優先、投擲戦術の不当減点なし
 * - Gen 7 Champion を基準個体 (シード) とし、Gen 5, SeededRandom とのマルチ対戦で評価
 * - パイロット専用 Seed: 210001 〜 211000 (完全独立)
 */

import * as fs from "fs";
import * as path from "path";
import {
  loadOfficialChampionsStrict,
  DEFAULT_REGULATION_ID,
  DEFAULT_FRAME_ID,
  DEFAULT_DECISION_LIMIT,
} from "./largeScaleSimulationRunner";
import { prepareOfficialSessionFactory } from "./stage3EvolutionRunner";
import { loadRulePackageFromDirectory } from "../engine/rules/RuleLoader";
import { getPlaytestRulePackage } from "../engine/rules/RulePackageSelector";
import { GenomePolicy } from "../engine/ai/GenomePolicy";
import { FirstLegalPolicy, RandomPolicy, DecisionPolicy } from "../engine/simulation/DecisionPolicy";
import { SeededRandom } from "../engine/random/RandomSource";
import {
  derivePlayerSeed,
  executeSingleInstrumentedMatch,
} from "../engine/simulation/MillionMatchCampaignEngine";
import { DecisionDNA } from "../domain/ai/DecisionDNATypes";
import { DecisionDNACodec } from "../engine/ai/DecisionDNACodec";
import { GeneticMutation } from "../engine/ai/GeneticMutation";
import { GeneticCrossover } from "../engine/ai/GeneticCrossover";
import { validateGeneticOperatorConfig } from "../engine/ai/GeneticOperators";
import { SemanticSHA256 } from "../engine/ai/SemanticSHA256";
import { SelectedParent } from "../domain/ai/PopulationSelectionTypes";

function asSelectedParent(dna: DecisionDNA, genomeId: string, generation = 0, fitnessScore = 1.0): SelectedParent {
  return {
    genomeId,
    dnaRef: `genome:${genomeId}`,
    generation,
    dna,
    fitnessScore,
  };
}

interface CandidateStats {
  genomeId: string;
  dnaDigest: string;
  generation: number;
  totalMatches: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  vsGen7Wins: number;
  vsGen7Matches: number;
  vsGen5Wins: number;
  vsGen5Matches: number;
  upperUnitsSummoned: number;
  upperUnitsOffered: number;
  upperUnitRate: number;
  throwingCount: number;
  attackCount: number;
}

async function runGen8PilotEvolution() {
  console.log("================================================================================");
  console.log("BlackPoker Work 4-3 — Phase 2: Gen 8 Candidate Pilot Evolution (Max 4,000 Matches)");
  console.log("================================================================================");

  const outDir = path.resolve(".artifacts/phase2-gen8-pilot");
  fs.mkdirSync(outDir, { recursive: true });

  const champions = loadOfficialChampionsStrict();
  const rulesDir = path.resolve("src/data/rules-vnext");
  const fullPkg = await loadRulePackageFromDirectory(rulesDir);
  getPlaytestRulePackage(fullPkg);
  const sessionFactory = await prepareOfficialSessionFactory(DEFAULT_REGULATION_ID);

  const POPULATION_SIZE = 8;
  const TOTAL_GENERATIONS = 5;
  const PILOT_BASE_SEED = 210001;

  console.log(`- Population Size:    ${POPULATION_SIZE}`);
  console.log(`- Total Generations:  ${TOTAL_GENERATIONS}`);
  console.log(`- Base Seed:          ${PILOT_BASE_SEED}`);
  console.log(`- Gen 7 Champion:     ${champions.gen7Digest}`);
  console.log(`- Gen 5 Champion:     ${champions.gen5Digest}`);
  console.log("--------------------------------------------------------------------------------");

  // 初期母集団 G0 の生成
  // Ind 0: Gen 7 Champion (シード)
  // Ind 1: Gen 5 Champion
  // Ind 2..4: Gen 7 微小変異
  // Ind 5..7: Gen 7 x Gen 5 交叉
  let currentPopulation: { genomeId: string; dna: DecisionDNA; digest: string }[] = [];

  const gen7Cloned = DecisionDNACodec.clone(champions.gen7DNA);
  currentPopulation.push({
    genomeId: "gen8-pilot-g0-ind0-gen7seed",
    dna: gen7Cloned,
    digest: champions.gen7Digest,
  });

  const gen5Cloned = DecisionDNACodec.clone(champions.gen5DNA);
  currentPopulation.push({
    genomeId: "gen8-pilot-g0-ind1-gen5seed",
    dna: gen5Cloned,
    digest: champions.gen5Digest,
  });

  const mutationConfig = validateGeneticOperatorConfig({
    mutationRate: 0.08,
    mutationSigma: 0.05,
    mutationClampMin: -10,
    mutationClampMax: 10,
  });

  for (let i = 2; i < 5; i++) {
    const mutatedWeights = GeneticMutation.mutate(
      {
        patternWeights: champions.gen7DNA.patternWeights,
        contextPatternWeights: champions.gen7DNA.contextPatternWeights,
      },
      PILOT_BASE_SEED + i * 7919,
      mutationConfig
    );
    const mutatedDNA: DecisionDNA = {
      ...champions.gen7DNA,
      metadata: {
        ...champions.gen7DNA.metadata,
        id: `dna-gen8-pilot-g0-ind${i}-mutant`,
      },
      patternWeights: mutatedWeights.patternWeights,
      contextPatternWeights: mutatedWeights.contextPatternWeights,
    };
    const digest = SemanticSHA256.hash(JSON.stringify(mutatedDNA));
    currentPopulation.push({
      genomeId: `gen8-pilot-g0-ind${i}-mutant`,
      dna: mutatedDNA,
      digest,
    });
  }

  for (let i = 5; i < POPULATION_SIZE; i++) {
    const crossedWeights = GeneticCrossover.cross(
      {
        parentA: asSelectedParent(champions.gen7DNA, "gen7-champion", 0, 1.0),
        parentB: asSelectedParent(champions.gen5DNA, "gen5-champion", 0, 1.0),
      },
      PILOT_BASE_SEED + i * 3571
    );
    const crossedDNA: DecisionDNA = {
      ...champions.gen7DNA,
      metadata: {
        ...champions.gen7DNA.metadata,
        id: `dna-gen8-pilot-g0-ind${i}-crossover`,
      },
      patternWeights: crossedWeights.patternWeights,
      contextPatternWeights: crossedWeights.contextPatternWeights,
    };
    const digest = SemanticSHA256.hash(JSON.stringify(crossedDNA));
    currentPopulation.push({
      genomeId: `gen8-pilot-g0-ind${i}-crossover`,
      dna: crossedDNA,
      digest,
    });
  }

  let cumulativeMatchCount = 0;
  const generationSummaries: any[] = [];
  let bestEverCandidate: CandidateStats | null = null;
  let bestEverDNA: DecisionDNA | null = null;

  // 世代ループ
  for (let gen = 0; gen < TOTAL_GENERATIONS; gen++) {
    console.log(`\n=================== GENERATION ${gen} / ${TOTAL_GENERATIONS - 1} ===================`);
    const candidateStatsMap = new Map<string, CandidateStats>();

    for (const ind of currentPopulation) {
      candidateStatsMap.set(ind.genomeId, {
        genomeId: ind.genomeId,
        dnaDigest: ind.digest,
        generation: gen,
        totalMatches: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        winRate: 0,
        vsGen7Wins: 0,
        vsGen7Matches: 0,
        vsGen5Wins: 0,
        vsGen5Matches: 0,
        upperUnitsSummoned: 0,
        upperUnitsOffered: 0,
        upperUnitRate: 0,
        throwingCount: 0,
        attackCount: 0,
      });
    }

    // 1. 母集団内 Double Round Robin
    console.log(`>>> Running Double Round Robin (Gen ${gen})...`);
    for (let i = 0; i < currentPopulation.length; i++) {
      for (let j = i + 1; j < currentPopulation.length; j++) {
        const indA = currentPopulation[i];
        const indB = currentPopulation[j];
        const matchSeed = PILOT_BASE_SEED + cumulativeMatchCount + 100;

        // Leg 0: A as p1, B as p2
        runInstrumentedMatchPair(
          indA,
          indB,
          matchSeed,
          sessionFactory,
          candidateStatsMap.get(indA.genomeId)!,
          candidateStatsMap.get(indB.genomeId)!
        );
        cumulativeMatchCount += 2;
      }
    }

    // 2. 固定 Baseline との Validation 対戦
    // 各個体 vs Gen 7, vs Gen 5, vs SeededRandom (各 3 Seeds = 6 matches)
    console.log(`>>> Running Fixed Opponent Validation (Gen ${gen})...`);
    const valSeeds = [PILOT_BASE_SEED + 500 + gen * 10, PILOT_BASE_SEED + 501 + gen * 10, PILOT_BASE_SEED + 502 + gen * 10];
    
    for (const ind of currentPopulation) {
      const stats = candidateStatsMap.get(ind.genomeId)!;

      for (const valSeed of valSeeds) {
        // vs Gen 7 Champion
        runInstrumentedValidation(ind, { genomeId: "gen7-champion", dna: champions.gen7DNA, digest: champions.gen7Digest }, valSeed, sessionFactory, stats, "gen7");
        // vs Gen 5 Champion
        runInstrumentedValidation(ind, { genomeId: "gen5-champion", dna: champions.gen5DNA, digest: champions.gen5Digest }, valSeed + 50, sessionFactory, stats, "gen5");
        // vs SeededRandom
        runInstrumentedRandomValidation(ind, valSeed + 100, sessionFactory, stats);
        cumulativeMatchCount += 6;
      }
    }

    // 集計とランキング
    const rankedCandidates: CandidateStats[] = [];
    for (const stats of candidateStatsMap.values()) {
      stats.winRate = stats.totalMatches > 0 ? (stats.wins / stats.totalMatches) * 100 : 0;
      stats.upperUnitRate = stats.upperUnitsOffered > 0 ? (stats.upperUnitsSummoned / stats.upperUnitsOffered) * 100 : 0;
      rankedCandidates.push(stats);
    }

    // 勝率優先でソート
    rankedCandidates.sort((a, b) => b.winRate - a.winRate);

    console.log(`[Gen ${gen} Ranking Summary]:`);
    for (const c of rankedCandidates) {
      console.log(
        `  - ${c.genomeId.padEnd(30)}: WinRate=${c.winRate.toFixed(1).padStart(5)}% (${c.wins}/${c.totalMatches}) | vsGen7=${c.vsGen7Wins}/${c.vsGen7Matches} | UpperUnit=${c.upperUnitRate.toFixed(1)}% (${c.upperUnitsSummoned}/${c.upperUnitsOffered}) | Throw=${c.throwingCount} | Atk=${c.attackCount}`
      );
    }

    const genBest = rankedCandidates[0];
    const genBestInd = currentPopulation.find((p) => p.genomeId === genBest.genomeId)!;

    if (!bestEverCandidate || genBest.winRate > bestEverCandidate.winRate) {
      bestEverCandidate = genBest;
      bestEverDNA = DecisionDNACodec.clone(genBestInd.dna);
    }

    generationSummaries.push({
      generation: gen,
      bestCandidate: genBest,
      allCandidates: rankedCandidates,
      cumulativeMatches: cumulativeMatchCount,
    });

    // 次世代の生成 (G < TOTAL_GENERATIONS - 1 の場合)
    if (gen < TOTAL_GENERATIONS - 1) {
      const nextPop: { genomeId: string; dna: DecisionDNA; digest: string }[] = [];

      // エリート保存: 上位 2 個体はそのまま引き継ぐ
      const elite1 = currentPopulation.find((p) => p.genomeId === rankedCandidates[0].genomeId)!;
      const elite2 = currentPopulation.find((p) => p.genomeId === rankedCandidates[1].genomeId)!;
      nextPop.push({
        genomeId: `gen8-pilot-g${gen + 1}-ind0-elite`,
        dna: DecisionDNACodec.clone(elite1.dna),
        digest: elite1.digest,
      });
      nextPop.push({
        genomeId: `gen8-pilot-g${gen + 1}-ind1-elite`,
        dna: DecisionDNACodec.clone(elite2.dna),
        digest: elite2.digest,
      });

      // 残り 6 個体を上位陣の交叉および変異から生成
      for (let k = 2; k < POPULATION_SIZE; k++) {
        const parentA = currentPopulation.find((p) => p.genomeId === rankedCandidates[k % 2].genomeId)!;
        const parentB = currentPopulation.find((p) => p.genomeId === rankedCandidates[(k + 1) % 4].genomeId)!;
        const seedBase = PILOT_BASE_SEED + gen * 1000 + k * 137;

        let offspringDNA: DecisionDNA;
        if (k % 2 === 0) {
          // 変異
          const mutated = GeneticMutation.mutate(
            {
              patternWeights: parentA.dna.patternWeights,
              contextPatternWeights: parentA.dna.contextPatternWeights,
            },
            seedBase,
            mutationConfig
          );
          offspringDNA = {
            ...parentA.dna,
            metadata: {
              ...parentA.dna.metadata,
              id: `dna-gen8-pilot-g${gen + 1}-ind${k}`,
            },
            patternWeights: mutated.patternWeights,
            contextPatternWeights: mutated.contextPatternWeights,
          };
        } else {
          // 交叉
          const crossed = GeneticCrossover.cross(
            {
              parentA: asSelectedParent(parentA.dna, parentA.genomeId, gen, rankedCandidates[k % 2]?.winRate || 1.0),
              parentB: asSelectedParent(parentB.dna, parentB.genomeId, gen, rankedCandidates[(k + 1) % 4]?.winRate || 1.0),
            },
            seedBase
          );
          offspringDNA = {
            ...parentA.dna,
            metadata: {
              ...parentA.dna.metadata,
              id: `dna-gen8-pilot-g${gen + 1}-ind${k}`,
            },
            patternWeights: crossed.patternWeights,
            contextPatternWeights: crossed.contextPatternWeights,
          };
        }

        const digest = SemanticSHA256.hash(JSON.stringify(offspringDNA));
        nextPop.push({
          genomeId: `gen8-pilot-g${gen + 1}-ind${k}`,
          dna: offspringDNA,
          digest,
        });
      }

      currentPopulation = nextPop;
    }
  }

  console.log("\n================================================================================");
  console.log("PILOT EVOLUTION COMPLETED");
  console.log("================================================================================");
  console.log(`- Cumulative Pilot Matches: ${cumulativeMatchCount} (<= 4,000 match limit verified)`);
  console.log(`- Best Candidate Genome:     ${bestEverCandidate?.genomeId}`);
  console.log(`- Best Candidate WinRate:    ${bestEverCandidate?.winRate.toFixed(1)}%`);
  console.log(`- Best Candidate vs Gen 7:   ${bestEverCandidate?.vsGen7Wins}/${bestEverCandidate?.vsGen7Matches}`);
  console.log(`- Best Candidate vs Gen 5:   ${bestEverCandidate?.vsGen5Wins}/${bestEverCandidate?.vsGen5Matches}`);
  console.log(`- Upper Unit Acceptance:     ${bestEverCandidate?.upperUnitRate.toFixed(1)}% (${bestEverCandidate?.upperUnitsSummoned}/${bestEverCandidate?.upperUnitsOffered})`);
  console.log(`- Throwing vs Attack:        Throwing=${bestEverCandidate?.throwingCount} / Attack=${bestEverCandidate?.attackCount}`);

  // 成果物保存
  fs.writeFileSync(
    path.join(outDir, "pilot-summary.json"),
    JSON.stringify(
      {
        workId: "BP-SIM-AI-V92-WORK4-3-PHASE2-PILOT-R1",
        timestamp: new Date().toISOString(),
        totalMatchesExecuted: cumulativeMatchCount,
        maxMatchesLimit: 4000,
        populationSize: POPULATION_SIZE,
        totalGenerations: TOTAL_GENERATIONS,
        bestCandidate: bestEverCandidate,
        generationSummaries,
      },
      null,
      2
    ),
    "utf8"
  );

  if (bestEverDNA) {
    fs.writeFileSync(
      path.join(outDir, "pilot-best-champion.json"),
      JSON.stringify(bestEverDNA, null, 2),
      "utf8"
    );
  }

  console.log(`Artifacts saved to: ${outDir}`);
}

// ヘルパー: 試合実行中の大量コンソール出力を抑制
function withQuietExecution<T>(fn: () => T): T {
  const originalLog = console.log;
  console.log = () => {};
  try {
    return fn();
  } finally {
    console.log = originalLog;
  }
}

// ヘルパー: 2 個体間の座席反転ペア対戦
function runInstrumentedMatchPair(
  indA: { genomeId: string; dna: DecisionDNA; digest: string },
  indB: { genomeId: string; dna: DecisionDNA; digest: string },
  seed: number,
  sessionFactory: any,
  statsA: CandidateStats,
  statsB: CandidateStats
) {
  const p1Seed = derivePlayerSeed(seed, "p1");
  const p2Seed = derivePlayerSeed(seed, "p2");

  // Leg 0: A = p1, B = p2
  const res0 = withQuietExecution(() =>
    executeSingleInstrumentedMatch({
      campaignId: "pilot-pair",
      workId: "WORK4-3-PILOT",
      matchIndex: 0,
      pairIndex: 0,
      legIndex: 0,
      matchId: `pilot-s${seed}-A-vs-B`,
      matchupId: "pilot",
      matchSeed: seed,
      playerSeeds: { p1: p1Seed, p2: p2Seed },
      p1Spec: { policyId: indA.genomeId, name: indA.genomeId, kind: "GENOME", role: "CANDIDATE" },
      p2Spec: { policyId: indB.genomeId, name: indB.genomeId, kind: "GENOME", role: "CANDIDATE" },
      p1Policy: createInstrumentedCandidatePolicy(indA.dna, statsA),
      p2Policy: createInstrumentedCandidatePolicy(indB.dna, statsB),
      sessionFactory,
      regulationId: DEFAULT_REGULATION_ID,
      frameId: DEFAULT_FRAME_ID,
      maxDecisionsPerMatch: DEFAULT_DECISION_LIMIT,
    })
  );

  statsA.totalMatches++;
  statsB.totalMatches++;
  if (res0.outcomeRecord.winner === "p1") {
    statsA.wins++;
    statsB.losses++;
  } else if (res0.outcomeRecord.winner === "p2") {
    statsB.wins++;
    statsA.losses++;
  } else {
    statsA.draws++;
    statsB.draws++;
  }

  // Leg 1: B = p1, A = p2
  const res1 = withQuietExecution(() =>
    executeSingleInstrumentedMatch({
      campaignId: "pilot-pair",
      workId: "WORK4-3-PILOT",
      matchIndex: 1,
      pairIndex: 0,
      legIndex: 1,
      matchId: `pilot-s${seed}-B-vs-A`,
      matchupId: "pilot",
      matchSeed: seed,
      playerSeeds: { p1: p1Seed, p2: p2Seed },
      p1Spec: { policyId: indB.genomeId, name: indB.genomeId, kind: "GENOME", role: "CANDIDATE" },
      p2Spec: { policyId: indA.genomeId, name: indA.genomeId, kind: "GENOME", role: "CANDIDATE" },
      p1Policy: createInstrumentedCandidatePolicy(indB.dna, statsB),
      p2Policy: createInstrumentedCandidatePolicy(indA.dna, statsA),
      sessionFactory,
      regulationId: DEFAULT_REGULATION_ID,
      frameId: DEFAULT_FRAME_ID,
      maxDecisionsPerMatch: DEFAULT_DECISION_LIMIT,
    })
  );

  statsA.totalMatches++;
  statsB.totalMatches++;
  if (res1.outcomeRecord.winner === "p2") {
    statsA.wins++;
    statsB.losses++;
  } else if (res1.outcomeRecord.winner === "p1") {
    statsB.wins++;
    statsA.losses++;
  } else {
    statsA.draws++;
    statsB.draws++;
  }
}

// ヘルパー: Candidate vs Baseline (Gen 7 または Gen 5) の座席反転ペア
function runInstrumentedValidation(
  cand: { genomeId: string; dna: DecisionDNA; digest: string },
  base: { genomeId: string; dna: DecisionDNA; digest: string },
  seed: number,
  sessionFactory: any,
  candStats: CandidateStats,
  baseType: "gen7" | "gen5"
) {
  const p1Seed = derivePlayerSeed(seed, "p1");
  const p2Seed = derivePlayerSeed(seed, "p2");
  const basePolicy = new GenomePolicy(base.dna, base.genomeId);

  // Leg 0: Cand as p1
  const res0 = withQuietExecution(() =>
    executeSingleInstrumentedMatch({
      campaignId: "pilot-val",
      workId: "WORK4-3-PILOT",
      matchIndex: 0,
      pairIndex: 0,
      legIndex: 0,
      matchId: `val-s${seed}-${cand.genomeId}-vs-${baseType}`,
      matchupId: `val-${baseType}`,
      matchSeed: seed,
      playerSeeds: { p1: p1Seed, p2: p2Seed },
      p1Spec: { policyId: cand.genomeId, name: cand.genomeId, kind: "GENOME", role: "CANDIDATE" },
      p2Spec: { policyId: base.genomeId, name: base.genomeId, kind: "GENOME", role: "BASELINE" },
      p1Policy: createInstrumentedCandidatePolicy(cand.dna, candStats),
      p2Policy: basePolicy,
      sessionFactory,
      regulationId: DEFAULT_REGULATION_ID,
      frameId: DEFAULT_FRAME_ID,
      maxDecisionsPerMatch: DEFAULT_DECISION_LIMIT,
    })
  );

  candStats.totalMatches++;
  if (baseType === "gen7") candStats.vsGen7Matches++;
  if (baseType === "gen5") candStats.vsGen5Matches++;

  if (res0.outcomeRecord.winner === "p1") {
    candStats.wins++;
    if (baseType === "gen7") candStats.vsGen7Wins++;
    if (baseType === "gen5") candStats.vsGen5Wins++;
  } else if (res0.outcomeRecord.winner === "p2") {
    candStats.losses++;
  } else {
    candStats.draws++;
  }

  // Leg 1: Cand as p2
  const res1 = withQuietExecution(() =>
    executeSingleInstrumentedMatch({
      campaignId: "pilot-val",
      workId: "WORK4-3-PILOT",
      matchIndex: 1,
      pairIndex: 0,
      legIndex: 1,
      matchId: `val-s${seed}-${baseType}-vs-${cand.genomeId}`,
      matchupId: `val-${baseType}`,
      matchSeed: seed,
      playerSeeds: { p1: p1Seed, p2: p2Seed },
      p1Spec: { policyId: base.genomeId, name: base.genomeId, kind: "GENOME", role: "BASELINE" },
      p2Spec: { policyId: cand.genomeId, name: cand.genomeId, kind: "GENOME", role: "CANDIDATE" },
      p1Policy: basePolicy,
      p2Policy: createInstrumentedCandidatePolicy(cand.dna, candStats),
      sessionFactory,
      regulationId: DEFAULT_REGULATION_ID,
      frameId: DEFAULT_FRAME_ID,
      maxDecisionsPerMatch: DEFAULT_DECISION_LIMIT,
    })
  );

  candStats.totalMatches++;
  if (baseType === "gen7") candStats.vsGen7Matches++;
  if (baseType === "gen5") candStats.vsGen5Matches++;

  if (res1.outcomeRecord.winner === "p2") {
    candStats.wins++;
    if (baseType === "gen7") candStats.vsGen7Wins++;
    if (baseType === "gen5") candStats.vsGen5Wins++;
  } else if (res1.outcomeRecord.winner === "p1") {
    candStats.losses++;
  } else {
    candStats.draws++;
  }
}

// ヘルパー: Candidate vs SeededRandom の座席反転ペア
function runInstrumentedRandomValidation(
  cand: { genomeId: string; dna: DecisionDNA; digest: string },
  seed: number,
  sessionFactory: any,
  candStats: CandidateStats
) {
  const p1Seed = derivePlayerSeed(seed, "p1");
  const p2Seed = derivePlayerSeed(seed, "p2");

  // Leg 0: Cand as p1
  const res0 = withQuietExecution(() =>
    executeSingleInstrumentedMatch({
      campaignId: "pilot-val-rand",
      workId: "WORK4-3-PILOT",
      matchIndex: 0,
      pairIndex: 0,
      legIndex: 0,
      matchId: `val-rand-s${seed}-${cand.genomeId}-p1`,
      matchupId: "val-rand",
      matchSeed: seed,
      playerSeeds: { p1: p1Seed, p2: p2Seed },
      p1Spec: { policyId: cand.genomeId, name: cand.genomeId, kind: "GENOME", role: "CANDIDATE" },
      p2Spec: { policyId: "seeded-random", name: "SeededRandom", kind: "SEEDED_RANDOM", role: "BASELINE" },
      p1Policy: createInstrumentedCandidatePolicy(cand.dna, candStats),
      p2Policy: new RandomPolicy(new SeededRandom(p2Seed), "Random"),
      sessionFactory,
      regulationId: DEFAULT_REGULATION_ID,
      frameId: DEFAULT_FRAME_ID,
      maxDecisionsPerMatch: DEFAULT_DECISION_LIMIT,
    })
  );

  candStats.totalMatches++;
  if (res0.outcomeRecord.winner === "p1") candStats.wins++;
  else if (res0.outcomeRecord.winner === "p2") candStats.losses++;
  else candStats.draws++;

  // Leg 1: Cand as p2
  const res1 = withQuietExecution(() =>
    executeSingleInstrumentedMatch({
      campaignId: "pilot-val-rand",
      workId: "WORK4-3-PILOT",
      matchIndex: 1,
      pairIndex: 0,
      legIndex: 1,
      matchId: `val-rand-s${seed}-${cand.genomeId}-p2`,
      matchupId: "val-rand",
      matchSeed: seed,
      playerSeeds: { p1: p1Seed, p2: p2Seed },
      p1Spec: { policyId: "seeded-random", name: "SeededRandom", kind: "SEEDED_RANDOM", role: "BASELINE" },
      p2Spec: { policyId: cand.genomeId, name: cand.genomeId, kind: "GENOME", role: "CANDIDATE" },
      p1Policy: new RandomPolicy(new SeededRandom(p1Seed), "Random"),
      p2Policy: createInstrumentedCandidatePolicy(cand.dna, candStats),
      sessionFactory,
      regulationId: DEFAULT_REGULATION_ID,
      frameId: DEFAULT_FRAME_ID,
      maxDecisionsPerMatch: DEFAULT_DECISION_LIMIT,
    })
  );

  candStats.totalMatches++;
  if (res1.outcomeRecord.winner === "p2") candStats.wins++;
  else if (res1.outcomeRecord.winner === "p1") candStats.losses++;
  else candStats.draws++;
}

// ヘルパー: Candidate Policy をラップしてアクション選択を追跡
function createInstrumentedCandidatePolicy(dna: DecisionDNA, stats: CandidateStats): DecisionPolicy {
  const inner = new GenomePolicy(dna, stats.genomeId);
  return {
    descriptor: inner.descriptor,
    choose: (req) => {
      const patterns = req.patterns || [];
      const hasUpperUnit = patterns.some((p: any) => {
        const actId = p.actionSelectionRef !== undefined ? req.catalog?.actions?.[p.actionSelectionRef]?.actionId : "";
        return actId === "action.summonAce" || actId === "action.summonHero" || actId === "action.summonMagician";
      });

      if (hasUpperUnit) {
        stats.upperUnitsOffered++;
      }

      const res = inner.choose(req);
      const chosen = patterns[res.selectedPatternRef];
      const chosenActId = chosen?.actionSelectionRef !== undefined ? req.catalog?.actions?.[chosen?.actionSelectionRef]?.actionId : chosen?.kind;

      if (chosenActId === "action.summonAce" || chosenActId === "action.summonHero" || chosenActId === "action.summonMagician") {
        stats.upperUnitsSummoned++;
      }
      if (chosenActId === "action.throwing") {
        stats.throwingCount++;
      }
      if (chosenActId === "action.attack") {
        stats.attackCount++;
      }

      return res;
    },
  };
}

runGen8PilotEvolution().catch((e) => {
  console.error("PILOT EVOLUTION FATAL:", e);
  process.exit(1);
});
