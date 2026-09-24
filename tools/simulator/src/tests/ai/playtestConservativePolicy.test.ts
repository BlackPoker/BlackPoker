import { describe, it, expect } from "vitest";
import {
  PlaytestConservativePolicy,
  calculatePatternResourceProfile,
  compareResourceBurden,
  DEFAULT_MIN_HAND_RESERVE,
} from "../../engine/playtest/PlaytestConservativePolicy";
import { DecisionRequest } from "../../domain/decision/DecisionRequest";
import { LegalPattern } from "../../domain/decision/LegalPattern";
import {
  ActionSelection,
  CardSelection,
  CostPayment,
  EffectSelection,
} from "../../domain/decision/DecisionCatalog";
import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader";
import { loadRegulationCatalogForBrowser } from "../../engine/regulation/BrowserRegulationLoader";
import {
  startMatchAttempt,
  OFFICIAL_ENV_PREFIX,
} from "../../engine/playtest/PlaytestEnvironmentController";
import {
  createSeatControllers,
  PlaytestSeatControllers,
} from "../../engine/playtest/PlaytestSeatController";
import { PlaytestPolicyFactory } from "../../engine/playtest/PlaytestPolicyFactory";
import {
  advanceAutomatedDecisions,
} from "../../engine/playtest/HumanVsPolicyController";

function makeSyntheticRequest(options: {
  playerId?: string;
  turnPlayerId?: string;
  sourceType?: "ACTION_REQUEST" | "EFFECT_RESOLUTION" | "ZONE_TOP_SELECTION";
  handCount?: number;
  patterns: Array<{
    kind: "ACTION" | "PASS" | "EFFECT_SELECTION";
    timing?: string;
    speed?: string;
    keyCardIds?: string[];
    discardedCardIds?: string[];
    sacrificedUnitIds?: string[];
    drivenBulwarkUnitIds?: string[];
    lifeCount?: number;
  }>;
}): DecisionRequest {
  const playerId = options.playerId ?? "p2";
  const sourceType = options.sourceType ?? "ACTION_REQUEST";
  const actions: ActionSelection[] = [];
  const cardSelections: CardSelection[] = [];
  const costPayments: CostPayment[] = [];
  const effectSelections: EffectSelection[] = [];

  const legalPatterns: LegalPattern[] = options.patterns.map((p, idx) => {
    if (p.kind === "PASS") {
      return {
        patternId: `pat-pass-${idx}`,
        kind: "PASS",
      };
    }

    if (p.kind === "EFFECT_SELECTION") {
      const effRef = effectSelections.length;
      effectSelections.push({
        selectionType: "unit",
        selectedValues: [`val-${idx}`],
        summary: `Effect-${idx}`,
      });
      return {
        patternId: `pat-eff-${idx}`,
        kind: "EFFECT_SELECTION",
        effectSelectionRef: effRef,
      };
    }

    // ACTION
    const actRef = actions.length;
    actions.push({
      actionId: `action.test.${idx}`,
      actionName: `Test Action ${idx}`,
      timing: p.timing,
      speed: p.speed,
    });

    let cardRef: number | undefined;
    if (p.keyCardIds && p.keyCardIds.length > 0) {
      cardRef = cardSelections.length;
      cardSelections.push({
        cardIds: p.keyCardIds,
        displayCodes: p.keyCardIds,
      });
    }

    let costRef: number | undefined;
    if (p.discardedCardIds || p.sacrificedUnitIds || p.drivenBulwarkUnitIds || p.lifeCount) {
      costRef = costPayments.length;
      costPayments.push({
        discardedCardIds: p.discardedCardIds ?? [],
        sacrificedUnitIds: p.sacrificedUnitIds ?? [],
        drivenBulwarkUnitIds: p.drivenBulwarkUnitIds ?? [],
        lifeCount: p.lifeCount ?? 0,
      });
    }

    return {
      patternId: `pat-act-${idx}`,
      kind: "ACTION",
      actionSelectionRef: actRef,
      keyCardSelectionRef: cardRef,
      costPaymentRef: costRef,
    };
  });

  return {
    protocolVersion: "1.0.0",
    matchId: "test-match",
    decisionId: "dec-1",
    stateVersion: 1,
    playerId,
    source:
      sourceType === "ACTION_REQUEST"
        ? { type: "ACTION_REQUEST", playerId }
        : sourceType === "ZONE_TOP_SELECTION"
        ? { type: "ZONE_TOP_SELECTION", zone: "grave", playerId }
        : { type: "EFFECT_RESOLUTION", sourceRequestRef: "req-1", effectStepId: "step-1", playerId },
    observation: {
      viewerPlayerId: playerId,
      turnPlayerId: options.turnPlayerId,
      players: [
        {
          playerId,
          name: "Player",
          isViewer: true,
          lifeDisplay: "10",
          handCount: options.handCount ?? 0,
          handCards: [],
          field: [],
          fog: [],
          trumps: [],
          graveCount: 0,
          grave: [],
          canViewFullGrave: false,
        },
      ],
      stageRequestRefs: [],
      stageRequests: [],
      recentEvents: [],
    },
    catalog: {
      actions,
      cardSelections,
      unitSelections: [],
      costPayments,
      targetSelections: [],
      effectSelections,
      orderSelections: [],
    },
    patterns: legalPatterns,
  };
}

describe("PlaytestConservativePolicy Unit & Integration Tests (BP-SIM-AI-PLAYTEST-1.0-CONSERVATIVE-POLICY)", () => {
  const policy = new PlaytestConservativePolicy();

  // ============================================================
  // 1. Unit Tests - Resource Profile (Section 23)
  // ============================================================
  describe("Section 23: Hand Reserve & Resource Profile Unit Tests", () => {
    it("A: Hand 5, PASSあり, main action (handCommitment 1) -> Action を選択すること", () => {
      const req = makeSyntheticRequest({
        handCount: 5,
        turnPlayerId: "p2",
        patterns: [
          { kind: "ACTION", timing: "main", keyCardIds: ["c1"] },
          { kind: "PASS" },
        ],
      });
      const res = policy.choose(req);
      expect(res.selectedPatternRef).toBe(0);
    });

    it("B: Hand 4, PASSあり, main action (handCommitment 1) -> 手札Actionを避け PASS を選択すること", () => {
      const req = makeSyntheticRequest({
        handCount: 4,
        turnPlayerId: "p2",
        patterns: [
          { kind: "ACTION", timing: "main", keyCardIds: ["c1"] },
          { kind: "PASS" },
        ],
      });
      const res = policy.choose(req);
      expect(res.selectedPatternRef).toBe(1); // PASS
    });

    it("C: Hand 4, 手札Action + handCommitment 0 Action + PASS -> handCommitment 0 Action を選択すること", () => {
      const req = makeSyntheticRequest({
        handCount: 4,
        turnPlayerId: "p2",
        patterns: [
          { kind: "ACTION", timing: "main", keyCardIds: ["c1"] }, // commitment 1 (避ける)
          { kind: "ACTION", timing: "main" }, // commitment 0 (選ぶ)
          { kind: "PASS" },
        ],
      });
      const res = policy.choose(req);
      expect(res.selectedPatternRef).toBe(1); // Pattern 1 (zero-commitment)
    });

    it("D: Hand 3, 手札Actionのみ + PASS -> PASS を選択すること", () => {
      const req = makeSyntheticRequest({
        handCount: 3,
        turnPlayerId: "p2",
        patterns: [
          { kind: "ACTION", timing: "main", keyCardIds: ["c1"] },
          { kind: "PASS" },
        ],
      });
      const res = policy.choose(req);
      expect(res.selectedPatternRef).toBe(1); // PASS
    });

    it("E: PASSなし, Hand 3, 手札Actionのみ -> 最小 resource Action を選択すること (Mandatory Decision)", () => {
      const req = makeSyntheticRequest({
        handCount: 3,
        turnPlayerId: "p2",
        patterns: [
          { kind: "ACTION", timing: "main", keyCardIds: ["c1", "c2"] }, // commitment 2
          { kind: "ACTION", timing: "main", keyCardIds: ["c1"] }, // commitment 1 (最小)
        ],
      });
      const res = policy.choose(req);
      expect(res.selectedPatternRef).toBe(1); // Pattern 1
    });
  });

  // ============================================================
  // 2. Resource Ranking Tests (Section 24)
  // ============================================================
  describe("Section 24: Resource Ranking & Deduplication Tests", () => {
    it("Pattern A (commitment 2) vs Pattern B (commitment 1) -> B を選択すること", () => {
      const req = makeSyntheticRequest({
        handCount: 6,
        turnPlayerId: "p2",
        patterns: [
          { kind: "ACTION", timing: "main", keyCardIds: ["c1", "c2"] },
          { kind: "ACTION", timing: "main", keyCardIds: ["c3"] },
          { kind: "PASS" },
        ],
      });
      const res = policy.choose(req);
      expect(res.selectedPatternRef).toBe(1);
    });

    it("handCommitment同一時の比較順: sacrifice 少 -> lifeCost 少 -> bulwark drive 少 -> pattern index", () => {
      // 1. sacrifice 比較
      const reqSac = makeSyntheticRequest({
        handCount: 4,
        turnPlayerId: "p2",
        patterns: [
          { kind: "ACTION", timing: "main", sacrificedUnitIds: ["u1"] },
          { kind: "ACTION", timing: "main", sacrificedUnitIds: [] },
          { kind: "PASS" },
        ],
      });
      expect(policy.choose(reqSac).selectedPatternRef).toBe(1);

      // 2. lifeCost 比較
      const reqLife = makeSyntheticRequest({
        handCount: 4,
        turnPlayerId: "p2",
        patterns: [
          { kind: "ACTION", timing: "main", lifeCount: 1 },
          { kind: "ACTION", timing: "main", lifeCount: 0 },
          { kind: "PASS" },
        ],
      });
      expect(policy.choose(reqLife).selectedPatternRef).toBe(1);

      // 3. bulwark drive 比較
      const reqBulwark = makeSyntheticRequest({
        handCount: 4,
        turnPlayerId: "p2",
        patterns: [
          { kind: "ACTION", timing: "main", drivenBulwarkUnitIds: ["b1"] },
          { kind: "ACTION", timing: "main", drivenBulwarkUnitIds: [] },
          { kind: "PASS" },
        ],
      });
      expect(policy.choose(reqBulwark).selectedPatternRef).toBe(1);

      // 4. 全て同等の場合は最小 pattern index (安定順序)
      const reqStable = makeSyntheticRequest({
        handCount: 4,
        turnPlayerId: "p2",
        patterns: [
          { kind: "ACTION", timing: "main" },
          { kind: "ACTION", timing: "main" },
          { kind: "PASS" },
        ],
      });
      expect(policy.choose(reqStable).selectedPatternRef).toBe(0);
    });

    it("key card と discard に同一 cardId が含まれた場合は一意カードとして1枚カウントすること", () => {
      const req = makeSyntheticRequest({
        handCount: 4,
        turnPlayerId: "p2",
        patterns: [
          // Pattern 0: keyCard c1 + discard c1 -> unique = 1 (Hand 4 - 1 = 3 < 4 なので温存フェーズでは不適格)
          { kind: "ACTION", timing: "main", keyCardIds: ["c1"], discardedCardIds: ["c1"] },
          // Pattern 1: keyCard c2 + discard c3 -> unique = 2
          { kind: "ACTION", timing: "main", keyCardIds: ["c2"], discardedCardIds: ["c3"] },
        ],
      });
      // PASSなしの Mandatory Decision -> 最小リソースの Pattern 0 が選ばれる
      const res = policy.choose(req);
      expect(res.selectedPatternRef).toBe(0);

      // calculatePatternResourceProfile の直接検証
      const prof0 = calculatePatternResourceProfile(req.patterns[0], 0, req);
      expect(prof0.handCommitment).toBe(1);

      const prof1 = calculatePatternResourceProfile(req.patterns[1], 1, req);
      expect(prof1.handCommitment).toBe(2);
    });
  });

  // ============================================================
  // 3. Turn Relation Tests (Section 25)
  // ============================================================
  describe("Section 25: Turn Relation Tests", () => {
    it("Own Turn: handCount > reserve + main hand actionあり -> 適度にActionを選択すること", () => {
      const req = makeSyntheticRequest({
        handCount: 6,
        turnPlayerId: "p2",
        patterns: [
          { kind: "ACTION", timing: "main", keyCardIds: ["c1"] },
          { kind: "PASS" },
        ],
      });
      expect(policy.choose(req).selectedPatternRef).toBe(0);
    });

    it("Opponent Turn: hand-consuming Quick + PASS -> PASS を選択すること (不用意なQuick連打防止)", () => {
      const req = makeSyntheticRequest({
        handCount: 6,
        turnPlayerId: "p1", // 相手ターン
        patterns: [
          { kind: "ACTION", timing: "quick", keyCardIds: ["c1"] },
          { kind: "PASS" },
        ],
      });
      expect(policy.choose(req).selectedPatternRef).toBe(1); // PASS
    });

    it("Opponent Turn: zero-hand defensive Action + hand-consuming Quick + PASS -> zero-hand Action を選択すること", () => {
      const req = makeSyntheticRequest({
        handCount: 6,
        turnPlayerId: "p1", // 相手ターン
        patterns: [
          { kind: "ACTION", timing: "quick", keyCardIds: ["c1"] }, // hand-consuming Quick
          { kind: "ACTION", timing: "block" }, // zero-hand defense
          { kind: "PASS" },
        ],
      });
      expect(policy.choose(req).selectedPatternRef).toBe(1); // zero-hand Action
    });

    it("turnPlayerId undefined: zero-hand Action があれば優先、なければ PASS", () => {
      // zero-hand あり
      const reqWithZero = makeSyntheticRequest({
        handCount: 6,
        turnPlayerId: undefined,
        patterns: [
          { kind: "ACTION", timing: "main", keyCardIds: ["c1"] },
          { kind: "ACTION", timing: "main" }, // zero-hand
          { kind: "PASS" },
        ],
      });
      expect(policy.choose(reqWithZero).selectedPatternRef).toBe(1);

      // zero-hand なし -> PASS
      const reqWithoutZero = makeSyntheticRequest({
        handCount: 6,
        turnPlayerId: undefined,
        patterns: [
          { kind: "ACTION", timing: "main", keyCardIds: ["c1"] },
          { kind: "PASS" },
        ],
      });
      expect(policy.choose(reqWithoutZero).selectedPatternRef).toBe(1);
    });
  });

  // ============================================================
  // 4. Effect Decision Tests (Section 26)
  // ============================================================
  describe("Section 26: Effect & Resolution Decision Tests", () => {
    it("EFFECT_RESOLUTION: 複数合法Patternがある場合、決定論的に先頭合法Patternを選択すること", () => {
      const req = makeSyntheticRequest({
        sourceType: "EFFECT_RESOLUTION",
        patterns: [
          { kind: "EFFECT_SELECTION" },
          { kind: "EFFECT_SELECTION" },
        ],
      });
      const res = policy.choose(req);
      expect(res.decisionId).toBe(req.decisionId);
      expect(res.stateVersion).toBe(req.stateVersion);
      expect(res.selectedPatternRef).toBe(0);
    });

    it("ZONE_TOP_SELECTION: 複数合法Patternがある場合、決定論的に先頭合法Patternを選択すること", () => {
      const req = makeSyntheticRequest({
        sourceType: "ZONE_TOP_SELECTION",
        patterns: [
          { kind: "EFFECT_SELECTION" },
          { kind: "EFFECT_SELECTION" },
        ],
      });
      const res = policy.choose(req);
      expect(res.decisionId).toBe(req.decisionId);
      expect(res.stateVersion).toBe(req.stateVersion);
      expect(res.selectedPatternRef).toBe(0);
    });
  });

  // ============================================================
  // 5. Determinism Test (Section 27)
  // ============================================================
  describe("Section 27: Determinism & Descriptor Tests", () => {
    it("同一DecisionRequestを独立した複数インスタンスに入力しても完全に同一の回答を返すこと (PRNG不使用)", () => {
      const policy1 = new PlaytestConservativePolicy();
      const policy2 = new PlaytestConservativePolicy();
      const policy3 = new PlaytestConservativePolicy();

      const req = makeSyntheticRequest({
        handCount: 5,
        turnPlayerId: "p2",
        patterns: [
          { kind: "ACTION", timing: "main", keyCardIds: ["c1"] },
          { kind: "ACTION", timing: "main" },
          { kind: "PASS" },
        ],
      });

      const res1 = policy1.choose(req);
      const res2 = policy2.choose(req);
      const res3 = policy3.choose(req);

      expect(res1.selectedPatternRef).toBe(res2.selectedPatternRef);
      expect(res2.selectedPatternRef).toBe(res3.selectedPatternRef);
    });

    it("Descriptor メタデータが正確に定義されていること", () => {
      expect(policy.descriptor.kind).toBe("playtestConservative");
      expect(policy.descriptor.policyVersion).toBe(1);
      expect(policy.descriptor.name).toBe("PlaytestConservative");
      expect(policy.descriptor.metadata?.minHandReserve).toBe(4);
    });
  });

  // ============================================================
  // 6. PreferActionOverPass Regression (Section 29)
  // ============================================================
  describe("Section 29: 「何もしないAI」にしない回帰検証", () => {
    it("Own Turn, Hand 5以上, 合法main Actionあり, reserve 4以上維持可能, PASSあり -> PASSではなくActionを選択すること", () => {
      const req = makeSyntheticRequest({
        handCount: 5,
        turnPlayerId: "p2",
        patterns: [
          { kind: "ACTION", timing: "main", keyCardIds: ["c1"] }, // 5 - 1 = 4 >= 4 (合格)
          { kind: "PASS" },
        ],
      });
      const res = policy.choose(req);
      expect(res.selectedPatternRef).not.toBe(1); // PASS ではない
      expect(res.selectedPatternRef).toBe(0); // Action を選択
    });
  });

  // ============================================================
  // 7. Real Standard+Pack Regression (Section 28)
  // ============================================================
  describe("Section 28: 実公式レギュレーション (official:standard-pack) 統合回帰検証", () => {
    const fullRulePackage = loadRulePackageForBrowser();
    const catalog = loadRegulationCatalogForBrowser();
    const seedsToTest = [42, 551, 20260924];

    for (const seed of seedsToTest) {
      it(`Seed ${seed}: AI (p2 playtestConservative) が合法手を返し、初期手番終了時に手札4枚以上を温存すること`, async () => {
        const outcome = startMatchAttempt({
          environmentId: `${OFFICIAL_ENV_PREFIX}standard-pack`,
          seedInput: String(seed),
          catalog,
          fullRulePackage,
        });

        expect(outcome.type).toBe("READY");
        if (outcome.type !== "READY") return;

        const session = outcome.session;
        const seatControllers: PlaytestSeatControllers = {
          p1: { kind: "HUMAN" },
          p2: { kind: "POLICY", policyId: "playtestConservative" },
        };
        const policies = PlaytestPolicyFactory.createPoliciesForMatch(seatControllers, outcome.activeMatch.seed);
        expect(policies.p2).toBeInstanceOf(PlaytestConservativePolicy);

        let step = outcome.initialStep;
        let aiDecisionCount = 0;
        let aiPassCount = 0;
        let aiNonPassCount = 0;
        let aiInitialHandCount = 0;
        let aiEndHandCount = 0;

        let safetyLoop = 0;
        const MAX_STEPS = 60;

        while (step.type === "WAITING_FOR_DECISION" && safetyLoop++ < MAX_STEPS) {
          if (step.request.playerId === "p1") {
            // Human (p1) は決定論的に PASS を選択して AI に手番を譲る
            const passIdx = step.request.patterns.findIndex((p) => p.kind === "PASS");
            const patternRef = passIdx !== -1 ? passIdx : 0;
            step = session.submitDecision({
              decisionId: step.request.decisionId,
              stateVersion: step.request.stateVersion,
              selectedPatternRef: patternRef,
            });
          } else {
            // AI (p2) の手番 -> advanceAutomatedDecisions で進行
            const aiObsPlayer = step.request.observation.players.find((p) => p.playerId === "p2");
            if (aiInitialHandCount === 0 && aiObsPlayer) {
              aiInitialHandCount = aiObsPlayer.handCount;
            }

            const aiResult = await advanceAutomatedDecisions(
              session,
              step,
              seatControllers,
              policies,
              { viewerPlayerId: "p1" }
            );

            expect(aiResult.status).toBe("STOPPED");
            if (aiResult.status !== "STOPPED") break;

            for (const rec of aiResult.records) {
              aiDecisionCount++;
              const selectedPattern = rec.request.patterns[rec.response.selectedPatternRef];
              expect(selectedPattern).toBeDefined();
              if (selectedPattern.kind === "PASS") {
                aiPassCount++;
              } else {
                aiNonPassCount++;
              }
            }

            step = aiResult.step;

            // AIの最初の手番が終わってHumanに手番が戻ったかゲーム終了した時点で記録
            const curAiObsPlayer = session.state.players.p2;
            aiEndHandCount = curAiObsPlayer.hand.length;

            if (aiDecisionCount > 0 && (step.type !== "WAITING_FOR_DECISION" || step.request.playerId === "p1")) {
              break;
            }
          }
        }

        // 検証:
        // 1. Technical Error が発生しないこと (GameSession 正常)
        // 2. AI が最低1回以上の意思決定を実行したこと
        expect(aiDecisionCount).toBeGreaterThan(0);

        // 3. AIの手札が0枚になっていないこと
        expect(aiEndHandCount).toBeGreaterThan(0);

        // 4. 初回手番終了時に手札4枚以上 (MIN_HAND_RESERVE) を維持していること
        expect(aiEndHandCount).toBeGreaterThanOrEqual(DEFAULT_MIN_HAND_RESERVE);

        // 5. 無限ループしていないこと
        expect(safetyLoop).toBeLessThan(MAX_STEPS);

        // レポート用統計の確認
        expect(aiDecisionCount).toBe(aiPassCount + aiNonPassCount);
      });
    }
  });

  // ============================================================
  // 8. Actual Playability Headless Match (Section 30)
  // ============================================================
  describe("Section 30: Actual Playability Headless Match", () => {
    it("Human vs PlaytestConservative の対戦がデッドロックや stale stateVersion なく安全上限内で正常に進行すること", async () => {
      const fullRulePackage = loadRulePackageForBrowser();
      const catalog = loadRegulationCatalogForBrowser();

      const outcome = startMatchAttempt({
        environmentId: `${OFFICIAL_ENV_PREFIX}standard-pack`,
        seedInput: "42",
        catalog,
        fullRulePackage,
      });

      expect(outcome.type).toBe("READY");
      if (outcome.type !== "READY") return;

      const session = outcome.session;
      const seatControllers: PlaytestSeatControllers = {
        p1: { kind: "HUMAN" },
        p2: { kind: "POLICY", policyId: "playtestConservative" },
      };
      const policies = PlaytestPolicyFactory.createPoliciesForMatch(seatControllers, outcome.activeMatch.seed);

      let step = outcome.initialStep;
      let turnsCount = 0;
      const TARGET_TURNS = 30;

      while (step.type === "WAITING_FOR_DECISION" && turnsCount < TARGET_TURNS) {
        if (step.request.playerId === "p1") {
          // Human は PASS 可能な局面では PASS、強制解決局面では先頭を選択
          const passIdx = step.request.patterns.findIndex((p) => p.kind === "PASS");
          const selectedRef = passIdx !== -1 ? passIdx : 0;
          step = session.submitDecision({
            decisionId: step.request.decisionId,
            stateVersion: step.request.stateVersion,
            selectedPatternRef: selectedRef,
          });
          turnsCount++;
        } else {
          // AI (p2)
          const aiResult = await advanceAutomatedDecisions(
            session,
            step,
            seatControllers,
            policies,
            { viewerPlayerId: "p1" }
          );

          expect(aiResult.status).toBe("STOPPED");
          if (aiResult.status !== "STOPPED") break;

          step = aiResult.step;
          turnsCount += aiResult.records.length;
        }

        if (step.type === "FINISHED") {
          break;
        }
      }

      // デッドロックせず目標ステップ数まで正常に進行したこと
      expect(turnsCount).toBeGreaterThanOrEqual(TARGET_TURNS);
    });
  });
});
