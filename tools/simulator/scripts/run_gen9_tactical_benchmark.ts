/**
 * run_gen9_tactical_benchmark.ts
 *
 * BlackPoker Gen 9 戦術プロトタイプ 同一Seed A/B 比較評価スクリプト (Work 5-1 R4)
 *
 * 【目的】
 * - 旧版 Work 5-1 R1 Policy (Commit: fa21b51f677d4f5adf5ce5c2bce42d995d43fa60, ハードコード推定版) と
 *   現在版 Work 5-1 R3/R4 Policy (汎用戦術評価基盤 GenericTacticalEvaluator 統合版) を明確に区別し、
 *   同一 Seed (500001〜500030, 各対戦相手 30ペア = 60試合)・同一対戦相手・座席反転条件で厳密に A/B 比較する。
 * - 勝率の変化に加え、対戦相手別・座席別 (P1 vs P2)・敗因別の違い、および勝敗が変化した個別試合の差分を JSON 保存・出力する。
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { performance } from "perf_hooks";
import { loadRegulationCatalog } from "../src/engine/regulation/RegulationLoader.js";
import { loadRulePackageFromDirectory } from "../src/engine/rules/RuleLoader.js";
import { OfficialRegulationMatchSetup } from "../src/engine/regulation/OfficialRegulationMatchSetup.js";
import { GameSession } from "../src/engine/session/GameSession.js";
import { SimulationRunner } from "../src/engine/simulation/SimulationRunner.js";
import { DecisionPolicy, PolicyDescriptor, RandomPolicy } from "../src/engine/simulation/DecisionPolicy.js";
import { SeededRandom } from "../src/engine/random/RandomSource.js";
import { GenomePolicy } from "../src/engine/ai/GenomePolicy.js";
import { Gen9TacticalPrototypePolicy } from "../src/engine/ai/Gen9TacticalPrototypePolicy.js";
import { GenericTacticalEvaluator } from "../src/engine/rules/GenericTacticalEvaluator.js";
import { createGen8ChampionCandidatePolicy } from "../src/engine/ai/Gen8DNALoader.js";
import { loadOfficialChampionsStrict } from "../src/cli/largeScaleSimulationRunner.js";
import { DecisionRequest } from "../src/domain/decision/DecisionRequest.js";
import { DecisionResponse } from "../src/domain/decision/DecisionResponse.js";
import { DecisionDNA } from "../src/domain/ai/DecisionDNATypes.js";
import { DecisionDNACodec } from "../src/engine/ai/DecisionDNACodec.js";
import { DecisionFeatureEncoder } from "../src/engine/ai/DecisionFeatureEncoder.js";
import { GenomeScorer } from "../src/engine/ai/GenomeScorer.js";
import { LegalPattern } from "../src/domain/decision/LegalPattern.js";
import { RequestView, PlayerObservationView } from "../src/domain/decision/PlayerObservation.js";

export const R1_COMMIT_SHA = "fa21b51f677d4f5adf5ce5c2bce42d995d43fa60";
export const R3_BASE_COMMIT_SHA = "7f3812bd5a953e7c48e2e81f98b7150007d796e7";

/**
 * Work 5-1 R1 (Commit: fa21b51f677d4f5adf5ce5c2bce42d995d43fa60) の旧版 Policy 実装
 * - 死の槍のキーカード単純合算・固定値推定、無条件致死ペナルティ (-3.0)、
 *   単純最大サイズ比較による攻撃抑制など、R1 時点のロジックを忠実に保持。
 */
export class Gen9TacticalPrototypePolicyR1 implements DecisionPolicy {
  public readonly descriptor: PolicyDescriptor;
  private readonly dna: DecisionDNA;

  constructor(dna: Readonly<DecisionDNA>, name?: string) {
    DecisionDNACodec.validate(dna);
    this.dna = DecisionDNACodec.clone(dna);

    this.descriptor = {
      kind: "genome",
      policyVersion: 9,
      name: name ?? "Gen9TacticalPrototypePolicyR1",
      metadata: {
        commitSha: R1_COMMIT_SHA,
        dnaFormatVersion: this.dna.dnaFormatVersion,
        featureSchemaVersion: this.dna.featureSchemaVersion,
        scoringModel: "linear_interaction_plus_tactical_v1_r1_legacy",
        dnaId: this.dna.metadata?.id,
        dnaName: this.dna.metadata?.name,
      },
    };
  }

  public choose(request: Readonly<DecisionRequest>): DecisionResponse {
    if (
      request.blockAssignmentStream &&
      (request.patterns.length === 0 || request.blockAssignmentStream.patternCount > 256)
    ) {
      return this.chooseStreaming(request);
    }

    const patterns = request.patterns;
    if (!patterns || patterns.length === 0) {
      throw new Error(`DecisionRequest に選択可能なパターンが存在しません: ${request.decisionId}`);
    }

    const encodedFeatures = DecisionFeatureEncoder.encode(request);
    const baseScored = GenomeScorer.score(encodedFeatures, this.dna);

    let bestScore = -Infinity;
    let bestPatternRef = baseScored[0]?.patternRef ?? 0;

    for (let i = 0; i < baseScored.length; i++) {
      const sp = baseScored[i];
      const pat = patterns[sp.patternRef];
      const { adjustment } = this.calculateTacticalAdjustmentR1(request, pat);
      const finalScore = sp.score + adjustment;

      if (finalScore > bestScore) {
        bestScore = finalScore;
        bestPatternRef = sp.patternRef;
      }
    }

    return {
      decisionId: request.decisionId,
      stateVersion: request.stateVersion,
      selectedPatternRef: bestPatternRef,
    };
  }

  private chooseStreaming(request: Readonly<DecisionRequest>): DecisionResponse {
    const stream = request.blockAssignmentStream!;
    const contextValues = DecisionFeatureEncoder.encodeContextOnly(request);
    const encoderContext = DecisionFeatureEncoder.createBlockAssignmentEncoderContext(request);

    let bestScore = -Infinity;
    let bestIndex = 0;
    let currentIndex = 0;

    for (const assignments of stream.iterateAssignments()) {
      const pValues = DecisionFeatureEncoder.encodeBlockAssignmentValues(
        assignments,
        stream.candidateCount,
        encoderContext
      );
      const score = GenomeScorer.scoreSinglePattern(contextValues, pValues, this.dna);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = currentIndex;
      }
      currentIndex++;
    }

    return {
      decisionId: request.decisionId,
      stateVersion: request.stateVersion,
      selectedPatternRef: bestIndex,
    };
  }

  private calculateTacticalAdjustmentR1(
    request: Readonly<DecisionRequest>,
    pattern: Readonly<LegalPattern>
  ): { adjustment: number; reason?: string } {
    const obs = request.observation;
    const selfKey = request.playerId;
    const selfView = obs.players.find((p) => p.playerId === selfKey) ?? obs.players.find((p) => p.isViewer);
    const oppView = obs.players.find((p) => p.playerId !== selfKey) ?? obs.players.find((p) => !p.isViewer);
    const selfLife = selfView?.lifeCount ?? 15;

    let adjustment = 0;
    const stageRequests = obs.stageRequests ?? [];
    const oppRequests = stageRequests.filter((r) => r.controller !== selfKey);

    if (oppRequests.length > 0) {
      const primaryOppReq = oppRequests[oppRequests.length - 1];
      const estDamage = this.estimateRequestDamageR1(primaryOppReq, oppView);

      if (pattern.kind === "PASS") {
        if (estDamage > 0) {
          if (estDamage >= selfLife) {
            adjustment -= 3.0;
          } else if (selfLife - estDamage <= 4) {
            adjustment -= 1.0 * (estDamage / Math.max(1, selfLife));
          } else if (estDamage >= 5) {
            adjustment -= 0.4;
          }
        }
      }

      const act = pattern.actionSelectionRef !== undefined ? request.catalog.actions[pattern.actionSelectionRef] : undefined;
      if (act && act.actionId === "action.counter") {
        if (estDamage > 0) {
          if (estDamage >= selfLife) {
            adjustment += 2.5;
          } else if (selfLife - estDamage <= 4 || estDamage >= 8) {
            adjustment += 1.0;
          } else if (estDamage >= 4) {
            adjustment += 0.5;
          }
        }
      }
    }

    const act = pattern.actionSelectionRef !== undefined ? request.catalog.actions[pattern.actionSelectionRef] : undefined;
    if (act && act.actionId === "action.attack") {
      const oppUnits = oppView?.field ?? [];
      const activeBlockers = oppUnits.filter(
        (u) => u.state === "charge" && (u.currentSize ?? 0) > 0
      );
      const maxBlockerSize = activeBlockers.reduce(
        (max, u) => Math.max(max, u.currentSize ?? 0),
        0
      );

      const myAttackers = (selfView?.field ?? []).filter(
        (u) => u.state === "charge" && u.kind !== "bulwark" && (u.currentSize ?? 0) > 0
      );
      const myMaxAttackerSize = myAttackers.reduce(
        (max, u) => Math.max(max, u.currentSize ?? 0),
        0
      );

      if (maxBlockerSize > 0 && myMaxAttackerSize > 0) {
        if (maxBlockerSize > myMaxAttackerSize) {
          const sizeDiff = maxBlockerSize - myMaxAttackerSize;
          const suicidePenalty = Math.min(1.5, 0.2 + 0.08 * sizeDiff);
          adjustment -= suicidePenalty;
        } else if (myMaxAttackerSize >= maxBlockerSize) {
          adjustment += 0.1;
        }
      } else if (maxBlockerSize === 0 && myMaxAttackerSize > 0) {
        adjustment += 0.15;
      }
    }

    if (selfLife <= 6) {
      if (act && (act.actionId === "action.summonSoldier" || act.actionId === "action.addBulwark")) {
        adjustment += 0.1;
      }
    }

    return { adjustment };
  }

  private estimateRequestDamageR1(req: Readonly<RequestView>, oppView?: PlayerObservationView): number {
    if (req.actionId === "action.deathLance") {
      if (req.keyCards && req.keyCards.length > 0) {
        let sum = 0;
        for (const k of req.keyCards) {
          if (k.visibility === "KNOWN" && typeof k.value === "number") {
            sum += k.value;
          }
        }
        if (sum > 0) return sum;
      }
      return 10;
    }

    if (req.actionId === "action.damageJudge") {
      const oppAttackers = (oppView?.field ?? []).filter(
        (u) => u.battle?.role === "attacker"
      );
      if (oppAttackers.length > 0) {
        return oppAttackers.reduce((sum, u) => sum + (u.currentSize ?? 0), 0);
      }
      return 3;
    }

    if (req.actionId === "action.throwing") {
      return 4;
    }

    if (req.actionId === "action.kill") {
      return 5;
    }

    return 1;
  }
}

interface SingleMatchTelemetry {
  matchIndex: number;
  matchSeed: number;
  legIndex: 0 | 1;
  candidateSeat: "p1" | "p2";
  opponentSeat: "p1" | "p2";
  opponentName: string;
  winner: string | undefined;
  candidateWon: boolean;
  candidateLost: boolean;
  isDraw: boolean;
  completed: boolean;
  reason?: string;
  turnCount: number;
  totalDecisions: number;
  candidateDecisions: number;
  candidateTimeUs: number;
}

interface PairSummary {
  pairIndex: number;
  matchSeed: number;
  leg0: SingleMatchTelemetry;
  leg1: SingleMatchTelemetry;
  pairScore: number;
}

interface SeatBreakdown {
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  defeatCauses: Record<string, number>;
}

interface VariantSuiteResult {
  variantId: "R1_LEGACY" | "R4_CURRENT";
  variantName: string;
  commitSha: string;
  scoringModel: string;
  seedStart: number;
  pairsCount: number;
  totalMatches: number;
  opponentName: string;
  opponentId: string;
  opponentDigest: string;
  pairScoreMean: number;
  legWinRate: number;
  candidateWins: number;
  oppWins: number;
  draws: number;
  incompletes: number;
  seatBreakdown: {
    asP1: SeatBreakdown;
    asP2: SeatBreakdown;
  };
  avgTurns: number;
  avgDecisions: number;
  avgCpuTimeUsPerDecision: number;
  defeatCauses: Record<string, number>;
  pairs: PairSummary[];
}

interface MatchFlipDiff {
  matchSeed: number;
  legIndex: 0 | 1;
  candidateSeat: "p1" | "p2";
  r1Outcome: "WIN" | "LOSS" | "DRAW";
  r4Outcome: "WIN" | "LOSS" | "DRAW";
  r1Turns: number;
  r4Turns: number;
  r1Reason?: string;
  r4Reason?: string;
}

interface OpponentABComparison {
  opponentName: string;
  opponentId: string;
  seedRange: string;
  pairsCount: number;
  totalMatches: number;
  r1: VariantSuiteResult;
  r4: VariantSuiteResult;
  delta: {
    winDiff: number;
    winRateDiffPct: number;
    pairScoreDiffPct: number;
    p1WinDiff: number;
    p2WinDiff: number;
    flippedMatchesCount: number;
    r1LossToR4WinCount: number;
    r1WinToR4LossCount: number;
    flippedMatches: MatchFlipDiff[];
  };
}

class TimedPolicyWrapper implements DecisionPolicy {
  public totalTimeUs = 0;
  public decisionCount = 0;
  public readonly descriptor: PolicyDescriptor;

  constructor(private readonly inner: DecisionPolicy) {
    this.descriptor = inner.descriptor;
  }

  public choose(request: Readonly<DecisionRequest>): DecisionResponse {
    const start = performance.now();
    const res = this.inner.choose(request);
    const end = performance.now();
    this.totalTimeUs += (end - start) * 1000;
    this.decisionCount++;
    return res;
  }
}

function classifyDefeatReason(reason: string | undefined, completed: boolean): string {
  const r = reason ?? "";
  if (r.includes("ライフが0")) return "自軍ライフ0(戦闘/効果削り切り)";
  if (r.includes("山札") || r.includes("デッキ")) return "デッキアウト/山札切れ";
  if (!completed) return "最大手数超過/未完了";
  return "その他";
}

function createEmptyDefeatCauses(): Record<string, number> {
  return {
    "自軍ライフ0(戦闘/効果削り切り)": 0,
    "デッキアウト/山札切れ": 0,
    "最大手数超過/未完了": 0,
    "その他": 0,
  };
}

async function runVariantForOpponent(params: {
  variantId: "R1_LEGACY" | "R4_CURRENT";
  variantName: string;
  commitSha: string;
  scoringModel: string;
  createCandidatePolicy: (seat: "p1" | "p2") => DecisionPolicy;
  opp: {
    name: string;
    id: string;
    digest: string;
    createPolicy: (seat: "p1" | "p2", seed: number) => DecisionPolicy;
  };
  seedStart: number;
  pairsCount: number;
  reg: any;
  frame: any;
  rulePackage: any;
}): Promise<VariantSuiteResult> {
  const {
    variantId,
    variantName,
    commitSha,
    scoringModel,
    createCandidatePolicy,
    opp,
    seedStart,
    pairsCount,
    reg,
    frame,
    rulePackage,
  } = params;

  const pairSummaries: PairSummary[] = [];
  let totalCandidateTimeUs = 0;
  let totalCandidateDecisions = 0;
  let totalTurns = 0;
  let totalDecisions = 0;
  let candidateWins = 0;
  let oppWins = 0;
  let draws = 0;
  let incompletes = 0;
  let pairScoreSum = 0;

  const defeatCauses = createEmptyDefeatCauses();
  const p1Seat: SeatBreakdown = { matches: pairsCount, wins: 0, losses: 0, draws: 0, winRate: 0, defeatCauses: createEmptyDefeatCauses() };
  const p2Seat: SeatBreakdown = { matches: pairsCount, wins: 0, losses: 0, draws: 0, winRate: 0, defeatCauses: createEmptyDefeatCauses() };

  for (let p = 0; p < pairsCount; p++) {
    const matchSeed = seedStart + p;

    // Leg 0: P1 = Candidate, P2 = Opponent
    const candPolicy0 = new TimedPolicyWrapper(createCandidatePolicy("p1"));
    const oppPolicy0 = opp.createPolicy("p2", matchSeed);

    const setup0 = OfficialRegulationMatchSetup.setupMatch(reg, frame, rulePackage, matchSeed, {
      playerNames: { p1: variantId, p2: opp.name },
    });
    const session0 = new GameSession(setup0.state, rulePackage, { matchSeed });
    const simRes0 = SimulationRunner.run(session0, { p1: candPolicy0, p2: oppPolicy0 }, { maxDecisions: 1000 });

    const leg0Won = simRes0.winner === "p1";
    const leg0Lost = simRes0.winner === "p2";
    const leg0Draw = simRes0.completed && (simRes0.winner === "draw" || !simRes0.winner);

    const leg0: SingleMatchTelemetry = {
      matchIndex: p * 2,
      matchSeed,
      legIndex: 0,
      candidateSeat: "p1",
      opponentSeat: "p2",
      opponentName: opp.name,
      winner: simRes0.winner,
      candidateWon: leg0Won,
      candidateLost: leg0Lost,
      isDraw: leg0Draw,
      completed: simRes0.completed,
      reason: simRes0.reason,
      turnCount: simRes0.turnCount,
      totalDecisions: simRes0.totalDecisions,
      candidateDecisions: candPolicy0.decisionCount,
      candidateTimeUs: candPolicy0.totalTimeUs,
    };
    totalCandidateTimeUs += candPolicy0.totalTimeUs;
    totalCandidateDecisions += candPolicy0.decisionCount;

    if (leg0Won) {
      p1Seat.wins++;
    } else if (leg0Lost) {
      p1Seat.losses++;
      const cat = classifyDefeatReason(simRes0.reason, simRes0.completed);
      defeatCauses[cat]++;
      p1Seat.defeatCauses[cat]++;
    } else {
      p1Seat.draws++;
    }

    // Leg 1: P1 = Opponent, P2 = Candidate (座席反転)
    const oppPolicy1 = opp.createPolicy("p1", matchSeed);
    const candPolicy1 = new TimedPolicyWrapper(createCandidatePolicy("p2"));

    const setup1 = OfficialRegulationMatchSetup.setupMatch(reg, frame, rulePackage, matchSeed, {
      playerNames: { p1: opp.name, p2: variantId },
    });
    const session1 = new GameSession(setup1.state, rulePackage, { matchSeed });
    const simRes1 = SimulationRunner.run(session1, { p1: oppPolicy1, p2: candPolicy1 }, { maxDecisions: 1000 });

    const leg1Won = simRes1.winner === "p2";
    const leg1Lost = simRes1.winner === "p1";
    const leg1Draw = simRes1.completed && (simRes1.winner === "draw" || !simRes1.winner);

    const leg1: SingleMatchTelemetry = {
      matchIndex: p * 2 + 1,
      matchSeed,
      legIndex: 1,
      candidateSeat: "p2",
      opponentSeat: "p1",
      opponentName: opp.name,
      winner: simRes1.winner,
      candidateWon: leg1Won,
      candidateLost: leg1Lost,
      isDraw: leg1Draw,
      completed: simRes1.completed,
      reason: simRes1.reason,
      turnCount: simRes1.turnCount,
      totalDecisions: simRes1.totalDecisions,
      candidateDecisions: candPolicy1.decisionCount,
      candidateTimeUs: candPolicy1.totalTimeUs,
    };
    totalCandidateTimeUs += candPolicy1.totalTimeUs;
    totalCandidateDecisions += candPolicy1.decisionCount;

    if (leg1Won) {
      p2Seat.wins++;
    } else if (leg1Lost) {
      p2Seat.losses++;
      const cat = classifyDefeatReason(simRes1.reason, simRes1.completed);
      defeatCauses[cat]++;
      p2Seat.defeatCauses[cat]++;
    } else {
      p2Seat.draws++;
    }

    let s0 = 0.5;
    if (leg0Won) s0 = 1.0;
    else if (leg0Lost) s0 = 0.0;

    let s1 = 0.5;
    if (leg1Won) s1 = 1.0;
    else if (leg1Lost) s1 = 0.0;

    const pairScore = (s0 + s1) / 2;
    pairScoreSum += pairScore;

    if (leg0Won) candidateWins++;
    else if (leg0Lost) oppWins++;
    else if (leg0Draw) draws++;
    else incompletes++;

    if (leg1Won) candidateWins++;
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

  p1Seat.winRate = (p1Seat.wins / pairsCount) * 100;
  p2Seat.winRate = (p2Seat.wins / pairsCount) * 100;

  const totalMatches = pairsCount * 2;
  const pairScoreMean = pairScoreSum / pairsCount;
  const legWinRate = (candidateWins / totalMatches) * 100;
  const avgTurns = totalTurns / totalMatches;
  const avgDecisions = totalDecisions / totalMatches;
  const avgCpuTimeUsPerDecision = totalCandidateDecisions > 0 ? totalCandidateTimeUs / totalCandidateDecisions : 0;

  return {
    variantId,
    variantName,
    commitSha,
    scoringModel,
    seedStart,
    pairsCount,
    totalMatches,
    opponentName: opp.name,
    opponentId: opp.id,
    opponentDigest: opp.digest,
    pairScoreMean,
    legWinRate,
    candidateWins,
    oppWins,
    draws,
    incompletes,
    seatBreakdown: {
      asP1: p1Seat,
      asP2: p2Seat,
    },
    avgTurns,
    avgDecisions,
    avgCpuTimeUsPerDecision,
    defeatCauses,
    pairs: pairSummaries,
  };
}

function getOutcomeLabel(m: SingleMatchTelemetry): "WIN" | "LOSS" | "DRAW" {
  if (m.candidateWon) return "WIN";
  if (m.candidateLost) return "LOSS";
  return "DRAW";
}

async function main() {
  let currentHeadSha = R3_BASE_COMMIT_SHA;
  try {
    currentHeadSha = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
  } catch {
    currentHeadSha = R3_BASE_COMMIT_SHA;
  }

  const seedStart = 500001;
  const pairsCount = 30;

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

  const tacticalEvaluator = new GenericTacticalEvaluator(rulePackage);

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

  console.log("================================================================================");
  console.log(" BlackPoker Work 5-1 R4 — 同一Seed A/B 比較ベンチマーク (Seed: 500001〜500030)");
  console.log(` [Variant A] Work 5-1 R1 (Legacy Hardcoded)  SHA: ${R1_COMMIT_SHA}`);
  console.log(` [Variant B] Work 5-1 R3/R4 (Generic DSL)    SHA: ${currentHeadSha}`);
  console.log("================================================================================");

  const comparisons: OpponentABComparison[] = [];

  for (const opp of opponents) {
    const r1Res = await runVariantForOpponent({
      variantId: "R1_LEGACY",
      variantName: "Gen9TacticalPrototypePolicyR1 (Work 5-1 R1)",
      commitSha: R1_COMMIT_SHA,
      scoringModel: "linear_interaction_plus_tactical_v1_r1_legacy",
      createCandidatePolicy: (seat) => new Gen9TacticalPrototypePolicyR1(gen8DNA, `Gen9-R1-${seat}`),
      opp,
      seedStart,
      pairsCount,
      reg,
      frame,
      rulePackage,
    });

    const r4Res = await runVariantForOpponent({
      variantId: "R4_CURRENT",
      variantName: "Gen9TacticalPrototypePolicy (Work 5-1 R3/R4 Generic)",
      commitSha: currentHeadSha,
      scoringModel: "linear_interaction_plus_tactical_v2",
      createCandidatePolicy: (seat) => new Gen9TacticalPrototypePolicy(gen8DNA, `Gen9-R4-${seat}`, tacticalEvaluator),
      opp,
      seedStart,
      pairsCount,
      reg,
      frame,
      rulePackage,
    });

    const flippedMatches: MatchFlipDiff[] = [];
    let r1LossToR4WinCount = 0;
    let r1WinToR4LossCount = 0;

    for (let i = 0; i < pairsCount; i++) {
      const pR1 = r1Res.pairs[i];
      const pR4 = r4Res.pairs[i];

      for (const legIdx of [0, 1] as const) {
        const mR1 = legIdx === 0 ? pR1.leg0 : pR1.leg1;
        const mR4 = legIdx === 0 ? pR4.leg0 : pR4.leg1;
        const outR1 = getOutcomeLabel(mR1);
        const outR4 = getOutcomeLabel(mR4);

        if (outR1 !== outR4) {
          if (outR1 === "LOSS" && outR4 === "WIN") r1LossToR4WinCount++;
          if (outR1 === "WIN" && outR4 === "LOSS") r1WinToR4LossCount++;
          flippedMatches.push({
            matchSeed: pR1.matchSeed,
            legIndex: legIdx,
            candidateSeat: mR1.candidateSeat,
            r1Outcome: outR1,
            r4Outcome: outR4,
            r1Turns: mR1.turnCount,
            r4Turns: mR4.turnCount,
            r1Reason: mR1.reason,
            r4Reason: mR4.reason,
          });
        }
      }
    }

    const comp: OpponentABComparison = {
      opponentName: opp.name,
      opponentId: opp.id,
      seedRange: `${seedStart}-${seedStart + pairsCount - 1}`,
      pairsCount,
      totalMatches: pairsCount * 2,
      r1: r1Res,
      r4: r4Res,
      delta: {
        winDiff: r4Res.candidateWins - r1Res.candidateWins,
        winRateDiffPct: r4Res.legWinRate - r1Res.legWinRate,
        pairScoreDiffPct: (r4Res.pairScoreMean - r1Res.pairScoreMean) * 100,
        p1WinDiff: r4Res.seatBreakdown.asP1.wins - r1Res.seatBreakdown.asP1.wins,
        p2WinDiff: r4Res.seatBreakdown.asP2.wins - r1Res.seatBreakdown.asP2.wins,
        flippedMatchesCount: flippedMatches.length,
        r1LossToR4WinCount,
        r1WinToR4LossCount,
        flippedMatches,
      },
    };
    comparisons.push(comp);

    console.log(`\n--------------------------------------------------------------------------------`);
    console.log(` 対戦相手: ${opp.name} (${opp.id})`);
    console.log(`--------------------------------------------------------------------------------`);
    console.log(
      `  [R1 (${R1_COMMIT_SHA.slice(0, 8)})] 勝敗: ${r1Res.candidateWins}W-${r1Res.oppWins}L-${r1Res.draws}D | 勝率: ${r1Res.legWinRate.toFixed(1)}% | P1(先攻): ${r1Res.seatBreakdown.asP1.wins}W-${r1Res.seatBreakdown.asP1.losses}L (${r1Res.seatBreakdown.asP1.winRate.toFixed(1)}%) | P2(後攻): ${r1Res.seatBreakdown.asP2.wins}W-${r1Res.seatBreakdown.asP2.losses}L (${r1Res.seatBreakdown.asP2.winRate.toFixed(1)}%)`
    );
    console.log(
      `  [R4 (${currentHeadSha.slice(0, 8)})] 勝敗: ${r4Res.candidateWins}W-${r4Res.oppWins}L-${r4Res.draws}D | 勝率: ${r4Res.legWinRate.toFixed(1)}% | P1(先攻): ${r4Res.seatBreakdown.asP1.wins}W-${r4Res.seatBreakdown.asP1.losses}L (${r4Res.seatBreakdown.asP1.winRate.toFixed(1)}%) | P2(後攻): ${r4Res.seatBreakdown.asP2.wins}W-${r4Res.seatBreakdown.asP2.losses}L (${r4Res.seatBreakdown.asP2.winRate.toFixed(1)}%)`
    );
    console.log(
      `  [差分 (R4 - R1)] 勝利数: ${comp.delta.winDiff >= 0 ? "+" : ""}${comp.delta.winDiff} (${comp.delta.winRateDiffPct >= 0 ? "+" : ""}${comp.delta.winRateDiffPct.toFixed(1)}pt) | P1勝利差: ${comp.delta.p1WinDiff >= 0 ? "+" : ""}${comp.delta.p1WinDiff}, P2勝利差: ${comp.delta.p2WinDiff >= 0 ? "+" : ""}${comp.delta.p2WinDiff} | 勝敗反転試合: ${comp.delta.flippedMatchesCount}件 (R1敗→R4勝: ${r1LossToR4WinCount}, R1勝→R4敗: ${r1WinToR4LossCount})`
    );
    console.log(`  [R1 敗因内訳] ${JSON.stringify(r1Res.defeatCauses)}`);
    console.log(`  [R4 敗因内訳] ${JSON.stringify(r4Res.defeatCauses)}`);
  }

  const reportPayload = {
    benchmarkId: "BP-SIM-AI-GEN9-WORK5-1-R4-AB-COMPARISON",
    generatedAt: new Date().toISOString(),
    seedRange: `${seedStart}-${seedStart + pairsCount - 1}`,
    pairsPerOpponent: pairsCount,
    matchesPerOpponent: pairsCount * 2,
    variants: {
      r1: {
        name: "Gen9TacticalPrototypePolicyR1",
        commitSha: R1_COMMIT_SHA,
        description: "Work 5-1 R1: アクションID分岐・固定ダメージ推定・最大サイズ単純比較版",
      },
      r4: {
        name: "Gen9TacticalPrototypePolicy",
        baseCommitSha: R3_BASE_COMMIT_SHA,
        headCommitSha: currentHeadSha,
        description: "Work 5-1 R3/R4: 汎用DSL戦術評価器(GenericTacticalEvaluator)・非公開情報範囲推定・未知変数UNKNOWN安全処理・多体攻撃評価版",
      },
    },
    comparisons,
  };

  const outPath = path.resolve(".artifacts/benchmark-ab-r1-vs-r4-500001-500030.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(reportPayload, null, 2), "utf-8");
  console.log(`\n=> A/B比較ベンチマーク結果JSON保存完了: ${outPath}`);
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
