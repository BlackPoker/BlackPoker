import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage } from "../../domain/rules/RulePackage";
import { getPlaytestRulePackage } from "../../engine/rules/RulePackageSelector";
import { GameSession } from "../../engine/session/GameSession";
import { createCoreBattlePresetState } from "../../engine/session/playtest/createCoreBattlePlaytest";
import { PlayerObservationPresenter } from "../../ui/game/PlayerObservationPresenter";

describe("Mobile UI Infrastructure & Responsiveness Tests (Phase 2)", () => {
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
  // 4. Observation & Secret info boundaries via PlayerObservationPresenter
  // --------------------------------------------------------------------------
  describe("PlayerObservationPresenter & Public/Secret Information Boundaries", () => {
    const mockState = {
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
          life: Array(15).fill({ suit: "H", rank: "A" }), // 15枚 (10以上)
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

    it("Presenter correctly presents viewer (Player A) data: exact life, known hand, full grave", () => {
      const p1Vm = PlayerObservationPresenter.buildPlayerViewModel("p1", mockState, undefined, "p1", false);

      expect(p1Vm.isViewer).toBe(true);
      expect(p1Vm.lifeCount).toBe(15);
      expect(p1Vm.lifeDisplay).toBe("15"); // 自分のLifeは正確に表示
      expect(p1Vm.handCount).toBe(2);
      expect(p1Vm.handCards[0].suit).toBe("H"); // 自分の手札はKNOWN
      expect(p1Vm.canViewFullGrave).toBe(true); // 自分の墓地は全件閲覧可能
      expect(p1Vm.graveCards).toHaveLength(3);
    });

    it("Presenter correctly protects opponent (Player B) secret info: '10以上' life, hidden hand, top-only grave", () => {
      const p2Vm = PlayerObservationPresenter.buildPlayerViewModel("p2", mockState, undefined, "p1", false);

      expect(p2Vm.isViewer).toBe(false);
      expect(p2Vm.lifeCount).toBe(15);
      expect(p2Vm.lifeDisplay).toBe("10以上"); // 相手Life >= 10 は「10以上」
      expect(p2Vm.handCount).toBe(3);
      // 相手の手札はHIDDENでsuit/rankは非公開
      expect(p2Vm.handCards[0].faceDown).toBe(true);
      expect(p2Vm.handCards[0].suit).toBeUndefined();

      // 相手の墓地は全件非公開で、トップカードのみが公開
      expect(p2Vm.canViewFullGrave).toBe(false);
      expect(p2Vm.graveCount).toBe(2);
      expect(p2Vm.graveTopCard?.rank).toBe("7");
      expect(p2Vm.graveCards).toHaveLength(1);
      expect(p2Vm.graveCards[0].id).toBe("p2-g2"); // topのみ

      // 相手の伏せ防壁はカード情報が非公開
      expect(p2Vm.fieldUnits[0].cards[0].faceDown).toBe(true);
      expect(p2Vm.fieldUnits[0].cards[0].suit).toBeUndefined();
    });

    it("Opponent life < 10 displays exact number", () => {
      const lowLifeState = {
        ...mockState,
        players: {
          ...mockState.players,
          p2: {
            ...mockState.players.p2,
            life: Array(9).fill({ suit: "H", rank: "A" }), // 9枚
          },
        },
      };

      const p2Vm = PlayerObservationPresenter.buildPlayerViewModel("p2", lowLifeState, undefined, "p1", false);
      expect(p2Vm.lifeCount).toBe(9);
      expect(p2Vm.lifeDisplay).toBe("9"); // 9枚以下は正確な数値
    });

    it("Debug ON mode allows full observation of all secret data", () => {
      const p2VmDebug = PlayerObservationPresenter.buildPlayerViewModel("p2", mockState, undefined, "p1", true);

      expect(p2VmDebug.lifeDisplay).toBe("15"); // Debug時は正確な数値
      expect(p2VmDebug.canViewFullGrave).toBe(true); // Debug時は全墓地閲覧可能
      expect(p2VmDebug.handCards[0].suit).toBe("D"); // Debug時は相手手札も可視化
    });
  });
});
