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
  DecisionPolicy,
  PolicyDescriptor,
} from "../../engine/simulation/DecisionPolicy.js";
import { SeededRandom } from "../../engine/random/RandomSource.js";
import {
  LargeScaleBatchRunner,
  LargeScaleMatchContext,
  ExecutionManifestIntegrityMismatchError,
} from "../../engine/simulation/LargeScaleBatchRunner.js";
import {
  LargeScaleBatchConfig,
  LargeScaleSeatInfo,
} from "../../domain/simulation/LargeScaleBatchTypes.js";
import { GitExecutionMetadata } from "../../engine/simulation/ExecutionManifest.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../../../../../");

/**
 * 意図的に例外を発生させるモックポリシー (Failure Isolation テスト用)
 */
class FaultyPolicy implements DecisionPolicy {
  readonly descriptor: PolicyDescriptor = {
    kind: "faulty",
    policyVersion: 1,
    name: "FaultyPolicy",
  };

  choose(): any {
    throw new Error("FAULT_INJECTION: Intentional policy failure during simulation");
  }
}

describe("LargeScaleBatchRunner (大規模自動対戦基盤 第1段階)", () => {
  let rulePackage: any;
  const rulePackageDigest = "dummy-rule-pkg-digest-12345";
  const testCheckpointDir = path.resolve(rootDir, "tools/simulator/.artifacts/checkpoints/test");

  beforeAll(async () => {
    const rulesDir = path.resolve(rootDir, "tools/simulator/src/data/rules-vnext");
    const fullPackage = await loadRulePackageFromDirectory(rulesDir);
    rulePackage = getPlaytestRulePackage(fullPackage);

    if (fs.existsSync(testCheckpointDir)) {
      fs.rmSync(testCheckpointDir, { recursive: true, force: true });
    }
  });

  const dummyGitMetadata: GitExecutionMetadata = {
    headCommitSha: "17b6e967e5987a157bb1aa3ea51e7d148e3c0719",
    branch: "BlackPoker/issue551-core-flow",
    isDirty: false,
    dirtyFiles: [],
    verificationStatus: "VERIFIED",
  };

  const sessionFactory = (_ctx: LargeScaleMatchContext) => {
    const rawState = createCoreBattlePresetState();
    const setupResult = MatchSetupCoordinator.setupMatch(rawState);
    return new GameSession(setupResult.state, rulePackage);
  };

  const createPolicyFactory =
    (faultyIndex: number = -1) =>
    (ctx: LargeScaleMatchContext) => {
      const isFaulty = ctx.matchIndex === faultyIndex;
      const p1Policy = isFaulty
        ? new FaultyPolicy()
        : new RandomPolicy(new SeededRandom(ctx.playerSeeds.p1), "RandomAI-P1");
      const p2Policy = new RandomPolicy(new SeededRandom(ctx.playerSeeds.p2), "RandomAI-P2");

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

  it("Test 1: 決定論的再実行一致テスト (同一Seed・Policyで全指標が完全一致すること)", async () => {
    const config: LargeScaleBatchConfig = {
      batchId: "test-deterministic",
      workId: "BP-SIM-AI-V92-WORK2-BATCH-FOUNDATION-STAGE1",
      baseSeed: 8888,
      matchCount: 5,
      maxDecisionsPerMatch: 100,
      regulationId: "test-core-battle",
      rootDir,
      overrideGitMetadata: dummyGitMetadata,
    };

    const run1 = await LargeScaleBatchRunner.runBatch({
      config,
      sessionFactory,
      policyFactory: createPolicyFactory(),
      rulePackageDigest,
    });

    const run2 = await LargeScaleBatchRunner.runBatch({
      config,
      sessionFactory,
      policyFactory: createPolicyFactory(),
      rulePackageDigest,
    });

    // 1. サマリーの完全一致
    expect(run1.summary.totalMatches).toBe(run2.summary.totalMatches);
    expect(run1.summary.completedCount).toBe(run2.summary.completedCount);
    expect(run1.summary.incompleteCount).toBe(run2.summary.incompleteCount);
    expect(run1.summary.failedCount).toBe(run2.summary.failedCount);
    expect(run1.summary.winsByPlayer).toEqual(run2.summary.winsByPlayer);

    // 2. 各試合の決定論的指標の一致
    expect(run1.matches.length).toBe(run2.matches.length);
    for (let i = 0; i < run1.matches.length; i++) {
      const m1 = run1.matches[i];
      const m2 = run2.matches[i];

      expect(m1.matchId).toBe(m2.matchId);
      expect(m1.status).toBe(m2.status);
      expect(m1.completed).toBe(m2.completed);
      expect(m1.winner).toBe(m2.winner);
      expect(m1.totalDecisions).toBe(m2.totalDecisions);
      expect(m1.turnCount).toBe(m2.turnCount);
      expect(m1.finalStateHash).toBe(m2.finalStateHash);
      expect(m1.traceDigest).toBe(m2.traceDigest);
      expect(m1.traceDigest).not.toBe("");
    }
  });

  it("Test 2: メモリ保護契約テスト (通常完了試合で生の DecisionTrace を保持しないこと)", async () => {
    const config: LargeScaleBatchConfig = {
      batchId: "test-memory-guard",
      workId: "BP-SIM-AI-V92-WORK2-BATCH-FOUNDATION-STAGE1",
      baseSeed: 9999,
      matchCount: 3,
      maxDecisionsPerMatch: 50,
      regulationId: "test-core-battle",
      rootDir,
      overrideGitMetadata: dummyGitMetadata,
    };

    const result = await LargeScaleBatchRunner.runBatch({
      config,
      sessionFactory,
      policyFactory: createPolicyFactory(),
      rulePackageDigest,
    });

    expect(result.matches.length).toBe(3);
    for (const match of result.matches) {
      // 生の decisionTrace や finalState が含まれていないことをアサート
      expect((match as any).decisionTrace).toBeUndefined();
      expect((match as any).finalState).toBeUndefined();
      expect((match as any).matchLog).toBeUndefined();

      // 代わりに traceDigest が記録されていること
      expect(match.traceDigest).toBeDefined();
      expect(typeof match.traceDigest).toBe("string");
      expect(match.traceDigest!.length).toBe(64); // SHA-256
    }
  });

  it("Test 3: 障害分離テスト (特定試合での例外発生時もバッチ全体が中断されず FAILED として隔離・詳細保存されること)", async () => {
    const config: LargeScaleBatchConfig = {
      batchId: "test-failure-isolation",
      workId: "BP-SIM-AI-V92-WORK2-BATCH-FOUNDATION-STAGE1",
      baseSeed: 1234,
      matchCount: 4,
      maxDecisionsPerMatch: 500, // 決着がつく十分な回数
      regulationId: "test-core-battle",
      rootDir,
      overrideGitMetadata: dummyGitMetadata,
    };

    // matchIndex 2 のみ FaultyPolicy を投入
    const result = await LargeScaleBatchRunner.runBatch({
      config,
      sessionFactory,
      policyFactory: createPolicyFactory(2),
      rulePackageDigest,
    });

    expect(result.summary.totalMatches).toBe(4);
    expect(result.summary.failedCount).toBe(1);
    expect(result.summary.completedCount).toBe(3);

    const failedMatch = result.matches[2];
    expect(failedMatch.status).toBe("FAILED");
    expect(failedMatch.completed).toBe(false);
    expect(failedMatch.failure).toBeDefined();
    expect(failedMatch.failure!.phase).toBe("SIMULATION");
    expect(failedMatch.failure!.errorMessage).toContain("FAULT_INJECTION");

    // 他の試合 (0, 1, 3) は正常完了
    expect(result.matches[0].status).toBe("COMPLETED");
    expect(result.matches[1].status).toBe("COMPLETED");
    expect(result.matches[3].status).toBe("COMPLETED");

    // 障害情報が failures リストにも集約されていること
    expect(result.failures.length).toBe(1);
    expect(result.failures[0].matchIndex).toBe(2);
  });

  it("Test 4: 中断・再開 (チェックポイント) 整合性テスト (再開時に重複や欠落がなく一括実行と一致すること)", async () => {
    const batchId = "test-resume-checkpoint";
    const config: LargeScaleBatchConfig = {
      batchId,
      workId: "BP-SIM-AI-V92-WORK2-BATCH-FOUNDATION-STAGE1",
      baseSeed: 7777,
      matchCount: 6,
      maxDecisionsPerMatch: 50,
      regulationId: "test-core-battle",
      checkpointInterval: 3, // 3試合ごとに保存
      checkpointDir: testCheckpointDir,
      rootDir,
      overrideGitMetadata: dummyGitMetadata,
    };

    // 1. 最初から全6試合を一括実行 (期待値)
    const goldenRun = await LargeScaleBatchRunner.runBatch({
      config,
      sessionFactory,
      policyFactory: createPolicyFactory(),
      rulePackageDigest,
    });

    const chkFile3 = path.join(testCheckpointDir, `${batchId}-chk-000003.json`);
    expect(fs.existsSync(chkFile3)).toBe(true);

    // 2. 3試合目のチェックポイントから再開実行
    const resumedRun = await LargeScaleBatchRunner.runBatch({
      config,
      sessionFactory,
      policyFactory: createPolicyFactory(),
      rulePackageDigest,
      resumeCheckpointPath: chkFile3,
    });

    expect(resumedRun.matches.length).toBe(6);
    expect(resumedRun.summary.completedCount).toBe(goldenRun.summary.completedCount);

    // 全試合の ID, status, winner, traceDigest が一括実行と完全一致
    for (let i = 0; i < 6; i++) {
      expect(resumedRun.matches[i].matchId).toBe(goldenRun.matches[i].matchId);
      expect(resumedRun.matches[i].status).toBe(goldenRun.matches[i].status);
      expect(resumedRun.matches[i].winner).toBe(goldenRun.matches[i].winner);
      expect(resumedRun.matches[i].finalStateHash).toBe(goldenRun.matches[i].finalStateHash);
      expect(resumedRun.matches[i].traceDigest).toBe(goldenRun.matches[i].traceDigest);
    }
  });

  it("Test 5: 正式 Evidence 保存と Execution Manifest 整合性検証", async () => {
    const config: LargeScaleBatchConfig = {
      batchId: "test-evidence-save",
      workId: "BP-SIM-AI-V92-WORK2-BATCH-FOUNDATION-STAGE1",
      baseSeed: 5555,
      matchCount: 2,
      maxDecisionsPerMatch: 500, // 決着がつく十分な回数
      regulationId: "test-core-battle",
      rootDir,
      overrideGitMetadata: dummyGitMetadata,
    };

    const run = await LargeScaleBatchRunner.runBatch({
      config,
      sessionFactory,
      policyFactory: createPolicyFactory(),
      rulePackageDigest,
    });

    const tmpEvidencePath = path.resolve(
      rootDir,
      "tools/simulator/reports/ai/tmp-batch-test-evidence.json"
    );

    // 正式保存
    expect(() => run.saveEvidence(tmpEvidencePath)).not.toThrow();
    expect(fs.existsSync(tmpEvidencePath)).toBe(true);

    const saved = JSON.parse(fs.readFileSync(tmpEvidencePath, "utf-8"));
    expect(saved.workId).toBe("BP-SIM-AI-V92-WORK2-BATCH-FOUNDATION-STAGE1");
    expect(saved.executionManifest).toBeDefined();
    expect(saved.executionManifest.gitMetadata.verificationStatus).toBe("VERIFIED");
    expect(saved.summary.completedCount).toBe(2);
    expect(saved.performance.matchesPerSecond).toBeGreaterThan(0);
    expect(saved.performance.estimated10kMatchesDurationHours).toBeGreaterThan(0);

    // クリーンアップ
    fs.unlinkSync(tmpEvidencePath);
  });

  it("Test 6: fail-closed 検証 (Git 検証ステータスが FAILED または dirty の場合は開始時に拒否されること)", async () => {
    const dirtyGitMetadata: GitExecutionMetadata = {
      headCommitSha: "17b6e967e5987a157bb1aa3ea51e7d148e3c0719",
      branch: "BlackPoker/issue551-core-flow",
      isDirty: true,
      dirtyFiles: ["dirty-file.ts"],
      verificationStatus: "VERIFIED",
    };

    const config: LargeScaleBatchConfig = {
      batchId: "test-dirty-reject",
      workId: "BP-SIM-AI-V92-WORK2-BATCH-FOUNDATION-STAGE1",
      baseSeed: 1111,
      matchCount: 2,
      regulationId: "test-core-battle",
      rootDir,
      overrideGitMetadata: dirtyGitMetadata,
    };

    await expect(
      LargeScaleBatchRunner.runBatch({
        config,
        sessionFactory,
        policyFactory: createPolicyFactory(),
        rulePackageDigest,
      })
    ).rejects.toThrow();
  });
});
