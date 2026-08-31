/**
 * BlackPoker Canonical Match Log Domain Types
 * Schema Version: 0.1
 * 
 * 公式ルール3.10および5.4.5〜5.4.7に完全準拠し、
 * アクション処理系（Stage, Request, Request Buffer, Chance, Decision）と
 * 盤面系（Zone, Unit, Card, Component）を明確に分離した設計。
 */

export type CanonicalGameEventType =
  | "match.started"
  | "match.finished"
  | "decision.requested"
  | "decision.responded"
  | "request.created"
  | "request.resolve.started"
  | "request.resolved"
  | "request.cancelled"
  | "trigger.detected"
  | "requestBuffer.enqueued"
  | "requestBuffer.dequeued"
  | "requestBuffer.discarded"
  | "stage.pushed"
  | "stage.popped"
  | "turn.changed"
  | "chance.changed"
  | "player.passed"
  | "card.moved";

export type CardZoneName = "hand" | "field" | "grave" | "fog" | "life";

export type CardLocation =
  | {
      readonly kind: "zone";
      readonly playerId: string;
      readonly zone: CardZoneName;
    }
  | {
      readonly kind: "request";
      readonly requestId: string;
    }
  | {
      readonly kind: "deck";
      readonly playerId: string;
    };


export interface CanonicalGameEventBase {
  readonly seq: number;
  readonly stateVersion: number;
  readonly type: CanonicalGameEventType;
  readonly timestamp?: string;
}

export interface MatchStartedEvent extends CanonicalGameEventBase {
  readonly type: "match.started";
  readonly matchId: string;
  readonly turnPlayer: string;
  readonly chancePlayer: string;
  readonly initialPlayers: readonly string[];
}

export interface MatchFinishedEvent extends CanonicalGameEventBase {
  readonly type: "match.finished";
  readonly winner?: string;
  readonly reason: string;
}

export interface DecisionRequestedEvent extends CanonicalGameEventBase {
  readonly type: "decision.requested";
  readonly decisionId: string;
  readonly playerId: string;
  readonly source: "ACTION_REQUEST" | "EFFECT_RESOLUTION";
  readonly requestId?: string;
  readonly legalPatternCount: number;
  readonly legalPatternRefs?: readonly number[];
}

export interface DecisionRespondedEvent extends CanonicalGameEventBase {
  readonly type: "decision.responded";
  readonly decisionId: string;
  readonly playerId: string;
  readonly source: "ACTION_REQUEST" | "EFFECT_RESOLUTION";
  readonly selectedPatternRef: number;
}

export interface RequestCreatedEvent extends CanonicalGameEventBase {
  readonly type: "request.created";
  readonly requestId: string;
  readonly actionRef: string;
  readonly requester: string;
  readonly controller: string;
  readonly definitionOwner?: string;
  readonly speed?: "immediate" | "normal";
  readonly timing?: string;
  readonly decisionId?: string;
  readonly sourcePatternId?: string;
  readonly keyCardIds?: readonly string[];
  readonly targetRefs?: readonly any[];
}

export interface RequestResolveStartedEvent extends CanonicalGameEventBase {
  readonly type: "request.resolve.started";
  readonly requestId: string;
  readonly actionRef: string;
  readonly controller: string;
}

export interface RequestResolvedEvent extends CanonicalGameEventBase {
  readonly type: "request.resolved";
  readonly requestId: string;
  readonly actionRef: string;
  readonly controller: string;
  readonly result?: any;
}

export interface RequestCancelledEvent extends CanonicalGameEventBase {
  readonly type: "request.cancelled";
  readonly requestId: string;
  readonly actionRef: string;
  readonly controller: string;
  readonly reason?: string;
}

export interface TriggerDetectedEvent extends CanonicalGameEventBase {
  readonly type: "trigger.detected";
  readonly actionRef: string;
  readonly controller: string;
  readonly definitionOwner?: string;
  readonly causedByEvent?: any;
}

export interface RequestBufferEnqueuedEvent extends CanonicalGameEventBase {
  readonly type: "requestBuffer.enqueued";
  readonly actionRef: string;
  readonly controller: string;
  readonly definitionOwner?: string;
}

export interface RequestBufferDequeuedEvent extends CanonicalGameEventBase {
  readonly type: "requestBuffer.dequeued";
  readonly actionRef: string;
  readonly controller: string;
  readonly requestId: string;
  readonly speed?: "immediate" | "normal";
}

export interface RequestBufferDiscardedEvent extends CanonicalGameEventBase {
  readonly type: "requestBuffer.discarded";
  readonly actionRef: string;
  readonly controller: string;
  readonly reason: string;
}

export interface StagePushedEvent extends CanonicalGameEventBase {
  readonly type: "stage.pushed";
  readonly requestId: string;
  readonly actionRef: string;
  readonly depthBefore: number;
  readonly depthAfter: number;
  readonly topRequestId: string;
}

export interface StagePoppedEvent extends CanonicalGameEventBase {
  readonly type: "stage.popped";
  readonly requestId: string;
  readonly actionRef: string;
  readonly depthBefore: number;
  readonly depthAfter: number;
}

export interface TurnChangedEvent extends CanonicalGameEventBase {
  readonly type: "turn.changed";
  readonly fromTurnPlayer: string;
  readonly toTurnPlayer: string;
  readonly turnCount: number;
}

export interface ChanceChangedEvent extends CanonicalGameEventBase {
  readonly type: "chance.changed";
  readonly fromChancePlayer?: string;
  readonly toChancePlayer: string;
  readonly reason?: string;
}

export interface PlayerPassedEvent extends CanonicalGameEventBase {
  readonly type: "player.passed";
  readonly playerId: string;
  readonly passCount: number;
}

export interface CardMovedEvent extends CanonicalGameEventBase {
  readonly type: "card.moved";
  readonly cardId: string;
  readonly from: CardLocation;
  readonly to: CardLocation;
  readonly cause?: {
    readonly type: "cost" | "damage" | "keyCard" | "requestFinalize" | "effect" | "setup" | "rule";
    readonly requestId?: string;
    readonly details?: string;
  };
}

export type CanonicalGameEvent =
  | MatchStartedEvent
  | MatchFinishedEvent
  | DecisionRequestedEvent
  | DecisionRespondedEvent
  | RequestCreatedEvent
  | RequestResolveStartedEvent
  | RequestResolvedEvent
  | RequestCancelledEvent
  | TriggerDetectedEvent
  | RequestBufferEnqueuedEvent
  | RequestBufferDequeuedEvent
  | RequestBufferDiscardedEvent
  | StagePushedEvent
  | StagePoppedEvent
  | TurnChangedEvent
  | ChanceChangedEvent
  | PlayerPassedEvent
  | CardMovedEvent;

export interface CanonicalMatchLogMeta {
  readonly matchId: string;
  readonly rulesVersion?: string;
  readonly rulePackageRef?: string;
  readonly buildSha?: string;
  readonly buildRef?: string;
  readonly simulatorCommit?: string;
  readonly startedAt: string;
  readonly finishedAt?: string;
}

export interface CanonicalMatchLog {
  readonly schemaVersion: "0.1";
  readonly meta: CanonicalMatchLogMeta;
  readonly events: readonly CanonicalGameEvent[];
}
