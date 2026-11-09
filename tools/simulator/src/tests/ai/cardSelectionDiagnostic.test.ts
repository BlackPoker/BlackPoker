/**
 * cardSelectionDiagnostic.test.ts
 *
 * BlackPoker Simulator - カード選択品質・特徴量識別能力診断エンジン単体テスト (Work 5-4C)
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
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

  it("7. Work 5-4C Evidence JSON および Markdown レポートの真正性・完全性が保証されていること", () => {
    const rootDir = process.cwd();
    const evidenceDir = path.resolve(rootDir, "evidence/gen9-work5-4c");
    const evidencePath = path.join(evidenceDir, "gen9-work5-4c-card-selection-diagnostic-46735ba3d704.json");
    const reportPath = path.join(evidenceDir, "CARD_SELECTION_DIAGNOSTIC_REPORT.md");

    // 1. ファイルの存在確認
    expect(fs.existsSync(evidencePath)).toBe(true);
    expect(fs.existsSync(reportPath)).toBe(true);

    // 2. SHA-256 検証
    const fileContent = fs.readFileSync(evidencePath);
    const actualSha256 = crypto.createHash("sha256").update(fileContent).digest("hex");
    const EXPECTED_SHA256 = "53f9c9b82c136a8026df79e9fbba8196435db7ac3520b186529308565939dcd6";
    expect(actualSha256).toBe(EXPECTED_SHA256);

    // 3. Evidence 内容の整合性検証
    const parsed = JSON.parse(fileContent.toString("utf8"));
    expect(parsed.workId).toBe("BP-SIM-AI-GEN9-WORK54C-CARD-SELECTION-DIAGNOSTIC");
    expect(parsed.executionEnvironment.gitCommitSha).toBe("46735ba3d7045e7badf00f99350bb9068e90d335");
    expect(parsed.diagnosticConditions.matchResults).toEqual({ winsR4: 42, winsGen8: 18, draws: 0, total: 60 });
    expect(parsed.sampleCounts.totalDecisionsCollected).toBe(5480);
    expect(parsed.sampleCounts.decisionsWithAnyVariance).toBe(3779);
    expect(parsed.sampleCounts.decisionsWithKeyCardVariance).toBe(3337);
    expect(parsed.sampleCounts.decisionsWithCostVariance).toBe(3765);
    expect(parsed.sampleCounts.decisionsWithSummonSoldierVariance).toBe(520);
    expect(parsed.sampleCounts.decisionsWithCounterVariance).toBe(222);

    // 4. Q1〜Q5 診断結果の整合性検証
    // コスト支払いは全Policyで同点率100%, 列挙順依存100%, マージン0
    for (const pName of ["Gen8", "R4_v72", "G0_IND7_v72", "G3_IND3_v72"]) {
      const m = parsed.aggregateMetrics[pName];
      expect(m.totalCostGroupsEvaluated).toBe(59087);
      expect(m.costScoreTieRate).toBe(1.0);
      expect(m.costTieBreakRate).toBe(1.0);
      expect(m.costBaseFeatureCollisionRate).toBe(1.0);
      expect(m.costAvgScoreMargin).toBe(0.0);

      // キーカード選択は103,168グループ
      expect(m.totalKeyCardGroupsEvaluated).toBe(103168);
      // Gen 9 G0/G3 では戦術特徴量衝突率が100%
      if (pName.includes("v72") && !pName.includes("R4")) {
        expect(m.keyCardTacticalFeatureCollisionRate).toBe(1.0);
      }
    }

    // 5. レポート内容の整合性検証
    const reportText = fs.readFileSync(reportPath, "utf8");
    expect(reportText).toContain("46735ba3d704");
    expect(reportText).toContain("53f9c9b82c136a8026df79e9fbba8196435db7ac3520b186529308565939dcd6");
    expect(reportText).toContain("103,168");
    expect(reportText).toContain("59,087");
    expect(reportText).toContain("Q1.");
    expect(reportText).toContain("Q2.");
    expect(reportText).toContain("Q3.");
    expect(reportText).toContain("Q4.");
    expect(reportText).toContain("Q5.");
  });
});
