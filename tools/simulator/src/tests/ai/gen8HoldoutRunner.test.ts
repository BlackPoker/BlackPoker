/**
 * BlackPoker Work 4-4 — Gen 8 Official Holdout Runner & Statistical Audit Unit Tests
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
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
  auditGen8HoldoutArtifacts,
  normalCdf,
  runGen8HoldoutCli,
  PairedScoreRecord,
} from "../../cli/gen8HoldoutRunner";
import { CompactMatchOutcomeRecord } from "../../domain/simulation/MillionMatchInfraTypes";

describe("BlackPoker Work 4-4 — Gen 8 Official Holdout Runner & Statistical Evaluation", () => {
  describe("1. Candidate DNA & Preflight Manifest", () => {
    it("should load the Gen 8 Primary Candidate DNA and verify exact SHA-256 digest match", () => {
      const dna = loadGen8PrimaryCandidate();
      expect(dna).toBeDefined();
      expect(dna.featureSchemaVersion).toBe(6);
      expect(dna.patternWeights).toBeDefined();
    });

    it("should fail closed if DNA file does not exist or digest is tampered", () => {
      expect(() => loadGen8PrimaryCandidate("non-existent-path.json")).toThrow(
        Gen8CandidateIntegrityError
      );
    });

    it("should build preflight manifest in PLAN_ONLY mode with 100% matched digests and power analysis", () => {
      const manifest = buildGen8HoldoutPreflightManifest({
        executionMode: "PLAN_ONLY",
        plannedPairs: 120,
      });

      expect(manifest.workId).toBe(GEN8_HOLDOUT_WORK_ID);
      expect(manifest.executionMode).toBe("PLAN_ONLY");
      expect(manifest.approvalStatus).toBe("NOT_APPROVED_EXECUTION_BLOCKED");
      expect(manifest.candidateChampion.genomeId).toBe(GEN8_PRIMARY_CANDIDATE_GENOME_ID);
      expect(manifest.candidateChampion.expectedDigest).toBe(GEN8_PRIMARY_CANDIDATE_EXPECTED_DIGEST);
      expect(manifest.candidateChampion.digestMatches).toBe(true);

      expect(manifest.referenceAnchorGen7.digestMatches).toBe(true);
      expect(manifest.referenceAnchorGen5.digestMatches).toBe(true);

      expect(manifest.seedRange.startSeed).toBe(GEN8_HOLDOUT_SEED_RANGE_START);
      expect(manifest.seedRange.endSeed).toBe(GEN8_HOLDOUT_SEED_RANGE_END);
      expect(manifest.seedRange.totalAvailableSeeds).toBe(300);
      expect(manifest.seedRange.historicalCollisionCount).toBe(0);

      expect(manifest.hypothesisGate.plannedPairs).toBe(120);
      expect(manifest.hypothesisGate.plannedMatches).toBe(240);
      expect(manifest.hypothesisGate.statisticalPowerForP065).toBeGreaterThan(0.90);
    });

    it("should refuse execution (--mode EXECUTE) without approval token (Fail-Closed)", async () => {
      await expect(runGen8HoldoutCli(["--execute"])).rejects.toThrow(
        UnauthorizedHoldoutExecutionError
      );

      await expect(
        runGen8HoldoutCli(["--execute", "--approval-token", "INVALID_TOKEN"])
      ).rejects.toThrow(UnauthorizedHoldoutExecutionError);
    });
  });

  describe("2. Mathematical & Statistical Evaluation Engine", () => {
    it("should compute exact paired match scores across all outcome permutations", () => {
      // Leg 0: Cand=P1, Leg 1: Cand=P2
      // 1. Both wins
      const bothWins = computePairScore("p1", "p2");
      expect(bothWins.leg0Score).toBe(1.0);
      expect(bothWins.leg1Score).toBe(1.0);
      expect(bothWins.pairScore).toBe(1.0);

      // 2. Split (Win Leg 0, Lose Leg 1)
      const split0 = computePairScore("p1", "p1");
      expect(split0.leg0Score).toBe(1.0);
      expect(split0.leg1Score).toBe(0.0);
      expect(split0.pairScore).toBe(0.5);

      // 3. Split (Lose Leg 0, Win Leg 1)
      const split1 = computePairScore("p2", "p2");
      expect(split1.leg0Score).toBe(0.0);
      expect(split1.leg1Score).toBe(1.0);
      expect(split1.pairScore).toBe(0.5);

      // 4. Both loses
      const bothLosses = computePairScore("p2", "p1");
      expect(bothLosses.leg0Score).toBe(0.0);
      expect(bothLosses.leg1Score).toBe(0.0);
      expect(bothLosses.pairScore).toBe(0.0);

      // 5. Draw on Leg 0, Win on Leg 1
      const drawAndWin = computePairScore("draw", "p2");
      expect(drawAndWin.leg0Score).toBe(0.5);
      expect(drawAndWin.leg1Score).toBe(1.0);
      expect(drawAndWin.pairScore).toBe(0.75);

      // 6. Draw on both
      const bothDraw = computePairScore("draw", "draw");
      expect(bothDraw.leg0Score).toBe(0.5);
      expect(bothDraw.leg1Score).toBe(0.5);
      expect(bothDraw.pairScore).toBe(0.5);
    });

    it("should accurately compute two-sided 95% CI, Superiority, and Non-Inferiority on 120 pairs", () => {
      // Scenario A: Candidate achieves 75% win rate (60 double wins, 60 splits)
      const pairsA: PairedScoreRecord[] = [];
      for (let i = 0; i < 60; i++) {
        pairsA.push({
          pairIndex: i,
          seed: 350001 + i,
          opponentId: "gen7-champion",
          leg0Winner: "p1",
          leg1Winner: "p2",
          leg0CandidateSeat: "p1",
          leg1CandidateSeat: "p2",
          leg0Score: 1.0,
          leg1Score: 1.0,
          pairScore: 1.0,
          leg0TotalDecisions: 25,
          leg1TotalDecisions: 28,
        });
      }
      for (let i = 60; i < 120; i++) {
        pairsA.push({
          pairIndex: i,
          seed: 350001 + i,
          opponentId: "gen7-champion",
          leg0Winner: "p1",
          leg1Winner: "p1",
          leg0CandidateSeat: "p1",
          leg1CandidateSeat: "p2",
          leg0Score: 1.0,
          leg1Score: 0.0,
          pairScore: 0.5,
          leg0TotalDecisions: 30,
          leg1TotalDecisions: 35,
        });
      }

      const statsA = computeHoldoutStatistics("gen7-champion", "Stage3Gen7Champion", pairsA);
      expect(statsA.totalPairs).toBe(120);
      expect(statsA.totalMatches).toBe(240);
      expect(statsA.meanPairScore).toBe(0.75);
      expect(statsA.matchWinRate).toBe(0.75);
      expect(statsA.confidenceInterval95.lower).toBeGreaterThan(0.68);
      expect(statsA.confidenceInterval95.lower).toBeGreaterThan(0.50);
      expect(statsA.isSuperior).toBe(true);
      expect(statsA.isNonInferior).toBe(true);
      expect(statsA.pValueSuperiority).toBeLessThan(0.0001);

      // Scenario B: Inconclusive performance (Mean score = 0.51, high variance)
      const pairsB: PairedScoreRecord[] = [];
      for (let i = 0; i < 61; i++) {
        pairsB.push({
          pairIndex: i,
          seed: 350001 + i,
          opponentId: "gen7-champion",
          leg0Winner: "p1",
          leg1Winner: "p2",
          leg0CandidateSeat: "p1",
          leg1CandidateSeat: "p2",
          leg0Score: 1.0,
          leg1Score: 1.0,
          pairScore: 1.0,
          leg0TotalDecisions: 20,
          leg1TotalDecisions: 20,
        });
      }
      for (let i = 61; i < 120; i++) {
        pairsB.push({
          pairIndex: i,
          seed: 350001 + i,
          opponentId: "gen7-champion",
          leg0Winner: "p2",
          leg1Winner: "p1",
          leg0CandidateSeat: "p1",
          leg1CandidateSeat: "p2",
          leg0Score: 0.0,
          leg1Score: 0.0,
          pairScore: 0.0,
          leg0TotalDecisions: 20,
          leg1TotalDecisions: 20,
        });
      }

      const statsB = computeHoldoutStatistics("gen7-champion", "Stage3Gen7Champion", pairsB);
      expect(statsB.confidenceInterval95.lower).toBeLessThan(0.50);
      expect(statsB.isSuperior).toBe(false); // Superiority requires lower CI > 0.50
    });
  });

  describe("3. Player Action Breakdown (Candidate vs Opponent Isolation)", () => {
    it("should strictly isolate Candidate vs Opponent offered, executed, and adoption metrics across seat-inverted legs", () => {
      const matchLeg0: CompactMatchOutcomeRecord = {
        schemaVersion: "1.0.0",
        matchIndex: 0,
        pairIndex: 0,
        legIndex: 0,
        matchId: "match-0",
        matchupId: "cand-vs-gen7",
        matchSeed: 350001,
        playerSeeds: { p1: 100, p2: 200 },
        p1PolicyId: "gen8-candidate",
        p2PolicyId: "gen7-champion",
        status: "COMPLETED",
        completed: true,
        winner: "p1",
        reason: "finished",
        totalDecisions: 30,
        turnCount: 15,
        passDecisions: 4,
        maxConsecutivePasses: 1,
        streamingDecisions: 0,
        maxLegalPatterns: 5,
        instantiationFailures: 0,
        reachedDecisionLimit: false,
        finalStateHash: "hash-0",
        playerStats: {
          p1: {
            offeredActions: { "action.attack": 10, "action.throwing": 4, PASS: 10 },
            executedActions: { "action.attack": 5, "action.throwing": 2, PASS: 3 },
            passDecisions: 3,
          },
          p2: {
            offeredActions: { "action.attack": 8, "action.throwing": 8, PASS: 8 },
            executedActions: { "action.attack": 1, "action.throwing": 6, PASS: 1 },
            passDecisions: 1,
          },
        },
      };

      const matchLeg1: CompactMatchOutcomeRecord = {
        schemaVersion: "1.0.0",
        matchIndex: 1,
        pairIndex: 0,
        legIndex: 1,
        matchId: "match-1",
        matchupId: "cand-vs-gen7",
        matchSeed: 350001,
        playerSeeds: { p1: 200, p2: 100 },
        p1PolicyId: "gen7-champion",
        p2PolicyId: "gen8-candidate",
        status: "COMPLETED",
        completed: true,
        winner: "p2",
        reason: "finished",
        totalDecisions: 35,
        turnCount: 18,
        passDecisions: 6,
        maxConsecutivePasses: 2,
        streamingDecisions: 0,
        maxLegalPatterns: 5,
        instantiationFailures: 0,
        reachedDecisionLimit: false,
        finalStateHash: "hash-1",
        playerStats: {
          p1: {
            offeredActions: { "action.attack": 7, "action.throwing": 7, PASS: 7 },
            executedActions: { "action.attack": 2, "action.throwing": 5, PASS: 2 },
            passDecisions: 2,
          },
          p2: {
            offeredActions: { "action.attack": 11, "action.throwing": 3, PASS: 11 },
            executedActions: { "action.attack": 6, "action.throwing": 1, PASS: 4 },
            passDecisions: 4,
          },
        },
      };

      const comparison = computePlayerActionComparison(
        [matchLeg0, matchLeg1],
        (m) => (m.legIndex === 0 ? "p1" : "p2")
      );

      // Candidate:
      // Leg 0 (P1): 5 attacks, 2 throwings, 3 passes. Opportunities: 10 attacks, 4 throwings
      // Leg 1 (P2): 6 attacks, 1 throwing, 4 passes. Opportunities: 11 attacks, 3 throwings
      // Totals: attacks=11/21, throwings=3/7, passes=7
      expect(comparison.candidateMetrics.attacksExecuted).toBe(11);
      expect(comparison.candidateMetrics.attackOpportunities).toBe(21);
      expect(comparison.candidateMetrics.attackAdoptionRate).toBeCloseTo(11 / 21, 4);

      expect(comparison.candidateMetrics.throwingsExecuted).toBe(3);
      expect(comparison.candidateMetrics.throwingOpportunities).toBe(7);
      expect(comparison.candidateMetrics.throwingAdoptionRate).toBeCloseTo(3 / 7, 4);

      expect(comparison.candidateMetrics.passDecisions).toBe(7);

      // Opponent:
      // Leg 0 (P2): 1 attack, 6 throwings, 1 pass. Opportunities: 8 attacks, 8 throwings
      // Leg 1 (P1): 2 attacks, 5 throwings, 2 passes. Opportunities: 7 attacks, 7 throwings
      // Totals: attacks=3/15, throwings=11/15, passes=3
      expect(comparison.opponentMetrics.attacksExecuted).toBe(3);
      expect(comparison.opponentMetrics.attackOpportunities).toBe(15);
      expect(comparison.opponentMetrics.attackAdoptionRate).toBeCloseTo(3 / 15, 4);

      expect(comparison.opponentMetrics.throwingsExecuted).toBe(11);
      expect(comparison.opponentMetrics.throwingOpportunities).toBe(15);
      expect(comparison.opponentMetrics.throwingAdoptionRate).toBeCloseTo(11 / 15, 4);

      expect(comparison.opponentMetrics.passDecisions).toBe(3);

      // Attack vs Throwing ratio:
      // Cand: 11 / (11 + 3) = 11 / 14 = 78.57% attack ratio
      // Opp: 3 / (3 + 11) = 3 / 14 = 21.43% attack ratio
      expect(comparison.attackVsThrowingRatio.candidate).toBeCloseTo(11 / 14, 4);
      expect(comparison.attackVsThrowingRatio.opponent).toBeCloseTo(3 / 14, 4);
    });
  });

  describe("4. Holdout Artifacts Audit Integrity", () => {
    it("should audit holdout artifacts directory and detect corrupt or missing files", () => {
      const tmpDir = path.join(os.tmpdir(), "bp-holdout-audit-test-" + Date.now());
      fs.mkdirSync(tmpDir, { recursive: true });

      try {
        const manifest = {
          "chunks/outcomes-chunk-00000.jsonl": "bad-hash",
        };
        fs.writeFileSync(path.join(tmpDir, "MANIFEST_SHA256.json"), JSON.stringify(manifest), "utf8");

        const auditRes = auditGen8HoldoutArtifacts(tmpDir);
        expect(auditRes.isValid).toBe(false);
        expect(auditRes.errors.length).toBeGreaterThan(0);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
