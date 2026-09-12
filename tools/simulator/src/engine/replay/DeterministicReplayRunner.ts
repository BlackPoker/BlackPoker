/**
 * DeterministicReplayRunner.ts
 *
 * BlackPoker Simulator
 * Engine 層に配置される決定論的 Replay 実行エンジン。
 * UI 層や React、DOM には一切依存しない。
 */

import { RegulationCatalog } from "../../domain/regulation/RegulationDefinition";
import { RulePackage } from "../../domain/rules/RulePackage";
import { GameSessionStep } from "../session/GameSession";
import { startMatchAttempt } from "../playtest/PlaytestEnvironmentController";
import type {
  ReplayPlanV1,
  DeterministicReplayResultV1,
  ReplayDifference,
} from "./ReplayTypes";

const MAX_AUTO_PROGRESS_STEPS = 10000;

/**
 * 2つの値（プリミティブ、配列、オブジェクト）の深層比較を行い、
 * 最初に検出された差異の JSONPath と期待値・実際値を返却する Pure Helper。
 */
export function findFirstDifference(
  expected: unknown,
  actual: unknown,
  currentPath = "$"
): ReplayDifference | null {
  if (expected === actual) {
    return null;
  }

  // Handle NaN equality
  if (
    typeof expected === "number" &&
    typeof actual === "number" &&
    Number.isNaN(expected) &&
    Number.isNaN(actual)
  ) {
    return null;
  }

  // If either is primitive, null, or undefined
  if (
    expected === null ||
    expected === undefined ||
    actual === null ||
    actual === undefined ||
    typeof expected !== "object" ||
    typeof actual !== "object"
  ) {
    return { path: currentPath, expected, actual };
  }

  const isExpArray = Array.isArray(expected);
  const isActArray = Array.isArray(actual);

  if (isExpArray !== isActArray) {
    return { path: currentPath, expected, actual };
  }

  if (isExpArray && isActArray) {
    const expArr = expected as unknown[];
    const actArr = actual as unknown[];
    if (expArr.length !== actArr.length) {
      return {
        path: `${currentPath}.length`,
        expected: expArr.length,
        actual: actArr.length,
      };
    }
    for (let i = 0; i < expArr.length; i++) {
      const diff = findFirstDifference(expArr[i], actArr[i], `${currentPath}[${i}]`);
      if (diff) return diff;
    }
    return null;
  }

  // Both are non-null, non-array objects
  const expObj = expected as Record<string, unknown>;
  const actObj = actual as Record<string, unknown>;

  const expKeys = Object.keys(expObj).sort();
  const actKeys = Object.keys(actObj).sort();

  for (const k of expKeys) {
    if (!(k in actObj)) {
      return { path: `${currentPath}.${k}`, expected: expObj[k], actual: undefined };
    }
  }

  for (const k of actKeys) {
    if (!(k in expObj)) {
      return { path: `${currentPath}.${k}`, expected: undefined, actual: actObj[k] };
    }
  }

  for (const k of expKeys) {
    const diff = findFirstDifference(expObj[k], actObj[k], `${currentPath}.${k}`);
    if (diff) return diff;
  }

  return null;
}

/**
 * Replay 時の DecisionRequest 比較用に、Runtime-generated identifier
 * (decisionId, matchId) を除外した比較用オブジェクトを生成する。
 */
export function normalizeDecisionRequestForReplayComparison(request: any): any {
  if (!request || typeof request !== "object") return request;
  const copy = JSON.parse(JSON.stringify(request));
  delete copy.decisionId;
  delete copy.matchId;
  return copy;
}

/**
 * 初期条件と判断列のみを入力として、新規 GameSession を決定論的に再実行し、
 * 保存された Expected State と完全一致するかを検証する。
 */
export function runDeterministicReplay(
  plan: ReplayPlanV1,
  dependencies: {
    catalog: RegulationCatalog;
    fullRulePackage: RulePackage;
  }
): DeterministicReplayResultV1 {
  try {
    // 1. startMatchAttempt による新規セッション開始
    const outcome = startMatchAttempt({
      environmentId: plan.environmentId,
      seedInput: plan.seed !== undefined ? String(plan.seed) : "",
      catalog: dependencies.catalog,
      fullRulePackage: dependencies.fullRulePackage,
    });

    if (outcome.type !== "READY") {
      return {
        status: "DIVERGED",
        code: "SETUP_FAILED",
        message: `startMatchAttempt failed with ${outcome.type}: ${outcome.setupNotice.message}`,
        stepIndex: 0,
      };
    }

    const session = outcome.session;
    let currentStep: GameSessionStep = outcome.initialStep;
    let stepIndex = 0;

    // 2. RulePackage 整合性チェック
    if (plan.sourceRulePackage) {
      const activeRulePkg = outcome.activeMatch.rulePackage;
      if (
        (plan.sourceRulePackage.id && activeRulePkg.id !== plan.sourceRulePackage.id) ||
        (plan.sourceRulePackage.version && activeRulePkg.version !== plan.sourceRulePackage.version)
      ) {
        return {
          status: "DIVERGED",
          code: "RULE_PACKAGE_MISMATCH",
          message: `RulePackage mismatch: expected id=${plan.sourceRulePackage.id}, version=${plan.sourceRulePackage.version}; actual id=${activeRulePkg.id}, version=${activeRulePkg.version}`,
          stepIndex,
        };
      }
    }

    // 3. 判断列の再投入ループ
    let executedDecisions = 0;

    for (const entry of plan.decisions) {
      // PROGRESSED 中は advance() で進める
      let autoSteps = 0;
      while (currentStep.type === "PROGRESSED") {
        if (autoSteps >= MAX_AUTO_PROGRESS_STEPS) {
          return {
            status: "DIVERGED",
            code: "AUTO_PROGRESS_LIMIT_EXCEEDED",
            message: `Exceeded max auto-progress steps (${MAX_AUTO_PROGRESS_STEPS}) before decision seq ${entry.seq}`,
            stepIndex,
            decisionSeq: entry.seq,
          };
        }
        currentStep = session.advance();
        stepIndex++;
        autoSteps++;
      }

      // 未消費の判断があるのに終了した場合は FINISHED_EARLY
      if (currentStep.type === "FINISHED") {
        return {
          status: "DIVERGED",
          code: "FINISHED_EARLY",
          message: `Session reached FINISHED early at decision seq ${entry.seq}`,
          stepIndex,
          decisionSeq: entry.seq,
        };
      }

      // WAITING_FOR_DECISION であること
      if ((currentStep as any).type !== "WAITING_FOR_DECISION") {
        return {
          status: "DIVERGED",
          code: "EXPECTED_STEP_MISMATCH",
          message: `Expected step WAITING_FOR_DECISION before decision seq ${entry.seq}, got ${(currentStep as any).type}`,
          stepIndex,
          decisionSeq: entry.seq,
        };
      }

      const actualRequest = currentStep.request;

      // プレイヤー席の一致
      if (actualRequest.playerId !== entry.playerId) {
        return {
          status: "DIVERGED",
          code: "PLAYER_MISMATCH",
          message: `Player mismatch at seq ${entry.seq}: expected ${entry.playerId}, actual ${actualRequest.playerId}`,
          stepIndex,
          decisionSeq: entry.seq,
        };
      }

      // 盤面バージョンの一致
      if (actualRequest.stateVersion !== entry.response.stateVersion) {
        return {
          status: "DIVERGED",
          code: "STATE_VERSION_MISMATCH",
          message: `State version mismatch at seq ${entry.seq}: expected ${entry.response.stateVersion}, actual ${actualRequest.stateVersion}`,
          stepIndex,
          decisionSeq: entry.seq,
        };
      }

      // パターン参照インデックスの範囲内チェック
      if (
        entry.response.selectedPatternRef < 0 ||
        entry.response.selectedPatternRef >= actualRequest.patterns.length
      ) {
        return {
          status: "DIVERGED",
          code: "PATTERN_REF_OUT_OF_RANGE",
          message: `Pattern ref out of range at seq ${entry.seq}: selected ${entry.response.selectedPatternRef}, available patterns: ${actualRequest.patterns.length}`,
          stepIndex,
          decisionSeq: entry.seq,
        };
      }

      // actualRequest.decisionId を使用して Runtime レスポンスを再構築
      const replayResponse = {
        decisionId: actualRequest.decisionId,
        stateVersion: actualRequest.stateVersion,
        selectedPatternRef: entry.response.selectedPatternRef,
      };

      try {
        currentStep = session.submitDecision(replayResponse);
        stepIndex++;
        executedDecisions++;
      } catch (err: any) {
        return {
          status: "DIVERGED",
          code: "SUBMIT_REJECTED",
          message: `Session rejected decision at seq ${entry.seq}: ${err?.message || String(err)}`,
          stepIndex,
          decisionSeq: entry.seq,
        };
      }
    }

    // 4. 判断列消費後の Step 調整
    if (plan.expected.status === "WAITING_FOR_DECISION" || plan.expected.status === "FINISHED") {
      let autoSteps = 0;
      while (currentStep.type === "PROGRESSED") {
        if (autoSteps >= MAX_AUTO_PROGRESS_STEPS) {
          return {
            status: "DIVERGED",
            code: "AUTO_PROGRESS_LIMIT_EXCEEDED",
            message: `Exceeded max auto-progress steps (${MAX_AUTO_PROGRESS_STEPS}) waiting for final status ${plan.expected.status}`,
            stepIndex,
          };
        }
        currentStep = session.advance();
        stepIndex++;
        autoSteps++;
      }
    }

    // 5. Final Step 検証
    if (currentStep.type !== plan.expected.status) {
      return {
        status: "DIVERGED",
        code: "EXPECTED_STEP_MISMATCH",
        message: `Expected final step ${plan.expected.status}, got ${currentStep.type}`,
        stepIndex,
      };
    }

    if (plan.expected.status === "WAITING_FOR_DECISION") {
      if (plan.expected.currentDecisionRequest !== undefined && plan.expected.currentDecisionRequest !== null) {
        const normExpected = normalizeDecisionRequestForReplayComparison(plan.expected.currentDecisionRequest);
        const normActual = normalizeDecisionRequestForReplayComparison((currentStep as any).request);
        const diff = findFirstDifference(normExpected, normActual, "$.request");
        if (diff) {
          return {
            status: "DIVERGED",
            code: "CURRENT_DECISION_MISMATCH",
            message: `Current decision request mismatch: difference at ${diff.path}`,
            stepIndex,
            difference: diff,
          };
        }
      }
    } else if (plan.expected.status === "FINISHED") {
      if (plan.expected.finalResult !== undefined && plan.expected.finalResult !== null) {
        const expResult = plan.expected.finalResult as any;
        const actResult = (currentStep as any).result;
        if (expResult.winner !== actResult?.winner || expResult.reason !== actResult?.reason) {
          const diff = findFirstDifference(expResult, actResult, "$.result");
          return {
            status: "DIVERGED",
            code: "FINAL_RESULT_MISMATCH",
            message: `Final result mismatch: expected winner=${expResult.winner}, reason=${expResult.reason}; actual winner=${actResult?.winner}, reason=${actResult?.reason}`,
            stepIndex,
            difference: diff ?? { path: "$.result", expected: expResult, actual: actResult },
          };
        }
      }
    }

    // 6. Raw GameState 完全一致検証
    const actualRawState = JSON.parse(JSON.stringify(session.state));
    const stateDiff = findFirstDifference(plan.expected.rawState, actualRawState, "$");
    if (stateDiff) {
      return {
        status: "DIVERGED",
        code: "STATE_MISMATCH",
        message: `Raw state divergence detected at path ${stateDiff.path}`,
        stepIndex,
        difference: stateDiff,
      };
    }

    return {
      status: "VERIFIED",
      executedDecisions,
      totalDecisions: plan.decisions.length,
      finalStepType: currentStep.type,
    };
  } catch (err: any) {
    return {
      status: "TECHNICAL_ERROR",
      error: err?.message || String(err),
      stack: err?.stack,
    };
  }
}
