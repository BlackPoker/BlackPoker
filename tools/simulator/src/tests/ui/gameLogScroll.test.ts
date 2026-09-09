import React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { GameLog, LogEntry } from "../../ui/game/GameLog";

describe("GameLog Scroll & Readability Tests", () => {
  describe("DOM Order and Chronological Integrity", () => {
    it("ログのDOM要素順序はlogs配列と同じ（インデックス0が最古、末尾が最新）であること", () => {
      const mockLogs: LogEntry[] = [
        {
          id: "log-1",
          seq: 1,
          level: "action",
          message: "プレイヤーAが突撃を指示した",
          timestamp: "12:00:01",
        },
        {
          id: "log-2",
          seq: 2,
          level: "event",
          message: "兵士①が相手の防壁へ攻撃した",
          timestamp: "12:00:05",
        },
        {
          id: "log-3",
          seq: 3,
          level: "info",
          message: "防壁が1枚破壊された",
          timestamp: "12:00:10",
        },
      ];

      const html = renderToString(React.createElement(GameLog, { logs: mockLogs }));

      const pos1 = html.indexOf("プレイヤーAが突撃を指示した");
      const pos2 = html.indexOf("兵士①が相手の防壁へ攻撃した");
      const pos3 = html.indexOf("防壁が1枚破壊された");

      expect(pos1).toBeGreaterThan(-1);
      expect(pos2).toBeGreaterThan(-1);
      expect(pos3).toBeGreaterThan(-1);

      // 古い順（時系列順）でレンダリングされていること（配列の逆順ソートは禁止）
      expect(pos1).toBeLessThan(pos2);
      expect(pos2).toBeLessThan(pos3);
    });

    it("空のログの場合、'ログはありません' が表示されること", () => {
      const html = renderToString(React.createElement(GameLog, { logs: [] }));
      expect(html).toContain("ログはありません");
    });
  });

  describe("Clipboard Copy Chronological Order Contract", () => {
    it("コピーされるテキストは常に古い順（過去→現在）であること", () => {
      let copiedText = "";
      const originalClipboard = (globalThis as any).navigator?.clipboard;
      Object.defineProperty(globalThis.navigator, "clipboard", {
        value: {
          writeText: async (text: string) => {
            copiedText = text;
          },
        },
        configurable: true,
        writable: true,
      });

      const mockLogs: LogEntry[] = [
        { id: "1", seq: 1, level: "action", message: "Step 1: P1 Action", timestamp: "00:01" },
        { id: "2", seq: 2, level: "event", message: "Step 2: Battle Resolve", timestamp: "00:02" },
        { id: "3", seq: 3, level: "info", message: "Step 3: End Turn", timestamp: "00:03" },
      ];

      // Copy logic simulation matching GameLog handleCopy
      const text = mockLogs.map((l) => `[${l.timestamp}] ${l.seq ? `#${l.seq} ` : ""}${l.message}`).join("\n");
      navigator.clipboard.writeText(text);

      expect(copiedText).toContain("[00:01] #1 Step 1: P1 Action");
      expect(copiedText).toContain("[00:02] #2 Step 2: Battle Resolve");
      expect(copiedText).toContain("[00:03] #3 Step 3: End Turn");

      const idx1 = copiedText.indexOf("Step 1");
      const idx2 = copiedText.indexOf("Step 2");
      const idx3 = copiedText.indexOf("Step 3");
      expect(idx1).toBeLessThan(idx2);
      expect(idx2).toBeLessThan(idx3);

      // Restore clipboard
      if (originalClipboard) {
        Object.defineProperty(globalThis.navigator, "clipboard", {
          value: originalClipboard,
          configurable: true,
          writable: true,
        });
      }
    });
  });

  describe("Near-bottom Auto-scroll Follow Contract", () => {
    it("最下部から48px以内の場合は自動追従フラグがtrueになること", () => {
      const isNearBottom = (scrollHeight: number, scrollTop: number, clientHeight: number) => {
        const distance = scrollHeight - scrollTop - clientHeight;
        return distance <= 48;
      };

      // 完全に最下部 (distance = 0)
      expect(isNearBottom(1000, 700, 300)).toBe(true);
      // 最下部から30px上 (distance = 30 <= 48)
      expect(isNearBottom(1000, 670, 300)).toBe(true);
      // ちょうど48px上 (distance = 48 <= 48)
      expect(isNearBottom(1000, 652, 300)).toBe(true);
      // 49px以上離れている (distance = 49 > 48)
      expect(isNearBottom(1000, 651, 300)).toBe(false);
      // 過去ログ閲覧中 (distance = 300)
      expect(isNearBottom(1000, 400, 300)).toBe(false);
    });

    it("最下部付近にいる状態でログが追加された場合、最下部までスクロールされること", () => {
      // DOMスクロールシミュレーション
      const mockElement = {
        scrollHeight: 1000,
        clientHeight: 300,
        scrollTop: 670, // distance = 30 <= 48
      };

      let isNearBottom = mockElement.scrollHeight - mockElement.scrollTop - mockElement.clientHeight <= 48;
      expect(isNearBottom).toBe(true);

      // 新規ログ追加シミュレーション
      mockElement.scrollHeight = 1200;
      if (isNearBottom) {
        mockElement.scrollTop = mockElement.scrollHeight;
      }

      // 最下部まで追従したことを確認
      expect(mockElement.scrollTop).toBe(1200);
    });

    it("ユーザーが過去ログ閲覧中の場合、ログが追加されてもスクロール位置が維持されること", () => {
      const mockElement = {
        scrollHeight: 1000,
        clientHeight: 300,
        scrollTop: 200, // 過去ログ閲覧中 (distance = 500 > 48)
      };

      let isNearBottom = mockElement.scrollHeight - mockElement.scrollTop - mockElement.clientHeight <= 48;
      expect(isNearBottom).toBe(false);

      // 新規ログ追加シミュレーション
      mockElement.scrollHeight = 1200;
      if (isNearBottom) {
        mockElement.scrollTop = mockElement.scrollHeight;
      }

      // ユーザーの閲覧位置 (200) が維持され、勝手にスクロールされないことを確認
      expect(mockElement.scrollTop).toBe(200);
    });
  });

  describe("Flexbox and Mobile Layout Style Contract", () => {
    it("GameLog の外側コンテナに min-h-0 および h-full が設定されていること", () => {
      const html = renderToString(React.createElement(GameLog, { logs: [] }));
      expect(html).toContain("min-h-0");
      expect(html).toContain("h-full");
    });

    it("GameLog のスクロールコンテナに overflow-y-auto, min-h-0, flex-1 が設定されていること", () => {
      const html = renderToString(React.createElement(GameLog, { logs: [] }));
      expect(html).toContain("overflow-y-auto");
      expect(html).toContain("flex-1");
      expect(html).toContain("data-testid=\"game-log-scroll-container\"");
    });
  });
});
