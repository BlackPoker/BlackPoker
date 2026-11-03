import { PlayerKey, DecisionSource } from "./DecisionSource.js";
import { PlayerObservation } from "./PlayerObservation.js";
import { DecisionCatalog, UnitAssignment, EffectSelection } from "./DecisionCatalog.js";
import { LegalPattern } from "./LegalPattern.js";

/**
 * ブロック割り当てなどの超大規模合法手集合に対するオンデマンド・ストリーミング評価プロバイダ
 */
export interface BlockAssignmentStreamProvider {
  /** 合法パターンの総数 (厳密値) */
  readonly patternCount: number;
  /** 候補ブロッカー数 (candidateBlockers.length, 特徴量カバレッジ率の正規化分母) */
  readonly candidateCount: number;
  /** アタッカー数 */
  readonly attackerCount: number;
  /** 全合法パターンを 1 件ずつ遅延列挙するジェネレータ (DFS探索順序完全固定) */
  readonly iterateAssignments: () => Generator<UnitAssignment[], void, unknown>;
  /** 指定インデックスの割り当てを取得 */
  readonly getAssignmentAt: (index: number) => UnitAssignment[] | undefined;
  /** 割り当てに対する要約文字列をオンデマンド生成 */
  readonly createSummary: (assignments: readonly UnitAssignment[]) => string;
  /** 選択された特定インデックスのパターンと効果選択を安全に実体化 */
  readonly instantiatePatternAt: (index: number) => { pattern: LegalPattern; effectSelection: EffectSelection } | undefined;
}

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
   * ストリーミングモードの場合でも、小規模時は全件、大規模時は選択された手や軽量表現を保持します。
   */
  readonly patterns: readonly LegalPattern[];

  /**
   * ブロック割り当て等の大規模合法手空間をストリーミング処理するためのプロバイダ (任意)
   */
  readonly blockAssignmentStream?: BlockAssignmentStreamProvider;

  /**
   * ストリーミングプロバイダを JSON-safe にスナップショット復元するための識別情報 (任意)
   */
  readonly blockAssignmentStreamMeta?: {
    readonly attackerUnitIds: readonly string[];
    readonly candidateBlockerUnitIds: readonly string[];
    readonly patternCount: number;
  };
}
