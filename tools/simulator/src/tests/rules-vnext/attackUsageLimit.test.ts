import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { getCoreBattlePlaytestRulePackage } from "../../engine/rules/RulePackageSelector";
import { RulePackage } from "../../domain/rules/RulePackage";
import { GameSession } from "../../engine/session/GameSession";
import { createCoreBattlePresetState } from "../../engine/session/playtest/createCoreBattlePlaytest";
import { ActionRequestValidator, ValidationError } from "../../engine/rules/ActionRequestValidator";
import { CommandContext } from "../../engine/rules/CommandRegistry";

describe("Attack Usage Limit (1 Attack per Turn) Tests (Phase 21B.3)", () => {
  let rulePackage: RulePackage;
  const getReq = (step: any) => (step.type === "WAITING_FOR_DECISION" ? step.request : undefined);

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    const fullPackage = await loadRulePackageFromDirectory(rulesDir);
    rulePackage = getCoreBattlePlaytestRulePackage(fullPackage);
  });

  it("Test 1: should allow 1st Attack, but reject 2nd Attack in the same turn via LegalPatternGenerator and Validator", () => {
    const state = createCoreBattlePresetState();
    const session = new GameSession(state, rulePackage);

    // Turn 1 (Player A)
    const step1 = session.advance();
    expect(step1.type).toBe("WAITING_FOR_DECISION");
    const req1 = getReq(step1)!;

    const attackPatIdx = req1.patterns.findIndex((p: any) => {
      const act = req1.catalog.actions[p.actionSelectionRef!];
      return act?.actionId === "action.attack";
    });
    expect(attackPatIdx).toBeGreaterThanOrEqual(0);

    // 1回目アタックをリクエスト
    const step2 = session.submitDecision({
      decisionId: req1.decisionId,
      stateVersion: req1.stateVersion,
      selectedPatternRef: attackPatIdx,
    });

    // アタックがステージに積まれた時点で、turnUsage[p1]['action.attack'] === 1 になっている
    expect(session.state.turnUsage?.p1?.["action.attack"]).toBe(1);

    // 全員PASSしてアタックを解決
    const req2 = getReq(step2)!;
    const step3 = session.submitDecision({
      decisionId: req2.decisionId,
      stateVersion: req2.stateVersion,
      selectedPatternRef: req2.patterns.findIndex((p: any) => p.kind === "PASS"),
    });
    const req3 = getReq(step3)!;
    const step4 = session.submitDecision({
      decisionId: req3.decisionId,
      stateVersion: req3.stateVersion,
      selectedPatternRef: req3.patterns.findIndex((p: any) => p.kind === "PASS"),
    });

    // EFFECT_RESOLUTION (アタッカー選択: 全アタッカー指定)
    const req4 = getReq(step4)!;
    expect(req4.source.type).toBe("EFFECT_RESOLUTION");
    const step5 = session.submitDecision({
      decisionId: req4.decisionId,
      stateVersion: req4.stateVersion,
      selectedPatternRef: 0,
    });

    // ブロック & ダメージ判定の自動誘発を進行 (PASSで解決)
    let currentStep = step5;
    while (currentStep.type === "WAITING_FOR_DECISION") {
      const req = getReq(currentStep)!;
      // メインタイミングで Player A にチャンスが戻り、Stage が空になったらチェック
      if (req.playerId === "p1" && session.state.stage.requests.length === 0 && session.state.turnPlayer === "p1") {
        // 同ターン内で 2回目のアタックが候補に存在しないことを確認
        const attackAction = req.catalog.actions.find((a: any) => a.actionId === "action.attack");
        expect(attackAction).toBeUndefined();
        break;
      }
      const passIdx = req.patterns.findIndex((p: any) => p.kind === "PASS");
      currentStep = session.submitDecision({
        decisionId: req.decisionId,
        stateVersion: req.stateVersion,
        selectedPatternRef: passIdx !== -1 ? passIdx : 0,
      });
    }

    // Validator に直接 2回目の Attack を検証させた場合に例外が発生すること
    const attackDef = rulePackage.actions.find((a) => a.id === "action.attack")!;
    const validator = new ActionRequestValidator();
    const context: CommandContext = {
      state: session.state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };
    expect(() => validator.validateActionRequest(attackDef, context)).toThrow(ValidationError);
  });

  it("Test 2: partial Attack (attacking with only 1 of 2 soldiers) still consumes turn limit, preventing 2nd Attack with remaining soldier", () => {
    const state = createCoreBattlePresetState();
    const session = new GameSession(state, rulePackage);

    // Turn 1 (Player A)
    const step1 = session.advance();
    const req1 = getReq(step1)!;
    const attackPatIdx = req1.patterns.findIndex((p: any) => {
      const act = req1.catalog.actions[p.actionSelectionRef!];
      return act?.actionId === "action.attack";
    });

    const step2 = session.submitDecision({
      decisionId: req1.decisionId,
      stateVersion: req1.stateVersion,
      selectedPatternRef: attackPatIdx,
    });

    // PASS/PASS
    const req2 = getReq(step2)!;
    const step3 = session.submitDecision({
      decisionId: req2.decisionId,
      stateVersion: req2.stateVersion,
      selectedPatternRef: req2.patterns.findIndex((p: any) => p.kind === "PASS"),
    });
    const req3 = getReq(step3)!;
    const step4 = session.submitDecision({
      decisionId: req3.decisionId,
      stateVersion: req3.stateVersion,
      selectedPatternRef: req3.patterns.findIndex((p: any) => p.kind === "PASS"),
    });

    // EFFECT_RESOLUTION で 1体のみ指定するパターン（例: selectedValues.length === 1）を選択
    const req4 = getReq(step4)!;
    const singleAttackerPatIdx = req4.patterns.findIndex((p: any) => {
      const eff = req4.catalog.effectSelections[p.effectSelectionRef!];
      return eff?.selectedValues?.length === 1;
    });
    expect(singleAttackerPatIdx).toBeGreaterThanOrEqual(0);

    const step5 = session.submitDecision({
      decisionId: req4.decisionId,
      stateVersion: req4.stateVersion,
      selectedPatternRef: singleAttackerPatIdx,
    });

    // 戦闘を進行
    let currentStep = step5;
    while (currentStep.type === "WAITING_FOR_DECISION") {
      const req = getReq(currentStep)!;
      if (req.playerId === "p1" && session.state.stage.requests.length === 0 && session.state.turnPlayer === "p1") {
        // フィールドに charge 状態のもう1体の兵士が残っているが、2回目のアタックは候補に出ないこと
        const hasRemainingChargeSoldier = session.state.players.p1.field.some((u: any) => u.state === "charge");
        expect(hasRemainingChargeSoldier).toBe(true);

        const attackAction = req.catalog.actions.find((a: any) => a.actionId === "action.attack");
        expect(attackAction).toBeUndefined();
        break;
      }
      const passIdx = req.patterns.findIndex((p: any) => p.kind === "PASS");
      currentStep = session.submitDecision({
        decisionId: req.decisionId,
        stateVersion: req.stateVersion,
        selectedPatternRef: passIdx !== -1 ? passIdx : 0,
      });
    }
  });

  it("Test 3: 0-attacker Attack still consumes turn limit, and Attack becomes legal again on next own turn (Turn 3)", () => {
    const state = createCoreBattlePresetState();
    const session = new GameSession(state, rulePackage);

    // Turn 1 (Player A) - 0体アタック
    const step1 = session.advance();
    const req1 = getReq(step1)!;
    const attackPatIdx = req1.patterns.findIndex((p: any) => {
      const act = req1.catalog.actions[p.actionSelectionRef!];
      return act?.actionId === "action.attack";
    });

    const step2 = session.submitDecision({
      decisionId: req1.decisionId,
      stateVersion: req1.stateVersion,
      selectedPatternRef: attackPatIdx,
    });

    // PASS/PASS
    const req2 = getReq(step2)!;
    const step3 = session.submitDecision({
      decisionId: req2.decisionId,
      stateVersion: req2.stateVersion,
      selectedPatternRef: req2.patterns.findIndex((p: any) => p.kind === "PASS"),
    });
    const req3 = getReq(step3)!;
    const step4 = session.submitDecision({
      decisionId: req3.decisionId,
      stateVersion: req3.stateVersion,
      selectedPatternRef: req3.patterns.findIndex((p: any) => p.kind === "PASS"),
    });

    // EFFECT_RESOLUTION で 0体指定（selectedValues: []）を選択
    const req4 = getReq(step4)!;
    const zeroAttackerPatIdx = req4.patterns.findIndex((p: any) => {
      const eff = req4.catalog.effectSelections[p.effectSelectionRef!];
      return eff?.selectedValues?.length === 0;
    });
    expect(zeroAttackerPatIdx).toBeGreaterThanOrEqual(0);

    const step5 = session.submitDecision({
      decisionId: req4.decisionId,
      stateVersion: req4.stateVersion,
      selectedPatternRef: zeroAttackerPatIdx,
    });

    // 解決後、Player A のメインタイミングに戻る
    const req5 = getReq(step5)!;
    expect(req5.playerId).toBe("p1");
    // 0体アタック後でも当ターンのアタックは使用済み
    expect(req5.catalog.actions.find((a: any) => a.actionId === "action.attack")).toBeUndefined();

    // Player A がエンドを宣言してターン終了 -> Turn 2 (Player B) へ
    const endPatIdx = req5.patterns.findIndex((p: any) => {
      const act = req5.catalog.actions[p.actionSelectionRef!];
      return act?.actionId === "action.end";
    });
    const step6 = session.submitDecision({
      decisionId: req5.decisionId,
      stateVersion: req5.stateVersion,
      selectedPatternRef: endPatIdx,
    });

    // Turn 2 (Player B) の進行
    let currentStep = step6;
    while (currentStep.type === "WAITING_FOR_DECISION") {
      const req = getReq(currentStep)!;
      // Player B がエンド宣言できる状態になったらエンド
      if (req.playerId === "p2" && session.state.stage.requests.length === 0 && session.state.turnPlayer === "p2") {
        const p2EndIdx = req.patterns.findIndex((p: any) => {
          const act = req.catalog.actions[p.actionSelectionRef!];
          return act?.actionId === "action.end";
        });
        currentStep = session.submitDecision({
          decisionId: req.decisionId,
          stateVersion: req.stateVersion,
          selectedPatternRef: p2EndIdx,
        });
        break;
      }
      const passIdx = req.patterns.findIndex((p: any) => p.kind === "PASS");
      currentStep = session.submitDecision({
        decisionId: req.decisionId,
        stateVersion: req.stateVersion,
        selectedPatternRef: passIdx !== -1 ? passIdx : 0,
      });
    }

    // Turn 3 (Player A の手番) まで進行
    while (currentStep.type === "WAITING_FOR_DECISION") {
      const req = getReq(currentStep)!;
      if (req.playerId === "p1" && session.state.stage.requests.length === 0 && session.state.turnPlayer === "p1") {
        // Turn 3 では Player A の Attack が再び合法になっていること！
        expect(session.state.turnCount).toBe(3);
        const attackAction = req.catalog.actions.find((a: any) => a.actionId === "action.attack");
        expect(attackAction).toBeDefined();
        break;
      }
      const passIdx = req.patterns.findIndex((p: any) => p.kind === "PASS");
      currentStep = session.submitDecision({
        decisionId: req.decisionId,
        stateVersion: req.stateVersion,
        selectedPatternRef: passIdx !== -1 ? passIdx : 0,
      });
    }
  });
});
