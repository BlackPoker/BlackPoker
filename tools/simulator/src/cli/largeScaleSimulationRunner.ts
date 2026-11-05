/**
 * BlackPoker Work 4-1 — Million Match Simulation Runner
 *
 * Work ID: BP-SIM-AI-V92-WORK4-MILLION-MATCH-INFRA-R1
 *
 * 【機能概要】
 * - 最大 100万試合 (50万座席反転ペア) 規模の自動対戦に対応する CLI ランナー。
 * - 目的A (QUALITY_AUDIT: ルール・Core品質検証) と 目的B (AI_EVOLUTION: AI進化学習・評価) を厳格に分離。
 * - 実行モード:
 *   --plan-only : 試合を実行せず、100万試合までのSeed計画・無衝突保証・容量/時間見積もりを出力
 *   --benchmark : 短時間の処理性能・メモリベンチマークを実行
 *   --pilot     : 限定試合数 (Stage A: 1,000試合, Stage B: 10,000試合 等) を実行
 *   --resume    : アトミック Checkpoint から中断箇所を検証して安全に再開
 *   --execute   : 明示的な正式実行モード (10,000試合超は独立レビュー承認トークンなしでは Fail-Closed ロック)
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import * as fflate from "fflate";
import {
  CampaignPurpose,
  LargeScaleExecutionMode,
  ScaleVerificationStage,
  ParticipantPolicySpec,
  MatchupPairingSpec,
  MillionMatchCampaignEvidence,
  MillionMatchCheckpointState,
  CompactMatchOutcomeRecord,
} from "../domain/simulation/MillionMatchInfraTypes";
import {
  MillionMatchCampaignEngine,
  MillionMatchSeedAllocator,
  computeFileSha256,
  sha256Hex,
  computeMillionMatchCheckpointChecksum,
  executeSingleInstrumentedMatch,
  derivePlayerSeed,
} from "../engine/simulation/MillionMatchCampaignEngine";
import {
  CANDIDATE_CHAMPION_GENOME_ID,
  CANDIDATE_CHAMPION_EXPECTED_DIGEST,
  OLD_CHAMPION_GENOME_ID,
  OLD_CHAMPION_EXPECTED_DIGEST,
  PROTECTED_RETRAIN_DIR,
  PROTECTED_OLD_STAGE3_DIR,
  DEFAULT_HOLDOUT_ARTIFACTS_DIR,
  DEFAULT_SMOKE_ARTIFACTS_DIR,
  OFFICIAL_HOLDOUT_SEEDS,
  checkGitCleanliness,
  loadChampionDNA,
  createZeroDNA,
} from "./stage3HoldoutRunner";
import { prepareOfficialSessionFactory } from "./stage3EvolutionRunner";
import { loadRulePackageFromDirectory } from "../engine/rules/RuleLoader";
import { getPlaytestRulePackage } from "../engine/rules/RulePackageSelector";
import { FirstLegalPolicy, RandomPolicy, DecisionPolicy } from "../engine/simulation/DecisionPolicy";
import { GenomePolicy } from "../engine/ai/GenomePolicy";
import { SeededRandom } from "../engine/random/RandomSource";
import { DecisionDNACodec } from "../engine/ai/DecisionDNACodec";
import { EvolutionIndependentEvaluator } from "../engine/ai/EvolutionIndependentEvaluator";
import { DecisionDNA } from "../domain/ai/DecisionDNATypes";

export const WORK4_WORK_ID = "BP-SIM-AI-V92-WORK4-MILLION-MATCH-INFRA-R1" as const;
export const DEFAULT_REGULATION_ID = "standard-pack" as const;
export const DEFAULT_FRAME_ID = "pack" as const;
export const DEFAULT_RULE_PACKAGE_VERSION = "1.0.0" as const;
export const DEFAULT_FEATURE_SCHEMA_VERSION = 6 as const;
export const DEFAULT_CAMPAIGN_SEED = 20261106 as const;
export const DEFAULT_DECISION_LIMIT = 500 as const;
export const DEFAULT_CHUNK_SIZE_MATCHES = 1000 as const;

// =============================================================================
// 出力先ディレクトリ & 既存原本保護 (Fail-Closed)
// =============================================================================

export function validateMillionMatchOutputDir(
  outputDir: string,
  mode: LargeScaleExecutionMode,
  zipPath?: string
): void {
  const resolved = path.resolve(outputDir);
  const protectedDirs = [
    path.resolve(PROTECTED_RETRAIN_DIR),
    path.resolve(PROTECTED_OLD_STAGE3_DIR),
    path.resolve(DEFAULT_HOLDOUT_ARTIFACTS_DIR),
    path.resolve(DEFAULT_SMOKE_ARTIFACTS_DIR),
    path.resolve(".artifacts/stage2-evolution"),
    path.resolve(".artifacts/stage2-evolution-addendum"),
    path.resolve(".artifacts/stage1-pilot"),
    path.resolve(".artifacts/stage1-pilot-r0-archive"),
  ];

  for (const prot of protectedDirs) {
    if (resolved === prot || resolved.startsWith(prot + path.sep)) {
      throw new Error(
        `[Fail-Closed] Output directory "${outputDir}" targets a protected historical artifact directory ("${prot}"). Modification or overwrite is strictly forbidden.`
      );
    }
  }

  if (mode === "PLAN_ONLY") {
    return;
  }

  if (mode === "RESUME") {
    const ckptPath = path.join(resolved, "checkpoint.json");
    if (!fs.existsSync(ckptPath)) {
      throw new Error(
        `[Fail-Closed] Cannot run in --resume mode: checkpoint.json not found in "${outputDir}"`
      );
    }
    return;
  }

  if (fs.existsSync(resolved)) {
    const entries = fs.readdirSync(resolved);
    if (entries.length > 0) {
      throw new Error(
        `[Fail-Closed] Output directory "${outputDir}" already exists and is not empty (${entries.length} items). Overwriting existing artifacts is strictly forbidden.`
      );
    }
  }

  const targetZip = zipPath ? path.resolve(zipPath) : path.resolve(`${outputDir}.zip`);
  if (fs.existsSync(targetZip)) {
    throw new Error(
      `[Fail-Closed] Output zip archive "${targetZip}" already exists. Overwriting existing archive is strictly forbidden.`
    );
  }
}

// =============================================================================
// 公式 Champion DNA ロード & 多対戦カード構築
// =============================================================================

export function loadOfficialOrFallbackChampions(options?: {
  allowFallbackInCi?: boolean;
}): {
  gen7DNA: DecisionDNA;
  gen7Digest: string;
  gen7Source: string;
  gen5DNA: DecisionDNA;
  gen5Digest: string;
  gen5Source: string;
  zeroDNA: DecisionDNA;
  zeroDigest: string;
} {
  const candidatePath = path.resolve(
    PROTECTED_RETRAIN_DIR,
    "campaign-stage3-evolution-checkpoint.json"
  );
  const oldChampPath = path.resolve(
    PROTECTED_OLD_STAGE3_DIR,
    "campaign-stage3-evolution-checkpoint.json"
  );

  const zeroDNA = createZeroDNA();
  const zeroDigest = EvolutionIndependentEvaluator.computeDnaDigest(zeroDNA);

  if (fs.existsSync(candidatePath) && fs.existsSync(oldChampPath)) {
    const gen7DNA = loadChampionDNA({
      checkpointPath: candidatePath,
      expectedGenomeId: CANDIDATE_CHAMPION_GENOME_ID,
      expectedDigest: CANDIDATE_CHAMPION_EXPECTED_DIGEST,
      verifyCheckpointChecksum: true,
      requireManifest: true,
    });
    const gen5DNA = loadChampionDNA({
      checkpointPath: oldChampPath,
      expectedGenomeId: OLD_CHAMPION_GENOME_ID,
      expectedDigest: OLD_CHAMPION_EXPECTED_DIGEST,
      verifyCheckpointChecksum: true,
      requireManifest: true,
    });

    return {
      gen7DNA,
      gen7Digest: CANDIDATE_CHAMPION_EXPECTED_DIGEST,
      gen7Source: candidatePath,
      gen5DNA,
      gen5Digest: OLD_CHAMPION_EXPECTED_DIGEST,
      gen5Source: oldChampPath,
      zeroDNA,
      zeroDigest,
    };
  }

  if (!options?.allowFallbackInCi) {
    throw new Error(
      `[Fail-Closed] Official Stage 3 checkpoints not found at "${candidatePath}" or "${oldChampPath}"`
    );
  }

  // CI テスト環境用フォールバック
  const fallbackGen7 = DecisionDNACodec.createZeroDecisionDNA({
    id: CANDIDATE_CHAMPION_GENOME_ID,
    name: "Gen7Fallback",
  });
  (fallbackGen7.patternWeights as number[])[0] = 0.35;
  const fallbackGen5 = DecisionDNACodec.createZeroDecisionDNA({
    id: OLD_CHAMPION_GENOME_ID,
    name: "Gen5Fallback",
  });
  (fallbackGen5.patternWeights as number[])[0] = 0.2;

  return {
    gen7DNA: fallbackGen7,
    gen7Digest: EvolutionIndependentEvaluator.computeDnaDigest(fallbackGen7),
    gen7Source: "CI_SYNTHETIC_FALLBACK",
    gen5DNA: fallbackGen5,
    gen5Digest: EvolutionIndependentEvaluator.computeDnaDigest(fallbackGen5),
    gen5Source: "CI_SYNTHETIC_FALLBACK",
    zeroDNA,
    zeroDigest,
  };
}

export function createStandardMatchupsAndResolver(champions: {
  gen7DNA: DecisionDNA;
  gen7Digest: string;
  gen7Source: string;
  gen5DNA: DecisionDNA;
  gen5Digest: string;
  gen5Source: string;
  zeroDNA: DecisionDNA;
  zeroDigest: string;
}): {
  matchups: readonly MatchupPairingSpec[];
  policyResolver: (
    spec: ParticipantPolicySpec,
    seat: "p1" | "p2",
    matchSeed: number,
    playerSeed: number
  ) => DecisionPolicy;
} {
  const gen7Spec: ParticipantPolicySpec = {
    policyId: "gen7-champion",
    name: "Stage3Gen7Champion",
    kind: "GENOME",
    genomeId: CANDIDATE_CHAMPION_GENOME_ID,
    dnaDigest: champions.gen7Digest,
    sourcePath: champions.gen7Source,
    role: "CANDIDATE",
  };

  const gen5Spec: ParticipantPolicySpec = {
    policyId: "gen5-champion",
    name: "Stage3Gen5Champion",
    kind: "GENOME",
    genomeId: OLD_CHAMPION_GENOME_ID,
    dnaDigest: champions.gen5Digest,
    sourcePath: champions.gen5Source,
    role: "REFERENCE_CHAMPION",
  };

  const seededRandomSpec: ParticipantPolicySpec = {
    policyId: "seeded-random",
    name: "SeededRandom",
    kind: "SEEDED_RANDOM",
    role: "BASELINE",
  };

  const firstLegalSpec: ParticipantPolicySpec = {
    policyId: "first-legal",
    name: "FirstLegal",
    kind: "FIRST_LEGAL",
    role: "BASELINE",
  };

  const zeroDnaSpec: ParticipantPolicySpec = {
    policyId: "zero-dna",
    name: "ZeroDNA",
    kind: "GENOME",
    genomeId: "baseline-zero-dna-v1",
    dnaDigest: champions.zeroDigest,
    role: "BASELINE",
  };

  const matchups: readonly MatchupPairingSpec[] = [
    {
      matchupId: "matchup-gen7-vs-gen5",
      name: "Gen7Champion vs Stage3Gen5Champion",
      agentA: gen7Spec,
      agentB: gen5Spec,
      weight: 1,
    },
    {
      matchupId: "matchup-gen7-vs-random",
      name: "Gen7Champion vs SeededRandom",
      agentA: gen7Spec,
      agentB: seededRandomSpec,
      weight: 1,
    },
    {
      matchupId: "matchup-gen7-vs-firstlegal",
      name: "Gen7Champion vs FirstLegal",
      agentA: gen7Spec,
      agentB: firstLegalSpec,
      weight: 1,
    },
    {
      matchupId: "matchup-gen7-selfplay",
      name: "Gen7Champion Mirror Self-Play",
      agentA: gen7Spec,
      agentB: { ...gen7Spec, role: "SELF_PLAY" },
      weight: 1,
    },
  ];

  const policyResolver = (
    spec: ParticipantPolicySpec,
    seat: "p1" | "p2",
    _matchSeed: number,
    playerSeed: number
  ): DecisionPolicy => {
    if (spec.policyId === "gen7-champion") {
      return new GenomePolicy(champions.gen7DNA, `Gen7Champion-${seat}`);
    }
    if (spec.policyId === "gen5-champion") {
      return new GenomePolicy(champions.gen5DNA, `Gen5Champion-${seat}`);
    }
    if (spec.policyId === "zero-dna") {
      return new GenomePolicy(champions.zeroDNA, `ZeroDNA-${seat}`);
    }
    if (spec.policyId === "seeded-random") {
      return new RandomPolicy(new SeededRandom(playerSeed), `SeededRandom-${seat}`);
    }
    if (spec.policyId === "first-legal") {
      return new FirstLegalPolicy(false);
    }
    throw new Error(`[Fail-Closed] Unknown policyId "${spec.policyId}"`);
  };

  return { matchups, policyResolver };
}

// =============================================================================
// 成果物保存・Markdown レポート生成・自己監査・ZIP 作成
// =============================================================================

export function generateMillionMatchAuditMarkdown(
  evidence: MillionMatchCampaignEvidence,
  manifestSha256: Record<string, string>
): string {
  const { performance: perf, gameQuality: qual, ruleCoverage: cov, evolution: evo } = evidence;
  const lines: string[] = [];

  lines.push(`# Million Match Simulation Infrastructure — Audit & Telemetry Report`);
  lines.push(``);
  lines.push(`- **Work ID:** \`${evidence.workId}\``);
  lines.push(`- **Campaign ID:** \`${evidence.campaignId}\``);
  lines.push(`- **Campaign Purpose:** \`${evidence.purpose}\``);
  lines.push(`- **Verification Stage:** \`${evidence.stage}\``);
  lines.push(`- **Execution Mode:** \`${evidence.executionMode}\``);
  lines.push(`- **Campaign Status:** \`${evidence.campaignStatus}\``);
  lines.push(`- **Git Commit SHA:** \`${evidence.gitCommitSha}\` (Clean: \`${evidence.isGitClean}\`)`);
  lines.push(`- **Config Digest:** \`${evidence.configDigest}\``);
  lines.push(`- **Logical Result Digest:** \`${evidence.logicalResultDigest}\``);
  lines.push(`- **Regulation / Frame:** \`${evidence.regulationId}\` / \`${evidence.frameId}\` (Schema v${evidence.featureSchemaVersion})`);
  lines.push(`- **Max Concurrency:** \`${evidence.maxConcurrency}\``);
  lines.push(`- **Decision Limit:** \`${evidence.maxDecisionsPerMatch}\``);
  lines.push(``);
  lines.push(`## 1. Seed 空間 & 衝突防止証明`);
  lines.push(``);
  lines.push(`- **Seed Space Range:** \`${evidence.seedSpace.rangeStart} .. ${evidence.seedSpace.rangeEnd}\` (Capacity: ${evidence.seedSpace.rangeSize.toLocaleString()} pairs)`);
  lines.push(`- **Affine Bijection:** \`multiplier = ${evidence.seedSpace.affineMultiplier}\`, \`offset = ${evidence.seedSpace.affineOffset}\``);
  lines.push(`- **Protected Historical / Holdout Seeds Verified:** \`${evidence.seedSpace.protectedRangesVerified}\``);
  lines.push(`- **Zero Collision Verified:** \`${evidence.seedSpace.zeroCollisionVerified}\``);
  lines.push(`- **Reserved Future Holdout Range:** \`${evidence.seedSpace.reservedFutureHoldoutRange.start} .. ${evidence.seedSpace.reservedFutureHoldoutRange.end}\``);
  lines.push(``);
  lines.push(`## 2. 実行性能テレメトリー & 100万試合スケーリング推計`);
  lines.push(``);
  lines.push(`- **実行試合数:** ${perf.executedMatches.toLocaleString()} / ${perf.totalPlannedMatches.toLocaleString()} matches`);
  lines.push(`- **総実行時間:** ${(perf.totalElapsedMs / 1000).toFixed(2)}s`);
  lines.push(`- **スループット:** **${perf.matchesPerSecond.toFixed(2)} matches/sec** (${perf.decisionsPerSecond.toFixed(1)} decisions/sec)`);
  lines.push(`- **試合レイテンシ:** Mean \`${perf.latencyMs.mean.toFixed(2)}ms\`, p50 \`${perf.latencyMs.p50.toFixed(1)}ms\`, p95 \`${perf.latencyMs.p95.toFixed(1)}ms\`, p99 \`${perf.latencyMs.p99.toFixed(1)}ms\`, Max \`${perf.latencyMs.max.toFixed(1)}ms\``);
  lines.push(`- **CPU 使用率:** \`${perf.cpu.cpuUtilizationPercent.toFixed(1)}%\` (User: ${(perf.cpu.userCpuTimeMs / 1000).toFixed(2)}s, Sys: ${(perf.cpu.systemCpuTimeMs / 1000).toFixed(2)}s)`);
  lines.push(`- **メモリ (RSS / Heap):**`);
  lines.push(`  - Baseline RSS: \`${(perf.memory.baselineRssBytes / (1024 * 1024)).toFixed(1)} MB\`, Peak RSS: \`${(perf.memory.peakRssBytes / (1024 * 1024)).toFixed(1)} MB\`, Final RSS: \`${(perf.memory.finalRssBytes / (1024 * 1024)).toFixed(1)} MB\``);
  lines.push(`  - Baseline Heap: \`${(perf.memory.baselineHeapUsedBytes / (1024 * 1024)).toFixed(1)} MB\`, Peak Heap: \`${(perf.memory.peakHeapUsedBytes / (1024 * 1024)).toFixed(1)} MB\`, Final Heap: \`${(perf.memory.finalHeapUsedBytes / (1024 * 1024)).toFixed(1)} MB\``);
  lines.push(`  - 1,000試合あたり Heap 増加率: \`${(perf.memory.heapGrowthPer1kMatchesBytes / 1024).toFixed(1)} KB / 1k matches\``);
  lines.push(`- **ストレージ容量:**`);
  lines.push(`  - チャンク数: \`${perf.storage.totalChunksCount}\` (${(perf.storage.totalChunksBytes / 1024).toFixed(1)} KB, \`${perf.storage.bytesPerMatch.toFixed(1)} bytes/match\`)`);
  lines.push(`  - 100,000試合 推定サイズ: \`${perf.storage.estimated100kMatchesMb.toFixed(2)} MB\``);
  lines.push(`  - 1,000,000試合 推定サイズ: \`${perf.storage.estimated1MMatchesMb.toFixed(2)} MB\``);
  lines.push(`- **Checkpoint 性能:** 保存回数 \`${perf.checkpointing.checkpointSavesCount}\` 回, 平均保存時間 \`${perf.checkpointing.meanCheckpointSaveMs.toFixed(2)}ms\`, 最大 \`${perf.checkpointing.maxCheckpointSaveMs.toFixed(2)}ms\`, Resume 回数 \`${perf.checkpointing.resumedCount}\` 回`);
  lines.push(`- **Action Space Streaming:** ストリーミング発生試合 \`${perf.actionSpaceStreaming.matchesWithStreamingCount}\` 試合, ストリーミング意思決定 \`${perf.actionSpaceStreaming.streamingDecisionsCount}\` 回, 最大合法手数 \`${perf.actionSpaceStreaming.maxLegalPatternsCount}\` 件`);
  lines.push(`- **所要時間推計 (単一プロセス実測基準):**`);
  lines.push(`  - 10,000 試合: 約 \`${(perf.scaleProjections.estimated10kMatchesSec / 60).toFixed(1)} 分\` (${perf.scaleProjections.estimated10kMatchesSec.toFixed(0)} 秒)`);
  lines.push(`  - 100,000 試合: 約 \`${perf.scaleProjections.estimated100kMatchesHours.toFixed(2)} 時間\``);
  lines.push(`  - 1,000,000 試合: 約 \`${perf.scaleProjections.estimated1MMatchesHours.toFixed(2)} 時間\``);
  lines.push(``);
  lines.push(`## 3. ゲーム品質 & 異常検出テレメトリー`);
  lines.push(``);
  lines.push(`- **完了試合数 (Completed):** ${qual.completedMatches}`);
  lines.push(`- **未完試合数 (Incomplete):** ${qual.incompleteMatches}`);
  lines.push(`- **失敗試合数 (Failed):** ${qual.failedMatches}`);
  lines.push(`- **Core 実体化失敗数:** ${qual.coreInstantiationFailuresCount}`);
  lines.push(`- **State Invariant 違反数:** ${qual.stateInvariantViolationsCount}`);
  lines.push(`- **違法手 / 合法手欠落数:** ${qual.illegalOrEmptyLegalCount}`);
  lines.push(`- **未捕捉例外数:** ${qual.unhandledExceptionsCount}`);
  lines.push(`- **膠着疑い (上限500回到達) 試合数:** ${qual.suspectedStallMatchesCount}`);
  lines.push(`- **意思決定統計:** 総数 \`${qual.totalDecisions.toLocaleString()}\`, 平均 \`${qual.meanDecisionsPerMatch.toFixed(1)}\`, 最大 \`${qual.maxDecisionsInSingleMatch}\`, 最小 \`${qual.minDecisionsInSingleMatch}\``);
  lines.push(`- **PASS 統計:** 総 PASS \`${qual.totalPassDecisions.toLocaleString()}\` (\`${(qual.passRatio * 100).toFixed(2)}%\`), 最大連続 PASS \`${qual.maxConsecutivePassesInSingleMatch}\` 回`);
  lines.push(`- **座席別勝率 (先手/後手バランス):** P1 勝率 \`${(qual.seatWinRates.p1WinRate * 100).toFixed(2)}%\` (${qual.seatWinRates.p1Wins}勝) / P2 勝率 \`${(qual.seatWinRates.p2WinRate * 100).toFixed(2)}%\` (${qual.seatWinRates.p2Wins}勝) / 引分 \`${(qual.seatWinRates.drawRate * 100).toFixed(2)}%\` (${qual.seatWinRates.draws})`);
  lines.push(``);
  lines.push(`### 対戦カード別ペアスコア集計`);
  lines.push(``);
  lines.push(`| Matchup ID | 対戦カード | 完了ペア数 | Agent A 平均ペアスコア | 標本分散 | 標準誤差 (SE) |`);
  lines.push(`| :--- | :--- | :---: | :---: | :---: | :---: |`);
  for (const m of Object.values(qual.matchupStats)) {
    lines.push(
      `| \`${m.matchupId}\` | ${m.name} | ${m.completedPairs}/${m.totalPairs} | **${(m.agentAMeanPairScore * 100).toFixed(2)}%** | ${m.agentAPairScoreVariance.toFixed(4)} | ${m.agentAStandardError.toFixed(4)} |`
    );
  }
  lines.push(``);
  lines.push(`## 4. ルール・アクション網羅性 (Coverage)`);
  lines.push(``);
  lines.push(`- **定義済みアクション数:** ${cov.totalDefinedActionsCount} (提示済み: ${cov.offeredActionsCount}, 実行済み: ${cov.executedActionsCount}, Coverage: \`${(cov.actionCoverageRatio * 100).toFixed(1)}%\`)`);
  lines.push(`- **定義済みコンポーネント数:** ${cov.totalDefinedComponentsCount} (盤面観測済み: ${cov.observedComponentsCount}, Coverage: \`${(cov.componentCoverageRatio * 100).toFixed(1)}%\`)`);
  lines.push(`- **未選択の定義アクション (システム自動誘発含む):** \`${cov.unreachedDefinedActionIds.join(", ") || "なし"}\``);
  lines.push(``);
  lines.push(`## 5. 100万試合 推奨ハードウェアスペック`);
  lines.push(``);
  lines.push(`- **推奨 CPU:** ${evidence.hardwareRecommendationsFor1M.recommendedCpuCores}`);
  lines.push(`- **推奨 RAM:** ${evidence.hardwareRecommendationsFor1M.recommendedRamGb}`);
  lines.push(`- **推奨 Disk:** ${evidence.hardwareRecommendationsFor1M.recommendedDiskSpaceGb}`);
  lines.push(`- **根拠:** ${evidence.hardwareRecommendationsFor1M.rationale}`);
  lines.push(``);
  lines.push(`## 6. Manifest SHA-256`);
  lines.push(``);
  lines.push(`\`\`\`json`);
  lines.push(JSON.stringify(manifestSha256, null, 2));
  lines.push(`\`\`\``);

  return lines.join("\n");
}

export function saveMillionMatchArtifacts(
  evidence: MillionMatchCampaignEvidence,
  outputDir: string
): { savedFiles: readonly string[]; manifestSha256: Record<string, string> } {
  fs.mkdirSync(outputDir, { recursive: true });
  const savedFiles: string[] = [];

  // 1. campaign-evidence.json
  const evidencePath = path.join(outputDir, "campaign-evidence.json");
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
  savedFiles.push("campaign-evidence.json");

  // 2. rule-coverage-report.json
  const covPath = path.join(outputDir, "rule-coverage-report.json");
  fs.writeFileSync(covPath, JSON.stringify(evidence.ruleCoverage, null, 2), "utf8");
  savedFiles.push("rule-coverage-report.json");

  // 3. evolution-expansion-plan.json
  const evoPath = path.join(outputDir, "evolution-expansion-plan.json");
  fs.writeFileSync(evoPath, JSON.stringify(evidence.evolution, null, 2), "utf8");
  savedFiles.push("evolution-expansion-plan.json");

  // checkpoint.json と全チャンクをマニフェストに含める
  if (fs.existsSync(path.join(outputDir, "checkpoint.json"))) {
    savedFiles.push("checkpoint.json");
  }
  for (const chunk of evidence.chunksManifest) {
    savedFiles.push(chunk.relativePath);
  }

  const interimManifest: Record<string, string> = {};
  for (const rel of savedFiles) {
    const full = path.join(outputDir, rel);
    if (fs.existsSync(full)) {
      interimManifest[rel] = computeFileSha256(full);
    }
  }

  // 4. MILLION_MATCH_AUDIT_REPORT.md
  const reportMd = generateMillionMatchAuditMarkdown(evidence, interimManifest);
  const reportPath = path.join(outputDir, "MILLION_MATCH_AUDIT_REPORT.md");
  fs.writeFileSync(reportPath, reportMd, "utf8");
  savedFiles.push("MILLION_MATCH_AUDIT_REPORT.md");

  // 5. MANIFEST_SHA256.json
  const finalManifest: Record<string, string> = {};
  for (const rel of savedFiles) {
    const full = path.join(outputDir, rel);
    if (fs.existsSync(full)) {
      finalManifest[rel] = computeFileSha256(full);
    }
  }
  const manifestPath = path.join(outputDir, "MANIFEST_SHA256.json");
  fs.writeFileSync(manifestPath, JSON.stringify(finalManifest, null, 2), "utf8");
  savedFiles.push("MANIFEST_SHA256.json");

  return { savedFiles, manifestSha256: finalManifest };
}

/**
 * 保存された大規模実行成果物の完全性・チャンク整合性・無衝突自己監査
 */
export interface MillionMatchAuditResult {
  readonly isValid: boolean;
  readonly errors: readonly string[];
  readonly verifiedMatchesCount: number;
  readonly verifiedChunksCount: number;
  readonly logicalResultDigest: string;
  readonly recalculatedLogicalResultDigest: string;
}

export function auditMillionMatchArtifacts(outputDir: string): MillionMatchAuditResult {
  const errors: string[] = [];

  const manifestPath = path.join(outputDir, "MANIFEST_SHA256.json");
  const evidencePath = path.join(outputDir, "campaign-evidence.json");
  const checkpointPath = path.join(outputDir, "checkpoint.json");

  if (!fs.existsSync(manifestPath)) {
    return {
      isValid: false,
      errors: [`MANIFEST_SHA256.json not found in "${outputDir}"`],
      verifiedMatchesCount: 0,
      verifiedChunksCount: 0,
      logicalResultDigest: "",
      recalculatedLogicalResultDigest: "",
    };
  }
  if (!fs.existsSync(evidencePath)) {
    return {
      isValid: false,
      errors: [`campaign-evidence.json not found in "${outputDir}"`],
      verifiedMatchesCount: 0,
      verifiedChunksCount: 0,
      logicalResultDigest: "",
      recalculatedLogicalResultDigest: "",
    };
  }

  const manifest: Record<string, string> = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const evidence: MillionMatchCampaignEvidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));

  // 1. MANIFEST_SHA256 内の全ファイル存在と SHA-256 一致検証
  for (const [relPath, expectedSha] of Object.entries(manifest)) {
    const fullPath = path.join(outputDir, relPath);
    if (!fs.existsSync(fullPath)) {
      errors.push(`File listed in MANIFEST_SHA256.json is missing: "${relPath}"`);
      continue;
    }
    const actualSha = computeFileSha256(fullPath);
    if (actualSha !== expectedSha) {
      errors.push(`SHA-256 mismatch for "${relPath}": expected "${expectedSha}", got "${actualSha}"`);
    }
  }

  // 2. Checkpoint 内部チェックサム検証
  if (!fs.existsSync(checkpointPath)) {
    errors.push(`checkpoint.json missing in "${outputDir}"`);
  } else {
    try {
      const ckpt: MillionMatchCheckpointState = JSON.parse(fs.readFileSync(checkpointPath, "utf8"));
      const { checksum, ...rest } = ckpt;
      const expectedChecksum = computeMillionMatchCheckpointChecksum(rest);
      if (checksum !== expectedChecksum) {
        errors.push(`Checkpoint checksum mismatch: expected "${expectedChecksum}", got "${checksum}"`);
      }
    } catch (err: any) {
      errors.push(`Failed to parse checkpoint.json: ${err?.message ?? String(err)}`);
    }
  }

  // 3. 全 JSONL チャンクをストリーム走査し、順序・一意性・Holdout Seed 不使用・Chain Hash を完全再計算照合
  const holdoutSeedSet = new Set<number>(OFFICIAL_HOLDOUT_SEEDS);
  const seenMatchIds = new Set<string>();
  let expectedMatchIndex = 0;
  let recalcCompleted = 0;
  let recalcIncomplete = 0;
  let recalcFailed = 0;
  let recalcInstFailures = 0;
  let recalcTotalDecisions = 0;
  let recalcPassDecisions = 0;
  let recalcP1Wins = 0;
  let recalcP2Wins = 0;
  let recalcDraws = 0;
  let chainHash = "0".repeat(64);
  const chunkHashes: string[] = [];

  for (let cIdx = 0; cIdx < evidence.chunksManifest.length; cIdx++) {
    const chunkEntry = evidence.chunksManifest[cIdx];
    if (chunkEntry.chunkIndex !== cIdx) {
      errors.push(`Chunk index discontinuity: expected ${cIdx}, got ${chunkEntry.chunkIndex}`);
    }
    const chunkFullPath = path.join(outputDir, chunkEntry.relativePath);
    if (!fs.existsSync(chunkFullPath)) {
      errors.push(`Chunk file missing: "${chunkEntry.relativePath}"`);
      continue;
    }
    const actualChunkSha = computeFileSha256(chunkFullPath);
    if (actualChunkSha !== chunkEntry.sha256) {
      errors.push(
        `Chunk SHA-256 mismatch for "${chunkEntry.relativePath}": expected "${chunkEntry.sha256}", got "${actualChunkSha}"`
      );
    }
    chunkHashes.push(actualChunkSha);

    const rawText = fs.readFileSync(chunkFullPath, "utf8").trim();
    const lines = rawText ? rawText.split("\n") : [];
    if (lines.length !== chunkEntry.matchCount) {
      errors.push(
        `Chunk "${chunkEntry.fileName}" line count mismatch: expected ${chunkEntry.matchCount}, got ${lines.length}`
      );
    }

    for (const line of lines) {
      let rec: CompactMatchOutcomeRecord;
      try {
        rec = JSON.parse(line);
      } catch (err: any) {
        errors.push(`Invalid JSONL line in "${chunkEntry.fileName}": ${err?.message ?? String(err)}`);
        continue;
      }

      if (rec.matchIndex !== expectedMatchIndex) {
        errors.push(
          `matchIndex sequence error in "${chunkEntry.fileName}": expected ${expectedMatchIndex}, got ${rec.matchIndex}`
        );
      }
      expectedMatchIndex++;

      if (seenMatchIds.has(rec.matchId)) {
        errors.push(`Duplicate matchId detected in chunks: "${rec.matchId}"`);
      }
      seenMatchIds.add(rec.matchId);

      if (holdoutSeedSet.has(rec.matchSeed)) {
        errors.push(`Forbidden Holdout Seed ${rec.matchSeed} detected in match ${rec.matchId}!`);
      }

      if (rec.status === "COMPLETED") {
        recalcCompleted++;
        if (rec.winner === "p1") recalcP1Wins++;
        else if (rec.winner === "p2") recalcP2Wins++;
        else recalcDraws++;
      } else if (rec.status === "INCOMPLETE") {
        recalcIncomplete++;
      } else {
        recalcFailed++;
      }

      recalcInstFailures += rec.instantiationFailures;
      recalcTotalDecisions += rec.totalDecisions;
      recalcPassDecisions += rec.passDecisions;

      chainHash = sha256Hex(
        `${chainHash}|${rec.matchIndex}|${rec.matchId}|${rec.matchSeed}|${rec.p1PolicyId}|${rec.p2PolicyId}|${rec.status}|${rec.winner ?? "none"}|${rec.reason}|${rec.totalDecisions}|${rec.turnCount}|${rec.passDecisions}|${rec.maxConsecutivePasses}|${rec.streamingDecisions}|${rec.maxLegalPatterns}|${rec.instantiationFailures}|${rec.finalStateHash}`
      );
    }
  }

  if (expectedMatchIndex !== evidence.performance.executedMatches) {
    errors.push(
      `Total matches in chunks (${expectedMatchIndex}) does not match evidence.executedMatches (${evidence.performance.executedMatches})`
    );
  }

  const recalculatedLogicalResultDigest = sha256Hex(
    JSON.stringify({
      configDigest: evidence.configDigest,
      executedMatches: expectedMatchIndex,
      completedMatches: recalcCompleted,
      incompleteMatches: recalcIncomplete,
      failedMatches: recalcFailed,
      coreInstantiationFailuresCount: recalcInstFailures,
      totalDecisions: recalcTotalDecisions,
      totalPassDecisions: recalcPassDecisions,
      p1Wins: recalcP1Wins,
      p2Wins: recalcP2Wins,
      draws: recalcDraws,
      deterministicOutcomeChainHash: chainHash,
      chunkHashes,
    })
  );

  if (recalculatedLogicalResultDigest !== evidence.logicalResultDigest) {
    errors.push(
      `Logical result digest mismatch: expected "${evidence.logicalResultDigest}", recalculated "${recalculatedLogicalResultDigest}"`
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
    verifiedMatchesCount: expectedMatchIndex,
    verifiedChunksCount: evidence.chunksManifest.length,
    logicalResultDigest: evidence.logicalResultDigest,
    recalculatedLogicalResultDigest,
  };
}

export function packageMillionMatchZip(
  outputDir: string,
  zipPath: string = `${outputDir}.zip`
): { zipPath: string; zipSha256: string; zipSizeBytes: number } {
  const resolvedDir = path.resolve(outputDir);
  const resolvedZip = path.resolve(zipPath);

  const zipData: Record<string, Uint8Array> = {};
  const walk = (dir: string, prefix: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(full, rel);
      } else if (entry.isFile()) {
        zipData[rel] = new Uint8Array(fs.readFileSync(full));
      }
    }
  };
  walk(resolvedDir, "");

  const zipped = fflate.zipSync(zipData, { level: 6 });
  fs.writeFileSync(resolvedZip, Buffer.from(zipped));
  const stat = fs.statSync(resolvedZip);
  const sha = computeFileSha256(resolvedZip);

  return {
    zipPath: resolvedZip,
    zipSha256: sha,
    zipSizeBytes: stat.size,
  };
}

// =============================================================================
// CLI 引数パーサー & メイン実行関数
// =============================================================================

export interface ParsedLargeScaleCliArgs {
  readonly mode: LargeScaleExecutionMode;
  readonly purpose: CampaignPurpose;
  readonly matches: number;
  readonly chunkSize: number;
  readonly concurrency: 1 | 2;
  readonly campaignSeed: number;
  readonly campaignId: string;
  readonly outputDir: string;
  readonly sessionMatchLimit?: number;
  readonly timeBudgetMinutes?: number;
  readonly reproduceSeed?: number;
  readonly p1PolicyId?: string;
  readonly p2PolicyId?: string;
}

export function parseLargeScaleCliArgs(args: readonly string[]): ParsedLargeScaleCliArgs {
  let planOnly = false;
  let benchmark = false;
  let pilot = false;
  let resume = false;
  let execute = false;
  let reproduceSeed: number | undefined;
  let p1PolicyId: string | undefined;
  let p2PolicyId: string | undefined;
  let purpose: CampaignPurpose | undefined;
  let matches: number | undefined;
  let chunkSize: number | undefined;
  let concurrency: 1 | 2 = 2;
  let campaignSeed: number = DEFAULT_CAMPAIGN_SEED;
  let campaignId: string | undefined;
  let outputDir: string | undefined;
  let sessionMatchLimit: number | undefined;
  let timeBudgetMinutes: number | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--plan-only") planOnly = true;
    else if (arg === "--benchmark") benchmark = true;
    else if (arg === "--pilot") pilot = true;
    else if (arg === "--resume") resume = true;
    else if (arg === "--execute") execute = true;
    else if (arg === "--purpose") {
      const val = args[++i];
      if (val !== "QUALITY_AUDIT" && val !== "AI_EVOLUTION") {
        throw new Error(`[Fail-Closed] Invalid --purpose "${val}". Must be QUALITY_AUDIT or AI_EVOLUTION`);
      }
      purpose = val;
    } else if (arg === "--matches") {
      matches = parseInt(args[++i], 10);
      if (!Number.isInteger(matches) || matches <= 0 || matches % 2 !== 0) {
        throw new Error(`[Fail-Closed] --matches must be a positive even integer, got "${args[i]}"`);
      }
    } else if (arg === "--chunk-size") {
      chunkSize = parseInt(args[++i], 10);
      if (!Number.isInteger(chunkSize) || chunkSize <= 0 || chunkSize % 2 !== 0) {
        throw new Error(`[Fail-Closed] --chunk-size must be a positive even integer, got "${args[i]}"`);
      }
    } else if (arg === "--session-match-limit") {
      sessionMatchLimit = parseInt(args[++i], 10);
      if (!Number.isInteger(sessionMatchLimit) || sessionMatchLimit <= 0 || sessionMatchLimit % 2 !== 0) {
        throw new Error(
          `[Fail-Closed] --session-match-limit must be a positive even integer (seat-swapped pairs), got "${args[i]}"`
        );
      }
    } else if (arg === "--time-budget-minutes") {
      timeBudgetMinutes = parseFloat(args[++i]);
      if (!Number.isFinite(timeBudgetMinutes) || timeBudgetMinutes <= 0) {
        throw new Error(
          `[Fail-Closed] --time-budget-minutes must be a positive number, got "${args[i]}"`
        );
      }
    } else if (arg === "--concurrency") {
      const c = parseInt(args[++i], 10);
      if (c !== 1 && c !== 2) {
        throw new Error(`[Fail-Closed] --concurrency must be 1 or 2, got "${args[i]}"`);
      }
      concurrency = c;
    } else if (arg === "--campaign-seed") {
      campaignSeed = parseInt(args[++i], 10);
    } else if (arg === "--campaign-id") {
      campaignId = args[++i];
    } else if (arg === "--output-dir") {
      outputDir = args[++i];
    } else if (arg === "--reproduce-seed") {
      reproduceSeed = parseInt(args[++i], 10);
    } else if (arg === "--p1") {
      p1PolicyId = args[++i];
    } else if (arg === "--p2") {
      p2PolicyId = args[++i];
    } else {
      throw new Error(`[Fail-Closed] Unrecognized CLI argument: "${arg}"`);
    }
  }

  if (reproduceSeed !== undefined) {
    return {
      mode: "PILOT",
      purpose: purpose ?? "QUALITY_AUDIT",
      matches: 2,
      chunkSize: 2,
      concurrency: 1,
      campaignSeed,
      campaignId: campaignId ?? `repro-${reproduceSeed}`,
      outputDir: outputDir ?? `.artifacts/work4-repro-${reproduceSeed}`,
      reproduceSeed,
      p1PolicyId: p1PolicyId ?? "gen7-champion",
      p2PolicyId: p2PolicyId ?? "gen5-champion",
    };
  }

  const activeModes = [
    planOnly && "PLAN_ONLY",
    benchmark && "BENCHMARK",
    pilot && "PILOT",
    resume && "RESUME",
    execute && "EXECUTE",
  ].filter(Boolean) as LargeScaleExecutionMode[];

  if (activeModes.length !== 1) {
    throw new Error(
      `[Fail-Closed] Specify exactly one execution mode (--plan-only, --benchmark, --pilot, --resume, or --execute). Got: [${activeModes.join(", ")}]`
    );
  }

  const mode = activeModes[0];

  // RESUME モード時に outputDir の既存 checkpoint.json があれば、未指定パラメータを自動復元
  if (mode === "RESUME" && outputDir) {
    const ckptPath = path.join(path.resolve(outputDir), "checkpoint.json");
    if (fs.existsSync(ckptPath)) {
      try {
        const existingCkpt: MillionMatchCheckpointState = JSON.parse(fs.readFileSync(ckptPath, "utf8"));
        if (matches === undefined) matches = existingCkpt.totalPlannedMatches;
        if (chunkSize === undefined) chunkSize = existingCkpt.chunkSizeMatches;
        if (purpose === undefined) purpose = existingCkpt.purpose;
        if (campaignId === undefined) campaignId = existingCkpt.campaignId;
      } catch {}
    }
  }

  const resolvedPurpose: CampaignPurpose = purpose ?? "QUALITY_AUDIT";
  const resolvedMatches =
    matches ??
    (mode === "PLAN_ONLY"
      ? 1_000_000
      : mode === "BENCHMARK"
      ? 100
      : 1_000);

  const resolvedChunkSize = Math.min(chunkSize ?? DEFAULT_CHUNK_SIZE_MATCHES, resolvedMatches);
  const resolvedCampaignId =
    campaignId ??
    `work4-${resolvedPurpose.toLowerCase().replace("_", "-")}-${mode.toLowerCase()}-${resolvedMatches}`;
  const resolvedOutputDir =
    outputDir ?? `.artifacts/${resolvedCampaignId}`;

  return {
    mode,
    purpose: resolvedPurpose,
    matches: resolvedMatches,
    chunkSize: resolvedChunkSize,
    concurrency,
    campaignSeed,
    campaignId: resolvedCampaignId,
    outputDir: resolvedOutputDir,
    sessionMatchLimit,
    timeBudgetMinutes,
  };
}

export async function runLargeScaleCli(parsed: ParsedLargeScaleCliArgs): Promise<void> {
  console.log(`=== BlackPoker Work 4-1 — Million Match Simulation Runner ===`);
  console.log(`Work ID:       ${WORK4_WORK_ID}`);
  console.log(`Campaign ID:   ${parsed.campaignId}`);
  console.log(`Purpose:       ${parsed.purpose}`);
  console.log(`Mode:          ${parsed.mode}`);
  console.log(`Matches:       ${parsed.matches.toLocaleString()} (${(parsed.matches / 2).toLocaleString()} pairs)`);
  console.log(`Chunk Size:    ${parsed.chunkSize} matches`);
  console.log(`Concurrency:   ${parsed.concurrency}`);
  if (parsed.sessionMatchLimit !== undefined) {
    console.log(`Session Limit: ${parsed.sessionMatchLimit.toLocaleString()} matches`);
  }
  if (parsed.timeBudgetMinutes !== undefined) {
    console.log(`Time Budget:   ${parsed.timeBudgetMinutes} minutes`);
  }
  console.log(`Output Dir:    ${parsed.outputDir}`);

  const gitInfo = checkGitCleanliness();
  console.log(`Git Commit:    ${gitInfo.headCommitSha} (Clean: ${gitInfo.isClean})`);

  const rulesDir = path.resolve("src/data/rules-vnext");
  const fullPackage = await loadRulePackageFromDirectory(rulesDir);
  const rulePackage = getPlaytestRulePackage(fullPackage);
  const sessionFactory = await prepareOfficialSessionFactory(DEFAULT_REGULATION_ID);
  const champions = loadOfficialOrFallbackChampions({ allowFallbackInCi: true });
  const { matchups, policyResolver } = createStandardMatchupsAndResolver(champions);

  // 単一 Seed 再現モード
  if (parsed.reproduceSeed !== undefined) {
    console.log(`\n[REPRODUCE MODE] Reproducing matchSeed=${parsed.reproduceSeed} (${parsed.p1PolicyId} vs ${parsed.p2PolicyId})...`);
    const p1Seed = derivePlayerSeed(parsed.reproduceSeed, "p1");
    const p2Seed = derivePlayerSeed(parsed.reproduceSeed, "p2");
    const allSpecs = [matchups[0].agentA, matchups[0].agentB, matchups[1].agentB, matchups[2].agentB];
    const p1Spec = allSpecs.find((s) => s.policyId === parsed.p1PolicyId) ?? matchups[0].agentA;
    const p2Spec = allSpecs.find((s) => s.policyId === parsed.p2PolicyId) ?? matchups[0].agentB;

    const res = executeSingleInstrumentedMatch({
      campaignId: parsed.campaignId,
      workId: WORK4_WORK_ID,
      matchIndex: 0,
      pairIndex: 0,
      legIndex: 0,
      matchId: `repro-${parsed.reproduceSeed}`,
      matchupId: "repro",
      matchSeed: parsed.reproduceSeed,
      playerSeeds: { p1: p1Seed, p2: p2Seed },
      p1Spec,
      p2Spec,
      p1Policy: policyResolver(p1Spec, "p1", parsed.reproduceSeed, p1Seed),
      p2Policy: policyResolver(p2Spec, "p2", parsed.reproduceSeed, p2Seed),
      sessionFactory,
      regulationId: DEFAULT_REGULATION_ID,
      frameId: DEFAULT_FRAME_ID,
      maxDecisionsPerMatch: DEFAULT_DECISION_LIMIT,
    });
    console.log(`Reproduced Outcome:`, JSON.stringify(res.outcomeRecord, null, 2));
    return;
  }

  validateMillionMatchOutputDir(parsed.outputDir, parsed.mode);

  const stage: ScaleVerificationStage =
    parsed.matches === 1_000
      ? "STAGE_A_1K"
      : parsed.matches === 10_000
      ? "STAGE_B_10K"
      : parsed.matches === 100_000
      ? "STAGE_C_100K_LOCKED"
      : parsed.matches === 1_000_000
      ? "STAGE_D_1M_LOCKED"
      : "CUSTOM_PILOT";

  const { evidence } = await MillionMatchCampaignEngine.runCampaign({
    workId: WORK4_WORK_ID,
    campaignId: parsed.campaignId,
    purpose: parsed.purpose,
    stage,
    executionMode: parsed.mode,
    totalPlannedMatches: parsed.matches,
    campaignSeed: parsed.campaignSeed,
    regulationId: DEFAULT_REGULATION_ID,
    frameId: DEFAULT_FRAME_ID,
    rulePackageVersion: DEFAULT_RULE_PACKAGE_VERSION,
    featureSchemaVersion: DEFAULT_FEATURE_SCHEMA_VERSION,
    rulePackage,
    matchups,
    policyResolver,
    sessionFactory,
    outputDir: parsed.outputDir,
    maxDecisionsPerMatch: DEFAULT_DECISION_LIMIT,
    chunkSizeMatches: parsed.chunkSize,
    maxConcurrency: parsed.concurrency,
    gitCommitSha: gitInfo.headCommitSha,
    isGitClean: gitInfo.isClean,
    sessionMatchLimit: parsed.sessionMatchLimit,
    timeBudgetMinutes: parsed.timeBudgetMinutes,
  });

  if (parsed.mode === "PLAN_ONLY") {
    console.log(`\n[PLAN-ONLY] 1,000,000-Match Execution Plan & Seed Space Verified:`);
    console.log(JSON.stringify({
      campaignId: evidence.campaignId,
      purpose: evidence.purpose,
      configDigest: evidence.configDigest,
      seedSpace: evidence.seedSpace,
      matchups: evidence.matchups.map((m) => m.name),
      scaleProjections: evidence.performance.scaleProjections,
      evolutionAllocationPlan: evidence.evolution.millionMatchEvolutionAllocationPlan,
      hardwareRecommendations: evidence.hardwareRecommendationsFor1M,
    }, null, 2));
    return;
  }

  console.log(`\nCampaign execution finished:`);
  console.log(`  Executed Matches:  ${evidence.performance.executedMatches} / ${evidence.performance.totalPlannedMatches}`);
  console.log(`  Elapsed Time:      ${(evidence.performance.totalElapsedMs / 1000).toFixed(2)}s (${evidence.performance.matchesPerSecond.toFixed(2)} matches/sec)`);
  console.log(`  Peak Memory:       RSS ${(evidence.performance.memory.peakRssBytes / (1024 * 1024)).toFixed(1)} MB, Heap ${(evidence.performance.memory.peakHeapUsedBytes / (1024 * 1024)).toFixed(1)} MB`);
  console.log(`  Status:            ${evidence.campaignStatus}`);
  console.log(`  Logical Digest:    ${evidence.logicalResultDigest}`);

  console.log(`\nSaving campaign artifacts to "${parsed.outputDir}"...`);
  const saved = saveMillionMatchArtifacts(evidence, parsed.outputDir);
  console.log(`Saved ${saved.savedFiles.length} tracked files.`);

  console.log(`Running self-audit on "${parsed.outputDir}"...`);
  const audit = auditMillionMatchArtifacts(parsed.outputDir);
  if (!audit.isValid) {
    throw new Error(`[Self-Audit FAILED] Errors:\n${audit.errors.join("\n")}`);
  }
  console.log(`Self-Audit: PASS (Verified ${audit.verifiedMatchesCount} matches across ${audit.verifiedChunksCount} chunks).`);

  const zipPath = path.resolve(`${parsed.outputDir}.zip`);
  console.log(`Packaging ZIP archive at "${zipPath}"...`);
  const zipRes = packageMillionMatchZip(parsed.outputDir, zipPath);
  console.log(`ZIP created: ${zipRes.zipSizeBytes} bytes (SHA-256: ${zipRes.zipSha256})`);
  console.log(`=== Million Match Simulation Runner Complete ===\n`);
}

// 直接実行時のエントリポイント
const isMainScript =
  (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) ||
  process.argv.some((arg) => arg.includes("largeScaleSimulationRunner"));

if (isMainScript && !process.env.VITEST && !process.argv.includes("--no-auto-run")) {
  try {
    const parsed = parseLargeScaleCliArgs(process.argv.slice(2));
    await runLargeScaleCli(parsed);
  } catch (err: any) {
    console.error(`[FATAL ERROR] LargeScaleSimulationRunner failed:`, err?.message ?? String(err));
    process.exit(1);
  }
}
