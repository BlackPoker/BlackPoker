import { describe, it, expect, beforeEach } from "vitest";
import path from "path";
import { GameSession } from "../../engine/session/GameSession";
import { RulePackage } from "../../domain/rules/RulePackage";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { loadRegulationCatalog } from "../../engine/regulation/RegulationLoader";
import { RegulationRulePackageSelector } from "../../engine/regulation/RegulationRulePackageSelector";
import { buildUnitSetSelectionModel } from "../../ui/decision/AttackerSelectionEditor";

describe("奇襲後の召喚酔い・速攻 アタッカー適格性回帰テスト", () => {
  let masterRulePackage: RulePackage;

  beforeEach(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    const basePackage = await loadRulePackageFromDirectory(rulesDir);
    const catalog = await loadRegulationCatalog();
    const format = catalog.formats.get("mast")!;
    const regulation = catalog.regulations.get("mast-strategy")!;
    const frame = catalog.frames.get("strategy")!;

    masterRulePackage = RegulationRulePackageSelector.selectRulePackage(
      basePackage,
      format,
      regulation,
      frame
    );
  });

  function createBaseState(): any {
    return {
      stateVersion: 1,
      turn: 3,
      turnCount: 3,
      turnPlayer: "p1",
      chancePlayer: "p1",
      focusPlayer: "p1",
      players: {
        p1: {
          name: "Player 1",
          hand: [
            { id: "c-club-2", suit: "C", rank: "2", value: 2 },
            { id: "c-club-3", suit: "C", rank: "3", value: 3 },
          ],
          field: [],
          graveyard: [],
          fog: [],
          life: [
            { id: "p1-l1", suit: "S", rank: "4", value: 4 },
            { id: "p1-l2", suit: "S", rank: "9", value: 9 },
          ],
        },
        p2: {
          name: "Player 2",
          hand: [],
          field: [],
          graveyard: [],
          fog: [],
          life: [
            { id: "p2-l1", suit: "H", rank: "4", value: 4 },
            { id: "p2-l2", suit: "H", rank: "9", value: 9 },
          ],
        },
      },
      stage: {
        requests: [],
        pendingDamage: null,
        pendingEndTurn: false,
      },
      turnUsage: {
        p1: { actions: {} },
        p2: { actions: {} },
      },
    };
  }

  function resolveStageToEmpty(session: GameSession, initialStep: any): any {
    let step = initialStep;
    let safety = 0;
    while (step.type === "WAITING_FOR_DECISION" && safety < 20) {
      safety++;
      const req = step.request;
      const stageLen = (session.state as any).stage?.requests?.length ?? 0;
      if (stageLen === 0 && req.source?.type === "ACTION_REQUEST" && req.playerId === "p1") {
        break;
      }
      const passIdx = req.patterns.findIndex((p: any) => p.kind === "PASS");
      if (passIdx < 0) {
        break;
      }
      step = session.submitDecision({
        decisionId: req.decisionId,
        stateVersion: req.stateVersion,
        selectedPatternRef: passIdx,
      });
    }
    return step;
  }

  it("公式RulePackageで奇襲(action.surprise)を実際に解決後、action.attackの合法パターンとUI候補が召喚酔い・速攻を正確に判定すること", () => {
    const state = createBaseState();

    state.players.p1.field = [
      {
        unitId: "old-bulwark",
        componentId: "character.bulwark",
        kind: "防壁",
        cards: [{ id: "c-old-bw", suit: "S", rank: "5", value: 5 }],
        face: "down",
        state: "charge",
        labels: ["defense"],
        enteredTurn: 1,
        enteredFieldTurn: 1,
        enteredFieldBeforeGame: false,
      },
      {
        unitId: "new-bulwark",
        componentId: "character.bulwark",
        kind: "防壁",
        cards: [{ id: "c-new-bw", suit: "H", rank: "6", value: 6 }],
        face: "down",
        state: "charge",
        labels: ["defense"],
        enteredTurn: 3,
        enteredFieldTurn: 3,
        enteredFieldBeforeGame: false,
      },
      {
        unitId: "old-soldier",
        componentId: "character.soldier",
        kind: "一般兵",
        cards: [{ id: "c-old-sol", suit: "D", rank: "4", value: 4 }],
        face: "up",
        state: "drive",
        labels: ["attack"],
        enteredTurn: 1,
        enteredFieldTurn: 1,
        enteredFieldBeforeGame: false,
      },
      {
        unitId: "new-soldier",
        componentId: "character.soldier",
        kind: "一般兵",
        cards: [{ id: "c-new-sol", suit: "C", rank: "7", value: 7 }],
        face: "up",
        state: "drive",
        labels: ["attack"],
        enteredTurn: 3,
        enteredFieldTurn: 3,
        enteredFieldBeforeGame: false,
      },
      {
        unitId: "new-ace-bulwark",
        componentId: "character.bulwark",
        kind: "防壁",
        cards: [{ id: "c-new-ace-bw", suit: "S", rank: "A", value: 1 }],
        face: "down",
        state: "drive",
        labels: ["defense"],
        enteredTurn: 3,
        enteredFieldTurn: 3,
        enteredFieldBeforeGame: false,
      },
    ];

    const session = new GameSession(state, masterRulePackage);
    expect((session.state as any).turnCount).toBe(3);
    let step: any = session.advance();
    expect(step.type).toBe("WAITING_FOR_DECISION");

    // 合法パターンから action.surprise を選択
    const surpriseIdx = step.request.patterns.findIndex((p: any) => {
      if (p.kind !== "ACTION" || p.actionSelectionRef === undefined) return false;
      return step.request.catalog.actions?.[p.actionSelectionRef]?.actionId === "action.surprise";
    });
    expect(surpriseIdx).toBeGreaterThanOrEqual(0);

    step = session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: surpriseIdx,
    });

    // ステージが空になるまでパスを進めて奇襲を解決
    step = resolveStageToEmpty(session, step);
    expect(step.type).toBe("WAITING_FOR_DECISION");

    // 奇襲解決後の検証: ターン番号3のまま、変形・チャージ状態・登場ターン維持
    const afterState = session.state as any;
    expect(afterState.turnCount).toBe(3);

    const p1Field = afterState.players.p1.field;
    const oldBulwarkAfter = p1Field.find((u: any) => u.unitId === "old-bulwark");
    const newBulwarkAfter = p1Field.find((u: any) => u.unitId === "new-bulwark");
    const oldSoldierAfter = p1Field.find((u: any) => u.unitId === "old-soldier");
    const newSoldierAfter = p1Field.find((u: any) => u.unitId === "new-soldier");
    const newAceAfter = p1Field.find((u: any) => u.unitId === "new-ace-bulwark");

    expect(oldBulwarkAfter.componentId).toBe("character.soldier");
    expect(oldBulwarkAfter.state).toBe("charge");
    expect(oldBulwarkAfter.enteredFieldTurn).toBe(1);
    expect(oldBulwarkAfter.enteredFieldBeforeGame).toBe(false);

    expect(newBulwarkAfter.componentId).toBe("character.soldier");
    expect(newBulwarkAfter.state).toBe("charge");
    expect(newBulwarkAfter.enteredFieldTurn).toBe(3);
    expect(newBulwarkAfter.enteredFieldBeforeGame).toBe(false);

    expect(oldSoldierAfter.state).toBe("charge");
    expect(newSoldierAfter.state).toBe("charge");

    expect(newAceAfter.componentId).toBe("character.ace");
    expect(newAceAfter.state).toBe("charge");
    expect(newAceAfter.enteredFieldTurn).toBe(3);
    expect(newAceAfter.enteredFieldBeforeGame).toBe(false);

    // 合法パターンから action.attack を選択
    const attackIdx = step.request.patterns.findIndex((p: any) => {
      if (p.kind !== "ACTION" || p.actionSelectionRef === undefined) return false;
      return step.request.catalog.actions?.[p.actionSelectionRef]?.actionId === "action.attack";
    });
    expect(attackIdx).toBeGreaterThanOrEqual(0);

    step = session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: attackIdx,
    });

    // アタッカー選択の EFFECT_RESOLUTION までパスを進める
    let safety = 0;
    while (
      step.type === "WAITING_FOR_DECISION" &&
      step.request.source?.type !== "EFFECT_RESOLUTION" &&
      safety < 10
    ) {
      safety++;
      const passIdx = step.request.patterns.findIndex((p: any) => p.kind === "PASS");
      expect(passIdx).toBeGreaterThanOrEqual(0);
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: passIdx,
      });
    }

    // 合法手とUI候補の検証
    expect((session.state as any).turnCount).toBe(3);
    expect(step.type).toBe("WAITING_FOR_DECISION");
    expect(step.request.source?.type).toBe("EFFECT_RESOLUTION");
    expect(step.request.source?.sourceActionId).toBe("action.attack");

    const legalSelectedIds = new Set<string>();
    for (const p of step.request.patterns) {
      if (p.effectSelectionRef === undefined) continue;
      const eff = step.request.catalog.effectSelections?.[p.effectSelectionRef];
      for (const v of eff?.selectedValues ?? []) {
        legalSelectedIds.add(v);
      }
    }

    const expectedEligibleIds = ["old-bulwark", "old-soldier", "new-ace-bulwark"].sort();
    expect([...legalSelectedIds].sort()).toEqual(expectedEligibleIds);

    // 否定検証: 今ターン防壁変形・今ターン召喚一般兵は指定不可
    expect(legalSelectedIds.has("new-bulwark")).toBe(false);
    expect(legalSelectedIds.has("new-soldier")).toBe(false);

    // buildUnitSetSelectionModel の候補もCoreの合法手と一致する
    const uiModel = buildUnitSetSelectionModel(step.request);
    expect(uiModel.isUnitSetSelection).toBe(true);
    expect([...uiModel.candidateUnitIds].sort()).toEqual(expectedEligibleIds);
  });
});
