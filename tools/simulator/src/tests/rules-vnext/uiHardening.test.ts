import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage } from "../../domain/rules/RulePackage";
import { CostPaymentEnumerator } from "../../engine/decision/CostPaymentEnumerator";
import { TargetSelectionEnumerator } from "../../engine/decision/TargetSelectionEnumerator";
import { GameSession } from "../../engine/session/GameSession";
import { createCoreBattlePresetState } from "../../engine/session/playtest/createCoreBattlePlaytest";

describe("Phase 21B.2: UI/UX Hardening & Bug Fix Tests", () => {
  let rulePackage: RulePackage;
  const getReq = (step: any) => (step.type === "WAITING_FOR_DECISION" ? step.request : undefined);

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  describe("P0-1: コスト候補表示と手札の一致", () => {
    it("手札破棄コストのサマリーにスート記号とランクが表示されること ($D 表記)", () => {
      const mockPlayer = {
        hand: [
          { id: "p1-h1", suit: "D", rank: "5", value: 5 },
          { id: "p1-h2", suit: "C", rank: "2", value: 2 },
        ],
        field: [],
        life: 5,
      };

      const payments = CostPaymentEnumerator.enumeratePayments("D", mockPlayer);
      expect(payments.length).toBe(2);

      const summaries = payments.map((p) => p.summary);
      expect(summaries).toContain("$D (♢5 破棄)");
      expect(summaries).toContain("$D (♣2 破棄)");
      expect(summaries.some((s) => s.includes("p1-h"))).toBe(false);
    });
  });

  describe("P0-3: アタック多重実行防止・アタッカー候補検証", () => {
    it("EFFECT_RESOLUTION のアタッカー選択で、drive 状態のユニットは候補から除外され charge 状態のユニットのみが選択肢となること", () => {
      const state = createCoreBattlePresetState();
      const session = new GameSession(state, rulePackage);

      // p1 の 1体目を drive にする
      state.players.p1.field[0].state = "drive";
      // 2体目 (p1-2, ♣6) のみ charge
      state.players.p1.field[1].state = "charge";

      const step1 = session.advance();
      expect(step1.type).toBe("WAITING_FOR_DECISION");
      const req1 = getReq(step1)!;

      // アタックをリクエスト
      const attackPatIdx = req1.patterns.findIndex((p: any) => {
        const act = req1.catalog.actions[p.actionSelectionRef!];
        return act?.actionId === "action.attack";
      });
      const step2 = session.submitDecision({
        decisionId: req1.decisionId,
        stateVersion: req1.stateVersion,
        selectedPatternRef: attackPatIdx,
      });

      const req2 = getReq(step2)!;
      // 全員PASS
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

      // EFFECT_RESOLUTION が発生
      expect(step4.type).toBe("WAITING_FOR_DECISION");
      const req4 = getReq(step4)!;
      expect(req4.source.type).toBe("EFFECT_RESOLUTION");

      // 選択肢に drive ユニット (p1-1) 単独のアタック候補は存在せず、charge ユニット (p1-2) のみが候補に含まれる
      const effSelections = req4.catalog.effectSelections;
      for (const sel of effSelections) {
        if (sel.selectedValues && sel.selectedValues.length > 0) {
          expect(sel.selectedValues).not.toContain(state.players.p1.field[0].unitId);
        }
      }
    });
  });

  describe("P0-4: ツイストのStage積載と2人連続PASSによる解決フロー", () => {
    it("ツイストがStageに積まれ、PASS/PASSで正常解決されてユニット状態がトグルされること", () => {
      const state = createCoreBattlePresetState();
      const session = new GameSession(state, rulePackage);

      // Player A が ツイスト を持っている状態にする (手札に ♣2 がある)
      state.turnPlayer = "p1";
      state.chancePlayer = "p1";
      state.stage = { requests: [], history: [] };

      // 対象とする Player B の一般兵
      const targetUnit = state.players.p2.field.find((u: any) => u.componentId === "character.soldier");
      expect(targetUnit).toBeDefined();
      expect(targetUnit.state).toBe("charge");

      const step1 = session.advance();
      expect(step1.type).toBe("WAITING_FOR_DECISION");
      const req1 = getReq(step1)!;

      // ツイストのリクエストを探す
      const twistPatIdx = req1.patterns.findIndex((p: any) => {
        if (p.actionSelectionRef === undefined) return false;
        const act = req1.catalog.actions[p.actionSelectionRef];
        if (act?.actionId !== "action.twist") return false;
        const tgt = req1.catalog.targetSelections[p.targetSelectionRef!];
        return tgt?.targetUnitId === targetUnit.unitId;
      });
      expect(twistPatIdx).toBeGreaterThanOrEqual(0);

      // 1. Player A が ツイスト をリクエスト
      const step2 = session.submitDecision({
        decisionId: req1.decisionId,
        stateVersion: req1.stateVersion,
        selectedPatternRef: twistPatIdx,
      });

      // ツイストが Stage に積まれていること
      expect(session.state.stage.requests.length).toBe(1);
      expect(session.state.stage.requests[0].actionId).toBe("action.twist");

      // 2. Player A が PASS (相手にチャンスを渡す)
      expect(step2.type).toBe("WAITING_FOR_DECISION");
      const req2 = getReq(step2)!;
      expect(req2.playerId).toBe("p1");
      const passAIdx = req2.patterns.findIndex((p: any) => p.kind === "PASS");

      const step3 = session.submitDecision({
        decisionId: req2.decisionId,
        stateVersion: req2.stateVersion,
        selectedPatternRef: passAIdx,
      });

      // チャンスが Player B に渡る
      expect(step3.type).toBe("WAITING_FOR_DECISION");
      const req3 = getReq(step3)!;
      expect(req3.playerId).toBe("p2");
      expect(session.state.stage.requests.length).toBe(1); // ツイストはまだ Stage にある

      // 3. Player B が PASS (2人連続PASS成立 -> ツイストが解決される)
      const passBIdx = req3.patterns.findIndex((p: any) => p.kind === "PASS");
      session.submitDecision({
        decisionId: req3.decisionId,
        stateVersion: req3.stateVersion,
        selectedPatternRef: passBIdx,
      });

      // ツイストが解決され、Stage から取り除かれ history に入る
      expect(session.state.stage.requests.length).toBe(0);
      expect(session.state.stage.history.length).toBe(1);
      expect(session.state.stage.history[0].actionId).toBe("action.twist");

      // 対象ユニットが drive に切り替わっていること
      expect(targetUnit.state).toBe("drive");
    });
  });

  describe("P1-2: 対象選択肢の人道的ラベル化", () => {
    it("ユニット対象の displayName にプレイヤー名、種別、カード、状態、IDが含まれること", () => {
      const state = createCoreBattlePresetState();
      const twistAction = rulePackage.actions.find((a) => a.id === "action.twist")!;

      const targets = TargetSelectionEnumerator.enumerateTargets(
        twistAction,
        state,
        "p1",
        rulePackage.components
      );

      expect(targets.length).toBeGreaterThan(0);
      for (const tgt of targets) {
        expect(tgt.displayName).toMatch(/Player (A|B)/);
        expect(tgt.displayName).toMatch(/(一般兵|防壁)/);
        expect(tgt.displayName).toMatch(/\((charge|drive)\)/);
      }
    });

    it("裏向き防壁の対象選択肢でカード内容が隠蔽 (🂠) されること", () => {
      const state = createCoreBattlePresetState();
      const destroyBulwarkAction = rulePackage.actions.find((a) => a.id === "action.destroyBulwark");
      if (destroyBulwarkAction) {
        const targets = TargetSelectionEnumerator.enumerateTargets(
          destroyBulwarkAction,
          state,
          "p1",
          rulePackage.components
        );
        const bulwarkTarget = targets.find((t) => t.displayName?.includes("防壁"));
        if (bulwarkTarget) {
          expect(bulwarkTarget.displayName).toContain("🂠");
        }
      }
    });
  });
});
