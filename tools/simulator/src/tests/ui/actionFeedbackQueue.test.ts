import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  ActionFeedbackComposer,
  ActionFeedbackItem,
} from "../../engine/session/playtest/ActionFeedbackComposer";
import { PlaytestPresentationEvent } from "../../engine/session/playtest/PlaytestPresentationEvent";
import { ActionFeedbackQueueController } from "../../ui/game/useActionFeedbackQueue";
import { ActionFeedbackFlash } from "../../ui/game/ActionFeedbackFlash";

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

    it("Request A解決 → Request B解決 → B由来のUnit状態変化の順で並んだ場合、Aに誤ってBのUnit変化が紐づかないこと", () => {
      const events: PlaytestPresentationEvent[] = [
        {
          id: "v6-0-ACTION_RESOLVED",
          stateVersion: 6,
          kind: "ACTION_RESOLVED",
          message: "[RESOLVE] 「攻撃」が解決されました (発動者: Player A)",
          level: "event",
          actorPlayerId: "p1",
          actorName: "Player A",
          actionName: "攻撃",
          actionId: "action.attack",
          requestId: "req-A",
          sourceRequestId: "req-A",
        },
        {
          id: "v6-1-ACTION_RESOLVED",
          stateVersion: 6,
          kind: "ACTION_RESOLVED",
          message: "[RESOLVE] 「ツイスト」が解決されました (発動者: Player B)",
          level: "event",
          actorPlayerId: "p2",
          actorName: "Player B",
          actionName: "ツイスト",
          actionId: "action.twist",
          requestId: "req-B",
          sourceRequestId: "req-B",
          targetUnitId: "unit-hero",
        },
        {
          id: "v6-2-UNIT_STATE_CHANGED",
          stateVersion: 6,
          kind: "UNIT_STATE_CHANGED",
          message: "[STATE] Player B の 英雄 が charge → drive に切り替わりました",
          level: "event",
          actorPlayerId: "p2",
          actorName: "Player B",
          unitId: "unit-hero",
          unitLabel: "Player B の 英雄",
          fromState: "charge",
          toState: "drive",
          sourceRequestId: "req-B",
        },
      ];

      const items = ActionFeedbackComposer.compose(events);
      expect(items.length).toBe(2);

      // Flash 1: Request A の単独解決 (Bのユニット変化は誤結合されない)
      expect(items[0].category).toBe("action");
      expect(items[0].actorName).toBe("Player A");
      expect(items[0].actionName).toBe("攻撃");
      expect(items[0].mainText).toBe("Player A「攻撃」");
      expect(items[0].subText).toBe("解決されました");

      // Flash 2: Request B と B由来のユニット状態変化の結合
      expect(items[1].category).toBe("action");
      expect(items[1].actorName).toBe("Player B");
      expect(items[1].actionName).toBe("ツイスト");
      expect(items[1].mainText).toBe("Player B「ツイスト」");
      expect(items[1].subText).toContain("Player B の 英雄 (CHARGE → DRIVE)");
      expect(items[1].detailBadge).toBe("DRIVE");
    });

    it("同じunitIdを対象にしたACTION_RESOLVEDが2件存在する場合、targetUnitId一致だけではUNIT_STATE_CHANGEDをどちらにも誤結合しないこと (一意性制約)", () => {
      const events: PlaytestPresentationEvent[] = [
        {
          id: "v6-0-ACTION_RESOLVED",
          stateVersion: 6,
          kind: "ACTION_RESOLVED",
          message: "[RESOLVE] 「アクションA」が解決されました (発動者: Player A)",
          level: "event",
          actorPlayerId: "p1",
          actorName: "Player A",
          actionName: "アクションA",
          requestId: "req-A",
          targetUnitId: "unit-shared",
        },
        {
          id: "v6-1-ACTION_RESOLVED",
          stateVersion: 6,
          kind: "ACTION_RESOLVED",
          message: "[RESOLVE] 「アクションB」が解決されました (発動者: Player B)",
          level: "event",
          actorPlayerId: "p2",
          actorName: "Player B",
          actionName: "アクションB",
          requestId: "req-B",
          targetUnitId: "unit-shared",
        },
        {
          id: "v6-2-UNIT_STATE_CHANGED",
          stateVersion: 6,
          kind: "UNIT_STATE_CHANGED",
          message: "[STATE] Player A の 英雄 が charge → drive に切り替わりました",
          level: "event",
          actorPlayerId: "p1",
          actorName: "Player A",
          unitId: "unit-shared",
          unitLabel: "Player A の 英雄",
          fromState: "charge",
          toState: "drive",
          // sourceRequestId は複数対象のため未定 (undefined)
        },
      ];

      const items = ActionFeedbackComposer.compose(events);
      // 推測禁止のため、アクションA、アクションB、状態変化がそれぞれ個別のFlashとして3件になること
      expect(items.length).toBe(3);
      expect(items[0].mainText).toBe("Player A「アクションA」");
      expect(items[0].subText).toBe("解決されました");
      expect(items[1].mainText).toBe("Player B「アクションB」");
      expect(items[1].subText).toBe("解決されました");
      expect(items[2].category).toBe("state");
      expect(items[2].mainText).toContain("Player A の 英雄");
    });

    it("REQUEST_CANCELLED が ACTION_RESOLVED より先に並んでも、requestId / targetRequestId で1件の複合Flashに合成されること", () => {
      // カウンター解決時の典型的な順序 (キャンセルされたリクエストが先にログへ現れるケース)
      const events: PlaytestPresentationEvent[] = [
        {
          id: "v8-0-REQUEST_CANCELLED",
          stateVersion: 8,
          kind: "REQUEST_CANCELLED",
          message: "[CANCELLED] Player B の「カウンター」が無効化されました",
          level: "event",
          actorPlayerId: "p2",
          actorName: "Player B",
          actionName: "カウンター",
          actionId: "action.counter",
          requestId: "req-target-counter",
          sourceRequestId: "req-target-counter",
        },
        {
          id: "v8-1-ACTION_RESOLVED",
          stateVersion: 8,
          kind: "ACTION_RESOLVED",
          message: "[RESOLVE] 「カウンター」が解決されました (発動者: Player A)",
          level: "event",
          actorPlayerId: "p1",
          actorName: "Player A",
          actionName: "カウンター",
          actionId: "action.counter",
          requestId: "req-counter-a",
          sourceRequestId: "req-counter-a",
          targetRequestId: "req-target-counter",
        },
      ];

      const items = ActionFeedbackComposer.compose(events);
      expect(items.length).toBe(1);
      expect(items[0].category).toBe("cancel");
      expect(items[0].actorName).toBe("Player A");
      expect(items[0].actionName).toBe("カウンター");
      expect(items[0].mainText).toBe("Player A「カウンター」");
      expect(items[0].subText).toBe("→ Player Bの「カウンター」無効化");
      expect(items[0].detailBadge).toBe("CANCELLED");
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

    it("skipCurrent() 呼び出し時、即座に次のアイテムへ遷移し、前のタイマーが後から発火しても誤動作しないこと", () => {
      const controller = new ActionFeedbackQueueController();
      controller.enqueue([
        createDummyItem("item-1", "Action 1"),
        createDummyItem("item-2", "Action 2"),
        createDummyItem("item-3", "Action 3"),
      ]);

      expect(controller.getCurrentItem()?.mainText).toBe("Action 1");
      expect(controller.getPendingCount()).toBe(2);

      // 表示中に 100ms 進めてから即座にスキップ
      vi.advanceTimersByTime(100);
      controller.skipCurrent();

      // 即座に item-2 が表示される
      expect(controller.getCurrentItem()?.mainText).toBe("Action 2");
      expect(controller.getPendingCount()).toBe(1);

      // item-1 の元の残り時間 (700ms) が経過しても、item-1 の古いタイマーは破棄されているため item-2 が維持される
      vi.advanceTimersByTime(700);
      expect(controller.getCurrentItem()?.mainText).toBe("Action 2");

      // さらに item-2 のタイマー (800ms) が満了すると item-3 へ遷移
      vi.advanceTimersByTime(100);
      expect(controller.getCurrentItem()?.mainText).toBe("Action 3");
      expect(controller.getPendingCount()).toBe(0);
    });

    it("最後のアイテム表示中に skipCurrent() を呼び出すと即座に null となること", () => {
      const controller = new ActionFeedbackQueueController();
      controller.enqueue([createDummyItem("item-1", "Solo Action")]);

      expect(controller.getCurrentItem()?.mainText).toBe("Solo Action");
      controller.skipCurrent();

      expect(controller.getCurrentItem()).toBeNull();
      expect(controller.getPendingCount()).toBe(0);
    });

    it("キューが空の状態で skipCurrent() を呼び出しても安全に何もしないこと", () => {
      const controller = new ActionFeedbackQueueController();
      expect(() => controller.skipCurrent()).not.toThrow();
      expect(controller.getCurrentItem()).toBeNull();
    });

    it("dispose() 呼び出し時、タイマーが破棄され、その後のコールバック呼び出し (setState) が抑止されること", () => {
      let callCount = 0;
      const controller = new ActionFeedbackQueueController(() => {
        callCount++;
      });
      controller.enqueue([
        createDummyItem("item-1", "Action 1"),
        createDummyItem("item-2", "Action 2"),
      ]);
      const countBefore = callCount;

      controller.dispose();
      expect(controller.getCurrentItem()).toBeNull();
      expect(controller.getPendingCount()).toBe(0);

      // dispose 後の時間経過でコールバックが呼ばれない (unmount時のReact警告防止)
      vi.advanceTimersByTime(5000);
      expect(callCount).toBe(countBefore);
    });
  });

  describe("ActionFeedbackFlash Component & Accessibility", () => {
    it("Flashカードが button 要素としてレンダリングされ、click/tap および keyboard (Enter / Space) で onSkip が呼ばれること", () => {
      let skipCalls = 0;
      const onSkipMock = () => {
        skipCalls++;
      };

      const element = ActionFeedbackFlash({
        item: {
          id: "flash-test",
          category: "action",
          mainText: "テストアクション",
          detailBadge: "TEST",
        },
        pendingCount: 1,
        onSkip: onSkipMock,
      });

      const el = element as any;
      expect(el).not.toBeNull();
      // 外側は fixed container (div)
      expect(el?.type).toBe("div");

      // 子要素はセマンティックな button 要素
      const buttonElement = el.props.children;
      expect(buttonElement.type).toBe("button");
      expect(buttonElement.props.type).toBe("button");
      expect(buttonElement.props["aria-label"]).toBe("クリックでスキップ");

      // 1. click / tap
      buttonElement.props.onClick();
      expect(skipCalls).toBe(1);

      // 2. keyboard Enter
      let enterPrevented = false;
      buttonElement.props.onKeyDown({
        key: "Enter",
        preventDefault: () => {
          enterPrevented = true;
        },
      });
      expect(skipCalls).toBe(2);
      expect(enterPrevented).toBe(true);

      // 3. keyboard Space
      let spacePrevented = false;
      buttonElement.props.onKeyDown({
        key: " ",
        preventDefault: () => {
          spacePrevented = true;
        },
      });
      expect(skipCalls).toBe(3);
      expect(spacePrevented).toBe(true);

      // 4. その他のキー (Tab等) では onSkip は発火しない
      buttonElement.props.onKeyDown({
        key: "Tab",
        preventDefault: () => {},
      });
      expect(skipCalls).toBe(3);
    });
  });
});
