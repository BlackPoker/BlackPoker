import { PlayerKey } from "../../../domain/decision/DecisionSource";
import { getOpponentPlayerKey } from "../../rules/playerUtils";
import { rankToValue } from "../../rules/cardUtils";

export interface SetupRound {
  readonly round: number;
  readonly p1Card: any;
  readonly p2Card: any;
  readonly result: "p1" | "p2" | "tie";
}

export type FirstPlayerDeterminationSuccess = {
  readonly success: true;
  readonly firstPlayer: PlayerKey;
  readonly rounds: readonly SetupRound[];
  readonly discardedCards: {
    readonly p1: readonly any[];
    readonly p2: readonly any[];
  };
};

export type FirstPlayerDeterminationExhausted = {
  readonly success: false;
  readonly reasonCode: "FIRST_PLAYER_DETERMINATION_LIFE_EXHAUSTED";
  readonly reason: string;
  readonly exhaustedPlayers: readonly PlayerKey[];
  readonly rounds: readonly SetupRound[];
  readonly discardedCards: {
    readonly p1: readonly any[];
    readonly p2: readonly any[];
  };
  readonly winner?: undefined;
  readonly loser?: undefined;
};

export type FirstPlayerDeterminationResult =
  | FirstPlayerDeterminationSuccess
  | FirstPlayerDeterminationExhausted;

export type GameStartSuccess = {
  readonly success: true;
  readonly state: any;
  readonly drawnCard: any;
};

export type GameStartDrawLifeExhausted = {
  readonly success: false;
  readonly reasonCode: "GAME_START_DRAW_LIFE_EXHAUSTED";
  readonly reason: string;
  readonly exhaustedPlayers: readonly [PlayerKey];
  readonly affectedPlayer: PlayerKey;
  readonly winner?: undefined;
  readonly loser?: undefined;
};

export type GameStartResult = GameStartSuccess | GameStartDrawLifeExhausted;

export function isFirstPlayerDeterminationExhausted(
  result: FirstPlayerDeterminationResult
): result is FirstPlayerDeterminationExhausted {
  return !result.success;
}

export function isGameStartDrawLifeExhausted(
  result: GameStartResult
): result is GameStartDrawLifeExhausted {
  return !result.success;
}

/**
 * 先攻決定で公開されたカードを各プレイヤーの墓地へ移動します。
 * ユニット形式（unitId, cards, kind）および生カード形式（id, suit, rank, value）の
 * 双方と互換性を持つ決定論的な墓地エンティティを生成します。
 */
export function moveDiscardedCardsToGrave(player: any, cards: readonly any[]): void {
  if (!Array.isArray(player.grave)) {
    player.grave = [];
  }
  for (const c of cards) {
    player.grave.push({
      unitId: `unit-first-draw-${c.id}`,
      id: c.id,
      suit: c.suit,
      rank: c.rank,
      value: c.value,
      cards: [c],
      kind: "墓地カード",
      labels: [],
    });
  }
}

/**
 * 公式ルール第9.1.2版 3.9.2 (先攻決定) 共通プロシージャ。
 *
 * 1. 両者の Life 先頭を公開しランク比較。
 * 2. 同値なら勝者が決まるまで再試行 (tie retry)。
 * 3. 公開した全カードを各プレイヤーの Grave へ移動。
 * 4. 先攻決定前に Life が枯渇した場合、公式ルールに勝敗の規定が存在しないため、
 *    勝敗・引き分けを勝手に推測せず success: false (FIRST_PLAYER_DETERMINATION_LIFE_EXHAUSTED) を返却します。
 *
 * 【重要】ゲーム内トリガー（cardMoved 等）は一切発火しません。
 */
export function executeFirstPlayerDetermination(
  p1: { life: any[]; grave?: any[]; name?: string },
  p2: { life: any[]; grave?: any[]; name?: string }
): FirstPlayerDeterminationResult {
  const rounds: SetupRound[] = [];
  const p1Discarded: any[] = [];
  const p2Discarded: any[] = [];
  let roundCount = 1;

  while (true) {
    if (p1.life.length === 0 && p2.life.length === 0) {
      moveDiscardedCardsToGrave(p1, p1Discarded);
      moveDiscardedCardsToGrave(p2, p2Discarded);
      return {
        success: false,
        reasonCode: "FIRST_PLAYER_DETERMINATION_LIFE_EXHAUSTED",
        reason: "先攻決定中に双方のライフが枯渇しました",
        exhaustedPlayers: ["p1", "p2"],
        rounds,
        discardedCards: { p1: p1Discarded, p2: p2Discarded },
      };
    }
    if (p1.life.length === 0) {
      moveDiscardedCardsToGrave(p1, p1Discarded);
      moveDiscardedCardsToGrave(p2, p2Discarded);
      return {
        success: false,
        reasonCode: "FIRST_PLAYER_DETERMINATION_LIFE_EXHAUSTED",
        reason: `先攻決定中に ${p1.name || "p1"} のライフが枯渇しました`,
        exhaustedPlayers: ["p1"],
        rounds,
        discardedCards: { p1: p1Discarded, p2: p2Discarded },
      };
    }
    if (p2.life.length === 0) {
      moveDiscardedCardsToGrave(p1, p1Discarded);
      moveDiscardedCardsToGrave(p2, p2Discarded);
      return {
        success: false,
        reasonCode: "FIRST_PLAYER_DETERMINATION_LIFE_EXHAUSTED",
        reason: `先攻決定中に ${p2.name || "p2"} のライフが枯渇しました`,
        exhaustedPlayers: ["p2"],
        rounds,
        discardedCards: { p1: p1Discarded, p2: p2Discarded },
      };
    }

    const p1Card = p1.life.shift();
    const p2Card = p2.life.shift();

    p1Discarded.push(p1Card);
    p2Discarded.push(p2Card);

    const p1Val = p1Card.value !== undefined ? p1Card.value : rankToValue(p1Card.rank);
    const p2Val = p2Card.value !== undefined ? p2Card.value : rankToValue(p2Card.rank);

    if (p1Val > p2Val) {
      rounds.push({ round: roundCount, p1Card, p2Card, result: "p1" });
      moveDiscardedCardsToGrave(p1, p1Discarded);
      moveDiscardedCardsToGrave(p2, p2Discarded);
      return {
        success: true,
        firstPlayer: "p1",
        rounds,
        discardedCards: { p1: p1Discarded, p2: p2Discarded },
      };
    } else if (p2Val > p1Val) {
      rounds.push({ round: roundCount, p1Card, p2Card, result: "p2" });
      moveDiscardedCardsToGrave(p1, p1Discarded);
      moveDiscardedCardsToGrave(p2, p2Discarded);
      return {
        success: true,
        firstPlayer: "p2",
        rounds,
        discardedCards: { p1: p1Discarded, p2: p2Discarded },
      };
    } else {
      rounds.push({ round: roundCount, p1Card, p2Card, result: "tie" });
      roundCount++;
    }
  }
}

/**
 * 公式ルール第9.1.2版 3.9.3 (ゲーム開始) 共通プロシージャ。
 *
 * 1. 先攻プレイヤーは Life 先頭から 1枚を Hand へドロー。
 * 2. 先攻プレイヤーに Turn および Chance を設定。
 * 3. ゲーム開始（turnCount = 1, actionCount = 0, turnUsage = {}）。
 *
 * 【Zero Partial Mutation 契約】
 * 先攻プレイヤーの Life が 0 枚の場合、公式ルールに勝敗・引き分け・代替処理が未定義であるため、
 * 入力 state を一切変更せず（Validation First）、即座に success: false (GAME_START_DRAW_LIFE_EXHAUSTED) を返却します。
 * ゲーム開始状態（turnPlayer / chancePlayer 等）は確定されません。
 */
export function applyGameStart(state: any, firstPlayer: PlayerKey): GameStartResult {
  const firstPlayerObj = state.players?.[firstPlayer];
  if (!firstPlayerObj || !Array.isArray(firstPlayerObj.life)) {
    throw new Error(`applyGameStart: プレイヤー ${firstPlayer} の life が存在しません。`);
  }

  // 1. Validation First: 先攻プレイヤーのライフが1枚以上あるかを検証
  // 不足している場合は一切の state mutation を行わずに即時返却 (Zero Partial Mutation)
  if (firstPlayerObj.life.length === 0) {
    return {
      success: false,
      reasonCode: "GAME_START_DRAW_LIFE_EXHAUSTED",
      reason: `ゲーム開始ドロー処理中に先攻プレイヤー (${firstPlayer}) のライフが不足しています`,
      exhaustedPlayers: [firstPlayer],
      affectedPlayer: firstPlayer,
    };
  }

  // 2. Atomic Mutation: 先攻プレイヤーがライフから1枚引いて手札へ加える
  const drawnCard = firstPlayerObj.life.shift();
  if (!Array.isArray(firstPlayerObj.hand)) {
    firstPlayerObj.hand = [];
  }
  firstPlayerObj.hand.push(drawnCard);

  // 3. ゲーム開始情報の確定
  state.turnPlayer = firstPlayer;
  state.chancePlayer = firstPlayer;
  state.nonTurnPlayer = getOpponentPlayerKey(firstPlayer, state);
  state.turnCount = 1;
  state.actionCount = 0;
  state.turnUsage = {};
  state.stateVersion = (state.stateVersion || 1) + 1;

  return {
    success: true,
    state,
    drawnCard,
  };
}
