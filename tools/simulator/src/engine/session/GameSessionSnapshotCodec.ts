import {
  GameSessionSnapshot,
  SNAPSHOT_FORMAT_VERSION,
} from "../../domain/session/GameSessionSnapshot";
import { GameSession } from "./GameSession";
import { RulePackage } from "../../domain/rules/RulePackage";
import { StateHasher } from "../simulation/StateHasher";
import { PassTracker } from "./PassTracker";
import { MatchLogRecorder } from "../log/MatchLogRecorder";
import { CommandRegistry } from "../rules/CommandRegistry";

export class GameSessionSnapshotValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GameSessionSnapshotValidationError";
  }
}

/**
 * GameSession の JSON-safe Snapshot 生成・検証・復元を行うコーデック。
 */
export class GameSessionSnapshotCodec {
  /**
   * 実行中の GameSession から JSON-safe な Snapshot DTO を生成
   */
  static capture(session: GameSession): GameSessionSnapshot {
    const rawStateCopy = JSON.parse(JSON.stringify(session.state));
    const stateHash = StateHasher.hash(rawStateCopy);

    const snapshot: GameSessionSnapshot = {
      snapshotFormatVersion: SNAPSHOT_FORMAT_VERSION,
      metadata: {
        matchId: session.matchId,
        rulePackageRef: session.rulePackage.id,
        rulesVersion: session.rulePackage.version,
        createdAt: Date.now(),
      },
      gameState: rawStateCopy,
      gameStateHash: stateHash,
      session: session.exportSnapshotSessionData(),
      matchLog: session.getMatchLog ? JSON.parse(JSON.stringify(session.getMatchLog())) : undefined,
    };

    return snapshot;
  }

  /**
   * Snapshot DTO を JSON 文字列にシリアライズ
   */
  static serialize(snapshot: GameSessionSnapshot): string {
    this.validate(snapshot);
    return JSON.stringify(snapshot, null, 2);
  }

  /**
   * JSON 文字列から Snapshot DTO をデシリアライズ
   */
  static deserialize(json: string): GameSessionSnapshot {
    if (!json || typeof json !== "string") {
      throw new GameSessionSnapshotValidationError("Invalid JSON input: input must be a non-empty string.");
    }

    let parsed: any;
    try {
      parsed = JSON.parse(json);
    } catch (e: any) {
      throw new GameSessionSnapshotValidationError(`JSON parse error: ${e.message}`);
    }

    this.validate(parsed);
    return parsed as GameSessionSnapshot;
  }

  /**
   * Snapshot DTO の正当性（バージョン、必須フィールド、State Hash 整合性）を検証
   */
  static validate(snapshot: any): void {
    if (!snapshot || typeof snapshot !== "object") {
      throw new GameSessionSnapshotValidationError("Snapshot validation failed: Snapshot must be an object.");
    }

    if (snapshot.snapshotFormatVersion !== SNAPSHOT_FORMAT_VERSION) {
      throw new GameSessionSnapshotValidationError(
        `Unsupported snapshot format version: expected ${SNAPSHOT_FORMAT_VERSION}, but got ${snapshot.snapshotFormatVersion}.`
      );
    }

    if (!snapshot.metadata || typeof snapshot.metadata !== "object") {
      throw new GameSessionSnapshotValidationError("Snapshot validation failed: missing metadata object.");
    }

    if (!snapshot.metadata.matchId || typeof snapshot.metadata.matchId !== "string") {
      throw new GameSessionSnapshotValidationError("Snapshot validation failed: missing metadata.matchId.");
    }

    if (!snapshot.metadata.rulePackageRef || typeof snapshot.metadata.rulePackageRef !== "string") {
      throw new GameSessionSnapshotValidationError("Snapshot validation failed: missing metadata.rulePackageRef.");
    }

    if (!snapshot.metadata.rulesVersion || typeof snapshot.metadata.rulesVersion !== "string") {
      throw new GameSessionSnapshotValidationError("Snapshot validation failed: missing metadata.rulesVersion.");
    }

    if (!snapshot.gameState || typeof snapshot.gameState !== "object") {
      throw new GameSessionSnapshotValidationError("Snapshot validation failed: missing gameState object.");
    }

    if (!snapshot.gameStateHash || typeof snapshot.gameStateHash !== "string") {
      throw new GameSessionSnapshotValidationError("Snapshot validation failed: missing gameStateHash string.");
    }

    if (!snapshot.session || typeof snapshot.session !== "object") {
      throw new GameSessionSnapshotValidationError("Snapshot validation failed: missing session data object.");
    }

    if (typeof snapshot.session.consecutivePassCount !== "number") {
      throw new GameSessionSnapshotValidationError("Snapshot validation failed: missing session.consecutivePassCount.");
    }

    // State Hash の改ざん・不整合検証
    const computedHash = StateHasher.hash(snapshot.gameState);
    if (computedHash !== snapshot.gameStateHash) {
      throw new GameSessionSnapshotValidationError(
        `State Hash mismatch: recorded '${snapshot.gameStateHash}', but computed '${computedHash}'. Snapshot data may be corrupted or tampered.`
      );
    }
  }

  /**
   * Snapshot DTO と RulePackage から新しい GameSession を安全に復元 (Resume)
   */
  static restore(snapshot: GameSessionSnapshot, rulePackage: RulePackage): GameSession {
    this.validate(snapshot);

    if (!rulePackage || typeof rulePackage !== "object") {
      throw new GameSessionSnapshotValidationError("Restore failed: valid rulePackage must be provided.");
    }

    // RulePackage ID 照合
    if (rulePackage.id !== snapshot.metadata.rulePackageRef) {
      throw new GameSessionSnapshotValidationError(
        `Rule package ID mismatch: expected '${snapshot.metadata.rulePackageRef}', but got '${rulePackage.id}'.`
      );
    }

    // RulePackage Version 照合
    if (rulePackage.version !== snapshot.metadata.rulesVersion) {
      throw new GameSessionSnapshotValidationError(
        `Rule package version mismatch: expected '${snapshot.metadata.rulesVersion}', but got '${rulePackage.version}'.`
      );
    }

    const stateClone = JSON.parse(JSON.stringify(snapshot.gameState));
    const passTracker = new PassTracker(snapshot.session.consecutivePassCount);
    const registry = new CommandRegistry();

    const logRecorder = new MatchLogRecorder({
      matchId: snapshot.metadata.matchId,
      rulesVersion: snapshot.metadata.rulesVersion,
      rulePackageRef: snapshot.metadata.rulePackageRef,
      initialLog: snapshot.matchLog ? JSON.parse(JSON.stringify(snapshot.matchLog)) : undefined,
    });

    const session = new GameSession(stateClone, rulePackage, {
      matchId: snapshot.metadata.matchId,
      passTracker,
      registry,
      logRecorder,
    });

    // GameSession のカプセル化 API 経由で内部状態を復元
    session.importSnapshotSessionData(snapshot.session);

    return session;
  }
}
