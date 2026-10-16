/**
 * SemanticDiagnosticTypes.ts
 *
 * BlackPoker Simulator - AI Semantic Stall / Cycle Diagnostic V1
 *
 * 設計仕様: BP-SIM-AI-SEMANTIC-STALL-CYCLE-DESIGN-V1-R8
 * レジストリ: BP-SIM-AI-SEMANTIC-FINGERPRINT-FIELD-REGISTRY-V1-R8
 *
 * 【設計原則】
 * 1. Passive Observer: ゲームエンジンやポリシーの内部状態・乱数・勝敗に一切の副作用を与えない受動的診断。
 * 2. PRE_DECISION Boundary: 全フィンガープリントは WAITING_FOR_DECISION 到達直後、policy.choose 呼び出し前の単一時点で採取。
 * 3. Exact Floating Point: 特徴量数値の丸め（toFixed等）や量子化を行わず、完全な精度でシリアライズ。
 * 4. Conservative Terminology: 決定論的サイクルや無限ループの証明とは主張せず、候補（Candidate）として記録。
 */

import { PlayerKey } from "../decision/DecisionSource";

/**
 * 診断対象の5大フィンガープリントコンテナ
 */
export interface SemanticFingerprints {
  /** 構造的盤面フィンガープリント (Variant S1, Turn-Aware: プレフィックス "sgf1-") */
  readonly structural: string;
  /** 構造的盤面フィンガープリント (Variant S2, Turn-Invariant: プレフィックス "sgf1-ti-") */
  readonly structuralTurnInvariant: string;
  /** プレイヤー観測情報フィンガープリント (プレフィックス "pof1-") */
  readonly observation: string;
  /** 判断要求意味論フィンガープリント (プレフィックス "drsf1-") */
  readonly decisionRequest: string;
  /** ポリシー入力特徴量数値フィンガープリント (プレフィックス "gpif1-") */
  readonly policyInput: string;
}

/**
 * 診断検出シグナル種別 (テレメトリシグナル)
 */
export type SemanticDiagnosticSignal =
  | "NO_SIGNAL"
  | "REPEATED_STRUCTURAL_FINGERPRINT"
  | "REPEATED_DECISION_REQUEST"
  | "REPEATED_POLICY_INPUT"
  | "PERIODIC_FINGERPRINT_CANDIDATE"
  | "NO_SEMANTIC_CHANGE_WINDOW";

export const SEMANTIC_DIAGNOSTIC_SIGNALS: readonly SemanticDiagnosticSignal[] = [
  "NO_SIGNAL",
  "REPEATED_STRUCTURAL_FINGERPRINT",
  "REPEATED_DECISION_REQUEST",
  "REPEATED_POLICY_INPUT",
  "PERIODIC_FINGERPRINT_CANDIDATE",
  "NO_SEMANTIC_CHANGE_WINDOW",
] as const;

/**
 * 周期候補情報
 */
export interface CycleCandidateInfo {
  readonly period: number;
  readonly occurrences: number;
  readonly fingerprintType: "structural" | "structuralTurnInvariant" | "observation" | "decisionRequest" | "policyInput";
}

/**
 * 選択された意思決定のメタデータ（PRE_DECISION スナップショットに事後関連付け）
 */
export interface SelectedDecisionMetadata {
  readonly selectedPatternRef: number;
  readonly selectedPatternKind: string;
  readonly actionId: string | null;
  readonly selectedLogicalPatternKey: string;
}

/**
 * ステップごとの診断評価メタデータ
 */
export interface DiagnosticsMetadata {
  readonly structuralStallCount: number;
  readonly policyInputStallCount: number;
  readonly cycleCandidate: CycleCandidateInfo | null;
  readonly signal: SemanticDiagnosticSignal;
}

/**
 * 意思決定境界ごとの診断トレースレコード (Trace Schema V1)
 */
export interface DiagnosticTraceRecord {
  readonly stepIndex: number;
  readonly boundary: "PRE_DECISION";
  readonly turnCount: number;
  readonly activePlayer: PlayerKey;
  readonly decisionSource: string;
  readonly fingerprints: SemanticFingerprints;
  readonly selectedDecision: SelectedDecisionMetadata;
  readonly diagnostics: DiagnosticsMetadata;
}

/**
 * 診断検出器の設定オプション
 */
export interface SemanticDiagnosticOptions {
  /** 診断機能の有効化フラグ (デフォルト: false) */
  readonly enabled?: boolean;
  /** リングバッファの履歴保持サイズ (デフォルト: 64) */
  readonly historySize?: number;
  /** 連続一致とみなす閾値 (デフォルト: 3) */
  readonly consecutiveRepeatThreshold?: number;
  /** 周期検出に必要な最小反復回数 (デフォルト: 3) */
  readonly periodicMinOccurrences?: number;
  /** 意味的変化なしとみなす決定ウィンドウサイズ (デフォルト: 20) */
  readonly noSemanticChangeWindow?: number;
  /** トレースレコード生成時のコールバック (オプショナル) */
  readonly onTraceRecord?: (record: DiagnosticTraceRecord) => void;
}

/**
 * シミュレーション完了時に返却される診断集計結果
 */
export interface SemanticDiagnosticResult {
  readonly traces: readonly DiagnosticTraceRecord[];
  readonly finalSignals: readonly SemanticDiagnosticSignal[];
  readonly signalCounts: Record<SemanticDiagnosticSignal, number>;
}

/**
 * GenomePolicy スコアリング入力プロジェクション (Feature Schema v5)
 * ※ EncodedDecisionFeatures から抽出され、gpif1 算出に供される正規化構造
 */
export interface GenomePolicyScoringInputProjection {
  readonly featureSchemaVersion: 5;
  readonly contextValues: readonly number[]; // Exactly 163 IEEE 754 floats
  readonly patterns: readonly {
    readonly patternRef: number;
    readonly values: readonly number[]; // Exactly 143 IEEE 754 floats
  }[];
}

/**
 * GameSession 外に存在する意味論的サイドステート
 */
export interface GameSessionSideState {
  readonly consecutivePassCount: number;
  readonly continuation?: any;
  readonly resolvingRequest?: any;
  readonly resolvingContext?: any;
}
