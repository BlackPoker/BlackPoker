import {
  CardOccurrenceSelection,
  SimulatorDeckProfile,
} from "./SimulatorDeckProfileResolver";
import { rankToValue } from "../rules/cardUtils";
import { formatRareCardLabel } from "./RareCardSelectionService";
import {
  PhysicalCardReservation,
  ReservationValidationResult,
} from "./PhysicalCardReservation";
import { SeededRandom } from "../random/RandomSource";
import { deriveSeed, shuffleDeterministic } from "../random/DeterministicShuffle";

export interface ScenarioHandCandidate {
  readonly id: string;
  readonly suit: "S" | "H" | "D" | "C" | "J";
  readonly rank: string;
  readonly value: number;
  readonly occurrence: number;
  readonly displayLabel: string;
}

export interface ResolveAutoSelectionsArgs {
  readonly deckProfile: SimulatorDeckProfile;
  readonly scenarioHandCount: number;
  readonly excludedSelections?: readonly CardOccurrenceSelection[];
  readonly matchSeed: number;
  readonly playerKey: "p1" | "p2";
}

/**
 * デッキプロファイルから選択可能なシナリオ手札候補をデッキ順に列挙します。
 * 同一スート・同一ランクのカード（Joker等）は occurrence (0, 1, ...) で区別されます。
 */
export function enumerateCandidates(
  deckProfile: SimulatorDeckProfile
): readonly ScenarioHandCandidate[] {
  const occurrenceMap = new Map<string, number>();
  return deckProfile.cards.map((card) => {
    const key = `${card.suit}-${card.rank}`;
    const occ = occurrenceMap.get(key) ?? 0;
    occurrenceMap.set(key, occ + 1);
    const val = card.value !== undefined ? card.value : rankToValue(card.rank);
    const label = formatRareCardLabel(card.suit, card.rank, occ);

    return {
      id: `${card.suit}-${card.rank}-${occ}`,
      suit: card.suit,
      rank: card.rank,
      value: val,
      occurrence: occ,
      displayLabel: label,
    };
  });
}

/**
 * シナリオ手札選択を検証します。
 */
export function validateSelections(
  deckProfile: SimulatorDeckProfile,
  scenarioHandCount: number,
  selections?: readonly CardOccurrenceSelection[]
): ReservationValidationResult {
  return PhysicalCardReservation.validateScenarioHandSelections(
    deckProfile,
    scenarioHandCount,
    selections
  );
}

/**
 * AI席用の決定論的シナリオ手札自動選択を行います。
 * - ゲーム本体の山札シャッフルストリームとは独立したシード（`${playerKey}-scenario-hand-auto`）を使用。
 * - excludedSelections（AIのRare Card等）と物理Occurrenceが重複しない候補から決定論的に選出。
 */
export function resolveAutoSelections(
  args: ResolveAutoSelectionsArgs
): readonly CardOccurrenceSelection[] {
  const { deckProfile, scenarioHandCount, excludedSelections, matchSeed, playerKey } = args;

  if (scenarioHandCount <= 0) {
    return [];
  }

  const allCandidates = enumerateCandidates(deckProfile);
  const excludedKeySet = new Set<string>();
  if (excludedSelections) {
    for (const sel of excludedSelections) {
      const occ = sel.occurrence ?? 0;
      excludedKeySet.add(`${sel.suit}-${sel.rank}-${occ}`);
    }
  }

  // 除外カードを取り除いた候補リスト
  const availableCandidates = allCandidates.filter((c) => !excludedKeySet.has(c.id));

  if (availableCandidates.length < scenarioHandCount) {
    throw new Error(
      `利用可能な候補カード数 (${availableCandidates.length}) が必要シナリオ手札数 (${scenarioHandCount}) 未満です`
    );
  }

  // 独立シードによる決定論的シャッフル
  const autoSeed = deriveSeed(matchSeed, `${playerKey}-scenario-hand-auto`);
  const rng = new SeededRandom(autoSeed);
  const shuffled = shuffleDeterministic(availableCandidates, rng);

  return shuffled.slice(0, scenarioHandCount).map((c) => ({
    suit: c.suit,
    rank: c.rank,
    occurrence: c.occurrence,
  }));
}

/**
 * シナリオ手札選択サービス（単一の情報源 / SSOT）。
 */
export class ScenarioHandSelectionService {
  public static enumerateCandidates = enumerateCandidates;
  public static validateSelections = validateSelections;
  public static resolveAutoSelections = resolveAutoSelections;
}
