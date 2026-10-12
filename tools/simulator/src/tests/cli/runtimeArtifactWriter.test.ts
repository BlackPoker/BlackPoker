import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { RuntimeArtifactWriter } from "../../cli/support/RuntimeArtifactWriter";
import {
  BATCH_RUNTIME_TELEMETRY_VERSION,
  BatchSimulationResult,
} from "../../domain/simulation/BatchSimulationTypes";

describe("RuntimeArtifactWriter Tests (BP-SIM-AI-RUNTIME-TELEMETRY-V1)", () => {
  let tempBaseDir: string;

  beforeEach(() => {
    tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), "bp-telemetry-test-"));
  });

  afterEach(() => {
    if (fs.existsSync(tempBaseDir)) {
      fs.rmSync(tempBaseDir, { recursive: true, force: true });
    }
  });

  const createDummySimulationResult = (hasFailures: boolean = false): BatchSimulationResult => ({
    batchResultVersion: 1,
    baseSeed: 42,
    matchCount: 2,
    matches: [
      {
        matchIndex: 0,
        matchId: "batch-42-match-000000",
        status: "COMPLETED",
        completed: true,
        winner: "p1",
        reason: "Won by life",
        totalDecisions: 25,
        turnCount: 3,
        finalStateHash: "hash-001",
        matchSeed: 123,
        playerSeeds: { p1: 1, p2: 2 },
      },
      {
        matchIndex: 1,
        matchId: "batch-42-match-000001",
        status: hasFailures ? "FAILED" : "COMPLETED",
        completed: !hasFailures,
        winner: hasFailures ? undefined : "p2",
        reason: hasFailures ? undefined : "Won by life",
        totalDecisions: hasFailures ? 0 : 30,
        turnCount: hasFailures ? 0 : 4,
        finalStateHash: hasFailures ? undefined : "hash-002",
        matchSeed: 456,
        playerSeeds: { p1: 3, p2: 4 },
        failure: hasFailures
          ? {
              matchIndex: 1,
              matchId: "batch-42-match-000001",
              baseSeed: 42,
              matchSeed: 456,
              playerSeeds: { p1: 3, p2: 4 },
              errorName: "Error",
              errorMessage: "Simulated test error",
              phase: "RUNNER",
            }
          : undefined,
      },
    ],
    summary: {
      totalMatches: 2,
      completedCount: hasFailures ? 1 : 2,
      incompleteCount: 0,
      failedCount: hasFailures ? 1 : 0,
      winsByPlayer: hasFailures ? { p1: 1 } : { p1: 1, p2: 1 },
      drawCount: 0,
      winRates: hasFailures ? { p1: 1.0 } : { p1: 0.5, p2: 0.5 },
      averageDecisionsPerCompletedMatch: hasFailures ? 25 : 27.5,
      averageTurnsPerCompletedMatch: hasFailures ? 3 : 3.5,
    },
    failures: hasFailures
      ? [
          {
            matchIndex: 1,
            matchId: "batch-42-match-000001",
            baseSeed: 42,
            matchSeed: 456,
            playerSeeds: { p1: 3, p2: 4 },
            errorName: "Error",
            errorMessage: "Simulated test error",
            phase: "RUNNER",
          },
        ]
      : [],
    runtimeMetrics: {
      runtimeTelemetryVersion: BATCH_RUNTIME_TELEMETRY_VERSION,
      executedMatchCount: 2,
      concurrency: 1,
      batchWallClockElapsedMs: 120.5,
      sumMatchTotalElapsedMs: 110.2,
      meanMatchTotalElapsedMs: 55.1,
      medianMatchTotalElapsedMs: 55.1,
      p95MatchTotalElapsedMs: 60.0,
      minMatchTotalElapsedMs: 50.2,
      maxMatchTotalElapsedMs: 60.0,
      matchesPerSecond: 16.6,
      totalDecisionCount: hasFailures ? 25 : 55,
      meanMsPerDecision: 2.0,
      matchMetrics: [
        {
          matchIndex: 0,
          matchId: "batch-42-match-000000",
          status: "COMPLETED",
          matchTotalElapsedMs: 50.2,
          setupElapsedMs: 1.2,
          simulationElapsedMs: 49.0,
          totalDecisions: 25,
          durationMs: 50.2,
        },
        {
          matchIndex: 1,
          matchId: "batch-42-match-000001",
          status: hasFailures ? "FAILED" : "COMPLETED",
          matchTotalElapsedMs: 60.0,
          setupElapsedMs: hasFailures ? 1.5 : 1.0,
          simulationElapsedMs: hasFailures ? 0 : 59.0,
          totalDecisions: hasFailures ? 0 : 30,
          durationMs: 60.0,
        },
      ],
      totalExecutionTimeMs: 120.5,
    },
  });

  it("1. 正常系バッチ結果が指定ルート配下に4ファイルで正しく保存されること", () => {
    const simResult = createDummySimulationResult(false);
    const writeResult = RuntimeArtifactWriter.write(simResult, {
      artifactRootDir: tempBaseDir,
      runId: "test-run-001",
      startedAt: "2026-10-13T09:00:00.000Z",
      finishedAt: "2026-10-13T09:00:01.000Z",
    });

    expect(writeResult.runId).toBe("test-run-001");
    expect(fs.existsSync(writeResult.runDir)).toBe(true);
    expect(fs.existsSync(writeResult.summaryPath)).toBe(true);
    expect(fs.existsSync(writeResult.matchesPath)).toBe(true);
    expect(fs.existsSync(writeResult.timingPath)).toBe(true);
    expect(fs.existsSync(writeResult.errorsPath)).toBe(true);

    // run-summary.json の検証
    const summaryRaw = fs.readFileSync(writeResult.summaryPath, "utf8");
    const summary = JSON.parse(summaryRaw);
    expect(summary.runId).toBe("test-run-001");
    expect(summary.runtimeTelemetryVersion).toBe(BATCH_RUNTIME_TELEMETRY_VERSION);
    expect(summary.matchCount).toBe(2);
    expect(summary.executedMatchCount).toBe(2);
    expect(summary.completedCount).toBe(2);
    expect(summary.failedCount).toBe(0);
    expect(summary.meanMatchTotalElapsedMs).toBe(55.1);
    expect(summary.nodeVersion).toBeDefined();
    expect(summary.platform).toBeDefined();

    // matches.jsonl の検証 (2行)
    const matchesLines = fs.readFileSync(writeResult.matchesPath, "utf8").trim().split("\n");
    expect(matchesLines.length).toBe(2);
    expect(JSON.parse(matchesLines[0]).matchId).toBe("batch-42-match-000000");

    // timing.jsonl の検証 (2行)
    const timingLines = fs.readFileSync(writeResult.timingPath, "utf8").trim().split("\n");
    expect(timingLines.length).toBe(2);
    expect(JSON.parse(timingLines[0]).matchTotalElapsedMs).toBe(50.2);

    // errors.jsonl の検証 (エラー0件時は空ファイル 0 bytes)
    const errorsContent = fs.readFileSync(writeResult.errorsPath, "utf8");
    expect(errorsContent).toBe("");
  });

  it("2. エラー発生時に errors.jsonl に詳細が出力されること", () => {
    const simResult = createDummySimulationResult(true);
    const writeResult = RuntimeArtifactWriter.write(simResult, {
      artifactRootDir: tempBaseDir,
      runId: "test-run-err",
    });

    const errorLines = fs.readFileSync(writeResult.errorsPath, "utf8").trim().split("\n");
    expect(errorLines.length).toBe(1);
    const err = JSON.parse(errorLines[0]);
    expect(err.errorName).toBe("Error");
    expect(err.errorMessage).toBe("Simulated test error");
  });

  it("3. 同名の Run ID が既に存在する場合、サフィックスで衝突回避されること", () => {
    const simResult = createDummySimulationResult(false);
    const res1 = RuntimeArtifactWriter.write(simResult, {
      artifactRootDir: tempBaseDir,
      runId: "same-id",
    });
    expect(res1.runId).toBe("same-id");

    const res2 = RuntimeArtifactWriter.write(simResult, {
      artifactRootDir: tempBaseDir,
      runId: "same-id",
    });
    expect(res2.runId).toBe("same-id-1");
    expect(fs.existsSync(res2.runDir)).toBe(true);
  });
});
