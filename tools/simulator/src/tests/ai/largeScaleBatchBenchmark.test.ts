import { describe, it, expect } from "vitest";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import { LargeScaleBatchEvidence } from "../../domain/simulation/LargeScaleBatchTypes.js";
import { loadRegulationCatalog } from "../../engine/regulation/RegulationLoader.js";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader.js";
import { OfficialRegulationMatchFactory } from "../../engine/regulation/OfficialRegulationMatchFactory.js";
import { FirstLegalPolicy, RandomPolicy } from "../../engine/simulation/DecisionPolicy.js";
import { SeededRandom } from "../../engine/random/RandomSource.js";
import { SimulationRunner } from "../../engine/simulation/SimulationRunner.js";
import { computeTraceDigestFromSimulation } from "../../engine/simulation/LargeScaleBatchRunner.js";

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

  it("Test 5: 500試合のヒープ増加が許容上限内に収まりメモリ保護されていること (500試合ヒープ増加 < 5MB)", () => {
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

  describe("Verified 500 Matches Benchmark Evidence Gate", () => {
    const verifiedEvidencePath = path.resolve(
      rootDir,
      "tools/simulator/reports/ai/large-scale-batch-benchmark-stage1-verified.json"
    );

    it("Test 7: 正式 Evidence JSON が存在し、Git実検証ステータスが VERIFIED であること", () => {
      expect(fs.existsSync(verifiedEvidencePath)).toBe(true);
      const evidence: LargeScaleBatchEvidence = JSON.parse(
        fs.readFileSync(verifiedEvidencePath, "utf-8")
      );

      expect(evidence.schemaVersion).toBe("1.0.0");
      expect(evidence.workId).toBe("BP-SIM-AI-V92-WORK2-BATCH-FOUNDATION-STAGE1");
      expect(evidence.configuration.regulationId).toBe("standard-pack");
      expect(evidence.configuration.matchCount).toBe(500);

      // Git 実検証の厳格確認
      const git = evidence.executionManifest.gitMetadata;
      expect(git.verificationStatus).toBe("VERIFIED");
      expect(git.isDirty).toBe(false);
      expect(git.dirtyFiles.length).toBe(0);
      expect(git.headCommitSha).toMatch(/^[0-9a-f]{40}$/);
    });

    it("Test 8: 正式 Evidence の 500 試合が決着完走 (100% completed, 0 failed, 0 incomplete) であること", () => {
      const evidence: LargeScaleBatchEvidence = JSON.parse(
        fs.readFileSync(verifiedEvidencePath, "utf-8")
      );

      expect(evidence.summary.totalMatches).toBe(500);
      expect(evidence.summary.completedCount).toBe(500);
      expect(evidence.summary.incompleteCount).toBe(0);
      expect(evidence.summary.failedCount).toBe(0);
      expect(evidence.isolatedFailures.length).toBe(0);
      expect(evidence.matches.length).toBe(500);

      // 暫定 Evidence と完全に同一の勝敗サマリーであること
      expect(evidence.summary.winsByPlayer.p2).toBe(396);
      expect(evidence.summary.winsByPlayer.p1).toBe(104);
      expect(evidence.summary.winRates.p2).toBe(0.792);
      expect(evidence.summary.winRates.p1).toBe(0.208);
    });

    it("Test 9: 正式 Evidence の性能指標が実測目標を満たしていること", () => {
      const evidence: LargeScaleBatchEvidence = JSON.parse(
        fs.readFileSync(verifiedEvidencePath, "utf-8")
      );

      const perf = evidence.performance;
      expect(perf.matchesPerSecond).toBeGreaterThanOrEqual(4.5);
      expect(perf.latencies.medianMs).toBeLessThan(300);
      expect(perf.latencies.p95Ms).toBeLessThan(500);
      expect(perf.meanMsPerDecision).toBeLessThan(2.0);
      expect(perf.memory.peakHeapUsedBytes).toBeLessThan(250 * 1024 * 1024);
      expect(perf.memory.peakRssBytes).toBeLessThan(400 * 1024 * 1024);
    });

    it("Test 10: Evidence から抽出した 3 試合 (Match 0, 250, 499) の同一条件単独再実行で全結果が完全一致すること (決定論的再現性検証)", async () => {
      const evidence: LargeScaleBatchEvidence = JSON.parse(
        fs.readFileSync(verifiedEvidencePath, "utf-8")
      );

      const catalog = await loadRegulationCatalog();
      const rulesDir = path.resolve(rootDir, "tools/simulator/src/data/rules-vnext");
      const fullRulePackage = await loadRulePackageFromDirectory(rulesDir);
      const sessionFactory = await OfficialRegulationMatchFactory.prepareSessionFactory(
        evidence.configuration.regulationId,
        { catalog, fullRulePackage }
      );

      const sampleIndices = evidence.reproducibilityRecipe.sampleIndices; // [0, 250, 499]

      for (const idx of sampleIndices) {
        const recordedMatch = evidence.matches[idx];
        const matchContext = {
          matchIndex: recordedMatch.matchIndex,
          matchId: recordedMatch.matchId,
          baseSeed: recordedMatch.baseSeed,
          matchSeed: recordedMatch.matchSeed,
          playerSeeds: recordedMatch.playerSeeds,
        };

        const session = sessionFactory(matchContext);
        const p1 = new FirstLegalPolicy(false);
        const p2 = new RandomPolicy(
          new SeededRandom(recordedMatch.playerSeeds.p2),
          "SeededRandom-P2"
        );

        const simRes = SimulationRunner.run(
          session,
          { p1, p2 },
          { maxDecisions: evidence.configuration.maxDecisionsPerMatch }
        );

        const replayedTraceDigest = computeTraceDigestFromSimulation(simRes);

        // 各試合の主要指標が Evidence の記録と完全一致することを検証
        expect(simRes.completed).toBe(recordedMatch.completed);
        expect(simRes.winner).toBe(recordedMatch.winner);
        expect(simRes.totalDecisions).toBe(recordedMatch.totalDecisions);
        expect(simRes.turnCount).toBe(recordedMatch.turnCount);
        expect(simRes.finalStateHash).toBe(recordedMatch.finalStateHash);
        expect(replayedTraceDigest).toBe(recordedMatch.traceDigest);
      }
    });
  });

  describe("Memory Stability Gate 1,000 Matches Evidence Gate", () => {
    const memoryStabilityEvidencePath = path.resolve(
      rootDir,
      "tools/simulator/reports/ai/large-scale-batch-memory-stability-1k.json"
    );

    it("Test 11: 1,000試合メモリ安定性 Evidence JSON が存在し、Git実検証ステータスが VERIFIED であること", () => {
      expect(fs.existsSync(memoryStabilityEvidencePath)).toBe(true);
      const evidence: LargeScaleBatchEvidence = JSON.parse(
        fs.readFileSync(memoryStabilityEvidencePath, "utf-8")
      );

      expect(evidence.schemaVersion).toBe("1.0.0");
      expect(evidence.workId).toBe("BP-SIM-AI-V92-WORK2-MEMORY-STABILITY-GATE");
      expect(evidence.configuration.regulationId).toBe("standard-pack");
      expect(evidence.configuration.matchCount).toBe(1000);

      // Git 実検証の厳格確認
      const git = evidence.executionManifest.gitMetadata;
      expect(git.verificationStatus).toBe("VERIFIED");
      expect(git.isDirty).toBe(false);
      expect(git.dirtyFiles.length).toBe(0);
      expect(git.headCommitSha).toMatch(/^[0-9a-f]{40}$/);
    });

    it("Test 12: 1,000試合全試合が決着完走 (100% completed, 0 failed, 0 incomplete) であること", () => {
      const evidence: LargeScaleBatchEvidence = JSON.parse(
        fs.readFileSync(memoryStabilityEvidencePath, "utf-8")
      );

      expect(evidence.summary.totalMatches).toBe(1000);
      expect(evidence.summary.completedCount).toBe(1000);
      expect(evidence.summary.incompleteCount).toBe(0);
      expect(evidence.summary.failedCount).toBe(0);
      expect(evidence.isolatedFailures.length).toBe(0);
      expect(evidence.matches.length).toBe(1000);

      // 勝敗サマリー
      expect(evidence.summary.winsByPlayer.p2).toBe(788);
      expect(evidence.summary.winsByPlayer.p1).toBe(212);
      expect(evidence.summary.winRates.p2).toBe(0.788);
      expect(evidence.summary.winRates.p1).toBe(0.212);
    });

    it("Test 13: 1,000試合の前半500試合と正式500試合Evidenceが完全一致すること (決定論的整合性)", () => {
      const verified500Path = path.resolve(
        rootDir,
        "tools/simulator/reports/ai/large-scale-batch-benchmark-stage1-verified.json"
      );
      const d1k: LargeScaleBatchEvidence = JSON.parse(
        fs.readFileSync(memoryStabilityEvidencePath, "utf-8")
      );
      const d500: LargeScaleBatchEvidence = JSON.parse(
        fs.readFileSync(verified500Path, "utf-8")
      );

      for (let i = 0; i < 500; i++) {
        const m1k = d1k.matches[i];
        const m500 = d500.matches[i];
        expect(m1k.winner).toBe(m500.winner);
        expect(m1k.totalDecisions).toBe(m500.totalDecisions);
        expect(m1k.turnCount).toBe(m500.turnCount);
        expect(m1k.finalStateHash).toBe(m500.finalStateHash);
        expect(m1k.traceDigest).toBe(m500.traceDigest);
      }
    });

    it("Test 14: 前半500試合と後半500試合の比較メトリクスおよびGC診断が正常であること (長時間メモリ安定性)", () => {
      const evidence: LargeScaleBatchEvidence = JSON.parse(
        fs.readFileSync(memoryStabilityEvidencePath, "utf-8")
      );

      expect(evidence.halfwayComparison).toBeDefined();
      const hw = evidence.halfwayComparison!;
      expect(hw.firstHalf.matchCount).toBe(500);
      expect(hw.secondHalf.matchCount).toBe(500);

      // スループット維持率が 90% 以上であること
      expect(hw.throughputRetentionRatio).toBeGreaterThanOrEqual(0.90);

      // GC 診断の確認
      const gcDiag = evidence.performance.memory.gcDiagnostics;
      expect(gcDiag).toBeDefined();
      expect(gcDiag!.gcAvailable).toBe(true);
      // 強制 GC 後の実残存ヒープが 100MB 未満であること
      expect(gcDiag!.postGcHeapUsedBytes).toBeLessThan(100 * 1024 * 1024);
      // 強制 GC で 100MB 以上のヒープが回収され、長時間のV8ヒープ回収により一定水準までメモリが縮小されることが確認されていること
      expect(gcDiag!.reclaimedHeapBytes).toBeGreaterThan(100 * 1024 * 1024);
    });

    it("Test 15: Evidence から抽出した 3 試合 (Match 0, 500, 999) の同一条件単独再実行で全結果が完全一致すること (1,000試合決定論的再現性検証)", async () => {
      const evidence: LargeScaleBatchEvidence = JSON.parse(
        fs.readFileSync(memoryStabilityEvidencePath, "utf-8")
      );

      const catalog = await loadRegulationCatalog();
      const rulesDir = path.resolve(rootDir, "tools/simulator/src/data/rules-vnext");
      const fullRulePackage = await loadRulePackageFromDirectory(rulesDir);
      const sessionFactory = await OfficialRegulationMatchFactory.prepareSessionFactory(
        evidence.configuration.regulationId,
        { catalog, fullRulePackage }
      );

      const sampleIndices = evidence.reproducibilityRecipe.sampleIndices; // [0, 500, 999]

      for (const idx of sampleIndices) {
        const recordedMatch = evidence.matches[idx];
        const matchContext = {
          matchIndex: recordedMatch.matchIndex,
          matchId: recordedMatch.matchId,
          baseSeed: recordedMatch.baseSeed,
          matchSeed: recordedMatch.matchSeed,
          playerSeeds: recordedMatch.playerSeeds,
        };

        const session = sessionFactory(matchContext);
        const p1 = new FirstLegalPolicy(false);
        const p2 = new RandomPolicy(
          new SeededRandom(recordedMatch.playerSeeds.p2),
          "SeededRandom-P2"
        );

        const simRes = SimulationRunner.run(
          session,
          { p1, p2 },
          { maxDecisions: evidence.configuration.maxDecisionsPerMatch }
        );

        const replayedTraceDigest = computeTraceDigestFromSimulation(simRes);

        // 各試合の主要指標が Evidence の記録と完全一致することを検証
        expect(simRes.completed).toBe(recordedMatch.completed);
        expect(simRes.winner).toBe(recordedMatch.winner);
        expect(simRes.totalDecisions).toBe(recordedMatch.totalDecisions);
        expect(simRes.turnCount).toBe(recordedMatch.turnCount);
        expect(simRes.finalStateHash).toBe(recordedMatch.finalStateHash);
        expect(replayedTraceDigest).toBe(recordedMatch.traceDigest);
      }
    });
  });

  describe("10,000 Matches Long-Run Stability Evidence Gate", () => {
    const stability10kEvidencePath = path.resolve(
      rootDir,
      "tools/simulator/reports/ai/large-scale-batch-stability-10k.json"
    );

    it("Test 16: 10,000試合安定性 Evidence JSON が存在し、Git実検証ステータスが VERIFIED であること", () => {
      expect(fs.existsSync(stability10kEvidencePath)).toBe(true);
      const evidence: LargeScaleBatchEvidence = JSON.parse(
        fs.readFileSync(stability10kEvidencePath, "utf-8")
      );

      expect(evidence.schemaVersion).toBe("1.0.0");
      expect(evidence.workId).toBe("BP-SIM-AI-V92-WORK2-10K-STABILITY-GATE");
      expect(evidence.configuration.regulationId).toBe("standard-pack");
      expect(evidence.configuration.matchCount).toBe(10000);

      // Git 実検証の厳格確認
      const git = evidence.executionManifest.gitMetadata;
      expect(git.verificationStatus).toBe("VERIFIED");
      expect(git.isDirty).toBe(false);
      expect(git.dirtyFiles.length).toBe(0);
      expect(git.headCommitSha).toMatch(/^[0-9a-f]{40}$/);
    });

    it("Test 17: 10,000試合全試合が決着完走 (100% completed, 0 failed, 0 incomplete) であること", () => {
      const evidence: LargeScaleBatchEvidence = JSON.parse(
        fs.readFileSync(stability10kEvidencePath, "utf-8")
      );

      expect(evidence.summary.totalMatches).toBe(10000);
      expect(evidence.summary.completedCount).toBe(10000);
      expect(evidence.summary.incompleteCount).toBe(0);
      expect(evidence.summary.failedCount).toBe(0);
      expect(evidence.isolatedFailures.length).toBe(0);
      expect(evidence.matches.length).toBe(10000);

      // 勝敗サマリー
      expect(evidence.summary.winsByPlayer.p2).toBe(7870);
      expect(evidence.summary.winsByPlayer.p1).toBe(2130);
      expect(evidence.summary.winRates.p2).toBe(0.787);
      expect(evidence.summary.winRates.p1).toBe(0.213);
    });

    it("Test 18: 最初の500試合が正式500試合Evidenceと100%完全一致すること (決定論的整合性)", () => {
      const verified500Path = path.resolve(
        rootDir,
        "tools/simulator/reports/ai/large-scale-batch-benchmark-stage1-verified.json"
      );
      const d10k: LargeScaleBatchEvidence = JSON.parse(
        fs.readFileSync(stability10kEvidencePath, "utf-8")
      );
      const d500: LargeScaleBatchEvidence = JSON.parse(
        fs.readFileSync(verified500Path, "utf-8")
      );

      for (let i = 0; i < 500; i++) {
        const m10 = d10k.matches[i];
        const m5 = d500.matches[i];
        expect(m10.winner).toBe(m5.winner);
        expect(m10.totalDecisions).toBe(m5.totalDecisions);
        expect(m10.turnCount).toBe(m5.turnCount);
        expect(m10.finalStateHash).toBe(m5.finalStateHash);
        expect(m10.traceDigest).toBe(m5.traceDigest);
      }
    });

    it("Test 19: 前半5,000試合と後半5,000試合の比較メトリクスおよびGC診断が正常であること (長時間メモリ安定性)", () => {
      const evidence: LargeScaleBatchEvidence = JSON.parse(
        fs.readFileSync(stability10kEvidencePath, "utf-8")
      );

      expect(evidence.halfwayComparison).toBeDefined();
      const hw = evidence.halfwayComparison!;
      expect(hw.firstHalf.matchCount).toBe(5000);
      expect(hw.secondHalf.matchCount).toBe(5000);

      // スループット維持率が 80% 以上であること
      expect(hw.throughputRetentionRatio).toBeGreaterThanOrEqual(0.80);

      // メモリ上限監視 (安全上限 RSS 1.5GB / Heap 1.0GB を一度も超えていないこと)
      const mem = evidence.performance.memory;
      expect(mem.peakRssBytes).toBeLessThan(1.5 * 1024 * 1024 * 1024);
      expect(mem.peakHeapUsedBytes).toBeLessThan(1.0 * 1024 * 1024 * 1024);

      // GC 診断の確認
      const gcDiag = mem.gcDiagnostics;
      expect(gcDiag).toBeDefined();
      expect(gcDiag!.gcAvailable).toBe(true);
      // 強制 GC 後の実残存ヒープが 100MB 未満であること
      expect(gcDiag!.postGcHeapUsedBytes).toBeLessThan(100 * 1024 * 1024);
    });

    it("Test 20: 代表試合 (Match 0, 5000, 9999) の同一条件単独再実行で全結果が完全一致すること (10,000試合決定論的再現性検証)", async () => {
      const evidence: LargeScaleBatchEvidence = JSON.parse(
        fs.readFileSync(stability10kEvidencePath, "utf-8")
      );

      const catalog = await loadRegulationCatalog();
      const rulesDir = path.resolve(rootDir, "tools/simulator/src/data/rules-vnext");
      const fullRulePackage = await loadRulePackageFromDirectory(rulesDir);
      const sessionFactory = await OfficialRegulationMatchFactory.prepareSessionFactory(
        evidence.configuration.regulationId,
        { catalog, fullRulePackage }
      );

      const sampleIndices = evidence.reproducibilityRecipe.sampleIndices; // [0, 5000, 9999]

      for (const idx of sampleIndices) {
        const recordedMatch = evidence.matches[idx];
        const matchContext = {
          matchIndex: recordedMatch.matchIndex,
          matchId: recordedMatch.matchId,
          baseSeed: recordedMatch.baseSeed,
          matchSeed: recordedMatch.matchSeed,
          playerSeeds: recordedMatch.playerSeeds,
        };

        const session = sessionFactory(matchContext);
        const p1 = new FirstLegalPolicy(false);
        const p2 = new RandomPolicy(
          new SeededRandom(recordedMatch.playerSeeds.p2),
          "SeededRandom-P2"
        );

        const simRes = SimulationRunner.run(
          session,
          { p1, p2 },
          { maxDecisions: evidence.configuration.maxDecisionsPerMatch }
        );

        const replayedTraceDigest = computeTraceDigestFromSimulation(simRes);

        // 各試合の主要指標が Evidence の記録と完全一致することを検証
        expect(simRes.completed).toBe(recordedMatch.completed);
        expect(simRes.winner).toBe(recordedMatch.winner);
        expect(simRes.totalDecisions).toBe(recordedMatch.totalDecisions);
        expect(simRes.turnCount).toBe(recordedMatch.turnCount);
        expect(simRes.finalStateHash).toBe(recordedMatch.finalStateHash);
        expect(replayedTraceDigest).toBe(recordedMatch.traceDigest);
      }
    });
  });
});
