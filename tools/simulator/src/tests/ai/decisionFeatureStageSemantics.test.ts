import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { ObservationFactory } from "../../engine/decision/ObservationFactory";
import { DecisionFeatureEncoder } from "../../engine/ai/DecisionFeatureEncoder";
import { StableIdentityEncoder } from "../../engine/ai/StableIdentityEncoder";
import { GameSession } from "../../engine/session/GameSession";
import { DecisionRequest } from "../../domain/decision/DecisionRequest";
import { RulePackage } from "../../domain/rules/RulePackage";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { CONTEXT_FEATURE_NAMES, PATTERN_FEATURE_NAMES } from "../../domain/ai/DecisionFeatureTypes";

let rulePackage: RulePackage;

function getContextValue(encoded: any, name: string): number {
  const idx = encoded.context.featureNames.indexOf(name);
  if (idx === -1) throw new Error(`Context feature not found: ${name}`);
  return encoded.context.values[idx];
}

function getPatternValue(pattern: any, name: string): number {
  const idx = PATTERN_FEATURE_NAMES.indexOf(name as any);
  if (idx === -1) throw new Error(`Pattern feature not found: ${name}`);
  return pattern.values[idx];
}

function assertWaiting(step: any): asserts step is { type: "WAITING_FOR_DECISION"; request: DecisionRequest } {
  if (step.type !== "WAITING_FOR_DECISION") {
    throw new Error(`Expected WAITING_FOR_DECISION, got ${step.type}`);
  }
}

function assertEffectSource(source: any): asserts source is { type: "EFFECT_RESOLUTION"; sourceRequestRef: string; sourceActionId?: string; effectStepId: string; playerId: string } {
  if (source.type !== "EFFECT_RESOLUTION") {
    throw new Error(`Expected EFFECT_RESOLUTION, got ${source.type}`);
  }
}

describe("Stage Semantics Preservation & Source Request Observation Separation", () => {
  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  // =========================================================================
  // 1. Immediate Search (Real GameSession Execution)
  // =========================================================================
  describe("1. Immediate Search Real Path (Stage 0 while retaining Source metadata)", () => {
    it("preserves stage_depth = 0 and keeps stageRequests empty when executing immediate action.search", () => {
      const state: any = {
        stateVersion: 1,
        matchId: "match-stage-search",
        turnPlayer: "p1",
        chancePlayer: "p1",
        turnCount: 1,
        players: {
          p1: {
            hand: [
              { id: "key-joker", suit: "J", rank: "Joker", value: 14 },
              { id: "cost-d1", suit: "D", rank: "2", value: 2 },
            ],
            field: [],
            life: [
              { id: "life-ace", suit: "S", rank: "A", value: 1 },
              { id: "life-num7", suit: "H", rank: "7", value: 7 },
            ],
            grave: [],
          },
          p2: { hand: [], field: [], life: [{ id: "l2", suit: "C", rank: "3", value: 3 }], grave: [] },
        },
        stage: { requests: [], history: [] },
        requestBuffer: { requests: [], history: [] },
      };

      const session = new GameSession(state, rulePackage);
      const step1 = session.advance();
      assertWaiting(step1);

      // Search アクションを選択
      const searchIdx = step1.request.patterns.findIndex((p: any) => {
        return step1.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.search";
      });
      expect(searchIdx).toBeGreaterThanOrEqual(0);

      const nextStep = session.submitDecision({
        decisionId: step1.request.decisionId,
        stateVersion: step1.request.stateVersion,
        selectedPatternRef: searchIdx,
      });

      assertWaiting(nextStep);
      const searchReq = nextStep.request;
      const searchSource = searchReq.source;
      assertEffectSource(searchSource);
      const sourceReqRef = searchSource.sourceRequestRef;

      // 【実 State の Stage 検証】
      // action.search は immediate のため、実 state.stage.requests は空
      expect(session.state.stage.requests.length).toBe(0);

      // 【Observation Stage Semantics 検証】
      // stageRequests および stageRequestRefs は実 Stage 上のリクエストのみを含むため 0 件
      expect(searchReq.observation.stageRequests.length).toBe(0);
      expect(searchReq.observation.stageRequestRefs.length).toBe(0);

      // 【Stage外 Source Request View の分離検証】
      // effectSourceRequest にサニタイズされた View が格納されている
      expect(searchReq.observation.effectSourceRequest).toBeDefined();
      expect(searchReq.observation.effectSourceRequest?.requestId).toBe(sourceReqRef);
      expect(searchReq.observation.effectSourceRequest?.actionId).toBe("action.search");
      expect(searchReq.observation.effectSourceRequest?.actionSpeed).toBe("immediate");
      expect(searchReq.observation.effectSourceRequest?.actionTiming).toBe("quick");

      // 【Feature Encoding 検証】
      const encoded = DecisionFeatureEncoder.encode(searchReq);

      // stage_depth は実 Stage 深度の 0 であること！
      expect(getContextValue(encoded, "stage_depth")).toBe(0);

      // Source Action Identity および Speed/Timing は effectSourceRequest 経由で正常に反映
      const expectedSearchBuckets = StableIdentityEncoder.encodeActionIdentity("action.search");
      for (let i = 0; i < 16; i++) {
        expect(getContextValue(encoded, `request_action_bucket_${i}`)).toBe(expectedSearchBuckets[i]);
      }
      expect(getContextValue(encoded, "request_action_speed_immediate")).toBe(1);
      expect(getContextValue(encoded, "request_action_timing_quick")).toBe(1);
    });
  });

  // =========================================================================
  // 2. Direct Observation Contract Test
  // =========================================================================
  describe("2. Direct Observation Contract Test", () => {
    it("isolates stageRequests from stage-outside currentRequest, maintaining correct stage_depth", () => {
      const state: any = {
        stateVersion: 1,
        matchId: "match-direct-test",
        turnPlayer: "p1",
        chancePlayer: "p1",
        players: {
          p1: { hand: [], field: [], life: [{ id: "l1" }], grave: [] },
          p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
        },
        stage: {
          requests: [
            {
              id: "req-stage-a",
              actionId: "action.attack",
              action: { request: { speed: "normal", timing: "main" } },
              controller: "p1",
              status: "resolving",
              sequence: 1,
            },
            {
              id: "req-stage-b",
              actionId: "action.block",
              action: { request: { speed: "normal", timing: "main" } },
              controller: "p2",
              status: "pending",
              sequence: 2,
            },
          ],
          history: [],
        },
      };

      const stageOutsideReq: any = {
        id: "req-outside-immediate",
        actionId: "action.search",
        action: { request: { speed: "immediate", timing: "quick" } },
        controller: "p1",
        status: "resolving",
        sequence: 3,
      };

      const obs = ObservationFactory.createObservation(state, "p1", { currentRequest: stageOutsideReq });

      // stageRequests / stageRequestRefs には実 Stage の req-stage-a と req-stage-b のみ
      expect(obs.stageRequests.length).toBe(2);
      expect(obs.stageRequestRefs).toEqual(["req-stage-a", "req-stage-b"]);
      expect(obs.stageRequests.map((r) => r.requestId)).toEqual(["req-stage-a", "req-stage-b"]);

      // effectSourceRequest に Stage 外の req-outside-immediate のみが格納
      expect(obs.effectSourceRequest).toBeDefined();
      expect(obs.effectSourceRequest?.requestId).toBe("req-outside-immediate");
      expect(obs.effectSourceRequest?.actionId).toBe("action.search");
      expect(obs.effectSourceRequest?.actionSpeed).toBe("immediate");
      expect(obs.effectSourceRequest?.actionTiming).toBe("quick");

      // FeatureEncoder で stage_depth が実 Stage 深度 2 となる
      const req: DecisionRequest = {
        protocolVersion: "1.0.0",
        matchId: "match-test",
        decisionId: "dec-test",
        stateVersion: 1,
        playerId: "p1",
        source: {
          type: "EFFECT_RESOLUTION",
          sourceRequestRef: "req-outside-immediate",
          effectStepId: "selectCard",
          playerId: "p1",
        },
        observation: obs,
        catalog: {
          actions: [],
          cardSelections: [],
          unitSelections: [],
          costPayments: [],
          targetSelections: [],
          effectSelections: [{ selectionType: "card", selectedValues: [], summary: "選択" }],
          orderSelections: [],
        },
        patterns: [{ patternId: "p-1", kind: "EFFECT_SELECTION", effectSelectionRef: 0 }],
      };

      const encoded = DecisionFeatureEncoder.encode(req);
      expect(getContextValue(encoded, "stage_depth")).toBe(2);
      expect(getContextValue(encoded, "request_action_speed_immediate")).toBe(1);
      expect(getContextValue(encoded, "request_action_timing_quick")).toBe(1);
    });

    it("does not duplicate currentRequest when it is already in stage.requests", () => {
      const state: any = {
        stateVersion: 1,
        matchId: "match-in-stage",
        turnPlayer: "p1",
        chancePlayer: "p1",
        players: {
          p1: { hand: [], field: [], life: [{ id: "l1" }], grave: [] },
          p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
        },
        stage: {
          requests: [
            {
              id: "req-stage-atk",
              actionId: "action.attack",
              action: { request: { speed: "normal", timing: "main" } },
              controller: "p1",
              status: "resolving",
              sequence: 1,
            },
          ],
          history: [],
        },
      };

      const stageReq = state.stage.requests[0];
      const obs = ObservationFactory.createObservation(state, "p1", { currentRequest: stageReq });

      // stageRequests は 1 件のみ
      expect(obs.stageRequests.length).toBe(1);
      expect(obs.stageRequestRefs).toEqual(["req-stage-atk"]);

      // effectSourceRequest に二重計上されない（undefined）
      expect(obs.effectSourceRequest).toBeUndefined();

      const req: DecisionRequest = {
        protocolVersion: "1.0.0",
        matchId: "match-test",
        decisionId: "dec-test",
        stateVersion: 1,
        playerId: "p1",
        source: {
          type: "EFFECT_RESOLUTION",
          sourceRequestRef: "req-stage-atk",
          effectStepId: "selectAttacker",
          playerId: "p1",
        },
        observation: obs,
        catalog: {
          actions: [],
          cardSelections: [],
          unitSelections: [],
          costPayments: [],
          targetSelections: [],
          effectSelections: [{ selectionType: "unit", selectedValues: [], summary: "選択" }],
          orderSelections: [],
        },
        patterns: [{ patternId: "p-1", kind: "EFFECT_SELECTION", effectSelectionRef: 0 }],
      };

      const encoded = DecisionFeatureEncoder.encode(req);
      expect(getContextValue(encoded, "stage_depth")).toBe(1);
      expect(getContextValue(encoded, "request_action_speed_normal")).toBe(1);
      expect(getContextValue(encoded, "request_action_timing_main")).toBe(1);
    });
  });

  // =========================================================================
  // 3. Request Selection Semantics (No false stage requests)
  // =========================================================================
  describe("3. Request Selection Semantics", () => {
    it("ensures effect_selected_request_* matches only true stage requests, ignoring stage-outside source requests", () => {
      const state: any = {
        stateVersion: 1,
        matchId: "match-req-sel",
        turnPlayer: "p1",
        chancePlayer: "p1",
        players: {
          p1: { hand: [], field: [], life: [{ id: "l1" }], grave: [] },
          p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
        },
        stage: {
          requests: [
            {
              id: "req-true-stage-1",
              actionId: "action.attack",
              action: { request: { speed: "normal", timing: "main" } },
              controller: "p2",
              status: "pending",
              sequence: 1,
            },
          ],
          history: [],
        },
      };

      const stageOutsideReq: any = {
        id: "req-outside-source",
        actionId: "action.search",
        action: { request: { speed: "immediate", timing: "quick" } },
        controller: "p1",
        status: "resolving",
        sequence: 2,
      };

      const obs = ObservationFactory.createObservation(state, "p1", { currentRequest: stageOutsideReq });

      const req: DecisionRequest = {
        protocolVersion: "1.0.0",
        matchId: "match-test",
        decisionId: "dec-test",
        stateVersion: 1,
        playerId: "p1",
        source: {
          type: "EFFECT_RESOLUTION",
          sourceRequestRef: "req-outside-source",
          effectStepId: "selectTargetRequest",
          playerId: "p1",
        },
        observation: obs,
        catalog: {
          actions: [],
          cardSelections: [],
          unitSelections: [],
          costPayments: [],
          targetSelections: [],
          effectSelections: [
            // パターン0: 実 Stage Request を選択
            { selectionType: "request", selectedValues: ["req-true-stage-1"], summary: "Stageリクエスト選択" },
            // パターン1: Stage 外 Source Request ID を選択（もし選択肢にあっても Stage Request として誤認識されない）
            { selectionType: "request", selectedValues: ["req-outside-source"], summary: "Stage外リクエスト選択" },
          ],
          orderSelections: [],
        },
        patterns: [
          { patternId: "p-stage", kind: "EFFECT_SELECTION", effectSelectionRef: 0 },
          { patternId: "p-outside", kind: "EFFECT_SELECTION", effectSelectionRef: 1 },
        ],
      };

      const encoded = DecisionFeatureEncoder.encode(req);

      const pStage = encoded.patterns[0];
      const pOutside = encoded.patterns[1];

      // パターン0: 実 Stage 上の相手リクエストとして正しくカウント
      expect(getPatternValue(pStage, "effect_selected_request_count")).toBe(1);
      expect(getPatternValue(pStage, "effect_selected_request_is_opponent")).toBe(1);
      expect(getPatternValue(pStage, "effect_selected_request_is_self")).toBe(0);

      // パターン1: Stage 外リクエストは stageRequests に存在しないためカウント 0
      expect(getPatternValue(pOutside, "effect_selected_request_count")).toBe(0);
      expect(getPatternValue(pOutside, "effect_selected_request_is_self")).toBe(0);
      expect(getPatternValue(pOutside, "effect_selected_request_is_opponent")).toBe(0);
    });
  });
});
