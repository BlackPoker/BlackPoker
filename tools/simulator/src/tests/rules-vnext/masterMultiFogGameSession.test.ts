import { describe, it, expect, beforeEach } from "vitest";
import { GameSession } from "../../engine/session/GameSession";
import { RulePackage, ComponentDefinition } from "../../domain/rules/RulePackage";
import { cleanupFogsHandler } from "../../engine/rules/commandHandlers";
import { CommandContext } from "../../engine/rules/CommandRegistry";

describe("Master Multi-Fog GameSession & Grave Top Selection Verification", () => {
  const mockComponents: ComponentDefinition[] = [
    {
      id: "character.soldier",
      name: "一般兵",
      type: "character",
      zone: "field",
      properties: { characterType: "soldier" },
    },
    {
      id: "character.bulwark",
      name: "防壁",
      type: "character",
      zone: "field",
      properties: { characterType: "bulwark" },
    },
    {
      id: "fog.up",
      name: "アップ",
      type: "fog",
      zone: "fog",
    },
    {
      id: "fog.down",
      name: "ダウン",
      type: "fog",
      zone: "fog",
    },
    {
      id: "fog.force",
      name: "フォース",
      type: "fog",
      zone: "fog",
    },
  ];

  const rulePackage: RulePackage = {
    id: "master-test-pkg",
    version: "9.2.0",
    components: mockComponents,
    actions: [],
  };

  function createBaseState(): any {
    return {
      stateVersion: 1,
      turn: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          name: "Player 1",
          life: [
            { id: "p1-l1", suit: "S", rank: "A", value: 1 },
            { id: "p1-l2", suit: "S", rank: "2", value: 2 },
          ],
          hand: [],
          field: [],
          fog: [],
          grave: [],
          graveTopCardId: undefined,
        },
        p2: {
          name: "Player 2",
          life: [
            { id: "p2-l1", suit: "H", rank: "A", value: 1 },
            { id: "p2-l2", suit: "H", rank: "2", value: 2 },
          ],
          hand: [],
          field: [],
          fog: [],
          grave: [],
          graveTopCardId: undefined,
        },
      },
      stage: { requests: [] },
      pendingGraveTopSelections: [],
    };
  }

  // --------------------------------------------------------------------------
  // 1. 同じプレイヤーが2枚カードのフォースFogを2件持つ
  // --------------------------------------------------------------------------
  it("Case 1: Same player has two 2-card Force Fogs -> GameSession resolves both pending selections sequentially", () => {
    const state = createBaseState();

    const force1Cards = [
      { id: "c-f1-a", suit: "H", rank: "5", value: 5 },
      { id: "c-f1-b", suit: "H", rank: "7", value: 7 },
    ];
    const force2Cards = [
      { id: "c-f2-a", suit: "H", rank: "3", value: 3 },
      { id: "c-f2-b", suit: "H", rank: "8", value: 8 },
    ];

    state.players.p1.fog = [
      {
        fogId: "fog-force-1",
        componentId: "fog.force",
        cards: force1Cards,
      },
      {
        fogId: "fog-force-2",
        componentId: "fog.force",
        cards: force2Cards,
      },
    ];

    const session = new GameSession(state, rulePackage);
    const cleanup = cleanupFogsHandler(session.registry.getEffectInterpreter());
    const context: CommandContext = {
      playerKey: "p1",
      state: session.state,
      components: mockComponents,
      logRecorder: session.logRecorder,
    };

    cleanup({}, context);

    expect(session.state.players.p1.fog).toHaveLength(0);
    expect(session.state.players.p1.grave).toHaveLength(2);
    expect(session.state.pendingGraveTopSelections).toHaveLength(2);

    // 1回目の advance で 1件目の ZONE_TOP_SELECTION が返る
    let step: any = session.advance();
    expect(step.type).toBe("WAITING_FOR_DECISION");
    expect(step.request.source.type).toBe("ZONE_TOP_SELECTION");
    expect(step.request.playerId).toBe("p1");
    expect(step.request.catalog.effectSelections.map((e: any) => e.selectedValues[0])).toEqual(["c-f1-a", "c-f1-b"]);

    // 1件目の決定提出 (c-f1-b)
    const req1 = step.request;
    const pat1 = req1.patterns.findIndex((p: any) => {
      const eff = req1.catalog.effectSelections[p.effectSelectionRef!];
      return eff?.selectedValues?.includes("c-f1-b");
    });
    step = session.submitDecision({
      decisionId: req1.decisionId,
      stateVersion: req1.stateVersion,
      selectedPatternRef: pat1,
    });

    // 2件目の pending が残っているため、直ちに2回目の ZONE_TOP_SELECTION が返る
    expect(step.type).toBe("WAITING_FOR_DECISION");
    expect(step.request.source.type).toBe("ZONE_TOP_SELECTION");
    expect(step.request.playerId).toBe("p1");
    expect(step.request.catalog.effectSelections.map((e: any) => e.selectedValues[0])).toEqual(["c-f2-a", "c-f2-b"]);

    // 2件目の決定提出 (c-f2-b)
    const req2 = step.request;
    const pat2 = req2.patterns.findIndex((p: any) => {
      const eff = req2.catalog.effectSelections[p.effectSelectionRef!];
      return eff?.selectedValues?.includes("c-f2-b");
    });
    step = session.submitDecision({
      decisionId: req2.decisionId,
      stateVersion: req2.stateVersion,
      selectedPatternRef: pat2,
    });

    // すべての pending が解決済み
    expect(session.state.pendingGraveTopSelections).toHaveLength(0);
    expect(session.state.players.p1.graveTopCardId).toBe("c-f2-b");
  });

  // --------------------------------------------------------------------------
  // 2. フォースFogの後に通常Fogがある
  // --------------------------------------------------------------------------
  it("Case 2: Force Fog followed by Normal Fog in fog array", () => {
    const state = createBaseState();

    const forceCards = [
      { id: "c-force-a", suit: "H", rank: "5", value: 5 },
      { id: "c-force-b", suit: "H", rank: "7", value: 7 },
    ];
    const normalCard = { id: "c-normal", suit: "S", rank: "4", value: 4 };

    state.players.p1.fog = [
      {
        fogId: "fog-force",
        componentId: "fog.force",
        cards: forceCards,
      },
      {
        fogId: "fog-normal",
        componentId: "fog.down",
        cards: [normalCard],
      },
    ];

    const session = new GameSession(state, rulePackage);
    const cleanup = cleanupFogsHandler(session.registry.getEffectInterpreter());
    const context: CommandContext = {
      playerKey: "p1",
      state: session.state,
      components: mockComponents,
      logRecorder: session.logRecorder,
    };

    cleanup({}, context);

    // 状態を検証
    expect(session.state.players.p1.fog).toHaveLength(0);
    expect(session.state.players.p1.grave).toHaveLength(2);
    // pending はフォースFogの1件
    expect(session.state.pendingGraveTopSelections).toHaveLength(1);
    expect(session.state.pendingGraveTopSelections[0].candidateCardIds).toEqual(["c-force-a", "c-force-b"]);

    // GameSession で解決
    let step: any = session.advance();
    expect(step.type).toBe("WAITING_FOR_DECISION");
    expect(step.request.source.type).toBe("ZONE_TOP_SELECTION");

    const req = step.request;
    const pat = req.patterns.findIndex((p: any) => {
      const eff = req.catalog.effectSelections[p.effectSelectionRef!];
      return eff?.selectedValues?.includes("c-force-a");
    });
    step = session.submitDecision({
      decisionId: req.decisionId,
      stateVersion: req.stateVersion,
      selectedPatternRef: pat,
    });

    expect(session.state.pendingGraveTopSelections).toHaveLength(0);
    expect(session.state.players.p1.graveTopCardId).toBe("c-force-a");
  });

  // --------------------------------------------------------------------------
  // 3. 通常Fogの後にフォースFogがある
  // --------------------------------------------------------------------------
  it("Case 3: Normal Fog followed by Force Fog in fog array", () => {
    const state = createBaseState();

    const normalCard = { id: "c-normal", suit: "S", rank: "4", value: 4 };
    const forceCards = [
      { id: "c-force-a", suit: "H", rank: "5", value: 5 },
      { id: "c-force-b", suit: "H", rank: "7", value: 7 },
    ];

    state.players.p1.fog = [
      {
        fogId: "fog-normal",
        componentId: "fog.down",
        cards: [normalCard],
      },
      {
        fogId: "fog-force",
        componentId: "fog.force",
        cards: forceCards,
      },
    ];

    const session = new GameSession(state, rulePackage);
    const cleanup = cleanupFogsHandler(session.registry.getEffectInterpreter());
    const context: CommandContext = {
      playerKey: "p1",
      state: session.state,
      components: mockComponents,
      logRecorder: session.logRecorder,
    };

    cleanup({}, context);

    expect(session.state.players.p1.fog).toHaveLength(0);
    expect(session.state.players.p1.grave).toHaveLength(2);
    expect(session.state.pendingGraveTopSelections).toHaveLength(1);
    expect(session.state.pendingGraveTopSelections[0].candidateCardIds).toEqual(["c-force-a", "c-force-b"]);

    let step: any = session.advance();
    expect(step.type).toBe("WAITING_FOR_DECISION");
    expect(step.request.source.type).toBe("ZONE_TOP_SELECTION");

    const req = step.request;
    const pat = req.patterns.findIndex((p: any) => {
      const eff = req.catalog.effectSelections[p.effectSelectionRef!];
      return eff?.selectedValues?.includes("c-force-b");
    });
    step = session.submitDecision({
      decisionId: req.decisionId,
      stateVersion: req.stateVersion,
      selectedPatternRef: pat,
    });

    expect(session.state.pendingGraveTopSelections).toHaveLength(0);
    expect(session.state.players.p1.graveTopCardId).toBe("c-force-b");
  });

  // --------------------------------------------------------------------------
  // 4. 両プレイヤーがフォースFogを複数持つ
  // --------------------------------------------------------------------------
  it("Case 4: Both players have multiple Force Fogs -> All pending selections resolved across players", () => {
    const state = createBaseState();

    state.players.p1.fog = [
      {
        fogId: "fog-p1-f1",
        componentId: "fog.force",
        cards: [
          { id: "p1-f1-a", suit: "H", rank: "2", value: 2 },
          { id: "p1-f1-b", suit: "H", rank: "4", value: 4 },
        ],
      },
      {
        fogId: "fog-p1-f2",
        componentId: "fog.force",
        cards: [
          { id: "p1-f2-a", suit: "H", rank: "6", value: 6 },
          { id: "p1-f2-b", suit: "H", rank: "8", value: 8 },
        ],
      },
    ];

    state.players.p2.fog = [
      {
        fogId: "fog-p2-f1",
        componentId: "fog.force",
        cards: [
          { id: "p2-f1-a", suit: "H", rank: "3", value: 3 },
          { id: "p2-f1-b", suit: "H", rank: "5", value: 5 },
        ],
      },
      {
        fogId: "fog-p2-f2",
        componentId: "fog.force",
        cards: [
          { id: "p2-f2-a", suit: "H", rank: "7", value: 7 },
          { id: "p2-f2-b", suit: "H", rank: "9", value: 9 },
        ],
      },
    ];

    const session = new GameSession(state, rulePackage);
    const cleanup = cleanupFogsHandler(session.registry.getEffectInterpreter());
    const context: CommandContext = {
      playerKey: "p1",
      state: session.state,
      components: mockComponents,
      logRecorder: session.logRecorder,
    };

    cleanup({}, context);

    // 両プレイヤー合わせて 4件 の pending が登録される (p1: 2件, p2: 2件)
    expect(session.state.pendingGraveTopSelections).toHaveLength(4);

    // 4回の決定を順次提出
    while (session.state.pendingGraveTopSelections.length > 0) {
      let step: any = session.advance();
      expect(step.type).toBe("WAITING_FOR_DECISION");
      expect(step.request.source.type).toBe("ZONE_TOP_SELECTION");

      const req = step.request;
      // 最初の候補を選択して提出
      step = session.submitDecision({
        decisionId: req.decisionId,
        stateVersion: req.stateVersion,
        selectedPatternRef: 0,
      });
    }

    // 全件完了
    expect(session.state.pendingGraveTopSelections).toHaveLength(0);
    expect(session.state.players.p1.graveTopCardId).toBeDefined();
    expect(session.state.players.p2.graveTopCardId).toBeDefined();
  });
});
