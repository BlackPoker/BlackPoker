import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage, TriggeredActionRequest } from "../../domain/rules/RulePackage";
import { GameSession } from "../../engine/session/GameSession";
import { TurnManager } from "../../engine/rules/TurnManager";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry";
import { TriggerProcessingCoordinator } from "../../engine/rules/TriggerProcessingCoordinator";
import { LegalPatternGenerator } from "../../engine/decision/LegalPatternGenerator";

describe("Triggered Request Buffer & Core Flow Integration Tests", () => {
  let rulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  const createBattleState = () => {
    const soldier1 = {
      unitId: "soldier-1",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "c1", suit: "S", rank: "6", value: 6 }],
      labels: ["攻撃", "防御"],
    };

    const bulwark1 = {
      unitId: "bulwark-1",
      kind: "防壁",
      componentId: "character.bulwark",
      state: "charge",
      cards: [{ id: "b1", suit: "H", rank: "5", value: 5 }],
      labels: ["防御"],
    };

    const state = {
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          name: "Player A",
          life: 16,
          hand: [
            { id: "key-h7", suit: "H", rank: "7", value: 7 },
            { id: "cost-c2", suit: "C", rank: "2", value: 2 },
          ],
          field: [soldier1],
          fog: [],
          grave: [],
        },
        p2: {
          name: "Player B",
          life: 16,
          hand: [
            { id: "p2-key-s8", suit: "S", rank: "8", value: 8 },
            { id: "p2-cost-c3", suit: "C", rank: "3", value: 3 },
          ],
          field: [bulwark1],
          fog: [],
          grave: [],
        },
      },
      stage: { requests: [], history: [] },
      requestBuffer: { requests: [], history: [] },
    } as Record<string, any>;

    TurnManager.initializeToMain(state, "p1");
    return state;
  };

  it("A & B: should NOT include block or damageJudge in direct Decision patterns", () => {
    const state = createBattleState();
    const { request: p1Req } = LegalPatternGenerator.generateActionRequestDecision(state, "p1", rulePackage);
    const { request: p2Req } = LegalPatternGenerator.generateActionRequestDecision(state, "p2", rulePackage);

    const hasBlockP1 = p1Req.patterns.some((p) => {
      if (p.actionSelectionRef === undefined) return false;
      return p1Req.catalog.actions[p.actionSelectionRef]?.actionId === "action.block";
    });
    const hasDamageJudgeP1 = p1Req.patterns.some((p) => {
      if (p.actionSelectionRef === undefined) return false;
      return p1Req.catalog.actions[p.actionSelectionRef]?.actionId === "action.damageJudge";
    });

    const hasBlockP2 = p2Req.patterns.some((p) => {
      if (p.actionSelectionRef === undefined) return false;
      return p2Req.catalog.actions[p.actionSelectionRef]?.actionId === "action.block";
    });
    const hasDamageJudgeP2 = p2Req.patterns.some((p) => {
      if (p.actionSelectionRef === undefined) return false;
      return p2Req.catalog.actions[p.actionSelectionRef]?.actionId === "action.damageJudge";
    });

    expect(hasBlockP1).toBe(false);
    expect(hasDamageJudgeP1).toBe(false);
    expect(hasBlockP2).toBe(false);
    expect(hasDamageJudgeP2).toBe(false);
  });

  it("C & D: should put block in requestBuffer upon attack resolve if attacker exists, but not if no attacker", () => {
    const state = createBattleState();
    const registry = new CommandRegistry();

    // アタックアクションを実行
    const attackAction = rulePackage.actions.find((a) => a.id === "action.attack")!;
    const context: CommandContext = {
      state,
      playerKey: "p1",
      targetComponent: state.players.p1.field[0],
      targetPlayerKey: "p2",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    const req = registry.createRequest(attackAction, context);
    registry.resolveTopRequest(context);

    // アタッカーが存在するため、block が requestBuffer に入る (Test C)
    expect(state.requestBuffer.requests.length).toBe(1);
    expect(state.requestBuffer.requests[0].actionId).toBe("action.block");
    expect(state.requestBuffer.requests[0].controller).toBe("p2");
    expect(state.requestBuffer.requests[0].definitionOwner).toBe("p1");

    // アタッカーが存在しない状態で actionResolved(action.attack) を投げた場合は誘発しない (Test D)
    state.requestBuffer.requests = [];
    state.players.p1.field[0].battle = undefined; // アタッカークリア

    registry.dispatchEvent(
      { type: "actionResolved", payload: { actionId: "action.attack", playerKey: "p1" } },
      context
    );
    expect(state.requestBuffer.requests.length).toBe(0);
  });

  it("E & F: should move normal block from buffer to stage and NOT resolve immediately", () => {
    const state = createBattleState();
    const session = new GameSession(state, rulePackage);

    // アタックを直接解決して block を buffer に入れる
    const attackAction = rulePackage.actions.find((a) => a.id === "action.attack")!;
    const context: CommandContext = {
      state,
      playerKey: "p1",
      targetComponent: state.players.p1.field[0],
      targetPlayerKey: "p2",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };
    session.registry.createRequest(attackAction, context);
    session.registry.resolveTopRequest(context);

    expect(state.requestBuffer.requests.length).toBe(1);

    // session.advance() を呼ぶと、バッファ内の block が stage へ移送される (Test E)
    const step = session.advance();
    expect(step.type).toBe("WAITING_FOR_DECISION");

    // 検証：
    // A. buffer から stage へ移動している
    expect(state.requestBuffer.requests.length).toBe(0);
    expect(state.stage.requests.length).toBe(1);
    expect(state.stage.requests[0].actionId).toBe("action.block");

    // B. stage に積まれただけで未解決（status: "pending"）(Test F)
    expect(state.stage.requests[0].status).toBe("pending");

    // C. チャンスが block のコントローラー（防御側 p2）になっている
    expect(state.chancePlayer).toBe("p2");
  });

  it("G & H: should trigger damageJudge upon block resolve regardless of blocker presence and move to stage via buffer", () => {
    const state = createBattleState();
    const session = new GameSession(state, rulePackage);

    // まずアタックを解決してアタッカーを作成
    const attackAction = rulePackage.actions.find((a) => a.id === "action.attack")!;
    const atkContext: CommandContext = {
      state,
      playerKey: "p1",
      targetComponent: state.players.p1.field[0],
      targetPlayerKey: "p2",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };
    session.registry.createRequest(attackAction, atkContext);
    session.registry.resolveTopRequest(atkContext);

    // アタック解決により buffer に入った block をクリアして直接 block 解決をシミュレート
    state.requestBuffer.requests = [];

    // ブロックアクションを解決（ブロッカーなしでも誘発するか検証）
    const blockAction = rulePackage.actions.find((a) => a.id === "action.block")!;
    const blkContext: CommandContext = {
      state,
      playerKey: "p2",
      targetComponent: state.players.p2.field[0],
      actions: rulePackage.actions,
      components: rulePackage.components,
    };
    session.registry.createRequest(blockAction, blkContext);
    session.registry.resolveTopRequest(blkContext);

    // block 解決により damageJudge が requestBuffer に入る (Test G)
    expect(state.requestBuffer.requests.length).toBe(1);
    expect(state.requestBuffer.requests[0].actionId).toBe("action.damageJudge");
    expect(state.requestBuffer.requests[0].controller).toBe("p1");

    // session.advance() で damageJudge が stage へ移送される (Test H)
    const step = session.advance();
    expect(step.type).toBe("WAITING_FOR_DECISION");

    expect(state.requestBuffer.requests.length).toBe(0);
    expect(state.stage.requests.length).toBe(1);
    expect(state.stage.requests[0].actionId).toBe("action.damageJudge");
  });

  it("I: should process immediate triggers before normal triggers", () => {
    const state = createBattleState();
    const coordinator = new TriggerProcessingCoordinator();
    const registry = new CommandRegistry();

    // 即時アクション（世代交代）と通常アクション（ブロック）をバッファに混在させる
    state.players.p1.field[0].battle = { role: "attacker", targetPlayerKey: "p2" };
    const nextGenAction = rulePackage.actions.find((a) => a.id === "action.nextGeneration")!;
    const blockAction = rulePackage.actions.find((a) => a.id === "action.block")!;

    state.requestBuffer.requests = [
      {
        id: "trg-block",
        actionId: "action.block",
        action: blockAction,
        controller: "p2",
        keyCards: [],
        definitionOwner: "p1",
        status: "pending",
        sequence: 1,
      },
      {
        id: "trg-nextgen",
        actionId: "action.nextGeneration",
        action: nextGenAction,
        controller: "p1",
        keyCards: [],
        definitionOwner: "p1",
        status: "pending",
        sequence: 2,
      },
    ];

    const result = coordinator.processPendingTriggers(state, rulePackage, registry);

    // 即時が先に直接解決され、通常が stage に積まれる
    expect(result.immediateResolvedCount).toBe(1);
    expect(result.normalQueuedCount).toBe(1);
    expect(state.stage.requests.length).toBe(1);
    expect(state.stage.requests[0].actionId).toBe("action.block");
  });

  it("J & K: should sort by turnPlayer first and main before quick in same player", () => {
    const turnPlayer = "p1";
    const allPlayers = ["p1", "p2"];

    const reqP2Main: TriggeredActionRequest = {
      id: "1",
      actionId: "p2-main",
      action: { id: "p2-main", name: "P2 Main", type: "basic", request: { trigger: "triggered", speed: "normal", timing: "main" } },
      controller: "p2",
      keyCards: [],
      definitionOwner: "p2",
      status: "pending",
      sequence: 1,
    };
    const reqP1Quick: TriggeredActionRequest = {
      id: "2",
      actionId: "p1-quick",
      action: { id: "p1-quick", name: "P1 Quick", type: "basic", request: { trigger: "triggered", speed: "normal", timing: "quick" } },
      controller: "p1",
      keyCards: [],
      definitionOwner: "p1",
      status: "pending",
      sequence: 2,
    };
    const reqP1Main: TriggeredActionRequest = {
      id: "3",
      actionId: "p1-main",
      action: { id: "p1-main", name: "P1 Main", type: "basic", request: { trigger: "triggered", speed: "normal", timing: "main" } },
      controller: "p1",
      keyCards: [],
      definitionOwner: "p1",
      status: "pending",
      sequence: 3,
    };

    const requests = [reqP2Main, reqP1Quick, reqP1Main];
    requests.sort((a, b) => TriggerProcessingCoordinator.compareRequests(a, b, turnPlayer as any, allPlayers as any));

    // 期待順: P1 Main -> P1 Quick -> P2 Main (Test J: turnPlayer first, Test K: main before quick)
    expect(requests[0].actionId).toBe("p1-main");
    expect(requests[1].actionId).toBe("p1-quick");
    expect(requests[2].actionId).toBe("p2-main");
  });

  it("L: should not double execute triggered actions between old and new paths", () => {
    const state = createBattleState();
    const session = new GameSession(state, rulePackage);

    // 世代交代カード（J）を墓地へ送るイベントを発火
    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    session.registry.dispatchEvent(
      {
        type: "cardMoved",
        payload: {
          fromZone: "field",
          toZone: "grave",
          card: { id: "j1", suit: "S", rank: "J", value: 11 },
          playerKey: "p1",
        },
      },
      context
    );

    // バッファに 1件だけ積まれていること
    expect(state.requestBuffer.requests.length).toBe(1);
    expect(state.requestBuffer.requests[0].actionId).toBe("action.nextGeneration");

    // advance() で解決
    session.advance();

    // 解決履歴に 1件だけ記録され、二重実行されていないこと
    const resolvedNextGen = state.requestBuffer.history.filter(
      (h: any) => h.actionId === "action.nextGeneration" && h.status === "resolvedImmediately"
    );
    expect(resolvedNextGen.length).toBe(1);
  });
});
