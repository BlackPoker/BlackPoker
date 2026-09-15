import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { OfficialRegulationMatchFactory } from "../../engine/regulation/OfficialRegulationMatchFactory";
import { RegulationRulePackageSelector } from "../../engine/regulation/RegulationRulePackageSelector";
import { loadRegulationCatalog } from "../../engine/regulation/RegulationLoader";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { ObservationFactory } from "../../engine/decision/ObservationFactory";
import { ViewerAwareGameEventFormatter } from "../../engine/session/playtest/ViewerAwareGameEventFormatter";
import {
  startMatchAttempt,
} from "../../engine/playtest/PlaytestEnvironmentController";
import {
  reconstructMatch,
  findUndoTruncationIndex,
} from "../../engine/replay/ReplayReconstructionService";
import { FirstLegalPolicy, RandomPolicy } from "../../engine/simulation/DecisionPolicy";
import { DecisionFeatureEncoder } from "../../engine/ai/DecisionFeatureEncoder";
import { GameSessionSnapshotCodec } from "../../engine/session/GameSessionSnapshotCodec";
import { CommandRegistry } from "../../engine/rules/CommandRegistry";
import { SeededRandom } from "../../engine/random/RandomSource";
import { deriveRuntimeShuffleSeed, shuffleDeterministic } from "../../engine/random/DeterministicShuffle";
import type { ReplayDecisionEntryV1 } from "../../engine/replay/ReplayTypes";
import type {
  CardRevealedEvent,
  CardMovedEvent,
  ZoneShuffledEvent,
} from "../../domain/log/CanonicalMatchLog";
import type { FrameDefinition, RegulationDefinition, RegulationCatalog } from "../../domain/regulation/RegulationDefinition";
import type { RulePackage } from "../../domain/rules/RulePackage";

describe("Official Action Implementation 1.0: Search Foundation Tests (A to T)", () => {
  let catalog: RegulationCatalog;
  let fullRulePackage: RulePackage;
  let testSearchRulePackage: RulePackage;
  let testSearchFrame: FrameDefinition;
  let testSearchRegulation: RegulationDefinition;

  beforeAll(async () => {
    // 1. カタログと fullRulePackage を読み込み
    catalog = await loadRegulationCatalog();
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    fullRulePackage = await loadRulePackageFromDirectory(rulesDir);

    // 2. Jokerを含むテスト用フレーム (16枚固定デッキ)
    testSearchFrame = {
      id: "test-search-frame",
      name: "テストサーチフレーム",
      description: "Jokerを含む決定論的16枚固定デッキフレーム",
      recommendedFormatIds: ["light"],
      deck: {
        type: "fixed",
        cardCount: 16,
        cards: [
          { suit: "S", rank: "A", value: 1 },
          { suit: "S", rank: "2", value: 2 },
          { suit: "S", rank: "3", value: 3 },
          { suit: "J", rank: "Joker", value: 0 },
          { suit: "H", rank: "4", value: 4 },
          { suit: "H", rank: "7", value: 7 },
          { suit: "H", rank: "J", value: 11 },
          { suit: "H", rank: "Q", value: 12 },
          { suit: "D", rank: "5", value: 5 },
          { suit: "D", rank: "8", value: 8 },
          { suit: "D", rank: "10", value: 10 },
          { suit: "D", rank: "Q", value: 12 },
          { suit: "C", rank: "A", value: 1 },
          { suit: "C", rank: "6", value: 6 },
          { suit: "C", rank: "9", value: 9 },
          { suit: "C", rank: "K", value: 13 },
        ],
      },
      setup: {
        initialHandCount: 7,
        preset: {
          bulwarkCount: 1,
          soldierCount: 1,
        },
      },
      actions: ["action.search"],
    };

    // 3. テスト用レギュレーション
    testSearchRegulation = {
      id: "test-search",
      name: "テストサーチ公式レギュレーション",
      formatId: "light",
      frameId: "test-search-frame",
      sourceRulesVersion: "1.0",
    };

    // 4. カタログに登録
    (catalog.frames as Map<string, FrameDefinition>).set("test-search-frame", testSearchFrame);
    (catalog.regulations as Map<string, RegulationDefinition>).set("test-search", testSearchRegulation);

    const lightFormat = catalog.formats.get("light")!;
    testSearchRulePackage = RegulationRulePackageSelector.selectRulePackage(
      fullRulePackage,
      lightFormat,
      testSearchRegulation,
      testSearchFrame
    );
  });

  // ヘルパー: テストセッションを生成し、ターンプレイヤーの手札に Joker が一意に存在するように調整
  async function createTestSearchSession(seed = 42) {
    const session = await OfficialRegulationMatchFactory.createSession("test-search", seed, {
      catalog,
      fullRulePackage: testSearchRulePackage,
    });
    const tp = session.state.turnPlayer;
    const player = session.state.players[tp];

    // 初手決定等でJokerが墓地やライフに入っている可能性を排除し、手札に一意のJokerを配置
    player.grave = (player.grave || []).filter((c: any) => c.rank !== "Joker");
    player.life = player.life.filter((c: any) => c.rank !== "Joker");

    let jokerCard = player.hand.find((c: any) => c.rank === "Joker");
    if (!jokerCard) {
      jokerCard = { id: `${tp}-c-Joker-key`, suit: "Joker", rank: "Joker", value: 0 };
      player.hand.push(jokerCard);
    }
    return { session, tp, jokerCard };
  }

  // Test A: Search Action Resolution via Generic Primitives
  it("Test A: Search Action Resolution via Generic Primitives", async () => {
    const { session, tp } = await createTestSearchSession();
    const player = session.state.players[tp];
    const initialLifeCount = player.life.length;
    const initialHandCount = player.hand.length;

    let step = session.advance();
    expect(step.type).toBe("WAITING_FOR_DECISION");
    if (step.type !== "WAITING_FOR_DECISION") return;

    // Search アクションの Decision を選択
    const searchIdx = step.request.patterns.findIndex(
      (p) => p.kind === "ACTION" && step.request.catalog.actions[p.actionSelectionRef!].actionId === "action.search"
    );
    expect(searchIdx).toBeGreaterThanOrEqual(0);

    const nextStep = session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: searchIdx,
    });

    // selectCards による EFFECT_RESOLUTION 中断
    expect(nextStep.type).toBe("WAITING_FOR_DECISION");
    if (nextStep.type !== "WAITING_FOR_DECISION") return;
    expect(nextStep.request.source.type).toBe("EFFECT_RESOLUTION");

    // 候補カードはライフカード群
    expect(nextStep.request.catalog.effectSelections.length).toBe(player.life.length);

    // 最初のライフカードを選択
    const chosenCardId = nextStep.request.catalog.effectSelections[0].selectedValues[0];
    const afterStep = session.submitDecision({
      decisionId: nextStep.request.decisionId,
      stateVersion: nextStep.request.stateVersion,
      selectedPatternRef: 0,
    });

    // 解決後: ライフ枚数は -1, 手札枚数は (Joker消費 -1 + サーチ獲得 +1) で不変
    expect(player.life.length).toBe(initialLifeCount - 1);
    expect(player.hand.length).toBe(initialHandCount);
    expect(player.hand.some((c: any) => c.id === chosenCardId)).toBe(true);
    // Joker は墓地に送られている
    expect(player.grave.some((c: any) => c.rank === "Joker")).toBe(true);
    expect(afterStep.type === "WAITING_FOR_DECISION" || afterStep.type === "PROGRESSED").toBe(true);
  });

  // Test B: Life Identity Completely Hidden During Action Request
  it("Test B: Life Identity Completely Hidden During Action Request", async () => {
    const { session, tp } = await createTestSearchSession();
    let step = session.advance();
    expect(step.type).toBe("WAITING_FOR_DECISION");

    // アクション要求時点での Observation
    const obs = ObservationFactory.createObservation(session.state, tp);
    const tpObs = obs.players.find((p) => p.playerId === tp)!;

    // ライフの個別カード配列は露出せず、枚数のみが保持される
    expect(tpObs.lifeCount).toBe(session.state.players[tp].life.length);
    expect(tpObs.lifeDisplay).toBeDefined();
    expect((tpObs as any).lifeCards).toBeUndefined();
    expect((tpObs as any).life).toBeUndefined();
  });

  // Test C: Effect Resolution Exposes Life to Chooser Only
  it("Test C: Effect Resolution Exposes Life to Chooser Only", async () => {
    const { session, tp } = await createTestSearchSession();
    const opponent = tp === "p1" ? "p2" : "p1";
    let step = session.advance();
    if (step.type !== "WAITING_FOR_DECISION") return;

    const searchIdx = step.request.patterns.findIndex(
      (p) => p.kind === "ACTION" && step.request.catalog.actions[p.actionSelectionRef!].actionId === "action.search"
    );
    const nextStep = session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: searchIdx,
    });
    if (nextStep.type !== "WAITING_FOR_DECISION") return;

    // Chooser (tp) には candidate カードが提示される
    expect(nextStep.request.playerId).toBe(tp);
    expect(nextStep.request.catalog.effectSelections.length).toBeGreaterThan(0);

    // 対戦相手視点の Observation ではライフカードは依然として秘匿
    const oppObs = ObservationFactory.createObservation(session.state, opponent);
    const tpInOppObs = oppObs.players.find((p) => p.playerId === tp)!;
    expect((tpInOppObs as any).lifeCards).toBeUndefined();
    expect(tpInOppObs.lifeCount).toBe(session.state.players[tp].life.length);
  });

  // Test D: Card Reveal to Opponent During Effect Resolution
  it("Test D: Card Reveal to Opponent During Effect Resolution", async () => {
    const { session } = await createTestSearchSession();
    let step = session.advance();
    if (step.type !== "WAITING_FOR_DECISION") return;

    const searchIdx = step.request.patterns.findIndex(
      (p) => p.kind === "ACTION" && step.request.catalog.actions[p.actionSelectionRef!].actionId === "action.search"
    );
    const nextStep = session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: searchIdx,
    });
    if (nextStep.type !== "WAITING_FOR_DECISION") return;

    const chosenCardId = nextStep.request.catalog.effectSelections[0].selectedValues[0];
    session.submitDecision({
      decisionId: nextStep.request.decisionId,
      stateVersion: nextStep.request.stateVersion,
      selectedPatternRef: 0,
    });

    const canonicalEvents = session.getMatchLog().events;
    const revealEvent = canonicalEvents.find((e) => e.type === "card.revealed") as CardRevealedEvent | undefined;
    expect(revealEvent).toBeDefined();
    expect(revealEvent?.cardId).toBe(chosenCardId);
    expect(revealEvent?.fromZone).toBe("life");
    expect(revealEvent?.revealedTo).toBe("opponent");

    // PresentationEvent のフォーマット確認
    const presentationEvents = ViewerAwareGameEventFormatter.formatCanonicalEvents(
      canonicalEvents,
      session.state,
      "p2"
    );
    const revealPresentation = presentationEvents.find((e) => e.message.includes("[カード公開]"));
    expect(revealPresentation).toBeDefined();
    expect(revealPresentation?.message).toContain("ライフ");
  });

  // Test E: Exact Card Movement from Life to Hand
  it("Test E: Exact Card Movement from Life to Hand", async () => {
    const { session, tp } = await createTestSearchSession();
    const opponent = tp === "p1" ? "p2" : "p1";
    let step = session.advance();
    if (step.type !== "WAITING_FOR_DECISION") return;

    const searchIdx = step.request.patterns.findIndex(
      (p) => p.kind === "ACTION" && step.request.catalog.actions[p.actionSelectionRef!].actionId === "action.search"
    );
    const nextStep = session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: searchIdx,
    });
    if (nextStep.type !== "WAITING_FOR_DECISION") return;

    const chosenCardId = nextStep.request.catalog.effectSelections[0].selectedValues[0];
    session.submitDecision({
      decisionId: nextStep.request.decisionId,
      stateVersion: nextStep.request.stateVersion,
      selectedPatternRef: 0,
    });

    const player = session.state.players[tp];
    expect(player.hand.some((c: any) => c.id === chosenCardId)).toBe(true);
    expect(player.life.some((c: any) => c.id === chosenCardId)).toBe(false);

    // 相手視点では手札移動後は HIDDEN にマスクされる
    const oppObs = ObservationFactory.createObservation(session.state, opponent);
    const tpViewForOpp = oppObs.players.find((p) => p.playerId === tp)!;
    const movedInOpp = tpViewForOpp.handCards.find(
      (c: any) => c.opaqueCardId === chosenCardId || c.opaqueCardId === `hidden-${chosenCardId}`
    );
    expect(movedInOpp).toBeDefined();
    expect(movedInOpp?.visibility).toBe("HIDDEN");
  });

  // Test F: Life Shuffle Execution and Single Event Logging
  it("Test F: Life Shuffle Execution and Single Event Logging", async () => {
    const { session, tp } = await createTestSearchSession();
    let step = session.advance();
    if (step.type !== "WAITING_FOR_DECISION") return;

    const searchIdx = step.request.patterns.findIndex(
      (p) => p.kind === "ACTION" && step.request.catalog.actions[p.actionSelectionRef!].actionId === "action.search"
    );
    const nextStep = session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: searchIdx,
    });
    if (nextStep.type !== "WAITING_FOR_DECISION") return;

    session.submitDecision({
      decisionId: nextStep.request.decisionId,
      stateVersion: nextStep.request.stateVersion,
      selectedPatternRef: 0,
    });

    const canonicalEvents = session.getMatchLog().events;
    const shuffleEvents = canonicalEvents.filter((e) => e.type === "zone.shuffled") as ZoneShuffledEvent[];
    expect(shuffleEvents.length).toBe(1);
    expect(shuffleEvents[0].zone).toBe("life");
    expect(shuffleEvents[0].playerId).toBe(tp);
    expect(shuffleEvents[0].cardCount).toBe(session.state.players[tp].life.length);

    // PresentationEvent のフォーマット確認
    const presentationEvents = ViewerAwareGameEventFormatter.formatCanonicalEvents(
      canonicalEvents,
      session.state
    );
    const shufflePresentation = presentationEvents.find((e) => e.message.includes("[シャッフル]"));
    expect(shufflePresentation).toBeDefined();
    expect(shufflePresentation?.message).toContain("ライフ");
  });

  // Test G: Single-Source Canonical Logging Contract
  it("Test G: Single-Source Canonical Logging Contract", async () => {
    const { session, tp, jokerCard } = await createTestSearchSession();
    let step = session.advance();
    if (step.type !== "WAITING_FOR_DECISION") return;

    const searchIdx = step.request.patterns.findIndex(
      (p) => p.kind === "ACTION" && step.request.catalog.actions[p.actionSelectionRef!].actionId === "action.search"
    );
    const nextStep = session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: searchIdx,
    });
    if (nextStep.type !== "WAITING_FOR_DECISION") return;

    const chosenCardId = nextStep.request.catalog.effectSelections[0].selectedValues[0];
    session.submitDecision({
      decisionId: nextStep.request.decisionId,
      stateVersion: nextStep.request.stateVersion,
      selectedPatternRef: 0,
    });

    const canonicalEvents = session.getMatchLog().events;
    const searchMoveCardEvents = canonicalEvents.filter(
      (e) => e.type === "card.moved" && (e as CardMovedEvent).cardId === chosenCardId
    ) as CardMovedEvent[];
    const searchRevealEvents = canonicalEvents.filter((e) => e.type === "card.revealed") as CardRevealedEvent[];
    const searchShuffleEvents = canonicalEvents.filter((e) => e.type === "zone.shuffled") as ZoneShuffledEvent[];
    const jokerGraveMoveEvents = canonicalEvents.filter(
      (e) => e.type === "card.moved" && (e as CardMovedEvent).cardId === jokerCard.id && ((e as CardMovedEvent).to as any).zone === "grave"
    ) as CardMovedEvent[];

    // 厳格な単一発行検証 (重複なし)
    expect(searchMoveCardEvents.length).toBe(1);
    expect((searchMoveCardEvents[0].from as any).zone).toBe("life");
    expect((searchMoveCardEvents[0].to as any).zone).toBe("hand");

    expect(searchRevealEvents.length).toBe(1);
    expect(searchRevealEvents[0].cardId).toBe(chosenCardId);

    expect(searchShuffleEvents.length).toBe(1);

    expect(jokerGraveMoveEvents.length).toBe(1);
  });

  // Test H: Strict Fail-Closed Verification When matchSeed is Missing
  it("Test H: Strict Fail-Closed Verification When matchSeed is Missing", () => {
    const registry = new CommandRegistry();
    // matchSeed を未設定のままにする
    expect(registry.getMatchSeed()).toBeUndefined();

    const mockState = {
      players: {
        p1: { life: [{ id: "c1" }, { id: "c2" }] },
      },
    };

    expect(() => {
      registry.execute("shuffleZone", { zone: "life", player: "p1" }, {
        state: mockState,
        playerKey: "p1",
      });
    }).toThrow("matchSeed is required for deterministic shuffle but was undefined. Fallback is prohibited.");
  });

  // Test I: Deterministic Runtime Shuffle Reproducibility
  it("Test I: Deterministic Runtime Shuffle Reproducibility", () => {
    const baseSeed = 98765;
    const counter = 1;
    const seed = deriveRuntimeShuffleSeed(baseSeed, counter);

    const cards = [
      { id: "c1", rank: "A" },
      { id: "c2", rank: "2" },
      { id: "c3", rank: "3" },
      { id: "c4", rank: "4" },
      { id: "c5", rank: "5" },
    ];

    const run1 = shuffleDeterministic(cards, new SeededRandom(seed));
    const run2 = shuffleDeterministic(cards, new SeededRandom(seed));
    const run3 = shuffleDeterministic(cards, new SeededRandom(seed));

    expect(run1.map((c) => c.id)).toEqual(run2.map((c) => c.id));
    expect(run2.map((c) => c.id)).toEqual(run3.map((c) => c.id));
  });

  // Test J: Replay Reconstruction E2E with Search Action
  it("Test J: Replay Reconstruction E2E with Search Action", async () => {
    const seed = 54321;
    const outcome = startMatchAttempt({
      environmentId: "official:test-search",
      seedInput: String(seed),
      catalog,
      fullRulePackage: testSearchRulePackage,
    });
    if (outcome.type !== "READY") throw new Error("Expected READY");
    const session = outcome.session;
    const tp = session.state.turnPlayer;

    // 手札に Joker が存在することを確認
    if (!session.state.players[tp].hand.some((c: any) => c.rank === "Joker")) {
      const jkIdx = session.state.players[tp].life.findIndex((c: any) => c.rank === "Joker");
      if (jkIdx !== -1) {
        const [jk] = session.state.players[tp].life.splice(jkIdx, 1);
        session.state.players[tp].hand.push(jk);
      }
    }

    const transcript: ReplayDecisionEntryV1[] = [];
    let step = session.advance();
    if (step.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");
    const step1 = step;

    // Decision 1: action.search
    const searchIdx = step1.request.patterns.findIndex(
      (p) => p.kind === "ACTION" && step1.request.catalog.actions[p.actionSelectionRef!].actionId === "action.search"
    );
    const d1: ReplayDecisionEntryV1 = {
      seq: 1,
      actor: "human",
      playerId: step1.request.playerId as "p1" | "p2",
      response: {
        decisionId: step1.request.decisionId,
        stateVersion: step1.request.stateVersion,
        selectedPatternRef: searchIdx,
      },
    };
    transcript.push(d1);
    step = session.submitDecision(d1.response);

    // Decision 2: selectCards
    if (step.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");
    const step2 = step;
    const d2: ReplayDecisionEntryV1 = {
      seq: 2,
      actor: "human",
      playerId: step2.request.playerId as "p1" | "p2",
      response: {
        decisionId: step2.request.decisionId,
        stateVersion: step2.request.stateVersion,
        selectedPatternRef: 0,
      },
    };
    transcript.push(d2);
    session.submitDecision(d2.response);

    // reconstructMatch で Replay を再構築
    const recon = reconstructMatch({
      environmentId: "official:test-search",
      seed,
      transcript,
      catalog,
      fullRulePackage: testSearchRulePackage,
    });

    expect(recon.status).toBe("SUCCESS");
    if (recon.status !== "SUCCESS") throw new Error("Reconstruction failed");

    // ライフ順序、手札、墓地、runtimeShuffleCount の完全一致
    const origState = session.state;
    const reconState = recon.session.state;

    expect(reconState.runtimeShuffleCount).toBe(origState.runtimeShuffleCount);
    expect(reconState.players[tp].life.map((c: any) => c.id)).toEqual(
      origState.players[tp].life.map((c: any) => c.id)
    );
    expect(reconState.players[tp].hand.map((c: any) => c.id)).toEqual(
      origState.players[tp].hand.map((c: any) => c.id)
    );
    expect(reconState.players[tp].grave.map((c: any) => c.id)).toEqual(
      origState.players[tp].grave.map((c: any) => c.id)
    );
  });

  // Test K: Undo Support for Search Action
  it("Test K: Undo Support for Search Action", async () => {
    const seed = 54321;
    const outcome = startMatchAttempt({
      environmentId: "official:test-search",
      seedInput: String(seed),
      catalog,
      fullRulePackage: testSearchRulePackage,
    });
    if (outcome.type !== "READY") throw new Error("Expected READY");
    const session = outcome.session;
    const tp = session.state.turnPlayer;

    const jkIdx = session.state.players[tp].life.findIndex((c: any) => c.rank === "Joker");
    if (jkIdx !== -1) {
      const [jk] = session.state.players[tp].life.splice(jkIdx, 1);
      session.state.players[tp].hand.push(jk);
    }

    const transcript: ReplayDecisionEntryV1[] = [];
    let step = session.advance();
    if (step.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");
    const step1 = step;

    const searchIdx = step1.request.patterns.findIndex(
      (p) => p.kind === "ACTION" && step1.request.catalog.actions[p.actionSelectionRef!].actionId === "action.search"
    );
    const d1: ReplayDecisionEntryV1 = {
      seq: 1,
      actor: "human",
      playerId: step1.request.playerId as "p1" | "p2",
      response: {
        decisionId: step1.request.decisionId,
        stateVersion: step1.request.stateVersion,
        selectedPatternRef: searchIdx,
      },
    };
    transcript.push(d1);
    step = session.submitDecision(d1.response);
    if (step.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");
    const step2 = step;

    // 効果選択の決定
    const d2: ReplayDecisionEntryV1 = {
      seq: 2,
      actor: "human",
      playerId: step2.request.playerId as "p1" | "p2",
      response: {
        decisionId: step2.request.decisionId,
        stateVersion: step2.request.stateVersion,
        selectedPatternRef: 0,
      },
    };
    transcript.push(d2);

    // findUndoTruncationIndex による直前 Undo (末尾のhuman決定 d2 を切り落とすため index 1 が返る)
    const undoIdx = findUndoTruncationIndex(transcript);
    expect(undoIdx).toBe(1);

    const reconUndo = reconstructMatch({
      environmentId: "official:test-search",
      seed,
      transcript: transcript.slice(0, undoIdx),
      catalog,
      fullRulePackage: testSearchRulePackage,
    });
    expect(reconUndo.status).toBe("SUCCESS");
    if (reconUndo.status !== "SUCCESS") throw new Error("Undo reconstruction failed");

    // Undo 後は selectCards の EFFECT_RESOLUTION 待機状態に戻っている
    expect(reconUndo.currentDecisionRequest?.source.type).toBe("EFFECT_RESOLUTION");
  });

  // Test L: Branching After Undo with Search Action
  it("Test L: Branching After Undo with Search Action", async () => {
    const seed = 54321;
    const outcome = startMatchAttempt({
      environmentId: "official:test-search",
      seedInput: String(seed),
      catalog,
      fullRulePackage: testSearchRulePackage,
    });
    if (outcome.type !== "READY") throw new Error("Expected READY");
    const session = outcome.session;
    const tp = session.state.turnPlayer;

    const jkIdx = session.state.players[tp].life.findIndex((c: any) => c.rank === "Joker");
    if (jkIdx !== -1) {
      const [jk] = session.state.players[tp].life.splice(jkIdx, 1);
      session.state.players[tp].hand.push(jk);
    }

    let step = session.advance();
    if (step.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");
    const step1 = step;

    const searchIdx = step1.request.patterns.findIndex(
      (p) => p.kind === "ACTION" && step1.request.catalog.actions[p.actionSelectionRef!].actionId === "action.search"
    );
    const d1: ReplayDecisionEntryV1 = {
      seq: 1,
      actor: "human",
      playerId: step1.request.playerId as "p1" | "p2",
      response: {
        decisionId: step1.request.decisionId,
        stateVersion: step1.request.stateVersion,
        selectedPatternRef: searchIdx,
      },
    };
    step = session.submitDecision(d1.response);
    if (step.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");
    const step2 = step;

    // Branch A: 候補 0 を選択
    const reconA = reconstructMatch({
      environmentId: "official:test-search",
      seed,
      transcript: [
        d1,
        {
          seq: 2,
          actor: "human",
          playerId: step2.request.playerId as "p1" | "p2",
          response: {
            decisionId: step2.request.decisionId,
            stateVersion: step2.request.stateVersion,
            selectedPatternRef: 0,
          },
        },
      ],
      catalog,
      fullRulePackage: testSearchRulePackage,
    });

    // Branch B: 候補 1 を選択
    const reconB = reconstructMatch({
      environmentId: "official:test-search",
      seed,
      transcript: [
        d1,
        {
          seq: 2,
          actor: "human",
          playerId: step2.request.playerId as "p1" | "p2",
          response: {
            decisionId: step2.request.decisionId,
            stateVersion: step2.request.stateVersion,
            selectedPatternRef: 1,
          },
        },
      ],
      catalog,
      fullRulePackage: testSearchRulePackage,
    });

    expect(reconA.status).toBe("SUCCESS");
    expect(reconB.status).toBe("SUCCESS");
    if (reconA.status !== "SUCCESS" || reconB.status !== "SUCCESS") return;

    // 手札とライフのカード構成が Branch A と Branch B で異なる
    const handA = reconA.session.state.players[tp].hand.map((c: any) => c.id);
    const handB = reconB.session.state.players[tp].hand.map((c: any) => c.id);
    expect(handA).not.toEqual(handB);
  });

  // Test M: Snapshot Capture and Resume During Search Effect Resolution
  it("Test M: Snapshot Capture and Resume During Search Effect Resolution", async () => {
    const { session, tp } = await createTestSearchSession();
    let step = session.advance();
    if (step.type !== "WAITING_FOR_DECISION") return;

    const searchIdx = step.request.patterns.findIndex(
      (p) => p.kind === "ACTION" && step.request.catalog.actions[p.actionSelectionRef!].actionId === "action.search"
    );
    const nextStep = session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: searchIdx,
    });
    if (nextStep.type !== "WAITING_FOR_DECISION") return;

    // 中断状態（selectCards 待機中）でスナップショットを取得
    const snapshot = GameSessionSnapshotCodec.capture(session);
    expect(snapshot.session.matchSeed).toBe(session.matchSeed);

    // スナップショットから復元
    const resumedSession = GameSessionSnapshotCodec.restore(snapshot, testSearchRulePackage);
    expect(resumedSession.matchSeed).toBe(session.matchSeed);

    // 復元されたセッションでカード選択を適用
    const resumeStep = resumedSession.submitDecision({
      decisionId: nextStep.request.decisionId,
      stateVersion: nextStep.request.stateVersion,
      selectedPatternRef: 0,
    });

    // 正常に効果が完了し、ライフがシャッフルされる
    expect(resumedSession.state.players[tp].life.length).toBe(session.state.players[tp].life.length - 1);
    expect(resumedSession.state.runtimeShuffleCount).toBe(1);
    expect(resumeStep.type === "WAITING_FOR_DECISION" || resumeStep.type === "PROGRESSED").toBe(true);
  });

  // Test N: AI Agent Compatibility with Search Decision
  it("Test N: AI Agent Compatibility with Search Decision (FirstLegal, Random, Encoder)", async () => {
    const { session } = await createTestSearchSession();
    let step = session.advance();
    if (step.type !== "WAITING_FOR_DECISION") return;

    const searchIdx = step.request.patterns.findIndex(
      (p) => p.kind === "ACTION" && step.request.catalog.actions[p.actionSelectionRef!].actionId === "action.search"
    );
    const nextStep = session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: searchIdx,
    });
    if (nextStep.type !== "WAITING_FOR_DECISION") return;

    // 1. FirstLegalPolicy
    const firstLegal = new FirstLegalPolicy();
    const flDecision = firstLegal.choose(nextStep.request);
    expect(flDecision.selectedPatternRef).toBe(0);

    // 2. RandomPolicy
    const randomPolicy = new RandomPolicy(new SeededRandom(123));
    const rndDecision = randomPolicy.choose(nextStep.request);
    expect(rndDecision.selectedPatternRef).toBeGreaterThanOrEqual(0);
    expect(rndDecision.selectedPatternRef).toBeLessThan(nextStep.request.patterns.length);

    // 3. DecisionFeatureEncoder (1482次元特徴量エンコーダ)
    const encoded = DecisionFeatureEncoder.encode(nextStep.request);
    expect(encoded.featureSchemaVersion).toBe(1);
    expect(encoded.context.values.length).toBe(DecisionFeatureEncoder.CONTEXT_DIMENSION);
    expect(encoded.patterns.length).toBe(nextStep.request.patterns.length);
  });

  // Test O: Key Card Finalization (Joker Hand -> Grave via finalizeRequestKeyCards)
  it("Test O: Key Card Finalization (Joker Hand -> Grave via finalizeRequestKeyCards)", async () => {
    const { session, tp, jokerCard } = await createTestSearchSession();
    const player = session.state.players[tp];

    expect(player.hand.some((c: any) => c.id === jokerCard.id)).toBe(true);
    expect(player.grave.some((c: any) => c.id === jokerCard.id)).toBe(false);

    let step = session.advance();
    if (step.type !== "WAITING_FOR_DECISION") return;

    const searchIdx = step.request.patterns.findIndex(
      (p) => p.kind === "ACTION" && step.request.catalog.actions[p.actionSelectionRef!].actionId === "action.search"
    );
    const nextStep = session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: searchIdx,
    });
    if (nextStep.type !== "WAITING_FOR_DECISION") return;

    // リクエスト作成後、Joker は手札から消費されている
    expect(player.hand.some((c: any) => c.id === jokerCard.id)).toBe(false);

    // 効果選択完了
    session.submitDecision({
      decisionId: nextStep.request.decisionId,
      stateVersion: nextStep.request.stateVersion,
      selectedPatternRef: 0,
    });

    // 最終化後、Joker は墓地に配置されている
    expect(player.grave.some((c: any) => c.id === jokerCard.id)).toBe(true);
  });

  // Test P: Multi-Step Effect Resolution Continuity
  it("Test P: Multi-Step Effect Resolution Continuity", async () => {
    const { session, tp } = await createTestSearchSession();
    let step = session.advance();
    if (step.type !== "WAITING_FOR_DECISION") return;

    const searchIdx = step.request.patterns.findIndex(
      (p) => p.kind === "ACTION" && step.request.catalog.actions[p.actionSelectionRef!].actionId === "action.search"
    );
    const nextStep = session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: searchIdx,
    });
    if (nextStep.type !== "WAITING_FOR_DECISION") return;

    // continuation が保持されている
    expect(session.continuation).toBeDefined();
    expect(session.continuation?.effectPath[0]).toBe(0);

    session.submitDecision({
      decisionId: nextStep.request.decisionId,
      stateVersion: nextStep.request.stateVersion,
      selectedPatternRef: 0,
    });

    // 全ステップ解決後は continuation がクリアされる
    expect(session.continuation).toBeUndefined();
  });

  // Test Q: Empty or Single-Card Life Edge Cases
  it("Test Q: Empty or Single-Card Life Edge Cases", async () => {
    // 1. Single card life
    {
      const { session, tp } = await createTestSearchSession();
      const player = session.state.players[tp];
      player.life = [player.life[0]]; // 1枚のみ

      let step = session.advance();
      if (step.type !== "WAITING_FOR_DECISION") return;

      const searchIdx = step.request.patterns.findIndex(
        (p) => p.kind === "ACTION" && step.request.catalog.actions[p.actionSelectionRef!].actionId === "action.search"
      );
      const nextStep = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: searchIdx,
      });
      if (nextStep.type !== "WAITING_FOR_DECISION") return;

      expect(nextStep.request.catalog.effectSelections.length).toBe(1);
      session.submitDecision({
        decisionId: nextStep.request.decisionId,
        stateVersion: nextStep.request.stateVersion,
        selectedPatternRef: 0,
      });

      expect(player.life.length).toBe(0);
      expect(session.state.runtimeShuffleCount).toBe(1);
    }

    // 2. Empty life
    {
      const { session, tp } = await createTestSearchSession();
      const player = session.state.players[tp];
      player.life = []; // 0枚

      let step = session.advance();
      if (step.type !== "WAITING_FOR_DECISION") return;

      const searchIdx = step.request.patterns.findIndex(
        (p) => p.kind === "ACTION" && step.request.catalog.actions[p.actionSelectionRef!].actionId === "action.search"
      );
      const nextStep = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: searchIdx,
      });

      // candidates が 0枚の場合は中断せず直ちに後続ステップを実行し完了
      expect(player.life.length).toBe(0);
      expect(session.state.runtimeShuffleCount).toBe(1);
    }
  });

  // Test R: Opponent State Isolation
  it("Test R: Opponent State Isolation", async () => {
    const { session, tp } = await createTestSearchSession();
    const opponent = tp === "p1" ? "p2" : "p1";
    const oppHandBefore = [...session.state.players[opponent].hand];
    const oppLifeBefore = [...session.state.players[opponent].life];
    const oppFieldBefore = [...session.state.players[opponent].field];

    let step = session.advance();
    if (step.type !== "WAITING_FOR_DECISION") return;

    const searchIdx = step.request.patterns.findIndex(
      (p) => p.kind === "ACTION" && step.request.catalog.actions[p.actionSelectionRef!].actionId === "action.search"
    );
    const nextStep = session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: searchIdx,
    });
    if (nextStep.type !== "WAITING_FOR_DECISION") return;

    session.submitDecision({
      decisionId: nextStep.request.decisionId,
      stateVersion: nextStep.request.stateVersion,
      selectedPatternRef: 0,
    });

    const oppHandAfter = session.state.players[opponent].hand;
    const oppLifeAfter = session.state.players[opponent].life;
    const oppFieldAfter = session.state.players[opponent].field;

    expect(oppHandAfter).toEqual(oppHandBefore);
    expect(oppLifeAfter).toEqual(oppLifeBefore);
    expect(oppFieldAfter).toEqual(oppFieldBefore);
  });

  // Test S: Multiple Consecutive Searches and Counter Tracking
  it("Test S: Multiple Consecutive Searches and Counter Tracking", async () => {
    const { session, tp } = await createTestSearchSession();
    const player = session.state.players[tp];
    // 手札に2枚目の Joker を追加
    player.hand.push({ id: `${tp}-c-Joker-2`, suit: "Joker", rank: "Joker", value: 0 });

    // 1回目のサーチ
    let step = session.advance();
    if (step.type !== "WAITING_FOR_DECISION") return;
    const step1 = step;
    let searchIdx = step1.request.patterns.findIndex(
      (p) => p.kind === "ACTION" && step1.request.catalog.actions[p.actionSelectionRef!].actionId === "action.search"
    );
    let nextStep = session.submitDecision({
      decisionId: step1.request.decisionId,
      stateVersion: step1.request.stateVersion,
      selectedPatternRef: searchIdx,
    });
    if (nextStep.type !== "WAITING_FOR_DECISION") return;
    session.submitDecision({
      decisionId: nextStep.request.decisionId,
      stateVersion: nextStep.request.stateVersion,
      selectedPatternRef: 0,
    });
    expect(session.state.runtimeShuffleCount).toBe(1);

    // 2回目のサーチ
    step = session.advance();
    if (step.type !== "WAITING_FOR_DECISION") return;
    const step2 = step;
    searchIdx = step2.request.patterns.findIndex(
      (p) => p.kind === "ACTION" && step2.request.catalog.actions[p.actionSelectionRef!].actionId === "action.search"
    );
    if (searchIdx !== -1) {
      nextStep = session.submitDecision({
        decisionId: step2.request.decisionId,
        stateVersion: step2.request.stateVersion,
        selectedPatternRef: searchIdx,
      });
      if (nextStep.type === "WAITING_FOR_DECISION") {
        session.submitDecision({
          decisionId: nextStep.request.decisionId,
          stateVersion: nextStep.request.stateVersion,
          selectedPatternRef: 0,
        });
        expect(session.state.runtimeShuffleCount).toBe(2);
      }
    }
  });

  // Test T: Backward Compatibility with Existing Pack / Bulwark / Attack Primitives
  it("Test T: Backward Compatibility with Existing Pack / Bulwark / Attack Primitives", async () => {
    // light-pack セッションで既存機能に一切の影響がないことを確認
    const packSession = await OfficialRegulationMatchFactory.createSession("light-pack", 42, {
      catalog,
      fullRulePackage,
    });
    expect(packSession.state.regulationId).toBe("light-pack");
    expect(packSession.state.players.p1.pack.count).toBe(14);
    expect(packSession.state.players.p1.field.length).toBe(2);

    const step = packSession.advance();
    expect(step.type).toBe("WAITING_FOR_DECISION");
    if (step.type !== "WAITING_FOR_DECISION") return;
    const waitingPackStep = step;

    // packOpen アクションが問題なく提示される
    const packOpenIdx = waitingPackStep.request.patterns.findIndex(
      (p) => p.kind === "ACTION" && waitingPackStep.request.catalog.actions[p.actionSelectionRef!].actionId === "action.packOpen"
    );
    expect(packOpenIdx).toBeGreaterThanOrEqual(0);
  });
});
