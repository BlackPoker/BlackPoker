import { BlackPokerPolicy } from "./BlackPokerPolicy";
import { DecisionRequest } from "../domain/decision/DecisionRequest";
import { DecisionResponse } from "../domain/decision/DecisionResponse";

/**
 * 注入可能な乱数生成器を用いてランダムに合法手を選択するポリシー。
 */
export class RandomPolicy implements BlackPokerPolicy {
  private randomFn: () => number;

  constructor(randomFn: () => number = Math.random) {
    this.randomFn = randomFn;
  }

  async decide(request: Readonly<DecisionRequest>): Promise<DecisionResponse> {
    if (request.patterns.length === 0) {
      throw new Error(`選択可能な合法パターンが存在しません (DecisionId: ${request.decisionId})`);
    }

    const randomIndex = Math.floor(this.randomFn() * request.patterns.length);
    const clampedIndex = Math.max(0, Math.min(randomIndex, request.patterns.length - 1));

    return {
      decisionId: request.decisionId,
      stateVersion: request.stateVersion,
      selectedPatternRef: clampedIndex,
    };
  }
}
