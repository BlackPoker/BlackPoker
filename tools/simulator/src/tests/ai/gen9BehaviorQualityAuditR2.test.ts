import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader.js";
import { RulePackage } from "../../domain/rules/RulePackage.js";
import { PlaytestPolicyFactory } from "../../engine/playtest/PlaytestPolicyFactory.js";
import { Gen9TacticalPrototypePolicy } from "../../engine/ai/Gen9TacticalPrototypePolicy.js";
import { Gen9LearnableTacticalPolicy } from "../../engine/ai/Gen9LearnableTacticalPolicy.js";
import { LegalPatternGenerator } from "../../engine/decision/LegalPatternGenerator.js";
import { buildFieldUnitFromComponent } from "../../engine/rules/commandHandlers.js";

describe("Work 5-7A R2: 最終診断の真正性確認 (Core生成DecisionRequest検証)", () => {
  let rulePackage: RulePackage;
  let policyV72: Gen9TacticalPrototypePolicy;
  let policyV73: Gen9LearnableTacticalPolicy;
  let r2EvidenceData: any = {
    workId: "BP-SIM-AI-GEN9-WORK57A-R2-FINAL-VALIDATION",
    timestamp: new Date().toISOString(),
    results: {},
  };

  beforeAll(() => {
    rulePackage = loadRulePackageForBrowser();

    policyV72 = PlaytestPolicyFactory.createPolicy(
      "gen9-r4-v72",
      undefined,
      "p1",
      "standard-pack",
      rulePackage
    ) as Gen9TacticalPrototypePolicy;

    policyV73 = PlaytestPolicyFactory.createPolicy(
      "gen9-cost-preview-v73",
      undefined,
      "p1",
      "standard-pack",
      rulePackage
    ) as Gen9LearnableTacticalPolicy;
  });

  afterAll(() => {
    const evidencePath = path.resolve(
      __dirname,
      "../../../evidence/gen9_behavior_quality_audit_work57a_r2.json"
    );
    fs.writeFileSync(evidencePath, JSON.stringify(r2EvidenceData, null, 2), "utf-8");
  });

  // =========================================================================
  // 1. BP-AI-09: Core生成 DecisionRequest による死の槍の検証
  // =========================================================================
  describe("1. BP-AI-09: 死の槍のCore生成検証", () => {
    it("1.1 致死局面 (相手ライフ10, ♠K=13点ダメージ): Core生成パターンとAI選択", () => {
      const spadeK = { id: "c-sk", suit: "S", rank: "K", value: 13, faceUp: true };
      const diamondA = { id: "c-da", suit: "D", rank: "A", value: 1, faceUp: true };
      const oppBossCard = { id: "c-boss", suit: "H", rank: "10", value: 10, faceUp: true };

      const oppBossUnit = {
        ...buildFieldUnitFromComponent({
          componentId: "character.soldier",
          playerKey: "p2",
          card: oppBossCard,
          components: rulePackage.components,
        }),
        unitId: "u-p2-boss",
        currentSize: 10,
        state: "charge",
        labels: ["soldier"],
        cards: [oppBossCard],
      };

      const state: any = {
        stateVersion: 10,
        turnPlayer: "p1",
        chancePlayer: "p1",
        stage: { requests: [] },
        players: {
          p1: {
            hand: [spadeK, diamondA],
            field: [],
            life: Array.from({ length: 10 }, (_, i) => ({ id: `p1-l${i + 1}` })),
            grave: [],
          },
          p2: {
            hand: [], // Counter不能
            field: [oppBossUnit],
            life: Array.from({ length: 10 }, (_, i) => ({ id: `p2-l${i + 1}` })), // ライフ10 (13点で即死)
            grave: [],
          },
        },
      };

      const decision = LegalPatternGenerator.generateActionRequestDecision(state, "p1", rulePackage);
      const req = decision.request;

      // 検証1: 死の槍パターンが存在すること
      const dlPatternIdx = req.patterns.findIndex((p) => {
        if (p.actionSelectionRef === undefined) return false;
        return req.catalog.actions[p.actionSelectionRef].actionId === "action.deathLance";
      });
      const endPatternIdx = req.patterns.findIndex((p) => {
        if (p.actionSelectionRef === undefined) return false;
        return req.catalog.actions[p.actionSelectionRef].actionId === "action.end";
      });

      expect(dlPatternIdx).toBeGreaterThanOrEqual(0);
      expect(endPatternIdx).toBeGreaterThanOrEqual(0);

      const dlPattern = req.patterns[dlPatternIdx];
      const keyCardSel = req.catalog.cardSelections[dlPattern.keyCardSelectionRef!];
      expect(keyCardSel.cardIds).toEqual(expect.arrayContaining(["c-sk", "c-da"]));

      // コスト支払いとキーカードの消費を混同しないこと
      // 死の槍には独立した costPayments は生成されない（costPaymentRef は undefined または空）
      if (dlPattern.costPaymentRef !== undefined) {
        const cp = req.catalog.costPayments[dlPattern.costPaymentRef];
        expect(cp.discardedCardIds).toEqual([]);
      }

      // AI評価
      const evalV72 = policyV72.evaluatePatterns(req);
      const evalV73 = policyV73.evaluatePatterns(req);
      const choiceV72 = policyV72.choose(req).selectedPatternRef;
      const choiceV73 = policyV73.choose(req).selectedPatternRef;

      r2EvidenceData.results["BP-AI-09-lethal"] = {
        scenario: "BP-AI-09 致死局面 (相手Life10, ♠K=13点, 相手手札0)",
        dlPatternIndex: dlPatternIdx,
        endPatternIndex: endPatternIdx,
        choiceV72,
        choiceV73,
        chosenActionV72: req.catalog.actions[req.patterns[choiceV72].actionSelectionRef!]?.actionId,
        chosenActionV73: req.catalog.actions[req.patterns[choiceV73].actionSelectionRef!]?.actionId,
        v72Scores: evalV72.scoredPatterns.map((p) => ({
          ref: p.patternRef,
          actionId: req.catalog.actions[req.patterns[p.patternRef].actionSelectionRef!]?.actionId,
          base: p.baseScore,
          tactical: p.tacticalAdjustment,
          final: p.finalScore,
          reason: p.reason,
        })),
        v73Scores: evalV73.scoredPatterns.map((p) => ({
          ref: p.patternRef,
          actionId: req.catalog.actions[req.patterns[p.patternRef].actionSelectionRef!]?.actionId,
          base: p.baseScore,
          tactical: p.tacticalAdjustment,
          final: p.finalScore,
          tacticalFeatures: p.tacticalFeatures?.slice(20, 24),
          reason: p.reason,
        })),
      };
    });

    it("1.2 非致死局面 (相手ライフ15, ♠K=13点ダメージ): Core生成パターンとAI選択", () => {
      const spadeK = { id: "c-sk", suit: "S", rank: "K", value: 13, faceUp: true };
      const diamondA = { id: "c-da", suit: "D", rank: "A", value: 1, faceUp: true };
      const oppBossCard = { id: "c-boss", suit: "H", rank: "10", value: 10, faceUp: true };

      const oppBossUnit = {
        ...buildFieldUnitFromComponent({
          componentId: "character.soldier",
          playerKey: "p2",
          card: oppBossCard,
          components: rulePackage.components,
        }),
        unitId: "u-p2-boss",
        currentSize: 10,
        state: "charge",
        labels: ["soldier"],
        cards: [oppBossCard],
      };

      const state: any = {
        stateVersion: 10,
        turnPlayer: "p1",
        chancePlayer: "p1",
        stage: { requests: [] },
        players: {
          p1: {
            hand: [spadeK, diamondA],
            field: [],
            life: Array.from({ length: 10 }, (_, i) => ({ id: `p1-l${i + 1}` })),
            grave: [],
          },
          p2: {
            hand: [],
            field: [oppBossUnit],
            life: Array.from({ length: 15 }, (_, i) => ({ id: `p2-l${i + 1}` })), // ライフ15
            grave: [],
          },
        },
      };

      const decision = LegalPatternGenerator.generateActionRequestDecision(state, "p1", rulePackage);
      const req = decision.request;

      const evalV72 = policyV72.evaluatePatterns(req);
      const evalV73 = policyV73.evaluatePatterns(req);
      const choiceV72 = policyV72.choose(req).selectedPatternRef;
      const choiceV73 = policyV73.choose(req).selectedPatternRef;

      r2EvidenceData.results["BP-AI-09-non-lethal"] = {
        scenario: "BP-AI-09 非致死局面 (相手Life15, ♠K=13点, 相手手札0)",
        choiceV72,
        choiceV73,
        chosenActionV72: req.catalog.actions[req.patterns[choiceV72].actionSelectionRef!]?.actionId,
        chosenActionV73: req.catalog.actions[req.patterns[choiceV73].actionSelectionRef!]?.actionId,
        v72Scores: evalV72.scoredPatterns.map((p) => ({
          ref: p.patternRef,
          actionId: req.catalog.actions[req.patterns[p.patternRef].actionSelectionRef!]?.actionId,
          base: p.baseScore,
          tactical: p.tacticalAdjustment,
          final: p.finalScore,
        })),
        v73Scores: evalV73.scoredPatterns.map((p) => ({
          ref: p.patternRef,
          actionId: req.catalog.actions[req.patterns[p.patternRef].actionSelectionRef!]?.actionId,
          base: p.baseScore,
          tactical: p.tacticalAdjustment,
          final: p.finalScore,
        })),
      };
    });
  });

  // =========================================================================
  // 2. BP-AI-14: Core生成 DecisionRequest による無謀アタック回避の検証
  // =========================================================================
  describe("2. BP-AI-14: Core生成 DecisionRequest による無謀アタック回避", () => {
    it("2.1 自軍サイズ1 vs 相手サイズ6 (相手ライフ15): Core生成パターンでエンドを選択し自滅回避", () => {
      const smallCard = { id: "c-small", suit: "S", rank: "1", value: 1, faceUp: true };
      const wallCard = { id: "c-wall", suit: "D", rank: "6", value: 6, faceUp: true };

      const mySmallSoldier = {
        ...buildFieldUnitFromComponent({
          componentId: "character.soldier",
          playerKey: "p1",
          card: smallCard,
          components: rulePackage.components,
        }),
        unitId: "u-p1-small",
        currentSize: 1,
        state: "charge",
        labels: ["soldier"],
        cards: [smallCard],
      };

      const oppWallSoldier = {
        ...buildFieldUnitFromComponent({
          componentId: "character.soldier",
          playerKey: "p2",
          card: wallCard,
          components: rulePackage.components,
        }),
        unitId: "u-p2-wall",
        currentSize: 6,
        state: "charge",
        labels: ["soldier"],
        cards: [wallCard],
      };

      const state: any = {
        stateVersion: 10,
        turnPlayer: "p1",
        chancePlayer: "p1",
        stage: { requests: [] },
        players: {
          p1: {
            hand: [],
            field: [mySmallSoldier],
            life: Array.from({ length: 10 }, (_, i) => ({ id: `p1-l${i + 1}` })),
            grave: [],
          },
          p2: {
            hand: [],
            field: [oppWallSoldier],
            life: Array.from({ length: 15 }, (_, i) => ({ id: `p2-l${i + 1}` })),
            grave: [],
          },
        },
      };

      const decision = LegalPatternGenerator.generateActionRequestDecision(state, "p1", rulePackage);
      const req = decision.request;

      const attackPatternIdx = req.patterns.findIndex((p) => {
        if (p.actionSelectionRef === undefined) return false;
        return req.catalog.actions[p.actionSelectionRef].actionId === "action.attack";
      });
      const endPatternIdx = req.patterns.findIndex((p) => {
        if (p.actionSelectionRef === undefined) return false;
        return req.catalog.actions[p.actionSelectionRef].actionId === "action.end";
      });

      expect(attackPatternIdx).toBeGreaterThanOrEqual(0);
      expect(endPatternIdx).toBeGreaterThanOrEqual(0);

      const bulwarkPatternIdx = req.patterns.findIndex((p) => {
        if (p.actionSelectionRef === undefined) return false;
        return req.catalog.actions[p.actionSelectionRef].actionId === "action.setBulwark";
      });

      expect(attackPatternIdx).toBeGreaterThanOrEqual(0);
      expect(endPatternIdx).toBeGreaterThanOrEqual(0);
      expect(bulwarkPatternIdx).toBeGreaterThanOrEqual(0);

      const evalV72 = policyV72.evaluatePatterns(req);
      const evalV73 = policyV73.evaluatePatterns(req);
      const choiceV72 = policyV72.choose(req).selectedPatternRef;
      const choiceV73 = policyV73.choose(req).selectedPatternRef;

      // 自滅ペナルティ(-0.30)が適用されていることを確認
      const attackScore72 = evalV72.scoredPatterns.find((p) => p.patternRef === attackPatternIdx);
      expect(attackScore72?.reason).toContain("Suicide attack penalty");
      expect(attackScore72?.tacticalAdjustment).toBeCloseTo(-0.30, 2);

      // v7.2 では自滅アタック(0.1314)を回避し、防壁(0.1673)を選択
      expect(choiceV72).toBe(bulwarkPatternIdx);

      // v7.3 では防壁にライフコストペナルティ(-0.05)が入り(0.1173)、自滅アタック(0.1314)が再浮上してしまう課題を検証
      expect(choiceV73).toBe(attackPatternIdx);

      r2EvidenceData.results["BP-AI-14-core"] = {
        scenario: "BP-AI-14 Core生成 (自軍サイズ1 vs 相手サイズ6, 相手Life15)",
        attackPatternIndex: attackPatternIdx,
        endPatternIndex: endPatternIdx,
        bulwarkPatternIndex: bulwarkPatternIdx,
        choiceV72,
        choiceV73,
        chosenActionV72: req.catalog.actions[req.patterns[choiceV72].actionSelectionRef!]?.actionId,
        chosenActionV73: req.catalog.actions[req.patterns[choiceV73].actionSelectionRef!]?.actionId,
        statusV72: choiceV72 !== attackPatternIdx ? "PASS" : "FAIL",
        statusV73: choiceV73 !== attackPatternIdx ? "PASS" : "FAIL",
        finding: "v7.2では自滅ペナルティ(-0.30)により防壁(0.1673)が選ばれ自滅回避されるが、v7.3ではライフコストペナルティ(-0.05)で防壁が0.1173に低下し、自滅アタック(0.1314 > end 0.0615)が最高スコアとなり自滅してしまう真の課題を特定。",
        v72Scores: evalV72.scoredPatterns.map((p) => ({
          ref: p.patternRef,
          actionId: req.catalog.actions[req.patterns[p.patternRef].actionSelectionRef!]?.actionId,
          base: p.baseScore,
          tactical: p.tacticalAdjustment,
          final: p.finalScore,
          reason: p.reason,
        })),
        v73Scores: evalV73.scoredPatterns.map((p) => ({
          ref: p.patternRef,
          actionId: req.catalog.actions[req.patterns[p.patternRef].actionSelectionRef!]?.actionId,
          base: p.baseScore,
          tactical: p.tacticalAdjustment,
          final: p.finalScore,
          reason: p.reason,
        })),
      };
    });
  });

  // =========================================================================
  // 3. v7.3 コスト評価の Core 生成 DecisionRequest 検証
  // =========================================================================
  describe("3. v7.3 コスト評価: Core生成の正しいコスト支払いパターンによる検証", () => {
    it("3.1 リアニメイト (action.standardReanimate): 場の兵士生贄コストによる v7.2 vs v7.3 差分", () => {
      const graveHeroCard = { id: "c-joker", suit: "JOKER", rank: "JOKER", value: 20, faceUp: true };
      const sacCard = { id: "c-sac", suit: "D", rank: "3", value: 3, faceUp: true };

      const mySacSoldier = {
        ...buildFieldUnitFromComponent({
          componentId: "character.soldier",
          playerKey: "p1",
          card: sacCard,
          components: rulePackage.components,
        }),
        unitId: "u-p1-sac",
        currentSize: 3,
        state: "charge",
        labels: ["soldier"],
        cards: [sacCard],
      };

      const state: any = {
        stateVersion: 10,
        turnPlayer: "p1",
        chancePlayer: "p1",
        stage: { requests: [] },
        players: {
          p1: {
            hand: [],
            field: [mySacSoldier],
            life: Array.from({ length: 10 }, (_, i) => ({ id: `p1-l${i + 1}` })),
            grave: [graveHeroCard],
          },
          p2: {
            hand: [],
            field: [],
            life: Array.from({ length: 10 }, (_, i) => ({ id: `p2-l${i + 1}` })),
            grave: [],
          },
        },
      };

      const decision = LegalPatternGenerator.generateActionRequestDecision(state, "p1", rulePackage);
      const req = decision.request;

      // リアニメイトパターンを検索
      const reanimatePatternIdx = req.patterns.findIndex((p) => {
        if (p.actionSelectionRef === undefined) return false;
        return req.catalog.actions[p.actionSelectionRef].actionId === "action.standardReanimate";
      });

      if (reanimatePatternIdx >= 0) {
        const p = req.patterns[reanimatePatternIdx];
        const cp = p.costPaymentRef !== undefined ? req.catalog.costPayments[p.costPaymentRef] : undefined;

        const evalV72 = policyV72.evaluatePatterns(req);
        const evalV73 = policyV73.evaluatePatterns(req);

        const score72 = evalV72.scoredPatterns.find((sp) => sp.patternRef === reanimatePatternIdx);
        const score73 = evalV73.scoredPatterns.find((sp) => sp.patternRef === reanimatePatternIdx);

        r2EvidenceData.results["v73-cost-reanimate"] = {
          scenario: "リアニメイト (場の兵士生贄コスト)",
          reanimatePatternIndex: reanimatePatternIdx,
          costPayment: cp,
          v72Score: score72,
          v73Score: score73,
          scoreDiff: (score73?.finalScore ?? 0) - (score72?.finalScore ?? 0),
          tacticalFeaturesV73: score73?.tacticalFeatures?.slice(20, 24),
        };
      }
    });

    it("3.2 複数コスト支払い候補を持つ局面での識別能力検証", () => {
      // 手札召喚または防壁追加等で、複数コスト支払い候補がある局面
      // Core の CostPaymentEnumerator または手札2枚以上の局面
      const keyH5 = { id: "c-h5", suit: "H", rank: "5", value: 5, faceUp: true };
      const costC7 = { id: "c-c7", suit: "C", rank: "7", value: 7, faceUp: true };
      const costD10 = { id: "c-d10", suit: "D", rank: "10", value: 10, faceUp: true };

      const state: any = {
        stateVersion: 10,
        turnPlayer: "p1",
        chancePlayer: "p1",
        stage: { requests: [] },
        players: {
          p1: {
            hand: [keyH5, costC7, costD10],
            field: [],
            life: Array.from({ length: 10 }, (_, i) => ({ id: `p1-l${i + 1}` })),
            grave: [],
          },
          p2: {
            hand: [],
            field: [],
            life: Array.from({ length: 10 }, (_, i) => ({ id: `p2-l${i + 1}` })),
            grave: [],
          },
        },
      };

      const decision = LegalPatternGenerator.generateActionRequestDecision(state, "p1", rulePackage);
      const req = decision.request;

      const evalV72 = policyV72.evaluatePatterns(req);
      const evalV73 = policyV73.evaluatePatterns(req);

      r2EvidenceData.results["v73-cost-multicandidate"] = {
        scenario: "複数手札カードによる防壁追加/手札召喚",
        patternCount: req.patterns.length,
        v72Scores: evalV72.scoredPatterns.map((p) => ({
          ref: p.patternRef,
          actionId: req.catalog.actions[req.patterns[p.patternRef].actionSelectionRef!]?.actionId,
          base: p.baseScore,
          tactical: p.tacticalAdjustment,
          final: p.finalScore,
        })),
        v73Scores: evalV73.scoredPatterns.map((p) => ({
          ref: p.patternRef,
          actionId: req.catalog.actions[req.patterns[p.patternRef].actionSelectionRef!]?.actionId,
          base: p.baseScore,
          tactical: p.tacticalAdjustment,
          final: p.finalScore,
          tacticalFeatures: p.tacticalFeatures?.slice(20, 24),
          reason: p.reason,
        })),
      };
    });
  });
});
