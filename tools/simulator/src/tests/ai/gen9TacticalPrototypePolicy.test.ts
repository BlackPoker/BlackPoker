import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { DecisionRequest } from "../../domain/decision/DecisionRequest.js";
import { DecisionDNACodec } from "../../engine/ai/DecisionDNACodec.js";
import { Gen9TacticalPrototypePolicy } from "../../engine/ai/Gen9TacticalPrototypePolicy.js";
import { GenericTacticalEvaluator } from "../../engine/rules/GenericTacticalEvaluator.js";
import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader.js";
import { createGen8ChampionCandidatePolicy } from "../../engine/ai/Gen8DNALoader.js";
import { RulePackage } from "../../domain/rules/RulePackage.js";
import { RequestView } from "../../domain/decision/PlayerObservation.js";

describe("Gen9TacticalPrototypePolicy (Work 5-1 R2)", () => {
  beforeAll(() => {
    const fullPkg = loadRulePackageForBrowser();
    const evaluator = new GenericTacticalEvaluator(fullPkg);
    Gen9TacticalPrototypePolicy.setDefaultEvaluator(evaluator);
  });
  const gen8 = createGen8ChampionCandidatePolicy();
  const dna = DecisionDNACodec.clone((gen8 as any).dna);

  const createBaseRequest = (overrides?: Partial<DecisionRequest>): DecisionRequest => {
    return {
      protocolVersion: "1.0.0",
      matchId: "match-test-gen9",
      decisionId: "dec-gen9-001",
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
      catalog: {
        actions: [
          { actionId: "action.counter", actionName: "Counter", speed: "quick", timing: "quick" } as any,
          { actionId: "action.attack", actionName: "Attack", speed: "normal", timing: "normal" } as any,
          { actionId: "action.summonSoldier", actionName: "Summon", speed: "normal", timing: "normal" } as any,
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

  it("1. DecisionPolicy 契約を遵守し、決定論的に同一出力を返す", () => {
    const policy = new Gen9TacticalPrototypePolicy(dna, "Gen9-Test");
    const req = createBaseRequest();

    const res1 = policy.choose(req);
    const res2 = policy.choose(req);

    expect(res1.decisionId).toBe(req.decisionId);
    expect(res1.stateVersion).toBe(req.stateVersion);
    expect(res1.selectedPatternRef).toBe(res2.selectedPatternRef);

    const evalRes = policy.evaluatePatterns(req);
    expect(evalRes.bestPatternRef).toBe(res1.selectedPatternRef);
    expect(evalRes.scoredPatterns.length).toBe(req.patterns.length);
    for (const sp of evalRes.scoredPatterns) {
      expect(Number.isFinite(sp.finalScore)).toBe(true);
      expect(Number.isNaN(sp.finalScore)).toBe(false);
    }
  });

  it("2. 死の槍（公式YAML条件成立・致死）に対し、PASSがペナルティを受けCounterが優先される", () => {
    const policy = new Gen9TacticalPrototypePolicy(dna, "Gen9-Test");
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
                currentSize: 10, // ♢1で割り切れる
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
    });

    const evalRes = policy.evaluatePatterns(req);
    const passDetail = evalRes.scoredPatterns.find((p) => p.patternRef === 0);
    const counterDetail = evalRes.scoredPatterns.find((p) => p.patternRef === 1);

    expect(passDetail).toBeDefined();
    expect(counterDetail).toBeDefined();
    // ♠13 - 1 = 12ダメージ >= 残ライフ10 なので、PASS は致死ペナルティ (-2.5) を受ける
    expect(passDetail!.tacticalAdjustment).toBeLessThanOrEqual(-2.5);
    // Counter は阻止ボーナス (+2.2) を受ける
    expect(counterDetail!.tacticalAdjustment).toBeGreaterThanOrEqual(2.0);
    // 最終的に Counter が選択される
    expect(evalRes.bestPatternRef).toBe(1);
  });

  it("3. 死の槍のガード条件不成立（割り切れない）時はダメージ0と判定され過度なペナルティをかけない", () => {
    const policy = new Gen9TacticalPrototypePolicy(dna, "Gen9-Test");
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
                currentSize: 7, // ♢3で割り切れない（不発！）
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
              { visibility: "KNOWN", cardInstanceId: "c1", suit: "diamond", rank: "3", value: 3, faceUp: true },
              { visibility: "KNOWN", cardInstanceId: "c2", suit: "spade", rank: "K", value: 13, faceUp: true },
            ],
          },
        ],
        recentEvents: [],
      },
    });

    const evalRes = policy.evaluatePatterns(req);
    const passDetail = evalRes.scoredPatterns.find((p) => p.patternRef === 0);
    // 不発のため PASS にダメージペナルティは入らない (0)
    expect(passDetail!.tacticalAdjustment).toBe(0);
  });

  it("4. 数的優位（アタッカー2体 vs ブロッカー1体）のとき、突破攻撃ボーナスが付与される", () => {
    const policy = new Gen9TacticalPrototypePolicy(dna, "Gen9-Test");
    const req = createBaseRequest({
      catalog: {
        actions: [
          { actionId: "action.attack", actionName: "Attack", speed: "normal", timing: "normal" } as any,
          { actionId: "action.summonSoldier", actionName: "Summon", speed: "normal", timing: "normal" } as any,
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
          patternId: "pat-attack",
          kind: "ACTION",
          actionSelectionRef: 0,
        },
        {
          patternId: "pat-summon",
          kind: "ACTION",
          actionSelectionRef: 1,
        },
      ],
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
            field: [
              {
                unitId: "u-opp-hero",
                kind: "hero",
                state: "charge",
                face: "up",
                cards: [],
                labels: [],
                currentSize: 13, // 相手ブロッカー 1体
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
                unitId: "u-my-soldier-1",
                kind: "soldier",
                state: "charge",
                face: "up",
                cards: [],
                labels: [],
                currentSize: 3,
              },
              {
                unitId: "u-my-soldier-2",
                kind: "soldier",
                state: "charge",
                face: "up",
                cards: [],
                labels: [],
                currentSize: 8,
              },
            ], // 自軍アタッカー 2体
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

    const evalRes = policy.evaluatePatterns(req);
    const attackDetail = evalRes.scoredPatterns.find((p) => p.patternRef === 0);

    expect(attackDetail).toBeDefined();
    // アタッカー2体 > ブロッカー1体 の数的優位のため、攻撃にペナルティではなくボーナス (+0.25) が付与される
    expect(attackDetail!.tacticalAdjustment).toBeGreaterThan(0);
  });

  it("5. アーキテクチャ境界テスト: GameState や UI への不正な依存がないこと", () => {
    const policyPath = path.resolve(__dirname, "../../engine/ai/Gen9TacticalPrototypePolicy.ts");
    const content = fs.readFileSync(policyPath, "utf-8");

    expect(content).not.toMatch(/import\s+.*GameState/);
    expect(content).not.toMatch(/import\s+.*GameSession/);
    expect(content).not.toMatch(/import\s+.*\/ui\//);
    expect(content).not.toContain("window.");
    expect(content).not.toContain("document.");
  });

  describe("GenericTacticalEvaluator - 汎用 DSL 効果評価基盤の単体検証", () => {
    it("6-1. 死の槍: ガード条件成立で正味12ダメージ、不成立で不発(0ダメージ)がDSLから導出される", () => {
      const evaluator = new GenericTacticalEvaluator();

      const obsBase = {
        viewerPlayerId: "p2" as const,
        players: [
          { playerId: "p1" as const, isViewer: false, lifeCount: 15, lifeDisplay: "15", handCount: 0, handCards: [], field: [], fog: [], trumps: [], graveCount: 0, grave: [], canViewFullGrave: false },
          {
            playerId: "p2" as const,
            isViewer: true,
            lifeCount: 15,
            lifeDisplay: "15",
            handCount: 0,
            handCards: [],
            field: [
              { unitId: "u-soldier-10", kind: "soldier", state: "charge", face: "up", cards: [], labels: [], currentSize: 10 },
              { unitId: "u-soldier-3", kind: "soldier", state: "charge", face: "up", cards: [], labels: [], currentSize: 3 },
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
      };

      // ケース A: サイズ 10 の兵士を対象、♢1 + ♠13 (成立)
      const reqHit: RequestView = {
        requestId: "req-1" as any,
        actionId: "action.deathLance",
        controller: "p1",
        status: "PENDING",
        sequence: 1,
        target: { targetType: "unit", targetUnitId: "u-soldier-10" },
        keyCards: [
          { visibility: "KNOWN", cardInstanceId: "c-dia", suit: "diamond", rank: "A", value: 1, faceUp: true },
          { visibility: "KNOWN", cardInstanceId: "c-spd", suit: "spade", rank: "K", value: 13, faceUp: true },
        ],
      };

      const outcomeHit = evaluator.evaluateRequestOutcome(reqHit, "p2", obsBase);
      expect(outcomeHit.isGuardedOut).toBe(false);
      expect(outcomeHit.directDamageToSelf.expected).toBe(13);
      expect(outcomeHit.lifeGainToSelf.expected).toBe(1);
      expect(outcomeHit.netDamageToSelf.expected).toBe(12); // 正味 12 ダメージ
      expect(outcomeHit.netDamageToSelf.isCertain).toBe(true);

      // ケース B: サイズ 3 の兵士を対象、♢2 + ♠13 (ガード不成立 3 % 2 !== 0 で不発)
      const reqMiss: RequestView = {
        requestId: "req-2" as any,
        actionId: "action.deathLance",
        controller: "p1",
        status: "PENDING",
        sequence: 2,
        target: { targetType: "unit", targetUnitId: "u-soldier-3" },
        keyCards: [
          { visibility: "KNOWN", cardInstanceId: "c-dia2", suit: "diamond", rank: "2", value: 2, faceUp: true },
          { visibility: "KNOWN", cardInstanceId: "c-spd2", suit: "spade", rank: "K", value: 13, faceUp: true },
        ],
      };

      const outcomeMiss = evaluator.evaluateRequestOutcome(reqMiss, "p2", obsBase);
      expect(outcomeMiss.isGuardedOut).toBe(true);
      expect(outcomeMiss.netDamageToSelf.expected).toBe(0); // 不発で 0 ダメージ
    });

    it("6-2. 投擲: ♠数値が正確に直接ダメージとなり、固定値依存がないこと", () => {
      const fullPkg = loadRulePackageForBrowser();
      const evaluator = new GenericTacticalEvaluator(fullPkg);

      const obs = {
        viewerPlayerId: "p2" as const,
        players: [
          { playerId: "p1" as const, isViewer: false, lifeCount: 15, lifeDisplay: "15", handCount: 0, handCards: [], field: [], fog: [], trumps: [], graveCount: 0, grave: [], canViewFullGrave: false },
          { playerId: "p2" as const, isViewer: true, lifeCount: 15, lifeDisplay: "15", handCount: 0, handCards: [], field: [], fog: [], trumps: [], graveCount: 0, grave: [], canViewFullGrave: true },
        ],
        stageRequestRefs: [],
        stageRequests: [],
        recentEvents: [],
      };

      // 相手が自分 (p2) に ♠9 で投擲
      const reqThrow: RequestView = {
        requestId: "req-throw" as any,
        actionId: "action.throwing",
        controller: "p1",
        status: "PENDING",
        sequence: 1,
        target: { targetType: "player", targetPlayerKey: "p2" },
        keyCards: [
          { visibility: "KNOWN", cardInstanceId: "c-spd9", suit: "spade", rank: "9", value: 9, faceUp: true },
          { visibility: "KNOWN", cardInstanceId: "c-clb", suit: "club", rank: "3", value: 3, faceUp: true },
        ],
      };

      const outcome = evaluator.evaluateRequestOutcome(reqThrow, "p2", obs);
      expect(outcome.netDamageToSelf.expected).toBe(9); // ♠9 の 9 点ダメージ
      expect(outcome.netDamageToSelf.isCertain).toBe(true);
    });

    it("6-3. 新規切札 (action.meteor) を DSL 定義に追加するだけで、AI コード変更なしに戦術評価されること", () => {
      // ユーザー指示の長期目標: AIコードを変更せず、YAML DSL 定義を追加するだけで戦術評価できることの実証
      const customRulePackage: RulePackage = {
        id: "custom-test-rules",
        version: "1.0.0",
        actions: [
          {
            id: "action.meteor",
            name: "流星",
            type: "trump",
            request: { trigger: "direct", speed: "normal", timing: "main" },
            effect: [
              { dealDamage: { target: "targetPlayer", amount: 15 } },
            ],
          },
        ],
        components: [],
      };

      const evaluator = new GenericTacticalEvaluator(customRulePackage);

      const obs = {
        viewerPlayerId: "p2" as const,
        players: [
          { playerId: "p1" as const, isViewer: false, lifeCount: 15, lifeDisplay: "15", handCount: 0, handCards: [], field: [], fog: [], trumps: [], graveCount: 0, grave: [], canViewFullGrave: false },
          { playerId: "p2" as const, isViewer: true, lifeCount: 15, lifeDisplay: "15", handCount: 0, handCards: [], field: [], fog: [], trumps: [], graveCount: 0, grave: [], canViewFullGrave: true },
        ],
        stageRequestRefs: [],
        stageRequests: [],
        recentEvents: [],
      };

      const reqMeteor: RequestView = {
        requestId: "req-meteor" as any,
        actionId: "action.meteor",
        controller: "p1",
        status: "PENDING",
        sequence: 1,
        target: { targetType: "player", targetPlayerKey: "p2" },
      };

      const outcome = evaluator.evaluateRequestOutcome(reqMeteor, "p2", obs);
      expect(outcome.netDamageToSelf.expected).toBe(15); // コード変更なしで 15 点ダメージを自動導出！
      expect(outcome.netDamageToSelf.isCertain).toBe(true);
    });
  });
});
