/**
 * Block-Segmented Uniform Crossover V1 (BP-SIM-AI-GENETIC-OPERATORS-DESIGN-V1-R2 / BP-SIM-AI-GENETIC-OPERATORS-V1)
 *
 * BlackPoker Decision DNA v1 に対するブロック分割型一様交叉オペレータ。
 *
 * 契約規約:
 * 1. 遺伝子巡回順序 (Canonical Order):
 *    - Step 1: patternWeights (0 .. 142) [143 次元]
 *    - Step 2: contextPatternWeights (0 .. 23308) [23,309 次元]
 * 2. PRNG Draw 規約:
 *    - 各遺伝子につき exactly 1 回の nextUint32V1() を消費。
 *    - word < 0x80000000 (2147483648) -> Parent A の重みを採用
 *    - word >= 0x80000000 -> Parent B の重みを採用 (Px = 0.5)
 *    - 総 Draw 数: exactly 23,452 draws (完全固定)
 * 3. 親 DNA の完全不変性 (Parent Immutability):
 *    - 入力親 DNA 配列は決して変更せず、完全に新しい重み配列を割り当てて返却。
 * 4. メタデータ乱数非消費:
 *    - metadata には一切の PRNG draw を消費しない。
 */

import {
  GeneticParentPair,
  GeneticOperatorError,
} from "../../domain/ai/GeneticOperatorTypes";
import {
  DNA_PATTERN_DIMENSION,
  DNA_INTERACTION_DIMENSION,
} from "../../domain/ai/DecisionDNATypes";
import { DecisionDNACodec } from "./DecisionDNACodec";
import { SeededRandom } from "../random/RandomSource";
import { nextUint32V1 } from "./GeneticRandom";

/**
 * 交叉後の重み配列
 */
export interface CrossedWeights {
  readonly patternWeights: readonly number[];
  readonly contextPatternWeights: readonly number[];
}

export class GeneticCrossover {
  /**
   * Block-Segmented Uniform Crossover V1 の実行
   */
  public static cross(
    parentPair: GeneticParentPair,
    crossoverSeed: number
  ): CrossedWeights {
    if (!parentPair || typeof parentPair !== "object") {
      throw new GeneticOperatorError(
        "GeneticCrossover: parentPair must be a valid object."
      );
    }

    const { parentA, parentB } = parentPair;

    if (!parentA || !parentB) {
      throw new GeneticOperatorError(
        "GeneticCrossover: parentPair must contain both parentA and parentB."
      );
    }

    if (typeof crossoverSeed !== "number" || !Number.isFinite(crossoverSeed)) {
      throw new GeneticOperatorError(
        `GeneticCrossover: crossoverSeed must be a finite number, received ${crossoverSeed}`
      );
    }

    // 親 DNA の整合性検証
    try {
      DecisionDNACodec.validate(parentA.dna);
      DecisionDNACodec.validate(parentB.dna);
    } catch (err) {
      throw new GeneticOperatorError(
        `GeneticCrossover: Invalid parent DecisionDNA: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }

    const rng = new SeededRandom(crossoverSeed);

    // 1. patternWeights の一様交叉 (143 次元)
    const patternWeights = new Array<number>(DNA_PATTERN_DIMENSION);
    for (let i = 0; i < DNA_PATTERN_DIMENSION; i++) {
      const word = nextUint32V1(rng);
      patternWeights[i] =
        word < 0x80000000
          ? parentA.dna.patternWeights[i]
          : parentB.dna.patternWeights[i];
    }

    // 2. contextPatternWeights の一様交叉 (23,309 次元)
    const contextPatternWeights = new Array<number>(DNA_INTERACTION_DIMENSION);
    for (let j = 0; j < DNA_INTERACTION_DIMENSION; j++) {
      const word = nextUint32V1(rng);
      contextPatternWeights[j] =
        word < 0x80000000
          ? parentA.dna.contextPatternWeights[j]
          : parentB.dna.contextPatternWeights[j];
    }

    return Object.freeze({
      patternWeights: Object.freeze(patternWeights),
      contextPatternWeights: Object.freeze(contextPatternWeights),
    });
  }
}
