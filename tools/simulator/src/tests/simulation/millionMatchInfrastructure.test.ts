/**
 * BlackPoker Work 4-1 — Million Match Simulation Infrastructure 統合検証テスト
 *
 * 【検証項目 (Section 13)】
 * 1. Seed 衝突検出 (Holdout 95001..95030, Validation, Training, 将来予約 Holdout 領域の拒否 & 50万ペア無衝突保証)
 * 2. 目的 A (QUALITY_AUDIT) と 目的 B (AI_EVOLUTION) の Seed 空間・Config Digest 分離
 * 3. 中断からの Resume と 中断なし実行の完全一致 (Logical Result Digest & 全 Chunk SHA-256 一致 + 未確定部分チャンク自動修復)
 * 4. Checkpoint 破損・改ざん検出 (CheckpointIntegrityError)
 * 5. 出力チャンク破損・欠落・行数不一致検出 (ChunkIntegrityError & auditMillionMatchArtifacts)
 * 6. 既存成果物上書き防止 & 10万/100万試合未承認実行ロック (UnauthorizedScaleExecutionError)
 * 7. メモリ非蓄積 (O(1) ストリーミング特性) の確認
 * 8. 異常試合 (膠着疑い STALL_SUSPECTED / 実体化失敗 INSTANTIATION_FAILURE / 例外 UNHANDLED_EXCEPTION) の分離保存と決定論的再現
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { getPlaytestRulePackage } from "../../engine/rules/RulePackageSelector";
import { RulePackage } from "../../domain/rules/RulePackage";
import { GameSession, PatternInstantiationError } from "../../engine/session/GameSession";
import { createCoreBattlePresetState } from "../../engine/session/playtest/createCoreBattlePlaytest";
import { MatchSetupCoordinator } from "../../engine/session/setup/MatchSetupCoordinator";
import { FirstLegalPolicy, RandomPolicy, DecisionPolicy } from "../../engine/simulation/DecisionPolicy";
import { SeededRandom } from "../../engine/random/RandomSource";
import {
  MillionMatchSeedAllocator,
  MillionMatchCampaignEngine,
  assertNoHistoricalOrInternalSeedCollision,
  SeedCollisionDetectedError,
  CheckpointIntegrityError,
  ChunkIntegrityError,
  UnauthorizedScaleExecutionError,
  ConcurrentCampaignLockError,
  FaultInjectionAbortError,
  DEDICATED_SEED_RANGE_SIZE,
  AFFINE_COPRIME_MULTIPLIER,
  QUALITY_AUDIT_SEED_RANGE_START,
  AI_EVOLUTION_SEED_RANGE_START,
  gcdBigInt,
  executeSingleInstrumentedMatch,
  derivePlayerSeed,
} from "../../engine/simulation/MillionMatchCampaignEngine";
import {
  WORK4_WORK_ID,
  validateMillionMatchOutputDir,
  saveMillionMatchArtifacts,
  auditMillionMatchArtifacts,
  parseLargeScaleCliArgs,
} from "../../cli/largeScaleSimulationRunner";
import { MatchupPairingSpec, ParticipantPolicySpec } from "../../domain/simulation/MillionMatchInfraTypes";

describe("BlackPoker Work 4-1 — Million Match Simulation Infrastructure", () => {
  let rulePackage: RulePackage;
  const tmpRoot = path.join(os.tmpdir(), "bp-work4-million-match-infra-test");

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    const fullPkg = await loadRulePackageFromDirectory(rulesDir);
    rulePackage = getPlaytestRulePackage(fullPkg);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(tmpRoot, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  // 高速かつ決定論的な軽量セッションファクトリ (フルルールパッケージ使用)
  const createFastDeterministicSessionFactory = () => {
    return (_ctx: any): GameSession => {
      const raw = createCoreBattlePresetState();
      const setup = MatchSetupCoordinator.setupMatch(raw);
      return new GameSession(setup.state, rulePackage);
    };
  };

  const testMatchups: readonly MatchupPairingSpec[] = [
    {
      matchupId: "test-first-vs-random",
      name: "FirstLegal vs SeededRandom",
      agentA: {
        policyId: "first-legal",
        name: "FirstLegal",
        kind: "FIRST_LEGAL",
        role: "BASELINE",
      },
      agentB: {
        policyId: "seeded-random",
        name: "SeededRandom",
        kind: "SEEDED_RANDOM",
        role: "BASELINE",
      },
      weight: 1,
    },
  ];

  const testPolicyResolver = (
    spec: ParticipantPolicySpec,
    seat: "p1" | "p2",
    _matchSeed: number,
    playerSeed: number
  ): DecisionPolicy => {
    if (spec.policyId === "first-legal") {
      return new FirstLegalPolicy(false);
    }
    return new RandomPolicy(new SeededRandom(playerSeed), `SeededRandom-${seat}`);
  };

  describe("1. Seed 管理・衝突検出・目的間分離", () => {
    it("Holdout Seeds (95001..95030)、Validation Seeds (94001..94015)、将来予約 Holdout 領域との衝突を即座に拒否すること", () => {
      expect(() => assertNoHistoricalOrInternalSeedCollision([100001, 95001])).toThrow(
        SeedCollisionDetectedError
      );
      expect(() => assertNoHistoricalOrInternalSeedCollision([100001, 95030])).toThrow(
        SeedCollisionDetectedError
      );
      expect(() => assertNoHistoricalOrInternalSeedCollision([100001, 94005])).toThrow(
        SeedCollisionDetectedError
      );
      expect(() => assertNoHistoricalOrInternalSeedCollision([100001, 900_000_500])).toThrow(
        SeedCollisionDetectedError
      );
      expect(() => assertNoHistoricalOrInternalSeedCollision([500001, 500001])).toThrow(
        SeedCollisionDetectedError
      );
    });

    it("50万ペア (100万試合) 全件で Seed が一切重複せず、gcd(A, M) = 1・許容範囲・QUALITY_AUDIT / AI_EVOLUTION 空間非重複・既存 Stage 3 全履歴との非衝突を満たすこと", () => {
      // 1. Modulus M = 10_000_000 と ストライド A = 32_452_843 の数学的整合確認
      expect(DEDICATED_SEED_RANGE_SIZE).toBe(10_000_000);
      expect(AFFINE_COPRIME_MULTIPLIER).toBe(32_452_843);
      expect(Number.isSafeInteger(AFFINE_COPRIME_MULTIPLIER)).toBe(true);
      expect(gcdBigInt(BigInt(AFFINE_COPRIME_MULTIPLIER), BigInt(DEDICATED_SEED_RANGE_SIZE))).toBe(1n);

      const allocAudit = new MillionMatchSeedAllocator({
        purpose: "QUALITY_AUDIT",
        campaignSeed: 20261106,
        totalPlannedPairs: 500_000,
      });
      const allocEvo = new MillionMatchSeedAllocator({
        purpose: "AI_EVOLUTION",
        campaignSeed: 20261106,
        totalPlannedPairs: 500_000,
      });

      // 2. QUALITY_AUDIT (100,000,001..110,000,000) と AI_EVOLUTION (350,000,001..360,000,000) の完全分離確認
      expect(allocAudit.spec.rangeStart).toBe(QUALITY_AUDIT_SEED_RANGE_START);
      expect(allocAudit.spec.rangeEnd).toBe(110_000_000);
      expect(allocEvo.spec.rangeStart).toBe(AI_EVOLUTION_SEED_RANGE_START);
      expect(allocEvo.spec.rangeEnd).toBe(360_000_000);
      expect(allocAudit.spec.rangeEnd).toBeLessThan(allocEvo.spec.rangeStart);

      // 3. 既存 Stage 3 の Training (660ペア), Validation (94001..94015), Holdout (95001..95030), Smoke (99951..99952) 全履歴をロードし、
      //    生成される 500,000 ペアの Seed (QUALITY_AUDIT および AI_EVOLUTION 双方) と 1 件も衝突しないことを完全検証
      const historicalSet = MillionMatchSeedAllocator.buildProtectedHistoricalSeedSet();
      expect(historicalSet.size).toBeGreaterThanOrEqual(660 + 15 + 30 + 2);

      // 4. 500,000 ペア (1,000,000 試合) 全件を実際に生成し、ビットマップ (Uint8Array) で重複ゼロ・許容範囲内・Stage 3 全履歴との非衝突を完全検証
      const bitmapAudit = new Uint8Array(DEDICATED_SEED_RANGE_SIZE);
      const bitmapEvo = new Uint8Array(DEDICATED_SEED_RANGE_SIZE);
      for (let p = 0; p < 500_000; p++) {
        const sAudit = allocAudit.getPairSeed(p);
        expect(sAudit).toBeGreaterThanOrEqual(allocAudit.spec.rangeStart);
        expect(sAudit).toBeLessThanOrEqual(allocAudit.spec.rangeEnd);
        expect(historicalSet.has(sAudit)).toBe(false);
        const offsetAudit = sAudit - allocAudit.spec.rangeStart;
        expect(bitmapAudit[offsetAudit]).toBe(0);
        bitmapAudit[offsetAudit] = 1;

        const sEvo = allocEvo.getPairSeed(p);
        expect(sEvo).toBeGreaterThanOrEqual(allocEvo.spec.rangeStart);
        expect(sEvo).toBeLessThanOrEqual(allocEvo.spec.rangeEnd);
        expect(historicalSet.has(sEvo)).toBe(false);
        const offsetEvo = sEvo - allocEvo.spec.rangeStart;
        expect(bitmapEvo[offsetEvo]).toBe(0);
        bitmapEvo[offsetEvo] = 1;
      }

      // 5. 並列実行順序が変わっても Seed と 試合 ID が一切変わらないこと
      const indices = [0, 1, 250_000, 499_999];
      const forwardSeeds = indices.map((p) => allocAudit.getPairSeed(p));
      const reverseSeeds = [...indices].reverse().map((p) => allocAudit.getPairSeed(p)).reverse();
      expect(reverseSeeds).toEqual(forwardSeeds);
    });
  });

  describe("2. 既存原本保護 & 10万/100万試合未承認ロック機構", () => {
    it("保護された Stage 3 / Holdout ディレクトリへの出力指定を Fail-Closed で拒否すること", () => {
      expect(() =>
        validateMillionMatchOutputDir(".artifacts/stage3-holdout-evaluation", "PILOT")
      ).toThrow(/protected historical artifact directory/);
      expect(() =>
        validateMillionMatchOutputDir(".artifacts/stage3-full-action-retrain-r1", "PILOT")
      ).toThrow(/protected historical artifact directory/);
      expect(() =>
        validateMillionMatchOutputDir(".artifacts/stage3-evolution", "PILOT")
      ).toThrow(/protected historical artifact directory/);
    });

    it("空でない既存ディレクトリや既存 ZIP ファイルへの上書きを Fail-Closed で拒否すること", () => {
      const nonEmptyDir = path.join(tmpRoot, "non-empty-dir");
      fs.mkdirSync(nonEmptyDir, { recursive: true });
      fs.writeFileSync(path.join(nonEmptyDir, "dummy.txt"), "x");
      expect(() => validateMillionMatchOutputDir(nonEmptyDir, "PILOT")).toThrow(
        /already exists and is not empty/
      );

      const emptyDirWithZip = path.join(tmpRoot, "dir-with-zip");
      fs.writeFileSync(`${emptyDirWithZip}.zip`, "zipbytes");
      expect(() => validateMillionMatchOutputDir(emptyDirWithZip, "PILOT")).toThrow(
        /Output zip archive .* already exists/
      );
    });

    it("10,000試合を超える実行 (100,000試合 / 1,000,000試合) は承認トークンなしでは UnauthorizedScaleExecutionError で阻止されること", async () => {
      expect(() =>
        MillionMatchCampaignEngine.assertScaleExecutionAuthorized(100_000, "EXECUTE")
      ).toThrow(UnauthorizedScaleExecutionError);

      expect(() =>
        MillionMatchCampaignEngine.assertScaleExecutionAuthorized(1_000_000, "PILOT")
      ).toThrow(UnauthorizedScaleExecutionError);

      // --plan-only は 1,000,000 試合でも計画確認可能なこと
      expect(() =>
        MillionMatchCampaignEngine.assertScaleExecutionAuthorized(1_000_000, "PLAN_ONLY")
      ).not.toThrow();
    });
  });

  describe("3. 中断 Resume と無中断実行の完全一致 & チャンク/Checkpoint 破損検出", () => {
    it("途中中断後に --resume した結果が、中断なしで完走した結果と Logical Result Digest および全 Chunk SHA-256 まで 100% 一致すること", async () => {
      const unbrokenDir = path.join(tmpRoot, "run-unbroken-12");
      const resumedDir = path.join(tmpRoot, "run-resumed-12");
      const sessionFactory = createFastDeterministicSessionFactory();

      // 1. 中断なしで 12 試合 (6 ペア, チャンクサイズ 4 試合 = 3 チャンク) を完走
      const unbrokenRes = await MillionMatchCampaignEngine.runCampaign({
        workId: WORK4_WORK_ID,
        campaignId: "test-resume-parity",
        purpose: "QUALITY_AUDIT",
        stage: "CUSTOM_PILOT",
        executionMode: "PILOT",
        totalPlannedMatches: 12,
        campaignSeed: 777001,
        regulationId: "standard-pack",
        frameId: "pack",
        rulePackageVersion: "1.0.0",
        featureSchemaVersion: 6,
        rulePackage,
        matchups: testMatchups,
        policyResolver: testPolicyResolver,
        sessionFactory,
        outputDir: unbrokenDir,
        maxDecisionsPerMatch: 80,
        chunkSizeMatches: 4,
        maxConcurrency: 2,
        gitCommitSha: "498fae6a4f65cd04c5c5fe28b6fd0aa9169bdef4",
        isGitClean: true,
      });
      saveMillionMatchArtifacts(unbrokenRes.evidence, unbrokenDir);

      // 2. 同じ設定で 4 ペア (8 試合 = 2 チャンク) 完了時点で中断させる
      const partialRes = await MillionMatchCampaignEngine.runCampaign({
        workId: WORK4_WORK_ID,
        campaignId: "test-resume-parity",
        purpose: "QUALITY_AUDIT",
        stage: "CUSTOM_PILOT",
        executionMode: "PILOT",
        totalPlannedMatches: 12,
        campaignSeed: 777001,
        regulationId: "standard-pack",
        frameId: "pack",
        rulePackageVersion: "1.0.0",
        featureSchemaVersion: 6,
        rulePackage,
        matchups: testMatchups,
        policyResolver: testPolicyResolver,
        sessionFactory,
        outputDir: resumedDir,
        maxDecisionsPerMatch: 80,
        chunkSizeMatches: 4,
        maxConcurrency: 1, // 並列度が異なっても結果が完全一致することも同時に証明
        gitCommitSha: "498fae6a4f65cd04c5c5fe28b6fd0aa9169bdef4",
        isGitClean: true,
        stopAfterPairsForTest: 4,
      });

      expect(partialRes.haltedEarlyForTest).toBe(true);
      expect(partialRes.checkpointState.completedMatchesCount).toBe(8);
      expect(partialRes.checkpointState.completedChunks.length).toBe(2);

      // 未確定のゴミファイル (outcomes-chunk-00002.jsonl.tmp) が残っていた場合をシミュレート
      fs.writeFileSync(
        path.join(resumedDir, "chunks", "outcomes-chunk-00002.jsonl.tmp"),
        "partial corrupted line\n"
      );

      // 3. --resume で残り 2 ペア (4 試合) を再開して完走
      const resumedFinal = await MillionMatchCampaignEngine.runCampaign({
        workId: WORK4_WORK_ID,
        campaignId: "test-resume-parity",
        purpose: "QUALITY_AUDIT",
        stage: "CUSTOM_PILOT",
        executionMode: "RESUME",
        totalPlannedMatches: 12,
        campaignSeed: 777001,
        regulationId: "standard-pack",
        frameId: "pack",
        rulePackageVersion: "1.0.0",
        featureSchemaVersion: 6,
        rulePackage,
        matchups: testMatchups,
        policyResolver: testPolicyResolver,
        sessionFactory,
        outputDir: resumedDir,
        maxDecisionsPerMatch: 80,
        chunkSizeMatches: 4,
        maxConcurrency: 2,
        gitCommitSha: "498fae6a4f65cd04c5c5fe28b6fd0aa9169bdef4",
        isGitClean: true,
      });
      saveMillionMatchArtifacts(resumedFinal.evidence, resumedDir);

      // 4. 中断なし実行と Resume 実行の Logical Result Digest および全 Chunk SHA-256 が完全一致すること
      expect(resumedFinal.evidence.logicalResultDigest).toBe(
        unbrokenRes.evidence.logicalResultDigest
      );
      expect(resumedFinal.evidence.chunksManifest.map((c) => c.sha256)).toEqual(
        unbrokenRes.evidence.chunksManifest.map((c) => c.sha256)
      );
      expect(resumedFinal.evidence.performance.checkpointing.resumedCount).toBe(1);

      // 両方のディレクトリが自己監査を PASS すること
      const auditUnbroken = auditMillionMatchArtifacts(unbrokenDir);
      const auditResumed = auditMillionMatchArtifacts(resumedDir);
      expect(auditUnbroken.isValid).toBe(true);
      expect(auditResumed.isValid).toBe(true);
    });

    it("Checkpoint 改ざん・破損およびチャンク改ざんを Resume 時・監査時に確実に検出すること", async () => {
      const baseDir = path.join(tmpRoot, "run-resumed-12");
      const tamperCkptDir = path.join(tmpRoot, "tamper-ckpt");
      const tamperChunkDir = path.join(tmpRoot, "tamper-chunk");

      fs.cpSync(baseDir, tamperCkptDir, { recursive: true });
      fs.cpSync(baseDir, tamperChunkDir, { recursive: true });

      // 1. Checkpoint の内部データを改ざん -> Resume 時に CheckpointIntegrityError
      const ckptPath = path.join(tamperCkptDir, "checkpoint.json");
      const ckptObj = JSON.parse(fs.readFileSync(ckptPath, "utf8"));
      ckptObj.completedMatchesCount = 999;
      fs.writeFileSync(ckptPath, JSON.stringify(ckptObj, null, 2));

      await expect(
        MillionMatchCampaignEngine.runCampaign({
          workId: WORK4_WORK_ID,
          campaignId: "test-resume-parity",
          purpose: "QUALITY_AUDIT",
          stage: "CUSTOM_PILOT",
          executionMode: "RESUME",
          totalPlannedMatches: 12,
          campaignSeed: 777001,
          regulationId: "standard-pack",
          frameId: "pack",
          rulePackageVersion: "1.0.0",
          featureSchemaVersion: 6,
          rulePackage,
          matchups: testMatchups,
          policyResolver: testPolicyResolver,
          sessionFactory: createFastDeterministicSessionFactory(),
          outputDir: tamperCkptDir,
          maxDecisionsPerMatch: 80,
          chunkSizeMatches: 4,
          maxConcurrency: 2,
          gitCommitSha: "498fae6a4f65cd04c5c5fe28b6fd0aa9169bdef4",
          isGitClean: true,
        })
      ).rejects.toThrow(CheckpointIntegrityError);

      // 2. チャンク JSONL の中身を1文字改ざん -> Resume 時に ChunkIntegrityError & 自己監査 FAIL
      const chunk0Path = path.join(tamperChunkDir, "chunks", "outcomes-chunk-00000.jsonl");
      fs.appendFileSync(chunk0Path, "\n");

      await expect(
        MillionMatchCampaignEngine.runCampaign({
          workId: WORK4_WORK_ID,
          campaignId: "test-resume-parity",
          purpose: "QUALITY_AUDIT",
          stage: "CUSTOM_PILOT",
          executionMode: "RESUME",
          totalPlannedMatches: 12,
          campaignSeed: 777001,
          regulationId: "standard-pack",
          frameId: "pack",
          rulePackageVersion: "1.0.0",
          featureSchemaVersion: 6,
          rulePackage,
          matchups: testMatchups,
          policyResolver: testPolicyResolver,
          sessionFactory: createFastDeterministicSessionFactory(),
          outputDir: tamperChunkDir,
          maxDecisionsPerMatch: 80,
          chunkSizeMatches: 4,
          maxConcurrency: 2,
          gitCommitSha: "498fae6a4f65cd04c5c5fe28b6fd0aa9169bdef4",
          isGitClean: true,
        })
      ).rejects.toThrow(ChunkIntegrityError);

      const auditTampered = auditMillionMatchArtifacts(tamperChunkDir);
      expect(auditTampered.isValid).toBe(false);
      expect(auditTampered.errors.some((e) => e.includes("SHA-256 mismatch"))).toBe(true);
    });

    it("チャンク保存と Checkpoint 更新の3つの境界障害 (途中停止) から Resume した際、試合の欠落・重複なく連続実行と Logical Result Digest が完全一致すること", async () => {
      const unbrokenDir = path.join(tmpRoot, "run-unbroken-12");
      const expectedDigest = JSON.parse(
        fs.readFileSync(path.join(unbrokenDir, "campaign-evidence.json"), "utf8")
      ).logicalResultDigest;
      const expectedChunkHashes = JSON.parse(
        fs.readFileSync(path.join(unbrokenDir, "campaign-evidence.json"), "utf8")
      ).chunksManifest.map((c: any) => c.sha256);

      const faultScenarios = [
        "STOP_DURING_CHUNK_WRITE_TMP",
        "STOP_AFTER_CHUNK_COMMIT_BEFORE_CHECKPOINT",
        "STOP_DURING_CHECKPOINT_TMP_WRITE",
      ] as const;

      for (const faultType of faultScenarios) {
        const faultDir = path.join(tmpRoot, `fault-${faultType}`);
        const sessionFactory = createFastDeterministicSessionFactory();

        // chunkIndex = 1 (2番目のチャンク: 5〜8試合目) の保存境界で障害注入
        await expect(
          MillionMatchCampaignEngine.runCampaign({
            workId: WORK4_WORK_ID,
            campaignId: "test-resume-parity",
            purpose: "QUALITY_AUDIT",
            stage: "CUSTOM_PILOT",
            executionMode: "PILOT",
            totalPlannedMatches: 12,
            campaignSeed: 777001,
            regulationId: "standard-pack",
            frameId: "pack",
            rulePackageVersion: "1.0.0",
            featureSchemaVersion: 6,
            rulePackage,
            matchups: testMatchups,
            policyResolver: testPolicyResolver,
            sessionFactory,
            outputDir: faultDir,
            maxDecisionsPerMatch: 80,
            chunkSizeMatches: 4,
            maxConcurrency: 2,
            gitCommitSha: "498fae6a4f65cd04c5c5fe28b6fd0aa9169bdef4",
            isGitClean: true,
            faultInjectionForTest: {
              targetChunkIndex: 1,
              faultType,
            },
          })
        ).rejects.toThrow(FaultInjectionAbortError);

        // 障害停止後、直前の確定済み Checkpoint (chunkIndex = 0: 4試合完了時点) から Resume して完走
        const recovered = await MillionMatchCampaignEngine.runCampaign({
          workId: WORK4_WORK_ID,
          campaignId: "test-resume-parity",
          purpose: "QUALITY_AUDIT",
          stage: "CUSTOM_PILOT",
          executionMode: "RESUME",
          totalPlannedMatches: 12,
          campaignSeed: 777001,
          regulationId: "standard-pack",
          frameId: "pack",
          rulePackageVersion: "1.0.0",
          featureSchemaVersion: 6,
          rulePackage,
          matchups: testMatchups,
          policyResolver: testPolicyResolver,
          sessionFactory,
          outputDir: faultDir,
          maxDecisionsPerMatch: 80,
          chunkSizeMatches: 4,
          maxConcurrency: 2,
          gitCommitSha: "498fae6a4f65cd04c5c5fe28b6fd0aa9169bdef4",
          isGitClean: true,
        });
        saveMillionMatchArtifacts(recovered.evidence, faultDir);

        expect(recovered.evidence.logicalResultDigest).toBe(expectedDigest);
        expect(recovered.evidence.chunksManifest.map((c) => c.sha256)).toEqual(expectedChunkHashes);

        const audit = auditMillionMatchArtifacts(faultDir);
        expect(audit.isValid).toBe(true);
        expect(audit.verifiedMatchesCount).toBe(12);
      }
    });

    it("同一キャンペーンの二重起動を ConcurrentCampaignLockError で即座に拒否し、非決定的な並列完了順序でも Logical Result Digest が完全一致すること", async () => {
      const lockDir = path.join(tmpRoot, "duplicate-lock-test");
      fs.mkdirSync(lockDir, { recursive: true });
      fs.writeFileSync(
        path.join(lockDir, "campaign.lock"),
        JSON.stringify({ campaignId: "dup-test", pid: process.pid }),
        "utf8"
      );

      await expect(
        MillionMatchCampaignEngine.runCampaign({
          workId: WORK4_WORK_ID,
          campaignId: "dup-test",
          purpose: "QUALITY_AUDIT",
          stage: "CUSTOM_PILOT",
          executionMode: "PILOT",
          totalPlannedMatches: 4,
          campaignSeed: 777001,
          regulationId: "standard-pack",
          frameId: "pack",
          rulePackageVersion: "1.0.0",
          featureSchemaVersion: 6,
          rulePackage,
          matchups: testMatchups,
          policyResolver: testPolicyResolver,
          sessionFactory: createFastDeterministicSessionFactory(),
          outputDir: lockDir,
          maxDecisionsPerMatch: 80,
          chunkSizeMatches: 4,
          maxConcurrency: 2,
          gitCommitSha: "498fae6a4f65cd04c5c5fe28b6fd0aa9169bdef4",
          isGitClean: true,
        })
      ).rejects.toThrow(ConcurrentCampaignLockError);

      // 非決定的な並列完了順序 (Leg 1 が Leg 0 より先に完了して返るケース) でも matchIndex 順ソートにより Digest が完全一致すること
      const unbrokenDir = path.join(tmpRoot, "run-unbroken-12");
      const expectedDigest = JSON.parse(
        fs.readFileSync(path.join(unbrokenDir, "campaign-evidence.json"), "utf8")
      ).logicalResultDigest;

      const invertedOrderDir = path.join(tmpRoot, "inverted-concurrency-order-12");
      const invertedRes = await MillionMatchCampaignEngine.runCampaign({
        workId: WORK4_WORK_ID,
        campaignId: "test-resume-parity",
        purpose: "QUALITY_AUDIT",
        stage: "CUSTOM_PILOT",
        executionMode: "PILOT",
        totalPlannedMatches: 12,
        campaignSeed: 777001,
        regulationId: "standard-pack",
        frameId: "pack",
        rulePackageVersion: "1.0.0",
        featureSchemaVersion: 6,
        rulePackage,
        matchups: testMatchups,
        policyResolver: testPolicyResolver,
        sessionFactory: createFastDeterministicSessionFactory(),
        outputDir: invertedOrderDir,
        maxDecisionsPerMatch: 80,
        chunkSizeMatches: 4,
        maxConcurrency: 2,
        gitCommitSha: "498fae6a4f65cd04c5c5fe28b6fd0aa9169bdef4",
        isGitClean: true,
        invertConcurrencyCompletionOrderForTest: true,
      });

      expect(invertedRes.evidence.logicalResultDigest).toBe(expectedDigest);
    });
  });

  describe("4. 異常試合の分離分類 (膠着疑い vs 重大エラー) と決定論的再現テスト", () => {
    it("意思決定上限到達 (STALL_SUSPECTED) は重大クラッシュと混同せず分離記録し、実体化失敗や例外は FAILED_CRITICAL_ANOMALY として記録・再現可能であること", async () => {
      const stallDir = path.join(tmpRoot, "anomaly-stall-test");
      const critDir = path.join(tmpRoot, "anomaly-crit-test");
      const sessionFactory = createFastDeterministicSessionFactory();

      // A. 意思決定上限を極小 (5回) にして STALL_SUSPECTED を発生させる
      const stallRun = await MillionMatchCampaignEngine.runCampaign({
        workId: WORK4_WORK_ID,
        campaignId: "stall-test",
        purpose: "QUALITY_AUDIT",
        stage: "CUSTOM_PILOT",
        executionMode: "PILOT",
        totalPlannedMatches: 2,
        campaignSeed: 888001,
        regulationId: "standard-pack",
        frameId: "pack",
        rulePackageVersion: "1.0.0",
        featureSchemaVersion: 6,
        rulePackage,
        matchups: testMatchups,
        policyResolver: testPolicyResolver,
        sessionFactory,
        outputDir: stallDir,
        maxDecisionsPerMatch: 5,
        chunkSizeMatches: 2,
        maxConcurrency: 1,
        gitCommitSha: "498fae6a4f65cd04c5c5fe28b6fd0aa9169bdef4",
        isGitClean: true,
      });

      expect(stallRun.evidence.campaignStatus).toBe("COMPLETED_WITH_STALL_SUSPICIONS");
      expect(stallRun.evidence.gameQuality.suspectedStallMatchesCount).toBe(2);
      expect(stallRun.evidence.gameQuality.failedMatches).toBe(0);

      // anomalies ディレクトリに診断 JSON が保存されていること
      const stallAnomalyFiles = fs.readdirSync(path.join(stallDir, "anomalies"));
      expect(stallAnomalyFiles.length).toBe(2);
      const stallAnomaly0 = JSON.parse(
        fs.readFileSync(path.join(stallDir, "anomalies", stallAnomalyFiles[0]), "utf8")
      );
      expect(stallAnomaly0.category).toBe("STALL_SUSPECTED");
      expect(stallAnomaly0.isCriticalCoreError).toBe(false);

      // 保存された reproductionRecipe を用いて同じ試合を再実行し、finalStateHash が完全一致して再現できること
      const recipe = stallAnomaly0.reproductionRecipe;
      const reproResult = executeSingleInstrumentedMatch({
        campaignId: "repro",
        workId: WORK4_WORK_ID,
        matchIndex: 0,
        pairIndex: 0,
        legIndex: 0,
        matchId: "repro-0",
        matchupId: "test-first-vs-random",
        matchSeed: recipe.matchSeed,
        playerSeeds: { p1: recipe.p1Seed, p2: recipe.p2Seed },
        p1Spec: stallAnomaly0.p1Policy,
        p2Spec: stallAnomaly0.p2Policy,
        p1Policy: testPolicyResolver(stallAnomaly0.p1Policy, "p1", recipe.matchSeed, recipe.p1Seed),
        p2Policy: testPolicyResolver(stallAnomaly0.p2Policy, "p2", recipe.matchSeed, recipe.p2Seed),
        sessionFactory,
        regulationId: recipe.regulationId,
        frameId: "pack",
        maxDecisionsPerMatch: recipe.maxDecisions,
      });
      expect(reproResult.outcomeRecord.finalStateHash).toBe(stallAnomaly0.lastNormalStateHash);
      expect(reproResult.outcomeRecord.totalDecisions).toBe(stallAnomaly0.totalDecisionsAtAnomaly);

      // B. matchIndex === 0 で PatternInstantiationError を発生させた場合 -> FAILED_CRITICAL_ANOMALY
      const failingPolicyResolver = (
        spec: ParticipantPolicySpec,
        seat: "p1" | "p2",
        matchSeed: number,
        playerSeed: number
      ): DecisionPolicy => {
        if (seat === "p1") {
          return {
            descriptor: { kind: "faulty", name: "FaultyPolicy", policyVersion: 1 },
            choose: () => {
              throw new PatternInstantiationError(7, 512, "Simulated streaming instantiation failure");
            },
          };
        }
        return testPolicyResolver(spec, seat, matchSeed, playerSeed);
      };

      const critRun = await MillionMatchCampaignEngine.runCampaign({
        workId: WORK4_WORK_ID,
        campaignId: "crit-test",
        purpose: "QUALITY_AUDIT",
        stage: "CUSTOM_PILOT",
        executionMode: "PILOT",
        totalPlannedMatches: 2,
        campaignSeed: 888002,
        regulationId: "standard-pack",
        frameId: "pack",
        rulePackageVersion: "1.0.0",
        featureSchemaVersion: 6,
        rulePackage,
        matchups: testMatchups,
        policyResolver: failingPolicyResolver,
        sessionFactory,
        outputDir: critDir,
        maxDecisionsPerMatch: 50,
        chunkSizeMatches: 2,
        maxConcurrency: 1,
        gitCommitSha: "498fae6a4f65cd04c5c5fe28b6fd0aa9169bdef4",
        isGitClean: true,
      });

      expect(critRun.evidence.campaignStatus).toBe("FAILED_CRITICAL_ANOMALY");
      expect(critRun.evidence.gameQuality.failedMatches).toBe(2);
      expect(critRun.evidence.gameQuality.coreInstantiationFailuresCount).toBe(2);
      expect(critRun.evidence.gameQuality.anomalyCountsByCategory.INSTANTIATION_FAILURE).toBe(2);
    });
  });

  describe("5. CLI 引数パーサー検証", () => {
    it("--plan-only, --benchmark, --pilot, --resume, --execute の排他性とオプション解析が正しく機能すること", () => {
      const plan = parseLargeScaleCliArgs(["--plan-only"]);
      expect(plan.mode).toBe("PLAN_ONLY");
      expect(plan.matches).toBe(1_000_000);

      const pilot = parseLargeScaleCliArgs([
        "--pilot",
        "--matches",
        "1000",
        "--purpose",
        "AI_EVOLUTION",
        "--concurrency",
        "2",
      ]);
      expect(pilot.mode).toBe("PILOT");
      expect(pilot.matches).toBe(1000);
      expect(pilot.purpose).toBe("AI_EVOLUTION");
      expect(pilot.concurrency).toBe(2);

      // モード複数指定はエラー
      expect(() => parseLargeScaleCliArgs(["--pilot", "--execute"])).toThrow(/Specify exactly one/);
      // 奇数試合指定はエラー (座席反転ペア単位のため)
      expect(() => parseLargeScaleCliArgs(["--pilot", "--matches", "1001"])).toThrow(/positive even integer/);
      // concurrency > 2 はエラー
      expect(() => parseLargeScaleCliArgs(["--pilot", "--concurrency", "4"])).toThrow(/must be 1 or 2/);

      // --session-match-limit と --time-budget-minutes の解析
      const sliced = parseLargeScaleCliArgs([
        "--resume",
        "--output-dir",
        ".artifacts/custom-session-test",
        "--session-match-limit",
        "10000",
        "--time-budget-minutes",
        "120",
      ]);
      expect(sliced.mode).toBe("RESUME");
      expect(sliced.sessionMatchLimit).toBe(10000);
      expect(sliced.timeBudgetMinutes).toBe(120);

      // 奇数の --session-match-limit はエラー
      expect(() => parseLargeScaleCliArgs(["--pilot", "--session-match-limit", "999"])).toThrow(
        /positive even integer/
      );
      // 0 以下の --time-budget-minutes はエラー
      expect(() => parseLargeScaleCliArgs(["--pilot", "--time-budget-minutes", "0"])).toThrow(
        /positive number/
      );
    });
  });

  describe("6. 重複 matchId 検出および O(1) メモリ非蓄積性の検証", () => {
    it("チャンク内の重複 matchId を自己監査で確実に検出すること", () => {
      const baseDir = path.join(tmpRoot, "run-unbroken-12");
      const dupMatchIdDir = path.join(tmpRoot, "tamper-dup-matchid");
      fs.cpSync(baseDir, dupMatchIdDir, { recursive: true });

      const chunk0Path = path.join(dupMatchIdDir, "chunks", "outcomes-chunk-00000.jsonl");
      const lines = fs.readFileSync(chunk0Path, "utf8").trim().split("\n");
      const rec0 = JSON.parse(lines[0]);
      const rec1 = JSON.parse(lines[1]);
      rec1.matchId = rec0.matchId; // 重複 matchId を注入
      lines[1] = JSON.stringify(rec1);
      fs.writeFileSync(chunk0Path, lines.join("\n") + "\n", "utf8");

      const audit = auditMillionMatchArtifacts(dupMatchIdDir);
      expect(audit.isValid).toBe(false);
      expect(audit.errors.some((e) => e.includes("Duplicate matchId detected in chunks"))).toBe(true);
    });

    it("複数チャンク実行時でも Checkpoint や Evidence に全試合配列を保持せず O(1) メモリ構造を維持すること", async () => {
      const memDir = path.join(tmpRoot, "mem-flatness-test");
      const res = await MillionMatchCampaignEngine.runCampaign({
        workId: WORK4_WORK_ID,
        campaignId: "mem-flatness",
        purpose: "QUALITY_AUDIT",
        stage: "CUSTOM_PILOT",
        executionMode: "PILOT",
        totalPlannedMatches: 24,
        campaignSeed: 999111,
        regulationId: "standard-pack",
        frameId: "pack",
        rulePackageVersion: "1.0.0",
        featureSchemaVersion: 6,
        rulePackage,
        matchups: testMatchups,
        policyResolver: testPolicyResolver,
        sessionFactory: createFastDeterministicSessionFactory(),
        outputDir: memDir,
        maxDecisionsPerMatch: 60,
        chunkSizeMatches: 6, // 4 チャンクに分割フラッシュ
        maxConcurrency: 2,
        gitCommitSha: "498fae6a4f65cd04c5c5fe28b6fd0aa9169bdef4",
        isGitClean: true,
      });

      // Evidence や Checkpoint に生 matches 配列が存在しないこと
      expect((res.evidence as any).matches).toBeUndefined();
      expect((res.checkpointState as any).completedMatches).toBeUndefined();
      expect(res.evidence.chunksManifest.length).toBe(4);
      expect(res.evidence.performance.executedMatches).toBe(24);
      expect(res.evidence.performance.memory.memorySamples.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe("7. 時間分割・試合数分割実行 (--session-match-limit / --time-budget-minutes) と多段階 Resume 検証", () => {
    it("sessionMatchLimit により3セッションに分割して中断・再開を繰り返し、連続実行と完全一致する Logical Result Digest になること", async () => {
      const continuousDir = path.join(tmpRoot, "run-unbroken-12");
      const continuousEvidence = JSON.parse(
        fs.readFileSync(path.join(continuousDir, "campaign-evidence.json"), "utf8")
      );

      const multiSessionDir = path.join(tmpRoot, "multi-session-match-limit-12");
      const baseOptions = {
        workId: WORK4_WORK_ID,
        campaignId: "test-resume-parity",
        purpose: "QUALITY_AUDIT" as const,
        stage: "CUSTOM_PILOT" as const,
        totalPlannedMatches: 12,
        campaignSeed: 777001,
        regulationId: "standard-pack",
        frameId: "pack",
        rulePackageVersion: "1.0.0",
        featureSchemaVersion: 6,
        rulePackage,
        matchups: testMatchups,
        policyResolver: testPolicyResolver,
        sessionFactory: createFastDeterministicSessionFactory(),
        outputDir: multiSessionDir,
        maxDecisionsPerMatch: 80,
        chunkSizeMatches: 4,
        maxConcurrency: 2 as const,
        gitCommitSha: "498fae6a4f65cd04c5c5fe28b6fd0aa9169bdef4",
        isGitClean: true,
      };

      // Session 1: 0 -> 4 試合 (PARTIAL_SESSION_PAUSED)
      const s1 = await MillionMatchCampaignEngine.runCampaign({
        ...baseOptions,
        executionMode: "PILOT",
        sessionMatchLimit: 4,
      });
      expect(s1.evidence.campaignStatus).toBe("PARTIAL_SESSION_PAUSED");
      expect(s1.evidence.performance.executedMatches).toBe(4);
      expect(s1.checkpointState.completedMatchesCount).toBe(4);
      expect(s1.checkpointState.sessionHistory?.length).toBe(1);
      expect(s1.checkpointState.sessionHistory?.[0].stopReason).toBe("SESSION_MATCH_LIMIT_REACHED");
      saveMillionMatchArtifacts(s1.evidence, multiSessionDir);
      expect(auditMillionMatchArtifacts(multiSessionDir).isValid).toBe(true);

      // Session 2: 4 -> 8 試合 (PARTIAL_SESSION_PAUSED)
      const s2 = await MillionMatchCampaignEngine.runCampaign({
        ...baseOptions,
        executionMode: "RESUME",
        sessionMatchLimit: 4,
      });
      expect(s2.evidence.campaignStatus).toBe("PARTIAL_SESSION_PAUSED");
      expect(s2.evidence.performance.executedMatches).toBe(8);
      expect(s2.checkpointState.completedMatchesCount).toBe(8);
      expect(s2.checkpointState.sessionHistory?.length).toBe(2);
      expect(s2.checkpointState.sessionHistory?.[1].startMatchIndex).toBe(4);
      expect(s2.checkpointState.sessionHistory?.[1].endMatchIndex).toBe(7);
      expect(s2.checkpointState.sessionHistory?.[1].stopReason).toBe("SESSION_MATCH_LIMIT_REACHED");
      saveMillionMatchArtifacts(s2.evidence, multiSessionDir);
      expect(auditMillionMatchArtifacts(multiSessionDir).isValid).toBe(true);

      // Session 3: 8 -> 12 試合完走 (continuousEvidence と同じ campaignStatus)
      const s3 = await MillionMatchCampaignEngine.runCampaign({
        ...baseOptions,
        executionMode: "RESUME",
        sessionMatchLimit: 4,
      });
      expect(s3.evidence.campaignStatus).toBe(continuousEvidence.campaignStatus);
      expect(s3.evidence.performance.executedMatches).toBe(12);
      expect(s3.checkpointState.completedMatchesCount).toBe(12);
      expect(s3.checkpointState.sessionHistory?.length).toBe(3);
      expect(s3.checkpointState.sessionHistory?.[2].stopReason).toBe("CAMPAIGN_COMPLETED");
      saveMillionMatchArtifacts(s3.evidence, multiSessionDir);

      const finalAudit = auditMillionMatchArtifacts(multiSessionDir);
      expect(finalAudit.isValid).toBe(true);
      expect(finalAudit.verifiedMatchesCount).toBe(12);

      // 連続実行した run-unbroken-12 と Logical Result Digest・チャンク SHA-256・Coverage が完全一致すること
      expect(s3.evidence.logicalResultDigest).toBe(continuousEvidence.logicalResultDigest);
      expect(s3.evidence.chunksManifest.map((c) => c.sha256)).toEqual(
        continuousEvidence.chunksManifest.map((c: any) => c.sha256)
      );
      expect(s3.evidence.ruleCoverage.executedActionCounts).toEqual(
        continuousEvidence.ruleCoverage.executedActionCounts
      );
      expect(s3.evidence.gameQuality.seatWinRates).toEqual(
        continuousEvidence.gameQuality.seatWinRates
      );
    });

    it("timeBudgetMinutes によりチャンク途中の座席反転ペア境界で安全停止・再開し、連続実行と完全一致する Logical Result Digest になること", async () => {
      const continuousDir = path.join(tmpRoot, "run-unbroken-12");
      const continuousEvidence = JSON.parse(
        fs.readFileSync(path.join(continuousDir, "campaign-evidence.json"), "utf8")
      );

      const timeBudgetDir = path.join(tmpRoot, "multi-session-time-budget-12");
      const baseOptions = {
        workId: WORK4_WORK_ID,
        campaignId: "test-resume-parity",
        purpose: "QUALITY_AUDIT" as const,
        stage: "CUSTOM_PILOT" as const,
        totalPlannedMatches: 12,
        campaignSeed: 777001,
        regulationId: "standard-pack",
        frameId: "pack",
        rulePackageVersion: "1.0.0",
        featureSchemaVersion: 6,
        rulePackage,
        matchups: testMatchups,
        policyResolver: testPolicyResolver,
        sessionFactory: createFastDeterministicSessionFactory(),
        outputDir: timeBudgetDir,
        maxDecisionsPerMatch: 80,
        chunkSizeMatches: 4, // 2ペアで1チャンク
        maxConcurrency: 2 as const,
        gitCommitSha: "498fae6a4f65cd04c5c5fe28b6fd0aa9169bdef4",
        isGitClean: true,
      };

      // Session 1: 1ペア (2試合 = チャンクの半分) 完了時点で時間上限 (1分) に到達して安全停止
      const t1 = await MillionMatchCampaignEngine.runCampaign({
        ...baseOptions,
        executionMode: "PILOT",
        timeBudgetMinutes: 1,
        customWallClockElapsedMsForTest: (pairsInSession) => pairsInSession * 60_000,
      });
      expect(t1.evidence.campaignStatus).toBe("PARTIAL_SESSION_PAUSED");
      expect(t1.evidence.performance.executedMatches).toBe(2); // 座席反転ペア (2試合) が分断されていないこと
      expect(t1.checkpointState.sessionHistory?.[0].stopReason).toBe("TIME_BUDGET_REACHED");
      saveMillionMatchArtifacts(t1.evidence, timeBudgetDir);
      expect(auditMillionMatchArtifacts(timeBudgetDir).isValid).toBe(true);

      // Session 2: 2ペア (4試合) 追加して計6試合 (チャンク0を4試合に完成させ、チャンク1を2試合まで書き込み) で時間上限停止
      const t2 = await MillionMatchCampaignEngine.runCampaign({
        ...baseOptions,
        executionMode: "RESUME",
        timeBudgetMinutes: 2,
        customWallClockElapsedMsForTest: (pairsInSession) => pairsInSession * 60_000,
      });
      expect(t2.evidence.campaignStatus).toBe("PARTIAL_SESSION_PAUSED");
      expect(t2.evidence.performance.executedMatches).toBe(6);
      expect(t2.checkpointState.sessionHistory?.[1].stopReason).toBe("TIME_BUDGET_REACHED");
      saveMillionMatchArtifacts(t2.evidence, timeBudgetDir);
      expect(auditMillionMatchArtifacts(timeBudgetDir).isValid).toBe(true);

      // Session 3: 残り3ペア (6試合) を実行して計12試合完走
      const t3 = await MillionMatchCampaignEngine.runCampaign({
        ...baseOptions,
        executionMode: "RESUME",
        timeBudgetMinutes: 10,
        customWallClockElapsedMsForTest: (pairsInSession) => pairsInSession * 60_000,
      });
      expect(t3.evidence.campaignStatus).toBe(continuousEvidence.campaignStatus);
      expect(t3.evidence.performance.executedMatches).toBe(12);
      expect(t3.checkpointState.sessionHistory?.length).toBe(3);
      expect(t3.checkpointState.sessionHistory?.[2].stopReason).toBe("CAMPAIGN_COMPLETED");
      saveMillionMatchArtifacts(t3.evidence, timeBudgetDir);

      const finalAudit = auditMillionMatchArtifacts(timeBudgetDir);
      expect(finalAudit.isValid).toBe(true);

      // チャンク途中のペア境界で一時停止・再開しても、最終的なチャンク分割と Logical Result Digest が連続実行と 100% 一致すること
      expect(t3.evidence.chunksManifest.length).toBe(3);
      expect(t3.evidence.chunksManifest.map((c) => c.matchCount)).toEqual([4, 4, 4]);
      expect(t3.evidence.chunksManifest.map((c) => c.sha256)).toEqual(
        continuousEvidence.chunksManifest.map((c: any) => c.sha256)
      );
      expect(t3.evidence.logicalResultDigest).toBe(continuousEvidence.logicalResultDigest);
    });

    it("セッション再開時に AI・DNA・Seed・ルール・実験設定が1箇所でも変更されていた場合は Fail-Closed で停止すること", async () => {
      const tamperSessionDir = path.join(tmpRoot, "session-tamper-check");
      const baseOptions = {
        workId: WORK4_WORK_ID,
        campaignId: "tamper-session-test",
        purpose: "QUALITY_AUDIT" as const,
        stage: "CUSTOM_PILOT" as const,
        totalPlannedMatches: 8,
        campaignSeed: 777009,
        regulationId: "standard-pack",
        frameId: "pack",
        rulePackageVersion: "1.0.0",
        featureSchemaVersion: 6,
        rulePackage,
        matchups: testMatchups,
        policyResolver: testPolicyResolver,
        sessionFactory: createFastDeterministicSessionFactory(),
        outputDir: tamperSessionDir,
        maxDecisionsPerMatch: 60,
        chunkSizeMatches: 4,
        maxConcurrency: 2 as const,
        gitCommitSha: "498fae6a4f65cd04c5c5fe28b6fd0aa9169bdef4",
        isGitClean: true,
      };

      // Session 1: 4試合まで実行して一時停止
      await MillionMatchCampaignEngine.runCampaign({
        ...baseOptions,
        executionMode: "PILOT",
        sessionMatchLimit: 4,
      });

      // 1. Seed 変更 -> Fail-Closed
      await expect(
        MillionMatchCampaignEngine.runCampaign({
          ...baseOptions,
          executionMode: "RESUME",
          campaignSeed: 777010,
        })
      ).rejects.toThrow(CheckpointIntegrityError);

      // 2. AI / DNA Digest 変更 -> Fail-Closed
      const modifiedMatchups: MatchupPairingSpec[] = [
        {
          ...testMatchups[0],
          agentA: {
            ...testMatchups[0].agentA,
            dnaDigest: "tampered_dna_digest_0000000000000000000000000000",
          },
        },
      ];
      await expect(
        MillionMatchCampaignEngine.runCampaign({
          ...baseOptions,
          executionMode: "RESUME",
          matchups: modifiedMatchups,
        })
      ).rejects.toThrow(CheckpointIntegrityError);

      // 3. ルールバージョン変更 -> Fail-Closed
      await expect(
        MillionMatchCampaignEngine.runCampaign({
          ...baseOptions,
          executionMode: "RESUME",
          rulePackageVersion: "9.9.9",
        })
      ).rejects.toThrow(CheckpointIntegrityError);

      // 4. 意思決定上限変更 -> Fail-Closed
      await expect(
        MillionMatchCampaignEngine.runCampaign({
          ...baseOptions,
          executionMode: "RESUME",
          maxDecisionsPerMatch: 400,
        })
      ).rejects.toThrow(CheckpointIntegrityError);

      // 5. Git Commit SHA 変更 -> Fail-Closed
      await expect(
        MillionMatchCampaignEngine.runCampaign({
          ...baseOptions,
          executionMode: "RESUME",
          gitCommitSha: "0000000000000000000000000000000000000000",
        })
      ).rejects.toThrow(CheckpointIntegrityError);
    });
  });
});
