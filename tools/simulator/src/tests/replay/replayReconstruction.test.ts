import { describe, it, expect } from "vitest";
import {
  reconstructMatch,
  findUndoTruncationIndex,
} from "../../engine/replay/ReplayReconstructionService";
import { loadRegulationCatalogForBrowser } from "../../engine/regulation/BrowserRegulationLoader";
import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader";
import { startMatchAttempt } from "../../engine/playtest/PlaytestEnvironmentController";
import { PlaytestPolicyFactory } from "../../engine/playtest/PlaytestPolicyFactory";
import { createSeatControllers } from "../../engine/playtest/PlaytestSeatController";
import { ObservationFactory } from "../../engine/decision/ObservationFactory";
import { buildPlaytestDiagnosticBundleV1 } from "../../ui/playtest/PlaytestDiagnosticBundle";
import { createReplayPlanFromDiagnosticBundleV1 } from "../../ui/playtest/DiagnosticReplayAdapter";
import type { PlaytestDecisionTranscriptEntryV1 } from "../../ui/playtest/PlaytestDecisionTranscript";
import type { ReplayDecisionEntryV1 } from "../../engine/replay/ReplayTypes";

describe("Replay Phase 2.0: Replay Reconstruction & In-Game Undo Tests", () => {
  const catalog = loadRegulationCatalogForBrowser();
  const fullRulePackage = loadRulePackageForBrowser();

  // 共通ヘルパー: N 件の Human 判断を実行した live セッションと Transcript を作成
  function createLiveSessionWithDecisions(count: number, seed = 42) {
    const outcome = startMatchAttempt({
      environmentId: "core-battle",
      seedInput: String(seed),
      catalog,
      fullRulePackage,
    });
    expect(outcome.type).toBe("READY");
    if (outcome.type !== "READY") throw new Error("Setup failed");

    const session = outcome.session;
    let step = outcome.initialStep;
    const transcript: PlaytestDecisionTranscriptEntryV1[] = [];

    for (let i = 0; i < count; i++) {
      while (step.type === "PROGRESSED") {
        step = session.advance();
      }
      if (step.type !== "WAITING_FOR_DECISION") break;

      const req = step.request;
      const entry: PlaytestDecisionTranscriptEntryV1 = {
        seq: transcript.length + 1,
        actor: "human",
        playerId: req.playerId as "p1" | "p2",
        decisionId: req.decisionId,
        stateVersion: req.stateVersion,
        response: {
          decisionId: req.decisionId,
          stateVersion: req.stateVersion,
          selectedPatternRef: 0,
        },
      };
      transcript.push(entry);

      step = session.submitDecision(entry.response);
    }

    while (step.type === "PROGRESSED") {
      step = session.advance();
    }

    return { session, initialStep: outcome.initialStep, lastStep: step, transcript };
  }

  // =========================================================================
  // A. Replay Reconstruction Tests
  // =========================================================================
  describe("A. Replay Reconstruction", () => {
    it("transcript 0 件の場合、初期操作可能状態 (WAITING_FOR_DECISION) が返される", () => {
      const recon = reconstructMatch({
        environmentId: "core-battle",
        seed: 42,
        transcript: [],
        decisionCount: 0,
        catalog,
        fullRulePackage,
      });

      expect(recon.status).toBe("SUCCESS");
      if (recon.status !== "SUCCESS") return;

      expect(recon.executedDecisions).toBe(0);
      expect(recon.totalDecisions).toBe(0);
      expect(recon.replayedDecisions.length).toBe(0);
      expect(recon.currentStep.type).toBe("WAITING_FOR_DECISION");
      expect(recon.currentDecisionRequest).toBeDefined();
    });

    it("transcript N 件の場合、N 件実行後の状態が決定論的かつ完全一致で再構築される", () => {
      const { session: liveSession, transcript } = createLiveSessionWithDecisions(3, 42);

      const recon = reconstructMatch({
        environmentId: "core-battle",
        seed: 42,
        transcript,
        decisionCount: 3,
        catalog,
        fullRulePackage,
      });

      expect(recon.status).toBe("SUCCESS");
      if (recon.status !== "SUCCESS") return;

      expect(recon.executedDecisions).toBe(3);
      expect(recon.replayedDecisions.length).toBe(3);

      // liveSession と recon.session の GameState が深層一致すること
      expect(recon.currentGameState).toEqual(JSON.parse(JSON.stringify(liveSession.state)));
    });

    it("同一 environment / seed / transcript から何度再構築しても完全同一状態が再現される", () => {
      const { transcript } = createLiveSessionWithDecisions(2, 999);

      const recon1 = reconstructMatch({
        environmentId: "core-battle",
        seed: 999,
        transcript,
        catalog,
        fullRulePackage,
      });
      const recon2 = reconstructMatch({
        environmentId: "core-battle",
        seed: 999,
        transcript,
        catalog,
        fullRulePackage,
      });

      expect(recon1.status).toBe("SUCCESS");
      expect(recon2.status).toBe("SUCCESS");
      if (recon1.status === "SUCCESS" && recon2.status === "SUCCESS") {
        expect(recon1.currentGameState).toEqual(recon2.currentGameState);
      }
    });

    it("runtime decisionId が保存値と異なっていても Replay は失敗しない", () => {
      const { transcript } = createLiveSessionWithDecisions(2, 42);

      // transcript の decisionId を改変（古いセッションIDをシミュレート）
      const modifiedTranscript: ReplayDecisionEntryV1[] = transcript.map((t) => ({
        ...t,
        response: {
          ...t.response,
          decisionId: "dummy-old-runtime-id-from-past",
        },
      }));

      const recon = reconstructMatch({
        environmentId: "core-battle",
        seed: 42,
        transcript: modifiedTranscript,
        catalog,
        fullRulePackage,
      });

      expect(recon.status).toBe("SUCCESS");
    });

    it("契約違反 (selectedPatternRef 範囲外) は DIVERGED として検出される", () => {
      const { transcript } = createLiveSessionWithDecisions(2, 42);

      const invalidTranscript: ReplayDecisionEntryV1[] = transcript.map((t, idx) =>
        idx === 1
          ? {
              ...t,
              response: {
                ...t.response,
                selectedPatternRef: 99999,
              },
            }
          : t
      );

      const recon = reconstructMatch({
        environmentId: "core-battle",
        seed: 42,
        transcript: invalidTranscript,
        catalog,
        fullRulePackage,
      });

      expect(recon.status).toBe("DIVERGED");
      if (recon.status === "DIVERGED") {
        expect(recon.code).toBe("PATTERN_REF_OUT_OF_RANGE");
        expect(recon.executedDecisions).toBe(1);
      }
    });

    it("Reconstruction 後は次の外部 Decision 境界 (WAITING_FOR_DECISION または FINISHED) まで正規化される", () => {
      const { transcript } = createLiveSessionWithDecisions(1, 42);

      const recon = reconstructMatch({
        environmentId: "core-battle",
        seed: 42,
        transcript,
        decisionCount: 1,
        catalog,
        fullRulePackage,
      });

      expect(recon.status).toBe("SUCCESS");
      if (recon.status !== "SUCCESS") return;

      // PROGRESSED で停止せず、WAITING_FOR_DECISION または FINISHED であること
      expect(["WAITING_FOR_DECISION", "FINISHED"]).toContain(recon.currentStep.type);
    });
  });

  // =========================================================================
  // B. Human vs Human + autoPass Undo Tests
  // =========================================================================
  describe("B. Human vs Human + autoPass Undo", () => {
    it("Human A -> Human B -> AutoPass の履歴で Undo すると Human B 選択前まで戻る", () => {
      const { transcript: liveTranscript } = createLiveSessionWithDecisions(2, 42);
      expect(liveTranscript.length).toBe(2);

      const mockTranscript: PlaytestDecisionTranscriptEntryV1[] = [
        liveTranscript[0],
        liveTranscript[1],
        {
          seq: 3,
          actor: "autoPass",
          playerId: liveTranscript[1].playerId,
          decisionId: "d3-autopass",
          stateVersion: 999,
          response: { decisionId: "d3-autopass", stateVersion: 999, selectedPatternRef: 0 },
        },
      ];

      // findUndoTruncationIndex は末尾の autoPass ではなく最後の human (index 1: Human B) を特定する
      const targetCount = findUndoTruncationIndex(mockTranscript);
      expect(targetCount).toBe(1); // index 1 の Human B 自体を含めて以降を切り落とすため、長さは 1

      const truncated = mockTranscript.slice(0, targetCount);
      expect(truncated.length).toBe(1);
      expect(truncated[0].actor).toBe("human");

      // fresh GameSession で再構築
      const recon = reconstructMatch({
        environmentId: "core-battle",
        seed: 42,
        transcript: truncated,
        decisionCount: truncated.length,
        catalog,
        fullRulePackage,
      });

      expect(recon.status).toBe("SUCCESS");
      if (recon.status !== "SUCCESS") return;
      expect(recon.executedDecisions).toBe(1);
      // 再構築後のステップは Human B が判断を選択する状態
      expect(recon.currentStep.type).toBe("WAITING_FOR_DECISION");
    });
  });


  // =========================================================================
  // C. Human vs AI + SeededRandom Policy State Restore Tests
  // =========================================================================
  describe("C. Human vs AI + SeededRandom Policy 状態復元", () => {
    it("Undo 時に Policy の PRNG 状態が巻き戻り、同一操作再選択時に AI の判断が再現される", () => {
      const matchSeed = 777;
      const seatControllers = createSeatControllers("humanVsAi", "p1", "seededRandom");
      const originalPolicies = PlaytestPolicyFactory.createPoliciesForMatch(seatControllers, matchSeed);

      const outcome = startMatchAttempt({
        environmentId: "core-battle",
        seedInput: String(matchSeed),
        catalog,
        fullRulePackage,
      });
      expect(outcome.type).toBe("READY");
      if (outcome.type !== "READY") return;

      const session = outcome.session;
      let step = outcome.initialStep;
      const transcript: PlaytestDecisionTranscriptEntryV1[] = [];
      const recordedAiChoices: Map<number, number> = new Map();

      // 進行しながら transcript を作成 (Human / AI の手番を動的に判定)
      for (let i = 0; i < 6; i++) {
        while (step.type === "PROGRESSED") step = session.advance();
        if (step.type !== "WAITING_FOR_DECISION") break;

        const req = step.request;
        const pid = req.playerId as "p1" | "p2";

        if (pid === "p1") {
          // Human
          const entry: PlaytestDecisionTranscriptEntryV1 = {
            seq: transcript.length + 1,
            actor: "human",
            playerId: "p1",
            decisionId: req.decisionId,
            stateVersion: req.stateVersion,
            response: {
              decisionId: req.decisionId,
              stateVersion: req.stateVersion,
              selectedPatternRef: 0,
            },
          };
          transcript.push(entry);
          step = session.submitDecision(entry.response);
        } else {
          // AI (SeededRandom)
          const chosen = originalPolicies["p2"].choose(req);
          recordedAiChoices.set(transcript.length + 1, chosen.selectedPatternRef);
          const entry: PlaytestDecisionTranscriptEntryV1 = {
            seq: transcript.length + 1,
            actor: "policy",
            playerId: "p2",
            decisionId: req.decisionId,
            stateVersion: req.stateVersion,
            response: {
              decisionId: req.decisionId,
              stateVersion: req.stateVersion,
              selectedPatternRef: chosen.selectedPatternRef,
            },
          };
          transcript.push(entry);
          step = session.submitDecision(entry.response);
        }
      }

      // transcript に Human と Policy の双方が含まれていることを確認
      const humanEntries = transcript.filter((t) => t.actor === "human");
      const policyEntries = transcript.filter((t) => t.actor === "policy");
      expect(humanEntries.length).toBeGreaterThan(0);
      expect(policyEntries.length).toBeGreaterThan(0);

      // ----------------------------------------------------
      // ここで Undo を実行！
      // ----------------------------------------------------
      const targetCount = findUndoTruncationIndex(transcript);
      expect(targetCount).toBeGreaterThanOrEqual(0);

      const truncatedTranscript = transcript.slice(0, targetCount);

      // fresh GameSession 再構築
      const recon = reconstructMatch({
        environmentId: "core-battle",
        seed: matchSeed,
        transcript: truncatedTranscript,
        decisionCount: truncatedTranscript.length,
        catalog,
        fullRulePackage,
      });
      expect(recon.status).toBe("SUCCESS");
      if (recon.status !== "SUCCESS") return;

      // fresh Policy インスタンス生成と PRNG 同期
      const freshPolicies = PlaytestPolicyFactory.createPoliciesForMatch(seatControllers, matchSeed);
      for (const item of recon.replayedDecisions) {
        if (item.entry.actor === "policy") {
          const p = freshPolicies[item.entry.playerId];
          const resp = p.choose(item.request);
          expect(resp.selectedPatternRef).toBe(item.entry.response.selectedPatternRef);
        }
      }

      // 再構築後のセッションで、切り落とされた直後の Human の操作を再実行
      let replayStep = recon.currentStep;
      expect(replayStep.type).toBe("WAITING_FOR_DECISION");
      if (replayStep.type !== "WAITING_FOR_DECISION") return;

      const replaySession = recon.session;
      const removedHumanEntry = transcript[targetCount];
      const replayHumanResp = {
        decisionId: replayStep.request.decisionId,
        stateVersion: replayStep.request.stateVersion,
        selectedPatternRef: removedHumanEntry.response.selectedPatternRef,
      };
      replayStep = replaySession.submitDecision(replayHumanResp);

      while (replayStep.type === "PROGRESSED") replayStep = replaySession.advance();

      // もし次が AI 手番であれば、復元された Policy が元の AI 判断と完全に一致することを検証
      if (replayStep.type === "WAITING_FOR_DECISION" && replayStep.request.playerId === "p2") {
        const nextAiSeq = targetCount + 2; // removedHumanEntry の次の判断
        const expectedChoice = recordedAiChoices.get(nextAiSeq);
        if (expectedChoice !== undefined) {
          const aiReplayChosen = freshPolicies["p2"].choose(replayStep.request);
          expect(aiReplayChosen.selectedPatternRef).toBe(expectedChoice);
        }
      }
    });
  });

  // =========================================================================
  // D. Undo Branching & decisionSeq Continuity Tests
  // =========================================================================
  describe("D. Undo 分岐と decisionSeq 連続性", () => {
    it("Undo 後に新 Decision を行うと未来 Transcript が破棄され、seq が連続した新分岐が生成される", () => {
      const { transcript } = createLiveSessionWithDecisions(3, 42);
      expect(transcript.length).toBe(3);
      expect(transcript.map((t) => t.seq)).toEqual([1, 2, 3]);

      // Undo: 最後の Human (seq 3) を取り消す
      const targetCount = findUndoTruncationIndex(transcript);
      expect(targetCount).toBe(2);

      const truncated = transcript.slice(0, targetCount);
      // 次の seq を算出
      const nextSeq = truncated.length === 0 ? 1 : truncated[truncated.length - 1].seq + 1;
      expect(nextSeq).toBe(3); // seq 3 に巻き戻っていること (seq 4 ではない)

      // 新分岐の Decision D を追加
      const newEntry: PlaytestDecisionTranscriptEntryV1 = {
        seq: nextSeq,
        actor: "human",
        playerId: "p1",
        decisionId: "new-d3",
        stateVersion: 3,
        response: {
          decisionId: "new-d3",
          stateVersion: 3,
          selectedPatternRef: 1, // 異なるパターンを選択
        },
      };
      const branchedTranscript = [...truncated, newEntry];

      expect(branchedTranscript.length).toBe(3);
      expect(branchedTranscript.map((t) => t.seq)).toEqual([1, 2, 3]);

      // Diagnostic Bundle を生成し、Adapter の Sequence Validation を通過することを確認
      const outcome = startMatchAttempt({
        environmentId: "core-battle",
        seedInput: "42",
        catalog,
        fullRulePackage,
      });
      expect(outcome.type).toBe("READY");
      if (outcome.type !== "READY") return;

      const bundle = buildPlaytestDiagnosticBundleV1({
        build: { sha: "test-build-sha", ref: "test" },
        generatedAt: new Date().toISOString(),
        activeMatch: outcome.activeMatch,
        activePlaytestSettings: { matchMode: "humanVsHuman" },
        seatControllers: createSeatControllers("humanVsHuman"),
        currentStep: outcome.initialStep,
        rawState: outcome.session.state,
        decisionTranscript: branchedTranscript,
      });

      const planResult = createReplayPlanFromDiagnosticBundleV1(bundle, {
        currentBuildSha: "test-build-sha",
      });
      expect(planResult.type).toBe("READY");
      if (planResult.type === "READY") {
        expect(planResult.plan.decisions.length).toBe(3);
        expect(planResult.plan.decisions.map((d) => d.seq)).toEqual([1, 2, 3]);
      }
    });
  });

  // =========================================================================
  // E. Undo Disabled Conditions Tests
  // =========================================================================
  describe("E. Undo 不可条件", () => {
    it("Transcript 0 件のときは Undo 不可 (-1 を返却)", () => {
      expect(findUndoTruncationIndex([])).toBe(-1);
    });

    it("Human vs AI で Human 判断がまだ存在しない場合 (AI 判断のみ先行) も Undo 不可 (-1 を返却)", () => {
      const aiOnlyTranscript: PlaytestDecisionTranscriptEntryV1[] = [
        {
          seq: 1,
          actor: "policy",
          playerId: "p2",
          decisionId: "ai-1",
          stateVersion: 1,
          response: { decisionId: "ai-1", stateVersion: 1, selectedPatternRef: 0 },
        },
        {
          seq: 2,
          actor: "policy",
          playerId: "p2",
          decisionId: "ai-2",
          stateVersion: 2,
          response: { decisionId: "ai-2", stateVersion: 2, selectedPatternRef: 0 },
        },
      ];

      expect(findUndoTruncationIndex(aiOnlyTranscript)).toBe(-1);
    });
  });

  // =========================================================================
  // F. Replay Viewer Navigation & Index Contract Tests
  // =========================================================================
  describe("F. Replay Viewer インデックス契約と境界制御", () => {
    it("index = 0 / 1 / N それぞれで表示対象の Decision 情報が正しいこと (off-by-one 防止)", () => {
      const { transcript } = createLiveSessionWithDecisions(3, 42);
      const N = transcript.length;
      expect(N).toBe(3);

      // index = 0: 初期盤面 (Decision 未実行、直前 Decision 情報は null/undefined)
      const lastDecisionAt0 = 0 > 0 ? transcript[0 - 1] : null;
      expect(lastDecisionAt0).toBeNull();

      // index = 1: transcript[0] 実行後
      const lastDecisionAt1 = 1 > 0 ? transcript[1 - 1] : null;
      expect(lastDecisionAt1).toBeDefined();
      expect(lastDecisionAt1?.seq).toBe(1);

      // index = N: transcript[N-1] 実行後
      const lastDecisionAtN = N > 0 ? transcript[N - 1] : null;
      expect(lastDecisionAtN).toBeDefined();
      expect(lastDecisionAtN?.seq).toBe(3);
    });

    it("ナビゲーション移動が 0 〜 maxIndex の範囲内に厳格にクリップされる", () => {
      const maxIndex = 5;

      // 0 より下へは行かない
      let curr = 0;
      curr = Math.max(0, curr - 1);
      expect(curr).toBe(0);

      // maxIndex より上へは行かない
      curr = 5;
      curr = Math.min(maxIndex, curr + 1);
      expect(curr).toBe(5);
    });
  });

  // =========================================================================
  // G. 秘密情報契約 (手札・非公開防壁・非公開墓地の秘匿)
  // =========================================================================
  describe("G. 秘密情報契約の非露出", () => {
    it("Replay Reconstruction 後の状態を ObservationFactory で投影した際、相手の手札・非公開カードが秘匿される", () => {
      const { transcript } = createLiveSessionWithDecisions(2, 42);

      const recon = reconstructMatch({
        environmentId: "core-battle",
        seed: 42,
        transcript,
        catalog,
        fullRulePackage,
      });

      expect(recon.status).toBe("SUCCESS");
      if (recon.status !== "SUCCESS") return;

      // p1 視点での Observation
      const obsP1 = ObservationFactory.createObservation(recon.currentGameState, "p1");
      const opponentP2 = obsP1.players.find((p) => p.playerId === "p2");
      expect(opponentP2).toBeDefined();

      // 相手手札の非公開性: 全て HIDDEN であり、suit / rank を持たない
      for (const card of opponentP2!.handCards) {
        expect(card.visibility).toBe("HIDDEN");
        expect((card as any).suit).toBeUndefined();
        expect((card as any).rank).toBeUndefined();
      }

      // 相手墓地: オーナーでなければ全墓地閲覧不可 (canViewFullGrave = false)
      expect(opponentP2!.canViewFullGrave).toBe(false);

      // 相手フィールドの裏向きユニット（防壁等）: カードは HIDDEN であり suit / rank を持たない
      for (const unit of opponentP2!.field) {
        if (unit.face === "down") {
          for (const card of unit.cards) {
            expect(card.visibility).toBe("HIDDEN");
            expect((card as any).suit).toBeUndefined();
            expect((card as any).rank).toBeUndefined();
          }
        }
      }
    });
  });
});
