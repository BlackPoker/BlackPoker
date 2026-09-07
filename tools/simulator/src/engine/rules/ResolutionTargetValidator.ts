import type { ActionDefinition, ActionRequest } from "../../domain/rules/RulePackage";
import type { CommandContext } from "./CommandRegistry";
import {
  evaluateUnitTargetCondition,
  evaluateRequestTargetCondition,
  evaluatePlayerTargetCondition,
} from "./targetConditionUtils";

export type ResolutionTargetValidationResult = {
  readonly isValid: boolean;
  readonly reason?: "TARGET_INVALID_AT_RESOLUTION" | string;
  readonly detail?: string;
  readonly targetComponent?: any;
  readonly targetRequest?: any;
  readonly targetPlayerKey?: string;
};

/**
 * 解決時におけるターゲットの妥当性を検証します（Resolution-time Target Validation）。
 * 保存されたターゲット参照を現在の GameState から再取得し、存在・状態・同一性・DSL条件を評価します。
 */
export function validateTargetsAtResolution(
  action: ActionDefinition,
  request: ActionRequest,
  context: CommandContext
): ResolutionTargetValidationResult {
  if (!request.targets || request.targets.length === 0) {
    return {
      isValid: true,
      targetComponent: context.targetComponent,
      targetRequest: context.targetRequest,
      targetPlayerKey: context.targetPlayerKey,
    };
  }

  let targetComponent = context.targetComponent;
  let targetRequest = context.targetRequest;
  let targetPlayerKey = context.targetPlayerKey;

  const actionTargets = action.targets || [];

  for (const t of request.targets) {
    let tDef: any = undefined;
    const defId = (t as any).targetDefinitionId || (t as any).id;

    if (defId) {
      tDef = actionTargets.find((def: any) => def.id === defId);
      if (!tDef) {
        throw new Error(
          `アクション定義 [${action.id}] 内に対応するターゲット定義ID [${defId}] が存在しません（Invariant Violation）。`
        );
      }
    } else {
      if (actionTargets.length === 1) {
        // legacy compatibility: 唯一のターゲット定義を使用
        tDef = actionTargets[0];
      } else if (actionTargets.length > 1) {
        // 複数ターゲット定義がある場合、暗黙に targets[0] へフォールバックせず fail-fast
        throw new Error(
          `アクション [${action.id}] には複数のターゲット定義が存在しますが、リクエストのターゲットに targetDefinitionId が指定されていません。`
        );
      }
    }

    if (t.type === "request") {
      // 対象リクエストはステージ（requests）上に現在存在し、未キャンセル・未解決であること
      const stageReqs = context.state.stage?.requests || [];
      const req = stageReqs.find((r: any) => r.id === t.requestId);
      if (!req || req.status === "cancelled" || req.status === "resolved") {
        return {
          isValid: false,
          reason: "TARGET_INVALID_AT_RESOLUTION",
          detail: `ターゲットリクエスト ${t.requestId} はステージ上に存在しないか無効化されています。`,
        };
      }

      // DSL Target Condition の評価
      const conditionResult = evaluateRequestTargetCondition(req, tDef?.condition, {
        currentRequestId: request.id,
      });
      if (!conditionResult.isValid) {
        return {
          isValid: false,
          reason: "TARGET_INVALID_AT_RESOLUTION",
          detail: conditionResult.detail || "ターゲットリクエスト条件が不適合です。",
        };
      }

      targetRequest = req;
    } else if (t.type === "unit") {
      // 対象ユニットはプレイヤーのいずれかのフィールドに存在すること
      let foundUnit: any = null;
      let foundOwnerKey: string | undefined;
      for (const [pKey, p] of Object.entries<any>(context.state.players || {})) {
        const u = p.field?.find((unit: any) => unit.unitId === t.unitId);
        if (u) {
          foundUnit = u;
          foundOwnerKey = pKey;
          break;
        }
      }

      if (!foundUnit) {
        return {
          isValid: false,
          reason: "TARGET_INVALID_AT_RESOLUTION",
          detail: `ターゲットユニット ${t.unitId} はフィールド上に存在しません。`,
        };
      }

      // DSL Target Condition の評価
      const conditionResult = evaluateUnitTargetCondition(foundUnit, tDef?.condition, {
        components: context.components,
        keyCard: request.keyCards && request.keyCards.length > 0 ? request.keyCards[0] : context.keyCard,
        playerKey: request.controller,
        unitOwnerKey: foundOwnerKey,
      });
      if (!conditionResult.isValid) {
        return {
          isValid: false,
          reason: "TARGET_INVALID_AT_RESOLUTION",
          detail: conditionResult.detail || "ターゲットユニット条件が不適合です。",
        };
      }

      targetComponent = foundUnit;
    } else if (t.type === "player") {
      const playerKey = t.targetPlayerKey || (t as any).playerId || (t as any).playerKey;
      if (!context.state.players?.[playerKey]) {
        return {
          isValid: false,
          reason: "TARGET_INVALID_AT_RESOLUTION",
          detail: `ターゲットプレイヤー ${playerKey} が存在しません。`,
        };
      }

      // DSL Target Condition の評価
      const conditionResult = evaluatePlayerTargetCondition(playerKey, tDef?.condition, {
        requesterPlayerKey: request.controller,
      });
      if (!conditionResult.isValid) {
        return {
          isValid: false,
          reason: "TARGET_INVALID_AT_RESOLUTION",
          detail: conditionResult.detail || "ターゲットプレイヤー条件が不適合です。",
        };
      }

      targetPlayerKey = playerKey;
    }
  }

  return {
    isValid: true,
    targetComponent: targetComponent || context.targetComponent,
    targetRequest: targetRequest || context.targetRequest,
    targetPlayerKey: targetPlayerKey || context.targetPlayerKey,
  };
}
