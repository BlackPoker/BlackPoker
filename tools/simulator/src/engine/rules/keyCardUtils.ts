import { ActionDefinition } from "../../domain/rules/RulePackage";
import { ValidationError } from "./ActionRequestValidator";

export type KeyCardSourceZone = "hand" | "rare";

/**
 * アクション定義からキーカードの供給元ゾーン (key source zone) を解決します。
 * デフォルトは手札 ("hand") です。
 * レアカード関連アクション（レア召喚・罠カウンター等）では、ルール作者公認の正当な例外として
 * コントローラーのレアカード置き場 ("rare") が直接の供給元ゾーンとして明示指定されます。
 * 明示指定がある場合は "hand" または "rare" のみ許可し、未知のゾーン指定は fail-closed で例外をスローします。
 */
export function resolveKeyCardSourceZone(action: ActionDefinition): KeyCardSourceZone {
  if (!action.key) {
    return "hand";
  }

  let specifiedZone: string | undefined;

  if (action.key.condition && typeof action.key.condition === "object") {
    specifiedZone = action.key.condition.card?.zone;
  } else if (action.key.conditions && Array.isArray(action.key.conditions)) {
    for (const cond of action.key.conditions) {
      if (cond.card?.zone) {
        if (specifiedZone && specifiedZone !== cond.card.zone) {
          throw new Error(
            `アクション '${action.id}' の複数キーカード条件で異なるゾーンが混在しています (fail-closed)`
          );
        }
        specifiedZone = cond.card.zone;
      }
    }
  }

  if (!specifiedZone) {
    return "hand";
  }

  if (specifiedZone === "hand" || specifiedZone === "rare") {
    return specifiedZone;
  }

  throw new Error(`未知のキーカード元ゾーンです: '${specifiedZone}' (fail-closed)`);
}

/**
 * 対象プレイヤーの対応ゾーンから物理カード一覧を取得します。
 */
export function getKeyCardsFromSource(player: any, sourceZone: KeyCardSourceZone): any[] {
  if (!player) return [];
  if (sourceZone === "hand") {
    return Array.isArray(player.hand) ? player.hand : [];
  }
  if (sourceZone === "rare") {
    return Array.isArray(player.rareCards) ? player.rareCards : [];
  }
  throw new Error(`未知のキーカード元ゾーンです: '${sourceZone}' (fail-closed)`);
}

/**
 * 対象プレイヤーの対応ゾーンから使用されたキーカードを除去します。
 * 全カードの存在・重複なし・有効ゾーンであることを事前確認し、1枚でも不正なら状態変更せず fail-closed (all-or-nothing)。
 */
export function removeKeyCardsFromSource(
  player: any,
  sourceZone: KeyCardSourceZone,
  cardsToRemove: readonly any[]
): void {
  if (!player) {
    throw new Error("プレイヤーが存在しません (fail-closed)");
  }
  if (cardsToRemove.length === 0) return;

  let sourceCards: any[];
  if (sourceZone === "hand") {
    if (!Array.isArray(player.hand)) {
      throw new Error("プレイヤーの手札が配列ではありません (fail-closed)");
    }
    sourceCards = player.hand;
  } else if (sourceZone === "rare") {
    if (!Array.isArray(player.rareCards)) {
      throw new Error("プレイヤーのレアカード置き場が配列ではありません (fail-closed)");
    }
    sourceCards = player.rareCards;
  } else {
    throw new Error(`未知のキーカード元ゾーンです: '${sourceZone}' (fail-closed)`);
  }

  const seenIds = new Set<string>();
  for (const c of cardsToRemove) {
    if (!c || !c.id) {
      throw new Error("除去対象カードまたはカードIDが不正です (fail-closed)");
    }
    if (seenIds.has(c.id)) {
      throw new Error(`除去対象カードIDに重複が存在します: '${c.id}' (fail-closed)`);
    }
    seenIds.add(c.id);
  }

  const sourceCardIdSet = new Set(sourceCards.map((c: any) => c?.id));
  for (const cardId of seenIds) {
    if (!sourceCardIdSet.has(cardId)) {
      throw new Error(
        `除去対象カード '${cardId}' が元ゾーン '${sourceZone}' に存在しません (fail-closed)`
      );
    }
  }

  // 全て確認できた後に一括で除去 (all-or-nothing)
  if (sourceZone === "hand") {
    player.hand = player.hand.filter((c: any) => !seenIds.has(c.id));
  } else if (sourceZone === "rare") {
    player.rareCards = player.rareCards.filter((c: any) => !seenIds.has(c.id));
  }
}

/**
 * 投入されたキーカードが本当に対象ゾーンに存在するかを検証します。
 */
export function validateKeyCardsInSource(
  player: any,
  sourceZone: KeyCardSourceZone,
  cardsToValidate: readonly any[]
): void {
  if (!player) {
    throw new ValidationError("プレイヤーが存在しません。");
  }
  if (cardsToValidate.length === 0) return;

  let sourceCards: any[];
  if (sourceZone === "hand") {
    if (!Array.isArray(player.hand)) {
      throw new ValidationError("プレイヤーの手札が配列ではありません。");
    }
    sourceCards = player.hand;
  } else if (sourceZone === "rare") {
    if (!Array.isArray(player.rareCards)) {
      throw new ValidationError("プレイヤーのレアカード置き場が配列ではありません。");
    }
    sourceCards = player.rareCards;
  } else {
    throw new ValidationError(`未知のキーカード元ゾーンです: '${sourceZone}'`);
  }

  const seenIds = new Set<string>();
  for (const c of cardsToValidate) {
    if (!c || !c.id) {
      throw new ValidationError("キーカードまたはカードIDが不正です。");
    }
    if (seenIds.has(c.id)) {
      throw new ValidationError(`キーカードIDに重複が存在します: '${c.id}'`);
    }
    seenIds.add(c.id);
  }

  const sourceCardIdSet = new Set(sourceCards.map((c: any) => c?.id));
  for (const cardId of seenIds) {
    if (!sourceCardIdSet.has(cardId)) {
      throw new ValidationError(
        `キーカード '${cardId}' が指定元ゾーン '${sourceZone}' に存在しません。`
      );
    }
  }
}

/**
 * アクション定義からリクエスト時のキーカード公開設定 (visibilityOnRequest) を解決します。
 * "public" または "hidden" (デフォルト) のみ許可し、未知の値は fail-closed で例外をスローします。
 */
export function resolveKeyCardVisibilityOnRequest(action: ActionDefinition): "public" | "hidden" {
  const vis = action.key?.visibilityOnRequest ?? "hidden";
  if (vis === "public" || vis === "hidden") {
    return vis;
  }
  throw new Error(`未知の visibilityOnRequest 指定です: '${vis}' (fail-closed)`);
}
