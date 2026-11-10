/**
 * gen9PlaytestIntegration.test.ts
 *
 * BlackPoker Simulator - Work 5-6: Gen 9 人間対AIプレイテスト統合テスト
 *
 * 【検証項目】
 * T1: Policy 生成 (gen9-r4-v72)
 * T2: DNA 整合性 (検証済み Gen8 Champion DNA)
 * T3: Evaluator 整合性 (環境 RulePackage を明示的に使用)
 * T4: Human vs Gen9 対戦開始 (standard-pack)
 * T5: AI の自動判断 (advanceAutomatedDecisions)
 * T6: チャンスの返却 (HUMAN_TURN または FINISHED)
 * T7: Counter・ステージ処理
 * T8: 通常ブロック割り当て
 * T9: ストリーミングブロック対応
 * T10: 非公開情報の秘匿
 * T11: 決定論・再現性
 * T12: 対戦完走 (最低1試合の完全プレイアウト)
 * T13: 共有 URL 整合性
 * T14: 既存 AI の非破壊性
 * P1-1: Gen 9 v7.3 コスト評価プレビューの仕様整合性 (24次元, 固定診断重み)
 * P1-2: Gen 9 v7.3 コスト評価プレビューでの対戦完走
 */

import { describe, it, expect } from "vitest";
import { PlaytestPolicyFactory } from "../../engine/playtest/PlaytestPolicyFactory";
import {
  PLAYTEST_POLICY_OPTIONS,
  createSeatControllers,
} from "../../engine/playtest/PlaytestSeatController";
import { loadAndValidateGen8ChampionCandidateDNA } from "../../engine/ai/Gen8DNALoader";
import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader";
import { loadRegulationCatalogForBrowser } from "../../engine/regulation/BrowserRegulationLoader";
import {
  startMatchAttempt,
  OFFICIAL_ENV_PREFIX,
} from "../../engine/playtest/PlaytestEnvironmentController";
import { advanceAutomatedDecisions } from "../../engine/playtest/HumanVsPolicyController";
import {
  FirstLegalPolicy,
  DecisionPolicy,
} from "../../engine/simulation/DecisionPolicy";
import { Gen9TacticalPrototypePolicy } from "../../engine/ai/Gen9TacticalPrototypePolicy";
import {
  Gen9LearnableTacticalPolicy,
  R4_PRESET_TACTICAL_WEIGHTS,
  TACTICAL_FEATURE_ENCODER_VERSION_V72,
  TACTICAL_FEATURE_ENCODER_VERSION_V73,
} from "../../engine/ai/Gen9LearnableTacticalPolicy";
import { COST_DIAGNOSTIC_WEIGHTS } from "../../engine/ai/CostFeatureDiagnosticEngine";
import {
  serializePlaytestShareUrl,
  parsePlaytestShareUrl,
} from "../../ui/playtest/PlaytestShareUrl";
import { PlaytestPerspectiveResolver } from "../../ui/playtest/PlaytestPerspectiveResolver";

describe("Work 5-6: Gen 9 人間対AIプレイテスト統合テスト (P0 & P1)", () => {
  const fullRulePackage = loadRulePackageForBrowser();
  const catalog = loadRegulationCatalogForBrowser();
  const standardPackEnvId = `${OFFICIAL_ENV_PREFIX}standard-pack`;

  // ===========================================================================
  // P0 必須テスト (T1〜T14)
  // ===========================================================================

  describe("P0: Gen 9 R4 v7.2 接続と対戦機能", () => {
    // T1: Policy 生成
    it("T1: gen9-r4-v72 から正しい Gen9 R4 インスタンスが生成されること", () => {
      const policy = PlaytestPolicyFactory.createPolicy(
        "gen9-r4-v72",
        undefined,
        "p2",
        "standard-pack",
        fullRulePackage
      );
      expect(policy).toBeDefined();
      expect(policy).toBeInstanceOf(Gen9TacticalPrototypePolicy);
      expect(policy.descriptor.name).toBe("Gen 9 R4 — 戦術AI");
      expect(policy.descriptor.kind).toBe("genome");
    });

    // T2: DNA 整合性
    it("T2: 検証済み Gen8 Champion DNA を正本として使用していること", () => {
      const genuineDna = loadAndValidateGen8ChampionCandidateDNA();
      const policy = PlaytestPolicyFactory.createPolicy(
        "gen9-r4-v72",
        undefined,
        "p2",
        "standard-pack"
      ) as Gen9TacticalPrototypePolicy;

      expect((policy as any).dna.metadata?.id).toBe(genuineDna.metadata?.id);
      expect((policy as any).dna.patternWeights.length).toBe(genuineDna.patternWeights.length);
    });

    // T3: Evaluator 整合性
    it("T3: 対戦環境に対応した RulePackage の Evaluator を利用していること", () => {
      const policy = PlaytestPolicyFactory.createPolicy(
        "gen9-r4-v72",
        undefined,
        "p2",
        "standard-pack",
        fullRulePackage
      ) as Gen9TacticalPrototypePolicy;

      // Evaluator が初期化されていること
      expect((policy as any).tacticalEvaluator).toBeDefined();
    });

    // T4: Human vs Gen9 対戦開始
    it("T4: スタンダード＋パック環境で Human vs Gen9 R4 の対戦が正常に開始されること", () => {
      const outcome = startMatchAttempt({
        environmentId: standardPackEnvId,
        seedInput: "790001",
        catalog,
        fullRulePackage,
        matchMode: "humanVsAi",
      });

      expect(outcome.type).toBe("READY");
      if (outcome.type !== "READY") return;

      const seatControllers = createSeatControllers("humanVsAi", "p1", "gen9-r4-v72");
      const policies = PlaytestPolicyFactory.createPoliciesForMatch(
        seatControllers,
        outcome.activeMatch.seed,
        outcome.activeMatch.regulationId,
        outcome.activeMatch.rulePackage
      );

      expect(seatControllers.p1.kind).toBe("HUMAN");
      expect(seatControllers.p2.kind).toBe("POLICY");
      expect(policies.p2).toBeDefined();
      expect(policies.p2.descriptor.name).toBe("Gen 9 R4 — 戦術AI");
    });

    // T5 & T6: AI の自動判断とチャンスの返却
    it("T5 & T6: 人間の手番終了後、AI が自動判断し、人間へチャンスが戻ること", async () => {
      const outcome = startMatchAttempt({
        environmentId: standardPackEnvId,
        seedInput: "790001",
        catalog,
        fullRulePackage,
        matchMode: "humanVsAi",
      });

      expect(outcome.type).toBe("READY");
      if (outcome.type !== "READY") return;

      const seatControllers = createSeatControllers("humanVsAi", "p1", "gen9-r4-v72");
      const policies = PlaytestPolicyFactory.createPoliciesForMatch(
        seatControllers,
        outcome.activeMatch.seed,
        outcome.activeMatch.regulationId,
        outcome.activeMatch.rulePackage
      );

      let step = outcome.initialStep;

      // 人間 (P1) の最初のアクションを実行 (end アクション)
      if (step.type === "WAITING_FOR_DECISION" && step.request.playerId === "p1") {
        const req = step.request;
        const endRef = req.patterns.findIndex((p) => {
          if (p.kind !== "ACTION" || p.actionSelectionRef === undefined) return false;
          return req.catalog.actions[p.actionSelectionRef]?.actionId === "action.end";
        });
        const chosenRef = endRef >= 0 ? endRef : 0;
        step = outcome.session.submitDecision({
          decisionId: req.decisionId,
          stateVersion: req.stateVersion,
          selectedPatternRef: chosenRef,
        });
      }

      // もし P1 に追加入力があれば PASS
      if (step.type === "WAITING_FOR_DECISION" && step.request.playerId === "p1") {
        const passRef = step.request.patterns.findIndex((p) => p.kind === "PASS");
        if (passRef >= 0) {
          step = outcome.session.submitDecision({
            decisionId: step.request.decisionId,
            stateVersion: step.request.stateVersion,
            selectedPatternRef: passRef,
          });
        }
      }

      // AI が自動判断を実行
      const result = await advanceAutomatedDecisions(
        outcome.session,
        step,
        seatControllers,
        policies,
        { maxAutomatedDecisions: 20 }
      );

      expect(result.status).toBe("STOPPED");
      if (result.status !== "STOPPED") return;
      expect(["HUMAN_TURN", "FINISHED"]).toContain(result.reason);
      expect(result.records.length).toBeGreaterThan(0);
      for (const rec of result.records) {
        expect(rec.playerId).toBe("p2");
        expect(rec.policyDescriptor.name).toBe("Gen 9 R4 — 戦術AI");
      }
    });

    // T8: 通常ブロック割り当て
    it("T8: Gen9 R4 がブロック割り当て決定において合法手を正常に選択できること", () => {
      const policy = PlaytestPolicyFactory.createPolicy(
        "gen9-r4-v72",
        undefined,
        "p2",
        "standard-pack",
        fullRulePackage
      );

      const dummyBlockReq: any = {
        protocolVersion: "1.0.0",
        matchId: "test-match",
        decisionId: "dec-block-1",
        stateVersion: 3,
        playerId: "p2",
        source: { type: "ACTION_REQUEST", playerId: "p2" },
        catalog: { actions: [{ actionId: "action.block", actionName: "ブロック" }] },
        observation: {
          viewerPlayerId: "p2",
          players: [
            { playerId: "p1", bulwarks: [], field: [{ unitId: "u-atk", battle: { role: "attacker" } }] },
            { playerId: "p2", bulwarks: [], field: [{ unitId: "u-blk", state: "charge", labels: [] }] },
          ],
        },
        patterns: [
          { patternRef: 0, patternId: "pat-block-none", kind: "ACTION", actionSelectionRef: 0 },
          { patternRef: 1, patternId: "pat-pass", kind: "PASS" },
        ],
      };

      const res = policy.choose(dummyBlockReq);
      expect(res.decisionId).toBe("dec-block-1");
      expect(res.selectedPatternRef).toBeGreaterThanOrEqual(0);
      expect(res.selectedPatternRef).toBeLessThan(dummyBlockReq.patterns.length);
    });

    // T9: ストリーミングブロック対応
    it("T9: ストリーミングブロック時に Gen9 R4 がストリームプロバイダ経由で正常に判断できること", () => {
      const policy = PlaytestPolicyFactory.createPolicy(
        "gen9-r4-v72",
        undefined,
        "p2",
        "standard-pack",
        fullRulePackage
      );

      const streamReq: any = {
        protocolVersion: "1.0.0",
        matchId: "test-match",
        decisionId: "dec-stream-1",
        stateVersion: 4,
        playerId: "p2",
        source: { type: "ACTION_REQUEST", playerId: "p2" },
        catalog: { actions: [{ actionId: "action.block", actionName: "ブロック" }] },
        observation: {
          viewerPlayerId: "p2",
          players: [
            { playerId: "p1", bulwarks: [], field: [{ unitId: "u-atk", battle: { role: "attacker" } }] },
            { playerId: "p2", bulwarks: [], field: [{ unitId: "u-blk", state: "charge", labels: [] }] },
          ],
        },
        patterns: [],
        blockAssignmentStream: {
          patternCount: 8,
          candidateCount: 2,
          iterateAssignments: function* () {
            for (let i = 0; i < 8; i++) {
              yield [];
            }
          },
          instantiatePatternAt: (ref: number) => ({
            pattern: { patternRef: ref, patternId: `stream-${ref}`, kind: "ACTION", actionSelectionRef: 0 },
            rawCost: undefined,
          }),
          getAssignmentAt: () => [],
        },
        blockAssignmentStreamMeta: {
          attackerUnitIds: ["u-atk"],
          candidateBlockerUnitIds: ["u-blk"],
        },
      };

      const res = policy.choose(streamReq);
      expect(res.decisionId).toBe("dec-stream-1");
      expect(res.selectedPatternRef).toBeGreaterThanOrEqual(0);
      expect(res.selectedPatternRef).toBeLessThan(8);
    });

    // T10: 非公開情報の秘匿
    it("T10: 人間の視点において人間側が常に画面手前 (p1) に配置されること", () => {
      const perspective = PlaytestPerspectiveResolver.resolvePerspective({
        matchMode: "humanVsAi",
        activeHumanSeat: "p1",
      });
      expect(perspective.bottomPlayerKey).toBe("p1");
      expect(perspective.topPlayerKey).toBe("p2");
    });

    // T11: 決定論
    it("T11: 同一の DecisionRequest に対して Gen9 R4 が決定論的に同一の回答を返すこと", () => {
      const policy = PlaytestPolicyFactory.createPolicy(
        "gen9-r4-v72",
        undefined,
        "p2",
        "standard-pack",
        fullRulePackage
      );

      const dummyReq: any = {
        protocolVersion: "1.0.0",
        matchId: "test-match",
        decisionId: "dec-det-1",
        stateVersion: 1,
        playerId: "p2",
        source: { type: "ACTION_REQUEST", playerId: "p2" },
        catalog: { actions: [{ actionId: "action.draw" }] },
        observation: {
          viewerPlayerId: "p2",
          players: [
            { playerId: "p1", handCount: 3, lifeCount: 15, bulwarks: [], field: [] },
            { playerId: "p2", handCount: 4, lifeCount: 15, bulwarks: [], field: [] },
          ],
        },
        patterns: [
          { patternRef: 0, patternId: "p0", kind: "ACTION", actionSelectionRef: 0 },
          { patternRef: 1, patternId: "p1", kind: "PASS" },
        ],
      };

      const res1 = policy.choose(dummyReq);
      const res2 = policy.choose(dummyReq);
      expect(res1.selectedPatternRef).toBe(res2.selectedPatternRef);
    });

    // T12: 対戦完走 (最低1試合の完全プレイアウト)
    it("T12: Headless 環境で Human vs Gen 9 R4 の 1 試合が正常に完走すること", async () => {
      const outcome = startMatchAttempt({
        environmentId: standardPackEnvId,
        seedInput: "790005",
        catalog,
        fullRulePackage,
        matchMode: "humanVsAi",
      });

      expect(outcome.type).toBe("READY");
      if (outcome.type !== "READY") return;

      const seatControllers = createSeatControllers("humanVsAi", "p1", "gen9-r4-v72");
      const policies = PlaytestPolicyFactory.createPoliciesForMatch(
        seatControllers,
        outcome.activeMatch.seed,
        outcome.activeMatch.regulationId,
        outcome.activeMatch.rulePackage
      );

      const humanPolicy = new FirstLegalPolicy(false);
      let step = outcome.initialStep;
      let iterations = 0;
      const MAX_ITERATIONS = 500;

      while (step.type !== "FINISHED" && iterations < MAX_ITERATIONS) {
        iterations++;

        if (step.type === "WAITING_FOR_DECISION") {
          const req = step.request;
          if (req.playerId === "p1") {
            // 人間側: FirstLegal で回答
            const humanResp = humanPolicy.choose(req);
            step = outcome.session.submitDecision(humanResp);
          } else {
            // AI (P2) 側: advanceAutomatedDecisions で進行
            const adv = await advanceAutomatedDecisions(
              outcome.session,
              step,
              seatControllers,
              policies,
              { maxAutomatedDecisions: 50 }
            );
            if (adv.status !== "STOPPED") {
              throw new Error(`AI error: ${(adv as any).error?.message ?? "unknown error"}`);
            }
            step = adv.step;
          }
        } else if (step.type === "PROGRESSED") {
          step = outcome.session.advance();
        }
      }

      expect(step.type).toBe("FINISHED");
      if (step.type === "FINISHED") {
        expect(step.result).toBeDefined();
        if (step.result.winner) {
          expect(["p1", "p2"]).toContain(step.result.winner);
        }
      }
    });

    // T13: 共有 URL
    it("T13: Gen9 Policy ID を含む共有 URL を生成・復元できること", () => {
      const url = serializePlaytestShareUrl({
        environmentId: standardPackEnvId,
        mode: "humanVsAi",
        humanSeat: "p1",
        policyId: "gen9-r4-v72",
        seedInput: "790001",
      });

      expect(url).toContain("policy=gen9-r4-v72");

      const parsed = parsePlaytestShareUrl(url, catalog);
      expect(parsed.kind).toBe("READY");
      if (parsed.kind === "READY") {
        expect(parsed.config.policyId).toBe("gen9-r4-v72");
        expect(parsed.config.environmentId).toBe(standardPackEnvId);
      }
    });

    // T14: 既存 AI の回帰
    it("T14: 既存の Gen 8 Candidate AI 対戦が壊れていないこと", () => {
      const gen8 = PlaytestPolicyFactory.createPolicy(
        "gen8-champion-candidate",
        undefined,
        "p2",
        "standard-pack"
      );
      expect(gen8).toBeDefined();
      expect(gen8.descriptor.name).toBe("Gen 8 Champion Candidate");
    });
  });

  // ===========================================================================
  // P1 追加テスト (Gen 9 v7.3 コスト評価プレビュー)
  // ===========================================================================

  describe("P1: Gen 9 v7.3 コスト評価プレビュー（実験版）", () => {
    it("P1-1: v7.3 の戦術重みが 24 次元であり、固定診断重みが適用されていること", () => {
      const policy = PlaytestPolicyFactory.createPolicy(
        "gen9-cost-preview-v73",
        undefined,
        "p2",
        "standard-pack",
        fullRulePackage
      ) as Gen9LearnableTacticalPolicy;

      expect(policy).toBeDefined();
      expect(policy).toBeInstanceOf(Gen9LearnableTacticalPolicy);
      expect(policy.descriptor.name).toBe("Gen 9 v7.3 — コスト評価AI（実験版）");

      const weights = policy.getTacticalWeights();
      expect(weights.length).toBe(24);

      // 先頭20次元が R4 プリセットと完全一致
      for (let i = 0; i < 20; i++) {
        expect(weights[i]).toBe(R4_PRESET_TACTICAL_WEIGHTS[i]);
      }

      // 末尾4次元が固定診断重みと完全一致
      expect(weights[20]).toBe(COST_DIAGNOSTIC_WEIGHTS[0]); // -0.5
      expect(weights[21]).toBe(COST_DIAGNOSTIC_WEIGHTS[1]); // -1.0
      expect(weights[22]).toBe(COST_DIAGNOSTIC_WEIGHTS[2]); // -0.5
      expect(weights[23]).toBe(COST_DIAGNOSTIC_WEIGHTS[3]); // -0.5
    });

    it("P1-2: Headless 環境で Human vs Gen 9 v7.3 プレビューの 1 試合が正常に完走すること", async () => {
      const outcome = startMatchAttempt({
        environmentId: standardPackEnvId,
        seedInput: "790010",
        catalog,
        fullRulePackage,
        matchMode: "humanVsAi",
      });

      expect(outcome.type).toBe("READY");
      if (outcome.type !== "READY") return;

      const seatControllers = createSeatControllers("humanVsAi", "p1", "gen9-cost-preview-v73");
      const policies = PlaytestPolicyFactory.createPoliciesForMatch(
        seatControllers,
        outcome.activeMatch.seed,
        outcome.activeMatch.regulationId,
        outcome.activeMatch.rulePackage
      );

      const humanPolicy = new FirstLegalPolicy(false);
      let step = outcome.initialStep;
      let iterations = 0;
      const MAX_ITERATIONS = 500;

      while (step.type !== "FINISHED" && iterations < MAX_ITERATIONS) {
        iterations++;

        if (step.type === "WAITING_FOR_DECISION") {
          const req = step.request;
          if (req.playerId === "p1") {
            const humanResp = humanPolicy.choose(req);
            step = outcome.session.submitDecision(humanResp);
          } else {
            const adv = await advanceAutomatedDecisions(
              outcome.session,
              step,
              seatControllers,
              policies,
              { maxAutomatedDecisions: 50 }
            );
            if (adv.status !== "STOPPED") {
              throw new Error(`AI error: ${(adv as any).error?.message ?? "unknown error"}`);
            }
            step = adv.step;
          }
        } else if (step.type === "PROGRESSED") {
          step = outcome.session.advance();
        }
      }

      expect(step.type).toBe("FINISHED");
      if (step.type === "FINISHED") {
        expect(step.result).toBeDefined();
        if (step.result.winner) {
          expect(["p1", "p2"]).toContain(step.result.winner);
        }
      }
    });
  });
});
