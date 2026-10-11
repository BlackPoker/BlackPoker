import { describe, it, expect } from "vitest";
import { ObservationFactory } from "../../engine/decision/ObservationFactory";
import { DecisionFeatureEncoder } from "../../engine/ai/DecisionFeatureEncoder";
import { CONTEXT_FEATURE_NAMES, FEATURE_SCHEMA_VERSION } from "../../domain/ai/DecisionFeatureTypes";
import { DecisionRequest } from "../../domain/decision/DecisionRequest";

describe("Request Target Context & Privacy Tests (Feature Schema v3)", () => {
  const getContextValue = (encoded: ReturnType<typeof DecisionFeatureEncoder.encode>, name: string): number => {
    const idx = CONTEXT_FEATURE_NAMES.indexOf(name as any);
    if (idx === -1) throw new Error(`Unknown context feature: ${name}`);
    return encoded.context.values[idx];
  };

  const createBaseDecisionRequest = (
    observation: any,
    sourceRequestRef: string,
    effectStepId: string = "resolveEffect"
  ): DecisionRequest => {
    return {
      protocolVersion: "1.0.0",
      matchId: "match-target-test",
      decisionId: "dec-target-1",
      stateVersion: 1,
      playerId: "p1",
      source: {
        type: "EFFECT_RESOLUTION",
        sourceRequestRef,
        effectStepId,
        playerId: "p1",
      },
      observation,
      catalog: {
        actions: [],
        cardSelections: [],
        unitSelections: [],
        costPayments: [],
        targetSelections: [],
        effectSelections: [
          {
            selectionType: "unit",
            selectedValues: [],
            summary: "パス",
          },
        ],
        orderSelections: [],
      },
      patterns: [
        {
          patternId: "pat-1",
          kind: "EFFECT_SELECTION",
          effectSelectionRef: 0,
        },
      ],
    };
  };

  // =========================================================================
  // 1. Positive Tests (Player, Unit, Request, None)
  // =========================================================================
  describe("1. Positive Target Context Tests", () => {
    it("encodes Player Target (Self: p1)", () => {
      const state: any = {
        stateVersion: 1,
        turnPlayer: "p1",
        chancePlayer: "p1",
        stage: {
          requests: [
            {
              id: "req-p1-target",
              actionId: "action.heal",
              controller: "p1",
              status: "resolving",
              sequence: 1,
              targets: [{ type: "player", targetPlayerKey: "p1" }],
            },
          ],
        },
        players: {
          p1: { hand: [], field: [], life: [], grave: [] },
          p2: { hand: [], field: [], life: [], grave: [] },
        },
      };

      const obs = ObservationFactory.createObservation(state, "p1");
      expect(obs.stageRequests[0].target).toBeDefined();
      expect(obs.stageRequests[0].target?.targetType).toBe("player");
      expect(obs.stageRequests[0].target?.targetPlayerKey).toBe("p1");

      const req = createBaseDecisionRequest(obs, "req-p1-target");
      const encoded = DecisionFeatureEncoder.encode(req);

      expect(getContextValue(encoded, "request_target_is_player")).toBe(1);
      expect(getContextValue(encoded, "request_target_is_self")).toBe(1);
      expect(getContextValue(encoded, "request_target_is_opponent")).toBe(0);
      expect(getContextValue(encoded, "request_target_is_unit")).toBe(0);
    });

    it("encodes Player Target (Opponent: p2)", () => {
      const state: any = {
        stateVersion: 1,
        turnPlayer: "p1",
        chancePlayer: "p1",
        stage: {
          requests: [
            {
              id: "req-p2-target",
              actionId: "action.directAttack",
              controller: "p1",
              status: "resolving",
              sequence: 1,
              targets: [{ type: "player", targetPlayerKey: "p2" }],
            },
          ],
        },
        players: {
          p1: { hand: [], field: [], life: [], grave: [] },
          p2: { hand: [], field: [], life: [], grave: [] },
        },
      };

      const obs = ObservationFactory.createObservation(state, "p1");
      const req = createBaseDecisionRequest(obs, "req-p2-target");
      const encoded = DecisionFeatureEncoder.encode(req);

      expect(getContextValue(encoded, "request_target_is_player")).toBe(1);
      expect(getContextValue(encoded, "request_target_is_self")).toBe(0);
      expect(getContextValue(encoded, "request_target_is_opponent")).toBe(1);
    });

    it("encodes Self Unit Target with visible size, state, and face", () => {
      const state: any = {
        stateVersion: 1,
        turnPlayer: "p1",
        chancePlayer: "p1",
        stage: {
          requests: [
            {
              id: "req-unit-self",
              actionId: "action.hardening",
              controller: "p1",
              status: "resolving",
              sequence: 1,
              targets: [{ type: "unit", unitId: "u-self-1" }],
            },
          ],
        },
        players: {
          p1: {
            hand: [],
            field: [
              {
                unitId: "u-self-1",
                kind: "一般兵",
                componentId: "character.soldier",
                state: "drive",
                face: "up",
                cards: [{ id: "c1", suit: "S", rank: "5", value: 5 }],
              },
            ],
            life: [],
            grave: [],
          },
          p2: { hand: [], field: [], life: [], grave: [] },
        },
      };

      const obs = ObservationFactory.createObservation(state, "p1");
      const req = createBaseDecisionRequest(obs, "req-unit-self");
      const encoded = DecisionFeatureEncoder.encode(req);

      expect(getContextValue(encoded, "request_target_is_unit")).toBe(1);
      expect(getContextValue(encoded, "request_target_is_self")).toBe(1);
      expect(getContextValue(encoded, "request_target_is_opponent")).toBe(0);
      expect(getContextValue(encoded, "request_target_unit_size")).toBe(5);
      expect(getContextValue(encoded, "request_target_unit_is_drive")).toBe(1);
      expect(getContextValue(encoded, "request_target_unit_is_charge")).toBe(0);
      expect(getContextValue(encoded, "request_target_unit_face_up")).toBe(1);
      expect(getContextValue(encoded, "request_target_unit_face_down")).toBe(0);
    });

    it("encodes Opponent Visible Unit Target", () => {
      const state: any = {
        stateVersion: 1,
        turnPlayer: "p1",
        chancePlayer: "p1",
        stage: {
          requests: [
            {
              id: "req-unit-opp",
              actionId: "action.deathLance",
              controller: "p1",
              status: "resolving",
              sequence: 1,
              targets: [{ type: "unit", unitId: "u-opp-1" }],
            },
          ],
        },
        players: {
          p1: { hand: [], field: [], life: [], grave: [] },
          p2: {
            hand: [],
            field: [
              {
                unitId: "u-opp-1",
                kind: "一般兵",
                componentId: "character.soldier",
                state: "charge",
                face: "up",
                cards: [{ id: "c2", suit: "H", rank: "8", value: 8 }],
              },
            ],
            life: [],
            grave: [],
          },
        },
      };

      const obs = ObservationFactory.createObservation(state, "p1");
      const req = createBaseDecisionRequest(obs, "req-unit-opp");
      const encoded = DecisionFeatureEncoder.encode(req);

      expect(getContextValue(encoded, "request_target_is_unit")).toBe(1);
      expect(getContextValue(encoded, "request_target_is_self")).toBe(0);
      expect(getContextValue(encoded, "request_target_is_opponent")).toBe(1);
      expect(getContextValue(encoded, "request_target_unit_size")).toBe(8);
      expect(getContextValue(encoded, "request_target_unit_is_charge")).toBe(1);
      expect(getContextValue(encoded, "request_target_unit_face_up")).toBe(1);
    });

    it("encodes Request Target (Counter / Twist target)", () => {
      const state: any = {
        stateVersion: 1,
        turnPlayer: "p1",
        chancePlayer: "p1",
        stage: {
          requests: [
            {
              id: "req-twist",
              actionId: "action.twist",
              controller: "p1",
              status: "resolving",
              sequence: 2,
              targets: [{ type: "request", requestId: "req-target-draw" }],
            },
            {
              id: "req-target-draw",
              actionId: "action.draw",
              controller: "p2",
              status: "pending",
              sequence: 1,
            },
          ],
        },
        players: {
          p1: { hand: [], field: [], life: [], grave: [] },
          p2: { hand: [], field: [], life: [], grave: [] },
        },
      };

      const obs = ObservationFactory.createObservation(state, "p1");
      const req = createBaseDecisionRequest(obs, "req-twist");
      const encoded = DecisionFeatureEncoder.encode(req);

      expect(getContextValue(encoded, "request_target_is_request")).toBe(1);
      expect(getContextValue(encoded, "request_target_is_unit")).toBe(0);
      expect(getContextValue(encoded, "request_target_is_player")).toBe(0);
    });

    it("encodes None Target when request has explicit none target", () => {
      const state: any = {
        stateVersion: 1,
        turnPlayer: "p1",
        chancePlayer: "p1",
        stage: {
          requests: [
            {
              id: "req-none",
              actionId: "action.pass",
              controller: "p1",
              status: "resolving",
              sequence: 1,
              targets: [{ type: "none" }],
            },
          ],
        },
        players: {
          p1: { hand: [], field: [], life: [], grave: [] },
          p2: { hand: [], field: [], life: [], grave: [] },
        },
      };

      const obs = ObservationFactory.createObservation(state, "p1");
      const req = createBaseDecisionRequest(obs, "req-none");
      const encoded = DecisionFeatureEncoder.encode(req);

      expect(getContextValue(encoded, "request_target_is_none")).toBe(1);
    });
  });

  // =========================================================================
  // 2. Target Privacy Tests
  // =========================================================================
  describe("2. Target Privacy Tests (Opponent Facedown Unit Target)", () => {
    it("produces identical Context Features regardless of opponent facedown unit secret cards", () => {
      const createState = (secretCard: any) => ({
        stateVersion: 1,
        turnPlayer: "p1",
        chancePlayer: "p1",
        stage: {
          requests: [
            {
              id: "req-facedown-target",
              actionId: "action.destroyBulwark",
              controller: "p1",
              status: "resolving",
              sequence: 1,
              targets: [{ type: "unit", unitId: "u-opp-down" }],
            },
          ],
        },
        players: {
          p1: { hand: [], field: [], life: [], grave: [] },
          p2: {
            hand: [],
            field: [
              {
                unitId: "u-opp-down",
                kind: "防壁",
                componentId: "character.bulwark",
                state: "charge",
                face: "down",
                cards: [secretCard],
              },
            ],
            life: [],
            grave: [],
          },
        },
      });

      // State A: 秘密カードが ♠A (Value 1)
      const stateA = createState({ id: "c-secret-A", suit: "S", rank: "A", value: 1 });
      // State B: 秘密カードが ♥K (Value 13)
      const stateB = createState({ id: "c-secret-B", suit: "H", rank: "K", value: 13 });

      const obsA = ObservationFactory.createObservation(stateA, "p1");
      const obsB = ObservationFactory.createObservation(stateB, "p1");

      // ObservationFactory が裏向きユニットのカードを HIDDEN にし、currentSize を undefined にしていることを検証
      const oppUnitA = obsA.players.find((p) => p.playerId === "p2")?.field[0];
      const oppUnitB = obsB.players.find((p) => p.playerId === "p2")?.field[0];
      expect(oppUnitA?.face).toBe("down");
      expect(oppUnitA?.currentSize).toBeUndefined();
      expect(oppUnitB?.currentSize).toBeUndefined();

      const reqA = createBaseDecisionRequest(obsA, "req-facedown-target");
      const reqB = createBaseDecisionRequest(obsB, "req-facedown-target");

      const encA = DecisionFeatureEncoder.encode(reqA);
      const encB = DecisionFeatureEncoder.encode(reqB);

      // Context Features 上、ターゲットが相手の伏せユニットであることは公知情報として把握
      expect(getContextValue(encA, "request_target_is_unit")).toBe(1);
      expect(getContextValue(encA, "request_target_is_opponent")).toBe(1);
      expect(getContextValue(encA, "request_target_unit_face_down")).toBe(1);
      expect(getContextValue(encA, "request_target_unit_face_up")).toBe(0);
      // しかし非公開サイズや秘密カード値は絶対に漏洩しない (0)
      expect(getContextValue(encA, "request_target_unit_size")).toBe(0);

      // State A と State B の全 Context 特徴量が 100% 完全一致
      expect(encA.context.values).toEqual(encB.context.values);
    });
  });
});
