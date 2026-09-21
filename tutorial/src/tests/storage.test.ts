import { describe, expect, it } from "vitest";
import { clearProgress, loadProgress, progressStorageKey, resolveBrowserStorage, saveProgress, type StorageLike } from "../lib/storage";

const makeStorage = (): StorageLike => {
  const values = new Map<string, string>();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
};

describe("progress storage", () => {
  it("localStorageがなくても初期状態で起動できる", () => {
    expect(loadProgress("lesson", null)).toMatchObject({ scenarioId: "lesson", stepIndex: 0, completed: false });
  });

  it("localStorageへのアクセスが拒否されても起動できる", () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", { configurable: true, get: () => { throw new Error("denied"); } });
    expect(resolveBrowserStorage()).toBeNull();
    if (descriptor) Object.defineProperty(window, "localStorage", descriptor);
  });

  it("進捗を保存して復元できる", () => {
    const storage = makeStorage();
    saveProgress({ scenarioId: "lesson", stepIndex: 7, completed: false, updatedAt: "2026-01-01T00:00:00.000Z" }, storage);
    expect(loadProgress("lesson", storage).stepIndex).toBe(7);
  });

  it("最初からやり直すと保存を消せる", () => {
    const storage = makeStorage();
    storage.setItem(progressStorageKey, "saved");
    clearProgress(storage);
    expect(storage.getItem(progressStorageKey)).toBeNull();
  });

  it("壊れた保存データを安全に無視する", () => {
    const storage = makeStorage();
    storage.setItem(progressStorageKey, "not-json");
    expect(loadProgress("lesson", storage).stepIndex).toBe(0);
  });
});
