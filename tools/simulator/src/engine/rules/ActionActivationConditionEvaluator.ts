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

    if (condition.zoneState) {
      const { player: playerSpec = "controller", zone, property, equals, notEquals } = condition.zoneState;

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

      const zoneObj = player[zone];
      if (zoneObj === undefined || zoneObj === null) {
        return { isLegal: false, reason: `プレイヤー '${targetPlayerKey}' にゾーン '${zone}' が存在しません` };
      }

      if (typeof property !== "string" || property.includes(".")) {
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
    }

    return { isLegal: true };
  }
}
