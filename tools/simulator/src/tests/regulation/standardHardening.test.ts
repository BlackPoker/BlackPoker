import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { loadRegulationCatalog } from "../../engine/regulation/RegulationLoader";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RegulationValidator } from "../../engine/regulation/RegulationValidator";
import { RegulationRulePackageSelector } from "../../engine/regulation/RegulationRulePackageSelector";
import { OfficialRegulationMatchFactory } from "../../engine/regulation/OfficialRegulationMatchFactory";
import { OfficialRegulationMatchSetup, verifyCardConservation } from "../../engine/regulation/OfficialRegulationMatchSetup";
import {
  SimulatorDeckProfileResolver,
  STANDARD_54_DECK_CARDS,
  STANDARD_54_FIXTURE_NOTICE,
  STANDARD_52_FIXTURE_NOTICE,
} from "../../engine/regulation/SimulatorDeckProfileResolver";
import {
  getAvailableEnvironments,
  chooseDefaultPlaytestEnvironment,
  startMatchAttempt,
} from "../../engine/playtest/PlaytestEnvironmentController";
import {
  UnknownFormatError,
  UnknownFrameError,
  UnknownRegulationError,
  RegulationCatalog,
} from "../../domain/regulation/RegulationDefinition";
import { RulePackage } from "../../domain/rules/RulePackage";
import { StateHasher } from "../../engine/simulation/StateHasher";
import { SimulationRunner } from "../../engine/simulation/SimulationRunner";
import { FirstLegalPolicy, RandomPolicy } from "../../engine/simulation/DecisionPolicy";
import { SeededRandom } from "../../engine/random/RandomSource";
import { GenomePolicy } from "../../engine/ai/GenomePolicy";
import { createManualGenericGenomeDNA } from "../../engine/ai/BaselinePolicies";
import { FEATURE_SCHEMA_VERSION } from "../../domain/ai/DecisionFeatureTypes";
import { SNAPSHOT_FORMAT_VERSION } from "../../domain/session/GameSessionSnapshot";
import { GameSessionSnapshotCodec } from "../../engine/session/GameSessionSnapshotCodec";
import { GameSession } from "../../engine/session/GameSession";
import { runDeterministicReplay } from "../../engine/replay/DeterministicReplayRunner";
import { ReplayPlanV1, ReplayDecisionEntryV1 } from "../../engine/replay/ReplayTypes";

describe("Official Regulation Phase 3.0-H - Standard Hardening / Final Acceptance Candidate", () => {
  let catalog: RegulationCatalog;
  let fullRulePackage: RulePackage;

  const EXPECTED_STANDARD_ACTIONS = [
    "action.end",
    "action.charge",
    "action.draw",
    "action.attack",
    "action.block",
    "action.damageJudge",
    "action.nextGeneration",
    "action.setBulwark",
    "action.summonSoldier",
    "action.summonHero",
    "action.summonAce",
    "action.summonMagician",
    "action.mountSoldier",
    "action.up",
    "action.down",
    "action.twist",
    "action.counter",
    "action.destroyBulwark",
    "action.throwing",
    "action.deathLance",
    "action.addBulwark",
    "action.reanimate",
    "action.handeth",
    "action.search",
    "action.unsummons",
  ] as const;

  const EXPECTED_STANDARD_COMPONENTS = [
    "character.soldier",
    "character.hero",
    "character.ace",
    "character.magician",
    "character.armedSoldier",
    "character.bulwark",
    "fog.up",
    "fog.down",
  ] as const;

  const FORBIDDEN_PRO_MASTER_ACTIONS = [
    "quickSummonsAce",
    "kill",
    "reunion",
    "truce",
    "changeTarget",
    "reverse",
    "swordRain",
  ] as const;

  beforeAll(async () => {
    catalog = await loadRegulationCatalog();
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    fullRulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  // =========================================================================
  // Group A: Regulation implemented matrix
  // =========================================================================
  describe("Group A: Regulation Implemented Matrix", () => {
    it("A1: light + entry16 is ruleLegal=true, recommended=true, simulatorImplemented=true", () => {
      const res = RegulationValidator.validateCombination(catalog, "light", "entry16");
      expect(res.ruleLegal).toBe(true);
      expect(res.recommended).toBe(true);
      expect(res.simulatorImplemented).toBe(true);
    });

    it("A2: light + pack is ruleLegal=true, recommended=true, simulatorImplemented=true", () => {
      const res = RegulationValidator.validateCombination(catalog, "light", "pack");
      expect(res.ruleLegal).toBe(true);
      expect(res.recommended).toBe(true);
      expect(res.simulatorImplemented).toBe(true);
    });

    it("A3: standard + pack is ruleLegal=true, recommended=true, simulatorImplemented=true", () => {
      const res = RegulationValidator.validateCombination(catalog, "standard", "pack");
      expect(res.ruleLegal).toBe(true);
      expect(res.recommended).toBe(true);
      expect(res.simulatorImplemented).toBe(true);
    });

    it("A4: standard + entry16 remains ruleLegal=true, recommended=false, simulatorImplemented=false", () => {
      const res = RegulationValidator.validateCombination(catalog, "standard", "entry16");
      expect(res.ruleLegal).toBe(true);
      expect(res.recommended).toBe(false);
      expect(res.simulatorImplemented).toBe(false);
    });

    it("A5: validateRegulation for standard-pack matches exact regulation/format/frame IDs and does not throw on assertImplemented", () => {
      const res = RegulationValidator.validateRegulation(catalog, "standard-pack", { assertImplemented: true });
      expect(res.ruleLegal).toBe(true);
      expect(res.recommended).toBe(true);
      expect(res.simulatorImplemented).toBe(true);
      expect(res.regulation?.id).toBe("standard-pack");
      expect(res.format?.id).toBe("standard");
      expect(res.frame?.id).toBe("pack");
    });

    it("A6: unknown format/frame/regulation throw specific domain errors", () => {
      expect(() => RegulationValidator.validateCombination(catalog, "unknown-fmt", "pack")).toThrow(UnknownFormatError);
      expect(() => RegulationValidator.validateCombination(catalog, "standard", "unknown-frm")).toThrow(UnknownFrameError);
      expect(() => RegulationValidator.validateRegulation(catalog, "unknown-reg")).toThrow(UnknownRegulationError);
    });
  });

  // =========================================================================
  // Group B: Standard 25 canonical actions exact order & IDs
  // =========================================================================
  describe("Group B: Standard 25 Canonical Actions Exact Order & IDs", () => {
    it("B1: standard format has exactly 25 actions in the canonical order", () => {
      const standardFormat = catalog.formats.get("standard")!;
      expect(standardFormat).toBeDefined();
      expect(standardFormat.actions.length).toBe(25);
      expect([...standardFormat.actions]).toEqual([...EXPECTED_STANDARD_ACTIONS]);
    });
  });

  // =========================================================================
  // Group C: Pack composition -> exactly 26 actions
  // =========================================================================
  describe("Group C: Pack Composition -> exactly 26 actions", () => {
    it("C1: standard format does NOT contain action.packOpen", () => {
      const standardFormat = catalog.formats.get("standard")!;
      expect(standardFormat.actions).not.toContain("action.packOpen");
    });

    it("C2: pack frame defines action.packOpen", () => {
      const packFrame = catalog.frames.get("pack")!;
      expect(packFrame).toBeDefined();
      expect(packFrame.actions).toContain("action.packOpen");
    });

    it("C3: composed official-standard-pack RulePackage has exactly 26 actions", () => {
      const standardFormat = catalog.formats.get("standard")!;
      const standardPackReg = catalog.regulations.get("standard-pack")!;
      const packFrame = catalog.frames.get("pack")!;
      const composed = RegulationRulePackageSelector.selectRulePackage(fullRulePackage, standardFormat, standardPackReg, packFrame);

      expect(composed.id).toBe("official-standard-pack");
      expect(composed.actions.length).toBe(26);

      const actionIds = composed.actions.map((a) => a.id);
      for (const act of EXPECTED_STANDARD_ACTIONS) {
        expect(actionIds).toContain(act);
      }
      expect(actionIds).toContain("action.packOpen");
    });
  });

  // =========================================================================
  // Group D: 8 components exact
  // =========================================================================
  describe("Group D: 8 Components Exact", () => {
    it("D1: standard format defines exactly 8 components", () => {
      const standardFormat = catalog.formats.get("standard")!;
      expect(standardFormat.components.length).toBe(8);
      expect([...standardFormat.components].sort()).toEqual([...EXPECTED_STANDARD_COMPONENTS].sort());
    });

    it("D2: composed RulePackage defines exactly 8 components", () => {
      const standardFormat = catalog.formats.get("standard")!;
      const standardPackReg = catalog.regulations.get("standard-pack")!;
      const packFrame = catalog.frames.get("pack")!;
      const composed = RegulationRulePackageSelector.selectRulePackage(fullRulePackage, standardFormat, standardPackReg, packFrame);

      expect(composed.components.length).toBe(8);
      const compIds = composed.components.map((c) => c.id).sort();
      expect(compIds).toEqual([...EXPECTED_STANDARD_COMPONENTS].sort());
    });
  });

  // =========================================================================
  // Group E & F: All action and component definitions exist exactly once
  // =========================================================================
  describe("Group E & F: Action and Component Definition Completeness & Uniqueness", () => {
    it("E1: all 26 actions exist exactly once in fullRulePackage and in composedRulePackage without duplicates", () => {
      const standardFormat = catalog.formats.get("standard")!;
      const standardPackReg = catalog.regulations.get("standard-pack")!;
      const packFrame = catalog.frames.get("pack")!;
      const composed = RegulationRulePackageSelector.selectRulePackage(fullRulePackage, standardFormat, standardPackReg, packFrame);

      const expectedAll26 = [...EXPECTED_STANDARD_ACTIONS, "action.packOpen"];

      for (const actionId of expectedAll26) {
        const inFull = fullRulePackage.actions.filter((a) => a.id === actionId);
        expect(inFull.length).toBe(1);

        const inComposed = composed.actions.filter((a) => a.id === actionId);
        expect(inComposed.length).toBe(1);
      }

      // 重複なし
      const composedIds = composed.actions.map((a) => a.id);
      expect(new Set(composedIds).size).toBe(26);
    });

    it("F1: all 8 components exist exactly once in fullRulePackage and in composedRulePackage without duplicates", () => {
      const standardFormat = catalog.formats.get("standard")!;
      const standardPackReg = catalog.regulations.get("standard-pack")!;
      const packFrame = catalog.frames.get("pack")!;
      const composed = RegulationRulePackageSelector.selectRulePackage(fullRulePackage, standardFormat, standardPackReg, packFrame);

      for (const compId of EXPECTED_STANDARD_COMPONENTS) {
        const inFull = fullRulePackage.components.filter((c) => c.id === compId);
        expect(inFull.length).toBe(1);

        const inComposed = composed.components.filter((c) => c.id === compId);
        expect(inComposed.length).toBe(1);
      }

      // 重複なし
      const composedCompIds = composed.components.map((c) => c.id);
      expect(new Set(composedCompIds).size).toBe(8);
    });
  });

  // =========================================================================
  // Group G: No Pro/Master action leak
  // =========================================================================
  describe("Group G: No Pro/Master Action Leak", () => {
    it("G1: composed RulePackage does not contain any Pro or Master exclusive actions", () => {
      const standardFormat = catalog.formats.get("standard")!;
      const standardPackReg = catalog.regulations.get("standard-pack")!;
      const packFrame = catalog.frames.get("pack")!;
      const composed = RegulationRulePackageSelector.selectRulePackage(fullRulePackage, standardFormat, standardPackReg, packFrame);

      for (const action of composed.actions) {
        for (const forbidden of FORBIDDEN_PRO_MASTER_ACTIONS) {
          expect(action.id.toLowerCase()).not.toContain(forbidden.toLowerCase());
        }
      }
    });
  });

  // =========================================================================
  // Group H: 53 fixture profile, 1 Joker, notice, simulator fixture declaration
  // =========================================================================
  describe("Group H: 54-Card Deck Fixture Profile & Notice", () => {
    it("H1: resolves to standard54 profile with 54 cards, exactly 2 Jokers, and correct notice", () => {
      const packFrame = catalog.frames.get("pack")!;
      const profile = SimulatorDeckProfileResolver.resolveDeckProfile(packFrame, "standard-pack");

      expect(profile.id).toBe("standard54");
      expect(profile.cardCount).toBe(54);
      expect(profile.cards.length).toBe(54);
      expect(profile.notice).toBe(STANDARD_54_FIXTURE_NOTICE);

      const jokers = profile.cards.filter((c) => c.rank === "Joker");
      expect(jokers.length).toBe(2);
      expect(jokers[0]).toEqual({ suit: "J", rank: "Joker", value: 0 });
      expect(jokers[1]).toEqual({ suit: "J", rank: "Joker", value: 0 });

      const nonJokers = profile.cards.filter((c) => c.rank !== "Joker");
      expect(nonJokers.length).toBe(52);
    });

    it("H2: standard54 fixture is declared as a Simulator deterministic fixture, not an official deck limitation", () => {
      // Notice 文言が Simulator 固有の Fixture である旨を明示していること
      expect(STANDARD_54_FIXTURE_NOTICE).toContain("現在のSimulatorでは54枚デッキFixture");
      expect(STANDARD_54_FIXTURE_NOTICE).not.toContain("公式ルールではJokerは1枚まで");
    });
  });

  // =========================================================================
  // Group I: Factory createSession READY
  // =========================================================================
  describe("Group I: OfficialRegulationMatchFactory createSession", () => {
    it("I1: createSession creates a READY GameSession with official-standard-pack package and correct regulation IDs", async () => {
      const session = await OfficialRegulationMatchFactory.createSession("standard-pack", 42, {
        catalog,
        fullRulePackage,
      });

      expect(session).toBeDefined();
      expect(session.state.regulationId).toBe("standard-pack");
      expect(session.state.formatId).toBe("standard");
      expect(session.state.frameId).toBe("pack");
      expect(session.rulePackage.id).toBe("official-standard-pack");
      expect(session.rulePackage.actions.length).toBe(26);
      expect(session.rulePackage.components.length).toBe(8);
      expect(session.state.turnCount).toBe(1);
      expect(session.state.turnPlayer).toBeDefined();
    });
  });

  // =========================================================================
  // Group J: startMatchAttempt READY
  // =========================================================================
  describe("Group J: PlaytestEnvironmentController startMatchAttempt", () => {
    it("J1: startMatchAttempt successfully starts official:standard-pack environment with READY status", () => {
      const outcome = startMatchAttempt({
        environmentId: "official:standard-pack",
        seedInput: "42",
        catalog,
        fullRulePackage,
      });

      expect(outcome.type).toBe("READY");
      if (outcome.type !== "READY") return;

      expect(outcome.activeMatch.regulationId).toBe("standard-pack");
      expect(outcome.activeMatch.environmentId).toBe("official:standard-pack");
      expect(outcome.initialStep.type).toBe("WAITING_FOR_DECISION");
    });
  });

  // =========================================================================
  // Group K: getAvailableEnvironments includes Standard with notice & Default Env contract
  // =========================================================================
  describe("Group K: Environment Exposure & Default Environment Contract", () => {
    it("K1: getAvailableEnvironments dynamically includes official:standard-pack with correct name and notice", () => {
      const envs = getAvailableEnvironments(catalog);
      const stdPack = envs.find((e) => e.id === "official:standard-pack");

      expect(stdPack).toBeDefined();
      expect(stdPack?.name).toBe("スタンダード + パック (公式)");
      expect(stdPack?.isOfficial).toBe(true);
      expect(stdPack?.regulationId).toBe("standard-pack");
      expect(stdPack?.deckProfileNotice).toBe(STANDARD_54_FIXTURE_NOTICE);
    });

    it("K2: chooseDefaultPlaytestEnvironment preserves the default contract (first official environment)", () => {
      const envs = getAvailableEnvironments(catalog);
      const defaultEnv = chooseDefaultPlaytestEnvironment(envs);

      // 既存の契約通り、先頭の公式環境 (light-entry16) が選択され、Standard へ勝手に変更されないこと
      expect(defaultEnv).toBe("official:light-entry16");
    });
  });

  // =========================================================================
  // Group L: Setup deterministic same seed
  // =========================================================================
  describe("Group L: Same-Seed Setup Determinism", () => {
    it("L1: creating session twice with the same seed yields identical initial StateHash and turnPlayer", async () => {
      const session1 = await OfficialRegulationMatchFactory.createSession("standard-pack", 42, {
        catalog,
        fullRulePackage,
      });
      const session2 = await OfficialRegulationMatchFactory.createSession("standard-pack", 42, {
        catalog,
        fullRulePackage,
      });

      const hash1 = StateHasher.hash(session1.state);
      const hash2 = StateHasher.hash(session2.state);

      expect(hash1).toBe(hash2);
      expect(session1.state.turnPlayer).toBe(session2.state.turnPlayer);
    });
  });

  // =========================================================================
  // Group M: Multi-seed setup & card conservation
  // =========================================================================
  describe("Group M: Multi-Seed Setup & 53-Card Conservation", () => {
    const TEST_SEEDS = [0, 1, 2, 42, 100, 999, 20260918];

    for (const seed of TEST_SEEDS) {
      it(`M: Seed ${seed} produces READY, exact 53-card conservation, and unique card IDs`, async () => {
        const packFrame = catalog.frames.get("pack")!;
        const stdPackReg = catalog.regulations.get("standard-pack")!;
        const standardFormat = catalog.formats.get("standard")!;
        const composedPackage = RegulationRulePackageSelector.selectRulePackage(fullRulePackage, standardFormat, stdPackReg);

        const outcome = OfficialRegulationMatchSetup.setupMatch(stdPackReg, packFrame, composedPackage, seed);
        expect(outcome.type).toBe("READY");
        if (outcome.type !== "READY") return;

        const p1 = outcome.state.players.p1;
        const p2 = outcome.state.players.p2;

        // Verify card conservation SSOT
        verifyCardConservation("p1", p1, STANDARD_54_DECK_CARDS);
        verifyCardConservation("p2", p2, STANDARD_54_DECK_CARDS);

        // Specific area counts
        expect(p1.pack.cards.length).toBe(14);
        expect(p2.pack.cards.length).toBe(14);
        expect(p1.field.length).toBe(2); // bulwark + soldier
        expect(p2.field.length).toBe(2);

        // Bulwark: 1 card, Soldier: 1 card
        expect(p1.field[0].cards.length).toBe(1);
        expect(p1.field[1].cards.length).toBe(1);
        expect(p2.field[0].cards.length).toBe(1);
        expect(p2.field[1].cards.length).toBe(1);

        // 公式ルール 3.9.3: 先攻はゲーム開始時にライフから1枚ドローするため8枚、後攻は7枚
        const firstPlayer = outcome.firstPlayer;
        const secondPlayer = firstPlayer === "p1" ? "p2" : "p1";
        expect(outcome.state.players[firstPlayer].hand.length).toBe(8);
        expect(outcome.state.players[secondPlayer].hand.length).toBe(7);
        expect(p1.hand.length + p2.hand.length).toBe(15);

        // 先攻: 54 - 14(pack) - 8(hand) - 2(field) = 30 (life + grave)
        // 後攻: 54 - 14(pack) - 7(hand) - 2(field) = 31 (life + grave)
        expect(outcome.state.players[firstPlayer].life.length + outcome.state.players[firstPlayer].grave.length).toBe(30);
        expect(outcome.state.players[secondPlayer].life.length + outcome.state.players[secondPlayer].grave.length).toBe(31);

        // ID uniqueness and distinct player prefixes
        const p1Ids: string[] = [
          ...p1.pack.cards.map((c: any) => c.id),
          ...p1.hand.map((c: any) => c.id),
          ...p1.field.flatMap((u: any) => u.cards.map((c: any) => c.id)),
          ...p1.life.map((c: any) => c.id),
          ...p1.grave.flatMap((e: any) => e.cards.map((c: any) => c.id)),
        ];
        expect(p1Ids.length).toBe(54);
        expect(new Set(p1Ids).size).toBe(54);
        p1Ids.forEach((id) => expect(id.startsWith("p1-c-")).toBe(true));

        const p2Ids: string[] = [
          ...p2.pack.cards.map((c: any) => c.id),
          ...p2.hand.map((c: any) => c.id),
          ...p2.field.flatMap((u: any) => u.cards.map((c: any) => c.id)),
          ...p2.life.map((c: any) => c.id),
          ...p2.grave.flatMap((e: any) => e.cards.map((c: any) => c.id)),
        ];
        expect(p2Ids.length).toBe(54);
        expect(new Set(p2Ids).size).toBe(54);
        p2Ids.forEach((id) => expect(id.startsWith("p2-c-")).toBe(true));

        // P1 and P2 IDs are disjoint
        for (const id of p1Ids) {
          expect(p2Ids).not.toContain(id);
        }

        // Exactly 2 Jokers per player
        expect(p1Ids.filter((id) => id.includes("Joker")).length).toBe(2);
        expect(p2Ids.filter((id) => id.includes("Joker")).length).toBe(2);
      });
    }
  });

  // =========================================================================
  // Group N: Setup Grave TOP invariant
  // =========================================================================
  describe("Group N: Setup Grave TOP Invariant", () => {
    it("N1: when preset soldier search triggers discards, graveTopCardId matches the physical top grave card", async () => {
      const packFrame = catalog.frames.get("pack")!;
      const stdPackReg = catalog.regulations.get("standard-pack")!;
      const standardFormat = catalog.formats.get("standard")!;
      const composedPackage = RegulationRulePackageSelector.selectRulePackage(fullRulePackage, standardFormat, stdPackReg);

      let foundDiscardCase = false;

      for (const seed of [0, 1, 2, 42, 100, 999, 20260918]) {
        const outcome = OfficialRegulationMatchSetup.setupMatch(stdPackReg, packFrame, composedPackage, seed);
        if (outcome.type !== "READY") continue;

        for (const playerKey of ["p1", "p2"] as const) {
          const player = outcome.state.players[playerKey];
          if (player.grave.length > 0) {
            foundDiscardCase = true;
            const topGraveEntry = player.grave[player.grave.length - 1];
            expect(player.graveTopCardId).toBeDefined();
            expect(player.graveTopCardId).toBe(topGraveEntry.id);
          } else {
            expect(player.graveTopCardId).toBeUndefined();
          }
        }
      }

      // 複数シード検証で少なくとも1件はプリセット破棄が発生することを確認
      expect(foundDiscardCase).toBe(true);
    });
  });

  // =========================================================================
  // Group O: AI legal decision smoke
  // =========================================================================
  describe("Group O: AI Legal Decision Smoke", () => {
    it("O1: FirstLegalPolicy, RandomPolicy, and GenomePolicy generate legal responses in standard-pack", async () => {
      const session = await OfficialRegulationMatchFactory.createSession("standard-pack", 42, {
        catalog,
        fullRulePackage,
      });

      const step = session.advance();
      expect(step.type).toBe("WAITING_FOR_DECISION");
      if (step.type !== "WAITING_FOR_DECISION") return;

      const req = step.request;
      expect(req.patterns.length).toBeGreaterThan(0);

      // 1. FirstLegalPolicy
      const firstLegal = new FirstLegalPolicy();
      const respFL = firstLegal.choose(req);
      expect(respFL.decisionId).toBe(req.decisionId);
      expect(respFL.selectedPatternRef).toBeGreaterThanOrEqual(0);
      expect(respFL.selectedPatternRef).toBeLessThan(req.patterns.length);

      // 2. RandomPolicy
      const randomPolicy = new RandomPolicy(42);
      const respRnd = randomPolicy.choose(req);
      expect(respRnd.decisionId).toBe(req.decisionId);
      expect(respRnd.selectedPatternRef).toBeGreaterThanOrEqual(0);
      expect(respRnd.selectedPatternRef).toBeLessThan(req.patterns.length);

      // 3. GenomePolicy (DNA 1482 weights & FEATURE_SCHEMA_VERSION = 1)
      expect(FEATURE_SCHEMA_VERSION).toBe(1);
      const dna = createManualGenericGenomeDNA();
      expect(dna.patternWeights.length + dna.contextPatternWeights.length).toBe(1482);

      const genomePolicy = new GenomePolicy(dna, "TestGenomePolicy");
      const respGen = genomePolicy.choose(req);
      expect(respGen.decisionId).toBe(req.decisionId);
      expect(respGen.selectedPatternRef).toBeGreaterThanOrEqual(0);
      expect(respGen.selectedPatternRef).toBeLessThan(req.patterns.length);
    });
  });

  // =========================================================================
  // Group P: Snapshot / Restore determinism in Standard environment
  // =========================================================================
  describe("Group P: Snapshot / Restore Determinism", () => {
    it("P1: Pre-game and in-game snapshots serialize and restore with identical StateHash", async () => {
      expect(SNAPSHOT_FORMAT_VERSION).toBe(1);

      const session = await OfficialRegulationMatchFactory.createSession("standard-pack", 42, {
        catalog,
        fullRulePackage,
      });

      // 1. Pre-game snapshot
      const preHash = StateHasher.hash(session.state);
      const preSnapshot = session.createSnapshot();
      expect(preSnapshot.snapshotFormatVersion).toBe(SNAPSHOT_FORMAT_VERSION);

      const preJson = GameSessionSnapshotCodec.serialize(preSnapshot);
      const deserializedPre = GameSessionSnapshotCodec.deserialize(preJson);
      const restoredPreSession = GameSession.fromSnapshot(deserializedPre, session.rulePackage);
      const restoredPreHash = StateHasher.hash(restoredPreSession.state);
      expect(restoredPreHash).toBe(preHash);

      // 2. In-game snapshot (make 2 decisions)
      let step = session.advance();
      if (step.type === "WAITING_FOR_DECISION") {
        step = session.submitDecision({
          decisionId: step.request.decisionId,
          stateVersion: step.request.stateVersion,
          selectedPatternRef: 0,
        });
      }
      while (step.type === "PROGRESSED") {
        step = session.advance();
      }
      if (step.type === "WAITING_FOR_DECISION") {
        step = session.submitDecision({
          decisionId: step.request.decisionId,
          stateVersion: step.request.stateVersion,
          selectedPatternRef: 0,
        });
      }
      while (step.type === "PROGRESSED") {
        step = session.advance();
      }

      const midHash = StateHasher.hash(session.state);
      const midSnapshot = session.createSnapshot();
      const midJson = GameSessionSnapshotCodec.serialize(midSnapshot);
      const deserializedMid = GameSessionSnapshotCodec.deserialize(midJson);
      const restoredMidSession = GameSession.fromSnapshot(deserializedMid, session.rulePackage);
      const restoredMidHash = StateHasher.hash(restoredMidSession.state);
      expect(restoredMidHash).toBe(midHash);
    });
  });

  // =========================================================================
  // Group Q: Official Standard deterministic fresh replay
  // =========================================================================
  describe("Group Q: Official Standard Deterministic Replay", () => {
    it("Q1: reconstructMatch / runDeterministicReplay verifies deterministic execution from ordered transcript", async () => {
      const outcome = startMatchAttempt({
        environmentId: "official:standard-pack",
        seedInput: "42",
        catalog,
        fullRulePackage,
      });
      expect(outcome.type).toBe("READY");
      if (outcome.type !== "READY") return;

      const session = outcome.session;
      let step = outcome.initialStep;
      const decisions: ReplayDecisionEntryV1[] = [];

      for (let i = 0; i < 4; i++) {
        while (step.type === "PROGRESSED") {
          step = session.advance();
        }
        if (step.type !== "WAITING_FOR_DECISION") break;

        const req = step.request;
        decisions.push({
          seq: decisions.length + 1,
          actor: "policy",
          playerId: req.playerId as "p1" | "p2",
          response: {
            decisionId: req.decisionId,
            stateVersion: req.stateVersion,
            selectedPatternRef: 0,
          },
        });

        step = session.submitDecision({
          decisionId: req.decisionId,
          stateVersion: req.stateVersion,
          selectedPatternRef: 0,
        });
      }

      while (step.type === "PROGRESSED") {
        step = session.advance();
      }

      const plan: ReplayPlanV1 = {
        environmentId: "official:standard-pack",
        seed: outcome.activeMatch.seed,
        sourceBuild: { sha: "local" },
        sourceRulePackage: { id: outcome.activeMatch.rulePackage.id, version: outcome.activeMatch.rulePackage.version },
        decisions,
        expected: {
          status: step.type as any,
          rawState: JSON.parse(JSON.stringify(session.state)),
        },
      };

      const replayResult = runDeterministicReplay(plan, { catalog, fullRulePackage });
      expect(replayResult.status).toBe("VERIFIED");
    });
  });

  // =========================================================================
  // Group R: Full-match E2E to FINISHED
  // =========================================================================
  describe("Group R: Standard Full-Match E2E to FINISHED", () => {
    it("R1: drives an official:standard-pack match to natural FINISHED without synthetic finish under step cap", async () => {
      const session = await OfficialRegulationMatchFactory.createSession("standard-pack", 42, {
        catalog,
        fullRulePackage,
      });

      const policyRng = new SeededRandom(42 ^ 0x5a5a5a5a);
      const policies = {
        p1: new RandomPolicy(policyRng.fork(), "RandomAI-P1"),
        p2: new RandomPolicy(policyRng.fork(), "RandomAI-P2"),
      };

      const STEP_CAP = 1000;
      const result = SimulationRunner.run(session, policies, {
        maxDecisions: STEP_CAP,
      });

      // 自然終了（ライフ0）かつステップ上限未満で完了すること
      expect(result.completed).toBe(true);
      expect(result.totalDecisions).toBeLessThan(STEP_CAP);
      expect(result.totalDecisions).toBe(171); // 54枚デッキ (Joker 2枚) での決定論的検証
      expect(result.turnCount).toBe(9);
      expect(result.winner).toBe("p1");
      expect(result.reason).toContain("ライフが0になりました");
      expect(session.state.players.p2.life.length).toBe(0);
    });
  });

  // =========================================================================
  // Group S: Light environment regression verification
  // =========================================================================
  describe("Group S: Light Environment Regression Verification", () => {
    it("S1: light-entry16 and light-pack sessions start normally without regression", async () => {
      const entry16Outcome = startMatchAttempt({
        environmentId: "official:light-entry16",
        seedInput: "42",
        catalog,
        fullRulePackage,
      });
      expect(entry16Outcome.type).toBe("READY");

      const packOutcome = startMatchAttempt({
        environmentId: "official:light-pack",
        seedInput: "42",
        catalog,
        fullRulePackage,
      });
      expect(packOutcome.type).toBe("READY");
    });
  });
});
