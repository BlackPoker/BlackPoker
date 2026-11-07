/**
 * BlackPoker Work 4-2 — Million Match Worker Thread Message Types
 *
 * メインスレッドと Worker スレッド間の IPC メッセージ型定義。
 * 構造化複製可能なデータ型のみを使用し、関数や GameSession 等は Worker 内で独立生成する。
 */

import {
  MatchupPairingSpec,
  CompactMatchOutcomeRecord,
  ChampionAuthenticityRecord,
} from "./MillionMatchInfraTypes";
import type { SingleMatchExecutionResult } from "../../engine/simulation/MillionMatchCampaignEngine";
import type { DecisionDNA } from "../ai/DecisionDNATypes";

export interface SerializedChampionsBundle {
  readonly gen7DNA: DecisionDNA;
  readonly gen7Digest: string;
  readonly gen7Source: string;
  readonly gen5DNA: DecisionDNA;
  readonly gen5Digest: string;
  readonly gen5Source: string;
  readonly zeroDNA: DecisionDNA;
  readonly zeroDigest: string;
  readonly authenticityRecord?: ChampionAuthenticityRecord;
}

// メインスレッド -> Worker
export interface WorkerInitMessage {
  readonly type: "INIT";
  readonly workerId: number;
  readonly regulationId: string;
  readonly frameId: string;
  readonly rulesDir: string;
  readonly maxDecisionsPerMatch: number;
  readonly champions: SerializedChampionsBundle;
}

export interface WorkerRunPairMessage {
  readonly type: "RUN_PAIR";
  readonly taskId: string;
  readonly campaignId: string;
  readonly workId: string;
  readonly pairIndex: number;
  readonly matchSeed: number;
  readonly playerSeeds: {
    readonly p1: number;
    readonly p2: number;
  };
  readonly matchup: MatchupPairingSpec;
  readonly maxDecisionsPerMatch: number;
}

export interface WorkerTerminateMessage {
  readonly type: "TERMINATE";
}

export type MainToWorkerMessage =
  | WorkerInitMessage
  | WorkerRunPairMessage
  | WorkerTerminateMessage;

// Worker -> メインスレッド
export interface WorkerInitOkMessage {
  readonly type: "INIT_OK";
  readonly workerId: number;
  readonly gen7Digest: string;
  readonly gen5Digest: string;
  readonly zeroDigest: string;
}

export interface WorkerPairResultMessage {
  readonly type: "PAIR_RESULT";
  readonly taskId: string;
  readonly pairIndex: number;
  readonly workerId: number;
  readonly leg0Result: SingleMatchExecutionResult;
  readonly leg1Result: SingleMatchExecutionResult;
}

export interface WorkerErrorMessage {
  readonly type: "ERROR";
  readonly workerId: number;
  readonly taskId?: string;
  readonly pairIndex?: number;
  readonly message: string;
  readonly stack?: string;
}

export type WorkerToMainMessage =
  | WorkerInitOkMessage
  | WorkerPairResultMessage
  | WorkerErrorMessage;
