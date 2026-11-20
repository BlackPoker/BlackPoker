/**
 * gameOverPresentation.test.ts
 *
 * BlackPoker Simulator - Phase 4.0-B
 * GameOverOverlay のプレゼンテーション層、Replay 用語の厳格化（Restart を Replay と表記しない）、
 * 「リプレイを見る」ボタンおよび最小化表示のテスト。
 */

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { GameOverOverlay } from "../../ui/game/GameOverOverlay";

describe("GameOverPresentation Tests (Phase 4.0-B)", () => {
  const dummyOnRestart = vi.fn();
  const dummyOnDownloadDiagnostic = vi.fn();
  const dummyOnOpenReplayViewer = vi.fn();

  it("1. onOpenReplayViewer が渡された場合、「リプレイを見る」ボタンが描画されること", () => {
    const html = renderToString(
      React.createElement(GameOverOverlay, {
        winnerKey: "p1",
        winnerName: "Player A",
        reason: "LPが0になったため",
        onRestart: dummyOnRestart,
        onDownloadDiagnostic: dummyOnDownloadDiagnostic,
        onOpenReplayViewer: dummyOnOpenReplayViewer,
      })
    );

    expect(html).toContain("リプレイを見る");
    expect(html).toContain("MATCH FINISHED");
    expect(html).toContain("Player A");
    expect(html).toContain("WIN");
    expect(html).toContain("LPが0になったため");
  });

  it("2. onOpenReplayViewer が渡されない場合、「リプレイを見る」ボタンが描画されないこと", () => {
    const html = renderToString(
      React.createElement(GameOverOverlay, {
        winnerKey: "p1",
        winnerName: "Player A",
        reason: "LPが0になったため",
        onRestart: dummyOnRestart,
        onDownloadDiagnostic: dummyOnDownloadDiagnostic,
      })
    );

    expect(html).not.toContain("リプレイを見る");
  });

  it("3. 次の対戦は設定画面から開始するため、終了画面の導線が「次の対戦を設定する」と表示されること", () => {
    const html = renderToString(
      React.createElement(GameOverOverlay, {
        winnerKey: "p2",
        winnerName: "Player B",
        reason: "LOSE_ALL_LIFE",
        onRestart: dummyOnRestart,
      })
    );

    // 直接再戦せず、セットアップ画面に戻る操作であること
    expect(html).toContain("次の対戦を設定する");
    expect(html).not.toContain("もう一度対戦する");
    // Replay と新規対戦を混同しない
    expect(html).not.toContain("(Replay)");
  });
});
