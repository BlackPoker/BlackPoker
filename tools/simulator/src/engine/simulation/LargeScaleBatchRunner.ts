import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { GameSession } from "../session/GameSession";
import { DecisionPolicy } from "./DecisionPolicy";
import { SimulationRunner, SimulationResult, DecisionTraceRecord } from "./SimulationRunner";
import {
  createExecutionManifest,
  assertNotDirty,
  saveOfficialEvidenceWithManifest,
  saveTestEvidenceWithManifest,
  computeFullDnaDigest,
  ExecutionManifest,
  ExperimentConfigManifest,
  GitExecutionMetadata,
  PlayerPolicyManifestEntry,
  ModelManifestEntry,
  computeDirectoryContentDigest,
  canonicalJsonStringify,
  ExecutionManifestUnverifiedGitStateError,
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
  GcDiagnostics,
  HalfwayComparisonMetrics,
  HalfwaySegmentMetrics,
} from "../../domain/simulation/LargeScaleBatchTypes";

/**
 * 実験開始時と終了時、またはチェックポイントとの Execution Manifest 不整合を示す例外 (fail-closed)
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
  if (fs.existsSync(path.resolve(process.cwd(), "src/engine"))) {
    return path.resolve(process.cwd(), "../..");
  }
  return path.resolve(__dirname, "../../../../../");
}

/**
 * 直近 N 件の意思決定トレースのみを保持するリングバッファ (メモリ保護と障害診断の両立)
 */
export class RecentDecisionTraceRingBuffer {
  private readonly buffer: DecisionTraceRecord[];
  private head: number = 0;
  private count: number = 0;

  constructor(public readonly capacity: number = 10) {
    this.buffer = new Array(capacity);
  }

  push(record: DecisionTraceRecord): void {
    this.buffer[this.head] = record;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) {
      this.count++;
    }
  }

  toArray(): DecisionTraceRecord[] {
    const result: DecisionTraceRecord[] = [];
    if (this.count < this.capacity) {
      for (let i = 0; i < this.count; i++) {
        result.push(this.buffer[i]);
      }
    } else {
      for (let i = 0; i < this.capacity; i++) {
        const idx = (this.head + i) % this.capacity;
        result.push(this.buffer[idx]);
      }
    }
    return result;
  }

  get length(): number {
    return this.count;
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
    this.buffer.fill(undefined as any);
  }
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
 * チェックポイントの完全な正規化チェックサムを計算
 *
 * 【仕様契約】:
 * checksum 自身を除く、チェックポイントの全永続化内容（completedMatches の seats, reason, durationMs、
 * failures、全設定値、タイムスタンプ等）を canonicalJsonStringify でキー順序も含めて正規化し、SHA-256 を算出します。
 *
 * ※注意: 本チェックサムは誤破損・ファイル欠損・偶発的不整合の検出を目的とする fail-closed ガードであり、
 * チェックサムを再計算可能な第三者による意図的改ざんの防止（暗号署名）までは保証しません。
 */
export function computeCheckpointChecksum(
  state: BatchCheckpointState | Omit<BatchCheckpointState, "checksum">
): string {
  const { checksum: _discard, ...withoutChecksum } = state as any;
  return sha256(canonicalJsonStringify(withoutChecksum));
}

/**
 * Policy 設定と実際の生成ポリシーの整合性を照合
 */
export function validatePolicyConsistency(params: {
  readonly expectedPolicies?: readonly PlayerPolicyManifestEntry[];
  readonly expectedModels?: readonly ModelManifestEntry[];
  readonly actualSeats: Record<string, LargeScaleSeatInfo>;
  readonly actualPolicies: Record<string, DecisionPolicy>;
  readonly matchCtx?: LargeScaleMatchContext;
}): void {
  const { expectedPolicies, expectedModels, actualSeats, actualPolicies, matchCtx } = params;
  if (!expectedPolicies || expectedPolicies.length === 0) {
    return;
  }

  for (const exp of expectedPolicies) {
    const seat = exp.seat;
    const actualSeatInfo = actualSeats[seat];
    const actualPolicy = actualPolicies[seat];

    if (!actualSeatInfo || !actualPolicy) {
      throw new LargeScaleBatchConfigurationError(
        `座席 '${seat}' に対するポリシーが生成されていません`
      );
    }

    if (actualPolicy.descriptor.kind !== exp.descriptor.kind) {
      throw new LargeScaleBatchConfigurationError(
        `座席 '${seat}' のポリシー種別不一致 (Expected: ${exp.descriptor.kind}, Actual: ${actualPolicy.descriptor.kind})`
      );
    }

    if (actualPolicy.descriptor.policyVersion !== exp.descriptor.policyVersion) {
      throw new LargeScaleBatchConfigurationError(
        `座席 '${seat}' のポリシーバージョン不一致 (Expected: ${exp.descriptor.policyVersion}, Actual: ${actualPolicy.descriptor.policyVersion})`
      );
    }

    // 固定設定値の照合 (preferPass 等)
    if (exp.constructorSettings) {
      for (const [key, expectedVal] of Object.entries(exp.constructorSettings)) {
        if (key === "derivation") continue; // derivation はシード照合で別途検証
        const actualVal =
          (actualPolicy as any)[key] ?? actualPolicy.descriptor.metadata?.[key];
        if (actualVal !== undefined && actualVal !== expectedVal) {
          throw new LargeScaleBatchConfigurationError(
            `座席 '${seat}' の設定値 '${key}' 不一致 (Expected: ${expectedVal}, Actual: ${actualVal})`
          );
        }
      }
    }

    // SeededRandom 乱数シードの照合
    if (actualPolicy.descriptor.kind === "random" && matchCtx) {
      const expectedSeed = matchCtx.playerSeeds[seat];
      const actualSeed =
        (actualPolicy as any).rng?.seed ?? actualPolicy.descriptor.metadata?.seed;
      if (expectedSeed !== undefined && actualSeed !== undefined && actualSeed !== expectedSeed) {
        throw new LargeScaleBatchConfigurationError(
          `座席 '${seat}' の SeededRandom シード不一致 (Expected: ${expectedSeed}, Actual: ${actualSeed})`
        );
      }
    }

    // GenomePolicy の DNA 整合性検証 (検証スキップ禁止契約)
    if (actualPolicy.descriptor.kind === "genome") {
      if (!expectedModels || expectedModels.length === 0) {
        throw new LargeScaleBatchConfigurationError(
          `座席 '${seat}' に GenomePolicy が指定されていますが、Manifest に models 定義が存在しません (検証スキップ禁止)`
        );
      }
      const actualDna = (actualPolicy as any).dna;
      if (!actualDna) {
        throw new LargeScaleBatchConfigurationError(
          `座席 '${seat}' の GenomePolicy に DNA が設定されていません`
        );
      }

      // R3 Evidence および deterministicReplay と完全に同一の統一関数で Digest 算出
      const actualDnaFullDigest = computeFullDnaDigest(actualDna);
      const matchingModel = expectedModels.find((m) => m.fullDnaDigest === actualDnaFullDigest);
      if (!matchingModel) {
        throw new LargeScaleBatchConfigurationError(
          `座席 '${seat}' の GenomePolicy DNA Digest (${actualDnaFullDigest}) が Manifest の models リストに存在しません`
        );
      }
    }
  }
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
 * 連続対戦の前半・後半の性能およびメモリ推移を比較計算
 */
export function computeHalfwayComparison(params: {
  readonly matches: readonly LargeScaleMatchResult[];
  readonly memorySamples: readonly MemorySample[];
}): HalfwayComparisonMetrics | undefined {
  const { matches, memorySamples } = params;
  if (matches.length < 2) return undefined;

  const halfIndex = Math.floor(matches.length / 2);
  const firstHalfMatches = matches.slice(0, halfIndex);
  const secondHalfMatches = matches.slice(halfIndex);

  const calcSegment = (
    segMatches: readonly LargeScaleMatchResult[],
    startIndex: number,
    endIndex: number
  ): HalfwaySegmentMetrics => {
    const durations = segMatches.map((m) => m.durationMs).sort((a, b) => a - b);
    const totalElapsed = durations.reduce((a, b) => a + b, 0);
    const mps = totalElapsed > 0 ? (segMatches.length / totalElapsed) * 1000 : 0;
    const mean = durations.length > 0 ? totalElapsed / durations.length : 0;
    const median =
      durations.length > 0
        ? durations.length % 2 === 1
          ? durations[Math.floor(durations.length / 2)]
          : (durations[durations.length / 2 - 1] + durations[durations.length / 2]) / 2
        : 0;

    const findClosestSample = (targetIdx: number) => {
      if (memorySamples.length === 0) return { heapUsedBytes: 0, rssBytes: 0 };
      let best = memorySamples[0];
      let bestDiff = Math.abs(best.matchIndex - targetIdx);
      for (const s of memorySamples) {
        const diff = Math.abs(s.matchIndex - targetIdx);
        if (diff < bestDiff) {
          best = s;
          bestDiff = diff;
        }
      }
      return best;
    };

    const startMem = findClosestSample(startIndex);
    const endMem = findClosestSample(endIndex);

    return {
      matchCount: segMatches.length,
      startMatchIndex: startIndex,
      endMatchIndex: endIndex,
      elapsedMs: totalElapsed,
      matchesPerSecond: mps,
      meanLatencyMs: mean,
      medianLatencyMs: median,
      startHeapUsedBytes: startMem.heapUsedBytes,
      endHeapUsedBytes: endMem.heapUsedBytes,
      heapGrowthBytes: endMem.heapUsedBytes - startMem.heapUsedBytes,
      startRssBytes: startMem.rssBytes,
      endRssBytes: endMem.rssBytes,
      rssGrowthBytes: endMem.rssBytes - startMem.rssBytes,
    };
  };

  const firstHalf = calcSegment(firstHalfMatches, 0, halfIndex - 1);
  const secondHalf = calcSegment(secondHalfMatches, halfIndex, matches.length - 1);

  const throughputRetentionRatio =
    firstHalf.matchesPerSecond > 0
      ? secondHalf.matchesPerSecond / firstHalf.matchesPerSecond
      : 1.0;

  const heapGrowthDecelerationRatio =
    firstHalf.heapGrowthBytes !== 0
      ? secondHalf.heapGrowthBytes / firstHalf.heapGrowthBytes
      : 1.0;

  return {
    firstHalf,
    secondHalf,
    throughputRetentionRatio,
    heapGrowthDecelerationRatio,
  };
}

/**
 * 正式バッチ実行結果
 * (正式 Evidence 保存インターフェースのみを提供し、テスト用保存経路は一切露出しない)
 */
export interface OfficialBatchExecutionResult {
  readonly summary: LargeScaleBatchSummary;
  readonly performance: LargeScalePerformanceMetrics;
  readonly matches: readonly LargeScaleMatchResult[];
  readonly failures: readonly LargeScaleFailureRecord[];
  readonly initialManifest: ExecutionManifest;
  readonly postManifest: ExecutionManifest;
  readonly newlyExecutedMatches: number;
  readonly saveEvidence: (
    outputFilePath: string,
    options?: { readonly halfwayComparison?: HalfwayComparisonMetrics }
  ) => void;
}

/**
 * テスト用バッチ実行結果
 * (テスト専用保存インターフェースのみを提供し、正式 Evidence 保存インターフェースは一切露出しない)
 */
export interface TestBatchExecutionResult {
  readonly summary: LargeScaleBatchSummary;
  readonly performance: LargeScalePerformanceMetrics;
  readonly matches: readonly LargeScaleMatchResult[];
  readonly failures: readonly LargeScaleFailureRecord[];
  readonly initialManifest: ExecutionManifest;
  readonly postManifest: ExecutionManifest;
  readonly newlyExecutedMatches: number;
  readonly saveEvidenceForTesting: (
    outputFilePath: string,
    options?: {
      readonly preSaveGitMetadata?: GitExecutionMetadata;
      readonly halfwayComparison?: HalfwayComparisonMetrics;
    }
  ) => void;
}

/**
 * 内部実行結果型 (runBatchInternal の返却用)
 */
export interface RunBatchExecutionResult {
  readonly summary: LargeScaleBatchSummary;
  readonly performance: LargeScalePerformanceMetrics;
  readonly matches: readonly LargeScaleMatchResult[];
  readonly failures: readonly LargeScaleFailureRecord[];
  readonly initialManifest: ExecutionManifest;
  readonly postManifest: ExecutionManifest;
  readonly newlyExecutedMatches: number;
  readonly saveEvidence?: (
    outputFilePath: string,
    options?: { readonly halfwayComparison?: HalfwayComparisonMetrics }
  ) => void;
  readonly saveEvidenceForTesting?: (
    outputFilePath: string,
    options?: {
      readonly preSaveGitMetadata?: GitExecutionMetadata;
      readonly halfwayComparison?: HalfwayComparisonMetrics;
    }
  ) => void;
}

/**
 * 大規模バッチ実行ランナー
 *
 * 【設計原則】:
 * 1. Execution Manifest を実験開始時と終了時に Git CLI で実検証し、未検証 VERIFIED の捏造を完全排除。
 * 2. 試合ごとの Git コマンド実行を完全排除し、高スループットを維持。
 * 3. 通常試合では生 Decision Trace 配列を破棄し、traceDigest のみ保持してメモリを保護。
 * 4. FAILED / INCOMPLETE 試合では onStep リングバッファから直前トレースを詳細退避。
 * 5. 厳格な実験条件照合・原子的置換に対応したチェックポイント機能を提供。
 */
export class LargeScaleBatchRunner {
  public static readonly VERSION = LARGE_SCALE_BATCH_VERSION;

  /**
   * 正式実行用メソッド (Git CLI による HEAD & status 検証を必須とする fail-closed 契約)
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
  }): Promise<OfficialBatchExecutionResult> {
    if (!params.config.playerPolicies || params.config.playerPolicies.length === 0) {
      throw new LargeScaleBatchConfigurationError(
        "正式バッチ実験では playerPolicies の設定が必須です (実験条件欠落拒否)"
      );
    }
    const result = await this.runBatchInternal(params, undefined);
    return {
      summary: result.summary,
      performance: result.performance,
      matches: result.matches,
      failures: result.failures,
      initialManifest: result.initialManifest,
      postManifest: result.postManifest,
      newlyExecutedMatches: result.newlyExecutedMatches,
      saveEvidence: result.saveEvidence!,
    };
  }

  /**
   * テスト専用実行メソッド (単体テスト・異常系シミュレーションでのみ Git メタデータ注入を許可)
   * ※ 本番・正式実験での使用は禁止
   */
  public static async runBatchForTesting(params: {
    readonly config: LargeScaleBatchConfig;
    readonly sessionFactory: (ctx: LargeScaleMatchContext) => GameSession;
    readonly policyFactory: (ctx: LargeScaleMatchContext) => {
      policies: Record<string, DecisionPolicy>;
      seats: Record<string, LargeScaleSeatInfo>;
    };
    readonly rulePackageDigest: string;
    readonly resumeCheckpointPath?: string;
    readonly testGitMetadata?: GitExecutionMetadata;
  }): Promise<TestBatchExecutionResult> {
    const result = await this.runBatchInternal(params, params.testGitMetadata);
    return {
      summary: result.summary,
      performance: result.performance,
      matches: result.matches,
      failures: result.failures,
      initialManifest: result.initialManifest,
      postManifest: result.postManifest,
      newlyExecutedMatches: result.newlyExecutedMatches,
      saveEvidenceForTesting: result.saveEvidenceForTesting!,
    };
  }

  private static async runBatchInternal(
    params: {
      readonly config: LargeScaleBatchConfig;
      readonly sessionFactory: (ctx: LargeScaleMatchContext) => GameSession;
      readonly policyFactory: (ctx: LargeScaleMatchContext) => {
        policies: Record<string, DecisionPolicy>;
        seats: Record<string, LargeScaleSeatInfo>;
      };
      readonly rulePackageDigest: string;
      readonly resumeCheckpointPath?: string;
    },
    injectedGitMetadata?: GitExecutionMetadata
  ): Promise<RunBatchExecutionResult> {
    const { config, sessionFactory, policyFactory, rulePackageDigest, resumeCheckpointPath } = params;

    // 0. 設定検証
    if (!config || config.matchCount < 1) {
      throw new LargeScaleBatchConfigurationError("matchCount must be >= 1");
    }

    const rootDir = resolveRootDir(config.rootDir);

    // 1. 実験開始時 Manifest 取得 & fail-closed ガード
    const experimentConfig: ExperimentConfigManifest = {
      regulationId: config.regulationId,
      rulePackageId: config.rulePackageId ?? "official-rules",
      rulePackageVersion: config.rulePackageVersion ?? "1.0.0",
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
      overrideGitMetadata: injectedGitMetadata,
    });

    // 未コミット変更や Git 検証失敗があれば即座に拒否 (fail-closed)
    assertNotDirty(initialManifest);

    // 期待される Commit SHA との照合ガード (指定がある場合)
    const expectedSha =
      config.expectedGitCommitSha ||
      process.env.EXPECTED_GIT_COMMIT_SHA ||
      process.env.GIT_COMMIT_SHA;
    if (expectedSha) {
      if (initialManifest.gitMetadata.headCommitSha !== expectedSha) {
        throw new ExecutionManifestIntegrityMismatchError(
          `Git HEAD Commit SHA が期待値と一致しません (Expected: ${expectedSha}, Actual: ${initialManifest.gitMetadata.headCommitSha})`
        );
      }
    }

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

    // 3. チェックポイントの復元と厳格な整合性検証
    const matches: LargeScaleMatchResult[] = [];
    const failures: LargeScaleFailureRecord[] = [];
    const newlyExecutedDurationsMs: number[] = [];
    let startIndex = 0;
    const maxDecisions = config.maxDecisionsPerMatch ?? 500;
    const playerPoliciesDigest = sha256(canonicalJsonStringify(config.playerPolicies ?? []));

    if (resumeCheckpointPath) {
      if (!fs.existsSync(resumeCheckpointPath)) {
        throw new LargeScaleBatchConfigurationError(
          `指定されたチェックポイントファイルが存在しません: ${resumeCheckpointPath}`
        );
      }
      const rawCheckpoint = fs.readFileSync(resumeCheckpointPath, "utf-8");
      let chk: BatchCheckpointState;
      try {
        chk = JSON.parse(rawCheckpoint);
      } catch (err: any) {
        throw new LargeScaleBatchConfigurationError(
          `チェックポイントファイルが破損しています (JSON parse error): ${err.message}`
        );
      }

      // チェックサム検証
      const expectedChecksum = computeCheckpointChecksum(chk);
      if (chk.checksum !== expectedChecksum) {
        throw new ExecutionManifestIntegrityMismatchError(
          `チェックポイントのチェックサムが一致しません (ファイル破損または改ざん検出)`
        );
      }

      // 実験条件の厳格照合
      if (chk.checkpointVersion !== LARGE_SCALE_BATCH_VERSION) {
        throw new LargeScaleBatchConfigurationError(
          `チェックポイントのバージョン ('${chk.checkpointVersion}') が現在のランナーバージョン ('${LARGE_SCALE_BATCH_VERSION}') と一致しません`
        );
      }
      if (chk.batchId !== config.batchId) {
        throw new LargeScaleBatchConfigurationError(
          `チェックポイントの batchId ('${chk.batchId}') が現在の設定 ('${config.batchId}') と一致しません`
        );
      }
      if (chk.baseSeed !== config.baseSeed) {
        throw new LargeScaleBatchConfigurationError(
          `チェックポイントの baseSeed (${chk.baseSeed}) が現在の設定 (${config.baseSeed}) と一致しません`
        );
      }
      if (chk.experimentFingerprint !== initialManifest.experimentFingerprint) {
        throw new ExecutionManifestIntegrityMismatchError(
          `チェックポイントの experimentFingerprint が現在の Manifest と一致しません (コード・設定・DNA が異なります)`
        );
      }
      if (chk.regulationId !== config.regulationId) {
        throw new LargeScaleBatchConfigurationError(
          `チェックポイントの regulationId ('${chk.regulationId}') が現在の設定 ('${config.regulationId}') と一致しません`
        );
      }
      if (chk.rulePackageDigest !== rulePackageDigest) {
        throw new LargeScaleBatchConfigurationError(
          `チェックポイントの rulePackageDigest が現在の設定と一致しません`
        );
      }
      if (chk.totalTargetMatches !== config.matchCount) {
        throw new LargeScaleBatchConfigurationError(
          `チェックポイントの totalTargetMatches (${chk.totalTargetMatches}) が現在の matchCount (${config.matchCount}) と一致しません`
        );
      }
      if (chk.maxDecisionsPerMatch !== maxDecisions) {
        throw new LargeScaleBatchConfigurationError(
          `チェックポイントの maxDecisionsPerMatch (${chk.maxDecisionsPerMatch}) が現在の設定 (${maxDecisions}) と一致しません`
        );
      }

      // 保存済み試合 Index の連続性・重複・欠落の検証
      if (chk.completedMatches.length !== chk.lastCompletedIndex + 1) {
        throw new LargeScaleBatchConfigurationError(
          `チェックポイント内の試合数 (${chk.completedMatches.length}) と lastCompletedIndex (${chk.lastCompletedIndex}) に不整合があります`
        );
      }
      for (let idx = 0; idx < chk.completedMatches.length; idx++) {
        const m = chk.completedMatches[idx];
        if (m.matchIndex !== idx) {
          throw new LargeScaleBatchConfigurationError(
            `チェックポイント内の試合インデックスに重複または欠落があります (期待: ${idx}, 実際: ${m.matchIndex})`
          );
        }
      }

      matches.push(...chk.completedMatches);
      failures.push(...chk.failures);
      startIndex = chk.lastCompletedIndex + 1;
    }

    const checkpointDir =
      config.checkpointDir ||
      path.resolve(rootDir, "tools/simulator/.artifacts/checkpoints");
    const checkpointInterval = config.checkpointInterval ?? 100;
    const memorySamplingInterval = config.memorySamplingInterval ?? 25;

    // 4. 試合実行ループ (Git コマンドは試合ごとに実行しない)
    const traceRingBuffer = new RecentDecisionTraceRingBuffer(10);

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
      let executedDecisions = 0;

      traceRingBuffer.clear();

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

        // Policy 設定と実行条件の整合性照合
        validatePolicyConsistency({
          expectedPolicies: config.playerPolicies,
          expectedModels: config.models,
          actualSeats: policyBundle.seats,
          actualPolicies: policyBundle.policies,
          matchCtx,
        });

        // Simulation 実行 (onStep でリングバッファに直近10件を退避)
        try {
          simRes = SimulationRunner.run(session, policyBundle.policies, {
            maxDecisions,
            enableSemanticDiagnostics: false,
            onStep: (stepInfo) => {
              executedDecisions = stepInfo.stepCount;
              traceRingBuffer.push(stepInfo.record);
            },
          });
        } catch (err: any) {
          throw { phase: "SIMULATION", error: err, step: executedDecisions };
        }
      } catch (wrapper: any) {
        const err = wrapper?.error ?? wrapper;
        if (err instanceof LargeScaleBatchConfigurationError) {
          throw err;
        }

        const phase = wrapper?.phase ?? "UNKNOWN";
        const errorName = err?.name || "Error";
        const errorMessage = err?.message || String(err);
        const errorStack = err?.stack;
        const occurredAtStep = wrapper?.step ?? executedDecisions;

        // FAILED 試合では直前トレースを退避
        failureRecord = {
          matchIndex: i,
          matchId,
          phase,
          errorName,
          errorMessage,
          errorStack,
          occurredAtStep,
          decisionTraceSnapshot: traceRingBuffer.toArray(),
        };
        failures.push(failureRecord);
      }

      const matchDurationMs = globalThis.performance.now() - matchStartTime;
      newlyExecutedDurationsMs.push(matchDurationMs);

      // 結果サマリー構築
      if (failureRecord) {
        matches.push({
          matchIndex: i,
          matchId,
          status: "FAILED",
          completed: false,
          totalDecisions: failureRecord.occurredAtStep ?? 0,
          turnCount: session?.state?.turnCount ?? 0,
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
            decisionTraceSnapshot: traceRingBuffer.toArray(),
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

        // 【メモリ保護】: 通常完了試合ではリングバッファと生 trace を破棄して GC 対象にする
        traceRingBuffer.clear();
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
        const newlyDone = i + 1 - startIndex;
        const speed = newlyDone > 0 ? newlyDone / (currentElapsed / 1000) : 0;
        const mem = process.memoryUsage();
        config.onProgress({
          completedMatches: i + 1,
          totalMatches: config.matchCount,
          currentSpeedMps: speed,
          heapUsedMb: mem.heapUsed / (1024 * 1024),
        });
      }

      // チェックポイント保存 (原子的置換: tmp -> rename)
      if ((i + 1) % checkpointInterval === 0 && (i + 1) < config.matchCount) {
        if (!fs.existsSync(checkpointDir)) {
          fs.mkdirSync(checkpointDir, { recursive: true });
        }
        const chkFile = path.join(
          checkpointDir,
          `${config.batchId}-chk-${String(i + 1).padStart(6, "0")}.json`
        );
        const stateWithoutChecksum: Omit<BatchCheckpointState, "checksum"> = {
          checkpointVersion: LARGE_SCALE_BATCH_VERSION,
          batchId: config.batchId,
          baseSeed: config.baseSeed,
          experimentFingerprint: initialManifest.experimentFingerprint,
          regulationId: config.regulationId,
          rulePackageDigest,
          playerPoliciesDigest,
          totalTargetMatches: config.matchCount,
          maxDecisionsPerMatch: maxDecisions,
          lastCompletedIndex: i,
          timestamp: new Date().toISOString(),
          completedMatches: matches,
          failures,
        };
        const chkData: BatchCheckpointState = {
          ...stateWithoutChecksum,
          checksum: computeCheckpointChecksum(stateWithoutChecksum),
        };

        const tmpFile = `${chkFile}.tmp.${Date.now()}`;
        fs.writeFileSync(tmpFile, JSON.stringify(chkData, null, 2), "utf-8");
        fs.renameSync(tmpFile, chkFile);
      }
    }

    // 5. 終了時メトリクス集計
    const wallClockElapsedMs = globalThis.performance.now() - startWallClock;
    const endCpu = process.cpuUsage(startCpu);
    const finalMem = process.memoryUsage();
    if (finalMem.rss > peakRss) peakRss = finalMem.rss;
    if (finalMem.heapUsed > peakHeapUsed) peakHeapUsed = finalMem.heapUsed;

    // CPU メトリクス
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

    // メモリテレメトリ (通常の性能計測値に影響を与えないよう、finalMem 確定後に独立して GC 診断を収集)
    let gcDiagnostics: GcDiagnostics | undefined = undefined;
    if (typeof (globalThis as any).gc === "function") {
      try {
        (globalThis as any).gc();
        const postGcMem = process.memoryUsage();
        gcDiagnostics = {
          gcAvailable: true,
          postGcHeapUsedBytes: postGcMem.heapUsed,
          postGcRssBytes: postGcMem.rss,
          reclaimedHeapBytes: Math.max(0, finalMem.heapUsed - postGcMem.heapUsed),
        };
      } catch {
        gcDiagnostics = { gcAvailable: false };
      }
    }

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
      gcDiagnostics,
    };

    // レイテンシ分布算出 (今回実際に実行された試合の計測時間に基づく)
    const sortedDurations = [...newlyExecutedDurationsMs].sort((a, b) => a - b);
    const newlyExecutedCount = sortedDurations.length;
    const sumDuration = sortedDurations.reduce((a, b) => a + b, 0);
    const meanDuration = newlyExecutedCount > 0 ? sumDuration / newlyExecutedCount : 0;
    const medianDuration =
      newlyExecutedCount > 0
        ? newlyExecutedCount % 2 === 1
          ? sortedDurations[Math.floor(newlyExecutedCount / 2)]
          : (sortedDurations[newlyExecutedCount / 2 - 1] + sortedDurations[newlyExecutedCount / 2]) / 2
        : 0;

    const p90Duration =
      newlyExecutedCount > 0
        ? sortedDurations[Math.max(0, Math.ceil(0.9 * newlyExecutedCount) - 1)]
        : 0;
    const p95Duration =
      newlyExecutedCount > 0
        ? sortedDurations[Math.max(0, Math.ceil(0.95 * newlyExecutedCount) - 1)]
        : 0;
    const p99Duration =
      newlyExecutedCount > 0
        ? sortedDurations[Math.max(0, Math.ceil(0.99 * newlyExecutedCount) - 1)]
        : 0;

    const latencies: LatencyPercentiles = {
      meanMs: meanDuration,
      medianMs: medianDuration,
      p90Ms: p90Duration,
      p95Ms: p95Duration,
      p99Ms: p99Duration,
      minMs: newlyExecutedCount > 0 ? sortedDurations[0] : 0,
      maxMs: newlyExecutedCount > 0 ? sortedDurations[newlyExecutedCount - 1] : 0,
    };

    // スループット (今回実際に実行された試合数 / ウォールクロック時間)
    const matchesPerSecond =
      newlyExecutedCount > 0 ? newlyExecutedCount / (wallClockElapsedMs / 1000) : 0;
    const estimated10kDurationSec =
      matchesPerSecond > 0 ? 10000 / matchesPerSecond : 0;
    const estimated10kDurationHours = estimated10kDurationSec / 3600;

    const newlyExecutedMatchesList = matches.slice(startIndex);
    const totalDecisionsCount = newlyExecutedMatchesList.reduce(
      (acc, m) => acc + m.totalDecisions,
      0
    );
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
      overrideGitMetadata: injectedGitMetadata,
    });

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

    // 7. 正式 Evidence 保存クロージャ (保存直前のリアルタイム検証)
    let saveEvidence:
      | ((
          outputFilePath: string,
          options?: { readonly halfwayComparison?: HalfwayComparisonMetrics }
        ) => void)
      | undefined = undefined;
    let saveEvidenceForTesting:
      | ((
          outputFilePath: string,
          options?: {
            readonly preSaveGitMetadata?: GitExecutionMetadata;
            readonly halfwayComparison?: HalfwayComparisonMetrics;
          }
        ) => void)
      | undefined = undefined;

    if (!injectedGitMetadata) {
      saveEvidence = (
        outputFilePath: string,
        options?: { readonly halfwayComparison?: HalfwayComparisonMetrics }
      ): void => {
        // 保存直前のリアルタイム Git 状態・主要サブシステム再検証
        const preSaveManifest = createExecutionManifest({
          workId: config.workId,
          rootDir,
          experimentConfig: postManifest.experimentConfig,
        });

        assertNotDirty(preSaveManifest);

        if (preSaveManifest.gitMetadata.headCommitSha !== postManifest.gitMetadata.headCommitSha) {
          throw new ExecutionManifestIntegrityMismatchError(
            `保存直前に HEAD Commit SHA の変更が検出されました (Post: ${postManifest.gitMetadata.headCommitSha}, PreSave: ${preSaveManifest.gitMetadata.headCommitSha})`
          );
        }
        if (
          JSON.stringify(preSaveManifest.subsystemDigests) !==
          JSON.stringify(postManifest.subsystemDigests)
        ) {
          throw new ExecutionManifestIntegrityMismatchError(
            `保存直前に主要サブシステムコードの変更が検出されました (fail-closed)`
          );
        }

        const evidencePayload: LargeScaleBatchEvidence = {
          schemaVersion: LARGE_SCALE_BATCH_VERSION,
          workId: config.workId,
          generatedAt: new Date().toISOString(),
          executionManifest: preSaveManifest,
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
          halfwayComparison: options?.halfwayComparison,
        };

        saveOfficialEvidenceWithManifest({
          filePath: outputFilePath,
          evidenceData: evidencePayload,
          manifest: preSaveManifest,
        });
      };
    } else {
      // テスト専用保存クロージャ (単体テストでのみ使用)
      saveEvidenceForTesting = (
        outputFilePath: string,
        options?: {
          readonly preSaveGitMetadata?: GitExecutionMetadata;
          readonly halfwayComparison?: HalfwayComparisonMetrics;
        }
      ): void => {
        const manifestToValidate: ExecutionManifest = options?.preSaveGitMetadata
          ? {
              ...postManifest,
              gitMetadata: options.preSaveGitMetadata,
            }
          : postManifest;

        assertNotDirty(manifestToValidate);

        if (
          options?.preSaveGitMetadata &&
          options.preSaveGitMetadata.headCommitSha !== postManifest.gitMetadata.headCommitSha
        ) {
          throw new ExecutionManifestIntegrityMismatchError(
            `保存直前に HEAD Commit SHA の変更が検出されました (Post: ${postManifest.gitMetadata.headCommitSha}, PreSave: ${options.preSaveGitMetadata.headCommitSha})`
          );
        }

        const evidencePayload: LargeScaleBatchEvidence = {
          schemaVersion: LARGE_SCALE_BATCH_VERSION,
          workId: config.workId,
          generatedAt: new Date().toISOString(),
          executionManifest: manifestToValidate,
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
          halfwayComparison: options?.halfwayComparison,
        };

        saveTestEvidenceWithManifest({
          filePath: outputFilePath,
          evidenceData: evidencePayload,
          manifest: manifestToValidate,
        });
      };
    }

    return {
      summary,
      performance,
      matches,
      failures,
      initialManifest,
      postManifest,
      newlyExecutedMatches: newlyExecutedCount,
      saveEvidence,
      saveEvidenceForTesting,
    };
  }
}
