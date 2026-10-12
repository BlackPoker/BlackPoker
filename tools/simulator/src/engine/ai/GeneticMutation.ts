/**
 * Deterministic Normal-Like Mutation V1 (BP-SIM-AI-GENETIC-OPERATORS-DESIGN-V1-R2 / BP-SIM-AI-GENETIC-OPERATORS-V1)
 *
 * BlackPoker Decision DNA v1 に対する決定論的正規分布近似突然変異オペレータ (`deterministic-normal-approx-v1`)。
 *
 * 契約規約:
 * 1. 遺伝子巡回順序 (Canonical Order):
 *    - Step 1: patternWeights (0 .. 142) [143 次元]
 *    - Step 2: contextPatternWeights (0 .. 23308) [23,309 次元]
 * 2. PRNG Draw 規約:
 *    - 各遺伝子につき変異判定 draw を exactly 1 回消費: nextUint32V1() < threshold
 *    - 変異発生時: exactly 12 回の nextUint32V1() を追加消費 (各 word の上位 16 ビット和による Irwin-Hall 近似)
 *    - 非変異時: 追加 draw なし (0 draws)
 *    - 総 Draw 数式: 23,452 + 12 * mutatedGeneCount
 * 3. 閾値規約:
 *    - mutationRate === 1 ? 4294967296 : Math.floor(mutationRate * 4294967296)
 * 4. クランプと数値安全性 (Fail-Closed):
 *    - clamp(candidate, mutationClampMin, mutationClampMax)
 *    - NaN / Infinity 等の非有限値を検知した場合は GeneticOperatorError をスロー (サイレントフォールバック禁止)
 * 5. 入力不変性 (Input Immutability):
 *    - 入力配列は変更せず、新しい重み配列を返却。
 */

import {
  GeneticOperatorConfig,
  GeneticOperatorError,
} from "../../domain/ai/GeneticOperatorTypes";
import {
  DNA_PATTERN_DIMENSION,
  DNA_INTERACTION_DIMENSION,
} from "../../domain/ai/DecisionDNATypes";
import { SeededRandom } from "../random/RandomSource";
import { nextUint32V1 } from "./GeneticRandom";

/**
 * 突然変異後の重み配列
 */
export interface MutatedWeights {
  readonly patternWeights: readonly number[];
  readonly contextPatternWeights: readonly number[];
}

export class GeneticMutation {
  /**
   * Deterministic Normal-Like Perturbation V1 の実行
   */
  public static mutate(
    weights: {
      readonly patternWeights: readonly number[];
      readonly contextPatternWeights: readonly number[];
    },
    mutationSeed: number,
    config: GeneticOperatorConfig
  ): MutatedWeights {
    if (!weights || typeof weights !== "object") {
      throw new GeneticOperatorError(
        "GeneticMutation: weights must be a valid object."
      );
    }

    if (
      !Array.isArray(weights.patternWeights) ||
      weights.patternWeights.length !== DNA_PATTERN_DIMENSION
    ) {
      throw new GeneticOperatorError(
        `GeneticMutation: patternWeights must be an array of length ${DNA_PATTERN_DIMENSION}.`
      );
    }

    if (
      !Array.isArray(weights.contextPatternWeights) ||
      weights.contextPatternWeights.length !== DNA_INTERACTION_DIMENSION
    ) {
      throw new GeneticOperatorError(
        `GeneticMutation: contextPatternWeights must be an array of length ${DNA_INTERACTION_DIMENSION}.`
      );
    }

    if (typeof mutationSeed !== "number" || !Number.isFinite(mutationSeed)) {
      throw new GeneticOperatorError(
        `GeneticMutation: mutationSeed must be a finite number, received ${mutationSeed}`
      );
    }

    if (!config || typeof config !== "object") {
      throw new GeneticOperatorError(
        "GeneticMutation: config must be a valid GeneticOperatorConfig object."
      );
    }

    const {
      mutationRate,
      mutationSigma,
      mutationClampMin,
      mutationClampMax,
    } = config;

    const threshold =
      mutationRate === 1 ? 4294967296 : Math.floor(mutationRate * 4294967296);

    const rng = new SeededRandom(mutationSeed);

    // 1. patternWeights の突然変異 (143 次元)
    const patternWeights = new Array<number>(DNA_PATTERN_DIMENSION);
    for (let i = 0; i < DNA_PATTERN_DIMENSION; i++) {
      const orig = weights.patternWeights[i];
      if (!Number.isFinite(orig)) {
        throw new GeneticOperatorError(
          `GeneticMutation: Non-finite input weight detected in patternWeights at index ${i}`
        );
      }

      const decisionWord = nextUint32V1(rng);
      if (decisionWord < threshold) {
        // 変異実行: exactly 12 draws
        let sumU16 = 0;
        for (let k = 0; k < 12; k++) {
          const noiseWord = nextUint32V1(rng);
          sumU16 += noiseWord >>> 16;
        }

        const normalApprox = (sumU16 - 393210) / 65536;
        const delta = mutationSigma * normalApprox;
        const candidate = orig + delta;
        const clamped = Math.min(
          mutationClampMax,
          Math.max(mutationClampMin, candidate)
        );

        if (!Number.isFinite(clamped)) {
          throw new GeneticOperatorError(
            `GeneticMutation: Non-finite weight produced during mutation at patternWeights[${i}]`
          );
        }

        patternWeights[i] = clamped;
      } else {
        patternWeights[i] = orig;
      }
    }

    // 2. contextPatternWeights の突然変異 (23,309 次元)
    const contextPatternWeights = new Array<number>(DNA_INTERACTION_DIMENSION);
    for (let j = 0; j < DNA_INTERACTION_DIMENSION; j++) {
      const orig = weights.contextPatternWeights[j];
      if (!Number.isFinite(orig)) {
        throw new GeneticOperatorError(
          `GeneticMutation: Non-finite input weight detected in contextPatternWeights at index ${j}`
        );
      }

      const decisionWord = nextUint32V1(rng);
      if (decisionWord < threshold) {
        // 変異実行: exactly 12 draws
        let sumU16 = 0;
        for (let k = 0; k < 12; k++) {
          const noiseWord = nextUint32V1(rng);
          sumU16 += noiseWord >>> 16;
        }

        const normalApprox = (sumU16 - 393210) / 65536;
        const delta = mutationSigma * normalApprox;
        const candidate = orig + delta;
        const clamped = Math.min(
          mutationClampMax,
          Math.max(mutationClampMin, candidate)
        );

        if (!Number.isFinite(clamped)) {
          throw new GeneticOperatorError(
            `GeneticMutation: Non-finite weight produced during mutation at contextPatternWeights[${j}]`
          );
        }

        contextPatternWeights[j] = clamped;
      } else {
        contextPatternWeights[j] = orig;
      }
    }

    return Object.freeze({
      patternWeights: Object.freeze(patternWeights),
      contextPatternWeights: Object.freeze(contextPatternWeights),
    });
  }
}
