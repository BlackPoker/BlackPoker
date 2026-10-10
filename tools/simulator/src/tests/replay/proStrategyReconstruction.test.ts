import { describe, it, expect, beforeAll, vi } from "vitest";
import path from "path";
import {
  loadRegulationCatalog,
  clearRegulationCache,
} from "../../engine/regulation/RegulationLoader";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import {
  startMatchAttempt,
  MatchStartRequest,
  ActiveMatchContext,
} from "../../engine/playtest/PlaytestEnvironmentController";
import { RegulationValidator } from "../../engine/regulation/RegulationValidator";
import {
  reconstructMatch,
  ReconstructMatchParams,
} from "../../engine/replay/ReplayReconstructionService";
import {
  runDeterministicReplay,
} from "../../engine/replay/DeterministicReplayRunner";
import {
  buildUndoReconstructParams,
} from "../../ui/playtest/CoreBattlePlaytest";
import {
  buildPlaytestDiagnosticBundleV1,
  assemblePlaytestDiagnosticBundleParams,
} from "../../ui/playtest/PlaytestDiagnosticBundle";
import {
  createReplayPlanFromDiagnosticBundleV1,
} from "../../ui/playtest/DiagnosticReplayAdapter";
import {
  ScenarioHandSelectionService,
} from "../../engine/regulation/ScenarioHandSelectionService";
import { CardOccurrenceSelection } from "../../engine/regulation/SimulatorDeckProfileResolver";
import {
  SHARE_PARAM_KEYS,
  buildPlaytestShareUrl,
} from "../../ui/playtest/PlaytestShareUrl";
import {
  PlaytestDecisionTranscriptEntryV1,
  createDecisionTranscriptEntry,
} from "../../ui/playtest/PlaytestDecisionTranscript";
import type { ReplayPlanV1 } from "../../engine/replay/ReplayTypes";

describe("BP-SIM-PRO-STRATEGY-PHASE-3: Scenario Hand Reconstruction, Undo, Replay & Diagnostic", () => {
  let catalog: any;
  let fullRulePackage: any;

  beforeAll(async () => {
    clearRegulationCache();
    catalog = await loadRegulationCatalog();
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    fullRulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  // Phase 4 で pro:strategy が正式公開されたため、Validator のモックは不要 (no-op restore 関数を返却)
  const enableProStrategyInValidator = () => {
    return () => {};
  };

  const validH2HP1Scenario: CardOccurrenceSelection[] = [
    { suit: "S", rank: "A", occurrence: 0 },
    { suit: "H", rank: "K", occurrence: 0 },
    { suit: "D", rank: "Q", occurrence: 0 },
  ];
  const validH2HP2Scenario: CardOccurrenceSelection[] = [
    { suit: "C", rank: "A", occurrence: 0 },
    { suit: "C", rank: "K", occurrence: 0 },
    { suit: "C", rank: "Q", occurrence: 0 },
  ];
  const validH2HP1Rare: CardOccurrenceSelection[] = [{ suit: "J", rank: "Joker", occurrence: 0 }];
  const validH2HP2Rare: CardOccurrenceSelection[] = [{ suit: "J", rank: "Joker", occurrence: 1 }];

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
  // 1. Human vs Human Reconstruction (Section 10, 23, Phase 3 R1)
  // =========================================================================
  describe("1. Human vs Human Reconstruction & Determinism", () => {
    it("reconstructs match with exact Scenario cards, Rare cards, pack, life, hand and legal patterns at decision 0", async () => {
      const restore = enableProStrategyInValidator();
      try {
        const seed = 42;
        // 1. Live Match 開始
        const startReq: MatchStartRequest = {
          catalog,
          fullRulePackage,
          environmentId: "official:pro-strategy",
          matchMode: "humanVsHuman",
          seedInput: String(seed),
          rareCardSelections: { p1: validH2HP1Rare, p2: validH2HP2Rare },
          scenarioHandSelections: { p1: validH2HP1Scenario, p2: validH2HP2Scenario },
        };
        const liveRes = await startMatchAttempt(startReq);
        expect(liveRes.type).toBe("READY");
        if (liveRes.type !== "READY") return;

        const liveSession = liveRes.session;
        const liveState = liveSession.state;

        // 2. 決定論的再構築 (reconstructMatch)
        const reconParams: ReconstructMatchParams = {
          environmentId: "official:pro-strategy",
          seed,
          rareCardSelections: liveRes.activeMatch.rareCardSelections,
          scenarioHandSelections: liveRes.activeMatch.scenarioHandSelections,
          transcript: [],
          decisionCount: 0,
          catalog,
          fullRulePackage,
        };
        const reconRes = reconstructMatch(reconParams);

        expect(reconRes.status).toBe("SUCCESS");
        if (reconRes.status !== "SUCCESS") return;

        const reconState = reconRes.session.state;

        // ゾーンの完全一致
        expect(reconState.players.p1.rareCards).toEqual(liveState.players.p1.rareCards);
        expect(reconState.players.p2.rareCards).toEqual(liveState.players.p2.rareCards);
        expect(reconState.players.p1.pack).toEqual(liveState.players.p1.pack);
        expect(reconState.players.p2.pack).toEqual(liveState.players.p2.pack);
        expect(reconState.players.p1.hand).toEqual(liveState.players.p1.hand);
        expect(reconState.players.p2.hand).toEqual(liveState.players.p2.hand);
        expect(reconState.players.p1.life).toEqual(liveState.players.p1.life);
        expect(reconState.players.p2.life).toEqual(liveState.players.p2.life);

        // 先攻およびターンプレイヤーの一致
        expect(reconRes.session.state.activePlayer).toBe(liveSession.state.activePlayer);

        // 初期 DecisionRequest の合法手の一致
        if (
          liveRes.initialStep.type === "WAITING_FOR_DECISION" &&
          reconRes.currentStep.type === "WAITING_FOR_DECISION"
        ) {
          const livePatterns = liveRes.initialStep.request.patterns.map((p) => p.patternId);
          const reconPatterns = reconRes.currentStep.request.patterns.map((p) => p.patternId);
          expect(reconPatterns).toEqual(livePatterns);
          expect(reconPatterns.length).toBeGreaterThan(0);
        }
      } finally {
        restore();
      }
    });

    it("reconstructs match after progressing 3+ decisions with exact boundary match (stateVersion, playerId, source, patterns, GameState)", async () => {
      const restore = enableProStrategyInValidator();
      try {
        const seed = 42;
        // 1. Live Match 開始
        const startReq: MatchStartRequest = {
          catalog,
          fullRulePackage,
          environmentId: "official:pro-strategy",
          matchMode: "humanVsHuman",
          seedInput: String(seed),
          rareCardSelections: { p1: validH2HP1Rare, p2: validH2HP2Rare },
          scenarioHandSelections: { p1: validH2HP1Scenario, p2: validH2HP2Scenario },
        };
        const liveRes = await startMatchAttempt(startReq);
        expect(liveRes.type).toBe("READY");
        if (liveRes.type !== "READY") return;

        // 2. 3件以上の Decision を進行
        const { transcript, currentStep: liveTargetStep } = progressDecisions(
          liveRes.session,
          liveRes.initialStep,
          3
        );
        expect(transcript.length).toBeGreaterThanOrEqual(3);

        const liveTargetState = liveRes.session.state;

        // 3. reconstructMatch で同一条件・Transcript から再構築
        const reconParams: ReconstructMatchParams = {
          environmentId: "official:pro-strategy",
          seed,
          rareCardSelections: liveRes.activeMatch.rareCardSelections,
          scenarioHandSelections: liveRes.activeMatch.scenarioHandSelections,
          transcript,
          decisionCount: transcript.length,
          trailingNormalization: "EXTERNAL_DECISION_BOUNDARY",
          catalog,
          fullRulePackage,
        };
        const reconRes = reconstructMatch(reconParams);

        expect(reconRes.status).toBe("SUCCESS");
        if (reconRes.status !== "SUCCESS") return;

        expect(reconRes.executedDecisions).toBe(transcript.length);
        const reconTargetState = reconRes.session.state;

        // 対象 Decision 境界の比較
        // A. Step Type
        expect(reconRes.currentStep.type).toBe(liveTargetStep.type);

        // B. StateVersion
        expect(reconTargetState.stateVersion).toBe(liveTargetState.stateVersion);

        // C. ActivePlayer
        expect(reconTargetState.activePlayer).toBe(liveTargetState.activePlayer);

        // D. DecisionRequest (WAITING_FOR_DECISION の場合)
        if (
          liveTargetStep.type === "WAITING_FOR_DECISION" &&
          reconRes.currentStep.type === "WAITING_FOR_DECISION"
        ) {
          const liveReq = liveTargetStep.request;
          const reconReq = reconRes.currentStep.request;

          // playerId
          expect(reconReq.playerId).toBe(liveReq.playerId);

          // source
          expect(reconReq.source).toEqual(liveReq.source);

          // legal pattern count & ordered pattern IDs
          const livePatternIds = liveReq.patterns.map((p: any) => p.patternId);
          const reconPatternIds = reconReq.patterns.map((p: any) => p.patternId);
          expect(reconPatternIds.length).toBe(livePatternIds.length);
          expect(reconPatternIds).toEqual(livePatternIds);
        }

        // E. GameState 完全一致
        expect(JSON.parse(JSON.stringify(reconTargetState))).toEqual(
          JSON.parse(JSON.stringify(liveTargetState))
        );
      } finally {
        restore();
      }
    });
  });

  // =========================================================================
  // 2. Human vs AI Reconstruction & Non-Reresolve (Section 11, 24)
  // =========================================================================
  describe("2. Human vs AI Reconstruction & Non-Reresolve Guarantee", () => {
    it("uses committed AI scenario hand from activeMatch without re-running resolveAutoSelections", async () => {
      const restore = enableProStrategyInValidator();
      const autoResolveSpy = vi.spyOn(ScenarioHandSelectionService, "resolveAutoSelections");
      try {
        const seed = 9999;
        autoResolveSpy.mockClear();

        // 1. Live Match 開始 (Human vs AI: AI Scenario & AI Rare は自動選出)
        const startReq: MatchStartRequest = {
          catalog,
          fullRulePackage,
          environmentId: "official:pro-strategy",
          matchMode: "humanVsAi",
          seedInput: String(seed),
          rareCardSelections: { p1: validH2HP1Rare },
          scenarioHandSelections: { p1: validH2HP1Scenario },
        };
        const liveRes = await startMatchAttempt(startReq);
        expect(liveRes.type).toBe("READY");
        if (liveRes.type !== "READY") return;

        // Live Start 時に AI 自動選択が 1 回実行されたことを確認
        expect(autoResolveSpy).toHaveBeenCalledTimes(1);
        autoResolveSpy.mockClear();

        const activeMatch = liveRes.activeMatch;
        expect(activeMatch.scenarioHandSelections?.p2).toBeDefined();
        expect(activeMatch.scenarioHandSelections?.p2?.length).toBe(3);

        // 2. 再構築の実行 (activeMatch に保持された確定 Selections を渡す)
        const reconParams = buildUndoReconstructParams({
          activeMatch,
          targetTranscript: [],
          catalog,
          fullRulePackage,
        });

        const reconRes = reconstructMatch(reconParams);
        expect(reconRes.status).toBe("SUCCESS");

        // 重要証拠: 再構築中に resolveAutoSelections が「追加で 0 回」しか呼ばれていないこと！
        expect(autoResolveSpy).toHaveBeenCalledTimes(0);

        if (reconRes.status === "SUCCESS") {
          // Live と Recon の AI 手札が完全一致すること
          expect(reconRes.session.state.players.p2.hand).toEqual(liveRes.session.state.players.p2.hand);
        }
      } finally {
        autoResolveSpy.mockRestore();
        restore();
      }
    });
  });

  // =========================================================================
  // 3. Missing Scenario Fail-Closed (Section 5, 13)
  // =========================================================================
  describe("3. Missing Scenario Fail-Closed", () => {
    it("fails early with SETUP_FAILED and clear message when scenarioHandSelections is missing in Strategy", () => {
      const restore = enableProStrategyInValidator();
      try {
        // A. 完全欠落
        const reconMissingAll = reconstructMatch({
          environmentId: "official:pro-strategy",
          seed: 42,
          rareCardSelections: { p1: validH2HP1Rare, p2: validH2HP2Rare },
          scenarioHandSelections: undefined,
          transcript: [],
          catalog,
          fullRulePackage,
        });
        expect(reconMissingAll.status).toBe("DIVERGED");
        if (reconMissingAll.status === "DIVERGED") {
          expect(reconMissingAll.code).toBe("SETUP_FAILED");
          expect(reconMissingAll.message).toContain("シナリオ手札の選択が必要です");
        }

        // B. P1 のみ指定 (P2 欠落)
        const reconMissingP2 = reconstructMatch({
          environmentId: "official:pro-strategy",
          seed: 42,
          rareCardSelections: { p1: validH2HP1Rare, p2: validH2HP2Rare },
          scenarioHandSelections: { p1: validH2HP1Scenario },
          transcript: [],
          catalog,
          fullRulePackage,
        });
        expect(reconMissingP2.status).toBe("DIVERGED");
        if (reconMissingP2.status === "DIVERGED") {
          expect(reconMissingP2.code).toBe("SETUP_FAILED");
          expect(reconMissingP2.message).toContain("Player B のシナリオ手札が選択されていません");
        }

        // C. P2 のみ指定 (P1 欠落)
        const reconMissingP1 = reconstructMatch({
          environmentId: "official:pro-strategy",
          seed: 42,
          rareCardSelections: { p1: validH2HP1Rare, p2: validH2HP2Rare },
          scenarioHandSelections: { p2: validH2HP2Scenario },
          transcript: [],
          catalog,
          fullRulePackage,
        });
        expect(reconMissingP1.status).toBe("DIVERGED");
        if (reconMissingP1.status === "DIVERGED") {
          expect(reconMissingP1.code).toBe("SETUP_FAILED");
          expect(reconMissingP1.message).toContain("Player A のシナリオ手札が選択されていません");
        }
      } finally {
        restore();
      }
    });
  });

  // =========================================================================
  // 4. ReconstructMatch Low-Level Contract (Section 12)
  // =========================================================================
  describe("4. ReconstructMatch faithfully applies supplied scenario selections (low-level contract)", () => {
    it("detects mismatch/divergence when an incorrect scenario card is passed to reconstruction", async () => {
      const restore = enableProStrategyInValidator();
      try {
        const seed = 42;
        // Live match
        const startReq: MatchStartRequest = {
          catalog,
          fullRulePackage,
          environmentId: "official:pro-strategy",
          matchMode: "humanVsHuman",
          seedInput: String(seed),
          rareCardSelections: { p1: validH2HP1Rare, p2: validH2HP2Rare },
          scenarioHandSelections: { p1: validH2HP1Scenario, p2: validH2HP2Scenario },
        };
        const liveRes = await startMatchAttempt(startReq);
        expect(liveRes.type).toBe("READY");
        if (liveRes.type !== "READY") return;

        // 誤った P1 シナリオ手札 (1枚を別カードに変える)
        const tamperedP1Scenario: CardOccurrenceSelection[] = [
          { suit: "S", rank: "2", occurrence: 0 }, // ♠A -> ♠2
          { suit: "H", rank: "K", occurrence: 0 },
          { suit: "D", rank: "Q", occurrence: 0 },
        ];

        const reconParams: ReconstructMatchParams = {
          environmentId: "official:pro-strategy",
          seed,
          rareCardSelections: liveRes.activeMatch.rareCardSelections,
          scenarioHandSelections: { p1: tamperedP1Scenario, p2: validH2HP2Scenario },
          transcript: [],
          catalog,
          fullRulePackage,
        };
        const reconRes = reconstructMatch(reconParams);
        expect(reconRes.status).toBe("SUCCESS");
        if (reconRes.status === "SUCCESS") {
          // 初期手札が Live Match の初期手札と異なること (改ざんが反映されデッキ順も乖離する)
          expect(reconRes.session.state.players.p1.hand).not.toEqual(liveRes.session.state.players.p1.hand);
        }
      } finally {
        restore();
      }
    });
  });

  // =========================================================================
  // 5. UI Undo Integration (Section 14, Phase 3 R1)
  // =========================================================================
  describe("5. UI Undo Helper Integration", () => {
    it("buildUndoReconstructParams correctly propagates scenarioHandSelections from activeMatch", async () => {
      const restore = enableProStrategyInValidator();
      try {
        const mockActiveMatch: ActiveMatchContext = {
          environmentId: "official:pro-strategy",
          environmentName: "プロ + ストラテジー (公式)",
          regulationId: "pro-strategy",
          seed: 42,
          rulePackage: { id: "official-pro-strategy", version: "1.0.0" } as any,
          rareCardSelections: { p1: validH2HP1Rare, p2: validH2HP2Rare },
          scenarioHandSelections: { p1: validH2HP1Scenario, p2: validH2HP2Scenario },
        };

        const params = buildUndoReconstructParams({
          activeMatch: mockActiveMatch,
          targetTranscript: [],
          catalog,
          fullRulePackage,
        });

        expect(params.environmentId).toBe("official:pro-strategy");
        expect(params.seed).toBe(42);
        expect(params.rareCardSelections).toBe(mockActiveMatch.rareCardSelections);
        expect(params.scenarioHandSelections).toBe(mockActiveMatch.scenarioHandSelections);
        expect(params.scenarioHandSelections).toEqual({
          p1: validH2HP1Scenario,
          p2: validH2HP2Scenario,
        });

        const reconRes = reconstructMatch(params);
        expect(reconRes.status).toBe("SUCCESS");
      } finally {
        restore();
      }
    });

    it("undoes decisions to a target transcript prefix using buildUndoReconstructParams preserving Scenario Hand", async () => {
      const restore = enableProStrategyInValidator();
      try {
        const seed = 42;
        const startReq: MatchStartRequest = {
          catalog,
          fullRulePackage,
          environmentId: "official:pro-strategy",
          matchMode: "humanVsHuman",
          seedInput: String(seed),
          rareCardSelections: { p1: validH2HP1Rare, p2: validH2HP2Rare },
          scenarioHandSelections: { p1: validH2HP1Scenario, p2: validH2HP2Scenario },
        };
        const liveRes = await startMatchAttempt(startReq);
        expect(liveRes.type).toBe("READY");
        if (liveRes.type !== "READY") return;

        // 3 Decisions 進行
        const { transcript } = progressDecisions(liveRes.session, liveRes.initialStep, 3);
        expect(transcript.length).toBeGreaterThanOrEqual(3);

        // 1手前 (2 Decisions) へ戻すための targetTranscript
        const targetTranscript = transcript.slice(0, 2);

        // buildUndoReconstructParams でパラメータ構築
        const undoParams = buildUndoReconstructParams({
          activeMatch: liveRes.activeMatch,
          targetTranscript,
          catalog,
          fullRulePackage,
        });

        // 成立済み Scenario Hand が caller 側で確実に引き渡されていること
        expect(undoParams.scenarioHandSelections).toBe(liveRes.activeMatch.scenarioHandSelections);

        const undoReconRes = reconstructMatch(undoParams);
        expect(undoReconRes.status).toBe("SUCCESS");
        if (undoReconRes.status !== "SUCCESS") return;

        expect(undoReconRes.executedDecisions).toBe(2);

        // 2手目時点の基準状態を別途 reconstructMatch して一致を検証
        const baselineParams: ReconstructMatchParams = {
          environmentId: "official:pro-strategy",
          seed,
          rareCardSelections: liveRes.activeMatch.rareCardSelections,
          scenarioHandSelections: liveRes.activeMatch.scenarioHandSelections,
          transcript: targetTranscript,
          decisionCount: 2,
          trailingNormalization: "EXTERNAL_DECISION_BOUNDARY",
          catalog,
          fullRulePackage,
        };
        const baselineRes = reconstructMatch(baselineParams);
        expect(baselineRes.status).toBe("SUCCESS");
        if (baselineRes.status !== "SUCCESS") return;

        expect(JSON.parse(JSON.stringify(undoReconRes.session.state))).toEqual(
          JSON.parse(JSON.stringify(baselineRes.session.state))
        );
      } finally {
        restore();
      }
    });
  });

  // =========================================================================
  // 6. Exact Physical Occurrence Preservation (Section 6)
  // =========================================================================
  describe("6. Exact Physical Occurrence Preservation", () => {
    it("preserves exact occurrence 0 and 1 for Jokers through serialization/deserialization", async () => {
      const restore = enableProStrategyInValidator();
      try {
        const scenarioWithJoker0: CardOccurrenceSelection[] = [
          { suit: "J", rank: "Joker", occurrence: 0 },
          { suit: "S", rank: "A", occurrence: 0 },
          { suit: "H", rank: "K", occurrence: 0 },
        ];
        const rareWithJoker1: CardOccurrenceSelection[] = [
          { suit: "J", rank: "Joker", occurrence: 1 },
        ];

        // JSON stringify & parse を経ても occurrence が失われないことを確認
        const serialized = JSON.stringify({
          scenario: scenarioWithJoker0,
          rare: rareWithJoker1,
        });
        const deserialized = JSON.parse(serialized);

        expect(deserialized.scenario[0].occurrence).toBe(0);
        expect(deserialized.rare[0].occurrence).toBe(1);

        const startReq: MatchStartRequest = {
          catalog,
          fullRulePackage,
          environmentId: "official:pro-strategy",
          matchMode: "humanVsHuman",
          seedInput: "42",
          rareCardSelections: { p1: deserialized.rare, p2: validH2HP2Rare },
          scenarioHandSelections: { p1: deserialized.scenario, p2: validH2HP2Scenario },
        };
        const res = await startMatchAttempt(startReq);
        expect(res.type).toBe("READY");
        if (res.type === "READY") {
          // P1 Hand contains Joker occurrence 0 -> canonical id: p1-c-JJoker
          const jokerInHand = res.session.state.players.p1.hand.find((c) => c.suit === "J" && c.rank === "Joker");
          expect(jokerInHand).toBeDefined();
          expect(jokerInHand?.id).toBe("p1-c-JJoker");

          // P1 Rare contains Joker occurrence 1 -> canonical id: p1-c-JJoker#1
          const jokerInRare = res.session.state.players.p1.rareCards.find((c) => c.suit === "J" && c.rank === "Joker");
          expect(jokerInRare).toBeDefined();
          expect(jokerInRare?.id).toBe("p1-c-JJoker#1");

          // reconstructMatch 後も同一の canonical card id が保持されること
          const recon = reconstructMatch({
            environmentId: "official:pro-strategy",
            seed: 42,
            rareCardSelections: res.activeMatch.rareCardSelections,
            scenarioHandSelections: res.activeMatch.scenarioHandSelections,
            transcript: [],
            catalog,
            fullRulePackage,
          });
          expect(recon.status).toBe("SUCCESS");
          if (recon.status === "SUCCESS") {
            const reconJokerInHand = recon.session.state.players.p1.hand.find((c) => c.suit === "J" && c.rank === "Joker");
            const reconJokerInRare = recon.session.state.players.p1.rareCards.find((c) => c.suit === "J" && c.rank === "Joker");
            expect(reconJokerInHand?.id).toBe("p1-c-JJoker");
            expect(reconJokerInRare?.id).toBe("p1-c-JJoker#1");
          }
        }
      } finally {
        restore();
      }
    });
  });

  // =========================================================================
  // 7. Diagnostic Replay Integration (Section 15, 25)
  // =========================================================================
  describe("7. Diagnostic Replay Integration", () => {
    it("builds diagnostic bundle with scenarioHandSelections, converts to ReplayPlan, and runs deterministic replay to VERIFIED", async () => {
      const restore = enableProStrategyInValidator();
      try {
        const seed = 42;
        const startReq: MatchStartRequest = {
          catalog,
          fullRulePackage,
          environmentId: "official:pro-strategy",
          matchMode: "humanVsHuman",
          seedInput: String(seed),
          rareCardSelections: { p1: validH2HP1Rare, p2: validH2HP2Rare },
          scenarioHandSelections: { p1: validH2HP1Scenario, p2: validH2HP2Scenario },
        };
        const liveRes = await startMatchAttempt(startReq);
        expect(liveRes.type).toBe("READY");
        if (liveRes.type !== "READY") return;

        const session = liveRes.session;
        const activeMatch = liveRes.activeMatch;

        // Diagnostic Bundle を生成
        const bundle = buildPlaytestDiagnosticBundleV1(
          assemblePlaytestDiagnosticBundleParams({
            build: { sha: "local", ref: "local" },
            generatedAt: new Date().toISOString(),
            activeMatch,
            activePlaytestSettings: {
              matchMode: "humanVsHuman",
              rareCardSelections: activeMatch.rareCardSelections,
              scenarioHandSelections: activeMatch.scenarioHandSelections,
            },
            activeSeatControllers: { p1: { kind: "HUMAN" }, p2: { kind: "HUMAN" } },
            rawState: JSON.parse(JSON.stringify(session.state)),
            logs: [],
            traces: [],
            canonicalMatchLog: session.getMatchLog(),
            currentStep: liveRes.initialStep,
            decisionTranscript: [],
          })
        );

        // Bundle 検証
        expect(bundle.containsHiddenInformation).toBe(true);
        expect(bundle.match.scenarioHandSelections).toEqual({
          p1: validH2HP1Scenario,
          p2: validH2HP2Scenario,
        });

        // DiagnosticReplayAdapter で ReplayPlan を生成
        const planResult = createReplayPlanFromDiagnosticBundleV1(bundle, { currentBuildSha: "local" });
        expect(planResult.type).toBe("READY");
        if (planResult.type !== "READY") return;

        expect(planResult.plan.scenarioHandSelections).toEqual({
          p1: validH2HP1Scenario,
          p2: validH2HP2Scenario,
        });

        // DeterministicReplayRunner で再実行
        const replayResult = runDeterministicReplay(planResult.plan, {
          catalog,
          fullRulePackage,
        });

        expect(replayResult.status).toBe("VERIFIED");
        if (replayResult.status === "VERIFIED") {
          expect(replayResult.executedDecisions).toBe(0);
          expect(replayResult.totalDecisions).toBe(0);
        }
      } finally {
        restore();
      }
    });

    it("builds multi-decision diagnostic bundle, converts to ReplayPlan, and verifies replay to VERIFIED", async () => {
      const restore = enableProStrategyInValidator();
      try {
        const seed = 42;
        const startReq: MatchStartRequest = {
          catalog,
          fullRulePackage,
          environmentId: "official:pro-strategy",
          matchMode: "humanVsHuman",
          seedInput: String(seed),
          rareCardSelections: { p1: validH2HP1Rare, p2: validH2HP2Rare },
          scenarioHandSelections: { p1: validH2HP1Scenario, p2: validH2HP2Scenario },
        };
        const liveRes = await startMatchAttempt(startReq);
        expect(liveRes.type).toBe("READY");
        if (liveRes.type !== "READY") return;

        // 3 Decisions 進行
        const { transcript, currentStep: liveTargetStep } = progressDecisions(
          liveRes.session,
          liveRes.initialStep,
          3
        );
        expect(transcript.length).toBeGreaterThanOrEqual(3);

        const session = liveRes.session;
        const activeMatch = liveRes.activeMatch;

        // Multi-Decision Diagnostic Bundle を生成
        const bundle = buildPlaytestDiagnosticBundleV1(
          assemblePlaytestDiagnosticBundleParams({
            build: { sha: "local", ref: "local" },
            generatedAt: new Date().toISOString(),
            activeMatch,
            activePlaytestSettings: {
              matchMode: "humanVsHuman",
              rareCardSelections: activeMatch.rareCardSelections,
              scenarioHandSelections: activeMatch.scenarioHandSelections,
            },
            activeSeatControllers: { p1: { kind: "HUMAN" }, p2: { kind: "HUMAN" } },
            rawState: JSON.parse(JSON.stringify(session.state)),
            logs: [],
            traces: [],
            canonicalMatchLog: session.getMatchLog(),
            currentStep: liveTargetStep,
            decisionTranscript: transcript,
          })
        );

        expect(bundle.containsHiddenInformation).toBe(true);
        expect(bundle.match.scenarioHandSelections).toEqual({
          p1: validH2HP1Scenario,
          p2: validH2HP2Scenario,
        });

        // DiagnosticReplayAdapter で ReplayPlan を生成
        const planResult = createReplayPlanFromDiagnosticBundleV1(bundle, { currentBuildSha: "local" });
        expect(planResult.type).toBe("READY");
        if (planResult.type !== "READY") return;

        expect(planResult.plan.decisions.length).toBe(transcript.length);
        expect(planResult.plan.scenarioHandSelections).toEqual({
          p1: validH2HP1Scenario,
          p2: validH2HP2Scenario,
        });

        // DeterministicReplayRunner で再実行
        const replayResult = runDeterministicReplay(planResult.plan, {
          catalog,
          fullRulePackage,
        });

        expect(replayResult.status).toBe("VERIFIED");
        if (replayResult.status === "VERIFIED") {
          expect(replayResult.executedDecisions).toBeGreaterThanOrEqual(3);
          expect(replayResult.totalDecisions).toBeGreaterThanOrEqual(3);
        }
      } finally {
        restore();
      }
    });
  });

  // =========================================================================
  // 8. Tampered Scenario Replay Verification (Section 9, 10, 11)
  // =========================================================================
  describe("8. Tampered Scenario Replay Verification", () => {
    it("verifies original multi-decision replay as VERIFIED and rejects tampered scenario replay with divergence", async () => {
      const restore = enableProStrategyInValidator();
      try {
        const seed = 42;
        // 1. Live Match 開始
        const startReq: MatchStartRequest = {
          catalog,
          fullRulePackage,
          environmentId: "official:pro-strategy",
          matchMode: "humanVsHuman",
          seedInput: String(seed),
          rareCardSelections: { p1: validH2HP1Rare, p2: validH2HP2Rare },
          scenarioHandSelections: { p1: validH2HP1Scenario, p2: validH2HP2Scenario },
        };
        const liveRes = await startMatchAttempt(startReq);
        expect(liveRes.type).toBe("READY");
        if (liveRes.type !== "READY") return;

        // 3 Decisions 進行
        const { transcript, currentStep: liveTargetStep } = progressDecisions(
          liveRes.session,
          liveRes.initialStep,
          3
        );
        expect(transcript.length).toBeGreaterThanOrEqual(3);

        const liveTargetState = liveRes.session.state;

        // 2. 正常な Original ReplayPlan を構築
        const originalPlan: ReplayPlanV1 = {
          environmentId: "official:pro-strategy",
          seed,
          sourceBuild: { sha: "local", ref: "local" },
          rareCardSelections: liveRes.activeMatch.rareCardSelections,
          scenarioHandSelections: liveRes.activeMatch.scenarioHandSelections,
          decisions: transcript,
          expected: {
            status: liveTargetStep.type as any,
            rawState: JSON.parse(JSON.stringify(liveTargetState)),
            currentDecisionRequest:
              liveTargetStep.type === "WAITING_FOR_DECISION"
                ? (liveTargetStep as any).request
                : undefined,
          },
        };

        // 3. Original Replay 実行 -> VERIFIED
        const originalResult = runDeterministicReplay(originalPlan, {
          catalog,
          fullRulePackage,
        });
        expect(originalResult.status).toBe("VERIFIED");
        if (originalResult.status === "VERIFIED") {
          expect(originalResult.executedDecisions).toBe(transcript.length);
        }

        // 4. 改ざん: scenarioHandSelections.p1 の 1 physical card だけを変更
        // ♠A (S.A.0) -> ♠2 (S.2.0)
        const tamperedP1Scenario: CardOccurrenceSelection[] = [
          { suit: "S", rank: "2", occurrence: 0 },
          { suit: "H", rank: "K", occurrence: 0 },
          { suit: "D", rank: "Q", occurrence: 0 },
        ];

        const tamperedPlan: ReplayPlanV1 = {
          ...originalPlan,
          scenarioHandSelections: {
            p1: tamperedP1Scenario,
            p2: validH2HP2Scenario,
          },
        };

        // 5. 改ざん Replay 実行 -> NOT VERIFIED かつ DIVERGED
        const tamperedResult = runDeterministicReplay(tamperedPlan, {
          catalog,
          fullRulePackage,
        });

        expect(tamperedResult.status).not.toBe("VERIFIED");
        expect(tamperedResult.status).toBe("DIVERGED");
        if (tamperedResult.status === "DIVERGED") {
          // Late pattern error (PATTERN_REF_OUT_OF_RANGE) ではないこと！
          expect(tamperedResult.code).not.toBe("PATTERN_REF_OUT_OF_RANGE");
        }
      } finally {
        restore();
      }
    });
  });

  // =========================================================================
  // 9. Share URL Privacy Contract (Section 18)
  // =========================================================================
  describe("9. Share URL Privacy Contract", () => {
    it("ensures Scenario Hand card identities are NEVER encoded into share URLs", () => {
      const fullUrl = buildPlaytestShareUrl("https://example.com/simulator", {
        environmentId: "official:pro-strategy",
        mode: "humanVsHuman",
        seedInput: "42",
        rareCardSelections: { p1: validH2HP1Rare, p2: validH2HP2Rare },
      });

      // Scenario Hand 関連のパラメータキーやカード識別子が含まれないこと
      expect(SHARE_PARAM_KEYS).not.toContain("scenarioHand");
      expect(SHARE_PARAM_KEYS).not.toContain("scenarioP1");
      expect(SHARE_PARAM_KEYS).not.toContain("scenarioP2");
      expect(SHARE_PARAM_KEYS).not.toContain("sh1");
      expect(SHARE_PARAM_KEYS).not.toContain("sh2");
      expect(fullUrl).not.toContain("scenarioHand");
      expect(fullUrl).not.toContain("scenarioP1");
      expect(fullUrl).not.toContain("scenarioP2");
      expect(fullUrl).not.toContain("S.A");
      expect(fullUrl).not.toContain("H.K");
      expect(fullUrl).not.toContain("D.Q");
    });
  });

  // =========================================================================
  // 10. Existing Environments Regression (Section 17, 20, 21)
  // =========================================================================
  describe("10. Existing Environments Regression", () => {
    it("reconstructMatch succeeds for official:pro-rarePack without scenarioHandSelections", () => {
      const reconRarePack = reconstructMatch({
        environmentId: "official:pro-rarePack",
        seed: 42,
        rareCardSelections: {
          p1: [{ suit: "J", rank: "Joker", occurrence: 0 }],
          p2: [{ suit: "J", rank: "Joker", occurrence: 1 }],
        },
        transcript: [],
        catalog,
        fullRulePackage,
      });

      expect(reconRarePack.status).toBe("SUCCESS");
    });

    it("reconstructMatch succeeds for official:light-entry16 without any extra selections", () => {
      const reconLight = reconstructMatch({
        environmentId: "official:light-entry16",
        seed: 42,
        transcript: [],
        catalog,
        fullRulePackage,
      });

      expect(reconLight.status).toBe("SUCCESS");
    });

    it("reconstructMatch succeeds for official:standard-pack without any extra selections", () => {
      const reconPack = reconstructMatch({
        environmentId: "official:standard-pack",
        seed: 42,
        transcript: [],
        catalog,
        fullRulePackage,
      });

      expect(reconPack.status).toBe("SUCCESS");
    });

    it("reconstructMatch succeeds for official:light-pack without any extra selections", () => {
      const reconLightPack = reconstructMatch({
        environmentId: "official:light-pack",
        seed: 42,
        transcript: [],
        catalog,
        fullRulePackage,
      });

      expect(reconLightPack.status).toBe("SUCCESS");
    });

    it("reconstructMatch succeeds for official:standard-rarePack without scenarioHandSelections", () => {
      const reconStandardRarePack = reconstructMatch({
        environmentId: "official:standard-rarePack",
        seed: 42,
        rareCardSelections: {
          p1: [{ suit: "J", rank: "Joker", occurrence: 0 }],
          p2: [{ suit: "J", rank: "Joker", occurrence: 1 }],
        },
        transcript: [],
        catalog,
        fullRulePackage,
      });

      expect(reconStandardRarePack.status).toBe("SUCCESS");
    });
  });
});
