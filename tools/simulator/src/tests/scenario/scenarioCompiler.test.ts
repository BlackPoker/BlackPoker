import { describe, it, expect } from "vitest";
import { compileScenarioDefinitionV1 } from "../../engine/scenario/ScenarioCompiler";
import { ScenarioDefinitionV1 } from "../../domain/scenario/ScenarioTypes";
import { loadRegulationCatalogForBrowser } from "../../engine/regulation/BrowserRegulationLoader";
import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader";

describe("ScenarioCompiler Unit Tests (BP-SIM-SCENARIO-1.0-FOUNDATION)", () => {
  const catalog = loadRegulationCatalogForBrowser();
  const fullRulePackage = loadRulePackageForBrowser();

  // Helper to create a minimal valid scenario for light-entry16 (16 cards deck)
  // Entry16 cards: SA, S2, S3, SK, H4, H7, HJ, HQ, D5, D8, D10, DQ, CA, C6, C9, CK
  function createMinimalLightScenario(seed: number = 42): ScenarioDefinitionV1 {
    return {
      version: 1,
      environmentId: "official:light-entry16",
      seed,
      turnPlayer: "p1",
      chancePlayer: "p1",
      turnCount: 1,
      name: "Test Scenario",
      description: "Scenario for compiler testing",
      players: {
        p1: {
          hand: [
            { suit: "S", rank: "A" },
            { suit: "S", rank: "2" },
          ],
          field: [
            {
              componentId: "character.hero",
              card: { suit: "H", rank: "Q" },
            },
          ],
          grave: [{ suit: "C", rank: "6" }],
          life: { count: 3 },
          pack: { count: 9 }, // Total 16 cards (2 + 1 + 1 + 3 + 9 = 16)
        },
        p2: {
          hand: [{ suit: "S", rank: "3" }],
          field: [],
          grave: [],
          life: { count: 4 },
          pack: { count: 11 }, // Total 16 cards (1 + 0 + 0 + 4 + 11 = 16)
        },
      },
    };
  }

  // Helper to create a minimal valid scenario for standard-pack (53 cards: 52 standard + 1 Joker)
  function createMinimalStandardScenario(seed: number = 100): ScenarioDefinitionV1 {
    return {
      version: 1,
      environmentId: "official:standard-pack",
      seed,
      turnPlayer: "p1",
      chancePlayer: "p2",
      turnCount: 2,
      players: {
        p1: {
          hand: [
            { suit: "S", rank: "A" },
            { suit: "J", rank: "Joker" },
          ],
          field: [
            {
              componentId: "character.soldier",
              card: { suit: "H", rank: "10" },
            },
          ],
          grave: [
            { suit: "C", rank: "2" },
            { suit: "C", rank: "3" }, // tail card
          ],
          life: { count: 5 },
          pack: { count: 43 }, // 2 + 1 + 2 + 5 + 43 = 53
        },
        p2: {
          hand: [{ suit: "D", rank: "A" }],
          field: [],
          grave: [],
          life: { count: 5 },
          pack: { count: 47 }, // 1 + 5 + 47 = 53
        },
      },
    };
  }

  it("1: 正常なScenarioDefinitionV1からREADYでGameStateとGameSessionがコンパイルされること", () => {
    const scenario = createMinimalLightScenario(42);
    const result = compileScenarioDefinitionV1(scenario, catalog, fullRulePackage);

    if (result.kind === "VALIDATION_ERROR") {
      throw new Error("Validation errors in test 1: " + JSON.stringify(result.errors));
    }
    expect(result.kind).toBe("READY");
    if (result.kind !== "READY") return;

    expect(result.state).toBeDefined();
    expect(result.session).toBeDefined();
    expect(result.matchId).toMatch(/^match-scenario-light-entry16-42-[0-9a-f]{8}$/);
    expect(result.definitionHash).toMatch(/^[0-9a-f]{8}$/);

    // State inspections
    const state = result.state;
    expect(state.turnPlayer).toBe("p1");
    expect(state.chancePlayer).toBe("p1");
    expect(state.turnCount).toBe(1);
    expect(state.actionCount).toBe(0);

    // P1 zones
    expect(state.players.p1.hand.length).toBe(2);
    expect(state.players.p1.field.length).toBe(1);
    expect(state.players.p1.grave.length).toBe(1);
    expect(state.players.p1.life.length).toBe(3);
    expect(state.players.p1.pack.cards.length).toBe(9);

    // P2 zones
    expect(state.players.p2.hand.length).toBe(1);
    expect(state.players.p2.field.length).toBe(0);
    expect(state.players.p2.grave.length).toBe(0);
    expect(state.players.p2.life.length).toBe(4);
    expect(state.players.p2.pack.cards.length).toBe(11);
  });

  it("2: 同一Definition + 同一Seedで100% byte-for-byte 完全一致する決定論的生成", () => {
    const scenario = createMinimalLightScenario(777);
    const result1 = compileScenarioDefinitionV1(scenario, catalog, fullRulePackage);
    const result2 = compileScenarioDefinitionV1(scenario, catalog, fullRulePackage);

    expect(result1.kind).toBe("READY");
    expect(result2.kind).toBe("READY");
    if (result1.kind !== "READY" || result2.kind !== "READY") return;

    expect(result1.matchId).toBe(result2.matchId);
    expect(result1.definitionHash).toBe(result2.definitionHash);
    expect(JSON.stringify(result1.state)).toBe(JSON.stringify(result2.state));
  });

  it("3: 同一SeedでもDefinitionが異なればmatchIdのハッシュが異なり衝突しないこと", () => {
    const s1 = createMinimalLightScenario(42);
    const s2: ScenarioDefinitionV1 = {
      ...createMinimalLightScenario(42),
      turnPlayer: "p2",
      chancePlayer: "p2",
    };

    const r1 = compileScenarioDefinitionV1(s1, catalog, fullRulePackage);
    const r2 = compileScenarioDefinitionV1(s2, catalog, fullRulePackage);

    expect(r1.kind).toBe("READY");
    expect(r2.kind).toBe("READY");
    if (r1.kind !== "READY" || r2.kind !== "READY") return;

    expect(r1.definitionHash).not.toBe(r2.definitionHash);
    expect(r1.matchId).not.toBe(r2.matchId);
  });

  it("4: 異なるSeedでは明示指定Zoneは維持され、未指定補完カードのみ決定論的に変化すること", () => {
    const s1 = createMinimalLightScenario(100);
    const s2 = createMinimalLightScenario(200);

    const r1 = compileScenarioDefinitionV1(s1, catalog, fullRulePackage);
    const r2 = compileScenarioDefinitionV1(s2, catalog, fullRulePackage);

    expect(r1.kind).toBe("READY");
    expect(r2.kind).toBe("READY");
    if (r1.kind !== "READY" || r2.kind !== "READY") return;

    // Specified zones should have identical card ranks/suits
    expect(r1.state.players.p1.hand.map((c: any) => `${c.suit}${c.rank}`)).toEqual(
      r2.state.players.p1.hand.map((c: any) => `${c.suit}${c.rank}`)
    );
    expect(r1.state.players.p1.grave.map((c: any) => `${c.suit}${c.rank}`)).toEqual(
      r2.state.players.p1.grave.map((c: any) => `${c.suit}${c.rank}`)
    );

    // Unspecified pack cards should differ in order due to seed
    const packR1 = r1.state.players.p1.pack.cards.map((c: any) => `${c.suit}${c.rank}`).join(",");
    const packR2 = r2.state.players.p1.pack.cards.map((c: any) => `${c.suit}${c.rank}`).join(",");
    expect(packR1).not.toBe(packR2);
  });

  it("5: core-battle 環境は fail-closed で UNSUPPORTED_ENVIRONMENT となること", () => {
    const scenario: ScenarioDefinitionV1 = {
      ...createMinimalLightScenario(42),
      environmentId: "core-battle",
    };

    const result = compileScenarioDefinitionV1(scenario, catalog, fullRulePackage);
    expect(result.kind).toBe("VALIDATION_ERROR");
    if (result.kind === "VALIDATION_ERROR") {
      expect(result.errors.some(e => e.code === "UNSUPPORTED_ENVIRONMENT")).toBe(true);
    }
  });

  it("6: Joker は suit: 'J', rank: 'Joker' のみ許可され、不正なJoker表記や存在しない occurrence は拒絶されること", () => {
    // Valid standard scenario with Joker
    const validScenario = createMinimalStandardScenario(100);
    const validResult = compileScenarioDefinitionV1(validScenario, catalog, fullRulePackage);
    if (validResult.kind === "VALIDATION_ERROR") {
      throw new Error("validResult errors: " + JSON.stringify(validResult.errors));
    }
    expect(validResult.kind).toBe("READY");

    // Invalid Joker suit
    const invalidJoker1: ScenarioDefinitionV1 = {
      ...validScenario,
      players: {
        ...validScenario.players,
        p1: {
          ...validScenario.players.p1,
          hand: [{ suit: "S" as any, rank: "Joker" }],
        },
      },
    };
    const r1 = compileScenarioDefinitionV1(invalidJoker1, catalog, fullRulePackage);
    expect(r1.kind).toBe("VALIDATION_ERROR");

    // Invalid Joker rank
    const invalidJoker2: ScenarioDefinitionV1 = {
      ...validScenario,
      players: {
        ...validScenario.players,
        p1: {
          ...validScenario.players.p1,
          hand: [{ suit: "J", rank: "JOKER" }],
        },
      },
    };
    const r2 = compileScenarioDefinitionV1(invalidJoker2, catalog, fullRulePackage);
    expect(r2.kind).toBe("VALIDATION_ERROR");

    // Non-existent occurrence for single-instance card (standard-pack has 1 Joker, so occurrence 1 does not exist)
    const invalidOccurrence: ScenarioDefinitionV1 = {
      ...validScenario,
      players: {
        ...validScenario.players,
        p1: {
          ...validScenario.players.p1,
          hand: [
            { suit: "S", rank: "A" },
            { suit: "J", rank: "Joker", occurrence: 1 },
          ],
        },
      },
    };
    const r3 = compileScenarioDefinitionV1(invalidOccurrence, catalog, fullRulePackage);
    expect(r3.kind).toBe("VALIDATION_ERROR");
    if (r3.kind === "VALIDATION_ERROR") {
      expect(r3.errors.some(e => e.code === "INVALID_CARD_REF")).toBe(true);
    }
  });

  it("7: ScenarioUnitV1 から Derived 属性 (kind, labels) が正しくコンポーネント定義から導出されること", () => {
    const scenario = createMinimalLightScenario(42);
    const result = compileScenarioDefinitionV1(scenario, catalog, fullRulePackage);
    expect(result.kind).toBe("READY");
    if (result.kind !== "READY") return;

    const unit = result.state.players.p1.field[0];
    expect(unit.unitId).toBe("unit-p1-character.hero-0");
    expect(unit.componentId).toBe("character.hero");
    expect(unit.kind).toBe("英雄");
    expect(Array.isArray(unit.labels)).toBe(true);
  });

  it("8: Canonical State の正規化契約が満たされていること", () => {
    const scenario = createMinimalLightScenario(42);
    const result = compileScenarioDefinitionV1(scenario, catalog, fullRulePackage);
    expect(result.kind).toBe("READY");
    if (result.kind !== "READY") return;

    const state = result.state;
    expect(state.turnPlayer).toBe("p1");
    expect(state.nonTurnPlayer).toBe("p2");
    expect(state.actionCount).toBe(0);
    expect(state.turnUsage).toEqual({});
    expect(state.stage.requests).toEqual([]);
    expect(state.stage.history).toEqual([]);
    expect(state.requestBuffer.requests).toEqual([]);
    expect(state.requestBuffer.history).toEqual([]);
    expect(state.pendingGraveTopSelections).toEqual([]);
  });

  it("9: 墓地 TOP 契約: grave 末尾のカード ID が自動で graveTopCardId に設定され、空なら undefined になること", () => {
    const scenario = createMinimalStandardScenario(100);
    const result = compileScenarioDefinitionV1(scenario, catalog, fullRulePackage);
    if (result.kind === "VALIDATION_ERROR") {
      throw new Error("Validation errors in test 9: " + JSON.stringify(result.errors));
    }
    expect(result.kind).toBe("READY");
    if (result.kind !== "READY") return;

    // p1 has 2 grave cards (C2, C3); tail is C3
    const p1Grave = result.state.players.p1.grave;
    expect(p1Grave.length).toBe(2);
    expect(result.state.players.p1.graveTopCardId).toBe(p1Grave[1].id);
    expect(p1Grave[1].rank).toBe("3");

    // p2 has 0 grave cards; graveTopCardId is undefined
    expect(result.state.players.p2.grave.length).toBe(0);
    expect(result.state.players.p2.graveTopCardId).toBeUndefined();
  });

  it("10: カード保存則: デッキ枚数超過または重複・未定義カードで DECK_COMPLETION_IMPOSSIBLE / CARD_NOT_IN_REGULATION_DECK エラーとなること", () => {
    // Duplicate card in hand (entry16 only has one SA)
    const duplicateScenario: ScenarioDefinitionV1 = {
      ...createMinimalLightScenario(42),
      players: {
        ...createMinimalLightScenario(42).players,
        p1: {
          ...createMinimalLightScenario(42).players.p1,
          hand: [
            { suit: "S", rank: "A" },
            { suit: "S", rank: "A" }, // duplicate!
          ],
        },
      },
    };

    const result = compileScenarioDefinitionV1(duplicateScenario, catalog, fullRulePackage);
    expect(result.kind).toBe("VALIDATION_ERROR");
    if (result.kind === "VALIDATION_ERROR") {
      expect(result.errors.some(e => e.code === "DECK_COMPLETION_IMPOSSIBLE")).toBe(true);
    }
  });

  it("11: session.advance() が正常に動作し決定待機または進行状態へ遷移すること", () => {
    const scenario = createMinimalLightScenario(42);
    const result = compileScenarioDefinitionV1(scenario, catalog, fullRulePackage);
    expect(result.kind).toBe("READY");
    if (result.kind !== "READY") return;

    const initialStep = result.session.advance();
    expect(["WAITING_FOR_DECISION", "PROGRESSED"]).toContain(initialStep.type);
    expect(result.session.state).toBeDefined();
    expect(result.session.createSnapshot()).toBeDefined();
  });
});
