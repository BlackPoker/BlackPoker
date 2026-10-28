import { DecisionRequest } from "../../domain/decision/DecisionRequest";
import { DecisionResponse } from "../../domain/decision/DecisionResponse";
import { TargetSelection } from "../../domain/decision/DecisionCatalog";
import { PlayerKey, RequestRef, RULE_SYSTEM_CHANCE } from "../../domain/decision/DecisionSource";
import { RulePackage } from "../../domain/rules/RulePackage";
import { CommandRegistry } from "../rules/CommandRegistry";
import { LegalPatternGenerator } from "../decision/LegalPatternGenerator";
import { PatternExecutor } from "../decision/PatternExecutor";
import { CoreFlowCoordinator, CoreFlowEvent } from "./CoreFlowCoordinator";
import { PassTracker } from "./PassTracker";
import { TriggerProcessingCoordinator } from "../rules/TriggerProcessingCoordinator";
import { MatchLogRecorder, MatchLogRecorderOptions } from "../log/MatchLogRecorder";
import { CanonicalMatchLog } from "../../domain/log/CanonicalMatchLog";
import {
  GameSessionSnapshot,
  GameSessionSnapshotSessionData,
} from "../../domain/session/GameSessionSnapshot";
import { GameSessionSnapshotCodec } from "./GameSessionSnapshotCodec";
import { GraveTopCoordinator } from "../rules/GraveTopCoordinator";

/**
 * 即時誘発アクションの効果実行完了後、墓地TOP選択待ちを表す汎用ステップID
 */
export const TRIGGER_IMMEDIATE_FINALIZATION_STEP_ID = "triggerImmediateFinalization";

/**
 * 将来の効果解決中断・再開用コンティニュエーション型
 */
export interface EffectContinuation {
  readonly sourceRequestId: RequestRef;
  readonly effectPath: readonly number[];
  readonly effectStepId: string;
  readonly selectionId: string;
}

/**
 * 将来の効果解決結果型
 */
export type EffectExecutionResult =
  | {
      readonly type: "COMPLETED";
    }
  | {
      readonly type: "WAITING_FOR_DECISION";
      readonly request: DecisionRequest;
      readonly continuation: EffectContinuation;
    };

export interface GameResult {
  readonly winner?: PlayerKey;
  readonly reason: string;
}

export type GameSessionStep =
  | {
      readonly type: "PROGRESSED";
      readonly events?: readonly CoreFlowEvent[];
    }
  | {
      readonly type: "WAITING_FOR_DECISION";
      readonly request: DecisionRequest;
      readonly lastEvent?: CoreFlowEvent;
    }
  | {
      readonly type: "FINISHED";
      readonly result: GameResult;
    };

/**
 * ゲームの進行と判断の待機・適用を管理するセッションマネージャー。
 */
export class GameSession {
  public state: any;
  public rulePackage: RulePackage;
  public registry: CommandRegistry;
  public matchId: string;
  public readonly matchSeed?: number;
  public pendingDecision?: DecisionRequest;
  public continuation?: EffectContinuation;
  public resolvingRequest?: any;
  public resolvingContext?: any;
  public passTracker: PassTracker;
  public logRecorder: MatchLogRecorder;
  private triggerCoordinator: TriggerProcessingCoordinator;
  private matchStartedRecorded = false;
  private lastRecordedTurnPlayer?: string;
  /**
   * コアフロー[12]〜[13]において、全員パス成立後にステージ最上段を1件解決すべき状態かどうかを表す内部フラグ。
   * 1件の解決が開始された時点で false になり、その解決および誘発チェック[5]が完了するまで
   * state.chancePlayer === "system" は維持されますが、2件目以降のステージリクエストは自動解決されません。
   */
  private stageTopResolutionPending = false;
  /**
   * コアフロー[4]〜[10]において、直接リクエストされたアクションの解決および誘発チェック[5]が完了した直後に
   * フォーカスを設定すべきリクエスト実行プレイヤー。
   */
  private pendingDirectFocusPlayer?: PlayerKey;

  public get stateVersion(): number {
    return this.state.stateVersion ?? this.state.version ?? 1;
  }

  public set stateVersion(v: number) {
    this.state.stateVersion = v;
    this.state.version = v;
  }

  constructor(
    state: any,
    rulePackage: RulePackage,
    options?: {
      matchId?: string;
      matchSeed?: number;
      registry?: CommandRegistry;
      passTracker?: PassTracker;
      logRecorder?: MatchLogRecorder;
      logOptions?: MatchLogRecorderOptions;
    }
  ) {
    this.state = state;
    if (this.state.stateVersion === undefined) {
      this.state.stateVersion = this.state.version || 1;
    }
    // ゲーム開始時の3要素（手番・チャンス・フォーカス）整合化（コアフロー[1]）
    if (this.state.turnPlayer && !this.state.focusPlayer) {
      this.state.focusPlayer =
        this.state.chancePlayer && this.state.chancePlayer !== RULE_SYSTEM_CHANCE
          ? this.state.chancePlayer
          : this.state.turnPlayer;
    }
    this.rulePackage = rulePackage;
    this.registry = options?.registry || new CommandRegistry();
    this.matchSeed = options?.matchSeed;
    this.registry.setMatchSeed(this.matchSeed);
    this.matchId = options?.matchId || `match-${Date.now()}`;
    this.passTracker = options?.passTracker || new PassTracker();
    this.triggerCoordinator = new TriggerProcessingCoordinator();

    this.logRecorder =
      options?.logRecorder ||
      new MatchLogRecorder({
        matchId: this.matchId,
        rulesVersion: this.rulePackage?.version,
        rulePackageRef: this.rulePackage?.id,
        ...(options?.logOptions || {}),
      });

    this.registry.logRecorder = this.logRecorder;
  }

  /**
   * 現在の CanonicalMatchLog を取得
   */
  getMatchLog(): CanonicalMatchLog {
    return this.logRecorder.getMatchLog();
  }

  /**
   * Snapshot コーデック用の内部セッション状態 DTO をエクスポート (Encapsulation 準拠)
   */
  exportSnapshotSessionData(): GameSessionSnapshotSessionData {
    let resolvingContextData = undefined;
    if (this.resolvingContext) {
      resolvingContextData = {
        playerKey: this.resolvingContext.playerKey,
        keyCardIds: this.resolvingContext.keyCards?.map((c: any) => c.id),
        keyCards: this.resolvingContext.keyCards
          ? JSON.parse(JSON.stringify(this.resolvingContext.keyCards))
          : undefined,
        targetComponent: this.resolvingContext.targetComponent
          ? JSON.parse(JSON.stringify(this.resolvingContext.targetComponent))
          : undefined,
        targetRequest: this.resolvingContext.targetRequest
          ? JSON.parse(JSON.stringify(this.resolvingContext.targetRequest))
          : undefined,
        targetPlayerKey: this.resolvingContext.targetPlayerKey,
        selections: this.resolvingContext.selections
          ? JSON.parse(JSON.stringify(this.resolvingContext.selections))
          : undefined,
        sourceEvent: this.resolvingContext.sourceEvent
          ? JSON.parse(JSON.stringify(this.resolvingContext.sourceEvent))
          : undefined,
        currentActionId: this.resolvingContext.currentAction?.id,
        currentRequestId: this.resolvingContext.currentRequest?.id,
      };
    }

    let resolvingRequestCopy = undefined;
    if (this.resolvingRequest) {
      resolvingRequestCopy = JSON.parse(JSON.stringify(this.resolvingRequest));
      if (resolvingRequestCopy.action) {
        delete resolvingRequestCopy.action;
      }
    }

    return {
      matchSeed: this.matchSeed,
      consecutivePassCount: this.passTracker.consecutivePassCount,
      pendingDecision: this.pendingDecision
        ? JSON.parse(JSON.stringify(this.pendingDecision))
        : undefined,
      continuation: this.continuation
        ? JSON.parse(JSON.stringify(this.continuation))
        : undefined,
      resolvingRequest: resolvingRequestCopy,
      resolvingContext: resolvingContextData,
      matchStartedRecorded: this.matchStartedRecorded,
      lastRecordedTurnPlayer: this.lastRecordedTurnPlayer,
      pendingDirectFocusPlayer: this.pendingDirectFocusPlayer,
    };
  }

  /**
   * Snapshot コーデック用の内部セッション状態 DTO をインポート (Encapsulation 準拠)
   */
  importSnapshotSessionData(data: GameSessionSnapshotSessionData): void {
    this.matchStartedRecorded = data.matchStartedRecorded;
    this.lastRecordedTurnPlayer = data.lastRecordedTurnPlayer;
    this.pendingDirectFocusPlayer = data.pendingDirectFocusPlayer as PlayerKey | undefined;

    if (data.pendingDecision) {
      this.pendingDecision = JSON.parse(JSON.stringify(data.pendingDecision));
    }

    if (data.continuation) {
      this.continuation = JSON.parse(JSON.stringify(data.continuation));
    }

    // resolvingRequest の復元 (GameState 内の Request と同一参照を優先)
    if (data.resolvingRequest) {
      const reqData = data.resolvingRequest;
      let matchedReq: any = undefined;

      if (this.state.stage?.requests) {
        matchedReq = this.state.stage.requests.find((r: any) => r.id === reqData.id);
      }
      if (!matchedReq && this.state.requestBuffer?.requests) {
        matchedReq = this.state.requestBuffer.requests.find((r: any) => r.id === reqData.id);
      }

      if (matchedReq) {
        if (reqData.actionId && !matchedReq.action) {
          matchedReq.action = this.rulePackage.actions.find((a) => a.id === reqData.actionId);
        }
        this.resolvingRequest = matchedReq;
      } else {
        const reqCopy = JSON.parse(JSON.stringify(reqData));
        if (reqCopy.actionId) {
          reqCopy.action = this.rulePackage.actions.find((a) => a.id === reqCopy.actionId);
        }
        this.resolvingRequest = reqCopy;
      }
    }

    // resolvingContext の再構築
    if (data.resolvingContext) {
      const ctxData = data.resolvingContext;
      const currentAction = ctxData.currentActionId
        ? this.rulePackage.actions.find((a) => a.id === ctxData.currentActionId)
        : this.resolvingRequest?.action;

      this.resolvingContext = {
        state: this.state,
        actions: this.rulePackage.actions,
        components: this.rulePackage.components,
        playerKey: ctxData.playerKey,
        keyCards: ctxData.keyCards ? JSON.parse(JSON.stringify(ctxData.keyCards)) : undefined,
        keyCard: ctxData.keyCards && ctxData.keyCards.length > 0 ? ctxData.keyCards[0] : undefined,
        targetComponent: ctxData.targetComponent
          ? JSON.parse(JSON.stringify(ctxData.targetComponent))
          : undefined,
        targetRequest: ctxData.targetRequest
          ? JSON.parse(JSON.stringify(ctxData.targetRequest))
          : undefined,
        targetPlayerKey: ctxData.targetPlayerKey,
        selections: ctxData.selections ? JSON.parse(JSON.stringify(ctxData.selections)) : undefined,
        sourceEvent: ctxData.sourceEvent ? JSON.parse(JSON.stringify(ctxData.sourceEvent)) : undefined,
        currentAction,
        currentRequest: this.resolvingRequest,
        logRecorder: this.logRecorder,
        matchSeed: this.matchSeed,
      };
    }
  }

  /**
   * 現在のセッションから JSON-safe な Snapshot DTO を生成
   */
  createSnapshot(): GameSessionSnapshot {
    return GameSessionSnapshotCodec.capture(this);
  }

  /**
   * Snapshot DTO と RulePackage から GameSession を復元 (Resume)
   */
  static fromSnapshot(snapshot: GameSessionSnapshot, rulePackage: RulePackage): GameSession {
    return GameSessionSnapshotCodec.restore(snapshot, rulePackage);
  }

  /**
   * ゲームを自動的に進め、プレイヤーの判断が必要な場合は WAITING_FOR_DECISION を返します。
   */
  advance(): GameSessionStep {
    // 0. マッチ開始イベント（初回のみ・コアフロー[1]）
    if (!this.matchStartedRecorded) {
      this.matchStartedRecorded = true;
      const initialTurnPlayer: PlayerKey = this.state.turnPlayer || "p1";
      const initialChancePlayer: PlayerKey =
        this.state.chancePlayer && this.state.chancePlayer !== RULE_SYSTEM_CHANCE
          ? this.state.chancePlayer
          : initialTurnPlayer;
      if (!this.state.focusPlayer) {
        this.state.focusPlayer = initialChancePlayer;
      }
      const initialFocusPlayer: PlayerKey = this.state.focusPlayer;
      this.lastRecordedTurnPlayer = initialTurnPlayer;
      this.logRecorder.record({
        type: "match.started",
        stateVersion: this.stateVersion,
        matchId: this.matchId,
        turnPlayer: initialTurnPlayer,
        chancePlayer: initialChancePlayer,
        focusPlayer: initialFocusPlayer,
        initialPlayers: Object.keys(this.state.players || {}),
      });
    }

    // 0.5. すでに待機中の判断がある場合はそれを返す（勝敗判定より優先）
    if (this.pendingDecision) {
      return {
        type: "WAITING_FOR_DECISION",
        request: this.pendingDecision,
      };
    }

    // 0.6. 保留中のGrave TOP選択がある場合はそれを要求（勝敗判定より優先）
    if (this.state.pendingGraveTopSelections && this.state.pendingGraveTopSelections.length > 0) {
      const nextPending = this.state.pendingGraveTopSelections[0];
      this.pendingDecision = GraveTopCoordinator.createDecisionRequest(
        this.state,
        nextPending,
        {
          stateVersion: this.stateVersion,
          matchId: this.matchId,
        }
      );
      this.logRecorder.record({
        type: "decision.requested",
        stateVersion: this.stateVersion,
        decisionId: this.pendingDecision.decisionId,
        playerId: this.pendingDecision.playerId,
        source: this.pendingDecision.source.type,
        requestId: (this.pendingDecision.source as any).requestId,
        legalPatternCount: this.pendingDecision.patterns.length,
        legalPatternRefs: this.pendingDecision.patterns.map((_, i) => i),
      });
      return {
        type: "WAITING_FOR_DECISION",
        request: this.pendingDecision,
      };
    }

    // 1. 勝敗判定（ライフ 0 判定）
    const finishCheck = this.checkGameFinished();

    if (finishCheck) {
      this.pendingDecision = undefined;
      this.logRecorder.record({
        type: "match.finished",
        stateVersion: this.stateVersion,
        winner: finishCheck.winner,
        reason: finishCheck.reason,
      });
      this.logRecorder.finishMatch();
      return {
        type: "FINISHED",
        result: finishCheck,
      };
    }

    // 2. 全員パス成立時（[12]〜[13]）の自動処理（ステージ最上段を1件だけ解決）
    let stageResolveEvent: CoreFlowEvent | null = null;
    if (this.stageTopResolutionPending) {
      this.stageTopResolutionPending = false;
      stageResolveEvent = CoreFlowCoordinator.tryResolveStageTop(
        this.state,
        this.rulePackage,
        this.registry,
        this.passTracker,
        2,
        { deferChanceReturnToStep2: true }
      );
    }

    if (stageResolveEvent) {
      if (stageResolveEvent.type === "STAGE_RESOLUTION_INTERRUPTED") {
        // 効果解決途中で判断が必要になったため待機（state.chancePlayer === "system" を維持）
        this.pendingDecision = stageResolveEvent.decisionRequest;
        this.continuation = stageResolveEvent.continuation;
        this.resolvingRequest = stageResolveEvent.actionRequest;
        this.resolvingContext = stageResolveEvent.context;

        this.logRecorder.record({
          type: "decision.requested",
          stateVersion: this.stateVersion,
          decisionId: this.pendingDecision.decisionId,
          playerId: this.pendingDecision.playerId,
          source: this.pendingDecision.source.type,
          requestId: (this.pendingDecision.source as any).requestId,
          legalPatternCount: this.pendingDecision.patterns.length,
          legalPatternRefs: this.pendingDecision.patterns.map((_, i) => i),
        });

        return {
          type: "WAITING_FOR_DECISION",
          request: this.pendingDecision,
        };
      }

      // 解決後のGrave TOP選択Pendingが存在する場合はそちらを要求（勝敗判定・後続行動より優先）
      if (this.state.pendingGraveTopSelections && this.state.pendingGraveTopSelections.length > 0) {
        const nextPending = this.state.pendingGraveTopSelections[0];
        this.pendingDecision = GraveTopCoordinator.createDecisionRequest(
          this.state,
          nextPending,
          {
            stateVersion: this.stateVersion,
            matchId: this.matchId,
          }
        );
        this.logRecorder.record({
          type: "decision.requested",
          stateVersion: this.stateVersion,
          decisionId: this.pendingDecision.decisionId,
          playerId: this.pendingDecision.playerId,
          source: this.pendingDecision.source.type,
          requestId: (this.pendingDecision.source as any).requestId,
          legalPatternCount: this.pendingDecision.patterns.length,
          legalPatternRefs: this.pendingDecision.patterns.map((_, i) => i),
        });
        return {
          type: "WAITING_FOR_DECISION",
          request: this.pendingDecision,
        };
      }

      // [8] 解決後の勝敗判定
      const postFinishCheck = this.checkGameFinished();
      if (postFinishCheck) {
        this.pendingDecision = undefined;
        this.logRecorder.record({
          type: "match.finished",
          stateVersion: this.stateVersion,
          winner: postFinishCheck.winner,
          reason: postFinishCheck.reason,
        });
        this.logRecorder.finishMatch();
        return {
          type: "FINISHED",
          result: postFinishCheck,
        };
      }
    }

    // 3. 誘発リクエストバッファの処理（コアフロー[5]：公式ルール第9.2版 誘発チェックフロー）
    // ※ 誘発チェックの内部ではチャンス・フォーカスを変更しない（initialChance による上書きは廃止）
    const triggerResult = this.triggerCoordinator.processPendingTriggers(
      this.state,
      this.rulePackage,
      this.registry
    );

    // 3.1. 即時誘発の解決が墓地TOP選択により中断された場合（最優先で意思決定待機へ遷移）
    if (triggerResult.interruptedImmediateResolution) {
      const interrupted = triggerResult.interruptedImmediateResolution;
      this.resolvingRequest = interrupted.request;
      this.resolvingContext = interrupted.context;
      this.continuation = {
        sourceRequestId: interrupted.request.id,
        effectPath:
          interrupted.completedEffectPath ??
          (interrupted.request.action?.effect ? [interrupted.request.action.effect.length] : [0]),
        effectStepId: TRIGGER_IMMEDIATE_FINALIZATION_STEP_ID,
        selectionId: "graveTopCard",
      };

      if (this.state.pendingGraveTopSelections && this.state.pendingGraveTopSelections.length > 0) {
        const nextPending = this.state.pendingGraveTopSelections[0];
        this.pendingDecision = GraveTopCoordinator.createDecisionRequest(
          this.state,
          nextPending,
          {
            stateVersion: this.stateVersion,
            matchId: this.matchId,
          }
        );
        this.logRecorder.record({
          type: "decision.requested",
          stateVersion: this.stateVersion,
          decisionId: this.pendingDecision.decisionId,
          playerId: this.pendingDecision.playerId,
          source: this.pendingDecision.source.type,
          requestId: (this.pendingDecision.source as any).requestId,
          legalPatternCount: this.pendingDecision.patterns.length,
          legalPatternRefs: this.pendingDecision.patterns.map((_, i) => i),
        });
        return {
          type: "WAITING_FOR_DECISION",
          request: this.pendingDecision,
        };
      }
    }

    if (triggerResult.immediateResolvedCount > 0) {
      const postTriggerFinishCheck = this.checkGameFinished();
      if (postTriggerFinishCheck) {
        this.pendingDecision = undefined;
        this.logRecorder.record({
          type: "match.finished",
          stateVersion: this.stateVersion,
          winner: postTriggerFinishCheck.winner,
          reason: postTriggerFinishCheck.reason,
        });
        this.logRecorder.finishMatch();
        return {
          type: "FINISHED",
          result: postTriggerFinishCheck,
        };
      }
    }

    // 3.2. コアフロー[10]: 直接リクエストおよびその誘発チェック[5]が完了した時点で、
    // フォーカスをリクエスト実行プレイヤーに設定する
    if (this.pendingDirectFocusPlayer) {
      const prevFocus = this.state.focusPlayer;
      const nextFocus = this.pendingDirectFocusPlayer;
      this.state.focusPlayer = nextFocus;
      this.pendingDirectFocusPlayer = undefined;
      if (prevFocus && prevFocus !== nextFocus) {
        this.logRecorder.record({
          type: "focus.changed",
          stateVersion: this.stateVersion,
          fromFocusPlayer: prevFocus,
          toFocusPlayer: nextFocus,
          reason: "directRequest",
        });
      }
    }

    // 3.3. コアフロー[2] チャンスの確認と移動:
    // 「プレイヤーにチャンスがない（ルールシステム "system" 等）」または「ステージが空」の場合、
    // チャンスとフォーカスをターンプレイヤーに移動する。それ以外の場合は維持する。
    const isSystemOrNoPlayerChance =
      !this.state.chancePlayer || this.state.chancePlayer === RULE_SYSTEM_CHANCE;
    const isStageEmpty =
      !this.state.stage?.requests || this.state.stage.requests.length === 0;

    if (isSystemOrNoPlayerChance || isStageEmpty) {
      const prevChance = this.state.chancePlayer;
      const prevFocus = this.state.focusPlayer;
      const turnPlayer: PlayerKey = this.state.turnPlayer || "p1";
      const transitionReason =
        prevChance === RULE_SYSTEM_CHANCE ? "stageTopResolved" : "stageEmpty";
      this.state.chancePlayer = turnPlayer;
      this.state.focusPlayer = turnPlayer;

      if (prevChance && prevChance !== turnPlayer) {
        this.logRecorder.record({
          type: "chance.changed",
          stateVersion: this.stateVersion,
          fromChancePlayer: prevChance,
          toChancePlayer: turnPlayer,
          reason: transitionReason,
        });
      }
      if (prevFocus && prevFocus !== turnPlayer) {
        this.logRecorder.record({
          type: "focus.changed",
          stateVersion: this.stateVersion,
          fromFocusPlayer: prevFocus,
          toFocusPlayer: turnPlayer,
          reason: transitionReason,
        });
      }
    } else if (!this.state.focusPlayer) {
      this.state.focusPlayer = this.state.turnPlayer || "p1";
    }

    // 4. 現在のチャンスプレイヤーの判断要求を生成（コアフロー[3]）
    const chancePlayer: PlayerKey =
      this.state.chancePlayer && this.state.chancePlayer !== RULE_SYSTEM_CHANCE
        ? this.state.chancePlayer
        : this.state.turnPlayer || "p1";
    const { request } = LegalPatternGenerator.generateActionRequestDecision(
      this.state,
      chancePlayer,
      this.rulePackage,
      {
        stateVersion: this.stateVersion,
        matchId: this.matchId,
        includePass: true,
      }
    );

    if (request.patterns.length > 0) {
      this.pendingDecision = request;
      this.logRecorder.record({
        type: "decision.requested",
        stateVersion: this.stateVersion,
        decisionId: request.decisionId,
        playerId: request.playerId,
        source: request.source.type,
        requestId: (request.source as any).requestId,
        legalPatternCount: request.patterns.length,
        legalPatternRefs: request.patterns.map((_, i) => i),
      });

      return {
        type: "WAITING_FOR_DECISION",
        request,
        lastEvent: stageResolveEvent || undefined,
      };
    }

    return {
      type: "PROGRESSED",
      events: stageResolveEvent ? [stageResolveEvent] : [],
    };
  }

  /**
   * プレイヤー（人間またはAI）からの判断回答を受け付け、適用します。
   */
  submitDecision(response: DecisionResponse): GameSessionStep {
    if (!this.pendingDecision) {
      throw new Error("現在待機中の判断要求が存在しません。");
    }

    PatternExecutor.validateResponse(this.pendingDecision, response, this.stateVersion);

    this.logRecorder.record({
      type: "decision.responded",
      stateVersion: this.stateVersion,
      decisionId: response.decisionId,
      playerId: this.pendingDecision.playerId,
      source: this.pendingDecision.source.type,
      selectedPatternRef: response.selectedPatternRef,
    });

    // 判断回答が受理されたため、盤面バージョンを進める
    this.stateVersion++;

    // 0. 墓地TOP選択 (ZONE_TOP_SELECTION) の場合
    if (this.pendingDecision.source.type === "ZONE_TOP_SELECTION") {
      const pattern = this.pendingDecision.patterns[response.selectedPatternRef];
      let selectedCardId: string | undefined = undefined;
      if (pattern.effectSelectionRef !== undefined) {
        const effSel = this.pendingDecision.catalog.effectSelections[pattern.effectSelectionRef];
        if (effSel?.selectedValues && effSel.selectedValues.length > 0) {
          selectedCardId = effSel.selectedValues[0];
        }
      }
      if (!selectedCardId) {
        throw new Error("ZONE_TOP_SELECTION: 選択されたカードIDが見つかりません。");
      }

      GraveTopCoordinator.applyGraveTopSelection(
        this.state,
        this.pendingDecision.playerId,
        selectedCardId,
        this.logRecorder,
        this.stateVersion
      );

      // 他のプレイヤーまたは追加の墓地TOP選択がPendingに残っているか確認
      if (this.state.pendingGraveTopSelections && this.state.pendingGraveTopSelections.length > 0) {
        const nextPending = this.state.pendingGraveTopSelections[0];
        this.pendingDecision = GraveTopCoordinator.createDecisionRequest(
          this.state,
          nextPending,
          {
            stateVersion: this.stateVersion,
            matchId: this.matchId,
          }
        );
        this.logRecorder.record({
          type: "decision.requested",
          stateVersion: this.stateVersion,
          decisionId: this.pendingDecision.decisionId,
          playerId: this.pendingDecision.playerId,
          source: this.pendingDecision.source.type,
          requestId: (this.pendingDecision.source as any).requestId,
          legalPatternCount: this.pendingDecision.patterns.length,
          legalPatternRefs: this.pendingDecision.patterns.map((_, i) => i),
        });
        return {
          type: "WAITING_FOR_DECISION",
          request: this.pendingDecision,
        };
      }

      // 6. triggerImmediateFinalization check (R3: 即時誘発の遅延解決確定)
      if (this.resolvingRequest && this.continuation?.effectStepId === TRIGGER_IMMEDIATE_FINALIZATION_STEP_ID) {
        this.triggerCoordinator.finalizeImmediateTriggeredRequest(
          this.resolvingRequest,
          this.resolvingContext!,
          this.registry
        );

        this.pendingDecision = undefined;
        this.continuation = undefined;
        this.resolvingRequest = undefined;
        this.resolvingContext = undefined;

        // 解決完了後、自動進行へ戻る (勝敗判定、後続の誘発リクエスト処理、[2]チャンス移動など)
        return this.advance();
      }

      // 7. 中断されたリクエストの効果解決中だった場合は再開
      if (this.resolvingRequest && this.continuation) {
        const resumeResult = this.registry.resumeRequest(
          this.resolvingRequest,
          this.continuation,
          undefined,
          this.resolvingContext!
        );

        if (resumeResult.type === "WAITING_FOR_DECISION") {
          this.pendingDecision = resumeResult.decisionRequest;
          this.continuation = resumeResult.continuation;
          this.resolvingRequest = resumeResult.request;
          this.resolvingContext = resumeResult.context;

          return {
            type: "WAITING_FOR_DECISION",
            request: this.pendingDecision!,
          };
        }

        // 解決完了: ステージ解決中の場合は chancePlayer === "system" のまま advance() へ進み、
        // 勝敗判定[8] -> 誘発チェック[5] -> チャンス確認と移動[2] で手番プレイヤーへ戻す。
        // 直接即時リクエストの場合は pendingDirectFocusPlayer により[10]でフォーカスが設定される。
        this.pendingDecision = undefined;
        this.continuation = undefined;
        this.resolvingRequest = undefined;
        this.resolvingContext = undefined;

        return this.advance();
      }

      this.pendingDecision = undefined;
      return this.advance();
    }

    // 1. 効果解決時の判断 (EFFECT_RESOLUTION) の場合
    if (this.pendingDecision.source.type === "EFFECT_RESOLUTION") {
      const pattern = this.pendingDecision.patterns[response.selectedPatternRef];
      let selectedValues: readonly string[] | undefined = undefined;
      let assignments: readonly any[] | undefined = undefined;
      let targetSelection: TargetSelection | undefined = undefined;

      if (pattern.effectSelectionRef !== undefined) {
        const effSel = this.pendingDecision.catalog.effectSelections[pattern.effectSelectionRef];
        if (effSel) {
          selectedValues = effSel.selectedValues;
          assignments = effSel.assignments;
          targetSelection = effSel.targetSelection;
        }
      } else if (pattern.orderSelectionRef !== undefined) {
        const ordSel = this.pendingDecision.catalog.orderSelections[pattern.orderSelectionRef];
        if (ordSel) {
          selectedValues = ordSel.orderedIds;
        }
      }

      const resumeResult = this.registry.resumeRequest(
        this.resolvingRequest!,
        this.continuation!,
        selectedValues,
        this.resolvingContext!,
        assignments,
        targetSelection
      );

      if (resumeResult.type === "WAITING_FOR_DECISION") {
        this.pendingDecision = resumeResult.decisionRequest;
        this.continuation = resumeResult.continuation;
        this.resolvingRequest = resumeResult.request;
        this.resolvingContext = resumeResult.context;

        return {
          type: "WAITING_FOR_DECISION",
          request: this.pendingDecision!,
        };
      }

      // 解決完了:
      // - ステージ解決中のリクエストだった場合は state.chancePlayer === "system" のまま advance() へ進み、
      //   勝敗判定[8] -> 誘発チェック[5] -> チャンス確認と移動[2] にて TP へチャンス・フォーカスが移動する。
      // - 直接即時リクエストだった場合は pendingDirectFocusPlayer により誘発チェック[5]後に[10]でフォーカスが設定される。
      this.pendingDecision = undefined;
      this.continuation = undefined;
      this.resolvingRequest = undefined;
      this.resolvingContext = undefined;

      return this.advance();
    }

    // 2. 通常の行動要求 (ACTION_REQUEST) の場合
    const requestingPlayerId = this.pendingDecision.playerId;
    const flowEvent = CoreFlowCoordinator.applyDecision(
      this.pendingDecision,
      response,
      this.state,
      this.rulePackage,
      this.registry,
      this.passTracker
    );

    if (flowEvent.type === "ALL_PASSED") {
      // [11] 全員パス成立 -> [12] チャンスは "system" へ移動済み -> [13] ステージ最上段1件解決を予約
      this.stageTopResolutionPending = true;
    } else if (
      flowEvent.type === "NORMAL_ACTION_QUEUED" ||
      flowEvent.type === "IMMEDIATE_ACTION_RESOLVED"
    ) {
      // [4]〜[10] 直接リクエスト完了後の誘発チェック[5]完了時にフォーカスをリクエスト実行プレイヤーへ設定
      this.pendingDirectFocusPlayer = requestingPlayerId;
    } else if (flowEvent.type === "STAGE_RESOLUTION_INTERRUPTED") {
      // 直接即時アクション（サーチ等）が解決途中で効果選択を要求した場合:
      // 解決・誘発チェック完了後（[10]）にフォーカスをリクエスト実行プレイヤーへ設定するため予約し、
      // 中断中は現在の focusPlayer を維持する
      this.pendingDirectFocusPlayer = requestingPlayerId;
      this.pendingDecision = flowEvent.decisionRequest;
      this.continuation = flowEvent.continuation;
      this.resolvingRequest = flowEvent.actionRequest;
      this.resolvingContext = flowEvent.context;

      this.logRecorder.record({
        type: "decision.requested",
        stateVersion: this.stateVersion,
        decisionId: this.pendingDecision.decisionId,
        playerId: this.pendingDecision.playerId,
        source: this.pendingDecision.source.type,
        requestId: (this.pendingDecision.source as any).requestId,
        legalPatternCount: this.pendingDecision.patterns.length,
        legalPatternRefs: this.pendingDecision.patterns.map((_, i) => i),
      });

      return {
        type: "WAITING_FOR_DECISION",
        request: this.pendingDecision,
      };
    }

    // 適用成功後、判断をクリアして次のステップへ自動進行
    this.pendingDecision = undefined;
    return this.advance();
  }

  /**
   * 勝敗チェック
   */
  private checkGameFinished(): GameResult | null {
    if (!this.state.players) return null;

    const p1 = this.state.players.p1;
    const p2 = this.state.players.p2;

    const p1Life = Array.isArray(p1?.life) ? p1.life.length : Number(p1?.life ?? 0);
    const p2Life = Array.isArray(p2?.life) ? p2.life.length : Number(p2?.life ?? 0);

    if (p1 && p1Life <= 0 && p2 && p2Life <= 0) {
      return { reason: "双方のライフが0になりました（引き分け）" };
    }
    if (p1 && p1Life <= 0) {
      return { winner: "p2", reason: "Player A のライフが0になりました" };
    }
    if (p2 && p2Life <= 0) {
      return { winner: "p1", reason: "Player B のライフが0になりました" };
    }

    return null;
  }
}
