import { isCanonicalPrintedCard } from "./cardUtils";

export interface ZoneCardValidationOptions {
  readonly requireCanonical?: boolean;
}

/**
 * 簡易カードゾーン（life, hand 等）の物理カード整合性・Canonical検証・一意解決を行う汎用サービス。
 *
 * 契約:
 * 1. ゾーン内の各要素が直接の物理カードオブジェクト（null/undefined不可、Unit wrapper不可）であること。
 * 2. 各カードが非空の文字列 ID を持つこと。
 * 3. ゾーン内でカードIDに重複が存在しないこと（重複時は fail-closed で例外）。
 * 4. 各カードが Canonical Printed Card であること（isCanonicalPrintedCard、fail-closed で例外）。
 * 5. カード解決時は State 所有のオブジェクトそのものを一意に返却すること。
 */
export class ZoneCardResolver {
  /**
   * ゾーンカードの表示名（エラーメッセージ用）を解決します。
   */
  private static getZoneDisplayName(zoneName: string): string {
    switch (zoneName) {
      case "life":
        return "ライフ";
      case "hand":
        return "手札";
      case "grave":
        return "墓地";
      case "pack":
        return "パック";
      case "rare":
      case "rareCards":
        return "レアカード置き場";
      default:
        return zoneName;
    }
  }

  /**
   * 指定ゾーンの物理カード配列を検証・列挙します。
   * 不正なエントリ、Unit wrapper、空ID、重複ID、非Canonicalカードが含まれる場合は fail-closed で例外を送出します。
   */
  static enumerateCanonicalCards(
    cards: readonly any[],
    zoneName: string = "zone",
    options?: ZoneCardValidationOptions
  ): any[] {
    if (!Array.isArray(cards)) {
      throw new Error(`ZoneCardResolver: ゾーン '${zoneName}' が配列ではありません (fail-closed)`);
    }

    const requireCanonical = options?.requireCanonical ?? true;
    const displayName = this.getZoneDisplayName(zoneName);
    const seenIds = new Set<string>();
    const result: any[] = [];

    for (const card of cards) {
      if (!card || typeof card !== "object" || card.unitId || Array.isArray(card.cards) || card.kind) {
        throw new Error(
          `ZoneCardResolver: ${displayName}に不正なエントリまたはUnit wrapperが含まれています (fail-closed)`
        );
      }
      if (typeof card.id !== "string" || card.id.trim() === "") {
        throw new Error(
          `ZoneCardResolver: ${displayName}のカードIDが空または不正です (fail-closed)`
        );
      }
      if (seenIds.has(card.id)) {
        throw new Error(
          `ZoneCardResolver: ${displayName}に重複するカードIDが存在します: '${card.id}' (fail-closed)`
        );
      }
      if (requireCanonical && !isCanonicalPrintedCard(card)) {
        throw new Error(
          `ZoneCardResolver: ${displayName}のカード '${card.id}' がCanonical Printed Cardではありません (fail-closed)`
        );
      }
      seenIds.add(card.id);
      result.push(card);
    }

    return result;
  }

  /**
   * 指定ゾーンから指定された cardId の Canonical な State 所有カードを1件解決します。
   * 0件一致、2件以上一致、不正カード形式の場合は fail-closed で例外を送出します。
   */
  static resolveCanonicalCardById(
    cards: readonly any[],
    cardId: string,
    zoneName: string = "zone",
    options?: ZoneCardValidationOptions
  ): any {
    const displayName = this.getZoneDisplayName(zoneName);
    if (typeof cardId !== "string" || cardId.trim() === "") {
      throw new Error(`ZoneCardResolver: 解決対象カードIDが空または不正です (fail-closed)`);
    }
    if (!Array.isArray(cards)) {
      throw new Error(`ZoneCardResolver: ゾーン '${zoneName}' が配列ではありません (fail-closed)`);
    }

    // ゾーン全体の健全性を fail-closed で事前検証
    const canonicalCards = this.enumerateCanonicalCards(cards, zoneName, options);

    const matches = canonicalCards.filter((c) => c.id === cardId);
    if (matches.length === 0) {
      throw new Error(
        `ZoneCardResolver: ${displayName}に対象カードが見つかりません: '${cardId}' (fail-closed)`
      );
    }
    if (matches.length > 1) {
      throw new Error(
        `ZoneCardResolver: ${displayName}に同一の物理カードID '${cardId}' が複数存在します (fail-closed)`
      );
    }

    return matches[0];
  }

  /**
   * 指定ゾーンから指定された cardId のカードを1件除去して返却します。
   * 0件一致、2件以上一致、不正カード形式の場合は fail-closed で例外を送出し、ゾーンは変更されません。
   */
  static removeCanonicalCardById(
    cards: any[],
    cardId: string,
    zoneName: string = "zone",
    options?: ZoneCardValidationOptions
  ): any {
    const displayName = this.getZoneDisplayName(zoneName);
    if (typeof cardId !== "string" || cardId.trim() === "") {
      throw new Error(`ZoneCardResolver: 除去対象カードIDが空または不正です (fail-closed)`);
    }
    if (!Array.isArray(cards)) {
      throw new Error(`ZoneCardResolver: ゾーン '${zoneName}' が配列ではありません (fail-closed)`);
    }

    // ゾーン全体の健全性を事前検証（重複や不正カードがあれば一切除去しない）
    this.enumerateCanonicalCards(cards, zoneName, options);

    const matchingIndices: number[] = [];
    for (let i = 0; i < cards.length; i++) {
      if (cards[i]?.id === cardId) {
        matchingIndices.push(i);
      }
    }

    if (matchingIndices.length === 0) {
      throw new Error(
        `ZoneCardResolver: ${displayName}に対象カードが見つかりません: '${cardId}' (fail-closed)`
      );
    }
    if (matchingIndices.length > 1) {
      throw new Error(
        `ZoneCardResolver: ${displayName}に同一の物理カードID '${cardId}' が複数存在します (fail-closed)`
      );
    }

    return cards.splice(matchingIndices[0], 1)[0];
  }
}
