import { getOpponentPlayerKey } from "./playerUtils";
import { RULE_SYSTEM_CHANCE } from "../../domain/decision/DecisionSource";

/**
 * ゲームのターンおよびチャンス・フォーカス（手番・アクション実行権・全員パス判定起点）状態遷移を管理する静的ヘルパークラス。
 */
export class TurnManager {
  /**
   * 指定したプレイヤーのターンを開始します（ゲーム開始時・単体初期化用）。
   * 手番・チャンス・フォーカスをすべて同じプレイヤーに設定し、turnCount を +1 します。
   * ターンごとのアクション数 (actionCount) を 0 にリセットします。
   */
  static startTurn(state: any, playerKey: string, context?: any) {
    if (!state.players) {
      state.players = {};
    }
    const prevTurnPlayer = state.turnPlayer;
    const prevChance = state.chancePlayer;
    const prevFocus = state.focusPlayer;
    state.turnPlayer = playerKey;
    state.nonTurnPlayer = getOpponentPlayerKey(playerKey, state);
    state.chancePlayer = playerKey;
    state.focusPlayer = playerKey;
    state.turnCount = (state.turnCount || 0) + 1;
    state.actionCount = 0; // ターンごとのアクション数をリセット
    state.turnUsage = {}; // ターンごとのアクション使用回数をリセット

    const logRecorder = context?.logRecorder;
    if (logRecorder) {
      if (prevTurnPlayer && prevTurnPlayer !== playerKey) {
        logRecorder.record({
          type: "turn.changed",
          stateVersion: state.stateVersion ?? state.version ?? 1,
          fromTurnPlayer: prevTurnPlayer,
          toTurnPlayer: playerKey,
          turnCount: state.turnCount,
        });
      }
      if (prevChance && prevChance !== playerKey) {
        logRecorder.record({
          type: "chance.changed",
          stateVersion: state.stateVersion ?? state.version ?? 1,
          fromChancePlayer: prevChance,
          toChancePlayer: playerKey,
          reason: "turnStart",
        });
      }
      if (prevFocus && prevFocus !== playerKey) {
        logRecorder.record({
          type: "focus.changed",
          stateVersion: state.stateVersion ?? state.version ?? 1,
          fromFocusPlayer: prevFocus,
          toFocusPlayer: playerKey,
          reason: "turnStart",
        });
      }
    }
  }

  /**
   * チャンス（アクション実行権）を相手プレイヤーへ受け渡します。
   */
  static passChance(state: any) {
    if (!state.chancePlayer || state.chancePlayer === RULE_SYSTEM_CHANCE) return;
    state.chancePlayer = getOpponentPlayerKey(state.chancePlayer, state);
  }

  /**
   * 現在のターンを終了し、次のプレイヤーへ手番を移動します。
   *
   * 第9.2版コアフロー対応:
   * - コアフロー[12]〜[13]のステージ解決中（state.chancePlayer === "system"）にエンドが解決された場合、
   *   ここでは手番（turnPlayer / nonTurnPlayer / turnCount / actionCount / turnUsage）のみを更新し、
   *   チャンス（"system"）およびフォーカスは維持します（誘発チェック[5]完了後に[2]で新TPへチャンス・フォーカスが移動します）。
   * - 単体テスト等でルールシステムがチャンスを持たない状態で直接呼ばれた場合は、startTurn と同様に新TPへ設定します。
   */
  static endTurn(state: any, context?: any) {
    const nextPlayer = getOpponentPlayerKey(state.turnPlayer, state);
    if (state.chancePlayer === RULE_SYSTEM_CHANCE) {
      if (!state.players) {
        state.players = {};
      }
      const prevTurnPlayer = state.turnPlayer;
      state.turnPlayer = nextPlayer;
      state.nonTurnPlayer = getOpponentPlayerKey(nextPlayer, state);
      state.turnCount = (state.turnCount || 0) + 1;
      state.actionCount = 0;
      state.turnUsage = {};

      const logRecorder = context?.logRecorder;
      if (logRecorder && prevTurnPlayer && prevTurnPlayer !== nextPlayer) {
        logRecorder.record({
          type: "turn.changed",
          stateVersion: state.stateVersion ?? state.version ?? 1,
          fromTurnPlayer: prevTurnPlayer,
          toTurnPlayer: nextPlayer,
          turnCount: state.turnCount,
        });
      }
      return;
    }

    this.startTurn(state, nextPlayer, context);
  }

  /**
   * 既存テストおよびCLI互換性、およびメインアクション開始準備のための初期化ヘルパー。
   * 指定プレイヤーのターンを開始（turnCount を +1）し、その手番プレイヤーがチャンス・フォーカスを持つ状態にします。
   * ※メソッド名に含まれる "main" はフェーズ名ではなく、「メインタイミングのアクションを起こせる状態（手番かつチャンス所持、ステージ空）」を指します。
   */
  static initializeToMain(state: any, playerKey: string) {
    this.startTurn(state, playerKey);
  }
}
