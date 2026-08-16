import { GameSession, GameSessionStep } from "./GameSession";
import { MatchControllers } from "../../controller/BlackPokerPolicy";

/**
 * GameSession を指定のコントローラー設定に従って進めるランナー。
 */
export class GameSessionRunner {
  static async runStep(session: GameSession, controllers: MatchControllers): Promise<GameSessionStep> {
    const step = session.advance();

    if (step.type === "WAITING_FOR_DECISION") {
      const decisionPlayer = step.request.playerId;
      const controller = controllers[decisionPlayer];

      if (controller && controller.type === "AI") {
        const response = await controller.policy.decide(step.request);
        return session.submitDecision(response);
      }
    }

    return step;
  }

  /**
   * AI同士など、判断要求が AI 席である限り自動的に連続実行するヘルパー
   */
  static async runUntilHumanOrFinish(
    session: GameSession,
    controllers: MatchControllers,
    maxSteps: number = 50
  ): Promise<GameSessionStep> {
    let currentStep = session.advance();
    let count = 0;

    while (count < maxSteps) {
      if (currentStep.type !== "WAITING_FOR_DECISION") {
        return currentStep;
      }

      const decisionPlayer = currentStep.request.playerId;
      const controller = controllers[decisionPlayer];

      if (!controller || controller.type !== "AI") {
        // 人間の番なので停止して戻す
        return currentStep;
      }

      const response = await controller.policy.decide(currentStep.request);
      currentStep = session.submitDecision(response);
      count++;
    }

    return currentStep;
  }
}
