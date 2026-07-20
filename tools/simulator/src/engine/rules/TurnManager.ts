/**
 * ゲームのターンおよびチャンス（手番・アクション実行権）状態遷移を管理する静的ヘルパークラス。
 */
export class TurnManager {
  /**
   * 指定したプレイヤーのターンを開始します。
   * チャンスプレイヤーも同じプレイヤーに設定し、turnCount を +1 します。
   * ターンごとのアクション数 (actionCount) を 0 にリセットします。
   */
  static startTurn(state: any, playerKey: string) {
    if (!state.players) {
      state.players = {};
    }
    state.turnPlayer = playerKey;
    state.nonTurnPlayer = playerKey === "p1" ? "p2" : "p1";
    state.chancePlayer = playerKey;
    state.turnCount = (state.turnCount || 0) + 1;
    state.actionCount = 0; // ターンごとのアクション数をリセット
  }

  /**
   * チャンス（アクション実行権）を相手プレイヤーへ受け渡します。
   */
  static passChance(state: any) {
    if (!state.chancePlayer) return;
    state.chancePlayer = state.chancePlayer === "p1" ? "p2" : "p1";
  }

  /**
   * 現在のターンを終了し、次のプレイヤーのターンを開始します。
   */
  static endTurn(state: any) {
    const nextPlayer = state.turnPlayer === "p1" ? "p2" : "p1";
    this.startTurn(state, nextPlayer);
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
