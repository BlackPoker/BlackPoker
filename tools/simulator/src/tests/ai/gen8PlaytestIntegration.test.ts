import { describe, it, expect } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { PlaytestPolicyFactory } from "../../engine/playtest/PlaytestPolicyFactory";
import {
  PLAYTEST_POLICY_OPTIONS,
  createSeatControllers,
} from "../../engine/playtest/PlaytestSeatController";
import {
  GEN8_CHAMPION_CANDIDATE_POLICY_ID,
  GEN8_CHAMPION_CANDIDATE_GENOME_ID,
  GEN8_CHAMPION_CANDIDATE_EXPECTED_DIGEST,
  GEN8_CHAMPION_CANDIDATE_SUPPORTED_REGULATION_ID,
  loadAndValidateGen8ChampionCandidateDNA,
  createGen8ChampionCandidatePolicy,
} from "../../engine/ai/Gen8DNALoader";
import { PlaytestPerspectiveResolver } from "../../ui/playtest/PlaytestPerspectiveResolver";
import { PlayerObservationPresenter } from "../../ui/game/PlayerObservationPresenter";
import { ObservationFactory } from "../../engine/decision/ObservationFactory";
import {
  createHumanFeedbackEntry,
  exportSanitizedPlaytestFeedbackBundle,
  HumanFeedbackCategory,
  PlaytestHumanFeedbackEntryV1,
} from "../../ui/playtest/PlaytestFeedbackTypes";
import { PlaytestDiagnosticBundleV1 } from "../../ui/playtest/PlaytestDiagnosticBundle";
import { PlaytestDecisionTranscriptEntryV1 } from "../../ui/playtest/PlaytestDecisionTranscript";
import { PlaytestFeedbackModal } from "../../ui/playtest/PlaytestFeedbackModal";
import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader";
import { loadRegulationCatalogForBrowser } from "../../engine/regulation/BrowserRegulationLoader";
import {
  startMatchAttempt,
  OFFICIAL_ENV_PREFIX,
} from "../../engine/playtest/PlaytestEnvironmentController";
import { advanceAutomatedDecisions } from "../../engine/playtest/HumanVsPolicyController";

describe("BlackPoker Work 4-6 R1 — Gen 8 Playtest Integration & Stabilization Tests", () => {
  const fullRulePackage = loadRulePackageForBrowser();
  const catalog = loadRegulationCatalogForBrowser();
  const officialStandardPackEnvId = `${OFFICIAL_ENV_PREFIX}standard-pack`;

  describe("1. Gen 8 DNA Authenticity & Factory Integration", () => {
    it("should load the authentic Gen 8 candidate DNA matching the registered digest", () => {
      const dna = loadAndValidateGen8ChampionCandidateDNA();
      expect(dna).toBeDefined();
      expect(dna.metadata?.id).toBe("dna-gen8-prod-g0-ind7-cross7");
    });

    it("should instantiate GenomePolicy for Gen 8 candidate in standard-pack regulation", () => {
      const policy = PlaytestPolicyFactory.createPolicy(
        GEN8_CHAMPION_CANDIDATE_POLICY_ID,
        12345,
        "p2",
        GEN8_CHAMPION_CANDIDATE_SUPPORTED_REGULATION_ID
      );
      expect(policy).toBeDefined();
      expect(policy.descriptor.kind).toBe("genome");
      expect(policy.descriptor.name).toBe("Gen 8 Champion Candidate");
    });

    it("should fail-closed if Gen 8 candidate is requested for an unsupported regulation", () => {
      expect(() => {
        PlaytestPolicyFactory.createPolicy(
          GEN8_CHAMPION_CANDIDATE_POLICY_ID,
          12345,
          "p2",
          "light-entry16"
        );
      }).toThrowError(/Gen 8 Champion Candidate AI は公式レギュレーション standard-pack 専用です/);

      expect(() => {
        PlaytestPolicyFactory.createPolicy(
          GEN8_CHAMPION_CANDIDATE_POLICY_ID,
          12345,
          "p2",
          undefined
        );
      }).toThrowError(/Gen 8 Champion Candidate AI は公式レギュレーション standard-pack 専用です/);
    });

    it("should register Gen 8 Candidate in PLAYTEST_POLICY_OPTIONS with standard-pack regulation filter", () => {
      const option = PLAYTEST_POLICY_OPTIONS.find(
        (opt) => opt.id === GEN8_CHAMPION_CANDIDATE_POLICY_ID
      );
      expect(option).toBeDefined();
      expect(option?.label).toBe("Gen 8 Champion Candidate（正式Holdout検証済み）");
      expect(option?.description).toContain("スタンダード＋パック向け進化AI");
      expect(option?.description).toContain("Gen 7との正式Holdout 240試合で147勝93敗");
      expect(option?.supportedRegulationIds).toEqual(["standard-pack"]);
      expect(option?.evolutionDetails).toBeDefined();
      expect(option?.evolutionDetails?.generation).toBe("Gen 8 (g0-ind7-cross7)");
      expect(option?.evolutionDetails?.dnaSchema).toBe("v6");
    });
  });

  describe("2. Real Core Hidden Information Protection & Perspective", () => {
    it("should always position the active human seat at the bottom (front) in Human vs AI mode", () => {
      const p1Perspective = PlaytestPerspectiveResolver.resolvePerspective({
        matchMode: "humanVsAi",
        activeHumanSeat: "p1",
      });
      expect(p1Perspective.bottomPlayerKey).toBe("p1");
      expect(p1Perspective.topPlayerKey).toBe("p2");

      const p2Perspective = PlaytestPerspectiveResolver.resolvePerspective({
        matchMode: "humanVsAi",
        activeHumanSeat: "p2",
      });
      expect(p2Perspective.bottomPlayerKey).toBe("p2");
      expect(p2Perspective.topPlayerKey).toBe("p1");
    });

    it("should conceal AI opponent hand cards in real core GameSession while disclosing handCount", () => {
      // 実際の Core エンジンから standard-pack の対戦を初期化
      const outcome = startMatchAttempt({
        environmentId: officialStandardPackEnvId,
        seedInput: "350001",
        catalog,
        fullRulePackage,
      });

      expect(outcome.type).toBe("READY");
      if (outcome.type !== "READY") return;

      const rawSessionState = outcome.session.state;
      // 実 Core の P2 (AI) 手札には実際に 7 枚のカードが存在することを確認
      expect(rawSessionState.players.p2.hand.length).toBe(7);

      // 人間 (P1) 視点の PlayerObservation を生成
      const p1Observation = ObservationFactory.createObservation(
        rawSessionState,
        "p1" // viewerPlayerId
      );

      // 人間視点から P2 (相手AI) の ViewModel を構築
      const opponentViewModel = PlayerObservationPresenter.buildPlayerViewModel(
        "p2",
        p1Observation,
        rawSessionState,
        "p1"
      );

      expect(opponentViewModel.isViewer).toBe(false);
      // 相手手札の枚数は実CoreのP2手札枚数と一致
      expect(opponentViewModel.handCount).toBe(rawSessionState.players.p2.hand.length);
      expect(opponentViewModel.handCards.length).toBe(rawSessionState.players.p2.hand.length);
      // しかしカード詳細は全て HIDDEN であり、suit や rank などの非公開情報は一切露出しない！
      for (const card of opponentViewModel.handCards) {
        expect(card.visibility).toBe("HIDDEN");
        expect(card.faceUp).toBe(false);
        expect((card as any).suit).toBeUndefined();
        expect((card as any).rank).toBeUndefined();
      }

      // 比較検証: 観戦者自身 (P1) の手札は KNOWN であり suit / rank が確認できる
      const viewerViewModel = PlayerObservationPresenter.buildPlayerViewModel(
        "p1",
        p1Observation,
        rawSessionState,
        "p1"
      );
      expect(viewerViewModel.isViewer).toBe(true);
      expect(viewerViewModel.handCount).toBe(rawSessionState.players.p1.hand.length);
      expect(viewerViewModel.handCards.length).toBe(rawSessionState.players.p1.hand.length);
      for (const card of viewerViewModel.handCards) {
        expect(card.visibility).toBe("KNOWN");
        expect((card as any).suit).toBeDefined();
        expect((card as any).rank).toBeDefined();
      }
    });
  });

  describe("3. Real Core Human vs Gen 8 Candidate Match Progression", () => {
    it("should execute decisions for Gen 8 Candidate in official standard-pack and return turn to Human", async () => {
      const outcome = startMatchAttempt({
        environmentId: officialStandardPackEnvId,
        seedInput: "350001",
        catalog,
        fullRulePackage,
      });

      expect(outcome.type).toBe("READY");
      if (outcome.type !== "READY") return;

      const seatControllers = createSeatControllers("humanVsAi", "p1", GEN8_CHAMPION_CANDIDATE_POLICY_ID);
      const policies = PlaytestPolicyFactory.createPoliciesForMatch(
        seatControllers,
        outcome.activeMatch.seed,
        "standard-pack"
      );

      expect(seatControllers.p1.kind).toBe("HUMAN");
      expect(seatControllers.p2.kind).toBe("POLICY");
      expect(policies.p2).toBeDefined();
      expect(policies.p2.descriptor.name).toBe("Gen 8 Champion Candidate");

      let step = outcome.initialStep;
      expect(step.type).toBe("WAITING_FOR_DECISION");
      if (step.type !== "WAITING_FOR_DECISION") return;

      // 人間 P1 がアクションを選択
      const req1 = step.request;
      expect(req1.playerId).toBe("p1");

      const endActionRef = req1.patterns.findIndex((p) => {
        if (p.kind !== "ACTION" || p.actionSelectionRef === undefined) return false;
        return req1.catalog.actions[p.actionSelectionRef]?.actionId === "action.end";
      });
      expect(endActionRef).toBeGreaterThanOrEqual(0);

      // P1 の判断を提出
      step = outcome.session.submitDecision({
        decisionId: req1.decisionId,
        stateVersion: req1.stateVersion,
        selectedPatternRef: endActionRef,
      });

      // AI (P2) にターンが渡るか、P1 の追加入力
      if (step.type === "WAITING_FOR_DECISION" && step.request.playerId === "p1") {
        const passPatternRef = step.request.patterns.findIndex((p) => p.kind === "PASS");
        if (passPatternRef >= 0) {
          step = outcome.session.submitDecision({
            decisionId: step.request.decisionId,
            stateVersion: step.request.stateVersion,
            selectedPatternRef: passPatternRef,
          });
        }
      }

      // advanceAutomatedDecisions により Gen 8 AI が自動思考
      const advanceResult = await advanceAutomatedDecisions(
        outcome.session,
        step,
        seatControllers,
        policies,
        { maxAutomatedDecisions: 10 }
      );

      expect(advanceResult.status).toBe("STOPPED");
      if (advanceResult.status !== "STOPPED") {
        throw new Error(`Unexpected advanceResult status: ${(advanceResult as any).status}`);
      }
      // AI の思考が完了して人間のターン (HUMAN_TURN) またはゲーム終了 (FINISHED) で停止
      expect(["HUMAN_TURN", "FINISHED"]).toContain(advanceResult.reason);
      // AI の思考記録が生成されていること
      expect(advanceResult.records.length).toBeGreaterThan(0);
      for (const rec of advanceResult.records) {
        expect(rec.playerId).toBe("p2");
        expect(rec.policyDescriptor.name).toBe("Gen 8 Champion Candidate");
        expect(rec.response.selectedPatternRef).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe("4. React Hooks Safety & Decision Sync (PlaytestFeedbackModal)", () => {
    const mockTranscript: PlaytestDecisionTranscriptEntryV1[] = [
      {
        seq: 1,
        actor: "policy",
        playerId: "p2",
        decisionId: "dec-ai-101",
        stateVersion: 10,
        response: { decisionId: "dec-ai-101", stateVersion: 10, selectedPatternRef: 1 },
      },
      {
        seq: 2,
        actor: "policy",
        playerId: "p2",
        decisionId: "dec-ai-102",
        stateVersion: 15,
        response: { decisionId: "dec-ai-102", stateVersion: 15, selectedPatternRef: 4 },
      },
    ];

    it("should toggle open and close multiple times without React Hooks order violation", () => {
      let isModalOpen = false;
      const onAdd = () => {};
      const onDelete = () => {};
      const onClose = () => {
        isModalOpen = false;
      };

      // 1. 最初は非表示 (isOpen = false)
      let renderer!: TestRenderer.ReactTestRenderer;
      act(() => {
        renderer = TestRenderer.create(
          React.createElement(PlaytestFeedbackModal, {
            isOpen: false,
            onClose: onClose,
            transcript: mockTranscript,
            feedbacks: [],
            onAddFeedback: onAdd,
            onDeleteFeedback: onDelete,
            diagnosticBundle: null,
          })
        );
      });
      expect(renderer.toJSON()).toBeNull();

      // 2. 開く (isOpen = true) -> Hooks が正常に動作しレンダリングされる
      act(() => {
        renderer.update(
          React.createElement(PlaytestFeedbackModal, {
            isOpen: true,
            onClose: onClose,
            transcript: mockTranscript,
            feedbacks: [],
            onAddFeedback: onAdd,
            onDeleteFeedback: onDelete,
            diagnosticBundle: null,
          })
        );
      });
      expect(renderer.toJSON()).not.toBeNull();

      // 3. 再び閉じる (isOpen = false) -> エラーなくアンマウント
      act(() => {
        renderer.update(
          React.createElement(PlaytestFeedbackModal, {
            isOpen: false,
            onClose: onClose,
            transcript: mockTranscript,
            feedbacks: [],
            onAddFeedback: onAdd,
            onDeleteFeedback: onDelete,
            diagnosticBundle: null,
          })
        );
      });
      expect(renderer.toJSON()).toBeNull();

      // 4. 再度開く (isOpen = true) -> フック順序不一致エラーが発生しないこと！
      act(() => {
        renderer.update(
          React.createElement(PlaytestFeedbackModal, {
            isOpen: true,
            onClose: onClose,
            transcript: mockTranscript,
            feedbacks: [],
            onAddFeedback: onAdd,
            onDeleteFeedback: onDelete,
            diagnosticBundle: null,
          })
        );
      });
      expect(renderer.toJSON()).not.toBeNull();
    });

    it("should automatically sync selectedDecisionId to the latest AI decision when opened or updated", () => {
      let capturedFeedback: PlaytestHumanFeedbackEntryV1 | null = null;
      let renderer!: TestRenderer.ReactTestRenderer;

      act(() => {
        renderer = TestRenderer.create(
          React.createElement(PlaytestFeedbackModal, {
            isOpen: true,
            onClose: () => {},
            transcript: mockTranscript,
            feedbacks: [],
            onAddFeedback: (fb: PlaytestHumanFeedbackEntryV1) => {
              capturedFeedback = fb;
            },
            onDeleteFeedback: () => {},
            diagnosticBundle: null,
            aiGenomeId: GEN8_CHAMPION_CANDIDATE_GENOME_ID,
            aiDnaDigest: GEN8_CHAMPION_CANDIDATE_EXPECTED_DIGEST,
          })
        );
      });

      // 初回表示時は最新の AI Decision (dec-ai-102) が対象
      const findAddButton = () => {
        return renderer.root.findAll((node) =>
          node.type === "button" &&
          Array.isArray(node.children) &&
          node.children.some((c) => typeof c === "string" && c.includes("違和感フィードバックを記録"))
        )[0];
      };

      const addButton = findAddButton();
      expect(addButton).toBeDefined();

      act(() => {
        addButton.props.onClick();
      });

      expect(capturedFeedback).not.toBeNull();
      expect(capturedFeedback?.decisionId).toBe("dec-ai-102");
      expect(capturedFeedback?.selectedPatternRef).toBe(4);

      // 新しい対戦が開始されて transcript が切り替わった場合
      const newMatchTranscript: PlaytestDecisionTranscriptEntryV1[] = [
        {
          seq: 1,
          actor: "policy",
          playerId: "p2",
          decisionId: "dec-newmatch-001",
          stateVersion: 5,
          response: { decisionId: "dec-newmatch-001", stateVersion: 5, selectedPatternRef: 2 },
        },
      ];

      act(() => {
        renderer.update(
          React.createElement(PlaytestFeedbackModal, {
            isOpen: true,
            onClose: () => {},
            transcript: newMatchTranscript,
            feedbacks: [],
            onAddFeedback: (fb: PlaytestHumanFeedbackEntryV1) => {
              capturedFeedback = fb;
            },
            onDeleteFeedback: () => {},
            diagnosticBundle: null,
            aiGenomeId: GEN8_CHAMPION_CANDIDATE_GENOME_ID,
            aiDnaDigest: GEN8_CHAMPION_CANDIDATE_EXPECTED_DIGEST,
          })
        );
      });

      // 古い dec-ai-102 が残らず、新しい最新 Decision (dec-newmatch-001) に自動同期されること
      const updatedAddButton = findAddButton();
      act(() => {
        updatedAddButton.props.onClick();
      });

      expect(capturedFeedback?.decisionId).toBe("dec-newmatch-001");
      expect(capturedFeedback?.selectedPatternRef).toBe(2);
    });
  });

  describe("5. Public Feedback Share Bundle (v2) Safety & Secret Stripping", () => {
    const sampleTranscriptEntry: PlaytestDecisionTranscriptEntryV1 = {
      seq: 12,
      actor: "policy",
      playerId: "p2",
      decisionId: "dec-test-9999",
      stateVersion: 45,
      response: {
        decisionId: "dec-test-9999",
        stateVersion: 45,
        selectedPatternRef: 3,
      },
      policy: {
        kind: "genome",
        name: "Gen 8 Champion Candidate",
        policyVersion: 1,
      },
    };

    it("should export sanitized v2 bundle without seed, matchSeed, or full decisionTranscript", () => {
      const mockDiagnosticBundle: PlaytestDiagnosticBundleV1 = {
        kind: "blackpoker-playtest-diagnostic",
        schemaVersion: 1,
        generatedAt: "2026-11-07T21:00:00.000Z",
        containsHiddenInformation: true, // 内部診断用は非公開情報を含む
        build: { sha: "974e9b00d", ref: "test-ref" },
        match: {
          matchId: "match-sp-001",
          environmentId: "official-standard-pack",
          environmentName: "Standard Pack",
          regulationId: "standard-pack",
          formatId: "standard",
          frameId: "pack",
          seed: 350050, // 秘密情報を再構成可能なシード値！
          matchMode: "humanVsAi",
          humanSeat: "p1",
          policyId: GEN8_CHAMPION_CANDIDATE_POLICY_ID,
          policyMetadata: {
            genomeId: GEN8_CHAMPION_CANDIDATE_GENOME_ID,
            schemaVersion: 6,
            fullDnaDigest: GEN8_CHAMPION_CANDIDATE_EXPECTED_DIGEST,
          },
          seatControllers: {},
          status: "FINISHED",
          winner: "p1",
          finishReason: "Opponent life reached 0",
        },
        normalLogs: ["log1", "secret card details"],
        traces: ["trace with full hidden deck cards"],
        canonicalMatchLog: { meta: {}, events: [] } as any,
        decisionTranscript: [sampleTranscriptEntry],
        snapshot: {
          stateVersion: 45,
          rawState: { secretFullDeck: ["secretCardA", "secretCardB"] },
        },
      };

      const internalFeedback = createHumanFeedbackEntry({
        category: "WHY_NO_ATTACK",
        note: "敵ライフが1なのに直接攻撃せずPASSした",
        transcriptEntry: sampleTranscriptEntry,
        matchSeed: 350050, // 内部フィードバックにはシードがある
        aiGenomeId: GEN8_CHAMPION_CANDIDATE_GENOME_ID,
        aiDnaDigest: GEN8_CHAMPION_CANDIDATE_EXPECTED_DIGEST,
      });

      // 公開共有用バンドル (v2) をエクスポート
      const publicShareBundle = exportSanitizedPlaytestFeedbackBundle(mockDiagnosticBundle, [internalFeedback]);

      expect(publicShareBundle.kind).toBe("blackpoker-playtest-feedback-share");
      expect(publicShareBundle.schemaVersion).toBe(2);
      expect(publicShareBundle.containsHiddenInformation).toBe(false);
      expect(publicShareBundle.privacyNotice).toBeDefined();
      expect(publicShareBundle.privacyNotice).toContain("シード値（seed）");

      // 1. match.seed は完全に除去されていること
      expect((publicShareBundle.match as any).seed).toBeUndefined();

      // 2. feedbacks[0].matchSeed も完全に除去されていること
      expect((publicShareBundle.feedbacks[0] as any).matchSeed).toBeUndefined();

      // 3. sanitizedTranscript (全意思決定履歴) も完全除去されていること
      expect((publicShareBundle as any).sanitizedTranscript).toBeUndefined();

      // 4. 生状態 (rawState, normalLogs, traces) も完全除去されていること
      expect((publicShareBundle as any).normalLogs).toBeUndefined();
      expect((publicShareBundle as any).traces).toBeUndefined();
      expect((publicShareBundle as any).snapshot).toBeUndefined();

      // 5. 公開情報（対象 Decision ID、Pattern、カテゴリ、コメント）は保持されていること
      expect(publicShareBundle.feedbacks.length).toBe(1);
      expect(publicShareBundle.feedbacks[0].decisionId).toBe("dec-test-9999");
      expect(publicShareBundle.feedbacks[0].selectedPatternRef).toBe(3);
      expect(publicShareBundle.feedbacks[0].categoryLabel).toBe("なぜ攻撃しなかった？");
      expect(publicShareBundle.feedbacks[0].note).toBe("敵ライフが1なのに直接攻撃せずPASSした");
    });
  });
});
