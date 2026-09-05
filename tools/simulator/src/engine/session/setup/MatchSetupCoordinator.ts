import { PlayerKey } from "../../../domain/decision/DecisionSource";
import {
  SetupRound,
  executeFirstPlayerDetermination,
  applyGameStart,
  isGameStartDrawLifeExhausted,
} from "./commonSetupProcedures";

export type { SetupRound };

export interface MatchSetupResult {
  readonly firstPlayer: PlayerKey;
  readonly rounds: readonly SetupRound[];
  readonly discardedCards: {
    readonly p1: readonly any[];
    readonly p2: readonly any[];
  };
  readonly drawnCard?: any;
  readonly state: any;
}

/**
 * 公式規則 3.9.2 (先攻決定) および 3.9.3 (ゲーム開始) を実行するコーディネーター。
 * 共通 Setup Procedure（executeFirstPlayerDetermination, applyGameStart）に委譲し、
 * 単一実装ソース（Single Source）を担保します。
 */
export class MatchSetupCoordinator {
  /**
   * プリセット盤面または初期盤面を受け取り、先攻決定とゲーム開始初期化を実行します。
   */
  static setupMatch(initialState: any): MatchSetupResult {
    // 状態のディープコピーを作成
    const state = JSON.parse(JSON.stringify(initialState));

    if (!state.players?.p1 || !state.players?.p2) {
      throw new Error("MatchSetupCoordinator: p1 または p2 のプレイヤー情報が存在しません。");
    }

    const p1 = state.players.p1;
    const p2 = state.players.p2;

    if (!Array.isArray(p1.life) || !Array.isArray(p2.life)) {
      throw new Error("MatchSetupCoordinator: プレイヤーの life は配列形式である必要があります。");
    }

    if (!Array.isArray(p1.grave)) p1.grave = [];
    if (!Array.isArray(p2.grave)) p2.grave = [];
    if (!Array.isArray(p1.hand)) p1.hand = [];
    if (!Array.isArray(p2.hand)) p2.hand = [];

    // 3.9.2 先攻決定共通プロシージャ
    const determination = executeFirstPlayerDetermination(p1, p2);
    if (!determination.success) {
      throw new Error("MatchSetupCoordinator: 先攻決定中にライフが不足しました。");
    }

    // 3.9.3 ゲーム開始共通プロシージャ
    const gameStart = applyGameStart(state, determination.firstPlayer);
    if (isGameStartDrawLifeExhausted(gameStart)) {
      throw new Error(
        `MatchSetupCoordinator: ゲーム開始ドロー処理中にライフが不足しました (${gameStart.reason})`
      );
    }

    return {
      firstPlayer: determination.firstPlayer,
      rounds: determination.rounds,
      discardedCards: determination.discardedCards,
      drawnCard: gameStart.drawnCard,
      state: gameStart.state,
    };
  }
}
