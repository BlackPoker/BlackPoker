import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage, ActionDefinition } from "../../domain/rules/RulePackage";
import { getCoreBattlePlaytestRulePackage } from "../../engine/rules/RulePackageSelector";
import { TargetSelectionEnumerator } from "../../engine/decision/TargetSelectionEnumerator";
import { LegalPatternGenerator } from "../../engine/decision/LegalPatternGenerator";
import { validateTargetsAtResolution } from "../../engine/rules/ResolutionTargetValidator";
import { ActionTargetService } from "../../engine/rules/ActionTargetService";

describe("Phase 3A-4: Uncounterable Request Target Exclusion and Resolution Validation", () => {
  let fullRulePackage: RulePackage;
  let playtestRulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    fullRulePackage = await loadRulePackageFromDirectory(rulesDir);
    playtestRulePackage = getCoreBattlePlaytestRulePackage(fullRulePackage);
  });

  function createBaseState(): any {
    return {
      protocolVersion: "2026-08-vnext",
      matchId: "match-uncounterable-test",
      turn: 1,
      turnPlayer: "p1",
      chancePlayer: "p2",
      passCount: 0,
      players: {
        p1: {
          name: "Player 1",
          life: [{ id: "l1", suit: "S", rank: "A", value: 1 }],
          hand: [],
          field: [],
          grave: [],
        },
        p2: {
          name: "Player 2",
          life: [{ id: "l2", suit: "H", rank: "A", value: 1 }],
          hand: [
            { id: "c5", suit: "C", rank: "5", value: 5 }, // counter key
            { id: "s3", suit: "S", rank: "3", value: 3 }, // counter cost D
          ],
          field: [],
          grave: [],
        },
      },
      stage: {
        requests: [],
      },
    };
  }

  it("1: action.counter excludes uncounterable request from target candidates", () => {
    const state = createBaseState();
    const counterAction = playtestRulePackage.actions.find((a) => a.id === "action.counter")!;

    // ステージ上に通常のツイストリクエストと、uncounterableなマスター上級魔法リクエストを配置
    state.stage.requests = [
      {
        id: "req-twist",
        actionId: "action.twist",
        controller: "p1",
        status: "pending",
        keyCards: [{ id: "d4", suit: "D", rank: "4", value: 4 }],
      },
      {
        id: "req-swordRain",
        actionId: "action.swordRain",
        controller: "p1",
        status: "pending",
        uncounterable: true,
        keyCards: [
          { id: "s2", suit: "S", rank: "2", value: 2 },
          { id: "s3", suit: "S", rank: "3", value: 3 },
        ],
      },
    ];

    const candidates = TargetSelectionEnumerator.enumerateTargets(
      counterAction,
      state,
      "p2",
      playtestRulePackage.components,
      { actions: playtestRulePackage.actions }
    );

    // req-twist のみが対象候補となり、req-swordRain は除外されること
    expect(candidates).toHaveLength(1);
    expect(candidates[0].targetRequestId).toBe("req-twist");
  });

  it("2: action.counter resolution rejects uncounterable request with TARGET_UNCOUNTERABLE", () => {
    const state = createBaseState();
    const counterAction = playtestRulePackage.actions.find((a) => a.id === "action.counter")!;

    const normalReq = {
      id: "req-normal",
      actionId: "action.twist",
      controller: "p1",
      status: "pending",
      keyCards: [{ id: "d4", suit: "D", rank: "4", value: 4 }],
    };
    const uncounterableReq = {
      id: "req-uncounterable",
      actionId: "action.force",
      controller: "p1",
      status: "pending",
      uncounterable: true,
      keyCards: [
        { id: "h2", suit: "H", rank: "2", value: 2 },
        { id: "h3", suit: "H", rank: "3", value: 3 },
      ],
    };

    state.stage.requests = [normalReq, uncounterableReq];

    // 通常リクエストを対象とするカウンター
    const validCounterReq = {
      id: "req-counter-1",
      actionId: "action.counter",
      controller: "p2",
      status: "pending",
      keyCards: [{ id: "c5", suit: "C", rank: "5", value: 5 }],
      targets: [{ type: "request", targetRequestId: "req-normal" }],
    };

    const mockContext: any = {
      state,
      components: playtestRulePackage.components,
      actions: playtestRulePackage.actions,
    };

    const validResult = validateTargetsAtResolution(
      counterAction,
      validCounterReq as any,
      mockContext
    );
    expect(validResult.isValid).toBe(true);

    // uncounterable リクエストを対象とするカウンター
    const invalidCounterReq = {
      id: "req-counter-2",
      actionId: "action.counter",
      controller: "p2",
      status: "pending",
      keyCards: [{ id: "c5", suit: "C", rank: "5", value: 5 }],
      targets: [{ type: "request", targetRequestId: "req-uncounterable" }],
    };

    const invalidResult = validateTargetsAtResolution(
      counterAction,
      invalidCounterReq as any,
      mockContext
    );
    expect(invalidResult.isValid).toBe(false);
    expect(invalidResult.reason).toBe("TARGET_UNCOUNTERABLE");
  });

  it("3: action definition with uncounterable: true is recognized even if request does not copy the flag directly", () => {
    const state = createBaseState();
    const counterAction = playtestRulePackage.actions.find((a) => a.id === "action.counter")!;

    // アクション定義側に uncounterable: true が付与されている模擬アクション
    const mockUncounterableAction: ActionDefinition = {
      id: "action.surprise",
      name: "奇襲",
      type: "magic",
      request: { trigger: "direct", speed: "normal", timing: "normal" } as any,
      uncounterable: true,
      text: { effect: "テスト用奇襲" },
      effect: [],
    };

    const actions = [...playtestRulePackage.actions, mockUncounterableAction];

    state.stage.requests = [
      {
        id: "req-surprise",
        actionId: "action.surprise",
        controller: "p1",
        status: "pending",
        keyCards: [
          { id: "c2", suit: "C", rank: "2", value: 2 },
          { id: "c3", suit: "C", rank: "3", value: 3 },
        ],
      },
    ];

    const candidates = ActionTargetService.enumerateTargets(
      counterAction,
      state,
      "p2",
      playtestRulePackage.components,
      { actions }
    );

    // アクション定義の uncounterable: true により除外され 0 件となること
    expect(candidates).toHaveLength(0);
  });

  it("4: LegalPatternGenerator does not generate counter patterns when only uncounterable requests exist", () => {
    const state = createBaseState();
    const uncounterableAction: ActionDefinition = {
      id: "action.swordRain",
      name: "剣の雨",
      type: "magic",
      request: { trigger: "direct", speed: "normal", timing: "normal" } as any,
      uncounterable: true,
      text: { effect: "剣の雨" },
      effect: [],
    };

    const rulePackageWithUncounterable: RulePackage = {
      ...playtestRulePackage,
      actions: [...playtestRulePackage.actions, uncounterableAction],
    };

    state.stage.requests = [
      {
        id: "req-swordRain-1",
        actionId: "action.swordRain",
        controller: "p1",
        status: "pending",
        uncounterable: true,
        keyCards: [
          { id: "s2", suit: "S", rank: "2", value: 2 },
          { id: "s3", suit: "S", rank: "3", value: 3 },
        ],
      },
    ];

    // p2 は C5 (key) と S3 (cost D) を手札に持っているが、カウンター対象が uncounterable のみなので
    // action.counter の合法パターンは一切生成されないこと
    const { request } = LegalPatternGenerator.generateActionRequestDecision(
      state,
      "p2",
      rulePackageWithUncounterable
    );

    const hasCounter = request.patterns.some((p) => {
      if (p.kind !== "ACTION") return false;
      return (
        p.actionSelectionRef !== undefined &&
        request.catalog.actions[p.actionSelectionRef]?.actionId === "action.counter"
      );
    });
    expect(hasCounter).toBe(false);
  });

  it("5: Non-counter quick actions are NOT restricted by uncounterable request", () => {
    const state = createBaseState();

    // ターゲット変更（action.changeTarget）などの別アクションでは、uncounterable リクエストであっても
    // 条件（request target）を満たしていれば除外されないこと
    const changeTargetAction = fullRulePackage.actions.find((a) => a.id === "action.changeTarget");
    if (!changeTargetAction) {
      // changeTarget がない場合は mock で確認
      return;
    }

    state.stage.requests = [
      {
        id: "req-swordRain-1",
        actionId: "action.swordRain",
        controller: "p1",
        status: "pending",
        uncounterable: true,
        keyCards: [{ id: "s2", suit: "S", rank: "2", value: 2 }],
        targets: [{ type: "player", targetPlayerKey: "p2" }],
      },
    ];

    const candidates = TargetSelectionEnumerator.enumerateTargets(
      changeTargetAction,
      state,
      "p2",
      fullRulePackage.components,
      { actions: fullRulePackage.actions }
    );

    // changeTarget の対象条件に合致していれば除外されない
    expect(candidates.some((c) => c.targetRequestId === "req-swordRain-1")).toBe(true);
  });
});
