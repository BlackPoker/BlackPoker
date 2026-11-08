import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { DecisionRequest } from "../../domain/decision/DecisionRequest.js";
import { DecisionDNACodec } from "../../engine/ai/DecisionDNACodec.js";
import { Gen9TacticalPrototypePolicy } from "../../engine/ai/Gen9TacticalPrototypePolicy.js";
import { createGen8ChampionCandidatePolicy } from "../../engine/ai/Gen8DNALoader.js";

describe("Gen9TacticalPrototypePolicy (Work 5-1)", () => {
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
        targetSelections: [],
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

  it("2. 死の槍（致死・大ダメージ）が存在する場合、PASSがペナルティを受けCounterが優先される", () => {
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
            field: [],
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
    // 14ダメージ (1+13) >= 残ライフ10 なので、PASS は致命的ペナルティ (-3.0) を受ける
    expect(passDetail!.tacticalAdjustment).toBeLessThanOrEqual(-3.0);
    // Counter は阻止ボーナス (+2.5) を受ける
    expect(counterDetail!.tacticalAdjustment).toBeGreaterThanOrEqual(2.5);
    // 最終的に Counter が選択される
    expect(evalRes.bestPatternRef).toBe(1);
  });

  it("3. 巨大ブロッカーが存在する場合、自爆攻撃にペナルティが入り召喚が優先される", () => {
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
                currentSize: 13,
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
                unitId: "u-my-soldier",
                kind: "soldier",
                state: "charge",
                face: "up",
                cards: [],
                labels: [],
                currentSize: 3,
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
    });

    const evalRes = policy.evaluatePatterns(req);
    const attackDetail = evalRes.scoredPatterns.find((p) => p.patternRef === 0);
    const summonDetail = evalRes.scoredPatterns.find((p) => p.patternRef === 1);

    expect(attackDetail).toBeDefined();
    expect(summonDetail).toBeDefined();
    // 相手サイズ13 vs 自軍サイズ3 のため、自爆攻撃ペナルティが入る
    expect(attackDetail!.tacticalAdjustment).toBeLessThan(0);
    // 自爆攻撃が回避され、召喚が選択される
    expect(evalRes.bestPatternRef).toBe(1);
  });

  it("4. アーキテクチャ境界テスト: GameState や UI への不正な依存がないこと", () => {
    const policyPath = path.resolve(__dirname, "../../engine/ai/Gen9TacticalPrototypePolicy.ts");
    const content = fs.readFileSync(policyPath, "utf-8");

    // import 文での GameState, GameSession, UI への依存がないことを検証
    expect(content).not.toMatch(/import\s+.*GameState/);
    expect(content).not.toMatch(/import\s+.*GameSession/);
    expect(content).not.toMatch(/import\s+.*\/ui\//);
    expect(content).not.toContain("window.");
    expect(content).not.toContain("document.");
  });
});
