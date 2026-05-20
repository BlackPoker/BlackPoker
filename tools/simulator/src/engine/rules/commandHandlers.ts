import type { EffectInterpreter } from "./EffectInterpreter";
import { CommandHandler } from "./CommandRegistry";
import { ExpressionEvaluator } from "./ExpressionEvaluator";

/**
 * createFog: フォグの生成と配置
 */
export function createFogHandler(expressionEvaluator: ExpressionEvaluator): CommandHandler {
  return (args, context) => {
    const { component, bindings } = args;
    const player = context.state.players[context.playerKey];
    if (!player) throw new Error(`プレイヤーが見つかりません: ${context.playerKey}`);

    // バインディング値の解決
    const resolvedBindings: Record<string, any> = {};
    if (bindings) {
      for (const [key, value] of Object.entries(bindings)) {
        resolvedBindings[key] = expressionEvaluator.resolveBindingValue(value, context);
      }
    }

    const newFog = {
      fogId: `fog-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      componentId: component,
      card: context.keyCard, // キーカードを配置
      bindings: resolvedBindings,
    };

    player.fog.push(newFog);
  };
}

/**
 * summonUnit: ユニットの召喚
 */
export function summonUnitHandler(): CommandHandler {
  return (args, context) => {
    const { component, face, state } = args;
    const player = context.state.players[context.playerKey];
    if (!player) throw new Error(`プレイヤーが見つかりません: ${context.playerKey}`);

    const newUnit = {
      unitId: `unit-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      kind: component === "character.soldier" ? "一般兵" : "ユニット",
      componentId: component,
      state: state || "charge",
      face: face || "up",
      cards: context.keyCard ? [context.keyCard] : [],
      labels: ["攻撃", "防御"],
    };

    // 手札からキーカードを消費（手札にある場合のみ）
    if (context.keyCard) {
      player.hand = player.hand.filter((c: any) => c.id !== context.keyCard.id);
    }

    player.field.push(newUnit);
  };
}

/**
 * removeFog: フォグの削除
 */
export function removeFogHandler(): CommandHandler {
  return (args, context) => {
    const { component, target } = args;
    const player = context.state.players[context.playerKey];
    if (!player) throw new Error(`プレイヤーが見つかりません: ${context.playerKey}`);

    const targetUnitId = target === "target" && context.targetComponent
      ? context.targetComponent.unitId
      : target;

    player.fog = player.fog.filter((f: any) => {
      const matchComponent = f.componentId === component;
      const matchTarget = targetUnitId ? f.bindings.target === targetUnitId : true;
      return !(matchComponent && matchTarget);
    });
  };
}

/**
 * moveToGraveyard: ユニットを墓地へ移動 (cardMoved イベントを発行)
 */
export function moveToGraveyardHandler(effectInterpreter: EffectInterpreter): CommandHandler {
  return (args, context) => {
    const { target } = args;
    const player = context.state.players[context.playerKey];
    if (!player) throw new Error(`プレイヤーが見つかりません: ${context.playerKey}`);

    const targetUnit = target === "target" ? context.targetComponent : null;
    if (!targetUnit) return;

    // フィールドから除外
    player.field = player.field.filter((u: any) => u.unitId !== targetUnit.unitId);

    // 墓地へ追加
    if (!player.grave) {
      player.grave = [];
    }
    player.grave.push(targetUnit);

    // 各カードについて cardMoved イベントを発行
    if (targetUnit.cards && Array.isArray(targetUnit.cards)) {
      for (const card of targetUnit.cards) {
        const event = {
          type: "cardMoved",
          payload: {
            card: card,
            fromZone: "field",
            toZone: "grave",
            playerKey: context.playerKey,
          }
        };
        effectInterpreter.dispatchEvent(event, context);
      }
    }
  };
}

/**
 * takeUntilLegacyCard: Joker,A,J,Q,Kが出るまでライフをめくる
 */
export function takeUntilLegacyCardHandler(): CommandHandler {
  return (args, context) => {
    const player = context.state.players[context.playerKey];
    if (!player) throw new Error(`プレイヤーが見つかりません: ${context.playerKey}`);

    const legacyRanks = ["Joker", "A", "J", "Q", "K"];

    if (!player.life) {
      player.life = [];
    }
    if (!player.hand) {
      player.hand = [];
    }
    if (!player.grave) {
      player.grave = [];
    }

    // ライフの上から1枚ずつめくる
    while (player.life.length > 0) {
      const card = player.life.shift();
      if (!card) break;

      if (legacyRanks.includes(card.rank)) {
        // Joker,A,J,Q,K が出たら手札に加えて終了
        player.hand.push(card);
        break;
      } else {
        // 違えば墓地に送る
        player.grave.push({
          unitId: `unit-grave-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          kind: "一般兵",
          cards: [card],
          labels: []
        });
      }
    }
  };
}
