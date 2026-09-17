/**
 * 墓地内の物理カード（直接CardエントリおよびUnit wrapper内包カード）を
 * 汎用的に列挙・検索・抽出するためのユーティリティ群。
 * 既存の player.grave 表現（配列およびwrapper構造）を平坦化（flatten）せず非破壊で扱います。
 */

export interface PhysicalCardLocationDirect {
  readonly type: "direct";
  readonly graveIndex: number;
  readonly card: any;
}

export interface PhysicalCardLocationUnit {
  readonly type: "unit";
  readonly graveIndex: number;
  readonly unit: any;
  readonly cardIndex: number;
  readonly card: any;
}

export type PhysicalCardLocation = PhysicalCardLocationDirect | PhysicalCardLocationUnit;

/**
 * 対象オブジェクトがカード形式であるかを判定します。
 */
export function isCardLike(entry: any): boolean {
  return (
    entry != null &&
    typeof entry === "object" &&
    entry.suit !== undefined &&
    entry.rank !== undefined
  );
}

/**
 * 墓地に存在するすべての物理カードを canonical な順序で列挙します。
 * - 直接カードエントリ: そのカード自身
 * - Unit wrapper: wrapper.cards 配列内の各物理カード
 * - Unit wrapper 自体は候補に含まれません。
 * - 重複した card.id が存在する場合は fail-closed で例外をスローします。
 */
export function enumeratePhysicalCardsInGrave(grave: any[]): any[] {
  if (!Array.isArray(grave)) {
    return [];
  }

  const result: any[] = [];
  const seenCardIds = new Set<string>();

  for (let gIdx = 0; gIdx < grave.length; gIdx++) {
    const entry = grave[gIdx];
    if (!entry) continue;

    if (isCardLike(entry)) {
      const cardId = entry.id;
      if (cardId) {
        if (seenCardIds.has(cardId)) {
          throw new Error(`Grave内に重複したcard.id (${cardId}) が存在します (fail-closed)`);
        }
        seenCardIds.add(cardId);
      }
      result.push(entry);
    } else if (Array.isArray(entry.cards)) {
      for (let cIdx = 0; cIdx < entry.cards.length; cIdx++) {
        const card = entry.cards[cIdx];
        if (!isCardLike(card)) continue;

        const cardId = card.id;
        if (cardId) {
          if (seenCardIds.has(cardId)) {
            throw new Error(`Grave内に重複したcard.id (${cardId}) が存在します (fail-closed)`);
          }
          seenCardIds.add(cardId);
        }
        result.push(card);
      }
    }
  }

  return result;
}

/**
 * 指定された cardId を持つ物理カードの位置を墓地から検索します。
 * 重複が存在する場合は fail-closed で例外をスローします。
 */
export function findPhysicalCardInGrave(grave: any[], cardId: string): PhysicalCardLocation | undefined {
  if (!Array.isArray(grave) || !cardId) {
    return undefined;
  }

  let foundLocation: PhysicalCardLocation | undefined = undefined;

  for (let gIdx = 0; gIdx < grave.length; gIdx++) {
    const entry = grave[gIdx];
    if (!entry) continue;

    if (isCardLike(entry)) {
      if (entry.id === cardId) {
        if (foundLocation) {
          throw new Error(`Grave内に重複したcard.id (${cardId}) が存在します (fail-closed)`);
        }
        foundLocation = {
          type: "direct",
          graveIndex: gIdx,
          card: entry,
        };
      }
    } else if (Array.isArray(entry.cards)) {
      for (let cIdx = 0; cIdx < entry.cards.length; cIdx++) {
        const card = entry.cards[cIdx];
        if (isCardLike(card) && card.id === cardId) {
          if (foundLocation) {
            throw new Error(`Grave内に重複したcard.id (${cardId}) が存在します (fail-closed)`);
          }
          foundLocation = {
            type: "unit",
            graveIndex: gIdx,
            unit: entry,
            cardIndex: cIdx,
            card: card,
          };
        }
      }
    }
  }

  return foundLocation;
}

/**
 * 墓地から指定された cardId の物理カードを1枚だけ安全に取り出します。
 * - 単一カード wrapper または直接カードの場合: 墓地配列からエントリを除去
 * - 複数カード wrapper の場合: wrapper.cards から該当カードのみを除去（残カードが0枚になった場合は wrapper ごと除去）
 * - 対象カードが存在しない場合、または重複が存在する場合は fail-closed で例外をスローします。
 */
export function removePhysicalCardFromGrave(grave: any[], cardId: string): any {
  if (!Array.isArray(grave)) {
    throw new Error("removePhysicalCardFromGrave: grave が配列ではありません (fail-closed)");
  }

  const location = findPhysicalCardInGrave(grave, cardId);
  if (!location) {
    throw new Error(`removePhysicalCardFromGrave: カード (${cardId}) が墓地に存在しません (fail-closed)`);
  }

  if (location.type === "direct") {
    const [card] = grave.splice(location.graveIndex, 1);
    return card;
  } else {
    const unit = location.unit;
    const [card] = unit.cards.splice(location.cardIndex, 1);

    // 空になった Unit wrapper は墓地配列から安全に除去 (empty wrapper removal)
    if (unit.cards.length === 0) {
      grave.splice(location.graveIndex, 1);
    }

    return card;
  }
}

/**
 * 墓地TOP不変条件（Invariant）を検証します。
 */
export function validateGraveTopInvariant(player: any, isPendingDecision: boolean = false): void {
  if (!player || !Array.isArray(player.grave)) return;

  const cards = enumeratePhysicalCardsInGrave(player.grave);

  if (cards.length === 0) {
    if (player.graveTopCardId !== undefined) {
      throw new Error(
        `GraveTopInvariant: 墓地枚数0ですが graveTopCardId (${player.graveTopCardId}) が設定されています (fail-closed)`
      );
    }
    return;
  }

  if (isPendingDecision && player.graveTopCardId === undefined) {
    // Pending Decision 待機中のみ undefined を許容
    return;
  }

  if (!player.graveTopCardId) {
    throw new Error(
      `GraveTopInvariant: 墓地枚数 ${cards.length} ですが graveTopCardId が未設定です (fail-closed)`
    );
  }

  const loc = findPhysicalCardInGrave(player.grave, player.graveTopCardId);
  if (!loc) {
    throw new Error(
      `GraveTopInvariant: graveTopCardId (${player.graveTopCardId}) が墓地に存在しません (fail-closed)`
    );
  }
}

