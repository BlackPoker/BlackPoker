/**
 * gen9PassTacticalCondition.test.ts
 *
 * BlackPoker Simulator - Gen 9 PASS戦術評価の適用条件改善 回帰テスト (Work 5-4B)
 *
 * 【検証要件】
 * 1. 確定致死ダメージ + 有効なCounterあり（Counter選択）
 * 2. 確定致死ダメージ + 有効なCounterなし（PASS減点免除）
 * 3. 推定ダメージ + 確定Counterあり
 * 4. UNCERTAIN_CANCEL と UNKNOWN_CANCEL の厳格な区別（UNKNOWN_CANCEL は有効な対抗手段とみなさない）
 * 5. action.packOpen しか選択可能な代替アクションがない局面での PASS 選択回帰 (v7.1 と v7.2 の対比)
 * 6. 相手リクエストが存在しない通常の PASS
 * 7. Work 5-4A の通常・ストリーミングブロック評価の不変性確認
 */

import { describe, it, expect, beforeAll } from "vitest";
import { DecisionRequest } from "../../domain/decision/DecisionRequest.js";
import { DecisionDNACodec } from "../../engine/ai/DecisionDNACodec.js";
import { Gen9TacticalPrototypePolicy } from "../../engine/ai/Gen9TacticalPrototypePolicy.js";
import {
  Gen9LearnableTacticalPolicy,
  fromV6DNA,
  R4_PRESET_TACTICAL_WEIGHTS,
  encodeTacticalPatternFeatures,
  hasEffectiveCounterMeasure,
  TACTICAL_FEATURE_ENCODER_VERSION_LEGACY,
  TACTICAL_FEATURE_ENCODER_VERSION_V71,
  TACTICAL_FEATURE_ENCODER_VERSION_V72,
  TACTICAL_FEATURE_ENCODER_VERSION_CURRENT,
  createBlockTacticalContext,
  extractBlockAssignmentsFromPattern,
  evaluateBlockAssignmentTacticalFeatures,
} from "../../engine/ai/Gen9LearnableTacticalPolicy.js";
import { GenericTacticalEvaluator } from "../../engine/rules/GenericTacticalEvaluator.js";
import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader.js";
import { createGen8ChampionCandidatePolicy } from "../../engine/ai/Gen8DNALoader.js";
import {
  TacticalEvaluator,
  TacticalRequestOutcome,
  TacticalCounterOutcome,
} from "../../domain/decision/TacticalEvaluationTypes.js";
import { LegalPattern } from "../../domain/decision/LegalPattern.js";

describe("Work 5-4B: Gen 9 相手リクエスト対抗手段不在時のPASS戦術評価適用条件改善", () => {
  let evaluator: GenericTacticalEvaluator;
  const gen8 = createGen8ChampionCandidatePolicy();
  const dna = DecisionDNACodec.clone((gen8 as any).dna);

  beforeAll(() => {
    const fullPkg = loadRulePackageForBrowser();
    evaluator = new GenericTacticalEvaluator(fullPkg);
    Gen9TacticalPrototypePolicy.setDefaultEvaluator(evaluator);
  });

  const createBaseRequest = (overrides?: Partial<DecisionRequest>): DecisionRequest => {
    return {
      protocolVersion: "1.0.0",
      matchId: "match-test-gen9-work54b",
      decisionId: "dec-gen9-work54b-001",
      stateVersion: 1,
      playerId: "p2",
      source: {
        type: "ACTION_REQUEST",
        playerId: "p2",
      },
      observation: {
        viewerPlayerId: "p2",
        turnPlayerId: "p1",
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
        stageRequestRefs: ["req-deathlance-1" as any],
        stageRequests: [
          {
            requestId: "req-deathlance-1" as any,
            actionId: "action.deathLance",
            controller: "p1",
            status: "PENDING",
            sequence: 1,
            target: {
              targetType: "unit",
              targetUnitId: "u-my-soldier-target",
            },
            keyCards: [
              { visibility: "KNOWN", cardInstanceId: "c1", suit: "diamond", rank: "A", value: 1, faceUp: true },
              { visibility: "KNOWN", cardInstanceId: "c2", suit: "spade", rank: "K", value: 13, faceUp: true },
            ],
          },
        ],
        recentEvents: [],
      },
      catalog: {
        actions: [
          { actionId: "action.counter", actionName: "Counter", speed: "quick", timing: "quick" } as any,
          { actionId: "action.packOpen", actionName: "PackOpen", speed: "quick", timing: "quick" } as any,
        ],
        cardSelections: [],
        unitSelections: [],
        costPayments: [],
        targetSelections: [
          { targetType: "request", targetRequestId: "req-deathlance-1" } as any,
        ],
        effectSelections: [],
        orderSelections: [],
      },
      patterns: [
        {
          patternId: "pat-pass",
          kind: "PASS",
        },
        {
          patternId: "pat-counter",
          kind: "ACTION",
          actionSelectionRef: 0,
          targetSelectionRef: 0,
        },
      ],
      ...overrides,
    };
  };

  it("1. 確定致死ダメージ + 有効なCounterあり -> PASSにt00減点、Counterに阻止加点がつきCounterが選択される", () => {
    const req = createBaseRequest();
    const primaryOppReq = req.observation.stageRequests![0];
    const reqOutcome = evaluator.evaluateRequestOutcome(primaryOppReq, "p2", req.observation);

    // 有効な対抗手段が存在することの確認
    const hasCounter = hasEffectiveCounterMeasure(req, primaryOppReq, reqOutcome, evaluator);
    expect(hasCounter).toBe(true);

    // Gen9LearnableTacticalPolicy (v7.2) の特徴量エンコード検証
    const passFeatures = encodeTacticalPatternFeatures(
      req,
      req.patterns[0],
      evaluator,
      TACTICAL_FEATURE_ENCODER_VERSION_V72
    );
    expect(passFeatures.features[0]).toBe(1.0); // t00_pass_certain_lethal
    expect(passFeatures.reasons.some((r) => r.includes("t00_pass_certain_lethal=1.0"))).toBe(true);

    const counterFeatures = encodeTacticalPatternFeatures(
      req,
      req.patterns[1],
      evaluator,
      TACTICAL_FEATURE_ENCODER_VERSION_V72
    );
    expect(counterFeatures.features[6]).toBe(1.0); // t06_counter_certain_lethal_prevent

    // Gen9TacticalPrototypePolicy (v7.2) での評価検証
    const prototypePolicy = new Gen9TacticalPrototypePolicy(dna, "Gen9-Proto", evaluator, TACTICAL_FEATURE_ENCODER_VERSION_V72);
    const evalRes = prototypePolicy.evaluatePatterns(req);

    const passDetail = evalRes.scoredPatterns.find((p) => p.patternRef === 0)!;
    const counterDetail = evalRes.scoredPatterns.find((p) => p.patternRef === 1)!;

    expect(passDetail.tacticalAdjustment).toBeLessThanOrEqual(-2.5);
    expect(counterDetail.tacticalAdjustment).toBeGreaterThanOrEqual(2.2);
    expect(evalRes.bestPatternRef).toBe(1); // Counter 選択
  });

  it("2. 確定致死ダメージ + 有効なCounterなし -> PASSの減点 (t00〜t05) が免除される", () => {
    // Counter パターンを除去し、PASS のみの DecisionRequest を作成
    const req = createBaseRequest({
      patterns: [
        {
          patternId: "pat-pass",
          kind: "PASS",
        },
      ],
    });
    const primaryOppReq = req.observation.stageRequests![0];
    const reqOutcome = evaluator.evaluateRequestOutcome(primaryOppReq, "p2", req.observation);

    // 有効な対抗手段が存在しないことの確認
    const hasCounter = hasEffectiveCounterMeasure(req, primaryOppReq, reqOutcome, evaluator);
    expect(hasCounter).toBe(false);

    // v7.1 では t00 が 1.0 (減点 -2.5)
    const passFeaturesV71 = encodeTacticalPatternFeatures(
      req,
      req.patterns[0],
      evaluator,
      TACTICAL_FEATURE_ENCODER_VERSION_V71
    );
    expect(passFeaturesV71.features[0]).toBe(1.0); // t00 減点あり

    // v7.2 では t00〜t05 がすべて 0.0 (減点免除)
    const passFeaturesV72 = encodeTacticalPatternFeatures(
      req,
      req.patterns[0],
      evaluator,
      TACTICAL_FEATURE_ENCODER_VERSION_V72
    );
    expect(passFeaturesV72.features[0]).toBe(0.0);
    expect(passFeaturesV72.features[1]).toBe(0.0);
    expect(passFeaturesV72.features[2]).toBe(0.0);
    expect(passFeaturesV72.features[3]).toBe(0.0);
    expect(passFeaturesV72.features[4]).toBe(0.0);
    expect(passFeaturesV72.features[5]).toBe(0.0);
    expect(
      passFeaturesV72.reasons.some((r) =>
        r.includes("t00_t05_pass_penalty_exempted: no effective counter available")
      )
    ).toBe(true);

    // Gen9TacticalPrototypePolicy でも v7.1 と v7.2 の違いを検証
    const policyV71 = new Gen9TacticalPrototypePolicy(dna, "Gen9-v7.1", evaluator, TACTICAL_FEATURE_ENCODER_VERSION_V71);
    const evalV71 = policyV71.evaluatePatterns(req);
    expect(evalV71.scoredPatterns[0].tacticalAdjustment).toBeLessThanOrEqual(-2.5);

    const policyV72 = new Gen9TacticalPrototypePolicy(dna, "Gen9-v7.2", evaluator, TACTICAL_FEATURE_ENCODER_VERSION_V72);
    const evalV72 = policyV72.evaluatePatterns(req);
    expect(evalV72.scoredPatterns[0].tacticalAdjustment).toBe(0.0);
    expect(evalV72.scoredPatterns[0].reason).toContain("PASS penalty exempted: no effective counter available");
  });

  it("3. 推定ダメージ + 確定Counterあり -> 対抗手段ありのためPASSに推定ペナルティが適用されCounterが優先される", () => {
    // 3枚目のカードが非公開 (HIDDEN)
    const req = createBaseRequest({
      observation: {
        viewerPlayerId: "p2",
        turnPlayerId: "p1",
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
        stageRequestRefs: ["req-deathlance-1" as any],
        stageRequests: [
          {
            requestId: "req-deathlance-1" as any,
            actionId: "action.deathLance",
            controller: "p1",
            status: "PENDING",
            sequence: 1,
            target: {
              targetType: "unit",
              targetUnitId: "u-my-soldier-target",
            },
            keyCards: [
              { visibility: "KNOWN", cardInstanceId: "c1", suit: "diamond", rank: "A", value: 1, faceUp: true },
              { visibility: "HIDDEN", faceUp: false },
            ],
          },
        ],
        recentEvents: [],
      },
    });

    const primaryOppReq = req.observation.stageRequests![0];
    const reqOutcome = evaluator.evaluateRequestOutcome(primaryOppReq, "p2", req.observation);
    expect(reqOutcome.certainty).toBe("ESTIMATED");

    const hasCounter = hasEffectiveCounterMeasure(req, primaryOppReq, reqOutcome, evaluator);
    expect(hasCounter).toBe(true);

    const passFeatures = encodeTacticalPatternFeatures(
      req,
      req.patterns[0],
      evaluator,
      TACTICAL_FEATURE_ENCODER_VERSION_V72
    );
    // 推定致死リスク (max >= life) のため t03_pass_estimated_lethal_risk > 0 (riskPenalty / 1.8)
    expect(passFeatures.features[3]).toBeGreaterThan(0.5);

    const policyV72 = new Gen9TacticalPrototypePolicy(dna, "Gen9-v7.2", evaluator, TACTICAL_FEATURE_ENCODER_VERSION_V72);
    const evalRes = policyV72.evaluatePatterns(req);
    expect(evalRes.bestPatternRef).toBe(1); // Counter 選択
  });

  it("4. UNCERTAIN_CANCEL と UNKNOWN_CANCEL の厳格な区別 (UNKNOWN_CANCEL は有効な対抗手段とみなさない)", () => {
    const baseReq = createBaseRequest();
    const primaryOppReq = baseReq.observation.stageRequests![0];
    const dummyReqOutcome: TacticalRequestOutcome = {
      isGuardedOut: false,
      guardStatus: "CERTAIN_SATISFIED",
      netDamageToSelf: {
        min: 10,
        max: 10,
        expected: 10,
        isCertain: true,
        isUnknown: false,
      },
      netDamageToOpponent: { min: 0, max: 0, expected: 0, isCertain: true, isUnknown: false },
      directDamageToSelf: { min: 10, max: 10, expected: 10, isCertain: true, isUnknown: false },
      lifeGainToSelf: { min: 0, max: 0, expected: 0, isCertain: true, isUnknown: false },
      destroyedSelfUnits: [],
      destroyedOppUnits: [],
      reasons: [],
      certainty: "CERTAIN",
    };

    // 4-a: UNCERTAIN_CANCEL (不確実だが阻止可能性あり、preventedDamageToSelf.expected > 0)
    const mockEvaluatorUncertain: TacticalEvaluator = {
      evaluateRequestOutcome: () => dummyReqOutcome,
      evaluateCounterOutcome: (p: Readonly<LegalPattern>): TacticalCounterOutcome => {
        if (p.kind === "PASS") {
          return {
            cancelStatus: "CANNOT_CANCEL",
            isCertain: true,
            preventedDamageToSelf: { min: 0, max: 0, expected: 0, isCertain: true, isUnknown: false },
            reasons: [],
          };
        }
        return {
          cancelStatus: "UNCERTAIN_CANCEL",
          isCertain: false,
          preventedDamageToSelf: { min: 0, max: 10, expected: 5, isCertain: false, isUnknown: false },
          reasons: [],
        };
      },
    };

    const hasCounterUncertain = hasEffectiveCounterMeasure(
      baseReq,
      primaryOppReq,
      dummyReqOutcome,
      mockEvaluatorUncertain
    );
    expect(hasCounterUncertain).toBe(true); // 有効な対抗手段ありと判定

    const passFeaturesUncertain = encodeTacticalPatternFeatures(
      baseReq,
      baseReq.patterns[0],
      mockEvaluatorUncertain,
      TACTICAL_FEATURE_ENCODER_VERSION_V72
    );
    expect(passFeaturesUncertain.features[0]).toBe(1.0); // 確定致死 PASS 減点適用

    // 4-b: UNKNOWN_CANCEL (効果や式が未対応・未知)
    const mockEvaluatorUnknown: TacticalEvaluator = {
      evaluateRequestOutcome: () => dummyReqOutcome,
      evaluateCounterOutcome: (p: Readonly<LegalPattern>): TacticalCounterOutcome => {
        if (p.kind === "PASS") {
          return {
            cancelStatus: "CANNOT_CANCEL",
            isCertain: true,
            preventedDamageToSelf: { min: 0, max: 0, expected: 0, isCertain: true, isUnknown: false },
            reasons: [],
          };
        }
        return {
          cancelStatus: "UNKNOWN_CANCEL",
          isCertain: false,
          preventedDamageToSelf: { min: 0, max: 0, expected: 0, isCertain: false, isUnknown: true },
          reasons: [],
        };
      },
    };

    const hasCounterUnknown = hasEffectiveCounterMeasure(
      baseReq,
      primaryOppReq,
      dummyReqOutcome,
      mockEvaluatorUnknown
    );
    expect(hasCounterUnknown).toBe(false); // UNKNOWN_CANCEL は有効な対抗手段とみなさない

    const passFeaturesUnknown = encodeTacticalPatternFeatures(
      baseReq,
      baseReq.patterns[0],
      mockEvaluatorUnknown,
      TACTICAL_FEATURE_ENCODER_VERSION_V72
    );
    expect(passFeaturesUnknown.features[0]).toBe(0.0); // PASS 減点免除
    expect(
      passFeaturesUnknown.reasons.some((r) =>
        r.includes("t00_t05_pass_penalty_exempted")
      )
    ).toBe(true);

    // 4-c: CANNOT_CANCEL (阻止不可)
    const mockEvaluatorCannot: TacticalEvaluator = {
      evaluateRequestOutcome: () => dummyReqOutcome,
      evaluateCounterOutcome: (): TacticalCounterOutcome => ({
        cancelStatus: "CANNOT_CANCEL",
        isCertain: true,
        preventedDamageToSelf: { min: 0, max: 0, expected: 0, isCertain: true, isUnknown: false },
        reasons: [],
      }),
    };

    const hasCounterCannot = hasEffectiveCounterMeasure(
      baseReq,
      primaryOppReq,
      dummyReqOutcome,
      mockEvaluatorCannot
    );
    expect(hasCounterCannot).toBe(false);

    const passFeaturesCannot = encodeTacticalPatternFeatures(
      baseReq,
      baseReq.patterns[0],
      mockEvaluatorCannot,
      TACTICAL_FEATURE_ENCODER_VERSION_V72
    );
    expect(passFeaturesCannot.features[0]).toBe(0.0); // PASS 減点免除
  });

  it("5. action.packOpen しか選択可能な代替アクションがない局面での PASS 選択回帰 (v7.1 vs v7.2)", () => {
    // 相手の戦闘ダメージ判定 (確定致死 12ダメージ >= ライフ10) に対し、
    // 対抗手段となる Counter はなく、無関係な packOpen と PASS しか選べない状況 (Work 5-3 実測局面再現)
    const req = createBaseRequest({
      observation: {
        viewerPlayerId: "p2",
        turnPlayerId: "p1",
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
            field: [
              {
                unitId: "atk-1",
                kind: "soldier",
                state: "drive",
                face: "up",
                currentSize: 12,
                battle: { role: "attacker" },
              } as any,
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
            lifeCount: 10,
            lifeDisplay: "10",
            handCount: 0,
            handCards: [],
            field: [],
            fog: [],
            trumps: [],
            graveCount: 0,
            grave: [],
            canViewFullGrave: true,
          },
        ],
        stageRequestRefs: ["req-damage-1" as any],
        stageRequests: [
          {
            requestId: "req-damage-1" as any,
            actionId: "action.damageJudge",
            controller: "p1",
            status: "PENDING",
            sequence: 1,
          },
        ],
        recentEvents: [],
      },
      catalog: {
        actions: [
          { actionId: "action.packOpen", actionName: "PackOpen", speed: "quick", timing: "quick" } as any,
        ],
        cardSelections: [],
        unitSelections: [],
        costPayments: [],
        targetSelections: [],
        effectSelections: [],
        orderSelections: [],
      },
      patterns: [
        {
          patternId: "pat-packopen",
          kind: "ACTION",
          actionSelectionRef: 0, // action.packOpen (patternRef 0)
        },
        {
          patternId: "pat-pass",
          kind: "PASS", // PASS (patternRef 1)
        },
      ],
    });

    const primaryOppReq = req.observation.stageRequests![0];
    const reqOutcome = evaluator.evaluateRequestOutcome(primaryOppReq, "p2", req.observation);
    const hasCounter = hasEffectiveCounterMeasure(req, primaryOppReq, reqOutcome, evaluator);
    expect(hasCounter).toBe(false);

    // v7.1 (従来): PASS に -2.5 減点が適用されるため、消去法で action.packOpen (patternRef 0) を誤選択する
    const policyV71 = new Gen9TacticalPrototypePolicy(dna, "Gen9-v7.1", evaluator, TACTICAL_FEATURE_ENCODER_VERSION_V71);
    const responseV71 = policyV71.choose(req);
    const evalV71 = policyV71.evaluatePatterns(req);
    expect(evalV71.scoredPatterns.find((p) => p.patternRef === 1)!.tacticalAdjustment).toBeLessThanOrEqual(-2.5);
    expect(responseV71.selectedPatternRef).toBe(0); // 誤って packOpen を選択

    // v7.2 (改善後): PASS の減点が免除されるため、無駄な packOpen を選ばず PASS (patternRef 1) を正しく選択する
    const policyV72 = new Gen9TacticalPrototypePolicy(dna, "Gen9-v7.2", evaluator, TACTICAL_FEATURE_ENCODER_VERSION_V72);
    const responseV72 = policyV72.choose(req);
    const evalV72 = policyV72.evaluatePatterns(req);
    expect(evalV72.scoredPatterns.find((p) => p.patternRef === 1)!.tacticalAdjustment).toBe(0.0);
    expect(responseV72.selectedPatternRef).toBe(1); // PASS を正しく選択！

    // Gen9LearnableTacticalPolicy (v7.2) でも同様に PASS が選ばれることを確認
    const learnableGenome = fromV6DNA(dna, R4_PRESET_TACTICAL_WEIGHTS, {
      id: "learnable-v7.2",
      encoderVersion: TACTICAL_FEATURE_ENCODER_VERSION_V72,
    });
    const learnablePolicyV72 = new Gen9LearnableTacticalPolicy(learnableGenome, "Learnable-v7.2", evaluator);
    const learnableResponseV72 = learnablePolicyV72.choose(req);
    expect(learnableResponseV72.selectedPatternRef).toBe(1); // PASS を正しく選択！
  });

  it("6. 相手リクエストが存在しない通常の PASS: t00〜t05 は 0 で通常通り動作", () => {
    // stageRequests が空の通常手番
    const req = createBaseRequest({
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
            handCards: [],
            field: [],
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
    });

    const passFeatures = encodeTacticalPatternFeatures(
      req,
      req.patterns[0],
      evaluator,
      TACTICAL_FEATURE_ENCODER_VERSION_V72
    );

    // t00〜t05 がすべて 0.0
    for (let i = 0; i <= 5; i++) {
      expect(passFeatures.features[i]).toBe(0.0);
    }
    // 免除メッセージは出力されない（相手リクエストがないため）
    expect(passFeatures.reasons.some((r) => r.includes("exempted"))).toBe(false);

    const policyV72 = new Gen9TacticalPrototypePolicy(dna, "Gen9-v7.2", evaluator, TACTICAL_FEATURE_ENCODER_VERSION_V72);
    const evalRes = policyV72.evaluatePatterns(req);
    expect(evalRes.scoredPatterns[0].tacticalAdjustment).toBe(0.0);
  });

  it("7. Work 5-4A 通常・ストリーミングブロック評価の不変性確認 (v7.2 でもブロック評価が正しく機能する)", () => {
    // ブロック割り当てコンテキストの作成と評価
    const mockRequest: DecisionRequest = {
      protocolVersion: "1.0.0",
      matchId: "match-block-test",
      decisionId: "dec-block-001",
      stateVersion: 1,
      playerId: "p2",
      source: { type: "ACTION_REQUEST", playerId: "p2" },
      observation: {
        viewerPlayerId: "p2",
        turnPlayerId: "p1",
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
            field: [
              {
                unitId: "atk-1",
                kind: "soldier",
                state: "drive",
                face: "up",
                currentSize: 6,
                battle: { role: "attacker" },
              } as any,
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
            lifeCount: 5, // 6ダメージで致死
            lifeDisplay: "5",
            handCount: 4,
            handCards: [],
            field: [
              {
                unitId: "blk-1",
                kind: "soldier",
                state: "charge",
                face: "up",
                currentSize: 8,
              } as any,
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
        actions: [],
        cardSelections: [],
        unitSelections: [],
        costPayments: [],
        targetSelections: [],
        effectSelections: [
          // 未ブロック
          {
            selectionType: "unitAssignment",
            assignments: [{ sourceUnitId: "atk-1", selectedUnitIds: [] }],
          } as any,
          // ブロック成立 (size 8 vs 6 -> 有利トレード)
          {
            selectionType: "unitAssignment",
            assignments: [{ sourceUnitId: "atk-1", selectedUnitIds: ["blk-1"] }],
          } as any,
        ],
        orderSelections: [],
      },
      patterns: [
        { patternId: "pat-unblocked", kind: "EFFECT_SELECTION", effectSelectionRef: 0 },
        { patternId: "pat-blocked", kind: "EFFECT_SELECTION", effectSelectionRef: 1 },
      ],
    };

    const blockCtx = createBlockTacticalContext(mockRequest);

    // 未ブロック: t15_block_unblocked_lethal = 1.0 (ライフ5 <= ダメージ6)
    const unblockedAssignments = extractBlockAssignmentsFromPattern(
      mockRequest,
      mockRequest.patterns[0],
      blockCtx
    )!;
    const unblockedEvalV72 = evaluateBlockAssignmentTacticalFeatures(
      unblockedAssignments,
      blockCtx,
      TACTICAL_FEATURE_ENCODER_VERSION_V72,
      true
    );
    expect(unblockedEvalV72.t15_block_unblocked_lethal).toBe(1.0);

    // ブロック成立: t14_block_trade_advantage = 1.0 (有利トレード), t15 = 0.0
    const blockedAssignments = extractBlockAssignmentsFromPattern(
      mockRequest,
      mockRequest.patterns[1],
      blockCtx
    )!;
    const blockedEvalV72 = evaluateBlockAssignmentTacticalFeatures(
      blockedAssignments,
      blockCtx,
      TACTICAL_FEATURE_ENCODER_VERSION_V72,
      true
    );
    expect(blockedEvalV72.t14_block_trade_advantage).toBe(1.0);
    expect(blockedEvalV72.t15_block_unblocked_lethal).toBe(0.0);

    // v7.1 と v7.2 でブロック特徴量評価が完全に同一であることを検証
    const blockedEvalV71 = evaluateBlockAssignmentTacticalFeatures(
      blockedAssignments,
      blockCtx,
      TACTICAL_FEATURE_ENCODER_VERSION_V71,
      true
    );
    expect(blockedEvalV72.t14_block_trade_advantage).toBe(blockedEvalV71.t14_block_trade_advantage);
    expect(blockedEvalV72.t15_block_unblocked_lethal).toBe(blockedEvalV71.t15_block_unblocked_lethal);
    expect(blockedEvalV72.t16_block_unblocked_danger_ratio).toBe(blockedEvalV71.t16_block_unblocked_danger_ratio);
  });
});
