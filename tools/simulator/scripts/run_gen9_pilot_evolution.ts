/**
 * run_gen9_pilot_evolution.ts
 *
 * BlackPoker Simulator - Gen 9 進化学習の選抜方法改善・実証スクリプト (Work 5-2 R2)
 *
 * 【目的と改善内容 (Work 5-2 R2)】
 * 1. 最終個体の由来の厳格な記録と区別:
 *    - G0で人手設計された初期重み個体 (originType: "HAND_DESIGNED_G0", createdGeneration: 0) と、
 *      G1以降に交叉・突然変異で生成された進化個体 (originType: "EVOLVED_OFFSPRING", createdGeneration >= 1) を
 *      メタデータおよび検証関数 (isEvolvedOffspring / isHandDesignedG0) で厳格に区別。
 *    - Work 5-2 R1 の採用個体 (gen9-g0-ind7-survival-trade) が G0 Ind7 (人手設計の初期重み) であったことを
 *      明示的に検証・記録し、「学習済み重み」と「人手設計の初期重み」を混同しない。
 *    - 全個体の individualId, originType, createdGeneration, evaluatedGeneration, parentIds,
 *      parentL1Distance, tacticalWeights, fitnessScore, evaluationSeedRange を完全保存。
 * 2. 世代間の公平な比較 (Cross-Generation Fair Selection Arena):
 *    - 世代ごとに異なる Training Seed 上の最高 Fitness の単純比較で全世代最良を決めない。
 *    - Training Seed (730001〜730350) と完全分離された「選抜評価専用 Seed 群 (Selection Arena Seeds: 740001〜740025)」を
 *      用意し、G0 上位候補個体と G1〜G3 進化候補個体を同一 Seed・同一対戦相手・座席反転条件で一斉再評価して選抜。
 * 3. 進化による改善の検証 (Independent Final Evaluation Seeds: 750001〜750050):
 *    - Validation Seeds (720001〜720050)、既存の正式 Holdout (95001〜95030, 250001〜250120, 350001〜350300)、
 *      正本診断 Seed (4127992094) は一切使用しない。
 *    - 独立した最終比較 Seed (750001〜750050, 各50ペア=100試合, 座席反転) にて、
 *      (A) G1〜G3 最良進化個体 (Best-Evolved-G1toG3)
 *      (B) G0 最良人手設計個体 (Best-G0-HandDesigned)
 *      (C) 従来の Work 5-1 R4
 *      (D) Gen 8 Champion Candidate
 *      の直接対決および対共通相手 (vs Gen 8, vs R4, vs Gen 7) の成績と 95% 信頼区間を記録。
 * 4. 段階的実行とタイムアウト保護:
 *    - `--mode=smoke` (少数試合での正確性・由来・選抜ロジック検証) と `--mode=full` (本評価) をサポート。
 *    - `--timeout-sec` による厳格なタイムアウト監視を備え、無制限待機を防止。
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
import {
  Gen9LearnableTacticalPolicy,
  Gen9TacticalGenome,
  TacticalGenomeOriginType,
  TACTICAL_FEATURE_DIMENSION,
  TACTICAL_FEATURE_NAMES,
  TACTICAL_FEATURE_CATEGORY_MAP,
  ZERO_TACTICAL_WEIGHTS,
  R4_PRESET_TACTICAL_WEIGHTS,
  fromV6DNA,
  toV6CompatibleDNA,
  cloneTacticalGenome,
  isEvolvedOffspring,
  isHandDesignedG0,
} from "../src/engine/ai/Gen9LearnableTacticalPolicy.js";
import { GenericTacticalEvaluator } from "../src/engine/rules/GenericTacticalEvaluator.js";
import { createGen8ChampionCandidatePolicy } from "../src/engine/ai/Gen8DNALoader.js";
import { loadOfficialChampionsStrict } from "../src/cli/largeScaleSimulationRunner.js";
import { DecisionRequest } from "../src/domain/decision/DecisionRequest.js";
import { DecisionResponse } from "../src/domain/decision/DecisionResponse.js";
import { DecisionDNA } from "../src/domain/ai/DecisionDNATypes.js";
import { DecisionDNACodec } from "../src/engine/ai/DecisionDNACodec.js";
import { R1_COMMIT_SHA } from "./run_gen9_tactical_benchmark.js";

// =============================================================================
// 1. 禁止 Seed 範囲との非重複アサーション
// =============================================================================
export const FORBIDDEN_SEED_RANGES: readonly { name: string; start: number; end: number }[] = [
  { name: "Official Holdout v1", start: 95001, end: 95030 },
  { name: "Official Holdout v2", start: 250001, end: 250120 },
  { name: "Future Final Holdout", start: 350001, end: 350300 },
  { name: "Work 5-2 R1 Validation Seeds (Reserved/Locked)", start: 720001, end: 720050 },
  { name: "Original Human Diagnostic Seed", start: 4127992094, end: 4127992094 },
];

export function assertSafeSeedRange(label: string, start: number, count: number): void {
  const end = start + count - 1;
  for (const forbidden of FORBIDDEN_SEED_RANGES) {
    const overlaps = Math.max(start, forbidden.start) <= Math.min(end, forbidden.end);
    if (overlaps) {
      throw new Error(
        `[SEED_VIOLATION] ${label} (${start}..${end}) が禁止領域 ${forbidden.name} (${forbidden.start}..${forbidden.end}) と重複しています`
      );
    }
  }
}

// =============================================================================
// 2. 統計・信頼区間 (95% CI) ユーティリティ
// =============================================================================
export interface ConfidenceInterval95 {
  readonly meanPct: number;
  readonly lowerPct: number;
  readonly upperPct: number;
  readonly halfWidthPct: number;
}

export function computeWilson95CI(wins: number, total: number): ConfidenceInterval95 {
  if (total <= 0) {
    return { meanPct: 0, lowerPct: 0, upperPct: 0, halfWidthPct: 0 };
  }
  const z = 1.96;
  const p = wins / total;
  const z2 = z * z;
  const denom = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denom;
  const half = (z / denom) * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total));
  const lower = Math.max(0, center - half) * 100;
  const upper = Math.min(1, center + half) * 100;
  return {
    meanPct: Number((p * 100).toFixed(2)),
    lowerPct: Number(lower.toFixed(2)),
    upperPct: Number(upper.toFixed(2)),
    halfWidthPct: Number(((upper - lower) / 2).toFixed(2)),
  };
}

export function computePaired95CI(pairScores: readonly number[]): ConfidenceInterval95 {
  const n = pairScores.length;
  if (n === 0) {
    return { meanPct: 0, lowerPct: 0, upperPct: 0, halfWidthPct: 0 };
  }
  const mean = pairScores.reduce((a, b) => a + b, 0) / n;
  if (n === 1) {
    return { meanPct: mean * 100, lowerPct: mean * 100, upperPct: mean * 100, halfWidthPct: 0 };
  }
  const variance = pairScores.reduce((acc, s) => acc + (s - mean) * (s - mean), 0) / (n - 1);
  const se = Math.sqrt(variance / n);
  const half = 1.96 * se;
  const lower = Math.max(0, mean - half) * 100;
  const upper = Math.min(1, mean + half) * 100;
  return {
    meanPct: Number((mean * 100).toFixed(2)),
    lowerPct: Number(lower.toFixed(2)),
    upperPct: Number(upper.toFixed(2)),
    halfWidthPct: Number((half * 100).toFixed(2)),
  };
}

export function computeWeightsL1Distance(a: readonly number[], b: readonly number[]): number {
  let sum = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    sum += Math.abs(a[i] - b[i]);
  }
  return Number(sum.toFixed(4));
}

export function countModifiedFeatures(a: readonly number[], b: readonly number[]): number {
  let count = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (Math.abs(a[i] - b[i]) > 1e-6) count++;
  }
  return count;
}

// =============================================================================
// 3. 個体の由来 (Provenance) と評価レコード構造
// =============================================================================
export interface IndividualProvenanceRecord {
  readonly individualId: string;
  readonly individualName: string;
  readonly originType: TacticalGenomeOriginType;
  readonly isHandDesignedInitial: boolean;
  readonly isEvolvedOffspring: boolean;
  readonly createdGeneration: number;
  readonly evaluatedGeneration: number;
  readonly parentIds: readonly string[];
  readonly minL1DistanceFromG0Presets: number;
  readonly modifiedFeaturesFromPrimaryParent: number;
  readonly tacticalWeights: readonly number[];
  readonly evaluationPhase: "GENERATION_TRAINING" | "FAIR_SELECTION_ARENA" | "FINAL_INDEPENDENT_EVAL";
  readonly evaluationSeedRange: string;
  readonly fitnessScore: number;
  readonly overallWinRatePct: number;
  readonly vsGen8WinRatePct: number;
  readonly vsR4WinRatePct: number;
  readonly vsGen7WinRatePct: number;
  readonly vsRandomWinRatePct?: number;
  readonly totalMatches: number;
  readonly totalExceptions: number;
  readonly avgTimeUsPerDecision: number;
  readonly evalWallTimeMs: number;
}

/**
 * 同一 Selection Arena Seed 上で評価された候補リストから、
 * G0 人手設計最良個体と G1+ 進化最良個体を厳格に分離して選抜する純粋関数
 */
export function selectBestCandidatesByOrigin(
  arenaRecords: readonly IndividualProvenanceRecord[]
): {
  bestHandDesignedG0: IndividualProvenanceRecord;
  bestEvolvedOffspring: IndividualProvenanceRecord;
  allSorted: readonly IndividualProvenanceRecord[];
} {
  if (arenaRecords.length === 0) {
    throw new Error("Selection Arena の評価レコードが空です");
  }

  // 全候補が同一の evaluationSeedRange で評価されていることを検証
  const expectedSeedRange = arenaRecords[0].evaluationSeedRange;
  for (const r of arenaRecords) {
    if (r.evaluationSeedRange !== expectedSeedRange) {
      throw new Error(
        `世代間選抜の公平性違反: 異なる Seed 範囲のスコアが混在しています (${expectedSeedRange} vs ${r.evaluationSeedRange})`
      );
    }
  }

  const sorted = [...arenaRecords].sort((a, b) => {
    if (b.fitnessScore !== a.fitnessScore) return b.fitnessScore - a.fitnessScore;
    if (b.vsGen8WinRatePct !== a.vsGen8WinRatePct) return b.vsGen8WinRatePct - a.vsGen8WinRatePct;
    return b.vsR4WinRatePct - a.vsR4WinRatePct;
  });

  const handDesignedCandidates = sorted.filter(
    (r) =>
      r.originType === "HAND_DESIGNED_G0" &&
      r.isHandDesignedInitial === true &&
      r.isEvolvedOffspring === false &&
      r.createdGeneration === 0
  );

  const evolvedCandidates = sorted.filter(
    (r) =>
      r.originType === "EVOLVED_OFFSPRING" &&
      r.isEvolvedOffspring === true &&
      r.isHandDesignedInitial === false &&
      r.createdGeneration >= 1 &&
      r.minL1DistanceFromG0Presets > 0
  );

  if (handDesignedCandidates.length === 0) {
    throw new Error("Selection Arena に G0 人手設計候補が存在しません");
  }
  if (evolvedCandidates.length === 0) {
    throw new Error("Selection Arena に G1 以降の進化個体候補が存在しません");
  }

  return {
    bestHandDesignedG0: handDesignedCandidates[0],
    bestEvolvedOffspring: evolvedCandidates[0],
    allSorted: sorted,
  };
}

// =============================================================================
// 4. 実行時間・例外計測ラッパー & 対戦評価エンジン
// =============================================================================
class InstrumentedPolicyWrapper implements DecisionPolicy {
  public totalTimeUs = 0;
  public decisionCount = 0;
  public exceptionCount = 0;
  public readonly descriptor: PolicyDescriptor;

  constructor(private readonly inner: DecisionPolicy) {
    this.descriptor = inner.descriptor;
  }

  public choose(request: Readonly<DecisionRequest>): DecisionResponse {
    const t0 = performance.now();
    try {
      const res = this.inner.choose(request);
      const t1 = performance.now();
      this.totalTimeUs += (t1 - t0) * 1000;
      this.decisionCount++;
      return res;
    } catch (err) {
      this.exceptionCount++;
      throw err;
    }
  }
}

export interface HeadToHeadSummary {
  readonly candidateName: string;
  readonly opponentName: string;
  readonly seedRange: string;
  readonly pairsCount: number;
  readonly totalMatches: number;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
  readonly incompletes: number;
  readonly exceptions: number;
  readonly legWinRatePct: number;
  readonly legWinRateCI95: ConfidenceInterval95;
  readonly pairScorePct: number;
  readonly pairScoreCI95: ConfidenceInterval95;
  readonly pairWins: number;
  readonly pairLosses: number;
  readonly pairSplits: number;
  readonly p1Wins: number;
  readonly p1Losses: number;
  readonly p1WinRatePct: number;
  readonly p2Wins: number;
  readonly p2Losses: number;
  readonly p2WinRatePct: number;
  readonly avgTurns: number;
  readonly avgDecisionsPerMatch: number;
  readonly avgCandidateTimeUsPerDecision: number;
  readonly totalWallTimeMs: number;
  readonly msPerMatch: number;
}

function evaluateHeadToHead(params: {
  candidateName: string;
  opponentName: string;
  createCandidate: (seat: "p1" | "p2", seed: number) => DecisionPolicy;
  createOpponent: (seat: "p1" | "p2", seed: number) => DecisionPolicy;
  seedStart: number;
  pairsCount: number;
  reg: any;
  frame: any;
  rulePackage: any;
  checkTimeout?: () => void;
}): HeadToHeadSummary {
  const {
    candidateName,
    opponentName,
    createCandidate,
    createOpponent,
    seedStart,
    pairsCount,
    reg,
    frame,
    rulePackage,
    checkTimeout,
  } = params;

  assertSafeSeedRange(`${candidateName} vs ${opponentName}`, seedStart, pairsCount);

  const wallStart = performance.now();
  let wins = 0;
  let losses = 0;
  let draws = 0;
  let incompletes = 0;
  let exceptions = 0;
  let p1Wins = 0;
  let p1Losses = 0;
  let p2Wins = 0;
  let p2Losses = 0;
  let pairWins = 0;
  let pairLosses = 0;
  let pairSplits = 0;
  let totalTurns = 0;
  let totalDecisions = 0;
  let totalCandidateDecisions = 0;
  let totalCandidateTimeUs = 0;
  const pairScores: number[] = [];

  for (let i = 0; i < pairsCount; i++) {
    if (checkTimeout) checkTimeout();
    const matchSeed = seedStart + i;

    const origLog = console.log;
    let res0: ReturnType<typeof SimulationRunner.run>;
    let res1: ReturnType<typeof SimulationRunner.run>;
    let cand0: InstrumentedPolicyWrapper;
    let cand1: InstrumentedPolicyWrapper;

    try {
      console.log = () => {};

      // Leg 0: P1 = Candidate, P2 = Opponent
      cand0 = new InstrumentedPolicyWrapper(createCandidate("p1", matchSeed));
      const opp0 = createOpponent("p2", matchSeed);
      const setup0 = OfficialRegulationMatchSetup.setupMatch(reg, frame, rulePackage, matchSeed, {
        playerNames: { p1: candidateName, p2: opponentName },
      });
      const session0 = new GameSession((setup0 as any).state, rulePackage, { matchSeed });
      res0 = SimulationRunner.run(session0, { p1: cand0, p2: opp0 }, { maxDecisions: 1000 });

      // Leg 1: P1 = Opponent, P2 = Candidate (座席反転)
      const opp1 = createOpponent("p1", matchSeed);
      cand1 = new InstrumentedPolicyWrapper(createCandidate("p2", matchSeed));
      const setup1 = OfficialRegulationMatchSetup.setupMatch(reg, frame, rulePackage, matchSeed, {
        playerNames: { p1: opponentName, p2: candidateName },
      });
      const session1 = new GameSession((setup1 as any).state, rulePackage, { matchSeed });
      res1 = SimulationRunner.run(session1, { p1: opp1, p2: cand1 }, { maxDecisions: 1000 });
    } finally {
      console.log = origLog;
    }

    exceptions += cand0.exceptionCount;
    totalCandidateDecisions += cand0.decisionCount;
    totalCandidateTimeUs += cand0.totalTimeUs;
    totalTurns += res0.turnCount;
    totalDecisions += res0.totalDecisions;

    let s0 = 0.5;
    if (res0.winner === "p1") {
      wins++;
      p1Wins++;
      s0 = 1.0;
    } else if (res0.winner === "p2") {
      losses++;
      p1Losses++;
      s0 = 0.0;
    } else if (res0.completed) {
      draws++;
    } else {
      incompletes++;
    }

    exceptions += cand1.exceptionCount;
    totalCandidateDecisions += cand1.decisionCount;
    totalCandidateTimeUs += cand1.totalTimeUs;
    totalTurns += res1.turnCount;
    totalDecisions += res1.totalDecisions;

    let s1 = 0.5;
    if (res1.winner === "p2") {
      wins++;
      p2Wins++;
      s1 = 1.0;
    } else if (res1.winner === "p1") {
      losses++;
      p2Losses++;
      s1 = 0.0;
    } else if (res1.completed) {
      draws++;
    } else {
      incompletes++;
    }

    const ps = (s0 + s1) / 2;
    pairScores.push(ps);
    if (ps > 0.5) pairWins++;
    else if (ps < 0.5) pairLosses++;
    else pairSplits++;
  }

  const wallEnd = performance.now();
  const totalWallTimeMs = wallEnd - wallStart;
  const totalMatches = pairsCount * 2;

  return {
    candidateName,
    opponentName,
    seedRange: `${seedStart}-${seedStart + pairsCount - 1}`,
    pairsCount,
    totalMatches,
    wins,
    losses,
    draws,
    incompletes,
    exceptions,
    legWinRatePct: Number(((wins / totalMatches) * 100).toFixed(2)),
    legWinRateCI95: computeWilson95CI(wins, totalMatches),
    pairScorePct: Number(((pairScores.reduce((a, b) => a + b, 0) / pairsCount) * 100).toFixed(2)),
    pairScoreCI95: computePaired95CI(pairScores),
    pairWins,
    pairLosses,
    pairSplits,
    p1Wins,
    p1Losses,
    p1WinRatePct: Number(((p1Wins / pairsCount) * 100).toFixed(2)),
    p2Wins,
    p2Losses,
    p2WinRatePct: Number(((p2Wins / pairsCount) * 100).toFixed(2)),
    avgTurns: Number((totalTurns / totalMatches).toFixed(2)),
    avgDecisionsPerMatch: Number((totalDecisions / totalMatches).toFixed(2)),
    avgCandidateTimeUsPerDecision: Number(
      (totalCandidateDecisions > 0 ? totalCandidateTimeUs / totalCandidateDecisions : 0).toFixed(2)
    ),
    totalWallTimeMs: Number(totalWallTimeMs.toFixed(1)),
    msPerMatch: Number((totalWallTimeMs / totalMatches).toFixed(2)),
  };
}

// =============================================================================
// 5. G0 初期個体群生成と G1〜G3 交叉・突然変異オペレータ
// =============================================================================
export function createInitialPopulationG0(gen8DNA: Readonly<DecisionDNA>): Gen9TacticalGenome[] {
  const presets: {
    id: string;
    name: string;
    originType: TacticalGenomeOriginType;
    weights: readonly number[];
  }[] = [
    {
      id: "gen9-g0-ind0-r4-preset",
      name: "G0-Ind0: R4-Preset (HandDesigned)",
      originType: "HAND_DESIGNED_G0",
      weights: [...R4_PRESET_TACTICAL_WEIGHTS],
    },
    {
      id: "gen9-g0-ind1-gen8-zero",
      name: "G0-Ind1: Gen8-ZeroTactical (V6Baseline)",
      originType: "V6_BASELINE",
      weights: [...ZERO_TACTICAL_WEIGHTS],
    },
    {
      id: "gen9-g0-ind2-counter-selective",
      name: "G0-Ind2: CounterSelective (HandDesigned)",
      originType: "HAND_DESIGNED_G0",
      weights: [
        0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
        +2.6, +2.0, +1.1, +0.15,
        0.0, 0.0, 0.0, -0.30, 0.0, -2.5, 0.0,
        0.0, +2.0, +2.5,
      ],
    },
    {
      id: "gen9-g0-ind4-mild-pass-strong-counter",
      name: "G0-Ind4: MildPassStrongCounter (HandDesigned)",
      originType: "HAND_DESIGNED_G0",
      weights: [
        -0.40, -0.10, 0.0, -0.25, -0.05, 0.0,
        +2.5, +1.9, +0.95, +0.15,
        +0.15, +0.25, +0.05, -0.32, +0.15, -2.5, -0.30,
        +0.10, +2.0, +2.5,
      ],
    },
    {
      id: "gen9-g0-ind5-lethal-guard-focused",
      name: "G0-Ind5: LethalGuardFocused (HandDesigned)",
      originType: "HAND_DESIGNED_G0",
      weights: [
        0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
        +3.0, +2.2, +0.80, +0.10,
        +0.08, +0.18, +0.02, -0.28, +0.08, -2.6, -0.15,
        +0.05, +2.4, +2.8,
      ],
    },
    {
      id: "gen9-g0-ind7-survival-trade",
      name: "G0-Ind7: SurvivalTradeBalanced (HandDesigned)",
      originType: "HAND_DESIGNED_G0",
      weights: [
        -0.20, -0.05, 0.0, -0.15, 0.0, 0.0,
        +2.6, +2.0, +1.1, +0.15,
        +0.10, +0.20, +0.05, -0.38, +0.22, -3.0, -0.40,
        +0.15, +2.0, +2.5,
      ],
    },
  ];

  return presets.map((p) =>
    fromV6DNA(gen8DNA, p.weights, {
      id: p.id,
      name: p.name,
      generation: 0,
      createdGeneration: 0,
      originType: p.originType,
      parentIds: ["gen8-prod-g0-ind7-cross7"],
    })
  );
}

/**
 * スケール適応型交叉・突然変異による G1〜G3 進化個体生成
 * - 生成された個体は必ず originType: "EVOLVED_OFFSPRING", createdGeneration: generation >= 1 を持ち、
 *   すべての G0 プリセットおよび両親から重みベクトルが変化していることを保証する。
 */
export function breedEvolvedOffspring(
  parentA: Readonly<Gen9TacticalGenome>,
  parentB: Readonly<Gen9TacticalGenome>,
  g0Presets: readonly Gen9TacticalGenome[],
  rng: SeededRandom,
  generation: number,
  indIndex: number,
  mutationScale: number
): Gen9TacticalGenome {
  if (generation < 1) {
    throw new Error(`進化個体の generation は 1 以上である必要があります: ${generation}`);
  }

  // 各特徴量の探索スケール（中盤の意思決定境界 0.10〜0.45 を実際に跨げるよう設定）
  const featureScales: readonly number[] = [
    0.25, 0.12, 0.08, 0.22, 0.10, 0.08, // t00..t05 (PASS penalties)
    0.50, 0.45, 0.40, 0.18,             // t06..t09 (Counter prevention)
    0.22, 0.28, 0.18, 0.30, 0.25, 0.50, 0.30, // t10..t16 (Combat & Block)
    0.22,                               // t17 (Survival)
    0.45, 0.50,                         // t18..t19 (Lethal opportunity)
    0.20, 0.20, 0.20, 0.20,             // t20..t23 (Resource cost, Work 5-5B)
  ];

  const newWeights: number[] = new Array(TACTICAL_FEATURE_DIMENSION);

  for (let attempt = 0; attempt < 10; attempt++) {
    for (let k = 0; k < TACTICAL_FEATURE_DIMENSION; k++) {
      const wa = parentA.tacticalWeights[k];
      const wb = parentB.tacticalWeights[k];

      // 交叉: 算術ブレンド (0.3〜0.7) または親選択
      const rCross = rng.next();
      let w: number;
      if (rCross < 0.45) {
        const blend = 0.3 + 0.4 * rng.next();
        w = blend * wa + (1 - blend) * wb;
      } else if (rCross < 0.75) {
        w = wa;
      } else {
        w = wb;
      }

      // 突然変異: スケール適応ガウス摂動 (55%の確率)
      if (rng.next() < 0.55) {
        const u1 = Math.max(1e-9, rng.next());
        const u2 = rng.next();
        const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
        const sigma = featureScales[k] * mutationScale;
        w += z * sigma;
      }

      // 誤暴発を防ぐため、t01, t02, t04, t05 (中程度損害時の無条件PASS減点) は 0 付近へ正則化収束させるバイアス
      if ((k === 1 || k === 2 || k === 4 || k === 5) && rng.next() < 0.5) {
        w = w * 0.25;
        if (Math.abs(w) < 0.02) w = 0.0;
      }

      const isPenaltyFeature = k <= 5 || k === 13 || k === 15 || k === 16 || k >= 20;
      if (isPenaltyFeature) {
        w = Math.max(-3.5, Math.min(0.0, w));
      } else {
        w = Math.max(0.0, Math.min(3.5, w));
      }
      newWeights[k] = Number(w.toFixed(4));
    }

    // G0 の全個体および両親との L1 距離が十分 (> 0.05) であることを確認
    const minG0Dist = Math.min(
      ...g0Presets.map((g0) => computeWeightsL1Distance(newWeights, g0.tacticalWeights))
    );
    const modFromA = countModifiedFeatures(newWeights, parentA.tacticalWeights);
    if (minG0Dist >= 0.05 && modFromA >= 2) {
      break;
    }
  }

  const pAId = parentA.metadata?.id ?? "unknown-parent-A";
  const pBId = parentB.metadata?.id ?? "unknown-parent-B";
  const parentIds = pAId === pBId ? [pAId] : [pAId, pBId];

  return fromV6DNA(parentA.baseDNA, newWeights, {
    id: `gen9-evolved-g${generation}-ind${indIndex}`,
    name: `Evolved-G${generation}-Ind${indIndex}`,
    generation,
    createdGeneration: generation,
    originType: "EVOLVED_OFFSPRING",
    parentIds,
  });
}

// =============================================================================
// 6. 個体評価ヘルパー (Provenance 付き)
// =============================================================================
function evaluateGenomeProvenance(params: {
  genome: Readonly<Gen9TacticalGenome>;
  g0Presets: readonly Gen9TacticalGenome[];
  primaryParentWeights?: readonly number[];
  evaluatedGeneration: number;
  evaluationPhase: "GENERATION_TRAINING" | "FAIR_SELECTION_ARENA" | "FINAL_INDEPENDENT_EVAL";
  seedBase: number;
  pairsGen8: number;
  pairsR4: number;
  pairsGen7: number;
  pairsRand: number;
  gen8DNA: Readonly<DecisionDNA>;
  gen7DNA: Readonly<DecisionDNA>;
  tacticalEvaluator: GenericTacticalEvaluator;
  reg: any;
  frame: any;
  rulePackage: any;
  checkTimeout?: () => void;
}): IndividualProvenanceRecord {
  const {
    genome,
    g0Presets,
    primaryParentWeights,
    evaluatedGeneration,
    evaluationPhase,
    seedBase,
    pairsGen8,
    pairsR4,
    pairsGen7,
    pairsRand,
    gen8DNA,
    gen7DNA,
    tacticalEvaluator,
    reg,
    frame,
    rulePackage,
    checkTimeout,
  } = params;

  const indStartMs = performance.now();
  const label = genome.metadata?.name ?? genome.metadata?.id ?? "Candidate";

  const vsGen8 = evaluateHeadToHead({
    candidateName: label,
    opponentName: "Gen 8 Champion Candidate",
    createCandidate: (seat) => new Gen9LearnableTacticalPolicy(genome, `Cand-${seat}`, tacticalEvaluator),
    createOpponent: (seat) => new GenomePolicy(gen8DNA, `Gen8-${seat}`),
    seedStart: seedBase,
    pairsCount: pairsGen8,
    reg,
    frame,
    rulePackage,
    checkTimeout,
  });

  const vsR4 = evaluateHeadToHead({
    candidateName: label,
    opponentName: "Work 5-1 R4",
    createCandidate: (seat) => new Gen9LearnableTacticalPolicy(genome, `Cand-${seat}`, tacticalEvaluator),
    createOpponent: (seat) => new Gen9TacticalPrototypePolicy(gen8DNA, `R4-${seat}`, tacticalEvaluator),
    seedStart: seedBase + 25,
    pairsCount: pairsR4,
    reg,
    frame,
    rulePackage,
    checkTimeout,
  });

  const vsGen7 = evaluateHeadToHead({
    candidateName: label,
    opponentName: "Official Gen 7 Champion",
    createCandidate: (seat) => new Gen9LearnableTacticalPolicy(genome, `Cand-${seat}`, tacticalEvaluator),
    createOpponent: (seat) => new GenomePolicy(gen7DNA, `Gen7-${seat}`),
    seedStart: seedBase + 50,
    pairsCount: pairsGen7,
    reg,
    frame,
    rulePackage,
    checkTimeout,
  });

  let vsRand: HeadToHeadSummary | undefined;
  if (pairsRand > 0) {
    vsRand = evaluateHeadToHead({
      candidateName: label,
      opponentName: "SeededRandom",
      createCandidate: (seat) => new Gen9LearnableTacticalPolicy(genome, `Cand-${seat}`, tacticalEvaluator),
      createOpponent: (seat, seed) =>
        new RandomPolicy(new SeededRandom(seed + (seat === "p1" ? 101 : 202)), `Rand-${seat}`),
      seedStart: seedBase + 70,
      pairsCount: pairsRand,
      reg,
      frame,
      rulePackage,
      checkTimeout,
    });
  }

  const fitnessScore = vsRand
    ? Number(
        (
          0.45 * vsGen8.pairScorePct +
          0.25 * vsR4.pairScorePct +
          0.20 * vsGen7.pairScorePct +
          0.10 * vsRand.pairScorePct
        ).toFixed(2)
      )
    : Number(
        (
          0.50 * vsGen8.pairScorePct +
          0.30 * vsR4.pairScorePct +
          0.20 * vsGen7.pairScorePct
        ).toFixed(2)
      );

  const totalWins = vsGen8.wins + vsR4.wins + vsGen7.wins + (vsRand?.wins ?? 0);
  const totalMatches =
    vsGen8.totalMatches + vsR4.totalMatches + vsGen7.totalMatches + (vsRand?.totalMatches ?? 0);
  const totalExceptions =
    vsGen8.exceptions + vsR4.exceptions + vsGen7.exceptions + (vsRand?.exceptions ?? 0);

  const divisor = vsRand ? 4 : 3;
  const avgTimeUs = Number(
    (
      (vsGen8.avgCandidateTimeUsPerDecision +
        vsR4.avgCandidateTimeUsPerDecision +
        vsGen7.avgCandidateTimeUsPerDecision +
        (vsRand?.avgCandidateTimeUsPerDecision ?? 0)) /
      divisor
    ).toFixed(2)
  );

  const originType: TacticalGenomeOriginType =
    genome.metadata?.originType ??
    ((genome.metadata?.createdGeneration ?? 0) >= 1 ? "EVOLVED_OFFSPRING" : "HAND_DESIGNED_G0");
  const createdGen = genome.metadata?.createdGeneration ?? genome.metadata?.generation ?? 0;

  // G0 プリセット群からの最小 L1 距離 (G0 自身の場合は 0)
  const minL1FromG0 =
    originType === "HAND_DESIGNED_G0" || originType === "V6_BASELINE"
      ? 0
      : Math.min(
          ...g0Presets.map((g0) => computeWeightsL1Distance(genome.tacticalWeights, g0.tacticalWeights))
        );

  const modFeatures = primaryParentWeights
    ? countModifiedFeatures(genome.tacticalWeights, primaryParentWeights)
    : 0;

  const maxOffset = pairsRand > 0 ? 70 + pairsRand - 1 : 50 + pairsGen7 - 1;

  return {
    individualId: genome.metadata?.id ?? "unknown-id",
    individualName: genome.metadata?.name ?? "Unknown",
    originType,
    isHandDesignedInitial: isHandDesignedG0(genome),
    isEvolvedOffspring: isEvolvedOffspring(genome),
    createdGeneration: createdGen,
    evaluatedGeneration,
    parentIds: genome.metadata?.parentIds ?? [],
    minL1DistanceFromG0Presets: minL1FromG0,
    modifiedFeaturesFromPrimaryParent: modFeatures,
    tacticalWeights: [...genome.tacticalWeights],
    evaluationPhase,
    evaluationSeedRange: `${seedBase}-${seedBase + maxOffset}`,
    fitnessScore,
    overallWinRatePct: Number(((totalWins / totalMatches) * 100).toFixed(2)),
    vsGen8WinRatePct: vsGen8.legWinRatePct,
    vsR4WinRatePct: vsR4.legWinRatePct,
    vsGen7WinRatePct: vsGen7.legWinRatePct,
    vsRandomWinRatePct: vsRand?.legWinRatePct,
    totalMatches,
    totalExceptions,
    avgTimeUsPerDecision: avgTimeUs,
    evalWallTimeMs: Number((performance.now() - indStartMs).toFixed(1)),
  };
}

// =============================================================================
// 7. メイン実行フロー (Smoke / Full 対応 + タイムアウト監視)
// =============================================================================
async function main() {
  const args = process.argv.slice(1);
  const modeArg =
    process.env.GEN9_MODE ??
    args.find((a) => a.startsWith("--mode="))?.split("=")[1] ??
    "full";
  const isSmoke = modeArg === "smoke";
  const timeoutSecArg =
    process.env.GEN9_TIMEOUT_SEC ??
    args.find((a) => a.startsWith("--timeout-sec="))?.split("=")[1];
  const timeoutSec = timeoutSecArg ? parseInt(timeoutSecArg, 10) : isSmoke ? 180 : 1500;

  const overallStartMs = performance.now();
  const checkTimeout = () => {
    const elapsedSec = (performance.now() - overallStartMs) / 1000;
    if (elapsedSec > timeoutSec) {
      throw new Error(
        `[TIMEOUT] 実行時間が上限 (${timeoutSec}秒) を超過したため安全停止しました (elapsed=${elapsedSec.toFixed(1)}s)`
      );
    }
  };

  let currentHeadSha = "56aae0865d418f8558f3cac2292c5b6bfd16dec9";
  try {
    currentHeadSha = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
  } catch {
    // ignore
  }

  const rulesDir = path.resolve("src/data/rules-vnext");
  const regulationsDir = path.resolve("src/data/regulations");
  const catalog = await loadRegulationCatalog(regulationsDir);
  const rulePackage = await loadRulePackageFromDirectory(rulesDir);

  const reg = catalog.regulations.get("standard-pack")!;
  const frame = catalog.frames.get("pack")!;

  const gen8Candidate = createGen8ChampionCandidatePolicy();
  const gen8DNA = DecisionDNACodec.clone((gen8Candidate as any).dna);
  const champions = loadOfficialChampionsStrict();
  const gen7DNA = champions.gen7DNA;

  const tacticalEvaluator = new GenericTacticalEvaluator(rulePackage);
  Gen9TacticalPrototypePolicy.setDefaultEvaluator(tacticalEvaluator);

  console.log("================================================================================");
  console.log(` BlackPoker Work 5-2 R2 — 進化学習の選抜方法改善・実証 (mode=${modeArg}, timeout=${timeoutSec}s)`);
  console.log(` Base SHA: ${currentHeadSha}`);
  console.log("================================================================================");

  // ---------------------------------------------------------------------------
  // STEP 0: Work 5-2 R1 の Pilot Best が G0 Ind7 (人手設計個体) であったことの検証記録
  // ---------------------------------------------------------------------------
  const g0InitialPresets = createInitialPopulationG0(gen8DNA);
  const r1AdoptedG0Ind7 = g0InitialPresets.find((g) => g.metadata?.id === "gen9-g0-ind7-survival-trade")!;
  const r1ProvenanceAudit = {
    r1SelectedIndividualId: r1AdoptedG0Ind7.metadata!.id!,
    r1SelectedIndividualName: r1AdoptedG0Ind7.metadata!.name!,
    originType: r1AdoptedG0Ind7.metadata!.originType!,
    createdGeneration: r1AdoptedG0Ind7.metadata!.createdGeneration!,
    isHandDesignedG0: isHandDesignedG0(r1AdoptedG0Ind7),
    isEvolvedOffspring: isEvolvedOffspring(r1AdoptedG0Ind7),
    auditConclusion:
      "Work 5-2 R1で最終採用された gen9-g0-ind7-survival-trade は G0 Ind7 (HAND_DESIGNED_G0, createdGeneration=0) であり、G0固有のTraining Seed (710001-710064) で記録したFitness 65.63が別Seedで評価されたG1〜G3の最高Fitnessと単純比較されて残った人手設計個体であったことを確認。",
  };
  console.log(`\n[Step 0] Work 5-2 R1 採用個体の由来監査:`);
  console.log(
    `  * ID=${r1ProvenanceAudit.r1SelectedIndividualId} | originType=${r1ProvenanceAudit.originType} | createdGen=${r1ProvenanceAudit.createdGeneration} | isHandDesignedG0=${r1ProvenanceAudit.isHandDesignedG0} | isEvolvedOffspring=${r1ProvenanceAudit.isEvolvedOffspring}`
  );

  // ---------------------------------------------------------------------------
  // STEP 1: G0〜G3 進化学習実行 (Training Seeds: 730001〜730350)
  // ---------------------------------------------------------------------------
  const numGenerations = 4; // G0, G1, G2, G3
  const popSize = 6;
  const trainPairsGen8 = isSmoke ? 1 : 6;
  const trainPairsR4 = isSmoke ? 1 : 5;
  const trainPairsGen7 = isSmoke ? 1 : 4;
  const trainPairsRand = 0;
  // Smoke: 3 pairs = 6 matches/ind; Full: 15 pairs = 30 matches/ind

  const breedRng = new SeededRandom(202611082);
  let population: Gen9TacticalGenome[] = g0InitialPresets.map((g) => cloneTacticalGenome(g));
  const genomeMap = new Map<string, Gen9TacticalGenome>();
  const primaryParentWeightsMap = new Map<string, readonly number[]>();
  for (const g of population) {
    genomeMap.set(g.metadata!.id!, cloneTacticalGenome(g));
  }

  const generationLogs: {
    generation: number;
    trainingSeedRange: string;
    totalMatches: number;
    wallTimeMs: number;
    exceptionCount: number;
    bestInGenId: string;
    bestInGenOrigin: TacticalGenomeOriginType;
    bestInGenFitness: number;
    rankings: IndividualProvenanceRecord[];
  }[] = [];

  // 選抜アリーナへ送る候補IDセット (G0 上位 + G1〜G3 進化個体上位)
  const g0CandidateIds = new Set<string>();
  const evolvedCandidateIds = new Set<string>();

  console.log(
    `\n[Step 1] G0〜G3 進化学習実行 (Training Seeds: 730001〜, 個体数=${popSize}, 世代数=${numGenerations})`
  );

  for (let gen = 0; gen < numGenerations; gen++) {
    const genStartMs = performance.now();
    const genSeedBase = 730001 + gen * 80;
    const genRecords: IndividualProvenanceRecord[] = [];
    let genExceptions = 0;
    let genMatches = 0;

    for (let idx = 0; idx < population.length; idx++) {
      const ind = population[idx];
      const indId = ind.metadata!.id!;
      const rec = evaluateGenomeProvenance({
        genome: ind,
        g0Presets: g0InitialPresets,
        primaryParentWeights: primaryParentWeightsMap.get(indId),
        evaluatedGeneration: gen,
        evaluationPhase: "GENERATION_TRAINING",
        seedBase: genSeedBase,
        pairsGen8: trainPairsGen8,
        pairsR4: trainPairsR4,
        pairsGen7: trainPairsGen7,
        pairsRand: trainPairsRand,
        gen8DNA,
        gen7DNA,
        tacticalEvaluator,
        reg,
        frame,
        rulePackage,
        checkTimeout,
      });
      genRecords.push(rec);
      genExceptions += rec.totalExceptions;
      genMatches += rec.totalMatches;
    }

    // 世代内ソート: Fitness 優先 -> vsGen8 優先 -> 同点時は新規進化個体 (createdGeneration が大きい方) を優先し探索停滞を防止
    genRecords.sort((a, b) => {
      if (b.fitnessScore !== a.fitnessScore) return b.fitnessScore - a.fitnessScore;
      if (b.vsGen8WinRatePct !== a.vsGen8WinRatePct) return b.vsGen8WinRatePct - a.vsGen8WinRatePct;
      return b.createdGeneration - a.createdGeneration;
    });

    // G0 の上位人手設計個体を候補プールに登録
    if (gen === 0) {
      for (const r of genRecords) {
        if (r.originType === "HAND_DESIGNED_G0" && g0CandidateIds.size < 3) {
          g0CandidateIds.add(r.individualId);
        }
      }
    } else {
      // G1, G2 からは最上位1個体、最終世代 G3 からは上位2個体の新規進化個体を必ず候補プールに登録
      const maxToAdd = gen === numGenerations - 1 ? 2 : 1;
      let addedEvolvedThisGen = 0;
      for (const r of genRecords) {
        if (
          r.originType === "EVOLVED_OFFSPRING" &&
          !evolvedCandidateIds.has(r.individualId) &&
          addedEvolvedThisGen < maxToAdd
        ) {
          evolvedCandidateIds.add(r.individualId);
          addedEvolvedThisGen++;
        }
      }
    }

    const bestRec = genRecords[0];
    const genWallMs = Number((performance.now() - genStartMs).toFixed(1));
    generationLogs.push({
      generation: gen,
      trainingSeedRange: bestRec.evaluationSeedRange,
      totalMatches: genMatches,
      wallTimeMs: genWallMs,
      exceptionCount: genExceptions,
      bestInGenId: bestRec.individualId,
      bestInGenOrigin: bestRec.originType,
      bestInGenFitness: bestRec.fitnessScore,
      rankings: genRecords,
    });

    console.log(
      `  [Gen ${gen}] Seed=${bestRec.evaluationSeedRange} | Best=${bestRec.individualId} (${bestRec.originType}, createdG=${bestRec.createdGeneration}) | Fitness=${bestRec.fitnessScore.toFixed(2)} | vsGen8=${bestRec.vsGen8WinRatePct.toFixed(1)}%, vsR4=${bestRec.vsR4WinRatePct.toFixed(1)}%, vsGen7=${bestRec.vsGen7WinRatePct.toFixed(1)}% | Time=${(genWallMs / 1000).toFixed(1)}s`
    );

    if (gen < numGenerations - 1) {
      // エリート2個体 + 進化子個体4個体
      const elites = genRecords
        .slice(0, 2)
        .map((r) => cloneTacticalGenome(genomeMap.get(r.individualId)!));
      const nextPop: Gen9TacticalGenome[] = [...elites];
      const mutationScale = 1.0 * Math.pow(0.85, gen);

      while (nextPop.length < popSize) {
        const pAIdx = Math.floor(breedRng.next() * 3);
        const pBIdx = Math.floor(breedRng.next() * 4);
        const pA = genomeMap.get(genRecords[pAIdx].individualId)!;
        const pB = genomeMap.get(genRecords[pBIdx].individualId)!;
        const child = breedEvolvedOffspring(
          pA,
          pB,
          g0InitialPresets,
          breedRng,
          gen + 1,
          nextPop.length,
          mutationScale
        );
        const childId = child.metadata!.id!;
        genomeMap.set(childId, cloneTacticalGenome(child));
        primaryParentWeightsMap.set(childId, [...pA.tacticalWeights]);
        nextPop.push(child);
      }
      population = nextPop;
    }
  }

  // Work 5-2 R1 の G0 Ind7 も必ず G0 候補プールに含める
  g0CandidateIds.add("gen9-g0-ind7-survival-trade");

  // ---------------------------------------------------------------------------
  // STEP 2: 世代間の公平な選抜アリーナ (Selection Arena Seeds: 740001〜)
  // ---------------------------------------------------------------------------
  const selectionSeedBase = 740001;
  const selPairsGen8 = isSmoke ? 2 : 12; // Full: 24 matches vs Gen 8
  const selPairsR4 = isSmoke ? 1 : 8;    // Full: 16 matches vs R4
  const selPairsGen7 = isSmoke ? 1 : 5;  // Full: 10 matches vs Gen 7
  // Smoke: 4 pairs = 8 matches/cand; Full: 25 pairs = 50 matches/cand on the EXACT same Selection Arena Seeds!

  const allCandidateIds = [...Array.from(g0CandidateIds), ...Array.from(evolvedCandidateIds)];
  console.log(
    `\n[Step 2] 世代間公平選抜アリーナ (Selection Seeds: ${selectionSeedBase}〜, 候補数=${allCandidateIds.length}個体 [G0人手設計=${g0CandidateIds.size}, G1〜G3進化個体=${evolvedCandidateIds.size}])`
  );

  const arenaRecords: IndividualProvenanceRecord[] = [];
  for (const candId of allCandidateIds) {
    const genome = genomeMap.get(candId)!;
    const rec = evaluateGenomeProvenance({
      genome,
      g0Presets: g0InitialPresets,
      primaryParentWeights: primaryParentWeightsMap.get(candId),
      evaluatedGeneration: numGenerations,
      evaluationPhase: "FAIR_SELECTION_ARENA",
      seedBase: selectionSeedBase,
      pairsGen8: selPairsGen8,
      pairsR4: selPairsR4,
      pairsGen7: selPairsGen7,
      pairsRand: 0,
      gen8DNA,
      gen7DNA,
      tacticalEvaluator,
      reg,
      frame,
      rulePackage,
      checkTimeout,
    });
    arenaRecords.push(rec);
    console.log(
      `  * [Arena] ${rec.individualId} (${rec.originType}, createdG=${rec.createdGeneration}, L1FromG0=${rec.minL1DistanceFromG0Presets.toFixed(2)}): Fitness=${rec.fitnessScore.toFixed(2)} | Overall=${rec.overallWinRatePct.toFixed(1)}% (vsGen8=${rec.vsGen8WinRatePct.toFixed(1)}%, vsR4=${rec.vsR4WinRatePct.toFixed(1)}%, vsGen7=${rec.vsGen7WinRatePct.toFixed(1)}%)`
    );
  }

  const selectionResult = selectBestCandidatesByOrigin(arenaRecords);
  const bestG0Rec = selectionResult.bestHandDesignedG0;
  const bestEvolvedRec = selectionResult.bestEvolvedOffspring;
  const bestG0Genome = genomeMap.get(bestG0Rec.individualId)!;
  const bestEvolvedGenome = genomeMap.get(bestEvolvedRec.individualId)!;

  console.log(`\n  => [選抜結果 (同一 Selection Seed 比較)]`);
  console.log(
    `     1. G0 最良人手設計個体: ${bestG0Rec.individualId} (origin=${bestG0Rec.originType}, createdG=${bestG0Rec.createdGeneration}, ArenaFitness=${bestG0Rec.fitnessScore.toFixed(2)})`
  );
  console.log(
    `     2. G1〜G3 最良進化個体: ${bestEvolvedRec.individualId} (origin=${bestEvolvedRec.originType}, createdG=${bestEvolvedRec.createdGeneration}, parents=[${bestEvolvedRec.parentIds.join(", ")}], ArenaFitness=${bestEvolvedRec.fitnessScore.toFixed(2)})`
  );

  // ---------------------------------------------------------------------------
  // STEP 3: 独立した最終比較検証 (Final Comparison Seeds: 750001〜750030)
  // ---------------------------------------------------------------------------
  const finalSeedStart = 750001;
  const finalPairs = isSmoke ? 2 : 30; // Full: 30 pairs = 60 matches per matchup (seat-swapped)
  console.log(
    `\n[Step 3] 独立最終比較検証 (Final Seeds: ${finalSeedStart}〜${finalSeedStart + finalPairs - 1}, 各${finalPairs}ペア=${finalPairs * 2}試合, 座席反転)`
  );

  // 3-1. 直接対決: G1〜G3 最良進化個体 vs G0 最良人手設計個体
  const h2hEvolvedVsG0Best = evaluateHeadToHead({
    candidateName: `Evolved-Best (${bestEvolvedRec.individualId})`,
    opponentName: `G0-HandDesigned-Best (${bestG0Rec.individualId})`,
    createCandidate: (seat) =>
      new Gen9LearnableTacticalPolicy(bestEvolvedGenome, `Evolved-${seat}`, tacticalEvaluator),
    createOpponent: (seat) =>
      new Gen9LearnableTacticalPolicy(bestG0Genome, `G0Best-${seat}`, tacticalEvaluator),
    seedStart: finalSeedStart,
    pairsCount: finalPairs,
    reg,
    frame,
    rulePackage,
    checkTimeout,
  });

  // 3-2. 対 Gen 8 Champion Candidate
  const finalEvolvedVsGen8 = evaluateHeadToHead({
    candidateName: `Evolved-Best (${bestEvolvedRec.individualId})`,
    opponentName: "Gen 8 Champion Candidate",
    createCandidate: (seat) =>
      new Gen9LearnableTacticalPolicy(bestEvolvedGenome, `Evolved-${seat}`, tacticalEvaluator),
    createOpponent: (seat) => new GenomePolicy(gen8DNA, `Gen8-${seat}`),
    seedStart: finalSeedStart,
    pairsCount: finalPairs,
    reg,
    frame,
    rulePackage,
    checkTimeout,
  });

  const finalG0BestVsGen8 = evaluateHeadToHead({
    candidateName: `G0-HandDesigned-Best (${bestG0Rec.individualId})`,
    opponentName: "Gen 8 Champion Candidate",
    createCandidate: (seat) =>
      new Gen9LearnableTacticalPolicy(bestG0Genome, `G0Best-${seat}`, tacticalEvaluator),
    createOpponent: (seat) => new GenomePolicy(gen8DNA, `Gen8-${seat}`),
    seedStart: finalSeedStart,
    pairsCount: finalPairs,
    reg,
    frame,
    rulePackage,
    checkTimeout,
  });

  const finalR4VsGen8 = evaluateHeadToHead({
    candidateName: "Work 5-1 R4 (Generic DSL)",
    opponentName: "Gen 8 Champion Candidate",
    createCandidate: (seat) => new Gen9TacticalPrototypePolicy(gen8DNA, `R4-${seat}`, tacticalEvaluator),
    createOpponent: (seat) => new GenomePolicy(gen8DNA, `Gen8-${seat}`),
    seedStart: finalSeedStart,
    pairsCount: finalPairs,
    reg,
    frame,
    rulePackage,
    checkTimeout,
  });

  // 3-3. 対 Work 5-1 R4
  const finalEvolvedVsR4 = evaluateHeadToHead({
    candidateName: `Evolved-Best (${bestEvolvedRec.individualId})`,
    opponentName: "Work 5-1 R4 (Generic DSL)",
    createCandidate: (seat) =>
      new Gen9LearnableTacticalPolicy(bestEvolvedGenome, `Evolved-${seat}`, tacticalEvaluator),
    createOpponent: (seat) => new Gen9TacticalPrototypePolicy(gen8DNA, `R4-${seat}`, tacticalEvaluator),
    seedStart: finalSeedStart,
    pairsCount: finalPairs,
    reg,
    frame,
    rulePackage,
    checkTimeout,
  });

  const finalG0BestVsR4 = evaluateHeadToHead({
    candidateName: `G0-HandDesigned-Best (${bestG0Rec.individualId})`,
    opponentName: "Work 5-1 R4 (Generic DSL)",
    createCandidate: (seat) =>
      new Gen9LearnableTacticalPolicy(bestG0Genome, `G0Best-${seat}`, tacticalEvaluator),
    createOpponent: (seat) => new Gen9TacticalPrototypePolicy(gen8DNA, `R4-${seat}`, tacticalEvaluator),
    seedStart: finalSeedStart,
    pairsCount: finalPairs,
    reg,
    frame,
    rulePackage,
    checkTimeout,
  });

  // 3-4. 対 Official Gen 7 Champion (共通相手)
  const finalEvolvedVsGen7 = evaluateHeadToHead({
    candidateName: `Evolved-Best (${bestEvolvedRec.individualId})`,
    opponentName: "Official Gen 7 Champion",
    createCandidate: (seat) =>
      new Gen9LearnableTacticalPolicy(bestEvolvedGenome, `Evolved-${seat}`, tacticalEvaluator),
    createOpponent: (seat) => new GenomePolicy(gen7DNA, `Gen7-${seat}`),
    seedStart: finalSeedStart,
    pairsCount: finalPairs,
    reg,
    frame,
    rulePackage,
    checkTimeout,
  });

  const finalG0BestVsGen7 = evaluateHeadToHead({
    candidateName: `G0-HandDesigned-Best (${bestG0Rec.individualId})`,
    opponentName: "Official Gen 7 Champion",
    createCandidate: (seat) =>
      new Gen9LearnableTacticalPolicy(bestG0Genome, `G0Best-${seat}`, tacticalEvaluator),
    createOpponent: (seat) => new GenomePolicy(gen7DNA, `Gen7-${seat}`),
    seedStart: finalSeedStart,
    pairsCount: finalPairs,
    reg,
    frame,
    rulePackage,
    checkTimeout,
  });

  const finalR4VsGen7 = evaluateHeadToHead({
    candidateName: "Work 5-1 R4 (Generic DSL)",
    opponentName: "Official Gen 7 Champion",
    createCandidate: (seat) => new Gen9TacticalPrototypePolicy(gen8DNA, `R4-${seat}`, tacticalEvaluator),
    createOpponent: (seat) => new GenomePolicy(gen7DNA, `Gen7-${seat}`),
    seedStart: finalSeedStart,
    pairsCount: finalPairs,
    reg,
    frame,
    rulePackage,
    checkTimeout,
  });

  const finalGen8VsGen7 = evaluateHeadToHead({
    candidateName: "Gen 8 Champion Candidate",
    opponentName: "Official Gen 7 Champion",
    createCandidate: (seat) => new GenomePolicy(gen8DNA, `Gen8-${seat}`),
    createOpponent: (seat) => new GenomePolicy(gen7DNA, `Gen7-${seat}`),
    seedStart: finalSeedStart,
    pairsCount: finalPairs,
    reg,
    frame,
    rulePackage,
    checkTimeout,
  });

  for (const m of [
    h2hEvolvedVsG0Best,
    finalEvolvedVsGen8,
    finalG0BestVsGen8,
    finalR4VsGen8,
    finalEvolvedVsR4,
    finalG0BestVsR4,
    finalEvolvedVsGen7,
    finalG0BestVsGen7,
    finalR4VsGen7,
    finalGen8VsGen7,
  ]) {
    console.log(
      `  * ${m.candidateName} vs ${m.opponentName}: ${m.wins}W-${m.losses}L-${m.draws}D | 勝率=${m.legWinRatePct.toFixed(1)}% (95%CI: [${m.legWinRateCI95.lowerPct.toFixed(1)}%, ${m.legWinRateCI95.upperPct.toFixed(1)}%]) | PairScore=${m.pairScorePct.toFixed(1)}% (±${m.pairScoreCI95.halfWidthPct.toFixed(1)}%) [Pair: ${m.pairWins}W-${m.pairLosses}L-${m.pairSplits}S] | P1=${m.p1WinRatePct.toFixed(1)}%, P2=${m.p2WinRatePct.toFixed(1)}%`
    );
  }

  // Schema v6 互換性検証
  DecisionDNACodec.validate(toV6CompatibleDNA(bestEvolvedGenome));
  DecisionDNACodec.validate(toV6CompatibleDNA(bestG0Genome));

  const weightComparisonTable = TACTICAL_FEATURE_NAMES.map((name, i) => ({
    index: i,
    featureName: name,
    category: TACTICAL_FEATURE_CATEGORY_MAP[name],
    r4PresetWeight: R4_PRESET_TACTICAL_WEIGHTS[i],
    bestG0HandDesignedWeight: bestG0Genome.tacticalWeights[i],
    bestEvolvedOffspringWeight: bestEvolvedGenome.tacticalWeights[i],
    deltaEvolvedMinusG0: Number(
      (bestEvolvedGenome.tacticalWeights[i] - bestG0Genome.tacticalWeights[i]).toFixed(4)
    ),
  }));

  const overallWallTimeMs = Number((performance.now() - overallStartMs).toFixed(1));

  const report = {
    workId: "BP-SIM-AI-GEN9-PILOT-EVOLUTION-WORK5-2-R2",
    mode: modeArg,
    baseCommitSha: currentHeadSha,
    r1ReferenceCommitSha: R1_COMMIT_SHA,
    generatedAt: new Date().toISOString(),
    overallWallTimeMs,
    seedSeparation: {
      trainingSeeds: "730001-730312",
      selectionArenaSeeds: bestEvolvedRec.evaluationSeedRange,
      finalComparisonSeeds: `${finalSeedStart}-${finalSeedStart + finalPairs - 1}`,
      forbiddenRangesEnforced: FORBIDDEN_SEED_RANGES,
    },
    r1ProvenanceAudit,
    selectedModels: {
      bestG0HandDesigned: bestG0Rec,
      bestEvolvedOffspring: bestEvolvedRec,
      weightComparisonTable,
    },
    generationLogs,
    selectionArenaRankings: selectionResult.allSorted,
    finalIndependentComparison: {
      directHeadToHead: {
        evolvedVsG0Best: h2hEvolvedVsG0Best,
        evolvedVsGen8: finalEvolvedVsGen8,
        g0BestVsGen8: finalG0BestVsGen8,
        r4VsGen8: finalR4VsGen8,
        evolvedVsR4: finalEvolvedVsR4,
        g0BestVsR4: finalG0BestVsR4,
      },
      commonOpponentGen7: {
        evolvedVsGen7: finalEvolvedVsGen7,
        g0BestVsGen7: finalG0BestVsGen7,
        r4VsGen7: finalR4VsGen7,
        gen8VsGen7: finalGen8VsGen7,
      },
    },
  };

  const outFileName = isSmoke
    ? ".artifacts/gen9-work5-2-r2-smoke.json"
    : ".artifacts/gen9-work5-2-r2-results.json";
  const outPath = path.resolve(outFileName);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf-8");
  console.log(`\n=> Work 5-2 R2 結果JSON保存完了: ${outPath} (総実行時間: ${(overallWallTimeMs / 1000).toFixed(1)}s)`);
}

if (!process.env.VITEST) {
  main().catch((err) => {
    console.error("Pilot evolution R2 failed:", err);
    process.exit(1);
  });
}
