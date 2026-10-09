import { InGameCard } from "./OfficialRegulationMatchSetup";
import {
  CardOccurrenceSelection,
  SimulatorDeckProfile,
} from "./SimulatorDeckProfileResolver";
import { rankToValue } from "../rules/cardUtils";

export type { CardOccurrenceSelection };

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
 * デッキプロファイルから要求枚数分の決定論的デフォルトレアカード選択を解決します。
 */
export function resolveDefaultRareCardSelections(
  deckProfile: SimulatorDeckProfile,
  rareCardCount: number
): CardOccurrenceSelection[] {
  if (!Number.isInteger(rareCardCount) || rareCardCount <= 0) {
    return [];
  }

  const candidates = enumerateCandidates(deckProfile);
  const selected: CardOccurrenceSelection[] = [];
  const selectedKeys = new Set<string>();

  // 1. deckProfile.defaultRareCardSelections が定義されていれば順次採用
  if (deckProfile.defaultRareCardSelections) {
    for (const sel of deckProfile.defaultRareCardSelections) {
      if (selected.length >= rareCardCount) break;
      const occ = sel.occurrence ?? 0;
      const key = `${sel.suit}-${sel.rank}-${occ}`;
      const exists = candidates.some(
        (c) => c.suit === sel.suit && c.rank === sel.rank && c.occurrence === occ
      );
      if (exists && !selectedKeys.has(key)) {
        selectedKeys.add(key);
        selected.push({
          suit: sel.suit,
          rank: sel.rank,
          occurrence: occ,
        });
      }
    }
  }

  // 2. まだ不足している場合、Joker 候補を優先して決定論的に補完
  if (selected.length < rareCardCount) {
    const jokers = candidates.filter((c) => c.suit === "J" || c.rank === "Joker");
    for (const j of jokers) {
      if (selected.length >= rareCardCount) break;
      const key = `${j.suit}-${j.rank}-${j.occurrence}`;
      if (!selectedKeys.has(key)) {
        selectedKeys.add(key);
        selected.push({ suit: j.suit, rank: j.rank, occurrence: j.occurrence });
      }
    }
  }

  // 3. それでも不足している場合、candidates のデッキ順に先頭から決定論的に補完
  if (selected.length < rareCardCount) {
    for (const c of candidates) {
      if (selected.length >= rareCardCount) break;
      const key = `${c.suit}-${c.rank}-${c.occurrence}`;
      if (!selectedKeys.has(key)) {
        selectedKeys.add(key);
        selected.push({ suit: c.suit, rank: c.rank, occurrence: c.occurrence });
      }
    }
  }

  return selected;
}

/**
 * 生デッキから指定されたレアカードをシャッフル前に取り分けます（公式ルール第9.1.2版 8.3.1.3）。
 * 物理カードの occurrence は常に元の rawDeck の不変な初期インデックスに対して解決されます。
 */
export function extractRareCards(
  rawDeck: InGameCard[],
  selections: readonly CardOccurrenceSelection[]
): { rareCards: InGameCard[]; remainingDeck: InGameCard[] } {
  if (!selections || selections.length === 0) {
    return { rareCards: [], remainingDeck: [...rawDeck] };
  }

  // 1. rawDeck の全カードの物理 occurrence をデッキ順（immutable）にマッピング
  const rawOccurrenceMap = new Map<string, number>();
  const cardIndexBySelectionKey = new Map<string, number>();

  for (let i = 0; i < rawDeck.length; i++) {
    const card = rawDeck[i];
    const baseKey = `${card.suit}-${card.rank}`;
    const occ = rawOccurrenceMap.get(baseKey) ?? 0;
    rawOccurrenceMap.set(baseKey, occ + 1);
    const key = `${baseKey}-${occ}`;
    cardIndexBySelectionKey.set(key, i);
  }

  // 2. 全 selection を検証し、対象の rawDeck index を収集
  const selectedIndexSet = new Set<number>();
  const selectedRareCards: InGameCard[] = [];

  for (const sel of selections) {
    const occTarget = sel.occurrence ?? 0;
    if (!Number.isInteger(occTarget) || occTarget < 0) {
      throw new Error(`不正な occurrence です: ${occTarget}`);
    }

    const key = `${sel.suit}-${sel.rank}-${occTarget}`;
    const rawIndex = cardIndexBySelectionKey.get(key);

    if (rawIndex === undefined) {
      throw new Error(
        `指定された Rare Card (${formatRareCardLabel(sel.suit, sel.rank, occTarget)}) がデッキ内に見つかりません`
      );
    }

    if (selectedIndexSet.has(rawIndex)) {
      throw new Error(
        `同一の Rare Card が重複して選択されました: ${rawDeck[rawIndex].id}`
      );
    }

    selectedIndexSet.add(rawIndex);
    selectedRareCards.push(rawDeck[rawIndex]);
  }

  // 3. remainingDeck を rawDeck の元の順序を維持して構築（選択された index を除外）
  const remainingDeck = rawDeck.filter((_, idx) => !selectedIndexSet.has(idx));

  return { rareCards: selectedRareCards, remainingDeck };
}

/**
 * レアカード選択サービス（単一の情報源 / SSOT）。
 */
export class RareCardSelectionService {
  public static enumerateCandidates = enumerateCandidates;
  public static validateSelections = validateSelections;
  public static extractRareCards = extractRareCards;
  public static formatRareCardLabel = formatRareCardLabel;
  public static resolveDefaultRareCardSelections = resolveDefaultRareCardSelections;
}
