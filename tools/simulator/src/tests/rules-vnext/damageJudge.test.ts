import { describe, it, expect, beforeAll } from "vitest";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry";
import { TurnManager } from "../../engine/rules/TurnManager";
import { RulePackage } from "../../domain/rules/RulePackage";
import { ValidationError } from "../../engine/rules/ActionRequestValidator";
import * as path from "path";

describe("Damage Judge Action Integration Tests (New YAML)", () => {
  let rulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  it("should allow attacker to win when attacker size > blocker size (A)", () => {
    const damageJudgeAction = rulePackage.actions.find((a) => a.id === "action.damageJudge")!;
    expect(damageJudgeAction).toBeDefined();

    const soldier: any = {
      unitId: "soldier-1",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c1", suit: "S", rank: "6", value: 6 }], // Size 6
      labels: ["攻撃", "防御"],
      battle: {
        role: "attacker",
        targetPlayerKey: "p2",
      }
    };

    const bulwark: any = {
      unitId: "bulwark-1",
      kind: "防壁",
      componentId: "character.bulwark",
      state: "drive",
      cards: [{ id: "c2", suit: "H", rank: "5", value: 5 }], // Size 5
      labels: ["防御"],
      battle: {
        role: "blocker",
        blocksUnitId: "soldier-1",
      }
    };

    const state: any = {
      players: {
        p1: {
          name: "Player A",
          life: [],
          hand: [],
          field: [soldier],
          grave: [],
          fog: [],
        },
        p2: {
          name: "Player B",
          life: [],
          hand: [],
          field: [bulwark],
          grave: [],
          fog: [],
        }
      },
      stage: { requests: [] }
    };

    const registry = new CommandRegistry();
    TurnManager.initializeToMain(state, "p1"); // p1の手番・チャンス

    const context: CommandContext = {
      state,
      playerKey: "p1", // 手番プレイヤーが実行
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // リクエスト作成と解決
    const req = registry.createRequest(damageJudgeAction, context);
    expect(state.stage.requests.length).toBe(1);

    registry.resolveTopRequest(context);
    expect(req.status).toBe("resolved");

    // 検証：
    // - アタッカー（soldier）は生存していること
    // - アタッカーの battle 情報がクリアされていること
    expect(state.players.p1.field.length).toBe(1);
    expect(state.players.p1.field[0].unitId).toBe("soldier-1");
    expect(state.players.p1.field[0].battle).toBeUndefined();

    // - ブロッカー（bulwark）は墓地に移動していること
    expect(state.players.p2.field.length).toBe(0);
    expect(state.players.p2.grave.length).toBe(1);
    expect(state.players.p2.grave[0].unitId).toBe("bulwark-1");
    // - 墓地に行ったユニットの battle 情報も完全に削除されていること
    expect(state.players.p2.grave[0].battle).toBeUndefined();
  });

  it("should allow blocker to win when attacker size < blocker size (B)", () => {
    const damageJudgeAction = rulePackage.actions.find((a) => a.id === "action.damageJudge")!;

    const soldier: any = {
      unitId: "soldier-1",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c1", suit: "S", rank: "4", value: 4 }], // Size 4
      labels: ["攻撃", "防御"],
      battle: {
        role: "attacker",
        targetPlayerKey: "p2",
      }
    };

    const bulwark: any = {
      unitId: "bulwark-1",
      kind: "防壁",
      componentId: "character.bulwark",
      state: "drive",
      cards: [{ id: "c2", suit: "H", rank: "5", value: 5 }], // Size 5
      labels: ["防御"],
      battle: {
        role: "blocker",
        blocksUnitId: "soldier-1",
      }
    };

    const state: any = {
      players: {
        p1: {
          name: "Player A",
          life: [],
          hand: [],
          field: [soldier],
          grave: [],
          fog: [],
        },
        p2: {
          name: "Player B",
          life: [],
          hand: [],
          field: [bulwark],
          grave: [],
          fog: [],
        }
      },
      stage: { requests: [] }
    };

    const registry = new CommandRegistry();
    TurnManager.initializeToMain(state, "p1");

    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    registry.executeAction(damageJudgeAction, context);

    // 検証：
    // - アタッカー（soldier）が墓地へ移動していること、battle情報クリア
    expect(state.players.p1.field.length).toBe(0);
    expect(state.players.p1.grave.length).toBe(1);
    expect(state.players.p1.grave[0].unitId).toBe("soldier-1");
    expect(state.players.p1.grave[0].battle).toBeUndefined();

    // - ブロッカー（bulwark）が生存していること、battle情報クリア
    expect(state.players.p2.field.length).toBe(1);
    expect(state.players.p2.field[0].unitId).toBe("bulwark-1");
    expect(state.players.p2.field[0].battle).toBeUndefined();
  });

  it("should make a draw and put both to grave when sizes are equal (C)", () => {
    const damageJudgeAction = rulePackage.actions.find((a) => a.id === "action.damageJudge")!;

    const soldier: any = {
      unitId: "soldier-1",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c1", suit: "S", rank: "5", value: 5 }], // Size 5
      labels: ["攻撃", "防御"],
      battle: {
        role: "attacker",
        targetPlayerKey: "p2",
      }
    };

    const bulwark: any = {
      unitId: "bulwark-1",
      kind: "防壁",
      componentId: "character.bulwark",
      state: "drive",
      cards: [{ id: "c2", suit: "H", rank: "5", value: 5 }], // Size 5
      labels: ["防御"],
      battle: {
        role: "blocker",
        blocksUnitId: "soldier-1",
      }
    };

    const state: any = {
      players: {
        p1: {
          name: "Player A",
          life: [],
          hand: [],
          field: [soldier],
          grave: [],
          fog: [],
        },
        p2: {
          name: "Player B",
          life: [],
          hand: [],
          field: [bulwark],
          grave: [],
          fog: [],
        }
      },
      stage: { requests: [] }
    };

    // 墓地移動順が attacker -> blocker であることをイベントリスナーなどで検証するための追跡用配列
    const moveEvents: string[] = [];
    const registry = new CommandRegistry();
    
    // イベントフックをセットアップ
    const originalDispatchEvent = registry["effectInterpreter"].dispatchEvent;
    registry["effectInterpreter"].dispatchEvent = function (event: any, ctx: any) {
      if (event.type === "cardMoved") {
        moveEvents.push(event.payload.card.id);
      }
      originalDispatchEvent.call(this, event, ctx);
    };

    TurnManager.initializeToMain(state, "p1");

    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    registry.executeAction(damageJudgeAction, context);

    // 検証：双方とも墓地へ
    expect(state.players.p1.field.length).toBe(0);
    expect(state.players.p1.grave.length).toBe(1);
    expect(state.players.p1.grave[0].battle).toBeUndefined();

    expect(state.players.p2.field.length).toBe(0);
    expect(state.players.p2.grave.length).toBe(1);
    expect(state.players.p2.grave[0].battle).toBeUndefined();

    // 順序の検証: アタッカー(c1) -> ブロッカー(c2)
    expect(moveEvents).toEqual(["c1", "c2"]);
  });

  it("should apply fog modification in size comparison (D)", () => {
    const damageJudgeAction = rulePackage.actions.find((a) => a.id === "action.damageJudge")!;

    const soldier: any = {
      unitId: "soldier-1",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c1", suit: "S", rank: "6", value: 6 }], // Base 6
      labels: ["攻撃", "防御"],
      battle: {
        role: "attacker",
        targetPlayerKey: "p2",
      }
    };

    const bulwark: any = {
      unitId: "bulwark-1",
      kind: "防壁",
      componentId: "character.bulwark",
      state: "drive",
      cards: [{ id: "c2", suit: "H", rank: "5", value: 5 }], // Base 5
      labels: ["防御"],
      battle: {
        role: "blocker",
        blocksUnitId: "soldier-1",
      }
    };

    // p1のアタッカー（soldier-1）に対して、サイズを -2 するダウンフォグを付与
    // これにより 6 - 2 = 4 となり、bulwark-1 (5) に敗北するはず
    const state: any = {
      players: {
        p1: {
          name: "Player A",
          life: [],
          hand: [],
          field: [soldier],
          grave: [],
          fog: [
            {
              fogId: "fog-down-1",
              componentId: "fog.down",
              card: { id: "c-fog", suit: "S", rank: "2", value: 2 },
              bindings: { target: "soldier-1", amount: -2 }
            }
          ],
        },
        p2: {
          name: "Player B",
          life: [],
          hand: [],
          field: [bulwark],
          grave: [],
          fog: [],
        }
      },
      stage: { requests: [] }
    };

    const registry = new CommandRegistry();
    TurnManager.initializeToMain(state, "p1");

    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    registry.executeAction(damageJudgeAction, context);

    // 検証：アタッカーがサイズ4に下がったため、アタッカーが墓地、ブロッカーが生存
    expect(state.players.p1.field.length).toBe(0);
    expect(state.players.p1.grave.length).toBe(1); // アタッカーが墓地
    expect(state.players.p2.field.length).toBe(1); // ブロッカー生存
  });

  it("should trigger legacy generation from field to grave (E)", () => {
    const damageJudgeAction = rulePackage.actions.find((a) => a.id === "action.damageJudge")!;

    // field -> grave の Legacy Card (J) による世代交代の検証
    const soldier: any = {
      unitId: "soldier-legacy-J",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-J", suit: "S", rank: "J", value: 11 }], // J (Legacy Card)
      labels: ["攻撃", "防御"],
      battle: {
        role: "attacker",
        targetPlayerKey: "p2",
      }
    };

    const bulwark: any = {
      unitId: "bulwark-1",
      kind: "防壁",
      componentId: "character.bulwark",
      state: "drive",
      cards: [{ id: "c2", suit: "H", rank: "K", value: 13 }], // K (13) でアタッカーに勝つ
      labels: ["防御"],
      battle: {
        role: "blocker",
        blocksUnitId: "soldier-legacy-J",
      }
    };

    const state: any = {
      players: {
        p1: {
          name: "Player A",
          life: [
            { id: "life-2", suit: "H", rank: "2", value: 2 },
            { id: "life-7", suit: "D", rank: "7", value: 7 },
            { id: "life-K", suit: "S", rank: "K", value: 13 }, // 世代交代で手札に入るカード
          ],
          hand: [],
          field: [soldier],
          grave: [],
          fog: [],
        },
        p2: {
          name: "Player B",
          life: [],
          hand: [],
          field: [bulwark],
          grave: [],
          fog: [],
        }
      },
      stage: { requests: [] }
    };

    const registry = new CommandRegistry();
    TurnManager.initializeToMain(state, "p1");

    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    registry.executeAction(damageJudgeAction, context);

    // 検証：
    // - アタッカー（J）が墓地へ
    // - 世代交代が走るため、ライフの [2, 7] が墓地へ、[K] が手札へ行く
    expect(state.players.p1.field.length).toBe(0);
    expect(state.players.p1.hand.length).toBe(1);
    expect(state.players.p1.hand[0].rank).toBe("K");
  });

  it("should fail when multiple attackers or blockers are present (F)", () => {
    const damageJudgeAction = rulePackage.actions.find((a) => a.id === "action.damageJudge")!;

    const soldier1: any = {
      unitId: "soldier-1",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c1", suit: "S", rank: "6", value: 6 }],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" }
    };

    const soldier2: any = {
      unitId: "soldier-2",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c2", suit: "S", rank: "5", value: 5 }],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" } // 2体目のアタッカー！
    };

    const bulwark: any = {
      unitId: "bulwark-1",
      kind: "防壁",
      componentId: "character.bulwark",
      state: "drive",
      cards: [{ id: "c3", suit: "H", rank: "5", value: 5 }],
      labels: ["防御"],
      battle: { role: "blocker", blocksUnitId: "soldier-1" }
    };

    const state: any = {
      players: {
        p1: { name: "Player A", field: [soldier1, soldier2] },
        p2: { name: "Player B", field: [bulwark] }
      },
      stage: { requests: [] }
    };

    const registry = new CommandRegistry();
    TurnManager.initializeToMain(state, "p1");

    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // 複数アタッカーのため ValidationError
    expect(() => registry.createRequest(damageJudgeAction, context)).toThrow(ValidationError);
  });
});
