/**
 * Generation Builder V1 Engine (BP-SIM-AI-GENERATION-BUILDER-DESIGN-V1-R4 / BP-SIM-AI-GENERATION-BUILDER-V1)
 *
 * BlackPoker Simulator AI 基盤における世代交代アセンブリエンジン。
 * Generation g の PopulationSnapshot および FitnessEvaluationSnapshot から、
 * Generation g+1 の PopulationSnapshot を決定論的・Fail-Closed に構築する。
 *
 * 設計仕様: tools/simulator/docs/ai-generation-builder-design-v1.md
 *
 * 最重要設計原則:
 * 1. 決定論性 (Supported Deterministic Runtime 完全一致)
 * 2. 入力不変性 & Clone Isolation (親スナップショット/DNA非破壊、エリートDNAの参照隔離)
 * 3. 単一親系列契約 (Single-Series Parent Selection Contract)
 * 4. 有効適応度ゲート (Effective Readiness Gate)
 * 5. カノニカル出力順序 ([Elites (0..E-1), Offspring (0..M-1)])
 * 6. エラータクソノミー分離 (Configuration / Integrity / Execution)
 */

import {
  ComparableEvaluationContext,
  FitnessEvaluationSnapshot,
  PopulationEntry,
  PopulationSelectionConfig,
  PopulationSnapshot,
  SelectedParent,
} from "../../domain/ai/PopulationSelectionTypes.js";
import {
  EVOLUTION_SELECTION_STREAM_KEY,
  GeneticOperatorConfig,
  getOffspringStreamKey,
  OffspringLineageMetadata,
} from "../../domain/ai/GeneticOperatorTypes.js";
import {
  BuildNextGenerationParams,
  canonicalOffspringDnaRef,
  DEFAULT_GENERATION_BUILDER_CONFIG,
  GenerationBuilderConfig,
  GenerationBuilderConfigurationError,
  GenerationBuilderExecutionError,
  GenerationBuilderIntegrityError,
  GenerationBuildResult,
} from "../../domain/ai/GenerationBuilderTypes.js";
import { PopulationSelector } from "./PopulationSelector.js";
import { ParentPairAssembler } from "./ParentPairAssembler.js";
import {
  generateOffspring,
  validateGeneticOperatorConfig,
} from "./GeneticOperators.js";
import { DecisionDNACodec } from "./DecisionDNACodec.js";
import { deriveSeed } from "../random/DeterministicShuffle.js";

export class GenerationBuilder {
  /**
   * 次世代母集団スナップショット (Generation g+1) を決定論的に構築
   *
   * @param params 世代交代パラメータ
   * @returns 構築結果 (次世代スナップショットおよびメタデータ)
   */
  public static buildNextGeneration(
    params: BuildNextGenerationParams
  ): GenerationBuildResult {
    // =========================================================================
    // 1. 入力パラメータ & 世代アライメントの検証 (Fail-Fast)
    // =========================================================================
    if (!params || typeof params !== "object") {
      throw new GenerationBuilderConfigurationError(
        "params must be a non-null object"
      );
    }

    const {
      population,
      fitnessSnapshot,
      targetGeneration,
      generationSeed,
      config,
      expectedContext,
    } = params;

    if (!population || typeof population !== "object") {
      throw new GenerationBuilderConfigurationError(
        "population must be a non-null object"
      );
    }

    if (!fitnessSnapshot || typeof fitnessSnapshot !== "object") {
      throw new GenerationBuilderConfigurationError(
        "fitnessSnapshot must be a non-null object"
      );
    }

    if (
      typeof targetGeneration !== "number" ||
      !Number.isFinite(targetGeneration) ||
      !Number.isInteger(targetGeneration) ||
      targetGeneration < 0
    ) {
      throw new GenerationBuilderConfigurationError(
        `targetGeneration must be a finite non-negative integer, received ${targetGeneration}`
      );
    }

    if (
      typeof generationSeed !== "number" ||
      !Number.isFinite(generationSeed) ||
      !Number.isInteger(generationSeed)
    ) {
      throw new GenerationBuilderConfigurationError(
        `generationSeed must be a finite integer, received ${generationSeed}`
      );
    }

    // 世代アライメント検証
    if (population.generation !== fitnessSnapshot.generation) {
      throw new GenerationBuilderConfigurationError(
        `Generation mismatch: population.generation (${population.generation}) !== fitnessSnapshot.generation (${fitnessSnapshot.generation})`
      );
    }

    if (
      !fitnessSnapshot.context ||
      typeof fitnessSnapshot.context !== "object" ||
      fitnessSnapshot.context.generation !== population.generation
    ) {
      throw new GenerationBuilderConfigurationError(
        `Fitness context generation mismatch: expected ${population.generation}, received ${fitnessSnapshot.context?.generation}`
      );
    }

    if (targetGeneration !== population.generation + 1) {
      throw new GenerationBuilderConfigurationError(
        `Target generation mismatch: expected ${population.generation + 1}, received ${targetGeneration}`
      );
    }

    // =========================================================================
    // 2. 設定の解決とバリデーション (Fail-Fast)
    // =========================================================================
    const resolvedPopulationSize =
      config?.populationSize !== undefined
        ? config.populationSize
        : DEFAULT_GENERATION_BUILDER_CONFIG.populationSize;

    if (
      typeof resolvedPopulationSize !== "number" ||
      !Number.isFinite(resolvedPopulationSize) ||
      !Number.isInteger(resolvedPopulationSize) ||
      resolvedPopulationSize < 2
    ) {
      throw new GenerationBuilderConfigurationError(
        `populationSize must be an integer >= 2, received ${resolvedPopulationSize}`
      );
    }

    const resolvedSelectionConfig: PopulationSelectionConfig = {
      ...DEFAULT_GENERATION_BUILDER_CONFIG.selectionConfig,
      ...config?.selectionConfig,
    };

    const resolvedOperatorConfig: GeneticOperatorConfig = {
      ...DEFAULT_GENERATION_BUILDER_CONFIG.geneticOperatorConfig,
      ...config?.geneticOperatorConfig,
    };

    // サブコンポーネント設定検証
    try {
      PopulationSelector.validateConfig(resolvedSelectionConfig);
    } catch (err) {
      throw new GenerationBuilderConfigurationError(
        `Invalid selectionConfig: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    try {
      validateGeneticOperatorConfig(resolvedOperatorConfig);
    } catch (err) {
      throw new GenerationBuilderConfigurationError(
        `Invalid geneticOperatorConfig: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    const eliteCount = resolvedSelectionConfig.eliteCount;
    if (eliteCount >= resolvedPopulationSize) {
      throw new GenerationBuilderConfigurationError(
        `eliteCount (${eliteCount}) must be strictly less than populationSize (${resolvedPopulationSize})`
      );
    }

    const resolvedConfig: GenerationBuilderConfig = {
      populationSize: resolvedPopulationSize,
      selectionConfig: resolvedSelectionConfig,
      geneticOperatorConfig: resolvedOperatorConfig,
    };

    // =========================================================================
    // 3. Preflight Readiness & Effective Readiness Gate (Fail-Closed)
    // =========================================================================
    // eliteCount === 0 の場合でも必ず母集団適格性を判定
    const readiness = PopulationSelector.assessReadiness(
      population,
      fitnessSnapshot,
      resolvedConfig.selectionConfig,
      expectedContext
    );

    if (readiness.status !== "READY") {
      if (readiness.status === "INVALID_POPULATION") {
        throw new GenerationBuilderIntegrityError(
          readiness.reason ?? "Population snapshot integrity check failed"
        );
      }
      throw new GenerationBuilderExecutionError(
        readiness.reason ?? `Selection readiness check failed with status ${readiness.status}`,
        readiness.status
      );
    }

    // Effective Readiness 検査: 有効候補数が eliteCount 以上存在すること
    if (readiness.validCount < eliteCount) {
      throw new GenerationBuilderExecutionError(
        `Insufficient valid candidates for elite selection: required ${eliteCount}, available ${readiness.validCount}`,
        "REEVALUATION_REQUIRED"
      );
    }

    // =========================================================================
    // 4. シード導出 & 親選択 (Single-Series Parent Selection Contract)
    // =========================================================================
    const selectionSeed = deriveSeed(
      generationSeed,
      EVOLUTION_SELECTION_STREAM_KEY
    );

    const offspringCount = resolvedConfig.populationSize - eliteCount;
    const requiredParentsCount = offspringCount * 2;

    const parentSequence: readonly SelectedParent[] =
      requiredParentsCount > 0
        ? PopulationSelector.selectParents(
            requiredParentsCount,
            population,
            fitnessSnapshot,
            resolvedConfig.selectionConfig,
            selectionSeed,
            expectedContext
          )
        : [];

    if (parentSequence.length !== requiredParentsCount) {
      throw new GenerationBuilderIntegrityError(
        `Selected parent count mismatch: expected ${requiredParentsCount}, got ${parentSequence.length}`
      );
    }

    // =========================================================================
    // 5. エリート選出 & アセンブリ (Clone Isolation)
    // =========================================================================
    const eliteEntries: PopulationEntry[] = [];
    const eliteGenomeIds: string[] = [];

    if (eliteCount > 0) {
      const selectedElites = PopulationSelector.selectElites(
        population,
        fitnessSnapshot,
        resolvedConfig.selectionConfig,
        selectionSeed,
        expectedContext
      );

      if (selectedElites.length !== eliteCount) {
        throw new GenerationBuilderIntegrityError(
          `Selected elite count mismatch: expected ${eliteCount}, got ${selectedElites.length}`
        );
      }

      for (const elite of selectedElites) {
        // Clone Isolation: エリート個体の DNA は参照を分離してディープコピー
        const clonedDna = DecisionDNACodec.clone(elite.dna);

        const eliteEntry: PopulationEntry = Object.freeze({
          genomeId: elite.genomeId,
          dnaRef: elite.dnaRef,
          generation: targetGeneration,
          dna: clonedDna,
        });

        eliteEntries.push(eliteEntry);
        eliteGenomeIds.push(elite.genomeId);
      }
    }

    // =========================================================================
    // 6. 子個体ペアリング & 遺伝的操作委譲
    // =========================================================================
    const offspringEntries: PopulationEntry[] = [];
    const offspringLineages: OffspringLineageMetadata[] = [];

    for (let i = 0; i < offspringCount; i++) {
      const parentA = parentSequence[2 * i];
      const parentB = parentSequence[2 * i + 1];

      const offspringSeed = deriveSeed(
        generationSeed,
        getOffspringStreamKey(i)
      );

      // 自己交配検知・回避リトライを含む親ペア組み立て
      const parentPair = ParentPairAssembler.assembleParentPair({
        parentA,
        parentB,
        population,
        fitnessSnapshot,
        offspringSeed,
        selectionConfig: resolvedConfig.selectionConfig,
        operatorConfig: resolvedConfig.geneticOperatorConfig,
        expectedContext,
      });

      // 子個体生成委譲 (Crossover + Mutation)
      const generated = generateOffspring({
        parentPair,
        generation: targetGeneration,
        offspringIndex: i,
        generationSeed,
        config: resolvedConfig.geneticOperatorConfig,
      });

      const offspringDnaRef = canonicalOffspringDnaRef(
        generated.lineage.genomeId
      );

      const offspringEntry: PopulationEntry = Object.freeze({
        genomeId: generated.lineage.genomeId,
        dnaRef: offspringDnaRef,
        generation: targetGeneration,
        dna: generated.dna,
      });

      offspringEntries.push(offspringEntry);
      offspringLineages.push(Object.freeze(generated.lineage));
    }

    // =========================================================================
    // 7. カノニカル出力配列構築 & 最終整合性検証 (Final Integrity Gate)
    // =========================================================================
    // 出力配列順序: [Elites (0..E-1), Offspring (0..M-1)]
    const entries: readonly PopulationEntry[] = [
      ...eliteEntries,
      ...offspringEntries,
    ];

    if (entries.length !== resolvedConfig.populationSize) {
      throw new GenerationBuilderIntegrityError(
        `Final population size mismatch: expected ${resolvedConfig.populationSize}, got ${entries.length}`
      );
    }

    if (eliteEntries.length !== eliteCount) {
      throw new GenerationBuilderIntegrityError(
        `Elite count mismatch: expected ${eliteCount}, got ${eliteEntries.length}`
      );
    }

    if (offspringEntries.length !== offspringCount) {
      throw new GenerationBuilderIntegrityError(
        `Offspring count mismatch: expected ${offspringCount}, got ${offspringEntries.length}`
      );
    }

    const seenGenomeIds = new Set<string>();

    for (const entry of entries) {
      if (entry.generation !== targetGeneration) {
        throw new GenerationBuilderIntegrityError(
          `Entry generation mismatch for ${entry.genomeId}: expected ${targetGeneration}, got ${entry.generation}`
        );
      }

      if (seenGenomeIds.has(entry.genomeId)) {
        throw new GenerationBuilderIntegrityError(
          `Duplicate genomeId detected in assembled population: ${entry.genomeId}`
        );
      }
      seenGenomeIds.add(entry.genomeId);

      // DecisionDNA の厳格なバリデーション
      try {
        DecisionDNACodec.validate(entry.dna);
      } catch (err) {
        throw new GenerationBuilderIntegrityError(
          `DecisionDNA validation failed for ${entry.genomeId}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // =========================================================================
    // 8. イミュータブルな出力アセンブリ
    // =========================================================================
    const nextPopulation: PopulationSnapshot = Object.freeze({
      generation: targetGeneration,
      entries: Object.freeze(entries),
    });

    return Object.freeze({
      population: nextPopulation,
      sourceGeneration: population.generation,
      targetGeneration,
      generationSeed,
      selectionSeed,
      populationSize: resolvedConfig.populationSize,
      eliteCount,
      offspringCount,
      eliteGenomeIds: Object.freeze(eliteGenomeIds),
      offspringLineages: Object.freeze(offspringLineages),
    });
  }
}
