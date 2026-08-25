import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { MatchSetupCoordinator } from "../../engine/session/setup/MatchSetupCoordinator";
import { createCoreBattlePresetState } from "../../engine/session/playtest/createCoreBattlePlaytest";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { getCoreBattlePlaytestRulePackage } from "../../engine/rules/RulePackageSelector";
import { GameSession } from "../../engine/session/GameSession";
import { SimulationRunner } from "../../engine/simulation/SimulationRunner";
import { FirstLegalPolicy } from "../../engine/simulation/DecisionPolicy";
import { RulePackage } from "../../domain/rules/RulePackage";

describe("Match Setup & First Player Determination Tests (Phase 21B.4)", () => {
  let rulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    const fullPackage = await loadRulePackageFromDirectory(rulesDir);
    rulePackage = getCoreBattlePlaytestRulePackage(fullPackage);
  });

  it("Test A: should determine first player by comparing top life card values (P1 8 vs P2 5 -> P1 first, discarded to graves, P1 draws 1)", () => {
    const mockState = {
      players: {
        p1: {
          name: "Player A",
          life: [
            { id: "p1-l1", suit: "S", rank: "8", value: 8 },
            { id: "p1-l2", suit: "H", rank: "3", value: 3 },
            { id: "p1-l3", suit: "D", rank: "2", value: 2 },
          ],
          hand: [],
          field: [],
          grave: [],
        },
        p2: {
          name: "Player B",
          life: [
            { id: "p2-l1", suit: "C", rank: "5", value: 5 },
            { id: "p2-l2", suit: "D", rank: "6", value: 6 },
            { id: "p2-l3", suit: "H", rank: "7", value: 7 },
          ],
          hand: [],
          field: [],
          grave: [],
        },
      },
    };

    const result = MatchSetupCoordinator.setupMatch(mockState);

    expect(result.firstPlayer).toBe("p1");
    expect(result.rounds.length).toBe(1);
    expect(result.rounds[0].result).toBe("p1");

    // 公開カードが各プレイヤーの墓地へ移動していること
    expect(result.state.players.p1.grave.length).toBe(1);
    expect(result.state.players.p1.grave[0].id).toBe("p1-l1");
    expect(result.state.players.p2.grave.length).toBe(1);
    expect(result.state.players.p2.grave[0].id).toBe("p2-l1");

    // 先攻 (p1) がライフから 1 枚ドローして手札に持っていること
    expect(result.state.players.p1.hand.length).toBe(1);
    expect(result.state.players.p1.hand[0].id).toBe("p1-l2"); // 次のライフカード (H3)
    expect(result.state.players.p1.life.length).toBe(1); // 3枚 - 墓地1枚 - ドロー1枚 = 残り1枚 (D2)

    // 後攻 (p2) はドローせずライフから墓地送り分のみ減少
    expect(result.state.players.p2.hand.length).toBe(0);
    expect(result.state.players.p2.life.length).toBe(2); // 3枚 - 墓地1枚 = 残り2枚

    // ターンとチャンスが先攻に設定されていること
    expect(result.state.turnPlayer).toBe("p1");
    expect(result.state.chancePlayer).toBe("p1");
    expect(result.state.turnCount).toBe(1);
  });

  it("Test B: should handle Tie by comparing next life cards and moving all revealed cards to graves (P1 5,4 vs P2 5,9 -> P2 first, 4 cards to graves)", () => {
    const mockState = {
      players: {
        p1: {
          name: "Player A",
          life: [
            { id: "p1-l1", suit: "S", rank: "5", value: 5 }, // round 1: 5 (tie)
            { id: "p1-l2", suit: "H", rank: "4", value: 4 }, // round 2: 4 (lose)
            { id: "p1-l3", suit: "D", rank: "7", value: 7 },
            { id: "p1-l4", suit: "C", rank: "8", value: 8 },
          ],
          hand: [],
          field: [],
          grave: [],
        },
        p2: {
          name: "Player B",
          life: [
            { id: "p2-l1", suit: "C", rank: "5", value: 5 }, // round 1: 5 (tie)
            { id: "p2-l2", suit: "D", rank: "9", value: 9 }, // round 2: 9 (win)
            { id: "p2-l3", suit: "H", rank: "2", value: 2 },
            { id: "p2-l4", suit: "S", rank: "3", value: 3 },
          ],
          hand: [],
          field: [],
          grave: [],
        },
      },
    };

    const result = MatchSetupCoordinator.setupMatch(mockState);

    expect(result.firstPlayer).toBe("p2");
    expect(result.rounds.length).toBe(2);
    expect(result.rounds[0].result).toBe("tie");
    expect(result.rounds[1].result).toBe("p2");

    // 全4枚が墓地へ移動していること
    expect(result.state.players.p1.grave.length).toBe(2);
    expect(result.state.players.p1.grave.map((c: any) => c.id)).toEqual(["p1-l1", "p1-l2"]);

    expect(result.state.players.p2.grave.length).toBe(2);
    expect(result.state.players.p2.grave.map((c: any) => c.id)).toEqual(["p2-l1", "p2-l2"]);

    // 先攻 (p2) が 1 枚ドロー
    expect(result.state.players.p2.hand.length).toBe(1);
    expect(result.state.players.p2.hand[0].id).toBe("p2-l3");
    expect(result.state.players.p2.life.length).toBe(1); // 4 - 2(grave) - 1(draw) = 1

    expect(result.state.turnPlayer).toBe("p2");
    expect(result.state.chancePlayer).toBe("p2");
  });

  it("Test C: Headless simulation should start from MatchSetupCoordinator and advance to match end", () => {
    const rawPreset = createCoreBattlePresetState();
    const setupResult = MatchSetupCoordinator.setupMatch(rawPreset);

    const session = new GameSession(setupResult.state, rulePackage);
    const policies = {
      p1: new FirstLegalPolicy(false),
      p2: new FirstLegalPolicy(false),
    };

    const simResult = SimulationRunner.run(session, policies, {
      maxDecisions: 150,
    });

    expect(simResult.totalDecisions).toBeGreaterThan(0);
    expect(simResult.finalState.turnCount).toBeGreaterThanOrEqual(1);
  });
});
