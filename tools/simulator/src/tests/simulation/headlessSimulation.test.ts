import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { getCoreBattlePlaytestRulePackage } from "../../engine/rules/RulePackageSelector";
import { RulePackage } from "../../domain/rules/RulePackage";
import { GameSession } from "../../engine/session/GameSession";
import { createCoreBattlePresetState } from "../../engine/session/playtest/createCoreBattlePlaytest";
import { SimulationRunner } from "../../engine/simulation/SimulationRunner";
import { FirstLegalPolicy, ScriptedPolicy } from "../../engine/simulation/DecisionPolicy";
import { DecisionRequest } from "../../domain/decision/DecisionRequest";

describe("Headless Simulation Runner Integration Tests (Phase 21B.3)", () => {
  let fullPackage: RulePackage;
  let rulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    fullPackage = await loadRulePackageFromDirectory(rulesDir);
    rulePackage = getCoreBattlePlaytestRulePackage(fullPackage);
  });

  it("should run match automatically without UI or BrowserRuleLoader using FirstLegalPolicy and terminate safely", () => {
    const state = createCoreBattlePresetState();
    const session = new GameSession(state, rulePackage);

    const policies = {
      p1: new FirstLegalPolicy(false),
      p2: new FirstLegalPolicy(false),
    };

    const result = SimulationRunner.run(session, policies, {
      maxDecisions: 200,
    });

    expect(result.totalDecisions).toBeGreaterThan(0);
    // 試合が終了しているか、最大ステップ内で正常に進行していること
    expect(result.finalState).toBeDefined();
    expect(result.finalState.turnCount).toBeGreaterThanOrEqual(1);
  });

  it("should complete full scripted match to FINISHED using ScriptedPolicy", () => {
    const state = createCoreBattlePresetState();
    const session = new GameSession(state, rulePackage);

    // アクション優先のポリシー
    const chooseActionOrPass = (req: DecisionRequest) => {
      // 1. EFFECT_RESOLUTION なら最初の選択肢 (アタッカー/ブロッカー全指定等)
      if (req.source.type === "EFFECT_RESOLUTION") {
        return 0;
      }
      // 2. アタックがあれば最優先
      const attackIdx = req.patterns.findIndex((p) => {
        if (p.actionSelectionRef === undefined) return false;
        return req.catalog.actions[p.actionSelectionRef]?.actionId === "action.attack";
      });
      if (attackIdx !== -1) return attackIdx;

      // 3. エンドがあれば次点
      const endIdx = req.patterns.findIndex((p) => {
        if (p.actionSelectionRef === undefined) return false;
        return req.catalog.actions[p.actionSelectionRef]?.actionId === "action.end";
      });
      if (endIdx !== -1) return endIdx;

      // 4. なければPASS
      const passIdx = req.patterns.findIndex((p) => p.kind === "PASS");
      return passIdx !== -1 ? passIdx : 0;
    };

    const policies = {
      p1: new ScriptedPolicy(chooseActionOrPass),
      p2: new ScriptedPolicy(chooseActionOrPass),
    };

    const result = SimulationRunner.run(session, policies, {
      maxDecisions: 100,
    });

    // 決着がつくこと
    expect(result.completed).toBe(true);
    expect(result.winner).toBeDefined();
    expect(result.reason).toBeDefined();
  });
});
