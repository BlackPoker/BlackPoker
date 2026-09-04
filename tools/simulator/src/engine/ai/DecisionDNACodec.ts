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
    if (candidate.metadata !== undefined && (typeof candidate.metadata !== "object" || candidate.metadata === null)) {
      throw new DecisionDNAValidationError("metadata", "object or undefined", typeof candidate.metadata);
    }
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
   */
  public static createZeroDecisionDNA(metadata?: DecisionDNAMetadata): DecisionDNA {
    return {
      dnaFormatVersion: DNA_FORMAT_VERSION,
      featureSchemaVersion: FEATURE_SCHEMA_VERSION,
      scoringModel: SCORING_MODEL_V1,
      contextDimension: DNA_CONTEXT_DIMENSION,
      patternDimension: DNA_PATTERN_DIMENSION,
      patternWeights: new Array(DNA_PATTERN_DIMENSION).fill(0),
      contextPatternWeights: new Array(DNA_INTERACTION_DIMENSION).fill(0),
      metadata: metadata ? { ...metadata } : undefined,
    };
  }

  /**
   * DecisionDNA の完全なディープクローンを作成 (外部の配列改変から保護)
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
      metadata: dna.metadata ? { ...dna.metadata } : undefined,
    };
  }
}
