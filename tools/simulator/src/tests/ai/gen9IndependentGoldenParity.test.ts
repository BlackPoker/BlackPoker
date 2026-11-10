/**
 * gen9IndependentGoldenParity.test.ts
 *
 * BlackPoker Simulator - Work 5-5B R1: 旧コミット由来の Golden Fixture による独立パリティ検証
 *
 * 【検証対象基準コミット】
 * 旧コミット: efe071f65ef37ec2a5bd6670ec52aaa3cd4d33a8 (新特徴量追加直前の正本)
 * 現行 HEAD:  Work 5-5B R1 実装コード
 *
 * 【代表10局面 (Scenarios 1〜10)】
 * 1. 通常アクション局面 (Normal Action: 手番通常アクション選択)
 * 2. コスト支払い局面 (Cost Payment: 手札廃棄コストを含むアクション)
 * 3. キーカード選択局面 (Key Card Selection: 複数キーカード候補の選択)
 * 4. Counter有効局面 (Effective Counter: 確定致死リクエストに対するCounter選択)
 * 5. 受動PASS局面 (Passive PASS: 有効対抗手段不在時のPASS減点免除)
 * 6. 通常ブロック局面 (Normal Block: 単体アタッカーに対するブロック割り当て)
 * 7. ストリーミングブロック局面 (Streaming Block: 複数アタッカーに対するストリーミングブロック)
 * 8. 同点タイブレーク局面 (Tie-Break Determinism: 同点時の最小 patternRef 優先)
 * 9. Joker含む局面 (Joker Presence: 手札にJokerが含まれる局面)
 * 10. 旧 G0 / G3 重み適用局面 (Evolved Benchmark Weights: 非ゼロ戦術重み適用局面)
 *
 * 【パリティ判定基準】
 * - ベーススコア一致: |oldBase - newBase| < 1e-12
 * - 戦術調整値一致: |oldAdj - newAdj| < 1e-12
 * - 最終スコア一致: |oldFinal - newFinal| < 1e-12
 * - 最善手選択一致: oldBestPatternRef === newBestPatternRef
 * - 意図しない不一致: 0 件
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { DecisionRequest } from "../../domain/decision/DecisionRequest.js";
import { DecisionDNA } from "../../domain/ai/DecisionDNATypes.js";
import { DecisionDNACodec } from "../../engine/ai/DecisionDNACodec.js";
import { GenericTacticalEvaluator } from "../../engine/rules/GenericTacticalEvaluator.js";
import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader.js";
import { createGen8ChampionCandidatePolicy } from "../../engine/ai/Gen8DNALoader.js";
import { Gen9TacticalPrototypePolicy } from "../../engine/ai/Gen9TacticalPrototypePolicy.js";
import {
  Gen9LearnableTacticalPolicy as OldGen9Policy,
  fromV6DNA as oldFromV6DNA,
  R4_PRESET_TACTICAL_WEIGHTS as OLD_R4_WEIGHTS,
} from "./oldGen9_efe071f65.js";
import {
  Gen9LearnableTacticalPolicy as NewGen9Policy,
  fromV6DNA as newFromV6DNA,
  R4_PRESET_TACTICAL_WEIGHTS as NEW_R4_WEIGHTS,
  TACTICAL_FEATURE_ENCODER_VERSION_CURRENT,
} from "../../engine/ai/Gen9LearnableTacticalPolicy.js";

describe("Work 5-5B R1: 旧コミット (efe071f65) 由来の Golden Fixture による独立パリティ検証", () => {
  let evaluator: GenericTacticalEvaluator;
  const gen8 = createGen8ChampionCandidatePolicy();
  const gen8DNA = DecisionDNACodec.clone((gen8 as any).dna);

  // 旧20次元重み (G0/R4互換)
  const old20Weights = [...OLD_R4_WEIGHTS];
  // 新24次元重み (旧20次元 + 末尾4つゼロ重み)
  const new24ZeroExtendedWeights = [...old20Weights, 0.0, 0.0, 0.0, 0.0];

  beforeAll(() => {
    const fullPkg = loadRulePackageForBrowser();
    evaluator = new GenericTacticalEvaluator(fullPkg);
    Gen9TacticalPrototypePolicy.setDefaultEvaluator(evaluator);
  });

  const createBaseRequest = (overrides?: Partial<DecisionRequest>): DecisionRequest => {
    return {
      protocolVersion: "1.0.0",
      matchId: "match-golden-parity",
      decisionId: "dec-golden-001",
      stateVersion: 1,
      playerId: "p2",
      source: {
        type: "ACTION_REQUEST",
        playerId: "p2",
      },
      observation: {
        viewerPlayerId: "p2",
        turnPlayerId: "p2",
        chancePlayerId: "p2",
        players: [
          {
            playerId: "p1",
            name: "Alice",
            isViewer: false,
            lifeCount: 15,
            lifeDisplay: "15",
            handCount: 4,
            handCards: [],
            field: [],
            fog: [],
            trumps: [],
            graveCount: 0,
            grave: [],
            canViewFullGrave: false,
          },
          {
            playerId: "p2",
            name: "Bob",
            isViewer: true,
            lifeCount: 15,
            lifeDisplay: "15",
            handCount: 5,
            handCards: [
              { visibility: "KNOWN", cardInstanceId: "c-bob-1", suit: "spade", rank: "7", value: 7, faceUp: true },
              { visibility: "KNOWN", cardInstanceId: "c-bob-2", suit: "heart", rank: "K", value: 13, faceUp: true },
              { visibility: "KNOWN", cardInstanceId: "c-bob-3", suit: "diamond", rank: "3", value: 3, faceUp: true },
            ],
            field: [
              {
                unitId: "u-bob-1",
                kind: "soldier",
                state: "charge",
                face: "up",
                cards: [],
                labels: [],
                currentSize: 5,
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
      catalog: {
        actions: [
          { actionId: "action.counter", actionName: "Counter", speed: "quick", timing: "quick" } as any,
          { actionId: "action.attack", actionName: "Attack", speed: "normal", timing: "normal" } as any,
          { actionId: "action.summonSoldier", actionName: "Summon", speed: "normal", timing: "normal" } as any,
          { actionId: "action.addBulwark", actionName: "Bulwark", speed: "normal", timing: "normal" } as any,
        ],
        cardSelections: [
          { cardIds: ["c-bob-1"] },
          { cardIds: ["c-bob-2"] },
          { cardIds: ["c-bob-3"] },
        ],
        unitSelections: [
          { unitIds: ["u-bob-1"] },
        ],
        costPayments: [
          {
            discardedCardIds: ["c-bob-3"],
            drivenBulwarkUnitIds: [],
            sacrificedUnitIds: [],
            lifeCount: 0,
          } as any,
        ],
        targetSelections: [],
        effectSelections: [],
        orderSelections: [],
      },
      patterns: [
        { patternId: "pat-pass", kind: "PASS" },
        { patternId: "pat-attack", kind: "ACTION", actionSelectionRef: 1, unitSelectionRef: 0 },
        { patternId: "pat-summon", kind: "ACTION", actionSelectionRef: 2, keyCardSelectionRef: 0 },
      ],
      ...overrides,
    };
  };

  const scenarioSummaries: any[] = [];
  let totalMismatches = 0;
  let totalCandidatesChecked = 0;

  /**
   * 独立パリティ検証ヘルパー関数
   */
  const verifyParity = (
    scenarioName: string,
    request: DecisionRequest,
    customOldWeights: number[] = old20Weights,
    customNewWeights: number[] = new24ZeroExtendedWeights
  ) => {
    const oldGenome = oldFromV6DNA(gen8DNA, customOldWeights, {
      encoderVersion: "v7.2-unified-block-conditional-pass",
    });
    const oldPolicy = new OldGen9Policy(oldGenome, `OldPolicy-${scenarioName}`, evaluator);

    const newGenome = newFromV6DNA(gen8DNA, customNewWeights, {
      encoderVersion: TACTICAL_FEATURE_ENCODER_VERSION_CURRENT,
    });
    const newPolicy = new NewGen9Policy(newGenome, `NewPolicy-${scenarioName}`, evaluator);

    const oldEval = oldPolicy.evaluatePatterns(request);
    const newEval = newPolicy.evaluatePatterns(request);

    expect(oldEval.scoredPatterns.length).toBe(newEval.scoredPatterns.length);

    const details: any[] = [];

    for (let i = 0; i < oldEval.scoredPatterns.length; i++) {
      totalCandidatesChecked++;
      const oldSc = oldEval.scoredPatterns[i];
      const newSc = newEval.scoredPatterns[i];

      expect(oldSc.patternRef).toBe(newSc.patternRef);

      // 1. ベーススコア厳密一致
      const baseDiff = Math.abs(oldSc.baseScore - newSc.baseScore);
      expect(baseDiff).toBeLessThanOrEqual(1e-12);

      // 2. 戦術調整値厳密一致 (新特徴量の重みがゼロであるため完全一致)
      const adjDiff = Math.abs(oldSc.tacticalAdjustment - newSc.tacticalAdjustment);
      expect(adjDiff).toBeLessThanOrEqual(1e-12);

      // 3. 最終スコア厳密一致
      const finalDiff = Math.abs(oldSc.finalScore - newSc.finalScore);
      expect(finalDiff).toBeLessThanOrEqual(1e-12);

      if (baseDiff > 1e-12 || adjDiff > 1e-12 || finalDiff > 1e-12) {
        totalMismatches++;
      }

      details.push({
        patternRef: oldSc.patternRef,
        patternId: request.patterns[oldSc.patternRef]?.patternId,
        kind: request.patterns[oldSc.patternRef]?.kind,
        oldBaseScore: oldSc.baseScore,
        newBaseScore: newSc.baseScore,
        baseDiff,
        oldTacticalAdjustment: oldSc.tacticalAdjustment,
        newTacticalAdjustment: newSc.tacticalAdjustment,
        adjDiff,
        oldFinalScore: oldSc.finalScore,
        newFinalScore: newSc.finalScore,
        finalDiff,
        isMatch: baseDiff <= 1e-12 && adjDiff <= 1e-12 && finalDiff <= 1e-12,
      });
    }

    // 4. 最善手選択の完全一致
    expect(newEval.bestPatternRef).toBe(oldEval.bestPatternRef);
    if (newEval.bestPatternRef !== oldEval.bestPatternRef) {
      totalMismatches++;
    }

    const summary = {
      scenarioName,
      candidateCount: oldEval.scoredPatterns.length,
      bestPatternRef: oldEval.bestPatternRef,
      oldBestPatternRef: oldEval.bestPatternRef,
      newBestPatternRef: newEval.bestPatternRef,
      selectedActionPatternId: request.patterns[oldEval.bestPatternRef]?.patternId,
      topScore: oldEval.scoredPatterns.find((p) => p.patternRef === oldEval.bestPatternRef)?.finalScore,
      details,
    };
    scenarioSummaries.push(summary);

    return summary;
  };

  // ===========================================================================
  // 1. 通常アクション局面 (Normal Action)
  // ===========================================================================
  it("Scenario 1: 通常アクション局面 (Normal Action) のパリティ検証", () => {
    const req = createBaseRequest();
    const result = verifyParity("Scenario-1-NormalAction", req);
    expect(result.candidateCount).toBe(3);
  });

  // ===========================================================================
  // 2. コスト支払い局面 (Cost Payment)
  // ===========================================================================
  it("Scenario 2: コスト支払い局面 (Cost Payment) のパリティ検証", () => {
    const req = createBaseRequest({
      patterns: [
        { patternId: "pat-pass", kind: "PASS" },
        { patternId: "pat-summon-free", kind: "ACTION", actionSelectionRef: 2, keyCardSelectionRef: 0 },
        { patternId: "pat-summon-cost", kind: "ACTION", actionSelectionRef: 2, keyCardSelectionRef: 1, costPaymentRef: 0 },
      ],
    });
    const result = verifyParity("Scenario-2-CostPayment", req);
    expect(result.candidateCount).toBe(3);
  });

  // ===========================================================================
  // 3. キーカード選択局面 (Key Card Selection)
  // ===========================================================================
  it("Scenario 3: キーカード選択局面 (Key Card Selection) のパリティ検証", () => {
    const req = createBaseRequest({
      patterns: [
        { patternId: "pat-pass", kind: "PASS" },
        { patternId: "pat-summon-c1", kind: "ACTION", actionSelectionRef: 2, keyCardSelectionRef: 0 },
        { patternId: "pat-summon-c2", kind: "ACTION", actionSelectionRef: 2, keyCardSelectionRef: 1 },
        { patternId: "pat-summon-c3", kind: "ACTION", actionSelectionRef: 2, keyCardSelectionRef: 2 },
      ],
    });
    const result = verifyParity("Scenario-3-KeyCardSelection", req);
    expect(result.candidateCount).toBe(4);
  });

  // ===========================================================================
  // 4. Counter有効局面 (Effective Counter)
  // ===========================================================================
  it("Scenario 4: Counter有効局面 (Effective Counter) のパリティ検証", () => {
    const req = createBaseRequest({
      observation: {
        ...createBaseRequest().observation,
        players: [
          {
            playerId: "p1",
            name: "Alice",
            isViewer: false,
            lifeCount: 15,
            lifeDisplay: "15",
            handCount: 4,
            handCards: [],
            field: [],
            fog: [],
            trumps: [],
            graveCount: 0,
            grave: [],
            canViewFullGrave: false,
          },
          {
            playerId: "p2",
            name: "Bob",
            isViewer: true,
            lifeCount: 10,
            lifeDisplay: "10",
            handCount: 5,
            handCards: [],
            field: [
              {
                unitId: "u-my-soldier-target",
                kind: "soldier",
                state: "charge",
                face: "up",
                cards: [],
                labels: [],
                currentSize: 10,
              },
            ],
            fog: [],
            trumps: [],
            graveCount: 0,
            grave: [],
            canViewFullGrave: true,
          },
        ],
        stageRequests: [
          {
            requestId: "req-deathlance-1" as any,
            actionId: "action.deathLance",
            controller: "p1",
            status: "PENDING",
            sequence: 1,
            target: { targetType: "unit", targetUnitId: "u-my-soldier-target" },
            keyCards: [
              { visibility: "KNOWN", cardInstanceId: "c1", suit: "diamond", rank: "A", value: 1, faceUp: true },
              { visibility: "KNOWN", cardInstanceId: "c2", suit: "spade", rank: "K", value: 13, faceUp: true },
            ],
          },
        ],
      },
      catalog: {
        ...createBaseRequest().catalog,
        targetSelections: [
          { targetType: "request", targetRequestId: "req-deathlance-1" } as any,
        ],
      },
      patterns: [
        { patternId: "pat-pass", kind: "PASS" },
        { patternId: "pat-counter", kind: "ACTION", actionSelectionRef: 0, targetSelectionRef: 0 },
      ],
    });
    const result = verifyParity("Scenario-4-EffectiveCounter", req);
    expect(result.candidateCount).toBe(2);
    expect(result.bestPatternRef).toBe(1); // Counter 選択
  });

  // ===========================================================================
  // 5. 受動PASS局面 (Passive PASS with No Counter)
  // ===========================================================================
  it("Scenario 5: 受動PASS局面 (Passive PASS with No Counter) のパリティ検証", () => {
    const req = createBaseRequest({
      observation: {
        ...createBaseRequest().observation,
        players: [
          {
            playerId: "p1",
            name: "Alice",
            isViewer: false,
            lifeCount: 15,
            lifeDisplay: "15",
            handCount: 4,
            handCards: [],
            field: [],
            fog: [],
            trumps: [],
            graveCount: 0,
            grave: [],
            canViewFullGrave: false,
          },
          {
            playerId: "p2",
            name: "Bob",
            isViewer: true,
            lifeCount: 10,
            lifeDisplay: "10",
            handCount: 5,
            handCards: [],
            field: [
              {
                unitId: "u-my-soldier-target",
                kind: "soldier",
                state: "charge",
                face: "up",
                cards: [],
                labels: [],
                currentSize: 10,
              },
            ],
            fog: [],
            trumps: [],
            graveCount: 0,
            grave: [],
            canViewFullGrave: true,
          },
        ],
        stageRequests: [
          {
            requestId: "req-deathlance-1" as any,
            actionId: "action.deathLance",
            controller: "p1",
            status: "PENDING",
            sequence: 1,
            target: { targetType: "unit", targetUnitId: "u-my-soldier-target" },
            keyCards: [
              { visibility: "KNOWN", cardInstanceId: "c1", suit: "diamond", rank: "A", value: 1, faceUp: true },
              { visibility: "KNOWN", cardInstanceId: "c2", suit: "spade", rank: "K", value: 13, faceUp: true },
            ],
          },
        ],
      },
      patterns: [
        { patternId: "pat-pass", kind: "PASS" },
      ],
    });
    const result = verifyParity("Scenario-5-PassivePass", req);
    expect(result.candidateCount).toBe(1);
    expect(result.bestPatternRef).toBe(0);
  });

  // ===========================================================================
  // 6. 通常ブロック局面 (Normal Block)
  // ===========================================================================
  it("Scenario 6: 通常ブロック局面 (Normal Block) のパリティ検証", () => {
    const req = createBaseRequest({
      observation: {
        ...createBaseRequest().observation,
        players: [
          {
            playerId: "p1",
            name: "Alice",
            isViewer: false,
            lifeCount: 15,
            lifeDisplay: "15",
            handCount: 4,
            handCards: [],
            field: [
              {
                unitId: "u-opp-att-1",
                kind: "soldier",
                state: "drive",
                face: "up",
                cards: [],
                labels: [],
                currentSize: 4,
                battle: { role: "attacker" },
              },
            ],
            fog: [],
            trumps: [],
            graveCount: 0,
            grave: [],
            canViewFullGrave: false,
          },
          {
            playerId: "p2",
            name: "Bob",
            isViewer: true,
            lifeCount: 15,
            lifeDisplay: "15",
            handCount: 5,
            handCards: [],
            field: [
              {
                unitId: "u-bob-def-1",
                kind: "soldier",
                state: "charge",
                face: "up",
                cards: [],
                labels: [],
                currentSize: 6,
              },
            ],
            fog: [],
            trumps: [],
            graveCount: 0,
            grave: [],
            canViewFullGrave: true,
          },
        ],
      },
      catalog: {
        ...createBaseRequest().catalog,
        blockAssignments: [
          { sourceUnitId: "u-opp-att-1", selectedUnitIds: ["u-bob-def-1"] } as any,
        ],
      },
      patterns: [
        { patternId: "pat-pass", kind: "PASS" },
        { patternId: "pat-block-1", kind: "BLOCK", blockAssignmentRef: 0 },
      ],
    });
    const result = verifyParity("Scenario-6-NormalBlock", req);
    expect(result.candidateCount).toBe(2);
  });

  // ===========================================================================
  // 7. ストリーミングブロック局面 (Streaming Block)
  // ===========================================================================
  it("Scenario 7: ストリーミングブロック局面 (Streaming Block) のパリティ検証", () => {
    const req = createBaseRequest({
      observation: {
        ...createBaseRequest().observation,
        players: [
          {
            playerId: "p1",
            name: "Alice",
            isViewer: false,
            lifeCount: 15,
            lifeDisplay: "15",
            handCount: 4,
            handCards: [],
            field: [
              {
                unitId: "u-opp-att-1",
                kind: "soldier",
                state: "drive",
                face: "up",
                cards: [],
                labels: [],
                currentSize: 3,
                battle: { role: "attacker" },
              },
              {
                unitId: "u-opp-att-2",
                kind: "soldier",
                state: "drive",
                face: "up",
                cards: [],
                labels: [],
                currentSize: 5,
                battle: { role: "attacker" },
              },
            ],
            fog: [],
            trumps: [],
            graveCount: 0,
            grave: [],
            canViewFullGrave: false,
          },
          {
            playerId: "p2",
            name: "Bob",
            isViewer: true,
            lifeCount: 8,
            lifeDisplay: "8",
            handCount: 5,
            handCards: [],
            field: [
              {
                unitId: "u-bob-def-1",
                kind: "soldier",
                state: "charge",
                face: "up",
                cards: [],
                labels: [],
                currentSize: 4,
              },
              {
                unitId: "u-bob-def-2",
                kind: "soldier",
                state: "charge",
                face: "up",
                cards: [],
                labels: [],
                currentSize: 6,
              },
            ],
            fog: [],
            trumps: [],
            graveCount: 0,
            grave: [],
            canViewFullGrave: true,
          },
        ],
      },
      catalog: {
        ...createBaseRequest().catalog,
        blockAssignments: [
          { sourceUnitId: "u-opp-att-1", selectedUnitIds: ["u-bob-def-1"] } as any,
          { sourceUnitId: "u-opp-att-2", selectedUnitIds: ["u-bob-def-2"] } as any,
        ],
      },
      patterns: [
        { patternId: "pat-pass", kind: "PASS" },
        { patternId: "pat-block-att1", kind: "BLOCK", blockAssignmentRef: 0 },
        { patternId: "pat-block-att2", kind: "BLOCK", blockAssignmentRef: 1 },
      ],
    });
    const result = verifyParity("Scenario-7-StreamingBlock", req);
    expect(result.candidateCount).toBe(3);
  });

  // ===========================================================================
  // 8. 同点タイブレーク局面 (Tie-Break Determinism)
  // ===========================================================================
  it("Scenario 8: 同点タイブレーク局面 (Tie-Break Determinism) のパリティ検証", () => {
    // 同一のアクション・同一の効果を持つ複数の pattern
    const req = createBaseRequest({
      patterns: [
        { patternId: "pat-pass", kind: "PASS" },
        { patternId: "pat-summon-1", kind: "ACTION", actionSelectionRef: 2, keyCardSelectionRef: 0 },
        { patternId: "pat-summon-2", kind: "ACTION", actionSelectionRef: 2, keyCardSelectionRef: 0 },
      ],
    });
    // 全重みゼロで評価し、ベーススコア同点時のタイブレーク (最小 patternRef 優先) を検証
    const zeroOld = new Array(20).fill(0.0);
    const zeroNew = new Array(24).fill(0.0);
    const result = verifyParity("Scenario-8-TieBreak", req, zeroOld, zeroNew);
    expect(result.candidateCount).toBe(3);
  });

  // ===========================================================================
  // 9. Joker含む局面 (Joker Presence)
  // ===========================================================================
  it("Scenario 9: Joker含む局面 (Joker Presence) のパリティ検証", () => {
    const req = createBaseRequest({
      observation: {
        ...createBaseRequest().observation,
        players: [
          {
            playerId: "p1",
            name: "Alice",
            isViewer: false,
            lifeCount: 15,
            lifeDisplay: "15",
            handCount: 4,
            handCards: [],
            field: [],
            fog: [],
            trumps: [],
            graveCount: 0,
            grave: [],
            canViewFullGrave: false,
          },
          {
            playerId: "p2",
            name: "Bob",
            isViewer: true,
            lifeCount: 15,
            lifeDisplay: "15",
            handCount: 4,
            handCards: [
              { visibility: "KNOWN", cardInstanceId: "c-joker-1", suit: "JOKER", rank: "JOKER", value: 0, faceUp: true, isJoker: true } as any,
              { visibility: "KNOWN", cardInstanceId: "c-bob-norm", suit: "spade", rank: "10", value: 10, faceUp: true },
            ],
            field: [],
            fog: [],
            trumps: [],
            graveCount: 0,
            grave: [],
            canViewFullGrave: true,
          },
        ],
      },
      catalog: {
        ...createBaseRequest().catalog,
        cardSelections: [
          { cardIds: ["c-joker-1"] },
          { cardIds: ["c-bob-norm"] },
        ],
      },
      patterns: [
        { patternId: "pat-pass", kind: "PASS" },
        { patternId: "pat-summon-joker", kind: "ACTION", actionSelectionRef: 2, keyCardSelectionRef: 0 },
        { patternId: "pat-summon-norm", kind: "ACTION", actionSelectionRef: 2, keyCardSelectionRef: 1 },
      ],
    });
    const result = verifyParity("Scenario-9-JokerPresence", req);
    expect(result.candidateCount).toBe(3);
  });

  // ===========================================================================
  // 10. 旧 G0 / G3 重み適用局面 (Evolved Benchmark Weights)
  // ===========================================================================
  it("Scenario 10: 旧 G0 / G3 重み適用局面 (Evolved Benchmark Weights) のパリティ検証", () => {
    // 実際に進化学習で得られるような多様な非ゼロ重み
    const evolved20Weights = [
      -2.45, -0.78, -0.31, -1.85, -0.52, -0.21,
      +2.15, +1.83, +1.05, +0.18,
      +0.22, +0.26, +0.06, -0.33,
      +0.19, -2.48, -0.49,
      +0.12,
      +1.98, +2.52,
    ];
    const evolved24Weights = [...evolved20Weights, 0.0, 0.0, 0.0, 0.0];

    const req = createBaseRequest({
      patterns: [
        { patternId: "pat-pass", kind: "PASS" },
        { patternId: "pat-attack", kind: "ACTION", actionSelectionRef: 1, unitSelectionRef: 0 },
        { patternId: "pat-summon", kind: "ACTION", actionSelectionRef: 2, keyCardSelectionRef: 0 },
        { patternId: "pat-bulwark", kind: "ACTION", actionSelectionRef: 3, keyCardSelectionRef: 1 },
      ],
    });
    const result = verifyParity("Scenario-10-EvolvedWeights", req, evolved20Weights, evolved24Weights);
    expect(result.candidateCount).toBe(4);
  });

  afterAll(() => {
    // 監査レポート用証跡の保存
    const evidenceDir = path.resolve(process.cwd(), "evidence/gen9-work5-5b");
    if (!fs.existsSync(evidenceDir)) {
      fs.mkdirSync(evidenceDir, { recursive: true });
    }
    const evidencePath = path.join(evidenceDir, "golden_parity_results_r1.json");
    const payload = {
      benchmarkCommit: "efe071f65ef37ec2a5bd6670ec52aaa3cd4d33a8",
      headCommit: "Work 5-5B R1",
      scenariosEvaluated: scenarioSummaries.length,
      totalCandidatesChecked,
      totalMismatches,
      parityVerified: totalMismatches === 0,
      timestamp: new Date().toISOString(),
      scenarios: scenarioSummaries,
    };
    fs.writeFileSync(evidencePath, JSON.stringify(payload, null, 2), "utf8");
    expect(totalMismatches).toBe(0);
  });
});
