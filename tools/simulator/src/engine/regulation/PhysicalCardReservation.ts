import { InGameCard } from "./OfficialRegulationMatchSetup";
import { CardOccurrenceSelection, SimulatorDeckProfile } from "./SimulatorDeckProfileResolver";
import { formatRareCardLabel } from "./RareCardSelectionService";

export interface ReservationValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export interface PlayerPreShuffleSelections {
  readonly scenarioHand?: readonly CardOccurrenceSelection[];
  readonly rareCards?: readonly CardOccurrenceSelection[];
}

export interface PreShuffleReservationOutcome {
  readonly reservedScenarioHandCards: InGameCard[];
  readonly reservedRareCards: InGameCard[];
  readonly remainingDeck: InGameCard[];
}

/**
 * シャッフル前の物理カード予約（シナリオ手札、レアカード）の検証および生デッキからの抽出を行うサービス。
 */
export class PhysicalCardReservation {
  /**
   * シナリオ手札選択を検証します。
   * 要求枚数（例: 3枚）と一致しない場合や、デッキ内に存在しないカード、同一Occurrenceの重複がある場合はエラーを返します。
   */
  public static validateScenarioHandSelections(
    deckProfile: SimulatorDeckProfile,
    scenarioHandCount: number,
    selections?: readonly CardOccurrenceSelection[]
  ): ReservationValidationResult {
    const errors: string[] = [];

    if (!Number.isInteger(scenarioHandCount) || scenarioHandCount < 0) {
      errors.push(`不正な scenarioHandCount です: ${scenarioHandCount}`);
      return { valid: false, errors };
    }

    if (scenarioHandCount === 0) {
      if (selections && selections.length > 0) {
        errors.push("シナリオ手札が不要な環境ですが、選択が指定されています。");
      }
      return { valid: errors.length === 0, errors };
    }

    if (!selections || !Array.isArray(selections)) {
      errors.push("シナリオ手札が選択されていません。");
      return { valid: false, errors };
    }

    if (selections.length !== scenarioHandCount) {
      errors.push(
        `シナリオ手札の枚数が一致しません: 要求 ${scenarioHandCount} 枚に対し ${selections.length} 枚指定されています。`
      );
      return { valid: false, errors };
    }

    // デッキプロファイルに実在するかチェック & occurrence 重複チェック
    const occurrenceMap = new Map<string, number>();
    for (const card of deckProfile.cards) {
      const key = `${card.suit}-${card.rank}`;
      occurrenceMap.set(key, (occurrenceMap.get(key) ?? 0) + 1);
    }

    const seenKeys = new Set<string>();
    for (let i = 0; i < selections.length; i++) {
      const sel = selections[i];
      const occ = sel.occurrence ?? 0;
      if (!Number.isInteger(occ) || occ < 0) {
        errors.push(`不正な occurrence です (index ${i}): ${occ}`);
        continue;
      }

      const baseKey = `${sel.suit}-${sel.rank}`;
      const totalAvailable = occurrenceMap.get(baseKey) ?? 0;
      if (totalAvailable === 0) {
        errors.push(`デッキ内に存在しないカードが指定されています: ${sel.suit}${sel.rank}`);
        continue;
      }
      if (occ >= totalAvailable) {
        errors.push(
          `指定された occurrence (#${occ + 1}) はデッキ内の枚数 (${totalAvailable}枚) を超えています: ${sel.suit}${sel.rank}`
        );
        continue;
      }

      const key = `${baseKey}-${occ}`;
      if (seenKeys.has(key)) {
        errors.push(
          `同一のカードがシナリオ手札内で重複して選択されています: ${formatRareCardLabel(sel.suit, sel.rank, occ)}`
        );
      }
      seenKeys.add(key);
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * シナリオ手札とレアカードの間の相互重複（同一物理Occurrenceの重複）を検証します。
   */
  public static validateMutualExclusion(
    scenarioHand?: readonly CardOccurrenceSelection[],
    rareCards?: readonly CardOccurrenceSelection[]
  ): ReservationValidationResult {
    const errors: string[] = [];
    if (!scenarioHand || !rareCards) return { valid: true, errors: [] };

    const scenarioKeySet = new Set<string>();
    for (const sel of scenarioHand) {
      const occ = sel.occurrence ?? 0;
      scenarioKeySet.add(`${sel.suit}-${sel.rank}-${occ}`);
    }

    for (const sel of rareCards) {
      const occ = sel.occurrence ?? 0;
      const key = `${sel.suit}-${sel.rank}-${occ}`;
      if (scenarioKeySet.has(key)) {
        errors.push(
          `シナリオ手札とレアカードで同一の物理カードが重複して選択されています: ${formatRareCardLabel(sel.suit, sel.rank, occ)}`
        );
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * 生デッキからシナリオ手札およびレアカードをシャッフル前に一括抽出します。
   */
  public static extractReservations(
    rawDeck: InGameCard[],
    selections: PlayerPreShuffleSelections
  ): PreShuffleReservationOutcome {
    const scenarioSelections = selections.scenarioHand ?? [];
    const rareSelections = selections.rareCards ?? [];

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

    const selectedIndexSet = new Set<number>();
    const reservedScenarioHandCards: InGameCard[] = [];
    const reservedRareCards: InGameCard[] = [];

    // シナリオ手札の抽出
    for (const sel of scenarioSelections) {
      const occ = sel.occurrence ?? 0;
      const key = `${sel.suit}-${sel.rank}-${occ}`;
      const rawIndex = cardIndexBySelectionKey.get(key);
      if (rawIndex === undefined) {
        throw new Error(
          `指定されたシナリオ手札カード (${formatRareCardLabel(sel.suit, sel.rank, occ)}) がデッキ内に見つかりません`
        );
      }
      if (selectedIndexSet.has(rawIndex)) {
        throw new Error(`同一の物理カードが重複して選択されました: ${rawDeck[rawIndex].id}`);
      }
      selectedIndexSet.add(rawIndex);
      reservedScenarioHandCards.push(rawDeck[rawIndex]);
    }

    // レアカードの抽出
    for (const sel of rareSelections) {
      const occ = sel.occurrence ?? 0;
      const key = `${sel.suit}-${sel.rank}-${occ}`;
      const rawIndex = cardIndexBySelectionKey.get(key);
      if (rawIndex === undefined) {
        throw new Error(
          `指定されたレアカード (${formatRareCardLabel(sel.suit, sel.rank, occ)}) がデッキ内に見つかりません`
        );
      }
      if (selectedIndexSet.has(rawIndex)) {
        throw new Error(`同一の物理カードが重複して選択されました: ${rawDeck[rawIndex].id}`);
      }
      selectedIndexSet.add(rawIndex);
      reservedRareCards.push(rawDeck[rawIndex]);
    }

    const remainingDeck = rawDeck.filter((_, idx) => !selectedIndexSet.has(idx));

    return {
      reservedScenarioHandCards,
      reservedRareCards,
      remainingDeck,
    };
  }
}

export const validateScenarioHandSelections = PhysicalCardReservation.validateScenarioHandSelections;
export const validateMutualExclusion = PhysicalCardReservation.validateMutualExclusion;
export const extractReservations = PhysicalCardReservation.extractReservations;

