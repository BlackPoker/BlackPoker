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
} from "../../domain/ai/DecisionFeatureTypes";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { getPlaytestRulePackage } from "../../engine/rules/RulePackageSelector";
import { RulePackage } from "../../domain/rules/RulePackage";
import { GameSession } from "../../engine/session/GameSession";
import { createCoreBattlePresetState } from "../../engine/session/playtest/createCoreBattlePlaytest";
import { MatchSetupCoordinator } from "../../engine/session/setup/MatchSetupCoordinator";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

    expect(encoded1.context.values).toEqual(encoded2.context.values);
    for (let i = 0; i < encoded1.patterns.length; i++) {
      expect(encoded1.patterns[i].values).toEqual(encoded2.patterns[i].values);
    }
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
        costPayments: req1.catalog.costPayments.map((cp) => ({
          ...cp,
          summary: "別の説明文",
        })),
      },
    };

    const encoded1 = DecisionFeatureEncoder.encode(req1);
    const encoded2 = DecisionFeatureEncoder.encode(req2);

    expect(encoded1.context.values).toEqual(encoded2.context.values);
    for (let i = 0; i < encoded1.patterns.length; i++) {
      expect(encoded1.patterns[i].values).toEqual(encoded2.patterns[i].values);
    }
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

    expect(encoded1.context.values).toEqual(encoded2.context.values);
  });

  it("I. 視点対称性 (Viewer Symmetry): 鏡像関係の盤面で viewer が入れ替わった場合、相対特徴量が完全一致すること", () => {
    // P1 視点
    const reqP1 = createSyntheticDecisionRequest();

    // P2 視点の鏡像リクエストを作成 (盤面・手札・ユニットを P1 と完全に対称化)
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
      catalog: reqP1.catalog,
      patterns: reqP1.patterns,
    };

    const encodedP1 = DecisionFeatureEncoder.encode(reqP1);
    const encodedP2 = DecisionFeatureEncoder.encode(reqP2);

    expect(encodedP1.context.values).toEqual(encodedP2.context.values);
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
});
