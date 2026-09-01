import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
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
import { DebugPanel, TraceEntry } from "../debug/DebugPanel";
import { MobileDecisionDock } from "../decision/MobileDecisionDock";
import { MobileBottomSheet, SheetMode } from "../game/MobileBottomSheet";
import { MobileHeaderMenu } from "../game/MobileHeaderMenu";
import { useIsDesktop } from "../hooks/useMediaQuery";
import { PlayerObservationPresenter } from "../game/PlayerObservationPresenter";

import { BattleRelationPresenter } from "../game/BattleRelationPresenter";
import logoUrl from "../../assets/blackpoker-logo.svg";

export const CoreBattlePlaytest: React.FC = () => {
  const isDesktop = useIsDesktop();
  const [fullRulePackage] = useState(() => loadRulePackageForBrowser());
  const [rulePackage] = useState(() => getPlaytestRulePackage(fullRulePackage));
  const sessionRef = useRef<GameSession | null>(null);
  const seqRef = useRef<number>(1);

  // レギュレーション選択状態
  const [selectedRegulation, setSelectedRegulation] = useState<string>("core-battle");

  // プリセットバリデーションエラー
  const [presetValidationErrors, setPresetValidationErrors] = useState<string[]>([]);

  // 表示用 UI スナップショット
  const [gameState, setGameState] = useState<any>(null);
  const [currentStep, setCurrentStep] = useState<GameSessionStep | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [traces, setTraces] = useState<TraceEntry[]>([]);
  const [latestEventMessage, setLatestEventMessage] = useState<string>("ゲーム開始準備完了");

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

  // デスクトップ用デバッグ表示
  const [showDebug, setShowDebug] = useState(false);

  // モバイル用 UI 状態 (collapsed / half / expanded)
  const [sheetMode, setSheetMode] = useState<SheetMode>("collapsed");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [showMobileLogModal, setShowMobileLogModal] = useState(false);
  const [showMobileDebugModal, setShowMobileDebugModal] = useState(false);

  const addTrace = useCallback((
    category: string,
    message: string,
    state: any,
    extra?: Partial<TraceEntry>
  ) => {
    const seq = seqRef.current++;
    const stateVersion = state?.stateVersion ?? state?.version ?? 1;
    const entry: TraceEntry = {
      seq,
      stateVersion,
      timestamp: new Date().toLocaleTimeString(),
      category,
      turnPlayer: state?.turnPlayer,
      chancePlayer: state?.chancePlayer,
      stageDepth: state?.stage?.requests?.length || 0,
      message,
      ...extra,
    };
    setTraces((prev) => [...prev, entry]);
  }, []);

  const addLog = useCallback((message: string, level: LogEntry["level"] = "info", state?: any) => {
    const seq = seqRef.current;
    const stateVersion = state?.stateVersion ?? state?.version;
    const entry: LogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      level,
      message,
      timestamp: new Date().toLocaleTimeString(),
      seq,
      stateVersion,
    };
    setLogs((prev) => [...prev, entry]);
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
    setTraces([]);
    seqRef.current = 1;
    setLatestEventMessage("ゲーム開始準備完了");
    setSelectedUnitIds([]);
    setSheetMode("collapsed");
    addLog(`[START] Core Battle Playtest を開始しました (プリセット: ${CORE_BATTLE_PRESET_ID})`, "info", setupResult.state);
    addLog(`[REGULATION] Core Battle (Preset 001)`, "info", setupResult.state);
    addTrace("MATCH_SETUP", `ゲーム開始 (Preset: ${CORE_BATTLE_PRESET_ID})`, setupResult.state);

    // 先攻決定プロセスのログ出力
    for (const round of setupResult.rounds) {
      const p1Code = `${round.p1Card.suit}${round.p1Card.rank}`;
      const p2Code = `${round.p2Card.suit}${round.p2Card.rank}`;
      if (round.result === "tie") {
        addLog(`[先攻決定 Round ${round.round}] Player A: ${p1Code} vs Player B: ${p2Code} -> 同値のため引き分け`, "action", setupResult.state);
      } else {
        const winnerName = round.result === "p1" ? "Player A" : "Player B";
        addLog(`[先攻決定 Round ${round.round}] Player A: ${p1Code} vs Player B: ${p2Code} -> ${winnerName} が先攻に決定`, "action", setupResult.state);
      }
    }
    addLog(`[SETUP] 公開された比較カードを両者の墓地へ移動しました`, "info", setupResult.state);
    if (setupResult.drawnCard) {
      const winnerName = setupResult.firstPlayer === "p1" ? "Player A" : "Player B";
      const drawnCode = `${setupResult.drawnCard.suit}${setupResult.drawnCard.rank}`;
      addLog(`[DRAW] 先攻の ${winnerName} がライフから1枚引きました (${drawnCode})`, "action", setupResult.state);
    }
    const winnerName = setupResult.firstPlayer === "p1" ? "Player A" : "Player B";
    addLog(`[TURN] ${winnerName} がターンとチャンスを持ってゲームを開始します`, "info", setupResult.state);

    const step = session.advance();
    setCurrentStep(step);
    setGameState(JSON.parse(JSON.stringify(session.state)));

    if (step.type === "WAITING_FOR_DECISION") {
      lastActivePlayerRef.current = step.request.playerId;
      setPendingPlayerKey(step.request.playerId);
      if (enablePassAndPlay) {
        setIsPassAndPlayWaiting(true);
      }
      addTrace("DECISION_REQUEST", `判断待機 (${step.request.playerId})`, setupResult.state);
    }
  }, [fullRulePackage, rulePackage, enablePassAndPlay, addLog, addTrace]);

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

      // モバイル Bottom Sheet を最小化
      setSheetMode("collapsed");

      let prevState = JSON.parse(JSON.stringify(session.state));
      const selectedPattern = currentStep?.type === "WAITING_FOR_DECISION" ? currentStep.request.patterns[response.selectedPatternRef] : undefined;
      const category = selectedPattern?.kind === "PASS" ? "PASS" : "DECISION_SUBMIT";
      addTrace(category, `判断送信 (Pattern #${response.selectedPatternRef}: ${selectedPattern?.patternId || ""})`, prevState);

      let nextStep = session.submitDecision(response);
      let nextState = JSON.parse(JSON.stringify(session.state));

      // 選択状態をリセット
      setSelectedUnitIds([]);

      // State 遷移からイベントログを自動生成・蓄積
      const generatedEvents = GameEventFormatter.formatStateTransition(prevState, nextState);
      for (const ev of generatedEvents) {
        addLog(ev.message, ev.level, nextState);
        addTrace("STATE_TRANSITION", ev.message, nextState);
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
          addLog(`[AUTO_PASS] ${autoPassPlayer} が自動 PASS しました (リクエスト＆PASS)`, "action", nextState);
          addTrace("AUTO_PASS", `${autoPassPlayer} 自動PASS`, nextState);

          prevState = JSON.parse(JSON.stringify(session.state));
          nextStep = session.submitDecision({
            decisionId: nextStep.request.decisionId,
            stateVersion: nextStep.request.stateVersion,
            selectedPatternRef: autoPassIndex,
          });
          nextState = JSON.parse(JSON.stringify(session.state));

          const autoEvents = GameEventFormatter.formatStateTransition(prevState, nextState);
          for (const ev of autoEvents) {
            addLog(ev.message, ev.level, nextState);
            addTrace("STATE_TRANSITION", ev.message, nextState);
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
        addTrace("WAITING_DECISION", `判断待機 (${newPlayerId})`, nextState);
      } else if (nextStep.type === "FINISHED") {
        const winnerName =
          nextState.players?.[nextStep.result.winner || ""]?.name ||
          (nextStep.result.winner === "p1" ? "Player A" : "Player B");
        addLog(`[FINISH] ゲーム終了: 勝者【${winnerName}】(${nextStep.result.reason})`, "system", nextState);
        addTrace("GAME_FINISHED", `勝者: ${winnerName} (${nextStep.result.reason})`, nextState);
      }
    },
    [enablePassAndPlay, currentStep, addLog, addTrace]
  );

  // Pass-and-Play 準備完了ハンドラ
  const handlePassAndPlayReady = useCallback(() => {
    setIsPassAndPlayWaiting(false);
  }, []);

  const allPlayersFog = useMemo(() => {
    const fogs: any[] = [];
    if (gameState?.players) {
      for (const [pKey, p] of Object.entries<any>(gameState.players)) {
        if (Array.isArray(p.fog)) {
          for (const f of p.fog) {
            fogs.push({ ...f, ownerPlayerId: pKey });
          }
        }
      }
    }
    return fogs;
  }, [gameState]);

  // 戦闘関係番号プレゼンテーション (①, ②, ...) の生成
  const battleRelationMap = useMemo(() => {
    const obs = currentStep?.type === "WAITING_FOR_DECISION" ? currentStep.request.observation : undefined;
    return BattleRelationPresenter.buildPresentationMap(gameState, obs);
  }, [gameState, currentStep]);

  // decisionId 切替時の盤面選択リセット & モバイルシート最小化
  useEffect(() => {
    setSelectedUnitIds([]);
    setSheetMode("collapsed");
  }, [currentStep?.type === "WAITING_FOR_DECISION" ? currentStep.request.decisionId : null]);

  // キーボードショートカット (P: PASS)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // オーバーレイ表示中、またはフォーム入力フォーカス中は無視
      if (isPassAndPlayWaiting) return;
      const target = e.target as HTMLElement;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) {
        return;
      }

      if (currentStep?.type === "WAITING_FOR_DECISION") {
        const passIndex = currentStep.request.patterns.findIndex((p) => p.kind === "PASS");

        // P キーで PASS
        if ((e.key === "p" || e.key === "P") && !e.ctrlKey && !e.metaKey && !e.altKey) {
          if (passIndex !== -1) {
            e.preventDefault();
            handleDecisionSubmit({
              decisionId: currentStep.request.decisionId,
              stateVersion: currentStep.request.stateVersion,
              selectedPatternRef: passIndex,
            });
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [currentStep, isPassAndPlayWaiting, handleDecisionSubmit]);

  if (presetValidationErrors.length > 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-100 p-4 text-zinc-950 font-sans">
        <div className="max-w-lg rounded-lg border-2 border-red-600 bg-white p-6 shadow-xl">
          <div className="flex items-center gap-2 mb-2 font-mono">
            <span className="px-2 py-0.5 rounded bg-red-600 text-white text-xs font-black">[ERROR]</span>
            <h2 className="text-base font-bold text-zinc-950">プリセットバリデーションエラー</h2>
          </div>
          <p className="text-xs text-zinc-600 mb-4">
            初期盤面プリセットの整合性チェックに失敗しました。定義を確認してください。
          </p>
          <ul className="list-disc list-inside space-y-1 text-red-700 font-mono bg-red-50 p-3 rounded border border-red-200 mb-4">
            {presetValidationErrors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
          <button
            onClick={startNewGame}
            className="w-full py-2 bg-zinc-950 hover:bg-zinc-800 text-white font-bold rounded shadow transition text-xs font-mono min-h-[44px]"
          >
            再試行 (Retry)
          </button>
        </div>
      </div>
    );
  }

  const activePlayerKey =
    currentStep?.type === "WAITING_FOR_DECISION" ? currentStep.request.playerId : gameState?.chancePlayer || "p1";

  // Observation を基準とした PlayerBoardViewModel の生成 (Debug ONに関わらず通常盤面は常にObservation準拠)
  const observation = currentStep?.type === "WAITING_FOR_DECISION" ? currentStep.request.observation : undefined;
  const p1ViewModel = PlayerObservationPresenter.buildPlayerViewModel(
    "p1",
    observation,
    gameState,
    activePlayerKey
  );
  const p2ViewModel = PlayerObservationPresenter.buildPlayerViewModel(
    "p2",
    observation,
    gameState,
    activePlayerKey
  );

  // DecisionPanel のコンテンツ生成
  const decisionPanelContent = currentStep?.type === "WAITING_FOR_DECISION" ? (
    <DecisionPanel
      key={currentStep.request.decisionId}
      request={currentStep.request}
      onSubmit={handleDecisionSubmit}
      onSelectionMarkersChange={setUnitSelectionMarkers}
      selectedUnitIdsFromBoard={selectedUnitIds}
    />
  ) : null;

  return (
    <div className="flex flex-col min-h-screen bg-[#f7f7f8] text-zinc-950 font-sans selection:bg-zinc-950 selection:text-white">
      {/* 画面ヘッダー */}
      <header className="flex items-center justify-between px-3 py-1.5 bg-white border-b border-zinc-200 shadow-sm sticky top-0 z-30">
        <div className="flex items-center gap-2 sm:gap-3">
          {/* ロゴ + ブランドタイトル */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            <img
              src={logoUrl}
              alt="BlackPoker Logo"
              className="w-6 h-6 transition-transform hover:scale-105"
            />
            <div className="flex flex-col">
              <span
                style={{ fontFamily: '"Times New Roman", Times, serif', fontWeight: 700 }}
                className="text-base tracking-wide text-zinc-950 leading-none"
              >
                BlackPoker
              </span>
              <span className="text-[8px] font-mono text-zinc-500 font-bold tracking-wider leading-none mt-0.5">
                CORE BATTLE PLAYTEST
              </span>
            </div>
          </div>

          <div className="h-4 w-px bg-zinc-300 mx-1 hidden sm:block" />

          {/* バッジ群 (PC / タブレット用) */}
          <div className="hidden sm:flex items-center gap-1.5 font-mono">
            <span className="px-1.5 py-0.2 text-[9px] font-black rounded bg-zinc-950 text-white uppercase tracking-wider">
              PLAYTEST
            </span>
            <span className="px-1.5 py-0.2 text-[9px] font-bold rounded bg-zinc-100 border border-zinc-300 text-zinc-700">
              PREVIEW
            </span>
            <span className="text-[9px] text-zinc-400 font-mono hidden md:inline">
              {(import.meta as any).env?.VITE_BUILD_SHA ? String((import.meta as any).env.VITE_BUILD_SHA).slice(0, 7) : "local"}
              {(import.meta as any).env?.VITE_BUILD_REF ? ` (${(import.meta as any).env.VITE_BUILD_REF})` : ""}
            </span>
          </div>

          {/* Regulation Selector (PC用) */}
          <div className="hidden md:flex items-center gap-1 ml-1 font-mono">
            <span className="text-[9px] font-bold text-zinc-400">Reg:</span>
            <select
              value={selectedRegulation}
              onChange={(e) => setSelectedRegulation(e.target.value)}
              className="text-[11px] font-bold py-0.5 px-1.5 rounded border border-zinc-300 bg-white text-zinc-900 focus:ring-1 focus:ring-zinc-950 focus:outline-none cursor-pointer"
            >
              <option value="core-battle">Core Battle (Preset 001)</option>
              <option value="master-extra" disabled>Master + Extra (Coming Soon)</option>
              <option value="entry-16" disabled>Entry 16 (Coming Soon)</option>
            </select>
          </div>
        </div>

        {/* コントロールボタン群 (PC用) */}
        <div className="hidden sm:flex items-center gap-2 font-mono">
          <label className="flex items-center gap-1 text-[11px] font-bold text-zinc-600 hover:text-zinc-950 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={enablePassAndPlay}
              onChange={(e) => setEnablePassAndPlay(e.target.checked)}
              className="rounded border-zinc-300 text-zinc-950 focus:ring-zinc-950"
            />
            Pass-and-Play
          </label>

          <button
            onClick={() => setShowDebug(!showDebug)}
            className={`px-2 py-0.5 text-[11px] font-bold rounded border transition ${
              showDebug
                ? "bg-zinc-950 text-white border-zinc-950"
                : "bg-white text-zinc-700 border-zinc-300 hover:text-zinc-950 hover:border-zinc-500"
            }`}
          >
            {showDebug ? "Debug ON" : "Debug"}
          </button>

          <button
            onClick={startNewGame}
            className="px-2.5 py-0.5 text-[11px] font-bold rounded bg-zinc-950 hover:bg-zinc-800 active:scale-95 text-white border border-zinc-800 shadow-sm transition"
          >
            Reset
          </button>
        </div>

        {/* Mobile メニューボタン (⋯) */}
        <div className="sm:hidden flex items-center gap-1">
          <button
            onClick={() => setIsMobileMenuOpen(true)}
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-zinc-300 bg-white hover:bg-zinc-100 active:bg-zinc-200 text-zinc-950 text-base font-bold shadow-sm transition min-h-[44px] min-w-[44px]"
            title="メニューを開く"
          >
            ⋯
          </button>
        </div>
      </header>

      {/* 2ペインメインエリア: 左 7/12 (盤面), 右 5/12 (操作/ログ) */}
      <main className="flex-1 p-2 max-w-[1440px] mx-auto w-full grid grid-cols-1 lg:grid-cols-12 gap-2 pb-24 lg:pb-2">
        {/* 左ペイン: 盤面（Player B / Stage / Player A） */}
        <div className="lg:col-span-7 flex flex-col gap-1.5">
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

          {/* 対戦相手 (Player B) の盤面 (Observation 準拠) */}
          {gameState?.players?.p2 && (
            <PlayerBoard
              playerKey="p2"
              viewModel={p2ViewModel}
              allPlayersFog={allPlayersFog}
              unitSelectionMarkers={unitSelectionMarkers}
              battleRelationMap={battleRelationMap}
              onUnitClick={handleUnitClick}
            />
          )}

          {/* 中央 STAGE パネル */}
          <StagePanel requests={gameState?.stage?.requests || []} />

          {/* 自分 (Player A) の盤面 (Observation 準拠) */}
          {gameState?.players?.p1 && (
            <PlayerBoard
              playerKey="p1"
              viewModel={p1ViewModel}
              allPlayersFog={allPlayersFog}
              unitSelectionMarkers={unitSelectionMarkers}
              battleRelationMap={battleRelationMap}
              onUnitClick={handleUnitClick}
            />
          )}
        </div>

        {/* 右ペイン: PC用 操作パネル / 対戦ログ (Desktop 時のみレンダリングして二重マウントを防止) */}
        <div className="hidden lg:flex lg:col-span-5 flex-col gap-1.5 sticky top-12 max-h-[calc(100vh-3.5rem)]">
          {/* 判断要求パネル (Decision Panel) */}
          {isDesktop && (
            currentStep?.type === "WAITING_FOR_DECISION" ? (
              <div className="shrink-0">
                {decisionPanelContent}
              </div>
            ) : (
              <div className="p-3 bg-white rounded border border-zinc-200 text-center text-xs text-zinc-500 font-mono shadow-sm">
                現在待機中の判断要求はありません
              </div>
            )
          )}

          {/* 対戦ログ (Game Log) */}
          <div className="flex-1 min-h-[200px] overflow-hidden flex flex-col">
            <GameLog logs={logs} />
          </div>

          {/* Raw Debug パネル */}
          {showDebug && (
            <div className="h-56 shrink-0">
              <DebugPanel
                state={gameState}
                currentDecisionRequest={currentStep?.type === "WAITING_FOR_DECISION" ? currentStep.request : undefined}
                rulePackage={rulePackage}
                logs={logs}
                traces={traces}
                matchLog={sessionRef.current?.getMatchLog()}
              />
            </div>
          )}
        </div>
      </main>

      {/* =========================================================================
          Mobile 用コンポーネント群 (画面下部固定 Dock / Bottom Sheet / 各種モーダル)
         ========================================================================= */}

      {/* 1. 画面下部固定 Mobile Decision Dock */}
      {currentStep?.type === "WAITING_FOR_DECISION" && (
        <MobileDecisionDock
          request={currentStep.request}
          onOpenSheet={() => setSheetMode("half")}
          onSubmit={handleDecisionSubmit}
          sheetMode={sheetMode}
        />
      )}

      {/* 2. Mobile Decision Bottom Sheet (collapsed 時でもマウントを維持して選択状態を保持) */}
      {!isDesktop && (
        <MobileBottomSheet
          mode={sheetMode}
          onModeChange={setSheetMode}
          onClose={() => setSheetMode("collapsed")}
          title={
            currentStep?.type === "WAITING_FOR_DECISION"
              ? `${currentStep.request.playerId === "p1" ? "Player A" : "Player B"} の${
                  currentStep.request.source.type === "EFFECT_RESOLUTION" ? "効果選択" : "行動選択"
                }`
              : "行動選択"
          }
        >
          {decisionPanelContent}
        </MobileBottomSheet>
      )}

      {/* 3. Mobile ヘッダーメニュー */}
      <MobileHeaderMenu
        isOpen={isMobileMenuOpen}
        onClose={() => setIsMobileMenuOpen(false)}
        selectedRegulation={selectedRegulation}
        onSelectRegulation={setSelectedRegulation}
        enablePassAndPlay={enablePassAndPlay}
        onTogglePassAndPlay={setEnablePassAndPlay}
        onOpenLogModal={() => setShowMobileLogModal(true)}
        onOpenDebugModal={() => setShowMobileDebugModal(true)}
        onResetGame={startNewGame}
      />

      {/* 4. Mobile 対戦ログモーダル */}
      {showMobileLogModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 lg:hidden animate-fade-in">
          <div className="w-full max-w-lg bg-white rounded-xl border border-zinc-300 shadow-2xl p-3 flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between border-b border-zinc-200 pb-2 mb-2">
              <h3 className="text-sm font-bold text-zinc-950 font-serif">対戦ログ (Game Log)</h3>
              <button
                onClick={() => setShowMobileLogModal(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-zinc-100 hover:bg-zinc-200 text-zinc-700 text-sm font-mono min-h-[44px] min-w-[44px]"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-hidden flex flex-col min-h-[300px]">
              <GameLog logs={logs} />
            </div>
          </div>
        </div>
      )}

      {/* 5. Mobile デバッグモーダル */}
      {showMobileDebugModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 lg:hidden animate-fade-in">
          <div className="w-full max-w-lg bg-white rounded-xl border border-zinc-300 shadow-2xl p-3 flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between border-b border-zinc-200 pb-2 mb-2">
              <h3 className="text-sm font-bold text-zinc-950 font-serif">デバッグパネル (Debug Panel)</h3>
              <button
                onClick={() => setShowMobileDebugModal(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-zinc-100 hover:bg-zinc-200 text-zinc-700 text-sm font-mono min-h-[44px] min-w-[44px]"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-hidden flex flex-col min-h-[350px]">
              <DebugPanel
                state={gameState}
                currentDecisionRequest={currentStep?.type === "WAITING_FOR_DECISION" ? currentStep.request : undefined}
                rulePackage={rulePackage}
                logs={logs}
                traces={traces}
                matchLog={sessionRef.current?.getMatchLog()}
              />
            </div>
          </div>
        </div>
      )}

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
