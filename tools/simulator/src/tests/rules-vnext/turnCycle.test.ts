import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage } from "../../domain/rules/RulePackage";
import { GameSession } from "../../engine/session/GameSession";
import { TurnManager } from "../../engine/rules/TurnManager";
import { DecisionResponse } from "../../domain/decision/DecisionResponse";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry";
import { TriggerProcessingCoordinator } from "../../engine/rules/TriggerProcessingCoordinator";

describe("Turn Cycle, Charge & Draw Integration Tests (Phase 21A)", () => {
  let rulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  const createBaseState = () => {
    return {
      stateVersion: 1,
      version: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      turnCount: 1,
      actionCount: 0,
      players: {
        p1: {
          name: "Player A",
          life: [
            { id: "l1-1", suit: "S", rank: "2", value: 2 },
            { id: "l1-2", suit: "H", rank: "3", value: 3 },
            { id: "l1-3", suit: "D", rank: "4", value: 4 },
            { id: "l1-4", suit: "C", rank: "5", value: 5 },
          ],
          hand: [
            { id: "h1-1", suit: "D", rank: "5", value: 5 },
            { id: "h1-2", suit: "C", rank: "2", value: 2 }, // Dコスト用
          ],
          field: [
            {
              unitId: "soldier-p1",
              componentId: "character.soldier",
              kind: "一般兵",
              state: "drive",
              cards: [{ id: "c1-1", suit: "S", rank: "6", value: 6 }],
              labels: ["攻撃", "防御"],
            },
          ],
          fog: [],
          trump: [],
          grave: [],
        },
        p2: {
          name: "Player B",
          life: [
            { id: "l2-1", suit: "C", rank: "5", value: 5 },
            { id: "l2-2", suit: "S", rank: "6", value: 6 },
            { id: "l2-3", suit: "H", rank: "7", value: 7 },
            { id: "l2-4", suit: "D", rank: "8", value: 8 },
            { id: "l2-5", suit: "S", rank: "9", value: 9 },
          ],
          hand: [],
          field: [
            {
              unitId: "soldier-p2",
              componentId: "character.soldier",
              kind: "一般兵",
              state: "drive",
              cards: [{ id: "c2-1", suit: "H", rank: "6", value: 6 }],
              labels: ["攻撃", "防御"],
            },
            {
              unitId: "bw-p2",
              componentId: "character.bulwark",
              kind: "防壁",
              face: "down",
              state: "drive",
              cards: [{ id: "c2-2", suit: "D", rank: "4", value: 4 }],
              labels: ["防御"],
            },
          ],
          fog: [],
          trump: [],
          grave: [],
        },
      },
      stage: { requests: [], history: [] },
      requestBuffer: { requests: [], history: [] },
    } as any;
  };

  it("Test 21A-1: Complete Turn Cycle E2E (End -> Turn Change -> Charge immediate -> Draw staged -> NTP chance -> PASS/PASS -> Draw resolved -> TP chance)", () => {
    const state = createBaseState();
    const session = new GameSession(state, rulePackage);

    // 1. p1 がターンプレイヤー、p1 の判断要求
    let step = session.advance();
    expect(step.type).toBe("WAITING_FOR_DECISION");
    if (step.type !== "WAITING_FOR_DECISION") return;
    const req1 = step.request;
    expect(req1.playerId).toBe("p1");

    // p1 が End アクションを選択
    const endActionDef = rulePackage.actions.find((a) => a.id === "action.end")!;
    const endPatternIndex = req1.patterns.findIndex(
      (p) => p.actionSelectionRef !== undefined && req1.catalog.actions[p.actionSelectionRef].actionId === endActionDef.id
    );
    expect(endPatternIndex).toBeGreaterThanOrEqual(0);

    step = session.submitDecision({
      decisionId: req1.decisionId,
      stateVersion: req1.stateVersion,
      selectedPatternRef: endPatternIndex,
    });

    // End が Stage に積まれ、チャンスは p1
    expect(state.stage.requests.length).toBe(1);
    expect(state.stage.requests[0].actionId).toBe("action.end");

    // 2. p1 が PASS
    expect(step.type).toBe("WAITING_FOR_DECISION");
    if (step.type !== "WAITING_FOR_DECISION") return;
    expect(step.request.playerId).toBe("p1");

    const passPatternIndexP1 = step.request.patterns.findIndex((p) => p.kind === "PASS");
    step = session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: passPatternIndexP1,
    });

    // チャンスが p2 へ移行
    expect(step.type).toBe("WAITING_FOR_DECISION");
    if (step.type !== "WAITING_FOR_DECISION") return;
    expect(step.request.playerId).toBe("p2");

    // 3. p2 が PASS -> 連続PASS成立で End 解決
    const passPatternIndexP2 = step.request.patterns.findIndex((p) => p.kind === "PASS");
    step = session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: passPatternIndexP2,
    });

    // End 解決 -> ターン交代 (turnPlayer = p2)
    expect(state.turnPlayer).toBe("p2");

    // Charge が即時解決され、p2 の全キャラクター（soldier, bulwark）が charge 状態になる
    expect(state.players.p2.field[0].state).toBe("charge");
    expect(state.players.p2.field[1].state).toBe("charge");
    // p1 のキャラクターは drive のまま
    expect(state.players.p1.field[0].state).toBe("drive");

    // Draw が通常スピードで誘発され、Stage に積まれる
    expect(state.stage.requests.length).toBe(1);
    expect(state.stage.requests[0].actionId).toBe("action.draw");
    expect(state.stage.requests[0].controller).toBe("p2");
    expect(state.players.p2.life.length).toBe(5); // この時点ではまだライフは減っていない
    expect(state.players.p2.hand.length).toBe(0);

    // Draw が Stage に積まれた直後、チャンスは新ターンプレイヤー p2 へ
    expect(state.chancePlayer).toBe("p2");
    expect(step.type).toBe("WAITING_FOR_DECISION");
    if (step.type !== "WAITING_FOR_DECISION") return;
    expect(step.request.playerId).toBe("p2");

    // 4. p2 が PASS (対応なし) -> チャンスが p1 へ
    const passIndexAfterDrawP2 = step.request.patterns.findIndex((p) => p.kind === "PASS");
    step = session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: passIndexAfterDrawP2,
    });

    expect(state.chancePlayer).toBe("p1");
    expect(step.type).toBe("WAITING_FOR_DECISION");
    if (step.type !== "WAITING_FOR_DECISION") return;
    expect(step.request.playerId).toBe("p1");

    // 5. p1 も PASS (全員連続PASS成立) -> Draw 解決
    const passIndexAfterDrawP1 = step.request.patterns.findIndex((p) => p.kind === "PASS");
    step = session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: passIndexAfterDrawP1,
    });

    // Draw 解決後: ライフ 5枚 -> 2枚引いて手札 2枚、ライフ残り 3枚
    expect(state.players.p2.hand.length).toBe(2);
    expect(state.players.p2.life.length).toBe(3);
    expect(state.stage.requests.length).toBe(0);


    // Draw 解決後、チャンスは手番プレイヤー (turnPlayer = p2) へ戻る
    expect(state.turnPlayer).toBe("p2");
    expect(state.chancePlayer).toBe("p2");
    expect(step.type).toBe("WAITING_FOR_DECISION");
    if (step.type !== "WAITING_FOR_DECISION") return;
    expect(step.request.playerId).toBe("p2");
  });

  it("Test 21A-2: Normal 2-Card Draw (life > 2) directly via CommandRegistry", () => {
    const registry = new CommandRegistry();
    const state = createBaseState();

    const drawAction = rulePackage.actions.find((a) => a.id === "action.draw")!;
    const context: CommandContext = {
      state,
      playerKey: "p2",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    const req = registry.createRequest(drawAction, context);
    registry.resolveTopRequest(context);

    // p2 のライフ 5枚 -> 2枚ドロー (残り 3枚)
    expect(state.players.p2.hand.length).toBe(2);
    expect(state.players.p2.life.length).toBe(3);
  });

  it("Test 21A-3: Life <= 2 (Life = 2) -> draws only 1 card", () => {
    const registry = new CommandRegistry();
    const state = createBaseState();

    state.players.p2.life = [
      { id: "l2-1", suit: "C", rank: "5", value: 5 },
      { id: "l2-2", suit: "S", rank: "6", value: 6 },
    ];

    const drawAction = rulePackage.actions.find((a) => a.id === "action.draw")!;
    const context: CommandContext = {
      state,
      playerKey: "p2",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    registry.createRequest(drawAction, context);
    registry.resolveTopRequest(context);

    // ライフ 2枚 -> 1枚のみドロー (残り 1枚)
    expect(state.players.p2.hand.length).toBe(1);
    expect(state.players.p2.life.length).toBe(1);
  });

  it("Test 21A-4: Life <= 2 (Life = 1) -> draws only 1 card", () => {
    const registry = new CommandRegistry();
    const state = createBaseState();

    state.players.p2.life = [
      { id: "l2-1", suit: "C", rank: "5", value: 5 },
    ];

    const drawAction = rulePackage.actions.find((a) => a.id === "action.draw")!;
    const context: CommandContext = {
      state,
      playerKey: "p2",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    registry.createRequest(drawAction, context);
    registry.resolveTopRequest(context);

    // ライフ 1枚 -> 1枚ドロー (残り 0枚)
    expect(state.players.p2.hand.length).toBe(1);
    expect(state.players.p2.life.length).toBe(0);
  });

  it("Test 21A-5: Life count evaluated at EFFECT RESOLUTION time (Life 3 -> modified to 2 while staged -> draws 1)", () => {
    const registry = new CommandRegistry();
    const state = createBaseState();

    state.players.p2.life = [
      { id: "l2-1", suit: "C", rank: "5", value: 5 },
      { id: "l2-2", suit: "S", rank: "6", value: 6 },
      { id: "l2-3", suit: "H", rank: "7", value: 7 },
    ];

    const drawAction = rulePackage.actions.find((a) => a.id === "action.draw")!;
    const context: CommandContext = {
      state,
      playerKey: "p2",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // リクエスト生成時 (Life = 3)
    registry.createRequest(drawAction, context);

    // Stage にある間に何らかの処理で Life が 2 に変化
    state.players.p2.life.pop();
    expect(state.players.p2.life.length).toBe(2);

    // 解決
    registry.resolveTopRequest(context);

    // 解決時点のライフが 2 なので 1枚のみドロー
    expect(state.players.p2.hand.length).toBe(1);
    expect(state.players.p2.life.length).toBe(1);
  });

  it("Test 21A-6: Draw staged interruption with Quick Action & LIFO resolution", () => {
    const state = createBaseState();
    const session = new GameSession(state, rulePackage);

    // p1 が End
    let step = session.advance();
    if (step.type !== "WAITING_FOR_DECISION") return;
    const reqEnd = step.request;

    const endActionDef = rulePackage.actions.find((a) => a.id === "action.end")!;
    const endPatternIndex = reqEnd.patterns.findIndex(
      (p) => p.actionSelectionRef !== undefined && reqEnd.catalog.actions[p.actionSelectionRef].actionId === endActionDef.id
    );
    session.submitDecision({
      decisionId: reqEnd.decisionId,
      stateVersion: reqEnd.stateVersion,
      selectedPatternRef: endPatternIndex,
    });

    // p1 PASS, p2 PASS で End 解決 -> Charge 解決 -> Draw が Stage へ
    step = session.advance();
    if (step.type !== "WAITING_FOR_DECISION") return;
    const pass1 = step.request.patterns.findIndex((p) => p.kind === "PASS");
    step = session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: pass1,
    });

    if (step.type !== "WAITING_FOR_DECISION") return;
    const pass2 = step.request.patterns.findIndex((p) => p.kind === "PASS");
    step = session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: pass2,
    });

    // Draw が Stage に積まれ、チャンスは p2
    expect(state.stage.requests.length).toBe(1);
    expect(state.stage.requests[0].actionId).toBe("action.draw");
    expect(step.type).toBe("WAITING_FOR_DECISION");
    if (step.type !== "WAITING_FOR_DECISION") return;
    expect(step.request.playerId).toBe("p2");

    // p2 が PASS してチャンスを p1 へ渡す
    const passDrawP2 = step.request.patterns.findIndex((p) => p.kind === "PASS");
    step = session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: passDrawP2,
    });

    if (step.type !== "WAITING_FOR_DECISION") return;
    const reqDrawStage = step.request;
    expect(reqDrawStage.playerId).toBe("p1");


    // p1 の Legal Patterns に Quick アクション (ツイスト) が存在することを確認
    const twistPatternIndex = reqDrawStage.patterns.findIndex(
      (p) => p.actionSelectionRef !== undefined && reqDrawStage.catalog.actions[p.actionSelectionRef].actionId === "action.twist"
    );
    expect(twistPatternIndex).toBeGreaterThanOrEqual(0);

    // p1 が ツイスト (対象: soldier-p1) をリクエスト
    step = session.submitDecision({
      decisionId: reqDrawStage.decisionId,
      stateVersion: reqDrawStage.stateVersion,
      selectedPatternRef: twistPatternIndex,
    });

    // Stage に [Draw (req-1), Twist (req-2)] が積まれている
    expect(state.stage.requests.length).toBe(2);
    expect(state.stage.requests[0].actionId).toBe("action.draw");
    expect(state.stage.requests[1].actionId).toBe("action.twist");

    // p1 PASS -> p2 PASS で Twist が先に解決 (LIFO)
    if (step.type !== "WAITING_FOR_DECISION") return;
    const passQuickP1 = step.request.patterns.findIndex((p) => p.kind === "PASS");
    step = session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: passQuickP1,
    });

    if (step.type !== "WAITING_FOR_DECISION") return;
    const passQuickP2 = step.request.patterns.findIndex((p) => p.kind === "PASS");
    step = session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: passQuickP2,
    });

    // Twist 解決後: soldier-p1 が drive -> charge に切り替わり、Stage には Draw のみ残る
    expect(state.players.p1.field[0].state).toBe("charge");
    expect(state.stage.requests.length).toBe(1);
    expect(state.stage.requests[0].actionId).toBe("action.draw");

    // 次に p2 (TP) PASS -> p1 (NTP) PASS で Draw が解決
    if (step.type !== "WAITING_FOR_DECISION") return;
    const passDrawTP = step.request.patterns.findIndex((p) => p.kind === "PASS");
    step = session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: passDrawTP,
    });

    if (step.type !== "WAITING_FOR_DECISION") return;
    const passDrawNTP = step.request.patterns.findIndex((p) => p.kind === "PASS");
    step = session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: passDrawNTP,
    });

    // Draw 解決
    expect(state.stage.requests.length).toBe(0);
    expect(state.players.p2.hand.length).toBe(2);
  });

  it("Test 21A-7: Charge immediate execution does NOT touch stage or interrupt with Decision", () => {
    const registry = new CommandRegistry();
    const coordinator = new TriggerProcessingCoordinator();
    const state = createBaseState();

    // p2 のターンへ
    TurnManager.startTurn(state, "p2");

    // actionResolved(action.end) イベントを手動発行
    registry.dispatchEvent(
      {
        type: "actionResolved",
        payload: { actionId: "action.end", playerKey: "p1" },
      },
      { state, playerKey: "p1", actions: rulePackage.actions, components: rulePackage.components }
    );

    // バッファに Charge が積まれる (controller: p2)
    expect(state.requestBuffer.requests.length).toBe(1);
    expect(state.requestBuffer.requests[0].actionId).toBe("action.charge");
    expect(state.requestBuffer.requests[0].controller).toBe("p2");

    // バッファ処理を実行 -> 即時解決
    const result = coordinator.processPendingTriggers(state, rulePackage, registry);
    expect(result.immediateResolvedCount).toBe(1);

    // Stage に Charge は存在しない
    expect(state.stage.requests.some((r: any) => r.actionId === "action.charge")).toBe(false);

    // p2 の全キャラクターが charge 状態
    expect(state.players.p2.field[0].state).toBe("charge");
    expect(state.players.p2.field[1].state).toBe("charge");

    // Charge 解決により Draw が誘発され、通常スピードのためバッファからステージへ積まれる
    expect(state.stage.requests.some((r: any) => r.actionId === "action.draw")).toBe(true);
    expect(state.stage.requests[0].controller).toBe("p2");
  });

  it("Test 21A-8: Revolution Draw continues to draw exactly 1 card regardless of life condition", () => {
    const registry = new CommandRegistry();
    const coordinator = new TriggerProcessingCoordinator();
    const state = createBaseState();

    state.players.p1.life = [
      { id: "l1-1", suit: "S", rank: "2", value: 2 },
      { id: "l1-2", suit: "H", rank: "3", value: 3 },
      { id: "l1-3", suit: "D", rank: "4", value: 4 },
      { id: "l1-4", suit: "C", rank: "5", value: 5 },
      { id: "l1-5", suit: "S", rank: "6", value: 6 },
    ];

    state.players.p1.trump.push({
      id: "trump-rev-p1",
      componentId: "trump.revolution",
      face: "up",
      zone: "trump",
    });

    const attacker = {
      unitId: "att-1",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-att", suit: "S", rank: "6", value: 6 }],
      labels: ["攻撃"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    state.players.p1.field.push(attacker);

    const damageJudgeAction = rulePackage.actions.find((a) => a.id === "action.damageJudge")!;
    const context: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    registry.createRequest(damageJudgeAction, context);
    registry.resolveTopRequest(context);

    // 未ブロック兵士により revolutionDraw が 1件バッファに積まれる
    expect(state.requestBuffer.requests.length).toBe(1);
    expect(state.requestBuffer.requests[0].actionId).toBe("action.revolutionDraw");

    // 即時解決
    coordinator.processPendingTriggers(state, rulePackage, registry);

    // 革命ドローはライフが 5枚あっても 1枚のみドロー (初期2枚 + 1枚 = 3枚)
    expect(state.players.p1.hand.length).toBe(3);
    expect(state.players.p1.life.length).toBe(4);
  });
});
