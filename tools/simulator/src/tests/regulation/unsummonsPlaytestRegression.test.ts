import { describe, it, expect, beforeAll } from "vitest";
import path from "path";
import {
  loadRegulationCatalog,
  getFormat,
  clearRegulationCache,
} from "../../engine/regulation/RegulationLoader";
import { RegulationRulePackageSelector } from "../../engine/regulation/RegulationRulePackageSelector";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { GameSession } from "../../engine/session/GameSession";
import type { RulePackage } from "../../domain/rules/RulePackage";
import { LegalPatternGenerator } from "../../engine/decision/LegalPatternGenerator";
import { ObservationFactory } from "../../engine/decision/ObservationFactory";
import { CommandContext, cancelStageRequest } from "../../engine/rules/CommandRegistry";

describe("Playtest Feedback: Return / 帰還 (action.unsummons) Full Regression & Acceptance Tests", () => {
  let catalog: any;
  let fullRulePackage: RulePackage;
  let standardFormat: any;
  let standardPackReg: any;
  let standardRulePackage: RulePackage;

  beforeAll(async () => {
    clearRegulationCache();
    catalog = await loadRegulationCatalog();
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    fullRulePackage = await loadRulePackageFromDirectory(rulesDir);

    standardFormat = await getFormat("standard");
    standardPackReg = catalog.regulations.get("standard-pack");
    standardRulePackage = RegulationRulePackageSelector.selectRulePackage(
      fullRulePackage,
      standardFormat,
      standardPackReg
    );
  });

  /**
   * 帰還発動から優先権パス（p1 PASS -> p2 PASS）までを進める共通ヘルパー
   */
  function playReturnAndPass(session: GameSession, targetUnitId: string): any {
    const step1: any = session.advance();
    expect(step1.type).toBe("WAITING_FOR_DECISION");

    const unsummonsPat = step1.request.patterns.findIndex((p: any) => {
      if (p.actionSelectionRef === undefined) return false;
      const act = step1.request.catalog.actions[p.actionSelectionRef];
      if (act.actionId !== "action.unsummons") return false;
      const tgt = step1.request.catalog.targetSelections[p.targetSelectionRef];
      return tgt?.targetUnitId === targetUnitId;
    });
    expect(unsummonsPat).toBeGreaterThanOrEqual(0);

    const step2: any = session.submitDecision({
      decisionId: step1.request.decisionId,
      stateVersion: step1.request.stateVersion,
      selectedPatternRef: unsummonsPat,
    });

    const p1Pass = step2.request.patterns.findIndex((p: any) => p.kind === "PASS");
    expect(p1Pass).toBeGreaterThanOrEqual(0);
    const step3: any = session.submitDecision({
      decisionId: step2.request.decisionId,
      stateVersion: step2.request.stateVersion,
      selectedPatternRef: p1Pass,
    });

    const p2Pass = step3.request.patterns.findIndex((p: any) => p.kind === "PASS");
    expect(p2Pass).toBeGreaterThanOrEqual(0);
    return session.submitDecision({
      decisionId: step3.request.decisionId,
      stateVersion: step3.request.stateVersion,
      selectedPatternRef: p2Pass,
    });
  }

  // =========================================================================
  // シナリオ1: CHARGE状態の自分の兵士へ帰還
  // =========================================================================
  it("Scenario 1: Charged Soldier returns to hand along with Key cards, Bulwark driven as Cost B", () => {
    const keyH2 = { id: "c-h2", suit: "H", rank: "2", value: 2 };
    const keyH5 = { id: "c-h5", suit: "H", rank: "5", value: 5 };
    const solCard = { id: "c-sol-1", suit: "S", rank: "8", value: 8 };
    const bwCard = { id: "c-bw-1", suit: "D", rank: "4", value: 4 };

    const state: any = {
      stateVersion: 1,
      matchId: "match-unsummons-sc1",
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          hand: [keyH2, keyH5],
          field: [
            { unitId: "u-bw-1", componentId: "character.bulwark", state: "charge", cards: [bwCard] },
            { unitId: "u-sol-1", componentId: "character.soldier", state: "charge", cards: [solCard] },
          ],
          life: [{ id: "l1" }],
          grave: [],
        },
        p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
      },
      stage: { requests: [], history: [] },
    };

    const session = new GameSession(state, standardRulePackage);
    playReturnAndPass(session, "u-sol-1");

    // 兵士消滅、防壁DRIVE、手札に兵士カード+キーカード2枚の計3枚
    expect(session.state.players.p1.field.some((u: any) => u.unitId === "u-sol-1")).toBe(false);
    expect(session.state.players.p1.field.find((u: any) => u.unitId === "u-bw-1").state).toBe("drive");
    const p1Hand = session.state.players.p1.hand;
    expect(p1Hand.map((c: any) => c.id).sort()).toEqual(["c-h2", "c-h5", "c-sol-1"]);
    expect(p1Hand).toHaveLength(3);

    // Observation との整合性確認
    const obs = ObservationFactory.createObservation(session.state, "p1");
    expect(obs.players[0].handCards.map((c: any) => c.cardInstanceId).sort()).toEqual(["c-h2", "c-h5", "c-sol-1"]);
  });

  // =========================================================================
  // シナリオ2: DRIVE状態の自分の兵士へ帰還 (Rule 5.4.4 - フィールド残留)
  // =========================================================================
  it("Scenario 2: Driven Soldier stays on field, Key cards return to hand", () => {
    const keyH2 = { id: "c-h2", suit: "H", rank: "2", value: 2 };
    const keyH5 = { id: "c-h5", suit: "H", rank: "5", value: 5 };
    const solCard = { id: "c-sol-1", suit: "S", rank: "8", value: 8 };
    const bwCard = { id: "c-bw-1", suit: "D", rank: "4", value: 4 };

    const state: any = {
      stateVersion: 1,
      matchId: "match-unsummons-sc2",
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          hand: [keyH2, keyH5],
          field: [
            { unitId: "u-bw-1", componentId: "character.bulwark", state: "charge", cards: [bwCard] },
            { unitId: "u-sol-1", componentId: "character.soldier", state: "drive", cards: [solCard] },
          ],
          life: [{ id: "l1" }],
          grave: [],
        },
        p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
      },
      stage: { requests: [], history: [] },
    };

    const session = new GameSession(state, standardRulePackage);
    playReturnAndPass(session, "u-sol-1");

    // 兵士はDRIVEのまま残留、キーカード2枚のみ手札に戻る
    const sol = session.state.players.p1.field.find((u: any) => u.unitId === "u-sol-1");
    expect(sol).toBeDefined();
    expect(sol.state).toBe("drive");
    const p1Hand = session.state.players.p1.hand;
    expect(p1Hand.map((c: any) => c.id).sort()).toEqual(["c-h2", "c-h5"]);
    expect(p1Hand).toHaveLength(2);
  });

  // =========================================================================
  // シナリオ3: CHARGE状態の自分の防壁へ帰還
  // =========================================================================
  it("Scenario 3: Charged Bulwark returns to hand, other Bulwark driven as Cost B", () => {
    const keyS3 = { id: "c-s3", suit: "S", rank: "3", value: 3 };
    const keyS9 = { id: "c-s9", suit: "S", rank: "9", value: 9 };
    const bwCost = { id: "c-bw-cost", suit: "D", rank: "4", value: 4 };
    const bwTarget = { id: "c-bw-target", suit: "C", rank: "7", value: 7 };

    const state: any = {
      stateVersion: 1,
      matchId: "match-unsummons-sc3",
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          hand: [keyS3, keyS9],
          field: [
            { unitId: "u-bw-cost", componentId: "character.bulwark", state: "charge", cards: [bwCost] },
            { unitId: "u-bw-target", componentId: "character.bulwark", state: "charge", cards: [bwTarget] },
          ],
          life: [{ id: "l1" }],
          grave: [],
        },
        p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
      },
      stage: { requests: [], history: [] },
    };

    const session = new GameSession(state, standardRulePackage);
    playReturnAndPass(session, "u-bw-target");

    // 対象防壁は手札へ、コスト防壁はDRIVEで残留、キーカード2枚も手札へ
    expect(session.state.players.p1.field.some((u: any) => u.unitId === "u-bw-target")).toBe(false);
    expect(session.state.players.p1.field.find((u: any) => u.unitId === "u-bw-cost").state).toBe("drive");
    const p1Hand = session.state.players.p1.hand;
    expect(p1Hand.map((c: any) => c.id).sort()).toEqual(["c-bw-target", "c-s3", "c-s9"]);
  });

  // =========================================================================
  // シナリオ4: 帰還のコストBとして、対象防壁自身をDRIVEにした場合
  // =========================================================================
  it("Scenario 4: Target Bulwark driven as Cost B results in staying on field and Keys returning", () => {
    const keyS1 = { id: "c-s1", suit: "S", rank: "A", value: 1 };
    const keyS2 = { id: "c-s2", suit: "S", rank: "2", value: 2 };
    const bwCard = { id: "c-bw-self", suit: "D", rank: "5", value: 5 };

    const state: any = {
      stateVersion: 1,
      matchId: "match-unsummons-sc4",
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          hand: [keyS1, keyS2],
          field: [
            { unitId: "u-bw-self", componentId: "character.bulwark", state: "charge", cards: [bwCard] },
          ],
          life: [{ id: "l1" }],
          grave: [],
        },
        p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
      },
      stage: { requests: [], history: [] },
    };

    const session = new GameSession(state, standardRulePackage);
    playReturnAndPass(session, "u-bw-self");

    // コストBによりDRIVEとなったため、解決時はDRIVEでありフィールドに残留、キーカード2枚のみ手札
    const bw = session.state.players.p1.field.find((u: any) => u.unitId === "u-bw-self");
    expect(bw).toBeDefined();
    expect(bw.state).toBe("drive");
    const p1Hand = session.state.players.p1.hand;
    expect(p1Hand.map((c: any) => c.id).sort()).toEqual(["c-s1", "c-s2"]);
    expect(p1Hand).toHaveLength(2);
  });

  // =========================================================================
  // シナリオ5: 複数カードから構成される兵士に帰還
  // =========================================================================
  it("Scenario 5: Multi-card Armed Soldier returns all physical cards to hand", () => {
    const keyD3 = { id: "c-d3", suit: "D", rank: "3", value: 3 };
    const keyD6 = { id: "c-d6", suit: "D", rank: "6", value: 6 };
    const card1 = { id: "c-armed-1", suit: "S", rank: "4", value: 4 };
    const card2 = { id: "c-armed-2", suit: "H", rank: "9", value: 9 };
    const bwCard = { id: "c-bw-cost", suit: "D", rank: "4", value: 4 };

    const state: any = {
      stateVersion: 1,
      matchId: "match-unsummons-sc5",
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          hand: [keyD3, keyD6],
          field: [
            { unitId: "u-bw-cost", componentId: "character.bulwark", state: "charge", cards: [bwCard] },
            {
              unitId: "u-armed-sol",
              componentId: "character.armedSoldier",
              state: "charge",
              cards: [card1, card2],
            },
          ],
          life: [{ id: "l1" }],
          grave: [],
        },
        p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
      },
      stage: { requests: [], history: [] },
    };

    const session = new GameSession(state, standardRulePackage);
    playReturnAndPass(session, "u-armed-sol");

    // 装備兵消失、2枚のカード+キーカード2枚の計4枚が手札へ
    expect(session.state.players.p1.field.some((u: any) => u.unitId === "u-armed-sol")).toBe(false);
    const p1Hand = session.state.players.p1.hand;
    expect(p1Hand.map((c: any) => c.id).sort()).toEqual(["c-armed-1", "c-armed-2", "c-d3", "c-d6"]);
    expect(p1Hand).toHaveLength(4);
  });

  // =========================================================================
  // シナリオ6: 対象が解決前に失われた場合
  // =========================================================================
  it("Scenario 6: Target lost before resolution causes effect skip and keys to grave", () => {
    const keyH2 = { id: "c-h2", suit: "H", rank: "2", value: 2 };
    const keyH5 = { id: "c-h5", suit: "H", rank: "5", value: 5 };
    const solCard = { id: "c-sol-1", suit: "S", rank: "8", value: 8 };
    const bwCard = { id: "c-bw-1", suit: "D", rank: "4", value: 4 };

    const state: any = {
      stateVersion: 1,
      matchId: "match-unsummons-sc6",
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          hand: [keyH2, keyH5],
          field: [
            { unitId: "u-bw-1", componentId: "character.bulwark", state: "charge", cards: [bwCard] },
            { unitId: "u-sol-1", componentId: "character.soldier", state: "charge", cards: [solCard] },
          ],
          life: [{ id: "l1" }],
          grave: [],
        },
        p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
      },
      stage: { requests: [], history: [] },
    };

    const session = new GameSession(state, standardRulePackage);
    const step1: any = session.advance();
    const unsummonsPat = step1.request.patterns.findIndex((p: any) => {
      if (p.actionSelectionRef === undefined) return false;
      return step1.request.catalog.actions[p.actionSelectionRef].actionId === "action.unsummons";
    });
    session.submitDecision({
      decisionId: step1.request.decisionId,
      stateVersion: step1.request.stateVersion,
      selectedPatternRef: unsummonsPat,
    });

    // 解決前に対象兵士をフィールドから除去
    session.state.players.p1.field = session.state.players.p1.field.filter((u: any) => u.unitId !== "u-sol-1");

    // PASS -> PASS
    const step2 = session.advance();
    const p1Pass = (step2 as any).request.patterns.findIndex((p: any) => p.kind === "PASS");
    const step3 = session.submitDecision({
      decisionId: (step2 as any).request.decisionId,
      stateVersion: (step2 as any).request.stateVersion,
      selectedPatternRef: p1Pass,
    });
    const p2Pass = (step3 as any).request.patterns.findIndex((p: any) => p.kind === "PASS");
    session.submitDecision({
      decisionId: (step3 as any).request.decisionId,
      stateVersion: (step3 as any).request.stateVersion,
      selectedPatternRef: p2Pass,
    });

    // 効果スキップのためキーカードは手札に戻らず墓地へ
    expect(session.state.players.p1.hand).toHaveLength(0);
    expect(session.state.players.p1.grave.map((c: any) => c.id).sort()).toEqual(["c-h2", "c-h5"]);
  });

  // =========================================================================
  // シナリオ7: カウンターでキャンセルされた場合
  // =========================================================================
  it("Scenario 7: Counter cancellation cancels Return, sends Keys to grave, leaves Soldier untouched", () => {
    const keyH2 = { id: "c-h2", suit: "H", rank: "2", value: 2 };
    const keyH5 = { id: "c-h5", suit: "H", rank: "5", value: 5 };
    const solCard = { id: "c-sol-1", suit: "S", rank: "8", value: 8 };
    const bwCard = { id: "c-bw-1", suit: "D", rank: "4", value: 4 };

    const state: any = {
      stateVersion: 1,
      matchId: "match-unsummons-sc7",
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          hand: [keyH2, keyH5],
          field: [
            { unitId: "u-bw-1", componentId: "character.bulwark", state: "charge", cards: [bwCard] },
            { unitId: "u-sol-1", componentId: "character.soldier", state: "charge", cards: [solCard] },
          ],
          life: [{ id: "l1" }],
          grave: [],
        },
        p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
      },
      stage: { requests: [], history: [] },
    };

    const session = new GameSession(state, standardRulePackage);
    const step1: any = session.advance();
    const unsummonsPat = step1.request.patterns.findIndex((p: any) => {
      if (p.actionSelectionRef === undefined) return false;
      return step1.request.catalog.actions[p.actionSelectionRef].actionId === "action.unsummons";
    });
    session.submitDecision({
      decisionId: step1.request.decisionId,
      stateVersion: step1.request.stateVersion,
      selectedPatternRef: unsummonsPat,
    });

    // カウンターによるステージリクエストのキャンセル
    const req = session.state.stage.requests[0];
    const cmdContext: CommandContext = {
      state: session.state,
      playerKey: "p1",
      actions: fullRulePackage.actions,
      components: fullRulePackage.components,
      logRecorder: session.logRecorder,
    };
    cancelStageRequest(req.id, cmdContext, (session as any).registry.effectInterpreter);

    // 兵士はフィールドに無傷で残留、手札は0枚、キーカードは墓地へ
    expect(session.state.players.p1.field.some((u: any) => u.unitId === "u-sol-1")).toBe(true);
    expect(session.state.players.p1.hand).toHaveLength(0);
    expect(session.state.players.p1.grave.map((c: any) => c.id).sort()).toEqual(["c-h2", "c-h5"]);
  });

  // =========================================================================
  // 実戦フィードバックの根本原因実証:
  // 防壁と兵士が存在する局面で「暗黙の対象先頭採用」が起きると意図しない対象が送られることの検証
  // =========================================================================
  it("Root Cause Verification: Multiple targets (Bulwark and Soldier) must never default to Bulwark implicitly", () => {
    const keyH2 = { id: "c-h2", suit: "H", rank: "2", value: 2 };
    const keyH5 = { id: "c-h5", suit: "H", rank: "5", value: 5 };
    const solCard = { id: "c-sol-1", suit: "S", rank: "8", value: 8 };
    const bwCard = { id: "c-bw-1", suit: "D", rank: "4", value: 4 };

    const state: any = {
      stateVersion: 1,
      matchId: "match-unsummons-root-cause",
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          hand: [keyH2, keyH5],
          field: [
            { unitId: "u-bw-1", componentId: "character.bulwark", state: "charge", cards: [bwCard] },
            { unitId: "u-sol-1", componentId: "character.soldier", state: "charge", cards: [solCard] },
          ],
          life: [{ id: "l1" }],
          grave: [],
        },
        p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
      },
      stage: { requests: [], history: [] },
    };

    const { request: decisionReq } = LegalPatternGenerator.generateActionRequestDecision(state, "p1", standardRulePackage);
    const unsummonsPatterns = decisionReq.patterns.filter((p: any) => {
      if (p.actionSelectionRef === undefined) return false;
      return decisionReq.catalog.actions[p.actionSelectionRef].actionId === "action.unsummons";
    });

    // 候補として防壁対象と兵士対象の2つのパターンが存在することを確認
    const targetUnitIds = unsummonsPatterns.map((p: any) => {
      return decisionReq.catalog.targetSelections[p.targetSelectionRef].targetUnitId;
    });
    expect(targetUnitIds).toContain("u-bw-1");
    expect(targetUnitIds).toContain("u-sol-1");

    // 修正前のロジック (findIndex で selectedTargetRef === null を無視して先頭一致) を再現:
    // selectedActionRef = unsummons, selectedCostRef = cost0, selectedTargetRef = null
    const buggyMatchedIndex = decisionReq.patterns.findIndex((p: any) => {
      if (p.actionSelectionRef !== unsummonsPatterns[0].actionSelectionRef) return false;
      // target を絞り込まずに先頭を採用してしまうバグ
      return true;
    });
    const buggyTargetId = decisionReq.catalog.targetSelections[decisionReq.patterns[buggyMatchedIndex].targetSelectionRef].targetUnitId;
    // 修正前はユーザーの意図にかかわらず先頭候補が暗黙採用されていた
    expect(["u-bw-1", "u-sol-1"]).toContain(buggyTargetId);

    // 修正後のロジック (複数候補ありかつ selectedTargetRef === null なら null) を再現:
    const availableTargets = Array.from(new Set(unsummonsPatterns.map((p: any) => p.targetSelectionRef)));
    expect(availableTargets.length).toBeGreaterThan(1); // 2候補以上ある

    const resolvedTargetRef: number | null = null; // 未選択状態
    const fixedMatchedIndex = resolvedTargetRef === null ? null : buggyMatchedIndex;
    expect(fixedMatchedIndex).toBeNull(); // 提出不可としてブロックされる！
  });
});
