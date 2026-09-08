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

    for (let i = 0; i < events.length; i++) {
      if (consumedIndices.has(i)) continue;
      const ev = events[i];

      // 1. REQUEST_CANCELLED (カウンターによる無効化等)
      if (ev.kind === "REQUEST_CANCELLED") {
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
        consumedIndices.add(i);

        // 同一トランジション内の UNIT_STATE_CHANGED を探す (例: ツイスト)
        let relatedStateChangeIdx = -1;
        for (let j = i + 1; j < events.length; j++) {
          if (!consumedIndices.has(j) && events[j].kind === "UNIT_STATE_CHANGED") {
            relatedStateChangeIdx = j;
            break;
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

        // 同一トランジション内の UNIT_DEFEATED を探す (例: 防壁破壊)
        let relatedDefeatedIdx = -1;
        for (let j = i + 1; j < events.length; j++) {
          if (!consumedIndices.has(j) && events[j].kind === "UNIT_DEFEATED") {
            relatedDefeatedIdx = j;
            break;
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
