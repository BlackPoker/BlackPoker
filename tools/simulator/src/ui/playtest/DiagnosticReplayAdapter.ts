/**
 * DiagnosticReplayAdapter.ts
 *
 * Playtest Diagnostic Bundle v1 を受け取り、
 * 厳格な検証を実施して ReplayPlanV1 を生成する UI レイヤーの Pure Adapter。
 */

import type { ReplayPlanV1, ReplayDecisionEntryV1 } from "../../engine/replay/ReplayTypes";

export type CreateReplayPlanResult =
  | {
      type: "READY";
      plan: ReplayPlanV1;
    }
  | {
      type: "INCOMPATIBLE";
      code: string;
      message: string;
    };

export function createReplayPlanFromDiagnosticBundleV1(
  bundle: unknown,
  options: { currentBuildSha: string }
): CreateReplayPlanResult {
  if (!bundle || typeof bundle !== "object") {
    return {
      type: "INCOMPATIBLE",
      code: "INVALID_KIND",
      message: "Diagnostic bundle must be a non-null object",
    };
  }

  const b = bundle as Record<string, any>;

  // 1. kind validation
  if (b.kind !== "blackpoker-playtest-diagnostic") {
    return {
      type: "INCOMPATIBLE",
      code: "INVALID_KIND",
      message: `Invalid bundle kind: expected blackpoker-playtest-diagnostic, got ${b.kind}`,
    };
  }

  // 2. schemaVersion validation
  if (b.schemaVersion !== 1) {
    return {
      type: "INCOMPATIBLE",
      code: "UNSUPPORTED_SCHEMA_VERSION",
      message: `Unsupported schemaVersion: expected 1, got ${b.schemaVersion}`,
    };
  }

  // 3. build sha validation
  if (!b.build || typeof b.build.sha !== "string" || !b.build.sha.trim()) {
    return {
      type: "INCOMPATIBLE",
      code: "BUILD_MISMATCH",
      message: "Bundle build.sha is missing or empty",
    };
  }

  const isBothLocal = b.build.sha === "local" && options.currentBuildSha === "local";
  if (!isBothLocal && b.build.sha !== options.currentBuildSha) {
    return {
      type: "INCOMPATIBLE",
      code: "BUILD_MISMATCH",
      message: `Build SHA mismatch: source=${b.build.sha}, current=${options.currentBuildSha}`,
    };
  }

  // 4. environmentId validation
  if (!b.match || typeof b.match.environmentId !== "string" || !b.match.environmentId.trim()) {
    return {
      type: "INCOMPATIBLE",
      code: "MISSING_ENVIRONMENT",
      message: "Missing environmentId in diagnostic bundle",
    };
  }

  // 5. expected rawState validation
  if (!b.snapshot || b.snapshot.rawState === undefined || b.snapshot.rawState === null) {
    return {
      type: "INCOMPATIBLE",
      code: "MISSING_EXPECTED_STATE",
      message: "Missing snapshot.rawState in diagnostic bundle",
    };
  }

  // 6. match status validation
  const allowedStatuses = ["WAITING_FOR_DECISION", "PROGRESSED", "FINISHED"];
  if (!b.match || !allowedStatuses.includes(b.match.status)) {
    return {
      type: "INCOMPATIBLE",
      code: "INVALID_STATUS",
      message: `Invalid match status in diagnostic bundle: ${b.match?.status}`,
    };
  }

  // 7. decisionTranscript validation
  if (!Array.isArray(b.decisionTranscript)) {
    return {
      type: "INCOMPATIBLE",
      code: "INVALID_TRANSCRIPT",
      message: "decisionTranscript must be an array",
    };
  }

  const decisions: ReplayDecisionEntryV1[] = [];
  for (let i = 0; i < b.decisionTranscript.length; i++) {
    const entry = b.decisionTranscript[i];
    const expectedSeq = i + 1;

    if (!entry || typeof entry !== "object") {
      return {
        type: "INCOMPATIBLE",
        code: "INVALID_TRANSCRIPT",
        message: `Transcript entry at index ${i} is not an object`,
      };
    }

    if (entry.seq !== expectedSeq) {
      return {
        type: "INCOMPATIBLE",
        code: "INVALID_TRANSCRIPT_SEQUENCE",
        message: `Transcript sequence broken at index ${i}: expected seq ${expectedSeq}, got ${entry.seq}`,
      };
    }

    if (entry.playerId !== "p1" && entry.playerId !== "p2") {
      return {
        type: "INCOMPATIBLE",
        code: "INVALID_TRANSCRIPT",
        message: `Invalid playerId in transcript entry seq ${entry.seq}: ${entry.playerId}`,
      };
    }

    if (entry.actor !== "human" && entry.actor !== "policy" && entry.actor !== "autoPass") {
      return {
        type: "INCOMPATIBLE",
        code: "INVALID_TRANSCRIPT",
        message: `Invalid actor in transcript entry seq ${entry.seq}: ${entry.actor}`,
      };
    }

    if (!entry.response || typeof entry.response !== "object") {
      return {
        type: "INCOMPATIBLE",
        code: "INVALID_TRANSCRIPT",
        message: `Missing response object in transcript entry seq ${entry.seq}`,
      };
    }

    if (typeof entry.decisionId !== "string" || typeof entry.response.decisionId !== "string") {
      return {
        type: "INCOMPATIBLE",
        code: "INVALID_TRANSCRIPT",
        message: `Missing or invalid decisionId in transcript entry seq ${entry.seq}`,
      };
    }

    // Source integrity check: entry.decisionId === entry.response.decisionId
    if (entry.decisionId !== entry.response.decisionId) {
      return {
        type: "INCOMPATIBLE",
        code: "INVALID_TRANSCRIPT",
        message: `decisionId mismatch between entry and response in transcript seq ${entry.seq}: top=${entry.decisionId}, response=${entry.response.decisionId}`,
      };
    }

    if (typeof entry.stateVersion !== "number" || typeof entry.response.stateVersion !== "number") {
      return {
        type: "INCOMPATIBLE",
        code: "INVALID_TRANSCRIPT",
        message: `Missing or invalid stateVersion in transcript entry seq ${entry.seq}`,
      };
    }

    // Source integrity check: entry.stateVersion === entry.response.stateVersion
    if (entry.stateVersion !== entry.response.stateVersion) {
      return {
        type: "INCOMPATIBLE",
        code: "INVALID_TRANSCRIPT",
        message: `stateVersion mismatch between entry and response in transcript seq ${entry.seq}: top=${entry.stateVersion}, response=${entry.response.stateVersion}`,
      };
    }

    if (
      typeof entry.response.selectedPatternRef !== "number" ||
      !Number.isInteger(entry.response.selectedPatternRef) ||
      entry.response.selectedPatternRef < 0
    ) {
      return {
        type: "INCOMPATIBLE",
        code: "INVALID_TRANSCRIPT",
        message: `selectedPatternRef must be a non-negative integer in transcript entry seq ${entry.seq}, got ${entry.response.selectedPatternRef}`,
      };
    }

    decisions.push({
      seq: entry.seq,
      actor: entry.actor,
      playerId: entry.playerId,
      response: {
        decisionId: entry.response.decisionId,
        stateVersion: entry.response.stateVersion,
        selectedPatternRef: entry.response.selectedPatternRef,
      },
    });
  }

  const plan: ReplayPlanV1 = {
    environmentId: b.match.environmentId,
    seed: typeof b.match.seed === "number" ? b.match.seed : undefined,
    sourceBuild: {
      sha: b.build.sha,
      ref: b.build.ref,
    },
    sourceRulePackage:
      b.match.rulePackageId || b.match.rulePackageVersion
        ? {
            id: b.match.rulePackageId,
            version: b.match.rulePackageVersion,
          }
        : undefined,
    decisions,
    expected: {
      status: b.match.status,
      rawState: b.snapshot.rawState,
      currentDecisionRequest: b.snapshot.currentDecisionRequest,
      finalResult: b.snapshot.finalResult,
    },
  };

  return {
    type: "READY",
    plan,
  };
}
