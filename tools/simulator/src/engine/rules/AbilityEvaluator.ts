/**
 * ゲーム状態における能力効果（フォグの sizeModifier 等）の集計・計算を行います。
 */
export class AbilityEvaluator {
  /**
   * ユニットに適用されているすべてのフォグの amount 累積値を反映したサイズ計算を行います。
   */
  calculateUnitSize(unit: any, player: any): number {
    if (!unit) return 0;
    const cardsSum = unit.cards ? unit.cards.reduce((sum: number, c: any) => sum + (c.value || 0), 0) : 0;
    let size = cardsSum;
    if (player && player.fog) {
      for (const fog of player.fog) {
        if (fog.bindings && fog.bindings.target === unit.unitId) {
          size += fog.bindings.amount || 0;
        }
      }
    }
    return size;
  }
}
