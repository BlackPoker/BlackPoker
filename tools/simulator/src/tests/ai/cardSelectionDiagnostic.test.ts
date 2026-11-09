/**
 * cardSelectionDiagnostic.test.ts
 *
 * BlackPoker Simulator - カード選択品質・特徴量識別能力診断エンジン単体テスト (Work 5-4C)
 */

import { describe, it, expect } from "vitest";
import {
  classifyDecisionPatterns,
  evaluateGroupDistinguishability,
  DiagnosticTransparentWrapperPolicy,
  computePolicyAggregateMetrics,
  DecisionDiagnosticRecord,
  EvaluatedCandidateScore,
} from "../../engine/ai/CardSelectionDiagnosticEngine.js";
import { DecisionRequest } from "../../domain/decision/DecisionRequest.js";
import { DecisionResponse } from "../../domain/decision/DecisionResponse.js";
import { DecisionPolicy } from "../../engine/simulation/DecisionPolicy.js";

describe("CardSelectionDiagnosticEngine 単体テスト (Work 5-4C)", () => {
  it("1. キーカードだけが異なる候補を純粋キーカードグループとして正しく分類すること", () => {
    const mockRequest: DecisionRequest = {
      protocolVersion: "1.0",
      matchId: "m-1",
      decisionId: "dec-1",
      stateVersion: 1,
      playerId: "p1",
      source: { kind: "chance" } as any,
      catalog: {
        actions: [{ actionId: "action.summonSoldier", actionName: "兵士召喚" }],
        cardSelections: [
          { cardIds: ["card-s-1"], displayCodes: ["S1"] },
          { cardIds: ["card-s-2"], displayCodes: ["S2"] },
        ],
        unitSelections: [],
        costPayments: [{ discardedCardIds: [], drivenBulwarkUnitIds: [], sacrificedUnitIds: [], lifeCount: 0 }],
        targetSelections: [{ targetType: "none" }],
        effectSelections: [],
        orderSelections: [],
      },
      patterns: [
        {
          patternId: "p-summon-1",
          kind: "ACTION",
          actionSelectionRef: 0,
          keyCardSelectionRef: 0,
          costPaymentRef: 0,
          targetSelectionRef: 0,
        },
        {
          patternId: "p-summon-2",
          kind: "ACTION",
          actionSelectionRef: 0,
          keyCardSelectionRef: 1, // キーカードのみ異なる
          costPaymentRef: 0,
          targetSelectionRef: 0,
        },
      ],
      observation: {
        viewerPlayerId: "p1",
        players: [],
        stageRequestRefs: [],
        stageRequests: [],
        recentEvents: [],
      } as any,
    };

    const classified = classifyDecisionPatterns(mockRequest);
    expect(classified.pureKeyCardGroups.length).toBe(1);
    expect(classified.pureKeyCardGroups[0].actionId).toBe("action.summonSoldier");
    expect(classified.pureKeyCardGroups[0].candidateCount).toBe(2);
    expect(classified.pureKeyCardGroups[0].patternRefs).toEqual([0, 1]);

    // コストは同一なので純粋コストグループは 0
    expect(classified.pureCostGroups.length).toBe(0);
  });

  it("2. キーカードとコスト支払いの双方が異なる場合を複合選択として切り離すこと", () => {
    const mockRequest: DecisionRequest = {
      protocolVersion: "1.0",
      matchId: "m-2",
      decisionId: "dec-2",
      stateVersion: 1,
      playerId: "p1",
      source: { kind: "chance" } as any,
      catalog: {
        actions: [{ actionId: "action.counter", actionName: "カウンター" }],
        cardSelections: [
          { cardIds: ["card-c-1"], displayCodes: ["C1"] },
          { cardIds: ["card-c-2"], displayCodes: ["C2"] },
        ],
        unitSelections: [],
        costPayments: [
          { discardedCardIds: ["discard-1"], drivenBulwarkUnitIds: [], sacrificedUnitIds: [], lifeCount: 0 },
          { discardedCardIds: ["discard-2"], drivenBulwarkUnitIds: [], sacrificedUnitIds: [], lifeCount: 0 }, // コストも異なる
        ],
        targetSelections: [{ targetType: "request", targetRequestId: "req-opp-1" }],
        effectSelections: [],
        orderSelections: [],
      },
      patterns: [
        {
          patternId: "p-counter-1",
          kind: "ACTION",
          actionSelectionRef: 0,
          keyCardSelectionRef: 0,
          costPaymentRef: 0,
          targetSelectionRef: 0,
        },
        {
          patternId: "p-counter-2",
          kind: "ACTION",
          actionSelectionRef: 0,
          keyCardSelectionRef: 1, // キーカードも異なる
          costPaymentRef: 1,      // コストも異なる
          targetSelectionRef: 0,
        },
      ],
      observation: {
        viewerPlayerId: "p1",
        players: [],
        stageRequestRefs: [],
        stageRequests: [],
        recentEvents: [],
      } as any,
    };

    const classified = classifyDecisionPatterns(mockRequest);
    // キーカードのみが異なるグループは存在しない (複合選択のため除外)
    expect(classified.pureKeyCardGroups.length).toBe(0);
    // コストのみが異なるグループも存在しない
    expect(classified.pureCostGroups.length).toBe(0);
  });

  it("3. 同一キーカードでコスト支払いのみが異なる候補を純粋コストグループとして分類すること", () => {
    const mockRequest: DecisionRequest = {
      protocolVersion: "1.0",
      matchId: "m-3",
      decisionId: "dec-3",
      stateVersion: 1,
      playerId: "p1",
      source: { kind: "chance" } as any,
      catalog: {
        actions: [{ actionId: "action.counter", actionName: "カウンター" }],
        cardSelections: [{ cardIds: ["card-c-1"], displayCodes: ["C1"] }],
        unitSelections: [],
        costPayments: [
          { discardedCardIds: ["discard-a"], drivenBulwarkUnitIds: [], sacrificedUnitIds: [], lifeCount: 0 },
          { discardedCardIds: [], drivenBulwarkUnitIds: ["bulwark-1"], sacrificedUnitIds: [], lifeCount: 0 }, // ドライブコスト
        ],
        targetSelections: [{ targetType: "request", targetRequestId: "req-opp-1" }],
        effectSelections: [],
        orderSelections: [],
      },
      patterns: [
        {
          patternId: "p-cost-1",
          kind: "ACTION",
          actionSelectionRef: 0,
          keyCardSelectionRef: 0,
          costPaymentRef: 0,
          targetSelectionRef: 0,
        },
        {
          patternId: "p-cost-2",
          kind: "ACTION",
          actionSelectionRef: 0,
          keyCardSelectionRef: 0, // キーカード同一
          costPaymentRef: 1,      // コストのみ異なる
          targetSelectionRef: 0,
        },
      ],
      observation: {
        viewerPlayerId: "p1",
        players: [],
        stageRequestRefs: [],
        stageRequests: [],
        recentEvents: [],
      } as any,
    };

    const classified = classifyDecisionPatterns(mockRequest);
    expect(classified.pureCostGroups.length).toBe(1);
    expect(classified.pureCostGroups[0].actionId).toBe("action.counter");
    expect(classified.pureCostGroups[0].candidateCount).toBe(2);
    expect(classified.pureKeyCardGroups.length).toBe(0);
  });

  it("4. evaluateGroupDistinguishability が同点・タイブレーク・特徴量衝突を正確に検出すること", () => {
    const candidateScores: EvaluatedCandidateScore[] = [
      {
        patternRef: 0,
        baseScore: 10.0,
        tacticalAdjustment: 2.0,
        finalScore: 12.0,
        baseFeatures: [1.0, 0.5, 0.0],
        tacticalFeatures: [0.0, 1.0, 0.0],
      },
      {
        patternRef: 1,
        baseScore: 10.0,
        tacticalAdjustment: 2.0,
        finalScore: 12.0, // 同点
        baseFeatures: [1.0, 0.5, 0.0], // 完全一致 (衝突)
        tacticalFeatures: [0.0, 1.0, 0.0], // 完全一致 (衝突)
      },
    ];

    const group = { groupId: "TEST-GRP-1", patternRefs: [0, 1] };
    const res = evaluateGroupDistinguishability("TestPolicy", group, candidateScores);

    expect(res.hasScoreTie).toBe(true);
    expect(res.tieCandidatesCount).toBe(2);
    expect(res.isTieBreakChosen).toBe(true);
    expect(res.scoreMargin).toBe(0);
    expect(res.isBaseFeatureColliding).toBe(true);
    expect(res.isTacticalFeatureColliding).toBe(true);
    expect(res.isCompleteFeatureColliding).toBe(true);
  });

  it("5. DiagnosticTransparentWrapperPolicy が元 Policy の選択を一切変更せず透過的に記録すること", () => {
    const dummyPolicy: DecisionPolicy = {
      descriptor: { name: "MockPolicy", policyVersion: 1, kind: "heuristic" },
      choose: (req) => ({
        decisionId: req.decisionId,
        stateVersion: req.stateVersion,
        selectedPatternRef: 1,
      }),
    };

    const wrapper = new DiagnosticTransparentWrapperPolicy(dummyPolicy);
    const mockReq: DecisionRequest = {
      protocolVersion: "1.0",
      matchId: "m-trans-1",
      decisionId: "dec-trans-1",
      stateVersion: 10,
      playerId: "p1",
      source: { kind: "chance" } as any,
      catalog: { actions: [], cardSelections: [], unitSelections: [], costPayments: [], targetSelections: [], effectSelections: [], orderSelections: [] },
      patterns: [
        { patternId: "p0", kind: "ACTION" },
        { patternId: "p1", kind: "ACTION" },
      ],
      observation: {
        viewerPlayerId: "p1",
        players: [],
        stageRequestRefs: [],
        stageRequests: [],
        recentEvents: [],
      } as any,
    };

    const response = wrapper.choose(mockReq);
    expect(response.selectedPatternRef).toBe(1);
    expect(response.decisionId).toBe("dec-trans-1");
    expect(wrapper.recordedDecisions.length).toBe(1);
    expect(wrapper.recordedDecisions[0].decisionId).toBe("dec-trans-1");
  });

  it("6. computePolicyAggregateMetrics が全体の統計指標を正確に計算すること", () => {
    const mockRecord: DecisionDiagnosticRecord = {
      decisionId: "d1",
      stateVersion: 1,
      activePlayerId: "p1",
      totalPatternsCount: 2,
      pureKeyCardGroups: [{ groupId: "G1", actionId: "a", costSignature: "", targetSignature: "", effectSignature: "", patternRefs: [0, 1], candidateCount: 2 }],
      pureCostGroups: [],
      hasKeyCardVariance: true,
      hasCostVariance: false,
      hasSummonSoldierVariance: false,
      hasCounterVariance: false,
      policyEvaluations: {
        PolicyA: {
          selectedPatternRef: 0,
          keyCardGroupEvaluations: [
            {
              policyName: "PolicyA",
              groupId: "G1",
              candidateScores: [],
              bestPatternRef: 0,
              bestScore: 5.0,
              secondBestScore: 5.0,
              scoreMargin: 0.0,
              hasScoreTie: true,
              tieCandidatesCount: 2,
              isTieBreakChosen: true,
              isBaseFeatureColliding: true,
              isTacticalFeatureColliding: true,
              isCompleteFeatureColliding: true,
            },
          ],
          costGroupEvaluations: [],
        },
      },
    };

    const metrics = computePolicyAggregateMetrics("PolicyA", [mockRecord]);
    expect(metrics.totalKeyCardGroupsEvaluated).toBe(1);
    expect(metrics.keyCardScoreTieCount).toBe(1);
    expect(metrics.keyCardScoreTieRate).toBe(1.0);
    expect(metrics.keyCardTieBreakCount).toBe(1);
    expect(metrics.keyCardTieBreakRate).toBe(1.0);
    expect(metrics.keyCardBaseFeatureCollisionCount).toBe(1);
    expect(metrics.keyCardBaseFeatureCollisionRate).toBe(1.0);
    expect(metrics.keyCardCompleteCollisionCount).toBe(1);
    expect(metrics.keyCardCompleteCollisionRate).toBe(1.0);
    expect(metrics.keyCardAvgScoreMargin).toBe(0.0);
  });
});
