import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { fileURLToPath } from "url";
import { loadRegulationCatalog, RegulationCatalog } from "../../engine/regulation/RegulationLoader";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage } from "../../domain/rules/RulePackage";
import { OfficialRegulationMatchSetup } from "../../engine/regulation/OfficialRegulationMatchSetup";
import { GameSession } from "../../engine/session/GameSession";
import { DecisionDNACodec } from "../../engine/ai/DecisionDNACodec";
import { DecisionDNAValidationError } from "../../domain/ai/DecisionDNATypes";
import { GenomeSensitivityEvaluator } from "../../engine/ai/GenomeSensitivityEvaluator";
import { GenomeSensitivityDNAFactory } from "../../engine/ai/GenomeSensitivityDNAFactory";
import { DecisionRequest } from "../../domain/decision/DecisionRequest";
import { DecisionFeatureEncoder } from "../../engine/ai/DecisionFeatureEncoder";
import { CONTEXT_FEATURE_NAMES, PATTERN_FEATURE_NAMES } from "../../domain/ai/DecisionFeatureTypes";
import { BatchMatchContext } from "../../domain/simulation/BatchSimulationTypes";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Genome Sensitivity & Policy Separability (BP-SIM-AI-GENOME-SENSITIVITY-V1)", () => {
  let catalog: RegulationCatalog;
  let rulePackage: RulePackage;
  let sampleRequest: DecisionRequest;

  beforeAll(async () => {
    catalog = await loadRegulationCatalog();
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);

    // official:standard-pack での実 GameSession から実際の ACTION_REQUEST を抽出
    const reg = catalog.regulations.get("standard-pack");
    if (!reg) throw new Error("Regulation standard-pack not found");
    const frame = catalog.frames.get(reg.frameId);
    if (!frame) throw new Error("Frame not found");

    const outcome = OfficialRegulationMatchSetup.setupMatch(reg, frame, rulePackage, 42, {
      playerNames: { p1: "Player 1", p2: "Player 2" },
    });
    if (outcome.type !== "READY") throw new Error("Setup not ready");

    const session = new GameSession(outcome.state, rulePackage, { matchSeed: 42 });
    const step = session.advance();
    if (step.type !== "WAITING_FOR_DECISION") {
      throw new Error(`Expected WAITING_FOR_DECISION, got: ${step.type}`);
    }
    sampleRequest = step.request;
  });

  const createStandardPackSessionFactory = () => {
    const reg = catalog.regulations.get("standard-pack")!;
    const frame = catalog.frames.get(reg.frameId)!;
    return (context: BatchMatchContext) => {
      const outcome = OfficialRegulationMatchSetup.setupMatch(reg, frame, rulePackage, context.matchSeed, {
        playerNames: { p1: "P1", p2: "P2" },
      });
      if (outcome.type !== "READY") throw new Error(`Setup failed: ${outcome.reason}`);
      return new GameSession(outcome.state, rulePackage, { matchSeed: context.matchSeed });
    };
  };

  describe("A. Decision-Level Sensitivity & Negative Controls", () => {
    it("1. Same DNA Negative Control: score vector 完全一致・selection 完全一致・delta = 0", () => {
      const dnaA = GenomeSensitivityDNAFactory.createActiveBiasedDNA();
      const dnaB = DecisionDNACodec.clone(dnaA);

      const comparison = GenomeSensitivityEvaluator.compareDecision(sampleRequest, dnaA, dnaB);

      expect(comparison.selectionSeparated).toBe(false);
      expect(comparison.selectedPatternRefA).toBe(comparison.selectedPatternRefB);
      expect(comparison.differingScoreCount).toBe(0);
      expect(comparison.maxAbsoluteScoreDelta).toBe(0);
      expect(comparison.meanAbsoluteScoreDelta).toBe(0);
      for (const p of comparison.patterns) {
        expect(p.scoreA).toBe(p.scoreB);
        expect(p.scoreDelta).toBe(0);
      }
    });

    it("2. Metadata-only Negative Control: metadata だけ異なる同一 weight DNA で結果が完全一致", () => {
      const dnaA = GenomeSensitivityDNAFactory.createActiveBiasedDNA({ id: "dna-orig", name: "Original" });
      const dnaB = GenomeSensitivityDNAFactory.createActiveBiasedDNA({ id: "dna-renamed", name: "Renamed" });

      const comparison = GenomeSensitivityEvaluator.compareDecision(sampleRequest, dnaA, dnaB);

      expect(comparison.selectionSeparated).toBe(false);
      expect(comparison.selectedPatternRefA).toBe(comparison.selectedPatternRefB);
      expect(comparison.differingScoreCount).toBe(0);
      expect(comparison.maxAbsoluteScoreDelta).toBe(0);
    });

    it("3. Pattern Linear Weight Sensitivity: weight 変更により score 差が発生すること", () => {
      const zeroDNA = DecisionDNACodec.createZeroDecisionDNA({ id: "zero-dna" });
      const biasedDNA = GenomeSensitivityDNAFactory.createLinearBiasedDNA(
        zeroDNA,
        "pattern_is_action",
        10.0,
        { id: "biased-action-dna" }
      );

      const comparison = GenomeSensitivityEvaluator.compareDecision(sampleRequest, zeroDNA, biasedDNA);

      expect(comparison.differingScoreCount).toBeGreaterThan(0);
      expect(comparison.maxAbsoluteScoreDelta).toBeGreaterThan(0);
      expect(comparison.meanAbsoluteScoreDelta).toBeGreaterThan(0);
    });

    it("4. Pattern Linear Weight による選択差: 実 Request において異なる selectedPatternRef を選択すること", () => {
      // sampleRequest (PASS と ACTION が共存) に対し、active-biased vs pass-biased
      const dnaActive = GenomeSensitivityDNAFactory.createActiveBiasedDNA();
      const dnaPass = GenomeSensitivityDNAFactory.createPassBiasedDNA();

      const comparison = GenomeSensitivityEvaluator.compareDecision(sampleRequest, dnaActive, dnaPass);

      expect(comparison.selectionSeparated).toBe(true);
      expect(comparison.selectedPatternRefA).not.toBe(comparison.selectedPatternRefB);
      expect(comparison.selectedLogicalPatternKeyA).toBeDefined();
      expect(comparison.selectedLogicalPatternKeyB).toBeDefined();
      expect(comparison.differingScoreCount).toBeGreaterThan(0);
    });

    it("5. Context × Pattern Interaction Weight Sensitivity: active feature の相互作用重みにより score 差が発生すること", () => {
      const encoded = DecisionFeatureEncoder.encode(sampleRequest);

      // 実 Request で非 0 な Context Feature および Pattern Feature を探索
      let activeContextIdx = -1;
      for (let i = 0; i < encoded.context.values.length; i++) {
        if (encoded.context.values[i] > 0) {
          activeContextIdx = i;
          break;
        }
      }
      expect(activeContextIdx).toBeGreaterThanOrEqual(0);
      const activeContextName = CONTEXT_FEATURE_NAMES[activeContextIdx];

      // ACTION パターンが存在することを確認
      const activePatternName = "pattern_is_action";

      const baseDNA = DecisionDNACodec.createZeroDecisionDNA({ id: "base-zero" });
      const interactionDNA = GenomeSensitivityDNAFactory.createInteractionBiasedDNA(
        baseDNA,
        activeContextName,
        activePatternName,
        7.5,
        { id: "interaction-biased" }
      );

      const comparison = GenomeSensitivityEvaluator.compareDecision(sampleRequest, baseDNA, interactionDNA);

      expect(comparison.differingScoreCount).toBeGreaterThan(0);
      expect(comparison.maxAbsoluteScoreDelta).toBeGreaterThan(0);
    });

    it("6. Inactive Gene Negative Control: 非活性 feature の重み変更では score vector が不変であること", () => {
      const encoded = DecisionFeatureEncoder.encode(sampleRequest);

      // 実 Request で 0 (inactive) な Context Feature を探索
      let inactiveContextIdx = -1;
      for (let i = 0; i < encoded.context.values.length; i++) {
        if (encoded.context.values[i] === 0) {
          inactiveContextIdx = i;
          break;
        }
      }
      expect(inactiveContextIdx).toBeGreaterThanOrEqual(0);
      const inactiveContextName = CONTEXT_FEATURE_NAMES[inactiveContextIdx];

      const baseDNA = DecisionDNACodec.createZeroDecisionDNA({ id: "base-zero" });
      const inactiveBiasedDNA = GenomeSensitivityDNAFactory.createInteractionBiasedDNA(
        baseDNA,
        inactiveContextName,
        "pattern_is_action",
        15.0,
        { id: "inactive-biased" }
      );

      const comparison = GenomeSensitivityEvaluator.compareDecision(sampleRequest, baseDNA, inactiveBiasedDNA);

      // 非活性な Context Feature の重みをいくら変えても、スコアは全く変化しない
      expect(comparison.differingScoreCount).toBe(0);
      expect(comparison.maxAbsoluteScoreDelta).toBe(0);
      expect(comparison.selectionSeparated).toBe(false);
      expect(comparison.selectedPatternRefA).toBe(comparison.selectedPatternRefB);
    });

    it("7. Determinism: 同一入力で compareDecision を複数回実行して Logical Result が完全一致すること", () => {
      const dnaA = GenomeSensitivityDNAFactory.createActiveBiasedDNA();
      const dnaB = GenomeSensitivityDNAFactory.createPassBiasedDNA();

      const comp1 = GenomeSensitivityEvaluator.compareDecision(sampleRequest, dnaA, dnaB);
      const comp2 = GenomeSensitivityEvaluator.compareDecision(sampleRequest, dnaA, dnaB);

      expect(JSON.stringify(comp1)).toBe(JSON.stringify(comp2));
    });

    it("8. Real GameSession DecisionRequest 上で Sensitivity 評価が成功すること", () => {
      expect(sampleRequest.source.type).toBe("ACTION_REQUEST");
      expect(sampleRequest.patterns.length).toBeGreaterThanOrEqual(2);

      const dnaA = GenomeSensitivityDNAFactory.createActiveBiasedDNA();
      const dnaB = GenomeSensitivityDNAFactory.createPassBiasedDNA();

      const comp = GenomeSensitivityEvaluator.compareDecision(sampleRequest, dnaA, dnaB);
      expect(comp.requestSummary.legalPatternCount).toBe(sampleRequest.patterns.length);
      expect(comp.requestSummary.sourceType).toBe("ACTION_REQUEST");
    });
  });

  describe("B. Match-Level Policy Separability & Experiment Harness", () => {
    it("9. GenomePolicy A/B による Seat Swap 対戦が PolicyExperimentRunner 経由で完走すること", () => {
      const dnaActive = GenomeSensitivityDNAFactory.createActiveBiasedDNA();
      const dnaPass = GenomeSensitivityDNAFactory.createPassBiasedDNA();

      const result = GenomeSensitivityEvaluator.evaluatePolicySeparability({
        experimentId: "match-separability-test",
        environmentRef: "official:standard-pack",
        baseSeed: 42,
        matchesPerSeat: 1,
        maxDecisionsPerMatch: 500,
        dnaA: dnaActive,
        dnaB: dnaPass,
        sessionFactory: createStandardPackSessionFactory(),
      });

      expect(result.experimentResult.summary.totalScheduledMatches).toBe(2);
      expect(result.experimentResult.summary.totalFailedMatches).toBe(0);
      expect(
        result.experimentResult.summary.totalCompletedMatches +
          result.experimentResult.summary.totalIncompleteMatches
      ).toBe(2);
      expect(result.experimentResult.legs.length).toBe(2);
    });

    it("10. FAILED 試合が 0 件であること", () => {
      const dnaActive = GenomeSensitivityDNAFactory.createActiveBiasedDNA();
      const dnaPass = GenomeSensitivityDNAFactory.createPassBiasedDNA();

      const result = GenomeSensitivityEvaluator.evaluatePolicySeparability({
        experimentId: "zero-failure-test",
        environmentRef: "official:standard-pack",
        baseSeed: 100,
        matchesPerSeat: 1,
        dnaA: dnaActive,
        dnaB: dnaPass,
        sessionFactory: createStandardPackSessionFactory(),
      });

      expect(result.experimentResult.summary.totalFailedMatches).toBe(0);
    });

    it("11. Generic Behavior Metric に有意な差が存在すること (behaviorSeparated === true)", () => {
      const dnaActive = GenomeSensitivityDNAFactory.createActiveBiasedDNA();
      const dnaPass = GenomeSensitivityDNAFactory.createPassBiasedDNA();

      const result = GenomeSensitivityEvaluator.evaluatePolicySeparability({
        experimentId: "behavior-delta-test",
        environmentRef: "official:standard-pack",
        baseSeed: 42,
        matchesPerSeat: 1,
        dnaA: dnaActive,
        dnaB: dnaPass,
        sessionFactory: createStandardPackSessionFactory(),
      });

      const mb = result.matchBehaviorSummary;
      expect(mb.behaviorSeparated).toBe(true);

      // active-biased は pass-biased よりも Action 選択比率が高く、Pass 選択比率が低いはず
      expect(mb.metricsA.actionSelectionRate).toBeGreaterThan(mb.metricsB.actionSelectionRate);
      expect(mb.metricsA.passSelectionRate).toBeLessThan(mb.metricsB.passSelectionRate);
    });

    it("12. 同一 Experiment 設定の再実行で Logical Result が完全一致すること", () => {
      const dnaActive = GenomeSensitivityDNAFactory.createActiveBiasedDNA();
      const dnaPass = GenomeSensitivityDNAFactory.createPassBiasedDNA();

      const options = {
        experimentId: "deterministic-experiment-test",
        environmentRef: "official:standard-pack",
        baseSeed: 42,
        matchesPerSeat: 1,
        dnaA: dnaActive,
        dnaB: dnaPass,
        sessionFactory: createStandardPackSessionFactory(),
        sampleRequest,
      };

      const fullResult1 = GenomeSensitivityEvaluator.runFullSensitivityEvaluation(options);
      const fullResult2 = GenomeSensitivityEvaluator.runFullSensitivityEvaluation(options);

      expect(fullResult1.logicalResult.deterministic).toBe(true);
      expect(fullResult1.logicalResult.overallStatus).toBe("POLICY_SEPARABLE");
      expect(JSON.stringify(fullResult1.logicalResult)).toBe(JSON.stringify(fullResult2.logicalResult));
    });

    it("13. Privacy / runtime ID 変更が Sensitivity Logical Result に影響しないこと", () => {
      const dnaA = GenomeSensitivityDNAFactory.createActiveBiasedDNA();
      const dnaB = GenomeSensitivityDNAFactory.createPassBiasedDNA();

      // decisionId や matchId などの runtime GUID を偽装変更
      const mutatedRequest: DecisionRequest = {
        ...sampleRequest,
        decisionId: `mutated-guid-${Math.random()}`,
        matchId: `mutated-match-${Math.random()}`,
      };

      const compOriginal = GenomeSensitivityEvaluator.compareDecision(sampleRequest, dnaA, dnaB);
      const compMutated = GenomeSensitivityEvaluator.compareDecision(mutatedRequest, dnaA, dnaB);

      expect(compOriginal.selectionSeparated).toBe(compMutated.selectionSeparated);
      expect(compOriginal.selectedPatternRefA).toBe(compMutated.selectedPatternRefA);
      expect(compOriginal.selectedPatternRefB).toBe(compMutated.selectedPatternRefB);
      expect(compOriginal.differingScoreCount).toBe(compMutated.differingScoreCount);
      expect(compOriginal.maxAbsoluteScoreDelta).toBe(compMutated.maxAbsoluteScoreDelta);
      expect(compOriginal.meanAbsoluteScoreDelta).toBe(compMutated.meanAbsoluteScoreDelta);
    });

    it("14. 不正な DNA に対し既存 DecisionDNACodec 経由で fail-closed すること", () => {
      const validDNA = GenomeSensitivityDNAFactory.createActiveBiasedDNA();
      const invalidDNA = {
        ...validDNA,
        featureSchemaVersion: 999, // 不正なバージョン
      };

      expect(() => {
        GenomeSensitivityEvaluator.compareDecision(sampleRequest, validDNA, invalidDNA as any);
      }).toThrow(DecisionDNAValidationError);
    });

    it("15. sessionFactory への BatchMatchContext 伝搬と matchSeed の決定論的一致・分離 (matchesPerSeat = 2)", () => {
      const recordedContexts: BatchMatchContext[] = [];

      const trackingSessionFactory = (ctx: BatchMatchContext) => {
        recordedContexts.push(ctx);
        return createStandardPackSessionFactory()(ctx);
      };

      const dnaActive = GenomeSensitivityDNAFactory.createActiveBiasedDNA();
      const dnaPass = GenomeSensitivityDNAFactory.createPassBiasedDNA();

      const result = GenomeSensitivityEvaluator.evaluatePolicySeparability({
        experimentId: "seed-propagation-test",
        environmentRef: "official:standard-pack",
        baseSeed: 42,
        matchesPerSeat: 2,
        maxDecisionsPerMatch: 10,
        dnaA: dnaActive,
        dnaB: dnaPass,
        sessionFactory: trackingSessionFactory,
      });

      // 2 matches * 2 legs = 4 回のセッション生成
      expect(recordedContexts.length).toBe(4);

      const leg1Ctx0 = recordedContexts[0];
      const leg1Ctx1 = recordedContexts[1];
      const leg2Ctx0 = recordedContexts[2];
      const leg2Ctx1 = recordedContexts[3];

      // A. BatchMatchContext が渡されていること
      expect(leg1Ctx0.baseSeed).toBe(42);
      expect(leg1Ctx0.matchIndex).toBe(0);
      expect(leg1Ctx1.matchIndex).toBe(1);

      // B. 異なる matchIndex で matchSeed が異なること
      expect(leg1Ctx0.matchSeed).not.toBe(leg1Ctx1.matchSeed);

      // C. Seat Swap の同一 matchIndex で matchSeed が完全一致すること
      expect(leg1Ctx0.matchSeed).toBe(leg2Ctx0.matchSeed);
      expect(leg1Ctx1.matchSeed).toBe(leg2Ctx1.matchSeed);

      // D. matchId が決定論的に付与されていること
      expect(leg1Ctx0.matchId).toBe(leg2Ctx0.matchId);
      expect(leg1Ctx1.matchId).toBe(leg2Ctx1.matchId);
    });

    it("16. OfficialRegulationMatchSetup および GameSession へ ctx.matchSeed が正しく伝搬されていること", () => {
      let passedSetupSeed: number | undefined;
      let createdSessionMatchSeed: number | undefined;

      const reg = catalog.regulations.get("standard-pack")!;
      const frame = catalog.frames.get(reg.frameId)!;

      const verifyingSessionFactory = (context: BatchMatchContext) => {
        passedSetupSeed = context.matchSeed;
        const outcome = OfficialRegulationMatchSetup.setupMatch(reg, frame, rulePackage, context.matchSeed, {
          playerNames: { p1: "P1", p2: "P2" },
        });
        if (outcome.type !== "READY") throw new Error(`Setup failed: ${outcome.reason}`);
        const session = new GameSession(outcome.state, rulePackage, { matchSeed: context.matchSeed });
        createdSessionMatchSeed = (session as any).options?.matchSeed ?? context.matchSeed;
        return session;
      };

      const dnaActive = GenomeSensitivityDNAFactory.createActiveBiasedDNA();
      const dnaPass = GenomeSensitivityDNAFactory.createPassBiasedDNA();

      GenomeSensitivityEvaluator.evaluatePolicySeparability({
        experimentId: "seed-verification-test",
        environmentRef: "official:standard-pack",
        baseSeed: 9999,
        matchesPerSeat: 1,
        maxDecisionsPerMatch: 5,
        dnaA: dnaActive,
        dnaB: dnaPass,
        sessionFactory: verifyingSessionFactory,
      });

      expect(passedSetupSeed).toBeDefined();
      expect(createdSessionMatchSeed).toBeDefined();
      expect(passedSetupSeed).toBe(createdSessionMatchSeed);
    });

    it("17. FAILED 試合が存在する場合、POLICY_SEPARABLE にならず INSUFFICIENT_EVIDENCE となること (Fail-Closed)", () => {
      const failingSessionFactory = (context: BatchMatchContext) => {
        if (context.matchIndex === 0) {
          throw new Error("意図的な試合生成エラー (Injected Failure)");
        }
        return createStandardPackSessionFactory()(context);
      };

      const dnaActive = GenomeSensitivityDNAFactory.createActiveBiasedDNA();
      const dnaPass = GenomeSensitivityDNAFactory.createPassBiasedDNA();

      const result = GenomeSensitivityEvaluator.runFullSensitivityEvaluation({
        experimentId: "injected-failure-test",
        environmentRef: "official:standard-pack",
        baseSeed: 42,
        matchesPerSeat: 2,
        dnaA: dnaActive,
        dnaB: dnaPass,
        sessionFactory: failingSessionFactory,
        sampleRequest,
      });

      // 少なくとも 1 試合が失敗していること
      expect(result.logicalResult.experimentSummary.totalFailedMatches).toBeGreaterThan(0);
      // FAILED > 0 のため、fail-closed で INSUFFICIENT_EVIDENCE となること
      expect(result.logicalResult.overallStatus).toBe("INSUFFICIENT_EVIDENCE");
      expect(result.logicalResult.overallStatus).not.toBe("POLICY_SEPARABLE");
      expect(result.logicalResult.overallStatus).not.toBe("NOT_SEPARABLE");
    });

    it("18. INCOMPLETE 試合は DRAW (引き分け) に加算されず、厳格に分離されること", () => {
      const dnaActive = GenomeSensitivityDNAFactory.createActiveBiasedDNA();
      const dnaPass = GenomeSensitivityDNAFactory.createPassBiasedDNA();

      // maxDecisionsPerMatch を小さく設定して確実に INCOMPLETE を発生させる
      const result = GenomeSensitivityEvaluator.evaluatePolicySeparability({
        experimentId: "incomplete-not-draw-test",
        environmentRef: "official:standard-pack",
        baseSeed: 42,
        matchesPerSeat: 1,
        maxDecisionsPerMatch: 10,
        dnaA: dnaActive,
        dnaB: dnaPass,
        sessionFactory: createStandardPackSessionFactory(),
      });

      const outcomeA = result.experimentResult.summary.participants[dnaActive.metadata!.id!];
      const outcomeB = result.experimentResult.summary.participants[dnaPass.metadata!.id!];

      expect(outcomeA.incompleteMatches).toBe(2);
      expect(outcomeB.incompleteMatches).toBe(2);

      // INCOMPLETE は DRAW に加算されない
      expect(outcomeA.draws).toBe(0);
      expect(outcomeB.draws).toBe(0);
      expect(outcomeA.wins).toBe(0);
      expect(outcomeB.wins).toBe(0);
      expect(outcomeA.losses).toBe(0);
      expect(outcomeB.losses).toBe(0);
    });

    it("19. 正常評価で行動分離が存在しない場合、NOT_SEPARABLE となること", () => {
      // 同一の DNA 同士を対戦させる
      const dnaA = GenomeSensitivityDNAFactory.createActiveBiasedDNA({ id: "active-clone-a", name: "Clone A" });
      const dnaB = GenomeSensitivityDNAFactory.createActiveBiasedDNA({ id: "active-clone-b", name: "Clone B" });

      const result = GenomeSensitivityEvaluator.runFullSensitivityEvaluation({
        experimentId: "not-separable-test",
        environmentRef: "official:standard-pack",
        baseSeed: 42,
        matchesPerSeat: 1,
        maxDecisionsPerMatch: 10,
        dnaA,
        dnaB,
        sessionFactory: createStandardPackSessionFactory(),
        sampleRequest,
      });

      expect(result.logicalResult.experimentSummary.totalFailedMatches).toBe(0);
      expect(result.logicalResult.decisionSeparated).toBe(false);
      expect(result.logicalResult.matchBehaviorSeparated).toBe(false);
      expect(result.logicalResult.overallStatus).toBe("NOT_SEPARABLE");
    });
  });
});
