/**
 * BlackPoker Work 3-6 R3 — Core ストリーミング実体化失敗 E2E 実機検証テスト
 *
 * 【検証目的】
 * 1. 診断用局面 (本番 Holdout Seeds 95001〜95030 は一切不使用) において、
 *    ストリーミング合法手 (blockAssignmentStream) の Core 事前実体化失敗を実機で発生させる。
 * 2. GameSession.submitDecision() が PatternInstantiationError を送出し、
 *    instantiationFailuresCount が正確に +1 増加すること。
 * 3. 例外発生前後で GameState, StateHash, StateVersion, MatchLog が完全不変 (Fail-Closed) であること。
 * 4. SimulationRunner -> EvolutionIndependentEvaluator -> executeHoldoutEvaluation -> auditHoldoutArtifacts
 *    の全パイプラインにおいて、二重計上なく実体化失敗件数が伝播し、
 *    最終的に INVALID_EVIDENCE かつ IMPROVEMENT_UNVERIFIED と判定されることを実証する。
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage } from "../../domain/rules/RulePackage";
import { DecisionRequest } from "../../domain/decision/DecisionRequest";
import { GameSession, PatternInstantiationError } from "../../engine/session/GameSession";
import { StateHasher } from "../../engine/simulation/StateHasher";
import { SimulationRunner } from "../../engine/simulation/SimulationRunner";
import { FirstLegalPolicy } from "../../engine/simulation/DecisionPolicy";
import { DecisionDNACodec } from "../../engine/ai/DecisionDNACodec";
import { EvolutionIndependentEvaluator } from "../../engine/ai/EvolutionIndependentEvaluator";
import {
  SMOKE_DIAGNOSTIC_SEEDS,
  buildHoldoutPreflightManifest,
  executeHoldoutEvaluation,
  saveHoldoutArtifacts,
  auditHoldoutArtifacts,
  createZeroDNA,
} from "../../cli/stage3HoldoutRunner";

describe("Core ストリーミング実体化失敗 E2E 実機検証 (Work 3-6 R3)", () => {
  let rulePackage: RulePackage;
  const tmpDir = path.join(os.tmpdir(), "test-stage3-instantiation-failure-e2e-temp");

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const getReq = (step: any): DecisionRequest => {
    if (!step || step.type !== "WAITING_FOR_DECISION" || !step.request) {
      throw new Error(`Expected WAITING_FOR_DECISION step with request, got: ${JSON.stringify(step)}`);
    }
    return step.request as DecisionRequest;
  };

  /**
   * ストリーミングブロック割り当て (3 アタッカー × 5 一般兵ブロッカー = 1024 パターン > 256) の
   * WAITING_FOR_DECISION 局面に到達した GameSession を生成するヘルパー
   */
  function createStreamingBlockSession(): { session: GameSession; blockReq: DecisionRequest } {
    const attackers = [
      {
        unitId: "soldier-a0",
        kind: "一般兵",
        componentId: "character.soldier",
        state: "charge",
        cards: [{ id: "ca0", suit: "S", rank: "8", value: 8 }],
        labels: ["攻撃", "防御"],
      },
      {
        unitId: "soldier-a1",
        kind: "一般兵",
        componentId: "character.soldier",
        state: "charge",
        cards: [{ id: "ca1", suit: "H", rank: "6", value: 6 }],
        labels: ["攻撃", "防御"],
      },
      {
        unitId: "soldier-a2",
        kind: "一般兵",
        componentId: "character.soldier",
        state: "charge",
        cards: [{ id: "ca2", suit: "D", rank: "4", value: 4 }],
        labels: ["攻撃", "防御"],
      },
    ];

    const defenders = Array.from({ length: 5 }, (_, i) => ({
      unitId: `soldier-d${i}`,
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: `cd${i}`, suit: "C", rank: "5", value: 5 }],
      labels: ["防御", "攻撃"],
    }));

    const state: any = {
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          name: "Player 1",
          life: [
            { id: "l1-1", suit: "S", rank: "A", value: 1 },
            { id: "l1-2", suit: "H", rank: "2", value: 2 },
          ],
          hand: [
            { id: "key-s8", suit: "S", rank: "8", value: 8 },
            { id: "cost-c2", suit: "C", rank: "2", value: 2 },
          ],
          field: attackers,
          graveyard: [],
        },
        p2: {
          name: "Player 2",
          life: [
            { id: "l2-1", suit: "D", rank: "K", value: 13 },
            { id: "l2-2", suit: "C", rank: "Q", value: 12 },
          ],
          hand: [],
          field: defenders,
          graveyard: [],
        },
      },
      stage: { requests: [], history: [] },
      requestBuffer: { requests: [], history: [] },
    };

    const session = new GameSession(state, rulePackage);

    // 1. p1 が attack を宣言
    const req1 = getReq(session.advance());
    const atkRef = req1.patterns.findIndex((p: any) => {
      const act = req1.catalog.actions[p.actionSelectionRef!];
      return act?.actionId === "action.attack";
    });
    session.submitDecision({
      decisionId: req1.decisionId,
      stateVersion: req1.stateVersion,
      selectedPatternRef: atkRef,
    });

    // 2. p1 PASS
    const req2 = getReq(session.advance());
    session.submitDecision({
      decisionId: req2.decisionId,
      stateVersion: req2.stateVersion,
      selectedPatternRef: req2.patterns.findIndex((p: any) => p.kind === "PASS"),
    });

    // 3. p2 PASS -> attack 解決開始
    const req3 = getReq(session.advance());
    const step4 = session.submitDecision({
      decisionId: req3.decisionId,
      stateVersion: req3.stateVersion,
      selectedPatternRef: req3.patterns.findIndex((p: any) => p.kind === "PASS"),
    });

    // 4. 3体全アタックを選択
    const req4 = getReq(step4);
    const multiAtkRef = req4.patterns.findIndex((p) => {
      const eff = req4.catalog.effectSelections[p.effectSelectionRef!];
      return eff.selectedValues?.length === 3;
    });
    session.submitDecision({
      decisionId: req4.decisionId,
      stateVersion: req4.stateVersion,
      selectedPatternRef: multiAtkRef,
    });

    // 5. 双方が PASS して action.block の EFFECT_RESOLUTION (ストリーミング意思決定) に到達させる
    let currentStep = session.advance();
    while (
      currentStep.type === "WAITING_FOR_DECISION" &&
      (currentStep as any).request?.source.type === "ACTION_REQUEST"
    ) {
      const req = (currentStep as any).request;
      const passIdx = req.patterns.findIndex((p: any) => p.kind === "PASS");
      currentStep = session.submitDecision({
        decisionId: req.decisionId,
        stateVersion: req.stateVersion,
        selectedPatternRef: passIdx !== -1 ? passIdx : 0,
      });
      if (currentStep.type !== "WAITING_FOR_DECISION") {
        currentStep = session.advance();
      }
    }

    const blockReq = getReq(currentStep);
    expect(blockReq.blockAssignmentStream).toBeDefined();
    expect(blockReq.blockAssignmentStream!.patternCount).toBe(1024);
    expect(blockReq.patterns.length).toBe(0);

    return { session, blockReq };
  }

  it("1. GameSession 単体: ストリーミング実体化失敗時に PatternInstantiationError を送出し、GameState・StateVersion・MatchLog が不変であること", () => {
    const { session, blockReq } = createStreamingBlockSession();

    expect(session.instantiationFailuresCount).toBe(0);

    // 失敗発生前の状態を記録
    const preStateHash = StateHasher.hash(session.state);
    const preStateJson = JSON.stringify(session.state);
    const preStateVersion = session.stateVersion;
    const preLogEventsCount = session.getMatchLog().events.length;

    // ストリーミング実体化が失敗するように差し替え
    (blockReq.blockAssignmentStream as any).instantiatePatternAt = () => undefined;

    let caughtError: unknown;
    try {
      session.submitDecision({
        decisionId: blockReq.decisionId,
        stateVersion: blockReq.stateVersion,
        selectedPatternRef: 42,
      });
    } catch (err) {
      caughtError = err;
    }

    // 1. PatternInstantiationError が送出されること
    expect(caughtError).toBeInstanceOf(PatternInstantiationError);
    expect((caughtError as PatternInstantiationError).name).toBe("PatternInstantiationError");
    expect((caughtError as PatternInstantiationError).selectedPatternRef).toBe(42);
    expect((caughtError as PatternInstantiationError).streamPatternCount).toBe(1024);

    // 2. instantiationFailuresCount が正確に 1 増加すること
    expect(session.instantiationFailuresCount).toBe(1);

    // 3. GameState, StateHash, StateVersion, MatchLog が一切変更・汚染されていないこと (Fail-Closed)
    expect(StateHasher.hash(session.state)).toBe(preStateHash);
    expect(JSON.stringify(session.state)).toBe(preStateJson);
    expect(session.stateVersion).toBe(preStateVersion);
    expect(session.getMatchLog().events.length).toBe(preLogEventsCount);
    expect(session.pendingDecision).toBe(blockReq);
  });

  it("2. SimulationRunner 経由: 実体化失敗時に例外が伝播し、二重計上なく instantiationFailuresCount === 1 であること", () => {
    const { session, blockReq } = createStreamingBlockSession();

    // ストリーミング実体化失敗を注入
    (blockReq.blockAssignmentStream as any).instantiatePatternAt = () => undefined;

    const preStateHash = StateHasher.hash(session.state);
    const preStateVersion = session.stateVersion;

    expect(() =>
      SimulationRunner.run(session, {
        p1: new FirstLegalPolicy(false),
        p2: new FirstLegalPolicy(false),
      })
    ).toThrow(PatternInstantiationError);

    // 二重計上ゼロで 1 件のみカウントされていること
    expect(session.instantiationFailuresCount).toBe(1);
    expect(StateHasher.hash(session.state)).toBe(preStateHash);
    expect(session.stateVersion).toBe(preStateVersion);
  });

  it("3. EvolutionIndependentEvaluator & Holdout Runner E2E: 実体化失敗が伝播し、二重計上ゼロで INVALID_EVIDENCE / IMPROVEMENT_UNVERIFIED となり監査でも FAIL すること", () => {
    const candidateDNA = DecisionDNACodec.createZeroDecisionDNA({
      id: "diag-cand-dna",
      name: "DiagCandidate",
    });
    (candidateDNA.patternWeights as number[])[0] = 0.25;

    const oldChampionDNA = DecisionDNACodec.createZeroDecisionDNA({
      id: "diag-old-champ-dna",
      name: "DiagOldChampion",
    });
    (oldChampionDNA.patternWeights as number[])[0] = 0.1;

    const zeroDNA = createZeroDNA();

    const preflightManifest = buildHoldoutPreflightManifest({
      candidateDNA,
      candidateSourcePath: "diag-cand.json",
      oldChampionDNA,
      oldChampionSourcePath: "diag-old.json",
      zeroDNA,
      seeds: SMOKE_DIAGNOSTIC_SEEDS, // 診断用 2 Seeds (99951, 99952) × 4 Opponents × 2 Legs = 16 Matches
      executionMode: "SMOKE",
      artifactsDir: tmpDir,
      gitInfo: { isClean: true, headCommitSha: "diag-sha" },
      maxDecisionsPerMatch: 500,
    });

    // matchIndex === 0 (pairIndex=0, legIndex=0) のみストリーミング実体化失敗を起こすセッションを返し、
    // 他の 15 試合は正常終了するセッションを返すカスタム sessionFactory
    const customSessionFactory = (ctx: any): GameSession => {
      if (ctx.matchIndex === 0) {
        const { session, blockReq } = createStreamingBlockSession();
        (blockReq.blockAssignmentStream as any).instantiatePatternAt = () => undefined;
        return session;
      }

      // 他の試合は即座に p1 勝利で正常終了する軽量セッション
      const fastFinishSession: any = {
        state: {
          turnCount: 3,
          turnPlayer: "p1",
          chancePlayer: "p1",
          players: {
            p1: { life: [{ id: "l1" }], hand: [], field: [], graveyard: [] },
            p2: { life: [], hand: [], field: [], graveyard: [] },
          },
          stage: { requests: [], history: [] },
          requestBuffer: { requests: [], history: [] },
        },
        stateVersion: 1,
        instantiationFailuresCount: 0,
        passTracker: { consecutivePassCount: 0 },
        advance: () => ({
          type: "FINISHED",
          result: { winner: "p1", reason: "diagnostic_fast_finish" },
        }),
        submitDecision: () => ({
          type: "FINISHED",
          result: { winner: "p1", reason: "diagnostic_fast_finish" },
        }),
        getMatchLog: () => ({ events: [] }),
      };
      return fastFinishSession as GameSession;
    };

    const output = executeHoldoutEvaluation({
      candidateDNA,
      oldChampionDNA,
      zeroDNA,
      seeds: SMOKE_DIAGNOSTIC_SEEDS,
      preflightManifest,
      sessionFactory: customSessionFactory,
      maxDecisionsPerMatch: 500,
      expectedOldChampionDigest: EvolutionIndependentEvaluator.computeDnaDigest(oldChampionDNA),
    });

    // 1. 全体集計の検証 (16 試合中 1 試合のみ失敗、実体化失敗は二重計上なしの 1 件)
    expect(output.totalMatches).toBe(16);
    expect(output.failedMatches).toBe(1);
    expect(output.completedMatches).toBe(15);
    expect(output.totalInstantiationFailures).toBe(1);

    // 2. 失敗した Leg 0 (matchIndex === 0) の検証
    const leg0 = output.allIndividualOutcomes.find((m) => m.matchIndex === 0);
    expect(leg0).toBeDefined();
    expect(leg0!.failed).toBe(true);
    expect(leg0!.completed).toBe(false);
    expect(leg0!.instantiationFailures).toBe(1);
    expect(leg0!.reason).toContain("事前実体化に失敗");

    // 3. 他の 15 試合はすべて completed=true, instantiationFailures=0
    const otherLegs = output.allIndividualOutcomes.filter((m) => m.matchIndex !== 0);
    expect(otherLegs.length).toBe(15);
    for (const m of otherLegs) {
      expect(m.completed).toBe(true);
      expect(m.failed).toBe(false);
      expect(m.instantiationFailures).toBe(0);
    }

    // 4. 評価結果・認定ステータスが INVALID_EVIDENCE かつ IMPROVEMENT_UNVERIFIED になること
    expect(output.evaluationResult.evidenceStatus).toBe("INVALID_EVIDENCE");
    expect(output.evaluationResult.improvementStatus).toBe("IMPROVEMENT_UNVERIFIED");
    expect(output.certificationStatus).toBe("INVALID_EVIDENCE");
    expect(output.effectiveImprovementStatus).toBe("IMPROVEMENT_UNVERIFIED");

    // 5. 成果物保存 & 自己監査でも実体化失敗が検出され FAIL かつ INVALID_EVIDENCE になること
    const artifactOutDir = path.join(tmpDir, "e2e-artifacts");
    saveHoldoutArtifacts(output, artifactOutDir);

    const auditResult = auditHoldoutArtifacts(artifactOutDir, {
      expectedCandidateDigest: EvolutionIndependentEvaluator.computeDnaDigest(candidateDNA),
      expectedOldChampionDigest: EvolutionIndependentEvaluator.computeDnaDigest(oldChampionDNA),
    });

    expect(auditResult.isValid).toBe(false);
    expect(auditResult.failedMatches).toBe(1);
    expect(auditResult.totalInstantiationFailures).toBe(1);
    expect(auditResult.evidenceStatus).toBe("INVALID_EVIDENCE");
    expect(auditResult.certificationStatus).toBe("INVALID_EVIDENCE");
    expect(auditResult.improvementStatus).toBe("IMPROVEMENT_UNVERIFIED");
    expect(auditResult.errors.some((e) => e.includes("core instantiation failure(s)"))).toBe(true);
  });
});
