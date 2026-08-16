import { CostPayment } from "../../domain/decision/DecisionCatalog";
import { parseCost, CostSymbol } from "../rules/CostParser";

/**
 * コスト支払い候補の全列挙を行うクラス。
 */
export class CostPaymentEnumerator {
  /**
   * コスト文字列とコンテキストから、可能なすべての具体的な支払い方法を列挙します。
   */
  static enumeratePayments(
    costStr: string | undefined,
    player: any,
    excludedCardIds: ReadonlySet<string> = new Set()
  ): CostPayment[] {
    if (!costStr || costStr.trim() === "") {
      return [
        {
          discardedCardIds: [],
          drivenBulwarkUnitIds: [],
          sacrificedUnitIds: [],
          lifeCount: 0,
          summary: "コストなし",
        },
      ];
    }

    let symbols: CostSymbol[];
    try {
      symbols = parseCost(costStr);
    } catch {
      return [];
    }

    let requiredD = 0;
    let requiredL = 0;
    let requiredB = 0;

    for (const sym of symbols) {
      if (sym === "D") requiredD++;
      else if (sym === "L") requiredL++;
      else if (sym === "B") requiredB++;
    }

    // 1. D (Discard) 候補の列挙
    const availableHand = player?.hand
      ? player.hand.filter((c: any) => !excludedCardIds.has(c.id))
      : [];
    if (availableHand.length < requiredD) {
      return []; // 手札不足
    }
    const discardCombinations: string[][] = this.getCombinations<string>(
      availableHand.map((c: any) => c.id as string),
      requiredD
    );

    // 2. B (Bulwark) 候補の列挙
    const availableBulwarks = player?.field
      ? player.field.filter(
          (u: any) =>
            (u.componentId === "character.bulwark" || u.kind === "防壁") &&
            u.state === "charge"
        )
      : [];
    if (availableBulwarks.length < requiredB) {
      return []; // チャージ防壁不足
    }
    const bulwarkCombinations: string[][] = this.getCombinations<string>(
      availableBulwarks.map((u: any) => u.unitId as string),
      requiredB
    );

    // 3. L (Life) 候補
    const actualLife = player?.life
      ? (Array.isArray(player.life) ? player.life.length : Number(player.life))
      : 0;
    if (actualLife < requiredL) {
      return []; // ライフ不足
    }

    // 4. 直積の生成
    const results: CostPayment[] = [];
    for (const discarded of discardCombinations) {
      for (const driven of bulwarkCombinations) {
        const parts: string[] = [];
        if (discarded.length > 0) {
          parts.push(`手札破棄: [${discarded.join(", ")}]`);
        }
        if (driven.length > 0) {
          parts.push(`防壁ドライブ: [${driven.join(", ")}]`);
        }
        if (requiredL > 0) {
          parts.push(`ライフ消費: ${requiredL}点`);
        }

        results.push({
          discardedCardIds: Object.freeze<string[]>([...discarded]),
          drivenBulwarkUnitIds: Object.freeze<string[]>([...driven]),
          sacrificedUnitIds: Object.freeze<string[]>([]),
          lifeCount: requiredL,
          summary: parts.length > 0 ? parts.join(", ") : "コストなし",
        });
      }
    }

    // 安定ソート（再現性確保）
    results.sort((a, b) => {
      const aKey = `${a.discardedCardIds.join(",")}|${a.drivenBulwarkUnitIds.join(",")}|${a.lifeCount}`;
      const bKey = `${b.discardedCardIds.join(",")}|${b.drivenBulwarkUnitIds.join(",")}|${b.lifeCount}`;
      return aKey.localeCompare(bKey);
    });

    return results;
  }

  /**
   * 配列から k 個選ぶすべての組み合わせ（順序考慮なし、ソート済み）を生成
   */
  private static getCombinations<T>(array: readonly T[], k: number): T[][] {
    if (k === 0) return [[]];
    if (array.length < k) return [];

    const result: T[][] = [];
    const helper = (start: number, current: T[]) => {
      if (current.length === k) {
        result.push([...current]);
        return;
      }
      for (let i = start; i < array.length; i++) {
        current.push(array[i]);
        helper(i + 1, current);
        current.pop();
      }
    };
    helper(0, []);
    return result;
  }
}
