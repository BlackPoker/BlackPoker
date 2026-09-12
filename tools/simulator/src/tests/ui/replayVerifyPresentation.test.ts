import React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { ReplayVerifyModal } from "../../ui/replay/ReplayVerifyModal";
import { MobileHeaderMenu } from "../../ui/game/MobileHeaderMenu";

describe("ReplayVerifyPresentation Tests", () => {
  const dummyOnClose = vi.fn();
  const dummyOnVerify = vi.fn();

  describe("ReplayVerifyModal Presentation & Accessibility", () => {
    it("1. isOpen が false の場合は何も描画しないこと", () => {
      const html = renderToString(
        React.createElement(ReplayVerifyModal, {
          isOpen: false,
          onClose: dummyOnClose,
          onVerify: dummyOnVerify,
          currentBuildSha: "abcdef123456",
        })
      );
      expect(html).toBe("");
    });

    it("2. isOpen が true の場合にタイトル・Current Build・アクセシビリティ属性が描画されること", () => {
      const html = renderToString(
        React.createElement(ReplayVerifyModal, {
          isOpen: true,
          onClose: dummyOnClose,
          onVerify: dummyOnVerify,
          currentBuildSha: "abcdef123456",
        })
      );

      // タイトルとアクセシビリティ
      expect(html).toContain('role="dialog"');
      expect(html).toContain('aria-modal="true"');
      expect(html).toContain('id="replay-verify-modal-title"');
      expect(html).toContain("Replay検証");
      expect(html).toContain('aria-label="閉じる"');

      // Current Build の短縮形 (7文字)
      expect(html).toContain("Current: abcdef1");

      // 説明文と秘密情報保護の警告
      expect(html).toContain(
        "Playtest Diagnostic Bundle v1を読み込み、同じ初期条件と判断列から同じ状態を再計算できるか検証します。"
      );
      expect(html).toContain(
        "Diagnostic JSONには手札・Life等の非公開情報が含まれる可能性があります。検証はこのブラウザ内だけで行い、外部には送信しません。"
      );

      // ファイル入力
      expect(html).toContain('type="file"');
      expect(html).toContain('accept=".json,application/json"');
      expect(html).toContain('aria-label="Diagnostic JSON ファイルを選択"');
    });

    it("3. local build の場合に 'Current: local' と表示されること", () => {
      const html = renderToString(
        React.createElement(ReplayVerifyModal, {
          isOpen: true,
          onClose: dummyOnClose,
          onVerify: dummyOnVerify,
          currentBuildSha: "local",
        })
      );
      expect(html).toContain("Current: local");
    });
  });

  describe("MobileHeaderMenu Integration Presentation", () => {
    it("4. onOpenReplayVerify が渡された場合に Replay検証ボタンが表示されること", () => {
      const dummyOnOpenReplayVerify = vi.fn();
      const html = renderToString(
        React.createElement(MobileHeaderMenu, {
          isOpen: true,
          onClose: dummyOnClose,
          selectedEnvironmentId: "core-battle",
          onSelectEnvironment: vi.fn(),
          environmentOptions: [],
          showSeedInput: false,
          matchMode: "humanVsHuman",
          onSelectMatchMode: vi.fn(),
          humanSeat: "p1",
          onSelectHumanSeat: vi.fn(),
          policyId: "firstLegal",
          onSelectPolicyId: vi.fn(),
          isOfficialEnvironment: false,
          enablePassAndPlay: false,
          onTogglePassAndPlay: vi.fn(),
          onOpenLogModal: vi.fn(),
          onOpenDebugModal: vi.fn(),
          onResetGame: vi.fn(),
          onOpenReplayVerify: dummyOnOpenReplayVerify,
        })
      );

      expect(html).toContain("Replay検証");
      expect(html).toContain("※ 保存済みJSONの再現性を検証");
    });
  });
});
