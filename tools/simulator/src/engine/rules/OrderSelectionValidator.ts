/**
 * ユニットカード順序選択のバリデーションユーティリティ。
 * オーナーによる順序選択（ライフTOPへの配置順など）において、
 * 不正な選択・欠損・重複・未知のカードIDを厳格に fail-closed で遮断します。
 */

/**
 * 途中段階の順序選択（部分順序）を検証します。
 */
export function validatePartialOrder(partialOrder: unknown, candidateCardIds: string[]): void {
  if (!Array.isArray(partialOrder)) {
    throw new Error(`validatePartialOrder: partialOrder は配列である必要があります: ${JSON.stringify(partialOrder)}`);
  }

  if (partialOrder.length > candidateCardIds.length) {
    throw new Error(
      `validatePartialOrder: 選択カード数 (${partialOrder.length}) が候補数 (${candidateCardIds.length}) を超えています。`
    );
  }

  const seen = new Set<string>();
  const candidateSet = new Set(candidateCardIds);

  for (const id of partialOrder) {
    if (typeof id !== "string" || !id) {
      throw new Error(`validatePartialOrder: 不正なカードIDが含まれています: ${JSON.stringify(id)}`);
    }
    if (!candidateSet.has(id)) {
      throw new Error(`validatePartialOrder: 候補に存在しないカードIDが含まれています: ${id}`);
    }
    if (seen.has(id)) {
      throw new Error(`validatePartialOrder: 重複したカードIDが含まれています: ${id}`);
    }
    seen.add(id);
  }
}

/**
 * 最終確定された順序（完全順序）を検証します。
 */
export function validateCompleteOrder(finalOrder: unknown, candidateCardIds: string[]): void {
  if (!Array.isArray(finalOrder)) {
    throw new Error(`validateCompleteOrder: finalOrder は配列である必要があります: ${JSON.stringify(finalOrder)}`);
  }

  if (finalOrder.length !== candidateCardIds.length) {
    throw new Error(
      `validateCompleteOrder: 確定順序のカード数 (${finalOrder.length}) が元の候補数 (${candidateCardIds.length}) と一致しません。`
    );
  }

  const seen = new Set<string>();
  const candidateSet = new Set(candidateCardIds);

  for (const id of finalOrder) {
    if (typeof id !== "string" || !id) {
      throw new Error(`validateCompleteOrder: 不正なカードIDが含まれています: ${JSON.stringify(id)}`);
    }
    if (!candidateSet.has(id)) {
      throw new Error(`validateCompleteOrder: 候補に存在しないカードIDが含まれています: ${id}`);
    }
    if (seen.has(id)) {
      throw new Error(`validateCompleteOrder: 重複したカードIDが含まれています: ${id}`);
    }
    seen.add(id);
  }

  if (seen.size !== candidateSet.size) {
    throw new Error("validateCompleteOrder: 候補カードと確定順序のカードセットに不一致があります。");
  }
}
