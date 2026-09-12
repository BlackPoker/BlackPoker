/**
 * Replay Phase 1.0: Engine Replay Types
 *
 * BlackPoker Simulator
 * Engine層に配置し、UI層やReact、ブラウザDOMには一切依存しない。
 */

export type ReplayDecisionEntryV1 = {
  seq: number;
  actor: "human" | "policy" | "autoPass";
  playerId: "p1" | "p2";
  response: {
    decisionId: string;
    stateVersion: number;
    selectedPatternRef: number;
  };
};

export type ReplayPlanV1 = {
  environmentId: string;
  seed?: number;
  sourceBuild: {
    sha: string;
    ref?: string;
  };
  sourceRulePackage?: {
    id?: string;
    version?: string;
  };
  decisions: readonly ReplayDecisionEntryV1[];
  expected: {
    status: "WAITING_FOR_DECISION" | "PROGRESSED" | "FINISHED";
    rawState: unknown;
    currentDecisionRequest?: unknown;
    finalResult?: unknown;
  };
};

export type ReplayDivergenceCode =
  | "SETUP_FAILED"
  | "RULE_PACKAGE_MISMATCH"
  | "FINISHED_EARLY"
  | "EXPECTED_STEP_MISMATCH"
  | "PLAYER_MISMATCH"
  | "STATE_VERSION_MISMATCH"
  | "PATTERN_REF_OUT_OF_RANGE"
  | "SUBMIT_REJECTED"
  | "AUTO_PROGRESS_LIMIT_EXCEEDED"
  | "CURRENT_DECISION_MISMATCH"
  | "FINAL_RESULT_MISMATCH"
  | "STATE_MISMATCH";

export type ReplayDifference = {
  path: string;
  expected: unknown;
  actual: unknown;
};

export type DeterministicReplayResultV1 =
  | {
      status: "VERIFIED";
      executedDecisions: number;
      totalDecisions: number;
      finalStepType: "WAITING_FOR_DECISION" | "PROGRESSED" | "FINISHED";
    }
  | {
      status: "DIVERGED";
      code: ReplayDivergenceCode;
      message: string;
      stepIndex: number;
      decisionSeq?: number;
      difference?: ReplayDifference;
    }
  | {
      status: "INCOMPATIBLE";
      code: string;
      message: string;
    }
  | {
      status: "TECHNICAL_ERROR";
      error: string;
      stack?: string;
    };
