import { describe, it, expect, beforeEach } from "vitest";
import { AbilityEvaluator } from "../../engine/rules/AbilityEvaluator";
import { ExpressionEvaluator } from "../../engine/rules/ExpressionEvaluator";
import { EffectInterpreter } from "../../engine/rules/EffectInterpreter";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry";
import {
  moveMatchingUnitsToGraveyardHandler,
  cleanupFogsHandler,
} from "../../engine/rules/commandHandlers";
import { ComponentDefinition } from "../../domain/rules/RulePackage";
import { MatchLogRecorder } from "../../engine/log/MatchLogRecorder";

function getAllPlayerCardIds(player: any): string[] {
  const ids: string[] = [];
  if (Array.isArray(player.life)) ids.push(...player.life.map((c: any) => c.id));
  if (Array.isArray(player.hand)) ids.push(...player.hand.map((c: any) => c.id));
  if (Array.isArray(player.field)) {
    for (const u of player.field) {
      if (Array.isArray(u.cards)) ids.push(...u.cards.map((c: any) => c.id));
    }
  }
  if (Array.isArray(player.fog)) {
    for (const f of player.fog) {
      if (Array.isArray(f.cards)) ids.push(...f.cards.map((c: any) => c.id));
      else if (f.card) ids.push(f.card.id);
    }
  }
  if (Array.isArray(player.grave)) {
    for (const g of player.grave) {
      if (g.cards && Array.isArray(g.cards)) ids.push(...g.cards.map((c: any) => c.id));
      else if (g.id) ids.push(g.id);
    }
  }
  return ids.sort();
}

describe("Master + Strategy Hardening: Force Size Calculation, Batch Fog Removal & Rain of Swords Safety", () => {
  let abilityEvaluator: AbilityEvaluator;
  let expressionEvaluator: ExpressionEvaluator;
  let effectInterpreter: EffectInterpreter;
  let registry: CommandRegistry;
  let logRecorder: MatchLogRecorder;

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
      id: "character.ace",
      name: "エース",
      type: "character",
      zone: "field",
      properties: { characterType: "soldier" },
    },
    {
      id: "character.magician",
      name: "魔術士",
      type: "character",
      zone: "field",
      properties: { characterType: "soldier" },
    },
    {
      id: "character.armedSoldier",
      name: "装備兵",
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
    {
      id: "fog.statue",
      name: "彫像の霧",
      type: "fog",
      zone: "fog",
    },
  ];

  beforeEach(() => {
    registry = new CommandRegistry();
    abilityEvaluator = registry.getAbilityEvaluator();
    effectInterpreter = registry.getEffectInterpreter();
    expressionEvaluator = new ExpressionEvaluator();
    logRecorder = new MatchLogRecorder({ matchId: "master-hardening-test" });
  });

  function createBaseState(): any {
    return {
      turn: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          name: "Player 1",
          life: [{ id: "l1", suit: "S", rank: "A", value: 1 }],
          hand: [],
          field: [],
          fog: [],
          grave: [],
          graveTopCardId: undefined,
        },
        p2: {
          name: "Player 2",
          life: [{ id: "l2", suit: "H", rank: "A", value: 1 }],
          hand: [],
          field: [],
          fog: [],
          grave: [],
          graveTopCardId: undefined,
        },
      },
      stage: { requests: [] },
      pendingGraveTopSelections: [],
    };
  }

  // ==========================================================================
  // 1. フォース適用中の英雄・全兵士のサイズ計算と剣の雨による除去判定
  // ==========================================================================
  describe("1. Force Unit Size Calculation & Rain of Swords (SwordRain) Integration", () => {
    it("1.1: Force buff applies correctly to all soldier types (hero, ace, magician, armedSoldier) and NOT to bulwark", () => {
      const state = createBaseState();

      // p1 のフォグにフォース（全自軍兵士 +10）を配置
      state.players.p1.fog = [
        {
          fogId: "fog-force-1",
          componentId: "fog.force",
          cards: [
            { id: "h5", suit: "H", rank: "5", value: 5 },
            { id: "h5-2", suit: "H", rank: "5", value: 5 },
          ],
          bindings: {
            target: "self.soldiers",
            amount: 10,
          },
        },
      ];

      const hero = {
        unitId: "u-hero",
        componentId: "character.hero",
        kind: "英雄",
        cards: [{ id: "c-hero", suit: "S", rank: "K", value: 13 }],
      };
      const ace = {
        unitId: "u-ace",
        componentId: "character.ace",
        kind: "エース",
        cards: [{ id: "c-ace", suit: "S", rank: "A", value: 1 }],
      };
      const magician = {
        unitId: "u-magician",
        componentId: "character.magician",
        kind: "魔術士",
        cards: [{ id: "c-magician", suit: "D", rank: "7", value: 7 }],
      };
      const armedSoldier = {
        unitId: "u-armed",
        componentId: "character.armedSoldier",
        kind: "装備兵",
        cards: [
          { id: "c-soldier", suit: "C", rank: "4", value: 4 },
          { id: "c-equip", suit: "C", rank: "6", value: 6 },
        ],
      };
      const bulwark = {
        unitId: "u-bulwark",
        componentId: "character.bulwark",
        kind: "防壁",
        cards: [{ id: "c-bulwark", suit: "S", rank: "8", value: 8 }],
      };

      state.players.p1.field = [hero, ace, magician, armedSoldier, bulwark];

      // 英雄: 13 + 10 = 23
      expect(abilityEvaluator.calculateUnitSize(hero, state, mockComponents)).toBe(23);
      // エース: 1 + 10 = 11
      expect(abilityEvaluator.calculateUnitSize(ace, state, mockComponents)).toBe(11);
      // 魔術士: 7 + 10 = 17
      expect(abilityEvaluator.calculateUnitSize(magician, state, mockComponents)).toBe(17);
      // 装備兵: 10 + 10 = 20
      expect(abilityEvaluator.calculateUnitSize(armedSoldier, state, mockComponents)).toBe(20);
      // 防壁: バフ対象外のため元サイズ 8
      expect(abilityEvaluator.calculateUnitSize(bulwark, state, mockComponents)).toBe(8);

      // p2 の兵士には p1 のフォースは適用されない
      const p2Hero = {
        unitId: "u-p2-hero",
        componentId: "character.hero",
        kind: "英雄",
        cards: [{ id: "c-p2-hero", suit: "H", rank: "K", value: 13 }],
      };
      state.players.p2.field = [p2Hero];
      expect(abilityEvaluator.calculateUnitSize(p2Hero, state, mockComponents)).toBe(13);
    });

    it("1.2: Integration Test: Hero with Force survives SwordRain (maxSize: 20), but dies without Force", () => {
      const handler = moveMatchingUnitsToGraveyardHandler(
        expressionEvaluator,
        abilityEvaluator,
        effectInterpreter
      );

      // --- Case A: フォース適用中（サイズ 13 + 10 = 23 > 20） -> 破壊されず生存 ---
      const stateWithForce = createBaseState();
      stateWithForce.players.p1.fog = [
        {
          fogId: "fog-force-1",
          componentId: "fog.force",
          cards: [
            { id: "h5", suit: "H", rank: "5", value: 5 },
            { id: "h5-2", suit: "H", rank: "5", value: 5 },
          ],
          bindings: {
            target: "self.soldiers",
            amount: 10,
          },
        },
      ];
      const hero = {
        unitId: "u-hero",
        componentId: "character.hero",
        kind: "英雄",
        cards: [{ id: "c-hero", suit: "S", rank: "K", value: 13 }],
      };
      const normalSoldier = {
        unitId: "u-soldier",
        componentId: "character.soldier",
        kind: "一般兵",
        cards: [{ id: "c-soldier", suit: "S", rank: "4", value: 4 }], // 4 + 10 = 14 <= 20
      };
      stateWithForce.players.p1.field = [hero, normalSoldier];

      const contextWithForce: CommandContext = {
        playerKey: "p1",
        state: stateWithForce,
        components: mockComponents,
        logRecorder,
      };

      // 剣の雨を実行: componentType: "soldier", maxSize: 20
      handler({ componentType: "soldier", maxSize: 20 }, contextWithForce);

      // 英雄（サイズ23）は生存し、一般兵（サイズ14）のみ破壊されること
      expect(stateWithForce.players.p1.field).toHaveLength(1);
      expect(stateWithForce.players.p1.field[0].unitId).toBe("u-hero");
      expect(stateWithForce.players.p1.grave).toHaveLength(1);
      expect(stateWithForce.players.p1.grave[0].unitId).toBe("u-soldier");

      // --- Case B: フォースなし（サイズ 13 <= 20） -> 破壊される ---
      const stateWithoutForce = createBaseState();
      const hero2 = {
        unitId: "u-hero-2",
        componentId: "character.hero",
        kind: "英雄",
        cards: [{ id: "c-hero-2", suit: "S", rank: "K", value: 13 }],
      };
      stateWithoutForce.players.p1.field = [hero2];

      const contextWithoutForce: CommandContext = {
        playerKey: "p1",
        state: stateWithoutForce,
        components: mockComponents,
        logRecorder,
      };

      handler({ componentType: "soldier", maxSize: 20 }, contextWithoutForce);

      // 英雄（サイズ13）は破壊されて墓地へ移動すること
      expect(stateWithoutForce.players.p1.field).toHaveLength(0);
      expect(stateWithoutForce.players.p1.grave).toHaveLength(1);
      expect(stateWithoutForce.players.p1.grave[0].unitId).toBe("u-hero-2");
    });
  });

  // ==========================================================================
  // 2. 複数Fogの同時除去の墓地TOP選択・既存対戦互換性・保存則・ログ整合性
  // ==========================================================================
  describe("2. Fog Removal: Single Fog Compatibility, Force Multi-Card Fog, Multi-Player Fogs", () => {
    it("2.1: Same player has 2 single-card Fogs -> Sequential grave addition, NO pending decision (existing match compatibility), last fog becomes graveTop", () => {
      const state = createBaseState();
      const cleanupHandler = cleanupFogsHandler(effectInterpreter);

      const fog1Card = { id: "c-fog-1", suit: "D", rank: "4", value: 4 };
      const fog2Card = { id: "c-fog-2", suit: "C", rank: "6", value: 6 };

      state.players.p1.fog = [
        {
          fogId: "fog-1",
          componentId: "fog.statue",
          card: fog1Card,
          cards: [fog1Card],
        },
        {
          fogId: "fog-2",
          componentId: "fog.statue",
          card: fog2Card,
          cards: [fog2Card],
        },
      ];

      const context: CommandContext = {
        playerKey: "p1",
        state,
        components: mockComponents,
        logRecorder,
      };

      const initialCards = getAllPlayerCardIds(state.players.p1);

      cleanupHandler({}, context);

      // フォグ領域は空になる
      expect(state.players.p1.fog).toHaveLength(0);

      // 墓地に両方のフォグが入っている（計2枚）
      expect(state.players.p1.grave).toHaveLength(2);
      expect(state.players.p1.grave[0].cards[0].id).toBe("c-fog-1");
      expect(state.players.p1.grave[1].cards[0].id).toBe("c-fog-2");

      // 既存対戦互換: 単一カードFogのみの場合は Decision を発生させず、最後のFogが墓地TOPになる
      expect(state.pendingGraveTopSelections).toHaveLength(0);
      expect(state.players.p1.graveTopCardId).toBe("c-fog-2");

      // カード保存則検証
      expect(getAllPlayerCardIds(state.players.p1)).toEqual(initialCards);
    });

    it("2.2: 2-card Force Fog -> Automatically queues pendingGraveTopSelections with candidateCardIds [force1, force2]", () => {
      const state = createBaseState();
      const cleanupHandler = cleanupFogsHandler(effectInterpreter);

      const forceCard1 = { id: "c-force-1", suit: "H", rank: "5", value: 5 };
      const forceCard2 = { id: "c-force-2", suit: "H", rank: "7", value: 7 };

      state.players.p1.fog = [
        {
          fogId: "fog-force",
          componentId: "fog.force",
          cards: [forceCard1, forceCard2],
        },
      ];

      const initialCards = getAllPlayerCardIds(state.players.p1);

      const context: CommandContext = {
        playerKey: "p1",
        state,
        components: mockComponents,
        logRecorder,
      };

      cleanupHandler({}, context);

      // フォグ領域は空になる
      expect(state.players.p1.fog).toHaveLength(0);
      expect(state.players.p1.grave).toHaveLength(1);
      expect(state.players.p1.grave[0].cards).toHaveLength(2);

      // 複数カード（フォース）の移動のため pendingGraveTopSelections に登録される
      expect(state.pendingGraveTopSelections).toHaveLength(1);
      expect(state.pendingGraveTopSelections[0].playerId).toBe("p1");
      expect(state.pendingGraveTopSelections[0].candidateCardIds).toEqual([
        "c-force-1",
        "c-force-2",
      ]);
      expect(state.players.p1.graveTopCardId).toBeUndefined();

      // カード保存則検証
      expect(getAllPlayerCardIds(state.players.p1)).toEqual(initialCards);
    });

    it("2.3: Same player has 2-card Force Fog and 1-card Fog -> Force Fog queues pending, single Fog does not overwrite pending selection", () => {
      const state = createBaseState();
      const cleanupHandler = cleanupFogsHandler(effectInterpreter);

      const forceCard1 = { id: "c-force-1", suit: "H", rank: "5", value: 5 };
      const forceCard2 = { id: "c-force-2", suit: "H", rank: "7", value: 7 };
      const singleCard = { id: "c-single", suit: "S", rank: "2", value: 2 };

      state.players.p1.fog = [
        {
          fogId: "fog-force",
          componentId: "fog.force",
          cards: [forceCard1, forceCard2],
        },
        {
          fogId: "fog-single",
          componentId: "fog.statue",
          cards: [singleCard],
        },
      ];

      const initialCards = getAllPlayerCardIds(state.players.p1);

      const context: CommandContext = {
        playerKey: "p1",
        state,
        components: mockComponents,
        logRecorder,
      };

      cleanupHandler({}, context);

      expect(state.players.p1.fog).toHaveLength(0);
      expect(state.players.p1.grave).toHaveLength(2);

      // フォースFogの pending 選択が単一Fogによって上書きされず保護される
      expect(state.pendingGraveTopSelections).toHaveLength(1);
      expect(state.pendingGraveTopSelections[0].playerId).toBe("p1");
      expect(state.pendingGraveTopSelections[0].candidateCardIds).toEqual([
        "c-force-1",
        "c-force-2",
      ]);
      expect(state.players.p1.graveTopCardId).toBeUndefined();

      // 全3枚が墓地へ移動し、カード保存則が満たされる
      expect(getAllPlayerCardIds(state.players.p1)).toEqual(initialCards);
    });

    it("2.4: Both players have 2-card Force Fogs -> Independent pendingGraveTopSelections for both p1 and p2", () => {
      const state = createBaseState();
      const cleanupHandler = cleanupFogsHandler(effectInterpreter);

      // p1: 2枚フォース
      state.players.p1.fog = [
        {
          fogId: "fog-p1-force",
          componentId: "fog.force",
          cards: [
            { id: "c-p1-1", suit: "S", rank: "3", value: 3 },
            { id: "c-p1-2", suit: "S", rank: "4", value: 4 },
          ],
        },
      ];

      // p2: 2枚フォース
      state.players.p2.fog = [
        {
          fogId: "fog-p2-force",
          componentId: "fog.force",
          cards: [
            { id: "c-p2-1", suit: "H", rank: "2", value: 2 },
            { id: "c-p2-2", suit: "H", rank: "3", value: 3 },
          ],
        },
      ];

      const initialCardsP1 = getAllPlayerCardIds(state.players.p1);
      const initialCardsP2 = getAllPlayerCardIds(state.players.p2);

      const context: CommandContext = {
        playerKey: "p1",
        state,
        components: mockComponents,
        logRecorder,
      };

      cleanupHandler({}, context);

      expect(state.players.p1.fog).toHaveLength(0);
      expect(state.players.p2.fog).toHaveLength(0);

      // 両プレイヤーに独立して pendingGraveTopSelections が生成されること
      expect(state.pendingGraveTopSelections).toHaveLength(2);
      const p1Pending = state.pendingGraveTopSelections.find((p: any) => p.playerId === "p1");
      const p2Pending = state.pendingGraveTopSelections.find((p: any) => p.playerId === "p2");

      expect(p1Pending).toBeDefined();
      expect(p1Pending.candidateCardIds).toEqual(["c-p1-1", "c-p1-2"]);

      expect(p2Pending).toBeDefined();
      expect(p2Pending.candidateCardIds).toEqual(["c-p2-1", "c-p2-2"]);

      expect(getAllPlayerCardIds(state.players.p1)).toEqual(initialCardsP1);
      expect(getAllPlayerCardIds(state.players.p2)).toEqual(initialCardsP2);
    });
  });

  // ==========================================================================
  // 3. 剣の雨（一括除去）の安全性と All-or-Nothing 保証
  // ==========================================================================
  describe("3. Rain of Swords (moveMatchingUnitsToGraveyard) Safety & All-or-Nothing", () => {
    it("3.1: Normal multi-player destruction -> Preflight succeeds, both players have units moved and graveTop queued", () => {
      const state = createBaseState();
      const handler = moveMatchingUnitsToGraveyardHandler(
        expressionEvaluator,
        abilityEvaluator,
        effectInterpreter
      );

      // p1: 兵士2体 (サイズ4, サイズ6)
      state.players.p1.field = [
        {
          unitId: "u-p1-1",
          componentId: "character.soldier",
          cards: [{ id: "c-p1-1", suit: "S", rank: "4", value: 4 }],
        },
        {
          unitId: "u-p1-2",
          componentId: "character.soldier",
          cards: [{ id: "c-p1-2", suit: "S", rank: "6", value: 6 }],
        },
      ];

      // p2: 兵士2体 (サイズ3, サイズ5)
      state.players.p2.field = [
        {
          unitId: "u-p2-1",
          componentId: "character.soldier",
          cards: [{ id: "c-p2-1", suit: "H", rank: "3", value: 3 }],
        },
        {
          unitId: "u-p2-2",
          componentId: "character.soldier",
          cards: [{ id: "c-p2-2", suit: "H", rank: "5", value: 5 }],
        },
      ];

      const initialCardsP1 = getAllPlayerCardIds(state.players.p1);
      const initialCardsP2 = getAllPlayerCardIds(state.players.p2);

      const context: CommandContext = {
        playerKey: "p1",
        state,
        components: mockComponents,
        logRecorder,
      };

      // maxSize: 10 で全兵士破壊
      handler({ componentType: "soldier", maxSize: 10 }, context);

      // 両プレイヤーのフィールドが空になり、墓地に2体ずつ移動
      expect(state.players.p1.field).toHaveLength(0);
      expect(state.players.p2.field).toHaveLength(0);
      expect(state.players.p1.grave).toHaveLength(2);
      expect(state.players.p2.grave).toHaveLength(2);

      // 両プレイヤーに pendingGraveTopSelections が登録される
      expect(state.pendingGraveTopSelections).toHaveLength(2);
      expect(getAllPlayerCardIds(state.players.p1)).toEqual(initialCardsP1);
      expect(getAllPlayerCardIds(state.players.p2)).toEqual(initialCardsP2);
    });

    it("3.2: Duplicate Card ID across players causes Preflight exception -> State is NOT partially mutated (All-or-Nothing)", () => {
      const state = createBaseState();
      const handler = moveMatchingUnitsToGraveyardHandler(
        expressionEvaluator,
        abilityEvaluator,
        effectInterpreter
      );

      // p1 正常兵士
      state.players.p1.field = [
        {
          unitId: "u-p1-1",
          componentId: "character.soldier",
          cards: [{ id: "c-duplicate", suit: "S", rank: "4", value: 4 }],
        },
      ];

      // p2 に同じ c-duplicate カードIDを持つ不正な兵士が存在
      state.players.p2.field = [
        {
          unitId: "u-p2-1",
          componentId: "character.soldier",
          cards: [{ id: "c-duplicate", suit: "H", rank: "5", value: 5 }],
        },
      ];

      const context: CommandContext = {
        playerKey: "p1",
        state,
        components: mockComponents,
        logRecorder,
      };

      // 実行すると Preflight で重複ID例外がスローされること
      expect(() => {
        handler({ componentType: "soldier", maxSize: 10 }, context);
      }).toThrow(/重複するカードIDが検出されました/);

      // All-or-Nothing 保証: p1 のユニットも墓地へ移動せずフィールドに残っていること！
      expect(state.players.p1.field).toHaveLength(1);
      expect(state.players.p1.grave).toHaveLength(0);
      expect(state.players.p2.field).toHaveLength(1);
      expect(state.players.p2.grave).toHaveLength(0);
      expect(state.pendingGraveTopSelections).toHaveLength(0);
    });

    it("3.3: Invalid unit structure (empty cards array) causes Preflight exception -> State is NOT partially mutated", () => {
      const state = createBaseState();
      const handler = moveMatchingUnitsToGraveyardHandler(
        expressionEvaluator,
        abilityEvaluator,
        effectInterpreter
      );

      state.players.p1.field = [
        {
          unitId: "u-p1-1",
          componentId: "character.soldier",
          cards: [{ id: "c-p1-1", suit: "S", rank: "4", value: 4 }],
        },
      ];

      // p2 のユニットに cards が存在しない不正構造
      state.players.p2.field = [
        {
          unitId: "u-p2-invalid",
          componentId: "character.soldier",
          cards: [],
        },
      ];

      const context: CommandContext = {
        playerKey: "p1",
        state,
        components: mockComponents,
        logRecorder,
      };

      expect(() => {
        handler({ componentType: "soldier", maxSize: 10 }, context);
      }).toThrow(/不正なユニット構造です/);

      // p1 も p2 も盤面変更なし
      expect(state.players.p1.field).toHaveLength(1);
      expect(state.players.p1.grave).toHaveLength(0);
      expect(state.players.p2.field).toHaveLength(1);
      expect(state.players.p2.grave).toHaveLength(0);
    });
  });
});
