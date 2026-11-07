/**
 * BlackPoker Work 4-3 — Gen 8 Production Evolution Runner
 *
 * 【承認条件と制約】
 * - 新規実行最大 10,000 試合上限 (Smoke 含む)
 * - Worker 数: 原則 4 (MillionMatchWorkerPool 並列実行)
 * - 母集団: 12 個体, 10 世代
 * - 初期母集団:
 *     Ind 0: パイロット最優秀候補 (f8fdde...)
 *     Ind 1: Gen 7 Champion (04a1e2...)
 *     Ind 2: Gen 5 Champion (e8e8ae...)
 *     Ind 3..5: パイロット有望個体
 *     Ind 6..11: 交叉・変異個体
 * - エリート保存 (Top 2) & ロールバック可能
 * - 評価方式: 勝敗中心 Outcome-First Fitness (勝率純粋評価)
 * - Checkpoint / Resume 対応 (--smoke, --resume, --max-matches, --workers)
 * - Seed 空間: 300001 〜 320000 (Training), 330001 〜 331000 (Validation)
 * - 正式 Holdout 評価は実行禁止
 */

import * as fs from "fs";
import * as path from "path";
import {
  loadOfficialChampionsStrict,
  DEFAULT_REGULATION_ID,
  DEFAULT_FRAME_ID,
  DEFAULT_DECISION_LIMIT,
} from "./largeScaleSimulationRunner";
import { MillionMatchWorkerPool } from "../engine/simulation/MillionMatchWorkerPool";
import { DecisionDNA } from "../domain/ai/DecisionDNATypes";
import { DecisionDNACodec } from "../engine/ai/DecisionDNACodec";
import { GeneticMutation } from "../engine/ai/GeneticMutation";
import { GeneticCrossover } from "../engine/ai/GeneticCrossover";
import { validateGeneticOperatorConfig } from "../engine/ai/GeneticOperators";
import { SemanticSHA256 } from "../engine/ai/SemanticSHA256";
import { SelectedParent } from "../domain/ai/PopulationSelectionTypes";
import { ParticipantPolicySpec } from "../domain/simulation/MillionMatchInfraTypes";

interface ProductionCandidateStats {
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
  throwingCount: number;
  attackCount: number;
}

interface EvolutionCheckpoint {
  workId: string;
  timestamp: string;
  currentGeneration: number;
  totalGenerations: number;
  cumulativeMatchesExecuted: number;
  maxMatchesLimit: number;
  population: { genomeId: string; dna: DecisionDNA; digest: string }[];
  bestEverCandidate: ProductionCandidateStats | null;
  bestEverDNA: DecisionDNA | null;
  generationHistory: any[];
}

function asSelectedParent(dna: DecisionDNA, genomeId: string, generation = 0, fitnessScore = 1.0): SelectedParent {
  return {
    genomeId,
    dnaRef: `genome:${genomeId}`,
    generation,
    dna,
    fitnessScore,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const isSmoke = args.includes("--smoke");
  const isResume = args.includes("--resume");
  const workersArg = args.indexOf("--workers");
  const workersCount = (workersArg !== -1 && parseInt(args[workersArg + 1], 10)) ? parseInt(args[workersArg + 1], 10) : 4;
  const maxMatchesArg = args.indexOf("--max-matches");
  const maxMatchesLimit = (maxMatchesArg !== -1 && parseInt(args[maxMatchesArg + 1], 10)) ? parseInt(args[maxMatchesArg + 1], 10) : 10000;

  console.log("================================================================================");
  console.log(`BlackPoker Work 4-3 — Gen 8 Production Evolution ${isSmoke ? "(SMOKE RUN: 1 Generation)" : "(FULL CAMPAIGN)"}`);
  console.log("================================================================================");
  console.log(`- Mode:                 ${isSmoke ? "SMOKE (1 Gen)" : isResume ? "RESUME" : "FRESH RUN"}`);
  console.log(`- Max Matches Limit:    ${maxMatchesLimit} matches`);
  console.log(`- Worker Threads:       ${workersCount} Workers`);
  console.log("--------------------------------------------------------------------------------");

  const outDir = path.resolve(".artifacts/gen8-production");
  fs.mkdirSync(outDir, { recursive: true });
  const checkpointPath = path.join(outDir, "checkpoint.json");

  const champions = loadOfficialChampionsStrict();
  const pilotBestPath = path.resolve("evidence/phase2-gen8-pilot/pilot-best-champion.json");
  const pilotBestDNA: DecisionDNA = JSON.parse(fs.readFileSync(pilotBestPath, "utf8"));
  const pilotBestDigest = SemanticSHA256.hash(JSON.stringify(pilotBestDNA));

  const POPULATION_SIZE = 12;
  const TOTAL_GENERATIONS = isSmoke ? 1 : 10;
  const TRAINING_BASE_SEED = 300001;
  const VALIDATION_BASE_SEED = 330001;

  const mutationConfig = validateGeneticOperatorConfig({
    mutationRate: 0.06,
    mutationSigma: 0.04,
    mutationClampMin: -10,
    mutationClampMax: 10,
  });

  let checkpoint: EvolutionCheckpoint;

  if (isResume && fs.existsSync(checkpointPath)) {
    console.log(`>>> Resuming from checkpoint: ${checkpointPath}`);
    checkpoint = JSON.parse(fs.readFileSync(checkpointPath, "utf8"));
    console.log(`    Resumed Generation: ${checkpoint.currentGeneration}, Cumulative Matches: ${checkpoint.cumulativeMatchesExecuted}`);
  } else {
    // 初期母集団 G0 の構成
    // Ind 0: パイロット最優秀候補 (f8fdde...)
    // Ind 1: Gen 7 Champion (04a1e2...)
    // Ind 2: Gen 5 Champion (e8e8ae...)
    // Ind 3..5: パイロット最優秀の微小変異個体
    // Ind 6..8: パイロット最優秀 x Gen 7 の交叉個体
    // Ind 9..11: パイロット最優秀 x Gen 5 の交叉個体
    const initialPopulation: { genomeId: string; dna: DecisionDNA; digest: string }[] = [];

    initialPopulation.push({
      genomeId: "gen8-prod-g0-ind0-pilotbest",
      dna: DecisionDNACodec.clone(pilotBestDNA),
      digest: pilotBestDigest,
    });
    initialPopulation.push({
      genomeId: "gen8-prod-g0-ind1-gen7champ",
      dna: DecisionDNACodec.clone(champions.gen7DNA),
      digest: champions.gen7Digest,
    });
    initialPopulation.push({
      genomeId: "gen8-prod-g0-ind2-gen5champ",
      dna: DecisionDNACodec.clone(champions.gen5DNA),
      digest: champions.gen5Digest,
    });

    for (let i = 3; i < 6; i++) {
      const mut = GeneticMutation.mutate(
        { patternWeights: pilotBestDNA.patternWeights, contextPatternWeights: pilotBestDNA.contextPatternWeights },
        TRAINING_BASE_SEED + i * 7919,
        mutationConfig
      );
      const dna: DecisionDNA = {
        ...pilotBestDNA,
        metadata: { ...pilotBestDNA.metadata, id: `dna-gen8-prod-g0-ind${i}-mut` },
        patternWeights: mut.patternWeights,
        contextPatternWeights: mut.contextPatternWeights,
      };
      initialPopulation.push({
        genomeId: `gen8-prod-g0-ind${i}-mut`,
        dna,
        digest: SemanticSHA256.hash(JSON.stringify(dna)),
      });
    }

    for (let i = 6; i < 9; i++) {
      const cross = GeneticCrossover.cross(
        {
          parentA: asSelectedParent(pilotBestDNA, "pilot-best", 0, 1.0),
          parentB: asSelectedParent(champions.gen7DNA, "gen7-champion", 0, 1.0),
        },
        TRAINING_BASE_SEED + i * 3571
      );
      const dna: DecisionDNA = {
        ...pilotBestDNA,
        metadata: { ...pilotBestDNA.metadata, id: `dna-gen8-prod-g0-ind${i}-cross7` },
        patternWeights: cross.patternWeights,
        contextPatternWeights: cross.contextPatternWeights,
      };
      initialPopulation.push({
        genomeId: `gen8-prod-g0-ind${i}-cross7`,
        dna,
        digest: SemanticSHA256.hash(JSON.stringify(dna)),
      });
    }

    for (let i = 9; i < 12; i++) {
      const cross = GeneticCrossover.cross(
        {
          parentA: asSelectedParent(pilotBestDNA, "pilot-best", 0, 1.0),
          parentB: asSelectedParent(champions.gen5DNA, "gen5-champion", 0, 1.0),
        },
        TRAINING_BASE_SEED + i * 2719
      );
      const dna: DecisionDNA = {
        ...pilotBestDNA,
        metadata: { ...pilotBestDNA.metadata, id: `dna-gen8-prod-g0-ind${i}-cross5` },
        patternWeights: cross.patternWeights,
        contextPatternWeights: cross.contextPatternWeights,
      };
      initialPopulation.push({
        genomeId: `gen8-prod-g0-ind${i}-cross5`,
        dna,
        digest: SemanticSHA256.hash(JSON.stringify(dna)),
      });
    }

    checkpoint = {
      workId: "BP-SIM-AI-V92-WORK4-3-STD-PACK-AI-R2",
      timestamp: new Date().toISOString(),
      currentGeneration: 0,
      totalGenerations: TOTAL_GENERATIONS,
      cumulativeMatchesExecuted: 0,
      maxMatchesLimit,
      population: initialPopulation,
      bestEverCandidate: null,
      bestEverDNA: null,
      generationHistory: [],
    };
  }

  // Worker Pool の初期化 (Workers 4)
  console.log(`>>> Initializing MillionMatchWorkerPool with ${workersCount} Worker Threads...`);
  const workerPool = await MillionMatchWorkerPool.create({
    workersCount,
    regulationId: DEFAULT_REGULATION_ID,
    frameId: DEFAULT_FRAME_ID,
    rulesDir: path.resolve("src/data/rules-vnext"),
    maxDecisionsPerMatch: DEFAULT_DECISION_LIMIT,
    champions: {
      gen7DNA: champions.gen7DNA,
      gen7Digest: champions.gen7Digest,
      gen7Source: champions.gen7Source,
      gen5DNA: champions.gen5DNA,
      gen5Digest: champions.gen5Digest,
      gen5Source: champions.gen5Source,
      zeroDNA: champions.zeroDNA,
      zeroDigest: champions.zeroDigest,
      authenticityRecord: champions.authenticityRecord,
    },
  });
  console.log("    Worker Pool initialized and verified successfully.");

  const startGen = checkpoint.currentGeneration;
  const endGen = isSmoke ? startGen + 1 : TOTAL_GENERATIONS;

  try {
    for (let gen = startGen; gen < endGen; gen++) {
      console.log(`\n=================== PRODUCTION GENERATION ${gen} / ${TOTAL_GENERATIONS - 1} ===================`);
      const candidateStatsMap = new Map<string, ProductionCandidateStats>();

      for (const ind of checkpoint.population) {
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
          throwingCount: 0,
          attackCount: 0,
        });
      }

      // 1. Double Round Robin (母集団内総当たり 66 ペア x 2 legs = 132 試合)
      console.log(`>>> [Worker Pool] Dispatching Double Round Robin (66 pairs = 132 matches)...`);
      const drrTasks: {
        pairIndex: number;
        matchSeed: number;
        indA: { genomeId: string; dna: DecisionDNA; digest: string };
        indB: { genomeId: string; dna: DecisionDNA; digest: string };
      }[] = [];

      let pairIdx = 0;
      for (let i = 0; i < checkpoint.population.length; i++) {
        for (let j = i + 1; j < checkpoint.population.length; j++) {
          const matchSeed = TRAINING_BASE_SEED + gen * 2000 + pairIdx;
          drrTasks.push({
            pairIndex: pairIdx,
            matchSeed,
            indA: checkpoint.population[i],
            indB: checkpoint.population[j],
          });
          pairIdx++;
        }
      }

      const drrPromises = drrTasks.map((task) => {
        const specA: ParticipantPolicySpec = {
          policyId: task.indA.genomeId,
          name: task.indA.genomeId,
          kind: "GENOME",
          role: "CANDIDATE",
          dnaDigest: task.indA.digest,
          customDNA: task.indA.dna,
        };
        const specB: ParticipantPolicySpec = {
          policyId: task.indB.genomeId,
          name: task.indB.genomeId,
          kind: "GENOME",
          role: "CANDIDATE",
          dnaDigest: task.indB.digest,
          customDNA: task.indB.dna,
        };

        return workerPool.executePairTask({
          taskId: `drr-g${gen}-p${task.pairIndex}`,
          campaignId: `gen8-prod-g${gen}`,
          workId: "BP-SIM-AI-V92-WORK4-3-PROD",
          pairIndex: task.pairIndex,
          matchSeed: task.matchSeed,
          playerSeeds: {
            p1: task.matchSeed + 1,
            p2: task.matchSeed + 2,
          },
          matchup: {
            matchupId: `drr-${task.indA.genomeId}-vs-${task.indB.genomeId}`,
            name: `${task.indA.genomeId} vs ${task.indB.genomeId}`,
            weight: 1,
            agentA: specA,
            agentB: specB,
          },
          maxDecisionsPerMatch: DEFAULT_DECISION_LIMIT,
        }).then((res) => {
          // 集計
          const statsA = candidateStatsMap.get(task.indA.genomeId)!;
          const statsB = candidateStatsMap.get(task.indB.genomeId)!;

          // Leg 0
          statsA.totalMatches++;
          statsB.totalMatches++;
          if (res.leg0Result.outcomeRecord.winner === "p1") {
            statsA.wins++;
            statsB.losses++;
          } else if (res.leg0Result.outcomeRecord.winner === "p2") {
            statsB.wins++;
            statsA.losses++;
          } else {
            statsA.draws++;
            statsB.draws++;
          }

          // Leg 1
          statsA.totalMatches++;
          statsB.totalMatches++;
          if (res.leg1Result.outcomeRecord.winner === "p2") {
            statsA.wins++;
            statsB.losses++;
          } else if (res.leg1Result.outcomeRecord.winner === "p1") {
            statsB.wins++;
            statsA.losses++;
          } else {
            statsA.draws++;
            statsB.draws++;
          }
        });
      });

      await Promise.all(drrPromises);
      checkpoint.cumulativeMatchesExecuted += drrTasks.length * 2;
      console.log(`    Double Round Robin complete. Cumulative: ${checkpoint.cumulativeMatchesExecuted} matches.`);

      // 2. 固定 Baseline Validation (12 個体 x 3 相手 x 10 seeds x 2 legs = 720 試合)
      console.log(`>>> [Worker Pool] Dispatching Fixed Baseline Validation (360 pairs = 720 matches)...`);
      const valTasks: {
        pairIndex: number;
        matchSeed: number;
        ind: { genomeId: string; dna: DecisionDNA; digest: string };
        oppSpec: ParticipantPolicySpec;
        oppType: "gen7" | "gen5" | "rand";
      }[] = [];

      let valPairIdx = 0;
      for (const ind of checkpoint.population) {
        // vs Gen 7 Champion (10 seeds)
        for (let s = 0; s < 10; s++) {
          const matchSeed = VALIDATION_BASE_SEED + gen * 1000 + valPairIdx;
          valTasks.push({
            pairIndex: valPairIdx,
            matchSeed,
            ind,
            oppSpec: { policyId: "gen7-champion", name: "Gen7", kind: "GENOME", role: "BASELINE" },
            oppType: "gen7",
          });
          valPairIdx++;
        }
        // vs Gen 5 Champion (10 seeds)
        for (let s = 0; s < 10; s++) {
          const matchSeed = VALIDATION_BASE_SEED + gen * 1000 + valPairIdx;
          valTasks.push({
            pairIndex: valPairIdx,
            matchSeed,
            ind,
            oppSpec: { policyId: "gen5-champion", name: "Gen5", kind: "GENOME", role: "BASELINE" },
            oppType: "gen5",
          });
          valPairIdx++;
        }
        // vs SeededRandom (10 seeds)
        for (let s = 0; s < 10; s++) {
          const matchSeed = VALIDATION_BASE_SEED + gen * 1000 + valPairIdx;
          valTasks.push({
            pairIndex: valPairIdx,
            matchSeed,
            ind,
            oppSpec: { policyId: "seeded-random", name: "Random", kind: "SEEDED_RANDOM", role: "BASELINE" },
            oppType: "rand",
          });
          valPairIdx++;
        }
      }

      const valPromises = valTasks.map((task) => {
        const candSpec: ParticipantPolicySpec = {
          policyId: task.ind.genomeId,
          name: task.ind.genomeId,
          kind: "GENOME",
          role: "CANDIDATE",
          dnaDigest: task.ind.digest,
          customDNA: task.ind.dna,
        };

        return workerPool.executePairTask({
          taskId: `val-g${gen}-p${task.pairIndex}`,
          campaignId: `gen8-prod-val-g${gen}`,
          workId: "BP-SIM-AI-V92-WORK4-3-PROD",
          pairIndex: task.pairIndex,
          matchSeed: task.matchSeed,
          playerSeeds: {
            p1: task.matchSeed + 1,
            p2: task.matchSeed + 2,
          },
          matchup: {
            matchupId: `val-${task.ind.genomeId}-vs-${task.oppType}`,
            name: `${task.ind.genomeId} vs ${task.oppType}`,
            weight: 1,
            agentA: candSpec,
            agentB: task.oppSpec,
          },
          maxDecisionsPerMatch: DEFAULT_DECISION_LIMIT,
        }).then((res) => {
          const stats = candidateStatsMap.get(task.ind.genomeId)!;

          // Leg 0
          stats.totalMatches++;
          if (task.oppType === "gen7") stats.vsGen7Matches++;
          if (task.oppType === "gen5") stats.vsGen5Matches++;

          if (res.leg0Result.outcomeRecord.winner === "p1") {
            stats.wins++;
            if (task.oppType === "gen7") stats.vsGen7Wins++;
            if (task.oppType === "gen5") stats.vsGen5Wins++;
          } else if (res.leg0Result.outcomeRecord.winner === "p2") {
            stats.losses++;
          } else {
            stats.draws++;
          }

          // Leg 1
          stats.totalMatches++;
          if (task.oppType === "gen7") stats.vsGen7Matches++;
          if (task.oppType === "gen5") stats.vsGen5Matches++;

          if (res.leg1Result.outcomeRecord.winner === "p2") {
            stats.wins++;
            if (task.oppType === "gen7") stats.vsGen7Wins++;
            if (task.oppType === "gen5") stats.vsGen5Wins++;
          } else if (res.leg1Result.outcomeRecord.winner === "p1") {
            stats.losses++;
          } else {
            stats.draws++;
          }

          // アクション集計 (Leg 0 p1, Leg 1 p2)
          stats.attackCount += (res.leg0Result.executedActions["action.attack"] || 0);
          stats.attackCount += (res.leg1Result.executedActions["action.attack"] || 0);
          stats.throwingCount += (res.leg0Result.executedActions["action.throwing"] || 0);
          stats.throwingCount += (res.leg1Result.executedActions["action.throwing"] || 0);
        });
      });

      await Promise.all(valPromises);
      checkpoint.cumulativeMatchesExecuted += valTasks.length * 2;
      console.log(`    Validation complete. Cumulative: ${checkpoint.cumulativeMatchesExecuted} matches.`);

      // ランキング算出 (勝敗中心 Outcome-First)
      const ranked: ProductionCandidateStats[] = [];
      for (const stats of candidateStatsMap.values()) {
        stats.winRate = (stats.wins / stats.totalMatches) * 100;
        ranked.push(stats);
      }
      ranked.sort((a, b) => b.winRate - a.winRate);

      console.log(`\n[Generation ${gen} Official Ranking]:`);
      for (const r of ranked) {
        console.log(
          `  - ${r.genomeId.padEnd(32)}: WinRate=${r.winRate.toFixed(1).padStart(5)}% (${r.wins}/${r.totalMatches}) | vsGen7=${r.vsGen7Wins}/${r.vsGen7Matches} | vsGen5=${r.vsGen5Wins}/${r.vsGen5Matches} | Atk=${r.attackCount} | Throw=${r.throwingCount}`
        );
      }

      const genBest = ranked[0];
      const genBestInd = checkpoint.population.find((p) => p.genomeId === genBest.genomeId)!;

      if (!checkpoint.bestEverCandidate || genBest.winRate > checkpoint.bestEverCandidate.winRate) {
        checkpoint.bestEverCandidate = genBest;
        checkpoint.bestEverDNA = DecisionDNACodec.clone(genBestInd.dna);
      }

      checkpoint.generationHistory.push({
        generation: gen,
        bestCandidate: genBest,
        ranking: ranked,
        cumulativeMatches: checkpoint.cumulativeMatchesExecuted,
      });

      checkpoint.currentGeneration = gen + 1;

      // 次世代母集団の生成 (gen < endGen - 1 の場合)
      if (gen < TOTAL_GENERATIONS - 1) {
        const nextPop: { genomeId: string; dna: DecisionDNA; digest: string }[] = [];

        // エリート保存: 上位 2 個体は無改変で維持
        const elite1 = checkpoint.population.find((p) => p.genomeId === ranked[0].genomeId)!;
        const elite2 = checkpoint.population.find((p) => p.genomeId === ranked[1].genomeId)!;
        nextPop.push({
          genomeId: `gen8-prod-g${gen + 1}-ind0-elite`,
          dna: DecisionDNACodec.clone(elite1.dna),
          digest: elite1.digest,
        });
        nextPop.push({
          genomeId: `gen8-prod-g${gen + 1}-ind1-elite`,
          dna: DecisionDNACodec.clone(elite2.dna),
          digest: elite2.digest,
        });

        // 過去王者 (Gen 7) は多様性・ベンチマーク保持のため常に 1 枠維持
        nextPop.push({
          genomeId: `gen8-prod-g${gen + 1}-ind2-gen7anchor`,
          dna: DecisionDNACodec.clone(champions.gen7DNA),
          digest: champions.gen7Digest,
        });

        // 残り 9 個体を上位陣の変異・交叉から生成
        for (let k = 3; k < POPULATION_SIZE; k++) {
          const parentA = checkpoint.population.find((p) => p.genomeId === ranked[k % 3].genomeId)!;
          const parentB = checkpoint.population.find((p) => p.genomeId === ranked[(k + 1) % 6].genomeId)!;
          const seedBase = TRAINING_BASE_SEED + gen * 5000 + k * 197;

          let offspringDNA: DecisionDNA;
          if (k % 2 === 0) {
            // 変異
            const m = GeneticMutation.mutate(
              { patternWeights: parentA.dna.patternWeights, contextPatternWeights: parentA.dna.contextPatternWeights },
              seedBase,
              mutationConfig
            );
            offspringDNA = {
              ...parentA.dna,
              metadata: { ...parentA.dna.metadata, id: `dna-gen8-prod-g${gen + 1}-ind${k}` },
              patternWeights: m.patternWeights,
              contextPatternWeights: m.contextPatternWeights,
            };
          } else {
            // 交叉
            const c = GeneticCrossover.cross(
              {
                parentA: asSelectedParent(parentA.dna, parentA.genomeId, gen, ranked[k % 3]?.winRate || 1.0),
                parentB: asSelectedParent(parentB.dna, parentB.genomeId, gen, ranked[(k + 1) % 6]?.winRate || 1.0),
              },
              seedBase
            );
            offspringDNA = {
              ...parentA.dna,
              metadata: { ...parentA.dna.metadata, id: `dna-gen8-prod-g${gen + 1}-ind${k}` },
              patternWeights: c.patternWeights,
              contextPatternWeights: c.contextPatternWeights,
            };
          }

          const digest = SemanticSHA256.hash(JSON.stringify(offspringDNA));
          nextPop.push({
            genomeId: `gen8-prod-g${gen + 1}-ind${k}`,
            dna: offspringDNA,
            digest,
          });
        }

        checkpoint.population = nextPop;
      }

      // Checkpoint 保存 (各世代完了時)
      checkpoint.timestamp = new Date().toISOString();
      fs.writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2), "utf8");
      console.log(`>>> Checkpoint saved to: ${checkpointPath}`);

      if (checkpoint.bestEverDNA) {
        fs.writeFileSync(
          path.join(outDir, "best-candidate-champion.json"),
          JSON.stringify(checkpoint.bestEverDNA, null, 2),
          "utf8"
        );
      }

      // 上限試合数チェック
      if (checkpoint.cumulativeMatchesExecuted >= maxMatchesLimit) {
        console.log(`[Limit Reached] Reached maxMatchesLimit (${maxMatchesLimit}). Safely halting.`);
        break;
      }
    }
  } finally {
    console.log(">>> Terminating Worker Pool...");
    await workerPool.terminate();
    console.log("    Worker Pool terminated.");
  }

  console.log("\n================================================================================");
  console.log("EXECUTION COMPLETED");
  console.log("================================================================================");
  console.log(`- Cumulative Matches:     ${checkpoint.cumulativeMatchesExecuted} (<= ${maxMatchesLimit} limit verified)`);
  console.log(`- Best Candidate Genome:  ${checkpoint.bestEverCandidate?.genomeId}`);
  console.log(`- Best Candidate WinRate: ${checkpoint.bestEverCandidate?.winRate.toFixed(1)}%`);
  console.log(`- Best Candidate Digest:  ${checkpoint.bestEverCandidate?.dnaDigest}`);
  console.log(`- Checkpoint Saved:       ${checkpointPath}`);
}

main().catch((err) => {
  console.error("PRODUCTION EVOLUTION FATAL:", err);
  process.exit(1);
});
