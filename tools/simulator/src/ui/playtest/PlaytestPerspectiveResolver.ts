import type { PlayerKey } from "../../domain/decision/DecisionSource";
import type { PlaytestMatchMode } from "../../engine/playtest/PlaytestSeatController";

export interface PlaytestPerspectiveState {
  readonly matchMode: PlaytestMatchMode;
  readonly activeHumanSeat: PlayerKey;
  readonly currentStep?: {
    readonly type: string;
    readonly request?: {
      readonly playerId?: string;
    };
  } | null;
  readonly gameState?: {
    readonly chancePlayer?: string;
    readonly turnPlayer?: string;
  } | null;
}

export interface PlaytestPerspectiveResult {
  readonly bottomPlayerKey: PlayerKey;
  readonly topPlayerKey: PlayerKey;
}

/**
 * プレイテスト画面の視点（手前/奥のプレイヤー）を決定する純粋関数。
 *
 * 優先順位:
 * 1. Human vs AI: 常に activeHumanSeat を下側（手前）に固定
 * 2. Human vs Human:
 *    - Priority 1: 現在の保留中判断要求プレイヤー (currentStep.request.playerId)
 *    - Priority 2: チャンスプレイヤー (gameState.chancePlayer)
 *    - Priority 3: ターンプレイヤー (gameState.turnPlayer)
 *    - Fallback: "p1"
 */
export class PlaytestPerspectiveResolver {
  static resolvePerspective(state: PlaytestPerspectiveState): PlaytestPerspectiveResult {
    const { matchMode, activeHumanSeat, currentStep, gameState } = state;

    let bottomPlayerKey: PlayerKey;

    if (matchMode === "humanVsAi") {
      bottomPlayerKey = activeHumanSeat;
    } else if (currentStep?.type === "WAITING_FOR_DECISION" && currentStep.request?.playerId) {
      bottomPlayerKey = currentStep.request.playerId as PlayerKey;
    } else if (gameState?.chancePlayer) {
      bottomPlayerKey = gameState.chancePlayer as PlayerKey;
    } else if (gameState?.turnPlayer) {
      bottomPlayerKey = gameState.turnPlayer as PlayerKey;
    } else {
      bottomPlayerKey = "p1";
    }

    const topPlayerKey: PlayerKey = bottomPlayerKey === "p1" ? "p2" : "p1";

    return {
      bottomPlayerKey,
      topPlayerKey,
    };
  }
}
