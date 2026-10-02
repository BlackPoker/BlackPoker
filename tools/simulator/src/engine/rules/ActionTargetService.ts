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

export type TargetDefinition = NonNullable<ActionDefinition["targets"]>[number];

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

    // 安定ソート（targetDefinitionId を含めて一意ソート）
    results.sort((a, b) => {
      const aKey = `${a.targetDefinitionId || ""}:${a.targetType}:${a.targetPlayerKey || ""}:${a.targetUnitId || ""}:${a.targetRequestId || ""}`;
      const bKey = `${b.targetDefinitionId || ""}:${b.targetType}:${b.targetPlayerKey || ""}:${b.targetUnitId || ""}:${b.targetRequestId || ""}`;
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
    options?: {
      targetDefinitionId?: string;
      actions?: readonly ActionDefinition[];
    }
  ): TargetSelection[] {
    const action =
      targetRequest.action ||
      (options?.actions && options.actions.find((a) => a.id === targetRequest.actionId));

    if (!action || !action.targets || action.targets.length === 0) {
      return [];
    }

    let targetDefsToEnumerate: TargetDefinition[] = [];

    if (options?.targetDefinitionId) {
      const matched = action.targets.find((t) => t.id === options.targetDefinitionId);
      if (!matched) {
        throw new Error(
          `指定された targetDefinitionId [${options.targetDefinitionId}] はアクション [${action.id}] のターゲット定義に存在しません。`
        );
      }
      targetDefsToEnumerate = [matched];
    } else if (action.targets.length === 1) {
      targetDefsToEnumerate = [action.targets[0]];
    } else {
      // 複数定義が存在する場合: targetRequest.targets の各スロットについて列挙
      if (targetRequest.targets && targetRequest.targets.length > 0) {
        const slots: TargetDefinition[] = [];
        for (const t of targetRequest.targets) {
          const slotId = t.targetDefinitionId || (t as any).id;
          if (!slotId) {
            throw new Error(
              `複数ターゲットを持つアクション [${action.id}] のターゲットに targetDefinitionId が存在しないため候補を特定できません。`
            );
          }
          const matched = action.targets.find((d) => d.id === slotId);
          if (!matched) {
            throw new Error(
              `ターゲットスロット [${slotId}] がアクション [${action.id}] の定義に見つかりません。`
            );
          }
          slots.push(matched);
        }
        targetDefsToEnumerate = slots;
      } else {
        throw new Error(
          `複数ターゲット定義を持つアクション [${action.id}] の対象スロットが特定できません。`
        );
      }
    }

    const candidates: TargetSelection[] = [];

    for (const targetDef of targetDefsToEnumerate) {
      const slotCandidates = this.enumerateCandidatesForDefinition(
        targetDef,
        state,
        targetRequest.controller,
        components,
        {
          keyCards: targetRequest.keyCards,
          currentRequestId: targetRequest.id, // 変更対象リクエスト自身へのセルフターゲット禁止
        }
      );

      for (const cand of slotCandidates) {
        candidates.push({
          ...cand,
          targetDefinitionId: targetDef.id,
        });
      }
    }

    // 安定ソート（targetDefinitionId を含める）
    candidates.sort((a, b) => {
      const aKey = `${a.targetDefinitionId || ""}:${a.targetType}:${a.targetPlayerKey || ""}:${a.targetUnitId || ""}:${a.targetRequestId || ""}`;
      const bKey = `${b.targetDefinitionId || ""}:${b.targetType}:${b.targetPlayerKey || ""}:${b.targetUnitId || ""}:${b.targetRequestId || ""}`;
      return aKey.localeCompare(bKey);
    });

    return candidates;
  }

  /**
   * 差し替え・検証対象となる TargetDefinition を特定します。
   * ActionDefinition.targets を SSOT とし、スロットが曖昧な場合は暗黙フォールバックせず FAIL-CLOSED とします。
   */
  static resolveTargetDefinition(
    action: ActionDefinition,
    targetRequest: ActionRequest,
    targetDefinitionId?: string,
    candidateTarget?: TargetSelection
  ): TargetDefinition {
    if (!action.targets || action.targets.length === 0) {
      throw new Error(`アクション [${action.id}] にはターゲット定義が存在しません。`);
    }

    const explicitDefId = targetDefinitionId || candidateTarget?.targetDefinitionId;

    // Case A: targetDefinitionId が明示的に指定されている場合
    if (explicitDefId) {
      const matched = action.targets.find((t) => t.id === explicitDefId);
      if (!matched) {
        throw new Error(
          `指定された targetDefinitionId [${explicitDefId}] はアクション [${action.id}] のターゲット定義に存在しません。`
        );
      }
      return matched;
    }

    // Case B: targetRequest のターゲットが 1 件、かつ ActionDefinition のターゲット定義も 1 件
    if (
      (!targetRequest.targets || targetRequest.targets.length <= 1) &&
      action.targets.length === 1
    ) {
      return action.targets[0];
    }

    // Case C: targetRequest 内に対象が存在し、その定義IDが ActionDefinition に合致する場合
    if (targetRequest.targets && targetRequest.targets.length === 1) {
      const singleTarget = targetRequest.targets[0];
      const slotId = singleTarget.targetDefinitionId || (singleTarget as any).id;
      if (slotId) {
        const matched = action.targets.find((t) => t.id === slotId);
        if (matched) return matched;
      }
    }

    // Case D: 複数定義が存在しスロットを特定できない場合 -> FAIL-CLOSED
    throw new Error(
      `アクション [${action.id}] には複数のターゲット定義が存在しますが、対象スロット (targetDefinitionId) を一意に特定できません。`
    );
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
        // 構造的アクティブ判定: pending または resolving のみ (省略時は pending とみなす)
        const reqStatus = req.status ?? "pending";
        if (reqStatus !== "pending" && reqStatus !== "resolving") {
          continue;
        }

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
   * 2つのターゲット参照が同一エンティティおよび同一スロットを指しているかを判定
   */
  static isSameCanonicalTarget(a: any, b: any): boolean {
    if (!a && !b) return true;
    if (!a || !b) return false;

    const aDefId = a.targetDefinitionId || a.id;
    const bDefId = b.targetDefinitionId || b.id;
    if (aDefId && bDefId && aDefId !== bDefId) return false;

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
   * 選択された TargetSelection を現在の盤面 (state) から Canonical な実体として解決・再検証し、
   * ActionRequestTarget を構築します。
   * 存在しないエンティティ、重複エンティティ、条件不適合、種別不適合はすべて FAIL-CLOSED (例外送出) となります。
   */
  static resolveCanonicalTarget(
    targetDef: TargetDefinition,
    selection: TargetSelection,
    state: any,
    targetRequest: ActionRequest,
    components: ComponentDefinition[] = []
  ): { canonicalTarget: ActionRequestTarget; matchedEntity: any } {
    const defId = targetDef.id;
    const cond = targetDef.condition;
    let expectedType = targetDef.type || (targetDef as any).targetType || (cond ? cond.type : undefined);
    if (!expectedType && (cond?.component || cond?.componentType || cond?.characterType || targetDef.id === "target" || targetDef.id === "targetUnit")) {
      expectedType = "unit";
    }

    if (selection.targetDefinitionId && selection.targetDefinitionId !== targetDef.id) {
      throw new Error(
        `TargetSelection の targetDefinitionId [${selection.targetDefinitionId}] が対象スロット [${targetDef.id}] と一致しません。`
      );
    }

    if (expectedType === "unit") {
      if (selection.targetType !== "unit") {
        throw new Error(`ターゲット種別が不適合です。期待: unit, 実際: ${selection.targetType}`);
      }
      const unitId = selection.targetUnitId;
      if (!unitId) {
        throw new Error("ユニットIDが指定されていません。");
      }

      // 全プレイヤーのフィールドを走査
      const matches: Array<{ unit: any; ownerKey: string }> = [];
      for (const [pKey, p] of Object.entries<any>(state.players || {})) {
        if (!p?.field) continue;
        for (const u of p.field) {
          if (u.unitId === unitId) {
            matches.push({ unit: u, ownerKey: pKey });
          }
        }
      }

      if (matches.length === 0) {
        throw new Error(`ユニット [${unitId}] はフィールド上に存在しません。`);
      }
      if (matches.length > 1) {
        throw new Error(`重複するユニットID [${unitId}] がフィールド上で検出されました。`);
      }

      const match = matches[0];
      const matchedUnit = match.unit;
      if (!matchedUnit.componentId) {
        throw new Error(`ユニット [${unitId}] の componentId が無効です。`);
      }

      // 元リクエストの controller, keyCards, 盤面の ownerKey で再評価
      const evalResult = evaluateUnitTargetCondition(matchedUnit, cond, {
        components,
        keyCards: targetRequest.keyCards,
        playerKey: targetRequest.controller,
        unitOwnerKey: match.ownerKey,
      });

      if (!evalResult.isValid) {
        throw new Error(`ターゲットユニットの条件を満たしていません: ${evalResult.detail || evalResult.reason}`);
      }

      const canonicalTarget: ActionRequestTarget = {
        type: "unit",
        unitId: matchedUnit.unitId,
        kind: matchedUnit.kind || "character",
        componentId: matchedUnit.componentId,
        targetDefinitionId: defId,
        id: defId,
      };

      return { canonicalTarget, matchedEntity: matchedUnit };
    }

    if (expectedType === "request") {
      if (selection.targetType !== "request") {
        throw new Error(`ターゲット種別が不適合です。期待: request, 実際: ${selection.targetType}`);
      }
      const reqId = selection.targetRequestId;
      if (!reqId) {
        throw new Error("リクエストIDが指定されていません。");
      }

      // state.stage.requests のみを走査 (history や buffer は不可)
      const stageRequests = state.stage?.requests || [];
      const matches = stageRequests.filter((r: any) => r.id === reqId);

      if (matches.length === 0) {
        throw new Error(`ターゲットリクエスト [${reqId}] はステージ上に存在しません。`);
      }
      if (matches.length > 1) {
        throw new Error(`重複するリクエストID [${reqId}] がステージ上で検出されました。`);
      }

      const matchedReq = matches[0];

      // 構造的アクティブ判定 (pending または resolving のみ)
      if (matchedReq.status === "resolved" || matchedReq.status === "cancelled") {
        throw new Error(`ターゲットリクエスト [${reqId}] は無効化または解決済みです (status: ${matchedReq.status})。`);
      }

      // 自分自身のリクエストは対象不可 (変更対象のリクエスト自身)
      if (matchedReq.id === targetRequest.id) {
        throw new Error("自分自身のリクエストを対象にすることはできません。");
      }

      // 元リクエストの条件で再評価
      const evalResult = evaluateRequestTargetCondition(matchedReq, cond, {
        currentRequestId: targetRequest.id,
      });

      if (!evalResult.isValid) {
        throw new Error(`ターゲットリクエストの条件を満たしていません: ${evalResult.detail || evalResult.reason}`);
      }

      const canonicalTarget: ActionRequestTarget = {
        type: "request",
        requestId: matchedReq.id,
        actionId: matchedReq.actionId,
        targetDefinitionId: defId,
        id: defId,
      };

      return { canonicalTarget, matchedEntity: matchedReq };
    }

    if (expectedType === "player") {
      if (selection.targetType !== "player") {
        throw new Error(`ターゲット種別が不適合です。期待: player, 実際: ${selection.targetType}`);
      }
      const pKey = selection.targetPlayerKey;
      if (!pKey || !state.players?.[pKey]) {
        throw new Error(`プレイヤー [${pKey}] が存在しません。`);
      }

      // 元リクエストの controller を基準に条件再評価
      const evalResult = evaluatePlayerTargetCondition(pKey, cond, {
        requesterPlayerKey: targetRequest.controller,
      });

      if (!evalResult.isValid) {
        throw new Error(`ターゲットプレイヤーの条件を満たしていません: ${evalResult.detail || evalResult.reason}`);
      }

      const canonicalTarget: ActionRequestTarget = {
        type: "player",
        targetPlayerKey: pKey,
        name: pKey,
        targetDefinitionId: defId,
        id: defId,
      };

      return { canonicalTarget, matchedEntity: state.players[pKey] };
    }

    throw new Error(`未対応のターゲット定義種別です: ${expectedType}`);
  }

  /**
   * TargetSelection を ActionRequestTarget に正規化（ヘルパー）
   */
  static toCanonicalRequestTarget(
    targetDef: TargetDefinition,
    selection: TargetSelection,
    state: any,
    targetRequest: ActionRequest,
    components: ComponentDefinition[] = []
  ): ActionRequestTarget {
    return this.resolveCanonicalTarget(targetDef, selection, state, targetRequest, components).canonicalTarget;
  }

  /**
   * targetRequest のターゲットをアトミックに差し替え
   * 1. ActionDefinition / TargetDefinition の厳格特定
   * 2. 現在の State から Canonical に再取得・条件再検証 (fail-closed)
   * 3. 同一ターゲット判定 (合法性確認後に no-op)
   * 4. 原子的（アトミック）差し替え
   */
  static replaceTarget(
    targetRequest: ActionRequest,
    selection: TargetSelection,
    state: any,
    components: ComponentDefinition[] = [],
    targetDefinitionId?: string,
    actions?: readonly ActionDefinition[]
  ): TargetReplacementResult {
    // 1. ActionDefinition の解決と検証
    const action =
      targetRequest.action ||
      (actions && actions.find((a) => a.id === targetRequest.actionId));

    if (!action) {
      throw new Error(`リクエスト ${targetRequest.id} のアクション定義 [${targetRequest.actionId}] が見つかりません。`);
    }

    if (targetRequest.action && targetRequest.action.id !== targetRequest.actionId) {
      throw new Error(
        `リクエストのアクションID [${targetRequest.actionId}] と埋め込み定義 [${targetRequest.action.id}] が不一致です。`
      );
    }

    // 2. ターゲットスロット (TargetDefinition) の特定
    const targetDef = this.resolveTargetDefinition(
      action,
      targetRequest,
      targetDefinitionId || selection.targetDefinitionId,
      selection
    );

    // 3. 現在設定されているターゲット（previousTarget）の特定
    let previousTarget: ActionRequestTarget | undefined = undefined;
    if (targetRequest.targets && targetRequest.targets.length > 0) {
      previousTarget =
        targetRequest.targets.find((t: any) => (t.targetDefinitionId || t.id) === targetDef.id) ||
        (action.targets?.length === 1 && targetRequest.targets.length === 1 ? targetRequest.targets[0] : undefined);
    }

    // 4. 現在の State から Canonical な実体を再取得し、元 Action の条件で再検証
    // 重要: stale / 不正な選択であれば、同一IDであっても先に例外送出 (fail-closed) する
    const { canonicalTarget: canonicalNewTarget, matchedEntity } = this.resolveCanonicalTarget(
      targetDef,
      selection,
      state,
      targetRequest,
      components
    );

    // 5. 同一ターゲット判定 (正規化・再検証後に実施)
    if (this.isSameCanonicalTarget(previousTarget, canonicalNewTarget)) {
      return {
        changed: false,
        previousTarget,
        newTarget: previousTarget,
        targetDefinitionId: targetDef.id,
      };
    }

    // 6. 原子的（アトミック）差し替え
    const nextTargets = targetRequest.targets ? [...targetRequest.targets] : [];
    const idx = nextTargets.findIndex(
      (t: any) => (t.targetDefinitionId || t.id) === targetDef.id
    );
    if (idx !== -1) {
      nextTargets[idx] = canonicalNewTarget;
    } else if (nextTargets.length === 0 || (action.targets?.length === 1 && nextTargets.length === 1)) {
      nextTargets[0] = canonicalNewTarget;
    } else {
      nextTargets.push(canonicalNewTarget);
    }
    targetRequest.targets = nextTargets;

    // 7. 互換性プロパティの更新
    if (canonicalNewTarget.type === "unit") {
      (targetRequest as any).targetComponent = matchedEntity;
      (targetRequest as any).targetUnitId = canonicalNewTarget.unitId;
    } else if (canonicalNewTarget.type === "request") {
      (targetRequest as any).targetRequest = matchedEntity;
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
