import type { UnitBattleDisplayInfo } from "./BattleRelationPresenter";

export interface StageTargetPresentation {
  /**
   * 各 Request ID をキーとし、整形済みターゲット表示文字列リストを保持する Map。
   * Target を持たないリクエストは含まれません。
   */
  readonly requestTargetLabels: ReadonlyMap<string, readonly string[]>;

  /**
   * 現在ステージ上で別の Request から対象（Counter 等）として指定されている Request ID の集合。
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
 * Core の Request 構造や Target resolution には干渉せず、保存済み identity から
 * 人間が判別可能な番号（Unit: battleRelationMap, Request: STAGE #N / TOP）へ純粋変換します。
 */
export class StageTargetPresenter {
  /**
   * Stage 上の全リクエストと battleRelationMap から、ターゲット表示情報を一括構築します。
   * Observation 基準の battleRelationMap を再利用するため、相手の裏向き防壁等の秘密情報は隠蔽されます。
   */
  static buildStageTargetPresentation(
    requests: readonly any[] = [],
    battleRelationMap?: ReadonlyMap<string, UnitBattleDisplayInfo> | Map<string, UnitBattleDisplayInfo>
  ): StageTargetPresentation {
    const requestTargetLabels = new Map<string, string[]>();
    const targetedRequestIds = new Set<string>();

    for (const req of requests) {
      if (!req) continue;

      const rawTargets = Array.isArray(req.targets)
        ? req.targets
        : req.target
        ? [req.target]
        : [];

      if (rawTargets.length === 0) continue;

      const labels: string[] = [];

      for (const t of rawTargets) {
        if (!t) continue;

        if (t.type === "unit") {
          // 1. ユニットターゲット (ダウン、ツイスト、アップ、防壁破壊等)
          const unitId = t.unitId || t.targetUnitId || (req as any).targetUnitId;
          if (unitId) {
            const unitInfo = battleRelationMap?.get(unitId);
            if (unitInfo) {
              // 既存 battleRelationMap の安定バッジ・ラベル（例: "② ♣6 一般兵", "④ 防壁"）を再利用
              labels.push(unitInfo.label);
            } else {
              // ターゲット対象がすでに盤面から消えている場合は fail-closed 表示
              labels.push("対象Unit（現在盤面に存在しません）");
            }
          } else {
            // stable identity が欠如している場合は推測せず fail-closed
            labels.push("対象Unit（識別不能）");
          }
        } else if (t.type === "request") {
          // 2. リクエストターゲット (カウンター等)
          const targetReqId = t.requestId || t.targetRequestId || (req as any).targetRequestId;
          if (targetReqId) {
            targetedRequestIds.add(targetReqId);
            const targetIdx = requests.findIndex((r: any) => r && r.id === targetReqId);
            if (targetIdx !== -1) {
              const targetReq = requests[targetIdx];
              const { label: stagePrefix } = getStageRequestDisplayIndex(targetIdx, requests.length);
              const targetActionName = targetReq.action?.name || targetReq.actionId || "アクション";
              labels.push(`${stagePrefix} ${targetActionName}`);
            } else {
              // すでにステージから解決済み・除去済みの場合
              labels.push("対象リクエスト（解決済み）");
            }
          } else {
            labels.push("対象リクエスト（識別不能）");
          }
        } else if (t.type === "player") {
          // 3. プレイヤーターゲット
          const targetPlayerKey = t.targetPlayerKey || (t as any).playerId;
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
