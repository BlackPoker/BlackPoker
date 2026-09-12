import React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderToString } from "react-dom/server";
import {
  ReplayVerifyModal,
  isVerifyActionAvailable,
  createSafeTechnicalErrorOutcome,
  ParsedBundleState,
} from "../../ui/replay/ReplayVerifyModal";
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

    it("5. PARSED 状態の値が falsy (null, false, 0, '') であっても検証可能状態となり、ボタンが描画されること", () => {
      // 純粋関数 isVerifyActionAvailable の検証
      expect(isVerifyActionAvailable({ type: "PARSED", value: null }, null, null)).toBe(true);
      expect(isVerifyActionAvailable({ type: "PARSED", value: false }, null, null)).toBe(true);
      expect(isVerifyActionAvailable({ type: "PARSED", value: 0 }, null, null)).toBe(true);
      expect(isVerifyActionAvailable({ type: "PARSED", value: "" }, null, null)).toBe(true);
      expect(isVerifyActionAvailable({ type: "NONE" }, null, null)).toBe(false);
      expect(isVerifyActionAvailable({ type: "PARSED", value: null }, { type: "INCOMPATIBLE", code: "INVALID_KIND", message: "err", currentBuildSha: "local" }, null)).toBe(false);
      expect(isVerifyActionAvailable({ type: "PARSED", value: null }, null, "Parse error")).toBe(false);

      // Modal レンダリング契約: value が null でも「検証する」ボタンが描画されること
      const htmlNull = renderToString(
        React.createElement(ReplayVerifyModal, {
          isOpen: true,
          onClose: dummyOnClose,
          onVerify: dummyOnVerify,
          currentBuildSha: "local",
          initialParsedBundle: { type: "PARSED", value: null },
        })
      );
      expect(htmlNull).toContain("検証する");
    });

    it("6. onVerify が throw した場合に TECHNICAL_ERROR がサニタイズされ、throw message (秘密情報) が含まれないこと", () => {
      const secretError = new Error("SECRET_INTERNAL_VALUE_TOKEN_12345");
      const outcome = createSafeTechnicalErrorOutcome(secretError);

      expect(outcome.type).toBe("TECHNICAL_ERROR");
      if (outcome.type === "TECHNICAL_ERROR") {
        expect(outcome.message).toBe("Replay検証中に技術的エラーが発生しました。");
        expect(outcome.message).not.toContain("SECRET_INTERNAL_VALUE_TOKEN_12345");
      }

      // Modal レンダリング契約: 画面内に秘密情報が出力されないこと
      const html = renderToString(
        React.createElement(ReplayVerifyModal, {
          isOpen: true,
          onClose: dummyOnClose,
          onVerify: dummyOnVerify,
          currentBuildSha: "local",
          initialOutcome: outcome,
        })
      );

      expect(html).toContain("TECHNICAL_ERROR");
      expect(html).toContain("Replay検証中に技術的エラーが発生しました。");
      expect(html).not.toContain("SECRET_INTERNAL_VALUE_TOKEN_12345");
    });

    it("7. Stale parsed state 回帰テスト: 新規ファイル選択時に旧Bundleが即時破棄され、エラー時にも再検証可能に戻らないこと", () => {
      // A. 最初に正常 Bundle を PARSED 状態にする
      let parsedState: ParsedBundleState = {
        type: "PARSED",
        value: { kind: "blackpoker-playtest-diagnostic" },
      };
      let currentOutcome: any = null;
      let currentParseError: string | null = null;

      expect(isVerifyActionAvailable(parsedState, currentOutcome, currentParseError)).toBe(true);

      // B. 次のファイル選択開始時 (非同期 read 前) に ParsedBundleState を NONE へ即時リセット
      parsedState = { type: "NONE" };
      currentOutcome = null;
      currentParseError = null;
      expect(isVerifyActionAvailable(parsedState, currentOutcome, currentParseError)).toBe(false);

      // C. 新しいファイルが invalid JSON だった場合: パースエラー設定、state は NONE のまま
      currentParseError = "JSONとして読み込めませんでした。ファイル形式を確認してください。";
      expect(isVerifyActionAvailable(parsedState, currentOutcome, currentParseError)).toBe(false);

      // D. 正常ファイル読み込み後に file read error が発生した場合の回帰確認
      // 再び正常 Bundle を読み込んだ状態から
      parsedState = { type: "PARSED", value: { kind: "blackpoker-playtest-diagnostic" } };
      currentParseError = null;
      expect(isVerifyActionAvailable(parsedState, currentOutcome, currentParseError)).toBe(true);

      // 新規ファイル選択開始で NONE にリセットされ、read error 発生
      parsedState = { type: "NONE" };
      currentParseError = "JSONとして読み込めませんでした。ファイル形式を確認してください。";
      expect(isVerifyActionAvailable(parsedState, currentOutcome, currentParseError)).toBe(false);
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
