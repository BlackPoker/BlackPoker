import type { ActionRequest, ActionRequestTarget } from "../../domain/rules/RulePackage";
import type { UnitBattleDisplayInfo } from "./BattleRelationPresenter";

export interface StageTargetPresentation {
  /**
   * 各 Request ID をキーとし、整形済みターゲット表示文字列リストを保持する Map。
   * Target を持たないリクエストは含まれません。
   */
  readonly requestTargetLabels: ReadonlyMap<string, readonly string[]>;

  /**
   * 現在ステージ上で別の Request から対象として指定されている Request ID の集合。
   * 一時的ハイライト（highlightedRequestId）とは異なり、Stage 上の持続的対象関係を表します。
   */
  readonly targetedRequestIds: ReadonlySet<string>;
}

/**
 * LIFO ステージ配列内でのインデックスから、表示用番号（TOP または STAGE #N）を計算する共通 Pure Helper。
 * 配列末尾が TOP となり、先頭 (index 0) が STAGE #1 となります。
 */
export function getStageRequestDisplayIndex(
  requestIndexInArray: number,
  totalRequests: number
): { readonly isTop: boolean; readonly label: string } {
  const isTop = requestIndexInArray === totalRequests - 1;
  const label = isTop ? "TOP" : `STAGE #${requestIndexInArray + 1}`;
  return { isTop, label };
}

/**
 * UI Presentation 専用の Stage Target 解決プレゼンター。
 * domain/rules/RulePackage の ActionRequest / ActionRequestTarget 正式契約を直接使用し、
 * 保存済み canonical identity から人間が判別可能な番号（Unit: battleRelationMap, Request: STAGE #N / TOP）へ純粋変換します。
 */
export class StageTargetPresenter {
  /**
   * Stage 上の全リクエストと battleRelationMap から、ターゲット表示情報を一括構築します。
   * Observation 基準の battleRelationMap を再利用するため、相手の裏向き防壁等の秘密情報は隠蔽されます。
   */
  static buildStageTargetPresentation(
    requests: readonly ActionRequest[] = [],
    battleRelationMap?: ReadonlyMap<string, UnitBattleDisplayInfo> | Map<string, UnitBattleDisplayInfo>,
    viewerPlayerId?: string
  ): StageTargetPresentation {
    const requestTargetLabels = new Map<string, string[]>();
    const targetedRequestIds = new Set<string>();

    for (const req of requests) {
      if (!req || !Array.isArray(req.targets) || req.targets.length === 0) continue;

      const labels: string[] = [];

      for (const t of req.targets) {
        if (!t) continue;

        if (t.type === "unit") {
          // 1. ユニットターゲット (ダウン、ツイスト、アップ、防壁破壊等: unitId)
          const unitId = t.unitId;
          if (unitId) {
            const unitInfo = battleRelationMap?.get(unitId);
            if (unitInfo) {
              // 既存 battleRelationMap の安定バッジ・ラベル（例: "① ♣6 一般兵", "② 防壁"）を再利用
              const relationPrefix = viewerPlayerId && unitInfo.ownerPlayerKey
                ? (unitInfo.ownerPlayerKey === viewerPlayerId ? "自分 " : "相手 ")
                : "";
              labels.push(`${relationPrefix}${unitInfo.label}`);
            } else {
              // canonical identity は存在するが、現在盤面に存在しない場合 (Target Lost)
              labels.push("対象Unit（現在盤面に存在しません）");
            }
          }
        } else if (t.type === "request") {
          // 2. リクエストターゲット (カウンター等: requestId)
          const targetReqId = t.requestId;
          if (targetReqId) {
            targetedRequestIds.add(targetReqId);
            const targetIdx = requests.findIndex((r) => r && r.id === targetReqId);
            if (targetIdx !== -1) {
              const targetReq = requests[targetIdx];
              const { label: stagePrefix } = getStageRequestDisplayIndex(targetIdx, requests.length);
              const targetActionName = targetReq.action?.name || targetReq.actionId || "アクション";
              labels.push(`${stagePrefix} ${targetActionName}`);
            } else {
              // canonical identity は存在するが、すでにステージから解決済み・除去済みの場合 (Target Lost)
              labels.push("対象リクエスト（解決済み）");
            }
          }
        } else if (t.type === "player") {
          // 3. プレイヤーターゲット (targetPlayerKey)
          const targetPlayerKey = t.targetPlayerKey;
          const pName =
            targetPlayerKey === "p1"
              ? "Player A"
              : targetPlayerKey === "p2"
              ? "Player B"
              : t.name || "プレイヤー";
          labels.push(pName);
        }
      }

      if (labels.length > 0 && req.id) {
        requestTargetLabels.set(req.id, labels);
      }
    }

    return {
      requestTargetLabels,
      targetedRequestIds,
    };
  }
}
