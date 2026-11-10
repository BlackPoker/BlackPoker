/**
 * cardCostTacticalFeatures.test.ts
 *
 * BlackPoker Simulator - Work 5-5B コスト支払い戦術特徴量 (t20〜t23) 実装 & ゼロ重み互換性検証テスト
 *
 * 【検証項目】
 * 1. 特徴量計算テスト (C1〜C12): 捨て札ランク合計、Joker枚数、生贄サイズ合計、ライフ割合の正規化・飽和計算
 * 2. ID解決3状態テスト: KNOWN / HIDDEN / INVALID_REFERENCE (Jokerと未解決IDの混同防止、フェイルクローズ)
 * 3. DNA移行・復元・バリデーションテスト (DNA-T1〜T5):
 *    - DNA-T1: 旧20次元DNAの完全復元 (元重み維持、末尾4つゼロ、メタデータ保持)
 *    - DNA-T2: 新24次元DNAの無損失往復変換
 *    - DNA-T3: 不正な次元数 (19, 21, 23, 25) の拒否
 *    - DNA-T4: 非有限値 (NaN, Infinity) の拒否
 *    - DNA-T5: 戦術重みを持たないベースラインDNAからのフォールバック変換
 * 4. ゼロ重みパリティテスト: 旧Policy (v7.2, 20次元) vs 新Policy (v7.3, 24次元, 末尾4ゼロ) の全手完全一致 (delta < 1e-15)
 * 5. カテゴリー別寄与度と最終スコアの整合性テスト: RESOURCE_COST 独立分離および合計整合性
 * 6. 旧Encoder Version指定時の新特徴量ゼロ化テスト: v7.0 / v7.1 / v7.2 指定時に t20〜t23 が厳格に 0.0
 */

import { describe, it, expect, beforeAll } from "vitest";
import { DecisionRequest } from "../../domain/decision/DecisionRequest.js";
import { DecisionDNA } from "../../domain/ai/DecisionDNATypes.js";
import { DecisionDNACodec } from "../../engine/ai/DecisionDNACodec.js";
import {
  Gen9LearnableTacticalPolicy,
  TACTICAL_FEATURE_DIMENSION,
  TACTICAL_FEATURE_DIMENSION_V70,
  TACTICAL_FEATURE_DIMENSION_V73,
  TACTICAL_FEATURE_NAMES,
  TACTICAL_FEATURE_CATEGORY_MAP,
  ZERO_TACTICAL_WEIGHTS,
  R4_PRESET_TACTICAL_WEIGHTS,
  TACTICAL_FEATURE_ENCODER_VERSION_V72,
  TACTICAL_FEATURE_ENCODER_VERSION_V73,
  fromV6DNA,
  toV6CompatibleDNA,
  fromV6CompatibleDNA,
  encodeTacticalPatternFeatures,
  computeCategoryBreakdown,
  createCostTacticalContext,
  supportsCostEvaluation,
  supportsConditionalPass,
  Gen9TacticalGenome,
} from "../../engine/ai/Gen9LearnableTacticalPolicy.js";
import { GenericTacticalEvaluator } from "../../engine/rules/GenericTacticalEvaluator.js";
import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader.js";
import { createGen8ChampionCandidatePolicy } from "../../engine/ai/Gen8DNALoader.js";
import { KnownCardView, HiddenCardView, UnitView } from "../../domain/decision/PlayerObservation.js";
import { CostPayment } from "../../domain/decision/DecisionCatalog.js";
import { LegalPattern } from "../../domain/decision/LegalPattern.js";

describe("Work 5-5B: コスト支払い戦術特徴量 (t20〜t23) 実装 & ゼロ重み互換性検証", () => {
  let evaluator: GenericTacticalEvaluator;
  const gen8 = createGen8ChampionCandidatePolicy();
  const gen8DNA = DecisionDNACodec.clone((gen8 as any).dna);

  beforeAll(() => {
    const fullPkg = loadRulePackageForBrowser();
    evaluator = new GenericTacticalEvaluator(fullPkg);
  });

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

  const createMockRequest = (params?: {
    selfLife?: number;
    selfHand?: readonly any[];
    selfField?: readonly UnitView[];
    costPayments?: readonly CostPayment[];
    patterns?: readonly LegalPattern[];
  }): DecisionRequest => {
    const selfLife = params?.selfLife ?? 15;
    const selfHand = params?.selfHand ?? [];
    const selfField = params?.selfField ?? [];
    const costPayments = params?.costPayments ?? [];
    const patterns = params?.patterns ?? [
      {
        patternId: "pat-pass",
        kind: "PASS",
      },
      {
        patternId: "pat-action-0",
        kind: "ACTION",
        actionSelectionRef: 0,
        costPaymentRef: 0,
      },
    ];

    return {
      protocolVersion: "1.0.0",
      matchId: "match-test-work5-5b",
      decisionId: "dec-work5-5b-001",
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
            handCards: selfHand,
            field: selfField,
            fog: [],
            trumps: [],
            graveCount: 0,
            grave: [],
            canViewFullGrave: true,
          },
          {
            playerId: "p2",
            name: "Player 2",
            isViewer: false,
            lifeCount: 15,
            lifeDisplay: "15",
            handCount: 4,
            handCards: [],
            field: [],
            fog: [],
            trumps: [],
            graveCount: 0,
            grave: [],
            canViewFullGrave: false,
          },
        ],
        stageRequestRefs: [],
        stageRequests: [],
        recentEvents: [],
      },
      catalog: {
        actions: [
          {
            actionId: "action.summonSoldier",
            actionName: "Summon",
            speed: "normal",
            timing: "normal",
          } as any,
        ],
        cardSelections: [],
        unitSelections: [],
        costPayments: costPayments as any,
        targetSelections: [],
        effectSelections: [],
        orderSelections: [],
      },
      patterns: patterns as any,
    };
  };

  // ===========================================================================
  // 1. 特徴量計算テスト (C1〜C12)
  // ===========================================================================
  describe("1. 特徴量計算テスト (C1〜C12)", () => {
    it("C1: 捨て札なしの場合、t20 = 0.0, t21 = 0.0", () => {
      const cp: CostPayment = {
        discardedCardIds: [],
        drivenBulwarkUnitIds: [],
        sacrificedUnitIds: [],
        lifeCount: 0,
      };
      const req = createMockRequest({ costPayments: [cp] });
      const { features } = encodeTacticalPatternFeatures(
        req,
        req.patterns[1],
        evaluator,
        TACTICAL_FEATURE_ENCODER_VERSION_V73
      );
      expect(features[20]).toBe(0.0);
      expect(features[21]).toBe(0.0);
    });

    it("C2: 単一通常カード廃棄 (S2, rank 2) の場合、t20 = 2 / (2 + 10) = 2/12", () => {
      const cardS2 = createTestCard({
        cardInstanceId: "card-s2",
        suit: "S",
        rank: "2",
        value: 2,
      });
      const cp: CostPayment = {
        discardedCardIds: ["card-s2"],
        drivenBulwarkUnitIds: [],
        sacrificedUnitIds: [],
        lifeCount: 0,
      };
      const req = createMockRequest({
        selfHand: [cardS2],
        costPayments: [cp],
      });
      const { features } = encodeTacticalPatternFeatures(
        req,
        req.patterns[1],
        evaluator,
        TACTICAL_FEATURE_ENCODER_VERSION_V73
      );
      expect(features[20]).toBeCloseTo(2 / 12, 10);
      expect(features[21]).toBe(0.0);
    });

    it("C3: 単一絵札廃棄 (HK, rank K, value 13) の場合、t20 = 13 / (13 + 10) = 13/23", () => {
      const cardHK = createTestCard({
        cardInstanceId: "card-hk",
        suit: "H",
        rank: "K",
        value: 13,
      });
      const cp: CostPayment = {
        discardedCardIds: ["card-hk"],
        drivenBulwarkUnitIds: [],
        sacrificedUnitIds: [],
        lifeCount: 0,
      };
      const req = createMockRequest({
        selfHand: [cardHK],
        costPayments: [cp],
      });
      const { features } = encodeTacticalPatternFeatures(
        req,
        req.patterns[1],
        evaluator,
        TACTICAL_FEATURE_ENCODER_VERSION_V73
      );
      expect(features[20]).toBeCloseTo(13 / 23, 10);
      expect(features[21]).toBe(0.0);
    });

    it("C4: 複数カード廃棄 (D5 + CQ: sum 17) の場合、t20 = 17 / (17 + 10) = 17/27", () => {
      const cardD5 = createTestCard({
        cardInstanceId: "card-d5",
        suit: "D",
        rank: "5",
        value: 5,
      });
      const cardCQ = createTestCard({
        cardInstanceId: "card-cq",
        suit: "C",
        rank: "Q",
        value: 12,
      });
      const cp: CostPayment = {
        discardedCardIds: ["card-d5", "card-cq"],
        drivenBulwarkUnitIds: [],
        sacrificedUnitIds: [],
        lifeCount: 0,
      };
      const req = createMockRequest({
        selfHand: [cardD5, cardCQ],
        costPayments: [cp],
      });
      const { features } = encodeTacticalPatternFeatures(
        req,
        req.patterns[1],
        evaluator,
        TACTICAL_FEATURE_ENCODER_VERSION_V73
      );
      expect(features[20]).toBeCloseTo(17 / 27, 10);
      expect(features[21]).toBe(0.0);
    });

    it("C5: Joker 単体廃棄の場合、t20 = 0.0, t21 = 1 / (1 + 1) = 0.5", () => {
      const cardJoker = createTestCard({
        cardInstanceId: "card-joker1",
        suit: "J",
        rank: "JOKER",
        value: 0,
        isJoker: true,
      });
      const cp: CostPayment = {
        discardedCardIds: ["card-joker1"],
        drivenBulwarkUnitIds: [],
        sacrificedUnitIds: [],
        lifeCount: 0,
      };
      const req = createMockRequest({
        selfHand: [cardJoker],
        costPayments: [cp],
      });
      const { features } = encodeTacticalPatternFeatures(
        req,
        req.patterns[1],
        evaluator,
        TACTICAL_FEATURE_ENCODER_VERSION_V73
      );
      expect(features[20]).toBe(0.0);
      expect(features[21]).toBeCloseTo(0.5, 10);
    });

    it("C6: 通常カード (S7, value 7) + Joker の複合廃棄の場合、t20 = 7/17, t21 = 0.5", () => {
      const cardS7 = createTestCard({
        cardInstanceId: "card-s7",
        suit: "S",
        rank: "7",
        value: 7,
      });
      const cardJoker = createTestCard({
        cardInstanceId: "card-joker1",
        suit: "J",
        rank: "JOKER",
        value: 0,
        isJoker: true,
      });
      const cp: CostPayment = {
        discardedCardIds: ["card-s7", "card-joker1"],
        drivenBulwarkUnitIds: [],
        sacrificedUnitIds: [],
        lifeCount: 0,
      };
      const req = createMockRequest({
        selfHand: [cardS7, cardJoker],
        costPayments: [cp],
      });
      const { features } = encodeTacticalPatternFeatures(
        req,
        req.patterns[1],
        evaluator,
        TACTICAL_FEATURE_ENCODER_VERSION_V73
      );
      expect(features[20]).toBeCloseTo(7 / 17, 10);
      expect(features[21]).toBeCloseTo(0.5, 10);
    });

    it("C7: 2枚のJoker廃棄の場合、t20 = 0.0, t21 = 2 / (2 + 1) = 2/3", () => {
      const joker1 = createTestCard({
        cardInstanceId: "card-joker1",
        suit: "J",
        rank: "JOKER",
        value: 0,
        isJoker: true,
      });
      const joker2 = createTestCard({
        cardInstanceId: "card-joker2",
        suit: "JOKER",
        rank: "JOKER",
        value: 0,
        isJoker: true,
      });
      const cp: CostPayment = {
        discardedCardIds: ["card-joker1", "card-joker2"],
        drivenBulwarkUnitIds: [],
        sacrificedUnitIds: [],
        lifeCount: 0,
      };
      const req = createMockRequest({
        selfHand: [joker1, joker2],
        costPayments: [cp],
      });
      const { features } = encodeTacticalPatternFeatures(
        req,
        req.patterns[1],
        evaluator,
        TACTICAL_FEATURE_ENCODER_VERSION_V73
      );
      expect(features[20]).toBe(0.0);
      expect(features[21]).toBeCloseTo(2 / 3, 10);
    });

    it("C8: 生贄なしの場合、t22 = 0.0", () => {
      const cp: CostPayment = {
        discardedCardIds: [],
        drivenBulwarkUnitIds: [],
        sacrificedUnitIds: [],
        lifeCount: 0,
      };
      const req = createMockRequest({ costPayments: [cp] });
      const { features } = encodeTacticalPatternFeatures(
        req,
        req.patterns[1],
        evaluator,
        TACTICAL_FEATURE_ENCODER_VERSION_V73
      );
      expect(features[22]).toBe(0.0);
    });

    it("C9: 単一ユニット生贄 (size 2) の場合、t22 = 2 / (2 + 3) = 2/5 = 0.4", () => {
      const u1 = createTestUnit({ unitId: "unit-u1", currentSize: 2 });
      const cp: CostPayment = {
        discardedCardIds: [],
        drivenBulwarkUnitIds: [],
        sacrificedUnitIds: ["unit-u1"],
        lifeCount: 0,
      };
      const req = createMockRequest({
        selfField: [u1],
        costPayments: [cp],
      });
      const { features } = encodeTacticalPatternFeatures(
        req,
        req.patterns[1],
        evaluator,
        TACTICAL_FEATURE_ENCODER_VERSION_V73
      );
      expect(features[22]).toBeCloseTo(0.4, 10);
    });

    it("C10: 複数ユニット生贄 (size 1 + size 4 = 5) の場合、t22 = 5 / (5 + 3) = 5/8 = 0.625", () => {
      const u1 = createTestUnit({ unitId: "unit-u1", currentSize: 1 });
      const u2 = createTestUnit({ unitId: "unit-u2", currentSize: 4 });
      const cp: CostPayment = {
        discardedCardIds: [],
        drivenBulwarkUnitIds: [],
        sacrificedUnitIds: ["unit-u1", "unit-u2"],
        lifeCount: 0,
      };
      const req = createMockRequest({
        selfField: [u1, u2],
        costPayments: [cp],
      });
      const { features } = encodeTacticalPatternFeatures(
        req,
        req.patterns[1],
        evaluator,
        TACTICAL_FEATURE_ENCODER_VERSION_V73
      );
      expect(features[22]).toBeCloseTo(0.625, 10);
    });

    it("C11: ライフ支払いゼロの場合、t23 = 0.0", () => {
      const cp: CostPayment = {
        discardedCardIds: [],
        drivenBulwarkUnitIds: [],
        sacrificedUnitIds: [],
        lifeCount: 0,
      };
      const req = createMockRequest({ selfLife: 15, costPayments: [cp] });
      const { features } = encodeTacticalPatternFeatures(
        req,
        req.patterns[1],
        evaluator,
        TACTICAL_FEATURE_ENCODER_VERSION_V73
      );
      expect(features[23]).toBe(0.0);
    });

    it("C12: ライフ支払い (pay 3, selfLife 15) -> 3/15 = 0.2, (pay 5, selfLife 2) -> 1.0 (有界クランプ)", () => {
      const cp1: CostPayment = {
        discardedCardIds: [],
        drivenBulwarkUnitIds: [],
        sacrificedUnitIds: [],
        lifeCount: 3,
      };
      const req1 = createMockRequest({ selfLife: 15, costPayments: [cp1] });
      const res1 = encodeTacticalPatternFeatures(
        req1,
        req1.patterns[1],
        evaluator,
        TACTICAL_FEATURE_ENCODER_VERSION_V73
      );
      expect(res1.features[23]).toBeCloseTo(0.2, 10);

      const cp2: CostPayment = {
        discardedCardIds: [],
        drivenBulwarkUnitIds: [],
        sacrificedUnitIds: [],
        lifeCount: 5,
      };
      const req2 = createMockRequest({ selfLife: 2, costPayments: [cp2] });
      const res2 = encodeTacticalPatternFeatures(
        req2,
        req2.patterns[1],
        evaluator,
        TACTICAL_FEATURE_ENCODER_VERSION_V73
      );
      expect(res2.features[23]).toBe(1.0);
    });
  });

  // ===========================================================================
  // 2. ID解決3状態テスト (KNOWN / HIDDEN / INVALID_REFERENCE)
  // ===========================================================================
  describe("2. ID解決3状態テスト (KNOWN / HIDDEN / INVALID_REFERENCE)", () => {
    it("HIDDEN (伏せカード) は推測チート禁止によりランク加算されず 0.0 となり、不正IDとしても扱われない", () => {
      const hiddenCard = createTestCard({
        cardInstanceId: "card-hidden-1",
        suit: "S",
        rank: "K",
        value: 13,
        visibility: "HIDDEN",
      });
      const cp: CostPayment = {
        discardedCardIds: ["card-hidden-1"],
        drivenBulwarkUnitIds: [],
        sacrificedUnitIds: [],
        lifeCount: 0,
      };
      const req = createMockRequest({
        selfHand: [hiddenCard],
        costPayments: [cp],
      });
      const res = encodeTacticalPatternFeatures(
        req,
        req.patterns[1],
        evaluator,
        TACTICAL_FEATURE_ENCODER_VERSION_V73
      );
      expect(res.features[20]).toBe(0.0);
      expect(res.features[21]).toBe(0.0);
      // HIDDEN は正当な観測内カードなので INVALID_REFERENCE には入らない
      expect(res.invalidCardReferenceIds).toEqual([]);
    });

    it("INVALID_REFERENCE (観測外のカードID) は Joker と混同されず、フェイルクローズで 0.0 となり診断検出される", () => {
      const cp: CostPayment = {
        discardedCardIds: ["non-existent-card-id-999"],
        drivenBulwarkUnitIds: [],
        sacrificedUnitIds: [],
        lifeCount: 0,
      };
      const req = createMockRequest({
        selfHand: [],
        costPayments: [cp],
      });
      const res = encodeTacticalPatternFeatures(
        req,
        req.patterns[1],
        evaluator,
        TACTICAL_FEATURE_ENCODER_VERSION_V73
      );
      // Joker(t21) としてカウントされてはならない！
      expect(res.features[20]).toBe(0.0);
      expect(res.features[21]).toBe(0.0);
      // 不正参照IDとして診断検出されること
      expect(res.invalidCardReferenceIds).toEqual(["non-existent-card-id-999"]);
    });

    it("INVALID_REFERENCE (観測外のユニットID) はフェイルクローズで 0.0 となり診断検出される", () => {
      const cp: CostPayment = {
        discardedCardIds: [],
        drivenBulwarkUnitIds: [],
        sacrificedUnitIds: ["non-existent-unit-id-888"],
        lifeCount: 0,
      };
      const req = createMockRequest({
        selfField: [],
        costPayments: [cp],
      });
      const res = encodeTacticalPatternFeatures(
        req,
        req.patterns[1],
        evaluator,
        TACTICAL_FEATURE_ENCODER_VERSION_V73
      );
      expect(res.features[22]).toBe(0.0);
      // 不正参照ユニットIDとして診断検出されること
      expect(res.invalidUnitReferenceIds).toEqual(["non-existent-unit-id-888"]);
    });

    it("INVALID_REFERENCE (カタログ範囲外の costPaymentRef) は診断検出され特徴量は 0.0 となる", () => {
      const req = createMockRequest({
        costPayments: [], // カタログは空
      });
      // pattern の costPaymentRef: 0 は範囲外
      const res = encodeTacticalPatternFeatures(
        req,
        req.patterns[1], // costPaymentRef: 0
        evaluator,
        TACTICAL_FEATURE_ENCODER_VERSION_V73
      );
      expect(res.features[20]).toBe(0.0);
      expect(res.features[21]).toBe(0.0);
      expect(res.features[22]).toBe(0.0);
      expect(res.features[23]).toBe(0.0);
      expect(res.invalidCostPaymentRefs).toEqual([0]);
    });
  });

  // ===========================================================================
  // 3. DNA移行・復元・バリデーションテスト (DNA-T1〜T5)
  // ===========================================================================
  describe("3. DNA移行・復元・バリデーションテスト (DNA-T1〜T5)", () => {
    it("DNA-T1: 旧20次元DNAの完全復元 (元重み20個維持、末尾4つゼロ、メタデータ完全保持)", () => {
      // 旧 20 次元重みベクトル
      const old20Weights = [
        -2.5, -0.8, -0.35, -1.8, -0.5, -0.25,
        +2.2, +1.8, +1.0, +0.2,
        +0.2, +0.25, +0.05, -0.35,
        +0.2, -2.5, -0.5,
        +0.1,
        +2.0, +2.5,
      ];
      expect(old20Weights.length).toBe(TACTICAL_FEATURE_DIMENSION_V70);

      // 旧 20 次元の notes を持つ DNA を構築
      const clonedDNA: DecisionDNA = {
        ...DecisionDNACodec.clone(gen8DNA),
        metadata: {
          id: "gen9-test-legacy-v72",
          name: "Legacy V72 Individual",
          generation: 5,
          parentIds: ["parent-alpha", "parent-beta"],
          notes: JSON.stringify({
            tacticalSchemaVersion: 7,
            tacticalWeights: old20Weights,
            originType: "EVOLVED_OFFSPRING",
            createdGeneration: 5,
            encoderVersion: "v7.2-unified-block-conditional-pass",
            userNotes: "legacy-v72-dna",
          }),
        },
      };

      const restored = fromV6CompatibleDNA(clonedDNA);
      expect(restored.tacticalWeights.length).toBe(TACTICAL_FEATURE_DIMENSION_V73);
      // 先頭20次元は元の値とビット単位で完全一致
      for (let i = 0; i < TACTICAL_FEATURE_DIMENSION_V70; i++) {
        expect(restored.tacticalWeights[i]).toBe(old20Weights[i]);
      }
      // 末尾4次元は厳格に 0.0
      expect(restored.tacticalWeights[20]).toBe(0.0);
      expect(restored.tacticalWeights[21]).toBe(0.0);
      expect(restored.tacticalWeights[22]).toBe(0.0);
      expect(restored.tacticalWeights[23]).toBe(0.0);

      // メタデータの完全保持
      expect(restored.metadata?.id).toBe("gen9-test-legacy-v72");
      expect(restored.metadata?.name).toBe("Legacy V72 Individual");
      expect(restored.metadata?.generation).toBe(5);
      expect(restored.metadata?.createdGeneration).toBe(5);
      expect(restored.metadata?.originType).toBe("EVOLVED_OFFSPRING");
      expect(restored.metadata?.parentIds).toEqual(["parent-alpha", "parent-beta"]);
      expect(restored.metadata?.notes).toBe("legacy-v72-dna");
      expect(restored.metadata?.encoderVersion).toBe("v7.2-unified-block-conditional-pass");
    });

    it("DNA-T2: 新24次元DNAの無損失往復変換 (toV6CompatibleDNA <-> fromV6CompatibleDNA)", () => {
      const custom24Weights = R4_PRESET_TACTICAL_WEIGHTS.map((w, idx) => w + idx * 0.05);
      const genome: Gen9TacticalGenome = {
        tacticalSchemaVersion: 7,
        baseDNA: DecisionDNACodec.clone(gen8DNA),
        tacticalWeights: custom24Weights,
        metadata: {
          id: "gen9-ind-v73-cost",
          name: "Gen9 V73 Cost Evaluated",
          generation: 1,
          createdGeneration: 1,
          originType: "EVOLVED_OFFSPRING",
          parentIds: ["p1"],
          notes: "roundtrip-test",
          encoderVersion: TACTICAL_FEATURE_ENCODER_VERSION_V73,
        },
      };

      const v6 = toV6CompatibleDNA(genome);
      expect(() => DecisionDNACodec.validate(v6)).not.toThrow();

      const restored = fromV6CompatibleDNA(v6);
      expect(restored.tacticalWeights.length).toBe(24);
      for (let k = 0; k < 24; k++) {
        expect(restored.tacticalWeights[k]).toBeCloseTo(custom24Weights[k], 12);
      }
      expect(restored.metadata?.encoderVersion).toBe(TACTICAL_FEATURE_ENCODER_VERSION_V73);
      expect(restored.metadata?.id).toBe("gen9-ind-v73-cost");
    });

    it("DNA-T3: 不正な次元数 (19, 21, 23, 25) の重みはフォールバックせず明示的に例外をスローする", () => {
      for (const len of [19, 21, 23, 25]) {
        const invalidWeights = new Array(len).fill(0.1);
        expect(() => fromV6DNA(gen8DNA, invalidWeights)).toThrow(
          /tacticalWeights の次元数が不正です/
        );

        const cloned: DecisionDNA = {
          ...DecisionDNACodec.clone(gen8DNA),
          metadata: {
            notes: JSON.stringify({
              tacticalSchemaVersion: 7,
              tacticalWeights: invalidWeights,
            }),
          },
        };
        expect(() => fromV6CompatibleDNA(cloned)).toThrow(
          /tacticalWeights の次元数が不正です/
        );
      }
    });

    it("DNA-T4: 非有限値 (NaN, Infinity, -Infinity) を含む重みは明示的に例外をスローする", () => {
      const nanWeights = [...R4_PRESET_TACTICAL_WEIGHTS];
      nanWeights[5] = NaN;
      expect(() => fromV6DNA(gen8DNA, nanWeights)).toThrow(
        /有限な数値ではありません/
      );

      const infWeights = [...R4_PRESET_TACTICAL_WEIGHTS];
      infWeights[21] = Infinity;
      expect(() => fromV6DNA(gen8DNA, infWeights)).toThrow(
        /有限な数値ではありません/
      );

      const cloned: DecisionDNA = {
        ...DecisionDNACodec.clone(gen8DNA),
        metadata: {
          notes: JSON.stringify({
            tacticalSchemaVersion: 7,
            tacticalWeights: nanWeights,
          }),
        },
      };
      expect(() => fromV6CompatibleDNA(cloned)).toThrow(
        /有限な数値ではありません/
      );
    });

    it("DNA-T5: 戦術重みを持たないベースライン Schema v6 DNA からフォールバック変換できる", () => {
      const baseDNA: DecisionDNA = {
        ...DecisionDNACodec.clone(gen8DNA),
        metadata: { notes: "pure v6 baseline dna without tactical weights" },
      };

      const gDefault = fromV6CompatibleDNA(baseDNA, "r4");
      expect(gDefault.tacticalWeights.length).toBe(24);
      expect(gDefault.tacticalWeights[20]).toBe(0.0);
      expect(gDefault.tacticalWeights[21]).toBe(0.0);
      expect(gDefault.tacticalWeights[22]).toBe(0.0);
      expect(gDefault.tacticalWeights[23]).toBe(0.0);

      const gZero = fromV6CompatibleDNA(baseDNA, "zero");
      expect(gZero.tacticalWeights.length).toBe(24);
      expect(gZero.tacticalWeights.every((w) => w === 0.0)).toBe(true);
    });

    it("DNA-T6: 未知の encoderVersion 文字列を持つ DNA は明示的に例外をスローして拒否する", () => {
      const cloned: DecisionDNA = {
        ...DecisionDNACodec.clone(gen8DNA),
        metadata: {
          notes: JSON.stringify({
            tacticalSchemaVersion: 7,
            tacticalWeights: R4_PRESET_TACTICAL_WEIGHTS,
            encoderVersion: "v8.0-unknown-unsupported-version",
          }),
        },
      };
      expect(() => fromV6CompatibleDNA(cloned)).toThrow(
        /encoderVersion が未知または不正です/
      );
    });

    it("DNA-T7: encoderVersion が省略された旧20次元 DNA は v7.2 として復元され、24次元にゼロ拡張される", () => {
      const old20Weights = [
        -2.5, -0.8, -0.35, -1.8, -0.5, -0.25,
        +2.2, +1.8, +1.0, +0.2,
        +0.2, +0.25, +0.05, -0.35,
        +0.2, -2.5, -0.5,
        +0.1,
        +2.0, +2.5,
      ];
      const cloned: DecisionDNA = {
        ...DecisionDNACodec.clone(gen8DNA),
        metadata: {
          notes: JSON.stringify({
            tacticalSchemaVersion: 7,
            tacticalWeights: old20Weights,
            // encoderVersion をあえて省略
          }),
        },
      };
      const restored = fromV6CompatibleDNA(cloned);
      expect(restored.tacticalWeights.length).toBe(24);
      expect(restored.metadata?.encoderVersion).toBe("v7.2-unified-block-conditional-pass");
      expect(restored.tacticalWeights.slice(0, 20)).toEqual(old20Weights);
      expect(restored.tacticalWeights.slice(20)).toEqual([0, 0, 0, 0]);
    });
  });

  // ===========================================================================
  // 4. ゼロ重みパリティテスト (旧Policy vs 新Policy)
  // ===========================================================================
  describe("4. ゼロ重みパリティテスト (旧Policy vs 新Policy)", () => {
    it("旧Policy (v7.2, 20次元重み) と新Policy (v7.3, 24次元重み, 末尾4ゼロ) の全手スコア差がマシンイプシロン未満 (delta < 1e-15)", () => {
      const base20Weights = [
        -2.5, -0.8, -0.35, -1.8, -0.5, -0.25,
        +2.2, +1.8, +1.0, +0.2,
        +0.2, +0.25, +0.05, -0.35,
        +0.2, -2.5, -0.5,
        +0.1,
        +2.0, +2.5,
      ];
      const new24Weights = [...base20Weights, 0.0, 0.0, 0.0, 0.0];

      const oldPolicy = new Gen9LearnableTacticalPolicy(
        fromV6DNA(gen8DNA, base20Weights),
        "OldPolicy-v72",
        evaluator,
        TACTICAL_FEATURE_ENCODER_VERSION_V72
      );

      const newPolicy = new Gen9LearnableTacticalPolicy(
        fromV6DNA(gen8DNA, new24Weights),
        "NewPolicy-v73",
        evaluator,
        TACTICAL_FEATURE_ENCODER_VERSION_V73
      );

      // コスト支払いを含む多様なパターンを用意
      const cardS7 = createTestCard({
        cardInstanceId: "card-s7",
        suit: "S",
        rank: "7",
        value: 7,
      });
      const cardHK = createTestCard({
        cardInstanceId: "card-hk",
        suit: "H",
        rank: "K",
        value: 13,
      });
      const u1 = createTestUnit({ unitId: "unit-u1", currentSize: 3 });

      const cp1: CostPayment = {
        discardedCardIds: ["card-s7"],
        drivenBulwarkUnitIds: [],
        sacrificedUnitIds: [],
        lifeCount: 0,
      };
      const cp2: CostPayment = {
        discardedCardIds: ["card-hk"],
        drivenBulwarkUnitIds: [],
        sacrificedUnitIds: ["unit-u1"],
        lifeCount: 2,
      };

      const testPatterns: LegalPattern[] = [
        { patternId: "pat-pass", kind: "PASS" },
        { patternId: "pat-act-0", kind: "ACTION", actionSelectionRef: 0, costPaymentRef: 0 },
        { patternId: "pat-act-1", kind: "ACTION", actionSelectionRef: 0, costPaymentRef: 1 },
      ];

      const req = createMockRequest({
        selfLife: 10,
        selfHand: [cardS7, cardHK],
        selfField: [u1],
        costPayments: [cp1, cp2],
        patterns: testPatterns,
      });

      const oldResult = oldPolicy.evaluatePatterns(req);
      const newResult = newPolicy.evaluatePatterns(req);

      expect(newResult.bestPatternRef).toBe(oldResult.bestPatternRef);
      expect(newResult.scoredPatterns.length).toBe(oldResult.scoredPatterns.length);

      for (let i = 0; i < oldResult.scoredPatterns.length; i++) {
        const oldDetail = oldResult.scoredPatterns[i];
        const newDetail = newResult.scoredPatterns[i];

        expect(newDetail.patternRef).toBe(oldDetail.patternRef);
        expect(newDetail.baseScore).toBe(oldDetail.baseScore);

        // 新特徴量の重みが 0.0 のため、戦術補正スコアおよび最終スコアは完全一致 (delta < 1e-15)
        const diffTactical = Math.abs(newDetail.tacticalAdjustment - oldDetail.tacticalAdjustment);
        const diffFinal = Math.abs(newDetail.finalScore - oldDetail.finalScore);
        expect(diffTactical).toBeLessThan(1e-15);
        expect(diffFinal).toBeLessThan(1e-15);

        // 先頭20次元の特徴量値も完全一致
        for (let k = 0; k < 20; k++) {
          expect(newDetail.tacticalFeatures[k]).toBe(oldDetail.tacticalFeatures[k]);
        }
      }

      // choose() の結果も完全一致
      const oldChoice = oldPolicy.choose(req);
      const newChoice = newPolicy.choose(req);
      expect(newChoice.selectedPatternRef).toBe(oldChoice.selectedPatternRef);
    });

    it("PASS 条件付き免除 (v7.2) が v7.3 でも 100% 継承されていることの検証", () => {
      // 相手の未解決リクエスト（確定3ダメージ）が存在するが、対抗手段がない状況
      const reqNoCounter = createMockRequest({
        selfLife: 5,
        patterns: [
          { patternId: "pat-pass", kind: "PASS" },
          { patternId: "pat-summon", kind: "ACTION", actionSelectionRef: 0 },
        ],
      });
      // 相手リクエスト（確定3ダメージ）を注入
      (reqNoCounter.observation as any).stageRequests = [
        {
          requestId: "req-opp-1",
          actionId: "action.damage3",
          controller: "p2",
          status: "pending",
        },
      ];

      const policyV72 = new Gen9LearnableTacticalPolicy(
        fromV6DNA(gen8DNA, "r4"),
        "P-v72",
        evaluator,
        TACTICAL_FEATURE_ENCODER_VERSION_V72
      );

      const policyV73 = new Gen9LearnableTacticalPolicy(
        fromV6DNA(gen8DNA, "r4"),
        "P-v73",
        evaluator,
        TACTICAL_FEATURE_ENCODER_VERSION_V73
      );

      const evalV72 = policyV72.evaluatePatterns(reqNoCounter);
      const evalV73 = policyV73.evaluatePatterns(reqNoCounter);

      // 対抗手段がないため PASS ペナルティは免除される
      const passV72 = evalV72.scoredPatterns.find((p) => p.patternRef === 0)!;
      const passV73 = evalV73.scoredPatterns.find((p) => p.patternRef === 0)!;

      expect(passV72.tacticalFeatures[0]).toBe(0.0); // t00 免除
      expect(passV73.tacticalFeatures[0]).toBe(0.0); // t00 免除
      expect(passV73.finalScore).toBeCloseTo(passV72.finalScore, 12);
    });
  });

  // ===========================================================================
  // 5. カテゴリー別寄与度と最終スコアの整合性テスト
  // ===========================================================================
  describe("5. カテゴリー別寄与度と最終スコアの整合性テスト", () => {
    it("RESOURCE_COST カテゴリの寄与度および合計スコアが数学的に厳密に一致する", () => {
      const cardHK = createTestCard({
        cardInstanceId: "card-hk",
        suit: "H",
        rank: "K",
        value: 13,
      });
      const cardJoker = createTestCard({
        cardInstanceId: "card-joker1",
        suit: "J",
        rank: "JOKER",
        value: 0,
        isJoker: true,
      });
      const u1 = createTestUnit({ unitId: "unit-u1", currentSize: 3 });

      const cp: CostPayment = {
        discardedCardIds: ["card-hk", "card-joker1"],
        drivenBulwarkUnitIds: [],
        sacrificedUnitIds: ["unit-u1"],
        lifeCount: 3,
      };

      const req = createMockRequest({
        selfLife: 15,
        selfHand: [cardHK, cardJoker],
        selfField: [u1],
        costPayments: [cp],
      });

      // 非ゼロのコスト重みベクトル
      const testWeights = [...R4_PRESET_TACTICAL_WEIGHTS];
      testWeights[20] = -0.5; // t20_cost_discard_value_sum
      testWeights[21] = -1.2; // t21_cost_discard_joker_count
      testWeights[22] = -0.8; // t22_cost_sacrifice_unit_size_sum
      testWeights[23] = -2.0; // t23_cost_life_fraction

      const policy = new Gen9LearnableTacticalPolicy(
        fromV6DNA(gen8DNA, testWeights),
        "P-CostActive",
        evaluator,
        TACTICAL_FEATURE_ENCODER_VERSION_V73
      );

      const evalResult = policy.evaluatePatterns(req);
      const actDetail = evalResult.scoredPatterns.find((p) => p.patternRef === 1)!;

      const f20 = actDetail.tacticalFeatures[20];
      const f21 = actDetail.tacticalFeatures[21];
      const f22 = actDetail.tacticalFeatures[22];
      const f23 = actDetail.tacticalFeatures[23];

      expect(f20).toBeCloseTo(13 / 23, 10);
      expect(f21).toBeCloseTo(0.5, 10);
      expect(f22).toBeCloseTo(3 / 6, 10);
      expect(f23).toBeCloseTo(3 / 15, 10);

      const expectedResourceCost =
        f20 * testWeights[20] +
        f21 * testWeights[21] +
        f22 * testWeights[22] +
        f23 * testWeights[23];

      expect(actDetail.categoryBreakdown.RESOURCE_COST).toBeCloseTo(expectedResourceCost, 12);

      const bd = actDetail.categoryBreakdown;
      const computedTotal =
        bd.CERTAIN_DAMAGE +
        bd.ESTIMATED_DAMAGE +
        bd.COUNTER_PREVENTION +
        bd.COMBAT_OUTCOME +
        bd.SURVIVAL +
        bd.LETHAL_OPPORTUNITY +
        bd.RESOURCE_COST;

      expect(bd.totalTacticalScore).toBeCloseTo(computedTotal, 12);
      expect(bd.finalScore).toBeCloseTo(bd.baseDNAScore + bd.totalTacticalScore, 12);
    });
  });

  // ===========================================================================
  // 6. 旧Encoder Version指定時の新特徴量ゼロ化テスト
  // ===========================================================================
  describe("6. 旧Encoder Version指定時の新特徴量ゼロ化テスト", () => {
    it("旧バージョン (v7.0, v7.1, v7.2) 指定時、非ゼロの重みがあっても t20〜t23 は厳格に 0.0 となる", () => {
      const cardHK = createTestCard({
        cardInstanceId: "card-hk",
        suit: "H",
        rank: "K",
        value: 13,
      });
      const cp: CostPayment = {
        discardedCardIds: ["card-hk"],
        drivenBulwarkUnitIds: [],
        sacrificedUnitIds: [],
        lifeCount: 2,
      };
      const req = createMockRequest({
        selfHand: [cardHK],
        costPayments: [cp],
      });

      const versions = [
        "v7.0-legacy-block-stream-only",
        "v7.1-unified-block-assignment",
        "v7.2-unified-block-conditional-pass",
      ] as const;

      for (const ver of versions) {
        expect(supportsCostEvaluation(ver)).toBe(false);

        const { features } = encodeTacticalPatternFeatures(
          req,
          req.patterns[1],
          evaluator,
          ver
        );

        expect(features[20]).toBe(0.0);
        expect(features[21]).toBe(0.0);
        expect(features[22]).toBe(0.0);
        expect(features[23]).toBe(0.0);
      }

      // v7.3 のみ true
      expect(supportsCostEvaluation(TACTICAL_FEATURE_ENCODER_VERSION_V73)).toBe(true);
    });
  });
});
