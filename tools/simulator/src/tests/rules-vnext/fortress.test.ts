import { describe, it, expect, beforeAll } from "vitest";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry";
import { RulePackage } from "../../domain/rules/RulePackage";
import * as path from "path";

describe("Fortress Active Ability Integration Test (New YAML)", () => {
  let rulePackage: RulePackage;
  let registry: CommandRegistry;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
    registry = new CommandRegistry();
  });

  it("should load fortress component correctly", () => {
    const fortressComp = rulePackage.components.find((c) => c.id === "trump.fortress");
    expect(fortressComp).toBeDefined();
    expect(fortressComp?.name).toBe("要塞");
    expect(fortressComp?.type).toBe("trump");
  });

  // テストA: 自分の表切札に要塞があり、自分の場にキャラクターがいる場合、相手の投擲ダメージを受けない。
  it("should prevent throwing damage when fortress is face up and self has character", () => {
    const throwingAction = rulePackage.actions.find((a) => a.id === "action.throwing")!;

    // プレイヤーBが要塞 (trumps) を持ち、場 (field) に兵士がいる
    const state = {
      players: {
        p1: { name: "Player A", hand: [], field: [], grave: [], life: [] },
        p2: {
          name: "Player B",
          hand: [],
          field: [
            {
              unitId: "soldier-1",
              kind: "一般兵",
              componentId: "character.soldier",
              cards: [{ id: "c-heart-6", suit: "H", rank: "6", value: 6 }],
            }
          ],
          grave: [],
          trumps: [
            {
              unitId: "fortress-1",
              kind: "切札",
              componentId: "trump.fortress",
              face: "up",
              cards: [{ id: "c-club-9", suit: "C", rank: "9", value: 9 }],
            }
          ],
          life: [
            { id: "c1", suit: "C", rank: "2", value: 2 },
            { id: "c2", suit: "C", rank: "3", value: 3 },
          ],
        }
      } as Record<string, any>
    };

    const keyCards = [
      { id: "key-spade-5", suit: "S", rank: "5", value: 5 },
      { id: "key-club-2", suit: "C", rank: "2", value: 2 },
    ];

    const context: CommandContext = {
      state,
      playerKey: "p1",
      targetPlayerKey: "p2",
      keyCards,
      actions: rulePackage.actions,
    };

    // アクションを実行
    registry.executeAction(throwingAction, context);

    // 検証：ダメージが要塞に防がれ、p2 のライフは 2 のままであること
    expect(state.players.p2.life.length).toBe(2);
    expect(state.players.p2.grave.length).toBe(0);
  });

  // テストB: 要塞があっても、自分の場にキャラクターがいない場合、投擲ダメージを受ける。
  it("should NOT prevent throwing damage when fortress is face up but self has NO character", () => {
    const throwingAction = rulePackage.actions.find((a) => a.id === "action.throwing")!;

    // プレイヤーB：field は空
    const state = {
      players: {
        p1: { name: "Player A", hand: [], field: [], grave: [], life: [] },
        p2: {
          name: "Player B",
          hand: [],
          field: [], // キャラクター不在
          grave: [],
          trumps: [
            {
              unitId: "fortress-1",
              componentId: "trump.fortress",
              face: "up",
              cards: [{ id: "c-club-9", suit: "C", rank: "9", value: 9 }],
            }
          ],
          life: [
            { id: "c1", suit: "C", rank: "2", value: 2 },
            { id: "c2", suit: "C", rank: "3", value: 3 },
          ],
        }
      } as Record<string, any>
    };

    const keyCards = [
      { id: "key-spade-1", suit: "S", rank: "A", value: 1 },
      { id: "key-club-2", suit: "C", rank: "2", value: 2 },
    ];

    const context: CommandContext = {
      state,
      playerKey: "p1",
      targetPlayerKey: "p2",
      keyCards,
      actions: rulePackage.actions,
    };

    registry.executeAction(throwingAction, context);

    // 検証：防ぎに失敗し、1ダメージを受けること
    expect(state.players.p2.life.length).toBe(1);
    expect(state.players.p2.grave.length).toBe(1);
  });

  // テストC: 要塞が裏向き、または場に存在しない場合、投擲ダメージを受ける。
  it("should NOT prevent throwing damage when fortress is face down or missing", () => {
    const throwingAction = rulePackage.actions.find((a) => a.id === "action.throwing")!;

    // 要塞が裏向き (face: down)
    const stateWithDownFortress = {
      players: {
        p1: { name: "Player A", hand: [], field: [], grave: [], life: [] },
        p2: {
          name: "Player B",
          hand: [],
          field: [
            {
              unitId: "soldier-1",
              componentId: "character.soldier",
              cards: [{ id: "c-heart-6", suit: "H", rank: "6", value: 6 }],
            }
          ],
          grave: [],
          trumps: [
            {
              unitId: "fortress-1",
              componentId: "trump.fortress",
              face: "down", // 裏向き
              cards: [{ id: "c-club-9", suit: "C", rank: "9", value: 9 }],
            }
          ],
          life: [
            { id: "c1", suit: "C", rank: "2", value: 2 },
            { id: "c2", suit: "C", rank: "3", value: 3 },
          ],
        }
      } as Record<string, any>
    };

    const keyCards = [
      { id: "key-spade-1", suit: "S", rank: "A", value: 1 },
      { id: "key-club-2", suit: "C", rank: "2", value: 2 },
    ];

    const contextWithDownFortress: CommandContext = {
      state: stateWithDownFortress,
      playerKey: "p1",
      targetPlayerKey: "p2",
      keyCards,
      actions: rulePackage.actions,
    };

    registry.executeAction(throwingAction, contextWithDownFortress);

    // 裏向き要塞はダメージを防がない
    expect(stateWithDownFortress.players.p2.life.length).toBe(1);
    expect(stateWithDownFortress.players.p2.grave.length).toBe(1);
  });

  // テストD: キーカードに♠を含まないアクションによるダメージは防がない。
  it("should NOT prevent damage when action key cards do NOT contain spade", () => {
    // ♠ を含まないダミーアクションによるダメージ処理をシミュレート
    // 例えば、投擲アクションに似ているがキーカードが spade ではなく heart + club である架空アクション
    const dummyAction = {
      id: "action.dummyDamage",
      name: "ダミーダメージ",
      effect: [
        {
          dealDamage: {
            target: "targetPlayer",
            amount: 2, // 固定2ダメージ
          }
        }
      ]
    };

    const state = {
      players: {
        p1: { name: "Player A", hand: [], field: [], grave: [], life: [] },
        p2: {
          name: "Player B",
          hand: [],
          field: [
            {
              unitId: "soldier-1",
              componentId: "character.soldier",
              cards: [{ id: "c-heart-6", suit: "H", rank: "6", value: 6 }],
            }
          ],
          grave: [],
          trumps: [
            {
              unitId: "fortress-1",
              componentId: "trump.fortress",
              face: "up",
              cards: [{ id: "c-club-9", suit: "C", rank: "9", value: 9 }],
            }
          ],
          life: [
            { id: "c1", suit: "C", rank: "2", value: 2 },
            { id: "c2", suit: "C", rank: "3", value: 3 },
          ],
        }
      } as Record<string, any>
    };

    // キーカードはスペードを含まない (Heart + Club)
    const keyCards = [
      { id: "key-heart-2", suit: "H", rank: "2", value: 2 },
      { id: "key-club-2", suit: "C", rank: "2", value: 2 },
    ];

    const context: CommandContext = {
      state,
      playerKey: "p1",
      targetPlayerKey: "p2",
      keyCards,
      actions: rulePackage.actions,
    };

    registry.executeAction(dummyAction, context);

    // スペードを含まないため要塞は防がず、2ダメージを受ける
    expect(state.players.p2.life.length).toBe(0);
    expect(state.players.p2.grave.length).toBe(2);
  });

  // テストE: 要塞で防がれたダメージでは、life から grave への cardMoved イベントが発生しない。
  it("should NOT trigger cardMoved event when damage is prevented by fortress", () => {
    const throwingAction = rulePackage.actions.find((a) => a.id === "action.throwing")!;

    // 「世代交代」アクションが誘発しないことを、状態を監視して検証する
    // p2 のライフの上から1枚目は Legacy Card (J) で、
    // ダメージを受けたら墓地へ行き、もし cardMoved が発生し、かつ field からなら世代交代が誘発するかもしれない。
    // しかし、そもそも要塞がダメージを防ぐため、カード移動自体が発生しないため、
    // ライフは減らず、墓地も増えず、世代交代も走らない。
    const state = {
      players: {
        p1: { name: "Player A", hand: [], field: [], grave: [], life: [] },
        p2: {
          name: "Player B",
          hand: [],
          field: [
            {
              unitId: "soldier-1",
              componentId: "character.soldier",
              cards: [{ id: "c-heart-6", suit: "H", rank: "6", value: 6 }],
            }
          ],
          grave: [],
          trumps: [
            {
              unitId: "fortress-1",
              componentId: "trump.fortress",
              face: "up",
              cards: [{ id: "c-club-9", suit: "C", rank: "9", value: 9 }],
            }
          ],
          life: [
            { id: "c-heart-J", suit: "H", rank: "J", value: 11 }, // Legacy Card
            { id: "c2", suit: "C", rank: "3", value: 3 },
          ],
        }
      } as Record<string, any>
    };

    const keyCards = [
      { id: "key-spade-5", suit: "S", rank: "5", value: 5 },
      { id: "key-club-2", suit: "C", rank: "2", value: 2 },
    ];

    const context: CommandContext = {
      state,
      playerKey: "p1",
      targetPlayerKey: "p2",
      keyCards,
      actions: rulePackage.actions,
    };

    let eventFired = false;
    // dispatchEventのフックを作成して監視する
    const originalDispatch = registry["effectInterpreter"].dispatchEvent;
    registry["effectInterpreter"].dispatchEvent = (event: any, ctx: any) => {
      if (event.type === "cardMoved") {
        eventFired = true;
      }
      originalDispatch.call(registry["effectInterpreter"], event, ctx);
    };

    // アクションを実行
    registry.executeAction(throwingAction, context);

    // 検証：イベントが一切発火していないこと
    expect(eventFired).toBe(false);
    expect(state.players.p2.life.length).toBe(2);
    expect(state.players.p2.grave.length).toBe(0);

    // クリーンアップ
    registry["effectInterpreter"].dispatchEvent = originalDispatch;
  });
});
