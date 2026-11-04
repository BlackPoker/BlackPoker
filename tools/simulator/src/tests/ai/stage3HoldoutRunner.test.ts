/**
 * BlackPoker Work 3-6 — Stage 3 Champion Holdout Runner Unit Tests
 *
 * 【検証項目】
 * 1. Preflight Manifest 生成とパラメータ整合性 (30 seeds × 4 opponents = 120 pairs = 240 matches)
 * 2. 新 Champion DNA (Gen 7) および旧 Champion DNA (Gen 5) の読み込みと Digest 検証
 * 3. 不正 Digest 指定時の Fail-Closed エラー
 * 4. ZeroDNA 生成と全要素 0.0 有限値検証
 * 5. Seed 衝突防止検証 (Training / Validation / Holdout 直交性)
 * 6. 不正・衝突 Seed 指定時の Fail-Closed エラー
 * 7. 保護ディレクトリ上書き防止 Fail-Closed
 * 8. 既存非空ディレクトリ Fail-Closed
 * 9. 4 対戦相手 (FirstLegal, SeededRandom, ZeroDNA, ReferenceChampion) の定義・role 整合性
 * 10. 診断用 Seed (99951〜99952) による小規模スモーク対戦 (16試合) 完走・Outcome整合性・自己監査
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  CANDIDATE_CHAMPION_EXPECTED_DIGEST,
  CANDIDATE_CHAMPION_GENOME_ID,
  DEFAULT_MAX_DECISIONS_PER_MATCH,
  HOLDOUT_BONFERRONI_ALPHA,
  HOLDOUT_FEATURE_SCHEMA_VERSION,
  HOLDOUT_FRAME_ID,
  HOLDOUT_OPPONENTS_COUNT,
  HOLDOUT_REGULATION_ID,
  HOLDOUT_RULE_PACKAGE_VERSION,
  HOLDOUT_SIGNIFICANCE_ALPHA,
  HOLDOUT_WORK_ID,
  OFFICIAL_HOLDOUT_SEEDS,
  OLD_CHAMPION_EXPECTED_DIGEST,
  OLD_CHAMPION_GENOME_ID,
  PROTECTED_OLD_STAGE3_DIR,
  PROTECTED_RETRAIN_DIR,
  SMOKE_DIAGNOSTIC_SEEDS,
  auditHoldoutArtifacts,
  buildHoldoutPreflightManifest,
  checkGitCleanliness,
  createHoldoutOpponents,
  createZeroDNA,
  executeHoldoutEvaluation,
  loadChampionDNA,
  packageHoldoutZip,
  saveHoldoutArtifacts,
  validateArtifactsDirectory,
  validateHoldoutSeedPlan,
} from "../../cli/stage3HoldoutRunner";
import { prepareOfficialSessionFactory } from "../../cli/stage3EvolutionRunner";
import { EvaluationSeedCollisionError } from "../../domain/ai/EvolutionEvaluationTypes";
import { DecisionDNACodec } from "../../engine/ai/DecisionDNACodec";
import { EvolutionIndependentEvaluator } from "../../engine/ai/EvolutionIndependentEvaluator";

describe("Stage 3 Champion Holdout Runner", () => {
  const candidateCheckpointPath = path.resolve(
    PROTECTED_RETRAIN_DIR,
    "campaign-stage3-evolution-checkpoint.json"
  );
  const oldChampCheckpointPath = path.resolve(
    PROTECTED_OLD_STAGE3_DIR,
    "campaign-stage3-evolution-checkpoint.json"
  );

  const testTempDir = path.resolve(".artifacts/test-stage3-holdout-runner-temp");

  beforeAll(() => {
    if (fs.existsSync(testTempDir)) {
      fs.rmSync(testTempDir, { recursive: true, force: true });
    }
  });

  afterAll(() => {
    if (fs.existsSync(testTempDir)) {
      fs.rmSync(testTempDir, { recursive: true, force: true });
    }
  });

  describe("1. DNA 読み込みと真正性検証", () => {
    it("新 Champion DNA (Gen 7) が正しく読み込まれ、期待 Digest と完全一致する", () => {
      const dna = loadChampionDNA({
        checkpointPath: candidateCheckpointPath,
        expectedGenomeId: CANDIDATE_CHAMPION_GENOME_ID,
        expectedDigest: CANDIDATE_CHAMPION_EXPECTED_DIGEST,
      });

      expect(dna).toBeDefined();
      expect(dna.metadata?.id).toBe(CANDIDATE_CHAMPION_GENOME_ID);
      expect(dna.featureSchemaVersion).toBe(HOLDOUT_FEATURE_SCHEMA_VERSION);
      expect(dna.patternWeights.length).toBe(143);
      expect(dna.contextPatternWeights.length).toBe(23595);

      const digest = EvolutionIndependentEvaluator.computeDnaDigest(dna);
      expect(digest).toBe(CANDIDATE_CHAMPION_EXPECTED_DIGEST);
    });

    it("旧 Champion DNA (Gen 5) が正しく読み込まれ、期待 Digest と完全一致する", () => {
      const dna = loadChampionDNA({
        checkpointPath: oldChampCheckpointPath,
        expectedGenomeId: OLD_CHAMPION_GENOME_ID,
        expectedDigest: OLD_CHAMPION_EXPECTED_DIGEST,
      });

      expect(dna).toBeDefined();
      expect(dna.metadata?.id).toBe(OLD_CHAMPION_GENOME_ID);
      expect(dna.featureSchemaVersion).toBe(HOLDOUT_FEATURE_SCHEMA_VERSION);

      const digest = EvolutionIndependentEvaluator.computeDnaDigest(dna);
      expect(digest).toBe(OLD_CHAMPION_EXPECTED_DIGEST);
    });

    it("不正な Digest を期待値として指定した場合は Fail-Closed エラーをスローする", () => {
      expect(() => {
        loadChampionDNA({
          checkpointPath: candidateCheckpointPath,
          expectedGenomeId: CANDIDATE_CHAMPION_GENOME_ID,
          expectedDigest: "0000000000000000000000000000000000000000000000000000000000000000",
        });
      }).toThrow(/DNA Digest mismatch/);
    });

    it("存在しない Checkpoint ファイルを指定した場合は Fail-Closed エラーをスローする", () => {
      expect(() => {
        loadChampionDNA({
          checkpointPath: "non-existent-checkpoint.json",
          expectedGenomeId: CANDIDATE_CHAMPION_GENOME_ID,
          expectedDigest: CANDIDATE_CHAMPION_EXPECTED_DIGEST,
        });
      }).toThrow(/Checkpoint file not found/);
    });

    it("ZeroDNA が正しく生成され、全重みが 0.0 で有限値検証を満たす", () => {
      const zeroDNA = createZeroDNA();
      expect(zeroDNA).toBeDefined();
      expect(zeroDNA.featureSchemaVersion).toBe(HOLDOUT_FEATURE_SCHEMA_VERSION);
      expect(zeroDNA.patternWeights.every((w) => w === 0.0)).toBe(true);
      expect(zeroDNA.contextPatternWeights.every((w) => w === 0.0)).toBe(true);

      // 有効性検証
      expect(() => DecisionDNACodec.validate(zeroDNA)).not.toThrow();
    });
  });

  describe("2. Seed 衝突防止検証 (Fail-Closed)", () => {
    it("本番 Holdout Seeds (95001〜95030) は Training / Validation と衝突しない", () => {
      expect(OFFICIAL_HOLDOUT_SEEDS.length).toBe(30);
      expect(OFFICIAL_HOLDOUT_SEEDS[0]).toBe(95001);
      expect(OFFICIAL_HOLDOUT_SEEDS[29]).toBe(95030);

      expect(() => validateHoldoutSeedPlan(OFFICIAL_HOLDOUT_SEEDS)).not.toThrow();
    });

    it("Validation Seed (94001) を混入した場合は EvaluationSeedCollisionError をスローする", () => {
      const contaminatedSeeds = [94001, ...OFFICIAL_HOLDOUT_SEEDS.slice(1)];
      expect(() => validateHoldoutSeedPlan(contaminatedSeeds)).toThrow(EvaluationSeedCollisionError);
    });

    it("Seed 範囲内に重複が存在した場合は EvaluationSeedCollisionError をスローする", () => {
      const duplicateSeeds = [95001, 95001, ...OFFICIAL_HOLDOUT_SEEDS.slice(2)];
      expect(() => validateHoldoutSeedPlan(duplicateSeeds)).toThrow(EvaluationSeedCollisionError);
    });
  });

  describe("3. 原本保護 & 出力先ディレクトリ保護 (Fail-Closed)", () => {
    it("保護ディレクトリ (.artifacts/stage3-evolution 等) への書き込み指定を拒絶する", () => {
      expect(() => validateArtifactsDirectory(PROTECTED_RETRAIN_DIR)).toThrow(
        /targets a protected artifact directory/
      );
      expect(() => validateArtifactsDirectory(PROTECTED_OLD_STAGE3_DIR)).toThrow(
        /targets a protected artifact directory/
      );
    });

    it("既存かつ非空のディレクトリへの書き込み指定を拒絶する", () => {
      const nonEmptyDir = path.join(testTempDir, "non-empty-dir");
      fs.mkdirSync(nonEmptyDir, { recursive: true });
      fs.writeFileSync(path.join(nonEmptyDir, "dummy.txt"), "dummy");

      expect(() => validateArtifactsDirectory(nonEmptyDir)).toThrow(
        /already exists and is not empty/
      );
    });

    it("新規または空のディレクトリは検証を通過する", () => {
      const emptyDir = path.join(testTempDir, "empty-dir");
      fs.mkdirSync(emptyDir, { recursive: true });

      expect(() => validateArtifactsDirectory(emptyDir)).not.toThrow();
    });
  });

  describe("4. 対戦相手定義 (4種) & Preflight Manifest", () => {
    it("4種の対戦相手が正しい ID、Role、目標勝率で構築される", () => {
      const oldChampDNA = loadChampionDNA({
        checkpointPath: oldChampCheckpointPath,
        expectedGenomeId: OLD_CHAMPION_GENOME_ID,
        expectedDigest: OLD_CHAMPION_EXPECTED_DIGEST,
      });
      const zeroDNA = createZeroDNA();

      const opponents = createHoldoutOpponents({
        oldChampionDNA: oldChampDNA,
        zeroDNA,
      });

      expect(opponents.length).toBe(HOLDOUT_OPPONENTS_COUNT);
      expect(opponents.map((o) => o.opponentId)).toEqual([
        "holdout-first-legal",
        "holdout-seeded-random",
        "holdout-zero-dna",
        "holdout-stage3-gen5-champion",
      ]);

      const fl = opponents.find((o) => o.opponentId === "holdout-first-legal")!;
      expect(fl.role).toBe("BASELINE");
      expect(fl.targetWinRate).toBe(0.85);

      const sr = opponents.find((o) => o.opponentId === "holdout-seeded-random")!;
      expect(sr.role).toBe("BASELINE");
      expect(sr.targetWinRate).toBe(0.75);

      const zd = opponents.find((o) => o.opponentId === "holdout-zero-dna")!;
      expect(zd.role).toBe("BASELINE");
      expect(zd.targetWinRate).toBe(0.70);

      const oc = opponents.find((o) => o.opponentId === "holdout-stage3-gen5-champion")!;
      expect(oc.role).toBe("REFERENCE_CHAMPION");
      expect(oc.targetWinRate).toBe(0.50);
      expect((oc as any).expectedDnaDigest).toBe(OLD_CHAMPION_EXPECTED_DIGEST);
    });

    it("本番 Holdout 用 Preflight Manifest が計画 240 試合 (120 pairs) を正確に反映する", () => {
      const candDNA = loadChampionDNA({
        checkpointPath: candidateCheckpointPath,
        expectedGenomeId: CANDIDATE_CHAMPION_GENOME_ID,
        expectedDigest: CANDIDATE_CHAMPION_EXPECTED_DIGEST,
      });
      const oldChampDNA = loadChampionDNA({
        checkpointPath: oldChampCheckpointPath,
        expectedGenomeId: OLD_CHAMPION_GENOME_ID,
        expectedDigest: OLD_CHAMPION_EXPECTED_DIGEST,
      });
      const zeroDNA = createZeroDNA();
      const gitInfo = checkGitCleanliness();

      const manifest = buildHoldoutPreflightManifest({
        candidateDNA: candDNA,
        candidateSourcePath: candidateCheckpointPath,
        oldChampionDNA: oldChampDNA,
        oldChampionSourcePath: oldChampCheckpointPath,
        zeroDNA,
        seeds: OFFICIAL_HOLDOUT_SEEDS,
        executionMode: "DRY_RUN",
        artifactsDir: ".artifacts/stage3-holdout-evaluation",
        gitInfo,
      });

      expect(manifest.workId).toBe(HOLDOUT_WORK_ID);
      expect(manifest.regulationId).toBe(HOLDOUT_REGULATION_ID);
      expect(manifest.frameId).toBe(HOLDOUT_FRAME_ID);
      expect(manifest.rulePackageVersion).toBe(HOLDOUT_RULE_PACKAGE_VERSION);
      expect(manifest.featureSchemaVersion).toBe(HOLDOUT_FEATURE_SCHEMA_VERSION);

      expect(manifest.candidateChampion.genomeId).toBe(CANDIDATE_CHAMPION_GENOME_ID);
      expect(manifest.candidateChampion.verifiedDigest).toBe(CANDIDATE_CHAMPION_EXPECTED_DIGEST);
      expect(manifest.oldChampion.genomeId).toBe(OLD_CHAMPION_GENOME_ID);
      expect(manifest.oldChampion.verifiedDigest).toBe(OLD_CHAMPION_EXPECTED_DIGEST);

      expect(manifest.seeds.count).toBe(30);
      expect(manifest.plannedMatches.seedsCount).toBe(30);
      expect(manifest.plannedMatches.pairsPerOpponent).toBe(30);
      expect(manifest.plannedMatches.matchesPerOpponent).toBe(60);
      expect(manifest.plannedMatches.totalPairs).toBe(120);
      expect(manifest.plannedMatches.totalMatches).toBe(240);
    });
  });

  describe("5. 診断用 Seed による小規模スモークテスト & 自己監査 (--smoke モード)", () => {
    it("診断用 Seed (99951〜99952, 計16試合) で対戦が完走し、成果物保存と自己監査が PASS する", async () => {
      const candDNA = loadChampionDNA({
        checkpointPath: candidateCheckpointPath,
        expectedGenomeId: CANDIDATE_CHAMPION_GENOME_ID,
        expectedDigest: CANDIDATE_CHAMPION_EXPECTED_DIGEST,
      });
      const oldChampDNA = loadChampionDNA({
        checkpointPath: oldChampCheckpointPath,
        expectedGenomeId: OLD_CHAMPION_GENOME_ID,
        expectedDigest: OLD_CHAMPION_EXPECTED_DIGEST,
      });
      const zeroDNA = createZeroDNA();
      const gitInfo = checkGitCleanliness();

      const smokeOutputDir = path.join(testTempDir, "smoke-artifacts");
      const sessionFactory = await prepareOfficialSessionFactory(HOLDOUT_REGULATION_ID);

      const preflightManifest = buildHoldoutPreflightManifest({
        candidateDNA: candDNA,
        candidateSourcePath: candidateCheckpointPath,
        oldChampionDNA: oldChampDNA,
        oldChampionSourcePath: oldChampCheckpointPath,
        zeroDNA,
        seeds: SMOKE_DIAGNOSTIC_SEEDS,
        executionMode: "SMOKE",
        artifactsDir: smokeOutputDir,
        gitInfo,
      });

      // 2 seeds × 4 opponents × 2 legs = 16 matches (8 pairs)
      expect(preflightManifest.plannedMatches.totalMatches).toBe(16);

      const output = executeHoldoutEvaluation({
        candidateDNA: candDNA,
        oldChampionDNA: oldChampDNA,
        zeroDNA,
        seeds: SMOKE_DIAGNOSTIC_SEEDS,
        preflightManifest,
        sessionFactory,
      });

      expect(output.totalMatches).toBe(16);
      expect(output.completedMatches).toBe(16);
      expect(output.failedMatches).toBe(0);
      expect(output.incompleteMatches).toBe(0);
      expect(output.allIndividualOutcomes.length).toBe(16);

      // 個別 Outcome の検証
      for (const outcome of output.allIndividualOutcomes) {
        expect(outcome.completed).toBe(true);
        expect(outcome.failed).toBe(false);
        expect(outcome.incomplete).toBe(false);
        expect(outcome.totalDecisions).toBeGreaterThan(0);
        expect(outcome.turnCount).toBeGreaterThan(0);
      }

      // 成果物保存
      const saveResult = saveHoldoutArtifacts(output, smokeOutputDir);
      expect(saveResult.savedFiles.length).toBe(7);

      // 自己監査の実行
      const auditResult = auditHoldoutArtifacts(smokeOutputDir);
      expect(auditResult.isValid).toBe(true);
      expect(auditResult.errors.length).toBe(0);
      expect(auditResult.completedMatches).toBe(16);
      expect(auditResult.failedMatches).toBe(0);
      expect(auditResult.incompleteMatches).toBe(0);
      expect(auditResult.candidateDigestMatches).toBe(true);
      expect(auditResult.oldChampionDigestMatches).toBe(true);

      // ZIP パッケージ化テスト
      const zipPath = path.join(testTempDir, "smoke-artifacts.zip");
      const zipResult = packageHoldoutZip(smokeOutputDir, zipPath);
      expect(fs.existsSync(zipPath)).toBe(true);
      expect(zipResult.zipSizeBytes).toBeGreaterThan(0);
      expect(zipResult.zipSha256.length).toBe(64);
    });
  });
});
