import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage } from "../../domain/rules/RulePackage";
import { LegalPatternGenerator } from "../../engine/decision/LegalPatternGenerator";
import { PatternExecutor } from "../../engine/decision/PatternExecutor";
import { FirstLegalPatternPolicy } from "../../controller/FirstLegalPatternPolicy";
import { CommandRegistry } from "../../engine/rules/CommandRegistry";
import { TurnManager } from "../../engine/rules/TurnManager";
import { DecisionResponse } from "../../domain/decision/DecisionResponse";

describe("Human & AI Parity Tests (16.4)", () => {
  let rulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  it("should produce exactly identical game state whether decided by Human or AI for same pattern ref", async () => {
    const createBaseState = () => {
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
      return state;
    };

    const stateHuman = createBaseState();
    const stateAi = createBaseState();

    const registryHuman = new CommandRegistry();
    const registryAi = new CommandRegistry();

    // 1. 人間用の DecisionRequest 生成
    const { request: humanReq } = LegalPatternGenerator.generateActionRequestDecision(
      stateHuman,
      "p1",
      rulePackage
    );

    // 2. AI 用の DecisionRequest 生成
    const { request: aiReq } = LegalPatternGenerator.generateActionRequestDecision(
      stateAi,
      "p1",
      rulePackage
    );

    // AI Policy による選択
    const aiPolicy = new FirstLegalPatternPolicy();
    const aiResponse = await aiPolicy.decide(aiReq);

    // 人間 UI による選択（同じインデックス 0 番目を選択）
    const humanResponse: DecisionResponse = {
      decisionId: humanReq.decisionId,
      stateVersion: humanReq.stateVersion,
      selectedPatternRef: aiResponse.selectedPatternRef,
    };

    // 実行
    PatternExecutor.executeResponse(humanReq, humanResponse, stateHuman, rulePackage, registryHuman);
    PatternExecutor.executeResponse(aiReq, aiResponse, stateAi, rulePackage, registryAi);

    // 検証：双方の盤面状態が完全に同一であること
    expect(stateHuman.players.p1.hand).toEqual(stateAi.players.p1.hand);
    expect(stateHuman.players.p1.grave).toEqual(stateAi.players.p1.grave);
    expect(stateHuman.players.p1.fog).toEqual(stateAi.players.p1.fog);
    expect(stateHuman.players.p1.field).toEqual(stateAi.players.p1.field);
    expect(stateHuman.stage).toEqual(stateAi.stage);
  });
});
