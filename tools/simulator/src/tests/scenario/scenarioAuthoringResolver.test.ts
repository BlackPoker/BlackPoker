import { describe, it, expect } from "vitest";
import { ScenarioAuthoringResolver } from "../../engine/scenario/ScenarioAuthoringResolver";
import { ScenarioAuthoringDraftV1 } from "../../domain/scenario/ScenarioAuthoringTypes";
import { loadRegulationCatalogForBrowser } from "../../engine/regulation/BrowserRegulationLoader";
import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader";
import { ScenarioCompiler } from "../../engine/scenario/ScenarioCompiler";

describe("ScenarioAuthoringResolver Unit Tests (BP-SIM-SCENARIO-1.2-POSITION-AUTHORING)", () => {
  const catalog = loadRegulationCatalogForBrowser();
  const fullRulePackage = loadRulePackageForBrowser();

  // Test A: 同一 draft + seed の決定論的再現性
  it("Test A: 同一の draft と seed から完全に同一の ScenarioDefinitionV1 が生成されること", () => {
    const draft: ScenarioAuthoringDraftV1 = {
      environmentId: "official:standard-pack",
      seed: 42,
      turnPlayer: "p1",
      chancePlayer: "p1",
      turnCount: 1,
      name: "Determinism Test",
      players: {
        p1: {
          hand: {
            count: 5,
            fixedCards: [{ suit: "S", rank: "A" }],
          },
          life: { count: 3 },
          field: [
            {
              componentId: "character.soldier",
              cards: [{ suit: "H", rank: "10" }],
              state: "charge",
              face: "up",
            },
          ],
        },
        p2: {
          hand: { count: 4 },
          life: { count: 5 },
        },
      },
    };

    const res1 = ScenarioAuthoringResolver.resolve(draft, catalog);
    const res2 = ScenarioAuthoringResolver.resolve(draft, catalog);

    expect(res1.success).toBe(true);
    expect(res2.success).toBe(true);
    if (!res1.success || !res2.success) return;

    expect(JSON.stringify(res1.definition)).toBe(JSON.stringify(res2.definition));
  });

  // Test B: 異なる seed で異なる自動補完結果となること
  it("Test B: 異なる seed を指定すると、自動補完されるカードの並び順が異なること", () => {
    const draft1: ScenarioAuthoringDraftV1 = {
      environmentId: "official:standard-pack",
      seed: 42,
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: { hand: { count: 5 } },
        p2: { hand: { count: 5 } },
      },
    };

    const draft2: ScenarioAuthoringDraftV1 = {
      ...draft1,
      seed: 9999,
    };

    const res1 = ScenarioAuthoringResolver.resolve(draft1, catalog);
    const res2 = ScenarioAuthoringResolver.resolve(draft2, catalog);

    expect(res1.success).toBe(true);
    expect(res2.success).toBe(true);
    if (!res1.success || !res2.success) return;

    expect(JSON.stringify(res1.definition.players.p1.hand)).not.toBe(
      JSON.stringify(res2.definition.players.p1.hand)
    );
  });

  // Test C: 手札の目標枚数指定による自動補完
  it("Test C: hand.count > fixedCards.length の場合、不足分が自動補完され指定枚数となること", () => {
    const draft: ScenarioAuthoringDraftV1 = {
      environmentId: "official:standard-pack",
      seed: 123,
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          hand: {
            count: 5,
            fixedCards: [
              { suit: "S", rank: "A" },
              { suit: "H", rank: "K" },
            ],
          },
        },
        p2: {
          hand: { count: 2 },
        },
      },
    };

    const res = ScenarioAuthoringResolver.resolve(draft, catalog);
    expect(res.success).toBe(true);
    if (!res.success) return;

    const p1Hand = res.definition.players.p1.hand!;
    expect(p1Hand).toHaveLength(5);
    expect(p1Hand[0]).toEqual({ suit: "S", rank: "A" });
    expect(p1Hand[1]).toEqual({ suit: "H", rank: "K" });

    // 残り3枚は重複のないユニークカード
    const cardKeys = new Set(p1Hand.map((c) => `${c.suit}-${c.rank}-${c.occurrence ?? 0}`));
    expect(cardKeys.size).toBe(5);
  });

  // Test D: ライフの先頭指定 (fixedTopCards) の順序保持
  it("Test D: life.fixedTopCards で指定されたカードがライフ先頭に配置され、不足分が後ろに補完されること", () => {
    const draft: ScenarioAuthoringDraftV1 = {
      environmentId: "official:standard-pack",
      seed: 777,
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          life: {
            count: 4,
            fixedTopCards: [
              { suit: "D", rank: "Q" },
              { suit: "C", rank: "J" },
            ],
          },
        },
        p2: {},
      },
    };

    const res = ScenarioAuthoringResolver.resolve(draft, catalog);
    expect(res.success).toBe(true);
    if (!res.success) return;

    const p1Life = res.definition.players.p1.life!;
    expect(p1Life.count).toBe(4);
    expect(p1Life.cards).toHaveLength(4);
    expect(p1Life.cards![0]).toEqual({ suit: "D", rank: "Q" });
    expect(p1Life.cards![1]).toEqual({ suit: "C", rank: "J" });
  });

  // Test E: ライフ枚数指定時の残余カードの墓地割り当て (明示墓地カードの手前に補完)
  it("Test E: life.count 指定時、手札・場・パック・ライフ以外の残余カードが墓地に割り当てられ、明示墓地カードの順序(TOP)が保持されること", () => {
    const draft: ScenarioAuthoringDraftV1 = {
      environmentId: "official:standard-pack",
      seed: 100,
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          hand: { count: 3, fixedCards: [{ suit: "S", rank: "A" }] },
          field: [
            {
              componentId: "character.bulwark",
              cards: [{ suit: "S", rank: "2" }],
              state: "charge",
              face: "down",
            },
          ],
          life: { count: 2 },
          grave: {
            explicitCards: [{ suit: "H", rank: "2" }], // 明示指定墓地カード (TOPになるべき)
          },
        },
        p2: {},
      },
    };

    const res = ScenarioAuthoringResolver.resolve(draft, catalog);
    expect(res.success).toBe(true);
    if (!res.success) return;

    // standard-pack は54枚。
    // P1: field=1, hand=3, pack=14 (デフォルト), life=2, explicitGrave=1.
    // 合計指定 = 1 + 3 + 14 + 2 + 1 = 21枚。
    // 残余カード = 54 - 21 = 33枚。
    // 墓地全体 = 33枚 (自動) + 1枚 (明示) = 34枚。
    const p1Grave = res.definition.players.p1.grave!;
    expect(p1Grave).toHaveLength(34);

    // 配列の末尾（墓地TOP）が明示指定した H2 であること
    const graveTop = p1Grave[p1Grave.length - 1];
    expect(graveTop).toEqual({ suit: "H", rank: "2" });
  });

  // Test F: ライフ枚数未指定時の残余カードのライフ割り当て
  it("Test F: life.count 未指定時、残余カードのすべてがライフへ割り当てられ、墓地には明示カードのみ残ること", () => {
    const draft: ScenarioAuthoringDraftV1 = {
      environmentId: "official:standard-pack",
      seed: 100,
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          hand: { count: 5 },
          field: [
            {
              componentId: "character.soldier",
              cards: [{ suit: "S", rank: "3" }],
              state: "charge",
              face: "up",
            },
          ],
          grave: {
            explicitCards: [{ suit: "H", rank: "5" }],
          },
          // life.count は未指定
        },
        p2: {},
      },
    };

    const res = ScenarioAuthoringResolver.resolve(draft, catalog);
    expect(res.success).toBe(true);
    if (!res.success) return;

    // P1: field=1, hand=5, pack=14, grave=1. 合計 21枚。
    // ライフ未指定のため、残余 54 - 21 = 33枚がすべてライフへ。
    const p1Life = res.definition.players.p1.life!;
    expect(p1Life.count).toBe(33);
    expect(p1Life.cards).toHaveLength(33);

    // 墓地は明示カード1枚のみ
    const p1Grave = res.definition.players.p1.grave!;
    expect(p1Grave).toHaveLength(1);
    expect(p1Grave[0]).toEqual({ suit: "H", rank: "5" });
  });

  // Test G: パック規定枚数の自動補完と非パック環境での排他
  it("Test G: standard-pack では pack.count 未指定時にフレーム規定の14枚が自動補完されること", () => {
    const draft: ScenarioAuthoringDraftV1 = {
      environmentId: "official:standard-pack",
      seed: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {},
        p2: {},
      },
    };

    const res = ScenarioAuthoringResolver.resolve(draft, catalog);
    expect(res.success).toBe(true);
    if (!res.success) return;

    expect(res.definition.players.p1.pack?.count).toBe(14);
    expect(res.definition.players.p1.pack?.cards).toHaveLength(14);
  });

  it("Test G2: パックが存在しないレギュレーション (light-entry16) で pack を指定するとエラーになること", () => {
    const draft: ScenarioAuthoringDraftV1 = {
      environmentId: "official:light-entry16",
      seed: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          pack: { count: 5 },
        },
        p2: {},
      },
    };

    const res = ScenarioAuthoringResolver.resolve(draft, catalog);
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.errors.some((e) => e.code === "INVALID_ZONE_CONFIG" && e.path.includes("pack"))).toBe(true);
  });

  // Test H: Jokerの多重コピー occurrence 自動導出
  it("Test H: Jokerをoccurrence省略で複数指定した場合、0, 1 と自動導出され、上限超過でDUPLICATE_CARDとなること", () => {
    // 2枚のJokerを別領域に指定 (occurrence省略)
    const validDraft: ScenarioAuthoringDraftV1 = {
      environmentId: "official:standard-pack",
      seed: 50,
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          hand: {
            fixedCards: [
              { suit: "J", rank: "Joker" }, // 自動で occurrence: 0
              { suit: "J", rank: "Joker" }, // 自動で occurrence: 1
            ],
          },
        },
        p2: {},
      },
    };

    const resValid = ScenarioAuthoringResolver.resolve(validDraft, catalog);
    expect(resValid.success).toBe(true);
    if (!resValid.success) return;

    const hand = resValid.definition.players.p1.hand!;
    expect(hand[0]).toEqual({ suit: "J", rank: "Joker", occurrence: 0 });
    expect(hand[1]).toEqual({ suit: "J", rank: "Joker", occurrence: 1 });

    // 3枚目を指定した場合はデッキ内2枚を超えるためエラー
    const invalidDraft: ScenarioAuthoringDraftV1 = {
      environmentId: "official:standard-pack",
      seed: 50,
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          hand: {
            fixedCards: [
              { suit: "J", rank: "Joker" },
              { suit: "J", rank: "Joker" },
              { suit: "J", rank: "Joker" },
            ],
          },
        },
        p2: {},
      },
    };

    const resInvalid = ScenarioAuthoringResolver.resolve(invalidDraft, catalog);
    expect(resInvalid.success).toBe(false);
    if (resInvalid.success) return;
    expect(resInvalid.errors.some((e) => e.code === "DUPLICATE_CARD")).toBe(true);
  });

  // Test I: カード枚数保存則の充足および ScenarioCompiler との整合性
  it("Test I: 解決された ScenarioDefinitionV1 はカード保存則を厳密に満たし、ScenarioCompiler で READY となること", () => {
    const draft: ScenarioAuthoringDraftV1 = {
      environmentId: "official:standard-pack",
      seed: 888,
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          hand: { count: 6 },
          life: { count: 3 },
          field: [
            {
              componentId: "character.bulwark",
              cards: [{ suit: "S", rank: "4" }],
              state: "charge",
              face: "down",
            },
          ],
        },
        p2: {
          hand: { count: 4 },
          life: { count: 4 },
        },
      },
    };

    const res = ScenarioAuthoringResolver.resolve(draft, catalog);
    expect(res.success).toBe(true);
    if (!res.success) return;

    const compileOutcome = ScenarioCompiler.compile(res.definition, catalog, fullRulePackage);
    expect(compileOutcome.type).toBe("READY");
    if (compileOutcome.type !== "READY") return;

    expect(compileOutcome.session).toBeDefined();
  });

  // Test J: count < fixedCards.length によるバリデーションエラー
  it("Test J: count が指定された固定カード枚数未満の場合に INVALID_ZONE_CONFIG エラーとなること", () => {
    // 手札エラー
    const handErrorDraft: ScenarioAuthoringDraftV1 = {
      environmentId: "official:standard-pack",
      seed: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          hand: {
            count: 1,
            fixedCards: [
              { suit: "S", rank: "A" },
              { suit: "S", rank: "2" },
            ],
          },
        },
        p2: {},
      },
    };
    const resHand = ScenarioAuthoringResolver.resolve(handErrorDraft, catalog);
    expect(resHand.success).toBe(false);
    if (!resHand.success) {
      expect(resHand.errors.some((e) => e.code === "INVALID_ZONE_CONFIG" && e.path.includes("hand"))).toBe(true);
    }

    // ライフエラー
    const lifeErrorDraft: ScenarioAuthoringDraftV1 = {
      environmentId: "official:standard-pack",
      seed: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          life: {
            count: 1,
            fixedTopCards: [
              { suit: "H", rank: "A" },
              { suit: "H", rank: "2" },
            ],
          },
        },
        p2: {},
      },
    };
    const resLife = ScenarioAuthoringResolver.resolve(lifeErrorDraft, catalog);
    expect(resLife.success).toBe(false);
    if (!resLife.success) {
      expect(resLife.errors.some((e) => e.code === "INVALID_ZONE_CONFIG" && e.path.includes("life"))).toBe(true);
    }

    // パックエラー
    const packErrorDraft: ScenarioAuthoringDraftV1 = {
      environmentId: "official:standard-pack",
      seed: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          pack: {
            count: 1,
            fixedCards: [
              { suit: "D", rank: "A" },
              { suit: "D", rank: "2" },
            ],
          },
        },
        p2: {},
      },
    };
    const resPack = ScenarioAuthoringResolver.resolve(packErrorDraft, catalog);
    expect(resPack.success).toBe(false);
    if (!resPack.success) {
      expect(resPack.errors.some((e) => e.code === "INVALID_ZONE_CONFIG" && e.path.includes("pack"))).toBe(true);
    }
  });
});
