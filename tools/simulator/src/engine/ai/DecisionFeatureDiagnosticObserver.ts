import { DecisionPolicy, PolicyDescriptor, FirstLegalPolicy } from "../simulation/DecisionPolicy";
import { DecisionRequest } from "../../domain/decision/DecisionRequest";
import { DecisionResponse } from "../../domain/decision/DecisionResponse";
import { DecisionFeatureEncoder } from "./DecisionFeatureEncoder";
import { GenomeScorer } from "./GenomeScorer";
import { GenomePolicy } from "./GenomePolicy";
import { DecisionDNACodec } from "./DecisionDNACodec";
import { createManualGenericGenomeDNA } from "./BaselinePolicies";
import {
  CONTEXT_FEATURE_NAMES,
  PATTERN_FEATURE_NAMES,
  DecisionPatternFeatures,
} from "../../domain/ai/DecisionFeatureTypes";
import {
  FeatureCollisionMetrics,
  FeatureActivationCoverage,
  GenomeArgmaxTieMetrics,
  CounterfactualAgreementMetrics,
  ParticipantBehaviorMetrics,
} from "../../domain/ai/OfficialBaselineMeasurementTypes";
import { DecisionDNA } from "../../domain/ai/DecisionDNATypes";

/**
 * 600戦のベースライン対戦を通じて診断メトリクスを集計する中央 Accumulator。
 */
export class BaselineDiagnosticAccumulator {
  public diagnosticErrorCount = 0;

  // 1. Participant 行動メトリクス
  private readonly behaviorMap = new Map<
    string,
    {
      totalObservedDecisions: number;
      actionSelections: number;
      passSelections: number;
      effectSelections: number;
      otherSelections: number;
      actionRequestDecisions: number;
      effectResolutionDecisions: number;
      otherSourceDecisions: number;
    }
  >();

  // 2. Feature Collision
  private readonly collisionMap = new Map<
    string,
    {
      encodedDecisions: number;
      decisionsWithPatternCollision: number;
      totalEncodedPatterns: number;
      collidingPatterns: number;
      collisionGroupCount: number;
      maxCollisionGroupSize: number;
      logicalPatternKeyMissingCount: number;
    }
  >();

  // 3. Feature Activation Coverage (全試合累計)
  private readonly contextActivationCounts = new Map<string, number>();
  private readonly patternActivationCounts = new Map<string, number>();

  // 4. Genome Argmax Ties
  private readonly tieMap = new Map<
    string,
    {
      scoredDecisions: number;
      decisionsWithArgmaxTie: number;
      totalTopTiedPatterns: number;
      maxTopTieCount: number;
      argmaxTieWithFeatureCollisionCount: number;
    }
  >();

  // 5. Counterfactual Agreement
  private readonly agreementMap = new Map<
    string,
    {
      referenceComparableDecisions: number;
      sameAsFirstLegalCount: number;
      sameAsZeroGenomeCount: number;
    }
  >();

  // Reference Policies (インスタンス再利用)
  private readonly firstLegalRef = new FirstLegalPolicy(false);
  private readonly zeroDNA: DecisionDNA = DecisionDNACodec.createZeroDecisionDNA({
    id: "baseline-zero-genome-v1",
    name: "ZeroGenome",
  });
  private readonly zeroGenomeRef = new GenomePolicy(this.zeroDNA);
  private readonly manualDNA: DecisionDNA = createManualGenericGenomeDNA();

  constructor() {
    // 特徴量名の初期化
    for (const name of CONTEXT_FEATURE_NAMES) {
      this.contextActivationCounts.set(name, 0);
    }
    for (const name of PATTERN_FEATURE_NAMES) {
      this.patternActivationCounts.set(name, 0);
    }
  }

  /**
   * 意思決定イベントを安全に記録・集計
   */
  public recordDecision(
    participantId: string,
    request: Readonly<DecisionRequest>,
    response: Readonly<DecisionResponse>
  ): void {
    try {
      this.recordBehavior(participantId, request, response);
      this.recordFeatureDiagnostics(participantId, request, response);
    } catch {
      this.diagnosticErrorCount++;
    }
  }

  private recordBehavior(
    participantId: string,
    request: Readonly<DecisionRequest>,
    response: Readonly<DecisionResponse>
  ): void {
    let b = this.behaviorMap.get(participantId);
    if (!b) {
      b = {
        totalObservedDecisions: 0,
        actionSelections: 0,
        passSelections: 0,
        effectSelections: 0,
        otherSelections: 0,
        actionRequestDecisions: 0,
        effectResolutionDecisions: 0,
        otherSourceDecisions: 0,
      };
      this.behaviorMap.set(participantId, b);
    }

    b.totalObservedDecisions++;

    // Decision Source
    if (request.source?.type === "ACTION_REQUEST") {
      b.actionRequestDecisions++;
    } else if (request.source?.type === "EFFECT_RESOLUTION") {
      b.effectResolutionDecisions++;
    } else {
      b.otherSourceDecisions++;
    }

    // Selected Pattern Kind
    const selectedRef = response?.selectedPatternRef;
    const pattern =
      Array.isArray(request.patterns) &&
      typeof selectedRef === "number" &&
      selectedRef >= 0 &&
      selectedRef < request.patterns.length
        ? request.patterns[selectedRef]
        : undefined;

    if (pattern?.kind === "ACTION") {
      b.actionSelections++;
    } else if (pattern?.kind === "PASS") {
      b.passSelections++;
    } else if (pattern?.kind === "EFFECT_SELECTION") {
      b.effectSelections++;
    } else {
      b.otherSelections++;
    }
  }

  private recordFeatureDiagnostics(
    participantId: string,
    request: Readonly<DecisionRequest>,
    response: Readonly<DecisionResponse>
  ): void {
    const patterns = request.patterns;
    if (!patterns || patterns.length === 0) return;

    // 1. 特徴量エンコード (合法的観測情報のみから実行)
    const features = DecisionFeatureEncoder.encode(request);
    const encodedPatterns = features.patterns;

    // 2. Feature Activation Coverage (Context)
    const contextVals = features.context.values;
    for (let i = 0; i < contextVals.length; i++) {
      if (contextVals[i] !== 0) {
        const name = CONTEXT_FEATURE_NAMES[i];
        this.contextActivationCounts.set(
          name,
          (this.contextActivationCounts.get(name) || 0) + 1
        );
      }
    }

    // Feature Activation Coverage (Pattern)
    for (const pat of encodedPatterns) {
      const pVals = pat.values;
      for (let j = 0; j < pVals.length; j++) {
        if (pVals[j] !== 0) {
          const name = PATTERN_FEATURE_NAMES[j];
          this.patternActivationCounts.set(
            name,
            (this.patternActivationCounts.get(name) || 0) + 1
          );
        }
      }
    }

    // 3. Feature Collision
    let c = this.collisionMap.get(participantId);
    if (!c) {
      c = {
        encodedDecisions: 0,
        decisionsWithPatternCollision: 0,
        totalEncodedPatterns: 0,
        collidingPatterns: 0,
        collisionGroupCount: 0,
        maxCollisionGroupSize: 0,
        logicalPatternKeyMissingCount: 0,
      };
      this.collisionMap.set(participantId, c);
    }

    c.encodedDecisions++;
    c.totalEncodedPatterns += encodedPatterns.length;

    // 57次元ベクトルの文字列表現でグループ化
    const vectorGroups = new Map<string, DecisionPatternFeatures[]>();
    for (const pat of encodedPatterns) {
      if (!pat.logicalPatternKey) {
        c.logicalPatternKeyMissingCount++;
      }
      const key = pat.values.join(",");
      let grp = vectorGroups.get(key);
      if (!grp) {
        grp = [];
        vectorGroups.set(key, grp);
      }
      grp.push(pat);
    }

    let decisionHadCollision = false;
    for (const grp of vectorGroups.values()) {
      if (grp.length > 1) {
        // 異なる logicalPatternKey を持つか確認
        const uniqueKeys = new Set(grp.map((p) => p.logicalPatternKey));
        if (uniqueKeys.size > 1) {
          decisionHadCollision = true;
          c.collisionGroupCount++;
          c.collidingPatterns += grp.length;
          if (grp.length > c.maxCollisionGroupSize) {
            c.maxCollisionGroupSize = grp.length;
          }
        }
      }
    }
    if (decisionHadCollision) {
      c.decisionsWithPatternCollision++;
    }

    // 4. Genome Argmax Ties (Genome Participant の場合)
    const isZeroGenome =
      participantId.includes("zero") || participantId === "baseline-zero-genome-v1";
    const isManualGenome =
      participantId.includes("manual") || participantId === "baseline-manual-generic-v1";

    if (isZeroGenome || isManualGenome) {
      let t = this.tieMap.get(participantId);
      if (!t) {
        t = {
          scoredDecisions: 0,
          decisionsWithArgmaxTie: 0,
          totalTopTiedPatterns: 0,
          maxTopTieCount: 0,
          argmaxTieWithFeatureCollisionCount: 0,
        };
        this.tieMap.set(participantId, t);
      }

      t.scoredDecisions++;
      const dnaToScore = isZeroGenome ? this.zeroDNA : this.manualDNA;
      const scored = GenomeScorer.score(features, dnaToScore);

      let maxScore = -Infinity;
      for (const sp of scored) {
        if (sp.score > maxScore) {
          maxScore = sp.score;
        }
      }

      const topTied = scored.filter((sp) => sp.score === maxScore);
      if (topTied.length > 1) {
        t.decisionsWithArgmaxTie++;
        t.totalTopTiedPatterns += topTied.length;
        if (topTied.length > t.maxTopTieCount) {
          t.maxTopTieCount = topTied.length;
        }

        // feature collision との重なり判定
        const tiedRefs = new Set(topTied.map((sp) => sp.patternRef));
        const tiedPatterns = encodedPatterns.filter((p) => tiedRefs.has(p.patternRef));
        const tiedVectorGroups = new Map<string, string[]>();
        for (const tp of tiedPatterns) {
          const vKey = tp.values.join(",");
          const list = tiedVectorGroups.get(vKey) || [];
          list.push(tp.logicalPatternKey || "");
          tiedVectorGroups.set(vKey, list);
        }
        for (const list of tiedVectorGroups.values()) {
          if (new Set(list).size > 1) {
            t.argmaxTieWithFeatureCollisionCount++;
            break;
          }
        }
      }
    }

    // 5. Counterfactual Selection Agreement
    let a = this.agreementMap.get(participantId);
    if (!a) {
      a = {
        referenceComparableDecisions: 0,
        sameAsFirstLegalCount: 0,
        sameAsZeroGenomeCount: 0,
      };
      this.agreementMap.set(participantId, a);
    }

    a.referenceComparableDecisions++;
    const firstLegalResp = this.firstLegalRef.choose(request);
    const zeroGenomeResp = this.zeroGenomeRef.choose(request);

    if (response.selectedPatternRef === firstLegalResp.selectedPatternRef) {
      a.sameAsFirstLegalCount++;
    }
    if (response.selectedPatternRef === zeroGenomeResp.selectedPatternRef) {
      a.sameAsZeroGenomeCount++;
    }
  }

  // --- サマリー取得メソッド群 ---

  public getParticipantBehavior(): ParticipantBehaviorMetrics[] {
    const list: ParticipantBehaviorMetrics[] = [];
    for (const [id, b] of this.behaviorMap.entries()) {
      const total = b.totalObservedDecisions;
      list.push({
        participantId: id,
        totalObservedDecisions: total,
        actionSelections: b.actionSelections,
        passSelections: b.passSelections,
        effectSelections: b.effectSelections,
        otherSelections: b.otherSelections,
        actionRequestDecisions: b.actionRequestDecisions,
        effectResolutionDecisions: b.effectResolutionDecisions,
        otherSourceDecisions: b.otherSourceDecisions,
        actionSelectionRate: total > 0 ? b.actionSelections / total : 0,
        passSelectionRate: total > 0 ? b.passSelections / total : 0,
        effectSelectionRate: total > 0 ? b.effectSelections / total : 0,
      });
    }
    return list.sort((x, y) => x.participantId.localeCompare(y.participantId));
  }

  public getFeatureCollisions(): FeatureCollisionMetrics[] {
    const list: FeatureCollisionMetrics[] = [];
    for (const [id, c] of this.collisionMap.entries()) {
      list.push({
        participantId: id,
        encodedDecisions: c.encodedDecisions,
        decisionsWithPatternCollision: c.decisionsWithPatternCollision,
        collisionDecisionRate:
          c.encodedDecisions > 0
            ? c.decisionsWithPatternCollision / c.encodedDecisions
            : 0,
        totalEncodedPatterns: c.totalEncodedPatterns,
        collidingPatterns: c.collidingPatterns,
        collisionGroupCount: c.collisionGroupCount,
        maxCollisionGroupSize: c.maxCollisionGroupSize,
        logicalPatternKeyMissingCount: c.logicalPatternKeyMissingCount,
      });
    }
    return list.sort((x, y) => x.participantId.localeCompare(y.participantId));
  }

  public getActivationCoverage(): FeatureActivationCoverage {
    const contextCounts: { [k: string]: number } = {};
    let activatedContext = 0;
    const neverActivatedContext: string[] = [];

    for (const name of CONTEXT_FEATURE_NAMES) {
      const cnt = this.contextActivationCounts.get(name) || 0;
      contextCounts[name] = cnt;
      if (cnt > 0) activatedContext++;
      else neverActivatedContext.push(name);
    }

    const patternCounts: { [k: string]: number } = {};
    let activatedPattern = 0;
    const neverActivatedPattern: string[] = [];

    for (const name of PATTERN_FEATURE_NAMES) {
      const cnt = this.patternActivationCounts.get(name) || 0;
      patternCounts[name] = cnt;
      if (cnt > 0) activatedPattern++;
      else neverActivatedPattern.push(name);
    }

    return {
      context: {
        totalFeatures: CONTEXT_FEATURE_NAMES.length,
        activatedFeatures: activatedContext,
        coverageRate:
          CONTEXT_FEATURE_NAMES.length > 0
            ? activatedContext / CONTEXT_FEATURE_NAMES.length
            : 0,
        featureCounts: contextCounts,
        neverActivatedFeatures: neverActivatedContext,
      },
      pattern: {
        totalFeatures: PATTERN_FEATURE_NAMES.length,
        activatedFeatures: activatedPattern,
        coverageRate:
          PATTERN_FEATURE_NAMES.length > 0
            ? activatedPattern / PATTERN_FEATURE_NAMES.length
            : 0,
        featureCounts: patternCounts,
        neverActivatedFeatures: neverActivatedPattern,
      },
    };
  }

  public getGenomeArgmaxTies(): GenomeArgmaxTieMetrics[] {
    const list: GenomeArgmaxTieMetrics[] = [];
    for (const [id, t] of this.tieMap.entries()) {
      list.push({
        participantId: id,
        scoredDecisions: t.scoredDecisions,
        decisionsWithArgmaxTie: t.decisionsWithArgmaxTie,
        argmaxTieRate:
          t.scoredDecisions > 0 ? t.decisionsWithArgmaxTie / t.scoredDecisions : 0,
        totalTopTiedPatterns: t.totalTopTiedPatterns,
        maxTopTieCount: t.maxTopTieCount,
        argmaxTieWithFeatureCollisionCount: t.argmaxTieWithFeatureCollisionCount,
      });
    }
    return list.sort((x, y) => x.participantId.localeCompare(y.participantId));
  }

  public getCounterfactualAgreements(): CounterfactualAgreementMetrics[] {
    const list: CounterfactualAgreementMetrics[] = [];
    for (const [id, a] of this.agreementMap.entries()) {
      const total = a.referenceComparableDecisions;
      list.push({
        participantId: id,
        referenceComparableDecisions: total,
        sameAsFirstLegalCount: a.sameAsFirstLegalCount,
        sameAsFirstLegalRate: total > 0 ? a.sameAsFirstLegalCount / total : 0,
        sameAsZeroGenomeCount: a.sameAsZeroGenomeCount,
        sameAsZeroGenomeRate: total > 0 ? a.sameAsZeroGenomeCount / total : 0,
      });
    }
    return list.sort((x, y) => x.participantId.localeCompare(y.participantId));
  }
}

/**
 * 各プレイヤーの意思決定をインターセプトする透明な Observer Policy。
 * underlyingPolicy が返した DecisionResponse を 1bit も改変せず返却します。
 */
export class DecisionFeatureDiagnosticObserverPolicy implements DecisionPolicy {
  public readonly descriptor: PolicyDescriptor;

  constructor(
    private readonly underlyingPolicy: DecisionPolicy,
    private readonly participantId: string,
    private readonly accumulator: BaselineDiagnosticAccumulator
  ) {
    this.descriptor = underlyingPolicy.descriptor;
  }

  public choose(request: Readonly<DecisionRequest>): DecisionResponse {
    const response = this.underlyingPolicy.choose(request);
    this.accumulator.recordDecision(this.participantId, request, response);
    return response;
  }

  public async decide(request: Readonly<DecisionRequest>): Promise<DecisionResponse> {
    let response: DecisionResponse;
    if (typeof this.underlyingPolicy.decide === "function") {
      response = await this.underlyingPolicy.decide(request);
    } else {
      response = this.choose(request);
    }
    this.accumulator.recordDecision(this.participantId, request, response);
    return response;
  }
}
