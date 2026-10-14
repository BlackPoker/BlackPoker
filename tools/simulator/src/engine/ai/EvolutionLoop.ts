/**
 * Evolution Loop V1 Engine (BP-SIM-AI-EVOLUTION-LOOP-DESIGN-V1-R2 / BP-SIM-AI-EVOLUTION-LOOP-V1)
 *
 * BlackPoker Simulator AI基盤における複数世代進化ループ統括エンジン。
 * GenerationRunner を 1 世代実行プリミティブとして順次呼び出し、
 * 世代間チェーン整合性検証、決定論的シードスケジュール、および論理停止を Fail-Closed に統括する。
 *
 * 設計仕様: tools/simulator/docs/ai-evolution-loop-design-v1.md
 *
 * 最重要設計原則:
 * 1. GenerationRunner への一元委譲 ("One Generation Only" 境界の厳格な維持)
 * 2. 決定論性 (campaignSeed と sourceGeneration による直接シード導出、前世代シード非連鎖)
 * 3. 疎結合な Public Logical Contract (オブジェクト参照同一性への非依存、Variable N 合法)
 * 4. REEVALUATION_REQUIRED 時の即時論理停止 (自動リトライ排除)
 * 5. Runner エラーの完全透過伝搬 (同一エラーインスタンスの throw)
 * 6. メモリ爆発防止 (世代履歴レコードからの中間 PopulationSnapshot 排除、finalPopulation のみ保持)
 * 7. 論理結果と実行時メトリクス Sidecar の完全分離
 * 8. 世代間 Fitness 比較・改善率計算・早期終了の排除
 */

import {
  EvolutionGenerationRecord,
  EvolutionGenerationRuntimeRecord,
  EvolutionLoopCompletedResult,
  EvolutionLoopConfigurationError,
  EvolutionLoopExecutionResult,
  EvolutionLoopIntegrityError,
  EvolutionLoopManifest,
  EvolutionLoopReevaluationRequiredResult,
  RunEvolutionLoopParams,
  canonicalGenerationStreamKey,
  canonicalLoopSeedScheduleIdentity,
} from "../../domain/ai/EvolutionLoopTypes";
import { GenerationRunner } from "./GenerationRunner";
import { deriveSeed } from "../random/DeterministicShuffle";

export class EvolutionLoop {
  /**
   * 複数世代の自己対戦進化ループを決定論的・Fail-Closed に順次実行します。
   *
   * @param params 進化ループ実行パラメータ
   * @returns 総合実行結果 (決定論的論理結果 + 実行時メトリクス)
   * @throws EvolutionLoopConfigurationError ループ固有の静的設定が不正な場合
   * @throws EvolutionLoopIntegrityError 世代チェーン整合性契約に違反した場合
   * @throws GenerationRunnerError Runner から発生した例外 (そのまま透過)
   */
  public static run(params: RunEvolutionLoopParams): EvolutionLoopExecutionResult {
    const startTime = Date.now();

    // =========================================================================
    // 1. ループ静的入力パラメータの Fail-Fast 検証
    // =========================================================================
    if (!params || typeof params !== "object") {
      throw new EvolutionLoopConfigurationError("params must be a valid non-null object");
    }

    if (!params.config || typeof params.config !== "object") {
      throw new EvolutionLoopConfigurationError("params.config must be a valid non-null object");
    }

    // 1.1 generationCount の検証 (有限整数 >= 1, 0/負数/小数/NaN/Infinity は拒絶)
    const { generationCount } = params.config;
    if (
      typeof generationCount !== "number" ||
      !Number.isFinite(generationCount) ||
      !Number.isInteger(generationCount) ||
      generationCount < 1
    ) {
      throw new EvolutionLoopConfigurationError(
        `config.generationCount must be an integer >= 1, received ${generationCount}`
      );
    }

    // 1.2 campaignSeed の検証 (有限整数, 0/負数/正数 合法, 小数/NaN/Infinity は拒絶)
    const { campaignSeed } = params;
    if (
      typeof campaignSeed !== "number" ||
      !Number.isFinite(campaignSeed) ||
      !Number.isInteger(campaignSeed)
    ) {
      throw new EvolutionLoopConfigurationError(
        `campaignSeed must be a finite integer, received ${campaignSeed}`
      );
    }

    // 1.3 initialPopulation の初期世代番号および目標世代の安全な整数検証
    if (!params.initialPopulation || typeof params.initialPopulation !== "object") {
      throw new EvolutionLoopConfigurationError(
        "params.initialPopulation must be a valid non-null object"
      );
    }

    const initialGeneration = params.initialPopulation.generation;
    if (
      typeof initialGeneration !== "number" ||
      !Number.isFinite(initialGeneration) ||
      !Number.isInteger(initialGeneration) ||
      initialGeneration < 0
    ) {
      throw new EvolutionLoopConfigurationError(
        `initialPopulation.generation must be a non-negative integer, received ${initialGeneration}`
      );
    }

    const requestedTransitions = generationCount;
    const targetGeneration = initialGeneration + requestedTransitions;

    if (!Number.isSafeInteger(targetGeneration)) {
      throw new EvolutionLoopConfigurationError(
        `targetGeneration (${targetGeneration}) exceeds Number.MAX_SAFE_INTEGER`
      );
    }

    // =========================================================================
    // 2. ループ論理マニフェスト構築
    // =========================================================================
    const manifest: EvolutionLoopManifest = {
      initialGeneration,
      requestedTransitions,
      targetGeneration,
      campaignSeed,
      generationSeedScheduleIdentity: canonicalLoopSeedScheduleIdentity(campaignSeed),
    };

    let currentPopulation = params.initialPopulation;
    const generationRecords: EvolutionGenerationRecord[] = [];
    const runtimeRecords: EvolutionGenerationRuntimeRecord[] = [];

    // =========================================================================
    // 3. 世代遷移順次実行ループ
    // =========================================================================
    for (let stepIndex = 0; stepIndex < requestedTransitions; stepIndex++) {
      const sourceGeneration = currentPopulation.generation;
      const generationSeed = deriveSeed(
        campaignSeed,
        canonicalGenerationStreamKey(sourceGeneration)
      );

      // GenerationRunner.run 呼出 (One-Generation Primitive)
      // runnerConfig, environment, sessionFactory は caller 指定の参照をそのまま無改変で渡す
      const runnerResult = GenerationRunner.run({
        population: currentPopulation,
        generationSeed,
        environment: params.environment,
        sessionFactory: params.sessionFactory,
        config: params.config.runnerConfig,
      });

      const { logicalResult, runtimeMetrics } = runnerResult;

      // 共通チェーン整合性の検証 (Manifest & FitnessSnapshot の世代一致)
      if (logicalResult.manifest.generation !== sourceGeneration) {
        throw new EvolutionLoopIntegrityError(
          `Manifest generation mismatch: expected ${sourceGeneration}, received ${logicalResult.manifest.generation}`
        );
      }

      if (logicalResult.fitnessSnapshot.generation !== sourceGeneration) {
        throw new EvolutionLoopIntegrityError(
          `FitnessSnapshot generation mismatch: expected ${sourceGeneration}, received ${logicalResult.fitnessSnapshot.generation}`
        );
      }

      // 実行時レコードの記録 (Sidecar)
      runtimeRecords.push({
        stepIndex,
        sourceGeneration,
        generationSeed,
        runnerMetrics: runtimeMetrics,
      });

      // 3.1 REEVALUATION_REQUIRED 検知時の即時論理停止
      if (logicalResult.status === "REEVALUATION_REQUIRED") {
        generationRecords.push({
          status: "REEVALUATION_REQUIRED",
          stepIndex,
          sourceGeneration,
          generationSeed,
          manifest: logicalResult.manifest,
          fitnessSnapshot: logicalResult.fitnessSnapshot,
          reason: logicalResult.reason,
          readiness: logicalResult.readiness,
        });

        const loopLogicalResult: EvolutionLoopReevaluationRequiredResult = {
          status: "REEVALUATION_REQUIRED",
          manifest,
          completedTransitions: stepIndex,
          finalPopulation: currentPopulation,
          generations: generationRecords,
          reason: logicalResult.reason,
          readiness: logicalResult.readiness,
        };

        return {
          logicalResult: loopLogicalResult,
          runtimeMetrics: {
            totalExecutionTimeMs: Date.now() - startTime,
            generations: runtimeRecords,
          },
        };
      }

      // 3.2 ADVANCED 正常遷移時のチェーン整合性検証
      const { nextPopulation, buildResult } = logicalResult;

      if (nextPopulation.generation !== sourceGeneration + 1) {
        throw new EvolutionLoopIntegrityError(
          `Next population generation mismatch: expected ${sourceGeneration + 1}, received ${nextPopulation.generation}`
        );
      }

      if (buildResult.sourceGeneration !== sourceGeneration) {
        throw new EvolutionLoopIntegrityError(
          `BuildResult sourceGeneration mismatch: expected ${sourceGeneration}, received ${buildResult.sourceGeneration}`
        );
      }

      if (buildResult.targetGeneration !== sourceGeneration + 1) {
        throw new EvolutionLoopIntegrityError(
          `BuildResult targetGeneration mismatch: expected ${sourceGeneration + 1}, received ${buildResult.targetGeneration}`
        );
      }

      if (buildResult.populationSize !== nextPopulation.entries.length) {
        throw new EvolutionLoopIntegrityError(
          `BuildResult populationSize (${buildResult.populationSize}) does not match nextPopulation.entries.length (${nextPopulation.entries.length})`
        );
      }

      // 世代履歴レコードの記録 (中間 PopulationSnapshot は保持せず buildMetadata のみ投影)
      generationRecords.push({
        status: "ADVANCED",
        stepIndex,
        sourceGeneration,
        targetGeneration: nextPopulation.generation,
        generationSeed,
        manifest: logicalResult.manifest,
        fitnessSnapshot: logicalResult.fitnessSnapshot,
        buildMetadata: {
          sourceGeneration: buildResult.sourceGeneration,
          targetGeneration: buildResult.targetGeneration,
          generationSeed: buildResult.generationSeed,
          selectionSeed: buildResult.selectionSeed,
          populationSize: buildResult.populationSize,
          eliteCount: buildResult.eliteCount,
          offspringCount: buildResult.offspringCount,
          eliteGenomeIds: buildResult.eliteGenomeIds,
          offspringLineages: buildResult.offspringLineages,
        },
      });

      // 次世代母集団へ更新 (Authoritative Source: logicalResult.nextPopulation)
      currentPopulation = nextPopulation;
    }

    // =========================================================================
    // 4. 全世代正常完了結果の返却 (COMPLETED)
    // =========================================================================
    const loopLogicalResult: EvolutionLoopCompletedResult = {
      status: "COMPLETED",
      manifest,
      completedTransitions: requestedTransitions,
      finalPopulation: currentPopulation,
      generations: generationRecords,
    };

    return {
      logicalResult: loopLogicalResult,
      runtimeMetrics: {
        totalExecutionTimeMs: Date.now() - startTime,
        generations: runtimeRecords,
      },
    };
  }
}
