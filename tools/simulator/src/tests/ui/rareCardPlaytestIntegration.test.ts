import { describe, it, expect, beforeAll } from "vitest";
import {
  getAvailableEnvironments,
  startMatchAttempt,
} from "../../engine/playtest/PlaytestEnvironmentController";
import {
  clearRegulationCache,
} from "../../engine/regulation/RegulationLoader";
import {
  loadRegulationCatalogForBrowser,
  clearBrowserRegulationCache,
} from "../../engine/regulation/BrowserRegulationLoader";
import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader";
import {
  buildPlaytestShareUrl,
  parsePlaytestShareUrl,
} from "../../ui/playtest/PlaytestShareUrl";
import { buildPlaytestDiagnosticBundleV1 } from "../../ui/playtest/PlaytestDiagnosticBundle";
import { createReplayPlanFromDiagnosticBundleV1 } from "../../ui/playtest/DiagnosticReplayAdapter";
import { reconstructMatch } from "../../engine/replay/ReplayReconstructionService";
import { RegulationValidator } from "../../engine/regulation/RegulationValidator";
import { OfficialRegulationMatchFactory } from "../../engine/regulation/OfficialRegulationMatchFactory";
import { SimulatorNotImplementedError } from "../../domain/regulation/RegulationDefinition";

describe("Rare Card Playtest Integration Tests [BP-SIM-REG-5.0-J-RARE-SELECTION]", () => {
  let catalog: any;
  let fullRulePackage: any;

  beforeAll(() => {
    clearRegulationCache();
    clearBrowserRegulationCache();
    catalog = loadRegulationCatalogForBrowser();
    fullRulePackage = loadRulePackageForBrowser();
  });

  describe("Environment Setup Requirements", () => {
    it("reports rareCardCount: 1 for standard:rarePack and 0 for standard:pack / entry16", () => {
      const envs = getAvailableEnvironments(catalog);
      const rarePackEnv = envs.find((e) => e.id === "official:standard-rarePack");
      expect(rarePackEnv).toBeDefined();
      expect(rarePackEnv?.setupRequirements.rareCardCount).toBe(1);

      const standardPackEnv = envs.find((e) => e.id === "official:standard-pack");
      expect(standardPackEnv).toBeDefined();
      expect(standardPackEnv?.setupRequirements.rareCardCount).toBe(0);

      const lightEntryEnv = envs.find((e) => e.id === "official:light-entry16");
      expect(lightEntryEnv).toBeDefined();
      expect(lightEntryEnv?.setupRequirements.rareCardCount).toBe(0);
    });
  });

  describe("startMatchAttempt Validation (Human vs Human)", () => {
    it("fails with VALIDATION_ERROR if rareCardSelections is missing entirely", () => {
      const res = startMatchAttempt({
        environmentId: "official:standard-rarePack",
        matchMode: "humanVsHuman",
        seedInput: "42",
        catalog,
        fullRulePackage,
      });
      expect(res.type).toBe("VALIDATION_ERROR");
      if (res.type === "VALIDATION_ERROR") {
        expect(res.setupNotice?.message).toContain("Player A のレアカードが選択されていません。");
      }
    });

    it("fails with VALIDATION_ERROR if Player 2 selection is missing", () => {
      const res = startMatchAttempt({
        environmentId: "official:standard-rarePack",
        matchMode: "humanVsHuman",
        seedInput: "42",
        rareCardSelections: {
          p1: [{ suit: "S", rank: "A", occurrence: 0 }],
        },
        catalog,
        fullRulePackage,
      });
      expect(res.type).toBe("VALIDATION_ERROR");
      if (res.type === "VALIDATION_ERROR") {
        expect(res.setupNotice?.message).toContain("Player B のレアカードが選択されていません。");
      }
    });

    it("fails with VALIDATION_ERROR if selected card does not exist in deck", () => {
      const res = startMatchAttempt({
        environmentId: "official:standard-rarePack",
        matchMode: "humanVsHuman",
        seedInput: "42",
        rareCardSelections: {
          p1: [{ suit: "S", rank: "A", occurrence: 5 }],
          p2: [{ suit: "H", rank: "K", occurrence: 0 }],
        },
        catalog,
        fullRulePackage,
      });
      expect(res.type).toBe("VALIDATION_ERROR");
      if (res.type === "VALIDATION_ERROR") {
        expect(res.setupNotice?.message).toContain("Player A のレアカード選択が不正です");
      }
    });

    it("succeeds when both P1 and P2 provide valid selections, conserving all 54 cards", () => {
      const res = startMatchAttempt({
        environmentId: "official:standard-rarePack",
        matchMode: "humanVsHuman",
        seedInput: "42",
        rareCardSelections: {
          p1: [{ suit: "S", rank: "A", occurrence: 0 }],
          p2: [{ suit: "H", rank: "K", occurrence: 0 }],
        },
        catalog,
        fullRulePackage,
      });

      expect(res.type).toBe("READY");
      if (res.type === "READY") {
        expect(res.activeMatch.rareCardSelections?.p1).toEqual([
          { suit: "S", rank: "A", occurrence: 0 },
        ]);
        expect(res.activeMatch.rareCardSelections?.p2).toEqual([
          { suit: "H", rank: "K", occurrence: 0 },
        ]);

        const state = res.session.state as any;

        // P1 rare card area contains 1 card: Spade A
        const p1Rare = state.players.p1.rareCards;
        expect(p1Rare).toHaveLength(1);
        expect(p1Rare[0].suit).toBe("S");
        expect(p1Rare[0].rank).toBe("A");

        // P2 rare card area contains 1 card: Heart K
        const p2Rare = state.players.p2.rareCards;
        expect(p2Rare).toHaveLength(1);
        expect(p2Rare[0].suit).toBe("H");
        expect(p2Rare[0].rank).toBe("K");

        // Card conservation for P1: total 54 cards across rareCards, pack, life, hand, field, and grave
        const allP1Cards = [
          ...state.players.p1.rareCards,
          ...state.players.p1.pack.cards,
          ...state.players.p1.life,
          ...state.players.p1.hand,
          ...state.players.p1.field.flatMap((u: any) => u.cards),
          ...state.players.p1.grave,
        ];
        expect(allP1Cards.length).toBe(54);

        // No duplicate Spade A in remaining cards
        const nonRareP1Cards = allP1Cards.filter((c) => c !== p1Rare[0]);
        expect(nonRareP1Cards.some((c) => c.suit === "S" && c.rank === "A")).toBe(false);

        // Card conservation for P2: total 54 cards
        const allP2Cards = [
          ...state.players.p2.rareCards,
          ...state.players.p2.pack.cards,
          ...state.players.p2.life,
          ...state.players.p2.hand,
          ...state.players.p2.field.flatMap((u: any) => u.cards),
          ...state.players.p2.grave,
        ];
        expect(allP2Cards.length).toBe(54);

        const nonRareP2Cards = allP2Cards.filter((c) => c !== p2Rare[0]);
        expect(nonRareP2Cards.some((c) => c.suit === "H" && c.rank === "K")).toBe(false);
      }
    });
  });

  describe("startMatchAttempt Validation (Human vs AI)", () => {
    it("fails with VALIDATION_ERROR if human selection (p1) is missing", () => {
      const res = startMatchAttempt({
        environmentId: "official:standard-rarePack",
        matchMode: "humanVsAi",
        seedInput: "42",
        catalog,
        fullRulePackage,
      });
      expect(res.type).toBe("VALIDATION_ERROR");
      if (res.type === "VALIDATION_ERROR") {
        expect(res.setupNotice?.message).toContain("プレイヤーのレアカードが選択されていません。");
      }
    });

    it("succeeds when p1 provides valid selection; AI (p2) resolves automatically to deterministic default", () => {
      const res = startMatchAttempt({
        environmentId: "official:standard-rarePack",
        matchMode: "humanVsAi",
        seedInput: "123",
        rareCardSelections: {
          p1: [{ suit: "D", rank: "Q", occurrence: 0 }],
        },
        catalog,
        fullRulePackage,
      });

      expect(res.type).toBe("READY");
      if (res.type === "READY") {
        expect(res.activeMatch.rareCardSelections?.p1).toEqual([
          { suit: "D", rank: "Q", occurrence: 0 },
        ]);
        // AI resolves to default (Joker #1)
        expect(res.activeMatch.rareCardSelections?.p2).toEqual([
          { suit: "J", rank: "Joker", occurrence: 0 },
        ]);

        const state = res.session.state as any;
        expect(state.players.p1.rareCards[0].suit).toBe("D");
        expect(state.players.p1.rareCards[0].rank).toBe("Q");
        expect(state.players.p2.rareCards[0].suit).toBe("J");
        expect(state.players.p2.rareCards[0].rank).toBe("Joker");
      }
    });
  });

  describe("startMatchAttempt Backwards-Compatibility (Headless/Automated caller)", () => {
    it("uses default rare card selections when matchMode is omitted and selections are omitted", () => {
      const res = startMatchAttempt({
        environmentId: "official:standard-rarePack",
        seedInput: "999",
        catalog,
        fullRulePackage,
      });

      expect(res.type).toBe("READY");
      if (res.type === "READY") {
        expect(res.activeMatch.rareCardSelections?.p1).toEqual([
          { suit: "J", rank: "Joker", occurrence: 0 },
        ]);
        expect(res.activeMatch.rareCardSelections?.p2).toEqual([
          { suit: "J", rank: "Joker", occurrence: 0 },
        ]);
      }
    });

    it("uses explicit selections when provided even if matchMode is omitted", () => {
      const res = startMatchAttempt({
        environmentId: "official:standard-rarePack",
        seedInput: "999",
        rareCardSelections: {
          p1: [{ suit: "C", rank: "3", occurrence: 0 }],
          p2: [{ suit: "C", rank: "7", occurrence: 0 }],
        },
        catalog,
        fullRulePackage,
      });

      expect(res.type).toBe("READY");
      if (res.type === "READY") {
        expect(res.activeMatch.rareCardSelections?.p1).toEqual([
          { suit: "C", rank: "3", occurrence: 0 },
        ]);
        expect(res.activeMatch.rareCardSelections?.p2).toEqual([
          { suit: "C", rank: "7", occurrence: 0 },
        ]);
      }
    });
  });

  describe("Share URL Round-trip & Warning Verification", () => {
    it("encodes and decodes rareCardSelections via rc1 and rc2 URL params", () => {
      const shareUrl = buildPlaytestShareUrl(
        "https://example.com/playtest",
        {
          environmentId: "official:standard-rarePack",
          mode: "humanVsHuman",
          policyId: "firstLegal",
          seedInput: "777",
          rareCardSelections: {
            p1: [{ suit: "S", rank: "A", occurrence: 0 }],
            p2: [{ suit: "H", rank: "10", occurrence: 0 }],
          },
        },
        catalog
      );

      expect(shareUrl).toContain("rc1=S.A.0");
      expect(shareUrl).toContain("rc2=H.10.0");

      const parsed = parsePlaytestShareUrl(shareUrl, catalog);
      expect(parsed.kind).toBe("READY");
      if (parsed.kind === "READY") {
        expect(parsed.config.rareCardSelections?.p1).toEqual([
          { suit: "S", rank: "A", occurrence: 0 },
        ]);
        expect(parsed.config.rareCardSelections?.p2).toEqual([
          { suit: "H", rank: "10", occurrence: 0 },
        ]);
        // Warning when private information is in URL
        expect(parsed.warnings.some((w) => w.includes("非公開情報"))).toBe(true);
      }
    });

    it("emits warning when sharing rarePack environment without rareCardSelections", () => {
      const shareUrl = buildPlaytestShareUrl(
        "https://example.com/playtest",
        {
          environmentId: "official:standard-rarePack",
          mode: "humanVsAi",
          seedInput: "777",
        },
        catalog
      );

      expect(shareUrl).not.toContain("rc1=");
      expect(shareUrl).not.toContain("rc2=");

      const parsed = parsePlaytestShareUrl(shareUrl, catalog);
      expect(parsed.kind).toBe("READY");
      if (parsed.kind === "READY") {
        expect(parsed.warnings.some((w) => w.includes("レアカードが未選択です"))).toBe(true);
      }
    });
  });

  describe("Diagnostic Bundle & Replay Reconstruction", () => {
    it("embeds rareCardSelections in diagnostic bundle and reconstructs match deterministically", () => {
      const startResult = startMatchAttempt({
        environmentId: "official:standard-rarePack",
        matchMode: "humanVsHuman",
        seedInput: "54321",
        rareCardSelections: {
          p1: [{ suit: "S", rank: "A", occurrence: 0 }],
          p2: [{ suit: "D", rank: "K", occurrence: 0 }],
        },
        catalog,
        fullRulePackage,
      });

      expect(startResult.type).toBe("READY");
      if (startResult.type !== "READY") return;

      const bundle = buildPlaytestDiagnosticBundleV1({
        build: { sha: "local", ref: "refs/heads/local" },
        activeMatch: startResult.activeMatch,
        activePlaytestSettings: {
          matchMode: "humanVsHuman",
          policyId: "firstLegal",
          rareCardSelections: startResult.activeMatch.rareCardSelections,
        },
        rawState: startResult.session.state,
        currentStep: startResult.initialStep,
        decisionTranscript: [],
        generatedAt: new Date().toISOString(),
      });

      // Verify bundle contains rareCardSelections
      expect(bundle.match.rareCardSelections?.p1).toEqual([
        { suit: "S", rank: "A", occurrence: 0 },
      ]);
      expect(bundle.match.rareCardSelections?.p2).toEqual([
        { suit: "D", rank: "K", occurrence: 0 },
      ]);

      // Create ReplayPlan from bundle
      const planResult = createReplayPlanFromDiagnosticBundleV1(bundle, {
        currentBuildSha: "local",
      });
      expect(planResult.type).toBe("READY");
      if (planResult.type !== "READY") return;

      expect(planResult.plan.rareCardSelections).toEqual(bundle.match.rareCardSelections);

      // Reconstruct match with plan
      const reconResult = reconstructMatch({
        environmentId: planResult.plan.environmentId,
        seed: planResult.plan.seed,
        rareCardSelections: planResult.plan.rareCardSelections,
        transcript: planResult.plan.decisions,
        catalog,
        fullRulePackage,
      });

      expect(reconResult.status).toBe("SUCCESS");
      if (reconResult.status === "SUCCESS") {
        const reconState = reconResult.session.state as any;
        expect(reconState.players.p1.rareCards[0].suit).toBe("S");
        expect(reconState.players.p1.rareCards[0].rank).toBe("A");
        expect(reconState.players.p2.rareCards[0].suit).toBe("D");
        expect(reconState.players.p2.rareCards[0].rank).toBe("K");
      }
    });

    it("different rare card selections with same seed produce different initial states", () => {
      const resA = reconstructMatch({
        environmentId: "official:standard-rarePack",
        seed: 888,
        rareCardSelections: {
          p1: [{ suit: "S", rank: "A", occurrence: 0 }],
          p2: [{ suit: "H", rank: "A", occurrence: 0 }],
        },
        transcript: [],
        catalog,
        fullRulePackage,
      });

      const resB = reconstructMatch({
        environmentId: "official:standard-rarePack",
        seed: 888,
        rareCardSelections: {
          p1: [{ suit: "C", rank: "K", occurrence: 0 }],
          p2: [{ suit: "D", rank: "K", occurrence: 0 }],
        },
        transcript: [],
        catalog,
        fullRulePackage,
      });

      expect(resA.status).toBe("SUCCESS");
      expect(resB.status).toBe("SUCCESS");

      if (resA.status === "SUCCESS" && resB.status === "SUCCESS") {
        const stateA = resA.session.state as any;
        const stateB = resB.session.state as any;

        // Rare cards are different
        expect(stateA.players.p1.rareCards[0].suit).toBe("S");
        expect(stateB.players.p1.rareCards[0].suit).toBe("C");

        // The remaining decks also differ because extracted card differed prior to shuffle
        expect(stateA.players.p1.pack.cards[0].id).not.toBe(stateB.players.p1.pack.cards[0].id);
      }
    });
  });

  describe("Publication Guard for Pro + RarePack", () => {
    it("pro:rarePack remains unpublished (simulatorImplemented: false)", () => {
      const val = RegulationValidator.validateRegulation(catalog, "pro-rarePack");
      expect(val.ruleLegal).toBe(true);
      expect(val.recommended).toBe(true);
      expect(val.simulatorImplemented).toBe(false);

      const availableEnvs = getAvailableEnvironments(catalog);
      expect(availableEnvs.some((e) => e.id === "official:pro-rarePack")).toBe(false);
    });

    it("OfficialRegulationMatchFactory rejects pro:rarePack with SimulatorNotImplementedError", async () => {
      await expect(
        OfficialRegulationMatchFactory.createSession("pro-rarePack", 42, {
          catalog,
          fullRulePackage,
        })
      ).rejects.toThrow(SimulatorNotImplementedError);
    });
  });
});
