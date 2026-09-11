import { CanonicalMatchLog } from "../../domain/log/CanonicalMatchLog";
import { ActiveMatchContext, SetupNotice } from "../../engine/playtest/PlaytestEnvironmentController";
import {
  PlaytestMatchMode,
  PlaytestPolicyId,
  PlaytestSeatControllers,
} from "../../engine/playtest/PlaytestSeatController";
import { GameSessionStep } from "../../engine/session/GameSession";
import type { PlaytestDecisionTranscriptEntryV1 } from "./PlaytestDecisionTranscript";

export type { PlaytestDecisionTranscriptEntryV1 };

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
  readonly build: {
    readonly sha: string;
    readonly ref: string;
  };
  readonly generatedAt: string;
  readonly activeMatch?: ActiveMatchContext | null;
  readonly activePlaytestSettings?: ActivePlaytestSettings | null;
  readonly seatControllers?: PlaytestSeatControllers | null;
  readonly currentStep?: GameSessionStep | null;
  readonly rawState?: any;
  readonly normalLogs?: readonly unknown[];
  readonly traces?: readonly unknown[];
  readonly canonicalMatchLog?: CanonicalMatchLog | null;
  readonly decisionTranscript?: readonly PlaytestDecisionTranscriptEntryV1[];
  readonly setupNotice?: SetupNotice | null;
  readonly runtimeNotice?: SetupNotice | null;
}

/**
 * UI コンポーネントの状態（CoreBattlePlaytest 等）から
 * Diagnostic Bundle 構築パラメータ（BuildPlaytestDiagnosticBundleParams）を
 * 漏れなく組み立てる Pure Adapter Helper の入力インターフェース。
 */
export interface AssemblePlaytestDiagnosticBundleParamsInput {
  readonly build: {
    readonly sha: string;
    readonly ref: string;
  };
  readonly generatedAt: string;
  readonly activeMatch?: ActiveMatchContext | null;
  readonly activePlaytestSettings?: ActivePlaytestSettings | null;
  readonly activeSeatControllers?: PlaytestSeatControllers | null;
  readonly rawState?: any;
  readonly logs?: readonly unknown[];
  readonly traces?: readonly unknown[];
  readonly canonicalMatchLog?: CanonicalMatchLog | null;
  readonly currentStep?: GameSessionStep | null;
  readonly decisionTranscript?: readonly PlaytestDecisionTranscriptEntryV1[];
  readonly setupNotice?: SetupNotice | null;
  readonly runtimeNotice?: SetupNotice | null;
}

/**
 * UI コンポーネントの状態（CoreBattlePlaytest 等）から
 * Diagnostic Bundle 構築パラメータ（BuildPlaytestDiagnosticBundleParams）を
 * 漏れなく組み立てる Pure Adapter Helper。
 * activeSeatControllers -> seatControllers、logs -> normalLogs などの命名・構造差異を
 * 安全にマッピングし、接続漏れを防止します。
 */
export function assemblePlaytestDiagnosticBundleParams(
  inputs: AssemblePlaytestDiagnosticBundleParamsInput
): BuildPlaytestDiagnosticBundleParams {
  return {
    build: inputs.build,
    generatedAt: inputs.generatedAt,
    activeMatch: inputs.activeMatch,
    activePlaytestSettings: inputs.activePlaytestSettings,
    seatControllers: inputs.activeSeatControllers,
    rawState: inputs.rawState,
    normalLogs: inputs.logs,
    traces: inputs.traces,
    canonicalMatchLog: inputs.canonicalMatchLog,
    currentStep: inputs.currentStep,
    decisionTranscript: inputs.decisionTranscript,
    setupNotice: inputs.setupNotice,
    runtimeNotice: inputs.runtimeNotice,
  };
}

/**
 * GameSession の生状態から Diagnostic 用の rawState スナップショットを安全にディープコピー抽出する Pure Helper。
 * UI 表示用スナップショット (gameState) ではなく session.state のみを引数に取り、
 * 循環参照や非シリアライズ可能オブジェクトを排除した不変オブジェクトを返します。
 */
export function captureDiagnosticRawState(sessionState: unknown): any {
  if (sessionState === null || sessionState === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(sessionState));
}

/**
 * Diagnostic Bundle v1 を構築する Pure Function。
 * ブラウザ DOM や React State、環境変数、日付等の外部状態に一切依存せず、
 * 渡された引数のみから不変オブジェクトを決定論的に生成します。
 */
export function buildPlaytestDiagnosticBundleV1(
  params: BuildPlaytestDiagnosticBundleParams
): PlaytestDiagnosticBundleV1 {
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

  return {
    kind: "blackpoker-playtest-diagnostic",
    schemaVersion: 1,
    generatedAt: params.generatedAt,
    containsHiddenInformation: true,

    build: {
      sha: params.build.sha,
      ref: params.build.ref,
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

      matchMode: params.activePlaytestSettings?.matchMode,
      humanSeat: params.activePlaytestSettings?.humanSeat,
      policyId: params.activePlaytestSettings?.policyId,

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
    traces: params.traces ? [...params.traces] : [],

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
