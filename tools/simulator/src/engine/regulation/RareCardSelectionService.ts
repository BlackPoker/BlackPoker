import { InGameCard } from "./OfficialRegulationMatchSetup";
import {
  CardOccurrenceSelection,
  SimulatorDeckProfile,
} from "./SimulatorDeckProfileResolver";
import { rankToValue } from "../rules/cardUtils";

/**
 * レアカード選択候補の定義。
 * デッキプロファイル内の各物理カード（重複 occurrence を含む）を一意に識別します。
 */
export interface RareCardCandidate {
  readonly id: string;
  readonly suit: "S" | "H" | "D" | "C" | "J";
  readonly rank: string;
  readonly value: number;
  readonly occurrence: number;
  readonly displayLabel: string;
}

/**
 * カードの表示用ラベルを生成します。
 */
export function formatRareCardLabel(
  suit: string,
  rank: string,
  occurrence: number = 0
): string {
  const suitSymbol =
    suit === "S"
      ? "♠"
      : suit === "H"
      ? "♥"
      : suit === "D"
      ? "♦"
      : suit === "C"
      ? "♣"
      : "★";
  if (suit === "J" || rank === "Joker") {
    return occurrence > 0 ? `Joker (#${occurrence + 1})` : "Joker";
  }
  const occSuffix = occurrence > 0 ? ` (#${occurrence + 1})` : "";
  return `${suitSymbol}${rank}${occSuffix}`;
}

/**
 * デッキプロファイルから選択可能なレアカード候補をデッキ順に列挙します。
 * 同一スート・同一ランクのカード（Joker等）は occurrence (0, 1, ...) で区別されます。
 */
export function enumerateCandidates(
  deckProfile: SimulatorDeckProfile
): readonly RareCardCandidate[] {
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
 * 指定されたレアカード選択がデッキプロファイルおよび要求枚数に対して合法かを厳格に検証します。
 */
export function validateSelections(
  deckProfile: SimulatorDeckProfile,
  rareCardCount: number,
  selections?: readonly CardOccurrenceSelection[]
): { readonly valid: boolean; readonly errors: readonly string[] } {
  const errors: string[] = [];

  if (!Number.isInteger(rareCardCount) || rareCardCount < 0) {
    errors.push(`不正な rareCardCount です: ${rareCardCount}`);
    return { valid: false, errors };
  }

  if (rareCardCount === 0) {
    if (selections && selections.length > 0) {
      errors.push("レアカードが不要な環境ですが、選択が指定されています。");
    }
    return { valid: errors.length === 0, errors };
  }

  if (!selections || !Array.isArray(selections)) {
    errors.push("レアカードが選択されていません。");
    return { valid: false, errors };
  }

  if (selections.length !== rareCardCount) {
    errors.push(
      `レアカードの指定件数 (${selections.length}) が必要件数 (${rareCardCount}) と一致しません。`
    );
  }

  const candidates = enumerateCandidates(deckProfile);
  const selectedKeys = new Set<string>();

  for (let i = 0; i < selections.length; i++) {
    const sel = selections[i];
    if (!sel || typeof sel !== "object") {
      errors.push(`インデックス ${i} の選択形式が不正です。`);
      continue;
    }

    if (!["S", "H", "D", "C", "J"].includes(sel.suit)) {
      errors.push(`インデックス ${i} のスートが不正です: "${sel.suit}"`);
    }

    if (typeof sel.rank !== "string" || sel.rank.trim() === "") {
      errors.push(`インデックス ${i} のランクが不正です: "${sel.rank}"`);
    }

    const occ = sel.occurrence ?? 0;
    if (!Number.isInteger(occ) || occ < 0) {
      errors.push(`インデックス ${i} の occurrence が不正です: ${occ}`);
      continue;
    }

    const key = `${sel.suit}-${sel.rank}-${occ}`;
    if (selectedKeys.has(key)) {
      errors.push(`同一のレアカードが重複して選択されています: ${key}`);
    }
    selectedKeys.add(key);

    const exists = candidates.some(
      (c) => c.suit === sel.suit && c.rank === sel.rank && c.occurrence === occ
    );
    if (!exists) {
      errors.push(
        `指定されたレアカード (${formatRareCardLabel(sel.suit, sel.rank, occ)}) はデッキ内に存在しません。`
      );
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 生デッキから指定されたレアカードをシャッフル前に取り分けます（公式ルール第9.1.2版 8.3.1.3）。
 */
export function extractRareCards(
  rawDeck: InGameCard[],
  selections: readonly CardOccurrenceSelection[]
): { rareCards: InGameCard[]; remainingDeck: InGameCard[] } {
  if (!selections || selections.length === 0) {
    return { rareCards: [], remainingDeck: [...rawDeck] };
  }

  const selectedRareCards: InGameCard[] = [];
  const remaining = [...rawDeck];
  const selectedIds = new Set<string>();

  for (const sel of selections) {
    const occTarget = sel.occurrence ?? 0;
    if (!Number.isInteger(occTarget) || occTarget < 0) {
      throw new Error(`不正な occurrence です: ${occTarget}`);
    }

    let occCount = 0;
    let foundIndex = -1;
    for (let i = 0; i < remaining.length; i++) {
      const card = remaining[i];
      if (card.suit === sel.suit && card.rank === sel.rank) {
        if (occCount === occTarget) {
          foundIndex = i;
          break;
        }
        occCount++;
      }
    }

    if (foundIndex === -1) {
      throw new Error(
        `指定された Rare Card (${sel.suit}${sel.rank}, occurrence: ${occTarget}) がデッキ内に見つかりません`
      );
    }

    const [card] = remaining.splice(foundIndex, 1);
    if (selectedIds.has(card.id)) {
      throw new Error(`同一の Rare Card が重複して選択されました: ${card.id}`);
    }
    selectedIds.add(card.id);
    selectedRareCards.push(card);
  }

  return { rareCards: selectedRareCards, remainingDeck: remaining };
}

/**
 * レアカード選択サービス（単一の情報源 / SSOT）。
 */
export class RareCardSelectionService {
  public static enumerateCandidates = enumerateCandidates;
  public static validateSelections = validateSelections;
  public static extractRareCards = extractRareCards;
  public static formatRareCardLabel = formatRareCardLabel;
}
