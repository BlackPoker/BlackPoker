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
}

export interface PlayerObservationView {
  readonly playerId: PlayerKey;
  readonly name: string;
  readonly lifeCount: number;
  readonly lifeCards?: readonly CardView[];
  readonly handCount: number;
  readonly handCards: readonly CardView[];
  readonly field: readonly UnitView[];
  readonly fog: readonly FogView[];
  readonly trumps: readonly UnitView[];
  readonly grave: readonly UnitView[];
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
 * 非公開情報（対戦相手の手札カード内容など）は HIDDEN 化されている。
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
