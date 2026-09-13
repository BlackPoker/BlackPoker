import { describe, it, expect } from "vitest";
import { BattleRelationPresenter } from "../../ui/game/BattleRelationPresenter";
import { StageTargetPresenter } from "../../ui/game/StageTargetPresenter";
import { formatCostPaymentDisplay } from "../../ui/decision/DecisionPanel";
import { PlayerObservationPresenter } from "../../ui/game/PlayerObservationPresenter";
import { ObservationFactory } from "../../engine/decision/ObservationFactory";
import { DecisionRequest } from "../../domain/decision/DecisionRequest";
import type { ActionRequest } from "../../domain/rules/RulePackage";

describe("UI Phase 3.2: Perspective & Battlefield Clarity Tests", () => {
  // 1. Perspective Precedence (Human vs Human & Human vs AI)
  describe("1. Perspective Resolution Precedence", () => {
    function resolvePerspective(
      matchMode: "humanVsAi" | "humanVsHuman",
      activeHumanSeat: "p1" | "p2",
      currentStep: any,
      gameState: any
    ): { bottomPlayerKey: "p1" | "p2"; topPlayerKey: "p1" | "p2" } {
      const bottomPlayerKey =
        matchMode === "humanVsAi"
          ? activeHumanSeat
          : (currentStep?.type === "WAITING_FOR_DECISION" && currentStep.request?.playerId
              ? currentStep.request.playerId
              : (gameState?.chancePlayer || gameState?.turnPlayer || "p1"));
      const topPlayerKey = bottomPlayerKey === "p1" ? "p2" : "p1";
      return { bottomPlayerKey, topPlayerKey };
    }

    it("Human vs AI always anchors activeHumanSeat to bottom", () => {
      const step = { type: "WAITING_FOR_DECISION", request: { playerId: "p2" } };
      const state = { chancePlayer: "p2", turnPlayer: "p2" };

      // humanSeat: p1
      const resP1 = resolvePerspective("humanVsAi", "p1", step, state);
      expect(resP1.bottomPlayerKey).toBe("p1");
      expect(resP1.topPlayerKey).toBe("p2");

      // humanSeat: p2
      const resP2 = resolvePerspective("humanVsAi", "p2", { type: "WAITING_FOR_DECISION", request: { playerId: "p1" } }, { chancePlayer: "p1" });
      expect(resP2.bottomPlayerKey).toBe("p2");
      expect(resP2.topPlayerKey).toBe("p1");
    });

    it("Human vs Human Priority 1: Pending DecisionRequest.playerId", () => {
      const step = { type: "WAITING_FOR_DECISION", request: { playerId: "p2" } };
      const state = { chancePlayer: "p1", turnPlayer: "p1" };

      const res = resolvePerspective("humanVsHuman", "p1", step, state);
      expect(res.bottomPlayerKey).toBe("p2");
      expect(res.topPlayerKey).toBe("p1");
    });

    it("Human vs Human Priority 2: gameState.chancePlayer when no decision request", () => {
      const step = null;
      const state = { chancePlayer: "p2", turnPlayer: "p1" };

      const res = resolvePerspective("humanVsHuman", "p1", step, state);
      expect(res.bottomPlayerKey).toBe("p2");
      expect(res.topPlayerKey).toBe("p1");
    });

    it("Human vs Human Priority 3: gameState.turnPlayer when no decision request and no chance player", () => {
      const step = null;
      const state = { turnPlayer: "p2" };

      const res = resolvePerspective("humanVsHuman", "p1", step, state);
      expect(res.bottomPlayerKey).toBe("p2");
      expect(res.topPlayerKey).toBe("p1");
    });

    it("Human vs Human Fallback: p1 when no state info", () => {
      const res = resolvePerspective("humanVsHuman", "p1", null, null);
      expect(res.bottomPlayerKey).toBe("p1");
      expect(res.topPlayerKey).toBe("p2");
    });
  });

  // 2. Opponent Hand & Grave Presentation
  describe("2. Opponent Hand & Grave Information Filtering", () => {
    const mockState = {
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          hand: [{ id: "c1", suit: "S", rank: "A", value: 14, faceUp: true }],
          field: [],
          grave: [{ id: "g1", suit: "H", rank: "10", value: 10 }],
          life: 15,
        },
        p2: {
          hand: [
            { id: "c2", suit: "H", rank: "K", value: 13, faceUp: false },
            { id: "c3", suit: "C", rank: "2", value: 2, faceUp: false },
          ],
          field: [],
          grave: [
            { id: "g2", suit: "C", rank: "4", value: 4 },
            { id: "g3", suit: "D", rank: "8", value: 8 }, // top card
          ],
          life: 12,
        },
      },
    };

    it("produces Observation where viewer (p1) sees opponent (p2) hand masked and grave top card known", () => {
      const p1Obs = ObservationFactory.createObservation(mockState, "p1");
      const p2View = p1Obs.players.find((p) => p.playerId === "p2")!;

      expect(p2View.isViewer).toBe(false);
      expect(p2View.handCount).toBe(2);
      // Hand cards are HIDDEN
      expect(p2View.handCards.every((c) => c.visibility === "HIDDEN")).toBe(true);

      // Grave has top card known
      expect(p2View.graveCount).toBe(2);
      expect(p2View.graveTopCard).toBeDefined();
      expect((p2View.graveTopCard as any).suit).toBe("D");
      expect((p2View.graveTopCard as any).rank).toBe("8");
      expect(p2View.canViewFullGrave).toBe(false);
    });

    it("PlayerObservationPresenter accurately maps opponent ViewModel", () => {
      const p1Obs = ObservationFactory.createObservation(mockState, "p1");
      const p2ViewModel = PlayerObservationPresenter.buildPlayerViewModel("p2", p1Obs, mockState, "p1");

      expect(p2ViewModel.isViewer).toBe(false);
      expect(p2ViewModel.handCount).toBe(2);
      expect(p2ViewModel.graveCount).toBe(2);
      expect(p2ViewModel.graveTopCard).toBeDefined();
      expect(p2ViewModel.graveTopCard.suit).toBe("D");
      expect(p2ViewModel.graveTopCard.rank).toBe("8");
      expect(p2ViewModel.canViewFullGrave).toBe(false);
    });
  });

  // 3. Per-Player Unique Target Numbering & Bulwark Position
  describe("3. Per-Player Unique Target Numbering & Bulwark Position", () => {
    const fieldState = {
      players: {
        p1: {
          field: [
            { unitId: "u-p1-s1", kind: "一般兵", face: "up", cards: [{ suit: "S", rank: "6" }] },
            { unitId: "u-p1-s2", kind: "一般兵", face: "up", cards: [{ suit: "H", rank: "9" }] },
            { unitId: "u-p1-b1", kind: "防壁", componentId: "character.bulwark", face: "down", cards: [{ suit: "S", rank: "2" }] },
            { unitId: "u-p1-b2", kind: "防壁", componentId: "character.bulwark", face: "down", cards: [{ suit: "D", rank: "7" }] },
          ],
        },
        p2: {
          field: [
            { unitId: "u-p2-s1", kind: "一般兵", face: "up", cards: [{ suit: "C", rank: "8" }] },
            { unitId: "u-p2-b1", kind: "防壁", componentId: "character.bulwark", face: "down", cards: [{ suit: "H", rank: "3" }] },
          ],
        },
      },
    };

    it("assigns unique target numbers per player (p1: ①..④, p2: ①..②)", () => {
      const map = BattleRelationPresenter.buildPresentationMap(fieldState);

      // p1 soldiers then bulwarks
      expect(map.get("u-p1-s1")?.badge).toBe("①");
      expect(map.get("u-p1-s2")?.badge).toBe("②");
      expect(map.get("u-p1-b1")?.badge).toBe("③");
      expect(map.get("u-p1-b2")?.badge).toBe("④");

      // p2 starts from ①
      expect(map.get("u-p2-s1")?.badge).toBe("①");
      expect(map.get("u-p2-b1")?.badge).toBe("②");
    });

    it("assigns bulwark position from life side (①, ②...) separately from target number", () => {
      const map = BattleRelationPresenter.buildPresentationMap(fieldState);

      // p1 bulwarks: 2 bulwarks. Life side is bulwark index 0 -> ①, index 1 -> ②
      expect(map.get("u-p1-b1")?.bulwarkPosition).toBe("①");
      expect(map.get("u-p1-b2")?.bulwarkPosition).toBe("②");

      // p2 bulwarks: 1 bulwark -> ①
      expect(map.get("u-p2-b1")?.bulwarkPosition).toBe("①");
    });
  });

  // 4. B-Cost UI Selection Display
  describe("4. B-Cost Payment Display Formatting", () => {
    const mockRequest: DecisionRequest = {
      protocolVersion: "1.0",
      matchId: "m-1",
      decisionId: "dec-1",
      stateVersion: 1,
      playerId: "p1",
      source: { type: "ACTION_REQUEST", playerId: "p1" },
      catalog: {
        actions: [],
        cardSelections: [],
        unitSelections: [],
        costPayments: [],
        targetSelections: [],
        effectSelections: [],
        orderSelections: [],
      },
      patterns: [],
      observation: {
        viewerPlayerId: "p1",
        players: [
          {
            playerId: "p1",
            name: "Player A",
            isViewer: true,
            lifeDisplay: "15",
            handCount: 2,
            handCards: [
              { visibility: "KNOWN", cardInstanceId: "c-h1", suit: "S", rank: "A", value: 14, faceUp: true },
            ],
            field: [
              {
                unitId: "u-bw-1",
                kind: "防壁",
                componentId: "character.bulwark",
                state: "charge",
                face: "down",
                cards: [{ visibility: "KNOWN", cardInstanceId: "c-bw1", suit: "S", rank: "2", value: 2, faceUp: false }],
                labels: [],
              },
              {
                unitId: "u-bw-2",
                kind: "防壁",
                componentId: "character.bulwark",
                state: "charge",
                face: "down",
                cards: [{ visibility: "KNOWN", cardInstanceId: "c-bw2", suit: "D", rank: "7", value: 7, faceUp: false }],
                labels: [],
              },
            ],
            fog: [],
            trumps: [],
            graveCount: 0,
            grave: [],
            canViewFullGrave: true,
          },
        ],
        stageRequestRefs: [],
        stageRequests: [],
        recentEvents: [],
      },
    };

    const battleRelationMap = new Map([
      ["u-bw-1", { unitId: "u-bw-1", badge: "③", bulwarkPosition: "①", label: "③ 防壁①", blockedByBadges: [] }],
      ["u-bw-2", { unitId: "u-bw-2", badge: "④", bulwarkPosition: "②", label: "④ 防壁②", blockedByBadges: [] }],
    ]);

    it("formats B-cost option showing bulwark position and card rank/suit (防壁① ♠2)", () => {
      const costSel = {
        drivenBulwarkUnitIds: ["u-bw-1"],
        discardedCardIds: [],
        lifeCount: 0,
      };

      const label = formatCostPaymentDisplay(costSel, mockRequest, battleRelationMap);
      expect(label).toBe("防壁① ♠2");
    });

    it("formats multiple bulwarks in B-cost (防壁① ♠2, 防壁② ♢7)", () => {
      const costSel = {
        drivenBulwarkUnitIds: ["u-bw-1", "u-bw-2"],
        discardedCardIds: [],
        lifeCount: 0,
      };

      const label = formatCostPaymentDisplay(costSel, mockRequest, battleRelationMap);
      expect(label).toBe("防壁① ♠2, 防壁② ♢7");
    });

    it("formats composite cost (手札 ♠A 破棄, 防壁① ♠2)", () => {
      const costSel = {
        drivenBulwarkUnitIds: ["u-bw-1"],
        discardedCardIds: ["c-h1"],
        lifeCount: 0,
      };

      const label = formatCostPaymentDisplay(costSel, mockRequest, battleRelationMap);
      expect(label).toBe("手札 ♠A 破棄, 防壁① ♠2");
    });
  });

  // 5. Relative Ownership Labels in StageTargetPresenter
  describe("5. StageTargetPresenter Relative Ownership Prefix", () => {
    const battleMap = new Map([
      ["u-p2-1", { unitId: "u-p2-1", badge: "①", label: "① ♠6 一般兵", ownerPlayerKey: "p2", blockedByBadges: [] }],
      ["u-p1-1", { unitId: "u-p1-1", badge: "①", label: "① ♡K 一般兵", ownerPlayerKey: "p1", blockedByBadges: [] }],
    ]);

    const reqTargetingP2Unit: ActionRequest = {
      id: "req-1",
      actionId: "action.downUnit",
      controller: "p1",
      keyCards: [],
      status: "pending",
      sequence: 1,
      targets: [{ type: "unit", unitId: "u-p2-1", kind: "一般兵", componentId: "c-1" }],
    };

    it("prepends '相手 ' when viewer is p1 targeting p2 unit", () => {
      const pres = StageTargetPresenter.buildStageTargetPresentation([reqTargetingP2Unit], battleMap, "p1");
      expect(pres.requestTargetLabels.get("req-1")).toEqual(["相手 ① ♠6 一般兵"]);
    });

    it("prepends '自分 ' when viewer is p2 targeting p2 unit", () => {
      const pres = StageTargetPresenter.buildStageTargetPresentation([reqTargetingP2Unit], battleMap, "p2");
      expect(pres.requestTargetLabels.get("req-1")).toEqual(["自分 ① ♠6 一般兵"]);
    });

    it("falls back to bare label when viewerPlayerId is omitted", () => {
      const pres = StageTargetPresenter.buildStageTargetPresentation([reqTargetingP2Unit], battleMap);
      expect(pres.requestTargetLabels.get("req-1")).toEqual(["① ♠6 一般兵"]);
    });
  });
});
