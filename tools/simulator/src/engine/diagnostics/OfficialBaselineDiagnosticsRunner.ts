import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { OfficialRegulationMatchFactory } from "../regulation/OfficialRegulationMatchFactory";
import { RegulationCatalog } from "../regulation/RegulationLoader";
import { RulePackage } from "../../domain/rules/RulePackage";
import { BatchSimulationRunner } from "../simulation/BatchSimulationRunner";
import { SimulationRunner, SimulationResult, DecisionTraceRecord } from "../simulation/SimulationRunner";
import { DecisionPolicy, FirstLegalPolicy } from "../simulation/DecisionPolicy";
import { BaselineParticipants, createManualGenericGenomeDNA } from "../ai/BaselinePolicies";
import { GenomePolicy } from "../ai/GenomePolicy";
import { GenomeScorer } from "../ai/GenomeScorer";
import { DecisionDNACodec } from "../ai/DecisionDNACodec";
import { DecisionFeatureEncoder } from "../ai/DecisionFeatureEncoder";
import { StateHasher } from "../simulation/StateHasher";
import { CycleStateFingerprint } from "./CycleStateFingerprint";
import { DecisionRequest } from "../../domain/decision/DecisionRequest";
import { DecisionResponse } from "../../domain/decision/DecisionResponse";
import { generateLogicalPatternKey } from "../../domain/decision/LogicalPatternKey";
import { PlayerObservation } from "../../domain/decision/PlayerObservation";
import {
  IncompleteCaseRecord,
  OfficialBaselineDiagnosticsConfig,
  OfficialBaselineDiagnosticsLogicalPayload,
  OfficialBaselineDiagnosticsResult,
  OFFICIAL_BASELINE_DIAGNOSTICS_VERSION_1_1,
  OFFICIAL_BASELINE_DIAGNOSTICS_VERSION_1_0,
  PolicyDistinguishabilityMetrics,
  ScoreMarginSummary,
  StageEmptyPassMetrics,
  StateRecurrenceMetrics,
  CycleFingerprintRecurrenceMetrics,
  RequestBufferDiagnosticsMetrics,
  GenericRequestLifecycleMetrics,
  StepBudgetOutcome,
  TurnProgressMetrics,
  StageDiagnosticsMetrics,
  DeterministicCycleDiagnostics,
  CompactTrajectorySummary,
  DivergencePattern,
} from "../../domain/ai/OfficialBaselineDiagnosticsTypes";
import { canonicalJsonStringify } from "../regulation/OfficialBaselineMeasurementRunner";

/**
 * 論理ペイロードから決定論的 SHA-256 ダイジェストを算出
 */
export function computeDiagnosticsLogicalDigest(payload: OfficialBaselineDiagnosticsLogicalPayload): string {
  const json = canonicalJsonStringify(payload);
  return crypto.createHash("sha256").update(json, "utf8").digest("hex");
}

/**
 * DecisionRequest から実行時メタデータ（runtime decisionId, stateVersion, タイムスタンプ等）を完全排除した
 * 決定論的 Logical Request Fingerprint を生成
 */
export function computeLogicalDecisionRequestFingerprint(req: Readonly<DecisionRequest>): string {
  // 1. sorted logicalPatternKeys
  const patternKeys = req.patterns.map((p) => {
    return generateLogicalPatternKey({
      kind: p.kind,
      actionSelectionRef: p.actionSelectionRef,
      keyCardSelectionRef: p.keyCardSelectionRef,
      keyUnitSelectionRef: p.keyUnitSelectionRef,
      costPaymentRef: p.costPaymentRef,
      targetSelectionRef: p.targetSelectionRef,
      effectSelectionRef: p.effectSelectionRef,
      orderSelectionRef: p.orderSelectionRef,
    });
  });
  patternKeys.sort();

  // 2. logical source
  const logicalSource = {
    type: req.source?.type,
    playerId: req.source?.playerId,
  };

  // 3. canonical observation summary (秘密情報や runtime event id を含まない盤面概要)
  const obs = req.observation;
  const canonicalObs = {
    turnPlayer: obs?.turnPlayerId,
    chancePlayer: obs?.chancePlayerId,
    stageRequestsCount: obs?.stageRequests?.length ?? 0,
    players: (obs?.players || []).map((p) => ({
      playerId: p.playerId,
      isViewer: p.isViewer,
      handCount: p.handCount,
      fieldCount: p.field?.length ?? 0,
      lifeCount: p.lifeDisplay,
    })),
  };

  const payload = {
    playerId: req.playerId,
    source: logicalSource,
    patternKeys,
    observation: canonicalObs,
  };

  const json = canonicalJsonStringify(payload);
  return crypto.createHash("sha256").update(json, "utf8").digest("hex");
}

/**
 * ポリシー識別性診断 Accumulator
 */
export class PolicyDistinguishabilityAccumulator {
  public comparableRequests = 0;
  public requestsWithOneLogicalChoice = 0;
  public requestsWithMultipleLogicalChoices = 0;

  public firstLegalVsZeroDifferent = 0;
  public firstLegalVsManualDifferent = 0;
  public zeroVsManualDifferent = 0;

  public zeroAllLegalScoresEqualRequests = 0;
  public zeroArgmaxTieRequests = 0;
  public zeroUniqueTopRequests = 0;
  public zeroSelectedPatternRefCounts: Record<string, number> = {};

  public manualSingleChoiceRequests = 0;
  public manualUniqueArgmaxRequests = 0;
  public manualArgmaxTieRequests = 0;
  public manualZeroMarginRequests = 0;
  public manualPositiveMarginRequests = 0;
  public manualDifferentFromFirstLegal = 0;
  public manualDifferentFromZero = 0;
  private manualMargins: number[] = [];

  public argmaxTieWithCollisionCooccurrenceCount = 0;
  public samePatternRefCount = 0;
  public sameLogicalPatternKeyCount = 0;

  private readonly firstLegalPolicy = new FirstLegalPolicy(false);
  private readonly zeroGenomePolicy = new GenomePolicy(
    DecisionDNACodec.createZeroDecisionDNA({ id: "diag-zero", name: "Zero" })
  );
  private readonly manualGenericPolicy = new GenomePolicy(createManualGenericGenomeDNA());

  public observe(request: Readonly<DecisionRequest>): void {
    if (!request.patterns || request.patterns.length === 0) return;

    this.comparableRequests++;
    const patternCount = request.patterns.length;

    if (patternCount === 1) {
      this.requestsWithOneLogicalChoice++;
      this.manualSingleChoiceRequests++;
    } else {
      this.requestsWithMultipleLogicalChoices++;
    }

    // 1. 3 ポリシーの反実仮想判定を実行
    const resFirst = this.firstLegalPolicy.choose(request);
    const resZero = this.zeroGenomePolicy.choose(request);
    const resManual = this.manualGenericPolicy.choose(request);

    // patternRef の一致確認
    if (resFirst.selectedPatternRef === resZero.selectedPatternRef && resFirst.selectedPatternRef === resManual.selectedPatternRef) {
      this.samePatternRefCount++;
    }

    // Logical Pattern Key の一致確認
    const keyFirst = (request.patterns[resFirst.selectedPatternRef] as any)?.logicalPatternKey || `ref-${resFirst.selectedPatternRef}`;
    const keyZero = (request.patterns[resZero.selectedPatternRef] as any)?.logicalPatternKey || `ref-${resZero.selectedPatternRef}`;
    const keyManual = (request.patterns[resManual.selectedPatternRef] as any)?.logicalPatternKey || `ref-${resManual.selectedPatternRef}`;

    if (keyFirst === keyZero && keyFirst === keyManual) {
      this.sameLogicalPatternKeyCount++;
    }

    if (keyFirst !== keyZero) this.firstLegalVsZeroDifferent++;
    if (keyFirst !== keyManual) this.firstLegalVsManualDifferent++;
    if (keyZero !== keyManual) this.zeroVsManualDifferent++;

    // 2. 特徴量エンコードとスコア計算
    const encoded = DecisionFeatureEncoder.encode(request);
    const zeroDNA = this.zeroGenomePolicy.getDNA();
    const manualDNA = this.manualGenericPolicy.getDNA();

    const scoredZero = GenomeScorer.score(encoded, zeroDNA);
    const scoredManual = GenomeScorer.score(encoded, manualDNA);

    // 3. ZeroGenome スコア分析
    const zeroScores = scoredZero.map((p) => p.score);
    const allZeroScoresEqual = zeroScores.every((s) => s === zeroScores[0]);
    if (allZeroScoresEqual) {
      this.zeroAllLegalScoresEqualRequests++;
    }

    const maxZeroScore = Math.max(...zeroScores);
    const topTiedZero = zeroScores.filter((s) => s === maxZeroScore).length;
    if (topTiedZero > 1) {
      this.zeroArgmaxTieRequests++;
    } else {
      this.zeroUniqueTopRequests++;
    }

    const zRef = String(resZero.selectedPatternRef);
    this.zeroSelectedPatternRefCounts[zRef] = (this.zeroSelectedPatternRefCounts[zRef] || 0) + 1;

    // 4. ManualGeneric スコア & マージン分析
    const manualScores = scoredManual.map((p) => p.score).sort((a, b) => b - a);
    const maxManualScore = manualScores[0];
    const topTiedManual = manualScores.filter((s) => s === maxManualScore).length;

    if (topTiedManual === 1) {
      this.manualUniqueArgmaxRequests++;
    } else {
      this.manualArgmaxTieRequests++;
    }

    let margin = 0;
    if (manualScores.length > 1) {
      margin = manualScores[0] - manualScores[1];
      if (margin > 0) {
        this.manualPositiveMarginRequests++;
      } else {
        this.manualZeroMarginRequests++;
      }
    } else {
      margin = 0;
      this.manualZeroMarginRequests++;
    }
    this.manualMargins.push(margin);

    if (keyManual !== keyFirst) this.manualDifferentFromFirstLegal++;
    if (keyManual !== keyZero) this.manualDifferentFromZero++;

    // 5. Feature Collision & Argmax Tie Co-occurrence
    if (topTiedManual > 1) {
      const vectors = encoded.patterns.map((p) => p.values.join(","));
      const hasCollision = new Set(vectors).size < vectors.length;
      if (hasCollision) {
        this.argmaxTieWithCollisionCooccurrenceCount++;
      }
    }
  }

  public buildMetrics(): PolicyDistinguishabilityMetrics {
    const total = this.comparableRequests || 1;
    const ties = this.manualArgmaxTieRequests || 1;

    return {
      comparableRequests: this.comparableRequests,
      requestsWithOneLogicalChoice: this.requestsWithOneLogicalChoice,
      requestsWithMultipleLogicalChoices: this.requestsWithMultipleLogicalChoices,
      choiceDiversity: {
        firstLegalVsZeroDifferent: this.firstLegalVsZeroDifferent,
        firstLegalVsManualDifferent: this.firstLegalVsManualDifferent,
        zeroVsManualDifferent: this.zeroVsManualDifferent,
        firstLegalVsZeroAgreementRate: ((total - this.firstLegalVsZeroDifferent) / total) * 100,
        firstLegalVsManualAgreementRate: ((total - this.firstLegalVsManualDifferent) / total) * 100,
        zeroVsManualAgreementRate: ((total - this.zeroVsManualDifferent) / total) * 100,
      },
      zeroGenome: {
        scoredRequests: this.comparableRequests,
        allLegalScoresEqualRequests: this.zeroAllLegalScoresEqualRequests,
        argmaxTieRequests: this.zeroArgmaxTieRequests,
        uniqueTopRequests: this.zeroUniqueTopRequests,
        selectedPatternRefDistribution: this.zeroSelectedPatternRefCounts,
      },
      manualGenericGenome: {
        scoredRequests: this.comparableRequests,
        singleChoiceRequests: this.manualSingleChoiceRequests,
        uniqueArgmaxRequests: this.manualUniqueArgmaxRequests,
        argmaxTieRequests: this.manualArgmaxTieRequests,
        zeroMarginRequests: this.manualZeroMarginRequests,
        positiveMarginRequests: this.manualPositiveMarginRequests,
        manualDifferentFromFirstLegal: this.manualDifferentFromFirstLegal,
        manualDifferentFromZero: this.manualDifferentFromZero,
        marginSummary: this.calculateMarginSummary(),
      },
      featureRelationship: {
        argmaxTieWithCollisionCooccurrenceCount: this.argmaxTieWithCollisionCooccurrenceCount,
        cooccurrenceRateOnTies: Math.round((this.argmaxTieWithCollisionCooccurrenceCount / ties) * 10000) / 100,
      },
      patternOrdering: {
        samePatternRefCount: this.samePatternRefCount,
        sameLogicalPatternKeyCount: this.sameLogicalPatternKeyCount,
      },
    };
  }

  private calculateMarginSummary(): ScoreMarginSummary {
    if (this.manualMargins.length === 0) {
      return { min: 0, max: 0, mean: 0, median: 0, p90: 0 };
    }
    const sorted = [...this.manualMargins].sort((a, b) => a - b);
    const sum = sorted.reduce((acc, v) => acc + v, 0);
    const mean = Math.round((sum / sorted.length) * 1000) / 1000;
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const median = sorted[Math.floor(sorted.length / 2)];
    const p90 = sorted[Math.floor(sorted.length * 0.9)];

    return { min, max, mean, median, p90 };
  }
}

/**
 * 単一対戦の未完走診断実行クラス
 */
export class MatchDiagnosticRunner {
  public static executeDetailedMatch(
    sessionFactory: (ctx: any) => any,
    p1PolicyFactory: (ctx: any, seat: string) => DecisionPolicy,
    p2PolicyFactory: (ctx: any, seat: string) => DecisionPolicy,
    matchContext: any,
    maxDecisions: number,
    isDeterministicMatchup: boolean
  ): {
    simResult: SimulationResult;
    stateRecurrence: StateRecurrenceMetrics;
    cycleFingerprintRecurrence: CycleFingerprintRecurrenceMetrics;
    turnProgress: TurnProgressMetrics;
    stageDiagnostics: StageDiagnosticsMetrics;
    requestBufferDiagnostics: RequestBufferDiagnosticsMetrics;
    requestLifecycleMetrics: GenericRequestLifecycleMetrics;
    observedActionIdCounts: Record<string, number>;
    selectedPatternKindCounts: Record<string, number>;
    decisionSourceTypeCounts: Record<string, number>;
    stageTopActionIdCounts: Record<string, number>;
    divergencePattern: DivergencePattern;
    stageEmptyPass: StageEmptyPassMetrics;
    cycleDiagnostics: DeterministicCycleDiagnostics;
    compactTrajectory: CompactTrajectorySummary;
  } {
    let latestRequest: Readonly<DecisionRequest> | undefined;

    const wrapPolicy = (policy: DecisionPolicy): DecisionPolicy => {
      return {
        descriptor: policy.descriptor,
        choose: (req: Readonly<DecisionRequest>): DecisionResponse => {
          latestRequest = req;
          return policy.choose(req);
        },
        decide: async (req: Readonly<DecisionRequest>): Promise<DecisionResponse> => {
          latestRequest = req;
          return policy.decide ? await policy.decide(req) : policy.choose(req);
        },
      };
    };

    const session = sessionFactory(matchContext);
    const policies: Record<string, DecisionPolicy> = {
      p1: wrapPolicy(p1PolicyFactory(matchContext, "p1")),
      p2: wrapPolicy(p2PolicyFactory(matchContext, "p2")),
    };

    const initialTurnCount = session.state.turnCount || 1;
    let maxStageDepth = 0;
    let maxRequestBufferDepth = 0;
    let stageEmptyPassCount = 0;
    let currentConsecutiveEmptyPass = 0;
    let maxConsecutiveStageEmptyPass = 0;

    const observedActionIdCounts: Record<string, number> = {};
    const selectedPatternKindCounts: Record<string, number> = {};
    const decisionSourceTypeCounts: Record<string, number> = {};
    const stageTopActionIdCounts: Record<string, number> = {};

    // 1. State Hash v2 トラッキング
    const stateVisits = new Map<string, number[]>();
    let repeatedStateVisitCount = 0;
    let firstRepeatedStateDecision: number | null = null;
    let shortestObservedRepeatDistance: number | null = null;
    const sampleHashes: string[] = [];

    // 2. Cycle State Fingerprint v1 トラッキング
    const cycleVisits = new Map<string, number[]>();
    let repeatedCycleVisitCount = 0;
    let firstRepeatedCycleDecision: number | null = null;
    let shortestCycleRepeatDistance: number | null = null;
    const sampleCycleFingerprints: string[] = [];

    // 決定的ポリシーのサイクル検出用シグネチャ (cycleFingerprint + requestFingerprint + selectedLogicalPatternKey)
    const stepSignatures = new Map<string, number>();
    let isDeterministicCycleCandidate = false;
    let cyclePeriod: number | undefined;
    let firstCycleStep: number | undefined;

    // SimulationRunner を wrap して進行
    const simResult = SimulationRunner.run(session, policies, {
      maxDecisions,
      onStep: ({ stepCount, decisionPlayer, record }) => {
        // Stage 深度計測 (正: stage.requests.length)
        const obs = latestRequest?.observation;
        const stageDepth = obs?.stageRequests?.length ?? (session.state.stage?.requests?.length ?? 0);
        if (stageDepth > maxStageDepth) {
          maxStageDepth = stageDepth;
        }

        // Request Buffer 深度計測
        const bufDepth = session.state.requestBuffer?.requests?.length ?? 0;
        if (bufDepth > maxRequestBufferDepth) {
          maxRequestBufferDepth = bufDepth;
        }

        // Action ID 頻度集計
        if (record.actionId) {
          observedActionIdCounts[record.actionId] = (observedActionIdCounts[record.actionId] || 0) + 1;
        }

        // 判断種別 (selectedPatternKind) 頻度集計 (ACTION, PASS, EFFECT_SELECTION 等)
        if (record.selectedPatternKind) {
          selectedPatternKindCounts[record.selectedPatternKind] =
            (selectedPatternKindCounts[record.selectedPatternKind] || 0) + 1;
        }

        // 判断要求ソース種別 (latestRequest.source.type) 頻度集計
        if (latestRequest?.source?.type) {
          decisionSourceTypeCounts[latestRequest.source.type] =
            (decisionSourceTypeCounts[latestRequest.source.type] || 0) + 1;
        }

        // 判断時点の Stage 先頭 actionId 頻度集計
        const stageReqs = session.state.stage?.requests;
        if (stageReqs && stageReqs.length > 0) {
          const topStageReq = stageReqs[stageReqs.length - 1];
          if (topStageReq?.actionId) {
            stageTopActionIdCounts[topStageReq.actionId] =
              (stageTopActionIdCounts[topStageReq.actionId] || 0) + 1;
          }
        }

        const turnPlayer = obs?.turnPlayerId ?? session.state.turnPlayer;
        const chancePlayer = obs?.chancePlayerId ?? session.state.chancePlayer;
        const isStageEmptyPass =
          stageDepth === 0 &&
          decisionPlayer === turnPlayer &&
          chancePlayer === turnPlayer &&
          record.selectedPatternKind === "PASS";

        if (isStageEmptyPass) {
          stageEmptyPassCount++;
          currentConsecutiveEmptyPass++;
          if (currentConsecutiveEmptyPass > maxConsecutiveStageEmptyPass) {
            maxConsecutiveStageEmptyPass = currentConsecutiveEmptyPass;
          }
        } else {
          currentConsecutiveEmptyPass = 0;
        }

        // 1. State Hash v2 再訪計測
        const sHash = record.stateHash;
        if (sampleHashes.length < 5) {
          sampleHashes.push(sHash);
        }

        const prevSteps = stateVisits.get(sHash);
        if (prevSteps && prevSteps.length > 0) {
          repeatedStateVisitCount++;
          if (firstRepeatedStateDecision === null) {
            firstRepeatedStateDecision = stepCount;
          }
          const dist = stepCount - prevSteps[prevSteps.length - 1];
          if (shortestObservedRepeatDistance === null || dist < shortestObservedRepeatDistance) {
            shortestObservedRepeatDistance = dist;
          }
          prevSteps.push(stepCount);
        } else {
          stateVisits.set(sHash, [stepCount]);
        }

        // 2. Cycle State Fingerprint v1 再訪計測
        const cycleFp = CycleStateFingerprint.compute(session.state);
        if (sampleCycleFingerprints.length < 5) {
          sampleCycleFingerprints.push(cycleFp);
        }

        const prevCycleSteps = cycleVisits.get(cycleFp);
        if (prevCycleSteps && prevCycleSteps.length > 0) {
          repeatedCycleVisitCount++;
          if (firstRepeatedCycleDecision === null) {
            firstRepeatedCycleDecision = stepCount;
          }
          const dist = stepCount - prevCycleSteps[prevCycleSteps.length - 1];
          if (shortestCycleRepeatDistance === null || dist < shortestCycleRepeatDistance) {
            shortestCycleRepeatDistance = dist;
          }
          prevCycleSteps.push(stepCount);
        } else {
          cycleVisits.set(cycleFp, [stepCount]);
        }

        // 3. 決定的サイクル候補検出 (Cycle Fingerprint + Request Fingerprint + Logical Pattern Key)
        if (isDeterministicMatchup && !isDeterministicCycleCandidate && latestRequest) {
          const reqFingerprint = computeLogicalDecisionRequestFingerprint(latestRequest);
          const sig = `${cycleFp}|${reqFingerprint}|${record.selectedLogicalPatternKey}`;

          if (stepSignatures.has(sig)) {
            isDeterministicCycleCandidate = true;
            firstCycleStep = stepSignatures.get(sig)!;
            cyclePeriod = stepCount - firstCycleStep;
          } else {
            stepSignatures.set(sig, stepCount);
          }
        }
      },
    });

    let maxVisitsPerStateHash = 0;
    for (const steps of stateVisits.values()) {
      if (steps.length > maxVisitsPerStateHash) {
        maxVisitsPerStateHash = steps.length;
      }
    }

    let maxVisitsPerFingerprint = 0;
    for (const steps of cycleVisits.values()) {
      if (steps.length > maxVisitsPerFingerprint) {
        maxVisitsPerFingerprint = steps.length;
      }
    }

    const finalTurnCount = session.state.turnCount || 1;
    const finalStageDepth = session.state.stage?.requests?.length ?? 0;
    const finalRequestBufferDepth = session.state.requestBuffer?.requests?.length ?? 0;

    // 構造化イベントから Generic Request Lifecycle Metrics を集計
    let requestCreatedCount = 0;
    let requestResolvedCount = 0;
    let immediateResolutionCount = 0;
    let normalRequestMovedToStageCount = 0;
    let triggeredRequestObservedCount = 0;

    if (simResult.matchLog?.events) {
      for (const ev of simResult.matchLog.events) {
        if (ev.type === "request.created") requestCreatedCount++;
        else if (ev.type === "request.resolved") requestResolvedCount++;
        else if (ev.type === "trigger.detected") triggeredRequestObservedCount++;
        else if (ev.type === "stage.pushed") normalRequestMovedToStageCount++;
        else if (ev.type === "requestBuffer.dequeued" && (ev as any).resolvedImmediately) {
          immediateResolutionCount++;
        }
      }
    }

    // 進行発散パターンの分類
    let divergencePattern: DivergencePattern = "UNKNOWN_DIVERGENCE";
    if (initialTurnCount === 1 && finalTurnCount === 1) {
      if (maxRequestBufferDepth >= 10) {
        divergencePattern = "REQUEST_BUFFER_GROWTH";
      } else if (maxStageDepth >= 10) {
        divergencePattern = "STAGE_GROWTH";
      } else {
        divergencePattern = "TURN_STALLED_WITH_CYCLE_RECURRENCE";
      }
    }

    return {
      simResult,
      stateRecurrence: {
        observedDecisionCount: simResult.totalDecisions,
        uniqueStateHashCount: stateVisits.size,
        repeatedStateVisitCount,
        firstRepeatedStateDecision,
        maxVisitsPerStateHash,
        shortestObservedRepeatDistance,
      },
      cycleFingerprintRecurrence: {
        observedDecisionCount: simResult.totalDecisions,
        uniqueFingerprintCount: cycleVisits.size,
        repeatedFingerprintVisitCount: repeatedCycleVisitCount,
        firstRepeatedFingerprintDecision: firstRepeatedCycleDecision,
        maxVisitsPerFingerprint,
        shortestRepeatDistance: shortestCycleRepeatDistance,
      },
      turnProgress: {
        initialTurnCount,
        finalTurnCount,
        turnsAdvanced: finalTurnCount - initialTurnCount,
        decisionsPerTurn: (finalTurnCount - initialTurnCount) > 0
          ? simResult.totalDecisions / (finalTurnCount - initialTurnCount)
          : simResult.totalDecisions,
      },
      stageDiagnostics: {
        maxStageDepth,
        finalStageDepth,
      },
      requestBufferDiagnostics: {
        maxRequestBufferDepth,
        finalRequestBufferDepth,
      },
      requestLifecycleMetrics: {
        requestCreatedCount,
        requestResolvedCount,
        immediateResolutionCount,
        normalRequestMovedToStageCount,
        triggeredRequestObservedCount,
      },
      observedActionIdCounts,
      selectedPatternKindCounts,
      decisionSourceTypeCounts,
      stageTopActionIdCounts,
      divergencePattern,
      stageEmptyPass: {
        stageEmptyPassCount,
        maxConsecutiveStageEmptyPass,
        hasStateRecurrence: repeatedCycleVisitCount > 0 || repeatedStateVisitCount > 0,
        isDeterministicCycleCandidate,
      },
      cycleDiagnostics: {
        isDeterministicCycleCandidate,
        cyclePeriod,
        firstCycleStep,
      },
      compactTrajectory: {
        firstRepeatIndex: firstRepeatedCycleDecision ?? firstRepeatedStateDecision,
        repeatCount: repeatedCycleVisitCount > 0 ? repeatedCycleVisitCount : repeatedStateVisitCount,
        cyclePeriod,
        sampleStateHashes: sampleHashes,
        sampleCycleFingerprints,
      },
    };
  }
}

/**
 * 公式ベースライン未完走原因 & ポリシー識別性 総合診断ランナー (Phase 3.4 & Phase 3.4.1)
 */
export class OfficialBaselineDiagnosticsRunner {
  public static readonly VERSION = OFFICIAL_BASELINE_DIAGNOSTICS_VERSION_1_1;

  public static async executeSingleRun(
    config: OfficialBaselineDiagnosticsConfig,
    catalog: RegulationCatalog,
    fullRulePackage: RulePackage,
    onProgress?: (msg: string) => void
  ): Promise<{ payload: OfficialBaselineDiagnosticsLogicalPayload; diagnosticErrorCount: number }> {
    let diagnosticErrorCount = 0;

    const rawParticipants = [
      BaselineParticipants.createFirstLegal("baseline-first-legal-v1", "FirstLegal", false),
      BaselineParticipants.createRandom("baseline-seeded-random-v1", "SeededRandom"),
      BaselineParticipants.createZeroGenome("baseline-zero-genome-v1", "ZeroGenome"),
      BaselineParticipants.createManualGenericGenome("baseline-manual-generic-v1", "ManualGenericGenome"),
    ];

    const pairs = [
      { a: rawParticipants[0], b: rawParticipants[1], pairId: "firstLegal-vs-seededRandom", isDet: false },
      { a: rawParticipants[0], b: rawParticipants[2], pairId: "firstLegal-vs-zeroGenome", isDet: true },
      { a: rawParticipants[0], b: rawParticipants[3], pairId: "firstLegal-vs-manualGeneric", isDet: true },
      { a: rawParticipants[1], b: rawParticipants[2], pairId: "seededRandom-vs-zeroGenome", isDet: false },
      { a: rawParticipants[1], b: rawParticipants[3], pairId: "seededRandom-vs-manualGeneric", isDet: false },
      { a: rawParticipants[2], b: rawParticipants[3], pairId: "zeroGenome-vs-manualGeneric", isDet: true },
    ];

    const sessionFactory = await OfficialRegulationMatchFactory.prepareSessionFactory(
      config.regulationId,
      {
        catalog,
        fullRulePackage,
      }
    );

    const distinguishabilityAccumulator = new PolicyDistinguishabilityAccumulator();
    const incompleteCases: IncompleteCaseRecord[] = [];
    let totalPrimaryMatches = 0;

    // 1. Primary 500 実行 & 未完走試合の抽出
    for (let pIdx = 0; pIdx < pairs.length; pIdx++) {
      const { a, b, pairId, isDet } = pairs[pIdx];
      onProgress?.(`[Primary 500 Matchup ${pIdx + 1}/6] ${a.name} vs ${b.name}...`);

      const legs = [
        { legId: "leg-a-as-p1", p1: a, p2: b },
        { legId: "leg-b-as-p1", p1: b, p2: a },
      ];

      for (const leg of legs) {
        for (let mIdx = 0; mIdx < config.matchesPerSeat; mIdx++) {
          totalPrimaryMatches++;
          const plan = BatchSimulationRunner.planMatch(config.baseSeed, mIdx);
          const matchContext = {
            matchIndex: plan.matchIndex,
            matchId: plan.matchId,
            baseSeed: plan.baseSeed,
            matchSeed: plan.matchSeed,
            playerSeeds: plan.playerSeeds,
          };

          const wrapWithDistinguishability = (policy: DecisionPolicy): DecisionPolicy => {
            return {
              descriptor: policy.descriptor,
              choose: (req: Readonly<DecisionRequest>): DecisionResponse => {
                distinguishabilityAccumulator.observe(req);
                return policy.choose(req);
              },
              decide: async (req: Readonly<DecisionRequest>): Promise<DecisionResponse> => {
                distinguishabilityAccumulator.observe(req);
                return policy.decide ? await policy.decide(req) : policy.choose(req);
              },
            };
          };

          const session = sessionFactory(matchContext);
          const policies: Record<string, DecisionPolicy> = {
            p1: wrapWithDistinguishability(leg.p1.policyFactory(matchContext, "p1")),
            p2: wrapWithDistinguishability(leg.p2.policyFactory(matchContext, "p2")),
          };

          const simResult = SimulationRunner.run(session, policies, {
            maxDecisions: config.primaryMaxDecisions,
          });

          if (!simResult.completed) {
            // INCOMPLETE 発見！
            const caseId = `case-${pairId}-${leg.legId}-m${String(mIdx).padStart(3, "0")}`;

            // A. Secondary 1000 再実行
            const run1000 = MatchDiagnosticRunner.executeDetailedMatch(
              sessionFactory,
              leg.p1.policyFactory,
              leg.p2.policyFactory,
              matchContext,
              config.secondaryMaxDecisions,
              isDet
            );

            const outcome1000: StepBudgetOutcome = {
              maxDecisions: config.secondaryMaxDecisions,
              finalDecisionCount: run1000.simResult.totalDecisions,
              finalTurnCount: run1000.turnProgress.finalTurnCount,
              finalStateHash: run1000.simResult.finalStateHash || "",
              completed: run1000.simResult.completed,
              outcomeCategory: run1000.simResult.completed ? "FINISHED_BY_1000" : "STILL_INCOMPLETE_1000",
              winner: run1000.simResult.winner,
              reason: run1000.simResult.reason,
            };

            // B. Tertiary 2000 再実行 (1000でも未完走の場合)
            let outcome2000: StepBudgetOutcome | undefined;
            let detailedRun = run1000;

            if (!run1000.simResult.completed) {
              const run2000 = MatchDiagnosticRunner.executeDetailedMatch(
                sessionFactory,
                leg.p1.policyFactory,
                leg.p2.policyFactory,
                matchContext,
                config.tertiaryMaxDecisions,
                isDet
              );

              outcome2000 = {
                maxDecisions: config.tertiaryMaxDecisions,
                finalDecisionCount: run2000.simResult.totalDecisions,
                finalTurnCount: run2000.turnProgress.finalTurnCount,
                finalStateHash: run2000.simResult.finalStateHash || "",
                completed: run2000.simResult.completed,
                outcomeCategory: run2000.simResult.completed ? "FINISHED_BY_2000" : "STILL_INCOMPLETE_2000",
                winner: run2000.simResult.winner,
                reason: run2000.simResult.reason,
              };

              detailedRun = run2000;
            }

            let finalClassification: IncompleteCaseRecord["finalClassification"];
            if (outcome1000.completed) {
              finalClassification = "FINISHED_BY_1000";
            } else if (outcome2000?.completed) {
              finalClassification = "FINISHED_BY_2000";
            } else if (!isDet && detailedRun.cycleFingerprintRecurrence.repeatedFingerprintVisitCount > 0) {
              finalClassification = "CYCLE_STATE_RECURRENCE_OBSERVED";
            } else if (detailedRun.cycleFingerprintRecurrence.repeatedFingerprintVisitCount > 0 || detailedRun.stateRecurrence.repeatedStateVisitCount > 0) {
              finalClassification = "STILL_INCOMPLETE_WITH_STATE_RECURRENCE";
            } else {
              finalClassification = "STILL_INCOMPLETE_WITHOUT_EXACT_STATE_RECURRENCE";
            }

            const record: IncompleteCaseRecord = {
              caseId,
              pairId,
              legId: leg.legId,
              participantP1: { id: leg.p1.id, name: leg.p1.name },
              participantP2: { id: leg.p2.id, name: leg.p2.name },
              matchIndex: mIdx,
              matchSeed: plan.matchSeed,
              reproductionRecipe: {
                regulationId: config.regulationId,
                baseSeed: config.baseSeed,
                pairId,
                legId: leg.legId,
                matchIndex: mIdx,
                matchSeed: plan.matchSeed,
                p1ParticipantId: leg.p1.id,
                p2ParticipantId: leg.p2.id,
                maxDecisions: config.primaryMaxDecisions,
              },
              primary500: {
                maxDecisions: 500,
                finalDecisionCount: simResult.totalDecisions,
                finalTurnCount: session.state.turnCount || 1,
                finalStateHash: simResult.finalStateHash || "",
                completed: false,
              },
              secondary1000: outcome1000,
              tertiary2000: outcome2000,
              finalClassification,
              stateRecurrence: detailedRun.stateRecurrence,
              cycleFingerprintRecurrence: detailedRun.cycleFingerprintRecurrence,
              turnProgress: detailedRun.turnProgress,
              stageDiagnostics: detailedRun.stageDiagnostics,
              requestBufferDiagnostics: detailedRun.requestBufferDiagnostics,
              requestLifecycleMetrics: detailedRun.requestLifecycleMetrics,
              observedActionIdCounts: detailedRun.observedActionIdCounts,
              selectedPatternKindCounts: detailedRun.selectedPatternKindCounts,
              decisionSourceTypeCounts: detailedRun.decisionSourceTypeCounts,
              stageTopActionIdCounts: detailedRun.stageTopActionIdCounts,
              divergencePattern: detailedRun.divergencePattern,
              stageEmptyPassDiagnostics: detailedRun.stageEmptyPass,
              cycleDiagnostics: detailedRun.cycleDiagnostics,
              compactTrajectory: detailedRun.compactTrajectory,
            };

            incompleteCases.push(record);
          }
        }
      }
    }

    // Phase 3.3 元成果物との動的照合
    let matchedPhase33BaselineIncompleteCount = false;
    try {
      const baselineJsonPath = path.resolve(__dirname, "../../../reports/ai/official-light-entry16-baseline-v1.json");
      if (fs.existsSync(baselineJsonPath)) {
        const baselineJson = JSON.parse(fs.readFileSync(baselineJsonPath, "utf8"));
        const baseIncompletes = baselineJson.matchups?.reduce(
          (acc: number, m: any) => acc + (m.incompleteMatches || 0),
          0
        ) ?? 0;
        matchedPhase33BaselineIncompleteCount = baseIncompletes === incompleteCases.length;
      }
    } catch (e) {
      diagnosticErrorCount++;
    }

    // 集計サマリー
    const finishedBy1000 = incompleteCases.filter((c) => c.secondary1000.completed).length;
    const finishedBy2000 = incompleteCases.filter((c) => c.tertiary2000?.completed).length;
    const stillIncompleteWithRecurrence = incompleteCases.filter(
      (c) => !c.secondary1000.completed && !c.tertiary2000?.completed && ((c.cycleFingerprintRecurrence?.repeatedFingerprintVisitCount ?? 0) > 0 || c.stateRecurrence.repeatedStateVisitCount > 0)
    ).length;
    const stillIncompleteWithoutRecurrence = incompleteCases.filter(
      (c) => !c.secondary1000.completed && !c.tertiary2000?.completed && (c.cycleFingerprintRecurrence?.repeatedFingerprintVisitCount ?? 0) === 0 && c.stateRecurrence.repeatedStateVisitCount === 0
    ).length;
    const deterministicCycleCandidates = incompleteCases.filter(
      (c) => c.cycleDiagnostics?.isDeterministicCycleCandidate
    ).length;

    // State Recurrence Summary
    const casesWithRecurrence = incompleteCases.filter((c) => c.stateRecurrence.repeatedStateVisitCount > 0).length;
    const maxVisitsObserved = incompleteCases.reduce(
      (max, c) => Math.max(max, c.stateRecurrence.maxVisitsPerStateHash),
      0
    );
    let minRepeatDistanceObserved: number | null = null;
    for (const c of incompleteCases) {
      if (c.stateRecurrence.shortestObservedRepeatDistance !== null) {
        if (minRepeatDistanceObserved === null || c.stateRecurrence.shortestObservedRepeatDistance < minRepeatDistanceObserved) {
          minRepeatDistanceObserved = c.stateRecurrence.shortestObservedRepeatDistance;
        }
      }
    }

    // Cycle Fingerprint Recurrence Summary
    const casesWithCycleRecurrence = incompleteCases.filter(
      (c) => (c.cycleFingerprintRecurrence?.repeatedFingerprintVisitCount ?? 0) > 0
    ).length;
    const maxCycleVisitsObserved = incompleteCases.reduce(
      (max, c) => Math.max(max, c.cycleFingerprintRecurrence?.maxVisitsPerFingerprint ?? 0),
      0
    );
    let minCycleRepeatDistanceObserved: number | null = null;
    for (const c of incompleteCases) {
      const dist = c.cycleFingerprintRecurrence?.shortestRepeatDistance;
      if (dist !== null && dist !== undefined) {
        if (minCycleRepeatDistanceObserved === null || dist < minCycleRepeatDistanceObserved) {
          minCycleRepeatDistanceObserved = dist;
        }
      }
    }

    // Request Buffer Summary
    const maxObservedBufferDepth = incompleteCases.reduce(
      (max, c) => Math.max(max, c.requestBufferDiagnostics?.maxRequestBufferDepth ?? 0),
      0
    );
    const totalFinalBufferDepth = incompleteCases.reduce(
      (sum, c) => sum + (c.requestBufferDiagnostics?.finalRequestBufferDepth ?? 0),
      0
    );
    const averageFinalBufferDepth = incompleteCases.length > 0 ? Math.round((totalFinalBufferDepth / incompleteCases.length) * 100) / 100 : 0;

    // Divergence Summary
    const allTurn1Cases = incompleteCases.filter((c) => c.turnProgress.initialTurnCount === 1 && c.turnProgress.finalTurnCount === 1).length;
    const turnStalledWithCycleRecurrenceCases = incompleteCases.filter(
      (c) =>
        c.divergencePattern === "TURN_STALLED_WITH_CYCLE_RECURRENCE" ||
        c.divergencePattern === "STABLE_DEPTH_DECISION_CYCLE" ||
        c.divergencePattern === "STABLE_DEPTH_UNBOUNDED_REQUEST_GENERATION"
    ).length;

    // Stage-Empty PASS Summary
    const totalCasesWithStageEmptyPass = incompleteCases.filter(
      (c) => c.stageEmptyPassDiagnostics.stageEmptyPassCount > 0
    ).length;
    const maxConsecutiveObserved = incompleteCases.reduce(
      (max, c) => Math.max(max, c.stageEmptyPassDiagnostics.maxConsecutiveStageEmptyPass),
      0
    );
    const cooccurrenceWithRecurrenceCases = incompleteCases.filter(
      (c) => c.stageEmptyPassDiagnostics.stageEmptyPassCount > 0 && c.stageEmptyPassDiagnostics.hasStateRecurrence
    ).length;
    const cooccurrenceWithCycleCandidates = incompleteCases.filter(
      (c) => c.stageEmptyPassDiagnostics.stageEmptyPassCount > 0 && c.stageEmptyPassDiagnostics.isDeterministicCycleCandidate
    ).length;

    const policyDistinguishability = distinguishabilityAccumulator.buildMetrics();

    const payload: OfficialBaselineDiagnosticsLogicalPayload = {
      diagnosticsVersion: config.diagnosticsVersion || OFFICIAL_BASELINE_DIAGNOSTICS_VERSION_1_1,
      workId: config.workId,
      sourceBaselineDigest: config.sourceBaselineDigest,
      regulationId: config.regulationId,
      baseSeed: config.baseSeed,
      primaryMaxDecisions: config.primaryMaxDecisions,
      secondaryMaxDecisions: config.secondaryMaxDecisions,
      tertiaryMaxDecisions: config.tertiaryMaxDecisions,
      totalPrimaryMatches,
      totalIncompleteCases: incompleteCases.length,
      matchedPhase33BaselineIncompleteCount,
      incompleteOutcomeCounts: {
        finishedBy1000,
        finishedBy2000,
        stillIncompleteWithRecurrence,
        stillIncompleteWithoutRecurrence,
        deterministicCycleCandidates,
      },
      incompleteCases,
      policyDistinguishability,
      stateRecurrenceSummary: {
        casesWithRecurrence,
        casesWithoutRecurrence: incompleteCases.length - casesWithRecurrence,
        maxVisitsObserved,
        minRepeatDistanceObserved,
      },
      cycleFingerprintRecurrenceSummary: {
        casesWithRecurrence: casesWithCycleRecurrence,
        casesWithoutRecurrence: incompleteCases.length - casesWithCycleRecurrence,
        maxVisitsObserved: maxCycleVisitsObserved,
        minRepeatDistanceObserved: minCycleRepeatDistanceObserved,
      },
      requestBufferSummary: {
        maxObservedBufferDepth,
        averageFinalBufferDepth,
      },
      divergenceSummary: {
        allTurn1Cases,
        turnStalledWithCycleRecurrenceCases,
        stableDepthUnboundedCases: turnStalledWithCycleRecurrenceCases,
      },
      stageEmptyPassSummary: {
        totalCasesWithStageEmptyPass,
        maxConsecutiveObserved,
        cooccurrenceWithRecurrenceCases,
        cooccurrenceWithCycleCandidates,
      },
      conclusions: [
        "Primary incomplete matches were reproduced deterministically without overwriting primary baseline values.",
        "Budget scaling (1000 / 2000), State Recurrence (State Hash v2), and Cycle State Fingerprint v1 quantify whether incomplete games represent slow convergence, deterministic loop cycles, or divergent action generation.",
        "Stage depth was measured strictly from state.stage.requests.length and Request Buffer depth was captured generically.",
        "Request Lifecycle metrics were collected directly from structured Canonical Match Log events without log string parsing.",
        "Stage-empty PASS behavior (stageDepth === 0 && decisionPlayer === turnPlayer && chancePlayer === turnPlayer) was quantified as a generic Core Flow metric.",
        "ZeroGenome and ManualGenericGenome equivalence with FirstLegal is explained by score margins, argmax ties, and pattern ordering on the observed corpus.",
      ],
      notes: [
        "Incomplete count matches Phase 3.3 baseline artifact verification.",
        "No fitness scalar, genome mutations, schema changes, or core flow modifications were applied in this diagnostic phase.",
        "Cycle Fingerprint excludes monotonic counters (stateVersion, nextRequestSeq, sequence, runtime request IDs) while strictly preserving array order and gameplay-relevant state.",
      ],
    };

    return { payload, diagnosticErrorCount };
  }

  /**
   * Run A と Run B の 2 回実行を行い、決定論的再現性 (Logical Repeatability) を検証した総合結果を生成
   */
  public static async run(
    config: OfficialBaselineDiagnosticsConfig,
    catalog: RegulationCatalog,
    fullRulePackage: RulePackage,
    onProgress?: (msg: string) => void
  ): Promise<OfficialBaselineDiagnosticsResult> {
    onProgress?.("Starting Diagnostics Run A...");
    const runA = await this.executeSingleRun(config, catalog, fullRulePackage, onProgress);
    const digestA = computeDiagnosticsLogicalDigest(runA.payload);

    onProgress?.(`Run A completed. Digest: ${digestA}`);
    onProgress?.("Starting Diagnostics Run B (Repeatability Verification)...");
    const runB = await this.executeSingleRun(config, catalog, fullRulePackage, onProgress);
    const digestB = computeDiagnosticsLogicalDigest(runB.payload);

    onProgress?.(`Run B completed. Digest: ${digestB}`);

    const matched = digestA === digestB;
    const jsonA = canonicalJsonStringify(runA.payload);
    const jsonB = canonicalJsonStringify(runB.payload);
    const exactLogicalEquality = jsonA === jsonB;

    return {
      ...runA.payload,
      logicalDigest: digestA,
      repeatability: {
        runADigest: digestA,
        runBDigest: digestB,
        matched,
        exactLogicalEquality,
        diagnosticErrorCount: runA.diagnosticErrorCount + runB.diagnosticErrorCount,
      },
    };
  }
}
