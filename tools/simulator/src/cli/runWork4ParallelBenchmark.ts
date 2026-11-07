/**
 * BlackPoker Work 4-2 — CPU Multi-Core Parallel Benchmark Runner
 *
 * 【目的】
 * ホスト実機（Intel Core Ultra 7 155U / Docker 14 CPU / 16GB RAM）において、
 * Workers 1, 2, 4, 8 による 1,000 試合（計 4,000 試合）の対戦速度、
 * CPU 使用率、Peak RSS、高速化倍率を実測・記録し、PC 購入判断用の客観的数値を取得する。
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  loadOfficialChampionsStrict,
  createStandardMatchupsAndResolver,
  DEFAULT_REGULATION_ID,
  DEFAULT_FRAME_ID,
  DEFAULT_RULE_PACKAGE_VERSION,
  DEFAULT_FEATURE_SCHEMA_VERSION,
  DEFAULT_DECISION_LIMIT,
  DEFAULT_CHUNK_SIZE_MATCHES,
} from "./largeScaleSimulationRunner";
import { checkGitCleanliness } from "./stage3HoldoutRunner";
import { prepareOfficialSessionFactory } from "./stage3EvolutionRunner";
import { loadRulePackageFromDirectory } from "../engine/rules/RuleLoader";
import { getPlaytestRulePackage } from "../engine/rules/RulePackageSelector";
import { MillionMatchCampaignEngine } from "../engine/simulation/MillionMatchCampaignEngine";
import { SerializedChampionsBundle } from "../domain/simulation/MillionMatchWorkerTypes";

interface BenchmarkResultEntry {
  workersCount: number;
  matches: number;
  wallClockMs: number;
  matchesPerSec: number;
  speedupFactor: number;
  userCpuSec: number;
  systemCpuSec: number;
  totalCpuSec: number;
  cpuUtilizationPercent: number;
  peakRssMb: number;
  peakHeapUsedMb: number;
  logicalResultDigest: string;
  chunk0Sha256: string;
}

async function main() {
  console.log("================================================================================");
  console.log("BlackPoker Work 4-2 — CPU Multi-Core Parallel Benchmark (Phase 6)");
  console.log("================================================================================");

  const gitInfo = checkGitCleanliness();
  console.log(`Git Commit: ${gitInfo.headCommitSha} (Clean: ${gitInfo.isClean})`);
  console.log(`OS Platform: ${os.platform()} (${os.release()})`);
  console.log(`CPUs: ${os.cpus().length} logical cores (${os.cpus()[0]?.model || "unknown"})`);
  console.log(`Total System Memory: ${(os.totalmem() / (1024 * 1024 * 1024)).toFixed(2)} GB`);
  console.log("--------------------------------------------------------------------------------");

  const rulesDir = path.resolve("src/data/rules-vnext");
  const fullPkg = await loadRulePackageFromDirectory(rulesDir);
  const rulePackage = getPlaytestRulePackage(fullPkg);
  const sessionFactory = await prepareOfficialSessionFactory(DEFAULT_REGULATION_ID);
  const champions = loadOfficialChampionsStrict();
  const { matchups, championAuthenticity, policyResolver } =
    createStandardMatchupsAndResolver(champions);

  const bundle: SerializedChampionsBundle = {
    gen7DNA: champions.gen7DNA,
    gen7Digest: champions.gen7Digest,
    gen7Source: champions.gen7Source,
    gen5DNA: champions.gen5DNA,
    gen5Digest: champions.gen5Digest,
    gen5Source: champions.gen5Source,
    zeroDNA: champions.zeroDNA,
    zeroDigest: champions.zeroDigest,
    authenticityRecord: championAuthenticity,
  };

  const matchesPerRun = 1000; // 500 pairs
  const workerCounts: (1 | 2 | 4 | 8)[] = [1, 2, 4, 8];
  const results: BenchmarkResultEntry[] = [];
  let baseSpeed = 0;

  for (const w of workerCounts) {
    console.log(`\n>>> Starting Benchmark: Workers = ${w} (${matchesPerRun} matches)...`);
    const outputDir = path.resolve(`.artifacts/benchmark-parallel-w${w}`);
    fs.rmSync(outputDir, { recursive: true, force: true });

    // GC 実行（可能なら）
    if (typeof global.gc === "function") global.gc();

    const t0Wall = performance.now();
    const t0Cpu = process.cpuUsage();

    const res = await MillionMatchCampaignEngine.runCampaign({
      workId: "BP-SIM-AI-V92-WORK4-PARALLEL-BENCHMARK-R1",
      campaignId: `bench-parallel-w${w}`,
      purpose: "QUALITY_AUDIT",
      stage: "STAGE_A_1K",
      executionMode: "PILOT",
      totalPlannedMatches: matchesPerRun,
      campaignSeed: 20261106,
      regulationId: DEFAULT_REGULATION_ID,
      frameId: DEFAULT_FRAME_ID,
      rulePackageVersion: DEFAULT_RULE_PACKAGE_VERSION,
      featureSchemaVersion: DEFAULT_FEATURE_SCHEMA_VERSION,
      rulePackage,
      matchups,
      championAuthenticity,
      policyResolver,
      sessionFactory,
      outputDir,
      chunkSizeMatches: DEFAULT_CHUNK_SIZE_MATCHES,
      maxDecisionsPerMatch: DEFAULT_DECISION_LIMIT,
      workersCount: w,
      championsBundleForWorker: bundle,
      rulesDirForWorker: rulesDir,
      gitCommitSha: gitInfo.headCommitSha,
      isGitClean: gitInfo.isClean,
    });

    const elapsedWallMs = performance.now() - t0Wall;
    const elapsedCpu = process.cpuUsage(t0Cpu);
    const userCpuSec = elapsedCpu.user / 1_000_000;
    const sysCpuSec = elapsedCpu.system / 1_000_000;
    const totalCpuSec = userCpuSec + sysCpuSec;
    const wallSec = elapsedWallMs / 1000;
    const matchesPerSec = matchesPerRun / wallSec;

    if (w === 1) {
      baseSpeed = matchesPerSec;
    }
    const speedupFactor = baseSpeed > 0 ? matchesPerSec / baseSpeed : 1.0;
    const cpuUtilizationPercent = wallSec > 0 ? (totalCpuSec / wallSec) * 100 : 0;

    const ckpt = res.checkpointState;
    const peakRssMb = ckpt.peakRssBytes / (1024 * 1024);
    const peakHeapUsedMb = ckpt.peakHeapUsedBytes / (1024 * 1024);
    const chunk0Sha = ckpt.completedChunks[0]?.sha256 ?? "N/A";

    const entry: BenchmarkResultEntry = {
      workersCount: w,
      matches: matchesPerRun,
      wallClockMs: elapsedWallMs,
      matchesPerSec,
      speedupFactor,
      userCpuSec,
      systemCpuSec: sysCpuSec,
      totalCpuSec,
      cpuUtilizationPercent,
      peakRssMb,
      peakHeapUsedMb,
      logicalResultDigest: res.evidence.logicalResultDigest,
      chunk0Sha256: chunk0Sha,
    };
    results.push(entry);

    console.log(`  Completed in ${wallSec.toFixed(2)}s | ${matchesPerSec.toFixed(2)} m/s | Speedup: ${speedupFactor.toFixed(2)}x | CPU: ${cpuUtilizationPercent.toFixed(1)}% | Peak RSS: ${peakRssMb.toFixed(1)}MB`);
  }

  // 結果レポート出力
  console.log("\n================================================================================");
  console.log("BENCHMARK SUMMARY TABLE");
  console.log("================================================================================");
  console.log("| Workers | Matches | Wall (s) | Matches/s | Speedup | CPU Total (s) | CPU Util (%) | Peak RSS (MB) |");
  console.log("|---------|---------|----------|-----------|---------|---------------|--------------|---------------|");
  for (const r of results) {
    console.log(
      `| ${String(r.workersCount).padEnd(7)} ` +
      `| ${String(r.matches).padEnd(7)} ` +
      `| ${(r.wallClockMs / 1000).toFixed(2).padStart(8)} ` +
      `| ${r.matchesPerSec.toFixed(2).padStart(9)} ` +
      `| ${r.speedupFactor.toFixed(2).padStart(6)}x ` +
      `| ${r.totalCpuSec.toFixed(2).padStart(13)} ` +
      `| ${r.cpuUtilizationPercent.toFixed(1).padStart(11)}% ` +
      `| ${r.peakRssMb.toFixed(1).padStart(13)} |`
    );
  }
  console.log("================================================================================");

  // JSON 保存
  const reportPath = path.resolve(".artifacts/parallel-benchmark-report.json");
  fs.writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    hostInfo: {
      platform: os.platform(),
      release: os.release(),
      logicalCores: os.cpus().length,
      cpuModel: os.cpus()[0]?.model || "unknown",
      totalRamGb: os.totalmem() / (1024 * 1024 * 1024),
    },
    gitCommit: gitInfo.headCommitSha,
    matchesPerBenchmark: matchesPerRun,
    results,
  }, null, 2), "utf8");
  console.log(`Report saved to: ${reportPath}`);
}

main().catch((err) => {
  console.error("FATAL BENCHMARK ERROR:", err);
  process.exit(1);
});
