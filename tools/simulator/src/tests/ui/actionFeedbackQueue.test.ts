import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  ActionFeedbackComposer,
  ActionFeedbackItem,
} from "../../engine/session/playtest/ActionFeedbackComposer";
import { PlaytestPresentationEvent } from "../../engine/session/playtest/PlaytestPresentationEvent";
import { ActionFeedbackQueueController } from "../../ui/game/useActionFeedbackQueue";

describe("Action Feedback Composer & Queue Lifecycle Tests", () => {
  describe("ActionFeedbackComposer", () => {
    it("ACTION_RESOLVED と同一トランジション内の UNIT_STATE_CHANGED を1件の要約Flashへ合成すること", () => {
      const events: PlaytestPresentationEvent[] = [
        {
          id: "v5-0-ACTION_RESOLVED",
          stateVersion: 5,
          kind: "ACTION_RESOLVED",
          message: "[RESOLVE] 「ツイスト」が解決されました (発動者: Player B)",
          level: "event",
          actorPlayerId: "p2",
          actorName: "Player B",
          actionName: "ツイスト",
          actionId: "action.twist",
        },
        {
          id: "v5-1-UNIT_STATE_CHANGED",
          stateVersion: 5,
          kind: "UNIT_STATE_CHANGED",
          message: "[STATE] Player B の 英雄 が charge → drive に切り替わりました",
          level: "event",
          actorPlayerId: "p2",
          actorName: "Player B",
          unitLabel: "Player B の 英雄",
          fromState: "charge",
          toState: "drive",
        },
      ];

      const items = ActionFeedbackComposer.compose(events);
      expect(items.length).toBe(1);
      expect(items[0].category).toBe("action");
      expect(items[0].actorName).toBe("Player B");
      expect(items[0].actionName).toBe("ツイスト");
      expect(items[0].mainText).toContain("Player B「ツイスト」");
      expect(items[0].subText).toContain("Player B の 英雄 (CHARGE → DRIVE)");
      expect(items[0].detailBadge).toBe("DRIVE");
    });

    it("REQUEST_CANCELLED イベントを【無効化】Flashとして合成すること", () => {
      const events: PlaytestPresentationEvent[] = [
        {
          id: "v4-0-REQUEST_CANCELLED",
          stateVersion: 4,
          kind: "REQUEST_CANCELLED",
          message: "[CANCELLED] Player A の「攻撃」が無効化されました",
          level: "event",
          actorPlayerId: "p1",
          actorName: "Player A",
          actionName: "攻撃",
          actionId: "action.attack",
        },
      ];

      const items = ActionFeedbackComposer.compose(events);
      expect(items.length).toBe(1);
      expect(items[0].category).toBe("cancel");
      expect(items[0].mainText).toContain("【無効化】攻撃");
      expect(items[0].detailBadge).toBe("CANCELLED");
    });

    it("DAMAGE イベントで算出ダメージと実適用ダメージが異なる場合、詳細バッジと差分を合成すること", () => {
      const events: PlaytestPresentationEvent[] = [
        {
          id: "v7-0-DAMAGE",
          stateVersion: 7,
          kind: "DAMAGE",
          message: "[DAMAGE] Player B にダメージ適用 (算出ダメージ: 13 / 実適用: 5) (残りライフ: 0枚)",
          level: "event",
          actorPlayerId: "p2",
          actorName: "Player B",
          damageAmount: 5,
          calculatedDamage: 13,
          remainingLifeDisplay: "0枚",
        },
      ];

      const items = ActionFeedbackComposer.compose(events);
      expect(items.length).toBe(1);
      expect(items[0].category).toBe("damage");
      expect(items[0].mainText).toContain("Player B に 5 ダメージ");
      expect(items[0].subText).toContain("算出: 13 / 実適用: 5");
      expect(items[0].detailBadge).toBe("-5 LIFE");
    });
  });

  describe("ActionFeedbackQueueController (Fake Timers によるライフサイクル検証)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    const createDummyItem = (id: string, text: string): ActionFeedbackItem => ({
      id,
      category: "action",
      mainText: text,
    });

    it("単一アイテム投入時、即座に表示され1400ms後に自動消去されること", () => {
      const updates: Array<{ item: ActionFeedbackItem | null; pending: number }> = [];
      const controller = new ActionFeedbackQueueController((item, count) => {
        updates.push({ item, pending: count });
      });

      controller.enqueue([createDummyItem("item-1", "First Action")]);

      // 即座に item-1 が表示される
      expect(controller.getCurrentItem()?.mainText).toBe("First Action");
      expect(controller.getPendingCount()).toBe(0);

      // 1399ms 経過時点: まだ表示中
      vi.advanceTimersByTime(1399);
      expect(controller.getCurrentItem()?.mainText).toBe("First Action");

      // 1400ms 到達: 表示終了
      vi.advanceTimersByTime(1);
      expect(controller.getCurrentItem()).toBeNull();
    });

    it("キューに複数アイテムがある場合、残量に応じた動的表示時間で順次消化されること", () => {
      const controller = new ActionFeedbackQueueController();
      controller.enqueue([
        createDummyItem("item-1", "Action 1"),
        createDummyItem("item-2", "Action 2"),
        createDummyItem("item-3", "Action 3"),
        createDummyItem("item-4", "Action 4"),
        createDummyItem("item-5", "Action 5"),
      ]);

      // item-1 表示中 (残り backlog: 4 >= 3 -> duration: 500ms)
      expect(controller.getCurrentItem()?.mainText).toBe("Action 1");
      expect(controller.getPendingCount()).toBe(4);

      // 500ms 経過 -> item-2 (backlog: 3 >= 3 -> duration: 500ms)
      vi.advanceTimersByTime(500);
      expect(controller.getCurrentItem()?.mainText).toBe("Action 2");

      // 500ms 経過 -> item-3 (backlog: 2 >= 1 -> duration: 800ms)
      vi.advanceTimersByTime(500);
      expect(controller.getCurrentItem()?.mainText).toBe("Action 3");

      // 800ms 経過 -> item-4 (backlog: 1 >= 1 -> duration: 800ms)
      vi.advanceTimersByTime(800);
      expect(controller.getCurrentItem()?.mainText).toBe("Action 4");

      // 800ms 経過 -> item-5 (backlog: 0 -> duration: 1400ms)
      vi.advanceTimersByTime(800);
      expect(controller.getCurrentItem()?.mainText).toBe("Action 5");

      // 1400ms 経過 -> 全て完了
      vi.advanceTimersByTime(1400);
      expect(controller.getCurrentItem()).toBeNull();
    });

    it("reset() 呼び出し時、保留中キューおよび実行中タイマーが即座に破棄されること", () => {
      const controller = new ActionFeedbackQueueController();
      controller.enqueue([
        createDummyItem("item-1", "Action 1"),
        createDummyItem("item-2", "Action 2"),
      ]);

      expect(controller.getCurrentItem()?.mainText).toBe("Action 1");
      expect(controller.getPendingCount()).toBe(1);

      // 300ms 経過時点で reset
      vi.advanceTimersByTime(300);
      controller.reset();

      expect(controller.getCurrentItem()).toBeNull();
      expect(controller.getPendingCount()).toBe(0);

      // さらにタイマーを進めても後続アイテムは発火しない
      vi.advanceTimersByTime(2000);
      expect(controller.getCurrentItem()).toBeNull();
    });
  });
});
