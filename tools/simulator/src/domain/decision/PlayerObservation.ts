import { PlayerKey, RequestRef } from "./DecisionSource";

export interface KnownCardView {
  readonly visibility: "KNOWN";
  readonly cardInstanceId: string;
  readonly suit: string;
  readonly rank: string;
  readonly value: number;
  readonly faceUp: boolean;
  readonly code?: string;
}

export interface HiddenCardView {
  readonly visibility: "HIDDEN";
  readonly opaqueCardId?: string;
  readonly faceUp: false;
}

export type CardView = KnownCardView | HiddenCardView;

export interface UnitView {
  readonly unitId: string;
  readonly kind: string;
  readonly componentId?: string;
  readonly state: "charge" | "drive" | string;
  readonly face: "up" | "down" | string;
  readonly cards: readonly CardView[];
  readonly labels: readonly string[];
  readonly currentSize?: number;
  readonly battle?: {
    readonly role: "attacker" | "blocker" | string;
    readonly targetPlayerKey?: string;
    readonly blocksUnitId?: string;
  };
}

export interface FogView {
  readonly fogId: string;
  readonly componentId: string;
  readonly card?: CardView;
  readonly bindings?: Record<string, any>;
  readonly ownerPlayerId?: PlayerKey;
}

export interface PlayerObservationView {
  readonly playerId: PlayerKey;
  readonly name: string;
  readonly isViewer: boolean;
  /**
   * 観測可能な正確なライフ枚数。
   * 自分なら正確な枚数、相手かつ9枚以下なら正確な枚数。
   * 相手かつ10枚以上の場合は観測不能なため undefined となる。
   */
  readonly lifeCount?: number;
  /**
   * ライフの表示用文字列（自分: "15", 相手9以下: "9", 相手10以上: "10以上"）。
   */
  readonly lifeDisplay: string;
  readonly handCount: number;
  readonly handCards: readonly CardView[];
  readonly field: readonly UnitView[];
  readonly fog: readonly FogView[];
  readonly trumps: readonly UnitView[];
  readonly graveCount: number;
  readonly graveTopCard?: CardView;
  readonly grave: readonly (UnitView | CardView)[];
  readonly canViewFullGrave: boolean;
}

export interface RequestView {
  readonly requestId: RequestRef;
  readonly actionId: string;
  readonly actionName?: string;
  readonly controller: PlayerKey;
  readonly status: string;
  readonly sequence: number;
  readonly definitionOwner?: string;
}

export interface GameEventView {
  readonly eventId: string;
  readonly type: string;
  readonly payload: Record<string, any>;
  readonly timestamp?: number;
}

/**
 * プレイヤー視点の読み取り専用盤面情報。
 * その viewer がルール上合法的に観測可能な情報のみを持つ安全な読み取りモデル。
 * AI入力、Replay分析、観戦、ネットワーク対戦にもそのまま渡すことができるよう、
 * 観測不能な秘密情報（相手の手札・相手の伏せ防壁・相手のLife 10以上時の正確な枚数やLifeカード中身等）は
 * 完全に排除・HIDDEN化されている。
 */
export interface PlayerObservation {
  readonly viewerPlayerId: PlayerKey;
  readonly turnPlayerId?: PlayerKey;
  readonly chancePlayerId?: PlayerKey;
  readonly players: readonly PlayerObservationView[];
  readonly stageRequestRefs: readonly RequestRef[];
  readonly stageRequests: readonly RequestView[];
  readonly recentEvents: readonly GameEventView[];
}
