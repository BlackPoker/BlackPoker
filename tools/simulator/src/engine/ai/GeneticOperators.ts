/**
 * Genetic Operators V1 Facade & Offspring Generator (BP-SIM-AI-GENETIC-OPERATORS-DESIGN-V1-R2 / BP-SIM-AI-GENETIC-OPERATORS-V1)
 *
 * 遺伝的操作子（Crossover, Mutation, Parent Pairing, Offspring 生成）を統括するファサードモジュール。
 *
 * 設計仕様: tools/simulator/docs/ai-genetic-operators-design-v1.md
 *
 * 最重要原則:
 * 1. 決定論的 Offspring Identity: gen-${pad(generation, 6)}-offspring-${pad(offspringIndex, 6)}
 * 2. 独立ストリーム派生: generationSeed -> offspringSeed -> crossoverSeed / mutationSeed
 * 3. 親 DNA 完全保護 (Immutability)
 * 4. Fitness 非混入保証: DNA や Lineage に適応度スコアを書き込まない
 * 5. DecisionDNACodec.validate() による生成物完全検証
 */

import {
  GeneticOperatorConfig,
  DEFAULT_GENETIC_OPERATOR_CONFIG,
  GeneticOperatorConfigurationError,
  GeneticOperatorError,
  GenerateOffspringParams,
  GeneratedOffspring,
  OffspringLineageMetadata,
  EVOLUTION_CROSSOVER_STREAM_KEY,
  EVOLUTION_MUTATION_STREAM_KEY,
  getOffspringStreamKey,
} from "../../domain/ai/GeneticOperatorTypes";
import {
  DecisionDNA,
  DNA_FORMAT_VERSION,
  DNA_CONTEXT_DIMENSION,
  DNA_PATTERN_DIMENSION,
  SCORING_MODEL_V1,
} from "../../domain/ai/DecisionDNATypes";
import { FEATURE_SCHEMA_VERSION } from "../../domain/ai/DecisionFeatureTypes";
import { DecisionDNACodec } from "./DecisionDNACodec";
import { deriveSeed } from "../random/DeterministicShuffle";
import { GeneticCrossover } from "./GeneticCrossover";
import { GeneticMutation } from "./GeneticMutation";
import { ParentPairAssembler } from "./ParentPairAssembler";

export { GeneticCrossover, type CrossedWeights } from "./GeneticCrossover";
export { GeneticMutation, type MutatedWeights } from "./GeneticMutation";
export { ParentPairAssembler, type AssembleParentPairParams } from "./ParentPairAssembler";
export { nextUint32V1, nextUint16V1 } from "./GeneticRandom";

/**
 * 決定論的 Offspring ゲノム識別子をフォーマット
 * 例: generation = 12, offspringIndex = 42 -> "gen-000012-offspring-000042"
 */
export function formatOffspringGenomeId(
  generation: number,
  offspringIndex: number
): string {
  if (
    typeof generation !== "number" ||
    !Number.isFinite(generation) ||
    !Number.isInteger(generation) ||
    generation < 0
  ) {
    throw new GeneticOperatorError(
      `formatOffspringGenomeId: generation must be a non-negative integer, received ${generation}`
    );
  }

  if (
    typeof offspringIndex !== "number" ||
    !Number.isFinite(offspringIndex) ||
    !Number.isInteger(offspringIndex) ||
    offspringIndex < 0
  ) {
    throw new GeneticOperatorError(
      `formatOffspringGenomeId: offspringIndex must be a non-negative integer, received ${offspringIndex}`
    );
  }

  const genPad = String(generation).padStart(6, "0");
  const offPad = String(offspringIndex).padStart(6, "0");
  return `gen-${genPad}-offspring-${offPad}`;
}

/**
 * 遺伝的操作子設定の検証と解決 (Fail-Fast)
 */
export function validateGeneticOperatorConfig(
  config?: Partial<GeneticOperatorConfig>
): GeneticOperatorConfig {
  const mutationRate =
    config?.mutationRate !== undefined
      ? config.mutationRate
      : DEFAULT_GENETIC_OPERATOR_CONFIG.mutationRate;

  const mutationSigma =
    config?.mutationSigma !== undefined
      ? config.mutationSigma
      : DEFAULT_GENETIC_OPERATOR_CONFIG.mutationSigma;

  const mutationClampMin =
    config?.mutationClampMin !== undefined
      ? config.mutationClampMin
      : DEFAULT_GENETIC_OPERATOR_CONFIG.mutationClampMin;

  const mutationClampMax =
    config?.mutationClampMax !== undefined
      ? config.mutationClampMax
      : DEFAULT_GENETIC_OPERATOR_CONFIG.mutationClampMax;

  const maxSelfMatingRetries =
    config?.maxSelfMatingRetries !== undefined
      ? config.maxSelfMatingRetries
      : DEFAULT_GENETIC_OPERATOR_CONFIG.maxSelfMatingRetries;

  if (
    typeof mutationRate !== "number" ||
    !Number.isFinite(mutationRate) ||
    mutationRate < 0 ||
    mutationRate > 1
  ) {
    throw new GeneticOperatorConfigurationError(
      `Invalid mutationRate: must be a finite number in [0, 1], received ${mutationRate}`
    );
  }

  if (
    typeof mutationSigma !== "number" ||
    !Number.isFinite(mutationSigma) ||
    mutationSigma < 0
  ) {
    throw new GeneticOperatorConfigurationError(
      `Invalid mutationSigma: must be a finite non-negative number, received ${mutationSigma}`
    );
  }

  if (typeof mutationClampMin !== "number" || !Number.isFinite(mutationClampMin)) {
    throw new GeneticOperatorConfigurationError(
      `Invalid mutationClampMin: must be a finite number, received ${mutationClampMin}`
    );
  }

  if (typeof mutationClampMax !== "number" || !Number.isFinite(mutationClampMax)) {
    throw new GeneticOperatorConfigurationError(
      `Invalid mutationClampMax: must be a finite number, received ${mutationClampMax}`
    );
  }

  if (mutationClampMin >= mutationClampMax) {
    throw new GeneticOperatorConfigurationError(
      `Invalid clamp range: mutationClampMin (${mutationClampMin}) must be strictly less than mutationClampMax (${mutationClampMax})`
    );
  }

  if (
    typeof maxSelfMatingRetries !== "number" ||
    !Number.isFinite(maxSelfMatingRetries) ||
    !Number.isInteger(maxSelfMatingRetries) ||
    maxSelfMatingRetries < 0
  ) {
    throw new GeneticOperatorConfigurationError(
      `Invalid maxSelfMatingRetries: must be a finite non-negative integer, received ${maxSelfMatingRetries}`
    );
  }

  return Object.freeze({
    mutationRate,
    mutationSigma,
    mutationClampMin,
    mutationClampMax,
    maxSelfMatingRetries,
  });
}

/**
 * 単一の子個体 (Offspring) を決定論的に生成する基本プリミティブ
 *
 * 処理フロー:
 * generationSeed -> offspringSeed -> crossoverSeed / mutationSeed
 * -> Crossover -> Mutation -> DecisionDNA 生成 -> Lineage DTO 生成
 */
export function generateOffspring(
  params: GenerateOffspringParams
): GeneratedOffspring {
  if (!params || typeof params !== "object") {
    throw new GeneticOperatorError(
      "generateOffspring: params must be a valid object."
    );
  }

  const { parentPair, generation, offspringIndex, generationSeed } = params;

  if (!parentPair) {
    throw new GeneticOperatorError(
      "generateOffspring: parentPair must be provided."
    );
  }

  if (
    typeof generationSeed !== "number" ||
    !Number.isFinite(generationSeed)
  ) {
    throw new GeneticOperatorError(
      `generateOffspring: generationSeed must be a finite number, received ${generationSeed}`
    );
  }

  const genomeId = formatOffspringGenomeId(generation, offspringIndex);
  const resolvedConfig = validateGeneticOperatorConfig(params.config);

  // 1. offspringSeed の導出
  const offspringStreamKey = getOffspringStreamKey(offspringIndex);
  const offspringSeed = deriveSeed(generationSeed, offspringStreamKey);

  // 2. Crossover & Mutation 用の独立ストリームシード導出
  const crossoverSeed = deriveSeed(offspringSeed, EVOLUTION_CROSSOVER_STREAM_KEY);
  const mutationSeed = deriveSeed(offspringSeed, EVOLUTION_MUTATION_STREAM_KEY);

  // 3. Crossover (Block-Segmented Uniform Crossover V1)
  const crossedWeights = GeneticCrossover.cross(parentPair, crossoverSeed);

  // 4. Mutation (Deterministic Normal-Like Perturbation V1)
  const mutatedWeights = GeneticMutation.mutate(
    crossedWeights,
    mutationSeed,
    resolvedConfig
  );

  // 5. 新規 DecisionDNA の構築
  const dna: DecisionDNA = Object.freeze({
    dnaFormatVersion: DNA_FORMAT_VERSION,
    featureSchemaVersion: FEATURE_SCHEMA_VERSION,
    scoringModel: SCORING_MODEL_V1,
    contextDimension: DNA_CONTEXT_DIMENSION,
    patternDimension: DNA_PATTERN_DIMENSION,
    patternWeights: mutatedWeights.patternWeights,
    contextPatternWeights: mutatedWeights.contextPatternWeights,
    metadata: Object.freeze({
      id: genomeId,
      generation,
    }),
  });

  // 生成された DNA の完全性検証
  try {
    DecisionDNACodec.validate(dna);
  } catch (err) {
    throw new GeneticOperatorError(
      `generateOffspring: Generated DecisionDNA failed codec validation: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  // 6. 系統メタデータ (OffspringLineageMetadata) の構築 (※Fitness は含めない)
  const lineage: OffspringLineageMetadata = Object.freeze({
    genomeId,
    generation,
    offspringIndex,
    parentGenomeIds: Object.freeze([
      parentPair.parentA.genomeId,
      parentPair.parentB.genomeId,
    ]),
    crossoverOperatorVersion: "block-segmented-uniform-v1",
    mutationOperatorVersion: "deterministic-normal-approx-v1",
    seedDerivationVersion: "derive-seed-fnv1a-v1",
    offspringSeed,
    crossoverSeed,
    mutationSeed,
  });

  return Object.freeze({
    dna,
    lineage,
  });
}
