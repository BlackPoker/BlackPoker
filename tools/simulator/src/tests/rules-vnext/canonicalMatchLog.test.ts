import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage } from "../../domain/rules/RulePackage";
import { getCoreBattlePlaytestRulePackage } from "../../engine/rules/RulePackageSelector";
import { GameSession } from "../../engine/session/GameSession";
import { normalizeCardLocation } from "../../engine/log/MatchLogRecorder";

describe("Canonical Match Log Minimal Infrastructure Tests", () => {
  let fullRulePackage: RulePackage;
  let playtestRulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    fullRulePackage = await loadRulePackageFromDirectory(rulesDir);
    playtestRulePackage = getCoreBattlePlaytestRulePackage(fullRulePackage);
  });

  function createBaseState(): any {
    return {
      protocolVersion: "2026-08-vnext",
      matchId: "match-log-test",
      turn: 1,
      turnCount: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      passCount: 0,
      players: {
        p1: {
          name: "Player A",
          life: [
            { id: "l1", suit: "S", rank: "A", value: 1 },
            { id: "l2", suit: "S", rank: "2", value: 2 },
          ],
          hand: [],
          field: [
            {
              unitId: "bw-p1",
              componentId: "character.bulwark",
              kind: "防壁",
              state: "charge",
              cards: [{ id: "c-bw", suit: "H", rank: "2", value: 2 }],
              labels: ["防御"],
            },
          ],
          grave: [],
          fog: [],
          mana: 0,
        },
        p2: {
          name: "Player B",
          life: [
            { id: "l3", suit: "H", rank: "A", value: 1 },
            { id: "l4", suit: "H", rank: "2", value: 2 },
          ],
          hand: [],
          field: [],
          grave: [],
          fog: [],
          mana: 0,
        },
      },
      stage: {
        requests: [],
        history: [],
      },
      requestBuffer: {
        requests: [],
        history: [],
      },
    };
  }

  // --------------------------------------------------------------------------
  // A. Decision Linkage
  // --------------------------------------------------------------------------
  it("A: tracks decision.requested -> decision.responded -> request.created linkage", () => {
    const state = createBaseState();
    const twistKey = { id: "d4-twist", suit: "D", rank: "4", value: 4 };
    const twistCost = { id: "twist-cost", suit: "S", rank: "3", value: 3 };
    state.players.p1.hand = [twistKey, twistCost];

    const session = new GameSession(state, playtestRulePackage, { matchId: "match-test-a" });
    const step1 = session.advance();
    expect(step1.type).toBe("WAITING_FOR_DECISION");
    if (step1.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

    const twistPatternIdx = step1.request.patterns.findIndex(
      (p) => p.kind === "ACTION" && step1.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.twist"
    );
    expect(twistPatternIdx).toBeGreaterThanOrEqual(0);

    session.submitDecision({
      decisionId: step1.request.decisionId,
      stateVersion: step1.request.stateVersion,
      selectedPatternRef: twistPatternIdx,
    });

    const matchLog = session.getMatchLog();
    const decReq = matchLog.events.find((e) => e.type === "decision.requested");
    const decRes = matchLog.events.find((e) => e.type === "decision.responded");
    const reqCre = matchLog.events.find((e) => e.type === "request.created");

    expect(decReq).toBeDefined();
    expect(decRes).toBeDefined();
    expect(reqCre).toBeDefined();

    if (decReq?.type === "decision.requested" && decRes?.type === "decision.responded" && reqCre?.type === "request.created") {
      expect(decReq.decisionId).toBe(step1.request.decisionId);
      expect(decRes.decisionId).toBe(step1.request.decisionId);
      expect(decRes.selectedPatternRef).toBe(twistPatternIdx);
      expect(reqCre.decisionId).toBe(step1.request.decisionId);
      expect(reqCre.actionRef).toBe("action.twist");
    }
  });

  // --------------------------------------------------------------------------
  // B. Normal Request Lifecycle Order
  // --------------------------------------------------------------------------
  it("B: tracks normal Request lifecycle in exact canonical order (created -> stage.pushed -> resolve.started -> stage.popped -> resolved)", () => {
    const state = createBaseState();
    const twistKey = { id: "d4-twist", suit: "D", rank: "4", value: 4 };
    const twistCost = { id: "twist-cost", suit: "S", rank: "3", value: 3 };
    state.players.p1.hand = [twistKey, twistCost];

    const session = new GameSession(state, playtestRulePackage, { matchId: "match-test-b" });
    const step1 = session.advance();
    expect(step1.type).toBe("WAITING_FOR_DECISION");
    if (step1.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

    const twistPatternIdx = step1.request.patterns.findIndex(
      (p) => p.kind === "ACTION" && step1.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.twist"
    );

    // p1 Twist request
    const step2 = session.submitDecision({
      decisionId: step1.request.decisionId,
      stateVersion: step1.request.stateVersion,
      selectedPatternRef: twistPatternIdx,
    });
    expect(step2.type).toBe("WAITING_FOR_DECISION");
    if (step2.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

    // p1 PASS
    const p1Pass = session.submitDecision({
      decisionId: step2.request.decisionId,
      stateVersion: step2.request.stateVersion,
      selectedPatternRef: step2.request.patterns.findIndex((p) => p.kind === "PASS"),
    });
    expect(p1Pass.type).toBe("WAITING_FOR_DECISION");
    if (p1Pass.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

    // p2 PASS -> Twist resolves
    session.submitDecision({
      decisionId: p1Pass.request.decisionId,
      stateVersion: p1Pass.request.stateVersion,
      selectedPatternRef: p1Pass.request.patterns.findIndex((p) => p.kind === "PASS"),
    });

    const matchLog = session.getMatchLog();
    const eventTypes = matchLog.events.map((e) => e.type);

    expect(eventTypes).toContain("request.created");
    expect(eventTypes).toContain("stage.pushed");
    expect(eventTypes).toContain("request.resolve.started");
    expect(eventTypes).toContain("stage.popped");
    expect(eventTypes).toContain("request.resolved");

    const idxCreated = eventTypes.indexOf("request.created");
    const idxPushed = eventTypes.indexOf("stage.pushed");
    const idxStarted = eventTypes.indexOf("request.resolve.started");
    const idxPopped = eventTypes.indexOf("stage.popped");
    const idxResolved = eventTypes.indexOf("request.resolved");

    // 公式ルール順序: created < stage.pushed < resolve.started < stage.popped < resolved
    expect(idxCreated).toBeLessThan(idxPushed);
    expect(idxPushed).toBeLessThan(idxStarted);
    expect(idxStarted).toBeLessThan(idxPopped);
    expect(idxPopped).toBeLessThan(idxResolved);
  });

  // --------------------------------------------------------------------------
  // C. Immediate Request Lifecycle
  // --------------------------------------------------------------------------
  it("C: tracks immediate Request without stage.pushed/stage.popped", () => {
    const state = createBaseState();
    const bulwarkCard = { id: "bw-hand-card", suit: "S", rank: "4", value: 4 };
    state.players.p1.hand = [bulwarkCard];

    const session = new GameSession(state, fullRulePackage, { matchId: "match-test-c" });
    const step1 = session.advance();
    expect(step1.type).toBe("WAITING_FOR_DECISION");
    if (step1.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

    const setBulwarkIdx = step1.request.patterns.findIndex(
      (p) => p.kind === "ACTION" && step1.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.setBulwark"
    );
    expect(setBulwarkIdx).toBeGreaterThanOrEqual(0);

    const step2 = session.submitDecision({
      decisionId: step1.request.decisionId,
      stateVersion: step1.request.stateVersion,
      selectedPatternRef: setBulwarkIdx,
    });

    // 防壁設置の効果中選択（EFFECT_RESOLUTION: カード選択）
    expect(step2.type).toBe("WAITING_FOR_DECISION");
    if (step2.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");
    expect(step2.request.source.type).toBe("EFFECT_RESOLUTION");

    session.submitDecision({
      decisionId: step2.request.decisionId,
      stateVersion: step2.request.stateVersion,
      selectedPatternRef: 0,
    });

    const matchLog = session.getMatchLog();
    const bulwarkEvents = matchLog.events.filter(
      (e) => (e as any).actionRef === "action.setBulwark" || (e as any).requestId?.startsWith("req-")
    );

    const types = bulwarkEvents.map((e) => e.type);
    expect(types).toContain("request.created");
    expect(types).toContain("request.resolve.started");
    expect(types).toContain("request.resolved");
    expect(types).not.toContain("stage.pushed");
    expect(types).not.toContain("stage.popped");
  });

  // --------------------------------------------------------------------------
  // D. End -> Charge -> Draw Lifecycle
  // --------------------------------------------------------------------------
  it("D: tracks End -> Charge (immediate) -> Draw (normal) via generic events without action-specific hardcode", () => {
    const state = createBaseState();
    const session = new GameSession(state, playtestRulePackage, { matchId: "match-test-d" });
    const step1 = session.advance();
    expect(step1.type).toBe("WAITING_FOR_DECISION");
    if (step1.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

    const endPatternIdx = step1.request.patterns.findIndex(
      (p) => p.kind === "ACTION" && step1.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.end"
    );
    expect(endPatternIdx).toBeGreaterThanOrEqual(0);

    const step2 = session.submitDecision({
      decisionId: step1.request.decisionId,
      stateVersion: step1.request.stateVersion,
      selectedPatternRef: endPatternIdx,
    });
    expect(step2.type).toBe("WAITING_FOR_DECISION");
    if (step2.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

    // p1 PASS -> p2 PASS で End 解決 -> ターン交代 -> Charge 誘発即時解決 -> Draw 誘発 Stage 積載
    const p1Pass = session.submitDecision({
      decisionId: step2.request.decisionId,
      stateVersion: step2.request.stateVersion,
      selectedPatternRef: step2.request.patterns.findIndex((p) => p.kind === "PASS"),
    });
    expect(p1Pass.type).toBe("WAITING_FOR_DECISION");
    if (p1Pass.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

    session.submitDecision({
      decisionId: p1Pass.request.decisionId,
      stateVersion: p1Pass.request.stateVersion,
      selectedPatternRef: p1Pass.request.patterns.findIndex((p) => p.kind === "PASS"),
    });

    const matchLog = session.getMatchLog();
    const eventTypes = matchLog.events.map((e) => e.type);

    expect(eventTypes).toContain("turn.changed");
    expect(eventTypes).toContain("trigger.detected");
    expect(eventTypes).toContain("requestBuffer.enqueued");
    expect(eventTypes).toContain("requestBuffer.dequeued");
    expect(eventTypes).toContain("stage.pushed");

    // Charge: speed=immediate
    const chargeCreated = matchLog.events.find(
      (e) => e.type === "request.created" && e.actionRef === "action.charge"
    );
    expect(chargeCreated).toBeDefined();

    // Draw: speed=normal, stage.pushed
    const drawPushed = matchLog.events.find(
      (e) => e.type === "stage.pushed" && e.actionRef === "action.draw"
    );
    expect(drawPushed).toBeDefined();
  });

  // --------------------------------------------------------------------------
  // E. Twist Key Lifecycle & Stage is not Zone
  // --------------------------------------------------------------------------
  it("E: verifies card.moved hand->request and request->grave without treating Stage/Request as zone", () => {
    const state = createBaseState();
    const twistKey = { id: "d4-twist", suit: "D", rank: "4", value: 4 };
    const twistCost = { id: "twist-cost", suit: "S", rank: "3", value: 3 };
    state.players.p1.hand = [twistKey, twistCost];

    const session = new GameSession(state, playtestRulePackage, { matchId: "match-test-e" });
    const step1 = session.advance();
    expect(step1.type).toBe("WAITING_FOR_DECISION");
    if (step1.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

    const twistPatternIdx = step1.request.patterns.findIndex(
      (p) => p.kind === "ACTION" && step1.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.twist"
    );

    const step2 = session.submitDecision({
      decisionId: step1.request.decisionId,
      stateVersion: step1.request.stateVersion,
      selectedPatternRef: twistPatternIdx,
    });
    expect(step2.type).toBe("WAITING_FOR_DECISION");
    if (step2.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

    const p1Pass = session.submitDecision({
      decisionId: step2.request.decisionId,
      stateVersion: step2.request.stateVersion,
      selectedPatternRef: step2.request.patterns.findIndex((p) => p.kind === "PASS"),
    });
    expect(p1Pass.type).toBe("WAITING_FOR_DECISION");
    if (p1Pass.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

    session.submitDecision({
      decisionId: p1Pass.request.decisionId,
      stateVersion: p1Pass.request.stateVersion,
      selectedPatternRef: p1Pass.request.patterns.findIndex((p) => p.kind === "PASS"),
    });

    const matchLog = session.getMatchLog();
    const cardMovedEvents = matchLog.events.filter((e) => e.type === "card.moved") as any[];

    // 1. Stage / Request が zone 扱いされていないことの検証
    for (const cme of cardMovedEvents) {
      if (cme.from.kind === "zone") {
        expect(cme.from.zone).not.toBe("stage");
        expect(cme.from.zone).not.toBe("request");
        expect(cme.from.zone).not.toBe("deck");
      }
      if (cme.to.kind === "zone") {
        expect(cme.to.zone).not.toBe("stage");
        expect(cme.to.zone).not.toBe("request");
        expect(cme.to.zone).not.toBe("deck");
      }
    }

    // 2. Twist key の移動推移: hand -> request -> grave
    const keyHandToReq = cardMovedEvents.find(
      (e) => e.cardId === "d4-twist" && e.from.kind === "zone" && e.from.zone === "hand" && e.to.kind === "request"
    );
    const keyReqToGrave = cardMovedEvents.find(
      (e) => e.cardId === "d4-twist" && e.from.kind === "request" && e.to.kind === "zone" && e.to.zone === "grave"
    );

    expect(keyHandToReq).toBeDefined();
    expect(keyReqToGrave).toBeDefined();
  });

  // --------------------------------------------------------------------------
  // F. Counter Cancellation
  // --------------------------------------------------------------------------
  it("F: tracks request.cancelled when Counter cancels a target request", () => {
    const state = createBaseState();
    const twistKey = { id: "d4-twist-key", suit: "D", rank: "4", value: 4 };
    const twistCost = { id: "twist-cost", suit: "S", rank: "3", value: 3 };
    const counterKey = { id: "c5-counter-key", suit: "C", rank: "5", value: 5 };
    const counterCost = { id: "counter-cost", suit: "S", rank: "4", value: 4 };

    state.players.p1.hand = [twistKey, twistCost];
    state.players.p2.hand = [counterKey, counterCost];
    state.turnPlayer = "p1";
    state.chancePlayer = "p1";

    const session = new GameSession(state, playtestRulePackage, { matchId: "match-test-f" });

    // p1 Twist
    const step1 = session.advance();
    expect(step1.type).toBe("WAITING_FOR_DECISION");
    if (step1.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

    const twistIdx = step1.request.patterns.findIndex(
      (p) => p.kind === "ACTION" && step1.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.twist"
    );
    const step2 = session.submitDecision({
      decisionId: step1.request.decisionId,
      stateVersion: step1.request.stateVersion,
      selectedPatternRef: twistIdx,
    });
    expect(step2.type).toBe("WAITING_FOR_DECISION");
    if (step2.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

    // p1 PASS
    const step3 = session.submitDecision({
      decisionId: step2.request.decisionId,
      stateVersion: step2.request.stateVersion,
      selectedPatternRef: step2.request.patterns.findIndex((p) => p.kind === "PASS"),
    });
    expect(step3.type).toBe("WAITING_FOR_DECISION");
    if (step3.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

    // p2 Counter
    const counterIdx = step3.request.patterns.findIndex(
      (p) => p.kind === "ACTION" && step3.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.counter"
    );
    const step4 = session.submitDecision({
      decisionId: step3.request.decisionId,
      stateVersion: step3.request.stateVersion,
      selectedPatternRef: counterIdx,
    });
    expect(step4.type).toBe("WAITING_FOR_DECISION");
    if (step4.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

    // p2 PASS -> p1 PASS -> Counter resolves and cancels Twist
    const step5 = session.submitDecision({
      decisionId: step4.request.decisionId,
      stateVersion: step4.request.stateVersion,
      selectedPatternRef: step4.request.patterns.findIndex((p) => p.kind === "PASS"),
    });
    expect(step5.type).toBe("WAITING_FOR_DECISION");
    if (step5.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

    session.submitDecision({
      decisionId: step5.request.decisionId,
      stateVersion: step5.request.stateVersion,
      selectedPatternRef: step5.request.patterns.findIndex((p) => p.kind === "PASS"),
    });

    const matchLog = session.getMatchLog();
    const cancelledEvent = matchLog.events.find((e) => e.type === "request.cancelled");

    expect(cancelledEvent).toBeDefined();
    if (cancelledEvent?.type === "request.cancelled") {
      expect(cancelledEvent.actionRef).toBe("action.twist");
      expect(cancelledEvent.controller).toBe("p1");
    }
  });

  // --------------------------------------------------------------------------
  // G. Serializer & No Circular References
  // --------------------------------------------------------------------------
  it("G: CanonicalMatchLog is JSON serializable without circular references", () => {
    const state = createBaseState();
    const session = new GameSession(state, playtestRulePackage, { matchId: "match-test-g" });
    session.advance();

    const matchLog = session.getMatchLog();
    expect(() => JSON.stringify(matchLog)).not.toThrow();

    const jsonStr = JSON.stringify(matchLog, null, 2);
    const parsed = JSON.parse(jsonStr);
    expect(parsed.schemaVersion).toBe("0.1");
    expect(parsed.meta.matchId).toBe("match-test-g");
    expect(Array.isArray(parsed.events)).toBe(true);
  });

  // --------------------------------------------------------------------------
  // H. Match Reset
  // --------------------------------------------------------------------------
  it("H: resets matchId, seq, and events cleanly between matches", () => {
    const state1 = createBaseState();
    const session1 = new GameSession(state1, playtestRulePackage, { matchId: "match-1" });
    session1.advance();
    const log1 = session1.getMatchLog();
    expect(log1.meta.matchId).toBe("match-1");
    expect(log1.events.length).toBeGreaterThan(0);

    const state2 = createBaseState();
    const session2 = new GameSession(state2, playtestRulePackage, { matchId: "match-2" });
    session2.advance();
    const log2 = session2.getMatchLog();
    expect(log2.meta.matchId).toBe("match-2");
    expect(log2.events[0].seq).toBe(1);
    expect(log2.events).not.toEqual(log1.events);
  });

  // --------------------------------------------------------------------------
  // I. No Action-Specific Hardcoded Branching in Logger
  // --------------------------------------------------------------------------
  it("I: verifies generic recording without action-specific branches in MatchLogRecorder", () => {
    const state = createBaseState();
    const session = new GameSession(state, playtestRulePackage, { matchId: "match-test-i" });
    const logRecorder = session.logRecorder;

    const customEvent = logRecorder.record({
      type: "request.created",
      stateVersion: 1,
      requestId: "req-custom-99",
      actionRef: "action.customUnknownAction",
      requester: "p1",
      controller: "p1",
      speed: "normal",
    });

    expect(customEvent.seq).toBe(1);
    expect(customEvent.actionRef).toBe("action.customUnknownAction");
    expect(logRecorder.getMatchLog().events).toContainEqual(customEvent);
  });

  // --------------------------------------------------------------------------
  // J. Exactly-Once Event Emission for 4 Lifecycles (No Duplicate Events)
  // --------------------------------------------------------------------------
  it("J: verifies exactly-once event emission per requestId for direct normal, direct immediate, triggered normal, and triggered immediate", () => {
    // 1. 直接 normal (Twist)
    {
      const state = createBaseState();
      state.players.p1.hand = [
        { id: "d4-twist", suit: "D", rank: "4", value: 4 },
        { id: "twist-cost", suit: "S", rank: "3", value: 3 },
      ];
      const session = new GameSession(state, playtestRulePackage, { matchId: "match-j-direct-normal" });
      const step1 = session.advance();
      expect(step1.type).toBe("WAITING_FOR_DECISION");
      if (step1.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

      const twistIdx = step1.request.patterns.findIndex(
        (p) => p.kind === "ACTION" && step1.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.twist"
      );
      const step2 = session.submitDecision({
        decisionId: step1.request.decisionId,
        stateVersion: step1.request.stateVersion,
        selectedPatternRef: twistIdx,
      });
      expect(step2.type).toBe("WAITING_FOR_DECISION");
      if (step2.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

      const p1Pass = session.submitDecision({
        decisionId: step2.request.decisionId,
        stateVersion: step2.request.stateVersion,
        selectedPatternRef: step2.request.patterns.findIndex((p) => p.kind === "PASS"),
      });
      expect(p1Pass.type).toBe("WAITING_FOR_DECISION");
      if (p1Pass.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

      session.submitDecision({
        decisionId: p1Pass.request.decisionId,
        stateVersion: p1Pass.request.stateVersion,
        selectedPatternRef: p1Pass.request.patterns.findIndex((p) => p.kind === "PASS"),
      });

      const log = session.getMatchLog();
      const twistCreated = log.events.filter((e) => e.type === "request.created" && e.actionRef === "action.twist");
      const twistPushed = log.events.filter((e) => e.type === "stage.pushed" && e.actionRef === "action.twist");
      const twistPopped = log.events.filter((e) => e.type === "stage.popped" && e.actionRef === "action.twist");
      const twistStarted = log.events.filter((e) => e.type === "request.resolve.started" && e.actionRef === "action.twist");
      const twistResolved = log.events.filter((e) => e.type === "request.resolved" && e.actionRef === "action.twist");

      expect(twistCreated).toHaveLength(1);
      expect(twistPushed).toHaveLength(1);
      expect(twistPopped).toHaveLength(1);
      expect(twistStarted).toHaveLength(1);
      expect(twistResolved).toHaveLength(1);
    }

    // 2. 直接 immediate (Bulwark 設置)
    {
      const state = createBaseState();
      state.players.p1.hand = [{ id: "bw-card", suit: "S", rank: "4", value: 4 }];
      const session = new GameSession(state, fullRulePackage, { matchId: "match-j-direct-immediate" });
      const step1 = session.advance();
      expect(step1.type).toBe("WAITING_FOR_DECISION");
      if (step1.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

      const bwIdx = step1.request.patterns.findIndex(
        (p) => p.kind === "ACTION" && step1.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.setBulwark"
      );
      const step2 = session.submitDecision({
        decisionId: step1.request.decisionId,
        stateVersion: step1.request.stateVersion,
        selectedPatternRef: bwIdx,
      });
      expect(step2.type).toBe("WAITING_FOR_DECISION");
      if (step2.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

      session.submitDecision({
        decisionId: step2.request.decisionId,
        stateVersion: step2.request.stateVersion,
        selectedPatternRef: 0,
      });

      const log = session.getMatchLog();
      const bwCreated = log.events.filter((e) => e.type === "request.created" && e.actionRef === "action.setBulwark");
      const bwStarted = log.events.filter((e) => e.type === "request.resolve.started" && e.actionRef === "action.setBulwark");
      const bwResolved = log.events.filter((e) => e.type === "request.resolved" && e.actionRef === "action.setBulwark");
      const bwPushed = log.events.filter((e) => e.type === "stage.pushed" && e.actionRef === "action.setBulwark");
      const bwPopped = log.events.filter((e) => e.type === "stage.popped" && e.actionRef === "action.setBulwark");

      expect(bwCreated).toHaveLength(1);
      expect(bwStarted).toHaveLength(1);
      expect(bwResolved).toHaveLength(1);
      expect(bwPushed).toHaveLength(0);
      expect(bwPopped).toHaveLength(0);
    }

    // 3. 誘発 immediate (Charge) & 4. 誘発 normal (Draw)
    {
      const state = createBaseState();
      const session = new GameSession(state, playtestRulePackage, { matchId: "match-j-triggered" });
      const step1 = session.advance();
      expect(step1.type).toBe("WAITING_FOR_DECISION");
      if (step1.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

      const endIdx = step1.request.patterns.findIndex(
        (p) => p.kind === "ACTION" && step1.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.end"
      );
      const step2 = session.submitDecision({
        decisionId: step1.request.decisionId,
        stateVersion: step1.request.stateVersion,
        selectedPatternRef: endIdx,
      });
      expect(step2.type).toBe("WAITING_FOR_DECISION");
      if (step2.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

      const p1Pass = session.submitDecision({
        decisionId: step2.request.decisionId,
        stateVersion: step2.request.stateVersion,
        selectedPatternRef: step2.request.patterns.findIndex((p) => p.kind === "PASS"),
      });
      expect(p1Pass.type).toBe("WAITING_FOR_DECISION");
      if (p1Pass.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

      // p2 PASS -> End 解決 -> Turn交代 -> Charge即時解決 -> Draw Stage積載
      const step3 = session.submitDecision({
        decisionId: p1Pass.request.decisionId,
        stateVersion: p1Pass.request.stateVersion,
        selectedPatternRef: p1Pass.request.patterns.findIndex((p) => p.kind === "PASS"),
      });

      // Draw 解決のため p2 PASS -> p1 PASS
      expect(step3.type).toBe("WAITING_FOR_DECISION");
      if (step3.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

      const p2Pass = session.submitDecision({
        decisionId: step3.request.decisionId,
        stateVersion: step3.request.stateVersion,
        selectedPatternRef: step3.request.patterns.findIndex((p) => p.kind === "PASS"),
      });
      expect(p2Pass.type).toBe("WAITING_FOR_DECISION");
      if (p2Pass.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

      session.submitDecision({
        decisionId: p2Pass.request.decisionId,
        stateVersion: p2Pass.request.stateVersion,
        selectedPatternRef: p2Pass.request.patterns.findIndex((p) => p.kind === "PASS"),
      });

      const log = session.getMatchLog();

      // 誘発 immediate (Charge)
      const chargeCreated = log.events.filter((e) => e.type === "request.created" && e.actionRef === "action.charge");
      const chargeStarted = log.events.filter((e) => e.type === "request.resolve.started" && e.actionRef === "action.charge");
      const chargeResolved = log.events.filter((e) => e.type === "request.resolved" && e.actionRef === "action.charge");
      const chargePushed = log.events.filter((e) => e.type === "stage.pushed" && e.actionRef === "action.charge");

      expect(chargeCreated).toHaveLength(1);
      expect(chargeStarted).toHaveLength(1);
      expect(chargeResolved).toHaveLength(1);
      expect(chargePushed).toHaveLength(0);

      // 誘発 normal (Draw)
      const drawCreated = log.events.filter((e) => e.type === "request.created" && e.actionRef === "action.draw");
      const drawPushed = log.events.filter((e) => e.type === "stage.pushed" && e.actionRef === "action.draw");
      const drawPopped = log.events.filter((e) => e.type === "stage.popped" && e.actionRef === "action.draw");
      const drawStarted = log.events.filter((e) => e.type === "request.resolve.started" && e.actionRef === "action.draw");
      const drawResolved = log.events.filter((e) => e.type === "request.resolved" && e.actionRef === "action.draw");

      expect(drawCreated).toHaveLength(1);
      expect(drawPushed).toHaveLength(1);
      expect(drawPopped).toHaveLength(1);
      expect(drawStarted).toHaveLength(1);
      expect(drawResolved).toHaveLength(1);
    }
  });

  // --------------------------------------------------------------------------
  // K. Normal Request remains on Stage during effect resolution
  // --------------------------------------------------------------------------
  it("K: verifies that a normal Request remains on state.stage.requests during effect resolution interruption and is removed upon completion", () => {
    // Attack アクション（normal）: 全員PASS後、解決時に Block 誘発 / 効果処理中にも Stage 上に存在することを確認
    const state = createBaseState();
    state.players.p1.field = [
      {
        unitId: "soldier-1",
        componentId: "character.soldier",
        kind: "兵士",
        state: "charge",
        cards: [{ id: "c-sol1", suit: "S", rank: "A", value: 1 }],
        labels: ["アタッカー"],
      },
    ];

    const session = new GameSession(state, playtestRulePackage, { matchId: "match-test-k" });
    const step1 = session.advance();
    expect(step1.type).toBe("WAITING_FOR_DECISION");
    if (step1.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

    const attackPatternIdx = step1.request.patterns.findIndex(
      (p) => p.kind === "ACTION" && step1.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.attack"
    );
    expect(attackPatternIdx).toBeGreaterThanOrEqual(0);

    // p1 Attack リクエスト
    const step2 = session.submitDecision({
      decisionId: step1.request.decisionId,
      stateVersion: step1.request.stateVersion,
      selectedPatternRef: attackPatternIdx,
    });
    expect(step2.type).toBe("WAITING_FOR_DECISION");
    if (step2.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

    // Attack が Stage に積載されていることを確認
    expect(state.stage.requests).toHaveLength(1);
    const attackReqId = state.stage.requests[0].id;
    expect(attackReqId).toBeDefined();

    // p1 PASS
    const step3 = session.submitDecision({
      decisionId: step2.request.decisionId,
      stateVersion: step2.request.stateVersion,
      selectedPatternRef: step2.request.patterns.findIndex((p) => p.kind === "PASS"),
    });
    expect(step3.type).toBe("WAITING_FOR_DECISION");
    if (step3.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

    // p2 PASS -> Attack 解決開始（アタッカー選択へ中断）
    const step4 = session.submitDecision({
      decisionId: step3.request.decisionId,
      stateVersion: step3.request.stateVersion,
      selectedPatternRef: step3.request.patterns.findIndex((p) => p.kind === "PASS"),
    });
    expect(step4.type).toBe("WAITING_FOR_DECISION");
    if (step4.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

    // 【重要】効果解決中断（アタッカー選択待機中）でも、Attack Request は Stage 上にまだ存在することを確認
    expect(state.stage.requests.some((r: any) => r.id === attackReqId)).toBe(true);

    // アタッカー選択を回答して解決完了へ
    session.submitDecision({
      decisionId: step4.request.decisionId,
      stateVersion: step4.request.stateVersion,
      selectedPatternRef: 0,
    });

    // 解決完了後、Attack Request は Stage から取り除かれていることを確認
    expect(state.stage.requests.some((r: any) => r.id === attackReqId)).toBe(false);
  });

  // --------------------------------------------------------------------------
  // L. turn.changed emitted exactly once
  // --------------------------------------------------------------------------
  it("L: verifies turn.changed is emitted exactly once during turn change", () => {
    const state = createBaseState();
    const session = new GameSession(state, playtestRulePackage, { matchId: "match-test-l" });
    const step1 = session.advance();
    expect(step1.type).toBe("WAITING_FOR_DECISION");
    if (step1.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

    const endPatternIdx = step1.request.patterns.findIndex(
      (p) => p.kind === "ACTION" && step1.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.end"
    );

    const step2 = session.submitDecision({
      decisionId: step1.request.decisionId,
      stateVersion: step1.request.stateVersion,
      selectedPatternRef: endPatternIdx,
    });
    expect(step2.type).toBe("WAITING_FOR_DECISION");
    if (step2.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

    const p1Pass = session.submitDecision({
      decisionId: step2.request.decisionId,
      stateVersion: step2.request.stateVersion,
      selectedPatternRef: step2.request.patterns.findIndex((p) => p.kind === "PASS"),
    });
    expect(p1Pass.type).toBe("WAITING_FOR_DECISION");
    if (p1Pass.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

    // p2 PASS -> End resolves -> Turn changes to p2
    session.submitDecision({
      decisionId: p1Pass.request.decisionId,
      stateVersion: p1Pass.request.stateVersion,
      selectedPatternRef: p1Pass.request.patterns.findIndex((p) => p.kind === "PASS"),
    });

    const matchLog = session.getMatchLog();
    const turnChangedEvents = matchLog.events.filter((e) => e.type === "turn.changed");

    // 1回のターン交代に対して turn.changed は正確に 1 件のみ
    expect(turnChangedEvents).toHaveLength(1);
    if (turnChangedEvents[0]?.type === "turn.changed") {
      expect(turnChangedEvents[0].fromTurnPlayer).toBe("p1");
      expect(turnChangedEvents[0].toTurnPlayer).toBe("p2");
      expect(turnChangedEvents[0].turnCount).toBe(2);
    }
  });

  // --------------------------------------------------------------------------
  // M. chance.changed emitted exactly once at all common change boundaries
  // --------------------------------------------------------------------------
  it("M: verifies chance.changed is emitted exactly once per transition without redundant emissions", () => {
    const state = createBaseState();
    const twistKey = { id: "d4-twist", suit: "D", rank: "4", value: 4 };
    const twistCost = { id: "twist-cost", suit: "S", rank: "3", value: 3 };
    state.players.p1.hand = [twistKey, twistCost];

    const session = new GameSession(state, playtestRulePackage, { matchId: "match-test-m" });
    const step1 = session.advance();
    expect(step1.type).toBe("WAITING_FOR_DECISION");
    if (step1.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

    // 1. Twist リクエスト（chanceはp1のまま維持されるためchance.changedなし）
    const twistIdx = step1.request.patterns.findIndex(
      (p) => p.kind === "ACTION" && step1.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.twist"
    );
    const step2 = session.submitDecision({
      decisionId: step1.request.decisionId,
      stateVersion: step1.request.stateVersion,
      selectedPatternRef: twistIdx,
    });
    expect(step2.type).toBe("WAITING_FOR_DECISION");
    if (step2.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

    // 2. p1 PASS -> chance: p1 -> p2 (1件)
    const p1Pass = session.submitDecision({
      decisionId: step2.request.decisionId,
      stateVersion: step2.request.stateVersion,
      selectedPatternRef: step2.request.patterns.findIndex((p) => p.kind === "PASS"),
    });
    expect(p1Pass.type).toBe("WAITING_FOR_DECISION");
    if (p1Pass.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

    // 3. p2 PASS -> Twist 解決 -> chance は手番プレイヤー (p1) へ戻る (1件: p2 -> p1)
    session.submitDecision({
      decisionId: p1Pass.request.decisionId,
      stateVersion: p1Pass.request.stateVersion,
      selectedPatternRef: p1Pass.request.patterns.findIndex((p) => p.kind === "PASS"),
    });

    const matchLog = session.getMatchLog();
    const chanceEvents = matchLog.events.filter((e) => e.type === "chance.changed") as any[];

    // p1 PASS (p1 -> p2) と p2 PASS (p2 -> p1) の2件。解決後の p1 への再代入では二重発行されないこと
    expect(chanceEvents).toHaveLength(2);
    expect(chanceEvents[0].fromChancePlayer).toBe("p1");
    expect(chanceEvents[0].toChancePlayer).toBe("p2");
    expect(chanceEvents[0].reason).toBe("pass");

    expect(chanceEvents[1].fromChancePlayer).toBe("p2");
    expect(chanceEvents[1].toChancePlayer).toBe("p1");
    expect(chanceEvents[1].reason).toBe("pass");
  });


  // --------------------------------------------------------------------------
  // N. unknown CardLocation does not fallback to grave
  // --------------------------------------------------------------------------
  it("N: verifies unknown raw locations are normalized to kind: 'unknown' rather than falling back to grave", () => {
    const loc1 = normalizeCardLocation("void", "p1");
    expect(loc1.kind).toBe("unknown");
    if (loc1.kind === "unknown") {
      expect(loc1.rawLocation).toBe("void");
      expect(loc1.playerId).toBe("p1");
    }

    const loc2 = normalizeCardLocation("limbo", "p2");
    expect(loc2.kind).toBe("unknown");
    if (loc2.kind === "unknown") {
      expect(loc2.rawLocation).toBe("limbo");
    }

    // 正当な Zone および request, deck は期待通りの kind になること
    expect(normalizeCardLocation("hand", "p1").kind).toBe("zone");
    expect(normalizeCardLocation("grave", "p1").kind).toBe("zone");
    expect(normalizeCardLocation("deck", "p1").kind).toBe("deck");
    expect(normalizeCardLocation("request", "p1", "req-1").kind).toBe("request");
  });

  // --------------------------------------------------------------------------
  // O. card.moved uses actual current stateVersion
  // --------------------------------------------------------------------------
  it("O: verifies card.moved records the actual current stateVersion at the time of movement", () => {
    const state = createBaseState();
    state.stateVersion = 10;
    state.version = 10;
    const twistKey = { id: "d4-twist-v10", suit: "D", rank: "4", value: 4 };
    const twistCost = { id: "twist-cost-v10", suit: "S", rank: "3", value: 3 };
    state.players.p1.hand = [twistKey, twistCost];

    const session = new GameSession(state, playtestRulePackage, { matchId: "match-test-o" });
    const step1 = session.advance();
    expect(step1.type).toBe("WAITING_FOR_DECISION");
    if (step1.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

    const twistIdx = step1.request.patterns.findIndex(
      (p) => p.kind === "ACTION" && step1.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.twist"
    );

    // submitDecision により stateVersion は 11 にインクリメントされる
    const step2 = session.submitDecision({
      decisionId: step1.request.decisionId,
      stateVersion: step1.request.stateVersion,
      selectedPatternRef: twistIdx,
    });
    expect(step2.type).toBe("WAITING_FOR_DECISION");
    if (step2.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

    const matchLog = session.getMatchLog();
    const keyHandToReq = matchLog.events.find(
      (e) => e.type === "card.moved" && (e as any).cardId === "d4-twist-v10" && (e as any).to?.kind === "request"
    );

    expect(keyHandToReq).toBeDefined();
    // 移動時の stateVersion (11) が正確に記録されていること（初期値 1 に固定されない）
    expect(keyHandToReq?.stateVersion).toBe(11);
  });
});
