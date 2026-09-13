/**
 * ReplayReconstructionService.ts
 *
 * BlackPoker Simulator
 * Engine 層に配置される決定論的 Replay 再構築サービス。
 * UI 層や React、DOM には一切依存しない。
 */

import { RegulationCatalog } from "../../domain/regulation/RegulationDefinition";
import { RulePackage } from "../../domain/rules/RulePackage";
import { DecisionRequest } from "../../domain/decision/DecisionRequest";
import { GameSession, GameSessionStep } from "../session/GameSession";
import { startMatchAttempt } from "../playtest/PlaytestEnvironmentController";
import type {
  ReplayDecisionEntryV1,
  ReplayDivergenceCode,
  ReplayDifference,
} from "./ReplayTypes";

export const MAX_AUTO_PROGRESS_STEPS = 10000;

export interface ReplayExecutedDecision {
  readonly entry: ReplayDecisionEntryV1;
  readonly request: DecisionRequest;
}

export interface ReconstructMatchParams {
  readonly environmentId: string;
  readonly seed?: number;
  readonly transcript: readonly ReplayDecisionEntryV1[];
  readonly decisionCount?: number;
  readonly catalog: RegulationCatalog;
  readonly fullRulePackage: RulePackage;
  readonly expectedRulePackage?: {
    readonly id?: string;
    readonly version?: string;
  };
}

export type ReconstructMatchResult =
  | {
      readonly status: "SUCCESS";
      readonly session: GameSession;
      readonly executedDecisions: number;
      readonly totalDecisions: number;
      readonly currentStep: GameSessionStep;
      readonly currentGameState: any;
      readonly currentDecisionRequest?: DecisionRequest;
      readonly replayedDecisions: readonly ReplayExecutedDecision[];
    }
  | {
      readonly status: "DIVERGED";
      readonly code: ReplayDivergenceCode;
      readonly message: string;
      readonly stepIndex: number;
      readonly decisionSeq?: number;
      readonly difference?: ReplayDifference;
      readonly session?: GameSession;
      readonly executedDecisions: number;
      readonly totalDecisions: number;
      readonly currentStep?: GameSessionStep;
      readonly currentGameState?: any;
      readonly replayedDecisions: readonly ReplayExecutedDecision[];
    }
  | {
      readonly status: "TECHNICAL_ERROR";
      readonly error: string;
      readonly stack?: string;
    };

/**
 * Transcript の末尾から走査し、最後に実行された Human Decision (actor === "human") の index を特定する。
 * その Human Decision 自体を含めて以降を切り落とすため、切り落とし後の長さ（= index）を返却する。
 * Human Decision が存在しない場合は -1 を返却する。
 */
export function findUndoTruncationIndex(
  transcript: readonly { readonly actor?: string }[]
): number {
  for (let i = transcript.length - 1; i >= 0; i--) {
    if (transcript[i]?.actor === "human") {
      return i;
    }
  }
  return -1;
}

/**
 * 初期環境 + Seed + ordered Decision Transcript prefix から fresh GameSession を再構築する。
 * 外部 Decision 境界（WAITING_FOR_DECISION または FINISHED）まで PROGRESSED ステップを正規化して返却する。
 */
export function reconstructMatch(
  params: ReconstructMatchParams
): ReconstructMatchResult {
  try {
    // 1. startMatchAttempt による新規セッション開始
    const outcome = startMatchAttempt({
      environmentId: params.environmentId,
      seedInput: params.seed !== undefined ? String(params.seed) : "",
      catalog: params.catalog,
      fullRulePackage: params.fullRulePackage,
    });

    if (outcome.type !== "READY") {
      return {
        status: "DIVERGED",
        code: "SETUP_FAILED",
        message: `startMatchAttempt failed with ${outcome.type}: ${outcome.setupNotice.message}`,
        stepIndex: 0,
        executedDecisions: 0,
        totalDecisions: params.transcript.length,
        replayedDecisions: [],
      };
    }

    const session = outcome.session;
    let currentStep: GameSessionStep = outcome.initialStep;
    let stepIndex = 0;

    // 2. RulePackage 整合性チェック（指定がある場合）
    if (params.expectedRulePackage) {
      const activeRulePkg = outcome.activeMatch.rulePackage;
      if (
        (params.expectedRulePackage.id && activeRulePkg.id !== params.expectedRulePackage.id) ||
        (params.expectedRulePackage.version && activeRulePkg.version !== params.expectedRulePackage.version)
      ) {
        return {
          status: "DIVERGED",
          code: "RULE_PACKAGE_MISMATCH",
          message: `RulePackage mismatch: expected id=${params.expectedRulePackage.id}, version=${params.expectedRulePackage.version}; actual id=${activeRulePkg.id}, version=${activeRulePkg.version}`,
          stepIndex,
          session,
          executedDecisions: 0,
          totalDecisions: params.transcript.length,
          currentStep,
          currentGameState: JSON.parse(JSON.stringify(session.state)),
          replayedDecisions: [],
        };
      }
    }

    // 3. 初期 PROGRESSED ステップの自動進行
    let initialAutoSteps = 0;
    while (currentStep.type === "PROGRESSED") {
      if (initialAutoSteps >= MAX_AUTO_PROGRESS_STEPS) {
        return {
          status: "DIVERGED",
          code: "AUTO_PROGRESS_LIMIT_EXCEEDED",
          message: `Exceeded max auto-progress steps (${MAX_AUTO_PROGRESS_STEPS}) during initial setup`,
          stepIndex,
          session,
          executedDecisions: 0,
          totalDecisions: params.transcript.length,
          currentStep,
          currentGameState: JSON.parse(JSON.stringify(session.state)),
          replayedDecisions: [],
        };
      }
      currentStep = session.advance();
      stepIndex++;
      initialAutoSteps++;
    }

    const targetCount =
      params.decisionCount !== undefined
        ? Math.min(params.decisionCount, params.transcript.length)
        : params.transcript.length;

    let executedDecisions = 0;
    const replayedDecisions: ReplayExecutedDecision[] = [];

    // 4. 判断列の再投入ループ
    for (let i = 0; i < targetCount; i++) {
      const entry = params.transcript[i];

      // PROGRESSED 中は advance() で進める
      let autoSteps = 0;
      while (currentStep.type === "PROGRESSED") {
        if (autoSteps >= MAX_AUTO_PROGRESS_STEPS) {
          return {
            status: "DIVERGED",
            code: "AUTO_PROGRESS_LIMIT_EXCEEDED",
            message: `Exceeded max auto-progress steps (${MAX_AUTO_PROGRESS_STEPS}) before decision seq ${entry.seq}`,
            stepIndex,
            decisionSeq: entry.seq,
            session,
            executedDecisions,
            totalDecisions: params.transcript.length,
            currentStep,
            currentGameState: JSON.parse(JSON.stringify(session.state)),
            replayedDecisions,
          };
        }
        currentStep = session.advance();
        stepIndex++;
        autoSteps++;
      }

      // 未消費の判断があるのに終了した場合は FINISHED_EARLY
      if (currentStep.type === "FINISHED") {
        return {
          status: "DIVERGED",
          code: "FINISHED_EARLY",
          message: `Session reached FINISHED early at decision seq ${entry.seq}`,
          stepIndex,
          decisionSeq: entry.seq,
          session,
          executedDecisions,
          totalDecisions: params.transcript.length,
          currentStep,
          currentGameState: JSON.parse(JSON.stringify(session.state)),
          replayedDecisions,
        };
      }

      // WAITING_FOR_DECISION であること
      if ((currentStep as any).type !== "WAITING_FOR_DECISION") {
        return {
          status: "DIVERGED",
          code: "EXPECTED_STEP_MISMATCH",
          message: `Expected step WAITING_FOR_DECISION before decision seq ${entry.seq}, got ${(currentStep as any).type}`,
          stepIndex,
          decisionSeq: entry.seq,
          session,
          executedDecisions,
          totalDecisions: params.transcript.length,
          currentStep,
          currentGameState: JSON.parse(JSON.stringify(session.state)),
          replayedDecisions,
        };
      }

      const actualRequest = currentStep.request;

      // プレイヤー席の一致
      if (actualRequest.playerId !== entry.playerId) {
        return {
          status: "DIVERGED",
          code: "PLAYER_MISMATCH",
          message: `Player mismatch at seq ${entry.seq}: expected ${entry.playerId}, actual ${actualRequest.playerId}`,
          stepIndex,
          decisionSeq: entry.seq,
          session,
          executedDecisions,
          totalDecisions: params.transcript.length,
          currentStep,
          currentGameState: JSON.parse(JSON.stringify(session.state)),
          replayedDecisions,
        };
      }

      // 盤面バージョンの一致
      if (actualRequest.stateVersion !== entry.response.stateVersion) {
        return {
          status: "DIVERGED",
          code: "STATE_VERSION_MISMATCH",
          message: `State version mismatch at seq ${entry.seq}: expected ${entry.response.stateVersion}, actual ${actualRequest.stateVersion}`,
          stepIndex,
          decisionSeq: entry.seq,
          session,
          executedDecisions,
          totalDecisions: params.transcript.length,
          currentStep,
          currentGameState: JSON.parse(JSON.stringify(session.state)),
          replayedDecisions,
        };
      }

      // パターン参照インデックスの範囲内チェック
      if (
        entry.response.selectedPatternRef < 0 ||
        entry.response.selectedPatternRef >= actualRequest.patterns.length
      ) {
        return {
          status: "DIVERGED",
          code: "PATTERN_REF_OUT_OF_RANGE",
          message: `Pattern ref out of range at seq ${entry.seq}: selected ${entry.response.selectedPatternRef}, available patterns: ${actualRequest.patterns.length}`,
          stepIndex,
          decisionSeq: entry.seq,
          session,
          executedDecisions,
          totalDecisions: params.transcript.length,
          currentStep,
          currentGameState: JSON.parse(JSON.stringify(session.state)),
          replayedDecisions,
        };
      }

      // 実行記録に追加 (AI Policy の PRNG 状態巻き戻し等に使用)
      replayedDecisions.push({
        entry,
        request: actualRequest,
      });

      // actualRequest.decisionId を使用して Runtime レスポンスを再構築
      const replayResponse = {
        decisionId: actualRequest.decisionId,
        stateVersion: actualRequest.stateVersion,
        selectedPatternRef: entry.response.selectedPatternRef,
      };

      try {
        currentStep = session.submitDecision(replayResponse);
        stepIndex++;
        executedDecisions++;
      } catch (err: any) {
        return {
          status: "DIVERGED",
          code: "SUBMIT_REJECTED",
          message: `Session rejected decision at seq ${entry.seq}: ${err?.message || String(err)}`,
          stepIndex,
          decisionSeq: entry.seq,
          session,
          executedDecisions,
          totalDecisions: params.transcript.length,
          currentStep,
          currentGameState: JSON.parse(JSON.stringify(session.state)),
          replayedDecisions,
        };
      }
    }

    // 5. 外部 Decision 境界までの自動進行 (Normalization)
    // PROGRESSED ステップが残っている場合、WAITING_FOR_DECISION または FINISHED まで進める
    let trailingAutoSteps = 0;
    while (currentStep.type === "PROGRESSED") {
      if (trailingAutoSteps >= MAX_AUTO_PROGRESS_STEPS) {
        return {
          status: "DIVERGED",
          code: "AUTO_PROGRESS_LIMIT_EXCEEDED",
          message: `Exceeded max auto-progress steps (${MAX_AUTO_PROGRESS_STEPS}) during post-decision normalization`,
          stepIndex,
          session,
          executedDecisions,
          totalDecisions: params.transcript.length,
          currentStep,
          currentGameState: JSON.parse(JSON.stringify(session.state)),
          replayedDecisions,
        };
      }
      currentStep = session.advance();
      stepIndex++;
      trailingAutoSteps++;
    }

    return {
      status: "SUCCESS",
      session,
      executedDecisions,
      totalDecisions: params.transcript.length,
      currentStep,
      currentGameState: JSON.parse(JSON.stringify(session.state)),
      currentDecisionRequest:
        currentStep.type === "WAITING_FOR_DECISION" ? currentStep.request : undefined,
      replayedDecisions,
    };
  } catch (err: any) {
    return {
      status: "TECHNICAL_ERROR",
      error: err?.message || String(err),
      stack: err?.stack,
    };
  }
}
