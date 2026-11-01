import { describe, it, expect } from "vitest";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import { LargeScaleBatchEvidence } from "../../domain/simulation/LargeScaleBatchTypes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../../../../../");

describe("LargeScaleBatchBenchmark Stage 1 Evidence Gate", () => {
  const evidencePath = path.resolve(
    rootDir,
    "tools/simulator/reports/ai/large-scale-batch-benchmark-stage1.json"
  );
  const markdownPath = path.resolve(
    rootDir,
    "tools/simulator/docs/ai-large-scale-batch-benchmark-stage1.md"
  );

  it("Test 1: Evidence JSON および Markdown レポートが存在すること", () => {
    expect(fs.existsSync(evidencePath)).toBe(true);
    expect(fs.existsSync(markdownPath)).toBe(true);
  });

  it("Test 2: Evidence JSON の構造・メタデータが正しいこと", () => {
    const raw = fs.readFileSync(evidencePath, "utf-8");
    const evidence: LargeScaleBatchEvidence = JSON.parse(raw);

    expect(evidence.schemaVersion).toBe("1.0.0");
    expect(evidence.workId).toBe("BP-SIM-AI-V92-WORK2-BATCH-FOUNDATION-STAGE1");
    expect(evidence.configuration.regulationId).toBe("standard-pack");
    expect(evidence.configuration.matchCount).toBe(500);

    // Execution Manifest の fail-closed 検証
    expect(evidence.executionManifest).toBeDefined();
    expect(evidence.executionManifest.gitMetadata.verificationStatus).toBe("VERIFIED");
    expect(evidence.executionManifest.gitMetadata.isDirty).toBe(false);
    expect(evidence.executionManifest.manifestHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("Test 3: 500 試合が 100% 決着完走し、エラー・失敗が 0 件であること", () => {
    const raw = fs.readFileSync(evidencePath, "utf-8");
    const evidence: LargeScaleBatchEvidence = JSON.parse(raw);

    expect(evidence.summary.totalMatches).toBe(500);
    expect(evidence.summary.completedCount).toBe(500);
    expect(evidence.summary.incompleteCount).toBe(0);
    expect(evidence.summary.failedCount).toBe(0);
    expect(evidence.isolatedFailures.length).toBe(0);
    expect(evidence.matches.length).toBe(500);
  });

  it("Test 4: パフォーマンス目標を達成していること (スループット >= 4 試合/秒, 1万試合推定 <= 1時間)", () => {
    const raw = fs.readFileSync(evidencePath, "utf-8");
    const evidence: LargeScaleBatchEvidence = JSON.parse(raw);

    const perf = evidence.performance;
    expect(perf.matchesPerSecond).toBeGreaterThanOrEqual(4.0);
    expect(perf.latencies.medianMs).toBeLessThan(300); // 中央値 300ms 未満
    expect(perf.latencies.p95Ms).toBeLessThan(500); // P95 500ms 未満
    expect(perf.estimated10kMatchesDurationHours).toBeLessThan(1.0); // 1時間以内
  });

  it("Test 5: メモリ保護とリークフリーが実証されていること (500試合ヒープ増加 < 5MB)", () => {
    const raw = fs.readFileSync(evidencePath, "utf-8");
    const evidence: LargeScaleBatchEvidence = JSON.parse(raw);

    const mem = evidence.performance.memory;
    expect(mem.baselineHeapUsedBytes).toBeGreaterThan(0);
    expect(mem.peakHeapUsedBytes).toBeLessThan(300 * 1024 * 1024); // ピーク 300MB 未満
    expect(mem.heapGrowthBytes).toBeLessThan(5 * 1024 * 1024); // 500試合の増加 5MB 未満
  });

  it("Test 6: 各試合の決定論的再現性メタデータ (traceDigest, finalStateHash) が全試合記録されていること", () => {
    const raw = fs.readFileSync(evidencePath, "utf-8");
    const evidence: LargeScaleBatchEvidence = JSON.parse(raw);

    for (const match of evidence.matches) {
      expect(match.traceDigest).toBeDefined();
      expect(match.traceDigest!.length).toBe(64); // SHA-256
      expect(match.finalStateHash).toBeDefined();
      expect(match.finalStateHash!.startsWith("sh2-")).toBe(true);
      expect(match.playerSeeds.p1).toBeDefined();
      expect(match.playerSeeds.p2).toBeDefined();

      // 生の DecisionTrace が保持されていないこと (メモリ保護)
      expect((match as any).decisionTrace).toBeUndefined();
    }
  });
});
