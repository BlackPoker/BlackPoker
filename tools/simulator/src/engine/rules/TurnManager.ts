import { getOpponentPlayerKey } from "./playerUtils";

/**
 * ゲームのターンおよびチャンス（手番・アクション実行権）状態遷移を管理する静的ヘルパークラス。
 */
export class TurnManager {
  /**
   * 指定したプレイヤーのターンを開始します。
   * チャンスプレイヤーも同じプレイヤーに設定し、turnCount を +1 します。
   * ターンごとのアクション数 (actionCount) を 0 にリセットします。
   */
  static startTurn(state: any, playerKey: string, context?: any) {
    if (!state.players) {
      state.players = {};
    }
    const prevTurnPlayer = state.turnPlayer;
    state.turnPlayer = playerKey;
    state.nonTurnPlayer = getOpponentPlayerKey(playerKey, state);
    state.chancePlayer = playerKey;
    state.turnCount = (state.turnCount || 0) + 1;
    state.actionCount = 0; // ターンごとのアクション数をリセット
    state.turnUsage = {}; // ターンごとのアクション使用回数をリセット

    const logRecorder = context?.logRecorder;
    if (logRecorder && prevTurnPlayer && prevTurnPlayer !== playerKey) {
      logRecorder.record({
        type: "turn.changed",
        stateVersion: state.stateVersion ?? state.version ?? 1,
        fromTurnPlayer: prevTurnPlayer,
        toTurnPlayer: playerKey,
        turnCount: state.turnCount,
      });
    }
  }

  /**
   * チャンス（アクション実行権）を相手プレイヤーへ受け渡します。
   */
  static passChance(state: any) {
    if (!state.chancePlayer) return;
    state.chancePlayer = getOpponentPlayerKey(state.chancePlayer, state);
  }

  /**
   * 現在のターンを終了し、次のプレイヤーのターンを開始します。
   */
  static endTurn(state: any, context?: any) {
    const nextPlayer = getOpponentPlayerKey(state.turnPlayer, state);
    this.startTurn(state, nextPlayer, context);
  }


  /**
   * 既存テストおよびCLI互換性、およびメインアクション開始準備のための初期化ヘルパー。
   * 指定プレイヤーのターンを開始（turnCount を +1）し、その手番プレイヤーがチャンスを持つ状態にします。
   * ※メソッド名に含まれる "main" はフェーズ名ではなく、「メインタイミングのアクションを起こせる状態（手番かつチャンス所持、ステージ空）」を指します。
   */
  static initializeToMain(state: any, playerKey: string) {
    this.startTurn(state, playerKey);
  }
}
