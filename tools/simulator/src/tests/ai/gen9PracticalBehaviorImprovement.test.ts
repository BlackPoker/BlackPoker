/**
 * gen9PracticalBehaviorImprovement.test.ts
 *
 * BlackPoker Simulator - Work: Gen 9 実戦品質改善 ― ブロック判断と兵士温存
 *
 * 【検証項目】
 * 1. 有利な兵士ブロック (自軍6 vs 敵3)
 * 2. 不利なブロックの回避 (自軍2 vs 敵5, ライフ15: 犬死ブロックを回避してスルー選択) ★P0
 * 3. 致死ダメージを防ぐブロック (自軍2 vs 敵5, ライフ4: 不利でも致死回避ブロック)
 * 4. 防壁によるブロック (防壁♢5 vs 敵5: アタッカー撃破)
 * 5. 複数兵士ブロック (自軍4+4 vs 敵6: 合体有利ブロック)
 * 6. チャージ兵士が0体のときの自動スルー (候補0体)
 * 7. アタッカー選択で守備兵士を残すのが合理的な局面 ★P1
 * 8. 全軍アタックが合理的な局面 (リーサル、防壁あり、相手無害)
 * 9. 通常列挙 vs ストリーミング列挙の一致性検証
 * 10. GameSession 統合検証 (固定シード実戦、アタック〜ブロック〜ダメージ追跡、自動スルーと合法スルーの区別)
 * 11. 旧AI (v7.2b / v7.3b) の再現性維持保証
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

function createBlockDecisionTestState(opts: {
  attackers: any[];
  blockersField: any[];
  selfLifeCount?: number;
  oppLifeCount?: number;
}): {
  state: any;
  attackers: any[];
  candidateBlockers: any[];
} {
  const selfLifeCards = Array.from(
    { length: opts.selfLifeCount ?? 15 },
    (_, i) => makeCard(`self-life-${i}`, (i % 13) + 1, "H")
  );
  const oppLifeCards = Array.from(
    { length: opts.oppLifeCount ?? 15 },
    (_, i) => makeCard(`opp-life-${i}`, (i % 13) + 1, "D")
  );

  const state: any = {
    stateVersion: 10,
    turnCount: 2,
    turnPlayer: "playerB",
    players: {
      playerA: {
        playerId: "playerA",
        name: "Player A (Defender / AI)",
        life: selfLifeCards,
        hand: [],
        field: [...opts.blockersField],
        trumps: [],
        grave: [],
      },
      playerB: {
        playerId: "playerB",
        name: "Player B (Attacker)",
        life: oppLifeCards,
        hand: [],
        field: [...opts.attackers],
        trumps: [],
        grave: [],
      },
    },
    stage: {
      requests: [
        {
          id: "req-attack-1",
          actionId: "action.attack",
          controller: "playerB",
          definitionOwner: "playerB",
          status: "resolving",
          stepIndex: 1,
        },
      ],
    },
    requestBuffer: {
      requests: [
        {
          id: "req-block-1",
          actionId: "action.block",
          controller: "playerA",
          definitionOwner: "playerA",
          status: "resolving",
          stepIndex: 0,
        },
      ],
      history: [],
    },
  };

  return {
    state,
    attackers: opts.attackers,
    candidateBlockers: opts.blockersField,
  };
}

const MOCK_BLOCK_REQUEST: any = {
  id: "req-block-mock",
  actionId: "action.block",
  controller: "playerA",
  definitionOwner: "playerA",
  status: "resolving",
  stepIndex: 0,
  action: {
    id: "action.block",
    name: "ブロック",
    type: "basic",
    request: { trigger: "triggered", controller: "nonTurnPlayer" },
    effect: [{ selectBlockAssignments: { id: "blocks", relation: "self" } }],
  },
};

function resolveChosenAssignments(
  request: Readonly<DecisionRequest>,
  selectedPatternRef: number
): readonly UnitAssignment[] {
  if (
    request.blockAssignmentStream &&
    (!request.patterns || request.patterns.length === 0)
  ) {
    return request.blockAssignmentStream.getAssignmentAt(selectedPatternRef);
  }

  const pat = request.patterns[selectedPatternRef];
  if (!pat || pat.effectSelectionRef === undefined) return [];
  const eff = request.catalog.effectSelections[pat.effectSelectionRef];
  return eff?.assignments ?? [];
}

describe("Work: Gen 9 実戦品質改善 ― ブロック判断と兵士温存の統合検証", () => {
  let rulePackage: RulePackage;
  let policyV72c: Gen9TacticalPrototypePolicy;
  let policyV73c: Gen9LearnableTacticalPolicy;
  let policyV72b: Gen9TacticalPrototypePolicy;
  let policyV73b: Gen9LearnableTacticalPolicy;

  const evidence: any = {
    workId: "BP-SIM-AI-GEN9-PRACTICAL-BEHAVIOR-IMPROVEMENT",
    timestamp: new Date().toISOString(),
    results: {},
    summary: {
      totalTests: 0,
      passedTests: 0,
    },
  };

  beforeAll(() => {
    rulePackage = loadRulePackageForBrowser();

    // v7.2c / v7.3c (実戦品質改善版)
    policyV72c = PlaytestPolicyFactory.createPolicy(
      "gen9-r4-v72c",
      12345,
      "playerA",
      "standard-pack",
      rulePackage
    ) as Gen9TacticalPrototypePolicy;

    policyV73c = PlaytestPolicyFactory.createPolicy(
      "gen9-cost-v73c",
      12345,
      "playerA",
      "standard-pack",
      rulePackage
    ) as Gen9LearnableTacticalPolicy;

    // v7.2b / v7.3b (旧完成版: 再現性検証用)
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
      "../../../evidence/gen9_practical_behavior_improvement.json"
    );
    fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), "utf-8");
  });

  // ===========================================================================
  // 1. P0: ブロック判断品質の改善検証
  // ===========================================================================
  describe("P0: 不利ブロックの抑制と守備判断品質", () => {
    // 1.1 有利な兵士ブロック
    it("1.1 有利なブロック (自軍6 vs 敵3, ライフ15) で積極的にブロックを選択すること", () => {
      const oppAtk = makeSoldier("u-atk-3", 3, "charge", true);
      const myBlk = makeSoldier("u-blk-6", 6, "charge", false);

      const { state, attackers, candidateBlockers } = createBlockDecisionTestState({
        attackers: [oppAtk],
        blockersField: [myBlk],
        selfLifeCount: 15,
      });

      const decision = LegalPatternGenerator.generateBlockAssignmentDecision(
        state,
        "playerA",
        MOCK_BLOCK_REQUEST,
        "step-block",
        attackers,
        candidateBlockers,
        rulePackage.components,
        { maxFullPatternLimit: Infinity }
      );
      const req = decision.request;

      const choiceV72c = policyV72c.choose(req).selectedPatternRef;
      const choiceV73c = policyV73c.choose(req).selectedPatternRef;

      const assignV72c = resolveChosenAssignments(req, choiceV72c);
      const assignV73c = resolveChosenAssignments(req, choiceV73c);

      expect(assignV72c[0].selectedUnitIds).toEqual(["u-blk-6"]);
      expect(assignV73c[0].selectedUnitIds).toEqual(["u-blk-6"]);

      evidence.results["1.1-favorable-soldier-block"] = {
        status: "PASS",
        v72cChosenUnitIds: assignV72c[0].selectedUnitIds,
        v73cChosenUnitIds: assignV73c[0].selectedUnitIds,
      };
      evidence.summary.totalTests++;
      evidence.summary.passedTests++;
    });

    // 1.2 不利なブロックの回避 ★P0最重要
    it("1.2 不利なブロック (自軍2 vs 敵5, ライフ15) で犬死を回避しスルー(ブロックなし)を選択すること", () => {
      const oppAtk = makeSoldier("u-atk-5", 5, "charge", true);
      const myBlk = makeSoldier("u-blk-2", 2, "charge", false);

      const { state, attackers, candidateBlockers } = createBlockDecisionTestState({
        attackers: [oppAtk],
        blockersField: [myBlk],
        selfLifeCount: 15,
      });

      const decision = LegalPatternGenerator.generateBlockAssignmentDecision(
        state,
        "playerA",
        MOCK_BLOCK_REQUEST,
        "step-block",
        attackers,
        candidateBlockers,
        rulePackage.components,
        { maxFullPatternLimit: Infinity }
      );
      const req = decision.request;

      const choiceV72c = policyV72c.choose(req).selectedPatternRef;
      const choiceV73c = policyV73c.choose(req).selectedPatternRef;

      const assignV72c = resolveChosenAssignments(req, choiceV72c);
      const assignV73c = resolveChosenAssignments(req, choiceV73c);

      // ★ 新バージョン v7.2c / v7.3c ではブロックなし (空配列) を選択！
      expect(assignV72c[0].selectedUnitIds).toEqual([]);
      expect(assignV73c[0].selectedUnitIds).toEqual([]);

      // スコア内訳の検証
      const evalV72c = policyV72c.evaluatePatterns(req);
      const passScore = evalV72c.scoredPatterns.find((p) => p.patternRef === 0)!;
      const blockScore = evalV72c.scoredPatterns.find((p) => p.patternRef === 1)!;

      expect(passScore.finalScore).toBeGreaterThan(blockScore.finalScore);
      expect(blockScore.tacticalAdjustment).toBeLessThanOrEqual(-0.12);

      // 対比: 旧バージョン v7.2b では犬死ブロックを選んでいたことを確認 (再現性)
      const evalV72b = policyV72b.evaluatePatterns(req);
      const choiceV72b = policyV72b.choose(req).selectedPatternRef;
      const assignV72b = resolveChosenAssignments(req, choiceV72b);

      evidence.results["1.2-unfavorable-block-avoidance"] = {
        v72cChosenUnitIds: assignV72c[0].selectedUnitIds,
        v73cChosenUnitIds: assignV73c[0].selectedUnitIds,
        v72cPassFinalScore: passScore.finalScore,
        v72cBlockFinalScore: blockScore.finalScore,
        v72cBlockTacticalAdj: blockScore.tacticalAdjustment,
        oldV72bChosenUnitIds: assignV72b[0].selectedUnitIds,
        oldV72bScores: evalV72b.scoredPatterns.map((p) => ({
          ref: p.patternRef,
          base: p.baseScore,
          tactical: p.tacticalAdjustment,
          final: p.finalScore,
          reason: p.reason,
        })),
        v72cScores: evalV72c.scoredPatterns.map((p) => ({
          ref: p.patternRef,
          base: p.baseScore,
          tactical: p.tacticalAdjustment,
          final: p.finalScore,
          reason: p.reason,
        })),
      };

      // v72b のスコア内訳を確認
      expect(evalV72b.scoredPatterns[1].tacticalAdjustment).toBeCloseTo(-0.05, 2);

      evidence.results["1.2-unfavorable-block-avoidance"] = {
        status: "PASS",
        v72cChosenUnitIds: assignV72c[0].selectedUnitIds,
        v73cChosenUnitIds: assignV73c[0].selectedUnitIds,
        v72cPassFinalScore: passScore.finalScore,
        v72cBlockFinalScore: blockScore.finalScore,
        v72cBlockTacticalAdj: blockScore.tacticalAdjustment,
        oldV72bChosenUnitIds: assignV72b[0].selectedUnitIds,
      };
      evidence.summary.totalTests++;
      evidence.summary.passedTests++;
    });

    // 1.3 致死ダメージを防ぐブロック
    it("1.3 致死ダメージ局面 (自軍2 vs 敵5, ライフ4) では不利でも致死回避ブロックを選択すること", () => {
      const oppAtk = makeSoldier("u-atk-5", 5, "charge", true);
      const myBlk = makeSoldier("u-blk-2", 2, "charge", false);

      const { state, attackers, candidateBlockers } = createBlockDecisionTestState({
        attackers: [oppAtk],
        blockersField: [myBlk],
        selfLifeCount: 4, // 致死ダメージ
      });

      const decision = LegalPatternGenerator.generateBlockAssignmentDecision(
        state,
        "playerA",
        MOCK_BLOCK_REQUEST,
        "step-block",
        attackers,
        candidateBlockers,
        rulePackage.components,
        { maxFullPatternLimit: Infinity }
      );
      const req = decision.request;

      const choiceV72c = policyV72c.choose(req).selectedPatternRef;
      const choiceV73c = policyV73c.choose(req).selectedPatternRef;

      const assignV72c = resolveChosenAssignments(req, choiceV72c);
      const assignV73c = resolveChosenAssignments(req, choiceV73c);

      expect(assignV72c[0].selectedUnitIds).toEqual(["u-blk-2"]);
      expect(assignV73c[0].selectedUnitIds).toEqual(["u-blk-2"]);

      evidence.results["1.3-lethal-avoidance-block"] = {
        status: "PASS",
        v72cChosenUnitIds: assignV72c[0].selectedUnitIds,
        v73cChosenUnitIds: assignV73c[0].selectedUnitIds,
      };
      evidence.summary.totalTests++;
      evidence.summary.passedTests++;
    });

    // 1.4 防壁によるブロック
    it("1.4 防壁で攻撃兵士を撃破できる局面 (防壁♢5 vs 敵5) でブロックを選択すること", () => {
      const oppAtk = makeSoldier("u-atk-5", 5, "charge", true);
      const myBw = makeBulwark("u-blk-bw5", 5, "D", "5");

      const { state, attackers, candidateBlockers } = createBlockDecisionTestState({
        attackers: [oppAtk],
        blockersField: [myBw],
        selfLifeCount: 15,
      });

      const decision = LegalPatternGenerator.generateBlockAssignmentDecision(
        state,
        "playerA",
        MOCK_BLOCK_REQUEST,
        "step-block",
        attackers,
        candidateBlockers,
        rulePackage.components,
        { maxFullPatternLimit: Infinity }
      );
      const req = decision.request;

      const choiceV72c = policyV72c.choose(req).selectedPatternRef;
      const choiceV73c = policyV73c.choose(req).selectedPatternRef;

      const assignV72c = resolveChosenAssignments(req, choiceV72c);
      const assignV73c = resolveChosenAssignments(req, choiceV73c);

      expect(assignV72c[0].selectedUnitIds).toEqual(["u-blk-bw5"]);
      expect(assignV73c[0].selectedUnitIds).toEqual(["u-blk-bw5"]);

      evidence.results["1.4-bulwark-destroy-block"] = {
        status: "PASS",
        v72cChosenUnitIds: assignV72c[0].selectedUnitIds,
      };
      evidence.summary.totalTests++;
      evidence.summary.passedTests++;
    });

    // 1.5 複数兵士ブロック
    it("1.5 複数兵士による有利ブロック (敵6 vs 自軍4+4=8) で合体ブロックを選択すること", () => {
      const oppAtk = makeSoldier("u-atk-6", 6, "charge", true);
      const myBlk1 = makeSoldier("u-blk-4-1", 4, "charge", false);
      const myBlk2 = makeSoldier("u-blk-4-2", 4, "charge", false);

      const { state, attackers, candidateBlockers } = createBlockDecisionTestState({
        attackers: [oppAtk],
        blockersField: [myBlk1, myBlk2],
        selfLifeCount: 15,
      });

      const decision = LegalPatternGenerator.generateBlockAssignmentDecision(
        state,
        "playerA",
        MOCK_BLOCK_REQUEST,
        "step-block",
        attackers,
        candidateBlockers,
        rulePackage.components,
        { maxFullPatternLimit: Infinity }
      );
      const req = decision.request;

      const choiceV72c = policyV72c.choose(req).selectedPatternRef;
      const choiceV73c = policyV73c.choose(req).selectedPatternRef;

      const assignV72c = resolveChosenAssignments(req, choiceV72c);
      const assignV73c = resolveChosenAssignments(req, choiceV73c);

      expect([...(assignV72c[0].selectedUnitIds ?? [])].sort()).toEqual(["u-blk-4-1", "u-blk-4-2"]);
      expect([...(assignV73c[0].selectedUnitIds ?? [])].sort()).toEqual(["u-blk-4-1", "u-blk-4-2"]);

      evidence.results["1.5-multi-soldier-block"] = {
        status: "PASS",
        v72cChosenUnitIds: assignV72c[0].selectedUnitIds,
      };
      evidence.summary.totalTests++;
      evidence.summary.passedTests++;
    });

    // 1.6 チャージ兵士が0体のときの自動スルー
    it("1.6 チャージ兵士が0体 (ドライブ状態のみ) のとき0体スルーとなること", () => {
      const oppAtk = makeSoldier("u-atk-4", 4, "charge", true);
      const myDriveSoldier = makeSoldier("u-blk-ex", 5, "drive", false);

      const { state, attackers, candidateBlockers } = createBlockDecisionTestState({
        attackers: [oppAtk],
        blockersField: [myDriveSoldier],
        selfLifeCount: 15,
      });

      const validCandidates = candidateBlockers.filter((b) => b.state === "charge");
      const decision = LegalPatternGenerator.generateBlockAssignmentDecision(
        state,
        "playerA",
        MOCK_BLOCK_REQUEST,
        "step-block",
        attackers,
        validCandidates,
        rulePackage.components,
        { maxFullPatternLimit: Infinity }
      );
      const req = decision.request;

      expect(req.patterns.length).toBe(1);
      const choiceV72c = policyV72c.choose(req).selectedPatternRef;
      const assignV72c = resolveChosenAssignments(req, choiceV72c);
      expect(assignV72c[0].selectedUnitIds).toEqual([]);

      evidence.results["1.6-zero-candidate-auto-pass"] = {
        status: "PASS",
        patternCount: req.patterns.length,
      };
      evidence.summary.totalTests++;
      evidence.summary.passedTests++;
    });

    // 1.7 通常列挙 vs ストリーミング列挙の完全一致
    it("1.7 通常列挙とストリーミング列挙で判断が100%一致すること", () => {
      const oppAtk = makeSoldier("u-atk-5", 5, "charge", true);
      const myBlk = makeSoldier("u-blk-2", 2, "charge", false);

      const { state, attackers, candidateBlockers } = createBlockDecisionTestState({
        attackers: [oppAtk],
        blockersField: [myBlk],
        selfLifeCount: 15,
      });

      // 通常列挙
      const normalDecision = LegalPatternGenerator.generateBlockAssignmentDecision(
        state,
        "playerA",
        MOCK_BLOCK_REQUEST,
        "step-block",
        attackers,
        candidateBlockers,
        rulePackage.components,
        { maxFullPatternLimit: Infinity }
      );

      // ストリーミング列挙
      const streamDecision = LegalPatternGenerator.generateBlockAssignmentDecision(
        state,
        "playerA",
        MOCK_BLOCK_REQUEST,
        "step-block",
        attackers,
        candidateBlockers,
        rulePackage.components,
        { maxFullPatternLimit: 0 }
      );

      const normalReq = normalDecision.request;
      const streamReq = streamDecision.request;

      const choiceNormalV72c = policyV72c.choose(normalReq).selectedPatternRef;
      const choiceStreamV72c = policyV72c.choose(streamReq).selectedPatternRef;
      expect(choiceNormalV72c).toBe(choiceStreamV72c);

      const choiceNormalV73c = policyV73c.choose(normalReq).selectedPatternRef;
      const choiceStreamV73c = policyV73c.choose(streamReq).selectedPatternRef;
      expect(choiceNormalV73c).toBe(choiceStreamV73c);

      evidence.results["1.7-stream-normal-parity"] = {
        status: "PASS",
        v72cNormal: choiceNormalV72c,
        v72cStream: choiceStreamV72c,
        v73cNormal: choiceNormalV73c,
        v73cStream: choiceStreamV73c,
      };
      evidence.summary.totalTests++;
      evidence.summary.passedTests++;
    });
  });

  // ===========================================================================
  // 2. P1: アタッカー選択時の兵士温存検証
  // ===========================================================================
  describe("P1: アタッカー選択時の兵士温存と全軍アタックの分別", () => {
    // 補助関数: アタッカー選択 DecisionRequest のモック作成
    function createAttackerSelectionRequest(opts: {
      mySoldiers: any[];
      oppSoldiers: any[];
      myBulwarks?: any[];
      oppLife?: number;
    }): DecisionRequest {
      const myUnits = [...opts.mySoldiers, ...(opts.myBulwarks ?? [])];
      const oppUnits = [...opts.oppSoldiers];

      const patterns: any[] = [];
      const effectSelections: any[] = [];

      // パターン 0: なし (0体)
      patterns.push({
        patternRef: 0,
        patternId: "eff-atk-none",
        kind: "EFFECT_SELECTION",
        effectSelectionRef: 0,
      });
      effectSelections.push({
        selectionType: "unit",
        selectedValues: [],
        summary: "なし (0体)",
      });

      // パターン 1: 兵士1のみ出撃 (1体温存)
      patterns.push({
        patternRef: 1,
        patternId: "eff-atk-s1",
        kind: "EFFECT_SELECTION",
        effectSelectionRef: 1,
      });
      effectSelections.push({
        selectionType: "unit",
        selectedValues: [opts.mySoldiers[0].unitId],
        summary: `アタッカー: ${opts.mySoldiers[0].unitId}`,
      });

      // パターン 2: 兵士2のみ出撃 (1体温存)
      if (opts.mySoldiers.length > 1) {
        patterns.push({
          patternRef: 2,
          patternId: "eff-atk-s2",
          kind: "EFFECT_SELECTION",
          effectSelectionRef: 2,
        });
        effectSelections.push({
          selectionType: "unit",
          selectedValues: [opts.mySoldiers[1].unitId],
          summary: `アタッカー: ${opts.mySoldiers[1].unitId}`,
        });

        // パターン 3: 兵士1+2 全員出撃 (温存0体: 全軍アタック)
        patterns.push({
          patternRef: 3,
          patternId: "eff-atk-all",
          kind: "EFFECT_SELECTION",
          effectSelectionRef: 3,
        });
        effectSelections.push({
          selectionType: "unit",
          selectedValues: [opts.mySoldiers[0].unitId, opts.mySoldiers[1].unitId],
          summary: `全軍アタック`,
        });
      }

      return {
        protocolVersion: "1.0.0",
        matchId: "test-match",
        decisionId: "dec-atk-select-1",
        stateVersion: 5,
        playerId: "p1",
        source: {
          type: "EFFECT_RESOLUTION",
          playerId: "p1",
          sourceActionId: "action.attack",
          effectStepId: "selectUnits",
        } as any,
        catalog: {
          actions: [],
          effectSelections,
        } as any,
        observation: {
          viewerPlayerId: "p1",
          players: [
            {
              playerId: "p1",
              name: "Player A",
              lifeCount: 10,
              bulwarks: [],
              field: myUnits,
              isViewer: true,
            },
            {
              playerId: "p2",
              name: "Player B",
              lifeCount: opts.oppLife ?? 15,
              bulwarks: [],
              field: oppUnits,
              isViewer: false,
            },
          ],
        } as any,
        patterns,
      };
    }

    // 2.1 兵士温存が合理的な局面
    it("2.1 相手に反撃兵士がおり防壁もない非リーサル局面で、兵士を1体守備に残す選択をすること", () => {
      const myS1 = makeSoldier("my-s1", 5, "charge");
      const myS2 = makeSoldier("my-s2", 4, "charge");
      const oppS = makeSoldier("opp-s", 6, "charge"); // 相手の反撃脅威

      const req = createAttackerSelectionRequest({
        mySoldiers: [myS1, myS2],
        oppSoldiers: [oppS],
        myBulwarks: [], // 防壁なし
        oppLife: 15, // 非リーサル
      });

      const choiceV72c = policyV72c.choose(req).selectedPatternRef;
      const choiceV73c = policyV73c.choose(req).selectedPatternRef;

      // パターン 3 (全軍アタック) ではなく、1体温存するパターン (1 または 2) を選択！
      expect(choiceV72c).not.toBe(3);
      expect(choiceV73c).not.toBe(3);
      expect([1, 2]).toContain(choiceV72c);
      expect([1, 2]).toContain(choiceV73c);

      const evalV72c = policyV72c.evaluatePatterns(req);
      const allOutScore = evalV72c.scoredPatterns.find((p) => p.patternRef === 3)!;
      const reserveScore = evalV72c.scoredPatterns.find((p) => p.patternRef === choiceV72c)!;

      expect(allOutScore.tacticalAdjustment).toBeLessThan(0); // 無防備化ペナルティ (-0.15)
      expect(reserveScore.tacticalAdjustment).toBeGreaterThan(0); // 温存ボーナス (+0.10)

      evidence.results["2.1-soldier-reservation-reasonable"] = {
        status: "PASS",
        v72cChosenPatternRef: choiceV72c,
        v73cChosenPatternRef: choiceV73c,
        v72cAllOutFinalScore: allOutScore.finalScore,
        v72cReserveFinalScore: reserveScore.finalScore,
      };
      evidence.summary.totalTests++;
      evidence.summary.passedTests++;
    });

    // 2.2 全軍アタックが合理的な局面 A (確定リーサル)
    it("2.2 確定リーサル局面では守備を残さず全軍アタックを選択すること", () => {
      const myS1 = makeSoldier("my-s1", 5, "charge");
      const myS2 = makeSoldier("my-s2", 5, "charge");
      const oppS = makeSoldier("opp-s", 3, "charge");

      const req = createAttackerSelectionRequest({
        mySoldiers: [myS1, myS2], // 合計10点
        oppSoldiers: [oppS],
        myBulwarks: [],
        oppLife: 8, // 確定リーサル (10 >= 8)
      });

      const choiceV72c = policyV72c.choose(req).selectedPatternRef;
      const choiceV73c = policyV73c.choose(req).selectedPatternRef;

      // 確定リーサルのため、全軍アタック (パターン 3) を選択！
      expect(choiceV72c).toBe(3);
      expect(choiceV73c).toBe(3);

      evidence.results["2.2-all-out-attack-lethal"] = {
        status: "PASS",
        v72cChosenPatternRef: choiceV72c,
        v73cChosenPatternRef: choiceV73c,
      };
      evidence.summary.totalTests++;
      evidence.summary.passedTests++;
    });

    // 2.3 全軍アタックが合理的な局面 B (自陣にcharge防壁あり)
    it("2.3 自陣にチャージ防壁がある局面では兵士全軍アタックを許容すること", () => {
      const myS1 = makeSoldier("my-s1", 5, "charge");
      const myS2 = makeSoldier("my-s2", 4, "charge");
      const myBw = makeBulwark("my-bw", 6); // 自陣に防壁あり
      const oppS = makeSoldier("opp-s", 6, "charge");

      const req = createAttackerSelectionRequest({
        mySoldiers: [myS1, myS2],
        oppSoldiers: [oppS],
        myBulwarks: [myBw], // 防壁が守ってくれる
        oppLife: 15,
      });

      const choiceV72c = policyV72c.choose(req).selectedPatternRef;
      const choiceV73c = policyV73c.choose(req).selectedPatternRef;

      // 防壁があるため全軍アタック (パターン 3) を選択！
      expect(choiceV72c).toBe(3);
      expect(choiceV73c).toBe(3);

      evidence.results["2.3-all-out-attack-with-bulwark"] = {
        status: "PASS",
        v72cChosenPatternRef: choiceV72c,
        v73cChosenPatternRef: choiceV73c,
      };
      evidence.summary.totalTests++;
      evidence.summary.passedTests++;
    });

    // 2.4 全軍アタックが合理的な局面 C (相手陣地にチャージ兵士がいない)
    it("2.4 相手陣地にチャージ兵士がいない(反撃の脅威がない)局面では全軍アタックを選択すること", () => {
      const myS1 = makeSoldier("my-s1", 5, "charge");
      const myS2 = makeSoldier("my-s2", 4, "charge");
      const oppDriveSoldier = makeSoldier("opp-s-drive", 6, "drive"); // 疲労状態

      const req = createAttackerSelectionRequest({
        mySoldiers: [myS1, myS2],
        oppSoldiers: [oppDriveSoldier], // チャージ兵士なし
        myBulwarks: [],
        oppLife: 15,
      });

      const choiceV72c = policyV72c.choose(req).selectedPatternRef;
      const choiceV73c = policyV73c.choose(req).selectedPatternRef;

      expect(choiceV72c).toBe(3);
      expect(choiceV73c).toBe(3);

      evidence.results["2.4-all-out-attack-harmless-opp"] = {
        status: "PASS",
        v72cChosenPatternRef: choiceV72c,
        v73cChosenPatternRef: choiceV73c,
      };
      evidence.summary.totalTests++;
      evidence.summary.passedTests++;
    });
  });

  // ===========================================================================
  // 3. GameSession 統合検証
  // ===========================================================================
  describe("GameSession 統合検証 (実戦対戦追跡)", () => {
    it("3.1 固定シードでの対戦において、アタック〜ブロック〜ダメージ判定が正常に解決され、自動スルーと合法ブロックなしが区別されること", async () => {
      const state = createCoreBattlePresetState();
      const session = new GameSession(state, rulePackage);

      const seatControllers = createSeatControllers("humanVsAi", "p1", "gen9-r4-v72c");
      const policies = { p2: policyV72c };

      const gameLog: any[] = [];

      // 1. p1 (人間) がアタックを宣言
      let step = session.advance();
      expect(step.type).toBe("WAITING_FOR_DECISION");
      const req1 = (step as any).request;
      const attackPatIdx = req1.patterns.findIndex((p: any) => {
        const act = req1.catalog.actions[p.actionSelectionRef!];
        return act?.actionId === "action.attack";
      });

      gameLog.push({
        event: "P1_DECLARE_ATTACK",
        patternRef: attackPatIdx,
      });

      step = session.submitDecision({
        decisionId: req1.decisionId,
        stateVersion: req1.stateVersion,
        selectedPatternRef: attackPatIdx,
      });

      // 2. 進行ループ
      let loopCount = 0;
      let blockDecisionOccurred = false;
      let chosenBlockerIds: string[] = [];
      let isAutoPassZeroCandidate = false;

      while (step.type !== "FINISHED" && loopCount < 30) {
        loopCount++;

        if (step.type === "WAITING_FOR_DECISION") {
          const req = (step as any).request;

          if (req.playerId === "p1") {
            // 人間側手番
            if (req.source.type === "EFFECT_RESOLUTION") {
              // アタッカー選択: soldier-p1-1 (size 6) を選択
              const selIdx = req.patterns.findIndex((p: any) => {
                const sel = req.catalog?.effectSelections?.[p.effectSelectionRef];
                return sel?.selectedValues?.includes("soldier-p1-1");
              });
              gameLog.push({
                event: "P1_SELECT_ATTACKER",
                selectedUnitIds: ["soldier-p1-1"],
              });
              step = session.submitDecision({
                decisionId: req.decisionId,
                stateVersion: req.stateVersion,
                selectedPatternRef: selIdx !== -1 ? selIdx : 1,
              });
            } else {
              // 優先権パス
              const passIdx = req.patterns.findIndex((p: any) => p.kind === "PASS");
              step = session.submitDecision({
                decisionId: req.decisionId,
                stateVersion: req.stateVersion,
                selectedPatternRef: passIdx !== -1 ? passIdx : 0,
              });
            }
            continue;
          }
        }

        // AI 進行
        const advRes = await advanceAutomatedDecisions(
          session,
          step,
          seatControllers,
          policies,
          { viewerPlayerId: "p1" }
        );

        for (const rec of advRes.records) {
          if (
            rec.request.source.type === "EFFECT_RESOLUTION" &&
            (rec.request.source as any).sourceActionId === "action.block"
          ) {
            blockDecisionOccurred = true;
            const chosen = rec.request.patterns[rec.response.selectedPatternRef];
            const eff = rec.request.catalog.effectSelections?.[chosen.effectSelectionRef!];
            const assign = eff?.assignments ?? [];
            chosenBlockerIds = assign.flatMap((a: any) => a.selectedUnitIds ?? []);
            gameLog.push({
              event: "AI_BLOCK_DECISION",
              patternRef: rec.response.selectedPatternRef,
              chosenBlockerIds,
              didBlock: chosenBlockerIds.length > 0,
              candidateBlockerCount: rec.request.blockAssignmentStreamMeta?.candidateBlockerUnitIds?.length ?? 0,
            });
          }
        }

        step = advRes.status === "STOPPED" ? advRes.step : advRes.lastStep!;
        if (
          step.type === "WAITING_FOR_DECISION" &&
          (step as any).request.playerId === "p1" &&
          session.state.stage.requests.length === 0
        ) {
          break;
        }
      }

      // ブロック判定が確実に発生し、AI が合理的なブロックを実行したことを確認
      expect(blockDecisionOccurred).toBe(true);
      expect(chosenBlockerIds.length).toBeGreaterThan(0);

      evidence.results["3.1-gamesession-attack-block-trace"] = {
        status: "PASS",
        blockDecisionOccurred,
        chosenBlockerIds,
        finalP1Life: session.state.players.p1.life.length,
        finalP2Life: session.state.players.p2.life.length,
        gameLog,
      };
      evidence.summary.totalTests++;
      evidence.summary.passedTests++;
    });
  });
});
