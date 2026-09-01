import { DecisionRequest } from "../../domain/decision/DecisionRequest";
import { DecisionResponse } from "../../domain/decision/DecisionResponse";
import { PlayerKey, RequestRef } from "../../domain/decision/DecisionSource";
import { RulePackage } from "../../domain/rules/RulePackage";
import { CommandRegistry } from "../rules/CommandRegistry";
import { LegalPatternGenerator } from "../decision/LegalPatternGenerator";
import { PatternExecutor } from "../decision/PatternExecutor";
import { CoreFlowCoordinator, CoreFlowEvent } from "./CoreFlowCoordinator";
import { PassTracker } from "./PassTracker";
import { TriggerProcessingCoordinator } from "../rules/TriggerProcessingCoordinator";
import { getOpponentPlayerKey } from "../rules/playerUtils";
import { MatchLogRecorder, MatchLogRecorderOptions } from "../log/MatchLogRecorder";
import { CanonicalMatchLog } from "../../domain/log/CanonicalMatchLog";

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
  public pendingDecision?: DecisionRequest;
  public continuation?: EffectContinuation;
  public resolvingRequest?: any;
  public resolvingContext?: any;
  public passTracker: PassTracker;
  public logRecorder: MatchLogRecorder;
  private triggerCoordinator: TriggerProcessingCoordinator;
  private matchStartedRecorded = false;
  private lastRecordedTurnPlayer?: string;

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
    this.rulePackage = rulePackage;
    this.registry = options?.registry || new CommandRegistry();
    this.matchId = options?.matchId || `match-${Date.now()}`;
    this.passTracker = options?.passTracker || new PassTracker();
    this.triggerCoordinator = new TriggerProcessingCoordinator();

    this.logRecorder =
      options?.logRecorder ||
      new MatchLogRecorder({
        matchId: this.matchId,
        rulesVersion: "9.1.2",
        rulePackageRef: "rules-vnext",
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
   * ゲームを自動的に進め、プレイヤーの判断が必要な場合は WAITING_FOR_DECISION を返します。
   */
  advance(): GameSessionStep {
    // 0. マッチ開始イベント（初回のみ）
    if (!this.matchStartedRecorded) {
      this.matchStartedRecorded = true;
      this.lastRecordedTurnPlayer = this.state.turnPlayer || "p1";
      this.logRecorder.record({
        type: "match.started",
        stateVersion: this.stateVersion,
        matchId: this.matchId,
        turnPlayer: this.state.turnPlayer || "p1",
        chancePlayer: this.state.chancePlayer || this.state.turnPlayer || "p1",
        initialPlayers: Object.keys(this.state.players || {}),
      });
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

    // すでに待機中の判断がある場合はそれを返す
    if (this.pendingDecision) {
      return {
        type: "WAITING_FOR_DECISION",
        request: this.pendingDecision,
      };
    }

    // 2. 全員連続PASS成立時の自動処理（ステージ最上段を1件だけ解決）
    const stageResolveEvent = CoreFlowCoordinator.tryResolveStageTop(
      this.state,
      this.rulePackage,
      this.registry,
      this.passTracker
    );

    if (stageResolveEvent) {
      if (stageResolveEvent.type === "STAGE_RESOLUTION_INTERRUPTED") {
        // 効果解決途中で判断が必要になったため待機
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

      // 解決後の勝敗判定
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

    // 3. 誘発リクエストバッファの処理（公式ルール9.4.1順序）
    const triggerResult = this.triggerCoordinator.processPendingTriggers(
      this.state,
      this.rulePackage,
      this.registry
    );

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

    if (triggerResult.stagedRequests.length > 0) {
      // 通常誘発アクションがステージに積まれた場合、DSL (initialChance) またはコントローラーの対戦相手へチャンスを設定
      const topStagedReq = triggerResult.stagedRequests[triggerResult.stagedRequests.length - 1];
      const actionDef = this.rulePackage.actions.find((a) => a.id === topStagedReq.actionId);
      const initialChanceSpec = actionDef?.request?.initialChance;
      const prevChance = this.state.chancePlayer;
      let newChance: PlayerKey;

      if (initialChanceSpec === "turnPlayer") {
        newChance = this.state.turnPlayer || topStagedReq.controller;
      } else if (initialChanceSpec === "nonTurnPlayer") {
        newChance =
          this.state.nonTurnPlayer ||
          getOpponentPlayerKey(this.state.turnPlayer || topStagedReq.controller, this.state);
      } else if (initialChanceSpec === "controller") {
        newChance = topStagedReq.controller;
      } else if (initialChanceSpec === "opponent") {
        newChance = getOpponentPlayerKey(topStagedReq.controller, this.state);
      } else {
        newChance = getOpponentPlayerKey(topStagedReq.controller, this.state);
      }

      this.state.chancePlayer = newChance;
      if (prevChance !== newChance) {
        this.logRecorder.record({
          type: "chance.changed",
          stateVersion: this.stateVersion,
          fromChancePlayer: prevChance,
          toChancePlayer: newChance,
          reason: "triggerStaged",
        });
      }
    }

    // 4. 現在のチャンスプレイヤーの判断要求を生成
    const chancePlayer: PlayerKey = this.state.chancePlayer || this.state.turnPlayer || "p1";
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


    // 1. 効果解決時の判断 (EFFECT_RESOLUTION) の場合
    if (this.pendingDecision.source.type === "EFFECT_RESOLUTION") {
      const pattern = this.pendingDecision.patterns[response.selectedPatternRef];
      let selectedValues: readonly string[] | undefined = undefined;
      let assignments: readonly any[] | undefined = undefined;

      if (pattern.effectSelectionRef !== undefined) {
        const effSel = this.pendingDecision.catalog.effectSelections[pattern.effectSelectionRef];
        if (effSel) {
          selectedValues = effSel.selectedValues;
          assignments = effSel.assignments;
        }
      }

      const resumeResult = this.registry.resumeRequest(
        this.resolvingRequest!,
        this.continuation!,
        selectedValues,
        this.resolvingContext!,
        assignments
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

      // 解決完了
      this.pendingDecision = undefined;
      this.continuation = undefined;
      this.resolvingRequest = undefined;
      this.resolvingContext = undefined;

      // 解決後、チャンスを手番プレイヤー (turnPlayer) へ戻す
      const prevChance = this.state.chancePlayer;
      const turnPlayer: PlayerKey = this.state.turnPlayer || "p1";
      this.state.chancePlayer = turnPlayer;
      if (prevChance !== turnPlayer) {
        this.logRecorder.record({
          type: "chance.changed",
          stateVersion: this.stateVersion,
          fromChancePlayer: prevChance,
          toChancePlayer: turnPlayer,
          reason: "effectResolved",
        });
      }

      return this.advance();

    }

    // 2. 通常の行動要求 (ACTION_REQUEST) の場合
    const flowEvent = CoreFlowCoordinator.applyDecision(
      this.pendingDecision,
      response,
      this.state,
      this.rulePackage,
      this.registry,
      this.passTracker
    );

    if (flowEvent.type === "STAGE_RESOLUTION_INTERRUPTED") {
      this.pendingDecision = flowEvent.decisionRequest;
      this.continuation = flowEvent.continuation;
      this.resolvingRequest = flowEvent.actionRequest;
      this.resolvingContext = flowEvent.context;

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
