import { DecisionPolicy, PolicyDescriptor } from "../simulation/DecisionPolicy";
import { DecisionRequest } from "../../domain/decision/DecisionRequest";
import { DecisionResponse } from "../../domain/decision/DecisionResponse";
import { PolicyDecisionRecord } from "../../domain/ai/PolicyExperimentTypes";

/**
 * 意思決定行動を安全に観測・記録する軽量ラッパー Policy。
 *
 * 【設計原則】
 * 1. 透過性: underlyingPolicy が返した DecisionResponse (selectedPatternRef 等) を一切変更せず返却します。
 * 2. Failure Semantics 非破壊: 観測処理（コールバック呼び出しやパターン参照）によって新たな例外を一切発生させません。
 *    selectedPatternRef が範囲外（負数、インデックス超過等）の場合でも throw せず、"OTHER" として安全に記録します。
 * 3. 外部 Accumulator 連携: 各試合・各座席ごとに fresh なインスタンスが生成され、Experiment Runner が所有する
 *    外部コールバックへ意思決定コンテキストを通知します。
 */
export class DecisionBehaviorObserverPolicy implements DecisionPolicy {
  public readonly descriptor: PolicyDescriptor;

  constructor(
    private readonly underlyingPolicy: DecisionPolicy,
    private readonly participantId: string,
    private readonly legId: string,
    private readonly matchIndex: number,
    private readonly seat: "p1" | "p2",
    private readonly onDecision: (record: PolicyDecisionRecord) => void
  ) {
    this.descriptor = underlyingPolicy.descriptor;
  }

  public choose(request: Readonly<DecisionRequest>): DecisionResponse {
    // 1. 元の Policy で意思決定を実行 (ここで発生した例外はそのまま上位へ伝搬)
    const response = this.underlyingPolicy.choose(request);

    // 2. 意思決定内容を安全に観測・記録 (例外は絶対に漏らさない)
    this.recordDecisionSafely(request, response);

    return response;
  }

  public async decide(request: Readonly<DecisionRequest>): Promise<DecisionResponse> {
    let response: DecisionResponse;
    if (typeof this.underlyingPolicy.decide === "function") {
      response = await this.underlyingPolicy.decide(request);
      this.recordDecisionSafely(request, response);
      return response;
    } else {
      return this.choose(request);
    }
  }

  /**
   * 観測レコードを抽出し、外部コールバックへ通知
   */
  private recordDecisionSafely(
    request: Readonly<DecisionRequest>,
    response: Readonly<DecisionResponse>
  ): void {
    try {
      const selectedRef = response?.selectedPatternRef;
      const patterns = request?.patterns;

      const isValidIndex =
        Array.isArray(patterns) &&
        typeof selectedRef === "number" &&
        Number.isInteger(selectedRef) &&
        selectedRef >= 0 &&
        selectedRef < patterns.length;

      const pattern = isValidIndex ? patterns[selectedRef] : undefined;
      const selectedPatternKind = pattern?.kind ?? "OTHER";
      const decisionSource = request?.source?.type ?? "OTHER";

      this.onDecision({
        participantId: this.participantId,
        legId: this.legId,
        matchIndex: this.matchIndex,
        seat: this.seat,
        decisionSource,
        selectedPatternKind,
      });
    } catch {
      // 観測処理の失敗によってシミュレーションの挙動を変えてはならないため、安全に握り潰す
    }
  }
}
