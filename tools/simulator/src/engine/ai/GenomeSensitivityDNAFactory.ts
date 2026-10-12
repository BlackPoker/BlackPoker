import { DecisionDNA, DecisionDNAMetadata } from "../../domain/ai/DecisionDNATypes";
import { PATTERN_FEATURE_NAMES, CONTEXT_FEATURE_NAMES } from "../../domain/ai/DecisionFeatureTypes";
import { DecisionDNACodec } from "./DecisionDNACodec";

/**
 * Genome Sensitivity 検証用の Contrast DNA ファクトリ。
 *
 * 【設計原則】
 * 1. 汎用 Feature のみ使用: Action ID やコンポーネント ID を一切参照・指定しません。
 * 2. 進行不能防止: 効果選択 (EFFECT_SELECTION) が必要な局面でスタックしないよう配慮。
 * 3. Canonical Indexing: 相互作用行列のインデックス計算には必ず DecisionDNACodec.getContextPatternWeightIndex を使用。
 */
export class GenomeSensitivityDNAFactory {
  /**
   * 行動優先型 (active-biased-v1) DNA を生成
   */
  public static createActiveBiasedDNA(metadata?: Partial<DecisionDNAMetadata>): DecisionDNA {
    const dna = DecisionDNACodec.createZeroDecisionDNA({
      id: "active-biased-v1",
      name: "ActiveBiasedGenome",
      tags: ["sensitivity", "active-biased", "v1"],
      ...metadata,
    });

    const actIdx = PATTERN_FEATURE_NAMES.indexOf("pattern_is_action");
    const passIdx = PATTERN_FEATURE_NAMES.indexOf("pattern_is_pass");
    const effIdx = PATTERN_FEATURE_NAMES.indexOf("pattern_is_effect_selection");

    if (actIdx !== -1) (dna.patternWeights as number[])[actIdx] = 5.0;
    if (passIdx !== -1) (dna.patternWeights as number[])[passIdx] = -3.0;
    if (effIdx !== -1) (dna.patternWeights as number[])[effIdx] = 5.0;

    DecisionDNACodec.validate(dna);
    return dna;
  }

  /**
   * パス優先型 (pass-biased-v1) DNA を生成
   */
  public static createPassBiasedDNA(metadata?: Partial<DecisionDNAMetadata>): DecisionDNA {
    const dna = DecisionDNACodec.createZeroDecisionDNA({
      id: "pass-biased-v1",
      name: "PassBiasedGenome",
      tags: ["sensitivity", "pass-biased", "v1"],
      ...metadata,
    });

    const actIdx = PATTERN_FEATURE_NAMES.indexOf("pattern_is_action");
    const passIdx = PATTERN_FEATURE_NAMES.indexOf("pattern_is_pass");
    const effIdx = PATTERN_FEATURE_NAMES.indexOf("pattern_is_effect_selection");

    if (passIdx !== -1) (dna.patternWeights as number[])[passIdx] = 5.0;
    if (actIdx !== -1) (dna.patternWeights as number[])[actIdx] = -3.0;
    // 効果解決が必要な場面でゲーム進行不能にならないよう、効果選択は正の重み
    if (effIdx !== -1) (dna.patternWeights as number[])[effIdx] = 5.0;

    DecisionDNACodec.validate(dna);
    return dna;
  }

  /**
   * 指定した Pattern Linear Feature の重みを変更した DNA を生成
   */
  public static createLinearBiasedDNA(
    baseDna: Readonly<DecisionDNA>,
    patternFeatureName: string,
    weightDelta: number,
    metadata?: Partial<DecisionDNAMetadata>
  ): DecisionDNA {
    const pIdx = PATTERN_FEATURE_NAMES.indexOf(patternFeatureName as any);
    if (pIdx === -1) {
      throw new Error(`未知の Pattern Feature 名: ${patternFeatureName}`);
    }

    const patternWeights = [...baseDna.patternWeights];
    patternWeights[pIdx] += weightDelta;

    const modified: DecisionDNA = {
      ...DecisionDNACodec.clone(baseDna),
      patternWeights,
      metadata: metadata ? { ...baseDna.metadata, ...metadata } : baseDna.metadata,
    };

    DecisionDNACodec.validate(modified);
    return modified;
  }

  /**
   * 指定した Context × Pattern Interaction Feature の重みを変更した DNA を生成
   */
  public static createInteractionBiasedDNA(
    baseDna: Readonly<DecisionDNA>,
    contextFeatureName: string,
    patternFeatureName: string,
    weightDelta: number,
    metadata?: Partial<DecisionDNAMetadata>
  ): DecisionDNA {
    const cIdx = CONTEXT_FEATURE_NAMES.indexOf(contextFeatureName as any);
    if (cIdx === -1) {
      throw new Error(`未知の Context Feature 名: ${contextFeatureName}`);
    }

    const pIdx = PATTERN_FEATURE_NAMES.indexOf(patternFeatureName as any);
    if (pIdx === -1) {
      throw new Error(`未知の Pattern Feature 名: ${patternFeatureName}`);
    }

    const weightIndex = DecisionDNACodec.getContextPatternWeightIndex(cIdx, pIdx);
    const contextPatternWeights = [...baseDna.contextPatternWeights];
    contextPatternWeights[weightIndex] += weightDelta;

    const modified: DecisionDNA = {
      ...DecisionDNACodec.clone(baseDna),
      contextPatternWeights,
      metadata: metadata ? { ...baseDna.metadata, ...metadata } : baseDna.metadata,
    };

    DecisionDNACodec.validate(modified);
    return modified;
  }
}
