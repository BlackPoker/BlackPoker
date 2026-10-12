/**
 * Population & Selection Types (BP-SIM-AI-POPULATION-SELECTION-DESIGN-V1-R1 / BP-SIM-AI-POPULATION-SELECTION-V1)
 *
 * BlackPoker Simulator AI基盤における Population (母集団) および Tournament Selection (親個体選択) 型定義。
 * 設計仕様書: tools/simulator/docs/ai-population-selection-design-v1.md
 *
 * 最重要設計原則:
 * 1. "Victory is the objective. Life is a resource, not a score."
 * 2. DNA と Fitness の厳格な分離 (DNA オブジェクトへ適応度スコアを書き込まない)
 * 3. Standard Selection Pool は VALID 個体のみ (全敗 0.0 も正当候補、INSUFFICIENT / INVALID は完全除外)
 * 4. Tier 2 fallback 禁止 (VALID 不足時は REEVALUATION_REQUIRED)
 * 5. 1 トーナメント内非復元抽出 (without replacement)、トーナメント間再利用可能
 * 6. 決定論的 PRNG による完全再現性
 */

import { DecisionDNA } from "./DecisionDNATypes";
import {
  FitnessEvaluationConfig,
  FitnessEvaluationResult,
} from "./FitnessEvaluationTypes";

/**
 * 母集団内の単一ゲノムエントリ
 */
export interface PopulationEntry {
  /** 母集団内で一意の個体識別子 (非空文字列, 例: "gen001-ind042") */
  readonly genomeId: string;
  /** 安定した DNA アーティファクト参照 (ファイルパスまたはハッシュ) */
  readonly dnaRef: string;
  /** 当該個体が属する世代番号 (非負整数) */
  readonly generation: number;
  /** 決定論的 Argmax ポリシー用 DecisionDNA (不変ゲノム実体) */
  readonly dna: DecisionDNA;
}

/**
 * 世代 $g$ に存在する不変の母集団スナップショット
 */
export interface PopulationSnapshot {
  /** 世代番号 (非負整数) */
  readonly generation: number;
  /** 母集団に属する個体エントリ配列 (length >= 2) */
  readonly entries: readonly PopulationEntry[];
}

/**
 * 比較可能な評価コンテキスト (Comparable Evaluation Context)
 *
 * Selection レイヤが親選択を行う前に、全個体の Fitness が同一条件下で算出されたかを保証する契約
 */
export interface ComparableEvaluationContext {
  /** ルールセット識別子 (例: "rules-vnext:playtest") */
  readonly environmentRef: string;
  /** フォーマット識別子 (例: "light") */
  readonly regulationId: string;
  /** フレーム識別子 (例: "entry16") */
  readonly frameId: string;
  /** ルールパッケージ版数 (例: "9.1.2") */
  readonly rulePackageVersion: string;
  /** Fitness 評価設定パラメータ */
  readonly fitnessConfig: FitnessEvaluationConfig;
  /** 対象世代番号 */
  readonly generation: number;
  /** 対戦スケジュールID (対戦相手サンプリング方式) */
  readonly evaluationScheduleId: string;
  /** シード系列識別子 */
  readonly seedScheduleIdentity: string;
}

/**
 * 母集団個体ごとの適応度評価エントリ
 */
export interface PopulationFitnessEntry {
  /** 母集団エントリと 1:1 対応する個体識別子 */
  readonly genomeId: string;
  /** Authoritative 判定を含む FitnessEvaluationResult */
  readonly result: FitnessEvaluationResult;
  /** 個別評価コンテキスト (省略時は FitnessEvaluationSnapshot.context を継承) */
  readonly context?: ComparableEvaluationContext;
}

/**
 * 世代 $g$ の適応度評価スナップショット
 */
export interface FitnessEvaluationSnapshot {
  /** 世代番号 (非負整数) */
  readonly generation: number;
  /** スナップショット共通の比較可能評価コンテキスト */
  readonly context: ComparableEvaluationContext;
  /** 個体別評価結果エントリ配列 */
  readonly entries: readonly PopulationFitnessEntry[];
}

/**
 * Selection Readiness 判定ステータス (4値)
 */
export type SelectionReadinessStatus =
  | "READY"                     // VALID 個体数が閾値を満たし、選択実行可能
  | "REEVALUATION_REQUIRED"      // VALID 個体数が不足しており、対戦再評価が必要
  | "INVALID_POPULATION"        // 母集団スナップショット自体に構造的不備あり (Fail-Fast)
  | "INCOMPARABLE_EVALUATION";  // 異なる評価コンテキストが混在している (Fail-Fast)

/**
 * Selection Readiness 評価結果
 */
export interface SelectionReadiness {
  readonly status: SelectionReadinessStatus;
  readonly validCount: number;
  readonly requiredCount: number;
  readonly reason?: string;
}

/**
 * 親選択設定パラメータ
 */
export interface PopulationSelectionConfig {
  /** 最低有効母集団数 (有性交叉に必要な最低個体数, 有限整数 >= 2) */
  readonly minimumValidPopulationCount: number;
  /** トーナメントサイズ k (有限整数 >= 2) */
  readonly tournamentSize: number;
  /** エリート保存個体数 E (有限整数 >= 0) */
  readonly eliteCount: number;
}

/**
 * 親選択設定の初期仮値 (Provisional Engineering Defaults)
 */
export const DEFAULT_POPULATION_SELECTION_CONFIG: PopulationSelectionConfig = Object.freeze({
  minimumValidPopulationCount: 2,
  tournamentSize: 3,
  eliteCount: 1,
});

/**
 * 選出された親個体情報
 */
export interface SelectedParent {
  readonly genomeId: string;
  readonly dnaRef: string;
  readonly generation: number;
  readonly dna: DecisionDNA;
  readonly fitnessScore: number;
  /** 監査用: 当該トーナメントに参加した候補 genomeId 配列 */
  readonly tournamentCandidates?: readonly string[];
}

/**
 * 母集団・適応度スナップショットのデータ整合性エラー (Fail-Fast)
 */
export class PopulationSelectionIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PopulationSelectionIntegrityError";
  }
}

/**
 * 親選択設定値の不備を示すエラー (Fail-Fast)
 */
export class PopulationSelectionConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PopulationSelectionConfigurationError";
  }
}

/**
 * Selection 実行不可状態 (REEVALUATION_REQUIRED / INCOMPARABLE) での呼出エラー (Fail-Fast)
 */
export class PopulationSelectionExecutionError extends Error {
  constructor(
    message: string,
    public readonly readinessStatus: SelectionReadinessStatus
  ) {
    super(message);
    this.name = "PopulationSelectionExecutionError";
  }
}

/**
 * 2つの ComparableEvaluationContext が意味的に完全一致するか検証するヘルパー
 */
export function isComparableEvaluationContextEqual(
  a: ComparableEvaluationContext,
  b: ComparableEvaluationContext
): boolean {
  if (!a || !b) return false;
  return (
    a.environmentRef === b.environmentRef &&
    a.regulationId === b.regulationId &&
    a.frameId === b.frameId &&
    a.rulePackageVersion === b.rulePackageVersion &&
    a.generation === b.generation &&
    a.evaluationScheduleId === b.evaluationScheduleId &&
    a.seedScheduleIdentity === b.seedScheduleIdentity &&
    a.fitnessConfig.minimumCompletedMatches === b.fitnessConfig.minimumCompletedMatches &&
    a.fitnessConfig.minimumCompletionRate === b.fitnessConfig.minimumCompletionRate
  );
}
