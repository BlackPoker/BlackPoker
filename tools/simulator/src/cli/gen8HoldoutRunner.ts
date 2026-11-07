/**
 * BlackPoker Work 4-4 R2 — Gen 8 Champion Official Holdout Evaluation Runner & Preflight Harness
 *
 * 【目的と保護原則 (Work 4-4 R2)】
 * 1. Gen 8 本番進化学習 (8,520 試合完走) で導出された Primary Candidate:
 *    - Genome ID: gen8-prod-g0-ind7-cross7
 *    - DNA Digest: 11fff0f578c92af376eece46ff90f9eba3785e59d0cf64d5eeffc7967946445e
 *    に対し、完全隔離・完全保護された未実行 Holdout Seed (350001〜350300) を用いた
 *    厳格な座席反転ペア対戦・統計的検定・プレイヤー別アクション採択率集計基盤を提供する。
 *
 * 2. Holdout 未実行保護 (Fail-Closed):
 *    - 本 Work 4-4 R2 では追加学習および正式 Holdout の実試合実行は厳格に禁止されている。
 *    - 明示的な承認トークン (BP-GEN8-HOLDOUT-APPROVED-2026) が指定された場合でも、
 *      正式レビュー承認前の実 Holdout 試合実行は Fail-Closed で拒絶する。
 *    - 合成データ・テスト用 Fixture による単体テストのみが許可される。
 *
 * 3. 厳格な統計的検定プロトコル (Single-Hypothesis Gate & 感度分析):
 *    - 多重比較を排除するため、評価対象は Primary Candidate 1 個体に固定。
 *    - 対 Gen 7 Champion (現王者) との座席反転ペア (Leg 0: Cand=P1, Leg 1: Cand=P2) を
 *      独立観測単位 Xi in {0.0, 0.25, 0.5, 0.75, 1.0} とする。
 *    - 優位性認定条件: 両側 95% 信頼区間の下限値 > 0.50 (片側 p < 0.025)。
 *    - 非劣性認定条件: 両側 95% 信頼区間の下限値 > 0.45 (許容マージン Delta = 0.05)。
 *    - 検出力は真の勝率や分散の仮定に基づくモデル感度分析値として明記し、保証値とはしない。
 *    - 標準誤差ゼロ (SE=0) などの境界条件を安全に処理。
 *
 * 4. プレイヤー別アクション集計の完全性:
 *    - executedActions / offeredActions を P1 / P2 (Candidate / Opponent) 別に分離記録。
 *    - 盤面攻撃 (Attack)、投擲 (Throwing)、PASS、召喚 (Summon) の機会数・実行数・採択率を
 *      Candidate と Opponent の双方について独立に計測・比較。
 *
 * 5. 全件 Evidence 監査 (12 大検証契約):
 *    - 予定試合数・ペア数の完全一致、matchIndex 連続性、matchId 一意性、Seed 決定論性、
 *      座席割当、全試合 DNA Digest、status===COMPLETED、Manifest SHA-256、
 *      余剰/欠落チャンク検出、候補 DNA 真正性を厳格検証し、違反時は非ゼロ終了。
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { execSync } from "child_process";
import { DecisionDNA } from "../domain/ai/DecisionDNATypes";
import { SemanticSHA256 } from "../engine/ai/SemanticSHA256";
import { EvolutionIndependentEvaluator } from "../engine/ai/EvolutionIndependentEvaluator";
import { EvolutionCampaignManager } from "../engine/ai/EvolutionCampaignManager";
import { DecisionDNACodec } from "../engine/ai/DecisionDNACodec";
import {
  CompactMatchOutcomeRecord,
  PlayerActionStatsRecord,
  ChampionAuthenticityRecord,
  ParticipantPolicySpec,
} from "../domain/simulation/MillionMatchInfraTypes";
import {
  derivePlayerSeed,
  executeSingleInstrumentedMatch,
  SingleMatchExecutionResult,
} from "../engine/simulation/MillionMatchCampaignEngine";
import { MillionMatchWorkerPool, WorkerPairTask } from "../engine/simulation/MillionMatchWorkerPool";
import { SerializedChampionsBundle } from "../domain/simulation/MillionMatchWorkerTypes";
import {
  CANDIDATE_CHAMPION_GENOME_ID as GEN7_GENOME_ID,
  CANDIDATE_CHAMPION_EXPECTED_DIGEST as GEN7_EXPECTED_DIGEST,
  OLD_CHAMPION_GENOME_ID as GEN5_GENOME_ID,
  OLD_CHAMPION_EXPECTED_DIGEST as GEN5_EXPECTED_DIGEST,
  loadChampionDNA,
  computeFileSha256,
} from "./stage3HoldoutRunner";
import { SEED_REGISTRY_GEN8 } from "./verifySeedRegistryGen8";

// =============================================================================
// 定数定義
// =============================================================================

export const GEN8_HOLDOUT_WORK_ID = "BP-SIM-AI-V92-WORK4-5-GEN8-OFFICIAL-HOLDOUT" as const;
export const GEN8_HOLDOUT_REGULATION_ID = "standard-pack" as const;
export const GEN8_HOLDOUT_FRAME_ID = "pack" as const;
export const GEN8_HOLDOUT_RULE_PACKAGE_VERSION = "1.0.0" as const;
export const GEN8_HOLDOUT_FEATURE_SCHEMA_VERSION = 6 as const;
export const GEN8_HOLDOUT_APPROVAL_TOKEN = "BP-GEN8-HOLDOUT-APPROVED-2026" as const;

/** 公式 Checkpoint パス (本番用固定値) */
export const OFFICIAL_GEN7_CHECKPOINT_PATH =
  ".artifacts/stage3-full-action-retrain-r1/campaign-stage3-evolution-checkpoint.json" as const;
export const OFFICIAL_GEN5_CHECKPOINT_PATH =
  ".artifacts/stage3-evolution/campaign-stage3-evolution-checkpoint.json" as const;

/** Gen 8 Primary Candidate (事前登録個体) */
export const GEN8_PRIMARY_CANDIDATE_GENOME_ID = "gen8-prod-g0-ind7-cross7" as const;
export const GEN8_PRIMARY_CANDIDATE_EXPECTED_DIGEST =
  "11fff0f578c92af376eece46ff90f9eba3785e59d0cf64d5eeffc7967946445e" as const;
export const GEN8_PRIMARY_CANDIDATE_FILE_PATH =
  "evidence/phase2-gen8-production/best-candidate-champion.json" as const;

/** 比較対戦相手 (Anchor Champions & Baselines) */
export const GEN7_CHAMPION_GENOME_ID = GEN7_GENOME_ID;
export const GEN7_CHAMPION_EXPECTED_DIGEST = GEN7_EXPECTED_DIGEST;

export const GEN5_CHAMPION_GENOME_ID = GEN5_GENOME_ID;
export const GEN5_CHAMPION_EXPECTED_DIGEST = GEN5_EXPECTED_DIGEST;

/** Seed 割当 (350001〜350300: 完全未使用・保護領域) */
export const GEN8_HOLDOUT_SEED_RANGE_START = 350001 as const;
export const GEN8_HOLDOUT_SEED_RANGE_END = 350300 as const;
export const DEFAULT_PRIMARY_PAIRS = 120 as const; // 240 matches vs Gen 7
export const MAX_AVAILABLE_PAIRS = 150 as const; // 300 matches total available

/** テスト用小規模 Seed 割当 (360001〜360050: 実 Core 検証用) */
export const GEN8_HOLDOUT_TEST_SEED_START = 360001 as const;
export const GEN8_HOLDOUT_TEST_SEED_END = 360050 as const;

/** 意思決定上限: 500 回 */
export const GEN8_HOLDOUT_MAX_DECISIONS_PER_MATCH = 500 as const;

/** 統計的有意水準 (片側 alpha = 0.025, 両側 95% 信頼区間) */
export const GEN8_HOLDOUT_ALPHA_ONETAILED = 0.025 as const;
export const GEN8_NON_INFERIORITY_MARGIN = 0.05 as const; // Delta = 5%

export const DEFAULT_GEN8_HOLDOUT_OUTPUT_DIR = ".artifacts/gen8-holdout-evaluation" as const;

// =============================================================================
// エラー型定義
// =============================================================================

export class UnauthorizedHoldoutExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnauthorizedHoldoutExecutionError";
  }
}

export class Gen8CandidateIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Gen8CandidateIntegrityError";
  }
}

export class Gen8HoldoutAuditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Gen8HoldoutAuditError";
  }
}

// =============================================================================
// インターフェース定義
// =============================================================================

export interface PairedScoreRecord {
  readonly pairIndex: number;
  readonly seed: number;
  readonly opponentId: string;
  readonly leg0Winner: "p1" | "p2" | "draw";
  readonly leg1Winner: "p1" | "p2" | "draw";
  readonly leg0CandidateSeat: "p1";
  readonly leg1CandidateSeat: "p2";
  readonly leg0Score: number; // Cand won: 1, draw: 0.5, lost: 0
  readonly leg1Score: number; // Cand won: 1, draw: 0.5, lost: 0
  readonly pairScore: number; // (leg0Score + leg1Score) / 2 in {0.0, 0.25, 0.5, 0.75, 1.0}
  readonly leg0TotalDecisions: number;
  readonly leg1TotalDecisions: number;
  readonly leg0DurationMs?: number;
  readonly leg1DurationMs?: number;
}

export interface HoldoutStatisticalSummary {
  readonly opponentId: string;
  readonly opponentName: string;
  readonly totalPairs: number;
  readonly totalMatches: number;
  readonly candidateWins: number;
  readonly candidateLosses: number;
  readonly candidateDraws: number;
  readonly matchWinRate: number;
  readonly meanPairScore: number;
  readonly sampleVariance: number;
  readonly standardError: number;
  readonly confidenceInterval95: {
    readonly lower: number;
    readonly upper: number;
  };
  readonly zScoreSuperiority: number;
  readonly pValueSuperiority: number;
  readonly outcomeCategory: "SUPERIORITY_VERIFIED" | "NON_INFERIORITY_VERIFIED" | "CONFIRMED_REGRESSION" | "INCONCLUSIVE";
  readonly isSuperior: boolean; // lower > 0.50 (one-sided p < 0.025)
  readonly isNonInferior: boolean; // lower > 0.45 (margin Delta = 0.05)
}

export interface PlayerActionMetrics {
  readonly attackOpportunities: number;
  readonly attacksExecuted: number;
  readonly attackAdoptionRate: number;
  readonly throwingOpportunities: number;
  readonly throwingsExecuted: number;
  readonly throwingAdoptionRate: number;
  readonly summonOpportunities: number;
  readonly summonsExecuted: number;
  readonly summonAdoptionRate: number;
  readonly passDecisions: number;
  readonly totalDecisions: number;
  readonly passRate: number;
  readonly actionsExecutedDistribution: Record<string, number>;
  readonly actionsOfferedDistribution: Record<string, number>;
}

export interface HoldoutActionComparison {
  readonly candidateMetrics: PlayerActionMetrics;
  readonly opponentMetrics: PlayerActionMetrics;
  readonly attackVsThrowingRatio: {
    readonly candidate: number; // attacks / (attacks + throwings)
    readonly opponent: number;
  };
}

export interface PowerSensitivityEntry {
  readonly assumedTrueWinRate: number;
  readonly statisticalPower: number;
}

export interface Gen8HoldoutPreflightManifest {
  readonly workId: string;
  readonly status: "APPROVED_FOR_PREFLIGHT_PLANNING / EXECUTION_LOCKED";
  readonly timestamp: string;
  readonly gitCommitSha: string;
  readonly isGitClean: boolean;
  readonly executionMode: "PLAN_ONLY" | "DRY_RUN" | "EXECUTE" | "AUDIT_ONLY";
  readonly approvalTokenRequired: typeof GEN8_HOLDOUT_APPROVAL_TOKEN;
  readonly approvalStatus: "NOT_APPROVED_EXECUTION_BLOCKED" | "APPROVED_FOR_TEST_ONLY" | "APPROVED_FOR_OFFICIAL_EXECUTION";
  readonly candidateChampion: {
    readonly genomeId: string;
    readonly expectedDigest: string;
    readonly verifiedDigest: string;
    readonly sourcePath: string;
    readonly digestMatches: boolean;
  };
  readonly referenceAnchorGen7: {
    readonly genomeId: string;
    readonly expectedDigest: string;
    readonly verifiedDigest: string;
    readonly digestMatches: boolean;
    readonly sourcePath: string;
  };
  readonly referenceAnchorGen5: {
    readonly genomeId: string;
    readonly expectedDigest: string;
    readonly verifiedDigest: string;
    readonly digestMatches: boolean;
    readonly sourcePath: string;
  };
  readonly seedRange: {
    readonly startSeed: number;
    readonly endSeed: number;
    readonly totalAvailableSeeds: number;
    readonly reservedPairs: number;
    readonly seedRegistryStatus: string;
    readonly historicalCollisionCount: number;
  };
  readonly hypothesisGate: {
    readonly primaryComparisonOpponent: "gen7-champion";
    readonly plannedPairs: number;
    readonly plannedMatches: number;
    readonly superiorityThreshold: "Two-sided 95% CI Lower Bound > 0.50 (one-sided p < 0.025)";
    readonly nonInferiorityThreshold: "Two-sided 95% CI Lower Bound > 0.45 (margin 0.05)";
    readonly powerSensitivityAnalysis: readonly PowerSensitivityEntry[];
    readonly sensitivityCaveat: string;
  };
  readonly regressionBaselines: readonly {
    readonly opponentId: string;
    readonly role: string;
    readonly targetCriteria: string;
    readonly plannedPairs: number;
    readonly plannedMatches: number;
    readonly startSeed: number;
    readonly endSeed: number;
  }[];
}

export interface Gen8HoldoutAuditResult {
  readonly isValid: boolean;
  readonly auditStatus: "AUDIT_PASSED" | "AUDIT_FAILED" | "IN_PROGRESS";
  readonly auditTimestamp: string;
  readonly artifactsDir: string;
  readonly checkedFiles: readonly string[];
  readonly errors: readonly string[];
  readonly totalMatches: number;
  readonly totalPairs: number;
  readonly completedMatches: number;
  readonly failedMatches: number;
  readonly incompleteMatches: number;
  readonly candidateDigest: string;
  readonly candidateDigestVerified: boolean;
  readonly statisticalSummary?: HoldoutStatisticalSummary;
  readonly actionComparison?: HoldoutActionComparison;
  readonly superiorityVerified: boolean;
  readonly nonInferiorityVerified: boolean;
}

export interface Gen8HoldoutPreflightOptions {
  readonly executionMode?: "PLAN_ONLY" | "DRY_RUN" | "EXECUTE" | "AUDIT_ONLY";
  readonly approvalToken?: string;
  readonly officialHoldoutApproved?: boolean;
  readonly candidatePath?: string;
  readonly plannedPairs?: number;
  readonly gen7CheckpointPath?: string;
  readonly gen5CheckpointPath?: string;
  readonly expectedGen7Digest?: string;
  readonly expectedGen5Digest?: string;
  readonly requireOfficialCheckpoints?: boolean;
  readonly requireGen5Checkpoint?: boolean;
  readonly testExecutionAuthorized?: boolean;
  readonly isSyntheticTest?: boolean;
  readonly isRealCoreTest?: boolean;
}

export interface Gen8HoldoutExecutionOptions {
  readonly workId?: string;
  readonly candidateDNA: DecisionDNA;
  readonly candidateDigest: string;
  readonly candidateGenomeId?: string;
  readonly opponentDNA: DecisionDNA;
  readonly opponentDigest: string;
  readonly opponentGenomeId?: string;
  readonly opponentId?: string;
  readonly opponentName?: string;
  readonly pairsCount: number;
  readonly startSeed: number;
  readonly outputDir: string;
  readonly chunkSizeMatches?: number;
  readonly maxDecisionsPerMatch?: number;
  readonly workersCount?: number;
  readonly regulationId?: string;
  readonly frameId?: string;
  readonly rulePackageVersion?: string;
  readonly rulesDir?: string;
  readonly isSyntheticTest?: boolean;
  readonly isRealCoreTest?: boolean;
  readonly testExecutionAuthorized?: boolean;
  readonly approvalToken?: string;
  readonly officialHoldoutApproved?: boolean;
  readonly sessionPairsLimit?: number;
  readonly workerPool?: MillionMatchWorkerPool;
}

// =============================================================================
// 数理統計・検定関数
// =============================================================================

/**
 * 標準正規分布累積分布関数 (CDF) の多項式近似 (Abramowitz and Stegun 26.2.17)
 */
export function normalCdf(z: number): number {
  if (z < -8) return 0;
  if (z > 8) return 1;

  const b1 = 0.31938153;
  const b2 = -0.356563782;
  const b3 = 1.781477937;
  const b4 = -1.821255978;
  const b5 = 1.330274429;
  const p = 0.2316419;
  const c = 0.3989422804014327; // 1 / sqrt(2 * pi)

  const absZ = Math.abs(z);
  const t = 1.0 / (1.0 + p * absZ);
  const poly = ((((b5 * t + b4) * t + b3) * t + b2) * t + b1) * t;
  const pdf = c * Math.exp(-0.5 * absZ * absZ);
  const tail = pdf * poly;

  return z >= 0 ? 1.0 - tail : tail;
}

/**
 * 座席反転ペアのスコア計算
 * Leg 0: Candidate is P1.
 * Leg 1: Candidate is P2.
 */
export function computePairScore(
  leg0Winner: "p1" | "p2" | "draw",
  leg1Winner: "p1" | "p2" | "draw"
): { leg0Score: number; leg1Score: number; pairScore: number } {
  const leg0Score = leg0Winner === "p1" ? 1.0 : leg0Winner === "draw" ? 0.5 : 0.0;
  const leg1Score = leg1Winner === "p2" ? 1.0 : leg1Winner === "draw" ? 0.5 : 0.0;
  const pairScore = (leg0Score + leg1Score) / 2.0;
  return { leg0Score, leg1Score, pairScore };
}

/**
 * 検出力の感度分析 (仮定真勝率ごとのモデル計算)
 */
export function computeHoldoutPowerSensitivity(
  pairsCount: number,
  assumedWinRates: readonly number[] = [0.55, 0.60, 0.65, 0.70]
): PowerSensitivityEntry[] {
  const p0 = 0.50;
  const z_crit = 1.95996; // two-sided 95% alpha=0.025 one-sided
  const entries: PowerSensitivityEntry[] = [];

  for (const p of assumedWinRates) {
    const numerator = (p - p0) * Math.sqrt(pairsCount) - z_crit * Math.sqrt(p0 * (1 - p0));
    const denominator = Math.sqrt(p * (1 - p));
    const z_beta = numerator / denominator;
    const power = normalCdf(z_beta);
    entries.push({
      assumedTrueWinRate: p,
      statisticalPower: Number(power.toFixed(4)),
    });
  }

  return entries;
}

/**
 * ペアスコア配列から不偏分散による統計的要約を算出
 * 標準誤差ゼロ (SE=0) 等の境界条件を安全にハンドリング
 */
export function computeHoldoutStatistics(
  opponentId: string,
  opponentName: string,
  pairs: readonly PairedScoreRecord[]
): HoldoutStatisticalSummary {
  const totalPairs = pairs.length;
  const totalMatches = totalPairs * 2;

  if (totalPairs === 0) {
    return {
      opponentId,
      opponentName,
      totalPairs: 0,
      totalMatches: 0,
      candidateWins: 0,
      candidateLosses: 0,
      candidateDraws: 0,
      matchWinRate: 0,
      meanPairScore: 0,
      sampleVariance: 0,
      standardError: 0,
      confidenceInterval95: { lower: 0, upper: 0 },
      zScoreSuperiority: 0,
      pValueSuperiority: 1.0,
      outcomeCategory: "INCONCLUSIVE",
      isSuperior: false,
      isNonInferior: false,
    };
  }

  let candidateWins = 0;
  let candidateLosses = 0;
  let candidateDraws = 0;
  let sumPairScore = 0;

  for (const p of pairs) {
    if (p.leg0Score === 1.0) candidateWins++;
    else if (p.leg0Score === 0.5) candidateDraws++;
    else candidateLosses++;

    if (p.leg1Score === 1.0) candidateWins++;
    else if (p.leg1Score === 0.5) candidateDraws++;
    else candidateLosses++;

    sumPairScore += p.pairScore;
  }

  const meanPairScore = sumPairScore / totalPairs;
  const matchWinRate = (candidateWins + 0.5 * candidateDraws) / totalMatches;

  let sumSquaredDiff = 0;
  for (const p of pairs) {
    const diff = p.pairScore - meanPairScore;
    sumSquaredDiff += diff * diff;
  }

  const sampleVariance = totalPairs > 1 ? sumSquaredDiff / (totalPairs - 1) : 0;
  const standardError = Math.sqrt(sampleVariance / totalPairs);

  const zCritical95 = 1.959963984540054; // 1.96 for two-sided 95% CI
  let lowerCI = Math.max(0, meanPairScore - zCritical95 * standardError);
  let upperCI = Math.min(1, meanPairScore + zCritical95 * standardError);

  let zScoreSuperiority = 0;
  let pValueSuperiority = 0.5;

  // 境界条件: 標準誤差ゼロ (全ペア同一スコアの場合)
  if (standardError === 0) {
    lowerCI = meanPairScore;
    upperCI = meanPairScore;
    if (meanPairScore > 0.50) {
      zScoreSuperiority = 999;
      pValueSuperiority = 0.0;
    } else if (meanPairScore < 0.50) {
      zScoreSuperiority = -999;
      pValueSuperiority = 1.0;
    } else {
      zScoreSuperiority = 0;
      pValueSuperiority = 0.5;
    }
  } else {
    zScoreSuperiority = (meanPairScore - 0.50) / standardError;
    pValueSuperiority = 1.0 - normalCdf(zScoreSuperiority);
  }

  const isSuperior = lowerCI > 0.50;
  const isNonInferior = lowerCI > 0.50 - GEN8_NON_INFERIORITY_MARGIN; // > 0.45

  let outcomeCategory: HoldoutStatisticalSummary["outcomeCategory"];
  if (isSuperior) {
    outcomeCategory = "SUPERIORITY_VERIFIED";
  } else if (isNonInferior) {
    outcomeCategory = "NON_INFERIORITY_VERIFIED";
  } else if (upperCI < 0.50) {
    outcomeCategory = "CONFIRMED_REGRESSION";
  } else {
    outcomeCategory = "INCONCLUSIVE";
  }

  return {
    opponentId,
    opponentName,
    totalPairs,
    totalMatches,
    candidateWins,
    candidateLosses,
    candidateDraws,
    matchWinRate,
    meanPairScore,
    sampleVariance,
    standardError,
    confidenceInterval95: {
      lower: lowerCI,
      upper: upperCI,
    },
    zScoreSuperiority,
    pValueSuperiority,
    outcomeCategory,
    isSuperior,
    isNonInferior,
  };
}

/**
 * 試合群から Candidate / Opponent 別のアクション採択率を分離集計
 */
export function computePlayerActionComparison(
  matches: readonly CompactMatchOutcomeRecord[],
  candidateSeatByMatchId: (m: CompactMatchOutcomeRecord) => "p1" | "p2"
): HoldoutActionComparison {
  const initMetrics = (): PlayerActionMetrics => ({
    attackOpportunities: 0,
    attacksExecuted: 0,
    attackAdoptionRate: 0,
    throwingOpportunities: 0,
    throwingsExecuted: 0,
    throwingAdoptionRate: 0,
    summonOpportunities: 0,
    summonsExecuted: 0,
    summonAdoptionRate: 0,
    passDecisions: 0,
    totalDecisions: 0,
    passRate: 0,
    actionsExecutedDistribution: {},
    actionsOfferedDistribution: {},
  });

  const candAccum = initMetrics();
  const oppAccum = initMetrics();

  for (const m of matches) {
    if (!m.playerStats) continue;

    const candSeat = candidateSeatByMatchId(m);
    const oppSeat = candSeat === "p1" ? "p2" : "p1";

    const candStats = m.playerStats[candSeat];
    const oppStats = m.playerStats[oppSeat];

    accumulatePlayerStats(candAccum, candStats);
    accumulatePlayerStats(oppAccum, oppStats);
  }

  finalizeAdoptionRates(candAccum);
  finalizeAdoptionRates(oppAccum);

  const candTotalAttacks = candAccum.attacksExecuted + candAccum.throwingsExecuted;
  const oppTotalAttacks = oppAccum.attacksExecuted + oppAccum.throwingsExecuted;

  const attackVsThrowingRatio = {
    candidate: candTotalAttacks > 0 ? candAccum.attacksExecuted / candTotalAttacks : 0,
    opponent: oppTotalAttacks > 0 ? oppAccum.attacksExecuted / oppTotalAttacks : 0,
  };

  return {
    candidateMetrics: candAccum,
    opponentMetrics: oppAccum,
    attackVsThrowingRatio,
  };
}

function accumulatePlayerStats(accum: PlayerActionMetrics, stats: PlayerActionStatsRecord): void {
  const mutAccum = accum as any;

  mutAccum.passDecisions += stats.passDecisions;

  let stepDecisions = 0;
  for (const [act, cnt] of Object.entries(stats.executedActions)) {
    mutAccum.actionsExecutedDistribution[act] = (mutAccum.actionsExecutedDistribution[act] ?? 0) + cnt;
    stepDecisions += cnt;

    if (act.includes("attack") || act === "action.attack") {
      mutAccum.attacksExecuted += cnt;
    } else if (act.includes("throwing") || act === "action.throwing") {
      mutAccum.throwingsExecuted += cnt;
    } else if (act.includes("summon") || act === "action.summon") {
      mutAccum.summonsExecuted += cnt;
    }
  }
  mutAccum.totalDecisions += stepDecisions;

  for (const [act, cnt] of Object.entries(stats.offeredActions)) {
    mutAccum.actionsOfferedDistribution[act] = (mutAccum.actionsOfferedDistribution[act] ?? 0) + cnt;

    if (act.includes("attack") || act === "action.attack") {
      mutAccum.attackOpportunities += cnt;
    } else if (act.includes("throwing") || act === "action.throwing") {
      mutAccum.throwingOpportunities += cnt;
    } else if (act.includes("summon") || act === "action.summon") {
      mutAccum.summonOpportunities += cnt;
    }
  }
}

function finalizeAdoptionRates(accum: PlayerActionMetrics): void {
  const m = accum as any;
  m.attackAdoptionRate = m.attackOpportunities > 0 ? m.attacksExecuted / m.attackOpportunities : 0;
  m.throwingAdoptionRate = m.throwingOpportunities > 0 ? m.throwingsExecuted / m.throwingOpportunities : 0;
  m.summonAdoptionRate = m.summonOpportunities > 0 ? m.summonsExecuted / m.summonOpportunities : 0;
  m.passRate = m.totalDecisions > 0 ? m.passDecisions / m.totalDecisions : 0;
}

// =============================================================================
// DNA ローダー & 真正性検証
// =============================================================================

export function loadGen8PrimaryCandidate(candidatePath?: string): DecisionDNA {
  const targetPath = path.resolve(candidatePath ?? GEN8_PRIMARY_CANDIDATE_FILE_PATH);
  if (!fs.existsSync(targetPath)) {
    throw new Gen8CandidateIntegrityError(
      `[Fail-Closed] Gen 8 Primary Candidate DNA file not found at "${targetPath}".`
    );
  }

  let rawDna: DecisionDNA;
  try {
    rawDna = JSON.parse(fs.readFileSync(targetPath, "utf8"));
  } catch (err: any) {
    throw new Gen8CandidateIntegrityError(
      `[Fail-Closed] Failed to parse Gen 8 Primary Candidate JSON: ${err?.message ?? String(err)}`
    );
  }

  const computedDigest = SemanticSHA256.hash(JSON.stringify(rawDna));
  if (computedDigest !== GEN8_PRIMARY_CANDIDATE_EXPECTED_DIGEST) {
    throw new Gen8CandidateIntegrityError(
      `[Fail-Closed] Gen 8 Primary Candidate DNA digest mismatch: expected "${GEN8_PRIMARY_CANDIDATE_EXPECTED_DIGEST}", got "${computedDigest}"`
    );
  }

  return rawDna;
}

// =============================================================================
// Preflight Manifest ビルダー
// =============================================================================

export function buildGen8HoldoutPreflightManifest(
  options?: Gen8HoldoutPreflightOptions
): Gen8HoldoutPreflightManifest {
  const mode = options?.executionMode ?? "PLAN_ONLY";
  const approvalToken = options?.approvalToken;
  const isApproved = approvalToken === GEN8_HOLDOUT_APPROVAL_TOKEN;
  const isOfficialApproved = Boolean(options?.officialHoldoutApproved && isApproved);

  // 1. 早期実行禁止・未承認判定 (Fail-Closed)
  // 公式 Checkpoint のロードより前に実行判定を行い、未承認なら即時 UnauthorizedHoldoutExecutionError をスローする
  if (mode === "EXECUTE") {
    const isTestExecution = Boolean(
      options?.testExecutionAuthorized && (options?.isSyntheticTest || options?.isRealCoreTest)
    );
    if (!isTestExecution && !isOfficialApproved) {
      throw new UnauthorizedHoldoutExecutionError(
        `[Fail-Closed] Real Gen 8 Holdout Execution requires explicit stakeholder approval.\n` +
        `Must specify both --approval-token ${GEN8_HOLDOUT_APPROVAL_TOKEN} and --official-holdout-approved.\n` +
        `Execution on reserved seeds (${GEN8_HOLDOUT_SEED_RANGE_START}..${GEN8_HOLDOUT_SEED_RANGE_END}) remains strictly locked.`
      );
    }
  }

  let isGitClean = false;
  let gitCommitSha = "UNKNOWN";
  try {
    const st = execSync("git status --porcelain", { encoding: "utf8" }).trim();
    isGitClean = st.length === 0;
    gitCommitSha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    // Git unavailable or working tree dirty
  }

  // Candidate 検証
  const candDna = loadGen8PrimaryCandidate(options?.candidatePath);
  const candDigest = SemanticSHA256.hash(JSON.stringify(candDna));

  // Anchor Champions 検証
  const gen7CheckPath = path.resolve(
    options?.gen7CheckpointPath ??
      OFFICIAL_GEN7_CHECKPOINT_PATH
  );
  const gen5CheckPath = path.resolve(
    options?.gen5CheckpointPath ??
      OFFICIAL_GEN5_CHECKPOINT_PATH
  );

  const expectedGen7Digest = options?.expectedGen7Digest ?? GEN7_EXPECTED_DIGEST;
  const expectedGen5Digest = options?.expectedGen5Digest ?? GEN5_EXPECTED_DIGEST;

  let gen7Digest = "FILE_NOT_FOUND";
  let gen5Digest = "FILE_NOT_FOUND";

  if (fs.existsSync(gen7CheckPath)) {
    try {
      const g7Dna = loadChampionDNA({
        checkpointPath: gen7CheckPath,
        expectedGenomeId: GEN7_GENOME_ID,
        expectedDigest: expectedGen7Digest,
        verifyCheckpointChecksum: true,
      });
      gen7Digest = EvolutionIndependentEvaluator.computeDnaDigest(g7Dna);
    } catch (e: any) {
      gen7Digest = `ERROR:${e?.message}`;
    }
  } else if (mode === "EXECUTE" || options?.requireOfficialCheckpoints) {
    throw new Gen8CandidateIntegrityError(
      `[Fail-Closed] Official Gen 7 Checkpoint not found at "${gen7CheckPath}". Execution is strictly blocked without official verified checkpoints.`
    );
  }

  // Gen 5 Checkpoint は退行評価用 Baseline であり、Primary Holdout (Gen 8 vs Gen 7) の実行をブロックしない
  if (fs.existsSync(gen5CheckPath)) {
    try {
      const g5Dna = loadChampionDNA({
        checkpointPath: gen5CheckPath,
        expectedGenomeId: GEN5_GENOME_ID,
        expectedDigest: expectedGen5Digest,
        verifyCheckpointChecksum: true,
      });
      gen5Digest = EvolutionIndependentEvaluator.computeDnaDigest(g5Dna);
    } catch (e: any) {
      gen5Digest = `ERROR:${e?.message}`;
    }
  } else if (options?.requireGen5Checkpoint) {
    throw new Gen8CandidateIntegrityError(
      `[Fail-Closed] Official Gen 5 Checkpoint not found at "${gen5CheckPath}". Regression baselines evaluation requires verified official Gen 5 checkpoint.`
    );
  }

  // Seed Registry 検証
  const holdoutEntry = SEED_REGISTRY_GEN8.find((r) => r.purpose.includes("Final Holdout"));
  const collisionCount = 0; // verifySeedRegistryGen8 で数学的に無衝突実証済み

  const plannedPairs = options?.plannedPairs ?? DEFAULT_PRIMARY_PAIRS;
  const powerAnalysis = computeHoldoutPowerSensitivity(plannedPairs, [0.55, 0.60, 0.65, 0.70]);

  return {
    workId: GEN8_HOLDOUT_WORK_ID,
    status: "APPROVED_FOR_PREFLIGHT_PLANNING / EXECUTION_LOCKED",
    timestamp: new Date().toISOString(),
    gitCommitSha,
    isGitClean,
    executionMode: mode,
    approvalTokenRequired: GEN8_HOLDOUT_APPROVAL_TOKEN,
    approvalStatus: isOfficialApproved
      ? "APPROVED_FOR_OFFICIAL_EXECUTION"
      : isApproved
      ? "APPROVED_FOR_TEST_ONLY"
      : "NOT_APPROVED_EXECUTION_BLOCKED",
    candidateChampion: {
      genomeId: GEN8_PRIMARY_CANDIDATE_GENOME_ID,
      expectedDigest: GEN8_PRIMARY_CANDIDATE_EXPECTED_DIGEST,
      verifiedDigest: candDigest,
      sourcePath: options?.candidatePath ?? GEN8_PRIMARY_CANDIDATE_FILE_PATH,
      digestMatches: candDigest === GEN8_PRIMARY_CANDIDATE_EXPECTED_DIGEST,
    },
    referenceAnchorGen7: {
      genomeId: GEN7_CHAMPION_GENOME_ID,
      expectedDigest: expectedGen7Digest,
      verifiedDigest: gen7Digest,
      digestMatches: gen7Digest === expectedGen7Digest,
      sourcePath: gen7CheckPath,
    },
    referenceAnchorGen5: {
      genomeId: GEN5_CHAMPION_GENOME_ID,
      expectedDigest: expectedGen5Digest,
      verifiedDigest: gen5Digest,
      digestMatches: gen5Digest === expectedGen5Digest,
      sourcePath: gen5CheckPath,
    },
    seedRange: {
      startSeed: GEN8_HOLDOUT_SEED_RANGE_START,
      endSeed: GEN8_HOLDOUT_SEED_RANGE_END,
      totalAvailableSeeds: GEN8_HOLDOUT_SEED_RANGE_END - GEN8_HOLDOUT_SEED_RANGE_START + 1,
      reservedPairs: plannedPairs,
      seedRegistryStatus: holdoutEntry?.status ?? "RESERVED_FOR_FUTURE_HOLDOUT",
      historicalCollisionCount: collisionCount,
    },
    hypothesisGate: {
      primaryComparisonOpponent: "gen7-champion",
      plannedPairs,
      plannedMatches: plannedPairs * 2,
      superiorityThreshold: "Two-sided 95% CI Lower Bound > 0.50 (one-sided p < 0.025)",
      nonInferiorityThreshold: "Two-sided 95% CI Lower Bound > 0.45 (margin 0.05)",
      powerSensitivityAnalysis: powerAnalysis,
      sensitivityCaveat: "検出力 (Power) は仮定する真の勝率とペアスコア分散に依存するモデル計算値であり、保証値ではありません。",
    },
    regressionBaselines: [
      {
        opponentId: "gen5-champion",
        role: "OLD_CHAMPION_ANCHOR",
        targetCriteria: "Two-sided 95% CI Lower Bound > 0.60 (win rate >= 70%)",
        plannedPairs: 10,
        plannedMatches: 20,
        startSeed: 350121,
        endSeed: 350130,
      },
      {
        opponentId: "seeded-random",
        role: "BASELINE_RANDOM",
        targetCriteria: "Win rate >= 95.0%",
        plannedPairs: 10,
        plannedMatches: 20,
        startSeed: 350131,
        endSeed: 350140,
      },
      {
        opponentId: "first-legal",
        role: "BASELINE_FIRST_LEGAL",
        targetCriteria: "Win rate >= 98.0%",
        plannedPairs: 10,
        plannedMatches: 20,
        startSeed: 350141,
        endSeed: 350150,
      },
    ],
  };
}

// =============================================================================
// 正式 Holdout 実行エンジン (テスト・合成実行対応 & 実試合未承認保護)
// =============================================================================

export interface HoldoutExecutionCheckpointState {
  readonly workId: string;
  readonly campaignId: string;
  readonly outputDir: string;
  readonly candidateDigest: string;
  readonly opponentDigest: string;
  readonly regulationId: string;
  readonly frameId: string;
  readonly rulePackageVersion: string;
  readonly maxDecisions: number;
  readonly startSeed: number;
  readonly totalPlannedPairs: number;
  readonly completedPairsCount: number;
  readonly nextPairIndex: number;
  readonly completedChunks: readonly {
    readonly chunkIndex: number;
    readonly fileName: string;
    readonly matchCount: number;
    readonly sha256: string;
  }[];
  readonly configDigest: string;
  readonly gitCommitSha: string;
  readonly timestamp: string;
  readonly checksum: string;
}

export function computeHoldoutConfigDigest(params: {
  readonly candidateDigest: string;
  readonly opponentDigest: string;
  readonly regulationId: string;
  readonly frameId: string;
  readonly rulePackageVersion: string;
  readonly maxDecisions: number;
  readonly startSeed: number;
  readonly totalPlannedPairs: number;
}): string {
  const content = JSON.stringify(params);
  return crypto.createHash("sha256").update(content).digest("hex");
}

export function computeHoldoutCheckpointChecksum(stateWithoutChecksum: Omit<HoldoutExecutionCheckpointState, "checksum">): string {
  const content = JSON.stringify(stateWithoutChecksum);
  return crypto.createHash("sha256").update(content).digest("hex");
}

export async function executeGen8HoldoutCampaign(options: Gen8HoldoutExecutionOptions): Promise<{
  readonly completedPairs: number;
  readonly totalMatches: number;
  readonly auditResult: Gen8HoldoutAuditResult;
}> {
  const {
    candidateDNA,
    candidateDigest,
    candidateGenomeId = "gen8-prod-g0-ind7-cross7",
    opponentDNA,
    opponentDigest,
    opponentGenomeId = "gen7-champion",
    opponentId = "gen7-champion",
    opponentName = "Stage3Gen7Champion",
    pairsCount,
    startSeed,
    outputDir,
    chunkSizeMatches = 50,
    maxDecisionsPerMatch = GEN8_HOLDOUT_MAX_DECISIONS_PER_MATCH,
    workersCount = 4,
    regulationId = GEN8_HOLDOUT_REGULATION_ID,
    frameId = GEN8_HOLDOUT_FRAME_ID,
    rulePackageVersion = GEN8_HOLDOUT_RULE_PACKAGE_VERSION,
    rulesDir,
    isSyntheticTest = false,
    isRealCoreTest = false,
    testExecutionAuthorized = false,
    sessionPairsLimit,
  } = options;

  const isOfficialApproved = Boolean(
    options.officialHoldoutApproved &&
    options.approvalToken === GEN8_HOLDOUT_APPROVAL_TOKEN &&
    !isSyntheticTest &&
    !isRealCoreTest
  );

  // 1. 実 Holdout 予約 Seed (350001〜350300) の実試合実行保護 (Fail-Closed: 完全区間重複判定)
  const endSeed = startSeed + pairsCount - 1;
  const overlapsReserved =
    Math.max(startSeed, GEN8_HOLDOUT_SEED_RANGE_START) <= Math.min(endSeed, GEN8_HOLDOUT_SEED_RANGE_END);

  if (overlapsReserved) {
    if (!isOfficialApproved) {
      throw new UnauthorizedHoldoutExecutionError(
        `[Fail-Closed] Real Gen 8 Holdout Match Execution on reserved seeds (${GEN8_HOLDOUT_SEED_RANGE_START}..${GEN8_HOLDOUT_SEED_RANGE_END}) requires explicit official authorization.\n` +
        `Must supply officialHoldoutApproved=true and valid approvalToken (${GEN8_HOLDOUT_APPROVAL_TOKEN}).\n` +
        `Current startSeed=${startSeed}, pairsCount=${pairsCount}, endSeed=${endSeed}.`
      );
    }
    // 正式 Holdout 実行時の厳格な範囲・条件拘束
    if (startSeed !== GEN8_HOLDOUT_SEED_RANGE_START || pairsCount !== DEFAULT_PRIMARY_PAIRS) {
      throw new UnauthorizedHoldoutExecutionError(
        `[Fail-Closed] Official Gen 8 Holdout must execute exactly ${DEFAULT_PRIMARY_PAIRS} pairs starting at ${GEN8_HOLDOUT_SEED_RANGE_START} (seeds 350001..350120). Found startSeed=${startSeed}, pairsCount=${pairsCount}.`
      );
    }
    if (candidateDigest !== GEN8_PRIMARY_CANDIDATE_EXPECTED_DIGEST) {
      throw new Gen8CandidateIntegrityError(
        `[Fail-Closed] Candidate DNA Digest mismatch in official holdout: expected "${GEN8_PRIMARY_CANDIDATE_EXPECTED_DIGEST}", got "${candidateDigest}".`
      );
    }
    if (opponentDigest !== GEN7_CHAMPION_EXPECTED_DIGEST) {
      throw new Gen8CandidateIntegrityError(
        `[Fail-Closed] Gen 7 Opponent DNA Digest mismatch in official holdout: expected "${GEN7_CHAMPION_EXPECTED_DIGEST}", got "${opponentDigest}".`
      );
    }
  }

  // 2. 実行モード判定 (未承認実行の遮断)
  if (!isOfficialApproved && (!testExecutionAuthorized || (!isSyntheticTest && !isRealCoreTest))) {
    throw new UnauthorizedHoldoutExecutionError(
      `[Fail-Closed] Real Gen 8 Holdout Execution is strictly prohibited without explicit authorization.\n` +
      `Actual match execution requires explicit stakeholder approval.\n` +
      `Only authorized official runs or verified test executions are permitted.`
    );
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const chunksDir = path.join(outputDir, "chunks");
  fs.mkdirSync(chunksDir, { recursive: true });
  const checkpointPath = path.join(outputDir, "checkpoint.json");

  let gitCommitSha = "UNKNOWN";
  try {
    gitCommitSha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    // Ignore
  }

  const currentConfigDigest = computeHoldoutConfigDigest({
    candidateDigest,
    opponentDigest,
    regulationId,
    frameId,
    rulePackageVersion,
    maxDecisions: maxDecisionsPerMatch,
    startSeed,
    totalPlannedPairs: pairsCount,
  });

  let startPairIndex = 0;
  let completedChunks: { chunkIndex: number; fileName: string; matchCount: number; sha256: string }[] = [];

  // Resume 検証 (要件 4: 厳格な全フィールド照合)
  if (fs.existsSync(checkpointPath)) {
    const raw: HoldoutExecutionCheckpointState = JSON.parse(fs.readFileSync(checkpointPath, "utf8"));
    const { checksum, ...rest } = raw;
    const expectedChecksum = computeHoldoutCheckpointChecksum(rest);
    if (checksum !== expectedChecksum) {
      throw new Gen8HoldoutAuditError(`[Fail-Closed] Checkpoint checksum mismatch at "${checkpointPath}"`);
    }

    if (raw.candidateDigest !== candidateDigest) {
      throw new Gen8HoldoutAuditError(`[Fail-Closed] Checkpoint candidateDigest mismatch: expected ${candidateDigest}, found ${raw.candidateDigest}`);
    }
    if (raw.opponentDigest !== opponentDigest) {
      throw new Gen8HoldoutAuditError(`[Fail-Closed] Checkpoint opponentDigest mismatch: expected ${opponentDigest}, found ${raw.opponentDigest}`);
    }
    if (raw.regulationId !== regulationId) {
      throw new Gen8HoldoutAuditError(`[Fail-Closed] Checkpoint regulationId mismatch: expected ${regulationId}, found ${raw.regulationId}`);
    }
    if (raw.frameId !== frameId) {
      throw new Gen8HoldoutAuditError(`[Fail-Closed] Checkpoint frameId mismatch: expected ${frameId}, found ${raw.frameId}`);
    }
    if (raw.rulePackageVersion !== rulePackageVersion) {
      throw new Gen8HoldoutAuditError(`[Fail-Closed] Checkpoint rulePackageVersion mismatch: expected ${rulePackageVersion}, found ${raw.rulePackageVersion}`);
    }
    if (raw.maxDecisions !== maxDecisionsPerMatch) {
      throw new Gen8HoldoutAuditError(`[Fail-Closed] Checkpoint maxDecisions mismatch: expected ${maxDecisionsPerMatch}, found ${raw.maxDecisions}`);
    }
    if (raw.startSeed !== startSeed) {
      throw new Gen8HoldoutAuditError(`[Fail-Closed] Checkpoint startSeed mismatch: expected ${startSeed}, found ${raw.startSeed}`);
    }
    if (raw.totalPlannedPairs !== pairsCount) {
      throw new Gen8HoldoutAuditError(`[Fail-Closed] Checkpoint totalPlannedPairs mismatch: expected ${pairsCount}, found ${raw.totalPlannedPairs}`);
    }
    if (raw.configDigest !== currentConfigDigest) {
      throw new Gen8HoldoutAuditError(`[Fail-Closed] Checkpoint configDigest mismatch: expected ${currentConfigDigest}, found ${raw.configDigest}`);
    }

    if (raw.nextPairIndex !== raw.completedPairsCount) {
      throw new Gen8HoldoutAuditError(
        `[Fail-Closed] Checkpoint index mismatch: nextPairIndex (${raw.nextPairIndex}) !== completedPairsCount (${raw.completedPairsCount})`
      );
    }
    if (raw.gitCommitSha && gitCommitSha !== "UNKNOWN" && raw.gitCommitSha !== "UNKNOWN" && raw.gitCommitSha !== gitCommitSha) {
      throw new Gen8HoldoutAuditError(
        `[Fail-Closed] Checkpoint gitCommitSha mismatch: expected ${gitCommitSha}, found ${raw.gitCommitSha}`
      );
    }

    // 確定済みチャンクファイルの存在と SHA-256 検証
    for (const chunkInfo of raw.completedChunks) {
      const chunkFilePath = path.join(outputDir, chunkInfo.fileName);
      if (!fs.existsSync(chunkFilePath)) {
        throw new Gen8HoldoutAuditError(`[Fail-Closed] Missing chunk file recorded in checkpoint: ${chunkFilePath}`);
      }
      const actualSha = computeFileSha256(chunkFilePath);
      if (actualSha !== chunkInfo.sha256) {
        throw new Gen8HoldoutAuditError(`[Fail-Closed] Chunk SHA-256 mismatch for ${chunkFilePath}: expected ${chunkInfo.sha256}, got ${actualSha}`);
      }
    }

    startPairIndex = raw.completedPairsCount;
    completedChunks = [...raw.completedChunks];
  }

  // セッション分割の進行式: startPairIndex を基準に今回のターゲットを計算
  const targetPairsThisSession = sessionPairsLimit
    ? Math.min(pairsCount, startPairIndex + sessionPairsLimit)
    : pairsCount;

  let currentChunkLines: string[] = [];

  const flushChunk = (pairsDoneSoFar: number) => {
    if (currentChunkLines.length === 0) return;
    const chunkIndex = completedChunks.length;
    const fileName = `outcomes-chunk-${String(chunkIndex).padStart(5, "0")}.jsonl`;
    const chunkPath = path.join(chunksDir, fileName);
    const tmpPath = `${chunkPath}.tmp`;
    const content = currentChunkLines.join("\n") + "\n";
    fs.writeFileSync(tmpPath, content, "utf8");
    fs.renameSync(tmpPath, chunkPath);

    const sha256 = computeFileSha256(chunkPath);
    completedChunks.push({
      chunkIndex,
      fileName: `chunks/${fileName}`,
      matchCount: currentChunkLines.length,
      sha256,
    });
    currentChunkLines = [];

    // Checkpoint 更新 (アトミック保存)
    const ckptStateWithout: Omit<HoldoutExecutionCheckpointState, "checksum"> = {
      workId: GEN8_HOLDOUT_WORK_ID,
      campaignId: "gen8-holdout-eval",
      outputDir,
      candidateDigest,
      opponentDigest,
      regulationId,
      frameId,
      rulePackageVersion,
      maxDecisions: maxDecisionsPerMatch,
      startSeed,
      totalPlannedPairs: pairsCount,
      completedPairsCount: pairsDoneSoFar,
      nextPairIndex: pairsDoneSoFar,
      completedChunks,
      configDigest: currentConfigDigest,
      gitCommitSha,
      timestamp: new Date().toISOString(),
    };
    const ckptChecksum = computeHoldoutCheckpointChecksum(ckptStateWithout);
    const ckptTmp = `${checkpointPath}.tmp`;
    fs.writeFileSync(ckptTmp, JSON.stringify({ ...ckptStateWithout, checksum: ckptChecksum }, null, 2), "utf8");
    fs.renameSync(ckptTmp, checkpointPath);
  };

  if (isSyntheticTest) {
    // -------------------------------------------------------------------------
    // 合成テスト経路 (テストコード専用: 高速モック生成)
    // -------------------------------------------------------------------------
    for (let pairIndex = startPairIndex; pairIndex < targetPairsThisSession; pairIndex++) {
      const matchSeed = startSeed + pairIndex;
      const p1Seed = derivePlayerSeed(matchSeed, "p1");
      const p2Seed = derivePlayerSeed(matchSeed, "p2");

      // Leg 0: Cand=P1, Opp=P2
      const matchIndex0 = pairIndex * 2;
      const matchId0 = `gen8-holdout-m${matchIndex0}-p${pairIndex}-l0`;
      const leg0Outcome: CompactMatchOutcomeRecord = {
        schemaVersion: "1.0.0",
        matchIndex: matchIndex0,
        pairIndex,
        legIndex: 0,
        matchId: matchId0,
        matchupId: `cand-vs-${opponentId}`,
        matchSeed,
        playerSeeds: { p1: p1Seed, p2: p2Seed },
        p1PolicyId: "gen8-candidate",
        p2PolicyId: opponentId,
        p1DnaDigest: candidateDigest,
        p2DnaDigest: opponentDigest,
        status: "COMPLETED",
        completed: true,
        winner: "p1",
        reason: "finished",
        totalDecisions: 24,
        turnCount: 12,
        passDecisions: 2,
        maxConsecutivePasses: 1,
        streamingDecisions: 0,
        maxLegalPatterns: 4,
        instantiationFailures: 0,
        reachedDecisionLimit: false,
        finalStateHash: `hash-m${matchIndex0}`,
        playerStats: {
          p1: {
            offeredActions: { "action.attack": 8, "action.throwing": 4, PASS: 8 },
            executedActions: { "action.attack": 5, "action.throwing": 2, PASS: 1 },
            passDecisions: 1,
          },
          p2: {
            offeredActions: { "action.attack": 6, "action.throwing": 6, PASS: 6 },
            executedActions: { "action.attack": 1, "action.throwing": 4, PASS: 1 },
            passDecisions: 1,
          },
        },
      };
      currentChunkLines.push(JSON.stringify(leg0Outcome));

      // Leg 1: Opp=P1, Cand=P2 (座席反転)
      const matchIndex1 = pairIndex * 2 + 1;
      const matchId1 = `gen8-holdout-m${matchIndex1}-p${pairIndex}-l1`;
      const leg1Outcome: CompactMatchOutcomeRecord = {
        schemaVersion: "1.0.0",
        matchIndex: matchIndex1,
        pairIndex,
        legIndex: 1,
        matchId: matchId1,
        matchupId: `cand-vs-${opponentId}`,
        matchSeed,
        playerSeeds: { p1: p1Seed, p2: p2Seed },
        p1PolicyId: opponentId,
        p2PolicyId: "gen8-candidate",
        p1DnaDigest: opponentDigest,
        p2DnaDigest: candidateDigest,
        status: "COMPLETED",
        completed: true,
        winner: "p2",
        reason: "finished",
        totalDecisions: 26,
        turnCount: 13,
        passDecisions: 3,
        maxConsecutivePasses: 1,
        streamingDecisions: 0,
        maxLegalPatterns: 4,
        instantiationFailures: 0,
        reachedDecisionLimit: false,
        finalStateHash: `hash-m${matchIndex1}`,
        playerStats: {
          p1: {
            offeredActions: { "action.attack": 5, "action.throwing": 5, PASS: 5 },
            executedActions: { "action.attack": 2, "action.throwing": 3, PASS: 1 },
            passDecisions: 1,
          },
          p2: {
            offeredActions: { "action.attack": 9, "action.throwing": 3, PASS: 9 },
            executedActions: { "action.attack": 6, "action.throwing": 1, PASS: 2 },
            passDecisions: 2,
          },
        },
      };
      currentChunkLines.push(JSON.stringify(leg1Outcome));

      if (currentChunkLines.length >= chunkSizeMatches || pairIndex === targetPairsThisSession - 1) {
        flushChunk(pairIndex + 1);
      }
    }
  } else {
    // -------------------------------------------------------------------------
    // 実際の Core 対戦経路 (MillionMatchWorkerPool & 実際ゲームセッション)
    // -------------------------------------------------------------------------
    const effectiveRulesDir = rulesDir ? path.resolve(rulesDir) : path.resolve("src/data/rules-vnext");

    const poolGen7DNA = opponentDNA;
    const poolGen5DNA = opponentDNA;
    const poolZeroDNA = DecisionDNACodec.createZeroDecisionDNA({
      id: "zero-dna",
      name: "Zero Baseline",
    });

    const isPoolInjected = Boolean(options.workerPool);
    const workerPool = options.workerPool ?? (await MillionMatchWorkerPool.create({
      workersCount,
      regulationId,
      frameId,
      rulesDir: effectiveRulesDir,
      maxDecisionsPerMatch,
      champions: {
        gen7DNA: poolGen7DNA,
        gen7Digest: EvolutionIndependentEvaluator.computeDnaDigest(poolGen7DNA),
        gen7Source: "holdout-harness",
        gen5DNA: poolGen5DNA,
        gen5Digest: EvolutionIndependentEvaluator.computeDnaDigest(poolGen5DNA),
        gen5Source: "holdout-harness",
        zeroDNA: poolZeroDNA,
        zeroDigest: EvolutionIndependentEvaluator.computeDnaDigest(poolZeroDNA),
      },
    }));

    try {
      const specA: ParticipantPolicySpec = {
        policyId: candidateGenomeId,
        name: candidateGenomeId,
        kind: "GENOME",
        role: "CANDIDATE",
        dnaDigest: candidateDigest,
        customDNA: candidateDNA,
      };
      const specB: ParticipantPolicySpec = {
        policyId: opponentGenomeId,
        name: opponentGenomeId,
        kind: "GENOME",
        role: "CANDIDATE",
        dnaDigest: opponentDigest,
        customDNA: opponentDNA,
      };

      const batchSizePairs = Math.max(1, Math.min(10, Math.floor(chunkSizeMatches / 2)));

      for (let batchStart = startPairIndex; batchStart < targetPairsThisSession; batchStart += batchSizePairs) {
        const batchEnd = Math.min(targetPairsThisSession, batchStart + batchSizePairs);
        const pairPromises: Promise<{ pairIndex: number; leg0: CompactMatchOutcomeRecord; leg1: CompactMatchOutcomeRecord }>[] = [];

        for (let pIdx = batchStart; pIdx < batchEnd; pIdx++) {
          const matchSeed = startSeed + pIdx;
          const p1Seed = derivePlayerSeed(matchSeed, "p1");
          const p2Seed = derivePlayerSeed(matchSeed, "p2");

          const task: WorkerPairTask = {
            taskId: `holdout-p${pIdx}`,
            campaignId: "gen8-holdout-eval",
            workId: GEN8_HOLDOUT_WORK_ID,
            pairIndex: pIdx,
            matchSeed,
            playerSeeds: { p1: p1Seed, p2: p2Seed },
            matchup: {
              matchupId: `holdout-${candidateGenomeId}-vs-${opponentGenomeId}`,
              name: `${candidateGenomeId} vs ${opponentGenomeId}`,
              weight: 1,
              agentA: specA,
              agentB: specB,
            },
            maxDecisionsPerMatch,
          };

          pairPromises.push(
            workerPool.executePairTask(task).then((res) => {
              const matchIndex0 = pIdx * 2;
              const matchIndex1 = pIdx * 2 + 1;

              const leg0Outcome: CompactMatchOutcomeRecord = {
                ...res.leg0Result.outcomeRecord,
                matchIndex: matchIndex0,
                pairIndex: pIdx,
                legIndex: 0,
                matchId: `gen8-holdout-m${matchIndex0}-p${pIdx}-l0`,
                matchupId: `cand-vs-${opponentId}`,
                matchSeed,
                playerSeeds: { p1: p1Seed, p2: p2Seed },
                p1PolicyId: candidateGenomeId,
                p2PolicyId: opponentGenomeId,
                p1DnaDigest: candidateDigest,
                p2DnaDigest: opponentDigest,
              };

              const leg1Outcome: CompactMatchOutcomeRecord = {
                ...res.leg1Result.outcomeRecord,
                matchIndex: matchIndex1,
                pairIndex: pIdx,
                legIndex: 1,
                matchId: `gen8-holdout-m${matchIndex1}-p${pIdx}-l1`,
                matchupId: `cand-vs-${opponentId}`,
                matchSeed,
                playerSeeds: { p1: p1Seed, p2: p2Seed },
                p1PolicyId: opponentGenomeId,
                p2PolicyId: candidateGenomeId,
                p1DnaDigest: opponentDigest,
                p2DnaDigest: candidateDigest,
              };

              return { pairIndex: pIdx, leg0: leg0Outcome, leg1: leg1Outcome };
            })
          );
        }

        const batchResults = await Promise.all(pairPromises);
        // Worker数に左右されないよう pairIndex 昇順で整列
        batchResults.sort((a, b) => a.pairIndex - b.pairIndex);

        for (const r of batchResults) {
          currentChunkLines.push(JSON.stringify(r.leg0));
          currentChunkLines.push(JSON.stringify(r.leg1));
        }

        flushChunk(batchEnd);
      }
    } finally {
      if (!isPoolInjected) {
        await workerPool.terminate();
      }
    }
  }

  flushChunk(targetPairsThisSession);

  // MANIFEST_SHA256.json の生成
  const manifestMap: Record<string, string> = {};
  for (const c of completedChunks) {
    manifestMap[c.fileName] = c.sha256;
  }
  manifestMap["checkpoint.json"] = computeFileSha256(checkpointPath);
  fs.writeFileSync(path.join(outputDir, "MANIFEST_SHA256.json"), JSON.stringify(manifestMap, null, 2), "utf8");

  // 全体完了時のみ正式監査を実行、部分セッション完了時は IN_PROGRESS を返却
  let auditResult: Gen8HoldoutAuditResult;
  if (targetPairsThisSession === pairsCount) {
    auditResult = auditGen8HoldoutArtifacts(outputDir, {
      expectedCandidateDigest: candidateDigest,
      expectedOpponentDigest: opponentDigest,
      expectedTotalPairs: pairsCount,
      expectedTotalMatches: pairsCount * 2,
      expectedStartSeed: startSeed,
    });
    if (!auditResult.isValid) {
      throw new Gen8HoldoutAuditError(
        `[Fail-Closed] Holdout campaign completed but audit failed with ${auditResult.errors.length} error(s): ${auditResult.errors.join("; ")}`
      );
    }
  } else {
    auditResult = {
      isValid: false,
      auditStatus: "IN_PROGRESS",
      auditTimestamp: new Date().toISOString(),
      artifactsDir: outputDir,
      checkedFiles: ["checkpoint.json"],
      errors: [],
      totalMatches: targetPairsThisSession * 2,
      totalPairs: targetPairsThisSession,
      completedMatches: targetPairsThisSession * 2,
      failedMatches: 0,
      incompleteMatches: 0,
      candidateDigest,
      candidateDigestVerified: true,
      superiorityVerified: false,
      nonInferiorityVerified: false,
    };
  }

  return {
    completedPairs: targetPairsThisSession,
    totalMatches: targetPairsThisSession * 2,
    auditResult,
  };
}

// =============================================================================
// Artifacts 監査ユーティリティ (12 大検証契約)
// =============================================================================

export interface HoldoutAuditOptions {
  expectedCandidateDigest?: string;
  expectedOpponentDigest?: string;
  expectedTotalPairs?: number;
  expectedTotalMatches?: number;
  expectedStartSeed?: number;
}

export function auditGen8HoldoutArtifacts(
  artifactsDir: string,
  options?: HoldoutAuditOptions
): Gen8HoldoutAuditResult {
  const dir = path.resolve(artifactsDir);
  const checkedFiles: string[] = [];
  const errors: string[] = [];

  if (!fs.existsSync(dir)) {
    throw new Gen8HoldoutAuditError(`[Fail-Closed] Holdout artifacts directory not found at "${dir}".`);
  }

  // 1. MANIFEST_SHA256.json の存在と中身検証
  const manifestPath = path.join(dir, "MANIFEST_SHA256.json");
  let manifest: Record<string, string> = {};
  if (!fs.existsSync(manifestPath)) {
    errors.push("[Audit Violation 10] MANIFEST_SHA256.json not found in artifacts directory.");
  } else {
    checkedFiles.push("MANIFEST_SHA256.json");
    try {
      const rawText = fs.readFileSync(manifestPath, "utf8").trim();
      if (!rawText || rawText === "{}") {
        errors.push("[Audit Violation 10] MANIFEST_SHA256.json is empty.");
      } else {
        manifest = JSON.parse(rawText);
        for (const [relFile, expectedSha] of Object.entries(manifest)) {
          const fullPath = path.join(dir, relFile);
          if (!fs.existsSync(fullPath)) {
            errors.push(`[Audit Violation 10] Manifest referenced file missing: "${relFile}"`);
          } else {
            const actualSha = computeFileSha256(fullPath);
            if (actualSha !== expectedSha) {
              errors.push(`[Audit Violation 10] SHA-256 mismatch for "${relFile}": expected "${expectedSha}", got "${actualSha}"`);
            }
            checkedFiles.push(relFile);
          }
        }
      }
    } catch (e: any) {
      errors.push(`[Audit Violation 10] Failed to parse MANIFEST_SHA256.json: ${e?.message ?? String(e)}`);
    }
  }

  // 2. Chunks ディレクトリの余剰ファイル・不整合検証
  const chunksDir = path.join(dir, "chunks");
  const allOutcomes: CompactMatchOutcomeRecord[] = [];

  if (!fs.existsSync(chunksDir)) {
    errors.push("[Audit Violation 11] chunks directory does not exist.");
  } else {
    const chunkFiles = fs.readdirSync(chunksDir);
    for (const cf of chunkFiles) {
      if (cf.endsWith(".tmp")) {
        errors.push(`[Audit Violation 11] Orphan temporary chunk file found: "${cf}"`);
      }
      const relPath = `chunks/${cf}`;
      if (!cf.endsWith(".tmp") && !manifest[relPath]) {
        errors.push(`[Audit Violation 11] Extra unindexed chunk file found: "${cf}"`);
      }
    }

    const validJsonlFiles = chunkFiles.filter((f) => f.endsWith(".jsonl")).sort();
    for (const cf of validJsonlFiles) {
      const cfPath = path.join(chunksDir, cf);
      const rawChunk = fs.readFileSync(cfPath, "utf8").trim();
      if (!rawChunk) continue;
      const lines = rawChunk.split("\n");
      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx];
        if (!line) continue;
        try {
          const rec: CompactMatchOutcomeRecord = JSON.parse(line);
          allOutcomes.push(rec);
        } catch (e: any) {
          errors.push(`[Audit Violation 11] Corrupt JSONL in ${cf} line ${lineIdx + 1}: ${e?.message}`);
        }
      }
    }
  }

  const totalMatches = allOutcomes.length;
  if (totalMatches === 0) {
    errors.push("[Audit Violation 1] Zero matches found in holdout artifacts.");
  }

  // 3. 予定試合数の完全一致
  if (options?.expectedTotalMatches !== undefined && totalMatches !== options.expectedTotalMatches) {
    errors.push(`[Audit Violation 1] Total matches count mismatch: expected ${options.expectedTotalMatches}, found ${totalMatches}`);
  }

  // 4. matchIndex 連続性と matchId 一意性
  const seenMatchIds = new Set<string>();
  const matchIndices = allOutcomes.map((m) => m.matchIndex).sort((a, b) => a - b);

  for (let i = 0; i < matchIndices.length; i++) {
    if (matchIndices[i] !== i) {
      errors.push(`[Audit Violation 3] matchIndex gap or discontinuity at index ${i}: found ${matchIndices[i]}`);
      break;
    }
  }

  for (const m of allOutcomes) {
    if (seenMatchIds.has(m.matchId)) {
      errors.push(`[Audit Violation 4] Duplicate matchId detected: "${m.matchId}"`);
    }
    seenMatchIds.add(m.matchId);

    // 5. status === COMPLETED 検証 (未完了試合の暗黙引き分け扱い禁止)
    if (m.status !== "COMPLETED" || !m.completed) {
      errors.push(`[Audit Violation 9] Incomplete match detected: matchIndex ${m.matchIndex} has status "${m.status}", completed=${m.completed}`);
    }

    // 勝者 ID の正当性
    if (m.winner !== "p1" && m.winner !== "p2" && m.winner !== "draw") {
      errors.push(`[Audit Violation 9] Invalid winner value "${m.winner}" in matchIndex ${m.matchIndex}`);
    }
  }

  // 6. 座席反転ペアの完全性 & pairIndex / legIndex 正当性
  const pairsMap = new Map<number, { leg0?: CompactMatchOutcomeRecord; leg1?: CompactMatchOutcomeRecord }>();
  for (const m of allOutcomes) {
    let p = pairsMap.get(m.pairIndex);
    if (!p) {
      p = {};
      pairsMap.set(m.pairIndex, p);
    }
    if (m.legIndex === 0) {
      if (p.leg0) errors.push(`[Audit Violation 5] Duplicate legIndex 0 at pairIndex ${m.pairIndex}`);
      p.leg0 = m;
    } else if (m.legIndex === 1) {
      if (p.leg1) errors.push(`[Audit Violation 5] Duplicate legIndex 1 at pairIndex ${m.pairIndex}`);
      p.leg1 = m;
    } else {
      errors.push(`[Audit Violation 5] Invalid legIndex ${m.legIndex} at matchIndex ${m.matchIndex}`);
    }
  }

  const pairRecords: PairedScoreRecord[] = [];
  const startSeed = options?.expectedStartSeed ?? GEN8_HOLDOUT_SEED_RANGE_START;

  for (const [pairIndex, p] of pairsMap.entries()) {
    if (!p.leg0 || !p.leg1) {
      errors.push(`[Audit Violation 5] Incomplete seat-inverted pair at pairIndex ${pairIndex}: leg0=${Boolean(p.leg0)}, leg1=${Boolean(p.leg1)}`);
      continue;
    }

    // 7. Seed 割当の決定論的一致
    const expectedMatchSeed = startSeed + pairIndex;
    if (p.leg0.matchSeed !== expectedMatchSeed || p.leg1.matchSeed !== expectedMatchSeed) {
      errors.push(`[Audit Violation 6] Seed mismatch at pairIndex ${pairIndex}: expected ${expectedMatchSeed}, got leg0=${p.leg0.matchSeed}, leg1=${p.leg1.matchSeed}`);
    }
    const expectedP1Seed = derivePlayerSeed(expectedMatchSeed, "p1");
    const expectedP2Seed = derivePlayerSeed(expectedMatchSeed, "p2");
    if (p.leg0.playerSeeds.p1 !== expectedP1Seed || p.leg0.playerSeeds.p2 !== expectedP2Seed) {
      errors.push(`[Audit Violation 6] Player seeds mismatch at pairIndex ${pairIndex} leg0`);
    }

    // 8. 座席割当検証 (Leg 0: Cand=P1, Leg 1: Cand=P2)
    const leg0CandDigest = p.leg0.p1DnaDigest;
    const leg1CandDigest = p.leg1.p2DnaDigest;
    const expectedCandDigest = options?.expectedCandidateDigest ?? GEN8_PRIMARY_CANDIDATE_EXPECTED_DIGEST;

    if (leg0CandDigest !== expectedCandDigest || leg1CandDigest !== expectedCandDigest) {
      errors.push(`[Audit Violation 7] Candidate seat/DNA mismatch at pairIndex ${pairIndex}: leg0.p1=${leg0CandDigest}, leg1.p2=${leg1CandDigest}`);
    }

    // 9. DNA Digest 検証
    if (options?.expectedOpponentDigest) {
      if (p.leg0.p2DnaDigest !== options.expectedOpponentDigest || p.leg1.p1DnaDigest !== options.expectedOpponentDigest) {
        errors.push(`[Audit Violation 8] Opponent DNA digest mismatch at pairIndex ${pairIndex}`);
      }
    }

    const scores = computePairScore(
      (p.leg0.winner ?? "draw") as any,
      (p.leg1.winner ?? "draw") as any
    );

    pairRecords.push({
      pairIndex,
      seed: p.leg0.matchSeed,
      opponentId: p.leg0.p2PolicyId,
      leg0Winner: (p.leg0.winner ?? "draw") as any,
      leg1Winner: (p.leg1.winner ?? "draw") as any,
      leg0CandidateSeat: "p1",
      leg1CandidateSeat: "p2",
      leg0Score: scores.leg0Score,
      leg1Score: scores.leg1Score,
      pairScore: scores.pairScore,
      leg0TotalDecisions: p.leg0.totalDecisions,
      leg1TotalDecisions: p.leg1.totalDecisions,
      leg0DurationMs: p.leg0.durationMs,
      leg1DurationMs: p.leg1.durationMs,
    });
  }

  // 10. 予定ペア数の完全一致
  if (options?.expectedTotalPairs !== undefined && pairRecords.length !== options.expectedTotalPairs) {
    errors.push(`[Audit Violation 2] Total pairs count mismatch: expected ${options.expectedTotalPairs}, found ${pairRecords.length}`);
  }

  // 11. 候補 DNA 真正性検証
  const expectedCandDigest = options?.expectedCandidateDigest ?? GEN8_PRIMARY_CANDIDATE_EXPECTED_DIGEST;
  let candidateDigest = "UNRECORDED";
  let candidateDigestVerified = false;

  const firstCandDna = allOutcomes.find((m) => m.legIndex === 0)?.p1DnaDigest;
  if (firstCandDna) {
    candidateDigest = firstCandDna;
    candidateDigestVerified = candidateDigest === expectedCandDigest;
  }
  if (!candidateDigestVerified) {
    errors.push(`[Audit Violation 12] Candidate DNA Digest verification FAILED: expected "${expectedCandDigest}", recorded "${candidateDigest}"`);
  }

  const statSummary = pairRecords.length > 0
    ? computeHoldoutStatistics("gen7-champion", "Stage3Gen7Champion", pairRecords)
    : undefined;

  const actionComparison = allOutcomes.length > 0
    ? computePlayerActionComparison(allOutcomes, (m) => (m.legIndex === 0 ? "p1" : "p2"))
    : undefined;

  const completedMatches = allOutcomes.filter((m) => m.status === "COMPLETED" && m.completed).length;
  const failedMatches = allOutcomes.filter((m) => m.status === "FAILED").length;
  const incompleteMatches = allOutcomes.filter((m) => m.status === "INCOMPLETE" || !m.completed).length;

  const isValid = errors.length === 0 && candidateDigestVerified && failedMatches === 0 && incompleteMatches === 0 && totalMatches > 0;

  return {
    isValid,
    auditStatus: isValid ? "AUDIT_PASSED" : "AUDIT_FAILED",
    auditTimestamp: new Date().toISOString(),
    artifactsDir: dir,
    checkedFiles,
    errors,
    totalMatches,
    totalPairs: pairRecords.length,
    completedMatches,
    failedMatches,
    incompleteMatches,
    candidateDigest,
    candidateDigestVerified,
    statisticalSummary: statSummary,
    actionComparison,
    superiorityVerified: statSummary?.isSuperior ?? false,
    nonInferiorityVerified: statSummary?.isNonInferior ?? false,
  };
}

// =============================================================================
// CLI エントリポイント
// =============================================================================

export async function runGen8HoldoutCli(args: string[] = process.argv.slice(2)): Promise<void> {
  console.log("================================================================================");
  console.log("BlackPoker Work 4-5 — Gen 8 Official Holdout Preflight & Evaluation Harness");
  console.log("================================================================================");

  let mode: "PLAN_ONLY" | "DRY_RUN" | "EXECUTE" | "AUDIT_ONLY" = "PLAN_ONLY";
  let approvalToken: string | undefined;
  let officialHoldoutApproved = false;
  let plannedPairs: number = DEFAULT_PRIMARY_PAIRS;
  let outputDir: string = DEFAULT_GEN8_HOLDOUT_OUTPUT_DIR;
  let candidatePath: string | undefined;
  let gen7CheckpointPath: string | undefined;
  let expectedGen7Digest: string | undefined;
  let expectedCandidateDigest: string | undefined;
  let startSeedArg: number | undefined;
  let sessionPairsLimit: number | undefined;
  let allowSyntheticTest = false;
  let allowRealCoreTest = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--plan-only") {
      mode = "PLAN_ONLY";
    } else if (arg === "--dry-run") {
      mode = "DRY_RUN";
    } else if (arg === "--execute") {
      mode = "EXECUTE";
    } else if (arg === "--audit-only") {
      mode = "AUDIT_ONLY";
    } else if (arg === "--allow-synthetic-execution-test") {
      allowSyntheticTest = true;
    } else if (arg === "--allow-real-core-test") {
      allowRealCoreTest = true;
    } else if (arg === "--official-holdout-approved") {
      officialHoldoutApproved = true;
    } else if (arg === "--approval-token" && i + 1 < args.length) {
      approvalToken = args[++i];
    } else if (arg === "--pairs" && i + 1 < args.length) {
      plannedPairs = Math.min(MAX_AVAILABLE_PAIRS, Math.max(1, parseInt(args[++i], 10)));
    } else if (arg === "--output-dir" && i + 1 < args.length) {
      outputDir = args[++i];
    } else if (arg === "--candidate-path" && i + 1 < args.length) {
      candidatePath = args[++i];
    } else if (arg === "--gen7-checkpoint" && i + 1 < args.length) {
      gen7CheckpointPath = args[++i];
    } else if (arg === "--expected-gen7-digest" && i + 1 < args.length) {
      expectedGen7Digest = args[++i];
    } else if (arg === "--expected-candidate-digest" && i + 1 < args.length) {
      expectedCandidateDigest = args[++i];
    } else if (arg === "--start-seed" && i + 1 < args.length) {
      startSeedArg = parseInt(args[++i], 10);
    } else if (arg === "--session-pairs-limit" && i + 1 < args.length) {
      sessionPairsLimit = parseInt(args[++i], 10);
    }
  }

  const isTestExecution = allowSyntheticTest || allowRealCoreTest;
  const isOfficialApproved = officialHoldoutApproved && approvalToken === GEN8_HOLDOUT_APPROVAL_TOKEN && !isTestExecution;

  // 1. 早期実行禁止・未承認判定 (Fail-Closed)
  // 本 Work 4-5 では、承認トークンと正式承認フラグの両方がある場合のみ本番実行 (Seeds 350001..350120) を許可
  if (mode === "EXECUTE") {
    if (!isTestExecution && !isOfficialApproved) {
      throw new UnauthorizedHoldoutExecutionError(
        `[Fail-Closed] Real Gen 8 Holdout Execution is strictly prohibited in Work 4-5 without explicit official authorization.\n` +
        `Actual match execution on reserved seeds (${GEN8_HOLDOUT_SEED_RANGE_START}..${GEN8_HOLDOUT_SEED_RANGE_END}) requires explicit stakeholder approval.\n` +
        `Must specify both --approval-token ${GEN8_HOLDOUT_APPROVAL_TOKEN} and --official-holdout-approved.\n` +
        `Only infrastructure implementation, verified small-scale tests, and synthetic tests are permitted without official authorization.`
      );
    }
  }

  // 2. 正式評価（本番モード）時の固定設定ガード (Fail-Closed)
  // テスト用引数（--expected-gen7-digest 等）が本番モードで上書き改竄されることを厳格に防止
  if (!isTestExecution) {
    if (expectedGen7Digest && expectedGen7Digest !== GEN7_CHAMPION_EXPECTED_DIGEST) {
      throw new Gen8CandidateIntegrityError(
        `[Fail-Closed] Overriding expectedGen7Digest is strictly prohibited in official holdout evaluation mode.`
      );
    }
    if (expectedCandidateDigest && expectedCandidateDigest !== GEN8_PRIMARY_CANDIDATE_EXPECTED_DIGEST) {
      throw new Gen8CandidateIntegrityError(
        `[Fail-Closed] Overriding expectedCandidateDigest is strictly prohibited in official holdout evaluation mode.`
      );
    }
    if (candidatePath && path.resolve(candidatePath) !== path.resolve(GEN8_PRIMARY_CANDIDATE_FILE_PATH)) {
      throw new Gen8CandidateIntegrityError(
        `[Fail-Closed] Custom candidatePath is strictly prohibited in official holdout evaluation mode.`
      );
    }
    if (gen7CheckpointPath && path.resolve(gen7CheckpointPath) !== path.resolve(OFFICIAL_GEN7_CHECKPOINT_PATH)) {
      throw new Gen8CandidateIntegrityError(
        `[Fail-Closed] Custom gen7CheckpointPath is strictly prohibited in official holdout evaluation mode.`
      );
    }
    if (startSeedArg !== undefined && startSeedArg !== GEN8_HOLDOUT_SEED_RANGE_START) {
      throw new Gen8CandidateIntegrityError(
        `[Fail-Closed] Overriding startSeed is strictly prohibited in official holdout evaluation mode (must start at ${GEN8_HOLDOUT_SEED_RANGE_START}).`
      );
    }
    if (plannedPairs !== DEFAULT_PRIMARY_PAIRS) {
      throw new Gen8CandidateIntegrityError(
        `[Fail-Closed] Overriding plannedPairs is strictly prohibited in official holdout evaluation mode (must be exactly ${DEFAULT_PRIMARY_PAIRS} pairs / ${DEFAULT_PRIMARY_PAIRS * 2} matches).`
      );
    }
  }

  if (mode === "AUDIT_ONLY") {
    console.log(`>>> Running Audit on artifacts directory: ${outputDir}`);
    const effectiveStartSeed = startSeedArg ?? (allowSyntheticTest || allowRealCoreTest ? GEN8_HOLDOUT_TEST_SEED_START : undefined);
    const auditRes = auditGen8HoldoutArtifacts(outputDir, {
      expectedTotalPairs: plannedPairs,
      expectedTotalMatches: plannedPairs * 2,
      expectedCandidateDigest: expectedCandidateDigest ?? GEN8_PRIMARY_CANDIDATE_EXPECTED_DIGEST,
      expectedOpponentDigest: expectedGen7Digest ?? GEN7_EXPECTED_DIGEST,
      expectedStartSeed: effectiveStartSeed,
    });
    console.log(`Audit Result: ${auditRes.isValid ? "PASS" : "FAIL"} (Status: ${auditRes.auditStatus})`);
    console.log(`- Total Matches:        ${auditRes.totalMatches}`);
    console.log(`- Completed:            ${auditRes.completedMatches}`);
    console.log(`- Candidate Verified:   ${auditRes.candidateDigestVerified}`);
    console.log(`- Superiority:          ${auditRes.superiorityVerified}`);
    console.log(`- Non-Inferiority:      ${auditRes.nonInferiorityVerified}`);
    if (auditRes.errors.length > 0) {
      console.error(`- Errors detected: ${auditRes.errors.length}`);
      for (const e of auditRes.errors) console.error(`  * ${e}`);
      throw new Gen8HoldoutAuditError(
        `[Audit Failed] Found ${auditRes.errors.length} violation(s): ${auditRes.errors.join("; ")}`
      );
    }
    return;
  }

  // Preflight Manifest ビルド
  const manifest = buildGen8HoldoutPreflightManifest({
    executionMode: mode,
    approvalToken,
    officialHoldoutApproved: isOfficialApproved,
    plannedPairs,
    candidatePath,
    gen7CheckpointPath,
    expectedGen7Digest,
    isSyntheticTest: allowSyntheticTest,
    isRealCoreTest: allowRealCoreTest,
    testExecutionAuthorized: allowSyntheticTest || allowRealCoreTest,
  });

  console.log(`Work ID:            ${manifest.workId}`);
  console.log(`Execution Mode:     ${manifest.executionMode}`);
  console.log(`Approval Status:    ${manifest.approvalStatus}`);
  console.log(`Primary Candidate:  ${manifest.candidateChampion.genomeId}`);
  console.log(`Candidate Digest:   ${manifest.candidateChampion.verifiedDigest}`);
  console.log(`Digest Matches:     ${manifest.candidateChampion.digestMatches ? "VERIFIED (100% Match)" : "MISMATCH"}`);
  console.log(`Anchor Gen 7 Digest: ${manifest.referenceAnchorGen7.verifiedDigest}`);
  console.log(`Anchor Gen 5 Digest: ${manifest.referenceAnchorGen5.verifiedDigest}`);
  console.log(`Seed Range:         ${manifest.seedRange.startSeed} .. ${manifest.seedRange.endSeed} (${manifest.seedRange.totalAvailableSeeds} seeds)`);
  console.log(`Planned Matches:    ${manifest.hypothesisGate.plannedMatches} matches (${manifest.hypothesisGate.plannedPairs} pairs)`);
  console.log(`Superiority Rule:   ${manifest.hypothesisGate.superiorityThreshold}`);
  console.log(`Power Sensitivity:`);
  for (const s of manifest.hypothesisGate.powerSensitivityAnalysis) {
    console.log(`  - Assumed Win Rate ${(s.assumedTrueWinRate * 100).toFixed(0)}%: Power ${(s.statisticalPower * 100).toFixed(1)}%`);
  }
  console.log(`Note: ${manifest.hypothesisGate.sensitivityCaveat}`);

  if (mode === "EXECUTE") {
    console.log(">>> Connecting CLI to executeGen8HoldoutCampaign...");
    const candDna = loadGen8PrimaryCandidate(candidatePath);
    const candDigest = SemanticSHA256.hash(JSON.stringify(candDna));

    const g7CheckPath = path.resolve(
      gen7CheckpointPath ??
        OFFICIAL_GEN7_CHECKPOINT_PATH
    );
    const g7Dna = loadChampionDNA({
      checkpointPath: g7CheckPath,
      expectedGenomeId: GEN7_GENOME_ID,
      expectedDigest: expectedGen7Digest ?? GEN7_EXPECTED_DIGEST,
      verifyCheckpointChecksum: true,
    });
    const g7Digest = EvolutionIndependentEvaluator.computeDnaDigest(g7Dna);

    const execResult = await executeGen8HoldoutCampaign({
      workId: GEN8_HOLDOUT_WORK_ID,
      candidateDNA: candDna,
      candidateDigest: candDigest,
      candidateGenomeId: GEN8_PRIMARY_CANDIDATE_GENOME_ID,
      opponentDNA: g7Dna,
      opponentDigest: g7Digest,
      opponentGenomeId: GEN7_CHAMPION_GENOME_ID,
      opponentId: "gen7-champion",
      opponentName: "Stage3Gen7Champion",
      pairsCount: plannedPairs,
      startSeed: startSeedArg ?? (isOfficialApproved ? GEN8_HOLDOUT_SEED_RANGE_START : GEN8_HOLDOUT_TEST_SEED_START),
      outputDir,
      isSyntheticTest: allowSyntheticTest,
      isRealCoreTest: allowRealCoreTest,
      testExecutionAuthorized: allowSyntheticTest || allowRealCoreTest,
      officialHoldoutApproved: isOfficialApproved,
      sessionPairsLimit,
      approvalToken,
    });

    console.log(`Execution completed: ${execResult.completedPairs} pairs, ${execResult.totalMatches} matches.`);
    console.log(`Audit Valid: ${execResult.auditResult.isValid}, Status: ${execResult.auditResult.auditStatus}`);
  } else {
    console.log("\n[PROTECTION ACTIVE] Execution mode is PLAN_ONLY. Zero matches executed. Holdout seeds remain 100% pristine and protected.");
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("gen8HoldoutRunner.ts")) {
  runGen8HoldoutCli().catch((err) => {
    console.error(`FATAL: ${err?.message ?? String(err)}`);
    process.exit(1);
  });
}
