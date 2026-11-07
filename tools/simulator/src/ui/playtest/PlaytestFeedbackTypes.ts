import { PlaytestDecisionTranscriptEntryV1 } from "./PlaytestDecisionTranscript";
import { PlaytestDiagnosticBundleV1 } from "./PlaytestDiagnosticBundle";

/**
 * 人間の違和感フィードバック カテゴリ
 */
export type HumanFeedbackCategory =
  | "WHY_NO_ATTACK"
  | "WHY_NO_SUMMON"
  | "WHY_PASS"
  | "WHY_THROWING"
  | "OTHER_UNNATURAL";

export const HUMAN_FEEDBACK_CATEGORY_LABELS: Record<HumanFeedbackCategory, string> = {
  WHY_NO_ATTACK: "なぜ攻撃しなかった？",
  WHY_NO_SUMMON: "なぜ召喚しなかった？",
  WHY_PASS: "なぜPASSした？",
  WHY_THROWING: "なぜ投擲を選んだ？",
  OTHER_UNNATURAL: "その他の不自然な行動",
};

/**
 * 単一の違和感フィードバックエントリ (v1)
 */
export interface PlaytestHumanFeedbackEntryV1 {
  readonly feedbackId: string;
  readonly createdAt: string;
  readonly category: HumanFeedbackCategory;
  readonly categoryLabel: string;
  readonly note?: string;

  /** 対象の意思決定と状態の紐づけ情報 */
  readonly decisionId: string;
  readonly selectedPatternRef: number;
  readonly stateVersion: number;
  readonly matchSeed?: number;
  readonly aiGenomeId?: string;
  readonly aiDnaDigest?: string;

  /** コンテキスト情報 */
  readonly actor: "policy" | "autoPass";
  readonly playerId: "p1" | "p2";
}

/**
 * 外部共有用（非公開情報除去済み）フィードバックバンドル (v1)
 */
export interface PlaytestFeedbackShareBundleV1 {
  readonly kind: "blackpoker-playtest-feedback-share";
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly containsHiddenInformation: false;

  readonly build: {
    readonly sha: string;
    readonly ref: string;
  };

  readonly match: {
    readonly matchId?: string;
    readonly environmentId?: string;
    readonly environmentName?: string;
    readonly regulationId?: string;
    readonly formatId?: string;
    readonly frameId?: string;
    readonly seed?: number;
    readonly matchMode: "humanVsHuman" | "humanVsAi";
    readonly humanSeat?: "p1" | "p2";
    readonly policyId?: string;
    readonly policyMetadata?: {
      readonly genomeId?: string;
      readonly schemaVersion?: number;
      readonly fullDnaDigest?: string;
    };
    readonly status: string;
    readonly winner?: string;
    readonly finishReason?: string;
  };

  readonly feedbacks: readonly PlaytestHumanFeedbackEntryV1[];
  readonly sanitizedTranscript: readonly PlaytestDecisionTranscriptEntryV1[];
}

/**
 * フィードバックエントリ生成用 pure helper
 */
export function createHumanFeedbackEntry(params: {
  category: HumanFeedbackCategory;
  note?: string;
  transcriptEntry: PlaytestDecisionTranscriptEntryV1;
  matchSeed?: number;
  aiGenomeId?: string;
  aiDnaDigest?: string;
}): PlaytestHumanFeedbackEntryV1 {
  const { category, note, transcriptEntry, matchSeed, aiGenomeId, aiDnaDigest } = params;
  const feedbackId = `fb-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  return {
    feedbackId,
    createdAt: new Date().toISOString(),
    category,
    categoryLabel: HUMAN_FEEDBACK_CATEGORY_LABELS[category],
    note: note?.trim() || undefined,
    decisionId: transcriptEntry.decisionId,
    selectedPatternRef: transcriptEntry.response.selectedPatternRef,
    stateVersion: transcriptEntry.stateVersion,
    matchSeed,
    aiGenomeId,
    aiDnaDigest,
    actor: transcriptEntry.actor === "human" ? "policy" : transcriptEntry.actor,
    playerId: transcriptEntry.playerId,
  };
}

/**
 * Diagnostic Bundle から非公開情報を完全に除去し、共有用バンドルを生成する Pure Function
 */
export function exportSanitizedPlaytestFeedbackBundle(
  diagnosticBundle: PlaytestDiagnosticBundleV1,
  feedbacks: readonly PlaytestHumanFeedbackEntryV1[]
): PlaytestFeedbackShareBundleV1 {
  return {
    kind: "blackpoker-playtest-feedback-share",
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    containsHiddenInformation: false,

    build: {
      sha: diagnosticBundle.build.sha,
      ref: diagnosticBundle.build.ref,
    },

    match: {
      matchId: diagnosticBundle.match.matchId,
      environmentId: diagnosticBundle.match.environmentId,
      environmentName: diagnosticBundle.match.environmentName,
      regulationId: diagnosticBundle.match.regulationId,
      formatId: diagnosticBundle.match.formatId,
      frameId: diagnosticBundle.match.frameId,
      seed: diagnosticBundle.match.seed,
      matchMode: diagnosticBundle.match.matchMode,
      humanSeat: diagnosticBundle.match.humanSeat,
      policyId: diagnosticBundle.match.policyId,
      policyMetadata: diagnosticBundle.match.policyMetadata
        ? { ...diagnosticBundle.match.policyMetadata }
        : undefined,
      status: diagnosticBundle.match.status,
      winner: diagnosticBundle.match.winner,
      finishReason: diagnosticBundle.match.finishReason,
    },

    feedbacks: [...feedbacks],
    sanitizedTranscript: diagnosticBundle.decisionTranscript.map((t) => ({
      seq: t.seq,
      actor: t.actor,
      playerId: t.playerId,
      decisionId: t.decisionId,
      stateVersion: t.stateVersion,
      response: {
        decisionId: t.response.decisionId,
        stateVersion: t.response.stateVersion,
        selectedPatternRef: t.response.selectedPatternRef,
      },
      policy: t.policy ? { ...t.policy } : undefined,
    })),
  };
}
