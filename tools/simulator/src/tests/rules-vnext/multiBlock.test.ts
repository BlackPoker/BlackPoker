import { describe, it, expect, beforeAll } from "vitest";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage } from "../../domain/rules/RulePackage";
import { TurnManager } from "../../engine/rules/TurnManager";
import { LegalPatternGenerator } from "../../engine/decision/LegalPatternGenerator";
import * as path from "path";

describe("Multi-Soldier Block and DamageJudge Integration Tests (Phase 21B.5)", () => {
  let rulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext/examples");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  it("Test A: 1 Attacker + 2 Soldiers enumerates exactly 4 legal patterns (none, S1, S2, S1+S2) and resolves DamageJudge (8 vs 3+4=7)", () => {
    const soldierAttacker: any = {
      unitId: "soldier-atk",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-atk", suit: "S", rank: "8", value: 8 }],
      labels: ["攻撃", "防御"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };

    const soldierB1: any = {
      unitId: "soldier-b1",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "c-b1", suit: "C", rank: "3", value: 3 }],
      labels: ["防御"],
    };

    const soldierB2: any = {
      unitId: "soldier-b2",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "c-b2", suit: "D", rank: "4", value: 4 }],
      labels: ["防御"],
    };

    const state: any = {
      players: {
        p1: { name: "Player A", field: [soldierAttacker], hand: [], grave: [], life: [] },
        p2: { name: "Player B", field: [soldierB1, soldierB2], hand: [], grave: [], life: [{ id: "l1", suit: "H", rank: "2", value: 2 }] },
      },
      stage: { requests: [] },
    };

    const blockAction = rulePackage.actions.find((a) => a.id === "action.block")!;
    const mockRequest: any = {
      id: "req-block-1",
      actionId: "action.block",
      controller: "p2",
      definitionOwner: "p2",
      status: "resolving",
      action: blockAction,
    };

    // 1. LegalPatternGenerator によるパターン生成検証
    const { request: decReq } = LegalPatternGenerator.generateBlockAssignmentDecision(
      state,
      "p2",
      mockRequest,
      "selectBlockAssignments",
      [soldierAttacker],
      [soldierB1, soldierB2],
      rulePackage.components
    );

    // 期待パターン: [], [b1], [b2], [b1, b2] の 4 パターン
    expect(decReq.catalog.effectSelections.length).toBe(4);
    const selectedIdCombos = decReq.catalog.effectSelections.map((sel) =>
      sel.assignments?.[0]?.selectedUnitIds ? [...sel.assignments[0].selectedUnitIds].sort().join(",") : ""
    );
    expect(selectedIdCombos).toContain("");
    expect(selectedIdCombos).toContain("soldier-b1");
    expect(selectedIdCombos).toContain("soldier-b2");
    expect(selectedIdCombos).toContain("soldier-b1,soldier-b2");

    // 2. [soldier-b1, soldier-b2] でブロックを宣言して解決
    const registry = new CommandRegistry();
    TurnManager.initializeToMain(state, "p1");

    const context: CommandContext = {
      state,
      playerKey: "p2",
      selections: {
        blocks: [
          {
            sourceUnitId: "soldier-atk",
            selectedUnitIds: ["soldier-b1", "soldier-b2"],
          },
        ],
      },
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    registry.createRequest(blockAction, context);
    registry.resolveTopRequest(context);

    expect(soldierB1.state).toBe("charge");
    expect(soldierB2.state).toBe("charge");
    expect(soldierB1.battle?.role).toBe("blocker");
    expect(soldierB2.battle?.role).toBe("blocker");

    // 3. DamageJudge 解決 (8 vs 3+4=7 -> ブロッカー双方が墓地へ、アタッカー生存)
    const djAction = rulePackage.actions.find((a) => a.id === "action.damageJudge")!;
    const djContext: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    registry.createRequest(djAction, djContext);
    registry.resolveTopRequest(djContext);

    expect(state.players.p1.field.some((u: any) => u.unitId === "soldier-atk")).toBe(true);
    expect(state.players.p2.field.length).toBe(0);
    expect(state.players.p2.grave.some((u: any) => u.unitId === "soldier-b1")).toBe(true);
    expect(state.players.p2.grave.some((u: any) => u.unitId === "soldier-b2")).toBe(true);
  });

  it("Test B: 1 Attacker + 2 Soldiers + 1 Bulwark generates 5 patterns (none, S1, S2, S1+S2, B) and forbids mixed combos", () => {
    const soldierAttacker: any = {
      unitId: "soldier-atk",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-atk", suit: "S", rank: "8", value: 8 }],
      labels: ["攻撃", "防御"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };

    const soldierB1: any = {
      unitId: "soldier-b1",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "c-b1", suit: "C", rank: "3", value: 3 }],
      labels: ["防御"],
    };

    const soldierB2: any = {
      unitId: "soldier-b2",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "c-b2", suit: "D", rank: "4", value: 4 }],
      labels: ["防御"],
    };

    const bulwark: any = {
      unitId: "bulwark-1",
      kind: "防壁",
      componentId: "character.bulwark",
      state: "charge",
      cards: [{ id: "c-bw", suit: "H", rank: "8", value: 8 }],
      labels: ["防御"],
    };

    const state: any = {
      players: {
        p1: { name: "Player A", field: [soldierAttacker], hand: [], grave: [], life: [] },
        p2: { name: "Player B", field: [soldierB1, soldierB2, bulwark], hand: [], grave: [], life: [] },
      },
      stage: { requests: [] },
    };

    const blockAction = rulePackage.actions.find((a) => a.id === "action.block")!;
    const mockRequest: any = {
      id: "req-block-1",
      actionId: "action.block",
      controller: "p2",
      definitionOwner: "p2",
      status: "resolving",
      action: blockAction,
    };

    const { request: decReq } = LegalPatternGenerator.generateBlockAssignmentDecision(
      state,
      "p2",
      mockRequest,
      "selectBlockAssignments",
      [soldierAttacker],
      [soldierB1, soldierB2, bulwark],
      rulePackage.components
    );

    // 期待パターン: [], [s1], [s2], [s1, s2], [bw] の計 5 パターン
    expect(decReq.catalog.effectSelections.length).toBe(5);
    const selectedIdCombos = decReq.catalog.effectSelections.map((sel) =>
      sel.assignments?.[0]?.selectedUnitIds ? [...sel.assignments[0].selectedUnitIds].sort().join(",") : ""
    );
    expect(selectedIdCombos).toContain("");
    expect(selectedIdCombos).toContain("soldier-b1");
    expect(selectedIdCombos).toContain("soldier-b2");
    expect(selectedIdCombos).toContain("soldier-b1,soldier-b2");
    expect(selectedIdCombos).toContain("bulwark-1");

    // 不正な混合パターンが存在しないこと
    expect(selectedIdCombos.some((c) => c.includes("bulwark-1") && c.includes("soldier"))).toBe(false);
  });

  it("Test C: 2 Attackers + 2 Soldiers allows independent assignments and forbids using same blocker on both attackers", () => {
    const atk1: any = {
      unitId: "atk-1",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-a1", suit: "S", rank: "5", value: 5 }],
      labels: ["攻撃", "防御"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };
    const atk2: any = {
      unitId: "atk-2",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-a2", suit: "H", rank: "6", value: 6 }],
      labels: ["攻撃", "防御"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };

    const s1: any = {
      unitId: "s-1",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "c-s1", suit: "C", rank: "3", value: 3 }],
      labels: ["防御"],
    };
    const s2: any = {
      unitId: "s-2",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "c-s2", suit: "D", rank: "4", value: 4 }],
      labels: ["防御"],
    };

    const state: any = {
      players: {
        p1: { name: "Player A", field: [atk1, atk2], hand: [], grave: [], life: [] },
        p2: { name: "Player B", field: [s1, s2], hand: [], grave: [], life: [] },
      },
      stage: { requests: [] },
    };

    const blockAction = rulePackage.actions.find((a) => a.id === "action.block")!;
    const mockRequest: any = {
      id: "req-block-1",
      actionId: "action.block",
      controller: "p2",
      definitionOwner: "p2",
      status: "resolving",
      action: blockAction,
    };

    const { request: decReq } = LegalPatternGenerator.generateBlockAssignmentDecision(
      state,
      "p2",
      mockRequest,
      "selectBlockAssignments",
      [atk1, atk2],
      [s1, s2],
      rulePackage.components
    );

    // 全パターンで、s-1 と s-2 が同一 pattern 内で重複して使われていないことを検証
    for (const effSel of decReq.catalog.effectSelections) {
      const assignedIds = (effSel.assignments || []).flatMap((a) => a.selectedUnitIds);
      const uniqueIds = new Set(assignedIds);
      expect(assignedIds.length).toBe(uniqueIds.size);
    }

    // atk-1 に [s-1, s-2] 集中ブロック、atk-2 に [] のパターンが存在すること
    const concentratedPattern = decReq.catalog.effectSelections.find((sel) => {
      const a1 = sel.assignments?.find((a) => a.sourceUnitId === "atk-1");
      const a2 = sel.assignments?.find((a) => a.sourceUnitId === "atk-2");
      return (
        a1?.selectedUnitIds.length === 2 &&
        a1.selectedUnitIds.includes("s-1") &&
        a1.selectedUnitIds.includes("s-2") &&
        a2?.selectedUnitIds.length === 0
      );
    });
    expect(concentratedPattern).toBeDefined();

    // atk-1 に [s-1], atk-2 に [s-2] の分散ブロックパターンが存在すること
    const distributedPattern = decReq.catalog.effectSelections.find((sel) => {
      const a1 = sel.assignments?.find((a) => a.sourceUnitId === "atk-1");
      const a2 = sel.assignments?.find((a) => a.sourceUnitId === "atk-2");
      return (
        a1?.selectedUnitIds.length === 1 &&
        a1.selectedUnitIds.includes("s-1") &&
        a2?.selectedUnitIds.length === 1 &&
        a2.selectedUnitIds.includes("s-2")
      );
    });
    expect(distributedPattern).toBeDefined();
  });

  it("Test D: Attacker size 5 vs Soldiers 3+4=7 resolves DamageJudge with Attacker moving to grave and Blockers surviving", () => {
    const soldierAttacker: any = {
      unitId: "soldier-atk",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "drive",
      cards: [{ id: "c-atk", suit: "S", rank: "5", value: 5 }],
      labels: ["攻撃", "防御"],
      battle: { role: "attacker", targetPlayerKey: "p2" },
    };

    const soldierB1: any = {
      unitId: "soldier-b1",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "c-b1", suit: "C", rank: "3", value: 3 }],
      labels: ["防御"],
    };

    const soldierB2: any = {
      unitId: "soldier-b2",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "c-b2", suit: "D", rank: "4", value: 4 }],
      labels: ["防御"],
    };

    const state: any = {
      players: {
        p1: { name: "Player A", field: [soldierAttacker], hand: [], grave: [], life: [] },
        p2: { name: "Player B", field: [soldierB1, soldierB2], hand: [], grave: [], life: [{ id: "l1", suit: "H", rank: "2", value: 2 }] },
      },
      stage: { requests: [] },
    };

    const blockAction = rulePackage.actions.find((a) => a.id === "action.block")!;
    const registry = new CommandRegistry();
    TurnManager.initializeToMain(state, "p1");

    const context: CommandContext = {
      state,
      playerKey: "p2",
      selections: {
        blocks: [
          {
            sourceUnitId: "soldier-atk",
            selectedUnitIds: ["soldier-b1", "soldier-b2"],
          },
        ],
      },
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    registry.createRequest(blockAction, context);
    registry.resolveTopRequest(context);

    // DamageJudge 解決 (5 vs 3+4=7 -> アタッカーが墓地へ、ブロッカー生存)
    const djAction = rulePackage.actions.find((a) => a.id === "action.damageJudge")!;
    const djContext: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    registry.createRequest(djAction, djContext);
    registry.resolveTopRequest(djContext);

    expect(state.players.p1.field.length).toBe(0);
    expect(state.players.p1.grave.some((u: any) => u.unitId === "soldier-atk")).toBe(true);
    expect(state.players.p2.field.some((u: any) => u.unitId === "soldier-b1")).toBe(true);
    expect(state.players.p2.field.some((u: any) => u.unitId === "soldier-b2")).toBe(true);
  });
});
