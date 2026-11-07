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
 * 単一の違和感フィードバックエントリ (内部診断用 v1 - 非公開のシード値を含む)
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
  /** 詳細再現用シード（非公開診断データ内でのみ保持、公開共有時には除去） */
  readonly matchSeed?: number;
  readonly aiGenomeId?: string;
  readonly aiDnaDigest?: string;

  /** コンテキスト情報 */
  readonly actor: "policy" | "autoPass";
  readonly playerId: "p1" | "p2";
}

/**
 * 公開共有用フィードバックエントリ (v2 - 決定論的シード値を除去)
 */
export interface PlaytestPublicFeedbackEntryV2 {
  readonly feedbackId: string;
  readonly createdAt: string;
  readonly category: HumanFeedbackCategory;
  readonly categoryLabel: string;
  readonly note?: string;

  /** 対象の意思決定と状態の紐づけ情報 (Seed は推測防止のため除外) */
  readonly decisionId: string;
  readonly selectedPatternRef: number;
  readonly stateVersion: number;
  readonly aiGenomeId?: string;
  readonly aiDnaDigest?: string;

  /** コンテキスト情報 */
  readonly actor: "policy" | "autoPass";
  readonly playerId: "p1" | "p2";
}

/**
 * 外部公開共有用フィードバックバンドル (v2)
 *
 * 【セキュリティ & プライバシー設計方針】
 * 1. 決定論的シード値 (match.seed, feedback.matchSeed) は相手の手札・山札順を逆算可能にするため完全除去。
 * 2. 全意思決定履歴 (transcript) も非公開局面の推測を防ぐため完全除去。
 * 3. ユーザー自由入力コメント (note) の秘匿性は自動保証できないため、UIで確認を促す。
 * 4. 完全再現に必要な全情報は、非公開の「診断データ保存 (containsHiddenInformation: true)」側にのみ隔離。
 */
export interface PlaytestFeedbackShareBundleV2 {
  readonly kind: "blackpoker-playtest-feedback-share";
  readonly schemaVersion: 2;
  readonly generatedAt: string;
  readonly containsHiddenInformation: false;

  /** プライバシー・利用上の注意文 */
  readonly privacyNotice: string;

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

  readonly feedbacks: readonly PlaytestPublicFeedbackEntryV2[];
}

/**
 * 後方互換用 v1 バンドル定義
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
 * Diagnostic Bundle から秘密情報を再構成可能にするシード値や全履歴を完全に除去し、
 * 公開共有用バンドル (v2) を生成する Pure Function
 */
export function exportSanitizedPlaytestFeedbackBundle(
  diagnosticBundle: PlaytestDiagnosticBundleV1,
  feedbacks: readonly PlaytestHumanFeedbackEntryV1[]
): PlaytestFeedbackShareBundleV2 {
  // フィードバックエントリからシード値を除外して公開用エントリに変換
  const publicFeedbacks: PlaytestPublicFeedbackEntryV2[] = feedbacks.map((fb) => ({
    feedbackId: fb.feedbackId,
    createdAt: fb.createdAt,
    category: fb.category,
    categoryLabel: fb.categoryLabel,
    note: fb.note,
    decisionId: fb.decisionId,
    selectedPatternRef: fb.selectedPatternRef,
    stateVersion: fb.stateVersion,
    aiGenomeId: fb.aiGenomeId,
    aiDnaDigest: fb.aiDnaDigest,
    actor: fb.actor,
    playerId: fb.playerId,
  }));

  return {
    kind: "blackpoker-playtest-feedback-share",
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    containsHiddenInformation: false,
    privacyNotice:
      "本ファイルは、対戦の決定論的シード値（seed）、詳細な意思決定履歴（transcript）、相手プレイヤーの非公開手札・山札配列を除去した公開用サマリー形式です。ユーザー自由入力コメント（note）に含まれる情報の秘匿性はシステム側で自動保証できないため、外部共有前に内容をご確認ください。",

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

    feedbacks: publicFeedbacks,
  };
}
