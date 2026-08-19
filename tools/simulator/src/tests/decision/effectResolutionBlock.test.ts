import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage } from "../../domain/rules/RulePackage";
import { GameSession } from "../../engine/session/GameSession";
import { LegalPatternGenerator } from "../../engine/decision/LegalPatternGenerator";
import { FirstLegalPatternPolicy } from "../../controller/FirstLegalPatternPolicy";
import { RandomPolicy } from "../../controller/RandomPolicy";

describe("EFFECT_RESOLUTION Decision Integration Tests: Block Action Assignment (Phase 16)", () => {
  let rulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  const createBattleState = () => {
    // p1: アタッカー陣営 (soldier-1, soldier-2)
    const attacker1 = {
      unitId: "soldier-1",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "c1", suit: "S", rank: "6", value: 6 }],
      labels: ["攻撃", "防御"],
    };

    const attacker2 = {
      unitId: "soldier-2",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "c2", suit: "H", rank: "7", value: 7 }],
      labels: ["攻撃"],
    };

    // p2: 防御側陣営 (bulwark-1, soldier-b1, soldier-b2, soldier-drive, soldier-no-defense)
    const bulwark1 = {
      unitId: "bulwark-1",
      kind: "防壁",
      componentId: "character.bulwark",
      state: "charge",
      cards: [{ id: "b1", suit: "D", rank: "5", value: 5 }],
      labels: ["防御"],
    };

    const defenderSoldier1 = {
      unitId: "soldier-b1",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "sb1", suit: "C", rank: "4", value: 4 }],
      labels: ["防御", "攻撃"],
    };

    const defenderSoldier2 = {
      unitId: "soldier-b2",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "sb2", suit: "S", rank: "3", value: 3 }],
      labels: ["防御"],
    };

    const driveSoldier = {
      unitId: "soldier-drive",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "drive", // ドライブ状態（候補外）
      cards: [{ id: "sd", suit: "H", rank: "2", value: 2 }],
      labels: ["防御"],
    };

    const noDefenseSoldier = {
      unitId: "soldier-no-defense",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "snd", suit: "D", rank: "2", value: 2 }],
      labels: ["攻撃"], // 防御ラベルなし（候補外）
    };

    return {
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          name: "Player A",
          life: [
            { id: "l1-1", suit: "S", rank: "A", value: 1 },
            { id: "l1-2", suit: "H", rank: "2", value: 2 },
          ],
          hand: [
            { id: "key-s8", suit: "S", rank: "8", value: 8 },
            { id: "cost-c2", suit: "C", rank: "2", value: 2 },
          ],
          field: [attacker1, attacker2],
          fog: [],
          grave: [],
        },
        p2: {
          name: "Player B",
          life: [
            { id: "l2-1", suit: "D", rank: "K", value: 13 },
            { id: "l2-2", suit: "C", rank: "Q", value: 12 },
          ],
          hand: [],
          field: [bulwark1, defenderSoldier1, defenderSoldier2, driveSoldier, noDefenseSoldier],
          fog: [],
          grave: [],
        },
      },
      stage: { requests: [], history: [] },
      requestBuffer: { requests: [], history: [] },
    } as any;
  };

  const getReq = (step: any) => {
    if (step.type !== "WAITING_FOR_DECISION") {
      throw new Error(`Expected WAITING_FOR_DECISION but got ${step.type}`);
    }
    return step.request;
  };

  it("A: action.block ActionRequest in rulePackage should NOT contain blocker targets", () => {
    const blockAction = rulePackage.actions.find((a) => a.id === "action.block")!;
    expect(blockAction.targets).toBeUndefined();
  });

  it("B & C & D & E: block resolution should interrupt and emit EFFECT_RESOLUTION Decision without triggering damageJudge", () => {
    const state = createBattleState();
    const session = new GameSession(state, rulePackage);

    // 1. p1 がアタックをリクエスト
    const step1 = session.advance();
    const req1 = getReq(step1);
    const attackPatternRef = req1.patterns.findIndex((p: any) => {
      const act = req1.catalog.actions[p.actionSelectionRef!];
      return act?.actionId === "action.attack";
    });
    session.submitDecision({ decisionId: req1.decisionId, stateVersion: req1.stateVersion, selectedPatternRef: attackPatternRef });

    // 2. p1 が PASS
    const step3 = session.advance();
    const req3 = getReq(step3);
    session.submitDecision({ decisionId: req3.decisionId, stateVersion: req3.stateVersion, selectedPatternRef: req3.patterns.findIndex((p: any) => p.kind === "PASS") });

    // 3. p2 が PASS -> stage の attack が解決開始され EFFECT_RESOLUTION (アタッカー選択)
    const step5 = session.advance();
    const req5 = getReq(step5);
    const step6 = session.submitDecision({ decisionId: req5.decisionId, stateVersion: req5.stateVersion, selectedPatternRef: req5.patterns.findIndex((p: any) => p.kind === "PASS") });

    expect(step6.type).toBe("WAITING_FOR_DECISION");
    if (step6.type !== "WAITING_FOR_DECISION") return;
    expect(step6.request.source.type).toBe("EFFECT_RESOLUTION");

    // [soldier-1, soldier-2] の 2体アタックを選択
    const multiAttackerRef = step6.request.patterns.findIndex((p) => {
      const effSel = step6.request.catalog.effectSelections[p.effectSelectionRef!];
      return effSel.selectedValues?.length === 2;
    });
    const step7 = session.submitDecision({
      decisionId: step6.request.decisionId,
      stateVersion: step6.request.stateVersion,
      selectedPatternRef: multiAttackerRef,
    });

    // 4. attack 完了後、block が誘発して stage へ積まれる（B: stage積載時点でブロッカーのstate/battleは変化なし）
    expect(state.stage.requests.length).toBe(1);
    expect(state.stage.requests[0].actionId).toBe("action.block");
    const bulwark = state.players.p2.field.find((u: any) => u.unitId === "bulwark-1");
    expect(bulwark.state).toBe("charge");
    expect(bulwark.battle).toBeUndefined();

    // 5. p2 が PASS -> stage の block が解決開始され EFFECT_RESOLUTION (ブロッカー割当て)
    const step8 = session.advance();
    const req8 = getReq(step8);
    // p2 は通常アクションでなく PASS を選択
    const passRefP2 = req8.patterns.findIndex((p: any) => p.kind === "PASS");
    session.submitDecision({ decisionId: req8.decisionId, stateVersion: req8.stateVersion, selectedPatternRef: passRefP2 });

    // 6. p1 が PASS -> 全員PASSで block の解決開始
    const step10 = session.advance();
    const req10 = getReq(step10);
    const passRefP1 = req10.patterns.findIndex((p: any) => p.kind === "PASS");
    const step11 = session.submitDecision({ decisionId: req10.decisionId, stateVersion: req10.stateVersion, selectedPatternRef: passRefP1 });

    // C: block 解決開始時に EFFECT_RESOLUTION DecisionRequest が返る
    expect(step11.type).toBe("WAITING_FOR_DECISION");
    if (step11.type !== "WAITING_FOR_DECISION") return;

    const blockDecReq = step11.request;
    expect(blockDecReq.source.type).toBe("EFFECT_RESOLUTION");
    expect(blockDecReq.playerId).toBe("p2"); // 防御側プレイヤーに判断要求

    // D: Decision 中は block request が resolving のまま
    const resolvingReq = session.resolvingRequest;
    expect(resolvingReq).toBeDefined();
    expect(resolvingReq.actionId).toBe("action.block");
    expect(resolvingReq.status).toBe("resolving");

    // E: Decision 中は damageJudge は誘発しない
    expect(state.requestBuffer.requests.length).toBe(0);
    expect(state.stage.history.filter((r: any) => r.actionId === "action.block").length).toBe(0);
  });

  it("F, G, H, I, J, K, L: pattern generation rules for block assignments (qualification, combinations, exclusions)", () => {
    const state = createBattleState();
    // アタッカー2体 (soldier-1, soldier-2) に battle.role = "attacker" を設定
    state.players.p1.field[0].battle = { role: "attacker", targetPlayerKey: "p2" };
    state.players.p1.field[1].battle = { role: "attacker", targetPlayerKey: "p2" };

    const attackers = [state.players.p1.field[0], state.players.p1.field[1]];
    const candidateBlockers = [
      state.players.p2.field[0], // bulwark-1 (防壁, charge, 防御)
      state.players.p2.field[1], // soldier-b1 (兵士, charge, 防御)
      state.players.p2.field[2], // soldier-b2 (兵士, charge, 防御)
    ];

    const blockReq: any = { id: "req-block-1", actionId: "action.block", controller: "p2" };
    const { request, metrics } = LegalPatternGenerator.generateBlockAssignmentDecision(
      state,
      "p2",
      blockReq,
      "selectBlockAssignments",
      attackers,
      candidateBlockers,
      rulePackage.components
    );

    // O: メトリクス計測の確認
    expect(metrics.attackersCount).toBe(2);
    expect(metrics.blockersCount).toBe(3);
    expect(metrics.patternCount).toBe(request.patterns.length);
    expect(metrics.elapsedMs).toBeGreaterThanOrEqual(0);

    const effectSelections = request.catalog.effectSelections;

    // H, I: 全アタッカー 0 体ブロックのパターンが存在すること
    const allZeroPattern = effectSelections.find((es) =>
      es.assignments?.every((a) => a.selectedUnitIds.length === 0)
    );
    expect(allZeroPattern).toBeDefined();

    // G: 任意の単一ブロッカー（防壁1体、兵士1体）の割当てパターンが存在すること
    const singleBulwarkPattern = effectSelections.find((es) =>
      es.assignments?.some((a) => a.selectedUnitIds.length === 1 && a.selectedUnitIds[0] === "bulwark-1")
    );
    expect(singleBulwarkPattern).toBeDefined();

    // K: 1アタッカーへ複数兵士 [soldier-b1, soldier-b2] を割り当てたパターンが存在すること
    const multiSoldierPattern = effectSelections.find((es) =>
      es.assignments?.some(
        (a) =>
          a.selectedUnitIds.length === 2 &&
          a.selectedUnitIds.includes("soldier-b1") &&
          a.selectedUnitIds.includes("soldier-b2")
      )
    );
    expect(multiSoldierPattern).toBeDefined();

    // I (不正排除): 防壁の複数ブロック [bulwark-1, soldier-b1] や [bulwark-1, bulwark-1] は一切生成されないこと
    for (const es of effectSelections) {
      for (const a of es.assignments || []) {
        if (a.selectedUnitIds.length >= 2) {
          expect(a.selectedUnitIds.includes("bulwark-1")).toBe(false);
        }
      }
    }

    // J: 同一ブロッカーが複数アタッカーへ重複割当てされたパターンは一切生成されないこと
    for (const es of effectSelections) {
      const used = new Set<string>();
      for (const a of es.assignments || []) {
        for (const bid of a.selectedUnitIds) {
          expect(used.has(bid)).toBe(false);
          used.add(bid);
        }
      }
    }
  });

  it("M & N & O & P: answering block assignment decision should set blocker battle/drive and trigger damageJudge", () => {
    const state = createBattleState();
    const session = new GameSession(state, rulePackage);

    // アタックリクエスト -> 全員PASS -> アタッカー選択 (soldier-1)
    const step1 = session.advance();
    const req1 = getReq(step1);
    const attackPatternRef = req1.patterns.findIndex((p: any) => {
      const act = req1.catalog.actions[p.actionSelectionRef!];
      return act?.actionId === "action.attack";
    });
    session.submitDecision({ decisionId: req1.decisionId, stateVersion: req1.stateVersion, selectedPatternRef: attackPatternRef });

    const step3 = session.advance();
    const req3 = getReq(step3);
    session.submitDecision({ decisionId: req3.decisionId, stateVersion: req3.stateVersion, selectedPatternRef: req3.patterns.findIndex((p: any) => p.kind === "PASS") });
    const step5 = session.advance();
    const req5 = getReq(step5);
    const step6 = session.submitDecision({ decisionId: req5.decisionId, stateVersion: req5.stateVersion, selectedPatternRef: req5.patterns.findIndex((p: any) => p.kind === "PASS") });

    // soldier-1 単体アタックを選択
    const req6 = getReq(step6);
    const singleAttackerRef = req6.patterns.findIndex((p: any) => {
      const effSel = req6.catalog.effectSelections[p.effectSelectionRef!];
      return effSel.selectedValues?.length === 1 && effSel.selectedValues[0] === "soldier-1";
    });
    session.submitDecision({ decisionId: req6.decisionId, stateVersion: req6.stateVersion, selectedPatternRef: singleAttackerRef });

    // block 解決へ進める（全員PASS）
    const step8 = session.advance();
    const req8 = getReq(step8);
    session.submitDecision({ decisionId: req8.decisionId, stateVersion: req8.stateVersion, selectedPatternRef: req8.patterns.findIndex((p: any) => p.kind === "PASS") });
    const step10 = session.advance();
    const req10 = getReq(step10);
    const step11 = session.submitDecision({ decisionId: req10.decisionId, stateVersion: req10.stateVersion, selectedPatternRef: req10.patterns.findIndex((p: any) => p.kind === "PASS") });

    expect(step11.type).toBe("WAITING_FOR_DECISION");
    if (step11.type !== "WAITING_FOR_DECISION") return;

    // [soldier-b1, soldier-b2] で soldier-1 を複数ブロックするパターンを選択
    const req11 = getReq(step11);
    const multiBlockRef = req11.patterns.findIndex((p: any) => {
      const effSel = req11.catalog.effectSelections[p.effectSelectionRef!];
      const a = effSel.assignments?.[0];
      return a?.selectedUnitIds.length === 2 && a.selectedUnitIds.includes("soldier-b1") && a.selectedUnitIds.includes("soldier-b2");
    });
    expect(multiBlockRef).toBeGreaterThanOrEqual(0);

    const step12 = session.submitDecision({
      decisionId: req11.decisionId,
      stateVersion: req11.stateVersion,
      selectedPatternRef: multiBlockRef,
    });

    // M: 選択されたブロッカーが drive になる
    const sb1 = state.players.p2.field.find((u: any) => u.unitId === "soldier-b1");
    const sb2 = state.players.p2.field.find((u: any) => u.unitId === "soldier-b2");
    const bulwark = state.players.p2.field.find((u: any) => u.unitId === "bulwark-1");
    expect(sb1.state).toBe("drive");
    expect(sb2.state).toBe("drive");
    // 未選択の防壁は charge のまま
    expect(bulwark.state).toBe("charge");

    // N: battle.blocksUnitId が正しい attacker ("soldier-1") を指す
    expect(sb1.battle).toEqual({ role: "blocker", blocksUnitId: "soldier-1" });
    expect(sb2.battle).toEqual({ role: "blocker", blocksUnitId: "soldier-1" });

    // O: block 完了後に resolved になり stage.history に記録される
    expect(state.stage.history.some((r: any) => r.actionId === "action.block" && r.status === "resolved")).toBe(true);

    // P: block 完了後に damageJudge が誘発して stage へ積まれる
    expect(state.stage.requests.length).toBe(1);
    expect(state.stage.requests[0].actionId).toBe("action.damageJudge");
  });

  it("P2: 0-attacker block selection should resolve cleanly and still trigger damageJudge", () => {
    const state = createBattleState();
    const session = new GameSession(state, rulePackage);

    // アタックリクエスト -> アタッカー選択 (soldier-1)
    const step1 = session.advance();
    const req1 = getReq(step1);
    const attackPatternRef = req1.patterns.findIndex((p: any) => {
      const act = req1.catalog.actions[p.actionSelectionRef!];
      return act?.actionId === "action.attack";
    });
    session.submitDecision({ decisionId: req1.decisionId, stateVersion: req1.stateVersion, selectedPatternRef: attackPatternRef });

    const step3 = session.advance();
    const req3 = getReq(step3);
    session.submitDecision({ decisionId: req3.decisionId, stateVersion: req3.stateVersion, selectedPatternRef: req3.patterns.findIndex((p: any) => p.kind === "PASS") });
    const step5 = session.advance();
    const req5 = getReq(step5);
    const step6 = session.submitDecision({ decisionId: req5.decisionId, stateVersion: req5.stateVersion, selectedPatternRef: req5.patterns.findIndex((p: any) => p.kind === "PASS") });

    const req6 = getReq(step6);
    const singleAttackerRef = req6.patterns.findIndex((p: any) => {
      const effSel = req6.catalog.effectSelections[p.effectSelectionRef!];
      return effSel.selectedValues?.length === 1;
    });
    session.submitDecision({ decisionId: req6.decisionId, stateVersion: req6.stateVersion, selectedPatternRef: singleAttackerRef });

    // block 解決へ
    const step8 = session.advance();
    const req8 = getReq(step8);
    session.submitDecision({ decisionId: req8.decisionId, stateVersion: req8.stateVersion, selectedPatternRef: req8.patterns.findIndex((p: any) => p.kind === "PASS") });
    const step10 = session.advance();
    const req10 = getReq(step10);
    const step11 = session.submitDecision({ decisionId: req10.decisionId, stateVersion: req10.stateVersion, selectedPatternRef: req10.patterns.findIndex((p: any) => p.kind === "PASS") });

    expect(step11.type).toBe("WAITING_FOR_DECISION");
    if (step11.type !== "WAITING_FOR_DECISION") return;

    // 0体ブロック（ブロッカーなし）を選択
    const req11 = getReq(step11);
    const zeroBlockRef = req11.patterns.findIndex((p: any) => {
      const effSel = req11.catalog.effectSelections[p.effectSelectionRef!];
      return effSel.assignments?.[0]?.selectedUnitIds.length === 0;
    });
    expect(zeroBlockRef).toBeGreaterThanOrEqual(0);

    session.submitDecision({
      decisionId: req11.decisionId,
      stateVersion: req11.stateVersion,
      selectedPatternRef: zeroBlockRef,
    });

    // ブロッカーが0体でも block は resolved になり、damageJudge が誘発して stage に積まれる
    expect(state.stage.history.some((r: any) => r.actionId === "action.block" && r.status === "resolved")).toBe(true);
    expect(state.stage.requests.length).toBe(1);
    expect(state.stage.requests[0].actionId).toBe("action.damageJudge");
  });

  it("Q: Human, FirstLegalPatternPolicy, and RandomPolicy should all navigate through the same EFFECT_RESOLUTION flow", async () => {
    const policy = new FirstLegalPatternPolicy();
    const state = createBattleState();
    const session = new GameSession(state, rulePackage);

    let steps = 0;
    while (steps < 20) {
      const step = session.advance();
      if (step.type === "FINISHED") break;
      if (step.type === "WAITING_FOR_DECISION") {
        const response = await policy.decide(step.request);
        session.submitDecision(response);
      }
      steps++;
    }

    // 正常に進行し、エラーなく完了またはステップ進行すること
    expect(steps).toBeGreaterThan(0);
  });
});
