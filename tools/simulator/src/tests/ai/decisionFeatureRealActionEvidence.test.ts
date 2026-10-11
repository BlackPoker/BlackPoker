import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage } from "../../domain/rules/RulePackage";
import { GameSession } from "../../engine/session/GameSession";
import { DecisionFeatureEncoder } from "../../engine/ai/DecisionFeatureEncoder";
import { StableIdentityEncoder } from "../../engine/ai/StableIdentityEncoder";
import { ObservationFactory } from "../../engine/decision/ObservationFactory";
import { CONTEXT_FEATURE_NAMES, PATTERN_FEATURE_NAMES, FEATURE_SCHEMA_VERSION } from "../../domain/ai/DecisionFeatureTypes";
import { DecisionRequest } from "../../domain/decision/DecisionRequest";

describe("Real Decision Path Feature Evidence (Feature Schema v3)", () => {
  let rulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  const getContextValue = (encoded: ReturnType<typeof DecisionFeatureEncoder.encode>, name: string): number => {
    const idx = CONTEXT_FEATURE_NAMES.indexOf(name as any);
    if (idx === -1) throw new Error(`Unknown context feature: ${name}`);
    return encoded.context.values[idx];
  };

  const getPatternValue = (pattern: any, name: string): number => {
    const idx = PATTERN_FEATURE_NAMES.indexOf(name as any);
    if (idx === -1) throw new Error(`Unknown pattern feature: ${name}`);
    return pattern.values[idx];
  };

  const findPassPatternIndex = (req: any): number => {
    const idx = req.patterns.findIndex((p: any) => p.kind === "PASS");
    if (idx === -1) throw new Error("PASS pattern not found");
    return idx;
  };

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

  // =========================================================================
  // 1. Attack Real Path
  // =========================================================================
  describe("1. Attack Real Path (Authoritative GameSession Execution)", () => {
    it("extracts Action Identity, Effect Step Identity, and distinguishes 0/1/multi attacker combinations", () => {
      const soldier1 = {
        unitId: "soldier-1",
        kind: "一般兵",
        componentId: "character.soldier",
        state: "charge",
        cards: [{ id: "c1", suit: "S", rank: "6", value: 6 }],
        labels: ["攻撃", "防御"],
      };
      const soldier2 = {
        unitId: "soldier-2",
        kind: "一般兵",
        componentId: "character.soldier",
        state: "charge",
        cards: [{ id: "c2", suit: "H", rank: "7", value: 7 }],
        labels: ["攻撃"],
      };

      const state: any = {
        stateVersion: 1,
        matchId: "match-real-atk",
        turnPlayer: "p1",
        chancePlayer: "p1",
        turnCount: 1,
        players: {
          p1: {
            name: "Player A",
            life: [{ id: "l1", suit: "S", rank: "A", value: 1 }],
            hand: [
              { id: "key-s8", suit: "S", rank: "8", value: 8 },
              { id: "cost-c2", suit: "C", rank: "2", value: 2 },
            ],
            field: [soldier1, soldier2],
            fog: [],
            grave: [],
          },
          p2: {
            name: "Player B",
            life: [{ id: "l2", suit: "D", rank: "K", value: 13 }],
            hand: [],
            field: [],
            fog: [],
            grave: [],
          },
        },
        stage: { requests: [], history: [] },
        requestBuffer: { requests: [], history: [] },
      };

      const session = new GameSession(state, rulePackage);

      // Step 1: p1 が Attack をリクエスト
      const step1 = session.advance();
      assertWaiting(step1);
      const attackPatIdx = step1.request.patterns.findIndex((p: any) => {
        if (p.actionSelectionRef === undefined) return false;
        return step1.request.catalog.actions[p.actionSelectionRef].actionId === "action.attack";
      });
      expect(attackPatIdx).toBeGreaterThanOrEqual(0);
      session.submitDecision({
        decisionId: step1.request.decisionId,
        stateVersion: step1.request.stateVersion,
        selectedPatternRef: attackPatIdx,
      });

      // Step 2: p1 PASS
      const step2 = session.advance();
      assertWaiting(step2);
      session.submitDecision({
        decisionId: step2.request.decisionId,
        stateVersion: step2.request.stateVersion,
        selectedPatternRef: findPassPatternIndex(step2.request),
      });

      // Step 3: p2 PASS (全員連続PASS成立 -> アタック効果解決開始中断)
      const step3 = session.advance();
      assertWaiting(step3);
      const step4 = session.submitDecision({
        decisionId: step3.request.decisionId,
        stateVersion: step3.request.stateVersion,
        selectedPatternRef: findPassPatternIndex(step3.request),
      });

      assertWaiting(step4);
      const effReq = step4.request;
      assertEffectSource(effReq.source);
      // 実ルール定義上のコマンド名（selectUnits）
      expect(effReq.source.effectStepId).toBe("selectUnits");

      // 実リクエストをエンコード
      const encoded = DecisionFeatureEncoder.encode(effReq);
      expect(encoded.featureSchemaVersion).toBe(FEATURE_SCHEMA_VERSION);

      // 1. Action Identity は action.attack のバケットと完全一致
      const expectedActionBuckets = StableIdentityEncoder.encodeActionIdentity("action.attack");
      for (let i = 0; i < 16; i++) {
        expect(getContextValue(encoded, `request_action_bucket_${i}`)).toBe(expectedActionBuckets[i]);
      }

      // 2. Effect Step Identity は selectUnits のバケットと完全一致
      const expectedStepBuckets = StableIdentityEncoder.encodeEffectStepIdentity("selectUnits");
      for (let i = 0; i < 16; i++) {
        expect(getContextValue(encoded, `request_effect_step_bucket_${i}`)).toBe(expectedStepBuckets[i]);
      }

      // 3. パターン数は 2^2 = 4 (0体, soldier-1, soldier-2, 両方)
      expect(encoded.patterns).toHaveLength(4);

      // 4. 各パターンの特徴量が明確に区別可能
      const p0 = encoded.patterns.find((p) => {
        const eff = effReq.catalog.effectSelections[p.patternRef];
        return eff.selectedValues?.length === 0;
      })!;
      const p1 = encoded.patterns.find((p) => {
        const eff = effReq.catalog.effectSelections[p.patternRef];
        return eff.selectedValues?.length === 1 && eff.selectedValues[0] === "soldier-1";
      })!;
      const p2 = encoded.patterns.find((p) => {
        const eff = effReq.catalog.effectSelections[p.patternRef];
        return eff.selectedValues?.length === 1 && eff.selectedValues[0] === "soldier-2";
      })!;
      const p3 = encoded.patterns.find((p) => {
        const eff = effReq.catalog.effectSelections[p.patternRef];
        return eff.selectedValues?.length === 2;
      })!;

      // 0体
      expect(getPatternValue(p0, "effect_selected_unit_count")).toBe(0);
      expect(getPatternValue(p0, "effect_selected_unit_size_sum")).toBe(0);
      // soldier-1 (Size 6)
      expect(getPatternValue(p1, "effect_selected_unit_count")).toBe(1);
      expect(getPatternValue(p1, "effect_selected_unit_size_sum")).toBe(6);
      // soldier-2 (Size 7)
      expect(getPatternValue(p2, "effect_selected_unit_count")).toBe(1);
      expect(getPatternValue(p2, "effect_selected_unit_size_sum")).toBe(7);
      // 両方 (合計 Size 13)
      expect(getPatternValue(p3, "effect_selected_unit_count")).toBe(2);
      expect(getPatternValue(p3, "effect_selected_unit_size_sum")).toBe(13);

      expect(p0.values).not.toEqual(p1.values);
      expect(p1.values).not.toEqual(p2.values);
      expect(p2.values).not.toEqual(p3.values);
    });
  });

  // =========================================================================
  // 2. Block Real Path
  // =========================================================================
  describe("2. Block Real Path (Authoritative GameSession Execution)", () => {
    it("extracts Block Action Identity and distinguishes PASS vs unit assignment blocker choices", () => {
      const attackerSoldier = {
        unitId: "u-atk-1",
        kind: "一般兵",
        componentId: "character.soldier",
        state: "charge",
        cards: [{ id: "c-atk", suit: "S", rank: "5", value: 5 }],
        labels: ["攻撃", "防御"],
      };
      const blockerSoldier = {
        unitId: "u-blk-1",
        kind: "一般兵",
        componentId: "character.soldier",
        state: "charge",
        cards: [{ id: "c-blk", suit: "H", rank: "6", value: 6 }],
        labels: ["防御"],
      };

      const state: any = {
        stateVersion: 1,
        matchId: "match-real-blk",
        turnPlayer: "p1",
        chancePlayer: "p1",
        turnCount: 1,
        players: {
          p1: {
            name: "Player A",
            life: [{ id: "l1", suit: "S", rank: "A", value: 1 }],
            hand: [
              { id: "key-s8", suit: "S", rank: "8", value: 8 },
              { id: "cost-c2", suit: "C", rank: "2", value: 2 },
            ],
            field: [attackerSoldier],
            fog: [],
            grave: [],
          },
          p2: {
            name: "Player B",
            life: [{ id: "l2", suit: "D", rank: "K", value: 13 }],
            hand: [],
            field: [blockerSoldier],
            fog: [],
            grave: [],
          },
        },
        stage: { requests: [], history: [] },
        requestBuffer: { requests: [], history: [] },
      };

      const session = new GameSession(state, rulePackage);

      // 1. p1 が Attack をリクエスト
      const s1 = session.advance();
      assertWaiting(s1);
      const atkIdx = s1.request.patterns.findIndex((p: any) => {
        return s1.request.catalog.actions[p.actionSelectionRef!]?.actionId === "action.attack";
      });
      session.submitDecision({ decisionId: s1.request.decisionId, stateVersion: s1.request.stateVersion, selectedPatternRef: atkIdx });

      // 2. 両者 PASS -> アタック解決開始中断
      const s2 = session.advance();
      assertWaiting(s2);
      session.submitDecision({ decisionId: s2.request.decisionId, stateVersion: s2.request.stateVersion, selectedPatternRef: findPassPatternIndex(s2.request) });
      const s3 = session.advance();
      assertWaiting(s3);
      const s4 = session.submitDecision({ decisionId: s3.request.decisionId, stateVersion: s3.request.stateVersion, selectedPatternRef: findPassPatternIndex(s3.request) });
      assertWaiting(s4);

      // 3. アタッカーとして u-atk-1 を選択
      const selectAtkIdx = s4.request.patterns.findIndex((p: any) => {
        const eff = s4.request.catalog.effectSelections[p.effectSelectionRef!];
        return eff.selectedValues?.includes("u-atk-1");
      });
      expect(selectAtkIdx).toBeGreaterThanOrEqual(0);
      const s5 = session.submitDecision({ decisionId: s4.request.decisionId, stateVersion: s4.request.stateVersion, selectedPatternRef: selectAtkIdx });

      // 4. Block が誘発され Stage に積まれる -> 両者 PASS して Block の解決を開始
      assertWaiting(s5);
      const s6 = session.submitDecision({ decisionId: s5.request.decisionId, stateVersion: s5.request.stateVersion, selectedPatternRef: findPassPatternIndex(s5.request) });
      assertWaiting(s6);
      const s7 = session.submitDecision({ decisionId: s6.request.decisionId, stateVersion: s6.request.stateVersion, selectedPatternRef: findPassPatternIndex(s6.request) });

      // 5. ブロッカー割り当ての EFFECT_RESOLUTION DecisionRequest が返る
      assertWaiting(s7);
      const blockReq = s7.request;
      expect(blockReq.source.type).toBe("EFFECT_RESOLUTION");

      const encoded = DecisionFeatureEncoder.encode(blockReq);

      // Action Identity は action.block に対応
      const expectedBlockBuckets = StableIdentityEncoder.encodeActionIdentity("action.block");
      for (let i = 0; i < 16; i++) {
        expect(getContextValue(encoded, `request_action_bucket_${i}`)).toBe(expectedBlockBuckets[i]);
      }

      // ブロッカー割り当てのパターンが存在
      expect(encoded.patterns.length).toBeGreaterThanOrEqual(2);

      // パス（スルー）パターンとブロック実行パターンの差異を検証
      const passPattern = encoded.patterns.find((p) => {
        const eff = blockReq.catalog.effectSelections[p.patternRef];
        return (
          eff.assignments?.length === 0 ||
          eff.assignments?.every((a) => a.selectedUnitIds.length === 0)
        );
      });
      const blockPattern = encoded.patterns.find((p) => {
        const eff = blockReq.catalog.effectSelections[p.patternRef];
        return eff.assignments?.some((a) => a.selectedUnitIds.includes("u-blk-1"));
      });

      expect(passPattern).toBeDefined();
      expect(blockPattern).toBeDefined();

      expect(getPatternValue(passPattern!, "effect_assignment_selected_count")).toBe(0);
      expect(getPatternValue(blockPattern!, "effect_assignment_selected_count")).toBe(1);
      // ブロッカー Size 6 vs アタッカー Size 5 -> Delta = +1
      expect(getPatternValue(blockPattern!, "effect_assignment_positive_delta_count")).toBe(1);
    });
  });

  // =========================================================================
  // 3. Down / Up Real Path
  // =========================================================================
  describe("3. Down vs Up Real Path", () => {
    it("distinguishes Down and Up actions on the same unit through Request Context buckets", () => {
      // 共通のユニット
      const soldier = {
        unitId: "soldier-target",
        kind: "一般兵",
        componentId: "character.soldier",
        state: "charge",
        face: "up",
        cards: [{ id: "c-sol", suit: "S", rank: "2", value: 2 }],
        currentSize: 2,
      };

      const baseState: any = {
        stateVersion: 1,
        matchId: "match-down-up",
        turnPlayer: "p1",
        chancePlayer: "p1",
        turnCount: 1,
        players: {
          p1: {
            hand: [],
            field: [soldier],
            life: [{ id: "l1", suit: "S", rank: "A", value: 1 }],
            grave: [],
          },
          p2: { hand: [], field: [], life: [{ id: "l2", suit: "D", rank: "K", value: 13 }], grave: [] },
        },
      };

      // Down Request
      const stateDown: any = {
        ...baseState,
        stage: {
          requests: [
            {
              id: "req-down-1",
              actionId: "action.down",
              controller: "p1",
              status: "resolving",
              sequence: 1,
              targets: [{ type: "unit", unitId: "soldier-target" }],
            },
          ],
        },
      };

      // Up Request
      const stateUp: any = {
        ...baseState,
        stage: {
          requests: [
            {
              id: "req-up-1",
              actionId: "action.up",
              controller: "p1",
              status: "resolving",
              sequence: 1,
              targets: [{ type: "unit", unitId: "soldier-target" }],
            },
          ],
        },
      };

      const obsDown = ObservationFactory.createObservation(stateDown, "p1");
      const obsUp = ObservationFactory.createObservation(stateUp, "p1");

      const reqDown = createMockDecision(obsDown, "req-down-1", "action.down");
      const reqUp = createMockDecision(obsUp, "req-up-1", "action.up");

      const encDown = DecisionFeatureEncoder.encode(reqDown);
      const encUp = DecisionFeatureEncoder.encode(reqUp);

      // 両者の Context Feature は Action Identity Bucket の差異により確実に異なる
      expect(encDown.context.values).not.toEqual(encUp.context.values);

      const downBuckets = StableIdentityEncoder.encodeActionIdentity("action.down");
      const upBuckets = StableIdentityEncoder.encodeActionIdentity("action.up");
      expect(downBuckets).not.toEqual(upBuckets);

      for (let i = 0; i < 16; i++) {
        expect(getContextValue(encDown, `request_action_bucket_${i}`)).toBe(downBuckets[i]);
        expect(getContextValue(encUp, `request_action_bucket_${i}`)).toBe(upBuckets[i]);
      }
    });
  });

  // =========================================================================
  // 4. Search Real Path
  // =========================================================================
  describe("4. Search Real Path (Authoritative Card Selection)", () => {
    it("distinguishes Ace vs numeric card selection in real Search effect resolution", () => {
      const state: any = {
        stateVersion: 1,
        matchId: "match-search",
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

      // Search アクションを選択 (Key: Joker)
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
      expect(searchReq.source.type).toBe("EFFECT_RESOLUTION");

      const encoded = DecisionFeatureEncoder.encode(searchReq);

      // Action Identity は action.search に対応
      const expectedSearchBuckets = StableIdentityEncoder.encodeActionIdentity("action.search");
      for (let i = 0; i < 16; i++) {
        expect(getContextValue(encoded, `request_action_bucket_${i}`)).toBe(expectedSearchBuckets[i]);
      }

      // ライフのカード群（♠A vs ♥7）が候補としてエンコードされ区別可能
      expect(encoded.patterns.length).toBeGreaterThanOrEqual(2);

      const acePattern = encoded.patterns.find((p) => {
        const eff = searchReq.catalog.effectSelections[p.patternRef];
        return eff.selectedValues?.includes("life-ace");
      })!;
      const numPattern = encoded.patterns.find((p) => {
        const eff = searchReq.catalog.effectSelections[p.patternRef];
        return eff.selectedValues?.includes("life-num7");
      })!;

      expect(acePattern).toBeDefined();
      expect(numPattern).toBeDefined();

      expect(getPatternValue(acePattern, "effect_selected_card_ace_count")).toBe(1);
      expect(getPatternValue(acePattern, "effect_selected_card_numeric_count")).toBe(0);
      expect(getPatternValue(acePattern, "effect_selected_card_value_sum")).toBe(1);

      expect(getPatternValue(numPattern, "effect_selected_card_ace_count")).toBe(0);
      expect(getPatternValue(numPattern, "effect_selected_card_numeric_count")).toBe(1);
      expect(getPatternValue(numPattern, "effect_selected_card_value_sum")).toBe(7);

      expect(acePattern.values).not.toEqual(numPattern.values);
    });
  });

  // =========================================================================
  // 5. Reverse Real Path
  // =========================================================================
  describe("5. Reverse Real Path", () => {
    it("extracts Reverse Action Identity and preserves option selection semantics", () => {
      const state: any = {
        stateVersion: 1,
        matchId: "match-rev",
        turnPlayer: "p1",
        chancePlayer: "p1",
        turnCount: 1,
        stage: {
          requests: [
            {
              id: "req-rev-1",
              actionId: "action.reverse",
              controller: "p1",
              status: "resolving",
              sequence: 1,
              targets: [{ type: "unit", unitId: "u-target" }],
            },
          ],
        },
        players: {
          p1: {
            hand: [],
            field: [
              {
                unitId: "u-target",
                kind: "一般兵",
                state: "drive",
                face: "up",
                cards: [{ id: "c1", suit: "S", rank: "3", value: 3 }],
              },
            ],
            life: [{ id: "l1" }],
            grave: [],
          },
          p2: { hand: [], field: [], life: [{ id: "l2" }], grave: [] },
        },
      };

      const obs = ObservationFactory.createObservation(state, "p1");
      const req: DecisionRequest = {
        protocolVersion: "1.0.0",
        matchId: "match-rev",
        decisionId: "dec-rev-1",
        stateVersion: 1,
        playerId: "p1",
        source: {
          type: "EFFECT_RESOLUTION",
          sourceRequestRef: "req-rev-1",
          sourceActionId: "action.reverse",
          effectStepId: "chooseTransformState",
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
            { selectionType: "option", selectedValues: ["charge"], summary: "チャージ選択" },
            { selectionType: "option", selectedValues: ["drive"], summary: "ドライブ選択" },
          ],
          orderSelections: [],
        },
        patterns: [
          { patternId: "p-charge", kind: "EFFECT_SELECTION", effectSelectionRef: 0 },
          { patternId: "p-drive", kind: "EFFECT_SELECTION", effectSelectionRef: 1 },
        ],
      };

      const encoded = DecisionFeatureEncoder.encode(req);

      const revBuckets = StableIdentityEncoder.encodeActionIdentity("action.reverse");
      for (let i = 0; i < 16; i++) {
        expect(getContextValue(encoded, `request_action_bucket_${i}`)).toBe(revBuckets[i]);
      }

      expect(encoded.patterns).toHaveLength(2);
      expect(encoded.patterns[0].values).not.toEqual(encoded.patterns[1].values);
    });
  });

  // =========================================================================
  // 6. Request Metadata Verification
  // =========================================================================
  describe("6. Request Metadata Verification", () => {
    it("correctly extracts controller, key card count, speed, and timing from real request", () => {
      const state: any = {
        stateVersion: 1,
        matchId: "match-meta",
        turnPlayer: "p1",
        chancePlayer: "p1",
        stage: {
          requests: [
            {
              id: "req-meta-1",
              actionId: "action.deathLance",
              action: { name: "死槍", speed: "normal", timing: "main" },
              controller: "p1",
              status: "resolving",
              sequence: 1,
              keyCards: [{ id: "kc-1", suit: "S", rank: "A", value: 1 }],
              targets: [{ type: "player", targetPlayerKey: "p2" }],
            },
          ],
        },
        players: {
          p1: { hand: [], field: [], life: [], grave: [] },
          p2: { hand: [], field: [], life: [], grave: [] },
        },
      };

      const obs = ObservationFactory.createObservation(state, "p1");
      const req: DecisionRequest = {
        protocolVersion: "1.0.0",
        matchId: "match-meta",
        decisionId: "dec-meta-1",
        stateVersion: 1,
        playerId: "p1",
        source: {
          type: "EFFECT_RESOLUTION",
          sourceRequestRef: "req-meta-1",
          sourceActionId: "action.deathLance",
          effectStepId: "selectUnitCardOrder",
          playerId: "p1",
        },
        observation: obs,
        catalog: {
          actions: [{ actionId: "action.deathLance", actionName: "死槍", speed: "normal", timing: "main" }],
          cardSelections: [],
          unitSelections: [],
          costPayments: [],
          targetSelections: [],
          effectSelections: [{ selectionType: "order", selectedValues: [], summary: "順序" }],
          orderSelections: [],
        },
        patterns: [{ patternId: "p-1", kind: "EFFECT_SELECTION", effectSelectionRef: 0 }],
      };

      const encoded = DecisionFeatureEncoder.encode(req);

      expect(getContextValue(encoded, "request_has_source")).toBe(1);
      expect(getContextValue(encoded, "request_source_is_effect")).toBe(1);
      expect(getContextValue(encoded, "request_source_controller_is_self")).toBe(1);
      expect(getContextValue(encoded, "request_source_controller_is_opponent")).toBe(0);
      expect(getContextValue(encoded, "request_action_speed_normal")).toBe(1);
      expect(getContextValue(encoded, "request_action_timing_main")).toBe(1);
      expect(getContextValue(encoded, "request_key_card_count")).toBe(1);
      expect(getContextValue(encoded, "request_key_card_known_count")).toBe(1);
      expect(getContextValue(encoded, "request_key_card_value_sum")).toBe(1);
      expect(getContextValue(encoded, "request_target_is_player")).toBe(1);
      expect(getContextValue(encoded, "request_target_is_opponent")).toBe(1);
    });
  });

  function createMockDecision(obs: any, reqRef: string, actionId: string): DecisionRequest {
    return {
      protocolVersion: "1.0.0",
      matchId: "match-mock",
      decisionId: "dec-mock",
      stateVersion: 1,
      playerId: "p1",
      source: {
        type: "EFFECT_RESOLUTION",
        sourceRequestRef: reqRef,
        sourceActionId: actionId,
        effectStepId: "selectTargetUnit",
        playerId: "p1",
      },
      observation: obs,
      catalog: {
        actions: [],
        cardSelections: [],
        unitSelections: [],
        costPayments: [],
        targetSelections: [],
        effectSelections: [{ selectionType: "unit", selectedValues: ["soldier-target"], summary: "選択" }],
        orderSelections: [],
      },
      patterns: [{ patternId: "pat-1", kind: "EFFECT_SELECTION", effectSelectionRef: 0 }],
    };
  }
});
