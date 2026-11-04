/**
 * BlackPoker Work 3-6 — Stage 3 Champion Holdout Evaluation Runner (R1 改訂版)
 *
 * 【目的と保護原則】
 * 1. Stage 3 Full Action Space Retraining R1 で導出された Gen 7 Champion に対し、
 *    完全未使用の本番 Holdout 240 試合 (Seeds: 95001〜95030, 30 Seeds × 2 座席 × 4 比較相手) を用いた
 *    決定論的・統計的性能評価を実行する。
 * 2. Holdout 未使用保護の Fail-Closed:
 *    - 明示的な --execute 指定がない限り、本番 Holdout (Seeds 95001〜95030) は一切実行しない。
 *    - --dry-run, --smoke, --execute は相互排他的であり、矛盾する引数や不明な引数は Fail-Closed。
 *    - --execute では Git Working Tree が Clean でなければ実行を拒否する。
 * 3. 原本保護:
 *    - 旧 Stage 3 原本 (.artifacts/stage3-evolution) および新 Stage 3 原本 (.artifacts/stage3-full-action-retrain-r1)
 *      への誤上書きを Fail-Closed で拒絶。
 *    - Smoke のデフォルト出力先 (.artifacts/stage3-holdout-smoke) は本番用 (.artifacts/stage3-holdout-evaluation)
 *      から物理的に分離。
 * 4. 厳格な統計契約と性能認定:
 *    - 意思決定上限は再学習 Stage 3 と同一の 500 回に統一。
 *    - 座席反転ペア対戦 (Leg 0: P1=Cand / Leg 1: P2=Cand) によるペアスコア Xi in {0, 0.25, 0.5, 0.75, 1} 集計。
 *    - 4 比較相手に対する Bonferroni 補正片側検定 (alpha = 0.0125) による厳格な判定。
 *    - 非劣性 (Non-inferiority: 下限 > 0.45) と優位性 (Superiority: 下限 > 0.50) を分離し、
 *      非劣性のみの場合は IMPROVEMENT_UNVERIFIED とする契約。
 *    - 240 試合の完全性、座席反転、Seed 構成、統計サマリーの独立再計算照合を含む自己監査。
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import * as fflate from "fflate";
import { DecisionDNA } from "../domain/ai/DecisionDNATypes";
import {
  EvaluationConfig,
  EvaluationOpponentDefinition,
  EvaluationSeedSet,
  IndependentEvaluationResult,
  PairedMatchResult,
} from "../domain/ai/EvolutionEvaluationTypes";
import { DecisionDNACodec } from "../engine/ai/DecisionDNACodec";
import { EvolutionIndependentEvaluator } from "../engine/ai/EvolutionIndependentEvaluator";
import { EvolutionCampaignManager } from "../engine/ai/EvolutionCampaignManager";
import { FirstLegalPolicy, RandomPolicy } from "../engine/simulation/DecisionPolicy";
import { GenomePolicy } from "../engine/ai/GenomePolicy";
import { BatchSimulationOptions } from "../domain/simulation/BatchSimulationTypes";
import {
  deriveStage3TrainingSeedsByEngine,
  prepareOfficialSessionFactory,
  CAMPAIGN_SEED,
  VALIDATION_SEEDS_COUNT,
  HOLDOUT_SEEDS_COUNT,
} from "./stage3EvolutionRunner";

// =============================================================================
// 定数定義
// =============================================================================

export const HOLDOUT_WORK_ID = "BP-SIM-AI-V92-WORK3-STAGE3-HOLDOUT-EVALUATION" as const;
export const HOLDOUT_REGULATION_ID = "standard-pack" as const;
export const HOLDOUT_FRAME_ID = "pack" as const;
export const HOLDOUT_RULE_PACKAGE_VERSION = "1.0.0" as const;
export const HOLDOUT_FEATURE_SCHEMA_VERSION = 6 as const;

export const CANDIDATE_CHAMPION_GENOME_ID = "gen-000007-offspring-000007" as const;
export const CANDIDATE_CHAMPION_EXPECTED_DIGEST =
  "04a1e2fa1b25c117558a9fb71fc60a57b10a26750540474d4c858e139e7aa3f4" as const;

export const OLD_CHAMPION_GENOME_ID = "gen-000005-offspring-000008" as const;
export const OLD_CHAMPION_EXPECTED_DIGEST =
  "e8e8ae8f5449077b0f219afc827f6fc13f5e309408bb2d18817c62f87494ae91" as const;

export const DEFAULT_HOLDOUT_ARTIFACTS_DIR: string = ".artifacts/stage3-holdout-evaluation";
export const DEFAULT_HOLDOUT_ZIP_PATH: string = ".artifacts/stage3-holdout-evaluation.zip";
export const DEFAULT_SMOKE_ARTIFACTS_DIR: string = ".artifacts/stage3-holdout-smoke";

export const PROTECTED_RETRAIN_DIR = ".artifacts/stage3-full-action-retrain-r1" as const;
export const PROTECTED_OLD_STAGE3_DIR = ".artifacts/stage3-evolution" as const;

/** 意思決定上限: 再学習 Stage 3 と整合性を保つため 500 回に統一 */
export const DEFAULT_MAX_DECISIONS_PER_MATCH = 500 as const;
export const HOLDOUT_SIGNIFICANCE_ALPHA = 0.05 as const;
export const HOLDOUT_OPPONENTS_COUNT = 4 as const;
export const HOLDOUT_BONFERRONI_ALPHA = HOLDOUT_SIGNIFICANCE_ALPHA / HOLDOUT_OPPONENTS_COUNT; // 0.0125

/** 本番 Holdout Seeds (30 Seeds: 95001〜95030) */
export const OFFICIAL_HOLDOUT_SEEDS: readonly number[] = Object.freeze(
  Array.from({ length: HOLDOUT_SEEDS_COUNT }, (_, i) => 95001 + i)
);

/** 診断用独立スモーク Seeds (2 Seeds: 99951〜99952) */
export const SMOKE_DIAGNOSTIC_SEEDS: readonly number[] = Object.freeze([99951, 99952]);

// =============================================================================
// 型定義 (認定ステータス・マニフェスト)
// =============================================================================

export type HoldoutCertificationStatus =
  | "SUPERIORITY_VERIFIED"
  | "NON_INFERIORITY_VERIFIED"
  | "PERFORMANCE_UNVERIFIED"
  | "INVALID_EVIDENCE";

export interface HoldoutPreflightManifest {
  readonly workId: string;
  readonly runnerTimestamp: string;
  readonly gitCommitSha: string;
  readonly isGitClean: boolean;
  readonly executionMode: "EXECUTE" | "DRY_RUN" | "SMOKE";
  readonly regulationId: string;
  readonly frameId: string;
  readonly rulePackageVersion: string;
  readonly featureSchemaVersion: number;
  readonly decisionLimitPerMatch: number;
  readonly candidateChampion: {
    readonly genomeId: string;
    readonly expectedDigest: string;
    readonly verifiedDigest: string;
    readonly sourcePath: string;
  };
  readonly oldChampion: {
    readonly genomeId: string;
    readonly expectedDigest: string;
    readonly verifiedDigest: string;
    readonly sourcePath: string;
  };
  readonly zeroDnaDigest: string;
  readonly seeds: {
    readonly category: "HOLDOUT" | "SMOKE";
    readonly count: number;
    readonly seedList: readonly number[];
  };
  readonly opponents: readonly {
    readonly opponentId: string;
    readonly name: string;
    readonly role: string;
    readonly targetWinRate: number;
  }[];
  readonly plannedMatches: {
    readonly seedsCount: number;
    readonly pairsPerOpponent: number;
    readonly matchesPerOpponent: number;
    readonly totalPairs: number;
    readonly totalMatches: number;
  };
  readonly artifactsDir: string;
}

export interface HoldoutIndividualMatchOutcome {
  readonly matchIndex: number;
  readonly matchId: string;
  readonly pairIndex: number;
  readonly legIndex: 0 | 1;
  readonly matchSeed: number;
  readonly opponentId: string;
  readonly opponentName: string;
  readonly candidateSeat: "p1" | "p2";
  readonly opponentSeat: "p1" | "p2";
  readonly completed: boolean;
  readonly winner?: "p1" | "p2" | "draw";
  readonly candidateWon: boolean;
  readonly candidateDraw: boolean;
  readonly candidateLost: boolean;
  readonly totalDecisions: number;
  readonly turnCount: number;
  readonly reason?: string;
  readonly failed: boolean;
  readonly incomplete: boolean;
  readonly reachedDecisionLimit: boolean;
  readonly instantiationFailures: number | "UNMEASURED";
  readonly finalStateHash?: string;
}

export interface HoldoutEvaluationOutput {
  readonly preflightManifest: HoldoutPreflightManifest;
  readonly evaluationResult: IndependentEvaluationResult;
  readonly allIndividualOutcomes: readonly HoldoutIndividualMatchOutcome[];
  readonly totalMatches: number;
  readonly completedMatches: number;
  readonly failedMatches: number;
  readonly incompleteMatches: number;
  readonly matchesReachingDecisionLimit: number;
  readonly totalInstantiationFailures: number | "UNMEASURED";
  readonly totalDecisions: number;
  readonly maxDecisionsInSingleMatch: number;
  readonly minDecisionsInSingleMatch: number;
  readonly executionElapsedMs: number;
  readonly certificationStatus: HoldoutCertificationStatus;
  readonly effectiveImprovementStatus: "IMPROVEMENT_VERIFIED" | "IMPROVEMENT_UNVERIFIED" | "CONFIRMED_REGRESSION";
}

export interface SaveHoldoutArtifactsResult {
  readonly artifactsDir: string;
  readonly savedFiles: readonly string[];
  readonly manifestSha256: Record<string, string>;
}

export interface AuditHoldoutResult {
  readonly isValid: boolean;
  readonly checkedFiles: readonly string[];
  readonly errors: readonly string[];
  readonly executionMode: "EXECUTE" | "SMOKE" | "UNKNOWN";
  readonly totalMatches: number;
  readonly completedMatches: number;
  readonly failedMatches: number;
  readonly incompleteMatches: number;
  readonly matchesReachingDecisionLimit: number;
  readonly totalInstantiationFailures: number | "UNMEASURED";
  readonly candidateDigest: string;
  readonly candidateDigestMatches: boolean;
  readonly oldChampionDigest: string;
  readonly oldChampionDigestMatches: boolean;
  readonly allBaselineTargetsMet: boolean;
  readonly referenceSuperiorityVerified: boolean;
  readonly referenceNonInferiorityVerified: boolean;
  readonly evidenceStatus: string;
  readonly improvementStatus: string;
  readonly certificationStatus: HoldoutCertificationStatus;
}

// =============================================================================
// ハッシュ & Git 検証ユーティリティ
// =============================================================================

export function computeFileSha256(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

export function checkGitCleanliness(): { isClean: boolean; headCommitSha: string } {
  try {
    const statusOutput = execSync("git status --porcelain", { encoding: "utf8" }).trim();
    const isClean = statusOutput.length === 0;
    const headCommitSha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
    return { isClean, headCommitSha };
  } catch (err) {
    return { isClean: false, headCommitSha: "GIT_CHECK_FAILED" };
  }
}

// =============================================================================
// 出力先ディレクトリ & ZIP 保護 (Fail-Closed)
// =============================================================================

export function validateArtifactsDirectory(artifactsDir: string, zipPath?: string): void {
  const resolved = path.resolve(artifactsDir);
  const protectedPaths = [
    path.resolve(PROTECTED_RETRAIN_DIR),
    path.resolve(PROTECTED_OLD_STAGE3_DIR),
    path.resolve(".artifacts/stage2-evolution"),
    path.resolve(".artifacts/stage1-pilot"),
  ];

  for (const prot of protectedPaths) {
    if (resolved === prot || resolved.startsWith(prot + path.sep)) {
      throw new Error(
        `[Fail-Closed] Output directory "${artifactsDir}" targets a protected artifact directory ("${prot}"). Modification or overwrite is strictly forbidden.`
      );
    }
  }

  if (fs.existsSync(resolved)) {
    const entries = fs.readdirSync(resolved);
    if (entries.length > 0) {
      throw new Error(
        `[Fail-Closed] Output directory "${artifactsDir}" already exists and is not empty (${entries.length} items found). Specify a new, empty directory to ensure evidence integrity.`
      );
    }
  }

  // ZIP の上書き防止
  const targetZip = zipPath ? path.resolve(zipPath) : path.resolve(artifactsDir + ".zip");
  if (fs.existsSync(targetZip)) {
    throw new Error(
      `[Fail-Closed] Output zip file "${targetZip}" already exists. Overwriting existing archive is strictly forbidden.`
    );
  }
}

// =============================================================================
// DNA 読み込み & 真正性・Checkpoint 完全性検証
// =============================================================================

export function loadChampionDNA(params: {
  checkpointPath: string;
  expectedGenomeId: string;
  expectedDigest: string;
  verifyCheckpointChecksum?: boolean;
}): DecisionDNA {
  const { checkpointPath, expectedGenomeId, expectedDigest, verifyCheckpointChecksum = true } = params;
  if (!fs.existsSync(checkpointPath)) {
    throw new Error(`[Fail-Closed] Checkpoint file not found: "${checkpointPath}"`);
  }

  const rawJson = fs.readFileSync(checkpointPath, "utf8");
  let checkpoint: any;
  try {
    checkpoint = JSON.parse(rawJson);
  } catch (err: any) {
    throw new Error(`[Fail-Closed] Failed to parse checkpoint JSON "${checkpointPath}": ${err?.message ?? String(err)}`);
  }

  // 1. Checkpoint 内部チェックサム検証 (完全性保証 & 改ざん防止)
  if (verifyCheckpointChecksum) {
    if (!checkpoint.checksum || typeof checkpoint.checksum !== "string") {
      throw new Error(
        `[Fail-Closed] Checkpoint checksum missing or invalid type in "${checkpointPath}". Expected 64-character SHA-256 hex string.`
      );
    }
    const checksumRegex = /^[a-f0-9]{64}$/i;
    if (!checksumRegex.test(checkpoint.checksum)) {
      throw new Error(
        `[Fail-Closed] Checkpoint checksum format invalid in "${checkpointPath}": expected 64-char hex string, got "${checkpoint.checksum}"`
      );
    }
    const { checksum, ...stateWithoutChecksum } = checkpoint;
    const computedChecksum = EvolutionCampaignManager.computeCheckpointChecksum(stateWithoutChecksum);
    if (computedChecksum !== checksum) {
      throw new Error(
        `[Fail-Closed] Checkpoint checksum mismatch in "${checkpointPath}": expected "${computedChecksum}", found "${checksum}" (tampering or corruption detected)`
      );
    }

    // 原本 Manifest が同階層に存在する場合、Checkpoint ファイル自体の SHA-256 も照合 (実験由来の確認)
    const manifestPath = path.join(path.dirname(checkpointPath), "MANIFEST_SHA256.json");
    if (fs.existsSync(manifestPath)) {
      try {
        const manifestObj = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        const baseName = path.basename(checkpointPath);
        const expectedFileSha = manifestObj[baseName];
        if (expectedFileSha && typeof expectedFileSha === "string") {
          const actualFileSha = computeFileSha256(checkpointPath);
          if (actualFileSha !== expectedFileSha) {
            throw new Error(
              `[Fail-Closed] Manifest SHA-256 mismatch for "${checkpointPath}": expected "${expectedFileSha}", got "${actualFileSha}"`
            );
          }
        }
      } catch (err: any) {
        if (err.message.startsWith("[Fail-Closed]")) throw err;
      }
    }
  }

  // 2. provisionalBestChampion の検証
  const championData = checkpoint.provisionalBestChampion;
  if (!championData) {
    throw new Error(`[Fail-Closed] provisionalBestChampion missing in checkpoint "${checkpointPath}"`);
  }

  if (championData.genomeId !== expectedGenomeId) {
    throw new Error(
      `[Fail-Closed] Genome ID mismatch in "${checkpointPath}": expected "${expectedGenomeId}", but found "${championData.genomeId}"`
    );
  }

  const dna = championData.dna as DecisionDNA;
  DecisionDNACodec.validate(dna);

  const actualDigest = EvolutionIndependentEvaluator.computeDnaDigest(dna);
  if (actualDigest !== expectedDigest) {
    throw new Error(
      `[Fail-Closed] DNA Digest mismatch for "${expectedGenomeId}": expected "${expectedDigest}", but computed "${actualDigest}"`
    );
  }

  return dna;
}

export function createZeroDNA(): DecisionDNA {
  const zeroDNA = DecisionDNACodec.createZeroDecisionDNA({
    id: "baseline-zero-dna-v1",
    name: "ZeroDNA",
  });
  DecisionDNACodec.validate(zeroDNA);
  return zeroDNA;
}

// =============================================================================
// Seed 衝突防止検証 (Fail-Closed)
// =============================================================================

export function validateHoldoutSeedPlan(
  holdoutSeeds: readonly number[],
  campaignSeed: number = CAMPAIGN_SEED
): void {
  // 配列自体の厳格検証
  if (!Array.isArray(holdoutSeeds) || holdoutSeeds.length === 0) {
    throw new Error("[Fail-Closed] holdoutSeeds must be a non-empty array");
  }

  const trainingSeeds = deriveStage3TrainingSeedsByEngine(campaignSeed).allTrainingSeedsList;
  const validationSeeds: number[] = [];
  for (let i = 0; i < VALIDATION_SEEDS_COUNT; i++) {
    validationSeeds.push(94001 + i);
  }

  const seedSets: EvaluationSeedSet[] = [
    { category: "TRAINING", seeds: trainingSeeds },
    { category: "VALIDATION", seeds: validationSeeds },
    { category: "HOLDOUT", seeds: holdoutSeeds },
  ];

  EvolutionIndependentEvaluator.assertNoSeedCollision(seedSets);
}

// =============================================================================
// 対戦相手定義 (4種)
// =============================================================================

export function createHoldoutOpponents(params: {
  oldChampionDNA: DecisionDNA;
  zeroDNA: DecisionDNA;
  expectedOldChampionDigest?: string;
}): readonly EvaluationOpponentDefinition[] {
  const {
    oldChampionDNA,
    zeroDNA,
    expectedOldChampionDigest = OLD_CHAMPION_EXPECTED_DIGEST,
  } = params;

  return [
    {
      opponentId: "holdout-first-legal",
      name: "FirstLegal",
      targetWinRate: 0.85,
      role: "BASELINE",
      policyFactory: () => new FirstLegalPolicy(false),
    },
    {
      opponentId: "holdout-seeded-random",
      name: "SeededRandom",
      targetWinRate: 0.75,
      role: "BASELINE",
      policyFactory: (seat, matchSeed, playerSeeds) =>
        new RandomPolicy(playerSeeds[seat], `SeededRandom-${seat}`),
    },
    {
      opponentId: "holdout-zero-dna",
      name: "ZeroDNA",
      targetWinRate: 0.70,
      role: "BASELINE",
      policyFactory: () => new GenomePolicy(zeroDNA, "ZeroDNA"),
    },
    {
      opponentId: "holdout-stage3-gen5-champion",
      name: "Stage3Gen5Champion",
      targetWinRate: 0.50,
      role: "REFERENCE_CHAMPION",
      referenceDNA: oldChampionDNA,
      expectedDnaDigest: expectedOldChampionDigest,
    },
  ];
}

// =============================================================================
// 性能認定判定ロジック (Certification Logic)
// =============================================================================

export function computeHoldoutCertification(params: {
  evaluationResult: IndependentEvaluationResult;
  failedMatches: number;
  incompleteMatches: number;
  matchesReachingDecisionLimit: number;
  totalInstantiationFailures: number | "UNMEASURED";
  totalMatches: number;
  expectedMatches: number;
}): {
  certificationStatus: HoldoutCertificationStatus;
  effectiveImprovementStatus: "IMPROVEMENT_VERIFIED" | "IMPROVEMENT_UNVERIFIED" | "CONFIRMED_REGRESSION";
  baselineSuperior: boolean;
  referenceSuperiorityVerified: boolean;
  referenceNonInferiorityVerified: boolean;
} {
  const {
    evaluationResult,
    failedMatches,
    incompleteMatches,
    matchesReachingDecisionLimit,
    totalInstantiationFailures,
    totalMatches,
    expectedMatches,
  } = params;

  // 1. 実行完全性検証 (Fail-Closed)
  const isExecutionValid =
    failedMatches === 0 &&
    incompleteMatches === 0 &&
    matchesReachingDecisionLimit === 0 &&
    totalInstantiationFailures === 0 &&
    totalMatches === expectedMatches &&
    evaluationResult.evidenceStatus === "VALID";

  if (!isExecutionValid) {
    return {
      certificationStatus: "INVALID_EVIDENCE",
      effectiveImprovementStatus: "IMPROVEMENT_UNVERIFIED",
      baselineSuperior: false,
      referenceSuperiorityVerified: false,
      referenceNonInferiorityVerified: false,
    };
  }

  // 2. Baseline 3 相手すべて合格判定
  const firstLegal = evaluationResult.opponents["holdout-first-legal"];
  const seededRandom = evaluationResult.opponents["holdout-seeded-random"];
  const zeroDna = evaluationResult.opponents["holdout-zero-dna"];

  const baselineSuperior =
    !!firstLegal &&
    firstLegal.meanPairScore >= 0.85 &&
    firstLegal.statisticalTest.oneSidedLowerBound > 0.50 &&
    !!seededRandom &&
    seededRandom.meanPairScore >= 0.75 &&
    seededRandom.statisticalTest.oneSidedLowerBound > 0.50 &&
    !!zeroDna &&
    zeroDna.meanPairScore >= 0.70 &&
    zeroDna.statisticalTest.oneSidedLowerBound > 0.50;

  // 3. Reference Champion 判定 (対 Stage3Gen5Champion)
  const refChamp = evaluationResult.opponents["holdout-stage3-gen5-champion"];
  let referenceSuperiorityVerified = false;
  let referenceNonInferiorityVerified = false;

  if (refChamp) {
    // 優位性 (Superiority): 平均勝率 > 0.50 かつ Bonferroni 補正片側下限 > 0.50
    referenceSuperiorityVerified =
      refChamp.meanPairScore > 0.50 && refChamp.statisticalTest.oneSidedLowerBound > 0.50;

    // 非劣性 (Non-Inferiority): 平均勝率 >= 0.50 かつ Bonferroni 補正片側下限 > 0.45 (マージン Delta = 0.05)
    referenceNonInferiorityVerified =
      refChamp.meanPairScore >= 0.50 && refChamp.statisticalTest.oneSidedLowerBound > 0.45;
  }

  // 4. 総合認定ステータス決定
  let certificationStatus: HoldoutCertificationStatus = "PERFORMANCE_UNVERIFIED";
  let effectiveImprovementStatus: "IMPROVEMENT_VERIFIED" | "IMPROVEMENT_UNVERIFIED" | "CONFIRMED_REGRESSION" =
    "IMPROVEMENT_UNVERIFIED";

  if (baselineSuperior && referenceSuperiorityVerified) {
    certificationStatus = "SUPERIORITY_VERIFIED";
    effectiveImprovementStatus = "IMPROVEMENT_VERIFIED";
  } else if (baselineSuperior && referenceNonInferiorityVerified) {
    certificationStatus = "NON_INFERIORITY_VERIFIED";
    // 重要契約: 非劣性のみ達成の場合は優位性（改善）は未証明のため IMPROVEMENT_UNVERIFIED とする
    effectiveImprovementStatus = "IMPROVEMENT_UNVERIFIED";
  } else {
    certificationStatus = "PERFORMANCE_UNVERIFIED";
    effectiveImprovementStatus = "IMPROVEMENT_UNVERIFIED";
  }

  return {
    certificationStatus,
    effectiveImprovementStatus,
    baselineSuperior,
    referenceSuperiorityVerified,
    referenceNonInferiorityVerified,
  };
}

// =============================================================================
// Preflight Manifest 生成
// =============================================================================

export function buildHoldoutPreflightManifest(params: {
  candidateDNA: DecisionDNA;
  candidateSourcePath: string;
  oldChampionDNA: DecisionDNA;
  oldChampionSourcePath: string;
  zeroDNA: DecisionDNA;
  seeds: readonly number[];
  executionMode: "EXECUTE" | "DRY_RUN" | "SMOKE";
  artifactsDir: string;
  gitInfo: { isClean: boolean; headCommitSha: string };
  maxDecisionsPerMatch?: number;
}): HoldoutPreflightManifest {
  const {
    candidateDNA,
    candidateSourcePath,
    oldChampionDNA,
    oldChampionSourcePath,
    zeroDNA,
    seeds,
    executionMode,
    artifactsDir,
    gitInfo,
    maxDecisionsPerMatch = DEFAULT_MAX_DECISIONS_PER_MATCH,
  } = params;

  const candidateDigest = EvolutionIndependentEvaluator.computeDnaDigest(candidateDNA);
  const oldChampionDigest = EvolutionIndependentEvaluator.computeDnaDigest(oldChampionDNA);
  const zeroDigest = EvolutionIndependentEvaluator.computeDnaDigest(zeroDNA);

  const opponents = createHoldoutOpponents({ oldChampionDNA, zeroDNA });

  const pairsPerOpponent = seeds.length;
  const matchesPerOpponent = pairsPerOpponent * 2;
  const totalPairs = pairsPerOpponent * opponents.length;
  const totalMatches = matchesPerOpponent * opponents.length;

  return {
    workId: HOLDOUT_WORK_ID,
    runnerTimestamp: new Date().toISOString(),
    gitCommitSha: gitInfo.headCommitSha,
    isGitClean: gitInfo.isClean,
    executionMode,
    regulationId: HOLDOUT_REGULATION_ID,
    frameId: HOLDOUT_FRAME_ID,
    rulePackageVersion: HOLDOUT_RULE_PACKAGE_VERSION,
    featureSchemaVersion: HOLDOUT_FEATURE_SCHEMA_VERSION,
    decisionLimitPerMatch: maxDecisionsPerMatch,
    candidateChampion: {
      genomeId: CANDIDATE_CHAMPION_GENOME_ID,
      expectedDigest: CANDIDATE_CHAMPION_EXPECTED_DIGEST,
      verifiedDigest: candidateDigest,
      sourcePath: candidateSourcePath,
    },
    oldChampion: {
      genomeId: OLD_CHAMPION_GENOME_ID,
      expectedDigest: OLD_CHAMPION_EXPECTED_DIGEST,
      verifiedDigest: oldChampionDigest,
      sourcePath: oldChampionSourcePath,
    },
    zeroDnaDigest: zeroDigest,
    seeds: {
      category: executionMode === "SMOKE" ? "SMOKE" : "HOLDOUT",
      count: seeds.length,
      seedList: seeds,
    },
    opponents: opponents.map((o) => ({
      opponentId: o.opponentId,
      name: o.name,
      role: o.role ?? "BASELINE",
      targetWinRate: o.targetWinRate,
    })),
    plannedMatches: {
      seedsCount: seeds.length,
      pairsPerOpponent,
      matchesPerOpponent,
      totalPairs,
      totalMatches,
    },
    artifactsDir,
  };
}

// =============================================================================
// 評価実行ロジック
// =============================================================================

export function executeHoldoutEvaluation(params: {
  candidateDNA: DecisionDNA;
  oldChampionDNA: DecisionDNA;
  zeroDNA: DecisionDNA;
  seeds: readonly number[];
  preflightManifest: HoldoutPreflightManifest;
  sessionFactory: BatchSimulationOptions["sessionFactory"];
  maxDecisionsPerMatch?: number;
  expectedOldChampionDigest?: string;
}): HoldoutEvaluationOutput {
  const {
    candidateDNA,
    oldChampionDNA,
    zeroDNA,
    seeds,
    preflightManifest,
    sessionFactory,
    maxDecisionsPerMatch = DEFAULT_MAX_DECISIONS_PER_MATCH,
    expectedOldChampionDigest = preflightManifest.oldChampion.verifiedDigest,
  } = params;

  const opponents = createHoldoutOpponents({
    oldChampionDNA,
    zeroDNA,
    expectedOldChampionDigest,
  });

  // Holdout 契約: 過去の全 Training および Validation Seed 集合を seedRegistry として提供
  const trainingSeeds = deriveStage3TrainingSeedsByEngine(CAMPAIGN_SEED).allTrainingSeedsList;
  const validationSeeds: number[] = [];
  for (let i = 0; i < VALIDATION_SEEDS_COUNT; i++) {
    validationSeeds.push(94001 + i);
  }
  const seedRegistry: EvaluationSeedSet[] = [
    { category: "TRAINING", seeds: trainingSeeds },
    { category: "VALIDATION", seeds: validationSeeds },
  ];

  const startTime = performance.now();

  const config: EvaluationConfig = {
    candidateDNA,
    seeds,
    seedCategory: "HOLDOUT",
    seedRegistry,
    opponents,
    sessionFactory,
    maxDecisionsPerMatch,
    significanceLevelAlpha: HOLDOUT_SIGNIFICANCE_ALPHA,
    minimumCompletedPairs: 2, // スモーク時も許容するため2ペア以上
    regulationId: HOLDOUT_REGULATION_ID,
    rulePackageVersion: HOLDOUT_RULE_PACKAGE_VERSION,
    featureSchemaVersion: HOLDOUT_FEATURE_SCHEMA_VERSION,
  };

  const evalResult = EvolutionIndependentEvaluator.evaluate(config);
  const elapsedMs = performance.now() - startTime;

  // 試合すべての個別 Outcome を抽出
  const allIndividualOutcomes: HoldoutIndividualMatchOutcome[] = [];
  let totalDecisions = 0;
  let maxDecisions = 0;
  let minDecisions = Infinity;
  let completedMatches = 0;
  let failedMatches = 0;
  let incompleteMatches = 0;
  let matchesReachingDecisionLimit = 0;
  let totalInstantiationFailures: number | "UNMEASURED" = 0;

  for (const pair of evalResult.pairs) {
    const oppDef = opponents.find((o) => o.opponentId === pair.opponentId);
    const oppName = oppDef?.name ?? pair.opponentId;

    const reached0 = pair.leg0.totalDecisions >= maxDecisionsPerMatch;
    const reached1 = pair.leg1.totalDecisions >= maxDecisionsPerMatch;
    if (reached0) matchesReachingDecisionLimit++;
    if (reached1) matchesReachingDecisionLimit++;

    const instFailures0 = pair.leg0.instantiationFailures ?? "UNMEASURED";
    const instFailures1 = pair.leg1.instantiationFailures ?? "UNMEASURED";

    if (instFailures0 === "UNMEASURED" || instFailures1 === "UNMEASURED") {
      totalInstantiationFailures = "UNMEASURED";
    } else if (typeof totalInstantiationFailures === "number") {
      totalInstantiationFailures += instFailures0 + instFailures1;
    }

    // Leg 0
    const leg0Outcome: HoldoutIndividualMatchOutcome = {
      matchIndex: pair.pairIndex * 2,
      matchId: `pair-${pair.pairIndex}-leg0-${pair.matchSeed}-cand-vs-${pair.opponentId}`,
      pairIndex: pair.pairIndex,
      legIndex: 0,
      matchSeed: pair.matchSeed,
      opponentId: pair.opponentId,
      opponentName: oppName,
      candidateSeat: pair.leg0.candidateSeat,
      opponentSeat: pair.leg0.opponentSeat,
      completed: pair.leg0.completed,
      winner: pair.leg0.winner,
      candidateWon: pair.leg0.candidateWon,
      candidateDraw: pair.leg0.candidateDraw,
      candidateLost: pair.leg0.candidateLost,
      totalDecisions: pair.leg0.totalDecisions,
      turnCount: pair.leg0.turnCount,
      reason: pair.leg0.reason,
      failed: pair.leg0.failed,
      incomplete: pair.leg0.incomplete,
      reachedDecisionLimit: reached0,
      instantiationFailures: instFailures0,
      finalStateHash: pair.leg0.finalStateHash,
    };
    allIndividualOutcomes.push(leg0Outcome);

    // Leg 1
    const leg1Outcome: HoldoutIndividualMatchOutcome = {
      matchIndex: pair.pairIndex * 2 + 1,
      matchId: `pair-${pair.pairIndex}-leg1-${pair.matchSeed}-${pair.opponentId}-vs-cand`,
      pairIndex: pair.pairIndex,
      legIndex: 1,
      matchSeed: pair.matchSeed,
      opponentId: pair.opponentId,
      opponentName: oppName,
      candidateSeat: pair.leg1.candidateSeat,
      opponentSeat: pair.leg1.opponentSeat,
      completed: pair.leg1.completed,
      winner: pair.leg1.winner,
      candidateWon: pair.leg1.candidateWon,
      candidateDraw: pair.leg1.candidateDraw,
      candidateLost: pair.leg1.candidateLost,
      totalDecisions: pair.leg1.totalDecisions,
      turnCount: pair.leg1.turnCount,
      reason: pair.leg1.reason,
      failed: pair.leg1.failed,
      incomplete: pair.leg1.incomplete,
      reachedDecisionLimit: reached1,
      instantiationFailures: instFailures1,
      finalStateHash: pair.leg1.finalStateHash,
    };
    allIndividualOutcomes.push(leg1Outcome);

    for (const leg of [pair.leg0, pair.leg1]) {
      if (leg.completed) completedMatches++;
      if (leg.failed) failedMatches++;
      if (leg.incomplete) incompleteMatches++;
      totalDecisions += leg.totalDecisions;
      if (leg.totalDecisions > maxDecisions) maxDecisions = leg.totalDecisions;
      if (leg.totalDecisions < minDecisions && leg.totalDecisions > 0) minDecisions = leg.totalDecisions;
    }
  }

  if (minDecisions === Infinity) minDecisions = 0;

  // 性能認定ステータスの算出
  const cert = computeHoldoutCertification({
    evaluationResult: evalResult,
    failedMatches,
    incompleteMatches,
    matchesReachingDecisionLimit,
    totalInstantiationFailures,
    totalMatches: allIndividualOutcomes.length,
    expectedMatches: preflightManifest.plannedMatches.totalMatches,
  });

  return {
    preflightManifest,
    evaluationResult: evalResult,
    allIndividualOutcomes,
    totalMatches: allIndividualOutcomes.length,
    completedMatches,
    failedMatches,
    incompleteMatches,
    matchesReachingDecisionLimit,
    totalInstantiationFailures,
    totalDecisions,
    maxDecisionsInSingleMatch: maxDecisions,
    minDecisionsInSingleMatch: minDecisions,
    executionElapsedMs: elapsedMs,
    certificationStatus: cert.certificationStatus,
    effectiveImprovementStatus: cert.effectiveImprovementStatus,
  };
}

// =============================================================================
// 成果物保存 & Markdown レポート生成
// =============================================================================

export function generateHoldoutAuditMarkdown(
  output: HoldoutEvaluationOutput,
  manifestSha256: Record<string, string>
): string {
  const { preflightManifest, evaluationResult, totalMatches, completedMatches, failedMatches, incompleteMatches } =
    output;

  const lines: string[] = [];
  lines.push(`# Champion Holdout Evaluation Audit Report`);
  lines.push(``);
  lines.push(`- **Work ID:** \`${preflightManifest.workId}\``);
  lines.push(`- **Execution Mode:** \`${preflightManifest.executionMode}\``);
  lines.push(`- **Git Commit SHA:** \`${preflightManifest.gitCommitSha}\` (Clean: \`${preflightManifest.isGitClean}\`)`);
  lines.push(`- **Regulation:** \`${preflightManifest.regulationId}\` (Frame: \`${preflightManifest.frameId}\`, Schema: v${preflightManifest.featureSchemaVersion})`);
  lines.push(`- **Decision Limit per Match:** \`${preflightManifest.decisionLimitPerMatch}\` decisions`);
  lines.push(`- **Timestamp:** \`${preflightManifest.runnerTimestamp}\``);
  lines.push(`- **Execution Elapsed:** \`${(output.executionElapsedMs / 1000).toFixed(2)}s\``);
  lines.push(``);
  lines.push(`## 1. 評価対象 Champion DNA`);
  lines.push(``);
  lines.push(`- **Candidate Genome ID:** \`${preflightManifest.candidateChampion.genomeId}\``);
  lines.push(`- **Verified DNA Digest:** \`${preflightManifest.candidateChampion.verifiedDigest}\``);
  lines.push(`- **Digest Match:** \`${preflightManifest.candidateChampion.verifiedDigest === preflightManifest.candidateChampion.expectedDigest}\``);
  lines.push(`- **Reference Genome ID:** \`${preflightManifest.oldChampion.genomeId}\``);
  lines.push(`- **Reference DNA Digest:** \`${preflightManifest.oldChampion.verifiedDigest}\``);
  lines.push(`- **Reference Digest Match:** \`${preflightManifest.oldChampion.verifiedDigest === preflightManifest.oldChampion.expectedDigest}\``);
  lines.push(``);
  lines.push(`## 2. 試合完走状況 & 実行完全性`);
  lines.push(``);
  lines.push(`- **総試合数:** ${totalMatches}`);
  lines.push(`- **完了試合数 (Completed):** ${completedMatches}`);
  lines.push(`- **失敗試合数 (Failed):** ${failedMatches}`);
  lines.push(`- **未完試合数 (Incomplete):** ${incompleteMatches}`);
  lines.push(`- **意思決定上限到達試合数 (Stall):** ${output.matchesReachingDecisionLimit}`);
  lines.push(`- **Core 実体化失敗数:** ${output.totalInstantiationFailures}`);
  lines.push(`- **総意思決定数:** ${output.totalDecisions} (Max: ${output.maxDecisionsInSingleMatch}, Min: ${output.minDecisionsInSingleMatch})`);
  lines.push(``);
  lines.push(`## 3. 対戦相手別 統計結果サマリー (Bonferroni alpha = ${HOLDOUT_BONFERRONI_ALPHA})`);
  lines.push(``);
  lines.push(`| 対戦相手 | Role | ペア数 | 平均勝率 | 95% CI (両側) | 片側信頼下限 (Bonferroni) | 目標勝率 | 目標達成 | 検定結果 |`);
  lines.push(`| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |`);

  for (const opp of Object.values(evaluationResult.opponents)) {
    const ciStr = `[${opp.confidenceInterval95.lower.toFixed(3)}, ${opp.confidenceInterval95.upper.toFixed(3)}]`;
    const lowerBoundStr = opp.statisticalTest.oneSidedLowerBound.toFixed(3);
    const sigStr = opp.statisticalTest.isStatisticallySignificant ? "SIGNIFICANT" : "NOT_SIG";
    lines.push(
      `| **${opp.opponentName}** | \`${opp.role}\` | ${opp.completedPairs}/${opp.totalPairs} | **${(opp.meanPairScore * 100).toFixed(1)}%** | ${ciStr} | ${lowerBoundStr} | ${(opp.targetWinRate * 100).toFixed(1)}% | \`${opp.targetMet}\` | \`${sigStr}\` |`
    );
  }

  lines.push(``);
  lines.push(`## 4. 総合認定ステータス`);
  lines.push(``);
  lines.push(`- **Certification Status:** \`${output.certificationStatus}\``);
  lines.push(`- **Evidence Status:** \`${evaluationResult.evidenceStatus}\``);
  lines.push(`- **Improvement Status:** \`${evaluationResult.improvementStatus}\``);
  lines.push(`- **Baseline Superior:** \`${evaluationResult.baselineSuperior}\``);
  lines.push(`- **Champion Improved:** \`${evaluationResult.championImproved}\``);
  lines.push(`- **All Targets Met:** \`${evaluationResult.allTargetsMet}\``);
  lines.push(``);
  lines.push(`## 5. Artifact Manifest SHA-256`);
  lines.push(``);
  lines.push(`\`\`\`json`);
  lines.push(JSON.stringify(manifestSha256, null, 2));
  lines.push(`\`\`\``);

  return lines.join("\n");
}

export function saveHoldoutArtifacts(
  output: HoldoutEvaluationOutput,
  artifactsDir: string = DEFAULT_HOLDOUT_ARTIFACTS_DIR
): SaveHoldoutArtifactsResult {
  fs.mkdirSync(artifactsDir, { recursive: true });

  const savedFiles: string[] = [];

  // 1. preflight-manifest.json
  const preflightPath = path.join(artifactsDir, "preflight-manifest.json");
  fs.writeFileSync(preflightPath, JSON.stringify(output.preflightManifest, null, 2), "utf8");
  savedFiles.push("preflight-manifest.json");

  // 2. holdout-evaluation-protocol.json
  const protocolPath = path.join(artifactsDir, "holdout-evaluation-protocol.json");
  const protocolData = {
    workId: output.preflightManifest.workId,
    executionMode: output.preflightManifest.executionMode,
    regulationId: output.preflightManifest.regulationId,
    frameId: output.preflightManifest.frameId,
    candidateChampion: output.preflightManifest.candidateChampion,
    oldChampion: output.preflightManifest.oldChampion,
    zeroDnaDigest: output.preflightManifest.zeroDnaDigest,
    seeds: output.preflightManifest.seeds,
    opponents: output.preflightManifest.opponents,
    plannedMatches: output.preflightManifest.plannedMatches,
    significanceLevelAlpha: HOLDOUT_SIGNIFICANCE_ALPHA,
    bonferroniAdjustedAlpha: HOLDOUT_BONFERRONI_ALPHA,
    decisionLimitPerMatch: output.preflightManifest.decisionLimitPerMatch,
  };
  fs.writeFileSync(protocolPath, JSON.stringify(protocolData, null, 2), "utf8");
  savedFiles.push("holdout-evaluation-protocol.json");

  // 3. holdout-evaluation-result.json
  const resultPath = path.join(artifactsDir, "holdout-evaluation-result.json");
  const resultData = {
    evaluationSummary: output.evaluationResult.logicalResult,
    individualOutcomes: output.allIndividualOutcomes,
    runtimeMetrics: output.evaluationResult.runtimeMetrics,
  };
  fs.writeFileSync(resultPath, JSON.stringify(resultData, null, 2), "utf8");
  savedFiles.push("holdout-evaluation-result.json");

  // 4. holdout-evaluation-evidence.json
  const evidencePath = path.join(artifactsDir, "holdout-evaluation-evidence.json");
  const evidenceData = {
    workId: output.preflightManifest.workId,
    executionMode: output.preflightManifest.executionMode,
    timestamp: output.preflightManifest.runnerTimestamp,
    gitCommitSha: output.preflightManifest.gitCommitSha,
    isGitClean: output.preflightManifest.isGitClean,
    candidateChampionGenomeId: output.preflightManifest.candidateChampion.genomeId,
    candidateChampionDnaDigest: output.preflightManifest.candidateChampion.verifiedDigest,
    oldChampionGenomeId: output.preflightManifest.oldChampion.genomeId,
    oldChampionDnaDigest: output.preflightManifest.oldChampion.verifiedDigest,
    totalMatches: output.totalMatches,
    completedMatches: output.completedMatches,
    failedMatches: output.failedMatches,
    incompleteMatches: output.incompleteMatches,
    matchesReachingDecisionLimit: output.matchesReachingDecisionLimit,
    totalInstantiationFailures: output.totalInstantiationFailures,
    certificationStatus: output.certificationStatus,
    evidenceStatus: output.evaluationResult.evidenceStatus,
    improvementStatus: output.effectiveImprovementStatus,
    baselineSuperior: output.evaluationResult.baselineSuperior,
    championImproved: output.evaluationResult.championImproved,
    allTargetsMet: output.evaluationResult.allTargetsMet,
    opponentsSummary: output.evaluationResult.opponents,
  };
  fs.writeFileSync(evidencePath, JSON.stringify(evidenceData, null, 2), "utf8");
  savedFiles.push("holdout-evaluation-evidence.json");

  // 仮の MANIFEST_SHA256 を計算して Markdown レポートを生成
  const interimManifest: Record<string, string> = {};
  for (const f of savedFiles) {
    interimManifest[f] = computeFileSha256(path.join(artifactsDir, f));
  }

  const auditReportMd = generateHoldoutAuditMarkdown(output, interimManifest);

  // 5. STAGE3_HOLDOUT_AUDIT_REPORT.md
  const auditReportPath = path.join(artifactsDir, "STAGE3_HOLDOUT_AUDIT_REPORT.md");
  fs.writeFileSync(auditReportPath, auditReportMd, "utf8");
  savedFiles.push("STAGE3_HOLDOUT_AUDIT_REPORT.md");

  // 6. AUDIT_HOLDOUT_EVIDENCE.md (同義エイリアス)
  const auditEvidencePath = path.join(artifactsDir, "AUDIT_HOLDOUT_EVIDENCE.md");
  fs.writeFileSync(auditEvidencePath, auditReportMd, "utf8");
  savedFiles.push("AUDIT_HOLDOUT_EVIDENCE.md");

  // 7. MANIFEST_SHA256.json の最終確定
  const finalManifest: Record<string, string> = {};
  for (const f of savedFiles) {
    finalManifest[f] = computeFileSha256(path.join(artifactsDir, f));
  }
  const manifestPath = path.join(artifactsDir, "MANIFEST_SHA256.json");
  fs.writeFileSync(manifestPath, JSON.stringify(finalManifest, null, 2), "utf8");
  savedFiles.push("MANIFEST_SHA256.json");

  return {
    artifactsDir,
    savedFiles,
    manifestSha256: finalManifest,
  };
}

// =============================================================================
// 自己監査機能 (Fail-Closed & 240試合完全性照合)
// =============================================================================

export function auditHoldoutArtifacts(
  artifactsDir: string,
  options?: {
    expectedCandidateDigest?: string;
    expectedOldChampionDigest?: string;
  }
): AuditHoldoutResult {
  const errors: string[] = [];
  const checkedFiles: string[] = [];

  const manifestPath = path.join(artifactsDir, "MANIFEST_SHA256.json");
  if (!fs.existsSync(manifestPath)) {
    return {
      isValid: false,
      checkedFiles,
      errors: [`Manifest file not found: "${manifestPath}"`],
      executionMode: "UNKNOWN",
      totalMatches: 0,
      completedMatches: 0,
      failedMatches: 0,
      incompleteMatches: 0,
      matchesReachingDecisionLimit: 0,
      totalInstantiationFailures: 0,
      candidateDigest: "",
      candidateDigestMatches: false,
      oldChampionDigest: "",
      oldChampionDigestMatches: false,
      allBaselineTargetsMet: false,
      referenceSuperiorityVerified: false,
      referenceNonInferiorityVerified: false,
      evidenceStatus: "INVALID_EVIDENCE",
      improvementStatus: "CONFIRMED_REGRESSION",
      certificationStatus: "INVALID_EVIDENCE",
    };
  }

  const manifest: Record<string, string> = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  // 1. 必須ファイルの存在とハッシュ照合
  const requiredFiles = [
    "preflight-manifest.json",
    "holdout-evaluation-protocol.json",
    "holdout-evaluation-result.json",
    "holdout-evaluation-evidence.json",
    "STAGE3_HOLDOUT_AUDIT_REPORT.md",
    "AUDIT_HOLDOUT_EVIDENCE.md",
  ];

  for (const f of requiredFiles) {
    checkedFiles.push(f);
    const expectedSha = manifest[f];
    if (!expectedSha) {
      errors.push(`Required file "${f}" missing in MANIFEST_SHA256.json`);
      continue;
    }
    const realPath = path.join(artifactsDir, f);
    if (!fs.existsSync(realPath)) {
      errors.push(`Required file "${f}" not found on disk at "${realPath}"`);
      continue;
    }
    const actualSha = computeFileSha256(realPath);
    if (actualSha !== expectedSha) {
      errors.push(`SHA-256 mismatch for "${f}": expected "${expectedSha}", but got "${actualSha}"`);
    }
  }

  // 2. Preflight Manifest から実行モードの取得
  const preflightPath = path.join(artifactsDir, "preflight-manifest.json");
  const preflight: HoldoutPreflightManifest = JSON.parse(fs.readFileSync(preflightPath, "utf8"));
  const executionMode = preflight.executionMode ?? "UNKNOWN";

  // 3. 結果ファイル (holdout-evaluation-result.json) の詳細構成検証
  const resultPath = path.join(artifactsDir, "holdout-evaluation-result.json");
  const resultJson = JSON.parse(fs.readFileSync(resultPath, "utf8"));
  const outcomes: readonly HoldoutIndividualMatchOutcome[] = resultJson.individualOutcomes ?? [];
  const evalSummary = resultJson.evaluationSummary;

  let completedMatches = 0;
  let failedMatches = 0;
  let incompleteMatches = 0;
  let matchesReachingDecisionLimit = 0;
  let totalInstantiationFailures: number | "UNMEASURED" = 0;

  // 期待される試合数・ペア数設定
  const expectedMatches = executionMode === "EXECUTE" ? 240 : executionMode === "SMOKE" ? 16 : -1;
  const expectedPairs = executionMode === "EXECUTE" ? 120 : executionMode === "SMOKE" ? 8 : -1;
  const expectedSeeds = executionMode === "EXECUTE" ? OFFICIAL_HOLDOUT_SEEDS : SMOKE_DIAGNOSTIC_SEEDS;

  if (expectedMatches !== -1 && outcomes.length !== expectedMatches) {
    errors.push(
      `Total matches count mismatch for ${executionMode} mode: expected ${expectedMatches}, but got ${outcomes.length}`
    );
  }

  // 対戦相手別 & Seed 別の構成追跡
  const expectedOpponentIds = [
    "holdout-first-legal",
    "holdout-seeded-random",
    "holdout-zero-dna",
    "holdout-stage3-gen5-champion",
  ];
  const observedSeeds = new Set<number>();
  const observedMatchIds = new Set<string>();
  const observedPairsKey = new Set<string>();
  const opponentMatchCounts: Record<string, number> = {};
  const pairMap = new Map<number, { leg0?: HoldoutIndividualMatchOutcome; leg1?: HoldoutIndividualMatchOutcome }>();

  for (const m of outcomes) {
    // 状態矛盾チェック: completed=false かつ failed=false かつ incomplete=false は論理破綻として即拒否
    if (!m.completed && !m.failed && !m.incomplete) {
      errors.push(`Match ${m.matchId} has contradictory state: completed=false, failed=false, incomplete=false`);
    }

    if (m.completed) completedMatches++;
    if (m.failed) failedMatches++;
    if (m.incomplete) incompleteMatches++;
    if (m.reachedDecisionLimit) matchesReachingDecisionLimit++;

    // 実体化失敗テレメトリーの厳格監査
    if (m.instantiationFailures === "UNMEASURED") {
      errors.push(`Match ${m.matchId} has UNMEASURED instantiation failures`);
      totalInstantiationFailures = "UNMEASURED";
    } else if (typeof m.instantiationFailures === "number") {
      if (m.instantiationFailures > 0) {
        errors.push(`Match ${m.matchId} detected ${m.instantiationFailures} core instantiation failure(s)`);
      }
      if (typeof totalInstantiationFailures === "number") {
        totalInstantiationFailures += m.instantiationFailures;
      }
    } else {
      errors.push(`Match ${m.matchId} has invalid instantiationFailures type: ${typeof m.instantiationFailures}`);
    }

    // matchId 一意性
    if (!m.matchId || typeof m.matchId !== "string") {
      errors.push(`Match has missing or invalid matchId`);
    } else if (observedMatchIds.has(m.matchId)) {
      errors.push(`Duplicate matchId detected: "${m.matchId}"`);
    } else {
      observedMatchIds.add(m.matchId);
    }

    // 勝者と candidateWon, candidateLost, candidateDraw の整合性検証
    const wonCount = (m.candidateWon ? 1 : 0) + (m.candidateLost ? 1 : 0) + (m.candidateDraw ? 1 : 0);
    if (m.completed && wonCount !== 1) {
      errors.push(
        `Match ${m.matchId} has contradictory candidate outcome flags: won=${m.candidateWon}, lost=${m.candidateLost}, draw=${m.candidateDraw}`
      );
    }

    if (m.candidateWon) {
      const expectedWinner = m.candidateSeat;
      if (m.winner !== expectedWinner) {
        errors.push(
          `Match ${m.matchId} winner mismatch: candidateWon=true but winner="${m.winner}" (expected "${expectedWinner}")`
        );
      }
    } else if (m.candidateLost) {
      const expectedWinner = m.opponentSeat;
      if (m.winner !== expectedWinner) {
        errors.push(
          `Match ${m.matchId} winner mismatch: candidateLost=true but winner="${m.winner}" (expected "${expectedWinner}")`
        );
      }
    } else if (m.candidateDraw) {
      if (m.winner !== "draw" && m.winner !== undefined) {
        errors.push(
          `Match ${m.matchId} winner mismatch: candidateDraw=true but winner="${m.winner}" (expected "draw")`
        );
      }
    }

    // 座席反転契約の検証
    if (m.legIndex === 0) {
      if (m.candidateSeat !== "p1" || m.opponentSeat !== "p2") {
        errors.push(`Match ${m.matchId} Leg 0 seat mismatch: candidate=${m.candidateSeat}, opponent=${m.opponentSeat}`);
      }
    } else if (m.legIndex === 1) {
      if (m.candidateSeat !== "p2" || m.opponentSeat !== "p1") {
        errors.push(`Match ${m.matchId} Leg 1 seat mismatch: candidate=${m.candidateSeat}, opponent=${m.opponentSeat}`);
      }
    } else {
      errors.push(`Match ${m.matchId} has invalid legIndex: ${m.legIndex}`);
    }

    // ペアマップ登録と重複 Leg チェック
    const p = pairMap.get(m.pairIndex) ?? {};
    if (m.legIndex === 0) {
      if (p.leg0) errors.push(`Duplicate Leg 0 for pairIndex ${m.pairIndex}`);
      p.leg0 = m;
    } else if (m.legIndex === 1) {
      if (p.leg1) errors.push(`Duplicate Leg 1 for pairIndex ${m.pairIndex}`);
      p.leg1 = m;
    }
    pairMap.set(m.pairIndex, p);

    observedSeeds.add(m.matchSeed);
    opponentMatchCounts[m.opponentId] = (opponentMatchCounts[m.opponentId] ?? 0) + 1;

    // ペア一意性キー
    const pairKey = `${m.opponentId}-seed-${m.matchSeed}-leg-${m.legIndex}`;
    if (observedPairsKey.has(pairKey)) {
      errors.push(`Duplicate match entry detected: ${pairKey}`);
    } else {
      observedPairsKey.add(pairKey);
    }
  }

  // 4. ペア構造および対応一致の完全性検証
  if (expectedPairs !== -1 && pairMap.size !== expectedPairs) {
    errors.push(`Total unique pairIndex count mismatch: expected ${expectedPairs}, got ${pairMap.size}`);
  }

  for (const [pIdx, pair] of pairMap.entries()) {
    if (!pair.leg0 || !pair.leg1) {
      errors.push(`Pair ${pIdx} is incomplete: leg0=${!!pair.leg0}, leg1=${!!pair.leg1}`);
      continue;
    }
    if (pair.leg0.matchSeed !== pair.leg1.matchSeed) {
      errors.push(
        `Pair ${pIdx} matchSeed mismatch: Leg 0 has ${pair.leg0.matchSeed}, Leg 1 has ${pair.leg1.matchSeed}`
      );
    }
    if (pair.leg0.opponentId !== pair.leg1.opponentId) {
      errors.push(
        `Pair ${pIdx} opponentId mismatch: Leg 0 has ${pair.leg0.opponentId}, Leg 1 has ${pair.leg1.opponentId}`
      );
    }
  }

  // 相手構成および Seed 構成の網羅性照合
  if (executionMode === "EXECUTE") {
    // 4相手の試合数照合 (各60試合)
    for (const oppId of expectedOpponentIds) {
      const cnt = opponentMatchCounts[oppId] ?? 0;
      if (cnt !== 60) {
        errors.push(`Opponent "${oppId}" matches count mismatch: expected 60, got ${cnt}`);
      }
    }

    // Seed 集合照合 (95001〜95030 のみ)
    const expectedSeedSet = new Set(expectedSeeds);
    if (observedSeeds.size !== 30) {
      errors.push(`Unique match seeds count mismatch: expected 30, got ${observedSeeds.size}`);
    }
    for (const s of observedSeeds) {
      if (!expectedSeedSet.has(s)) {
        errors.push(`Unexpected match seed observed: ${s} (only 95001..95030 permitted in EXECUTE mode)`);
      }
    }

    if (completedMatches !== 240) errors.push(`completedMatches mismatch: expected 240, got ${completedMatches}`);
    if (failedMatches > 0) errors.push(`Detected ${failedMatches} failed match(es)`);
    if (incompleteMatches > 0) errors.push(`Detected ${incompleteMatches} incomplete match(es)`);
    if (matchesReachingDecisionLimit > 0) {
      errors.push(`Detected ${matchesReachingDecisionLimit} match(es) reaching decision limit`);
    }
    if (totalInstantiationFailures !== 0) {
      errors.push(`Detected non-zero or unmeasured core instantiation failures: ${totalInstantiationFailures}`);
    }
  } else if (executionMode === "SMOKE") {
    for (const oppId of expectedOpponentIds) {
      const cnt = opponentMatchCounts[oppId] ?? 0;
      if (cnt !== 4) {
        errors.push(`Opponent "${oppId}" matches count mismatch for SMOKE: expected 4, got ${cnt}`);
      }
    }
    const expectedSeedSet = new Set(expectedSeeds);
    if (observedSeeds.size !== 2) {
      errors.push(`Unique match seeds count mismatch for SMOKE: expected 2, got ${observedSeeds.size}`);
    }
    for (const s of observedSeeds) {
      if (!expectedSeedSet.has(s)) {
        errors.push(`Unexpected match seed observed in SMOKE: ${s}`);
      }
    }
    if (failedMatches > 0) errors.push(`Detected ${failedMatches} failed match(es) in SMOKE`);
    if (incompleteMatches > 0) errors.push(`Detected ${incompleteMatches} incomplete match(es) in SMOKE`);
    if (matchesReachingDecisionLimit > 0) {
      errors.push(`Detected ${matchesReachingDecisionLimit} match(es) reaching decision limit in SMOKE`);
    }
    if (totalInstantiationFailures !== 0) {
      errors.push(`Detected non-zero or unmeasured core instantiation failures in SMOKE: ${totalInstantiationFailures}`);
    }
  }

  // 5. Evidence JSON の照合
  const evidencePath = path.join(artifactsDir, "holdout-evaluation-evidence.json");
  const evidenceJson = JSON.parse(fs.readFileSync(evidencePath, "utf8"));

  const expectedCandDigest =
    executionMode === "EXECUTE"
      ? CANDIDATE_CHAMPION_EXPECTED_DIGEST
      : options?.expectedCandidateDigest ??
        preflight.candidateChampion?.verifiedDigest ??
        CANDIDATE_CHAMPION_EXPECTED_DIGEST;
  const candidateDigest = evidenceJson.candidateChampionDnaDigest;
  const candidateDigestMatches = candidateDigest === expectedCandDigest;
  if (!candidateDigestMatches) {
    errors.push(
      `Candidate DNA digest mismatch: expected "${expectedCandDigest}", but got "${candidateDigest}"`
    );
  }

  const expectedOldDigest =
    executionMode === "EXECUTE"
      ? OLD_CHAMPION_EXPECTED_DIGEST
      : options?.expectedOldChampionDigest ??
        preflight.oldChampion?.verifiedDigest ??
        OLD_CHAMPION_EXPECTED_DIGEST;
  const oldChampionDigest = evidenceJson.oldChampionDnaDigest;
  const oldChampionDigestMatches = oldChampionDigest === expectedOldDigest;
  if (!oldChampionDigestMatches) {
    errors.push(
      `Old Champion DNA digest mismatch: expected "${expectedOldDigest}", but got "${oldChampionDigest}"`
    );
  }

  // 6. 統計サマリーの個別 Outcome からの完全独立再計算と照合
  const recalculatedOpponentSummaries: Record<string, any> = {};

  for (const oppId of expectedOpponentIds) {
    const oppPairs: { pIdx: number; leg0: HoldoutIndividualMatchOutcome; leg1: HoldoutIndividualMatchOutcome }[] = [];
    for (const [pIdx, pair] of pairMap.entries()) {
      if (pair.leg0?.opponentId === oppId && pair.leg1?.opponentId === oppId) {
        oppPairs.push({ pIdx, leg0: pair.leg0, leg1: pair.leg1 });
      }
    }

    const pairScores: number[] = [];
    let oppFailedPairs = 0;
    let oppIncompletePairs = 0;

    for (const p of oppPairs) {
      if (p.leg0.failed || p.leg1.failed) {
        oppFailedPairs++;
      } else if (p.leg0.incomplete || p.leg1.incomplete || !p.leg0.completed || !p.leg1.completed) {
        oppIncompletePairs++;
      } else {
        const s0 = p.leg0.candidateWon ? 1.0 : p.leg0.candidateDraw ? 0.5 : 0.0;
        const s1 = p.leg1.candidateWon ? 1.0 : p.leg1.candidateDraw ? 0.5 : 0.0;
        pairScores.push((s0 + s1) / 2.0);
      }
    }

    const targetWinRate =
      oppId === "holdout-first-legal"
        ? 0.85
        : oppId === "holdout-seeded-random"
        ? 0.75
        : oppId === "holdout-zero-dna"
        ? 0.70
        : 0.50;

    const stats = EvolutionIndependentEvaluator.computeStatistics({
      pairScores,
      failedCount: oppFailedPairs,
      incompleteCount: oppIncompletePairs,
      targetWinRate,
      alpha: HOLDOUT_BONFERRONI_ALPHA,
      minCompletedPairs: executionMode === "SMOKE" ? 2 : 5,
    });

    recalculatedOpponentSummaries[oppId] = stats;

    // 保存されたサマリーとの照合
    const savedOpp = evalSummary?.opponents?.[oppId];
    if (!savedOpp) {
      errors.push(`Opponent "${oppId}" missing in evaluationSummary.opponents`);
      continue;
    }

    if (Math.abs(stats.meanPairScore - savedOpp.meanPairScore) > 1e-9) {
      errors.push(
        `Statistical mismatch for "${oppId}": recalculated mean (${stats.meanPairScore}) does not match saved mean (${savedOpp.meanPairScore})`
      );
    }
    if (Math.abs(stats.sampleVariance - savedOpp.sampleVariance) > 1e-9) {
      errors.push(
        `Statistical mismatch for "${oppId}": recalculated variance (${stats.sampleVariance}) does not match saved variance (${savedOpp.sampleVariance})`
      );
    }
    if (Math.abs(stats.standardError - savedOpp.standardError) > 1e-9) {
      errors.push(
        `Statistical mismatch for "${oppId}": recalculated standard error (${stats.standardError}) does not match saved standard error (${savedOpp.standardError})`
      );
    }
    if (Math.abs(stats.confidenceInterval95.lower - (savedOpp.confidenceInterval95?.lower ?? 0)) > 1e-9) {
      errors.push(
        `Statistical mismatch for "${oppId}": recalculated CI95 lower (${stats.confidenceInterval95.lower}) does not match saved CI95 lower (${savedOpp.confidenceInterval95?.lower})`
      );
    }
    if (Math.abs(stats.confidenceInterval95.upper - (savedOpp.confidenceInterval95?.upper ?? 0)) > 1e-9) {
      errors.push(
        `Statistical mismatch for "${oppId}": recalculated CI95 upper (${stats.confidenceInterval95.upper}) does not match saved CI95 upper (${savedOpp.confidenceInterval95?.upper})`
      );
    }
    if (
      Math.abs(stats.statisticalTest.oneSidedLowerBound - (savedOpp.statisticalTest?.oneSidedLowerBound ?? 0)) > 1e-9
    ) {
      errors.push(
        `Statistical mismatch for "${oppId}": recalculated one-sided lower bound (${stats.statisticalTest.oneSidedLowerBound}) does not match saved (${savedOpp.statisticalTest?.oneSidedLowerBound})`
      );
    }
    if (stats.targetMet !== savedOpp.targetMet) {
      errors.push(`Target met mismatch for "${oppId}": recalculated ${stats.targetMet}, saved ${savedOpp.targetMet}`);
    }
  }

  // 7. 再計算結果からの判定再導出と認定値一貫性照合
  const isExecutionValidRecalc =
    completedMatches === (executionMode === "EXECUTE" ? 240 : 16) &&
    failedMatches === 0 &&
    incompleteMatches === 0 &&
    matchesReachingDecisionLimit === 0 &&
    totalInstantiationFailures === 0;

  const firstLegalStats = recalculatedOpponentSummaries["holdout-first-legal"];
  const seededRandomStats = recalculatedOpponentSummaries["holdout-seeded-random"];
  const zeroDnaStats = recalculatedOpponentSummaries["holdout-zero-dna"];
  const refChampStats = recalculatedOpponentSummaries["holdout-stage3-gen5-champion"];

  const recalcBaselineSuperior =
    isExecutionValidRecalc &&
    !!firstLegalStats &&
    firstLegalStats.meanPairScore >= 0.85 &&
    firstLegalStats.statisticalTest.oneSidedLowerBound > 0.50 &&
    !!seededRandomStats &&
    seededRandomStats.meanPairScore >= 0.75 &&
    seededRandomStats.statisticalTest.oneSidedLowerBound > 0.50 &&
    !!zeroDnaStats &&
    zeroDnaStats.meanPairScore >= 0.70 &&
    zeroDnaStats.statisticalTest.oneSidedLowerBound > 0.50;

  const recalcRefSuperiority =
    isExecutionValidRecalc &&
    !!refChampStats &&
    refChampStats.meanPairScore > 0.50 &&
    refChampStats.statisticalTest.oneSidedLowerBound > 0.50;

  const recalcRefNonInferiority =
    isExecutionValidRecalc &&
    !!refChampStats &&
    refChampStats.meanPairScore >= 0.50 &&
    refChampStats.statisticalTest.oneSidedLowerBound > 0.45;

  let recalculatedCertificationStatus: HoldoutCertificationStatus = "PERFORMANCE_UNVERIFIED";
  let recalculatedImprovementStatus: "IMPROVEMENT_VERIFIED" | "IMPROVEMENT_UNVERIFIED" | "CONFIRMED_REGRESSION" =
    "IMPROVEMENT_UNVERIFIED";

  if (!isExecutionValidRecalc) {
    recalculatedCertificationStatus = "INVALID_EVIDENCE";
    recalculatedImprovementStatus = "IMPROVEMENT_UNVERIFIED"; // 不正・無効時は CONFIRMED_REGRESSION に自動変換しない
  } else if (recalcBaselineSuperior && recalcRefSuperiority) {
    recalculatedCertificationStatus = "SUPERIORITY_VERIFIED";
    recalculatedImprovementStatus = "IMPROVEMENT_VERIFIED";
  } else if (recalcBaselineSuperior && recalcRefNonInferiority) {
    recalculatedCertificationStatus = "NON_INFERIORITY_VERIFIED";
    recalculatedImprovementStatus = "IMPROVEMENT_UNVERIFIED"; // 非劣性のみ達成時は改善未証明
  } else {
    recalculatedCertificationStatus = "PERFORMANCE_UNVERIFIED";
    recalculatedImprovementStatus = "IMPROVEMENT_UNVERIFIED";
  }

  // Evidence JSON の認定結果との完全照合 (そのまま信用せず独立再計算結果と突合)
  if (evidenceJson.certificationStatus !== recalculatedCertificationStatus) {
    errors.push(
      `Certification status mismatch: recalculated "${recalculatedCertificationStatus}", but Evidence JSON contains "${evidenceJson.certificationStatus}"`
    );
  }
  if (evidenceJson.improvementStatus !== recalculatedImprovementStatus) {
    errors.push(
      `Improvement status mismatch: recalculated "${recalculatedImprovementStatus}", but Evidence JSON contains "${evidenceJson.improvementStatus}"`
    );
  }
  if (evidenceJson.baselineSuperior !== recalcBaselineSuperior) {
    errors.push(
      `Baseline superior mismatch: recalculated ${recalcBaselineSuperior}, but Evidence JSON contains ${evidenceJson.baselineSuperior}`
    );
  }

  // 監査レポート (STAGE3_HOLDOUT_AUDIT_REPORT.md) との整合照合
  const auditReportPath = path.join(artifactsDir, "STAGE3_HOLDOUT_AUDIT_REPORT.md");
  if (fs.existsSync(auditReportPath)) {
    const reportMd = fs.readFileSync(auditReportPath, "utf8");
    if (!reportMd.includes(recalculatedCertificationStatus)) {
      errors.push(
        `STAGE3_HOLDOUT_AUDIT_REPORT.md does not contain expected certificationStatus "${recalculatedCertificationStatus}"`
      );
    }
  }

  const allBaselineTargetsMet = recalcBaselineSuperior;
  const evidenceStatus = isExecutionValidRecalc ? "VALID" : "INVALID_EVIDENCE";
  const improvementStatus = recalculatedImprovementStatus;
  const certificationStatus = recalculatedCertificationStatus;
  const referenceSuperiorityVerified = recalcRefSuperiority;
  const referenceNonInferiorityVerified = recalcRefNonInferiority;

  return {
    isValid: errors.length === 0,
    checkedFiles,
    errors,
    executionMode: executionMode as any,
    totalMatches: outcomes.length,
    completedMatches,
    failedMatches,
    incompleteMatches,
    matchesReachingDecisionLimit,
    totalInstantiationFailures,
    candidateDigest,
    candidateDigestMatches,
    oldChampionDigest,
    oldChampionDigestMatches,
    allBaselineTargetsMet,
    referenceSuperiorityVerified,
    referenceNonInferiorityVerified,
    evidenceStatus,
    improvementStatus,
    certificationStatus,
  };
}

// =============================================================================
// ZIP パッケージ化 (Pure TypeScript)
// =============================================================================

export function packageHoldoutZip(
  artifactsDir: string = DEFAULT_HOLDOUT_ARTIFACTS_DIR,
  zipPath: string = DEFAULT_HOLDOUT_ZIP_PATH
): { zipPath: string; zipSha256: string; zipSizeBytes: number } {
  const resolvedArtifactsDir = path.resolve(artifactsDir);
  const resolvedZipPath = path.resolve(zipPath);

  if (!fs.existsSync(resolvedArtifactsDir)) {
    throw new Error(`Artifacts directory not found: "${resolvedArtifactsDir}"`);
  }

  // ディレクトリ内の全ファイルを再帰的に収集
  const zipData: Record<string, Uint8Array> = {};

  function addDir(dir: string, prefix: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        addDir(fullPath, relativePath);
      } else if (entry.isFile()) {
        const fileBytes = fs.readFileSync(fullPath);
        zipData[relativePath] = new Uint8Array(fileBytes);
      }
    }
  }

  addDir(resolvedArtifactsDir, "");

  const zippedBytes = fflate.zipSync(zipData, { level: 6 });
  fs.writeFileSync(resolvedZipPath, Buffer.from(zippedBytes));

  const stat = fs.statSync(resolvedZipPath);
  const zipSha256 = computeFileSha256(resolvedZipPath);

  return {
    zipPath: resolvedZipPath,
    zipSha256,
    zipSizeBytes: stat.size,
  };
}

// =============================================================================
// CLI 引数パース & 安全性検証
// =============================================================================

export interface HoldoutCliParsedOptions {
  readonly mode: "DRY_RUN" | "SMOKE" | "EXECUTE";
  readonly outputDir: string;
}

export function parseHoldoutCliArgs(args: readonly string[]): HoldoutCliParsedOptions {
  const recognizedFlags = new Set(["--dry-run", "--smoke", "--execute", "--output-dir"]);
  let dryRun = false;
  let smoke = false;
  let execute = false;
  let outputDir: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--smoke") {
      smoke = true;
    } else if (arg === "--execute") {
      execute = true;
    } else if (arg === "--output-dir") {
      if (i + 1 >= args.length || args[i + 1].startsWith("--")) {
        throw new Error("[Fail-Closed] Missing value for --output-dir argument");
      }
      outputDir = args[++i];
    } else {
      throw new Error(`[Fail-Closed] Unrecognized or invalid CLI argument: "${arg}"`);
    }
  }

  // 排他モードチェック
  const activeModes = [dryRun && "DRY_RUN", smoke && "SMOKE", execute && "EXECUTE"].filter(Boolean);
  if (activeModes.length > 1) {
    throw new Error(
      `[Fail-Closed] Mutually exclusive execution modes specified: [${activeModes.join(", ")}]. Specify exactly one of --dry-run, --smoke, or --execute.`
    );
  }

  if (activeModes.length === 0) {
    throw new Error(
      `[Fail-Closed] No execution mode specified. Explicit mode flag (--dry-run, --smoke, or --execute) is required to prevent accidental execution.`
    );
  }

  const mode = activeModes[0] as "DRY_RUN" | "SMOKE" | "EXECUTE";

  // 出力先デフォルトの分離
  const finalOutputDir =
    outputDir ??
    (mode === "SMOKE" ? DEFAULT_SMOKE_ARTIFACTS_DIR : DEFAULT_HOLDOUT_ARTIFACTS_DIR);

  return { mode, outputDir: finalOutputDir };
}

// =============================================================================
// メイン実行エントリーポイント
// =============================================================================

export async function runStage3Holdout(options: {
  mode: "DRY_RUN" | "SMOKE" | "EXECUTE";
  outputDir: string;
}): Promise<void> {
  const { mode, outputDir } = options;

  console.log(`=== Stage 3 Champion Holdout Evaluation Runner (R1) ===`);
  console.log(`Work ID:       ${HOLDOUT_WORK_ID}`);
  console.log(`Output Dir:    ${outputDir}`);
  console.log(`Mode:          ${mode}`);

  // Step 1: 環境 & 出力先ディレクトリの保護検証
  const gitInfo = checkGitCleanliness();
  console.log(`Git Commit:    ${gitInfo.headCommitSha} (Clean: ${gitInfo.isClean})`);

  if (mode === "EXECUTE" && !gitInfo.isClean) {
    throw new Error(
      `[Fail-Closed] Working tree is not clean. Formal Holdout execution (--execute) requires a clean git working tree.`
    );
  }

  validateArtifactsDirectory(outputDir);

  // Step 2: DNA 読み込み & 真正性・Checkpoint 完全性検証
  const candidatePath = path.resolve(
    PROTECTED_RETRAIN_DIR,
    "campaign-stage3-evolution-checkpoint.json"
  );
  const oldChampPath = path.resolve(
    PROTECTED_OLD_STAGE3_DIR,
    "campaign-stage3-evolution-checkpoint.json"
  );

  console.log(`Loading Candidate Champion DNA from "${candidatePath}"...`);
  const candidateDNA = loadChampionDNA({
    checkpointPath: candidatePath,
    expectedGenomeId: CANDIDATE_CHAMPION_GENOME_ID,
    expectedDigest: CANDIDATE_CHAMPION_EXPECTED_DIGEST,
    verifyCheckpointChecksum: true,
  });

  console.log(`Loading Old Champion DNA from "${oldChampPath}"...`);
  const oldChampionDNA = loadChampionDNA({
    checkpointPath: oldChampPath,
    expectedGenomeId: OLD_CHAMPION_GENOME_ID,
    expectedDigest: OLD_CHAMPION_EXPECTED_DIGEST,
    verifyCheckpointChecksum: true,
  });

  console.log(`Generating ZeroDNA...`);
  const zeroDNA = createZeroDNA();

  // Step 3: Seed 計画と衝突検証
  let targetSeeds: readonly number[];

  if (mode === "SMOKE") {
    targetSeeds = SMOKE_DIAGNOSTIC_SEEDS;
    console.log(`Selected diagnostic smoke seeds: [${targetSeeds.join(", ")}]`);
  } else {
    targetSeeds = OFFICIAL_HOLDOUT_SEEDS;
    console.log(`Selected official holdout seeds: ${targetSeeds.length} seeds (${targetSeeds[0]}..${targetSeeds[targetSeeds.length - 1]})`);
    console.log(`Verifying cross-category seed collision...`);
    validateHoldoutSeedPlan(targetSeeds);
    console.log(`Seed collision verification: PASS (Zero collisions detected).`);
  }

  // Step 4: Preflight Manifest 生成
  const preflightManifest = buildHoldoutPreflightManifest({
    candidateDNA,
    candidateSourcePath: candidatePath,
    oldChampionDNA,
    oldChampionSourcePath: oldChampPath,
    zeroDNA,
    seeds: targetSeeds,
    executionMode: mode,
    artifactsDir: outputDir,
    gitInfo,
    maxDecisionsPerMatch: DEFAULT_MAX_DECISIONS_PER_MATCH,
  });

  // DRY-RUN の場合は試合を実行せずに Preflight のみ保存・検証して終了
  if (mode === "DRY_RUN") {
    console.log(`\n[DRY-RUN] Preflight checks completed successfully.`);
    console.log(`Official Holdout 240 matches are PROTECTED from premature execution.`);
    console.log(`Preflight Manifest verified in memory. Halting per protocol.`);
    return;
  }

  // Step 5: 評価実行 (SMOKE または EXECUTE)
  console.log(`\nPreparing official session factory for regulation "${HOLDOUT_REGULATION_ID}"...`);
  const sessionFactory = await prepareOfficialSessionFactory(HOLDOUT_REGULATION_ID);

  console.log(`Starting Evaluation (${preflightManifest.plannedMatches.totalMatches} matches planned)...`);
  const output = executeHoldoutEvaluation({
    candidateDNA,
    oldChampionDNA,
    zeroDNA,
    seeds: targetSeeds,
    preflightManifest,
    sessionFactory,
    maxDecisionsPerMatch: DEFAULT_MAX_DECISIONS_PER_MATCH,
  });

  console.log(`\nEvaluation completed in ${(output.executionElapsedMs / 1000).toFixed(2)}s.`);
  console.log(`Matches completed: ${output.completedMatches}/${output.totalMatches} (Failed: ${output.failedMatches}, Incomplete: ${output.incompleteMatches})`);
  console.log(`Total decisions:   ${output.totalDecisions} (Max: ${output.maxDecisionsInSingleMatch}, Min: ${output.minDecisionsInSingleMatch})`);
  console.log(`Certification:     ${output.certificationStatus}`);

  // Step 6: 成果物保存
  console.log(`\nSaving artifacts to "${outputDir}"...`);
  const saveResult = saveHoldoutArtifacts(output, outputDir);
  console.log(`Saved ${saveResult.savedFiles.length} files.`);

  // Step 7: 自己監査
  console.log(`\nAuditing generated artifacts...`);
  const auditResult = auditHoldoutArtifacts(outputDir);
  if (!auditResult.isValid) {
    throw new Error(`[Audit Failed] Errors encountered:\n${auditResult.errors.join("\n")}`);
  }
  console.log(`Self-Audit: PASS (All integrity checks verified).`);

  // Step 8: ZIP 生成
  const zipPath = path.resolve(outputDir, "../", `${path.basename(outputDir)}.zip`);
  console.log(`Packaging artifact zip at "${zipPath}"...`);
  const zipResult = packageHoldoutZip(outputDir, zipPath);
  console.log(`Zip generated: ${zipResult.zipSizeBytes} bytes (SHA-256: ${zipResult.zipSha256})`);

  console.log(`\n=== Stage 3 Champion Holdout Evaluation Runner Complete ===\n`);
}

// 直接実行時のエントリポイント
const isMainScript =
  (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) ||
  process.argv.some((arg) => arg.includes("stage3HoldoutRunner"));

if (isMainScript && !process.env.VITEST && !process.argv.includes("--no-auto-run")) {
  try {
    const parsed = parseHoldoutCliArgs(process.argv.slice(2));
    await runStage3Holdout(parsed);
  } catch (err: any) {
    console.error(`[FATAL ERROR] Holdout Runner terminated with error:`, err?.message ?? String(err));
    process.exit(1);
  }
}
