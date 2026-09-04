import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { fileURLToPath } from "url";
import { DecisionRequest } from "../../domain/decision/DecisionRequest";
import { DecisionFeatureEncoder } from "../../engine/ai/DecisionFeatureEncoder";
import {
  CONTEXT_FEATURE_NAMES,
  CONTEXT_FEATURE_DIMENSION,
  PATTERN_FEATURE_NAMES,
  PATTERN_FEATURE_DIMENSION,
  FEATURE_SCHEMA_VERSION,
  EncodedDecisionFeatures,
} from "../../domain/ai/DecisionFeatureTypes";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { getPlaytestRulePackage } from "../../engine/rules/RulePackageSelector";
import { RulePackage } from "../../domain/rules/RulePackage";
import { GameSession } from "../../engine/session/GameSession";
import { createCoreBattlePresetState } from "../../engine/session/playtest/createCoreBattlePlaytest";
import { MatchSetupCoordinator } from "../../engine/session/setup/MatchSetupCoordinator";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const expectNumericFeaturesEqual = (
  a: EncodedDecisionFeatures,
  b: EncodedDecisionFeatures
) => {
  expect(a.featureSchemaVersion).toBe(b.featureSchemaVersion);
  expect(a.context.values).toEqual(b.context.values);
  expect(a.patterns.length).toBe(b.patterns.length);
  for (let i = 0; i < a.patterns.length; i++) {
    expect(a.patterns[i].patternRef).toBe(b.patterns[i].patternRef);
    expect(a.patterns[i].kind).toBe(b.patterns[i].kind);
    expect(a.patterns[i].values).toEqual(b.patterns[i].values);
  }
};

describe("Decision Feature Contract v1 & Generic Feature Encoder v1 (Phase 3.0)", () => {
  let rulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    const fullPackage = await loadRulePackageFromDirectory(rulesDir);
    rulePackage = getPlaytestRulePackage(fullPackage);
  });

  const createSyntheticDecisionRequest = (): DecisionRequest => {
    return {
      protocolVersion: "1.0.0",
      matchId: "match-test-001",
      decisionId: "dec-123456",
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
            name: "Alice",
            isViewer: true,
            lifeCount: 15,
            lifeDisplay: "15",
            handCount: 5,
            handCards: [
              {
                visibility: "KNOWN",
                cardInstanceId: "card-p1-1",
                suit: "spade",
                rank: "A",
                value: 1,
                faceUp: true,
              },
              {
                visibility: "KNOWN",
                cardInstanceId: "card-p1-2",
                suit: "heart",
                rank: "10",
                value: 10,
                faceUp: true,
              },
            ],
            field: [
              {
                unitId: "unit-p1-1",
                kind: "soldier",
                componentId: "soldier_base",
                state: "drive",
                face: "up",
                cards: [],
                labels: [],
                currentSize: 4,
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
            // 相手Lifeが10枚以上の秘密状態
            lifeCount: undefined,
            lifeDisplay: "10以上",
            handCount: 4,
            handCards: [
              {
                visibility: "HIDDEN",
                opaqueCardId: "opaque-p2-1",
                faceUp: false,
              },
              {
                visibility: "HIDDEN",
                opaqueCardId: "opaque-p2-2",
                faceUp: false,
              },
            ],
            field: [
              {
                unitId: "unit-p2-1",
                kind: "soldier",
                componentId: "soldier_base",
                state: "charge",
                face: "up",
                cards: [],
                labels: [],
                currentSize: 3,
              },
            ],
            fog: [],
            trumps: [],
            graveCount: 1,
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
            actionId: "action.attack",
            actionName: "アタック",
            timing: "main",
            speed: "normal",
            cost: "D",
          },
          {
            actionId: "action.custom_flash",
            actionName: "閃光",
            timing: "quick",
            speed: "immediate",
          },
        ],
        cardSelections: [
          {
            cardIds: ["card-p1-1", "card-p1-2"],
            displayCodes: ["S-A", "H-10"],
          },
        ],
        unitSelections: [
          {
            unitIds: ["unit-p1-1"],
            displayNames: ["P1 兵士"],
          },
        ],
        costPayments: [
          {
            discardedCardIds: ["card-p1-1"],
            drivenBulwarkUnitIds: [],
            sacrificedUnitIds: [],
            lifeCount: 0,
            summary: "手札1枚破棄",
          },
          {
            discardedCardIds: [],
            drivenBulwarkUnitIds: [],
            sacrificedUnitIds: [],
            lifeCount: 2,
            summary: "ライフ2枚支払い",
          },
        ],
        targetSelections: [
          {
            targetType: "unit",
            targetUnitId: "unit-p2-1",
            displayName: "P2 兵士",
          },
          {
            targetType: "player",
            targetPlayerKey: "p2",
            displayName: "相手プレイヤー",
          },
        ],
        effectSelections: [
          {
            selectionType: "unitAssignment",
            assignments: [
              {
                sourceUnitId: "unit-p1-1",
                selectedUnitIds: ["unit-p2-1"],
              },
            ],
          },
          {
            selectionType: "future_unknown_type",
            selectedValues: ["val1", "val2"],
          },
        ],
        orderSelections: [
          {
            orderedIds: ["item-1", "item-2"],
          },
        ],
      },
      patterns: [
        {
          patternId: "pat-pass",
          kind: "PASS",
        },
        {
          patternId: "pat-attack",
          kind: "ACTION",
          actionSelectionRef: 0,
          keyCardSelectionRef: 0,
          keyUnitSelectionRef: 0,
          costPaymentRef: 0,
          targetSelectionRef: 0,
        },
        {
          patternId: "pat-effect",
          kind: "EFFECT_SELECTION",
          effectSelectionRef: 0,
        },
      ],
    };
  };

  it("A. Feature Schema v1 の次元数と名前配列が正しく固定されていること", () => {
    expect(DecisionFeatureEncoder.SCHEMA_VERSION).toBe(1);
    expect(FEATURE_SCHEMA_VERSION).toBe(1);
    expect(CONTEXT_FEATURE_NAMES.length).toBe(CONTEXT_FEATURE_DIMENSION);
    expect(PATTERN_FEATURE_NAMES.length).toBe(PATTERN_FEATURE_DIMENSION);
    expect(DecisionFeatureEncoder.CONTEXT_DIMENSION).toBe(CONTEXT_FEATURE_DIMENSION);
    expect(DecisionFeatureEncoder.PATTERN_DIMENSION).toBe(PATTERN_FEATURE_DIMENSION);
  });

  it("B. 同一の DecisionRequest を複数回エンコードした際、結果が 100% 完全一致すること", () => {
    const req = createSyntheticDecisionRequest();
    const encoded1 = DecisionFeatureEncoder.encode(req);
    const encoded2 = DecisionFeatureEncoder.encode(req);

    expect(encoded1).toEqual(encoded2);
    expect(JSON.stringify(encoded1)).toBe(JSON.stringify(encoded2));
  });

  it("C. エンコード結果が JSON-safe であり、シリアライズ / デシリアライズ round-trip が可能であること", () => {
    const req = createSyntheticDecisionRequest();
    const encoded = DecisionFeatureEncoder.encode(req);

    const json = JSON.stringify(encoded);
    const parsed = JSON.parse(json);

    expect(parsed.featureSchemaVersion).toBe(1);
    expect(parsed.context.values).toEqual(encoded.context.values);
    expect(parsed.patterns.length).toBe(encoded.patterns.length);
    expect(parsed.patterns[0].values).toEqual(encoded.patterns[0].values);
  });

  it("D. すべての特徴量数値が有限数 (Number.isFinite) であること", () => {
    const req = createSyntheticDecisionRequest();
    const encoded = DecisionFeatureEncoder.encode(req);

    for (const val of encoded.context.values) {
      expect(Number.isFinite(val)).toBe(true);
      expect(isNaN(val)).toBe(false);
    }

    for (const pat of encoded.patterns) {
      expect(pat.values.length).toBe(PATTERN_FEATURE_DIMENSION);
      for (const val of pat.values) {
        expect(Number.isFinite(val)).toBe(true);
        expect(isNaN(val)).toBe(false);
      }
    }
  });

  it("E. パターンの順序が維持され、patternRef が元のインデックスと一致すること", () => {
    const req = createSyntheticDecisionRequest();
    const encoded = DecisionFeatureEncoder.encode(req);

    expect(encoded.patterns.length).toBe(req.patterns.length);
    for (let i = 0; i < req.patterns.length; i++) {
      expect(encoded.patterns[i].patternRef).toBe(i);
      expect(encoded.patterns[i].kind).toBe(req.patterns[i].kind);
    }
  });

  it("F. runtime ID (decisionId, matchId, stateVersion) のみを変更しても特徴量ベクトルが一切変化しないこと", () => {
    const req1 = createSyntheticDecisionRequest();
    const req2: DecisionRequest = {
      ...req1,
      decisionId: "dec-999999-different",
      matchId: "match-completely-different",
      stateVersion: 42,
    };

    const encoded1 = DecisionFeatureEncoder.encode(req1);
    const encoded2 = DecisionFeatureEncoder.encode(req2);

    expectNumericFeaturesEqual(encoded1, encoded2);
  });

  it("G. 表示用文字列 (player.name, actionName, displayName, summary) のみを変更しても特徴量ベクトルが一切変化しないこと", () => {
    const req1 = createSyntheticDecisionRequest();
    const req2: DecisionRequest = {
      ...req1,
      observation: {
        ...req1.observation,
        players: req1.observation.players.map((p) => ({
          ...p,
          name: p.name + " (Modified Name)",
        })),
      },
      catalog: {
        ...req1.catalog,
        actions: req1.catalog.actions.map((a) => ({
          ...a,
          actionName: a.actionName + " (日本語変更)",
        })),
        unitSelections: req1.catalog.unitSelections.map((u) => ({
          ...u,
          displayNames: ["改変ユニット名"],
        })),
        costPayments: req1.catalog.costPayments.map((cp) => ({
          ...cp,
          summary: "別の説明文",
        })),
        targetSelections: req1.catalog.targetSelections.map((ts) => ({
          ...ts,
          displayName: "改変ターゲット名",
        })),
      },
    };

    const encoded1 = DecisionFeatureEncoder.encode(req1);
    const encoded2 = DecisionFeatureEncoder.encode(req2);

    expectNumericFeaturesEqual(encoded1, encoded2);
  });

  it("H. HiddenCardView の opaqueCardId のみを変更しても特徴量ベクトルが一切変化しないこと", () => {
    const req1 = createSyntheticDecisionRequest();
    const req2: DecisionRequest = {
      ...req1,
      observation: {
        ...req1.observation,
        players: req1.observation.players.map((p) => {
          if (p.playerId === "p2") {
            return {
              ...p,
              handCards: [
                { visibility: "HIDDEN", opaqueCardId: "opaque-diff-1", faceUp: false },
                { visibility: "HIDDEN", opaqueCardId: "opaque-diff-2", faceUp: false },
              ],
            };
          }
          return p;
        }),
      },
    };

    const encoded1 = DecisionFeatureEncoder.encode(req1);
    const encoded2 = DecisionFeatureEncoder.encode(req2);

    expectNumericFeaturesEqual(encoded1, encoded2);
  });

  it("H2. 参照関係を維持したまま cardInstanceId や unitId を一括リネームしても特徴量ベクトルが一切変化しないこと", () => {
    const req1 = createSyntheticDecisionRequest();

    const idMap: Record<string, string> = {
      "card-p1-1": "card-alpha-1",
      "card-p1-2": "card-alpha-2",
      "unit-p1-1": "unit-bravo-1",
      "unit-p2-1": "unit-charlie-2",
    };
    const mapId = (id: string) => idMap[id] ?? id;

    const req2: DecisionRequest = {
      ...req1,
      observation: {
        ...req1.observation,
        players: req1.observation.players.map((p) => ({
          ...p,
          handCards: p.handCards.map((c) => {
            if (c.visibility === "KNOWN") {
              return { ...c, cardInstanceId: mapId(c.cardInstanceId) };
            }
            return c;
          }),
          field: p.field.map((u) => ({
            ...u,
            unitId: mapId(u.unitId),
          })),
        })),
      },
      catalog: {
        ...req1.catalog,
        cardSelections: req1.catalog.cardSelections.map((cs) => ({
          ...cs,
          cardIds: cs.cardIds.map(mapId),
        })),
        unitSelections: req1.catalog.unitSelections.map((us) => ({
          ...us,
          unitIds: us.unitIds.map(mapId),
        })),
        costPayments: req1.catalog.costPayments.map((cp) => ({
          ...cp,
          discardedCardIds: cp.discardedCardIds.map(mapId),
          drivenBulwarkUnitIds: cp.drivenBulwarkUnitIds.map(mapId),
          sacrificedUnitIds: cp.sacrificedUnitIds.map(mapId),
        })),
        targetSelections: req1.catalog.targetSelections.map((ts) => ({
          ...ts,
          targetUnitId: ts.targetUnitId ? mapId(ts.targetUnitId) : undefined,
        })),
        effectSelections: req1.catalog.effectSelections.map((es) => ({
          ...es,
          assignments: es.assignments?.map((a) => ({
            sourceUnitId: mapId(a.sourceUnitId),
            selectedUnitIds: a.selectedUnitIds.map(mapId),
          })),
        })),
      },
    };

    const encoded1 = DecisionFeatureEncoder.encode(req1);
    const encoded2 = DecisionFeatureEncoder.encode(req2);

    expectNumericFeaturesEqual(encoded1, encoded2);
  });

  it("I. 視点対称性 (Viewer Symmetry): 鏡像関係の盤面・カタログで viewer が入れ替わった場合、Contextおよび全Pattern特徴量が完全一致すること", () => {
    // P1 視点
    const reqP1 = createSyntheticDecisionRequest();

    // P2 視点の鏡像リクエストを作成 (盤面・手札・ユニット・カタログ参照を P1 と完全に対称化)
    const reqP2: DecisionRequest = {
      protocolVersion: "1.0.0",
      matchId: "match-test-001",
      decisionId: "dec-p2-test",
      stateVersion: 1,
      playerId: "p2",
      source: {
        type: "ACTION_REQUEST",
        playerId: "p2",
      },
      observation: {
        viewerPlayerId: "p2",
        turnPlayerId: "p2",
        chancePlayerId: "p2",
        players: [
          {
            playerId: "p2",
            name: "Bob",
            isViewer: true,
            lifeCount: 15,
            lifeDisplay: "15",
            handCount: 5,
            handCards: [
              {
                visibility: "KNOWN",
                cardInstanceId: "card-p2-1",
                suit: "spade",
                rank: "A",
                value: 1,
                faceUp: true,
              },
              {
                visibility: "KNOWN",
                cardInstanceId: "card-p2-2",
                suit: "heart",
                rank: "10",
                value: 10,
                faceUp: true,
              },
            ],
            field: [
              {
                unitId: "unit-p2-1",
                kind: "soldier",
                componentId: "soldier_base",
                state: "drive",
                face: "up",
                cards: [],
                labels: [],
                currentSize: 4,
              },
            ],
            fog: [],
            trumps: [],
            graveCount: 0,
            grave: [],
            canViewFullGrave: true,
          },
          {
            playerId: "p1",
            name: "Alice",
            isViewer: false,
            lifeCount: undefined,
            lifeDisplay: "10以上",
            handCount: 4,
            handCards: [
              { visibility: "HIDDEN", opaqueCardId: "opaque-p1-1", faceUp: false },
              { visibility: "HIDDEN", opaqueCardId: "opaque-p1-2", faceUp: false },
            ],
            field: [
              {
                unitId: "unit-p1-1",
                kind: "soldier",
                componentId: "soldier_base",
                state: "charge",
                face: "up",
                cards: [],
                labels: [],
                currentSize: 3,
              },
            ],
            fog: [],
            trumps: [],
            graveCount: 1,
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
            actionId: "action.attack",
            actionName: "アタック",
            timing: "main",
            speed: "normal",
            cost: "D",
          },
          {
            actionId: "action.custom_flash",
            actionName: "閃光",
            timing: "quick",
            speed: "immediate",
          },
        ],
        cardSelections: [
          {
            cardIds: ["card-p2-1", "card-p2-2"],
            displayCodes: ["S-A", "H-10"],
          },
        ],
        unitSelections: [
          {
            unitIds: ["unit-p2-1"],
            displayNames: ["P2 兵士"],
          },
        ],
        costPayments: [
          {
            discardedCardIds: ["card-p2-1"],
            drivenBulwarkUnitIds: [],
            sacrificedUnitIds: [],
            lifeCount: 0,
            summary: "手札1枚破棄",
          },
          {
            discardedCardIds: [],
            drivenBulwarkUnitIds: [],
            sacrificedUnitIds: [],
            lifeCount: 2,
            summary: "ライフ2枚支払い",
          },
        ],
        targetSelections: [
          {
            targetType: "unit",
            targetUnitId: "unit-p1-1",
            displayName: "P1 兵士",
          },
          {
            targetType: "player",
            targetPlayerKey: "p1",
            displayName: "相手プレイヤー",
          },
        ],
        effectSelections: [
          {
            selectionType: "unitAssignment",
            assignments: [
              {
                sourceUnitId: "unit-p2-1",
                selectedUnitIds: ["unit-p1-1"],
              },
            ],
          },
          {
            selectionType: "future_unknown_type",
            selectedValues: ["val1", "val2"],
          },
        ],
        orderSelections: [
          {
            orderedIds: ["item-1", "item-2"],
          },
        ],
      },
      patterns: reqP1.patterns,
    };

    const encodedP1 = DecisionFeatureEncoder.encode(reqP1);
    const encodedP2 = DecisionFeatureEncoder.encode(reqP2);

    expectNumericFeaturesEqual(encodedP1, encodedP2);
    for (let i = 0; i < encodedP1.patterns.length; i++) {
      expect(encodedP1.patterns[i].logicalPatternKey).toBe(encodedP2.patterns[i].logicalPatternKey);
    }
  });

  it("J. 相手 Life 10以上時の秘密保持: lifeDisplay 文字列から正確な枚数を推測せず、秘密状態として同一にエンコードされること", () => {
    const req1 = createSyntheticDecisionRequest(); // lifeDisplay: "10以上"
    const req2 = createSyntheticDecisionRequest();
    // 相手が実際は15枚でも11枚でも、観測上 lifeCount は undefined、lifeDisplay は "10以上"
    (req2.observation.players[1] as any).lifeDisplay = "10以上";

    const encoded1 = DecisionFeatureEncoder.encode(req1);
    const encoded2 = DecisionFeatureEncoder.encode(req2);

    expect(encoded1.context.values).toEqual(encoded2.context.values);

    // opponent_life_known: 0, opponent_life_is_10plus: 1
    const ctxNames = CONTEXT_FEATURE_NAMES;
    const knownIdx = ctxNames.indexOf("opponent_life_known");
    const is10PlusIdx = ctxNames.indexOf("opponent_life_is_10plus");
    const visibleCountIdx = ctxNames.indexOf("opponent_life_visible_count");

    expect(encoded1.context.values[knownIdx]).toBe(0);
    expect(encoded1.context.values[is10PlusIdx]).toBe(1);
    expect(encoded1.context.values[visibleCountIdx]).toBe(0);
  });

  it("K. 自分の公開手札カードを変更した場合、関連するカード特徴量が正しく変化すること", () => {
    const req = createSyntheticDecisionRequest();
    const encodedOriginal = DecisionFeatureEncoder.encode(req);

    // 手札のカード数値を変更 (A=1 -> K=13)
    const reqModified: DecisionRequest = {
      ...req,
      observation: {
        ...req.observation,
        players: req.observation.players.map((p) => {
          if (p.isViewer) {
            return {
              ...p,
              handCards: [
                {
                  visibility: "KNOWN",
                  cardInstanceId: "card-p1-1",
                  suit: "spade",
                  rank: "K",
                  value: 13,
                  faceUp: true,
                },
                {
                  visibility: "KNOWN",
                  cardInstanceId: "card-p1-2",
                  suit: "heart",
                  rank: "10",
                  value: 10,
                  faceUp: true,
                },
              ],
            };
          }
          return p;
        }),
      },
    };

    const encodedModified = DecisionFeatureEncoder.encode(reqModified);

    // pat-attack (index 1) は keyCardSelectionRef: 0 を参照
    const valOrig = encodedOriginal.patterns[1].values;
    const valMod = encodedModified.patterns[1].values;

    const sumIdx = PATTERN_FEATURE_NAMES.indexOf("key_card_value_sum");
    const maxIdx = PATTERN_FEATURE_NAMES.indexOf("key_card_value_max");

    expect(valOrig[sumIdx]).toBe(1 + 10);
    expect(valMod[sumIdx]).toBe(13 + 10);
    expect(valOrig[maxIdx]).toBe(10);
    expect(valMod[maxIdx]).toBe(13);
  });

  it("L. パターンのコスト差 (手札破棄 vs ライフ支払い) が特徴量に正しく反映されること", () => {
    const req = createSyntheticDecisionRequest();
    // pattern 1: costPaymentRef: 0 (手札破棄 1)
    // 新パターン: costPaymentRef: 1 (ライフ支払い 2)
    const reqWithLifeCost: DecisionRequest = {
      ...req,
      patterns: [
        {
          patternId: "pat-attack-life",
          kind: "ACTION",
          actionSelectionRef: 0,
          costPaymentRef: 1,
        },
      ],
    };

    const encoded = DecisionFeatureEncoder.encode(reqWithLifeCost);
    const patVal = encoded.patterns[0].values;

    const discardIdx = PATTERN_FEATURE_NAMES.indexOf("cost_discard_count");
    const lifeIdx = PATTERN_FEATURE_NAMES.indexOf("cost_life_count");

    expect(patVal[discardIdx]).toBe(0);
    expect(patVal[lifeIdx]).toBe(2);
  });

  it("M. PASS, ACTION, EFFECT_SELECTION が特徴量上で明確に区別されること", () => {
    const req = createSyntheticDecisionRequest();
    const encoded = DecisionFeatureEncoder.encode(req);

    const passVals = encoded.patterns[0].values;
    const actVals = encoded.patterns[1].values;
    const effVals = encoded.patterns[2].values;

    const isActIdx = PATTERN_FEATURE_NAMES.indexOf("pattern_is_action");
    const isPassIdx = PATTERN_FEATURE_NAMES.indexOf("pattern_is_pass");
    const isEffIdx = PATTERN_FEATURE_NAMES.indexOf("pattern_is_effect_selection");

    expect(passVals[isPassIdx]).toBe(1);
    expect(passVals[isActIdx]).toBe(0);
    expect(passVals[isEffIdx]).toBe(0);

    expect(actVals[isActIdx]).toBe(1);
    expect(actVals[isPassIdx]).toBe(0);
    expect(actVals[isEffIdx]).toBe(0);

    expect(effVals[isEffIdx]).toBe(1);
    expect(effVals[isActIdx]).toBe(0);
    expect(effVals[isPassIdx]).toBe(0);
  });

  it("N. 未知の selectionType を持つ効果選択でも例外を投げず effect_type_other へフォールバックすること", () => {
    const req = createSyntheticDecisionRequest();
    const reqUnknown: DecisionRequest = {
      ...req,
      patterns: [
        {
          patternId: "pat-unknown-effect",
          kind: "EFFECT_SELECTION",
          effectSelectionRef: 1, // catalog.effectSelections[1] is selectionType: "future_unknown_type"
        },
      ],
    };

    expect(() => {
      const encoded = DecisionFeatureEncoder.encode(reqUnknown);
      const patVals = encoded.patterns[0].values;
      const otherIdx = PATTERN_FEATURE_NAMES.indexOf("effect_type_other");
      expect(patVals[otherIdx]).toBe(1);
    }).not.toThrow();
  });

  it("O. 未知の将来 Action ID や将来 Component ID を持つ場合でも例外を投げず固定次元数でエンコードできること", () => {
    const req = createSyntheticDecisionRequest();
    const reqFuture: DecisionRequest = {
      ...req,
      catalog: {
        ...req.catalog,
        actions: [
          {
            actionId: "action.future_master_extra_action",
            actionName: "未来のアクション",
            timing: "quick",
            speed: "immediate",
          },
        ],
      },
      observation: {
        ...req.observation,
        players: req.observation.players.map((p) => ({
          ...p,
          field: [
            {
              unitId: "unit-future-1",
              kind: "future_golem",
              componentId: "future_unknown_component_id",
              state: "drive",
              face: "up",
              cards: [],
              labels: [],
              currentSize: 9,
            },
          ],
        })),
      },
    };

    expect(() => {
      const encoded = DecisionFeatureEncoder.encode(reqFuture);
      expect(encoded.featureSchemaVersion).toBe(1);
      expect(encoded.context.values.length).toBe(CONTEXT_FEATURE_DIMENSION);
      expect(encoded.patterns[1].values.length).toBe(PATTERN_FEATURE_DIMENSION);
    }).not.toThrow();
  });

  it("P. 実 GameSession の判断要求 (DecisionRequest) を正常にエンコードできること", () => {
    const rawState = createCoreBattlePresetState();
    const setupResult = MatchSetupCoordinator.setupMatch(rawState);
    const session = new GameSession(setupResult.state, rulePackage);

    const step = session.advance();
    expect(step.type).toBe("WAITING_FOR_DECISION");
    if (step.type === "WAITING_FOR_DECISION") {
      const encoded = DecisionFeatureEncoder.encode(step.request);

      expect(encoded.featureSchemaVersion).toBe(1);
      expect(encoded.context.values.length).toBe(CONTEXT_FEATURE_DIMENSION);
      expect(encoded.patterns.length).toBe(step.request.patterns.length);

      for (let i = 0; i < encoded.patterns.length; i++) {
        expect(encoded.patterns[i].patternRef).toBe(i);
        expect(encoded.patterns[i].values.length).toBe(PATTERN_FEATURE_DIMENSION);
        for (const v of encoded.patterns[i].values) {
          expect(Number.isFinite(v)).toBe(true);
        }
      }
    }
  });

  it("Q. 実 GameSession から生成された EFFECT_RESOLUTION 判断要求を正常にエンコードできること", () => {
    const soldier1 = {
      unitId: "soldier-1",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "c1", suit: "S", rank: "6", value: 6 }],
      labels: ["攻撃", "防御"],
    };
    const soldier2 = {
      unitId: "soldier-2",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: "c2", suit: "H", rank: "7", value: 7 }],
      labels: ["攻撃"],
    };
    const bulwark1 = {
      unitId: "bulwark-1",
      kind: "防壁",
      componentId: "character.bulwark",
      state: "charge",
      cards: [{ id: "b1", suit: "D", rank: "5", value: 5 }],
      labels: ["防御"],
    };
    const battleState = {
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
          field: [soldier1, soldier2],
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
          field: [bulwark1],
          fog: [],
          grave: [],
        },
      },
      stage: { requests: [], history: [] },
      requestBuffer: { requests: [], history: [] },
    } as any;

    const session = new GameSession(battleState, rulePackage);

    // 1. P1 がアタック
    const step1 = session.advance();
    expect(step1.type).toBe("WAITING_FOR_DECISION");
    if (step1.type !== "WAITING_FOR_DECISION") return;
    const req1 = step1.request;
    const attackRef = req1.patterns.findIndex((p) => {
      if (p.actionSelectionRef === undefined) return false;
      return req1.catalog.actions[p.actionSelectionRef]?.actionId === "action.attack";
    });
    expect(attackRef).toBeGreaterThanOrEqual(0);
    session.submitDecision({
      decisionId: req1.decisionId,
      stateVersion: req1.stateVersion,
      selectedPatternRef: attackRef,
    });

    // 2. P1 が PASS
    const step2 = session.advance();
    expect(step2.type).toBe("WAITING_FOR_DECISION");
    if (step2.type !== "WAITING_FOR_DECISION") return;
    const req2 = step2.request;
    const pass1Ref = req2.patterns.findIndex((p) => p.kind === "PASS");
    expect(pass1Ref).toBeGreaterThanOrEqual(0);
    session.submitDecision({
      decisionId: req2.decisionId,
      stateVersion: req2.stateVersion,
      selectedPatternRef: pass1Ref,
    });

    // 3. P2 が PASS (全員PASS -> stage解決開始)
    const step3 = session.advance();
    expect(step3.type).toBe("WAITING_FOR_DECISION");
    if (step3.type !== "WAITING_FOR_DECISION") return;
    const req3 = step3.request;
    const pass2Ref = req3.patterns.findIndex((p) => p.kind === "PASS");
    expect(pass2Ref).toBeGreaterThanOrEqual(0);
    const step4 = session.submitDecision({
      decisionId: req3.decisionId,
      stateVersion: req3.stateVersion,
      selectedPatternRef: pass2Ref,
    });

    // 4. EFFECT_RESOLUTION DecisionRequest が返る
    expect(step4.type).toBe("WAITING_FOR_DECISION");
    if (step4.type !== "WAITING_FOR_DECISION") return;
    const effReq = step4.request;
    expect(effReq.source.type).toBe("EFFECT_RESOLUTION");
    expect(effReq.patterns.length).toBeGreaterThan(0);
    expect(effReq.patterns.every((p) => p.kind === "EFFECT_SELECTION")).toBe(true);

    // 5. エンコード実行
    const encoded = DecisionFeatureEncoder.encode(effReq);

    expect(encoded.featureSchemaVersion).toBe(1);
    expect(encoded.context.values.length).toBe(CONTEXT_FEATURE_DIMENSION);
    for (const val of encoded.context.values) {
      expect(Number.isFinite(val)).toBe(true);
    }

    // context の source_is_effect_resolution が 1 であること
    const effSrcIdx = CONTEXT_FEATURE_NAMES.indexOf("source_is_effect_resolution");
    expect(encoded.context.values[effSrcIdx]).toBe(1);

    // context の legal_effect_selection_pattern_count が patterns.length と一致すること
    const effCountIdx = CONTEXT_FEATURE_NAMES.indexOf("legal_effect_selection_pattern_count");
    expect(encoded.context.values[effCountIdx]).toBe(effReq.patterns.length);

    // patterns の検証
    expect(encoded.patterns.length).toBe(effReq.patterns.length);
    const isEffPatIdx = PATTERN_FEATURE_NAMES.indexOf("pattern_is_effect_selection");
    const hasEffPatIdx = PATTERN_FEATURE_NAMES.indexOf("has_effect_selection");

    for (let i = 0; i < encoded.patterns.length; i++) {
      const pat = encoded.patterns[i];
      expect(pat.patternRef).toBe(i);
      expect(pat.kind).toBe("EFFECT_SELECTION");
      expect(pat.values.length).toBe(PATTERN_FEATURE_DIMENSION);
      for (const val of pat.values) {
        expect(Number.isFinite(val)).toBe(true);
      }
      expect(pat.values[isEffPatIdx]).toBe(1);
      expect(pat.values[hasEffPatIdx]).toBe(1);
    }
  });
});
