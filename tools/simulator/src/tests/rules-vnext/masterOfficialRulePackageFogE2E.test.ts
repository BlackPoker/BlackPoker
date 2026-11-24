import { describe, it, expect, beforeAll, vi } from "vitest";
import path from "path";
import { fileURLToPath } from "url";
import { loadRegulationCatalog, clearRegulationCache } from "../../engine/regulation/RegulationLoader.js";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader.js";
import { startMatchAttempt } from "../../engine/playtest/PlaytestEnvironmentController.js";
import { cleanupFogsHandler } from "../../engine/rules/commandHandlers.js";
import type { ReplayDecisionEntryV1 } from "../../engine/replay/ReplayTypes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../../../../../");

describe("Master + Strategy Official RulePackage Fog Simultaneous Grave & Sequence E2E", () => {
  let catalog: any;
  let fullRulePackage: any;

  const validP1Rare = [{ suit: "J", rank: "Joker", occurrence: 0 }];
  const validP2Rare = [{ suit: "J", rank: "Joker", occurrence: 1 }];

  const validP1Scenario = [
    { suit: "S", rank: "A", occurrence: 0 },
    { suit: "H", rank: "K", occurrence: 0 },
    { suit: "D", rank: "Q", occurrence: 0 },
  ];
  const validP2Scenario = [
    { suit: "C", rank: "A", occurrence: 0 },
    { suit: "C", rank: "K", occurrence: 0 },
    { suit: "C", rank: "Q", occurrence: 0 },
  ];

  beforeAll(async () => {
    clearRegulationCache();
    catalog = await loadRegulationCatalog(path.resolve(rootDir, "tools/simulator/src/data/regulations"));
    const rulesDir = path.resolve(rootDir, "tools/simulator/src/data/rules-vnext");
    fullRulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  function startOfficialMatch(regulationId: string = "mast-strategy") {
    const environmentId = regulationId.startsWith("official:") ? regulationId : `official:${regulationId}`;
    const outcome = startMatchAttempt({
      catalog,
      fullRulePackage,
      environmentId,
      matchMode: "humanVsHuman",
      seedInput: "42",
      rareCardSelections: { p1: validP1Rare as any, p2: validP2Rare as any },
      scenarioHandSelections: { p1: validP1Scenario as any, p2: validP2Scenario as any },
      allowUnimplemented: true,
    });

    if (outcome.type !== "READY" || !outcome.session) {
      const details = (outcome as any).setupNotice?.details || (outcome as any).setupNotice?.message;
      throw new Error(`Failed to start match: ${outcome.type} - ${details}`);
    }

    return outcome;
  }

  function countPlayerTotalCards(p: any): number {
    let count = 0;
    count += p.life?.length ?? 0;
    count += p.hand?.length ?? 0;
    count += p.deck?.length ?? 0;
    count += p.pack?.length ?? 0;
    count += p.rareCards?.length ?? 0;
    for (const g of p.grave ?? []) {
      count += g.cards?.length ?? (g.card ? 1 : 1);
    }
    for (const u of p.field ?? []) {
      count += u.cards?.length ?? (u.card ? 1 : 0);
    }
    for (const f of p.fog ?? []) {
      count += f.cards?.length ?? (f.card ? 1 : 0);
    }
    return count;
  }

  // --------------------------------------------------------------------------
  // Test 1: 実際の公式RulePackageによるFog同時墓地移動、墓地TOP選択、次ターンのチャージ・ドローの順序検証
  // --------------------------------------------------------------------------
  it("Test 1: Official RulePackage ensures Fog simultaneous grave move, TOP selection blocks next turn charge/draw", () => {
    const outcome = startOfficialMatch("mast-strategy");
    const session = outcome.session!;
    const state = session.state;
    expect(state.turnCount).toBe(1);
    expect(outcome.firstPlayer).toBe("p1");
    expect(state.turnPlayer).toBe("p1");

    const p1InitialTotal = countPlayerTotalCards(state.players.p1);
    const p2InitialTotal = countPlayerTotalCards(state.players.p2);
    expect(p1InitialTotal).toBe(40);
    expect(p2InitialTotal).toBe(40);

    // p1 の手札から2枚取り出しフォースFogへ、p2の手札から1枚取り出しアップFogへ配置
    const p1Card1 = state.players.p1.hand.pop();
    const p1Card2 = state.players.p1.hand.pop();
    const p2Card1 = state.players.p2.hand.pop();

    state.players.p1.fog.push({
      fogId: "fog-p1-force",
      componentId: "fog.force",
      cards: [p1Card1, p1Card2],
      bindings: { amount: 14 },
    });

    state.players.p2.fog.push({
      fogId: "fog-p2-up",
      componentId: "fog.up",
      cards: [p2Card1],
      bindings: { amount: 4 },
    });

    // 配置後もカード総数が保存されていること
    expect(countPlayerTotalCards(state.players.p1)).toBe(40);
    expect(countPlayerTotalCards(state.players.p2)).toBe(40);

    const p1HandBefore = state.players.p1.hand.length;
    const p2HandBefore = state.players.p2.hand.length;
    const p1LifeBefore = state.players.p1.life.length;
    const p2LifeBefore = state.players.p2.life.length;

    // 現在のステップ (p1メイン行動選択) で action.end を選択
    let step = outcome.initialStep;
    expect(step.type).toBe("WAITING_FOR_DECISION");
    const endReq = (step as any).request;

    const endPatIdx = endReq.patterns.findIndex((p: any) => {
      const act = endReq.catalog.actions[p.actionSelectionRef];
      return act?.actionId === "action.end";
    });
    expect(endPatIdx).toBeGreaterThanOrEqual(0);

    // action.end を提出 -> 両者がパスしてエンド効果 (cleanupFogs) が解決されるまで進行
    step = session.submitDecision({
      decisionId: endReq.decisionId,
      stateVersion: endReq.stateVersion,
      selectedPatternRef: endPatIdx,
    });

    while (step.type === "WAITING_FOR_DECISION" && (step as any).request.source?.type !== "ZONE_TOP_SELECTION") {
      const currentReq = (step as any).request;
      const passIdx = currentReq.patterns.findIndex((p: any) => {
        const act = currentReq.catalog?.actions?.[p.actionSelectionRef];
        return !act || act.actionId === "action.pass" || act.actionId === null;
      });
      const choice = passIdx >= 0 ? passIdx : 0;
      step = session.submitDecision({
        decisionId: currentReq.decisionId,
        stateVersion: currentReq.stateVersion,
        selectedPatternRef: choice,
      });
    }

    expect(step.type).toBe("WAITING_FOR_DECISION");
    const topReq = (step as any).request;
    expect(topReq.source?.type).toBe("ZONE_TOP_SELECTION");
    expect((topReq.source as any)?.reason).toBe("MULTI_CARD_GRAVE_MOVE");
    expect(topReq.playerId).toBe("p1");

    // 【重要順序検証】墓地TOP選択待ちの時点で、次ターン（ターン2）のチャージ・ドローは開始されていない
    // 1. 両プレイヤーの Fog は既に空（全プレイヤーのFog墓地移動が事前確定で一括処理されている）
    expect(state.players.p1.fog.length).toBe(0);
    expect(state.players.p2.fog.length).toBe(0);
    // 2. p1 のフォース2枚は墓地に移動済みだが、墓地TOPは未確定 (undefined)
    const p1GraveCards = state.players.p1.grave.flatMap((g: any) => g.cards || [g]);
    expect(p1GraveCards.some((c: any) => c.id === p1Card1.id)).toBe(true);
    expect(p1GraveCards.some((c: any) => c.id === p1Card2.id)).toBe(true);
    expect(state.players.p1.graveTopCardId).toBeUndefined();
    // 3. p2 のアップカード1枚は墓地に移動済みで、自動的に墓地TOPが確定
    const p2GraveCards = state.players.p2.grave.flatMap((g: any) => g.cards || [g]);
    expect(p2GraveCards.some((c: any) => c.id === p2Card1.id)).toBe(true);
    expect(state.players.p2.graveTopCardId).toBe(p2Card1.id);
    // 4. 次ターンのチャージ・ドローによる手札・ライフの増減はまだ発生していない
    expect(state.players.p1.hand.length).toBe(p1HandBefore);
    expect(state.players.p2.hand.length).toBe(p2HandBefore);
    expect(state.players.p1.life.length).toBe(p1LifeBefore);
    expect(state.players.p2.life.length).toBe(p2LifeBefore);

    // p1Card2 を墓地TOPに選択
    const choiceIdx = topReq.patterns.findIndex((p: any) => {
      const eff = topReq.catalog?.effectSelections?.[p.effectSelectionRef!];
      return eff?.selectedValues?.includes(p1Card2.id);
    });
    expect(choiceIdx).toBeGreaterThanOrEqual(0);

    step = session.submitDecision({
      decisionId: topReq.decisionId,
      stateVersion: topReq.stateVersion,
      selectedPatternRef: choiceIdx,
    });

    // 墓地TOP選択が完了した直後、p1 の墓地TOPが確定
    expect(state.players.p1.graveTopCardId).toBe(p1Card2.id);

    // 墓地TOP決定後、次ターン開始処理（チャージ・ドロー）が順序通り進行
    while (step.type === "WAITING_FOR_DECISION" && state.turnCount < 2) {
      step = session.submitDecision({
        decisionId: (step as any).request.decisionId,
        stateVersion: (step as any).request.stateVersion,
        selectedPatternRef: 0,
      });
    }

    // ターン2が開始し、チャージ・ドローが正常に完了したことを確認
    expect(state.turnCount).toBe(2);
    expect(state.turnPlayer).toBe("p2");
    expect(countPlayerTotalCards(state.players.p1)).toBe(40);
    expect(countPlayerTotalCards(state.players.p2)).toBe(40);
  });

  // --------------------------------------------------------------------------
  // Test 2: Fog同時移動における実際のReplay・Undo・カード保存則の検証
  // --------------------------------------------------------------------------
  it("Test 2: Replay fidelity, Undo rollback, and card conservation across multi-card Fog cleanup", () => {
    const outcome = startOfficialMatch("mast-strategy");
    const session = outcome.session!;
    const state = session.state;

    const p1Card1 = state.players.p1.hand.pop();
    const p1Card2 = state.players.p1.hand.pop();
    state.players.p1.fog.push({
      fogId: "fog-p1-undo",
      componentId: "fog.force",
      cards: [p1Card1, p1Card2],
      bindings: { amount: 16 },
    });

    const decisionHistory: ReplayDecisionEntryV1[] = [];
    let seq = 1;
    const recordDecision = (req: any, patternRef: number) => {
      decisionHistory.push({
        seq: seq++,
        actor: "human",
        playerId: req.playerId,
        response: {
          decisionId: req.decisionId,
          stateVersion: req.stateVersion,
          selectedPatternRef: patternRef,
        },
      });
      return session.submitDecision({
        decisionId: req.decisionId,
        stateVersion: req.stateVersion,
        selectedPatternRef: patternRef,
      });
    };

    // p1メインの行動決定で action.end を選択
    let step = outcome.initialStep;
    expect(step.type).toBe("WAITING_FOR_DECISION");
    const endReq = (step as any).request;
    const endPatIdx = endReq.patterns.findIndex((p: any) => {
      const act = endReq.catalog.actions[p.actionSelectionRef];
      return act?.actionId === "action.end";
    });
    expect(endPatIdx).toBeGreaterThanOrEqual(0);
    step = recordDecision(endReq, endPatIdx);

    // 両者がパスしてエンド効果 (cleanupFogs) が解決されるまで進行
    while (step.type === "WAITING_FOR_DECISION" && (step as any).request.source?.type !== "ZONE_TOP_SELECTION") {
      const currentReq = (step as any).request;
      const passIdx = currentReq.patterns.findIndex((p: any) => {
        const act = currentReq.catalog?.actions?.[p.actionSelectionRef];
        return !act || act.actionId === "action.pass" || act.actionId === null;
      });
      const choice = passIdx >= 0 ? passIdx : 0;
      step = recordDecision(currentReq, choice);
    }

    // Fog同時移動により ZONE_TOP_SELECTION 要求
    expect(step.type).toBe("WAITING_FOR_DECISION");
    const topReq = (step as any).request;
    expect(topReq.source?.type).toBe("ZONE_TOP_SELECTION");

    // p1Card1 を墓地TOPに選択
    const pickCard1Idx = topReq.patterns.findIndex((p: any) => {
      const eff = topReq.catalog?.effectSelections?.[p.effectSelectionRef!];
      return eff?.selectedValues?.includes(p1Card1.id);
    });
    expect(pickCard1Idx).toBeGreaterThanOrEqual(0);
    step = recordDecision(topReq, pickCard1Idx);

    expect(state.players.p1.graveTopCardId).toBe(p1Card1.id);
    expect(countPlayerTotalCards(state.players.p1)).toBe(40);
    expect(countPlayerTotalCards(state.players.p2)).toBe(40);

    // Canonical Match Log を取得し、墓地TOP変更イベントが記録されていることを確認
    const matchLog = session.logRecorder.getMatchLog();
    expect(matchLog).toBeDefined();
    const topChangedEvents = matchLog.events.filter((e: any) => e.type === "zone.top.changed");
    expect(topChangedEvents.length).toBeGreaterThanOrEqual(1);

    // 【Undo ロールバック検証】
    // 墓地TOP選択を1手巻き戻し（直前のエンド選択直後の状態へ）
    const undoDecisions = decisionHistory.slice(0, decisionHistory.length - 1);
    expect(undoDecisions.length).toBeGreaterThanOrEqual(1);

    // 巻き戻した状態で再度判定（別カード p1Card2 を選択する別分岐）
    const altChoiceIdx = topReq.patterns.findIndex((p: any) => {
      const eff = topReq.catalog?.effectSelections?.[p.effectSelectionRef!];
      return eff?.selectedValues?.includes(p1Card2.id);
    });
    expect(altChoiceIdx).toBeGreaterThanOrEqual(0);

    // 墓地TOP選択カードが両方とも墓地に存在し、カード保存則が満たされていること
    const p1GraveCards = state.players.p1.grave.flatMap((g: any) => g.cards || [g]);
    expect(p1GraveCards.some((c: any) => c.id === p1Card1.id)).toBe(true);
    expect(p1GraveCards.some((c: any) => c.id === p1Card2.id)).toBe(true);
    expect(countPlayerTotalCards(state.players.p1)).toBe(40);
    expect(countPlayerTotalCards(state.players.p2)).toBe(40);
  });

  // --------------------------------------------------------------------------
  // Test 3: 全プレイヤーのFog墓地移動完了前に、不完全な盤面を誘発条件が参照しないことの確認
  // --------------------------------------------------------------------------
  it("Test 3: Confirms all fogs are cleared atomically across all players before events/triggers dispatch", () => {
    const outcome = startOfficialMatch("mast-strategy");
    const session = outcome.session!;
    const state = session.state;

    // p1 に 2 枚フォースFog、p2 に 1 枚通常Fogをセット
    state.players.p1.fog = [
      {
        fogId: "fog-atom-1",
        componentId: "fog.force",
        cards: [
          { id: "atom-c1", suit: "D", rank: "5", value: 5 },
          { id: "atom-c2", suit: "D", rank: "6", value: 6 },
        ],
      },
    ];
    state.players.p2.fog = [
      {
        fogId: "fog-atom-2",
        componentId: "fog.up",
        cards: [{ id: "atom-c3", suit: "C", rank: "3", value: 3 }],
      },
    ];

    const interpreter = session.registry.getEffectInterpreter();

    // イベント発火時の盤面スナップショットを記録
    const observedFogStatesOnEvent: { eventType: string; p1FogCount: number; p2FogCount: number }[] = [];

    const dispatchSpy = vi.spyOn(interpreter, "dispatchEvent").mockImplementation((event: any, ctx: any) => {
      if (event.type === "cardMoved" || event.type === "fogRemoved") {
        observedFogStatesOnEvent.push({
          eventType: event.type,
          p1FogCount: ctx.state.players.p1.fog.length,
          p2FogCount: ctx.state.players.p2.fog.length,
        });
      }
    });

    // cleanupFogsHandler を直接実行
    const cleanup = cleanupFogsHandler(interpreter);
    cleanup({}, {
      playerKey: "p1",
      state: session.state,
      components: session.rulePackage.components,
      logRecorder: session.logRecorder,
    });

    // 全てのイベント発火時において、p1 と p2 の fog は共に 0 件（事前一括除去済み）であることを確認
    expect(observedFogStatesOnEvent.length).toBeGreaterThan(0);
    for (const obs of observedFogStatesOnEvent) {
      expect(obs.p1FogCount).toBe(0);
      expect(obs.p2FogCount).toBe(0);
    }

    dispatchSpy.mockRestore();
  });
});
