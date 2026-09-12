import { describe, it, expect } from "vitest";
import { createReplayPlanFromDiagnosticBundleV1 } from "../../ui/playtest/DiagnosticReplayAdapter";
import { PlaytestDiagnosticBundleV1 } from "../../ui/playtest/PlaytestDiagnosticBundle";

describe("DiagnosticReplayAdapter Tests", () => {
  const validBundle: PlaytestDiagnosticBundleV1 = {
    kind: "blackpoker-playtest-diagnostic",
    schemaVersion: 1,
    generatedAt: "2026-09-12T00:00:00.000Z",
    containsHiddenInformation: true,
    build: {
      sha: "sha-12345",
      ref: "refs/heads/main",
    },
    match: {
      environmentId: "core-battle",
      environmentName: "Core Battle",
      regulationId: "reg-core-01",
      rulePackageId: "pkg-core",
      rulePackageVersion: "1.0.0",
      seed: 42,
      matchMode: "humanVsHuman",
      seatControllers: {},
      status: "WAITING_FOR_DECISION",
    },
    normalLogs: [],
    traces: [],
    decisionTranscript: [
      {
        seq: 1,
        actor: "human",
        playerId: "p1",
        decisionId: "dec-001",
        stateVersion: 1,
        response: {
          decisionId: "dec-001",
          stateVersion: 1,
          selectedPatternRef: 0,
        },
      },
      {
        seq: 2,
        actor: "policy",
        playerId: "p2",
        decisionId: "dec-002",
        stateVersion: 2,
        response: {
          decisionId: "dec-002",
          stateVersion: 2,
          selectedPatternRef: 1,
        },
      },
    ],
    snapshot: {
      rawState: {
        players: { p1: {}, p2: {} },
      },
      currentDecisionRequest: {
        playerId: "p1",
      },
    },
  };

  it("Test 1-A: 正常な Diagnostic Bundle v1 から ReplayPlanV1 が正常に生成されること (READY)", () => {
    const res = createReplayPlanFromDiagnosticBundleV1(validBundle, {
      currentBuildSha: "sha-12345",
    });

    expect(res.type).toBe("READY");
    if (res.type === "READY") {
      expect(res.plan.environmentId).toBe("core-battle");
      expect(res.plan.seed).toBe(42);
      expect(res.plan.sourceBuild.sha).toBe("sha-12345");
      expect(res.plan.sourceRulePackage).toEqual({
        id: "pkg-core",
        version: "1.0.0",
      });
      expect(res.plan.decisions).toHaveLength(2);
      expect(res.plan.decisions[0]).toEqual({
        seq: 1,
        actor: "human",
        playerId: "p1",
        response: {
          decisionId: "dec-001",
          stateVersion: 1,
          selectedPatternRef: 0,
        },
      });
      expect(res.plan.decisions[1]).toEqual({
        seq: 2,
        actor: "policy",
        playerId: "p2",
        response: {
          decisionId: "dec-002",
          stateVersion: 2,
          selectedPatternRef: 1,
        },
      });
      expect(res.plan.expected.status).toBe("WAITING_FOR_DECISION");
      expect(res.plan.expected.rawState).toEqual(validBundle.snapshot.rawState);
    }
  });

  it("Test 1-B: bundle が null / 非オブジェクトの場合に INVALID_KIND で拒絶されること", () => {
    const resNull = createReplayPlanFromDiagnosticBundleV1(null, {
      currentBuildSha: "sha-12345",
    });
    expect(resNull.type).toBe("INCOMPATIBLE");
    if (resNull.type === "INCOMPATIBLE") {
      expect(resNull.code).toBe("INVALID_KIND");
    }

    const resPrim = createReplayPlanFromDiagnosticBundleV1("not-an-object", {
      currentBuildSha: "sha-12345",
    });
    expect(resPrim.type).toBe("INCOMPATIBLE");
    if (resPrim.type === "INCOMPATIBLE") {
      expect(resPrim.code).toBe("INVALID_KIND");
    }
  });

  it("Test 1-C: kind が不正な場合に INVALID_KIND で拒絶されること", () => {
    const invalidKind = { ...validBundle, kind: "some-other-diagnostic" };
    const res = createReplayPlanFromDiagnosticBundleV1(invalidKind, {
      currentBuildSha: "sha-12345",
    });
    expect(res.type).toBe("INCOMPATIBLE");
    if (res.type === "INCOMPATIBLE") {
      expect(res.code).toBe("INVALID_KIND");
    }
  });

  it("Test 1-D: schemaVersion が 1 以外の場合に UNSUPPORTED_SCHEMA_VERSION で拒絶されること", () => {
    const invalidSchema = { ...validBundle, schemaVersion: 2 };
    const res = createReplayPlanFromDiagnosticBundleV1(invalidSchema, {
      currentBuildSha: "sha-12345",
    });
    expect(res.type).toBe("INCOMPATIBLE");
    if (res.type === "INCOMPATIBLE") {
      expect(res.code).toBe("UNSUPPORTED_SCHEMA_VERSION");
    }
  });

  it("Test 1-E: build.sha の不一致で BUILD_MISMATCH となること（local 同士は許容）", () => {
    const mismatch = createReplayPlanFromDiagnosticBundleV1(validBundle, {
      currentBuildSha: "sha-different",
    });
    expect(mismatch.type).toBe("INCOMPATIBLE");
    if (mismatch.type === "INCOMPATIBLE") {
      expect(mismatch.code).toBe("BUILD_MISMATCH");
    }

    // local 同士の許容確認
    const localBundle = {
      ...validBundle,
      build: { sha: "local", ref: "local" },
    };
    const localMatch = createReplayPlanFromDiagnosticBundleV1(localBundle, {
      currentBuildSha: "local",
    });
    expect(localMatch.type).toBe("READY");
  });

  it("Test 1-F: match.environmentId が存在しない場合に MISSING_ENVIRONMENT で拒絶されること", () => {
    const noEnv = {
      ...validBundle,
      match: { ...validBundle.match, environmentId: "" },
    };
    const res = createReplayPlanFromDiagnosticBundleV1(noEnv, {
      currentBuildSha: "sha-12345",
    });
    expect(res.type).toBe("INCOMPATIBLE");
    if (res.type === "INCOMPATIBLE") {
      expect(res.code).toBe("MISSING_ENVIRONMENT");
    }
  });

  it("Test 1-G: snapshot.rawState が存在しない場合に MISSING_EXPECTED_STATE で拒絶されること", () => {
    const noRawState = {
      ...validBundle,
      snapshot: { ...validBundle.snapshot, rawState: undefined },
    };
    const res = createReplayPlanFromDiagnosticBundleV1(noRawState, {
      currentBuildSha: "sha-12345",
    });
    expect(res.type).toBe("INCOMPATIBLE");
    if (res.type === "INCOMPATIBLE") {
      expect(res.code).toBe("MISSING_EXPECTED_STATE");
    }
  });

  it("Test 1-H: match.status が UNKNOWN などの不正値の場合に INVALID_STATUS で拒絶されること", () => {
    const unknownStatus = {
      ...validBundle,
      match: { ...validBundle.match, status: "UNKNOWN" as any },
    };
    const res = createReplayPlanFromDiagnosticBundleV1(unknownStatus, {
      currentBuildSha: "sha-12345",
    });
    expect(res.type).toBe("INCOMPATIBLE");
    if (res.type === "INCOMPATIBLE") {
      expect(res.code).toBe("INVALID_STATUS");
    }
  });

  it("Test 1-I: decisionTranscript のシーケンスが不正（抜け・重複）な場合に INVALID_TRANSCRIPT_SEQUENCE となること", () => {
    const brokenSeqBundle = {
      ...validBundle,
      decisionTranscript: [
        {
          seq: 1,
          actor: "human",
          playerId: "p1",
          decisionId: "dec-001",
          stateVersion: 1,
          response: { decisionId: "dec-001", stateVersion: 1, selectedPatternRef: 0 },
        },
        {
          seq: 3, // gap!
          actor: "policy",
          playerId: "p2",
          decisionId: "dec-002",
          stateVersion: 2,
          response: { decisionId: "dec-002", stateVersion: 2, selectedPatternRef: 1 },
        },
      ],
    };
    const res = createReplayPlanFromDiagnosticBundleV1(brokenSeqBundle as any, {
      currentBuildSha: "sha-12345",
    });
    expect(res.type).toBe("INCOMPATIBLE");
    if (res.type === "INCOMPATIBLE") {
      expect(res.code).toBe("INVALID_TRANSCRIPT_SEQUENCE");
    }
  });

  it("Test 1-J (Source Integrity): entry.decisionId !== entry.response.decisionId の場合に INVALID_TRANSCRIPT となること", () => {
    const tamperedBundle = {
      ...validBundle,
      decisionTranscript: [
        {
          seq: 1,
          actor: "human",
          playerId: "p1",
          decisionId: "dec-001",
          stateVersion: 1,
          response: {
            decisionId: "dec-tampered",
            stateVersion: 1,
            selectedPatternRef: 0,
          },
        },
      ],
    };
    const res = createReplayPlanFromDiagnosticBundleV1(tamperedBundle as any, {
      currentBuildSha: "sha-12345",
    });
    expect(res.type).toBe("INCOMPATIBLE");
    if (res.type === "INCOMPATIBLE") {
      expect(res.code).toBe("INVALID_TRANSCRIPT");
    }
  });

  it("Test 1-K (Source Integrity): entry.stateVersion !== entry.response.stateVersion の場合に INVALID_TRANSCRIPT となること", () => {
    const tamperedBundle = {
      ...validBundle,
      decisionTranscript: [
        {
          seq: 1,
          actor: "human",
          playerId: "p1",
          decisionId: "dec-001",
          stateVersion: 1,
          response: {
            decisionId: "dec-001",
            stateVersion: 2, // mismatch!
            selectedPatternRef: 0,
          },
        },
      ],
    };
    const res = createReplayPlanFromDiagnosticBundleV1(tamperedBundle as any, {
      currentBuildSha: "sha-12345",
    });
    expect(res.type).toBe("INCOMPATIBLE");
    if (res.type === "INCOMPATIBLE") {
      expect(res.code).toBe("INVALID_TRANSCRIPT");
    }
  });

  it("Test 1-L: selectedPatternRef が負の数の場合に INVALID_TRANSCRIPT となること", () => {
    const invalidRefBundle = {
      ...validBundle,
      decisionTranscript: [
        {
          seq: 1,
          actor: "human",
          playerId: "p1",
          decisionId: "dec-001",
          stateVersion: 1,
          response: {
            decisionId: "dec-001",
            stateVersion: 1,
            selectedPatternRef: -1,
          },
        },
      ],
    };
    const res = createReplayPlanFromDiagnosticBundleV1(invalidRefBundle as any, {
      currentBuildSha: "sha-12345",
    });
    expect(res.type).toBe("INCOMPATIBLE");
    if (res.type === "INCOMPATIBLE") {
      expect(res.code).toBe("INVALID_TRANSCRIPT");
    }
  });
});
