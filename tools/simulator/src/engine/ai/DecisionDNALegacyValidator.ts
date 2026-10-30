import {
  DecisionDNA,
  DecisionDNAValidationError,
} from "../../domain/ai/DecisionDNATypes";
import { DecisionDNACodec } from "./DecisionDNACodec";

export class DecisionDNALegacyValidator {
  /**
   * Schema v5 Decision DNA を厳格に検証（v6 Codec から分離された旧形式検証器）
   */
  public static validateV5(dna: unknown): asserts dna is DecisionDNA {
    if (!dna || typeof dna !== "object") {
      throw new DecisionDNAValidationError("dna", "object", typeof dna, "null以外のオブジェクト必須");
    }
    const c = dna as Record<string, any>;

    if (c.dnaFormatVersion !== 1) {
      throw new DecisionDNAValidationError("dnaFormatVersion", 1, c.dnaFormatVersion);
    }
    if (c.featureSchemaVersion !== 5) {
      throw new DecisionDNAValidationError("featureSchemaVersion", 5, c.featureSchemaVersion);
    }
    if (c.scoringModel !== "linear-bilinear-v1") {
      throw new DecisionDNAValidationError("scoringModel", "linear-bilinear-v1", c.scoringModel);
    }
    if (c.contextDimension !== 163) {
      throw new DecisionDNAValidationError("contextDimension", 163, c.contextDimension);
    }
    if (c.patternDimension !== 143) {
      throw new DecisionDNAValidationError("patternDimension", 143, c.patternDimension);
    }
    if (!Array.isArray(c.patternWeights)) {
      throw new DecisionDNAValidationError("patternWeights", "Array", typeof c.patternWeights);
    }
    if (c.patternWeights.length !== 143) {
      throw new DecisionDNAValidationError("patternWeights.length", 143, c.patternWeights?.length);
    }
    if (!Array.isArray(c.contextPatternWeights)) {
      throw new DecisionDNAValidationError("contextPatternWeights", "Array", typeof c.contextPatternWeights);
    }
    if (c.contextPatternWeights.length !== 163 * 143) {
      throw new DecisionDNAValidationError("contextPatternWeights.length", 163 * 143, c.contextPatternWeights?.length);
    }

    // 全重みの有限数検証
    for (let i = 0; i < c.patternWeights.length; i++) {
      const w = c.patternWeights[i];
      if (typeof w !== "number" || !Number.isFinite(w)) {
        throw new DecisionDNAValidationError(`patternWeights[${i}]`, "finite number", w);
      }
    }
    for (let i = 0; i < c.contextPatternWeights.length; i++) {
      const w = c.contextPatternWeights[i];
      if (typeof w !== "number" || !Number.isFinite(w)) {
        throw new DecisionDNAValidationError(`contextPatternWeights[${i}]`, "finite number", w);
      }
    }

    // メタデータの JSON-safe バリデーション
    if (c.metadata !== undefined) {
      DecisionDNACodec.validateMetadata(c.metadata);
    }
  }
}
