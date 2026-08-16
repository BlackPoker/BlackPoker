import { DecisionRequest } from "../domain/decision/DecisionRequest";
import { DecisionResponse } from "../domain/decision/DecisionResponse";
import { PlayerKey } from "../domain/decision/DecisionSource";

/**
 * AI判断ロジック（Policy）のインターフェース。
 */
export interface BlackPokerPolicy {
  decide(request: Readonly<DecisionRequest>): Promise<DecisionResponse>;
}

/**
 * 座席ごとのコントローラー設定
 */
export type SeatController =
  | {
      readonly type: "HUMAN";
    }
  | {
      readonly type: "AI";
      readonly policy: BlackPokerPolicy;
    };

/**
 * マッチ全体のコントローラー割り当て
 */
export type MatchControllers = Record<PlayerKey, SeatController>;
