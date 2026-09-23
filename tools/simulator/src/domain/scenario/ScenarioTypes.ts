/**
 * Scenario Definition V1
 *
 * BlackPoker Scenario Builder の高レベル抽象シナリオ定義型。
 * Raw GameState, stateVersion, 内部 unitId / cardId, raw stage.requests,
 * および「Phase」概念を一切含まず、ゲームとして意味のある概念のみで構成されます。
 */

export const SCENARIO_SCHEMA_VERSION = 1;

/**
 * 高レベルカード参照
 * Canonical Deck Profile の定義に準拠し、Joker は suit: "J", rank: "Joker" とします。
 */
export interface ScenarioCardRefV1 {
  readonly suit: "S" | "H" | "D" | "C" | "J";
  readonly rank: string;
  /**
   * 同一 (suit, rank) を持つ物理カードがデッキ内に複数存在する場合の 0-indexed occurrence。
   * 該当カードがデッキ内に1枚のみの場合は省略可能（自動的に 0 として解決）。
   */
  readonly occurrence?: number;
}

/**
 * Life や Pack などの Zone 設定。
 * 固定カードの配列、または固定カード + 目標枚数の指定が可能です。
 */
export interface ScenarioZoneConfigV1 {
  readonly cards?: readonly ScenarioCardRefV1[];
  readonly count?: number;
}

/**
 * フィールドユニット定義。
 * kind や labels などの派生プロパティは含めず、componentId からコンパイラが自動導出します。
 */
export interface ScenarioUnitV1 {
  readonly componentId: string;
  readonly card: ScenarioCardRefV1;
  readonly state?: "charge" | "drive";
  readonly face?: "up" | "down";
}

/**
 * プレイヤーごとの配置設定
 */
export interface ScenarioPlayerV1 {
  readonly hand?: readonly ScenarioCardRefV1[];
  readonly life?: readonly ScenarioCardRefV1[] | ScenarioZoneConfigV1;
  readonly field?: readonly ScenarioUnitV1[];
  /**
   * 墓地カードリスト。
   * 配列の末尾（最後の要素）が墓地最上段 (graveTop) として決定論的に扱われます。
   */
  readonly grave?: readonly ScenarioCardRefV1[];
  readonly pack?: readonly ScenarioCardRefV1[] | ScenarioZoneConfigV1;
}

/**
 * 高レベルシナリオ定義 V1
 */
export interface ScenarioDefinitionV1 {
  readonly version: 1;
  readonly name?: string;
  readonly description?: string;
  readonly environmentId: string; // official:<regulationId> のみ許可 (core-battle は V1 対象外)
  readonly seed: number;
  readonly turnPlayer: "p1" | "p2";
  readonly chancePlayer: "p1" | "p2";
  readonly turnCount?: number;
  readonly players: {
    readonly p1: ScenarioPlayerV1;
    readonly p2: ScenarioPlayerV1;
  };
}

export type ScenarioValidationErrorCode =
  | "UNSUPPORTED_VERSION"
  | "UNSUPPORTED_ENVIRONMENT"
  | "INVALID_SEED"
  | "INVALID_PLAYER"
  | "INVALID_CARD_REF"
  | "AMBIGUOUS_CARD_REFERENCE"
  | "DUPLICATE_CARD"
  | "UNSUPPORTED_COMPONENT"
  | "INVALID_UNIT_STATE"
  | "INVALID_UNIT_FACE"
  | "INVALID_ZONE_CONFIG"
  | "DECK_COMPLETION_IMPOSSIBLE"
  | "UNSUPPORTED_STAGE"
  | "SCHEMA_VIOLATION";

export interface ScenarioValidationError {
  readonly code: ScenarioValidationErrorCode;
  readonly path: string;
  readonly message: string;
}

export interface ScenarioValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ScenarioValidationError[];
}
