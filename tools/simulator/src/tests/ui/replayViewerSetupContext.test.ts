/**
 * replayViewerSetupContext.test.ts
 *
 * BlackPoker Simulator
 * Work ID: BP-SIM-REPLAY-SETUP-CONTEXT-R1
 *
 * Replay Viewer Modal における Setup Context (rareCardSelections / scenarioHandSelections)
 * の完全伝播契約と、実Diagnostic相当の回帰テスト。
 *
 * 検証対象:
 * 1. Pro + Strategy / Human vs AI (実Diagnostic相当: Seed 3660789755, P1 Joker#0/#1 + D-A, Rare S-K, AI有効選択)
 * 2. Pro + Strategy / Human vs Human (P1 / P2 双方の手動指定)
 * 3. Rare Setup 水平展開 (official:pro-rarePack, official:standard-rarePack, Joker occurrence 0/1 の保持)
 * 4. Setup 不要環境の非破壊 (official:core-battle, official:light-entry16, official:standard-pack)
 */

import { describe, it, expect, beforeAll } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { loadRegulationCatalogForBrowser } from "../../engine/regulation/BrowserRegulationLoader";
import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader";
import { startMatchAttempt, MatchStartRequest } from "../../engine/playtest/PlaytestEnvironmentController";
import { CardOccurrenceSelection } from "../../engine/regulation/SimulatorDeckProfileResolver";
import { reconstructMatch } from "../../engine/replay/ReplayReconstructionService";
import {
  buildPlaytestDiagnosticBundleV1,
  captureDiagnosticRawState,
  ActivePlaytestSettings,
  assemblePlaytestDiagnosticBundleParams,
} from "../../ui/playtest/PlaytestDiagnosticBundle";
import {
  createDecisionTranscriptEntry,
  PlaytestDecisionTranscriptEntryV1,
} from "../../ui/playtest/PlaytestDecisionTranscript";
import {
  ReplayViewerModal,
  buildReplayViewerReconstructParams,
  initializeReplayViewerBundle,
} from "../../ui/replay/ReplayViewerModal";

describe("BP-SIM-REPLAY-SETUP-CONTEXT-R1: Replay Viewer Setup Context Propagation", () => {
  let catalog: any;
  let fullRulePackage: any;
  const currentBuildSha = "local";

  beforeAll(() => {
    catalog = loadRegulationCatalogForBrowser();
    fullRulePackage = loadRulePackageForBrowser();
  });

  // ヘルパー: 指定セッションから指定回数の Decision を進行し、Transcript と最終 step を返す
  function progressDecisions(
    session: any,
    initialStep: any,
    targetCount: number
  ): {
    transcript: PlaytestDecisionTranscriptEntryV1[];
    currentStep: any;
  } {
    let step = initialStep;
    const transcript: PlaytestDecisionTranscriptEntryV1[] = [];

    for (let i = 0; i < targetCount; i++) {
      while (step.type === "PROGRESSED") {
        step = session.advance();
      }
      if (step.type !== "WAITING_FOR_DECISION") {
        break;
      }
      const req = step.request;
      const selectedPatternRef = 0; // FirstLegal
      const entry = createDecisionTranscriptEntry(transcript.length + 1, {
        actor: i % 2 === 0 ? "human" : "policy",
        playerId: req.playerId,
        decisionId: req.decisionId,
        stateVersion: req.stateVersion,
        response: {
          decisionId: req.decisionId,
          stateVersion: req.stateVersion,
          selectedPatternRef,
        },
      });
      transcript.push(entry);
      step = session.submitDecision({
        decisionId: req.decisionId,
        stateVersion: req.stateVersion,
        selectedPatternRef,
      });
    }

    while (step.type === "PROGRESSED") {
      step = session.advance();
    }

    return { transcript, currentStep: step };
  }

  // =========================================================================
  // 0. buildReplayViewerReconstructParams 単体契約
  // =========================================================================
  describe("0. buildReplayViewerReconstructParams Contract", () => {
    it("propagates both rareCardSelections and scenarioHandSelections generically from plan", () => {
      const mockPlan: any = {
        environmentId: "official:pro-strategy",
        seed: 12345,
        rareCardSelections: {
          p1: [{ cardId: "S-K", occurrenceIndex: 0 }],
          p2: [{ cardId: "JOKER", occurrenceIndex: 0 }],
        },
        scenarioHandSelections: {
          p1: [
            { cardId: "JOKER", occurrenceIndex: 0 },
            { cardId: "JOKER", occurrenceIndex: 1 },
            { cardId: "D-A", occurrenceIndex: 0 },
          ],
          p2: [
            { cardId: "D-5", occurrenceIndex: 0 },
            { cardId: "D-8", occurrenceIndex: 0 },
            { cardId: "S-3", occurrenceIndex: 0 },
          ],
        },
        decisions: [],
        expected: { status: "WAITING_FOR_DECISION" },
        sourceRulePackage: { id: "test", version: "1.0.0" },
      };

      const params = buildReplayViewerReconstructParams({
        plan: mockPlan,
        decisionCount: 0,
        catalog,
        fullRulePackage,
      });

      expect(params.environmentId).toBe("official:pro-strategy");
      expect(params.seed).toBe(12345);
      expect(params.rareCardSelections).toEqual(mockPlan.rareCardSelections);
      expect(params.scenarioHandSelections).toEqual(mockPlan.scenarioHandSelections);
      expect(params.decisionCount).toBe(0);
      expect(params.trailingNormalization).toBe("EXTERNAL_DECISION_BOUNDARY");
      expect(params.expectedRulePackage).toEqual(mockPlan.sourceRulePackage);
    });

    it("passes undefined for rareCardSelections and scenarioHandSelections when absent in plan", () => {
      const mockPlan: any = {
        environmentId: "core-battle",
        seed: 999,
        decisions: [],
        expected: { status: "WAITING_FOR_DECISION" },
      };

      const params = buildReplayViewerReconstructParams({
        plan: mockPlan,
        decisionCount: 0,
        catalog,
        fullRulePackage,
      });

      expect(params.rareCardSelections).toBeUndefined();
      expect(params.scenarioHandSelections).toBeUndefined();
    });
  });

  // =========================================================================
  // 1. Pro + Strategy / Human vs AI (実Diagnostic相当)
  // =========================================================================
  describe("1. Pro + Strategy / Human vs AI (User Diagnostic Scenario)", () => {
    it("successfully reconstructs Decision 0 and subsequent steps without VALIDATION_ERROR or Divergence", async () => {
      const seed = 3660789755;
      const userP1Scenario: CardOccurrenceSelection[] = [
        { suit: "J", rank: "Joker", occurrence: 0 },
        { suit: "J", rank: "Joker", occurrence: 1 },
        { suit: "D", rank: "A", occurrence: 0 },
      ];
      const userP1Rare: CardOccurrenceSelection[] = [
        { suit: "S", rank: "K", occurrence: 0 },
      ];

      // 1. Live Match 開始 (Human vs AI, humanSeat: p1)
      const startReq: MatchStartRequest = {
        catalog,
        fullRulePackage,
        environmentId: "official:pro-strategy",
        matchMode: "humanVsAi",
        seedInput: String(seed),
        rareCardSelections: { p1: userP1Rare },
        scenarioHandSelections: { p1: userP1Scenario },
      };
      const liveRes = await startMatchAttempt(startReq);
      expect(liveRes.type).toBe("READY");
      if (liveRes.type !== "READY") return;

      // AI席 (P2) の effective selections が自動決定されていることを確認
      expect(liveRes.activeMatch.scenarioHandSelections?.p2).toBeDefined();
      expect(liveRes.activeMatch.scenarioHandSelections?.p2?.length).toBe(3);
      expect(liveRes.activeMatch.rareCardSelections?.p2).toBeDefined();
      expect(liveRes.activeMatch.rareCardSelections?.p2?.length).toBe(1);

      // 2. Decision を複数進行
      const { transcript, currentStep } = progressDecisions(liveRes.session, liveRes.initialStep, 3);
      expect(transcript.length).toBeGreaterThanOrEqual(1);

      // 3. Diagnostic Bundle の構築
      const activeSettings: ActivePlaytestSettings = {
        matchMode: "humanVsAi",
        humanSeat: "p1",
        policyId: "firstLegal",
        rareCardSelections: liveRes.activeMatch.rareCardSelections,
        scenarioHandSelections: liveRes.activeMatch.scenarioHandSelections,
      };

      const bundle = buildPlaytestDiagnosticBundleV1(
        assemblePlaytestDiagnosticBundleParams({
          build: { sha: currentBuildSha, ref: "local" },
          generatedAt: new Date().toISOString(),
          activeMatch: liveRes.activeMatch,
          activePlaytestSettings: activeSettings,
          activeSeatControllers: { p1: { kind: "HUMAN" }, p2: { kind: "POLICY", policyId: "firstLegal" } },
          rawState: captureDiagnosticRawState(liveRes.session.state),
          logs: [],
          traces: [],
          canonicalMatchLog: liveRes.session.getMatchLog(),
          currentStep,
          decisionTranscript: transcript,
        })
      );

      // Bundle に Setup Context が欠落せず記録されていること
      expect(bundle.match.scenarioHandSelections?.p1).toBeDefined();
      expect(bundle.match.scenarioHandSelections?.p2).toBeDefined();
      expect(bundle.match.rareCardSelections?.p1).toBeDefined();
      expect(bundle.match.rareCardSelections?.p2).toBeDefined();

      // 4. Replay Viewer 初期化
      const initResult = initializeReplayViewerBundle(bundle, {
        currentBuildSha,
        catalog,
        fullRulePackage,
      });
      expect(initResult.plan).not.toBeNull();
      expect(initResult.verificationOutcome.type).toBe("VERIFIED");
      const plan = initResult.plan!;

      // 5. Decision 0 の再構築 (起動直後の盤面) が SUCCESS になること (VALIDATION_ERROR 回避)
      const params0 = buildReplayViewerReconstructParams({
        plan,
        decisionCount: 0,
        catalog,
        fullRulePackage,
      });
      const recon0 = reconstructMatch(params0);
      expect(recon0.status).toBe("SUCCESS");
      if (recon0.status !== "SUCCESS") {
        throw new Error(`Decision 0 failed: ${recon0.status === "TECHNICAL_ERROR" ? recon0.error : recon0.message}`);
      }

      // 6. 各 Decision Boundary へのシーク・再構築がすべて SUCCESS であること
      for (let i = 1; i <= plan.decisions.length; i++) {
        const paramsI = buildReplayViewerReconstructParams({
          plan,
          decisionCount: i,
          catalog,
          fullRulePackage,
        });
        const reconI = reconstructMatch(paramsI);
        expect(reconI.status).toBe("SUCCESS");
      }

      // 7. ReplayViewerModal の描画テスト: Divergence 表示がなく正常に盤面がレンダリングされること
      let renderer!: TestRenderer.ReactTestRenderer;
      act(() => {
        renderer = TestRenderer.create(
          React.createElement(ReplayViewerModal, {
            isOpen: true,
            onClose: () => {},
            catalog,
            fullRulePackage,
            currentBuildSha,
            initialBundle: bundle,
            initialSource: "live",
          })
        );
      });

      const renderedJson = JSON.stringify(renderer.toJSON());
      expect(renderedJson).toContain("VERIFIED");
      expect(renderedJson).not.toContain("Replay Diverged at Decision #0");
      expect(renderedJson).not.toContain("VALIDATION_ERROR");
      expect(renderedJson).not.toContain("シナリオ手札の選択が必要です");
      expect(renderedJson).toContain("Player A");
    });
  });

  // =========================================================================
  // 2. Pro + Strategy / Human vs Human
  // =========================================================================
  describe("2. Pro + Strategy / Human vs Human", () => {
    it("successfully reconstructs when both P1 and P2 specify Scenario Hand and Rare Card", async () => {
      const seed = 42;
      const p1Scenario: CardOccurrenceSelection[] = [
        { suit: "S", rank: "A", occurrence: 0 },
        { suit: "H", rank: "K", occurrence: 0 },
        { suit: "D", rank: "Q", occurrence: 0 },
      ];
      const p2Scenario: CardOccurrenceSelection[] = [
        { suit: "C", rank: "A", occurrence: 0 },
        { suit: "C", rank: "K", occurrence: 0 },
        { suit: "C", rank: "Q", occurrence: 0 },
      ];
      const p1Rare: CardOccurrenceSelection[] = [
        { suit: "J", rank: "Joker", occurrence: 0 },
      ];
      const p2Rare: CardOccurrenceSelection[] = [
        { suit: "J", rank: "Joker", occurrence: 1 },
      ];

      const startReq: MatchStartRequest = {
        catalog,
        fullRulePackage,
        environmentId: "official:pro-strategy",
        matchMode: "humanVsHuman",
        seedInput: String(seed),
        rareCardSelections: { p1: p1Rare, p2: p2Rare },
        scenarioHandSelections: { p1: p1Scenario, p2: p2Scenario },
      };
      const liveRes = await startMatchAttempt(startReq);
      expect(liveRes.type).toBe("READY");
      if (liveRes.type !== "READY") return;

      const { transcript, currentStep } = progressDecisions(liveRes.session, liveRes.initialStep, 2);

      const activeSettings: ActivePlaytestSettings = {
        matchMode: "humanVsHuman",
        humanSeat: "p1",
        policyId: "firstLegal",
        rareCardSelections: liveRes.activeMatch.rareCardSelections,
        scenarioHandSelections: liveRes.activeMatch.scenarioHandSelections,
      };

      const bundle = buildPlaytestDiagnosticBundleV1(
        assemblePlaytestDiagnosticBundleParams({
          build: { sha: currentBuildSha, ref: "local" },
          generatedAt: new Date().toISOString(),
          activeMatch: liveRes.activeMatch,
          activePlaytestSettings: activeSettings,
          activeSeatControllers: { p1: { kind: "HUMAN" }, p2: { kind: "HUMAN" } },
          rawState: captureDiagnosticRawState(liveRes.session.state),
          logs: [],
          traces: [],
          canonicalMatchLog: liveRes.session.getMatchLog(),
          currentStep,
          decisionTranscript: transcript,
        })
      );

      const initResult = initializeReplayViewerBundle(bundle, {
        currentBuildSha,
        catalog,
        fullRulePackage,
      });
      expect(initResult.plan).not.toBeNull();
      const plan = initResult.plan!;

      // Decision 0 SUCCESS
      const params0 = buildReplayViewerReconstructParams({
        plan,
        decisionCount: 0,
        catalog,
        fullRulePackage,
      });
      const recon0 = reconstructMatch(params0);
      expect(recon0.status).toBe("SUCCESS");

      // Modal render
      let renderer!: TestRenderer.ReactTestRenderer;
      act(() => {
        renderer = TestRenderer.create(
          React.createElement(ReplayViewerModal, {
            isOpen: true,
            onClose: () => {},
            catalog,
            fullRulePackage,
            currentBuildSha,
            initialBundle: bundle,
            initialSource: "live",
          })
        );
      });
      const renderedJson = JSON.stringify(renderer.toJSON());
      expect(renderedJson).not.toContain("Replay Diverged");
      expect(renderedJson).toContain("VERIFIED");
      expect(renderedJson).toContain("Player A");
    });
  });

  // =========================================================================
  // 3. Rare Setup 水平展開 (Pro + RarePack, Standard + RarePack)
  // =========================================================================
  describe("3. Rare Setup Horizontal Propagation (pro-rarePack & standard-rarePack)", () => {
    it("pro-rarePack: preserves Joker occurrence 0 and 1 through Replay Viewer reconstruction", async () => {
      const seed = 777;
      const p1Rare: CardOccurrenceSelection[] = [{ suit: "J", rank: "Joker", occurrence: 0 }];
      const p2Rare: CardOccurrenceSelection[] = [{ suit: "J", rank: "Joker", occurrence: 1 }];

      const startReq: MatchStartRequest = {
        catalog,
        fullRulePackage,
        environmentId: "official:pro-rarePack",
        matchMode: "humanVsHuman",
        seedInput: String(seed),
        rareCardSelections: { p1: p1Rare, p2: p2Rare },
      };
      const liveRes = await startMatchAttempt(startReq);
      expect(liveRes.type).toBe("READY");
      if (liveRes.type !== "READY") return;

      const { transcript, currentStep } = progressDecisions(liveRes.session, liveRes.initialStep, 2);

      const bundle = buildPlaytestDiagnosticBundleV1(
        assemblePlaytestDiagnosticBundleParams({
          build: { sha: currentBuildSha, ref: "local" },
          generatedAt: new Date().toISOString(),
          activeMatch: liveRes.activeMatch,
          activePlaytestSettings: {
            matchMode: "humanVsHuman",
            humanSeat: "p1",
            policyId: "firstLegal",
            rareCardSelections: liveRes.activeMatch.rareCardSelections,
          },
          activeSeatControllers: { p1: { kind: "HUMAN" }, p2: { kind: "HUMAN" } },
          rawState: captureDiagnosticRawState(liveRes.session.state),
          logs: [],
          traces: [],
          canonicalMatchLog: liveRes.session.getMatchLog(),
          currentStep,
          decisionTranscript: transcript,
        })
      );

      const initResult = initializeReplayViewerBundle(bundle, {
        currentBuildSha,
        catalog,
        fullRulePackage,
      });
      expect(initResult.plan).not.toBeNull();
      const plan = initResult.plan!;

      expect(plan.rareCardSelections?.p1?.[0]?.occurrence).toBe(0);
      expect(plan.rareCardSelections?.p2?.[0]?.occurrence).toBe(1);

      const params0 = buildReplayViewerReconstructParams({
        plan,
        decisionCount: 0,
        catalog,
        fullRulePackage,
      });
      const recon0 = reconstructMatch(params0);
      expect(recon0.status).toBe("SUCCESS");
    });

    it("standard-rarePack: successfully reconstructs with rareCardSelections", async () => {
      const seed = 888;
      const p1Rare: CardOccurrenceSelection[] = [{ suit: "S", rank: "A", occurrence: 0 }];
      const p2Rare: CardOccurrenceSelection[] = [{ suit: "H", rank: "A", occurrence: 0 }];

      const startReq: MatchStartRequest = {
        catalog,
        fullRulePackage,
        environmentId: "official:standard-rarePack",
        matchMode: "humanVsHuman",
        seedInput: String(seed),
        rareCardSelections: { p1: p1Rare, p2: p2Rare },
      };
      const liveRes = await startMatchAttempt(startReq);
      expect(liveRes.type).toBe("READY");
      if (liveRes.type !== "READY") return;

      const { transcript, currentStep } = progressDecisions(liveRes.session, liveRes.initialStep, 1);

      const bundle = buildPlaytestDiagnosticBundleV1(
        assemblePlaytestDiagnosticBundleParams({
          build: { sha: currentBuildSha, ref: "local" },
          generatedAt: new Date().toISOString(),
          activeMatch: liveRes.activeMatch,
          activePlaytestSettings: {
            matchMode: "humanVsHuman",
            humanSeat: "p1",
            policyId: "firstLegal",
            rareCardSelections: liveRes.activeMatch.rareCardSelections,
          },
          activeSeatControllers: { p1: { kind: "HUMAN" }, p2: { kind: "HUMAN" } },
          rawState: captureDiagnosticRawState(liveRes.session.state),
          logs: [],
          traces: [],
          canonicalMatchLog: liveRes.session.getMatchLog(),
          currentStep,
          decisionTranscript: transcript,
        })
      );

      const initResult = initializeReplayViewerBundle(bundle, {
        currentBuildSha,
        catalog,
        fullRulePackage,
      });
      expect(initResult.plan).not.toBeNull();
      const plan = initResult.plan!;

      const params0 = buildReplayViewerReconstructParams({
        plan,
        decisionCount: 0,
        catalog,
        fullRulePackage,
      });
      const recon0 = reconstructMatch(params0);
      expect(recon0.status).toBe("SUCCESS");
    });
  });

  // =========================================================================
  // 4. Setup 不要環境の非破壊テスト (Core Battle, Light, Standard)
  // =========================================================================
  describe("4. Non-Destructive Tests for Setup-Free Environments", () => {
    const nonSetupEnvs = [
      "core-battle",
      "official:light-entry16",
      "official:standard-pack",
    ];

    for (const envId of nonSetupEnvs) {
      it(`${envId}: Replay Viewer operates normally without setup selections`, async () => {
        const startReq: MatchStartRequest = {
          catalog,
          fullRulePackage,
          environmentId: envId,
          matchMode: "humanVsHuman",
          seedInput: "123",
        };
        const liveRes = await startMatchAttempt(startReq);
        expect(liveRes.type).toBe("READY");
        if (liveRes.type !== "READY") return;

        const { transcript, currentStep } = progressDecisions(liveRes.session, liveRes.initialStep, 1);

        const bundle = buildPlaytestDiagnosticBundleV1(
          assemblePlaytestDiagnosticBundleParams({
            build: { sha: currentBuildSha, ref: "local" },
            generatedAt: new Date().toISOString(),
            activeMatch: liveRes.activeMatch,
            activePlaytestSettings: {
              matchMode: "humanVsHuman",
              humanSeat: "p1",
              policyId: "firstLegal",
            },
            activeSeatControllers: { p1: { kind: "HUMAN" }, p2: { kind: "HUMAN" } },
            rawState: captureDiagnosticRawState(liveRes.session.state),
            logs: [],
            traces: [],
            canonicalMatchLog: liveRes.session.getMatchLog(),
            currentStep,
            decisionTranscript: transcript,
          })
        );

        const initResult = initializeReplayViewerBundle(bundle, {
          currentBuildSha,
          catalog,
          fullRulePackage,
        });
        expect(initResult.plan).not.toBeNull();
        const plan = initResult.plan!;

        // params に rare / scenario が含まれないこと
        const params0 = buildReplayViewerReconstructParams({
          plan,
          decisionCount: 0,
          catalog,
          fullRulePackage,
        });
        expect(params0.rareCardSelections).toBeUndefined();
        expect(params0.scenarioHandSelections).toBeUndefined();

        const recon0 = reconstructMatch(params0);
        expect(recon0.status).toBe("SUCCESS");

        let renderer!: TestRenderer.ReactTestRenderer;
        act(() => {
          renderer = TestRenderer.create(
            React.createElement(ReplayViewerModal, {
              isOpen: true,
              onClose: () => {},
              catalog,
              fullRulePackage,
              currentBuildSha,
              initialBundle: bundle,
              initialSource: "live",
            })
          );
        });
        const renderedJson = JSON.stringify(renderer.toJSON());
        expect(renderedJson).not.toContain("Replay Diverged");
        expect(renderedJson).toContain("VERIFIED");
      });
    }
  });
});
