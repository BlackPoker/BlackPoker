import { ActionDefinition } from "../../domain/rules/RulePackage";
import { ValidationError } from "./ActionRequestValidator";

export type KeyCardSourceZone = "hand" | "rare";

/**
 * アクション定義からキーカードの供給元ゾーン (key source zone) を解決します。
 * デフォルトは "hand"。明示指定がある場合は "hand" または "rare" のみ許可します。
 * 未知のゾーン指定は fail-closed で例外をスローします。
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
 */
export function removeKeyCardsFromSource(
  player: any,
  sourceZone: KeyCardSourceZone,
  cardsToRemove: readonly any[]
): void {
  if (!player || cardsToRemove.length === 0) return;
  const cardIds = new Set(cardsToRemove.map((c: any) => c.id));

  if (sourceZone === "hand") {
    if (Array.isArray(player.hand)) {
      player.hand = player.hand.filter((c: any) => !cardIds.has(c.id));
    }
    return;
  }
  if (sourceZone === "rare") {
    if (Array.isArray(player.rareCards)) {
      player.rareCards = player.rareCards.filter((c: any) => !cardIds.has(c.id));
    }
    return;
  }
  throw new Error(`未知のキーカード元ゾーンです: '${sourceZone}' (fail-closed)`);
}

/**
 * 投入されたキーカードが本当に対象ゾーンに存在するかを検証します。
 */
export function validateKeyCardsInSource(
  player: any,
  sourceZone: KeyCardSourceZone,
  cardsToValidate: readonly any[]
): void {
  if (cardsToValidate.length === 0) return;
  const sourceCards = getKeyCardsFromSource(player, sourceZone);
  const sourceCardIds = new Set(sourceCards.map((c: any) => c.id));

  for (const c of cardsToValidate) {
    if (!c || !sourceCardIds.has(c.id)) {
      throw new ValidationError(
        `キーカード '${c?.id || "unknown"}' が指定元ゾーン '${sourceZone}' に存在しません。`
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
