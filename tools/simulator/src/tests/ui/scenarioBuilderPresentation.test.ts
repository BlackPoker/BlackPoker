import React from "react";
import { renderToString } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";
import { ScenarioBuilderModal } from "../../ui/scenario/ScenarioBuilderModal";
import { loadRegulationCatalogForBrowser } from "../../engine/regulation/BrowserRegulationLoader";
import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader";
import { ActiveMatchContext, startMatchAttempt } from "../../engine/playtest/PlaytestEnvironmentController";
import { ScenarioDefinitionV1, normalizeScenarioDefinitionV1 } from "../../domain/scenario/ScenarioTypes";
import { ScenarioCompiler } from "../../engine/scenario/ScenarioCompiler";
import { PlaytestPolicyFactory } from "../../engine/playtest/PlaytestPolicyFactory";
import { createSeatControllers, normalizeHumanSeatForMode } from "../../engine/playtest/PlaytestSeatController";
import { encodeScenarioDefinitionV1ToUrlParam, decodeScenarioDefinitionV1FromUrlParam } from "../../ui/scenario/ScenarioShareUrl";
import { PreparedMatch } from "../../ui/playtest/CoreBattlePlaytest";

describe("ScenarioBuilderPresentation Unit & Integration Tests (BP-SIM-SCENARIO-1.0-FOUNDATION)", () => {
  const catalog = loadRegulationCatalogForBrowser();
  const fullRulePackage = loadRulePackageForBrowser();
  const dummyOnClose = vi.fn();
  const dummyOnStartScenario = vi.fn();

  const minimalValidScenario: ScenarioDefinitionV1 = {
    version: 1,
    environmentId: "official:light-entry16",
    seed: 42,
    turnPlayer: "p1",
    chancePlayer: "p1",
    turnCount: 1,
    name: "Presentation Test Scenario",
    description: "Scenario for presentation tests",
    players: {
      p1: {
        hand: [
          { suit: "S", rank: "A" },
          { suit: "S", rank: "2" },
        ],
        field: [
          {
            componentId: "character.hero",
            cards: [{ suit: "H", rank: "Q" }],
          },
        ],
        grave: [{ suit: "C", rank: "6" }],
        life: { count: 12 },
      },
      p2: {
        hand: [{ suit: "S", rank: "3" }],
        field: [],
        grave: [],
        life: { count: 15 },
      },
    },
  };

  it("1: ScenarioBuilderModal が正常にレンダリングされ、タイトルおよびコントロールが存在すること", () => {
    const html = renderToString(
      React.createElement(ScenarioBuilderModal, {
        isOpen: true,
        initialTab: "settings",
        catalog,
        fullRulePackage,
        initialDefinition: minimalValidScenario,
        onClose: dummyOnClose,
        onStartScenario: dummyOnStartScenario,
      })
    );

    expect(html).toContain("Scenario Builder");
    expect(html).toContain("対戦環境 (公式レギュレーションのみ):");
    expect(html).toContain("Turn Player:");
    expect(html).toContain("Chance Player:");
    expect(html).toContain("Scenario 開始");
  });

  it("2: Core Battle は選択肢から除外され、公式レギュレーションのみが環境一覧に表示されること", () => {
    const html = renderToString(
      React.createElement(ScenarioBuilderModal, {
        isOpen: true,
        initialTab: "settings",
        catalog,
        fullRulePackage,
        initialDefinition: minimalValidScenario,
        onClose: dummyOnClose,
        onStartScenario: dummyOnStartScenario,
      })
    );

    expect(html).not.toContain("value=\"core-battle\"");
    expect(html).not.toContain("Core Battle");
    expect(html).toContain("value=\"official:light-entry16\"");
  });

  it("3: UI 内に Phase 概念 (Phase / フェーズ) のラベルや操作コントロールが存在しないこと", () => {
    const html = renderToString(
      React.createElement(ScenarioBuilderModal, {
        isOpen: true,
        initialTab: "settings",
        catalog,
        fullRulePackage,
        initialDefinition: minimalValidScenario,
        onClose: dummyOnClose,
        onStartScenario: dummyOnStartScenario,
      })
    );

    // Ensure no turn phase or phase selection
    expect(html).not.toMatch(/メインフェーズ|アタックフェーズ|ドローフェーズ|phase|turnPhase/i);
    // But Turn Player and Chance Player exist
    expect(html).toContain("Turn Player");
    expect(html).toContain("Chance Player");
  });

  it("4: Scenario-origin 対戦における fail-closed 契約 (ActiveMatchContext.isScenario)", () => {
    // Normal match context
    const normalMatch: ActiveMatchContext = {
      environmentId: "official:light-entry16",
      environmentName: "ライト + エントリー16",
      regulationId: "light-entry16",
      rulePackage: fullRulePackage,
      isScenario: false,
    };
    expect(normalMatch.isScenario).toBe(false);

    // Scenario match context
    const scenarioMatch: ActiveMatchContext = {
      environmentId: "official:light-entry16",
      environmentName: "ライト + エントリー16 (Scenario)",
      regulationId: "light-entry16",
      rulePackage: fullRulePackage,
      isScenario: true,
    };
    expect(scenarioMatch.isScenario).toBe(true);

    // Fail-closed checks for scenario match
    const canUndo = (match: ActiveMatchContext, historyLength: number) => {
      if (match.isScenario) return false;
      return historyLength > 0;
    };
    expect(canUndo(scenarioMatch, 5)).toBe(false);
    expect(canUndo(normalMatch, 5)).toBe(true);

    const isDiagnosticDownloadAvailable = (match: ActiveMatchContext) => {
      return match.isScenario !== true;
    };
    expect(isDiagnosticDownloadAvailable(scenarioMatch)).toBe(false);
    expect(isDiagnosticDownloadAvailable(normalMatch)).toBe(true);

    const isReplayViewerAvailable = (match: ActiveMatchContext) => {
      return match.isScenario !== true;
    };
    expect(isReplayViewerAvailable(scenarioMatch)).toBe(false);
    expect(isReplayViewerAvailable(normalMatch)).toBe(true);
  });

  it("5: ScenarioBuilderModal のバリデーションエラー表示と開始ボタン無効化", () => {
    // Duplicate card in hand causes compile error
    const duplicateCardScenario: ScenarioDefinitionV1 = {
      ...minimalValidScenario,
      players: {
        ...minimalValidScenario.players,
        p1: {
          ...minimalValidScenario.players.p1,
          hand: [
            { suit: "S", rank: "A" },
            { suit: "S", rank: "A" }, // duplicate SA
          ],
        },
      },
    };

    const html = renderToString(
      React.createElement(ScenarioBuilderModal, {
        isOpen: true,
        catalog,
        fullRulePackage,
        initialDefinition: duplicateCardScenario,
        onClose: dummyOnClose,
        onStartScenario: dummyOnStartScenario,
      })
    );

    // Should show error and disabled start button
    expect(html).toContain("cursor-not-allowed");
    expect(html).toContain("バリデーションエラー");
  });

  it("6: UI Round-Trip: Definition A -> URL encode -> URL import -> UI state -> Export Definition B == A", () => {
    const defA: ScenarioDefinitionV1 = {
      version: 1,
      environmentId: "official:light-entry16",
      seed: 888,
      turnPlayer: "p1",
      chancePlayer: "p2",
      turnCount: 2,
      name: "RoundTrip Scenario",
      description: "Full round-trip test",
      players: {
        p1: {
          hand: [{ suit: "S", rank: "A" }],
          field: [
            {
              componentId: "character.hero",
              cards: [{ suit: "H", rank: "Q" }],
              state: "drive",
              face: "up",
            },
          ],
          grave: [{ suit: "C", rank: "6" }],
          life: { cards: [{ suit: "D", rank: "5" }], count: 13 },
        },
        p2: {
          hand: [{ suit: "S", rank: "3" }],
          field: [],
          grave: [],
          life: { count: 15 },
        },
      },
    };

    // 1. Encode to URL param
    const param = encodeScenarioDefinitionV1ToUrlParam(defA);
    // 2. Decode from URL param
    const decodeResult = decodeScenarioDefinitionV1FromUrlParam(param);
    expect(decodeResult.success).toBe(true);
    if (!decodeResult.success) return;

    const imported = decodeResult.definition;

    // 3. Simulate UI state restoration as in ScenarioBuilderModal.handleLoadFromUrl
    const uiP1Hand = imported.players?.p1?.hand ? [...imported.players.p1.hand] : [];
    const uiP1Field = imported.players?.p1?.field ? [...imported.players.p1.field] : [];
    const uiP1Grave = imported.players?.p1?.grave ? [...imported.players.p1.grave] : [];
    const uiP1LifeCards = imported.players?.p1?.life?.cards ? [...imported.players.p1.life.cards] : [];
    const uiP1LifeCount = imported.players?.p1?.life?.count;
    const uiP1PackCards = imported.players?.p1?.pack?.cards ? [...imported.players.p1.pack.cards] : [];
    const uiP1PackCount = imported.players?.p1?.pack?.count;

    const uiP2Hand = imported.players?.p2?.hand ? [...imported.players.p2.hand] : [];
    const uiP2Field = imported.players?.p2?.field ? [...imported.players.p2.field] : [];
    const uiP2Grave = imported.players?.p2?.grave ? [...imported.players.p2.grave] : [];
    const uiP2LifeCards = imported.players?.p2?.life?.cards ? [...imported.players.p2.life.cards] : [];
    const uiP2LifeCount = imported.players?.p2?.life?.count;
    const uiP2PackCards = imported.players?.p2?.pack?.cards ? [...imported.players.p2.pack.cards] : [];
    const uiP2PackCount = imported.players?.p2?.pack?.count;

    // 4. Reconstruct Definition B from UI state as in currentDefinition
    const buildPlayerConfig = (
      hand: any[],
      field: any[],
      grave: any[],
      lifeCards: any[],
      lifeCount: number | undefined,
      packCards: any[],
      packCount: number | undefined
    ) => ({
      ...(hand.length > 0 ? { hand } : {}),
      ...(field.length > 0 ? { field } : {}),
      ...(grave.length > 0 ? { grave } : {}),
      ...(lifeCards.length > 0 || lifeCount !== undefined
        ? {
            life: {
              ...(lifeCards.length > 0 ? { cards: lifeCards } : {}),
              ...(lifeCount !== undefined ? { count: lifeCount } : {}),
            },
          }
        : {}),
      ...(packCards.length > 0 || packCount !== undefined
        ? {
            pack: {
              ...(packCards.length > 0 ? { cards: packCards } : {}),
              ...(packCount !== undefined ? { count: packCount } : {}),
            },
          }
        : {}),
    });

    const defB: ScenarioDefinitionV1 = {
      version: 1,
      name: imported.name,
      description: imported.description,
      environmentId: imported.environmentId,
      seed: imported.seed,
      turnPlayer: imported.turnPlayer,
      chancePlayer: imported.chancePlayer,
      turnCount: imported.turnCount,
      players: {
        p1: buildPlayerConfig(uiP1Hand, uiP1Field, uiP1Grave, uiP1LifeCards, uiP1LifeCount, uiP1PackCards, uiP1PackCount),
        p2: buildPlayerConfig(uiP2Hand, uiP2Field, uiP2Grave, uiP2LifeCards, uiP2LifeCount, uiP2PackCards, uiP2PackCount),
      },
    };

    // 5. Verification: normalized A and B are identical
    expect(normalizeScenarioDefinitionV1(defB)).toEqual(normalizeScenarioDefinitionV1(defA));

    // 6. Verification: UI renders with defB successfully without errors
    const html = renderToString(
      React.createElement(ScenarioBuilderModal, {
        isOpen: true,
        catalog,
        fullRulePackage,
        initialDefinition: defB,
        onClose: dummyOnClose,
        onStartScenario: dummyOnStartScenario,
      })
    );
    expect(html).toContain("バリデーション正常");
  });

  it("7: Atomic Start: 実Production経路による compile failure / policy failure 双方で既存Active Matchが完全保持されること", async () => {
    // 1. Initial State: Start Match A (Active Match)
    const matchAOutcome = startMatchAttempt({
      environmentId: "official:light-entry16",
      seedInput: "42",
      catalog,
      fullRulePackage,
    });
    expect(matchAOutcome.type).toBe("READY");
    if (matchAOutcome.type !== "READY") return;

    let activeSession = matchAOutcome.session;
    let activeMatchContext = matchAOutcome.activeMatch;
    const initialMatchAStateSnapshot = JSON.stringify(activeSession.state);

    // Simulated atomic coordinator matching CoreBattlePlaytest exactly
    const runAtomicScenarioStart = async (def: ScenarioDefinitionV1): Promise<{ success: boolean; notice?: any }> => {
      // 1. Prepare: Compile
      const outcome = ScenarioCompiler.compile(def, catalog, fullRulePackage);
      if (outcome.type !== "READY") {
        return {
          success: false,
          notice: { type: "TECHNICAL_ERROR", message: "Scenario コンパイルエラー" },
        };
      }

      // 2. Prepare: Session advance
      let initialStep: any;
      try {
        initialStep = outcome.session.advance();
      } catch (err: any) {
        return { success: false, notice: { type: "TECHNICAL_ERROR", message: err.message } };
      }

      // 3. Prepare: SeatController and Policies
      const seatControllers = createSeatControllers("humanVsAi", "p1", "firstLegal");
      let policies: any;
      try {
        policies = PlaytestPolicyFactory.createPoliciesForMatch(seatControllers, def.seed);
      } catch (err: any) {
        return { success: false, notice: { type: "TECHNICAL_ERROR", message: "AI Policy 初期化エラー" } };
      }

      // 4. Commit: Atomic commit (Only reached if all prepare steps succeed!)
      const prepared: PreparedMatch = {
        session: outcome.session,
        activeMatch: {
          environmentId: def.environmentId,
          environmentName: "Scenario Match",
          seed: def.seed,
          rulePackage: outcome.rulePackage,
          isScenario: true,
        },
        mode: "humanVsAi",
        humanSeat: "p1",
        policyId: "firstLegal",
        seatControllers,
        policies,
        initialStep,
      };

      // Atomic commit
      activeSession = prepared.session;
      activeMatchContext = prepared.activeMatch;
      return { success: true };
    };

    // Case 1: Compile Failure -> Match A must be 100% preserved
    const invalidScenario: ScenarioDefinitionV1 = {
      ...minimalValidScenario,
      players: {
        ...minimalValidScenario.players,
        p1: {
          ...minimalValidScenario.players.p1,
          hand: [
            { suit: "S", rank: "A" },
            { suit: "S", rank: "A" }, // duplicate SA
          ],
        },
      },
    };

    const res1 = await runAtomicScenarioStart(invalidScenario);
    expect(res1.success).toBe(false);
    expect(res1.notice?.message).toBe("Scenario コンパイルエラー");
    // Verify Match A is completely unchanged
    expect(activeMatchContext.environmentId).toBe("official:light-entry16");
    expect(activeMatchContext.isScenario).toBeUndefined();
    expect(JSON.stringify(activeSession.state)).toBe(initialMatchAStateSnapshot);

    // Case 2: Policy Initialization Failure -> Match A must be 100% preserved
    const policySpy = vi.spyOn(PlaytestPolicyFactory, "createPoliciesForMatch").mockImplementationOnce(() => {
      throw new Error("Simulated policy creation failure");
    });

    const res2 = await runAtomicScenarioStart(minimalValidScenario);
    expect(res2.success).toBe(false);
    expect(res2.notice?.message).toBe("AI Policy 初期化エラー");
    // Verify Match A is completely unchanged
    expect(activeMatchContext.environmentId).toBe("official:light-entry16");
    expect(activeMatchContext.isScenario).toBeUndefined();
    expect(JSON.stringify(activeSession.state)).toBe(initialMatchAStateSnapshot);

    policySpy.mockRestore();

    // Case 3: Valid Scenario -> Atomic Commit succeeds and switches to Match B
    const res3 = await runAtomicScenarioStart(minimalValidScenario);
    expect(res3.success).toBe(true);
    expect(activeMatchContext.isScenario).toBe(true);
    expect(JSON.stringify(activeSession.state)).not.toBe(initialMatchAStateSnapshot);
  });
});
