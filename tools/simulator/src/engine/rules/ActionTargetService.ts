import { TargetSelection } from "../../domain/decision/DecisionCatalog";
import { PlayerKey } from "../../domain/decision/DecisionSource";
import {
  ActionDefinition,
  ActionRequest,
  ActionRequestTarget,
  ComponentDefinition,
} from "../../domain/rules/RulePackage";
import { PlaytestTargetPresenter } from "../decision/PlaytestTargetPresenter";
import {
  evaluateUnitTargetCondition,
  evaluateRequestTargetCondition,
  evaluatePlayerTargetCondition,
} from "./targetConditionUtils";

export interface TargetReplacementResult {
  readonly changed: boolean;
  readonly previousTarget?: any;
  readonly newTarget?: ActionRequestTarget;
  readonly targetDefinitionId?: string;
}

/**
 * ActionDefinition.targets を SSOT とする汎用ターゲット管理基盤。
 * Action ID によるハードコードを行わず、DSL 定義に基づきターゲット候補の列挙、
 * 検証、正規化、および安全なアトミック差し替えを実行します。
 */
export class ActionTargetService {
  /**
   * アクション定義と盤面状態から、選択可能なターゲット候補を列挙します。
   */
  static enumerateTargets(
    action: ActionDefinition,
    state: any,
    requesterPlayerKey: string,
    components: ComponentDefinition[] = []
  ): TargetSelection[] {
    if (!action.targets || action.targets.length === 0) {
      return [
        {
          targetType: "none",
          displayName: "対象なし",
          primaryLabel: "対象なし",
        },
      ];
    }

    const results: TargetSelection[] = [];

    for (const targetDef of action.targets) {
      const candidates = this.enumerateCandidatesForDefinition(
        targetDef,
        state,
        requesterPlayerKey,
        components
      );
      results.push(...candidates);
    }

    // 安定ソート
    results.sort((a, b) => {
      const aKey = `${a.targetType}:${a.targetPlayerKey || ""}:${a.targetUnitId || ""}:${a.targetRequestId || ""}`;
      const bKey = `${b.targetType}:${b.targetPlayerKey || ""}:${b.targetUnitId || ""}:${b.targetRequestId || ""}`;
      return aKey.localeCompare(bKey);
    });

    return results;
  }

  /**
   * 既存のリクエスト（targetRequest）に対して、差し替え可能なターゲット候補を列挙します。
   * 重要: 候補の適格性判定（自軍/敵軍、キーカードスート等）は、元のリクエスト（targetRequest）の
   * コントローラーおよびキーカード等のコンテキストを正（SSOT）として評価します。
   */
  static enumerateReplacementTargets(
    targetRequest: ActionRequest,
    state: any,
    components: ComponentDefinition[] = [],
    options?: { targetDefinitionId?: string; resolvingRequestId?: string }
  ): TargetSelection[] {
    const action = targetRequest.action;
    if (!action || !action.targets || action.targets.length === 0) {
      return [];
    }

    let targetDef = options?.targetDefinitionId
      ? action.targets.find((t) => t.id === options.targetDefinitionId)
      : undefined;

    if (!targetDef) {
      if (targetRequest.targets && targetRequest.targets.length > 0) {
        const currentTargetDefId =
          targetRequest.targets[0].targetDefinitionId || targetRequest.targets[0].id;
        targetDef = action.targets.find((t) => t.id === currentTargetDefId) || action.targets[0];
      } else {
        targetDef = action.targets[0];
      }
    }

    if (!targetDef) {
      return [];
    }

    // 元リクエストのコンテキストで候補を列挙
    const candidates = this.enumerateCandidatesForDefinition(
      targetDef,
      state,
      targetRequest.controller,
      components,
      {
        keyCards: targetRequest.keyCards,
        currentRequestId: targetRequest.id,
      }
    );

    // 安定ソート
    candidates.sort((a, b) => {
      const aKey = `${a.targetType}:${a.targetPlayerKey || ""}:${a.targetUnitId || ""}:${a.targetRequestId || ""}`;
      const bKey = `${b.targetType}:${b.targetPlayerKey || ""}:${b.targetUnitId || ""}:${b.targetRequestId || ""}`;
      return aKey.localeCompare(bKey);
    });

    return candidates;
  }

  /**
   * 単一のターゲット定義に対する候補群を列挙
   */
  private static enumerateCandidatesForDefinition(
    targetDef: any,
    state: any,
    requesterPlayerKey: string,
    components: ComponentDefinition[] = [],
    contextOptions?: {
      keyCards?: readonly any[];
      currentRequestId?: string;
    }
  ): TargetSelection[] {
    const cond = targetDef.condition;
    let targetType = targetDef.type || (targetDef as any).targetType || (cond ? cond.type : undefined);
    if (!targetType && (cond?.component || cond?.componentType || cond?.characterType || targetDef.id === "target" || targetDef.id === "targetUnit")) {
      targetType = "unit";
    }

    const results: TargetSelection[] = [];

    if (targetType === "player") {
      for (const pKey of Object.keys(state.players || {})) {
        const evalResult = evaluatePlayerTargetCondition(pKey, cond, {
          requesterPlayerKey,
        });
        if (!evalResult.isValid) continue;

        const candidate: TargetSelection = {
          targetType: "player",
          targetPlayerKey: pKey,
          targetDefinitionId: targetDef.id,
        };
        const labels = PlaytestTargetPresenter.formatTarget(
          candidate,
          state,
          requesterPlayerKey as PlayerKey
        );
        results.push({
          ...candidate,
          displayName: labels.displayName,
          primaryLabel: labels.primaryLabel,
          secondaryLabel: labels.secondaryLabel,
        });
      }
    } else if (targetType === "request") {
      const stageRequests = state.stage?.requests || [];
      for (const req of stageRequests) {
        const evalResult = evaluateRequestTargetCondition(req, cond, {
          currentRequestId: contextOptions?.currentRequestId,
        });
        if (!evalResult.isValid) continue;

        const candidate: TargetSelection = {
          targetType: "request",
          targetPlayerKey: req.controller,
          targetRequestId: req.id,
          targetDefinitionId: targetDef.id,
        };
        const labels = PlaytestTargetPresenter.formatTarget(
          candidate,
          state,
          requesterPlayerKey as PlayerKey
        );
        results.push({
          ...candidate,
          displayName: labels.displayName,
          primaryLabel: labels.primaryLabel,
          secondaryLabel: labels.secondaryLabel,
        });
      }
    } else if (targetType === "unit") {
      const players = state.players || {};
      for (const [pKey, player] of Object.entries<any>(players)) {
        if (!player?.field) continue;
        for (const unit of player.field) {
          const evalResult = evaluateUnitTargetCondition(unit, cond, {
            components,
            keyCards: contextOptions?.keyCards,
            playerKey: requesterPlayerKey,
            unitOwnerKey: pKey,
          });
          if (!evalResult.isValid) continue;

          const candidate: TargetSelection = {
            targetType: "unit",
            targetPlayerKey: pKey,
            targetUnitId: unit.unitId,
            targetDefinitionId: targetDef.id,
          };
          const labels = PlaytestTargetPresenter.formatTarget(
            candidate,
            state,
            requesterPlayerKey as PlayerKey
          );
          results.push({
            ...candidate,
            displayName: labels.displayName,
            primaryLabel: labels.primaryLabel,
            secondaryLabel: labels.secondaryLabel,
          });
        }
      }
    }

    return results;
  }

  /**
   * 2つのターゲット参照が同一エンティティを指しているかを判定
   */
  static isSameCanonicalTarget(a: any, b: any): boolean {
    if (!a && !b) return true;
    if (!a || !b) return false;

    const aType = a.targetType || a.type;
    const bType = b.targetType || b.type;
    if (aType !== bType) return false;

    if (aType === "unit") {
      const aUnit = a.targetUnitId || a.unitId;
      const bUnit = b.targetUnitId || b.unitId;
      return aUnit !== undefined && aUnit === bUnit;
    }

    if (aType === "request") {
      const aReq = a.targetRequestId || a.requestId;
      const bReq = b.targetRequestId || b.requestId;
      return aReq !== undefined && aReq === bReq;
    }

    if (aType === "player") {
      const aPlayer = a.targetPlayerKey || a.playerId || a.playerKey;
      const bPlayer = b.targetPlayerKey || b.playerId || b.playerKey;
      return aPlayer !== undefined && aPlayer === bPlayer;
    }

    if (aType === "none") return true;

    return false;
  }

  /**
   * TargetSelection を ActionRequestTarget に正規化
   */
  static toCanonicalRequestTarget(
    targetDef: any,
    selection: TargetSelection,
    state: any,
    components: ComponentDefinition[] = []
  ): ActionRequestTarget {
    const defId = targetDef?.id || selection.targetDefinitionId;

    if (selection.targetType === "unit") {
      const unitId = selection.targetUnitId;
      let foundUnit: any = null;
      for (const p of Object.values<any>(state.players || {})) {
        foundUnit = p.field?.find((u: any) => u.unitId === unitId);
        if (foundUnit) break;
      }
      return {
        type: "unit",
        unitId: unitId || "",
        kind: foundUnit?.kind || "character",
        componentId: foundUnit?.componentId || "",
        targetDefinitionId: defId,
        id: defId,
      };
    }

    if (selection.targetType === "request") {
      const reqId = selection.targetRequestId;
      const req = (state.stage?.requests || []).find((r: any) => r.id === reqId);
      return {
        type: "request",
        requestId: reqId || "",
        actionId: req?.actionId || "",
        targetDefinitionId: defId,
        id: defId,
      };
    }

    if (selection.targetType === "player") {
      const pKey = selection.targetPlayerKey || "";
      return {
        type: "player",
        targetPlayerKey: pKey,
        name: pKey,
        targetDefinitionId: defId,
        id: defId,
      };
    }

    throw new Error(`未対応のターゲット種別です: ${selection.targetType}`);
  }

  /**
   * targetRequest のターゲットをアトミックに差し替え
   */
  static replaceTarget(
    targetRequest: ActionRequest,
    selection: TargetSelection,
    state: any,
    components: ComponentDefinition[] = [],
    targetDefinitionId?: string
  ): TargetReplacementResult {
    const action = targetRequest.action;
    if (!action) {
      throw new Error(`リクエスト ${targetRequest.id} のアクション定義が見つかりません。`);
    }

    const defId =
      targetDefinitionId ||
      selection.targetDefinitionId ||
      (targetRequest.targets && targetRequest.targets.length > 0
        ? targetRequest.targets[0].targetDefinitionId || targetRequest.targets[0].id
        : undefined) ||
      (action.targets && action.targets.length > 0 ? action.targets[0].id : undefined);

    const targetDef = action.targets?.find((t) => t.id === defId) || action.targets?.[0];
    if (!targetDef) {
      throw new Error(`リクエスト ${targetRequest.id} に適合するターゲット定義が見つかりません。`);
    }

    const previousTarget =
      targetRequest.targets?.find((t: any) => (t.targetDefinitionId || t.id) === targetDef.id) ||
      targetRequest.targets?.[0];

    // 同一ターゲットが選択された場合は変更不要 (no-op)
    if (this.isSameCanonicalTarget(previousTarget, selection)) {
      return {
        changed: false,
        previousTarget,
        newTarget: previousTarget,
        targetDefinitionId: targetDef.id,
      };
    }

    const canonicalNewTarget = this.toCanonicalRequestTarget(
      targetDef,
      selection,
      state,
      components
    );

    // targets 配列の更新
    if (!targetRequest.targets || targetRequest.targets.length === 0) {
      targetRequest.targets = [canonicalNewTarget];
    } else {
      const idx = targetRequest.targets.findIndex(
        (t: any) => (t.targetDefinitionId || t.id) === targetDef.id
      );
      if (idx !== -1) {
        targetRequest.targets[idx] = canonicalNewTarget;
      } else {
        targetRequest.targets[0] = canonicalNewTarget;
      }
    }

    // 互換性プロパティの更新
    if (canonicalNewTarget.type === "unit") {
      let foundUnit: any = null;
      for (const p of Object.values<any>(state.players || {})) {
        foundUnit = p.field?.find((u: any) => u.unitId === canonicalNewTarget.unitId);
        if (foundUnit) break;
      }
      (targetRequest as any).targetComponent = foundUnit;
      (targetRequest as any).targetUnitId = canonicalNewTarget.unitId;
    } else if (canonicalNewTarget.type === "request") {
      const req = (state.stage?.requests || []).find(
        (r: any) => r.id === canonicalNewTarget.requestId
      );
      (targetRequest as any).targetRequest = req;
    } else if (canonicalNewTarget.type === "player") {
      (targetRequest as any).targetPlayerKey = canonicalNewTarget.targetPlayerKey;
    }

    return {
      changed: true,
      previousTarget,
      newTarget: canonicalNewTarget,
      targetDefinitionId: targetDef.id,
    };
  }
}
