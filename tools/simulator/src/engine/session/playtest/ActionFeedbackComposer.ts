import { PlaytestPresentationEvent } from "./PlaytestPresentationEvent";

/**
 * 画面上部に一時表示される Action Feedback Flash のアイテム情報
 */
export interface ActionFeedbackItem {
  readonly id: string;
  readonly category: "action" | "cancel" | "damage" | "draw" | "defeated" | "state" | "turn";
  readonly actorName?: string;
  readonly actionName?: string;
  readonly targetLabel?: string;
  readonly mainText: string;
  readonly subText?: string;
  readonly detailBadge?: string;
}

/**
 * 1回の状態遷移（State Transition）または意思決定に由来する複数の PlaytestPresentationEvent を
 * 意味のあるまとまり（ActionFeedbackItem）へと集約・合成します。
 * （例: ACTION_RESOLVED + UNIT_STATE_CHANGED → ツイストによる英雄の drive 切り替え 1 件）
 */
export class ActionFeedbackComposer {
  static compose(events: readonly PlaytestPresentationEvent[]): ActionFeedbackItem[] {
    if (!events || events.length === 0) return [];

    const items: ActionFeedbackItem[] = [];
    const consumedIndices = new Set<number>();

    // 1. 事前インデックス化 (A. Causality fallback & Order-independent matching)
    // requestId -> REQUEST_CANCELLED の index
    const cancelledByRequestId = new Map<string, number>();
    // targetRequestId -> ACTION_RESOLVED の index
    const resolvedByTargetRequestId = new Map<string, number>();
    // targetUnitId -> ACTION_RESOLVED の出現回数
    const resolvedCountByTargetUnitId = new Map<string, number>();
    let totalActionResolvedCount = 0;

    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (e.kind === "REQUEST_CANCELLED" && e.requestId) {
        cancelledByRequestId.set(e.requestId, i);
      } else if (e.kind === "ACTION_RESOLVED") {
        totalActionResolvedCount++;
        if (e.targetRequestId) {
          resolvedByTargetRequestId.set(e.targetRequestId, i);
        }
        if (e.targetUnitId) {
          resolvedCountByTargetUnitId.set(
            e.targetUnitId,
            (resolvedCountByTargetUnitId.get(e.targetUnitId) || 0) + 1
          );
        }
      }
    }

    for (let i = 0; i < events.length; i++) {
      if (consumedIndices.has(i)) continue;
      const ev = events[i];

      // 1. REQUEST_CANCELLED (カウンターによる無効化等)
      if (ev.kind === "REQUEST_CANCELLED") {
        // 解決リクエストがこのリクエストを対象としている場合 (例: カウンター解決 → 対象無効化)
        // 配列の順序に依存せず (REQUEST_CANCELLED が先でも後にあっても)、1件の複合 Flash として合成
        const matchingResolvedIdx = ev.requestId ? resolvedByTargetRequestId.get(ev.requestId) : undefined;
        if (matchingResolvedIdx !== undefined && !consumedIndices.has(matchingResolvedIdx)) {
          consumedIndices.add(i);
          consumedIndices.add(matchingResolvedIdx);
          const resolveEv = events[matchingResolvedIdx];
          const cancelEv = ev;

          items.push({
            id: `flash-${resolveEv.id}-${cancelEv.id}`,
            category: "cancel",
            actorName: resolveEv.actorName,
            actionName: resolveEv.actionName,
            mainText: `${resolveEv.actorName || "プレイヤー"}「${resolveEv.actionName || "アクション"}」`,
            subText: `→ ${cancelEv.actorName || "相手"}の「${cancelEv.actionName || "リクエスト"}」無効化`,
            detailBadge: "CANCELLED",
          });
          continue;
        }

        // 単独の無効化 (他Requestの直接対象ではないキャンセル)
        consumedIndices.add(i);
        items.push({
          id: `flash-${ev.id}`,
          category: "cancel",
          actorName: ev.actorName,
          actionName: ev.actionName,
          targetLabel: ev.targetLabel,
          mainText: `【無効化】${ev.actionName || "アクション"}`,
          subText: `${ev.actorName || "プレイヤー"} の「${ev.actionName || "リクエスト"}」が無効化されました`,
          detailBadge: "CANCELLED",
        });
        continue;
      }

      // 2. ACTION_RESOLVED と関連イベント (状態変化、撃破等) の集約
      if (ev.kind === "ACTION_RESOLVED") {
        // ターゲットに指定した REQUEST_CANCELLED が後続にある場合の複合 Flash 合成
        const matchingCancelledIdx = ev.targetRequestId ? cancelledByRequestId.get(ev.targetRequestId) : undefined;
        if (matchingCancelledIdx !== undefined && !consumedIndices.has(matchingCancelledIdx)) {
          consumedIndices.add(i);
          consumedIndices.add(matchingCancelledIdx);
          const resolveEv = ev;
          const cancelEv = events[matchingCancelledIdx];

          items.push({
            id: `flash-${resolveEv.id}-${cancelEv.id}`,
            category: "cancel",
            actorName: resolveEv.actorName,
            actionName: resolveEv.actionName,
            mainText: `${resolveEv.actorName || "プレイヤー"}「${resolveEv.actionName || "アクション"}」`,
            subText: `→ ${cancelEv.actorName || "相手"}の「${cancelEv.actionName || "リクエスト"}」無効化`,
            detailBadge: "CANCELLED",
          });
          continue;
        }

        consumedIndices.add(i);

        // 同一トランジション内の UNIT_STATE_CHANGED を探す
        // A. Causality 一意性規則:
        // 1. sourceRequestId の完全一致を最優先
        // 2. targetUnitId === unitId 一致は、batch 内でその unitId を対象とする ACTION_RESOLVED が「ちょうど1件」の場合に限定
        // 3. 複数件対象時や ID 不一致時は推測結合せず別 Flash とする
        let relatedStateChangeIdx = -1;
        for (let j = 0; j < events.length; j++) {
          if (j === i || consumedIndices.has(j)) continue;
          const stateEv = events[j];
          if (stateEv.kind === "UNIT_STATE_CHANGED") {
            const isSourceMatch = Boolean(stateEv.sourceRequestId && ev.requestId && stateEv.sourceRequestId === ev.requestId);
            const isUniqueTargetMatch = Boolean(
              !stateEv.sourceRequestId &&
              ev.targetUnitId &&
              stateEv.unitId &&
              ev.targetUnitId === stateEv.unitId &&
              resolvedCountByTargetUnitId.get(ev.targetUnitId) === 1
            );
            // ID が全く指定されていないモックテスト用の後方互換フォールバック (単一 ACTION_RESOLVED 時のみ)
            const isLegacySingleFallback = Boolean(
              !ev.requestId &&
              !ev.targetUnitId &&
              !stateEv.sourceRequestId &&
              totalActionResolvedCount === 1
            );

            if (isSourceMatch || isUniqueTargetMatch || isLegacySingleFallback) {
              relatedStateChangeIdx = j;
              break;
            }
          }
        }

        if (relatedStateChangeIdx !== -1) {
          const stateEv = events[relatedStateChangeIdx];
          consumedIndices.add(relatedStateChangeIdx);
          const fromStr = stateEv.fromState ? stateEv.fromState.toUpperCase() : "";
          const toStr = stateEv.toState ? stateEv.toState.toUpperCase() : "";
          const stateChangeStr = fromStr && toStr ? `${fromStr} → ${toStr}` : "状態変更";

          items.push({
            id: `flash-${ev.id}-${stateEv.id}`,
            category: "action",
            actorName: ev.actorName,
            actionName: ev.actionName,
            mainText: `${ev.actorName || "プレイヤー"}「${ev.actionName || "アクション"}」`,
            subText: `→ ${stateEv.unitLabel || "ユニット"} (${stateChangeStr})`,
            detailBadge: toStr || "STATE",
          });
          continue;
        }

        // 同一トランジション内の UNIT_DEFEATED を探す
        let relatedDefeatedIdx = -1;
        for (let j = 0; j < events.length; j++) {
          if (j === i || consumedIndices.has(j)) continue;
          const defEv = events[j];
          if (defEv.kind === "UNIT_DEFEATED") {
            const isSourceMatch = Boolean(defEv.sourceRequestId && ev.requestId && defEv.sourceRequestId === ev.requestId);
            const isUniqueTargetMatch = Boolean(
              !defEv.sourceRequestId &&
              ev.targetUnitId &&
              defEv.unitId &&
              ev.targetUnitId === defEv.unitId &&
              resolvedCountByTargetUnitId.get(ev.targetUnitId) === 1
            );
            const isLegacySingleFallback = Boolean(
              !ev.requestId &&
              !ev.targetUnitId &&
              !defEv.sourceRequestId &&
              totalActionResolvedCount === 1
            );

            if (isSourceMatch || isUniqueTargetMatch || isLegacySingleFallback) {
              relatedDefeatedIdx = j;
              break;
            }
          }
        }

        if (relatedDefeatedIdx !== -1) {
          const defEv = events[relatedDefeatedIdx];
          consumedIndices.add(relatedDefeatedIdx);
          items.push({
            id: `flash-${ev.id}-${defEv.id}`,
            category: "action",
            actorName: ev.actorName,
            actionName: ev.actionName,
            mainText: `${ev.actorName || "プレイヤー"}「${ev.actionName || "アクション"}」`,
            subText: `→ ${defEv.unitLabel || "ユニット"} が墓地へ`,
            detailBadge: "DEFEATED",
          });
          continue;
        }

        // 関連イベントのない単独 ACTION_RESOLVED
        items.push({
          id: `flash-${ev.id}`,
          category: "action",
          actorName: ev.actorName,
          actionName: ev.actionName,
          mainText: `${ev.actorName || "プレイヤー"}「${ev.actionName || "アクション"}」`,
          subText: "解決されました",
          detailBadge: "RESOLVE",
        });
        continue;
      }

      // 3. DAMAGE
      if (ev.kind === "DAMAGE") {
        consumedIndices.add(i);
        const calcStr =
          ev.calculatedDamage && ev.damageAmount && ev.calculatedDamage !== ev.damageAmount
            ? ` (算出: ${ev.calculatedDamage} / 実適用: ${ev.damageAmount})`
            : "";
        const remainingStr = ev.remainingLifeDisplay ? ` (残ライフ: ${ev.remainingLifeDisplay})` : "";

        items.push({
          id: `flash-${ev.id}`,
          category: "damage",
          actorName: ev.actorName,
          mainText: `${ev.actorName || "プレイヤー"} に ${ev.damageAmount ?? 0} ダメージ！`,
          subText: `${remainingStr}${calcStr}`.trim(),
          detailBadge: `-${ev.damageAmount ?? 0} LIFE`,
        });
        continue;
      }

      // 4. DRAW
      if (ev.kind === "DRAW") {
        consumedIndices.add(i);
        items.push({
          id: `flash-${ev.id}`,
          category: "draw",
          actorName: ev.actorName,
          mainText: `${ev.actorName || "プレイヤー"} が ${ev.drawCount ?? 1}枚 ドロー`,
          subText: ev.remainingLifeDisplay ? `残ライフ: ${ev.remainingLifeDisplay}` : undefined,
          detailBadge: `+${ev.drawCount ?? 1} DRAW`,
        });
        continue;
      }

      // 5. 単独 UNIT_STATE_CHANGED
      if (ev.kind === "UNIT_STATE_CHANGED") {
        consumedIndices.add(i);
        const fromStr = ev.fromState ? ev.fromState.toUpperCase() : "";
        const toStr = ev.toState ? ev.toState.toUpperCase() : "";
        const stateChangeStr = fromStr && toStr ? `${fromStr} → ${toStr}` : "状態変更";
        items.push({
          id: `flash-${ev.id}`,
          category: "state",
          actorName: ev.actorName,
          mainText: `${ev.actorName || "プレイヤー"} の ${ev.unitLabel || "ユニット"}`,
          subText: stateChangeStr,
          detailBadge: toStr || "STATE",
        });
        continue;
      }

      // 6. 単独 UNIT_DEFEATED
      if (ev.kind === "UNIT_DEFEATED") {
        consumedIndices.add(i);
        items.push({
          id: `flash-${ev.id}`,
          category: "defeated",
          actorName: ev.actorName,
          mainText: `${ev.unitLabel || "ユニット"} 撃破`,
          subText: `${ev.actorName || "プレイヤー"} のユニットが墓地へ送られました`,
          detailBadge: "DEFEATED",
        });
        continue;
      }

      // 7. TURN_CHANGED
      if (ev.kind === "TURN_CHANGED") {
        consumedIndices.add(i);
        items.push({
          id: `flash-${ev.id}`,
          category: "turn",
          actorName: ev.actorName,
          mainText: `ターン交代: ${ev.actorName || "プレイヤー"} の手番`,
          subText: ev.message,
          detailBadge: "TURN",
        });
        continue;
      }

      // COST_PAID, CHARGE_RESTORED, GENERIC 等は Flash バナー対象外（通常ログのみ）
      consumedIndices.add(i);
    }

    return items;
  }
}
