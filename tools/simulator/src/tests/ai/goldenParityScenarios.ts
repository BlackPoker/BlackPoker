/**
 * goldenParityScenarios.ts
 *
 * BlackPoker Simulator - Work 5-5B R2: 独立パリティ検証用 代表10局面の共通定義
 *
 * 【設計方針】
 * - DecisionRequest, DecisionCatalog, LegalPattern, PlayerObservation の正式な型定義を完全遵守。
 * - CardSelection.displayCodes, UnitSelection.displayNames への正規値設定。
 * - LegalPattern.keyUnitSelectionRef の使用（unitSelectionRef の廃止）。
 * - ブロック局面（Scenario 6, 7）における LegalPatternGenerator の正式 API 使用。
 *   kind: "EFFECT_SELECTION", selectionType: "unitAssignment", EffectSelection.assignments の遵守。
 * - Scenario 8 における最高スコア同点タイブレーク局面の正式構成。
 * - Scenario 10 における G0_IND7 / G3_IND3 正本ベンチマーク重みの適用。
 */

import { DecisionRequest } from "../../domain/decision/DecisionRequest.js";
import { LegalPattern } from "../../domain/decision/LegalPattern.js";
import { UnitAssignment } from "../../domain/decision/DecisionCatalog.js";
import { RulePackage } from "../../domain/rules/RulePackage.js";
import { LegalPatternGenerator } from "../../engine/decision/LegalPatternGenerator.js";
import { G0_IND7_WEIGHTS, G3_IND3_WEIGHTS } from "../../engine/ai/Gen9BenchmarkWeights.js";

export function makeCard(id: string, value: number, suit: string = "S", rank?: string): any {
  const resolvedRank =
    rank ??
    (value === 1
      ? "A"
      : value === 11
        ? "J"
        : value === 12
          ? "Q"
          : value === 13
            ? "K"
            : String(value));
  return {
    id,
    code: suit === "JOKER" ? "JOKER" : `${suit}${resolvedRank}`,
    suit: suit as any,
    rank: (suit === "JOKER" ? "JOKER" : resolvedRank) as any,
    value,
    faceUp: true,
  };
}

export function makeSoldier(
  id: string,
  size: number,
  state: "charge" | "drive" = "charge",
  isAttacker: boolean = false
): any {
  const rank =
    size <= 10
      ? String(size)
      : size === 11
        ? "J"
        : size === 12
          ? "Q"
          : size === 13
            ? "K"
            : "10";
  const unit: any = {
    id,
    unitId: id,
    kind: "兵士",
    componentId: "character.soldier",
    properties: { characterType: "soldier" },
    cards: [makeCard(`card-${id}`, size, "S", rank)],
    state,
    face: "up",
    labels: ["攻撃", "防御"],
    sizeFormula: "sumValue",
    currentSize: size,
  };
  if (isAttacker) {
    unit.battle = {
      role: "attacker",
      targetPlayerKey: "playerA",
    };
  }
  return unit;
}

export function createBlockDecisionTestState(params: {
  attackers: any[];
  blockersField: any[];
  blockersTrumps?: any[];
  selfLifeCount?: number;
  oppLifeCount?: number;
}): {
  state: any;
  attackers: any[];
  candidateBlockers: any[];
} {
  const selfLifeCount = params.selfLifeCount ?? 10;
  const oppLifeCount = params.oppLifeCount ?? 10;

  const selfLifeCards = Array.from({ length: selfLifeCount }, (_, i) =>
    makeCard(`life-a-${i}`, (i % 10) + 1)
  );
  const oppLifeCards = Array.from({ length: oppLifeCount }, (_, i) =>
    makeCard(`life-b-${i}`, (i % 10) + 1)
  );

  const attackers = params.attackers.map((u) => ({
    ...u,
    battle: u.battle ?? {
      role: "attacker" as const,
      targetPlayerKey: "playerA" as const,
    },
  }));

  const state: any = {
    gameEnd: false,
    deck: [],
    turnCount: 3,
    turnPlayerKey: "playerB",
    chancePlayerKey: "playerA",
    focusPlayerKey: "playerA",
    phaseKey: "mainPhase",
    activeActionId: "action.attack",
    stage: { requests: [], nextSequence: 1 },
    players: {
      playerA: {
        name: "Player A",
        hand: [],
        field: params.blockersField,
        trumps: params.blockersTrumps ?? [],
        fog: [],
        grave: [],
        life: selfLifeCards,
        pack: [],
        rareCards: [],
        openedPack: false,
      } as any,
      playerB: {
        name: "Player B",
        hand: [],
        field: attackers,
        trumps: [],
        fog: [],
        grave: [],
        life: oppLifeCards,
        pack: [],
        rareCards: [],
        openedPack: false,
      } as any,
    },
  };

  const candidateBlockers = [
    ...params.blockersField,
    ...(params.blockersTrumps ?? []),
  ];

  return { state, attackers, candidateBlockers };
}

export function resolveChosenAssignments(
  request: Readonly<DecisionRequest>,
  selectedPatternRef: number
): readonly UnitAssignment[] {
  if (request.patterns.length > 0) {
    const pat = request.patterns[selectedPatternRef];
    if (!pat || pat.effectSelectionRef === undefined) {
      throw new Error(`Invalid pattern or missing effectSelectionRef at ref=${selectedPatternRef}`);
    }
    const eff = request.catalog.effectSelections[pat.effectSelectionRef];
    if (!eff || eff.selectionType !== "unitAssignment") {
      throw new Error(`Invalid effectSelection at ref=${pat.effectSelectionRef}`);
    }
    return eff.assignments ?? [];
  }

  if (!request.blockAssignmentStream) {
    throw new Error(`Neither patterns nor blockAssignmentStream found in request`);
  }
  let idx = 0;
  for (const assignments of request.blockAssignmentStream.iterateAssignments()) {
    if (idx === selectedPatternRef) {
      return assignments.map((a) => ({
        sourceUnitId: a.sourceUnitId,
        selectedUnitIds: [...a.selectedUnitIds],
      }));
    }
    idx++;
  }
  throw new Error(`selectedPatternRef=${selectedPatternRef} not found in stream`);
}

export function createBaseRequest(overrides?: Partial<DecisionRequest>): DecisionRequest {
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
        { actionId: "action.counter", actionName: "Counter", speed: "quick", timing: "quick" },
        { actionId: "action.attack", actionName: "Attack", speed: "normal", timing: "normal" },
        { actionId: "action.summonSoldier", actionName: "Summon", speed: "normal", timing: "normal" },
        { actionId: "action.addBulwark", actionName: "Bulwark", speed: "normal", timing: "normal" },
      ],
      cardSelections: [
        { cardIds: ["c-bob-1"], displayCodes: ["S7"] },
        { cardIds: ["c-bob-2"], displayCodes: ["HK"] },
        { cardIds: ["c-bob-3"], displayCodes: ["D3"] },
      ],
      unitSelections: [
        { unitIds: ["u-bob-1"], displayNames: ["Soldier 1"] },
      ],
      costPayments: [
        {
          discardedCardIds: ["c-bob-3"],
          drivenBulwarkUnitIds: [],
          sacrificedUnitIds: [],
          lifeCount: 0,
        },
      ],
      targetSelections: [],
      effectSelections: [],
      orderSelections: [],
    },
    patterns: [
      { patternId: "pat-pass", kind: "PASS" },
      { patternId: "pat-attack", kind: "ACTION", actionSelectionRef: 1, keyUnitSelectionRef: 0 },
      { patternId: "pat-summon", kind: "ACTION", actionSelectionRef: 2, keyCardSelectionRef: 0 },
    ],
    ...overrides,
  };
}

export interface ScenarioDefinition {
  scenarioName: string;
  request: DecisionRequest;
  customOldWeights?: number[];
  customNewWeights?: number[];
  extraStreamingRequest?: DecisionRequest;
}

const MOCK_BLOCK_REQUEST: any = { id: "req-block", actionId: "action.block" };

export function buildAllScenarios(rulePkg: RulePackage): ScenarioDefinition[] {
  // Scenario 1: 通常アクション局面
  const sc1Req = createBaseRequest();

  // Scenario 2: コスト支払い局面
  const sc2Req = createBaseRequest({
    patterns: [
      { patternId: "pat-pass", kind: "PASS" },
      { patternId: "pat-summon-free", kind: "ACTION", actionSelectionRef: 2, keyCardSelectionRef: 0 },
      { patternId: "pat-summon-cost", kind: "ACTION", actionSelectionRef: 2, keyCardSelectionRef: 0, costPaymentRef: 0 },
    ],
  });

  // Scenario 3: キーカード選択局面
  const sc3Req = createBaseRequest({
    patterns: [
      { patternId: "pat-pass", kind: "PASS" },
      { patternId: "pat-summon-key0", kind: "ACTION", actionSelectionRef: 2, keyCardSelectionRef: 0 },
      { patternId: "pat-summon-key1", kind: "ACTION", actionSelectionRef: 2, keyCardSelectionRef: 1 },
      { patternId: "pat-summon-key2", kind: "ACTION", actionSelectionRef: 2, keyCardSelectionRef: 2 },
    ],
  });

  // Scenario 4: Counter有効局面
  const sc4Req = createBaseRequest({
    observation: {
      ...createBaseRequest().observation,
      players: [
        createBaseRequest().observation.players[0],
        {
          ...createBaseRequest().observation.players[1],
          lifeCount: 10,
          lifeDisplay: "10",
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
      stageRequestRefs: ["req-deathlance-1"],
    },
    catalog: {
      ...createBaseRequest().catalog,
      targetSelections: [
        { targetType: "request", targetRequestId: "req-deathlance-1" } as any,
      ],
    },
    patterns: [
      { patternId: "pat-pass", kind: "PASS" },
      {
        patternId: "pat-counter",
        kind: "ACTION",
        actionSelectionRef: 0,
        targetSelectionRef: 0,
      },
    ],
  });

  // Scenario 5: 受動PASS局面 (有効対抗手段なし)
  const sc5Req = createBaseRequest({
    observation: {
      ...createBaseRequest().observation,
      stageRequests: [
        {
          id: "req-opp-attack",
          actionId: "action.attack",
          playerId: "p1",
          sourceUnitId: "u-opp-1",
          targetType: "player",
          targetPlayerKey: "p2",
        } as any,
      ],
      stageRequestRefs: ["req-opp-attack"],
    },
    patterns: [
      { patternId: "pat-pass", kind: "PASS" },
      { patternId: "pat-summon-blind", kind: "ACTION", actionSelectionRef: 2, keyCardSelectionRef: 0 },
    ],
  });

  // Scenario 6: 通常ブロック局面 (LegalPatternGenerator 使用)
  const sc6Attacker = makeSoldier("u-opp-att-1", 5, "drive", true);
  const sc6Blocker1 = makeSoldier("u-bob-def-1", 3, "charge");
  const sc6Blocker2 = makeSoldier("u-bob-def-2", 4, "charge");
  const sc6State = createBlockDecisionTestState({
    attackers: [sc6Attacker],
    blockersField: [sc6Blocker1, sc6Blocker2],
    selfLifeCount: 10,
  });
  const sc6Decision = LegalPatternGenerator.generateBlockAssignmentDecision(
    sc6State.state,
    "playerA",
    MOCK_BLOCK_REQUEST,
    "step-block-sc6",
    sc6State.attackers,
    sc6State.candidateBlockers,
    rulePkg.components,
    { maxFullPatternLimit: Infinity }
  );
  const sc6Req = sc6Decision.request;

  // Scenario 7: ストリーミングブロック局面 (Method A: 通常, Method B: ストリーミング)
  const sc7Attacker1 = makeSoldier("u-opp-att-1", 3, "drive", true);
  const sc7Attacker2 = makeSoldier("u-opp-att-2", 5, "drive", true);
  const sc7Blocker1 = makeSoldier("u-bob-def-1", 4, "charge");
  const sc7Blocker2 = makeSoldier("u-bob-def-2", 6, "charge");
  const sc7State = createBlockDecisionTestState({
    attackers: [sc7Attacker1, sc7Attacker2],
    blockersField: [sc7Blocker1, sc7Blocker2],
    selfLifeCount: 8,
  });
  const sc7NormalDecision = LegalPatternGenerator.generateBlockAssignmentDecision(
    sc7State.state,
    "playerA",
    MOCK_BLOCK_REQUEST,
    "step-block-sc7",
    sc7State.attackers,
    sc7State.candidateBlockers,
    rulePkg.components,
    { maxFullPatternLimit: Infinity }
  );
  const sc7StreamDecision = LegalPatternGenerator.generateBlockAssignmentDecision(
    sc7State.state,
    "playerA",
    MOCK_BLOCK_REQUEST,
    "step-block-sc7",
    sc7State.attackers,
    sc7State.candidateBlockers,
    rulePkg.components,
    { maxFullPatternLimit: 0 }
  );
  const sc7Req = sc7NormalDecision.request;
  const sc7StreamReq = sc7StreamDecision.request;

  // Scenario 8: 最高スコア同点タイブレーク局面 (Tie-Break Determinism)
  // 全重みゼロ評価時に最高スコアとなるアクション候補を複数用意
  const sc8Req = createBaseRequest({
    patterns: [
      { patternId: "pat-attack-top1", kind: "ACTION", actionSelectionRef: 1, keyUnitSelectionRef: 0 },
      { patternId: "pat-attack-top2", kind: "ACTION", actionSelectionRef: 1, keyUnitSelectionRef: 0 },
      { patternId: "pat-pass-lower", kind: "PASS" },
    ],
  });

  // Scenario 9: Joker含む局面 (Joker Presence)
  const sc9Req = createBaseRequest({
    observation: {
      ...createBaseRequest().observation,
      players: [
        createBaseRequest().observation.players[0],
        {
          ...createBaseRequest().observation.players[1],
          handCards: [
            { visibility: "KNOWN", cardInstanceId: "c-joker-1", suit: "joker", rank: "JOKER", value: 0, faceUp: true },
            { visibility: "KNOWN", cardInstanceId: "c-bob-norm", suit: "spade", rank: "5", value: 5, faceUp: true },
          ],
        },
      ],
    },
    catalog: {
      ...createBaseRequest().catalog,
      cardSelections: [
        { cardIds: ["c-joker-1"], displayCodes: ["JOKER"] },
        { cardIds: ["c-bob-norm"], displayCodes: ["S5"] },
      ],
    },
    patterns: [
      { patternId: "pat-pass", kind: "PASS" },
      { patternId: "pat-summon-joker", kind: "ACTION", actionSelectionRef: 2, keyCardSelectionRef: 0 },
      { patternId: "pat-summon-norm", kind: "ACTION", actionSelectionRef: 2, keyCardSelectionRef: 1 },
    ],
  });

  // Scenario 10: 正本ベンチマーク重み適用局面 (G0_IND7 / G3_IND3 Benchmark Weights)
  const sc10Req = createBaseRequest({
    patterns: [
      { patternId: "pat-pass", kind: "PASS" },
      { patternId: "pat-attack", kind: "ACTION", actionSelectionRef: 1, keyUnitSelectionRef: 0 },
      { patternId: "pat-summon", kind: "ACTION", actionSelectionRef: 2, keyCardSelectionRef: 0 },
      { patternId: "pat-bulwark", kind: "ACTION", actionSelectionRef: 3, keyCardSelectionRef: 1 },
    ],
  });
  const g0Ind7_20 = [...G0_IND7_WEIGHTS];
  const g0Ind7_24 = [...g0Ind7_20, 0.0, 0.0, 0.0, 0.0];

  return [
    { scenarioName: "Scenario-1-NormalAction", request: sc1Req },
    { scenarioName: "Scenario-2-CostPayment", request: sc2Req },
    { scenarioName: "Scenario-3-KeyCardSelection", request: sc3Req },
    { scenarioName: "Scenario-4-EffectiveCounter", request: sc4Req },
    { scenarioName: "Scenario-5-PassivePass", request: sc5Req },
    { scenarioName: "Scenario-6-NormalBlock", request: sc6Req },
    { scenarioName: "Scenario-7-StreamingBlock", request: sc7Req, extraStreamingRequest: sc7StreamReq },
    {
      scenarioName: "Scenario-8-TieBreak",
      request: sc8Req,
      customOldWeights: new Array(20).fill(0.0),
      customNewWeights: new Array(24).fill(0.0),
    },
    { scenarioName: "Scenario-9-JokerPresence", request: sc9Req },
    {
      scenarioName: "Scenario-10-G0_IND7_BenchmarkWeights",
      request: sc10Req,
      customOldWeights: g0Ind7_20,
      customNewWeights: g0Ind7_24,
    },
  ];
}
