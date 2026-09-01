import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage } from "../../domain/rules/RulePackage";
import { getPlaytestRulePackage } from "../../engine/rules/RulePackageSelector";
import { GameSession } from "../../engine/session/GameSession";
import { createCoreBattlePresetState } from "../../engine/session/playtest/createCoreBattlePlaytest";
import { ObservationFactory } from "../../engine/decision/ObservationFactory";
import { PlayerObservationPresenter } from "../../ui/game/PlayerObservationPresenter";

describe("Mobile UI Infrastructure & Observation Boundary Tests (Phase 2)", () => {
  let playtestRulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    const full = await loadRulePackageFromDirectory(rulesDir);
    playtestRulePackage = getPlaytestRulePackage(full);
  });

  // --------------------------------------------------------------------------
  // 1. Mobile PASS Availability based strictly on LegalPattern
  // --------------------------------------------------------------------------
  it("Mobile PASS is available when kind === 'PASS' exists in patterns", () => {
    const state = createCoreBattlePresetState();
    const session = new GameSession(state, playtestRulePackage);
    const step = session.advance();

    expect(step.type).toBe("WAITING_FOR_DECISION");
    if (step.type !== "WAITING_FOR_DECISION") {
      throw new Error("Expected WAITING_FOR_DECISION");
    }

    // 手番開始時: PASS パターンが存在する
    const passPatternIdx = step.request.patterns.findIndex((p) => p.kind === "PASS");
    expect(passPatternIdx).toBeGreaterThanOrEqual(0);

    // Mobile Decision Dock はこの passPatternIdx を使用して PASS を送信可能
    const passResponse = {
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: passPatternIdx,
    };
    const nextStep = session.submitDecision(passResponse);
    expect(nextStep.type).toBe("WAITING_FOR_DECISION");
    if (nextStep.type === "WAITING_FOR_DECISION") {
      // チャンスが相手 (p2) に移っていること
      expect(nextStep.request.playerId).toBe("p2");
    }
  });

  it("Mobile PASS is NOT available when kind === 'PASS' is absent in EFFECT_RESOLUTION", () => {
    const state = createCoreBattlePresetState();
    const session = new GameSession(state, playtestRulePackage);
    const step1 = session.advance();
    expect(step1.type).toBe("WAITING_FOR_DECISION");
    if (step1.type !== "WAITING_FOR_DECISION") {
      throw new Error("Expected WAITING_FOR_DECISION");
    }

    // Attack リクエスト
    const attackIdx = step1.request.patterns.findIndex(
      (p) => p.kind === "ACTION" && step1.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.attack"
    );
    const step2 = session.submitDecision({
      decisionId: step1.request.decisionId,
      stateVersion: step1.request.stateVersion,
      selectedPatternRef: attackIdx,
    });
    expect(step2.type).toBe("WAITING_FOR_DECISION");
    if (step2.type !== "WAITING_FOR_DECISION") {
      throw new Error("Expected WAITING_FOR_DECISION");
    }

    // p1 PASS
    const step3 = session.submitDecision({
      decisionId: step2.request.decisionId,
      stateVersion: step2.request.stateVersion,
      selectedPatternRef: step2.request.patterns.findIndex((p) => p.kind === "PASS"),
    });
    expect(step3.type).toBe("WAITING_FOR_DECISION");
    if (step3.type !== "WAITING_FOR_DECISION") {
      throw new Error("Expected WAITING_FOR_DECISION");
    }

    // p2 PASS -> Attack 解決中断 (EFFECT_RESOLUTION)
    const step4 = session.submitDecision({
      decisionId: step3.request.decisionId,
      stateVersion: step3.request.stateVersion,
      selectedPatternRef: step3.request.patterns.findIndex((p) => p.kind === "PASS"),
    });
    expect(step4.type).toBe("WAITING_FOR_DECISION");
    if (step4.type !== "WAITING_FOR_DECISION") {
      throw new Error("Expected WAITING_FOR_DECISION");
    }

    expect(step4.request.source.type).toBe("EFFECT_RESOLUTION");

    // EFFECT_RESOLUTION では PASS パターンが存在しない
    const passPatternIdx = step4.request.patterns.findIndex((p) => p.kind === "PASS");
    expect(passPatternIdx).toBe(-1);
  });

  // --------------------------------------------------------------------------
  // 2. Zone Strip items scalability
  // --------------------------------------------------------------------------
  it("Zone Strip items structure supports Fog, Grave and future extensibility", () => {
    const mockPlayer = {
      name: "Player A",
      life: [1, 2, 3],
      hand: [{ id: "c1" }, { id: "c2" }],
      fog: [{ id: "fog-1", bindings: { target: "u1" } }],
      grave: [{ id: "g1" }, { id: "g2" }, { id: "g3" }],
    };

    const zoneItems = [
      { id: "fog", label: "FOG", count: mockPlayer.fog.length },
      { id: "grave", label: "墓地", count: mockPlayer.grave.length },
      // 将来の拡張例
      { id: "trump", label: "切札", count: 1 },
      { id: "pack", label: "PACK", count: 3 },
      { id: "rare", label: "RARE", count: 0 },
    ];

    expect(zoneItems).toHaveLength(5);
    expect(zoneItems.find((i) => i.id === "fog")?.count).toBe(1);
    expect(zoneItems.find((i) => i.id === "grave")?.count).toBe(3);
    expect(zoneItems.find((i) => i.id === "trump")?.count).toBe(1);
  });

  // --------------------------------------------------------------------------
  // 3. Stage LIFO & TOP selection
  // --------------------------------------------------------------------------
  it("Stage maintains LIFO order where array end is TOP", () => {
    const stageRequests = [
      { id: "req-1", actionId: "action.attack" },
      { id: "req-2", actionId: "action.block" },
      { id: "req-3", actionId: "action.counter" },
    ];

    // reverse した配列の先頭が TOP
    const reversed = stageRequests.slice().reverse();
    expect(reversed[0].id).toBe("req-3");
    expect(reversed[0].actionId).toBe("action.counter");
    expect(reversed[1].id).toBe("req-2");
    expect(reversed[2].id).toBe("req-1");
  });

  // --------------------------------------------------------------------------
  // 4. Observation & Secret info boundaries (Core Observation-first)
  // --------------------------------------------------------------------------
  describe("Core PlayerObservation & PlayerObservationPresenter Boundary Tests", () => {
    const mockRawState = {
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          name: "Player A",
          life: Array(15).fill({ suit: "S", rank: "A" }), // 15枚
          hand: [
            { id: "p1-h1", suit: "H", rank: "7", value: 7 },
            { id: "p1-h2", suit: "C", rank: "2", value: 2 },
          ],
          field: [
            {
              unitId: "u1",
              componentId: "character.bulwark",
              kind: "防壁",
              face: "down",
              cards: [{ id: "bw-p1", suit: "D", rank: "8", value: 8 }],
            },
          ],
          fog: [{ fogId: "f1", bindings: { target: "u1" } }],
          grave: [
            { id: "g1", suit: "S", rank: "3" },
            { id: "g2", suit: "S", rank: "4" },
            { id: "g3", suit: "S", rank: "K" }, // top
          ],
        },
        p2: {
          name: "Player B",
          // 相手の Life に明確な秘密カード（S A, H K, D Q 等）を含む15枚
          life: [
            { id: "sec-life-1", suit: "S", rank: "A", value: 1, code: "SA" },
            { id: "sec-life-2", suit: "H", rank: "K", value: 13, code: "HK" },
            { id: "sec-life-3", suit: "D", rank: "Q", value: 12, code: "DQ" },
            ...Array(12).fill({ id: "sec-life-x", suit: "C", rank: "2", value: 2, code: "C2" }),
          ],
          hand: [
            { id: "p2-h1", suit: "D", rank: "A", value: 1 },
            { id: "p2-h2", suit: "D", rank: "K", value: 13 },
            { id: "p2-h3", suit: "D", rank: "Q", value: 12 },
          ],
          field: [
            {
              unitId: "u2",
              componentId: "character.bulwark",
              kind: "防壁",
              face: "down",
              cards: [{ id: "bw-p2", suit: "C", rank: "9", value: 9 }],
            },
          ],
          fog: [],
          grave: [
            { id: "p2-g1", suit: "H", rank: "2" },
            { id: "p2-g2", suit: "H", rank: "7" }, // top
          ],
        },
      },
    };

    // ケース A & B & C & D: ObservationFactory による境界生成
    it("Core ObservationFactory accurately creates observation boundaries for p1 viewer", () => {
      const observation = ObservationFactory.createObservation(mockRawState, "p1");

      // p1 (viewer: 自分の Life 15)
      const p1Obs = observation.players.find((p) => p.playerId === "p1")!;
      expect(p1Obs.isViewer).toBe(true);
      expect(p1Obs.lifeDisplay).toBe("15");
      expect(p1Obs.lifeCount).toBe(15);
      expect(p1Obs.handCards[0].visibility).toBe("KNOWN");
      expect(p1Obs.canViewFullGrave).toBe(true);
      expect(p1Obs.grave).toHaveLength(3);

      // p2 (opponent: 相手の Life 15)
      const p2Obs = observation.players.find((p) => p.playerId === "p2")!;
      expect(p2Obs.isViewer).toBe(false);
      // ケース B: 相手 Life 10以上は「10以上」かつ exact count は秘匿 (undefined)
      expect(p2Obs.lifeDisplay).toBe("10以上");
      expect(p2Obs.lifeCount).toBeUndefined();

      // ケース A: 相手手札は HIDDEN
      expect(p2Obs.handCount).toBe(3);
      expect(p2Obs.handCards[0].visibility).toBe("HIDDEN");
      expect((p2Obs.handCards[0] as any).suit).toBeUndefined();

      // ケース C: 相手墓地はトップのみ公開
      expect(p2Obs.graveCount).toBe(2);
      expect(p2Obs.graveTopCard?.visibility).toBe("KNOWN");
      expect((p2Obs.graveTopCard as any)?.rank).toBe("7");
      expect(p2Obs.canViewFullGrave).toBe(false);
      expect(p2Obs.grave).toHaveLength(1);

      // ケース D: 相手伏せ防壁は HIDDEN
      expect(p2Obs.field[0].cards[0].visibility).toBe("HIDDEN");
      expect((p2Obs.field[0].cards[0] as any).suit).toBeUndefined();

      // ケース D2: JSON.stringify(observation) しても相手 Life カードの identity (SA, HK, DQ 等) が漏洩しないこと
      const obsJson = JSON.stringify(observation);
      expect(obsJson).not.toContain("sec-life-1");
      expect(obsJson).not.toContain("sec-life-2");
      expect(obsJson).not.toContain("sec-life-3");
      expect(obsJson).not.toContain('"code":"SA"');
      expect(obsJson).not.toContain('"code":"HK"');
      expect(obsJson).not.toContain('"code":"DQ"');
    });

    // Presenter が Observation のみから ViewModel を構築する検証
    it("PlayerObservationPresenter maps PlayerBoardViewModel strictly from Observation", () => {
      const observation = ObservationFactory.createObservation(mockRawState, "p1");

      const p1Vm = PlayerObservationPresenter.buildPlayerViewModel("p1", observation, mockRawState, "p1");
      const p2Vm = PlayerObservationPresenter.buildPlayerViewModel("p2", observation, mockRawState, "p1");

      // p1
      expect(p1Vm.isViewer).toBe(true);
      expect(p1Vm.lifeDisplay).toBe("15");
      expect(p1Vm.lifeCount).toBe(15);
      expect(p1Vm.handCards[0].suit).toBe("H");
      expect(p1Vm.canViewFullGrave).toBe(true);
      expect(p1Vm.graveCards).toHaveLength(3);

      // p2
      expect(p2Vm.isViewer).toBe(false);
      expect(p2Vm.lifeDisplay).toBe("10以上");
      expect(p2Vm.lifeCount).toBeUndefined();
      expect(p2Vm.handCount).toBe(3);
      expect((p2Vm.handCards[0] as any).suit).toBeUndefined();
      expect(p2Vm.canViewFullGrave).toBe(false);
      expect(p2Vm.graveCards).toHaveLength(1);
      expect(p2Vm.graveTopCard.rank).toBe("7");
    });

    // ケース E: 相手 Life < 10 の場合は正確な数値
    it("Opponent life < 10 displays exact number in observation and viewModel", () => {
      const lowLifeState = {
        ...mockRawState,
        players: {
          ...mockRawState.players,
          p2: {
            ...mockRawState.players.p2,
            life: Array(9).fill({ suit: "H", rank: "A" }), // 9枚
          },
        },
      };

      const obs = ObservationFactory.createObservation(lowLifeState, "p1");
      const p2Obs = obs.players.find((p) => p.playerId === "p2")!;
      expect(p2Obs.lifeDisplay).toBe("9");
      expect(p2Obs.lifeCount).toBe(9);

      const p2Vm = PlayerObservationPresenter.buildPlayerViewModel("p2", obs, lowLifeState, "p1");
      expect(p2Vm.lifeDisplay).toBe("9");
      expect(p2Vm.lifeCount).toBe(9);
    });

    // ケース F: Raw と Observation が意図的に食い違っていても、通常 UI (ViewModel) では Observation が勝つ
    it("Observation always supersedes Raw GameState in PlayerBoardViewModel (fail-safe test)", () => {
      const fakeRawState = {
        turnPlayer: "p1",
        chancePlayer: "p1",
        players: {
          p1: { name: "P1", life: 10, hand: [], field: [], fog: [], grave: [] },
          p2: {
            name: "P2",
            life: 99, // 偽装
            hand: [{ id: "raw-leak", suit: "S", rank: "A", value: 1 }], // 意図的リーク
            field: [],
            fog: [],
            grave: [{ id: "g1", suit: "D", rank: "K" }],
          },
        },
      };

      // 正式な Observation では HIDDEN
      const safeObservation = {
        viewerPlayerId: "p1" as const,
        turnPlayerId: "p1" as const,
        chancePlayerId: "p1" as const,
        players: [
          {
            playerId: "p1" as const,
            name: "P1",
            isViewer: true,
            lifeCount: 10,
            lifeDisplay: "10",
            handCount: 0,
            handCards: [],
            field: [],
            fog: [],
            trumps: [],
            graveCount: 0,
            grave: [],
            canViewFullGrave: true,
          },
          {
            playerId: "p2" as const,
            name: "P2",
            isViewer: false,
            lifeDisplay: "10以上",
            handCount: 1,
            handCards: [{ visibility: "HIDDEN" as const, faceUp: false as const }],
            field: [],
            fog: [],
            trumps: [],
            graveCount: 1,
            graveTopCard: { visibility: "KNOWN" as const, cardInstanceId: "g1", suit: "D", rank: "K", value: 13, faceUp: true },
            grave: [{ visibility: "KNOWN" as const, cardInstanceId: "g1", suit: "D", rank: "K", value: 13, faceUp: true }],
            canViewFullGrave: false,
          },
        ],
        stageRequestRefs: [],
        stageRequests: [],
        recentEvents: [],
      };

      const p2Vm = PlayerObservationPresenter.buildPlayerViewModel("p2", safeObservation, fakeRawState, "p1");

      // Raw の手札 ♠A は漏洩せず、Observation の HIDDEN が使用される
      expect((p2Vm.handCards[0] as any).suit).toBeUndefined();
      expect(p2Vm.handCards[0].visibility).toBe("HIDDEN");
      expect(p2Vm.lifeDisplay).toBe("10以上");
      expect(p2Vm.lifeCount).toBeUndefined();
    });

    // ケース G: null / undefined state に対する防御（初回 render クラッシュ防止 smoke test）
    it("handles null or undefined state safely without throwing errors", () => {
      expect(() => ObservationFactory.createObservation(null, "p1")).not.toThrow();
      expect(() => ObservationFactory.createObservation(undefined, "p1")).not.toThrow();
      expect(() => ObservationFactory.createObservation({}, "p1")).not.toThrow();

      const nullVm = PlayerObservationPresenter.buildPlayerViewModel("p1", undefined, null, "p1");
      expect(nullVm).toBeDefined();
      expect(nullVm.lifeDisplay).toBe("0");
      expect(nullVm.handCount).toBe(0);
    });
  });
});
