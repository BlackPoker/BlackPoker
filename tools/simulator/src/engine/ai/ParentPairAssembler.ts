/**
 * Parent Pair Assembler (BP-SIM-AI-GENETIC-OPERATORS-DESIGN-V1-R2 / BP-SIM-AI-GENETIC-OPERATORS-V1)
 *
 * 選出された親候補から親ペア（GeneticParentPair）を組み立て、自己交配（Self-Mating）を検知・回避するアセンブラ。
 *
 * 契約規約:
 * 1. 責務境界: Selection レイヤの親候補選出結果を受け取り、ペアリングおよび自己交配回避リトライを統括。
 *    Crossover レイヤ側では親の再選択を一切行わない。
 * 2. 自己交配検知: parentA.genomeId === parentB.genomeId の場合、有効候補数 (validCount) が 2 以上なら親 B を再選択。
 * 3. 独立リトライストリーム: deriveSeed(offspringSeed, `evolution-self-mating-retry-v1-${retryIndex}`) により、
 *    Crossover / Mutation の乱数消費列を一切消費・汚染しない。
 * 4. リトライ枯渇時の受容: 最大リトライ (maxSelfMatingRetries: default 3) を使い切っても同一個体が選ばれ続けた場合、
 *    例外停止せず自己交配を受容 (Fail-Closed 原則を維持し、INSUFFICIENT / INVALID へのフォールバック禁止)。
 */

import {
  GeneticParentPair,
  GeneticOperatorConfig,
  DEFAULT_GENETIC_OPERATOR_CONFIG,
  GeneticOperatorError,
  GeneticOperatorConfigurationError,
  getSelfMatingRetryStreamKey,
} from "../../domain/ai/GeneticOperatorTypes";
import {
  PopulationSnapshot,
  FitnessEvaluationSnapshot,
  PopulationSelectionConfig,
  DEFAULT_POPULATION_SELECTION_CONFIG,
  SelectedParent,
  ComparableEvaluationContext,
} from "../../domain/ai/PopulationSelectionTypes";
import { PopulationSelector } from "./PopulationSelector";
import { deriveSeed } from "../random/DeterministicShuffle";

/**
 * 親ペア組み立てパラメータ
 */
export interface AssembleParentPairParams {
  readonly parentA: SelectedParent;
  readonly parentB: SelectedParent;
  readonly population?: PopulationSnapshot;
  readonly fitnessSnapshot?: FitnessEvaluationSnapshot;
  readonly offspringSeed: number;
  readonly selectionConfig?: Partial<PopulationSelectionConfig>;
  readonly operatorConfig?: Partial<GeneticOperatorConfig>;
  readonly expectedContext?: ComparableEvaluationContext;
}

export class ParentPairAssembler {
  /**
   * maxSelfMatingRetries の厳格なバリデーションと解決 (Fail-Fast)
   */
  private static resolveMaxSelfMatingRetries(
    config?: Partial<GeneticOperatorConfig>
  ): number {
    const value =
      config?.maxSelfMatingRetries !== undefined
        ? config.maxSelfMatingRetries
        : DEFAULT_GENETIC_OPERATOR_CONFIG.maxSelfMatingRetries;

    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      !Number.isInteger(value) ||
      value < 0
    ) {
      throw new GeneticOperatorConfigurationError(
        `Invalid maxSelfMatingRetries: must be a non-negative integer, received ${value}`
      );
    }
    return value;
  }

  /**
   * 単純な親ペアの生成（自己交配リトライを行わない直接生成）
   */
  public static createPair(
    parentA: SelectedParent,
    parentB: SelectedParent
  ): GeneticParentPair {
    if (!parentA || !parentB) {
      throw new GeneticOperatorError(
        "ParentPairAssembler: parentA and parentB must be non-null SelectedParent objects."
      );
    }
    return Object.freeze({
      parentA,
      parentB,
    });
  }

  /**
   * 自己交配回避リトライを含む決定論的親ペアの組み立て
   */
  public static assembleParentPair(
    params: AssembleParentPairParams
  ): GeneticParentPair {
    if (!params || typeof params !== "object") {
      throw new GeneticOperatorError(
        "ParentPairAssembler: params must be a valid object."
      );
    }

    const { parentA, parentB, offspringSeed } = params;

    if (!parentA || !parentB) {
      throw new GeneticOperatorError(
        "ParentPairAssembler: parentA and parentB must be provided."
      );
    }

    if (typeof offspringSeed !== "number" || !Number.isFinite(offspringSeed)) {
      throw new GeneticOperatorError(
        `ParentPairAssembler: offspringSeed must be a finite number, received ${offspringSeed}`
      );
    }

    // operatorConfig の maxSelfMatingRetries を即座に Fail-Fast バリデーション
    const maxRetries = ParentPairAssembler.resolveMaxSelfMatingRetries(
      params.operatorConfig
    );

    // 1. 同一ゲノムIDでない場合はそのままペア確定
    if (parentA.genomeId !== parentB.genomeId) {
      return Object.freeze({
        parentA,
        parentB,
      });
    }

    // 2. 自己交配（parentA.genomeId === parentB.genomeId）の検知
    // 母集団スナップショットおよび適応度スナップショットが存在しない場合はそのまま自己交配受容
    if (!params.population || !params.fitnessSnapshot) {
      return Object.freeze({
        parentA,
        parentB,
      });
    }

    // 3. 母集団・適応度スナップショットの整合性判定
    const readiness = PopulationSelector.assessReadiness(
      params.population,
      params.fitnessSnapshot,
      params.selectionConfig,
      params.expectedContext
    );

    // INVALID_POPULATION または INCOMPARABLE_EVALUATION の場合は黙って飲み込まず Fail-Closed
    if (readiness.status === "INVALID_POPULATION") {
      throw new GeneticOperatorError(
        `ParentPairAssembler: Population snapshot is invalid: ${
          readiness.reason ?? "Unknown integrity error"
        }`
      );
    }

    if (readiness.status === "INCOMPARABLE_EVALUATION") {
      throw new GeneticOperatorError(
        `ParentPairAssembler: Incomparable evaluation context: ${
          readiness.reason ?? "Evaluation context mismatch"
        }`
      );
    }

    // 有効個体数が 2 未満の場合は再選択しても別個体を選びようがないため、そのまま自己交配受容
    if (readiness.validCount < 2) {
      return Object.freeze({
        parentA,
        parentB,
      });
    }

    // 4. Retry 専用の effective selection config 構築
    // validCount >= 2 であれば、たとえ Standard Selection が REEVALUATION_REQUIRED であっても Retry を試行可能
    const configuredTournamentSize =
      params.selectionConfig?.tournamentSize !== undefined
        ? params.selectionConfig.tournamentSize
        : DEFAULT_POPULATION_SELECTION_CONFIG.tournamentSize;

    const effectiveTournamentSize = Math.max(
      2,
      Math.min(configuredTournamentSize, readiness.validCount)
    );

    const retrySelectionConfig: PopulationSelectionConfig = Object.freeze({
      ...DEFAULT_POPULATION_SELECTION_CONFIG,
      ...params.selectionConfig,
      tournamentSize: effectiveTournamentSize,
      minimumValidPopulationCount: 2,
    });

    let selectedParentB = parentB;

    for (let retryIndex = 0; retryIndex < maxRetries; retryIndex++) {
      const retryStreamKey = getSelfMatingRetryStreamKey(retryIndex);
      const retrySeed = deriveSeed(offspringSeed, retryStreamKey);

      const candidateB = PopulationSelector.selectParent(
        params.population,
        params.fitnessSnapshot,
        retrySelectionConfig,
        retrySeed,
        params.expectedContext
      );

      if (candidateB.genomeId !== parentA.genomeId) {
        selectedParentB = candidateB;
        break; // 別個体が選出されたためリトライ成功
      }
    }

    // 5. リトライ枯渇時も例外停止せず、自己交配を受容 (親クローン + 変異モデル)
    return Object.freeze({
      parentA,
      parentB: selectedParentB,
    });
  }
}
