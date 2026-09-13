import React from "react";
import { renderToString } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { BattleRelationPresenter } from "../../ui/game/BattleRelationPresenter";
import { StageTargetPresenter } from "../../ui/game/StageTargetPresenter";
import { DecisionPanel, formatCostPaymentDisplay } from "../../ui/decision/DecisionPanel";
import { PlayerObservationPresenter } from "../../ui/game/PlayerObservationPresenter";
import { ObservationFactory } from "../../engine/decision/ObservationFactory";
import { PlaytestPerspectiveResolver } from "../../ui/playtest/PlaytestPerspectiveResolver";
import { UnitCard } from "../../ui/game/UnitCard";
import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader";
import { GameSession } from "../../engine/session/GameSession";
import { createCoreBattlePresetState } from "../../engine/session/playtest/createCoreBattlePlaytest";
import { DecisionRequest } from "../../domain/decision/DecisionRequest";
import type { ActionRequest } from "../../domain/rules/RulePackage";

describe("UI Phase 3.2: Perspective & Battlefield Clarity Tests", () => {
  // 1. Perspective Precedence (Human vs Human & Human vs AI)
  describe("1. Perspective Resolution Precedence", () => {
    it("Human vs AI always anchors activeHumanSeat to bottom", () => {
      const step = { type: "WAITING_FOR_DECISION", request: { playerId: "p2" } };
      const state = { chancePlayer: "p2", turnPlayer: "p2" };

      // humanSeat: p1
      const resP1 = PlaytestPerspectiveResolver.resolvePerspective({
        matchMode: "humanVsAi",
        activeHumanSeat: "p1",
        currentStep: step,
        gameState: state,
      });
      expect(resP1.bottomPlayerKey).toBe("p1");
      expect(resP1.topPlayerKey).toBe("p2");

      // humanSeat: p2
      const resP2 = PlaytestPerspectiveResolver.resolvePerspective({
        matchMode: "humanVsAi",
        activeHumanSeat: "p2",
        currentStep: { type: "WAITING_FOR_DECISION", request: { playerId: "p1" } },
        gameState: { chancePlayer: "p1" },
      });
      expect(resP2.bottomPlayerKey).toBe("p2");
      expect(resP2.topPlayerKey).toBe("p1");
    });

    it("Human vs Human Priority 1: Pending DecisionRequest.playerId", () => {
      const step = { type: "WAITING_FOR_DECISION", request: { playerId: "p2" } };
      const state = { chancePlayer: "p1", turnPlayer: "p1" };

      const res = PlaytestPerspectiveResolver.resolvePerspective({
        matchMode: "humanVsHuman",
        activeHumanSeat: "p1",
        currentStep: step,
        gameState: state,
      });
      expect(res.bottomPlayerKey).toBe("p2");
      expect(res.topPlayerKey).toBe("p1");
    });

    it("Human vs Human Priority 2: gameState.chancePlayer when no decision request", () => {
      const step = null;
      const state = { chancePlayer: "p2", turnPlayer: "p1" };

      const res = PlaytestPerspectiveResolver.resolvePerspective({
        matchMode: "humanVsHuman",
        activeHumanSeat: "p1",
        currentStep: step,
        gameState: state,
      });
      expect(res.bottomPlayerKey).toBe("p2");
      expect(res.topPlayerKey).toBe("p1");
    });

    it("Human vs Human Priority 3: gameState.turnPlayer when no decision request and no chance player", () => {
      const step = null;
      const state = { turnPlayer: "p2" };

      const res = PlaytestPerspectiveResolver.resolvePerspective({
        matchMode: "humanVsHuman",
        activeHumanSeat: "p1",
        currentStep: step,
        gameState: state,
      });
      expect(res.bottomPlayerKey).toBe("p2");
      expect(res.topPlayerKey).toBe("p1");
    });

    it("Human vs Human Fallback: p1 when no state info", () => {
      const res = PlaytestPerspectiveResolver.resolvePerspective({
        matchMode: "humanVsHuman",
        activeHumanSeat: "p1",
        currentStep: null,
        gameState: null,
      });
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

  // 6. DecisionPanel SSOT and Owner-Relative Disambiguation
  describe("6. DecisionPanel SSOT and Owner-Relative Disambiguation", () => {
    const mockBlockDecisionRequest: DecisionRequest = {
      protocolVersion: "1.0",
      matchId: "m-block-1",
      decisionId: "dec-block-1",
      stateVersion: 2,
      playerId: "p1",
      source: { type: "EFFECT_RESOLUTION", sourceRequestRef: "req-1", effectStepId: "step-1", playerId: "p1" },
      catalog: {
        actions: [],
        cardSelections: [],
        unitSelections: [],
        costPayments: [],
        targetSelections: [],
        effectSelections: [
          {
            selectionType: "unitAssignment",
            assignments: [
              {
                sourceUnitId: "u-p2-s1",
                selectedUnitIds: ["u-p1-s1"],
              },
            ],
          },
        ],
        orderSelections: [],
      },
      patterns: [
        {
          patternId: "p-0",
          kind: "EFFECT_SELECTION",
          effectSelectionRef: 0,
        },
      ],
      observation: {
        viewerPlayerId: "p1",
        players: [
          {
            playerId: "p1",
            name: "Player A",
            isViewer: true,
            lifeDisplay: "15",
            handCount: 1,
            handCards: [],
            field: [
              {
                unitId: "u-p1-s1",
                kind: "一般兵",
                state: "charge",
                face: "up",
                cards: [{ visibility: "KNOWN", cardInstanceId: "c-p1-1", suit: "S", rank: "5", value: 5, faceUp: true }],
                labels: ["防御"],
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
            name: "Player B",
            isViewer: false,
            lifeDisplay: "15",
            handCount: 1,
            handCards: [],
            field: [
              {
                unitId: "u-p2-s1",
                kind: "一般兵",
                state: "charge",
                face: "up",
                cards: [{ visibility: "KNOWN", cardInstanceId: "c-p2-1", suit: "H", rank: "6", value: 6, faceUp: true }],
                labels: ["攻撃"],
              },
            ],
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
    };

    it("renders owner-relative labels in BlockAssignmentEditor resolving duplicate ① ambiguity", () => {
      // Both P1 and P2 have unit ①
      const battleMap = BattleRelationPresenter.buildPresentationMap(undefined, mockBlockDecisionRequest.observation);
      expect(battleMap.get("u-p1-s1")?.badge).toBe("①");
      expect(battleMap.get("u-p2-s1")?.badge).toBe("①");

      const html = renderToString(
        React.createElement(DecisionPanel, {
          request: mockBlockDecisionRequest,
          onSubmit: () => {},
          battleRelationMap: battleMap,
        })
      );

      // Verify owner-relative disambiguation:
      // Attacker shows badge ① with "相手 ♡6 一般兵"
      // Blocker candidate shows badge ① with "自分 ♠5 一般兵"
      expect(html).toContain("相手 ♡6 一般兵");
      expect(html).toContain("自分 ♠5 一般兵");
      expect(html).toContain("①");
    });

    it("renders owner-relative fullLabel in pattern selection (e.g. attacker selection)", () => {
      const mockAttackerDecisionRequest: DecisionRequest = {
        ...mockBlockDecisionRequest,
        catalog: {
          ...mockBlockDecisionRequest.catalog,
          effectSelections: [
            {
              selectionType: "unit",
              selectedValues: ["u-p1-s1"],
            },
          ],
        },
      };

      const battleMap = BattleRelationPresenter.buildPresentationMap(undefined, mockAttackerDecisionRequest.observation);
      const html = renderToString(
        React.createElement(DecisionPanel, {
          request: mockAttackerDecisionRequest,
          onSubmit: () => {},
          battleRelationMap: battleMap,
        })
      );

      // Verify fullLabel with owner prefix: "自分 ① ♠5 一般兵 のみ"
      expect(html).toContain("自分 ① ♠5 一般兵 のみ");
    });

    it("falls back to BattleRelationPresenter.buildPresentationMap when battleRelationMap is omitted, maintaining SSOT", () => {
      const html = renderToString(
        React.createElement(DecisionPanel, {
          request: mockBlockDecisionRequest,
          onSubmit: () => {},
          // battleRelationMap is undefined
        })
      );

      // Verify that even without battleRelationMap prop, SSOT is maintained and numbers/prefixes match
      expect(html).toContain("相手 ♡6 一般兵");
      expect(html).toContain("自分 ♠5 一般兵");
      expect(html).toContain("①");
    });
  });

  // 7. Bulwark Order and Secondary Marker with Real GameSession
  describe("7. Bulwark Order and Secondary Marker with Real GameSession", () => {
    it("executes legal action.setBulwark in GameSession and verifies preset is B① and added is B②", () => {
      const rulePackage = loadRulePackageForBrowser();
      const state = createCoreBattlePresetState();
      const session = new GameSession(state, rulePackage);

      // 1. 最初のターン開始 (WAITING_FOR_DECISION)
      const step1 = session.advance();
      expect(step1.type).toBe("WAITING_FOR_DECISION");
      if (step1.type !== "WAITING_FOR_DECISION") return;

      // 2. action.setBulwark パターンを検索して実行
      const setBulwarkPatIdx = step1.request.patterns.findIndex(
        (p) => p.kind === "ACTION" && step1.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.setBulwark"
      );
      expect(setBulwarkPatIdx).toBeGreaterThanOrEqual(0);

      const step2 = session.submitDecision({
        decisionId: step1.request.decisionId,
        stateVersion: step1.request.stateVersion,
        selectedPatternRef: setBulwarkPatIdx,
      });

      // 3. 防壁設置は immediate なので即時解決し、防壁カード選択の EFFECT_RESOLUTION が発生
      expect(step2.type).toBe("WAITING_FOR_DECISION");
      if (step2.type !== "WAITING_FOR_DECISION") return;
      expect(step2.request.source.type).toBe("EFFECT_RESOLUTION");

      // 手札の最初のカードを防壁として選択
      const step3 = session.submitDecision({
        decisionId: step2.request.decisionId,
        stateVersion: step2.request.stateVersion,
        selectedPatternRef: 0,
      });

      // 4. 実 GameSession の結果状態を確認 (field 配列の順序をテスト都合で直接書き換えていないこと)
      const finalState = session.state;
      const p1Field = finalState.players.p1.field;

      // 兵士2体 + プリセット防壁1体 + 新規設置防壁1体 = 計4体
      expect(p1Field.length).toBe(4);
      const bulwarks = p1Field.filter(
        (u: any) => u.componentId === "character.bulwark" || u.kind === "防壁"
      );
      expect(bulwarks.length).toBe(2);

      const presetBulwark = bulwarks[0];
      const addedBulwark = bulwarks[1];
      expect(presetBulwark.unitId).toBe("bw-p1");
      expect(addedBulwark.unitId).not.toBe("bw-p1");

      // 5. Observation および BattleRelationPresenter で番号マッピング検証
      const obs = ObservationFactory.createObservation(finalState, "p1");
      const relationMap = BattleRelationPresenter.buildPresentationMap(finalState, obs);

      const presetInfo = relationMap.get(presetBulwark.unitId);
      const addedInfo = relationMap.get(addedBulwark.unitId);

      expect(presetInfo).toBeDefined();
      expect(addedInfo).toBeDefined();

      // プリセット防壁（ライフ側・インデックス0）は物理配置 ①
      expect(presetInfo?.bulwarkPosition).toBe("①");
      // 新規防壁（インデックス1）は物理配置 ②
      expect(addedInfo?.bulwarkPosition).toBe("②");

      // 6. UnitCard コンポーネント描画検証: B① / B② が secondary marker として描画され、Target番号と分離されていること
      const p1Obs = obs.players.find((p) => p.playerId === "p1")!;
      const presetObsUnit = p1Obs.field.find((u) => u.unitId === presetBulwark.unitId)!;
      const addedObsUnit = p1Obs.field.find((u) => u.unitId === addedBulwark.unitId)!;

      const presetHtml = renderToString(
        React.createElement(UnitCard, {
          unit: presetObsUnit,
          field: p1Obs.field,
          battleDisplayInfo: presetInfo,
        })
      );
      expect(presetHtml).toContain("B①");
      expect(presetHtml).toContain("防壁配置: ライフ側から ①");
      // Target 番号バッジと B① が別要素であること
      expect(presetHtml).toContain(`<span>${presetInfo?.badge}</span>`);

      const addedHtml = renderToString(
        React.createElement(UnitCard, {
          unit: addedObsUnit,
          field: p1Obs.field,
          battleDisplayInfo: addedInfo,
        })
      );
      expect(addedHtml).toContain("B②");
      expect(addedHtml).toContain("防壁配置: ライフ側から ②");
      expect(addedHtml).toContain(`<span>${addedInfo?.badge}</span>`);
    });
  });
});
