import { DecisionRequest } from "../../domain/decision/DecisionRequest";
import { DecisionResponse } from "../../domain/decision/DecisionResponse";

/**
 * 自動プレイヤー（AI、テストスクリプト、シミュレーション用Policy）の抽象インターフェース。
 * ゲームセッションの DecisionRequest を受け取り、妥当な DecisionResponse を返します。
 */
export interface DecisionPolicy {
  choose(request: DecisionRequest): DecisionResponse;
}

/**
 * 最初の合法パターン（デフォルトではPASS以外を優先、なければPASS）を選択する基本Policy。
 */
export class FirstLegalPolicy implements DecisionPolicy {
  constructor(private readonly preferPass: boolean = false) {}

  choose(request: DecisionRequest): DecisionResponse {
    if (!request.patterns || request.patterns.length === 0) {
      throw new Error(`DecisionRequest に選択可能なパターンが存在しません: ${request.decisionId}`);
    }

    let selectedIndex = 0;

    if (this.preferPass) {
      const passIdx = request.patterns.findIndex((p) => p.kind === "PASS");
      selectedIndex = passIdx !== -1 ? passIdx : 0;
    } else {
      const nonPassIdx = request.patterns.findIndex((p) => p.kind !== "PASS");
      selectedIndex = nonPassIdx !== -1 ? nonPassIdx : 0;
    }

    return {
      decisionId: request.decisionId,
      stateVersion: request.stateVersion,
      selectedPatternRef: selectedIndex,
    };
  }
}

/**
 * 指定された判断ルール関数（フィルター・セレクター）を順番または条件付きで適用するスクリプトPolicy。
 */
export class ScriptedPolicy implements DecisionPolicy {
  constructor(
    private readonly chooser: (request: DecisionRequest) => number | undefined,
    private readonly fallbackPolicy: DecisionPolicy = new FirstLegalPolicy()
  ) {}

  choose(request: DecisionRequest): DecisionResponse {
    const chosenIndex = this.chooser(request);
    if (chosenIndex !== undefined && chosenIndex >= 0 && chosenIndex < request.patterns.length) {
      return {
        decisionId: request.decisionId,
        stateVersion: request.stateVersion,
        selectedPatternRef: chosenIndex,
      };
    }
    return this.fallbackPolicy.choose(request);
  }
}
