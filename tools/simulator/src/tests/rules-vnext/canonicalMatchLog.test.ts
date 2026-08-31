import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage } from "../../domain/rules/RulePackage";
import { getCoreBattlePlaytestRulePackage } from "../../engine/rules/RulePackageSelector";
import { GameSession } from "../../engine/session/GameSession";
import { CommandRegistry } from "../../engine/rules/CommandRegistry";
import { CanonicalMatchLog } from "../../domain/log/CanonicalMatchLog";

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
    if (step1.type !== "WAITING_FOR_DECISION") return;

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
  // B. Normal Request Lifecycle
  // --------------------------------------------------------------------------
  it("B: tracks normal Request lifecycle (created -> stage.pushed -> resolve.started -> stage.popped -> resolved)", () => {
    const state = createBaseState();
    const twistKey = { id: "d4-twist", suit: "D", rank: "4", value: 4 };
    const twistCost = { id: "twist-cost", suit: "S", rank: "3", value: 3 };
    state.players.p1.hand = [twistKey, twistCost];

    const session = new GameSession(state, playtestRulePackage, { matchId: "match-test-b" });
    const step1 = session.advance();
    if (step1.type !== "WAITING_FOR_DECISION") return;

    const twistPatternIdx = step1.request.patterns.findIndex(
      (p) => p.kind === "ACTION" && step1.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.twist"
    );

    // p1 Twist request
    const step2 = session.submitDecision({
      decisionId: step1.request.decisionId,
      stateVersion: step1.request.stateVersion,
      selectedPatternRef: twistPatternIdx,
    });

    // p1 PASS
    if (step2.type !== "WAITING_FOR_DECISION") return;
    const p1Pass = session.submitDecision({
      decisionId: step2.request.decisionId,
      stateVersion: step2.request.stateVersion,
      selectedPatternRef: step2.request.patterns.findIndex((p) => p.kind === "PASS"),
    });

    // p2 PASS -> Twist resolves
    if (p1Pass.type !== "WAITING_FOR_DECISION") return;
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

    expect(idxCreated).toBeLessThan(idxPushed);
    expect(idxPushed).toBeLessThan(idxStarted);
    expect(idxPopped).toBeLessThan(idxStarted);
    expect(idxStarted).toBeLessThan(idxResolved);
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
    if (step1.type !== "WAITING_FOR_DECISION") return;

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
    if (step2.type !== "WAITING_FOR_DECISION") return;
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
    // p1 ターン、p1 が End をリクエスト
    const session = new GameSession(state, playtestRulePackage, { matchId: "match-test-d" });
    const step1 = session.advance();
    if (step1.type !== "WAITING_FOR_DECISION") return;

    const endPatternIdx = step1.request.patterns.findIndex(
      (p) => p.kind === "ACTION" && step1.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.end"
    );
    expect(endPatternIdx).toBeGreaterThanOrEqual(0);

    const step2 = session.submitDecision({
      decisionId: step1.request.decisionId,
      stateVersion: step1.request.stateVersion,
      selectedPatternRef: endPatternIdx,
    });

    // p1 PASS -> p2 PASS で End 解決 -> ターン交代 -> Charge 誘発即時解決 -> Draw 誘発 Stage 積載
    if (step2.type !== "WAITING_FOR_DECISION") return;
    const p1Pass = session.submitDecision({
      decisionId: step2.request.decisionId,
      stateVersion: step2.request.stateVersion,
      selectedPatternRef: step2.request.patterns.findIndex((p) => p.kind === "PASS"),
    });

    if (p1Pass.type !== "WAITING_FOR_DECISION") return;
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
    if (step1.type !== "WAITING_FOR_DECISION") return;

    const twistPatternIdx = step1.request.patterns.findIndex(
      (p) => p.kind === "ACTION" && step1.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.twist"
    );

    const step2 = session.submitDecision({
      decisionId: step1.request.decisionId,
      stateVersion: step1.request.stateVersion,
      selectedPatternRef: twistPatternIdx,
    });

    if (step2.type !== "WAITING_FOR_DECISION") return;
    const p1Pass = session.submitDecision({
      decisionId: step2.request.decisionId,
      stateVersion: step2.request.stateVersion,
      selectedPatternRef: step2.request.patterns.findIndex((p) => p.kind === "PASS"),
    });

    if (p1Pass.type !== "WAITING_FOR_DECISION") return;
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
      }
      if (cme.to.kind === "zone") {
        expect(cme.to.zone).not.toBe("stage");
        expect(cme.to.zone).not.toBe("request");
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
    if (step1.type !== "WAITING_FOR_DECISION") return;
    const twistIdx = step1.request.patterns.findIndex(
      (p) => p.kind === "ACTION" && step1.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.twist"
    );
    const step2 = session.submitDecision({
      decisionId: step1.request.decisionId,
      stateVersion: step1.request.stateVersion,
      selectedPatternRef: twistIdx,
    });

    // p1 PASS
    if (step2.type !== "WAITING_FOR_DECISION") return;
    const step3 = session.submitDecision({
      decisionId: step2.request.decisionId,
      stateVersion: step2.request.stateVersion,
      selectedPatternRef: step2.request.patterns.findIndex((p) => p.kind === "PASS"),
    });

    // p2 Counter
    if (step3.type !== "WAITING_FOR_DECISION") return;
    const counterIdx = step3.request.patterns.findIndex(
      (p) => p.kind === "ACTION" && step3.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.counter"
    );
    const step4 = session.submitDecision({
      decisionId: step3.request.decisionId,
      stateVersion: step3.request.stateVersion,
      selectedPatternRef: counterIdx,
    });

    // p2 PASS -> p1 PASS -> Counter resolves and cancels Twist
    if (step4.type !== "WAITING_FOR_DECISION") return;
    const step5 = session.submitDecision({
      decisionId: step4.request.decisionId,
      stateVersion: step4.request.stateVersion,
      selectedPatternRef: step4.request.patterns.findIndex((p) => p.kind === "PASS"),
    });

    if (step5.type !== "WAITING_FOR_DECISION") return;
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

    // 未知のカスタムアクションIDでも同じ schema で記録できること
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
});
