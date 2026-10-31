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
 * 対象オブジェクトが Unit wrapper 特有の属性 (unitId, cards, kind) を
 * キーとして保持しているかを厳格に判定します (プロパティの存在自体を検査)。
 */
export function hasUnitWrapperProperty(obj: any): boolean {
  if (obj == null || typeof obj !== "object") return false;
  return "unitId" in obj || "cards" in obj || "kind" in obj;
}

/**
 * Unit wrapper 内に内包される物理カードとして有効であるかを厳格に判定します。
 * - 有効な文字列 ID を保持していること。
 * - Unit wrapper 属性 (unitId, cards, kind) がキーとして一切含まれないこと (入れ子 wrapper の fail-closed)。
 */
export function isValidContainedCard(card: any): boolean {
  return (
    card != null &&
    typeof card === "object" &&
    typeof card.id === "string" &&
    card.id.trim().length > 0 &&
    !hasUnitWrapperProperty(card)
  );
}

/**
 * 対象オブジェクトが直接的な物理生カード（direct physical card）であるかを判定します。
 * - 有効な文字列 ID、suit、rank を保持していること。
 * - Unit wrapper 属性 (unitId, cards, kind) を一切含まないこと。
 * - Canonical Normal Card および Canonical Joker と完全な互換性を持ちます。
 */
export function isDirectCard(entry: any): boolean {
  return (
    isValidContainedCard(entry) &&
    entry.suit !== undefined &&
    entry.rank !== undefined
  );
}

/**
 * 対象オブジェクトがカード形式の属性（suit, rank）を備えているかを判定します（後方互換用）。
 * 物理カードとしての直接エントリ判定を行います。
 */
export function isCardLike(entry: any): boolean {
  return isDirectCard(entry);
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

    // 1. Unit wrapper (複数カードまたは単一カードラッパー): 内包する cards を優先走査
    if (Array.isArray(entry.cards)) {
      for (let cIdx = 0; cIdx < entry.cards.length; cIdx++) {
        const card = entry.cards[cIdx];
        // wrapper 内の内包カードも厳格な物理カード検証を実施 (不正なカードや入れ子 wrapper は黙認せず fail-closed)
        if (!isValidContainedCard(card)) {
          throw new Error(
            `enumeratePhysicalCardsInGrave: Grave内のUnit wrapper (${entry.unitId ?? "unknown"}) 内に不正または入れ子Unit wrapperが含まれています (cards[${cIdx}]): ${JSON.stringify(card)} (fail-closed)`
          );
        }

        const cardId = card.id;
        if (cardId) {
          if (seenCardIds.has(cardId)) {
            throw new Error(`Grave内に重複したcard.id (${cardId}) が存在します (fail-closed)`);
          }
          seenCardIds.add(cardId);
        }
        result.push(card);
      }
    } else if (isDirectCard(entry)) {
      // 2. 直接配置された物理生カード
      const cardId = entry.id;
      if (cardId) {
        if (seenCardIds.has(cardId)) {
          throw new Error(`Grave内に重複したcard.id (${cardId}) が存在します (fail-closed)`);
        }
        seenCardIds.add(cardId);
      }
      result.push(entry);
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

    // 1. Unit wrapper 内を優先検索
    if (Array.isArray(entry.cards)) {
      for (let cIdx = 0; cIdx < entry.cards.length; cIdx++) {
        const card = entry.cards[cIdx];
        // 内包カードの整合性を検証 (不正なカード・入れ子 wrapper は fail-closed)
        if (!isValidContainedCard(card)) {
          throw new Error(
            `findPhysicalCardInGrave: Grave内のUnit wrapper (${entry.unitId ?? "unknown"}) 内に不正または入れ子Unit wrapperが含まれています (cards[${cIdx}]): ${JSON.stringify(card)} (fail-closed)`
          );
        }
        if (card.id === cardId) {
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
    } else if (isDirectCard(entry)) {
      // 2. 直接配置された物理生カードを検索
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

