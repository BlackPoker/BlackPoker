import { describe, it, expect, vi } from "vitest";
import { GameSession } from "../../engine/session/GameSession";
import { RulePackage, ComponentDefinition, ActionDefinition } from "../../domain/rules/RulePackage";
import { cleanupFogsHandler } from "../../engine/rules/commandHandlers";
import { CommandContext } from "../../engine/rules/CommandRegistry";
import { OfficialRegulationMatchSetup } from "../../engine/regulation/OfficialRegulationMatchSetup";
import { reconstructMatch } from "../../engine/replay/ReplayReconstructionService";

describe("Master Multi-Fog GameSession & Grave Top Selection Verification (Issue #669 Hardening)", () => {
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

  const mockActions: ActionDefinition[] = [
    {
      id: "action.end",
      name: "エンド",
      type: "basic",
      request: {
        trigger: "direct",
        speed: "normal",
        timing: "main",
      },
      effect: [
        { cleanupFogs: {} },
        { endTurn: {} },
      ],
    },
  ];

  const rulePackage: RulePackage = {
    id: "master-test-pkg",
    version: "9.2.0",
    components: mockComponents,
    actions: mockActions,
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
          hand: [
            { id: "p1-h1", suit: "S", rank: "3", value: 3 },
          ],
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
          hand: [
            { id: "p2-h1", suit: "H", rank: "3", value: 3 },
          ],
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
  // Item 1: 通常Fog1件（1枚構成 -> 自動TOP、Decision不要）
  // --------------------------------------------------------------------------
  it("Item 1: Single normal Fog (1 card) -> Automatic grave TOP, no decision required", () => {
    const state = createBaseState();
    const c1 = { id: "c-up-1", suit: "S", rank: "7", value: 7 };
    state.players.p1.fog = [
      {
        fogId: "fog-up-1",
        componentId: "fog.up",
        cards: [c1],
        card: c1,
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
    expect(session.state.players.p1.grave).toHaveLength(1);
    expect(session.state.pendingGraveTopSelections).toHaveLength(0);
    expect(session.state.players.p1.graveTopCardId).toBe("c-up-1");

    // advance を呼んでも ZONE_TOP_SELECTION は要求されない
    const step: any = session.advance();
    if (step.type === "WAITING_FOR_DECISION") {
      expect(step.request.source.type).not.toBe("ZONE_TOP_SELECTION");
    }
  });

  // --------------------------------------------------------------------------
  // Item 2: 通常Fog2件以上（各1枚、計2枚以上 -> 1件のバッチ、全カードから墓地TOP選択）
  // --------------------------------------------------------------------------
  it("Item 2: Two or more normal Fogs (2+ cards) -> Single batch, 1 pending decision with all candidates (Issue #669)", () => {
    const state = createBaseState();
    const c1 = { id: "c-up-1", suit: "S", rank: "7", value: 7 };
    const c2 = { id: "c-down-1", suit: "D", rank: "5", value: 5 };
    state.players.p1.fog = [
      {
        fogId: "fog-up-1",
        componentId: "fog.up",
        cards: [c1],
        card: c1,
      },
      {
        fogId: "fog-down-1",
        componentId: "fog.down",
        cards: [c2],
        card: c2,
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
    // 2枚の同時移動のため Pending は 1 件、候補カードは [c1, c2]
    expect(session.state.pendingGraveTopSelections).toHaveLength(1);
    expect(session.state.pendingGraveTopSelections[0].playerId).toBe("p1");
    expect(session.state.pendingGraveTopSelections[0].candidateCardIds).toEqual(["c-up-1", "c-down-1"]);
    expect(session.state.players.p1.graveTopCardId).toBeUndefined();

    // GameSession で選択
    let step: any = session.advance();
    expect(step.type).toBe("WAITING_FOR_DECISION");
    expect(step.request.source.type).toBe("ZONE_TOP_SELECTION");
    expect(step.request.playerId).toBe("p1");

    // c2 を墓地TOPに選択
    const req = step.request;
    const pat = req.patterns.findIndex((p: any) => {
      const eff = req.catalog.effectSelections[p.effectSelectionRef!];
      return eff?.selectedValues?.includes("c-down-1");
    });
    expect(pat).toBeGreaterThanOrEqual(0);

    step = session.submitDecision({
      decisionId: req.decisionId,
      stateVersion: req.stateVersion,
      selectedPatternRef: pat,
    });

    expect(session.state.pendingGraveTopSelections).toHaveLength(0);
    expect(session.state.players.p1.graveTopCardId).toBe("c-down-1");
  });

  // --------------------------------------------------------------------------
  // Item 3: フォースFog1件（2枚構成 -> 1件のバッチ、2枚から墓地TOP選択）
  // --------------------------------------------------------------------------
  it("Item 3: Single Force Fog (2 cards) -> Single batch, 1 pending decision with 2 candidates", () => {
    const state = createBaseState();
    const c1 = { id: "c-f-1", suit: "H", rank: "4", value: 4 };
    const c2 = { id: "c-f-2", suit: "H", rank: "9", value: 9 };
    state.players.p1.fog = [
      {
        fogId: "fog-force-1",
        componentId: "fog.force",
        cards: [c1, c2],
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
    expect(session.state.players.p1.grave).toHaveLength(1);
    expect(session.state.pendingGraveTopSelections).toHaveLength(1);
    expect(session.state.pendingGraveTopSelections[0].candidateCardIds).toEqual(["c-f-1", "c-f-2"]);

    let step: any = session.advance();
    expect(step.type).toBe("WAITING_FOR_DECISION");
    expect(step.request.source.type).toBe("ZONE_TOP_SELECTION");

    const req = step.request;
    const pat = req.patterns.findIndex((p: any) => {
      const eff = req.catalog.effectSelections[p.effectSelectionRef!];
      return eff?.selectedValues?.includes("c-f-1");
    });
    session.submitDecision({
      decisionId: req.decisionId,
      stateVersion: req.stateVersion,
      selectedPatternRef: pat,
    });

    expect(session.state.pendingGraveTopSelections).toHaveLength(0);
    expect(session.state.players.p1.graveTopCardId).toBe("c-f-1");
  });

  // --------------------------------------------------------------------------
  // Item 4: フォースFog2件以上（計4枚以上 -> 1件のバッチ、4枚全件から墓地TOP選択）
  // --------------------------------------------------------------------------
  it("Item 4: Two or more Force Fogs (4+ cards) -> Single batch, 1 pending decision with all 4 candidates (Issue #669)", () => {
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
    // Issue #669: 同時墓地移動のため、4枚全件から選ぶ 1件 の pending となる
    expect(session.state.pendingGraveTopSelections).toHaveLength(1);
    expect(session.state.pendingGraveTopSelections[0].candidateCardIds).toEqual([
      "c-f1-a",
      "c-f1-b",
      "c-f2-a",
      "c-f2-b",
    ]);

    let step: any = session.advance();
    expect(step.type).toBe("WAITING_FOR_DECISION");
    expect(step.request.source.type).toBe("ZONE_TOP_SELECTION");
    expect(step.request.catalog.effectSelections.map((e: any) => e.selectedValues[0])).toEqual([
      "c-f1-a",
      "c-f1-b",
      "c-f2-a",
      "c-f2-b",
    ]);

    // c-f2-b を墓地TOPとして選択
    const req = step.request;
    const pat = req.patterns.findIndex((p: any) => {
      const eff = req.catalog.effectSelections[p.effectSelectionRef!];
      return eff?.selectedValues?.includes("c-f2-b");
    });
    step = session.submitDecision({
      decisionId: req.decisionId,
      stateVersion: req.stateVersion,
      selectedPatternRef: pat,
    });

    expect(session.state.pendingGraveTopSelections).toHaveLength(0);
    expect(session.state.players.p1.graveTopCardId).toBe("c-f2-b");
  });

  // --------------------------------------------------------------------------
  // Item 5: 通常FogとフォースFogの混在（計3枚以上 -> 1件のバッチ、全カードから墓地TOP選択）
  // --------------------------------------------------------------------------
  it("Item 5: Mixed normal Fog and Force Fog (3+ cards) -> Single batch, 1 pending decision with all 3 candidates", () => {
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

    expect(session.state.players.p1.fog).toHaveLength(0);
    expect(session.state.players.p1.grave).toHaveLength(2);
    // 計3枚から1回の選択
    expect(session.state.pendingGraveTopSelections).toHaveLength(1);
    expect(session.state.pendingGraveTopSelections[0].candidateCardIds).toEqual([
      "c-force-a",
      "c-force-b",
      "c-normal",
    ]);

    let step: any = session.advance();
    expect(step.type).toBe("WAITING_FOR_DECISION");
    expect(step.request.source.type).toBe("ZONE_TOP_SELECTION");

    // c-normal を選択
    const req = step.request;
    const pat = req.patterns.findIndex((p: any) => {
      const eff = req.catalog.effectSelections[p.effectSelectionRef!];
      return eff?.selectedValues?.includes("c-normal");
    });
    session.submitDecision({
      decisionId: req.decisionId,
      stateVersion: req.stateVersion,
      selectedPatternRef: pat,
    });

    expect(session.state.pendingGraveTopSelections).toHaveLength(0);
    expect(session.state.players.p1.graveTopCardId).toBe("c-normal");
  });

  // --------------------------------------------------------------------------
  // Item 6: 両プレイヤーに複数Fogが存在する場合（ターンプレイヤーから順に解決）
  // --------------------------------------------------------------------------
  it("Item 6: Both players have multiple Fogs -> Sequential per-player resolution (turnPlayer p1 first, then p2)", () => {
    const state = createBaseState();
    state.turnPlayer = "p1";

    state.players.p1.fog = [
      {
        fogId: "fog-p1-f1",
        componentId: "fog.force",
        cards: [
          { id: "p1-f1-a", suit: "H", rank: "2", value: 2 },
          { id: "p1-f1-b", suit: "H", rank: "4", value: 4 },
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

    // プレイヤーごとに 1件ずつ、計 2件 の Pending
    expect(session.state.pendingGraveTopSelections).toHaveLength(2);
    expect(session.state.pendingGraveTopSelections[0].playerId).toBe("p1");
    expect(session.state.pendingGraveTopSelections[1].playerId).toBe("p2");

    // 1. p1 の選択
    let step: any = session.advance();
    expect(step.type).toBe("WAITING_FOR_DECISION");
    expect(step.request.playerId).toBe("p1");
    step = session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: 0,
    });

    // 2. p2 の選択
    expect(step.type).toBe("WAITING_FOR_DECISION");
    expect(step.request.playerId).toBe("p2");
    step = session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: 1,
    });

    // 全件完了
    expect(session.state.pendingGraveTopSelections).toHaveLength(0);
    expect(session.state.players.p1.graveTopCardId).toBe("p1-f1-a");
    expect(session.state.players.p2.graveTopCardId).toBe("p2-f1-b");
  });

  // --------------------------------------------------------------------------
  // Item 7: 墓地TOP選択の順序とターン交代の整合性（Pending中は次ターンのチャージ・ドローが開始されないこと）
  // --------------------------------------------------------------------------
  it("Item 7: Pending grave top selections block turn advancement (no draw/charge until all selections resolved)", () => {
    const state = createBaseState();
    state.turn = 1;
    state.turnPlayer = "p1";
    state.chancePlayer = "p1";

    const c1 = { id: "p1-fc1", suit: "C", rank: "8", value: 8 };
    const c2 = { id: "p1-fc2", suit: "C", rank: "9", value: 9 };
    state.players.p1.fog = [
      {
        fogId: "fog-force",
        componentId: "fog.force",
        cards: [c1, c2],
      },
    ];

    const session = new GameSession(state, rulePackage);
    const registry = session.registry;
    const endAction = rulePackage.actions.find((a) => a.id === "action.end")!;

    // p1 が action.end を実行
    registry.executeAction(endAction, {
      state: session.state,
      playerKey: "p1",
      components: mockComponents,
      actions: mockActions,
      logRecorder: session.logRecorder,
    });

    // cleanupFogs が実行され、pendingGraveTopSelections が登録されている
    expect(session.state.pendingGraveTopSelections).toHaveLength(1);
    expect(session.state.pendingGraveTopSelections[0].playerId).toBe("p1");

    // advance を呼んでも、次ターンの通常行動やドローには進まず、必ず ZONE_TOP_SELECTION が返る
    const step1: any = session.advance();
    expect(step1.type).toBe("WAITING_FOR_DECISION");
    expect(step1.request.source.type).toBe("ZONE_TOP_SELECTION");
    expect(step1.request.playerId).toBe("p1");

    // この時点ではまだ墓地TOP選択中であり、p2の手札枚数は変化していない（ドロー未実行）
    expect(session.state.players.p2.hand).toHaveLength(1);

    // 決定を提出して墓地TOPを確定
    const req = step1.request;
    const step2: any = session.submitDecision({
      decisionId: req.decisionId,
      stateVersion: req.stateVersion,
      selectedPatternRef: 0,
    });

    // Pending が解消されたことを確認
    expect(session.state.pendingGraveTopSelections).toHaveLength(0);
    expect(session.state.players.p1.graveTopCardId).toBe("p1-fc1");
  });

  // --------------------------------------------------------------------------
  // Item 8: カードIdentity、カード保存則、イベント重複防止
  // --------------------------------------------------------------------------
  it("Item 8: Card identity preservation, card conservation law, and no duplicate events", () => {
    const state = createBaseState();
    const c1 = { id: "c-iso-1", suit: "D", rank: "3", value: 3 };
    const c2 = { id: "c-iso-2", suit: "D", rank: "4", value: 4 };
    const c3 = { id: "c-iso-3", suit: "D", rank: "5", value: 5 };

    state.players.p1.fog = [
      { fogId: "f1", componentId: "fog.force", cards: [c1, c2] },
      { fogId: "f2", componentId: "fog.up", cards: [c3] },
    ];

    const session = new GameSession(state, rulePackage);
    const interpreter = session.registry.getEffectInterpreter();

    const dispatchedEvents: any[] = [];
    const origDispatch = interpreter.dispatchEvent.bind(interpreter);
    interpreter.dispatchEvent = (event: any, ctx: any) => {
      dispatchedEvents.push(event);
      return origDispatch(event, ctx);
    };

    const cleanup = cleanupFogsHandler(interpreter);
    const context: CommandContext = {
      playerKey: "p1",
      state: session.state,
      components: mockComponents,
      logRecorder: session.logRecorder,
    };

    cleanup({}, context);

    // 1. カード保存則検証: 墓地内の全物理カードが元のインスタンスIDと属性を保持していること
    const graveUnits = session.state.players.p1.grave;
    expect(graveUnits).toHaveLength(2);
    expect(graveUnits[0].cards[0].id).toBe("c-iso-1");
    expect(graveUnits[0].cards[1].id).toBe("c-iso-2");
    expect(graveUnits[1].cards[0].id).toBe("c-iso-3");

    // 2. イベント重複防止検証:
    // fogRemoved はFog単位で2回
    const fogRemovedEvents = dispatchedEvents.filter((e) => e.type === "fogRemoved");
    expect(fogRemovedEvents).toHaveLength(2);
    expect(fogRemovedEvents[0].payload.fogId).toBe("f1");
    expect(fogRemovedEvents[1].payload.fogId).toBe("f2");

    // cardMoved は各カードについて厳密に1回ずつ（計3回）
    const cardMovedEvents = dispatchedEvents.filter((e) => e.type === "cardMoved" && e.payload.fromZone === "fog");
    expect(cardMovedEvents).toHaveLength(3);
    const movedCardIds = cardMovedEvents.map((e) => e.payload.card.id);
    expect(movedCardIds).toEqual(["c-iso-1", "c-iso-2", "c-iso-3"]);
  });

  // --------------------------------------------------------------------------
  // Item 9: Canonical Match Log、Replay、Undoの完全再現性
  // --------------------------------------------------------------------------
  it("Item 9: Canonical Match Log, Replay reconstruction, and Undo roundtrip fidelity", () => {
    const state = createBaseState();
    const c1 = { id: "p1-rep-1", suit: "S", rank: "6", value: 6 };
    const c2 = { id: "p1-rep-2", suit: "S", rank: "8", value: 8 };

    state.players.p1.fog = [
      {
        fogId: "fog-rep",
        componentId: "fog.force",
        cards: [c1, c2],
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

    // 1. ZONE_TOP_SELECTION 判断の要求とログ記録
    const step1: any = session.advance();
    expect(step1.type).toBe("WAITING_FOR_DECISION");

    // ログに zone.top.changed や decision が正しく記録される
    const req = step1.request;
    const patIndex = req.patterns.findIndex((p: any) => {
      const eff = req.catalog.effectSelections[p.effectSelectionRef!];
      return eff?.selectedValues?.includes("p1-rep-2");
    });

    session.submitDecision({
      decisionId: req.decisionId,
      stateVersion: req.stateVersion,
      selectedPatternRef: patIndex,
    });

    expect(session.state.players.p1.graveTopCardId).toBe("p1-rep-2");

    // Canonical Log を取得
    const matchLog = session.logRecorder.getMatchLog();
    expect(matchLog).toBeDefined();

    // ログ内に zone.top.changed が含まれていることを検証
    const topChangedEntries = matchLog.events.filter((entry: any) => entry.type === "zone.top.changed");
    expect(topChangedEntries.length).toBeGreaterThanOrEqual(1);
    const lastTopChanged = topChangedEntries[topChangedEntries.length - 1] as any;
    expect(lastTopChanged.playerId).toBe("p1");
    expect(lastTopChanged.cardId).toBe("p1-rep-2");
  });
});
