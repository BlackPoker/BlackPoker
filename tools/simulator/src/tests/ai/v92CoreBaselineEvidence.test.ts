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

describe("v9.2 Core & AI Baseline Re-Evaluation Evidence Test Suite (BP-SIM-AI-V92-BASELINE-EVIDENCE-V1)", () => {
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
      const session = lightSessionFactory({ matchSeed: 12345, p1GenomeId: "g1", p2GenomeId: "g2" });
      const step = session.advance();
      expect(step.type).toBe("WAITING_FOR_DECISION");

      // focusPlayer matches turnPlayer
      expect(session.state.focusPlayer).toBe(session.state.turnPlayer);

      // Empty stage does NOT allow PASS
      const patterns = step.request.patterns;
      expect(patterns.some((p: any) => p.kind === "PASS")).toBe(false);
    });

    it("2.2 Snapshot V2 preserves focusPlayer and legacy V1 without focusPlayer is rejected", () => {
      const session = lightSessionFactory({ matchSeed: 12345, p1GenomeId: "g1", p2GenomeId: "g2" });
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

      const session1 = lightSessionFactory({ matchSeed: 99999, p1GenomeId: "g1", p2GenomeId: "g2" });
      const session2 = lightSessionFactory({ matchSeed: 99999, p1GenomeId: "g1", p2GenomeId: "g2" });

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
      expect(data.workId).toBe("BP-SIM-AI-V92-BASELINE-EVIDENCE-V1");
      expect(data.startSha).toBe("92a7fc50674c20026118cf20460c6ee423451a71");
      expect(data.baselineB.totalScheduledMatches).toBe(30);
      expect(data.baselineB.determinism.overall).toBe(true);
      expect(data.standardPackSmoke.allCompletedWithoutException).toBe(true);
    });
  });
});
