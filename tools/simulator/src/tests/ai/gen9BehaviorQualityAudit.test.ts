/**
 * gen9BehaviorQualityAudit.test.ts
 *
 * BlackPoker Simulator - Gen 9 スタンダード＋パックAI 行動品質診断 (Work 5-7A)
 *
 * 【診断対象】
 * - Gen 9 R4 v7.2 (gen9-r4-v72): 20次元戦術特徴量仕様
 * - Gen 9 v7.3 (gen9-cost-preview-v73): 24次元戦術・コスト特徴量仕様 (固定診断重み)
 *
 * 【シナリオ構成 (全21シナリオ)】
 * A. 防御・ブロック: BP-AI-01〜05
 * B. Counter・回避: BP-AI-06〜08
 * C. 攻撃魔法: BP-AI-09〜11
 * D. 召喚・攻撃: BP-AI-12〜15
 * E. リソース管理・パック: BP-AI-16〜21
 */

import * as fs from "fs";
import * as path from "path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { RulePackage } from "../../domain/rules/RulePackage";
import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader";
import { PlaytestPolicyFactory } from "../../engine/playtest/PlaytestPolicyFactory";
import { Gen9TacticalPrototypePolicy } from "../../engine/ai/Gen9TacticalPrototypePolicy";
import { Gen9LearnableTacticalPolicy } from "../../engine/ai/Gen9LearnableTacticalPolicy";
import { DecisionRequest } from "../../domain/decision/DecisionRequest";
import { RequestView } from "../../domain/decision/PlayerObservation";

export type AuditScenarioStatus = "PASS" | "FAIL" | "AMBIGUOUS" | "BLOCKED" | "NOT_RUN";

export interface ScenarioAuditResult {
  readonly scenarioId: string;
  readonly name: string;
  readonly priority: "P0" | "P1" | "P2";
  readonly v72Status: AuditScenarioStatus;
  readonly v73Status: AuditScenarioStatus;
  readonly v72ChosenRef: number;
  readonly v73ChosenRef: number;
  readonly expectedPatternRef: number | readonly number[];
  readonly v72Scores: readonly { ref: number; base: number; tactical: number; final: number; reason?: string }[];
  readonly v73Scores: readonly { ref: number; base: number; tactical: number; final: number; reason?: string }[];
  readonly rootCauseCategory?: "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "UNKNOWN";
  readonly notes: string;
}

export const scenarioAuditResults: ScenarioAuditResult[] = [];

describe("Gen 9 スタンダード＋パックAI 行動品質診断 (Work 5-7A)", () => {
  let rulePackage: RulePackage;
  let policyV72: Gen9TacticalPrototypePolicy;
  let policyV73: Gen9LearnableTacticalPolicy;

  beforeAll(() => {
    rulePackage = loadRulePackageForBrowser();
    policyV72 = PlaytestPolicyFactory.createPolicy(
      "gen9-r4-v72",
      undefined,
      "p2",
      "standard-pack",
      rulePackage
    ) as Gen9TacticalPrototypePolicy;

    policyV73 = PlaytestPolicyFactory.createPolicy(
      "gen9-cost-preview-v73",
      undefined,
      "p2",
      "standard-pack",
      rulePackage
    ) as Gen9LearnableTacticalPolicy;
  });

  function createAuditRequest(data: any): DecisionRequest {
    return data as any as DecisionRequest;
  }

  afterAll(() => {
    // 診断結果を JSON ファイルとして保存（Evidence用）
    const evidenceDir = path.resolve(__dirname, "../../../evidence");
    if (!fs.existsSync(evidenceDir)) {
      fs.mkdirSync(evidenceDir, { recursive: true });
    }
    const outputPath = path.join(evidenceDir, "gen9_behavior_quality_audit_work57a.json");
    fs.writeFileSync(
      outputPath,
      JSON.stringify(
        {
          workId: "BP-SIM-AI-GEN9-WORK57A-BEHAVIOR-QUALITY-AUDIT",
          timestamp: new Date().toISOString(),
          totalScenarios: scenarioAuditResults.length,
          results: scenarioAuditResults,
        },
        null,
        2
      ),
      "utf-8"
    );
  });

  // ===========================================================================
  // カテゴリ A: 防御・ブロック (BP-AI-01 〜 BP-AI-05)
  // ===========================================================================
  describe("カテゴリ A: 防御・ブロック", () => {
    it("BP-AI-01: 致死攻撃への防御 (P0)", () => {
      const blockRequest = createAuditRequest({
        protocolVersion: "1.0.0",
        matchId: "audit-match-01",
        decisionId: "dec-bp-ai-01",
        stateVersion: 10,
        playerId: "p2",
        source: { type: "ACTION_REQUEST", playerId: "p2" },
        catalog: {
          actions: [{ actionId: "action.block", actionName: "ブロック" }],
          unitSelections: [{ unitIds: ["u-p2-charge"], count: 1 }],
          targetSelections: [{ targetType: "unit", targetUnitIds: ["u-p1-atk"] }],
          effectSelections: [
            {
              selectionId: "eff-block",
              candidateCount: 1,
              assignments: [{ attackerUnitId: "u-p1-atk", blockerUnitIds: ["u-p2-charge"] }],
            },
          ],
          cardSelections: [],
          costPayments: [],
          orderSelections: [],
        },
        observation: {
          viewerPlayerId: "p2",
          turnPlayerId: "p1",
          chancePlayerId: "p2",
          players: [
            {
              playerId: "p1",
              handCount: 3,
              lifeCount: 10,
              bulwarks: [],
              field: [{ unitId: "u-p1-atk", size: 3, state: "battle", battle: { role: "attacker" }, labels: ["soldier"] }],
            },
            {
              playerId: "p2",
              handCount: 3,
              lifeCount: 2, // 致死域 (2 <= 3)
              bulwarks: [],
              field: [{ unitId: "u-p2-charge", size: 3, state: "charge", labels: ["soldier"] }],
            },
          ],
        },
        patterns: [
          { patternRef: 0, patternId: "pat-block-soldier", kind: "ACTION", actionSelectionRef: 0, effectSelectionRef: 0 },
          { patternRef: 1, patternId: "pat-pass", kind: "PASS" },
        ],
      });

      const evalV72 = policyV72.evaluatePatterns(blockRequest);
      const evalV73 = policyV73.evaluatePatterns(blockRequest);
      const chosenV72 = policyV72.choose(blockRequest).selectedPatternRef;
      const chosenV73 = policyV73.choose(blockRequest).selectedPatternRef;

      // ストリーミングブロック経路
      const streamReq = createAuditRequest({
        ...blockRequest,
        patterns: [],
        blockAssignmentStream: {
          patternCount: 2,
          candidateCount: 1,
          iterateAssignments: function* () {
            yield [{ attackerUnitId: "u-p1-atk", blockerUnitIds: ["u-p2-charge"] }];
            yield [];
          },
          instantiatePatternAt: (ref: number) => ({
            pattern: ref === 0
              ? { patternRef: 0, patternId: "pat-block-soldier", kind: "ACTION", actionSelectionRef: 0, effectSelectionRef: 0 }
              : { patternRef: 1, patternId: "pat-pass", kind: "PASS" },
            rawCost: undefined,
          }),
          getAssignmentAt: (ref: number) => (ref === 0 ? [{ attackerUnitId: "u-p1-atk", blockerUnitIds: ["u-p2-charge"] }] : []),
        },
        blockAssignmentStreamMeta: {
          attackerUnitIds: ["u-p1-atk"],
          candidateBlockerUnitIds: ["u-p2-charge"],
        },
      });

      const streamChosenV72 = policyV72.choose(streamReq).selectedPatternRef;
      const streamChosenV73 = policyV73.choose(streamReq).selectedPatternRef;

      const isPassV72 = chosenV72 === 0 && streamChosenV72 === 0;
      const isPassV73 = chosenV73 === 0 && streamChosenV73 === 0;

      scenarioAuditResults.push({
        scenarioId: "BP-AI-01",
        name: "致死攻撃への防御",
        priority: "P0",
        v72Status: isPassV72 ? "PASS" : "FAIL",
        v73Status: isPassV73 ? "PASS" : "FAIL",
        v72ChosenRef: chosenV72,
        v73ChosenRef: chosenV73,
        expectedPatternRef: 0,
        v72Scores: evalV72.scoredPatterns.map((p) => ({ ref: p.patternRef, base: p.baseScore, tactical: p.tacticalAdjustment, final: p.finalScore, reason: p.reason })),
        v73Scores: evalV73.scoredPatterns.map((p) => ({ ref: p.patternRef, base: p.baseScore, tactical: p.tacticalAdjustment, final: p.finalScore, reason: p.reason })),
        notes: "致死ダメージ回避ブロック。通常列挙・ストリーミング共にブロックを選択。",
      });
      expect(isPassV72).toBe(true);
      expect(isPassV73).toBe(true);
    });

    it("BP-AI-02: 防壁による有利な相打ち (P1)", () => {
      const req = createAuditRequest({
        protocolVersion: "1.0.0",
        matchId: "audit-match-02",
        decisionId: "dec-bp-ai-02",
        stateVersion: 10,
        playerId: "p2",
        source: { type: "ACTION_REQUEST", playerId: "p2" },
        catalog: {
          actions: [{ actionId: "action.block", actionName: "ブロック" }],
          unitSelections: [],
          targetSelections: [{ targetType: "unit", targetUnitIds: ["u-p1-atk"] }],
          effectSelections: [
            {
              selectionId: "eff-block",
              candidateCount: 1,
              assignments: [{ attackerUnitId: "u-p1-atk", blockerUnitIds: ["bulwark-p2-0"] }],
            },
          ],
          cardSelections: [],
          costPayments: [],
          orderSelections: [],
        },
        observation: {
          viewerPlayerId: "p2",
          turnPlayerId: "p1",
          chancePlayerId: "p2",
          players: [
            {
              playerId: "p1",
              handCount: 3,
              lifeCount: 10,
              bulwarks: [],
              field: [{ unitId: "u-p1-atk", size: 3, state: "battle", battle: { role: "attacker" }, labels: ["soldier"] }],
            },
            {
              playerId: "p2",
              handCount: 3,
              lifeCount: 10,
              bulwarks: [{ unitId: "bulwark-p2-0", labels: ["bulwark"] }],
              field: [],
            },
          ],
        },
        patterns: [
          { patternRef: 0, patternId: "pat-block-bulwark", kind: "ACTION", actionSelectionRef: 0, effectSelectionRef: 0 },
          { patternRef: 1, patternId: "pat-pass", kind: "PASS" },
        ],
      });

      const evalV72 = policyV72.evaluatePatterns(req);
      const evalV73 = policyV73.evaluatePatterns(req);
      const chosenV72 = policyV72.choose(req).selectedPatternRef;
      const chosenV73 = policyV73.choose(req).selectedPatternRef;

      scenarioAuditResults.push({
        scenarioId: "BP-AI-02",
        name: "防壁による有利な相打ち",
        priority: "P1",
        v72Status: chosenV72 === 0 ? "PASS" : "FAIL",
        v73Status: chosenV73 === 0 ? "PASS" : "FAIL",
        v72ChosenRef: chosenV72,
        v73ChosenRef: chosenV73,
        expectedPatternRef: 0,
        v72Scores: evalV72.scoredPatterns.map((p) => ({ ref: p.patternRef, base: p.baseScore, tactical: p.tacticalAdjustment, final: p.finalScore, reason: p.reason })),
        v73Scores: evalV73.scoredPatterns.map((p) => ({ ref: p.patternRef, base: p.baseScore, tactical: p.tacticalAdjustment, final: p.finalScore, reason: p.reason })),
        notes: `防壁ブロック選択: v7.2=${chosenV72}, v7.3=${chosenV73}`,
      });
    });

    it("BP-AI-03: 大きい兵士によるブロック (P1)", () => {
      const req = createAuditRequest({
        protocolVersion: "1.0.0",
        matchId: "audit-match-03",
        decisionId: "dec-bp-ai-03",
        stateVersion: 10,
        playerId: "p2",
        source: { type: "ACTION_REQUEST", playerId: "p2" },
        catalog: {
          actions: [{ actionId: "action.block", actionName: "ブロック" }],
          unitSelections: [],
          targetSelections: [{ targetType: "unit", targetUnitIds: ["u-p1-atk"] }],
          effectSelections: [
            {
              selectionId: "eff-block-big",
              candidateCount: 2,
              assignments: [{ attackerUnitId: "u-p1-atk", blockerUnitIds: ["u-big"] }],
            },
            {
              selectionId: "eff-block-small",
              candidateCount: 2,
              assignments: [{ attackerUnitId: "u-p1-atk", blockerUnitIds: ["u-small"] }],
            },
          ],
          cardSelections: [],
          costPayments: [],
          orderSelections: [],
        },
        observation: {
          viewerPlayerId: "p2",
          turnPlayerId: "p1",
          chancePlayerId: "p2",
          players: [
            {
              playerId: "p1",
              handCount: 3,
              lifeCount: 10,
              bulwarks: [],
              field: [{ unitId: "u-p1-atk", size: 2, state: "battle", battle: { role: "attacker" }, labels: ["soldier"] }],
            },
            {
              playerId: "p2",
              handCount: 3,
              lifeCount: 10,
              bulwarks: [],
              field: [
                { unitId: "u-big", size: 4, state: "charge", labels: ["soldier"] },
                { unitId: "u-small", size: 1, state: "charge", labels: ["soldier"] },
              ],
            },
          ],
        },
        patterns: [
          { patternRef: 0, patternId: "pat-block-big", kind: "ACTION", actionSelectionRef: 0, effectSelectionRef: 0 },
          { patternRef: 1, patternId: "pat-block-small", kind: "ACTION", actionSelectionRef: 0, effectSelectionRef: 1 },
          { patternRef: 2, patternId: "pat-pass", kind: "PASS" },
        ],
      });

      const evalV72 = policyV72.evaluatePatterns(req);
      const evalV73 = policyV73.evaluatePatterns(req);
      const chosenV72 = policyV72.choose(req).selectedPatternRef;
      const chosenV73 = policyV73.choose(req).selectedPatternRef;

      scenarioAuditResults.push({
        scenarioId: "BP-AI-03",
        name: "大きい兵士によるブロック",
        priority: "P1",
        v72Status: chosenV72 === 0 ? "PASS" : "FAIL",
        v73Status: chosenV73 === 0 ? "PASS" : "FAIL",
        v72ChosenRef: chosenV72,
        v73ChosenRef: chosenV73,
        expectedPatternRef: 0,
        v72Scores: evalV72.scoredPatterns.map((p) => ({ ref: p.patternRef, base: p.baseScore, tactical: p.tacticalAdjustment, final: p.finalScore, reason: p.reason })),
        v73Scores: evalV73.scoredPatterns.map((p) => ({ ref: p.patternRef, base: p.baseScore, tactical: p.tacticalAdjustment, final: p.finalScore, reason: p.reason })),
        notes: `大型兵士ブロック選択: v7.2=${chosenV72}, v7.3=${chosenV73}`,
      });
    });

    it("BP-AI-04: 複数兵士によるブロック (P1)", () => {
      const req = createAuditRequest({
        protocolVersion: "1.0.0",
        matchId: "audit-match-04",
        decisionId: "dec-bp-ai-04",
        stateVersion: 10,
        playerId: "p2",
        source: { type: "ACTION_REQUEST", playerId: "p2" },
        catalog: {
          actions: [{ actionId: "action.block", actionName: "ブロック" }],
          unitSelections: [],
          targetSelections: [{ targetType: "unit", targetUnitIds: ["u-p1-atk"] }],
          effectSelections: [
            {
              selectionId: "eff-block-multi",
              candidateCount: 2,
              assignments: [{ attackerUnitId: "u-p1-atk", blockerUnitIds: ["u1", "u2"] }],
            },
            {
              selectionId: "eff-block-single-u1",
              candidateCount: 2,
              assignments: [{ attackerUnitId: "u-p1-atk", blockerUnitIds: ["u1"] }],
            },
          ],
          cardSelections: [],
          costPayments: [],
          orderSelections: [],
        },
        observation: {
          viewerPlayerId: "p2",
          turnPlayerId: "p1",
          chancePlayerId: "p2",
          players: [
            {
              playerId: "p1",
              handCount: 3,
              lifeCount: 10,
              bulwarks: [],
              field: [{ unitId: "u-p1-atk", size: 5, state: "battle", battle: { role: "attacker" }, labels: ["soldier"] }],
            },
            {
              playerId: "p2",
              handCount: 3,
              lifeCount: 10,
              bulwarks: [],
              field: [
                { unitId: "u1", size: 3, state: "charge", labels: ["soldier"] },
                { unitId: "u2", size: 3, state: "charge", labels: ["soldier"] },
              ],
            },
          ],
        },
        patterns: [
          { patternRef: 0, patternId: "pat-block-multi", kind: "ACTION", actionSelectionRef: 0, effectSelectionRef: 0 },
          { patternRef: 1, patternId: "pat-block-single", kind: "ACTION", actionSelectionRef: 0, effectSelectionRef: 1 },
          { patternRef: 2, patternId: "pat-pass", kind: "PASS" },
        ],
      });

      const evalV72 = policyV72.evaluatePatterns(req);
      const evalV73 = policyV73.evaluatePatterns(req);
      const chosenV72 = policyV72.choose(req).selectedPatternRef;
      const chosenV73 = policyV73.choose(req).selectedPatternRef;

      scenarioAuditResults.push({
        scenarioId: "BP-AI-04",
        name: "複数兵士によるブロック",
        priority: "P1",
        v72Status: chosenV72 === 0 ? "PASS" : "FAIL",
        v73Status: chosenV73 === 0 ? "PASS" : "FAIL",
        v72ChosenRef: chosenV72,
        v73ChosenRef: chosenV73,
        expectedPatternRef: 0,
        v72Scores: evalV72.scoredPatterns.map((p) => ({ ref: p.patternRef, base: p.baseScore, tactical: p.tacticalAdjustment, final: p.finalScore, reason: p.reason })),
        v73Scores: evalV73.scoredPatterns.map((p) => ({ ref: p.patternRef, base: p.baseScore, tactical: p.tacticalAdjustment, final: p.finalScore, reason: p.reason })),
        notes: `複数兵士合算ブロック選択: v7.2=${chosenV72}, v7.3=${chosenV73}`,
      });
    });

    it("BP-AI-05: 不要なブロックを避ける (P1)", () => {
      const req = createAuditRequest({
        protocolVersion: "1.0.0",
        matchId: "audit-match-05",
        decisionId: "dec-bp-ai-05",
        stateVersion: 10,
        playerId: "p2",
        source: { type: "ACTION_REQUEST", playerId: "p2" },
        catalog: {
          actions: [{ actionId: "action.block", actionName: "ブロック" }],
          unitSelections: [],
          targetSelections: [{ targetType: "unit", targetUnitIds: ["u-p1-atk"] }],
          effectSelections: [
            {
              selectionId: "eff-block-suicide",
              candidateCount: 1,
              assignments: [{ attackerUnitId: "u-p1-atk", blockerUnitIds: ["u-precious"] }],
            },
          ],
          cardSelections: [],
          costPayments: [],
          orderSelections: [],
        },
        observation: {
          viewerPlayerId: "p2",
          turnPlayerId: "p1",
          chancePlayerId: "p2",
          players: [
            {
              playerId: "p1",
              handCount: 3,
              lifeCount: 10,
              bulwarks: [],
              field: [{ unitId: "u-p1-atk", size: 1, state: "battle", battle: { role: "attacker" }, labels: ["soldier"] }],
            },
            {
              playerId: "p2",
              handCount: 3,
              lifeCount: 15,
              bulwarks: [],
              field: [{ unitId: "u-precious", size: 1, state: "charge", labels: ["soldier"] }],
            },
          ],
        },
        patterns: [
          { patternRef: 0, patternId: "pat-block-suicide", kind: "ACTION", actionSelectionRef: 0, effectSelectionRef: 0 },
          { patternRef: 1, patternId: "pat-pass", kind: "PASS" },
        ],
      });

      const evalV72 = policyV72.evaluatePatterns(req);
      const evalV73 = policyV73.evaluatePatterns(req);
      const chosenV72 = policyV72.choose(req).selectedPatternRef;
      const chosenV73 = policyV73.choose(req).selectedPatternRef;

      scenarioAuditResults.push({
        scenarioId: "BP-AI-05",
        name: "不要なブロックを避ける",
        priority: "P1",
        v72Status: chosenV72 === 1 ? "PASS" : "AMBIGUOUS",
        v73Status: chosenV73 === 1 ? "PASS" : "AMBIGUOUS",
        v72ChosenRef: chosenV72,
        v73ChosenRef: chosenV73,
        expectedPatternRef: 1,
        v72Scores: evalV72.scoredPatterns.map((p) => ({ ref: p.patternRef, base: p.baseScore, tactical: p.tacticalAdjustment, final: p.finalScore, reason: p.reason })),
        v73Scores: evalV73.scoredPatterns.map((p) => ({ ref: p.patternRef, base: p.baseScore, tactical: p.tacticalAdjustment, final: p.finalScore, reason: p.reason })),
        notes: `ブロック回避/スルー選択: v7.2=${chosenV72}, v7.3=${chosenV73}`,
      });
    });
  });

  // ===========================================================================
  // カテゴリ B: Counter・回避 (BP-AI-06 〜 BP-AI-08)
  // ===========================================================================
  describe("カテゴリ B: Counter・回避", () => {
    it("BP-AI-06: 投擲へのCounter (P0)", () => {
      // 相手p1が投擲(action.throwing)を発動中。自軍p2ライフ2(被弾で致死)。手札にCounter(action.counterattack)あり。
      const throwingStageReq: RequestView = {
        requestId: "req-stage-throwing",
        actionId: "action.throwing",
        controller: "p1",
        actorPlayerId: "p1",
        targetPlayerId: "p2",
        chosenKeys: { key: { suit: "S", rank: "K", value: 10 } },
        resolvedCosts: { life: 0 },
      } as any;

      const req = createAuditRequest({
        protocolVersion: "1.0.0",
        matchId: "audit-match-06",
        decisionId: "dec-bp-ai-06",
        stateVersion: 5,
        playerId: "p2",
        source: { type: "ACTION_REQUEST", playerId: "p2" },
        catalog: {
          actions: [{ actionId: "action.counterattack", actionName: "カウンターアタック" }],
          cardSelections: [{ cardIds: ["card-p2-counter"], displayCodes: ["SK"] }],
          unitSelections: [],
          targetSelections: [{ targetType: "request", targetRequestId: "req-stage-throwing" }],
          effectSelections: [],
          costPayments: [],
          orderSelections: [],
        },
        observation: {
          viewerPlayerId: "p2",
          turnPlayerId: "p1",
          chancePlayerId: "p2",
          stageRequests: [throwingStageReq],
          players: [
            { playerId: "p1", handCount: 2, lifeCount: 10, bulwarks: [], field: [] },
            {
              playerId: "p2",
              handCount: 2,
              lifeCount: 2, // 投擲で即死
              bulwarks: [],
              field: [],
              hand: [{ id: "card-p2-counter", suit: "S", rank: "K", value: 10 }],
            },
          ],
        },
        patterns: [
          { patternRef: 0, patternId: "pat-counter", kind: "ACTION", actionSelectionRef: 0, cardSelectionRef: 0 },
          { patternRef: 1, patternId: "pat-pass", kind: "PASS" },
        ],
      });

      const evalV72 = policyV72.evaluatePatterns(req);
      const evalV73 = policyV73.evaluatePatterns(req);
      const chosenV72 = policyV72.choose(req).selectedPatternRef;
      const chosenV73 = policyV73.choose(req).selectedPatternRef;

      scenarioAuditResults.push({
        scenarioId: "BP-AI-06",
        name: "投擲へのCounter",
        priority: "P0",
        v72Status: chosenV72 === 0 ? "PASS" : "FAIL",
        v73Status: chosenV73 === 0 ? "PASS" : "FAIL",
        v72ChosenRef: chosenV72,
        v73ChosenRef: chosenV73,
        expectedPatternRef: 0,
        v72Scores: evalV72.scoredPatterns.map((p) => ({ ref: p.patternRef, base: p.baseScore, tactical: p.tacticalAdjustment, final: p.finalScore, reason: p.reason })),
        v73Scores: evalV73.scoredPatterns.map((p) => ({ ref: p.patternRef, base: p.baseScore, tactical: p.tacticalAdjustment, final: p.finalScore, reason: p.reason })),
        notes: `投擲Counter選択: v7.2=${chosenV72}, v7.3=${chosenV73}`,
      });
      expect(chosenV72).toBe(0);
      expect(chosenV73).toBe(0);
    });

    it("BP-AI-07: 死の槍へのCounter (P0)", () => {
      // 相手p1が死の槍(action.deathLance)を発動中。自軍主力兵士(サイズ10)が対象。手札にCounterあり。
      const dlStageReq: RequestView = {
        requestId: "req-stage-dl",
        actionId: "action.deathLance",
        controller: "p1",
        actorPlayerId: "p1",
        targetUnitId: "u-p2-boss",
        chosenKeys: { key: { suit: "D", rank: "A", value: 1 } },
        resolvedCosts: { life: 0 },
      } as any;

      const req = createAuditRequest({
        protocolVersion: "1.0.0",
        matchId: "audit-match-07",
        decisionId: "dec-bp-ai-07",
        stateVersion: 6,
        playerId: "p2",
        source: { type: "ACTION_REQUEST", playerId: "p2" },
        catalog: {
          actions: [{ actionId: "action.counterattack", actionName: "カウンターアタック" }],
          cardSelections: [{ cardIds: ["card-p2-counter-dl"], displayCodes: ["DA"] }],
          unitSelections: [],
          targetSelections: [{ targetType: "request", targetRequestId: "req-stage-dl" }],
          effectSelections: [],
          costPayments: [],
          orderSelections: [],
        },
        observation: {
          viewerPlayerId: "p2",
          turnPlayerId: "p1",
          chancePlayerId: "p2",
          stageRequests: [dlStageReq],
          players: [
            { playerId: "p1", handCount: 3, lifeCount: 10, bulwarks: [], field: [] },
            {
              playerId: "p2",
              handCount: 2,
              lifeCount: 10,
              bulwarks: [],
              field: [{ unitId: "u-p2-boss", size: 10, state: "charge", labels: ["soldier"] }],
              hand: [{ id: "card-p2-counter-dl", suit: "D", rank: "A", value: 1 }],
            },
          ],
        },
        patterns: [
          { patternRef: 0, patternId: "pat-counter-dl", kind: "ACTION", actionSelectionRef: 0, cardSelectionRef: 0 },
          { patternRef: 1, patternId: "pat-pass", kind: "PASS" },
        ],
      });

      const evalV72 = policyV72.evaluatePatterns(req);
      const evalV73 = policyV73.evaluatePatterns(req);
      const chosenV72 = policyV72.choose(req).selectedPatternRef;
      const chosenV73 = policyV73.choose(req).selectedPatternRef;

      scenarioAuditResults.push({
        scenarioId: "BP-AI-07",
        name: "死の槍へのCounter",
        priority: "P0",
        v72Status: chosenV72 === 0 ? "PASS" : "FAIL",
        v73Status: chosenV73 === 0 ? "PASS" : "FAIL",
        v72ChosenRef: chosenV72,
        v73ChosenRef: chosenV73,
        expectedPatternRef: 0,
        v72Scores: evalV72.scoredPatterns.map((p) => ({ ref: p.patternRef, base: p.baseScore, tactical: p.tacticalAdjustment, final: p.finalScore, reason: p.reason })),
        v73Scores: evalV73.scoredPatterns.map((p) => ({ ref: p.patternRef, base: p.baseScore, tactical: p.tacticalAdjustment, final: p.finalScore, reason: p.reason })),
        notes: `死の槍Counter選択: v7.2=${chosenV72}, v7.3=${chosenV73}`,
      });
      expect(chosenV72).toBe(0);
      expect(chosenV73).toBe(0);
    });

    it("BP-AI-08: アップ・ダウンによる死の槍回避 (P1)", () => {
      // 相手p1が死の槍発動中。対象自軍兵士(サイズ4)、キーカード♦4(割り切れる)。自軍にクイック「アップ」(サイズ+2で6になり回避)あり。
      const dlStageReq: RequestView = {
        requestId: "req-stage-dl-evade",
        actionId: "action.deathLance",
        controller: "p1",
        actorPlayerId: "p1",
        targetUnitId: "u-target",
        chosenKeys: { key: { suit: "D", rank: "4", value: 4 } },
        resolvedCosts: { life: 0 },
      } as any;

      const req = createAuditRequest({
        protocolVersion: "1.0.0",
        matchId: "audit-match-08",
        decisionId: "dec-bp-ai-08",
        stateVersion: 7,
        playerId: "p2",
        source: { type: "ACTION_REQUEST", playerId: "p2" },
        catalog: {
          actions: [{ actionId: "action.up", actionName: "アップ" }],
          cardSelections: [{ cardIds: ["card-up"], displayCodes: ["C2"] }],
          unitSelections: [],
          targetSelections: [{ targetType: "unit", targetUnitIds: ["u-target"] }],
          effectSelections: [],
          costPayments: [],
          orderSelections: [],
        },
        observation: {
          viewerPlayerId: "p2",
          turnPlayerId: "p1",
          chancePlayerId: "p2",
          stageRequests: [dlStageReq],
          players: [
            { playerId: "p1", handCount: 2, lifeCount: 10, bulwarks: [], field: [] },
            {
              playerId: "p2",
              handCount: 2,
              lifeCount: 10,
              bulwarks: [],
              field: [{ unitId: "u-target", size: 4, state: "charge", labels: ["soldier"] }],
              hand: [{ id: "card-up", suit: "C", rank: "2", value: 2 }],
            },
          ],
        },
        patterns: [
          { patternRef: 0, patternId: "pat-up-evade", kind: "ACTION", actionSelectionRef: 0, cardSelectionRef: 0, targetSelectionRef: 0 },
          { patternRef: 1, patternId: "pat-pass", kind: "PASS" },
        ],
      });

      const evalV72 = policyV72.evaluatePatterns(req);
      const evalV73 = policyV73.evaluatePatterns(req);
      const chosenV72 = policyV72.choose(req).selectedPatternRef;
      const chosenV73 = policyV73.choose(req).selectedPatternRef;

      // Gen9の戦術特徴量仕様(v7.2/v7.3)は現在 Counter と Block を専門に戦術評価しており、
      // アップ・ダウンによる間接的な回避(size modification evasion)の特徴量は未実装(A: 必要な特徴量が存在しない)
      const statusV72 = chosenV72 === 0 ? "PASS" : "FAIL";
      const statusV73 = chosenV73 === 0 ? "PASS" : "FAIL";

      scenarioAuditResults.push({
        scenarioId: "BP-AI-08",
        name: "アップ・ダウンによる死の槍回避",
        priority: "P1",
        v72Status: statusV72,
        v73Status: statusV73,
        v72ChosenRef: chosenV72,
        v73ChosenRef: chosenV73,
        expectedPatternRef: 0,
        v72Scores: evalV72.scoredPatterns.map((p) => ({ ref: p.patternRef, base: p.baseScore, tactical: p.tacticalAdjustment, final: p.finalScore, reason: p.reason })),
        v73Scores: evalV73.scoredPatterns.map((p) => ({ ref: p.patternRef, base: p.baseScore, tactical: p.tacticalAdjustment, final: p.finalScore, reason: p.reason })),
        rootCauseCategory: statusV72 === "FAIL" ? "A" : undefined,
        notes: `サイズ変更による死の槍回避評価: v7.2=${chosenV72}, v7.3=${chosenV73}`,
      });
    });
  });

  // ===========================================================================
  // カテゴリ C: 攻撃魔法 (BP-AI-09 〜 BP-AI-11)
  // ===========================================================================
  describe("カテゴリ C: 攻撃魔法", () => {
    it("BP-AI-09: 高威力の死の槍 (P1)", () => {
      // AI手番。手札に♦Aと♠K。相手フィールドにサイズ10大型兵士。死の槍 vs エンド。
      const req = createAuditRequest({
        protocolVersion: "1.0.0",
        matchId: "audit-match-09",
        decisionId: "dec-bp-ai-09",
        stateVersion: 12,
        playerId: "p2",
        source: { type: "ACTION_REQUEST", playerId: "p2" },
        catalog: {
          actions: [{ actionId: "action.deathLance", actionName: "死の槍" }, { actionId: "action.end", actionName: "エンド" }],
          cardSelections: [{ cardIds: ["card-da"], displayCodes: ["DA"] }],
          unitSelections: [],
          targetSelections: [{ targetType: "unit", targetUnitIds: ["u-p1-boss"] }],
          costPayments: [{ discardedCardIds: ["card-sk"], drivenBulwarkUnitIds: [], sacrificedUnitIds: [], lifeCount: 0 }],
          effectSelections: [],
          orderSelections: [],
        },
        observation: {
          viewerPlayerId: "p2",
          turnPlayerId: "p2",
          chancePlayerId: "p2",
          players: [
            {
              playerId: "p1",
              handCount: 2,
              lifeCount: 10,
              bulwarks: [],
              field: [{ unitId: "u-p1-boss", size: 10, state: "charge", labels: ["soldier"] }],
            },
            {
              playerId: "p2",
              handCount: 3,
              lifeCount: 10,
              bulwarks: [],
              field: [],
              hand: [
                { id: "card-da", suit: "D", rank: "A", value: 1 },
                { id: "card-sk", suit: "S", rank: "K", value: 10 },
              ],
            },
          ],
        },
        patterns: [
          { patternRef: 0, patternId: "pat-dl", kind: "ACTION", actionSelectionRef: 0, cardSelectionRef: 0, targetSelectionRef: 0, costPaymentRef: 0 },
          { patternRef: 1, patternId: "pat-end", kind: "ACTION", actionSelectionRef: 1 },
        ],
      });

      const evalV72 = policyV72.evaluatePatterns(req);
      const evalV73 = policyV73.evaluatePatterns(req);
      const chosenV72 = policyV72.choose(req).selectedPatternRef;
      const chosenV73 = policyV73.choose(req).selectedPatternRef;

      scenarioAuditResults.push({
        scenarioId: "BP-AI-09",
        name: "高威力の死の槍",
        priority: "P1",
        v72Status: chosenV72 === 0 ? "PASS" : "FAIL",
        v73Status: chosenV73 === 0 ? "PASS" : "FAIL",
        v72ChosenRef: chosenV72,
        v73ChosenRef: chosenV73,
        expectedPatternRef: 0,
        v72Scores: evalV72.scoredPatterns.map((p) => ({ ref: p.patternRef, base: p.baseScore, tactical: p.tacticalAdjustment, final: p.finalScore, reason: p.reason })),
        v73Scores: evalV73.scoredPatterns.map((p) => ({ ref: p.patternRef, base: p.baseScore, tactical: p.tacticalAdjustment, final: p.finalScore, reason: p.reason })),
        notes: `高威力死の槍選択: v7.2=${chosenV72}, v7.3=${chosenV73}`,
      });
    });

    it("BP-AI-10: 相手の対抗可能性を考慮した攻撃魔法 (P1)", () => {
      // ケースA: 相手手札0枚 (Counter不可)
      // ケースB: 相手手札5枚 (Counter警戒)
      const baseReq = createAuditRequest({
        protocolVersion: "1.0.0",
        matchId: "audit-match-10",
        decisionId: "dec-bp-ai-10",
        stateVersion: 12,
        playerId: "p2",
        source: { type: "ACTION_REQUEST", playerId: "p2" },
        catalog: {
          actions: [{ actionId: "action.throwing", actionName: "投擲" }, { actionId: "action.end", actionName: "エンド" }],
          cardSelections: [{ cardIds: ["card-sk"], displayCodes: ["SK"] }],
          unitSelections: [],
          targetSelections: [{ targetType: "player", targetPlayerId: "p1" }],
          costPayments: [],
          effectSelections: [],
          orderSelections: [],
        },
        observation: {
          viewerPlayerId: "p2",
          turnPlayerId: "p2",
          chancePlayerId: "p2",
          players: [
            { playerId: "p1", handCount: 0, lifeCount: 5, bulwarks: [], field: [] },
            {
              playerId: "p2",
              handCount: 3,
              lifeCount: 10,
              bulwarks: [],
              field: [],
              hand: [{ id: "card-sk", suit: "S", rank: "K", value: 10 }],
            },
          ],
        },
        patterns: [
          { patternRef: 0, patternId: "pat-th", kind: "ACTION", actionSelectionRef: 0, cardSelectionRef: 0 },
          { patternRef: 1, patternId: "pat-end", kind: "ACTION", actionSelectionRef: 1 },
        ],
      });

      const reqCaseA = baseReq;
      const reqCaseB = createAuditRequest({
        ...baseReq,
        observation: {
          ...baseReq.observation,
          players: [
            { playerId: "p1", handCount: 5, lifeCount: 5, bulwarks: [], field: [] }, // 手札5枚
            baseReq.observation.players[1],
          ],
        },
      });

      const evalV72A = policyV72.evaluatePatterns(reqCaseA);
      const evalV72B = policyV72.evaluatePatterns(reqCaseB);
      const scoreDiffV72 = evalV72A.scoredPatterns[0].finalScore - evalV72B.scoredPatterns[0].finalScore;

      const evalV73A = policyV73.evaluatePatterns(reqCaseA);
      const evalV73B = policyV73.evaluatePatterns(reqCaseB);
      const scoreDiffV73 = evalV73A.scoredPatterns[0].finalScore - evalV73B.scoredPatterns[0].finalScore;

      // 相手手札0枚のほうが投擲のスコアが高くなるか、あるいは同等か
      const statusV72 = scoreDiffV72 >= 0 ? "PASS" : "AMBIGUOUS";
      const statusV73 = scoreDiffV73 >= 0 ? "PASS" : "AMBIGUOUS";

      scenarioAuditResults.push({
        scenarioId: "BP-AI-10",
        name: "相手の対抗可能性を考慮した攻撃魔法",
        priority: "P1",
        v72Status: statusV72,
        v73Status: statusV73,
        v72ChosenRef: policyV72.choose(reqCaseA).selectedPatternRef,
        v73ChosenRef: policyV73.choose(reqCaseA).selectedPatternRef,
        expectedPatternRef: 0,
        v72Scores: [{ ref: 0, base: evalV72A.scoredPatterns[0].baseScore, tactical: evalV72A.scoredPatterns[0].tacticalAdjustment, final: evalV72A.scoredPatterns[0].finalScore, reason: `Diff(A-B)=${scoreDiffV72.toFixed(4)}` }],
        v73Scores: [{ ref: 0, base: evalV73A.scoredPatterns[0].baseScore, tactical: evalV73A.scoredPatterns[0].tacticalAdjustment, final: evalV73A.scoredPatterns[0].finalScore, reason: `Diff(A-B)=${scoreDiffV73.toFixed(4)}` }],
        notes: `相手手札0枚 vs 5枚での投擲スコア差: v7.2差=${scoreDiffV72.toFixed(4)}, v7.3差=${scoreDiffV73.toFixed(4)}`,
      });
    });

    it("BP-AI-11: ハンデスによる妨害 (P1)", () => {
      // 相手手札4枚。ハンデス(action.standardHandes) vs エンド。
      const req = createAuditRequest({
        protocolVersion: "1.0.0",
        matchId: "audit-match-11",
        decisionId: "dec-bp-ai-11",
        stateVersion: 8,
        playerId: "p2",
        source: { type: "ACTION_REQUEST", playerId: "p2" },
        catalog: {
          actions: [{ actionId: "action.standardHandes", actionName: "ハンデス" }, { actionId: "action.end", actionName: "エンド" }],
          cardSelections: [{ cardIds: ["card-h"], displayCodes: ["HJ"] }],
          unitSelections: [],
          targetSelections: [{ targetType: "player", targetPlayerId: "p1" }],
          costPayments: [],
          effectSelections: [],
          orderSelections: [],
        },
        observation: {
          viewerPlayerId: "p2",
          turnPlayerId: "p2",
          chancePlayerId: "p2",
          players: [
            { playerId: "p1", handCount: 4, lifeCount: 10, bulwarks: [], field: [] },
            {
              playerId: "p2",
              handCount: 3,
              lifeCount: 10,
              bulwarks: [],
              field: [],
              hand: [{ id: "card-h", suit: "H", rank: "J", value: 10 }],
            },
          ],
        },
        patterns: [
          { patternRef: 0, patternId: "pat-handes", kind: "ACTION", actionSelectionRef: 0, cardSelectionRef: 0 },
          { patternRef: 1, patternId: "pat-end", kind: "ACTION", actionSelectionRef: 1 },
        ],
      });

      const evalV72 = policyV72.evaluatePatterns(req);
      const evalV73 = policyV73.evaluatePatterns(req);
      const chosenV72 = policyV72.choose(req).selectedPatternRef;
      const chosenV73 = policyV73.choose(req).selectedPatternRef;

      scenarioAuditResults.push({
        scenarioId: "BP-AI-11",
        name: "ハンデスによる妨害",
        priority: "P1",
        v72Status: chosenV72 === 0 ? "PASS" : "AMBIGUOUS",
        v73Status: chosenV73 === 0 ? "PASS" : "AMBIGUOUS",
        v72ChosenRef: chosenV72,
        v73ChosenRef: chosenV73,
        expectedPatternRef: 0,
        v72Scores: evalV72.scoredPatterns.map((p) => ({ ref: p.patternRef, base: p.baseScore, tactical: p.tacticalAdjustment, final: p.finalScore, reason: p.reason })),
        v73Scores: evalV73.scoredPatterns.map((p) => ({ ref: p.patternRef, base: p.baseScore, tactical: p.tacticalAdjustment, final: p.finalScore, reason: p.reason })),
        notes: `ハンデス選択: v7.2=${chosenV72}, v7.3=${chosenV73}`,
      });
    });
  });

  // ===========================================================================
  // カテゴリ D: 召喚・攻撃 (BP-AI-12 〜 BP-AI-15)
  // ===========================================================================
  describe("カテゴリ D: 召喚・攻撃", () => {
    it("BP-AI-12: Jokerのリアニメイト (P1)", () => {
      // 墓地にJoker。自軍場に小型兵士(サイズ1)。リアニメイト(action.standardReanimate)で小型兵士を犠牲にしてJoker蘇生。
      const req = createAuditRequest({
        protocolVersion: "1.0.0",
        matchId: "audit-match-12",
        decisionId: "dec-bp-ai-12",
        stateVersion: 14,
        playerId: "p2",
        source: { type: "ACTION_REQUEST", playerId: "p2" },
        catalog: {
          actions: [{ actionId: "action.standardReanimate", actionName: "リアニメイト" }, { actionId: "action.end", actionName: "エンド" }],
          cardSelections: [{ cardIds: ["card-joker"], displayCodes: ["JK"] }],
          unitSelections: [],
          targetSelections: [{ targetType: "card", targetCardId: "card-joker" }],
          costPayments: [{ discardedCardIds: [], drivenBulwarkUnitIds: [], sacrificedUnitIds: ["u-small"], lifeCount: 0 }],
          effectSelections: [],
          orderSelections: [],
        },
        observation: {
          viewerPlayerId: "p2",
          turnPlayerId: "p2",
          chancePlayerId: "p2",
          players: [
            { playerId: "p1", handCount: 2, lifeCount: 10, bulwarks: [], field: [] },
            {
              playerId: "p2",
              handCount: 2,
              lifeCount: 10,
              bulwarks: [],
              field: [{ unitId: "u-small", size: 1, state: "charge", labels: ["soldier"] }],
              grave: [{ id: "card-joker", suit: "J", rank: "JOKER", value: 20 }],
            },
          ],
        },
        patterns: [
          { patternRef: 0, patternId: "pat-reanimate-joker", kind: "ACTION", actionSelectionRef: 0, cardSelectionRef: 0, costPaymentRef: 0 },
          { patternRef: 1, patternId: "pat-end", kind: "ACTION", actionSelectionRef: 1 },
        ],
      });

      const evalV72 = policyV72.evaluatePatterns(req);
      const evalV73 = policyV73.evaluatePatterns(req);
      const chosenV72 = policyV72.choose(req).selectedPatternRef;
      const chosenV73 = policyV73.choose(req).selectedPatternRef;

      scenarioAuditResults.push({
        scenarioId: "BP-AI-12",
        name: "Jokerのリアニメイト",
        priority: "P1",
        v72Status: chosenV72 === 0 ? "PASS" : "FAIL",
        v73Status: chosenV73 === 0 ? "PASS" : "FAIL",
        v72ChosenRef: chosenV72,
        v73ChosenRef: chosenV73,
        expectedPatternRef: 0,
        v72Scores: evalV72.scoredPatterns.map((p) => ({ ref: p.patternRef, base: p.baseScore, tactical: p.tacticalAdjustment, final: p.finalScore, reason: p.reason })),
        v73Scores: evalV73.scoredPatterns.map((p) => ({ ref: p.patternRef, base: p.baseScore, tactical: p.tacticalAdjustment, final: p.finalScore, reason: p.reason })),
        notes: `Jokerリアニメイト選択: v7.2=${chosenV72}, v7.3=${chosenV73}`,
      });
    });

    it("BP-AI-13: 有利なアタック (P1)", () => {
      // 自軍に大型兵士サイズ5(チャージ)。相手フィールド空。相手ライフ5。
      const req = createAuditRequest({
        protocolVersion: "1.0.0",
        matchId: "audit-match-13",
        decisionId: "dec-bp-ai-13",
        stateVersion: 10,
        playerId: "p2",
        source: { type: "ACTION_REQUEST", playerId: "p2" },
        catalog: {
          actions: [{ actionId: "action.attack", actionName: "アタック" }, { actionId: "action.end", actionName: "エンド" }],
          unitSelections: [{ unitIds: ["u-big-charge"], count: 1 }],
          targetSelections: [],
          costPayments: [],
          effectSelections: [],
          cardSelections: [],
          orderSelections: [],
        },
        observation: {
          viewerPlayerId: "p2",
          turnPlayerId: "p2",
          chancePlayerId: "p2",
          players: [
            { playerId: "p1", handCount: 2, lifeCount: 5, bulwarks: [], field: [] },
            {
              playerId: "p2",
              handCount: 2,
              lifeCount: 10,
              bulwarks: [],
              field: [{ unitId: "u-big-charge", size: 5, state: "charge", labels: ["soldier"] }],
            },
          ],
        },
        patterns: [
          { patternRef: 0, patternId: "pat-attack", kind: "ACTION", actionSelectionRef: 0, unitSelectionRef: 0 },
          { patternRef: 1, patternId: "pat-end", kind: "ACTION", actionSelectionRef: 1 },
        ],
      });

      const evalV72 = policyV72.evaluatePatterns(req);
      const evalV73 = policyV73.evaluatePatterns(req);
      const chosenV72 = policyV72.choose(req).selectedPatternRef;
      const chosenV73 = policyV73.choose(req).selectedPatternRef;

      scenarioAuditResults.push({
        scenarioId: "BP-AI-13",
        name: "有利なアタック",
        priority: "P1",
        v72Status: chosenV72 === 0 ? "PASS" : "FAIL",
        v73Status: chosenV73 === 0 ? "PASS" : "FAIL",
        v72ChosenRef: chosenV72,
        v73ChosenRef: chosenV73,
        expectedPatternRef: 0,
        v72Scores: evalV72.scoredPatterns.map((p) => ({ ref: p.patternRef, base: p.baseScore, tactical: p.tacticalAdjustment, final: p.finalScore, reason: p.reason })),
        v73Scores: evalV73.scoredPatterns.map((p) => ({ ref: p.patternRef, base: p.baseScore, tactical: p.tacticalAdjustment, final: p.finalScore, reason: p.reason })),
        notes: `有利アタック選択: v7.2=${chosenV72}, v7.3=${chosenV73}`,
      });
      expect(chosenV72).toBe(0);
      expect(chosenV73).toBe(0);
    });

    it("BP-AI-14: 無謀なアタックの回避 (P0)", () => {
      // 自軍に小型兵士(サイズ1)のみ。相手フィールドにチャージ状態の大型兵士(サイズ6)。相手ライフ15。
      // 攻撃すると確実にブロックされて一方的犬死。エンドで温存が合理的。
      const req = createAuditRequest({
        protocolVersion: "1.0.0",
        matchId: "audit-match-14",
        decisionId: "dec-bp-ai-14",
        stateVersion: 10,
        playerId: "p2",
        source: { type: "ACTION_REQUEST", playerId: "p2" },
        catalog: {
          actions: [{ actionId: "action.attack", actionName: "アタック" }, { actionId: "action.end", actionName: "エンド" }],
          unitSelections: [{ unitIds: ["u-small-charge"], count: 1 }],
          targetSelections: [],
          costPayments: [],
          effectSelections: [],
          cardSelections: [],
          orderSelections: [],
        },
        observation: {
          viewerPlayerId: "p2",
          turnPlayerId: "p2",
          chancePlayerId: "p2",
          players: [
            {
              playerId: "p1",
              handCount: 3,
              lifeCount: 15,
              bulwarks: [],
              field: [{ unitId: "u-p1-wall", size: 6, state: "charge", labels: ["soldier"] }],
            },
            {
              playerId: "p2",
              handCount: 2,
              lifeCount: 10,
              bulwarks: [],
              field: [{ unitId: "u-small-charge", size: 1, state: "charge", labels: ["soldier"] }],
            },
          ],
        },
        patterns: [
          { patternRef: 0, patternId: "pat-suicide-attack", kind: "ACTION", actionSelectionRef: 0, unitSelectionRef: 0 },
          { patternRef: 1, patternId: "pat-end", kind: "ACTION", actionSelectionRef: 1 },
        ],
      });

      const evalV72 = policyV72.evaluatePatterns(req);
      const evalV73 = policyV73.evaluatePatterns(req);
      const chosenV72 = policyV72.choose(req).selectedPatternRef;
      const chosenV73 = policyV73.choose(req).selectedPatternRef;

      // 期待: エンド(ref 1)を選択し自滅攻撃(ref 0)を回避
      const statusV72 = chosenV72 === 1 ? "PASS" : "FAIL";
      const statusV73 = chosenV73 === 1 ? "PASS" : "FAIL";

      scenarioAuditResults.push({
        scenarioId: "BP-AI-14",
        name: "無謀なアタックの回避",
        priority: "P0",
        v72Status: statusV72,
        v73Status: statusV73,
        v72ChosenRef: chosenV72,
        v73ChosenRef: chosenV73,
        expectedPatternRef: 1,
        v72Scores: evalV72.scoredPatterns.map((p) => ({ ref: p.patternRef, base: p.baseScore, tactical: p.tacticalAdjustment, final: p.finalScore, reason: p.reason })),
        v73Scores: evalV73.scoredPatterns.map((p) => ({ ref: p.patternRef, base: p.baseScore, tactical: p.tacticalAdjustment, final: p.finalScore, reason: p.reason })),
        rootCauseCategory: statusV72 === "FAIL" ? "C" : undefined,
        notes: `自滅アタック回避: v7.2=${chosenV72}, v7.3=${chosenV73}`,
      });
    });

    it("BP-AI-15: エース＋装備 (P2)", () => {
      // 自軍場にエース(A)あり。手札に同スートのK。装備アクション(action.equip) vs エンド。
      const req = createAuditRequest({
        protocolVersion: "1.0.0",
        matchId: "audit-match-15",
        decisionId: "dec-bp-ai-15",
        stateVersion: 10,
        playerId: "p2",
        source: { type: "ACTION_REQUEST", playerId: "p2" },
        catalog: {
          actions: [{ actionId: "action.equip", actionName: "装備" }, { actionId: "action.end", actionName: "エンド" }],
          cardSelections: [{ cardIds: ["card-sk"], displayCodes: ["SK"] }],
          unitSelections: [],
          targetSelections: [{ targetType: "unit", targetUnitIds: ["u-ace"] }],
          costPayments: [],
          effectSelections: [],
          orderSelections: [],
        },
        observation: {
          viewerPlayerId: "p2",
          turnPlayerId: "p2",
          chancePlayerId: "p2",
          players: [
            { playerId: "p1", handCount: 2, lifeCount: 10, bulwarks: [], field: [] },
            {
              playerId: "p2",
              handCount: 2,
              lifeCount: 10,
              bulwarks: [],
              field: [{ unitId: "u-ace", size: 1, state: "charge", labels: ["soldier", "ace"] }],
              hand: [{ id: "card-sk", suit: "S", rank: "K", value: 10 }],
            },
          ],
        },
        patterns: [
          { patternRef: 0, patternId: "pat-equip", kind: "ACTION", actionSelectionRef: 0, cardSelectionRef: 0, targetSelectionRef: 0 },
          { patternRef: 1, patternId: "pat-end", kind: "ACTION", actionSelectionRef: 1 },
        ],
      });

      const evalV72 = policyV72.evaluatePatterns(req);
      const evalV73 = policyV73.evaluatePatterns(req);
      const chosenV72 = policyV72.choose(req).selectedPatternRef;
      const chosenV73 = policyV73.choose(req).selectedPatternRef;

      scenarioAuditResults.push({
        scenarioId: "BP-AI-15",
        name: "エース＋装備",
        priority: "P2",
        v72Status: chosenV72 === 0 ? "PASS" : "AMBIGUOUS",
        v73Status: chosenV73 === 0 ? "PASS" : "AMBIGUOUS",
        v72ChosenRef: chosenV72,
        v73ChosenRef: chosenV73,
        expectedPatternRef: 0,
        v72Scores: evalV72.scoredPatterns.map((p) => ({ ref: p.patternRef, base: p.baseScore, tactical: p.tacticalAdjustment, final: p.finalScore, reason: p.reason })),
        v73Scores: evalV73.scoredPatterns.map((p) => ({ ref: p.patternRef, base: p.baseScore, tactical: p.tacticalAdjustment, final: p.finalScore, reason: p.reason })),
        notes: `装備アクション選択: v7.2=${chosenV72}, v7.3=${chosenV73}`,
      });
    });
  });

  // ===========================================================================
  // カテゴリ E: リソース管理・パック (BP-AI-16 〜 BP-AI-21)
  // ===========================================================================
  describe("カテゴリ E: リソース管理・パック", () => {
    it("BP-AI-16: 手札温存 (P2)", () => {
      // 手札2枚（投擲コンボ用）。無意味な手札消費アクション vs エンドで手札温存。
      const req = createAuditRequest({
        protocolVersion: "1.0.0",
        matchId: "audit-match-16",
        decisionId: "dec-bp-ai-16",
        stateVersion: 10,
        playerId: "p2",
        source: { type: "ACTION_REQUEST", playerId: "p2" },
        catalog: {
          actions: [{ actionId: "action.summonSoldier", actionName: "兵士召喚" }, { actionId: "action.end", actionName: "エンド" }],
          cardSelections: [{ cardIds: ["card-s1"], displayCodes: ["S1"] }],
          unitSelections: [],
          targetSelections: [],
          costPayments: [],
          effectSelections: [],
          orderSelections: [],
        },
        observation: {
          viewerPlayerId: "p2",
          turnPlayerId: "p2",
          chancePlayerId: "p2",
          players: [
            { playerId: "p1", handCount: 3, lifeCount: 10, bulwarks: [], field: [] },
            {
              playerId: "p2",
              handCount: 2, // 2枚温存したい
              lifeCount: 10,
              bulwarks: [],
              field: [],
              hand: [
                { id: "card-s1", suit: "S", rank: "A", value: 1 },
                { id: "card-s2", suit: "S", rank: "K", value: 10 },
              ],
            },
          ],
        },
        patterns: [
          { patternRef: 0, patternId: "pat-summon", kind: "ACTION", actionSelectionRef: 0, cardSelectionRef: 0 },
          { patternRef: 1, patternId: "pat-end", kind: "ACTION", actionSelectionRef: 1 },
        ],
      });

      const evalV72 = policyV72.evaluatePatterns(req);
      const evalV73 = policyV73.evaluatePatterns(req);
      const chosenV72 = policyV72.choose(req).selectedPatternRef;
      const chosenV73 = policyV73.choose(req).selectedPatternRef;

      scenarioAuditResults.push({
        scenarioId: "BP-AI-16",
        name: "手札温存",
        priority: "P2",
        v72Status: "AMBIGUOUS",
        v73Status: "AMBIGUOUS",
        v72ChosenRef: chosenV72,
        v73ChosenRef: chosenV73,
        expectedPatternRef: [0, 1],
        v72Scores: evalV72.scoredPatterns.map((p) => ({ ref: p.patternRef, base: p.baseScore, tactical: p.tacticalAdjustment, final: p.finalScore, reason: p.reason })),
        v73Scores: evalV73.scoredPatterns.map((p) => ({ ref: p.patternRef, base: p.baseScore, tactical: p.tacticalAdjustment, final: p.finalScore, reason: p.reason })),
        notes: `手札温存 vs 召喚: v7.2=${chosenV72}, v7.3=${chosenV73}`,
      });
    });

    it("BP-AI-17: パック開封による勝利準備 (P1)", () => {
      // 未開封パックあり。パック開封(action.packOpen) vs エンド。
      const req = createAuditRequest({
        protocolVersion: "1.0.0",
        matchId: "audit-match-17",
        decisionId: "dec-bp-ai-17",
        stateVersion: 5,
        playerId: "p2",
        source: { type: "ACTION_REQUEST", playerId: "p2" },
        catalog: {
          actions: [{ actionId: "action.packOpen", actionName: "パック開封" }, { actionId: "action.end", actionName: "エンド" }],
          cardSelections: [],
          unitSelections: [],
          targetSelections: [],
          costPayments: [],
          effectSelections: [],
          orderSelections: [],
        },
        observation: {
          viewerPlayerId: "p2",
          turnPlayerId: "p2",
          chancePlayerId: "p2",
          players: [
            { playerId: "p1", handCount: 3, lifeCount: 10, bulwarks: [], field: [] },
            {
              playerId: "p2",
              handCount: 3,
              lifeCount: 10,
              bulwarks: [],
              field: [],
              hasUnopenedPack: true,
            },
          ],
        },
        patterns: [
          { patternRef: 0, patternId: "pat-pack-open", kind: "ACTION", actionSelectionRef: 0 },
          { patternRef: 1, patternId: "pat-end", kind: "ACTION", actionSelectionRef: 1 },
        ],
      });

      const evalV72 = policyV72.evaluatePatterns(req);
      const evalV73 = policyV73.evaluatePatterns(req);
      const chosenV72 = policyV72.choose(req).selectedPatternRef;
      const chosenV73 = policyV73.choose(req).selectedPatternRef;

      scenarioAuditResults.push({
        scenarioId: "BP-AI-17",
        name: "パック開封による勝利準備",
        priority: "P1",
        v72Status: chosenV72 === 0 ? "PASS" : "FAIL",
        v73Status: chosenV73 === 0 ? "PASS" : "FAIL",
        v72ChosenRef: chosenV72,
        v73ChosenRef: chosenV73,
        expectedPatternRef: 0,
        v72Scores: evalV72.scoredPatterns.map((p) => ({ ref: p.patternRef, base: p.baseScore, tactical: p.tacticalAdjustment, final: p.finalScore, reason: p.reason })),
        v73Scores: evalV73.scoredPatterns.map((p) => ({ ref: p.patternRef, base: p.baseScore, tactical: p.tacticalAdjustment, final: p.finalScore, reason: p.reason })),
        notes: `パック開封選択: v7.2=${chosenV72}, v7.3=${chosenV73}`,
      });
    });

    it("BP-AI-18: 防壁の確保 (P2)", () => {
      // 防壁0枚のとき、防壁設置(action.setBulwark) vs エンド。
      const req = createAuditRequest({
        protocolVersion: "1.0.0",
        matchId: "audit-match-18",
        decisionId: "dec-bp-ai-18",
        stateVersion: 5,
        playerId: "p2",
        source: { type: "ACTION_REQUEST", playerId: "p2" },
        catalog: {
          actions: [{ actionId: "action.setBulwark", actionName: "防壁設置" }, { actionId: "action.end", actionName: "エンド" }],
          cardSelections: [{ cardIds: ["card-bw"], displayCodes: ["D5"] }],
          unitSelections: [],
          targetSelections: [],
          costPayments: [],
          effectSelections: [],
          orderSelections: [],
        },
        observation: {
          viewerPlayerId: "p2",
          turnPlayerId: "p2",
          chancePlayerId: "p2",
          players: [
            { playerId: "p1", handCount: 3, lifeCount: 10, bulwarks: [], field: [] },
            {
              playerId: "p2",
              handCount: 3,
              lifeCount: 10,
              bulwarks: [], // 0枚
              field: [],
              hand: [{ id: "card-bw", suit: "D", rank: "5", value: 5 }],
            },
          ],
        },
        patterns: [
          { patternRef: 0, patternId: "pat-set-bulwark", kind: "ACTION", actionSelectionRef: 0, cardSelectionRef: 0 },
          { patternRef: 1, patternId: "pat-end", kind: "ACTION", actionSelectionRef: 1 },
        ],
      });

      const evalV72 = policyV72.evaluatePatterns(req);
      const evalV73 = policyV73.evaluatePatterns(req);
      const chosenV72 = policyV72.choose(req).selectedPatternRef;
      const chosenV73 = policyV73.choose(req).selectedPatternRef;

      scenarioAuditResults.push({
        scenarioId: "BP-AI-18",
        name: "防壁の確保",
        priority: "P2",
        v72Status: chosenV72 === 0 ? "PASS" : "AMBIGUOUS",
        v73Status: chosenV73 === 0 ? "PASS" : "AMBIGUOUS",
        v72ChosenRef: chosenV72,
        v73ChosenRef: chosenV73,
        expectedPatternRef: 0,
        v72Scores: evalV72.scoredPatterns.map((p) => ({ ref: p.patternRef, base: p.baseScore, tactical: p.tacticalAdjustment, final: p.finalScore, reason: p.reason })),
        v73Scores: evalV73.scoredPatterns.map((p) => ({ ref: p.patternRef, base: p.baseScore, tactical: p.tacticalAdjustment, final: p.finalScore, reason: p.reason })),
        notes: `防壁設置選択: v7.2=${chosenV72}, v7.3=${chosenV73}`,
      });
    });

    it("BP-AI-19: 防壁補充・防壁破壊 (P2)", () => {
      // 相手防壁3枚。AIに防壁破壊(action.destroyBulwark) vs エンド。
      const req = createAuditRequest({
        protocolVersion: "1.0.0",
        matchId: "audit-match-19",
        decisionId: "dec-bp-ai-19",
        stateVersion: 8,
        playerId: "p2",
        source: { type: "ACTION_REQUEST", playerId: "p2" },
        catalog: {
          actions: [{ actionId: "action.destroyBulwark", actionName: "防壁破壊" }, { actionId: "action.end", actionName: "エンド" }],
          cardSelections: [{ cardIds: ["card-db"], displayCodes: ["D10"] }],
          unitSelections: [],
          targetSelections: [{ targetType: "unit", targetUnitIds: ["bw-p1-0"] }],
          costPayments: [],
          effectSelections: [],
          orderSelections: [],
        },
        observation: {
          viewerPlayerId: "p2",
          turnPlayerId: "p2",
          chancePlayerId: "p2",
          players: [
            {
              playerId: "p1",
              handCount: 3,
              lifeCount: 10,
              bulwarks: [{ unitId: "bw-p1-0", labels: ["bulwark"] }, { unitId: "bw-p1-1", labels: ["bulwark"] }],
              field: [],
            },
            {
              playerId: "p2",
              handCount: 3,
              lifeCount: 10,
              bulwarks: [],
              field: [],
              hand: [{ id: "card-db", suit: "D", rank: "10", value: 10 }],
            },
          ],
        },
        patterns: [
          { patternRef: 0, patternId: "pat-destroy-bw", kind: "ACTION", actionSelectionRef: 0, cardSelectionRef: 0, targetSelectionRef: 0 },
          { patternRef: 1, patternId: "pat-end", kind: "ACTION", actionSelectionRef: 1 },
        ],
      });

      const evalV72 = policyV72.evaluatePatterns(req);
      const evalV73 = policyV73.evaluatePatterns(req);
      const chosenV72 = policyV72.choose(req).selectedPatternRef;
      const chosenV73 = policyV73.choose(req).selectedPatternRef;

      scenarioAuditResults.push({
        scenarioId: "BP-AI-19",
        name: "防壁補充・防壁破壊",
        priority: "P2",
        v72Status: chosenV72 === 0 ? "PASS" : "AMBIGUOUS",
        v73Status: chosenV73 === 0 ? "PASS" : "AMBIGUOUS",
        v72ChosenRef: chosenV72,
        v73ChosenRef: chosenV73,
        expectedPatternRef: 0,
        v72Scores: evalV72.scoredPatterns.map((p) => ({ ref: p.patternRef, base: p.baseScore, tactical: p.tacticalAdjustment, final: p.finalScore, reason: p.reason })),
        v73Scores: evalV73.scoredPatterns.map((p) => ({ ref: p.patternRef, base: p.baseScore, tactical: p.tacticalAdjustment, final: p.finalScore, reason: p.reason })),
        notes: `防壁破壊選択: v7.2=${chosenV72}, v7.3=${chosenV73}`,
      });
    });

    it("BP-AI-20: 英雄召喚とリアニメイト (P2)", () => {
      // 手札から英雄召喚(コスト手札2枚) vs 墓地の英雄をリアニメイト(コスト自軍キャラ1体)。
      const req = createAuditRequest({
        protocolVersion: "1.0.0",
        matchId: "audit-match-20",
        decisionId: "dec-bp-ai-20",
        stateVersion: 10,
        playerId: "p2",
        source: { type: "ACTION_REQUEST", playerId: "p2" },
        catalog: {
          actions: [
            { actionId: "action.summonHero", actionName: "英雄召喚" },
            { actionId: "action.standardReanimate", actionName: "リアニメイト" },
            { actionId: "action.end", actionName: "エンド" },
          ],
          cardSelections: [
            { cardIds: ["card-hero-hand"], displayCodes: ["HA"] },
            { cardIds: ["card-hero-grave"], displayCodes: ["DA"] },
          ],
          unitSelections: [],
          targetSelections: [{ targetType: "card", targetCardId: "card-hero-grave" }],
          costPayments: [
            { discardedCardIds: ["cost-1", "cost-2"], drivenBulwarkUnitIds: [], sacrificedUnitIds: [], lifeCount: 0 },
            { discardedCardIds: [], drivenBulwarkUnitIds: [], sacrificedUnitIds: ["u-soldier"], lifeCount: 0 },
          ],
          effectSelections: [],
          orderSelections: [],
        },
        observation: {
          viewerPlayerId: "p2",
          turnPlayerId: "p2",
          chancePlayerId: "p2",
          players: [
            { playerId: "p1", handCount: 2, lifeCount: 10, bulwarks: [], field: [] },
            {
              playerId: "p2",
              handCount: 3,
              lifeCount: 10,
              bulwarks: [],
              field: [{ unitId: "u-soldier", size: 1, state: "charge", labels: ["soldier"] }],
              hand: [
                { id: "card-hero-hand", suit: "H", rank: "A", value: 1 },
                { id: "cost-1", suit: "S", rank: "2", value: 2 },
                { id: "cost-2", suit: "S", rank: "3", value: 3 },
              ],
              grave: [{ id: "card-hero-grave", suit: "D", rank: "A", value: 1 }],
            },
          ],
        },
        patterns: [
          { patternRef: 0, patternId: "pat-summon-hero", kind: "ACTION", actionSelectionRef: 0, cardSelectionRef: 0, costPaymentRef: 0 },
          { patternRef: 1, patternId: "pat-reanimate-hero", kind: "ACTION", actionSelectionRef: 1, cardSelectionRef: 1, costPaymentRef: 1 },
          { patternRef: 2, patternId: "pat-end", kind: "ACTION", actionSelectionRef: 2 },
        ],
      });

      const evalV72 = policyV72.evaluatePatterns(req);
      const evalV73 = policyV73.evaluatePatterns(req);
      const chosenV72 = policyV72.choose(req).selectedPatternRef;
      const chosenV73 = policyV73.choose(req).selectedPatternRef;

      scenarioAuditResults.push({
        scenarioId: "BP-AI-20",
        name: "英雄召喚とリアニメイト",
        priority: "P2",
        v72Status: chosenV72 !== 2 ? "PASS" : "AMBIGUOUS",
        v73Status: chosenV73 !== 2 ? "PASS" : "AMBIGUOUS",
        v72ChosenRef: chosenV72,
        v73ChosenRef: chosenV73,
        expectedPatternRef: [0, 1],
        v72Scores: evalV72.scoredPatterns.map((p) => ({ ref: p.patternRef, base: p.baseScore, tactical: p.tacticalAdjustment, final: p.finalScore, reason: p.reason })),
        v73Scores: evalV73.scoredPatterns.map((p) => ({ ref: p.patternRef, base: p.baseScore, tactical: p.tacticalAdjustment, final: p.finalScore, reason: p.reason })),
        notes: `手札召喚(0) vs リアニメイト(1): v7.2=${chosenV72}, v7.3=${chosenV73}`,
      });
    });

    it("BP-AI-21: 攻撃後のリアニメイト (P2)", () => {
      // チャージ状態の兵士がアタック可能。その後リアニメイトでその兵士を犠牲にできる。
      // 先にアタック(action.attack)するか、いきなりリアニメイト(action.standardReanimate)するか。
      const req = createAuditRequest({
        protocolVersion: "1.0.0",
        matchId: "audit-match-21",
        decisionId: "dec-bp-ai-21",
        stateVersion: 10,
        playerId: "p2",
        source: { type: "ACTION_REQUEST", playerId: "p2" },
        catalog: {
          actions: [
            { actionId: "action.attack", actionName: "アタック" },
            { actionId: "action.standardReanimate", actionName: "リアニメイト" },
            { actionId: "action.end", actionName: "エンド" },
          ],
          unitSelections: [{ unitIds: ["u-soldier-charge"], count: 1 }],
          cardSelections: [{ cardIds: ["card-grave-boss"], displayCodes: ["DA"] }],
          targetSelections: [{ targetType: "card", targetCardId: "card-grave-boss" }],
          costPayments: [{ discardedCardIds: [], drivenBulwarkUnitIds: [], sacrificedUnitIds: ["u-soldier-charge"], lifeCount: 0 }],
          effectSelections: [],
          orderSelections: [],
        },
        observation: {
          viewerPlayerId: "p2",
          turnPlayerId: "p2",
          chancePlayerId: "p2",
          players: [
            { playerId: "p1", handCount: 2, lifeCount: 10, bulwarks: [], field: [] },
            {
              playerId: "p2",
              handCount: 2,
              lifeCount: 10,
              bulwarks: [],
              field: [{ unitId: "u-soldier-charge", size: 3, state: "charge", labels: ["soldier"] }],
              grave: [{ id: "card-grave-boss", suit: "D", rank: "A", value: 1 }],
            },
          ],
        },
        patterns: [
          { patternRef: 0, patternId: "pat-attack-first", kind: "ACTION", actionSelectionRef: 0, unitSelectionRef: 0 },
          { patternRef: 1, patternId: "pat-reanimate-direct", kind: "ACTION", actionSelectionRef: 1, cardSelectionRef: 0, costPaymentRef: 0 },
          { patternRef: 2, patternId: "pat-end", kind: "ACTION", actionSelectionRef: 2 },
        ],
      });

      const evalV72 = policyV72.evaluatePatterns(req);
      const evalV73 = policyV73.evaluatePatterns(req);
      const chosenV72 = policyV72.choose(req).selectedPatternRef;
      const chosenV73 = policyV73.choose(req).selectedPatternRef;

      // 期待: 有利なアタック機会があるため先にアタック(0)を選択
      scenarioAuditResults.push({
        scenarioId: "BP-AI-21",
        name: "攻撃後のリアニメイト",
        priority: "P2",
        v72Status: chosenV72 === 0 ? "PASS" : "AMBIGUOUS",
        v73Status: chosenV73 === 0 ? "PASS" : "AMBIGUOUS",
        v72ChosenRef: chosenV72,
        v73ChosenRef: chosenV73,
        expectedPatternRef: 0,
        v72Scores: evalV72.scoredPatterns.map((p) => ({ ref: p.patternRef, base: p.baseScore, tactical: p.tacticalAdjustment, final: p.finalScore, reason: p.reason })),
        v73Scores: evalV73.scoredPatterns.map((p) => ({ ref: p.patternRef, base: p.baseScore, tactical: p.tacticalAdjustment, final: p.finalScore, reason: p.reason })),
        notes: `攻撃優先(0) vs 直前リアニメイト(1): v7.2=${chosenV72}, v7.3=${chosenV73}`,
      });
    });
  });
});
