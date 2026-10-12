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
  getSelfMatingRetryStreamKey,
} from "../../domain/ai/GeneticOperatorTypes";
import {
  PopulationSnapshot,
  FitnessEvaluationSnapshot,
  PopulationSelectionConfig,
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

    // 3. 適格候補数の確認 (validCount >= 2 かどうか)
    const readiness = PopulationSelector.assessReadiness(
      params.population,
      params.fitnessSnapshot,
      params.selectionConfig,
      params.expectedContext
    );

    // 有効個体数が 2 未満の場合は再選択しても別個体を選びようがないため、そのまま自己交配受容
    if (readiness.status !== "READY" || readiness.validCount < 2) {
      return Object.freeze({
        parentA,
        parentB,
      });
    }

    // 4. 独立リトライストリームによる親 B の再選択
    const maxRetries =
      params.operatorConfig?.maxSelfMatingRetries !== undefined
        ? params.operatorConfig.maxSelfMatingRetries
        : DEFAULT_GENETIC_OPERATOR_CONFIG.maxSelfMatingRetries;

    let selectedParentB = parentB;

    for (let retryIndex = 0; retryIndex < maxRetries; retryIndex++) {
      const retryStreamKey = getSelfMatingRetryStreamKey(retryIndex);
      const retrySeed = deriveSeed(offspringSeed, retryStreamKey);

      const candidateB = PopulationSelector.selectParent(
        params.population,
        params.fitnessSnapshot,
        params.selectionConfig,
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
