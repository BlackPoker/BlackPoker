import { describe, it, expect, beforeAll } from "vitest";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry";
import { formatActionSummary } from "../../engine/rules/formatActionSummary";
import { RulePackage } from "../../domain/rules/RulePackage";
import { GameSession } from "../../engine/session/GameSession";
import { TurnManager } from "../../engine/rules/TurnManager";
import * as path from "path";

describe("Set Bulwark Action Integration Test (Phase 21B.8.1)", () => {
  let rulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  it("should load setBulwark action with usageLimit and bulwark component correctly", () => {
    const setAction = rulePackage.actions.find((a) => a.id === "action.setBulwark");
    const bulwarkComponent = rulePackage.components.find((c) => c.id === "character.bulwark");

    expect(setAction).toBeDefined();
    expect(setAction?.name).toBe("防壁設置");
    expect(setAction?.request?.usageLimit).toEqual({ scope: "turn", max: 1 });
    expect(setAction?.request?.speed).toBe("immediate");
    expect(bulwarkComponent).toBeDefined();
    expect(bulwarkComponent?.name).toBe("防壁");
  });

  it("should format action summary for Set Bulwark action correctly without lonely star", () => {
    const setAction = rulePackage.actions.find((a) => a.id === "action.setBulwark")!;
    const summary = formatActionSummary(setAction);
    expect(summary).toBe("防壁設置 @直接-即時-メイン | $L");
  });

  it("should enforce usageLimit: 1 per turn (fail on 2nd attempt in same turn, allowed on next turn)", () => {
    const setAction = rulePackage.actions.find((a) => a.id === "action.setBulwark")!;
    const registry = new CommandRegistry();

    const state: any = {
      turnCount: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          name: "Player A",
          life: [
            { id: "l1", suit: "S", rank: "2", value: 2 },
            { id: "l2", suit: "S", rank: "3", value: 3 },
          ],
          hand: [
            { id: "h1", suit: "H", rank: "5", value: 5 },
            { id: "h2", suit: "D", rank: "8", value: 8 },
          ],
          field: [],
          grave: [],
          fog: [],
        },
      },
      turnUsage: {},
      stage: { requests: [], history: [] },
    };

    const context1: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };

    // 1回目のリクエスト生成（成功）
    const req1 = registry.createRequest(setAction, context1);
    expect(req1).toBeDefined();
    expect(state.turnUsage.p1["action.setBulwark"]).toBe(1);

    // 2回目のリクエスト生成（同ターン内はエラー）
    const context2: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };
    expect(() => registry.createRequest(setAction, context2)).toThrow(/上限回数/);

    // ターン交代で turnUsage がリセットされる
    TurnManager.endTurn(state);
    expect(state.turnUsage.p1).toBeUndefined();

    // ターン経過後（Player Aの手番再来時）は再度使用可能
    state.turnPlayer = "p1";
    state.chancePlayer = "p1";
    const context3: CommandContext = {
      state,
      playerKey: "p1",
      actions: rulePackage.actions,
      components: rulePackage.components,
    };
    expect(() => registry.createRequest(setAction, context3)).not.toThrow();
  });

  it("should interrupt and request card selection Decision, then summon bulwark face-down in charge state", () => {
    const handCardH5 = { id: "h5-uuid", code: "♡5", suit: "H", rank: "5", value: 5 };
    const handCardS2 = { id: "s2-uuid", code: "♠2", suit: "S", rank: "2", value: 2 }; // スペードは防壁不可 (character.bulwark は ♡/♢ のみ)

    const state: any = {
      matchId: "test-match",
      stateVersion: 1,
      turnCount: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      phase: "main",
      players: {
        p1: {
          name: "Player A",
          life: [
            { id: "life-1", suit: "S", rank: "2", value: 2 },
            { id: "life-2", suit: "S", rank: "3", value: 3 },
          ],
          hand: [handCardH5, handCardS2],
          field: [],
          grave: [],
          fog: [],
        },
        p2: {
          name: "Player B",
          life: [{ id: "life-p2", suit: "S", rank: "3", value: 3 }],
          hand: [],
          field: [],
          grave: [],
          fog: [],
        },
      },
      stage: { requests: [], history: [] },
      requestBuffer: [],
    };

    const session = new GameSession(state, rulePackage);
    const initialStep = session.advance();
    expect(initialStep.type).toBe("WAITING_FOR_DECISION");


    if (initialStep.type === "WAITING_FOR_DECISION") {
      const decReq = initialStep.request;
      // 防壁設置アクションのパターンを見つける（キーカード不要）
      const setBulwarkPatIdx = decReq.patterns.findIndex(
        (p) => p.kind === "ACTION" && decReq.catalog.actions[p.actionSelectionRef!].actionId === "action.setBulwark"
      );
      expect(setBulwarkPatIdx).toBeGreaterThanOrEqual(0);

      // 防壁設置をリクエスト
      const nextStep = session.submitDecision({
        decisionId: decReq.decisionId,
        stateVersion: decReq.stateVersion,
        selectedPatternRef: setBulwarkPatIdx,
      });

      // 効果解決時 Decision（EFFECT_SELECTION: 手札から防壁カード選択）が発生すること
      expect(nextStep.type).toBe("WAITING_FOR_DECISION");
      if (nextStep.type === "WAITING_FOR_DECISION") {
        expect(nextStep.request.source.type).toBe("EFFECT_RESOLUTION");
        expect(nextStep.request.patterns.length).toBe(1); // ♡5 のみが候補（♠2は除外）
        const effSelection = nextStep.request.catalog.effectSelections[0];
        expect(effSelection.selectedValues).toEqual(["h5-uuid"]);
        expect(effSelection.summary).toContain("防壁カード選択");

        // カードを選択して解決
        const finishStep = session.submitDecision({
          decisionId: nextStep.request.decisionId,
          stateVersion: nextStep.request.stateVersion,
          selectedPatternRef: 0,
        });

        // 検証：手札から ♡5 が消費され、♠2 のみが残る
        expect(state.players.p1.hand.length).toBe(1);
        expect(state.players.p1.hand[0].id).toBe("s2-uuid");

        // 検証：コストLによりライフが1消費されたこと (2枚 -> 1枚)
        expect(state.players.p1.life.length).toBe(1);


        // 検証：場に防壁が裏向き・チャージ状態で召喚されたこと
        expect(state.players.p1.field.length).toBe(1);
        const summonedBulwark = state.players.p1.field[0];
        expect(summonedBulwark.kind).toBe("防壁");
        expect(summonedBulwark.componentId).toBe("character.bulwark");
        expect(summonedBulwark.state).toBe("charge");
        expect(summonedBulwark.face).toBe("down");
        expect(summonedBulwark.cards.length).toBe(1);
        expect(summonedBulwark.cards[0].id).toBe("h5-uuid");
        expect(summonedBulwark.labels).toEqual(["defense"]); // 攻撃ラベルを持たない
      }
    }
  });
});

