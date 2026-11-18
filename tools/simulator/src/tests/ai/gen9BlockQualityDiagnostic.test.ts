/**
 * gen9BlockQualityDiagnostic.test.ts
 *
 * BlackPoker Simulator - Gen 9 実戦フィードバック：ブロック判断の診断テスト
 *
 * 【調査目的】
 * 人間対戦時に「アタックがブロックされない」という実戦フィードバックを受け、
 * ブロック割り当ての判断品質（Core生成、候補抽出、ベーススコア、戦術補正、最終スコア、
 * 通常列挙 vs ストリーミング列挙、v7.2b vs v7.3b）を多角的に診断する。
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { LegalPatternGenerator } from "../../engine/decision/LegalPatternGenerator.js";
import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader.js";
import { RulePackage } from "../../domain/rules/RulePackage.js";
import { PlaytestPolicyFactory } from "../../engine/playtest/PlaytestPolicyFactory.js";
import { Gen9TacticalPrototypePolicy } from "../../engine/ai/Gen9TacticalPrototypePolicy.js";
import { Gen9LearnableTacticalPolicy } from "../../engine/ai/Gen9LearnableTacticalPolicy.js";
import { DecisionRequest } from "../../domain/decision/DecisionRequest.js";
import { UnitAssignment } from "../../domain/decision/DecisionCatalog.js";
import { GameSession } from "../../engine/session/GameSession.js";
import { createCoreBattlePresetState } from "../../engine/session/playtest/createCoreBattlePlaytest.js";
import { advanceAutomatedDecisions } from "../../engine/playtest/HumanVsPolicyController.js";
import { createSeatControllers } from "../../engine/playtest/PlaytestSeatController.js";

function makeCard(id: string, value: number, suit: string = "S", rank?: string): any {
  const resolvedRank =
    rank ??
    (value === 1
      ? "A"
      : value === 11
        ? "J"
        : value === 12
          ? "Q"
          : value === 13
            ? "K"
            : String(value));
  return {
    id,
    code: suit === "JOKER" ? "JOKER" : `${suit}${resolvedRank}`,
    suit: suit as any,
    rank: (suit === "JOKER" ? "JOKER" : resolvedRank) as any,
    value,
    faceUp: true,
  };
}

function makeSoldier(
  id: string,
  size: number,
  state: "charge" | "drive" = "charge",
  isAttacker: boolean = false
): any {
  const rank =
    size <= 10
      ? String(size)
      : size === 11
        ? "J"
        : size === 12
          ? "Q"
          : size === 13
            ? "K"
            : "10";
  const unit: any = {
    id,
    unitId: id,
    kind: "兵士",
    componentId: "character.soldier",
    properties: { characterType: "soldier" },
    cards: [makeCard(`card-${id}`, size, "S", rank)],
    state,
    face: "up",
    labels: ["攻撃", "防御"],
    sizeFormula: "sumValue",
    currentSize: size,
  };
  if (isAttacker) {
    unit.battle = {
      role: "attacker",
      targetPlayerKey: "playerA",
    };
  }
  return unit;
}

function makeBulwark(
  id: string,
  cardValue: number = 5,
  suit: string = "C",
  rank?: string
): any {
  return {
    id,
    unitId: id,
    kind: "防壁",
    componentId: "character.bulwark",
    properties: { characterType: "bulwark" },
    cards: [makeCard(`card-${id}`, cardValue, suit, rank)],
    state: "charge",
    face: "down",
    labels: ["防御"],
  };
}

function createBlockDecisionTestState(params: {
  attackers: any[];
  blockersField: any[];
  blockersTrumps?: any[];
  selfLifeCount?: number;
  oppLifeCount?: number;
}): {
  state: any;
  attackers: any[];
  candidateBlockers: any[];
} {
  const selfLifeCount = params.selfLifeCount ?? 15;
  const oppLifeCount = params.oppLifeCount ?? 15;

  const selfLifeCards = Array.from({ length: selfLifeCount }, (_, i) =>
    makeCard(`life-a-${i}`, (i % 10) + 1)
  );
  const oppLifeCards = Array.from({ length: oppLifeCount }, (_, i) =>
    makeCard(`life-b-${i}`, (i % 10) + 1)
  );

  const attackers = params.attackers.map((u) => ({
    ...u,
    battle: u.battle ?? {
      role: "attacker" as const,
      targetPlayerKey: "playerA" as const,
    },
  }));

  const state: any = {
    gameEnd: false,
    deck: [],
    turnCount: 3,
    turnPlayerKey: "playerB",
    chancePlayerKey: "playerA",
    focusPlayerKey: "playerA",
    phaseKey: "mainPhase",
    activeActionId: "action.attack",
    stage: { requests: [], nextSequence: 1 },
    players: {
      playerA: {
        name: "Player A",
        hand: [],
        field: params.blockersField,
        trumps: params.blockersTrumps ?? [],
        fog: [],
        grave: [],
        life: selfLifeCards,
        pack: [],
        rareCards: [],
        openedPack: false,
      } as any,
      playerB: {
        name: "Player B",
        hand: [],
        field: attackers,
        trumps: [],
        fog: [],
        grave: [],
        life: oppLifeCards,
        pack: [],
        rareCards: [],
        openedPack: false,
      } as any,
    },
  };

  const candidateBlockers = [
    ...params.blockersField,
    ...(params.blockersTrumps ?? []),
  ];

  return { state, attackers, candidateBlockers };
}

function resolveChosenAssignments(
  request: Readonly<DecisionRequest>,
  selectedPatternRef: number
): readonly UnitAssignment[] {
  if (request.patterns.length > 0) {
    const pat = request.patterns[selectedPatternRef];
    if (!pat || pat.effectSelectionRef === undefined) return [];
    const eff = request.catalog.effectSelections[pat.effectSelectionRef];
    return eff?.assignments ?? [];
  }

  if (request.blockAssignmentStream) {
    let idx = 0;
    for (const assignments of request.blockAssignmentStream.iterateAssignments()) {
      if (idx === selectedPatternRef) {
        return assignments.map((a) => ({
          sourceUnitId: a.sourceUnitId,
          selectedUnitIds: [...a.selectedUnitIds],
        }));
      }
      idx++;
    }
  }
  return [];
}

const MOCK_SOURCE_REQUEST: any = { id: "req-block", actionId: "action.block" };

describe("Gen 9 ブロック判断品質の診断テスト", () => {
  let rulePackage: RulePackage;
  let policyV72b: Gen9TacticalPrototypePolicy;
  let policyV73b: Gen9LearnableTacticalPolicy;

  const diagnosticEvidence: any = {
    workId: "BP-SIM-AI-GEN9-BLOCK-QUALITY-DIAGNOSTIC",
    timestamp: new Date().toISOString(),
    scenarios: {},
    summary: {
      totalScenarios: 0,
      actualBlockCountV72b: 0,
      actualBlockCountV73b: 0,
      streamParityMatches: 0,
    },
  };

  beforeAll(() => {
    rulePackage = loadRulePackageForBrowser();

    policyV72b = PlaytestPolicyFactory.createPolicy(
      "gen9-r4-v72b",
      12345,
      "playerA",
      "standard-pack",
      rulePackage
    ) as Gen9TacticalPrototypePolicy;

    policyV73b = PlaytestPolicyFactory.createPolicy(
      "gen9-cost-v73b",
      12345,
      "playerA",
      "standard-pack",
      rulePackage
    ) as Gen9LearnableTacticalPolicy;
  });

  afterAll(() => {
    const evidencePath = path.resolve(
      __dirname,
      "../../../evidence/gen9_block_quality_diagnostic.json"
    );
    fs.writeFileSync(evidencePath, JSON.stringify(diagnosticEvidence, null, 2), "utf-8");
  });

  // ---------------------------------------------------------------------------
  // 共通診断実行関数
  // ---------------------------------------------------------------------------
  function diagnoseScenario(params: {
    scenarioId: string;
    description: string;
    attackers: any[];
    blockersField: any[];
    blockersTrumps?: any[];
    selfLifeCount: number;
    expectedAction: "BLOCK" | "NO_BLOCK" | "ANY";
  }) {
    const { state, attackers, candidateBlockers } = createBlockDecisionTestState({
      attackers: params.attackers,
      blockersField: params.blockersField,
      blockersTrumps: params.blockersTrumps,
      selfLifeCount: params.selfLifeCount,
    });

    // 1. 通常列挙 (Method A: patterns 一括展開)
    const normalDecision = LegalPatternGenerator.generateBlockAssignmentDecision(
      state,
      "playerA",
      MOCK_SOURCE_REQUEST,
      "step-block",
      attackers,
      candidateBlockers,
      rulePackage.components,
      { maxFullPatternLimit: Infinity }
    );
    const normalReq = normalDecision.request;

    // 2. ストリーミング列挙 (Method B: blockAssignmentStream)
    const streamDecision = LegalPatternGenerator.generateBlockAssignmentDecision(
      state,
      "playerA",
      MOCK_SOURCE_REQUEST,
      "step-block",
      attackers,
      candidateBlockers,
      rulePackage.components,
      { maxFullPatternLimit: 0 }
    );
    const streamReq = streamDecision.request;

    // v7.2b の評価
    const evalV72b = policyV72b.evaluatePatterns(normalReq);
    const choiceV72bNormal = policyV72b.choose(normalReq).selectedPatternRef;
    const choiceV72bStream = policyV72b.choose(streamReq).selectedPatternRef;

    const chosenAssignV72bNormal = resolveChosenAssignments(normalReq, choiceV72bNormal);
    const chosenAssignV72bStream = resolveChosenAssignments(streamReq, choiceV72bStream);

    const totalBlockedV72bNormal = chosenAssignV72bNormal.reduce(
      (sum, a) => sum + (a.selectedUnitIds?.length ?? 0),
      0
    );
    const totalBlockedV72bStream = chosenAssignV72bStream.reduce(
      (sum, a) => sum + (a.selectedUnitIds?.length ?? 0),
      0
    );

    // v7.3b の評価
    const evalV73b = policyV73b.evaluatePatterns(normalReq);
    const choiceV73bNormal = policyV73b.choose(normalReq).selectedPatternRef;
    const choiceV73bStream = policyV73b.choose(streamReq).selectedPatternRef;

    const chosenAssignV73bNormal = resolveChosenAssignments(normalReq, choiceV73bNormal);
    const chosenAssignV73bStream = resolveChosenAssignments(streamReq, choiceV73bStream);

    const totalBlockedV73bNormal = chosenAssignV73bNormal.reduce(
      (sum, a) => sum + (a.selectedUnitIds?.length ?? 0),
      0
    );
    const totalBlockedV73bStream = chosenAssignV73bStream.reduce(
      (sum, a) => sum + (a.selectedUnitIds?.length ?? 0),
      0
    );

    // 通常列挙とストリーミング列挙で実際の割り当て内容が一致するか
    const parityV72b = JSON.stringify(chosenAssignV72bNormal) === JSON.stringify(chosenAssignV72bStream);
    const parityV73b = JSON.stringify(chosenAssignV73bNormal) === JSON.stringify(chosenAssignV73bStream);

    // パターンごとのスコア内訳
    const patternDetails = normalReq.patterns.map((pat, idx) => {
      const eff = normalReq.catalog.effectSelections[pat.effectSelectionRef!];
      const assign = eff?.assignments ?? [];
      const isPass = assign.every((a) => (a.selectedUnitIds?.length ?? 0) === 0);
      const score72 = evalV72b.scoredPatterns.find((p) => p.patternRef === idx);
      const score73 = evalV73b.scoredPatterns.find((p) => p.patternRef === idx);
      return {
        patternIndex: idx,
        isPass,
        assignments: assign,
        v72b: {
          baseScore: score72?.baseScore,
          tacticalAdjustment: score72?.tacticalAdjustment,
          finalScore: score72?.finalScore,
          reason: score72?.reason,
        },
        v73b: {
          baseScore: score73?.baseScore,
          tacticalAdjustment: score73?.tacticalAdjustment,
          finalScore: score73?.finalScore,
          reason: score73?.reason,
        },
      };
    });

    const isActualBlockV72b = totalBlockedV72bNormal > 0;
    const isActualBlockV73b = totalBlockedV73bNormal > 0;

    diagnosticEvidence.scenarios[params.scenarioId] = {
      description: params.description,
      expectedAction: params.expectedAction,
      patternCount: normalReq.patterns.length,
      candidateBlockersCount: candidateBlockers.length,
      v72b: {
        chosenIndex: choiceV72bNormal,
        chosenAssignments: chosenAssignV72bNormal,
        actualBlockedCount: totalBlockedV72bNormal,
        didBlock: isActualBlockV72b,
        streamParity: parityV72b,
      },
      v73b: {
        chosenIndex: choiceV73bNormal,
        chosenAssignments: chosenAssignV73bNormal,
        actualBlockedCount: totalBlockedV73bNormal,
        didBlock: isActualBlockV73b,
        streamParity: parityV73b,
      },
      patterns: patternDetails,
    };

    diagnosticEvidence.summary.totalScenarios++;
    if (isActualBlockV72b) diagnosticEvidence.summary.actualBlockCountV72b++;
    if (isActualBlockV73b) diagnosticEvidence.summary.actualBlockCountV73b++;
    if (parityV72b && parityV73b) diagnosticEvidence.summary.streamParityMatches++;

    console.log(`\n================================================================`);
    console.log(`[診断] ${params.scenarioId}: ${params.description}`);
    console.log(`  パターン数: ${normalReq.patterns.length}, ブロッカー候補: ${candidateBlockers.length}`);
    console.log(`  v7.2b: 選択Ref=${choiceV72bNormal}, 実際ブロック数=${totalBlockedV72bNormal}, ブロック実施=${isActualBlockV72b}`);
    console.log(`  v7.3b: 選択Ref=${choiceV73bNormal}, 実際ブロック数=${totalBlockedV73bNormal}, ブロック実施=${isActualBlockV73b}`);
    console.log(`  ストリーミング一致: v7.2b=${parityV72b}, v7.3b=${parityV73b}`);
    for (const pd of patternDetails) {
      console.log(`    Pattern[${pd.patternIndex}] ${pd.isPass ? "(スルー/0体)" : "(ブロック)"}:`);
      console.log(`      v7.2b: base=${pd.v72b.baseScore?.toFixed(4)}, tac=${pd.v72b.tacticalAdjustment?.toFixed(4)}, final=${pd.v72b.finalScore?.toFixed(4)} | ${pd.v72b.reason ?? ""}`);
      console.log(`      v7.3b: base=${pd.v73b.baseScore?.toFixed(4)}, tac=${pd.v73b.tacticalAdjustment?.toFixed(4)}, final=${pd.v73b.finalScore?.toFixed(4)} | ${pd.v73b.reason ?? ""}`);
    }

    return {
      normalReq,
      isActualBlockV72b,
      isActualBlockV73b,
      parityV72b,
      parityV73b,
      patternDetails,
    };
  }

  // ---------------------------------------------------------------------------
  // 必須シナリオ 1: ライフ15、敵サイズ3、自軍チャージ兵士サイズ6 (有利ブロック可能)
  // ---------------------------------------------------------------------------
  it("シナリオ 1: ライフ15、敵サイズ3、自軍チャージ兵士サイズ6 (有利ブロック可能)", () => {
    const oppAtk = makeSoldier("u-atk-3", 3, "charge", true);
    const myBlk = makeSoldier("u-blk-6", 6, "charge", false);

    const res = diagnoseScenario({
      scenarioId: "scenario-1-favorable-soldier-block",
      description: "ライフ15、敵サイズ3、自軍チャージ兵士サイズ6 (有利ブロック可能: 撃破かつ自軍生存)",
      attackers: [oppAtk],
      blockersField: [myBlk],
      selfLifeCount: 15,
      expectedAction: "BLOCK",
    });

    // 診断アサーション
    expect(res.parityV72b).toBe(true);
    expect(res.parityV73b).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 必須シナリオ 2: ライフ15、敵サイズ5、自軍チャージ兵士サイズ2 (ブロックしない判断も合理的)
  // ---------------------------------------------------------------------------
  it("シナリオ 2: ライフ15、敵サイズ5、自軍チャージ兵士サイズ2 (ブロックしない判断も合理的)", () => {
    const oppAtk = makeSoldier("u-atk-5", 5, "charge", true);
    const myBlk = makeSoldier("u-blk-2", 2, "charge", false);

    const res = diagnoseScenario({
      scenarioId: "scenario-2-unfavorable-soldier-block-safe-life",
      description: "ライフ15、敵サイズ5、自軍チャージ兵士サイズ2 (自滅犬死ブロックを回避してスルー)",
      attackers: [oppAtk],
      blockersField: [myBlk],
      selfLifeCount: 15,
      expectedAction: "NO_BLOCK",
    });

    expect(res.parityV72b).toBe(true);
    expect(res.parityV73b).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 必須シナリオ 3: ライフ4、敵サイズ5、自軍チャージ兵士あり (致死ブロックが必要)
  // ---------------------------------------------------------------------------
  it("シナリオ 3: ライフ4、敵サイズ5、自軍チャージ兵士あり (致死ブロックが必要)", () => {
    const oppAtk = makeSoldier("u-atk-5", 5, "charge", true);
    const myBlk = makeSoldier("u-blk-2", 2, "charge", false);

    const res = diagnoseScenario({
      scenarioId: "scenario-3-lethal-block-required",
      description: "ライフ4、敵サイズ5、自軍チャージ兵士サイズ2 (未ブロックなら即死するためブロック必須)",
      attackers: [oppAtk],
      blockersField: [myBlk],
      selfLifeCount: 4,
      expectedAction: "BLOCK",
    });

    expect(res.parityV72b).toBe(true);
    expect(res.parityV73b).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 必須シナリオ 4: 防壁で攻撃兵士を撃破できる局面
  // ---------------------------------------------------------------------------
  it("シナリオ 4: 防壁で攻撃兵士を撃破できる局面", () => {
    const oppAtk = makeSoldier("u-atk-5", 5, "charge", true);
    // 相手アタッカーは S5 (value 5)。防壁のカードを value 5 で印刷ランク一致にする
    const myBulwark = makeBulwark("u-bw-5", 5, "S", "5");

    const res = diagnoseScenario({
      scenarioId: "scenario-4-bulwark-destroy-attacker",
      description: "防壁で攻撃兵士を撃破できる局面 (ランク一致 5 によるアタッカー破壊)",
      attackers: [oppAtk],
      blockersField: [myBulwark],
      selfLifeCount: 15,
      expectedAction: "BLOCK",
    });

    expect(res.parityV72b).toBe(true);
    expect(res.parityV73b).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 必須シナリオ 5: 複数兵士による有利なブロックが可能な局面
  // ---------------------------------------------------------------------------
  it("シナリオ 5: 複数兵士による有利なブロックが可能な局面", () => {
    const oppAtk = makeSoldier("u-atk-6", 6, "charge", true);
    const myBlk1 = makeSoldier("u-blk-4", 4, "charge", false);
    const myBlk2 = makeSoldier("u-blk-4-2", 4, "charge", false);

    const res = diagnoseScenario({
      scenarioId: "scenario-5-multi-soldier-favorable-block",
      description: "複数兵士による有利ブロック (敵6 vs 自軍4+4=8: 合体防衛で一方的撃破)",
      attackers: [oppAtk],
      blockersField: [myBlk1, myBlk2],
      selfLifeCount: 15,
      expectedAction: "BLOCK",
    });

    expect(res.parityV72b).toBe(true);
    expect(res.parityV73b).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 必須シナリオ 6: ブロック可能なユニットが0体の局面
  // ---------------------------------------------------------------------------
  it("シナリオ 6: ブロック可能なユニットが0体の局面", () => {
    const oppAtk = makeSoldier("u-atk-4", 4, "charge", true);
    // 自軍兵士はドライブ状態（疲労）でブロック不可
    const myDriveSoldier = makeSoldier("u-blk-ex", 5, "drive", false);

    const { state, attackers, candidateBlockers } = createBlockDecisionTestState({
      attackers: [oppAtk],
      blockersField: [myDriveSoldier],
      selfLifeCount: 15,
    });

    // ドライブ状態の兵士はブロック候補にならない
    const validCandidates = candidateBlockers.filter((b) => b.state === "charge");

    const normalDecision = LegalPatternGenerator.generateBlockAssignmentDecision(
      state,
      "playerA",
      MOCK_SOURCE_REQUEST,
      "step-block",
      attackers,
      validCandidates,
      rulePackage.components,
      { maxFullPatternLimit: Infinity }
    );
    const normalReq = normalDecision.request;

    // パターンは 0体ブロックの 1 パターンのみ生成される
    expect(normalReq.patterns.length).toBe(1);

    const choiceV72b = policyV72b.choose(normalReq).selectedPatternRef;
    const choiceV73b = policyV73b.choose(normalReq).selectedPatternRef;

    const chosenAssignV72b = resolveChosenAssignments(normalReq, choiceV72b);
    const chosenAssignV73b = resolveChosenAssignments(normalReq, choiceV73b);

    const totalBlockedV72b = chosenAssignV72b.reduce(
      (sum, a) => sum + (a.selectedUnitIds?.length ?? 0),
      0
    );
    const totalBlockedV73b = chosenAssignV73b.reduce(
      (sum, a) => sum + (a.selectedUnitIds?.length ?? 0),
      0
    );

    expect(totalBlockedV72b).toBe(0);
    expect(totalBlockedV73b).toBe(0);

    diagnosticEvidence.scenarios["scenario-6-zero-candidates"] = {
      description: "ブロック可能なユニットが0体の局面 (ドライブ状態のみ)",
      patternCount: normalReq.patterns.length,
      candidateBlockersCount: validCandidates.length,
      v72b: {
        chosenIndex: choiceV72b,
        actualBlockedCount: totalBlockedV72b,
        didBlock: false,
      },
      v73b: {
        chosenIndex: choiceV73b,
        actualBlockedCount: totalBlockedV73b,
        didBlock: false,
      },
    };
    diagnosticEvidence.summary.totalScenarios++;
  });

  // ---------------------------------------------------------------------------
  // シナリオ 7: GameSession / Playtest 統合環境下でのアタック解決とブロック自動処理追跡
  // ---------------------------------------------------------------------------
  it("シナリオ 7: GameSession におけるアタック解決時のブロック DecisionRequest 発生と AI 選択の追跡", async () => {
    // 1ステップごとの実行時トレースを行うテスト関数
    const traceAttackAndBlockStepByStep = () => {
      const state = createCoreBattlePresetState();
      const session = new GameSession(state, rulePackage);

      console.log("=== STEP TRACE START ===");
      let step = session.advance();
      console.log("[Trace 1] Initial step:", step.type, (step as any).request?.playerId);

      // p1 のメインタイミング: action.attack を選択
      const req1 = (step as any).request;
      const attackPatIdx = req1.patterns.findIndex((p: any) => {
        const act = req1.catalog.actions[p.actionSelectionRef!];
        return act?.actionId === "action.attack";
      });
      console.log("[Trace 2] Submitting action.attack, patternRef:", attackPatIdx);
      step = session.submitDecision({
        decisionId: req1.decisionId,
        stateVersion: req1.stateVersion,
        selectedPatternRef: attackPatIdx,
      });

      // ステップを1つずつ進めてログ
      let traceStepCount = 2;
      const traceLog: any[] = [];

      while (traceStepCount < 25 && step.type !== "FINISHED") {
        traceStepCount++;
        const currentReq = (step as any).request;
        const info: any = {
          stepNum: traceStepCount,
          type: step.type,
          playerId: currentReq?.playerId,
          sourceType: currentReq?.source?.type,
          sourceActionId: currentReq?.source?.sourceActionId,
          effectStepId: currentReq?.source?.effectStepId,
          selectionType: currentReq?.source?.selectionType,
          turnCount: session.state.turnCount,
          turnPlayer: session.state.turnPlayer,
          stageLength: session.state.stage?.requests?.length,
          bufferLength: (session.state.requestBuffer as any)?.requests?.length,
        };

        if (step.type === "WAITING_FOR_DECISION") {
          // 誰が何を判断しているか
          if (currentReq.source.type === "EFFECT_RESOLUTION") {
            info.effectPatternsCount = currentReq.patterns.length;
            info.catalogSelectionsCount = currentReq.catalog?.effectSelections?.length;
            info.catalogSelections = currentReq.catalog?.effectSelections;
            info.attackerCount = session.state.players.p1.field.filter((u: any) => u.battle?.role === "attacker").length;

            // アタッカー選択なら、空配列ではない（兵士をアタッカーとして指定する）パターンを選ぶ
            const nonPassPatIdx = currentReq.patterns.findIndex((p: any) => {
              if (p.kind === "PASS") return false;
              const sel = currentReq.catalog?.effectSelections?.[p.effectSelectionRef];
              if (!sel) return false;
              if (Array.isArray(sel.selectedValues) && sel.selectedValues.length > 0) return true;
              if (Array.isArray(sel.unitIds) && sel.unitIds.length > 0) return true;
              if (Array.isArray(sel.assignments) && sel.assignments.some((a: any) => a.selectedUnitIds?.length > 0)) return true;
              return false;
            });

            info.chosenNonPassPatIdx = nonPassPatIdx;

            step = session.submitDecision({
              decisionId: currentReq.decisionId,
              stateVersion: currentReq.stateVersion,
              selectedPatternRef: nonPassPatIdx !== -1 ? nonPassPatIdx : 0,
            });
          } else {
            // 通常アクション / 優先権パス
            const passIdx = currentReq.patterns.findIndex((p: any) => p.kind === "PASS");
            info.passIdx = passIdx;
            step = session.submitDecision({
              decisionId: currentReq.decisionId,
              stateVersion: currentReq.stateVersion,
              selectedPatternRef: passIdx !== -1 ? passIdx : 0,
            });
          }
        } else if (step.type === "PROGRESSED") {
          step = session.advance();
        }

        traceLog.push(info);
        if (info.turnCount > 1) {
          // Turn 2 に突入したら追跡終了
          break;
        }
      }

      return traceLog;
    };

    const traceResult = traceAttackAndBlockStepByStep();

    diagnosticEvidence.scenarios["scenario-7-step-trace"] = {
      description: "p1のアタック宣言から解決・ブロックまでのステップ別トレース",
      traceLog: traceResult,
    };

    // v7.2b と v7.3b の両方で GameSession 上のアタック -> ブロック挙動を追跡
    const testWithPolicy = async (policyKey: "gen9-r4-v72b" | "gen9-cost-v73b") => {
      const state = createCoreBattlePresetState();
      const session = new GameSession(state, rulePackage);
      const policy = PlaytestPolicyFactory.createPolicy(
        policyKey,
        undefined,
        "p2",
        "standard-pack",
        rulePackage
      );

      const seatControllers = createSeatControllers({
        p1Mode: "human",
        p2Mode: "policy",
      });
      const policies = { p2: policy };

      // 1. 初期ステップ進行 (Turn 1: p1 のメインタイミング)
      let currentStep = session.advance();
      expect(currentStep.type).toBe("WAITING_FOR_DECISION");
      expect((currentStep as any).request.playerId).toBe("p1");

      const req1 = (currentStep as any).request;
      // p1 がアタックを選択
      const attackPatIdx = req1.patterns.findIndex((p: any) => {
        const act = req1.catalog.actions[p.actionSelectionRef!];
        return act?.actionId === "action.attack";
      });
      expect(attackPatIdx).toBeGreaterThanOrEqual(0);

      // p1 がアタックを提出
      currentStep = session.submitDecision({
        decisionId: req1.decisionId,
        stateVersion: req1.stateVersion,
        selectedPatternRef: attackPatIdx,
      });

      // 2. AI 自動進行ループを実行（p2 の PASS、p1 の PASS、アタッカー選択、ブロックなど）
      // 人間手番（アタッカー選択など）になったら一時停止し、アタッカーを決定して再度進行
      const allAiRecords: any[] = [];
      let loopCount = 0;
      while (currentStep.type !== "FINISHED" && loopCount < 20) {
        loopCount++;

        if (currentStep.type === "WAITING_FOR_DECISION") {
          const req = (currentStep as any).request;
          if (req.playerId === "p1") {
            // 人間手番: PASS またはアタッカー選択
            if (req.source.type === "EFFECT_RESOLUTION") {
              // アタッカー選択なら、空配列ではない（兵士をアタッカーとして指定する）パターンを選ぶ
              const nonPassPatIdx = req.patterns.findIndex((p: any) => {
                if (p.kind === "PASS") return false;
                const sel = req.catalog?.effectSelections?.[p.effectSelectionRef];
                if (!sel) return false;
                if (Array.isArray(sel.selectedValues) && sel.selectedValues.length > 0) return true;
                if (Array.isArray(sel.unitIds) && sel.unitIds.length > 0) return true;
                if (Array.isArray(sel.assignments) && sel.assignments.some((a: any) => a.selectedUnitIds?.length > 0)) return true;
                return false;
              });

              currentStep = session.submitDecision({
                decisionId: req.decisionId,
                stateVersion: req.stateVersion,
                selectedPatternRef: nonPassPatIdx !== -1 ? nonPassPatIdx : 0,
              });
            } else {
              // 優先権パス
              const passIdx = req.patterns.findIndex((p: any) => p.kind === "PASS");
              currentStep = session.submitDecision({
                decisionId: req.decisionId,
                stateVersion: req.stateVersion,
                selectedPatternRef: passIdx !== -1 ? passIdx : 0,
              });
            }
            continue;
          }
        }

        // AI または PROGRESSED の進行
        const advRes = await advanceAutomatedDecisions(
          session,
          currentStep,
          seatControllers,
          policies,
          { viewerPlayerId: "p1" }
        );

        allAiRecords.push(...advRes.records);
        currentStep = advRes.step;

        // もしアタック解決・ブロック処理が一巡して p1 のメインタイミングに戻ったら終了
        if (
          currentStep.type === "WAITING_FOR_DECISION" &&
          (currentStep as any).request.playerId === "p1" &&
          session.state.stage.requests.length === 0
        ) {
          break;
        }
      }

      // 記録された AI 判断から、全レコードの詳細を出力
      console.log(`--- [${policyKey}] allAiRecords (${allAiRecords.length} records) ---`);
      allAiRecords.forEach((r, idx) => {
        console.log(`[Record ${idx}] player=${r.playerId}, source=${JSON.stringify(r.request.source)}, actionRef=${r.request.patterns[r.response.selectedPatternRef]?.actionSelectionRef}, kind=${r.request.patterns[r.response.selectedPatternRef]?.kind}`);
      });

      // 記録された AI 判断から、ブロック (action.block) に関するものを探す
      const blockRecords = allAiRecords.filter(
        (r) =>
          r.request.source.type === "EFFECT_RESOLUTION" &&
          (r.request.source.selectionType === "unitAssignment" ||
            r.request.patterns.some((p: any) => p.effectSelectionRef !== undefined))
      );

      return {
        allRecordsCount: allAiRecords.length,
        allRecordsSummary: allAiRecords.map((r, idx) => ({
          idx,
          player: r.playerId,
          sourceType: r.request.source.type,
          sourceActionId: (r.request.source as any).sourceActionId,
          effectStepId: (r.request.source as any).effectStepId,
          selectionType: (r.request.source as any).selectionType,
          patternsCount: r.request.patterns.length,
          chosenPatternRef: r.response.selectedPatternRef,
          chosenKind: r.request.patterns[r.response.selectedPatternRef]?.kind,
          chosenEffectRef: r.request.patterns[r.response.selectedPatternRef]?.effectSelectionRef,
        })),
        blockRecordsCount: blockRecords.length,
        blockRecords: blockRecords.map((r) => ({
          decisionId: r.request.decisionId,
          source: r.request.source,
          patternCount: r.request.patterns.length,
          chosenPatternRef: r.response.selectedPatternRef,
          chosenPattern: r.request.patterns[r.response.selectedPatternRef],
          isStream: Boolean(r.request.blockAssignmentStream),
          assignments: r.request.patterns[r.response.selectedPatternRef]?.effectSelectionRef !== undefined
            ? r.request.catalog.effectSelections[r.request.patterns[r.response.selectedPatternRef].effectSelectionRef].assignments
            : null,
        })),
        finalStateTurn: session.state.turnCount,
      };
    };

    const resultV72b = await testWithPolicy("gen9-r4-v72b");
    const resultV73b = await testWithPolicy("gen9-cost-v73b");

    console.log("=== シナリオ 7 実行結果 ===");
    console.log("v7.2b ブロック判断レコード数:", resultV72b.blockRecordsCount);
    console.log("v7.2b 詳細:", JSON.stringify(resultV72b.blockRecords, null, 2));
    console.log("v7.3b ブロック判断レコード数:", resultV73b.blockRecordsCount);
    console.log("v7.3b 詳細:", JSON.stringify(resultV73b.blockRecords, null, 2));

    diagnosticEvidence.scenarios["scenario-7-gamesession-attack-block-trace"] = {
      description: "GameSession / Playtest 環境下でのアタック解決とブロック自動処理追跡",
      v72b: resultV72b,
      v73b: resultV73b,
    };
    diagnosticEvidence.summary.totalScenarios++;
  });
});
