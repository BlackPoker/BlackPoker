import { ActionActivationCondition } from "../../domain/rules/RulePackage";
import { PlayerKey } from "../../domain/decision/DecisionSource";
import { getOpponentPlayerKey } from "./playerUtils";

export interface EvaluationResult {
  readonly isLegal: boolean;
  readonly reason?: string;
}

/**
 * アクションの起動条件 (activationCondition) を汎用評価する単一評価器 (SSOT)。
 * LegalPatternGenerator および ActionRequestValidator の双方が本評価器を使用します。
 * fail-closed 原則に基づき、評価不能またはプロパティ欠落時は false を返します。
 */
export class ActionActivationConditionEvaluator {
  public static evaluate(
    condition: ActionActivationCondition | undefined,
    context: {
      readonly state: any;
      readonly playerKey: PlayerKey;
    }
  ): EvaluationResult {
    if (!condition) {
      return { isLegal: true };
    }

    const conditionKeys = Object.keys(condition);
    if (conditionKeys.length === 0) {
      return { isLegal: false, reason: "起動条件オペレータが指定されていません" };
    }

    // サポートする condition operator: zoneState, zoneCount
    const unsupportedKeys = conditionKeys.filter((k) => k !== "zoneState" && k !== "zoneCount");
    if (unsupportedKeys.length > 0) {
      return {
        isLegal: false,
        reason: `未対応の起動条件オペレータが含まれています: ${unsupportedKeys.join(", ")}`,
      };
    }

    if (!condition.zoneState && !condition.zoneCount) {
      return { isLegal: false, reason: "対応可能な起動条件オペレータが存在しません" };
    }

    if (condition.zoneState) {
      const stateResult = this.evaluateZoneState(condition.zoneState, context);
      if (!stateResult.isLegal) {
        return stateResult;
      }
    }

    if (condition.zoneCount) {
      const countResult = this.evaluateZoneCount(condition.zoneCount, context);
      if (!countResult.isLegal) {
        return countResult;
      }
    }

    return { isLegal: true };
  }

  private static evaluateZoneState(
    zoneState: NonNullable<ActionActivationCondition["zoneState"]>,
    context: {
      readonly state: any;
      readonly playerKey: PlayerKey;
    }
  ): EvaluationResult {
    const { player: playerSpec = "controller", zone, property, equals, notEquals } = zoneState;

    if (equals === undefined && notEquals === undefined) {
      return {
        isLegal: false,
        reason: "zoneState に比較条件 (equals または notEquals) が指定されていません",
      };
    }

    let targetPlayerKey: PlayerKey | undefined;
    if (playerSpec === "controller" || playerSpec === "self") {
      targetPlayerKey = context.playerKey;
    } else if (playerSpec === "opponent") {
      targetPlayerKey = getOpponentPlayerKey(context.playerKey, context.state);
    } else if (playerSpec === "turnPlayer") {
      targetPlayerKey = context.state.turnPlayer;
    } else {
      return { isLegal: false, reason: `未対応のプレイヤースペックです: ${playerSpec}` };
    }

    if (!targetPlayerKey) {
      return { isLegal: false, reason: "対象プレイヤーを解決できません" };
    }

    const player = context.state.players?.[targetPlayerKey];
    if (!player) {
      return { isLegal: false, reason: `プレイヤー状態が存在しません: ${targetPlayerKey}` };
    }

    if (!zone || typeof zone !== "string") {
      return { isLegal: false, reason: "無効なゾーン指定です" };
    }

    const zoneObj = player[zone];
    if (zoneObj === undefined || zoneObj === null) {
      return { isLegal: false, reason: `プレイヤー '${targetPlayerKey}' にゾーン '${zone}' が存在しません` };
    }

    if (typeof property !== "string" || property === "" || property.includes(".")) {
      return { isLegal: false, reason: `無効なプロパティ指定です: ${property}` };
    }

    const actualValue = zoneObj[property];
    if (actualValue === undefined) {
      return { isLegal: false, reason: `ゾーン '${zone}' にプロパティ '${property}' が存在しません` };
    }

    if (equals !== undefined) {
      if (actualValue !== equals) {
        return {
          isLegal: false,
          reason: `起動条件不適合: ${zone}.${property} (${actualValue}) !== ${equals}`,
        };
      }
    }

    if (notEquals !== undefined) {
      if (actualValue === notEquals) {
        return {
          isLegal: false,
          reason: `起動条件不適合: ${zone}.${property} (${actualValue}) === ${notEquals}`,
        };
      }
    }

    return { isLegal: true };
  }

  private static evaluateZoneCount(
    zoneCount: NonNullable<ActionActivationCondition["zoneCount"]>,
    context: {
      readonly state: any;
      readonly playerKey: PlayerKey;
    }
  ): EvaluationResult {
    const { player: playerSpec = "controller", zone, atMost, atLeast, equals, notEquals } = zoneCount;

    if (atMost === undefined && atLeast === undefined && equals === undefined && notEquals === undefined) {
      return {
        isLegal: false,
        reason: "zoneCount に比較条件 (atMost, atLeast, equals, notEquals) が指定されていません",
      };
    }

    if (atMost !== undefined && typeof atMost !== "number") {
      return { isLegal: false, reason: "zoneCount の atMost に数値以外の値が指定されています" };
    }
    if (atLeast !== undefined && typeof atLeast !== "number") {
      return { isLegal: false, reason: "zoneCount の atLeast に数値以外の値が指定されています" };
    }
    if (equals !== undefined && typeof equals !== "number") {
      return { isLegal: false, reason: "zoneCount の equals に数値以外の値が指定されています" };
    }
    if (notEquals !== undefined && typeof notEquals !== "number") {
      return { isLegal: false, reason: "zoneCount の notEquals に数値以外の値が指定されています" };
    }

    let targetPlayerKey: PlayerKey | undefined;
    if (playerSpec === "controller" || playerSpec === "self") {
      targetPlayerKey = context.playerKey;
    } else if (playerSpec === "opponent") {
      targetPlayerKey = getOpponentPlayerKey(context.playerKey, context.state);
    } else if (playerSpec === "turnPlayer") {
      targetPlayerKey = context.state.turnPlayer;
    } else {
      return { isLegal: false, reason: `未対応のプレイヤースペックです: ${playerSpec}` };
    }

    if (!targetPlayerKey) {
      return { isLegal: false, reason: "対象プレイヤーを解決できません" };
    }

    const player = context.state.players?.[targetPlayerKey];
    if (!player) {
      return { isLegal: false, reason: `プレイヤー状態が存在しません: ${targetPlayerKey}` };
    }

    if (!zone || typeof zone !== "string" || zone === "" || zone.includes(".")) {
      return { isLegal: false, reason: "無効なゾーン指定です" };
    }

    let cardCount: number | undefined;
    if (zone === "life") {
      if (Array.isArray(player.life)) {
        cardCount = player.life.length;
      } else if (typeof player.life === "number") {
        cardCount = player.life;
      }
    } else if (zone === "hand") {
      if (Array.isArray(player.hand)) {
        cardCount = player.hand.length;
      }
    } else if (zone === "grave") {
      if (Array.isArray(player.grave)) {
        cardCount = player.grave.length;
      }
    } else if (zone === "rare" || zone === "rareCards") {
      const rareArr = Array.isArray(player.rareCards) ? player.rareCards : (Array.isArray(player.rare) ? player.rare : undefined);
      if (Array.isArray(rareArr)) {
        cardCount = rareArr.length;
      }
    } else if (zone === "pack") {
      if (Array.isArray(player.pack?.cards)) {
        cardCount = player.pack.cards.length;
      } else if (typeof player.pack?.count === "number") {
        cardCount = player.pack.count;
      }
    } else if (zone === "field") {
      if (Array.isArray(player.field)) {
        cardCount = player.field.length;
      }
    } else if (zone === "fog") {
      if (Array.isArray(player.fog)) {
        cardCount = player.fog.length;
      }
    } else if (Array.isArray(player[zone])) {
      cardCount = player[zone].length;
    }

    if (cardCount === undefined) {
      return { isLegal: false, reason: `プレイヤー '${targetPlayerKey}' にゾーン '${zone}' が存在しません` };
    }

    if (atMost !== undefined && cardCount > atMost) {
      return {
        isLegal: false,
        reason: `起動条件不適合: ${zone} のカード枚数 (${cardCount}) が上限 (${atMost}) を超えています`,
      };
    }

    if (atLeast !== undefined && cardCount < atLeast) {
      return {
        isLegal: false,
        reason: `起動条件不適合: ${zone} のカード枚数 (${cardCount}) が下限 (${atLeast}) 未満です`,
      };
    }

    if (equals !== undefined && cardCount !== equals) {
      return {
        isLegal: false,
        reason: `起動条件不適合: ${zone} のカード枚数 (${cardCount}) !== ${equals}`,
      };
    }

    if (notEquals !== undefined && cardCount === notEquals) {
      return {
        isLegal: false,
        reason: `起動条件不適合: ${zone} のカード枚数 (${cardCount}) === ${notEquals}`,
      };
    }

    return { isLegal: true };
  }
}
