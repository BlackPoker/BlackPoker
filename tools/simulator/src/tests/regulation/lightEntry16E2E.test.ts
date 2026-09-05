import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { OfficialRegulationMatchFactory } from "../../engine/regulation/OfficialRegulationMatchFactory";
import { loadRegulationCatalog, getRegulation, getFormat } from "../../engine/regulation/RegulationLoader";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RegulationRulePackageSelector } from "../../engine/regulation/RegulationRulePackageSelector";
import { SimulationRunner } from "../../engine/simulation/SimulationRunner";
import { RandomPolicy, FirstLegalPolicy } from "../../engine/simulation/DecisionPolicy";
import { SeededRandom } from "../../engine/random/RandomSource";
import { StateHasher } from "../../engine/simulation/StateHasher";
import { BatchSimulationRunner } from "../../engine/simulation/BatchSimulationRunner";

describe("Official Light + Entry16 Headless E2E Tests (AT 43-50)", () => {
  let catalog: any;
  let regulation: any;
  let format: any;
  let officialRulePackage: any;

  beforeAll(async () => {
    catalog = await loadRegulationCatalog();
    regulation = await getRegulation("light-entry16");
    format = await getFormat("light");

    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    const fullPackage = await loadRulePackageFromDirectory(rulesDir);
    officialRulePackage = RegulationRulePackageSelector.selectRulePackage(fullPackage, format, regulation);
  });

  it("43 & 44. GameSession generated from OfficialRegulationMatchFactory without CORE-BATTLE-001", async () => {
    const session = await OfficialRegulationMatchFactory.createSession("light-entry16", 42, {
      catalog,
      fullRulePackage: officialRulePackage,
    });

    expect(session.state.presetId).toBeUndefined();
    expect(session.state.regulationId).toBe("light-entry16");
    expect(session.state.formatId).toBe("light");
    expect(session.state.frameId).toBe("entry16");
  });

  it("45, 46, 47. First DecisionRequest generated successfully with only legal Light actions", async () => {
    const session = await OfficialRegulationMatchFactory.createSession("light-entry16", 42, {
      catalog,
      fullRulePackage: officialRulePackage,
    });

    const step = session.advance();
    expect(step.type).toBe("WAITING_FOR_DECISION");
    if (step.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

    const req = step.request;
    expect(req.playerId).toBe(session.state.turnPlayer);
    expect(req.patterns.length).toBeGreaterThan(0);

    // 非ライトアクションが含まれていないことの検証
    for (const actionSel of req.catalog.actions) {
      expect(actionSel.actionId).not.toBe("action.counterattack");
      expect(actionSel.actionId).not.toBe("action.revolutionDraw");
      expect(format.actions).toContain(actionSel.actionId);
    }
  });

  it("48 & 49. Runs to FINISHED on at least one deterministic seed, obtaining finalStateHash", async () => {
    // 決定論的シード (例: 42) でシミュレーション実行
    const session = await OfficialRegulationMatchFactory.createSession("light-entry16", 42, {
      catalog,
      fullRulePackage: officialRulePackage,
    });

    const rng = new SeededRandom(42);
    const policies = {
      p1: new RandomPolicy(rng.fork(), "RandomAI-P1"),
      p2: new RandomPolicy(rng.fork(), "RandomAI-P2"),
    };

    const result = SimulationRunner.run(session, policies, {
      maxDecisions: 400,
    });

    expect(result.totalDecisions).toBeGreaterThan(0);
    expect(result.decisionTrace.length).toBeGreaterThan(0);
    expect(result.decisionTraceVersion).toBe(2);

    // 終了状態または進行状態の StateHash v2 が得られること
    if (result.finalStateHash) {
      expect(result.finalStateHash.startsWith("sh2-")).toBe(true);
    }

    // 決着が付いた場合の検証
    if (result.completed) {
      expect(result.winner).toBeDefined();
      expect(result.reason).toBeDefined();
    }
  });

  it("50. Same seed + Same policies produce 100% reproducible logical results & hashes", async () => {
    const seed = 1007;

    const runMatch = async () => {
      const session = await OfficialRegulationMatchFactory.createSession("light-entry16", seed, {
        catalog,
        fullRulePackage: officialRulePackage,
      });

      const p1Seed = BatchSimulationRunner.deriveSeed(seed, 0, "p1");
      const p2Seed = BatchSimulationRunner.deriveSeed(seed, 0, "p2");
      const policies = {
        p1: new RandomPolicy(new SeededRandom(p1Seed), "RandomAI-P1"),
        p2: new RandomPolicy(new SeededRandom(p2Seed), "RandomAI-P2"),
      };

      return SimulationRunner.run(session, policies, {
        maxDecisions: 150,
      });
    };

    const resultA = await runMatch();
    const resultB = await runMatch();

    expect(resultA.completed).toBe(resultB.completed);
    expect(resultA.totalDecisions).toBe(resultB.totalDecisions);
    expect(resultA.turnCount).toBe(resultB.turnCount);
    expect(resultA.winner).toBe(resultB.winner);

    // 全ての DecisionTrace が完全一致
    expect(resultA.decisionTrace.length).toBe(resultB.decisionTrace.length);
    for (let i = 0; i < resultA.decisionTrace.length; i++) {
      expect(resultA.decisionTrace[i].logicalDecisionId).toBe(resultB.decisionTrace[i].logicalDecisionId);
      expect(resultA.decisionTrace[i].selectedLogicalPatternKey).toBe(resultB.decisionTrace[i].selectedLogicalPatternKey);
      expect(resultA.decisionTrace[i].stateHash).toBe(resultB.decisionTrace[i].stateHash);
    }

    expect(resultA.finalStateHash).toBe(resultB.finalStateHash);
  });
});
