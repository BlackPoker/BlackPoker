import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage } from "../../domain/rules/RulePackage";
import { LegalPatternGenerator } from "../../engine/decision/LegalPatternGenerator";
import { PatternExecutor } from "../../engine/decision/PatternExecutor";
import { CommandRegistry } from "../../engine/rules/CommandRegistry";
import { TurnManager } from "../../engine/rules/TurnManager";
import { DecisionResponse } from "../../domain/decision/DecisionResponse";

describe("PatternExecutor Integration Tests", () => {
  let rulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  it("should discard the explicitly chosen cost card and keep other cards in hand (16.3)", () => {
    // 盤面：
    // 手札: [♡7(キー), ♣2(捨て札候補A), ♢3(捨て札候補B)]
    // 場: 兵士1体 (サイズ6)
    const soldier = {
      unitId: "soldier-1",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "c1", suit: "S", rank: "6", value: 6 }],
      labels: ["攻撃", "防御"],
    };

    const state = {
      players: {
        p1: {
          name: "Player A",
          life: 16,
          hand: [
            { id: "key-h7", suit: "H", rank: "7", value: 7 },
            { id: "cost-c2", suit: "C", rank: "2", value: 2 },
            { id: "cost-d3", suit: "D", rank: "3", value: 3 },
          ],
          field: [soldier],
          fog: [],
          grave: [],
        },
        p2: {
          name: "Player B",
          life: 16,
          hand: [],
          field: [],
          fog: [],
          grave: [],
        },
      },
      stage: { requests: [] },
    } as Record<string, any>;

    TurnManager.initializeToMain(state, "p1");
    const registry = new CommandRegistry();

    const { request } = LegalPatternGenerator.generateActionRequestDecision(state, "p1", rulePackage);

    const upActionRef = request.catalog.actions.findIndex((a) => a.actionId === "action.up");
    expect(upActionRef).toBeGreaterThanOrEqual(0);

    // 「action.up」かつ「♣2 を捨てる」パターンを探す
    const targetPatternIndex = request.patterns.findIndex((p) => {
      if (p.actionSelectionRef !== upActionRef) return false;
      const costSel = request.catalog.costPayments[p.costPaymentRef!];
      return costSel.discardedCardIds.includes("cost-c2");
    });

    expect(targetPatternIndex).toBeGreaterThanOrEqual(0);

    const response: DecisionResponse = {
      decisionId: request.decisionId,
      stateVersion: request.stateVersion,
      selectedPatternRef: targetPatternIndex,
    };

    // 実行
    const { actionRequest } = PatternExecutor.executeResponse(
      request,
      response,
      state,
      rulePackage,
      registry
    );

    expect(actionRequest.status).toBe("resolved");

    // 検証：
    // 1. ♣2 (cost-c2) が墓地に移動していること
    expect(state.players.p1.grave.some((u: any) => u.cards.some((c: any) => c.id === "cost-c2"))).toBe(true);

    // 2. ♢3 (cost-d3) は手札に残っていること
    expect(state.players.p1.hand.some((c: any) => c.id === "cost-d3")).toBe(true);

    // 3. キーカード ♡7 (key-h7) がフォグにバインドされていること
    expect(state.players.p1.fog.length).toBe(1);
    expect(state.players.p1.fog[0].card.id).toBe("key-h7");

    // 4. 兵士のサイズが 6 + 7 = 13 に増幅されていること
    const finalSize = registry.calculateUnitSize(soldier, state.players.p1);
    expect(finalSize).toBe(13);
  });
});
