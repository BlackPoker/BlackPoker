import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage } from "../../domain/rules/RulePackage";
import { GameSession } from "../../engine/session/GameSession";
import { LegalPatternGenerator } from "../../engine/decision/LegalPatternGenerator";
import { FirstLegalPatternPolicy } from "../../controller/FirstLegalPatternPolicy";
import { RandomPolicy } from "../../controller/RandomPolicy";

describe("EFFECT_RESOLUTION Decision Integration Tests: Attack Action (Phase 15)", () => {
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

    const soldier2 = {
      unitId: "soldier-2",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "c2", suit: "H", rank: "7", value: 7 }],
      labels: ["攻撃"],
    };

    const bulwark1 = {
      unitId: "bulwark-1",
      kind: "防壁",
      componentId: "character.bulwark",
      state: "charge",
      cards: [{ id: "b1", suit: "D", rank: "5", value: 5 }],
      labels: ["防御"], // 攻撃ラベルなし
    };

    return {
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          name: "Player A",
          life: [
            { id: "l1-1", suit: "S", rank: "A", value: 1 },
            { id: "l1-2", suit: "H", rank: "2", value: 2 },
          ],
          hand: [
            { id: "key-s8", suit: "S", rank: "8", value: 8 },
            { id: "cost-c2", suit: "C", rank: "2", value: 2 },
          ],
          field: [soldier1, soldier2],
          fog: [],
          grave: [],
        },
        p2: {
          name: "Player B",
          life: [
            { id: "l2-1", suit: "D", rank: "K", value: 13 },
            { id: "l2-2", suit: "C", rank: "Q", value: 12 },
          ],
          hand: [],
          field: [bulwark1],
          fog: [],
          grave: [],
        },
      },
      stage: { requests: [], history: [] },
      requestBuffer: { requests: [], history: [] },
    } as any;
  };

  const getReq = (step: any) => {
    if (step.type !== "WAITING_FOR_DECISION") {
      throw new Error(`Expected WAITING_FOR_DECISION but got ${step.type}`);
    }
    return step.request;
  };

  it("A: action.attack ACTION_REQUEST patterns should NOT contain attacker units or targetPlayer (targetType: none)", () => {
    const state = createBattleState();
    const { request } = LegalPatternGenerator.generateActionRequestDecision(state, "p1", rulePackage);

    const attackPatterns = request.patterns.filter((p) => {
      if (p.actionSelectionRef === undefined) return false;
      const act = request.catalog.actions[p.actionSelectionRef];
      return act?.actionId === "action.attack";
    });

    expect(attackPatterns.length).toBeGreaterThan(0);
    // すべてのアタックパターンの target は "none"（対象なし）であること
    for (const p of attackPatterns) {
      expect(p.targetSelectionRef).toBeDefined();
      const target = request.catalog.targetSelections[p.targetSelectionRef!];
      expect(target.targetType).toBe("none");
    }
  });

  it("B: queuing attack request to stage should NOT set attacker.battle or change state", () => {
    const state = createBattleState();
    const session = new GameSession(state, rulePackage);

    // p1 がアタックを選択
    const step1 = session.advance();
    const req1 = getReq(step1);

    const attackPatternRef = req1.patterns.findIndex((p: any) => {
      if (p.actionSelectionRef === undefined) return false;
      const act = req1.catalog.actions[p.actionSelectionRef];
      return act?.actionId === "action.attack";
    });
    expect(attackPatternRef).toBeGreaterThanOrEqual(0);

    const step2 = session.submitDecision({
      decisionId: req1.decisionId,
      stateVersion: req1.stateVersion,
      selectedPatternRef: attackPatternRef,
    });

    // stage に attack が積まれた状態
    expect(state.stage.requests.length).toBe(1);
    expect(state.stage.requests[0].actionId).toBe("action.attack");
    expect(state.stage.requests[0].status).toBe("pending");

    // アタッカーユニットの battle や state はまだ変化していないこと
    const soldier1 = state.players.p1.field.find((u: any) => u.unitId === "soldier-1");
    expect(soldier1.state).toBe("charge");
    expect(soldier1.battle).toBeUndefined();
  });

  it("C, D, E, F, G, H, I, J: stage resolution of attack should interrupt and emit EFFECT_RESOLUTION Decision with 2^N patterns", () => {
    const state = createBattleState();
    const session = new GameSession(state, rulePackage);

    // 1. p1 がアタックをリクエスト
    const step1 = session.advance();
    const req1 = getReq(step1);
    const attackPatternRef = req1.patterns.findIndex((p: any) => {
      if (p.actionSelectionRef === undefined) return false;
      const act = req1.catalog.actions[p.actionSelectionRef];
      return act?.actionId === "action.attack";
    });
    session.submitDecision({
      decisionId: req1.decisionId,
      stateVersion: req1.stateVersion,
      selectedPatternRef: attackPatternRef,
    });

    // 2. p1 が PASS
    const step3 = session.advance();
    const req3 = getReq(step3);
    const passRef1 = req3.patterns.findIndex((p: any) => p.kind === "PASS");
    session.submitDecision({
      decisionId: req3.decisionId,
      stateVersion: req3.stateVersion,
      selectedPatternRef: passRef1,
    });

    // 3. p2 が PASS（全員連続PASS成立 → stage 最上段のアタック解決開始）
    const step5 = session.advance();
    const req5 = getReq(step5);
    const passRef2 = req5.patterns.findIndex((p: any) => p.kind === "PASS");
    const step6 = session.submitDecision({
      decisionId: req5.decisionId,
      stateVersion: req5.stateVersion,
      selectedPatternRef: passRef2,
    });

    // C, D: stage 解決開始時に EFFECT_RESOLUTION DecisionRequest が返る
    expect(step6.type).toBe("WAITING_FOR_DECISION");
    if (step6.type !== "WAITING_FOR_DECISION") return;

    const effDecReq = step6.request;
    expect(effDecReq.source.type).toBe("EFFECT_RESOLUTION");
    expect(effDecReq.playerId).toBe("p1");

    // E: パターン種別は EFFECT_SELECTION
    expect(effDecReq.patterns.every((p) => p.kind === "EFFECT_SELECTION")).toBe(true);

    // F, G, H: 攻撃ラベルを持つ charge キャラクター（soldier-1, soldier-2）の 2体から 2^2 = 4 パターンが生成されること
    // 1. [] (0体)
    // 2. [soldier-1]
    // 3. [soldier-2]
    // 4. [soldier-1, soldier-2]
    expect(effDecReq.patterns.length).toBe(4);
    const allSelectedCombinations = effDecReq.patterns.map((p) => {
      const effSel = effDecReq.catalog.effectSelections[p.effectSelectionRef!];
      return effSel.selectedValues;
    });

    expect(allSelectedCombinations).toContainEqual([]);
    expect(allSelectedCombinations).toContainEqual(["soldier-1"]);
    expect(allSelectedCombinations).toContainEqual(["soldier-2"]);
    expect(allSelectedCombinations).toContainEqual(["soldier-1", "soldier-2"]);

    // I: Decision待ちの間、request.status は "resolving" のままであること
    const resolvingReq = session.resolvingRequest;
    expect(resolvingReq).toBeDefined();
    expect(resolvingReq.actionId).toBe("action.attack");
    expect(resolvingReq.status).toBe("resolving");

    // J: Decision待ちの間、actionResolved は発行されず、block も誘発しないこと
    expect(state.requestBuffer.requests.length).toBe(0);
    expect(state.stage.history.length).toBe(0);
  });

  it("K, L, M: answering multiple attackers should make all selected attackers drive and trigger block upon completion", () => {
    const state = createBattleState();
    const session = new GameSession(state, rulePackage);

    // アタックリクエスト → 全員PASS
    const step1 = session.advance();
    const req1 = getReq(step1);
    const attackPatternRef = req1.patterns.findIndex((p: any) => {
      const act = req1.catalog.actions[p.actionSelectionRef!];
      return act?.actionId === "action.attack";
    });
    session.submitDecision({ decisionId: req1.decisionId, stateVersion: req1.stateVersion, selectedPatternRef: attackPatternRef });

    const step3 = session.advance();
    const req3 = getReq(step3);
    session.submitDecision({ decisionId: req3.decisionId, stateVersion: req3.stateVersion, selectedPatternRef: req3.patterns.findIndex((p: any) => p.kind === "PASS") });

    const step5 = session.advance();
    const req5 = getReq(step5);
    const step6 = session.submitDecision({ decisionId: req5.decisionId, stateVersion: req5.stateVersion, selectedPatternRef: req5.patterns.findIndex((p: any) => p.kind === "PASS") });

    expect(step6.type).toBe("WAITING_FOR_DECISION");
    if (step6.type !== "WAITING_FOR_DECISION") return;

    // [soldier-1, soldier-2] の複数アタッカーパターンを選択
    const multiAttackerRef = step6.request.patterns.findIndex((p) => {
      const effSel = step6.request.catalog.effectSelections[p.effectSelectionRef!];
      return effSel.selectedValues.length === 2;
    });
    expect(multiAttackerRef).toBeGreaterThanOrEqual(0);

    const step7 = session.submitDecision({
      decisionId: step6.request.decisionId,
      stateVersion: step6.request.stateVersion,
      selectedPatternRef: multiAttackerRef,
    });

    // K: 選択した全アタッカーが drive になり battle.role = "attacker" になる
    const soldier1 = state.players.p1.field.find((u: any) => u.unitId === "soldier-1");
    const soldier2 = state.players.p1.field.find((u: any) => u.unitId === "soldier-2");
    expect(soldier1.state).toBe("drive");
    expect(soldier1.battle).toEqual({ role: "attacker", targetPlayerKey: "p2" });
    expect(soldier2.state).toBe("drive");
    expect(soldier2.battle).toEqual({ role: "attacker", targetPlayerKey: "p2" });

    // L: 効果完了後に attack request が resolved になり stage.history に記録される
    expect(state.stage.history.length).toBe(1);
    expect(state.stage.history[0].actionId).toBe("action.attack");
    expect(state.stage.history[0].status).toBe("resolved");

    // M: アタッカーが1体以上存在するため block が requestBuffer に入り、通常誘発として stage へ積まれて p2 にチャンスが渡る
    expect(state.stage.requests.length).toBe(1);
    expect(state.stage.requests[0].actionId).toBe("action.block");
    expect(state.chancePlayer).toBe("p2");
  });

  it("N: selecting 0 attackers ([]) should resolve attack normally without triggering block", () => {
    const state = createBattleState();
    const session = new GameSession(state, rulePackage);

    // アタックリクエスト → 全員PASS
    const step1 = session.advance();
    const req1 = getReq(step1);
    const attackPatternRef = req1.patterns.findIndex((p: any) => {
      const act = req1.catalog.actions[p.actionSelectionRef!];
      return act?.actionId === "action.attack";
    });
    session.submitDecision({ decisionId: req1.decisionId, stateVersion: req1.stateVersion, selectedPatternRef: attackPatternRef });

    const step3 = session.advance();
    const req3 = getReq(step3);
    session.submitDecision({ decisionId: req3.decisionId, stateVersion: req3.stateVersion, selectedPatternRef: req3.patterns.findIndex((p: any) => p.kind === "PASS") });

    const step5 = session.advance();
    const req5 = getReq(step5);
    const step6 = session.submitDecision({ decisionId: req5.decisionId, stateVersion: req5.stateVersion, selectedPatternRef: req5.patterns.findIndex((p: any) => p.kind === "PASS") });

    expect(step6.type).toBe("WAITING_FOR_DECISION");
    if (step6.type !== "WAITING_FOR_DECISION") return;

    // [] (0体アタッカー) パターンを選択
    const zeroAttackerRef = step6.request.patterns.findIndex((p) => {
      const effSel = step6.request.catalog.effectSelections[p.effectSelectionRef!];
      return effSel.selectedValues.length === 0;
    });
    expect(zeroAttackerRef).toBeGreaterThanOrEqual(0);

    const step7 = session.submitDecision({
      decisionId: step6.request.decisionId,
      stateVersion: step6.request.stateVersion,
      selectedPatternRef: zeroAttackerRef,
    });

    // どのアタッカーも drive にならず、battle もセットされない
    const soldier1 = state.players.p1.field.find((u: any) => u.unitId === "soldier-1");
    const soldier2 = state.players.p1.field.find((u: any) => u.unitId === "soldier-2");
    expect(soldier1.state).toBe("charge");
    expect(soldier1.battle).toBeUndefined();
    expect(soldier2.state).toBe("charge");
    expect(soldier2.battle).toBeUndefined();

    // action.attack は resolved になる
    expect(state.stage.history.length).toBe(1);
    expect(state.stage.history[0].actionId).toBe("action.attack");
    expect(state.stage.history[0].status).toBe("resolved");

    // アタッカーが存在しないため block は誘発せず、requestBuffer / stage に block は積まれない
    expect(state.requestBuffer.requests.length).toBe(0);
    expect(state.stage.requests.length).toBe(0);
  });

  it("N2: when 0 legal attackers exist on field at resolution time, should automatically resolve without Decision", () => {
    const state = createBattleState();
    // p1 の全ユニットを drive 状態にする（合法アタッカー候補 0 体）
    for (const u of state.players.p1.field) {
      u.state = "drive";
    }

    const session = new GameSession(state, rulePackage);

    // アタックリクエスト → 全員PASS
    const step1 = session.advance();
    const req1 = getReq(step1);
    const attackPatternRef = req1.patterns.findIndex((p: any) => {
      const act = req1.catalog.actions[p.actionSelectionRef!];
      return act?.actionId === "action.attack";
    });
    session.submitDecision({ decisionId: req1.decisionId, stateVersion: req1.stateVersion, selectedPatternRef: attackPatternRef });

    const step3 = session.advance();
    const req3 = getReq(step3);
    session.submitDecision({ decisionId: req3.decisionId, stateVersion: req3.stateVersion, selectedPatternRef: req3.patterns.findIndex((p: any) => p.kind === "PASS") });

    const step5 = session.advance();
    const req5 = getReq(step5);
    const step6 = session.submitDecision({ decisionId: req5.decisionId, stateVersion: req5.stateVersion, selectedPatternRef: req5.patterns.findIndex((p: any) => p.kind === "PASS") });

    // EFFECT_RESOLUTION Decision で停止せず、自動的に解決完了すること
    expect(state.stage.history.length).toBe(1);
    expect(state.stage.history[0].actionId).toBe("action.attack");
    expect(state.stage.history[0].status).toBe("resolved");

    // block は誘発しない

    // block は誘発しない
    expect(state.requestBuffer.requests.length).toBe(0);
    expect(state.stage.requests.length).toBe(0);
  });

  it("P: FirstLegalPatternPolicy and RandomPolicy should seamlessly resolve EFFECT_RESOLUTION", async () => {
    // FirstLegalPatternPolicy による自動実行
    const state1 = createBattleState();
    const session1 = new GameSession(state1, rulePackage);
    const firstPolicy = new FirstLegalPatternPolicy();

    let step = session1.advance();
    for (let i = 0; i < 15; i++) {
      if (step.type !== "WAITING_FOR_DECISION") break;
      const resp = await firstPolicy.decide(step.request);
      step = session1.submitDecision(resp);
    }
    // エラーなく進行できること
    expect(session1.stateVersion).toBeGreaterThan(1);

    // RandomPolicy による自動実行
    const state2 = createBattleState();
    const session2 = new GameSession(state2, rulePackage);
    const randomPolicy = new RandomPolicy();

    let step2 = session2.advance();
    for (let i = 0; i < 15; i++) {
      if (step2.type !== "WAITING_FOR_DECISION") break;
      const resp = await randomPolicy.decide(step2.request);
      step2 = session2.submitDecision(resp);
    }
    expect(session2.stateVersion).toBeGreaterThan(1);
  });
});
