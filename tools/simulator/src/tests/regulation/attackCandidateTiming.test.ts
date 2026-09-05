import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { OfficialRegulationMatchFactory } from "../../engine/regulation/OfficialRegulationMatchFactory";
import { loadRegulationCatalog, getRegulation, getFrame, getFormat } from "../../engine/regulation/RegulationLoader";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RegulationRulePackageSelector } from "../../engine/regulation/RegulationRulePackageSelector";
import { GameSession } from "../../engine/session/GameSession";
import { isLegalAttackerCandidate } from "../../engine/rules/characterUtils";
import { CommandRegistry } from "../../engine/rules/CommandRegistry";

describe("Attack Candidate Timing & Summon Restriction Tests (A-L)", () => {
  let catalog: any;
  let regulation: any;
  let format: any;
  let frame: any;
  let officialRulePackage: any;

  beforeAll(async () => {
    catalog = await loadRegulationCatalog();
    regulation = await getRegulation("light-entry16");
    format = await getFormat("light");
    frame = await getFrame("entry16");

    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    const fullPackage = await loadRulePackageFromDirectory(rulesDir);
    officialRulePackage = RegulationRulePackageSelector.selectRulePackage(fullPackage, format, regulation);
  });

  it("A & B. First Player's preset soldier must be in legal attacker candidates on Turn 1", async () => {
    const session = await OfficialRegulationMatchFactory.createSession("light-entry16", 42, {
      catalog,
      fullRulePackage: officialRulePackage,
    });

    const turnPlayerKey = session.state.turnPlayer;
    const player = session.state.players[turnPlayerKey];
    const presetSoldier = player.field.find((u: any) => u.componentId !== "character.bulwark");

    expect(presetSoldier).toBeDefined();
    expect(presetSoldier.enteredFieldBeforeGame).toBe(true);
    expect(presetSoldier.state).toBe("charge");

    // Turn 1 アタッカー候補判定
    const isAttacker = isLegalAttackerCandidate(
      presetSoldier,
      officialRulePackage.components,
      session.state.turnCount
    );
    expect(isAttacker).toBe(true);
  });

  it("C. Second Player's preset soldier must be legal to attack on second player's first active turn", async () => {
    const session = await OfficialRegulationMatchFactory.createSession("light-entry16", 42, {
      catalog,
      fullRulePackage: officialRulePackage,
    });

    const nonTurnPlayerKey = session.state.nonTurnPlayer;
    const p2 = session.state.players[nonTurnPlayerKey];
    const p2PresetSoldier = p2.field.find((u: any) => u.componentId !== "character.bulwark");

    expect(p2PresetSoldier).toBeDefined();
    expect(p2PresetSoldier.enteredFieldBeforeGame).toBe(true);

    // 後攻プレイヤーの手番に移行したと仮定 (turnCount = 2)
    const isAttackerOnP2Turn = isLegalAttackerCandidate(
      p2PresetSoldier,
      officialRulePackage.components,
      2
    );
    expect(isAttackerOnP2Turn).toBe(true);
  });

  it("D, E, F. Summoned soldier in charge state must NOT be an attacker candidate in the same turn", () => {
    const currentTurn = 1;
    const summonedSoldier = {
      unitId: "soldier-summoned-1",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      face: "up",
      cards: [{ id: "c-s5", suit: "S", rank: "5", value: 5 }],
      labels: ["攻撃", "防御"],
      enteredFieldBeforeGame: false,
      enteredFieldTurn: currentTurn,
      enteredTurn: currentTurn,
    };

    expect(summonedSoldier.state).toBe("charge");

    // 同一ターン (turnCount === 1) のためアタック不可
    const canAttackSameTurn = isLegalAttackerCandidate(
      summonedSoldier,
      officialRulePackage.components,
      currentTurn
    );
    expect(canAttackSameTurn).toBe(false);
  });

  it("G. Re-setting charge state in the same turn does NOT remove the summon-turn attack restriction", () => {
    const currentTurn = 1;
    const summonedSoldier = {
      unitId: "soldier-summoned-1",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "drive", // 一旦ドライブ
      face: "up",
      cards: [{ id: "c-s5", suit: "S", rank: "5", value: 5 }],
      labels: ["攻撃", "防御"],
      enteredFieldBeforeGame: false,
      enteredFieldTurn: currentTurn,
      enteredTurn: currentTurn,
    };

    // 再びチャージ状態にする
    summonedSoldier.state = "charge";

    const canAttack = isLegalAttackerCandidate(
      summonedSoldier,
      officialRulePackage.components,
      currentTurn
    );
    expect(canAttack).toBe(false);
  });

  it("H. After turn advances, summoned soldier can attack if in charge state", () => {
    const summonedSoldier = {
      unitId: "soldier-summoned-1",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      face: "up",
      cards: [{ id: "c-s5", suit: "S", rank: "5", value: 5 }],
      labels: ["攻撃", "防御"],
      enteredFieldBeforeGame: false,
      enteredFieldTurn: 1,
      enteredTurn: 1,
    };

    // 次のターン (turnCount = 2 or 3)
    const canAttackNextTurn = isLegalAttackerCandidate(
      summonedSoldier,
      officialRulePackage.components,
      2
    );
    expect(canAttackNextTurn).toBe(true);
  });

  it("I. Preset soldier does NOT have the summon-turn restriction", () => {
    const presetSoldier = {
      unitId: "soldier-preset-1",
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      face: "up",
      cards: [{ id: "c-s5", suit: "S", rank: "5", value: 5 }],
      labels: ["攻撃", "防御"],
      enteredFieldBeforeGame: true,
      enteredFieldTurn: 0,
      enteredTurn: 0,
    };

    expect(isLegalAttackerCandidate(presetSoldier, officialRulePackage.components, 1)).toBe(true);
  });

  it("J. Hero (character.hero) summoned during the game is also restricted in the same turn", () => {
    const currentTurn = 2;
    const summonedHero = {
      unitId: "hero-summoned-1",
      kind: "英雄",
      componentId: "character.hero",
      state: "charge",
      face: "up",
      cards: [{ id: "c-hK", suit: "H", rank: "K", value: 13 }],
      labels: ["攻撃", "防御"],
      enteredFieldBeforeGame: false,
      enteredFieldTurn: currentTurn,
      enteredTurn: currentTurn,
    };

    expect(isLegalAttackerCandidate(summonedHero, officialRulePackage.components, currentTurn)).toBe(false);
    expect(isLegalAttackerCandidate(summonedHero, officialRulePackage.components, currentTurn + 1)).toBe(true);
  });

  it("K. Component with immediate attack capability (haste / 速攻, e.g. Ace) CAN attack in the same turn (generic attribute without hardcode)", () => {
    const currentTurn = 1;
    const summonedAce = {
      unitId: "ace-summoned-1",
      kind: "エース",
      componentId: "character.ace",
      state: "charge",
      face: "up",
      cards: [{ id: "c-cA", suit: "C", rank: "A", value: 1 }],
      labels: ["攻撃", "防御", "速攻"],
      enteredFieldBeforeGame: false,
      enteredFieldTurn: currentTurn,
      enteredTurn: currentTurn,
    };

    // 速攻を持つため召喚ターンでもアタック可能
    const canAttackSameTurn = isLegalAttackerCandidate(
      summonedAce,
      officialRulePackage.components,
      currentTurn
    );
    expect(canAttackSameTurn).toBe(true);
  });
});
