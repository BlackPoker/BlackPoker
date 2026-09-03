import { GameSession } from "../session/GameSession";
import { PlayerKey } from "../../domain/decision/DecisionSource";
import { DecisionPolicy, PolicyDescriptor } from "./DecisionPolicy";
import { CanonicalMatchLog } from "../../domain/log/CanonicalMatchLog";
import { StateHasher } from "./StateHasher";

/**
 * 各 DecisionRequest 時点で選択可能だった合法パターンの公開サマリー
 */
export interface DecisionLegalPatternSummary {
  readonly patternRef: number;
  readonly patternId?: string;
  readonly kind: string;
  readonly actionId?: string;
}

/**
 * シミュレーション中の意思決定ステップの Decision Trace v1 レコード
 */
export interface DecisionTraceRecord {
  readonly stepCount: number;
  readonly decisionId: string;
  readonly playerId: PlayerKey;
  readonly stateVersion: number;
  /** この意思決定直前の論理ゲーム状態のハッシュ値 */
  readonly stateHash: string;
  /** 選択可能だった合法パターン一覧 */
  readonly legalPatterns: readonly DecisionLegalPatternSummary[];
  /** 選択されたパターン番号 */
  readonly selectedPatternRef: number;
  /** 選択されたパターン識別子 */
  readonly selectedPatternId?: string;
  /** 選択されたパターンの種別 ("ACTION", "PASS", "EFFECT_SELECTION" 等) */
  readonly selectedPatternKind: string;
  /** アクション種別 (該当する場合) */
  readonly actionId?: string;
  /** 意思決定を行った Policy のバージョン付き記述子 */
  readonly policyDescriptor: PolicyDescriptor;
}

/**
 * 意思決定トレースのコンテナ構造 (Decision Trace v1)
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
  /** Decision Trace フォーマットバージョン (常に 1) */
  readonly decisionTraceVersion: number;
  /** 各 Decision の決定履歴 (再現性・検証用) */
  readonly decisionTrace: readonly DecisionTraceRecord[];
  /** 終了時論理状態のハッシュ値 */
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
  public static readonly DECISION_TRACE_VERSION = 1;

  /**
   * ランタイム動的IDが含まれる patternId を決定論的な識別子へ正規化
   */
  private static normalizePatternId(patternId?: string): string | undefined {
    if (!patternId) return undefined;
    return patternId.replace(/unit-\d{10,}-[a-zA-Z0-9]+/g, "unit-dynamic");
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

        // 1. Decision 直前の Logical State Hash を算出
        const currentStateHash = StateHasher.hash(session.state);

        // 2. 選択可能な合法パターンサマリーを生成 (秘密情報は含まない)
        const legalPatterns: DecisionLegalPatternSummary[] = (step.request.patterns || []).map((p, idx) => {
          let actId: string | undefined;
          if (p.actionSelectionRef !== undefined) {
            actId = step.request.catalog?.actions?.[p.actionSelectionRef]?.actionId;
          }
          return {
            patternRef: idx,
            patternId: this.normalizePatternId(p.patternId),
            kind: p.kind || "UNKNOWN",
            actionId: actId,
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

        const stepRecord: DecisionTraceRecord = {
          stepCount: totalDecisions,
          decisionId: response.decisionId,
          playerId,
          stateVersion: response.stateVersion,
          stateHash: currentStateHash,
          legalPatterns,
          selectedPatternRef: response.selectedPatternRef,
          selectedPatternId: this.normalizePatternId(selectedPat?.patternId),
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
