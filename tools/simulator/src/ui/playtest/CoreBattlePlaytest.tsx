import React, { useState, useRef, useEffect, useCallback } from "react";
import { GameSession, GameSessionStep } from "../../engine/session/GameSession";
import { DecisionResponse } from "../../domain/decision/DecisionResponse";
import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader";
import { getPlaytestRulePackage } from "../../engine/rules/RulePackageSelector";
import { createCoreBattlePresetState, CORE_BATTLE_PRESET_ID } from "../../engine/session/playtest/createCoreBattlePlaytest";
import { MatchSetupCoordinator } from "../../engine/session/setup/MatchSetupCoordinator";
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

  // レギュレーション選択状態
  const [selectedRegulation, setSelectedRegulation] = useState<string>("core-battle");

  // プリセットバリデーションエラー
  const [presetValidationErrors, setPresetValidationErrors] = useState<string[]>([]);

  // 表示用 UI スナップショット
  const [gameState, setGameState] = useState<any>(null);
  const [currentStep, setCurrentStep] = useState<GameSessionStep | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [latestEventMessage, setLatestEventMessage] = useState<string>("");

  // ユニット選択マーカー（①, ②）および盤面クリック選択状態
  const [unitSelectionMarkers, setUnitSelectionMarkers] = useState<Map<string, { badge: string; isSelected: boolean }>>(
    new Map()
  );
  const [selectedUnitIds, setSelectedUnitIds] = useState<string[]>([]);

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
    const rawState = createCoreBattlePresetState();

    // プリセットバリデーション
    const validation = validatePlaytestPreset(rawState, fullRulePackage);
    if (!validation.valid) {
      setPresetValidationErrors(validation.errors);
      return;
    }
    setPresetValidationErrors([]);

    // 公式ゲーム開始手順 (先攻決定・公開カード墓地送り・先攻1枚ドロー)
    const setupResult = MatchSetupCoordinator.setupMatch(rawState);

    const session = new GameSession(setupResult.state, rulePackage);
    sessionRef.current = session;

    setLogs([]);
    setLatestEventMessage("");
    setSelectedUnitIds([]);
    addLog(`🚀 Core Battle Playtest を開始しました (プリセット: ${CORE_BATTLE_PRESET_ID})`, "info");
    addLog(`🛡 レギュレーション: Core Battle (Preset 001)`, "info");

    // 先攻決定プロセスのログ出力
    for (const round of setupResult.rounds) {
      const p1Code = `${round.p1Card.suit}${round.p1Card.rank}`;
      const p2Code = `${round.p2Card.suit}${round.p2Card.rank}`;
      if (round.result === "tie") {
        addLog(`🎲 [先攻決定 Round ${round.round}] Player A: ${p1Code} vs Player B: ${p2Code} -> 同値のため引き分け`, "action");
      } else {
        const winnerName = round.result === "p1" ? "Player A" : "Player B";
        addLog(`🎲 [先攻決定 Round ${round.round}] Player A: ${p1Code} vs Player B: ${p2Code} -> ${winnerName} が先攻に決定！`, "action");
      }
    }
    addLog(`🪦 公開された比較カードを両者の墓地へ移動しました`, "info");
    if (setupResult.drawnCard) {
      const winnerName = setupResult.firstPlayer === "p1" ? "Player A" : "Player B";
      const drawnCode = `${setupResult.drawnCard.suit}${setupResult.drawnCard.rank}`;
      addLog(`🃏 先攻の ${winnerName} がライフから1枚引きました (${drawnCode})`, "action");
    }
    const winnerName = setupResult.firstPlayer === "p1" ? "Player A" : "Player B";
    addLog(`⚡ ${winnerName} がターンとチャンスを持ってゲームを開始します`, "info");

    const step = session.advance();
    setCurrentStep(step);
    setGameState(JSON.parse(JSON.stringify(session.state)));

    if (step.type === "WAITING_FOR_DECISION") {
      lastActivePlayerRef.current = step.request.playerId;
      setPendingPlayerKey(step.request.playerId);
      if (enablePassAndPlay) {
        setIsPassAndPlayWaiting(true);
      }
    }
  }, [fullRulePackage, rulePackage, enablePassAndPlay, addLog]);

  // 初回マウント時にゲーム初期化
  useEffect(() => {
    startNewGame();
  }, [startNewGame]);

  // 盤面ユニットクリック時のトグルハンドラ
  const handleUnitClick = useCallback(
    (unitId: string) => {
      if (!unitSelectionMarkers.has(unitId)) return; // 選択可能でないユニットは無視

      setSelectedUnitIds((prev) => {
        if (prev.includes(unitId)) {
          return prev.filter((id) => id !== unitId);
        } else {
          return [...prev, unitId];
        }
      });
    },
    [unitSelectionMarkers]
  );

  // プレイヤーが判断（DecisionResponse）を提出したときの処理
  const handleDecisionSubmit = useCallback(
    (response: DecisionResponse, options?: { autoPass?: boolean }) => {
      const session = sessionRef.current;
      if (!session) return;

      let prevState = JSON.parse(JSON.stringify(session.state));
      let nextStep = session.submitDecision(response);
      let nextState = JSON.parse(JSON.stringify(session.state));

      // 選択状態をリセット
      setSelectedUnitIds([]);

      // State 遷移からイベントログを自動生成・蓄積
      const generatedEvents = GameEventFormatter.formatStateTransition(prevState, nextState);
      for (const ev of generatedEvents) {
        addLog(ev.message, ev.level);
      }

      // 「リクエスト＆PASS」が指定されており、次のステップが同一プレイヤーの判断要求（PASS可能）なら自動PASS
      if (
        options?.autoPass &&
        nextStep.type === "WAITING_FOR_DECISION" &&
        currentStep?.type === "WAITING_FOR_DECISION" &&
        nextStep.request.playerId === currentStep.request.playerId
      ) {
        const autoPassIndex = nextStep.request.patterns.findIndex((p) => p.kind === "PASS");
        if (autoPassIndex !== -1) {
          const autoPassPlayer = nextStep.request.playerId === "p1" ? "Player A" : "Player B";
          addLog(`⏩ ${autoPassPlayer} が自動 PASS しました (リクエスト＆PASS)`, "action");

          prevState = JSON.parse(JSON.stringify(session.state));
          nextStep = session.submitDecision({
            decisionId: nextStep.request.decisionId,
            stateVersion: nextStep.request.stateVersion,
            selectedPatternRef: autoPassIndex,
          });
          nextState = JSON.parse(JSON.stringify(session.state));

          const autoEvents = GameEventFormatter.formatStateTransition(prevState, nextState);
          for (const ev of autoEvents) {
            addLog(ev.message, ev.level);
          }
        }
      }

      setCurrentStep(nextStep);
      setGameState(nextState);

      // 最新の重要なイベントをステータスバーに表示
      if (generatedEvents.length > 0) {
        setLatestEventMessage(generatedEvents[generatedEvents.length - 1].message);
      }

      // プレイヤー交代時の Pass-and-Play オーバーレイ制御
      if (nextStep.type === "WAITING_FOR_DECISION") {
        const newPlayerId = nextStep.request.playerId;
        if (enablePassAndPlay && newPlayerId !== lastActivePlayerRef.current) {
          setPendingPlayerKey(newPlayerId);
          setIsPassAndPlayWaiting(true);
        }
        lastActivePlayerRef.current = newPlayerId;
      } else if (nextStep.type === "FINISHED") {
        const winnerName =
          nextState.players?.[nextStep.result.winner || ""]?.name ||
          (nextStep.result.winner === "p1" ? "Player A" : "Player B");
        addLog(`🏆 ゲーム終了: 勝者【${winnerName}】(${nextStep.result.reason})`, "system");
      }
    },
    [enablePassAndPlay, currentStep, addLog]
  );

  // Pass-and-Play 準備完了ハンドラ
  const handlePassAndPlayReady = useCallback(() => {
    setIsPassAndPlayWaiting(false);
  }, []);

  if (presetValidationErrors.length > 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-4 text-slate-100">
        <div className="max-w-lg rounded-2xl border-2 border-red-500 bg-slate-900 p-6 shadow-2xl">
          <h2 className="text-xl font-black text-red-400 mb-2">❌ プリセットバリデーションエラー</h2>
          <p className="text-xs text-slate-300 mb-4">
            初期盤面プリセットの整合性チェックに失敗しました。定義を確認してください。
          </p>
          <ul className="list-disc list-inside space-y-1 text-xs text-red-300 font-mono bg-red-950/40 p-3 rounded-lg border border-red-800 mb-4">
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

  const activePlayerKey =
    currentStep?.type === "WAITING_FOR_DECISION" ? currentStep.request.playerId : gameState?.chancePlayer || "p1";

  return (
    <div className="flex flex-col min-h-screen bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans">
      {/* 画面ヘッダー */}
      <header className="flex flex-wrap items-center justify-between px-5 py-2.5 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shadow-sm sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <span className="px-2 py-0.5 text-xs font-black rounded bg-indigo-600 text-white shadow-sm">
            PLAYTEST
          </span>
          <h1 className="text-lg font-black tracking-tight text-slate-900 dark:text-slate-100">
            Core Battle Playtest
          </h1>

          {/* Regulation Selector 枠 */}
          <div className="flex items-center gap-1.5 ml-2">
            <span className="text-[11px] font-bold text-slate-500">Regulation:</span>
            <select
              value={selectedRegulation}
              onChange={(e) => setSelectedRegulation(e.target.value)}
              className="text-xs font-bold py-1 px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
            >
              <option value="core-battle">Core Battle (Preset 001) [Active]</option>
              <option value="master-extra" disabled>Master + Extra (Coming Soon)</option>
              <option value="entry-16" disabled>Entry 16 (Coming Soon)</option>
            </select>
          </div>
        </div>

        {/* コントロールボタン */}
        <div className="flex items-center gap-3 mt-2 sm:mt-0">
          <label className="flex items-center gap-1.5 text-xs font-bold text-slate-600 dark:text-slate-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={enablePassAndPlay}
              onChange={(e) => setEnablePassAndPlay(e.target.checked)}
              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            Pass-and-Play
          </label>

          <button
            onClick={() => setShowDebug(!showDebug)}
            className={`px-2.5 py-1 text-xs font-bold rounded-lg border transition ${
              showDebug
                ? "bg-slate-800 text-emerald-400 border-emerald-500"
                : "bg-white text-slate-700 border-slate-300 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700"
            }`}
          >
            {showDebug ? "デバッグ非表示" : "🔧 Raw Debug"}
          </button>

          <button
            onClick={startNewGame}
            className="px-3 py-1 text-xs font-bold rounded-lg bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white shadow transition"
          >
            🔄 Reset Match
          </button>
        </div>
      </header>

      {/* 2ペインメインエリア: 左 7/12 (盤面), 右 5/12 (操作/ログ) */}
      <main className="flex-1 p-3.5 max-w-7xl mx-auto w-full grid grid-cols-1 lg:grid-cols-12 gap-3.5">
        {/* 左ペイン: 盤面（Player B / Stage / Player A） */}
        <div className="lg:col-span-7 flex flex-col gap-3">
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
              unitSelectionMarkers={unitSelectionMarkers}
              onUnitClick={handleUnitClick}
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
              unitSelectionMarkers={unitSelectionMarkers}
              onUnitClick={handleUnitClick}
            />
          )}
        </div>

        {/* 右ペイン: 操作パネル / 対戦ログ */}
        <div className="lg:col-span-5 flex flex-col gap-3 sticky top-16 max-h-[calc(100vh-5rem)]">
          {/* 判断要求パネル (Decision Panel) */}
          {currentStep?.type === "WAITING_FOR_DECISION" ? (
            <div className="shrink-0">
              <DecisionPanel
                request={currentStep.request}
                onSubmit={handleDecisionSubmit}
                onSelectionMarkersChange={setUnitSelectionMarkers}
                selectedUnitIdsFromBoard={selectedUnitIds}
              />
            </div>
          ) : (
            <div className="p-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 text-center text-xs text-slate-500">
              現在待機中の判断要求はありません
            </div>
          )}

          {/* 対戦ログ (Game Log) */}
          <div className="flex-1 min-h-[220px] overflow-hidden flex flex-col">
            <GameLog logs={logs} />
          </div>

          {/* Raw Debug パネル */}
          {showDebug && (
            <div className="h-64 shrink-0">
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
          logs={logs}
          onRestart={startNewGame}
        />
      )}
    </div>
  );
};
