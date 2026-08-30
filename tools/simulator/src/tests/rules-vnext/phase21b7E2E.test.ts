import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage } from "../../domain/rules/RulePackage";
import { getCoreBattlePlaytestRulePackage, PLAYTEST_SUPPORTED_ACTION_IDS } from "../../engine/rules/RulePackageSelector";
import { createCoreBattlePresetState } from "../../engine/session/playtest/createCoreBattlePlaytest";
import { MatchSetupCoordinator } from "../../engine/session/setup/MatchSetupCoordinator";
import { GameSession } from "../../engine/session/GameSession";
import { BattleRelationPresenter } from "../../ui/game/BattleRelationPresenter";
import { GameEventFormatter } from "../../engine/session/playtest/GameEventFormatter";

describe("Phase 21B.7: Battle Relations, Summoning Sickness, End Hand Limit & Structured Cost Logs", () => {
  let fullPackage: RulePackage;
  let playtestPackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    fullPackage = await loadRulePackageFromDirectory(rulesDir);
    playtestPackage = getCoreBattlePlaytestRulePackage(fullPackage);
  });

  it("1. BattleRelationPresenter builds presentation-only number badges (①, ②) without raw unitId in labels", () => {
    const state: any = {
      players: {
        p1: {
          field: [
            {
              unitId: "soldier-p1-1",
              kind: "一般兵",
              cards: [{ id: "c1", code: "S6", suit: "S", rank: "6" }],
              battle: { role: "attacker" },
            },
          ],
        },
        p2: {
          field: [
            {
              unitId: "soldier-p2-1",
              kind: "一般兵",
              cards: [{ id: "c2", code: "C6", suit: "C", rank: "6" }],
              battle: { role: "blocker", blocksUnitId: "soldier-p1-1" },
            },
            {
              unitId: "bulwark-p2-1",
              kind: "防壁",
              componentId: "character.bulwark",
              cards: [{ id: "c3", code: "H5", suit: "H", rank: "5" }],
              battle: { role: "blocker", blocksUnitId: "soldier-p1-1" },
            },
          ],
        },
      },
    };

    const map = BattleRelationPresenter.buildPresentationMap(state);
    expect(map.size).toBe(3);

    const atk = map.get("soldier-p1-1")!;
    expect(atk).toBeDefined();
    expect(atk.badge).toBe("①");
    expect(atk.label).toContain("① ♠6 一般兵");
    expect(atk.label).not.toContain("soldier-p1-1");
    expect(atk.blockedByBadges).toEqual(["②", "③"]);

    const blk1 = map.get("soldier-p2-1")!;
    expect(blk1).toBeDefined();
    expect(blk1.badge).toBe("②");
    expect(blk1.targetBadge).toBe("①");

    const blk2 = map.get("bulwark-p2-1")!;
    expect(blk2).toBeDefined();
    expect(blk2.badge).toBe("③");
    expect(blk2.targetBadge).toBe("①");
  });

  it("2. Playtest RulePackage includes action.summonSoldier and action.setBulwark", () => {
    expect(PLAYTEST_SUPPORTED_ACTION_IDS.has("action.summonSoldier")).toBe(true);
    expect(PLAYTEST_SUPPORTED_ACTION_IDS.has("action.setBulwark")).toBe(true);

    const actionIds = playtestPackage.actions.map((a) => a.id);
    expect(actionIds).toContain("action.summonSoldier");
    expect(actionIds).toContain("action.setBulwark");
  });

  it("3. Summoning Sickness: Summoned soldier cannot attack in the same turn, but can attack on next turn", () => {
    const rawState = createCoreBattlePresetState();
    const setupResult = MatchSetupCoordinator.setupMatch(rawState);
    const session = new GameSession(setupResult.state, playtestPackage);
    const state = session.state;

    // Player A に防壁1体、前ターンからの古参兵士1体、ライフ8枚、召喚用キーカード (♡8) を用意
    state.players.p1.field = [
      {
        unitId: "bw-p1",
        componentId: "character.bulwark",
        kind: "防壁",
        state: "charge",
        face: "down",
        cards: [{ id: "c-bw", code: "H5", suit: "H", rank: "5", value: 5 }],
        enteredTurn: 1,
      },
      {
        unitId: "soldier-veteran",
        componentId: "character.soldier",
        kind: "一般兵",
        state: "charge",
        face: "up",
        cards: [{ id: "c-vet", code: "S6", suit: "S", rank: "6", value: 6 }],
        enteredTurn: 0, // 前ターンから存在（攻撃可能）
      },
    ];

    state.players.p1.life = [
      { id: "l1", code: "D5", suit: "D", rank: "5", value: 5 },
      { id: "l2", code: "D6", suit: "D", rank: "6", value: 6 },
      { id: "l3", code: "D7", suit: "D", rank: "7", value: 7 },
      { id: "l4", code: "D8", suit: "D", rank: "8", value: 8 },
      { id: "l5", code: "D9", suit: "D", rank: "9", value: 9 },
      { id: "l6", code: "D10", suit: "D", rank: "10", value: 10 },
      { id: "l7", code: "DA", suit: "D", rank: "A", value: 1 },
      { id: "l8", code: "DK", suit: "D", rank: "K", value: 13 },
    ];
    state.players.p1.hand = [
      { id: "key-s8", code: "H8", suit: "H", rank: "8", value: 8 },
    ];

    let step: any = session.advance();
    expect(step.type).toBe("WAITING_FOR_DECISION");
    if (step.type !== "WAITING_FOR_DECISION") return;

    // 兵士召喚 (action.summonSoldier) をリクエスト
    const summonIdx = step.request.patterns.findIndex((p: any) => {
      const act = step.request.catalog.actions[p.actionSelectionRef ?? -1];
      return act?.actionId === "action.summonSoldier";
    });
    expect(summonIdx).toBeGreaterThanOrEqual(0);

    step = session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: summonIdx,
    });

    // PASS を回して Stage の summonSoldier を解決
    while (step.type === "WAITING_FOR_DECISION" && (session.state.stage?.requests?.length || 0) > 0) {
      const passIdx = step.request.patterns.findIndex((p: any) => p.kind === "PASS");
      if (passIdx === -1) break;
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: passIdx,
      });
    }

    // 兵士が場に出ていることを確認
    const summonedSoldier = state.players.p1.field.find(
      (u: any) => u.unitId !== "soldier-veteran" && (u.componentId === "character.soldier" || u.kind === "一般兵")
    );
    expect(summonedSoldier).toBeDefined();
    expect(summonedSoldier.state).toBe("charge");
    expect(summonedSoldier.enteredTurn).toBe(1);

    // 同じ Turn 1 (Player A): アタックをリクエスト
    if (step.type !== "WAITING_FOR_DECISION") return;
    const atkIdx = step.request.patterns.findIndex((p: any) => {
      const act = step.request.catalog.actions[p.actionSelectionRef ?? -1];
      return act?.actionId === "action.attack";
    });
    expect(atkIdx).toBeGreaterThanOrEqual(0);

    step = session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: atkIdx,
    });

    // PASS を回して Stage の Attack を解決 -> アタッカー選択の EFFECT_RESOLUTION Decision へ
    while (step.type === "WAITING_FOR_DECISION" && step.request.source.type !== "EFFECT_RESOLUTION") {
      const passIdx = step.request.patterns.findIndex((p: any) => p.kind === "PASS");
      if (passIdx === -1) break;
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: passIdx,
      });
    }

    // アタッカー選択の EFFECT_RESOLUTION Decision
    expect(step.type).toBe("WAITING_FOR_DECISION");
    if (step.type !== "WAITING_FOR_DECISION") return;
    expect(step.request.source.type).toBe("EFFECT_RESOLUTION");

    // このターン出た兵士 (key-s8) はアタッカー選択肢に含まれないこと（召喚酔い）
    for (const eff of step.request.catalog.effectSelections) {
      if (eff.selectedValues) {
        expect(eff.selectedValues).not.toContain(summonedSoldier.unitId);
      }
    }
  });

  it("4. End of turn hand limit: Discard down to 7 cards when hand > 7", () => {
    const rawState = createCoreBattlePresetState();
    const setupResult = MatchSetupCoordinator.setupMatch(rawState);
    const session = new GameSession(setupResult.state, playtestPackage);
    const state = session.state;

    // Player A の手札を 9 枚にする (2枚超過)
    state.players.p1.hand = [
      { id: "h1", code: "S2", suit: "S", rank: "2" },
      { id: "h2", code: "S3", suit: "S", rank: "3" },
      { id: "h3", code: "S4", suit: "S", rank: "4" },
      { id: "h4", code: "S5", suit: "S", rank: "5" },
      { id: "h5", code: "S6", suit: "S", rank: "6" },
      { id: "h6", code: "S7", suit: "S", rank: "7" },
      { id: "h7", code: "S8", suit: "S", rank: "8" },
      { id: "h8", code: "S9", suit: "S", rank: "9" },
      { id: "h9", code: "S10", suit: "S", rank: "10" },
    ];
    expect(state.players.p1.hand.length).toBe(9);

    // Player A が End をリクエスト
    let step: any = session.advance();
    if (step.type !== "WAITING_FOR_DECISION") return;

    const endIdx = step.request.patterns.findIndex((p: any) => {
      const act = step.request.catalog.actions[p.actionSelectionRef ?? -1];
      return act?.actionId === "action.end";
    });
    expect(endIdx).toBeGreaterThanOrEqual(0);

    step = session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: endIdx,
    });

    // PASS を回して Stage の End 解決へ進める
    while (step.type === "WAITING_FOR_DECISION" && session.state.stage?.requests?.length > 0) {
      const passIdx = step.request.patterns.findIndex((p: any) => p.kind === "PASS");
      if (passIdx === -1) break;
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: passIdx,
      });
    }

    // End 解決中に手札超過 (9枚 > 7枚) のため EFFECT_RESOLUTION で 2 枚選択 Decision が発生
    expect(step.type).toBe("WAITING_FOR_DECISION");
    if (step.type !== "WAITING_FOR_DECISION") return;
    expect(step.request.source.type).toBe("EFFECT_RESOLUTION");
    expect((step.request.source as any).effectStepId).toBe("selectDiscardCards");

    // カタログの選択肢はすべて「2枚選択」の組み合わせであること
    for (const eff of step.request.catalog.effectSelections) {
      expect(eff.selectedValues?.length).toBe(2);
    }

    // 最初の 2 枚破棄パターンを選択して submit
    step = session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: 0,
    });

    // 手札が 7 枚以下になったことを確認
    expect(state.players.p1.hand.length).toBe(7);
  });

  it("5. Rebuild flow after all soldiers dead: setBulwark -> summonSoldier -> End -> next turn Attack", () => {
    const rawState = createCoreBattlePresetState();
    const setupResult = MatchSetupCoordinator.setupMatch(rawState);
    const session = new GameSession(setupResult.state, playtestPackage);
    const state = session.state;

    // Player A の兵士・防壁を全滅させ、手札に防壁用カードと兵士用カードを用意
    state.players.p1.field = [];
    state.players.p1.life = [
      { id: "l1", code: "D5", suit: "D", rank: "5", value: 5 },
      { id: "l2", code: "D6", suit: "D", rank: "6", value: 6 },
      { id: "l3", code: "D7", suit: "D", rank: "7", value: 7 },
      { id: "l4", code: "D8", suit: "D", rank: "8", value: 8 },
      { id: "l5", code: "D9", suit: "D", rank: "9", value: 9 },
    ];
    state.players.p1.hand = [
      { id: "card-bulwark", code: "H5", suit: "H", rank: "5", value: 5 },
      { id: "card-soldier", code: "S7", suit: "S", rank: "7", value: 7 },
    ];

    let step: any = session.advance();
    if (step.type !== "WAITING_FOR_DECISION") return;

    // 1. 防壁設置 (action.setBulwark: キーカード不要、即時解決でカード選択Decision発生)
    const setBulwarkIdx = step.request.patterns.findIndex((p: any) => {
      const act = step.request.catalog.actions[p.actionSelectionRef ?? -1];
      return act?.actionId === "action.setBulwark";
    });
    expect(setBulwarkIdx).toBeGreaterThanOrEqual(0);

    step = session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: setBulwarkIdx,
    });

    // 即時アクションのため直ちに EFFECT_RESOLUTION (防壁カード選択) が発生
    expect(step.type).toBe("WAITING_FOR_DECISION");
    if (step.type === "WAITING_FOR_DECISION" && step.request.source.type === "EFFECT_RESOLUTION") {
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: 0, // card-bulwark 選択
      });
    }

    // 防壁が場に出ていることを確認
    expect(state.players.p1.field.some((u: any) => u.componentId === "character.bulwark")).toBe(true);

    // 2. 兵士召喚 (action.summonSoldier)
    expect(step.type).toBe("WAITING_FOR_DECISION");
    if (step.type !== "WAITING_FOR_DECISION") return;
    const summonIdx = step.request.patterns.findIndex((p: any) => {
      const act = step.request.catalog.actions[p.actionSelectionRef ?? -1];
      return act?.actionId === "action.summonSoldier";
    });
    expect(summonIdx).toBeGreaterThanOrEqual(0);

    step = session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: summonIdx,
    });

    // PASS を回して summonSoldier 解決
    while (step.type === "WAITING_FOR_DECISION" && session.state.stage?.requests?.length > 0) {
      const passIdx = step.request.patterns.findIndex((p: any) => p.kind === "PASS");
      if (passIdx === -1) break;
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: passIdx,
      });
    }

    // 兵士が場に出ていることを確認
    const soldier = state.players.p1.field.find((u: any) => u.cards?.[0]?.id === "card-soldier");
    expect(soldier).toBeDefined();
    expect(soldier.enteredTurn).toBe(1);


    // 3. ターン終了 (action.end)
    if (step.type !== "WAITING_FOR_DECISION") return;
    const endIdx = step.request.patterns.findIndex((p: any) => {
      const act = step.request.catalog.actions[p.actionSelectionRef ?? -1];
      return act?.actionId === "action.end";
    });
    expect(endIdx).toBeGreaterThanOrEqual(0);

    step = session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: endIdx,
    });

    // PASS を回して End 解決 -> Turn 2 (p2)
    while (step.type === "WAITING_FOR_DECISION" && session.state.turnPlayer === "p1") {
      const passIdx = step.request.patterns.findIndex((p: any) => p.kind === "PASS");
      if (passIdx === -1) break;
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: passIdx,
      });
    }

    expect(state.turnPlayer).toBe("p2");

    // Player B の Turn 2: Draw を解決して End
    while (step.type === "WAITING_FOR_DECISION" && session.state.turnPlayer === "p2") {
      const endIdxP2 = step.request.patterns.findIndex((p: any) => {
        const act = step.request.catalog.actions[p.actionSelectionRef ?? -1];
        return act?.actionId === "action.end";
      });
      if (endIdxP2 !== -1 && session.state.stage?.requests?.length === 0 && session.state.chancePlayer === "p2") {
        step = session.submitDecision({
          decisionId: step.request.decisionId,
          stateVersion: step.request.stateVersion,
          selectedPatternRef: endIdxP2,
        });
      } else {
        const passIdx = step.request.patterns.findIndex((p: any) => p.kind === "PASS");
        if (passIdx === -1) break;
        step = session.submitDecision({
          decisionId: step.request.decisionId,
          stateVersion: step.request.stateVersion,
          selectedPatternRef: passIdx,
        });
      }
    }

    // Turn 3: 再び Player A のターン
    expect(state.turnPlayer).toBe("p1");
    expect(state.turnCount).toBe(3);

    // Draw を解決
    while (step.type === "WAITING_FOR_DECISION" && session.state.stage?.requests?.length > 0) {
      const passIdx = step.request.patterns.findIndex((p: any) => p.kind === "PASS");
      if (passIdx === -1) break;
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: passIdx,
      });
    }

    // Player A が Attack をリクエスト
    if (step.type !== "WAITING_FOR_DECISION") return;
    const atkIdx = step.request.patterns.findIndex((p: any) => {
      const act = step.request.catalog.actions[p.actionSelectionRef ?? -1];
      return act?.actionId === "action.attack";
    });
    expect(atkIdx).toBeGreaterThanOrEqual(0);

    step = session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: atkIdx,
    });

    // PASS を回して Stage の Attack を解決 -> アタッカー選択の EFFECT_RESOLUTION Decision へ
    while (step.type === "WAITING_FOR_DECISION" && step.request.source.type !== "EFFECT_RESOLUTION") {
      const passIdx = step.request.patterns.findIndex((p: any) => p.kind === "PASS");
      if (passIdx === -1) break;
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: passIdx,
      });
    }

    // 次の自分ターン（Turn 3）では、Turn 1 で召喚した兵士がアタッカー候補に含まれていること！
    expect(step.type).toBe("WAITING_FOR_DECISION");
    if (step.type !== "WAITING_FOR_DECISION") return;
    expect(step.request.source.type).toBe("EFFECT_RESOLUTION");

    const selectableAttackerIds = step.request.catalog.effectSelections.flatMap((e: any) => e.selectedValues || []);
    expect(selectableAttackerIds).toContain(soldier.unitId);
  });


  it("5. Structured cost logs: No log when cost is zero, structured log when $D is paid", () => {
    const prevState: any = {
      turnPlayer: "p1",
      players: {
        p1: {
          name: "Player A",
          hand: [{ id: "c1", code: "D7" }],
        },
      },
      stage: { requests: [] },
    };

    // コストなしの場合
    const nextStateNoCost: any = {
      ...prevState,
      stage: {
        requests: [
          {
            id: "req-1",
            controller: "p1",
            selectedCostPayment: {
              discardedCardIds: [],
              drivenBulwarkUnitIds: [],
              sacrificedUnitIds: [],
              lifeCount: 0,
            },
          },
        ],
      },
    };
    const logsNoCost = GameEventFormatter.formatStateTransition(prevState, nextStateNoCost);
    expect(logsNoCost.some((l) => l.message.includes("コストを支払いました"))).toBe(false);

    // $D コストありの場合
    const nextStateWithCost: any = {
      ...prevState,
      stage: {
        requests: [
          {
            id: "req-2",
            controller: "p1",
            selectedCostPayment: {
              discardedCardIds: ["c1"],
              drivenBulwarkUnitIds: [],
              sacrificedUnitIds: [],
              lifeCount: 0,
            },
          },
        ],
      },
    };
    const logsWithCost = GameEventFormatter.formatStateTransition(prevState, nextStateWithCost);
    expect(logsWithCost.some((l) => l.message.includes("[COST] Player A がコストを支払いました: 手札破棄: ♢7 → 墓地"))).toBe(true);
  });
});

