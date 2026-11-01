import { DecisionTraceRecord, DecisionLegalPatternSummary } from "./SimulationRunner.js";
import { PlayerKey } from "../../domain/decision/DecisionSource.js";

/**
 * 過去の R2 Evidence に関する限界の公式表明
 */
export const R2_HISTORICAL_LIMITATION_NOTE =
  "過去の R2 Evidence (standard-pack-evolution-pilot-v1-r2.json) には個別の Decision Trace " +
  "が保存されておらず集計サマリーのみが記録されているため、当時の R2 実行における初回分岐ステップを" +
  "確定的に復元することは不可能です。本 FirstDivergenceHunter は、今後取得・実行される対戦 Trace " +
  "間の初回分岐をステップ単位で厳密に特定・分類する目的で使用されます。";

/**
 * 初回分岐の分類種別
 */
export type DivergenceClassification =
  | "NO_DIVERGENCE"                     // 全ステップ、合法手、選択、状態Hashが完全一致
  | "ACTING_PLAYER_MISMATCH"           // 意思決定手番プレイヤーの不一致
  | "STATE_HASH_MISMATCH"              // 意思決定前の状態 Hash の不一致
  | "STATE_VERSION_MISMATCH"           // 状態バージョンの不一致
  | "POLICY_DESCRIPTOR_MISMATCH"       // 適用された PolicyDescriptor の不一致
  | "LEGAL_PATTERNS_COUNT_MISMATCH"    // 提示された合法手パターンの総数不一致
  | "LEGAL_PATTERNS_ORDER_MISMATCH"    // 提示された合法手の順序または内容の不一致
  | "SELECTED_PATTERN_REF_MISMATCH"    // 選択された合法手インデックス (selectedPatternRef) の不一致
  | "SELECTED_LOGICAL_KEY_MISMATCH"    // 選択されたパターンの Logical Key の不一致
  | "SELECTED_PATTERN_KIND_MISMATCH"   // 選択されたパターンの種別 (kind) の不一致
  | "ACTION_ID_MISMATCH"               // 選択されたアクション ID の不一致
  | "TRACE_LENGTH_MISMATCH";           // 全ステップ一致したが Trace の長さ (ステップ数) が異なる

/**
 * 初回分岐診断レポート
 */
export interface DivergenceReport {
  readonly status: "NO_DIVERGENCE" | "DIVERGENCE_DETECTED";
  readonly classification: DivergenceClassification;
  readonly divergenceStepIndex?: number;
  readonly divergenceLogicalDecisionId?: string;
  readonly actingPlayer?: PlayerKey;
  readonly preStateHashA?: string;
  readonly preStateHashB?: string;
  readonly explanation: string;
  readonly traceALength: number;
  readonly traceBLength: number;
  readonly historicalLimitationNote: string;
  readonly details?: {
    readonly stepCount: number;
    readonly traceARecord?: Partial<DecisionTraceRecord>;
    readonly traceBRecord?: Partial<DecisionTraceRecord>;
    readonly diffSummary?: string;
  };
}

/**
 * 2つの合法パターン概要配列が完全一致するかを順序を含めて検証
 */
function compareLegalPatterns(
  patternsA: readonly DecisionLegalPatternSummary[],
  patternsB: readonly DecisionLegalPatternSummary[]
): { match: boolean; diffReason?: string; index?: number } {
  if (patternsA.length !== patternsB.length) {
    return {
      match: false,
      diffReason: `合法手総数の不一致: A=${patternsA.length}, B=${patternsB.length}`,
    };
  }

  for (let i = 0; i < patternsA.length; i++) {
    const a = patternsA[i];
    const b = patternsB[i];

    if (a.logicalPatternKey !== b.logicalPatternKey) {
      return {
        match: false,
        diffReason: `Index ${i} の logicalPatternKey 不一致: A='${a.logicalPatternKey}', B='${b.logicalPatternKey}'`,
        index: i,
      };
    }
    if (a.kind !== b.kind) {
      return {
        match: false,
        diffReason: `Index ${i} の kind 不一致: A='${a.kind}', B='${b.kind}'`,
        index: i,
      };
    }
    if (a.actionId !== b.actionId) {
      return {
        match: false,
        diffReason: `Index ${i} の actionId 不一致: A='${a.actionId}', B='${b.actionId}'`,
        index: i,
      };
    }
  }

  return { match: true };
}

/**
 * 2つの PolicyDescriptor が一致するかを検証
 */
function comparePolicyDescriptors(descA?: any, descB?: any): boolean {
  if (!descA && !descB) return true;
  if (!descA || !descB) return false;
  return (
    descA.kind === descB.kind &&
    descA.policyVersion === descB.policyVersion &&
    descA.name === descB.name &&
    JSON.stringify(descA.metadata ?? {}) === JSON.stringify(descB.metadata ?? {})
  );
}

/**
 * 2つの Decision Trace を順次比較し、最初の不一致（First Divergence）を特定する
 *
 * @param traceA 比較対象 A の Decision Trace
 * @param traceB 比較対象 B の Decision Trace
 * @returns 診断結果レポート。双方が完全一致する場合は NO_DIVERGENCE を返す
 */
export function huntFirstDivergence(
  traceA: readonly DecisionTraceRecord[],
  traceB: readonly DecisionTraceRecord[]
): DivergenceReport {
  const minLen = Math.min(traceA.length, traceB.length);

  for (let i = 0; i < minLen; i++) {
    const recA = traceA[i];
    const recB = traceB[i];

    // 1. 手番プレイヤーの検証
    if (recA.playerId !== recB.playerId) {
      return {
        status: "DIVERGENCE_DETECTED",
        classification: "ACTING_PLAYER_MISMATCH",
        divergenceStepIndex: i,
        divergenceLogicalDecisionId: recA.logicalDecisionId,
        actingPlayer: recA.playerId,
        preStateHashA: recA.stateHash,
        preStateHashB: recB.stateHash,
        explanation: `Step ${i} で手番プレイヤーが不一致: A='${recA.playerId}', B='${recB.playerId}'`,
        traceALength: traceA.length,
        traceBLength: traceB.length,
        historicalLimitationNote: R2_HISTORICAL_LIMITATION_NOTE,
        details: { stepCount: i, traceARecord: recA, traceBRecord: recB },
      };
    }

    // 2. 状態ハッシュの検証 (意思決定前)
    if (recA.stateHash !== recB.stateHash) {
      return {
        status: "DIVERGENCE_DETECTED",
        classification: "STATE_HASH_MISMATCH",
        divergenceStepIndex: i,
        divergenceLogicalDecisionId: recA.logicalDecisionId,
        actingPlayer: recA.playerId,
        preStateHashA: recA.stateHash,
        preStateHashB: recB.stateHash,
        explanation:
          `Step ${i} (${recA.playerId}) の意思決定直前の論理状態 Hash が不一致 (直前のアクション解決または乱数消費で状態が分岐): ` +
          `A='${recA.stateHash}', B='${recB.stateHash}'`,
        traceALength: traceA.length,
        traceBLength: traceB.length,
        historicalLimitationNote: R2_HISTORICAL_LIMITATION_NOTE,
        details: { stepCount: i, traceARecord: recA, traceBRecord: recB },
      };
    }

    // 3. 状態バージョンの検証
    if (recA.stateVersion !== recB.stateVersion) {
      return {
        status: "DIVERGENCE_DETECTED",
        classification: "STATE_VERSION_MISMATCH",
        divergenceStepIndex: i,
        divergenceLogicalDecisionId: recA.logicalDecisionId,
        actingPlayer: recA.playerId,
        preStateHashA: recA.stateHash,
        preStateHashB: recB.stateHash,
        explanation: `Step ${i} で stateVersion が不一致: A=${recA.stateVersion}, B=${recB.stateVersion}`,
        traceALength: traceA.length,
        traceBLength: traceB.length,
        historicalLimitationNote: R2_HISTORICAL_LIMITATION_NOTE,
        details: { stepCount: i, traceARecord: recA, traceBRecord: recB },
      };
    }

    // 4. PolicyDescriptor の検証
    if (!comparePolicyDescriptors(recA.policyDescriptor, recB.policyDescriptor)) {
      return {
        status: "DIVERGENCE_DETECTED",
        classification: "POLICY_DESCRIPTOR_MISMATCH",
        divergenceStepIndex: i,
        divergenceLogicalDecisionId: recA.logicalDecisionId,
        actingPlayer: recA.playerId,
        preStateHashA: recA.stateHash,
        preStateHashB: recB.stateHash,
        explanation:
          `Step ${i} (${recA.playerId}) で policyDescriptor が不一致: ` +
          `A=${JSON.stringify(recA.policyDescriptor)}, B=${JSON.stringify(recB.policyDescriptor)}`,
        traceALength: traceA.length,
        traceBLength: traceB.length,
        historicalLimitationNote: R2_HISTORICAL_LIMITATION_NOTE,
        details: { stepCount: i, traceARecord: recA, traceBRecord: recB },
      };
    }

    // 5. 合法手パターン一覧の検証
    const legalComp = compareLegalPatterns(recA.legalPatterns, recB.legalPatterns);
    if (!legalComp.match) {
      const isCountMismatch = recA.legalPatterns.length !== recB.legalPatterns.length;
      return {
        status: "DIVERGENCE_DETECTED",
        classification: isCountMismatch ? "LEGAL_PATTERNS_COUNT_MISMATCH" : "LEGAL_PATTERNS_ORDER_MISMATCH",
        divergenceStepIndex: i,
        divergenceLogicalDecisionId: recA.logicalDecisionId,
        actingPlayer: recA.playerId,
        preStateHashA: recA.stateHash,
        preStateHashB: recB.stateHash,
        explanation:
          `Step ${i} (${recA.playerId}) で提示された合法手パターンが不一致 (${legalComp.diffReason})`,
        traceALength: traceA.length,
        traceBLength: traceB.length,
        historicalLimitationNote: R2_HISTORICAL_LIMITATION_NOTE,
        details: {
          stepCount: i,
          traceARecord: recA,
          traceBRecord: recB,
          diffSummary: legalComp.diffReason,
        },
      };
    }

    // 6. 選択手インデックス (selectedPatternRef) の検証
    if (recA.selectedPatternRef !== recB.selectedPatternRef) {
      return {
        status: "DIVERGENCE_DETECTED",
        classification: "SELECTED_PATTERN_REF_MISMATCH",
        divergenceStepIndex: i,
        divergenceLogicalDecisionId: recA.logicalDecisionId,
        actingPlayer: recA.playerId,
        preStateHashA: recA.stateHash,
        preStateHashB: recB.stateHash,
        explanation:
          `Step ${i} (${recA.playerId}) で同一合法手一覧から選択された selectedPatternRef が不一致: ` +
          `A=${recA.selectedPatternRef} ('${recA.selectedLogicalPatternKey}'), ` +
          `B=${recB.selectedPatternRef} ('${recB.selectedLogicalPatternKey}')`,
        traceALength: traceA.length,
        traceBLength: traceB.length,
        historicalLimitationNote: R2_HISTORICAL_LIMITATION_NOTE,
        details: {
          stepCount: i,
          traceARecord: recA,
          traceBRecord: recB,
          diffSummary: `A chose ref ${recA.selectedPatternRef}, B chose ref ${recB.selectedPatternRef}`,
        },
      };
    }

    // 7. 選択 Logical Pattern Key の検証
    if (recA.selectedLogicalPatternKey !== recB.selectedLogicalPatternKey) {
      return {
        status: "DIVERGENCE_DETECTED",
        classification: "SELECTED_LOGICAL_KEY_MISMATCH",
        divergenceStepIndex: i,
        divergenceLogicalDecisionId: recA.logicalDecisionId,
        actingPlayer: recA.playerId,
        preStateHashA: recA.stateHash,
        preStateHashB: recB.stateHash,
        explanation:
          `Step ${i} (${recA.playerId}) で選択された selectedLogicalPatternKey が不一致: ` +
          `A='${recA.selectedLogicalPatternKey}', B='${recB.selectedLogicalPatternKey}'`,
        traceALength: traceA.length,
        traceBLength: traceB.length,
        historicalLimitationNote: R2_HISTORICAL_LIMITATION_NOTE,
        details: { stepCount: i, traceARecord: recA, traceBRecord: recB },
      };
    }

    // 8. 選択 Pattern Kind の検証
    if (recA.selectedPatternKind !== recB.selectedPatternKind) {
      return {
        status: "DIVERGENCE_DETECTED",
        classification: "SELECTED_PATTERN_KIND_MISMATCH",
        divergenceStepIndex: i,
        divergenceLogicalDecisionId: recA.logicalDecisionId,
        actingPlayer: recA.playerId,
        preStateHashA: recA.stateHash,
        preStateHashB: recB.stateHash,
        explanation:
          `Step ${i} (${recA.playerId}) で選択された selectedPatternKind が不一致: ` +
          `A='${recA.selectedPatternKind}', B='${recB.selectedPatternKind}'`,
        traceALength: traceA.length,
        traceBLength: traceB.length,
        historicalLimitationNote: R2_HISTORICAL_LIMITATION_NOTE,
        details: { stepCount: i, traceARecord: recA, traceBRecord: recB },
      };
    }

    // 9. actionId の検証
    if (recA.actionId !== recB.actionId) {
      return {
        status: "DIVERGENCE_DETECTED",
        classification: "ACTION_ID_MISMATCH",
        divergenceStepIndex: i,
        divergenceLogicalDecisionId: recA.logicalDecisionId,
        actingPlayer: recA.playerId,
        preStateHashA: recA.stateHash,
        preStateHashB: recB.stateHash,
        explanation:
          `Step ${i} (${recA.playerId}) で actionId が不一致: A='${recA.actionId}', B='${recB.actionId}'`,
        traceALength: traceA.length,
        traceBLength: traceB.length,
        historicalLimitationNote: R2_HISTORICAL_LIMITATION_NOTE,
        details: { stepCount: i, traceARecord: recA, traceBRecord: recB },
      };
    }
  }

  // 10. Trace 長の検証 (全共通ステップが一致していた場合)
  if (traceA.length !== traceB.length) {
    return {
      status: "DIVERGENCE_DETECTED",
      classification: "TRACE_LENGTH_MISMATCH",
      divergenceStepIndex: minLen,
      explanation:
        `全 ${minLen} ステップの意思決定と状態遷移は完全一致しましたが、対戦の総ステップ数が異なります: ` +
        `A=${traceA.length} decisions, B=${traceB.length} decisions (片方が早期終了または延長)`,
      traceALength: traceA.length,
      traceBLength: traceB.length,
      historicalLimitationNote: R2_HISTORICAL_LIMITATION_NOTE,
      details: {
        stepCount: minLen,
        diffSummary: `Trace A has ${traceA.length} steps, Trace B has ${traceB.length} steps`,
      },
    };
  }

  // 全ステップが完全一致
  return {
    status: "NO_DIVERGENCE",
    classification: "NO_DIVERGENCE",
    explanation: `全 ${traceA.length} ステップの意思決定、合法手一覧、選択、状態 Hash が 100% 完全一致しました。`,
    traceALength: traceA.length,
    traceBLength: traceB.length,
    historicalLimitationNote: R2_HISTORICAL_LIMITATION_NOTE,
  };
}
