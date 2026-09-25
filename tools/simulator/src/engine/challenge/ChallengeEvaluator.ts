import {
  ChallengeDefinitionV1,
  isChallengeDefinitionV1,
} from "../../domain/challenge/ChallengeDefinition";
import { GameSessionStep } from "../session/GameSession";

export type ChallengeResultStatus = "ACTIVE" | "CLEARED" | "FAILED";

export type ChallengeResultReason =
  | "WIN_BEFORE_DEADLINE"
  | "TURN_ENDED_BEFORE_WIN"
  | "OPPONENT_WON"
  | "GAME_FINISHED_WITHOUT_CHALLENGER_WIN";

export interface ChallengeRuntimeState {
  readonly definition: ChallengeDefinitionV1;
  readonly status: ChallengeResultStatus;
  readonly challenger: "p1" | "p2";
  readonly initialTurnPlayer: "p1" | "p2";
  readonly initialTurnCount: number;
  readonly reason?: ChallengeResultReason;
}

export interface ChallengeObservableState {
  readonly turnPlayer?: unknown;
  readonly turnCount?: unknown;
  readonly [key: string]: unknown;
}

/**
 * Challenge 初期化処理 (Fail-closed)
 *
 * 開始時点の state.turnPlayer を challenger とし、
 * initialTurnPlayer および initialTurnCount を確定して ACTIVE 状態を生成します。
 */
export function initializeChallenge(
  definition: ChallengeDefinitionV1,
  initialState: ChallengeObservableState
): ChallengeRuntimeState {
  if (!isChallengeDefinitionV1(definition)) {
    throw new Error("不正または未対応のチャレンジ定義です (Invalid ChallengeDefinitionV1)。");
  }

  const turnPlayer = initialState?.turnPlayer;
  if (turnPlayer !== "p1" && turnPlayer !== "p2") {
    throw new Error(
      `チャレンジ初期化エラー: 初期 turnPlayer が不正です (期待: "p1" | "p2", 実際: ${String(turnPlayer)})。`
    );
  }

  const turnCount = initialState?.turnCount;
  if (typeof turnCount !== "number" || !Number.isSafeInteger(turnCount) || turnCount < 1) {
    throw new Error(
      `チャレンジ初期化エラー: 初期 turnCount が不正です (期待: 1以上の安全な整数, 実際: ${String(turnCount)})。`
    );
  }

  return {
    definition,
    status: "ACTIVE",
    challenger: turnPlayer,
    initialTurnPlayer: turnPlayer,
    initialTurnCount: turnCount,
  };
}

/**
 * Challenge 評価処理
 *
 * GameSessionStep と現在の GameState snapshot を観測し、
 * WIN_CURRENT_TURN の達成状況（ACTIVE / CLEARED / FAILED）を判定します。
 *
 * 規則:
 * - 一度 CLEARED または FAILED となった Terminal 状態は不可逆。
 * - Deadline crossing: state.turnPlayer !== initialTurnPlayer || state.turnCount !== initialTurnCount
 * - FINISHED かつ winner == challenger かつ deadline 未超過 -> CLEARED
 * - FINISHED かつ winner != challenger -> FAILED
 * - deadline 超過 -> FAILED
 */
export function evaluateChallenge(
  currentRuntime: ChallengeRuntimeState,
  step: GameSessionStep,
  state: ChallengeObservableState
): ChallengeRuntimeState {
  // Terminal 状態は不可逆
  if (currentRuntime.status !== "ACTIVE") {
    return currentRuntime;
  }

  const deadlineCrossed =
    state.turnPlayer !== currentRuntime.initialTurnPlayer ||
    state.turnCount !== currentRuntime.initialTurnCount;

  // A / B: ゲームが決着 (FINISHED) した場合
  if (step.type === "FINISHED") {
    const winner = step.result.winner;
    if (winner === currentRuntime.challenger) {
      if (!deadlineCrossed) {
        return {
          ...currentRuntime,
          status: "CLEARED",
          reason: "WIN_BEFORE_DEADLINE",
        };
      }
      // deadline 超過後に勝敗が決した場合は FAILED
      return {
        ...currentRuntime,
        status: "FAILED",
        reason: "TURN_ENDED_BEFORE_WIN",
      };
    }

    if (winner && winner !== currentRuntime.challenger) {
      return {
        ...currentRuntime,
        status: "FAILED",
        reason: "OPPONENT_WON",
      };
    }

    // 勝者なし (DRAW等) で終了
    return {
      ...currentRuntime,
      status: "FAILED",
      reason: "GAME_FINISHED_WITHOUT_CHALLENGER_WIN",
    };
  }

  // C: ゲーム未決着で deadline を超過した場合
  if (deadlineCrossed) {
    return {
      ...currentRuntime,
      status: "FAILED",
      reason: "TURN_ENDED_BEFORE_WIN",
    };
  }

  // まだ手番中で未決着
  return currentRuntime;
}

export const ChallengeEvaluator = {
  initialize: initializeChallenge,
  evaluate: evaluateChallenge,
};
