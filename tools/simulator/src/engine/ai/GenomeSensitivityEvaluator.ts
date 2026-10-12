import { DecisionRequest } from "../../domain/decision/DecisionRequest";
import { DecisionDNA } from "../../domain/ai/DecisionDNATypes";
import {
  DecisionSensitivityComparison,
  GENOME_SENSITIVITY_RESULT_VERSION,
  GenomeSensitivityEvaluationOptions,
  GenomeSensitivityLogicalResult,
  GenomeSensitivityResult,
  GenomeSensitivityStatus,
  MatchBehaviorSeparationSummary,
  ScoredPatternComparison,
} from "../../domain/ai/GenomeSensitivityTypes";
import { PolicyExperimentParticipant, PolicyExperimentResult } from "../../domain/ai/PolicyExperimentTypes";
import { FEATURE_SCHEMA_VERSION } from "../../domain/ai/DecisionFeatureTypes";
import { DNA_FORMAT_VERSION, SCORING_MODEL_V1 } from "../../domain/ai/DecisionDNATypes";
import { DecisionDNACodec } from "./DecisionDNACodec";
import { DecisionFeatureEncoder } from "./DecisionFeatureEncoder";
import { GenomeScorer } from "./GenomeScorer";
import { GenomePolicy } from "./GenomePolicy";
import { PolicyExperimentRunner } from "./PolicyExperimentRunner";

/**
 * Decision Feature Schema v4 / Decision DNA v1 / GenomePolicy における
 * Genome Sensitivity および Policy Separability を評価する決定論的評価器。
 *
 * 【最重要設計原則】
 * 1. 第二のシミュレーションループを作らない:
 *    対戦評価は既存の PolicyExperimentRunner.run() -> BatchSimulationRunner.run() 経路を完全再利用します。
 * 2. 意思決定ロジックの非複製:
 *    特徴量エンコードは DecisionFeatureEncoder.encode()、スコアリングは GenomeScorer.score()、
 *    選択契約は GenomePolicy (Argmax + 最小 patternRef タイブレーク) の既存実装を使用します。
 * 3. 決定論性 & 秘匿性の維持:
 *    ランタイム GUID や日付、RNG 等の可変要素を Logical Result に含めず、同一入力に対し完全に同一の出力を返します。
 */
export class GenomeSensitivityEvaluator {
  public static readonly VERSION = GENOME_SENSITIVITY_RESULT_VERSION;

  /**
   * 同一 DecisionRequest に対する 2 つの DNA のスコアおよび選択を比較
   */
  public static compareDecision(
    request: Readonly<DecisionRequest>,
    dnaA: Readonly<DecisionDNA>,
    dnaB: Readonly<DecisionDNA>
  ): DecisionSensitivityComparison {
    DecisionDNACodec.validate(dnaA);
    DecisionDNACodec.validate(dnaB);

    const patterns = request.patterns;
    if (!patterns || patterns.length === 0) {
      throw new Error(`DecisionRequest に合法パターンが存在しません: ${request.decisionId}`);
    }

    // 1. 合法観測から特徴量ベクトルをエンコード
    const encodedFeatures = DecisionFeatureEncoder.encode(request);

    // 2. GenomeScorer で DNA A / DNA B それぞれの合法手スコアを計算
    const scoredA = GenomeScorer.score(encodedFeatures, dnaA);
    const scoredB = GenomeScorer.score(encodedFeatures, dnaB);

    // 3. GenomePolicy と同一契約の決定論的 Argmax (タイブレーク: 最小 patternRef)
    let bestScoreA = -Infinity;
    let bestPatternRefA = scoredA[0].patternRef;
    let bestLogicalKeyA = scoredA[0].logicalPatternKey;

    for (let i = 0; i < scoredA.length; i++) {
      const p = scoredA[i];
      if (p.score > bestScoreA) {
        bestScoreA = p.score;
        bestPatternRefA = p.patternRef;
        bestLogicalKeyA = p.logicalPatternKey;
      }
    }

    let bestScoreB = -Infinity;
    let bestPatternRefB = scoredB[0].patternRef;
    let bestLogicalKeyB = scoredB[0].logicalPatternKey;

    for (let i = 0; i < scoredB.length; i++) {
      const p = scoredB[i];
      if (p.score > bestScoreB) {
        bestScoreB = p.score;
        bestPatternRefB = p.patternRef;
        bestLogicalKeyB = p.logicalPatternKey;
      }
    }

    // 4. パターンごとのスコア差分と統計量を集計
    const patternComparisons: ScoredPatternComparison[] = [];
    let differingScoreCount = 0;
    let maxAbsDelta = 0;
    let sumAbsDelta = 0;

    for (let i = 0; i < scoredA.length; i++) {
      const pA = scoredA[i];
      const pB = scoredB[i];
      const delta = pB.score - pA.score;
      const absDelta = Math.abs(delta);

      if (delta !== 0) {
        differingScoreCount++;
      }
      if (absDelta > maxAbsDelta) {
        maxAbsDelta = absDelta;
      }
      sumAbsDelta += absDelta;

      patternComparisons.push({
        patternRef: pA.patternRef,
        kind: pA.kind,
        logicalPatternKey: pA.logicalPatternKey,
        scoreA: pA.score,
        scoreB: pB.score,
        scoreDelta: delta,
      });
    }

    const meanAbsDelta = scoredA.length > 0 ? sumAbsDelta / scoredA.length : 0;

    const dnaARef = {
      id: dnaA.metadata?.id ?? "dnaA",
      name: dnaA.metadata?.name ?? "Genome A",
      artifactRef: dnaA.metadata?.id ? `dna:artifact:${dnaA.metadata.id}` : undefined,
    };
    const dnaBRef = {
      id: dnaB.metadata?.id ?? "dnaB",
      name: dnaB.metadata?.name ?? "Genome B",
      artifactRef: dnaB.metadata?.id ? `dna:artifact:${dnaB.metadata.id}` : undefined,
    };

    return {
      requestSummary: {
        viewerPlayerId: request.observation.viewerPlayerId,
        turnPlayerId: request.observation.turnPlayerId,
        chancePlayerId: request.observation.chancePlayerId,
        sourceType: request.source.type,
        turnCount: request.observation.turnCount,
        legalPatternCount: patterns.length,
      },
      dnaA: dnaARef,
      dnaB: dnaBRef,
      patterns: patternComparisons,
      selectedPatternRefA: bestPatternRefA,
      selectedPatternRefB: bestPatternRefB,
      selectedLogicalPatternKeyA: bestLogicalKeyA,
      selectedLogicalPatternKeyB: bestLogicalKeyB,
      selectionSeparated: bestPatternRefA !== bestPatternRefB,
      differingScoreCount,
      maxAbsoluteScoreDelta: maxAbsDelta,
      meanAbsoluteScoreDelta: meanAbsDelta,
    };
  }

  /**
   * 既存の PolicyExperimentRunner を使用して Seat Swap 対戦を実行し、Generic 行動分離を評価
   */
  public static evaluatePolicySeparability(
    options: GenomeSensitivityEvaluationOptions
  ): {
    experimentResult: PolicyExperimentResult;
    matchBehaviorSummary: MatchBehaviorSeparationSummary;
  } {
    const idA = options.dnaA.metadata?.id ?? "genome-pA";
    const nameA = options.participantAName ?? options.dnaA.metadata?.name ?? "Genome A";
    const idB = options.dnaB.metadata?.id ?? "genome-pB";
    const nameB = options.participantBName ?? options.dnaB.metadata?.name ?? "Genome B";

    if (idA === idB) {
      throw new Error(`Participant A と B の ID が重複しています: ${idA}`);
    }

    const participantA: PolicyExperimentParticipant = {
      id: idA,
      name: nameA,
      artifactRef: `dna:artifact:${idA}`,
      policyFactory: () => new GenomePolicy(options.dnaA, nameA),
    };

    const participantB: PolicyExperimentParticipant = {
      id: idB,
      name: nameB,
      artifactRef: `dna:artifact:${idB}`,
      policyFactory: () => new GenomePolicy(options.dnaB, nameB),
    };

    const experimentResult = PolicyExperimentRunner.run({
      experimentId: options.experimentId,
      environmentRef: options.environmentRef,
      baseSeed: options.baseSeed,
      matchesPerSeat: options.matchesPerSeat,
      maxDecisionsPerMatch: options.maxDecisionsPerMatch,
      participantA,
      participantB,
      sessionFactory: options.sessionFactory,
    });

    const behA = experimentResult.behavior[idA];
    const behB = experimentResult.behavior[idB];
    const otherRateA =
      behA.totalObservedDecisions > 0 ? behA.otherSelections / behA.totalObservedDecisions : 0;
    const otherRateB =
      behB.totalObservedDecisions > 0 ? behB.otherSelections / behB.totalObservedDecisions : 0;

    const actionRateDelta = behB.actionSelectionRate - behA.actionSelectionRate;
    const passRateDelta = behB.passSelectionRate - behA.passSelectionRate;
    const effectSelectionRateDelta = behB.effectSelectionRate - behA.effectSelectionRate;
    const otherRateDelta = otherRateB - otherRateA;

    const behaviorSeparated =
      actionRateDelta !== 0 ||
      passRateDelta !== 0 ||
      effectSelectionRateDelta !== 0 ||
      otherRateDelta !== 0;

    const matchBehaviorSummary: MatchBehaviorSeparationSummary = {
      participantAId: idA,
      participantBId: idB,
      metricsA: {
        totalObservedDecisions: behA.totalObservedDecisions,
        actionSelections: behA.actionSelections,
        passSelections: behA.passSelections,
        effectSelections: behA.effectSelections,
        otherSelections: behA.otherSelections,
        actionSelectionRate: behA.actionSelectionRate,
        passSelectionRate: behA.passSelectionRate,
        effectSelectionRate: behA.effectSelectionRate,
        otherSelectionRate: otherRateA,
      },
      metricsB: {
        totalObservedDecisions: behB.totalObservedDecisions,
        actionSelections: behB.actionSelections,
        passSelections: behB.passSelections,
        effectSelections: behB.effectSelections,
        otherSelections: behB.otherSelections,
        actionSelectionRate: behB.actionSelectionRate,
        passSelectionRate: behB.passSelectionRate,
        effectSelectionRate: behB.effectSelectionRate,
        otherSelectionRate: otherRateB,
      },
      actionRateDelta,
      passRateDelta,
      effectSelectionRateDelta,
      otherRateDelta,
      behaviorSeparated,
    };

    return {
      experimentResult,
      matchBehaviorSummary,
    };
  }

  /**
   * 単一回の Logical Result を生成する内部関数
   */
  private static runSingleLogicalEvaluation(
    options: GenomeSensitivityEvaluationOptions
  ): GenomeSensitivityLogicalResult {
    let decisionComparison: DecisionSensitivityComparison | undefined;
    if (options.sampleRequest) {
      decisionComparison = this.compareDecision(options.sampleRequest, options.dnaA, options.dnaB);
    }

    const { experimentResult, matchBehaviorSummary } = this.evaluatePolicySeparability(options);

    const idA = options.dnaA.metadata?.id ?? "genome-pA";
    const nameA = options.participantAName ?? options.dnaA.metadata?.name ?? "Genome A";
    const idB = options.dnaB.metadata?.id ?? "genome-pB";
    const nameB = options.participantBName ?? options.dnaB.metadata?.name ?? "Genome B";

    const outcomeA = experimentResult.summary.participants[idA];
    const outcomeB = experimentResult.summary.participants[idB];

    const decisionSeparated = decisionComparison ? decisionComparison.selectionSeparated : false;
    const matchBehaviorSeparated = matchBehaviorSummary.behaviorSeparated;

    // FAILED 試合が存在する場合は fail-closed で INSUFFICIENT_EVIDENCE
    let overallStatus: GenomeSensitivityStatus = "INSUFFICIENT_EVIDENCE";
    if (experimentResult.summary.totalFailedMatches > 0) {
      overallStatus = "INSUFFICIENT_EVIDENCE";
    } else if (decisionSeparated && matchBehaviorSeparated) {
      overallStatus = "POLICY_SEPARABLE";
    } else if (!decisionSeparated && !matchBehaviorSeparated) {
      overallStatus = "NOT_SEPARABLE";
    }

    return {
      version: GENOME_SENSITIVITY_RESULT_VERSION,
      featureSchemaVersion: FEATURE_SCHEMA_VERSION,
      dnaFormatVersion: DNA_FORMAT_VERSION,
      scoringModel: SCORING_MODEL_V1,
      environmentRef: options.environmentRef,
      baseSeed: options.baseSeed,
      matchesPerSeat: options.matchesPerSeat,
      dnaA: { id: idA, name: nameA, artifactRef: `dna:artifact:${idA}` },
      dnaB: { id: idB, name: nameB, artifactRef: `dna:artifact:${idB}` },
      decisionComparison,
      experimentSummary: experimentResult.summary,
      outcomeA,
      outcomeB,
      matchBehaviorSummary,
      decisionSeparated,
      matchBehaviorSeparated,
      deterministic: true,
      overallStatus,
    };
  }

  /**
   * 総合 Genome Sensitivity 評価を実行 (同一設定での 2 回実行による決定論性検証を含む)
   */
  public static runFullSensitivityEvaluation(
    options: GenomeSensitivityEvaluationOptions
  ): GenomeSensitivityResult {
    const startTime = performance.now();

    // 1 回目実行
    const logical1 = this.runSingleLogicalEvaluation(options);

    // 2 回目実行 (決定論性検証)
    const logical2 = this.runSingleLogicalEvaluation(options);

    const json1 = JSON.stringify(logical1);
    const json2 = JSON.stringify(logical2);
    const deterministic = json1 === json2;

    let overallStatus: GenomeSensitivityStatus = "INSUFFICIENT_EVIDENCE";
    if (logical1.experimentSummary.totalFailedMatches > 0) {
      overallStatus = "INSUFFICIENT_EVIDENCE";
    } else if (deterministic) {
      if (logical1.decisionSeparated && logical1.matchBehaviorSeparated) {
        overallStatus = "POLICY_SEPARABLE";
      } else if (!logical1.decisionSeparated && !logical1.matchBehaviorSeparated) {
        overallStatus = "NOT_SEPARABLE";
      }
    } else {
      overallStatus = "INSUFFICIENT_EVIDENCE";
    }

    const finalLogicalResult: GenomeSensitivityLogicalResult = {
      ...logical1,
      deterministic,
      overallStatus,
    };

    const endTime = performance.now();
    const runtimeMetrics = {
      executionDurationMs: Math.round(endTime - startTime),
    };

    return {
      logicalResult: finalLogicalResult,
      runtimeMetrics,
    };
  }
}
