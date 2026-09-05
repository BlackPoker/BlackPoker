import {
  BatchFailureRecord,
  BatchMatchContext,
  BatchMatchResult,
  BatchSimulationOptions,
  BatchSimulationRuntimeMetrics,
  BatchSimulationSummary,
} from "../simulation/BatchSimulationTypes";
import { DecisionPolicy } from "../../engine/simulation/DecisionPolicy";
import { LegalPatternKind } from "../decision/LegalPattern";

/**
 * Policy Experiment Result のフォーマットバージョン
 */
export const POLICY_EXPERIMENT_RESULT_VERSION = 1;

/**
 * 実験設定の不備を示すエラー型 (開始前 fail-fast)
 */
export class PolicyExperimentConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyExperimentConfigurationError";
  }
}

/**
 * 実験参加ポリシーの定義 (Generic Participant)
 * ※ FirstLegal, Random, Genome 等の具体的な種別への直接依存を持たない汎用設計
 */
export interface PolicyExperimentParticipant {
  /** 参加ポリシーの一意かつ安定した識別子 (非空) */
  readonly id: string;
  /** 人間可読な表示名 */
  readonly name: string;
  /** DNA や設定ファイルへの安定参照識別子 (任意) */
  readonly artifactRef?: string;
  /**
   * 各試合・各座席ごとに独立した fresh な DecisionPolicy を生成するファクトリ
   */
  readonly policyFactory: (context: BatchMatchContext, seat: "p1" | "p2") => DecisionPolicy;
}

/**
 * 実験結果に保存される Participant 参照情報
 * ※ 関数（policyFactory）や巨大な重み配列（1482 weights）は含めず、純粋な JSON メタデータのみを保持
 */
export interface PolicyExperimentParticipantRef {
  readonly id: string;
  readonly name: string;
  readonly artifactRef?: string;
}

/**
 * 実験実行オプション
 */
export interface PolicyExperimentOptions {
  /** 実験の一意識別子 (非空) */
  readonly experimentId: string;
  /** 実験環境・ルールセットの識別参照 (非空) */
  readonly environmentRef: string;
  /** 実験全体の基本乱数シード (有限数値) */
  readonly baseSeed: number;
  /** 座席ごとの試合数 (1以上の有限整数。全体の総予定試合数は matchesPerSeat * 2) */
  readonly matchesPerSeat: number;
  /** 1試合あたりの最大意思決定回数 (デフォルト: 500, 指定時は1以上の有限整数) */
  readonly maxDecisionsPerMatch?: number;
  /** 参加ポリシー A */
  readonly participantA: PolicyExperimentParticipant;
  /** 参加ポリシー B */
  readonly participantB: PolicyExperimentParticipant;
  /** 各試合の独立した fresh な GameSession を生成するファクトリ関数 */
  readonly sessionFactory: BatchSimulationOptions["sessionFactory"];
  /** 試合完了ごとの進捗コールバック (任意) */
  readonly onMatchCompleted?: (progress: {
    legId: string;
    completedMatches: number;
    totalMatches: number;
  }) => void;
}

/**
 * 論理実験結果に保持される決定論的 Failure 表現 (Logical Failure)
 * ※ errorMessage（実行時固有の decisionId 等が含まれる可能性がある）および errorStack を完全に排除
 */
export interface PolicyExperimentLogicalFailure {
  readonly matchIndex: number;
  readonly matchId: string;
  readonly baseSeed: number;
  readonly matchSeed: number;
  readonly playerSeeds: Record<string, number>;
  readonly phase: "SESSION_FACTORY" | "POLICY_FACTORY" | "RUNNER" | "UNKNOWN";
  readonly errorName: string;
}

/**
 * 診断・デバッグ用の非決定論的 Failure 表現 (Diagnostic Failure)
 * ※ RuntimeMetrics 側に分離され、Logical Result の決定論的比較からは除外されます
 */
export interface PolicyExperimentDiagnosticFailure {
  readonly matchIndex: number;
  readonly matchId: string;
  readonly phase: "SESSION_FACTORY" | "POLICY_FACTORY" | "RUNNER" | "UNKNOWN";
  readonly errorName: string;
  readonly errorMessage: string;
  readonly errorStack?: string;
}

/**
 * 単一 Leg (座席固定での複数試合バッチ) の論理結果
 */
export interface PolicyExperimentLegResult {
  readonly legId: string;
  readonly seatAssignments: {
    readonly p1: string;
    readonly p2: string;
  };
  readonly baseSeed: number;
  readonly matchesPerSeat: number;
  readonly matches: readonly BatchMatchResult[];
  readonly failures: readonly PolicyExperimentLogicalFailure[];
  readonly summary: BatchSimulationSummary;
}

/**
 * 座席別 (asP1 / asP2) の詳細戦績サマリー
 */
export interface PolicyParticipantSeatSummary {
  readonly scheduledMatches: number;
  readonly completedMatches: number;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
  readonly incompleteMatches: number;
  readonly failedMatches: number;
  readonly winRateOnCompleted: number;
}

/**
 * 各参加ポリシーの総合戦績サマリー (Outcome Summary)
 */
export interface PolicyParticipantOutcomeSummary {
  readonly participantId: string;
  readonly scheduledMatches: number;
  readonly completedMatches: number;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
  readonly incompleteMatches: number;
  readonly failedMatches: number;
  readonly winRateOnCompleted: number;
  readonly asP1: PolicyParticipantSeatSummary;
  readonly asP2: PolicyParticipantSeatSummary;
}

/**
 * 実験全体の統合結果サマリー
 */
export interface PolicyExperimentSummary {
  readonly totalScheduledMatches: number;
  readonly totalCompletedMatches: number;
  readonly totalIncompleteMatches: number;
  readonly totalFailedMatches: number;
  readonly participants: Record<string, PolicyParticipantOutcomeSummary>;
}

/**
 * 汎用意思決定行動サマリー (Generic Behavior Summary)
 * ※ Action 固有の名称や Component ID は集計せず、Pattern Kind / Source Type のみを集計
 * ※ 母集団は COMPLETED, INCOMPLETE, FAILED にかかわらず、観測された全正常 Decision
 */
export interface PolicyBehaviorSummary {
  readonly participantId: string;
  readonly totalObservedDecisions: number;
  readonly actionSelections: number;
  readonly passSelections: number;
  readonly effectSelections: number;
  readonly otherSelections: number;
  readonly actionRequestDecisions: number;
  readonly effectResolutionDecisions: number;
  readonly otherSourceDecisions: number;
  readonly actionSelectionRate: number;
  readonly passSelectionRate: number;
  readonly effectSelectionRate: number;
}

/**
 * 内部 Accumulator が記録する単一意思決定レコード
 */
export interface PolicyDecisionRecord {
  readonly participantId: string;
  readonly legId: string;
  readonly matchIndex: number;
  readonly seat: "p1" | "p2";
  readonly decisionSource: string;
  readonly selectedPatternKind: LegalPatternKind | "OTHER";
}

/**
 * 各 Leg の非決定論的実行時メトリクス
 */
export interface PolicyExperimentLegRuntimeMetrics {
  readonly legId: string;
  readonly batchRuntimeMetrics?: BatchSimulationRuntimeMetrics;
  readonly diagnosticFailures: readonly PolicyExperimentDiagnosticFailure[];
}

/**
 * 実験全体の非決定論的実行時メトリクス (診断・性能分析用)
 */
export interface PolicyExperimentRuntimeMetrics {
  readonly totalExecutionTimeMs: number;
  readonly legs: readonly PolicyExperimentLegRuntimeMetrics[];
}

/**
 * Policy Experiment の最終結果
 * ※ Logical Result 部分は完全な決定論的一致（同一設定で JSON.stringify が完全一致）を保証します
 */
export interface PolicyExperimentResult {
  readonly experimentResultVersion: number;
  readonly experimentId: string;
  readonly environmentRef: string;
  readonly baseSeed: number;
  readonly matchesPerSeat: number;
  readonly maxDecisionsPerMatch: number;
  readonly participants: {
    readonly a: PolicyExperimentParticipantRef;
    readonly b: PolicyExperimentParticipantRef;
  };
  readonly legs: readonly PolicyExperimentLegResult[];
  readonly summary: PolicyExperimentSummary;
  readonly behavior: Record<string, PolicyBehaviorSummary>;
  /** 非決定論的な実行時メトリクス・診断情報 */
  readonly runtimeMetrics?: PolicyExperimentRuntimeMetrics;
}
