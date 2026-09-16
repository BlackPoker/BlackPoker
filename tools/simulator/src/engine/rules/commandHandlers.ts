import type { EffectInterpreter } from "./EffectInterpreter";
import { ActionDefinition } from "../../domain/rules/RulePackage";
import { getOpponentPlayerKey } from "./playerUtils";
import { isSoldierType, isLegalBlockerCandidate, isCharacterComponent, hasUnitLabel, getCharacterType } from "./characterUtils";
import { CommandHandler, finalizeRequestKeyCards, cancelStageRequest } from "./CommandRegistry";


import { ExpressionEvaluator } from "./ExpressionEvaluator";
import { AbilityEvaluator } from "./AbilityEvaluator";
import { TurnManager } from "./TurnManager";
import { calculateDamageJudge, applyDamageJudgeResult } from "./damageJudgeUtils";
import { isCardInGameZones } from "./cardUtils";
import { deriveRuntimeShuffleSeed, shuffleDeterministic } from "../random/DeterministicShuffle";
import { SeededRandom } from "../random/RandomSource";


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

    // 手札からキーカードを取り除き（残っていれば）、fog 領域へ移動
    if (keyCard) {
      let fromZone = "request";
      if (Array.isArray(player.hand)) {
        const idx = player.hand.findIndex((c: any) => c.id === keyCard.id);
        if (idx !== -1) {
          player.hand.splice(idx, 1);
          fromZone = "hand";
        }
      }
      if (effectInterpreter) {
        effectInterpreter.dispatchEvent(
          {
            type: "cardMoved",
            payload: {
              card: keyCard,
              fromZone,
              toZone: "fog",
              playerKey: context.playerKey,
            },
          },
          context
        );
      }
    }


    const cardIdPart = keyCard?.id ? `-${keyCard.id}` : "";
    const newFog = {
      fogId: `fog-${context.playerKey}-${component}${cardIdPart}-${context.state.stateVersion || 1}`,
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
 * コンポーネント定義およびカード情報からフィールド配置用ユニットオブジェクトを構築します。
 * SSOT: labels / kind はコンポーネント定義（ComponentDefinition）を正とします。
 */
export function buildFieldUnitFromComponent(params: {
  componentId: string;
  playerKey: string;
  card?: any;
  face?: "up" | "down" | string;
  state?: "charge" | "drive" | string;
  components?: readonly any[];
  stateVersion?: number;
  turnCount?: number;
  disambiguator?: string | number;
}): any {
  const {
    componentId,
    playerKey,
    card,
    face = "up",
    state = "charge",
    components,
    stateVersion = 1,
    turnCount = 1,
    disambiguator,
  } = params;

  // コンポーネント定義から kind, labels を動的に解決
  const compDef = components?.find((c: any) => c.id === componentId);
  const kind = compDef?.display?.kind || compDef?.properties?.kind || compDef?.name || "ユニット";
  // labels は Component Definition を SSOT とする
  const rawLabels = compDef?.properties?.labels || compDef?.display?.labels;
  const labels = Array.isArray(rawLabels) ? [...rawLabels] : ["攻撃", "防御"];

  const cardIdPart = card?.id ? `-${card.id}` : "";
  const disamPart = disambiguator !== undefined ? `-${disambiguator}` : "";
  const unitId = `unit-${playerKey}-${componentId}${cardIdPart}${disamPart}-${stateVersion}`;

  return {
    unitId,
    kind,
    componentId,
    state,
    face,
    cards: card ? [card] : [],
    labels: [...labels],
    enteredTurn: turnCount,
    enteredFieldTurn: turnCount,
    enteredFieldBeforeGame: false,
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

    const newUnit = buildFieldUnitFromComponent({
      componentId: component,
      playerKey: context.playerKey,
      card: unitCard,
      face: face || "up",
      state: state || "charge",
      components: context.components,
      stateVersion: context.state.stateVersion || 1,
      turnCount: context.state.turnCount ?? 1,
    });

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
 * deployTopCardsAsUnits: デッキやライフ等のトップから指定枚数のカードをユニットとして場に配置する汎用プリミティブ。
 * 公式ルール5.4.4に基づく部分解決（要求枚数 > 残存枚数 の場合でも残存分を配置して正常完了）を保証します。
 */
export function deployTopCardsAsUnitsHandler(effectInterpreter: EffectInterpreter): CommandHandler {
  return (args, context) => {
    const { sourceZone, player: playerSpec, count, component, face, state } = args;

    // 1. sourceZone の厳密バリデーション (必須・空文字不可・対応ゾーン)
    if (typeof sourceZone !== "string" || sourceZone.trim().length === 0) {
      throw new Error("deployTopCardsAsUnits: sourceZone は必須です");
    }
    if (sourceZone !== "life") {
      throw new Error(`deployTopCardsAsUnits: 未対応の sourceZone です: '${sourceZone}'`);
    }

    // 2. player の厳密バリデーション (必須・空文字不可・有効値)
    if (typeof playerSpec !== "string" || playerSpec.trim().length === 0) {
      throw new Error("deployTopCardsAsUnits: player は必須です");
    }
    let targetPlayerKey: string;
    if (playerSpec === "self" || playerSpec === "controller") {
      targetPlayerKey = context.playerKey;
    } else if (playerSpec === "opponent") {
      targetPlayerKey = getOpponentPlayerKey(context.playerKey, context.state);
    } else {
      throw new Error(`deployTopCardsAsUnits: 未知の player 指定です: '${playerSpec}'`);
    }

    // 3. count の厳密バリデーション (非負整数・有限値)
    if (typeof count !== "number" || !Number.isFinite(count) || count < 0 || !Number.isInteger(count)) {
      throw new Error(`deployTopCardsAsUnits: count には0以上の整数を指定してください (指定値: ${count})`);
    }

    // 4. component の厳密バリデーション (必須・空文字不可・実在・type === 'character')
    if (typeof component !== "string" || component.trim().length === 0) {
      throw new Error("deployTopCardsAsUnits: component は必須です");
    }
    const compDef = context.components?.find((c: any) => c.id === component);
    if (!compDef) {
      throw new Error(`deployTopCardsAsUnits: コンポーネントが見つかりません: '${component}'`);
    }
    if (compDef.type !== "character") {
      throw new Error(`deployTopCardsAsUnits: ユニット生成可能なコンポーネントではありません (type: '${compDef.type}'): '${component}'`);
    }

    // 5. face の厳密バリデーション (必須・'up' または 'down')
    if (typeof face !== "string" || (face !== "up" && face !== "down")) {
      throw new Error(`deployTopCardsAsUnits: face は 'up' または 'down' である必要があります (指定値: ${JSON.stringify(face)})`);
    }

    // 6. state の厳密バリデーション (必須・'charge' または 'drive')
    if (typeof state !== "string" || (state !== "charge" && state !== "drive")) {
      throw new Error(`deployTopCardsAsUnits: state は 'charge' または 'drive' である必要があります (指定値: ${JSON.stringify(state)})`);
    }

    // 7. 対象プレイヤーおよび領域 state invariants の厳密検証 (malformed state の fail-closed)
    const targetPlayer = context.state.players?.[targetPlayerKey];
    if (!targetPlayer) {
      throw new Error(`deployTopCardsAsUnits: 対象プレイヤーが見つかりません: ${targetPlayerKey}`);
    }
    if (!Array.isArray(targetPlayer.life)) {
      throw new Error("deployTopCardsAsUnits: 対象プレイヤーのライフ領域が不正です (life missing or not array)");
    }
    if (!Array.isArray(targetPlayer.field)) {
      throw new Error("deployTopCardsAsUnits: 対象プレイヤーのフィールド領域が不正です (field missing or not array)");
    }

    if (count === 0) {
      return; // 正常 no-op
    }

    // 8. 公式ルール5.4.4 部分解決 (availableCount との min)
    const availableCount = targetPlayer.life.length;
    const actualCount = Math.min(count, availableCount);

    if (actualCount === 0) {
      // ライフ0枚などの正当な0枚配置: 正常終了
      return;
    }

    for (let i = 0; i < actualCount; i++) {
      const card = targetPlayer.life.shift();
      if (!card) break;

      const newUnit = buildFieldUnitFromComponent({
        componentId: component,
        playerKey: targetPlayerKey,
        card,
        face,
        state,
        components: context.components,
        stateVersion: context.state.stateVersion || 1,
        turnCount: context.state.turnCount ?? 1,
        disambiguator: i,
      });

      targetPlayer.field.push(newUnit);

      // 各カードについて cardMoved イベントを発行 (revealCard は発行しない)
      const event = {
        type: "cardMoved",
        payload: {
          card: card,
          fromZone: sourceZone,
          toZone: "field",
          playerKey: targetPlayerKey,
          targetUnitId: newUnit.unitId,
          cause: {
            type: "effect",
            command: "deployTopCardsAsUnits",
            actionId: context.currentAction?.id,
            requestId: context.currentRequest?.id,
          },
        },
      };
      effectInterpreter.dispatchEvent(event, context);
    }
  };
}

/**
 * mountUnit: ユニットの上にカードを重ねて装備する（装備兵化）
 */
export function mountUnitHandler(effectInterpreter: EffectInterpreter): CommandHandler {
  return (args, context) => {
    const { target, card } = args;
    const player = context.state.players[context.playerKey];
    if (!player) throw new Error(`プレイヤーが見つかりません: ${context.playerKey}`);

    let targetUnit: any = undefined;
    let targetUnitId: string | undefined = undefined;

    if (typeof target === "string" && target.startsWith("selection.")) {
      const selId = target.replace("selection.", "");
      const selected = context.selections?.[selId];
      if (Array.isArray(selected) && selected.length > 0) {
        targetUnitId = typeof selected[0] === "string" ? selected[0] : selected[0]?.unitId;
      }
    }
    if (!targetUnitId && context.targetComponent) {
      targetUnit = context.targetComponent;
      targetUnitId = targetUnit.unitId;
    }
    if (!targetUnitId && context.targetUnitId) {
      targetUnitId = context.targetUnitId;
    }

    if (!targetUnit && targetUnitId) {
      targetUnit = player.field?.find((u: any) => u.unitId === targetUnitId);
    }

    if (!targetUnit) return;

    let mountCard: any = undefined;
    if (typeof card === "string" && card.startsWith("selection.")) {
      const selId = card.replace("selection.", "");
      const selected = context.selections?.[selId];
      if (Array.isArray(selected) && selected.length > 0) {
        const val = selected[0];
        mountCard = typeof val === "string" ? player.hand?.find((c: any) => c.id === val) : val;
      }
    }
    if (!mountCard && (card === "key" || card === "keyCard" || context.keyCard)) {
      mountCard = context.keyCard;
    }

    if (!mountCard) return;

    if (Array.isArray(player.hand)) {
      player.hand = player.hand.filter((c: any) => c.id !== mountCard.id);
    }

    if (!Array.isArray(targetUnit.cards)) {
      targetUnit.cards = [];
    }
    targetUnit.cards.push(mountCard);

    const armedDef = context.components?.find((c: any) => c.id === "character.armedSoldier");
    targetUnit.kind = armedDef?.display?.kind || armedDef?.name || "装備兵";
    targetUnit.componentId = "character.armedSoldier";

    if (mountCard.rank === "A" || String(mountCard.rank).toUpperCase() === "A") {
      if (!targetUnit.labels) targetUnit.labels = [];
      if (!targetUnit.labels.includes("速攻") && !targetUnit.labels.includes("haste")) {
        targetUnit.labels.push("速攻");
      }
    }

    const event = {
      type: "cardMoved",
      payload: {
        card: mountCard,
        fromZone: "hand",
        toZone: "field",
        playerKey: context.playerKey,
        targetUnitId: targetUnit.unitId,
        cause: { type: "effect", command: "mountUnit" },
      },
    };
    effectInterpreter.dispatchEvent(event, context);
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
 * cancelRequest: 指定されたリクエストをキャンセルし、ステージから即座に取り除く
 */
export function cancelRequestHandler(
  expressionEvaluator: ExpressionEvaluator,
  effectInterpreter?: EffectInterpreter
): CommandHandler {
  return (args, context) => {
    const { target } = args;
    const requestId = expressionEvaluator.resolveBindingValue(target, context);
    if (!requestId) {
      throw new Error("キャンセル対象のリクエストIDが解決できません。");
    }

    cancelStageRequest(requestId, context, effectInterpreter);
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
    TurnManager.endTurn(context.state, context);
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

function resolveSelectionCard(cardRef: any, selections?: Record<string, any>): any {
  if (typeof cardRef !== "string" || !selections) return cardRef;
  let key = cardRef;
  if (key.startsWith("$selections.")) {
    key = key.replace("$selections.", "");
  } else if (key.startsWith("selection.")) {
    key = key.replace("selection.", "");
  } else if (key.startsWith("$")) {
    key = key.slice(1);
  }
  if (key.endsWith("[0]")) {
    key = key.slice(0, -3);
  }
  if (selections[key] !== undefined) {
    const sel = selections[key];
    return Array.isArray(sel) ? sel[0] : sel;
  }
  return cardRef;
}

/**
 * moveCard: カードのゾーン間移動
 */
export function moveCardHandler(effectInterpreter?: EffectInterpreter): CommandHandler {
  return (args, context) => {
    let cardToMove = resolveSelectionCard(args.card ?? args.target, context.selections);

    const fromZone = args.from;
    const toZone = args.to;
    const playerKey = args.player === "opponent"
      ? getOpponentPlayerKey(context.playerKey, context.state)
      : context.playerKey;
    const player = context.state.players?.[playerKey];
    if (!player) throw new Error(`プレイヤーが見つかりません: ${playerKey}`);

    let sourceCards: any[] | undefined;
    if (fromZone === "pack") {
      sourceCards = player.pack?.cards;
    } else if (fromZone === "hand") {
      sourceCards = player.hand;
    } else if (fromZone === "grave") {
      sourceCards = player.grave;
    } else if (fromZone === "life") {
      sourceCards = player.life;
    } else {
      throw new Error(`moveCard: 未対応の移動元ゾーンです (${fromZone})`);
    }

    if (!Array.isArray(sourceCards)) {
      throw new Error(`moveCard: 移動元ゾーン '${fromZone}' にカード配列が存在しません`);
    }

    const cardId = typeof cardToMove === "object" && cardToMove !== null ? (cardToMove.id ?? cardToMove.unitId) : cardToMove;
    const cardIdx = sourceCards.findIndex((c: any) => c && (c.id === cardId || c.unitId === cardId || c === cardToMove));
    if (cardIdx === -1) {
      throw new Error(`moveCard: 移動元ゾーン '${fromZone}' に対象カードが見つかりません: ${cardId}`);
    }

    const candidate = sourceCards[cardIdx];
    if (fromZone === "grave") {
      if (candidate.unitId || Array.isArray(candidate.cards) || candidate.kind || !candidate.suit || !candidate.rank) {
        throw new Error(`moveCard: 墓地内のUnit wrapperまたは未対応形式のエントリは移動できません: ${cardId}`);
      }
    }

    const [actualCard] = sourceCards.splice(cardIdx, 1);
    if (fromZone === "pack" && player.pack) {
      player.pack.count = player.pack.cards?.length ?? 0;
    }

    let destCards: any[] | undefined;
    if (toZone === "hand") {
      if (!Array.isArray(player.hand)) player.hand = [];
      destCards = player.hand;
    } else if (toZone === "grave") {
      if (!Array.isArray(player.grave)) player.grave = [];
      destCards = player.grave;
    } else if (toZone === "pack") {
      if (!player.pack) player.pack = { count: 0, opened: false, cards: [] };
      if (!Array.isArray(player.pack.cards)) player.pack.cards = [];
      destCards = player.pack.cards;
    } else if (toZone === "life") {
      if (!Array.isArray(player.life)) player.life = [];
      destCards = player.life;
    } else {
      throw new Error(`moveCard: 未対応の移動先ゾーンです (${toZone})`);
    }

    destCards.push(actualCard);
    if (toZone === "pack" && player.pack) {
      player.pack.count = player.pack.cards?.length ?? 0;
    }

    if (effectInterpreter) {
      effectInterpreter.dispatchEvent(
        {
          type: "cardMoved",
          payload: {
            card: actualCard,
            fromZone,
            toZone,
            playerKey,
            cause: {
              type: "effect",
              actionId: context.currentAction?.id || context.currentRequest?.actionId,
              requestId: context.currentRequest?.id,
            },
          },
        },
        context
      );
    }
  };
}

/**
 * setZoneState: ゾーンの状態プロパティを更新
 */
export function setZoneStateHandler(): CommandHandler {
  return (args, context) => {
    const { player: playerSpec = "controller", zone, property, value } = args;
    const playerKey = playerSpec === "opponent"
      ? getOpponentPlayerKey(context.playerKey, context.state)
      : context.playerKey;
    const player = context.state.players?.[playerKey];
    if (!player) throw new Error(`プレイヤーが見つかりません: ${playerKey}`);

    const targetZone = player[zone];
    if (targetZone === undefined || targetZone === null) {
      throw new Error(`setZoneState: ゾーン '${zone}' が見つかりません`);
    }

    if (typeof property !== "string" || property.includes(".")) {
      throw new Error(`setZoneState: 不正なプロパティ名です: ${property}`);
    }

    targetZone[property] = value;
  };
}

/**
 * revealCard: カードの一過性公開イベントを発行
 */
export function revealCardHandler(effectInterpreter?: EffectInterpreter): CommandHandler {
  return (args, context) => {
    let cardToReveal = resolveSelectionCard(args.card ?? args.selection ?? args.target, context.selections);

    let actualCard = cardToReveal;
    let detectedSourceZone = args.sourceZone || args.from;
    const player = context.state.players?.[context.playerKey];

    if (typeof cardToReveal === "string") {
      if (player) {
        // Generic zone resolver for known zones (life, pack, hand)
        const inPack = Array.isArray(player.pack?.cards) ? player.pack.cards.find((c: any) => c?.id === cardToReveal) : undefined;
        const inHand = Array.isArray(player.hand) ? player.hand.find((c: any) => c?.id === cardToReveal) : undefined;
        const inLife = Array.isArray(player.life) ? player.life.find((c: any) => c?.id === cardToReveal) : undefined;

        actualCard = inPack || inHand || inLife || { id: cardToReveal };
        if (!detectedSourceZone) {
          if (inLife) detectedSourceZone = "life";
          else if (inPack) detectedSourceZone = "pack";
          else if (inHand) detectedSourceZone = "hand";
        }
      }
    } else if (typeof cardToReveal === "object" && cardToReveal !== null) {
      if (!detectedSourceZone && player) {
        if (Array.isArray(player.life) && player.life.some((c: any) => c?.id === cardToReveal.id)) {
          detectedSourceZone = "life";
        } else if (Array.isArray(player.pack?.cards) && player.pack.cards.some((c: any) => c?.id === cardToReveal.id)) {
          detectedSourceZone = "pack";
        } else if (Array.isArray(player.hand) && player.hand.some((c: any) => c?.id === cardToReveal.id)) {
          detectedSourceZone = "hand";
        }
      }
    }

    const target = args.target || "all";
    const event = {
      type: "cardRevealed",
      payload: {
        playerKey: context.playerKey,
        target,
        card: actualCard,
        sourceZone: detectedSourceZone || "pack",
      },
    };

    if (effectInterpreter) {
      effectInterpreter.dispatchEvent(event, context);
    }
  };
}

/**
 * shuffleZone: ゾーンカードの決定論的シャッフル
 */
export function shuffleZoneHandler(effectInterpreter?: EffectInterpreter): CommandHandler {
  return (args, context) => {
    const { player: playerSpec, zone } = args;
    if (zone !== "life") {
      throw new Error(`shuffleZone: 未対応のシャッフル対象ゾーンです (${zone})。Phase 1.0 では 'life' のみサポートしています。`);
    }

    const playerKey = playerSpec === "opponent"
      ? getOpponentPlayerKey(context.playerKey, context.state)
      : (playerSpec === "controller" || playerSpec === "self" || !playerSpec ? context.playerKey : playerSpec);
    const player = context.state.players?.[playerKey];
    if (!player) throw new Error(`shuffleZone: プレイヤーが見つかりません: ${playerKey}`);

    if (!Array.isArray(player.life)) {
      throw new Error(`shuffleZone: プレイヤー '${playerKey}' のライフ配列が存在しません`);
    }

    const matchSeed = context.matchSeed;
    if (matchSeed === undefined || typeof matchSeed !== "number" || isNaN(matchSeed)) {
      throw new Error("shuffleZone: matchSeed is required for deterministic shuffle but was undefined. Fallback is prohibited.");
    }

    // 決定論的シャッフルカウンタの更新
    const counter = (context.state.runtimeShuffleCount = (context.state.runtimeShuffleCount || 0) + 1);
    const shuffleSeed = deriveRuntimeShuffleSeed(matchSeed, counter);
    const rng = new SeededRandom(shuffleSeed);

    player.life = shuffleDeterministic(player.life, rng);

    if (effectInterpreter) {
      effectInterpreter.dispatchEvent(
        {
          type: "zoneShuffled",
          payload: {
            playerKey,
            zone: "life",
            cardCount: player.life.length,
            cause: {
              type: "effect",
              actionId: context.currentAction?.id || context.currentRequest?.actionId,
              requestId: context.currentRequest?.id,
            },
          },
        },
        context
      );
    }
  };
}



