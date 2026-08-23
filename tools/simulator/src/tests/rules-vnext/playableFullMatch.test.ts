import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage } from "../../domain/rules/RulePackage";
import { GameSession } from "../../engine/session/GameSession";
import { createCoreBattlePresetState } from "../../engine/session/playtest/createCoreBattlePlaytest";
import { getPlaytestRulePackage } from "../../engine/rules/BrowserRuleLoader";

describe("Core Battle Playtest: Full Match Integration Test (Phase 21B)", () => {
  let rulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    const fullPackage = await loadRulePackageFromDirectory(rulesDir);
    rulePackage = getPlaytestRulePackage(fullPackage);
  });

  // Helper: 指定した Action ID のパターンインデックスを検索
  const findActionPatternIndex = (req: any, actionId: string): number => {
    return req.patterns.findIndex((p: any) => {
      if (p.actionSelectionRef === undefined) return false;
      const act = req.catalog.actions[p.actionSelectionRef];
      return act?.actionId === actionId;
    });
  };

  // Helper: PASS パターンのインデックスを検索
  const findPassPatternIndex = (req: any): number => {
    return req.patterns.findIndex((p: any) => p.kind === "PASS");
  };

  it("Full Match: Turn 1 (Attack/Block/DamageJudge/End) -> Turn 2 (Charge/Draw/Quick Twist/Attack/End) -> Turn 3 (Direct Damage -> Life 0 -> FINISHED)", () => {
    const state = createCoreBattlePresetState();
    const session = new GameSession(state, rulePackage);

    // =========================================================================
    // TURN 1: Player A (p1)
    // =========================================================================
    let step = session.advance();
    expect(step.type).toBe("WAITING_FOR_DECISION");
    if (step.type !== "WAITING_FOR_DECISION") return;
    const req1 = step.request;
    expect(req1.playerId).toBe("p1");

    // 1. p1 が アタック をリクエスト
    const atkIdx = findActionPatternIndex(req1, "action.attack");
    expect(atkIdx).toBeGreaterThanOrEqual(0);
    step = session.submitDecision({
      decisionId: req1.decisionId,
      stateVersion: req1.stateVersion,
      selectedPatternRef: atkIdx,
    });

    // p1 PASS
    if (step.type !== "WAITING_FOR_DECISION") return;
    const reqPass1 = step.request;
    expect(reqPass1.playerId).toBe("p1");
    step = session.submitDecision({
      decisionId: reqPass1.decisionId,
      stateVersion: reqPass1.stateVersion,
      selectedPatternRef: findPassPatternIndex(reqPass1),
    });

    // p2 PASS
    if (step.type !== "WAITING_FOR_DECISION") return;
    const reqPass2 = step.request;
    expect(reqPass2.playerId).toBe("p2");
    step = session.submitDecision({
      decisionId: reqPass2.decisionId,
      stateVersion: reqPass2.stateVersion,
      selectedPatternRef: findPassPatternIndex(reqPass2),
    });

    // アタック解決: EFFECT_RESOLUTION (アタッカー選択: soldier-p1-1 と soldier-p1-2)
    expect(step.type).toBe("WAITING_FOR_DECISION");
    if (step.type !== "WAITING_FOR_DECISION") return;
    const reqAtkSel = step.request;
    expect(reqAtkSel.source?.type).toBe("EFFECT_RESOLUTION");

    // 全アタッカー（soldier-p1-1, soldier-p1-2）を選択するパターンを検索
    const selectAllAtkPattern = reqAtkSel.patterns.findIndex((p: any) => {
      const sel = reqAtkSel.catalog.effectSelections[p.effectSelectionRef!];
      return Array.isArray(sel?.selectedValues) && sel.selectedValues.includes("soldier-p1-1") && sel.selectedValues.includes("soldier-p1-2");
    });
    expect(selectAllAtkPattern).toBeGreaterThanOrEqual(0);

    step = session.submitDecision({
      decisionId: reqAtkSel.decisionId,
      stateVersion: reqAtkSel.stateVersion,
      selectedPatternRef: selectAllAtkPattern,
    });

    // アタック解決完了 -> Block が Stage に積まれ、チャンスは p1 (対応機会)
    expect(state.stage.requests.length).toBe(1);
    expect(state.stage.requests[0].actionId).toBe("action.block");
    if (step.type !== "WAITING_FOR_DECISION") return;
    const reqBlockPass1 = step.request;
    expect(reqBlockPass1.playerId).toBe("p1");

    // p1 PASS (対応なし)
    step = session.submitDecision({
      decisionId: reqBlockPass1.decisionId,
      stateVersion: reqBlockPass1.stateVersion,
      selectedPatternRef: findPassPatternIndex(reqBlockPass1),
    });

    // p2 PASS -> 連続PASS成立で Block 解決へ
    if (step.type !== "WAITING_FOR_DECISION") return;
    const reqBlockPass2 = step.request;
    expect(reqBlockPass2.playerId).toBe("p2");
    step = session.submitDecision({
      decisionId: reqBlockPass2.decisionId,
      stateVersion: reqBlockPass2.stateVersion,
      selectedPatternRef: findPassPatternIndex(reqBlockPass2),
    });

    // Block 解決: EFFECT_RESOLUTION (ブロッカー選択: soldier-p2-1 で soldier-p1-1 をブロック)
    expect(step.type).toBe("WAITING_FOR_DECISION");
    if (step.type !== "WAITING_FOR_DECISION") return;
    const reqBlockSel = step.request;
    expect(reqBlockSel.source?.type).toBe("EFFECT_RESOLUTION");

    const blockAssignmentPattern = reqBlockSel.patterns.findIndex((p: any) => {
      const sel = reqBlockSel.catalog.effectSelections[p.effectSelectionRef!];
      return (
        Array.isArray(sel?.assignments) &&
        sel.assignments.some(
          (a: any) => a.sourceUnitId === "soldier-p1-1" && a.selectedUnitIds.includes("soldier-p2-1")
        ) &&
        sel.assignments.some(
          (a: any) => a.sourceUnitId === "soldier-p1-2" && a.selectedUnitIds.length === 0
        )
      );
    });
    expect(blockAssignmentPattern).toBeGreaterThanOrEqual(0);

    step = session.submitDecision({
      decisionId: reqBlockSel.decisionId,
      stateVersion: reqBlockSel.stateVersion,
      selectedPatternRef: blockAssignmentPattern,
    });

    // Block 解決完了 -> DamageJudge が Stage に積まれる
    expect(state.stage.requests.length).toBe(1);
    expect(state.stage.requests[0].actionId).toBe("action.damageJudge");

    // p1 PASS -> p2 PASS で DamageJudge 解決
    if (step.type !== "WAITING_FOR_DECISION") return;
    const reqDjPass1 = step.request;
    step = session.submitDecision({
      decisionId: reqDjPass1.decisionId,
      stateVersion: reqDjPass1.stateVersion,
      selectedPatternRef: findPassPatternIndex(reqDjPass1),
    });

    if (step.type !== "WAITING_FOR_DECISION") return;
    const reqDjPass2 = step.request;
    step = session.submitDecision({
      decisionId: reqDjPass2.decisionId,
      stateVersion: reqDjPass2.stateVersion,
      selectedPatternRef: findPassPatternIndex(reqDjPass2),
    });

    // DamageJudge 解決結果の検証:
    // 1. soldier-p1-1 (6) vs soldier-p2-1 (6) -> 相打ちで双方が墓地へ
    expect(state.players.p1.grave.some((u: any) => u.unitId === "soldier-p1-1")).toBe(true);
    expect(state.players.p2.grave.some((u: any) => u.unitId === "soldier-p2-1")).toBe(true);
    // 2. soldier-p1-2 (5) vs 未ブロック -> p2 への直接ダメージ (Life 8 - 5 = 3枚)
    expect(state.players.p2.life.length).toBe(3);
    expect(state.stage.requests.length).toBe(0);

    // p1 が End をリクエスト
    if (step.type !== "WAITING_FOR_DECISION") return;
    const reqEnd1 = step.request;
    expect(reqEnd1.playerId).toBe("p1");
    const endIdx1 = findActionPatternIndex(reqEnd1, "action.end");
    step = session.submitDecision({
      decisionId: reqEnd1.decisionId,
      stateVersion: reqEnd1.stateVersion,
      selectedPatternRef: endIdx1,
    });

    // p1 PASS -> p2 PASS で End 解決
    if (step.type !== "WAITING_FOR_DECISION") return;
    const reqEndPass1 = step.request;
    step = session.submitDecision({
      decisionId: reqEndPass1.decisionId,
      stateVersion: reqEndPass1.stateVersion,
      selectedPatternRef: findPassPatternIndex(reqEndPass1),
    });

    if (step.type !== "WAITING_FOR_DECISION") return;
    const reqEndPass2 = step.request;
    step = session.submitDecision({
      decisionId: reqEndPass2.decisionId,
      stateVersion: reqEndPass2.stateVersion,
      selectedPatternRef: findPassPatternIndex(reqEndPass2),
    });

    // =========================================================================
    // TURN 2: Player B (p2)
    // =========================================================================
    // End 解決 -> turnPlayer が p2 へ交代
    expect(state.turnPlayer).toBe("p2");
    // Charge 即時解決 (p2 の soldier-p2-2 と bw-p2 が charge 状態)
    expect(state.players.p2.field.find((u: any) => u.unitId === "soldier-p2-2").state).toBe("charge");
    expect(state.players.p2.field.find((u: any) => u.unitId === "bw-p2").state).toBe("charge");

    // Draw が Stage に積まれ、チャンスは p1 (新 NTP)
    expect(state.stage.requests.length).toBe(1);
    expect(state.stage.requests[0].actionId).toBe("action.draw");
    expect(state.chancePlayer).toBe("p1");

    // p1 が Draw に対して Quick アクション「ツイスト」（対象: bw-p1）をリクエスト！
    if (step.type !== "WAITING_FOR_DECISION") return;
    const reqTwist = step.request;
    const twistPatternIdx = reqTwist.patterns.findIndex((p: any) => {
      if (p.actionSelectionRef === undefined) return false;
      const act = reqTwist.catalog.actions[p.actionSelectionRef];
      if (act?.actionId !== "action.twist") return false;
      const target =
        p.targetSelectionRef !== undefined ? reqTwist.catalog.targetSelections[p.targetSelectionRef] : undefined;
      return target?.targetUnitId === "bw-p1";
    });
    expect(twistPatternIdx).toBeGreaterThanOrEqual(0);

    step = session.submitDecision({
      decisionId: reqTwist.decisionId,
      stateVersion: reqTwist.stateVersion,
      selectedPatternRef: twistPatternIdx,
    });

    // Stage に [Draw (req-1), Twist (req-2)] が積まれている
    expect(state.stage.requests.length).toBe(2);
    expect(state.stage.requests[1].actionId).toBe("action.twist");

    // p1 PASS -> p2 PASS で Twist が先に解決 (LIFO)
    if (step.type !== "WAITING_FOR_DECISION") return;
    const reqTwistPass1 = step.request;
    step = session.submitDecision({
      decisionId: reqTwistPass1.decisionId,
      stateVersion: reqTwistPass1.stateVersion,
      selectedPatternRef: findPassPatternIndex(reqTwistPass1),
    });

    if (step.type !== "WAITING_FOR_DECISION") return;
    const reqTwistPass2 = step.request;
    step = session.submitDecision({
      decisionId: reqTwistPass2.decisionId,
      stateVersion: reqTwistPass2.stateVersion,
      selectedPatternRef: findPassPatternIndex(reqTwistPass2),
    });

    // Twist 解決後: bw-p1 が charge -> drive に切り替わり、Stage には Draw のみ
    expect(state.players.p1.field.find((u: any) => u.unitId === "bw-p1").state).toBe("drive");
    expect(state.stage.requests.length).toBe(1);
    expect(state.stage.requests[0].actionId).toBe("action.draw");

    // p2 PASS -> p1 PASS で Draw 解決
    if (step.type !== "WAITING_FOR_DECISION") return;
    const reqDrawPass1 = step.request;
    step = session.submitDecision({
      decisionId: reqDrawPass1.decisionId,
      stateVersion: reqDrawPass1.stateVersion,
      selectedPatternRef: findPassPatternIndex(reqDrawPass1),
    });

    if (step.type !== "WAITING_FOR_DECISION") return;
    const reqDrawPass2 = step.request;
    step = session.submitDecision({
      decisionId: reqDrawPass2.decisionId,
      stateVersion: reqDrawPass2.stateVersion,
      selectedPatternRef: findPassPatternIndex(reqDrawPass2),
    });

    // Draw 解決後: p2 のライフは 3枚 (>2) だったので 2枚引いて残り 1枚、手札 4枚 (初期2枚 + 2枚)
    expect(state.players.p2.hand.length).toBe(4);
    expect(state.players.p2.life.length).toBe(1);
    expect(state.chancePlayer).toBe("p2");

    // p2 が End をリクエスト
    if (step.type !== "WAITING_FOR_DECISION") return;
    const reqEnd2 = step.request;
    const endIdx2 = findActionPatternIndex(reqEnd2, "action.end");
    step = session.submitDecision({
      decisionId: reqEnd2.decisionId,
      stateVersion: reqEnd2.stateVersion,
      selectedPatternRef: endIdx2,
    });

    // p2 PASS -> p1 PASS で End 解決
    if (step.type !== "WAITING_FOR_DECISION") return;
    const reqEndPass3 = step.request;
    step = session.submitDecision({
      decisionId: reqEndPass3.decisionId,
      stateVersion: reqEndPass3.stateVersion,
      selectedPatternRef: findPassPatternIndex(reqEndPass3),
    });

    if (step.type !== "WAITING_FOR_DECISION") return;
    const reqEndPass4 = step.request;
    step = session.submitDecision({
      decisionId: reqEndPass4.decisionId,
      stateVersion: reqEndPass4.stateVersion,
      selectedPatternRef: findPassPatternIndex(reqEndPass4),
    });

    // =========================================================================
    // TURN 3: Player A (p1)
    // =========================================================================
    // ターン交代 -> p1
    expect(state.turnPlayer).toBe("p1");
    // Charge 即時解決 (soldier-p1-2 と bw-p1 が charge 状態に復帰)
    expect(state.players.p1.field.find((u: any) => u.unitId === "soldier-p1-2").state).toBe("charge");
    expect(state.players.p1.field.find((u: any) => u.unitId === "bw-p1").state).toBe("charge");

    // Draw が Stage に積まれる -> p2 PASS -> p1 PASS で Draw 解決
    if (step.type !== "WAITING_FOR_DECISION") return;
    const reqDrawPass3 = step.request;
    step = session.submitDecision({
      decisionId: reqDrawPass3.decisionId,
      stateVersion: reqDrawPass3.stateVersion,
      selectedPatternRef: findPassPatternIndex(reqDrawPass3),
    });

    if (step.type !== "WAITING_FOR_DECISION") return;
    const reqDrawPass4 = step.request;
    step = session.submitDecision({
      decisionId: reqDrawPass4.decisionId,
      stateVersion: reqDrawPass4.stateVersion,
      selectedPatternRef: findPassPatternIndex(reqDrawPass4),
    });

    // p1 の手札増加 & ライフ 6枚
    expect(state.players.p1.life.length).toBe(6);

    // p1 が アタック をリクエスト
    if (step.type !== "WAITING_FOR_DECISION") return;
    const reqAtk3 = step.request;
    const atkIdx3 = findActionPatternIndex(reqAtk3, "action.attack");
    step = session.submitDecision({
      decisionId: reqAtk3.decisionId,
      stateVersion: reqAtk3.stateVersion,
      selectedPatternRef: atkIdx3,
    });

    // p1 PASS -> p2 PASS で アタック解決へ
    if (step.type !== "WAITING_FOR_DECISION") return;
    const reqAtkPass1 = step.request;
    step = session.submitDecision({
      decisionId: reqAtkPass1.decisionId,
      stateVersion: reqAtkPass1.stateVersion,
      selectedPatternRef: findPassPatternIndex(reqAtkPass1),
    });

    if (step.type !== "WAITING_FOR_DECISION") return;
    const reqAtkPass2 = step.request;
    step = session.submitDecision({
      decisionId: reqAtkPass2.decisionId,
      stateVersion: reqAtkPass2.stateVersion,
      selectedPatternRef: findPassPatternIndex(reqAtkPass2),
    });

    // アタッカー選択 (soldier-p1-2 [♡5])
    expect(step.type).toBe("WAITING_FOR_DECISION");
    if (step.type !== "WAITING_FOR_DECISION") return;
    const reqAtkSel2 = step.request;
    const selectAtk2Pattern = reqAtkSel2.patterns.findIndex((p: any) => {
      const sel = reqAtkSel2.catalog.effectSelections[p.effectSelectionRef!];
      return Array.isArray(sel?.selectedValues) && sel.selectedValues.includes("soldier-p1-2");
    });
    step = session.submitDecision({
      decisionId: reqAtkSel2.decisionId,
      stateVersion: reqAtkSel2.stateVersion,
      selectedPatternRef: selectAtk2Pattern,
    });

    // Block が Stage に積まれる -> p1 PASS -> p2 PASS
    if (step.type !== "WAITING_FOR_DECISION") return;
    const reqBlockPass3 = step.request;
    step = session.submitDecision({
      decisionId: reqBlockPass3.decisionId,
      stateVersion: reqBlockPass3.stateVersion,
      selectedPatternRef: findPassPatternIndex(reqBlockPass3),
    });

    if (step.type !== "WAITING_FOR_DECISION") return;
    const reqBlockPass4 = step.request;
    step = session.submitDecision({
      decisionId: reqBlockPass4.decisionId,
      stateVersion: reqBlockPass4.stateVersion,
      selectedPatternRef: findPassPatternIndex(reqBlockPass4),
    });

    // ブロッカー選択 (p2 はブロックせず 0体選択 [])
    expect(step.type).toBe("WAITING_FOR_DECISION");
    if (step.type !== "WAITING_FOR_DECISION") return;
    const reqBlockSel2 = step.request;
    const selectNoBlockPattern = reqBlockSel2.patterns.findIndex((p: any) => {
      const sel = reqBlockSel2.catalog.effectSelections[p.effectSelectionRef!];
      return Array.isArray(sel?.assignments) && sel.assignments.every((a: any) => a.selectedUnitIds.length === 0);
    });
    step = session.submitDecision({
      decisionId: reqBlockSel2.decisionId,
      stateVersion: reqBlockSel2.stateVersion,
      selectedPatternRef: selectNoBlockPattern,
    });

    // DamageJudge が Stage に積まれる -> p1 PASS -> p2 PASS
    if (step.type !== "WAITING_FOR_DECISION") return;
    const reqDjPass3 = step.request;
    step = session.submitDecision({
      decisionId: reqDjPass3.decisionId,
      stateVersion: reqDjPass3.stateVersion,
      selectedPatternRef: findPassPatternIndex(reqDjPass3),
    });

    if (step.type !== "WAITING_FOR_DECISION") return;
    const reqDjPass4 = step.request;
    step = session.submitDecision({
      decisionId: reqDjPass4.decisionId,
      stateVersion: reqDjPass4.stateVersion,
      selectedPatternRef: findPassPatternIndex(reqDjPass4),
    });

    // 未ブロック攻撃 (size 5) が p2 のライフ (残り 1枚) に直撃しライフ0！
    expect(state.players.p2.life.length).toBe(0);

    // ゲーム終了 (FINISHED) となり、Player A (p1) が勝者となる！
    expect(step.type).toBe("FINISHED");
    if (step.type === "FINISHED") {
      expect(step.result.winner).toBe("p1");
      expect(step.result.reason).toBeDefined();
    }
  });
});
