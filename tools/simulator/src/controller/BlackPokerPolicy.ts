import { DecisionRequest } from "../domain/decision/DecisionRequest";
import { DecisionResponse } from "../domain/decision/DecisionResponse";
import { PlayerKey } from "../domain/decision/DecisionSource";
import { DecisionPolicy, PolicyDescriptor } from "../engine/simulation/DecisionPolicy";

export type { DecisionPolicy, PolicyDescriptor };

/**
 * AI判断ロジック（Policy）のインターフェース。
 * engine/simulation/DecisionPolicy の Canonical interface を継承・統合し、
 * 同期 choose と非同期 decide の両方をサポートします。
 */
export interface BlackPokerPolicy extends DecisionPolicy {
  readonly descriptor: PolicyDescriptor;
  choose(request: Readonly<DecisionRequest>): DecisionResponse;
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
