/**
 * run_gen9_pilot_evolution.ts
 *
 * BlackPoker Simulator - Gen 9 学習パイロット計画・実証スクリプト (Work 5-2)
 *
 * 【構成】
 * 1. ベースラインの確定 (Baseline Verification):
 *    - Work 5-1 R1 コピー実装 (Gen9TacticalPrototypePolicyR1) と R4 (Gen9TacticalPrototypePolicy) の
 *      代表局面での意思決定・スコア一致検証。
 *    - 独立ベースライン Seed (700001〜700050, 50ペア = 100試合/カード, 座席反転) における
 *      Gen 8 Champion Candidate vs R4 vs R1 vs Gen 7 の対戦比較と 95% 信頼区間 (Wilson CI / Paired CI) 算出。
 * 2. 小規模な進化学習パイロット (Small-Scale Evolutionary Pilot):
 *    - 個体数: 8個体 × 4世代 (G0〜G3)
 *    - Training Seeds: 710001〜710400 (Validation / Baseline / Holdout / 正本診断Seed 4127992094 と完全分離)
 *    - 複数対戦相手による適応度評価 (Gen 8, R4, Gen 7, SeededRandom) で単一相手への過学習を防止。
 *    - 各世代の勝率・適応度・CPU実行時間・例外発生率を記録。
 * 3. 独立 Validation 比較 (Independent Validation):
 *    - Validation Seeds: 720001〜720050 (50ペア = 100試合/対戦相手, 計400試合/モデル, 座席反転)
 *    - 学習最良個体 (Gen9-Pilot-Best) を Gen 8, R4, Gen 7, SeededRandom と比較し、
 *      同一 Validation Seeds 上の R4 成績および 95% 信頼区間と厳密比較。
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
  TACTICAL_FEATURE_DIMENSION,
  TACTICAL_FEATURE_NAMES,
  TACTICAL_FEATURE_CATEGORY_MAP,
  ZERO_TACTICAL_WEIGHTS,
  R4_PRESET_TACTICAL_WEIGHTS,
  fromV6DNA,
  toV6CompatibleDNA,
  cloneTacticalGenome,
} from "../src/engine/ai/Gen9LearnableTacticalPolicy.js";
import { GenericTacticalEvaluator } from "../src/engine/rules/GenericTacticalEvaluator.js";
import { createGen8ChampionCandidatePolicy } from "../src/engine/ai/Gen8DNALoader.js";
import { loadOfficialChampionsStrict } from "../src/cli/largeScaleSimulationRunner.js";
import { DecisionRequest } from "../src/domain/decision/DecisionRequest.js";
import { DecisionResponse } from "../src/domain/decision/DecisionResponse.js";
import { DecisionDNA } from "../src/domain/ai/DecisionDNATypes.js";
import { DecisionDNACodec } from "../src/engine/ai/DecisionDNACodec.js";
import { Gen9TacticalPrototypePolicyR1, R1_COMMIT_SHA } from "./run_gen9_tactical_benchmark.js";

// =============================================================================
// 保護 Seed 範囲との非重複アサーション
// =============================================================================
const FORBIDDEN_SEED_RANGES: readonly { name: string; start: number; end: number }[] = [
  { name: "Official Holdout v1", start: 95001, end: 95030 },
  { name: "Official Holdout v2", start: 250001, end: 250120 },
  { name: "Future Final Holdout", start: 350001, end: 350300 },
  { name: "Original Human Diagnostic Seed", start: 4127992094, end: 4127992094 },
];

function assertSafeSeedRange(label: string, start: number, count: number): void {
  const end = start + count - 1;
  for (const forbidden of FORBIDDEN_SEED_RANGES) {
    const overlaps = Math.max(start, forbidden.start) <= Math.min(end, forbidden.end);
    if (overlaps) {
      throw new Error(
        `[SEED_VIOLATION] ${label} (${start}..${end}) が保護領域 ${forbidden.name} (${forbidden.start}..${forbidden.end}) と重複しています`
      );
    }
  }
}

// =============================================================================
// 統計・信頼区間 (95% CI) ユーティリティ
// =============================================================================
export interface ConfidenceInterval95 {
  readonly meanPct: number;
  readonly lowerPct: number;
  readonly upperPct: number;
  readonly halfWidthPct: number;
}

/**
 * 二項勝率 (W / N) に対する Wilson Score 95% 信頼区間 (%)
 */
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
    meanPct: p * 100,
    lowerPct: Number(lower.toFixed(2)),
    upperPct: Number(upper.toFixed(2)),
    halfWidthPct: Number(((upper - lower) / 2).toFixed(2)),
  };
}

/**
 * ペアスコア配列 (0.0, 0.5, 1.0) に対する 95% 信頼区間 (%)
 */
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

// =============================================================================
// 実行時間・例外計測ラッパー
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
  let totalTurns = 0;
  let totalDecisions = 0;
  let totalCandidateDecisions = 0;
  let totalCandidateTimeUs = 0;
  const pairScores: number[] = [];

  for (let i = 0; i < pairsCount; i++) {
    const matchSeed = seedStart + i;

    // Leg 0: P1 = Candidate, P2 = Opponent
    const cand0 = new InstrumentedPolicyWrapper(createCandidate("p1", matchSeed));
    const opp0 = createOpponent("p2", matchSeed);
    const setup0 = OfficialRegulationMatchSetup.setupMatch(reg, frame, rulePackage, matchSeed, {
      playerNames: { p1: candidateName, p2: opponentName },
    });
    const session0 = new GameSession((setup0 as any).state, rulePackage, { matchSeed });
    const res0 = SimulationRunner.run(session0, { p1: cand0, p2: opp0 }, { maxDecisions: 1000 });

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

    // Leg 1: P1 = Opponent, P2 = Candidate (座席反転)
    const opp1 = createOpponent("p1", matchSeed);
    const cand1 = new InstrumentedPolicyWrapper(createCandidate("p2", matchSeed));
    const setup1 = OfficialRegulationMatchSetup.setupMatch(reg, frame, rulePackage, matchSeed, {
      playerNames: { p1: opponentName, p2: candidateName },
    });
    const session1 = new GameSession((setup1 as any).state, rulePackage, { matchSeed });
    const res1 = SimulationRunner.run(session1, { p1: opp1, p2: cand1 }, { maxDecisions: 1000 });

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

    pairScores.push((s0 + s1) / 2);
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
// 進化学習オペレータ (TacticalWeights 突然変異・交叉 + 初期集団生成)
// =============================================================================

/**
 * 初期集団 (8個体) の生成
 * - Ind 0: R4 Preset (Work 5-1 R4 と完全一致)
 * - Ind 1: Pure Gen 8 v6 (ZERO_TACTICAL_WEIGHTS)
 * - Ind 2: Counter-Positive / Zero-Unconditional-PASS-Penalty
 *          (Counterが合法なときのみ確定/推定致死阻止で強く加点し、damageJudge等でCounterが無いときにPASSを不当減点しない設計)
 * - Ind 3: Counter-Positive + Combat-Advantage + Lethal-Block
 *          (Ind 2 に加え、数的優位攻撃・リーサル攻撃・即死ブロック回避・犬死抑制を有効化)
 * - Ind 4: Conservative-PASS-Penalty + Strong-Counter + Strong-Combat
 * - Ind 5: Selective-Lethal-Only (確定致死阻止・リーサル攻撃・即死ブロック回避のみ特化)
 * - Ind 6: High-Aggression-Breakthrough (数的優位・リーサル突破重視 + Counter阻止)
 * - Ind 7: Survival & Trade Balanced (ブロック有利トレード・残ライフ危険時召喚重視 + Counter阻止)
 */
function createInitialPopulation(gen8DNA: Readonly<DecisionDNA>): Gen9TacticalGenome[] {
  const presets: { id: string; name: string; weights: readonly number[] }[] = [
    {
      id: "gen9-g0-ind0-r4-preset",
      name: "Ind0: R4-Preset",
      weights: [...R4_PRESET_TACTICAL_WEIGHTS],
    },
    {
      id: "gen9-g0-ind1-gen8-zero",
      name: "Ind1: Gen8-ZeroTactical",
      weights: [...ZERO_TACTICAL_WEIGHTS],
    },
    {
      id: "gen9-g0-ind2-counter-selective",
      name: "Ind2: CounterSelective-NoBlindPassPenalty",
      weights: [
        0.0,   // t00_pass_certain_lethal (Counter不在時の暴発防止)
        0.0,   // t01_pass_certain_severe_ratio
        0.0,   // t02_pass_certain_moderate
        0.0,   // t03_pass_estimated_lethal_risk
        0.0,   // t04_pass_estimated_severe_ratio
        0.0,   // t05_pass_estimated_moderate
        +2.6,  // t06_counter_certain_lethal_prevent
        +2.0,  // t07_counter_estimated_lethal_prevent
        +1.1,  // t08_counter_damage_prevent_scaled
        +0.15, // t09_counter_uncertain_cancel
        0.0,   // t10_attack_unblocked_nonlethal
        0.0,   // t11_attack_numerical_advantage
        0.0,   // t12_attack_favorable_or_equal_trade
        -0.30, // t13_attack_suicide_scaled
        0.0,   // t14_block_trade_advantage
        -2.5,  // t15_block_unblocked_lethal
        0.0,   // t16_block_unblocked_danger_ratio
        0.0,   // t17_survival_critical_life_board_build
        +2.0,  // t18_attack_unblocked_lethal
        +2.5,  // t19_attack_breakthrough_lethal
      ],
    },
    {
      id: "gen9-g0-ind3-counter-combat-synergy",
      name: "Ind3: CounterCombatSynergy",
      weights: [
        -0.15, // t00_pass_certain_lethal (微小ペナルティのみ)
        0.0,   // t01_pass_certain_severe_ratio
        0.0,   // t02_pass_certain_moderate
        -0.10, // t03_pass_estimated_lethal_risk
        0.0,   // t04_pass_estimated_severe_ratio
        0.0,   // t05_pass_estimated_moderate
        +2.8,  // t06_counter_certain_lethal_prevent
        +2.1,  // t07_counter_estimated_lethal_prevent
        +1.2,  // t08_counter_damage_prevent_scaled
        +0.20, // t09_counter_uncertain_cancel
        +0.12, // t10_attack_unblocked_nonlethal
        +0.22, // t11_attack_numerical_advantage
        +0.04, // t12_attack_favorable_or_equal_trade
        -0.35, // t13_attack_suicide_scaled
        +0.12, // t14_block_trade_advantage
        -2.8,  // t15_block_unblocked_lethal
        -0.25, // t16_block_unblocked_danger_ratio
        +0.08, // t17_survival_critical_life_board_build
        +2.2,  // t18_attack_unblocked_lethal
        +2.6,  // t19_attack_breakthrough_lethal
      ],
    },
    {
      id: "gen9-g0-ind4-mild-pass-strong-counter",
      name: "Ind4: MildPassStrongCounter",
      weights: [
        -0.40, // t00_pass_certain_lethal
        -0.10, // t01_pass_certain_severe_ratio
        0.0,   // t02_pass_certain_moderate
        -0.25, // t03_pass_estimated_lethal_risk
        -0.05, // t04_pass_estimated_severe_ratio
        0.0,   // t05_pass_estimated_moderate
        +2.5,  // t06_counter_certain_lethal_prevent
        +1.9,  // t07_counter_estimated_lethal_prevent
        +0.95, // t08_counter_damage_prevent_scaled
        +0.15, // t09_counter_uncertain_cancel
        +0.15, // t10_attack_unblocked_nonlethal
        +0.25, // t11_attack_numerical_advantage
        +0.05, // t12_attack_favorable_or_equal_trade
        -0.32, // t13_attack_suicide_scaled
        +0.15, // t14_block_trade_advantage
        -2.5,  // t15_block_unblocked_lethal
        -0.30, // t16_block_unblocked_danger_ratio
        +0.10, // t17_survival_critical_life_board_build
        +2.0,  // t18_attack_unblocked_lethal
        +2.5,  // t19_attack_breakthrough_lethal
      ],
    },
    {
      id: "gen9-g0-ind5-lethal-guard-focused",
      name: "Ind5: LethalGuardFocused",
      weights: [
        0.0,   // t00_pass_certain_lethal
        0.0,   // t01_pass_certain_severe_ratio
        0.0,   // t02_pass_certain_moderate
        0.0,   // t03_pass_estimated_lethal_risk
        0.0,   // t04_pass_estimated_severe_ratio
        0.0,   // t05_pass_estimated_moderate
        +3.0,  // t06_counter_certain_lethal_prevent
        +2.2,  // t07_counter_estimated_lethal_prevent
        +0.80, // t08_counter_damage_prevent_scaled
        +0.10, // t09_counter_uncertain_cancel
        +0.08, // t10_attack_unblocked_nonlethal
        +0.18, // t11_attack_numerical_advantage
        +0.02, // t12_attack_favorable_or_equal_trade
        -0.28, // t13_attack_suicide_scaled
        +0.08, // t14_block_trade_advantage
        -2.6,  // t15_block_unblocked_lethal
        -0.15, // t16_block_unblocked_danger_ratio
        +0.05, // t17_survival_critical_life_board_build
        +2.4,  // t18_attack_unblocked_lethal
        +2.8,  // t19_attack_breakthrough_lethal
      ],
    },
    {
      id: "gen9-g0-ind6-tempo-breakthrough",
      name: "Ind6: TempoBreakthrough",
      weights: [
        -0.10, // t00_pass_certain_lethal
        0.0,   // t01_pass_certain_severe_ratio
        0.0,   // t02_pass_certain_moderate
        -0.10, // t03_pass_estimated_lethal_risk
        0.0,   // t04_pass_estimated_severe_ratio
        0.0,   // t05_pass_estimated_moderate
        +2.4,  // t06_counter_certain_lethal_prevent
        +1.8,  // t07_counter_estimated_lethal_prevent
        +1.0,  // t08_counter_damage_prevent_scaled
        +0.20, // t09_counter_uncertain_cancel
        +0.25, // t10_attack_unblocked_nonlethal
        +0.35, // t11_attack_numerical_advantage
        +0.08, // t12_attack_favorable_or_equal_trade
        -0.40, // t13_attack_suicide_scaled
        +0.18, // t14_block_trade_advantage
        -2.5,  // t15_block_unblocked_lethal
        -0.20, // t16_block_unblocked_danger_ratio
        +0.06, // t17_survival_critical_life_board_build
        +2.2,  // t18_attack_unblocked_lethal
        +2.7,  // t19_attack_breakthrough_lethal
      ],
    },
    {
      id: "gen9-g0-ind7-survival-trade",
      name: "Ind7: SurvivalTradeBalanced",
      weights: [
        -0.20, // t00_pass_certain_lethal
        -0.05, // t01_pass_certain_severe_ratio
        0.0,   // t02_pass_certain_moderate
        -0.15, // t03_pass_estimated_lethal_risk
        0.0,   // t04_pass_estimated_severe_ratio
        0.0,   // t05_pass_estimated_moderate
        +2.6,  // t06_counter_certain_lethal_prevent
        +2.0,  // t07_counter_estimated_lethal_prevent
        +1.1,  // t08_counter_damage_prevent_scaled
        +0.15, // t09_counter_uncertain_cancel
        +0.10, // t10_attack_unblocked_nonlethal
        +0.20, // t11_attack_numerical_advantage
        +0.05, // t12_attack_favorable_or_equal_trade
        -0.38, // t13_attack_suicide_scaled
        +0.22, // t14_block_trade_advantage
        -3.0,  // t15_block_unblocked_lethal
        -0.40, // t16_block_unblocked_danger_ratio
        +0.15, // t17_survival_critical_life_board_build
        +2.0,  // t18_attack_unblocked_lethal
        +2.5,  // t19_attack_breakthrough_lethal
      ],
    },
  ];

  return presets.map((p) =>
    fromV6DNA(gen8DNA, p.weights, {
      id: p.id,
      name: p.name,
      generation: 0,
      parentIds: ["gen8-prod-g0-ind7-cross7"],
    })
  );
}

/**
 * 2親の戦術重み一様・算術ブレンド交叉 + ガウス摂動突然変異
 */
function breedOffspring(
  parentA: Readonly<Gen9TacticalGenome>,
  parentB: Readonly<Gen9TacticalGenome>,
  rng: SeededRandom,
  generation: number,
  indIndex: number,
  mutationSigma: number
): Gen9TacticalGenome {
  const newWeights: number[] = new Array(TACTICAL_FEATURE_DIMENSION);
  for (let k = 0; k < TACTICAL_FEATURE_DIMENSION; k++) {
    const wa = parentA.tacticalWeights[k];
    const wb = parentB.tacticalWeights[k];
    // 50% ブレンドまたは親選択
    const alpha = rng.next() < 0.5 ? 0.5 : rng.next() < 0.5 ? 1.0 : 0.0;
    let w = alpha * wa + (1 - alpha) * wb;

    // 突然変異 (45% の確率で摂動)
    if (rng.next() < 0.45) {
      // Box-Muller 法で標準正規乱数
      const u1 = Math.max(1e-9, rng.next());
      const u2 = rng.next();
      const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
      w += z * mutationSigma;
    }

    // 符号制約 (ペナルティ特徴量は <= 0, ボーナス特徴量は >= 0 に保つ)
    const isPenaltyFeature = k <= 5 || k === 13 || k === 15 || k === 16;
    if (isPenaltyFeature) {
      w = Math.max(-3.5, Math.min(0.0, w));
    } else {
      w = Math.max(0.0, Math.min(3.5, w));
    }
    newWeights[k] = Number(w.toFixed(4));
  }

  return fromV6DNA(parentA.baseDNA, newWeights, {
    id: `gen9-pilot-g${generation}-ind${indIndex}`,
    name: `Gen9-G${generation}-Ind${indIndex}`,
    generation,
    parentIds: [parentA.metadata?.id ?? "pA", parentB.metadata?.id ?? "pB"],
  });
}

interface IndividualEvalRecord {
  readonly individualId: string;
  readonly individualName: string;
  readonly generation: number;
  readonly tacticalWeights: readonly number[];
  readonly fitnessScore: number;
  readonly overallWinRatePct: number;
  readonly vsGen8WinRatePct: number;
  readonly vsR4WinRatePct: number;
  readonly vsGen7WinRatePct: number;
  readonly vsRandomWinRatePct: number;
  readonly totalMatches: number;
  readonly totalExceptions: number;
  readonly avgTimeUsPerDecision: number;
  readonly evalWallTimeMs: number;
}

interface GenerationTelemetry {
  readonly generation: number;
  readonly trainingSeedRange: string;
  readonly matchesPerIndividual: number;
  readonly totalGenerationMatches: number;
  readonly generationWallTimeMs: number;
  readonly exceptionRatePct: number;
  readonly bestIndividualId: string;
  readonly bestFitnessScore: number;
  readonly bestOverallWinRatePct: number;
  readonly bestVsGen8WinRatePct: number;
  readonly bestVsR4WinRatePct: number;
  readonly meanPopulationFitness: number;
  readonly rankings: readonly IndividualEvalRecord[];
}

async function main() {
  let currentHeadSha = "08f611d8b5d8f08394a50fef2c96fed9770df611";
  try {
    currentHeadSha = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
  } catch {
    // ignore
  }

  const overallStartMs = performance.now();

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
  console.log(" BlackPoker Work 5-2 — Gen 9 学習パイロット計画・実証 (Baseline / Evolution / Validation)");
  console.log(` Base SHA: ${currentHeadSha}`);
  console.log("================================================================================");

  // ===========================================================================
  // STEP 1: ベースラインの確定 (Seeds 700001〜700050, 50ペア = 100試合/カード, 座席反転)
  // ===========================================================================
  const baselineSeedStart = 700001;
  const baselinePairs = 50; // 100 matches per matchup (seat-swapped)
  console.log(
    `\n[Step 1] ベースライン拡張評価 (Seeds: ${baselineSeedStart}〜${baselineSeedStart + baselinePairs - 1}, 各${baselinePairs}ペア=${baselinePairs * 2}試合)`
  );

  const baselineR4vsGen8 = evaluateHeadToHead({
    candidateName: "Work 5-1 R4 (Generic DSL)",
    opponentName: "Gen 8 Champion Candidate",
    createCandidate: (seat) => new Gen9TacticalPrototypePolicy(gen8DNA, `R4-${seat}`, tacticalEvaluator),
    createOpponent: (seat) => new GenomePolicy(gen8DNA, `Gen8-${seat}`),
    seedStart: baselineSeedStart,
    pairsCount: baselinePairs,
    reg,
    frame,
    rulePackage,
  });

  const baselineR1vsGen8 = evaluateHeadToHead({
    candidateName: "Work 5-1 R1 (Legacy Copy)",
    opponentName: "Gen 8 Champion Candidate",
    createCandidate: (seat) => new Gen9TacticalPrototypePolicyR1(gen8DNA, `R1-${seat}`),
    createOpponent: (seat) => new GenomePolicy(gen8DNA, `Gen8-${seat}`),
    seedStart: baselineSeedStart,
    pairsCount: baselinePairs,
    reg,
    frame,
    rulePackage,
  });

  const baselineR4vsR1 = evaluateHeadToHead({
    candidateName: "Work 5-1 R4 (Generic DSL)",
    opponentName: "Work 5-1 R1 (Legacy Copy)",
    createCandidate: (seat) => new Gen9TacticalPrototypePolicy(gen8DNA, `R4-${seat}`, tacticalEvaluator),
    createOpponent: (seat) => new Gen9TacticalPrototypePolicyR1(gen8DNA, `R1-${seat}`),
    seedStart: baselineSeedStart,
    pairsCount: baselinePairs,
    reg,
    frame,
    rulePackage,
  });

  const baselineR4vsGen7 = evaluateHeadToHead({
    candidateName: "Work 5-1 R4 (Generic DSL)",
    opponentName: "Official Gen 7 Champion",
    createCandidate: (seat) => new Gen9TacticalPrototypePolicy(gen8DNA, `R4-${seat}`, tacticalEvaluator),
    createOpponent: (seat) => new GenomePolicy(gen7DNA, `Gen7-${seat}`),
    seedStart: baselineSeedStart,
    pairsCount: baselinePairs,
    reg,
    frame,
    rulePackage,
  });

  const baselineGen8vsGen7 = evaluateHeadToHead({
    candidateName: "Gen 8 Champion Candidate",
    opponentName: "Official Gen 7 Champion",
    createCandidate: (seat) => new GenomePolicy(gen8DNA, `Gen8-${seat}`),
    createOpponent: (seat) => new GenomePolicy(gen7DNA, `Gen7-${seat}`),
    seedStart: baselineSeedStart,
    pairsCount: baselinePairs,
    reg,
    frame,
    rulePackage,
  });

  for (const b of [baselineR4vsGen8, baselineR1vsGen8, baselineR4vsR1, baselineR4vsGen7, baselineGen8vsGen7]) {
    console.log(
      `  * ${b.candidateName} vs ${b.opponentName}: ${b.wins}W-${b.losses}L-${b.draws}D | 勝率=${b.legWinRatePct.toFixed(1)}% (95%CI: [${b.legWinRateCI95.lowerPct.toFixed(1)}%, ${b.legWinRateCI95.upperPct.toFixed(1)}%]) | PairScore=${b.pairScorePct.toFixed(1)}% (±${b.pairScoreCI95.halfWidthPct.toFixed(1)}%) | P1=${b.p1WinRatePct.toFixed(1)}%, P2=${b.p2WinRatePct.toFixed(1)}% | ${b.msPerMatch.toFixed(1)}ms/match`
    );
  }

  // ===========================================================================
  // STEP 2: 小規模な進化学習パイロット (Training Seeds: 710001〜710400)
  // ===========================================================================
  const numGenerations = 4; // G0, G1, G2, G3
  const popSize = 8;
  const trainPairsGen8 = 12; // 24 matches vs Gen 8
  const trainPairsR4 = 10;   // 20 matches vs R4
  const trainPairsGen7 = 8;  // 16 matches vs Gen 7
  const trainPairsRand = 4;  // 8 matches vs SeededRandom
  // Total = 34 pairs = 68 matches per individual per generation
  const breedRng = new SeededRandom(20261108);

  let population = createInitialPopulation(gen8DNA);
  const generationLogs: GenerationTelemetry[] = [];
  let globalBestRecord: IndividualEvalRecord | undefined;
  let globalBestGenome: Gen9TacticalGenome = cloneTacticalGenome(population[0]);

  console.log(
    `\n[Step 2] 小規模進化学習パイロット開始 (個体数=${popSize}, 世代数=${numGenerations}, 各個体68試合/世代)`
  );

  for (let gen = 0; gen < numGenerations; gen++) {
    const genStartMs = performance.now();
    // 世代ごとに異なる Training Seed ブロック + 共通アンカーを使用し、特定Seedへの過学習を防ぐ
    const genSeedBase = 710001 + gen * 80;
    const genRecords: IndividualEvalRecord[] = [];
    let genExceptions = 0;
    let genMatches = 0;

    for (let idx = 0; idx < population.length; idx++) {
      const ind = population[idx];
      const indStartMs = performance.now();

      const vsGen8 = evaluateHeadToHead({
        candidateName: ind.metadata?.name ?? `G${gen}-Ind${idx}`,
        opponentName: "Gen 8 Champion Candidate",
        createCandidate: (seat) => new Gen9LearnableTacticalPolicy(ind, `Cand-${seat}`, tacticalEvaluator),
        createOpponent: (seat) => new GenomePolicy(gen8DNA, `Gen8-${seat}`),
        seedStart: genSeedBase,
        pairsCount: trainPairsGen8,
        reg,
        frame,
        rulePackage,
      });

      const vsR4 = evaluateHeadToHead({
        candidateName: ind.metadata?.name ?? `G${gen}-Ind${idx}`,
        opponentName: "Work 5-1 R4",
        createCandidate: (seat) => new Gen9LearnableTacticalPolicy(ind, `Cand-${seat}`, tacticalEvaluator),
        createOpponent: (seat) => new Gen9TacticalPrototypePolicy(gen8DNA, `R4-${seat}`, tacticalEvaluator),
        seedStart: genSeedBase + 20,
        pairsCount: trainPairsR4,
        reg,
        frame,
        rulePackage,
      });

      const vsGen7 = evaluateHeadToHead({
        candidateName: ind.metadata?.name ?? `G${gen}-Ind${idx}`,
        opponentName: "Official Gen 7 Champion",
        createCandidate: (seat) => new Gen9LearnableTacticalPolicy(ind, `Cand-${seat}`, tacticalEvaluator),
        createOpponent: (seat) => new GenomePolicy(gen7DNA, `Gen7-${seat}`),
        seedStart: genSeedBase + 40,
        pairsCount: trainPairsGen7,
        reg,
        frame,
        rulePackage,
      });

      const vsRand = evaluateHeadToHead({
        candidateName: ind.metadata?.name ?? `G${gen}-Ind${idx}`,
        opponentName: "SeededRandom",
        createCandidate: (seat) => new Gen9LearnableTacticalPolicy(ind, `Cand-${seat}`, tacticalEvaluator),
        createOpponent: (seat, seed) =>
          new RandomPolicy(new SeededRandom(seed + (seat === "p1" ? 101 : 202)), `Rand-${seat}`),
        seedStart: genSeedBase + 60,
        pairsCount: trainPairsRand,
        reg,
        frame,
        rulePackage,
      });

      // 多目的適応度: Gen 8 勝率 (45%) + R4 勝率 (25%) + Gen 7 勝率 (20%) + Random 勝率 (10%)
      const fitnessScore = Number(
        (
          0.45 * vsGen8.pairScorePct +
          0.25 * vsR4.pairScorePct +
          0.20 * vsGen7.pairScorePct +
          0.10 * vsRand.pairScorePct
        ).toFixed(2)
      );

      const totalWins = vsGen8.wins + vsR4.wins + vsGen7.wins + vsRand.wins;
      const totalMatches =
        vsGen8.totalMatches + vsR4.totalMatches + vsGen7.totalMatches + vsRand.totalMatches;
      const totalExceptions =
        vsGen8.exceptions + vsR4.exceptions + vsGen7.exceptions + vsRand.exceptions;
      const avgTimeUs = Number(
        (
          (vsGen8.avgCandidateTimeUsPerDecision +
            vsR4.avgCandidateTimeUsPerDecision +
            vsGen7.avgCandidateTimeUsPerDecision +
            vsRand.avgCandidateTimeUsPerDecision) /
          4
        ).toFixed(2)
      );

      const rec: IndividualEvalRecord = {
        individualId: ind.metadata?.id ?? `g${gen}-ind${idx}`,
        individualName: ind.metadata?.name ?? `G${gen}-Ind${idx}`,
        generation: gen,
        tacticalWeights: [...ind.tacticalWeights],
        fitnessScore,
        overallWinRatePct: Number(((totalWins / totalMatches) * 100).toFixed(2)),
        vsGen8WinRatePct: vsGen8.legWinRatePct,
        vsR4WinRatePct: vsR4.legWinRatePct,
        vsGen7WinRatePct: vsGen7.legWinRatePct,
        vsRandomWinRatePct: vsRand.legWinRatePct,
        totalMatches,
        totalExceptions,
        avgTimeUsPerDecision: avgTimeUs,
        evalWallTimeMs: Number((performance.now() - indStartMs).toFixed(1)),
      };

      genRecords.push(rec);
      genExceptions += totalExceptions;
      genMatches += totalMatches;
    }

    // 適応度順ソート (同点時は vsGen8WinRatePct 優先)
    genRecords.sort((a, b) => {
      if (b.fitnessScore !== a.fitnessScore) return b.fitnessScore - a.fitnessScore;
      return b.vsGen8WinRatePct - a.vsGen8WinRatePct;
    });

    const bestRec = genRecords[0];
    const bestGenomeInGen = population.find((g) => g.metadata?.id === bestRec.individualId)!;
    if (!globalBestRecord || bestRec.fitnessScore >= globalBestRecord.fitnessScore) {
      globalBestRecord = bestRec;
      globalBestGenome = cloneTacticalGenome(bestGenomeInGen);
    }

    const genWallTimeMs = Number((performance.now() - genStartMs).toFixed(1));
    const meanFitness = Number(
      (genRecords.reduce((acc, r) => acc + r.fitnessScore, 0) / genRecords.length).toFixed(2)
    );

    const genLog: GenerationTelemetry = {
      generation: gen,
      trainingSeedRange: `${genSeedBase}-${genSeedBase + 60 + trainPairsRand - 1}`,
      matchesPerIndividual: genRecords[0].totalMatches,
      totalGenerationMatches: genMatches,
      generationWallTimeMs: genWallTimeMs,
      exceptionRatePct: Number(((genExceptions / Math.max(1, genMatches)) * 100).toFixed(4)),
      bestIndividualId: bestRec.individualId,
      bestFitnessScore: bestRec.fitnessScore,
      bestOverallWinRatePct: bestRec.overallWinRatePct,
      bestVsGen8WinRatePct: bestRec.vsGen8WinRatePct,
      bestVsR4WinRatePct: bestRec.vsR4WinRatePct,
      meanPopulationFitness: meanFitness,
      rankings: genRecords,
    };
    generationLogs.push(genLog);

    console.log(
      `  [Gen ${gen}] Best=${bestRec.individualId} | Fitness=${bestRec.fitnessScore.toFixed(2)} (Mean=${meanFitness.toFixed(2)}) | vsGen8=${bestRec.vsGen8WinRatePct.toFixed(1)}%, vsR4=${bestRec.vsR4WinRatePct.toFixed(1)}%, vsGen7=${bestRec.vsGen7WinRatePct.toFixed(1)}%, vsRand=${bestRec.vsRandomWinRatePct.toFixed(1)}% | Time=${(genWallTimeMs / 1000).toFixed(1)}s | Exceptions=${genExceptions}`
    );

    // 次世代の生成 (最終世代以外): 上位3個体エリート保存 + 5個体を交叉・突然変異で生成
    if (gen < numGenerations - 1) {
      const elites = genRecords
        .slice(0, 3)
        .map((r) => cloneTacticalGenome(population.find((g) => g.metadata?.id === r.individualId)!));
      const nextPop: Gen9TacticalGenome[] = [...elites];
      const sigma = 0.18 * Math.pow(0.8, gen);

      while (nextPop.length < popSize) {
        const pAIdx = Math.floor(breedRng.next() * 3);
        const pBIdx = Math.floor(breedRng.next() * 4);
        const pA = population.find((g) => g.metadata?.id === genRecords[pAIdx].individualId)!;
        const pB = population.find((g) => g.metadata?.id === genRecords[pBIdx].individualId)!;
        const child = breedOffspring(pA, pB, breedRng, gen + 1, nextPop.length, sigma);
        nextPop.push(child);
      }
      population = nextPop;
    }
  }

  // ===========================================================================
  // STEP 3: 独立 Validation 比較 (Seeds 720001〜720050, 50ペア = 100試合/対戦相手)
  // ===========================================================================
  const valSeedStart = 720001;
  const valPairs = 50; // 100 matches per opponent (seat-swapped)
  console.log(
    `\n[Step 3] 独立 Validation 評価 (Seeds: ${valSeedStart}〜${valSeedStart + valPairs - 1}, 各${valPairs}ペア=${valPairs * 2}試合, Training Seed と完全分離)`
  );
  console.log(`  選定最良個体: ${globalBestRecord!.individualId} (${globalBestRecord!.individualName})`);

  // 3-A. Gen9-Pilot-Best の独立 Validation
  const valBestVsGen8 = evaluateHeadToHead({
    candidateName: "Gen9-Pilot-Best (Learned v7)",
    opponentName: "Gen 8 Champion Candidate",
    createCandidate: (seat) =>
      new Gen9LearnableTacticalPolicy(globalBestGenome, `Gen9Best-${seat}`, tacticalEvaluator),
    createOpponent: (seat) => new GenomePolicy(gen8DNA, `Gen8-${seat}`),
    seedStart: valSeedStart,
    pairsCount: valPairs,
    reg,
    frame,
    rulePackage,
  });

  const valBestVsR4 = evaluateHeadToHead({
    candidateName: "Gen9-Pilot-Best (Learned v7)",
    opponentName: "Work 5-1 R4 (Generic DSL)",
    createCandidate: (seat) =>
      new Gen9LearnableTacticalPolicy(globalBestGenome, `Gen9Best-${seat}`, tacticalEvaluator),
    createOpponent: (seat) => new Gen9TacticalPrototypePolicy(gen8DNA, `R4-${seat}`, tacticalEvaluator),
    seedStart: valSeedStart,
    pairsCount: valPairs,
    reg,
    frame,
    rulePackage,
  });

  const valBestVsGen7 = evaluateHeadToHead({
    candidateName: "Gen9-Pilot-Best (Learned v7)",
    opponentName: "Official Gen 7 Champion",
    createCandidate: (seat) =>
      new Gen9LearnableTacticalPolicy(globalBestGenome, `Gen9Best-${seat}`, tacticalEvaluator),
    createOpponent: (seat) => new GenomePolicy(gen7DNA, `Gen7-${seat}`),
    seedStart: valSeedStart,
    pairsCount: valPairs,
    reg,
    frame,
    rulePackage,
  });

  const valBestVsRand = evaluateHeadToHead({
    candidateName: "Gen9-Pilot-Best (Learned v7)",
    opponentName: "SeededRandom",
    createCandidate: (seat) =>
      new Gen9LearnableTacticalPolicy(globalBestGenome, `Gen9Best-${seat}`, tacticalEvaluator),
    createOpponent: (seat, seed) =>
      new RandomPolicy(new SeededRandom(seed + (seat === "p1" ? 11 : 22)), `Rand-${seat}`),
    seedStart: valSeedStart,
    pairsCount: valPairs,
    reg,
    frame,
    rulePackage,
  });

  // 3-B. 同一 Validation Seeds (720001〜720050) における Work 5-1 R4 の成績（厳密な Apple-to-Apple 比較用）
  const valR4VsGen8 = evaluateHeadToHead({
    candidateName: "Work 5-1 R4 (Generic DSL)",
    opponentName: "Gen 8 Champion Candidate",
    createCandidate: (seat) => new Gen9TacticalPrototypePolicy(gen8DNA, `R4-${seat}`, tacticalEvaluator),
    createOpponent: (seat) => new GenomePolicy(gen8DNA, `Gen8-${seat}`),
    seedStart: valSeedStart,
    pairsCount: valPairs,
    reg,
    frame,
    rulePackage,
  });

  const valR4VsGen7 = evaluateHeadToHead({
    candidateName: "Work 5-1 R4 (Generic DSL)",
    opponentName: "Official Gen 7 Champion",
    createCandidate: (seat) => new Gen9TacticalPrototypePolicy(gen8DNA, `R4-${seat}`, tacticalEvaluator),
    createOpponent: (seat) => new GenomePolicy(gen7DNA, `Gen7-${seat}`),
    seedStart: valSeedStart,
    pairsCount: valPairs,
    reg,
    frame,
    rulePackage,
  });

  const valR4VsRand = evaluateHeadToHead({
    candidateName: "Work 5-1 R4 (Generic DSL)",
    opponentName: "SeededRandom",
    createCandidate: (seat) => new Gen9TacticalPrototypePolicy(gen8DNA, `R4-${seat}`, tacticalEvaluator),
    createOpponent: (seat, seed) =>
      new RandomPolicy(new SeededRandom(seed + (seat === "p1" ? 11 : 22)), `Rand-${seat}`),
    seedStart: valSeedStart,
    pairsCount: valPairs,
    reg,
    frame,
    rulePackage,
  });

  console.log("\n--- [Validation Result: Gen9-Pilot-Best] ---");
  for (const v of [valBestVsGen8, valBestVsR4, valBestVsGen7, valBestVsRand]) {
    console.log(
      `  * ${v.candidateName} vs ${v.opponentName}: ${v.wins}W-${v.losses}L-${v.draws}D | 勝率=${v.legWinRatePct.toFixed(1)}% (95%CI: [${v.legWinRateCI95.lowerPct.toFixed(1)}%, ${v.legWinRateCI95.upperPct.toFixed(1)}%]) | PairScore=${v.pairScorePct.toFixed(1)}% (±${v.pairScoreCI95.halfWidthPct.toFixed(1)}%) | P1=${v.p1WinRatePct.toFixed(1)}%, P2=${v.p2WinRatePct.toFixed(1)}%`
    );
  }

  console.log("\n--- [Validation Result: Work 5-1 R4 (同一Seed比較基準)] ---");
  for (const v of [valR4VsGen8, valR4VsGen7, valR4VsRand]) {
    console.log(
      `  * ${v.candidateName} vs ${v.opponentName}: ${v.wins}W-${v.losses}L-${v.draws}D | 勝率=${v.legWinRatePct.toFixed(1)}% (95%CI: [${v.legWinRateCI95.lowerPct.toFixed(1)}%, ${v.legWinRateCI95.upperPct.toFixed(1)}%]) | PairScore=${v.pairScorePct.toFixed(1)}% (±${v.pairScoreCI95.halfWidthPct.toFixed(1)}%) | P1=${v.p1WinRatePct.toFixed(1)}%, P2=${v.p2WinRatePct.toFixed(1)}%`
    );
  }

  // Schema v6 互換フォーマットへの変換検証
  const v6CompatDNA = toV6CompatibleDNA(globalBestGenome);
  DecisionDNACodec.validate(v6CompatDNA);

  const overallWallTimeMs = Number((performance.now() - overallStartMs).toFixed(1));

  const namedLearnedWeights = TACTICAL_FEATURE_NAMES.map((name, i) => ({
    index: i,
    featureName: name,
    category: TACTICAL_FEATURE_CATEGORY_MAP[name],
    r4PresetWeight: R4_PRESET_TACTICAL_WEIGHTS[i],
    learnedBestWeight: globalBestGenome.tacticalWeights[i],
    deltaFromR4: Number((globalBestGenome.tacticalWeights[i] - R4_PRESET_TACTICAL_WEIGHTS[i]).toFixed(4)),
  }));

  const report = {
    workId: "BP-SIM-AI-GEN9-PILOT-EVOLUTION-WORK5-2",
    baseCommitSha: currentHeadSha,
    r1ReferenceCommitSha: R1_COMMIT_SHA,
    generatedAt: new Date().toISOString(),
    overallWallTimeMs,
    seedSeparation: {
      baselineSeeds: `${baselineSeedStart}-${baselineSeedStart + baselinePairs - 1}`,
      trainingSeeds: "710001-710303",
      validationSeeds: `${valSeedStart}-${valSeedStart + valPairs - 1}`,
      protectedHoldoutsUntouched: FORBIDDEN_SEED_RANGES,
    },
    architecture: {
      tacticalSchemaVersion: 7,
      baseSchemaVersion: 6,
      baseParameterCount:
        gen8DNA.patternWeights.length + gen8DNA.contextPatternWeights.length,
      tacticalFeatureDimension: TACTICAL_FEATURE_DIMENSION,
      categories: [
        "CERTAIN_DAMAGE",
        "ESTIMATED_DAMAGE",
        "COUNTER_PREVENTION",
        "COMBAT_OUTCOME",
        "SURVIVAL",
        "LETHAL_OPPORTUNITY",
      ],
      namedLearnedWeights,
    },
    baselineResults: {
      r4VsGen8: baselineR4vsGen8,
      r1VsGen8: baselineR1vsGen8,
      r4VsR1: baselineR4vsR1,
      r4VsGen7: baselineR4vsGen7,
      gen8VsGen7: baselineGen8vsGen7,
    },
    pilotEvolution: {
      populationSize: popSize,
      generations: numGenerations,
      matchesPerIndividualPerGeneration: 68,
      totalTrainingMatches: generationLogs.reduce((acc, g) => acc + g.totalGenerationMatches, 0),
      bestIndividual: globalBestRecord,
      generationLogs,
    },
    independentValidation: {
      gen9PilotBest: {
        vsGen8: valBestVsGen8,
        vsR4: valBestVsR4,
        vsGen7: valBestVsGen7,
        vsRandom: valBestVsRand,
      },
      r4BaselineOnSameValidationSeeds: {
        vsGen8: valR4VsGen8,
        vsGen7: valR4VsGen7,
        vsRandom: valR4VsRand,
      },
    },
  };

  const outPath = path.resolve(".artifacts/gen9-work5-2-pilot-results.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf-8");
  console.log(`\n=> Work 5-2 パイロット実験結果JSON保存完了: ${outPath}`);
}

main().catch((err) => {
  console.error("Pilot evolution failed:", err);
  process.exit(1);
});
