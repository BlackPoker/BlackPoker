import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage } from "../../domain/rules/RulePackage";
import { GameSession } from "../../engine/session/GameSession";
import { PassTracker } from "../../engine/session/PassTracker";
import { TurnManager } from "../../engine/rules/TurnManager";
import { DecisionResponse } from "../../domain/decision/DecisionResponse";
import { FirstLegalPatternPolicy } from "../../controller/FirstLegalPatternPolicy";
import { RandomPolicy } from "../../controller/RandomPolicy";

describe("Core Flow Integration Tests (Phase: Core Flow & Decision Integration)", () => {
  let rulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  const createTestState = () => {
    const soldier1 = {
      unitId: "soldier-1",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "c1", suit: "S", rank: "6", value: 6 }],
      labels: ["攻撃", "防御"],
    };

    const soldier2 = {
      unitId: "soldier-2",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "c2", suit: "S", rank: "5", value: 5 }],
      labels: ["攻撃", "防御"],
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
          field: [soldier2],
          fog: [],
          grave: [],
        },
      },
      stage: { requests: [], history: [] },
    } as Record<string, any>;

    TurnManager.initializeToMain(state, "p1");
    return state;
  };

  it("should NOT contain a fake action.pass in RulePackage.actions", () => {
    // PASS は ActionDefinition ではなく、Decision 上の選択種別として表現される
    const passAction = rulePackage.actions.find((a) => a.id === "action.pass" || a.name === "パス");
    expect(passAction).toBeUndefined();
  });

  it("should queue normal action to stage without resolving immediately and keep chance player", () => {
    const state = createTestState();
    const session = new GameSession(state, rulePackage);

    const step1 = session.advance();
    expect(step1.type).toBe("WAITING_FOR_DECISION");
    if (step1.type !== "WAITING_FOR_DECISION") return;

    expect(step1.request.playerId).toBe("p1");

    // アップ（quick/normal speed）のパターンを探す
    const upPatternIndex = step1.request.patterns.findIndex((p) => {
      if (p.actionSelectionRef === undefined) return false;
      return step1.request.catalog.actions[p.actionSelectionRef]?.actionId === "action.up";
    });
    expect(upPatternIndex).toBeGreaterThanOrEqual(0);

    const response: DecisionResponse = {
      decisionId: step1.request.decisionId,
      stateVersion: step1.request.stateVersion,
      selectedPatternRef: upPatternIndex,
    };

    // 1. 通常アクションを選択して送信
    const step2 = session.submitDecision(response);

    // 検証：
    // A. stage に積まれているが、未解決（status: "pending"）であること
    expect(session.state.stage.requests.length).toBe(1);
    expect(session.state.stage.requests[0].actionId).toBe("action.up");
    expect(session.state.stage.requests[0].status).toBe("pending");
    // フォグはまだ作成されていないこと（未解決）
    expect(session.state.players.p1.fog.length).toBe(0);

    // B. チャンスプレイヤーは p1 のままであること（通常アクションを積んだだけでは相手へ移らない）
    expect(session.state.chancePlayer).toBe("p1");

    // C. 次の DecisionRequest に PASS パターンが含まれていること
    expect(step2.type).toBe("WAITING_FOR_DECISION");
    if (step2.type === "WAITING_FOR_DECISION") {
      expect(step2.request.playerId).toBe("p1");
      const passIndex = step2.request.patterns.findIndex((p) => p.kind === "PASS");
      expect(passIndex).toBeGreaterThanOrEqual(0);
    }
  });

  it("should transfer chance to next player upon PASS and resolve stage top upon consecutive PASS from all players", () => {
    const state = createTestState();
    const session = new GameSession(state, rulePackage);

    // 1. Player A がアップを stage に積む
    const step1 = session.advance();
    if (step1.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

    const upIndex = step1.request.patterns.findIndex((p) => {
      if (p.actionSelectionRef === undefined) return false;
      return step1.request.catalog.actions[p.actionSelectionRef]?.actionId === "action.up";
    });

    const step2 = session.submitDecision({
      decisionId: step1.request.decisionId,
      stateVersion: step1.request.stateVersion,
      selectedPatternRef: upIndex,
    });

    expect(session.state.chancePlayer).toBe("p1");
    expect(session.state.stage.requests.length).toBe(1);

    // 2. Player A が PASS を選択
    if (step2.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");
    const p1PassIndex = step2.request.patterns.findIndex((p) => p.kind === "PASS");

    const step3 = session.submitDecision({
      decisionId: step2.request.decisionId,
      stateVersion: step2.request.stateVersion,
      selectedPatternRef: p1PassIndex,
    });

    // 検証：A が PASS したため、チャンスが Player B (p2) へ移動すること
    expect(session.state.chancePlayer).toBe("p2");
    expect(session.passTracker.consecutivePassCount).toBe(1);

    // 3. Player B も PASS を選択（全員連続PASS成立）
    if (step3.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");
    expect(step3.request.playerId).toBe("p2");
    const p2PassIndex = step3.request.patterns.findIndex((p) => p.kind === "PASS");

    session.submitDecision({
      decisionId: step3.request.decisionId,
      stateVersion: step3.request.stateVersion,
      selectedPatternRef: p2PassIndex,
    });

    // 検証：
    // A. 全員連続PASSが成立し、stage 最上段の「アップ」が 1 件解決されたこと
    expect(session.state.stage.requests.length).toBe(0);
    expect(session.state.players.p1.fog.length).toBe(1);
    expect(session.state.players.p1.fog[0].componentId).toBe("fog.up");

    // B. コスト（cost-c2）が墓地に送られていること
    expect(session.state.players.p1.grave.length).toBe(1);

    // C. 解決後、チャンスプレイヤーが turnPlayer (p1) へ戻ること
    expect(session.state.chancePlayer).toBe("p1");

    // D. 連続PASS状態が 0 にリセットされていること
    expect(session.passTracker.consecutivePassCount).toBe(0);
  });

  it("should reset consecutive pass count if opponent queues an action instead of passing", () => {
    const state = createTestState();
    const session = new GameSession(state, rulePackage);

    // 1. Player A がアップを積む
    const step1 = session.advance();
    if (step1.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");
    const upIndex = step1.request.patterns.findIndex((p) => {
      if (p.actionSelectionRef === undefined) return false;
      return step1.request.catalog.actions[p.actionSelectionRef]?.actionId === "action.up";
    });
    const step2 = session.submitDecision({
      decisionId: step1.request.decisionId,
      stateVersion: step1.request.stateVersion,
      selectedPatternRef: upIndex,
    });

    // 2. Player A が PASS
    if (step2.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");
    const p1PassIndex = step2.request.patterns.findIndex((p) => p.kind === "PASS");
    const step3 = session.submitDecision({
      decisionId: step2.request.decisionId,
      stateVersion: step2.request.stateVersion,
      selectedPatternRef: p1PassIndex,
    });
    expect(session.state.chancePlayer).toBe("p2");
    expect(session.passTracker.consecutivePassCount).toBe(1);

    // 3. Player B は PASS せず、ダウン（クイックアクション）を stage に積む
    if (step3.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");
    const downIndex = step3.request.patterns.findIndex((p) => {
      if (p.actionSelectionRef === undefined) return false;
      return step3.request.catalog.actions[p.actionSelectionRef]?.actionId === "action.down";
    });
    expect(downIndex).toBeGreaterThanOrEqual(0);

    session.submitDecision({
      decisionId: step3.request.decisionId,
      stateVersion: step3.request.stateVersion,
      selectedPatternRef: downIndex,
    });

    // 検証：
    // A. Player B がアクションを積んだため、連続PASSカウントが 0 にリセットされること
    expect(session.passTracker.consecutivePassCount).toBe(0);

    // B. チャンスは Player B のままであること（さらに積むかPASSを選べる）
    expect(session.state.chancePlayer).toBe("p2");

    // C. stage に 2件（アップ, ダウン）が積まれていること
    expect(session.state.stage.requests.length).toBe(2);
  });

  it("should resolve immediate action immediately and keep chance player", () => {
    const state = createTestState();
    const immRulePackage: RulePackage = {
      ...rulePackage,
      actions: [
        ...rulePackage.actions,
        {
          id: "action.test_imm",
          name: "テスト即時",
          type: "normal",
          request: { trigger: "direct", speed: "immediate", timing: "always" },
          effect: [],
        },
      ],
    };

    const session = new GameSession(state, immRulePackage);
    const step1 = session.advance();
    if (step1.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

    const immIndex = step1.request.patterns.findIndex((p) => {
      if (p.actionSelectionRef === undefined) return false;
      return step1.request.catalog.actions[p.actionSelectionRef]?.actionId === "action.test_imm";
    });
    expect(immIndex).toBeGreaterThanOrEqual(0);

    session.submitDecision({
      decisionId: step1.request.decisionId,
      stateVersion: step1.request.stateVersion,
      selectedPatternRef: immIndex,
    });

    // 検証：
    // A. 即時アクションなので stage には残らず即解決（stage は空）
    expect(session.state.stage.requests.length).toBe(0);
    // B. 即時解決後もチャンスは Player A のまま
    expect(session.state.chancePlayer).toBe("p1");
  });

  it("should work seamlessly with FirstLegalPatternPolicy and RandomPolicy", async () => {
    const state = createTestState();
    const session = new GameSession(state, rulePackage);

    const firstPolicy = new FirstLegalPatternPolicy();
    const randomPolicy = new RandomPolicy(() => 0.5);

    const step1 = session.advance();
    if (step1.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

    const respFirst = await firstPolicy.decide(step1.request);
    expect(typeof respFirst.selectedPatternRef).toBe("number");
    expect(respFirst.decisionId).toBe(step1.request.decisionId);

    const respRandom = await randomPolicy.decide(step1.request);
    expect(typeof respRandom.selectedPatternRef).toBe("number");
    expect(respRandom.decisionId).toBe(step1.request.decisionId);
  });
});
