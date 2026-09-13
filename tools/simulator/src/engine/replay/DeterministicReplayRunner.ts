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
import { reconstructMatch } from "./ReplayReconstructionService";


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
    const recon = reconstructMatch({
      environmentId: plan.environmentId,
      seed: plan.seed,
      transcript: plan.decisions,
      decisionCount: plan.decisions.length,
      catalog: dependencies.catalog,
      fullRulePackage: dependencies.fullRulePackage,
      expectedRulePackage: plan.sourceRulePackage,
    });

    if (recon.status === "DIVERGED") {
      return {
        status: "DIVERGED",
        code: recon.code,
        message: recon.message,
        stepIndex: recon.stepIndex,
        decisionSeq: recon.decisionSeq,
        difference: recon.difference,
      };
    }

    if (recon.status === "TECHNICAL_ERROR") {
      return {
        status: "TECHNICAL_ERROR",
        error: recon.error,
        stack: recon.stack,
      };
    }

    const currentStep = recon.currentStep;
    const stepIndex = recon.executedDecisions;

    // Final Step 検証
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

    // Raw GameState 完全一致検証
    const actualRawState = JSON.parse(JSON.stringify(recon.session.state));
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
      executedDecisions: recon.executedDecisions,
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
