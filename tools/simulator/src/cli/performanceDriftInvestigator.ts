import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { fileURLToPath } from "url";
import { PerformanceObserver } from "perf_hooks";
import { loadRegulationCatalog } from "../engine/regulation/RegulationLoader.js";
import { loadRulePackageFromDirectory } from "../engine/rules/RuleLoader.js";
import { RegulationValidator } from "../engine/regulation/RegulationValidator.js";
import { RegulationRulePackageSelector } from "../engine/regulation/RegulationRulePackageSelector.js";
import { OfficialRegulationMatchFactory } from "../engine/regulation/OfficialRegulationMatchFactory.js";
import { FirstLegalPolicy, RandomPolicy } from "../engine/simulation/DecisionPolicy.js";
import { SeededRandom } from "../engine/random/RandomSource.js";
import {
  LargeScaleBatchRunner,
  LargeScaleMatchContext,
} from "../engine/simulation/LargeScaleBatchRunner.js";
import {
  LargeScaleBatchConfig,
  LargeScaleSeatInfo,
  LargeScaleMatchResult,
} from "../domain/simulation/LargeScaleBatchTypes.js";
import {
  computeDirectoryContentDigest,
  PlayerPolicyManifestEntry,
} from "../engine/simulation/ExecutionManifest.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../../../../");

const WORK_ID = "BP-SIM-AI-V92-WORK2-PERFORMANCE-DRIFT-INVESTIGATION";
const REGULATION_ID = "standard-pack";
const BASE_SEED = 92000;
const MATCH_COUNT = 2000;
const SEGMENT_SIZE = 250;

export interface SegmentReport {
  segmentIndex: number;
  startIndex: number;
  endIndex: number;
  matchCount: number;
  elapsedMs: number;
  matchesPerSecond: number;
  meanLatencyMs: number;
  medianLatencyMs: number;
  totalDecisions: number;
  meanMsPerDecision: number;
  gcCount: number;
  gcDurationMs: number;
  endHeapUsedMb: number;
  endRssMb: number;
}

export interface CheckpointRecord {
  matchIndex: number;
  filePath: string;
  durationMs: number;
  fileSizeBytes: number;
}

export interface DriftInvestigationReport {
  workId: string;
  mode: "A" | "B";
  modeDescription: string;
  timestamp: string;
  cpuInfo: string;
  totalMatches: number;
  wallClockElapsedMs: number;
  overallMatchesPerSecond: number;
  totalDecisions: number;
  meanMsPerDecision: number;
  totalGcCount: number;
  totalGcDurationMs: number;
  totalCheckpointDurationMs: number;
  checkpoints: CheckpointRecord[];
  segments: SegmentReport[];
  driftRatio: number; // 最後のセグメント / 最初のセグメント のスループット比
}

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(2)} MB`;
}

function formatMs(ms: number): string {
  return `${ms.toFixed(2)} ms`;
}

function getHostCpuInfo(): string {
  try {
    const cpus = os.cpus();
    if (cpus && cpus.length > 0) {
      return `${cpus[0].model} (${cpus.length} logical cores)`;
    }
  } catch {
    // ignore
  }
  return "Unknown CPU";
}

async function main() {
  const args = process.argv.slice(2);
  let mode: "A" | "B" = "A";
  let requestedOutputFile: string | undefined = undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--mode" && i + 1 < args.length) {
      const m = args[++i].toUpperCase();
      if (m === "A" || m === "B") mode = m;
    } else if (args[i] === "--output-file" && i + 1 < args.length) {
      requestedOutputFile = path.resolve(process.cwd(), args[++i]);
    }
  }

  const modeDescription =
    mode === "A"
      ? "2,000試合・500試合ごとのチェックポイントあり"
      : "2,000試合・通常チェックポイントなし";

  console.log("================================================================================");
  console.log(`  BlackPoker AI Work 2 — 性能低下原因調査ベンチマーク (条件 ${mode})`);
  console.log(`  Work ID: ${WORK_ID}`);
  console.log(`  条件: ${modeDescription}`);
  console.log(`  Target Matches: ${MATCH_COUNT} (区間サイズ: ${SEGMENT_SIZE} 試合)`);
  console.log("================================================================================\n");

  // GC 監視の設定
  let cumulativeGcCount = 0;
  let cumulativeGcDurationMs = 0;
  const gcObserver = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      cumulativeGcCount++;
      cumulativeGcDurationMs += entry.duration;
    }
  });
  gcObserver.observe({ entryTypes: ["gc"] });

  // チェックポイント記録
  const checkpointRecords: CheckpointRecord[] = [];

  // レギュレーションと環境準備
  const catalog = await loadRegulationCatalog();
  const rulesDir = path.resolve(__dirname, "../data/rules-vnext");
  const fullRulePackage = await loadRulePackageFromDirectory(rulesDir);

  const regValidation = RegulationValidator.validateRegulation(catalog, REGULATION_ID, {
    assertImplemented: true,
  });
  const standardRulePackage = RegulationRulePackageSelector.selectRulePackage(
    fullRulePackage,
    regValidation.format!,
    regValidation.regulation!,
    regValidation.frame!
  );
  const rulePackageDigest = computeDirectoryContentDigest(rulesDir, true);

  const sessionFactory = await OfficialRegulationMatchFactory.prepareSessionFactory(REGULATION_ID, {
    catalog,
    fullRulePackage,
  });

  const sampleP1 = new FirstLegalPolicy(false);
  const sampleP2 = new RandomPolicy(new SeededRandom(0), "SeededRandom-P2");

  const playerPolicies: readonly PlayerPolicyManifestEntry[] = [
    {
      seat: "p1",
      descriptor: sampleP1.descriptor,
      constructorSettings: { preferPass: false },
    },
    {
      seat: "p2",
      descriptor: sampleP2.descriptor,
      constructorSettings: { derivation: "deriveBatchSeed(baseSeed, matchIndex, 'p2')" },
    },
  ];

  const policyFactory = (ctx: LargeScaleMatchContext) => {
    const p1Policy = new FirstLegalPolicy(false);
    const p2Policy = new RandomPolicy(new SeededRandom(ctx.playerSeeds.p2), "SeededRandom-P2");

    const seats: Record<string, LargeScaleSeatInfo> = {
      p1: {
        playerKey: "p1",
        policyId: p1Policy.descriptor.name ?? p1Policy.descriptor.kind,
        policyDescriptor: p1Policy.descriptor,
      },
      p2: {
        playerKey: "p2",
        policyId: p2Policy.descriptor.name ?? p2Policy.descriptor.kind,
        policyDescriptor: p2Policy.descriptor,
      },
    };

    return {
      policies: {
        p1: p1Policy,
        p2: p2Policy,
      },
      seats,
    };
  };

  const checkpointInterval = mode === "A" ? 500 : 999999;
  const testCheckpointDir = path.resolve(rootDir, `tools/simulator/.artifacts/checkpoints/drift-${mode}`);

  const segmentSnapshots: {
    matchCount: number;
    gcCount: number;
    gcDurationMs: number;
    wallElapsedMs: number;
  }[] = [{ matchCount: 0, gcCount: 0, gcDurationMs: 0, wallElapsedMs: 0 }];

  const config: LargeScaleBatchConfig = {
    batchId: `drift-${mode}-${MATCH_COUNT}`,
    workId: WORK_ID,
    baseSeed: BASE_SEED,
    matchCount: MATCH_COUNT,
    maxDecisionsPerMatch: 500,
    regulationId: REGULATION_ID,
    rulePackageId: standardRulePackage.id,
    rulePackageVersion: standardRulePackage.version,
    rootDir,
    playerPolicies,
    checkpointInterval,
    checkpointDir: testCheckpointDir,
    memorySamplingInterval: 50,
    onCheckpointSaved: (info) => {
      checkpointRecords.push(info);
      console.log(
        `  [Checkpoint Saved] Match ${info.matchIndex + 1}: ${formatBytes(info.fileSizeBytes)} (所要時間: ${formatMs(info.durationMs)})`
      );
    },
    onProgress: (p) => {
      if (p.completedMatches % SEGMENT_SIZE === 0) {
        segmentSnapshots.push({
          matchCount: p.completedMatches,
          gcCount: cumulativeGcCount,
          gcDurationMs: cumulativeGcDurationMs,
          wallElapsedMs: globalThis.performance.now(),
        });
        console.log(
          `  進捗: ${p.completedMatches}/${p.totalMatches} (${((p.completedMatches / p.totalMatches) * 100).toFixed(0)}%) ` +
            `| 速度: ${p.currentSpeedMps.toFixed(2)} 試合/秒 | HeapUsed: ${p.heapUsedMb.toFixed(1)} MB`
        );
      }
    },
  };

  const startTime = globalThis.performance.now();
  const runResult = await LargeScaleBatchRunner.runBatch({
    config,
    sessionFactory,
    policyFactory,
    rulePackageDigest,
  });
  const totalElapsedMs = globalThis.performance.now() - startTime;
  gcObserver.disconnect();

  // 250 試合ごとのセグメント集計
  const segments: SegmentReport[] = [];
  const numSegments = Math.floor(MATCH_COUNT / SEGMENT_SIZE);

  for (let s = 0; s < numSegments; s++) {
    const startIdx = s * SEGMENT_SIZE;
    const endIdx = (s + 1) * SEGMENT_SIZE - 1;
    const segMatches = runResult.matches.slice(startIdx, endIdx + 1);

    const durations = segMatches.map((m) => m.durationMs).sort((a, b) => a - b);
    const segElapsed = durations.reduce((a, b) => a + b, 0);
    const segMps = segElapsed > 0 ? (segMatches.length / segElapsed) * 1000 : 0;
    const meanLat = durations.length > 0 ? segElapsed / durations.length : 0;
    const medianLat =
      durations.length > 0
        ? durations.length % 2 === 1
          ? durations[Math.floor(durations.length / 2)]
          : (durations[durations.length / 2 - 1] + durations[durations.length / 2]) / 2
        : 0;

    const totalDecisions = segMatches.reduce((acc, m) => acc + m.totalDecisions, 0);
    const msPerDecision = totalDecisions > 0 ? segElapsed / totalDecisions : 0;

    // GC 差分
    const prevSnap = segmentSnapshots[s];
    const currSnap = segmentSnapshots[s + 1];
    const segGcCount = currSnap && prevSnap ? currSnap.gcCount - prevSnap.gcCount : 0;
    const segGcDuration = currSnap && prevSnap ? currSnap.gcDurationMs - prevSnap.gcDurationMs : 0;

    // メモリサンプルから直近を取得
    const closestSample = runResult.performance.memory.samples.find(
      (samp) => samp.matchIndex >= endIdx + 1
    ) ?? runResult.performance.memory.samples[runResult.performance.memory.samples.length - 1];

    segments.push({
      segmentIndex: s,
      startIndex: startIdx,
      endIndex: endIdx,
      matchCount: segMatches.length,
      elapsedMs: segElapsed,
      matchesPerSecond: segMps,
      meanLatencyMs: meanLat,
      medianLatencyMs: medianLat,
      totalDecisions,
      meanMsPerDecision: msPerDecision,
      gcCount: segGcCount,
      gcDurationMs: segGcDuration,
      endHeapUsedMb: closestSample ? closestSample.heapUsedBytes / (1024 * 1024) : 0,
      endRssMb: closestSample ? closestSample.rssBytes / (1024 * 1024) : 0,
    });
  }

  const driftRatio =
    segments.length >= 2 && segments[0].matchesPerSecond > 0
      ? segments[segments.length - 1].matchesPerSecond / segments[0].matchesPerSecond
      : 1.0;

  const totalCheckpointDurationMs = checkpointRecords.reduce((acc, c) => acc + c.durationMs, 0);

  const report: DriftInvestigationReport = {
    workId: WORK_ID,
    mode,
    modeDescription,
    timestamp: new Date().toISOString(),
    cpuInfo: getHostCpuInfo(),
    totalMatches: MATCH_COUNT,
    wallClockElapsedMs: totalElapsedMs,
    overallMatchesPerSecond: (MATCH_COUNT / totalElapsedMs) * 1000,
    totalDecisions: runResult.performance.totalDecisions,
    meanMsPerDecision: runResult.performance.meanMsPerDecision ?? 0,
    totalGcCount: cumulativeGcCount,
    totalGcDurationMs: cumulativeGcDurationMs,
    totalCheckpointDurationMs,
    checkpoints: checkpointRecords,
    segments,
    driftRatio,
  };

  // レポート出力
  console.log(`\n================================================================================`);
  console.log(`  [調査ベンチマーク結果サマリー (条件 ${mode})]`);
  console.log(`================================================================================`);
  console.log(`  - 完了試合数:        ${runResult.summary.completedCount} / ${MATCH_COUNT} (100%)`);
  console.log(`  - 総ウォール時間:    ${formatMs(totalElapsedMs)} (${(totalElapsedMs / 1000).toFixed(2)} 秒)`);
  console.log(`  - 全体スループット:  ${report.overallMatchesPerSecond.toFixed(2)} 試合/秒`);
  console.log(`  - 総意思決定数:      ${report.totalDecisions}`);
  console.log(`  - 1意思決定時間:     ${formatMs(report.meanMsPerDecision)}`);
  console.log(`  - 総 GC 回数:        ${report.totalGcCount} 回 (総 GC 時間: ${formatMs(report.totalGcDurationMs)})`);
  console.log(`  - チェックポイント数:${checkpointRecords.length} 回 (総保存時間: ${formatMs(totalCheckpointDurationMs)})`);
  console.log(`  - 初回 vs 最終比:    ${(driftRatio * 100).toFixed(1)} % (区間0: ${segments[0].matchesPerSecond.toFixed(2)} mps -> 区間${segments.length - 1}: ${segments[segments.length - 1].matchesPerSecond.toFixed(2)} mps)`);

  console.log(`\n--------------------------------------------------------------------------------`);
  console.log(`  250 試合区間別詳細メトリクス (条件 ${mode})`);
  console.log(`--------------------------------------------------------------------------------`);
  console.log(`| 区間 | 試合範囲 | 速度 (mps) | 平均Lat (ms) | 1決定Lat (ms) | GC回数 | GC時間 (ms) | HeapUsed (MB) | RSS (MB) |`);
  console.log(`| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |`);
  for (const seg of segments) {
    console.log(
      `| Seg ${seg.segmentIndex} | ${seg.startIndex}-${seg.endIndex} | ${seg.matchesPerSecond.toFixed(2)} | ` +
        `${seg.meanLatencyMs.toFixed(1)} | ${seg.meanMsPerDecision.toFixed(3)} | ` +
        `${seg.gcCount} | ${seg.gcDurationMs.toFixed(1)} | ` +
        `${seg.endHeapUsedMb.toFixed(1)} | ${seg.endRssMb.toFixed(1)} |`
    );
  }

  if (requestedOutputFile) {
    fs.writeFileSync(requestedOutputFile, JSON.stringify(report, null, 2), "utf-8");
    console.log(`\n[Report Saved] ${requestedOutputFile}`);
  }
}

main().catch((err) => {
  console.error("FATAL ERROR in performanceDriftInvestigator:", err);
  process.exit(1);
});
