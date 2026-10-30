import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import * as fs from "fs";
import { loadRegulationCatalog } from "../../engine/regulation/RegulationLoader";
import { RegulationValidator } from "../../engine/regulation/RegulationValidator";
import { RegulationRulePackageSelector } from "../../engine/regulation/RegulationRulePackageSelector";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { OfficialRegulationMatchFactory } from "../../engine/regulation/OfficialRegulationMatchFactory";
import { DecisionDNACodec } from "../../engine/ai/DecisionDNACodec";
import { DecisionFeatureEncoder } from "../../engine/ai/DecisionFeatureEncoder";
import { SemanticFingerprintCalculator } from "../../engine/ai/SemanticFingerprintCalculator";
import { SimulationRunner } from "../../engine/simulation/SimulationRunner";
import { GenomePolicy } from "../../engine/ai/GenomePolicy";
import { GameSessionSnapshotCodec, GameSessionSnapshotValidationError } from "../../engine/session/GameSessionSnapshotCodec";
import { DecisionRequest } from "../../domain/decision/DecisionRequest";
import { LegalPattern } from "../../domain/decision/LegalPattern";
import { DecisionCatalog } from "../../domain/decision/DecisionCatalog";
import { PlayerObservation, PlayerObservationView } from "../../domain/decision/PlayerObservation";

describe("v9.2 Core & AI Baseline Re-Evaluation Evidence Test Suite (BP-SIM-AI-V92-BASELINE-EVIDENCE-V1-R1)", () => {
  let catalog: any;
  let fullRulePackage: any;
  let lightRulePackage: any;
  let lightSessionFactory: any;

  beforeAll(async () => {
    catalog = await loadRegulationCatalog();
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    fullRulePackage = await loadRulePackageFromDirectory(rulesDir);

    const validation = RegulationValidator.validateRegulation(catalog, "light-entry16", { assertImplemented: true });
    lightRulePackage = RegulationRulePackageSelector.selectRulePackage(
      fullRulePackage,
      validation.format!,
      validation.regulation!,
      validation.frame!
    );
    lightSessionFactory = await OfficialRegulationMatchFactory.prepareSessionFactory("light-entry16", {
      catalog,
      fullRulePackage,
    });
  });

  describe("Group 1: Feature Compatibility & Semantic Fingerprint Sensitivity Audit", () => {
    const p1View: PlayerObservationView = {
      playerId: "p1",
      name: "Player A",
      isViewer: true,
      lifeCount: 5,
      lifeDisplay: "5",
      handCount: 2,
      handCards: [],
      field: [],
      fog: [],
      trumps: [],
      graveCount: 0,
      grave: [],
      canViewFullGrave: true,
    };

    const p2View: PlayerObservationView = {
      playerId: "p2",
      name: "Player B",
      isViewer: false,
      lifeCount: 5,
      lifeDisplay: "5",
      handCount: 2,
      handCards: [],
      field: [],
      fog: [],
      trumps: [],
      graveCount: 0,
      grave: [],
      canViewFullGrave: false,
    };

    const baseObs1: PlayerObservation = {
      viewerPlayerId: "p1",
      turnPlayerId: "p1",
      chancePlayerId: "p1",
      focusPlayerId: "p1",
      turnCount: 1,
      players: [p1View, p2View],
      stageRequestRefs: [],
      stageRequests: [],
      recentEvents: [],
    };

    const baseObs2: PlayerObservation = {
      ...baseObs1,
      focusPlayerId: "p2", // focusPlayerId differs
    };

    const patterns: LegalPattern[] = [
      { patternId: "pat-1", kind: "ACTION", actionSelectionRef: 0 },
      { patternId: "pat-2", kind: "PASS" },
    ];

    const catalogMock: DecisionCatalog = {
      actions: [{ actionId: "action.up", actionName: "Action Up", timing: "main", speed: "normal" }],
      cardSelections: [],
      unitSelections: [],
      costPayments: [],
      targetSelections: [],
      effectSelections: [],
      orderSelections: [],
    };

    const req1: DecisionRequest = {
      matchId: "audit-m1",
      decisionId: "audit-d1",
      protocolVersion: "1",
      stateVersion: 1,
      playerId: "p1",
      source: { type: "ACTION_REQUEST", playerId: "p1" },
      observation: baseObs1,
      patterns,
      catalog: catalogMock,
    };

    const req2: DecisionRequest = {
      ...req1,
      observation: baseObs2,
    };

    it("1.1 DecisionFeatureEncoder is invariant to focusPlayerId (Compatibility Gap)", () => {
      const enc1 = DecisionFeatureEncoder.encode(req1);
      const enc2 = DecisionFeatureEncoder.encode(req2);

      // Context 163-dim vector is identical because focusPlayerId is not used in Schema v5
      expect(enc1.context.values).toEqual(enc2.context.values);
      expect(enc1.patterns).toEqual(enc2.patterns);
    });

    it("1.2 Structural fingerprints (sgf1, sgf1-ti) ARE sensitive to focusPlayer", () => {
      const stateA = {
        presetId: "test",
        turnPlayer: "p1",
        chancePlayer: "p1",
        focusPlayer: "p1",
        turnCount: 1,
        players: { p1: { hand: [], life: [], field: [], fog: [], grave: [] }, p2: { hand: [], life: [], field: [], fog: [], grave: [] } },
        stage: { requests: [] },
      };
      const stateB = {
        ...stateA,
        focusPlayer: "p2",
      };

      const sgf1_A = SemanticFingerprintCalculator.computeSgf1(stateA);
      const sgf1_B = SemanticFingerprintCalculator.computeSgf1(stateB);
      expect(sgf1_A).not.toBe(sgf1_B);

      const sgf1Ti_A = SemanticFingerprintCalculator.computeSgf1Ti(stateA);
      const sgf1Ti_B = SemanticFingerprintCalculator.computeSgf1Ti(stateB);
      expect(sgf1Ti_A).not.toBe(sgf1Ti_B);
    });

    it("1.3 Observation & Decision fingerprints (pof1, drsf1, gpif1) are INVARIANT to focusPlayerId (Compatibility Gap)", () => {
      const pof1_A = SemanticFingerprintCalculator.computePof1(baseObs1);
      const pof1_B = SemanticFingerprintCalculator.computePof1(baseObs2);
      expect(pof1_A).toBe(pof1_B);

      const drsf1_A = SemanticFingerprintCalculator.computeDrsf1(req1);
      const drsf1_B = SemanticFingerprintCalculator.computeDrsf1(req2);
      expect(drsf1_A).toBe(drsf1_B);

      const gpif1_A = SemanticFingerprintCalculator.computeGpif1(req1);
      const gpif1_B = SemanticFingerprintCalculator.computeGpif1(req2);
      expect(gpif1_A).toBe(gpif1_B);
    });
  });

  describe("Group 2: Baseline A Core & AI Integration Contracts", () => {
    it("2.1 focusPlayer initializes to turnPlayer and empty stage disallows PASS", () => {
      const session = lightSessionFactory({ matchIndex: 0, matchId: "m1", baseSeed: 12345, matchSeed: 12345, playerSeeds: { p1: 1, p2: 2 } });
      const step = session.advance();
      expect(step.type).toBe("WAITING_FOR_DECISION");

      // focusPlayer matches turnPlayer
      expect(session.state.focusPlayer).toBe(session.state.turnPlayer);

      // Empty stage does NOT allow PASS
      if (step.type === "WAITING_FOR_DECISION") {
        const patterns = step.request.patterns;
        expect(patterns.some((p: any) => p.kind === "PASS")).toBe(false);
      }
    });

    it("2.2 Snapshot V2 preserves focusPlayer and legacy V1 without focusPlayer is rejected", () => {
      const session = lightSessionFactory({ matchIndex: 0, matchId: "m1", baseSeed: 12345, matchSeed: 12345, playerSeeds: { p1: 1, p2: 2 } });
      session.advance();

      const snapV2 = GameSessionSnapshotCodec.capture(session);
      expect(snapV2.snapshotFormatVersion).toBe(2);
      expect(snapV2.gameState.focusPlayer).toBe(session.state.focusPlayer);

      const restored = GameSessionSnapshotCodec.restore(snapV2, lightRulePackage);
      expect(restored.state.focusPlayer).toBe(session.state.focusPlayer);

      const legacyV1: any = { ...snapV2, snapshotFormatVersion: 1 };
      delete legacyV1.gameState.focusPlayer;
      expect(() => {
        GameSessionSnapshotCodec.restore(legacyV1, lightRulePackage);
      }).toThrow(GameSessionSnapshotValidationError);
    });

    it("2.3 Semantic Diagnostic passive observer principle (OFF vs ON exact parity)", () => {
      const dnaZero = DecisionDNACodec.createZeroDecisionDNA();
      const policyZero = new GenomePolicy(dnaZero);

      const session1 = lightSessionFactory({ matchIndex: 1, matchId: "m2", baseSeed: 99999, matchSeed: 99999, playerSeeds: { p1: 1, p2: 2 } });
      const session2 = lightSessionFactory({ matchIndex: 2, matchId: "m3", baseSeed: 99999, matchSeed: 99999, playerSeeds: { p1: 1, p2: 2 } });

      const resOff = SimulationRunner.run(session1, { p1: policyZero, p2: policyZero }, { maxDecisions: 100, enableSemanticDiagnostics: false });
      const resOn = SimulationRunner.run(session2, { p1: policyZero, p2: policyZero }, { maxDecisions: 100, enableSemanticDiagnostics: true });

      expect(resOff.completed).toBe(resOn.completed);
      expect(resOff.winner).toBe(resOn.winner);
      expect(resOff.reason).toBe(resOn.reason);
      expect(resOff.totalDecisions).toBe(resOn.totalDecisions);
      expect(resOff.turnCount).toBe(resOn.turnCount);
      expect(resOff.finalStateHash).toBe(resOn.finalStateHash);
      expect(resOff.decisionTrace.length).toBe(resOn.decisionTrace.length);
    });
  });

  describe("Group 3: Baseline Evidence Artifact Audit", () => {
    it("3.1 Verifies that v92-core-baseline-evidence-v1.json exists and conforms to schema", () => {
      const evidencePath = path.resolve(__dirname, "../../../reports/ai/v92-core-baseline-evidence-v1.json");
      expect(fs.existsSync(evidencePath)).toBe(true);

      const data = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
      expect(data.workId).toBe("BP-SIM-AI-V92-BASELINE-EVIDENCE-V1-R1");
      expect(data.startSha).toBe("b0949612dbd7c84ef293e4dfdbefc8dc14dff09d");
      expect(data.baselineB.g0.totalScheduledMatches).toBe(30);
      expect(data.baselineB.g0.completedMatches).toBe(30);
      expect(data.baselineB.g1.totalScheduledMatches).toBe(30);
      expect(data.baselineB.g1.completedMatches).toBe(30);
      expect(data.baselineB.g0.determinism.overall).toBe(true);
      expect(data.baselineB.g1.determinism.overall).toBe(true);
      expect(data.standardPackSmoke.allRunsWithoutException).toBe(true);
    });
  });

  describe("Group 4: Hardened Evidence Verification (BP-SIM-AI-V92-BASELINE-EVIDENCE-V1-R1)", () => {
    let data: any;

    beforeAll(() => {
      const evidencePath = path.resolve(__dirname, "../../../reports/ai/v92-core-baseline-evidence-v1.json");
      data = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
    });

    it("4.1 g0 / g1 full outcome accounting & decision ranges", () => {
      // g0 accounting
      expect(data.baselineB.g0.totalScheduledMatches).toBe(30);
      expect(data.baselineB.g0.completedMatches).toBe(30);
      expect(data.baselineB.g0.incompleteMatches).toBe(0);
      expect(data.baselineB.g0.failedMatches).toBe(0);
      expect(data.baselineB.g0.status).toBe("ADVANCED");
      expect(data.baselineB.g0.decisionStats.min).toBe(36);
      expect(data.baselineB.g0.decisionStats.max).toBe(88);

      // g1 accounting
      expect(data.baselineB.g1.totalScheduledMatches).toBe(30);
      expect(data.baselineB.g1.completedMatches).toBe(30);
      expect(data.baselineB.g1.incompleteMatches).toBe(0);
      expect(data.baselineB.g1.failedMatches).toBe(0);
      expect(data.baselineB.g1.status).toBe("ADVANCED");
      expect(data.baselineB.g1.decisionStats.min).toBe(4);
      expect(data.baselineB.g1.decisionStats.max).toBe(84);
    });

    it("4.2 g0 / g1 Run A vs Run B strict determinism & trace digest equality", () => {
      // g0 Run A vs Run B
      expect(data.baselineB.g0.determinism.matchesEqual).toBe(true);
      expect(data.baselineB.g0.determinism.fitnessEqual).toBe(true);
      expect(data.baselineB.g0.determinism.manifestEqual).toBe(true);
      expect(data.baselineB.g0.determinism.decisionTraceDigestsEqual).toBe(true);
      expect(data.baselineB.g0.determinism.overall).toBe(true);

      // g1 Run A vs Run B
      expect(data.baselineB.g1.determinism.populationEntriesEqual).toBe(true);
      expect(data.baselineB.g1.determinism.dnaDigestsEqual).toBe(true);
      expect(data.baselineB.g1.determinism.scheduleEqual).toBe(true);
      expect(data.baselineB.g1.determinism.matchesEqual).toBe(true);
      expect(data.baselineB.g1.determinism.fitnessEqual).toBe(true);
      expect(data.baselineB.g1.determinism.manifestEqual).toBe(true);
      expect(data.baselineB.g1.determinism.decisionTraceDigestsEqual).toBe(true);
      expect(data.baselineB.g1.determinism.overall).toBe(true);
    });

    it("4.3 DNA digest & weight integrity", () => {
      // g0 DNA integrity
      expect(data.baselineB.g0.dnaDigests).toHaveLength(6);
      for (const dna of data.baselineB.g0.dnaDigests) {
        expect(dna.totalWeights).toBe(23452);
        expect(dna.fullDnaDigest).toMatch(/^[0-9a-f]{64}$/);
      }

      // g1 DNA integrity
      expect(data.baselineB.g1.dnaDigests).toHaveLength(6);
      for (const dna of data.baselineB.g1.dnaDigests) {
        expect(dna.totalWeights).toBe(23452);
        expect(dna.fullDnaDigest).toMatch(/^[0-9a-f]{64}$/);
      }
    });

    it("4.4 Schedule integrity & symmetry", () => {
      const g0Matches = data.baselineB.g0.matchDetails;
      expect(g0Matches).toHaveLength(30);

      // Check match index sequence 0..29
      for (let i = 0; i < 30; i++) {
        expect(g0Matches[i].matchIndex).toBe(i);
        expect(g0Matches[i].matchSeed).toBeDefined();
        expect(g0Matches[i].p1GenomeId).not.toBe(g0Matches[i].p2GenomeId);
      }

      const g1Matches = data.baselineB.g1.matchDetails;
      expect(g1Matches).toHaveLength(30);
      for (let i = 0; i < 30; i++) {
        expect(g1Matches[i].matchIndex).toBe(i);
        expect(g1Matches[i].matchSeed).toBeDefined();
        expect(g1Matches[i].p1GenomeId).not.toBe(g1Matches[i].p2GenomeId);
      }
    });

    it("4.5 Per-match decision trace digest validity", () => {
      const g0Matches = data.baselineB.g0.matchDetails;
      for (const m of g0Matches) {
        expect(m.decisionTraceDigest).toMatch(/^[0-9a-f]{64}$/);
        expect(m.decisionTraceLength).toBeGreaterThan(0);
      }

      const g1Matches = data.baselineB.g1.matchDetails;
      for (const m of g1Matches) {
        expect(m.decisionTraceDigest).toMatch(/^[0-9a-f]{64}$/);
        expect(m.decisionTraceLength).toBeGreaterThan(0);
      }
    });

    it("4.6 Fitness conservation laws", () => {
      // g0 conservation
      const g0fc = data.baselineB.g0.fitnessConservation;
      expect(g0fc.valid).toBe(true);
      expect(g0fc.individualConservationAllOk).toBe(true);
      expect(g0fc.winsEqualsDecisive).toBe(true);
      expect(g0fc.lossesEqualsDecisive).toBe(true);
      expect(g0fc.drawsEqualsMatchDraws).toBe(true);
      expect(g0fc.completedEqualsDoubleMatches).toBe(true);
      expect(g0fc.sumWins).toBe(30);
      expect(g0fc.sumLosses).toBe(30);
      expect(g0fc.sumDraws).toBe(0);
      expect(g0fc.sumCompleted).toBe(60);

      // g1 conservation
      const g1fc = data.baselineB.g1.fitnessConservation;
      expect(g1fc.valid).toBe(true);
      expect(g1fc.individualConservationAllOk).toBe(true);
      expect(g1fc.winsEqualsDecisive).toBe(true);
      expect(g1fc.lossesEqualsDecisive).toBe(true);
      expect(g1fc.drawsEqualsMatchDraws).toBe(true);
      expect(g1fc.completedEqualsDoubleMatches).toBe(true);
      expect(g1fc.sumWins).toBe(30);
      expect(g1fc.sumLosses).toBe(30);
      expect(g1fc.sumDraws).toBe(0);
      expect(g1fc.sumCompleted).toBe(60);
    });

    it("4.7 Standard Pack Smoke 4 INCOMPLETE classification & allRunsWithoutException", () => {
      const sp = data.standardPackSmoke;
      expect(sp.matchesScheduled).toBe(4);
      expect(sp.maxDecisions).toBe(200);
      expect(sp.completedMatchesCount).toBe(0);
      expect(sp.incompleteMatchesCount).toBe(4);
      expect(sp.exceptionMatchesCount).toBe(0);
      expect(sp.allRunsWithoutException).toBe(true);

      for (const m of sp.matches) {
        expect(m.completed).toBe(false);
        expect(m.reason).toBe("最大判断回数 (200) に到達しました。");
        expect(m.totalDecisions).toBe(200);
        expect(m.error).toBeNull();
      }
    });

    it("4.8 Baseline A direct vs indirect verification contract clarity", () => {
      const bA = data.baselineA;
      expect(bA.directVerificationContracts.focusPlayerInitializedTurnPlayer).toBe(true);
      expect(bA.directVerificationContracts.emptyStagePassDisallowed).toBe(true);
      expect(bA.directVerificationContracts.snapshotV2PreservesAndRestoresFocusPlayer).toBe(true);
      expect(bA.directVerificationContracts.snapshotV1ExplicitlyRejected).toBe(true);
      expect(bA.directVerificationContracts.passiveObserverDiagnosticParity).toBe(true);

      expect(bA.indirectCoreFlowRegressionContracts.stageNonEmptyPassResolved).toBeDefined();
      expect(bA.indirectCoreFlowRegressionContracts.systemChanceSingleResolution).toBeDefined();
      expect(bA.indirectCoreFlowRegressionContracts.effectSelectionWorkflow).toBeDefined();
      expect(bA.indirectCoreFlowRegressionContracts.endChargeDrawCycle).toBeDefined();
    });
  });
});
