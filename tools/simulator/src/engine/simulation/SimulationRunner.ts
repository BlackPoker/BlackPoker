import { GameSession } from "../session/GameSession";
import { PlayerKey } from "../../domain/decision/DecisionSource";
import { DecisionPolicy } from "./DecisionPolicy";
import { CanonicalMatchLog } from "../../domain/log/CanonicalMatchLog";

/**
 * シミュレーション中の意思決定ステップのトレース記録
 */
export interface SimulationStepRecord {
  readonly stepCount: number;
  readonly decisionId: string;
  readonly playerId: PlayerKey;
  readonly stateVersion: number;
  readonly selectedPatternRef: number;
  readonly patternKind: string;
  readonly actionId?: string;
  readonly policyKind: string;
}

export interface SimulationResult {
  readonly completed: boolean;
  readonly totalDecisions: number;
  readonly turnCount: number;
  readonly winner?: string;
  readonly reason?: string;
  readonly finalState: any;
  /** 各 Decision の決定履歴 (再現性・検証用) */
  readonly decisionTrace: readonly SimulationStepRecord[];
  /** ゲームセッションの公式ログ */
  readonly matchLog?: CanonicalMatchLog;
}

export interface SimulationOptions {
  readonly maxDecisions?: number;
  readonly onStep?: (info: {
    stepCount: number;
    decisionPlayer: PlayerKey;
    actionSummary: string;
    record: SimulationStepRecord;
  }) => void;
}

/**
 * UIなしでゲームセッションを自動進行・対戦させるシミュレーション実行エンジン。
 * AI Policy には合法的観測情報 (DecisionRequest) のみを渡し、生 GameState は遮断します。
 */
export class SimulationRunner {
  static run(
    session: GameSession,
    policies: Record<string, DecisionPolicy>,
    options?: SimulationOptions
  ): SimulationResult {
    const maxDecisions = options?.maxDecisions ?? 500;
    let totalDecisions = 0;
    const decisionTrace: SimulationStepRecord[] = [];

    while (totalDecisions < maxDecisions) {
      const step = session.advance();

      if (step.type === "FINISHED") {
        return {
          completed: true,
          totalDecisions,
          turnCount: session.state.turnCount || 1,
          winner: step.result.winner,
          reason: step.result.reason,
          finalState: session.state,
          decisionTrace,
          matchLog: session.getMatchLog ? session.getMatchLog() : undefined,
        };
      }

      if (step.type === "WAITING_FOR_DECISION") {
        const playerId = step.request.playerId as PlayerKey;
        const policy = policies[playerId];
        if (!policy) {
          throw new Error(`プレイヤー '${playerId}' に対する DecisionPolicy が設定されていません。`);
        }

        // AI Policy には合法的観測情報 (step.request) のみを渡す (生 GameState は渡さない)
        const response = policy.choose(step.request);
        totalDecisions++;

        const selectedPat = step.request.patterns[response.selectedPatternRef];
        const patternKind = selectedPat?.kind || "UNKNOWN";
        let actionId: string | undefined;

        if (selectedPat?.actionSelectionRef !== undefined) {
          actionId = step.request.catalog.actions[selectedPat.actionSelectionRef]?.actionId;
        }

        const stepRecord: SimulationStepRecord = {
          stepCount: totalDecisions,
          decisionId: response.decisionId,
          playerId,
          stateVersion: response.stateVersion,
          selectedPatternRef: response.selectedPatternRef,
          patternKind,
          actionId,
          policyKind: policy.descriptor.kind,
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

    return {
      completed: false,
      totalDecisions,
      turnCount: session.state.turnCount || 1,
      reason: `最大判断回数 (${maxDecisions}) に到達しました。`,
      finalState: session.state,
      decisionTrace,
      matchLog: session.getMatchLog ? session.getMatchLog() : undefined,
    };
  }
}
