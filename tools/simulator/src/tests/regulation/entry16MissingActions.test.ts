import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { loadRegulationCatalog, getRegulation, getFormat } from "../../engine/regulation/RegulationLoader";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RegulationRulePackageSelector } from "../../engine/regulation/RegulationRulePackageSelector";
import { CommandRegistry } from "../../engine/rules/CommandRegistry";
import { CostResolver } from "../../engine/rules/CostResolver";
import { CostPaymentEnumerator } from "../../engine/decision/CostPaymentEnumerator";
import { LegalPatternGenerator } from "../../engine/decision/LegalPatternGenerator";
import { AbilityEvaluator } from "../../engine/rules/AbilityEvaluator";

describe("Entry16 Reachable Missing Actions End-to-End Tests (Hero, Ace, Mount)", () => {
  let officialRulePackage: any;
  let registry: CommandRegistry;
  let abilityEvaluator: AbilityEvaluator;

  beforeAll(async () => {
    const catalog = await loadRegulationCatalog();
    const regulation = await getRegulation("light-entry16");
    const format = await getFormat("light");

    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    const fullPackage = await loadRulePackageFromDirectory(rulesDir);
    officialRulePackage = RegulationRulePackageSelector.selectRulePackage(fullPackage, format, regulation);

    registry = new CommandRegistry();
    abilityEvaluator = new AbilityEvaluator();
  });

  it("1. 英雄召喚 (action.summonHero): Cost BBL, Key J..K, creates character.hero with size 11-13", () => {
    const heroAction = officialRulePackage.actions.find((a: any) => a.id === "action.summonHero");
    expect(heroAction).toBeDefined();
    expect(heroAction.cost).toBe("BBL");
    expect(heroAction.key.condition.card.rank).toBe("J..K");

    // Cost payment enumeration test: 2 bulwarks + 1 life
    const player: any = {
      life: [{ id: "l1", suit: "S", rank: "2", value: 2 }],
      hand: [
        { id: "h-hero", suit: "H", rank: "K", value: 13 },
        { id: "h-dummy", suit: "D", rank: "5", value: 5 },
      ],
      field: [
        { unitId: "bw-1", kind: "防壁", componentId: "character.bulwark", state: "charge" },
        { unitId: "bw-2", kind: "防壁", componentId: "character.bulwark", state: "charge" },
      ],
    };

    const payments = CostPaymentEnumerator.enumeratePayments("BBL", player, new Set(["h-hero"]));
    expect(payments.length).toBe(1);
    expect(payments[0].drivenBulwarkUnitIds.length).toBe(2);
    expect(payments[0].lifeCount).toBe(1);

    // Execution via CommandRegistry
    const context: any = {
      state: { turnCount: 1, players: { p1: player } },
      playerKey: "p1",
      keyCard: player.hand[0],
      components: officialRulePackage.components,
    };

    const effectCmd = heroAction.effect?.find((e: any) => e.summonUnit);
    expect(effectCmd).toBeDefined();

    registry.execute("summonUnit", (effectCmd as any).summonUnit, context);

    // 英雄が field に生成されたことの検証
    const summonedHero = player.field.find((u: any) => u.componentId === "character.hero");
    expect(summonedHero).toBeDefined();
    expect(summonedHero.kind).toBe("英雄");
    expect(summonedHero.state).toBe("charge");
    expect(summonedHero.face).toBe("up");
    expect(summonedHero.cards[0].rank).toBe("K");

    // サイズ計算: K -> 13
    const size = abilityEvaluator.calculateUnitSize(summonedHero, context.state);
    expect(size).toBe(13);
  });

  it("2. エース召喚 (action.summonAce): Cost L, Key A, creates character.ace with haste", () => {
    const aceAction = officialRulePackage.actions.find((a: any) => a.id === "action.summonAce");
    expect(aceAction).toBeDefined();
    expect(aceAction.cost).toBe("L");
    expect(aceAction.key.condition.card.rank).toBe("A");

    const player: any = {
      life: [{ id: "l1", suit: "S", rank: "2", value: 2 }],
      hand: [{ id: "h-ace", suit: "C", rank: "A", value: 1 }],
      field: [],
    };

    const payments = CostPaymentEnumerator.enumeratePayments("L", player, new Set(["h-ace"]));
    expect(payments.length).toBe(1);
    expect(payments[0].lifeCount).toBe(1);

    const context: any = {
      state: { turnCount: 1, players: { p1: player } },
      playerKey: "p1",
      keyCard: player.hand[0],
      components: officialRulePackage.components,
    };

    const effectCmd = aceAction.effect?.find((e: any) => e.summonUnit);
    expect(effectCmd).toBeDefined();

    registry.execute("summonUnit", (effectCmd as any).summonUnit, context);

    const summonedAce = player.field.find((u: any) => u.componentId === "character.ace");
    expect(summonedAce).toBeDefined();
    expect(summonedAce.kind).toBe("エース");
    expect(summonedAce.cards[0].rank).toBe("A");

    // 速攻ラベルの保持
    const compDef = officialRulePackage.components.find((c: any) => c.id === "character.ace");
    expect(compDef.properties.labels).toContain("haste");
  });

  it("3. 装備 (action.mountSoldier): Cost BL, mounts same suit card onto soldier, upgrades to armedSoldier", () => {
    const mountAction = officialRulePackage.actions.find((a: any) => a.id === "action.mountSoldier");
    expect(mountAction).toBeDefined();
    expect(mountAction.cost).toBe("BL");

    const player: any = {
      life: [{ id: "l1", suit: "S", rank: "2", value: 2 }],
      hand: [
        { id: "h-spade-8", suit: "S", rank: "8", value: 8 }, // 装備カード (♠8)
      ],
      field: [
        {
          unitId: "soldier-s5",
          kind: "一般兵",
          componentId: "character.soldier",
          state: "charge",
          cards: [{ id: "c-s5", suit: "S", rank: "5", value: 5 }], // ♠5 の兵士
          labels: ["攻撃", "防御"],
        },
        {
          unitId: "bw-1",
          kind: "防壁",
          componentId: "character.bulwark",
          state: "charge",
        },
      ],
    };

    const context: any = {
      state: { turnCount: 1, players: { p1: player } },
      playerKey: "p1",
      keyCard: player.hand[0],
      targetUnitId: "soldier-s5",
      targetComponent: player.field[0],
      components: officialRulePackage.components,
    };

    const effectCmd = mountAction.effect?.find((e: any) => e.mountUnit);
    expect(effectCmd).toBeDefined();

    registry.execute("mountUnit", (effectCmd as any).mountUnit, context);

    const armedSoldier = player.field.find((u: any) => u.unitId === "soldier-s5");
    expect(armedSoldier).toBeDefined();
    expect(armedSoldier.kind).toBe("装備兵");
    expect(armedSoldier.componentId).toBe("character.armedSoldier");
    expect(armedSoldier.cards.length).toBe(2);
    expect(armedSoldier.cards.map((c: any) => c.id)).toEqual(["c-s5", "h-spade-8"]);

    // サイズ合算: 5 + 8 = 13
    const size = abilityEvaluator.calculateUnitSize(armedSoldier, context.state);
    expect(size).toBe(13);
  });

  it("3b. 装備 (action.mountSoldier): 同一ターンに条件を満たせば複数回合法アクションとして列挙可能 (usageLimitなし回帰検証)", () => {
    const mountAction = officialRulePackage.actions.find((a: any) => a.id === "action.mountSoldier");
    expect(mountAction).toBeDefined();
    // usageLimit が未定義であることを確認
    expect(mountAction.usageLimit).toBeUndefined();

    const state: any = {
      turnCount: 1,
      turnPlayer: "p1",
      chancePlayer: "p1",
      turnUsage: {},
      stage: { requests: [], history: [] },
      players: {
        p1: {
          life: [
            { id: "l1", suit: "H", rank: "2", value: 2 },
            { id: "l2", suit: "D", rank: "3", value: 3 },
          ],
          hand: [
            { id: "h-s8", suit: "S", rank: "8", value: 8 },
            { id: "h-s10", suit: "S", rank: "10", value: 10 },
          ],
          field: [
            {
              unitId: "bw-1",
              kind: "防壁",
              componentId: "character.bulwark",
              state: "charge",
              cards: [{ id: "c-bw1", suit: "D", rank: "4" }],
            },
            {
              unitId: "bw-2",
              kind: "防壁",
              componentId: "character.bulwark",
              state: "charge",
              cards: [{ id: "c-bw2", suit: "C", rank: "6" }],
            },
            {
              unitId: "soldier-s5",
              kind: "一般兵",
              componentId: "character.soldier",
              state: "charge",
              cards: [{ id: "c-s5", suit: "S", rank: "5", value: 5 }],
              labels: ["攻撃", "防御"],
            },
          ],
          grave: [],
        },
        p2: {
          life: [{ id: "p2-l1", suit: "C", rank: "4", value: 4 }],
          hand: [],
          field: [],
          grave: [],
        },
      },
    };

    // 1. 初回: action.mountSoldier の合法パターンが存在すること
    const { request: req1 } = LegalPatternGenerator.generateActionRequestDecision(state, "p1", officialRulePackage);
    const mountActionRef1 = req1.catalog.actions.findIndex((a) => a.actionId === "action.mountSoldier");
    expect(mountActionRef1).not.toBe(-1);
    const mountPatterns1 = req1.patterns.filter((p) => p.actionSelectionRef === mountActionRef1);
    expect(mountPatterns1.length).toBeGreaterThan(0);

    // 2. 1回目の装備を実行して解決 (h-s8 を soldier-s5 に装備)
    const effectCmd = mountAction.effect?.find((e: any) => e.mountUnit);
    expect(effectCmd).toBeDefined();

    const player1 = state.players.p1;
    const targetSoldier = player1.field.find((u: any) => u.unitId === "soldier-s5");
    const context1: any = {
      state,
      playerKey: "p1",
      keyCard: player1.hand[0], // h-s8
      targetUnitId: "soldier-s5",
      targetComponent: targetSoldier,
      components: officialRulePackage.components,
    };

    // コストBL支払い (防壁 bw-1 を drive、Life 1枚を Grave へ)
    const bw1 = player1.field.find((u: any) => u.unitId === "bw-1");
    bw1.state = "drive";
    const blCard = player1.life.shift();
    player1.grave.push(blCard);
    // 手札からキーカードを消費して装備
    player1.hand.shift();

    // mountUnit 実行
    registry.execute("mountUnit", (effectCmd as any).mountUnit, context1);

    // 1回目の使用回数を記録
    if (!state.turnUsage.p1) state.turnUsage.p1 = {};
    state.turnUsage.p1["action.mountSoldier"] = 1;

    // 装備兵にアップグレードされていることを確認
    const armedUnit = player1.field.find((u: any) => u.unitId === "soldier-s5");
    expect(armedUnit.componentId).toBe("character.armedSoldier");
    expect(armedUnit.kind).toBe("装備兵");
    expect(armedUnit.cards.length).toBe(2);

    // 3. 同じターン内、Stage empty、chancePlayer=p1、別キーカード (h-s10) が手札にあり、コストBL支払い可能
    // 装備兵も characterType === "soldier" かつ suit === "S" であり、合法対象として再度装備可能
    const { request: req2 } = LegalPatternGenerator.generateActionRequestDecision(state, "p1", officialRulePackage);
    const mountActionRef2 = req2.catalog.actions.findIndex((a) => a.actionId === "action.mountSoldier");
    expect(mountActionRef2).not.toBe(-1);
    const mountPatterns2 = req2.patterns.filter((p) => p.actionSelectionRef === mountActionRef2);

    // turnUsage に 1 回の記録があっても usageLimit がないため、2回目の装備パターンが正常に列挙されること
    expect(mountPatterns2.length).toBeGreaterThan(0);
    expect(state.turnUsage.p1["action.mountSoldier"]).toBe(1);
  });


  it("4. サーチ (action.search): Present in Light RulePackage but DECLARED_UNREACHABLE_IN_ENTRY16", () => {
    const searchAction = officialRulePackage.actions.find((a: any) => a.id === "action.search");
    expect(searchAction).toBeDefined();
    expect(searchAction.key.condition.card.rank).toBe("Joker");
  });
});
