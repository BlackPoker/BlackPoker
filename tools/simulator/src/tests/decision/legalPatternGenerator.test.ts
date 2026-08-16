import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage } from "../../domain/rules/RulePackage";
import { LegalPatternGenerator } from "../../engine/decision/LegalPatternGenerator";
import { TurnManager } from "../../engine/rules/TurnManager";

describe("LegalPatternGenerator Integration Tests", () => {
  let rulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  it("should generate exact 8 patterns for up action with 2 key cards, 1 other card (2 cost options each), and 2 target soldiers (16.1)", () => {
    // 盤面設定：
    // 手札: ♡7(キー候補), ♡5(キー候補), ♣2(捨て札専用候補)
    // 場: 兵士A, 兵士B
    // キーが ♡7 のとき、捨て札候補は [♡5, ♣2] の2通り
    // キーが ♡5 のとき、捨て札候補は [♡7, ♣2] の2通り
    // 対象: 兵士A, 兵士B の2通り
    // 計: 2 (キー) × 2 (コスト) × 2 (対象) = 8 パターン
    const soldierA = {
      unitId: "soldier-A",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "s-card-1", suit: "S", rank: "6", value: 6 }],
      labels: ["攻撃", "防御"],
    };

    const soldierB = {
      unitId: "soldier-B",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "s-card-2", suit: "S", rank: "5", value: 5 }],
      labels: ["攻撃", "防御"],
    };

    const state = {
      players: {
        p1: {
          name: "Player A",
          life: 16,
          hand: [
            { id: "key-h7", suit: "H", rank: "7", value: 7 },
            { id: "key-h5", suit: "H", rank: "5", value: 5 },
            { id: "cost-c2", suit: "C", rank: "2", value: 2 },
          ],
          field: [soldierA, soldierB],
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

    const { request } = LegalPatternGenerator.generateActionRequestDecision(
      state,
      "p1",
      rulePackage
    );

    const upActionRef = request.catalog.actions.findIndex((a) => a.actionId === "action.up");
    expect(upActionRef).toBeGreaterThanOrEqual(0);

    const upPatterns = request.patterns.filter((p) => p.actionSelectionRef === upActionRef);

    // 期待: 2 (キー) × 2 (コスト) × 2 (対象) = 8 パターン
    expect(upPatterns.length).toBe(8);

    // 各パターンでキーカードと捨て札コストが重複していないことを検証
    for (const pattern of upPatterns) {
      const keySel = request.catalog.cardSelections[pattern.keyCardSelectionRef!];
      const costSel = request.catalog.costPayments[pattern.costPaymentRef!];

      expect(keySel.cardIds.length).toBe(1);
      expect(costSel.discardedCardIds.length).toBe(1);

      const keyCardId = keySel.cardIds[0];
      const costCardId = costSel.discardedCardIds[0];

      // キーカードとコストカードが同一であってはならない
      expect(keyCardId).not.toBe(costCardId);
      expect(["key-h7", "key-h5"]).toContain(keyCardId);
      expect(["key-h7", "key-h5", "cost-c2"]).toContain(costCardId);
    }
  });

  it("should generate 12 patterns when 4 cards are in hand (2 key choices * 3 remaining discard choices * 2 targets)", () => {
    const soldierA = {
      unitId: "soldier-A",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "s-card-1", suit: "S", rank: "6", value: 6 }],
      labels: ["攻撃", "防御"],
    };

    const soldierB = {
      unitId: "soldier-B",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "s-card-2", suit: "S", rank: "5", value: 5 }],
      labels: ["攻撃", "防御"],
    };

    const state = {
      players: {
        p1: {
          name: "Player A",
          life: 16,
          hand: [
            { id: "key-h7", suit: "H", rank: "7", value: 7 },
            { id: "key-h5", suit: "H", rank: "5", value: 5 },
            { id: "cost-c2", suit: "C", rank: "2", value: 2 },
            { id: "cost-d3", suit: "D", rank: "3", value: 3 },
          ],
          field: [soldierA, soldierB],
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

    const { request } = LegalPatternGenerator.generateActionRequestDecision(
      state,
      "p1",
      rulePackage
    );

    const upActionRef = request.catalog.actions.findIndex((a) => a.actionId === "action.up");
    const upPatterns = request.patterns.filter((p) => p.actionSelectionRef === upActionRef);

    // 2 (キー) × 3 (残り手札から1枚捨て) × 2 (対象) = 12 パターン
    expect(upPatterns.length).toBe(12);
  });

  it("should share catalog references without duplicating full entities in patterns (16.2)", () => {
    const soldierA = {
      unitId: "soldier-A",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "s-card-1", suit: "S", rank: "6", value: 6 }],
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
          ],
          field: [soldierA],
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

    const { request } = LegalPatternGenerator.generateActionRequestDecision(
      state,
      "p1",
      rulePackage
    );

    const upActionRef = request.catalog.actions.findIndex((a) => a.actionId === "action.up");
    const upPatterns = request.patterns.filter((p) => p.actionSelectionRef === upActionRef);

    expect(upPatterns.length).toBe(1);
    const pattern = upPatterns[0];

    // パターン自身は数値インデックス参照のみを保持
    expect(typeof pattern.actionSelectionRef).toBe("number");
    expect(typeof pattern.keyCardSelectionRef).toBe("number");
    expect(typeof pattern.costPaymentRef).toBe("number");
    expect(typeof pattern.targetSelectionRef).toBe("number");

    // カタログから正しく復元できること
    const targetSel = request.catalog.targetSelections[pattern.targetSelectionRef!];
    expect(targetSel.targetUnitId).toBe("soldier-A");
    const costSel = request.catalog.costPayments[pattern.costPaymentRef!];
    expect(costSel.discardedCardIds).toEqual(["cost-c2"]);
  });

  it("should generate stable and reproducible patterns order (7.2)", () => {
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
            { id: "key-h8", suit: "H", rank: "8", value: 8 },
            { id: "cost-c2", suit: "C", rank: "2", value: 2 },
            { id: "cost-c3", suit: "C", rank: "3", value: 3 },
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

    const run1 = LegalPatternGenerator.generateActionRequestDecision(state, "p1", rulePackage);
    const run2 = LegalPatternGenerator.generateActionRequestDecision(state, "p1", rulePackage);

    const ids1 = run1.request.patterns.map((p) => p.patternId);
    const ids2 = run2.request.patterns.map((p) => p.patternId);

    expect(ids1).toEqual(ids2);
  });
});
