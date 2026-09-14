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

    // 現Phaseでサポートするcondition operatorは zoneState のみ
    const unsupportedKeys = conditionKeys.filter((k) => k !== "zoneState");
    if (unsupportedKeys.length > 0) {
      return {
        isLegal: false,
        reason: `未対応の起動条件オペレータが含まれています: ${unsupportedKeys.join(", ")}`,
      };
    }

    if (!condition.zoneState) {
      return { isLegal: false, reason: "対応可能な起動条件オペレータが存在しません" };
    }

    const { player: playerSpec = "controller", zone, property, equals, notEquals } = condition.zoneState;

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
}
