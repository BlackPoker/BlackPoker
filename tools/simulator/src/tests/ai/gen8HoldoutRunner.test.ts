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
  GEN8_HOLDOUT_APPROVAL_TOKEN,
  GEN8_HOLDOUT_SEED_RANGE_START,
  GEN8_HOLDOUT_SEED_RANGE_END,
  DEFAULT_PRIMARY_PAIRS,
  UnauthorizedHoldoutExecutionError,
  Gen8CandidateIntegrityError,
  loadGen8PrimaryCandidate,
  buildGen8HoldoutPreflightManifest,
  computePairScore,
  computeHoldoutStatistics,
  computePlayerActionComparison,
  computeHoldoutPowerSensitivity,
  auditGen8HoldoutArtifacts,
  executeGen8HoldoutCampaign,
  runGen8HoldoutCli,
  PairedScoreRecord,
} from "../../cli/gen8HoldoutRunner";
import { CompactMatchOutcomeRecord } from "../../domain/simulation/MillionMatchInfraTypes";
import { DecisionDNACodec } from "../../engine/ai/DecisionDNACodec";
import { EvolutionIndependentEvaluator } from "../../engine/ai/EvolutionIndependentEvaluator";
import { EvolutionCampaignManager } from "../../engine/ai/EvolutionCampaignManager";

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
          executionMode: "EXECUTE",
          requireOfficialCheckpoints: true,
          gen7CheckpointPath: path.join(tmpRoot, "non-existent-official.json"),
        })
      ).toThrow(Gen8CandidateIntegrityError);
    });

    it("should refuse real Holdout execution even with approval token (Work 4-4 R2 Fail-Closed)", async () => {
      // 承認トークンがコード内に定義されていることだけを実行承認とは見なさない
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
        startSeed: 350001,
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

      // Part 1: Run 1 pair (2 matches)
      await executeGen8HoldoutCampaign({
        candidateDNA: candDna,
        candidateDigest: candDigest,
        opponentDNA: oppDna,
        opponentDigest: oppDigest,
        pairsCount: 1,
        startSeed: 350001,
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
        startSeed: 350001,
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
        matchSeed: 350001,
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
        matchSeed: 350001,
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
      });
      expect(res.isValid).toBe(false);
      expect(res.errors.some((e) => e.includes("Invalid winner value"))).toBe(true);
    });
  });
});
