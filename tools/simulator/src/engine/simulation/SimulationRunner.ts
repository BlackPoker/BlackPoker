import { GameSession } from "../session/GameSession";
import { PlayerKey } from "../../domain/decision/DecisionSource";
import { DecisionPolicy, PolicyDescriptor } from "./DecisionPolicy";
import { CanonicalMatchLog } from "../../domain/log/CanonicalMatchLog";
import { StateHasher } from "./StateHasher";

/**
 * 決定論的 Logical Pattern Key を生成。
 * 各 LegalPattern の selection refs から意味論的な一意識別キーを算出します。
 */
export function generateLogicalPatternKey(pattern: {
  kind: string;
  actionSelectionRef?: number;
  keyCardSelectionRef?: number;
  keyUnitSelectionRef?: number;
  costPaymentRef?: number;
  targetSelectionRef?: number;
  effectSelectionRef?: number;
  orderSelectionRef?: number;
}): string {
  if (pattern.kind === "PASS") return "PASS";
  const parts = [pattern.kind];
  if (pattern.actionSelectionRef !== undefined) parts.push(`a=${pattern.actionSelectionRef}`);
  if (pattern.keyCardSelectionRef !== undefined) parts.push(`k=${pattern.keyCardSelectionRef}`);
  if (pattern.keyUnitSelectionRef !== undefined) parts.push(`ku=${pattern.keyUnitSelectionRef}`);
  if (pattern.costPaymentRef !== undefined) parts.push(`c=${pattern.costPaymentRef}`);
  if (pattern.targetSelectionRef !== undefined) parts.push(`t=${pattern.targetSelectionRef}`);
  if (pattern.effectSelectionRef !== undefined) parts.push(`e=${pattern.effectSelectionRef}`);
  if (pattern.orderSelectionRef !== undefined) parts.push(`o=${pattern.orderSelectionRef}`);
  return parts.join("|");
}

/**
 * 各 DecisionRequest 時点で選択可能だった合法パターンの公開サマリー (Decision Trace v2)
 * ※ 生の秘密情報は含めず、カタログ参照 (refs) および決定論的 logicalPatternKey を保持します。
 */
export interface DecisionLegalPatternSummary {
  readonly patternRef: number;
  readonly logicalPatternKey: string;
  readonly kind: string;
  readonly actionId?: string;
  readonly actionSelectionRef?: number;
  readonly keyCardSelectionRef?: number;
  readonly keyUnitSelectionRef?: number;
  readonly costPaymentRef?: number;
  readonly targetSelectionRef?: number;
  readonly effectSelectionRef?: number;
  readonly orderSelectionRef?: number;
}

/**
 * シミュレーション中の意思決定ステップの Decision Trace v2 レコード
 */
export interface DecisionTraceRecord {
  readonly stepCount: number;
  /** 決定論的 Logical Decision ID (同一seed再実行で100%一致) */
  readonly logicalDecisionId: string;
  /** 実行時動的 Decision ID (GameSession / Canonical Match Log 照合用) */
  readonly runtimeDecisionId: string;
  readonly playerId: PlayerKey;
  readonly stateVersion: number;
  /** この意思決定直前の論理ゲーム状態のハッシュ値 (State Hash v2: "sh2-...") */
  readonly stateHash: string;
  /** 選択可能だった合法パターン一覧 (logicalPatternKey 付き) */
  readonly legalPatterns: readonly DecisionLegalPatternSummary[];
  /** 選択されたパターン番号 (インデックス) */
  readonly selectedPatternRef: number;
  /** 選択されたパターンの決定論的 Logical Key */
  readonly selectedLogicalPatternKey: string;
  /** 選択されたパターンの種別 ("ACTION", "PASS", "EFFECT_SELECTION" 等) */
  readonly selectedPatternKind: string;
  /** アクション種別 (該当する場合) */
  readonly actionId?: string;
  /** 意思決定を行った Policy のバージョン付き記述子 */
  readonly policyDescriptor: PolicyDescriptor;
}

/**
 * 意思決定トレースのコンテナ構造 (Decision Trace v2)
 */
export interface DecisionTrace {
  readonly decisionTraceVersion: number;
  readonly records: readonly DecisionTraceRecord[];
}

export interface SimulationResult {
  readonly completed: boolean;
  readonly totalDecisions: number;
  readonly turnCount: number;
  readonly winner?: string;
  readonly reason?: string;
  readonly finalState: any;
  /** Decision Trace フォーマットバージョン (常に 2) */
  readonly decisionTraceVersion: number;
  /** 各 Decision の決定履歴 (再現性・検証用) */
  readonly decisionTrace: readonly DecisionTraceRecord[];
  /** 終了時論理状態のハッシュ値 (State Hash v2: "sh2-...") */
  readonly finalStateHash?: string;
  /** ゲームセッションの公式ログ */
  readonly matchLog?: CanonicalMatchLog;
}

export interface SimulationOptions {
  readonly maxDecisions?: number;
  readonly onStep?: (info: {
    stepCount: number;
    decisionPlayer: PlayerKey;
    actionSummary: string;
    record: DecisionTraceRecord;
  }) => void;
}

/**
 * UIなしでゲームセッションを自動進行・対戦させるシミュレーション実行エンジン。
 * AI Policy には合法的観測情報 (DecisionRequest) のみを渡し、生 GameState は遮断します。
 */
export class SimulationRunner {
  public static readonly DECISION_TRACE_VERSION = 2;

  /**
   * 決定論的 Logical Decision ID を生成
   */
  private static generateLogicalDecisionId(
    stepCount: number,
    playerId: PlayerKey,
    stateVersion: number,
    stateHash: string
  ): string {
    const stepPad = String(stepCount).padStart(6, "0");
    const hashShort = stateHash.startsWith("sh2-") ? stateHash.slice(4, 12) : stateHash.slice(0, 8);
    return `d2-${stepPad}-${playerId}-v${stateVersion}-${hashShort}`;
  }

  static run(
    session: GameSession,
    policies: Record<string, DecisionPolicy>,
    options?: SimulationOptions
  ): SimulationResult {
    const maxDecisions = options?.maxDecisions ?? 500;
    let totalDecisions = 0;
    const decisionTrace: DecisionTraceRecord[] = [];

    while (totalDecisions < maxDecisions) {
      const step = session.advance();

      if (step.type === "FINISHED") {
        const finalStateHash = StateHasher.hash(session.state);
        return {
          completed: true,
          totalDecisions,
          turnCount: session.state.turnCount || 1,
          winner: step.result.winner,
          reason: step.result.reason,
          finalState: session.state,
          decisionTraceVersion: this.DECISION_TRACE_VERSION,
          decisionTrace,
          finalStateHash,
          matchLog: session.getMatchLog ? session.getMatchLog() : undefined,
        };
      }

      if (step.type === "WAITING_FOR_DECISION") {
        const playerId = step.request.playerId as PlayerKey;
        const policy = policies[playerId];
        if (!policy) {
          throw new Error(`プレイヤー '${playerId}' に対する DecisionPolicy が設定されていません。`);
        }

        // 1. Decision 直前の Logical State Hash を算出 (State Hash v2)
        const currentStateHash = StateHasher.hash(session.state);

        // 2. 選択可能な合法パターンサマリーを生成 (logicalPatternKey 付き、秘密情報は含まない)
        const legalPatterns: DecisionLegalPatternSummary[] = (step.request.patterns || []).map((p, idx) => {
          let actId: string | undefined;
          if (p.actionSelectionRef !== undefined) {
            actId = step.request.catalog?.actions?.[p.actionSelectionRef]?.actionId;
          }

          const logicalKey = generateLogicalPatternKey({
            kind: p.kind || "UNKNOWN",
            actionSelectionRef: p.actionSelectionRef,
            keyCardSelectionRef: p.keyCardSelectionRef,
            keyUnitSelectionRef: p.keyUnitSelectionRef,
            costPaymentRef: p.costPaymentRef,
            targetSelectionRef: p.targetSelectionRef,
            effectSelectionRef: p.effectSelectionRef,
            orderSelectionRef: p.orderSelectionRef,
          });

          return {
            patternRef: idx,
            logicalPatternKey: logicalKey,
            kind: p.kind || "UNKNOWN",
            actionId: actId,
            actionSelectionRef: p.actionSelectionRef,
            keyCardSelectionRef: p.keyCardSelectionRef,
            keyUnitSelectionRef: p.keyUnitSelectionRef,
            costPaymentRef: p.costPaymentRef,
            targetSelectionRef: p.targetSelectionRef,
            effectSelectionRef: p.effectSelectionRef,
            orderSelectionRef: p.orderSelectionRef,
          };
        });

        // 3. AI Policy には合法的観測情報 (step.request) のみを渡す (生 GameState は渡さない)
        const response = policy.choose(step.request);
        totalDecisions++;

        const selectedPat = step.request.patterns[response.selectedPatternRef];
        const selectedPatternKind = selectedPat?.kind || "UNKNOWN";
        let actionId: string | undefined;

        if (selectedPat?.actionSelectionRef !== undefined) {
          actionId = step.request.catalog?.actions?.[selectedPat.actionSelectionRef]?.actionId;
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

        const logicalDecisionId = this.generateLogicalDecisionId(
          totalDecisions,
          playerId,
          response.stateVersion,
          currentStateHash
        );

        const stepRecord: DecisionTraceRecord = {
          stepCount: totalDecisions,
          logicalDecisionId,
          runtimeDecisionId: response.decisionId,
          playerId,
          stateVersion: response.stateVersion,
          stateHash: currentStateHash,
          legalPatterns,
          selectedPatternRef: response.selectedPatternRef,
          selectedLogicalPatternKey,
          selectedPatternKind,
          actionId,
          policyDescriptor: policy.descriptor,
        };

        decisionTrace.push(stepRecord);

        if (options?.onStep) {
          let summary = "PASS";
          if (actionId) {
            summary = actionId;
          } else if (selectedPat?.effectSelectionRef !== undefined) {
            summary = "EFFECT_SELECTION";
          }
          options.onStep({
            stepCount: totalDecisions,
            decisionPlayer: playerId,
            actionSummary: summary,
            record: stepRecord,
          });
        }

        session.submitDecision(response);
      }
    }

    const finalStateHash = StateHasher.hash(session.state);
    return {
      completed: false,
      totalDecisions,
      turnCount: session.state.turnCount || 1,
      reason: `最大判断回数 (${maxDecisions}) に到達しました。`,
      finalState: session.state,
      decisionTraceVersion: this.DECISION_TRACE_VERSION,
      decisionTrace,
      finalStateHash,
      matchLog: session.getMatchLog ? session.getMatchLog() : undefined,
    };
  }
}
