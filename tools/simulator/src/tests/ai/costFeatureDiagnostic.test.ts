/**
 * costFeatureDiagnostic.test.ts
 *
 * BlackPoker Simulator - Work 5-5C コスト支払い特徴量の識別能力診断 単体テスト (D1〜D14)
 *
 * 【検証項目】
 * D1: ゼロ重み完全互換 (v7.2 と v7.3 ゼロ重みのスコア・選択が完全一致、delta < 1e-12)
 * D2: カード数値差分識別 (C3 vs C8 で t20 が異なり、非ゼロ重みでスコア差が発生、小さい数字が有利)
 * D3: Joker 廃棄差分識別 (Joker 廃棄と通常カード廃棄で t21 が異なり、Joker 保持が有利)
 * D4: 犠牲ユニット差分識別 (サイズ違いの兵士犠牲で t22 が異なり、低コスト犠牲が有利)
 * D5: ライフ支払い割合差分識別 (同じ1枚支払いでも残ライフによる割合差で t23 が異なり、低割合が有利)
 * D6: 同ランク異スート衝突判定 (t20〜t23 で識別不能、衝突原因が SAME_RANK_DIFF_SUIT)
 * D7: 防壁ドライブ差分判定 (防壁ドライブ対象のみ異なる場合、BULWARK_DRIVE_DIFF_ONLY)
 * D8: 複合コスト数理的一致 (Δscore == Σ t_m * w_m、誤差 < 1e-12)
 * D9: グループ集計整合性 (完全衝突率、最高スコア同点率、ペア同点率などの関係式の整合性)
 * D10: シャドウ評価非干渉性 (実対戦レスポンスが診断によって変化しないこと)
 * D11: 不正ID診断 (未解決IDが検知され INVALID_REFERENCE として処理されること)
 * D12: Argmax変化検出 (非ゼロ重みによる最善手変更の分類)
 * D13: 再現性 (同一局面・重みで非時刻依存に完全再現)
 * D14: Evidence 整合性 (集計数値と詳細の整合)
 */

import { describe, it, expect, beforeAll } from "vitest";
import { DecisionRequest } from "../../domain/decision/DecisionRequest.js";
import { DecisionResponse } from "../../domain/decision/DecisionResponse.js";
import { KnownCardView, HiddenCardView, UnitView } from "../../domain/decision/PlayerObservation.js";
import { CostPayment } from "../../domain/decision/DecisionCatalog.js";
import { LegalPattern } from "../../domain/decision/LegalPattern.js";
import { GenericTacticalEvaluator } from "../../engine/rules/GenericTacticalEvaluator.js";
import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader.js";
import { createGen8ChampionCandidatePolicy } from "../../engine/ai/Gen8DNALoader.js";
import { DecisionDNACodec } from "../../engine/ai/DecisionDNACodec.js";
import { DecisionDNA } from "../../domain/ai/DecisionDNATypes.js";
import {
  Gen9LearnableTacticalPolicy,
  fromV6DNA,
  R4_PRESET_TACTICAL_WEIGHTS,
  TACTICAL_FEATURE_ENCODER_VERSION_V72,
  TACTICAL_FEATURE_ENCODER_VERSION_V73,
} from "../../engine/ai/Gen9LearnableTacticalPolicy.js";
import {
  COST_DIAGNOSTIC_WEIGHTS,
  diagnoseDecisionCostFeatures,
  aggregateCostDiagnosticResults,
} from "../../engine/ai/CostFeatureDiagnosticEngine.js";

describe("Work 5-5C: コスト支払い特徴量の識別能力診断 単体テスト (D1〜D14)", () => {
  let evaluator: GenericTacticalEvaluator;
  let gen8DNA: DecisionDNA;

  beforeAll(() => {
    const fullPkg = loadRulePackageForBrowser();
    evaluator = new GenericTacticalEvaluator(fullPkg);
    const gen8 = createGen8ChampionCandidatePolicy();
    gen8DNA = DecisionDNACodec.clone((gen8 as any).dna);
  });

  const setupDiagnosticPolicies = () => {
    const policyV72 = new Gen9LearnableTacticalPolicy(
      fromV6DNA(gen8DNA, "r4"),
      "V72",
      evaluator,
      TACTICAL_FEATURE_ENCODER_VERSION_V72
    );

    const makeGenomeWithWeights = (costWeights: readonly [number, number, number, number]) => {
      const weights = [...R4_PRESET_TACTICAL_WEIGHTS];
      weights[20] = costWeights[0];
      weights[21] = costWeights[1];
      weights[22] = costWeights[2];
      weights[23] = costWeights[3];
      return fromV6DNA(gen8DNA, weights);
    };

    const policyZero = new Gen9LearnableTacticalPolicy(
      makeGenomeWithWeights([0, 0, 0, 0]),
      "Zero",
      evaluator,
      TACTICAL_FEATURE_ENCODER_VERSION_V73
    );

    const policyDiag = new Gen9LearnableTacticalPolicy(
      makeGenomeWithWeights(COST_DIAGNOSTIC_WEIGHTS),
      "Diag",
      evaluator,
      TACTICAL_FEATURE_ENCODER_VERSION_V73
    );

    const t20 = new Gen9LearnableTacticalPolicy(
      makeGenomeWithWeights([COST_DIAGNOSTIC_WEIGHTS[0], 0, 0, 0]),
      "T20",
      evaluator,
      TACTICAL_FEATURE_ENCODER_VERSION_V73
    );

    const t21 = new Gen9LearnableTacticalPolicy(
      makeGenomeWithWeights([0, COST_DIAGNOSTIC_WEIGHTS[1], 0, 0]),
      "T21",
      evaluator,
      TACTICAL_FEATURE_ENCODER_VERSION_V73
    );

    const t22 = new Gen9LearnableTacticalPolicy(
      makeGenomeWithWeights([0, 0, COST_DIAGNOSTIC_WEIGHTS[2], 0]),
      "T22",
      evaluator,
      TACTICAL_FEATURE_ENCODER_VERSION_V73
    );

    const t23 = new Gen9LearnableTacticalPolicy(
      makeGenomeWithWeights([0, 0, 0, COST_DIAGNOSTIC_WEIGHTS[3]]),
      "T23",
      evaluator,
      TACTICAL_FEATURE_ENCODER_VERSION_V73
    );

    return { policyV72, policyZero, policyDiag, ablationPolicies: { t20, t21, t22, t23 } };
  };

  const createTestCard = (params: {
    cardInstanceId: string;
    suit: string;
    rank: string;
    value: number;
    isJoker?: boolean;
    visibility?: "KNOWN" | "HIDDEN";
  }): KnownCardView | HiddenCardView => {
    if (params.visibility === "HIDDEN") {
      return {
        visibility: "HIDDEN",
        opaqueCardId: params.cardInstanceId,
        faceUp: false,
      };
    }
    return {
      visibility: "KNOWN",
      cardInstanceId: params.cardInstanceId,
      suit: params.suit,
      rank: params.rank,
      value: params.value,
      faceUp: true,
      ...(params.isJoker ? { isJoker: true } : {}),
    } as any;
  };

  const createTestUnit = (params: {
    unitId: string;
    currentSize?: number;
    cards?: readonly any[];
  }): UnitView => ({
    unitId: params.unitId,
    kind: "soldier",
    state: "charge",
    face: "up",
    cards: params.cards ?? [],
    labels: [],
    currentSize: params.currentSize,
  });

  const createBaseRequest = (params: {
    selfHand?: readonly (KnownCardView | HiddenCardView)[];
    selfField?: readonly UnitView[];
    selfBulwarks?: readonly UnitView[];
    selfLife?: number;
    costPayments?: readonly CostPayment[];
    patterns: readonly LegalPattern[];
  }): DecisionRequest => {
    const selfLife = params.selfLife ?? 15;
    const selfHand = params.selfHand ?? [];
    const selfField = params.selfField ?? [];
    const selfBulwarks = params.selfBulwarks ?? [];
    const costPayments = params.costPayments ?? [];

    return {
      protocolVersion: "1.0.0",
      matchId: "match-test-work5-5c",
      decisionId: "dec-work5-5c-001",
      stateVersion: 1,
      playerId: "p1",
      source: {
        type: "ACTION_REQUEST",
        playerId: "p1",
      },
      observation: {
        viewerPlayerId: "p1",
        turnPlayerId: "p1",
        chancePlayerId: "p1",
        players: [
          {
            playerId: "p1",
            name: "Player 1",
            isViewer: true,
            lifeCount: selfLife,
            lifeDisplay: String(selfLife),
            handCount: selfHand.length,
            handCards: selfHand as any,
            field: selfField,
            bulwarks: selfBulwarks as any,
            fog: [],
            trumps: [],
            graveCount: 0,
            grave: [],
            canViewFullGrave: true,
          } as any,
          {
            playerId: "p2",
            name: "Player 2",
            isViewer: false,
            lifeCount: 15,
            lifeDisplay: "15",
            handCount: 0,
            handCards: [],
            field: [],
            bulwarks: [],
            fog: [],
            trumps: [],
            graveCount: 0,
            grave: [],
            canViewFullGrave: false,
          } as any,
        ],
      } as any,
      catalog: {
        actions: [
          {
            actionId: "action.test",
            name: "Test Action",
            actionType: "NORMAL",
            costSummary: "",
          } as any,
        ],
        costPayments,
        cardSelections: [],
        unitSelections: [],
        targetSelections: [],
        effectSelections: [],
        orderSelections: [],
      },
      patterns: params.patterns,
    };
  };

  // ---------------------------------------------------------------------------
  // D1: ゼロ重み完全互換 (v7.2 vs v7.3 ゼロ重みのスコア・選択完全一致)
  // ---------------------------------------------------------------------------
  it("D1: ゼロ重み完全互換 - v7.2 と v7.3 ゼロ重みで全手のスコアと選択が完全一致する", () => {
    const { policyV72, policyZero, policyDiag, ablationPolicies } = setupDiagnosticPolicies();

    const cardA = createTestCard({ cardInstanceId: "c-3", suit: "C", rank: "3", value: 3 });
    const cardB = createTestCard({ cardInstanceId: "c-8", suit: "C", rank: "8", value: 8 });

    const costPayments: CostPayment[] = [
      { discardedCardIds: ["c-3"], drivenBulwarkUnitIds: [], sacrificedUnitIds: [], lifeCount: 0 },
      { discardedCardIds: ["c-8"], drivenBulwarkUnitIds: [], sacrificedUnitIds: [], lifeCount: 0 },
    ];

    const legalPatterns: LegalPattern[] = [
      { patternId: "pat-0", kind: "ACTION", actionSelectionRef: 0, costPaymentRef: 0 },
      { patternId: "pat-1", kind: "ACTION", actionSelectionRef: 0, costPaymentRef: 1 },
    ];

    const request = createBaseRequest({
      selfHand: [cardA, cardB],
      costPayments,
      patterns: legalPatterns,
    });

    const evalV72 = policyV72.evaluatePatterns(request);
    const evalZero = policyZero.evaluatePatterns(request);

    expect(evalV72.scoredPatterns.length).toBe(evalZero.scoredPatterns.length);
    for (let i = 0; i < evalV72.scoredPatterns.length; i++) {
      expect(Math.abs(evalV72.scoredPatterns[i].finalScore - evalZero.scoredPatterns[i].finalScore)).toBeLessThanOrEqual(1e-12);
    }
    expect(evalV72.bestPatternRef).toBe(evalZero.bestPatternRef);

    const result = diagnoseDecisionCostFeatures(
      request,
      evaluator,
      policyZero,
      policyDiag,
      ablationPolicies
    );
    expect(result.groups.length).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // D2: カード数値差分識別 (C3 vs C8 で t20 が異なり、非ゼロ重みでスコア差が発生)
  // ---------------------------------------------------------------------------
  it("D2: カード数値差分識別 - C3 廃棄と C8 廃棄で t20 が異なり、非ゼロ重みで C3 が優位になる", () => {
    const { policyZero, policyDiag, ablationPolicies } = setupDiagnosticPolicies();

    const cardA = createTestCard({ cardInstanceId: "c-3", suit: "C", rank: "3", value: 3 });
    const cardB = createTestCard({ cardInstanceId: "c-8", suit: "C", rank: "8", value: 8 });

    const costPayments: CostPayment[] = [
      { discardedCardIds: ["c-3"], drivenBulwarkUnitIds: [], sacrificedUnitIds: [], lifeCount: 0 },
      { discardedCardIds: ["c-8"], drivenBulwarkUnitIds: [], sacrificedUnitIds: [], lifeCount: 0 },
    ];

    const legalPatterns: LegalPattern[] = [
      { patternId: "pat-c3", kind: "ACTION", actionSelectionRef: 0, costPaymentRef: 0 },
      { patternId: "pat-c8", kind: "ACTION", actionSelectionRef: 0, costPaymentRef: 1 },
    ];

    const request = createBaseRequest({
      selfHand: [cardA, cardB],
      costPayments,
      patterns: legalPatterns,
    });

    const result = diagnoseDecisionCostFeatures(request, evaluator, policyZero, policyDiag, ablationPolicies);

    expect(result.groups.length).toBe(1);
    const g = result.groups[0];

    // Stage A: 衝突していない (t20 が 3/13 vs 8/13)
    expect(g.isCompleteFeatureColliding).toBe(false);
    expect(g.featureCollidingPairCount).toBe(0);

    // Stage B: 非ゼロ重みでスコア同点ではない
    expect(g.isAllScoreTied).toBe(false);
    expect(g.isTopScoreTied).toBe(false);
    expect(g.scoreMargin).toBeGreaterThan(0);

    // C3 (値3) の方がコストペナルティが小さいため、診断スコアは C3 > C8
    expect(g.bestPatternRef).toBe(0); // pat-c3
    expect(g.candidates[0].diagScore).toBeGreaterThan(g.candidates[1].diagScore);
  });

  // ---------------------------------------------------------------------------
  // D3: Joker 廃棄差分識別 (Joker vs 通常カードで t21 が異なり、Joker保持が有利)
  // ---------------------------------------------------------------------------
  it("D3: Joker 廃棄差分識別 - Joker 廃棄と通常カード廃棄で t21 が異なり、Joker 保持が有利", () => {
    const { policyZero, policyDiag, ablationPolicies } = setupDiagnosticPolicies();

    const cardNorm = createTestCard({ cardInstanceId: "c-10", suit: "H", rank: "10", value: 10 });
    const cardJoker = createTestCard({ cardInstanceId: "c-jk", suit: "J", rank: "JK", value: 0, isJoker: true });

    const costPayments: CostPayment[] = [
      { discardedCardIds: ["c-10"], drivenBulwarkUnitIds: [], sacrificedUnitIds: [], lifeCount: 0 },
      { discardedCardIds: ["c-jk"], drivenBulwarkUnitIds: [], sacrificedUnitIds: [], lifeCount: 0 },
    ];

    const legalPatterns: LegalPattern[] = [
      { patternId: "pat-norm", kind: "ACTION", actionSelectionRef: 0, costPaymentRef: 0 },
      { patternId: "pat-joker", kind: "ACTION", actionSelectionRef: 0, costPaymentRef: 1 },
    ];

    const request = createBaseRequest({
      selfHand: [cardNorm, cardJoker],
      costPayments,
      patterns: legalPatterns,
    });

    const result = diagnoseDecisionCostFeatures(request, evaluator, policyZero, policyDiag, ablationPolicies);
    const g = result.groups[0];

    expect(g.isCompleteFeatureColliding).toBe(false);
    expect(g.isAllScoreTied).toBe(false);

    // Joker 廃棄の重みは -1.0。通常廃棄 (t20=10/20*(-0.5)) vs Joker廃棄 (t21=1.0*(-1.0))
    // 通常カード廃棄 (pat-norm, ref 0) の方がペナルティが小さく高スコア
    expect(g.bestPatternRef).toBe(0);
    expect(g.candidates[0].diagScore).toBeGreaterThan(g.candidates[1].diagScore);
  });

  // ---------------------------------------------------------------------------
  // D4: 犠牲ユニット差分識別 (小型兵士犠牲 vs 大型兵士犠牲)
  // ---------------------------------------------------------------------------
  it("D4: 犠牲ユニット差分識別 - 小型兵士犠牲と大型兵士犠牲で t22 が異なり、低コスト犠牲が有利", () => {
    const { policyZero, policyDiag, ablationPolicies } = setupDiagnosticPolicies();

    const uSmall = createTestUnit({ unitId: "u-small", currentSize: 2 });
    const uLarge = createTestUnit({ unitId: "u-large", currentSize: 5 });

    const costPayments: CostPayment[] = [
      { discardedCardIds: [], drivenBulwarkUnitIds: [], sacrificedUnitIds: ["u-small"], lifeCount: 0 },
      { discardedCardIds: [], drivenBulwarkUnitIds: [], sacrificedUnitIds: ["u-large"], lifeCount: 0 },
    ];

    const legalPatterns: LegalPattern[] = [
      { patternId: "pat-s", kind: "ACTION", actionSelectionRef: 0, costPaymentRef: 0 },
      { patternId: "pat-l", kind: "ACTION", actionSelectionRef: 0, costPaymentRef: 1 },
    ];

    const request = createBaseRequest({
      selfField: [uSmall, uLarge],
      costPayments,
      patterns: legalPatterns,
    });

    const result = diagnoseDecisionCostFeatures(request, evaluator, policyZero, policyDiag, ablationPolicies);
    const g = result.groups[0];

    expect(g.isCompleteFeatureColliding).toBe(false);
    expect(g.isAllScoreTied).toBe(false);

    // 小型兵士犠牲 (pat-s, ref 0) の方がペナルティが小さく高スコア
    expect(g.bestPatternRef).toBe(0);
    expect(g.candidates[0].diagScore).toBeGreaterThan(g.candidates[1].diagScore);
  });

  // ---------------------------------------------------------------------------
  // D5: ライフ支払い割合差分識別 (1枚支払い vs 2枚支払い)
  // ---------------------------------------------------------------------------
  it("D5: ライフ支払い割合差分識別 - ライフ支払い枚数が異なると t23 が異なり、低支払いが有利", () => {
    const { policyZero, policyDiag, ablationPolicies } = setupDiagnosticPolicies();

    const costPayments: CostPayment[] = [
      { discardedCardIds: [], drivenBulwarkUnitIds: [], sacrificedUnitIds: [], lifeCount: 1 },
      { discardedCardIds: [], drivenBulwarkUnitIds: [], sacrificedUnitIds: [], lifeCount: 2 },
    ];

    const legalPatterns: LegalPattern[] = [
      { patternId: "pat-l1", kind: "ACTION", actionSelectionRef: 0, costPaymentRef: 0 },
      { patternId: "pat-l2", kind: "ACTION", actionSelectionRef: 0, costPaymentRef: 1 },
    ];

    const request = createBaseRequest({
      selfLife: 5,
      costPayments,
      patterns: legalPatterns,
    });

    const result = diagnoseDecisionCostFeatures(request, evaluator, policyZero, policyDiag, ablationPolicies);
    const g = result.groups[0];

    expect(g.isCompleteFeatureColliding).toBe(false);
    expect(g.isAllScoreTied).toBe(false);

    // 1枚支払い (pat-l1, ref 0) の方がペナルティが小さく高スコア
    expect(g.bestPatternRef).toBe(0);
    expect(g.candidates[0].diagScore).toBeGreaterThan(g.candidates[1].diagScore);
  });

  // ---------------------------------------------------------------------------
  // D6: 同ランク異スート衝突判定 (SAME_RANK_DIFF_SUIT)
  // ---------------------------------------------------------------------------
  it("D6: 同ランク異スート衝突判定 - D5 と H5 は t20〜t23 で衝突し原因が SAME_RANK_DIFF_SUIT と判定される", () => {
    const { policyZero, policyDiag, ablationPolicies } = setupDiagnosticPolicies();

    const cardD5 = createTestCard({ cardInstanceId: "c-d5", suit: "D", rank: "5", value: 5 });
    const cardH5 = createTestCard({ cardInstanceId: "c-h5", suit: "H", rank: "5", value: 5 });

    const costPayments: CostPayment[] = [
      { discardedCardIds: ["c-d5"], drivenBulwarkUnitIds: [], sacrificedUnitIds: [], lifeCount: 0 },
      { discardedCardIds: ["c-h5"], drivenBulwarkUnitIds: [], sacrificedUnitIds: [], lifeCount: 0 },
    ];

    const legalPatterns: LegalPattern[] = [
      { patternId: "pat-d5", kind: "ACTION", actionSelectionRef: 0, costPaymentRef: 0 },
      { patternId: "pat-h5", kind: "ACTION", actionSelectionRef: 0, costPaymentRef: 1 },
    ];

    const request = createBaseRequest({
      selfHand: [cardD5, cardH5],
      costPayments,
      patterns: legalPatterns,
    });

    const result = diagnoseDecisionCostFeatures(request, evaluator, policyZero, policyDiag, ablationPolicies);
    const g = result.groups[0];

    // Stage A: 完全衝突
    expect(g.isCompleteFeatureColliding).toBe(true);
    expect(g.collisionReasons).toContain("SAME_RANK_DIFF_SUIT");

    // Stage B: 同点
    expect(g.isAllScoreTied).toBe(true);
    expect(g.scoreMargin).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // D7: 防壁ドライブ差分判定 (BULWARK_DRIVE_DIFF_ONLY)
  // ---------------------------------------------------------------------------
  it("D7: 防壁ドライブ差分判定 - 防壁ドライブ対象のみ異なる場合、BULWARK_DRIVE_DIFF_ONLY として衝突判定される", () => {
    const { policyZero, policyDiag, ablationPolicies } = setupDiagnosticPolicies();

    const bulwarkA = createTestUnit({ unitId: "bw-1" });
    const bulwarkB = createTestUnit({ unitId: "bw-2" });

    const costPayments: CostPayment[] = [
      { discardedCardIds: [], drivenBulwarkUnitIds: ["bw-1"], sacrificedUnitIds: [], lifeCount: 0 },
      { discardedCardIds: [], drivenBulwarkUnitIds: ["bw-2"], sacrificedUnitIds: [], lifeCount: 0 },
    ];

    const legalPatterns: LegalPattern[] = [
      { patternId: "pat-bw1", kind: "ACTION", actionSelectionRef: 0, costPaymentRef: 0 },
      { patternId: "pat-bw2", kind: "ACTION", actionSelectionRef: 0, costPaymentRef: 1 },
    ];

    const request = createBaseRequest({
      selfBulwarks: [bulwarkA, bulwarkB],
      costPayments,
      patterns: legalPatterns,
    });

    const result = diagnoseDecisionCostFeatures(request, evaluator, policyZero, policyDiag, ablationPolicies);
    const g = result.groups[0];

    expect(g.isCompleteFeatureColliding).toBe(true);
    expect(g.collisionReasons).toContain("BULWARK_DRIVE_DIFF_ONLY");
    expect(g.isAllScoreTied).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // D8: 複合コスト数理的一致 (Δscore == Σ t_m * w_m)
  // ---------------------------------------------------------------------------
  it("D8: 複合コスト数理的一致 - Δscore == Σ t_m * w_m が許容誤差 1e-12 以内で一致する", () => {
    const { policyZero, policyDiag, ablationPolicies } = setupDiagnosticPolicies();

    const cardA = createTestCard({ cardInstanceId: "c-3", suit: "C", rank: "3", value: 3 });
    const cardB = createTestCard({ cardInstanceId: "c-8", suit: "C", rank: "8", value: 8 });
    const uSmall = createTestUnit({ unitId: "u-s", currentSize: 2 });
    const uLarge = createTestUnit({ unitId: "u-l", currentSize: 4 });

    const costPayments: CostPayment[] = [
      { discardedCardIds: ["c-3"], drivenBulwarkUnitIds: [], sacrificedUnitIds: ["u-s"], lifeCount: 1 },
      { discardedCardIds: ["c-8"], drivenBulwarkUnitIds: [], sacrificedUnitIds: ["u-l"], lifeCount: 2 },
    ];

    const legalPatterns: LegalPattern[] = [
      { patternId: "pat-m1", kind: "ACTION", actionSelectionRef: 0, costPaymentRef: 0 },
      { patternId: "pat-m2", kind: "ACTION", actionSelectionRef: 0, costPaymentRef: 1 },
    ];

    const request = createBaseRequest({
      selfHand: [cardA, cardB],
      selfField: [uSmall, uLarge],
      selfLife: 5,
      costPayments,
      patterns: legalPatterns,
    });

    const result = diagnoseDecisionCostFeatures(request, evaluator, policyZero, policyDiag, ablationPolicies);
    const g = result.groups[0];

    // 各候補で数理的一致性 (isMathConsistent) が成立していること
    for (const cand of g.candidates) {
      expect(cand.isMathConsistent).toBe(true);
      expect(Math.abs(cand.costTacticalDelta - cand.expectedDelta)).toBeLessThanOrEqual(1e-12);
    }
  });

  // ---------------------------------------------------------------------------
  // D9: グループ集計整合性 (完全衝突率、最高スコア同点率、ペア同点率などの関係式)
  // ---------------------------------------------------------------------------
  it("D9: グループ集計整合性 - aggregateCostDiagnosticResults の集計値が論理的関係を満たす", () => {
    const { policyZero, policyDiag, ablationPolicies } = setupDiagnosticPolicies();

    const card3 = createTestCard({ cardInstanceId: "c-3", suit: "C", rank: "3", value: 3 });
    const card8 = createTestCard({ cardInstanceId: "c-8", suit: "C", rank: "8", value: 8 });
    const cardD5 = createTestCard({ cardInstanceId: "c-d5", suit: "D", rank: "5", value: 5 });
    const cardH5 = createTestCard({ cardInstanceId: "c-h5", suit: "H", rank: "5", value: 5 });

    const req1 = createBaseRequest({
      selfHand: [card3, card8],
      costPayments: [
        { discardedCardIds: ["c-3"], drivenBulwarkUnitIds: [], sacrificedUnitIds: [], lifeCount: 0 },
        { discardedCardIds: ["c-8"], drivenBulwarkUnitIds: [], sacrificedUnitIds: [], lifeCount: 0 },
      ],
      patterns: [
        { patternId: "p1-0", kind: "ACTION", actionSelectionRef: 0, costPaymentRef: 0 },
        { patternId: "p1-1", kind: "ACTION", actionSelectionRef: 0, costPaymentRef: 1 },
      ],
    });

    const req2 = createBaseRequest({
      selfHand: [cardD5, cardH5],
      costPayments: [
        { discardedCardIds: ["c-d5"], drivenBulwarkUnitIds: [], sacrificedUnitIds: [], lifeCount: 0 },
        { discardedCardIds: ["c-h5"], drivenBulwarkUnitIds: [], sacrificedUnitIds: [], lifeCount: 0 },
      ],
      patterns: [
        { patternId: "p2-0", kind: "ACTION", actionSelectionRef: 0, costPaymentRef: 0 },
        { patternId: "p2-1", kind: "ACTION", actionSelectionRef: 0, costPaymentRef: 1 },
      ],
    });

    const res1 = diagnoseDecisionCostFeatures(req1, evaluator, policyZero, policyDiag, ablationPolicies);
    const res2 = diagnoseDecisionCostFeatures(req2, evaluator, policyZero, policyDiag, ablationPolicies);

    const agg = aggregateCostDiagnosticResults([res1, res2], 1, 2);

    expect(agg.totalCostGroups).toBe(2);
    expect(agg.stageA.completeCollisionGroupCount).toBe(1);
    expect(agg.stageA.completeCollisionGroupRate).toBe(0.5);
    expect(agg.stageA.distinguishableGroupCount).toBe(1);
    expect(agg.stageA.distinguishableGroupRate).toBe(0.5);

    expect(agg.stageB.allGroups.allTiedRate).toBe(0.5);
    expect(agg.stageB.distinguishableGroups.allTiedRate).toBe(0.0);
    expect(agg.stageB.structuralIndistinguishableGroups.allTiedRate).toBe(1.0);
  });

  // ---------------------------------------------------------------------------
  // D10: シャドウ評価非干渉性 (実対戦レスポンスが診断によって変化しない)
  // ---------------------------------------------------------------------------
  it("D10: シャドウ評価非干渉性 - 診断実行によって実対戦 request / response のプロパティが一切変更されない", () => {
    const { policyZero, policyDiag, ablationPolicies } = setupDiagnosticPolicies();

    const card3 = createTestCard({ cardInstanceId: "c-3", suit: "C", rank: "3", value: 3 });
    const card8 = createTestCard({ cardInstanceId: "c-8", suit: "C", rank: "8", value: 8 });

    const originalReq = createBaseRequest({
      selfHand: [card3, card8],
      costPayments: [
        { discardedCardIds: ["c-3"], drivenBulwarkUnitIds: [], sacrificedUnitIds: [], lifeCount: 0 },
        { discardedCardIds: ["c-8"], drivenBulwarkUnitIds: [], sacrificedUnitIds: [], lifeCount: 0 },
      ],
      patterns: [
        { patternId: "p-0", kind: "ACTION", actionSelectionRef: 0, costPaymentRef: 0 },
        { patternId: "p-1", kind: "ACTION", actionSelectionRef: 0, costPaymentRef: 1 },
      ],
    });

    const reqClone = JSON.parse(JSON.stringify(originalReq));
    const originalRes: DecisionResponse = { decisionId: "d-1", stateVersion: 1, selectedPatternRef: 0 };
    const resClone = JSON.parse(JSON.stringify(originalRes));

    diagnoseDecisionCostFeatures(originalReq, evaluator, policyZero, policyDiag, ablationPolicies);

    expect(originalReq).toEqual(reqClone);
    expect(originalRes).toEqual(resClone);
  });

  // ---------------------------------------------------------------------------
  // D11: 不正ID診断 (未解決IDが検知され INVALID_REFERENCE として処理)
  // ---------------------------------------------------------------------------
  it("D11: 不正ID診断 - 存在しない cardId や unitId が指定された場合、invalidReferences として記録される", () => {
    const { policyZero, policyDiag, ablationPolicies } = setupDiagnosticPolicies();

    const costPayments: CostPayment[] = [
      {
        discardedCardIds: ["c-non-existent"],
        drivenBulwarkUnitIds: [],
        sacrificedUnitIds: ["u-non-existent"],
        lifeCount: 0,
      },
      {
        discardedCardIds: [],
        drivenBulwarkUnitIds: [],
        sacrificedUnitIds: [],
        lifeCount: 0,
      },
    ];

    const legalPatterns: LegalPattern[] = [
      { patternId: "pat-inv", kind: "ACTION", actionSelectionRef: 0, costPaymentRef: 0 },
      { patternId: "pat-zero", kind: "ACTION", actionSelectionRef: 0, costPaymentRef: 1 },
    ];

    const request = createBaseRequest({
      selfHand: [],
      costPayments,
      patterns: legalPatterns,
    });

    const result = diagnoseDecisionCostFeatures(request, evaluator, policyZero, policyDiag, ablationPolicies);

    expect(result.invalidReferences.cardIds).toContain("c-non-existent");
    expect(result.invalidReferences.unitIds).toContain("u-non-existent");
  });

  // ---------------------------------------------------------------------------
  // D12: Argmax変化検出 (非ゼロ重みによる最善手変更の分類)
  // ---------------------------------------------------------------------------
  it("D12: Argmax変化検出 - 非ゼロ重み適用により選択手が変化したことを正しく分類・検知する", () => {
    const { policyZero, policyDiag, ablationPolicies } = setupDiagnosticPolicies();

    const cardA = createTestCard({ cardInstanceId: "c-3", suit: "C", rank: "3", value: 3 });
    const cardB = createTestCard({ cardInstanceId: "c-8", suit: "C", rank: "8", value: 8 });

    // pattern 0: C8 (高ペナルティ), pattern 1: C3 (低ペナルティ)
    const costPayments: CostPayment[] = [
      { discardedCardIds: ["c-8"], drivenBulwarkUnitIds: [], sacrificedUnitIds: [], lifeCount: 0 },
      { discardedCardIds: ["c-3"], drivenBulwarkUnitIds: [], sacrificedUnitIds: [], lifeCount: 0 },
    ];

    const legalPatterns: LegalPattern[] = [
      { patternId: "pat-8", kind: "ACTION", actionSelectionRef: 0, costPaymentRef: 0 },
      { patternId: "pat-3", kind: "ACTION", actionSelectionRef: 0, costPaymentRef: 1 },
    ];

    const request = createBaseRequest({
      selfHand: [cardA, cardB],
      costPayments,
      patterns: legalPatterns,
    });

    const result = diagnoseDecisionCostFeatures(request, evaluator, policyZero, policyDiag, ablationPolicies);

    // ゼロ重みでは同点のため先頭の pat-8 (ref 0) が選ばれるが、診断重みでは pat-3 (ref 1) が選ばれる
    expect(result.argmaxEffect.isArgmaxChanged).toBe(true);
    expect(result.argmaxEffect.category).toBe("COST_ONLY_CHANGED");
    expect(result.argmaxEffect.zeroBestPatternRef).toBe(0);
    expect(result.argmaxEffect.diagBestPatternRef).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // D13: 再現性 (同一局面・重みで非時刻依存に完全再現)
  // ---------------------------------------------------------------------------
  it("D13: 再現性 - 同一局面・同一Policy構成で2回実行した場合、診断結果がディープイコールで一致する", () => {
    const { policyZero, policyDiag, ablationPolicies } = setupDiagnosticPolicies();

    const cardA = createTestCard({ cardInstanceId: "c-3", suit: "C", rank: "3", value: 3 });
    const cardB = createTestCard({ cardInstanceId: "c-8", suit: "C", rank: "8", value: 8 });

    const request = createBaseRequest({
      selfHand: [cardA, cardB],
      costPayments: [
        { discardedCardIds: ["c-3"], drivenBulwarkUnitIds: [], sacrificedUnitIds: [], lifeCount: 0 },
        { discardedCardIds: ["c-8"], drivenBulwarkUnitIds: [], sacrificedUnitIds: [], lifeCount: 0 },
      ],
      patterns: [
        { patternId: "p-0", kind: "ACTION", actionSelectionRef: 0, costPaymentRef: 0 },
        { patternId: "p-1", kind: "ACTION", actionSelectionRef: 0, costPaymentRef: 1 },
      ],
    });

    const run1 = diagnoseDecisionCostFeatures(request, evaluator, policyZero, policyDiag, ablationPolicies);
    const run2 = diagnoseDecisionCostFeatures(request, evaluator, policyZero, policyDiag, ablationPolicies);

    expect(JSON.stringify(run1)).toBe(JSON.stringify(run2));
  });

  // ---------------------------------------------------------------------------
  // D14: Evidence 整合性 (集計数値と詳細の整合)
  // ---------------------------------------------------------------------------
  it("D14: Evidence 整合性 - 集計結果の各数値が詳細決定リストから正確に集計されている", () => {
    const { policyZero, policyDiag, ablationPolicies } = setupDiagnosticPolicies();

    const card3 = createTestCard({ cardInstanceId: "c-3", suit: "C", rank: "3", value: 3 });
    const card8 = createTestCard({ cardInstanceId: "c-8", suit: "C", rank: "8", value: 8 });

    const request = createBaseRequest({
      selfHand: [card3, card8],
      costPayments: [
        { discardedCardIds: ["c-3"], drivenBulwarkUnitIds: [], sacrificedUnitIds: [], lifeCount: 0 },
        { discardedCardIds: ["c-8"], drivenBulwarkUnitIds: [], sacrificedUnitIds: [], lifeCount: 0 },
      ],
      patterns: [
        { patternId: "p-0", kind: "ACTION", actionSelectionRef: 0, costPaymentRef: 0 },
        { patternId: "p-1", kind: "ACTION", actionSelectionRef: 0, costPaymentRef: 1 },
      ],
    });

    const result = diagnoseDecisionCostFeatures(request, evaluator, policyZero, policyDiag, ablationPolicies);
    const agg = aggregateCostDiagnosticResults([result], 1, 1);

    expect(agg.totalCostGroups).toBe(result.groups.length);
    expect(agg.stageC.totalDecisions).toBe(1);
    expect(agg.invalidReferences.invalidCardIdCount).toBe(result.invalidReferences.cardIds.length);
  });
});
