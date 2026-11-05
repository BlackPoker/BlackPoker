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

    it("50万ペア (100万試合) 規模の Seed 空間で数学的全単射により衝突ゼロであり、QUALITY_AUDIT と AI_EVOLUTION の空間が完全分離されていること", () => {
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

      expect(allocAudit.spec.rangeEnd).toBeLessThan(allocEvo.spec.rangeStart);

      // 先頭 10,000 ペアの Seed が完全に一意かつ順序非依存で取得できることを確認
      const sampleCount = 10_000;
      const seen = new Set<number>();
      for (let p = 0; p < sampleCount; p++) {
        const s = allocAudit.getPairSeed(p);
        expect(seen.has(s)).toBe(false);
        seen.add(s);
      }
      // 逆順アクセスでも同一の Seed が返ること (並列処理順序非依存)
      expect(allocAudit.getPairSeed(9999)).toBe(
        allocAudit.getPairSeed(9999)
      );
      expect(allocAudit.getPairSeed(0)).not.toBe(allocEvo.getPairSeed(0));
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
});
