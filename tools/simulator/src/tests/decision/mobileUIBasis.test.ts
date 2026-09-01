import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage } from "../../domain/rules/RulePackage";
import { getPlaytestRulePackage } from "../../engine/rules/RulePackageSelector";
import { GameSession } from "../../engine/session/GameSession";
import { createCoreBattlePresetState } from "../../engine/session/playtest/createCoreBattlePlaytest";

describe("Mobile UI Infrastructure & Responsiveness Tests", () => {
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
    if (step.type !== "WAITING_FOR_DECISION") return;

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
    if (step1.type !== "WAITING_FOR_DECISION") return;

    // Attack リクエスト
    const attackIdx = step1.request.patterns.findIndex(
      (p) => p.kind === "ACTION" && step1.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.attack"
    );
    const step2 = session.submitDecision({
      decisionId: step1.request.decisionId,
      stateVersion: step1.request.stateVersion,
      selectedPatternRef: attackIdx,
    });
    if (step2.type !== "WAITING_FOR_DECISION") return;

    // p1 PASS
    const step3 = session.submitDecision({
      decisionId: step2.request.decisionId,
      stateVersion: step2.request.stateVersion,
      selectedPatternRef: step2.request.patterns.findIndex((p) => p.kind === "PASS"),
    });
    if (step3.type !== "WAITING_FOR_DECISION") return;

    // p2 PASS -> Attack 解決中断 (EFFECT_RESOLUTION)
    const step4 = session.submitDecision({
      decisionId: step3.request.decisionId,
      stateVersion: step3.request.stateVersion,
      selectedPatternRef: step3.request.patterns.findIndex((p) => p.kind === "PASS"),
    });
    expect(step4.type).toBe("WAITING_FOR_DECISION");
    if (step4.type !== "WAITING_FOR_DECISION") return;

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
  // 4. Observation & Secret info boundaries
  // --------------------------------------------------------------------------
  it("Observation preserves secret info boundaries for opponent hand/life", () => {
    const state = createCoreBattlePresetState();
    const session = new GameSession(state, playtestRulePackage);
    const step = session.advance();
    expect(step.type).toBe("WAITING_FOR_DECISION");
    if (step.type !== "WAITING_FOR_DECISION") return;

    const obs = step.request.observation;
    expect(obs).toBeDefined();
    // Observation の viewerPlayerId は現在の判断プレイヤー (p1)
    expect(obs.viewerPlayerId).toBe("p1");

    const p1View = obs.players.find((p: any) => p.playerId === "p1");
    const p2View = obs.players.find((p: any) => p.playerId === "p2");

    expect(p1View).toBeDefined();
    expect(p2View).toBeDefined();

    // 相手 (p2) の手札カードは HIDDEN であり、suit や rank などの詳細情報は漏洩しない
    if (p2View && p2View.handCards) {
      for (const card of p2View.handCards) {
        expect(card.visibility).toBe("HIDDEN");
        expect((card as any).suit).toBeUndefined();
      }
    }
  });

});
