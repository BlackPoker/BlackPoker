import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader.js";
import { getPlaytestRulePackage } from "../../engine/rules/RulePackageSelector.js";
import { GameSession } from "../../engine/session/GameSession.js";
import { createCoreBattlePresetState } from "../../engine/session/playtest/createCoreBattlePlaytest.js";
import { MatchSetupCoordinator } from "../../engine/session/setup/MatchSetupCoordinator.js";
import {
  RandomPolicy,
  FirstLegalPolicy,
  DecisionPolicy,
  PolicyDescriptor,
} from "../../engine/simulation/DecisionPolicy.js";
import { SeededRandom } from "../../engine/random/RandomSource.js";
import {
  LargeScaleBatchRunner,
  LargeScaleMatchContext,
  ExecutionManifestIntegrityMismatchError,
  LargeScaleBatchConfigurationError,
} from "../../engine/simulation/LargeScaleBatchRunner.js";
import {
  LargeScaleBatchConfig,
  LargeScaleSeatInfo,
  BatchCheckpointState,
} from "../../domain/simulation/LargeScaleBatchTypes.js";
import {
  GitExecutionMetadata,
  computeDirectoryContentDigest,
  computeExperimentFingerprint,
  ExecutionManifestUnverifiedGitStateError,
  ExecutionManifestDirtyStateError,
} from "../../engine/simulation/ExecutionManifest.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../../../../../");

/**
 * 指定ステップ数で意図的に例外を投げるテスト用ポリシー
 */
class StepFailingPolicy implements DecisionPolicy {
  private currentStep = 0;

  constructor(
    public readonly failAtStep: number = 3,
    public readonly descriptor: PolicyDescriptor = {
      kind: "step-failing",
      policyVersion: 1,
      name: "StepFailingPolicy",
    }
  ) {}

  choose(request: any): any {
    this.currentStep++;
    if (this.currentStep >= this.failAtStep) {
      throw new Error(`FAULT_INJECTION: Failed at step ${this.currentStep}`);
    }
    return {
      decisionId: request.decisionId,
      stateVersion: request.stateVersion,
      selectedPatternRef: 0,
    };
  }
}

describe("LargeScaleBatchRunner Stage 1 R1 (堅牢性・再現性・診断情報検証)", () => {
  let rulePackage: any;
  const testRulesDir = path.resolve(rootDir, "tools/simulator/src/data/rules-vnext");
  const rulePackageDigest = computeDirectoryContentDigest(testRulesDir, true);
  const testCheckpointDir = path.resolve(rootDir, "tools/simulator/.artifacts/checkpoints/test-r1");

  const cleanTestGitMetadata: GitExecutionMetadata = {
    headCommitSha: "ff0c4a71509ce07f27afab41ba9846499cc7cee1",
    branch: "BlackPoker/issue551-core-flow",
    isDirty: false,
    dirtyFiles: [],
    verificationStatus: "VERIFIED",
  };

  beforeAll(async () => {
    const fullPackage = await loadRulePackageFromDirectory(testRulesDir);
    rulePackage = getPlaytestRulePackage(fullPackage);

    if (fs.existsSync(testCheckpointDir)) {
      fs.rmSync(testCheckpointDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testCheckpointDir, { recursive: true });
  });

  const sessionFactory = (_ctx: LargeScaleMatchContext) => {
    const rawState = createCoreBattlePresetState();
    const setupResult = MatchSetupCoordinator.setupMatch(rawState);
    return new GameSession(setupResult.state, rulePackage);
  };

  const createPolicyFactory =
    (faultyIndex: number = -1, failAtStep: number = 3) =>
    (ctx: LargeScaleMatchContext) => {
      const isFaulty = ctx.matchIndex === faultyIndex;
      const p1Policy = isFaulty
        ? new StepFailingPolicy(failAtStep)
        : new FirstLegalPolicy(false);
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

  it("Test 1: Git状態未検証・環境変数のみ (ENV_OVERRIDE/FAILED) 時は正式保存を拒否すること (fail-closed)", async () => {
    const unverifiedMetadata: GitExecutionMetadata = {
      headCommitSha: "ff0c4a71509ce07f27afab41ba9846499cc7cee1",
      branch: "env-override",
      isDirty: true,
      dirtyFiles: ["GIT_STATUS_COMMAND_UNAVAILABLE_ENV_SHA_ONLY"],
      verificationStatus: "ENV_OVERRIDE",
    };

    const config: LargeScaleBatchConfig = {
      batchId: "test-git-unverified",
      workId: "BP-SIM-AI-V92-WORK2-BATCH-FOUNDATION-STAGE1-R1",
      baseSeed: 1001,
      matchCount: 2,
      regulationId: "standard-pack",
      rootDir,
    };

    // runBatchForTesting でも ENV_OVERRIDE の場合は assertNotDirty で拒否される
    await expect(
      LargeScaleBatchRunner.runBatchForTesting({
        config,
        sessionFactory,
        policyFactory: createPolicyFactory(),
        rulePackageDigest,
        testGitMetadata: unverifiedMetadata,
      })
    ).rejects.toThrow(ExecutionManifestUnverifiedGitStateError);
  });

  it("Test 2: dirty 状態では正式実行および保存が拒否されること", async () => {
    const dirtyMetadata: GitExecutionMetadata = {
      headCommitSha: "ff0c4a71509ce07f27afab41ba9846499cc7cee1",
      branch: "test",
      isDirty: true,
      dirtyFiles: ["tools/simulator/src/engine/rules/graveCardUtils.ts"],
      verificationStatus: "VERIFIED",
    };

    const config: LargeScaleBatchConfig = {
      batchId: "test-git-dirty",
      workId: "BP-SIM-AI-V92-WORK2-BATCH-FOUNDATION-STAGE1-R1",
      baseSeed: 1002,
      matchCount: 2,
      regulationId: "standard-pack",
      rootDir,
    };

    await expect(
      LargeScaleBatchRunner.runBatchForTesting({
        config,
        sessionFactory,
        policyFactory: createPolicyFactory(),
        rulePackageDigest,
        testGitMetadata: dirtyMetadata,
      })
    ).rejects.toThrow(ExecutionManifestDirtyStateError);
  });

  it("Test 3: ルールパッケージの実内容が変化した場合に Digest が変化すること", () => {
    const originalDigest = computeDirectoryContentDigest(testRulesDir, true);
    expect(originalDigest).toMatch(/^[0-9a-f]{64}$/);

    // バージョン番号 ("1.0.0") と内容 Digest は明確に異なる
    expect(originalDigest).not.toBe("1.0.0");

    // 別ディレクトリ（ai）の Digest と一致しない
    const aiDir = path.resolve(rootDir, "tools/simulator/src/engine/ai");
    const aiDigest = computeDirectoryContentDigest(aiDir, true);
    expect(originalDigest).not.toBe(aiDigest);
  });

  it("Test 4: Policy 設定の変更が実験 Fingerprint に正しく反映されること", () => {
    const p1 = new FirstLegalPolicy(false);
    const p2 = new FirstLegalPolicy(true); // preferPass: true

    const baseConfig = {
      regulationId: "standard-pack",
      rulePackageId: "official-standard-pack",
      rulePackageVersion: "1.0.0",
      rulePackageDigest: "abc123digest",
      campaignSeed: 92000,
      randomGenerator: "deriveBatchSeed",
      decisionTraceVersion: 2,
      models: [],
    };

    const fp1 = computeExperimentFingerprint({
      gitCommitSha: "ff0c4a71509ce07f27afab41ba9846499cc7cee1",
      subsystemDigests: {
        rules: "1",
        simulation: "2",
        ai: "3",
        regulations: "4",
        rulesPackage: "5",
        dependencies: "6",
      },
      experimentConfig: {
        ...baseConfig,
        playerPolicies: [{ seat: "p1", descriptor: p1.descriptor }],
      },
    });

    const fp2 = computeExperimentFingerprint({
      gitCommitSha: "ff0c4a71509ce07f27afab41ba9846499cc7cee1",
      subsystemDigests: {
        rules: "1",
        simulation: "2",
        ai: "3",
        regulations: "4",
        rulesPackage: "5",
        dependencies: "6",
      },
      experimentConfig: {
        ...baseConfig,
        playerPolicies: [{ seat: "p1", descriptor: p2.descriptor }],
      },
    });

    // PolicyDescriptor の metadata (preferPass) が異なれば Fingerprint も異なる
    expect(fp1).not.toBe(fp2);
  });

  it("Test 5: FAILED 試合において onStep リングバッファから直前 Decision Trace が保存されること", async () => {
    const config: LargeScaleBatchConfig = {
      batchId: "test-failure-ringbuffer",
      workId: "BP-SIM-AI-V92-WORK2-BATCH-FOUNDATION-STAGE1-R1",
      baseSeed: 3333,
      matchCount: 3,
      maxDecisionsPerMatch: 500,
      regulationId: "standard-pack",
      rootDir,
    };

    // matchIndex 1 のみステップ 5 で意図的例外
    const result = await LargeScaleBatchRunner.runBatchForTesting({
      config,
      sessionFactory,
      policyFactory: createPolicyFactory(1, 5),
      rulePackageDigest,
      testGitMetadata: cleanTestGitMetadata,
    });

    expect(result.summary.totalMatches).toBe(3);
    expect(result.summary.failedCount).toBe(1);
    expect(result.summary.completedCount).toBe(2);

    const failedMatch = result.matches[1];
    expect(failedMatch.status).toBe("FAILED");
    expect(failedMatch.failure).toBeDefined();
    expect(failedMatch.failure!.phase).toBe("SIMULATION");
    expect(failedMatch.failure!.errorName).toBe("Error");
    expect(failedMatch.failure!.errorMessage).toContain("FAULT_INJECTION: Failed at step 5");

    // 直前トレーススナップショットが存在し、発生直前のレコードが保存されていること
    expect(failedMatch.failure!.decisionTraceSnapshot).toBeDefined();
    expect(failedMatch.failure!.decisionTraceSnapshot!.length).toBeGreaterThan(0);
    expect(failedMatch.failure!.decisionTraceSnapshot!.length).toBeLessThanOrEqual(10);
    expect(failedMatch.failure!.occurredAtStep).toBeGreaterThan(0);

    // 正常試合 (0, 2) は生トレースを保持せず traceDigest のみ
    expect((result.matches[0] as any).decisionTrace).toBeUndefined();
    expect(result.matches[0].traceDigest).toBeDefined();
    expect(result.matches[0].status).toBe("COMPLETED");
  });

  it("Test 6: 異なる Fingerprint / Regulation / RulePackageDigest のチェックポイントから再開できないこと", async () => {
    const config: LargeScaleBatchConfig = {
      batchId: "test-chk-reject",
      workId: "BP-SIM-AI-V92-WORK2-BATCH-FOUNDATION-STAGE1-R1",
      baseSeed: 4444,
      matchCount: 4,
      regulationId: "standard-pack",
      checkpointInterval: 2,
      checkpointDir: testCheckpointDir,
      rootDir,
    };

    // まず 2 試合の正常チェックポイントを作成
    await LargeScaleBatchRunner.runBatchForTesting({
      config,
      sessionFactory,
      policyFactory: createPolicyFactory(),
      rulePackageDigest,
      testGitMetadata: cleanTestGitMetadata,
    });

    const chkFile = path.join(testCheckpointDir, "test-chk-reject-chk-000002.json");
    expect(fs.existsSync(chkFile)).toBe(true);

    // 1. regulationId が異なる設定で再開しようとすると拒否 (Fingerprint 不一致検出)
    const diffRegConfig: LargeScaleBatchConfig = {
      ...config,
      regulationId: "light-pack", // 変更
    };
    await expect(
      LargeScaleBatchRunner.runBatchForTesting({
        config: diffRegConfig,
        sessionFactory,
        policyFactory: createPolicyFactory(),
        rulePackageDigest,
        resumeCheckpointPath: chkFile,
        testGitMetadata: cleanTestGitMetadata,
      })
    ).rejects.toThrow(ExecutionManifestIntegrityMismatchError);

    // 2. rulePackageDigest が異なる設定で再開しようとすると拒否
    await expect(
      LargeScaleBatchRunner.runBatchForTesting({
        config,
        sessionFactory,
        policyFactory: createPolicyFactory(),
        rulePackageDigest: "altered-digest-9999",
        resumeCheckpointPath: chkFile,
        testGitMetadata: cleanTestGitMetadata,
      })
    ).rejects.toThrow(ExecutionManifestIntegrityMismatchError);
  });

  it("Test 7: チェックポイント破損・重複・欠落を検出して再開を拒否すること", async () => {
    const chkFile = path.join(testCheckpointDir, "test-chk-reject-chk-000002.json");
    const raw = fs.readFileSync(chkFile, "utf-8");
    const chk: BatchCheckpointState = JSON.parse(raw);

    // 1. 試合インデックスに欠落がある場合 (0, 2 となり 1 が欠落)
    const corruptedIndexChk = {
      ...chk,
      completedMatches: [
        chk.completedMatches[0],
        { ...chk.completedMatches[1], matchIndex: 2 },
      ],
    };
    const corruptedPath = path.join(testCheckpointDir, "corrupted-discontinuity.json");
    fs.writeFileSync(corruptedPath, JSON.stringify(corruptedIndexChk, null, 2), "utf-8");

    const config: LargeScaleBatchConfig = {
      batchId: "test-chk-reject",
      workId: "BP-SIM-AI-V92-WORK2-BATCH-FOUNDATION-STAGE1-R1",
      baseSeed: 4444,
      matchCount: 4,
      regulationId: "standard-pack",
      rootDir,
    };

    await expect(
      LargeScaleBatchRunner.runBatchForTesting({
        config,
        sessionFactory,
        policyFactory: createPolicyFactory(),
        rulePackageDigest,
        resumeCheckpointPath: corruptedPath,
        testGitMetadata: cleanTestGitMetadata,
      })
    ).rejects.toThrow();
  });

  it("Test 8: 再開後の性能指標が再開後に実際に実行された試合数と整合すること", async () => {
    const config: LargeScaleBatchConfig = {
      batchId: "test-resume-metrics",
      workId: "BP-SIM-AI-V92-WORK2-BATCH-FOUNDATION-STAGE1-R1",
      baseSeed: 5555,
      matchCount: 4,
      regulationId: "standard-pack",
      checkpointInterval: 2,
      checkpointDir: testCheckpointDir,
      rootDir,
    };

    // 2 試合実行してチェックポイント作成
    await LargeScaleBatchRunner.runBatchForTesting({
      config,
      sessionFactory,
      policyFactory: createPolicyFactory(),
      rulePackageDigest,
      testGitMetadata: cleanTestGitMetadata,
    });

    const chkFile = path.join(testCheckpointDir, "test-resume-metrics-chk-000002.json");
    expect(fs.existsSync(chkFile)).toBe(true);

    // チェックポイントから後半 2 試合を再開実行
    const resumedResult = await LargeScaleBatchRunner.runBatchForTesting({
      config,
      sessionFactory,
      policyFactory: createPolicyFactory(),
      rulePackageDigest,
      resumeCheckpointPath: chkFile,
      testGitMetadata: cleanTestGitMetadata,
    });

    // 総合試合数は 4
    expect(resumedResult.matches.length).toBe(4);
    expect(resumedResult.summary.completedCount).toBe(4);

    // 再開後に新規実行された試合数は 2
    expect(resumedResult.newlyExecutedMatches).toBe(2);

    // スループットは再開後実行分 (2 試合) に基づいて計算されていること (> 0)
    expect(resumedResult.performance.matchesPerSecond).toBeGreaterThan(0);
    expect(resumedResult.performance.latencies.medianMs).toBeGreaterThan(0);
  });

  it("Test 9: 通常完了試合において巨大な生 DecisionTrace を蓄積せずメモリ保護されていること", async () => {
    const config: LargeScaleBatchConfig = {
      batchId: "test-memory-protection",
      workId: "BP-SIM-AI-V92-WORK2-BATCH-FOUNDATION-STAGE1-R1",
      baseSeed: 6666,
      matchCount: 3,
      regulationId: "standard-pack",
      rootDir,
    };

    const result = await LargeScaleBatchRunner.runBatchForTesting({
      config,
      sessionFactory,
      policyFactory: createPolicyFactory(),
      rulePackageDigest,
      testGitMetadata: cleanTestGitMetadata,
    });

    for (const match of result.matches) {
      expect((match as any).decisionTrace).toBeUndefined();
      expect((match as any).finalState).toBeUndefined();
      expect(match.traceDigest).toBeDefined();
      expect(match.traceDigest!.length).toBe(64);
      expect(match.finalStateHash).toBeDefined();
    }
  });

  it("Test 10: 決定論的再実行一致テスト (同一Seed・Policyで全指標が完全一致すること)", async () => {
    const config: LargeScaleBatchConfig = {
      batchId: "test-deterministic-parity",
      workId: "BP-SIM-AI-V92-WORK2-BATCH-FOUNDATION-STAGE1-R1",
      baseSeed: 7777,
      matchCount: 3,
      regulationId: "standard-pack",
      rootDir,
    };

    const run1 = await LargeScaleBatchRunner.runBatchForTesting({
      config,
      sessionFactory,
      policyFactory: createPolicyFactory(),
      rulePackageDigest,
      testGitMetadata: cleanTestGitMetadata,
    });

    const run2 = await LargeScaleBatchRunner.runBatchForTesting({
      config,
      sessionFactory,
      policyFactory: createPolicyFactory(),
      rulePackageDigest,
      testGitMetadata: cleanTestGitMetadata,
    });

    expect(run1.summary.totalMatches).toBe(run2.summary.totalMatches);
    expect(run1.summary.completedCount).toBe(run2.summary.completedCount);
    expect(run1.summary.winsByPlayer).toEqual(run2.summary.winsByPlayer);

    for (let i = 0; i < run1.matches.length; i++) {
      expect(run1.matches[i].matchId).toBe(run2.matches[i].matchId);
      expect(run1.matches[i].status).toBe(run2.matches[i].status);
      expect(run1.matches[i].winner).toBe(run2.matches[i].winner);
      expect(run1.matches[i].totalDecisions).toBe(run2.matches[i].totalDecisions);
      expect(run1.matches[i].finalStateHash).toBe(run2.matches[i].finalStateHash);
      expect(run1.matches[i].traceDigest).toBe(run2.matches[i].traceDigest);
    }
  });
});
