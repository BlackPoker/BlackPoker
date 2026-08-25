import { PlayerKey } from "../../../domain/decision/DecisionSource";
import { getOpponentPlayerKey } from "../../rules/playerUtils";
import { rankToValue } from "../../rules/cardUtils";

export interface SetupRound {
  readonly round: number;
  readonly p1Card: any;
  readonly p2Card: any;
  readonly result: "p1" | "p2" | "tie";
}

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
 * ゲーム開始前の準備処理として、ゲーム内トリガーを発生させずに先攻決定・墓地送り・先攻1枚ドローを行います。
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

    const rounds: SetupRound[] = [];
    const p1Discarded: any[] = [];
    const p2Discarded: any[] = [];
    let firstPlayer: PlayerKey | null = null;
    let roundCount = 1;

    // 3.9.2 先攻決定: 両者ライフ最上段（index 0）を取り出し、勝者が決まるまで比較
    while (!firstPlayer) {
      if (p1.life.length === 0 || p2.life.length === 0) {
        throw new Error("MatchSetupCoordinator: 先攻決定中にライフが不足しました。");
      }

      const p1Card = p1.life.shift();
      const p2Card = p2.life.shift();

      p1Discarded.push(p1Card);
      p2Discarded.push(p2Card);

      const p1Val = p1Card.value !== undefined ? p1Card.value : rankToValue(p1Card.rank);
      const p2Val = p2Card.value !== undefined ? p2Card.value : rankToValue(p2Card.rank);

      if (p1Val > p2Val) {
        rounds.push({ round: roundCount, p1Card, p2Card, result: "p1" });
        firstPlayer = "p1";
      } else if (p2Val > p1Val) {
        rounds.push({ round: roundCount, p1Card, p2Card, result: "p2" });
        firstPlayer = "p2";
      } else {
        rounds.push({ round: roundCount, p1Card, p2Card, result: "tie" });
        roundCount++;
      }
    }

    // 公開したカードをすべて各プレイヤーの墓地へ移す
    p1.grave.push(...p1Discarded);
    p2.grave.push(...p2Discarded);

    // 3.9.3 ゲーム開始: 先攻プレイヤーはライフから1枚引いて手札へ
    const firstPlayerObj = state.players[firstPlayer];
    let drawnCard: any = undefined;
    if (firstPlayerObj.life.length > 0) {
      drawnCard = firstPlayerObj.life.shift();
      firstPlayerObj.hand.push(drawnCard);
    }

    // ターン情報・チャンス情報の初期化
    state.turnPlayer = firstPlayer;
    state.chancePlayer = firstPlayer;
    state.nonTurnPlayer = getOpponentPlayerKey(firstPlayer, state);
    state.turnCount = 1;
    state.actionCount = 0;
    state.turnUsage = {};
    state.stateVersion = (state.stateVersion || 1) + 1;

    return {
      firstPlayer,
      rounds,
      discardedCards: {
        p1: p1Discarded,
        p2: p2Discarded,
      },
      drawnCard,
      state,
    };
  }
}
