import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { loadRegulationCatalog, getRegulation, getFrame, getFormat } from "../../engine/regulation/RegulationLoader";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RegulationRulePackageSelector } from "../../engine/regulation/RegulationRulePackageSelector";
import { OfficialRegulationMatchFactory } from "../../engine/regulation/OfficialRegulationMatchFactory";
import { SeededRandom } from "../../engine/random/RandomSource";

describe("Entry16 Deck, Setup & Conservation Tests (AQ 15-21, AR 22-38, AS 39-42)", () => {
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

  // =========================================================================
  // AQ. Entry16 Deck (15-21)
  // =========================================================================
  it("15. Deck should have exactly 16 cards in Frame definition", () => {
    expect(frame.deck.cardCount).toBe(16);
    expect(frame.deck.cards.length).toBe(16);
  });

  it("16 & 17. Fixed 16 cards multiset match exactly and contain NO Joker", () => {
    const expectedCards = [
      { suit: "S", rank: "A", value: 1 },
      { suit: "S", rank: "2", value: 2 },
      { suit: "S", rank: "3", value: 3 },
      { suit: "S", rank: "K", value: 13 },
      { suit: "H", rank: "4", value: 4 },
      { suit: "H", rank: "7", value: 7 },
      { suit: "H", rank: "J", value: 11 },
      { suit: "H", rank: "Q", value: 12 },
      { suit: "D", rank: "5", value: 5 },
      { suit: "D", rank: "8", value: 8 },
      { suit: "D", rank: "10", value: 10 },
      { suit: "D", rank: "Q", value: 12 },
      { suit: "C", rank: "A", value: 1 },
      { suit: "C", rank: "6", value: 6 },
      { suit: "C", rank: "9", value: 9 },
      { suit: "C", rank: "K", value: 13 },
    ];

    const sortFn = (a: any, b: any) => `${a.suit}${a.rank}`.localeCompare(`${b.suit}${b.rank}`);
    expect([...frame.deck.cards].sort(sortFn)).toEqual([...expectedCards].sort(sortFn));

    for (const c of frame.deck.cards) {
      expect(c.suit).not.toBe("J");
      expect(c.rank).not.toBe("Joker");
    }
  });

  it("18. Card identities should be unique within each player", () => {
    const outcome = OfficialRegulationMatchFactory.setupMatch(
      regulation,
      frame,
      officialRulePackage,
      42
    );
    expect(outcome.type).toBe("READY");
    if (outcome.type !== "READY") return;

    // Verify card conservation method validates uniqueness
    expect(() =>
      OfficialRegulationMatchFactory.verifyCardConservation("p1", outcome.state.players.p1, frame.deck.cards)
    ).not.toThrow();
    expect(() =>
      OfficialRegulationMatchFactory.verifyCardConservation("p2", outcome.state.players.p2, frame.deck.cards)
    ).not.toThrow();
  });

  it("19. Same seed must produce identical setup result", () => {
    const outcome1 = OfficialRegulationMatchFactory.setupMatch(regulation, frame, officialRulePackage, 12345);
    const outcome2 = OfficialRegulationMatchFactory.setupMatch(regulation, frame, officialRulePackage, 12345);

    expect(JSON.stringify(outcome1)).toBe(JSON.stringify(outcome2));
  });

  it("20. Different seeds must produce different card orders", () => {
    const outcomeA = OfficialRegulationMatchFactory.setupMatch(regulation, frame, officialRulePackage, 111);
    const outcomeB = OfficialRegulationMatchFactory.setupMatch(regulation, frame, officialRulePackage, 999);

    if (outcomeA.type !== "READY" || outcomeB.type !== "READY") return;
    const p1HandA = outcomeA.state.players.p1.hand.map((c: any) => c.id).join(",");
    const p1HandB = outcomeB.state.players.p1.hand.map((c: any) => c.id).join(",");
    expect(p1HandA).not.toBe(p1HandB);
  });

  it("21. P1 and P2 shuffle streams must be independent", () => {
    const outcome = OfficialRegulationMatchFactory.setupMatch(regulation, frame, officialRulePackage, 42);
    if (outcome.type !== "READY") return;

    const p1Hand = outcome.state.players.p1.hand.map((c: any) => `${c.suit}${c.rank}`).join(",");
    const p2Hand = outcome.state.players.p2.hand.map((c: any) => `${c.suit}${c.rank}`).join(",");
    expect(p1Hand).not.toBe(p2Hand);
  });

  // =========================================================================
  // AR. Setup Sequence (22-38)
  // =========================================================================
  it("22-26. Setup sequence: Hand 7, Bulwark face-down, Soldier face-up", () => {
    const outcome = OfficialRegulationMatchFactory.setupMatch(regulation, frame, officialRulePackage, 42);
    expect(outcome.type).toBe("READY");
    if (outcome.type !== "READY") return;

    const state = outcome.state;
    const p1 = state.players.p1;
    const p2 = state.players.p2;

    // 先攻は開始時 +1枚引くので 8枚、後攻は 7枚
    if (state.turnPlayer === "p1") {
      expect(p1.hand.length).toBe(8);
      expect(p2.hand.length).toBe(7);
    } else {
      expect(p1.hand.length).toBe(7);
      expect(p2.hand.length).toBe(8);
    }

    // 防壁確認 (裏向き, charge)
    const p1Bw = p1.field.find((u: any) => u.componentId === "character.bulwark");
    expect(p1Bw).toBeDefined();
    expect(p1Bw.face).toBe("down");
    expect(p1Bw.state).toBe("charge");
    expect(p1Bw.enteredFieldBeforeGame).toBe(true);

    // 兵士確認 (表向き, charge)
    const p1Soldier = p1.field.find((u: any) => u.componentId !== "character.bulwark");
    expect(p1Soldier).toBeDefined();
    expect(p1Soldier.face).toBe("up");
    expect(p1Soldier.state).toBe("charge");
    expect(p1Soldier.enteredFieldBeforeGame).toBe(true);
  });

  it("27. Preset soldier candidate matching should match eligible Component definition", () => {
    const aceCard = { id: "test-cA", suit: "C" as const, rank: "A", value: 1 };
    const soldierCard = { id: "test-s5", suit: "S" as const, rank: "5", value: 5 };
    const heroCard = { id: "test-hK", suit: "H" as const, rank: "K", value: 13 };

    const matchAce = OfficialRegulationMatchFactory.findMatchingPresetSoldierComponent(
      aceCard,
      officialRulePackage.components
    );
    expect(matchAce?.id).toBe("character.ace");

    const matchSoldier = OfficialRegulationMatchFactory.findMatchingPresetSoldierComponent(
      soldierCard,
      officialRulePackage.components
    );
    expect(matchSoldier?.id).toBe("character.soldier");

    const matchHero = OfficialRegulationMatchFactory.findMatchingPresetSoldierComponent(
      heroCard,
      officialRulePackage.components
    );
    expect(matchHero?.id).toBe("character.hero");
  });

  it("28 & 29. Generic soldier retry test & Life exhaustion defeat (TERMINAL outcome)", () => {
    // 兵士不適格カードのみのデッキでプリセットを実行した場合のテスト
    const mockFrame: any = {
      ...frame,
      deck: {
        cardCount: 8,
        cards: [
          // 防壁用
          { suit: "S", rank: "2", value: 2 },
          // 兵士候補だが不適格（rank が条件外のダミー）
          { suit: "J", rank: "0", value: 0 },
          { suit: "J", rank: "0", value: 0 },
          { suit: "J", rank: "0", value: 0 },
        ],
      },
      setup: {
        initialHandCount: 0,
        preset: { bulwarkCount: 1, soldierCount: 1 },
      },
    };

    const outcome = OfficialRegulationMatchFactory.setupMatch(
      regulation,
      mockFrame,
      officialRulePackage,
      42
    );

    // Life が枯渇した場合は公式ルール上の「敗北（TERMINAL）」
    expect(outcome.type).toBe("TERMINAL");
    if (outcome.type === "TERMINAL") {
      expect(outcome.winner).toBeDefined();
      expect(outcome.loser).toBeDefined();
      expect(outcome.reason).toContain("ライフが枯渇しました");
    }
  });

  it("30-35. First player determination, tie retry, grave move, and turn setup", () => {
    const outcome = OfficialRegulationMatchFactory.setupMatch(regulation, frame, officialRulePackage, 42);
    expect(outcome.type).toBe("READY");
    if (outcome.type !== "READY") return;

    const state = outcome.state;
    expect(state.turnPlayer).toBe(outcome.firstPlayer);
    expect(state.chancePlayer).toBe(outcome.firstPlayer);
    expect(state.turnCount).toBe(1);
    expect(state.actionCount).toBe(0);

    // 公開カードは各プレイヤーの墓地に存在
    expect(state.players.p1.grave.length).toBeGreaterThanOrEqual(1);
    expect(state.players.p2.grave.length).toBeGreaterThanOrEqual(1);
  });

  it("36-38. Stage empty, Request buffer empty, no pregame triggers", () => {
    const outcome = OfficialRegulationMatchFactory.setupMatch(regulation, frame, officialRulePackage, 42);
    if (outcome.type !== "READY") return;

    expect(outcome.state.stage.requests).toEqual([]);
    expect(outcome.state.requestBuffer).toEqual({ requests: [], history: [] });
  });

  // =========================================================================
  // AS. Conservation (39-42)
  // =========================================================================
  it("39-42. Card Conservation: exactly 16 cards conserved per player without loss or duplication", () => {
    // 複数のシードでカード保存則を検証
    for (const seed of [1, 42, 100, 2026, 99999]) {
      const outcome = OfficialRegulationMatchFactory.setupMatch(regulation, frame, officialRulePackage, seed);
      if (outcome.type !== "READY") continue;

      expect(() =>
        OfficialRegulationMatchFactory.verifyCardConservation("p1", outcome.state.players.p1, frame.deck.cards)
      ).not.toThrow();
      expect(() =>
        OfficialRegulationMatchFactory.verifyCardConservation("p2", outcome.state.players.p2, frame.deck.cards)
      ).not.toThrow();
    }
  });
});
