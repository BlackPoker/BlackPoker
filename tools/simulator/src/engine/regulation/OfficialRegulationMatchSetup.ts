import { RulePackage, ComponentDefinition } from "../../domain/rules/RulePackage";
import {
  CardDefinition,
  FrameDefinition,
  RegulationDefinition,
  SetupOutcome,
} from "../../domain/regulation/RegulationDefinition";
import {
  executeFirstPlayerDetermination,
  applyGameStart,
  isFirstPlayerDeterminationExhausted,
  isGameStartDrawLifeExhausted,
} from "../session/setup/commonSetupProcedures";
import { SeededRandom, RandomSource } from "../random/RandomSource";
import { PlayerKey } from "../../domain/decision/DecisionSource";
import { getOpponentPlayerKey } from "../rules/playerUtils";
import { rankToValue, matchesRank } from "../rules/cardUtils";
import {
  SimulatorDeckProfileResolver,
  SimulatorDeckProfile,
  CardOccurrenceSelection,
} from "./SimulatorDeckProfileResolver";
import { RareCardSelectionService } from "./RareCardSelectionService";
import { PhysicalCardReservation } from "./PhysicalCardReservation";

export interface InGameCard {
  readonly id: string;
  readonly suit: "S" | "H" | "D" | "C" | "J";
  readonly rank: string;
  readonly value: number;
}

export interface OfficialRegulationSetupOptions {
  readonly matchId?: string;
  readonly playerNames?: {
    readonly p1?: string;
    readonly p2?: string;
  };
  readonly rareCardSelections?: {
    readonly p1?: readonly CardOccurrenceSelection[];
    readonly p2?: readonly CardOccurrenceSelection[];
  };
  readonly scenarioHandSelections?: {
    readonly p1?: readonly CardOccurrenceSelection[];
    readonly p2?: readonly CardOccurrenceSelection[];
  };
  readonly deckProfile?: SimulatorDeckProfile;
}

import {
  deriveSeed,
  shuffleCards,
  shuffleDeterministic,
  deriveRuntimeShuffleSeed,
} from "../random/DeterministicShuffle";
export { deriveSeed, shuffleCards, shuffleDeterministic, deriveRuntimeShuffleSeed };

/**
 * 候補カードが、選択中の公式 RulePackage 内で「プリセット兵士として適格」な Component に適合するか判定します。
 */
export function findMatchingPresetSoldierComponent(
  card: InGameCard,
  components: readonly ComponentDefinition[]
): ComponentDefinition | undefined {
  return components.find((comp) => {
    if (comp.type !== "character") return false;
    if (comp.properties?.eligibleAsPresetSoldier !== true) return false;

    // unitCondition のカード枚数およびランク条件を検証
    const cond = comp.unitCondition;
    if (!cond || !cond.cards) return false;

    // プリセット兵士は 1枚構成
    if (cond.cards.count !== undefined && cond.cards.count !== 1) return false;
    if (cond.cards.minCount !== undefined && cond.cards.minCount > 1) return false;

    if (cond.cards.rank) {
      return matchesRank(card.rank, card.value, cond.cards.rank);
    }

    return true;
  });
}

/**
 * カード保存則（16枚が全領域で完全保存、消失・重複なし）を検証します。
 */
export function verifyCardConservation(
  playerKey: PlayerKey,
  player: any,
  expectedDeck: readonly CardDefinition[],
  stateOrAdditionalCards?: any
): void {
  const cards: InGameCard[] = [];

  // Life
  if (Array.isArray(player.life)) {
    cards.push(...player.life);
  }
  // Hand
  if (Array.isArray(player.hand)) {
    cards.push(...player.hand);
  }
  // Field
  if (Array.isArray(player.field)) {
    for (const unit of player.field) {
      if (Array.isArray(unit.cards)) {
        cards.push(...unit.cards);
      }
    }
  }
  // Grave
  if (Array.isArray(player.grave)) {
    for (const entry of player.grave) {
      if (Array.isArray(entry.cards)) {
        cards.push(...entry.cards);
      } else if (entry.id && entry.suit && entry.rank) {
        cards.push(entry);
      }
    }
  }
  // Pack
  if (player.pack && Array.isArray(player.pack.cards)) {
    cards.push(...player.pack.cards);
  }
  // Rare Cards
  if (Array.isArray(player.rareCards)) {
    cards.push(...player.rareCards);
  }
  // Fog (キーカード等のカードオブジェクト)
  if (Array.isArray(player.fog)) {
    for (const fogEntry of player.fog) {
      if (fogEntry.card && fogEntry.card.id) {
        cards.push(fogEntry.card);
      }
    }
  }
  // Stage Key Cards (リクエスト中に一時保持されているカード)
  if (stateOrAdditionalCards) {
    if (Array.isArray(stateOrAdditionalCards)) {
      cards.push(...stateOrAdditionalCards);
    } else if (stateOrAdditionalCards.stage && Array.isArray(stateOrAdditionalCards.stage.requests)) {
      for (const req of stateOrAdditionalCards.stage.requests) {
        if (req.controller === playerKey && Array.isArray(req.keyCards)) {
          cards.push(...req.keyCards);
        }
      }
    }
  }

  if (cards.length !== expectedDeck.length) {
    throw new Error(
      `Card conservation violated for ${playerKey}: expected ${expectedDeck.length} cards, but found ${cards.length}`
    );
  }

  // ID 一意性チェック
  const idSet = new Set<string>();
  for (const c of cards) {
    if (idSet.has(c.id)) {
      throw new Error(`Duplicate card identity detected for ${playerKey}: card ID ${c.id}`);
    }
    idSet.add(c.id);
  }

  // suit + rank マルチセット突合
  const getMultisetKey = (c: { suit: string; rank: string }) => `${c.suit.toUpperCase()}-${String(c.rank).toUpperCase()}`;
  const expectedKeys = expectedDeck.map(getMultisetKey).sort();
  const actualKeys = cards.map(getMultisetKey).sort();

  if (expectedKeys.join(",") !== actualKeys.join(",")) {
    throw new Error(
      `Card multiset mismatch for ${playerKey}: expected [${expectedKeys.join(",")}], actual [${actualKeys.join(",")}]`
    );
  }
}

/**
 * ブラウザ環境・Node.js環境双方から安全に利用可能な公式レギュレーション初期盤面セットアップ。
 * （fs/path 等の Node.js 依存を一切含みません）
 */
export class OfficialRegulationMatchSetup {
  public static findMatchingPresetSoldierComponent = findMatchingPresetSoldierComponent;
  public static verifyCardConservation = verifyCardConservation;

  /**
   * 共通プリセットや先攻決定を行う前の、初期ゾーン配分完了時点の GameState ドラフトを構築します。
   * Strategy Frame 等の配分検証（Pack 14, Rare 1, Life 32, Hand 7）に利用可能です。
   */
  public static setupDraftZones(
    regulation: RegulationDefinition,
    frame: FrameDefinition,
    matchSeed: number,
    options?: OfficialRegulationSetupOptions
  ): any {
    const matchId = options?.matchId || `match-official-${matchSeed}`;
    const p1Name = options?.playerNames?.p1 || "Player A";
    const p2Name = options?.playerNames?.p2 || "Player B";

    // 1. デッキプロファイル解決 (SSOT) から P1, P2 のデッキを生成 (ID 一意化)
    const deckProfile = options?.deckProfile ?? SimulatorDeckProfileResolver.resolveDeckProfile(frame, regulation.id);
    const expectedDeck = deckProfile.cards;

    const buildDeck = (playerKey: PlayerKey): InGameCard[] => {
      const occurrenceMap = new Map<string, number>();
      return expectedDeck.map((c) => {
        const key = `${c.suit}-${c.rank}`;
        const occ = occurrenceMap.get(key) ?? 0;
        occurrenceMap.set(key, occ + 1);
        const occSuffix = occ > 0 ? `#${occ}` : "";
        return {
          id: `${playerKey}-c-${c.suit}${c.rank}${occSuffix}`,
          suit: c.suit,
          rank: c.rank,
          value: c.value !== undefined ? c.value : rankToValue(c.rank),
        };
      });
    };

    const p1RawDeck = buildDeck("p1");
    const p2RawDeck = buildDeck("p2");

    // 2. シャッフル前予約 (Pre-shuffle Reservation) の検証と抽出
    const scenarioHandCount = frame.setup.scenarioHandCount ?? 0;
    if (!Number.isInteger(scenarioHandCount) || scenarioHandCount < 0) {
      throw new Error(`不正な scenarioHandCount です: ${scenarioHandCount}`);
    }

    const rareCardCount = frame.setup.rareCardCount ?? 0;
    if (!Number.isInteger(rareCardCount) || rareCardCount < 0) {
      throw new Error(`不正な rareCardCount です: ${rareCardCount}`);
    }

    // シナリオ手札のバリデーション (Fail-closed: 要求枚数に対して未指定または枚数不一致なら即座にエラー)
    if (scenarioHandCount > 0) {
      const p1ScenarioVal = PhysicalCardReservation.validateScenarioHandSelections(
        deckProfile,
        scenarioHandCount,
        options?.scenarioHandSelections?.p1
      );
      if (!p1ScenarioVal.valid) {
        throw new Error(`Player A のシナリオ手札選択エラー: ${p1ScenarioVal.errors.join(", ")}`);
      }
      const p2ScenarioVal = PhysicalCardReservation.validateScenarioHandSelections(
        deckProfile,
        scenarioHandCount,
        options?.scenarioHandSelections?.p2
      );
      if (!p2ScenarioVal.valid) {
        throw new Error(`Player B のシナリオ手札選択エラー: ${p2ScenarioVal.errors.join(", ")}`);
      }
    }

    // レアカードのバリデーション
    const p1RareSelections = options?.rareCardSelections?.p1 ?? deckProfile.defaultRareCardSelections;
    const p2RareSelections = options?.rareCardSelections?.p2 ?? deckProfile.defaultRareCardSelections;

    const p1RareVal = RareCardSelectionService.validateSelections(deckProfile, rareCardCount, p1RareSelections);
    if (!p1RareVal.valid) {
      throw new Error(`Player A の Rare Card 選択エラー: ${p1RareVal.errors.join(", ")}`);
    }
    const p2RareVal = RareCardSelectionService.validateSelections(deckProfile, rareCardCount, p2RareSelections);
    if (!p2RareVal.valid) {
      throw new Error(`Player B の Rare Card 選択エラー: ${p2RareVal.errors.join(", ")}`);
    }

    // シナリオ手札とレアカードの相互重複排他チェック (同一 Occurrence の重複禁止)
    if (scenarioHandCount > 0 && rareCardCount > 0) {
      const p1MutualVal = PhysicalCardReservation.validateMutualExclusion(
        options?.scenarioHandSelections?.p1,
        p1RareSelections
      );
      if (!p1MutualVal.valid) {
        throw new Error(`Player A の物理カード重複エラー: ${p1MutualVal.errors.join(", ")}`);
      }
      const p2MutualVal = PhysicalCardReservation.validateMutualExclusion(
        options?.scenarioHandSelections?.p2,
        p2RareSelections
      );
      if (!p2MutualVal.valid) {
        throw new Error(`Player B の物理カード重複エラー: ${p2MutualVal.errors.join(", ")}`);
      }
    }

    // 予約カードの抽出 (Pre-shuffle Reservation)
    let p1RareCards: InGameCard[] = [];
    let p2RareCards: InGameCard[] = [];
    let p1ScenarioCards: InGameCard[] = [];
    let p2ScenarioCards: InGameCard[] = [];
    let p1RemainingDeck: InGameCard[];
    let p2RemainingDeck: InGameCard[];

    if (scenarioHandCount > 0) {
      const p1Outcome = PhysicalCardReservation.extractReservations(p1RawDeck, {
        scenarioHand: options?.scenarioHandSelections?.p1,
        rareCards: p1RareSelections,
      });
      const p2Outcome = PhysicalCardReservation.extractReservations(p2RawDeck, {
        scenarioHand: options?.scenarioHandSelections?.p2,
        rareCards: p2RareSelections,
      });
      p1ScenarioCards = p1Outcome.reservedScenarioHandCards;
      p2ScenarioCards = p2Outcome.reservedScenarioHandCards;
      p1RareCards = p1Outcome.reservedRareCards;
      p2RareCards = p2Outcome.reservedRareCards;
      p1RemainingDeck = p1Outcome.remainingDeck;
      p2RemainingDeck = p2Outcome.remainingDeck;
    } else {
      const p1RareResult = RareCardSelectionService.extractRareCards(p1RawDeck, p1RareSelections ?? []);
      const p2RareResult = RareCardSelectionService.extractRareCards(p2RawDeck, p2RareSelections ?? []);
      p1RareCards = p1RareResult.rareCards;
      p2RareCards = p2RareResult.rareCards;
      p1RemainingDeck = p1RareResult.remainingDeck;
      p2RemainingDeck = p2RareResult.remainingDeck;
    }

    // 3. 独立した乱数ストリームで Seeded Shuffle (P1, P2 それぞれ独立)
    const p1Rng = new SeededRandom(deriveSeed(matchSeed, "p1-deck"));
    const p2Rng = new SeededRandom(deriveSeed(matchSeed, "p2-deck"));

    const p1Shuffled = shuffleCards(p1RemainingDeck, p1Rng);
    const p2Shuffled = shuffleCards(p2RemainingDeck, p2Rng);

    // 4. 初期配置 (Pack & Life)
    let p1Pack: any = undefined;
    let p2Pack: any = undefined;
    let p1Life: InGameCard[];
    let p2Life: InGameCard[];

    if (frame.setup.packCount !== undefined && frame.setup.packCount > 0) {
      const p1PackCards = p1Shuffled.slice(0, frame.setup.packCount);
      const p2PackCards = p2Shuffled.slice(0, frame.setup.packCount);
      p1Pack = { count: p1PackCards.length, opened: false, cards: p1PackCards };
      p2Pack = { count: p2PackCards.length, opened: false, cards: p2PackCards };
      p1Life = p1Shuffled.slice(frame.setup.packCount);
      p2Life = p2Shuffled.slice(frame.setup.packCount);
    } else {
      p1Life = p1Shuffled;
      p2Life = p2Shuffled;
    }

    // Setup Draft 時点ではゲーム開始情報を確定させず、未開始状態 (Pregame State) とする
    const state: any = {
      stateVersion: 1,
      version: 1,
      matchId,
      regulationId: regulation.id,
      formatId: regulation.formatId,
      frameId: regulation.frameId,
      turnPlayer: undefined,
      chancePlayer: undefined,
      turnCount: 0,
      actionCount: 0,
      stage: { requests: [] },
      requestBuffer: { requests: [], history: [] },
      players: {
        p1: {
          name: p1Name,
          life: p1Life,
          hand: [],
          field: [],
          grave: [],
          fog: [],
          trump: [],
          pack: p1Pack,
          rareCards: p1RareCards,
        },
        p2: {
          name: p2Name,
          life: p2Life,
          hand: [],
          field: [],
          grave: [],
          fog: [],
          trump: [],
          pack: p2Pack,
          rareCards: p2RareCards,
        },
      },
    };

    const p1 = state.players.p1;
    const p2 = state.players.p2;

    // 5. 初期手札配分
    // Strategy では randomInitialHandCount (initialHandCount - scenarioHandCount = 7 - 3 = 4枚) を Life から引き、
    // 予約した Scenario Hand 3枚を追加して合計 7枚とする。
    // scenarioHandCount が未定義または 0 の場合は initialHandCount (7枚) すべてを Life から引く（完全後方互換）。
    const randomInitialHandCount = frame.setup.initialHandCount - scenarioHandCount;
    for (let i = 0; i < randomInitialHandCount; i++) {
      p1.hand.push(p1.life.shift());
      p2.hand.push(p2.life.shift());
    }

    if (p1ScenarioCards.length > 0) {
      p1.hand.push(...p1ScenarioCards);
    }
    if (p2ScenarioCards.length > 0) {
      p2.hand.push(...p2ScenarioCards);
    }

    return state;
  }

  /**
   * 公式ゲーム開始手順（公式ルール第9.1.2版 3.9 & 8.3.1.1）を実行し、ゲーム初期状態を構築します。
   */
  public static setupMatch(
    regulation: RegulationDefinition,
    frame: FrameDefinition,
    rulePackage: RulePackage,
    matchSeed: number,
    options?: OfficialRegulationSetupOptions
  ): SetupOutcome {
    const deckProfile = options?.deckProfile ?? SimulatorDeckProfileResolver.resolveDeckProfile(frame, regulation.id);
    const expectedDeck = deckProfile.cards;

    const state = OfficialRegulationMatchSetup.setupDraftZones(regulation, frame, matchSeed, options);
    const p1 = state.players.p1;
    const p2 = state.players.p2;

    // 5. 共通プリセット (3.9.1)
    for (const playerKey of ["p1", "p2"] as const) {
      const player = state.players[playerKey];

      // 5-1. 防壁プリセット (裏向き, enteredFieldBeforeGame = true)
      if (player.life.length === 0) {
        const winner = getOpponentPlayerKey(playerKey, state);
        return {
          type: "TERMINAL",
          winner,
          loser: playerKey,
          reason: `プリセット防壁配置中に ${player.name} のライフが枯渇しました`,
        };
      }
      const bulwarkCard = player.life.shift();
      player.field.push({
        unitId: `bw-${playerKey}-preset`,
        kind: "防壁",
        componentId: "character.bulwark",
        state: "charge",
        face: "down",
        cards: [bulwarkCard],
        labels: ["防御"],
        enteredFieldBeforeGame: true,
        enteredFieldTurn: 0,
        enteredTurn: 0,
      });

      // 5-2. 兵士プリセット (RulePackage の eligibleAsPresetSoldier 属性を持つ Component に適合するか検証)
      let soldierPlaced = false;
      let discardIndex = 0;
      while (!soldierPlaced) {
        if (player.life.length === 0) {
          // 公式ルール上の敗北（技術的エラーではない）
          const winner = getOpponentPlayerKey(playerKey, state);
          return {
            type: "TERMINAL",
            winner,
            loser: playerKey,
            reason: `プリセット兵士配置中に ${player.name} のライフが枯渇しました`,
          };
        }

        const candidateCard = player.life.shift();
        const matchedComp = findMatchingPresetSoldierComponent(candidateCard, rulePackage.components);

        if (matchedComp) {
          const kind = matchedComp.display?.kind || matchedComp.name || "兵士";
          const labels = matchedComp.properties?.labels || matchedComp.display?.labels || ["攻撃", "防御"];

          player.field.push({
            unitId: `soldier-${playerKey}-preset`,
            kind,
            componentId: matchedComp.id,
            state: "charge",
            face: "up",
            cards: [candidateCard],
            labels: [...labels],
            enteredFieldBeforeGame: true,
            enteredFieldTurn: 0,
            enteredTurn: 0,
          });
          soldierPlaced = true;
        } else {
          // 不適格カードは墓地へ送り再試行 (決定論的 ID 生成)
          player.grave.push({
            unitId: `unit-preset-discard-${playerKey}-${candidateCard.id}-${discardIndex}`,
            id: candidateCard.id,
            suit: candidateCard.suit,
            rank: candidateCard.rank,
            value: candidateCard.value,
            kind: "墓地カード",
            cards: [candidateCard],
            labels: [],
          });
          player.graveTopCardId = candidateCard.id;
          discardIndex++;
        }
      }
    }

    // 6. 先攻決定 (3.9.2 共通プロシージャ)
    const determination = executeFirstPlayerDetermination(p1, p2);
    if (isFirstPlayerDeterminationExhausted(determination)) {
      return {
        type: "RULE_UNSPECIFIED",
        reasonCode: determination.reasonCode,
        reason: determination.reason,
        exhaustedPlayers: determination.exhaustedPlayers,
      };
    }

    // 7. ゲーム開始 (3.9.3 共通プロシージャ)
    const gameStart = applyGameStart(state, determination.firstPlayer);
    if (isGameStartDrawLifeExhausted(gameStart)) {
      return {
        type: "RULE_UNSPECIFIED",
        reasonCode: gameStart.reasonCode,
        reason: gameStart.reason,
        exhaustedPlayers: gameStart.exhaustedPlayers,
        affectedPlayer: gameStart.affectedPlayer,
      };
    }

    // 8. カード保存則検証
    verifyCardConservation("p1", p1, expectedDeck);
    verifyCardConservation("p2", p2, expectedDeck);

    return {
      type: "READY",
      state: gameStart.state,
      firstPlayer: determination.firstPlayer,
    };
  }
}
