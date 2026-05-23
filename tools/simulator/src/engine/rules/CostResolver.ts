import { CommandContext } from "./CommandRegistry";

/**
 * 新YAML DSLにおけるアクションコスト（D, L, B, BLなど）の判定・支払いを担当するクラス。
 */
export class CostResolver {
  /**
   * プレイヤーが指定されたコストを支払うことが可能か判定します。
   */
  canPay(cost: string, context: CommandContext): boolean {
    const player = context.state.players[context.playerKey];
    if (!player) return false;

    const c = cost.trim().toUpperCase();

    if (c === "D") {
      // 手札の枚数が「キーカード消費予定枚数 + 1枚」以上あるか。
      // キーカードは context.keyCard (1枚) または context.keyCards (複数枚)。
      const keyCardIds = new Set<string>();
      if (context.keyCard) keyCardIds.add(context.keyCard.id);
      if (context.keyCards) {
        context.keyCards.forEach((card) => keyCardIds.add(card.id));
      }

      const remainingHand = player.hand.filter((card: any) => !keyCardIds.has(card.id));
      return remainingHand.length >= 1;
    }

    if (c === "L") {
      // ライフが1枚以上あるか
      return player.life && player.life.length >= 1;
    }

    if (c === "B") {
      // チャージ状態の防壁が1体以上存在するか (Bulwark charge -> drive)
      const bulwarks = player.field.filter(
        (u: any) =>
          (u.componentId === "character.bulwark" || u.kind === "防壁") &&
          u.state === "charge"
      );
      return bulwarks.length >= 1;
    }

    if (c === "BL") {
      return this.canPay("B", context) && this.canPay("L", context);
    }

    if (c === "BB") {
      const bulwarks = player.field.filter(
        (u: any) =>
          (u.componentId === "character.bulwark" || u.kind === "防壁") &&
          u.state === "charge"
      );
      return bulwarks.length >= 2;
    }

    if (c === "BBL") {
      return this.canPay("BB", context) && this.canPay("L", context);
    }

    return false;
  }

  /**
   * 実際に指定されたコストを支払います。
   * プレイヤー状態（手札・ライフ・フィールド）を更新し、cardMoved や unitStateChanged などのイベントを発行します。
   */
  pay(cost: string, context: CommandContext, effectInterpreter: any): void {
    const player = context.state.players[context.playerKey];
    if (!player) throw new Error(`プレイヤーが見つかりません: ${context.playerKey}`);

    const c = cost.trim().toUpperCase();

    if (c === "D") {
      // 手札からキーカード以外のカードを1枚捨てる
      const keyCardIds = new Set<string>();
      if (context.keyCard) keyCardIds.add(context.keyCard.id);
      if (context.keyCards) {
        context.keyCards.forEach((card) => keyCardIds.add(card.id));
      }

      const costCardIndex = player.hand.findIndex((card: any) => !keyCardIds.has(card.id));
      if (costCardIndex === -1) {
        throw new Error("コストDを支払うための手札が不足しています。");
      }

      const [costCard] = player.hand.splice(costCardIndex, 1);

      if (!player.grave) player.grave = [];
      const graveUnit = {
        unitId: `unit-cost-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        kind: "コスト",
        cards: [costCard],
        labels: [],
      };
      player.grave.push(graveUnit);

      // イベント発行
      const event = {
        type: "cardMoved",
        payload: {
          card: costCard,
          fromZone: "hand",
          toZone: "grave",
          playerKey: context.playerKey,
        },
      };
      effectInterpreter.dispatchEvent(event, context);
      return;
    }

    if (c === "L") {
      // ライフの上から1枚を墓地へ送る
      if (!player.life || player.life.length === 0) {
        throw new Error("コストLを支払うためのライフが不足しています。");
      }

      const costCard = player.life.shift();
      if (!player.grave) player.grave = [];
      const graveUnit = {
        unitId: `unit-cost-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        kind: "コスト",
        cards: [costCard],
        labels: [],
      };
      player.grave.push(graveUnit);

      // イベント発行
      const event = {
        type: "cardMoved",
        payload: {
          card: costCard,
          fromZone: "life",
          toZone: "grave",
          playerKey: context.playerKey,
        },
      };
      effectInterpreter.dispatchEvent(event, context);
      return;
    }

    if (c === "B") {
      // チャージ状態の防壁1体をドライブ状態にする
      const bulwark = player.field.find(
        (u: any) =>
          (u.componentId === "character.bulwark" || u.kind === "防壁") &&
          u.state === "charge"
      );

      if (!bulwark) {
        throw new Error("コストBを支払うためのチャージ状態の防壁が不足しています。");
      }

      const oldState = bulwark.state;
      bulwark.state = "drive";

      // イベント発行 (unitStateChanged)
      const event = {
        type: "unitStateChanged",
        payload: {
          unitId: bulwark.unitId,
          fromState: oldState,
          toState: "drive",
          playerKey: context.playerKey,
        },
      };
      effectInterpreter.dispatchEvent(event, context);
      return;
    }

    if (c === "BL") {
      this.pay("B", context, effectInterpreter);
      this.pay("L", context, effectInterpreter);
      return;
    }

    if (c === "BB") {
      this.pay("B", context, effectInterpreter);
      this.pay("B", context, effectInterpreter);
      return;
    }

    if (c === "BBL") {
      this.pay("B", context, effectInterpreter);
      this.pay("B", context, effectInterpreter);
      this.pay("L", context, effectInterpreter);
      return;
    }
  }
}
