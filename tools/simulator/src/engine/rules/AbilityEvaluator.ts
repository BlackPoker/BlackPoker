import { CommandContext } from "./CommandRegistry";

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

  /**
   * ダメージを受ける側がダメージを無効化できるかを判定します。
   */
  shouldPreventDamage(context: CommandContext): boolean {
    const action = context.currentAction;
    if (!action) return false;

    // ダメージ対象プレイヤーの解決 (targetPlayerKey があればそれ、無ければ playerKey ではない方)
    const targetPlayerKey = context.targetPlayerKey || (context.playerKey === "p1" ? "p2" : "p1");
    const targetPlayer = context.state.players[targetPlayerKey];
    if (!targetPlayer) return false;

    // 1. 対象プレイヤーの trumps 領域に "trump.fortress" が表向きで存在するか
    const hasFortress = targetPlayer.trumps?.some(
      (t: any) => t.componentId === "trump.fortress" && t.face === "up"
    );
    if (!hasFortress) return false;

    // 2. 自分の場（field）にキャラクターが1体以上存在するか
    const hasCharacter = targetPlayer.field?.some(
      (u: any) => u.componentId && u.componentId.startsWith("character.")
    );
    if (!hasCharacter) return false;

    // 3. ダメージソースのチェック
    // 対戦相手からのダメージか
    const isOpponentAction = context.playerKey !== targetPlayerKey;
    if (!isOpponentAction) return false;

    // キーカードにスペードが含まれているか
    const actualCards = context.keyCards && context.keyCards.length > 0
      ? context.keyCards
      : context.keyCard ? [context.keyCard] : [];
      
    const hasSpade = actualCards.some(
      (c: any) => c.suit === "S" || c.suit?.toLowerCase() === "spade"
    );
    
    return hasSpade;
  }
}
