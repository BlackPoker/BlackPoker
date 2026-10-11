import { describe, it, expect } from "vitest";
import { DecisionRequest } from "../../domain/decision/DecisionRequest";
import { DecisionFeatureEncoder } from "../../engine/ai/DecisionFeatureEncoder";
import {
  CONTEXT_FEATURE_NAMES,
  PATTERN_FEATURE_NAMES,
  EncodedDecisionFeatures,
} from "../../domain/ai/DecisionFeatureTypes";

describe("Decision Feature Schema v2 - Encoder-Level Defensive Privacy Tests", () => {
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

  const createBaseDecisionRequest = (): DecisionRequest => {
    return {
      protocolVersion: "1.0.0",
      matchId: "match-priv-001",
      decisionId: "dec-priv-001",
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
        turnCount: 3,
        players: [
          {
            playerId: "p1",
            name: "Player 1",
            isViewer: true,
            lifeCount: 8,
            lifeDisplay: "8",
            handCount: 3,
            handCards: [
              {
                visibility: "KNOWN",
                cardInstanceId: "c-p1-1",
                suit: "spade",
                rank: "A",
                value: 1,
                faceUp: true,
              },
              {
                visibility: "KNOWN",
                cardInstanceId: "c-p1-2",
                suit: "diamond",
                rank: "10",
                value: 10,
                faceUp: true,
              },
              {
                visibility: "KNOWN",
                cardInstanceId: "c-p1-3",
                suit: "heart",
                rank: "K",
                value: 13,
                faceUp: true,
              },
            ],
            field: [
              {
                unitId: "u-p1-1",
                kind: "soldier",
                componentId: "soldier_base",
                state: "drive",
                face: "up",
                cards: [],
                labels: [],
                currentSize: 5,
              },
            ],
            fog: [
              {
                fogId: "fog-p1-1",
                componentId: "character.fog",
                card: {
                  visibility: "KNOWN",
                  cardInstanceId: "c-p1-fog-1",
                  suit: "club",
                  rank: "5",
                  value: 5,
                  faceUp: false,
                },
              },
            ],
            trumps: [
              {
                unitId: "trump-p1-1",
                kind: "trump",
                componentId: "character.trump",
                state: "charge",
                face: "up",
                cards: [],
                labels: [],
                currentSize: 4,
              },
            ],
            graveCount: 2,
            grave: [],
            graveTopCard: {
              visibility: "KNOWN",
              cardInstanceId: "c-p1-grave-1",
              suit: "heart",
              rank: "7",
              value: 7,
              faceUp: true,
            },
            pack: {
              count: 3,
              opened: false,
              canViewCards: false,
              cards: [],
            },
            rareCards: {
              count: 1,
              canViewCards: true,
              cards: [
                {
                  visibility: "KNOWN",
                  cardInstanceId: "c-p1-rare-1",
                  suit: "diamond",
                  rank: "Q",
                  value: 12,
                  faceUp: true,
                },
              ],
            },
            canViewFullGrave: true,
          },
          {
            playerId: "p2",
            name: "Player 2",
            isViewer: false,
            // 相手Life 10枚以上の秘密状態
            lifeCount: undefined,
            lifeDisplay: "10以上",
            handCount: 4,
            handCards: [
              { visibility: "HIDDEN", opaqueCardId: "op-1", faceUp: false },
              { visibility: "HIDDEN", opaqueCardId: "op-2", faceUp: false },
              { visibility: "HIDDEN", opaqueCardId: "op-3", faceUp: false },
              { visibility: "HIDDEN", opaqueCardId: "op-4", faceUp: false },
            ],
            field: [
              {
                unitId: "u-p2-1",
                kind: "bulwark",
                componentId: "bulwark_base",
                state: "charge",
                face: "down",
                cards: [],
                labels: [],
                currentSize: 3,
              },
            ],
            fog: [
              {
                fogId: "fog-p2-1",
                componentId: "character.fog",
                card: {
                  visibility: "HIDDEN",
                  opaqueCardId: "op-fog-1",
                  faceUp: false,
                },
              },
            ],
            trumps: [
              {
                unitId: "trump-p2-1",
                kind: "trump",
                componentId: "character.trump",
                state: "drive",
                face: "up",
                cards: [],
                labels: [],
                currentSize: 2,
              },
            ],
            graveCount: 1,
            grave: [],
            graveTopCard: {
              visibility: "KNOWN",
              cardInstanceId: "c-p2-grave-1",
              suit: "spade",
              rank: "2",
              value: 2,
              faceUp: true,
            },
            pack: {
              count: 4,
              opened: false,
              canViewCards: false,
              cards: [],
            },
            rareCards: {
              count: 2,
              canViewCards: false,
              cards: [],
            },
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
          },
        ],
        cardSelections: [
          {
            cardIds: ["c-p1-1"],
            displayCodes: ["S-A"],
          },
        ],
        unitSelections: [
          {
            unitIds: ["u-p1-1"],
            displayNames: ["P1 ユニット"],
          },
        ],
        costPayments: [
          {
            discardedCardIds: ["c-p1-1"],
            drivenBulwarkUnitIds: [],
            sacrificedUnitIds: [],
            lifeCount: 0,
          },
        ],
        targetSelections: [
          {
            targetType: "unit",
            targetUnitId: "u-p2-1",
          },
        ],
        effectSelections: [],
        orderSelections: [],
      },
      patterns: [
        {
          patternId: "pat-pass",
          kind: "PASS",
        },
        {
          patternId: "pat-act",
          kind: "ACTION",
          actionSelectionRef: 0,
          keyCardSelectionRef: 0,
          keyUnitSelectionRef: 0,
          costPaymentRef: 0,
          targetSelectionRef: 0,
        },
      ],
    };
  };

  describe("1. Five Core Privacy Invariances (Section 27)", () => {
    it("1-1. 相手手札の秘密情報改変 (opaqueCardId変更、隠蔽カード入れ替え) に対して特徴量が 100% 不変であること", () => {
      const baseReq = createBaseDecisionRequest();
      const modReq: DecisionRequest = {
        ...baseReq,
        observation: {
          ...baseReq.observation,
          players: baseReq.observation.players.map((p) => {
            if (p.playerId === "p2") {
              return {
                ...p,
                handCards: [
                  { visibility: "HIDDEN", opaqueCardId: "op-different-99", faceUp: false },
                  { visibility: "HIDDEN", opaqueCardId: "op-different-88", faceUp: false },
                  { visibility: "HIDDEN", opaqueCardId: "op-different-77", faceUp: false },
                  { visibility: "HIDDEN", opaqueCardId: "op-different-66", faceUp: false },
                ],
              };
            }
            return p;
          }),
        },
      };

      const baseEnc = DecisionFeatureEncoder.encode(baseReq);
      const modEnc = DecisionFeatureEncoder.encode(modReq);
      expectNumericFeaturesEqual(baseEnc, modEnc);
    });

    it("1-2. 相手裏向き防壁の内部カード情報改変に対して特徴量が 100% 不変であること", () => {
      const baseReq = createBaseDecisionRequest();
      const modReq: DecisionRequest = {
        ...baseReq,
        observation: {
          ...baseReq.observation,
          players: baseReq.observation.players.map((p) => {
            if (p.playerId === "p2") {
              return {
                ...p,
                field: [
                  {
                    ...p.field[0],
                    // 裏向き防壁の内部カード（秘密）に仮にデータが注入されても特徴量は影響を受けない
                    cards: [
                      {
                        visibility: "HIDDEN",
                        opaqueCardId: "op-bulwark-secret-card",
                        faceUp: false,
                      } as any,
                    ],
                  },
                ],
              };
            }
            return p;
          }),
        },
      };

      const baseEnc = DecisionFeatureEncoder.encode(baseReq);
      const modEnc = DecisionFeatureEncoder.encode(modReq);
      expectNumericFeaturesEqual(baseEnc, modEnc);
    });

    it("1-3. 相手裏向きユニット（切札含む）の非公開カード改変 (opaqueCardId変更) に対して特徴量が 100% 不変であること", () => {
      const baseReq = createBaseDecisionRequest();
      const modReq: DecisionRequest = {
        ...baseReq,
        observation: {
          ...baseReq.observation,
          players: baseReq.observation.players.map((p) => {
            if (p.playerId === "p2") {
              return {
                ...p,
                field: [
                  {
                    ...p.field[0],
                    cards: [
                      {
                        visibility: "HIDDEN",
                        opaqueCardId: "op-completely-different-facedown",
                        faceUp: false,
                      },
                    ],
                  },
                ],
              };
            }
            return p;
          }),
        },
      };

      const baseEnc = DecisionFeatureEncoder.encode(baseReq);
      const modEnc = DecisionFeatureEncoder.encode(modReq);
      expectNumericFeaturesEqual(baseEnc, modEnc);
    });

    it("1-4. 未開封パックの中身改変 (canViewCards: false) に対して特徴量が 100% 不変であること", () => {
      const baseReq = createBaseDecisionRequest();
      const modReq: DecisionRequest = {
        ...baseReq,
        observation: {
          ...baseReq.observation,
          players: baseReq.observation.players.map((p) => {
            if (p.playerId === "p1") {
              return {
                ...p,
                pack: {
                  ...p.pack!,
                  // canViewCards: false のため、cards に何が入っていても（あるいは入っていなくても）エンコードは不変
                  cards: [
                    {
                      visibility: "KNOWN",
                      cardInstanceId: "c-leak-1",
                      suit: "spade",
                      rank: "K",
                      value: 13,
                      faceUp: true,
                    } as any,
                  ],
                },
              };
            }
            return p;
          }),
        },
      };

      const baseEnc = DecisionFeatureEncoder.encode(baseReq);
      const modEnc = DecisionFeatureEncoder.encode(modReq);
      expectNumericFeaturesEqual(baseEnc, modEnc);
    });

    it("1-5. 相手 Life 10枚以上時 (lifeCount: undefined) の秘密保持: 内部枚数変更に対して特徴量が 100% 不変であること", () => {
      const baseReq = createBaseDecisionRequest();
      const modReq: DecisionRequest = {
        ...baseReq,
        observation: {
          ...baseReq.observation,
          players: baseReq.observation.players.map((p) => {
            if (p.playerId === "p2") {
              return {
                ...p,
                lifeDisplay: "10以上",
                lifeCount: undefined,
              };
            }
            return p;
          }),
        },
      };

      const baseEnc = DecisionFeatureEncoder.encode(baseReq);
      const modEnc = DecisionFeatureEncoder.encode(modReq);
      expectNumericFeaturesEqual(baseEnc, modEnc);

      const ctx = baseEnc.context.values;
      const knownIdx = CONTEXT_FEATURE_NAMES.indexOf("opponent_life_known");
      const is10PlusIdx = CONTEXT_FEATURE_NAMES.indexOf("opponent_life_is_10plus");
      const visibleCountIdx = CONTEXT_FEATURE_NAMES.indexOf("opponent_life_visible_count");

      expect(ctx[knownIdx]).toBe(0);
      expect(ctx[is10PlusIdx]).toBe(1);
      expect(ctx[visibleCountIdx]).toBe(0);
    });
  });

  describe("2. Positive Controls (Section 28)", () => {
    it("2-1. 自分の手札カード数値を変更した場合、関連する手札特徴量 (value_sum, value_max) が正しく変化すること", () => {
      const baseReq = createBaseDecisionRequest();
      const modReq: DecisionRequest = {
        ...baseReq,
        observation: {
          ...baseReq.observation,
          players: baseReq.observation.players.map((p) => {
            if (p.playerId === "p1") {
              return {
                ...p,
                handCards: [
                  {
                    visibility: "KNOWN",
                    cardInstanceId: "c-p1-1",
                    suit: "spade",
                    rank: "A",
                    value: 1,
                    faceUp: true,
                  },
                  {
                    visibility: "KNOWN",
                    cardInstanceId: "c-p1-2",
                    suit: "diamond",
                    rank: "A", // 10 -> 1 に変更
                    value: 1,
                    faceUp: true,
                  },
                  {
                    visibility: "KNOWN",
                    cardInstanceId: "c-p1-3",
                    suit: "heart",
                    rank: "K",
                    value: 13,
                    faceUp: true,
                  },
                ],
              };
            }
            return p;
          }),
        },
      };

      const baseEnc = DecisionFeatureEncoder.encode(baseReq);
      const modEnc = DecisionFeatureEncoder.encode(modReq);

      const sumIdx = CONTEXT_FEATURE_NAMES.indexOf("self_hand_value_sum");
      const pairIdx = CONTEXT_FEATURE_NAMES.indexOf("self_hand_pair_rank_count");

      // base: 1 + 10 + 13 = 24, mod: 1 + 1 + 13 = 15
      expect(baseEnc.context.values[sumIdx]).toBe(24);
      expect(modEnc.context.values[sumIdx]).toBe(15);

      // mod では A が2枚あるため pair_rank_count が 1
      expect(baseEnc.context.values[pairIdx]).toBe(0);
      expect(modEnc.context.values[pairIdx]).toBe(1);
    });

    it("2-2. 自分のフィールドユニットサイズを変更した場合、field_size_sum が正しく変化すること", () => {
      const baseReq = createBaseDecisionRequest();
      const modReq: DecisionRequest = {
        ...baseReq,
        observation: {
          ...baseReq.observation,
          players: baseReq.observation.players.map((p) => {
            if (p.playerId === "p1") {
              return {
                ...p,
                field: [
                  {
                    ...p.field[0],
                    currentSize: 8, // 5 -> 8
                  },
                ],
              };
            }
            return p;
          }),
        },
      };

      const baseEnc = DecisionFeatureEncoder.encode(baseReq);
      const modEnc = DecisionFeatureEncoder.encode(modReq);

      const sizeSumIdx = CONTEXT_FEATURE_NAMES.indexOf("self_field_size_sum");
      const relSizeIdx = CONTEXT_FEATURE_NAMES.indexOf("relative_field_size_sum");

      expect(baseEnc.context.values[sizeSumIdx]).toBe(5);
      expect(modEnc.context.values[sizeSumIdx]).toBe(8);

      // relative = self(8) - opp(3) = 5
      expect(baseEnc.context.values[relSizeIdx]).toBe(5 - 3);
      expect(modEnc.context.values[relSizeIdx]).toBe(8 - 3);
    });

    it("2-3. 自分のパックが開封されて閲覧可能 (canViewCards: true) になった場合、パック統計特徴量が正しく変化すること", () => {
      const baseReq = createBaseDecisionRequest();
      const modReq: DecisionRequest = {
        ...baseReq,
        observation: {
          ...baseReq.observation,
          players: baseReq.observation.players.map((p) => {
            if (p.playerId === "p1") {
              return {
                ...p,
                pack: {
                  count: 2,
                  opened: true,
                  canViewCards: true,
                  cards: [
                    {
                      visibility: "KNOWN",
                      cardInstanceId: "c-pack-1",
                      suit: "spade",
                      rank: "10",
                      value: 10,
                      faceUp: true,
                    },
                    {
                      visibility: "KNOWN",
                      cardInstanceId: "c-pack-2",
                      suit: "heart",
                      rank: "8",
                      value: 8,
                      faceUp: true,
                    },
                  ],
                },
              };
            }
            return p;
          }),
        },
      };

      const baseEnc = DecisionFeatureEncoder.encode(baseReq);
      const modEnc = DecisionFeatureEncoder.encode(modReq);

      const openedIdx = CONTEXT_FEATURE_NAMES.indexOf("self_pack_opened");
      const canViewIdx = CONTEXT_FEATURE_NAMES.indexOf("self_pack_can_view_cards");
      const knownCountIdx = CONTEXT_FEATURE_NAMES.indexOf("self_pack_known_card_count");
      const valSumIdx = CONTEXT_FEATURE_NAMES.indexOf("self_pack_known_value_sum");

      expect(baseEnc.context.values[openedIdx]).toBe(0);
      expect(baseEnc.context.values[canViewIdx]).toBe(0);
      expect(baseEnc.context.values[knownCountIdx]).toBe(0);
      expect(baseEnc.context.values[valSumIdx]).toBe(0);

      expect(modEnc.context.values[openedIdx]).toBe(1);
      expect(modEnc.context.values[canViewIdx]).toBe(1);
      expect(modEnc.context.values[knownCountIdx]).toBe(2);
      expect(modEnc.context.values[valSumIdx]).toBe(18);
    });

    it("2-4. turnCount がインクリメントされた場合、turn_count 特徴量が正しく反映されること", () => {
      const baseReq = createBaseDecisionRequest();
      const modReq: DecisionRequest = {
        ...baseReq,
        observation: {
          ...baseReq.observation,
          turnCount: 7, // 3 -> 7
        },
      };

      const baseEnc = DecisionFeatureEncoder.encode(baseReq);
      const modEnc = DecisionFeatureEncoder.encode(modReq);

      const tcIdx = CONTEXT_FEATURE_NAMES.indexOf("turn_count");
      expect(baseEnc.context.values[tcIdx]).toBe(3);
      expect(modEnc.context.values[tcIdx]).toBe(7);
    });

    it("2-5. ターンプレイヤーが交代した場合、self_is_turn_player と opponent_is_turn_player が反転すること", () => {
      const baseReq = createBaseDecisionRequest();
      const modReq: DecisionRequest = {
        ...baseReq,
        observation: {
          ...baseReq.observation,
          turnPlayerId: "p2",
        },
      };

      const baseEnc = DecisionFeatureEncoder.encode(baseReq);
      const modEnc = DecisionFeatureEncoder.encode(modReq);

      const selfTurnIdx = CONTEXT_FEATURE_NAMES.indexOf("self_is_turn_player");
      const oppTurnIdx = CONTEXT_FEATURE_NAMES.indexOf("opponent_is_turn_player");

      expect(baseEnc.context.values[selfTurnIdx]).toBe(1);
      expect(baseEnc.context.values[oppTurnIdx]).toBe(0);

      expect(modEnc.context.values[selfTurnIdx]).toBe(0);
      expect(modEnc.context.values[oppTurnIdx]).toBe(1);
    });
  });
});
