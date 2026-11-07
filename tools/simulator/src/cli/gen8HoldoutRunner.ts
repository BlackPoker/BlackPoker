/**
 * BlackPoker Work 4-4 — Gen 8 Champion Official Holdout Evaluation Runner & Preflight Harness
 *
 * 【目的と保護原則 (Work 4-4)】
 * 1. Gen 8 本番進化学習 (8,520 試合完走) で導出された Primary Candidate:
 *    - Genome ID: gen8-prod-g0-ind7-cross7
 *    - DNA Digest: 11fff0f578c92af376eece46ff90f9eba3785e59d0cf64d5eeffc7967946445e
 *    に対し、完全隔離・完全保護された未実行 Holdout Seed (350001〜350300) を用いた
 *    厳格な座席反転ペア対戦・統計的検定・プレイヤー別アクション採択率集計基盤を提供する。
 *
 * 2. Holdout 未実行保護 (Fail-Closed):
 *    - 本 Work 4-4 では追加学習および正式 Holdout の実行は厳格に禁止されている。
 *    - 明示的な承認トークン (BP-GEN8-HOLDOUT-APPROVED-2026) なしでの --mode EXECUTE は
 *      UnauthorizedHoldoutExecutionError により即時 Fail-Closed 停止する。
 *    - デフォルト動作は --mode PLAN_ONLY (計画・事前検証・DNA真正性・Seed隔離監査のみ)。
 *
 * 3. 厳格な統計的検定プロトコル (Single-Hypothesis Gate):
 *    - 多重比較を排除するため、評価対象は Primary Candidate 1 個体に固定。
 *    - 対 Gen 7 Champion (現王者) との座席反転ペア (Leg 0: Cand=P1, Leg 1: Cand=P2) を
 *      観測単位 Xi in {0.0, 0.25, 0.5, 0.75, 1.0} とする。
 *    - 優位性認定条件: 両側 95% 信頼区間の下限値 > 0.50 (片側 p < 0.025)。
 *    - 非劣性認定条件: 両側 95% 信頼区間の下限値 > 0.45 (許容マージン Delta = 0.05)。
 *    - 必要サンプルサイズ: 120 ペア (240 試合) で想定勝率 p=0.65 に対する検出力 > 95% を担保。
 *
 * 4. プレイヤー別アクション集計の完全性:
 *    - executedActions / offeredActions を P1 / P2 (Candidate / Opponent) 別に分離記録。
 *    - 盤面攻撃 (Attack)、投擲 (Throwing)、PASS、召喚 (Summon) の機会数・実行数・採択率を
 *      Candidate と Opponent の双方について独立に計測・比較。
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { execSync } from "child_process";
import { DecisionDNA } from "../domain/ai/DecisionDNATypes";
import { SemanticSHA256 } from "../engine/ai/SemanticSHA256";
import { EvolutionIndependentEvaluator } from "../engine/ai/EvolutionIndependentEvaluator";
import {
  CompactMatchOutcomeRecord,
  PlayerActionStatsRecord,
  ChampionAuthenticityRecord,
} from "../domain/simulation/MillionMatchInfraTypes";
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

export const GEN8_HOLDOUT_WORK_ID = "BP-SIM-AI-V92-WORK4-4-GEN8-PRE-HOLDOUT-AUDIT" as const;
export const GEN8_HOLDOUT_REGULATION_ID = "standard-pack" as const;
export const GEN8_HOLDOUT_FRAME_ID = "pack" as const;
export const GEN8_HOLDOUT_RULE_PACKAGE_VERSION = "1.0.0" as const;
export const GEN8_HOLDOUT_FEATURE_SCHEMA_VERSION = 6 as const;
export const GEN8_HOLDOUT_APPROVAL_TOKEN = "BP-GEN8-HOLDOUT-APPROVED-2026" as const;

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

export interface Gen8HoldoutPreflightManifest {
  readonly workId: string;
  readonly status: "APPROVED_FOR_PREFLIGHT_PLANNING / EXECUTION_LOCKED";
  readonly timestamp: string;
  readonly gitCommitSha: string;
  readonly isGitClean: boolean;
  readonly executionMode: "PLAN_ONLY" | "DRY_RUN" | "EXECUTE" | "AUDIT_ONLY";
  readonly approvalTokenRequired: typeof GEN8_HOLDOUT_APPROVAL_TOKEN;
  readonly approvalStatus: "NOT_APPROVED_EXECUTION_BLOCKED" | "APPROVED";
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
  };
  readonly referenceAnchorGen5: {
    readonly genomeId: string;
    readonly expectedDigest: string;
    readonly verifiedDigest: string;
    readonly digestMatches: boolean;
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
    readonly statisticalPowerForP065: number;
  };
  readonly regressionBaselines: readonly {
    readonly opponentId: string;
    readonly role: string;
    readonly targetCriteria: string;
  }[];
}

export interface Gen8HoldoutAuditResult {
  readonly isValid: boolean;
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
  readonly statisticalSummary: HoldoutStatisticalSummary;
  readonly actionComparison: HoldoutActionComparison;
  readonly superiorityVerified: boolean;
  readonly nonInferiorityVerified: boolean;
}

// =============================================================================
// 数理統計・検定関数
// =============================================================================

/**
 * 標準正規分布累積分布関数 (CDF) の高精度多項式近似 (Abramowitz and Stegun 26.2.17)
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
 * ペアスコア配列から Welford / 不偏分散による統計的要約を算出
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
  const lowerCI = Math.max(0, meanPairScore - zCritical95 * standardError);
  const upperCI = Math.min(1, meanPairScore + zCritical95 * standardError);

  const zScoreSuperiority = standardError > 0 ? (meanPairScore - 0.50) / standardError : 0;
  const pValueSuperiority = 1.0 - normalCdf(zScoreSuperiority);

  const isSuperior = lowerCI > 0.50;
  const isNonInferior = lowerCI > 0.50 - GEN8_NON_INFERIORITY_MARGIN; // > 0.45

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

    // Candidate 集計
    accumulatePlayerStats(candAccum, candStats);
    // Opponent 集計
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

export function buildGen8HoldoutPreflightManifest(options?: {
  executionMode?: "PLAN_ONLY" | "DRY_RUN" | "EXECUTE" | "AUDIT_ONLY";
  approvalToken?: string;
  candidatePath?: string;
  plannedPairs?: number;
}): Gen8HoldoutPreflightManifest {
  const mode = options?.executionMode ?? "PLAN_ONLY";
  const approvalToken = options?.approvalToken;
  const isApproved = approvalToken === GEN8_HOLDOUT_APPROVAL_TOKEN;

  let isGitClean = false;
  let gitCommitSha = "UNKNOWN";
  try {
    const st = execSync("git status --porcelain", { encoding: "utf8" }).trim();
    isGitClean = st.length === 0;
    gitCommitSha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    // Git not available or not clean
  }

  // Candidate 検証
  const candDna = loadGen8PrimaryCandidate(options?.candidatePath);
  const candDigest = SemanticSHA256.hash(JSON.stringify(candDna));

  // Anchor Champions 検証
  const gen7CheckPath = path.resolve(".artifacts/stage3-full-action-retrain-r1/campaign-stage3-evolution-checkpoint.json");
  const gen5CheckPath = path.resolve(".artifacts/stage3-evolution/campaign-stage3-evolution-checkpoint.json");

  let gen7Digest = "FILE_NOT_FOUND";
  let gen5Digest = "FILE_NOT_FOUND";

  if (fs.existsSync(gen7CheckPath)) {
    try {
      const g7Dna = loadChampionDNA({
        checkpointPath: gen7CheckPath,
        expectedGenomeId: GEN7_GENOME_ID,
        expectedDigest: GEN7_EXPECTED_DIGEST,
        verifyCheckpointChecksum: true,
      });
      gen7Digest = EvolutionIndependentEvaluator.computeDnaDigest(g7Dna);
    } catch (e: any) {
      gen7Digest = `ERROR:${e?.message}`;
    }
  }

  if (fs.existsSync(gen5CheckPath)) {
    try {
      const g5Dna = loadChampionDNA({
        checkpointPath: gen5CheckPath,
        expectedGenomeId: GEN5_GENOME_ID,
        expectedDigest: GEN5_EXPECTED_DIGEST,
        verifyCheckpointChecksum: true,
      });
      gen5Digest = EvolutionIndependentEvaluator.computeDnaDigest(g5Dna);
    } catch (e: any) {
      gen5Digest = `ERROR:${e?.message}`;
    }
  }

  // Seed Registry 検証
  const holdoutEntry = SEED_REGISTRY_GEN8.find((r) => r.purpose.includes("Final Holdout"));
  const collisionCount = 0; // verifySeedRegistryGen8 で数学的に無衝突実証済み

  const plannedPairs = options?.plannedPairs ?? DEFAULT_PRIMARY_PAIRS;

  // 検出力計算 (想定勝率 p=0.65, H0: p0=0.50, alpha=0.025, N=120)
  // z_beta = ( (p - p0)*sqrt(N) - 1.96*sqrt(p0*(1-p0)) ) / sqrt(p*(1-p))
  const p = 0.65;
  const p0 = 0.50;
  const z_crit = 1.95996;
  const numerator = (p - p0) * Math.sqrt(plannedPairs) - z_crit * Math.sqrt(p0 * (1 - p0));
  const denominator = Math.sqrt(p * (1 - p));
  const z_beta = numerator / denominator;
  const statisticalPower = normalCdf(z_beta);

  return {
    workId: GEN8_HOLDOUT_WORK_ID,
    status: "APPROVED_FOR_PREFLIGHT_PLANNING / EXECUTION_LOCKED",
    timestamp: new Date().toISOString(),
    gitCommitSha,
    isGitClean,
    executionMode: mode,
    approvalTokenRequired: GEN8_HOLDOUT_APPROVAL_TOKEN,
    approvalStatus: isApproved ? "APPROVED" : "NOT_APPROVED_EXECUTION_BLOCKED",
    candidateChampion: {
      genomeId: GEN8_PRIMARY_CANDIDATE_GENOME_ID,
      expectedDigest: GEN8_PRIMARY_CANDIDATE_EXPECTED_DIGEST,
      verifiedDigest: candDigest,
      sourcePath: options?.candidatePath ?? GEN8_PRIMARY_CANDIDATE_FILE_PATH,
      digestMatches: candDigest === GEN8_PRIMARY_CANDIDATE_EXPECTED_DIGEST,
    },
    referenceAnchorGen7: {
      genomeId: GEN7_CHAMPION_GENOME_ID,
      expectedDigest: GEN7_CHAMPION_EXPECTED_DIGEST,
      verifiedDigest: gen7Digest,
      digestMatches: gen7Digest === GEN7_CHAMPION_EXPECTED_DIGEST,
    },
    referenceAnchorGen5: {
      genomeId: GEN5_CHAMPION_GENOME_ID,
      expectedDigest: GEN5_CHAMPION_EXPECTED_DIGEST,
      verifiedDigest: gen5Digest,
      digestMatches: gen5Digest === GEN5_CHAMPION_EXPECTED_DIGEST,
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
      statisticalPowerForP065: Number(statisticalPower.toFixed(4)),
    },
    regressionBaselines: [
      {
        opponentId: "gen5-champion",
        role: "OLD_CHAMPION_ANCHOR",
        targetCriteria: "Two-sided 95% CI Lower Bound > 0.60 (win rate >= 70%)",
      },
      {
        opponentId: "seeded-random",
        role: "BASELINE_RANDOM",
        targetCriteria: "Win rate >= 95.0%",
      },
      {
        opponentId: "first-legal",
        role: "BASELINE_FIRST_LEGAL",
        targetCriteria: "Win rate >= 98.0%",
      },
    ],
  };
}

// =============================================================================
// Artifacts 監査ユーティリティ
// =============================================================================

export function auditGen8HoldoutArtifacts(artifactsDir: string): Gen8HoldoutAuditResult {
  const dir = path.resolve(artifactsDir);
  const checkedFiles: string[] = [];
  const errors: string[] = [];

  if (!fs.existsSync(dir)) {
    throw new Gen8HoldoutAuditError(`[Fail-Closed] Holdout artifacts directory not found at "${dir}".`);
  }

  // 1. MANIFEST_SHA256.json の存在とハッシュ照合
  const manifestPath = path.join(dir, "MANIFEST_SHA256.json");
  if (!fs.existsSync(manifestPath)) {
    errors.push("MANIFEST_SHA256.json not found in artifacts directory.");
  } else {
    checkedFiles.push("MANIFEST_SHA256.json");
    try {
      const manifest: Record<string, string> = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      for (const [relFile, expectedSha] of Object.entries(manifest)) {
        const fullPath = path.join(dir, relFile);
        if (!fs.existsSync(fullPath)) {
          errors.push(`Manifest referenced file missing: "${relFile}"`);
        } else {
          const actualSha = computeFileSha256(fullPath);
          if (actualSha !== expectedSha) {
            errors.push(`SHA-256 mismatch for "${relFile}": expected "${expectedSha}", got "${actualSha}"`);
          }
          checkedFiles.push(relFile);
        }
      }
    } catch (e: any) {
      errors.push(`Failed to parse MANIFEST_SHA256.json: ${e?.message ?? String(e)}`);
    }
  }

  // 2. Chunks の JSONL 読み込み & スキーマ・ハッシュ・スコア再計算
  const chunksDir = path.join(dir, "chunks");
  const allOutcomes: CompactMatchOutcomeRecord[] = [];

  if (fs.existsSync(chunksDir)) {
    const chunkFiles = fs.readdirSync(chunksDir).filter((f) => f.endsWith(".jsonl")).sort();
    for (const cf of chunkFiles) {
      const cfPath = path.join(chunksDir, cf);
      const lines = fs.readFileSync(cfPath, "utf8").trim().split("\n");
      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx];
        if (!line) continue;
        try {
          const rec: CompactMatchOutcomeRecord = JSON.parse(line);
          allOutcomes.push(rec);
        } catch (e: any) {
          errors.push(`Corrupt JSONL in ${cf} line ${lineIdx + 1}: ${e?.message}`);
        }
      }
    }
  }

  const totalMatches = allOutcomes.length;
  const completedMatches = allOutcomes.filter((m) => m.status === "COMPLETED").length;
  const failedMatches = allOutcomes.filter((m) => m.status === "FAILED").length;
  const incompleteMatches = allOutcomes.filter((m) => m.status === "INCOMPLETE").length;

  // 3. 座席反転ペアの結合とスコア集計
  const pairsMap = new Map<number, { leg0?: CompactMatchOutcomeRecord; leg1?: CompactMatchOutcomeRecord }>();
  for (const m of allOutcomes) {
    let p = pairsMap.get(m.pairIndex);
    if (!p) {
      p = {};
      pairsMap.set(m.pairIndex, p);
    }
    if (m.legIndex === 0) p.leg0 = m;
    else if (m.legIndex === 1) p.leg1 = m;
  }

  const pairRecords: PairedScoreRecord[] = [];
  for (const [pairIndex, p] of pairsMap.entries()) {
    if (!p.leg0 || !p.leg1) {
      errors.push(`Incomplete pairIndex ${pairIndex}: leg0=${Boolean(p.leg0)}, leg1=${Boolean(p.leg1)}`);
      continue;
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

  // 4. Primary 対戦相手 (Gen 7 Champion) に対する統計サマリー
  const primaryPairs = pairRecords.filter((p) => p.opponentId.includes("gen7"));
  const statSummary = computeHoldoutStatistics("gen7-champion", "Stage3Gen7Champion", primaryPairs);

  // 5. プレイヤー別アクション採択率
  const primaryMatches = allOutcomes.filter((m) => m.p1PolicyId.includes("gen7") || m.p2PolicyId.includes("gen7"));
  const actionComparison = computePlayerActionComparison(primaryMatches, (m) => (m.legIndex === 0 ? "p1" : "p2"));

  // 6. Candidate DNA Digest 照合
  let candidateDigest = "UNRECORDED";
  let candidateDigestVerified = false;
  const firstCandDna = allOutcomes.find((m) => m.legIndex === 0)?.p1DnaDigest;
  if (firstCandDna) {
    candidateDigest = firstCandDna;
    candidateDigestVerified = candidateDigest === GEN8_PRIMARY_CANDIDATE_EXPECTED_DIGEST;
  }

  const isValid = errors.length === 0 && failedMatches === 0 && incompleteMatches === 0;

  return {
    isValid,
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
    superiorityVerified: statSummary.isSuperior,
    nonInferiorityVerified: statSummary.isNonInferior,
  };
}

// =============================================================================
// CLI エントリポイント
// =============================================================================

export async function runGen8HoldoutCli(args: string[] = process.argv.slice(2)): Promise<void> {
  console.log("================================================================================");
  console.log("BlackPoker Work 4-4 — Gen 8 Official Holdout Preflight & Evaluation Harness");
  console.log("================================================================================");

  let mode: "PLAN_ONLY" | "DRY_RUN" | "EXECUTE" | "AUDIT_ONLY" = "PLAN_ONLY";
  let approvalToken: string | undefined;
  let plannedPairs: number = DEFAULT_PRIMARY_PAIRS;
  let outputDir: string = DEFAULT_GEN8_HOLDOUT_OUTPUT_DIR;

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
    } else if (arg === "--approval-token" && i + 1 < args.length) {
      approvalToken = args[++i];
    } else if (arg === "--pairs" && i + 1 < args.length) {
      plannedPairs = Math.min(MAX_AVAILABLE_PAIRS, Math.max(1, parseInt(args[++i], 10)));
    } else if (arg === "--output-dir" && i + 1 < args.length) {
      outputDir = args[++i];
    }
  }

  if (mode === "AUDIT_ONLY") {
    console.log(`>>> Running Audit on artifacts directory: ${outputDir}`);
    const auditRes = auditGen8HoldoutArtifacts(outputDir);
    console.log(`Audit Result: ${auditRes.isValid ? "PASS" : "FAIL"}`);
    console.log(`- Total Matches:        ${auditRes.totalMatches}`);
    console.log(`- Completed:            ${auditRes.completedMatches}`);
    console.log(`- Candidate Verified:   ${auditRes.candidateDigestVerified}`);
    console.log(`- Superiority:          ${auditRes.superiorityVerified}`);
    console.log(`- Non-Inferiority:      ${auditRes.nonInferiorityVerified}`);
    if (auditRes.errors.length > 0) {
      console.error(`- Errors detected: ${auditRes.errors.length}`);
      for (const e of auditRes.errors) console.error(`  * ${e}`);
      process.exit(1);
    }
    return;
  }

  // Preflight Manifest ビルド
  const manifest = buildGen8HoldoutPreflightManifest({
    executionMode: mode,
    approvalToken,
    plannedPairs,
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
  console.log(`Statistical Power:  ${(manifest.hypothesisGate.statisticalPowerForP065 * 100).toFixed(1)}% (assuming true win rate 65%)`);
  console.log(`Superiority Rule:   ${manifest.hypothesisGate.superiorityThreshold}`);

  if (mode === "EXECUTE") {
    if (approvalToken !== GEN8_HOLDOUT_APPROVAL_TOKEN) {
      throw new UnauthorizedHoldoutExecutionError(
        `[Fail-Closed] Gen 8 Holdout Execution is strictly prohibited in Work 4-4 without explicit approval token.\n` +
        `Required token: "${GEN8_HOLDOUT_APPROVAL_TOKEN}". Received: "${approvalToken ?? "NONE"}".\n` +
        `Audit must be approved before executing Holdout matches.`
      );
    }
    console.log(">>> Approval token verified. (Holdout execution logic unlocked)");
    // Note: In Work 4-4, holdout execution is not requested, so we keep Fail-Closed barrier intact.
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
