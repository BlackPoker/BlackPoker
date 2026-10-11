import { describe, it, expect } from "vitest";
import { DecisionRequest } from "../../domain/decision/DecisionRequest";
import { DecisionCatalog } from "../../domain/decision/DecisionCatalog";
import { DecisionFeatureEncoder } from "../../engine/ai/DecisionFeatureEncoder";
import { PATTERN_FEATURE_NAMES, CONTEXT_FEATURE_NAMES, FEATURE_SCHEMA_VERSION } from "../../domain/ai/DecisionFeatureTypes";
import { StableIdentityEncoder } from "../../engine/ai/StableIdentityEncoder";

describe("Generic Effect Selection Regression & Synthetic Future Action (Feature Schema v3)", () => {
  /**
   * 共通の基本 DecisionRequest ファクトリ
   */
  const createBaseDecisionRequest = (
    sourceActionId: string,
    effectStepId: string,
    customCatalog?: Partial<DecisionCatalog>
  ): DecisionRequest => {
    return {
      protocolVersion: "1.0.0",
      matchId: "match-eff-regression",
      decisionId: `dec-reg-${sourceActionId}`,
      stateVersion: 1,
      playerId: "p1",
      source: {
        type: "EFFECT_RESOLUTION",
        sourceRequestRef: `req-${sourceActionId}`,
        effectStepId,
        playerId: "p1",
      },
      observation: {
        viewerPlayerId: "p1",
        turnPlayerId: "p1",
        chancePlayerId: "p1",
        turnCount: 2,
        players: [
          {
            playerId: "p1",
            name: "Alice",
            isViewer: true,
            lifeCount: 15,
            lifeDisplay: "15",
            handCount: 3,
            handCards: [
              {
                visibility: "KNOWN",
                cardInstanceId: "card-ace-spade",
                suit: "spade",
                rank: "A",
                value: 1,
                faceUp: true,
              },
              {
                visibility: "KNOWN",
                cardInstanceId: "card-num-heart-7",
                suit: "heart",
                rank: "7",
                value: 7,
                faceUp: true,
              },
              {
                visibility: "KNOWN",
                cardInstanceId: "card-joker",
                suit: "joker",
                rank: "Joker",
                value: 14,
                faceUp: true,
              },
            ],
            field: [
              {
                unitId: "u1-size2",
                kind: "soldier",
                componentId: "character.soldier",
                state: "charge",
                face: "up",
                cards: [],
                labels: [],
                currentSize: 2,
              },
              {
                unitId: "u2-size8",
                kind: "soldier",
                componentId: "character.soldier",
                state: "drive",
                face: "up",
                cards: [],
                labels: [],
                currentSize: 8,
              },
            ],
            fog: [],
            trumps: [],
            graveCount: 0,
            grave: [],
            canViewFullGrave: true,
          },
          {
            playerId: "p2",
            name: "Bob",
            isViewer: false,
            lifeCount: 10,
            lifeDisplay: "10",
            handCount: 4,
            handCards: [],
            field: [
              {
                unitId: "u-opp-attacker",
                kind: "soldier",
                componentId: "character.soldier",
                state: "charge",
                face: "up",
                cards: [],
                labels: [],
                currentSize: 5,
                battle: {
                  role: "attacker",
                  targetPlayerKey: "p1",
                },
              },
            ],
            fog: [],
            trumps: [],
            graveCount: 0,
            grave: [],
            canViewFullGrave: false,
          },
        ],
        stageRequestRefs: [`req-${sourceActionId}`],
        stageRequests: [
          {
            requestId: `req-${sourceActionId}`,
            actionId: sourceActionId,
            controller: "p1",
            status: "resolving",
            sequence: 1,
          },
        ],
        recentEvents: [],
      },
      catalog: {
        actions: [],
        cardSelections: [],
        unitSelections: [],
        costPayments: [],
        targetSelections: [],
        effectSelections: [],
        orderSelections: [],
        ...customCatalog,
      },
      patterns: [],
    };
  };

  // ===========================================================================
  // 1. Attack Regression: 0体 / 1体 / 複数体 / サイズ差
  // ===========================================================================
  describe("1. Attack Regression (Generic Unit Selection)", () => {
    it("distinguishes 0-unit, 1-unit, multi-unit, and different sized attacker selections", () => {
      const req = createBaseDecisionRequest("action.attack", "selectAttacker", {
        effectSelections: [
          {
            selectionType: "unit",
            selectedValues: [], // 0体アタッカー (攻撃パス)
            summary: "アタッカーなし",
          },
          {
            selectionType: "unit",
            selectedValues: ["u1-size2"], // 1体 (Size 2)
            summary: "アタッカー: u1-size2",
          },
          {
            selectionType: "unit",
            selectedValues: ["u2-size8"], // 1体 (Size 8)
            summary: "アタッカー: u2-size8",
          },
          {
            selectionType: "unit",
            selectedValues: ["u1-size2", "u2-size8"], // 2体 (合計 Size 10)
            summary: "アタッカー: u1-size2, u2-size8",
          },
        ],
      });
      (req as any).patterns = [0, 1, 2, 3].map((idx) => ({
        patternId: `pat-attack-${idx}`,
        kind: "EFFECT_SELECTION",
        effectSelectionRef: idx,
      }));

      const encoded = DecisionFeatureEncoder.encode(req);
      expect(encoded.patterns).toHaveLength(4);

      const unitCountIdx = PATTERN_FEATURE_NAMES.indexOf("effect_selected_unit_count");
      const sizeSumIdx = PATTERN_FEATURE_NAMES.indexOf("effect_selected_unit_size_sum");
      const sizeMaxIdx = PATTERN_FEATURE_NAMES.indexOf("effect_selected_unit_size_max");

      // 0体
      expect(encoded.patterns[0].values[unitCountIdx]).toBe(0);
      expect(encoded.patterns[0].values[sizeSumIdx]).toBe(0);

      // 1体 (Size 2)
      expect(encoded.patterns[1].values[unitCountIdx]).toBe(1);
      expect(encoded.patterns[1].values[sizeSumIdx]).toBe(2);
      expect(encoded.patterns[1].values[sizeMaxIdx]).toBe(2);

      // 1体 (Size 8)
      expect(encoded.patterns[2].values[unitCountIdx]).toBe(1);
      expect(encoded.patterns[2].values[sizeSumIdx]).toBe(8);
      expect(encoded.patterns[2].values[sizeMaxIdx]).toBe(8);

      // 2体 (合計 10)
      expect(encoded.patterns[3].values[unitCountIdx]).toBe(2);
      expect(encoded.patterns[3].values[sizeSumIdx]).toBe(10);
      expect(encoded.patterns[3].values[sizeMaxIdx]).toBe(8);

      // 4パターン全ての特徴量ベクトルが相互に相違していることを確認
      const p0 = encoded.patterns[0].values.join(",");
      const p1 = encoded.patterns[1].values.join(",");
      const p2 = encoded.patterns[2].values.join(",");
      const p3 = encoded.patterns[3].values.join(",");

      const set = new Set([p0, p1, p2, p3]);
      expect(set.size).toBe(4);
    });
  });

  // ===========================================================================
  // 2. Block Regression: PASS vs Block, Size 2 vs 8, Assignment Semantics
  // ===========================================================================
  describe("2. Block Regression (Generic Unit Assignment)", () => {
    it("distinguishes PASS, blocker size 2 vs 8, and positive vs negative size deltas", () => {
      // 相手アタッカーは u-opp-attacker (Size 5)
      const req = createBaseDecisionRequest("action.block", "selectBlocker", {
        effectSelections: [
          {
            selectionType: "unitAssignment",
            assignments: [
              {
                sourceUnitId: "u-opp-attacker",
                selectedUnitIds: [], // 0体ブロック (スルー)
              },
            ],
            summary: "ブロックなし",
          },
          {
            selectionType: "unitAssignment",
            assignments: [
              {
                sourceUnitId: "u-opp-attacker",
                selectedUnitIds: ["u1-size2"], // Size 2 でブロック (Delta = 2 - 5 = -3)
              },
            ],
            summary: "u1 (Size 2) でブロック",
          },
          {
            selectionType: "unitAssignment",
            assignments: [
              {
                sourceUnitId: "u-opp-attacker",
                selectedUnitIds: ["u2-size8"], // Size 8 でブロック (Delta = 8 - 5 = +3)
              },
            ],
            summary: "u2 (Size 8) でブロック",
          },
        ],
      });
      (req as any).patterns = [0, 1, 2].map((idx) => ({
        patternId: `pat-block-${idx}`,
        kind: "EFFECT_SELECTION",
        effectSelectionRef: idx,
      }));

      const encoded = DecisionFeatureEncoder.encode(req);
      expect(encoded.patterns).toHaveLength(3);

      const assignSelCountIdx = PATTERN_FEATURE_NAMES.indexOf("effect_assignment_selected_count");
      const assignSelSizeSumIdx = PATTERN_FEATURE_NAMES.indexOf("effect_assignment_selected_size_sum");
      const deltaSumIdx = PATTERN_FEATURE_NAMES.indexOf("effect_assignment_size_delta_sum");
      const posDeltaIdx = PATTERN_FEATURE_NAMES.indexOf("effect_assignment_positive_delta_count");
      const negDeltaIdx = PATTERN_FEATURE_NAMES.indexOf("effect_assignment_negative_delta_count");
      const selfToOppIdx = PATTERN_FEATURE_NAMES.indexOf("effect_assignment_self_to_opp_count");

      // 0体ブロック (スルー)
      expect(encoded.patterns[0].values[assignSelCountIdx]).toBe(0);
      expect(encoded.patterns[0].values[assignSelSizeSumIdx]).toBe(0);
      expect(encoded.patterns[0].values[deltaSumIdx]).toBe(0);

      // Size 2 でブロック (Delta = 2 - 5 = -3, negative delta count = 1)
      expect(encoded.patterns[1].values[assignSelCountIdx]).toBe(1);
      expect(encoded.patterns[1].values[assignSelSizeSumIdx]).toBe(2);
      expect(encoded.patterns[1].values[deltaSumIdx]).toBe(-3);
      expect(encoded.patterns[1].values[posDeltaIdx]).toBe(0);
      expect(encoded.patterns[1].values[negDeltaIdx]).toBe(1);
      expect(encoded.patterns[1].values[selfToOppIdx]).toBe(1); // self unit -> opp unit

      // Size 8 でブロック (Delta = 8 - 5 = +3, positive delta count = 1)
      expect(encoded.patterns[2].values[assignSelCountIdx]).toBe(1);
      expect(encoded.patterns[2].values[assignSelSizeSumIdx]).toBe(8);
      expect(encoded.patterns[2].values[deltaSumIdx]).toBe(3);
      expect(encoded.patterns[2].values[posDeltaIdx]).toBe(1);
      expect(encoded.patterns[2].values[negDeltaIdx]).toBe(0);
      expect(encoded.patterns[2].values[selfToOppIdx]).toBe(1);

      // 全て相互に異なる
      expect(encoded.patterns[0].values).not.toEqual(encoded.patterns[1].values);
      expect(encoded.patterns[1].values).not.toEqual(encoded.patterns[2].values);
    });
  });

  // ===========================================================================
  // 3. Search Regression: Ace vs Numeric vs Joker Card Selection
  // ===========================================================================
  describe("3. Search Regression (Generic Card Selection)", () => {
    it("distinguishes Ace, numeric card, and Joker choices in Search effect selection", () => {
      const req = createBaseDecisionRequest("action.search", "selectLifeCard", {
        effectSelections: [
          {
            selectionType: "card",
            selectedValues: ["card-ace-spade"], // Ace of Spade (value 1)
            summary: "♠A 選択",
          },
          {
            selectionType: "card",
            selectedValues: ["card-num-heart-7"], // 7 of Heart (value 7)
            summary: "♥7 選択",
          },
          {
            selectionType: "card",
            selectedValues: ["card-joker"], // Joker (value 14)
            summary: "Joker 選択",
          },
        ],
      });
      (req as any).patterns = [0, 1, 2].map((idx) => ({
        patternId: `pat-search-${idx}`,
        kind: "EFFECT_SELECTION",
        effectSelectionRef: idx,
      }));

      const encoded = DecisionFeatureEncoder.encode(req);
      expect(encoded.patterns).toHaveLength(3);

      const cardCountIdx = PATTERN_FEATURE_NAMES.indexOf("effect_selected_card_count");
      const aceCountIdx = PATTERN_FEATURE_NAMES.indexOf("effect_selected_card_ace_count");
      const numericCountIdx = PATTERN_FEATURE_NAMES.indexOf("effect_selected_card_numeric_count");
      const jokerCountIdx = PATTERN_FEATURE_NAMES.indexOf("effect_selected_card_joker_count");
      const valueSumIdx = PATTERN_FEATURE_NAMES.indexOf("effect_selected_card_value_sum");
      const spadeCountIdx = PATTERN_FEATURE_NAMES.indexOf("effect_selected_card_spade_count");
      const heartCountIdx = PATTERN_FEATURE_NAMES.indexOf("effect_selected_card_heart_count");

      // ♠A
      expect(encoded.patterns[0].values[cardCountIdx]).toBe(1);
      expect(encoded.patterns[0].values[aceCountIdx]).toBe(1);
      expect(encoded.patterns[0].values[spadeCountIdx]).toBe(1);
      expect(encoded.patterns[0].values[valueSumIdx]).toBe(1);
      expect(encoded.patterns[0].values[jokerCountIdx]).toBe(0);

      // ♥7
      expect(encoded.patterns[1].values[cardCountIdx]).toBe(1);
      expect(encoded.patterns[1].values[numericCountIdx]).toBe(1);
      expect(encoded.patterns[1].values[heartCountIdx]).toBe(1);
      expect(encoded.patterns[1].values[valueSumIdx]).toBe(7);
      expect(encoded.patterns[1].values[aceCountIdx]).toBe(0);

      // Joker
      expect(encoded.patterns[2].values[cardCountIdx]).toBe(1);
      expect(encoded.patterns[2].values[jokerCountIdx]).toBe(1);
      expect(encoded.patterns[2].values[valueSumIdx]).toBe(14);
      expect(encoded.patterns[2].values[numericCountIdx]).toBe(0);

      // 3候補全てが相互に完全に区別可能
      expect(encoded.patterns[0].values).not.toEqual(encoded.patterns[1].values);
      expect(encoded.patterns[1].values).not.toEqual(encoded.patterns[2].values);
      expect(encoded.patterns[0].values).not.toEqual(encoded.patterns[2].values);
    });
  });

  // ===========================================================================
  // 4. Reverse Regression: Multiple Legal Choices (Charge vs Drive)
  // ===========================================================================
  describe("4. Reverse Regression (Generic Option / State Selection)", () => {
    it("reflects differences in option choices and unit selections during Reverse effect resolution", () => {
      const req = createBaseDecisionRequest("action.reverse", "chooseTransformState", {
        effectSelections: [
          {
            selectionType: "option",
            selectedValues: ["charge"],
            summary: "チャージ状態を選択",
          },
          {
            selectionType: "option",
            selectedValues: ["drive"],
            summary: "ドライブ状態を選択",
          },
        ],
      });
      (req as any).patterns = [0, 1].map((idx) => ({
        patternId: `pat-rev-${idx}`,
        kind: "EFFECT_SELECTION",
        effectSelectionRef: idx,
      }));

      const encoded = DecisionFeatureEncoder.encode(req);
      expect(encoded.patterns).toHaveLength(2);

      // Request Context は action.reverse のハッシュを正確に保持
      const revBuckets = StableIdentityEncoder.encodeActionIdentity("action.reverse");
      for (let b = 0; b < 16; b++) {
        const bIdx = CONTEXT_FEATURE_NAMES.indexOf(`request_action_bucket_${b}` as any);
        expect(encoded.context.values[bIdx]).toBe(revBuckets[b]);
      }

      // Logical pattern keys で区別可能
      expect(encoded.patterns[0].logicalPatternKey).not.toEqual(encoded.patterns[1].logicalPatternKey);
    });
  });

  // ===========================================================================
  // 5. Synthetic Future Action Test: Unknown Actions Compatibility
  // ===========================================================================
  describe("5. Synthetic Future Action Test (Master / Extra Forward Compatibility)", () => {
    it("encodes unknown action.synthetic.alpha and action.synthetic.beta into distinct Request Context without schema change", () => {
      const reqAlpha = createBaseDecisionRequest("action.synthetic.alpha", "unknownStepAlpha");
      const reqBeta = createBaseDecisionRequest("action.synthetic.beta", "unknownStepBeta");

      const encodedAlpha = DecisionFeatureEncoder.encode(reqAlpha);
      const encodedBeta = DecisionFeatureEncoder.encode(reqBeta);

      // スキーマバージョンおよび次元数は完全に同一
      expect(encodedAlpha.featureSchemaVersion).toBe(FEATURE_SCHEMA_VERSION);
      expect(encodedBeta.featureSchemaVersion).toBe(FEATURE_SCHEMA_VERSION);
      expect(encodedAlpha.context.values.length).toBe(CONTEXT_FEATURE_NAMES.length);
      expect(encodedBeta.context.values.length).toBe(CONTEXT_FEATURE_NAMES.length);

      // 未知のアクションであっても、Request Context の Action Bucket が異なる
      const alphaBuckets = StableIdentityEncoder.encodeActionIdentity("action.synthetic.alpha");
      const betaBuckets = StableIdentityEncoder.encodeActionIdentity("action.synthetic.beta");
      expect(alphaBuckets).not.toEqual(betaBuckets);

      for (let b = 0; b < 16; b++) {
        const bIdx = CONTEXT_FEATURE_NAMES.indexOf(`request_action_bucket_${b}` as any);
        expect(encodedAlpha.context.values[bIdx]).toBe(alphaBuckets[b]);
        expect(encodedBeta.context.values[bIdx]).toBe(betaBuckets[b]);
      }

      // 結論: 新アクション追加時にスキーマ変更は一切不要であり、
      // 汎用 multi-bucket feature hashing により未知アクションも即座に区別・学習可能
    });
  });
});
