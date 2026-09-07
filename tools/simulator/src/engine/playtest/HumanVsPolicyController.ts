import { GameSession, GameSessionStep } from "../session/GameSession";
import { DecisionRequest } from "../../domain/decision/DecisionRequest";
import { DecisionResponse } from "../../domain/decision/DecisionResponse";
import { DecisionPolicy, PolicyDescriptor } from "../simulation/DecisionPolicy";
import { PlaytestSeatControllers } from "./PlaytestSeatController";
import { FormattedLogEntry } from "../session/playtest/GameEventFormatter";
import { ViewerAwareGameEventFormatter } from "../session/playtest/ViewerAwareGameEventFormatter";
import { PlayerKey } from "../../domain/decision/DecisionSource";

/**
 * 1回の AI 自動意思決定におけるスナップショット記録
 */
export interface AutomatedDecisionRecord {
  readonly playerId: string;
  readonly policyDescriptor: PolicyDescriptor;
  readonly request: DecisionRequest;
  readonly response: DecisionResponse;
  readonly prevState: any;
  readonly nextState: any;
  readonly nextStep: GameSessionStep;
  readonly generatedEvents: readonly FormattedLogEntry[];
}

/**
 * 自動意思決定ループの進行結果。
 * GameSessionStep を汚染せず、Adapter 独自の結果型として定義。
 */
export type AutomatedAdvanceResult =
  | {
      readonly status: "STOPPED";
      readonly reason: "HUMAN_TURN" | "FINISHED";
      readonly step: GameSessionStep;
      readonly records: readonly AutomatedDecisionRecord[];
    }
  | {
      readonly status: "TECHNICAL_ERROR";
      readonly error: Error;
      readonly records: readonly AutomatedDecisionRecord[];
      readonly lastStep?: GameSessionStep;
    };

/**
 * Policy が生成した DecisionResponse の正当性を検証 (fail-fast)
 */
export function validateDecisionResponse(
  request: DecisionRequest,
  response: DecisionResponse,
  policyName: string = "Policy"
): void {
  if (!response || typeof response !== "object") {
    throw new Error(`Policy "${policyName}" が不正なレスポンスを返しました (オブジェクトではありません)`);
  }

  if (response.decisionId !== request.decisionId) {
    throw new Error(
      `Policy "${policyName}" が不一致または古い decisionId を返しました: 期待=${request.decisionId}, 実際=${response.decisionId}`
    );
  }

  if (response.stateVersion !== request.stateVersion) {
    throw new Error(
      `Policy "${policyName}" が不一致または古い stateVersion を返しました: 期待=${request.stateVersion}, 実際=${response.stateVersion}`
    );
  }

  if (
    typeof response.selectedPatternRef !== "number" ||
    !Number.isInteger(response.selectedPatternRef)
  ) {
    throw new Error(
      `Policy "${policyName}" が非整数の selectedPatternRef を返しました: ${response.selectedPatternRef}`
    );
  }

  if (response.selectedPatternRef < 0 || response.selectedPatternRef >= request.patterns.length) {
    throw new Error(
      `Policy "${policyName}" が範囲外の selectedPatternRef を返しました: ${response.selectedPatternRef} (パターン総数: ${request.patterns.length})`
    );
  }
}

/**
 * AI Seat の判断を自動実行し、人間の手番 (HUMAN_TURN) またはゲーム終了 (FINISHED) に達するまで進行。
 * - UI向け非同期契約: policy.decide が存在すれば非同期呼び出し、なければ同期 choose を Promise 化。
 * - 人工ウェイト (Artificial Delay) は含みません。
 */
export async function advanceAutomatedDecisions(
  session: GameSession,
  initialStep: GameSessionStep,
  seatControllers: PlaytestSeatControllers,
  policies: Record<string, DecisionPolicy>,
  options?: {
    maxAutomatedDecisions?: number;
    viewerPlayerId?: PlayerKey;
  }
): Promise<AutomatedAdvanceResult> {
  const maxDecisions = options?.maxAutomatedDecisions ?? 500;
  const records: AutomatedDecisionRecord[] = [];
  let currentStep = initialStep;
  let decisionCount = 0;

  while (true) {
    // 1. 終局または判断待機以外のステップであれば停止
    if (currentStep.type !== "WAITING_FOR_DECISION") {
      return {
        status: "STOPPED",
        reason: "FINISHED",
        step: currentStep,
        records,
      };
    }

    // 2. 現在の席コントローラーを確認
    const playerId = currentStep.request.playerId;
    const seat = playerId === "p1" ? seatControllers.p1 : playerId === "p2" ? seatControllers.p2 : null;

    if (!seat || seat.kind === "HUMAN") {
      // 人間プレイヤーの手番に到達したら正常停止
      return {
        status: "STOPPED",
        reason: "HUMAN_TURN",
        step: currentStep,
        records,
      };
    }

    // 3. AI (POLICY) の場合: 500回上限ガード確認
    if (decisionCount >= maxDecisions) {
      return {
        status: "TECHNICAL_ERROR",
        error: new Error(
          `AI の連続自動意思決定が安全上限 (${maxDecisions}回) を超過しました。無限判断ループの可能性があります。`
        ),
        records,
        lastStep: currentStep,
      };
    }

    // 4. Policy インスタンス取得
    const policy = policies[playerId];
    if (!policy) {
      return {
        status: "TECHNICAL_ERROR",
        error: new Error(`プレイヤー席 "${playerId}" に対する Policy インスタンスが初期化されていません。`),
        records,
        lastStep: currentStep,
      };
    }

    // 5. Policy から意思決定を取得 (非同期 decide() 優先)
    let response: DecisionResponse;
    const policyName = policy.descriptor.name || policy.descriptor.kind;
    try {
      response = await (policy.decide
        ? policy.decide(currentStep.request)
        : Promise.resolve(policy.choose(currentStep.request)));

      // 6. レスポンスの厳格バリデーション (fail-fast)
      validateDecisionResponse(currentStep.request, response, policyName);
    } catch (err: any) {
      return {
        status: "TECHNICAL_ERROR",
        error: err instanceof Error ? err : new Error(String(err)),
        records,
        lastStep: currentStep,
      };
    }

    // 7. 同一の session.submitDecision 経路で進行
    const prevState = JSON.parse(JSON.stringify(session.state));
    const nextStep = session.submitDecision(response);
    const nextState = JSON.parse(JSON.stringify(session.state));

    const generatedEvents = ViewerAwareGameEventFormatter.formatStateTransition(
      prevState,
      nextState,
      options?.viewerPlayerId
    );

    records.push({
      playerId,
      policyDescriptor: policy.descriptor,
      request: currentStep.request,
      response,
      prevState,
      nextState,
      nextStep,
      generatedEvents,
    });

    currentStep = nextStep;
    decisionCount++;
  }
}
