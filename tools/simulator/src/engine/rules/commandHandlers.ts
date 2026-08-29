import type { EffectInterpreter } from "./EffectInterpreter";
import { ActionDefinition } from "../../domain/rules/RulePackage";
import { getOpponentPlayerKey } from "./playerUtils";
import { isSoldierType, isLegalBlockerCandidate, isCharacterComponent, hasUnitLabel, getCharacterType } from "./characterUtils";
import { CommandHandler } from "./CommandRegistry";
import { ExpressionEvaluator } from "./ExpressionEvaluator";
import { AbilityEvaluator } from "./AbilityEvaluator";
import { TurnManager } from "./TurnManager";
import { calculateDamageJudge, applyDamageJudgeResult } from "./damageJudgeUtils";

/**
 * createFog: フォグの生成と配置
 */
export function createFogHandler(
  expressionEvaluator: ExpressionEvaluator,
  effectInterpreter?: EffectInterpreter
): CommandHandler {
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

    const keyCard = context.keyCard;

    // 手札からキーカードを取り除き、fog 領域へ移動
    if (keyCard && Array.isArray(player.hand)) {
      const idx = player.hand.findIndex((c: any) => c.id === keyCard.id);
      if (idx !== -1) {
        player.hand.splice(idx, 1);
        if (effectInterpreter) {
          effectInterpreter.dispatchEvent(
            {
              type: "cardMoved",
              payload: {
                card: keyCard,
                fromZone: "hand",
                toZone: "fog",
                playerKey: context.playerKey,
              },
            },
            context
          );
        }
      }
    }

    const newFog = {
      fogId: `fog-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      componentId: component,
      card: keyCard, // キーカードを配置
      bindings: resolvedBindings,
    };

    if (!Array.isArray(player.fog)) {
      player.fog = [];
    }
    player.fog.push(newFog);
  };
}

/**
 * summonUnit: ユニットの召喚
 */
export function summonUnitHandler(): CommandHandler {
  return (args, context) => {
    const { component, face, state, card } = args;
    const player = context.state.players[context.playerKey];
    if (!player) throw new Error(`プレイヤーが見つかりません: ${context.playerKey}`);

    // コンポーネント定義から kind, labels を動的に解決
    const compDef = context.components?.find((c: any) => c.id === component);
    const kind = compDef?.display?.kind || compDef?.properties?.kind || compDef?.name || "ユニット";
    const labels = compDef?.properties?.labels || compDef?.display?.labels || ["攻撃", "防御"];

    // 召喚に使用するカードの解決 (keyCard または selection.<id>)
    let unitCard: any = undefined;
    if (typeof card === "string" && card.startsWith("selection.")) {
      const selId = card.replace("selection.", "");
      const selected = context.selections?.[selId];
      if (Array.isArray(selected) && selected.length > 0) {
        const val = selected[0];
        if (typeof val === "string") {
          unitCard = player.hand?.find((c: any) => c.id === val);
        } else {
          unitCard = val;
        }
      }
    } else if (context.keyCard) {
      unitCard = context.keyCard;
    }

    // card が指定されているにもかかわらずカードが解決できない場合は、cards: [] の空ユニット生成を阻止
    if (card && !unitCard) {
      return;
    }

    const newUnit = {

      unitId: `unit-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      kind: kind,
      componentId: component,
      state: state || "charge",
      face: face || "up",
      cards: unitCard ? [unitCard] : [],
      labels: [...labels],
      enteredTurn: context.state.turnCount ?? 1,
    };

    // 手札から召喚カードを消費（手札にある場合のみ）
    if (unitCard && Array.isArray(player.hand)) {
      player.hand = player.hand.filter((c: any) => c.id !== unitCard.id);
    }

    if (!Array.isArray(player.field)) {
      player.field = [];
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
    const targetUnit = target === "target" ? context.targetComponent : null;
    if (!targetUnit) return;

    // targetUnit が存在するプレイヤーを特定
    let ownerPlayerKey = context.playerKey;
    for (const [pKey, p] of Object.entries<any>(context.state.players || {})) {
      if (p.field && p.field.some((u: any) => u.unitId === targetUnit.unitId)) {
        ownerPlayerKey = pKey;
        break;
      }
    }

    const player = context.state.players[ownerPlayerKey];
    if (!player) throw new Error(`プレイヤーが見つかりません: ${ownerPlayerKey}`);

    // フィールドから除外
    if (player.field) {
      player.field = player.field.filter((u: any) => u.unitId !== targetUnit.unitId);
    }

    // 墓地へ追加
    if (!player.grave) {
      player.grave = [];
    }
    player.grave.push(targetUnit);

    // 各カードについて cardMoved イベントを発行
    if (targetUnit.cards && Array.isArray(targetUnit.cards)) {
      const charType = getCharacterType(targetUnit, context?.components);
      for (const card of targetUnit.cards) {
        const event = {
          type: "cardMoved",
          payload: {
            card: card,
            fromZone: "field",
            toZone: "grave",
            playerKey: ownerPlayerKey,
            cause: { type: "action", actionId: context.currentAction?.id || context.currentRequest?.actionId },
            characterType: charType || undefined,
          }
        };
        effectInterpreter.dispatchEvent(event, context);
      }
    }
  };
}

/**
 * drawFromLife: ライフの上からカードを指定枚数手札へ引く (汎用ドロー)
 */
export function drawFromLifeHandler(
  expressionEvaluator: ExpressionEvaluator,
  effectInterpreter: EffectInterpreter
): CommandHandler {
  return (args, context) => {
    let targetPlayerKey = context.playerKey;
    if (args.target) {
      const resolvedTarget = expressionEvaluator.resolveBindingValue(args.target, context);
      if (typeof resolvedTarget === "string" && context.state.players?.[resolvedTarget]) {
        targetPlayerKey = resolvedTarget;
      }
    }

    const player = context.state.players[targetPlayerKey];
    if (!player) return;

    if (!player.life) player.life = [];
    if (!player.hand) player.hand = [];

    const currentLifeCount = player.life.length;
    let baseAmount = args.amount !== undefined ? args.amount : 1;
    let resolvedAmount = expressionEvaluator.resolveBindingValue(baseAmount, context);
    if (typeof resolvedAmount !== "number" || resolvedAmount <= 0) return;

    // 条件付き枚数判定 (解決時のライフ枚数を基準)
    if (args.whenLifeAtMost && typeof args.whenLifeAtMost.count === "number") {
      if (currentLifeCount <= args.whenLifeAtMost.count) {
        resolvedAmount = args.whenLifeAtMost.amount;
      }
    }

    const drawCount = Math.min(resolvedAmount, currentLifeCount);
    for (let i = 0; i < drawCount; i++) {
      const card = player.life.shift();
      if (!card) break;

      player.hand.push(card);

      const event = {
        type: "cardMoved",
        payload: {
          card,
          fromZone: "life",
          toZone: "hand",
          playerKey: targetPlayerKey,
          cause: {
            type: "action",
            actionId: context.currentAction?.id || context.currentRequest?.actionId,
          },
        },
      };
      effectInterpreter.dispatchEvent(event, context);
    }
  };
}

/**
 * discardCards: 指定されたカード群（手札等）を墓地へ送る
 */
export function discardCardsHandler(
  expressionEvaluator: ExpressionEvaluator,
  effectInterpreter: EffectInterpreter
): CommandHandler {
  return (args, context) => {
    const { player: targetPlayer = "self", cards, cause = "action" } = args;
    const playerKey = targetPlayer === "opponent"
      ? getOpponentPlayerKey(context.playerKey, context.state)
      : context.playerKey;
    const player = context.state.players[playerKey];
    if (!player || !Array.isArray(player.hand)) return;

    const resolvedCardIds: string[] = expressionEvaluator.resolveBindingValue(cards, context) || [];
    if (!Array.isArray(resolvedCardIds) || resolvedCardIds.length === 0) return;

    if (!Array.isArray(player.grave)) player.grave = [];

    const discarded: any[] = [];
    player.hand = player.hand.filter((c: any) => {
      if (resolvedCardIds.includes(c.id)) {
        discarded.push(c);
        return false;
      }
      return true;
    });

    for (const card of discarded) {
      player.grave.push(card);
      effectInterpreter.dispatchEvent(
        {
          type: "cardMoved",
          payload: {
            card,
            fromZone: "hand",
            toZone: "grave",
            playerKey,
            cause: typeof cause === "string" ? cause : { type: "action", actionId: context.currentAction?.id },
          },
        },
        context
      );
    }
  };
}

/**
 * setAllUnitState: 指定領域のすべてのユニットの状態 (state: charge / drive) を一括更新
 */
export function setAllUnitStateHandler(
  expressionEvaluator: ExpressionEvaluator,
  effectInterpreter: EffectInterpreter
): CommandHandler {
  return (args, context) => {
    const { relation = "self", zone = "field", componentType = "character", state: targetState } = args;
    if (!targetState) return;

    let targetPlayerKey = context.playerKey;
    if (relation === "opponent") {
      targetPlayerKey = getOpponentPlayerKey(context.playerKey, context.state);
    }

    const player = context.state.players[targetPlayerKey];
    if (!player) return;

    const units = player[zone];
    if (!Array.isArray(units)) return;

    const components = context.components || [];

    for (const unit of units) {
      if (componentType === "character") {
        const isChar = isCharacterComponent(unit, components);
        if (!isChar) continue;
      } else if (unit.componentId !== componentType) {
        continue;
      }

      if (unit.state !== targetState) {
        const prevState = unit.state;
        unit.state = targetState;
        const event = {
          type: "unitStateChanged",
          payload: {
            unitId: unit.unitId,
            fromState: prevState,
            toState: targetState,
            playerKey: targetPlayerKey,
          },
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
    let targetPlayerKey = "";
    if (target) {
      const resolvedTarget = expressionEvaluator.resolveBindingValue(target, context);
      if (typeof resolvedTarget === "string") {
        if (resolvedTarget === "targetPlayer" && context.targetPlayerKey) {
          targetPlayerKey = context.targetPlayerKey;
        } else if (context.state.players?.[resolvedTarget]) {
          targetPlayerKey = resolvedTarget;
        }
      }
    }
    if (!targetPlayerKey) {
      targetPlayerKey = context.targetPlayerKey || (context.playerKey === "p1" ? "p2" : "p1");
    }

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
    }

    // 防御側プレイヤー (defender) と攻撃側プレイヤー (attacker) の特定
    const defenderPlayerKey = state.nonTurnPlayer || (state.turnPlayer ? getOpponentPlayerKey(state.turnPlayer, state) : (context.playerKey === "p1" ? "p2" : "p1"));
    const defenderPlayer = state.players[defenderPlayerKey];
    const attackerPlayerKey = getOpponentPlayerKey(defenderPlayerKey, state);
    const attackerPlayer = state.players[attackerPlayerKey];

    const singleBlocker = context.targetComponent || (typeof blocker === "string" ? expressionEvaluator.resolveBindingValue(blocker, context) : blocker);
    if (singleBlocker) {
      const singleId = singleBlocker.unitId || singleBlocker;
      const attacker = attackerPlayer?.field?.find((u: any) => u.battle?.role === "attacker");
      if (attacker) {
        assignments = [{ sourceUnitId: attacker.unitId, selectedUnitIds: [singleId] }];
      }
    }

    const usedBlockerIds = new Set<string>();

    for (const assignment of assignments) {
      const { sourceUnitId, selectedUnitIds } = assignment;
      if (!selectedUnitIds || selectedUnitIds.length === 0) {
        continue;
      }

      // 相手アタッカーの存在確認
      const attackerUnit = attackerPlayer?.field?.find((u: any) => u.unitId === sourceUnitId);
      if (!attackerUnit || attackerUnit.battle?.role !== "attacker") {
        throw new Error(`ブロック対象のアタッカーが見つかりません: ${sourceUnitId}`);
      }

      const blockerUnits: any[] = [];
      for (const blockerId of selectedUnitIds) {
        if (usedBlockerIds.has(blockerId)) {
          throw new Error(`同一ブロッカーが重複して割り当てられています: ${blockerId}`);
        }
        usedBlockerIds.add(blockerId);

        const unit = defenderPlayer?.field?.find((u: any) => u.unitId === blockerId);
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

      // 各ブロッカーに戦闘情報を設定（※ブロッカーはdrive化せずcharge状態を維持）
      for (const blockerUnit of blockerUnits) {
        blockerUnit.battle = {
          role: "blocker",
          blocksUnitId: sourceUnitId,
        };
      }
    }
  };
}

export type { MoveUnitMetadata } from "./unitMovementUtils";
export { moveUnitToGraveyard } from "./unitMovementUtils";

/**
 * judgeDamage: 全アタッカーおよびブロッカーの戦闘を判定し、直接ダメージおよび敗北ユニットの墓地移動を行う
 * （アタッカー0体の場合は no-op で正常終了）
 */
export function judgeDamageHandler(
  abilityEvaluator: AbilityEvaluator,
  effectInterpreter: EffectInterpreter
): CommandHandler {
  return (args, context) => {
    // 1. Calculate Phase: effect-time 盤面を基準に全戦闘結果を確定
    const damageJudgeResult = calculateDamageJudge(context, abilityEvaluator);

    // 2. ActionRequest に解決結果 (DamageJudgeResult) を保持
    if (context.currentRequest) {
      context.currentRequest.result = {
        ...context.currentRequest.result,
        damageJudge: damageJudgeResult,
      };
    }

    // 3. Apply Phase: 確定結果を盤面に適用（直接ダメージ、墓地移動、battle cleanup）
    applyDamageJudgeResult(damageJudgeResult, context, effectInterpreter);
  };
}


