/**
 * TacticalEvaluationTypes.ts
 *
 * BlackPoker Simulator - 観測情報ベースの戦術評価インターフェース型定義 (Work 5-1 R3)
 *
 * 【アーキテクチャ境界原則】
 * 1. このモジュールは domain/decision レイヤーに属し、RulePackage, GameState, GameSession 等の
 *    Core 内部状態やルールパッケージ全体には一切依存しない。
 * 2. DecisionPolicy (engine/ai) が安全に参照できる公開インターフェースおよび評価結果モデルを提供する。
 * 3. 確定情報 (CERTAIN)、非公開カード等の推定情報 (ESTIMATED)、評価不能 (UNKNOWN) を厳格に型レベルで区別する。
 */

import {
  PlayerObservation,
  RequestView,
  UnitView,
} from "./PlayerObservation.js";
import { DecisionCatalog, LegalPattern } from "./DecisionCatalog.js";
import { DecisionRequest } from "./DecisionRequest.js";

/**
 * 戦術評価における数値範囲および確実性情報
 */
export interface TacticalValueRange {
  /** 最小可能値 (例: ♠A = 1) */
  readonly min: number;
  /** 最大可能値 (例: ♠K = 13) */
  readonly max: number;
  /** 期待値・中央値 (例: ♠8 = 8) */
  readonly expected: number;
  /** 公開情報のみで確定的に単一値として決まっているか (min === max === expected) */
  readonly isCertain: boolean;
}

/**
 * ガード条件・ブール条件の判定状態
 */
export type TacticalConditionStatus =
  /** 確定成立 (公開情報から条件が真であることが確定) */
  | "CERTAIN_SATISFIED"
  /** 確定不発 (公開情報から条件が偽であることが確定。後続効果は発動しない) */
  | "CERTAIN_UNSATISFIED"
  /** 不確実 (非公開カードや未解決選択肢に依存し、成立・不発の双方が起こりうる) */
  | "UNCERTAIN";

/**
 * リクエストに対する戦術損害・影響の評価結果
 */
export interface TacticalRequestOutcome {
  /** 判定全体の確実性レベル */
  readonly certainty: "CERTAIN" | "ESTIMATED" | "UNKNOWN";

  /** ガード条件の判定状態 */
  readonly guardStatus: TacticalConditionStatus;

  /** 自軍プレイヤーへの直接ダメージ範囲 (dealDamage) */
  readonly directDamageToSelf: TacticalValueRange;

  /** 自軍ライフへの獲得/シールド範囲 (moveUnitCardsToZoneTop: life) */
  readonly lifeGainToSelf: TacticalValueRange;

  /** 自軍プレイヤーへの正味ライフ損害範囲 (netDamage = Math.max(0, directDamage - lifeGain)) */
  readonly netDamageToSelf: TacticalValueRange;

  /** 相手プレイヤーへの正味損害範囲 */
  readonly netDamageToOpponent: TacticalValueRange;

  /** 破壊される自軍ユニット一覧 */
  readonly destroyedSelfUnits: readonly UnitView[];

  /** 破壊される相手ユニット一覧 */
  readonly destroyedOppUnits: readonly UnitView[];

  /** ガード条件不成立（確定不発）か */
  readonly isGuardedOut: boolean;

  /** 評価詳細・理由ログ */
  readonly reasons: readonly string[];
}

/**
 * カウンター等の打ち消し選択肢に対する戦術評価結果
 */
export interface TacticalCounterOutcome {
  /** カウンター条件の成立状態 */
  readonly cancelStatus: "CERTAIN_CANCEL" | "UNCERTAIN_CANCEL" | "CANNOT_CANCEL";

  /** 阻止できる損害の範囲 */
  readonly preventedDamageToSelf: TacticalValueRange;

  /** 判定が確定的か */
  readonly isCertain: boolean;

  /** 評価詳細・理由ログ */
  readonly reasons: readonly string[];
}

/**
 * DecisionPolicy が戦術判断に使用する抽象評価器インターフェース
 */
export interface TacticalEvaluator {
  /**
   * Stage リクエストを公開観測情報に基づいて評価
   */
  evaluateRequestOutcome(
    req: Readonly<RequestView>,
    viewerKey: string,
    obs: Readonly<PlayerObservation>
  ): TacticalRequestOutcome;

  /**
   * カウンター・打ち消しアクションの選択肢を評価
   */
  evaluateCounterOutcome(
    pattern: Readonly<LegalPattern>,
    targetOppReq: Readonly<RequestView>,
    request: Readonly<DecisionRequest>,
    targetReqOutcome: TacticalRequestOutcome
  ): TacticalCounterOutcome;
}
