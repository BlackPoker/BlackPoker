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
  analyzeScoresTie,
  compareCandidatePairs,
  explainScoreDifferenceBetweenPatterns,
  DecisionDiagnosticRecord,
  EvaluatedCandidateScore,
  PureKeyCardVarianceGroup,
  PureCostPaymentVarianceGroup,
  PolicyGroupEvaluation,
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
    const tieAnalysis = analyzeScoresTie([5.0, 5.0]);
    const mockRecord: DecisionDiagnosticRecord = {
      decisionId: "d1",
      stateVersion: 1,
      activePlayerId: "p1",
      totalPatternsCount: 2,
      pureKeyCardGroups: [
        {
          groupId: "G1",
          actionId: "a",
          costSignature: "",
          targetSignature: "",
          effectSignature: "",
          orderSignature: "",
          keyUnitSignature: "",
          patternRefs: [0, 1],
          candidateCount: 2,
        },
      ],
      pureCostGroups: [],
      hasKeyCardVariance: true,
      hasCostVariance: false,
      hasSummonSoldierVariance: false,
      hasCounterVariance: false,
      policyEvaluations: {
        PolicyA: {
          selectedPatternRef: 0,
          actualChoice: {
            selectedPatternRef: 0,
            selectedActionId: "a",
            selectedKeyCardIds: ["c1"],
            selectedCostSignature: "",
            finalScore: 5.0,
            isGlobalTopScoreTie: true,
            isGlobalTieBreakChosen: true,
          },
          keyCardGroupEvaluations: [
            {
              policyName: "PolicyA",
              groupId: "G1",
              candidateScores: [],
              bestPatternRef: 0,
              bestScore: 5.0,
              secondBestScore: 5.0,
              minScore: 5.0,
              scoreMargin: 0.0,
              scoreRange: 0.0,
              tieAnalysis,
              isGroupChosen: true,
              isGroupTieBreakChosen: true,
              pairComparisons: [
                {
                  candidateRefA: 0,
                  candidateRefB: 1,
                  baseEqual: true,
                  tacticalEqual: true,
                  completeEqual: true,
                },
              ],
              hasPairBaseCollision: true,
              hasPairTacticalCollision: true,
              hasPairCompleteCollision: true,
              allPairsCompleteColliding: true,
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
    expect(metrics.keyCardTopTieExactCount).toBe(1);
    expect(metrics.keyCardTopTieExactRate).toBe(1.0);
    expect(metrics.keyCardAllTiedExactCount).toBe(1);
    expect(metrics.keyCardAllTiedExactRate).toBe(1.0);
    expect(metrics.keyCardPartialTieExactCount).toBe(0);
    expect(metrics.keyCardActualChosenGroupCount).toBe(1);
    expect(metrics.keyCardActualChosenTieBreakCount).toBe(1);
    expect(metrics.keyCardActualChosenTieBreakRate).toBe(1.0);
    expect(metrics.keyCardTotalPairsEvaluated).toBe(1);
    expect(metrics.keyCardPairBaseCollisionCount).toBe(1);
    expect(metrics.keyCardPairCompleteCollisionCount).toBe(1);
    expect(metrics.keyCardPairCompleteCollisionRate).toBe(1.0);
    expect(metrics.keyCardAvgScoreMargin).toBe(0.0);
    expect(metrics.keyCardAvgScoreRange).toBe(0.0);
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

  it("8. Work 5-4C R2 Evidence JSON および Markdown レポートの真正性・完全性が保証されていること", () => {
    const rootDir = process.cwd();
    const evidenceDir = path.resolve(rootDir, "evidence/gen9-work5-4c");
    const evidencePath = path.join(evidenceDir, "gen9-work5-4c-card-selection-diagnostic-r2-d78652a6ab98.json");
    const reportPath = path.join(evidenceDir, "CARD_SELECTION_DIAGNOSTIC_REPORT_R2.md");

    // 1. ファイルの存在確認
    expect(fs.existsSync(evidencePath)).toBe(true);
    expect(fs.existsSync(reportPath)).toBe(true);

    // 2. SHA-256 検証
    const fileContent = fs.readFileSync(evidencePath);
    const actualSha256 = crypto.createHash("sha256").update(fileContent).digest("hex");
    const EXPECTED_SHA256 = "6e94b81fcb18c780257ccc7104bf2f1ca4419b82d5a382e51664ee4497f4c49f";
    expect(actualSha256).toBe(EXPECTED_SHA256);

    // 3. Evidence 内容の整合性検証
    const parsed = JSON.parse(fileContent.toString("utf8"));
    expect(parsed.workId).toBe("BP-SIM-AI-GEN9-WORK54C-DIAGNOSTIC-ACCURACY-R2");
    expect(parsed.schemaVersion).toBe("2.0.0");
    expect(parsed.executionEnvironment.gitCommitSha).toBe("d78652a6ab983c5df9c8c5c087a1c45b96b3dc83");
    expect(parsed.sampleCounts.totalDecisionsCollected).toBe(5480);
    expect(parsed.sampleCounts.decisionsWithAnyVariance).toBe(3779);

    // キーカード同点率は 0.01%, 実選択タイブレーク率は約 0.2%
    for (const pName of ["Gen8", "R4_v72", "G0_IND7_v72", "G3_IND3_v72"]) {
      const m = parsed.aggregateMetrics[pName];
      expect(m.totalKeyCardGroupsEvaluated).toBe(103168);
      expect(m.keyCardTopTieExactCount).toBe(9);
      expect(m.keyCardTopTieExactRate).toBe(0.0001);
      expect(m.keyCardActualChosenTieBreakRate).toBeLessThan(0.005); // 実選択タイブレーク率 < 0.5%

      // コスト支払いは同点率 100%, 実選択タイブレーク率 100%
      expect(m.totalCostGroupsEvaluated).toBe(59087);
      expect(m.costTopTieExactRate).toBe(1.0);
      expect(m.costActualChosenTieBreakRate).toBe(1.0);
      expect(m.costAvgScoreMargin).toBe(0.0);
    }

    // 4. レポート内容の整合性検証
    const reportText = fs.readFileSync(reportPath, "utf8");
    expect(reportText).toContain("d78652a6ab98");
    expect(reportText).toContain("6e94b81fcb18c780257ccc7104bf2f1ca4419b82d5a382e51664ee4497f4c49f");
    expect(reportText).toContain("53f9c9b82c136a8026df79e9fbba8196435db7ac3520b186529308565939dcd6");
    expect(reportText).toContain("103,168");
    expect(reportText).toContain("59,087");
    expect(reportText).toContain("Q1.");
    expect(reportText).toContain("Q2.");
    expect(reportText).toContain("Q3.");
    expect(reportText).toContain("Q4.");
    expect(reportText).toContain("Q5.");
  });

  // ===========================================================================
  // 修正A: 同点判定精緻化テスト (A-3 必須ケース)
  // ===========================================================================
  describe("修正A: analyzeScoresTie (A-3 必須ケース検証)", () => {
    it("Case 1: [5.0, 5.0, 5.0] -> 全候補同点", () => {
      const res = analyzeScoresTie([5.0, 5.0, 5.0]);
      expect(res.exact.hasTopScoreTie).toBe(true);
      expect(res.exact.allCandidatesTied).toBe(true);
      expect(res.exact.hasPartialTie).toBe(false);
      expect(res.exact.topTieCandidateCount).toBe(3);
      expect(res.scoreMargin).toBe(0.0);
      expect(res.scoreRange).toBe(0.0);
    });

    it("Case 2: [5.0, 5.0, 3.0] -> 最高スコア部分同点", () => {
      const res = analyzeScoresTie([5.0, 5.0, 3.0]);
      expect(res.exact.hasTopScoreTie).toBe(true);
      expect(res.exact.allCandidatesTied).toBe(false);
      expect(res.exact.hasPartialTie).toBe(true);
      expect(res.exact.topTieCandidateCount).toBe(2);
      expect(res.scoreMargin).toBe(0.0);
      expect(res.scoreRange).toBe(2.0);
    });

    it("Case 3: [5.0, 4.0, 3.0] -> 同点なし (単独1位)", () => {
      const res = analyzeScoresTie([5.0, 4.0, 3.0]);
      expect(res.exact.hasTopScoreTie).toBe(false);
      expect(res.exact.allCandidatesTied).toBe(false);
      expect(res.exact.hasPartialTie).toBe(false);
      expect(res.exact.topTieCandidateCount).toBe(1);
      expect(res.scoreMargin).toBe(1.0);
      expect(res.scoreRange).toBe(2.0);
    });

    it("Case 4: [5.0, 4.0, 4.0] -> 下位同点 (最高スコアは単独1位)", () => {
      const res = analyzeScoresTie([5.0, 4.0, 4.0]);
      expect(res.exact.hasTopScoreTie).toBe(false);
      expect(res.exact.allCandidatesTied).toBe(false);
      expect(res.exact.hasPartialTie).toBe(false);
      expect(res.exact.topTieCandidateCount).toBe(1);
      expect(res.scoreMargin).toBe(1.0);
      expect(res.scoreRange).toBe(1.0);
    });

    it("Case 5: [5.0, 5.0 - 1e-10, 3.0] -> 厳密比較と近似比較の差分検証", () => {
      const res = analyzeScoresTie([5.0, 5.0 - 1e-10, 3.0]);
      // exact: 厳密には不一致なので単独1位
      expect(res.exact.hasTopScoreTie).toBe(false);
      expect(res.exact.allCandidatesTied).toBe(false);
      expect(res.exact.hasPartialTie).toBe(false);
      expect(res.exact.topTieCandidateCount).toBe(1);

      // approx: 1e-9 以内なので同点判定
      expect(res.approx.hasTopScoreTie).toBe(true);
      expect(res.approx.allCandidatesTied).toBe(false);
      expect(res.approx.hasPartialTie).toBe(true);
      expect(res.approx.topTieCandidateCount).toBe(2);
    });

    it("Case 6: [5.0, 5.0, 5.0, 4.0] -> 4候補中3件同点", () => {
      const res = analyzeScoresTie([5.0, 5.0, 5.0, 4.0]);
      expect(res.exact.hasTopScoreTie).toBe(true);
      expect(res.exact.allCandidatesTied).toBe(false);
      expect(res.exact.hasPartialTie).toBe(true);
      expect(res.exact.topTieCandidateCount).toBe(3);
      expect(res.scoreMargin).toBe(0.0);
      expect(res.scoreRange).toBe(1.0);
    });
  });

  // ===========================================================================
  // 修正D: 合法手グループ化条件の厳密化テスト (D-4 必須ケース 1〜9)
  // ===========================================================================
  describe("修正D: 合法手グループ化条件の決定論的正規化 (D-4 必須ケース 1〜9)", () => {
    it("D-4 Case 1: 同一アクション、同一コスト、同一対象、同一効果でキーカードのみ異なる合法手2件 -> PureKeyCardVarianceGroup", () => {
      const req: DecisionRequest = {
        protocolVersion: "1.0",
        matchId: "m",
        decisionId: "d",
        stateVersion: 1,
        playerId: "p1",
        source: { kind: "chance" } as any,
        catalog: {
          actions: [{ actionId: "action.summonSoldier", actionName: "兵士召喚" }],
          cardSelections: [
            { cardIds: ["c1"], displayCodes: ["C1"] },
            { cardIds: ["c2"], displayCodes: ["C2"] },
          ],
          unitSelections: [],
          costPayments: [{ discardedCardIds: [], drivenBulwarkUnitIds: [], sacrificedUnitIds: [], lifeCount: 0 }],
          targetSelections: [{ targetType: "none" }],
          effectSelections: [{ selectionType: "none" }],
          orderSelections: [],
        },
        patterns: [
          { patternId: "p1", kind: "ACTION", actionSelectionRef: 0, keyCardSelectionRef: 0, costPaymentRef: 0, targetSelectionRef: 0, effectSelectionRef: 0 },
          { patternId: "p2", kind: "ACTION", actionSelectionRef: 0, keyCardSelectionRef: 1, costPaymentRef: 0, targetSelectionRef: 0, effectSelectionRef: 0 },
        ],
        observation: { viewerPlayerId: "p1", players: [], stageRequests: [] } as any,
      };
      const res = classifyDecisionPatterns(req);
      expect(res.pureKeyCardGroups.length).toBe(1);
      expect(res.pureCostGroups.length).toBe(0);
    });

    it("D-4 Case 2: 同一アクション、同一キーカード、同一対象、同一効果でコストのみ異なる合法手2件 -> PureCostPaymentVarianceGroup", () => {
      const req: DecisionRequest = {
        protocolVersion: "1.0",
        matchId: "m",
        decisionId: "d",
        stateVersion: 1,
        playerId: "p1",
        source: { kind: "chance" } as any,
        catalog: {
          actions: [{ actionId: "action.attack", actionName: "攻撃" }],
          cardSelections: [{ cardIds: ["c1"], displayCodes: ["C1"] }],
          unitSelections: [],
          costPayments: [
            { discardedCardIds: ["c-disc-1"], drivenBulwarkUnitIds: [], sacrificedUnitIds: [], lifeCount: 0 },
            { discardedCardIds: ["c-disc-2"], drivenBulwarkUnitIds: [], sacrificedUnitIds: [], lifeCount: 0 },
          ],
          targetSelections: [{ targetType: "player", targetPlayerKey: "p2" }],
          effectSelections: [{ selectionType: "none" }],
          orderSelections: [],
        },
        patterns: [
          { patternId: "p1", kind: "ACTION", actionSelectionRef: 0, keyCardSelectionRef: 0, costPaymentRef: 0, targetSelectionRef: 0, effectSelectionRef: 0 },
          { patternId: "p2", kind: "ACTION", actionSelectionRef: 0, keyCardSelectionRef: 0, costPaymentRef: 1, targetSelectionRef: 0, effectSelectionRef: 0 },
        ],
        observation: { viewerPlayerId: "p1", players: [], stageRequests: [] } as any,
      };
      const res = classifyDecisionPatterns(req);
      expect(res.pureKeyCardGroups.length).toBe(0);
      expect(res.pureCostGroups.length).toBe(1);
    });

    it("D-4 Case 3: キーカードとコストが同時に異なる合法手2件 -> 純粋グループから除外", () => {
      const req: DecisionRequest = {
        protocolVersion: "1.0",
        matchId: "m",
        decisionId: "d",
        stateVersion: 1,
        playerId: "p1",
        source: { kind: "chance" } as any,
        catalog: {
          actions: [{ actionId: "action.attack", actionName: "攻撃" }],
          cardSelections: [
            { cardIds: ["c1"], displayCodes: ["C1"] },
            { cardIds: ["c2"], displayCodes: ["C2"] },
          ],
          unitSelections: [],
          costPayments: [
            { discardedCardIds: ["c-disc-1"], drivenBulwarkUnitIds: [], sacrificedUnitIds: [], lifeCount: 0 },
            { discardedCardIds: ["c-disc-2"], drivenBulwarkUnitIds: [], sacrificedUnitIds: [], lifeCount: 0 },
          ],
          targetSelections: [{ targetType: "none" }],
          effectSelections: [{ selectionType: "none" }],
          orderSelections: [],
        },
        patterns: [
          { patternId: "p1", kind: "ACTION", actionSelectionRef: 0, keyCardSelectionRef: 0, costPaymentRef: 0, targetSelectionRef: 0, effectSelectionRef: 0 },
          { patternId: "p2", kind: "ACTION", actionSelectionRef: 0, keyCardSelectionRef: 1, costPaymentRef: 1, targetSelectionRef: 0, effectSelectionRef: 0 },
        ],
        observation: { viewerPlayerId: "p1", players: [], stageRequests: [] } as any,
      };
      const res = classifyDecisionPatterns(req);
      expect(res.pureKeyCardGroups.length).toBe(0);
      expect(res.pureCostGroups.length).toBe(0);
    });

    it("D-4 Case 4: キーカードのみ異なるが、対象 (targetSelectionRef) が異なる2件 -> 純粋グループから除外", () => {
      const req: DecisionRequest = {
        protocolVersion: "1.0",
        matchId: "m",
        decisionId: "d",
        stateVersion: 1,
        playerId: "p1",
        source: { kind: "chance" } as any,
        catalog: {
          actions: [{ actionId: "action.attack", actionName: "攻撃" }],
          cardSelections: [
            { cardIds: ["c1"], displayCodes: ["C1"] },
            { cardIds: ["c2"], displayCodes: ["C2"] },
          ],
          unitSelections: [],
          costPayments: [{ discardedCardIds: [], drivenBulwarkUnitIds: [], sacrificedUnitIds: [], lifeCount: 0 }],
          targetSelections: [
            { targetType: "unit", targetUnitId: "u1" },
            { targetType: "unit", targetUnitId: "u2" }, // 対象が異なる
          ],
          effectSelections: [{ selectionType: "none" }],
          orderSelections: [],
        },
        patterns: [
          { patternId: "p1", kind: "ACTION", actionSelectionRef: 0, keyCardSelectionRef: 0, costPaymentRef: 0, targetSelectionRef: 0, effectSelectionRef: 0 },
          { patternId: "p2", kind: "ACTION", actionSelectionRef: 0, keyCardSelectionRef: 1, costPaymentRef: 0, targetSelectionRef: 1, effectSelectionRef: 0 },
        ],
        observation: { viewerPlayerId: "p1", players: [], stageRequests: [] } as any,
      };
      const res = classifyDecisionPatterns(req);
      expect(res.pureKeyCardGroups.length).toBe(0);
    });

    it("D-4 Case 5: キーカードのみ異なるが、効果割り当て (effectSelectionRef.assignments) が異なる2件 -> 純粋グループから除外", () => {
      const req: DecisionRequest = {
        protocolVersion: "1.0",
        matchId: "m",
        decisionId: "d",
        stateVersion: 1,
        playerId: "p1",
        source: { kind: "chance" } as any,
        catalog: {
          actions: [{ actionId: "action.block", actionName: "ブロック" }],
          cardSelections: [
            { cardIds: ["c1"], displayCodes: ["C1"] },
            { cardIds: ["c2"], displayCodes: ["C2"] },
          ],
          unitSelections: [],
          costPayments: [{ discardedCardIds: [], drivenBulwarkUnitIds: [], sacrificedUnitIds: [], lifeCount: 0 }],
          targetSelections: [{ targetType: "none" }],
          effectSelections: [
            { selectionType: "unitAssignment", assignments: [{ sourceUnitId: "u1", selectedUnitIds: ["b1"] }] },
            { selectionType: "unitAssignment", assignments: [{ sourceUnitId: "u1", selectedUnitIds: ["b2"] }] }, // 割当て先が異なる
          ],
          orderSelections: [],
        },
        patterns: [
          { patternId: "p1", kind: "ACTION", actionSelectionRef: 0, keyCardSelectionRef: 0, costPaymentRef: 0, targetSelectionRef: 0, effectSelectionRef: 0 },
          { patternId: "p2", kind: "ACTION", actionSelectionRef: 0, keyCardSelectionRef: 1, costPaymentRef: 0, targetSelectionRef: 0, effectSelectionRef: 1 },
        ],
        observation: { viewerPlayerId: "p1", players: [], stageRequests: [] } as any,
      };
      const res = classifyDecisionPatterns(req);
      expect(res.pureKeyCardGroups.length).toBe(0);
    });

    it("D-4 Case 6: コストのみ異なるが、順序 (orderSelectionRef) が異なる2件 -> 純粋グループから除外", () => {
      const req: DecisionRequest = {
        protocolVersion: "1.0",
        matchId: "m",
        decisionId: "d",
        stateVersion: 1,
        playerId: "p1",
        source: { kind: "chance" } as any,
        catalog: {
          actions: [{ actionId: "action.resolve", actionName: "解決" }],
          cardSelections: [{ cardIds: ["c1"], displayCodes: ["C1"] }],
          unitSelections: [],
          costPayments: [
            { discardedCardIds: ["c-disc-1"], drivenBulwarkUnitIds: [], sacrificedUnitIds: [], lifeCount: 0 },
            { discardedCardIds: ["c-disc-2"], drivenBulwarkUnitIds: [], sacrificedUnitIds: [], lifeCount: 0 },
          ],
          targetSelections: [{ targetType: "none" }],
          effectSelections: [{ selectionType: "none" }],
          orderSelections: [
            { orderedIds: ["o1", "o2"] },
            { orderedIds: ["o2", "o1"] }, // 順序が異なる
          ],
        },
        patterns: [
          { patternId: "p1", kind: "ACTION", actionSelectionRef: 0, keyCardSelectionRef: 0, costPaymentRef: 0, targetSelectionRef: 0, effectSelectionRef: 0, orderSelectionRef: 0 },
          { patternId: "p2", kind: "ACTION", actionSelectionRef: 0, keyCardSelectionRef: 0, costPaymentRef: 1, targetSelectionRef: 0, effectSelectionRef: 0, orderSelectionRef: 1 },
        ],
        observation: { viewerPlayerId: "p1", players: [], stageRequests: [] } as any,
      };
      const res = classifyDecisionPatterns(req);
      expect(res.pureCostGroups.length).toBe(0);
    });

    it("D-4 Case 7: keyUnitSelectionRef が異なる2件 -> 純粋キーカードグループから除外", () => {
      const req: DecisionRequest = {
        protocolVersion: "1.0",
        matchId: "m",
        decisionId: "d",
        stateVersion: 1,
        playerId: "p1",
        source: { kind: "chance" } as any,
        catalog: {
          actions: [{ actionId: "action.attack", actionName: "攻撃" }],
          cardSelections: [
            { cardIds: ["c1"], displayCodes: ["C1"] },
            { cardIds: ["c2"], displayCodes: ["C2"] },
          ],
          unitSelections: [
            { unitIds: ["u1"], displayNames: ["U1"] },
            { unitIds: ["u2"], displayNames: ["U2"] }, // ユニットが異なる
          ],
          costPayments: [{ discardedCardIds: [], drivenBulwarkUnitIds: [], sacrificedUnitIds: [], lifeCount: 0 }],
          targetSelections: [{ targetType: "none" }],
          effectSelections: [{ selectionType: "none" }],
          orderSelections: [],
        },
        patterns: [
          { patternId: "p1", kind: "ACTION", actionSelectionRef: 0, keyCardSelectionRef: 0, keyUnitSelectionRef: 0, costPaymentRef: 0, targetSelectionRef: 0, effectSelectionRef: 0 },
          { patternId: "p2", kind: "ACTION", actionSelectionRef: 0, keyCardSelectionRef: 1, keyUnitSelectionRef: 1, costPaymentRef: 0, targetSelectionRef: 0, effectSelectionRef: 0 },
        ],
        observation: { viewerPlayerId: "p1", players: [], stageRequests: [] } as any,
      };
      const res = classifyDecisionPatterns(req);
      expect(res.pureKeyCardGroups.length).toBe(0);
    });

    it("D-4 Case 8: カタログ参照番号が異なるが中身が完全同値な2件 -> 同一グループに正規化", () => {
      const req: DecisionRequest = {
        protocolVersion: "1.0",
        matchId: "m",
        decisionId: "d",
        stateVersion: 1,
        playerId: "p1",
        source: { kind: "chance" } as any,
        catalog: {
          actions: [
            { actionId: "action.summonSoldier", actionName: "兵士召喚" },
            { actionId: "action.summonSoldier", actionName: "兵士召喚" }, // 参照1: 同値
          ],
          cardSelections: [
            { cardIds: ["c1"], displayCodes: ["C1"] },
            { cardIds: ["c2"], displayCodes: ["C2"] },
          ],
          unitSelections: [],
          costPayments: [
            { discardedCardIds: [], drivenBulwarkUnitIds: [], sacrificedUnitIds: [], lifeCount: 0 },
            { discardedCardIds: [], drivenBulwarkUnitIds: [], sacrificedUnitIds: [], lifeCount: 0 }, // 参照1: 同値
          ],
          targetSelections: [{ targetType: "none" }, { targetType: "none" }],
          effectSelections: [{ selectionType: "none" }, { selectionType: "none" }],
          orderSelections: [],
        },
        patterns: [
          { patternId: "p1", kind: "ACTION", actionSelectionRef: 0, keyCardSelectionRef: 0, costPaymentRef: 0, targetSelectionRef: 0, effectSelectionRef: 0 },
          { patternId: "p2", kind: "ACTION", actionSelectionRef: 1, keyCardSelectionRef: 1, costPaymentRef: 1, targetSelectionRef: 1, effectSelectionRef: 1 },
        ],
        observation: { viewerPlayerId: "p1", players: [], stageRequests: [] } as any,
      };
      const res = classifyDecisionPatterns(req);
      expect(res.pureKeyCardGroups.length).toBe(1);
      expect(res.pureKeyCardGroups[0].candidateCount).toBe(2);
    });

    it("D-4 Case 9: effectSelectionRef の summary 文字列が空または欠落していても構造化情報で同一判定可能", () => {
      const req: DecisionRequest = {
        protocolVersion: "1.0",
        matchId: "m",
        decisionId: "d",
        stateVersion: 1,
        playerId: "p1",
        source: { kind: "chance" } as any,
        catalog: {
          actions: [{ actionId: "action.summonSoldier", actionName: "兵士召喚" }],
          cardSelections: [
            { cardIds: ["c1"], displayCodes: ["C1"] },
            { cardIds: ["c2"], displayCodes: ["C2"] },
          ],
          unitSelections: [],
          costPayments: [{ discardedCardIds: [], drivenBulwarkUnitIds: [], sacrificedUnitIds: [], lifeCount: 0 }],
          targetSelections: [{ targetType: "none" }],
          effectSelections: [
            { selectionType: "unit", selectedValues: ["val1"] }, // summary なし
            { selectionType: "unit", selectedValues: ["val1"], summary: "説明文あり" }, // summary ありだが実体同値
          ],
          orderSelections: [],
        },
        patterns: [
          { patternId: "p1", kind: "ACTION", actionSelectionRef: 0, keyCardSelectionRef: 0, costPaymentRef: 0, targetSelectionRef: 0, effectSelectionRef: 0 },
          { patternId: "p2", kind: "ACTION", actionSelectionRef: 0, keyCardSelectionRef: 1, costPaymentRef: 0, targetSelectionRef: 0, effectSelectionRef: 1 },
        ],
        observation: { viewerPlayerId: "p1", players: [], stageRequests: [] } as any,
      };
      const res = classifyDecisionPatterns(req);
      expect(res.pureKeyCardGroups.length).toBe(1);
      expect(res.pureKeyCardGroups[0].candidateCount).toBe(2);
    });
  });

  // ===========================================================================
  // 修正B・修正C: 実選択分離とペア単位特徴量比較テスト
  // ===========================================================================
  describe("修正B & 修正C: 実選択分離とペア単位特徴量比較", () => {
    it("修正B: グループ内最良とPolicy実選択が異なる場合、isGroupChosen=false となること", () => {
      const candidateScores: EvaluatedCandidateScore[] = [
        { patternRef: 0, baseScore: 5.0, tacticalAdjustment: 0, finalScore: 5.0 },
        { patternRef: 1, baseScore: 5.0, tacticalAdjustment: 0, finalScore: 5.0 },
        { patternRef: 2, baseScore: 10.0, tacticalAdjustment: 0, finalScore: 10.0 }, // グループ外で全体最良
      ];

      const group = { groupId: "GRP-1", patternRefs: [0, 1] };
      const actualChoice = {
        selectedPatternRef: 2, // グループ外の手が選ばれた
        selectedActionId: "act",
        selectedKeyCardIds: [],
        selectedCostSignature: "",
        finalScore: 10.0,
        isGlobalTopScoreTie: false,
        isGlobalTieBreakChosen: false,
      };

      const evalRes = evaluateGroupDistinguishability("TestPolicy", group, candidateScores, actualChoice);
      expect(evalRes.bestPatternRef).toBe(0); // グループ内では 0 が最良
      expect(evalRes.isGroupChosen).toBe(false); // しかしPolicy全体としてはこのグループを選んでいない
      expect(evalRes.isGroupTieBreakChosen).toBe(false);
    });

    it("修正C: 特徴量未公開 (undefined) の場合に completeEqual が NOT_AVAILABLE (undefined) となること", () => {
      const candidateScores: EvaluatedCandidateScore[] = [
        { patternRef: 0, baseScore: 5.0, tacticalAdjustment: 0, finalScore: 5.0, baseFeatures: [1, 2] },
        { patternRef: 1, baseScore: 5.0, tacticalAdjustment: 0, finalScore: 5.0, baseFeatures: [1, 2] }, // base は一致、tac は未公開
      ];

      const res = compareCandidatePairs(candidateScores);
      expect(res.pairComparisons.length).toBe(1);
      expect(res.pairComparisons[0].baseEqual).toBe(true);
      expect(res.pairComparisons[0].tacticalEqual).toBeUndefined();
      expect(res.pairComparisons[0].completeEqual).toBeUndefined(); // NOT_AVAILABLE
      expect(res.hasPairBaseCollision).toBe(true);
      expect(res.hasPairTacticalCollision).toBeUndefined();
      expect(res.hasPairCompleteCollision).toBeUndefined();
    });
  });
});
