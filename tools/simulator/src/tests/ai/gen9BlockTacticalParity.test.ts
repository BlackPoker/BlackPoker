/**
 * gen9BlockTacticalParity.test.ts
 *
 * BlackPoker Simulator - Gen 9 通常ブロック戦術評価の修正・経路一致テスト (Work 5-4A)
 *
 * 【検証要件】
 * 1. 正本データモデル遵守:
 *    - LegalPattern.effectSelectionRef -> DecisionCatalog.effectSelections -> EffectSelection.assignments
 *      -> UnitAssignment.sourceUnitId / selectedUnitIds からブロック割り当てを取得すること。
 *    - pattern.keyUnitSelectionRef および catalog.unitSelections を正本として扱わないこと。
 * 2. 通常ブロック (Method A: patterns 列挙) とストリーミングブロック (Method B: blockAssignmentStream) の完全一致:
 *    - LegalPatternGenerator.generateBlockAssignmentDecision() を用いて同一盤面から
 *      Method A ({ maxFullPatternLimit: Infinity }) と Method B ({ maxFullPatternLimit: 0 }) を生成。
 *    - 以下の全ケースをテスト:
 *      (1) ブロックしない
 *      (2) 兵士1体でブロック
 *      (3) 複数兵士でブロック（合計サイズ比較による有利トレード・相討ち・不利トレード）
 *      (4) 防壁でブロック（印刷ランク一致・Joker によるアタッカー破壊、ランク不一致によるダメージ吸収）
 *      (5) 未ブロック時に致死 (t15 = 1.0) および危険域ダメージ (t16 > 0)
 *      (6) 有利なトレード (t14 > 0)
 *      (7) 不利なトレード (t14 < 0)
 *      (8) 256件以下 (1 Attacker + 8 Soldiers = 256件) と 257件以上 (1 Attacker + 8 Soldiers + 1 Bulwark = 257件) の境界
 *    - 同じ割り当てに対して、両方式で t14〜t16 の値・ベーススコア・戦術スコア・最終スコアが完全一致すること。
 *    - selectedPatternRef の番号だけでなく、実際に選ばれた割り当て内容 (UnitAssignment[]) で比較し一致すること。
 * 3. エンコーダバージョン識別:
 *    - "v7.0-legacy-block-stream-only" と "v7.1-unified-block-assignment" を明確に区別できること。
 */

import { describe, it, expect, beforeAll } from "vitest";
import * as path from "node:path";
import { LegalPatternGenerator } from "../../engine/decision/LegalPatternGenerator.js";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader.js";
import { RulePackage } from "../../domain/rules/RulePackage.js";
import { DecisionDNA } from "../../domain/ai/DecisionDNATypes.js";
import { DecisionRequest } from "../../domain/decision/DecisionRequest.js";
import { UnitAssignment } from "../../domain/decision/DecisionCatalog.js";
import {
  Gen9LearnableTacticalPolicy,
  fromV6DNA,
  R4_PRESET_TACTICAL_WEIGHTS,
  TACTICAL_FEATURE_ENCODER_VERSION_CURRENT,
  TACTICAL_FEATURE_ENCODER_VERSION_LEGACY,
  TACTICAL_FEATURE_ENCODER_VERSION_V71,
  TACTICAL_FEATURE_ENCODER_VERSION_V72,
  TACTICAL_FEATURE_ENCODER_VERSION_V73,
  extractBlockAssignmentsFromPattern,
  createBlockTacticalContext,
} from "../../engine/ai/Gen9LearnableTacticalPolicy.js";
import { Gen9TacticalPrototypePolicy } from "../../engine/ai/Gen9TacticalPrototypePolicy.js";
import { GenericTacticalEvaluator } from "../../engine/rules/GenericTacticalEvaluator.js";
import { loadAndValidateGen8ChampionCandidateDNA } from "../../engine/ai/Gen8DNALoader.js";

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

function makeHero(
  id: string,
  size: number,
  state: "charge" | "drive" = "charge",
  isAttacker: boolean = false
): any {
  const unit: any = {
    id,
    unitId: id,
    kind: "英雄",
    componentId: "character.hero",
    properties: { characterType: "hero" },
    cards: [
      makeCard(`card-${id}-1`, Math.floor(size / 2), "H"),
      makeCard(`card-${id}-2`, size - Math.floor(size / 2), "D"),
    ],
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
  const selfLifeCount = params.selfLifeCount ?? 10;
  const oppLifeCount = params.oppLifeCount ?? 10;

  const selfLifeCards = Array.from({ length: selfLifeCount }, (_, i) =>
    makeCard(`life-a-${i}`, (i % 10) + 1)
  );
  const oppLifeCards = Array.from({ length: oppLifeCount }, (_, i) =>
    makeCard(`life-b-${i}`, (i % 10) + 1)
  );

  // Set battle.role = "attacker" on all attackers
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

/**
 * 選択された patternRef から実際の UnitAssignment[] を復元（Method A と Method B の双方に対応）
 */
function resolveChosenAssignments(
  request: Readonly<DecisionRequest>,
  selectedPatternRef: number
): readonly UnitAssignment[] {
  if (request.patterns.length > 0) {
    const pat = request.patterns[selectedPatternRef];
    expect(pat).toBeDefined();
    expect(pat.effectSelectionRef).toBeDefined();
    const eff = request.catalog.effectSelections[pat.effectSelectionRef!];
    expect(eff).toBeDefined();
    expect(eff.selectionType).toBe("unitAssignment");
    return eff.assignments ?? [];
  }

  expect(request.blockAssignmentStream).toBeDefined();
  let idx = 0;
  for (const assignments of request.blockAssignmentStream!.iterateAssignments()) {
    if (idx === selectedPatternRef) {
      return assignments.map((a) => ({
        sourceUnitId: a.sourceUnitId,
        selectedUnitIds: [...a.selectedUnitIds],
      }));
    }
    idx++;
  }
  throw new Error(`selectedPatternRef=${selectedPatternRef} not found in stream`);
}

const MOCK_SOURCE_REQUEST: any = { id: "req-block", actionId: "action.block" };

/**
 * 同一盤面から生成した Method A (通常パターン列挙) と Method B (ストリーミング列挙) で
 * 全パターンの t14〜t16・ベーススコア・戦術スコア・最終スコアおよび選択結果 (UnitAssignment[]) が
 * 完全一致することを検証する共通ヘルパー
 */
function assertNormalAndStreamingFullParity(
  state: any,
  rulePkg: RulePackage,
  attackers: any[],
  candidateBlockers: any[],
  policies: Gen9LearnableTacticalPolicy[],
  prototypePolicies: Gen9TacticalPrototypePolicy[] = []
): {
  normalReq: DecisionRequest;
  streamReq: DecisionRequest;
} {
  // Method A: 通常の合法パターンを全件列挙
  const normalReq = LegalPatternGenerator.generateBlockAssignmentDecision(
    state,
    "playerA",
    MOCK_SOURCE_REQUEST,
    "step-block",
    attackers,
    candidateBlockers,
    rulePkg.components,
    { maxFullPatternLimit: Infinity }
  ).request;

  // Method B: ストリーミングでブロック割り当てを列挙 (patterns = [])
  const streamReq = LegalPatternGenerator.generateBlockAssignmentDecision(
    state,
    "playerA",
    MOCK_SOURCE_REQUEST,
    "step-block",
    attackers,
    candidateBlockers,
    rulePkg.components,
    { maxFullPatternLimit: 0 }
  ).request;

  expect(normalReq.patterns.length).toBeGreaterThan(0);
  expect(streamReq.patterns.length).toBe(0);
  expect(streamReq.blockAssignmentStream).toBeDefined();
  expect(streamReq.blockAssignmentStream!.patternCount).toBe(normalReq.patterns.length);

  // 正本データモデルの確認: catalog.unitSelections は空であり、catalog.effectSelections に格納されていること
  expect(normalReq.catalog.unitSelections.length).toBe(0);
  expect(normalReq.catalog.effectSelections.length).toBe(normalReq.patterns.length);

  for (const policy of policies) {
    const normalEval = policy.evaluatePatterns(normalReq);
    const normalChoice = policy.choose(normalReq);
    const streamChoice = policy.choose(streamReq);

    expect(normalChoice.selectedPatternRef).toBe(normalEval.bestPatternRef);

    // 全パターンの1件ずつの完全一致検証
    const normalByRef = new Map(normalEval.scoredPatterns.map((d) => [d.patternRef, d]));
    let streamIdx = 0;
    for (const streamAssignments of streamReq.blockAssignmentStream!.iterateAssignments()) {
      const normalDetail = normalByRef.get(streamIdx);
      expect(normalDetail).toBeDefined();

      // 正本経路で取得した割り当て内容とストリーミングの割り当て内容が完全一致すること
      const pat = normalReq.patterns[streamIdx];
      const extractedAssignments = extractBlockAssignmentsFromPattern(normalReq, pat);
      expect(extractedAssignments).toEqual(streamAssignments);

      const streamDetail = policy.evaluateSingleBlockAssignment(
        streamReq,
        streamAssignments,
        streamIdx
      );

      // t14, t15, t16 の完全一致
      expect(normalDetail!.tacticalFeatures[14]).toBeCloseTo(
        streamDetail.tacticalFeatures[14],
        12
      );
      expect(normalDetail!.tacticalFeatures[15]).toBeCloseTo(
        streamDetail.tacticalFeatures[15],
        12
      );
      expect(normalDetail!.tacticalFeatures[16]).toBeCloseTo(
        streamDetail.tacticalFeatures[16],
        12
      );

      // ベーススコア、戦術調整値、最終スコアの完全一致
      expect(normalDetail!.baseScore).toBeCloseTo(streamDetail.baseScore, 10);
      expect(normalDetail!.tacticalAdjustment).toBeCloseTo(
        streamDetail.tacticalAdjustment,
        10
      );
      expect(normalDetail!.finalScore).toBeCloseTo(streamDetail.finalScore, 10);

      streamIdx++;
    }
    expect(streamIdx).toBe(normalReq.patterns.length);

    // 選択された patternRef および実際の UnitAssignment[] の完全一致
    expect(streamChoice.selectedPatternRef).toBe(normalChoice.selectedPatternRef);
    const chosenNormalAssignments = resolveChosenAssignments(
      normalReq,
      normalChoice.selectedPatternRef
    );
    const chosenStreamAssignments = resolveChosenAssignments(
      streamReq,
      streamChoice.selectedPatternRef
    );
    expect(chosenStreamAssignments).toEqual(chosenNormalAssignments);
  }

  for (const protoPolicy of prototypePolicies) {
    const normalChoice = protoPolicy.choose(normalReq);
    const streamChoice = protoPolicy.choose(streamReq);
    expect(streamChoice.selectedPatternRef).toBe(normalChoice.selectedPatternRef);
    const chosenNormalAssignments = resolveChosenAssignments(
      normalReq,
      normalChoice.selectedPatternRef
    );
    const chosenStreamAssignments = resolveChosenAssignments(
      streamReq,
      streamChoice.selectedPatternRef
    );
    expect(chosenStreamAssignments).toEqual(chosenNormalAssignments);
  }

  return { normalReq, streamReq };
}

describe("Work 5-4A: Gen 9 通常ブロック戦術評価とストリーミング評価の経路一致検証", () => {
  let rulePkg: RulePackage;
  let gen8DNA: DecisionDNA;
  let r4Policy: Gen9LearnableTacticalPolicy;
  let g0Ind2Policy: Gen9LearnableTacticalPolicy;
  let protoPolicy: Gen9TacticalPrototypePolicy;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePkg = await loadRulePackageFromDirectory(rulesDir);
    const evaluator = new GenericTacticalEvaluator(rulePkg);
    Gen9TacticalPrototypePolicy.setDefaultEvaluator(evaluator);

    gen8DNA = loadAndValidateGen8ChampionCandidateDNA();

    const r4Genome = fromV6DNA(gen8DNA, "r4", {
      id: "test-r4-v7.1",
      name: "R4 Preset (v7.1)",
      encoderVersion: TACTICAL_FEATURE_ENCODER_VERSION_CURRENT,
    });
    r4Policy = new Gen9LearnableTacticalPolicy(r4Genome, "R4_v7.1", evaluator);

    // Work 5-2 R2 G0_IND2 重み (Counter Selective)
    const g0Ind2Weights = [
      0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
      +2.6, +2.0, +1.1, +0.15,
      0.0, 0.0, 0.0, -0.30, 0.0, -2.5, 0.0,
      0.0, +2.0, +2.5,
    ];
    const g0Ind2Genome = fromV6DNA(gen8DNA, g0Ind2Weights, {
      id: "test-g0-ind2-v7.1",
      name: "G0_IND2 (v7.1)",
      encoderVersion: TACTICAL_FEATURE_ENCODER_VERSION_CURRENT,
    });
    g0Ind2Policy = new Gen9LearnableTacticalPolicy(g0Ind2Genome, "G0_IND2_v7.1", evaluator);

    protoPolicy = new Gen9TacticalPrototypePolicy(
      gen8DNA,
      "Proto_v7.1",
      evaluator,
      TACTICAL_FEATURE_ENCODER_VERSION_CURRENT
    );
  });

  it("1. 正本データモデル検証: keyUnitSelectionRef/unitSelections ではなく effectSelectionRef/effectSelections.assignments から取得すること", () => {
    const { state, attackers, candidateBlockers } = createBlockDecisionTestState({
      attackers: [makeSoldier("atk-1", 6, "drive", true)],
      blockersField: [makeSoldier("blk-1", 8, "charge")],
      selfLifeCount: 6,
    });

    const normalReq = LegalPatternGenerator.generateBlockAssignmentDecision(
      state,
      "playerA",
      MOCK_SOURCE_REQUEST,
      "step-canonical",
      attackers,
      candidateBlockers,
      rulePkg.components,
      { maxFullPatternLimit: Infinity }
    ).request;

    expect(normalReq.patterns.length).toBe(2);
    expect(normalReq.catalog.unitSelections).toEqual([]);
    expect(normalReq.catalog.effectSelections.length).toBe(2);

    const ctx = createBlockTacticalContext(normalReq);
    for (const pat of normalReq.patterns) {
      expect(pat.kind).toBe("EFFECT_SELECTION");
      expect(pat.keyUnitSelectionRef).toBeUndefined();
      expect(pat.effectSelectionRef).toBeDefined();
      const assignments = extractBlockAssignmentsFromPattern(normalReq, pat, ctx);
      expect(assignments).toBeDefined();
      expect(assignments!.length).toBe(1);
      expect(assignments![0].sourceUnitId).toBe("atk-1");
    }

    // 仮にダミーの unitSelections / keyUnitSelectionRef が混入していても effectSelectionRef がなければ無視されること
    const dummyPattern = {
      patternId: "pat-dummy",
      patternRef: 99,
      kind: "ACTION" as const,
      keyUnitSelectionRef: 0,
    };
    expect(extractBlockAssignmentsFromPattern(normalReq, dummyPattern as any, ctx)).toBeUndefined();
  });

  it("2. ケース (1) ブロックしない & ケース (5) 未ブロック時致死 (t15=1.0) / 危険域ダメージ (t16>0) & ケース (2)/(6) 兵士1体で有利ブロック", () => {
    // 自軍ライフ 6、相手アタッカー サイズ 6 (未ブロックなら 6 >= 6 で致死 t15=1.0)、自軍ブロッカー サイズ 8 (ブロックすれば 8 > 6 で有利トレード t14=1.0)
    const { state, attackers, candidateBlockers } = createBlockDecisionTestState({
      attackers: [makeSoldier("atk-6", 6, "drive", true)],
      blockersField: [makeSoldier("blk-8", 8, "charge")],
      selfLifeCount: 6,
    });

    const { normalReq } = assertNormalAndStreamingFullParity(
      state,
      rulePkg,
      attackers,
      candidateBlockers,
      [r4Policy, g0Ind2Policy],
      [protoPolicy]
    );

    const evalResult = r4Policy.evaluatePatterns(normalReq);
    // Pattern 0: ブロックしない (selectedUnitIds: []) -> t14=0, t15=1.0, t16=0
    const unblockedDetail = evalResult.scoredPatterns.find((d) => {
      const a = resolveChosenAssignments(normalReq, d.patternRef);
      return a[0].selectedUnitIds.length === 0;
    })!;
    expect(unblockedDetail.tacticalFeatures[14]).toBe(0);
    expect(unblockedDetail.tacticalFeatures[15]).toBe(1.0);
    expect(unblockedDetail.tacticalFeatures[16]).toBe(0);
    expect(unblockedDetail.tacticalAdjustment).toBeCloseTo(-2.5, 8);

    // Pattern 1: blk-8 でブロック (selectedUnitIds: ["blk-8"]) -> t14=1.0, t15=0, t16=0
    const blockedDetail = evalResult.scoredPatterns.find((d) => {
      const a = resolveChosenAssignments(normalReq, d.patternRef);
      return a[0].selectedUnitIds.includes("blk-8");
    })!;
    expect(blockedDetail.tacticalFeatures[14]).toBe(1.0);
    expect(blockedDetail.tacticalFeatures[15]).toBe(0);
    expect(blockedDetail.tacticalFeatures[16]).toBe(0);
    expect(blockedDetail.tacticalAdjustment).toBeCloseTo(+0.2, 8);

    // 致死回避かつ有利トレードのため、ブロックする手が確実に選択されること
    const chosen = resolveChosenAssignments(normalReq, evalResult.bestPatternRef);
    expect(chosen[0].selectedUnitIds).toEqual(["blk-8"]);

    // 危険域ダメージ (selfLife = 8, atk = 6 -> 残りライフ 2 <= 3 で t16 = 6/8 = 0.75) の検証
    const dangerSetup = createBlockDecisionTestState({
      attackers: [makeSoldier("atk-6", 6, "drive", true)],
      blockersField: [makeSoldier("blk-6", 6, "charge")], // 相討ち (t14 = 0.5)
      selfLifeCount: 8,
    });
    const { normalReq: dangerNormalReq } = assertNormalAndStreamingFullParity(
      dangerSetup.state,
      rulePkg,
      dangerSetup.attackers,
      dangerSetup.candidateBlockers,
      [r4Policy, g0Ind2Policy],
      [protoPolicy]
    );
    const dangerEval = r4Policy.evaluatePatterns(dangerNormalReq);
    const dangerUnblocked = dangerEval.scoredPatterns.find(
      (d) => resolveChosenAssignments(dangerNormalReq, d.patternRef)[0].selectedUnitIds.length === 0
    )!;
    expect(dangerUnblocked.tacticalFeatures[15]).toBe(0);
    expect(dangerUnblocked.tacticalFeatures[16]).toBeCloseTo(6 / 8, 8);

    const dangerEqualBlock = dangerEval.scoredPatterns.find(
      (d) => resolveChosenAssignments(dangerNormalReq, d.patternRef)[0].selectedUnitIds.length === 1
    )!;
    expect(dangerEqualBlock.tacticalFeatures[14]).toBeCloseTo(0.5, 8);
    expect(dangerEqualBlock.tacticalFeatures[16]).toBe(0);
  });

  it("3. ケース (3) 複数兵士でブロック & ケース (6) 有利トレード / ケース (7) 不利トレード（合計サイズ比較）", () => {
    // 相手アタッカー サイズ 8 に対して、自軍兵士 サイズ 4 と サイズ 5 (単体では 4 < 8, 5 < 8 で不利トレードだが、2体合算なら 4 + 5 = 9 > 8 で一方的に撃破し両方生存！)
    const { state, attackers, candidateBlockers } = createBlockDecisionTestState({
      attackers: [makeSoldier("atk-8", 8, "drive", true)],
      blockersField: [
        makeSoldier("blk-4", 4, "charge"),
        makeSoldier("blk-5", 5, "charge"),
      ],
      selfLifeCount: 12,
    });

    const { normalReq } = assertNormalAndStreamingFullParity(
      state,
      rulePkg,
      attackers,
      candidateBlockers,
      [r4Policy, g0Ind2Policy],
      [protoPolicy]
    );

    expect(normalReq.patterns.length).toBe(4); // [], [blk-4], [blk-5], [blk-4, blk-5]
    const evalResult = r4Policy.evaluatePatterns(normalReq);

    for (const d of evalResult.scoredPatterns) {
      const ids = resolveChosenAssignments(normalReq, d.patternRef)[0].selectedUnitIds;
      if (ids.length === 0) {
        // ブロックしない: Life 12 - 8 = 4 > 3 なので t14=0, t15=0, t16=0
        expect(d.tacticalFeatures[14]).toBe(0);
        expect(d.tacticalFeatures[15]).toBe(0);
        expect(d.tacticalFeatures[16]).toBe(0);
      } else if (ids.length === 1 && ids[0] === "blk-4") {
        // サイズ 4 単体でサイズ 8 をブロック: 不利トレード (4 < 8, 4 < 5 なので -0.25)
        expect(d.tacticalFeatures[14]).toBeCloseTo(-0.25, 8);
      } else if (ids.length === 1 && ids[0] === "blk-5") {
        // サイズ 5 単体でサイズ 8 をブロック: ライフ余裕時 (12 > 8) のサイズ5以上犬死ペナルティ (-0.75)
        expect(d.tacticalFeatures[14]).toBeCloseTo(-0.75, 8);
      } else if (ids.length === 2) {
        // 複数兵士 (4 + 5 = 9 > 8) でブロック: 合計サイズで上回りアタッカー撃破・全員生存の有利トレード (+1.0)
        expect(d.tacticalFeatures[14]).toBeCloseTo(+1.0, 8);
      }
    }
  });

  it("4. ケース (4) 防壁でブロック（印刷ランク一致・Joker による破壊 vs ランク不一致による吸収）", () => {
    // アタッカー: サイズ 7 (印刷ランク "7")
    // 防壁1: 印刷ランク "7" (ランク一致でアタッカー破壊 -> t14 = +1.0)
    // 防壁2: 印刷ランク "3" (ランク不一致だが兵士を失わず7ダメージ吸収 -> t14 = +0.25)
    // 防壁3: Joker (Joker は任意のアタッカーを破壊 -> t14 = +1.0)
    const { state, attackers, candidateBlockers } = createBlockDecisionTestState({
      attackers: [makeSoldier("atk-7", 7, "drive", true)],
      blockersField: [
        makeBulwark("bulwark-match", 7, "H", "7"),
        makeBulwark("bulwark-absorb", 3, "C", "3"),
        makeBulwark("bulwark-joker", 0, "JOKER", "JOKER"),
      ],
      selfLifeCount: 9,
    });

    const { normalReq } = assertNormalAndStreamingFullParity(
      state,
      rulePkg,
      attackers,
      candidateBlockers,
      [r4Policy, g0Ind2Policy],
      [protoPolicy]
    );

    // 防壁は単独ブロックのみ合法なので: [] + [bulwark-match] + [bulwark-absorb] + [bulwark-joker] = 4通り
    expect(normalReq.patterns.length).toBe(4);

    const evalResult = r4Policy.evaluatePatterns(normalReq);
    for (const d of evalResult.scoredPatterns) {
      const ids = resolveChosenAssignments(normalReq, d.patternRef)[0].selectedUnitIds;
      if (ids.length === 0) {
        // 未ブロック: 9 - 7 = 2 <= 3 なので危険域ダメージ t16 = 7/9
        expect(d.tacticalFeatures[14]).toBe(0);
        expect(d.tacticalFeatures[16]).toBeCloseTo(7 / 9, 8);
      } else if (ids[0] === "bulwark-match" || ids[0] === "bulwark-joker") {
        expect(d.tacticalFeatures[14]).toBeCloseTo(1.0, 8);
        expect(d.tacticalFeatures[16]).toBe(0);
      } else if (ids[0] === "bulwark-absorb") {
        expect(d.tacticalFeatures[14]).toBeCloseTo(0.25, 8);
        expect(d.tacticalFeatures[16]).toBe(0);
      }
    }
  });

  it("5. 複数アタッカーに対する複合ブロック割り当て（通常 vs ストリーミング完全一致）", () => {
    // アタッカー2体 (atk-1: サイズ6, atk-2: サイズ9)、自軍ブロッカー3体 (兵士5, 兵士5, 防壁9)
    // 5 + 5 = 10 > 9 で atk-2 を撃破しつつ、防壁9で atk-1 を吸収または撃破可能
    const { state, attackers, candidateBlockers } = createBlockDecisionTestState({
      attackers: [
        makeSoldier("atk-1", 6, "drive", true),
        makeSoldier("atk-2", 9, "drive", true),
      ],
      blockersField: [
        makeSoldier("blk-5a", 5, "charge"),
        makeSoldier("blk-5b", 5, "charge"),
        makeBulwark("blk-bulwark-6", 6, "D", "6"),
      ],
      selfLifeCount: 12,
    });

    assertNormalAndStreamingFullParity(
      state,
      rulePkg,
      attackers,
      candidateBlockers,
      [r4Policy, g0Ind2Policy],
      [protoPolicy]
    );
  });

  it("6. ケース (8) 256件以下 (1 Attacker + 8 Soldiers = 256件) と 257件以上 (1 Attacker + 8 Soldiers + 1 Bulwark = 257件) の境界テスト", () => {
    const eightSoldiers = Array.from({ length: 8 }, (_, i) =>
      makeSoldier(`blk-s-${i + 1}`, (i % 7) + 2, "charge")
    );

    // (8-A) 1 Attacker + 8 Soldiers = 2^8 = 256 パターン (デフォルトで通常パターン列挙 <= 256)
    const state256 = createBlockDecisionTestState({
      attackers: [makeHero("atk-hero-10", 10, "drive", true)],
      blockersField: eightSoldiers,
      selfLifeCount: 10,
    });

    const defaultReq256 = LegalPatternGenerator.generateBlockAssignmentDecision(
      state256.state,
      "playerA",
      MOCK_SOURCE_REQUEST,
      "step-256",
      state256.attackers,
      state256.candidateBlockers,
      rulePkg.components
    ).request;
    expect(defaultReq256.patterns.length).toBe(256);
    expect(defaultReq256.blockAssignmentStream?.patternCount).toBe(256);

    assertNormalAndStreamingFullParity(
      state256.state,
      rulePkg,
      state256.attackers,
      state256.candidateBlockers,
      [r4Policy, g0Ind2Policy],
      [protoPolicy]
    );

    // (8-B) 1 Attacker + 8 Soldiers + 1 Bulwark = 2^8 + 1 = 257 パターン (デフォルトでストリーミング列挙 > 256)
    const state257 = createBlockDecisionTestState({
      attackers: [makeHero("atk-hero-10", 10, "drive", true)],
      blockersField: [...eightSoldiers, makeBulwark("blk-bulwark-10", 10, "S", "10")],
      selfLifeCount: 10,
    });

    const defaultReq257 = LegalPatternGenerator.generateBlockAssignmentDecision(
      state257.state,
      "playerA",
      MOCK_SOURCE_REQUEST,
      "step-257",
      state257.attackers,
      state257.candidateBlockers,
      rulePkg.components
    ).request;
    expect(defaultReq257.patterns.length).toBe(0);
    expect(defaultReq257.blockAssignmentStream?.patternCount).toBe(257);

    assertNormalAndStreamingFullParity(
      state257.state,
      rulePkg,
      state257.attackers,
      state257.candidateBlockers,
      [r4Policy, g0Ind2Policy],
      [protoPolicy]
    );
  });

  it("7. 過去の評価結果保護・バージョン識別: v7.0-legacy-block-stream-only と v7.1-unified-block-assignment および v7.2, v7.3 が明確に区別されること", () => {
    const evaluator = Gen9TacticalPrototypePolicy.getDefaultEvaluator();
    const legacyGenome = fromV6DNA(gen8DNA, R4_PRESET_TACTICAL_WEIGHTS, {
      id: "legacy-v7.0",
      encoderVersion: TACTICAL_FEATURE_ENCODER_VERSION_LEGACY,
    });
    const v71Genome = fromV6DNA(gen8DNA, R4_PRESET_TACTICAL_WEIGHTS, {
      id: "current-v7.1",
      encoderVersion: TACTICAL_FEATURE_ENCODER_VERSION_V71,
    });
    const v72Genome = fromV6DNA(gen8DNA, R4_PRESET_TACTICAL_WEIGHTS, {
      id: "version-v7.2",
      encoderVersion: TACTICAL_FEATURE_ENCODER_VERSION_V72,
    });
    const currentGenome = fromV6DNA(gen8DNA, R4_PRESET_TACTICAL_WEIGHTS, {
      id: "current-v7.3",
      encoderVersion: TACTICAL_FEATURE_ENCODER_VERSION_CURRENT,
    });

    const legacyPolicy = new Gen9LearnableTacticalPolicy(legacyGenome, "Legacy_v7.0", evaluator);
    const v71Policy = new Gen9LearnableTacticalPolicy(v71Genome, "V71", evaluator);
    const v72Policy = new Gen9LearnableTacticalPolicy(v72Genome, "V72", evaluator);
    const currentPolicy = new Gen9LearnableTacticalPolicy(currentGenome, "Current_v7.3", evaluator);

    expect(legacyPolicy.getEncoderVersion()).toBe("v7.0-legacy-block-stream-only");
    expect(v71Policy.getEncoderVersion()).toBe("v7.1-unified-block-assignment");
    expect(v72Policy.getEncoderVersion()).toBe("v7.2-unified-block-conditional-pass");
    expect(currentPolicy.getEncoderVersion()).toBe("v7.3-cost-evaluated-v24");
    expect(legacyPolicy.descriptor.metadata?.tacticalFeatureEncoderVersion).toBe(
      "v7.0-legacy-block-stream-only"
    );
    expect(v71Policy.descriptor.metadata?.tacticalFeatureEncoderVersion).toBe(
      "v7.1-unified-block-assignment"
    );
    expect(v72Policy.descriptor.metadata?.tacticalFeatureEncoderVersion).toBe(
      "v7.2-unified-block-conditional-pass"
    );
    expect(currentPolicy.descriptor.metadata?.tacticalFeatureEncoderVersion).toBe(
      "v7.3-cost-evaluated-v24"
    );

    const { state, attackers, candidateBlockers } = createBlockDecisionTestState({
      attackers: [makeSoldier("atk-6", 6, "drive", true)],
      blockersField: [makeSoldier("blk-8", 8, "charge")],
      selfLifeCount: 6,
    });

    const normalReq = LegalPatternGenerator.generateBlockAssignmentDecision(
      state,
      "playerA",
      MOCK_SOURCE_REQUEST,
      "step-version-check",
      attackers,
      candidateBlockers,
      rulePkg.components,
      { maxFullPatternLimit: Infinity }
    ).request;

    const legacyEval = legacyPolicy.evaluatePatterns(normalReq);
    const currentEval = currentPolicy.evaluatePatterns(normalReq);

    // v7.0 では通常ブロックで t14, t15, t16 がすべて 0 だったことを再現
    for (const d of legacyEval.scoredPatterns) {
      expect(d.tacticalFeatures[14]).toBe(0);
      expect(d.tacticalFeatures[15]).toBe(0);
      expect(d.tacticalFeatures[16]).toBe(0);
      expect(d.tacticalAdjustment).toBe(0);
    }

    // v7.1 では通常ブロックで t14, t15 が正しく発火する
    const currentHasBlockFeatures = currentEval.scoredPatterns.some(
      (d) => d.tacticalFeatures[14] !== 0 || d.tacticalFeatures[15] !== 0
    );
    expect(currentHasBlockFeatures).toBe(true);
  });
});
