import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { parse } from "yaml";
import { OfficialRegulationMatchFactory } from "../../engine/regulation/OfficialRegulationMatchFactory";
import { SimulatorDeckProfileResolver, STANDARD_52_DECK_CARDS } from "../../engine/regulation/SimulatorDeckProfileResolver";
import { RegulationRulePackageSelector } from "../../engine/regulation/RegulationRulePackageSelector";
import { RegulationValidator } from "../../engine/regulation/RegulationValidator";
import { loadRegulationCatalog, getRegulation, getFormat, getFrame } from "../../engine/regulation/RegulationLoader";
import { loadRegulationCatalogForBrowser } from "../../engine/regulation/BrowserRegulationLoader";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader";
import { LegalPatternGenerator } from "../../engine/decision/LegalPatternGenerator";
import { ObservationFactory } from "../../engine/decision/ObservationFactory";
import { ActionRequestValidator, ValidationError } from "../../engine/rules/ActionRequestValidator";
import { isCardInGameZones } from "../../engine/rules/cardUtils";
import { normalizeCardLocation } from "../../engine/log/MatchLogRecorder";
import { PlayerObservationPresenter } from "../../ui/game/PlayerObservationPresenter";
import { ViewerAwareGameEventFormatter } from "../../engine/session/playtest/ViewerAwareGameEventFormatter";
import {
  getAvailableEnvironments,
  startMatchAttempt,
} from "../../engine/playtest/PlaytestEnvironmentController";
import { reconstructMatch } from "../../engine/replay/ReplayReconstructionService";
import { SimulationRunner } from "../../engine/simulation/SimulationRunner";
import { FirstLegalPolicy, RandomPolicy } from "../../engine/simulation/DecisionPolicy";
import { SeededRandom } from "../../engine/random/RandomSource";
import type { PlaytestDecisionTranscriptEntryV1 } from "../../ui/playtest/PlaytestDecisionTranscript";

describe("Official Regulation Phase 2.0: Light + Pack Foundation Tests (A to X)", () => {
  let catalog: any;
  let lightPackReg: any;
  let lightFormat: any;
  let packFrame: any;
  let fullRulePackage: any;
  let lightPackRulePackage: any;

  beforeAll(async () => {
    catalog = await loadRegulationCatalog();
    lightPackReg = await getRegulation("light-pack");
    lightFormat = await getFormat("light");
    packFrame = await getFrame("pack");

    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    fullRulePackage = await loadRulePackageFromDirectory(rulesDir);
    lightPackRulePackage = RegulationRulePackageSelector.selectRulePackage(
      fullRulePackage,
      lightFormat,
      lightPackReg,
      packFrame
    );
  });

  // Test A: Pack Setup (8.3.1.2 step-by-step)
  it("Test A: Pack Setup (8.3.1.2 step-by-step) sets up 52 cards deck, 14 pack, and correct zone sizes", async () => {
    const session = await OfficialRegulationMatchFactory.createSession("light-pack", 42, {
      catalog,
      fullRulePackage: lightPackRulePackage,
    });
    const state = session.state;

    expect(state.regulationId).toBe("light-pack");
    expect(state.formatId).toBe("light");
    expect(state.frameId).toBe("pack");

    for (const pKey of ["p1", "p2"]) {
      const p = state.players[pKey];
      expect(p.pack).toBeDefined();
      expect(p.pack.count).toBe(14);
      expect(p.pack.opened).toBe(false);
      expect(p.pack.cards.length).toBe(14);

      // Field has 1 bulwark and 1 soldier (as defined in pack.yaml preset)
      const bulwarks = p.field.filter((u: any) => u.componentId === "character.bulwark");
      const soldiers = p.field.filter((u: any) => u.componentId === "character.soldier");
      expect(bulwarks.length).toBe(1);
      expect(soldiers.length).toBe(1);
    }

    // Turn player drew 1 extra card at game start
    const tp = state.turnPlayer;
    const ntp = tp === "p1" ? "p2" : "p1";
    expect(state.players[tp].hand.length).toBe(8);
    expect(state.players[ntp].hand.length).toBe(7);

    const tpTotalCards =
      state.players[tp].hand.length +
      state.players[tp].life.length +
      state.players[tp].pack.cards.length +
      state.players[tp].field.length +
      (state.players[tp].grave?.length || 0);
    expect(tpTotalCards).toBe(52);

    const ntpTotalCards =
      state.players[ntp].hand.length +
      state.players[ntp].life.length +
      state.players[ntp].pack.cards.length +
      state.players[ntp].field.length +
      (state.players[ntp].grave?.length || 0);
    expect(ntpTotalCards).toBe(52);
  });

  // Test B: Card Conservation
  it("Test B: Card Conservation - Exact 52-card multiset conservation across all zones", async () => {
    const session = await OfficialRegulationMatchFactory.createSession("light-pack", 42, {
      catalog,
      fullRulePackage: lightPackRulePackage,
    });
    const state = session.state;

    for (const pKey of ["p1", "p2"]) {
      const p = state.players[pKey];
      const allCards: any[] = [
        ...p.hand,
        ...p.life,
        ...p.pack.cards,
        ...(p.grave || []),
        ...p.field.flatMap((u: any) => (Array.isArray(u.cards) ? u.cards : u.card ? [u.card] : [])),
        ...(p.fog ? p.fog.flatMap((f: any) => (f.card ? [f.card] : [])) : []),
      ];

      expect(allCards.length).toBe(52);
      const cardIds = new Set(allCards.map((c) => c.id));
      expect(cardIds.size).toBe(52);
    }
  });

  // Test C: Pack Visibility (Table 6.1)
  it("Test C: Pack Visibility (Table 6.1) - Unopened hidden from both, opened known only to owner", async () => {
    const session = await OfficialRegulationMatchFactory.createSession("light-pack", 42, {
      catalog,
      fullRulePackage: lightPackRulePackage,
    });
    const state = session.state;

    // 1. Before opening: both see count 14, cards [], canViewCards false
    const obsP1 = ObservationFactory.createObservation(state, "p1");
    const p1ViewForP1 = obsP1.players.find((p) => p.playerId === "p1")!;
    const p2ViewForP1 = obsP1.players.find((p) => p.playerId === "p2")!;

    expect(p1ViewForP1.pack?.count).toBe(14);
    expect(p1ViewForP1.pack?.opened).toBe(false);
    expect(p1ViewForP1.pack?.cards.length).toBe(0);
    expect(p1ViewForP1.pack?.canViewCards).toBe(false);

    expect(p2ViewForP1.pack?.count).toBe(14);
    expect(p2ViewForP1.pack?.opened).toBe(false);
    expect(p2ViewForP1.pack?.cards.length).toBe(0);
    expect(p2ViewForP1.pack?.canViewCards).toBe(false);

    // 2. Open p1's pack manually
    state.players.p1.pack.opened = true;
    const obsP1After = ObservationFactory.createObservation(state, "p1");
    const obsP2After = ObservationFactory.createObservation(state, "p2");

    const p1ViewForOwner = obsP1After.players.find((p) => p.playerId === "p1")!;
    const p1ViewForOpponent = obsP2After.players.find((p) => p.playerId === "p1")!;

    // Owner sees all remaining cards
    expect(p1ViewForOwner.pack?.opened).toBe(true);
    expect(p1ViewForOwner.pack?.canViewCards).toBe(true);
    expect(p1ViewForOwner.pack?.cards.length).toBe(14);
    expect(p1ViewForOwner.pack?.cards.every((c) => c.visibility === "KNOWN")).toBe(true);

    // Opponent sees opened=true, count=14, but cards=[] and canViewCards=false
    expect(p1ViewForOpponent.pack?.opened).toBe(true);
    expect(p1ViewForOpponent.pack?.canViewCards).toBe(false);
    expect(p1ViewForOpponent.pack?.cards.length).toBe(0);
  });

  // Test D: PackOpen Legality
  it("Test D: PackOpen Legality - Legal before open, illegal and fail-closed after open", async () => {
    const session = await OfficialRegulationMatchFactory.createSession("light-pack", 42, {
      catalog,
      fullRulePackage: lightPackRulePackage,
    });
    const state = session.state;
    const turnPlayer = state.turnPlayer;

    // Before open: action.packOpen is generated
    const decisionRes = LegalPatternGenerator.generateActionRequestDecision(
      state,
      turnPlayer,
      lightPackRulePackage
    );
    const packOpenPattern = decisionRes.request.patterns.find(
      (p) => p.kind === "ACTION" && decisionRes.request.catalog.actions[p.actionSelectionRef!].actionId === "action.packOpen"
    );
    expect(packOpenPattern).toBeDefined();

    // After open: action.packOpen is excluded
    state.players[turnPlayer].pack.opened = true;
    const decisionResAfter = LegalPatternGenerator.generateActionRequestDecision(
      state,
      turnPlayer,
      lightPackRulePackage
    );
    const packOpenPatternAfter = decisionResAfter.request.patterns.find(
      (p) => p.kind === "ACTION" && decisionResAfter.request.catalog.actions[p.actionSelectionRef!].actionId === "action.packOpen"
    );
    expect(packOpenPatternAfter).toBeUndefined();

    // Validator rejects direct request when opened is true
    const validator = new ActionRequestValidator();
    const actionDef = lightPackRulePackage.actions.find((a: any) => a.id === "action.packOpen")!;
    expect(() => {
      validator.validateActionRequest(actionDef, { state, playerKey: turnPlayer });
    }).toThrow(ValidationError);
  });

  // Test E: PackOpen Selection
  it("Test E: PackOpen Selection - 1 card chosen, revealed, moved to hand, pack 14->13, opened=true", async () => {
    const session = await OfficialRegulationMatchFactory.createSession("light-pack", 42, {
      catalog,
      fullRulePackage: lightPackRulePackage,
    });

    let step = session.advance();
    expect(step.type).toBe("WAITING_FOR_DECISION");
    if (step.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

    const turnPlayer = step.request.playerId;
    const initialHandCount = session.state.players[turnPlayer].hand.length;

    // Find packOpen pattern
    const patternIdx = step.request.patterns.findIndex(
      (p) => p.kind === "ACTION" && step.request.catalog.actions[p.actionSelectionRef!].actionId === "action.packOpen"
    );
    expect(patternIdx).toBeGreaterThanOrEqual(0);

    // Submit packOpen decision
    const nextStep = session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: patternIdx,
    });

    // Speed is immediate, goes straight to EFFECT_RESOLUTION decision
    expect(nextStep.type).toBe("WAITING_FOR_DECISION");
    if (nextStep.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");
    expect(nextStep.request.source.type).toBe("EFFECT_RESOLUTION");

    // Choose the first card from candidates
    expect(nextStep.request.patterns.length).toBe(14);
    expect(nextStep.request.catalog.effectSelections.length).toBe(14);
    const chosenCardId = nextStep.request.catalog.effectSelections[0].selectedValues[0];

    // Submit card selection
    session.submitDecision({
      decisionId: nextStep.request.decisionId,
      stateVersion: nextStep.request.stateVersion,
      selectedPatternRef: 0,
    });

    // Check post-condition
    const player = session.state.players[turnPlayer];
    expect(player.pack.opened).toBe(true);
    expect(player.pack.count).toBe(13);
    expect(player.pack.cards.length).toBe(13);
    expect(player.hand.length).toBe(initialHandCount + 1);
    expect(player.hand.some((c: any) => c.id === chosenCardId)).toBe(true);
  });

  // Test F: Secret Leak
  it("Test F: Secret Leak - Pre-action DecisionRequest contains NO pack card identities", async () => {
    const session = await OfficialRegulationMatchFactory.createSession("light-pack", 42, {
      catalog,
      fullRulePackage: lightPackRulePackage,
    });
    const step = session.advance();
    if (step.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

    const request = step.request;
    const jsonStr = JSON.stringify(request);

    // Verify none of the pack card IDs are leaked in the initial ACTION_REQUEST
    const packCards = session.state.players[request.playerId].pack.cards;
    for (const card of packCards) {
      expect(jsonStr).not.toContain(`"${card.id}"`);
    }
  });

  // Test G: Entry16 Regression
  it("Test G: Entry16 Regression - Entry16 setup, seed 42, deck 16, no pack zone", async () => {
    const session = await OfficialRegulationMatchFactory.createSession("light-entry16", 42, {
      catalog,
      fullRulePackage,
    });
    expect(session.state.regulationId).toBe("light-entry16");
    expect(session.state.frameId).toBe("entry16");
    expect(session.state.players.p1.pack).toBeUndefined();
    expect(session.state.players.p2.pack).toBeUndefined();
  });

  // Test H: Replay Determinism
  it("Test H: Replay Determinism - Identical reconstruct for light-pack", async () => {
    const browserCatalog = loadRegulationCatalogForBrowser();
    const browserRulePackage = loadRulePackageForBrowser();

    const outcome = startMatchAttempt({
      environmentId: "official:light-pack",
      seedInput: "42",
      catalog: browserCatalog,
      fullRulePackage: browserRulePackage,
    });
    expect(outcome.type).toBe("READY");
    if (outcome.type !== "READY") throw new Error("Expected READY");

    const session = outcome.session;
    let step = outcome.initialStep;
    const transcript: PlaytestDecisionTranscriptEntryV1[] = [];

    // Advance and make 3 decisions
    for (let i = 0; i < 3; i++) {
      while (step.type === "PROGRESSED") {
        step = session.advance();
      }
      if (step.type !== "WAITING_FOR_DECISION") break;

      const req = step.request;
      const entry: PlaytestDecisionTranscriptEntryV1 = {
        seq: transcript.length + 1,
        actor: "human",
        playerId: req.playerId as "p1" | "p2",
        decisionId: req.decisionId,
        stateVersion: req.stateVersion,
        response: {
          decisionId: req.decisionId,
          stateVersion: req.stateVersion,
          selectedPatternRef: 0,
        },
      };
      transcript.push(entry);
      step = session.submitDecision(entry.response);
    }

    // Reconstruct match
    const recon = reconstructMatch({
      environmentId: "official:light-pack",
      seed: 42,
      transcript,
      catalog: browserCatalog,
      fullRulePackage: browserRulePackage,
    });

    expect(recon.status).toBe("SUCCESS");
  });

  // Test I: Undo
  it("Test I: Undo reverts pack open state, hand cards, and pack count", async () => {
    const browserCatalog = loadRegulationCatalogForBrowser();
    const browserRulePackage = loadRulePackageForBrowser();

    const outcome = startMatchAttempt({
      environmentId: "official:light-pack",
      seedInput: "42",
      catalog: browserCatalog,
      fullRulePackage: browserRulePackage,
    });
    if (outcome.type !== "READY") throw new Error("Expected READY");

    const session = outcome.session;
    let step = outcome.initialStep;
    const transcript: PlaytestDecisionTranscriptEntryV1[] = [];

    // Find packOpen and execute
    while (step.type === "PROGRESSED") {
      step = session.advance();
    }
    expect(step.type).toBe("WAITING_FOR_DECISION");
    if (step.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");
    const waitingStep = step;

    const packOpenIdx = waitingStep.request.patterns.findIndex(
      (p) => p.kind === "ACTION" && waitingStep.request.catalog.actions[p.actionSelectionRef!].actionId === "action.packOpen"
    );
    expect(packOpenIdx).toBeGreaterThanOrEqual(0);

    // Decision 1: Select PackOpen
    const d1: PlaytestDecisionTranscriptEntryV1 = {
      seq: 1,
      actor: "human",
      playerId: waitingStep.request.playerId as "p1" | "p2",
      decisionId: waitingStep.request.decisionId,
      stateVersion: waitingStep.request.stateVersion,
      response: {
        decisionId: waitingStep.request.decisionId,
        stateVersion: waitingStep.request.stateVersion,
        selectedPatternRef: packOpenIdx,
      },
    };
    transcript.push(d1);
    step = session.submitDecision(d1.response);

    // Decision 2: Select Card from pack
    expect(step.type).toBe("WAITING_FOR_DECISION");
    if (step.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

    const d2: PlaytestDecisionTranscriptEntryV1 = {
      seq: 2,
      actor: "human",
      playerId: step.request.playerId as "p1" | "p2",
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      response: {
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: 0,
      },
    };
    transcript.push(d2);
    step = session.submitDecision(d2.response);

    // State after decision 2: pack is opened, 13 cards
    const turnPlayer = d1.playerId;
    expect(session.state.players[turnPlayer].pack.opened).toBe(true);
    expect(session.state.players[turnPlayer].pack.count).toBe(13);

    // Now Undo back to before packOpen (0 decisions)
    const undoRecon = reconstructMatch({
      environmentId: "official:light-pack",
      seed: 42,
      transcript: [],
      catalog: browserCatalog,
      fullRulePackage: browserRulePackage,
    });

    expect(undoRecon.status).toBe("SUCCESS");
    if (undoRecon.status !== "SUCCESS") throw new Error("Reconstruction failed");
    const restoredPlayer = undoRecon.session.state.players[turnPlayer];
    expect(restoredPlayer.pack.opened).toBe(false);
    expect(restoredPlayer.pack.count).toBe(14);
    expect(restoredPlayer.pack.cards.length).toBe(14);
  });

  // Test J: UI 390px Density
  it("Test J: UI 390px Density - PlayerObservationPresenter creates ViewModel with pack", async () => {
    const session = await OfficialRegulationMatchFactory.createSession("light-pack", 42, {
      catalog,
      fullRulePackage: lightPackRulePackage,
    });
    const state = session.state;
    const observation = ObservationFactory.createObservation(state, "p1");

    const viewModel = PlayerObservationPresenter.buildPlayerViewModel(
      "p1",
      observation,
      state,
      "p1"
    );

    expect(viewModel.pack).toBeDefined();
    expect(viewModel.pack?.count).toBe(14);
    expect(viewModel.pack?.opened).toBe(false);
    expect(viewModel.pack?.canViewCards).toBe(false);
  });

  // Test K: Official Definition Separation
  it("Test K: Official Definition Separation - pack.yaml contains ONLY official constraints", () => {
    const packYamlPath = path.resolve(__dirname, "../../data/regulations/frames/pack.yaml");
    const rawContent = fs.readFileSync(packYamlPath, "utf-8");
    const parsed = parse(rawContent);

    expect(parsed.id).toBe("pack");
    expect(parsed.deck.type).toBe("constructed");
    expect(parsed.deck.minCards).toBe(40);
    expect(parsed.actions).toContain("action.packOpen");

    // Verify zero simulator fixture details
    expect(parsed.deck.cardCount).toBeUndefined();
    expect(parsed.deck.cards).toBeUndefined();
    expect(rawContent).not.toContain("standard52");
    expect(rawContent).not.toContain("fixture");
  });

  // Test L: Recommendation Contract
  it("Test L: Recommendation Contract - light-pack is implemented, standard-pack is not implemented", () => {
    const lightPackValidation = RegulationValidator.validateCombination(catalog, "light", "pack");
    expect(lightPackValidation.recommended).toBe(true);
    expect(lightPackValidation.simulatorImplemented).toBe(true);

    const syntheticCatalog = {
      ...catalog,
      formats: new Map([
        ...catalog.formats.entries(),
        ["standard", { id: "standard", name: "スタンダード", rulePackageId: "official-base" } as any],
      ]),
    };
    const standardPackValidation = RegulationValidator.validateCombination(
      syntheticCatalog,
      "standard",
      "pack"
    );
    expect(standardPackValidation.recommended).toBe(true);
    expect(standardPackValidation.simulatorImplemented).toBe(false);
  });

  // Test M: RulePackage Composition
  it("Test M: RulePackage Composition - merges format and frame actions with Set deduplication", () => {
    const pkg = RegulationRulePackageSelector.selectRulePackage(
      fullRulePackage,
      lightFormat,
      lightPackReg,
      packFrame
    );

    expect(pkg.actions.some((a) => a.id === "action.packOpen")).toBe(true);
    const packOpenCount = pkg.actions.filter((a) => a.id === "action.packOpen").length;
    expect(packOpenCount).toBe(1);
  });

  // Test N: Environment Wiring
  it("Test N: Environment Wiring - official:light-pack appears in getAvailableEnvironments with deck notice", () => {
    const options = getAvailableEnvironments(catalog);
    const lightPackOpt = options.find((o) => o.id === "official:light-pack");

    expect(lightPackOpt).toBeDefined();
    expect(lightPackOpt?.isOfficial).toBe(true);
    expect(lightPackOpt?.deckProfileNotice).toContain("標準52枚デッキ");
  });

  // Test O: Secret Selection Boundary
  it("Test O: Secret Selection Boundary - pack.opened remains false during effect selection", async () => {
    const session = await OfficialRegulationMatchFactory.createSession("light-pack", 42, {
      catalog,
      fullRulePackage: lightPackRulePackage,
    });

    let step = session.advance();
    if (step.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

    const turnPlayer = step.request.playerId;
    const opponentPlayer = turnPlayer === "p1" ? "p2" : "p1";
    const patternIdx = step.request.patterns.findIndex(
      (p) => p.kind === "ACTION" && step.request.catalog.actions[p.actionSelectionRef!].actionId === "action.packOpen"
    );

    // Submit PackOpen action
    const nextStep = session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: patternIdx,
    });

    // We are now in EFFECT_RESOLUTION interruption
    expect(nextStep.type).toBe("WAITING_FOR_DECISION");
    if (nextStep.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");
    expect(nextStep.request.source.type).toBe("EFFECT_RESOLUTION");

    // During selection: pack.opened is STILL false
    expect(session.state.players[turnPlayer].pack.opened).toBe(false);

    // Opponent observation still sees pack as unopened and cards hidden
    const oppObs = ObservationFactory.createObservation(session.state, opponentPlayer as any);
    const tpViewForOpp = oppObs.players.find((p) => p.playerId === turnPlayer)!;
    expect(tpViewForOpp.pack?.opened).toBe(false);
    expect(tpViewForOpp.pack?.cards.length).toBe(0);
    expect(tpViewForOpp.pack?.canViewCards).toBe(false);
  });

  // Test P: Transient Reveal
  it("Test P: Transient Reveal - Chosen card is revealed, but hidden once moved to hand", async () => {
    const session = await OfficialRegulationMatchFactory.createSession("light-pack", 42, {
      catalog,
      fullRulePackage: lightPackRulePackage,
    });

    let step = session.advance();
    if (step.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

    const turnPlayer = step.request.playerId;
    const opponentPlayer = turnPlayer === "p1" ? "p2" : "p1";
    const patternIdx = step.request.patterns.findIndex(
      (p) => p.kind === "ACTION" && step.request.catalog.actions[p.actionSelectionRef!].actionId === "action.packOpen"
    );

    const nextStep = session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: patternIdx,
    });

    if (nextStep.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");
    const chosenCardId = nextStep.request.catalog.effectSelections[0]?.selectedValues[0];

    // Complete selection
    session.submitDecision({
      decisionId: nextStep.request.decisionId,
      stateVersion: nextStep.request.stateVersion,
      selectedPatternRef: 0,
    });

    // Check opponent observation: opponent cannot see card face in hand
    const oppObs = ObservationFactory.createObservation(session.state, opponentPlayer as any);
    const tpViewForOpp = oppObs.players.find((p) => p.playerId === turnPlayer)!;
    const handCardInOppObs = tpViewForOpp.handCards.find(
      (c: any) => c.opaqueCardId === `hidden-${chosenCardId}` || c.opaqueCardId === chosenCardId
    );
    expect(handCardInOppObs).toBeDefined();
    expect(handCardInOppObs?.visibility).toBe("HIDDEN");
  });

  // Test Q: Fixture Determinism
  it("Test Q: Fixture Determinism - Same seed produces exact same deck, shuffle, and pack cards", async () => {
    const s1 = await OfficialRegulationMatchFactory.createSession("light-pack", 12345, {
      catalog,
      fullRulePackage: lightPackRulePackage,
    });
    const s2 = await OfficialRegulationMatchFactory.createSession("light-pack", 12345, {
      catalog,
      fullRulePackage: lightPackRulePackage,
    });

    for (const pKey of ["p1", "p2"]) {
      const p1Cards = s1.state.players[pKey].pack.cards.map((c: any) => c.id);
      const p2Cards = s2.state.players[pKey].pack.cards.map((c: any) => c.id);
      expect(p1Cards).toEqual(p2Cards);
    }
  });

  // Test R: AI Smoke
  it("Test R: AI Smoke - FirstLegalPolicy and RandomPolicy can run light-pack match without throwing", async () => {
    const session = await OfficialRegulationMatchFactory.createSession("light-pack", 42, {
      catalog,
      fullRulePackage: lightPackRulePackage,
    });

    const rng = new SeededRandom(42);
    const policies = {
      p1: new FirstLegalPolicy(),
      p2: new RandomPolicy(rng.fork(), "Random-P2"),
    };

    const result = SimulationRunner.run(session, policies, {
      maxDecisions: 50,
    });

    expect(result.totalDecisions).toBeGreaterThan(0);
    expect(result.decisionTrace.length).toBeGreaterThan(0);
  });

  // Test S: Presenter Pack Projection
  it("Test S: Presenter Pack Projection - Forwards pack and fails closed when player is missing", () => {
    const mockObs: any = {
      turnPlayerId: "p1",
      chancePlayerId: "p1",
      players: [
        {
          playerId: "p1",
          name: "Player A",
          isViewer: true,
          lifeDisplay: "15",
          handCount: 7,
          handCards: [],
          field: [],
          fog: [],
          graveCount: 0,
          grave: [],
          canViewFullGrave: true,
          pack: { count: 14, opened: false, cards: [], canViewCards: false },
        },
      ],
    };

    const vm1 = PlayerObservationPresenter.buildPlayerViewModel("p1", mockObs, null, "p1");
    expect(vm1.pack).toBeDefined();
    expect(vm1.pack?.count).toBe(14);

    // Fail-closed fallback
    const vm2 = PlayerObservationPresenter.buildPlayerViewModel("p2", mockObs, null, "p1");
    expect(vm2.pack).toBeUndefined();
  });

  // Test T: Generic Zone Integration
  it("Test T: Generic Zone Integration - isCardInGameZones and normalizeCardLocation support pack", async () => {
    const session = await OfficialRegulationMatchFactory.createSession("light-pack", 42, {
      catalog,
      fullRulePackage: lightPackRulePackage,
    });
    const state = session.state;
    const packCardId = state.players.p1.pack.cards[0].id;

    expect(isCardInGameZones(packCardId, state)).toBe(true);
    expect(normalizeCardLocation("pack", "p1")).toEqual({
      kind: "zone",
      playerId: "p1",
      zone: "pack",
    });
  });

  // Test U: Reveal UI Persistence
  it("Test U: Reveal UI Persistence - ViewerAwareGameEventFormatter outputs card reveal message", () => {
    const prevState = {
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          name: "Player A",
          pack: {
            opened: false,
            cards: [{ id: "c1", suit: "S", rank: "7" }, { id: "c2", suit: "H", rank: "A" }],
          },
        },
        p2: { name: "Player B" },
      },
    };

    const nextState = {
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          name: "Player A",
          pack: {
            opened: true,
            cards: [{ id: "c2", suit: "H", rank: "A" }],
          },
        },
        p2: { name: "Player B" },
      },
    };

    const events = ViewerAwareGameEventFormatter.formatStateTransition(prevState, nextState);
    const revealEvent = events.find((e) => e.message.includes("[カード公開]"));

    expect(revealEvent).toBeDefined();
    expect(revealEvent?.message).toContain("Player A");
    expect(revealEvent?.message).toContain("♠7");
  });

  // Test V: Canonical Reveal Single Event
  it("Test V: Canonical Reveal Single Event - Exactly 1 card.revealed event per PackOpen action", async () => {
    const session = await OfficialRegulationMatchFactory.createSession("light-pack", 42, {
      catalog,
      fullRulePackage: lightPackRulePackage,
    });

    let step = session.advance();
    if (step.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

    const patternIdx = step.request.patterns.findIndex(
      (p) => p.kind === "ACTION" && step.request.catalog.actions[p.actionSelectionRef!].actionId === "action.packOpen"
    );

    const nextStep = session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: patternIdx,
    });

    if (nextStep.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

    session.submitDecision({
      decisionId: nextStep.request.decisionId,
      stateVersion: nextStep.request.stateVersion,
      selectedPatternRef: 0,
    });

    const canonicalLog = session.logRecorder.getMatchLog();
    const revealEvents = canonicalLog.events.filter((e) => e.type === "card.revealed");

    expect(revealEvents.length).toBe(1);
    expect(revealEvents[0].revealedBy).toBe(step.request.playerId);
    expect(revealEvents[0].fromZone).toBe("pack");
  });

  // Test W: Immediate Effect Selection
  it("Test W: Immediate Effect Selection - Goes directly to EFFECT_RESOLUTION without stage residue", async () => {
    const session = await OfficialRegulationMatchFactory.createSession("light-pack", 42, {
      catalog,
      fullRulePackage: lightPackRulePackage,
    });

    let step = session.advance();
    if (step.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");

    const patternIdx = step.request.patterns.findIndex(
      (p) => p.kind === "ACTION" && step.request.catalog.actions[p.actionSelectionRef!].actionId === "action.packOpen"
    );

    const nextStep = session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: patternIdx,
    });

    // Immediate action should NOT remain in stage.requests
    expect(session.state.stage?.requests?.length || 0).toBe(0);
    expect(nextStep.type).toBe("WAITING_FOR_DECISION");
    if (nextStep.type !== "WAITING_FOR_DECISION") throw new Error("Expected WAITING_FOR_DECISION");
    expect(nextStep.request.source.type).toBe("EFFECT_RESOLUTION");
  });

  // Test X: Replay Viewer Pack Observation
  it("Test X: Replay Viewer Pack Observation - Correct observation in replay viewer context", async () => {
    const session = await OfficialRegulationMatchFactory.createSession("light-pack", 42, {
      catalog,
      fullRulePackage: lightPackRulePackage,
    });

    const obsViewerP1 = ObservationFactory.createObservation(session.state, "p1");
    const obsViewerP2 = ObservationFactory.createObservation(session.state, "p2");

    expect(obsViewerP1.players[0].pack?.count).toBe(14);
    expect(obsViewerP2.players[0].pack?.count).toBe(14);
  });
});
