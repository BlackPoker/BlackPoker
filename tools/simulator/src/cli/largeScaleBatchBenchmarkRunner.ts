import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
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
  LargeScalePerformanceMetrics,
  LargeScaleSeatInfo,
} from "../domain/simulation/LargeScaleBatchTypes.js";
import {
  computeDirectoryContentDigest,
  PlayerPolicyManifestEntry,
} from "../engine/simulation/ExecutionManifest.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../../../../");

const WORK_ID = "BP-SIM-AI-V92-WORK2-BATCH-FOUNDATION-STAGE1";
const REGULATION_ID = "standard-pack";
const BASE_SEED = 92000;

interface StageBenchmarkResult {
  readonly matchCount: number;
  readonly performance: LargeScalePerformanceMetrics;
  readonly completedCount: number;
  readonly incompleteCount: number;
  readonly failedCount: number;
  readonly winRates: Record<string, number>;
}

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(2)} MB`;
}

function formatMs(ms: number): string {
  return `${ms.toFixed(2)} ms`;
}

async function main() {
  console.log("================================================================================");
  console.log("  BlackPoker AI Work 2 — 大規模自動対戦基盤 ベンチマークランナー");
  console.log(`  Work ID: ${WORK_ID}`);
  console.log(`  Regulation: ${REGULATION_ID}`);
  console.log("================================================================================\n");

  // 1. 環境初期化とレギュレーション確認
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

  // 【厳格化】バージョン番号ではなく実ディレクトリ全内容からコンテンツ Digest を算出
  const rulePackageDigest = computeDirectoryContentDigest(rulesDir, true);

  console.log(`[Config] Regulation: ${REGULATION_ID} (${standardRulePackage.id} v${standardRulePackage.version})`);
  console.log(`[Config] RulePackage Content Digest: ${rulePackageDigest}`);

  const sessionFactory = await OfficialRegulationMatchFactory.prepareSessionFactory(REGULATION_ID, {
    catalog,
    fullRulePackage,
  });

  // ポリシーファクトリ: p1: FirstLegalPolicy vs p2: SeededRandom (実戦的AI対戦)
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

  // 【出力先検証 (対戦開始前の fail-closed 事前検証)】
  const args = process.argv.slice(2);
  let requestedOutputFile: string | undefined = undefined;
  let saveRequested = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--output-file" && i + 1 < args.length) {
      requestedOutputFile = path.resolve(process.cwd(), args[++i]);
      saveRequested = true;
    } else if (args[i] === "--save") {
      saveRequested = true;
    }
  }

  const protectedEvidencePath = path.resolve(
    rootDir,
    "tools/simulator/reports/ai/large-scale-batch-benchmark-stage1.json"
  );
  const defaultVerifiedEvidencePath = path.resolve(
    rootDir,
    "tools/simulator/reports/ai/large-scale-batch-benchmark-stage1-verified.json"
  );

  const targetOutputFile = requestedOutputFile ?? defaultVerifiedEvidencePath;

  if (saveRequested) {
    if (path.resolve(targetOutputFile) === protectedEvidencePath) {
      throw new Error(
        `SECURITY CONTRACT VIOLATION: 既存暫定 Evidence (${protectedEvidencePath}) の上書きは厳格に禁止されています (fail-closed)。`
      );
    }
    // 既存ファイルが存在する場合は原則として上書きを拒否
    if (fs.existsSync(targetOutputFile)) {
      throw new Error(
        `SECURITY CONTRACT VIOLATION: 出力先ファイル '${targetOutputFile}' は既に存在します。上書きは厳格に禁止されています (fail-closed)。`
      );
    }
    console.log(`[Config] Evidence 出力先事前検証 PASS (新規ファイル): ${targetOutputFile}`);
  }

  const stageResults: StageBenchmarkResult[] = [];
  const STAGE_MATCH_COUNTS = [100, 300, 500];

  let final500RunResult: any = null;

  for (const matchCount of STAGE_MATCH_COUNTS) {
    console.log(`\n--------------------------------------------------------------------------------`);
    console.log(`  実行段階: ${matchCount} 試合ベンチマーク`);
    console.log(`--------------------------------------------------------------------------------`);

    const config: LargeScaleBatchConfig = {
      batchId: `bench-${matchCount}`,
      workId: WORK_ID,
      baseSeed: BASE_SEED,
      matchCount,
      maxDecisionsPerMatch: 500,
      regulationId: REGULATION_ID,
      rulePackageId: standardRulePackage.id,
      rulePackageVersion: standardRulePackage.version,
      rootDir,
      playerPolicies,
      expectedGitCommitSha: process.env.EXPECTED_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA,
      memorySamplingInterval: Math.max(10, Math.floor(matchCount / 10)),
      onProgress: (p) => {
        console.log(
          `  進捗: ${p.completedMatches}/${p.totalMatches} (${((p.completedMatches / p.totalMatches) * 100).toFixed(0)}%) ` +
            `| 速度: ${p.currentSpeedMps.toFixed(1)} 試合/秒 | HeapUsed: ${p.heapUsedMb.toFixed(1)} MB`
        );
      },
    };

    // 正式実行メソッド (未検証メタデータの注入なし)
    const runResult = await LargeScaleBatchRunner.runBatch({
      config,
      sessionFactory,
      policyFactory,
      rulePackageDigest,
    });

    if (matchCount === 500) {
      final500RunResult = runResult;
    }

    const perf = runResult.performance;
    stageResults.push({
      matchCount,
      performance: perf,
      completedCount: runResult.summary.completedCount,
      incompleteCount: runResult.summary.incompleteCount,
      failedCount: runResult.summary.failedCount,
      winRates: runResult.summary.winRates,
    });

    console.log(`\n  [段階計測結果 (${matchCount} 試合)]`);
    console.log(`  - 総ウォールクロック時間: ${formatMs(perf.wallClockElapsedMs)} (${(perf.wallClockElapsedMs / 1000).toFixed(2)} 秒)`);
    console.log(`  - 毎秒対戦数 (スループット): ${perf.matchesPerSecond.toFixed(2)} 試合/秒`);
    console.log(`  - 1試合平均処理時間: ${formatMs(perf.latencies.meanMs)}`);
    console.log(`  - 1試合中央値処理時間: ${formatMs(perf.latencies.medianMs)}`);
    console.log(`  - 1試合 P95 処理時間: ${formatMs(perf.latencies.p95Ms)}`);
    console.log(`  - 1意思決定平均時間: ${perf.meanMsPerDecision ? formatMs(perf.meanMsPerDecision) : "N/A"}`);
    console.log(`  - メモリ Baseline: ${formatBytes(perf.memory.baselineHeapUsedBytes)} (HeapUsed) / ${formatBytes(perf.memory.baselineRssBytes)} (RSS)`);
    console.log(`  - メモリ Peak:     ${formatBytes(perf.memory.peakHeapUsedBytes)} (HeapUsed) / ${formatBytes(perf.memory.peakRssBytes)} (RSS)`);
    console.log(`  - メモリ Final:    ${formatBytes(perf.memory.finalHeapUsedBytes)} (HeapUsed) / ${formatBytes(perf.memory.finalRssBytes)} (RSS)`);
    console.log(`  - メモリ増加量:    ${formatBytes(perf.memory.heapGrowthBytes)} (Heap) / ${formatBytes(perf.memory.rssGrowthBytes)} (RSS)`);
    console.log(`  - CPU 使用率:      ${perf.cpu.cpuUtilizationPercent.toFixed(1)} % (Total CPU: ${formatMs(perf.cpu.totalCpuTimeMs)})`);
    console.log(`  - 推定 1万試合所要時間: ${(perf.estimated10kMatchesDurationSec / 60).toFixed(1)} 分 (${perf.estimated10kMatchesDurationHours.toFixed(2)} 時間)`);
  }

  if (saveRequested && final500RunResult) {
    console.log(`\n--------------------------------------------------------------------------------`);
    console.log(`  Evidence 保存処理: ${targetOutputFile}`);
    console.log(`--------------------------------------------------------------------------------`);
    final500RunResult.saveEvidence(targetOutputFile);
    console.log(`  [Success] 正式 Evidence ファイルの保存が完了しました。`);
  } else {
    console.log(`\n[Note] Evidence 保存はスキップされました (--save または --output-file <path> を指定して保存)。`);
    console.log(`[Note] 既存の large-scale-batch-benchmark-stage1.json は保護されています。`);
  }
}

main().catch((err) => {
  console.error("FATAL ERROR in LargeScaleBatchBenchmarkRunner:", err);
  process.exit(1);
});
