import { CanonicalMatchLog } from "../../domain/log/CanonicalMatchLog";
import { DecisionResponse } from "../../domain/decision/DecisionResponse";
import { ActiveMatchContext, SetupNotice } from "../../engine/playtest/PlaytestEnvironmentController";
import {
  PlaytestMatchMode,
  PlaytestPolicyId,
  PlaytestSeatControllers,
} from "../../engine/playtest/PlaytestSeatController";
import { GameSessionStep } from "../../engine/session/GameSession";

/**
 * 意思決定トランスクリプトの1エントリ。
 * 単調増加 seq により、将来の Replay や調査での順序性を保証する。
 */
export interface PlaytestDecisionTranscriptEntryV1 {
  readonly seq: number;
  readonly actor: "human" | "policy" | "autoPass";
  readonly playerId: "p1" | "p2";
  readonly decisionId: string;
  readonly stateVersion: number;
  readonly response: DecisionResponse;
  readonly policy?: {
    readonly kind?: string;
    readonly name?: string;
    readonly policyVersion?: string;
  };
}

/**
 * 現在進行中の対戦のコミット済みアクティブ設定。
 * UI上のPending設定（次戦用）と厳格に分離する。
 */
export interface ActivePlaytestSettings {
  readonly matchMode: PlaytestMatchMode;
  readonly humanSeat?: "p1" | "p2";
  readonly policyId?: PlaytestPolicyId;
}

/**
 * Playtest Diagnostic Bundle v1 Schema
 */
export interface PlaytestDiagnosticBundleV1 {
  readonly kind: "blackpoker-playtest-diagnostic";
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly containsHiddenInformation: true;

  readonly build: {
    readonly sha: string;
    readonly ref: string;
  };

  readonly match: {
    readonly matchId?: string;
    readonly environmentId: string;
    readonly environmentName: string;

    readonly regulationId?: string;
    readonly formatId?: string;
    readonly frameId?: string;

    readonly rulePackageId?: string;
    readonly rulePackageVersion?: string;

    readonly seed?: number;

    readonly matchMode: "humanVsHuman" | "humanVsAi";
    readonly humanSeat?: "p1" | "p2";
    readonly policyId?: string;

    readonly seatControllers: unknown;

    readonly status:
      | "WAITING_FOR_DECISION"
      | "PROGRESSED"
      | "FINISHED"
      | "UNKNOWN";

    readonly winner?: string;
    readonly finishReason?: string;
  };

  readonly normalLogs: readonly unknown[];
  readonly traces: readonly unknown[];

  readonly canonicalMatchLog?: CanonicalMatchLog;

  readonly decisionTranscript: readonly PlaytestDecisionTranscriptEntryV1[];

  readonly snapshot: {
    readonly stateVersion?: number;
    readonly rawState: unknown;
    readonly currentDecisionRequest?: unknown;
    readonly finalResult?: unknown;
  };

  readonly notices?: {
    readonly setup?: unknown;
    readonly runtime?: unknown;
  };
}

export interface BuildPlaytestDiagnosticBundleParams {
  readonly build?: {
    readonly sha?: string;
    readonly ref?: string;
  };
  readonly activeMatch?: ActiveMatchContext | null;
  readonly activeSettings?: ActivePlaytestSettings | null;
  readonly activePlaytestSettings?: ActivePlaytestSettings | null;
  readonly seatControllers?: PlaytestSeatControllers | null;
  readonly currentStep?: GameSessionStep | null;
  readonly rawState?: any;
  readonly normalLogs?: readonly unknown[];
  readonly traces?: readonly unknown[];
  readonly uiTraces?: readonly unknown[];
  readonly canonicalMatchLog?: CanonicalMatchLog | null;
  readonly decisionTranscript?: readonly PlaytestDecisionTranscriptEntryV1[];
  readonly setupNotice?: SetupNotice | null;
  readonly runtimeNotice?: SetupNotice | null;
  readonly generatedAt?: string;
}

/**
 * Diagnostic Bundle v1 を構築する Pure Function。
 * ブラウザ DOM や React State に依存せず、引数のみから不変オブジェクトを生成します。
 */
export function buildPlaytestDiagnosticBundleV1(
  params: BuildPlaytestDiagnosticBundleParams
): PlaytestDiagnosticBundleV1 {
  const generatedAt = params.generatedAt || new Date().toISOString();

  // match status / result の解決
  let status: "WAITING_FOR_DECISION" | "PROGRESSED" | "FINISHED" | "UNKNOWN" = "UNKNOWN";
  let winner: string | undefined = undefined;
  let finishReason: string | undefined = undefined;

  if (params.currentStep?.type === "WAITING_FOR_DECISION") {
    status = "WAITING_FOR_DECISION";
  } else if (params.currentStep?.type === "PROGRESSED") {
    status = "PROGRESSED";
  } else if (params.currentStep?.type === "FINISHED") {
    status = "FINISHED";
    winner = params.currentStep.result.winner;
    finishReason = params.currentStep.result.reason;
  } else if (params.rawState?.status === "finished") {
    status = "FINISHED";
    winner = params.rawState?.winner;
    finishReason = params.rawState?.finishReason;
  }

  // formatId / frameId は rawState 等に明示的に存在する場合のみ取得し、文字列推測は禁止
  const formatId = typeof params.rawState?.formatId === "string" ? params.rawState.formatId : undefined;
  const frameId = typeof params.rawState?.frameId === "string" ? params.rawState.frameId : undefined;

  const matchId = params.rawState?.matchId || params.canonicalMatchLog?.meta?.matchId || undefined;
  const regulationId = params.activeMatch?.regulationId || params.rawState?.regulationId || undefined;

  const notices = (params.setupNotice || params.runtimeNotice)
    ? {
        ...(params.setupNotice ? { setup: params.setupNotice } : {}),
        ...(params.runtimeNotice ? { runtime: params.runtimeNotice } : {}),
      }
    : undefined;

  const stateVersion = params.rawState?.stateVersion ?? params.rawState?.version;
  const currentDecisionRequest = params.currentStep?.type === "WAITING_FOR_DECISION" ? params.currentStep.request : undefined;
  const finalResult = params.currentStep?.type === "FINISHED" ? params.currentStep.result : undefined;

  const activeSettings = params.activePlaytestSettings || params.activeSettings;
  const traces = params.traces || params.uiTraces || [];

  const buildSha =
    params.build?.sha ||
    (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_BUILD_SHA
      ? String((import.meta as any).env.VITE_BUILD_SHA)
      : "local");
  const buildRef =
    params.build?.ref ||
    (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_BUILD_REF
      ? String((import.meta as any).env.VITE_BUILD_REF)
      : "local");

  return {
    kind: "blackpoker-playtest-diagnostic",
    schemaVersion: 1,
    generatedAt,
    containsHiddenInformation: true,

    build: {
      sha: buildSha,
      ref: buildRef,
    },

    match: {
      matchId,
      environmentId: params.activeMatch?.environmentId || params.rawState?.environmentId,
      environmentName: params.activeMatch?.environmentName || params.rawState?.environmentName,

      regulationId,
      formatId,
      frameId,

      rulePackageId: params.activeMatch?.rulePackage?.id,
      rulePackageVersion: params.activeMatch?.rulePackage?.version,

      seed: params.activeMatch?.seed ?? params.rawState?.seed,

      matchMode: activeSettings?.matchMode,
      humanSeat: activeSettings?.humanSeat,
      policyId: activeSettings?.policyId,

      seatControllers: params.seatControllers
        ? {
            p1: params.seatControllers.p1,
            p2: params.seatControllers.p2,
          }
        : undefined,

      status,
      winner,
      finishReason,
    },

    normalLogs: params.normalLogs ? [...params.normalLogs] : [],
    traces: [...traces],

    canonicalMatchLog: params.canonicalMatchLog ? JSON.parse(JSON.stringify(params.canonicalMatchLog)) : undefined,

    decisionTranscript: params.decisionTranscript ? [...params.decisionTranscript] : [],

    snapshot: {
      stateVersion,
      rawState: params.rawState !== undefined ? JSON.parse(JSON.stringify(params.rawState)) : undefined,
      currentDecisionRequest: currentDecisionRequest !== undefined ? JSON.parse(JSON.stringify(currentDecisionRequest)) : undefined,
      finalResult: finalResult !== undefined ? JSON.parse(JSON.stringify(finalResult)) : undefined,
    },

    ...(notices ? { notices } : {}),
  };
}

/**
 * 診断ファイル用のセーフなファイル名を生成する。
 */
export function generateDiagnosticFilename(params: {
  matchId?: string;
  environmentName?: string;
  seed?: number;
  buildSha?: string;
  timestamp?: string;
  generatedAt?: string;
}): string {
  const ts = (params.generatedAt || params.timestamp || new Date().toISOString()).replace(/[:.]/g, "-");
  let idPart: string;
  if (params.matchId) {
    idPart = params.matchId.replace(/[^a-zA-Z0-9_-]/g, "_");
  } else if (params.seed !== undefined && !params.environmentName) {
    idPart = `seed${params.seed}`;
  } else if (params.environmentName) {
    idPart = `${params.environmentName.replace(/[^a-zA-Z0-9_-]/g, "_")}${params.seed !== undefined ? `-seed${params.seed}` : ""}`;
  } else if (params.seed !== undefined) {
    idPart = `seed${params.seed}`;
  } else {
    idPart = "match";
  }
  const shaPart = params.buildSha ? `-${params.buildSha.slice(0, 7)}` : "";
  return `blackpoker-diagnostic-v1-${idPart}${shaPart}-${ts}.json`;
}
