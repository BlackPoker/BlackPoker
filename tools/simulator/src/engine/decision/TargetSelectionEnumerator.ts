import { TargetSelection } from "../../domain/decision/DecisionCatalog";
import { ActionDefinition } from "../../domain/rules/RulePackage";
import { ExpressionEvaluator } from "../rules/ExpressionEvaluator";
import { formatSuitSymbol } from "../rules/cardUtils";
import { getUnitDisplayName } from "../rules/characterUtils";


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
        },
      ];
    }

    const results: TargetSelection[] = [];

    for (const targetDef of action.targets) {
      const cond = targetDef.condition;
      let targetType = targetDef.type || (cond ? cond.type : undefined);
      if (!targetType && (cond?.component || cond?.componentType || targetDef.id === "target" || targetDef.id === "targetUnit")) {
        targetType = "unit";
      }

      if (targetType === "player") {
        // プレイヤーターゲット
        for (const pKey of Object.keys(state.players || {})) {
          if (cond?.relation === "opponent" && pKey === requesterPlayerKey) {
            continue;
          }
          const pName = state.players[pKey]?.name || pKey;
          results.push({
            targetType: "player",
            targetPlayerKey: pKey,
            displayName: `プレイヤー: ${pName} (${pKey})`,
          });
        }
      } else if (targetType === "request") {
        // リクエストターゲット（カウンター等）
        const stageRequests = state.stage?.requests || [];
        for (const req of stageRequests) {
          if (cond?.status && req.status !== cond.status) continue;
          results.push({
            targetType: "request",
            targetRequestId: req.id,
            displayName: `リクエスト: ${req.action?.name || req.actionId} (ID: ${req.id})`,
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

            // cond.component の検証
            if (cond?.component) {
              const isMatch = this.expressionEvaluator.evaluateTargetCondition(unit, cond);
              if (!isMatch) continue;
            }

            const pName = player.name || (pKey === "p1" ? "Player A" : "Player B");
            const isBulwark = unit.componentId === "character.bulwark" || unit.kind === "防壁";
            const isFaceDown = unit.face === "down";
            const cardDisplay = isBulwark && isFaceDown
              ? "🂠"
              : unit.cards && unit.cards.length > 0
              ? unit.cards.map((c: any) => `${formatSuitSymbol(c.suit)}${c.rank}`).join("+")
              : "カードなし";
            const stateLabel = unit.state === "drive" ? "drive" : "charge";
            const unitLabel = getUnitDisplayName(unit, player.field);

            results.push({
              targetType: "unit",
              targetPlayerKey: pKey,
              targetUnitId: unit.unitId,
              displayName: `${pName} の ${unitLabel} [${cardDisplay}] (${stateLabel})`,
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
