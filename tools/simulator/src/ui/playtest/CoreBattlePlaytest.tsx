import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { GameSession, GameSessionStep } from "../../engine/session/GameSession";
import { DecisionResponse } from "../../domain/decision/DecisionResponse";
import { PlayerKey } from "../../domain/decision/DecisionSource";
import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader";
import { getPlaytestRulePackage } from "../../engine/rules/RulePackageSelector";
import { loadRegulationCatalogForBrowser } from "../../engine/regulation/BrowserRegulationLoader";
import {
  ActiveMatchContext,
  SetupNotice,
  CORE_BATTLE_ENV_ID,
  isOfficialEnvironment,
  getAvailableEnvironments,
  startMatchAttempt,
} from "../../engine/playtest/PlaytestEnvironmentController";
import {
  PlaytestMatchMode,
  PlaytestPolicyId,
  PLAYTEST_POLICY_OPTIONS,
  PlaytestSeatControllers,
  createSeatControllers,
  isHumanSeat,
} from "../../engine/playtest/PlaytestSeatController";
import { PlaytestPolicyFactory } from "../../engine/playtest/PlaytestPolicyFactory";
import {
  advanceAutomatedDecisions,
} from "../../engine/playtest/HumanVsPolicyController";
import { ViewerAwareGameEventFormatter } from "../../engine/session/playtest/ViewerAwareGameEventFormatter";
import { ObservationFactory } from "../../engine/decision/ObservationFactory";
import { DecisionPolicy } from "../../engine/simulation/DecisionPolicy";
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
  const [catalog] = useState(() => loadRegulationCatalogForBrowser());
  const environmentOptions = useMemo(() => getAvailableEnvironments(catalog), [catalog]);
  const [rulePackage] = useState(() => getPlaytestRulePackage(fullRulePackage));
  const sessionRef = useRef<GameSession | null>(null);
  const seqRef = useRef<number>(1);

  // Pending 設定（UI入力中・対戦セッションには「新しい対戦」押下まで反映されない）
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<string>(CORE_BATTLE_ENV_ID);
  const [seedInput, setSeedInput] = useState<string>("42");
  const [pendingMatchMode, setPendingMatchMode] = useState<PlaytestMatchMode>("humanVsHuman");
  const [pendingHumanSeat, setPendingHumanSeat] = useState<"p1" | "p2">("p1");
  const [pendingPolicyId, setPendingPolicyId] = useState<PlaytestPolicyId>("firstLegal");

  // Active 設定（現在進行中の対戦セッションの設定。未成立時は null）
  const [activeMatch, setActiveMatch] = useState<ActiveMatchContext | null>(null);
  const [activeSeatControllers, setActiveSeatControllers] = useState<PlaytestSeatControllers>(() =>
    createSeatControllers("humanVsHuman")
  );
  const [activePolicies, setActivePolicies] = useState<Record<string, DecisionPolicy>>({});
  const [activeMatchMode, setActiveMatchMode] = useState<PlaytestMatchMode>("humanVsHuman");
  const [activeHumanSeat, setActiveHumanSeat] = useState<"p1" | "p2">("p1");

  // セットアップ結果通知（VALIDATION_ERROR | RULE_UNSPECIFIED | TERMINAL | TECHNICAL_ERROR）
  const [setupNotice, setSetupNotice] = useState<SetupNotice | null>(null);

  // 対戦中実行時エラー通知 (AI障害等)
  const [runtimeNotice, setRuntimeNotice] = useState<SetupNotice | null>(null);

  // AI 意思決定処理中インジケータ
  const [isAiProcessing, setIsAiProcessing] = useState<boolean>(false);

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

  // 非公式環境への切替時に SeededRandom が選択されていたら自動的に FirstLegal へフォールバック
  useEffect(() => {
    if (!isOfficialEnvironment(selectedEnvironmentId) && pendingPolicyId === "seededRandom") {
      setPendingPolicyId("firstLegal");
    }
  }, [selectedEnvironmentId, pendingPolicyId]);

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

  // 新しい対戦の開始 (Pending 設定を元に対戦開始を試行)
  const startNewGame = useCallback(
    async (
      overrideEnv?: string,
      overrideSeedInput?: string,
      overrideMode?: PlaytestMatchMode,
      overrideHumanSeat?: "p1" | "p2",
      overridePolicyId?: PlaytestPolicyId
    ) => {
      const env = overrideEnv ?? selectedEnvironmentId;
      const seed = overrideSeedInput ?? seedInput;
      const mode = overrideMode ?? pendingMatchMode;
      const humanSeat = overrideHumanSeat ?? pendingHumanSeat;
      const policyId = overridePolicyId ?? pendingPolicyId;

      // 失敗時・開始時に直前のセッション状態を安全にリセット
      sessionRef.current = null;
      setGameState(null);
      setCurrentStep(null);
      setActiveMatch(null);
      setSelectedUnitIds([]);
      setSheetMode("collapsed");
      setIsPassAndPlayWaiting(false);
      setPresetValidationErrors([]);
      setRuntimeNotice(null);
      setIsAiProcessing(false);

      const outcome = startMatchAttempt({
        environmentId: env,
        seedInput: seed,
        catalog,
        fullRulePackage,
      });

      if (outcome.type !== "READY") {
        setSetupNotice(outcome.setupNotice);
        if (outcome.presetValidationErrors && outcome.presetValidationErrors.length > 0) {
          setPresetValidationErrors([...outcome.presetValidationErrors]);
        }
        for (const l of outcome.logs) {
          addLog(l.message, l.level);
        }
        return;
      }

      // SeatControllers & Policies 生成
      const seatControllers = createSeatControllers(mode, humanSeat, policyId);
      let policies: Record<string, DecisionPolicy> = {};
      try {
        policies = PlaytestPolicyFactory.createPoliciesForMatch(seatControllers, outcome.activeMatch.seed);
      } catch (err: any) {
        setRuntimeNotice({
          type: "TECHNICAL_ERROR",
          title: "AI Policy 初期化エラー",
          message: err.message,
          environmentName: outcome.activeMatch.environmentName,
          seed: outcome.activeMatch.seed,
        });
        addLog(`[AI_ERROR] ${err.message}`, "system");
        return;
      }

      // READY 成功時のみ commit
      sessionRef.current = outcome.session;
      setGameState(JSON.parse(JSON.stringify(outcome.session.state)));
      setActiveMatch(outcome.activeMatch);
      setActiveSeatControllers(seatControllers);
      setActivePolicies(policies);
      setActiveMatchMode(mode);
      setActiveHumanSeat(humanSeat);
      setSetupNotice(null);
      setPresetValidationErrors([]);
      setLogs([]);
      setTraces([]);
      seqRef.current = 1;
      setLatestEventMessage("ゲーム開始準備完了");

      for (const l of outcome.logs) {
        addLog(l.message, l.level, l.state);
      }
      for (const t of outcome.traces) {
        addTrace(t.category, t.message, t.state);
      }

      // 初期ステップの処理
      let step = outcome.initialStep;
      if (mode === "humanVsAi") {
        const needsAiAdvance =
          step.type === "PROGRESSED" ||
          (step.type === "WAITING_FOR_DECISION" && !isHumanSeat(seatControllers, step.request.playerId));

        if (needsAiAdvance) {
          setIsPassAndPlayWaiting(false);
          const advanceLogMsg =
            step.type === "WAITING_FOR_DECISION"
              ? `AI (${step.request.playerId}) 判断のため自動実行を開始`
              : `PROGRESSED ステップのため自動進行を開始`;
          addTrace("AI_TURN_START", advanceLogMsg, outcome.session.state);
          setIsAiProcessing(true);

          const aiResult = await advanceAutomatedDecisions(
            outcome.session,
            step,
            seatControllers,
            policies,
            { viewerPlayerId: humanSeat }
          );

          setIsAiProcessing(false);

          for (const rec of aiResult.records) {
            addTrace(
              "AI_DECISION",
              `[AI ${rec.policyDescriptor.name || rec.policyDescriptor.kind}] selected Pattern #${rec.response.selectedPatternRef}`,
              rec.prevState
            );
            for (const ev of rec.generatedEvents) {
              addLog(ev.message, ev.level, rec.nextState);
              addTrace("STATE_TRANSITION", ev.message, rec.nextState);
            }
            if (rec.generatedEvents.length > 0) {
              setLatestEventMessage(rec.generatedEvents[rec.generatedEvents.length - 1].message);
            }
          }

          if (aiResult.status === "TECHNICAL_ERROR") {
            setRuntimeNotice({
              type: "TECHNICAL_ERROR",
              title: "AI Policy 実行時エラー",
              message: aiResult.error.message,
              details: aiResult.error.stack,
              environmentName: outcome.activeMatch.environmentName,
              seed: outcome.activeMatch.seed,
            });
            addLog(`[AI_ERROR] ${aiResult.error.message}`, "system");
            addTrace("AI_ERROR", aiResult.error.message, outcome.session.state);
            setCurrentStep(aiResult.lastStep || step);
            setGameState(JSON.parse(JSON.stringify(outcome.session.state)));
            return;
          }

          step = aiResult.step;
          setCurrentStep(step);
          setGameState(JSON.parse(JSON.stringify(outcome.session.state)));

          if (step.type === "WAITING_FOR_DECISION") {
            lastActivePlayerRef.current = step.request.playerId;
            setPendingPlayerKey(step.request.playerId);
            addTrace("DECISION_REQUEST", `判断待機 (${step.request.playerId})`, outcome.session.state);
          } else if (step.type === "FINISHED") {
            const nextState = outcome.session.state;
            const winnerName =
              nextState.players?.[step.result.winner || ""]?.name ||
              (step.result.winner === "p1" ? "Player A" : "Player B");
            addLog(`[FINISH] ゲーム終了: 勝者【${winnerName}】(${step.result.reason})`, "system", nextState);
            addTrace("GAME_FINISHED", `勝者: ${winnerName} (${step.result.reason})`, nextState);
          }
          return;
        }
      }

      // Human 手番または Human vs Human または FINISHED
      if (step.type === "WAITING_FOR_DECISION") {
        const initPlayer = step.request.playerId;
        lastActivePlayerRef.current = initPlayer;
        setPendingPlayerKey(initPlayer);
        if (mode === "humanVsHuman" && enablePassAndPlay) {
          setIsPassAndPlayWaiting(true);
        }
        addTrace("DECISION_REQUEST", `判断待機 (${initPlayer})`, outcome.session.state);
        setCurrentStep(step);
      } else {
        setCurrentStep(step);
      }
    },
    [
      selectedEnvironmentId,
      seedInput,
      pendingMatchMode,
      pendingHumanSeat,
      pendingPolicyId,
      catalog,
      fullRulePackage,
      enablePassAndPlay,
      addLog,
      addTrace,
    ]
  );

  // 初回マウント時にのみ1回ゲーム初期化
  const initialStartRef = useRef(false);
  useEffect(() => {
    if (!initialStartRef.current) {
      initialStartRef.current = true;
      startNewGame(CORE_BATTLE_ENV_ID, "42");
    }
  }, [startNewGame]);

  // 盤面ユニットクリック時のトグルハンドラ
  const handleUnitClick = useCallback(
    (unitId: string) => {
      if (!unitSelectionMarkers.has(unitId)) return;

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

  // 共通 Decision 提出パイプライン (Human提出 -> 状態反映 -> 次がAIなら自動連鎖進行)
  const handleDecisionSubmit = useCallback(
    async (response: DecisionResponse, options?: { autoPass?: boolean }) => {
      const session = sessionRef.current;
      if (!session) return;

      // モバイル Bottom Sheet を最小化
      setSheetMode("collapsed");

      // 1. Human の判断を提出
      let prevState = JSON.parse(JSON.stringify(session.state));
      const selectedPattern =
        currentStep?.type === "WAITING_FOR_DECISION"
          ? currentStep.request.patterns[response.selectedPatternRef]
          : undefined;
      const category = selectedPattern?.kind === "PASS" ? "PASS" : "DECISION_SUBMIT";
      addTrace(
        category,
        `判断送信 (Pattern #${response.selectedPatternRef}: ${selectedPattern?.patternId || ""})`,
        prevState
      );

      let nextStep = session.submitDecision(response);
      let nextState = JSON.parse(JSON.stringify(session.state));

      // 選択状態をリセット
      setSelectedUnitIds([]);

      // State 遷移からイベントログを自動生成・蓄積 (Human vs AI では閲覧者視点で非公開情報秘匿)
      const viewer = activeMatchMode === "humanVsAi" ? activeHumanSeat : undefined;
      const generatedEvents = ViewerAwareGameEventFormatter.formatStateTransition(
        prevState,
        nextState,
        viewer
      );
      for (const ev of generatedEvents) {
        addLog(ev.message, ev.level, nextState);
        addTrace("STATE_TRANSITION", ev.message, nextState);
      }

      // 「リクエスト＆PASS」が指定されており、次のステップが同一プレイヤーの判断要求（PASS可能）なら自動PASS (Human操作補助)
      if (
        options?.autoPass &&
        nextStep.type === "WAITING_FOR_DECISION" &&
        currentStep?.type === "WAITING_FOR_DECISION" &&
        nextStep.request.playerId === currentStep.request.playerId &&
        isHumanSeat(activeSeatControllers, nextStep.request.playerId)
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

          const autoEvents = ViewerAwareGameEventFormatter.formatStateTransition(
            prevState,
            nextState,
            viewer
          );
          for (const ev of autoEvents) {
            addLog(ev.message, ev.level, nextState);
            addTrace("STATE_TRANSITION", ev.message, nextState);
          }
        }
      }

      if (generatedEvents.length > 0) {
        setLatestEventMessage(generatedEvents[generatedEvents.length - 1].message);
      }

      // 2. 次の手番が AI (POLICY) または PROGRESSED の場合、自動進行ループを実行
      const shouldAutoAdvance =
        activeMatchMode === "humanVsAi" &&
        (nextStep.type === "PROGRESSED" ||
          (nextStep.type === "WAITING_FOR_DECISION" &&
            !isHumanSeat(activeSeatControllers, nextStep.request.playerId)));

      if (shouldAutoAdvance) {
        setIsAiProcessing(true);

        const aiResult = await advanceAutomatedDecisions(
          session,
          nextStep,
          activeSeatControllers,
          activePolicies,
          { viewerPlayerId: activeHumanSeat }
        );

        setIsAiProcessing(false);

        for (const rec of aiResult.records) {
          addTrace(
            "AI_DECISION",
            `[AI ${rec.policyDescriptor.name || rec.policyDescriptor.kind}] selected Pattern #${rec.response.selectedPatternRef}`,
            rec.prevState
          );
          for (const ev of rec.generatedEvents) {
            addLog(ev.message, ev.level, rec.nextState);
            addTrace("STATE_TRANSITION", ev.message, rec.nextState);
          }
          if (rec.generatedEvents.length > 0) {
            setLatestEventMessage(rec.generatedEvents[rec.generatedEvents.length - 1].message);
          }
        }

        if (aiResult.status === "TECHNICAL_ERROR") {
          setRuntimeNotice({
            type: "TECHNICAL_ERROR",
            title: "AI Policy 実行時エラー",
            message: aiResult.error.message,
            details: aiResult.error.stack,
            environmentName: activeMatch?.environmentName || "",
            seed: activeMatch?.seed,
          });
          addLog(`[AI_ERROR] ${aiResult.error.message}`, "system");
          addTrace("AI_ERROR", aiResult.error.message, session.state);
          setCurrentStep(aiResult.lastStep || nextStep);
          setGameState(JSON.parse(JSON.stringify(session.state)));
          return;
        }

        nextStep = aiResult.step;
        nextState = JSON.parse(JSON.stringify(session.state));
      }

      setCurrentStep(nextStep);
      setGameState(nextState);

      // プレイヤー交代時の Pass-and-Play オーバーレイ制御 (Human vs Human のみ)
      if (nextStep.type === "WAITING_FOR_DECISION") {
        const newPlayerId = nextStep.request.playerId;
        if (
          activeMatchMode === "humanVsHuman" &&
          enablePassAndPlay &&
          newPlayerId !== lastActivePlayerRef.current
        ) {
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
    [
      activeMatchMode,
      activeHumanSeat,
      activeSeatControllers,
      activePolicies,
      activeMatch,
      enablePassAndPlay,
      currentStep,
      addLog,
      addTrace,
    ]
  );

  // Pass-and-Play 準備完了ハンドラ
  const handlePassAndPlayReady = useCallback(() => {
    setIsPassAndPlayWaiting(false);
  }, []);

  // UI 閲覧者視点 ID: Human vs AI の時は常に activeHumanSeat に完全固定
  const uiViewerPlayerId: PlayerKey =
    activeMatchMode === "humanVsAi"
      ? activeHumanSeat
      : (currentStep?.type === "WAITING_FOR_DECISION"
          ? (currentStep.request.playerId as PlayerKey)
          : ((gameState?.chancePlayer as PlayerKey) || "p1"));

  // 通常盤面表示用 Observation (常に uiViewerPlayerId 視点から生成し、AI の秘密情報を完全秘匿)
  const boardObservation = useMemo(() => {
    if (!gameState) return undefined;
    return ObservationFactory.createObservation(gameState, uiViewerPlayerId);
  }, [gameState, uiViewerPlayerId]);

  // 全プレイヤーの Fog (boardObservation 基準)
  const allPlayersFog = useMemo(() => {
    const fogs: any[] = [];
    if (boardObservation?.players && Array.isArray(boardObservation.players)) {
      for (const p of boardObservation.players) {
        if (Array.isArray(p.fog)) {
          for (const f of p.fog) {
            fogs.push(f);
          }
        }
      }
    }
    return fogs;
  }, [boardObservation]);

  // 戦闘関係番号プレゼンテーション (①, ②, ...) の生成 (boardObservation 基準)
  const battleRelationMap = useMemo(() => {
    return BattleRelationPresenter.buildPresentationMap(gameState, boardObservation);
  }, [gameState, boardObservation]);

  // decisionId 切替時の盤面選択リセット & モバイルシート最小化
  useEffect(() => {
    setSelectedUnitIds([]);
    setSheetMode("collapsed");
  }, [currentStep?.type === "WAITING_FOR_DECISION" ? currentStep.request.decisionId : null]);

  // 人間プレイヤーの判断待機中フラグ
  const isHumanTurnWaiting =
    currentStep?.type === "WAITING_FOR_DECISION" &&
    (activeMatchMode === "humanVsHuman" || currentStep.request.playerId === activeHumanSeat) &&
    !isAiProcessing;

  // キーボードショートカット (P: PASS)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isPassAndPlayWaiting || isAiProcessing || !isHumanTurnWaiting) return;
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
  }, [currentStep, isPassAndPlayWaiting, isAiProcessing, isHumanTurnWaiting, handleDecisionSubmit]);

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
            onClick={() => startNewGame()}
            className="w-full py-2 bg-zinc-950 hover:bg-zinc-800 text-white font-bold rounded shadow transition text-xs font-mono min-h-[44px]"
          >
            再試行 (Retry)
          </button>
        </div>
      </div>
    );
  }

  if (!gameState && !setupNotice && !runtimeNotice) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f7f7f8] text-zinc-950 font-sans">
        <div className="flex flex-col items-center gap-2">
          <img src={logoUrl} alt="BlackPoker" className="w-8 h-8 animate-pulse" />
          <div className="text-xs font-mono font-bold tracking-widest text-zinc-600 uppercase">
            BlackPoker Initializing...
          </div>
        </div>
      </div>
    );
  }

  // PlayerBoardViewModel の生成 (通常盤面は常に boardObservation 準拠)
  const p1ViewModel = gameState
    ? PlayerObservationPresenter.buildPlayerViewModel(
        "p1",
        boardObservation,
        gameState,
        uiViewerPlayerId
      )
    : null;
  const p2ViewModel = gameState
    ? PlayerObservationPresenter.buildPlayerViewModel(
        "p2",
        boardObservation,
        gameState,
        uiViewerPlayerId
      )
    : null;

  // DecisionPanel のコンテンツ生成 (人間待機中のみ表示し、AI Step の patterns は非表示)
  const decisionPanelContent = isHumanTurnWaiting ? (
    <DecisionPanel
      key={currentStep.request.decisionId}
      request={currentStep.request}
      onSubmit={handleDecisionSubmit}
      onSelectionMarkersChange={setUnitSelectionMarkers}
      selectedUnitIdsFromBoard={selectedUnitIds}
    />
  ) : isAiProcessing ? (
    <div className="p-4 bg-white rounded border border-zinc-200 text-center font-mono shadow-sm">
      <div className="text-xs font-bold text-zinc-800 animate-pulse">AI 操作中…</div>
      <div className="text-[10px] text-zinc-500 mt-1">AI が手番・効果の判断を行っています</div>
    </div>
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
                SIMULATOR PLAYTEST
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

          {/* Environment Selector & Seed (PC用・Catalog由来動的列挙) */}
          <div className="hidden md:flex items-center gap-1.5 ml-1 font-mono">
            <span className="text-[9px] font-bold text-zinc-400">Env:</span>
            <select
              value={selectedEnvironmentId}
              onChange={(e) => setSelectedEnvironmentId(e.target.value)}
              className="text-[11px] font-bold py-0.5 px-1.5 rounded border border-zinc-300 bg-white text-zinc-900 focus:ring-1 focus:ring-zinc-950 focus:outline-none cursor-pointer"
            >
              {environmentOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.name}
                </option>
              ))}
            </select>

            {isOfficialEnvironment(selectedEnvironmentId) && (
              <>
                <span className="text-[9px] font-bold text-zinc-400 ml-1">Seed:</span>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={seedInput}
                  onChange={(e) => setSeedInput(e.target.value)}
                  className="w-16 text-[11px] font-mono font-bold py-0.5 px-1 rounded border border-zinc-300 bg-white text-zinc-900 focus:ring-1 focus:ring-zinc-950 focus:outline-none text-right"
                  placeholder="42"
                />
              </>
            )}

            {/* 対戦モード & AI 設定 (PC用) */}
            <span className="text-[9px] font-bold text-zinc-400 ml-1.5">Mode:</span>
            <select
              value={pendingMatchMode}
              onChange={(e) => setPendingMatchMode(e.target.value as PlaytestMatchMode)}
              className="text-[11px] font-bold py-0.5 px-1.5 rounded border border-zinc-300 bg-white text-zinc-900 focus:ring-1 focus:ring-zinc-950 focus:outline-none cursor-pointer"
            >
              <option value="humanVsHuman">Human vs Human</option>
              <option value="humanVsAi">Human vs AI</option>
            </select>

            {pendingMatchMode === "humanVsAi" && (
              <>
                <span className="text-[9px] font-bold text-zinc-400 ml-1">Human:</span>
                <select
                  value={pendingHumanSeat}
                  onChange={(e) => setPendingHumanSeat(e.target.value as "p1" | "p2")}
                  className="text-[11px] font-bold py-0.5 px-1.5 rounded border border-zinc-300 bg-white text-zinc-900 focus:ring-1 focus:ring-zinc-950 focus:outline-none cursor-pointer"
                >
                  <option value="p1">p1 (Player A)</option>
                  <option value="p2">p2 (Player B)</option>
                </select>

                <span className="text-[9px] font-bold text-zinc-400 ml-1">AI:</span>
                <select
                  value={pendingPolicyId}
                  onChange={(e) => setPendingPolicyId(e.target.value as PlaytestPolicyId)}
                  className="text-[11px] font-bold py-0.5 px-1.5 rounded border border-zinc-300 bg-white text-zinc-900 focus:ring-1 focus:ring-zinc-950 focus:outline-none cursor-pointer"
                >
                  {PLAYTEST_POLICY_OPTIONS.map((opt) => (
                    <option
                      key={opt.id}
                      value={opt.id}
                      disabled={opt.requiresSeed && !isOfficialEnvironment(selectedEnvironmentId)}
                    >
                      {opt.label}{opt.requiresSeed && !isOfficialEnvironment(selectedEnvironmentId) ? " (Official専用)" : ""}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>
        </div>

        {/* コントロールボタン群 (PC用) */}
        <div className="hidden sm:flex items-center gap-2 font-mono">
          {pendingMatchMode === "humanVsHuman" && (
            <label className="flex items-center gap-1 text-[11px] font-bold text-zinc-600 hover:text-zinc-950 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={enablePassAndPlay}
                onChange={(e) => setEnablePassAndPlay(e.target.checked)}
                className="rounded border-zinc-300 text-zinc-950 focus:ring-zinc-950"
              />
              Pass-and-Play
            </label>
          )}

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
            onClick={() => startNewGame()}
            className="px-2.5 py-0.5 text-[11px] font-bold rounded bg-zinc-950 hover:bg-zinc-800 active:scale-95 text-white border border-zinc-800 shadow-sm transition"
          >
            新しい対戦
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
          {/* セットアップ通知バナー (VALIDATION_ERROR | RULE_UNSPECIFIED | TERMINAL | TECHNICAL_ERROR) */}
          {setupNotice && (
            <div className={`p-3 rounded border font-mono ${
              setupNotice.type === "RULE_UNSPECIFIED"
                ? "bg-amber-50 border-amber-300 text-amber-950"
                : setupNotice.type === "VALIDATION_ERROR"
                ? "bg-rose-50 border-rose-300 text-rose-950"
                : setupNotice.type === "TERMINAL"
                ? "bg-blue-50 border-blue-300 text-blue-950"
                : "bg-red-50 border-red-300 text-red-950"
            }`}>
              <div className="flex items-center gap-2 font-bold text-sm">
                <span className={`px-1.5 py-0.5 rounded text-xs text-white ${
                  setupNotice.type === "RULE_UNSPECIFIED"
                    ? "bg-amber-600"
                    : setupNotice.type === "VALIDATION_ERROR"
                    ? "bg-rose-600"
                    : setupNotice.type === "TERMINAL"
                    ? "bg-blue-600"
                    : "bg-red-600"
                }`}>
                  {setupNotice.type}
                </span>
                <span>{setupNotice.title}</span>
              </div>
              <p className="text-xs mt-1">{setupNotice.message}</p>
              {setupNotice.details && (
                <p className="text-[11px] text-zinc-600 mt-0.5">{setupNotice.details}</p>
              )}
              {!gameState && (
                <p className="text-xs text-zinc-500 mt-2">
                  ※ 設定またはSeedを確認し、上部の「新しい対戦」ボタンを押してください。
                </p>
              )}
            </div>
          )}

          {/* 対戦中実行時エラー通知バナー (AI 技術的障害等) */}
          {runtimeNotice && (
            <div className="p-3 rounded border font-mono bg-red-50 border-red-300 text-red-950">
              <div className="flex items-center gap-2 font-bold text-sm">
                <span className="px-1.5 py-0.5 rounded text-xs text-white bg-red-600">
                  {runtimeNotice.type}
                </span>
                <span>{runtimeNotice.title}</span>
              </div>
              <p className="text-xs mt-1">{runtimeNotice.message}</p>
              {runtimeNotice.details && (
                <p className="text-[11px] text-zinc-600 mt-0.5">{runtimeNotice.details}</p>
              )}
              <p className="text-xs text-zinc-500 mt-2">
                ※ 対戦が安全に停止しました。上部の「新しい対戦」ボタンから再開できます。
              </p>
            </div>
          )}

          {/* ゲーム進行ステータスバー */}
          {gameState && activeMatch && (
            <GameStatusBar
              environmentName={
                activeMatchMode === "humanVsAi"
                  ? `${activeMatch.environmentName} [Human(${activeHumanSeat}) vs AI]`
                  : activeMatch.environmentName
              }
              matchSeed={activeMatch.seed}
              stateVersion={gameState.stateVersion ?? gameState.version}
              turnPlayer={gameState.turnPlayer}
              chancePlayer={gameState.chancePlayer}
              turnCount={gameState.turnCount}
              players={gameState.players}
              latestEventMessage={latestEventMessage}
            />
          )}

          {/* 対戦相手 (Player B) の盤面 (Observation 準拠) */}
          {p2ViewModel && gameState?.players?.p2 && (
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
          {gameState && <StagePanel requests={gameState?.stage?.requests || []} />}

          {/* 自分 (Player A) の盤面 (Observation 準拠) */}
          {p1ViewModel && gameState?.players?.p1 && (
            <PlayerBoard
              playerKey="p1"
              viewModel={p1ViewModel}
              allPlayersFog={allPlayersFog}
              unitSelectionMarkers={unitSelectionMarkers}
              battleRelationMap={battleRelationMap}
              onUnitClick={handleUnitClick}
            />
          )}

          {/* セッション未開始時のプレースホルダー */}
          {!gameState && (
            <div className="p-8 flex flex-col items-center justify-center bg-zinc-50 border border-zinc-200 rounded text-center my-auto">
              <span className="text-sm font-bold text-zinc-700 font-mono">対戦セッションが開始されていません</span>
              <span className="text-xs text-zinc-500 font-mono mt-1">
                上部の設定・Seed を確認し、「新しい対戦」ボタンを押してください。
              </span>
            </div>
          )}
        </div>

        {/* 右ペイン: PC用 操作パネル / 対戦ログ */}
        <div className="hidden lg:flex lg:col-span-5 flex-col gap-1.5 sticky top-12 max-h-[calc(100vh-3.5rem)]">
          {/* 判断要求パネル (Decision Panel) */}
          {isDesktop && (
            isHumanTurnWaiting ? (
              <div className="shrink-0">{decisionPanelContent}</div>
            ) : isAiProcessing ? (
              <div className="p-3 bg-white rounded border border-zinc-200 text-center text-xs font-mono shadow-sm">
                <span className="font-bold text-zinc-800 animate-pulse">AI 操作中…</span>
                <span className="text-zinc-500 ml-2">自動思考しています</span>
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
              {activeMatch ? (
                <DebugPanel
                  state={gameState}
                  currentDecisionRequest={currentStep?.type === "WAITING_FOR_DECISION" ? currentStep.request : undefined}
                  rulePackage={activeMatch.rulePackage}
                  logs={logs}
                  traces={traces}
                  matchLog={sessionRef.current?.getMatchLog()}
                />
              ) : (
                <div className="h-full flex items-center justify-center bg-zinc-100 rounded border border-zinc-300 text-xs font-mono text-zinc-500">
                  進行中の対戦はありません (Active Match なし)
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* =========================================================================
          Mobile 用コンポーネント群 (画面下部固定 Dock / Bottom Sheet / 各種モーダル)
         ========================================================================= */}

      {/* 1. 画面下部固定 Mobile Decision Dock (人間待機中のみ表示) */}
      {isHumanTurnWaiting && currentStep?.type === "WAITING_FOR_DECISION" && (
        <MobileDecisionDock
          request={currentStep.request}
          onOpenSheet={() => setSheetMode("half")}
          onSubmit={handleDecisionSubmit}
          sheetMode={sheetMode}
        />
      )}

      {/* 2. Mobile Decision Bottom Sheet */}
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
        selectedEnvironmentId={selectedEnvironmentId}
        onSelectEnvironment={setSelectedEnvironmentId}
        environmentOptions={environmentOptions}
        showSeedInput={isOfficialEnvironment(selectedEnvironmentId)}
        seedInput={seedInput}
        onSeedInputChange={setSeedInput}
        matchMode={pendingMatchMode}
        onSelectMatchMode={setPendingMatchMode}
        humanSeat={pendingHumanSeat}
        onSelectHumanSeat={setPendingHumanSeat}
        policyId={pendingPolicyId}
        onSelectPolicyId={setPendingPolicyId}
        isOfficialEnvironment={isOfficialEnvironment(selectedEnvironmentId)}
        enablePassAndPlay={enablePassAndPlay}
        onTogglePassAndPlay={setEnablePassAndPlay}
        onOpenLogModal={() => setShowMobileLogModal(true)}
        onOpenDebugModal={() => setShowMobileDebugModal(true)}
        onResetGame={() => startNewGame()}
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
              {activeMatch ? (
                <DebugPanel
                  state={gameState}
                  currentDecisionRequest={currentStep?.type === "WAITING_FOR_DECISION" ? currentStep.request : undefined}
                  rulePackage={activeMatch.rulePackage}
                  logs={logs}
                  traces={traces}
                  matchLog={sessionRef.current?.getMatchLog()}
                />
              ) : (
                <div className="flex-1 flex items-center justify-center bg-zinc-100 rounded border border-zinc-300 text-xs font-mono text-zinc-500 min-h-[350px]">
                  進行中の対戦はありません (Active Match なし)
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Pass-and-Play 交代オーバーレイ (Human vs Human のみ) */}
      {activeMatchMode === "humanVsHuman" && isPassAndPlayWaiting && (
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
          onRestart={() => startNewGame()}
        />
      )}
    </div>
  );
};
