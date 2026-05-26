/**
 * ゲームのターンおよびフェーズ状態遷移を管理する静的ヘルパークラス。
 */
export class TurnManager {
  /**
   * 指定したプレイヤーのターンを開始します。
   * フェーズを draw に初期化し、turnCount を +1 します。
   */
  static startTurn(state: any, playerKey: string) {
    if (!state.players) {
      state.players = {};
    }
    state.turnPlayer = playerKey;
    state.nonTurnPlayer = playerKey === "p1" ? "p2" : "p1";
    state.phase = "draw";
    state.turnCount = (state.turnCount || 0) + 1;
  }

  /**
   * 次のフェーズへ移動します。
   * draw -> main -> end の順序遷移を強制します。不正な場合は Error をスローします。
   */
  static movePhase(state: any, nextPhase: string) {
    const phaseOrder = ["draw", "main", "end"];
    if (state.phase) {
      const currIdx = phaseOrder.indexOf(state.phase);
      const nextIdx = phaseOrder.indexOf(nextPhase);
      if (currIdx === -1 || nextIdx === -1 || nextIdx !== currIdx + 1) {
        throw new Error(`不正なフェーズ遷移です。現在: ${state.phase}, 遷移先: ${nextPhase}`);
      }
    }
    state.phase = nextPhase;
  }

  /**
   * 現在のターンを終了し、次のプレイヤーのターンを開始します。
   * エンドフェーズであることを確認した上でターンを交代します。
   */
  static endTurn(state: any) {
    if (state.phase !== "end") {
      throw new Error(`ターンを終了するにはendフェーズである必要があります。現在: ${state.phase}`);
    }
    const nextPlayer = state.turnPlayer === "p1" ? "p2" : "p1";
    this.startTurn(state, nextPlayer);
  }

  /**
   * 既存テストおよびCLI互換性のため、指定プレイヤーの main フェーズから直接開始します。
   * startTurn 相当で turnCount を +1 し、その後 phase を main に設定します。
   */
  static initializeToMain(state: any, playerKey: string) {
    this.startTurn(state, playerKey);
    state.phase = "main";
  }
}
