import { describe, it, expect, beforeAll } from "vitest";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry";
import { TurnManager } from "../../engine/rules/TurnManager";
import { RulePackage, RequestBuffer } from "../../domain/rules/RulePackage";
import * as path from "path";

describe("Trigger Resolver and Request Buffer Integration Tests (Phase 14.4)", () => {
  let rulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  it("should trigger nextGeneration when a legacy card goes field -> grave and put it in requestBuffer without double execution (A)", () => {
    const state = {
      players: {
        p1: {
          name: "Player A",
          life: [
            { id: "life-2", suit: "H", rank: "2", value: 2 },
            { id: "life-7", suit: "D", rank: "7", value: 7 },
            { id: "life-K", suit: "S", rank: "K", value: 13 },
            { id: "life-Joker", suit: "Joker", rank: "Joker", value: 20 },
          ],
          hand: [],
          field: [
            {
              unitId: "soldier-legacy-J",
              kind: "一般兵",
              componentId: "character.soldier",
              state: "charge",
              cards: [{ id: "c-J", suit: "S", rank: "J", value: 11 }], // Legacy Card
              labels: ["攻撃", "防御"],
            }
          ],
          fog: [],
          grave: [],
        }
      },
      stage: { requests: [] }
    } as Record<string, any>;

    const registry = new CommandRegistry();
    const targetUnit = state.players.p1.field[0];

    const context: CommandContext = {
      state,
      playerKey: "p1",
      targetComponent: targetUnit,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // 初期状態では requestBuffer は未定義
    expect(state.requestBuffer).toBeUndefined();

    // 既存の即時解決（J を墓地に送ることで 1回 世代交代が走る）を呼び出す
    registry.execute("moveToGraveyard", { target: "target" }, context);

    // 検証：
    // 1. requestBuffer が初期化され、蓄積が正常に行われていること
    expect(state.requestBuffer).toBeDefined();
    const requestBuffer = state.requestBuffer as RequestBuffer;
    expect(requestBuffer.requests.length).toBe(1);
    expect(requestBuffer.requests[0].actionId).toBe("action.nextGeneration");
    expect(requestBuffer.history.length).toBe(1);
    expect(requestBuffer.history[0].actionId).toBe("action.nextGeneration");
    expect(requestBuffer.history[0].status).toBe("triggered");

    // 2. 二重解決防止の検証：
    // 既存の即時解決のみが動作し、バッファ蓄積リクエストは自動消費されないため、手札に入る Legacy Card は [K] の 1枚のみ
    expect(state.players.p1.hand.length).toBe(1);
    expect(state.players.p1.hand[0].rank).toBe("K");
    // ライフには [Joker] が残り、めくりが二重に実行されてライフが空になっていないことをアサート
    expect(state.players.p1.life.length).toBe(1);
    expect(state.players.p1.life[0].rank).toBe("Joker");
  });

  it("should NOT trigger nextGeneration when card goes fog -> grave (B)", () => {
    const state = {
      players: {
        p1: {
          name: "Player A",
          life: [],
          hand: [],
          field: [],
          grave: [],
          fog: [],
        }
      },
      stage: { requests: [] }
    } as Record<string, any>;

    const registry = new CommandRegistry();
    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // fog -> grave イベントを発生させる
    const event = {
      type: "cardMoved",
      payload: {
        card: { id: "c-J", suit: "S", rank: "J", value: 11 },
        fromZone: "fog",
        toZone: "grave",
        playerKey: "p1"
      }
    };
    registry.dispatchEvent(event, context);

    // 検証：誘発しないためバッファは空
    const requestBuffer = state.requestBuffer as RequestBuffer | undefined;
    expect(requestBuffer?.requests.length || 0).toBe(0);
  });

  it("should trigger action.block when action.attack resolves with 1+ attacker (C)", () => {
    const soldier: any = {
      unitId: "soldier-1",
      kind: "一般兵",
      state: "drive",
      cards: [{ id: "c1", suit: "S", rank: "6", value: 6 }],
      battle: { role: "attacker", targetPlayerKey: "p2" }
    };

    const state = {
      players: {
        p1: { name: "Player A", field: [soldier] },
        p2: { name: "Player B", field: [] }
      },
      stage: { requests: [] }
    } as Record<string, any>;

    const registry = new CommandRegistry();
    TurnManager.initializeToMain(state, "p1");

    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // actionResolved event (attack)
    const event = {
      type: "actionResolved",
      payload: {
        actionId: "action.attack",
        playerKey: "p1"
      }
    };
    registry.dispatchEvent(event, context);

    // 検証：action.block がリクエストバッファに積まれていること
    // コントローラーが p2 (相手プレイヤー＝防御側) に自動バインドされていること
    const requestBuffer = state.requestBuffer as RequestBuffer;
    expect(requestBuffer.requests.length).toBe(1);
    expect(requestBuffer.requests[0].actionId).toBe("action.block");
    expect(requestBuffer.requests[0].controller).toBe("p2");
  });

  it("should NOT trigger action.block when action.attack resolves but no attacker is present (D)", () => {
    const state = {
      players: {
        p1: { name: "Player A", field: [] },
        p2: { name: "Player B", field: [] }
      },
      stage: { requests: [] }
    } as Record<string, any>;

    const registry = new CommandRegistry();
    TurnManager.initializeToMain(state, "p1");

    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    const event = {
      type: "actionResolved",
      payload: {
        actionId: "action.attack",
        playerKey: "p1"
      }
    };
    registry.dispatchEvent(event, context);

    // 検証：アタッカー不在のため、ブロックは誘発しない
    const requestBuffer = state.requestBuffer as RequestBuffer | undefined;
    expect(requestBuffer?.requests.length || 0).toBe(0);
  });

  it("should trigger action.damageJudge when action.block resolves with attacker-blocker relationship (E)", () => {
    const soldier: any = {
      unitId: "soldier-1",
      kind: "一般兵",
      state: "drive",
      cards: [{ id: "c1", suit: "S", rank: "6", value: 6 }],
      battle: { role: "attacker", targetPlayerKey: "p2" }
    };

    const bulwark: any = {
      unitId: "bulwark-1",
      kind: "防壁",
      state: "drive",
      cards: [{ id: "c2", suit: "H", rank: "5", value: 5 }],
      battle: { role: "blocker", blocksUnitId: "soldier-1" }
    };

    const state = {
      players: {
        p1: { name: "Player A", field: [soldier] },
        p2: { name: "Player B", field: [bulwark] }
      },
      stage: { requests: [] }
    } as Record<string, any>;

    const registry = new CommandRegistry();
    TurnManager.initializeToMain(state, "p1");

    const context: CommandContext = {
      state,
      playerKey: "p2",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    const event = {
      type: "actionResolved",
      payload: {
        actionId: "action.block",
        playerKey: "p2"
      }
    };
    registry.dispatchEvent(event, context);

    // 検証：action.damageJudge がリクエストバッファに積まれていること
    // コントローラーがターンプレイヤー (p1) に自動バインドされていること
    const requestBuffer = state.requestBuffer as RequestBuffer;
    expect(requestBuffer.requests.length).toBe(1);
    expect(requestBuffer.requests[0].actionId).toBe("action.damageJudge");
    expect(requestBuffer.requests[0].controller).toBe("p1");
  });

  it("should enforce 6-D-9 rule to discard later triggered main actions and keep in history within the same resolveTriggers call (F, G, H)", () => {
    const state = {
      players: {
        p1: {
          name: "Player A",
          life: [],
          hand: [],
          field: [
            {
              unitId: "soldier-1",
              kind: "一般兵",
              state: "drive",
              battle: { role: "attacker", targetPlayerKey: "p2" }
            }
          ],
          grave: [],
          fog: [],
        },
        p2: {
          name: "Player B",
          field: []
        }
      },
      stage: { requests: [] }
    } as Record<string, any>;

    const registry = new CommandRegistry();
    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // 同時に 2 つのメイン系アクションが同一評価内で誘発する状況を模倣
    const mockActions = [
      {
        id: "action.block",
        name: "ブロック",
        request: { timing: "block" },
        triggerCondition: { event: "mockEvent" }
      },
      {
        id: "action.damageJudge",
        name: "ダメージ判定",
        request: { timing: "damageJudge" },
        triggerCondition: { event: "mockEvent" }
      }
    ];

    const mockContext: CommandContext = {
      ...context,
      actions: mockActions as any
    };

    const event = {
      type: "mockEvent",
      payload: {}
    };

    registry.dispatchEvent(event, mockContext);

    // 検証：
    const requestBuffer = state.requestBuffer as RequestBuffer;
    // F. 最初の1件だけがバッファに積まれる
    expect(requestBuffer.requests.length).toBe(1);
    expect(requestBuffer.requests[0].actionId).toBe("action.block");

    // G. 後続のメインアクションは 6-D-9 で破棄され discarded として history に残る
    expect(requestBuffer.history.length).toBe(2);
    expect(requestBuffer.history[0].actionId).toBe("action.block");
    expect(requestBuffer.history[0].status).toBe("triggered");

    expect(requestBuffer.history[1].actionId).toBe("action.damageJudge");
    expect(requestBuffer.history[1].status).toBe("discarded");

    // H. 破棄理由が確認できる
    expect(requestBuffer.history[1].reason).toContain("6-D-9");
  });

  it("should NOT trigger action.block when action.attack is cancelled (I)", () => {
    const soldier: any = {
      unitId: "soldier-1",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "c1", suit: "S", rank: "6", value: 6 }],
      labels: ["攻撃", "防御"],
    };

    const state = {
      players: {
        p1: { name: "Player A", field: [soldier], hand: [], grave: [], life: [] },
        p2: { name: "Player B", field: [], hand: [], grave: [], life: [] }
      },
      stage: { requests: [] }
    } as Record<string, any>;

    const registry = new CommandRegistry();
    TurnManager.initializeToMain(state, "p1");

    const attackAction = rulePackage.actions.find((a) => a.id === "action.attack")!;
    const context: CommandContext = {
      state,
      playerKey: "p1",
      targetComponent: soldier,
      targetPlayerKey: "p2",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // アタックリクエストを作成
    const req = registry.createRequest(attackAction, context);
    expect(state.stage.requests.length).toBe(1);

    // アタックリクエストをキャンセル状態にする
    req.status = "cancelled";

    // 解決 (キャンセルされているため解決されない)
    registry.resolveTopRequest(context);
    expect(req.status).toBe("cancelled");

    // 検証：キャンセルされたため解決イベントが発行されず、block も誘発バッファに積まれない
    const requestBuffer = state.requestBuffer as RequestBuffer | undefined;
    expect(requestBuffer?.requests.length || 0).toBe(0);
  });

  it("should NOT trigger action.damageJudge when action.block is cancelled (J)", () => {
    const soldier: any = {
      unitId: "soldier-1",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c1", suit: "S", rank: "6", value: 6 }],
      battle: { role: "attacker", targetPlayerKey: "p2" }
    };

    const bulwark: any = {
      unitId: "bulwark-1",
      kind: "防壁",
      componentId: "character.bulwark",
      state: "charge",
      cards: [{ id: "c2", suit: "H", rank: "5", value: 5 }],
      labels: ["防御"],
    };

    const state = {
      players: {
        p1: { name: "Player A", field: [soldier], hand: [], grave: [], life: [] },
        p2: { name: "Player B", field: [bulwark], hand: [], grave: [], life: [] }
      },
      stage: { requests: [] }
    } as Record<string, any>;

    const registry = new CommandRegistry();
    TurnManager.initializeToMain(state, "p1");
    TurnManager.passChance(state); // チャンスを p2 へ

    const blockAction = rulePackage.actions.find((a) => a.id === "action.block")!;
    const context: CommandContext = {
      state,
      playerKey: "p2",
      targetComponent: bulwark,
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // ブロックリクエストを作成
    const req = registry.createRequest(blockAction, context);
    expect(state.stage.requests.length).toBe(1);

    // ブロックリクエストをキャンセル状態にする
    req.status = "cancelled";

    // 解決
    registry.resolveTopRequest(context);
    expect(req.status).toBe("cancelled");

    // 検証：キャンセルされたため解決イベントが発行されず、damageJudge も誘発バッファに積まれない
    const requestBuffer = state.requestBuffer as RequestBuffer | undefined;
    expect(requestBuffer?.requests.length || 0).toBe(0);
  });
});
