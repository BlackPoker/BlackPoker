import { CommandContext } from "./CommandRegistry";
import { getOpponentPlayerKey } from "./playerUtils";

export interface PreventDamageAbility {
  target?: string;
  source?: {
    requestController?: string;
    keyCardsIncludeSuit?: string;
  };
  condition?: {
    exists?: {
      zone?: string;
      controller?: string;
      componentType?: string;
    };
  };
}

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

    // ダメージ対象プレイヤーの解決 (targetPlayerKey があればそれ、無ければ playerKey の対戦相手)
    const targetPlayerKey = context.targetPlayerKey || getOpponentPlayerKey(context.playerKey, context.state);
    const targetPlayer = context.state.players?.[targetPlayerKey];
    if (!targetPlayer) return false;

    const componentsList = context.components || [];

    // findActiveAbilities を利用して対象プレイヤーの有効な preventDamage 能力一覧を取得
    const activeAbilities = this.findActiveAbilities<PreventDamageAbility>(
      "preventDamage",
      context.state,
      componentsList,
      targetPlayerKey
    );

    for (const entry of activeAbilities) {
      const pd = entry.ability;
      if (!pd) continue;

      // target の評価
      if (pd.target !== "self") continue;

      // source の評価
      if (pd.source) {
        const { requestController, keyCardsIncludeSuit } = pd.source;

        // requestController: opponent
        if (requestController === "opponent") {
          const opponentPlayerKey = getOpponentPlayerKey(targetPlayerKey, context.state);
          if (context.playerKey !== opponentPlayerKey) continue;
        }

        // keyCardsIncludeSuit: spade
        if (keyCardsIncludeSuit === "spade") {
          const actualCards = context.keyCards && context.keyCards.length > 0
            ? context.keyCards
            : context.keyCard ? [context.keyCard] : [];
          const hasSpade = actualCards.some(
            (c: any) => c.suit === "S" || c.suit?.toLowerCase() === "spade"
          );
          if (!hasSpade) continue;
        }
      }

      // condition.exists の評価
      if (pd.condition && pd.condition.exists) {
        const { zone, controller, componentType } = pd.condition.exists;

        if (zone === "field" && controller === "self") {
          const existsMatch = targetPlayer.field?.some((u: any) => {
            if (!u.componentId) return false;
            if (componentType === "character") {
              if (u.componentId.startsWith("character.")) return true;
              const uDef = componentsList.find((c: any) => c.id === u.componentId);
              return uDef && uDef.type === "character";
            }
            return u.componentId === componentType;
          });

          if (!existsMatch) continue;
        }
      }

      // すべての条件を満たした場合、ダメージを無効化
      return true;
    }

    return false;
  }

  /**
   * 盤面上の全プレイヤーまたは特定プレイヤーの有効な表向きコンポーネントから、
   * 指定した能力キー（例: "damageJudgeModifier" や "grantAbility"）を持つ能力定義リストを取得します。
   */
  findActiveAbilities<T = any>(
    abilityKey: string,
    state: any,
    components: readonly any[] = [],
    playerKey?: string
  ): { playerKey: string; instance: any; ability: T }[] {
    const results: { playerKey: string; instance: any; ability: T }[] = [];
    if (!state?.players) return results;

    const targetPlayers = playerKey
      ? [playerKey]
      : Object.keys(state.players);

    for (const pKey of targetPlayers) {
      const player = state.players[pKey];
      if (!player) continue;

      const activeInstances: any[] = [];
      const trumps = player.trump || player.trumps || [];
      if (Array.isArray(trumps)) {
        activeInstances.push(...trumps.filter((t: any) => t.face === "up"));
      }
      if (Array.isArray(player.field)) {
        activeInstances.push(...player.field.filter((u: any) => u.face === undefined || u.face === "up"));
      }

      for (const inst of activeInstances) {
        const compId = inst.componentId || inst.id;
        if (!compId) continue;

        const compDef = components.find((c: any) => c.id === compId);
        if (!compDef || !compDef.abilities) continue;

        for (const abilityDef of compDef.abilities) {
          if (abilityDef[abilityKey]) {
            results.push({
              playerKey: pKey,
              instance: inst,
              ability: abilityDef[abilityKey],
            });
          }
        }
      }
    }

    return results;
  }

  /**
   * 特定の matchup（例: "soldierVsSoldiers"）に対する damageJudgeModifier ルール（例: "revolution"）が有効かを判定
   */
  hasDamageJudgeModifier(
    matchup: string,
    rule: string,
    state: any,
    components: readonly any[] = []
  ): boolean {
    const modifiers = this.findActiveAbilities("damageJudgeModifier", state, components);
    return modifiers.some(
      (m) => m.ability.matchup === matchup && m.ability.rule === rule
    );
  }
}
