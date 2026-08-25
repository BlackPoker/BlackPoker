import { GameSession, GameResult } from "../session/GameSession";
import { PlayerKey } from "../../domain/decision/DecisionSource";
import { DecisionPolicy } from "./DecisionPolicy";

export interface SimulationResult {
  readonly completed: boolean;
  readonly totalDecisions: number;
  readonly turnCount: number;
  readonly winner?: string;
  readonly reason?: string;
  readonly finalState: any;
}

export interface SimulationOptions {
  readonly maxDecisions?: number;
  readonly onStep?: (info: { stepCount: number; decisionPlayer?: PlayerKey; actionSummary?: string }) => void;
}

/**
 * UIなしでゲームセッションを自動進行・対戦させるシミュレーション実行エンジン。
 */
export class SimulationRunner {
  static run(
    session: GameSession,
    policies: Record<string, DecisionPolicy>,
    options?: SimulationOptions
  ): SimulationResult {
    const maxDecisions = options?.maxDecisions ?? 500;
    let totalDecisions = 0;

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
        };
      }

      if (step.type === "WAITING_FOR_DECISION") {
        const playerId = step.request.playerId;
        const policy = policies[playerId];
        if (!policy) {
          throw new Error(`プレイヤー '${playerId}' に対する DecisionPolicy が設定されていません。`);
        }

        const response = policy.choose(step.request);
        totalDecisions++;

        if (options?.onStep) {
          const selectedPat = step.request.patterns[response.selectedPatternRef];
          let summary = "PASS";
          if (selectedPat?.actionSelectionRef !== undefined) {
            summary = step.request.catalog.actions[selectedPat.actionSelectionRef]?.actionId || "ACTION";
          } else if (selectedPat?.effectSelectionRef !== undefined) {
            summary = "EFFECT_SELECTION";
          }
          options.onStep({
            stepCount: totalDecisions,
            decisionPlayer: playerId as PlayerKey,
            actionSummary: summary,
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
    };
  }
}
