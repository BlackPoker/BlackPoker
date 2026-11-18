import { useState, useEffect, useCallback } from "react";

/**
 * Playtest UI 表示文字サイズの倍率種別
 */
export type FontScalePercentage = "100%" | "115%" | "130%" | "150%";

/**
 * 文字サイズ倍率の数値マッピング（CSS変数 --bp-font-scale に代入）
 */
export const FONT_SCALE_NUMERIC_MAP: Record<FontScalePercentage, number> = {
  "100%": 1.0,
  "115%": 1.15,
  "130%": 1.3,
  "150%": 1.5,
};

/**
 * 許可された文字サイズ倍率の配列
 */
export const ALLOWED_FONT_SCALES: readonly FontScalePercentage[] = [
  "100%",
  "115%",
  "130%",
  "150%",
];

/**
 * ユーザー設定インターフェース
 * schemaVersion: 1
 * 将来の拡張用スロットとして graveTopSelectionMode を受容可能に設計
 */
export interface PlaytestUserPreferences {
  readonly schemaVersion: 1;
  fontScale: FontScalePercentage;
  graveTopSelectionMode?: "manual" | "auto";
}

/**
 * localStorage 保存キー
 */
export const PLAYTEST_PREFERENCES_STORAGE_KEY = "blackpoker.playtest.preferences";

/**
 * デフォルト設定
 */
export const DEFAULT_PLAYTEST_USER_PREFERENCES: PlaytestUserPreferences = {
  schemaVersion: 1,
  fontScale: "100%",
  graveTopSelectionMode: "manual",
};

/**
 * インメモリフォールバック
 */
let inMemoryPreferences: PlaytestUserPreferences | null = null;

/**
 * 不正値防御およびバリデーション・正規化関数
 */
export function validateAndNormalizePreferences(raw: unknown): PlaytestUserPreferences {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_PLAYTEST_USER_PREFERENCES };
  }

  const obj = raw as Record<string, unknown>;

  // schemaVersion の検証（現在は 1 のみ受け付け、それ以外は安全にデフォルト値）
  if (obj.schemaVersion !== 1) {
    return { ...DEFAULT_PLAYTEST_USER_PREFERENCES };
  }

  // fontScale の検証
  const fontScale: FontScalePercentage =
    typeof obj.fontScale === "string" && (ALLOWED_FONT_SCALES as readonly string[]).includes(obj.fontScale)
      ? (obj.fontScale as FontScalePercentage)
      : DEFAULT_PLAYTEST_USER_PREFERENCES.fontScale;

  // graveTopSelectionMode の検証（未指定または manual / auto のみ許可）
  let graveTopSelectionMode: "manual" | "auto" = DEFAULT_PLAYTEST_USER_PREFERENCES.graveTopSelectionMode ?? "manual";
  if (obj.graveTopSelectionMode === "manual" || obj.graveTopSelectionMode === "auto") {
    graveTopSelectionMode = obj.graveTopSelectionMode;
  }

  return {
    schemaVersion: 1,
    fontScale,
    graveTopSelectionMode,
  };
}

/**
 * localStorage からの生データ取得（例外安全）
 */
function getStoredPreferencesRaw(): string | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage.getItem(PLAYTEST_PREFERENCES_STORAGE_KEY);
    }
  } catch (e) {
    // SecurityError / AccessDenied in private mode or iframe
    console.warn("PlaytestUserPreferences: Failed to read from localStorage", e);
  }
  return null;
}

/**
 * ユーザー設定のロード
 */
export function loadPlaytestUserPreferences(): PlaytestUserPreferences {
  const raw = getStoredPreferencesRaw();
  if (raw !== null) {
    try {
      const parsed = JSON.parse(raw);
      const normalized = validateAndNormalizePreferences(parsed);
      inMemoryPreferences = normalized;
      return normalized;
    } catch {
      // JSON parse error -> デフォルトへフォールバック
      inMemoryPreferences = { ...DEFAULT_PLAYTEST_USER_PREFERENCES };
      return { ...DEFAULT_PLAYTEST_USER_PREFERENCES };
    }
  }

  if (inMemoryPreferences !== null) {
    return { ...inMemoryPreferences };
  }

  return { ...DEFAULT_PLAYTEST_USER_PREFERENCES };
}

/**
 * ユーザー設定の保存
 */
export function savePlaytestUserPreferences(prefs: PlaytestUserPreferences): void {
  const normalized = validateAndNormalizePreferences(prefs);
  inMemoryPreferences = { ...normalized };

  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(PLAYTEST_PREFERENCES_STORAGE_KEY, JSON.stringify(normalized));
    }
  } catch (e) {
    console.warn("PlaytestUserPreferences: Failed to write to localStorage, saved in-memory only", e);
  }
}

/**
 * CSS変数 --bp-font-scale を DOM に適用する
 */
export function applyFontScaleToDom(fontScale: FontScalePercentage, targetElement?: HTMLElement | null): void {
  const scale = FONT_SCALE_NUMERIC_MAP[fontScale] ?? 1.0;
  if (typeof document !== "undefined") {
    const el = targetElement ?? document.documentElement;
    if (el && el.style) {
      el.style.setProperty("--bp-font-scale", String(scale));
    }
  }
}

/**
 * テスト用のインメモリ状態リセット関数
 */
export function resetPreferencesInMemoryForTesting(): void {
  inMemoryPreferences = null;
}

/**
 * React コンポーネント用カスタムフック
 */
export function usePlaytestUserPreferences() {
  const [preferences, setPreferences] = useState<PlaytestUserPreferences>(() => {
    const loaded = loadPlaytestUserPreferences();
    applyFontScaleToDom(loaded.fontScale);
    return loaded;
  });

  useEffect(() => {
    applyFontScaleToDom(preferences.fontScale);
  }, [preferences.fontScale]);

  const updatePreferences = useCallback(
    (updater: Partial<PlaytestUserPreferences> | ((prev: PlaytestUserPreferences) => PlaytestUserPreferences)) => {
      setPreferences((prev) => {
        const next = typeof updater === "function" ? updater(prev) : { ...prev, ...updater };
        const normalized = validateAndNormalizePreferences(next);
        savePlaytestUserPreferences(normalized);
        applyFontScaleToDom(normalized.fontScale);
        return normalized;
      });
    },
    []
  );

  const resetToDefault = useCallback(() => {
    const defaults = { ...DEFAULT_PLAYTEST_USER_PREFERENCES };
    savePlaytestUserPreferences(defaults);
    applyFontScaleToDom(defaults.fontScale);
    setPreferences(defaults);
  }, []);

  return {
    preferences,
    updatePreferences,
    resetToDefault,
  };
}
