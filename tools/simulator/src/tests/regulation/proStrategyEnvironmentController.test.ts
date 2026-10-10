import { describe, it, expect, beforeAll, vi } from "vitest";
import path from "path";
import {
  loadRegulationCatalog,
  clearRegulationCache,
} from "../../engine/regulation/RegulationLoader";
import {
  getAvailableEnvironments,
  startMatchAttempt,
  MatchStartRequest,
} from "../../engine/playtest/PlaytestEnvironmentController";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RegulationValidator } from "../../engine/regulation/RegulationValidator";
import { CardOccurrenceSelection } from "../../engine/regulation/SimulatorDeckProfileResolver";

describe("BP-SIM-PRO-STRATEGY-PHASE-2: PlaytestEnvironmentController Scenario Hand Integration", () => {
  let catalog: any;
  let fullRulePackage: any;

  beforeAll(async () => {
    clearRegulationCache();
    catalog = await loadRegulationCatalog();
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    fullRulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  describe("1. Environment Selector & SetupRequirements Contract", () => {
    it("pro-strategy is exposed in getAvailableEnvironments (simulatorImplemented = true)", () => {
      const val = RegulationValidator.validateCombination(catalog, "pro", "strategy");
      expect(val.simulatorImplemented).toBe(true);

      const envs = getAvailableEnvironments(catalog);
      const proStrategyEnv = envs.find(
        (e) => e.regulationId === "pro-strategy" || e.id === "official:pro-strategy"
      );
      expect(proStrategyEnv).toBeDefined();
      expect(proStrategyEnv?.id).toBe("official:pro-strategy");
      expect(proStrategyEnv?.name).toBe("プロ + ストラテジー (公式)");
      expect(proStrategyEnv?.setupRequirements?.scenarioHandCount).toBe(3);
      expect(proStrategyEnv?.setupRequirements?.rareCardCount).toBe(1);
    });

    it("available environments correctly reflect setupRequirements", () => {
      const envs = getAvailableEnvironments(catalog);
      for (const env of envs) {
        expect(env.setupRequirements).toBeDefined();
        if (env.id === "official:pro-strategy") {
          expect(env.setupRequirements?.scenarioHandCount).toBe(3);
          expect(env.setupRequirements?.rareCardCount).toBe(1);
        } else {
          expect(env.setupRequirements?.scenarioHandCount).toBe(0);
          if (env.id.includes("rarePack")) {
            expect(env.setupRequirements?.rareCardCount).toBe(1);
          } else {
            expect(env.setupRequirements?.rareCardCount).toBe(0);
          }
        }
      }
    });
  });

  describe("2. Fail-Closed Validation on non-scenario environments", () => {
    it("rejects scenarioHandSelections on environments where scenarioHandCount is 0", async () => {
      const request: MatchStartRequest = {
        catalog,
        fullRulePackage,
        environmentId: "official:pro-rarePack",
        matchMode: "humanVsHuman",
        seedInput: "42",
        rareCardSelections: {
          p1: [{ suit: "J", rank: "Joker", occurrence: 0 }],
          p2: [{ suit: "J", rank: "Joker", occurrence: 0 }],
        },
        scenarioHandSelections: {
          p1: [
            { suit: "S", rank: "A" },
            { suit: "H", rank: "K" },
            { suit: "D", rank: "Q" },
          ],
        },
      };

      const outcome = await startMatchAttempt(request);
      expect(outcome.type).toBe("VALIDATION_ERROR");
      if (outcome.type === "VALIDATION_ERROR") {
        expect(outcome.setupNotice?.title).toContain("シナリオ手札設定エラー");
        expect(outcome.setupNotice?.message).toContain("シナリオ手札が不要な環境ですが、選択が指定されています。");
      }
    });
  });

  describe("3. Mocked pro-strategy Environment Execution", () => {
    // pro-strategy の simulatorImplemented をテスト内でのみ一時的にモックして startMatchAttempt のフローを検証
    let testCatalog: any;

    beforeAll(() => {
      // testCatalog: pro-strategy のバリデーションをパスできるようにする
      testCatalog = {
        ...catalog,
        regulations: new Map(catalog.regulations),
      };
    });

    const validP1Scenario: CardOccurrenceSelection[] = [
      { suit: "S", rank: "A" },
      { suit: "H", rank: "K" },
      { suit: "D", rank: "Q" },
    ];
    const validP2Scenario: CardOccurrenceSelection[] = [
      { suit: "C", rank: "J" },
      { suit: "D", rank: "10" },
      { suit: "H", rank: "9" },
    ];
    const validP1Rare: CardOccurrenceSelection[] = [{ suit: "J", rank: "Joker", occurrence: 0 }];
    const validP2Rare: CardOccurrenceSelection[] = [{ suit: "J", rank: "Joker", occurrence: 1 }];

    // Phase 4 で pro:strategy が正式公開されたため、Validator のモックは不要 (no-op restore 関数を返却)
    const enableProStrategyInValidator = () => {
      return () => {};
    };

    it("Human vs Human: requires both P1 and P2 scenarioHandSelections", async () => {
      const restore = enableProStrategyInValidator();
      try {
        // P1 missing
        const reqMissingP1: MatchStartRequest = {
          catalog: testCatalog,
          fullRulePackage,
          environmentId: "official:pro-strategy",
          matchMode: "humanVsHuman",
          seedInput: "42",
          rareCardSelections: { p1: validP1Rare, p2: validP2Rare },
          scenarioHandSelections: { p2: validP2Scenario },
        };
        const resMissingP1 = await startMatchAttempt(reqMissingP1);
        expect(resMissingP1.type).toBe("VALIDATION_ERROR");
        if (resMissingP1.type === "VALIDATION_ERROR") {
          expect(resMissingP1.setupNotice?.message).toContain("Player A のシナリオ手札が選択されていません");
        }

        // P2 missing
        const reqMissingP2: MatchStartRequest = {
          catalog: testCatalog,
          fullRulePackage,
          environmentId: "official:pro-strategy",
          matchMode: "humanVsHuman",
          seedInput: "42",
          rareCardSelections: { p1: validP1Rare, p2: validP2Rare },
          scenarioHandSelections: { p1: validP1Scenario },
        };
        const resMissingP2 = await startMatchAttempt(reqMissingP2);
        expect(resMissingP2.type).toBe("VALIDATION_ERROR");
        if (resMissingP2.type === "VALIDATION_ERROR") {
          expect(resMissingP2.setupNotice?.message).toContain("Player B のシナリオ手札が選択されていません");
        }

        // Both provided and valid -> READY
        const reqValid: MatchStartRequest = {
          catalog: testCatalog,
          fullRulePackage,
          environmentId: "official:pro-strategy",
          matchMode: "humanVsHuman",
          seedInput: "42",
          rareCardSelections: { p1: validP1Rare, p2: validP2Rare },
          scenarioHandSelections: { p1: validP1Scenario, p2: validP2Scenario },
        };
        const resValid = await startMatchAttempt(reqValid);
        expect(resValid.type).toBe("READY");
        if (resValid.type === "READY") {
          expect(resValid.activeMatch?.scenarioHandSelections?.p1).toEqual(validP1Scenario);
          expect(resValid.activeMatch?.scenarioHandSelections?.p2).toEqual(validP2Scenario);

          // ターン1開始時、先攻プレイヤーは初手ドローするため 7 + 1 = 8枚、後攻は 7枚
          const first = resValid.firstPlayer;
          const other = first === "p1" ? "p2" : "p1";
          expect(resValid.session.state.players[first].hand.length).toBe(8);
          expect(resValid.session.state.players[other].hand.length).toBe(7);

          // シナリオ手札が初期手札（通常手札として扱われる）に含まれていることを検証
          for (const s of validP1Scenario) {
            expect(
              resValid.session.state.players.p1.hand.some((c) => c.suit === s.suit && c.rank === s.rank)
            ).toBe(true);
          }
          for (const s of validP2Scenario) {
            expect(
              resValid.session.state.players.p2.hand.some((c) => c.suit === s.suit && c.rank === s.rank)
            ).toBe(true);
          }
        }
      } finally {
        restore();
      }
    });

    it("Human vs Human: detects mutual exclusion error between Scenario Hand and Rare Card", async () => {
      const restore = enableProStrategyInValidator();
      try {
        const reqDuplicate: MatchStartRequest = {
          catalog: testCatalog,
          fullRulePackage,
          environmentId: "official:pro-strategy",
          matchMode: "humanVsHuman",
          seedInput: "42",
          rareCardSelections: {
            p1: [{ suit: "S", rank: "A" }], // Overlaps with scenario
            p2: validP2Rare,
          },
          scenarioHandSelections: { p1: validP1Scenario, p2: validP2Scenario },
        };
        const res = await startMatchAttempt(reqDuplicate);
        expect(res.type).toBe("VALIDATION_ERROR");
        if (res.type === "VALIDATION_ERROR") {
          expect(res.setupNotice?.title).toContain("物理カード重複エラー");
        }
      } finally {
        restore();
      }
    });

    it("Human vs AI: auto-resolves AI scenario hand deterministically and protects hidden info", async () => {
      const restore = enableProStrategyInValidator();
      try {
        const reqAi1: MatchStartRequest = {
          catalog: testCatalog,
          fullRulePackage,
          environmentId: "official:pro-strategy",
          matchMode: "humanVsAi",
          seedInput: "42",
          rareCardSelections: { p1: validP1Rare }, // AI Rare Card auto resolves
          scenarioHandSelections: { p1: validP1Scenario }, // AI Scenario Hand auto resolves
        };
        const res1 = await startMatchAttempt(reqAi1);
        expect(res1.type).toBe("READY");
        if (res1.type === "READY") {
          expect(res1.activeMatch?.scenarioHandSelections?.p1).toEqual(validP1Scenario);
          const aiScenario1 = res1.activeMatch?.scenarioHandSelections?.p2;
          expect(aiScenario1).toBeDefined();
          expect(aiScenario1?.length).toBe(3);

          // Verify AI rare card does not overlap with AI scenario cards
          const aiRare = res1.activeMatch?.rareCardSelections?.p2;
          expect(aiRare).toBeDefined();
          for (const s of aiScenario1!) {
            for (const r of aiRare!) {
              const sameCard = s.suit === r.suit && s.rank === r.rank && (s.occurrence ?? 0) === (r.occurrence ?? 0);
              expect(sameCard).toBe(false);
            }
          }

          // Same seed produces identical AI selections
          const res2 = await startMatchAttempt(reqAi1);
          if (res2.type === "READY") {
            expect(res2.activeMatch?.scenarioHandSelections?.p2).toEqual(aiScenario1);
          }
        }
      } finally {
        restore();
      }
    });

    describe("4. Headless Validation Contract [BP-SIM-PRO-STRATEGY-PHASE-2-R1]", () => {
      it("A. rejects when scenarioHandSelections is completely undefined (VALIDATION_ERROR, not TECHNICAL_ERROR)", async () => {
        const restore = enableProStrategyInValidator();
        try {
          const req: MatchStartRequest = {
            catalog: testCatalog,
            fullRulePackage,
            environmentId: "official:pro-strategy",
            // matchMode undefined
            seedInput: "42",
            rareCardSelections: { p1: validP1Rare, p2: validP2Rare },
            scenarioHandSelections: undefined,
          };
          const res = await startMatchAttempt(req);
          expect(res.type).toBe("VALIDATION_ERROR");
          expect(res.type).not.toBe("TECHNICAL_ERROR");
          if (res.type === "VALIDATION_ERROR") {
            expect(res.setupNotice?.message).toContain("シナリオ手札の選択が必要です");
          }
        } finally {
          restore();
        }
      });

      it("B. rejects when only P1 scenario is provided (VALIDATION_ERROR: Player B missing)", async () => {
        const restore = enableProStrategyInValidator();
        try {
          const req: MatchStartRequest = {
            catalog: testCatalog,
            fullRulePackage,
            environmentId: "official:pro-strategy",
            seedInput: "42",
            rareCardSelections: { p1: validP1Rare, p2: validP2Rare },
            scenarioHandSelections: { p1: validP1Scenario },
          };
          const res = await startMatchAttempt(req);
          expect(res.type).toBe("VALIDATION_ERROR");
          expect(res.type).not.toBe("TECHNICAL_ERROR");
          if (res.type === "VALIDATION_ERROR") {
            expect(res.setupNotice?.message).toContain("Player B のシナリオ手札が選択されていません");
          }
        } finally {
          restore();
        }
      });

      it("C. rejects when only P2 scenario is provided (VALIDATION_ERROR: Player A missing)", async () => {
        const restore = enableProStrategyInValidator();
        try {
          const req: MatchStartRequest = {
            catalog: testCatalog,
            fullRulePackage,
            environmentId: "official:pro-strategy",
            seedInput: "42",
            rareCardSelections: { p1: validP1Rare, p2: validP2Rare },
            scenarioHandSelections: { p2: validP2Scenario },
          };
          const res = await startMatchAttempt(req);
          expect(res.type).toBe("VALIDATION_ERROR");
          expect(res.type).not.toBe("TECHNICAL_ERROR");
          if (res.type === "VALIDATION_ERROR") {
            expect(res.setupNotice?.message).toContain("Player A のシナリオ手札が選択されていません");
          }
        } finally {
          restore();
        }
      });

      it("D. succeeds when both P1 and P2 scenario are valid", async () => {
        const restore = enableProStrategyInValidator();
        try {
          const req: MatchStartRequest = {
            catalog: testCatalog,
            fullRulePackage,
            environmentId: "official:pro-strategy",
            seedInput: "42",
            rareCardSelections: { p1: validP1Rare, p2: validP2Rare },
            scenarioHandSelections: { p1: validP1Scenario, p2: validP2Scenario },
          };
          const res = await startMatchAttempt(req);
          expect(res.type).toBe("READY");
        } finally {
          restore();
        }
      });

      it("E. rejects when P1 Scenario overlaps with P1 Rare (VALIDATION_ERROR, not TECHNICAL_ERROR)", async () => {
        const restore = enableProStrategyInValidator();
        try {
          const req: MatchStartRequest = {
            catalog: testCatalog,
            fullRulePackage,
            environmentId: "official:pro-strategy",
            seedInput: "42",
            rareCardSelections: {
              p1: [{ suit: "S", rank: "A" }], // overlaps with validP1Scenario (S-A)
              p2: validP2Rare,
            },
            scenarioHandSelections: { p1: validP1Scenario, p2: validP2Scenario },
          };
          const res = await startMatchAttempt(req);
          expect(res.type).toBe("VALIDATION_ERROR");
          expect(res.type).not.toBe("TECHNICAL_ERROR");
          if (res.type === "VALIDATION_ERROR") {
            expect(res.setupNotice?.title).toContain("物理カード重複エラー");
            expect(res.setupNotice?.message).toContain("Player A のシナリオ手札とレアカードで重複があります");
          }
        } finally {
          restore();
        }
      });

      it("F. rejects when P2 Scenario overlaps with P2 Rare (VALIDATION_ERROR, not TECHNICAL_ERROR)", async () => {
        const restore = enableProStrategyInValidator();
        try {
          const req: MatchStartRequest = {
            catalog: testCatalog,
            fullRulePackage,
            environmentId: "official:pro-strategy",
            seedInput: "42",
            rareCardSelections: {
              p1: validP1Rare,
              p2: [{ suit: "C", rank: "J" }], // overlaps with validP2Scenario (C-J)
            },
            scenarioHandSelections: { p1: validP1Scenario, p2: validP2Scenario },
          };
          const res = await startMatchAttempt(req);
          expect(res.type).toBe("VALIDATION_ERROR");
          expect(res.type).not.toBe("TECHNICAL_ERROR");
          if (res.type === "VALIDATION_ERROR") {
            expect(res.setupNotice?.title).toContain("物理カード重複エラー");
            expect(res.setupNotice?.message).toContain("Player B のシナリオ手札とレアカードで重複があります");
          }
        } finally {
          restore();
        }
      });
    });
  });
});
