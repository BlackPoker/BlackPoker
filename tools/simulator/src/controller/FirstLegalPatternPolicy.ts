import { BlackPokerPolicy, PolicyDescriptor } from "./BlackPokerPolicy";
import { DecisionRequest } from "../domain/decision/DecisionRequest";
import { DecisionResponse } from "../domain/decision/DecisionResponse";

/**
 * 常に最初の合法手（インデックス 0）を選択する確定的なポリシー。
 */
export class FirstLegalPatternPolicy implements BlackPokerPolicy {
  readonly descriptor: PolicyDescriptor = {
    kind: "firstLegal",
    policyVersion: 1,
    name: "FirstLegalPatternPolicy",
  };

  choose(request: Readonly<DecisionRequest>): DecisionResponse {
    if (!request.patterns || request.patterns.length === 0) {
      throw new Error(`選択可能な合法パターンが存在しません (DecisionId: ${request.decisionId})`);
    }

    return {
      decisionId: request.decisionId,
      stateVersion: request.stateVersion,
      selectedPatternRef: 0,
    };
  }

  async decide(request: Readonly<DecisionRequest>): Promise<DecisionResponse> {
    return this.choose(request);
  }
}
