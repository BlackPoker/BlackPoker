import { describe, it, expect, beforeAll } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import {
  loadRegulationCatalog,
  getRegulation,
  getFrame,
  clearRegulationCache,
} from "../../engine/regulation/RegulationLoader";
import { OfficialRegulationMatchSetup } from "../../engine/regulation/OfficialRegulationMatchSetup";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { ObservationFactory } from "../../engine/decision/ObservationFactory";
import { PlayerObservationPresenter } from "../../ui/game/PlayerObservationPresenter";
import { PlayerBoard } from "../../ui/game/PlayerBoard";
import path from "path";

describe("Rare Card Observation & UI Presentation Contracts (BP-SIM-REG-4.0-A)", () => {
  let catalog: any;
  let fullRulePackage: any;
  let setupState: any;

  beforeAll(async () => {
    clearRegulationCache();
    catalog = await loadRegulationCatalog();
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    fullRulePackage = await loadRulePackageFromDirectory(rulesDir);

    const reg = await getRegulation("standard-rarePack");
    const frame = await getFrame("rarePack");
    const outcome = OfficialRegulationMatchSetup.setupMatch(reg, frame, fullRulePackage, 42);
    expect(outcome.type).toBe("READY");
    if (outcome.type === "READY") {
      setupState = outcome.state;
    }
  });

  // R: Own Observation contract
  it("R: Own Observation includes exact rareCount and KNOWN rare cards", () => {
    const obsP1 = ObservationFactory.createObservation(setupState, "p1");
    const p1View = obsP1.players.find((p) => p.playerId === "p1");

    expect(p1View).toBeDefined();
    expect(p1View?.rareCards).toBeDefined();
    expect(p1View?.rareCards?.count).toBe(1);
    expect(p1View?.rareCards?.canViewCards).toBe(true);
    expect(p1View?.rareCards?.cards.length).toBe(1);

    const rareCard = p1View?.rareCards?.cards[0];
    expect(rareCard?.visibility).toBe("KNOWN");
    if (rareCard?.visibility === "KNOWN") {
      expect(rareCard.suit).toBe("J");
      expect(rareCard.rank).toBe("Joker");
      expect(rareCard.faceUp).toBe(true);
      expect(rareCard.cardInstanceId).toBe("p1-c-JJoker");
    }
  });

  // S & T: Opponent Observation secrecy contract
  it("S & T: Opponent Observation shows rareCount but strictly hides all card content and identities", () => {
    // P2 looks at P1
    const obsP2 = ObservationFactory.createObservation(setupState, "p2");
    const p1ViewFromP2 = obsP2.players.find((p) => p.playerId === "p1");

    expect(p1ViewFromP2).toBeDefined();
    expect(p1ViewFromP2?.rareCards).toBeDefined();
    expect(p1ViewFromP2?.rareCards?.count).toBe(1);
    expect(p1ViewFromP2?.rareCards?.canViewCards).toBe(false);
    expect(p1ViewFromP2?.rareCards?.cards).toEqual([]);

    // Serialize opponent's view of P1 to JSON to guarantee no card leakage
    const serializedP1View = JSON.stringify(p1ViewFromP2?.rareCards);
    expect(serializedP1View).not.toContain("p1-c-JJoker");
    expect(serializedP1View).not.toContain("Joker");
    expect(serializedP1View).not.toContain("suit");
    expect(serializedP1View).not.toContain("rank");
    expect(serializedP1View).not.toContain("value");
    expect(serializedP1View).toBe('{"count":1,"cards":[],"canViewCards":false}');
  });

  // PlayerObservationPresenter ViewModel mapping
  it("Presenter maps rareCount, rareCards, and canViewRareCards accurately", () => {
    const obsP1 = ObservationFactory.createObservation(setupState, "p1");

    const p1Model = PlayerObservationPresenter.buildPlayerViewModel("p1", obsP1, setupState, "p1");
    expect(p1Model.rareCount).toBe(1);
    expect(p1Model.canViewRareCards).toBe(true);
    expect(p1Model.rareCards?.length).toBe(1);

    const p2ModelFromP1 = PlayerObservationPresenter.buildPlayerViewModel("p2", obsP1, setupState, "p1");
    expect(p2ModelFromP1.rareCount).toBe(1);
    expect(p2ModelFromP1.canViewRareCards).toBe(false);
    expect(p2ModelFromP1.rareCards?.length).toBe(0);
  });

  // UI Rendering: Own RARE 1 + ★J vs Opponent RARE 1
  it("UI: Own PlayerBoard displays RARE 1 and ★J badge, Opponent displays RARE 1 without card identity", () => {
    const obsP1 = ObservationFactory.createObservation(setupState, "p1");
    const p1Model = PlayerObservationPresenter.buildPlayerViewModel("p1", obsP1, setupState, "p1");
    const p2Model = PlayerObservationPresenter.buildPlayerViewModel("p2", obsP1, setupState, "p1");

    // Own PlayerBoard
    const ownHtml = renderToString(
      React.createElement(PlayerBoard, {
        playerKey: "p1",
        viewModel: p1Model,
        position: "bottom",
        allPlayersFog: [],
      })
    );

    expect(ownHtml).toContain("RARE");
    expect(ownHtml).toContain(">1<");
    expect(ownHtml).toContain("★");
    expect(ownHtml).toContain("J");

    // Opponent PlayerBoard
    const opponentHtml = renderToString(
      React.createElement(PlayerBoard, {
        playerKey: "p2",
        viewModel: p2Model,
        position: "top",
        allPlayersFog: [],
      })
    );

    expect(opponentHtml).toContain("RARE");
    expect(opponentHtml).toContain(">1<");
    // Opponent zone strip must NOT contain card identity
    // Look specifically at the RARE item in opponent HTML
    expect(opponentHtml).not.toMatch(/RARE[^<]*<[^>]*>[^<]*<[^>]*>★/);
    expect(opponentHtml).not.toContain("Joker");
  });

  // UI Rendering: Non-rare frame has no RARE badge
  it("UI: Non-rare frame (standard-pack) has no RARE badge", async () => {
    const stdPackReg = await getRegulation("standard-pack");
    const packFrame = await getFrame("pack");
    const packOutcome = OfficialRegulationMatchSetup.setupMatch(stdPackReg, packFrame, fullRulePackage, 42);
    expect(packOutcome.type).toBe("READY");

    if (packOutcome.type === "READY") {
      const packObs = ObservationFactory.createObservation(packOutcome.state, "p1");
      const packModel = PlayerObservationPresenter.buildPlayerViewModel("p1", packObs, packOutcome.state, "p1");

      const html = renderToString(
        React.createElement(PlayerBoard, {
          playerKey: "p1",
          viewModel: packModel,
          position: "bottom",
          allPlayersFog: [],
        })
      );

      expect(html).not.toContain("RARE");
      expect(html).toContain("PACK");
    }
  });
});
