import { PlayerKey } from "../../../domain/decision/DecisionSource";
import { FormattedLogEntry } from "./GameEventFormatter";

/**
 * Presentation イベント種別
 */
export type PlaytestPresentationEventKind =
  | "ACTION_RESOLVED"
  | "REQUEST_CANCELLED"
  | "UNIT_STATE_CHANGED"
  | "DAMAGE"
  | "DRAW"
  | "UNIT_DEFEATED"
  | "TURN_CHANGED"
  | "COST_PAID"
  | "CHARGE_RESTORED"
  | "STAGE_REMOVED"
  | "DAMAGE_JUDGE"
  | "BULWARK_JUDGE"
  | "GENERIC";

/**
 * 閲覧者視点（Human-safe）の UI Presentation 専用派生 View Model。
 * Canonical Match Log を置き換えるものではなく、UI 表示（GameLog / Action Feedback Flash）用。
 * FormattedLogEntry と後方互換性を持ちます。
 */
export interface PlaytestPresentationEvent extends FormattedLogEntry {
  /** 決定論的な Presentation ID (例: `v5-0-ACTION_RESOLVED`)。Date.now / Math.random は不使用 */
  readonly id: string;
  readonly stateVersion: number;
  readonly kind: PlaytestPresentationEventKind;
  readonly message: string;
  readonly level: "info" | "action" | "event" | "system";

  readonly actorPlayerId?: PlayerKey;
  readonly actorName?: string;
  readonly actionId?: string;
  readonly actionName?: string;
  readonly targetLabel?: string;
  readonly requestId?: string;
  readonly targetRequestId?: string;
  readonly sourceRequestId?: string;
  readonly sourceCanonicalSeq?: number;
  readonly targetUnitId?: string;

  readonly unitId?: string;
  readonly unitLabel?: string;
  readonly fromState?: string;
  readonly toState?: string;

  readonly damageAmount?: number;
  readonly calculatedDamage?: number;
  readonly remainingLifeDisplay?: string;
  readonly drawCount?: number;
  readonly timestamp?: string;
}

/**
 * 決定論的な Presentation Event ID を生成します。
 */
export function createDeterministicPresentationEventId(
  stateVersion: number,
  localIndex: number,
  kind: PlaytestPresentationEventKind
): string {
  return `v${stateVersion}-${localIndex}-${kind}`;
}
