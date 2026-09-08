import { TargetSelection } from "../../domain/decision/DecisionCatalog";
import { ActionDefinition } from "../../domain/rules/RulePackage";
import { PlayerKey } from "../../domain/decision/DecisionSource";
import { ExpressionEvaluator } from "../rules/ExpressionEvaluator";
import { getCharacterType } from "../rules/characterUtils";
import { PlaytestTargetPresenter } from "./PlaytestTargetPresenter";


/**
 * アクション定義と盤面状態から、合法なターゲット候補を列挙するクラス。
 */
export class TargetSelectionEnumerator {
  private static expressionEvaluator = new ExpressionEvaluator();

  /**
   * アクション定義と盤面状態から、選択可能なターゲットの候補を列挙します。
   */
  static enumerateTargets(
    action: ActionDefinition,
    state: any,
    requesterPlayerKey: string,
    components: any[] = []
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
      const cond = targetDef.condition;
      let targetType = targetDef.type || (targetDef as any).targetType || (cond ? cond.type : undefined);
      if (!targetType && (cond?.component || cond?.componentType || targetDef.id === "target" || targetDef.id === "targetUnit")) {
        targetType = "unit";
      }

      if (targetType === "player") {
        // プレイヤーターゲット
        for (const pKey of Object.keys(state.players || {})) {
          if (cond?.relation === "opponent" && pKey === requesterPlayerKey) {
            continue;
          }
          const candidate: TargetSelection = {
            targetType: "player",
            targetPlayerKey: pKey,
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
        // リクエストターゲット（カウンター等）
        const stageRequests = state.stage?.requests || [];
        for (const req of stageRequests) {
          if (cond?.status && req.status !== cond.status) continue;
          if (cond?.keyCards) {
            const reqKeyCards = Array.isArray(req.keyCards)
              ? req.keyCards
              : ((req as any).keyCard ? [(req as any).keyCard] : []);
            if (cond.keyCards.count !== undefined) {
              const expectedCounts = Array.isArray(cond.keyCards.count) ? cond.keyCards.count : [cond.keyCards.count];
              if (!expectedCounts.includes(reqKeyCards.length)) continue;
            }
          }
          const candidate: TargetSelection = {
            targetType: "request",
            targetPlayerKey: req.controller,
            targetRequestId: req.id,
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
        // ユニットターゲット（アップ、ダウン、アタック等）
        const searchPlayers = cond?.owner === "opponent"
          ? Object.keys(state.players || {}).filter((k) => k !== requesterPlayerKey)
          : cond?.owner === "self"
          ? [requesterPlayerKey]
          : Object.keys(state.players || {}); // デフォルトは全プレイヤー（通常は自分）

        for (const pKey of searchPlayers) {
          const player = state.players[pKey];
          if (!player?.field) continue;

          for (const unit of player.field) {
            // アタックの場合の追加検証（charge状態のキャラクター）
            if (action.id === "action.attack") {
              if (pKey !== requesterPlayerKey) continue;
              if (unit.state !== "charge") continue;
            }

            // キャラクタータイプの検証
            if (cond?.componentType === "character") {
              const compId = unit.componentId || "";
              const compDef = components?.find((c: any) => c.id === compId);
              const isChar = compDef ? compDef.type === "character" : compId.startsWith("character.");
              if (!isChar) continue;
            }

            // characterType の検証 (例: soldier)
            if (cond?.characterType) {
              const charType = getCharacterType(unit, components);
              if (charType !== cond.characterType) continue;
            }

            // cond.component の検証
            if (cond?.component) {
              const isMatch = this.expressionEvaluator.evaluateTargetCondition(unit, cond);
              if (!isMatch) continue;
            }

            const candidate: TargetSelection = {
              targetType: "unit",
              targetPlayerKey: pKey,
              targetUnitId: unit.unitId,
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
    }

    // 安定ソート
    results.sort((a, b) => {
      const aKey = `${a.targetType}:${a.targetPlayerKey || ""}:${a.targetUnitId || ""}:${a.targetRequestId || ""}`;
      const bKey = `${b.targetType}:${b.targetPlayerKey || ""}:${b.targetUnitId || ""}:${b.targetRequestId || ""}`;
      return aKey.localeCompare(bKey);
    });

    return results;
  }
}
