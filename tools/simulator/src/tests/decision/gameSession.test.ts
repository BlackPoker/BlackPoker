import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage } from "../../domain/rules/RulePackage";
import { GameSession } from "../../engine/session/GameSession";
import { TurnManager } from "../../engine/rules/TurnManager";
import { DecisionResponse } from "../../domain/decision/DecisionResponse";

describe("GameSession Integration Tests", () => {
  let rulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  it("should advance and request decision, then update state upon valid submission", () => {
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

    const session = new GameSession(state, rulePackage);
    const step1 = session.advance();

    expect(step1.type).toBe("WAITING_FOR_DECISION");
    if (step1.type !== "WAITING_FOR_DECISION") return;

    expect(step1.request.patterns.length).toBeGreaterThan(0);
    expect(step1.request.playerId).toBe("p1");

    const response: DecisionResponse = {
      decisionId: step1.request.decisionId,
      stateVersion: step1.request.stateVersion,
      selectedPatternRef: 0,
    };

    const step2 = session.submitDecision(response);

    // 適用後、stateVersion が 2 にインクリメントされていること
    expect(session.stateVersion).toBe(2);
  });

  it("should reject invalid decisions: out of range, stale decisionId, stale stateVersion (16.5)", () => {
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

    const session = new GameSession(state, rulePackage);
    const step = session.advance();
    if (step.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

    const validReq = step.request;

    // 1. 範囲外のインデックス
    expect(() => {
      session.submitDecision({
        decisionId: validReq.decisionId,
        stateVersion: validReq.stateVersion,
        selectedPatternRef: 9999,
      });
    }).toThrow("selectedPatternRef が範囲外です");

    // 2. 不正な decisionId
    expect(() => {
      session.submitDecision({
        decisionId: "invalid-id",
        stateVersion: validReq.stateVersion,
        selectedPatternRef: 0,
      });
    }).toThrow("Decision ID が一致しません");

    // 3. 不正な stateVersion
    expect(() => {
      session.submitDecision({
        decisionId: validReq.decisionId,
        stateVersion: 999,
        selectedPatternRef: 0,
      });
    }).toThrow("State Version が一致しません");
  });
});
