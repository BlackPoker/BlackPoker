import {
  DecisionDNA,
  DecisionDNAMetadata,
  DecisionDNAValidationError,
  DNA_FORMAT_VERSION,
  DNA_CONTEXT_DIMENSION,
  DNA_PATTERN_DIMENSION,
  DNA_INTERACTION_DIMENSION,
  SCORING_MODEL_V1,
} from "../../domain/ai/DecisionDNATypes";
import { FEATURE_SCHEMA_VERSION } from "../../domain/ai/DecisionFeatureTypes";

/**
 * Decision DNA v1 のバリデーション、シリアライズ、デシリアライズ、ファクトリを提供する Codec。
 */
export class DecisionDNACodec {
  /**
   * Row-major 相互作用行列のインデックスを計算
   * index = contextIndex * PATTERN_FEATURE_DIMENSION + patternIndex
   */
  public static getContextPatternWeightIndex(contextIndex: number, patternIndex: number): number {
    return contextIndex * DNA_PATTERN_DIMENSION + patternIndex;
  }

  /**
   * DecisionDNA オブジェクトの完全な整合性を検証
   * 不正な場合は DecisionDNAValidationError をスロー
   */
  public static validate(dna: unknown): asserts dna is DecisionDNA {
    if (!dna || typeof dna !== "object") {
      throw new DecisionDNAValidationError("dna", "object", typeof dna, "DecisionDNA は null 以外のオブジェクトである必要があります。");
    }

    const candidate = dna as Record<string, any>;

    // 1. DNA Format Version
    if (candidate.dnaFormatVersion !== DNA_FORMAT_VERSION) {
      throw new DecisionDNAValidationError("dnaFormatVersion", DNA_FORMAT_VERSION, candidate.dnaFormatVersion);
    }

    // 2. Feature Schema Version
    if (candidate.featureSchemaVersion !== FEATURE_SCHEMA_VERSION) {
      throw new DecisionDNAValidationError("featureSchemaVersion", FEATURE_SCHEMA_VERSION, candidate.featureSchemaVersion);
    }

    // 3. Scoring Model
    if (candidate.scoringModel !== SCORING_MODEL_V1) {
      throw new DecisionDNAValidationError("scoringModel", SCORING_MODEL_V1, candidate.scoringModel);
    }

    // 4. Dimensions
    if (candidate.contextDimension !== DNA_CONTEXT_DIMENSION) {
      throw new DecisionDNAValidationError("contextDimension", DNA_CONTEXT_DIMENSION, candidate.contextDimension);
    }
    if (candidate.patternDimension !== DNA_PATTERN_DIMENSION) {
      throw new DecisionDNAValidationError("patternDimension", DNA_PATTERN_DIMENSION, candidate.patternDimension);
    }

    // 5. Pattern Weights Array
    if (!Array.isArray(candidate.patternWeights)) {
      throw new DecisionDNAValidationError("patternWeights", "Array", typeof candidate.patternWeights);
    }
    if (candidate.patternWeights.length !== DNA_PATTERN_DIMENSION) {
      throw new DecisionDNAValidationError("patternWeights.length", DNA_PATTERN_DIMENSION, candidate.patternWeights.length);
    }
    for (let i = 0; i < candidate.patternWeights.length; i++) {
      const w = candidate.patternWeights[i];
      if (typeof w !== "number" || !Number.isFinite(w)) {
        throw new DecisionDNAValidationError(`patternWeights[${i}]`, "finite number", w);
      }
    }

    // 6. Context-Pattern Interaction Weights Array
    if (!Array.isArray(candidate.contextPatternWeights)) {
      throw new DecisionDNAValidationError("contextPatternWeights", "Array", typeof candidate.contextPatternWeights);
    }
    if (candidate.contextPatternWeights.length !== DNA_INTERACTION_DIMENSION) {
      throw new DecisionDNAValidationError("contextPatternWeights.length", DNA_INTERACTION_DIMENSION, candidate.contextPatternWeights.length);
    }
    for (let i = 0; i < candidate.contextPatternWeights.length; i++) {
      const w = candidate.contextPatternWeights[i];
      if (typeof w !== "number" || !Number.isFinite(w)) {
        throw new DecisionDNAValidationError(`contextPatternWeights[${i}]`, "finite number", w);
      }
    }

    // 7. Metadata (Optional)
    if (candidate.metadata !== undefined) {
      this.validateMetadata(candidate.metadata);
    }
  }

  /**
   * DecisionDNAMetadata の再帰的検証
   * JSON-safe (string, finite number, boolean, null, array, plain object) のみを許可。
   * NaN, Infinity, BigInt, function, Symbol, Date, Map, Set, class instance, 循環参照を厳格に拒絶。
   */
  public static validateMetadata(metadata: unknown): void {
    if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
      throw new DecisionDNAValidationError(
        "metadata",
        "plain JSON object",
        metadata === null ? "null" : Array.isArray(metadata) ? "array" : typeof metadata,
        "metadata は null でないプレーンな JSON オブジェクトである必要があります。"
      );
    }

    const proto = Object.getPrototypeOf(metadata);
    if (proto !== null && proto !== Object.prototype) {
      throw new DecisionDNAValidationError(
        "metadata",
        "plain JSON object",
        Object.prototype.toString.call(metadata),
        "metadata はプレーンな JSON オブジェクトである必要があります (カスタムクラスインスタンス等は禁止)。"
      );
    }

    const activePath = new Set<object>();
    this.validateJSONValue(metadata, "metadata", activePath);
  }

  /**
   * JSON-Safe 値の再帰的型検査
   */
  private static validateJSONValue(value: unknown, path: string, activePath: Set<object>): void {
    if (value === null) {
      return;
    }

    const t = typeof value;
    if (t === "string" || t === "boolean") {
      return;
    }
    if (t === "number") {
      if (!Number.isFinite(value)) {
        throw new DecisionDNAValidationError(
          path,
          "finite number",
          value,
          `metadata の ${path} に非有限数値 (${value}) が指定されています。NaN, Infinity, -Infinity は禁止です。`
        );
      }
      return;
    }
    if (t === "bigint") {
      throw new DecisionDNAValidationError(
        path,
        "JSON-safe value",
        "bigint",
        `metadata の ${path} に BigInt は使用できません。`
      );
    }
    if (t === "function") {
      throw new DecisionDNAValidationError(
        path,
        "JSON-safe value",
        "function",
        `metadata の ${path} に function は使用できません。`
      );
    }
    if (t === "symbol") {
      throw new DecisionDNAValidationError(
        path,
        "JSON-safe value",
        "symbol",
        `metadata の ${path} に Symbol は使用できません。`
      );
    }
    if (t === "undefined") {
      throw new DecisionDNAValidationError(
        path,
        "JSON-safe value",
        "undefined",
        `metadata の ${path} に undefined 値は使用できません。`
      );
    }

    if (t === "object") {
      const obj = value as object;
      if (activePath.has(obj)) {
        throw new DecisionDNAValidationError(
          path,
          "non-cyclic structure",
          "cyclic reference",
          `metadata の ${path} に循環参照が検出されました。`
        );
      }
      activePath.add(obj);

      try {
        if (Array.isArray(obj)) {
          for (let i = 0; i < obj.length; i++) {
            this.validateJSONValue(obj[i], `${path}[${i}]`, activePath);
          }
        } else {
          // Reject non-plain objects (Date, RegExp, Map, Set, Promise, etc.)
          if (
            obj instanceof Date ||
            obj instanceof RegExp ||
            obj instanceof Map ||
            obj instanceof Set ||
            obj instanceof WeakMap ||
            obj instanceof WeakSet ||
            obj instanceof Promise
          ) {
            throw new DecisionDNAValidationError(
              path,
              "plain JSON object",
              Object.prototype.toString.call(obj),
              `metadata の ${path} に ${Object.prototype.toString.call(obj)} は使用できません。`
            );
          }

          const proto = Object.getPrototypeOf(obj);
          if (proto !== null && proto !== Object.prototype) {
            throw new DecisionDNAValidationError(
              path,
              "plain JSON object",
              Object.prototype.toString.call(obj),
              `metadata の ${path} はプレーンな JSON オブジェクトである必要があります。`
            );
          }

          const keys = Object.keys(obj);
          for (let i = 0; i < keys.length; i++) {
            const k = keys[i];
            const v = (obj as Record<string, unknown>)[k];
            this.validateJSONValue(v, `${path}.${k}`, activePath);
          }
        }
      } finally {
        activePath.delete(obj);
      }
      return;
    }

    throw new DecisionDNAValidationError(
      path,
      "JSON-safe value",
      t,
      `metadata の ${path} に不正な型の値 (${t}) が含まれています。`
    );
  }

  /**
   * JSON-Safe メタデータの再帰的ディープクローン
   */
  private static deepCloneMetadata<T>(value: T): T {
    if (value === null || typeof value !== "object") {
      return value;
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.deepCloneMetadata(item)) as unknown as T;
    }
    const result: Record<string, any> = {};
    for (const key of Object.keys(value)) {
      const v = (value as Record<string, any>)[key];
      if (v !== undefined) {
        result[key] = this.deepCloneMetadata(v);
      }
    }
    return result as T;
  }

  /**
   * DecisionDNA を JSON 文字列へシリアライズ
   */
  public static serialize(dna: Readonly<DecisionDNA>): string {
    this.validate(dna);
    return JSON.stringify(dna);
  }

  /**
   * JSON 文字列から DecisionDNA をデシリアライズして検証
   */
  public static deserialize(json: string): DecisionDNA {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (e: any) {
      throw new DecisionDNAValidationError("json", "valid JSON string", json, `JSON パースに失敗しました: ${e.message}`);
    }
    this.validate(parsed);
    return parsed;
  }

  /**
   * 全ての重みが 0 の基準 DecisionDNA (Zero DNA) を作成
   * 公開 Factory 入口として、metadata が渡された場合は clone 前に必ず validation を実行
   */
  public static createZeroDecisionDNA(metadata?: DecisionDNAMetadata): DecisionDNA {
    let clonedMetadata: DecisionDNAMetadata | undefined = undefined;
    if (metadata !== undefined) {
      this.validateMetadata(metadata);
      clonedMetadata = this.deepCloneMetadata(metadata);
    }

    return {
      dnaFormatVersion: DNA_FORMAT_VERSION,
      featureSchemaVersion: FEATURE_SCHEMA_VERSION,
      scoringModel: SCORING_MODEL_V1,
      contextDimension: DNA_CONTEXT_DIMENSION,
      patternDimension: DNA_PATTERN_DIMENSION,
      patternWeights: new Array(DNA_PATTERN_DIMENSION).fill(0),
      contextPatternWeights: new Array(DNA_INTERACTION_DIMENSION).fill(0),
      metadata: clonedMetadata,
    };
  }

  /**
   * DecisionDNA の完全なディープクローンを作成 (外部の配列・オブジェクト改変から保護)
   */
  public static clone(dna: Readonly<DecisionDNA>): DecisionDNA {
    this.validate(dna);
    return {
      dnaFormatVersion: dna.dnaFormatVersion,
      featureSchemaVersion: dna.featureSchemaVersion,
      scoringModel: dna.scoringModel,
      contextDimension: dna.contextDimension,
      patternDimension: dna.patternDimension,
      patternWeights: [...dna.patternWeights],
      contextPatternWeights: [...dna.contextPatternWeights],
      metadata: dna.metadata !== undefined ? this.deepCloneMetadata(dna.metadata) : undefined,
    };
  }
}
