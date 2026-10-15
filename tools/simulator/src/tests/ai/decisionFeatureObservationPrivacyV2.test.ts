import { describe, it, expect } from "vitest";
import { ObservationFactory } from "../../engine/decision/ObservationFactory";
import { DecisionFeatureEncoder } from "../../engine/ai/DecisionFeatureEncoder";
import { DecisionRequest } from "../../domain/decision/DecisionRequest";
import {
  CONTEXT_FEATURE_NAMES,
  PATTERN_FEATURE_NAMES,
  EncodedDecisionFeatures,
} from "../../domain/ai/DecisionFeatureTypes";

describe("Decision Feature Schema v2 - End-to-End GameState Observation Privacy Boundary (R1)", () => {
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

  /**
   * 実 GameState の最小構造ファクトリ
   */
  const createBaseGameState = () => {
    return {
      matchId: "match-obs-priv-001",
      stateVersion: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      turnCount: 2,
      players: {
        p1: {
          name: "Alice",
          life: [
            { id: "l1-1", suit: "S", rank: "A", value: 1 },
            { id: "l1-2", suit: "H", rank: "2", value: 2 },
            { id: "l1-3", suit: "D", rank: "3", value: 3 },
          ],
          hand: [
            { id: "h1-1", suit: "S", rank: "10", value: 10 },
            { id: "h1-2", suit: "H", rank: "K", value: 13 },
          ],
          field: [
            {
              unitId: "u-p1-1",
              kind: "soldier",
              componentId: "character.soldier",
              state: "drive",
              face: "up",
              cards: [{ id: "c1-1", suit: "S", rank: "4", value: 4 }],
              labels: [],
            },
          ],
          fog: [],
          trump: [],
          grave: [],
          pack: {
            count: 3,
            opened: false,
            cards: [
              { id: "pack1-1", suit: "C", rank: "5", value: 5 },
              { id: "pack1-2", suit: "D", rank: "6", value: 6 },
              { id: "pack1-3", suit: "H", rank: "7", value: 7 },
            ],
          },
          rareCards: [],
        },
        p2: {
          name: "Bob",
          life: [
            { id: "l2-1", suit: "S", rank: "5", value: 5 },
            { id: "l2-2", suit: "H", rank: "6", value: 6 },
          ],
          hand: [
            { id: "h2-1", suit: "D", rank: "8", value: 8 },
            { id: "h2-2", suit: "C", rank: "9", value: 9 },
          ],
          field: [
            {
              unitId: "bw-p2-1",
              kind: "防壁",
              componentId: "character.bulwark",
              state: "charge",
              face: "down",
              cards: [{ id: "c2-1", suit: "H", rank: "7", value: 7 }],
              labels: ["防御"],
            },
          ],
          fog: [
            {
              fogId: "fog-p2-1",
              componentId: "character.fog",
              card: { id: "fog-c1", suit: "S", rank: "2", value: 2 },
              bindings: { target: "bw-p2-1", amount: 1 },
            },
          ],
          trump: [
            {
              unitId: "trump-p2-1",
              kind: "trump",
              componentId: "character.trump",
              state: "charge",
              face: "down",
              cards: [{ id: "trump-c1", suit: "D", rank: "K", value: 13 }],
              labels: [],
            },
          ],
          grave: [],
          pack: {
            count: 4,
            opened: false,
            cards: [
              { id: "pack2-1", suit: "H", rank: "A", value: 1 },
              { id: "pack2-2", suit: "S", rank: "K", value: 13 },
            ],
          },
          rareCards: [],
        },
      },
      stage: { requests: [] },
      requestBuffer: { requests: [], history: [] },
    };
  };

  const createDecisionRequestFromGameState = (
    state: any,
    viewerId: "p1" | "p2" = "p1"
  ): DecisionRequest => {
    const observation = ObservationFactory.createObservation(state, viewerId);
    return {
      protocolVersion: "1.0.0",
      matchId: state.matchId,
      decisionId: "dec-obs-test-001",
      stateVersion: state.stateVersion,
      playerId: viewerId,
      source: {
        type: "ACTION_REQUEST",
        playerId: viewerId,
      },
      observation,
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
            cardIds: ["h1-1"],
            displayCodes: ["S-10"],
          },
        ],
        unitSelections: [
          {
            unitIds: ["u-p1-1"],
            displayNames: ["兵士"],
          },
        ],
        costPayments: [
          {
            discardedCardIds: ["h1-1"],
            drivenBulwarkUnitIds: [],
            sacrificedUnitIds: [],
            lifeCount: 0,
          },
        ],
        targetSelections: [
          {
            targetType: "unit",
            targetUnitId: "bw-p2-1",
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
          patternId: "pat-attack",
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

  describe("1. Real GameState -> ObservationFactory -> Encoder Privacy Invariances", () => {
    it("1-1. [Opponent Hand Privacy] 実 GameState 上の相手手札カード中身を変更しても Observation は HIDDEN 化され、特徴量が 100% 不変であること", () => {
      const stateA = createBaseGameState();
      const stateB = createBaseGameState();

      // State B では相手(p2)の手札中身（suit/rank/value/id）を完全に別カードへ改変（枚数2枚は同一）
      stateB.players.p2.hand = [
        { id: "h2-alt-1", suit: "S", rank: "A", value: 1 },
        { id: "h2-alt-2", suit: "H", rank: "4", value: 4 },
      ];

      const obsA = ObservationFactory.createObservation(stateA, "p1");
      const obsB = ObservationFactory.createObservation(stateB, "p1");

      const p2ObsA = obsA.players.find((p) => p.playerId === "p2")!;
      const p2ObsB = obsB.players.find((p) => p.playerId === "p2")!;

      // 観測レベルの検証: 手札枚数は一致し、全カードが HIDDEN
      expect(p2ObsA.handCount).toBe(2);
      expect(p2ObsB.handCount).toBe(2);
      expect(p2ObsA.handCards.every((c) => c.visibility === "HIDDEN")).toBe(true);
      expect(p2ObsB.handCards.every((c) => c.visibility === "HIDDEN")).toBe(true);

      const reqA = createDecisionRequestFromGameState(stateA, "p1");
      const reqB = createDecisionRequestFromGameState(stateB, "p1");

      const encA = DecisionFeatureEncoder.encode(reqA);
      const encB = DecisionFeatureEncoder.encode(reqB);

      expectNumericFeaturesEqual(encA, encB);
    });

    it("1-2. [Opponent Facedown Field/Bulwark Privacy] 実 GameState 上の相手裏向き防壁の内部カードを変更しても、特徴量が 100% 不変であること", () => {
      const stateA = createBaseGameState();
      const stateB = createBaseGameState();

      // State B では相手裏向き防壁の内部カードを変更
      stateB.players.p2.field[0].cards = [
        { id: "c2-alt-1", suit: "S", rank: "K", value: 13 },
      ];

      const obsA = ObservationFactory.createObservation(stateA, "p1");
      const obsB = ObservationFactory.createObservation(stateB, "p1");

      const bwA = obsA.players.find((p) => p.playerId === "p2")!.field[0];
      const bwB = obsB.players.find((p) => p.playerId === "p2")!.field[0];

      expect(bwA.face).toBe("down");
      expect(bwB.face).toBe("down");
      expect(bwA.cards[0].visibility).toBe("HIDDEN");
      expect(bwB.cards[0].visibility).toBe("HIDDEN");
      expect(bwA.currentSize).toBeUndefined();
      expect(bwB.currentSize).toBeUndefined();

      const reqA = createDecisionRequestFromGameState(stateA, "p1");
      const reqB = createDecisionRequestFromGameState(stateB, "p1");

      const encA = DecisionFeatureEncoder.encode(reqA);
      const encB = DecisionFeatureEncoder.encode(reqB);

      expectNumericFeaturesEqual(encA, encB);
    });

    it("1-3. [Opponent Facedown Trump Privacy - BLOCKER] 実 GameState 上の相手裏向き切札の秘密カードを変更しても currentSize が漏洩せず、特徴量が 100% 不変であること", () => {
      const stateA = createBaseGameState();
      const stateB = createBaseGameState();

      // State A: ランク K (value 13)
      // State B: ランク 2 (value 2)
      stateB.players.p2.trump[0].cards = [
        { id: "trump-c-alt", suit: "C", rank: "2", value: 2 },
      ];

      const obsA = ObservationFactory.createObservation(stateA, "p1");
      const obsB = ObservationFactory.createObservation(stateB, "p1");

      const trumpA = obsA.players.find((p) => p.playerId === "p2")!.trumps![0];
      const trumpB = obsB.players.find((p) => p.playerId === "p2")!.trumps![0];

      expect(trumpA.face).toBe("down");
      expect(trumpB.face).toBe("down");
      expect(trumpA.cards[0].visibility).toBe("HIDDEN");
      expect(trumpB.cards[0].visibility).toBe("HIDDEN");

      // 最重要: 相手の伏せ切札の currentSize は秘密 identity に依存して公開されてはならない（undefined）
      expect(trumpA.currentSize).toBeUndefined();
      expect(trumpB.currentSize).toBeUndefined();

      const reqA = createDecisionRequestFromGameState(stateA, "p1");
      const reqB = createDecisionRequestFromGameState(stateB, "p1");

      const encA = DecisionFeatureEncoder.encode(reqA);
      const encB = DecisionFeatureEncoder.encode(reqB);

      expectNumericFeaturesEqual(encA, encB);
    });

    it("1-4. [Opponent Life 10+ Privacy] 実 GameState 上で相手ライフが 11 枚 vs 15 枚でも、Observation は双方 10以上 となり特徴量が 100% 不変であること", () => {
      const stateA = createBaseGameState();
      const stateB = createBaseGameState();

      // State A: 11 枚
      stateA.players.p2.life = new Array(11).fill(null).map((_, i) => ({
        id: `l2-11-${i}`,
        suit: "S",
        rank: "A",
        value: 1,
      }));

      // State B: 15 枚
      stateB.players.p2.life = new Array(15).fill(null).map((_, i) => ({
        id: `l2-15-${i}`,
        suit: "H",
        rank: "K",
        value: 13,
      }));

      const obsA = ObservationFactory.createObservation(stateA, "p1");
      const obsB = ObservationFactory.createObservation(stateB, "p1");

      const p2A = obsA.players.find((p) => p.playerId === "p2")!;
      const p2B = obsB.players.find((p) => p.playerId === "p2")!;

      expect(p2A.lifeCount).toBeUndefined();
      expect(p2A.lifeDisplay).toBe("10以上");
      expect(p2B.lifeCount).toBeUndefined();
      expect(p2B.lifeDisplay).toBe("10以上");

      const reqA = createDecisionRequestFromGameState(stateA, "p1");
      const reqB = createDecisionRequestFromGameState(stateB, "p1");

      const encA = DecisionFeatureEncoder.encode(reqA);
      const encB = DecisionFeatureEncoder.encode(reqB);

      const ctxA = encA.context.values;
      const ctxB = encB.context.values;

      const knownIdx = CONTEXT_FEATURE_NAMES.indexOf("opponent_life_known");
      const is10PlusIdx = CONTEXT_FEATURE_NAMES.indexOf("opponent_life_is_10plus");
      const visibleCountIdx = CONTEXT_FEATURE_NAMES.indexOf("opponent_life_visible_count");
      const relKnownIdx = CONTEXT_FEATURE_NAMES.indexOf("relative_life_known");
      const relCountIdx = CONTEXT_FEATURE_NAMES.indexOf("relative_life_count");

      expect(ctxA[knownIdx]).toBe(0);
      expect(ctxB[knownIdx]).toBe(0);
      expect(ctxA[is10PlusIdx]).toBe(1);
      expect(ctxB[is10PlusIdx]).toBe(1);
      expect(ctxA[visibleCountIdx]).toBe(0);
      expect(ctxB[visibleCountIdx]).toBe(0);
      expect(ctxA[relKnownIdx]).toBe(0);
      expect(ctxB[relKnownIdx]).toBe(0);
      expect(ctxA[relCountIdx]).toBe(0);
      expect(ctxB[relCountIdx]).toBe(0);

      expectNumericFeaturesEqual(encA, encB);
    });

    it("1-5. [Unopened Pack Privacy] 実 GameState 上で未開封パック (opened: false) の中身カードを変更しても、特徴量が 100% 不変であること", () => {
      const stateA = createBaseGameState();
      const stateB = createBaseGameState();

      // State B: パック内部カードを変更 (どちらも count は 4, opened は false)
      stateB.players.p2.pack.cards = [
        { id: "pack-alt-1", suit: "D", rank: "3", value: 3 },
        { id: "pack-alt-2", suit: "C", rank: "4", value: 4 },
      ];

      const obsA = ObservationFactory.createObservation(stateA, "p1");
      const obsB = ObservationFactory.createObservation(stateB, "p1");

      const packA = obsA.players.find((p) => p.playerId === "p2")!.pack!;
      const packB = obsB.players.find((p) => p.playerId === "p2")!.pack!;

      expect(packA.opened).toBe(false);
      expect(packB.opened).toBe(false);
      expect(packA.canViewCards).toBe(false);
      expect(packB.canViewCards).toBe(false);
      expect(packA.cards).toEqual([]);
      expect(packB.cards).toEqual([]);

      const reqA = createDecisionRequestFromGameState(stateA, "p1");
      const reqB = createDecisionRequestFromGameState(stateB, "p1");

      const encA = DecisionFeatureEncoder.encode(reqA);
      const encB = DecisionFeatureEncoder.encode(reqB);

      expectNumericFeaturesEqual(encA, encB);
    });

    it("1-6. [Fog Transparency Contract] ObservationFactory 契約上、Fog は全フォグ公開情報 (card が KNOWN) として扱われること", () => {
      const state = createBaseGameState();
      const obs = ObservationFactory.createObservation(state, "p1");

      const p2Fog = obs.players.find((p) => p.playerId === "p2")!.fog!;
      expect(p2Fog.length).toBe(1);
      // 実装契約の確認: Fog は対戦相手のものであってもカード情報が公開される
      expect(p2Fog[0].card).toBeDefined();
      expect(p2Fog[0].card!.visibility).toBe("KNOWN");
    });
  });

  describe("2. Positive Controls (Real GameState Modification)", () => {
    it("2-1. 自分の手札数値を変更した場合、self_hand_value_sum が正しく変化すること", () => {
      const stateA = createBaseGameState();
      const stateB = createBaseGameState();

      // p1 の手札: 10 + 13 = 23 -> 1 + 1 = 2 に変更
      stateB.players.p1.hand = [
        { id: "h1-1", suit: "S", rank: "A", value: 1 },
        { id: "h1-2", suit: "H", rank: "A", value: 1 },
      ];

      const reqA = createDecisionRequestFromGameState(stateA, "p1");
      const reqB = createDecisionRequestFromGameState(stateB, "p1");

      const encA = DecisionFeatureEncoder.encode(reqA);
      const encB = DecisionFeatureEncoder.encode(reqB);

      const sumIdx = CONTEXT_FEATURE_NAMES.indexOf("self_hand_value_sum");
      const pairIdx = CONTEXT_FEATURE_NAMES.indexOf("self_hand_pair_rank_count");

      // self_hand_value_sum: scale 30 => x / (x + 30)
      expect(encA.context.values[sumIdx]).toBeCloseTo(23 / 53, 5);
      expect(encB.context.values[sumIdx]).toBeCloseTo(2 / 32, 5);

      // self_hand_pair_rank_count: scale 4 => x / (x + 4)
      expect(encA.context.values[pairIdx]).toBe(0);
      expect(encB.context.values[pairIdx]).toBeCloseTo(1 / 5, 5);
    });

    it("2-2. 相手の手札枚数を変更した場合、opponent_hand_count と relative_hand_count が正しく変化すること", () => {
      const stateA = createBaseGameState();
      const stateB = createBaseGameState();

      // p2 手札: 2枚 -> 4枚
      stateB.players.p2.hand.push(
        { id: "h2-3", suit: "S", rank: "3", value: 3 },
        { id: "h2-4", suit: "D", rank: "4", value: 4 }
      );

      const reqA = createDecisionRequestFromGameState(stateA, "p1");
      const reqB = createDecisionRequestFromGameState(stateB, "p1");

      const encA = DecisionFeatureEncoder.encode(reqA);
      const encB = DecisionFeatureEncoder.encode(reqB);

      const oppHandIdx = CONTEXT_FEATURE_NAMES.indexOf("opponent_hand_count");
      const relHandIdx = CONTEXT_FEATURE_NAMES.indexOf("relative_hand_count");

      // opponent_hand_count: scale 10 => x / (x + 10)
      expect(encA.context.values[oppHandIdx]).toBeCloseTo(2 / 12, 5);
      expect(encB.context.values[oppHandIdx]).toBeCloseTo(4 / 14, 5);

      // relative_hand_count: scale 10 signed => x / (|x| + 10)
      // self(2) - opp(2) = 0, self(2) - opp(4) = -2 -> -2 / (2 + 10) = -2/12 = -1/6
      expect(encA.context.values[relHandIdx]).toBe(0);
      expect(encB.context.values[relHandIdx]).toBeCloseTo(-2 / 12, 5);
    });

    it("2-3. turnCount を進めた場合、turn_count 特徴量が正しく変化すること", () => {
      const stateA = createBaseGameState();
      const stateB = createBaseGameState();

      stateB.turnCount = 5;

      const reqA = createDecisionRequestFromGameState(stateA, "p1");
      const reqB = createDecisionRequestFromGameState(stateB, "p1");

      const encA = DecisionFeatureEncoder.encode(reqA);
      const encB = DecisionFeatureEncoder.encode(reqB);

      const tcIdx = CONTEXT_FEATURE_NAMES.indexOf("turn_count");
      // turn_count: scale 10 => x / (x + 10)
      expect(encA.context.values[tcIdx]).toBeCloseTo(2 / 12, 5);
      expect(encB.context.values[tcIdx]).toBeCloseTo(5 / 15, 5);
    });

    it("2-4. 自分のパックが開封された場合 (opened: true)、self_pack_opened とパック統計が正しく変化すること", () => {
      const stateA = createBaseGameState();
      const stateB = createBaseGameState();

      stateB.players.p1.pack.opened = true;

      const reqA = createDecisionRequestFromGameState(stateA, "p1");
      const reqB = createDecisionRequestFromGameState(stateB, "p1");

      const encA = DecisionFeatureEncoder.encode(reqA);
      const encB = DecisionFeatureEncoder.encode(reqB);

      const openedIdx = CONTEXT_FEATURE_NAMES.indexOf("self_pack_opened");
      const canViewIdx = CONTEXT_FEATURE_NAMES.indexOf("self_pack_can_view_cards");
      const knownCountIdx = CONTEXT_FEATURE_NAMES.indexOf("self_pack_known_card_count");
      const valSumIdx = CONTEXT_FEATURE_NAMES.indexOf("self_pack_known_value_sum");

      expect(encA.context.values[openedIdx]).toBe(0);
      expect(encA.context.values[canViewIdx]).toBe(0);
      expect(encA.context.values[knownCountIdx]).toBe(0);

      expect(encB.context.values[openedIdx]).toBe(1);
      expect(encB.context.values[canViewIdx]).toBe(1);
      // knownCount: 3 -> 3 / (3 + 10) = 3 / 13
      expect(encB.context.values[knownCountIdx]).toBeCloseTo(3 / 13, 5);
      // 5 + 6 + 7 = 18 -> 18 / (18 + 30) = 18 / 48 = 3 / 8
      expect(encB.context.values[valSumIdx]).toBeCloseTo(18 / 48, 5);
    });
  });
});
