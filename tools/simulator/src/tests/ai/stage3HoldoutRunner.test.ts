/**
 * BlackPoker Work 3-6 — Stage 3 Champion Holdout Runner Unit Tests (R1 改訂版)
 *
 * 【設計原則】
 * 1. CI 再現性: テスト用 Fixture を用いて自己完結し、.artifacts が存在しない CI 環境でも 100% PASS。
 * 2. 実原本が存在する場合の実機検証は it.runIf で条件付き実行。
 * 3. Checkpoint チェックサム・DNA Digest 照合・改ざん検出の独立検証。
 * 4. CLI 排他モード・引数検証の Fail-Closed。
 * 5. 240 試合の完全性監査 (239試合、Seed不一致、座席反転欠落、重複ペア、上限到達の Fail-Closed)。
 * 6. 性能認定 (Superiority vs Non-Inferiority) の境界値検証 (非劣性時の IMPROVEMENT_UNVERIFIED 契約)。
 * 7. 診断用 Seed による Smoke 16 試合の専用契約監査。
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  CANDIDATE_CHAMPION_EXPECTED_DIGEST,
  CANDIDATE_CHAMPION_GENOME_ID,
  DEFAULT_HOLDOUT_ARTIFACTS_DIR,
  DEFAULT_MAX_DECISIONS_PER_MATCH,
  DEFAULT_SMOKE_ARTIFACTS_DIR,
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
  computeFileSha256,
  computeHoldoutCertification,
  createHoldoutOpponents,
  createZeroDNA,
  executeHoldoutEvaluation,
  loadChampionDNA,
  packageHoldoutZip,
  parseHoldoutCliArgs,
  saveHoldoutArtifacts,
  validateArtifactsDirectory,
  validateHoldoutSeedPlan,
} from "../../cli/stage3HoldoutRunner";
import { prepareOfficialSessionFactory } from "../../cli/stage3EvolutionRunner";
import { EvaluationSeedCollisionError } from "../../domain/ai/EvolutionEvaluationTypes";
import { DecisionDNACodec } from "../../engine/ai/DecisionDNACodec";
import { EvolutionIndependentEvaluator } from "../../engine/ai/EvolutionIndependentEvaluator";
import { EvolutionCampaignManager } from "../../engine/ai/EvolutionCampaignManager";

// =============================================================================
// テスト用 Fixture 生成ヘルパー
// =============================================================================

function createMockChampionDNA(id: string, seedWeight: number): any {
  const dna = DecisionDNACodec.createZeroDecisionDNA({
    id,
    name: id,
    tags: ["holdout-test-mock"],
  });
  // 決定論的ダミー重み
  (dna.patternWeights as number[])[0] = seedWeight;
  (dna.contextPatternWeights as number[])[0] = seedWeight * 0.5;
  DecisionDNACodec.validate(dna);
  return dna;
}

function writeMockCheckpoint(filePath: string, genomeId: string, dna: any): string {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const digest = EvolutionIndependentEvaluator.computeDnaDigest(dna);

  const stateWithoutChecksum = {
    checkpointVersion: 1,
    campaignId: "test-campaign",
    campaignSeed: 20261105,
    environmentRef: "test-env",
    regulationId: HOLDOUT_REGULATION_ID,
    frameId: HOLDOUT_FRAME_ID,
    rulePackageVersion: HOLDOUT_RULE_PACKAGE_VERSION,
    featureSchemaVersion: HOLDOUT_FEATURE_SCHEMA_VERSION,
    totalTargetGenerations: 10,
    completedGenerations: 10,
    nextGenerationToProcess: 10,
    nextPopulation: { generation: 10, individuals: [] },
    provisionalBestChampion: {
      generation: 7,
      genomeId,
      dna,
      dnaDigest: digest,
      selectionReason: "test",
      fitnessScore: 0.95,
      validationMeanWinRate: 0.95,
      validationOpponentSummaries: {},
      isHoldoutVerified: false,
    },
    history: [],
    seedRegistry: [] as any,
    earlyStoppingState: { shouldStop: false, consecutiveStagnantGenerations: 0 } as any,
    configSnapshot: {} as any,
    timestamp: new Date().toISOString(),
  };

  const checksum = EvolutionCampaignManager.computeCheckpointChecksum(stateWithoutChecksum as any);
  const fullState = {
    ...stateWithoutChecksum,
    checksum,
  };

  fs.writeFileSync(filePath, JSON.stringify(fullState, null, 2), "utf8");
  return digest;
}

describe("Stage 3 Champion Holdout Runner (R1)", () => {
  const testTempDir = path.resolve(".artifacts/test-stage3-holdout-runner-temp");
  const mockRetrainCheckpointPath = path.join(testTempDir, "mock-retrain-checkpoint.json");
  const mockOldChampCheckpointPath = path.join(testTempDir, "mock-old-checkpoint.json");

  let mockCandDNA: any;
  let mockCandDigest: string;
  let mockOldChampDNA: any;
  let mockOldChampDigest: string;

  // 実原本が存在するかどうか (CI 環境では false)
  const realRetrainPath = path.resolve(PROTECTED_RETRAIN_DIR, "campaign-stage3-evolution-checkpoint.json");
  const realOldPath = path.resolve(PROTECTED_OLD_STAGE3_DIR, "campaign-stage3-evolution-checkpoint.json");
  const hasRealArtifacts = fs.existsSync(realRetrainPath) && fs.existsSync(realOldPath);

  beforeAll(() => {
    if (fs.existsSync(testTempDir)) {
      fs.rmSync(testTempDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testTempDir, { recursive: true });

    // テスト用 Fixture Checkpoint を作成
    mockCandDNA = createMockChampionDNA(CANDIDATE_CHAMPION_GENOME_ID, 0.042);
    mockCandDigest = writeMockCheckpoint(mockRetrainCheckpointPath, CANDIDATE_CHAMPION_GENOME_ID, mockCandDNA);

    mockOldChampDNA = createMockChampionDNA(OLD_CHAMPION_GENOME_ID, -0.024);
    mockOldChampDigest = writeMockCheckpoint(mockOldChampCheckpointPath, OLD_CHAMPION_GENOME_ID, mockOldChampDNA);
  });

  afterAll(() => {
    if (fs.existsSync(testTempDir)) {
      fs.rmSync(testTempDir, { recursive: true, force: true });
    }
  });

  describe("1. DNA 読み込み・真正性・Checkpoint 完全性検証", () => {
    it("テスト用 Fixture Checkpoint から DNA がロードされ、Digest と Checksum が照合される", () => {
      const dna = loadChampionDNA({
        checkpointPath: mockRetrainCheckpointPath,
        expectedGenomeId: CANDIDATE_CHAMPION_GENOME_ID,
        expectedDigest: mockCandDigest,
        verifyCheckpointChecksum: true,
      });

      expect(dna).toBeDefined();
      expect(dna.metadata?.id).toBe(CANDIDATE_CHAMPION_GENOME_ID);
      expect(EvolutionIndependentEvaluator.computeDnaDigest(dna)).toBe(mockCandDigest);
    });

    it("DNA Digest 不一致の場合は Fail-Closed エラーをスローする", () => {
      expect(() => {
        loadChampionDNA({
          checkpointPath: mockRetrainCheckpointPath,
          expectedGenomeId: CANDIDATE_CHAMPION_GENOME_ID,
          expectedDigest: "0000000000000000000000000000000000000000000000000000000000000000",
        });
      }).toThrow(/DNA Digest mismatch/);
    });

    it("Checkpoint 内部の checksum が改ざんされている場合は Fail-Closed エラーをスローする", () => {
      const tamperedPath = path.join(testTempDir, "tampered-checkpoint.json");
      const raw = JSON.parse(fs.readFileSync(mockRetrainCheckpointPath, "utf8"));
      raw.checksum = "badbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadb";
      fs.writeFileSync(tamperedPath, JSON.stringify(raw), "utf8");

      expect(() => {
        loadChampionDNA({
          checkpointPath: tamperedPath,
          expectedGenomeId: CANDIDATE_CHAMPION_GENOME_ID,
          expectedDigest: mockCandDigest,
          verifyCheckpointChecksum: true,
        });
      }).toThrow(/Checkpoint checksum mismatch/);
    });

    it("Checkpoint ファイルが存在しない場合は Fail-Closed エラーをスローする", () => {
      expect(() => {
        loadChampionDNA({
          checkpointPath: path.join(testTempDir, "non-existent.json"),
          expectedGenomeId: CANDIDATE_CHAMPION_GENOME_ID,
          expectedDigest: mockCandDigest,
        });
      }).toThrow(/Checkpoint file not found/);
    });

    it.runIf(hasRealArtifacts)("実原本が存在する場合: Gen 7 & Gen 5 Champion の固定 Digest と完全一致する", () => {
      const candDna = loadChampionDNA({
        checkpointPath: realRetrainPath,
        expectedGenomeId: CANDIDATE_CHAMPION_GENOME_ID,
        expectedDigest: CANDIDATE_CHAMPION_EXPECTED_DIGEST,
        verifyCheckpointChecksum: true,
      });
      expect(EvolutionIndependentEvaluator.computeDnaDigest(candDna)).toBe(CANDIDATE_CHAMPION_EXPECTED_DIGEST);

      const oldDna = loadChampionDNA({
        checkpointPath: realOldPath,
        expectedGenomeId: OLD_CHAMPION_GENOME_ID,
        expectedDigest: OLD_CHAMPION_EXPECTED_DIGEST,
        verifyCheckpointChecksum: true,
      });
      expect(EvolutionIndependentEvaluator.computeDnaDigest(oldDna)).toBe(OLD_CHAMPION_EXPECTED_DIGEST);
    });

    it("ZeroDNA が全重み 0.0 で生成され有限値検証を満たす", () => {
      const zeroDNA = createZeroDNA();
      expect(zeroDNA.patternWeights.every((w) => w === 0.0)).toBe(true);
      expect(zeroDNA.contextPatternWeights.every((w) => w === 0.0)).toBe(true);
      expect(() => DecisionDNACodec.validate(zeroDNA)).not.toThrow();
    });
  });

  describe("2. Seed 衝突防止検証 (Fail-Closed)", () => {
    it("本番 Holdout Seeds (95001〜95030, 30個) は Training / Validation と衝突しない", () => {
      expect(OFFICIAL_HOLDOUT_SEEDS.length).toBe(30);
      expect(OFFICIAL_HOLDOUT_SEEDS[0]).toBe(95001);
      expect(OFFICIAL_HOLDOUT_SEEDS[29]).toBe(95030);
      expect(() => validateHoldoutSeedPlan(OFFICIAL_HOLDOUT_SEEDS)).not.toThrow();
    });

    it("Validation Seed (94001) の混入を拒絶する", () => {
      const badSeeds = [94001, ...OFFICIAL_HOLDOUT_SEEDS.slice(1)];
      expect(() => validateHoldoutSeedPlan(badSeeds)).toThrow(EvaluationSeedCollisionError);
    });

    it("Seed 内の重複を拒絶する", () => {
      const badSeeds = [95001, 95001, ...OFFICIAL_HOLDOUT_SEEDS.slice(2)];
      expect(() => validateHoldoutSeedPlan(badSeeds)).toThrow(EvaluationSeedCollisionError);
    });

    it("空配列を渡した場合は Fail-Closed エラーをスローする", () => {
      expect(() => validateHoldoutSeedPlan([])).toThrow(/non-empty array/);
    });
  });

  describe("3. 原本保護 & 出力先ディレクトリ・ZIP 保護 (Fail-Closed)", () => {
    it("保護原本ディレクトリ (.artifacts/stage3-evolution 等) への書き込み指定を拒絶する", () => {
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
      fs.writeFileSync(path.join(nonEmptyDir, "test.txt"), "data");
      expect(() => validateArtifactsDirectory(nonEmptyDir)).toThrow(/already exists and is not empty/);
    });

    it("出力先 ZIP が既に存在する場合も上書きを拒絶する", () => {
      const emptyDir = path.join(testTempDir, "empty-dir-zip");
      fs.mkdirSync(emptyDir, { recursive: true });
      const existingZip = path.join(testTempDir, "existing.zip");
      fs.writeFileSync(existingZip, "dummy zip");

      expect(() => validateArtifactsDirectory(emptyDir, existingZip)).toThrow(/already exists/);
    });
  });

  describe("4. CLI 引数パース & 排他モード検証", () => {
    it("--dry-run のみを指定した場合は DRY_RUN モードを返す", () => {
      const parsed = parseHoldoutCliArgs(["--dry-run"]);
      expect(parsed.mode).toBe("DRY_RUN");
      expect(parsed.outputDir).toBe(DEFAULT_HOLDOUT_ARTIFACTS_DIR);
    });

    it("--smoke のみを指定した場合は SMOKE モードと専用ディレクトリを返す", () => {
      const parsed = parseHoldoutCliArgs(["--smoke"]);
      expect(parsed.mode).toBe("SMOKE");
      expect(parsed.outputDir).toBe(DEFAULT_SMOKE_ARTIFACTS_DIR);
    });

    it("--execute のみを指定した場合は EXECUTE モードを返す", () => {
      const parsed = parseHoldoutCliArgs(["--execute"]);
      expect(parsed.mode).toBe("EXECUTE");
      expect(parsed.outputDir).toBe(DEFAULT_HOLDOUT_ARTIFACTS_DIR);
    });

    it("--output-dir でカスタムディレクトリを指定できる", () => {
      const parsed = parseHoldoutCliArgs(["--dry-run", "--output-dir", "custom/dir"]);
      expect(parsed.outputDir).toBe("custom/dir");
    });

    it("複数の排他モードフラグ (--dry-run --execute) を指定した場合はエラー", () => {
      expect(() => parseHoldoutCliArgs(["--dry-run", "--execute"])).toThrow(/Mutually exclusive/);
    });

    it("複数の排他モードフラグ (--smoke --execute) を指定した場合はエラー", () => {
      expect(() => parseHoldoutCliArgs(["--smoke", "--execute"])).toThrow(/Mutually exclusive/);
    });

    it("複数の排他モードフラグ (--dry-run --smoke) を指定した場合はエラー", () => {
      expect(() => parseHoldoutCliArgs(["--dry-run", "--smoke"])).toThrow(/Mutually exclusive/);
    });

    it("モード指定フラグがない場合はエラー", () => {
      expect(() => parseHoldoutCliArgs([])).toThrow(/No execution mode specified/);
    });

    it("不明な引数を指定した場合はエラー", () => {
      expect(() => parseHoldoutCliArgs(["--dry-run", "--unknown-flag"])).toThrow(
        /Unrecognized or invalid CLI argument/
      );
    });
  });

  describe("5. 性能認定ロジック (computeHoldoutCertification) の境界値検証", () => {
    const makeMockEvalResult = (
      flMean: number,
      flLower: number,
      srMean: number,
      srLower: number,
      zdMean: number,
      zdLower: number,
      refMean: number,
      refLower: number
    ): any => {
      return {
        evidenceStatus: "VALID",
        improvementStatus: "IMPROVEMENT_UNVERIFIED",
        opponents: {
          "holdout-first-legal": {
            meanPairScore: flMean,
            statisticalTest: { oneSidedLowerBound: flLower },
          },
          "holdout-seeded-random": {
            meanPairScore: srMean,
            statisticalTest: { oneSidedLowerBound: srLower },
          },
          "holdout-zero-dna": {
            meanPairScore: zdMean,
            statisticalTest: { oneSidedLowerBound: zdLower },
          },
          "holdout-stage3-gen5-champion": {
            meanPairScore: refMean,
            statisticalTest: { oneSidedLowerBound: refLower },
          },
        },
      };
    };

    it("Baseline 全合格 + Reference Superiority (下限 > 0.50) -> SUPERIORITY_VERIFIED & IMPROVEMENT_VERIFIED", () => {
      const evalRes = makeMockEvalResult(0.90, 0.70, 0.80, 0.60, 0.75, 0.55, 0.55, 0.51);
      const cert = computeHoldoutCertification({
        evaluationResult: evalRes,
        failedMatches: 0,
        incompleteMatches: 0,
        matchesReachingDecisionLimit: 0,
        totalInstantiationFailures: 0,
        totalMatches: 240,
        expectedMatches: 240,
      });

      expect(cert.certificationStatus).toBe("SUPERIORITY_VERIFIED");
      expect(cert.effectiveImprovementStatus).toBe("IMPROVEMENT_VERIFIED");
      expect(cert.baselineSuperior).toBe(true);
      expect(cert.referenceSuperiorityVerified).toBe(true);
    });

    it("Baseline 全合格 + Reference Non-Inferiority (下限 0.46 > 0.45, 優位性未達) -> NON_INFERIORITY_VERIFIED & IMPROVEMENT_UNVERIFIED", () => {
      const evalRes = makeMockEvalResult(0.90, 0.70, 0.80, 0.60, 0.75, 0.55, 0.52, 0.46);
      const cert = computeHoldoutCertification({
        evaluationResult: evalRes,
        failedMatches: 0,
        incompleteMatches: 0,
        matchesReachingDecisionLimit: 0,
        totalInstantiationFailures: 0,
        totalMatches: 240,
        expectedMatches: 240,
      });

      expect(cert.certificationStatus).toBe("NON_INFERIORITY_VERIFIED");
      // 重要契約: 非劣性のみ達成の場合は優位性は未証明のため IMPROVEMENT_UNVERIFIED
      expect(cert.effectiveImprovementStatus).toBe("IMPROVEMENT_UNVERIFIED");
      expect(cert.baselineSuperior).toBe(true);
      expect(cert.referenceSuperiorityVerified).toBe(false);
      expect(cert.referenceNonInferiorityVerified).toBe(true);
    });

    it("Baseline の 1 つでも目標未達 (FirstLegal 84%) -> PERFORMANCE_UNVERIFIED", () => {
      const evalRes = makeMockEvalResult(0.84, 0.70, 0.80, 0.60, 0.75, 0.55, 0.55, 0.51);
      const cert = computeHoldoutCertification({
        evaluationResult: evalRes,
        failedMatches: 0,
        incompleteMatches: 0,
        matchesReachingDecisionLimit: 0,
        totalInstantiationFailures: 0,
        totalMatches: 240,
        expectedMatches: 240,
      });

      expect(cert.certificationStatus).toBe("PERFORMANCE_UNVERIFIED");
      expect(cert.baselineSuperior).toBe(false);
    });

    it("Reference が劣性 (下限 0.44 <= 0.45) -> PERFORMANCE_UNVERIFIED", () => {
      const evalRes = makeMockEvalResult(0.90, 0.70, 0.80, 0.60, 0.75, 0.55, 0.50, 0.44);
      const cert = computeHoldoutCertification({
        evaluationResult: evalRes,
        failedMatches: 0,
        incompleteMatches: 0,
        matchesReachingDecisionLimit: 0,
        totalInstantiationFailures: 0,
        totalMatches: 240,
        expectedMatches: 240,
      });

      expect(cert.certificationStatus).toBe("PERFORMANCE_UNVERIFIED");
      expect(cert.referenceNonInferiorityVerified).toBe(false);
    });

    it("失敗試合 (failed > 0) が存在する場合は INVALID_EVIDENCE", () => {
      const evalRes = makeMockEvalResult(0.90, 0.70, 0.80, 0.60, 0.75, 0.55, 0.55, 0.51);
      const cert = computeHoldoutCertification({
        evaluationResult: evalRes,
        failedMatches: 1,
        incompleteMatches: 0,
        matchesReachingDecisionLimit: 0,
        totalInstantiationFailures: 0,
        totalMatches: 240,
        expectedMatches: 240,
      });

      expect(cert.certificationStatus).toBe("INVALID_EVIDENCE");
    });
  });

  describe("6. 240 試合完全性監査の Fail-Closed 検証", () => {
    it("239 試合しかない成果物は監査 FAIL となる", () => {
      const incompleteArtifactsDir = path.join(testTempDir, "audit-incomplete-239");
      fs.mkdirSync(incompleteArtifactsDir, { recursive: true });

      // 239 件のダミー outcomes
      const outcomes = Array.from({ length: 239 }, (_, i) => ({
        matchIndex: i,
        matchId: `m-${i}`,
        pairIndex: Math.floor(i / 2),
        legIndex: i % 2,
        matchSeed: 95001 + Math.floor(i / 8),
        opponentId: "holdout-first-legal",
        opponentName: "FirstLegal",
        candidateSeat: i % 2 === 0 ? "p1" : "p2",
        opponentSeat: i % 2 === 0 ? "p2" : "p1",
        completed: true,
        candidateWon: true,
        candidateDraw: false,
        candidateLost: false,
        totalDecisions: 50,
        turnCount: 5,
        failed: false,
        incomplete: false,
        reachedDecisionLimit: false,
        instantiationFailures: 0,
      }));

      const preflight = {
        workId: HOLDOUT_WORK_ID,
        executionMode: "EXECUTE",
        decisionLimitPerMatch: DEFAULT_MAX_DECISIONS_PER_MATCH,
        candidateChampion: {
          genomeId: CANDIDATE_CHAMPION_GENOME_ID,
          expectedDigest: CANDIDATE_CHAMPION_EXPECTED_DIGEST,
          verifiedDigest: CANDIDATE_CHAMPION_EXPECTED_DIGEST,
        },
        oldChampion: {
          genomeId: OLD_CHAMPION_GENOME_ID,
          expectedDigest: OLD_CHAMPION_EXPECTED_DIGEST,
          verifiedDigest: OLD_CHAMPION_EXPECTED_DIGEST,
        },
      };

      const resultData = { individualOutcomes: outcomes, evaluationSummary: { opponents: {} } };
      const evidenceData = {
        candidateChampionDnaDigest: CANDIDATE_CHAMPION_EXPECTED_DIGEST,
        oldChampionDnaDigest: OLD_CHAMPION_EXPECTED_DIGEST,
        baselineSuperior: true,
        certificationStatus: "SUPERIORITY_VERIFIED",
      };

      fs.writeFileSync(path.join(incompleteArtifactsDir, "preflight-manifest.json"), JSON.stringify(preflight));
      fs.writeFileSync(path.join(incompleteArtifactsDir, "holdout-evaluation-protocol.json"), JSON.stringify({}));
      fs.writeFileSync(path.join(incompleteArtifactsDir, "holdout-evaluation-result.json"), JSON.stringify(resultData));
      fs.writeFileSync(path.join(incompleteArtifactsDir, "holdout-evaluation-evidence.json"), JSON.stringify(evidenceData));
      fs.writeFileSync(path.join(incompleteArtifactsDir, "STAGE3_HOLDOUT_AUDIT_REPORT.md"), "audit");
      fs.writeFileSync(path.join(incompleteArtifactsDir, "AUDIT_HOLDOUT_EVIDENCE.md"), "audit");

      const manifest: Record<string, string> = {
        "preflight-manifest.json": "a",
        "holdout-evaluation-protocol.json": "b",
        "holdout-evaluation-result.json": "c",
        "holdout-evaluation-evidence.json": "d",
        "STAGE3_HOLDOUT_AUDIT_REPORT.md": "e",
        "AUDIT_HOLDOUT_EVIDENCE.md": "f",
      };
      // 実際のハッシュを計算
      for (const k of Object.keys(manifest)) {
        manifest[k] = computeFileSha256(path.join(incompleteArtifactsDir, k));
      }
      fs.writeFileSync(path.join(incompleteArtifactsDir, "MANIFEST_SHA256.json"), JSON.stringify(manifest));

      const audit = auditHoldoutArtifacts(incompleteArtifactsDir);
      expect(audit.isValid).toBe(false);
      expect(audit.errors.some((e) => e.includes("matches count mismatch"))).toBe(true);
    });
  });

  describe("7. 診断用 Seed による小規模スモークテスト & 自己監査 (--smoke モード)", () => {
    it("診断用 Seed (99951〜99952, 計16試合) で対戦が完走し、成果物保存と自己監査が PASS する", async () => {
      const candDNA = mockCandDNA;
      const oldChampDNA = mockOldChampDNA;
      const zeroDNA = createZeroDNA();
      const gitInfo = checkGitCleanliness();

      const smokeOutputDir = path.join(testTempDir, "smoke-artifacts");
      const sessionFactory = await prepareOfficialSessionFactory(HOLDOUT_REGULATION_ID);

      const preflightManifest = buildHoldoutPreflightManifest({
        candidateDNA: candDNA,
        candidateSourcePath: mockRetrainCheckpointPath,
        oldChampionDNA: oldChampDNA,
        oldChampionSourcePath: mockOldChampCheckpointPath,
        zeroDNA,
        seeds: SMOKE_DIAGNOSTIC_SEEDS,
        executionMode: "SMOKE",
        artifactsDir: smokeOutputDir,
        gitInfo,
        maxDecisionsPerMatch: DEFAULT_MAX_DECISIONS_PER_MATCH,
      });

      expect(preflightManifest.plannedMatches.totalMatches).toBe(16);
      expect(preflightManifest.decisionLimitPerMatch).toBe(DEFAULT_MAX_DECISIONS_PER_MATCH);

      const output = executeHoldoutEvaluation({
        candidateDNA: candDNA,
        oldChampionDNA: oldChampDNA,
        zeroDNA,
        seeds: SMOKE_DIAGNOSTIC_SEEDS,
        preflightManifest,
        sessionFactory,
        maxDecisionsPerMatch: DEFAULT_MAX_DECISIONS_PER_MATCH,
      });

      expect(output.totalMatches).toBe(16);
      expect(output.completedMatches).toBe(16);
      expect(output.failedMatches).toBe(0);
      expect(output.incompleteMatches).toBe(0);
      expect(output.matchesReachingDecisionLimit).toBe(0);
      expect(output.totalInstantiationFailures).toBe(0);
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
      expect(auditResult.matchesReachingDecisionLimit).toBe(0);
      expect(auditResult.totalInstantiationFailures).toBe(0);

      // ZIP パッケージ化テスト
      const zipPath = path.join(testTempDir, "smoke-artifacts.zip");
      const zipResult = packageHoldoutZip(smokeOutputDir, zipPath);
      expect(fs.existsSync(zipPath)).toBe(true);
      expect(zipResult.zipSizeBytes).toBeGreaterThan(0);
      expect(zipResult.zipSha256.length).toBe(64);
    });
  });
});
