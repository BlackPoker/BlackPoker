import {
  ScenarioCardRefV1,
  ScenarioUnitV1,
  ScenarioZoneConfigV1,
  ScenarioDefinitionV1,
  ScenarioValidationError,
} from "./ScenarioTypes";

/**
 * 手札ドラフト設定
 * count を指定した場合、fixedCards に不足する枚数がデッキから自動補完されます。
 */
export interface ScenarioAuthoringHandDraftV1 {
  readonly count?: number;
  readonly fixedCards?: readonly ScenarioCardRefV1[];
}

/**
 * ライフドラフト設定
 * count を指定した場合、fixedTopCards に不足する枚数がデッキから自動補完されます。
 * count 指定時の余剰カード（手札・パック・ライフ・フィールド・墓地以外）は自動的に墓地へ割り当てられます。
 * count 未指定時は、残余カードのすべてがライフへ割り当てられます。
 */
export interface ScenarioAuthoringLifeDraftV1 {
  readonly count?: number;
  readonly fixedTopCards?: readonly ScenarioCardRefV1[];
  readonly cards?: readonly ScenarioCardRefV1[]; // fixedTopCards のエイリアス
}

/**
 * 墓地ドラフト設定
 * explicitCards を指定した場合、その配列の末尾が墓地最上段 (graveTop) となります。
 * ライフ枚数指定に伴う残余カードは、explicitCards の手前に決定論的に追加されます。
 */
export interface ScenarioAuthoringGraveDraftV1 {
  readonly explicitCards?: readonly ScenarioCardRefV1[];
}

/**
 * パックドラフト設定
 * count 未指定時は、対象フレームの規定 packCount (例: 14枚) が目標枚数となります。
 */
export interface ScenarioAuthoringPackDraftV1 {
  readonly count?: number;
  readonly fixedCards?: readonly ScenarioCardRefV1[];
  readonly cards?: readonly ScenarioCardRefV1[]; // fixedCards のエイリアス
}

/**
 * プレイヤーごとの Authoring ドラフト
 */
export interface ScenarioAuthoringPlayerDraftV1 {
  readonly hand?: ScenarioAuthoringHandDraftV1 | readonly ScenarioCardRefV1[];
  readonly life?: ScenarioAuthoringLifeDraftV1 | ScenarioZoneConfigV1;
  readonly field?: readonly ScenarioUnitV1[];
  readonly grave?: ScenarioAuthoringGraveDraftV1 | readonly ScenarioCardRefV1[];
  readonly pack?: ScenarioAuthoringPackDraftV1 | ScenarioZoneConfigV1;
}

/**
 * シナリオ作成用ドラフト V1
 * Canonical な ScenarioDefinitionV1 を構築するための部分指定用ドラフト。
 */
export interface ScenarioAuthoringDraftV1 {
  readonly environmentId: string;
  readonly seed: number;
  readonly turnPlayer: "p1" | "p2";
  readonly chancePlayer: "p1" | "p2";
  readonly turnCount?: number;
  readonly name?: string;
  readonly description?: string;
  readonly players: {
    readonly p1: ScenarioAuthoringPlayerDraftV1;
    readonly p2: ScenarioAuthoringPlayerDraftV1;
  };
}

/**
 * Authoring Resolver の解決結果
 */
export type ScenarioAuthoringResult =
  | {
      readonly success: true;
      readonly definition: ScenarioDefinitionV1;
      readonly errors?: readonly ScenarioValidationError[];
    }
  | {
      readonly success: false;
      readonly errors: readonly ScenarioValidationError[];
      readonly definition?: ScenarioDefinitionV1;
    };
