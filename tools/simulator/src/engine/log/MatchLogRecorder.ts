import {
  CanonicalGameEvent,
  CanonicalMatchLog,
  CanonicalMatchLogMeta,
  CardLocation,
  CardZoneName,
} from "../../domain/log/CanonicalMatchLog";

export interface MatchLogRecorderOptions {
  readonly matchId: string;
  readonly rulesVersion?: string;
  readonly rulePackageRef?: string;
  readonly buildSha?: string;
  readonly buildRef?: string;
  readonly simulatorCommit?: string;
  readonly startedAt?: string;
}

/**
 * 既存の内部 cardMoved イベントを Canonical の CardLocation に正規化
 */
export function normalizeCardLocation(
  zoneOrLoc: any,
  playerKey?: string,
  requestId?: string
): CardLocation {
  if (typeof zoneOrLoc === "object" && zoneOrLoc !== null) {
    if (zoneOrLoc.kind === "zone" || zoneOrLoc.kind === "request") {
      return zoneOrLoc as CardLocation;
    }
  }

  const rawZoneStr = String(zoneOrLoc || "").toLowerCase();
  if (rawZoneStr === "request") {
    return {
      kind: "request",
      requestId: requestId || "unknown-request",
    };
  }

  const validZones: CardZoneName[] = ["hand", "field", "grave", "fog", "life", "deck"];
  const matchedZone: CardZoneName = validZones.includes(rawZoneStr as CardZoneName)
    ? (rawZoneStr as CardZoneName)
    : "grave";

  return {
    kind: "zone",
    playerId: playerKey || "unknown",
    zone: matchedZone,
  };
}

type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never;

export type CanonicalGameEventInput = DistributiveOmit<CanonicalGameEvent, "seq" | "timestamp"> & {
  readonly timestamp?: string;
};

/**
 * Match / Session 単位で Canonical Game Event を記録するレコーダー。
 * Global Singleton ではなく、各 GameSession に保持されます。
 */
export class MatchLogRecorder {
  private seq = 1;
  private events: CanonicalGameEvent[] = [];
  private meta: CanonicalMatchLogMeta;

  constructor(options: MatchLogRecorderOptions) {
    this.meta = {
      matchId: options.matchId,
      rulesVersion: options.rulesVersion || "9.1.2",
      rulePackageRef: options.rulePackageRef || "rules-vnext",
      buildSha: options.buildSha,
      buildRef: options.buildRef,
      simulatorCommit: options.simulatorCommit,
      startedAt: options.startedAt || new Date().toISOString(),
    };
  }

  get currentSeq(): number {
    return this.seq;
  }

  get matchId(): string {
    return this.meta.matchId;
  }

  /**
   * 新しい Canonical Game Event を記録します（seq 単調増加）。
   */
  record<T extends CanonicalGameEventInput>(eventData: T): T & { seq: number; timestamp: string } {
    const seq = this.seq++;
    const fullEvent = {
      seq,
      timestamp: eventData.timestamp || new Date().toISOString(),
      ...eventData,
    } as unknown as CanonicalGameEvent;

    this.events.push(fullEvent);
    return fullEvent as unknown as T & { seq: number; timestamp: string };
  }


  /**
   * 試合終了時のメタデータを記録
   */
  finishMatch(finishedAt?: string) {
    this.meta = {
      ...this.meta,
      finishedAt: finishedAt || new Date().toISOString(),
    };
  }

  /**
   * 現在の完全な CanonicalMatchLog を取得（JSON シリアライズ可能）
   */
  getMatchLog(): CanonicalMatchLog {
    return {
      schemaVersion: "0.1",
      meta: { ...this.meta },
      events: [...this.events],
    };
  }

  /**
   * 記録されているイベント一覧を取得
   */
  getEvents(): readonly CanonicalGameEvent[] {
    return this.events;
  }

  /**
   * イベントログをリセット（新 Match 用）
   */
  reset(options: MatchLogRecorderOptions) {
    this.seq = 1;
    this.events = [];
    this.meta = {
      matchId: options.matchId,
      rulesVersion: options.rulesVersion || "9.1.2",
      rulePackageRef: options.rulePackageRef || "rules-vnext",
      buildSha: options.buildSha,
      buildRef: options.buildRef,
      simulatorCommit: options.simulatorCommit,
      startedAt: options.startedAt || new Date().toISOString(),
    };
  }
}
