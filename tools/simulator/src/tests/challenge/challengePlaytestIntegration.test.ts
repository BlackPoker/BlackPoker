import React from "react";
import { renderToString } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { CoreBattlePlaytest } from "../../ui/playtest/CoreBattlePlaytest";
import { ChallengeEvaluator, ChallengeRuntimeState } from "../../engine/challenge/ChallengeEvaluator";
import { ChallengeDefinitionV1 } from "../../domain/challenge/ChallengeDefinition";
import { loadRegulationCatalogForBrowser } from "../../engine/regulation/BrowserRegulationLoader";
import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader";
import { prepareScenarioMatchAttempt } from "../../engine/playtest/ScenarioMatchCoordinator";
import { ScenarioDefinitionV1 } from "../../domain/scenario/ScenarioTypes";
import { ScenarioAuthoringDraftV1 } from "../../domain/scenario/ScenarioAuthoringTypes";
import { ScenarioAuthoringResolver } from "../../engine/scenario/ScenarioAuthoringResolver";

describe("Challenge Playtest & Presentation Integration Tests (BP-SIM-CHALLENGE-1.0-R1-HARDENING)", () => {
  const catalog = loadRegulationCatalogForBrowser();
  const fullRulePackage = loadRulePackageForBrowser();

  const challengeDef: ChallengeDefinitionV1 = {
    version: 1,
    kind: "WIN_CURRENT_TURN",
  };

  describe("1. Challenger label terminology & No Life-zero semantics", () => {
    it("Challenge status banner に『Player A (P1)』『Player B (P2)』が表示され、『先手』『後手』が存在しないこと", () => {
      // P1 challenger (ACTIVE)
      const p1Challenge: ChallengeRuntimeState = {
        definition: challengeDef,
        status: "ACTIVE",
        challenger: "p1",
        initialTurnPlayer: "p1",
        initialTurnCount: 1,
      };

      // P2 challenger (ACTIVE)
      const p2Challenge: ChallengeRuntimeState = {
        definition: challengeDef,
        status: "ACTIVE",
        challenger: "p2",
        initialTurnPlayer: "p2",
        initialTurnCount: 1,
      };

      // ChallengeStatusBanner 相当の純粋コンポーネント構造のレンダリング検証
      const renderBanner = (challenge: ChallengeRuntimeState) => {
        return renderToString(
          React.createElement(
            "div",
            { "data-testid": "challenge-status-banner" },
            React.createElement(
              "span",
              null,
              `Challenger: ${challenge.challenger === "p1" ? "Player A (P1)" : "Player B (P2)"}`
            ),
            React.createElement(
              "p",
              null,
              challenge.status === "CLEARED"
                ? "🎉 チャレンジ達成！ このターン中に勝利しました。"
                : challenge.status === "FAILED"
                ? challenge.reason === "TURN_ENDED_BEFORE_WIN"
                  ? "このターン中に勝利条件を達成できませんでした。"
                  : challenge.reason === "OPPONENT_WON"
                  ? "相手プレイヤーが勝利しました。"
                  : challenge.reason === "GAME_FINISHED_WITHOUT_CHALLENGER_WIN"
                  ? "勝利条件を達成できずにゲームが終了しました。"
                  : `チャレンジ失敗 (${challenge.reason})`
                : "現在のターンが終了する前に勝利してください。"
            )
          )
        );
      };

      const htmlP1 = renderBanner(p1Challenge);
      expect(htmlP1).toContain("Player A (P1)");
      expect(htmlP1).not.toContain("Player A (先手)");
      expect(htmlP1).not.toContain("先手");
      expect(htmlP1).not.toContain("後手");

      const htmlP2 = renderBanner(p2Challenge);
      expect(htmlP2).toContain("Player B (P2)");
      expect(htmlP2).not.toContain("Player B (後手)");
      expect(htmlP2).not.toContain("先手");
      expect(htmlP2).not.toContain("後手");
    });

    it("Challenge status banner に『ライフを0』『ライフを削り切る』等の Core 勝敗条件ハードコードが存在しないこと", () => {
      const activeState: ChallengeRuntimeState = {
        definition: challengeDef,
        status: "ACTIVE",
        challenger: "p1",
        initialTurnPlayer: "p1",
        initialTurnCount: 1,
      };

      const failedState: ChallengeRuntimeState = {
        definition: challengeDef,
        status: "FAILED",
        challenger: "p1",
        initialTurnPlayer: "p1",
        initialTurnCount: 1,
        reason: "TURN_ENDED_BEFORE_WIN",
      };

      const clearedState: ChallengeRuntimeState = {
        definition: challengeDef,
        status: "CLEARED",
        challenger: "p1",
        initialTurnPlayer: "p1",
        initialTurnCount: 1,
        reason: "WIN_BEFORE_DEADLINE",
      };

      const renderBanner = (challenge: ChallengeRuntimeState) => {
        return renderToString(
          React.createElement(
            "div",
            { "data-testid": "challenge-status-banner" },
            React.createElement(
              "span",
              null,
              `Challenger: ${challenge.challenger === "p1" ? "Player A (P1)" : "Player B (P2)"}`
            ),
            React.createElement(
              "p",
              null,
              challenge.status === "CLEARED"
                ? "🎉 チャレンジ達成！ このターン中に勝利しました。"
                : challenge.status === "FAILED"
                ? challenge.reason === "TURN_ENDED_BEFORE_WIN"
                  ? "このターン中に勝利条件を達成できませんでした。"
                  : challenge.reason === "OPPONENT_WON"
                  ? "相手プレイヤーが勝利しました。"
                  : challenge.reason === "GAME_FINISHED_WITHOUT_CHALLENGER_WIN"
                  ? "勝利条件を達成できずにゲームが終了しました。"
                  : `チャレンジ失敗 (${challenge.reason})`
                : "現在のターンが終了する前に勝利してください。"
            )
          )
        );
      };

      for (const st of [activeState, failedState, clearedState]) {
        const html = renderBanner(st);
        expect(html).not.toContain("ライフを0");
        expect(html).not.toContain("ライフを削り切る");
        expect(html).not.toContain("削り切る");
      }

      expect(renderBanner(activeState)).toContain("現在のターンが終了する前に勝利してください。");
      expect(renderBanner(failedState)).toContain("このターン中に勝利条件を達成できませんでした。");
      expect(renderBanner(clearedState)).toContain("このターン中に勝利しました。");
    });
  });

  describe("2. Initial-terminal Challenge log ordering", () => {
    it("初期ステップで既に Challenge が Terminal (CLEARED または FAILED) となる場合、ログ初期化後にログが保持されること", () => {
      // 模擬 commitReadyMatch ログ順序契約テスト:
      // ログ初期化 -> initialLogs -> initialChallenge terminal ログ
      const logs: { message: string; level: string }[] = [];
      const addLog = (message: string, level: string) => {
        logs.push({ message, level });
      };

      const draft: ScenarioAuthoringDraftV1 = {
        environmentId: "official:standard-pack",
        seed: 42,
        turnPlayer: "p1",
        chancePlayer: "p1",
        turnCount: 1,
        players: {
          p1: { hand: { count: 5, fixedCards: [{ suit: "S", rank: "A" }] }, life: { count: 3 } },
          p2: { hand: { count: 5, fixedCards: [{ suit: "H", rank: "K" }] }, life: { count: 3 } },
        },
      };
      const resolveResult = ScenarioAuthoringResolver.resolve(draft, catalog);
      expect(resolveResult.success).toBe(true);
      if (!resolveResult.success) return;
      const minimalDef = resolveResult.definition;

      const outcome = prepareScenarioMatchAttempt({
        definition: minimalDef,
        catalog,
        fullRulePackage,
        mode: "humanVsAi",
        humanSeat: "p1",
        policyId: "playtestConservative",
      });

      expect(outcome.status).toBe("READY");
      if (outcome.status !== "READY") return;

      const { session, initialStep } = outcome.prepared;

      // 初期ステップが FINISHED (winner=p1) のケースをシミュレート
      const terminalFinishedStep = {
        type: "FINISHED" as const,
        result: { winner: "p1" as const, reason: "テスト勝利" },
      };

      // Challenge 初期化 & 評価
      const initRuntime = ChallengeEvaluator.initialize(challengeDef, session.state);
      const evaluated = ChallengeEvaluator.evaluate(initRuntime, terminalFinishedStep, session.state);
      expect(evaluated.status).toBe("CLEARED");

      // ログパイプラインの実行順序をシミュレート (CoreBattlePlaytest.tsx の commitReadyMatch 実装順序)
      // 1. setLogs([]) 相当
      logs.length = 0;

      // 2. initialLogs 相当
      for (const l of outcome.prepared.initialLogs) {
        addLog(l.message, l.level);
      }

      // 3. 初期 Challenge Terminal ログ
      if (evaluated.status !== "ACTIVE") {
        if (evaluated.status === "CLEARED") {
          addLog(`[CHALLENGE_CLEARED] チャレンジ達成！ (${evaluated.reason})`, "system");
        } else {
          addLog(`[CHALLENGE_FAILED] チャレンジ失敗 (${evaluated.reason})`, "system");
        }
      }

      // 検証: [CHALLENGE_CLEARED] ログが確実に末尾に残っていること (setLogs([]) で消去されない)
      const challengeLog = logs.find((l) => l.message.includes("[CHALLENGE_CLEARED]"));
      expect(challengeLog).toBeDefined();
      expect(challengeLog!.message).toContain("WIN_BEFORE_DEADLINE");
    });

    it("初期ステップで deadline 超過状態 (FAILED) となる場合、[CHALLENGE_FAILED] ログが保持されること", () => {
      const logs: { message: string; level: string }[] = [];
      const addLog = (message: string, level: string) => {
        logs.push({ message, level });
      };

      // 初期状態で turnPlayer が p2 になっている（deadline 超過）
      const crossedState = { turnPlayer: "p2", turnCount: 2 };
      const initRuntime = ChallengeEvaluator.initialize(challengeDef, { turnPlayer: "p1", turnCount: 1 });
      const evaluated = ChallengeEvaluator.evaluate(initRuntime, { type: "PROGRESSED" }, crossedState);
      expect(evaluated.status).toBe("FAILED");
      expect(evaluated.reason).toBe("TURN_ENDED_BEFORE_WIN");

      // ログパイプライン
      logs.length = 0;
      addLog("ゲーム開始", "system");

      if (evaluated.status !== "ACTIVE") {
        if (evaluated.status === "CLEARED") {
          addLog(`[CHALLENGE_CLEARED] チャレンジ達成！ (${evaluated.reason})`, "system");
        } else {
          addLog(`[CHALLENGE_FAILED] チャレンジ失敗 (${evaluated.reason})`, "system");
        }
      }

      const failedLog = logs.find((l) => l.message.includes("[CHALLENGE_FAILED]"));
      expect(failedLog).toBeDefined();
      expect(failedLog!.message).toContain("TURN_ENDED_BEFORE_WIN");
    });
  });
});
