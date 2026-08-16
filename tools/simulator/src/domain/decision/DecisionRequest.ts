import { PlayerKey, DecisionSource } from "./DecisionSource";
import { PlayerObservation } from "./PlayerObservation";
import { DecisionCatalog } from "./DecisionCatalog";
import { LegalPattern } from "./LegalPattern";

/**
 * エンジンからプレイヤー（人間またはAI）へ提示される判断要求。
 */
export interface DecisionRequest {
  readonly protocolVersion: string;
  readonly matchId: string;
  readonly decisionId: string;

  /**
   * 判断要求を生成した盤面のバージョン。
   * 古い画面や古いAI回答を拒否するために使用する。
   */
  readonly stateVersion: number;

  /**
   * 今回判断するプレイヤー。
   */
  readonly playerId: PlayerKey;

  /**
   * 判断が発生した理由。
   */
  readonly source: DecisionSource;

  /**
   * playerIdから見える盤面情報。
   */
  readonly observation: PlayerObservation;

  /**
   * パターンから共有参照するカタログ。
   */
  readonly catalog: DecisionCatalog;

  /**
   * 現在選べる合法な完成パターン全件。
   */
  readonly patterns: readonly LegalPattern[];
}
