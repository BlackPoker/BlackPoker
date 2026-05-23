import { CommandContext } from "./CommandRegistry";
import { CostSymbol, parseCost } from "./CostParser";

/**
 * 新YAML DSLにおけるアクションコスト（D, L, Bなど）の判定・支払いを担当するクラス。
 * コスト文字列を正規化された CostSymbol[] にパースしてから処理します。
 */
export class CostResolver {
  /**
   * プレイヤーが指定されたコスト文字列を支払うことが可能か判定します。
   */
  canPay(cost: string, context: CommandContext): boolean {
    try {
      const symbols = parseCost(cost);
      return this.canPaySymbols(symbols, context);
    } catch {
      return false;
    }
  }

  /**
   * 正規化されたコストシンボル配列が支払えるか一括で事前検証します。
   * 途中まで支払ってリソース不足で失敗するのを防ぐため、要求される総リソース数を集計してアサートします。
   */
  canPaySymbols(symbols: CostSymbol[], context: CommandContext): boolean {
    const player = context.state.players[context.playerKey];
    if (!player) return false;

    // 必要リソースの要求数を集計
    let requiredD = 0;
    let requiredL = 0;
    let requiredB = 0;

    for (const sym of symbols) {
      if (sym === "D") requiredD++;
      else if (sym === "L") requiredL++;
      else if (sym === "B") requiredB++;
    }

    // 1. D (Discard) 手札リソース検証
    const keyCardIds = new Set<string>();
    if (context.keyCard) keyCardIds.add(context.keyCard.id);
    if (context.keyCards) {
      context.keyCards.forEach((card) => keyCardIds.add(card.id));
    }
    const remainingHand = player.hand ? player.hand.filter((card: any) => !keyCardIds.has(card.id)) : [];
    if (remainingHand.length < requiredD) return false;

    // 2. L (Life) ライフリソース検証
    const actualLife = player.life ? player.life.length : 0;
    if (actualLife < requiredL) return false;

    // 3. B (Bulwark) チャージ防壁リソース検証
    const bulwarks = player.field ? player.field.filter(
      (u: any) =>
        (u.componentId === "character.bulwark" || u.kind === "防壁") &&
        u.state === "charge"
    ) : [];
    if (bulwarks.length < requiredB) return false;

    return true;
  }

  /**
   * 実際に指定されたコストを支払います。
   * コスト文字列をパースし、CostSymbolごとに順次状態変更とイベント発行を実行します。
   */
  pay(cost: string, context: CommandContext, effectInterpreter: any): void {
    const symbols = parseCost(cost);
    for (const sym of symbols) {
      this.paySingleSymbol(sym, context, effectInterpreter);
    }
  }

  /**
   * 個々のコストシンボルに基づいて状態変更とイベント発行を実行します。
   */
  private paySingleSymbol(sym: CostSymbol, context: CommandContext, effectInterpreter: any): void {
    const player = context.state.players[context.playerKey];
    if (!player) throw new Error(`プレイヤーが見つかりません: ${context.playerKey}`);

    if (sym === "D") {
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
    } else if (sym === "L") {
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
    } else if (sym === "B") {
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
    }
  }
}
