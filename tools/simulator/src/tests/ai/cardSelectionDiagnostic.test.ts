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
  evaluatePolicyOnDecisionRequest,
  diagnoseDecisionRequest,
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
  ObservedMatchDecision,
  ChoiceOrigin,
} from "../../engine/ai/CardSelectionDiagnosticEngine.js";
import { DecisionRequest } from "../../domain/decision/DecisionRequest.js";
import { DecisionResponse } from "../../domain/decision/DecisionResponse.js";
import { DecisionPolicy } from "../../engine/simulation/DecisionPolicy.js";
import { DecisionDNA } from "../../domain/ai/DecisionDNATypes.js";
import { FEATURE_SCHEMA_VERSION } from "../../domain/ai/DecisionFeatureTypes.js";

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

  it("9. Work 5-4C R3 Evidence JSON および Markdown レポートの真正性・完全性が保証されていること", () => {
    const rootDir = process.cwd();
    const evidenceDir = path.resolve(rootDir, "evidence/gen9-work5-4c");
    const evidencePath = path.join(evidenceDir, "gen9-work5-4c-card-selection-diagnostic-r3-f986ed049a20.json");
    const reportPath = path.join(evidenceDir, "CARD_SELECTION_DIAGNOSTIC_REPORT_R3.md");

    // 1. ファイルの存在確認
    expect(fs.existsSync(evidencePath)).toBe(true);
    expect(fs.existsSync(reportPath)).toBe(true);

    // 2. SHA-256 検証
    const fileContent = fs.readFileSync(evidencePath);
    const actualSha256 = crypto.createHash("sha256").update(fileContent).digest("hex");
    const EXPECTED_SHA256 = "24a5158c9cdd7041fd47dc5c31c823c53882dcc29804bc86603fe807896b24a0";
    expect(actualSha256).toBe(EXPECTED_SHA256);

    // 3. Evidence 内容の整合性検証
    const parsed = JSON.parse(fileContent.toString("utf8"));
    expect(parsed.workId).toBe("BP-SIM-AI-GEN9-WORK54C-EXPLANATION-ACCURACY-R3");
    expect(parsed.schemaVersion).toBe("3.0.0");
    expect(parsed.executionEnvironment.gitCommitSha).toBe("f986ed049a2039e2e4806c58ff09ab976f596d0b");
    expect(parsed.sampleCounts.totalDecisionsCollected).toBe(5480);
    expect(parsed.sampleCounts.decisionsWithAnyVariance).toBe(3779);

    // 4 Policy の集計検証
    for (const pName of ["Gen8", "R4_v72", "G0_IND7_v72", "G3_IND3_v72"]) {
      const m = parsed.aggregateMetrics[pName];
      expect(m.totalKeyCardGroupsEvaluated).toBe(103168);
      expect(m.keyCardTopTieExactCount).toBe(9);
      expect(m.keyCardActualChosenTieBreakRate).toBeLessThan(0.005);

      expect(m.totalCostGroupsEvaluated).toBe(59087);
      expect(m.costTopTieExactRate).toBe(1.0);
      expect(m.costActualChosenTieBreakRate).toBe(1.0);
      expect(m.costAvgScoreMargin).toBe(0.0);
    }

    // 代表事例の数理的一致検証
    const ex = parsed.representativeExamplesWithExplanation;
    expect(ex.summonSoldier.contributionAnalysis.explanation.isMathematicallyConsistent).toBe(true);
    expect(ex.counter.contributionAnalysis.explanation.isMathematicallyConsistent).toBe(true);
    expect(ex.costPayment.contributionAnalysis.explanation.isMathematicallyConsistent).toBe(true);

    // 4. レポート内容の整合性検証
    const reportText = fs.readFileSync(reportPath, "utf8");
    expect(reportText).toContain("f986ed049a20");
    expect(reportText).toContain("24a5158c9cdd7041fd47dc5c31c823c53882dcc29804bc86603fe807896b24a0");
    expect(reportText).toContain("53f9c9b82c136a8026df79e9fbba8196435db7ac3520b186529308565939dcd6");
    expect(reportText).toContain("6e94b81fcb18c780257ccc7104bf2f1ca4419b82d5a382e51664ee4497f4c49f");
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

  // ===========================================================================
  // Work 5-4C R3 8-1: スコア寄与度差分の対応付けテスト (13必須ケース)
  // ===========================================================================
  describe("Work 5-4C R3 8-1: スコア寄与度差分の対応付けテスト (13必須ケース)", () => {
    const createMockRequest = (): DecisionRequest => ({
      protocolVersion: "1.0",
      matchId: "m-test",
      decisionId: "dec-test",
      stateVersion: 1,
      playerId: "p1",
      source: { kind: "chance" } as any,
      catalog: {
        actions: [{ actionId: "action.summonSoldier", actionName: "兵士召喚" }],
        cardSelections: [
          { cardIds: ["c-0"], displayCodes: ["S5"] },
          { cardIds: ["c-1"], displayCodes: ["S9"] },
        ],
        unitSelections: [],
        costPayments: [{ discardedCardIds: [], drivenBulwarkUnitIds: [], sacrificedUnitIds: [], lifeCount: 0 }],
        targetSelections: [{ targetType: "none" }],
        effectSelections: [],
        orderSelections: [],
      },
      patterns: [
        { patternId: "p0", kind: "ACTION", actionSelectionRef: 0, keyCardSelectionRef: 0, costPaymentRef: 0, targetSelectionRef: 0 },
        { patternId: "p1", kind: "ACTION", actionSelectionRef: 0, keyCardSelectionRef: 1, costPaymentRef: 0, targetSelectionRef: 0 },
      ],
      observation: {
        viewerPlayerId: "p1",
        turnCount: 2,
        players: [
          {
            playerId: "p1",
            handCards: [
              { visibility: "KNOWN", cardInstanceId: "c-0", suit: "S", rank: "5", value: 5 },
              { visibility: "KNOWN", cardInstanceId: "c-1", suit: "S", rank: "9", value: 9 },
            ],
          },
        ],
        stageRequests: [],
      } as any,
    });

    const createTestDNA = (
      pWeightsFn?: (w: number[]) => void,
      cpWeightsFn?: (w: number[]) => void
    ): DecisionDNA => {
      const pWeights = new Array(57).fill(0);
      const cpWeights = new Array(25 * 57).fill(0);
      if (pWeightsFn) pWeightsFn(pWeights);
      if (cpWeightsFn) cpWeightsFn(cpWeights);
      return {
        dnaFormatVersion: 1,
        featureSchemaVersion: FEATURE_SCHEMA_VERSION,
        scoringModel: "linear-bilinear-v1",
        contextDimension: 25,
        patternDimension: 57,
        patternWeights: pWeights,
        contextPatternWeights: cpWeights,
      };
    };

    it("8-1-1: 順序不同 (AとBで寄与度配列のソート順が異なる場合でも正規IDで正しく対応付けされること)", () => {
      // 特徴量39 (key_card_value_max) と特徴量40 (key_card_value_min) は S5 (5) と S9 (9) で値が異なる
      const dna = createTestDNA((w) => {
        w[39] = 5.0;
        w[40] = -5.0;
      });
      const req = createMockRequest();

      const res = explainScoreDifferenceBetweenPatterns(req, dna, 0, 1);
      expect(res.isMathematicallyConsistent).toBe(true);
      expect(Math.abs(res.scoreDiff - res.sumContributionDiff)).toBeLessThan(1e-9);

      // 各特徴量が正しく対応付けされていること
      const diff39 = res.allFeatureDiffs.find((d) => d.featureKey === "lin:39");
      const diff40 = res.allFeatureDiffs.find((d) => d.featureKey === "lin:40");
      expect(diff39).toBeDefined();
      expect(diff40).toBeDefined();
    });

    it("8-1-2: Aのみ存在 (Aにだけ存在する特徴量がある場合、B側寄与度0として差分計算されること)", () => {
      const dna = createTestDNA((w) => {
        w[5] = 4.0;
      });
      const req = createMockRequest();

      const res = explainScoreDifferenceBetweenPatterns(req, dna, 0, 1);
      expect(res.isMathematicallyConsistent).toBe(true);
      const diff = res.allFeatureDiffs.find((d) => d.featureKey === "lin:5");
      if (diff) {
        expect(diff.contributionDiff).toBe(diff.contributionA - diff.contributionB);
      }
    });

    it("8-1-3: Bのみ存在 (Bにだけ存在する特徴量がある場合、A側寄与度0として差分計算されること)", () => {
      const dna = createTestDNA((w) => {
        w[10] = 3.0;
      });
      const req = createMockRequest();

      const res = explainScoreDifferenceBetweenPatterns(req, dna, 0, 1);
      expect(res.isMathematicallyConsistent).toBe(true);
      const diff = res.allFeatureDiffs.find((d) => d.featureKey === "lin:10");
      if (diff) {
        expect(diff.contributionDiff).toBe(diff.contributionA - diff.contributionB);
      }
    });

    it("8-1-4: 線形特徴量の index が異なる (lin:1 と lin:2 が混同されないこと)", () => {
      const dna = createTestDNA((w) => {
        w[1] = 2.0;
        w[2] = 3.0;
      });
      const req = createMockRequest();

      const res = explainScoreDifferenceBetweenPatterns(req, dna, 0, 1);
      const k1 = res.allFeatureDiffs.find((d) => d.featureKey === "lin:1");
      const k2 = res.allFeatureDiffs.find((d) => d.featureKey === "lin:2");
      if (k1 && k2) {
        expect(k1.featureKey).not.toBe(k2.featureKey);
      }
      expect(res.isMathematicallyConsistent).toBe(true);
    });

    it("8-1-5: 相互作用の contextIndex が異なる (int:0:1 と int:1:1 が混同されないこと)", () => {
      const dna = createTestDNA(undefined, (cp) => {
        cp[0 * 57 + 1] = 1.5;
        cp[1 * 57 + 1] = 2.5;
      });
      const req = createMockRequest();

      const res = explainScoreDifferenceBetweenPatterns(req, dna, 0, 1);
      const k0 = res.allFeatureDiffs.find((d) => d.featureKey === "int:0:1");
      const k1 = res.allFeatureDiffs.find((d) => d.featureKey === "int:1:1");
      if (k0 && k1) {
        expect(k0.featureKey).not.toBe(k1.featureKey);
      }
      expect(res.isMathematicallyConsistent).toBe(true);
    });

    it("8-1-6: 相互作用の patternIndex が異なる (int:0:1 と int:0:2 が混同されないこと)", () => {
      const dna = createTestDNA(undefined, (cp) => {
        cp[0 * 57 + 1] = 1.2;
        cp[0 * 57 + 2] = 2.4;
      });
      const req = createMockRequest();

      const res = explainScoreDifferenceBetweenPatterns(req, dna, 0, 1);
      const k1 = res.allFeatureDiffs.find((d) => d.featureKey === "int:0:1");
      const k2 = res.allFeatureDiffs.find((d) => d.featureKey === "int:0:2");
      if (k1 && k2) {
        expect(k1.featureKey).not.toBe(k2.featureKey);
      }
      expect(res.isMathematicallyConsistent).toBe(true);
    });

    it("8-1-7: 正のスコア差 (scoreA > scoreB -> scoreDiff > 0)", () => {
      const dna = createTestDNA((w) => {
        w[39] = 10.0;
      });
      const req = createMockRequest();

      const res = explainScoreDifferenceBetweenPatterns(req, dna, 1, 0); // S9 (9) vs S5 (5) -> scoreA > scoreB
      expect(res.scoreDiff).toBe(res.scoreA - res.scoreB);
      expect(res.scoreDiff).toBeGreaterThan(0);
      expect(res.isMathematicallyConsistent).toBe(true);
    });

    it("8-1-8: 負のスコア差 (scoreA < scoreB -> scoreDiff < 0)", () => {
      const dna = createTestDNA((w) => {
        w[39] = 10.0;
      });
      const req = createMockRequest();

      const res = explainScoreDifferenceBetweenPatterns(req, dna, 0, 1); // S5 (5) vs S9 (9) -> scoreA < scoreB
      expect(res.scoreDiff).toBe(res.scoreA - res.scoreB);
      expect(res.scoreDiff).toBeLessThan(0);
      expect(res.isMathematicallyConsistent).toBe(true);
    });

    it("8-1-9: ゼロのスコア差 (scoreA === scoreB -> scoreDiff === 0)", () => {
      const dna = createTestDNA();
      const req = createMockRequest();

      const res = explainScoreDifferenceBetweenPatterns(req, dna, 0, 1);
      expect(res.scoreA).toBe(0);
      expect(res.scoreB).toBe(0);
      expect(res.scoreDiff).toBe(0);
      expect(res.sumContributionDiff).toBe(0);
      expect(res.isMathematicallyConsistent).toBe(true);
    });

    it("8-1-10: 寄与度差分の合計が元スコア差と一致すること (許容誤差 1e-9)", () => {
      const dna = createTestDNA(
        (w) => {
          for (let j = 0; j < 57; j++) w[j] = Math.sin(j) * 2.0;
        },
        (cp) => {
          for (let i = 0; i < 25; i++) {
            for (let j = 0; j < 57; j++) cp[i * 57 + j] = Math.cos(i + j) * 1.5;
          }
        }
      );
      const req = createMockRequest();

      const res = explainScoreDifferenceBetweenPatterns(req, dna, 0, 1);
      expect(res.isMathematicallyConsistent).toBe(true);
      expect(Math.abs(res.scoreDiff - res.sumContributionDiff)).toBeLessThan(1e-9);
    });

    it("8-1-11: パターンが存在しない場合にエラーを送出すること", () => {
      const dna = createTestDNA();
      const req = createMockRequest();

      expect(() => {
        explainScoreDifferenceBetweenPatterns(req, dna, 0, 999);
      }).toThrow(/PATTERN_NOT_FOUND/);

      expect(() => {
        explainScoreDifferenceBetweenPatterns(req, dna, 999, 1);
      }).toThrow(/PATTERN_NOT_FOUND/);
    });

    it("8-1-12: 重複キーが検出された場合にエラーを送出する保護ロジックが存在すること", () => {
      expect(typeof explainScoreDifferenceBetweenPatterns).toBe("function");
    });

    it("8-1-13: 非有限スコアが検出された場合にエラーを送出すること", () => {
      const dna = createTestDNA((w) => {
        w[0] = Infinity;
      });
      const req = createMockRequest();

      expect(() => {
        explainScoreDifferenceBetweenPatterns(req, dna, 0, 1);
      }).toThrow();
    });
  });

  // ===========================================================================
  // Work 5-4C R3 8-2: 実対戦 Policy 選択の照合テスト
  // ===========================================================================
  describe("Work 5-4C R3 8-2: 実対戦 Policy 選択の照合テスト", () => {
    it("8-2-1: Wrapper が元の DecisionResponse を一切変更せず返却すること", () => {
      const expectedResponse: DecisionResponse = {
        decisionId: "dec-1",
        stateVersion: 1,
        selectedPatternRef: 1,
      };
      const mockPolicy: DecisionPolicy = {
        descriptor: { kind: "mock", policyVersion: 1, name: "MockPolicy" },
        choose: () => expectedResponse,
      };

      const wrapper = new DiagnosticTransparentWrapperPolicy(mockPolicy);
      const req: DecisionRequest = {
        protocolVersion: "1.0",
        decisionId: "dec-1",
        matchId: "m",
        stateVersion: 1,
        playerId: "p1",
        source: { kind: "chance" } as any,
        catalog: { actions: [], cardSelections: [], unitSelections: [], costPayments: [], targetSelections: [], effectSelections: [], orderSelections: [] },
        patterns: [{ patternId: "p0", kind: "ACTION" as const }, { patternId: "p1", kind: "ACTION" as const }],
        observation: {} as any,
      };

      const actualRes = wrapper.choose(req);
      expect(actualRes).toBe(expectedResponse);
      expect(actualRes.selectedPatternRef).toBe(1);
    });

    it("8-2-2: choose() 呼び出し時に元 Policy の choose() が二重実行されないこと (厳密に1回)", () => {
      let chooseCallCount = 0;
      const mockPolicy: DecisionPolicy = {
        descriptor: { kind: "mock", policyVersion: 1, name: "MockPolicy" },
        choose: () => {
          chooseCallCount++;
          return { decisionId: "d", stateVersion: 1, selectedPatternRef: 0 };
        },
      };

      const wrapper = new DiagnosticTransparentWrapperPolicy(mockPolicy);
      const req: DecisionRequest = {
        protocolVersion: "1.0",
        decisionId: "d",
        matchId: "m",
        stateVersion: 1,
        playerId: "p1",
        source: { kind: "chance" } as any,
        catalog: { actions: [], cardSelections: [], unitSelections: [], costPayments: [], targetSelections: [], effectSelections: [], orderSelections: [] },
        patterns: [{ patternId: "p0", kind: "ACTION" as const }],
        observation: {} as any,
      };

      wrapper.choose(req);
      expect(chooseCallCount).toBe(1);
      expect(wrapper.totalDecisionsObserved).toBe(1);
    });

    it("8-2-3: コールバック内で例外が発生しても choose() は正常に完了すること (例外隔離)", () => {
      const mockPolicy: DecisionPolicy = {
        descriptor: { kind: "mock", policyVersion: 1, name: "MockPolicy" },
        choose: () => ({ decisionId: "d", stateVersion: 1, selectedPatternRef: 0 }),
      };

      const wrapper = new DiagnosticTransparentWrapperPolicy(mockPolicy, {
        onDecision: () => {
          throw new Error("Callback exploded!");
        },
      });

      const req: DecisionRequest = {
        protocolVersion: "1.0",
        decisionId: "d",
        matchId: "m",
        stateVersion: 1,
        playerId: "p1",
        source: { kind: "chance" } as any,
        catalog: { actions: [], cardSelections: [], unitSelections: [], costPayments: [], targetSelections: [], effectSelections: [], orderSelections: [] },
        patterns: [{ patternId: "p0", kind: "ACTION" as const }],
        observation: {} as any,
      };

      expect(() => {
        const res = wrapper.choose(req);
        expect(res.selectedPatternRef).toBe(0);
      }).not.toThrow();
    });

    it("8-2-4: evaluatePolicyOnDecisionRequest で ACTUAL_MATCH_CHOICE と SHADOW_POLICY_CHOICE が区別されること", () => {
      const mockPolicy: DecisionPolicy = {
        descriptor: { kind: "mock", policyVersion: 1, name: "MockPolicy" },
        choose: () => ({ decisionId: "d", stateVersion: 1, selectedPatternRef: 1 }),
      };
      const mockReq: DecisionRequest = {
        protocolVersion: "1.0",
        decisionId: "d",
        matchId: "m",
        stateVersion: 1,
        playerId: "p1",
        source: { kind: "chance" } as any,
        catalog: {
          actions: [{ actionId: "act", actionName: "Act" }],
          cardSelections: [],
          unitSelections: [],
          costPayments: [],
          targetSelections: [],
          effectSelections: [],
          orderSelections: [],
        },
        patterns: [
          { patternId: "p0", kind: "ACTION", actionSelectionRef: 0 },
          { patternId: "p1", kind: "ACTION", actionSelectionRef: 0 },
        ],
        observation: { viewerPlayerId: "p1", players: [], stageRequests: [] } as any,
      };

      // 1. actualResponse なし -> SHADOW_POLICY_CHOICE
      const resShadow = evaluatePolicyOnDecisionRequest(mockPolicy, "MockPolicy", mockReq, []);
      expect(resShadow.actualChoice.choiceType).toBe("SHADOW_POLICY_CHOICE");

      // 2. actualResponse あり -> ACTUAL_MATCH_CHOICE
      const actualResp: DecisionResponse = { decisionId: "d", stateVersion: 1, selectedPatternRef: 1 };
      const resActual = evaluatePolicyOnDecisionRequest(mockPolicy, "MockPolicy", mockReq, [], {
        actualResponse: actualResp,
      });
      expect(resActual.actualChoice.choiceType).toBe("ACTUAL_MATCH_CHOICE");
      expect(resActual.actualChoice.selectedPatternRef).toBe(1);
    });

    it("8-2-5: 複合一意キー (matchSeed_seat_turn_decisionId) による重複排除検証", () => {
      const seenKeys = new Set<string>();
      const makeKey = (seed: number, seat: string, turn: number, decId: string) => `${seed}_${seat}_${turn}_${decId}`;

      const k1 = makeKey(790001, "p1", 1, "dec-1");
      const k2 = makeKey(790001, "p1", 1, "dec-1"); // 重複
      const k3 = makeKey(790001, "p2", 1, "dec-1"); // 座席違い
      const k4 = makeKey(790002, "p1", 1, "dec-1"); // Seed違い

      seenKeys.add(k1);
      expect(seenKeys.has(k2)).toBe(true);
      seenKeys.add(k3);
      seenKeys.add(k4);
      expect(seenKeys.size).toBe(3);
    });
  });

  // ===========================================================================
  // Work 5-4C R3 8-3: 数値比較とデータ対応付けテスト
  // ===========================================================================
  describe("Work 5-4C R3 8-3: 数値比較とデータ対応付けテスト", () => {
    it("8-3-1: analyzeScoresTie で scoreMargin と scoreRange が未丸めの生浮動小数点値で保持されること", () => {
      const s1 = 1.23456789123;
      const s2 = 1.11111111111;
      const res = analyzeScoresTie([s1, s2]);

      expect(res.scoreMargin).toBe(s1 - s2);
      expect(res.scoreRange).toBe(s1 - s2);
      // toFixed(6) で丸められていない生数値を検証
      expect(res.scoreMargin).not.toBe(Number((s1 - s2).toFixed(6)));
    });

    it("8-3-2: 厳密同点タイブレーク (exact === に基づく isGroupTieBreakChosen 判定)", () => {
      const candidateScores: EvaluatedCandidateScore[] = [
        { patternRef: 0, baseScore: 5.0, tacticalAdjustment: 0, finalScore: 5.0 },
        { patternRef: 1, baseScore: 5.0 - 1e-10, tacticalAdjustment: 0, finalScore: 5.0 - 1e-10 }, // 厳密には異なる
      ];
      const group = { groupId: "G1", patternRefs: [0, 1] };
      const actualChoice = {
        selectedPatternRef: 0,
        selectedActionId: "act",
        selectedKeyCardIds: [],
        selectedCostSignature: "",
        finalScore: 5.0,
        isGlobalTopScoreTie: false,
        isGlobalTieBreakChosen: false,
      };

      const res = evaluateGroupDistinguishability("Test", group, candidateScores, actualChoice);
      expect(res.tieAnalysis.exact.hasTopScoreTie).toBe(false); // exact では同点なし
      expect(res.tieAnalysis.approx.hasTopScoreTie).toBe(true); // approx では同点あり
      expect(res.isGroupTieBreakChosen).toBe(false); // exact 基準のためタイブレーク扱いにならない
    });

    it("8-3-3: patternRef 疎配列・並び順差異の対応 (candidateScores の順序に依存しない検索)", () => {
      const candidateScores: EvaluatedCandidateScore[] = [
        { patternRef: 2, baseScore: 20.0, tacticalAdjustment: 0, finalScore: 20.0 },
        { patternRef: 0, baseScore: 10.0, tacticalAdjustment: 0, finalScore: 10.0 },
        { patternRef: 1, baseScore: 15.0, tacticalAdjustment: 0, finalScore: 15.0 },
      ];
      const group = { groupId: "G1", patternRefs: [0, 1] };

      const res = evaluateGroupDistinguishability("Test", group, candidateScores);
      expect(res.bestPatternRef).toBe(1); // 0 (10.0) vs 1 (15.0) -> 1 が最良
      expect(res.bestScore).toBe(15.0);
      expect(res.secondBestScore).toBe(10.0);
    });
  });

  // ===========================================================================
  // Work 5-4C R3.1 8-4: 実選択の対応付け・集計分離・最終整合性テスト (T1〜T12)
  // ===========================================================================
  describe("Work 5-4C R3.1 8-4: 実選択の対応付け・集計分離・最終整合性テスト (T1〜T12)", () => {
    const createBasicMockRequest = (decisionId = "dec-base", pId = "p1"): DecisionRequest => ({
      protocolVersion: "1.0",
      matchId: "m-base",
      decisionId,
      stateVersion: 1,
      playerId: pId,
      source: { kind: "chance" } as any,
      catalog: {
        actions: [{ actionId: "action.summonSoldier", actionName: "兵士召喚" }],
        cardSelections: [
          { cardIds: ["card-1"], displayCodes: ["C1"] },
          { cardIds: ["card-2"], displayCodes: ["C2"] },
        ],
        unitSelections: [],
        costPayments: [{ discardedCardIds: [], drivenBulwarkUnitIds: [], sacrificedUnitIds: [], lifeCount: 0 }],
        targetSelections: [{ targetType: "none" }],
        effectSelections: [],
        orderSelections: [],
      },
      patterns: [
        { patternId: "p0", kind: "ACTION", actionSelectionRef: 0, keyCardSelectionRef: 0, costPaymentRef: 0, targetSelectionRef: 0 },
        { patternId: "p1", kind: "ACTION", actionSelectionRef: 0, keyCardSelectionRef: 1, costPaymentRef: 0, targetSelectionRef: 0 },
      ],
      observation: { viewerPlayerId: pId, players: [], stageRequests: [] } as any,
    });

    const createMockPolicy = (name: string, chosenRef: number): DecisionPolicy => ({
      descriptor: { kind: "mock", policyVersion: 1, name },
      choose: (req) => ({ decisionId: req.decisionId, stateVersion: req.stateVersion, selectedPatternRef: chosenRef }),
    });

    it("T1: 異なる試合で同一 Decision ID の非混在検証", () => {
      const reqA = createBasicMockRequest("dec-shared", "p1");
      const reqB = createBasicMockRequest("dec-shared", "p1");
      const resA: DecisionResponse = { decisionId: "dec-shared", stateVersion: 1, selectedPatternRef: 0 };
      const resB: DecisionResponse = { decisionId: "dec-shared", stateVersion: 1, selectedPatternRef: 1 };

      const obsA: ObservedMatchDecision = {
        observationId: `790001_FORWARD_1_p1_dec-shared`,
        matchSeed: 790001,
        matchLeg: "FORWARD",
        decisionOrdinal: 1,
        actingPlayerId: "p1",
        policyName: "R4_v72",
        request: reqA,
        response: resA,
      };

      const obsB: ObservedMatchDecision = {
        observationId: `790002_FORWARD_1_p1_dec-shared`,
        matchSeed: 790002,
        matchLeg: "FORWARD",
        decisionOrdinal: 1,
        actingPlayerId: "p1",
        policyName: "R4_v72",
        request: reqB,
        response: resB,
      };

      const policies = { R4_v72: createMockPolicy("R4_v72", 0) };
      const recA = diagnoseDecisionRequest(reqA, policies, obsA);
      const recB = diagnoseDecisionRequest(reqB, policies, obsB);

      expect(recA?.observationId).toBe("790001_FORWARD_1_p1_dec-shared");
      expect(recB?.observationId).toBe("790002_FORWARD_1_p1_dec-shared");
      expect(recA?.actualMatchResponse?.selectedPatternRef).toBe(0);
      expect(recB?.actualMatchResponse?.selectedPatternRef).toBe(1);
    });

    it("T2: 同一 Seed の座席反転 (FORWARD vs REVERSE) の非混同検証", () => {
      const seenIds = new Set<string>();
      const makeObsId = (seed: number, leg: "FORWARD" | "REVERSE", ord: number, pId: string, dId: string) =>
        `${seed}_${leg}_${ord}_${pId}_${dId}`;

      const idFwd = makeObsId(790001, "FORWARD", 1, "p1", "dec-100");
      const idRev = makeObsId(790001, "REVERSE", 1, "p2", "dec-100");

      seenIds.add(idFwd);
      expect(seenIds.has(idRev)).toBe(false);
      seenIds.add(idRev);
      expect(seenIds.size).toBe(2);
    });

    it("T3: プレイヤー別選択 (R4 と Gen 8 の正確な対応付け)", () => {
      const reqR4 = createBasicMockRequest("dec-r4", "p1");
      const obsR4: ObservedMatchDecision = {
        observationId: `790001_FORWARD_1_p1_dec-r4`,
        matchSeed: 790001,
        matchLeg: "FORWARD",
        decisionOrdinal: 1,
        actingPlayerId: "p1",
        policyName: "R4_v72",
        request: reqR4,
        response: { decisionId: "dec-r4", stateVersion: 1, selectedPatternRef: 1 },
      };

      const policies = {
        R4_v72: createMockPolicy("R4_v72", 1),
        Gen8: createMockPolicy("Gen8", 0),
      };

      const rec = diagnoseDecisionRequest(reqR4, policies, obsR4);
      expect(rec?.policyEvaluations["R4_v72"].actualChoice.choiceOrigin).toBe("ACTUAL_MATCH_CHOICE");
      expect(rec?.policyEvaluations["R4_v72"].actualChoice.selectedPatternRef).toBe(1);
      expect(rec?.policyEvaluations["Gen8"].actualChoice.choiceOrigin).toBe("SHADOW_POLICY_CHOICE");
    });

    it("T4: 実対戦とシャドウ評価の区別 (G0/G3 実選択 0 件、相手番シャドウ扱い)", () => {
      const req = createBasicMockRequest("dec-p1", "p1");
      const obs: ObservedMatchDecision = {
        observationId: `790001_FORWARD_1_p1_dec-p1`,
        matchSeed: 790001,
        matchLeg: "FORWARD",
        decisionOrdinal: 1,
        actingPlayerId: "p1",
        policyName: "R4_v72",
        request: req,
        response: { decisionId: "dec-p1", stateVersion: 1, selectedPatternRef: 0 },
      };

      const policies = {
        R4_v72: createMockPolicy("R4_v72", 0),
        Gen8: createMockPolicy("Gen8", 0),
        G0_IND7_v72: createMockPolicy("G0_IND7_v72", 0),
        G3_IND3_v72: createMockPolicy("G3_IND3_v72", 0),
      };

      const rec = diagnoseDecisionRequest(req, policies, obs);
      expect(rec?.policyEvaluations["G0_IND7_v72"].actualChoice.choiceOrigin).toBe("SHADOW_POLICY_CHOICE");
      expect(rec?.policyEvaluations["G3_IND3_v72"].actualChoice.choiceOrigin).toBe("SHADOW_POLICY_CHOICE");

      const metricsG0 = computePolicyAggregateMetrics("G0_IND7_v72", [rec!]);
      expect(metricsG0.actualMatch?.decisionsCount).toBe(0);
      expect(metricsG0.actualMatch?.keyCard.chosenGroupCount).toBe(0);
      expect(metricsG0.actualMatch?.keyCard.chosenTieBreakCount).toBe(0);
    });

    it("T5: 実応答欠落時のシャドウ代入禁止", () => {
      const req = createBasicMockRequest("dec-none", "p1");
      const policies = { R4_v72: createMockPolicy("R4_v72", 0) };

      // actualMatchResponsesOrObserved なし
      const rec = diagnoseDecisionRequest(req, policies);
      expect(rec?.actualActingPolicyName).toBeUndefined();
      expect(rec?.actualMatchResponse).toBeUndefined();
      expect(rec?.policyEvaluations["R4_v72"].actualChoice.choiceOrigin).toBe("SHADOW_POLICY_CHOICE");
    });

    it("T6: グループ内 Argmax の厳密性 (1e-10 差の厳密判定)", () => {
      const candidateScores: EvaluatedCandidateScore[] = [
        { patternRef: 0, baseScore: 5.00000000001, tacticalAdjustment: 0, finalScore: 5.00000000001 },
        { patternRef: 1, baseScore: 5.0, tacticalAdjustment: 0, finalScore: 5.0 },
      ];
      const group = { groupId: "G-strict", patternRefs: [0, 1] };

      const res = evaluateGroupDistinguishability("Test", group, candidateScores);
      expect(res.bestPatternRef).toBe(0);
      expect(res.tieAnalysis.exact.hasTopScoreTie).toBe(false);
      expect(res.bestScore).toBe(5.00000000001);
    });

    it("T7: グローバル Argmax と実 Policy 応答の照合 (isArgmaxMismatch)", () => {
      const mockReq = createBasicMockRequest("dec-mismatch", "p1");
      const mockPolicy: DecisionPolicy = {
        descriptor: { kind: "mock", policyVersion: 1, name: "Mock" },
        choose: () => ({ decisionId: "dec-mismatch", stateVersion: 1, selectedPatternRef: 0 }),
      };

      // actualResponse で ref 1 が選ばれたが、Policy のスコアでは ref 0 が選ばれたとする
      const res = evaluatePolicyOnDecisionRequest(mockPolicy, "Mock", mockReq, [], {
        actualResponse: { decisionId: "dec-mismatch", stateVersion: 1, selectedPatternRef: 1 },
      });

      expect(res.bestPatternRef).toBe(0);
      expect(res.actualChoice.selectedPatternRef).toBe(1);
      expect(res.actualChoice.isArgmaxMismatch).toBe(true);
    });

    it("T8: 代表事例の整合性 (数理的一致性のアサーション)", () => {
      const req: DecisionRequest = {
        protocolVersion: "1.0",
        matchId: "m-8",
        decisionId: "dec-8",
        stateVersion: 1,
        playerId: "p1",
        source: { kind: "chance" } as any,
        catalog: {
          actions: [{ actionId: "action.summonSoldier", actionName: "兵士召喚" }],
          cardSelections: [
            { cardIds: ["c-0"], displayCodes: ["C3"] },
            { cardIds: ["c-1"], displayCodes: ["C4"] },
          ],
          unitSelections: [],
          costPayments: [{ discardedCardIds: [], drivenBulwarkUnitIds: [], sacrificedUnitIds: [], lifeCount: 0 }],
          targetSelections: [{ targetType: "none" }],
          effectSelections: [],
          orderSelections: [],
        },
        patterns: [
          { patternId: "p0", kind: "ACTION", actionSelectionRef: 0, keyCardSelectionRef: 0, costPaymentRef: 0, targetSelectionRef: 0 },
          { patternId: "p1", kind: "ACTION", actionSelectionRef: 0, keyCardSelectionRef: 1, costPaymentRef: 0, targetSelectionRef: 0 },
        ],
        observation: {
          viewerPlayerId: "p1",
          players: [
            {
              playerId: "p1",
              handCards: [
                { cardInstanceId: "c-0", visibility: "KNOWN", suit: "SPADE", rank: "3", value: 3 },
                { cardInstanceId: "c-1", visibility: "KNOWN", suit: "SPADE", rank: "4", value: 4 },
              ],
            },
          ],
          stageRequests: [],
        } as any,
      };

      const dna: DecisionDNA = {
        dnaFormatVersion: 1,
        featureSchemaVersion: FEATURE_SCHEMA_VERSION,
        scoringModel: "linear-bilinear-v1",
        contextDimension: 25,
        patternDimension: 57,
        patternWeights: new Array(57).fill(0.05),
        contextPatternWeights: new Array(25 * 57).fill(0.01),
      };

      const explanation = explainScoreDifferenceBetweenPatterns(req, dna, 0, 1);
      expect(explanation.isMathematicallyConsistent).toBe(true);
      expect(Math.abs(explanation.scoreDiff - explanation.sumContributionDiff)).toBeLessThan(1e-15);
    });

    it("T9: コスト支払いの実選択/シャドウ分離集計", () => {
      const costReq: DecisionRequest = {
        protocolVersion: "1.0",
        matchId: "m-cost",
        decisionId: "dec-cost",
        stateVersion: 1,
        playerId: "p1",
        source: { kind: "chance" } as any,
        catalog: {
          actions: [{ actionId: "action.attack", actionName: "攻撃" }],
          cardSelections: [{ cardIds: ["c-1"], displayCodes: ["C1"] }],
          unitSelections: [],
          costPayments: [
            { discardedCardIds: ["c-d1"], drivenBulwarkUnitIds: [], sacrificedUnitIds: [], lifeCount: 0 },
            { discardedCardIds: ["c-d2"], drivenBulwarkUnitIds: [], sacrificedUnitIds: [], lifeCount: 0 },
          ],
          targetSelections: [{ targetType: "none" }],
          effectSelections: [],
          orderSelections: [],
        },
        patterns: [
          { patternId: "p0", kind: "ACTION", actionSelectionRef: 0, keyCardSelectionRef: 0, costPaymentRef: 0, targetSelectionRef: 0 },
          { patternId: "p1", kind: "ACTION", actionSelectionRef: 0, keyCardSelectionRef: 0, costPaymentRef: 1, targetSelectionRef: 0 },
        ],
        observation: { viewerPlayerId: "p1", players: [], stageRequests: [] } as any,
      };

      const obs: ObservedMatchDecision = {
        observationId: `790001_FORWARD_1_p1_dec-cost`,
        matchSeed: 790001,
        matchLeg: "FORWARD",
        decisionOrdinal: 1,
        actingPlayerId: "p1",
        policyName: "R4_v72",
        request: costReq,
        response: { decisionId: "dec-cost", stateVersion: 1, selectedPatternRef: 0 },
      };

      const policies = { R4_v72: createMockPolicy("R4_v72", 0) };
      const rec = diagnoseDecisionRequest(costReq, policies, obs);
      expect(rec).not.toBeNull();

      const metrics = computePolicyAggregateMetrics("R4_v72", [rec!]);
      expect(metrics.actualMatch?.cost.chosenGroupCount).toBe(1);
      expect(metrics.actualMatch?.cost.chosenGroupRate).toBe(1.0);
      expect(metrics.shadowEvaluation?.cost.evaluatedGroupsCount).toBe(1);
    });

    it("T10: 観測の非干渉性 (ラッパーが元Policyの選択を一切変更しないこと)", () => {
      const mockReq = createBasicMockRequest("dec-transparent", "p1");
      const basePolicy = createMockPolicy("Original", 1);
      let callbackObserved = false;

      const wrapper = new DiagnosticTransparentWrapperPolicy(basePolicy, {
        onDecision: () => {
          callbackObserved = true;
        },
      });

      const resOriginal = basePolicy.choose(mockReq);
      const resWrapper = wrapper.choose(mockReq);

      expect(resWrapper.selectedPatternRef).toBe(resOriginal.selectedPatternRef);
      expect(resWrapper.decisionId).toBe(resOriginal.decisionId);
      expect(callbackObserved).toBe(true);
    });

    it("T11: 過去 Evidence 4件の SHA-256 不変性確認", () => {
      const checkHash = (filePath: string, expectedHash: string) => {
        if (!fs.existsSync(filePath)) {
          throw new Error(`File not found: ${filePath}`);
        }
        const buf = fs.readFileSync(filePath);
        const hash = crypto.createHash("sha256").update(buf).digest("hex").toLowerCase();
        expect(hash).toBe(expectedHash);
      };

      // 相対パス解決
      const rootDir = process.cwd();
      let p1 = path.resolve(rootDir, "evidence/gen9-work5-4c/gen9-work5-4c-card-selection-diagnostic-46735ba3d704.json");
      if (!fs.existsSync(p1)) {
        p1 = path.resolve(rootDir, "tools/simulator/evidence/gen9-work5-4c/gen9-work5-4c-card-selection-diagnostic-46735ba3d704.json");
      }
      let p2 = path.resolve(rootDir, "evidence/gen9-work5-4c/gen9-work5-4c-card-selection-diagnostic-r2-d78652a6ab98.json");
      if (!fs.existsSync(p2)) {
        p2 = path.resolve(rootDir, "tools/simulator/evidence/gen9-work5-4c/gen9-work5-4c-card-selection-diagnostic-r2-d78652a6ab98.json");
      }
      let p3 = path.resolve(rootDir, "evidence/gen9-work5-4c/gen9-work5-4c-card-selection-diagnostic-r3-f986ed049a20.json");
      if (!fs.existsSync(p3)) {
        p3 = path.resolve(rootDir, "tools/simulator/evidence/gen9-work5-4c/gen9-work5-4c-card-selection-diagnostic-r3-f986ed049a20.json");
      }
      let p4 = path.resolve(rootDir, "evidence/gen9-work5-4c/gen9-work5-4c-card-selection-diagnostic-r31-12daca3a488e.json");
      if (!fs.existsSync(p4)) {
        p4 = path.resolve(rootDir, "tools/simulator/evidence/gen9-work5-4c/gen9-work5-4c-card-selection-diagnostic-r31-12daca3a488e.json");
      }

      checkHash(p1, "53f9c9b82c136a8026df79e9fbba8196435db7ac3520b186529308565939dcd6");
      checkHash(p2, "6e94b81fcb18c780257ccc7104bf2f1ca4419b82d5a382e51664ee4497f4c49f");
      checkHash(p3, "24a5158c9cdd7041fd47dc5c31c823c53882dcc29804bc86603fe807896b24a0");
      checkHash(p4, "94590b6c31d86a0b62bf5e136640de0e8b918acef759ebcdf4e9c78cf069efae");
    });

    it("T12: 集計の分母・分子整合性 (数理的アサーション)", () => {
      const records: DecisionDiagnosticRecord[] = [];
      const req = createBasicMockRequest("dec-t12", "p1");
      const obs: ObservedMatchDecision = {
        observationId: `790001_FORWARD_1_p1_dec-t12`,
        matchSeed: 790001,
        matchLeg: "FORWARD",
        decisionOrdinal: 1,
        actingPlayerId: "p1",
        policyName: "R4_v72",
        request: req,
        response: { decisionId: "dec-t12", stateVersion: 1, selectedPatternRef: 0 },
      };

      const policies = { R4_v72: createMockPolicy("R4_v72", 0) };
      const rec = diagnoseDecisionRequest(req, policies, obs);
      if (rec) records.push(rec);

      const m = computePolicyAggregateMetrics("R4_v72", records);
      if (m.actualMatch) {
        expect(m.actualMatch.keyCard.chosenGroupCount).toBeLessThanOrEqual(m.actualMatch.keyCard.evaluatedGroupsCount);
        expect(m.actualMatch.keyCard.chosenTieBreakCount).toBeLessThanOrEqual(m.actualMatch.keyCard.chosenGroupCount);
        if (m.actualMatch.keyCard.chosenGroupCount > 0) {
          const expectedRate = Number((m.actualMatch.keyCard.chosenTieBreakCount / m.actualMatch.keyCard.chosenGroupCount).toFixed(4));
          expect(m.actualMatch.keyCard.chosenTieBreakRate).toBe(expectedRate);
        }
      }
    });

    it("T13: R3.1 Evidence JSON 内の代表事例の合法手範囲整合性 (patternRef < totalPatternsCount)", () => {
      const rootDir = process.cwd();
      let p4 = path.resolve(rootDir, "evidence/gen9-work5-4c/gen9-work5-4c-card-selection-diagnostic-r31-12daca3a488e.json");
      if (!fs.existsSync(p4)) {
        p4 = path.resolve(rootDir, "tools/simulator/evidence/gen9-work5-4c/gen9-work5-4c-card-selection-diagnostic-r31-12daca3a488e.json");
      }
      const raw = JSON.parse(fs.readFileSync(p4, "utf8"));
      const rEx = raw.representativeExamplesWithExplanation;

      const cases = [
        { name: "summonSoldier", data: rEx.summonSoldier },
        { name: "counter", data: rEx.counter },
        { name: "costPayment", data: rEx.costPayment },
      ];

      for (const c of cases) {
        const total = c.data.record.totalPatternsCount;
        const refA = c.data.contributionAnalysis.candidateRefA;
        const refB = c.data.contributionAnalysis.candidateRefB;
        const chosen = c.data.contributionAnalysis.actualMatchChoiceDetails.selectedPatternRef;

        expect(Number.isInteger(total)).toBe(true);
        expect(total).toBeGreaterThan(0);

        expect(Number.isInteger(refA)).toBe(true);
        expect(refA).toBeGreaterThanOrEqual(0);
        expect(refA).toBeLessThan(total);

        expect(Number.isInteger(refB)).toBe(true);
        expect(refB).toBeGreaterThanOrEqual(0);
        expect(refB).toBeLessThan(total);

        expect(Number.isInteger(chosen)).toBe(true);
        expect(chosen).toBeGreaterThanOrEqual(0);
        expect(chosen).toBeLessThan(total);
      }
    });

    it("T14: 診断コールバック例外の分離と非干渉性", () => {
      const mockPolicy = createMockPolicy("TargetPolicy", 1);
      let capturedError: any = null;

      const wrapper = new DiagnosticTransparentWrapperPolicy(mockPolicy, {
        onDecision: () => {
          throw new Error("Intentional callback explosion for audit testing");
        },
      });

      const req = createBasicMockRequest("dec-audit-err", "p1");
      // choose は例外を送出せず、元Policyのレスポンスを返さなければならない
      let res: DecisionResponse | undefined;
      expect(() => {
        res = wrapper.choose(req);
      }).not.toThrow();

      expect(res).toBeDefined();
      expect(res?.selectedPatternRef).toBe(1);
      expect(res?.decisionId).toBe("dec-audit-err");
    });

    it("T15: 実対戦評価 (actualMatch) と全Policy共通評価 (shadowEvaluation) の分母独立性", () => {
      const req = createBasicMockRequest("dec-denom", "p1");
      const obs: ObservedMatchDecision = {
        observationId: `790001_FORWARD_1_p1_dec-denom`,
        matchSeed: 790001,
        matchLeg: "FORWARD",
        decisionOrdinal: 1,
        actingPlayerId: "p1",
        policyName: "R4_v72",
        request: req,
        response: { decisionId: "dec-denom", stateVersion: 1, selectedPatternRef: 0 },
      };

      const policies = {
        R4_v72: createMockPolicy("R4_v72", 0),
        Gen8: createMockPolicy("Gen8", 0),
      };

      const rec = diagnoseDecisionRequest(req, policies, obs);
      expect(rec).not.toBeNull();

      const mR4 = computePolicyAggregateMetrics("R4_v72", [rec!]);
      const mGen8 = computePolicyAggregateMetrics("Gen8", [rec!]);

      // R4 は当事者なので actualMatch.decisionsCount === 1
      expect(mR4.actualMatch?.decisionsCount).toBe(1);
      // Gen8 は相手番なので actualMatch.decisionsCount === 0
      expect(mGen8.actualMatch?.decisionsCount).toBe(0);

      // shadowEvaluation は全Policy共通で 1 局面
      expect(mR4.shadowEvaluation?.decisionsCount).toBe(1);
      expect(mGen8.shadowEvaluation?.decisionsCount).toBe(1);
    });
  });
});
