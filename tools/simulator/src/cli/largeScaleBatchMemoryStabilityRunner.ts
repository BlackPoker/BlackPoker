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
  computeHalfwayComparison,
} from "../engine/simulation/LargeScaleBatchRunner.js";
import {
  LargeScaleBatchConfig,
  LargeScaleSeatInfo,
} from "../domain/simulation/LargeScaleBatchTypes.js";
import {
  computeDirectoryContentDigest,
  PlayerPolicyManifestEntry,
} from "../engine/simulation/ExecutionManifest.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../../../../");

const WORK_ID = "BP-SIM-AI-V92-WORK2-MEMORY-STABILITY-GATE";
const REGULATION_ID = "standard-pack";
const BASE_SEED = 92000;
const MATCH_COUNT = 1000;
const SAMPLING_INTERVAL = 50;

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(2)} MB`;
}

function formatMs(ms: number): string {
  return `${ms.toFixed(2)} ms`;
}

async function main() {
  console.log("================================================================================");
  console.log("  BlackPoker AI Work 2 — 長時間メモリ安定性検証ランナー (1,000試合)");
  console.log(`  Work ID: ${WORK_ID}`);
  console.log(`  Regulation: ${REGULATION_ID}`);
  console.log(`  Target Matches: ${MATCH_COUNT} (サンプリング間隔: ${SAMPLING_INTERVAL} 試合)`);
  console.log("================================================================================\n");

  // CLI 引数の解析 (--output-file, --save)
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

  const defaultEvidencePath = path.resolve(
    rootDir,
    "tools/simulator/reports/ai/large-scale-batch-memory-stability-1k.json"
  );
  const targetOutputFile = requestedOutputFile ?? defaultEvidencePath;

  // 既存 Evidence の完全保護ガード
  const protectedEvidencePaths = [
    path.resolve(rootDir, "tools/simulator/reports/ai/large-scale-batch-benchmark-stage1.json"),
    path.resolve(rootDir, "tools/simulator/reports/ai/large-scale-batch-benchmark-stage1-verified.json"),
  ];

  for (const prot of protectedEvidencePaths) {
    if (path.resolve(targetOutputFile) === prot) {
      throw new Error(
        `SECURITY CONTRACT VIOLATION: 既存 Evidence (${prot}) の上書きは厳格に禁止されています (fail-closed)。`
      );
    }
  }

  if (saveRequested && fs.existsSync(targetOutputFile)) {
    throw new Error(
      `SECURITY CONTRACT VIOLATION: 出力先ファイル '${targetOutputFile}' は既に存在します。上書きは厳格に禁止されています (fail-closed)。`
    );
  }

  if (saveRequested) {
    console.log(`[Config] Evidence 出力先事前検証 PASS (新規ファイル): ${targetOutputFile}`);
  }

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

  const rulePackageDigest = computeDirectoryContentDigest(rulesDir, true);
  console.log(`[Config] Regulation: ${REGULATION_ID} (${standardRulePackage.id} v${standardRulePackage.version})`);
  console.log(`[Config] RulePackage Content Digest: ${rulePackageDigest}`);

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

  const config: LargeScaleBatchConfig = {
    batchId: `mem-stability-${MATCH_COUNT}`,
    workId: WORK_ID,
    baseSeed: BASE_SEED,
    matchCount: MATCH_COUNT,
    maxDecisionsPerMatch: 500,
    regulationId: REGULATION_ID,
    rulePackageId: standardRulePackage.id,
    rulePackageVersion: standardRulePackage.version,
    rootDir,
    playerPolicies,
    expectedGitCommitSha: process.env.EXPECTED_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA,
    memorySamplingInterval: SAMPLING_INTERVAL,
    onProgress: (p) => {
      console.log(
        `  進捗: ${p.completedMatches}/${p.totalMatches} (${((p.completedMatches / p.totalMatches) * 100).toFixed(0)}%) ` +
          `| 速度: ${p.currentSpeedMps.toFixed(1)} 試合/秒 | HeapUsed: ${p.heapUsedMb.toFixed(1)} MB`
      );
    },
  };

  console.log(`\n--------------------------------------------------------------------------------`);
  console.log(`  1,000 試合 メモリ安定性ベンチマーク開始`);
  console.log(`--------------------------------------------------------------------------------`);

  const runResult = await LargeScaleBatchRunner.runBatch({
    config,
    sessionFactory,
    policyFactory,
    rulePackageDigest,
  });

  const perf = runResult.performance;
  console.log(`\n================================================================================`);
  console.log(`  [全体計測結果 (1,000 試合)]`);
  console.log(`================================================================================`);
  console.log(`  - 決着完了試合数:  ${runResult.summary.completedCount} / ${runResult.summary.totalMatches} (100%)`);
  console.log(`  - 未完了 / 障害:   Incomplete: ${runResult.summary.incompleteCount}, Failed: ${runResult.summary.failedCount}`);
  console.log(`  - 勝者内訳:        p2: ${runResult.summary.winsByPlayer.p2} (${(runResult.summary.winRates.p2 * 100).toFixed(1)}%) / p1: ${runResult.summary.winsByPlayer.p1} (${(runResult.summary.winRates.p1 * 100).toFixed(1)}%)`);
  console.log(`  - 総ウォール時間:  ${formatMs(perf.wallClockElapsedMs)} (${(perf.wallClockElapsedMs / 1000).toFixed(2)} 秒)`);
  console.log(`  - スループット:    ${perf.matchesPerSecond.toFixed(2)} 試合/秒`);
  console.log(`  - 1試合平均時間:   ${formatMs(perf.latencies.meanMs)}`);
  console.log(`  - 1試合中央値時間: ${formatMs(perf.latencies.medianMs)}`);
  console.log(`  - 1試合 P95 時間:  ${formatMs(perf.latencies.p95Ms)}`);
  console.log(`  - 1意思決定時間:   ${perf.meanMsPerDecision ? formatMs(perf.meanMsPerDecision) : "N/A"}`);
  console.log(`  - メモリ Baseline: ${formatBytes(perf.memory.baselineHeapUsedBytes)} (HeapUsed) / ${formatBytes(perf.memory.baselineRssBytes)} (RSS)`);
  console.log(`  - メモリ Peak:     ${formatBytes(perf.memory.peakHeapUsedBytes)} (HeapUsed) / ${formatBytes(perf.memory.peakRssBytes)} (RSS)`);
  console.log(`  - メモリ Final:    ${formatBytes(perf.memory.finalHeapUsedBytes)} (HeapUsed) / ${formatBytes(perf.memory.finalRssBytes)} (RSS)`);
  console.log(`  - メモリ増加量:    ${formatBytes(perf.memory.heapGrowthBytes)} (Heap) / ${formatBytes(perf.memory.rssGrowthBytes)} (RSS)`);

  if (perf.memory.gcDiagnostics && perf.memory.gcDiagnostics.gcAvailable) {
    const gc = perf.memory.gcDiagnostics;
    console.log(`\n  [強制 GC 診断 (通常計測完了後に独立実施)]`);
    console.log(`  - GC 後 HeapUsed:  ${formatBytes(gc.postGcHeapUsedBytes ?? 0)}`);
    console.log(`  - GC 後 RSS:       ${formatBytes(gc.postGcRssBytes ?? 0)}`);
    console.log(`  - 解放されたヒープ:${formatBytes(gc.reclaimedHeapBytes ?? 0)}`);
  } else {
    console.log(`\n  [Note] 強制 GC 診断は未実行 (node --expose-gc なし)`);
  }

  // 前半・後半比較
  const halfway = computeHalfwayComparison({
    matches: runResult.matches,
    memorySamples: perf.memory.samples,
  });

  if (halfway) {
    console.log(`\n--------------------------------------------------------------------------------`);
    console.log(`  前半 500 試合 vs 後半 500 試合 比較分析`);
    console.log(`--------------------------------------------------------------------------------`);
    console.log(`  [前半 500 試合 (Index 0 - 499)]`);
    console.log(`  - スループット:    ${halfway.firstHalf.matchesPerSecond.toFixed(2)} 試合/秒`);
    console.log(`  - 平均レイテンシ:  ${formatMs(halfway.firstHalf.meanLatencyMs)}`);
    console.log(`  - 中央値レイテンシ:${formatMs(halfway.firstHalf.medianLatencyMs)}`);
    console.log(`  - Heap 開始->終了: ${formatBytes(halfway.firstHalf.startHeapUsedBytes)} -> ${formatBytes(halfway.firstHalf.endHeapUsedBytes)} (増加: ${formatBytes(halfway.firstHalf.heapGrowthBytes)})`);

    console.log(`\n  [後半 500 試合 (Index 500 - 999)]`);
    console.log(`  - スループット:    ${halfway.secondHalf.matchesPerSecond.toFixed(2)} 試合/秒`);
    console.log(`  - 平均レイテンシ:  ${formatMs(halfway.secondHalf.meanLatencyMs)}`);
    console.log(`  - 中央値レイテンシ:${formatMs(halfway.secondHalf.medianLatencyMs)}`);
    console.log(`  - Heap 開始->終了: ${formatBytes(halfway.secondHalf.startHeapUsedBytes)} -> ${formatBytes(halfway.secondHalf.endHeapUsedBytes)} (増加: ${formatBytes(halfway.secondHalf.heapGrowthBytes)})`);

    console.log(`\n  [比較サマリー]`);
    console.log(`  - スループット維持率: ${(halfway.throughputRetentionRatio * 100).toFixed(1)} %`);
    console.log(`  - ヒープ増加減速比:   ${halfway.heapGrowthDecelerationRatio.toFixed(3)}x`);
  }

  if (saveRequested) {
    console.log(`\n--------------------------------------------------------------------------------`);
    console.log(`  Evidence 保存処理: ${targetOutputFile}`);
    console.log(`--------------------------------------------------------------------------------`);
    runResult.saveEvidence(targetOutputFile, { halfwayComparison: halfway });
    console.log(`  [Success] 正式 1,000 試合 Evidence ファイルの保存が完了しました。`);
  } else {
    console.log(`\n[Note] Evidence 保存はスキップされました (--save または --output-file を指定して保存)。`);
  }
}

main().catch((err) => {
  console.error("FATAL ERROR in LargeScaleBatchMemoryStabilityRunner:", err);
  process.exit(1);
});
