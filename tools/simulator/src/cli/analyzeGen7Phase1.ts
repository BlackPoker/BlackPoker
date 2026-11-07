/**
 * BlackPoker Work 4-3 — Phase 1: Gen 7 Champion In-Depth Diagnostic & Analysis
 *
 * 【目的】
 * Gen 7 Champion の対戦挙動を多面的に分析し、Gen 5 との差、自己対戦での傾向、
 * アクション選択傾向、敗因、長期戦/短期戦への対応、および「明らかに不合理な行動 (Blunder)」
 * を具体的な数値と実例で抽出する。
 *
 * 【Seed 設計】
 * 診断用新規 Seed: 200_001 〜 200_050 (50 Seeds)
 * 既存 Holdout (95001〜95030) や既存訓練 Seed とは完全に独立。
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
  SingleMatchExecutionResult,
} from "../engine/simulation/MillionMatchCampaignEngine";
import { DecisionRequest } from "../domain/decision/DecisionRequest";
import { DecisionResponse } from "../domain/decision/DecisionResponse";
import { ParticipantPolicySpec } from "../domain/simulation/MillionMatchInfraTypes";

interface BlunderRecord {
  matchId: string;
  seed: number;
  turn: number;
  blunderType: "LETHAL_MISSED" | "FATAL_PASS" | "HIGH_PASS_STALL" | "IRRATIONAL_DEFENSE";
  description: string;
  selectedAction: string;
  availableActions: string[];
}

interface MatchDetailedStats {
  matchId: string;
  opponent: string;
  seat: "p1" | "p2";
  seed: number;
  won: boolean;
  reason: string;
  turnCount: number;
  totalDecisions: number;
  passDecisions: number;
  executedActions: Record<string, number>;
  offeredActions: Record<string, number>;
  gen7Blunders: BlunderRecord[];
}

// DecisionPolicy をラップして Blunder を検知する
class InstrumentedGen7Policy implements DecisionPolicy {
  public readonly descriptor: any;
  public blunders: BlunderRecord[] = [];
  private currentConsecutivePass = 0;
  private readonly inner: GenomePolicy;
  private readonly matchContext: { matchId: string; seed: number };

  constructor(dna: any, name: string, matchContext: { matchId: string; seed: number }) {
    this.inner = new GenomePolicy(dna, name);
    this.descriptor = this.inner.descriptor;
    this.matchContext = matchContext;
  }

  public choose(request: Readonly<DecisionRequest>): DecisionResponse {
    const response = this.inner.choose(request);
    this.recordDecision(request, response);
    return response;
  }

  private recordDecision(request: Readonly<DecisionRequest>, response: Readonly<DecisionResponse>) {
    const patterns = request.patterns || [];
    const chosen = patterns[response.selectedPatternRef];
    const chosenActionId =
      chosen?.actionSelectionRef !== undefined
        ? request.catalog?.actions?.[chosen?.actionSelectionRef]?.actionId
        : chosen?.kind || "unknown";

    if (chosenActionId?.includes("pass")) {
      this.currentConsecutivePass++;
    } else {
      this.currentConsecutivePass = 0;
    }

    // 観測情報
    const obs = request.observation;
    const viewerId = request.playerId;
    const selfPlayer = obs.players?.find((p) => p.playerId === viewerId || p.isViewer);
    const oppPlayer = obs.players?.find((p) => p.playerId !== viewerId && !p.isViewer);
    const selfLife = selfPlayer?.lifeCount ?? 0;
    const oppLife = oppPlayer?.lifeCount ?? (oppPlayer?.lifeDisplay ? parseInt(oppPlayer.lifeDisplay, 10) : 99);

    const availableActionIds = patterns.map(
      (p) =>
        p.actionSelectionRef !== undefined
          ? request.catalog?.actions?.[p.actionSelectionRef]?.actionId || p.kind
          : p.kind
    );

    // 1. リーサル見逃し (Lethal Missed):
    // 相手ライフが 1〜2 点で、相手フィールドにブロッカーがおらず、攻撃可能な選択肢があるのにパスを選択
    const hasAttackOption = availableActionIds.some((id) => id.includes("attack"));
    const oppBlockersCount = oppPlayer?.field?.filter((u) => u.battle?.role === "blocker" || u.state !== "drive")?.length ?? 0;
    if (oppLife <= 2 && oppBlockersCount === 0 && hasAttackOption) {
      if (chosenActionId?.includes("pass")) {
        this.blunders.push({
          matchId: this.matchContext.matchId,
          seed: this.matchContext.seed,
          turn: obs.turnCount || 0,
          blunderType: "LETHAL_MISSED",
          description: `Opponent life is ${oppLife} with 0 blockers, but Gen 7 chose "${chosenActionId}" instead of Attack.`,
          selectedAction: chosenActionId || "unknown",
          availableActions: availableActionIds,
        });
      }
    }

    // 2. 致死ダメージに対するブロック拒否 (Fatal Pass):
    // 自軍ライフが 1〜2 点で、ブロック可能な選択肢があるのにパスを選択
    const hasBlockOption = availableActionIds.some((id) => id.includes("block"));
    if (selfLife <= 2 && hasBlockOption && chosenActionId?.includes("pass")) {
      this.blunders.push({
        matchId: this.matchContext.matchId,
        seed: this.matchContext.seed,
        turn: obs.turnCount || 0,
        blunderType: "FATAL_PASS",
        description: `Self life is ${selfLife} with block option available, but Gen 7 chose Pass.`,
        selectedAction: chosenActionId || "unknown",
        availableActions: availableActionIds,
      });
    }

    // 3. 高連続パスによる膠着 (High Pass Stall):
    // 自ターンで合法アクション（攻撃・召喚等）が 3 つ以上あるのに 5 回以上連続パス
    if (this.currentConsecutivePass >= 5 && patterns.length >= 3 && chosenActionId?.includes("pass")) {
      this.blunders.push({
        matchId: this.matchContext.matchId,
        seed: this.matchContext.seed,
        turn: obs.turnCount || 0,
        blunderType: "HIGH_PASS_STALL",
        description: `Gen 7 performed ${this.currentConsecutivePass} consecutive passes despite having ${patterns.length} legal options.`,
        selectedAction: chosenActionId || "unknown",
        availableActions: availableActionIds,
      });
    }
  }
}

async function main() {
  console.log("================================================================================");
  console.log("BlackPoker Work 4-3 — Phase 1: Gen 7 Champion Diagnostic Analysis");
  console.log("================================================================================");

  const rulesDir = path.resolve("src/data/rules-vnext");
  const fullPkg = await loadRulePackageFromDirectory(rulesDir);
  getPlaytestRulePackage(fullPkg);
  const sessionFactory = await prepareOfficialSessionFactory(DEFAULT_REGULATION_ID);
  const champions = loadOfficialChampionsStrict();

  const seedsCount = 30; // 30 Seeds (全350試合) で十分な統計的有意性と詳細サンプルを収集
  const seedsStart = 200_001;
  const testSeeds = Array.from({ length: seedsCount }, (_, i) => seedsStart + i);

  console.log(`Diagnostic Seeds: ${seedsStart} .. ${seedsStart + seedsCount - 1} (${seedsCount} seeds, completely clean)`);
  console.log("--------------------------------------------------------------------------------");

  const gen7Spec: ParticipantPolicySpec = {
    policyId: "gen7-champion",
    name: "Gen 7 Champion",
    kind: "GENOME",
    role: "CANDIDATE",
    dnaDigest: champions.gen7Digest,
  };

  const opponents: {
    id: string;
    name: string;
    spec: ParticipantPolicySpec;
    policyBuilder: (seed: number) => DecisionPolicy;
  }[] = [
    {
      id: "gen5",
      name: "Gen 5 Champion (Previous Champion)",
      spec: { policyId: "gen5-champion", name: "Gen 5 Champion", kind: "GENOME", role: "BASELINE", dnaDigest: champions.gen5Digest },
      policyBuilder: () => new GenomePolicy(champions.gen5DNA, "Gen5Champion"),
    },
    {
      id: "self",
      name: "Gen 7 Champion (Self-Play)",
      spec: gen7Spec,
      policyBuilder: () => new GenomePolicy(champions.gen7DNA, "Gen7Champion-Opp"),
    },
    {
      id: "random",
      name: "SeededRandom",
      spec: { policyId: "seeded-random", name: "SeededRandom", kind: "SEEDED_RANDOM", role: "BASELINE" },
      policyBuilder: (seed: number) => new RandomPolicy(new SeededRandom(seed), "SeededRandom"),
    },
    {
      id: "first-legal",
      name: "FirstLegal",
      spec: { policyId: "first-legal", name: "FirstLegal", kind: "FIRST_LEGAL", role: "BASELINE" },
      policyBuilder: () => new FirstLegalPolicy(false),
    },
  ];

  const allStats: MatchDetailedStats[] = [];

  for (const opp of opponents) {
    console.log(`\n>>> Evaluating Gen 7 Champion vs ${opp.name}...`);
    let gen7Wins = 0;
    let oppWins = 0;
    let draws = 0;

    for (let i = 0; i < testSeeds.length; i++) {
      const matchSeed = testSeeds[i];
      const p1Seed = derivePlayerSeed(matchSeed, "p1");
      const p2Seed = derivePlayerSeed(matchSeed, "p2");

      // Leg 0: p1 = Gen 7, p2 = Opponent
      const matchId0 = `diag-p${i}-l0-s${matchSeed}-gen7-vs-${opp.id}`;
      const instGen7Policy0 = new InstrumentedGen7Policy(champions.gen7DNA, "Gen7Champion", { matchId: matchId0, seed: matchSeed });
      const oppPolicy0 = opp.policyBuilder(p2Seed);

      const res0 = executeSingleInstrumentedMatch({
        campaignId: "diag-phase1",
        workId: "BP-SIM-AI-V92-WORK4-3-PHASE1",
        matchIndex: i * 2,
        pairIndex: i,
        legIndex: 0,
        matchId: matchId0,
        matchupId: `matchup-gen7-vs-${opp.id}`,
        matchSeed,
        playerSeeds: { p1: p1Seed, p2: p2Seed },
        p1Spec: gen7Spec,
        p2Spec: opp.spec,
        p1Policy: instGen7Policy0,
        p2Policy: oppPolicy0,
        sessionFactory,
        regulationId: DEFAULT_REGULATION_ID,
        frameId: DEFAULT_FRAME_ID,
        maxDecisionsPerMatch: DEFAULT_DECISION_LIMIT,
      });

      const gen7Won0 = res0.outcomeRecord.winner === "p1";
      if (gen7Won0) gen7Wins++;
      else if (res0.outcomeRecord.winner === "p2") oppWins++;
      else draws++;

      allStats.push({
        matchId: matchId0,
        opponent: opp.id,
        seat: "p1",
        seed: matchSeed,
        won: gen7Won0,
        reason: res0.outcomeRecord.reason,
        turnCount: res0.outcomeRecord.turnCount,
        totalDecisions: res0.outcomeRecord.totalDecisions,
        passDecisions: res0.outcomeRecord.passDecisions,
        executedActions: res0.executedActions,
        offeredActions: res0.offeredActions,
        gen7Blunders: instGen7Policy0.blunders,
      });

      // Leg 1: p1 = Opponent, p2 = Gen 7 (座席反転、自己対戦以外)
      if (opp.id !== "self") {
        const matchId1 = `diag-p${i}-l1-s${matchSeed}-${opp.id}-vs-gen7`;
        const instGen7Policy1 = new InstrumentedGen7Policy(champions.gen7DNA, "Gen7Champion", { matchId: matchId1, seed: matchSeed });
        const oppPolicy1 = opp.policyBuilder(p1Seed);

        const res1 = executeSingleInstrumentedMatch({
          campaignId: "diag-phase1",
          workId: "BP-SIM-AI-V92-WORK4-3-PHASE1",
          matchIndex: i * 2 + 1,
          pairIndex: i,
          legIndex: 1,
          matchId: matchId1,
          matchupId: `matchup-gen7-vs-${opp.id}`,
          matchSeed,
          playerSeeds: { p1: p1Seed, p2: p2Seed },
          p1Spec: opp.spec,
          p2Spec: gen7Spec,
          p1Policy: oppPolicy1,
          p2Policy: instGen7Policy1,
          sessionFactory,
          regulationId: DEFAULT_REGULATION_ID,
          frameId: DEFAULT_FRAME_ID,
          maxDecisionsPerMatch: DEFAULT_DECISION_LIMIT,
        });

        const gen7Won1 = res1.outcomeRecord.winner === "p2";
        if (gen7Won1) gen7Wins++;
        else if (res1.outcomeRecord.winner === "p1") oppWins++;
        else draws++;

        allStats.push({
          matchId: matchId1,
          opponent: opp.id,
          seat: "p2",
          seed: matchSeed,
          won: gen7Won1,
          reason: res1.outcomeRecord.reason,
          turnCount: res1.outcomeRecord.turnCount,
          totalDecisions: res1.outcomeRecord.totalDecisions,
          passDecisions: res1.outcomeRecord.passDecisions,
          executedActions: res1.executedActions,
          offeredActions: res1.offeredActions,
          gen7Blunders: instGen7Policy1.blunders,
        });
      }
    }

    const totalLegs = opp.id === "self" ? testSeeds.length : testSeeds.length * 2;
    const winRate = (gen7Wins / totalLegs) * 100;
    console.log(`  Result: Gen7 ${gen7Wins} wins / Opp ${oppWins} wins / ${draws} draws (WinRate: ${winRate.toFixed(1)}%)`);
  }

  // 分析集計とレポート作成
  console.log("\n================================================================================");
  console.log("PHASE 1 DIAGNOSTIC ANALYSIS SUMMARY");
  console.log("================================================================================");

  // 1. 対戦相手別 勝率・平均ターン・デシジョン
  for (const oppId of ["gen5", "self", "random", "first-legal"]) {
    const matches = allStats.filter((s) => s.opponent === oppId);
    const wins = matches.filter((s) => s.won).length;
    const winRate = (wins / matches.length) * 100;
    const avgTurns = matches.reduce((acc, m) => acc + m.turnCount, 0) / matches.length;
    const avgDecisions = matches.reduce((acc, m) => acc + m.totalDecisions, 0) / matches.length;
    console.log(`- vs ${oppId.padEnd(12)}: WinRate = ${winRate.toFixed(1).padStart(5)}% (${wins}/${matches.length}) | Avg Turns = ${avgTurns.toFixed(1)} | Avg Decisions = ${avgDecisions.toFixed(1)}`);
  }

  // 2. アクション実行集計 (全対戦)
  const aggregatedExecuted: Record<string, number> = {};
  for (const m of allStats) {
    for (const [k, v] of Object.entries(m.executedActions)) {
      aggregatedExecuted[k] = (aggregatedExecuted[k] ?? 0) + v;
    }
  }

  console.log("\n[Top Executed Actions in Matches]");
  const sortedActions = Object.entries(aggregatedExecuted).sort((a, b) => b[1] - a[1]);
  for (const [actionId, count] of sortedActions.slice(0, 10)) {
    console.log(`  - ${actionId.padEnd(25)}: ${count.toLocaleString().padStart(6)} times`);
  }

  // 3. 敗因分析 (Gen 5 に対する敗北試合の傾向)
  const lossesVsGen5 = allStats.filter((m) => m.opponent === "gen5" && !m.won);
  console.log(`\n[Loss Analysis vs Gen 5 Champion (${lossesVsGen5.length} losses)]:`);
  const avgLossTurns = lossesVsGen5.reduce((acc, m) => acc + m.turnCount, 0) / (lossesVsGen5.length || 1);
  const avgLossDecisions = lossesVsGen5.reduce((acc, m) => acc + m.totalDecisions, 0) / (lossesVsGen5.length || 1);
  console.log(`- Avg Loss Turns:     ${avgLossTurns.toFixed(1)}`);
  console.log(`- Avg Loss Decisions: ${avgLossDecisions.toFixed(1)}`);
  const passDominatedLosses = lossesVsGen5.filter((m) => (m.passDecisions / (m.totalDecisions || 1)) > 0.6).length;
  console.log(`- Pass > 60% in loss: ${passDominatedLosses}/${lossesVsGen5.length} matches (${((passDominatedLosses / (lossesVsGen5.length || 1)) * 100).toFixed(1)}%)`);

  // 4. 短期戦 vs 長期戦
  const shortMatches = allStats.filter((m) => m.turnCount <= 8);
  const midMatches = allStats.filter((m) => m.turnCount >= 9 && m.turnCount <= 14);
  const longMatches = allStats.filter((m) => m.turnCount >= 15);
  console.log("\n[Game Length Win Rates (All Opponents)]:");
  console.log(`- Short (<8 turns):  ${((shortMatches.filter((m) => m.won).length / (shortMatches.length || 1)) * 100).toFixed(1)}% (${shortMatches.length} matches)`);
  console.log(`- Mid (9-14 turns):  ${((midMatches.filter((m) => m.won).length / (midMatches.length || 1)) * 100).toFixed(1)}% (${midMatches.length} matches)`);
  console.log(`- Long (>=15 turns): ${((longMatches.filter((m) => m.won).length / (longMatches.length || 1)) * 100).toFixed(1)}% (${longMatches.length} matches)`);

  // 5. 検出された Blunder (悪手・不合理行動)
  const allBlunders = allStats.flatMap((m) => m.gen7Blunders);
  const lethalMisses = allBlunders.filter((b) => b.blunderType === "LETHAL_MISSED");
  const fatalPasses = allBlunders.filter((b) => b.blunderType === "FATAL_PASS");
  const stallPasses = allBlunders.filter((b) => b.blunderType === "HIGH_PASS_STALL");

  console.log("\n[Detected Blunders / Irrational Actions]:");
  console.log(`- Lethal Misses:     ${lethalMisses.length} instances`);
  console.log(`- Fatal Passes:      ${fatalPasses.length} instances`);
  console.log(`- High Pass Stalls:  ${stallPasses.length} instances`);

  if (lethalMisses.length > 0) {
    console.log(`  Sample Lethal Miss: [${lethalMisses[0].matchId}] ${lethalMisses[0].description}`);
  }
  if (fatalPasses.length > 0) {
    console.log(`  Sample Fatal Pass:  [${fatalPasses[0].matchId}] ${fatalPasses[0].description}`);
  }
  if (stallPasses.length > 0) {
    console.log(`  Sample High Stall:  [${stallPasses[0].matchId}] ${stallPasses[0].description}`);
  }

  // 成果物保存
  const outDir = path.resolve(".artifacts/phase1-gen7-diagnostic");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "diagnostic-summary.json"), JSON.stringify({
    timestamp: new Date().toISOString(),
    seedsUsed: { start: seedsStart, count: seedsCount },
    summary: {
      actionDistribution: aggregatedExecuted,
      blunders: { lethalMisses: lethalMisses.length, fatalPasses: fatalPasses.length, stallPasses: stallPasses.length },
      blunderSamples: allBlunders.slice(0, 10),
    },
    allStats,
  }, null, 2), "utf8");

  console.log(`\nDetailed report written to: ${path.join(outDir, "diagnostic-summary.json")}`);
}

main().catch((err) => {
  console.error("DIAGNOSTIC ERROR:", err);
  process.exit(1);
});
