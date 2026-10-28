import { DecisionRequest } from "../decision/DecisionRequest";
import { CanonicalMatchLog } from "../log/CanonicalMatchLog";
import { EffectContinuation } from "../../engine/session/GameSession";

/**
 * Snapshot フォーマットバージョン (現在: 2 — 第9.2版コアフロー フォーカス方式対応)
 */
export const SNAPSHOT_FORMAT_VERSION = 2;

/**
 * GameSession Snapshot のメタデータ (RulePackage.id / RulePackage.version を正式保持)
 */
export interface GameSessionSnapshotMetadata {
  readonly matchId: string;
  readonly rulePackageRef: string;
  readonly rulesVersion: string;
  readonly createdAt: number;
}

/**
 * 効果解決コンテキストのシリアライズ用データ (JSON-safe DTO)
 * ※ runtime object (registry, logRecorder, function) は除外
 */
export interface ResolvingContextSnapshotData {
  readonly playerKey: string;
  readonly keyCardIds?: readonly string[];
  readonly keyCards?: readonly any[];
  readonly targetComponent?: any;
  readonly targetRequest?: any;
  readonly targetPlayerKey?: string;
  readonly selections?: Record<string, any>;
  readonly sourceEvent?: any;
  readonly currentActionId?: string;
  readonly currentRequestId?: string;
}

/**
 * GameSession の進行管理・内部状態データ (JSON-safe DTO)
 */
export interface GameSessionSnapshotSessionData {
  readonly matchSeed?: number;
  readonly consecutivePassCount: number;
  readonly pendingDecision?: DecisionRequest;
  readonly continuation?: EffectContinuation;
  readonly resolvingRequest?: any;
  readonly resolvingContext?: ResolvingContextSnapshotData;
  readonly matchStartedRecorded: boolean;
  readonly lastRecordedTurnPlayer?: string;
  readonly pendingDirectFocusPlayer?: string;
}

/**
 * GameSession の完全な JSON-safe Snapshot DTO (Format Version 2)
 */
export interface GameSessionSnapshot {
  readonly snapshotFormatVersion: 2;
  readonly metadata: GameSessionSnapshotMetadata;
  readonly gameState: any;
  readonly gameStateHash: string;
  readonly session: GameSessionSnapshotSessionData;
  readonly matchLog?: CanonicalMatchLog;
}
