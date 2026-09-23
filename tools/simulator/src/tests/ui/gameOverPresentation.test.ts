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

  it("3. 再戦ボタンの表記が「もう一度対戦する」となっており、'(Replay)' が含まれないこと", () => {
    const html = renderToString(
      React.createElement(GameOverOverlay, {
        winnerKey: "p2",
        winnerName: "Player B",
        reason: "LOSE_ALL_LIFE",
        onRestart: dummyOnRestart,
      })
    );

    // 正しい表記
    expect(html).toContain("もう一度対戦する");
    // 古い Replay 混同表記が完全に排除されていること
    expect(html).not.toContain("もう一度対戦する (Replay)");
    expect(html).not.toContain("(Replay)");
  });
});
