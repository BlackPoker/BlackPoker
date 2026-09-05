import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import {
  OFFICIAL_BASELINE_MEASUREMENT_VERSION,
  OfficialBaselineMeasurementConfig,
} from "../../domain/ai/OfficialBaselineMeasurementTypes";
import {
  canonicalJsonStringify,
  computeLogicalDigest,
  OfficialBaselineMeasurementRunner,
} from "../../engine/regulation/OfficialBaselineMeasurementRunner";
import { OfficialSetupAuditor } from "../../engine/regulation/OfficialSetupAuditor";
import {
  BaselineDiagnosticAccumulator,
  DecisionFeatureDiagnosticObserverPolicy,
} from "../../engine/ai/DecisionFeatureDiagnosticObserver";
import { loadRegulationCatalog, RegulationCatalog } from "../../engine/regulation/RegulationLoader";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage } from "../../domain/rules/RulePackage";
import { FirstLegalPolicy } from "../../engine/simulation/DecisionPolicy";
import { DecisionRequest } from "../../domain/decision/DecisionRequest";
import { PlayerObservationView } from "../../domain/decision/PlayerObservation";

describe("Official Baseline Measurement Tests (Phase 3.3)", () => {
  let catalog: RegulationCatalog;
  let fullRulePackage: RulePackage;

  beforeAll(async () => {
    catalog = await loadRegulationCatalog();
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    fullRulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  describe("1. Contract & Digest Determinism", () => {
    it("1. measurement result version は 1.0.0 固定", () => {
      expect(OFFICIAL_BASELINE_MEASUREMENT_VERSION).toBe("1.0.0");
      expect(OfficialBaselineMeasurementRunner.VERSION).toBe("1.0.0");
    });

    it("2. canonicalJsonStringify はキー順序に依存せず同一文字列を出力し、computeLogicalDigest が完全一致すること", () => {
      const objA: any = {
        measurementResultVersion: "1.0.0",
        measurementId: "test-m-1",
        workId: "work-1",
        environmentRef: "ref",
        regulationId: "light-entry16",
        rulesVersion: "rules-vnext",
        featureSchemaVersion: "1.0.0",
        dnaFormatVersion: "1.0.0",
        baseSeed: 20260906,
        setupAudit: { plannedSetups: 10, readySetups: 10, terminalSetups: 0, ruleUnspecifiedSetups: 0, reasonBreakdown: { FIRST_PLAYER_DETERMINATION_LIFE_EXHAUSTED: 0, GAME_START_DRAW_LIFE_EXHAUSTED: 0 }, nonReadyEntries: [] },
        matchups: [],
        participantBehavior: [],
        featureDiagnostics: {
          featureCollisions: [],
          activationCoverage: {
            context: { totalFeatures: 25, activatedFeatures: 10, coverageRate: 0.4, featureCounts: {}, neverActivatedFeatures: [] },
            pattern: { totalFeatures: 57, activatedFeatures: 20, coverageRate: 0.35, featureCounts: {}, neverActivatedFeatures: [] },
          },
          genomeArgmaxTies: [],
          counterfactualAgreements: [],
        },
        notes: ["note1"],
      };

      // 異なるプロパティ順序のオブジェクト
      const objB: any = {
        notes: ["note1"],
        workId: "work-1",
        measurementId: "test-m-1",
        measurementResultVersion: "1.0.0",
        environmentRef: "ref",
        baseSeed: 20260906,
        regulationId: "light-entry16",
        rulesVersion: "rules-vnext",
        dnaFormatVersion: "1.0.0",
        featureSchemaVersion: "1.0.0",
        featureDiagnostics: {
          counterfactualAgreements: [],
          genomeArgmaxTies: [],
          activationCoverage: {
            pattern: { neverActivatedFeatures: [], featureCounts: {}, coverageRate: 0.35, activatedFeatures: 20, totalFeatures: 57 },
            context: { neverActivatedFeatures: [], featureCounts: {}, coverageRate: 0.4, activatedFeatures: 10, totalFeatures: 25 },
          },
          featureCollisions: [],
        },
        participantBehavior: [],
        matchups: [],
        setupAudit: { nonReadyEntries: [], reasonBreakdown: { GAME_START_DRAW_LIFE_EXHAUSTED: 0, FIRST_PLAYER_DETERMINATION_LIFE_EXHAUSTED: 0 }, ruleUnspecifiedSetups: 0, terminalSetups: 0, readySetups: 10, plannedSetups: 10 },
      };

      const strA = canonicalJsonStringify(objA);
      const strB = canonicalJsonStringify(objB);
      expect(strA).toBe(strB);

      const digestA = computeLogicalDigest(objA);
      const digestB = computeLogicalDigest(objB);
      expect(digestA).toBe(digestB);
      expect(digestA).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe("2. Setup Viability Audit", () => {
    it("4 & 5 & 6. Setup Audit が同一 baseSeed で決定論的に同一結果を返すこと", () => {
      const reg = catalog.regulations.get("light-entry16")!;
      const frame = catalog.frames.get("entry16")!;

      const auditA = OfficialSetupAuditor.audit(reg, frame, fullRulePackage, {
        baseSeed: 20260906,
        auditCount: 20,
      });

      const auditB = OfficialSetupAuditor.audit(reg, frame, fullRulePackage, {
        baseSeed: 20260906,
        auditCount: 20,
      });

      expect(auditA).toEqual(auditB);
      expect(auditA.plannedSetups).toBe(20);
      expect(auditA.readySetups + auditA.terminalSetups + auditA.ruleUnspecifiedSetups).toBe(20);
    });

    it("7 & 8 & 9. nonReadyEntries が発生した場合に reasonCode を正しく集計すること", () => {
      const reg = catalog.regulations.get("light-entry16")!;
      const frame = catalog.frames.get("entry16")!;

      const audit = OfficialSetupAuditor.audit(reg, frame, fullRulePackage, {
        baseSeed: 12345,
        auditCount: 10,
      });

      expect(audit.plannedSetups).toBe(10);
      expect(typeof audit.reasonBreakdown.FIRST_PLAYER_DETERMINATION_LIFE_EXHAUSTED).toBe("number");
      expect(typeof audit.reasonBreakdown.GAME_START_DRAW_LIFE_EXHAUSTED).toBe("number");
    });
  });

  function createMockPlayerView(playerId: "p1" | "p2", isViewer: boolean): PlayerObservationView {
    return {
      playerId,
      name: playerId.toUpperCase(),
      isViewer,
      handCount: 7,
      handCards: [],
      lifeCount: 7,
      lifeDisplay: "7",
      field: [],
      fog: [],
      trumps: [],
      graveCount: 1,
      grave: [],
      canViewFullGrave: true,
    };
  }

  function createMockDecisionRequest(params?: Partial<DecisionRequest>): DecisionRequest {
    return {
      protocolVersion: "1.0.0",
      matchId: "m-1",
      decisionId: "dec-1",
      stateVersion: 1,
      playerId: "p1",
      source: { type: "ACTION_REQUEST", playerId: "p1" },
      catalog: {
        actions: [],
        cardSelections: [],
        unitSelections: [],
        costPayments: [],
        targetSelections: [],
        effectSelections: [],
        orderSelections: [],
      },
      observation: {
        viewerPlayerId: "p1",
        turnPlayerId: "p1",
        chancePlayerId: "p1",
        players: [
          createMockPlayerView("p1", true),
          createMockPlayerView("p2", false),
        ],
        stageRequestRefs: [],
        stageRequests: [],
        recentEvents: [],
      },
      patterns: [
        { patternId: "pat-0", kind: "ACTION", actionSelectionRef: 0 },
        { patternId: "pat-1", kind: "PASS" },
      ],
      ...params,
    };
  }

  describe("3. Observer & Transparency", () => {
    it("12. underlying policy の DecisionResponse を一切改変せずそのまま返却すること", () => {
      const accumulator = new BaselineDiagnosticAccumulator();
      const mockPolicy = {
        descriptor: { kind: "mock", policyVersion: 1 },
        choose: () => ({ decisionId: "dec-1", stateVersion: 1, selectedPatternRef: 0 }),
      };

      const observer = new DecisionFeatureDiagnosticObserverPolicy(mockPolicy, "pA", accumulator);
      const req = createMockDecisionRequest({
        patterns: [{ patternId: "pat-0", kind: "PASS" }],
      });

      const resp = observer.choose(req);
      expect(resp.selectedPatternRef).toBe(0);
      expect(resp.decisionId).toBe("dec-1");
      expect(accumulator.diagnosticErrorCount).toBe(0);
    });

    it("13 & 14. 観測処理がエラーを出さず、Behavior および Counterfactual Agreement を集計すること", () => {
      const accumulator = new BaselineDiagnosticAccumulator();
      const req = createMockDecisionRequest({
        patterns: [
          { patternId: "pat-0", kind: "ACTION", actionSelectionRef: 0 },
          { patternId: "pat-1", kind: "PASS" },
        ],
      });

      accumulator.recordDecision("pA", req, {
        decisionId: "dec-1",
        stateVersion: 1,
        selectedPatternRef: 0,
      });

      const behavior = accumulator.getParticipantBehavior();
      expect(behavior).toHaveLength(1);
      expect(behavior[0].participantId).toBe("pA");
      expect(behavior[0].actionSelections).toBe(1);
      expect(behavior[0].actionSelectionRate).toBe(1);

      const agreement = accumulator.getCounterfactualAgreements();
      expect(agreement).toHaveLength(1);
      expect(agreement[0].referenceComparableDecisions).toBe(1);
      expect(agreement[0].sameAsFirstLegalCount).toBe(1); // FirstLegal also chooses non-PASS (ref 0)
    });
  });

  describe("4. Feature Collision & Coverage & Ties", () => {
    it("15 & 16. 異なる logicalPatternKey かつ同一 57次元ベクトルのパターンを collision として検出すること", () => {
      const accumulator = new BaselineDiagnosticAccumulator();

      // 意図的に同じ属性値（57次元ベクトルが同一）だが異なる logicalPatternKey を持つ2パターン
      const req = createMockDecisionRequest({
        decisionId: "dec-col-1",
        patterns: [
          // パターン 0: actionSelectionRef 0
          { patternId: "pat-0", kind: "ACTION", actionSelectionRef: 0 },
          // パターン 1: actionSelectionRef 1 (logicalPatternKey が異なるが、どちらも詳細メタデータ未設定のため同じ57次元ベクトルとなる)
          { patternId: "pat-1", kind: "ACTION", actionSelectionRef: 1 },
        ],
      });

      accumulator.recordDecision("pA", req, {
        decisionId: "dec-col-1",
        stateVersion: 1,
        selectedPatternRef: 0,
      });

      const collisions = accumulator.getFeatureCollisions();
      expect(collisions).toHaveLength(1);
      expect(collisions[0].encodedDecisions).toBe(1);
      expect(collisions[0].decisionsWithPatternCollision).toBe(1);
      expect(collisions[0].collisionGroupCount).toBe(1);
      expect(collisions[0].maxCollisionGroupSize).toBe(2);
    });

    it("18 & 19. Context と Pattern の Activation Coverage が集計されること", () => {
      const accumulator = new BaselineDiagnosticAccumulator();
      const req = createMockDecisionRequest({
        decisionId: "dec-cov-1",
        patterns: [
          { patternId: "pat-0", kind: "ACTION" },
          { patternId: "pat-1", kind: "PASS" },
        ],
      });

      accumulator.recordDecision("pA", req, {
        decisionId: "dec-cov-1",
        stateVersion: 1,
        selectedPatternRef: 0,
      });

      const coverage = accumulator.getActivationCoverage();
      expect(coverage.context.totalFeatures).toBe(25);
      expect(coverage.context.activatedFeatures).toBeGreaterThan(0);
      expect(coverage.context.neverActivatedFeatures.length).toBeLessThan(25);

      expect(coverage.pattern.totalFeatures).toBe(57);
      expect(coverage.pattern.activatedFeatures).toBeGreaterThan(0);
    });

    it("21. ZeroGenome participant で全合法手が top tie となること", () => {
      const accumulator = new BaselineDiagnosticAccumulator();
      const req = createMockDecisionRequest({
        decisionId: "dec-tie-1",
        patterns: [
          { patternId: "pat-0", kind: "ACTION" },
          { patternId: "pat-1", kind: "PASS" },
        ],
      });

      // ZeroGenome participant ID
      accumulator.recordDecision("baseline-zero-genome-v1", req, {
        decisionId: "dec-tie-1",
        stateVersion: 1,
        selectedPatternRef: 0,
      });

      const ties = accumulator.getGenomeArgmaxTies();
      expect(ties).toHaveLength(1);
      expect(ties[0].participantId).toBe("baseline-zero-genome-v1");
      expect(ties[0].scoredDecisions).toBe(1);
      expect(ties[0].decisionsWithArgmaxTie).toBe(1);
      expect(ties[0].maxTopTieCount).toBe(2);
    });
  });

  describe("5. Small Integration & Repeatability", () => {
    it("26 & 28 & 30. 小型設定 (matchesPerSeat: 1) で Official Baseline を実行し、Run A == Run B の digest が完全一致すること", async () => {
      const smallConfig: OfficialBaselineMeasurementConfig = {
        measurementId: "test-small-baseline",
        workId: "BP-SIM-AI-3.3-TEST",
        environmentRef: "official:light-entry16",
        regulationId: "light-entry16",
        baseSeed: 20260906,
        setupAuditCount: 5,
        matchesPerSeat: 1, // 1 match per seat = 2 matches per pair x 6 pairs = 12 matches total
        maxDecisionsPerMatch: 100,
      };

      const result = await OfficialBaselineMeasurementRunner.run(
        smallConfig,
        catalog,
        fullRulePackage
      );

      expect(result.measurementResultVersion).toBe("1.0.0");
      expect(result.matchups).toHaveLength(6);
      expect(result.repeatability.matched).toBe(true);
      expect(result.repeatability.exactLogicalEquality).toBe(true);
      expect(result.repeatability.diagnosticErrorCount).toBe(0);
      expect(result.logicalDigest).toBe(result.repeatability.runADigest);
      expect(result.logicalDigest).toBe(result.repeatability.runBDigest);
    });
  });
});
