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
 * 全カードの存在・重複なし・有効ゾーン・一意であることを事前確認し、1枚でも不正なら状態変更せず fail-closed (all-or-nothing)。
 */
export function removeKeyCardsFromSource(
  player: any,
  sourceZone: KeyCardSourceZone,
  cardsToRemove: readonly any[]
): void {
  if (!player) {
    throw new Error("プレイヤーが存在しません (fail-closed)");
  }
  if (!cardsToRemove || cardsToRemove.length === 0) return;

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
    if (!c || typeof c.id !== "string" || c.id.trim() === "") {
      throw new Error("除去対象カードまたはカードIDが不正です (fail-closed)");
    }
    if (seenIds.has(c.id)) {
      throw new Error(`除去対象カードIDに重複が存在します: '${c.id}' (fail-closed)`);
    }
    seenIds.add(c.id);
  }

  for (const cardId of seenIds) {
    const matches = sourceCards.filter((c: any) => c && c.id === cardId);
    if (matches.length === 0) {
      throw new Error(
        `除去対象カード '${cardId}' が元ゾーン '${sourceZone}' に存在しません (fail-closed)`
      );
    }
    if (matches.length > 1) {
      throw new Error(
        `除去対象カード '${cardId}' が元ゾーン '${sourceZone}' に複数存在します (fail-closed)`
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
 * 投入されたキーカード参照から、プレイヤーの指定元ゾーンに存在する Canonical な Card オブジェクト一覧を一意に解決します。
 *
 * 物理カード Identity 契約:
 * 1. 投入されたカード参照（およびそのプロパティ）は信頼されず、ID のみが reference として扱われます。
 * 2. 実際のカード属性 (suit, rank, value, etc.) の SSOT は Game State 内の元ゾーンに存在するオブジェクトです。
 * 3. 以下のいずれかの違反がある場合は即座に fail-closed で例外 (ValidationError) をスローします:
 *    - プレイヤーが存在しない
 *    - 指定元ゾーンが不正 / 配列でない
 *    - 投入カードが null / undefined または 有効な文字列 ID を持たない
 *    - 同一リクエスト内で投入カード ID に重複が存在する
 *    - 元ゾーン内に該当 ID を持つカードが存在しない (0件)
 *    - 元ゾーン内に同一 ID を持つカードが複数存在する (2件以上: ambiguous / corrupt physical identity)
 * 4. 解決された Canonical Card は、State 自身が保持する参照そのものを要求順序通りに返却します。
 */
export function resolveCanonicalKeyCardsInSource(
  player: any,
  sourceZone: KeyCardSourceZone,
  submittedCards: readonly any[]
): any[] {
  if (!player) {
    throw new ValidationError("プレイヤーが存在しません。");
  }
  if (!submittedCards || submittedCards.length === 0) {
    return [];
  }

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

  // 1. 投入カード自身の妥当性および投入リスト内での重複チェック
  const seenSubmittedIds = new Set<string>();
  for (const card of submittedCards) {
    if (!card || typeof card.id !== "string" || card.id.trim() === "") {
      throw new ValidationError("キーカードまたはカードIDが不正です。");
    }
    if (seenSubmittedIds.has(card.id)) {
      throw new ValidationError(`キーカードIDに重複が存在します: '${card.id}'`);
    }
    seenSubmittedIds.add(card.id);
  }

  // 2. 元ゾーンからの Canonical Card 解決
  const canonicalCards: any[] = [];
  for (const submitted of submittedCards) {
    const cardId = submitted.id;
    const matches = sourceCards.filter((c: any) => c && c.id === cardId);

    if (matches.length === 0) {
      throw new ValidationError(
        `キーカード '${cardId}' が指定元ゾーン '${sourceZone}' に存在しません。`
      );
    }

    if (matches.length > 1) {
      throw new ValidationError(
        `指定元ゾーン '${sourceZone}' に同一の物理カードID '${cardId}' が複数存在します (fail-closed)`
      );
    }

    // 正確に1件の一致: State 上の Canonical オブジェクトそのものを採用
    canonicalCards.push(matches[0]);
  }

  return canonicalCards;
}

/**
 * 投入されたキーカードが本当に対象ゾーンに存在するかを検証します。
 * 内部で resolveCanonicalKeyCardsInSource を利用して fail-closed に検証します。
 */
export function validateKeyCardsInSource(
  player: any,
  sourceZone: KeyCardSourceZone,
  cardsToValidate: readonly any[]
): void {
  resolveCanonicalKeyCardsInSource(player, sourceZone, cardsToValidate);
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
