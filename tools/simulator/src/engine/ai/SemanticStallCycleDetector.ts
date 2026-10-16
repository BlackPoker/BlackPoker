/**
 * SemanticStallCycleDetector.ts
 *
 * BlackPoker Simulator - AI Semantic Stall / Cycle Diagnostic V1
 *
 * 受動的診断検出器。
 * 1. PRE_DECISION 境界において全5大フィンガープリントを一括採取
 * 2. 直近 M=64 のリングバッファおよび逆引きハッシュインデックスの管理
 * 3. 連続停滞・周期再訪候補・意味的未変化ウィンドウの決定論的シグナル評価
 * 4. 意思決定メタデータの事後関連付け
 * 5. ゲームセッションへの完全非侵襲性 (Mutation ゼロ)
 */

import { DecisionRequest } from "../../domain/decision/DecisionRequest";
import { DecisionResponse } from "../../domain/decision/DecisionResponse";
import { PlayerKey } from "../../domain/decision/DecisionSource";
import { generateLogicalPatternKey } from "../../domain/decision/LogicalPatternKey";
import {
  DiagnosticTraceRecord,
  DiagnosticsMetadata,
  GameSessionSideState,
  SelectedDecisionMetadata,
  SemanticDiagnosticOptions,
  SemanticDiagnosticResult,
  SemanticDiagnosticSignal,
  SemanticFingerprints,
  CycleCandidateInfo,
  SEMANTIC_DIAGNOSTIC_SIGNALS,
  SemanticDiagnosticValidationError,
} from "../../domain/ai/SemanticDiagnosticTypes";
import { SemanticFingerprintCalculator } from "./SemanticFingerprintCalculator";

interface PendingSnapshot {
  readonly stepIndex: number;
  readonly turnCount: number;
  readonly activePlayer: PlayerKey;
  readonly decisionSource: string;
  readonly fingerprints: SemanticFingerprints;
  readonly diagnostics: DiagnosticsMetadata;
}

export class SemanticStallCycleDetector {
  private readonly historySize: number;
  private readonly traceRetentionLimit: number;
  private readonly consecutiveRepeatThreshold: number;
  private readonly periodicMinOccurrences: number;
  private readonly noSemanticChangeWindow: number;
  private readonly onTraceRecord?: (record: DiagnosticTraceRecord) => void;

  private totalTraceCount = 0;
  private readonly retainedTraces: DiagnosticTraceRecord[] = [];
  private readonly ringBuffer: DiagnosticTraceRecord[] = [];
  private readonly invertedIndices: Record<keyof SemanticFingerprints, Map<string, number[]>>;
  private readonly signalsEncountered = new Set<SemanticDiagnosticSignal>();
  private readonly signalCounts: Record<SemanticDiagnosticSignal, number>;

  private pendingSnapshot?: PendingSnapshot;
  private lastFingerprints?: SemanticFingerprints;
  private consecutiveStructuralCount = 0;
  private consecutiveDecisionRequestCount = 0;
  private consecutivePolicyInputCount = 0;

  constructor(options?: SemanticDiagnosticOptions) {
    const historySize = options?.historySize ?? 64;
    if (typeof historySize !== "number" || !Number.isInteger(historySize) || historySize < 1) {
      throw new SemanticDiagnosticValidationError(
        `historySize must be a positive integer >= 1, received: ${options?.historySize}`
      );
    }
    this.historySize = historySize;

    const traceRetentionLimit = options?.traceRetentionLimit ?? this.historySize;
    if (typeof traceRetentionLimit !== "number" || !Number.isInteger(traceRetentionLimit) || traceRetentionLimit < 1) {
      throw new SemanticDiagnosticValidationError(
        `traceRetentionLimit must be a positive integer >= 1, received: ${options?.traceRetentionLimit}`
      );
    }
    if (traceRetentionLimit > this.historySize) {
      throw new SemanticDiagnosticValidationError(
        `traceRetentionLimit (${traceRetentionLimit}) cannot exceed historySize (${this.historySize})`
      );
    }
    this.traceRetentionLimit = traceRetentionLimit;

    const consecutiveRepeatThreshold = options?.consecutiveRepeatThreshold ?? 3;
    if (
      typeof consecutiveRepeatThreshold !== "number" ||
      !Number.isInteger(consecutiveRepeatThreshold) ||
      consecutiveRepeatThreshold < 1
    ) {
      throw new SemanticDiagnosticValidationError(
        `consecutiveRepeatThreshold must be a positive integer >= 1, received: ${options?.consecutiveRepeatThreshold}`
      );
    }
    this.consecutiveRepeatThreshold = consecutiveRepeatThreshold;

    const periodicMinOccurrences = options?.periodicMinOccurrences ?? 3;
    if (
      typeof periodicMinOccurrences !== "number" ||
      !Number.isInteger(periodicMinOccurrences) ||
      periodicMinOccurrences < 1
    ) {
      throw new SemanticDiagnosticValidationError(
        `periodicMinOccurrences must be a positive integer >= 1, received: ${options?.periodicMinOccurrences}`
      );
    }
    this.periodicMinOccurrences = periodicMinOccurrences;

    const noSemanticChangeWindow = options?.noSemanticChangeWindow ?? 20;
    if (
      typeof noSemanticChangeWindow !== "number" ||
      !Number.isInteger(noSemanticChangeWindow) ||
      noSemanticChangeWindow < 1
    ) {
      throw new SemanticDiagnosticValidationError(
        `noSemanticChangeWindow must be a positive integer >= 1, received: ${options?.noSemanticChangeWindow}`
      );
    }
    this.noSemanticChangeWindow = noSemanticChangeWindow;

    this.onTraceRecord = options?.onTraceRecord;

    this.invertedIndices = {
      structural: new Map(),
      structuralTurnInvariant: new Map(),
      observation: new Map(),
      decisionRequest: new Map(),
      policyInput: new Map(),
    };

    this.signalCounts = {} as Record<SemanticDiagnosticSignal, number>;
    for (const sig of SEMANTIC_DIAGNOSTIC_SIGNALS) {
      this.signalCounts[sig] = 0;
    }
  }

  /**
   * CANONICAL SAMPLING POINT: PRE_DECISION
   * WAITING_FOR_DECISION 到達直後、policy.choose 呼び出し前の単一時点で全 Fingerprint を採取
   */
  public preDecision(
    stepIndex: number,
    state: any,
    sideState: GameSessionSideState | undefined,
    request: Readonly<DecisionRequest>
  ): SemanticFingerprints {
    const fingerprints = SemanticFingerprintCalculator.computeAll(state, sideState, request);

    // 1. 連続停滞カウンタの更新
    if (this.lastFingerprints) {
      if (fingerprints.structural === this.lastFingerprints.structural) {
        this.consecutiveStructuralCount++;
      } else {
        this.consecutiveStructuralCount = 1;
      }

      if (fingerprints.decisionRequest === this.lastFingerprints.decisionRequest) {
        this.consecutiveDecisionRequestCount++;
      } else {
        this.consecutiveDecisionRequestCount = 1;
      }

      if (fingerprints.policyInput === this.lastFingerprints.policyInput) {
        this.consecutivePolicyInputCount++;
      } else {
        this.consecutivePolicyInputCount = 1;
      }
    } else {
      this.consecutiveStructuralCount = 1;
      this.consecutiveDecisionRequestCount = 1;
      this.consecutivePolicyInputCount = 1;
    }
    this.lastFingerprints = fingerprints;

    // 2. 周期候補の検出 (k >= 2)
    const cycleCandidate = this.detectPeriodicCandidate(fingerprints);

    // 3. シグナルの判定
    let signal: SemanticDiagnosticSignal = "NO_SIGNAL";

    if (this.consecutiveStructuralCount >= this.consecutiveRepeatThreshold) {
      signal = "REPEATED_STRUCTURAL_FINGERPRINT";
    } else if (this.consecutiveDecisionRequestCount >= this.consecutiveRepeatThreshold) {
      signal = "REPEATED_DECISION_REQUEST";
    } else if (this.consecutivePolicyInputCount >= this.consecutiveRepeatThreshold) {
      signal = "REPEATED_POLICY_INPUT";
    } else if (cycleCandidate !== null) {
      signal = "PERIODIC_FINGERPRINT_CANDIDATE";
    } else if (
      this.ringBuffer.length >= this.noSemanticChangeWindow &&
      this.checkNoSemanticChange()
    ) {
      signal = "NO_SEMANTIC_CHANGE_WINDOW";
    }

    this.signalsEncountered.add(signal);
    this.signalCounts[signal]++;

    const diagnostics: DiagnosticsMetadata = {
      structuralStallCount: this.consecutiveStructuralCount,
      policyInputStallCount: this.consecutivePolicyInputCount,
      cycleCandidate,
      signal,
    };

    this.pendingSnapshot = {
      stepIndex,
      turnCount: state.turnCount ?? 1,
      activePlayer: request.playerId,
      decisionSource: request.source?.type || "UNKNOWN",
      fingerprints,
      diagnostics,
    };

    return fingerprints;
  }

  /**
   * policy.choose 完了後、submitDecision 呼び出し前に選択された決定メタデータを紐付け
   */
  public recordDecision(
    response: DecisionResponse,
    request: Readonly<DecisionRequest>
  ): DiagnosticTraceRecord {
    if (!this.pendingSnapshot) {
      throw new Error(
        "SemanticStallCycleDetector: recordDecision called before preDecision snapshot was captured."
      );
    }

    const selectedPat = request.patterns?.[response.selectedPatternRef];
    const selectedPatternKind = selectedPat?.kind || "UNKNOWN";
    let actionId: string | null = null;

    if (selectedPat?.actionSelectionRef !== undefined) {
      actionId = request.catalog?.actions?.[selectedPat.actionSelectionRef]?.actionId ?? null;
    }

    const selectedLogicalPatternKey = generateLogicalPatternKey({
      kind: selectedPatternKind,
      actionSelectionRef: selectedPat?.actionSelectionRef,
      keyCardSelectionRef: selectedPat?.keyCardSelectionRef,
      keyUnitSelectionRef: selectedPat?.keyUnitSelectionRef,
      costPaymentRef: selectedPat?.costPaymentRef,
      targetSelectionRef: selectedPat?.targetSelectionRef,
      effectSelectionRef: selectedPat?.effectSelectionRef,
      orderSelectionRef: selectedPat?.orderSelectionRef,
    });

    const selectedDecision: SelectedDecisionMetadata = {
      selectedPatternRef: response.selectedPatternRef,
      selectedPatternKind,
      actionId,
      selectedLogicalPatternKey,
    };

    const record: DiagnosticTraceRecord = {
      stepIndex: this.pendingSnapshot.stepIndex,
      boundary: "PRE_DECISION",
      turnCount: this.pendingSnapshot.turnCount,
      activePlayer: this.pendingSnapshot.activePlayer,
      decisionSource: this.pendingSnapshot.decisionSource,
      fingerprints: this.pendingSnapshot.fingerprints,
      selectedDecision,
      diagnostics: this.pendingSnapshot.diagnostics,
    };

    this.totalTraceCount++;
    if (this.retainedTraces.length >= this.traceRetentionLimit) {
      this.retainedTraces.shift();
    }
    this.retainedTraces.push(record);

    const fpTypes: (keyof SemanticFingerprints)[] = [
      "structural",
      "structuralTurnInvariant",
      "observation",
      "decisionRequest",
      "policyInput",
    ];

    // リングバッファ更新 & Inverted Index 整合性維持 (Bounded Eviction)
    if (this.ringBuffer.length >= this.historySize) {
      const evicted = this.ringBuffer.shift()!;
      for (const fpType of fpTypes) {
        const map = this.invertedIndices[fpType];
        const val = evicted.fingerprints[fpType];
        const list = map.get(val);
        if (list) {
          const nextList = list.filter((idx) => idx !== evicted.stepIndex);
          if (nextList.length > 0) {
            map.set(val, nextList);
          } else {
            map.delete(val);
          }
        }
      }
    }
    this.ringBuffer.push(record);
    for (const fpType of fpTypes) {
      const map = this.invertedIndices[fpType];
      const val = record.fingerprints[fpType];
      const list = map.get(val) || [];
      list.push(record.stepIndex);
      map.set(val, list);
    }

    this.pendingSnapshot = undefined;

    if (this.onTraceRecord) {
      this.onTraceRecord(record);
    }

    return record;
  }

  /**
   * シミュレーション完了時に返却される結果集計
   */
  public getResult(): SemanticDiagnosticResult {
    return {
      semanticDiagnosticVersion: 1,
      totalTraceCount: this.totalTraceCount,
      traceRetentionLimit: this.traceRetentionLimit,
      traceTruncated: this.totalTraceCount > this.traceRetentionLimit,
      traces: this.retainedTraces,
      finalSignals: Array.from(this.signalsEncountered),
      signalCounts: { ...this.signalCounts },
    };
  }

  /**
   * 診断テレメトリ検証用: 指定フィンガープリント種別の Inverted Hash Index を取得
   */
  public getInvertedIndex(fpType: keyof SemanticFingerprints): ReadonlyMap<string, readonly number[]> {
    return this.invertedIndices[fpType];
  }

  // =========================================================================
  // Private Detection Utilities
  // =========================================================================

  /**
   * リングバッファ内で周期 k >= 2 の反復再訪パターンを探索
   */
  private detectPeriodicCandidate(currentFp: SemanticFingerprints): CycleCandidateInfo | null {
    if (this.ringBuffer.length < this.periodicMinOccurrences * 2) {
      return null;
    }

    const fpTypes: (keyof SemanticFingerprints)[] = [
      "structuralTurnInvariant",
      "structural",
      "policyInput",
      "decisionRequest",
      "observation",
    ];

    const bufLen = this.ringBuffer.length;
    const maxPeriod = Math.floor(bufLen / (this.periodicMinOccurrences - 1));

    for (const fpType of fpTypes) {
      const currentVal = currentFp[fpType];

      for (let k = 2; k <= Math.min(maxPeriod, 32); k++) {
        let occurrences = 1; // current snapshot counts as 1

        for (let m = 1; m < this.periodicMinOccurrences; m++) {
          const pastIdx = bufLen - m * k;
          if (pastIdx < 0) break;
          if (this.ringBuffer[pastIdx].fingerprints[fpType] === currentVal) {
            occurrences++;
          } else {
            break;
          }
        }

        if (occurrences >= this.periodicMinOccurrences) {
          return {
            period: k,
            occurrences,
            fingerprintType: fpType,
          };
        }
      }
    }

    return null;
  }

  /**
   * 直近 noSemanticChangeWindow 内で意味論的盤面変化が発生していないか確認
   */
  private checkNoSemanticChange(): boolean {
    const windowStart = this.ringBuffer.length - this.noSemanticChangeWindow;
    if (windowStart < 0) return false;

    const baseStructural = this.ringBuffer[windowStart].fingerprints.structural;
    for (let i = windowStart + 1; i < this.ringBuffer.length; i++) {
      if (this.ringBuffer[i].fingerprints.structural !== baseStructural) {
        return false;
      }
    }
    return true;
  }
}
