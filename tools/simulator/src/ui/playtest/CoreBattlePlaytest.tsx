import React, { useState, useRef, useEffect, useCallback } from "react";
import { GameSession, GameSessionStep } from "../../engine/session/GameSession";
import { DecisionResponse } from "../../domain/decision/DecisionResponse";
import { loadRulePackageForBrowser, getPlaytestRulePackage } from "../../engine/rules/BrowserRuleLoader";
import { createCoreBattlePresetState, CORE_BATTLE_PRESET_ID } from "../../engine/session/playtest/createCoreBattlePlaytest";
import { validatePlaytestPreset } from "../../engine/session/playtest/validatePlaytestPreset";
import { GameEventFormatter } from "../../engine/session/playtest/GameEventFormatter";
import { GameStatusBar } from "../game/GameStatusBar";
import { PlayerBoard } from "../game/PlayerBoard";
import { StagePanel } from "../game/StagePanel";
import { DecisionPanel } from "../decision/DecisionPanel";
import { GameLog, LogEntry } from "../game/GameLog";
import { PassAndPlayOverlay } from "../game/PassAndPlayOverlay";
import { GameOverOverlay } from "../game/GameOverOverlay";
import { DebugPanel } from "../debug/DebugPanel";

export const CoreBattlePlaytest: React.FC = () => {
  const [fullRulePackage] = useState(() => loadRulePackageForBrowser());
  const [rulePackage] = useState(() => getPlaytestRulePackage(fullRulePackage));
  const sessionRef = useRef<GameSession | null>(null);

  // プリセットバリデーションエラー
  const [presetValidationErrors, setPresetValidationErrors] = useState<string[]>([]);

  // 表示用 UI スナップショット
  const [gameState, setGameState] = useState<any>(null);
  const [currentStep, setCurrentStep] = useState<GameSessionStep | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [latestEventMessage, setLatestEventMessage] = useState<string>("");

  // Pass-and-Play 制御
  const [enablePassAndPlay, setEnablePassAndPlay] = useState(true);
  const [isPassAndPlayWaiting, setIsPassAndPlayWaiting] = useState(false);
  const [pendingPlayerKey, setPendingPlayerKey] = useState<string>("p1");
  const lastActivePlayerRef = useRef<string>("p1");

  // デバッグタブ
  const [showDebug, setShowDebug] = useState(false);

  const addLog = useCallback((message: string, level: LogEntry["level"] = "info") => {
    const entry: LogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      level,
      message,
      timestamp: new Date().toLocaleTimeString(),
    };
    setLogs((prev) => [entry, ...prev]);
  }, []);

  // 新しい対戦の開始
  const startNewGame = useCallback(() => {
    const initialState = createCoreBattlePresetState();

    // プリセットバリデーション
    const validation = validatePlaytestPreset(initialState, fullRulePackage);
    if (!validation.valid) {
      setPresetValidationErrors(validation.errors);
      return;
    }
    setPresetValidationErrors([]);

    const session = new GameSession(initialState, rulePackage);
    sessionRef.current = session;

    setLogs([]);
    addLog(`対戦を開始しました (Preset: ${CORE_BATTLE_PRESET_ID})`, "system");
    addLog(`手番: Player A, チャンス: Player A`, "info");

    const step = session.advance();
    setCurrentStep(step);
    setGameState(JSON.parse(JSON.stringify(session.state)));

    if (step.type === "WAITING_FOR_DECISION") {
      setPendingPlayerKey(step.request.playerId);
      lastActivePlayerRef.current = step.request.playerId;
      setIsPassAndPlayWaiting(false); // 初回は直接表示
    }
  }, [fullRulePackage, rulePackage, addLog]);

  // 初回マウント時にゲームを開始
  useEffect(() => {
    startNewGame();
  }, [startNewGame]);

  // 判断の送信とゲーム進行
  const handleDecisionSubmit = (response: DecisionResponse) => {
    const session = sessionRef.current;
    if (!session) return;

    const prevState = JSON.parse(JSON.stringify(session.state));

    // 行動ログの記録
    if (currentStep?.type === "WAITING_FOR_DECISION") {
      const req = currentStep.request;
      const player = req.playerId === "p1" ? "Player A" : "Player B";
      const selectedPattern = req.patterns[response.selectedPatternRef];

      if (selectedPattern?.kind === "PASS") {
        addLog(`${player} が PASS しました`, "action");
      } else if (selectedPattern?.kind === "EFFECT_SELECTION") {
        const effSel = req.catalog.effectSelections[selectedPattern.effectSelectionRef!];
        addLog(`${player} が選択: ${effSel?.summary || "効果対象決定"}`, "action");
      } else if (selectedPattern?.actionSelectionRef !== undefined) {
        const act = req.catalog.actions[selectedPattern.actionSelectionRef];
        addLog(`${player} が「${act.actionName || act.actionId}」をリクエスト`, "action");
      }
    }

    // 判断を提出してステップを進める
    let nextStep = session.submitDecision(response);
    if (nextStep.type === "PROGRESSED") {
      nextStep = session.advance();
    }

    const nextState = JSON.parse(JSON.stringify(session.state));
    setCurrentStep(nextStep);
    setGameState(nextState);

    // State 遷移からイベントログを自動生成・蓄積
    const generatedEvents = GameEventFormatter.formatStateTransition(prevState, nextState);
    for (const ev of generatedEvents) {
      addLog(ev.message, ev.level);
    }

    // 誘発アクションや状態変化のログ
    if (nextStep.type === "WAITING_FOR_DECISION") {
      const nextPlayer = nextStep.request.playerId;

      // ターン交代やチャンス移動の検知
      if (session.state.stage?.requests?.length > 0) {
        const topReq = session.state.stage.requests[session.state.stage.requests.length - 1];
        setLatestEventMessage(`Stage: ${topReq.action?.name || topReq.actionId} (発動: ${topReq.controller})`);
      } else {
        setLatestEventMessage("");
      }

      // Pass-and-Play 切り替え
      if (enablePassAndPlay && lastActivePlayerRef.current !== nextPlayer) {
        setPendingPlayerKey(nextPlayer);
        setIsPassAndPlayWaiting(true);
        lastActivePlayerRef.current = nextPlayer;
      }
    } else if (nextStep.type === "FINISHED") {
      const winnerName = session.state.players[nextStep.result.winner || ""]?.name || nextStep.result.winner;
      addLog(`★ 勝者: ${winnerName} (${nextStep.result.reason})`, "system");
    }
  };

  const handlePassAndPlayReady = () => {
    setIsPassAndPlayWaiting(false);
  };

  if (presetValidationErrors.length > 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-900 text-slate-100 p-6">
        <div className="max-w-xl w-full bg-red-950/60 border-2 border-red-500 rounded-2xl p-6 shadow-2xl">
          <h1 className="text-2xl font-black text-red-400 mb-2">❌ Playtest Preset Error</h1>
          <p className="text-sm text-slate-300 mb-4">
            初期盤面プリセットの整合性チェックでエラーが検出されました。ゲームを開始できません。
          </p>
          <ul className="list-disc list-inside space-y-1 text-xs font-mono text-red-200 bg-red-900/40 p-3 rounded-lg mb-6">
            {presetValidationErrors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
          <button
            onClick={startNewGame}
            className="w-full py-2.5 bg-red-600 hover:bg-red-500 text-white font-bold rounded-xl transition"
          >
            再試行 (Retry)
          </button>
        </div>
      </div>
    );
  }

  const activePlayerKey = currentStep?.type === "WAITING_FOR_DECISION" ? currentStep.request.playerId : gameState?.chancePlayer || "p1";

  return (
    <div className="flex flex-col min-h-screen bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans">
      {/* 画面ヘッダー */}
      <header className="flex flex-wrap items-center justify-between px-6 py-3 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 text-xs font-black rounded bg-indigo-600 text-white">
              PLAYTEST
            </span>
            <h1 className="text-xl font-black tracking-tight text-slate-900 dark:text-slate-100">
              Core Battle Playtest
            </h1>
            <span className="text-xs font-mono text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded">
              Preset: {CORE_BATTLE_PRESET_ID}
            </span>
          </div>
          <p className="text-xs text-amber-600 dark:text-amber-400 font-bold mt-0.5">
            ※ 実装済みコアルール確認用の短縮プレイテスト版です（BlackPoker 9.1.2 完全実装版ではありません）
          </p>
        </div>

        {/* コントロールボタン */}
        <div className="flex items-center gap-3 mt-2 sm:mt-0">
          <label className="flex items-center gap-1.5 text-xs font-bold text-slate-600 dark:text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={enablePassAndPlay}
              onChange={(e) => setEnablePassAndPlay(e.target.checked)}
              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            Pass-and-Play (交代画面)
          </label>

          <button
            onClick={() => setShowDebug(!showDebug)}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition ${
              showDebug
                ? "bg-slate-800 text-emerald-400 border-emerald-500"
                : "bg-white text-slate-700 border-slate-300 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700"
            }`}
          >
            {showDebug ? "デバッグ非表示" : "🔧 デバッグ表示"}
          </button>

          <button
            onClick={startNewGame}
            className="px-3.5 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow transition active:scale-95"
          >
            🔄 最初からやり直す
          </button>
        </div>
      </header>

      {/* メイン対戦エリア */}
      <main className="flex-1 p-4 max-w-7xl mx-auto w-full grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* 左〜中央列: ステータス、盤面、ステージ、判断パネル (8/12) */}
        <div className="lg:col-span-8 flex flex-col gap-4">
          {/* ゲーム進行ステータスバー */}
          {gameState && (
            <GameStatusBar
              turnPlayer={gameState.turnPlayer}
              chancePlayer={gameState.chancePlayer}
              turnCount={gameState.turnCount}
              players={gameState.players}
              latestEventMessage={latestEventMessage}
            />
          )}

          {/* 対戦相手 (Player B) の盤面 */}
          {gameState?.players?.p2 && (
            <PlayerBoard
              playerKey="p2"
              player={gameState.players.p2}
              isCurrentDecisionPlayer={activePlayerKey === "p2"}
              isTurnPlayer={gameState.turnPlayer === "p2"}
              isChancePlayer={gameState.chancePlayer === "p2"}
              showPrivateInfo={!enablePassAndPlay || activePlayerKey === "p2" || showDebug}
            />
          )}

          {/* 中央 STAGE パネル */}
          <StagePanel requests={gameState?.stage?.requests || []} />

          {/* 自分 (Player A) の盤面 */}
          {gameState?.players?.p1 && (
            <PlayerBoard
              playerKey="p1"
              player={gameState.players.p1}
              isCurrentDecisionPlayer={activePlayerKey === "p1"}
              isTurnPlayer={gameState.turnPlayer === "p1"}
              isChancePlayer={gameState.chancePlayer === "p1"}
              showPrivateInfo={!enablePassAndPlay || activePlayerKey === "p1" || showDebug}
            />
          )}

          {/* 判断要求パネル (Decision Panel) */}
          {currentStep?.type === "WAITING_FOR_DECISION" && (
            <DecisionPanel
              request={currentStep.request}
              onSubmit={handleDecisionSubmit}
            />
          )}
        </div>

        {/* 右列: 対戦ログ / デバッグパネル (4/12) */}
        <div className="lg:col-span-4 flex flex-col gap-4 min-h-[500px]">
          <div className="flex-1 min-h-[300px]">
            <GameLog logs={logs} />
          </div>

          {showDebug && (
            <div className="h-[400px]">
              <DebugPanel
                state={gameState}
                currentDecisionRequest={currentStep?.type === "WAITING_FOR_DECISION" ? currentStep.request : undefined}
                rulePackage={rulePackage}
                logs={logs}
              />
            </div>
          )}
        </div>
      </main>

      {/* Pass-and-Play 交代オーバーレイ */}
      {isPassAndPlayWaiting && (
        <PassAndPlayOverlay
          targetPlayerKey={pendingPlayerKey}
          targetPlayerName={pendingPlayerKey === "p1" ? "Player A" : "Player B"}
          onReady={handlePassAndPlayReady}
        />
      )}

      {/* ゲーム終了 (FINISHED) オーバーレイ */}
      {currentStep?.type === "FINISHED" && (
        <GameOverOverlay
          winnerKey={currentStep.result.winner}
          winnerName={gameState?.players?.[currentStep.result.winner || ""]?.name || currentStep.result.winner}
          reason={currentStep.result.reason}
          onRestart={startNewGame}
        />
      )}
    </div>
  );
};
