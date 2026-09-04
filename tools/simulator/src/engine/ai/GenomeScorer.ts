import { DecisionDNA, DecisionDNAExecutionError } from "../../domain/ai/DecisionDNATypes";
import { EncodedDecisionFeatures } from "../../domain/ai/DecisionFeatureTypes";

/**
 * スコアリングされた単一合法手の結果
 */
export interface ScoredPattern {
  readonly patternRef: number;
  readonly kind: string;
  readonly logicalPatternKey?: string;
  readonly score: number;
}

/**
 * EncodedDecisionFeatures と DecisionDNA から、各合法手の評価値を計算する純粋関数スコアラー。
 *
 * 【Scoring Formula v1 (Linear + Bilinear Interaction)】
 * score(pattern) = Σ_j (w_j * p_j) + Σ_i Σ_j (M_ij * c_i * p_j)
 *
 * - c_i: Context Feature (i in 0..24)
 * - p_j: Pattern Feature (j in 0..56)
 * - w_j: Pattern Linear Weight (j in 0..56)
 * - M_ij: Context-Pattern Interaction Weight (Row-major: i * 57 + j)
 *
 * 【設計原則】
 * 1. Stateless / Pure Function: RNG や日付・内部可変状態を持たず、同一入力に対し完全に同一の出力を返します。
 * 2. Strict Determinism: 加算順序は pattern index 昇順、context index 昇順で固定されます。
 * 3. Finite Score Contract: 浮動小数点演算の結果が有限数 (Number.isFinite) でない場合は例外をスローします (サイレントクランプ禁止)。
 */
export class GenomeScorer {
  /**
   * 各 LegalPattern のスコアを計算
   */
  public static score(
    features: Readonly<EncodedDecisionFeatures>,
    dna: Readonly<DecisionDNA>
  ): ScoredPattern[] {
    if (dna.featureSchemaVersion !== features.featureSchemaVersion) {
      throw new DecisionDNAExecutionError(
        `FeatureSchemaVersion 不一致: DNA=${dna.featureSchemaVersion}, Features=${features.featureSchemaVersion}`
      );
    }

    const contextValues = features.context.values;
    const patterns = features.patterns;
    const pWeights = dna.patternWeights;
    const cpWeights = dna.contextPatternWeights;
    const pDim = dna.patternDimension;
    const cDim = dna.contextDimension;

    const results: ScoredPattern[] = [];

    for (let pIdx = 0; pIdx < patterns.length; pIdx++) {
      const pat = patterns[pIdx];
      const pValues = pat.values;

      let score = 0;

      // 1. Pattern Linear Weights: Σ_j w_j * p_j
      for (let j = 0; j < pDim; j++) {
        const p_j = pValues[j] ?? 0;
        const w_j = pWeights[j] ?? 0;
        score += w_j * p_j;
      }

      // 2. Context-Pattern Interaction: Σ_i Σ_j M_ij * c_i * p_j (Row-major 順序固定)
      for (let i = 0; i < cDim; i++) {
        const c_i = contextValues[i] ?? 0;
        if (c_i === 0) continue;

        const rowOffset = i * pDim;
        for (let j = 0; j < pDim; j++) {
          const p_j = pValues[j] ?? 0;
          if (p_j === 0) continue;

          const m_ij = cpWeights[rowOffset + j] ?? 0;
          score += m_ij * c_i * p_j;
        }
      }

      if (!Number.isFinite(score)) {
        throw new DecisionDNAExecutionError(
          `Pattern [ref: ${pat.patternRef}] のスコア演算結果が非有限数となりました: ${score}`
        );
      }

      results.push({
        patternRef: pat.patternRef,
        kind: pat.kind,
        logicalPatternKey: pat.logicalPatternKey,
        score,
      });
    }

    return results;
  }
}
