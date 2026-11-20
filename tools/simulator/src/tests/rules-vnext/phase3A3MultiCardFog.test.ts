import { describe, it, expect, vi } from "vitest";
import { createFogHandler, cleanupFogsHandler } from "../../engine/rules/commandHandlers";
import { ExpressionEvaluator } from "../../engine/rules/ExpressionEvaluator";
import { AbilityEvaluator } from "../../engine/rules/AbilityEvaluator";
import { CommandContext } from "../../engine/rules/CommandRegistry";
import { ComponentDefinition } from "../../domain/rules/RulePackage";
import { OfficialRegulationMatchSetup } from "../../engine/regulation/OfficialRegulationMatchSetup";
import { ObservationFactory } from "../../engine/decision/ObservationFactory";

describe("作業3A-3: 複数カードFogと全体バフテスト", () => {
  const mockComponents: ComponentDefinition[] = [
    {
      id: "character.soldier",
      name: "一般兵",
      type: "character",
      zone: "field",
      properties: { characterType: "soldier" },
    },
    {
      id: "character.hero",
      name: "英雄",
      type: "character",
      zone: "field",
      properties: { characterType: "soldier" },
    },
    {
      id: "character.bulwark",
      name: "防壁",
      type: "character",
      zone: "field",
      properties: { characterType: "bulwark" },
    },
    {
      id: "fog.force",
      name: "フォース",
      type: "fog",
      zone: "fog",
    },
  ];

  it("1. 複数カードFog生成: 手札から2枚のキーカードがFogへ移動し、cards配列に格納されること", () => {
    const exprEval = new ExpressionEvaluator();
    const mockInterpreter: any = {
      dispatchEvent: vi.fn(),
    };
    const handler = createFogHandler(exprEval, mockInterpreter);

    const c1 = { id: "p1-c-H5", suit: "H", rank: "5", value: 5 };
    const c2 = { id: "p1-c-H8", suit: "H", rank: "8", value: 8 };

    const state: any = {
      stateVersion: 1,
      players: {
        p1: {
          hand: [c1, c2, { id: "p1-c-other", suit: "S", rank: "2", value: 2 }],
          fog: [],
        },
      },
    };

    const context: CommandContext = {
      state,
      playerKey: "p1",
      keyCards: [c1, c2],
      components: mockComponents,
    };

    handler(
      {
        component: "fog.force",
        bindings: {
          target: "self.soldiers",
          amount: 13,
        },
      },
      context
    );

    // 手札から2枚取り除かれ、残り1枚
    expect(state.players.p1.hand.length).toBe(1);
    expect(state.players.p1.hand[0].id).toBe("p1-c-other");

    // Fog に生成され、cards 配列に 2 枚格納
    expect(state.players.p1.fog.length).toBe(1);
    const fog = state.players.p1.fog[0];
    expect(fog.componentId).toBe("fog.force");
    expect(fog.cards).toEqual([c1, c2]);
    expect(fog.card).toEqual(c1);
    expect(fog.bindings.target).toBe("self.soldiers");
    expect(fog.bindings.amount).toBe(13);

    // cardMoved イベントが 2 回発行されたこと
    expect(mockInterpreter.dispatchEvent).toHaveBeenCalledTimes(2);
  });

  it("2. AbilityEvaluator: target: 'self.soldiers' のFogにより自軍の全兵士サイズのみが加算されること", () => {
    const abilityEval = new AbilityEvaluator();

    const p1Soldier = {
      unitId: "u-p1-soldier",
      componentId: "character.soldier",
      cards: [{ id: "c-s5", suit: "S", rank: "5", value: 5 }],
    };
    const p1Hero = {
      unitId: "u-p1-hero",
      componentId: "character.hero",
      cards: [{ id: "c-hk", suit: "H", rank: "K", value: 13 }],
    };
    const p1Bulwark = {
      unitId: "u-p1-bulwark",
      componentId: "character.bulwark",
      cards: [{ id: "c-b2", suit: "D", rank: "2", value: 2 }],
    };
    const p2Soldier = {
      unitId: "u-p2-soldier",
      componentId: "character.soldier",
      cards: [{ id: "c-p2s", suit: "C", rank: "4", value: 4 }],
    };

    const state: any = {
      players: {
        p1: {
          field: [p1Soldier, p1Hero, p1Bulwark],
          fog: [
            {
              fogId: "fog-force",
              componentId: "fog.force",
              bindings: {
                target: "self.soldiers",
                amount: 13,
              },
            },
          ],
        },
        p2: {
          field: [p2Soldier],
          fog: [],
        },
      },
    };

    // P1 兵士: 5 + 13 = 18
    expect(abilityEval.calculateUnitSize(p1Soldier, state, mockComponents)).toBe(18);
    // P1 英雄: 13 + 13 = 26
    expect(abilityEval.calculateUnitSize(p1Hero, state, mockComponents)).toBe(26);
    // P1 防壁: 兵士ではないため加算されず 2
    expect(abilityEval.calculateUnitSize(p1Bulwark, state, mockComponents)).toBe(2);
    // P2 兵士: 相手プレイヤーのフォグのため加算されず 4
    expect(abilityEval.calculateUnitSize(p2Soldier, state, mockComponents)).toBe(4);
  });

  it("3. cleanupFogs: エンド時に2枚カードFogが除去され、墓地TOP選択Pendingが登録されること", () => {
    const mockInterpreter: any = {
      dispatchEvent: vi.fn(),
    };
    const handler = cleanupFogsHandler(mockInterpreter);

    const c1 = { id: "p1-c-H5", suit: "H", rank: "5", value: 5 };
    const c2 = { id: "p1-c-H8", suit: "H", rank: "8", value: 8 };

    const state: any = {
      stateVersion: 1,
      players: {
        p1: {
          field: [],
          fog: [
            {
              fogId: "fog-p1-force",
              componentId: "fog.force",
              cards: [c1, c2],
              card: c1,
              bindings: { target: "self.soldiers", amount: 13 },
            },
          ],
          grave: [],
        },
        p2: {
          field: [],
          fog: [],
          grave: [],
        },
      },
    };

    const context: CommandContext = {
      state,
      playerKey: "p1",
      components: mockComponents,
    };

    handler({}, context);

    // Fog 領域から除去
    expect(state.players.p1.fog.length).toBe(0);

    // 墓地にフォグユニットとして追加
    expect(state.players.p1.grave.length).toBe(1);
    expect(state.players.p1.grave[0].cards).toEqual([c1, c2]);

    // 2枚カードのため墓地TOPは未定となり、pendingGraveTopSelections に登録されること
    expect(state.players.p1.graveTopCardId).toBeUndefined();
    expect(state.pendingGraveTopSelections).toBeDefined();
    expect(state.pendingGraveTopSelections.length).toBe(1);
    expect(state.pendingGraveTopSelections[0].playerId).toBe("p1");
    expect(state.pendingGraveTopSelections[0].candidateCardIds).toEqual(["p1-c-H5", "p1-c-H8"]);

    // 各カードについて cardMoved イベントが発行されたこと (2回)
    const cardMovedCalls = mockInterpreter.dispatchEvent.mock.calls.filter(
      (c: any) => c[0].type === "cardMoved"
    );
    expect(cardMovedCalls.length).toBe(2);
  });

  it("4. verifyCardConservation: 複数カードFogが存在してもカード保存則が正しく検証されること", () => {
    const c1 = { id: "p1-c-H5", suit: "H", rank: "5", value: 5 };
    const c2 = { id: "p1-c-H8", suit: "H", rank: "8", value: 8 };

    const player: any = {
      life: [],
      hand: [],
      field: [],
      grave: [],
      rareCards: [],
      fog: [
        {
          fogId: "fog-force",
          componentId: "fog.force",
          cards: [c1, c2],
        },
      ],
    };

    const expectedDeck: any[] = [
      { suit: "H", rank: "5" },
      { suit: "H", rank: "8" },
    ];

    expect(() => {
      OfficialRegulationMatchSetup.verifyCardConservation("p1", player, expectedDeck);
    }).not.toThrow();
  });

  it("5. Observation: FogView に cards 配列が公開情報として正しくマッピングされること", () => {
    const c1 = { id: "p1-c-H5", suit: "H", rank: "5", value: 5 };
    const c2 = { id: "p1-c-H8", suit: "H", rank: "8", value: 8 };

    const state: any = {
      stateVersion: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          hand: [],
          field: [],
          fog: [
            {
              fogId: "fog-force",
              componentId: "fog.force",
              cards: [c1, c2],
              card: c1,
              bindings: { target: "self.soldiers", amount: 13 },
            },
          ],
          grave: [],
          trumps: [],
        },
        p2: {
          hand: [],
          field: [],
          fog: [],
          grave: [],
          trumps: [],
        },
      },
    };

    const obs = ObservationFactory.createObservation(state, "p1");
    const p1Obs = obs.players.find((p) => p.playerId === "p1");
    expect(p1Obs).toBeDefined();
    expect(p1Obs!.fog.length).toBe(1);
    expect(p1Obs!.fog[0].cards).toBeDefined();
    expect(p1Obs!.fog[0].cards!.length).toBe(2);
    expect(p1Obs!.fog[0].cards![0].cardInstanceId).toBe("p1-c-H5");
    expect(p1Obs!.fog[0].cards![1].cardInstanceId).toBe("p1-c-H8");
  });
});
