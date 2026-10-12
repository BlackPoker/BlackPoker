import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { fileURLToPath } from "url";
import {
  BATCH_RUNTIME_TELEMETRY_VERSION,
  BatchSimulationResult,
  RuntimeTelemetryValidationError,
} from "../../domain/simulation/BatchSimulationTypes";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 実行環境・ハードウェアのメタデータ情報
 */
export interface ExecutionEnvironmentMetadata {
  readonly buildSha: string | null;
  readonly buildRef: string | null;
  readonly nodeVersion: string;
  readonly platform: string;
  readonly arch: string;
  readonly cpuModel: string | null;
  readonly logicalCpuCount: number;
  readonly concurrency: number;
}

/**
 * ランタイム成果物ライターのオプション
 */
export interface RuntimeArtifactWriterOptions {
  /** 成果物ルートディレクトリ (デフォルト: tools/simulator/.artifacts/ai-runs) */
  readonly artifactRootDir?: string;
  /** 明示的な Run ID (未指定時はタイムスタンプとランダムサフィックスから自動生成) */
  readonly runId?: string;
  /** バッチ開始時刻 (ISO 文字列) */
  readonly startedAt?: string;
  /** バッチ終了時刻 (ISO 文字列) */
  readonly finishedAt?: string;
  /** 1試合あたりの最大意思決定回数 (Benchmark Recipe 必須項目) */
  readonly maxDecisionsPerMatch: number;
}

/**
 * ランタイム成果物ライターの出力結果情報
 */
export interface RuntimeArtifactWriterResult {
  readonly runId: string;
  readonly runDir: string;
  readonly summaryPath: string;
  readonly matchesPath: string;
  readonly timingPath: string;
  readonly errorsPath: string;
  readonly summary: Record<string, any>;
}

/**
 * バッチシミュレーションの実行時成果物 (Artifacts) を Git 非管理ディレクトリに安全に永続化するライター。
 *
 * 【アーキテクチャ境界】
 * Node.js の fs / path / os モジュールを利用するため、CLI サポートレイヤーに配置し、
 * コアエンジン (BatchSimulationRunner) からは直接参照しません（ブラウザ互換性の維持）。
 */
export class RuntimeArtifactWriter {
  /**
   * デフォルトの成果物ルートディレクトリを取得
   */
  public static getDefaultArtifactRootDir(): string {
    if (process.env.BP_ARTIFACT_ROOT) {
      return path.resolve(process.env.BP_ARTIFACT_ROOT);
    }
    return path.resolve(__dirname, "../../../.artifacts/ai-runs");
  }

  /**
   * 一意な Run ID を生成 (timestamp + random suffix artifact identifier)
   * 形式: YYYYMMDDTHHmmssZ-<hex6>
   */
  public static generateRunId(date: Date = new Date()): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    const yyyy = date.getUTCFullYear();
    const mm = pad(date.getUTCMonth() + 1);
    const dd = pad(date.getUTCDate());
    const hh = pad(date.getUTCHours());
    const min = pad(date.getUTCMinutes());
    const ss = pad(date.getUTCSeconds());
    const rand = Math.floor(Math.random() * 0xffffff)
      .toString(16)
      .padStart(6, "0");
    return `${yyyy}${mm}${dd}T${hh}${min}${ss}Z-${rand}`;
  }

  /**
   * 現在の実行環境メタデータを収集 (環境変数および Node 標準 API のみ使用し、外部 Git コマンドは実行しない)
   */
  public static getEnvironmentMetadata(concurrency: number = 1): ExecutionEnvironmentMetadata {
    const cpus = os.cpus();
    const buildSha =
      process.env.BP_BUILD_SHA ||
      process.env.GITHUB_SHA ||
      process.env.VITE_BUILD_SHA ||
      process.env.GIT_SHA ||
      null;
    const buildRef =
      process.env.BP_BUILD_REF ||
      process.env.GITHUB_REF_NAME ||
      process.env.VITE_BUILD_REF ||
      process.env.GIT_REF ||
      null;
    const cpuModel =
      cpus && cpus[0] && typeof cpus[0].model === "string" && cpus[0].model.length > 0
        ? cpus[0].model
        : null;
    const logicalCpuCount = cpus && typeof cpus.length === "number" && cpus.length > 0 ? cpus.length : 1;

    return {
      buildSha,
      buildRef,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      cpuModel,
      logicalCpuCount,
      concurrency,
    };
  }

  /**
   * バッチシミュレーション結果を成果物ディレクトリに出力 (Fail-Closed: runtimeMetrics 必須)
   */
  public static write(
    simulationResult: BatchSimulationResult,
    options: RuntimeArtifactWriterOptions
  ): RuntimeArtifactWriterResult {
    if (!simulationResult || typeof simulationResult !== "object") {
      throw new RuntimeTelemetryValidationError("Cannot write runtime artifacts: simulationResult must be a valid object.");
    }

    if (!simulationResult.runtimeMetrics) {
      throw new RuntimeTelemetryValidationError(
        "Cannot write runtime artifacts: simulationResult.runtimeMetrics is required (Fail-Closed contract)."
      );
    }

    if (!options || typeof options !== "object") {
      throw new RuntimeTelemetryValidationError("Cannot write runtime artifacts: options must be a valid object.");
    }

    if (
      typeof options.maxDecisionsPerMatch !== "number" ||
      !Number.isFinite(options.maxDecisionsPerMatch) ||
      !Number.isInteger(options.maxDecisionsPerMatch) ||
      options.maxDecisionsPerMatch < 1
    ) {
      throw new RuntimeTelemetryValidationError(
        `Invalid maxDecisionsPerMatch in writer options: must be a finite positive integer (>= 1). Received: ${options.maxDecisionsPerMatch}`
      );
    }

    const rootDir = options.artifactRootDir || this.getDefaultArtifactRootDir();
    let baseRunId = options.runId || this.generateRunId();
    let runId = baseRunId;
    let runDir = path.join(rootDir, runId);

    // 同名ディレクトリの偶発的衝突を防止
    let collisionCounter = 1;
    while (fs.existsSync(runDir)) {
      runId = `${baseRunId}-${collisionCounter++}`;
      runDir = path.join(rootDir, runId);
    }

    fs.mkdirSync(runDir, { recursive: true });

    const rm = simulationResult.runtimeMetrics;
    const envMeta = this.getEnvironmentMetadata(rm.concurrency);

    const startedAt = options.startedAt || new Date().toISOString();
    const finishedAt = options.finishedAt || new Date().toISOString();

    // 1. run-summary.json (Benchmark Recipe & Exact Telemetry, 偽フォールバック排除)
    const summaryData: Record<string, any> = {
      runId,
      runtimeTelemetryVersion: rm.runtimeTelemetryVersion,
      buildSha: envMeta.buildSha,
      buildRef: envMeta.buildRef,
      nodeVersion: envMeta.nodeVersion,
      platform: envMeta.platform,
      arch: envMeta.arch,
      cpuModel: envMeta.cpuModel,
      logicalCpuCount: envMeta.logicalCpuCount,
      concurrency: rm.concurrency,
      startedAt,
      finishedAt,
      baseSeed: simulationResult.baseSeed,
      matchCount: simulationResult.matchCount,
      requestedMatchCount: simulationResult.matchCount,
      executedMatchCount: rm.executedMatchCount,
      maxDecisionsPerMatch: options.maxDecisionsPerMatch,
      completedCount: simulationResult.summary.completedCount,
      incompleteCount: simulationResult.summary.incompleteCount,
      failedCount: simulationResult.summary.failedCount,
      drawCount: simulationResult.summary.drawCount,
      winsByPlayer: simulationResult.summary.winsByPlayer,
      winRates: simulationResult.summary.winRates,
      averageDecisionsPerCompletedMatch: simulationResult.summary.averageDecisionsPerCompletedMatch,
      averageTurnsPerCompletedMatch: simulationResult.summary.averageTurnsPerCompletedMatch,
      sumMatchTotalElapsedMs: rm.sumMatchTotalElapsedMs,
      batchWallClockElapsedMs: rm.batchWallClockElapsedMs,
      meanMatchTotalElapsedMs: rm.meanMatchTotalElapsedMs,
      medianMatchTotalElapsedMs: rm.medianMatchTotalElapsedMs,
      p95MatchTotalElapsedMs: rm.p95MatchTotalElapsedMs,
      minMatchTotalElapsedMs: rm.minMatchTotalElapsedMs,
      maxMatchTotalElapsedMs: rm.maxMatchTotalElapsedMs,
      matchesPerSecond: rm.matchesPerSecond,
      totalDecisionCount: rm.totalDecisionCount,
      meanMsPerDecision: rm.meanMsPerDecision,
    };

    const summaryPath = path.join(runDir, "run-summary.json");
    fs.writeFileSync(summaryPath, JSON.stringify(summaryData, null, 2), "utf8");

    // 2. matches.jsonl
    const matchesPath = path.join(runDir, "matches.jsonl");
    const matchesLines = simulationResult.matches.map((m) => JSON.stringify(m));
    fs.writeFileSync(matchesPath, matchesLines.length > 0 ? matchesLines.join("\n") + "\n" : "", "utf8");

    // 3. timing.jsonl
    const timingPath = path.join(runDir, "timing.jsonl");
    const timingMetrics = rm?.matchMetrics ?? [];
    const timingLines = timingMetrics.map((t) => JSON.stringify(t));
    fs.writeFileSync(timingPath, timingLines.length > 0 ? timingLines.join("\n") + "\n" : "", "utf8");

    // 4. errors.jsonl (0件の場合は空ファイル)
    const errorsPath = path.join(runDir, "errors.jsonl");
    const errorLines = simulationResult.failures.map((f) => JSON.stringify(f));
    fs.writeFileSync(errorsPath, errorLines.length > 0 ? errorLines.join("\n") + "\n" : "", "utf8");

    return {
      runId,
      runDir,
      summaryPath,
      matchesPath,
      timingPath,
      errorsPath,
      summary: summaryData,
    };
  }
}
