import { CommandContext } from "./CommandRegistry";
import { CostSymbol, parseCost } from "./CostParser";
import { CostPayment } from "../../domain/decision/DecisionCatalog";
import { GraveTopCoordinator } from "./GraveTopCoordinator";

/**
 * 新YAML DSLにおけるアクションコスト（D, L, Bなど）の判定・支払いを担当するクラス。
 * コスト文字列を正規化された CostSymbol[] にパースしてから処理します。
 */
export class CostResolver {
  /**
   * 指定された CostPayment の形状（D, B, Lの要求数、ID重複なし、キーカード重複なし、余計な支払いなし）
   * が要求コストと厳密に一致するかを検証します。
   */
  matchesCost(
    costPayment: CostPayment,
    requiredCost: string | readonly CostSymbol[],
    context?: CommandContext
  ): boolean {
    if (!costPayment) return false;

    // 1. sacrificedUnitIds が存在する場合は reject（D/B/L のみに限定）
    if (costPayment.sacrificedUnitIds && costPayment.sacrificedUnitIds.length > 0) {
      return false;
    }

    // 2. ID 重複検証（discardedCardIds, drivenBulwarkUnitIds に重複がないこと）
    const discarded = costPayment.discardedCardIds || [];
    if (new Set(discarded).size !== discarded.length) {
      return false;
    }

    const driven = costPayment.drivenBulwarkUnitIds || [];
    if (new Set(driven).size !== driven.length) {
      return false;
    }

    // 3. Key Card との重複検証 (context が渡されている場合)
    if (context) {
      const keyCardIds = new Set<string>();
      if (context.keyCard?.id) keyCardIds.add(context.keyCard.id);
      if (context.keyCards) {
        for (const k of context.keyCards) {
          if (k?.id) keyCardIds.add(k.id);
        }
      }
      for (const cardId of discarded) {
        if (keyCardIds.has(cardId)) {
          return false;
        }
      }
    }

    // 4. 要求シンボルの集計
    let symbols: readonly CostSymbol[];
    if (typeof requiredCost === "string") {
      if (!requiredCost || requiredCost.trim() === "") {
        symbols = [];
      } else {
        try {
          symbols = parseCost(requiredCost);
        } catch {
          return false;
        }
      }
    } else {
      symbols = requiredCost;
    }

    let requiredD = 0;
    let requiredB = 0;
    let requiredL = 0;

    for (const sym of symbols) {
      if (sym === "D") requiredD++;
      else if (sym === "B") requiredB++;
      else if (sym === "L") requiredL++;
    }

    const actualD = discarded.length;
    const actualB = driven.length;
    const actualL = costPayment.lifeCount || 0;

    return actualD === requiredD && actualB === requiredB && actualL === requiredL;
  }

  /**
   * 選択済みの具体的な CostPayment が支払えるか検証します。
   */
  canPaySelection(
    costPayment: CostPayment,
    context: CommandContext,
    requiredCost?: string | readonly CostSymbol[]
  ): boolean {
    if (!costPayment) return false;

    // requiredCost が指定されている場合は形状一致を先行検証
    if (requiredCost !== undefined) {
      if (!this.matchesCost(costPayment, requiredCost, context)) {
        return false;
      }
    } else {
      // requiredCost が直接渡されなくても、重複・Keyカード重複・sacrificedUnitIdsは常時検証
      if (costPayment.sacrificedUnitIds && costPayment.sacrificedUnitIds.length > 0) {
        return false;
      }
      const discarded = costPayment.discardedCardIds || [];
      if (new Set(discarded).size !== discarded.length) return false;

      const driven = costPayment.drivenBulwarkUnitIds || [];
      if (new Set(driven).size !== driven.length) return false;

      if (context) {
        const keyCardIds = new Set<string>();
        if (context.keyCard?.id) keyCardIds.add(context.keyCard.id);
        if (context.keyCards) {
          for (const k of context.keyCards) {
            if (k?.id) keyCardIds.add(k.id);
          }
        }
        for (const cardId of discarded) {
          if (keyCardIds.has(cardId)) return false;
        }
      }
    }

    const player = context.state?.players?.[context.playerKey];
    if (!player) return false;

    // 1. 手札カードの存在確認
    if (costPayment.discardedCardIds && costPayment.discardedCardIds.length > 0) {
      if (!player.hand) return false;
      const handIds = new Set(player.hand.map((c: any) => c.id));
      for (const cardId of costPayment.discardedCardIds) {
        if (!handIds.has(cardId)) return false;
      }
    }

    // 2. 防壁ユニットの存在とチャージ状態確認
    if (costPayment.drivenBulwarkUnitIds && costPayment.drivenBulwarkUnitIds.length > 0) {
      if (!player.field) return false;
      for (const unitId of costPayment.drivenBulwarkUnitIds) {
        const bulwark = player.field.find((u: any) => u.unitId === unitId);
        if (!bulwark || bulwark.state !== "charge") return false;
      }
    }

    // 3. ライフ残数確認
    if (costPayment.lifeCount > 0) {
      const actualLife = player.life
        ? (Array.isArray(player.life) ? player.life.length : Number(player.life))
        : 0;
      if (actualLife < costPayment.lifeCount) return false;
    }

    return true;
  }

  /**
   * 選択済みの具体的な CostPayment を支払います。
   */
  paySelection(costPayment: CostPayment, context: CommandContext, effectInterpreter: any): void {
    const player = context.state.players[context.playerKey];
    if (!player) throw new Error(`プレイヤーが見つかりません: ${context.playerKey}`);

    // 1. 指定された手札カードを捨てる
    if (costPayment.discardedCardIds && costPayment.discardedCardIds.length > 0) {
      for (let i = 0; i < costPayment.discardedCardIds.length; i++) {
        const cardId = costPayment.discardedCardIds[i];
        const index = player.hand.findIndex((c: any) => c.id === cardId);
        if (index === -1) {
          throw new Error(`コストとして指定された手札カードが見つかりません: ${cardId}`);
        }
        const [costCard] = player.hand.splice(index, 1);

        const stateVersion = context.state?.stateVersion ?? context.state?.version ?? 1;
        const graveUnit = {
          unitId: `unit-cost-${context.playerKey}-${costCard.id || cardId}-${stateVersion}-${i}`,
          kind: "コスト",
          cards: [costCard],
          labels: [],
        };
        GraveTopCoordinator.addUnitToGrave(
          player,
          graveUnit,
          context.state,
          context.playerKey,
          context.logRecorder
        );

        const event = {
          type: "cardMoved",
          payload: {
            card: costCard,
            fromZone: "hand",
            toZone: "grave",
            playerKey: context.playerKey,
            cause: { type: "cost", symbol: "D" },
          },
        };
        effectInterpreter.dispatchEvent(event, context);
      }
    }

    // 2. 指定された防壁をドライブする
    if (costPayment.drivenBulwarkUnitIds && costPayment.drivenBulwarkUnitIds.length > 0) {
      for (const unitId of costPayment.drivenBulwarkUnitIds) {
        const bulwark = player.field?.find((u: any) => u.unitId === unitId);
        if (!bulwark) {
          throw new Error(`コストとして指定された防壁が見つかりません: ${unitId}`);
        }
        if (bulwark.state !== "charge") {
          throw new Error(`コストとして指定された防壁がチャージ状態ではありません: ${unitId}`);
        }

        const oldState = bulwark.state;
        bulwark.state = "drive";

        const event = {
          type: "unitStateChanged",
          payload: {
            unitId: bulwark.unitId,
            fromState: oldState,
            toState: "drive",
            playerKey: context.playerKey,
            cause: { type: "cost", symbol: "B" },
          },
        };
        effectInterpreter.dispatchEvent(event, context);
      }
    }

    // 3. ライフを消費する
    if (costPayment.lifeCount > 0) {
      for (let i = 0; i < costPayment.lifeCount; i++) {
        if (!player.life || player.life.length === 0) {
          throw new Error("コストLを支払うためのライフが不足しています。");
        }
        const costCard = player.life.shift();
        const cardIdPart = costCard?.id ? `-${costCard.id}` : "";
        const graveUnit = {
          unitId: `unit-cost-${context.playerKey}${cardIdPart}-${context.state.stateVersion || 1}-${i}`,
          kind: "コスト",
          cards: [costCard],
          labels: [],
        };
        GraveTopCoordinator.addUnitToGrave(
          player,
          graveUnit,
          context.state,
          context.playerKey,
          context.logRecorder
        );

        const event = {
          type: "cardMoved",
          payload: {
            card: costCard,
            fromZone: "life",
            toZone: "grave",
            playerKey: context.playerKey,
            cause: { type: "cost", symbol: "L" },
          },
        };
        effectInterpreter.dispatchEvent(event, context);
      }
    }

  }
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

      const graveUnit = {
        unitId: `unit-cost-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        kind: "コスト",
        cards: [costCard],
        labels: [],
      };
      GraveTopCoordinator.addUnitToGrave(
        player,
        graveUnit,
        context.state,
        context.playerKey,
        context.logRecorder
      );

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
      const graveUnit = {
        unitId: `unit-cost-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        kind: "コスト",
        cards: [costCard],
        labels: [],
      };
      GraveTopCoordinator.addUnitToGrave(
        player,
        graveUnit,
        context.state,
        context.playerKey,
        context.logRecorder
      );

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
          cause: { type: "cost", symbol: "B" },
        },
      };
      effectInterpreter.dispatchEvent(event, context);
    }
  }
}
