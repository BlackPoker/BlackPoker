import type { EffectInterpreter } from "./EffectInterpreter";
import { CommandHandler } from "./CommandRegistry";
import { ExpressionEvaluator } from "./ExpressionEvaluator";
import { AbilityEvaluator } from "./AbilityEvaluator";
import { TurnManager } from "./TurnManager";

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

    // コンポーネント定義から kind を動的に解決
    const compDef = context.components?.find((c: any) => c.id === component);
    const kind = compDef?.display?.kind || compDef?.properties?.kind || compDef?.name || "ユニット";

    const newUnit = {
      unitId: `unit-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      kind: kind,
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

/**
 * dealDamage: プレイヤーへダメージを与える (cardMoved イベントを発行)
 */
export function dealDamageHandler(
  expressionEvaluator: ExpressionEvaluator,
  abilityEvaluator: AbilityEvaluator,
  effectInterpreter: EffectInterpreter
): CommandHandler {
  return (args, context) => {
    const { target, amount } = args;
    const player = context.state.players[context.playerKey];
    if (!player) throw new Error(`プレイヤーが見つかりません: ${context.playerKey}`);

    // 要塞などのダメージ無効化常在能力の適用チェック
    if (abilityEvaluator.shouldPreventDamage(context)) {
      return;
    }

    const resolvedAmount = expressionEvaluator.resolveBindingValue(amount, context);
    if (typeof resolvedAmount !== "number" || resolvedAmount <= 0) {
      return;
    }

    // 対象プレイヤーのキーを解決
    const targetPlayerKey = target === "targetPlayer" && context.targetPlayerKey
      ? context.targetPlayerKey
      : (context.playerKey === "p1" ? "p2" : "p1");

    const targetPlayer = context.state.players[targetPlayerKey];
    if (!targetPlayer) throw new Error(`対象プレイヤーが見つかりません: ${targetPlayerKey}`);

    if (!targetPlayer.life) {
      targetPlayer.life = [];
    }
    if (!targetPlayer.grave) {
      targetPlayer.grave = [];
    }

    // ライフの上から resolvedAmount 枚数を墓地へ移動
    const damageAmount = Math.min(resolvedAmount, targetPlayer.life.length);
    for (let i = 0; i < damageAmount; i++) {
      const card = targetPlayer.life.shift();
      if (!card) break;

      // 墓地へ追加 (ダメージのカードとして追加)
      targetPlayer.grave.push({
        unitId: `unit-grave-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        kind: "ダメージ",
        cards: [card],
        labels: [],
      });

      // 各カードについて cardMoved イベントを発行 (fromZone: "life")
      const event = {
        type: "cardMoved",
        payload: {
          card: card,
          fromZone: "life",
          toZone: "grave",
          playerKey: targetPlayerKey,
        },
      };
      effectInterpreter.dispatchEvent(event, context);
    }
  };
}

/**
 * cancelRequest: 指定されたリクエストをキャンセルする
 */
export function cancelRequestHandler(expressionEvaluator: ExpressionEvaluator): CommandHandler {
  return (args, context) => {
    const { target } = args;
    const requestId = expressionEvaluator.resolveBindingValue(target, context);
    if (!requestId) {
      throw new Error("キャンセル対象のリクエストIDが解決できません。");
    }

    if (!context.state.stage || !context.state.stage.requests) {
      throw new Error("ステージまたはリクエストリストが存在しません。");
    }

    const request = context.state.stage.requests.find((r: any) => r.id === requestId);
    if (!request) {
      throw new Error(`キャンセル対象のリクエストが見つかりません: ${requestId}`);
    }

    request.status = "cancelled";
  };
}

/**
 * toggleUnitState: 対象ユニットのチャージ/ドライブ状態をトグルする
 */
export function toggleUnitStateHandler(
  expressionEvaluator: ExpressionEvaluator,
  effectInterpreter: EffectInterpreter
): CommandHandler {
  return (args, context) => {
    const { target } = args;
    let targetUnit = context.targetComponent;

    if (!targetUnit && target) {
      const resolvedTargetId = expressionEvaluator.resolveBindingValue(target, context);
      if (resolvedTargetId) {
        for (const pKey of Object.keys(context.state.players)) {
          const player = context.state.players[pKey];
          if (player.field) {
            const u = player.field.find((unit: any) => unit.unitId === resolvedTargetId);
            if (u) {
              targetUnit = u;
              break;
            }
          }
        }
      }
    }

    if (!targetUnit) {
      throw new Error("トグル対象のユニットが見つかりません。");
    }

    const oldState = targetUnit.state;
    if (oldState !== "charge" && oldState !== "drive") {
      throw new Error(`トグルできない状態です。期待: charge または drive, 実際: ${oldState}`);
    }

    const newState = oldState === "charge" ? "drive" : "charge";
    targetUnit.state = newState;

    // イベント発行 (unitStateChanged)
    const event = {
      type: "unitStateChanged",
      payload: {
        unitId: targetUnit.unitId,
        fromState: oldState,
        toState: newState,
        playerKey: context.playerKey,
        cause: { type: "effect", command: "toggleUnitState" },
      },
    };
    effectInterpreter.dispatchEvent(event, context);
  };
}

/**
 * cleanupFogs: 全プレイヤーのフォグ領域を走査し、フォグコンポーネントに該当するフォグをすべて各々の墓地へ移動する
 */
export function cleanupFogsHandler(effectInterpreter: EffectInterpreter): CommandHandler {
  return (args, context) => {
    const state = context.state;
    if (!state || !state.players) return;

    for (const [playerKey, player] of Object.entries<any>(state.players)) {
      if (!player.fog) {
        player.fog = [];
        continue;
      }

      const removedFogs: any[] = [];

      player.fog = player.fog.filter((f: any) => {
        const compId = f.componentId;
        const compDef = context.components?.find((c: any) => c.id === compId);
        
        const isFog = compDef
          ? compDef.type === "fog"
          : compId?.startsWith("fog.");

        if (isFog) {
          removedFogs.push(f);
        }
        // フォグコンポーネントであれば除去する (filterで残さない)
        return !isFog;
      });

      if (!player.grave) {
        player.grave = [];
      }

      // 各除去されたフォグについて墓地移動およびイベント発行
      for (const fog of removedFogs) {
        // 墓地ユニットオブジェクトとして player.grave へ移動
        player.grave.push({
          unitId: fog.fogId,
          kind: "フォグ",
          componentId: fog.componentId,
          cards: fog.card ? [fog.card] : [],
          labels: [],
        });

        // fogRemoved イベントを必ず発行
        const fogEvent = {
          type: "fogRemoved",
          payload: {
            fogId: fog.fogId,
            componentId: fog.componentId,
            card: fog.card,
            fromZone: "fog",
            toZone: "grave",
            playerKey: playerKey, // owner
          }
        };
        effectInterpreter.dispatchEvent(fogEvent, context);

        // fog.card が存在する場合のみ cardMoved イベントを発行
        if (fog.card) {
          const moveEvent = {
            type: "cardMoved",
            payload: {
              card: fog.card,
              fromZone: "fog",
              toZone: "grave",
              playerKey: playerKey,
            }
          };
          effectInterpreter.dispatchEvent(moveEvent, context);
        }
      }
    }
  };
}

/**
 * endTurn: ターン交代とチャンス移行を行う
 */
export function endTurnHandler(): CommandHandler {
  return (args, context) => {
    TurnManager.endTurn(context.state);
  };
}
