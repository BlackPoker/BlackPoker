import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { GameSession } from "../session/GameSession";
import { DecisionPolicy, PolicyDescriptor } from "./DecisionPolicy";
import { SimulationRunner, SimulationResult } from "./SimulationRunner";
import {
  createExecutionManifest,
  assertNotDirty,
  saveOfficialEvidenceWithManifest,
  ExecutionManifest,
  ExperimentConfigManifest,
} from "./ExecutionManifest";
import {
  LARGE_SCALE_BATCH_VERSION,
  LargeScaleBatchConfig,
  LargeScaleBatchEvidence,
  LargeScaleBatchSummary,
  LargeScaleFailureRecord,
  LargeScaleMatchResult,
  LargeScalePerformanceMetrics,
  LargeScaleSeatInfo,
  LatencyPercentiles,
  MemorySample,
  MemoryTelemetry,
  CpuTelemetry,
  BatchCheckpointState,
} from "../../domain/simulation/LargeScaleBatchTypes";

/**
 * 実験開始時と終了時の Execution Manifest 不整合を示す例外 (fail-closed)
 */
export class ExecutionManifestIntegrityMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExecutionManifestIntegrityMismatchError";
  }
}

/**
 * 大規模バッチ実行設定・状態エラー
 */
export class LargeScaleBatchConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LargeScaleBatchConfigurationError";
  }
}

function sha256(data: string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function resolveRootDir(customDir?: string): string {
  if (customDir && fs.existsSync(customDir)) return customDir;
  if (fs.existsSync(path.resolve(process.cwd(), "tools/simulator"))) {
    return process.cwd();
  }
  // tools/simulator 内で実行されている場合
  if (fs.existsSync(path.resolve(process.cwd(), "src/engine"))) {
    return path.resolve(process.cwd(), "../..");
  }
  return path.resolve(__dirname, "../../../../../");
}

/**
 * 32-bit FNV-1a を用いて決定論的シードを導出
 */
export function deriveBatchSeed(baseSeed: number, matchIndex: number, streamKey: string): number {
  const str = `${baseSeed}:${matchIndex}:${streamKey}`;
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Decision Trace から決定論的トレースダイジェスト (SHA-256) を算出
 */
export function computeTraceDigestFromSimulation(simRes: SimulationResult): string {
  if (!simRes.decisionTrace || simRes.decisionTrace.length === 0) {
    return sha256("[]");
  }
  return sha256(JSON.stringify(simRes.decisionTrace.map((r) => r.logicalDecisionId)));
}

/**
 * 試合コンテキスト
 */
export interface LargeScaleMatchContext {
  readonly matchIndex: number;
  readonly matchId: string;
  readonly baseSeed: number;
  readonly matchSeed: number;
  readonly playerSeeds: Record<string, number>;
}

/**
 * 大規模バッチ実行ランナー
 *
 * 【設計原則】:
 * 1. Execution Manifest を実験開始時と終了時に検証し、試合ごとの Git コマンド実行を完全排除。
 * 2. 生の Decision Trace は通常試合では保持せず、traceDigest に圧縮してメモリを保護（ヒープ枯渇防止）。
 * 3. 失敗試合（FAILED / INCOMPLETE）は勝敗に変換せず、原因究明用トレースを詳細退避。
 * 4. 途中停止・再開に対応したチェックポイント機能を提供。
 */
export class LargeScaleBatchRunner {
  public static readonly VERSION = LARGE_SCALE_BATCH_VERSION;

  /**
   * バッチ実行のライフサイクルを管理し、Evidence を生成する実行クラス
   */
  public static async runBatch(params: {
    readonly config: LargeScaleBatchConfig;
    readonly sessionFactory: (ctx: LargeScaleMatchContext) => GameSession;
    readonly policyFactory: (ctx: LargeScaleMatchContext) => {
      policies: Record<string, DecisionPolicy>;
      seats: Record<string, LargeScaleSeatInfo>;
    };
    readonly rulePackageDigest: string;
    readonly resumeCheckpointPath?: string;
  }): Promise<{
    summary: LargeScaleBatchSummary;
    performance: LargeScalePerformanceMetrics;
    matches: readonly LargeScaleMatchResult[];
    failures: readonly LargeScaleFailureRecord[];
    initialManifest: ExecutionManifest;
    postManifest: ExecutionManifest;
    saveEvidence: (outputFilePath: string) => void;
  }> {
    const { config, sessionFactory, policyFactory, rulePackageDigest, resumeCheckpointPath } = params;

    // 0. 設定検証
    if (!config || config.matchCount < 1) {
      throw new LargeScaleBatchConfigurationError("matchCount must be >= 1");
    }

    // 1. 実験開始時 Manifest 取得 & fail-closed ガード
    const rootDir = resolveRootDir(config.rootDir);
    const experimentConfig: ExperimentConfigManifest = {
      regulationId: config.regulationId,
      rulePackageId: config.rulePackageId ?? "official-rules",
      rulePackageVersion: config.rulePackageVersion ?? "9.2.0",
      rulePackageDigest,
      campaignSeed: config.baseSeed,
      randomGenerator: "32-bit FNV-1a pure function deriveBatchSeed",
      decisionTraceVersion: SimulationRunner.DECISION_TRACE_VERSION,
      models: config.models ?? [],
      playerPolicies: config.playerPolicies ?? [],
    };

    const initialManifest = createExecutionManifest({
      workId: config.workId,
      rootDir,
      experimentConfig,
      overrideGitMetadata: config.overrideGitMetadata,
    });
    // 未コミット変更や Git 検証失敗があれば即座に拒否
    assertNotDirty(initialManifest);

    // 2. CPU / メモリ Baseline 測定
    const startWallClock = globalThis.performance.now();
    const startCpu = process.cpuUsage();
    const initialMem = process.memoryUsage();

    let peakRss = initialMem.rss;
    let peakHeapUsed = initialMem.heapUsed;

    const memorySamples: MemorySample[] = [
      {
        matchIndex: 0,
        rssBytes: initialMem.rss,
        heapTotalBytes: initialMem.heapTotal,
        heapUsedBytes: initialMem.heapUsed,
        externalBytes: initialMem.external,
      },
    ];

    // 3. チェックポイントの復元（再開時）
    const matches: LargeScaleMatchResult[] = [];
    const failures: LargeScaleFailureRecord[] = [];
    const matchDurationsMs: number[] = [];
    let startIndex = 0;

    if (resumeCheckpointPath && fs.existsSync(resumeCheckpointPath)) {
      const rawCheckpoint = fs.readFileSync(resumeCheckpointPath, "utf-8");
      const chk: BatchCheckpointState = JSON.parse(rawCheckpoint);
      if (chk.batchId === config.batchId && chk.baseSeed === config.baseSeed) {
        matches.push(...chk.completedMatches);
        failures.push(...chk.failures);
        startIndex = chk.lastCompletedIndex + 1;
        for (const m of chk.completedMatches) {
          matchDurationsMs.push(m.durationMs);
        }
      }
    }

    const checkpointDir =
      config.checkpointDir ||
      path.resolve(rootDir, "tools/simulator/.artifacts/checkpoints");
    const checkpointInterval = config.checkpointInterval ?? 100;
    const memorySamplingInterval = config.memorySamplingInterval ?? 25;
    const maxDecisions = config.maxDecisionsPerMatch ?? 500;

    // 4. 試合実行ループ (Git コマンドは試合ごとに実行しない)
    for (let i = startIndex; i < config.matchCount; i++) {
      const matchStartTime = globalThis.performance.now();
      const matchSeed = deriveBatchSeed(config.baseSeed, i, "match");
      const playerSeeds: Record<string, number> = {
        p1: deriveBatchSeed(config.baseSeed, i, "p1"),
        p2: deriveBatchSeed(config.baseSeed, i, "p2"),
      };
      const matchId = `${config.batchId}-s${config.baseSeed}-m${String(i).padStart(6, "0")}`;

      const matchCtx: LargeScaleMatchContext = {
        matchIndex: i,
        matchId,
        baseSeed: config.baseSeed,
        matchSeed,
        playerSeeds,
      };

      let session: GameSession | undefined;
      let policyBundle: {
        policies: Record<string, DecisionPolicy>;
        seats: Record<string, LargeScaleSeatInfo>;
      } | undefined;
      let simRes: SimulationResult | undefined;
      let failureRecord: LargeScaleFailureRecord | undefined;

      try {
        // Session 生成
        try {
          session = sessionFactory(matchCtx);
        } catch (err: any) {
          throw { phase: "SESSION_SETUP", error: err };
        }

        // Policy 生成
        try {
          policyBundle = policyFactory(matchCtx);
        } catch (err: any) {
          throw { phase: "POLICY_SETUP", error: err };
        }

        // Simulation 実行
        try {
          simRes = SimulationRunner.run(session, policyBundle.policies, {
            maxDecisions,
            enableSemanticDiagnostics: false,
          });
        } catch (err: any) {
          throw { phase: "SIMULATION", error: err };
        }
      } catch (wrapper: any) {
        const phase = wrapper?.phase ?? "UNKNOWN";
        const err = wrapper?.error ?? wrapper;
        const errorName = err?.name || "Error";
        const errorMessage = err?.message || String(err);
        const errorStack = err?.stack;

        failureRecord = {
          matchIndex: i,
          matchId,
          phase,
          errorName,
          errorMessage,
          errorStack,
        };
        failures.push(failureRecord);
      }

      const matchDurationMs = globalThis.performance.now() - matchStartTime;
      matchDurationsMs.push(matchDurationMs);

      // 結果サマリー構築
      if (failureRecord) {
        matches.push({
          matchIndex: i,
          matchId,
          status: "FAILED",
          completed: false,
          totalDecisions: 0,
          turnCount: 0,
          durationMs: matchDurationMs,
          baseSeed: config.baseSeed,
          matchSeed,
          playerSeeds,
          seats: policyBundle?.seats ?? {},
          regulationId: config.regulationId,
          rulePackageDigest,
          failure: failureRecord,
        });
      } else if (simRes) {
        const traceDigest = computeTraceDigestFromSimulation(simRes);
        const status = simRes.completed ? "COMPLETED" : "INCOMPLETE";

        // INCOMPLETE 発生時は詳細原因追究のため failure 情報を付与
        let incompleteFailure: LargeScaleFailureRecord | undefined;
        if (!simRes.completed) {
          incompleteFailure = {
            matchIndex: i,
            matchId,
            phase: "SIMULATION",
            errorName: "IncompleteMatchWarning",
            errorMessage: `Match exceeded max decisions limit (${maxDecisions}) without completion`,
            occurredAtStep: simRes.totalDecisions,
            decisionTraceSnapshot: simRes.decisionTrace?.slice(-10), // 直前10件のみ退避
            canonicalMatchLog: simRes.matchLog,
          };
          failures.push(incompleteFailure);
        }

        matches.push({
          matchIndex: i,
          matchId,
          status,
          completed: simRes.completed,
          winner: simRes.winner,
          reason: simRes.reason,
          totalDecisions: simRes.totalDecisions,
          turnCount: simRes.turnCount,
          finalStateHash: simRes.finalStateHash,
          traceDigest,
          durationMs: matchDurationMs,
          baseSeed: config.baseSeed,
          matchSeed,
          playerSeeds,
          seats: policyBundle?.seats ?? {},
          regulationId: config.regulationId,
          rulePackageDigest,
          failure: incompleteFailure,
        });

        // 【メモリ保護】: simRes.decisionTrace はスコープアウトさせて GC 対象にする
        simRes = undefined;
        session = undefined;
        policyBundle = undefined;
      }

      // メモリサンプリング
      if ((i + 1) % memorySamplingInterval === 0 || i === config.matchCount - 1) {
        const mem = process.memoryUsage();
        if (mem.rss > peakRss) peakRss = mem.rss;
        if (mem.heapUsed > peakHeapUsed) peakHeapUsed = mem.heapUsed;
        memorySamples.push({
          matchIndex: i + 1,
          rssBytes: mem.rss,
          heapTotalBytes: mem.heapTotal,
          heapUsedBytes: mem.heapUsed,
          externalBytes: mem.external,
        });
      }

      // 進捗コールバック
      if (config.onProgress && ((i + 1) % 50 === 0 || i === config.matchCount - 1)) {
        const currentElapsed = globalThis.performance.now() - startWallClock;
        const speed = (i + 1) / (currentElapsed / 1000);
        const mem = process.memoryUsage();
        config.onProgress({
          completedMatches: i + 1,
          totalMatches: config.matchCount,
          currentSpeedMps: speed,
          heapUsedMb: mem.heapUsed / (1024 * 1024),
        });
      }

      // チェックポイント保存
      if ((i + 1) % checkpointInterval === 0 && (i + 1) < config.matchCount) {
        if (!fs.existsSync(checkpointDir)) {
          fs.mkdirSync(checkpointDir, { recursive: true });
        }
        const chkFile = path.join(
          checkpointDir,
          `${config.batchId}-chk-${String(i + 1).padStart(6, "0")}.json`
        );
        const chkData: BatchCheckpointState = {
          checkpointVersion: LARGE_SCALE_BATCH_VERSION,
          batchId: config.batchId,
          baseSeed: config.baseSeed,
          totalTargetMatches: config.matchCount,
          lastCompletedIndex: i,
          timestamp: new Date().toISOString(),
          completedMatches: matches,
          failures,
        };
        fs.writeFileSync(chkFile, JSON.stringify(chkData, null, 2), "utf-8");
      }
    }

    // 5. 終了時メトリクス集計
    const wallClockElapsedMs = globalThis.performance.now() - startWallClock;
    const endCpu = process.cpuUsage(startCpu);
    const finalMem = process.memoryUsage();
    if (finalMem.rss > peakRss) peakRss = finalMem.rss;
    if (finalMem.heapUsed > peakHeapUsed) peakHeapUsed = finalMem.heapUsed;

    // CPU メトリクス算出
    const userCpuMs = endCpu.user / 1000;
    const sysCpuMs = endCpu.system / 1000;
    const totalCpuMs = userCpuMs + sysCpuMs;
    const cpuUtilizationPercent =
      wallClockElapsedMs > 0 ? (totalCpuMs / wallClockElapsedMs) * 100 : 0;

    const cpuTelemetry: CpuTelemetry = {
      userCpuTimeMs: userCpuMs,
      systemCpuTimeMs: sysCpuMs,
      totalCpuTimeMs: totalCpuMs,
      cpuUtilizationPercent,
    };

    // メモリテレメトリ算出
    const memoryTelemetry: MemoryTelemetry = {
      baselineRssBytes: initialMem.rss,
      baselineHeapUsedBytes: initialMem.heapUsed,
      peakRssBytes: peakRss,
      peakHeapUsedBytes: peakHeapUsed,
      finalRssBytes: finalMem.rss,
      finalHeapUsedBytes: finalMem.heapUsed,
      heapGrowthBytes: finalMem.heapUsed - initialMem.heapUsed,
      rssGrowthBytes: finalMem.rss - initialMem.rss,
      samples: memorySamples,
    };

    // レイテンシ分布算出
    const sortedDurations = [...matchDurationsMs].sort((a, b) => a - b);
    const n = sortedDurations.length;
    const sumDuration = sortedDurations.reduce((a, b) => a + b, 0);
    const meanDuration = n > 0 ? sumDuration / n : 0;
    const medianDuration =
      n > 0
        ? n % 2 === 1
          ? sortedDurations[Math.floor(n / 2)]
          : (sortedDurations[n / 2 - 1] + sortedDurations[n / 2]) / 2
        : 0;

    const p90Duration = n > 0 ? sortedDurations[Math.max(0, Math.ceil(0.9 * n) - 1)] : 0;
    const p95Duration = n > 0 ? sortedDurations[Math.max(0, Math.ceil(0.95 * n) - 1)] : 0;
    const p99Duration = n > 0 ? sortedDurations[Math.max(0, Math.ceil(0.99 * n) - 1)] : 0;

    const latencies: LatencyPercentiles = {
      meanMs: meanDuration,
      medianMs: medianDuration,
      p90Ms: p90Duration,
      p95Ms: p95Duration,
      p99Ms: p99Duration,
      minMs: n > 0 ? sortedDurations[0] : 0,
      maxMs: n > 0 ? sortedDurations[n - 1] : 0,
    };

    // スループットと推定値
    const matchesPerSecond = n > 0 ? n / (wallClockElapsedMs / 1000) : 0;
    const estimated10kDurationSec =
      matchesPerSecond > 0 ? 10000 / matchesPerSecond : 0;
    const estimated10kDurationHours = estimated10kDurationSec / 3600;

    const totalDecisionsCount = matches.reduce((acc, m) => acc + m.totalDecisions, 0);
    const meanMsPerDecision =
      totalDecisionsCount > 0 ? sumDuration / totalDecisionsCount : null;

    const performance: LargeScalePerformanceMetrics = {
      totalMatches: config.matchCount,
      executedMatches: matches.length,
      wallClockElapsedMs,
      matchesPerSecond,
      latencies,
      totalDecisions: totalDecisionsCount,
      meanMsPerDecision,
      estimated10kMatchesDurationSec: estimated10kDurationSec,
      estimated10kMatchesDurationHours: estimated10kDurationHours,
      memory: memoryTelemetry,
      cpu: cpuTelemetry,
    };

    // サマリー算出
    let completedCount = 0;
    let incompleteCount = 0;
    let failedCount = 0;
    let drawCount = 0;
    const winsByPlayer: Record<string, number> = {};
    let totalCompletedDecisions = 0;
    let totalCompletedTurns = 0;

    for (const m of matches) {
      if (m.status === "COMPLETED") {
        completedCount++;
        totalCompletedDecisions += m.totalDecisions;
        totalCompletedTurns += m.turnCount;
        if (m.winner) {
          winsByPlayer[m.winner] = (winsByPlayer[m.winner] ?? 0) + 1;
        } else {
          drawCount++;
        }
      } else if (m.status === "INCOMPLETE") {
        incompleteCount++;
      } else if (m.status === "FAILED") {
        failedCount++;
      }
    }

    const winRates: Record<string, number> = {};
    for (const [p, wins] of Object.entries(winsByPlayer)) {
      winRates[p] = completedCount > 0 ? wins / completedCount : 0;
    }

    const summary: LargeScaleBatchSummary = {
      totalMatches: config.matchCount,
      completedCount,
      incompleteCount,
      failedCount,
      winsByPlayer,
      drawCount,
      winRates,
      averageDecisionsPerCompletedMatch:
        completedCount > 0 ? totalCompletedDecisions / completedCount : 0,
      averageTurnsPerCompletedMatch:
        completedCount > 0 ? totalCompletedTurns / completedCount : 0,
    };

    // 6. 実験終了時 Manifest 再取得 & 整合性検証 (fail-closed)
    const postManifest = createExecutionManifest({
      workId: config.workId,
      rootDir,
      experimentConfig: initialManifest.experimentConfig,
      overrideGitMetadata: config.overrideGitMetadata,
    });

    // 終了時整合性の厳格検証
    if (postManifest.gitMetadata.verificationStatus !== "VERIFIED") {
      throw new ExecutionManifestIntegrityMismatchError(
        `終了時の Git 検証ステータスが VERIFIED ではありません (${postManifest.gitMetadata.verificationStatus})`
      );
    }
    if (postManifest.gitMetadata.isDirty) {
      throw new ExecutionManifestIntegrityMismatchError(
        `実験実行中に未コミット変更が発生しました (isDirty: true, dirtyFiles: ${postManifest.gitMetadata.dirtyFiles.join(", ")})`
      );
    }
    if (postManifest.gitMetadata.headCommitSha !== initialManifest.gitMetadata.headCommitSha) {
      throw new ExecutionManifestIntegrityMismatchError(
        `実験開始時と終了時で HEAD Commit SHA が異なります (Initial: ${initialManifest.gitMetadata.headCommitSha}, Post: ${postManifest.gitMetadata.headCommitSha})`
      );
    }
    if (
      JSON.stringify(postManifest.subsystemDigests) !==
      JSON.stringify(initialManifest.subsystemDigests)
    ) {
      throw new ExecutionManifestIntegrityMismatchError(
        `実験開始時と終了時で主要サブシステム Digest が異なります (fail-closed)`
      );
    }

    // 7. 正式 Evidence 保存クロージャの構築
    const saveEvidence = (outputFilePath: string): void => {
      // 保存直前に最終ガード
      assertNotDirty(postManifest);

      const evidencePayload: LargeScaleBatchEvidence = {
        schemaVersion: LARGE_SCALE_BATCH_VERSION,
        workId: config.workId,
        generatedAt: new Date().toISOString(),
        executionManifest: postManifest,
        configuration: {
          batchId: config.batchId,
          workId: config.workId,
          baseSeed: config.baseSeed,
          matchCount: config.matchCount,
          maxDecisionsPerMatch: maxDecisions,
          regulationId: config.regulationId,
        },
        summary,
        performance,
        matches,
        isolatedFailures: failures,
        reproducibilityRecipe: {
          baseSeed: config.baseSeed,
          sampleIndices: [0, Math.floor(config.matchCount / 2), config.matchCount - 1],
        },
      };

      saveOfficialEvidenceWithManifest({
        filePath: outputFilePath,
        evidenceData: evidencePayload,
        manifest: postManifest,
      });
    };

    return {
      summary,
      performance,
      matches,
      failures,
      initialManifest,
      postManifest,
      saveEvidence,
    };
  }
}
