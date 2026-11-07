/**
 * BlackPoker Work 4-4 R2 — Gen 8 Official Holdout Runner & Statistical Audit Unit Tests
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import {
  GEN8_HOLDOUT_WORK_ID,
  GEN8_PRIMARY_CANDIDATE_GENOME_ID,
  GEN8_PRIMARY_CANDIDATE_EXPECTED_DIGEST,
  GEN8_PRIMARY_CANDIDATE_FILE_PATH,
  GEN8_HOLDOUT_APPROVAL_TOKEN,
  GEN8_HOLDOUT_SEED_RANGE_START,
  GEN8_HOLDOUT_SEED_RANGE_END,
  GEN8_HOLDOUT_TEST_SEED_START,
  DEFAULT_PRIMARY_PAIRS,
  UnauthorizedHoldoutExecutionError,
  Gen8CandidateIntegrityError,
  Gen8HoldoutAuditError,
  loadGen8PrimaryCandidate,
  buildGen8HoldoutPreflightManifest,
  computePairScore,
  computeHoldoutStatistics,
  computePlayerActionComparison,
  computeHoldoutPowerSensitivity,
  auditGen8HoldoutArtifacts,
  executeGen8HoldoutCampaign,
  runGen8HoldoutCli,
  computeHoldoutCheckpointChecksum,
  PairedScoreRecord,
} from "../../cli/gen8HoldoutRunner";
import { CompactMatchOutcomeRecord } from "../../domain/simulation/MillionMatchInfraTypes";
import { DecisionDNACodec } from "../../engine/ai/DecisionDNACodec";
import { EvolutionIndependentEvaluator } from "../../engine/ai/EvolutionIndependentEvaluator";
import { EvolutionCampaignManager } from "../../engine/ai/EvolutionCampaignManager";
import { MillionMatchWorkerPool } from "../../engine/simulation/MillionMatchWorkerPool";

// =============================================================================
// テスト用 Fixture 生成ヘルパー (CI 環境でも再現可能)
// =============================================================================

function createMockDna(id: string, seedWeight: number) {
  const dna = DecisionDNACodec.createZeroDecisionDNA({
    id,
    name: id,
    tags: ["holdout-test-mock"],
  });
  (dna.patternWeights as number[])[0] = seedWeight;
  (dna.contextPatternWeights as number[])[0] = seedWeight * 0.5;
  DecisionDNACodec.validate(dna);
  return dna;
}

function computeFileSha(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function writeMockCheckpointWithManifest(filePath: string, genomeId: string, dna: any): string {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const digest = EvolutionIndependentEvaluator.computeDnaDigest(dna);

  const stateWithoutChecksum = {
    checkpointVersion: 1,
    campaignId: "test-campaign",
    campaignSeed: 20261107,
    environmentRef: "test-env",
    regulationId: "standard-pack",
    frameId: "pack",
    rulePackageVersion: "1.0.0",
    featureSchemaVersion: 6,
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

  // MANIFEST_SHA256.json の作成
  const baseName = path.basename(filePath);
  const fileSha = computeFileSha(filePath);
  const manifest = { [baseName]: fileSha };
  fs.writeFileSync(
    path.join(path.dirname(filePath), "MANIFEST_SHA256.json"),
    JSON.stringify(manifest, null, 2),
    "utf8"
  );

  return digest;
}

describe("BlackPoker Work 4-4 R2 — Gen 8 Official Holdout Runner & Statistical Evaluation", () => {
  const tmpRoot = path.join(os.tmpdir(), "bp-work4-4-r2-test-" + Date.now());
  let fixtureGen7Path: string;
  let fixtureGen7Digest: string;
  let fixtureGen5Path: string;
  let fixtureGen5Digest: string;

  beforeAll(() => {
    fs.mkdirSync(tmpRoot, { recursive: true });

    // Fixture Gen 7
    fixtureGen7Path = path.join(tmpRoot, "fixtures", "gen7", "campaign-stage3-evolution-checkpoint.json");
    const mockGen7 = createMockDna("gen-000007-offspring-000007", 0.77);
    fixtureGen7Digest = writeMockCheckpointWithManifest(fixtureGen7Path, "gen-000007-offspring-000007", mockGen7);

    // Fixture Gen 5
    fixtureGen5Path = path.join(tmpRoot, "fixtures", "gen5", "campaign-stage3-evolution-checkpoint.json");
    const mockGen5 = createMockDna("gen-000005-offspring-000008", 0.55);
    fixtureGen5Digest = writeMockCheckpointWithManifest(fixtureGen5Path, "gen-000005-offspring-000008", mockGen5);
  });

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  describe("1. Candidate DNA & Preflight Manifest (Fixture 駆動 & CI 互換)", () => {
    it("should load the Gen 8 Primary Candidate DNA and verify exact SHA-256 digest match", () => {
      const dna = loadGen8PrimaryCandidate();
      expect(dna).toBeDefined();
      expect(dna.featureSchemaVersion).toBe(6);
      expect(dna.patternWeights).toBeDefined();
    });

    it("should fail closed if Candidate DNA file does not exist or digest is tampered", () => {
      expect(() => loadGen8PrimaryCandidate("non-existent-candidate.json")).toThrow(
        Gen8CandidateIntegrityError
      );
    });

    it("should build preflight manifest with test fixture checkpoints and 100% digest match in CI", () => {
      const manifest = buildGen8HoldoutPreflightManifest({
        executionMode: "PLAN_ONLY",
        plannedPairs: 120,
        gen7CheckpointPath: fixtureGen7Path,
        expectedGen7Digest: fixtureGen7Digest,
        gen5CheckpointPath: fixtureGen5Path,
        expectedGen5Digest: fixtureGen5Digest,
      });

      expect(manifest.workId).toBe(GEN8_HOLDOUT_WORK_ID);
      expect(manifest.executionMode).toBe("PLAN_ONLY");
      expect(manifest.approvalStatus).toBe("NOT_APPROVED_EXECUTION_BLOCKED");
      expect(manifest.candidateChampion.genomeId).toBe(GEN8_PRIMARY_CANDIDATE_GENOME_ID);
      expect(manifest.candidateChampion.expectedDigest).toBe(GEN8_PRIMARY_CANDIDATE_EXPECTED_DIGEST);
      expect(manifest.candidateChampion.digestMatches).toBe(true);

      // CI 環境でも Fixture により Digest 検証が 100% 正確に動作
      expect(manifest.referenceAnchorGen7.digestMatches).toBe(true);
      expect(manifest.referenceAnchorGen7.verifiedDigest).toBe(fixtureGen7Digest);
      expect(manifest.referenceAnchorGen5.digestMatches).toBe(true);
      expect(manifest.referenceAnchorGen5.verifiedDigest).toBe(fixtureGen5Digest);

      expect(manifest.seedRange.startSeed).toBe(GEN8_HOLDOUT_SEED_RANGE_START);
      expect(manifest.seedRange.endSeed).toBe(GEN8_HOLDOUT_SEED_RANGE_END);
      expect(manifest.seedRange.totalAvailableSeeds).toBe(300);
      expect(manifest.seedRange.historicalCollisionCount).toBe(0);

      expect(manifest.hypothesisGate.plannedPairs).toBe(120);
      expect(manifest.hypothesisGate.plannedMatches).toBe(240);
      expect(manifest.hypothesisGate.powerSensitivityAnalysis.length).toBe(4);
      expect(manifest.regressionBaselines.length).toBe(3);
    });

    it("should fail closed when official checkpoints are required but absent", () => {
      expect(() =>
        buildGen8HoldoutPreflightManifest({
          executionMode: "PLAN_ONLY",
          requireOfficialCheckpoints: true,
          gen7CheckpointPath: path.join(tmpRoot, "non-existent-official.json"),
        })
      ).toThrow(Gen8CandidateIntegrityError);
    });

    it("should allow manifest creation when Gen 5 is absent, but fail closed if requireGen5Checkpoint is true", () => {
      const nonExistentGen5 = path.join(tmpRoot, "non-existent-gen5.json");
      const manifest = buildGen8HoldoutPreflightManifest({
        executionMode: "PLAN_ONLY",
        gen7CheckpointPath: fixtureGen7Path,
        expectedGen7Digest: fixtureGen7Digest,
        gen5CheckpointPath: nonExistentGen5,
      });

      expect(manifest.referenceAnchorGen5.verifiedDigest).toBe("FILE_NOT_FOUND");
      expect(manifest.referenceAnchorGen5.digestMatches).toBe(false);

      expect(() =>
        buildGen8HoldoutPreflightManifest({
          executionMode: "PLAN_ONLY",
          gen7CheckpointPath: fixtureGen7Path,
          expectedGen7Digest: fixtureGen7Digest,
          gen5CheckpointPath: nonExistentGen5,
          requireGen5Checkpoint: true,
        })
      ).toThrow(Gen8CandidateIntegrityError);
    });

    it("should refuse real Holdout execution even with approval token (Work 4-4 R4.1 Fail-Closed)", async () => {
      // 承認トークンがコード内に定義されていることだけを実行承認とは見なさない (公式 Checkpoint ロード前に即時遮断)
      await expect(runGen8HoldoutCli(["--execute"])).rejects.toThrow(
        UnauthorizedHoldoutExecutionError
      );

      await expect(
        runGen8HoldoutCli(["--execute", "--approval-token", GEN8_HOLDOUT_APPROVAL_TOKEN])
      ).rejects.toThrow(UnauthorizedHoldoutExecutionError);
    });
  });

  describe("2. 数理統計・検定エンジン & 感度分析", () => {
    it("should compute exact paired match scores across all outcome permutations", () => {
      expect(computePairScore("p1", "p2").pairScore).toBe(1.0);
      expect(computePairScore("p1", "p1").pairScore).toBe(0.5);
      expect(computePairScore("p2", "p2").pairScore).toBe(0.5);
      expect(computePairScore("p2", "p1").pairScore).toBe(0.0);
      expect(computePairScore("draw", "p2").pairScore).toBe(0.75);
      expect(computePairScore("draw", "draw").pairScore).toBe(0.5);
    });

    it("should compute power sensitivity analysis across varying true win rate assumptions", () => {
      const power120 = computeHoldoutPowerSensitivity(120);
      expect(power120.length).toBe(4);
      expect(power120[0].assumedTrueWinRate).toBe(0.55);
      expect(power120[1].assumedTrueWinRate).toBe(0.60);
      expect(power120[2].assumedTrueWinRate).toBe(0.65);
      expect(power120[3].assumedTrueWinRate).toBe(0.70);

      // 真の勝率が高くなるほど検出力が増加する感度特性を確認
      expect(power120[1].statisticalPower).toBeGreaterThan(power120[0].statisticalPower);
      expect(power120[2].statisticalPower).toBeGreaterThan(power120[1].statisticalPower);
      expect(power120[3].statisticalPower).toBeGreaterThan(power120[2].statisticalPower);
    });

    it("should accurately classify SUPERIORITY_VERIFIED, NON_INFERIORITY_VERIFIED, and CONFIRMED_REGRESSION", () => {
      // 1. Superiority Verified
      const superiorPairs: PairedScoreRecord[] = Array.from({ length: 120 }, (_, i) => ({
        pairIndex: i,
        seed: 350001 + i,
        opponentId: "gen7",
        leg0Winner: "p1",
        leg1Winner: i < 90 ? "p2" : "p1", // 90 double wins, 30 splits
        leg0CandidateSeat: "p1",
        leg1CandidateSeat: "p2",
        leg0Score: 1.0,
        leg1Score: i < 90 ? 1.0 : 0.0,
        pairScore: i < 90 ? 1.0 : 0.5,
        leg0TotalDecisions: 20,
        leg1TotalDecisions: 20,
      }));
      const statsSup = computeHoldoutStatistics("gen7", "Gen7", superiorPairs);
      expect(statsSup.isSuperior).toBe(true);
      expect(statsSup.outcomeCategory).toBe("SUPERIORITY_VERIFIED");
      expect(statsSup.confidenceInterval95.lower).toBeGreaterThan(0.50);

      // 2. Confirmed Regression (Cand loses heavily)
      const regressedPairs: PairedScoreRecord[] = Array.from({ length: 120 }, (_, i) => ({
        pairIndex: i,
        seed: 350001 + i,
        opponentId: "gen7",
        leg0Winner: "p2",
        leg1Winner: "p1",
        leg0CandidateSeat: "p1",
        leg1CandidateSeat: "p2",
        leg0Score: 0.0,
        leg1Score: 0.0,
        pairScore: 0.0,
        leg0TotalDecisions: 20,
        leg1TotalDecisions: 20,
      }));
      const statsReg = computeHoldoutStatistics("gen7", "Gen7", regressedPairs);
      expect(statsReg.outcomeCategory).toBe("CONFIRMED_REGRESSION");
      expect(statsReg.confidenceInterval95.upper).toBeLessThan(0.50);
    });

    it("should safely handle boundary conditions (SE === 0 without NaN or crash)", () => {
      const identicalPairs: PairedScoreRecord[] = Array.from({ length: 50 }, (_, i) => ({
        pairIndex: i,
        seed: 350001 + i,
        opponentId: "gen7",
        leg0Winner: "p1",
        leg1Winner: "p2",
        leg0CandidateSeat: "p1",
        leg1CandidateSeat: "p2",
        leg0Score: 1.0,
        leg1Score: 1.0,
        pairScore: 1.0,
        leg0TotalDecisions: 20,
        leg1TotalDecisions: 20,
      }));
      const statsZeroSE = computeHoldoutStatistics("gen7", "Gen7", identicalPairs);
      expect(statsZeroSE.standardError).toBe(0);
      expect(Number.isNaN(statsZeroSE.zScoreSuperiority)).toBe(false);
      expect(statsZeroSE.confidenceInterval95.lower).toBe(1.0);
      expect(statsZeroSE.confidenceInterval95.upper).toBe(1.0);
      expect(statsZeroSE.isSuperior).toBe(true);
    });
  });

  describe("3. プレイヤー別アクション集計の分離検証", () => {
    it("should isolate Candidate vs Opponent metrics cleanly in seat-inverted matches", () => {
      const leg0: CompactMatchOutcomeRecord = {
        schemaVersion: "1.0.0",
        matchIndex: 0,
        pairIndex: 0,
        legIndex: 0,
        matchId: "m0",
        matchupId: "cand-vs-gen7",
        matchSeed: 350001,
        playerSeeds: { p1: 1, p2: 2 },
        p1PolicyId: "gen8-cand",
        p2PolicyId: "gen7",
        status: "COMPLETED",
        completed: true,
        winner: "p1",
        reason: "finished",
        totalDecisions: 20,
        turnCount: 10,
        passDecisions: 3,
        maxConsecutivePasses: 1,
        streamingDecisions: 0,
        maxLegalPatterns: 4,
        instantiationFailures: 0,
        reachedDecisionLimit: false,
        finalStateHash: "h0",
        playerStats: {
          p1: { offeredActions: { "action.attack": 10 }, executedActions: { "action.attack": 7 }, passDecisions: 2 },
          p2: { offeredActions: { "action.throwing": 10 }, executedActions: { "action.throwing": 6 }, passDecisions: 1 },
        },
      };

      const leg1: CompactMatchOutcomeRecord = {
        schemaVersion: "1.0.0",
        matchIndex: 1,
        pairIndex: 0,
        legIndex: 1,
        matchId: "m1",
        matchupId: "cand-vs-gen7",
        matchSeed: 350001,
        playerSeeds: { p1: 2, p2: 1 },
        p1PolicyId: "gen7",
        p2PolicyId: "gen8-cand",
        status: "COMPLETED",
        completed: true,
        winner: "p2",
        reason: "finished",
        totalDecisions: 22,
        turnCount: 11,
        passDecisions: 2,
        maxConsecutivePasses: 1,
        streamingDecisions: 0,
        maxLegalPatterns: 4,
        instantiationFailures: 0,
        reachedDecisionLimit: false,
        finalStateHash: "h1",
        playerStats: {
          p1: { offeredActions: { "action.throwing": 8 }, executedActions: { "action.throwing": 4 }, passDecisions: 1 },
          p2: { offeredActions: { "action.attack": 12 }, executedActions: { "action.attack": 8 }, passDecisions: 1 },
        },
      };

      const comp = computePlayerActionComparison([leg0, leg1], (m) => (m.legIndex === 0 ? "p1" : "p2"));
      expect(comp.candidateMetrics.attacksExecuted).toBe(15); // 7 + 8
      expect(comp.candidateMetrics.attackOpportunities).toBe(22); // 10 + 12
      expect(comp.candidateMetrics.throwingsExecuted).toBe(0);
      expect(comp.opponentMetrics.throwingsExecuted).toBe(10); // 6 + 4
      expect(comp.opponentMetrics.attacksExecuted).toBe(0);
    });
  });

  describe("4. 合成データによる実行・Resume エンジン検証", () => {
    it("should execute synthetic campaign with chunks and checkpointing", async () => {
      const outDir = path.join(tmpRoot, "synthetic-campaign-exec");
      const candDna = createMockDna("cand", 0.8);
      const candDigest = EvolutionIndependentEvaluator.computeDnaDigest(candDna);
      const oppDna = createMockDna("opp", 0.4);
      const oppDigest = EvolutionIndependentEvaluator.computeDnaDigest(oppDna);

      const execRes = await executeGen8HoldoutCampaign({
        candidateDNA: candDna,
        candidateDigest: candDigest,
        opponentDNA: oppDna,
        opponentDigest: oppDigest,
        pairsCount: 2, // 2 pairs = 4 matches
        startSeed: GEN8_HOLDOUT_TEST_SEED_START,
        outputDir: outDir,
        chunkSizeMatches: 2,
        isSyntheticTest: true,
        testExecutionAuthorized: true,
      });

      expect(execRes.completedPairs).toBe(2);
      expect(execRes.totalMatches).toBe(4);
      expect(execRes.auditResult.isValid).toBe(true);
      expect(execRes.auditResult.totalMatches).toBe(4);
      expect(execRes.auditResult.totalPairs).toBe(2);
      expect(fs.existsSync(path.join(outDir, "checkpoint.json"))).toBe(true);
      expect(fs.existsSync(path.join(outDir, "MANIFEST_SHA256.json"))).toBe(true);
    });

    it("should resume seamlessly from intermediate checkpoint", async () => {
      const outDir = path.join(tmpRoot, "synthetic-campaign-resume");
      const candDna = createMockDna("cand", 0.8);
      const candDigest = EvolutionIndependentEvaluator.computeDnaDigest(candDna);
      const oppDna = createMockDna("opp", 0.4);
      const oppDigest = EvolutionIndependentEvaluator.computeDnaDigest(oppDna);

      // Part 1: Run 1 pair (2 matches) out of 2 planned pairs
      await executeGen8HoldoutCampaign({
        candidateDNA: candDna,
        candidateDigest: candDigest,
        opponentDNA: oppDna,
        opponentDigest: oppDigest,
        pairsCount: 2,
        sessionPairsLimit: 1,
        startSeed: GEN8_HOLDOUT_TEST_SEED_START,
        outputDir: outDir,
        chunkSizeMatches: 2,
        isSyntheticTest: true,
        testExecutionAuthorized: true,
      });

      // Part 2: Resume to 2 pairs (4 matches)
      const resumeRes = await executeGen8HoldoutCampaign({
        candidateDNA: candDna,
        candidateDigest: candDigest,
        opponentDNA: oppDna,
        opponentDigest: oppDigest,
        pairsCount: 2,
        startSeed: GEN8_HOLDOUT_TEST_SEED_START,
        outputDir: outDir,
        chunkSizeMatches: 2,
        isSyntheticTest: true,
        testExecutionAuthorized: true,
      });

      expect(resumeRes.completedPairs).toBe(2);
      expect(resumeRes.totalMatches).toBe(4);
      expect(resumeRes.auditResult.isValid).toBe(true);
    });
  });

  describe("5. Evidence 監査 12 大契約の異常系注入テスト (Fail-Closed)", () => {
    it("should detect empty manifest", () => {
      const testDir = path.join(tmpRoot, "anomaly-empty-manifest");
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(path.join(testDir, "MANIFEST_SHA256.json"), "{}", "utf8");

      const res = auditGen8HoldoutArtifacts(testDir);
      expect(res.isValid).toBe(false);
      expect(res.errors.some((e) => e.includes("MANIFEST_SHA256.json is empty"))).toBe(true);
    });

    it("should detect zero matches", () => {
      const testDir = path.join(tmpRoot, "anomaly-zero-matches");
      fs.mkdirSync(path.join(testDir, "chunks"), { recursive: true });
      const manifest = { "chunks/outcomes-chunk-00000.jsonl": "dummy" };
      fs.writeFileSync(path.join(testDir, "MANIFEST_SHA256.json"), JSON.stringify(manifest), "utf8");
      fs.writeFileSync(path.join(testDir, "chunks", "outcomes-chunk-00000.jsonl"), "", "utf8");

      const res = auditGen8HoldoutArtifacts(testDir);
      expect(res.isValid).toBe(false);
      expect(res.errors.some((e) => e.includes("Zero matches found"))).toBe(true);
    });

    it("should detect incomplete matches and never treat them as draws", () => {
      const testDir = path.join(tmpRoot, "anomaly-incomplete-match");
      fs.mkdirSync(path.join(testDir, "chunks"), { recursive: true });

      const incompleteOutcome: CompactMatchOutcomeRecord = {
        schemaVersion: "1.0.0",
        matchIndex: 0,
        pairIndex: 0,
        legIndex: 0,
        matchId: "m0",
        matchupId: "test",
        matchSeed: 350001,
        playerSeeds: { p1: 1, p2: 2 },
        p1PolicyId: "gen8-cand",
        p2PolicyId: "gen7",
        status: "INCOMPLETE",
        completed: false,
        winner: "draw",
        reason: "decision_limit",
        totalDecisions: 500,
        turnCount: 50,
        passDecisions: 10,
        maxConsecutivePasses: 3,
        streamingDecisions: 0,
        maxLegalPatterns: 4,
        instantiationFailures: 0,
        reachedDecisionLimit: true,
        finalStateHash: "h0",
      };

      const chunkPath = path.join(testDir, "chunks", "outcomes-chunk-00000.jsonl");
      fs.writeFileSync(chunkPath, JSON.stringify(incompleteOutcome) + "\n", "utf8");
      const sha = computeFileSha(chunkPath);
      fs.writeFileSync(
        path.join(testDir, "MANIFEST_SHA256.json"),
        JSON.stringify({ "chunks/outcomes-chunk-00000.jsonl": sha }),
        "utf8"
      );

      const res = auditGen8HoldoutArtifacts(testDir);
      expect(res.isValid).toBe(false);
      expect(res.incompleteMatches).toBe(1);
      expect(res.errors.some((e) => e.includes("Incomplete match detected"))).toBe(true);
    });

    it("should detect candidate DNA digest mismatch and reject certification", () => {
      const testDir = path.join(tmpRoot, "anomaly-digest-mismatch");
      fs.mkdirSync(path.join(testDir, "chunks"), { recursive: true });

      const outcome: CompactMatchOutcomeRecord = {
        schemaVersion: "1.0.0",
        matchIndex: 0,
        pairIndex: 0,
        legIndex: 0,
        matchId: "m0",
        matchupId: "test",
        matchSeed: 350001,
        playerSeeds: { p1: 1, p2: 2 },
        p1PolicyId: "gen8-cand",
        p2PolicyId: "gen7",
        p1DnaDigest: "tampered-candidate-digest",
        status: "COMPLETED",
        completed: true,
        winner: "p1",
        reason: "finished",
        totalDecisions: 20,
        turnCount: 10,
        passDecisions: 1,
        maxConsecutivePasses: 1,
        streamingDecisions: 0,
        maxLegalPatterns: 4,
        instantiationFailures: 0,
        reachedDecisionLimit: false,
        finalStateHash: "h0",
      };

      const chunkPath = path.join(testDir, "chunks", "outcomes-chunk-00000.jsonl");
      fs.writeFileSync(chunkPath, JSON.stringify(outcome) + "\n", "utf8");
      const sha = computeFileSha(chunkPath);
      fs.writeFileSync(
        path.join(testDir, "MANIFEST_SHA256.json"),
        JSON.stringify({ "chunks/outcomes-chunk-00000.jsonl": sha }),
        "utf8"
      );

      const res = auditGen8HoldoutArtifacts(testDir, {
        expectedCandidateDigest: GEN8_PRIMARY_CANDIDATE_EXPECTED_DIGEST,
        expectedStartSeed: GEN8_HOLDOUT_TEST_SEED_START,
      });
      expect(res.isValid).toBe(false);
      expect(res.candidateDigestVerified).toBe(false);
      expect(res.errors.some((e) => e.includes("Candidate DNA Digest verification FAILED"))).toBe(true);
    });

    it("should detect missing leg in seat-inverted pair", () => {
      const testDir = path.join(tmpRoot, "anomaly-missing-leg");
      fs.mkdirSync(path.join(testDir, "chunks"), { recursive: true });

      // Only Leg 0, missing Leg 1
      const leg0: CompactMatchOutcomeRecord = {
        schemaVersion: "1.0.0",
        matchIndex: 0,
        pairIndex: 0,
        legIndex: 0,
        matchId: "m0",
        matchupId: "test",
        matchSeed: GEN8_HOLDOUT_TEST_SEED_START,
        playerSeeds: { p1: 1, p2: 2 },
        p1PolicyId: "gen8-cand",
        p2PolicyId: "gen7",
        p1DnaDigest: GEN8_PRIMARY_CANDIDATE_EXPECTED_DIGEST,
        status: "COMPLETED",
        completed: true,
        winner: "p1",
        reason: "finished",
        totalDecisions: 20,
        turnCount: 10,
        passDecisions: 1,
        maxConsecutivePasses: 1,
        streamingDecisions: 0,
        maxLegalPatterns: 4,
        instantiationFailures: 0,
        reachedDecisionLimit: false,
        finalStateHash: "h0",
      };

      const chunkPath = path.join(testDir, "chunks", "outcomes-chunk-00000.jsonl");
      fs.writeFileSync(chunkPath, JSON.stringify(leg0) + "\n", "utf8");
      const sha = computeFileSha(chunkPath);
      fs.writeFileSync(
        path.join(testDir, "MANIFEST_SHA256.json"),
        JSON.stringify({ "chunks/outcomes-chunk-00000.jsonl": sha }),
        "utf8"
      );

      const res = auditGen8HoldoutArtifacts(testDir, {
        expectedCandidateDigest: GEN8_PRIMARY_CANDIDATE_EXPECTED_DIGEST,
        expectedStartSeed: GEN8_HOLDOUT_TEST_SEED_START,
      });
      expect(res.isValid).toBe(false);
      expect(res.errors.some((e) => e.includes("Incomplete seat-inverted pair"))).toBe(true);
    });

    it("should detect invalid winner ID", () => {
      const testDir = path.join(tmpRoot, "anomaly-invalid-winner");
      fs.mkdirSync(path.join(testDir, "chunks"), { recursive: true });

      const invalidWinner: any = {
        schemaVersion: "1.0.0",
        matchIndex: 0,
        pairIndex: 0,
        legIndex: 0,
        matchId: "m0",
        matchupId: "test",
        matchSeed: GEN8_HOLDOUT_TEST_SEED_START,
        playerSeeds: { p1: 1, p2: 2 },
        p1PolicyId: "gen8-cand",
        p2PolicyId: "gen7",
        p1DnaDigest: GEN8_PRIMARY_CANDIDATE_EXPECTED_DIGEST,
        status: "COMPLETED",
        completed: true,
        winner: "p3_invalid",
        reason: "finished",
        totalDecisions: 20,
        turnCount: 10,
        passDecisions: 1,
        maxConsecutivePasses: 1,
        streamingDecisions: 0,
        maxLegalPatterns: 4,
        instantiationFailures: 0,
        reachedDecisionLimit: false,
        finalStateHash: "h0",
      };

      const chunkPath = path.join(testDir, "chunks", "outcomes-chunk-00000.jsonl");
      fs.writeFileSync(chunkPath, JSON.stringify(invalidWinner) + "\n", "utf8");
      const sha = computeFileSha(chunkPath);
      fs.writeFileSync(
        path.join(testDir, "MANIFEST_SHA256.json"),
        JSON.stringify({ "chunks/outcomes-chunk-00000.jsonl": sha }),
        "utf8"
      );

      const res = auditGen8HoldoutArtifacts(testDir, {
        expectedCandidateDigest: GEN8_PRIMARY_CANDIDATE_EXPECTED_DIGEST,
        expectedStartSeed: GEN8_HOLDOUT_TEST_SEED_START,
      });
      expect(res.isValid).toBe(false);
      expect(res.errors.some((e) => e.includes("Invalid winner value"))).toBe(true);
    });
  });

  describe("5. 実 Core 統合 & 小規模テスト & Checkpoint/Resume 厳格検証 (Work 4-4 R3)", () => {
    const candDna = loadGen8PrimaryCandidate();
    const candDigest = GEN8_PRIMARY_CANDIDATE_EXPECTED_DIGEST;
    const testGen7Dna = createMockDna("gen-000007-offspring-000007", 0.77);
    const testGen7Digest = EvolutionIndependentEvaluator.computeDnaDigest(testGen7Dna);

    let pool1Worker: MillionMatchWorkerPool;
    let pool2Workers: MillionMatchWorkerPool;

    beforeAll(async () => {
      const poolZero = DecisionDNACodec.createZeroDecisionDNA({
        id: "zero-dna",
        name: "Zero Baseline",
      });
      const champions = {
        gen7DNA: testGen7Dna,
        gen7Digest: testGen7Digest,
        gen7Source: "test",
        gen5DNA: testGen7Dna,
        gen5Digest: testGen7Digest,
        gen5Source: "test",
        zeroDNA: poolZero,
        zeroDigest: EvolutionIndependentEvaluator.computeDnaDigest(poolZero),
      };

      pool1Worker = await MillionMatchWorkerPool.create({
        workersCount: 1,
        regulationId: "standard-pack",
        frameId: "pack",
        rulesDir: path.resolve("src/data/rules-vnext"),
        maxDecisionsPerMatch: 500,
        champions,
      });

      pool2Workers = await MillionMatchWorkerPool.create({
        workersCount: 2,
        regulationId: "standard-pack",
        frameId: "pack",
        rulesDir: path.resolve("src/data/rules-vnext"),
        maxDecisionsPerMatch: 500,
        champions,
      });
    }, 60000);

    afterAll(async () => {
      if (pool1Worker) await pool1Worker.terminate();
      if (pool2Workers) await pool2Workers.terminate();
    });

    it("should strictly refuse execution on reserved holdout seeds (350001..350300) with comprehensive interval overlap checks", async () => {
      const testDir = path.join(tmpRoot, "refuse-reserved-seed");

      // 1. 下限境界値接触 (startSeed: 350001)
      await expect(
        executeGen8HoldoutCampaign({
          candidateDNA: candDna,
          candidateDigest: candDigest,
          opponentDNA: testGen7Dna,
          opponentDigest: testGen7Digest,
          pairsCount: 1,
          startSeed: GEN8_HOLDOUT_SEED_RANGE_START, // 350001
          outputDir: testDir,
          isRealCoreTest: true,
          testExecutionAuthorized: true,
        })
      ).rejects.toThrow(UnauthorizedHoldoutExecutionError);

      // 2. 上限境界値接触 (startSeed: 350300)
      await expect(
        executeGen8HoldoutCampaign({
          candidateDNA: candDna,
          candidateDigest: candDigest,
          opponentDNA: testGen7Dna,
          opponentDigest: testGen7Digest,
          pairsCount: 1,
          startSeed: GEN8_HOLDOUT_SEED_RANGE_END, // 350300
          outputDir: testDir,
          isRealCoreTest: true,
          testExecutionAuthorized: true,
        })
      ).rejects.toThrow(UnauthorizedHoldoutExecutionError);

      // 3. 予約範囲の完全包含 (startSeed: 349900, pairsCount: 500 => 349900..350399)
      await expect(
        executeGen8HoldoutCampaign({
          candidateDNA: candDna,
          candidateDigest: candDigest,
          opponentDNA: testGen7Dna,
          opponentDigest: testGen7Digest,
          pairsCount: 500,
          startSeed: 349900,
          outputDir: testDir,
          isRealCoreTest: true,
          testExecutionAuthorized: true,
        })
      ).rejects.toThrow(UnauthorizedHoldoutExecutionError);

      // 4. 上方部分重複 (startSeed: 350290, pairsCount: 20 => 350290..350309)
      await expect(
        executeGen8HoldoutCampaign({
          candidateDNA: candDna,
          candidateDigest: candDigest,
          opponentDNA: testGen7Dna,
          opponentDigest: testGen7Digest,
          pairsCount: 20,
          startSeed: 350290,
          outputDir: testDir,
          isRealCoreTest: true,
          testExecutionAuthorized: true,
        })
      ).rejects.toThrow(UnauthorizedHoldoutExecutionError);
    });

    it("should execute real Core matches with MillionMatchWorkerPool on test seeds (360001) and produce valid audited evidence", async () => {
      const testDir = path.join(tmpRoot, "real-core-small-test");
      const res = await executeGen8HoldoutCampaign({
        candidateDNA: candDna,
        candidateDigest: candDigest,
        opponentDNA: testGen7Dna,
        opponentDigest: testGen7Digest,
        pairsCount: 2, // 2 pairs = 4 matches
        startSeed: 360001,
        outputDir: testDir,
        chunkSizeMatches: 10,
        workerPool: pool2Workers,
        isRealCoreTest: true,
        testExecutionAuthorized: true,
      });

      expect(res.completedPairs).toBe(2);
      expect(res.totalMatches).toBe(4);
      expect(res.auditResult.isValid).toBe(true);
      expect(res.auditResult.errors.length).toBe(0);
      expect(res.auditResult.completedMatches).toBe(4);

      // JSONL から実際の Core 結果が記録されていることを検証
      const chunkFile = path.join(testDir, "chunks", "outcomes-chunk-00000.jsonl");
      expect(fs.existsSync(chunkFile)).toBe(true);
      const lines = fs.readFileSync(chunkFile, "utf8").trim().split("\n");
      expect(lines.length).toBe(4);

      const m0: CompactMatchOutcomeRecord = JSON.parse(lines[0]);
      expect(m0.status).toBe("COMPLETED");
      expect(m0.completed).toBe(true);
      expect(["p1", "p2", "draw"]).toContain(m0.winner);
      expect(m0.finalStateHash).toBeDefined();
      expect(m0.finalStateHash.length).toBeGreaterThan(0);
      // 固定 State Hash ではなく Core の実 State Hash であること
      expect(m0.finalStateHash.startsWith("hash-m")).toBe(false);
      // プレイヤー別アクション統計が実際に記録されていること
      expect(m0.playerStats).toBeDefined();
      expect(m0.playerStats?.p1.passDecisions).toBeDefined();
      expect(m0.playerStats?.p1.executedActions).toBeDefined();
    }, 30000);

    it("should produce deterministic identical results between 1 Worker and 2 Workers", async () => {
      const dir1Worker = path.join(tmpRoot, "workers-1");
      const dir2Workers = path.join(tmpRoot, "workers-2");

      const res1 = await executeGen8HoldoutCampaign({
        candidateDNA: candDna,
        candidateDigest: candDigest,
        opponentDNA: testGen7Dna,
        opponentDigest: testGen7Digest,
        pairsCount: 1, // 1 pair = 2 matches (Leg 0 & Leg 1)
        startSeed: 360010,
        outputDir: dir1Worker,
        chunkSizeMatches: 10,
        workerPool: pool1Worker,
        isRealCoreTest: true,
        testExecutionAuthorized: true,
      });

      const res2 = await executeGen8HoldoutCampaign({
        candidateDNA: candDna,
        candidateDigest: candDigest,
        opponentDNA: testGen7Dna,
        opponentDigest: testGen7Digest,
        pairsCount: 1,
        startSeed: 360010,
        outputDir: dir2Workers,
        chunkSizeMatches: 10,
        workerPool: pool2Workers,
        isRealCoreTest: true,
        testExecutionAuthorized: true,
      });

      expect(res1.auditResult.isValid).toBe(true);
      expect(res2.auditResult.isValid).toBe(true);

      const chunk1 = fs.readFileSync(path.join(dir1Worker, "chunks", "outcomes-chunk-00000.jsonl"), "utf8");
      const chunk2 = fs.readFileSync(path.join(dir2Workers, "chunks", "outcomes-chunk-00000.jsonl"), "utf8");
      expect(chunk1).toBe(chunk2);
    }, 30000);

    it("should resume seamlessly from checkpoint without match loss or duplication", async () => {
      const resumeDir = path.join(tmpRoot, "real-core-resume");

      // 1 回目: 2 pairs 予定中、1 pair のみ実行 (chunkSize: 2 = 1 pair で chunk 生成)
      await executeGen8HoldoutCampaign({
        candidateDNA: candDna,
        candidateDigest: candDigest,
        opponentDNA: testGen7Dna,
        opponentDigest: testGen7Digest,
        pairsCount: 2,
        sessionPairsLimit: 1,
        startSeed: 360020,
        outputDir: resumeDir,
        chunkSizeMatches: 2,
        workerPool: pool1Worker,
        isRealCoreTest: true,
        testExecutionAuthorized: true,
      });

      const ckpt1 = JSON.parse(fs.readFileSync(path.join(resumeDir, "checkpoint.json"), "utf8"));
      expect(ckpt1.completedPairsCount).toBe(1);
      expect(ckpt1.completedChunks.length).toBe(1);

      // 2 回目: 残り 1 pair を Resume 実行して 2 pairs (4 matches) 完了
      const resResume = await executeGen8HoldoutCampaign({
        candidateDNA: candDna,
        candidateDigest: candDigest,
        opponentDNA: testGen7Dna,
        opponentDigest: testGen7Digest,
        pairsCount: 2,
        startSeed: 360020,
        outputDir: resumeDir,
        chunkSizeMatches: 2,
        workerPool: pool1Worker,
        isRealCoreTest: true,
        testExecutionAuthorized: true,
      });

      expect(resResume.completedPairs).toBe(2);
      expect(resResume.totalMatches).toBe(4);
      expect(resResume.auditResult.isValid).toBe(true);
      expect(resResume.auditResult.completedMatches).toBe(4);
    }, 30000);

    it("should fail closed on corrupted chunk SHA or altered checkpoint config", async () => {
      const corruptDir = path.join(tmpRoot, "corrupt-resume");
      await executeGen8HoldoutCampaign({
        candidateDNA: candDna,
        candidateDigest: candDigest,
        opponentDNA: testGen7Dna,
        opponentDigest: testGen7Digest,
        pairsCount: 2,
        sessionPairsLimit: 1,
        startSeed: 360030,
        outputDir: corruptDir,
        chunkSizeMatches: 2,
        workerPool: pool1Worker,
        isRealCoreTest: true,
        testExecutionAuthorized: true,
      });

      // チャンク改竄 (末尾に空白追加)
      const chunkFile = path.join(corruptDir, "chunks", "outcomes-chunk-00000.jsonl");
      fs.appendFileSync(chunkFile, "\n", "utf8");

      await expect(
        executeGen8HoldoutCampaign({
          candidateDNA: candDna,
          candidateDigest: candDigest,
          opponentDNA: testGen7Dna,
          opponentDigest: testGen7Digest,
          pairsCount: 2,
          startSeed: 360030,
          outputDir: corruptDir,
          chunkSizeMatches: 2,
          workerPool: pool1Worker,
          isRealCoreTest: true,
          testExecutionAuthorized: true,
        })
      ).rejects.toThrow(Gen8HoldoutAuditError);
    }, 30000);

    it("should allow repeating Resume with identical sessionPairsLimit to finish all pairs with IN_PROGRESS and then AUDIT_PASSED", async () => {
      const stepDir = path.join(tmpRoot, "step-resume-test");

      // 1回目: 2 pairs 予定中、sessionPairsLimit: 1 で 1 pair 実行
      const res1 = await executeGen8HoldoutCampaign({
        candidateDNA: candDna,
        candidateDigest: candDigest,
        opponentDNA: testGen7Dna,
        opponentDigest: testGen7Digest,
        pairsCount: 2,
        sessionPairsLimit: 1,
        startSeed: 360040,
        outputDir: stepDir,
        chunkSizeMatches: 2,
        workerPool: pool1Worker,
        isRealCoreTest: true,
        testExecutionAuthorized: true,
      });

      expect(res1.completedPairs).toBe(1);
      expect(res1.totalMatches).toBe(2);
      expect(res1.auditResult.isValid).toBe(false);
      expect(res1.auditResult.auditStatus).toBe("IN_PROGRESS");

      // 2回目: 同一の sessionPairsLimit: 1 を指定して Resume 実行 -> 2 pairs 完走
      const res2 = await executeGen8HoldoutCampaign({
        candidateDNA: candDna,
        candidateDigest: candDigest,
        opponentDNA: testGen7Dna,
        opponentDigest: testGen7Digest,
        pairsCount: 2,
        sessionPairsLimit: 1,
        startSeed: 360040,
        outputDir: stepDir,
        chunkSizeMatches: 2,
        workerPool: pool1Worker,
        isRealCoreTest: true,
        testExecutionAuthorized: true,
      });

      expect(res2.completedPairs).toBe(2);
      expect(res2.totalMatches).toBe(4);
      expect(res2.auditResult.isValid).toBe(true);
      expect(res2.auditResult.auditStatus).toBe("AUDIT_PASSED");
      expect(res2.auditResult.completedMatches).toBe(4);
    }, 30000);

    it("should fail closed when checkpoint index is inconsistent (nextPairIndex !== completedPairsCount)", async () => {
      const corruptIndexDir = path.join(tmpRoot, "corrupt-index");
      await executeGen8HoldoutCampaign({
        candidateDNA: candDna,
        candidateDigest: candDigest,
        opponentDNA: testGen7Dna,
        opponentDigest: testGen7Digest,
        pairsCount: 2,
        sessionPairsLimit: 1,
        startSeed: 360042,
        outputDir: corruptIndexDir,
        chunkSizeMatches: 2,
        workerPool: pool1Worker,
        isRealCoreTest: true,
        testExecutionAuthorized: true,
      });

      const ckptPath = path.join(corruptIndexDir, "checkpoint.json");
      const rawCkpt = JSON.parse(fs.readFileSync(ckptPath, "utf8"));
      rawCkpt.nextPairIndex = 999; // 不整合
      const { checksum, ...rest } = rawCkpt;
      rawCkpt.checksum = computeHoldoutCheckpointChecksum(rest);
      fs.writeFileSync(ckptPath, JSON.stringify(rawCkpt, null, 2), "utf8");

      await expect(
        executeGen8HoldoutCampaign({
          candidateDNA: candDna,
          candidateDigest: candDigest,
          opponentDNA: testGen7Dna,
          opponentDigest: testGen7Digest,
          pairsCount: 2,
          startSeed: 360042,
          outputDir: corruptIndexDir,
          chunkSizeMatches: 2,
          workerPool: pool1Worker,
          isRealCoreTest: true,
          testExecutionAuthorized: true,
        })
      ).rejects.toThrow(Gen8HoldoutAuditError);
    }, 30000);

    it("should fail closed when checkpoint gitCommitSha is altered", async () => {
      const corruptGitDir = path.join(tmpRoot, "corrupt-git-sha");
      await executeGen8HoldoutCampaign({
        candidateDNA: candDna,
        candidateDigest: candDigest,
        opponentDNA: testGen7Dna,
        opponentDigest: testGen7Digest,
        pairsCount: 2,
        sessionPairsLimit: 1,
        startSeed: 360044,
        outputDir: corruptGitDir,
        chunkSizeMatches: 2,
        workerPool: pool1Worker,
        isRealCoreTest: true,
        testExecutionAuthorized: true,
      });

      const ckptPath = path.join(corruptGitDir, "checkpoint.json");
      const rawCkpt = JSON.parse(fs.readFileSync(ckptPath, "utf8"));
      rawCkpt.gitCommitSha = "tampered_git_commit_sha_000000";
      const { checksum, ...rest } = rawCkpt;
      rawCkpt.checksum = computeHoldoutCheckpointChecksum(rest);
      fs.writeFileSync(ckptPath, JSON.stringify(rawCkpt, null, 2), "utf8");

      await expect(
        executeGen8HoldoutCampaign({
          candidateDNA: candDna,
          candidateDigest: candDigest,
          opponentDNA: testGen7Dna,
          opponentDigest: testGen7Digest,
          pairsCount: 2,
          startSeed: 360044,
          outputDir: corruptGitDir,
          chunkSizeMatches: 2,
          workerPool: pool1Worker,
          isRealCoreTest: true,
          testExecutionAuthorized: true,
        })
      ).rejects.toThrow(Gen8HoldoutAuditError);
    }, 30000);

    it("should strictly fail closed if official holdout configuration is tampered without test authorization flags", async () => {
      // 1. 本番モードでの expected-gen7-digest 改竄の試行
      await expect(
        runGen8HoldoutCli(["--plan-only", "--expected-gen7-digest", "tampered_digest_12345"])
      ).rejects.toThrow(Gen8CandidateIntegrityError);

      // 2. 本番モードでの pairsCount 変更の試行
      await expect(
        runGen8HoldoutCli(["--plan-only", "--pairs", "60"])
      ).rejects.toThrow(Gen8CandidateIntegrityError);

      // 3. 本番モードでの startSeed 変更の試行
      await expect(
        runGen8HoldoutCli(["--plan-only", "--start-seed", "360001"])
      ).rejects.toThrow(Gen8CandidateIntegrityError);
    });

    it("should connect runGen8HoldoutCli --execute cleanly for tests and fail-closed for unauthorized production seeds", async () => {
      const cliTestDir = path.join(tmpRoot, "cli-exec-test");

      // 1. 本番実行試行は未承認エラー (Fail-Closed)
      await expect(
        runGen8HoldoutCli(["--execute", "--pairs", "10", "--output-dir", cliTestDir])
      ).rejects.toThrow(UnauthorizedHoldoutExecutionError);

      await expect(
        runGen8HoldoutCli([
          "--execute",
          "--approval-token",
          GEN8_HOLDOUT_APPROVAL_TOKEN,
          "--pairs",
          "10",
          "--output-dir",
          cliTestDir,
        ])
      ).rejects.toThrow(UnauthorizedHoldoutExecutionError);

      // 2. 合成テストフラグ付きで正常実行
      await runGen8HoldoutCli([
        "--execute",
        "--allow-synthetic-execution-test",
        "--pairs",
        "1",
        "--output-dir",
        cliTestDir,
        "--candidate-path",
        GEN8_PRIMARY_CANDIDATE_FILE_PATH,
        "--gen7-checkpoint",
        fixtureGen7Path,
        "--expected-gen7-digest",
        fixtureGen7Digest,
      ]);

      expect(fs.existsSync(path.join(cliTestDir, "checkpoint.json"))).toBe(true);
      expect(fs.existsSync(path.join(cliTestDir, "MANIFEST_SHA256.json"))).toBe(true);

      // 3. --audit-only モードの実行
      await runGen8HoldoutCli([
        "--audit-only",
        "--allow-synthetic-execution-test",
        "--pairs",
        "1",
        "--output-dir",
        cliTestDir,
        "--expected-gen7-digest",
        fixtureGen7Digest,
      ]);
    }, 30000);
  });
});
