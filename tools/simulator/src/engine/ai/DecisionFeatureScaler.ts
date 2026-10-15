/**
 * DecisionFeatureScaler.ts
 *
 * BlackPoker Simulator - AI Feature Schema v5
 *
 * Decision Feature Scaling and Domain Enforcement.
 * Normalizes raw context and pattern features into bounded theoretical ranges
 * to eliminate mutation amplification in linear and bilinear DNA scoring.
 *
 * 【設計原則】
 * 1. Pure Functional & Deterministic:
 *    RNG、日付、外部状態、クロックに依存せず、同一入力配列に対して完全に決定論的かつ不変の出力を返します。
 * 2. Fail-Closed Numeric Safety:
 *    NaN、Infinity、未定義、型不一致、定義域違反は即座に例外 (DecisionFeatureScalingError) をスローします。
 *    サイレントクランプ（暗黙の丸め込み）やフォールバックゼロ変換は厳格に禁止します。
 * 3. O(1) Indexed Rule Lookup:
 *    ホットパスでのスケーリング規則取得は配列インデックスにより O(1) で行われ、
 *    文字列検索や動的正規表現を排除します。
 */

import {
  CONTEXT_SCALING_RULES,
  PATTERN_SCALING_RULES,
  FeatureScalingRule,
} from "../../domain/ai/DecisionFeatureScalingRegistry";
import {
  CONTEXT_FEATURE_DIMENSION,
  PATTERN_FEATURE_DIMENSION,
} from "../../domain/ai/DecisionFeatureTypes";

/**
 * Feature Scaling 実行時例外
 */
export class DecisionFeatureScalingError extends Error {
  public readonly domain?: string;
  public readonly featureIndex?: number;
  public readonly featureName?: string;
  public readonly rawValue?: number;
  public readonly reason: string;

  constructor(
    message: string,
    details?: {
      domain?: string;
      featureIndex?: number;
      featureName?: string;
      rawValue?: number;
      reason?: string;
    }
  ) {
    super(message);
    this.name = "DecisionFeatureScalingError";
    this.domain = details?.domain;
    this.featureIndex = details?.featureIndex;
    this.featureName = details?.featureName;
    this.rawValue = details?.rawValue;
    this.reason = details?.reason ?? message;
    Object.setPrototypeOf(this, DecisionFeatureScalingError.prototype);
  }
}

/**
 * 1. Identity Scaling: f(x) = x
 * 既に正規化されたバイナリフラグ、ハッシュバケット、ワンホット、[0, 1] 比率に適用
 */
export function identity(raw: number): number {
  return raw;
}

/**
 * 2. Linear Bound Division: f(x) = x / bound
 * 有界な既知の上限 (bound) を持つ離散特徴量 (例: トランプカードランク 0..13) に適用
 */
export function linearBoundDivision(raw: number, bound: number): number {
  if (typeof bound !== "number" || !Number.isFinite(bound) || bound <= 0) {
    throw new DecisionFeatureScalingError(`Invalid linearBoundDivision bound: ${bound}`);
  }
  return raw / bound;
}

/**
 * 3. Saturating Rational Function: f(x) = x / (x + scale)
 * 非負のカウント・合計値・サイズ特徴量を [0, 1) 区間へ凹関数的に滑らかに有界化
 */
export function saturatingRational(raw: number, scale: number): number {
  if (typeof scale !== "number" || !Number.isFinite(scale) || scale <= 0) {
    throw new DecisionFeatureScalingError(`Invalid saturatingRational scale: ${scale}`);
  }
  if (raw < 0) {
    throw new DecisionFeatureScalingError(
      `saturatingRational requires non-negative raw value, received: ${raw}`
    );
  }
  return raw / (raw + scale);
}

/**
 * 4. Signed Saturating Rational Function: f(x) = x / (|x| + scale)
 * 符号付き差分 (Signed Delta) 特徴量を (-1, 1) 区間へ符号・ゼロ対称性を維持して滑らかに有界化
 */
export function signedSaturatingRational(raw: number, scale: number): number {
  if (typeof scale !== "number" || !Number.isFinite(scale) || scale <= 0) {
    throw new DecisionFeatureScalingError(`Invalid signedSaturatingRational scale: ${scale}`);
  }
  return raw / (Math.abs(raw) + scale);
}

/**
 * 生値の入力定義域バリデーション
 */
function validateRawInput(val: number, rule: FeatureScalingRule, domain: string): void {
  if (typeof val !== "number" || !Number.isFinite(val)) {
    throw new DecisionFeatureScalingError(
      `Non-finite raw feature value at ${domain}[${rule.index}] (${rule.name}): ${val}`,
      {
        domain,
        featureIndex: rule.index,
        featureName: rule.name,
        rawValue: val,
        reason: "NON_FINITE_RAW_VALUE",
      }
    );
  }

  switch (rule.scalingClass) {
    case "BOOLEAN":
    case "ONE_HOT":
    case "HASH_BUCKET":
      if (val !== 0 && val !== 1) {
        throw new DecisionFeatureScalingError(
          `Invalid discrete binary value at ${domain}[${rule.index}] (${rule.name}): expected 0 or 1, got ${val}`,
          {
            domain,
            featureIndex: rule.index,
            featureName: rule.name,
            rawValue: val,
            reason: "INVALID_BINARY_VALUE",
          }
        );
      }
      break;

    case "RATIO_0_1":
      if (val < 0 || val > 1) {
        throw new DecisionFeatureScalingError(
          `Invalid ratio value at ${domain}[${rule.index}] (${rule.name}): expected in [0, 1], got ${val}`,
          {
            domain,
            featureIndex: rule.index,
            featureName: rule.name,
            rawValue: val,
            reason: "OUT_OF_BOUNDS_RATIO",
          }
        );
      }
      break;

    case "BOUNDED_CARD_VALUE":
      if (val < 0 || val > (rule.parameter.bound ?? 13)) {
        throw new DecisionFeatureScalingError(
          `Invalid bounded card value at ${domain}[${rule.index}] (${rule.name}): expected in [0, ${rule.parameter.bound ?? 13}], got ${val}`,
          {
            domain,
            featureIndex: rule.index,
            featureName: rule.name,
            rawValue: val,
            reason: "OUT_OF_BOUNDS_CARD_VALUE",
          }
        );
      }
      break;

    case "NONNEGATIVE_COUNT":
    case "AGGREGATE_SUM":
    case "SIZE":
      if (val < 0) {
        throw new DecisionFeatureScalingError(
          `Negative value for non-negative feature at ${domain}[${rule.index}] (${rule.name}): got ${val}`,
          {
            domain,
            featureIndex: rule.index,
            featureName: rule.name,
            rawValue: val,
            reason: "NEGATIVE_NONNEGATIVE_FEATURE",
          }
        );
      }
      break;

    case "SIGNED_DELTA":
      // 符号付き差分は任意の有限数を許容
      break;
  }
}

/**
 * 出力値の目標定義域バリデーション
 */
function validateScaledOutput(scaled: number, rule: FeatureScalingRule, domain: string): void {
  if (!Number.isFinite(scaled)) {
    throw new DecisionFeatureScalingError(
      `Non-finite scaled feature value at ${domain}[${rule.index}] (${rule.name}): ${scaled}`,
      {
        domain,
        featureIndex: rule.index,
        featureName: rule.name,
        rawValue: scaled,
        reason: "NON_FINITE_SCALED_VALUE",
      }
    );
  }

  switch (rule.outputDomain) {
    case "[0, 1]":
      if (scaled < 0 || scaled > 1) {
        throw new DecisionFeatureScalingError(
          `Scaled value out of [0, 1] at ${domain}[${rule.index}] (${rule.name}): got ${scaled}`,
          {
            domain,
            featureIndex: rule.index,
            featureName: rule.name,
            rawValue: scaled,
            reason: "OUT_OF_OUTPUT_DOMAIN",
          }
        );
      }
      break;

    case "[0, 1)":
      if (scaled < 0 || scaled >= 1) {
        throw new DecisionFeatureScalingError(
          `Scaled value out of [0, 1) at ${domain}[${rule.index}] (${rule.name}): got ${scaled}`,
          {
            domain,
            featureIndex: rule.index,
            featureName: rule.name,
            rawValue: scaled,
            reason: "OUT_OF_OUTPUT_DOMAIN",
          }
        );
      }
      break;

    case "(-1, 1)":
      if (scaled <= -1 || scaled >= 1) {
        throw new DecisionFeatureScalingError(
          `Scaled value out of (-1, 1) at ${domain}[${rule.index}] (${rule.name}): got ${scaled}`,
          {
            domain,
            featureIndex: rule.index,
            featureName: rule.name,
            rawValue: scaled,
            reason: "OUT_OF_OUTPUT_DOMAIN",
          }
        );
      }
      break;
  }
}

/**
 * 単一特徴量に対するスケーリング適用
 */
function applyRule(val: number, rule: FeatureScalingRule, domain: string): number {
  validateRawInput(val, rule, domain);

  let scaled: number;
  switch (rule.scalingFunction) {
    case "identity":
      scaled = identity(val);
      break;
    case "linear_bound_division":
      scaled = linearBoundDivision(val, rule.parameter.bound!);
      break;
    case "saturating_rational":
      scaled = saturatingRational(val, rule.parameter.scale!);
      break;
    case "signed_saturating_rational":
      scaled = signedSaturatingRational(val, rule.parameter.scale!);
      break;
  }

  validateScaledOutput(scaled, rule, domain);
  return scaled;
}

/**
 * DecisionFeatureScaler
 * Context (163) および Pattern (143) ベクトルのスケーリングエンジン
 */
export class DecisionFeatureScaler {
  /**
   * 生の Context 特徴量配列 (163次元) をスケーリング
   */
  public static scaleContext(rawValues: readonly number[]): number[] {
    if (rawValues.length !== CONTEXT_FEATURE_DIMENSION) {
      throw new DecisionFeatureScalingError(
        `Context dimension mismatch: expected ${CONTEXT_FEATURE_DIMENSION}, got ${rawValues.length}`,
        {
          domain: "CONTEXT",
          reason: "DIMENSION_MISMATCH",
        }
      );
    }

    const len = CONTEXT_FEATURE_DIMENSION;
    const scaled = new Array<number>(len);
    for (let i = 0; i < len; i++) {
      scaled[i] = applyRule(rawValues[i], CONTEXT_SCALING_RULES[i], "CONTEXT");
    }
    return scaled;
  }

  /**
   * 生の Pattern 特徴量配列 (143次元) をスケーリング
   */
  public static scalePattern(rawValues: readonly number[]): number[] {
    if (rawValues.length !== PATTERN_FEATURE_DIMENSION) {
      throw new DecisionFeatureScalingError(
        `Pattern dimension mismatch: expected ${PATTERN_FEATURE_DIMENSION}, got ${rawValues.length}`,
        {
          domain: "PATTERN",
          reason: "DIMENSION_MISMATCH",
        }
      );
    }

    const len = PATTERN_FEATURE_DIMENSION;
    const scaled = new Array<number>(len);
    for (let i = 0; i < len; i++) {
      scaled[i] = applyRule(rawValues[i], PATTERN_SCALING_RULES[i], "PATTERN");
    }
    return scaled;
  }
}
