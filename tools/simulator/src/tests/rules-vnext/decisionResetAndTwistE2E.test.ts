import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage } from "../../domain/rules/RulePackage";
import { getCoreBattlePlaytestRulePackage, PLAYTEST_SUPPORTED_ACTION_IDS } from "../../engine/rules/RulePackageSelector";
import { createCoreBattlePresetState } from "../../engine/session/playtest/createCoreBattlePlaytest";
import { MatchSetupCoordinator } from "../../engine/session/setup/MatchSetupCoordinator";
import { GameSession } from "../../engine/session/GameSession";

describe("Phase 21B.6.2: Decision Reset, Twist LIFO & Up/Down Exposure E2E Tests", () => {
  let fullPackage: RulePackage;
  let playtestPackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    fullPackage = await loadRulePackageFromDirectory(rulesDir);
    playtestPackage = getCoreBattlePlaytestRulePackage(fullPackage);
  });

  it("6, 7: Playtest RulePackage includes action.up and action.down", () => {
    expect(PLAYTEST_SUPPORTED_ACTION_IDS.has("action.up")).toBe(true);
    expect(PLAYTEST_SUPPORTED_ACTION_IDS.has("action.down")).toBe(true);

    const actionIds = playtestPackage.actions.map((a) => a.id);
    expect(actionIds).toContain("action.attack");
    expect(actionIds).toContain("action.block");
    expect(actionIds).toContain("action.damageJudge");
    expect(actionIds).toContain("action.end");
    expect(actionIds).toContain("action.charge");
    expect(actionIds).toContain("action.draw");
    expect(actionIds).toContain("action.twist");
    expect(actionIds).toContain("action.up");
    expect(actionIds).toContain("action.down");
  });

  it("8, 9: CORE-BATTLE-001 initial state produces legal Up for Player A and legal Down for Player B", () => {
    const rawState = createCoreBattlePresetState();
    const setupResult = MatchSetupCoordinator.setupMatch(rawState);
    const session = new GameSession(setupResult.state, playtestPackage);

    // Turn 1 (Player A 手番): Player A は ♡3 と $D コスト用 ♢5 を手札に所持
    let step = session.advance();
    expect(step.type).toBe("WAITING_FOR_DECISION");
    if (step.type !== "WAITING_FOR_DECISION") return;

    const reqA = step.request;
    expect(reqA.playerId).toBe("p1");

    // 8. Player A に action.up の Legal Pattern が存在すること
    const upActionRef = reqA.catalog.actions.findIndex((a) => a.actionId === "action.up");
    expect(upActionRef).toBeGreaterThanOrEqual(0);
    const upPatterns = reqA.patterns.filter((p) => p.actionSelectionRef === upActionRef);
    expect(upPatterns.length).toBeGreaterThan(0);

    // Player A が PASS して Player B (チャンス) に移行
    const passRefA = reqA.patterns.findIndex((p) => p.kind === "PASS");
    step = session.submitDecision({
      decisionId: reqA.decisionId,
      stateVersion: reqA.stateVersion,
      selectedPatternRef: passRefA,
    });

    expect(step.type).toBe("WAITING_FOR_DECISION");
    if (step.type !== "WAITING_FOR_DECISION") return;
    const reqB = step.request;
    expect(reqB.playerId).toBe("p2");

    // 9. Player B (チャンス) は ♠2 と $D コスト用 ♢6 を手札に所持し、action.down の Legal Pattern が存在すること
    const downActionRef = reqB.catalog.actions.findIndex((a) => a.actionId === "action.down");
    expect(downActionRef).toBeGreaterThanOrEqual(0);
    const downPatterns = reqB.patterns.filter((p) => p.actionSelectionRef === downActionRef);
    expect(downPatterns.length).toBeGreaterThan(0);
  });

  it("2, 3, 4, 5, 8: Attack -> Quick Twist -> PASS/PASS -> Twist resolves, Attack stays, and no second Twist is auto-submitted", () => {
    const rawState = createCoreBattlePresetState();
    const setupResult = MatchSetupCoordinator.setupMatch(rawState);
    const session = new GameSession(setupResult.state, playtestPackage);
    const state = session.state;

    // Helper: PASS パターンの検索
    const findPassIndex = (req: any) => req.patterns.findIndex((p: any) => p.kind === "PASS");

    // Helper: Action パターンの検索
    const findActionPatternIndex = (req: any, actionId: string) => {
      return req.patterns.findIndex((p: any) => {
        if (p.actionSelectionRef === undefined) return false;
        const act = req.catalog.actions[p.actionSelectionRef];
        return act?.actionId === actionId;
      });
    };

    // 1. Turn 1 (Player A): アタックをリクエスト
    let step = session.advance();
    if (step.type !== "WAITING_FOR_DECISION") return;
    const reqAtk = step.request;
    const atkIdx = findActionPatternIndex(reqAtk, "action.attack");
    step = session.submitDecision({
      decisionId: reqAtk.decisionId,
      stateVersion: reqAtk.stateVersion,
      selectedPatternRef: atkIdx,
    });

    // Stage に [Attack (req-1)] が積まれ、Player A の PASS
    expect(state.stage.requests.length).toBe(1);
    expect(state.stage.requests[0].actionId).toBe("action.attack");

    if (step.type !== "WAITING_FOR_DECISION") return;
    const reqPassA1 = step.request;
    step = session.submitDecision({
      decisionId: reqPassA1.decisionId,
      stateVersion: reqPassA1.stateVersion,
      selectedPatternRef: findPassIndex(reqPassA1),
    });

    // 2. チャンスは Player B: Player B が Attack に対して Quick Twist をリクエスト！
    if (step.type !== "WAITING_FOR_DECISION") return;
    const reqTwistB = step.request;
    expect(reqTwistB.playerId).toBe("p2");

    // Player B の手札確認: [♠2 (Down), ♢6 (Twist Key), ♣3 ($D Cost)]
    const prevHandB = state.players.p2.hand.map((c: any) => c.id);
    expect(prevHandB).toContain("p2-h1"); // ♢6
    expect(prevHandB).toContain("p2-h2"); // ♣3

    const twistIdxB = reqTwistB.patterns.findIndex((p: any) => {
      if (p.actionSelectionRef === undefined) return false;
      const act = reqTwistB.catalog.actions[p.actionSelectionRef];
      if (act?.actionId !== "action.twist") return false;
      const target = p.targetSelectionRef !== undefined ? reqTwistB.catalog.targetSelections[p.targetSelectionRef] : undefined;
      const cost = p.costPaymentRef !== undefined ? reqTwistB.catalog.costPayments[p.costPaymentRef] : undefined;
      return target?.targetUnitId === "soldier-p2-1" && cost?.discardedCardIds?.includes("p2-h2");
    });
    expect(twistIdxB).toBeGreaterThanOrEqual(0);

    // 4. Twist リクエスト submit
    step = session.submitDecision({
      decisionId: reqTwistB.decisionId,
      stateVersion: reqTwistB.stateVersion,
      selectedPatternRef: twistIdxB,
    });

    // 4. リクエスト成立直後に $D コストカード (♣3 / p2-h2) は手札から即時除去されていること
    expect(state.players.p2.hand.some((c: any) => c.id === "p2-h2")).toBe(false);
    expect(state.players.p2.grave.some((u: any) => u.cards?.some((c: any) => c.id === "p2-h2"))).toBe(true);

    // Stage に [Attack (req-1), Twist (req-2)] が積載されている
    expect(state.stage.requests.length).toBe(2);
    expect(state.stage.requests[0].actionId).toBe("action.attack");
    expect(state.stage.requests[1].actionId).toBe("action.twist");
    expect(state.stage.requests[1].paidCostSummary).toBeDefined();

    // 5. Player B PASS -> Player A PASS で Stage TOP の Twist のみが解決される
    if (step.type !== "WAITING_FOR_DECISION") return;
    const reqPassB1 = step.request;
    step = session.submitDecision({
      decisionId: reqPassB1.decisionId,
      stateVersion: reqPassB1.stateVersion,
      selectedPatternRef: findPassIndex(reqPassB1),
    });

    if (step.type !== "WAITING_FOR_DECISION") return;
    const reqPassA2 = step.request;
    step = session.submitDecision({
      decisionId: reqPassA2.decisionId,
      stateVersion: reqPassA2.stateVersion,
      selectedPatternRef: findPassIndex(reqPassA2),
    });

    // 3. Twist 解決後:
    // - soldier-p2-1 が charge -> drive に切り替わる
    // - Stage には下の Attack (req-1) のみが残る
    // - コストカードは墓地に残ったままで refund されない
    // - chancePlayer が手番プレイヤー (Player A / p1) に戻る
    expect(state.players.p2.field.find((u: any) => u.unitId === "soldier-p2-1").state).toBe("drive");
    expect(state.stage.requests.length).toBe(1);
    expect(state.stage.requests[0].actionId).toBe("action.attack");
    expect(state.players.p2.hand.some((c: any) => c.id === "p2-h2")).toBe(false);
    expect(state.chancePlayer).toBe("p1");

    // 8. Twist 解決後に生成された新 Decision (Player A への ACTION_REQUEST)
    expect(step.type).toBe("WAITING_FOR_DECISION");
    if (step.type !== "WAITING_FOR_DECISION") return;
    const newReqA = step.request;
    expect(newReqA.playerId).toBe("p1");

    // 新 Decision では Stage に2つ目の Twist などが増えておらず、Attack が保留中
    expect(state.stage.requests.length).toBe(1);
  });
});
