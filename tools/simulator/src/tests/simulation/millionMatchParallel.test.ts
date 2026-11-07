/**
 * BlackPoker Work 4-2 — CPU Multi-Core Parallel Simulation Regression Tests
 *
 * 【検証項目】
 * 1. 永続 Worker Pool の初期化、ペア実行、安全な terminate
 * 2. 決定論的再現性: Inline, Workers 1, Workers 2, Workers 4 で同一 Seed 実行時の
 *    Logical Result Digest および チャンク SHA-256 の 1 ビットも狂わない完全一致
 * 3. Worker 数を変更した多段階 Resume: 1 Worker で開始・一時停止後、4 Workers で再開しても
 *    連続実行時と同一の Logical Result Digest & チャンク SHA-256 が得られること
 * 4. Fail-Closed 異常系: 不正な workersCount、DNA 改ざん時の安全な停止
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { getPlaytestRulePackage } from "../../engine/rules/RulePackageSelector";
import { RulePackage } from "../../domain/rules/RulePackage";
import { GameSession } from "../../engine/session/GameSession";
import { createCoreBattlePresetState } from "../../engine/session/playtest/createCoreBattlePlaytest";
import { MatchSetupCoordinator } from "../../engine/session/setup/MatchSetupCoordinator";
import {
  MillionMatchCampaignEngine,
  MillionMatchSeedAllocator,
  derivePlayerSeed,
} from "../../engine/simulation/MillionMatchCampaignEngine";
import {
  createSyntheticTestChampionsForUnitTest,
  createStandardMatchupsAndResolver,
  DEFAULT_REGULATION_ID,
  DEFAULT_FRAME_ID,
  DEFAULT_RULE_PACKAGE_VERSION,
  DEFAULT_FEATURE_SCHEMA_VERSION,
  DEFAULT_DECISION_LIMIT,
} from "../../cli/largeScaleSimulationRunner";
import { prepareOfficialSessionFactory } from "../../cli/stage3EvolutionRunner";
import {
  MillionMatchWorkerPool,
  WorkerPairTask,
} from "../../engine/simulation/MillionMatchWorkerPool";
import {
  SerializedChampionsBundle,
} from "../../domain/simulation/MillionMatchWorkerTypes";
import {
  MillionMatchCampaignEvidence,
  MillionMatchCheckpointState,
} from "../../domain/simulation/MillionMatchInfraTypes";

describe("BlackPoker Work 4-2 — CPU Multi-Core Parallel Simulation Tests", () => {
  let rulePackage: RulePackage;
  let savedW4Evidence: MillionMatchCampaignEvidence | null = null;
  let savedW4Checkpoint: MillionMatchCheckpointState | null = null;
  const tmpRoot = path.join(os.tmpdir(), "bp-work4-parallel-test");
  const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");

  beforeAll(async () => {
    const fullPkg = await loadRulePackageFromDirectory(rulesDir);
    rulePackage = getPlaytestRulePackage(fullPkg);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(tmpRoot, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  const createFastDeterministicSessionFactory = () => {
    return (_ctx: any): GameSession => {
      const raw = createCoreBattlePresetState();
      const setup = MatchSetupCoordinator.setupMatch(raw);
      return new GameSession(setup.state, rulePackage);
    };
  };

  it("1. Initializes MillionMatchWorkerPool and executes a seat-swapped pair task", async () => {
    const synthChampions = createSyntheticTestChampionsForUnitTest();
    const bundle: SerializedChampionsBundle = {
      gen7DNA: synthChampions.gen7DNA,
      gen7Digest: synthChampions.gen7Digest,
      gen7Source: synthChampions.gen7Source,
      gen5DNA: synthChampions.gen5DNA,
      gen5Digest: synthChampions.gen5Digest,
      gen5Source: synthChampions.gen5Source,
      zeroDNA: synthChampions.zeroDNA,
      zeroDigest: synthChampions.zeroDigest,
    };

    const { matchups } = createStandardMatchupsAndResolver(synthChampions);

    const pool = await MillionMatchWorkerPool.create({
      workersCount: 2,
      regulationId: DEFAULT_REGULATION_ID,
      frameId: DEFAULT_FRAME_ID,
      rulesDir,
      maxDecisionsPerMatch: DEFAULT_DECISION_LIMIT,
      champions: bundle,
    });

    const pairIndex = 0;
    const matchSeed = 100_000_001;
    const task: WorkerPairTask = {
      taskId: "test-task-p0",
      campaignId: "test-pool-smoke",
      workId: "BP-SIM-AI-V92-WORK4-PARALLEL-BENCHMARK-R1",
      pairIndex,
      matchSeed,
      playerSeeds: {
        p1: derivePlayerSeed(matchSeed, "p1"),
        p2: derivePlayerSeed(matchSeed, "p2"),
      },
      matchup: matchups[0],
      maxDecisionsPerMatch: DEFAULT_DECISION_LIMIT,
    };

    const result = await pool.executePairTask(task);
    expect(result.pairIndex).toBe(0);
    expect(result.leg0Result.outcomeRecord.legIndex).toBe(0);
    expect(result.leg1Result.outcomeRecord.legIndex).toBe(1);
    expect(result.leg0Result.outcomeRecord.status).toBe("COMPLETED");
    expect(result.leg1Result.outcomeRecord.status).toBe("COMPLETED");
    expect(result.leg0Result.outcomeRecord.winner).toBeDefined();
    expect(result.leg1Result.outcomeRecord.winner).toBeDefined();

    await pool.terminate();
  }, 60_000);

  it("2. Verifies strict deterministic invariance across Inline, Workers 1, Workers 2, and Workers 4", async () => {
    const synthChampions = createSyntheticTestChampionsForUnitTest();
    const bundle: SerializedChampionsBundle = {
      gen7DNA: synthChampions.gen7DNA,
      gen7Digest: synthChampions.gen7Digest,
      gen7Source: synthChampions.gen7Source,
      gen5DNA: synthChampions.gen5DNA,
      gen5Digest: synthChampions.gen5Digest,
      gen5Source: synthChampions.gen5Source,
      zeroDNA: synthChampions.zeroDNA,
      zeroDigest: synthChampions.zeroDigest,
    };

    const { matchups, championAuthenticity, policyResolver } =
      createStandardMatchupsAndResolver(synthChampions);
    const sessionFactory = await prepareOfficialSessionFactory(DEFAULT_REGULATION_ID);

    const campaignSeed = 20261107;
    const totalMatches = 4; // 2 pairs
    const chunkSize = 2; // 2 chunks

    const runWithWorkerConfig = async (
      label: string,
      workersCount?: 1 | 2 | 4 | 8
    ) => {
      const outputDir = path.join(tmpRoot, `cmp-invariance-${label}`);
      fs.rmSync(outputDir, { recursive: true, force: true });

      const res = await MillionMatchCampaignEngine.runCampaign({
        workId: "BP-SIM-AI-V92-WORK4-PARALLEL-BENCHMARK-R1",
        campaignId: "cmp-invariance-fixed",
        purpose: "QUALITY_AUDIT",
        stage: "CUSTOM_PILOT",
        executionMode: "PILOT",
        totalPlannedMatches: totalMatches,
        campaignSeed,
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
        chunkSizeMatches: chunkSize,
        maxDecisionsPerMatch: DEFAULT_DECISION_LIMIT,
        workersCount,
        championsBundleForWorker: bundle,
        rulesDirForWorker: rulesDir,
        gitCommitSha: "test-sha-parallel",
        isGitClean: true,
      });

      return {
        outputDir,
        checkpoint: res.checkpointState,
        evidence: res.evidence,
      };
    };

    const inlineRes = await runWithWorkerConfig("inline", undefined);
    const w4Res = await runWithWorkerConfig("w4", 4);

    // 全ての実行で completedMatchesCount が完全一致
    expect(inlineRes.checkpoint.completedMatchesCount).toBe(totalMatches);
    expect(w4Res.checkpoint.completedMatchesCount).toBe(totalMatches);

    // Logical Result Digest が完全一致
    const inlineDigest = inlineRes.evidence.logicalResultDigest;
    expect(w4Res.evidence.logicalResultDigest).toBe(inlineDigest);

    // チャンク数と各チャンクの SHA-256 が完全一致
    expect(w4Res.checkpoint.completedChunks.length).toBe(inlineRes.checkpoint.completedChunks.length);
    for (let c = 0; c < inlineRes.checkpoint.completedChunks.length; c++) {
      const expectedSha = inlineRes.checkpoint.completedChunks[c].sha256;
      expect(w4Res.checkpoint.completedChunks[c].sha256).toBe(expectedSha);
    }

    savedW4Evidence = w4Res.evidence;
    savedW4Checkpoint = w4Res.checkpoint;
  }, 180_000);

  it("3. Verifies multi-stage resume with changed worker count (1 Worker pause -> 4 Workers resume)", async () => {
    const synthChampions = createSyntheticTestChampionsForUnitTest();
    const bundle: SerializedChampionsBundle = {
      gen7DNA: synthChampions.gen7DNA,
      gen7Digest: synthChampions.gen7Digest,
      gen7Source: synthChampions.gen7Source,
      gen5DNA: synthChampions.gen5DNA,
      gen5Digest: synthChampions.gen5Digest,
      gen5Source: synthChampions.gen5Source,
      zeroDNA: synthChampions.zeroDNA,
      zeroDigest: synthChampions.zeroDigest,
    };

    const { matchups, championAuthenticity, policyResolver } =
      createStandardMatchupsAndResolver(synthChampions);
    const sessionFactory = await prepareOfficialSessionFactory(DEFAULT_REGULATION_ID);

    const campaignSeed = 20261107;
    const totalMatches = 4; // 2 pairs
    const chunkSize = 2;

    // 分割実行: セッション1は 1 Worker で 2 試合 (1 ペア) 実行して停止
    const splitDir = path.join(tmpRoot, "cmp-split-resume");
    fs.rmSync(splitDir, { recursive: true, force: true });
    const session1Res = await MillionMatchCampaignEngine.runCampaign({
      workId: "BP-SIM-AI-V92-WORK4-PARALLEL-BENCHMARK-R1",
      campaignId: "cmp-invariance-fixed",
      purpose: "QUALITY_AUDIT",
      stage: "CUSTOM_PILOT",
      executionMode: "PILOT",
      totalPlannedMatches: totalMatches,
      campaignSeed,
      regulationId: DEFAULT_REGULATION_ID,
      frameId: DEFAULT_FRAME_ID,
      rulePackageVersion: DEFAULT_RULE_PACKAGE_VERSION,
      featureSchemaVersion: DEFAULT_FEATURE_SCHEMA_VERSION,
      rulePackage,
      matchups,
      championAuthenticity,
      policyResolver,
      sessionFactory,
      outputDir: splitDir,
      chunkSizeMatches: chunkSize,
      maxDecisionsPerMatch: DEFAULT_DECISION_LIMIT,
      sessionMatchLimit: 2, // 2試合で停止
      workersCount: 1, // 1 Worker
      championsBundleForWorker: bundle,
      rulesDirForWorker: rulesDir,
      gitCommitSha: "test-sha-parallel",
      isGitClean: true,
    });
    expect(session1Res.checkpointState.completedMatchesCount).toBe(2);

    // セッション2: 4 Workers に変更して Resume
    const session2Res = await MillionMatchCampaignEngine.runCampaign({
      workId: "BP-SIM-AI-V92-WORK4-PARALLEL-BENCHMARK-R1",
      campaignId: "cmp-invariance-fixed",
      purpose: "QUALITY_AUDIT",
      stage: "CUSTOM_PILOT",
      executionMode: "RESUME",
      totalPlannedMatches: totalMatches,
      campaignSeed,
      regulationId: DEFAULT_REGULATION_ID,
      frameId: DEFAULT_FRAME_ID,
      rulePackageVersion: DEFAULT_RULE_PACKAGE_VERSION,
      featureSchemaVersion: DEFAULT_FEATURE_SCHEMA_VERSION,
      rulePackage,
      matchups,
      championAuthenticity,
      policyResolver,
      sessionFactory,
      outputDir: splitDir,
      chunkSizeMatches: chunkSize,
      maxDecisionsPerMatch: DEFAULT_DECISION_LIMIT,
      workersCount: 4, // 4 Workers で Resume
      championsBundleForWorker: bundle,
      rulesDirForWorker: rulesDir,
      gitCommitSha: "test-sha-parallel",
      isGitClean: true,
    });
    expect(session2Res.checkpointState.completedMatchesCount).toBe(totalMatches);

    // 最終 Logical Result Digest および チャンク SHA-256 が連続実行 (テスト2の w4 成果物) と完全一致
    expect(session2Res.evidence.logicalResultDigest).toBe(savedW4Evidence!.logicalResultDigest);
    expect(session2Res.checkpointState.completedMatchesCount).toBe(savedW4Checkpoint!.completedMatchesCount);
    for (let c = 0; c < savedW4Checkpoint!.completedChunks.length; c++) {
      expect(session2Res.checkpointState.completedChunks[c].sha256).toBe(
        savedW4Checkpoint!.completedChunks[c].sha256
      );
    }
  }, 180_000);

  it("4. Fails closed when invalid workersCount or corrupted DNA bundle is provided", async () => {
    const synthChampions = createSyntheticTestChampionsForUnitTest();
    const bundle: SerializedChampionsBundle = {
      gen7DNA: synthChampions.gen7DNA,
      gen7Digest: synthChampions.gen7Digest,
      gen7Source: synthChampions.gen7Source,
      gen5DNA: synthChampions.gen5DNA,
      gen5Digest: synthChampions.gen5Digest,
      gen5Source: synthChampions.gen5Source,
      zeroDNA: synthChampions.zeroDNA,
      zeroDigest: synthChampions.zeroDigest,
    };

    // 4a: 不正な workersCount (例: 3)
    await expect(
      MillionMatchWorkerPool.create({
        workersCount: 3 as any,
        regulationId: DEFAULT_REGULATION_ID,
        frameId: DEFAULT_FRAME_ID,
        rulesDir,
        maxDecisionsPerMatch: DEFAULT_DECISION_LIMIT,
        champions: bundle,
      })
    ).rejects.toThrow("Invalid workersCount: 3");

    // 4b: DNA 改ざん (Digest 不一致)
    const corruptedBundle: SerializedChampionsBundle = {
      ...bundle,
      gen7Digest: "corrupted_digest_00000000000000000000000000000000000000000000000000",
    };
    await expect(
      MillionMatchWorkerPool.create({
        workersCount: 1,
        regulationId: DEFAULT_REGULATION_ID,
        frameId: DEFAULT_FRAME_ID,
        rulesDir,
        maxDecisionsPerMatch: DEFAULT_DECISION_LIMIT,
        champions: corruptedBundle,
      })
    ).rejects.toThrow("Gen 7 DNA Digest mismatch");
  }, 60_000);
});
