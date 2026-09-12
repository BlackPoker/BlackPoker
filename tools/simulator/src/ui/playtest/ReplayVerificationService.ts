/**
 * ReplayVerificationService.ts
 *
 * BlackPoker Simulator
 * 現在 Playtest UI に副作用を与えない stateless / local-only な Replay 検証オーケストレーションサービス。
 */

import { RegulationCatalog } from "../../domain/regulation/RegulationDefinition";
import { RulePackage } from "../../domain/rules/RulePackage";
import type {
  ReplayPlanV1,
  DeterministicReplayResultV1,
} from "../../engine/replay/ReplayTypes";
import { runDeterministicReplay } from "../../engine/replay/DeterministicReplayRunner";
import { createReplayPlanFromDiagnosticBundleV1 } from "./DiagnosticReplayAdapter";

/**
 * Diagnostic JSON 文字列を安全にパースする Pure Helper。
 * 秘密情報保護のため、構文エラー詳細（JSON 断片）を漏洩させず固定メッセージを返却する。
 */
export function parseDiagnosticJson(
  text: string
):
  | { readonly type: "SUCCESS"; readonly value: unknown }
  | { readonly type: "INVALID_JSON"; readonly message: string } {
  try {
    const value = JSON.parse(text);
    return { type: "SUCCESS", value };
  } catch {
    return {
      type: "INVALID_JSON",
      message: "JSONとして読み込めませんでした。ファイル形式を確認してください。",
    };
  }
}

export interface ReplayVerificationSummary {
  readonly environmentId: string;
  readonly seed?: number;
  readonly sourceBuildSha: string;
  readonly rulePackageId?: string;
  readonly rulePackageVersion?: string;
  readonly decisionCount: number;
  readonly finalStatus: "WAITING_FOR_DECISION" | "PROGRESSED" | "FINISHED";
}

/**
 * UI 表示用 Outcome。
 * 秘密情報（rawState, difference.expected, difference.actual, stack）を一切含めない Allowlist 構造。
 */
export type ReplayVerificationOutcome =
  | {
      readonly type: "VERIFIED";
      readonly summary: ReplayVerificationSummary;
    }
  | {
      readonly type: "INCOMPATIBLE";
      readonly code: string;
      readonly message: string;
      readonly sourceBuildSha?: string;
      readonly currentBuildSha: string;
    }
  | {
      readonly type: "DIVERGED";
      readonly code: string;
      readonly message: string;
      readonly decisionSeq?: number;
      readonly differencePath?: string;
    }
  | {
      readonly type: "TECHNICAL_ERROR";
      readonly message: string;
    };

/**
 * DeterministicReplayResultV1 から秘密情報を排除し、
 * UI 表示用 ReplayVerificationOutcome へ安全に変換する Pure Helper。
 */
export function mapReplayResultToVerificationOutcome(
  result: DeterministicReplayResultV1,
  context: {
    plan: ReplayPlanV1;
    currentBuildSha: string;
  }
): ReplayVerificationOutcome {
  switch (result.status) {
    case "VERIFIED":
      return {
        type: "VERIFIED",
        summary: {
          environmentId: context.plan.environmentId,
          seed: context.plan.seed,
          sourceBuildSha: context.plan.sourceBuild.sha,
          rulePackageId: context.plan.sourceRulePackage?.id,
          rulePackageVersion: context.plan.sourceRulePackage?.version,
          decisionCount: result.totalDecisions,
          finalStatus: result.finalStepType,
        },
      };

    case "INCOMPATIBLE":
      return {
        type: "INCOMPATIBLE",
        code: result.code,
        message: result.message,
        sourceBuildSha: context.plan.sourceBuild.sha,
        currentBuildSha: context.currentBuildSha,
      };

    case "DIVERGED":
      return {
        type: "DIVERGED",
        code: result.code,
        message: result.message,
        decisionSeq: result.decisionSeq,
        differencePath: result.difference?.path,
      };

    case "TECHNICAL_ERROR":
      return {
        type: "TECHNICAL_ERROR",
        message: result.error || "Replay検証中に技術的エラーが発生しました。",
      };
  }
}

/**
 * Diagnostic Bundle v1 を受け取り、新規 GameSession による決定論的再シミュレーションを実行して、
 * 秘密情報を含まない検証 Outcome を返却する。
 *
 * 【契約】
 * - 進行中の対戦（sessionRef.current, gameState 等）に一切影響を与えない。
 * - 外部ネットワーク通信、localStorage 等の永続化を行わない。
 */
export function verifyDiagnosticReplayBundleV1(
  bundle: unknown,
  options: {
    currentBuildSha: string;
    catalog: RegulationCatalog;
    fullRulePackage: RulePackage;
  }
): ReplayVerificationOutcome {
  // BUILD_MISMATCH などの表示用として、安全に sourceBuildSha を事前抽出
  const rawBuildSha =
    bundle &&
    typeof bundle === "object" &&
    typeof (bundle as Record<string, any>).build?.sha === "string" &&
    (bundle as Record<string, any>).build.sha.trim().length > 0
      ? (bundle as Record<string, any>).build.sha
      : undefined;

  const planResult = createReplayPlanFromDiagnosticBundleV1(bundle, {
    currentBuildSha: options.currentBuildSha,
  });

  if (planResult.type !== "READY") {
    return {
      type: "INCOMPATIBLE",
      code: planResult.code,
      message: planResult.message,
      sourceBuildSha: rawBuildSha,
      currentBuildSha: options.currentBuildSha,
    };
  }

  const replayResult = runDeterministicReplay(planResult.plan, {
    catalog: options.catalog,
    fullRulePackage: options.fullRulePackage,
  });

  return mapReplayResultToVerificationOutcome(replayResult, {
    plan: planResult.plan,
    currentBuildSha: options.currentBuildSha,
  });
}
