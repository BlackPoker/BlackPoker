import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage } from "../../domain/rules/RulePackage";
import { GameSession } from "../../engine/session/GameSession";
import { CommandRegistry } from "../../engine/rules/CommandRegistry";

describe("End -> Charge -> Draw Chance Transition Test (Phase 21B.8.2)", () => {
  let rulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  it("should pass chance to new turnPlayer (p2) after Draw is staged, then cycle chance on PASS and resolve", () => {
    // Player A (p1) の手番終了直前（End アクションがリクエストされた状態）
    const state: any = {
      matchId: "test-chance-flow",
      stateVersion: 1,
      turnCount: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          name: "Player A",
          life: [
            { id: "l1-1", suit: "S", rank: "2", value: 2 },
            { id: "l1-2", suit: "S", rank: "3", value: 3 },
          ],
          hand: [],
          field: [
            {
              unitId: "u1",
              componentId: "character.soldier",
              kind: "一般兵",
              state: "drive",
              cards: [{ id: "c1", suit: "S", rank: "5", value: 5 }],
              labels: ["攻撃", "防御"],
            },
          ],
          fog: [],
          grave: [],
        },
        p2: {
          name: "Player B",
          life: [
            { id: "l2-1", suit: "H", rank: "2", value: 2 },
            { id: "l2-2", suit: "H", rank: "3", value: 3 },
            { id: "l2-3", suit: "H", rank: "4", value: 4 },
          ],
          hand: [],
          field: [
            {
              unitId: "u2",
              componentId: "character.soldier",
              kind: "一般兵",
              state: "drive",
              cards: [{ id: "c2", suit: "H", rank: "5", value: 5 }],
              labels: ["攻撃", "防御"],
            },
          ],
          fog: [],
          grave: [],
        },
      },
      stage: { requests: [], history: [] },
      requestBuffer: { requests: [], history: [] },
    };

    const session = new GameSession(state, rulePackage);

    // 1. Player A がエンドアクションをリクエスト
    const endAction = rulePackage.actions.find((a) => a.id === "action.end")!;
    expect(endAction).toBeDefined();

    const initialStep = session.advance();
    expect(initialStep.type).toBe("WAITING_FOR_DECISION");
    expect(initialStep.request.playerId).toBe("p1");

    const endPatternIdx = initialStep.request.patterns.findIndex(
      (p) => p.kind === "ACTION" && initialStep.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.end"
    );
    expect(endPatternIdx).toBeGreaterThanOrEqual(0);

    // End リクエスト提出 (Stage に積まれ、チャンスは p1 が維持)
    const afterEndReq = session.submitDecision({
      decisionId: initialStep.request.decisionId,
      stateVersion: initialStep.request.stateVersion,
      selectedPatternRef: endPatternIdx,
    });

    expect(state.stage.requests.length).toBe(1);
    expect(state.stage.requests[0].actionId).toBe("action.end");
    expect(state.chancePlayer).toBe("p1");

    // p1 が PASS -> チャンスが p2 へ
    const p1EndPassIdx = afterEndReq.request.patterns.findIndex((p) => p.kind === "PASS");
    expect(p1EndPassIdx).toBeGreaterThanOrEqual(0);
    const afterP1EndPass = session.submitDecision({
      decisionId: afterEndReq.request.decisionId,
      stateVersion: afterEndReq.request.stateVersion,
      selectedPatternRef: p1EndPassIdx,
    });

    expect(state.chancePlayer).toBe("p2");
    expect(afterP1EndPass.type).toBe("WAITING_FOR_DECISION");
    expect(afterP1EndPass.request.playerId).toBe("p2");

    // p2 が PASS -> 全員連続PASS成立により End が解決される
    const p2EndPassIdx = afterP1EndPass.request.patterns.findIndex((p) => p.kind === "PASS");
    expect(p2EndPassIdx).toBeGreaterThanOrEqual(0);
    const afterP2EndPass = session.submitDecision({
      decisionId: afterP1EndPass.request.decisionId,
      stateVersion: afterP1EndPass.request.stateVersion,
      selectedPatternRef: p2EndPassIdx,
    });

    // A & B: End 解決により turnPlayer が Player B (p2) になる
    expect(state.turnPlayer).toBe("p2");
    expect(state.turnCount).toBe(2);

    // D & E: Charge は immediate なので即時解決され、p2 のユニットが charge 状態になる
    expect(state.players.p2.field[0].state).toBe("charge");

    // F & G: Draw が誘発し Stage に積まれる
    expect(state.stage.requests.length).toBe(1);
    expect(state.stage.requests[0].actionId).toBe("action.draw");

    // H: この時点で turnPlayer = "p2", chancePlayer = "p2"
    expect(state.turnPlayer).toBe("p2");
    expect(state.chancePlayer).toBe("p2");

    // I: 次の DecisionRequest.playerId も p2
    expect(afterP2EndPass.type).toBe("WAITING_FOR_DECISION");
    expect(afterP2EndPass.request.playerId).toBe("p2");

    // J: p2 が PASS -> chancePlayer が p1 になる
    const p2DrawPassIdx = afterP2EndPass.request.patterns.findIndex((p) => p.kind === "PASS");
    expect(p2DrawPassIdx).toBeGreaterThanOrEqual(0);

    const afterP2DrawPass = session.submitDecision({
      decisionId: afterP2EndPass.request.decisionId,
      stateVersion: afterP2EndPass.request.stateVersion,
      selectedPatternRef: p2DrawPassIdx,
    });

    expect(state.chancePlayer).toBe("p1");
    expect(afterP2DrawPass.type).toBe("WAITING_FOR_DECISION");
    expect(afterP2DrawPass.request.playerId).toBe("p1");

    // K: p1 も PASS -> Draw 解決
    const p1DrawPassIdx = afterP2DrawPass.request.patterns.findIndex((p) => p.kind === "PASS");
    expect(p1DrawPassIdx).toBeGreaterThanOrEqual(0);

    const afterP1DrawPass = session.submitDecision({
      decisionId: afterP2DrawPass.request.decisionId,
      stateVersion: afterP2DrawPass.request.stateVersion,
      selectedPatternRef: p1DrawPassIdx,
    });

    // L: Draw 解決後、p2 が 2枚ドローし、chancePlayer は turnPlayer (p2) に戻る
    expect(state.stage.requests.length).toBe(0);
    expect(state.players.p2.hand.length).toBe(2);
    expect(state.chancePlayer).toBe("p2");
    expect(afterP1DrawPass.type).toBe("WAITING_FOR_DECISION");
    expect(afterP1DrawPass.request.playerId).toBe("p2");
  });
});

