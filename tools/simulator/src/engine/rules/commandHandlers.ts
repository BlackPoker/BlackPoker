import type { EffectInterpreter } from "./EffectInterpreter";
import { ActionDefinition } from "../../domain/rules/RulePackage";
import { getOpponentPlayerKey } from "./playerUtils";
import { isSoldierType, isLegalBlockerCandidate, isCharacterComponent, hasUnitLabel } from "./characterUtils";
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
    const { target, attackers, defender } = args;
    const state = context.state;

    // ディフェンダープレイヤーの解決（指定がない場合や "opponent" の場合は対戦相手を自動解決）
    let defenderPlayerKey: string | undefined = undefined;
    if (defender === "opponent" || !defender) {
      defenderPlayerKey = getOpponentPlayerKey(context.playerKey, state);
    } else if (defender === "targetPlayer" && context.targetPlayerKey) {
      defenderPlayerKey = context.targetPlayerKey;
    } else {
      defenderPlayerKey = expressionEvaluator.resolveBindingValue(defender, context) || getOpponentPlayerKey(context.playerKey, state);
    }

    if (!defenderPlayerKey || !state.players[defenderPlayerKey]) {
      throw new Error(`ディフェンダーとなるプレイヤーが見つかりません: ${defenderPlayerKey}`);
    }

    // アタッカーユニット群の解決
    let attackerUnits: any[] = [];
    if (attackers !== undefined) {
      const resolved = expressionEvaluator.resolveBindingValue(attackers, context);
      if (Array.isArray(resolved)) {
        const player = state.players[context.playerKey];
        for (const val of resolved) {
          const unitId = typeof val === "string" ? val : val?.unitId;
          const u = player?.field?.find((unit: any) => unit.unitId === unitId);
          if (u) attackerUnits.push(u);
        }
      }
    } else if (context.targetComponent) {
      attackerUnits.push(context.targetComponent);
    } else if (target) {
      const resolvedTargetId = expressionEvaluator.resolveBindingValue(target, context);
      if (resolvedTargetId) {
        const player = state.players[context.playerKey];
        if (player && player.field) {
          const u = player.field.find((unit: any) => unit.unitId === resolvedTargetId);
          if (u) attackerUnits.push(u);
        }
      }
    }

    // 0体アタックの場合は何もせず正常終了（戦闘状態をセットしない）
    if (attackerUnits.length === 0) {
      return;
    }

    const player = state.players[context.playerKey];

    for (const attackerUnit of attackerUnits) {
      // 1. アタッカーが実行プレイヤーの field に存在することの確認
      const exists = player?.field?.some((u: any) => u.unitId === attackerUnit.unitId);
      if (!exists) {
        throw new Error(`アタッカー (${attackerUnit.unitId}) は自分のフィールドに存在するユニットである必要があります。`);
      }

      // 2. アタッカーが character component であることの確認
      if (!isCharacterComponent(attackerUnit, context.components)) {
        throw new Error(`アタッカー (${attackerUnit.unitId}) はキャラクターである必要があります。`);
      }

      // 3. アタッカーが攻撃可能状態であることの確認 (チャージ状態)
      if (attackerUnit.state !== "charge") {
        throw new Error(`ドライブ状態のキャラクターはアタッカーに指定できません。現在: ${attackerUnit.state}`);
      }

      // 4. アタッカーが「攻撃」ラベルを保持していることの確認
      if (!hasUnitLabel(attackerUnit, "攻撃", context.components)) {
        throw new Error(`攻撃ラベルを持たないキャラクターはアタッカーに指定できません。 (${attackerUnit.unitId})`);
      }

      // アタッカーユニットに戦闘一時情報を記録
      attackerUnit.battle = {
        role: "attacker",
        targetPlayerKey: defenderPlayerKey,
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
    }
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
    const { assignments: rawAssignments, blocker } = args;

    let assignments: any[] = [];
    if (rawAssignments !== undefined) {
      const resolved = expressionEvaluator.resolveBindingValue(rawAssignments, context);
      if (Array.isArray(resolved)) {
        assignments = resolved;
      }
    } else if (context.selections?.blocks) {
      assignments = context.selections.blocks;
    } else if (context.targetComponent || blocker) {
      // 後方互換性（単体指定）
      const singleBlocker = context.targetComponent || (typeof blocker === "string" ? expressionEvaluator.resolveBindingValue(blocker, context) : blocker);
      if (singleBlocker) {
        const opponentKey = getOpponentPlayerKey(context.playerKey, state);
        const opponent = state.players[opponentKey];
        const attacker = opponent?.field?.find((u: any) => u.battle?.role === "attacker");
        if (attacker) {
          assignments = [{ sourceUnitId: attacker.unitId, selectedUnitIds: [singleBlocker.unitId || singleBlocker] }];
        }
      }
    }

    const player = state.players[context.playerKey];
    const usedBlockerIds = new Set<string>();

    for (const assignment of assignments) {
      const { sourceUnitId, selectedUnitIds } = assignment;
      if (!selectedUnitIds || selectedUnitIds.length === 0) {
        continue;
      }

      // 相手アタッカーの存在確認
      const opponentKey = getOpponentPlayerKey(context.playerKey, state);
      const opponent = state.players[opponentKey];
      const attackerUnit = opponent?.field?.find((u: any) => u.unitId === sourceUnitId);
      if (!attackerUnit || attackerUnit.battle?.role !== "attacker") {
        throw new Error(`ブロック対象のアタッカーが見つかりません: ${sourceUnitId}`);
      }

      const blockerUnits: any[] = [];
      for (const blockerId of selectedUnitIds) {
        if (usedBlockerIds.has(blockerId)) {
          throw new Error(`同一ブロッカーが重複して割り当てられています: ${blockerId}`);
        }
        usedBlockerIds.add(blockerId);

        const unit = player?.field?.find((u: any) => u.unitId === blockerId);
        if (!unit) {
          throw new Error(`ブロッカーは自分のフィールドに存在するユニットである必要があります。 (${blockerId})`);
        }

        if (unit.state !== "charge") {
          throw new Error(`ドライブ状態のキャラクターはブロッカーに指定できません。現在: ${unit.state}`);
        }

        if (!isLegalBlockerCandidate(unit, context.components)) {
          throw new Error(`防御ラベルを持たないキャラクターはブロッカーに指定できません。`);
        }

        blockerUnits.push(unit);
      }

      // 複数ブロッカーの場合、全員が soldier タイプであることを検証
      if (blockerUnits.length >= 2) {
        const allSoldiers = blockerUnits.every((u) => isSoldierType(u, context.components));
        if (!allSoldiers) {
          throw new Error(`1アタッカーに対する複数ブロックは全員兵士タイプである必要があります。`);
        }
      }

      // 各ブロッカーに戦闘情報を設定して drive に移行し、イベント発行
      for (const blockerUnit of blockerUnits) {
        blockerUnit.battle = {
          role: "blocker",
          blocksUnitId: sourceUnitId,
        };

        const oldState = blockerUnit.state;
        blockerUnit.state = "drive";

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
      }
    }
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
      // ブロッカー不在時は、アタッカーのサイズ分の直接ダメージを対戦相手に与える
      const attackerSize = abilityEvaluator.calculateUnitSize(attackerUnit, state.players[attackerPlayerKey]);
      const targetPlayerKey = attackerUnit.battle?.targetPlayerKey || (attackerPlayerKey === "p1" ? "p2" : "p1");
      
      const damageContext = {
        ...context,
        playerKey: attackerPlayerKey,
        targetPlayerKey,
      };

      // dealDamage 効果コマンドを呼び出し
      ((effectInterpreter as any).registry).execute(
        "dealDamage",
        { target: "targetPlayer", amount: attackerSize },
        damageContext
      );

      // アタッカーの戦闘状態をクリア
      if (attackerUnit.battle) {
        delete attackerUnit.battle;
      }
      return;
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

