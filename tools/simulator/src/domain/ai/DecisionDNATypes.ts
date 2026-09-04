import {
  CONTEXT_FEATURE_DIMENSION,
  PATTERN_FEATURE_DIMENSION,
  FEATURE_SCHEMA_VERSION,
} from "./DecisionFeatureTypes";

/**
 * Decision DNA Format Version (Version 1)
 */
export const DNA_FORMAT_VERSION = 1;

/**
 * Supported Scoring Model Identifier (Version 1)
 */
export const SCORING_MODEL_V1 = "linear-bilinear-v1" as const;
export type ScoringModel = typeof SCORING_MODEL_V1;

/**
 * Total dimensions and weight counts
 */
export const DNA_CONTEXT_DIMENSION = CONTEXT_FEATURE_DIMENSION;
export const DNA_PATTERN_DIMENSION = PATTERN_FEATURE_DIMENSION;
export const DNA_INTERACTION_DIMENSION = CONTEXT_FEATURE_DIMENSION * PATTERN_FEATURE_DIMENSION; // 25 * 57 = 1425
export const DNA_TOTAL_WEIGHTS = DNA_PATTERN_DIMENSION + DNA_INTERACTION_DIMENSION; // 57 + 1425 = 1482

/**
 * JSON-Safe Primitive Values
 */
export type JSONPrimitive = string | number | boolean | null;

/**
 * JSON-Safe Value Hierarchy (Artifact Contract)
 */
export type JSONValue =
  | JSONPrimitive
  | readonly JSONValue[]
  | { readonly [key: string]: JSONValue };

/**
 * Decision DNA Metadata (JSON-Safe Plain Object)
 *
 * 【JSON Artifact Contract】
 * - 全ての値は JSON-safe (string, finite number, boolean, null, array, nested plain object) でなければならない。
 * - NaN, Infinity, BigInt, function, Symbol, Date, Map, Set, class instance, 循環参照は禁止。
 * - undefined は optional property の「存在しない値」としてのみ型定義上許容。
 * - Scoring (GenomeScorer) には一切関与しない。
 */
export interface DecisionDNAMetadata {
  readonly id?: string;
  readonly name?: string;
  readonly description?: string;
  readonly generation?: number;
  readonly fitness?: number;
  readonly author?: string;
  readonly [key: string]: JSONValue | undefined;
}

/**
 * Decision DNA Format v1 (JSON-Safe DTO)
 *
 * 【設計原則: Context-only additive weights を持たない理由】
 * score = (contextWeights · context) + (patternWeights · pattern) + (context · M · pattern)
 * という形式において、第1項 (contextWeights · context) は同一の DecisionRequest 内の
 * 全 LegalPattern に対して同一の定数値となります。
 * したがって argmax (最高スコア手の選択) において完全に相殺され、判断へ一切影響を与えません。
 * パラメータの冗長性（Dead Weight）を排除するため、Context は第3項の Interaction (M_ij) を通じてのみ
 * Pattern スコアに影響を与えます。
 */
export interface DecisionDNA {
  /** DNA Format Version (必ず 1) */
  readonly dnaFormatVersion: number;
  /** 対応する Feature Schema Version (DecisionFeatureEncoder と一致必須, 現在 1) */
  readonly featureSchemaVersion: number;
  /** Scoring Model 識別子 ("linear-bilinear-v1") */
  readonly scoringModel: string;

  /** 期待される Context 次元数 (25) */
  readonly contextDimension: number;
  /** 期待される Pattern 次元数 (57) */
  readonly patternDimension: number;

  /** Pattern 線形重みベクトル (長さ: 57) */
  readonly patternWeights: readonly number[];

  /**
   * Context-Pattern 相互作用重み行列 (Row-major フラット配列, 長さ: 25 * 57 = 1425)
   * index = contextIndex * PATTERN_FEATURE_DIMENSION + patternIndex
   */
  readonly contextPatternWeights: readonly number[];

  /** 任意のメタデータ (名前、ID等。Scoringへの関与禁止) */
  readonly metadata?: DecisionDNAMetadata;
}

/**
 * Decision DNA の検証エラー型
 */
export class DecisionDNAValidationError extends Error {
  constructor(
    public readonly field: string,
    public readonly expected: unknown,
    public readonly actual: unknown,
    message?: string
  ) {
    super(
      message ??
        `DecisionDNA 検証エラー [field: ${field}]: 期待値=${JSON.stringify(expected)}, 実際=${JSON.stringify(actual)}`
    );
    this.name = "DecisionDNAValidationError";
    Object.setPrototypeOf(this, DecisionDNAValidationError.prototype);
  }
}

/**
 * Decision DNA の実行時スコアリングエラー型 (Overflow等)
 */
export class DecisionDNAExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecisionDNAExecutionError";
    Object.setPrototypeOf(this, DecisionDNAExecutionError.prototype);
  }
}
