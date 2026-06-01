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

/**
 * startAttack: アタックを宣言し、戦闘状態 (state.combat) を作成する
 */
export function startAttackHandler(
  expressionEvaluator: ExpressionEvaluator,
  effectInterpreter: EffectInterpreter
): CommandHandler {
  return (args, context) => {
    const { target, defender } = args;
    const state = context.state;

    // アタッカーユニットの解決
    let attackerUnit = context.targetComponent;
    if (!attackerUnit && target) {
      const resolvedTargetId = expressionEvaluator.resolveBindingValue(target, context);
      if (resolvedTargetId) {
        const player = state.players[context.playerKey];
        if (player && player.field) {
          attackerUnit = player.field.find((u: any) => u.unitId === resolvedTargetId);
        }
      }
    }

    if (!attackerUnit) {
      throw new Error("アタッカーとなるユニットが見つかりません。");
    }

    // ディフェンダープレイヤーの解決
    let defenderPlayerKey = undefined;
    if (defender === "targetPlayer" && context.targetPlayerKey) {
      defenderPlayerKey = context.targetPlayerKey;
    } else if (defender === "opponent") {
      defenderPlayerKey = context.playerKey === "p1" ? "p2" : "p1";
    } else if (defender) {
      defenderPlayerKey = expressionEvaluator.resolveBindingValue(defender, context);
    }

    if (!defenderPlayerKey || !state.players[defenderPlayerKey]) {
      throw new Error(`ディフェンダーとなるプレイヤーが見つかりません: ${defenderPlayerKey}`);
    }

    // 1. アタッカーが実行プレイヤーの field に存在することの確認
    const player = state.players[context.playerKey];
    const exists = player?.field?.some((u: any) => u.unitId === attackerUnit.unitId);
    if (!exists) {
      throw new Error("アタッカーは自分のフィールドに存在するユニットである必要があります。");
    }

    // 2. アタッカーが character component であることの確認
    const compId = attackerUnit.componentId || "";
    const compDef = context.components?.find((c: any) => c.id === compId);
    const isCharacter = compDef ? compDef.type === "character" : compId.startsWith("character.");
    if (!isCharacter) {
      throw new Error("アタッカーはキャラクターである必要があります。");
    }

    // 3. アタッカーが攻撃可能状態であることの確認 (チャージ状態)
    if (attackerUnit.state !== "charge") {
      throw new Error(`ドライブ状態のキャラクターはアタッカーに指定できません。現在: ${attackerUnit.state}`);
    }

    // アタッカーユニットに戦闘一時情報を記録
    attackerUnit.battle = {
      role: "attacker",
      targetPlayerKey: defenderPlayerKey
    };

    // アタッカーをドライブ状態に移行する
    const oldState = attackerUnit.state;
    attackerUnit.state = "drive";

    // イベント発行 (unitStateChanged)
    const event = {
      type: "unitStateChanged",
      payload: {
        unitId: attackerUnit.unitId,
        fromState: oldState,
        toState: "drive",
        playerKey: context.playerKey,
        cause: { type: "effect", command: "startAttack" },
      },
    };
    effectInterpreter.dispatchEvent(event, context);
  };
}

/**
 * declareBlock: ブロックを宣言し、ブロッカーに戦闘一時情報を記録する
 */
export function declareBlockHandler(
  expressionEvaluator: ExpressionEvaluator,
  effectInterpreter: EffectInterpreter
): CommandHandler {
  return (args, context) => {
    const state = context.state;
    const blockerUnit = context.targetComponent;

    if (!blockerUnit) {
      throw new Error("ブロッカーとなるユニットが見つかりません。");
    }

    // 自分を攻撃対象とする「相手のアタッカー」を厳密に特定する
    let attackerUnit: any = null;
    for (const [pKey, p] of Object.entries<any>(state.players)) {
      if (pKey === context.playerKey) continue; // 自分のアタッカーはブロックできない
      if (p.field) {
        attackerUnit = p.field.find(
          (u: any) => u.battle?.role === "attacker" && u.battle?.targetPlayerKey === context.playerKey
        );
        if (attackerUnit) break;
      }
    }

    if (!attackerUnit) {
      throw new Error("ブロック対象となる相手のアタッカーが見つかりません。");
    }

    // ブロッカーユニットに一時戦闘情報を記録
    blockerUnit.battle = {
      role: "blocker",
      blocksUnitId: attackerUnit.unitId
    };

    // ブロッカーをドライブ状態に移行する
    const oldState = blockerUnit.state;
    blockerUnit.state = "drive";

    // イベント発行 (unitStateChanged)
    const event = {
      type: "unitStateChanged",
      payload: {
        unitId: blockerUnit.unitId,
        fromState: oldState,
        toState: "drive",
        playerKey: context.playerKey,
        cause: { type: "effect", command: "declareBlock" },
      },
    };
    effectInterpreter.dispatchEvent(event, context);
  };
}

/**
 * ユニットをフィールドから墓地へ移動する共通処理
 * 墓地に移動する前に unit.battle を完全に削除し、カードごとに cardMoved イベントを発行する
 */
export function moveUnitToGraveyard(
  unit: any,
  playerKey: string,
  state: any,
  effectInterpreter: EffectInterpreter,
  context: any
) {
  const player = state.players[playerKey];
  if (!player) return;

  // フィールドから除外
  if (player.field) {
    player.field = player.field.filter((u: any) => u.unitId !== unit.unitId);
  }

  // 墓地に送る前に battle 情報を完全に削除する
  if (unit.battle) {
    delete unit.battle;
  }

  // 墓地へ追加
  if (!player.grave) {
    player.grave = [];
  }
  player.grave.push(unit);

  // 各カードについて cardMoved イベントを発行
  if (unit.cards && Array.isArray(unit.cards)) {
    for (const card of unit.cards) {
      const event = {
        type: "cardMoved",
        payload: {
          card: card,
          fromZone: "field",
          toZone: "grave",
          playerKey: playerKey,
        }
      };
      effectInterpreter.dispatchEvent(event, context);
    }
  }
}

/**
 * judgeDamage: アタッカーとブロッカーの現在サイズを比較し、敗北したユニットを墓地へ移動する
 */
export function judgeDamageHandler(
  abilityEvaluator: AbilityEvaluator,
  effectInterpreter: EffectInterpreter
): CommandHandler {
  return (args, context) => {
    const state = context.state;

    // 1. アタッカーを探す (battle.role === "attacker")
    let attackerUnit: any = null;
    let attackerPlayerKey: string = "";
    for (const [pKey, p] of Object.entries<any>(state.players)) {
      if (p.field) {
        attackerUnit = p.field.find((u: any) => u.battle?.role === "attacker");
        if (attackerUnit) {
          attackerPlayerKey = pKey;
          break;
        }
      }
    }

    if (!attackerUnit) {
      throw new Error("戦闘中のアタッカーが見つかりません。");
    }

    // 2. ブロッカーを探す (battle.blocksUnitId === attackerUnit.unitId)
    let blockerUnit: any = null;
    let blockerPlayerKey: string = "";
    for (const [pKey, p] of Object.entries<any>(state.players)) {
      if (p.field) {
        blockerUnit = p.field.find(
          (u: any) => u.battle?.role === "blocker" && u.battle?.blocksUnitId === attackerUnit.unitId
        );
        if (blockerUnit) {
          blockerPlayerKey = pKey;
          break;
        }
      }
    }

    if (!blockerUnit) {
      throw new Error("アタッカーに対するブロッカーが見つかりません。");
    }

    // 3. AbilityEvaluator を用いて attacker と blocker のサイズを計算
    const attackerSize = abilityEvaluator.calculateUnitSize(attackerUnit, state.players[attackerPlayerKey]);
    const blockerSize = abilityEvaluator.calculateUnitSize(blockerUnit, state.players[blockerPlayerKey]);

    // 4. サイズ比較と墓地送り
    if (attackerSize > blockerSize) {
      // ブロッカーが敗北、墓地へ移動
      moveUnitToGraveyard(blockerUnit, blockerPlayerKey, state, effectInterpreter, context);
      
      // アタッカーは生存するため、battle 情報をクリアするのみ
      if (attackerUnit.battle) {
        delete attackerUnit.battle;
      }
    } else if (attackerSize < blockerSize) {
      // アタッカーが敗北、墓地へ移動
      moveUnitToGraveyard(attackerUnit, attackerPlayerKey, state, effectInterpreter, context);
      
      // ブロッカーは生存するため、battle 情報をクリアするのみ
      if (blockerUnit.battle) {
        delete blockerUnit.battle;
      }
    } else {
      // 引き分け、双方が墓地へ移動
      // 順序はアタッカー -> ブロッカーの順で墓地へ送る
      moveUnitToGraveyard(attackerUnit, attackerPlayerKey, state, effectInterpreter, context);
      moveUnitToGraveyard(blockerUnit, blockerPlayerKey, state, effectInterpreter, context);
    }
  };
}

