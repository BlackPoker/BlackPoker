import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import {
  loadRegulationCatalog,
  clearRegulationCache,
} from "../../engine/regulation/RegulationLoader";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { CommandRegistry } from "../../engine/rules/CommandRegistry";
import { EffectInterpreter } from "../../engine/rules/EffectInterpreter";
import { ExpressionEvaluator } from "../../engine/rules/ExpressionEvaluator";
import {
  enumeratePhysicalCardsInGrave,
  findPhysicalCardInGrave,
  removePhysicalCardFromGrave,
  isDirectCard,
  isCardLike,
  hasUnitWrapperProperty,
} from "../../engine/rules/graveCardUtils";
import { GraveTopCoordinator } from "../../engine/rules/GraveTopCoordinator";
import { moveUnitToHand } from "../../engine/rules/unitMovementUtils";
import { OfficialRegulationMatchFactory } from "../../engine/regulation/OfficialRegulationMatchFactory";
import { deriveSeed } from "../../engine/random/DeterministicShuffle";
import { SimulationRunner } from "../../engine/simulation/SimulationRunner";
import { GenomePolicy } from "../../engine/ai/GenomePolicy";
import { loadAndValidateEvolutionG1BestDNA } from "../../engine/ai/EvolutionDNALoader";
import { GeneticMutation } from "../../engine/ai/GeneticMutation";
import { DEFAULT_GENETIC_OPERATOR_CONFIG } from "../../domain/ai/GeneticOperatorTypes";
import { createManualGenericGenomeDNA } from "../../engine/ai/BaselinePolicies";
import { moveCardHandler } from "../../engine/rules/commandHandlers";

describe("Production Core Regression R3 Tests (BP-SIM-AI-V92-STANDARD-PACK-EVOLUTION-PILOT-V1-R3-CORE-FIX)", () => {
  let registry: CommandRegistry;
  let interpreter: EffectInterpreter;

  beforeAll(async () => {
    clearRegulationCache();
    registry = new CommandRegistry();
    interpreter = {
      dispatchEvent: (_event: any, _context: any) => {},
    } as any;
    registry.register("moveCard", moveCardHandler(interpreter));
  });

  // =========================================================================
  // ケース 1: wrapper の ID と物理カードの ID が一致する場合、物理カードは合法に移動できる
  // =========================================================================
  it("Case 1: When wrapper ID and physical card ID match (first-draw wrapper), physical card can be legally moved via moveCard", () => {
    const rawCard = { id: "p1-c-CJ", suit: "C", rank: "J", value: 11 };
    const firstDrawWrapper = {
      unitId: "unit-first-draw-p1-c-CJ",
      id: "p1-c-CJ",
      suit: "C",
      rank: "J",
      value: 11,
      cards: [rawCard],
      kind: "墓地カード",
      labels: [],
    };

    const state: any = {
      stateVersion: 1,
      players: {
        p1: {
          grave: [firstDrawWrapper],
          hand: [],
          life: [],
          graveTopCardId: "p1-c-CJ",
        },
      },
    };

    // 物理カード ID "p1-c-CJ" を指定して移動を実行
    registry.execute(
      "moveCard",
      {
        from: "grave",
        to: "hand",
        card: "p1-c-CJ",
      },
      { playerKey: "p1", state } as any
    );

    // 墓地の空ラッパーは自動除去され、手札に純粋な物理生カードのみが移動すること
    expect(state.players.p1.grave).toHaveLength(0);
    expect(state.players.p1.hand).toHaveLength(1);
    const handCard = state.players.p1.hand[0];
    expect(handCard.id).toBe("p1-c-CJ");
    expect(handCard.suit).toBe("C");
    expect(handCard.rank).toBe("J");
    expect(handCard.unitId).toBeUndefined();
    expect(handCard.cards).toBeUndefined();
    expect(handCard.kind).toBeUndefined();
    expect(hasUnitWrapperProperty(handCard)).toBe(false);
  });

  // =========================================================================
  // ケース 2: wrapper の unitId を直接指定した移動は拒絶される (fail-closed)
  // =========================================================================
  it("Case 2: When wrapper unitId is directly specified, moveCard rejects it with fail-closed exception", () => {
    const rawCard = { id: "p1-c-CJ", suit: "C", rank: "J", value: 11 };
    const firstDrawWrapper = {
      unitId: "unit-first-draw-p1-c-CJ",
      id: "p1-c-CJ",
      suit: "C",
      rank: "J",
      value: 11,
      cards: [rawCard],
      kind: "墓地カード",
      labels: [],
    };

    const state: any = {
      stateVersion: 1,
      players: {
        p1: {
          grave: [firstDrawWrapper],
          hand: [],
          life: [],
          graveTopCardId: "p1-c-CJ",
        },
      },
    };

    // wrapper の unitId を指定して moveCard を実行した場合は例外
    expect(() =>
      registry.execute(
        "moveCard",
        {
          from: "grave",
          to: "hand",
          card: "unit-first-draw-p1-c-CJ",
        },
        { playerKey: "p1", state } as any
      )
    ).toThrow("moveCard: 墓地内のUnit wrapperまたは未対応形式のエントリは移動できません: unit-first-draw-p1-c-CJ");

    // 通常のユニット（例: soldier-1）の unitId を指定した場合も同様に拒絶されること
    const soldierWrapper = {
      unitId: "soldier-p1-1",
      cards: [{ id: "c-soldier", suit: "S", rank: "A", value: 1 }],
    };
    state.players.p1.grave = [soldierWrapper];
    expect(() =>
      registry.execute(
        "moveCard",
        {
          from: "grave",
          to: "hand",
          card: "soldier-p1-1",
        },
        { playerKey: "p1", state } as any
      )
    ).toThrow("moveCard: 墓地内のUnit wrapperまたは未対応形式のエントリは移動できません: soldier-p1-1");
  });

  // =========================================================================
  // ケース 3: 不正な wrapper 入れ子構造は fail-closed となる (黙認・スキップ禁止)
  // =========================================================================
  it("Case 3: Malformed nested wrapper in grave is not silently skipped and causes immediate fail-closed exception", () => {
    // wrapper の cards 配列内に、さらに wrapper 属性を持つ不正オブジェクトが入れ子になっている構造
    const nestedWrapper = {
      unitId: "u-outer",
      cards: [
        {
          unitId: "u-inner",
          id: "c-nested",
          suit: "S",
          rank: "A",
          cards: [],
        },
      ],
    };

    const corruptGrave = [nestedWrapper];

    expect(() => enumeratePhysicalCardsInGrave(corruptGrave)).toThrow(
      "enumeratePhysicalCardsInGrave: Grave内のUnit wrapper (u-outer) 内に不正または入れ子Unit wrapperが含まれています"
    );

    expect(() => findPhysicalCardInGrave(corruptGrave, "c-nested")).toThrow(
      "findPhysicalCardInGrave: Grave内のUnit wrapper (u-outer) 内に不正または入れ子Unit wrapperが含まれています"
    );
  });

  // =========================================================================
  // ケース 4: 正常な複数カード Unit の抽出と墓地 TOP 更新は従来どおり動作する
  // =========================================================================
  it("Case 4: Multi-card unit extraction correctly updates grave TOP and removes wrapper when empty", () => {
    const c1 = { id: "c-armed-1", suit: "C", rank: "9", value: 9 };
    const c2 = { id: "c-armed-2", suit: "S", rank: "J", value: 11 };
    const armedUnit = {
      unitId: "u-armed-soldier",
      cards: [c1, c2],
    };

    const state: any = {
      stateVersion: 1,
      players: {
        p1: {
          grave: [armedUnit],
          graveTopCardId: "c-armed-2",
        },
      },
    };

    // 1枚目 (c2: 現在のTOP) を抽出
    const removedTop = GraveTopCoordinator.removeCardFromGrave(
      state.players.p1,
      "c-armed-2",
      state,
      "p1"
    );

    expect(removedTop.id).toBe("c-armed-2");
    // 残存1枚 (c1) に自動TOP昇格 (Rule 20)
    expect(state.players.p1.graveTopCardId).toBe("c-armed-1");
    // wrapper はまだ c1 を保持しているため墓地に残る
    expect(state.players.p1.grave).toHaveLength(1);
    expect(state.players.p1.grave[0].cards).toHaveLength(1);
    expect(state.players.p1.grave[0].cards[0].id).toBe("c-armed-1");

    // 2枚目 (c1: 最後のカード) を抽出
    const removedLast = GraveTopCoordinator.removeCardFromGrave(
      state.players.p1,
      "c-armed-1",
      state,
      "p1"
    );

    expect(removedLast.id).toBe("c-armed-1");
    // 残存0枚のため TOP は undefined
    expect(state.players.p1.graveTopCardId).toBeUndefined();
    // 空になった wrapper は墓地から自動除去される
    expect(state.players.p1.grave).toHaveLength(0);
  });

  // =========================================================================
  // ケース 5: 正常な Joker、通常カードの墓地操作互換性
  // =========================================================================
  it("Case 5: Canonical Joker and Normal cards are correctly recognized by isDirectCard and grave utilities", () => {
    const normalCard = { id: "c-norm", suit: "H", rank: "10", value: 10 };
    const jokerCard = { id: "c-joker", suit: "joker", rank: "JOKER", value: 0 };

    expect(isDirectCard(normalCard)).toBe(true);
    expect(isDirectCard(jokerCard)).toBe(true);
    expect(isCardLike(normalCard)).toBe(true);
    expect(isCardLike(jokerCard)).toBe(true);

    const grave = [normalCard, jokerCard];
    const cards = enumeratePhysicalCardsInGrave(grave);
    expect(cards).toHaveLength(2);
    expect(cards.map((c) => c.id)).toEqual(["c-norm", "c-joker"]);

    const locJoker = findPhysicalCardInGrave(grave, "c-joker");
    expect(locJoker).toBeDefined();
    expect(locJoker?.type).toBe("direct");
    expect(locJoker?.card.id).toBe("c-joker");

    const extractedJoker = removePhysicalCardFromGrave(grave, "c-joker");
    expect(extractedJoker.id).toBe("c-joker");
    expect(grave).toHaveLength(1);
    expect(grave[0].id).toBe("c-norm");
  });

  // =========================================================================
  // ケース 6: moveUnitToHand の不正 wrapper 厳格 fail-closed 検証
  // =========================================================================
  it("Case 6: moveUnitToHand throws fail-closed exception when unit card contains wrapper attributes", () => {
    const invalidCardWithUnitId = {
      id: "c-bad-1",
      suit: "S",
      rank: "A",
      unitId: "unit-corrupt",
    };

    const mockUnit: any = {
      unitId: "unit-test-hero",
      cards: [invalidCardWithUnitId],
    };

    const state: any = {
      stateVersion: 1,
      players: {
        p1: {
          field: [mockUnit],
          hand: [],
        },
      },
    };

    expect(() =>
      moveUnitToHand(mockUnit, "p1", state, interpreter, {})
    ).toThrow("moveUnitToHand: ユニット (unit-test-hero) のカード構成に不正なUnit wrapper属性 (unitId, cards, kind) が含まれています");
  });

  // =========================================================================
  // ケース 7: Seed 92023 のリアニメイト・帰還フローの完走 (実機シミュレーション)
  // =========================================================================
  it("Case 7: Seed 92023 Leg 0 successfully completes simulation without fail-closed exception", async () => {
    const REGULATION_ID = "standard-pack";
    const catalog = await loadRegulationCatalog();
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    const fullRulePackage = await loadRulePackageFromDirectory(rulesDir);

    const sessionFactory = await OfficialRegulationMatchFactory.prepareSessionFactory(REGULATION_ID, {
      catalog,
      fullRulePackage,
    });

    const CAMPAIGN_SEED = 20261031;
    const manualDna = createManualGenericGenomeDNA();
    const mutSeedB = deriveSeed(CAMPAIGN_SEED, "mut-sp-004");
    const mutatedWeightsB = GeneticMutation.mutate(
      {
        patternWeights: manualDna.patternWeights,
        contextPatternWeights: manualDna.contextPatternWeights,
      },
      mutSeedB,
      DEFAULT_GENETIC_OPERATOR_CONFIG
    );
    const candidateDna: any = {
      ...manualDna,
      metadata: {
        id: "genome-sp-g0-004",
        name: "Mutated-ManualGeneric-B",
      },
      patternWeights: mutatedWeightsB.patternWeights,
      contextPatternWeights: mutatedWeightsB.contextPatternWeights,
    };

    const transferDna = loadAndValidateEvolutionG1BestDNA();

    const seed = 92023;
    const leg = 0; // Candidate as p1, transfer as p2
    const matchContext = {
      matchIndex: leg,
      matchId: `val-candidate-vs-transfer-g1-best-s${seed}-leg${leg + 1}`,
      baseSeed: seed,
      matchSeed: seed,
      playerSeeds: {
        p1: deriveSeed(seed, "p1"),
        p2: deriveSeed(seed, "p2"),
      },
    };

    const session = sessionFactory(matchContext);

    const policies = {
      p1: new GenomePolicy(candidateDna),
      p2: new GenomePolicy(transferDna),
    };

    // 修正前はここで findSelectableCards: 手札に不正なエントリまたはUnit wrapperが含まれています (fail-closed)
    // が Turn 4, Decision #57 直後に発生していた
    const simRes = SimulationRunner.run(session, policies, {
      maxDecisions: 500,
      enableSemanticDiagnostics: true,
    });

    expect(simRes.completed).toBe(true);
    expect(simRes.winner).toBeDefined();
    // 試合終了時の手札の全カードが Canonical かつ wrapper 属性を持たないことを確認
    for (const pid of ["p1", "p2"] as const) {
      const p = session.state.players[pid];
      for (const card of p.hand) {
        expect(hasUnitWrapperProperty(card)).toBe(false);
      }
    }
  });
});
