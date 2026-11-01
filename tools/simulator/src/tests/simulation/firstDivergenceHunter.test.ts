import { describe, it, expect } from "vitest";
import {
  huntFirstDivergence,
  R2_HISTORICAL_LIMITATION_NOTE,
  RUNTIME_DECISION_ID_EXCLUSION_REASON,
} from "../../engine/simulation/FirstDivergenceHunter.js";
import { DecisionTraceRecord } from "../../engine/simulation/SimulationRunner.js";

describe("FirstDivergenceHunter", () => {
  const sampleDescriptor = {
    kind: "firstLegal",
    policyVersion: 1,
    name: "FirstLegalPolicy",
    metadata: { preferPass: false, priority: "default" },
  };

  const createDummyRecord = (
    stepCount: number,
    overrides?: Partial<DecisionTraceRecord>
  ): DecisionTraceRecord => ({
    stepCount,
    logicalDecisionId: `d2-00000${stepCount}-p1-v1-hash${stepCount}`,
    runtimeDecisionId: `rt-${stepCount}`,
    playerId: "p1",
    stateVersion: 1,
    stateHash: `sh2-hash-step-${stepCount}`,
    legalPatterns: [
      {
        patternRef: 0,
        logicalPatternKey: "action:summon:card1",
        kind: "ACTION",
        actionId: "action.summon",
        actionSelectionRef: 1,
        keyCardSelectionRef: 2,
        costPaymentRef: 3,
        targetSelectionRef: 4,
      },
      {
        patternRef: 1,
        logicalPatternKey: "pass",
        kind: "PASS",
      },
    ],
    selectedPatternRef: 0,
    selectedLogicalPatternKey: "action:summon:card1",
    selectedPatternKind: "ACTION",
    actionId: "action.summon",
    policyDescriptor: sampleDescriptor,
    ...overrides,
  });

  it("Test 1: 完全一致時は NO_DIVERGENCE を返し無理な分岐理由を生成しないこと", () => {
    const traceA = [createDummyRecord(0), createDummyRecord(1), createDummyRecord(2)];
    const traceB = [createDummyRecord(0), createDummyRecord(1), createDummyRecord(2)];

    const report = huntFirstDivergence(traceA, traceB);

    expect(report.status).toBe("NO_DIVERGENCE");
    expect(report.classification).toBe("NO_DIVERGENCE");
    expect(report.divergenceStepIndex).toBeUndefined();
    expect(report.traceALength).toBe(3);
    expect(report.traceBLength).toBe(3);
    expect(report.explanation).toContain("100% 完全一致");
    expect(report.historicalLimitationNote).toBe(R2_HISTORICAL_LIMITATION_NOTE);
    expect(report.runtimeDecisionIdExclusionReason).toBe(RUNTIME_DECISION_ID_EXCLUSION_REASON);
  });

  it("Test 2: stepCount 不一致 (STEP_COUNT_MISMATCH) を検出すること", () => {
    const traceA = [createDummyRecord(0), createDummyRecord(1)];
    const traceB = [createDummyRecord(0), createDummyRecord(2, { stepCount: 2 })];

    const report = huntFirstDivergence(traceA, traceB);

    expect(report.status).toBe("DIVERGENCE_DETECTED");
    expect(report.classification).toBe("STEP_COUNT_MISMATCH");
    expect(report.divergenceStepIndex).toBe(1);
    expect(report.explanation).toContain("stepCount が不一致");
  });

  it("Test 3: logicalDecisionId 不一致 (LOGICAL_DECISION_ID_MISMATCH) を検出すること", () => {
    const traceA = [createDummyRecord(0), createDummyRecord(1)];
    const traceB = [
      createDummyRecord(0),
      createDummyRecord(1, { logicalDecisionId: "d2-000001-p1-v1-differenthash" }),
    ];

    const report = huntFirstDivergence(traceA, traceB);

    expect(report.status).toBe("DIVERGENCE_DETECTED");
    expect(report.classification).toBe("LOGICAL_DECISION_ID_MISMATCH");
    expect(report.divergenceStepIndex).toBe(1);
    expect(report.explanation).toContain("logicalDecisionId が不一致");
  });

  it("Test 4: policyDescriptor.metadata のキー順序が異なっていても同一と判定されること", () => {
    const traceA = [
      createDummyRecord(0, {
        policyDescriptor: {
          kind: "firstLegal",
          policyVersion: 1,
          name: "FirstLegal",
          metadata: { preferPass: false, priority: "default" },
        },
      }),
    ];
    const traceB = [
      createDummyRecord(0, {
        policyDescriptor: {
          kind: "firstLegal",
          policyVersion: 1,
          name: "FirstLegal",
          metadata: { priority: "default", preferPass: false }, // 逆順
        },
      }),
    ];

    const report = huntFirstDivergence(traceA, traceB);
    expect(report.status).toBe("NO_DIVERGENCE");
  });

  it("Test 5: 合法パターンの決定論的フィールド (actionSelectionRef, costPaymentRef 等) の不一致を検出すること", () => {
    const traceA = [
      createDummyRecord(0, {
        legalPatterns: [
          { patternRef: 0, logicalPatternKey: "action:summon", kind: "ACTION", actionSelectionRef: 1 },
        ],
      }),
    ];
    const traceB = [
      createDummyRecord(0, {
        legalPatterns: [
          { patternRef: 0, logicalPatternKey: "action:summon", kind: "ACTION", actionSelectionRef: 2 },
        ],
      }),
    ];

    const report = huntFirstDivergence(traceA, traceB);

    expect(report.status).toBe("DIVERGENCE_DETECTED");
    expect(report.classification).toBe("LEGAL_PATTERNS_ORDER_MISMATCH");
    expect(report.explanation).toContain("actionSelectionRef 不一致");
  });

  it("Test 6: 選択手インデックス (selectedPatternRef) の不一致を検出すること", () => {
    const traceA = [
      createDummyRecord(0),
      createDummyRecord(1, { selectedPatternRef: 0, selectedLogicalPatternKey: "action:summon:card1" }),
    ];
    const traceB = [
      createDummyRecord(0),
      createDummyRecord(1, { selectedPatternRef: 1, selectedLogicalPatternKey: "pass", selectedPatternKind: "PASS" }),
    ];

    const report = huntFirstDivergence(traceA, traceB);

    expect(report.status).toBe("DIVERGENCE_DETECTED");
    expect(report.classification).toBe("SELECTED_PATTERN_REF_MISMATCH");
    expect(report.divergenceStepIndex).toBe(1);
    expect(report.actingPlayer).toBe("p1");
    expect(report.explanation).toContain("selectedPatternRef が不一致");
  });

  it("Test 7: 合法手パターンの総数不一致 (LEGAL_PATTERNS_COUNT_MISMATCH) を検出すること", () => {
    const traceA = [
      createDummyRecord(0, {
        legalPatterns: [
          { patternRef: 0, logicalPatternKey: "action:summon:card1", kind: "ACTION" },
          { patternRef: 1, logicalPatternKey: "pass", kind: "PASS" },
        ],
      }),
    ];
    const traceB = [
      createDummyRecord(0, {
        legalPatterns: [
          { patternRef: 0, logicalPatternKey: "action:summon:card1", kind: "ACTION" },
          { patternRef: 1, logicalPatternKey: "action:attack:card2", kind: "ACTION" },
          { patternRef: 2, logicalPatternKey: "pass", kind: "PASS" },
        ],
      }),
    ];

    const report = huntFirstDivergence(traceA, traceB);

    expect(report.status).toBe("DIVERGENCE_DETECTED");
    expect(report.classification).toBe("LEGAL_PATTERNS_COUNT_MISMATCH");
    expect(report.divergenceStepIndex).toBe(0);
    expect(report.explanation).toContain("合法手総数の不一致");
  });

  it("Test 8: 意思決定前の論理状態 Hash 不一致 (STATE_HASH_MISMATCH) を検出すること", () => {
    const traceA = [createDummyRecord(0), createDummyRecord(1, { stateHash: "sh2-state-alpha" })];
    const traceB = [createDummyRecord(0), createDummyRecord(1, { stateHash: "sh2-state-beta" })];

    const report = huntFirstDivergence(traceA, traceB);

    expect(report.status).toBe("DIVERGENCE_DETECTED");
    expect(report.classification).toBe("STATE_HASH_MISMATCH");
    expect(report.divergenceStepIndex).toBe(1);
    expect(report.preStateHashA).toBe("sh2-state-alpha");
    expect(report.preStateHashB).toBe("sh2-state-beta");
    expect(report.explanation).toContain("論理状態 Hash が不一致");
  });

  it("Test 9: 手番プレイヤー不一致 (ACTING_PLAYER_MISMATCH) を検出すること", () => {
    const traceA = [createDummyRecord(0, { playerId: "p1" })];
    const traceB = [createDummyRecord(0, { playerId: "p2" })];

    const report = huntFirstDivergence(traceA, traceB);

    expect(report.status).toBe("DIVERGENCE_DETECTED");
    expect(report.classification).toBe("ACTING_PLAYER_MISMATCH");
    expect(report.divergenceStepIndex).toBe(0);
    expect(report.explanation).toContain("手番プレイヤーが不一致");
  });

  it("Test 10: Trace 長不一致 (TRACE_LENGTH_MISMATCH) を検出すること", () => {
    const traceA = [createDummyRecord(0), createDummyRecord(1)];
    const traceB = [createDummyRecord(0), createDummyRecord(1), createDummyRecord(2)];

    const report = huntFirstDivergence(traceA, traceB);

    expect(report.status).toBe("DIVERGENCE_DETECTED");
    expect(report.classification).toBe("TRACE_LENGTH_MISMATCH");
    expect(report.divergenceStepIndex).toBe(2);
    expect(report.traceALength).toBe(2);
    expect(report.traceBLength).toBe(3);
    expect(report.explanation).toContain("対戦の総ステップ数が異なります");
  });

  it("Test 11: 過去 R2 Evidence の限界明記および runtimeDecisionId 除外理由の明文化", () => {
    expect(R2_HISTORICAL_LIMITATION_NOTE).toContain("過去の R2 Evidence");
    expect(R2_HISTORICAL_LIMITATION_NOTE).toContain("個別の Decision Trace が保存されておらず");
    expect(R2_HISTORICAL_LIMITATION_NOTE).toContain("初回分岐ステップを確定的に復元することは不可能です");

    expect(RUNTIME_DECISION_ID_EXCLUSION_REASON).toContain("runtimeDecisionId");
    expect(RUNTIME_DECISION_ID_EXCLUSION_REASON).toContain("一時的な動的ランタイムカウンタ");
    expect(RUNTIME_DECISION_ID_EXCLUSION_REASON).toContain("logicalDecisionId を使用し");
  });
});
