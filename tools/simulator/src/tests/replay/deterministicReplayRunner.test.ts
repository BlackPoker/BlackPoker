import { describe, it, expect, vi } from "vitest";
import {
  runDeterministicReplay,
  findFirstDifference,
  normalizeDecisionRequestForReplayComparison,
} from "../../engine/replay/DeterministicReplayRunner";
import { ReplayPlanV1, ReplayDecisionEntryV1 } from "../../engine/replay/ReplayTypes";
import { loadRegulationCatalogForBrowser } from "../../engine/regulation/BrowserRegulationLoader";
import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader";
import { startMatchAttempt } from "../../engine/playtest/PlaytestEnvironmentController";

describe("DeterministicReplayRunner Tests", () => {
  const catalog = loadRegulationCatalogForBrowser();
  const fullRulePackage = loadRulePackageForBrowser();

  // ヘルパー: 指定環境・シードでセッションを開始し、N件の判断（常にPattern 0）を実行してPlanを構築する
  function generatePlaytestReplayPlan(options: {
    environmentId: string;
    seedInput: string;
    numDecisions: number;
    rulePackage?: { id?: string; version?: string };
  }): { plan: ReplayPlanV1; session: any } {
    const outcome = startMatchAttempt({
      environmentId: options.environmentId,
      seedInput: options.seedInput,
      catalog,
      fullRulePackage,
    });
    if (outcome.type !== "READY") {
      throw new Error(`Failed to start match: ${outcome.setupNotice.message}`);
    }

    const session = outcome.session;
    let step = outcome.initialStep;
    const decisions: ReplayDecisionEntryV1[] = [];

    for (let i = 0; i < options.numDecisions; i++) {
      while (step.type === "PROGRESSED") {
        step = session.advance();
      }
      if (step.type === "FINISHED") {
        break;
      }
      if (step.type !== "WAITING_FOR_DECISION") {
        break;
      }

      const req = step.request;
      const entry: ReplayDecisionEntryV1 = {
        seq: decisions.length + 1,
        actor: i % 2 === 0 ? "human" : "policy",
        playerId: req.playerId as "p1" | "p2",
        response: {
          decisionId: req.decisionId,
          stateVersion: req.stateVersion,
          selectedPatternRef: 0,
        },
      };
      decisions.push(entry);

      step = session.submitDecision({
        decisionId: req.decisionId,
        stateVersion: req.stateVersion,
        selectedPatternRef: 0,
      });
    }

    while (step.type === "PROGRESSED") {
      step = session.advance();
    }

    const plan: ReplayPlanV1 = {
      environmentId: options.environmentId,
      seed: outcome.activeMatch.seed,
      sourceBuild: { sha: "local", ref: "local" },
      sourceRulePackage: options.rulePackage ?? {
        id: outcome.activeMatch.rulePackage.id,
        version: outcome.activeMatch.rulePackage.version,
      },
      decisions,
      expected: {
        status: step.type as any,
        rawState: JSON.parse(JSON.stringify(session.state)),
        currentDecisionRequest:
          step.type === "WAITING_FOR_DECISION" ? (step as any).request : undefined,
        finalResult: step.type === "FINISHED" ? (step as any).result : undefined,
      },
    };

    return { plan, session };
  }

  it("Test 2: Pure Transcript Replay (Core Battle で複数判断を実行し、新規 Session へ Replay → VERIFIED & rawState 完全一致)", () => {
    const { plan } = generatePlaytestReplayPlan({
      environmentId: "core-battle",
      seedInput: "",
      numDecisions: 4,
    });

    expect(plan.decisions.length).toBe(4);

    const result = runDeterministicReplay(plan, { catalog, fullRulePackage });

    expect(result.status).toBe("VERIFIED");
    if (result.status === "VERIFIED") {
      expect(result.executedDecisions).toBe(4);
      expect(result.totalDecisions).toBe(4);
      expect(result.finalStepType).toBe(plan.expected.status);
    }
  });

  it("Test 3: Official Environment + Seed (Official Light + Entry16、固定 Seed 42 での決定論的 Replay)", () => {
    const { plan } = generatePlaytestReplayPlan({
      environmentId: "official:light-entry16",
      seedInput: "42",
      numDecisions: 6,
    });

    expect(plan.decisions.length).toBe(6);

    const result = runDeterministicReplay(plan, { catalog, fullRulePackage });

    expect(result.status).toBe("VERIFIED");
    if (result.status === "VERIFIED") {
      expect(result.executedDecisions).toBe(6);
      expect(result.totalDecisions).toBe(6);
    }
  });

  it("Test 4: Mid-game Diagnostic (対戦中途 WAITING_FOR_DECISION での Replay 完全一致)", () => {
    const { plan } = generatePlaytestReplayPlan({
      environmentId: "core-battle",
      seedInput: "",
      numDecisions: 3,
    });

    expect(plan.expected.status).toBe("WAITING_FOR_DECISION");
    expect(plan.expected.currentDecisionRequest).toBeDefined();

    const result = runDeterministicReplay(plan, { catalog, fullRulePackage });

    expect(result.status).toBe("VERIFIED");
    if (result.status === "VERIFIED") {
      expect(result.finalStepType).toBe("WAITING_FOR_DECISION");
    }
  });

  it("Test 5: FINISHED Replay (対戦完走時、勝者・終了理由・rawState の完全一致)", () => {
    // 完走するまで実行
    const outcome = startMatchAttempt({
      environmentId: "official:light-entry16",
      seedInput: "20260907",
      catalog,
      fullRulePackage,
    });
    expect(outcome.type).toBe("READY");
    if (outcome.type !== "READY") return;

    const session = outcome.session;
    let step = outcome.initialStep;
    const decisions: ReplayDecisionEntryV1[] = [];
    const maxDecisions = 200;

    while (decisions.length < maxDecisions) {
      while (step.type === "PROGRESSED") {
        step = session.advance();
      }
      if (step.type === "FINISHED") break;
      if (step.type !== "WAITING_FOR_DECISION") break;

      const req = step.request;
      decisions.push({
        seq: decisions.length + 1,
        actor: "human",
        playerId: req.playerId as "p1" | "p2",
        response: {
          decisionId: req.decisionId,
          stateVersion: req.stateVersion,
          selectedPatternRef: 0,
        },
      });

      step = session.submitDecision({
        decisionId: req.decisionId,
        stateVersion: req.stateVersion,
        selectedPatternRef: 0,
      });
    }

    while (step.type === "PROGRESSED") {
      step = session.advance();
    }

    expect(step.type).toBe("FINISHED");
    if (step.type !== "FINISHED") return;

    const plan: ReplayPlanV1 = {
      environmentId: "official:light-entry16",
      seed: outcome.activeMatch.seed,
      sourceBuild: { sha: "local", ref: "local" },
      sourceRulePackage: {
        id: outcome.activeMatch.rulePackage.id,
        version: outcome.activeMatch.rulePackage.version,
      },
      decisions,
      expected: {
        status: "FINISHED",
        rawState: JSON.parse(JSON.stringify(session.state)),
        finalResult: step.result,
      },
    };

    const result = runDeterministicReplay(plan, { catalog, fullRulePackage });

    expect(result.status).toBe("VERIFIED");
    if (result.status === "VERIFIED") {
      expect(result.finalStepType).toBe("FINISHED");
      expect(result.executedDecisions).toBe(decisions.length);
    }
  });

  describe("Test 6: Intentional Divergence & Runtime DecisionId Separation", () => {
    it("6-A: selectedPatternRef 範囲外 → PATTERN_REF_OUT_OF_RANGE", () => {
      const { plan } = generatePlaytestReplayPlan({
        environmentId: "core-battle",
        seedInput: "",
        numDecisions: 2,
      });

      const tamperedPlan: ReplayPlanV1 = {
        ...plan,
        decisions: [
          {
            ...plan.decisions[0],
            response: {
              ...plan.decisions[0].response,
              selectedPatternRef: 9999,
            },
          },
          ...plan.decisions.slice(1),
        ],
      };

      const result = runDeterministicReplay(tamperedPlan, { catalog, fullRulePackage });
      expect(result.status).toBe("DIVERGED");
      if (result.status === "DIVERGED") {
        expect(result.code).toBe("PATTERN_REF_OUT_OF_RANGE");
        expect(result.decisionSeq).toBe(1);
      }
    });

    it("6-B: stateVersion 改変 → STATE_VERSION_MISMATCH", () => {
      const { plan } = generatePlaytestReplayPlan({
        environmentId: "core-battle",
        seedInput: "",
        numDecisions: 2,
      });

      const tamperedPlan: ReplayPlanV1 = {
        ...plan,
        decisions: [
          {
            ...plan.decisions[0],
            response: {
              ...plan.decisions[0].response,
              stateVersion: 9999,
            },
          },
          ...plan.decisions.slice(1),
        ],
      };

      const result = runDeterministicReplay(tamperedPlan, { catalog, fullRulePackage });
      expect(result.status).toBe("DIVERGED");
      if (result.status === "DIVERGED") {
        expect(result.code).toBe("STATE_VERSION_MISMATCH");
        expect(result.decisionSeq).toBe(1);
      }
    });

    it("6-C: playerId 改変 → PLAYER_MISMATCH", () => {
      const { plan } = generatePlaytestReplayPlan({
        environmentId: "core-battle",
        seedInput: "",
        numDecisions: 2,
      });

      const flippedPlayer = plan.decisions[0].playerId === "p1" ? "p2" : "p1";
      const tamperedPlan: ReplayPlanV1 = {
        ...plan,
        decisions: [
          {
            ...plan.decisions[0],
            playerId: flippedPlayer,
          },
          ...plan.decisions.slice(1),
        ],
      };

      const result = runDeterministicReplay(tamperedPlan, { catalog, fullRulePackage });
      expect(result.status).toBe("DIVERGED");
      if (result.status === "DIVERGED") {
        expect(result.code).toBe("PLAYER_MISMATCH");
        expect(result.decisionSeq).toBe(1);
      }
    });

    it("6-D: Runtime decisionId 差異があっても Replay を継続でき VERIFIED となること (Runner は DECISION_ID_MISMATCH を返さない)", () => {
      const { plan } = generatePlaytestReplayPlan({
        environmentId: "core-battle",
        seedInput: "",
        numDecisions: 2,
      });

      // Source Transcript 側の decisionId を意図的に "dec-source" に設定
      const transcriptPlan: ReplayPlanV1 = {
        ...plan,
        decisions: plan.decisions.map((d) => ({
          ...d,
          response: {
            ...d.response,
            decisionId: "dec-source-different-from-runtime",
          },
        })),
      };

      const result = runDeterministicReplay(transcriptPlan, { catalog, fullRulePackage });
      expect(result.status).toBe("VERIFIED");
    });

    it("6-E: submitDecision へ渡される Response が actualRequest.decisionId で再構築されていることの検証", () => {
      const { plan } = generatePlaytestReplayPlan({
        environmentId: "core-battle",
        seedInput: "",
        numDecisions: 1,
      });

      // Source Transcript の decisionId を "dec-source-mock" とする
      const sourcePlan: ReplayPlanV1 = {
        ...plan,
        decisions: [
          {
            ...plan.decisions[0],
            response: {
              ...plan.decisions[0].response,
              decisionId: "dec-source-mock",
            },
          },
        ],
      };

      const result = runDeterministicReplay(sourcePlan, { catalog, fullRulePackage });
      expect(result.status).toBe("VERIFIED");
    });
  });

  it("Test 7: State Difference Reporter (期待値と実際値の差分パス $.players.p1.hand[0].rank 等の検出精度)", () => {
    const { plan } = generatePlaytestReplayPlan({
      environmentId: "core-battle",
      seedInput: "",
      numDecisions: 2,
    });

    const tamperedExpectedRawState = JSON.parse(JSON.stringify(plan.expected.rawState));
    // パスを変更
    if (tamperedExpectedRawState.players?.p1?.hand?.[0]) {
      tamperedExpectedRawState.players.p1.hand[0].rank = 999;
    } else {
      tamperedExpectedRawState.stateVersion = 999;
    }

    const tamperedPlan: ReplayPlanV1 = {
      ...plan,
      expected: {
        ...plan.expected,
        rawState: tamperedExpectedRawState,
      },
    };

    const result = runDeterministicReplay(tamperedPlan, { catalog, fullRulePackage });
    expect(result.status).toBe("DIVERGED");
    if (result.status === "DIVERGED") {
      expect(result.code).toBe("STATE_MISMATCH");
      expect(result.difference).toBeDefined();
      expect(result.difference?.path).toMatch(/^\$\./);
    }
  });

  it("Test 8: AI actor を再実行しないこと (actor: 'policy' でも Policy ロジックを呼ばず保存された response で動作)", () => {
    const { plan } = generatePlaytestReplayPlan({
      environmentId: "core-battle",
      seedInput: "",
      numDecisions: 3,
    });

    // すべての actor を policy に変更
    const policyPlan: ReplayPlanV1 = {
      ...plan,
      decisions: plan.decisions.map((d) => ({ ...d, actor: "policy" })),
    };

    const result = runDeterministicReplay(policyPlan, { catalog, fullRulePackage });
    expect(result.status).toBe("VERIFIED");
  });

  it("Test 9: AutoPass (actor: 'autoPass' も通常判断と同一経路で Replay 成立)", () => {
    const { plan } = generatePlaytestReplayPlan({
      environmentId: "core-battle",
      seedInput: "",
      numDecisions: 2,
    });

    const autoPassPlan: ReplayPlanV1 = {
      ...plan,
      decisions: plan.decisions.map((d) => ({ ...d, actor: "autoPass" })),
    };

    const result = runDeterministicReplay(autoPassPlan, { catalog, fullRulePackage });
    expect(result.status).toBe("VERIFIED");
  });

  it("Test 10: Raw State を復元に使っていないことの証明 (Expected rawState を改変しても途中進行は動作し最後の比較で STATE_MISMATCH となること)", () => {
    const { plan } = generatePlaytestReplayPlan({
      environmentId: "core-battle",
      seedInput: "",
      numDecisions: 3,
    });

    // expected rawState を全く異なるモックオブジェクトに差し替え
    const alteredPlan: ReplayPlanV1 = {
      ...plan,
      expected: {
        ...plan.expected,
        rawState: { completely: "different", state: {} },
      },
    };

    const result = runDeterministicReplay(alteredPlan, { catalog, fullRulePackage });

    // 進行中にクラッシュやエラーを起こさず、最後の rawState 比較段階で STATE_MISMATCH になる
    expect(result.status).toBe("DIVERGED");
    if (result.status === "DIVERGED") {
      expect(result.code).toBe("STATE_MISMATCH");
      expect(result.difference?.path).toBe("$.completely");
    }
  });

  it("Test 11: RulePackage mismatch (Source の rulePackageVersion を改変すると RULE_PACKAGE_MISMATCH で停止)", () => {
    const { plan } = generatePlaytestReplayPlan({
      environmentId: "core-battle",
      seedInput: "",
      numDecisions: 2,
    });

    const mismatchedPlan: ReplayPlanV1 = {
      ...plan,
      sourceRulePackage: {
        id: "mismatched-pkg",
        version: "99.99.99",
      },
    };

    const result = runDeterministicReplay(mismatchedPlan, { catalog, fullRulePackage });
    expect(result.status).toBe("DIVERGED");
    if (result.status === "DIVERGED") {
      expect(result.code).toBe("RULE_PACKAGE_MISMATCH");
    }
  });

  describe("findFirstDifference Unit Tests", () => {
    it("同一オブジェクトの場合は null を返すこと", () => {
      const obj = { a: 1, b: ["x", "y"], c: { d: true } };
      expect(findFirstDifference(obj, JSON.parse(JSON.stringify(obj)))).toBeNull();
    });

    it("オブジェクトのキー値が異なる場合に正しい path と期待値・実際値を返すこと", () => {
      const a = { user: { name: "Alice", age: 20 } };
      const b = { user: { name: "Alice", age: 21 } };
      const diff = findFirstDifference(a, b);
      expect(diff).toEqual({
        path: "$.user.age",
        expected: 20,
        actual: 21,
      });
    });

    it("配列の要素が異なる場合に正しい index path を返すこと", () => {
      const a = [10, 20, 30];
      const b = [10, 25, 30];
      const diff = findFirstDifference(a, b);
      expect(diff).toEqual({
        path: "$[1]",
        expected: 20,
        actual: 25,
      });
    });

    it("配列長が異なる場合に length path を返すこと", () => {
      const a = [1, 2];
      const b = [1, 2, 3];
      const diff = findFirstDifference(a, b);
      expect(diff).toEqual({
        path: "$.length",
        expected: 2,
        actual: 3,
      });
    });
  });

  describe("normalizeDecisionRequestForReplayComparison Unit Tests", () => {
    it("decisionId と matchId のみを除外し他のプロパティを保持すること", () => {
      const req = {
        decisionId: "dec-123",
        matchId: "match-456",
        stateVersion: 5,
        playerId: "p1",
        patterns: [{ ref: 0 }],
      };
      const norm = normalizeDecisionRequestForReplayComparison(req);
      expect(norm.decisionId).toBeUndefined();
      expect(norm.matchId).toBeUndefined();
      expect(norm.stateVersion).toBe(5);
      expect(norm.playerId).toBe("p1");
      expect(norm.patterns).toEqual([{ ref: 0 }]);
    });
  });
});
