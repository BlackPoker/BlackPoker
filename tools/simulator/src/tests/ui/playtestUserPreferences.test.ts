import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import {
  FontScalePercentage,
  FONT_SCALE_NUMERIC_MAP,
  ALLOWED_FONT_SCALES,
  DEFAULT_PLAYTEST_USER_PREFERENCES,
  PLAYTEST_PREFERENCES_STORAGE_KEY,
  validateAndNormalizePreferences,
  loadPlaytestUserPreferences,
  savePlaytestUserPreferences,
  applyFontScaleToDom,
  resetPreferencesInMemoryForTesting,
  usePlaytestUserPreferences,
} from "../../ui/preferences/PlaytestUserPreferences";

class MockStorage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

describe("PlaytestUserPreferences (Phase 4A)", () => {
  let mockStorage: MockStorage;
  let originalWindow: unknown;
  let originalDocument: unknown;
  let customProperties: Map<string, string>;

  beforeEach(() => {
    mockStorage = new MockStorage();
    customProperties = new Map<string, string>();
    originalWindow = (globalThis as Record<string, unknown>).window;
    originalDocument = (globalThis as Record<string, unknown>).document;

    const mockDoc = {
      documentElement: {
        style: {
          setProperty: (key: string, val: string) => customProperties.set(key, val),
          getPropertyValue: (key: string) => customProperties.get(key) ?? "",
          removeProperty: (key: string) => customProperties.delete(key),
        },
      },
    };

    const mockWin = {
      localStorage: mockStorage,
      document: mockDoc,
    };

    (globalThis as Record<string, unknown>).window = mockWin;
    (globalThis as Record<string, unknown>).document = mockDoc;
    resetPreferencesInMemoryForTesting();
  });

  afterEach(() => {
    (globalThis as Record<string, unknown>).window = originalWindow;
    (globalThis as Record<string, unknown>).document = originalDocument;
    resetPreferencesInMemoryForTesting();
    vi.restoreAllMocks();
  });

  describe("定数定義と初期値", () => {
    it("ALLOWED_FONT_SCALES が 100%, 115%, 130%, 150% の4種類を含んでいること", () => {
      expect(ALLOWED_FONT_SCALES).toEqual(["100%", "115%", "130%", "150%"]);
    });

    it("FONT_SCALE_NUMERIC_MAP が正しい倍率数値をマッピングしていること", () => {
      expect(FONT_SCALE_NUMERIC_MAP["100%"]).toBe(1.0);
      expect(FONT_SCALE_NUMERIC_MAP["115%"]).toBe(1.15);
      expect(FONT_SCALE_NUMERIC_MAP["130%"]).toBe(1.3);
      expect(FONT_SCALE_NUMERIC_MAP["150%"]).toBe(1.5);
    });

    it("DEFAULT_PLAYTEST_USER_PREFERENCES が schemaVersion: 1 かつ 100% であること", () => {
      expect(DEFAULT_PLAYTEST_USER_PREFERENCES).toEqual({
        schemaVersion: 1,
        fontScale: "100%",
        graveTopSelectionMode: "manual",
      });
    });
  });

  describe("validateAndNormalizePreferences (不正値防御とフォールバック)", () => {
    it("正常なオブジェクトを正しく受け入れること", () => {
      for (const scale of ALLOWED_FONT_SCALES) {
        const input = {
          schemaVersion: 1,
          fontScale: scale,
          graveTopSelectionMode: "auto" as const,
        };
        const result = validateAndNormalizePreferences(input);
        expect(result).toEqual({
          schemaVersion: 1,
          fontScale: scale,
          graveTopSelectionMode: "auto",
        });
      }
    });

    it("null, undefined, プリミティブ, 配列の入力時はデフォルト設定を返すこと", () => {
      expect(validateAndNormalizePreferences(null)).toEqual(DEFAULT_PLAYTEST_USER_PREFERENCES);
      expect(validateAndNormalizePreferences(undefined)).toEqual(DEFAULT_PLAYTEST_USER_PREFERENCES);
      expect(validateAndNormalizePreferences("string")).toEqual(DEFAULT_PLAYTEST_USER_PREFERENCES);
      expect(validateAndNormalizePreferences(12345)).toEqual(DEFAULT_PLAYTEST_USER_PREFERENCES);
      expect(validateAndNormalizePreferences([1, 2, 3])).toEqual(DEFAULT_PLAYTEST_USER_PREFERENCES);
    });

    it("schemaVersion が 1 以外の場合は安全にデフォルト設定へフォールバックすること", () => {
      expect(validateAndNormalizePreferences({ schemaVersion: 2, fontScale: "130%" })).toEqual(
        DEFAULT_PLAYTEST_USER_PREFERENCES
      );
      expect(validateAndNormalizePreferences({ schemaVersion: 0, fontScale: "130%" })).toEqual(
        DEFAULT_PLAYTEST_USER_PREFERENCES
      );
      expect(validateAndNormalizePreferences({ fontScale: "130%" })).toEqual(
        DEFAULT_PLAYTEST_USER_PREFERENCES
      );
    });

    it("不正な fontScale 値はデフォルトの 100% にサニタイズされること", () => {
      const invalidScales = ["200%", "90%", "large", 100, null, undefined, ""];
      for (const invalid of invalidScales) {
        const result = validateAndNormalizePreferences({
          schemaVersion: 1,
          fontScale: invalid,
        });
        expect(result.fontScale).toBe("100%");
      }
    });

    it("不正な graveTopSelectionMode はデフォルトの manual にサニタイズされること", () => {
      const invalidModes = ["random", "smart", 123, null, ""];
      for (const invalid of invalidModes) {
        const result = validateAndNormalizePreferences({
          schemaVersion: 1,
          fontScale: "115%",
          graveTopSelectionMode: invalid,
        });
        expect(result.graveTopSelectionMode).toBe("manual");
      }
    });
  });

  describe("loadPlaytestUserPreferences & savePlaytestUserPreferences", () => {
    it("未保存時はデフォルト設定を返すこと", () => {
      const prefs = loadPlaytestUserPreferences();
      expect(prefs).toEqual(DEFAULT_PLAYTEST_USER_PREFERENCES);
    });

    it("設定を保存し、リロード時に正しく復元できること", () => {
      savePlaytestUserPreferences({
        schemaVersion: 1,
        fontScale: "130%",
        graveTopSelectionMode: "auto",
      });

      const loaded = loadPlaytestUserPreferences();
      expect(loaded).toEqual({
        schemaVersion: 1,
        fontScale: "130%",
        graveTopSelectionMode: "auto",
      });

      const raw = mockStorage.getItem(PLAYTEST_PREFERENCES_STORAGE_KEY);
      expect(raw).toBeTruthy();
      expect(JSON.parse(raw!)).toEqual({
        schemaVersion: 1,
        fontScale: "130%",
        graveTopSelectionMode: "auto",
      });
    });

    it("localStorage の内容が破損JSONだった場合に安全にデフォルトへフォールバックすること", () => {
      mockStorage.setItem(PLAYTEST_PREFERENCES_STORAGE_KEY, "invalid-json{not-closed");
      const loaded = loadPlaytestUserPreferences();
      expect(loaded).toEqual(DEFAULT_PLAYTEST_USER_PREFERENCES);
    });

    it("localStorage.getItem が SecurityError で例外を投げてもクラッシュせずデフォルト値を返すこと", () => {
      vi.spyOn(mockStorage, "getItem").mockImplementation(() => {
        throw new Error("SecurityError: Access is denied");
      });

      const loaded = loadPlaytestUserPreferences();
      expect(loaded).toEqual(DEFAULT_PLAYTEST_USER_PREFERENCES);
    });

    it("localStorage.setItem が QuotaExceededError で例外を投げてもクラッシュせずインメモリで保持すること", () => {
      vi.spyOn(mockStorage, "setItem").mockImplementation(() => {
        throw new Error("QuotaExceededError: Storage quota exceeded");
      });

      expect(() => {
        savePlaytestUserPreferences({
          schemaVersion: 1,
          fontScale: "150%",
        });
      }).not.toThrow();

      // インメモリから復元できること
      const loaded = loadPlaytestUserPreferences();
      expect(loaded.fontScale).toBe("150%");
    });
  });

  describe("applyFontScaleToDom", () => {
    it("指定した fontScale に応じて document.documentElement の --bp-font-scale が正しく設定されること", () => {
      applyFontScaleToDom("100%");
      expect(customProperties.get("--bp-font-scale")).toBe("1");

      applyFontScaleToDom("115%");
      expect(customProperties.get("--bp-font-scale")).toBe("1.15");

      applyFontScaleToDom("130%");
      expect(customProperties.get("--bp-font-scale")).toBe("1.3");

      applyFontScaleToDom("150%");
      expect(customProperties.get("--bp-font-scale")).toBe("1.5");
    });

    it("任意の targetElement に --bp-font-scale を設定できること", () => {
      const containerProps = new Map<string, string>();
      const container = {
        style: {
          setProperty: (k: string, v: string) => containerProps.set(k, v),
        },
      } as unknown as HTMLElement;

      applyFontScaleToDom("130%", container);
      expect(containerProps.get("--bp-font-scale")).toBe("1.3");
    });
  });

  describe("usePlaytestUserPreferences カスタムフック", () => {
    function HookConsumer({
      onHook,
    }: {
      onHook: (hook: ReturnType<typeof usePlaytestUserPreferences>) => void;
    }) {
      const hook = usePlaytestUserPreferences();
      onHook(hook);
      return null;
    }

    it("初期ロードでデフォルト設定が取得され、DOMに --bp-font-scale が適用されること", () => {
      let currentHook!: ReturnType<typeof usePlaytestUserPreferences>;
      act(() => {
        TestRenderer.create(
          React.createElement(HookConsumer, {
            onHook: (h) => {
              currentHook = h;
            },
          })
        );
      });

      expect(currentHook.preferences).toEqual(DEFAULT_PLAYTEST_USER_PREFERENCES);
      expect(customProperties.get("--bp-font-scale")).toBe("1");
    });

    it("updatePreferences でフォント倍率が即座に更新され、localStorage と DOM に反映されること", () => {
      let currentHook!: ReturnType<typeof usePlaytestUserPreferences>;
      TestRenderer.create(
        React.createElement(HookConsumer, {
          onHook: (h) => {
            currentHook = h;
          },
        })
      );

      act(() => {
        currentHook.updatePreferences({ fontScale: "115%" });
      });

      expect(currentHook.preferences.fontScale).toBe("115%");
      expect(customProperties.get("--bp-font-scale")).toBe("1.15");

      const raw = mockStorage.getItem(PLAYTEST_PREFERENCES_STORAGE_KEY);
      expect(JSON.parse(raw!).fontScale).toBe("115%");
    });

    it("Phase 4D: 文字サイズのみを 100% にリセットした際に他設定 (graveTopSelectionMode 等) が維持されること", () => {
      let currentHook!: ReturnType<typeof usePlaytestUserPreferences>;
      TestRenderer.create(
        React.createElement(HookConsumer, {
          onHook: (h) => {
            currentHook = h;
          },
        })
      );

      // 墓地TOPを auto に、フォントを 130% に設定
      act(() => {
        currentHook.updatePreferences({
          fontScale: "130%",
          graveTopSelectionMode: "auto",
        });
      });

      expect(currentHook.preferences.fontScale).toBe("130%");
      expect(currentHook.preferences.graveTopSelectionMode).toBe("auto");

      // 文字サイズのみ 100% に戻す (CoreBattlePlaytest の onResetFontScale の挙動)
      act(() => {
        currentHook.updatePreferences({ fontScale: "100%" });
      });

      expect(currentHook.preferences.fontScale).toBe("100%");
      expect(currentHook.preferences.graveTopSelectionMode).toBe("auto"); // 他設定が保持される

      const raw = mockStorage.getItem(PLAYTEST_PREFERENCES_STORAGE_KEY);
      expect(JSON.parse(raw!)).toEqual({
        schemaVersion: 1,
        fontScale: "100%",
        graveTopSelectionMode: "auto",
      });
    });

    it("resetToDefault で 100% にリセットされ、localStorage と DOM に反映されること", () => {
      let currentHook!: ReturnType<typeof usePlaytestUserPreferences>;
      TestRenderer.create(
        React.createElement(HookConsumer, {
          onHook: (h) => {
            currentHook = h;
          },
        })
      );

      act(() => {
        currentHook.updatePreferences({ fontScale: "150%" });
      });
      expect(currentHook.preferences.fontScale).toBe("150%");
      expect(customProperties.get("--bp-font-scale")).toBe("1.5");

      act(() => {
        currentHook.resetToDefault();
      });

      expect(currentHook.preferences.fontScale).toBe("100%");
      expect(customProperties.get("--bp-font-scale")).toBe("1");

      const raw = mockStorage.getItem(PLAYTEST_PREFERENCES_STORAGE_KEY);
      expect(JSON.parse(raw!).fontScale).toBe("100%");
    });
  });

  describe("環境非依存性 (Node.js/SSR 環境での安全性)", () => {
    it("window および document が未定義の環境でも例外を出さずにデフォルト設定で動作すること", () => {
      (globalThis as Record<string, unknown>).window = undefined;
      (globalThis as Record<string, unknown>).document = undefined;
      resetPreferencesInMemoryForTesting();

      expect(() => {
        const prefs = loadPlaytestUserPreferences();
        expect(prefs).toEqual(DEFAULT_PLAYTEST_USER_PREFERENCES);
        savePlaytestUserPreferences({
          schemaVersion: 1,
          fontScale: "130%",
        });
        applyFontScaleToDom("130%");
      }).not.toThrow();
    });
  });
});
