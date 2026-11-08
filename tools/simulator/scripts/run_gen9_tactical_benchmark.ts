/**
 * run_gen9_tactical_benchmark.ts
 *
 * BlackPoker Gen 9 戦術プロトタイプ (Work 5-1 R2) 客観的ベンチマーク対戦評価 & 再現スクリプト
 *
 * 【実行モード】
 * 1. 再現実行モード (Seed: 500001〜500030, 30ペア / 60試合 / 対戦相手)
 *    - 報告済みの 180 試合を再実行し、結果の再現性を検証する。
 *    - Gen 8 に対する敗因別の分類を出力する。
 * 2. 改善版評価モード (Seed: 600001〜600030, 30ペア / 60試合 / 対戦相手)
 *    - 未使用の独立 Seed を用いて、損害予測・攻撃判断・ブロック評価改善後の Gen 9 R2 を評価する。
 */

import * as fs from "fs";
import * as path from "path";
import { performance } from "perf_hooks";
import { loadRegulationCatalog } from "../src/engine/regulation/RegulationLoader.js";
import { loadRulePackageFromDirectory } from "../src/engine/rules/RuleLoader.js";
import { OfficialRegulationMatchSetup } from "../src/engine/regulation/OfficialRegulationMatchSetup.js";
import { GameSession } from "../src/engine/session/GameSession.js";
import { SimulationRunner } from "../src/engine/simulation/SimulationRunner.js";
import { DecisionPolicy, RandomPolicy } from "../src/engine/simulation/DecisionPolicy.js";
import { SeededRandom } from "../src/engine/random/RandomSource.js";
import { GenomePolicy } from "../src/engine/ai/GenomePolicy.js";
import { Gen9TacticalPrototypePolicy } from "../src/engine/ai/Gen9TacticalPrototypePolicy.js";
import { GenericTacticalEvaluator } from "../src/engine/rules/GenericTacticalEvaluator.js";
import { createGen8ChampionCandidatePolicy } from "../src/engine/ai/Gen8DNALoader.js";
import { loadOfficialChampionsStrict } from "../src/cli/largeScaleSimulationRunner.js";

interface SingleMatchTelemetry {
  matchIndex: number;
  matchSeed: number;
  legIndex: 0 | 1; // 0: P1=Gen9, 1: P2=Gen9
  gen9Seat: "p1" | "p2";
  opponentSeat: "p1" | "p2";
  opponentName: string;
  winner: string | undefined;
  gen9Won: boolean;
  gen9Lost: boolean;
  isDraw: boolean;
  completed: boolean;
  reason?: string;
  turnCount: number;
  totalDecisions: number;
  gen9Decisions: number;
  gen9TimeUs: number;
}

interface PairSummary {
  pairIndex: number;
  matchSeed: number;
  leg0: SingleMatchTelemetry;
  leg1: SingleMatchTelemetry;
  pairScore: number;
}

interface BenchmarkSuiteResult {
  mode: string;
  seedStart: number;
  pairsCount: number;
  totalMatches: number;
  opponentName: string;
  opponentId: string;
  opponentDigest: string;
  pairScoreMean: number;
  legWinRate: number;
  gen9Wins: number;
  oppWins: number;
  draws: number;
  incompletes: number;
  avgTurns: number;
  avgDecisions: number;
  avgGen9CpuTimeUsPerDecision: number;
  memoryUsageMB: {
    heapUsed: number;
    heapTotal: number;
    rss: number;
  };
  defeatCauses: Record<string, number>;
  pairs: PairSummary[];
}

// 測定用ラッパー Policy
class TimedGen9Policy implements DecisionPolicy {
  public totalTimeUs = 0;
  public decisionCount = 0;
  public readonly descriptor: any;

  constructor(private readonly inner: Gen9TacticalPrototypePolicy) {
    this.descriptor = inner.descriptor;
  }

  public choose(request: any): any {
    const start = performance.now();
    const res = this.inner.choose(request);
    const end = performance.now();
    this.totalTimeUs += (end - start) * 1000;
    this.decisionCount++;
    return res;
  }
}

async function runSuiteForOpponent(
  opp: { name: string; id: string; digest: string; createPolicy: (seat: "p1" | "p2", seed: number) => DecisionPolicy },
  seedStart: number,
  pairsCount: number,
  gen8DNA: any,
  reg: any,
  frame: any,
  rulePackage: any,
  mode: string
): Promise<BenchmarkSuiteResult> {
  const pairSummaries: PairSummary[] = [];
  let totalGen9TimeUs = 0;
  let totalGen9Decisions = 0;
  let totalTurns = 0;
  let totalDecisions = 0;
  let gen9Wins = 0;
  let oppWins = 0;
  let draws = 0;
  let incompletes = 0;
  let pairScoreSum = 0;

  const defeatCauses: Record<string, number> = {
    "自軍ライフ0(相手速攻/削り切り)": 0,
    "デッキアウト/山札切れ": 0,
    "最大手数超過/未完了": 0,
    "その他": 0,
  };

  const tacticalEvaluator = new GenericTacticalEvaluator(rulePackage);

  for (let p = 0; p < pairsCount; p++) {
    const matchSeed = seedStart + p;

    // Leg 0: P1=Gen9, P2=Opponent
    const gen9Policy0 = new TimedGen9Policy(new Gen9TacticalPrototypePolicy(gen8DNA, "Gen9-P1", tacticalEvaluator));
    const oppPolicy0 = opp.createPolicy("p2", matchSeed);

    const setup0 = OfficialRegulationMatchSetup.setupMatch(reg, frame, rulePackage, matchSeed, {
      playerNames: { p1: "Gen9", p2: opp.name },
    });
    const session0 = new GameSession(setup0.state, rulePackage, { matchSeed });
    const simRes0 = SimulationRunner.run(session0, { p1: gen9Policy0, p2: oppPolicy0 }, { maxDecisions: 1000 });

    const leg0Won = simRes0.winner === "p1";
    const leg0Lost = simRes0.winner === "p2";
    const leg0Draw = simRes0.completed && (simRes0.winner === "draw" || !simRes0.winner);

    const leg0: SingleMatchTelemetry = {
      matchIndex: p * 2,
      matchSeed,
      legIndex: 0,
      gen9Seat: "p1",
      opponentSeat: "p2",
      opponentName: opp.name,
      winner: simRes0.winner,
      gen9Won: leg0Won,
      gen9Lost: leg0Lost,
      isDraw: leg0Draw,
      completed: simRes0.completed,
      reason: simRes0.reason,
      turnCount: simRes0.turnCount,
      totalDecisions: simRes0.totalDecisions,
      gen9Decisions: gen9Policy0.decisionCount,
      gen9TimeUs: gen9Policy0.totalTimeUs,
    };
    totalGen9TimeUs += gen9Policy0.totalTimeUs;
    totalGen9Decisions += gen9Policy0.decisionCount;

    if (leg0Lost) {
      const reason = simRes0.reason ?? "";
      if (reason.includes("ライフが0")) defeatCauses["自軍ライフ0(相手速攻/削り切り)"]++;
      else if (reason.includes("山札") || reason.includes("デッキ")) defeatCauses["デッキアウト/山札切れ"]++;
      else if (!simRes0.completed) defeatCauses["最大手数超過/未完了"]++;
      else defeatCauses["その他"]++;
    }

    // Leg 1: P1=Opponent, P2=Gen9 (座席反転)
    const oppPolicy1 = opp.createPolicy("p1", matchSeed);
    const gen9Policy1 = new TimedGen9Policy(new Gen9TacticalPrototypePolicy(gen8DNA, "Gen9-P2", tacticalEvaluator));

    const setup1 = OfficialRegulationMatchSetup.setupMatch(reg, frame, rulePackage, matchSeed, {
      playerNames: { p1: opp.name, p2: "Gen9" },
    });
    const session1 = new GameSession(setup1.state, rulePackage, { matchSeed });
    const simRes1 = SimulationRunner.run(session1, { p1: oppPolicy1, p2: gen9Policy1 }, { maxDecisions: 1000 });

    const leg1Won = simRes1.winner === "p2";
    const leg1Lost = simRes1.winner === "p1";
    const leg1Draw = simRes1.completed && (simRes1.winner === "draw" || !simRes1.winner);

    const leg1: SingleMatchTelemetry = {
      matchIndex: p * 2 + 1,
      matchSeed,
      legIndex: 1,
      gen9Seat: "p2",
      opponentSeat: "p1",
      opponentName: opp.name,
      winner: simRes1.winner,
      gen9Won: leg1Won,
      gen9Lost: leg1Lost,
      isDraw: leg1Draw,
      completed: simRes1.completed,
      reason: simRes1.reason,
      turnCount: simRes1.turnCount,
      totalDecisions: simRes1.totalDecisions,
      gen9Decisions: gen9Policy1.decisionCount,
      gen9TimeUs: gen9Policy1.totalTimeUs,
    };
    totalGen9TimeUs += gen9Policy1.totalTimeUs;
    totalGen9Decisions += gen9Policy1.decisionCount;

    if (leg1Lost) {
      const reason = simRes1.reason ?? "";
      if (reason.includes("ライフが0")) defeatCauses["自軍ライフ0(相手速攻/削り切り)"]++;
      else if (reason.includes("山札") || reason.includes("デッキ")) defeatCauses["デッキアウト/山札切れ"]++;
      else if (!simRes1.completed) defeatCauses["最大手数超過/未完了"]++;
      else defeatCauses["その他"]++;
    }

    // ペアスコア
    let s0 = 0.5;
    if (leg0Won) s0 = 1.0;
    else if (leg0Lost) s0 = 0.0;

    let s1 = 0.5;
    if (leg1Won) s1 = 1.0;
    else if (leg1Lost) s1 = 0.0;

    const pairScore = (s0 + s1) / 2;
    pairScoreSum += pairScore;

    if (leg0Won) gen9Wins++;
    else if (leg0Lost) oppWins++;
    else if (leg0Draw) draws++;
    else incompletes++;

    if (leg1Won) gen9Wins++;
    else if (leg1Lost) oppWins++;
    else if (leg1Draw) draws++;
    else incompletes++;

    totalTurns += leg0.turnCount + leg1.turnCount;
    totalDecisions += leg0.totalDecisions + leg1.totalDecisions;

    pairSummaries.push({
      pairIndex: p,
      matchSeed,
      leg0,
      leg1,
      pairScore,
    });
  }

  const totalMatches = pairsCount * 2;
  const pairScoreMean = pairScoreSum / pairsCount;
  const legWinRate = (gen9Wins / totalMatches) * 100;
  const avgTurns = totalTurns / totalMatches;
  const avgDecisions = totalDecisions / totalMatches;
  const avgGen9CpuTimeUsPerDecision = totalGen9Decisions > 0 ? totalGen9TimeUs / totalGen9Decisions : 0;

  const mem = process.memoryUsage();

  return {
    mode,
    seedStart,
    pairsCount,
    totalMatches,
    opponentName: opp.name,
    opponentId: opp.id,
    opponentDigest: opp.digest,
    pairScoreMean,
    legWinRate,
    gen9Wins,
    oppWins,
    draws,
    incompletes,
    avgTurns,
    avgDecisions,
    avgGen9CpuTimeUsPerDecision,
    memoryUsageMB: {
      heapUsed: Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10,
      heapTotal: Math.round((mem.heapTotal / 1024 / 1024) * 10) / 10,
      rss: Math.round((mem.rss / 1024 / 1024) * 10) / 10,
    },
    defeatCauses,
    pairs: pairSummaries,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const isReproduceOnly = args.includes("--reproduce-report");
  const isEvalImprovedOnly = args.includes("--eval-improved");
  const runBoth = !isReproduceOnly && !isEvalImprovedOnly;

  const rulesDir = path.resolve("src/data/rules-vnext");
  const regulationsDir = path.resolve("src/data/regulations");
  const catalog = await loadRegulationCatalog(regulationsDir);
  const rulePackage = await loadRulePackageFromDirectory(rulesDir);

  const reg = catalog.regulations.get("standard-pack")!;
  const frame = catalog.frames.get("pack")!;

  const gen8Candidate = createGen8ChampionCandidatePolicy();
  const gen8DNA = (gen8Candidate as any).dna;
  const champions = loadOfficialChampionsStrict();
  const gen7DNA = champions.gen7DNA;

  const opponents = [
    {
      name: "Gen 8 Champion Candidate",
      id: "gen8-prod-g0-ind7-cross7",
      digest: "11fff0f578c92af376eece46ff90f9eba3785e59d0cf64d5eeffc7967946445e",
      createPolicy: (seat: "p1" | "p2") => new GenomePolicy(gen8DNA, `Gen8-${seat}`),
    },
    {
      name: "Official Gen 7 Champion",
      id: "gen7-champion",
      digest: champions.gen7Digest,
      createPolicy: (seat: "p1" | "p2") => new GenomePolicy(gen7DNA, `Gen7-${seat}`),
    },
    {
      name: "SeededRandom",
      id: "seeded-random-v1",
      digest: "ALGORITHMIC_PSEUDORANDOM",
      createPolicy: (seat: "p1" | "p2", seed: number) =>
        new RandomPolicy(new SeededRandom(seed + (seat === "p1" ? 11 : 22)), `Random-${seat}`),
    },
  ];

  if (isReproduceOnly || runBoth) {
    console.log("================================================================================");
    console.log(" [MODE: REPRODUCE REPORT] 報告済み 180 試合の再現実行 (Seed: 500001〜500030)");
    console.log("================================================================================");

    const reproduceResults: BenchmarkSuiteResult[] = [];
    for (const opp of opponents) {
      const res = await runSuiteForOpponent(opp, 500001, 30, gen8DNA, reg, frame, rulePackage, "REPRODUCE");
      reproduceResults.push(res);
      console.log(`\n対戦相手: ${res.opponentName}`);
      console.log(`  ペア平均スコア: ${(res.pairScoreMean * 100).toFixed(1)}%`);
      console.log(`  個別勝率: ${res.legWinRate.toFixed(1)}% (${res.gen9Wins}W - ${res.oppWins}L - ${res.draws}D)`);
      console.log(`  平均ターン数: ${res.avgTurns.toFixed(1)} ターン`);
      console.log(`  1判断CPU時間: ${res.avgGen9CpuTimeUsPerDecision.toFixed(1)} µs (${(res.avgGen9CpuTimeUsPerDecision / 1000).toFixed(3)} ms)`);
      console.log(`  メモリ使用量: HeapUsed ${res.memoryUsageMB.heapUsed}MB / RSS ${res.memoryUsageMB.rss}MB`);
      if (res.oppWins > 0 && res.defeatCauses) {
        console.log(`  敗因分類:`, JSON.stringify(res.defeatCauses));
      }
    }

    const outPath = path.resolve(".artifacts/benchmark-reproduce-report-500001-500030.json");
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(reproduceResults, null, 2), "utf-8");
    console.log(`\n=> 再現結果ログ保存完了: ${outPath}`);
  }

  if (isEvalImprovedOnly || runBoth) {
    console.log("\n================================================================================");
    console.log(" [MODE: EVAL IMPROVED R2] 未使用独立 Seed 180 試合評価 (Seed: 600001〜600030)");
    console.log("================================================================================");

    const improvedResults: BenchmarkSuiteResult[] = [];
    for (const opp of opponents) {
      const res = await runSuiteForOpponent(opp, 600001, 30, gen8DNA, reg, frame, rulePackage, "IMPROVED_R2");
      improvedResults.push(res);
      console.log(`\n対戦相手: ${res.opponentName}`);
      console.log(`  ペア平均スコア: ${(res.pairScoreMean * 100).toFixed(1)}%`);
      console.log(`  個別勝率: ${res.legWinRate.toFixed(1)}% (${res.gen9Wins}W - ${res.oppWins}L - ${res.draws}D)`);
      console.log(`  平均ターン数: ${res.avgTurns.toFixed(1)} ターン`);
      console.log(`  1判断CPU時間: ${res.avgGen9CpuTimeUsPerDecision.toFixed(1)} µs (${(res.avgGen9CpuTimeUsPerDecision / 1000).toFixed(3)} ms)`);
      console.log(`  メモリ使用量: HeapUsed ${res.memoryUsageMB.heapUsed}MB / RSS ${res.memoryUsageMB.rss}MB`);
      if (res.oppWins > 0 && res.defeatCauses) {
        console.log(`  敗因分類:`, JSON.stringify(res.defeatCauses));
      }
    }

    const outPath = path.resolve(".artifacts/benchmark-improved-r2-600001-600030.json");
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(improvedResults, null, 2), "utf-8");
    console.log(`\n=> 改善版結果ログ保存完了: ${outPath}`);
  }
}

main().catch(err => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
