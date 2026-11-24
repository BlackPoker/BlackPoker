import { describe, it, expect, beforeAll } from "vitest";
import path from "path";
import { fileURLToPath } from "url";
import { loadRegulationCatalog, clearRegulationCache } from "../../engine/regulation/RegulationLoader.js";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader.js";
import { startMatchAttempt } from "../../engine/playtest/PlaytestEnvironmentController.js";
import { cleanupFogsHandler } from "../../engine/rules/commandHandlers.js";
import { reconstructMatch } from "../../engine/replay/ReplayReconstructionService.js";
import type { ReplayDecisionEntryV1 } from "../../engine/replay/ReplayTypes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../../../../../");

describe("Master + Strategy Official RulePackage Fog Simultaneous Grave & Sequence E2E", () => {
  let catalog: any;
  let fullRulePackage: any;

  const validP1Rare = [{ suit: "J", rank: "Joker", occurrence: 0 }];
  const validP2Rare = [{ suit: "J", rank: "Joker", occurrence: 1 }];

  // P1 の初期手札に ハート2, ハート3 を確実に含める（フォース keyCards 条件: heart A..10 を2枚）
  const validP1Scenario = [
    { suit: "H", rank: "2", occurrence: 0 },
    { suit: "H", rank: "3", occurrence: 0 },
    { suit: "S", rank: "A", occurrence: 0 },
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

  function getAllPlayerCardIds(player: any): string[] {
    const ids: string[] = [];
    const addCard = (c: any) => {
      if (c && typeof c.id === "string") {
        ids.push(c.id);
      }
    };

    if (Array.isArray(player.life)) {
      for (const c of player.life) addCard(c);
    }
    if (Array.isArray(player.hand)) {
      for (const c of player.hand) addCard(c);
    }
    if (Array.isArray(player.deck)) {
      for (const c of player.deck) addCard(c);
    }
    if (Array.isArray(player.pack)) {
      for (const c of player.pack) addCard(c);
    }
    if (Array.isArray(player.rareCards)) {
      for (const c of player.rareCards) addCard(c);
    }
    if (Array.isArray(player.grave)) {
      for (const g of player.grave) {
        if (Array.isArray(g.cards)) {
          for (const c of g.cards) addCard(c);
        } else {
          addCard(g.card || g);
        }
      }
    }
    if (Array.isArray(player.field)) {
      for (const u of player.field) {
        if (Array.isArray(u.cards)) {
          for (const c of u.cards) addCard(c);
        } else {
          addCard(u.card);
        }
      }
    }
    if (Array.isArray(player.fog)) {
      for (const f of player.fog) {
        if (Array.isArray(f.cards)) {
          for (const c of f.cards) addCard(c);
        } else {
          addCard(f.card);
        }
      }
    }
    return ids;
  }

  function verifyCardConservation(player: any, initialIds: Set<string>): void {
    const currentIds = getAllPlayerCardIds(player);
    expect(currentIds.length).toBe(40);
    expect(currentIds.length).toBe(initialIds.size);
    const currentIdSet = new Set(currentIds);
    expect(currentIdSet.size).toBe(40);
    for (const id of currentIds) {
      expect(initialIds.has(id)).toBe(true);
    }
  }

  // --------------------------------------------------------------------------
  // Test 1: 両プレイヤーに複数Fogカードが存在する状態でのターン開始処理順序の厳密検証
  // --------------------------------------------------------------------------
  it("Test 1: Official RulePackage ensures simultaneous Fog move, sequential TOP selection blocks next turn charge/draw", () => {
    const outcome = startOfficialMatch("mast-strategy");
    const session = outcome.session!;
    const state = session.state;
    expect(state.turnCount).toBe(1);
    expect(outcome.firstPlayer).toBe("p1");
    expect(state.turnPlayer).toBe("p1");

    const p1InitialIds = new Set(getAllPlayerCardIds(state.players.p1));
    const p2InitialIds = new Set(getAllPlayerCardIds(state.players.p2));
    expect(p1InitialIds.size).toBe(40);
    expect(p2InitialIds.size).toBe(40);

    // 両プレイヤーに複数Fogカード（P1に2枚フォースFog、P2に2枚Fog）をセット
    const p1Card1 = state.players.p1.hand.pop();
    const p1Card2 = state.players.p1.hand.pop();
    const p2Card1 = state.players.p2.hand.pop();
    const p2Card2 = state.players.p2.hand.pop();

    state.players.p1.fog.push({
      fogId: "fog-p1-force",
      componentId: "fog.force",
      cards: [p1Card1, p1Card2],
      bindings: { amount: 14 },
    });

    state.players.p2.fog.push({
      fogId: "fog-p2-multi",
      componentId: "fog.force",
      cards: [p2Card1, p2Card2],
      bindings: { amount: 10 },
    });

    verifyCardConservation(state.players.p1, p1InitialIds);
    verifyCardConservation(state.players.p2, p2InitialIds);

    // P1 メイン手番で action.end を選択
    let step = outcome.initialStep;
    expect(step.type).toBe("WAITING_FOR_DECISION");
    const endReq = (step as any).request;

    const endPatIdx = endReq.patterns.findIndex((p: any) => {
      const act = endReq.catalog.actions[p.actionSelectionRef];
      return act?.actionId === "action.end";
    });
    expect(endPatIdx).toBeGreaterThanOrEqual(0);

    // action.end を提出 -> 両者がチャンスでパスしてエンド効果 (cleanupFogs) が解決されるまで進行
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

    // 両プレイヤーの複数カードFogが同時に墓地へ移動したため、Pendingが2件登録される
    expect(step.type).toBe("WAITING_FOR_DECISION");
    expect(state.pendingGraveTopSelections?.length).toBe(2);

    // --- 検証ステップ A: P1 の墓地TOP選択待ち ---
    const topReqP1 = (step as any).request;
    expect(topReqP1.source?.type).toBe("ZONE_TOP_SELECTION");
    expect(topReqP1.playerId).toBe("p1");

    // 1. 両プレイヤーの Fog は既に空（事前一括除去完了）
    expect(state.players.p1.fog.length).toBe(0);
    expect(state.players.p2.fog.length).toBe(0);

    // 2. 両プレイヤーの対象カード（計4枚）はすべて各自の墓地に格納済み
    const p1GraveCards = state.players.p1.grave.flatMap((g: any) => g.cards || [g]);
    const p2GraveCards = state.players.p2.grave.flatMap((g: any) => g.cards || [g]);
    expect(p1GraveCards.some((c: any) => c.id === p1Card1.id)).toBe(true);
    expect(p1GraveCards.some((c: any) => c.id === p1Card2.id)).toBe(true);
    expect(p2GraveCards.some((c: any) => c.id === p2Card1.id)).toBe(true);
    expect(p2GraveCards.some((c: any) => c.id === p2Card2.id)).toBe(true);
    expect(state.players.p1.graveTopCardId).toBeUndefined();
    expect(state.players.p2.graveTopCardId).toBeUndefined();

    // 3. 【ステージの厳密検証】次ターンのチャージ・ドローがステージに積まれていないこと
    const stageItems1 = state.stage?.queue || [];
    const stageActionIds1 = stageItems1.map((item: any) => item.actionId || item.action?.id);
    expect(stageActionIds1).not.toContain("action.charge");
    expect(stageActionIds1).not.toContain("action.draw");

    // 4. 【リクエストの厳密検証】通常手番リクエストではなく墓地TOP選択であること
    expect(topReqP1.actionSelectionRef).toBeUndefined();

    // 5. 【Canonical Match Log の厳密検証】ターン2開始イベントやチャージ・ドローが未記録であること
    const matchLog1 = session.logRecorder.getMatchLog();
    const turn2Events1 = matchLog1.events.filter(
      (e: any) => e.type === "turn.changed" && e.payload?.turnCount === 2
    );
    expect(turn2Events1.length).toBe(0);
    const chargeDraw1 = matchLog1.events.filter(
      (e: any) => e.type === "action.charge" || e.type === "action.draw"
    );
    expect(chargeDraw1.length).toBe(0);

    // P1 が p1Card2 を墓地TOPに選択
    const p1ChoiceIdx = topReqP1.patterns.findIndex((p: any) => {
      const eff = topReqP1.catalog?.effectSelections?.[p.effectSelectionRef!];
      return eff?.selectedValues?.includes(p1Card2.id);
    });
    expect(p1ChoiceIdx).toBeGreaterThanOrEqual(0);

    step = session.submitDecision({
      decisionId: topReqP1.decisionId,
      stateVersion: topReqP1.stateVersion,
      selectedPatternRef: p1ChoiceIdx,
    });

    // P1 の墓地TOPが確定
    expect(state.players.p1.graveTopCardId).toBe(p1Card2.id);

    // --- 検証ステップ B: P2 の墓地TOP選択待ち（P1完了後・P2未完了状態） ---
    expect(step.type).toBe("WAITING_FOR_DECISION");
    const topReqP2 = (step as any).request;
    expect(topReqP2.source?.type).toBe("ZONE_TOP_SELECTION");
    expect(topReqP2.playerId).toBe("p2");

    // まだ P2 の選択が終わっていないため、次ターンのチャージ・ドローは依然として実行されない
    const stageItems2 = state.stage?.queue || [];
    const stageActionIds2 = stageItems2.map((item: any) => item.actionId || item.action?.id);
    expect(stageActionIds2).not.toContain("action.charge");
    expect(stageActionIds2).not.toContain("action.draw");
    expect(topReqP2.actionSelectionRef).toBeUndefined();

    const matchLog2 = session.logRecorder.getMatchLog();
    const turn2Events2 = matchLog2.events.filter(
      (e: any) => e.type === "turn.changed" && e.payload?.turnCount === 2
    );
    expect(turn2Events2.length).toBe(0);

    // P2 が p2Card1 を墓地TOPに選択
    const p2ChoiceIdx = topReqP2.patterns.findIndex((p: any) => {
      const eff = topReqP2.catalog?.effectSelections?.[p.effectSelectionRef!];
      return eff?.selectedValues?.includes(p2Card1.id);
    });
    expect(p2ChoiceIdx).toBeGreaterThanOrEqual(0);

    step = session.submitDecision({
      decisionId: topReqP2.decisionId,
      stateVersion: topReqP2.stateVersion,
      selectedPatternRef: p2ChoiceIdx,
    });

    // 両者の墓地TOPが確定
    expect(state.players.p2.graveTopCardId).toBe(p2Card1.id);
    expect(state.pendingGraveTopSelections?.length).toBe(0);

    // --- 検証ステップ C: 全墓地TOP選択完了後の次ターン（ターン2）正常進行 ---
    while (step.type === "WAITING_FOR_DECISION" && state.turnCount < 2) {
      const cur = (step as any).request;
      step = session.submitDecision({
        decisionId: cur.decisionId,
        stateVersion: cur.stateVersion,
        selectedPatternRef: 0,
      });
    }

    // ターン2が開始し、チャージ・ドローが順序通り完了
    expect(state.turnCount).toBe(2);
    expect(state.turnPlayer).toBe("p2");

    const finalLog = session.logRecorder.getMatchLog();
    const turn2StartLog = finalLog.events.find(
      (e: any) => e.type === "turn.changed" && (e.turnCount === 2 || e.toTurnPlayer === "p2")
    );
    expect(turn2StartLog).toBeDefined();

    verifyCardConservation(state.players.p1, p1InitialIds);
    verifyCardConservation(state.players.p2, p2InitialIds);
  });

  // --------------------------------------------------------------------------
  // Test 2: 正規のプレイヤー決定によるFog作成、エンド・墓地TOP選択、reconstructMatchによる実Undo、別候補への分岐進行、カード保存則（物理IDの完全性）
  // --------------------------------------------------------------------------
  it("Test 2: Replay fidelity, Undo rollback with reconstructMatch, alternate branch progression, and physical card conservation", () => {
    // 1. 正規の公式マスター対戦を起動
    const outcome = startOfficialMatch("mast-strategy");
    const session = outcome.session!;
    const state = session.state;

    const p1InitialIds = new Set(getAllPlayerCardIds(state.players.p1));
    const p2InitialIds = new Set(getAllPlayerCardIds(state.players.p2));
    expect(p1InitialIds.size).toBe(40);
    expect(p2InitialIds.size).toBe(40);

    const transcript: ReplayDecisionEntryV1[] = [];
    let seq = 1;
    const recordDecision = (req: any, patternRef: number) => {
      const entry: ReplayDecisionEntryV1 = {
        seq: seq++,
        actor: "human",
        playerId: req.playerId,
        response: {
          decisionId: req.decisionId,
          stateVersion: req.stateVersion,
          selectedPatternRef: patternRef,
        },
      };
      transcript.push(entry);
      return session.submitDecision({
        decisionId: req.decisionId,
        stateVersion: req.stateVersion,
        selectedPatternRef: patternRef,
      });
    };

    // 2. 正規のプレイヤー決定により Fog を作成 (フォース: action.force)
    // (a) P1 が action.setBulwark を実行して防壁を 2 体にする (コスト BB を充足)
    let step = outcome.initialStep;
    expect(step.type).toBe("WAITING_FOR_DECISION");
    const setBwReq = (step as any).request;
    const setBwRef = setBwReq.patterns.findIndex((p: any) => {
      const act = setBwReq.catalog.actions[p.actionSelectionRef];
      return act?.actionId === "action.setBulwark";
    });
    expect(setBwRef).toBeGreaterThanOrEqual(0);
    step = recordDecision(setBwReq, setBwRef);

    // 手札選択 (selectCards) で手札の0番目を裏向き防壁として配置
    expect(step.type).toBe("WAITING_FOR_DECISION");
    expect((step as any).request.source?.effectStepId).toBe("selectCards");
    const cardSelReq = (step as any).request;
    step = recordDecision(cardSelReq, 0);

    // (b) 防壁が2体になり、手札の H2, H3 により action.force が使用可能！
    expect(step.type).toBe("WAITING_FOR_DECISION");
    const forceReq = (step as any).request;
    const forcePatIdx = forceReq.patterns.findIndex((p: any) => {
      const act = forceReq.catalog.actions[p.actionSelectionRef];
      return act?.actionId === "action.force";
    });
    expect(forcePatIdx).toBeGreaterThanOrEqual(0);

    step = recordDecision(forceReq, forcePatIdx);

    // チャンスでパスを進めてフォース (action.force) をステージから解決
    while (step.type === "WAITING_FOR_DECISION" && state.players.p1.fog.length === 0) {
      const currentReq = (step as any).request;
      const passIdx = currentReq.patterns.findIndex((p: any) => {
        const act = currentReq.catalog?.actions?.[p.actionSelectionRef];
        return !act || act.actionId === "action.pass" || act.actionId === null;
      });
      const choice = passIdx >= 0 ? passIdx : 0;
      step = recordDecision(currentReq, choice);
    }

    // action.force が解決されて Fog 領域に fog.force (カード2枚) が配置される
    expect(state.players.p1.fog.length).toBe(1);
    expect(state.players.p1.fog[0].componentId).toBe("fog.force");
    expect(state.players.p1.fog[0].cards.length).toBe(2);
    const fogCardA = state.players.p1.fog[0].cards[0];
    const fogCardB = state.players.p1.fog[0].cards[1];
    expect(fogCardA).toBeDefined();
    expect(fogCardB).toBeDefined();

    verifyCardConservation(state.players.p1, p1InitialIds);
    verifyCardConservation(state.players.p2, p2InitialIds);

    // 3. P1 が正規アクション action.end を選択
    expect(step.type).toBe("WAITING_FOR_DECISION");
    const endReq = (step as any).request;
    const endPatIdx = endReq.patterns.findIndex((p: any) => {
      const act = endReq.catalog.actions[p.actionSelectionRef];
      return act?.actionId === "action.end";
    });
    expect(endPatIdx).toBeGreaterThanOrEqual(0);
    step = recordDecision(endReq, endPatIdx);

    // チャンスでパスを進めてエンド効果 (cleanupFogs) を解決
    while (step.type === "WAITING_FOR_DECISION" && (step as any).request.source?.type !== "ZONE_TOP_SELECTION") {
      const currentReq = (step as any).request;
      const passIdx = currentReq.patterns.findIndex((p: any) => {
        const act = currentReq.catalog?.actions?.[p.actionSelectionRef];
        return !act || act.actionId === "action.pass" || act.actionId === null;
      });
      const choice = passIdx >= 0 ? passIdx : 0;
      step = recordDecision(currentReq, choice);
    }

    // 4. Fog 同時移動により ZONE_TOP_SELECTION 要求に到達
    expect(step.type).toBe("WAITING_FOR_DECISION");
    const topReq = (step as any).request;
    expect(topReq.source?.type).toBe("ZONE_TOP_SELECTION");
    expect(topReq.playerId).toBe("p1");

    // まずカードA (fogCardA) を墓地TOPに選択 (Branch A)
    const pickCardAIdx = topReq.patterns.findIndex((p: any) => {
      const eff = topReq.catalog?.effectSelections?.[p.effectSelectionRef!];
      return eff?.selectedValues?.includes(fogCardA.id);
    });
    expect(pickCardAIdx).toBeGreaterThanOrEqual(0);
    step = recordDecision(topReq, pickCardAIdx);

    // カードAが墓地TOPに確定
    expect(state.players.p1.graveTopCardId).toBe(fogCardA.id);
    verifyCardConservation(state.players.p1, p1InitialIds);
    verifyCardConservation(state.players.p2, p2InitialIds);

    const transcriptBranchA = [...transcript];

    // 5. 【実Undo検証: reconstructMatch による墓地TOP選択前の状態復元】
    const undoTranscript = transcriptBranchA.slice(0, transcriptBranchA.length - 1);
    const undoRecon = reconstructMatch({
      environmentId: outcome.activeMatch.environmentId,
      seed: outcome.activeMatch.seed,
      rareCardSelections: { p1: validP1Rare as any, p2: validP2Rare as any },
      scenarioHandSelections: { p1: validP1Scenario as any, p2: validP2Scenario as any },
      transcript: undoTranscript,
      catalog,
      fullRulePackage,
      allowUnimplemented: true,
    });

    expect(undoRecon.status).toBe("SUCCESS");
    if (undoRecon.status !== "SUCCESS") {
      throw new Error("Undo reconstruction failed");
    }
    expect(undoRecon.currentStep.type).toBe("WAITING_FOR_DECISION");
    const undoReq = (undoRecon.currentStep as any).request;
    expect(undoReq.source?.type).toBe("ZONE_TOP_SELECTION");
    expect(undoReq.playerId).toBe("p1");

    // 巻き戻し後のセッションにおいて、墓地TOPが undefined (未選択) に復元されていること
    expect(undoRecon.session.state.players.p1.graveTopCardId).toBeUndefined();
    verifyCardConservation(undoRecon.session.state.players.p1, p1InitialIds);
    verifyCardConservation(undoRecon.session.state.players.p2, p2InitialIds);

    // 6. 【別候補への分岐進行: カードB (fogCardB) を選択して進行】
    const pickCardBIdx = undoReq.patterns.findIndex((p: any) => {
      const eff = undoReq.catalog?.effectSelections?.[p.effectSelectionRef!];
      return eff?.selectedValues?.includes(fogCardB.id);
    });
    expect(pickCardBIdx).toBeGreaterThanOrEqual(0);

    const altDecision: ReplayDecisionEntryV1 = {
      seq: undoTranscript.length + 1,
      actor: "human",
      playerId: "p1",
      response: {
        decisionId: undoReq.decisionId,
        stateVersion: undoReq.stateVersion,
        selectedPatternRef: pickCardBIdx,
      },
    };

    let branchBStep = undoRecon.session.submitDecision(altDecision.response);
    const branchBSession = undoRecon.session;
    const branchBState = branchBSession.state;

    // カードBが墓地TOPに確定（別分岐への進行成功）
    expect(branchBState.players.p1.graveTopCardId).toBe(fogCardB.id);
    expect(branchBState.players.p1.graveTopCardId).not.toBe(fogCardA.id);

    const transcriptBranchB = [...undoTranscript, altDecision];

    // 分岐後の対戦を進めてターン2開始まで進行
    while (branchBStep.type === "WAITING_FOR_DECISION" && branchBState.turnCount < 2) {
      const curReq = (branchBStep as any).request;
      const passIdx = curReq.patterns.findIndex((p: any) => {
        const act = curReq.catalog?.actions?.[p.actionSelectionRef];
        return !act || act.actionId === "action.pass" || act.actionId === null;
      });
      const choice = passIdx >= 0 ? passIdx : 0;
      const passEntry: ReplayDecisionEntryV1 = {
        seq: transcriptBranchB.length + 1,
        actor: "human",
        playerId: curReq.playerId,
        response: {
          decisionId: curReq.decisionId,
          stateVersion: curReq.stateVersion,
          selectedPatternRef: choice,
        },
      };
      transcriptBranchB.push(passEntry);
      branchBStep = branchBSession.submitDecision(passEntry.response);
    }

    expect(branchBState.turnCount).toBe(2);
    expect(branchBState.turnPlayer).toBe("p2");
    expect(branchBState.players.p1.graveTopCardId).toBe(fogCardB.id);

    verifyCardConservation(branchBState.players.p1, p1InitialIds);
    verifyCardConservation(branchBState.players.p2, p2InitialIds);

    // 7. 【Canonical Replay 完全検証】
    // 分岐Bの transcript 全体で reconstructMatch を実行し、完全一致 (SUCCESS) を確認
    const fullReplay = reconstructMatch({
      environmentId: outcome.activeMatch.environmentId,
      seed: outcome.activeMatch.seed,
      rareCardSelections: { p1: validP1Rare as any, p2: validP2Rare as any },
      scenarioHandSelections: { p1: validP1Scenario as any, p2: validP2Scenario as any },
      transcript: transcriptBranchB,
      catalog,
      fullRulePackage,
      allowUnimplemented: true,
    });

    expect(fullReplay.status).toBe("SUCCESS");
    if (fullReplay.status !== "SUCCESS") {
      throw new Error("Full replay failed");
    }
    const replayState = fullReplay.session.state;
    expect(replayState.turnCount).toBe(branchBState.turnCount);
    expect(replayState.turnPlayer).toBe(branchBState.turnPlayer);
    expect(replayState.players.p1.graveTopCardId).toBe(fogCardB.id);

    // 物理カードID・Identity の完全一致
    const branchBP1Grave = branchBState.players.p1.grave.flatMap((g: any) => g.cards || [g]);
    const replayP1Grave = replayState.players.p1.grave.flatMap((g: any) => g.cards || [g]);
    expect(replayP1Grave.map((c: any) => c.id).sort()).toEqual(branchBP1Grave.map((c: any) => c.id).sort());

    verifyCardConservation(replayState.players.p1, p1InitialIds);
    verifyCardConservation(replayState.players.p2, p2InitialIds);
  });

  // --------------------------------------------------------------------------
  // Test 3: 全プレイヤーのFog墓地移動完了前に、不完全な盤面を誘発条件・イベントリスナーが参照しないことの実検証
  // --------------------------------------------------------------------------
  it("Test 3: Confirms all fogs are cleared and all cards exist in graves across all players before events dispatch", () => {
    const outcome = startOfficialMatch("mast-strategy");
    const session = outcome.session!;
    const state = session.state;

    // p1 に 2 枚フォースFog、p2 に 2 枚フォースFogをセット
    const p1Card1 = { id: "atom-p1-c1", suit: "D", rank: "5", value: 5 };
    const p1Card2 = { id: "atom-p1-c2", suit: "D", rank: "6", value: 6 };
    const p2Card1 = { id: "atom-p2-c1", suit: "C", rank: "3", value: 3 };
    const p2Card2 = { id: "atom-p2-c2", suit: "C", rank: "4", value: 4 };

    state.players.p1.fog = [
      {
        fogId: "fog-atom-p1",
        componentId: "fog.force",
        cards: [p1Card1, p1Card2],
      },
    ];
    state.players.p2.fog = [
      {
        fogId: "fog-atom-p2",
        componentId: "fog.force",
        cards: [p2Card1, p2Card2],
      },
    ];

    let eventCount = 0;
    const observedChecks: boolean[] = [];

    // イベントリスナーを登録: 最初のカード移動イベントの瞬間から検証
    const atomicListener = () => {
      eventCount++;
      // 1. 全プレイヤーの Fog 領域が既に空であること（事前一括除去完了）
      const p1FogEmpty = state.players.p1.fog.length === 0;
      const p2FogEmpty = state.players.p2.fog.length === 0;

      // 2. 全プレイヤーの移動対象カードが各自の墓地に既に存在していること
      const p1Grave = state.players.p1.grave.flatMap((g: any) => g.cards || [g]);
      const p2Grave = state.players.p2.grave.flatMap((g: any) => g.cards || [g]);

      const p1CardsInGrave =
        p1Grave.some((c: any) => c.id === p1Card1.id) &&
        p1Grave.some((c: any) => c.id === p1Card2.id);

      const p2CardsInGrave =
        p2Grave.some((c: any) => c.id === p2Card1.id) &&
        p2Grave.some((c: any) => c.id === p2Card2.id);

      // 中間状態（P1のカードだけ墓地にありP2のカードがまだ入っていない、など）が絶対に存在しないこと
      observedChecks.push(p1FogEmpty && p2FogEmpty && p1CardsInGrave && p2CardsInGrave);
    };

    const effectInterpreter = (session.registry as any).effectInterpreter;
    const originalDispatch = effectInterpreter.dispatchEvent.bind(effectInterpreter);
    effectInterpreter.dispatchEvent = (event: any, context: any) => {
      if (event?.type === "cardMoved" || event?.type === "fogRemoved") {
        atomicListener();
      }
      return originalDispatch(event, context);
    };

    // cleanupFogsHandler を直接実行
    const handler = cleanupFogsHandler(effectInterpreter);
    handler({}, {
      state,
      components: [
        { id: "fog.force", type: "fog" },
      ],
      logRecorder: session.logRecorder,
      currentAction: { id: "action.end" },
    } as any);

    // イベントが複数回 (カード移動4件 + Fog除去2件 = 6件) 発火したことを確認
    expect(eventCount).toBe(6);
    expect(observedChecks.length).toBe(6);
    // すべてのイベント発火時点で、両プレイヤーのFogが空かつ全カードが墓地に格納済みであったこと
    expect(observedChecks.every((c) => c === true)).toBe(true);

    // 最終盤面でも完全性を確認
    expect(state.players.p1.fog.length).toBe(0);
    expect(state.players.p2.fog.length).toBe(0);
    expect(state.players.p1.graveTopCardId).toBeUndefined();
    expect(state.players.p2.graveTopCardId).toBeUndefined();
    expect(state.pendingGraveTopSelections?.length).toBe(2);
  });
});
